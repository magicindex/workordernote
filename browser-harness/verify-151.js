/**
 * 验证周视图「只有今天铺一整天的背景」：
 *   1) 没有任何任务范围背景块
 *   2) 今天列有一块从 00:00 到 24:00 的底色
 *   3) 其他日期没有背景
 *   4) 不再有 active/next 任务高亮块
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
    if (!(await page.$('[data-week-today-bg]'))) { await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click()); await sleep(800); }

    const data = await page.evaluate(() => {
      const today = (() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
      const cols = [...document.querySelectorAll('[data-week-col]')];
      const bg = document.querySelector('[data-week-today-bg]');
      const col = bg?.closest('[data-week-col]');
      const cr = col?.getBoundingClientRect();
      const br = bg?.getBoundingClientRect();
      return {
        bgs: document.querySelectorAll('[data-week-today-bg]').length,
        inToday: col?.getAttribute('data-week-col') === today,
        top: br && cr ? Math.round(br.top - cr.top) : -1,
        height: br ? Math.round(br.height) : -1,
        width: br && cr ? Math.abs(Math.round(br.width) - Math.round(cr.width)) <= 2 : false,
        otherBgs: cols.filter((c) => c.getAttribute('data-week-col') !== today && c.querySelector('[data-week-today-bg]')).length,
        oldHighlights: document.querySelectorAll('[data-week-highlight]').length,
        regions: document.querySelectorAll('[data-week-region]').length,
        color: bg ? getComputedStyle(bg).backgroundColor : '',
      };
    });
    check('不再给任务铺范围背景', data.regions === 0, String(data.regions));
    check('今天只有一块全天背景', data.bgs === 1 && data.inToday, JSON.stringify(data));
    check('背景从 00:00 铺满 24 小时', data.top === 0 && data.height === 1056, `top=${data.top} h=${data.height}`);
    check('背景占满整列宽度', data.width, JSON.stringify(data));
    check('其他日期没有背景', data.otherBgs === 0, String(data.otherBgs));
    check('旧 active/next 高亮已移除', data.oldHighlights === 0, String(data.oldHighlights));
    check('全天背景有可见底色', !/rgba\(0, 0, 0, 0\)/.test(data.color), data.color);

    await page.setViewport({ width: 1440, height: 1400 });
    await sleep(500);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-151-today-bg.png') });
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
