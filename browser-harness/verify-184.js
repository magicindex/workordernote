/** 偏好设置 → 外观：背景亮度滑块，实时预览 + 松手保存，只影响页面背景（用户 2026-11-14）。 */
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
const tone = async (page) => Number((await api(page, '/api/configs')).body?.data?.page_bg_tone || 0);
const vars = (page) => page.evaluate(() => ({
  tint: getComputedStyle(document.documentElement).getPropertyValue('--page-bg-tint').trim(),
  alpha: Number(getComputedStyle(document.documentElement).getPropertyValue('--page-bg-alpha')),
  body: getComputedStyle(document.body).backgroundImage,
  cardBg: getComputedStyle(document.querySelector('.surface') || document.body).backgroundColor,
  cardColor: getComputedStyle(document.querySelector('.surface') || document.body).color,
}));
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await tone(page);
    try {
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1400);
      const before = await vars(page);
      const ui = await page.evaluate(() => ({
        block: !!document.querySelector('[data-page-bg-tone]'),
        slider: !!document.querySelector('[data-page-bg-tone-slider]'),
        value: document.querySelector('[data-page-bg-tone-slider]')?.value || '',
        label: (document.querySelector('[data-page-bg-tone-value]')?.textContent || '').trim(),
      }));
      check('外观里有背景亮度滑块', ui.block && ui.slider, JSON.stringify(ui));

      await page.evaluate(() => {
        const el = document.querySelector('[data-page-bg-tone-slider]');
        if (!el) return;
        el.value = '-60';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(250);
      const preview = await vars(page);
      const cfgBeforeSave = await tone(page);
      check('拖动时实时变暗（尚未保存）', preview.tint === '0 0 0' && preview.alpha > 0.3 && cfgBeforeSave === original, JSON.stringify({ preview, cfgBeforeSave, original }));
      check('只改页面背景，卡片底色/文字色不变', preview.cardBg === before.cardBg && preview.cardColor === before.cardColor, JSON.stringify({ before, preview }));

      await page.evaluate(() => {
        const el = document.querySelector('[data-page-bg-tone-slider]');
        if (!el) return;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(900);
      const saved = await tone(page);
      check('松手后保存 page_bg_tone', saved === -60, String(saved));

      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1400);
      const reloaded = await vars(page);
      const slider = await page.evaluate(() => ({
        value: document.querySelector('[data-page-bg-tone-slider]')?.value || '',
        label: (document.querySelector('[data-page-bg-tone-value]')?.textContent || '').trim(),
      }));
      check('刷新后仍保留背景亮度', slider.value === '-60' && reloaded.tint === '0 0 0' && reloaded.alpha > 0.3, JSON.stringify({ slider, reloaded }));

      await page.evaluate(() => document.querySelector('[data-page-bg-tone-reset]')?.click());
      await sleep(900);
      const reset = await tone(page);
      const resetVars = await vars(page);
      check('恢复默认回到 0', reset === 0 && resetVars.alpha === 0, JSON.stringify({ reset, resetVars }));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone', value: String(original) });
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
