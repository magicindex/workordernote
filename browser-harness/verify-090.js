/**
 * 验证 0.9.0 的四件事：
 *   1) 「我的清单」不再有铅笔图标；右键（触屏长按）弹出菜单：重命名 / 修改 / 设为默认 / 删除；
 *      重命名是就地改（回车保存），删除清单要确认，默认清单不可删。
 *   2) 左上角 logo 变成「列表 ⇄ 日历」切换：点一下去日历，再点一下回列表。
 *   3) 列表视图快速新建：「更多」前边常显一个清单选择，默认取后台设置里的默认清单，
 *      选了别的清单新建就进那个清单（新建完回到默认）。
 *   4) 今天/计划/全部 的「未完成 / 全部」默认是未完成，且只存在浏览器本地（换浏览器即默认值）。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-090.js
 * 数据：临时建一个清单（用完从菜单里删掉）+ 临时提醒（用完删掉）；清单改名/折叠偏好都还原。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');
const ROOT = BASE.replace(/\/$/, '');
const STAMP = Date.now();
const TEMP_LIST = `自检清单-${STAMP}`;
const TEMP_RENAMED = `自检改名-${STAMP}`;
const TEMP_TASK = `自检-快速新建-${STAMP}`;

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
}, { base: ROOT, path, method, body });

const menuState = (page) => page.evaluate(() => {
  const el = document.querySelector('[role="menu"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    items: [...el.querySelectorAll('[role="menuitem"]')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })),
    heading: (el.querySelector('p')?.textContent || '').trim(),
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= document.documentElement.clientWidth + 1 && r.bottom <= document.documentElement.clientHeight + 1,
  };
});

const rightClickList = (page, name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll('aside.sidebar .group\\/list')].find((el) => el.textContent.includes(name));
  if (!row) return false;
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Math.round(r.left + 60), clientY: Math.round(r.top + r.height / 2),
  }));
  return true;
}, name);

const clickMenuItem = (page, label) => page.evaluate((label) => {
  const btn = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes(label));
  if (!btn) return false;
  btn.click();
  return true;
}, label);

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    // 记下要还原的东西
    const original = await page.evaluate(() => {
      try { return { rail: localStorage.getItem('ui_rail_collapsed'), status: localStorage.getItem('ui_list_status') } } catch { return { rail: null, status: null } }
    });
    const listsBefore = (await api(page, '/api/reminder/lists')).body?.data || [];
    const defaultList = listsBefore.find((l) => l.is_default) || listsBefore[0];
    check('读到了默认清单（后台设置）', !!defaultList, defaultList ? defaultList.name : '没有清单');

    await page.goto(ROOT + '/admin/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('aside.sidebar .group\\/list'), { timeout: 20000 });
    await sleep(1000);

    // ================= 1) 清单行：没有铅笔，右键出菜单 =================
    const pencilGone = await page.evaluate(() => !document.querySelector('aside.sidebar button[aria-label^="编辑清单"]'));
    check('侧栏清单行不再有「编辑清单」铅笔图标', pencilGone);

    // 临时清单用于验证删除
    const created = await api(page, '/api/reminder/lists', 'POST', { name: TEMP_LIST, color: 'emerald' });
    const tempListId = created.body?.data?.id ?? null;
    check('已用接口建一个临时清单', !!tempListId, tempListId ? `id=${tempListId}` : '创建失败');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(page, () => document.body.innerText.includes('自检清单'), { timeout: 15000 });
    await sleep(800);

    const opened = await rightClickList(page, TEMP_LIST);
    check('能在清单行上右键', opened);
    await waitFor(page, () => !!document.querySelector('[role="menu"]'), { timeout: 5000 });
    await sleep(250);
    let menu = await menuState(page);
    check('菜单含重命名 / 修改 / 设为默认 / 删除',
      !!menu && ['重命名', '修改（名称 / 颜色）', '设为默认清单', '删除清单'].every((t) => menu.items.some((i) => i.text.startsWith(t))),
      menu ? menu.items.map((i) => i.text).join(' | ') : '没弹出');
    check('菜单标题是这个清单名', menu?.heading === TEMP_LIST, menu?.heading);
    check('菜单在视野内', menu?.inViewport === true);
    await page.screenshot({ path: path.join(SHOTS, 'sidebar-list-menu.png') });

    // 1b. 重命名（就地改）
    await clickMenuItem(page, '重命名');
    await sleep(500);
    const renameState = await page.evaluate(() => {
      const input = [...document.querySelectorAll('aside.sidebar input')].find((i) => i.getAttribute('aria-label')?.startsWith('重命名清单'));
      return input ? { exists: true, value: input.value } : { exists: false };
    });
    check('「重命名」在行内出现输入框（不是弹窗）', renameState.exists && renameState.value === TEMP_LIST, JSON.stringify(renameState));
    await page.evaluate((name) => {
      const input = [...document.querySelectorAll('aside.sidebar input')].find((i) => i.getAttribute('aria-label')?.startsWith('重命名清单'));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, name);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, TEMP_RENAMED);
    await sleep(1200);
    const renamed = await api(page, '/api/reminder/lists');
    check('回车后名字改到服务端了',
      (renamed.body?.data || []).some((l) => l.id === tempListId && l.name === TEMP_RENAMED),
      JSON.stringify((renamed.body?.data || []).map((l) => l.name)));
    check('侧栏里也显示新名字', await page.evaluate((n) => document.body.innerText.includes(n), TEMP_RENAMED));

    // 1c. 修改（名称 / 颜色）打开原编辑弹窗
    await rightClickList(page, TEMP_RENAMED);
    await sleep(300);
    await clickMenuItem(page, '修改');
    await sleep(600);
    const dialog = await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      return modal ? { title: modal.querySelector('h3')?.textContent.trim(), swatches: modal.querySelectorAll('[data-list-color]').length } : null;
    });
    check('「修改」打开编辑弹窗（5 个颜色可选）', !!dialog && dialog.swatches === 5, JSON.stringify(dialog));
    await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      [...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消').click();
    });
    await sleep(400);

    // 1d. 默认清单不可删；临时清单可删（走确认）
    const defaultDisabled = await page.evaluate(async (defaultName) => {
      const row = [...document.querySelectorAll('aside.sidebar .group\\/list')].find((el) => el.textContent.includes(defaultName));
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 60), clientY: Math.round(r.top + 10) }));
      await new Promise((res) => setTimeout(res, 250));
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes('删除清单'));
      const out = { disabled: !!item?.disabled, title: item?.title || '' };
      document.body.click();
      return out;
    }, defaultList.name);
    check('默认清单的「删除清单」是禁用的（并说明原因）',
      defaultDisabled.disabled === true && /默认清单不能删除/.test(defaultDisabled.title), JSON.stringify(defaultDisabled));
    await sleep(300);

    await rightClickList(page, TEMP_RENAMED);
    await sleep(300);
    await clickMenuItem(page, '删除清单');
    await sleep(600);
    const confirmBox = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('.fixed.inset-0')].find((el) => /删除这个清单/.test(el.innerText));
      return dlg ? { text: dlg.innerText.replace(/\s+/g, ' ').slice(0, 120), hasConfirm: [...dlg.querySelectorAll('button')].some((b) => b.textContent.includes('删除清单')) } : null;
    });
    check('删除清单前弹确认（说明提醒会移到默认清单）', !!confirmBox && /移到默认清单/.test(confirmBox.text), JSON.stringify(confirmBox));
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('.fixed.inset-0')].find((el) => /删除这个清单/.test(el.innerText));
      [...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('删除清单')).click();
    });
    await sleep(1500);
    const afterDelete = await api(page, '/api/reminder/lists');
    check('确认后临时清单真的没了',
      !(afterDelete.body?.data || []).some((l) => l.id === tempListId),
      JSON.stringify((afterDelete.body?.data || []).map((l) => l.name)));
    await sleep(500)
    check('侧栏里也不再有它',
      !(await page.evaluate((n) => {
        const aside = document.querySelector('aside.sidebar');
        return aside ? aside.innerText.includes(n) : false;
      }, TEMP_RENAMED)));

    // ================= 2) logo 切换列表 / 日历 =================
    await page.goto(ROOT + '/admin/all', { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    const logoLabel1 = await page.evaluate(() => {
      const btn = document.querySelector('aside.sidebar button[aria-label^="切换到"]');
      return btn ? btn.getAttribute('aria-label') : null;
    });
    check('列表页上 logo 的提示是「切换到日历视图」', logoLabel1 === '切换到日历视图', String(logoLabel1));
    await page.evaluate(() => document.querySelector('aside.sidebar button[aria-label^="切换到"]').click());
    await waitFor(page, () => location.pathname.endsWith('/admin/calendar'), { timeout: 10000 });
    check('点一下 logo 进入日历视图', true, page.url());
    await sleep(900);
    const logoLabel2 = await page.evaluate(() => {
      const btn = document.querySelector('aside.sidebar button[aria-label^="切换到"]');
      return btn ? btn.getAttribute('aria-label') : null;
    });
    check('日历页上 logo 的提示变成「切换到列表视图」', logoLabel2 === '切换到列表视图', String(logoLabel2));
    await page.evaluate(() => document.querySelector('aside.sidebar button[aria-label^="切换到"]').click());
    await waitFor(page, () => !location.pathname.endsWith('/admin/calendar'), { timeout: 10000 });
    check('再点一下回到列表视图', page.url().includes('/admin') && !page.url().includes('calendar'), page.url());

    // ================= 3) 快速新建：清单选择常显 =================
    // 「全部」页 0.18.3 起**没有新建入口**了，这一组改用「今天」页
    await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    await openQuickAdd(page);
    await page.evaluate(() => document.querySelector('.quick-card input')?.focus());
    await sleep(500);
    const quick = await page.evaluate((defaultName) => {
      const card = document.querySelector('.quick-card');
      const select = card?.querySelector('select[aria-label="选择清单"]');
      if (!select) return null;
      const more = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '更多');
      // 「更多」按钮在清单选择之后（DOM 顺序在前 = 更靠左）
      const order = select.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING ? 'select-before-more' : 'after';
      return {
        visible: select.offsetParent !== null,
        value: select.options[select.selectedIndex]?.textContent.trim(),
        options: [...select.options].map((o) => o.textContent.trim()),
        order,
        defaultName,
      };
    }, defaultList.name);
    check('快速新建里出现「清单」选择（不用展开「更多」）', !!quick && quick.visible === true, JSON.stringify(quick));
    check('它在「更多」按钮前边', quick?.order === 'select-before-more', quick?.order);
    check('默认选中后台设置的默认清单', quick?.value === defaultList.name, `${quick?.value} vs ${defaultList.name}`);

    // 选另一个清单再新建，应当进那个清单
    const otherList = listsBefore.find((l) => l.id !== defaultList.id);
    if (otherList) {
      await page.evaluate((id) => {
        const select = document.querySelector('.quick-card select[aria-label="选择清单"]');
        select.value = String(id);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, otherList.id);
      await page.evaluate((title) => {
        const input = document.querySelector('.quick-card input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, title);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, TEMP_TASK);
      await sleep(500);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.quick-card button')].find((b) => /添加|记下/.test(b.textContent));
        btn.click();
      });
      await sleep(1800);
      const found = await api(page, '/api/reminder/items?view=all&status=all');
      const item = (found.body?.data || []).find((i) => i.title === TEMP_TASK);
      check('按所选的清单新建成功', !!item, item ? '' : '没找到新建的提醒');
      check('落进了选中的清单（不是默认清单）',
        !!item && item.list_id === otherList.id, item ? `list_id=${item.list_id}，期望 ${otherList.id}` : '');
      // 新建成功后快速新建卡片会收起（标题清空、焦点离开），选择框自然读不到；
      // 重新展开它再看默认值——这才对应用户下一次新建时看到的状态。
      // 0.20 起提交后会自动收起，所以这里先点「新建」按钮把卡片展开
      // （openQuickAdd 对旧版本是空操作：卡片本来就在）。
      await openQuickAdd(page);
      await sleep(700);
      const resetValue = await page.evaluate(() => {
        const select = document.querySelector('.quick-card select[aria-label="选择清单"]');
        return select ? select.options[select.selectedIndex]?.textContent.trim() : null;
      });
      check('新建后清单选择回到默认清单', resetValue === defaultList.name, `${resetValue} vs ${defaultList.name}`);
      if (item) await api(page, `/api/reminder/items/${item.id}`, 'DELETE');
    }

    // ================= 4) 未完成 / 全部：默认未完成 + 只存本地 =================
    await page.evaluate(() => { try { localStorage.removeItem('ui_list_status') } catch { /* 忽略 */ } });
    await page.goto(ROOT + '/admin/all', { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => !!document.querySelector('[role="group"][aria-label="显示范围"]'), { timeout: 15000 });
    await sleep(1200);
    const segDefault = await page.evaluate(() => {
      const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
      const pressed = [...seg.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
      return {
        pressed,
        completedRows: document.querySelectorAll('article.reminder-row.reminder-completed').length,
        stored: (() => { try { return localStorage.getItem('ui_list_status') } catch { return 'n/a' } })(),
      };
    });
    check('清空本地设置后默认选中「未完成」', segDefault.pressed.join(',') === '未完成', JSON.stringify(segDefault));
    check('默认看不到已完成的行', segDefault.completedRows === 0, String(segDefault.completedRows));

    // 切到「全部」→ 只写本地，服务端不存
    await page.evaluate(() => {
      const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
      [...seg.querySelectorAll('button')].find((b) => b.textContent.trim() === '全部').click();
    });
    await sleep(1200);
    const stored = await page.evaluate(() => { try { return localStorage.getItem('ui_list_status') } catch { return null } });
    check('切到「全部」只写浏览器本地（localStorage）', stored === 'all', String(stored));
    const configs = await api(page, '/api/configs');
    const configKeys = Object.keys(configs.body?.data || {});
    check('服务端配置里没有这个开关（换浏览器即默认值）',
      !configKeys.some((k) => /list_status|listStatus/.test(k)), configKeys.filter((k) => /status/.test(k)).join(',') || '无相关键');
    // 模拟换浏览器：清掉本地存储后重新打开 → 默认未完成，且看到的是本地那份
    await page.evaluate(() => { try { localStorage.removeItem('ui_list_status') } catch { /* 忽略 */ } });
    await page.goto(ROOT + '/admin/all', { waitUntil: 'domcontentloaded' });
    await sleep(1300);
    const freshBrowser = await page.evaluate(() => {
      const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
      return [...seg.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
    });
    check('「换浏览器」（本地无记录）时回到默认「未完成」', freshBrowser.join(',') === '未完成', JSON.stringify(freshBrowser));

    // 待办 / 计划两个视图**取消**了「未完成 / 全部」开关（用户要求：只显示未完成），
    // 所以这里断言它们没有这个开关，且即使本地留着「全部」也看不到已完成的行。
    for (const [path, label] of [['/admin', '待办'], ['/admin/planned', '计划']]) {
      await page.evaluate(() => { try { localStorage.setItem('ui_list_status', 'all'); } catch { /* 忽略 */ } });
      await page.goto(ROOT + path, { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const state = await page.evaluate(() => {
        const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
        return {
          hasSeg: !!seg,
          completedRows: document.querySelectorAll('article.reminder-row.reminder-completed').length,
        };
      });
      check(`${label} 视图没有「未完成 / 全部」开关，且不会显示已完成的行`,
        state.hasSeg === false && state.completedRows === 0, JSON.stringify(state));
    }

    // ---- 还原 ----
    await page.evaluate((v) => {
      try {
        if (v.status === null) localStorage.removeItem('ui_list_status');
        else localStorage.setItem('ui_list_status', v.status);
        if (v.rail === null) localStorage.removeItem('ui_rail_collapsed');
        else localStorage.setItem('ui_rail_collapsed', v.rail);
      } catch { /* 忽略 */ }
    }, original);
    const finalLists = (await api(page, '/api/reminder/lists')).body?.data || [];
    check('清单数量回到起点（临时清单已删）', finalLists.length === listsBefore.length,
      `${listsBefore.length} → ${finalLists.length}`);
    check('清单名字没有残留改动',
      finalLists.every((l) => !l.name.startsWith('自检')), finalLists.map((l) => l.name).join(','));
    console.log(`  截图：${path.join(SHOTS, 'sidebar-list-menu.png')}`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
