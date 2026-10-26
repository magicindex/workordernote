/**
 * 手机悬浮「+」按频道分流（用户 2026-10-26）：
 *   提醒@他 → 新建提醒；信用卡账单 → 新建卡片；人生要有仪式感 → 新建事项；
 *   其余频道 → 新建待办（快速新建卡）。
 * 同时确认内置频道（课程表/提醒@他）在手机「全部清单」弹层最前面。
 *
 * 只读打开、关闭弹窗，不保存任何数据。
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-135.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const api = (page, p) => page.evaluate(async ({ base, p }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { headers: { Authorization: 'Bearer ' + token } });
  return (await res.json().catch(() => null))?.data;
}, { base: BASE, p });
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
}, sel);
async function waitVisible(page, sel, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await visible(page, sel).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}
async function dismissAlert(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('知道了'));
    if (b && b.getBoundingClientRect().width > 0) b.click();
  }).catch(() => {});
  await sleep(400);
}
async function closeModal(page) {
  const ok = await page.evaluate(() => {
    const overlays = [...document.querySelectorAll('div.absolute.inset-0')].filter((e) => getComputedStyle(e).position === 'absolute');
    const el = overlays[overlays.length - 1];
    if (!el) return false;
    el.click();
    return true;
  });
  await sleep(500);
  return ok;
}
async function readFab(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-mobile-fab]');
    return el ? {
      action: el.getAttribute('data-mobile-fab-action'),
      label: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
    } : null;
  });
}
async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1600);
  await dismissAlert(page);
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await login(page, BASE);
    const lists = (await api(page, '/api/reminder/lists')) || [];
    const credit = lists.find((l) => l.template === 'credit_card');
    const ceremony = lists.find((l) => l.template === 'ceremony');

    // 1) 待办：默认新建待办
    await goto(page, '/admin');
    let fab = await readFab(page);
    check('待办页悬浮按钮是「新建待办」', fab?.action === 'reminder' && fab.label === '新建待办', JSON.stringify(fab));
    await page.click('[data-mobile-fab]');
    check('待办页点悬浮按钮打开快速新建', await waitVisible(page, '.quick-card'), 'quick-card 未出现');
    await closeModal(page);

    // 2) 提醒@他：新建提醒
    await goto(page, '/admin/nudges');
    fab = await readFab(page);
    check('提醒@他页悬浮按钮是「新建提醒」', fab?.action === 'nudge' && fab.label === '新建提醒', JSON.stringify(fab));
    await page.click('[data-mobile-fab]');
    check('提醒@他页点悬浮按钮打开新建提醒', await waitVisible(page, '[data-nudge-content]'), '新建提醒弹窗未出现');
    await closeModal(page);

    // 3) 信用卡：新建卡片
    if (credit) {
      await goto(page, `/admin/list/${credit.id}`);
      fab = await readFab(page);
      check('信用卡页悬浮按钮是「新建卡片」', fab?.action === 'credit' && fab.label === '新建卡片', JSON.stringify(fab));
      await page.click('[data-mobile-fab]');
      check('信用卡页点悬浮按钮打开新建卡片', await waitVisible(page, '[data-card-name]'), '新建卡片弹窗未出现');
      await closeModal(page);
    } else {
      check('实例里没有信用卡栏目，跳过新建卡片', true);
    }

    // 4) 仪式感：新建事项
    if (ceremony) {
      await goto(page, `/admin/list/${ceremony.id}`);
      fab = await readFab(page);
      check('仪式感页悬浮按钮是「新建事项」', fab?.action === 'ceremony' && fab.label === '新建事项', JSON.stringify(fab));
      await page.click('[data-mobile-fab]');
      check('仪式感页点悬浮按钮打开新建事项', await waitVisible(page, '[data-ceremony-form-title]'), '新建事项弹窗未出现');
      await closeModal(page);
    } else {
      check('实例里没有仪式感栏目，跳过新建事项', true);
    }

    // 5) 手机清单弹层：内置频道置顶
    await goto(page, '/admin');
    await page.click('[data-tab-lists]');
    await sleep(700);
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-lists-sheet-row]')].map((e) => e.getAttribute('data-lists-sheet-row')));
    const cfg = await api(page, '/api/configs');
    const expect = [...(cfg?.timetable_enabled === 'true' ? ['timetable'] : []), ...(cfg?.nudge_enabled !== 'false' ? ['nudge'] : [])];
    check('手机清单弹层把课程表 / 提醒@他排在最前面', expect.every((k, i) => rows[i] === k), JSON.stringify({ expect, rows }));
    await page.click('[data-lists-sheet-close]');
    await sleep(300);
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
