/** 暗色模式下页面背景渐变仍可见，并按主题压暗/收窄对比（用户 2026-11-15）。 */
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
const gradientCss = (page) => page.evaluate(() => ({
  dark: document.documentElement.classList.contains('dark'),
  start: getComputedStyle(document.documentElement).getPropertyValue('--page-bg-start').trim(),
  end: getComputedStyle(document.documentElement).getPropertyValue('--page-bg-end').trim(),
  body: getComputedStyle(document.body).backgroundImage,
  ambient: getComputedStyle(document.querySelector('.ambient') || document.body).backgroundColor,
}));
const sum = (s) => s.split(/\s+/).reduce((a, n) => a + Number(n || 0), 0);
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await configs(page);
    const originalMode = await page.evaluate(() => localStorage.getItem('reminder-theme-mode') || 'system');
    try {
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: JSON.stringify({ start: '#ff0000', end: '#0000ff', direction: 'diagonal', startStop: 0, endStop: 100 }) });
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'dark' });
      await page.evaluate(() => localStorage.setItem('reminder-theme-mode', 'dark'));
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      const dark = await gradientCss(page);
      check('暗色模式已启用', dark.dark === true, JSON.stringify(dark));
      check('暗色下渐变仍然渲染且不被 ambient 遮住', /linear-gradient/.test(dark.body) && /135deg/.test(dark.body) && (dark.ambient === 'rgba(0, 0, 0, 0)' || dark.ambient === 'transparent'), JSON.stringify(dark));
      check('暗色下自动压暗渐变颜色', dark.start !== '255 0 0' && dark.end !== '0 0 255' && sum(dark.start) < 255 && sum(dark.end) < 255, JSON.stringify(dark));
      check('暗色下起始色/结束色仍有可见明暗差', Math.abs(sum(dark.start) - sum(dark.end)) >= 60, JSON.stringify(dark));

      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'light' });
      await page.evaluate(() => localStorage.setItem('reminder-theme-mode', 'light'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1600);
      const light = await gradientCss(page);
      check('切回亮色恢复用户原始渐变颜色', light.dark === false && light.start === '255 0 0' && light.end === '0 0 255', JSON.stringify(light));
    } finally {
      await page.evaluate((mode) => localStorage.setItem('reminder-theme-mode', mode), originalMode);
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: String(original.theme_mode || 'system') });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: String(original.page_bg_gradient || '') });
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
