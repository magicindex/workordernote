/**
 * 周视图唯一色：同一周内所有任务颜色不重复。
 * - 12 条任务，其中两条都显式选了 rose：不能出现两条同色。
 * - 其余自动配色也全部唯一；刷新后同周颜色保持不变。
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const ROOT = BASE;
const STAMP = String(Date.now()).slice(-7);
const LIST_NAME = `唯一色-${STAMP}`;

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
async function api(token, apiPath, method = 'GET', body = null) {
  const res = await fetch(ROOT + apiPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
      const list = await api(token, '/api/reminder/lists', 'POST', { name: LIST_NAME, color: 'blue', icon: 'list' });
      listId = Number(list.id);
      const today = await page.evaluate(() => {
        const d = new Date(); const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      });
      for (let i = 0; i < 12; i++) {
        const hh = String(9 + Math.floor(i / 6)).padStart(2, '0');
        const mm = String((i % 6) * 10).padStart(2, '0');
        const body = {
          title: `唯一色任务${i + 1}-${STAMP}`, kind: 'task', due_at: `${today}T${hh}:${mm}:00+08:00`,
          repeat_rule: 'none', channels: ['inapp'], list_id: listId,
          ...(i < 2 ? { color: 'rose' } : {}),
        };
        const item = await api(token, '/api/reminder/items', 'POST', body);
        ids.push(String(item.id));
      }
      await page.evaluate((id) => localStorage.setItem('ui_calendar_lists', JSON.stringify([id])), listId);
      await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(1600);
      for (const b of await page.$$('button')) {
        if ((await b.evaluate(el => el.textContent || '')).includes('知道了')) { await b.click(); await sleep(300); break; }
      }
      await page.click('[data-cal-view="week"]');
      await sleep(900);

      const readColors = () => page.$$eval('[data-week-block]', (blocks, ids) => {
        const out = {};
        for (const b of blocks) {
          const id = b.dataset.weekBlock;
          if (!ids.includes(id)) continue;
          const line = b.querySelector('span');
          if (line) out[id] = getComputedStyle(line).backgroundColor;
        }
        return out;
      }, ids);

      const first = await readColors();
      check('12 条任务都渲染出线段', Object.keys(first).length === 12, `got ${Object.keys(first).length}`);
      const colors = Object.values(first);
      check('一周内任务颜色全部唯一', new Set(colors).size === colors.length, colors.join(','));
      check('两条显式同色的任务也不再同色', first[ids[0]] !== first[ids[1]], `${first[ids[0]]} / ${first[ids[1]]}`);
      await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-157-unique-colors.png') });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1400);
      await page.click('[data-cal-view="week"]');
      await sleep(700);
      const second = await readColors();
      check('刷新后同一周颜色保持稳定', ids.every((id) => first[id] === second[id]), JSON.stringify({ first, second }));
    }, { width: 1440, height: 1000 });
  } finally {
    if (token) {
      for (const id of ids) await api(token, `/api/reminder/items/${id}`, 'DELETE').catch(() => {});
      if (listId) await api(token, `/api/reminder/lists/${listId}`, 'DELETE').catch(() => {});
    }
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
