/** 点击日历卡片只选中卡片，不自动选中卡内时间段/内容。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1360, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    const clicked = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('[data-cal-date]')].find((c) => c.querySelector('[data-cal-span]'));
      if (!cell) return null;
      const key = cell.getAttribute('data-cal-date');
      // 点格子空白处（避开条目 chip）
      const r = cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.right - 6, clientY: r.bottom - 6 }));
      return key;
    });
    await sleep(500);
    const state = await page.evaluate((key) => {
      const cell = document.querySelector(`[data-cal-date="${key}"]`);
      const span = cell?.querySelector('[data-cal-span]');
      return {
        selected: cell?.classList.contains('border-brand-500'),
        spanRing: span ? /ring-/.test(span.className) : false,
        cellRing: cell ? /ring-/.test(cell.className) : false,
        spanClass: span?.className || '',
      };
    }, clicked);
    check('点击卡片后该卡片进入选中态', !!clicked && state.selected, JSON.stringify({ clicked, state }));
    check('卡片内的条目不会被自动选中（无 ring）', !state.spanRing, JSON.stringify(state));
    check('卡片本身也不再叠加第二层 ring', !state.cellRing, JSON.stringify(state));
  }, { width: 1360, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
