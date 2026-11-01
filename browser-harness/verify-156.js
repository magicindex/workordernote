#!/usr/bin/env node
/** 月历随浏览器高度收缩：日期格要跟着变矮，内容不溢出卡片。 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
async function metrics(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('.cal-cell')];
    const sec = cells[0]?.closest('section');
    const cell = cells[0]?.getBoundingClientRect();
    const grid = cells[0]?.parentElement?.getBoundingClientRect();
    const counts = cells.map((c) => c.querySelectorAll('[data-cal-task], [data-cal-span]').length);
    return {
      h: innerHeight,
      cell: cell ? Math.round(cell.height) : 0,
      gridBottom: grid ? Math.round(grid.bottom) : 0,
      secBottom: sec ? Math.round(sec.getBoundingClientRect().bottom) : 0,
      maxChips: counts.length ? Math.max(...counts) : 0,
      scroll: document.documentElement.scrollHeight,
    };
  });
}
(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('知道了'));
      if (b) b.click();
    });
    await sleep(400);
    const tall = await metrics(page);
    check('1000px 高时日期格铺满卡片', tall.cell > 100 && Math.abs(tall.secBottom - tall.gridBottom) < 20, tall);

    await page.setViewport({ width: 1440, height: 700 });
    await sleep(800);
    const mid = await metrics(page);
    check('缩到 700px 时日期格跟着变矮', mid.cell > 0 && mid.cell < 95, mid);
    check('700px 时网格不超出卡片', mid.gridBottom <= mid.secBottom + 2, mid);
    check('700px 时每格最多 2 条，剩余收进省略', mid.maxChips <= 2, mid);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-156-month-700.png') });

    await page.setViewport({ width: 1440, height: 600 });
    await sleep(800);
    const short = await metrics(page);
    check('缩到 600px 时日期格继续变矮', short.cell > 0 && short.cell < 75, short);
    check('600px 时网格仍在卡片内', short.gridBottom <= short.secBottom + 2, short);
    check('600px 时每格最多 1 条', short.maxChips <= 1, short);
    check('页面高度不被撑出视口', short.scroll <= short.h + 120, short);
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
