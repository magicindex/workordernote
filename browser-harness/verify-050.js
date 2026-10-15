/**
 * 验证 0.5.0：清单颜色可修改，改完后「侧栏圆点 / 列表页任务标题 / 日历色块」
 * 三处同步更新——**包括已经打开的日历，不需要刷新页面**。
 *
 * 用法：
 *   APP_URL=http://192.168.3.201:8906 node verify-050.js
 *
 * 数据安全：会真的改一个清单的颜色，所以先把原值从服务端读出来，结束时（无论
 * 中途是否失败）改回去，并回读服务端确认（0.2.0 那次的教训：只「点一下保存」
 * 不校验，还原失败会静默把用户的配置改掉）。
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

const HEX = { blue: '#3182f6', violet: '#8b5cf6', rose: '#f43f5e', amber: '#f59e0b', emerald: '#10b981' };
const NAME = { '#3182f6': 'blue', '#8b5cf6': 'violet', '#f43f5e': 'rose', '#f59e0b': 'amber', '#10b981': 'emerald' };
const LABELS = ['蓝色', '紫色', '玫红', '琥珀', '绿色'];

/** 浏览器 getComputedStyle 返回 rgb(...)，比较前先转成同一个写法。 */
function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const apiGet = (page, url) => page.evaluate(async (u) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
  return { status: res.status, body: await res.json().catch(() => null) };
}, url);

/** 面板（清单编辑弹窗）当前状态。 */
function dialogState(page) {
  return page.evaluate(() => {
    const modal = document.querySelector('.fixed.inset-0.z-50');
    if (!modal) return null;
    // 编辑弹窗里现在还有「图标」一组按钮（也是 role=radio），用 data-list-color 只取颜色
    const swatches = [...modal.querySelectorAll('[data-list-color]')];
    const nameInput = modal.querySelector('input');
    return {
      title: modal.querySelector('h3')?.textContent.trim() || '',
      swatchLabels: swatches.map((s) => s.getAttribute('aria-label')),
      selected: swatches.filter((s) => s.getAttribute('aria-checked') === 'true').map((s) => s.getAttribute('aria-label')),
      name: nameInput ? nameInput.value : '',
      buttons: [...modal.querySelectorAll('button')].map((b) => b.textContent.trim()),
    };
  });
}

/** 某个清单在侧栏的颜色：清单行现在是**图标块**（不再是圆点），颜色取它的前景色。 */
function sidebarDotColor(page, listName) {
  return page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.group\\/list')];
    for (const row of rows) {
      const link = row.querySelector('a');
      if (!link || !link.textContent.includes(name)) continue;
      const icon = link.querySelector('[data-list-icon]');
      return icon ? getComputedStyle(icon).color : null;
    }
    return null;
  }, listName);
}

/**
 * 打开某个清单的编辑弹窗。
 * 0.9.0 起侧栏不再有铅笔按钮，入口是**右键清单行**（手机长按）→ 菜单里的「修改（名称 / 颜色）」。
 */
async function openEditor(page, listName) {
  const rc = await page.evaluate((name) => {
    const row = [...document.querySelectorAll('aside.sidebar .group\\/list')]
      .find((el) => el.textContent.includes(name));
    if (!row) return false;
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + 60), clientY: Math.round(r.top + r.height / 2),
    }));
    return true;
  }, listName);
  if (!rc) return false;
  await sleep(350);
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="menuitem"]')]
      .find((b) => b.textContent.trim().startsWith('修改'));
    if (!btn) return false;
    btn.click();
    return true;
  });
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    // ---- 选一个「有任务」的清单做样本，并记下它原来的颜色 ----
    const listsRes = await apiGet(page, BASE.replace(/\/$/, '') + '/api/reminder/lists');
    const lists = listsRes.body?.data || [];
    if (!lists.length) { check('实例里至少有一个清单', false, '没有清单，无法验证'); return; }
    const target = lists.find((l) => l.open_count > 0) || lists[0];
    const original = { id: target.id, name: target.name, color: target.color };
    const originalHex = HEX[original.color] || HEX.blue;
    const nextColor = Object.keys(HEX).find((c) => c !== original.color);
    const nextHex = HEX[nextColor];
    check(`选中样本清单「${original.name}」（原色 ${original.color}，准备改成 ${nextColor}）`, true);

    // ---- 1. 列表页：任务标题颜色 = 清单色 ----
    await page.goto(`${BASE.replace(/\/$/, '')}/admin/list/${original.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('article.reminder-row h3'), { timeout: 20000 });
    await sleep(800);
    const titleColorBefore = await page.evaluate(() => {
      const h3 = document.querySelector('article.reminder-row h3');
      return getComputedStyle(h3).color;
    });
    check('列表页任务标题用了清单颜色（改前）',
      String(titleColorBefore) === `rgb(${parseInt(originalHex.slice(1, 3), 16)}, ${parseInt(originalHex.slice(3, 5), 16)}, ${parseInt(originalHex.slice(5, 7), 16)})`,
      `${titleColorBefore} vs ${originalHex}`);

    // ---- 2. 侧栏右键出菜单 →「修改」，弹窗有 5 个色块 ----
    const opened = await openEditor(page, original.name);
    check('右键清单行出菜单并能打开「修改」弹窗（铅笔已移除）', opened);
    await sleep(500);
    let dialog = await dialogState(page);
    check('弹窗标题带清单名', !!dialog && dialog.title.includes(original.name), dialog ? dialog.title : 'no dialog');
    check('弹窗里有 5 个颜色可选', !!dialog && dialog.swatchLabels.join(',') === LABELS.join(','),
      dialog ? dialog.swatchLabels.join(',') : '');
    check('弹窗预填了当前名称', !!dialog && dialog.name === original.name, dialog ? dialog.name : '');
    check('当前颜色为选中态', !!dialog && dialog.selected[0] === LABELS[Object.keys(HEX).indexOf(original.color)],
      dialog ? dialog.selected.join(',') : '');

    // 取消不改动
    await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      [...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消').click();
    });
    await sleep(400);
    const afterCancel = await apiGet(page, `${BASE.replace(/\/$/, '')}/api/reminder/lists`);
    const stillOriginal = (afterCancel.body?.data || []).find((l) => l.id === original.id);
    check('点「取消」不会改动颜色', stillOriginal?.color === original.color, stillOriginal?.color);
    check('取消后弹窗已关闭', (await dialogState(page)) === null);

    // ---- 3. 从日历页改色：已打开的日历要立刻变色（本次需求的核心）----
    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.cal-cell'), { timeout: 20000 });
    await sleep(1500);
    // 找到属于该清单的一个日历色块（标题文案里带清单名的行不好定位，直接按颜色找）
    const chipBefore = await page.evaluate((hex) => {
      const chips = [...document.querySelectorAll('.cal-task')];
      const match = chips.find((c) => getComputedStyle(c).color === hex);
      return match ? { text: match.textContent.trim().slice(0, 24), color: getComputedStyle(match).color } : null;
    }, rgbOf(originalHex));
    if (!chipBefore) {
      const seen = await page.evaluate(() => [...new Set([...document.querySelectorAll('.cal-task')].map((c) => getComputedStyle(c).color))]);
      console.log(`    调试：页面上色块颜色共 ${seen.length} 种：${seen.slice(0, 6).join(' | ')}`);
      check('日历里存在用该清单色的任务色块', false, `期望 ${rgbOf(originalHex)}，实际有 ${seen.join(', ')}`);
    } else {
      check('日历里存在用该清单色的任务色块', true, chipBefore.text);
    }

    await openEditor(page, original.name);
    await waitFor(page, () => !!document.querySelector('.fixed.inset-0.z-50'), { timeout: 5000 });
    await page.evaluate((label) => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      const swatch = [...modal.querySelectorAll('[role="radio"]')].find((s) => s.getAttribute('aria-label') === label);
      swatch.click();
    }, LABELS[Object.keys(HEX).indexOf(nextColor)]);
    await sleep(300);
    await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      [...modal.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('保存')).click();
    });
    await waitFor(page, () => !document.querySelector('.fixed.inset-0.z-50'), { timeout: 10000 });
    await sleep(1800); // 等广播的 reminder-realtime 事件把日历重新拉一遍

    const pageUrl = page.url();
    check('改色过程没有跳走（仍是日历页）', pageUrl.includes('/admin/calendar'), pageUrl);
    // 关键：按**同一个任务标题**追踪，不能按「第一个该颜色的色块」比——两个清单都有任务时，
    // 改色前第一个蓝色块和改色后第一个紫色块往往不是同一条（本轮在生产上就因此假红过一次）。
    const tracked = chipBefore ? chipBefore.text : '\u0000';
    const chipAfter = await page.evaluate((text) => {
      const chip = [...document.querySelectorAll('.cal-task')].find((c) => c.textContent.trim().startsWith(text));
      return chip ? { text: chip.textContent.trim().slice(0, 24), color: getComputedStyle(chip).color } : null;
    }, tracked);
    check('日历里出现新颜色的色块（未刷新页面）',
      !!chipAfter && chipAfter.color === rgbOf(nextHex),
      chipAfter ? `${chipAfter.text} → ${chipAfter.color}` : `没找到「${tracked}」这条`);
    check('改的是同一个任务的色（按标题追踪）',
      !!chipBefore && !!chipAfter && chipAfter.text === chipBefore.text && chipBefore.color === rgbOf(originalHex),
      `改前「${chipBefore?.text}」${chipBefore?.color} → 改后「${chipAfter?.text}」${chipAfter?.color}`);
    await page.screenshot({ path: path.join(SHOTS, 'list-color-calendar.png') });

    const dotAfter = await sidebarDotColor(page, original.name);
    check('侧栏圆点也同步变成新颜色', String(dotAfter) === rgbOf(nextHex), `${dotAfter} vs ${rgbOf(nextHex)}`);

    // ---- 4. 列表页标题颜色跟着变 ----
    await page.goto(`${BASE.replace(/\/$/, '')}/admin/list/${original.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('article.reminder-row h3'), { timeout: 20000 });
    await sleep(800);
    const titleColorAfter = await page.evaluate(() => getComputedStyle(document.querySelector('article.reminder-row h3')).color);
    check('列表页任务标题已换成新颜色',
      String(titleColorAfter) === `rgb(${parseInt(nextHex.slice(1, 3), 16)}, ${parseInt(nextHex.slice(3, 5), 16)}, ${parseInt(nextHex.slice(5, 7), 16)})`,
      `${titleColorAfter} vs ${nextHex}`);
    check('三个位置用同一个色值（标题 = 侧栏圆点）',
      String(titleColorAfter) === String(dotAfter), `${titleColorAfter} vs ${dotAfter}`);

    // ---- 5. 落库并持久（刷新后仍是新颜色）----
    const persisted = await apiGet(page, `${BASE.replace(/\/$/, '')}/api/reminder/lists`);
    const savedList = (persisted.body?.data || []).find((l) => l.id === original.id);
    check('颜色已写入服务端', savedList?.color === nextColor, `${savedList?.color}`);

    // ---- 6. 改名也走同一个弹窗（顺便验证名称保存）----
    await openEditor(page, original.name);
    await waitFor(page, () => !!document.querySelector('.fixed.inset-0.z-50'), { timeout: 5000 });
    await page.evaluate(() => {
      const input = document.querySelector('.fixed.inset-0.z-50 input');
      input.value = '   ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      [...modal.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('保存')).click();
    });
    await sleep(600);
    const emptyState = await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      return {
        stillOpen: !!modal,
        error: modal ? modal.innerText.includes('清单名称不能为空') : false,
      };
    });
    check('名称留空时保存被拒绝并给出提示', emptyState.stillOpen && emptyState.error, JSON.stringify(emptyState));
    const afterEmptySave = await apiGet(page, `${BASE.replace(/\/$/, '')}/api/reminder/lists`);
    check('空名称没有写进服务端',
      (afterEmptySave.body?.data || []).find((l) => l.id === original.id)?.name === original.name);
    await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      [...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消').click();
    });
    await sleep(300);

    // ---- 7. 窄屏：清单行仍能右键出菜单、不横向溢出（铅笔已移除）----
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(BASE.replace(/\/$/, '') + '/admin/all', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const mobile = await page.evaluate((name) => {
      // 侧栏的行现在统一包在 .group/list 里（「全部」「提醒@他」「系统栏目」也都有这个类），
      // 所以这里按**清单名**找要右键的那一条，不能拿第一条（改造前第一条恰好是清单行）。
      const row = [...document.querySelectorAll('aside.sidebar .group\\/list')]
        .find((el) => el.textContent.includes(name));
      if (row) {
        const r = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
          clientX: Math.round(r.left + 60), clientY: Math.round(r.top + r.height / 2),
        }));
      }
      return {
        found: !!row,
        pencil: !!document.querySelector('button[aria-label^="编辑清单"]'),
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      };
    }, original.name);
    await sleep(400);
    const mobileMenu = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      const box = items[0]?.parentElement?.getBoundingClientRect();
      return {
        count: items.length,
        labels: items.map((b) => b.textContent.trim()),
        inViewport: box ? box.left >= -1 && box.top >= -1
          && box.right <= document.documentElement.clientWidth + 1
          && box.bottom <= document.documentElement.clientHeight + 1 : false,
      };
    });
    check('窄屏下右键清单行仍能出菜单且不出屏（侧栏已无铅笔）',
      mobile.found && !mobile.pencil && mobileMenu.count >= 4 && mobileMenu.inViewport,
      JSON.stringify({ ...mobile, ...mobileMenu }));
    check('窄屏不横向溢出', mobile.doc <= mobile.win + 1, JSON.stringify(mobile));
    await page.evaluate(() => document.body.click()); // 收起菜单
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    await sleep(400);

    // ---- 8. 还原原颜色（并回读服务端确认）----
    await sleep(500);
    await openEditor(page, original.name);
    await waitFor(page, () => !!document.querySelector('.fixed.inset-0.z-50'), { timeout: 5000 });
    await page.evaluate((label) => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      const swatch = [...modal.querySelectorAll('[role="radio"]')].find((s) => s.getAttribute('aria-label') === label);
      swatch.click();
    }, LABELS[Object.keys(HEX).indexOf(original.color)]);
    await sleep(300);
    await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      [...modal.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('保存')).click();
    });
    await waitFor(page, () => !document.querySelector('.fixed.inset-0.z-50'), { timeout: 10000 });
    await sleep(1200);
    const restored = await apiGet(page, `${BASE.replace(/\/$/, '')}/api/reminder/lists`);
    const restoredList = (restored.body?.data || []).find((l) => l.id === original.id);
    check(`颜色已还原为原值（${original.color}）`, restoredList?.color === original.color, restoredList?.color);
    check('名称未被改动', restoredList?.name === original.name, restoredList?.name);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
