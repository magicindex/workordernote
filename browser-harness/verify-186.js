/** 亮色/暗色主题分别记住自己的背景亮度，切主题自动切换（用户 2026-11-15）。 */
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
const slider = (page) => page.evaluate(() => ({
  value: document.querySelector('[data-page-bg-tone-slider]')?.value || '',
  label: (document.querySelector('[data-page-bg-tone-value]')?.textContent || '').trim(),
  dark: document.documentElement.classList.contains('dark'),
}));
const dragTone = async (page, value) => {
  await page.evaluate((v) => {
    const el = document.querySelector('[data-page-bg-tone-slider]');
    if (!el) return;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await sleep(900);
};
const switchTheme = async (page, mode) => {
  await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: mode });
  await page.evaluate((m) => localStorage.setItem('reminder-theme-mode', m), mode);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1500);
};
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await configs(page);
    const originalMode = String(original.theme_mode || 'system');
    try {
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone_light', value: '' });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone_dark', value: '' });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone', value: '' });
      await switchTheme(page, 'light');
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1300);
      const light0 = await slider(page);
      check('亮色主题默认亮度为 0', light0.dark === false && light0.value === '0' && /亮色主题/.test(light0.label), JSON.stringify(light0));

      await dragTone(page, -40);
      let cfg = await configs(page);
      check('亮色手动值只写亮色主题', cfg.page_bg_tone_light === '-40', JSON.stringify(cfg));

      await switchTheme(page, 'dark');
      const dark0 = await slider(page);
      check('切到暗色自动用暗色默认 -20', dark0.dark === true && dark0.value === '-20' && /暗色主题/.test(dark0.label), JSON.stringify(dark0));

      await dragTone(page, -70);
      cfg = await configs(page);
      check('暗色手动值只写暗色主题', cfg.page_bg_tone_dark === '-70' && cfg.page_bg_tone_light === '-40', JSON.stringify(cfg));

      await switchTheme(page, 'light');
      const lightBack = await slider(page);
      check('切回亮色恢复 -40，不被暗色覆盖', lightBack.value === '-40', JSON.stringify(lightBack));

      await switchTheme(page, 'dark');
      const darkBack = await slider(page);
      check('再切暗色恢复 -70', darkBack.value === '-70', JSON.stringify(darkBack));

      await page.evaluate(() => document.querySelector('[data-page-bg-tone-reset]')?.click());
      await sleep(1500);
      const darkReset = await slider(page);
      cfg = await configs(page);
      check('暗色恢复默认只重置暗色', darkReset.value === '-20' && cfg.page_bg_tone_dark === '-20' && cfg.page_bg_tone_light === '-40', JSON.stringify({ darkReset, cfg }));

      await switchTheme(page, 'light');
      await page.evaluate(() => document.querySelector('[data-page-bg-tone-reset]')?.click());
      await sleep(1500);
      const lightReset = await slider(page);
      cfg = await configs(page);
      check('亮色恢复默认只重置亮色', lightReset.value === '0' && cfg.page_bg_tone_light === '0' && cfg.page_bg_tone_dark === '-20', JSON.stringify({ lightReset, cfg }));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone_light', value: String(original.page_bg_tone_light ?? '') });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone_dark', value: String(original.page_bg_tone_dark ?? '') });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone', value: String(original.page_bg_tone ?? '') });
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: originalMode });
      await page.evaluate((m) => localStorage.setItem('reminder-theme-mode', m), originalMode);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
