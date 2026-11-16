/** 周视图：长标题按块高度省略号收口；日历表格浅蓝淡雅。 */
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
    await sleep(1400);
    await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
    await sleep(1200);
    const info = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('[data-week-block]')];
      let overflow = 0, ellipsis = 0, labels = 0, bg = '';
      for (const b of blocks) {
        const br = b.getBoundingClientRect();
        const l = b.querySelector('[data-week-label-mode]');
        if (!l) continue;
        labels += 1;
        const lr = l.getBoundingClientRect();
        if (lr.bottom > br.bottom + 1 || lr.top < br.top - 1) overflow += 1;
        if ((l.textContent || '').includes('…')) ellipsis += 1;
      }
      const table = document.querySelector('.cal-table');
      bg = table ? getComputedStyle(table).backgroundColor : '';
      return { blocks: blocks.length, labels, overflow, ellipsis, bg };
    });
    check('周视图有任务块和标签', info.blocks > 0 && info.labels > 0, JSON.stringify(info));
    check('标签不超出任务块边界', info.overflow === 0, JSON.stringify(info));
    check('长标题用省略号收口', info.ellipsis > 0, JSON.stringify(info));
    const m = String(info.bg).match(/rgba?\((\d+),?\s*(\d+),?\s*(\d+)/);
    check('表格底色是低饱和浅蓝', !!m && Number(m[3]) >= Number(m[1]), info.bg);
  }, { width: 1360, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
