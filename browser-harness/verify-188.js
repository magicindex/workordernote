/** 日历卡片/日格与页面背景的对比度（用户 2026-11-15）。 */
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
const alphaOf = (color) => {
  const m = String(color).match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
  return m ? Number(m[1]) : 1;
};
const styles = (page) => page.evaluate(() => {
  const card = document.querySelector('.cal-surface');
  const cell = [...document.querySelectorAll('.cal-cell')].find((el) => !String(el.className).includes('opacity-45')) || document.querySelector('.cal-cell');
  const cs = card ? getComputedStyle(card) : null;
  const cellStyle = cell ? getComputedStyle(cell) : null;
  const body = getComputedStyle(document.body).backgroundImage;
  return {
    cardBg: cs?.backgroundColor || '',
    cardBorder: cs?.borderColor || '',
    cardRadius: cs?.borderTopLeftRadius || '',
    cellBg: cellStyle?.backgroundColor || '',
    cellBorder: cellStyle?.borderColor || '',
    body,
    dark: document.documentElement.classList.contains('dark'),
  };
});
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await (await api(page, '/api/configs')).body?.data || {};
    const mode = String(original.theme_mode || 'system');
    try {
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: JSON.stringify({ start: '#ffecd2', end: '#a18cd1', direction: 'diagonal', startStop: 0, endStop: 100 }) });
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'light' });
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(1700);
      const light = await styles(page);
      check('日历主卡使用高不透明度 surface，边界清楚', light.cardBg.startsWith('rgb(') && alphaOf(light.cardBg) >= 0.85 && light.cardBorder !== 'rgba(0, 0, 0, 0)', JSON.stringify(light));
      check('日格使用高不透明度 surface，不再透成背景', alphaOf(light.cellBg) >= 0.85, JSON.stringify(light));
      await page.screenshot({ path: require('path').join(__dirname, 'shots', 'calendar-contrast-light.png') });

      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'dark' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1700);
      const dark = await styles(page);
      check('暗色下日历主卡/日格仍保持高不透明度', dark.dark && alphaOf(dark.cardBg) >= 0.85 && alphaOf(dark.cellBg) >= 0.85, JSON.stringify(dark));
      check('暗色下边框可见', dark.cardBorder !== 'rgba(0, 0, 0, 0)' && dark.cellBorder !== 'rgba(0, 0, 0, 0)', JSON.stringify(dark));
      await page.screenshot({ path: require('path').join(__dirname, 'shots', 'calendar-contrast-dark.png') });
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: mode });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: String(original.page_bg_gradient || '') });
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
