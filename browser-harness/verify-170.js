/**
 * 「任务过期多久算逾期」迁到个人偏好（用户 2026-11-14）：
 *   - 系统配置页不再显示；
 *   - 偏好设置 → 提醒 里有「任务过期多久算逾期」，选项中文；
 *   - 按用户保存，后端接受 0 = 立即算逾期。
 * 收尾恢复原值。
 * 用法：APP_URL=http://127.0.0.1:8906 node verify-170.js
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
    const original = String(((await api(page, '/api/configs')).body?.data || {}).task_overdue_after_minutes ?? '30');
    try {
      await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded' });
      await sleep(1600);
      check('系统配置里不再有「任务过期多久算逾期」',
        (await page.evaluate(() => !!document.querySelector('[data-config-key="task_overdue_after_minutes"]'))) === false);

      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      const shape = await page.evaluate(() => {
        const row = document.querySelector('[data-config-key="task_overdue_after_minutes"]');
        return {
          exists: !!row,
          options: [...(row?.querySelectorAll('option') || [])].map((o) => (o.textContent || '').trim()),
        };
      });
      check('偏好设置 → 提醒 里有「任务过期多久算逾期」', shape.exists === true, JSON.stringify(shape));
      check('选项显示中文（立即 / 30 分钟 / 1 小时）',
        shape.options.includes('立即') && shape.options.includes('30 分钟') && shape.options.includes('1 小时'),
        JSON.stringify(shape.options));

      const save = await api(page, '/api/configs', 'PUT', { key: 'task_overdue_after_minutes', value: '0' });
      const after = (await api(page, '/api/configs')).body?.data || {};
      check('按用户保存：后端接受 0（立即算逾期）并读回 0',
        save.body?.code === 0 && String(after.task_overdue_after_minutes) === '0', JSON.stringify(after.task_overdue_after_minutes));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'task_overdue_after_minutes', value: original || '30' });
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
