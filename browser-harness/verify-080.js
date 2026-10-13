/**
 * 验证 0.8.0：日历右侧当天列表的行菜单（右键 / 行尾「⋯」）——修改、删除。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-080.js
 *
 * 数据：开始时用接口建一条「自检-行菜单-<时间戳>」放在今天，结束时用菜单删掉它
 * （删除本身就是要验的功能）；万一中途失败，收尾还会兜底用接口清理一次。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');
const TEST_TITLE = `自检-行菜单-${Date.now()}`;

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const api = (page, path, method = 'GET', body = null) => page.evaluate(async ({ base, path, method, body }) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE.replace(/\/$/, ''), path, method, body });

/** 行菜单当前状态。 */
const menuState = (page) => page.evaluate(() => {
  const el = document.querySelector('[role="menu"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    items: [...el.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()),
    x: Math.round(r.left),
    y: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= document.documentElement.clientWidth + 1 && r.bottom <= document.documentElement.clientHeight + 1,
    heading: (el.querySelector('p')?.textContent || '').trim(),
  };
});

/** 在同一天面板里右键某条（按标题找行）。 */
const rightClick = (page, title, offset = { x: 40, y: 20 }) => page.evaluate(({ title, offset }) => {
  const row = [...document.querySelectorAll('aside.surface article')].find((a) => a.textContent.includes(title));
  if (!row) return false;
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Math.round(r.left + offset.x), clientY: Math.round(r.top + offset.y),
  }));
  return true;
}, { title, offset });

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    // ---- 0. 造一条今天的自检提醒（用接口，保证落在今天这一格里） ----
    const today = await page.evaluate(() => {
      const d = new Date();
      d.setHours(9, 30, 0, 0);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00+08:00`;
    });
    let createdId = null;
    try {
      const created = await api(page, '/api/reminder/items', 'POST', {
        title: TEST_TITLE, due_at: today, repeat_rule: 'none', channels: ['inapp'],
      });
      createdId = created.body?.data?.id ?? null;
    } catch { /* 下面断言会报 */ }
    check('已用接口造一条今天的自检提醒', !!createdId, createdId ? `id=${createdId}` : '创建失败');

    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.cal-cell'), { timeout: 20000 });
    await sleep(1800);

    const inPanel = await page.evaluate((title) => {
      return [...document.querySelectorAll('aside.surface article')].some((a) => a.textContent.includes(title));
    }, TEST_TITLE);
    check('今天这一格里能看到这条提醒', inPanel);
    if (!inPanel) {
      // 面板默认选中的是「今天」，正常情况下就该看到；看不到多半是预填日期算错了
      await page.evaluate(() => {
        const cell = [...document.querySelectorAll('.cal-cell')].find((c) => c.querySelector('.bg-brand-500'));
        if (cell) cell.click();
      });
      await sleep(900);
    }

    // ---- 1. 右键打开菜单 ----
    const clicked = await rightClick(page, TEST_TITLE);
    check('能在这一行上触发右键', clicked);
    await waitFor(page, () => !!document.querySelector('[role="menu"]'), { timeout: 5000 });
    await sleep(300);
    let menu = await menuState(page);
    check('右键弹出菜单，含「修改」「删除」两项',
      !!menu && menu.items.join(',') === '修改,删除', menu ? menu.items.join(',') : '没弹出');
    check('菜单标题是这一行的标题', !!menu && menu.heading === TEST_TITLE, menu ? menu.heading : '');
    check('菜单出现在点击位置附近且在视野内',
      !!menu && menu.inViewport && menu.x > 0 && menu.y > 0, JSON.stringify(menu));
    await page.screenshot({ path: path.join(SHOTS, 'calendar-row-menu.png') });

    // ---- 2. 点「修改」→ 打开编辑器（居中弹窗，标题对上） ----
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes('修改'));
      btn.click();
    });
    await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 8000 });
    await sleep(600);
    const editor = await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const input = panel.querySelector('input');
      return {
        title: input ? input.value : null,
        radius: getComputedStyle(panel).borderTopLeftRadius,
        menuGone: !document.querySelector('[role="menu"]'),
      };
    });
    check('「修改」打开了这条提醒的编辑器（标题一致）', editor.title === TEST_TITLE, String(editor.title));
    check('打开编辑器后菜单自动收起', editor.menuGone === true);
    check('日历里打开的编辑器是居中弹窗（圆角卡片）', parseFloat(editor.radius) >= 12, editor.radius);
    await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const close = [...panel.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭');
      if (close) close.click();
    });
    await sleep(700);

    // ---- 3. 行尾「⋯」按钮也能开同一个菜单；Esc/点别处能收起 ----
    const dotOpened = await page.evaluate((title) => {
      const row = [...document.querySelectorAll('aside.surface article')].find((a) => a.textContent.includes(title));
      const btn = row ? row.querySelector('button[aria-haspopup="menu"]') : null;
      if (!btn) return false;
      btn.click();
      return true;
    }, TEST_TITLE);
    check('行尾有「⋯」按钮（触屏也能开菜单）', dotOpened);
    await sleep(400);
    check('「⋯」打开的是同一个菜单', (await menuState(page))?.items.join(',') === '修改,删除');
    await page.keyboard.press('Escape');
    await sleep(400);
    check('按 Esc 能收起菜单', (await menuState(page)) === null);

    await rightClick(page, TEST_TITLE);
    await sleep(300);
    await page.evaluate(() => document.body.click());
    await sleep(400);
    check('点空白处能收起菜单', (await menuState(page)) === null);

    // ---- 4. 右下角右键：菜单不能跑出屏幕 ----
    const corner = await page.evaluate((title) => {
      const row = [...document.querySelectorAll('aside.surface article')].find((a) => a.textContent.includes(title));
      if (!row) return null;
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.right), clientY: Math.round(r.bottom),
      }));
      return { rowRight: Math.round(r.right), rowBottom: Math.round(r.bottom) };
    }, TEST_TITLE);
    await sleep(400);
    const cornerMenu = await menuState(page);
    check('靠近屏幕右下角时菜单自动往回收（整块仍在视野内）',
      !!cornerMenu && cornerMenu.inViewport === true, JSON.stringify({ corner, menu: cornerMenu }));
    await page.keyboard.press('Escape');
    await sleep(300);

    // ---- 5. 删除：走确认浮层，确认后从日历与库中消失 ----
    await rightClick(page, TEST_TITLE);
    await sleep(300);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes('删除'));
      btn.click();
    });
    await sleep(600);
    const confirm = await page.evaluate((title) => {
      const dialog = [...document.querySelectorAll('.fixed.inset-0')].find((el) => /删除这条/.test(el.innerText));
      const text = (dialog || document.body).innerText;
      const confirmBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '删除' && b.closest('.fixed'));
      return {
        hasDialog: !!dialog,
        asksDelete: /删除这条提醒？/.test(text),
        mentionsTitle: text.includes(title),
        confirmVisible: !!confirmBtn,
      };
    }, TEST_TITLE);
    check('菜单里的「删除」先弹确认浮层（不是直接删）', confirm.hasDialog && confirm.asksDelete, JSON.stringify(confirm));
    check('确认浮层里写明了是哪一条', confirm.mentionsTitle === true);
    await page.screenshot({ path: path.join(SHOTS, 'calendar-row-menu-confirm.png') });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '删除' && b.closest('.fixed'));
      btn.click();
    });
    await sleep(1500);

    const goneFromUi = await page.evaluate((title) => {
      return ![...document.querySelectorAll('aside.surface article')].some((a) => a.textContent.includes(title));
    }, TEST_TITLE);
    check('确认后这条从日历右侧列表消失', goneFromUi === true);

    const goneFromApi = await page.evaluate(async ({ base, id }) => {
      const token = localStorage.getItem('reminders.token');
      const res = await fetch(`${base}/api/reminder/items/${id}`, { headers: { Authorization: 'Bearer ' + token } });
      const body = await res.json().catch(() => null);
      // 软删除后按 id 查会 404 或错误；列表里也应当查不到
      const list = await fetch(base + '/api/reminder/items?view=all&status=all', { headers: { Authorization: 'Bearer ' + token } });
      const listBody = await list.json();
      return { direct: res.status, inList: (listBody.data || []).some((i) => i.id === id) };
    }, { base: BASE.replace(/\/$/, ''), id: createdId });
    check('库里也查不到了（软删除落地）', goneFromApi.inList === false, JSON.stringify(goneFromApi));

    // ---- 6. 手机端：日历整体不提供，所以这条行菜单是电脑端特性 ----
    // 0.10.x 起手机端隐藏日历视图（入口隐藏 + 路由守卫兜底），日历右侧列表的行菜单
    // 在手机上自然用不到；这里断言「手机端确实进不去」，免得将来又漏出一个入口。
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const mobileNoCal = await page.evaluate(() => ({
      url: location.pathname,
      cells: document.querySelectorAll('.cal-cell').length,
      menuButtons: document.querySelectorAll('button[aria-haspopup="menu"]').length,
    }));
    check('手机端进不了日历（没有月历格子、也没有行菜单入口）',
      !mobileNoCal.url.includes('calendar') && mobileNoCal.cells === 0,
      JSON.stringify(mobileNoCal));
    check('手机端被送到列表视图后页面正常（有列表内容）',
      await page.evaluate(() => !!document.querySelector('.quick-card') || document.body.innerText.includes('我的清单')));
    await page.screenshot({ path: path.join(SHOTS, 'calendar-row-menu-mobile.png') });
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });

    // 兜底清理（正常路径上第 5 步已经删掉了）
    if (createdId) {
      const leftover = await api(page, `/api/reminder/items/${createdId}`, 'DELETE');
      check('收尾兜底清理（已删则为幂等的 404/400）', true, `status=${leftover.status}`);
    }
    check('全过程结束时没有残留的行菜单', (await menuState(page)) === null);
    console.log(`  截图：${path.join(SHOTS, 'calendar-row-menu.png')} / calendar-row-menu-confirm.png / calendar-row-menu-mobile.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
