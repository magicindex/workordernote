/** 左侧菜单栏跟随页面背景颜色/渐变（用户 2026-11-15）。 */
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
const configs = async (page) => (await api(page, '/api/configs')).body?.data || {};
const alpha = (rgba) => {
  const m = String(rgba).match(/rgba\([^)]*,\s*([\d.]+)\)$/);
  return m ? Number(m[1]) : 1;
};
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await configs(page);
    const originalMode = String(original.theme_mode || 'system');
    const originalOpacity = String(original.card_bg_opacity ?? '90');
    try {
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: JSON.stringify({ start: '#ffecd2', end: '#a18cd1', direction: 'diagonal', startStop: 0, endStop: 100 }) });
      // 0.48.2 起侧栏与卡片共用「卡片透明度」（默认 90%）；要验证「能看到页面渐变」，
      // 先把透明度调到 40%，否则 0.9 的侧栏本来就几乎挡住渐变（旧断言的 alpha<0.3 已过时）。
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: '40' });
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'light' });
      await page.evaluate(() => localStorage.setItem('reminder-theme-mode', 'light'));
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const light = await page.evaluate(() => {
        const sidebar = getComputedStyle(document.querySelector('.sidebar'));
        const group = getComputedStyle(document.querySelector('.nav-group'));
        return { sidebarBg: sidebar.backgroundColor, groupBg: group.backgroundColor, sidebarBlur: sidebar.backdropFilter, body: getComputedStyle(document.body).backgroundImage };
      });
      check('侧栏半透明（跟随 40% 的卡片透明度）、能看到页面渐变', alpha(light.sidebarBg) <= 0.45 && /linear-gradient/.test(light.body), JSON.stringify(light));
      check('侧栏分组也透出页面渐变', alpha(light.groupBg) <= 0.25, JSON.stringify(light));

      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'dark' });
      await page.evaluate(() => localStorage.setItem('reminder-theme-mode', 'dark'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const dark = await page.evaluate(() => ({
        sidebarBg: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
        groupBg: getComputedStyle(document.querySelector('.nav-group')).backgroundColor,
        body: getComputedStyle(document.body).backgroundImage,
      }));
      check('暗色主题下侧栏仍跟随渐变（0.45 以内、能看到渐变）', alpha(dark.sidebarBg) <= 0.45 && alpha(dark.groupBg) <= 0.25 && /linear-gradient/.test(dark.body), JSON.stringify(dark));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: originalMode });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: String(original.page_bg_gradient || '') });
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: originalOpacity });
      await page.evaluate((m) => localStorage.setItem('reminder-theme-mode', m), originalMode);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
