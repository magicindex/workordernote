/** AI 入口样式回到「偏好设置 → 更多 → AI 提示词」（用户 2026-11-14）。 */
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
    const original = String(((await api(page, '/api/configs')).body?.data || {}).assistant_entry_style || 'topbar');
    try {
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const common = await page.evaluate(() => !!document.querySelector('[data-config-key="assistant_entry_style"]'));
      check('常用 → 外观里不再重复出现 AI 入口样式', common === false, String(common));
      await page.click('[data-settings-tab="more"]');
      await sleep(500);
      const shape = await page.evaluate(() => {
        const sel = document.querySelector('[data-ai-entry-style-select]');
        return {
          block: !!document.querySelector('[data-ai-entry-style]'),
          select: !!sel,
          value: sel?.value || '',
          options: sel ? [...sel.querySelectorAll('option')].map((o) => (o.textContent || '').trim()) : [],
        };
      });
      check('更多 → AI 提示词里有 AI 入口样式', shape.block && shape.select, JSON.stringify(shape));
      check('选项是顶栏图标 / 悬浮球', shape.options.some((t) => t.includes('顶栏图标')) && shape.options.some((t) => t.includes('悬浮球')), JSON.stringify(shape.options));

      const next = original === 'floating' ? 'topbar' : 'floating';
      await page.evaluate((v) => {
        const sel = document.querySelector('[data-ai-entry-style-select]');
        if (!sel) return;
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, next);
      await sleep(900);
      const after = (await api(page, '/api/configs')).body?.data || {};
      check('切换后按用户保存到 assistant_entry_style', String(after.assistant_entry_style) === next, `${original} → ${after.assistant_entry_style}`);
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'assistant_entry_style', value: original });
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
