/**
 * 周视图不再给「今天」铺背景色块或流光；月视图今天仍保留流光。
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    await page.evaluate(() => localStorage.removeItem('ui_calendar_lists'));
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('知道了')); if (b) b.click(); });
    await sleep(600);
    await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
    await sleep(900);
    if (!(await page.$('[data-week-grid]'))) { await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click()); await sleep(800); }

    const week = await page.evaluate(() => ({
      bg: document.querySelectorAll('[data-week-today-bg]').length,
      flow: document.querySelectorAll('[data-week-grid] .today-flow').length,
      oldHighlights: document.querySelectorAll('[data-week-highlight]').length,
      regions: document.querySelectorAll('[data-week-region]').length,
    }));
    check('周视图今天没有背景色块', week.bg === 0, JSON.stringify(week));
    check('周视图今天没有流光边框', week.flow === 0, JSON.stringify(week));
    check('旧 active/next 高亮未回潮', week.oldHighlights === 0, String(week.oldHighlights));
    check('任务范围背景保持关闭', week.regions === 0, String(week.regions));

    await page.evaluate(() => document.querySelector('[data-cal-view="month"]')?.click());
    await sleep(700);
    const month = await page.evaluate(() => document.querySelectorAll('[data-month-today-flow]').length);
    check('月视图今天仍保留流光', month === 1, String(month));

    await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-151-week-no-today-bg.png') });
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
