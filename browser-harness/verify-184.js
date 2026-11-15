/** 偏好设置 → 外观：页面背景两色渐变 + 方向 + 亮度滑块，实时预览、松手保存（用户 2026-11-15）。 */
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
const vars = (page) => page.evaluate(() => ({
  start: getComputedStyle(document.documentElement).getPropertyValue('--page-bg-start').trim(),
  end: getComputedStyle(document.documentElement).getPropertyValue('--page-bg-end').trim(),
  angle: getComputedStyle(document.documentElement).getPropertyValue('--page-bg-angle').trim(),
  startStop: getComputedStyle(document.documentElement).getPropertyValue('--page-bg-start-stop').trim(),
  endStop: getComputedStyle(document.documentElement).getPropertyValue('--page-bg-end-stop').trim(),
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
    const original = await configs(page);
    try {
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1400);
      const before = await vars(page);
      const ui = await page.evaluate(() => ({
        block: !!document.querySelector('[data-page-bg-tone]'),
        slider: !!document.querySelector('[data-page-bg-tone-slider]'),
        start: !!document.querySelector('[data-page-bg-color-start]'),
        end: !!document.querySelector('[data-page-bg-color-end]'),
        direction: !!document.querySelector('[data-page-bg-direction]'),
        stops: document.querySelectorAll('[data-page-bg-stop]').length,
      }));
      check('外观里有背景两色、方向、色阶、亮度控件', ui.block && ui.slider && ui.start && ui.end && ui.direction && ui.stops === 2, JSON.stringify(ui));
      const ambient = await page.evaluate(() => getComputedStyle(document.querySelector('.ambient') || document.body).backgroundColor);
      check('页面背景不被 ambient 遮住（ambient 透明）', ambient === 'rgba(0, 0, 0, 0)' || ambient === 'transparent', ambient);
      const presetCount = await page.evaluate(() => document.querySelectorAll('[data-page-bg-preset]').length);
      check('提供多个渐变预设', presetCount >= 4, String(presetCount));

      await page.evaluate(() => document.querySelector('[data-page-bg-preset="sunset"]')?.click());
      await sleep(1000);
      const preset = await vars(page);
      const presetCfg = JSON.parse(String((await configs(page)).page_bg_gradient || '{}'));
      check('预设一键套用后背景立即变化并保存', preset.start === '255 236 210' && preset.end === '252 182 159' && presetCfg.start === '#ffecd2' && presetCfg.end === '#fcb69f', JSON.stringify({ preset, presetCfg }));
      const beforeCustom = await configs(page);

      await page.evaluate(() => {
        const a = document.querySelector('[data-page-bg-color-start]');
        const b = document.querySelector('[data-page-bg-color-end]');
        if (!a || !b) return;
        a.value = '#ff0000';
        a.dispatchEvent(new Event('input', { bubbles: true }));
        b.value = '#0000ff';
        b.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(250);
      const preview = await vars(page);
      const beforeSave = await configs(page);
      check('选色时页面背景实时预览两种颜色', preview.start === '255 0 0' && preview.end === '0 0 255' && /linear-gradient/.test(preview.body), JSON.stringify(preview));
      check('预览阶段尚未写入配置', (beforeSave.page_bg_gradient || '') === (beforeCustom.page_bg_gradient || ''), JSON.stringify({ before: beforeCustom.page_bg_gradient, now: beforeSave.page_bg_gradient }));
      check('选色不改卡片底色/文字色', preview.cardBg === before.cardBg && preview.cardColor === before.cardColor, JSON.stringify({ before, preview }));

      await page.evaluate(() => {
        const a = document.querySelector('[data-page-bg-color-start]');
        const b = document.querySelector('[data-page-bg-color-end]');
        a?.dispatchEvent(new Event('change', { bubbles: true }));
        b?.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(1000);
      const savedColors = await configs(page);
      const gradient = JSON.parse(String(savedColors.page_bg_gradient || '{}'));
      check('松手后保存两色渐变', gradient.start === '#ff0000' && gradient.end === '#0000ff' && gradient.direction === 'vertical', JSON.stringify(gradient));

      await page.evaluate(() => {
        const el = document.querySelector('[data-page-bg-direction]');
        if (!el) return;
        el.value = 'horizontal';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(900);
      const horizontal = await vars(page);
      const savedDirection = JSON.parse(String((await configs(page)).page_bg_gradient || '{}'));
      check('方向可选左右并保存', horizontal.angle === '90deg' && savedDirection.direction === 'horizontal', JSON.stringify({ horizontal, savedDirection }));

      await page.evaluate(() => {
        const el = document.querySelector('[data-page-bg-direction]');
        if (!el) return;
        el.value = 'diagonal';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(900);
      const diagonal = await vars(page);
      const savedDiagonal = JSON.parse(String((await configs(page)).page_bg_gradient || '{}'));
      check('方向可选斜角并保存', diagonal.angle === '135deg' && savedDiagonal.direction === 'diagonal', JSON.stringify({ diagonal, savedDiagonal }));
      await page.evaluate(() => {
        const el = document.querySelector('[data-page-bg-direction]');
        if (!el) return;
        el.value = 'horizontal';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(900);

      const startDragged = await page.evaluate(() => {
        const track = document.querySelector('[data-page-bg-stop-track]');
        const startHandle = document.querySelector('[data-page-bg-stop="start"]');
        if (!track || !startHandle) return false;
        const rect = track.getBoundingClientRect();
        const fire = (type, x) => window.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1 }));
        startHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left, pointerId: 1 }));
        fire('pointermove', rect.left + rect.width * 0.35);
        fire('pointerup', rect.left + rect.width * 0.35);
        return true;
      });
      await sleep(700);
      const endDragged = await page.evaluate(() => {
        const track = document.querySelector('[data-page-bg-stop-track]');
        const endHandle = document.querySelector('[data-page-bg-stop="end"]');
        if (!track || !endHandle) return false;
        const rect = track.getBoundingClientRect();
        const fire = (type, x) => window.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1 }));
        endHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.right, pointerId: 1 }));
        fire('pointermove', rect.left + rect.width * 0.7);
        fire('pointerup', rect.left + rect.width * 0.7);
        return true;
      });
      await sleep(1200);
      const stopVars = await vars(page);
      const stopCfg = JSON.parse(String((await configs(page)).page_bg_gradient || '{}'));
      check('拖动两个色阶调整颜色占比', startDragged === true && endDragged === true && stopVars.startStop === '35%' && stopVars.endStop === '70%' && stopCfg.startStop === 35 && stopCfg.endStop === 70, JSON.stringify({ stopVars, stopCfg }));

      await page.evaluate(() => {
        const el = document.querySelector('[data-page-bg-tone-slider]');
        if (!el) return;
        el.value = '-100';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(250);
      const dark = await vars(page);
      const cfgBeforeSave = await configs(page);
      check('拖动亮度时实时变暗（尚未保存）', dark.tint === '0 0 0' && dark.alpha >= 0.7 && Number(cfgBeforeSave.page_bg_tone || 0) === Number(original.page_bg_tone || 0), JSON.stringify({ dark, cfgBeforeSave }));
      check('亮度变化不影响卡片和文字', dark.cardBg === before.cardBg && dark.cardColor === before.cardColor, JSON.stringify({ before, dark }));

      await page.evaluate(() => document.querySelector('[data-page-bg-tone-slider]')?.dispatchEvent(new Event('change', { bubbles: true })));
      await sleep(900);
      const toneDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      const toneKey = toneDark ? 'page_bg_tone_dark' : 'page_bg_tone_light';
      check('松手后保存当前主题亮度', Number((await configs(page))[toneKey]) === -100, toneKey);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1400);
      const reloaded = await vars(page);
      const reloadedUi = await page.evaluate(() => ({
        start: document.querySelector('[data-page-bg-color-start]')?.value || '',
        end: document.querySelector('[data-page-bg-color-end]')?.value || '',
        direction: document.querySelector('[data-page-bg-direction]')?.value || '',
        tone: document.querySelector('[data-page-bg-tone-slider]')?.value || '',
      }));
      check('刷新后颜色/方向/色阶/亮度都保留', reloadedUi.start === '#ff0000' && reloadedUi.end === '#0000ff' && reloadedUi.direction === 'horizontal' && reloadedUi.tone === '-100' && reloaded.angle === '90deg' && reloaded.startStop === '35%' && reloaded.endStop === '70%' && reloaded.alpha >= 0.7, JSON.stringify({ reloadedUi, reloaded }));

      await page.evaluate(() => document.querySelector('[data-page-bg-tone-reset]')?.click());
      await sleep(1500);
      const reset = await configs(page);
      const resetVars = await vars(page);
      const resetDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      const resetToneKey = resetDark ? 'page_bg_tone_dark' : 'page_bg_tone_light';
      const resetExpectedTone = resetDark ? -20 : 0;
      check('恢复默认清回当前主题默认亮度/渐变/色阶', Number(reset[resetToneKey] || 0) === resetExpectedTone && resetVars.alpha >= 0 && resetVars.angle === '180deg' && resetVars.startStop === '0%' && resetVars.endStop === '100%', JSON.stringify({ resetToneKey, reset: { tone: reset[resetToneKey], gradient: reset.page_bg_gradient }, resetVars }));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone_light', value: String(original.page_bg_tone_light ?? '') });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone_dark', value: String(original.page_bg_tone_dark ?? '') });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_tone', value: String(original.page_bg_tone ?? '') });
      await api(page, '/api/configs', 'PUT', { key: 'page_bg_gradient', value: String(original.page_bg_gradient || '') });
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
