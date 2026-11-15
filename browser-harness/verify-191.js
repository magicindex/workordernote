/** 星空背景预设：亮/暗各一套，固定星点，无动画（用户 2026-11-15）。 */
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
const stars = (page) => page.evaluate(() => {
  const el = document.querySelector('.page-stars');
  const cs = el ? getComputedStyle(el) : null;
  const root = getComputedStyle(document.documentElement);
  return {
    class: document.documentElement.classList.contains('page-starry'),
    dark: document.documentElement.classList.contains('dark'),
    opacity: Number(cs?.opacity || 0),
    animation: cs?.animationName || '',
    position: cs?.position || '',
    zIndex: cs?.zIndex || '',
    image: cs?.backgroundImage || '',
    start: root.getPropertyValue('--page-bg-start').trim(),
    end: root.getPropertyValue('--page-bg-end').trim(),
  };
});
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await configs(page);
    const originalMode = String(original.theme_mode || 'system');
    try {
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const buttons = await page.evaluate(() => [...document.querySelectorAll('[data-page-bg-preset]')].map((el) => el.getAttribute('data-page-bg-preset')));
      check('渐变预设里有「星空」', buttons.includes('starry'), JSON.stringify(buttons));
      await page.evaluate(() => document.querySelector('[data-page-bg-preset="starry"]')?.click());
      await sleep(1100);
      const light = await stars(page);
      const cfg = JSON.parse(String((await configs(page)).page_bg_gradient || '{}'));
      check('套用星空后启用星点层', light.class === true && light.opacity > 0.2 && /data:image\/svg/.test(light.image), JSON.stringify(light));
      check('星点固定且无动画', light.position === 'fixed' && light.animation === 'none' && Number(light.zIndex) < 0, JSON.stringify(light));
      check('星空配置已保存', cfg.preset === 'starry', JSON.stringify(cfg));

      await page.select('[data-page-bg-star-style]', 'cross');
      await sleep(700);
      const cross = await page.evaluate(() => ({
        cls: document.documentElement.classList.contains('page-starry-cross'),
        image: getComputedStyle(document.querySelector('.page-stars')).backgroundImage,
      }));
      const crossCfg = JSON.parse(String((await configs(page)).page_bg_gradient || '{}'));
      check('星点样式可选十字星', cross.cls === true && crossCfg.starStyle === 'cross' && /svg/.test(cross.image), JSON.stringify({ cross, crossCfg }));
      await page.select('[data-page-bg-star-style]', 'sparkle');
      await sleep(700);
      const sparkle = await page.evaluate(() => ({
        cls: document.documentElement.classList.contains('page-starry-sparkle'),
        image: getComputedStyle(document.querySelector('.page-stars')).backgroundImage,
        animation: getComputedStyle(document.querySelector('.page-stars')).animationName,
      }));
      const sparkleCfg = JSON.parse(String((await configs(page)).page_bg_gradient || '{}'));
      check('星点样式可选星芒且仍无动画', sparkle.cls === true && sparkleCfg.starStyle === 'sparkle' && /svg/.test(sparkle.image) && sparkle.animation === 'none', JSON.stringify({ sparkle, sparkleCfg }));
      check('亮色主题使用深蓝色板', light.start === '7 20 40' && light.end === '18 42 76', JSON.stringify(light));

      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'dark' });
      await page.evaluate(() => localStorage.setItem('reminder-theme-mode', 'dark'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const dark = await stars(page);
      check('暗色主题自动换成深空色板', dark.dark === true && dark.start === '2 6 23' && dark.end === '11 27 58', JSON.stringify(dark));
      check('暗色星点更明显且仍无动画', dark.opacity >= 0.85 && dark.animation === 'none', JSON.stringify(dark));
      await page.screenshot({ path: require('path').join(__dirname, 'shots', 'bg-starry-dark.png') });
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: originalMode });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: String(original.page_bg_gradient || '') });
      await page.evaluate((m) => localStorage.setItem('reminder-theme-mode', m), originalMode);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
