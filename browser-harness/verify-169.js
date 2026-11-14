/**
 * 记事 Markdown + 提醒频率「不重复」（用户 2026-11-14）：
 *   1) 新建/展示的记事内容支持 Markdown：加粗、列表、代码等渲染，而不是原始星号；
 *   2) 偏好设置「提醒频率」新增「不重复（只提醒一次）」选项，后端接受 0。
 *
 * 只造一条自检记事，收尾删除；提醒频率恢复原值。
 * 用法：APP_URL=http://127.0.0.1:8906 node verify-169.js
 */
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = `MDNOTE${Date.now().toString(36)}`;

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

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
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const cfg = (await api(page, '/api/configs')).body?.data || {};
    const originalNotify = String(cfg.reminder_notify_minutes ?? '10');
    let createdId = 0;
    try {
      // ---------- 1. 新建一条带 Markdown 的记事 ----------
      const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
      const notebook = lists.find((l) => l.template === 'notebook');
      const created = await api(page, '/api/reminder/items', 'POST', {
        title: `${STAMP} **加粗标题**`,
        notes: '**详情加粗**\n\n- 第一点\n- 第二点\n\n```js\nconst a = 1\n```',
        kind: 'note',
      });
      createdId = created.body?.data?.id || 0;
      check('新建一条记事（带 Markdown 内容）', created.status === 200 && createdId > 0, JSON.stringify(created.body).slice(0, 200));
      if (!notebook) {
        check('找到随手记事本栏目', false, '没有 template=notebook 的清单');
        return;
      }
      await page.goto(`${BASE}/admin/list/${notebook.id}`, { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      const rendered = await page.evaluate((stamp) => {
        const row = [...document.querySelectorAll('[data-reminder-row]')]
          .find((el) => (el.textContent || '').includes(stamp));
        const title = row?.querySelector('[data-note-title-markdown]');
        const body = row?.querySelector('[data-note-content-markdown]');
        return {
          found: !!row,
          titleHtml: title?.innerHTML || '',
          bodyHtml: body?.innerHTML || '',
          titleStrong: !!title?.querySelector('strong'),
          bodyStrong: !!body?.querySelector('strong'),
          bodyList: (body?.querySelectorAll('li') || []).length,
          bodyCode: !!body?.querySelector('pre code'),
          rawStars: (row?.textContent || '').includes('**'),
        };
      }, STAMP);
      console.log('  ' + JSON.stringify({ found: rendered.found, titleStrong: rendered.titleStrong, bodyStrong: rendered.bodyStrong, bodyList: rendered.bodyList, bodyCode: rendered.bodyCode }));
      check('记事本页能看到刚建的记事', rendered.found === true);
      check('记事标题的 **加粗** 渲染成 <strong>', rendered.titleStrong === true, rendered.titleHtml.slice(0, 120));
      check('记事详情的 **加粗** 渲染成 <strong>', rendered.bodyStrong === true, rendered.bodyHtml.slice(0, 120));
      check('记事详情的 - 列表渲染成 <li>（2 项）', rendered.bodyList === 2, String(rendered.bodyList));
      check('记事详情的代码块渲染成 <pre><code>', rendered.bodyCode === true);
      check('记事行里不再出现原始 ** 星号', rendered.rawStars === false);

      // ---------- 2. 提醒频率「不重复」选项 ----------
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1600);
      const selectShape = await page.evaluate(() => {
        const row = document.querySelector('[data-config-key="reminder_notify_minutes"]');
        if (!row) return null;
        return [...row.querySelectorAll('option')].map((o) => (o.textContent || '').trim());
      });
      check('偏好设置「提醒频率」有「不重复（只提醒一次）」',
        !!selectShape && selectShape.includes('不重复（只提醒一次）'), JSON.stringify(selectShape));
      const setZero = await api(page, '/api/configs', 'PUT', { key: 'reminder_notify_minutes', value: '0' });
      const after = (await api(page, '/api/configs')).body?.data || {};
      check('后端接受「不重复 = 0」并读回 0',
        setZero.body?.code === 0 && String(after.reminder_notify_minutes) === '0', JSON.stringify(after.reminder_notify_minutes));
    } finally {
      if (createdId) await api(page, `/api/reminder/items/${createdId}`, 'DELETE');
      await api(page, '/api/configs', 'PUT', { key: 'reminder_notify_minutes', value: originalNotify || '10' });
    }
  }, { width: 1440, height: 1000 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('出错:', err && err.message ? err.message : err);
  process.exit(1);
});
