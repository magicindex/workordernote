/**
 * 信用卡页的卡片也跟随「卡片透明度」偏好（用户 2026-11-16：「卡片透明度没有跟随变化」）。
 *
 * 原来只有 `.surface` 的白色卡片/侧栏/顶栏跟着滑块变透明，信用卡页里
 * ①「今天 / 账单已出」那条时间卡片写死了 `bg-surface`（不透明白），
 * ②彩色卡面（大卡面 + 头部缩略小卡面）是不透明渐变，
 * 拖动滑块时它们一动不动，看着像贴上去的。
 *
 * 现在：三处都按 `--card-bg-opacity` 变透明；卡面文字保持不透明，并按
 * 「叠在背后底色上的实际颜色」自动转深色（亮底）或白色（暗底）。
 *
 * 需要改用户偏好的两处（卡片透明度、主题）都在 finally 里还原。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const api = (page, path, method = 'GET', body = null) => page.evaluate(async ({ base, path, method, body }) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}, { base: BASE, path, method, body });

/** "rgba(250, 171, 21, 0.39)" / "rgb(255, 255, 255)" / "rgb(30, 41, 59)" → [r,g,b,a] */
function parseColor(value) {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(String(value || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

/** WCAG 对比度（取 ink 与「叠出来的底色」）。 */
function contrast([r1, g1, b1], [r2, g2, b2]) {
  const lum = ([r, g, b]) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const l1 = lum([r1, g1, b1]);
  const l2 = lum([r2, g2, b2]);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** 卡面渐变第一段颜色 + 透明度（三个卡面共用一套口径）。 */
function gradientStop(backgroundImage) {
  const m = /(rgba?\([^)]+\))/.exec(String(backgroundImage || ''));
  return m ? parseColor(m[1]) : null;
}

/** 半透明颜色叠在底色上看起来的颜色。 */
function blend([r, g, b, a], backdrop) {
  return [0, 1, 2].map((i) => Math.round([r, g, b][i] * a + backdrop[i] * (1 - a)));
}

async function setTheme(page, mode) {
  await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
  await sleep(1800);
  const set = await page.evaluate((m) => {
    const row = [...document.querySelectorAll('div')].find((d) => {
      const code = d.querySelector(':scope > div > div > code');
      return code && code.textContent.trim() === 'theme_mode';
    });
    if (!row) return 'row-not-found';
    const select = row.querySelector('select');
    if (!select) return 'no-select';
    select.value = m;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }, mode);
  if (set !== 'ok') return set;
  await sleep(400);
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('div')].find((d) => {
      const code = d.querySelector(':scope > div > div > code');
      return code && code.textContent.trim() === 'theme_mode';
    });
    const save = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '保存');
    if (!save) return 'save-not-found';
    if (!save.disabled) save.click();
    return 'ok';
  });
}

/** 把透明度写成偏好，再回到信用卡页读三个卡面的实际样式。 */
async function faceStateAt(page, opacity) {
  await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: String(opacity) });
  await page.goto(BASE + '/admin/list/13', { waitUntil: 'domcontentloaded' });
  await sleep(1900);
  return page.evaluate(() => {
    const strip = document.querySelector('[data-billing-strip]');
    const mini = document.querySelector('[data-billing-card]');
    const face = document.querySelector('[data-card-face]');
    if (!strip || !mini || !face) return null;
    const cs = (el) => getComputedStyle(el);
    return {
      cssVar: cs(document.documentElement).getPropertyValue('--card-bg-opacity').trim(),
      stripBg: cs(strip).backgroundColor,
      miniGradient: cs(mini).backgroundImage,
      miniInk: cs(mini).color,
      faceGradient: cs(face).backgroundImage,
      faceInk: cs(face).color,
    };
  });
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const before = (await api(page, '/api/configs')).data || {};
    const oldOpacity = before.card_bg_opacity !== undefined ? String(before.card_bg_opacity) : '90';
    const oldTheme = await page.evaluate(() => localStorage.getItem('reminder-theme-mode') || 'system');
    try {
      // ── 1. 100%：与改动前完全一致（不透明白 + 白色字） ──
      const full = await faceStateAt(page, 100);
      check('拿到信用卡页的三个卡面（时间卡片 / 缩略卡面 / 大卡面）', !!full, JSON.stringify(full));
      if (full) {
        const strip = parseColor(full.stripBg);
        const mini = gradientStop(full.miniGradient);
        const face = gradientStop(full.faceGradient);
        check('100%：时间卡片是不透明白（和改之前一样）', !!strip && strip[3] === 1, full.stripBg);
        check('100%：彩色卡面渐变不带透明度', !!mini && mini[3] === 1 && !!face && face[3] === 1,
          `${full.miniGradient} / ${full.faceGradient}`);
        check('100%：卡面仍是白字', full.miniInk === 'rgb(255, 255, 255)' && full.faceInk === 'rgb(255, 255, 255)',
          `${full.miniInk} / ${full.faceInk}`);
      }

      // ── 2. 39%（用户当前的档位）：三处都半透明、字转深色且看得清 ──
      const soft = await faceStateAt(page, 39);
      if (soft) {
        const strip = parseColor(soft.stripBg);
        const mini = gradientStop(soft.miniGradient);
        const face = gradientStop(soft.faceGradient);
        check('39%：时间卡片背景变成半透明白', !!strip && Math.abs(strip[3] - 0.39) < 0.02, soft.stripBg);
        check('39%：头部缩略卡面跟着变半透明', !!mini && Math.abs(mini[3] - 0.39) < 0.02, soft.miniGradient);
        check('39%：大卡面跟着变半透明', !!face && Math.abs(face[3] - 0.39) < 0.02, soft.faceGradient);
        check('39%：卡面文字自动转深色（亮底）',
          soft.miniInk === 'rgb(15, 23, 42)' && soft.faceInk === 'rgb(15, 23, 42)',
          `${soft.miniInk} / ${soft.faceInk}`);
        const ink = parseColor(soft.faceInk);
        const visible = face && ink ? contrast(ink, blend(face, [255, 255, 255])) : 0;
        check(`39%：字和叠出来的底色对比度够（实测 ${visible.toFixed(2)}:1）`, visible >= 3, String(visible));
      }

      // ── 3. 其它档位也跟着走（不是只有 39% 这一档写死） ──
      const mid = await faceStateAt(page, 70);
      const low = await faceStateAt(page, 20);
      const midMini = mid ? gradientStop(mid.miniGradient) : null;
      const lowMini = low ? gradientStop(low.miniGradient) : null;
      check('70%：缩略卡面透明度 0.7', !!midMini && Math.abs(midMini[3] - 0.7) < 0.02, String(midMini));
      check('20%（最低档）：缩略卡面透明度 0.2', !!lowMini && Math.abs(lowMini[3] - 0.2) < 0.02, String(lowMini));
      const lowStrip = low ? parseColor(low.stripBg) : null;
      check('20%：时间卡片也跟着降到 0.2', !!lowStrip && Math.abs(lowStrip[3] - 0.2) < 0.02, String(lowStrip));

      // ── 4. 深色主题：半透明卡面叠在暗底上，字要转回白色 ──
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: '39' });
      const themeSet = await setTheme(page, 'dark');
      check('能切到深色主题', themeSet === 'ok', themeSet);
      await page.goto(BASE + '/admin/list/13', { waitUntil: 'domcontentloaded' });
      await sleep(1900);
      const dark = await page.evaluate(() => {
        const mini = document.querySelector('[data-billing-card]');
        const face = document.querySelector('[data-card-face]');
        return {
          isDark: document.documentElement.classList.contains('dark'),
          miniGradient: mini ? getComputedStyle(mini).backgroundImage : '',
          miniInk: mini ? getComputedStyle(mini).color : '',
          faceInk: face ? getComputedStyle(face).color : '',
        };
      });
      check('深色主题下卡面依然半透明', Math.abs((gradientStop(dark.miniGradient) || [0, 0, 0, 1])[3] - 0.39) < 0.02, dark.miniGradient);
      check('深色主题下卡面文字转白色', dark.miniInk === 'rgb(255, 255, 255)' && dark.faceInk === 'rgb(255, 255, 255)',
        `${dark.miniInk} / ${dark.faceInk}`);
      const dInk = parseColor(dark.faceInk);
      const dStop = gradientStop(dark.miniGradient);
      const dVisible = dInk && dStop ? contrast(dInk, blend(dStop, [15, 23, 42])) : 0;
      check(`深色下字与叠出来的底色对比度够（实测 ${dVisible.toFixed(2)}:1）`, dVisible >= 3, String(dVisible));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: oldOpacity });
      if (oldTheme !== 'dark') { await setTheme(page, oldTheme); await sleep(400); }
      const restored = (await api(page, '/api/configs')).data || {};
      check('卡片透明度偏好已还原', String(restored.card_bg_opacity) === oldOpacity,
        `${restored.card_bg_opacity} / 原 ${oldOpacity}`);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
