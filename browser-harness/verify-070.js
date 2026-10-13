/**
 * 验证 0.7.0：日历视图的「新建 / 编辑」改成居中悬浮弹窗，列表视图仍是右侧抽屉。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-070.js
 *
 * 只读为主：打开新建弹窗后不保存（点关闭/遮罩关闭），结束时不会留下任何数据。
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

/** 编辑器外壳的几何：居中还是贴右。 */
const panelBox = (page) => page.evaluate(() => {
  const panel = document.querySelector('.editor-panel');
  if (!panel) return null;
  const r = panel.getBoundingClientRect();
  const cs = getComputedStyle(panel);
  // 居中要按**布局宽度**（clientWidth/clientHeight）算：window.innerWidth 把经典滚动条
  // 也算进去了，直接拿它比会得到「左 395 / 右 405」这种假不对称（本轮 4 条断言就是这么假红的）。
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  return {
    left: Math.round(r.left),
    right: Math.round(r.right),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    width: Math.round(r.width),
    height: Math.round(r.height),
    radius: cs.borderTopLeftRadius,
    maxWidth: cs.maxWidth,
    viewportW: vw,
    viewportH: vh,
    windowW: window.innerWidth,
    // 左右留白是否对称（居中）/ 右侧是否贴边（抽屉）
    gapLeft: Math.round(r.left),
    gapRight: Math.round(vw - r.right),
    gapTop: Math.round(r.top),
    gapBottom: Math.round(vh - r.bottom),
    // 表单内部可滚动区域与底部按钮是否都在
    scrollArea: !!panel.querySelector('.overflow-y-auto'),
    submitVisible: [...panel.querySelectorAll('button')].some((b) => /保存/.test(b.textContent) && b.getBoundingClientRect().height > 0),
    title: (panel.querySelector('h2')?.textContent || '').trim(),
    docOverflowX: document.documentElement.scrollWidth - vw,
  };
});

const clickNewInDayPanel = (page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll('aside.surface button')].find((b) => b.textContent.includes('新建'));
  if (!btn) return false;
  btn.click();
  return true;
});

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    // ---- 1. 日历：新建 → 居中弹窗 ----
    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.cal-cell'), { timeout: 20000 });
    await sleep(1500);
    const opened = await clickNewInDayPanel(page);
    check('日历右侧详情里有「新建」入口', opened);
    await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 10000 });
    await sleep(500);
    let box = await panelBox(page);
    check('日历里新建编辑器已打开', !!box, box ? '' : '没找到 .editor-panel');
    if (!box) return;

    check('是居中弹窗（左右留白对称，不贴右边）',
      Math.abs(box.gapLeft - box.gapRight) <= 2 && box.gapLeft > 24,
      JSON.stringify({ gapLeft: box.gapLeft, gapRight: box.gapRight, width: box.width }));
    check('上下也居中（上下留白接近且都 > 0）',
      Math.abs(box.gapTop - box.gapBottom) <= 4 && box.gapTop > 8,
      JSON.stringify({ gapTop: box.gapTop, gapBottom: box.gapBottom, height: box.height }));
    check('是圆角卡片（不是整条铺满的抽屉）',
      parseFloat(box.radius) >= 12 && box.width < box.viewportW - 40 && box.height < box.viewportH,
      JSON.stringify({ radius: box.radius, w: box.width, h: box.height, vw: box.viewportW, vh: box.viewportH }));
    check('弹窗宽度是居中卡片的量级（≤700px）', box.width >= 400 && box.width <= 700, String(box.width));
    check('表单可滚动区与「保存」按钮都在',
      box.scrollArea && box.submitVisible, JSON.stringify({ scroll: box.scrollArea, submit: box.submitVisible }));
    check('标题是新建（日历里的新建走弹窗）', /新建/.test(box.title), box.title);

    // ---- 1b. 通知方式在弹窗里收起，整张卡装得下 ----
    const modalDetail = await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const scroll = [...panel.querySelectorAll('.overflow-y-auto')].pop();
      return {
        channelButtons: panel.querySelectorAll('.channel-option').length,
        hint: /通知方式沿用/.test(panel.innerText),
        contentH: scroll ? scroll.scrollHeight : null,
        visibleH: scroll ? scroll.clientHeight : null,
        needsScroll: scroll ? scroll.scrollHeight > scroll.clientHeight + 1 : null,
        panelH: Math.round(panel.getBoundingClientRect().height),
        viewportH: document.documentElement.clientHeight,
        footerVisible: [...panel.querySelectorAll('button')].some((b) => /保存/.test(b.textContent) && b.getBoundingClientRect().bottom <= document.documentElement.clientHeight),
      };
    });
    check('弹窗里不再显示「通知方式」渠道格子', modalDetail.channelButtons === 0,
      `渠道按钮 ${modalDetail.channelButtons} 个`);
    check('弹窗里有一行说明（渠道沿用默认，要改去列表视图）', modalDetail.hint === true);
    check('整张卡片一张显示完整（内容不超出可视区，不需要内滚）',
      modalDetail.needsScroll === false, JSON.stringify({ content: modalDetail.contentH, visible: modalDetail.visibleH }));
    check('卡片高度不超过视口，底部「保存」在视野内',
      modalDetail.panelH <= modalDetail.viewportH && modalDetail.footerVisible === true,
      JSON.stringify({ panelH: modalDetail.panelH, viewportH: modalDetail.viewportH }));
    check('弹窗打开时没有横向溢出', box.docOverflowX <= 1, String(box.docOverflowX));
    await page.screenshot({ path: path.join(SHOTS, 'calendar-modal-create.png') });

    // 遮罩点击关闭
    await page.evaluate(() => {
      const backdrop = document.querySelector('.editor-panel')?.parentElement?.querySelector('.absolute.inset-0');
      if (backdrop) backdrop.click();
    });
    await sleep(600);
    check('点遮罩能关闭弹窗', (await panelBox(page)) === null);

    // ---- 2. 双击日期格也是同一个弹窗 ----
    await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.cal-cell')][10];
      if (cell) cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await sleep(900);
    const dbl = await panelBox(page);
    check('双击日期格新建也是居中弹窗',
      !!dbl && Math.abs(dbl.gapLeft - dbl.gapRight) <= 2 && dbl.gapLeft > 24,
      dbl ? JSON.stringify({ gapLeft: dbl.gapLeft, gapRight: dbl.gapRight }) : '没打开');
    await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const close = panel ? [...panel.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭') : null;
      if (close) close.click();
    });
    await sleep(600);
    check('关闭按钮能关掉弹窗', (await panelBox(page)) === null);

    // ---- 2b. 在弹窗里真的建一条：落到当天、保存后关闭、再清掉 ----
    const TEST_TITLE = `自检-弹窗新建-${Date.now()}`;
    const dayKey = await page.evaluate(() => {
      // 选一个「本月内的今天」，双击它就是给这天的预填
      const cells = [...document.querySelectorAll('.cal-cell')];
      const today = cells.find((c) => c.querySelector('.bg-brand-500'));
      const target = today || cells[10];
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const n = target.querySelector('span')?.textContent?.trim() || '';
      return { day: n };
    });
    await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 10000 });
    await sleep(500);
    await page.evaluate((title) => {
      const input = document.querySelector('.editor-panel input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, TEST_TITLE);
    await sleep(300);
    await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const btn = [...panel.querySelectorAll('button')].find((b) => /保存/.test(b.textContent));
      btn.click();
    });
    const saved = await waitFor(page, () => !document.querySelector('.editor-panel'), { timeout: 15000 });
    check('在居中弹窗里保存后会自动关闭', saved);
    await sleep(1200);

    const created = await page.evaluate(async ({ base, title }) => {
      const token = localStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/items?view=all&status=all', { headers: { Authorization: 'Bearer ' + token } });
      const body = await res.json();
      const hit = (body.data || []).find((i) => i.title === title);
      return hit ? { id: hit.id, due: hit.due_at, list: hit.list_name } : null;
    }, { base: BASE.replace(/\/$/, ''), title: TEST_TITLE });
    check('弹窗里建出来的提醒真的落库了', !!created, created ? JSON.stringify(created) : '接口里查不到');
    check('预填的是双击那天的日期（不是空日期）', !!created && !!created.due, created ? String(created.due) : '');

    // 隐藏了渠道 UI，但保存时仍要带上默认渠道（否则新提醒不会通知）
    const channelOf = await page.evaluate(async ({ base, id }) => {
      const token = localStorage.getItem('reminders.token');
      const res = await fetch(`${base}/api/reminder/items/${id}`, { headers: { Authorization: 'Bearer ' + token } });
      const body = await res.json();
      return body.data ? body.data.channels : null;
    }, { base: BASE.replace(/\/$/, ''), id: created ? created.id : 0 });
    check('弹窗建出来的提醒仍然带默认通知渠道（inapp）',
      Array.isArray(channelOf) && channelOf.includes('inapp'), JSON.stringify(channelOf));

    // 再从日历弹窗打开它并保存一次：隐藏渠道不能把原有渠道清掉
    if (created) {
      await page.evaluate((title) => {
        const chip = [...document.querySelectorAll('.cal-task')].find((c) => c.textContent.includes(title));
        if (chip) chip.click();
      }, TEST_TITLE);
      await sleep(900);
      const editOpened = await page.evaluate(() => {
        const article = [...document.querySelectorAll('aside.surface article')].find((a) => /自检-弹窗新建/.test(a.textContent));
        const btn = article ? article.querySelector('button.min-w-0') : null;
        if (btn) btn.click();
        return !!btn;
      });
      // 0.19.0 起：**单击任务先弹「查看」页**，要点查看页底部的「编辑」才进编辑器。
      if (editOpened) {
        await waitFor(page, () => !!document.querySelector('[data-reminder-view]'), { timeout: 8000 });
        await page.evaluate(() => document.querySelector('[data-view-edit]')?.click());
        await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 8000 });
        await sleep(600);
        const editIsModal = await page.evaluate(() => {
          const panel = document.querySelector('.editor-panel');
          const cs = getComputedStyle(panel);
          return { radius: cs.borderTopLeftRadius, channels: panel.querySelectorAll('.channel-option').length };
        });
        check('从日历打开已有提醒也是同一个居中弹窗（且不显示渠道格子）',
          parseFloat(editIsModal.radius) >= 12 && editIsModal.channels === 0, JSON.stringify(editIsModal));
        await page.evaluate(() => {
          const panel = document.querySelector('.editor-panel');
          [...panel.querySelectorAll('button')].find((b) => /保存/.test(b.textContent)).click();
        });
        await waitFor(page, () => !document.querySelector('.editor-panel'), { timeout: 15000 });
        await sleep(800);
        const channelAfter = await page.evaluate(async ({ base, id }) => {
          const token = localStorage.getItem('reminders.token');
          const res = await fetch(`${base}/api/reminder/items/${id}`, { headers: { Authorization: 'Bearer ' + token } });
          const body = await res.json();
          return body.data ? body.data.channels : null;
        }, { base: BASE.replace(/\/$/, ''), id: created.id });
        check('在弹窗里保存后原渠道没被清掉', Array.isArray(channelAfter) && channelAfter.includes('inapp'),
          JSON.stringify(channelAfter));
      }
    }

    // 日历上应当当天就能看到它。注意格子每天只铺 3 条（MAX_CHIPS），当天条目多时新条目
    // 会被挤成「+N」，所以先点开那天的详情面板，在面板里查（面板列出当天全部）。
    await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.cal-cell')].find((c) => c.querySelector('.bg-brand-500'));
      if (cell) cell.click();
    });
    await sleep(900);
    const onCalendar = await page.evaluate((title) => {
      const inPanel = [...document.querySelectorAll('aside.surface article')].some((a) => a.textContent.includes(title));
      const inChips = [...document.querySelectorAll('.cal-task')].some((c) => c.textContent.includes(title));
      return { inPanel, inChips };
    }, TEST_TITLE);
    check('新提醒出现在当天（格子里或右侧详情里）',
      onCalendar.inPanel || onCalendar.inChips, JSON.stringify(onCalendar));

    // 清理：软删掉这条自检数据
    if (created) {
      const removed = await page.evaluate(async ({ base, id }) => {
        const token = localStorage.getItem('reminders.token');
        const res = await fetch(`${base}/api/reminder/items/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
        return res.ok;
      }, { base: BASE.replace(/\/$/, ''), id: created.id });
      check('自检提醒已清理（软删除）', removed === true);
      await sleep(800);
      const stillThere = await page.evaluate(async ({ base, title }) => {
        const token = localStorage.getItem('reminders.token');
        const res = await fetch(base + '/api/reminder/items?view=all&status=all', { headers: { Authorization: 'Bearer ' + token } });
        const body = await res.json();
        return (body.data || []).some((i) => i.title === title);
      }, { base: BASE.replace(/\/$/, ''), title: TEST_TITLE });
      check('清理后列表里不再有它', stillThere === false);
    }

    // ---- 3. 列表视图仍是右侧抽屉 ----
    await page.goto(BASE.replace(/\/$/, '') + '/admin/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('article.reminder-row h3'), { timeout: 20000 });
    await sleep(900);
    await page.evaluate(() => {
      const h3 = document.querySelector('article.reminder-row h3');
      if (h3) h3.closest('button').click();
    });
    await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 10000 });
    await sleep(500);
    const drawer = await panelBox(page);
    check('列表视图里仍然是右侧抽屉（贴右、全高）',
      !!drawer && drawer.gapRight <= 2 && drawer.gapLeft > 100 && drawer.height >= drawer.viewportH - 2,
      drawer ? JSON.stringify({ gapRight: drawer.gapRight, gapLeft: drawer.gapLeft, h: drawer.height, vh: drawer.viewportH }) : '没打开');
    check('抽屉是方的（不带居中弹窗的圆角）', !!drawer && parseFloat(drawer.radius) === 0, drawer ? drawer.radius : '');
    const drawerChannels = await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      return {
        channels: panel.querySelectorAll('.channel-option').length,
        hasTitle: /通知方式/.test(panel.innerText),
      };
    });
    check('列表视图的抽屉里「通知方式」仍然完整可编辑',
      drawerChannels.channels >= 1 && drawerChannels.hasTitle === true, JSON.stringify(drawerChannels));
    await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const close = panel ? [...panel.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭') : null;
      if (close) close.click();
    });
    await sleep(600);

    // ---- 4. 手机宽度：日历视图不提供，编辑器改从列表页以抽屉形态打开 ----
    // 0.10.x 起手机端不提供日历视图（入口隐藏 + 路由守卫），「双击日期格开居中弹窗」
    // 这条路径在手机上已不存在；这里改成验「小屏上编辑面板照常可用」——
    // 用的是同一个 ReminderEditor，字段与保存行为一致。
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const noCal = await page.evaluate(() => ({ url: location.pathname, cells: document.querySelectorAll('.cal-cell').length }));
    check('手机端访问 /admin/calendar 被送到列表视图（没有月历格子）',
      !noCal.url.includes('calendar') && noCal.cells === 0, JSON.stringify(noCal));

    await page.goto(BASE.replace(/\/$/, '') + '/admin/all', { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => !!document.querySelector('article.reminder-row'), { timeout: 20000 });
    await sleep(1200);
    await page.evaluate(() => {
      const row = document.querySelector('article.reminder-row');
      const btn = row && row.querySelector('button.min-w-0.flex-1.text-left');
      if (btn) btn.click();
    });
    await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 10000 });
    await sleep(600);
    const mobile = await panelBox(page);
    check('手机上编辑面板不横向溢出', !!mobile && mobile.docOverflowX <= 1, String(mobile?.docOverflowX));
    check('手机上编辑面板宽度不超过视口', !!mobile && mobile.width <= mobile.viewportW + 1,
      `${mobile?.width} vs ${mobile?.viewportW}`);
    check('手机上「保存」按钮仍在视野内', !!mobile && mobile.submitVisible && mobile.bottom <= mobile.viewportH,
      JSON.stringify({ bottom: mobile?.bottom, vh: mobile?.viewportH }));
    await page.screenshot({ path: path.join(SHOTS, 'calendar-modal-mobile.png') });
    await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const close = panel ? [...panel.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭') : null;
      if (close) close.click();
    });
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    await sleep(400);
    check('全过程结束时没有残留的编辑器面板', (await panelBox(page)) === null);
    console.log(`  截图：${path.join(SHOTS, 'calendar-modal-create.png')} / calendar-modal-mobile.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
