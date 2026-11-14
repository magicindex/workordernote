/**
 * 编辑提醒面板拉边框改宽高、记住尺寸，且拖动只改面板不改按钮尺寸（用户 2026-11-14）。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const { editorInfo, dragWidth, dragBottom } = require('./editor-resize');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const savedSizes = await page.evaluate(() => Object.fromEntries(
      Object.keys(localStorage).filter((k) => k.includes('reminder_editor_size')).map((k) => [k, localStorage.getItem(k)]),
    ));
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('reminder_editor_size')).forEach((k) => localStorage.removeItem(k)));
    const stamp = `TASKSIZE${Date.now().toString(36)}`;
    let createdId = 0;
    try {
      const normal = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.template === 'general');
      const created = await api(page, '/api/reminder/items', 'POST', {
        title: stamp, kind: 'task', due_at: new Date().toISOString(),
        repeat_rule: 'none', channels: ['inapp'], list_id: normal?.id,
      });
      createdId = created.body?.data?.id || 0;
      check('新建一条自检任务', created.status === 200 && createdId > 0 && !!normal, JSON.stringify(created.body).slice(0, 160));
      if (!normal || !createdId) return;

      await page.goto(`${BASE}/admin/list/${normal.id}`, { waitUntil: 'domcontentloaded' });
      await sleep(1700);
      const openRow = async () => {
        await page.evaluate((s) => {
          const row = [...document.querySelectorAll('[data-reminder-row]')].find((el) => el.textContent.includes(s));
          row?.querySelector('button.min-w-0.flex-1')?.click();
        }, stamp);
        await sleep(750);
      };

      await openRow();
      const before = await editorInfo(page);
      check('编辑提醒面板打开', before.panel === true, before.title);
      check('边框外侧有透明拖拽区', before.edges.length >= 2, JSON.stringify(before.edges.map((e) => e.edge)));
      check('没有浮在右下角的可见手柄', before.floatingHandle === false);
      check('没拖过时用默认 510px 宽', Math.abs(before.w - 510) <= 2, String(before.w));

      await dragWidth(page, before, 120);
      const afterWidth = await editorInfo(page);
      check('宽度增加约 120px', afterWidth.w > before.w + 90, `${before.w} → ${afterWidth.w}`);
      await dragBottom(page, afterWidth, -100);
      const after = await editorInfo(page);
      check('向上拖底边后高度减少约 100px', after.h < afterWidth.h - 70, `${afterWidth.h} → ${after.h}`);
      check('拖动只改面板，底部按钮尺寸不变',
        JSON.stringify(after.btns) === JSON.stringify(before.btns), `${JSON.stringify(before.btns)} → ${JSON.stringify(after.btns)}`);
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('reminder_editor_size')).map((k) => localStorage.getItem(k)));
      check('尺寸已按用户写入提醒缓存', stored.some((raw) => /"w":\d+/.test(String(raw)) && /"h":\d+/.test(String(raw))), JSON.stringify(stored));

      await page.evaluate(() => document.querySelector('[aria-label="关闭"]')?.click());
      await sleep(500);
      await openRow();
      const reopened = await editorInfo(page);
      check('关闭再打开同一条提醒，宽度保持', Math.abs(reopened.w - after.w) <= 3, `${after.w} → ${reopened.w}`);
      check('关闭再打开同一条提醒，高度保持', Math.abs(reopened.h - after.h) <= 3, `${after.h} → ${reopened.h}`);
    } finally {
      if (createdId) await api(page, `/api/reminder/items/${createdId}`, 'DELETE');
      await page.evaluate((saved) => {
        Object.keys(localStorage).filter((k) => k.includes('reminder_editor_size')).forEach((k) => localStorage.removeItem(k));
        for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
      }, savedSizes);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
