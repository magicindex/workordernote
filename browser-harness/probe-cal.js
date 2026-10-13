/**
 * 临时探查：日历里同一天 6 条为什么只显示 3+1。
 * 用法：APP_URL=http://127.0.0.1:8918 node probe-cal.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const ids = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await api(page, '/api/reminder/items', 'POST', {
        title: `探查日历${i}-${STAMP}`, due_at: '2026-10-20T09:00:00+08:00', repeat_rule: 'none', channels: ['inapp'],
      });
      const id = res.body?.data?.id;
      if (id) ids.push(id);
      await sleep(300);
    }
    console.log('  建成', ids.length, '条');

    // 后端那天到底返回几条
    const range = await api(page, '/api/reminder/calendar?from=2026-10-18&to=2026-10-22');
    const rows = (range.body?.data || []).filter((r) => String(r.due_date) === '2026-10-20');
    console.log('  接口 10-20 返回', rows.length, '条：', rows.map((r) => r.title.slice(0, 14)).join(' | '));

    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3500);
    const cell = await page.evaluate(() => {
      const c = document.querySelector('[data-cal-date="2026-10-20"]');
      return {
        chips: [...(c?.querySelectorAll('.cal-task') || [])].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
        more: c?.querySelector('[data-cal-more]')?.innerText.trim() || '',
        filter: localStorage.getItem('reminders.list_filter') || localStorage.getItem('ui_list_filter') || '(无)',
      };
    });
    console.log('  格子内容：', JSON.stringify(cell, null, 0));
    for (const id of ids) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    console.log('  已清理');
  });
})().catch((e) => { console.error('探查失败：', e.message); process.exit(1); });
