/**
 * 验证 0.5.2：侧栏左下角折叠「设置」入口
 *   1) 有浅蓝色底（品牌蓝低透明度），悬停/展开时更深；
 *   2) 有齿轮图标（和折叠箭头区分开）；
 *   3) 文字在那个浅蓝底上仍然读得清（浅色与深色主题都算对比度）；
 *   4) 折叠行为没坏（aria-expanded / 子菜单显隐）；
 *   5) 手机宽度下可见、不横向溢出。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-052.js
 * 只读：不改服务端数据，也不改用户的主题设置（深色仅在页面里临时加 class 量一次）。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/**
 * 颜色小工具。必须显式挂到 window 上：page.evaluate 里声明的 function 只活在
 * 那一次求值的函数作用域里，后续 evaluate 看不到（这个 harness 的 page 也没有
 * addInitScript）。
 */
const HELPERS = `
  window.__lc = {
    parseColor(css) {
      const m = String(css).match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const parts = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    },
    blend(fg, bg) {
      return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
    },
    relLum(c) {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    },
    contrast(a, b) {
      const l1 = window.__lc.relLum(a), l2 = window.__lc.relLum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    },
  };
`;

const measure = (page) => page.evaluate(() => {
  const btn = document.querySelector('.nav-settings-toggle');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const label = btn.querySelector('span.text-xs') || btn.querySelector('span:not(.nav-symbol):not(.nav-count)');
  const svgs = [...btn.querySelectorAll('svg')];
  // 齿轮：带 <circle> 的那个；箭头：只有 path 且没有 circle
  const gear = svgs.find((s) => s.querySelector('circle'));
  const chevron = svgs.find((s) => !s.querySelector('circle'));
  const sidebar = btn.closest('aside') || btn.closest('nav') || document.body;
  return {
    bg: cs.backgroundColor,
    border: cs.borderTopColor,
    expanded: btn.getAttribute('aria-expanded'),
    labelText: label ? label.textContent.trim() : '',
    labelColor: label ? getComputedStyle(label).color : null,
    sidebarBg: getComputedStyle(sidebar).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    svgCount: svgs.length,
    gearPaths: gear ? gear.querySelectorAll('path, circle').length : 0,
    gearStroke: gear ? getComputedStyle(gear).color : null,
    chevronRotate: chevron ? getComputedStyle(chevron).transform : null,
    panelVisible: (() => {
      const panel = document.getElementById('sidebar-settings');
      return panel ? getComputedStyle(panel).display !== 'none' : null;
    })(),
    rect: (() => { const r = btn.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    ariaControls: btn.getAttribute('aria-controls'),
  };
});

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);
    await waitFor(page, () => !!document.querySelector('.nav-settings-toggle'), { timeout: 20000 });
    await page.evaluate(HELPERS);
    await sleep(800);

    // ---- 1. 浅蓝底 + 齿轮图标 ----
    let m = await measure(page);
    check('侧栏存在折叠「设置」入口', !!m, m ? '' : '没找到 .nav-settings-toggle');
    if (!m) return;

    // 用户 2026-10-20：「设置默认不选择状态，鼠标放在按钮上显示选中状态」。
    const bg = await page.evaluate((css) => window.__lc.parseColor(css), m.bg);
    check('默认没有选中底色（透明）', !!bg && bg.a === 0, `${m.bg} → ${JSON.stringify(bg)}`);
    await page.hover('.nav-settings-toggle');
    await sleep(250);
    const hov = await measure(page);
    const hbg = await page.evaluate((css) => window.__lc.parseColor(css), hov.bg);
    check('悬停后底色是品牌蓝的浅色',
      !!hbg && hbg.b > hbg.r + 60 && hbg.b > hbg.g + 40 && hbg.a > 0.04 && hbg.a < 0.25,
      `${hov.bg} → ${JSON.stringify(hbg)}`);
    check('悬停后出现同色系边框', !!hov.border && hov.border !== 'rgba(0, 0, 0, 0)', hov.border);
    check('入口里有齿轮图标（带圆心的那个 svg）', m.svgCount >= 2 && m.gearPaths >= 2,
      `svg=${m.svgCount} 齿轮图元=${m.gearPaths}`);
    check('齿轮图标跟随品牌色', !!m.gearStroke && m.gearStroke !== 'rgb(0, 0, 0)', m.gearStroke);
    check('文字是「设置」', m.labelText === '设置', m.labelText);
    check('有无障碍关联（aria-controls 指向子菜单）', m.ariaControls === 'sidebar-settings', m.ariaControls || '无');

    // ---- 2. 对比度：浅色主题 ----
    const light = await page.evaluate(({ bgCss, fgCss, surfaceCss }) => {
      const L = window.__lc;
      const btnBg = L.parseColor(bgCss);
      // 侧栏表面可能是半透明的，取它自己叠在 body 上的结果作为背景
      const surface = L.parseColor(surfaceCss) || { r: 255, g: 255, b: 255, a: 1 };
      const body = L.parseColor(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      const base = surface.a < 1 ? L.blend(surface, body) : surface;
      const eff = btnBg.a < 1 ? L.blend(btnBg, base) : btnBg;
      const fg = L.parseColor(fgCss);
      return { contrast: Math.round(L.contrast(fg, eff) * 100) / 100, eff: `rgb(${Math.round(eff.r)}, ${Math.round(eff.g)}, ${Math.round(eff.b)})` };
    }, { bgCss: m.bg, fgCss: m.labelColor, surfaceCss: m.sidebarBg });
    check('浅色主题下文字对比度 ≥ 4.5:1', light.contrast >= 4.5, `${light.contrast}:1（底 ${light.eff}）`);

    // ---- 3. 深色主题（临时加 class 量一次，不动用户设置）----
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await sleep(200);
    await page.hover('.nav-settings-toggle');
    await sleep(300);
    const dark = await page.evaluate(() => {
      const L = window.__lc;
      const btn = document.querySelector('.nav-settings-toggle');
      const label = btn.querySelector('span.text-xs');
      const btnBg = L.parseColor(getComputedStyle(btn).backgroundColor);
      const body = L.parseColor(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
      const eff = btnBg.a < 1 ? L.blend(btnBg, body) : btnBg;
      const fg = L.parseColor(getComputedStyle(label).color);
      const out = { contrast: Math.round(L.contrast(fg, eff) * 100) / 100, eff: `rgb(${Math.round(eff.r)}, ${Math.round(eff.g)}, ${Math.round(eff.b)})`, bg: getComputedStyle(btn).backgroundColor };
      return out;
    });
    check('深色主题下文字对比度 ≥ 4.5:1', dark.contrast >= 4.5, `${dark.contrast}:1（底 ${dark.eff}）`);
    check('深色下悬停底色仍是蓝色系（不是被主题冲成灰）', /rgba?\(\s*\d+,\s*\d+,\s*2\d\d/.test(dark.bg), dark.bg);
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    // ---- 4. 展开/折叠行为 ----
    // 「设置」组的开合状态记在 localStorage（ui_settings_open），这个浏览器 profile
    // 是用户在用的那个，可能上次就是展开的。所以不能假设初始收起：先归位到「收起」，
    // 再按 收起 → 展开 → 收起 走一遍，结束时还原成进来时的状态。
    const waitSidebar = async () => {
      for (let i = 0; i < 40; i += 1) {
        const ok = await page.evaluate(() => !!document.querySelector('.nav-settings-toggle'));
        if (ok) return true;
        await sleep(250);
      }
      return false;
    };
    const clickToggle = async () => {
      await page.evaluate(() => document.querySelector('.nav-settings-toggle').click());
      await sleep(350);
    };
    const startedExpanded = m.expanded === 'true';
    if (startedExpanded) await clickToggle(); // 先收起
    const closedState = await measure(page);
    check('收起时 aria-expanded=false 且子菜单隐藏',
      closedState?.expanded === 'false' && closedState?.panelVisible === false,
      `aria-expanded=${closedState?.expanded} panel=${closedState?.panelVisible}`);

    await clickToggle();
    const openState = await measure(page);
    check('展开后 aria-expanded=true 且子菜单可见（id=sidebar-settings）',
      openState?.expanded === 'true' && openState?.panelVisible === true,
      `aria-expanded=${openState?.expanded} panel=${openState?.panelVisible}`);
    check('展开后底色比收起更深（能看出这一组在展开）',
      !!openState && !!closedState && openState.bg !== closedState.bg,
      `${closedState?.bg} → ${openState?.bg}`);

    await clickToggle();
    const closedAgain = await measure(page);
    check('再点一次能收起', closedAgain?.expanded === 'false' && closedAgain?.panelVisible === false,
      `aria-expanded=${closedAgain?.expanded} panel=${closedAgain?.panelVisible}`);
    if (startedExpanded) await clickToggle(); // 还原成进来时的状态
    const restored = await measure(page);
    check('用例结束后把开合状态还原成原样', restored?.expanded === m.expanded,
      `进来时 ${m.expanded} → 结束 ${restored?.expanded}`);

    // 用户要求：设置组默认收起，而且**状态不跨刷新保留**（点刷新要回到收起）。
    await clickToggle(); // 先展开
    const expandedBeforeReload = await measure(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitSidebar();
    await sleep(900);
    const afterReload = await measure(page);
    check('展开设置后刷新页面会回到默认收起',
      expandedBeforeReload?.expanded === 'true' && afterReload?.expanded === 'false',
      `${expandedBeforeReload?.expanded} → 刷新后 ${afterReload?.expanded}`);
    check('设置的开合状态不再写进 localStorage',
      await page.evaluate(() => !localStorage.getItem('ui_settings_open')));

    // ---- 5. 窄屏 ----
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(700);
    // 手机上侧栏是抽屉（aside.sidebar 默认 -translate-x-full）：先点顶栏那个
    // 开合按钮把抽屉拉出来，再看入口是否真的在屏幕里（left >= 0）。
    const drawerOpened = await page.evaluate(() => {
      const aside = document.querySelector('aside.sidebar');
      const before = aside.getBoundingClientRect().left;
      // 只认顶栏那个开合按钮（aria-label 是「展开侧栏 / 收起侧栏」）。
      // 侧栏里那个「关闭菜单」按钮的 aria-label 也含「菜单」，按 DOM 顺序先被找到，
      // 点它就等于把抽屉关上（第一次跑就是这么假红的）。
      const trigger = [...document.querySelectorAll('button')].find((b) => /侧栏/.test(b.getAttribute('aria-label') || ''));
      if (trigger) { trigger.click(); return { clicked: true, before }; }
      return { clicked: false, before };
    });
    await sleep(800);
    const mobile = await page.evaluate(() => {
      const btn = document.querySelector('.nav-settings-toggle');
      const r = btn ? btn.getBoundingClientRect() : null;
      const aside = document.querySelector('aside.sidebar');
      return {
        drawerLeft: Math.round(aside.getBoundingClientRect().left),
        visible: !!btn && r.width > 100 && r.height > 28 && r.left >= 0,
        width: r ? Math.round(r.width) : 0,
        left: r ? Math.round(r.left) : null,
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      };
    });
    check('窄屏下设置入口在屏幕内且够大', mobile.visible, JSON.stringify(mobile) + ` 抽屉触发=${drawerOpened.clicked}`);
    check('窄屏不横向溢出', mobile.doc <= mobile.win + 1, JSON.stringify(mobile));
    await page.screenshot({ path: path.join(SHOTS, 'sidebar-settings.png') });
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, 'sidebar-settings-desktop.png') });
    console.log(`  截图：${path.join(SHOTS, 'sidebar-settings.png')} / sidebar-settings-desktop.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
