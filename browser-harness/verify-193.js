/** 页面背景变暗时，页面级标题/说明自动换成浅色（用户 2026-11-15）。 */
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
const read = (page) => page.evaluate(() => {
  const h1 = document.querySelector('h1');
  const eyebrow = document.querySelector('.page-on-bg-muted');
  return {
    darkClass: document.documentElement.classList.contains('page-bg-dark'),
    h1: h1 ? getComputedStyle(h1).color : '',
    eyebrow: eyebrow ? getComputedStyle(eyebrow).color : '',
    fg: getComputedStyle(document.documentElement).getPropertyValue('--page-fg').trim(),
    fgMuted: getComputedStyle(document.documentElement).getPropertyValue('--page-fg-muted').trim(),
    nav: (() => { const el = document.querySelector('.sidebar .nav-row'); return el ? getComputedStyle(el).color : ''; })(),
  };
});
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await configs(page);
    const mode = String(original.theme_mode || 'system');
    try {
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'light' });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: JSON.stringify({ start: '#0a2a6b', end: '#1a3a7a', direction: 'vertical', startStop: 0, endStop: 100 }) });
      await page.evaluate(() => localStorage.setItem('reminder-theme-mode', 'light'));
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await sleep(1600);
      const dark = await read(page);
      check('暗背景给页面加 page-bg-dark', dark.darkClass === true && dark.fg === '248 250 252', JSON.stringify(dark));
      check('标题与说明自动变浅色', dark.h1 === 'rgb(248, 250, 252)' && dark.eyebrow === 'rgb(203, 213, 225)', JSON.stringify(dark));
      check('侧栏导航文字也自动变浅', /248/.test(dark.nav) && !/24, 28, 36/.test(dark.nav), JSON.stringify(dark));

      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: JSON.stringify({ start: '#eef2ff', end: '#f8fafc', direction: 'vertical', startStop: 0, endStop: 100 }) });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const light = await read(page);
      check('亮背景恢复默认深色文字', light.darkClass === false && light.fg === '' && light.h1 !== 'rgb(248, 250, 252)', JSON.stringify(light));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: mode });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: String(original.page_bg_gradient || '') });
      await page.evaluate((m) => localStorage.setItem('reminder-theme-mode', m), mode);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
