/**
 * 临时探查：全部页翻月到底发了什么请求、日历里 10/20 那天有几条。
 * 用法：APP_URL=http://127.0.0.1:8918 node probe-month.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + '/admin/all', { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 40; i += 1) {
      if (await page.evaluate(() => !!document.querySelector('[data-month-nav]'))) break;
      await sleep(300);
    }
    await sleep(2000);
    const before = await page.evaluate(() => ({
      label: document.querySelector('[data-month-label]')?.innerText.trim(),
      reqs: performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('/api/reminder/items')),
      firstRow: document.querySelector('.reminder-row')?.innerText.replace(/\s+/g, ' ').slice(0, 50),
      count: document.querySelectorAll('.reminder-row').length,
    }));
    console.log('  进入时：', JSON.stringify(before, null, 0));

    await page.evaluate(() => document.querySelector('[data-month-next]')?.click());
    await sleep(2500);
    const after = await page.evaluate(() => ({
      label: document.querySelector('[data-month-label]')?.innerText.trim(),
      reqs: performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('/api/reminder/items')),
      count: document.querySelectorAll('.reminder-row').length,
      titles: [...document.querySelectorAll('.reminder-row')].slice(0, 3).map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 40)),
      navDisabled: {
        prev: document.querySelector('[data-month-prev]')?.disabled,
        next: document.querySelector('[data-month-next]')?.disabled,
      },
    }));
    console.log('  点下个月后：', JSON.stringify(after, null, 0));

    // 日历：20 号那天有几条
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    const cal = await page.evaluate(() => {
      const cell = document.querySelector('[data-cal-date$="-20"]');
      return {
        cell: cell?.getAttribute('data-cal-date'),
        text: cell?.innerText.replace(/\s+/g, ' ').slice(0, 120),
        hasMore: !!cell?.querySelector('[data-cal-more]'),
        moreText: cell?.querySelector('[data-cal-more]')?.innerText.trim(),
        cells: [...document.querySelectorAll('[data-cal-date]')].length,
      };
    });
    console.log('  日历 20 号：', JSON.stringify(cal, null, 0));
  });
})().catch((e) => { console.error('探查失败：', e.message); process.exit(1); });
