#!/usr/bin/env node
/** 日历工具条单行：清单超过内联数量时收进「更多」下拉，右侧操作对齐工具条右边界。 */
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
  let created = [];
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    // 保证至少 4 个清单，才能触发「更多」。
    const existing = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token');
      const r = await fetch(base + '/api/reminder/lists', { headers: { Authorization: 'Bearer ' + token } });
      return (await r.json())?.data || [];
    }, BASE);
    const need = Math.max(0, 4 - existing.length);
    for (let i = 0; i < need; i++) {
      const made = await page.evaluate(async ({ base, i }) => {
        const token = localStorage.getItem('reminders.token');
        const r = await fetch(base + '/api/reminder/lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ name: '筛选自检' + i + '-' + Date.now(), color: 'blue', icon: 'list' }),
        });
        return (await r.json())?.data;
      }, { base: BASE, i });
      if (made?.id) created.push(made.id);
    }
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('知道了'));
      if (b) b.click();
    });
    await sleep(400);

    const layout = await page.evaluate(() => {
      const tb = document.querySelector('[data-cal-toolbar]').getBoundingClientRect();
      const f = document.querySelector('[data-list-filter]').getBoundingClientRect();
      const btn = [...document.querySelectorAll('[data-cal-toolbar] button')].find((b) => b.textContent.includes('打印本月')).getBoundingClientRect();
      const stats = [...document.querySelectorAll('[data-cal-toolbar] span')].find((e) => (e.textContent || '').includes('未完成')).parentElement.getBoundingClientRect();
      const moreEl = document.querySelector('[data-list-filter-more]');
      const more = moreEl ? moreEl.getBoundingClientRect() : null;
      const card = document.querySelector('section.surface').getBoundingClientRect();
      const today = [...document.querySelectorAll('[data-cal-toolbar] button')].find((b) => b.textContent.trim() === '今天').getBoundingClientRect();
      const chips = [...document.querySelectorAll('[data-list-filter] .quick-chip')].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim());
      return {
        todayWithPrint: Math.abs(today.top - btn.top) <= 3,
        filterWithStats: Math.abs(f.top - stats.top) < 2,
        filterH: Math.round(f.height),
        moreRight: more ? Math.round(more.right) : -1,
        cardRight: Math.round(card.right),
        statsRight: Math.round(tb.right - stats.right),
        filterTableGap: Math.round(card.top - f.bottom),
        overflowX: document.documentElement.scrollWidth - innerWidth,
        more: !!moreEl,
        chips,
      };
    });
    check('今天与打印按钮同一行', layout.todayWithPrint, layout);
    check('清单与统计同一行', layout.filterWithStats, layout);
    check('筛选区高度保持单行', layout.filterH <= 40, layout);
    check('「更多」与大卡片右边界对齐', Math.abs(layout.moreRight - layout.cardRight) <= 2, layout);
    check('统计右对齐工具条右边界', Math.abs(layout.statsRight) <= 2, layout);
    check('清单紧贴表格上沿', layout.filterTableGap >= 0 && layout.filterTableGap < 20, layout);
    check('清单芯片带数量', layout.chips.some((t) => /\d+/.test(t.replace('全部', ''))), layout.chips);
    check('页面没有横向滚动', layout.overflowX <= 0, layout);
    check('清单超过上限时出现「更多」下拉', layout.more, layout);

    await page.click('[data-list-filter-more]');
    await sleep(300);
    const menu = await page.$$eval('[data-list-filter-menu] button', (els) => els.map((e) => e.innerText.trim()));
    check('下拉里包含被隐藏的清单', menu.length >= 1, menu);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-155-filter-menu.png') });

    const beforeText = await page.$eval('[data-list-filter-more]', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    const beforeCount = Number((beforeText.match(/·\s*(\d+)/) || [])[1] || 0);
    const target = (await page.$('[data-list-filter-menu] button[aria-checked="false"]')) || (await page.$('[data-list-filter-menu] button'));
    if (target) await target.click();
    await sleep(300);
    const moreText = await page.$eval('[data-list-filter-more]', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    const afterCount = Number((moreText.match(/·\s*(\d+)/) || [])[1] || 0);
    check('从下拉选中的清单计入「更多」角标', afterCount === beforeCount + 1, { beforeText, moreText });
    await page.click('[data-cal-view="month"]');
    await sleep(300);
    check('点外面收起下拉', !(await page.$('[data-list-filter-menu]')));

    await page.setViewport({ width: 1548, height: 1000 });
    await sleep(500);
    const wide = await page.evaluate(() => {
      const tb = document.querySelector('[data-cal-toolbar]').getBoundingClientRect();
      const f = document.querySelector('[data-list-filter]').getBoundingClientRect();
      const stats = [...document.querySelectorAll('[data-cal-toolbar] span')].find((e) => (e.textContent || '').includes('未完成')).parentElement.getBoundingClientRect();
      const more = document.querySelector('[data-list-filter-more]')?.getBoundingClientRect();
      const card = document.querySelector('section.surface').getBoundingClientRect();
      return {
        sameRow: Math.abs(f.top - stats.top) < 2,
        moreGap: more ? Math.round(more.right - card.right) : -1,
        statsGap: Math.round(tb.right - stats.right),
      };
    });
    check('1548px 下清单与统计同排、更多仍贴卡片右边界', wide.sameRow && Math.abs(wide.moreGap) <= 2 && Math.abs(wide.statsGap) <= 2, wide);
    await page.evaluate(() => localStorage.removeItem('ui_calendar_lists'));
  }, { width: 1440, height: 1000 });

  // 清理临时清单
  if (created.length) {
    await withTab(async (page) => {
      await login(page, BASE);
      for (const id of created) {
        await page.evaluate(async ({ base, id }) => {
          const token = localStorage.getItem('reminders.token');
          await fetch(`${base}/api/reminder/lists/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
        }, { base: BASE, id });
      }
    }, { width: 1280, height: 800 });
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
