/** 周视图：已完成任务的线段/横杠/标签统一灰色，未完成仍用鲜艳色。 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = String(Date.now()).slice(-7);
const LIST_NAME = `完成灰-${STAMP}`;
let passed = 0, failed = 0;
const check = (n, ok, x = '') => { ok ? (passed++, console.log('  ✓ ' + n)) : (failed++, console.log('  ✗ ' + n + (x ? ' — ' + x : ''))); };
async function api(token, p, method = 'GET', body = null) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.code !== 0) throw new Error(`${method} ${p} ${r.status} ${JSON.stringify(d)}`);
  return d.data;
}
(async () => {
  let token = '', listId = 0; const ids = [];
  try {
    await withTab(async (page) => {
      await login(page, BASE);
      token = await page.evaluate(() => localStorage.getItem('reminders.token') || '');
      const list = await api(token, '/api/reminder/lists', 'POST', { name: LIST_NAME, color: 'blue', icon: 'list' });
      listId = Number(list.id);
      const today = await page.evaluate(() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
      const mk = async (title, h) => {
        const item = await api(token, '/api/reminder/items', 'POST', { title, kind: 'task', due_at: `${today}T${h}:00:00+08:00`, repeat_rule: 'none', channels: ['inapp'], list_id: listId });
        ids.push(String(item.id)); return String(item.id);
      };
      const doneId = await mk(`已完成任务-${STAMP}`, '09');
      await mk(`未完成任务甲-${STAMP}`, '10');
      await mk(`未完成任务乙-${STAMP}`, '11');
      await api(token, `/api/reminder/items/${doneId}/complete`, 'POST', {});
      await page.evaluate((id) => localStorage.setItem('ui_calendar_lists', JSON.stringify([id])), listId);
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      for (const b of await page.$$('button')) if ((await b.evaluate(el => el.textContent || '')).includes('知道了')) { await b.click(); await sleep(300); break; }
      await page.click('[data-cal-view="week"]'); await sleep(900);
      const info = await page.$$eval('[data-week-block]', (els, done) => {
        const pick = (el) => {
          const line = el.querySelector('span');
          const label = el.querySelector('[data-week-label-mode]');
          const caps = [...el.querySelectorAll('[data-week-cap]')];
          return { line: getComputedStyle(line).backgroundColor, label: label ? getComputedStyle(label).color : '', cap: caps[0] ? getComputedStyle(caps[0]).backgroundColor : '', text: el.innerText };
        };
        const out = { done: null, others: [] };
        // 一个任务可能被拆成多段（跨天/按天画），每段的颜色本来就应该一样；
        // 所以带上 id，「彼此颜色不同」按**不同任务**判，而不是按 DOM 元素个数。
        for (const el of els) {
          if (el.dataset.weekBlock === done) out.done = pick(el);
          else out.others.push({ id: el.dataset.weekBlock, ...pick(el) });
        }
        return out;
      }, doneId);
      check('已完成任务仍有线段和标签', !!info.done?.line && !!info.done?.label, JSON.stringify(info.done));
      check('已完成线段统一灰色', info.done?.line === 'rgb(148, 163, 184)', info.done?.line);
      check('已完成标签统一灰色', info.done?.label === 'rgb(148, 163, 184)', info.done?.label);
      check('已完成横杠也是灰色', info.done?.cap === 'rgb(148, 163, 184)', info.done?.cap);
      check('未完成任务不是灰色', info.others.every(x => x.line !== 'rgb(148, 163, 184)'), JSON.stringify(info.others));
      const byTask = new Map(info.others.map((x) => [x.id, x.line]));
      check('未完成任务彼此颜色不同（同一任务的多段是同色）',
        byTask.size >= 2 && new Set(byTask.values()).size === byTask.size, JSON.stringify([...byTask]));
      await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-158-done-gray.png') });
    }, { width: 1440, height: 1000 });
  } finally {
    if (token) {
      for (const id of ids) await api(token, `/api/reminder/items/${id}`, 'DELETE').catch(() => {});
      if (listId) await api(token, `/api/reminder/lists/${listId}`, 'DELETE').catch(() => {});
    }
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
