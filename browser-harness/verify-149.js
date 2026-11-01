/**
 * 验证周视图的「任务颜色 / 今天标记 / 星期行」：
 *   1) 去掉重复的「一 二 三…」行，只保留「周一 10/26」日期头
 *   2) 今天日期头有色块「今天」
 *   3) 标题文字与线段同色；自定义颜色可保存并在重新加载后生效
 *   4) 不同任务颜色不同
 *
 * 用法：APP_URL=http://127.0.0.1:8919 node verify-149.js
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
const STAMP = Date.now();
const LIST_NAME = `周颜色自检-${STAMP}`;
let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
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
  let token = '';
  let listId = 0;
  const ids = [];
  try {
    await withTab(async (page) => {
      await login(page, BASE);
      token = await page.evaluate(() => localStorage.getItem('reminders.token') || '');
      const list = await api(token, '/api/reminder/lists', 'POST', { name: LIST_NAME, color: 'blue', icon: 'list' });
      listId = Number(list.id);
      const today = await page.evaluate(() => {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      });
      const mk = async (title, hour, color) => {
        const body = {
          title, kind: 'task', due_at: `${today}T${hour}:00:00+08:00`, repeat_rule: 'none',
          channels: ['inapp'], list_id: listId, color,
        };
        const item = await api(token, '/api/reminder/items', 'POST', body);
        ids.push(String(item.id));
        return String(item.id);
      };
      const idA = await mk(`紫任务-${STAMP}`, '10', 'violet');
      await mk(`玫任务-${STAMP}`, '11', 'rose');
      await mk(`绿任务-${STAMP}`, '12', 'emerald');
      await page.evaluate((id) => localStorage.setItem('ui_calendar_lists', JSON.stringify([id])), listId);
      await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      // 201 上可能弹出到点提醒，先关掉再切周视图，否则点击被遮罩拦住。
      for (const b of await page.$$('button')) {
        if ((await b.evaluate(el => el.textContent || '')).includes('知道了')) { await b.click(); await sleep(300); break; }
      }
      await page.click('[data-cal-view="week"]');
      await sleep(800);

      check('周视图没有重复的星期行', !(await page.$('[data-cal-weekdays]')));
      const marks = await page.$$eval('[data-week-today-mark]', els => els.map(e => e.textContent.trim()));
      check('今天日期头有色块标记', marks.length === 1 && marks[0] === '今天', marks.join(','));

      const readBlocks = () => page.$$eval('[data-week-block]', els => els.map(e => {
        const label = e.querySelector('[data-week-label-mode]');
        if (!label) return null;
        const line = e.querySelector('span');
        return { id: e.dataset.weekBlock, line: getComputedStyle(line).backgroundColor, title: getComputedStyle(label).color, text: label.textContent };
      }).filter(Boolean));
      const before = await readBlocks();
      check('三条任务都在周视图里', before.length >= 3, String(before.length));
      const lineColors = new Set(before.map(b => b.line));
      check('不同任务使用不同颜色', lineColors.size >= 3, [...lineColors].join(','));
      check('标题与线段颜色一致', before.every(b => b.line === b.title), JSON.stringify(before.map(b => [b.line, b.title])));

      // 双击打开编辑器，把第一条改成蓝色，保存后色块应更新。
      const block = await page.$(`[data-week-block="${idA}"]`);
      await block.click({ clickCount: 2 });
      await sleep(700);
      check('编辑器有颜色选择', !!(await page.$('[data-editor-color="rose"]')));
      await page.click('[data-editor-color="blue"]');
      const btns = await page.$$('button');
      for (const b of btns) {
        const txt = await b.evaluate(el => el.textContent || '');
        if (txt.includes('保存提醒')) { await b.click(); break; }
      }
      await sleep(1200);
      const after = await readBlocks();
      const changed = after.find(b => b.id === idA);
      const blue = 'rgb(49, 130, 246)';
      check('保存后线段改为蓝色', changed?.line === blue, changed?.line || 'missing');
      check('保存后标题同步改色', changed?.title === blue, changed?.title || 'missing');
      const saved = await api(token, '/api/reminder/items/' + idA);
      check('颜色已写入接口', saved.color === 'blue', String(saved.color));

      await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-149-week-color.png') });
      await page.click('[data-cal-view="month"]');
      await sleep(500);
      check('月视图仍保留星期行', !!(await page.$('[data-cal-weekdays]')));
    });
  } finally {
    if (token && ids.length) for (const id of ids) await api(token, `/api/reminder/items/${id}`, 'DELETE').catch(() => {});
    if (token && listId) await api(token, `/api/reminder/lists/${listId}`, 'DELETE').catch(() => {});
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
