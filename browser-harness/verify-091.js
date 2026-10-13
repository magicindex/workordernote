/**
 * 验证 0.9.1：列表视图新建框里的「任务清单」选择框该默认选谁。
 *
 * 规则（用户 2026-10-05 提的）：
 *   - 进入某个**具体清单**页面（/admin/list/:id）→ 清单框跟着当前清单走；
 *   - 在**今天 / 计划 / 全部 / 已完成**这些视图里 → 用后台设置的默认清单；
 *   - 手动选过别的清单后，不能被别人同步触发的实时刷新冲掉；
 *   - 建完一条之后按当前所在视图回到「当前清单」或「默认清单」。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-091.js
 * 数据：只建一条临时提醒（结束时删掉），不改任何后台设置。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');
const ROOT = BASE.replace(/\/$/, '');
const STAMP = Date.now();
const TEMP_TASK = `自检-清单跟随-${STAMP}`;

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: ROOT, p, method, body });

/** 当前快速新建卡片里「任务清单」选择框的状态（必要时先把卡片点开）。 */
async function quickSelect(page) {
  // 用元素自身的 click()（会走 Vue 的 @click="quickFocused = true"）而不是鼠标坐标：
  // 坐标点击依赖布局时机与窗口焦点，偶发点空导致卡片没展开（本轮就踩了一次）。
  await openQuickAdd(page); // 默认收成「新建」按钮时先展开
  await page.evaluate(() => document.querySelector('.quick-card input')?.click());
  await sleep(450);
  return page.evaluate(() => {
    const select = document.querySelector('.quick-card select[aria-label="选择清单"]');
    if (!select || select.offsetParent === null) return null;
    return {
      name: select.options[select.selectedIndex]?.textContent.trim(),
      id: Number(select.value),
      options: [...select.options].map((o) => o.textContent.trim()),
    };
  });
}

/** 到某个列表页并把清单框读出来。 */
async function gotoAndRead(page, pathname) {
  await page.goto(ROOT + pathname, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await openQuickAdd(page);
  await waitFor(page, () => !!document.querySelector('.quick-card input'), { timeout: 20000 });
  await sleep(900);
  return quickSelect(page);
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    const listsRes = await api(page, '/api/reminder/lists');
    const lists = listsRes.body?.data || [];
    const def = lists.find((l) => l.is_default) || lists[0];
    // 样本清单自己建：现成的清单里可能混着系统栏目（信用卡账单 / 记事本 —— 它们的页面
    // 不是普通列表页，信用卡栏目页渲染的是卡片面板、根本没有「清单跟随」这个框），
    // 普通清单也可能只剩一个，所以直接建两个临时的，用完删掉。
    const tmpNames = [`自检跟随A-${STAMP}`, `自检跟随B-${STAMP}`];
    const others = [];
    for (const name of tmpNames) {
      const made = await api(page, '/api/reminder/lists', 'POST', { name, color: 'blue', icon: 'list' });
      if (made.body?.data) others.push(made.body.data);
    }
    if (!def || others.length < 2) {
      check('至少要有「一个默认清单 + 两个其它清单」才能验证', false,
        `清单=${lists.map((l) => `${l.name}${l.is_default ? '(默认)' : ''}`).join(',')}`);
      console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
      process.exit(1);
    }
    const [listA, listB] = others;
    const before = await api(page, '/api/reminder/items?view=all&status=all');
    const baseCount = (before.body?.data || []).length;
    // 基线里**已经存在**的自检条目（别的用例崩在半路留下的）：最后那条「没有残留」只
    // 针对**本次新增**的残留，否则别的用例被限流打断一次，这里就假红一次（实测反复踩到）。
    const baseSelfCheck = new Set((before.body?.data || [])
      .filter((i) => String(i.title).startsWith('自检')).map((i) => i.title));
    console.log(`  样本：默认清单「${def.name}」，清单A「${listA.name}」，清单B「${listB.name}」，基线 ${baseCount} 条`);

    // ---- 1. 进具体清单 → 跟随当前清单 ----
    let sel = await gotoAndRead(page, `/admin/list/${listA.id}`);
    check(`进清单「${listA.name}」→ 清单框跟着选中它`, sel?.id === listA.id, JSON.stringify(sel));

    sel = await gotoAndRead(page, `/admin/list/${listB.id}`);
    check(`再进清单「${listB.name}」→ 跟着换成它（不是默认）`, sel?.id === listB.id, JSON.stringify(sel));

    sel = await gotoAndRead(page, `/admin/list/${listA.id}`);
    check(`切回清单「${listA.name}」→ 又跟回来`, sel?.id === listA.id, JSON.stringify(sel));

    // ---- 2. 今天 / 全部 → 用后台默认清单 ----
    sel = await gotoAndRead(page, '/admin/today');
    check('「今天」视图 → 用后台默认清单', sel?.id === def.id, `${sel?.name} vs ${def.name}`);

    sel = await gotoAndRead(page, '/admin/planned'); // 「全部」页 0.18.3 起没有新建入口，第二处改用「计划」页
    check('「计划」视图 → 用后台默认清单', sel?.id === def.id, `${sel?.name} vs ${def.name}`);

    // ---- 3. 在清单页真建一条：要落进当前清单，且建完仍停在当前清单 ----
    await page.goto(`${ROOT}/admin/list/${listA.id}`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => !!document.querySelector('.quick-card input'), { timeout: 20000 });
    await sleep(900);
    sel = await quickSelect(page);
    await page.evaluate((title) => {
      const input = document.querySelector('.quick-card input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, TEMP_TASK);
    await sleep(400);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.quick-card button')].find((b) => /添加|记下/.test(b.textContent));
      btn.click();
    });
    await sleep(1800);
    const afterCreate = await api(page, '/api/reminder/items?view=all&status=all');
    const created = (afterCreate.body?.data || []).find((i) => i.title === TEMP_TASK);
    check('在清单页新建的提醒落进了当前清单',
      !!created && created.list_name === listA.name,
      created ? `list=${created.list_name}` : '没找到新建的提醒（可能被存到了别处）');

    sel = await quickSelect(page);
    check(`建完仍停在当前清单「${listA.name}」（不是跳回默认）`, sel?.id === listA.id, JSON.stringify(sel));

    // ---- 4. 手动选别的清单，实时刷新不能把它冲掉 ----
    await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
    await openQuickAdd(page);
    await waitFor(page, () => !!document.querySelector('.quick-card input'), { timeout: 20000 });
    await sleep(900);
    await quickSelect(page);
    await page.evaluate((id) => {
      const select = document.querySelector('.quick-card select[aria-label="选择清单"]');
      select.value = String(id);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, listB.id);
    await sleep(300);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('reminder-realtime'));
      window.dispatchEvent(new CustomEvent('reminder-data-changed'));
    });
    await sleep(1200);
    const afterRealtime = await page.evaluate(() => {
      const select = document.querySelector('.quick-card select[aria-label="选择清单"]');
      return select ? { id: Number(select.value), name: select.options[select.selectedIndex]?.textContent.trim() } : null;
    });
    check('手动选的清单不会被实时刷新冲回默认', afterRealtime?.id === listB.id, JSON.stringify(afterRealtime));

    // ---- 5. 清理临时任务，条目数回到基线 ----
    if (created?.id) await api(page, `/api/reminder/items/${created.id}`, 'DELETE');
    await sleep(800);
    const finalRes = await api(page, '/api/reminder/items?view=all&status=all');
    const finalItems = finalRes.body?.data || [];
    check('临时提醒已删除，条目数回到基线', finalItems.length === baseCount, `${baseCount} → ${finalItems.length}`);
    // 只检查**本次运行**新增的自检条目；基线里已有的（别的用例留下的）打印出来但不判失败
    const leftoverNow = finalItems.filter((i) => String(i.title).startsWith('自检'));
    const newResidue = leftoverNow.filter((i) => !baseSelfCheck.has(String(i.title)));
    if (leftoverNow.length > newResidue.length) {
      console.log(`  · 基线上已有 ${leftoverNow.length - newResidue.length} 条自检条目（别的用例留下的，不计入本次判定）`);
    }
    check('本次运行没有留下自检数据', newResidue.length === 0, newResidue.map((i) => i.title).join(' | '));
    console.log(`  截图：${path.join(SHOTS, 'quick-list-follow.png')}`);
    await page.screenshot({ path: path.join(SHOTS, 'quick-list-follow.png') });
    // 清理：把两个临时清单删掉（清单里的自检条目会被一并带走）
    try {
      const all = await api(page, '/api/reminder/lists');
      for (const l of (all.body?.data || [])) {
        if (tmpNames.includes(l.name)) await api(page, `/api/reminder/lists/${l.id}`, 'DELETE');
      }
    } catch { /* 清理失败不影响断言 */ }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
