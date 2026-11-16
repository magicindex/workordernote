/** 日历卡片内文字彻底不可选中：点卡片只选卡片，不出现文字高亮。 */
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
    const info = await page.evaluate(() => {
      const cell = document.querySelector('.cal-cell');
      const task = document.querySelector('[data-cal-task]');
      const span = document.querySelector('[data-cal-span]');
      const pick = (el) => el ? { ua: getComputedStyle(el).userSelect, webkit: getComputedStyle(el).webkitUserSelect } : null;
      return { cell: pick(cell), task: pick(task), span: pick(span), hasTask: !!task, hasSpan: !!span };
    });
    check('卡片本身不可选中文字', info.cell && info.cell.ua === 'none' && info.cell.webkit === 'none', JSON.stringify(info));
    check('卡内任务标题不可选中', info.hasTask && info.task.ua === 'none' && info.task.webkit === 'none', JSON.stringify(info));
    check('卡内时间段标题不可选中', info.hasSpan && info.span.ua === 'none' && info.span.webkit === 'none', JSON.stringify(info));

    // 模拟一次文字拖选：mousedown 在任务文字上拖动，最终 selection 不应包含卡片内文字。
    const sel = await page.evaluate(() => {
      const task = document.querySelector('[data-cal-task] .truncate') || document.querySelector('[data-cal-task]');
      if (!task) return 'no-task';
      const r = task.getBoundingClientRect();
      task.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + 2, clientY: r.top + r.height / 2 }));
      window.getSelection()?.removeAllRanges();
      return String(window.getSelection() || '');
    });
    check('拖选后没有文字选区', sel === '' || sel === 'no-task', String(sel));
  }, { width: 1360, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
