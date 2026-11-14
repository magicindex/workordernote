/**
 * 「呼叫小秘」入口：顶栏铃铛旁的 AI 星星（用户 2026-11-14）。
 *
 *   「悬浮按钮可以转成菜单按钮（在顶部铃铛图标-通知中心旁边，跟手机一样增加一个
 *     ai星星图标），点击展开/收起小秘面板，桌面端也适用，手机端保持不变。」
 *
 * 钉住这几条：
 *   1) 桌面端不再有右下角悬浮球；顶栏铃铛旁边有一颗 AI 星星，点一下展开、再点一下收起；
 *   2) 侧栏里不再显示 AI 入口（只留给手机抽屉）；
 *   3) 桌面展开仍是右侧浮窗：不铺遮罩、正文让出等宽槽、浮窗与正文不重叠；1024 宽时侧栏自动收成图标栏；
 *   4) 手机端保持原样：顶栏 AI 图标（同一颗）+ 整屏抽屉 + 遮罩，没有悬浮球；
 *   5) 顶栏按钮展开时 aria-pressed / data-assistant-open 都能反映状态。
 *
 * 收尾不写任何业务数据。
 * 用法：APP_URL=http://127.0.0.1:8906 node verify-165.js
 */
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

(async () => {
  console.log(`目标：${BASE}`);

  // ================= 桌面 1440：顶栏入口 + 展开/收起 =================
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1600);

    const entry = await page.evaluate(() => {
      const btn = document.querySelector('[data-assistant-topbar]');
      const bell = document.querySelector('header a[href="/admin/notifications"]');
      const drawer = document.querySelector('aside.sidebar [data-assistant-sidebar]');
      if (!btn || !bell) return { ok: false };
      const b = btn.getBoundingClientRect();
      const n = bell.getBoundingClientRect();
      return {
        ok: true,
        visible: b.width > 0 && b.height > 0,
        display: getComputedStyle(btn).display,
        fixed: getComputedStyle(btn).position === 'fixed',
        gap: Math.round(b.left - n.right),
        triggerCount: document.querySelectorAll('[data-assistant-trigger]').length,
        ball: !!document.querySelector('[data-assistant-ball]'),
        drawerVisible: !!drawer && drawer.getBoundingClientRect().width > 0,
        pressed: btn.getAttribute('aria-pressed'),
        open: btn.getAttribute('data-assistant-open'),
        text: (btn.innerText || '').trim(),
      };
    });
    check('桌面端没有悬浮球', entry.ball === false, JSON.stringify(entry));
    check('顶栏铃铛旁有 AI 星星且可见、不是 fixed 浮球',
      entry.ok && entry.visible && entry.display !== 'none' && entry.fixed === false, JSON.stringify(entry));
    check('AI 星星紧挨通知中心（间距 ≤ 16px）', entry.gap >= -2 && entry.gap <= 16, JSON.stringify(entry));
    check('桌面端侧栏里不再显示 AI 入口', entry.drawerVisible === false, JSON.stringify(entry));
    check('桌面端只有顶栏一个 AI 入口', entry.triggerCount === 1, JSON.stringify(entry));
    check('读屏文字仍是「呼叫 + 名字」', /^呼叫\S+/.test(entry.text), entry.text);
    check('默认收起（aria-pressed=false）', entry.pressed === 'false' && entry.open === 'false');

    // 第一次点击：展开
    await page.click('[data-assistant-topbar]');
    await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 8000 });
    await sleep(500);
    const open = await page.evaluate(() => {
      const drawer = document.querySelector('.assistant-drawer').getBoundingClientRect();
      const main = document.querySelector('main')?.getBoundingClientRect();
      const shell = document.querySelector('.shell');
      const btn = document.querySelector('[data-assistant-topbar]');
      const b = btn.getBoundingClientRect();
      return {
        drawer: { l: drawer.left, r: drawer.right, t: drawer.top, w: drawer.width, h: drawer.height },
        radius: getComputedStyle(document.querySelector('.assistant-drawer')).borderRadius,
        backdrop: getComputedStyle(document.querySelector('[data-assistant-backdrop]')).display,
        main: main ? { l: main.left, r: main.right, w: main.width } : null,
        padRight: parseInt(getComputedStyle(shell).paddingRight, 10) || 0,
        btnVisible: b.width > 0 && b.height > 0,
        pressed: btn.getAttribute('aria-pressed'),
        open: btn.getAttribute('data-assistant-open'),
      };
    });
    check('点一下 AI 星星展开小秘面板', true);
    check('桌面端仍是右侧浮窗（无遮罩、圆角、宽度上限）',
      open.backdrop === 'none' && open.drawer.w >= 300 && open.drawer.w <= 500 && parseFloat(open.radius) >= 16,
      JSON.stringify({ backdrop: open.backdrop, w: open.drawer.w, radius: open.radius }));
    check('正文右侧让出与浮窗等宽的槽', open.padRight >= open.drawer.w + 16, JSON.stringify({ pad: open.padRight, drawer: open.drawer.w }));
    check('浮窗与正文不重叠（main 右边缘 ≤ 浮窗左边缘）', !!open.main && open.main.r <= open.drawer.l + 1,
      JSON.stringify({ main: open.main, drawer: open.drawer }));
    check('展开后顶栏 AI 星星仍可见（能再点一次收起）', open.btnVisible === true);
    check('展开状态写入 aria-pressed / data-assistant-open', open.pressed === 'true' && open.open === 'true');

    // 第二次点击：收起
    await page.click('[data-assistant-topbar]');
    await sleep(500);
    const closed = await page.evaluate(() => ({
      panel: !!document.querySelector('[data-assistant-panel]'),
      padRight: parseInt(getComputedStyle(document.querySelector('.shell')).paddingRight, 10) || 0,
      pressed: document.querySelector('[data-assistant-topbar]').getAttribute('aria-pressed'),
      open: document.querySelector('[data-assistant-topbar]').getAttribute('data-assistant-open'),
    }));
    check('再点一下 AI 星星收起面板（正文恢复全宽）',
      !closed.panel && closed.padRight === 0 && closed.pressed === 'false' && closed.open === 'false',
      JSON.stringify(closed));

    // 再展开，Esc 收起
    await page.click('[data-assistant-topbar]');
    await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 8000 });
    await page.keyboard.press('Escape');
    await sleep(500);
    check('Esc 也能收起浮窗', await page.evaluate(() => !document.querySelector('[data-assistant-panel]')));
    await page.screenshot({ path: path.join(SHOTS, 'assistant-topbar-1440.png') }).catch(() => {});
  }, { width: 1440, height: 900 });

  // ================= 1024：窄桌面自动收侧栏，正文不被盖 =================
  await withTab(async (page) => {
    await page.setViewport({ width: 1024, height: 800 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await page.click('[data-assistant-topbar]');
    await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 8000 });
    await sleep(600);
    const compact = await page.evaluate(() => {
      const drawer = document.querySelector('.assistant-drawer').getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      const sidebar = document.querySelector('aside.sidebar').getBoundingClientRect();
      return {
        sidebarW: sidebar.width,
        mainW: main.width,
        mainR: main.right,
        drawerL: drawer.left,
      };
    });
    check('1024 宽展开时侧栏临时收成图标栏（≤64px）', compact.sidebarW <= 64, JSON.stringify(compact));
    check('窄桌面正文仍然够宽（≥480px）且不被浮窗盖住',
      compact.mainW >= 480 && compact.mainR <= compact.drawerL + 1, JSON.stringify(compact));
    await page.screenshot({ path: path.join(SHOTS, 'assistant-topbar-1024.png') }).catch(() => {});
  }, { width: 1024, height: 800 });

  // ================= 手机 390：保持原样 =================
  await withTab(async (page) => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await login(page, BASE);
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const mobile = await page.evaluate(() => {
      const btn = document.querySelector('[data-assistant-topbar]');
      const drawerEntry = document.querySelector('aside.sidebar [data-assistant-sidebar]');
      return {
        ball: !!document.querySelector('[data-assistant-ball]'),
        btn: !!btn && btn.getBoundingClientRect().width > 0,
        drawerEntry: !!drawerEntry,
      };
    });
    check('手机端没有悬浮球', mobile.ball === false);
    check('手机端顶栏 AI 星星还在', mobile.btn === true);
    check('手机抽屉里的 AI 入口还在（保持不变）', mobile.drawerEntry === true);

    await page.click('[data-assistant-topbar]');
    await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 8000 });
    await sleep(500);
    const mopen = await page.evaluate(() => {
      const drawer = document.querySelector('.assistant-drawer').getBoundingClientRect();
      return {
        w: Math.round(drawer.width),
        h: Math.round(drawer.height),
        backdrop: getComputedStyle(document.querySelector('[data-assistant-backdrop]')).display,
        radius: getComputedStyle(document.querySelector('.assistant-drawer')).borderRadius,
        pad: parseInt(getComputedStyle(document.querySelector('.shell')).paddingRight, 10) || 0,
      };
    });
    check('手机仍是整屏抽屉 + 遮罩（宽度=视口、圆角 0、正文不让槽）',
      mopen.w === 390 && mopen.h === 844 && mopen.backdrop !== 'none'
        && parseFloat(mopen.radius) < 1 && mopen.pad === 0, JSON.stringify(mopen));
    await page.screenshot({ path: path.join(SHOTS, 'assistant-topbar-390.png') }).catch(() => {});
    await page.keyboard.press('Escape');
  }, { width: 390, height: 844 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('出错:', err && err.message ? err.message : err);
  process.exit(1);
});
