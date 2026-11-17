/**
 * 手机端导航栏不透明度 + 打开应用默认首页（用户 2026-11-17）：
 *
 *   「手机页面的适配问题需要修复，手机页面菜单栏透明度太高导致看不清，
 *     降低菜单栏背景的透明度……增加手机打开后的初始页面，默认显示首页」
 *
 * 钉住这几条：
 *   1. 卡片透明度调到 40% 时，手机端顶栏 / 抽屉菜单 / 底部标签栏的不透明度
 *      仍 ≥ 90%（桌面端照旧跟随卡片透明度，不被这条下限影响）；
 *   2. 手机端冷启动打开 /admin，第一帧就是首页看板：不会再先渲染一遍「待办」；
 *   3. 底栏点「待办」仍能正常进待办（不会被默认首页守卫弹回首页）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-214.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await res.json().catch(() => null);
}, { base: BASE, p, method, body });

/** 背景色的 alpha：rgba(...) / color(srgb ... / a) 都覆盖；rgb(...) 视为 1。 */
const bgAlpha = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const bg = getComputedStyle(el).backgroundColor || '';
  const m = bg.match(/rgba?\(([^)]+)\)/);
  if (!m) return { bg, alpha: null };
  const parts = m[1].split(/[,/]/).map((v) => v.trim()).filter(Boolean);
  const alpha = parts.length >= 4 ? parseFloat(parts[3]) : 1;
  return { bg, alpha };
}, sel);

async function sampleFrames(page, totalMs = 1800, stepMs = 40) {
  const frames = [];
  const t0 = Date.now();
  while (Date.now() - t0 < totalMs) {
    const f = await page.evaluate(() => ({
      path: location.pathname,
      dashboard: !!document.querySelector('[data-home-dashboard]'),
      list: !!document.querySelector('.list-toolbar'),
    })).catch(() => null);
    if (f) frames.push({ ms: Date.now() - t0, ...f });
    await sleep(stepMs);
  }
  return frames;
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await login(page, BASE);

    const cfg = (await api(page, '/api/configs'))?.data || {};
    const original = { default_view: cfg.default_view, card_bg_opacity: cfg.card_bg_opacity };
    try {
      // 回归辅助 loginViaApi 对本机实例会把 default_view 写成 list；这里保持不动，
      // 正好验证「手机端即使默认首页偏好是列表，第一页也必须是首页看板」。
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: '40' });
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(1200);

      // ---------------- 1. 冷启动第一帧就是首页 ----------------
      const frames = [];
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' }).catch(() => {});
      frames.push(...await sampleFrames(page));
      const listFrames = frames.filter((f) => f.list);
      const dashFrame = frames.find((f) => f.dashboard);
      const landed = await page.evaluate(() => ({
        path: location.pathname,
        dashboard: !!document.querySelector('[data-home-dashboard]'),
        tab: (document.querySelector('.mobile-tab.active small')?.textContent || '').trim(),
      }));
      check('打开 /admin 期间从未渲染「待办」列表', listFrames.length === 0,
        listFrames.length ? `第 ${listFrames[0].ms}ms 出现过待办` : '');
      check('手机首屏最终落在首页看板', landed.path === '/admin/home' && landed.dashboard, JSON.stringify(landed));
      check('底栏「首页」保持选中', landed.tab === '首页', landed.tab);
      console.log(`     （首个首页帧 ${dashFrame ? dashFrame.ms + 'ms' : '未采到'}，共 ${frames.length} 帧）`);

      // ---------------- 2. 手机端导航栏不透明度 ----------------
      const topbar = await bgAlpha(page, '.topbar');
      const tabbar = await bgAlpha(page, '.mobile-tabbar');
      check('手机顶栏不透明度 ≥ 90%（卡片透明度 40% 时）', topbar && topbar.alpha >= 0.9, JSON.stringify(topbar));
      check('手机底部标签栏不透明度 ≥ 90%', tabbar && tabbar.alpha >= 0.9, JSON.stringify(tabbar));

      const opened = await page.evaluate(() => {
        const btn = document.querySelector('.topbar .icon-button');
        if (btn) { btn.click(); return true; }
        return false;
      });
      await sleep(600);
      const sidebar = await bgAlpha(page, '.sidebar');
      check('抽屉菜单不透明度 ≥ 90%', opened && sidebar && sidebar.alpha >= 0.9, JSON.stringify(sidebar));
      const navVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--nav-bg-opacity').trim());
      check('移动端 --nav-bg-opacity 已生效', Number(navVar) >= 0.9, navVar);
      await page.screenshot({ path: __dirname + '/shots/verify-214-mobile-drawer.png' });

      // 收起抽屉，进「待办」再确认不被默认首页守卫弹回去
      await page.evaluate(() => { const b = document.querySelector('.sidebar .mobile-only'); if (b) b.click(); });
      await sleep(400);
      await page.evaluate(() => { const a = document.querySelector('[data-tab-today]'); if (a) a.click(); });
      await sleep(1200);
      const today = await page.evaluate(() => ({ path: location.pathname, list: !!document.querySelector('.list-toolbar') }));
      check('底栏「待办」能正常进入、不被弹回首页', today.path === '/admin' && today.list, JSON.stringify(today));

      // ---------------- 3. 桌面端不受影响：仍跟随卡片透明度 ----------------
      await page.setViewport({ width: 1440, height: 900 });
      await sleep(500);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(1500);
      const deskTop = await bgAlpha(page, '.topbar');
      const deskVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--nav-bg-opacity').trim());
      check('桌面端导航栏仍跟随卡片透明度（40%）', deskTop && Math.abs(deskTop.alpha - 0.4) < 0.02, JSON.stringify(deskTop));
      check('桌面端没有套用移动端下限', deskVar === '', `--nav-bg-opacity=${deskVar}`);
    } finally {
      for (const [k, v] of Object.entries(original)) {
        if (v !== undefined && v !== null) await api(page, '/api/configs', 'PUT', { key: k, value: String(v) });
      }
    }
  }, { width: 390, height: 844 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
