#!/usr/bin/env node
/**
 * 月历日框高度：日期格按内容高度排列，不能把整屏平均分给 5/6 行。
 * 同时保证日历页本身不因右侧当日清单被撑成超长页面。
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`); }
}

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('知道了'));
      if (b) b.click();
    });
    await sleep(500);
    await page.evaluate(() => document.querySelector('[data-cal-view="month"]')?.click());
    await sleep(900);

    const flow = await page.evaluate(() => {
      const el = document.querySelector('[data-month-today-flow]');
      if (!el) return null;
      const before = getComputedStyle(el, '::before');
      return { count: document.querySelectorAll('[data-month-today-flow]').length, bg: before.backgroundImage, padding: before.paddingTop, radius: el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) : 0 };
    });
    check('月视图今天有且只有一块流光边框', flow?.count === 1, JSON.stringify(flow));
    check('月视图今天边框是流光渐变', !!flow && flow.bg.includes('conic-gradient') && flow.padding === '2px', JSON.stringify(flow));
    check('流光覆盖层跟随日期格圆角', (flow?.radius ?? 0) >= 10, JSON.stringify(flow));
    const info = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.cal-cell')];
      const sec = document.querySelector('section.surface');
      const h = cells.map((c) => Math.round(c.getBoundingClientRect().height));
      const bottoms = cells.map((c) => c.getBoundingClientRect().bottom);
      return {
        cells: cells.length,
        min: h.length ? Math.min(...h) : 0,
        max: h.length ? Math.max(...h) : 0,
        fillGap: sec && bottoms.length ? Math.round(sec.getBoundingClientRect().bottom - Math.max(...bottoms)) : 999,
        doc: document.documentElement.scrollHeight,
        view: window.innerHeight,
      };
    });
    check('月历日期格为整周（28/35/42）', info.cells >= 28 && info.cells % 7 === 0, info);
    check('日期格高度不再拉到整屏', info.max > 0 && info.max < 220, info);
    check('各行等高', info.max - info.min <= 2, info);
    check('日期格铺满卡片底部', info.fillGap >= 0 && info.fillGap <= 24, info);
    check('日历页高度不被右侧清单撑爆', info.doc <= info.view + 120, info);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-154-month-compact.png') });
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
