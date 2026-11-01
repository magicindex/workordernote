/**
 * 周视图持续时间与月历上限：
 *   1) 未完成的过期任务会逐日续到当天 23:59
 *   2) 已完成任务用实际完成时刻收尾
 *   3) 月历一格最多 3 条，其余折成 +N 条
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
let passed = 0, failed = 0;
const near = (a, b, t = 6) => Math.abs(a - b) <= t;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
async function api(token, apiPath, method = 'GET', body = null) {
  const res = await fetch(BASE + apiPath, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.code !== 0) throw new Error(`${method} ${apiPath} → ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}
(async () => {
  let token = '', listId = 0;
  const ids = [];
  try {
    await withTab(async (page) => {
      await login(page, BASE);
      token = await page.evaluate(() => localStorage.getItem('reminders.token') || '');
      const p = (n) => String(n).padStart(2, '0');
      const now = new Date();
      const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const yesterday = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
      const list = await api(token, '/api/reminder/lists', 'POST', { name: `持续自检-${STAMP}`, color: 'blue', icon: 'list' });
      listId = Number(list.id);
      const mk = async (body) => { const it = await api(token, '/api/reminder/items', 'POST', { kind: 'task', repeat_rule: 'none', channels: ['inapp'], list_id: listId, ...body }); ids.push(String(it.id)); return it; };
      const overdue = await mk({ title: '昨日未完成', due_at: `${yesterday}T23:59:00+08:00` });
      const done = await mk({ title: '今天完成', start_at: `${today}T00:00:00+08:00`, end_at: `${today}T23:59:00+08:00`, due_at: `${today}T23:59:00+08:00` });
      await api(token, `/api/reminder/items/${done.id}/complete`, 'POST', {});
      for (let i = 0; i < 4; i++) await mk({ title: `月历溢出-${i}`, due_at: `${today}T${String(10 + i).padStart(2, '0')}:00:00+08:00` });

      await page.evaluate((id) => localStorage.setItem('ui_calendar_lists', JSON.stringify([id])), listId);
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('知道了')); if (b) b.click(); });
      await sleep(500);
      // 月历上限（默认月视图）
      const month = await page.evaluate(({ day, doneId }) => {
        const cell = document.querySelector(`[data-cal-date="${day}"]`);
        if (!cell) return null;
        return {
          tasks: cell.querySelectorAll('[data-cal-task]').length,
          spans: cell.querySelectorAll('[data-cal-span]').length,
          more: cell.querySelector('[data-cal-more]')?.textContent?.trim() || '',
          height: Math.round(cell.getBoundingClientRect().height),
        };
      }, { day: today, doneId: String(done.id) });
      check('月历一格最多 3 条', !!month && month.tasks + month.spans <= 3, JSON.stringify(month));
      check('超出条目折叠成 +N 条', !!month && /^\+\d+ 条…$/.test(month.more), month?.more || '');

      await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
      await sleep(800);
      if (!(await page.$('[data-week-block]'))) { await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click()); await sleep(700); }
      const week = await page.evaluate(({ a, b, doneId, day, yday }) => {
        const read = (key, id) => {
          const col = document.querySelector(`[data-week-col="${key}"]`);
          const el = col?.querySelector(`[data-week-block="${id}"]`);
          if (!el) return null;
          const cr = col.getBoundingClientRect(), br = el.getBoundingClientRect();
          return { top: Math.round(br.top - cr.top), h: Math.round(br.height), role: el.dataset.weekRole, capT: el.dataset.weekCapTop === '1', capB: el.dataset.weekCapBottom === '1' };
        };
        return { overdueEnd: read(day, a), overdueStart: read(yday, a), done: read(day, b) };
      }, { a: String(overdue.id), b: String(done.id), doneId: String(done.id), day: today, yday: yesterday });
      check('过期未完成续画到当天 23:59', !!week.overdueEnd && near(week.overdueEnd.h, 1055, 8) && week.overdueEnd.top === 0, JSON.stringify(week.overdueEnd));
      check('续画任务昨天从 23:59 开始', !!week.overdueStart && near(week.overdueStart.top, 1055, 8), JSON.stringify(week.overdueStart));
      const endMin = now.getHours() * 60 + now.getMinutes();
      check('完成任务在提交时刻收尾', !!week.done && near(week.done.h, (endMin / 60) * 44, 8) && week.done.h < 1000, JSON.stringify(week.done));

      await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-152-duration.png') });
    });
  } finally {
    if (token) {
      for (const id of ids) await api(token, `/api/reminder/items/${id}`, 'DELETE').catch(() => {});
      if (listId) await api(token, `/api/reminder/lists/${listId}`, 'DELETE').catch(() => {});
    }
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
