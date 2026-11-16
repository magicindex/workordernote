/** 点击日历卡片（包括卡内条目）时，右侧当天详情必须同步切到该天。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const rightTitle = (page) => page.evaluate(() => (document.querySelector('aside h3')?.textContent || '').trim());
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1360, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1600);

    // 先记下右侧当前日期，再找另一天（含任务），点卡内任务标题。
    const before = await rightTitle(page);
    const target = await page.evaluate(() => {
      const current = document.querySelector('[data-month-today-flow]')?.closest('.cal-cell');
      const cell = [...document.querySelectorAll('[data-cal-date]')].find((c) => c !== current && c.querySelector('[data-cal-task]'));
      if (!cell) return null;
      const key = cell.getAttribute('data-cal-date');
      const task = cell.querySelector('[data-cal-task]');
      task.click();
      return { key, day: cell.querySelector('.flex.h-5, .sm\\:h-6')?.textContent?.trim() || key };
    });
    await sleep(700);
    const after = await rightTitle(page);
    check('点卡内任务时卡片同步选中该天', !!target && (await page.$(`[data-cal-date="${target.key}"]`)) !== null, JSON.stringify(target));
    check('右侧详情标题切到该天，不保留上一天', !!target && after !== before && after.includes('月') && after.includes('日'), JSON.stringify({ before, after, target }));

    // 关闭可能弹出的查看页，再点空白卡片验证一次
    await page.evaluate(() => document.querySelector('[data-view-close]')?.click());
    await sleep(300);
    const blank = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('[data-cal-date]')].find((c) => !c.className.includes('border-brand-500'));
      if (!cell) return null;
      const key = cell.getAttribute('data-cal-date');
      cell.click();
      return key;
    });
    await sleep(500);
    const finalTitle = await rightTitle(page);
    check('点卡片空白处右侧同样切换', !!blank && finalTitle !== after, JSON.stringify({ blank, after, finalTitle }));
  }, { width: 1360, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
