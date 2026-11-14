/**
 * 编辑提醒面板同样可拖拽宽高、记住尺寸，且拖动只改面板、不改按钮尺寸（用户 2026-11-14）。
 * 造一条自检任务，收尾删除；恢复测试前的尺寸缓存。
 * 用法：APP_URL=http://127.0.0.1:8906 node verify-172.js
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
    const savedSizes = await page.evaluate(() => Object.fromEntries(
      Object.keys(localStorage).filter((k) => k.includes('reminder_editor_size')).map((k) => [k, localStorage.getItem(k)]),
    ));
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('reminder_editor_size')).forEach((k) => localStorage.removeItem(k)));
    const stamp = `TASKSIZE${Date.now().toString(36)}`;
    let createdId = 0;
    try {
      const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
      const normal = lists.find((l) => l.template === 'general');
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
          // 任务的第一个可用按钮是「完成」圆扣；编辑入口是标题那一条 button.min-w-0.flex-1
          row?.querySelector('button.min-w-0.flex-1')?.click();
        }, stamp);
        await sleep(750);
      };
      const rect = () => page.evaluate(() => {
        const panel = document.querySelector('.editor-panel');
        const r = panel?.getBoundingClientRect();
        const handle = document.querySelector('[data-note-resize-handle]');
        const hr = handle?.getBoundingClientRect();
        return {
          panel: !!panel, w: r?.width || 0, h: r?.height || 0, handle: !!handle,
          hx: hr ? hr.x + hr.width / 2 : 0, hy: hr ? hr.y + hr.height / 2 : 0,
          btns: [...document.querySelectorAll('.editor-footer button')].map((b) => Math.round(b.getBoundingClientRect().width)),
        };
      });

      await openRow();
      const before = await rect();
      check('编辑提醒面板打开', before.panel === true,
        await page.evaluate(() => document.querySelector('.editor-panel h2')?.textContent || ''));
      check('提醒面板右下角有拖拽手柄', before.handle === true);
      check('没拖过时用默认 510px 宽', Math.abs(before.w - 510) <= 2, String(before.w));

      await page.mouse.move(before.hx, before.hy);
      await page.mouse.down();
      await page.mouse.move(before.hx + 120, before.hy - 100, { steps: 12 });
      await page.mouse.up();
      await sleep(450);
      const after = await rect();
      check('向右拖后宽度增加约 120px', after.w > before.w + 90, `${before.w} → ${after.w}`);
      check('向上拖后高度减少约 100px', after.h < before.h - 70, `${before.h} → ${after.h}`);
      check('拖动只改面板，底部按钮尺寸不变',
        JSON.stringify(after.btns) === JSON.stringify(before.btns), `${JSON.stringify(before.btns)} → ${JSON.stringify(after.btns)}`);
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('reminder_editor_size')).map((k) => localStorage.getItem(k)));
      check('尺寸已按用户写入提醒缓存', stored.some((raw) => /"w":\d+/.test(String(raw)) && /"h":\d+/.test(String(raw))), JSON.stringify(stored));

      await page.evaluate(() => document.querySelector('[aria-label="关闭"]')?.click());
      await sleep(500);
      await openRow();
      const reopened = await rect();
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
