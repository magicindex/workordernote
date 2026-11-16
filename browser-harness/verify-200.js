/** 页面背景下方增加「卡片背景透明度」滑块：0–100% 实时预览并保存。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return await res.json().catch(() => null);
}, { base: BASE, p, method, body });
const setRange = (page, selector, value) => page.evaluate(({ selector, value }) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, { selector, value });
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1360, height: 1000 });
    await login(page, BASE);
    const cfg = (await api(page, '/api/configs')).data || {};
    const old = cfg.card_bg_opacity !== undefined ? String(cfg.card_bg_opacity) : '90';
    try {
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      await page.evaluate(() => document.querySelector('[data-settings-tab="common"]')?.click());
      await sleep(600);
      const init = await page.evaluate(() => ({
        slider: !!document.querySelector('[data-card-bg-opacity-slider]'),
        min: document.querySelector('[data-card-bg-opacity-slider]')?.getAttribute('min'),
        max: document.querySelector('[data-card-bg-opacity-slider]')?.getAttribute('max'),
        value: document.querySelector('[data-card-bg-opacity-value]')?.textContent?.trim(),
      }));
      check('页面背景下方有卡片透明度滑块', init.slider && init.min === '0' && init.max === '100', JSON.stringify(init));

      await setRange(page, '[data-card-bg-opacity-slider]', 55);
      await sleep(900);
      const preview = await page.evaluate(() => ({
        label: document.querySelector('[data-card-bg-opacity-value]')?.textContent?.trim(),
        cssVar: getComputedStyle(document.documentElement).getPropertyValue('--card-bg-opacity').trim(),
        surface: getComputedStyle(document.querySelector('.surface')).backgroundColor,
      }));
      check('拖到 55% 实时预览', preview.label === '55%' && preview.cssVar === '0.55' && /0\.55/.test(preview.surface), JSON.stringify(preview));
      const saved = (await api(page, '/api/configs')).data || {};
      check('透明度已保存到偏好设置', String(saved.card_bg_opacity) === '55', String(saved.card_bg_opacity));

      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1300);
      await page.evaluate(() => document.querySelector('[data-settings-tab="common"]')?.click());
      await sleep(500);
      const reloaded = await page.evaluate(() => ({
        input: document.querySelector('[data-card-bg-opacity-slider]')?.value,
        label: document.querySelector('[data-card-bg-opacity-value]')?.textContent?.trim(),
      }));
      check('刷新后仍保持 55%', reloaded.input === '55' && reloaded.label === '55%', JSON.stringify(reloaded));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: old });
    }
  }, { width: 1360, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
