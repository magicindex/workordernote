/**
 * 临时探查：字号放大（无障碍/系统字体放大）时手机端会不会溢出。
 *
 * 用法：APP_URL=http://127.0.0.1:8908 node probe-font.js
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
      text: (el.textContent || '').trim().slice(0, 26),
      left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
    });
  }
  return { vw, root: getComputedStyle(document.documentElement).fontSize, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, limit), badCount: bad.length };
};

async function probe(page, url, label, sel = '[data-card-face]') {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 40; i += 1) {
    if (await page.evaluate((s) => !!document.querySelector(s), sel).catch(() => false)) break;
    await sleep(250);
  }
  await sleep(1000);
  const info = await page.evaluate(finder);
  const flags = info.scrollW <= info.vw + 1 && info.badCount === 0 ? '✅' : '❌';
  console.log(`  ${flags} ${label}：屏宽 ${info.vw} 根字号 ${info.root}｜scrollW ${info.scrollW}｜越界 ${info.badCount}`);
  for (const b of info.bad) console.log(`       <${b.tag} class="${b.cls}"> right=${b.right} w=${b.w} 「${b.text}」`);
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

    for (const w of [360, 390, 412]) {
      for (const fs_ of [16, 18, 20, 22]) {
        await page.setViewport({ width: w, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await page.goto(cardURL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await page.evaluate((size) => { document.documentElement.style.fontSize = size + 'px'; }, fs_);
        await sleep(1500);
        await page.evaluate((size) => { document.documentElement.style.fontSize = size + 'px'; }, fs_);
        const info = await page.evaluate(finder);
        const flags = info.scrollW <= info.vw + 1 && info.badCount === 0 ? '✅' : '❌';
        console.log(`  ${flags} 信用卡页 ${w}px 根字号 ${fs_}px｜scrollW ${info.scrollW}｜越界 ${info.badCount}`);
        for (const b of info.bad.slice(0, 5)) console.log(`       <${b.tag} class="${b.cls}"> right=${b.right} w=${b.w} 「${b.text}」`);
        if (info.badCount) await page.screenshot({ path: path.join(SHOTS, `probe-font-${w}-${fs_}.png`) });
      }
    }
  });
})().catch((err) => { console.error('探查失败：', err.message); process.exit(1); });
