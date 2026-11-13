/**
 * 「呼叫小秘」改成可拖动的悬浮球（用户 2026-11-13）：
 *
 *   「把 呼叫ai助手 改成 悬浮可拖动的悬浮球，点击后展开对话窗口。需要支持拖拽记忆位置，
 *     移动端保持现状同时桌面端默认收起，展开后不遮挡主要内容。」
 *
 * 钉住这几条：
 *   1) 桌面端（≥1024）侧栏里不再有「呼叫小秘」，右下角是一颗 fixed 悬浮球；
 *      手机上保持原样：顶栏 AI 图标 + 整屏抽屉，不出现悬浮球。
 *   2) 悬浮球能拖：拖动只挪位置、不误开面板；松手把 {x,y} 写进
 *      localStorage 的 reminders.assistant_ball_pos，刷新后还在原处。
 *   3) 点击悬浮球（没拖）= 展开对话窗口；桌面端是右侧浮窗——不铺遮罩、
 *      正文右侧让出等宽槽，`main` 的右边缘在浮窗左边缘左边（不遮挡主要内容）。
 *   4) 关闭（X / Esc）后浮窗收起、正文恢复全宽、悬浮球回到记忆位置。
 *   5) 1024 宽的窄桌面：浮窗展开时侧栏临时收成图标栏，正文仍然够宽、不被盖住。
 *
 * 收尾：清掉本套件写的悬浮球位置，避免影响后面的用例。
 * 用法：APP_URL=http://127.0.0.1:3100 node verify-165.js
 */
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const POS_KEY = 'reminders.assistant_ball_pos';

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const clearPos = (page) => page.evaluate((key) => {
  try { localStorage.removeItem(key); } catch {}
}, POS_KEY);

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    await clearPos(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1500);

    try {
      // ---------- 1. 桌面入口：只有一颗悬浮球 ----------
      const before = await page.evaluate(() => {
        const ball = document.querySelector('[data-assistant-ball]');
        const sidebarBtn = document.querySelector('aside.sidebar [data-assistant-sidebar]');
        const r = ball?.getBoundingClientRect();
        return {
          count: document.querySelectorAll('[data-assistant-trigger]').length,
          visible: !!ball && r.width > 40 && r.height > 40,
          display: ball ? getComputedStyle(ball).display : '',
          position: ball ? getComputedStyle(ball).position : '',
          rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
          text: (ball?.innerText || '').trim(),
          sidebarVisible: !!sidebarBtn && sidebarBtn.getBoundingClientRect().width > 0,
        };
      });
      check('桌面端只剩一个 AI 入口（悬浮球）', before.count === 1, JSON.stringify(before));
      check('悬浮球固定在视口右下、可见', before.visible && before.display !== 'none' && before.position === 'fixed', JSON.stringify(before));
      check('侧栏里不再显示「呼叫小秘」', before.sidebarVisible === false);
      check('读屏文字仍是「呼叫 + 名字」', /^呼叫\S+/.test(before.text), before.text);

      // ---------- 2. 拖动：位置改变、不误开、写进本地 ----------
      const cx = before.rect.x + before.rect.w / 2;
      const cy = before.rect.y + before.rect.h / 2;
      // 鼠标从球心抓起，所以松手时左上角 = 指针位置 - 半个球
      const target = { x: 420, y: 300 };
      const expectedX = target.x - before.rect.w / 2;
      const expectedY = target.y - before.rect.h / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 8; i += 1) {
        await page.mouse.move(cx + ((target.x - cx) * i) / 8, cy + ((target.y - cy) * i) / 8);
        await sleep(25);
      }
      await page.mouse.up();
      await sleep(500);
      const dragged = await page.evaluate(({ key, expectedX, expectedY }) => {
        const ball = document.querySelector('[data-assistant-ball]');
        const r = ball.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          moved: Math.abs(r.x - expectedX) < 4 && Math.abs(r.y - expectedY) < 4,
          panel: !!document.querySelector('[data-assistant-panel]'),
          stored: localStorage.getItem(key),
        };
      }, { key: POS_KEY, expectedX, expectedY });
      check('拖动后球到了新位置', dragged.moved, JSON.stringify(dragged));
      check('拖动不会误开对话窗口', dragged.panel === false);
      check('松手把位置写进 localStorage', !!dragged.stored, dragged.stored || '');
      const stored = dragged.stored ? JSON.parse(dragged.stored) : null;
      check('存的是拖动后的坐标',
        !!stored && Math.abs(Number(stored.x) - expectedX) < 4 && Math.abs(Number(stored.y) - expectedY) < 4,
        JSON.stringify({ stored, expectedX, expectedY }));

      // ---------- 3. 刷新后记住位置 ----------
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const reloaded = await page.evaluate(() => {
        const r = document.querySelector('[data-assistant-ball]').getBoundingClientRect();
        return { x: r.x, y: r.y };
      });
      check('刷新后悬浮球还在拖到的位置', Math.abs(reloaded.x - Number(stored?.x)) < 4 && Math.abs(reloaded.y - Number(stored?.y)) < 4, JSON.stringify(reloaded));

      // ---------- 4. 点开：桌面浮窗、不铺遮罩、正文让槽 ----------
      await page.click('[data-assistant-ball]');
      await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 8000 });
      await sleep(500);
      const open = await page.evaluate(() => {
        const drawer = document.querySelector('.assistant-drawer').getBoundingClientRect();
        const main = document.querySelector('main')?.getBoundingClientRect();
        const shell = document.querySelector('.shell');
        const ball = document.querySelector('[data-assistant-ball]');
        const ballCs = getComputedStyle(ball);
        return {
          drawer: { l: drawer.left, r: drawer.right, t: drawer.top, w: drawer.width, h: drawer.height },
          radius: getComputedStyle(document.querySelector('.assistant-drawer')).borderRadius,
          overflow: getComputedStyle(document.querySelector('.assistant-drawer')).overflow,
          backdrop: getComputedStyle(document.querySelector('[data-assistant-backdrop]')).display,
          main: main ? { l: main.left, r: main.right, w: main.width } : null,
          padRight: parseInt(getComputedStyle(shell).paddingRight, 10) || 0,
          ballOpacity: ballCs.opacity,
          ballPointer: ballCs.pointerEvents,
        };
      });
      check('点悬浮球展开对话窗口', await page.evaluate(() => !!document.querySelector('[data-assistant-panel]')));
      check('桌面端是右侧浮窗（有宽度上限、圆角、裁切）',
        open.drawer.w >= 300 && open.drawer.w <= 500 && parseFloat(open.radius) >= 16 && open.overflow === 'hidden',
        JSON.stringify({ w: open.drawer.w, radius: open.radius, overflow: open.overflow }));
      check('桌面端不铺半透明遮罩（背后页面还能操作）', open.backdrop === 'none', open.backdrop);
      check('正文右侧让出与浮窗等宽的槽', open.padRight >= open.drawer.w + 16, JSON.stringify({ pad: open.padRight, drawer: open.drawer.w }));
      check('浮窗与正文不重叠（main 右边缘 ≤ 浮窗左边缘）',
        !!open.main && open.main.r <= open.drawer.l + 1, JSON.stringify({ main: open.main, drawer: open.drawer }));
      check('悬浮球在窗口展开时淡出', Number(open.ballOpacity) === 0 && open.ballPointer === 'none');
      check('浮窗顶部不压住顶栏', open.drawer.t >= 76, String(open.drawer.t));

      const behind = await page.evaluate(() => {
        const el = document.elementFromPoint(400, 560);
        return { inDrawer: !!el?.closest('.assistant-drawer'), inShell: !!el?.closest('.shell') };
      });
      check('浮窗外面点到的还是页面（不是遮罩）', behind.inShell && !behind.inDrawer, JSON.stringify(behind));

      await page.screenshot({ path: path.join(SHOTS, 'ball-verify-165-desktop.png') }).catch(() => {});

      // ---------- 5. 关闭：正文恢复、球回到记忆位置 ----------
      await page.click('[data-assistant-close]');
      await sleep(500);
      const closed = await page.evaluate(() => {
        const r = document.querySelector('[data-assistant-ball]').getBoundingClientRect();
        return {
          panel: !!document.querySelector('[data-assistant-panel]'),
          padRight: parseInt(getComputedStyle(document.querySelector('.shell')).paddingRight, 10) || 0,
          opacity: Number(getComputedStyle(document.querySelector('[data-assistant-ball]')).opacity),
          x: r.x,
          y: r.y,
        };
      });
      check('关闭后浮窗收起、正文恢复全宽', !closed.panel && closed.padRight === 0, JSON.stringify(closed));
      check('悬浮球回到记忆位置并重新出现',
        closed.opacity === 1 && Math.abs(closed.x - Number(stored?.x)) < 4 && Math.abs(closed.y - Number(stored?.y)) < 4,
        JSON.stringify(closed));

      // Esc 也能收
      await page.click('[data-assistant-ball]');
      await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 8000 });
      await page.keyboard.press('Escape');
      await sleep(500);
      check('Esc 也能收起浮窗', await page.evaluate(() => !document.querySelector('[data-assistant-panel]')));
    } finally {
      await clearPos(page);
    }
  }, { width: 1440, height: 900 });

  // ---------- 6. 窄桌面：浮窗展开时侧栏自动收成图标栏 ----------
  await withTab(async (page) => {
    await page.setViewport({ width: 1024, height: 800 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    await page.click('[data-assistant-ball]');
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
        drawerW: drawer.width,
        pad: parseInt(getComputedStyle(document.querySelector('.shell')).paddingRight, 10) || 0,
      };
    });
    check('1024 宽展开浮窗时侧栏临时收成图标栏（≤64px）', compact.sidebarW <= 64, JSON.stringify(compact));
    check('窄桌面正文仍然够宽（≥480px）且不被浮窗盖住',
      compact.mainW >= 480 && compact.mainR <= compact.drawerL + 1, JSON.stringify(compact));
    await page.screenshot({ path: path.join(SHOTS, 'ball-verify-165-compact.png') }).catch(() => {});
  }, { width: 1024, height: 800 });

  // ---------- 7. 手机：保持现状 ----------
  await withTab(async (page) => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await login(page, BASE);
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    const mobile = await page.evaluate(() => ({
      ball: getComputedStyle(document.querySelector('[data-assistant-ball]')).display,
      topbar: !!document.querySelector('[data-assistant-mobile]'),
    }));
    check('手机不显示悬浮球', mobile.ball === 'none');
    check('手机顶栏 AI 图标还在', mobile.topbar === true);
    await page.click('[data-assistant-mobile]');
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
    check('手机仍是整屏抽屉 + 遮罩（宽度 = 视口、圆角 0、正文不让槽）',
      mopen.w === 390 && mopen.h === 844 && mopen.backdrop !== 'none'
        && parseFloat(mopen.radius) < 1 && mopen.pad === 0,
      JSON.stringify(mopen));
    await page.screenshot({ path: path.join(SHOTS, 'ball-verify-165-mobile.png') }).catch(() => {});
    await page.keyboard.press('Escape');
  }, { width: 390, height: 844 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('出错:', err && err.message ? err.message : err);
  process.exit(1);
});
