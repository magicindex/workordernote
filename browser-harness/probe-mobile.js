/**
 * 临时探查脚本：手机端横向溢出到底出在哪个元素 / 哪个宽度。
 *
 * 用法：APP_URL=http://127.0.0.1:8908 node probe-mobile.js
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const finder = (limit = 8) => {
  const vw = window.innerWidth;
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sidebar')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    let p = el.parentElement, scrollable = false;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') { scrollable = true; break; }
      p = p.parentElement;
    }
    if (scrollable) continue;
    bad.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 60),
      text: (el.textContent || '').trim().slice(0, 24),
      left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
    });
  }
  return { vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, bad: bad.slice(0, limit), badCount: bad.length };
};

async function probe(page, url, label, waitSel = '[data-card-face]') {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 40; i += 1) {
    if (await page.evaluate((s) => !!document.querySelector(s), waitSel).catch(() => false)) break;
    await sleep(250);
  }
  await sleep(1200);
  const info = await page.evaluate(finder);
  const flag = info.scrollW <= info.vw + 1 && info.badCount === 0 ? '✅' : '❌';
  console.log(`  ${flag} ${label}：屏宽 ${info.vw}｜scrollW ${info.scrollW}｜越界元素 ${info.badCount}`);
  for (const b of info.bad) console.log(`       <${b.tag} class="${b.cls}"> left=${b.left} right=${b.right} w=${b.w} 「${b.text}」`);
  return info;
}

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const bucket = ((await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/lists', { headers: { Authorization: 'Bearer ' + token } });
      return (await res.json()).data;
    }, BASE)) || []).find((l) => l.template === 'credit_card');
    const cardURL = BASE + `/admin/list/${bucket.id}`;
    console.log('信用卡栏目：', cardURL);

    for (const w of [320, 360, 375, 390, 393, 412, 430, 480]) {
      await page.setViewport({ width: w, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await probe(page, cardURL, `信用卡页 ${w}px`);
      await page.screenshot({ path: path.join(SHOTS, `probe-cards-${w}.png`), fullPage: false });
    }

    // 头部「今天/账单已出」长条所在的工作台
    for (const w of [360, 390, 412]) {
      await page.setViewport({ width: w, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await probe(page, BASE + '/admin', `工作台 ${w}px`);
      await page.screenshot({ path: path.join(SHOTS, `probe-home-${w}.png`), fullPage: false });
    }

    // 新建卡片弹窗
    await page.setViewport({ width: 390, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await probe(page, cardURL, '信用卡页（准备开弹窗）');
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建卡片') || b.textContent.trim() === '新建');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log('  打开新建卡片弹窗：', opened);
    await sleep(1200);
    await probe(page, cardURL, '新建卡片弹窗 390px', '[role="dialog"], .fixed.inset-0');
    await page.screenshot({ path: path.join(SHOTS, 'probe-card-dialog-390.png') });
  });
})().catch((err) => { console.error('探查失败：', err.message); process.exit(1); });
