/**
 * 编辑面板可切换左边 / 右边弹出，并按用户记住上次方向（用户 2026-11-14）。
 * 造一条自检记事，收尾删除；恢复测试前的方向缓存。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
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
    const savedSides = await page.evaluate(() => Object.fromEntries(
      Object.keys(localStorage).filter((k) => k.includes('editor_side')).map((k) => [k, localStorage.getItem(k)]),
    ));
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('editor_side')).forEach((k) => localStorage.removeItem(k)));
    const stamp = `SIDE${Date.now().toString(36)}`;
    let createdId = 0;
    const panelSide = () => page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const r = panel?.getBoundingClientRect();
      return {
        side: panel?.getAttribute('data-editor-side') || '',
        left: r?.left || 0,
        right: r?.right || 0,
        toggle: !!document.querySelector('[data-editor-side-toggle]'),
        current: document.querySelector('[data-editor-side-toggle]')?.getAttribute('data-editor-side-current') || '',
        stored: Object.keys(localStorage).filter((k) => k.includes('editor_side')).map((k) => localStorage.getItem(k)),
      };
    });
    const openRow = async (notebookId) => {
      await page.goto(`${BASE}/admin/list/${notebookId}`, { waitUntil: 'domcontentloaded' });
      await sleep(1700);
      await page.evaluate((s) => {
        const row = [...document.querySelectorAll('[data-reminder-row]')].find((el) => el.textContent.includes(s));
        row?.querySelector('button.min-w-0.flex-1')?.click();
      }, stamp);
      await sleep(750);
    };
    try {
      const notebook = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.template === 'notebook');
      const created = await api(page, '/api/reminder/items', 'POST', { title: stamp, kind: 'note', notes: '方向自检' });
      createdId = created.body?.data?.id || 0;
      check('新建一条自检记事', created.status === 200 && createdId > 0 && !!notebook, JSON.stringify(created.body).slice(0, 160));
      if (!notebook || !createdId) return;

      await openRow(notebook.id);
      const initial = await panelSide();
      check('面板从左边或右边弹出', initial.side === 'left' || initial.side === 'right', JSON.stringify(initial));
      check('弹出方向与面板位置一致',
        (initial.side === 'left' && initial.left < 20) || (initial.side === 'right' && initial.right > 1440 - 20), JSON.stringify(initial));
      check('标题栏有左/右切换按钮', initial.toggle === true, JSON.stringify(initial));

      // 用 DOM click 而不是坐标点击：生产库上可能正好有提醒弹窗盖住标题栏。
      await page.evaluate(() => document.querySelector('[data-editor-side-toggle]')?.click());
      await sleep(450);
      const toggled = await panelSide();
      check('点一下切到另一侧', toggled.side !== initial.side, `${initial.side} → ${toggled.side}`);
      check('切换后位置跟着变',
        (toggled.side === 'left' && toggled.left < 20) || (toggled.side === 'right' && toggled.right > 1440 - 20), JSON.stringify(toggled));
      check('方向已按用户写入本地缓存', toggled.stored.includes(toggled.side), JSON.stringify(toggled.stored));

      await page.evaluate(() => document.querySelector('[aria-label="关闭"]')?.click());
      await sleep(500);
      await openRow(notebook.id);
      const reopened = await panelSide();
      check('关闭再打开，仍保持上次方向', reopened.side === toggled.side, `${toggled.side} → ${reopened.side}`);
      check('重开后位置仍与方向一致',
        (reopened.side === 'left' && reopened.left < 20) || (reopened.side === 'right' && reopened.right > 1440 - 20), JSON.stringify(reopened));

      await page.evaluate(() => document.querySelector('[data-editor-side-toggle]')?.click());
      await sleep(450);
      const back = await panelSide();
      check('再点一下能切回原方向', back.side === initial.side, `${toggled.side} → ${back.side}`);
    } finally {
      if (createdId) await api(page, `/api/reminder/items/${createdId}`, 'DELETE');
      await page.evaluate((saved) => {
        Object.keys(localStorage).filter((k) => k.includes('editor_side')).forEach((k) => localStorage.removeItem(k));
        for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
      }, savedSides);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
