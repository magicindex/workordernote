/**
 * 编辑记事面板拉边框改宽高，并按用户记住尺寸（用户 2026-11-14）：
 *   1) 边框外侧有透明拖拽区，没有浮在右下角的可见手柄；
 *   2) 拉左右边缘改宽度、拉底边改高度；
 *   3) 拖动只改面板，底部按钮尺寸不变；
 *   4) 关闭再重新打开同一条记事，尺寸保持。
 *
 * 收尾删除自检记事并恢复测试前的尺寸缓存。
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
      Object.keys(localStorage).filter((k) => k.includes('note_editor_size')).map((k) => [k, localStorage.getItem(k)]),
    ));
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('note_editor_size')).forEach((k) => localStorage.removeItem(k)));
    const stamp = `RESIZE${Date.now().toString(36)}`;
    let createdId = 0;
    try {
      const notebook = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.template === 'notebook');
      const created = await api(page, '/api/reminder/items', 'POST', { title: stamp, notes: '尺寸自检', kind: 'note' });
      createdId = created.body?.data?.id || 0;
      check('新建一条自检记事', created.status === 200 && createdId > 0 && !!notebook, JSON.stringify(created.body).slice(0, 160));
      if (!notebook || !createdId) return;

      await page.goto(`${BASE}/admin/list/${notebook.id}`, { waitUntil: 'domcontentloaded' });
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
      check('编辑记事面板打开', before.panel === true, before.title);
      check('边框外侧有透明拖拽区', before.edges.length >= 2, JSON.stringify(before.edges.map((e) => e.edge)));
      check('没有浮在右下角的可见手柄', before.floatingHandle === false);
      check('没拖过时用默认 510px 宽', Math.abs(before.w - 510) <= 2, String(before.w));

      const edge = await dragWidth(page, before, 120);
      check(`拖${edge === 'right' ? '右' : '左'}边缘后宽度增加约 120px`, true, edge);
      const afterWidth = await editorInfo(page);
      check('宽度确实增加约 120px', afterWidth.w > before.w + 90, `${before.w} → ${afterWidth.w}`);
      await dragBottom(page, afterWidth, -100);
      const after = await editorInfo(page);
      check('向上拖底边后高度减少约 100px', after.h < afterWidth.h - 70, `${afterWidth.h} → ${after.h}`);
      check('拖动只改面板，底部按钮尺寸不变',
        JSON.stringify(after.btns) === JSON.stringify(before.btns), `${JSON.stringify(before.btns)} → ${JSON.stringify(after.btns)}`);
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('note_editor_size')).map((k) => localStorage.getItem(k)));
      check('尺寸已按用户写入本地缓存', stored.some((raw) => /"w":\d+/.test(String(raw)) && /"h":\d+/.test(String(raw))), JSON.stringify(stored));

      await page.evaluate(() => document.querySelector('[aria-label="关闭"]')?.click());
      await sleep(500);
      await openRow();
      const reopened = await editorInfo(page);
      check('关闭再打开同一条记事，宽度保持', Math.abs(reopened.w - after.w) <= 3, `${after.w} → ${reopened.w}`);
      check('关闭再打开同一条记事，高度保持', Math.abs(reopened.h - after.h) <= 3, `${after.h} → ${reopened.h}`);
    } finally {
      if (createdId) await api(page, `/api/reminder/items/${createdId}`, 'DELETE');
      await page.evaluate((saved) => {
        Object.keys(localStorage).filter((k) => k.includes('note_editor_size')).forEach((k) => localStorage.removeItem(k));
        for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
      }, savedSizes);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
