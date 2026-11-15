/** 日历：点击卡片只选日期、格内项目只读、右侧列表编辑、溢出用顶部共 N 条（用户 2026-11-15）。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const selectedDate = (page) => page.evaluate(() => document.querySelector('[data-cal-date].ring-2')?.getAttribute('data-cal-date') || '');
const editorOpen = (page) => page.evaluate(() => !!document.querySelector('[data-editor-side]'));
const closeEditor = async (page) => {
  await page.evaluate(() => {
    const panel = document.querySelector('[data-editor-side]');
    const btn = panel ? [...panel.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '关闭') : null;
    btn?.click();
  });
  await sleep(350);
};
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const overflow = await page.evaluate(() => {
      const count = document.querySelector('[data-cal-total-count]');
      return {
        count: (count?.textContent || '').trim(),
        more: !!document.querySelector('[data-cal-more]'),
        popup: !!document.querySelector('[data-cal-overflow]'),
      };
    });
    check('溢出条目改为顶部「共 N 条」', /^共\d+条$/.test(overflow.count) && !overflow.more && !overflow.popup, JSON.stringify(overflow));

    const target = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('[data-cal-date]')].find((c) => c.querySelector('[data-cal-task]') && !c.classList.contains('ring-2'));
      return cell ? { date: cell.getAttribute('data-cal-date'), taskId: cell.querySelector('[data-cal-task]')?.getAttribute('data-cal-task') } : null;
    });
    check('找到带任务的日期格', !!target, JSON.stringify(target));
    if (target) {
      await page.evaluate(({ date }) => document.querySelector(`[data-cal-date="${date}"] [data-cal-task]`)?.click(), target);
      await sleep(500);
      const afterTaskClick = { selected: await selectedDate(page), editor: await editorOpen(page) };
      check('点格内项目只切换日期，不打开编辑', afterTaskClick.selected === target.date && afterTaskClick.editor === false, JSON.stringify(afterTaskClick));
    }

    const empty = await page.evaluate(() => {
      const c = [...document.querySelectorAll('[data-cal-date]')].find((el) => !el.querySelector('[data-cal-task]') && !el.querySelector('[data-cal-span]'));
      return c?.getAttribute('data-cal-date') || '';
    });
    if (empty) {
      const box = await page.evaluate((d) => {
        const el = document.querySelector(`[data-cal-date="${d}"]`);
        const r = el?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      }, empty);
      if (box) await page.mouse.click(box.x, box.y, { clickCount: 2 });
      await sleep(700);
      check('双击日期格仍能新建', await editorOpen(page));
      await closeEditor(page);
    } else {
      check('双击日期格仍能新建', false, 'no empty cell');
    }

    // 先选回有任务的日期，再点右侧列表编辑
    await page.evaluate(({ date }) => document.querySelector(`[data-cal-date="${date}"]`)?.click(), target || { date: '' });
    await sleep(400);
    const rightEdit = await page.evaluate(() => {
      const btn = document.querySelector('aside.cal-surface article button.min-w-0');
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(500);
    check('右侧列表点击进入编辑', rightEdit && await editorOpen(page));
    await closeEditor(page);
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
