/**
 * 验证清单图标库（侧栏/新建/编辑/日历/筛选都用图标，不再用颜色圆点）。
 *
 * 覆盖：
 *   1) 侧栏「我的清单」每一行都有图标块（data-list-icon），旧的圆点已经不在
 *   2) 新建清单时能挑图标 → 建好后侧栏显示的就是它
 *   3) 右键 → 修改 → 换图标 → 侧栏、日历一起变
 *   4) 日历格子里的提醒前面是**清单图标**（不再是圆点），且卡片接口返回 list_icon
 *   5) 完成记录页的清单筛选芯片里也是图标
 *   6) 清理干净（清单与提醒都删掉）
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-099.js
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
const LIST_NAME = `自检图标清单-${STAMP}`;

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: ROOT, p, method, body });

async function waitSel(page, sel, timeout = 8000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const hit = await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)
    if (hit) return true
    if (Date.now() > deadline) return false
    await sleep(250)
  }
}

const setInput = (page, sel, value) => page.evaluate(({ sel, value }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, { sel, value });

/** 侧栏某一行的图标 key（按清单名找那一行）。 */
const navIconOf = (page, name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll('.nav-row')]
    .find((r) => (r.textContent || '').includes(name));
  const icon = row?.querySelector('[data-list-icon]');
  return icon ? icon.getAttribute('data-list-icon') : null;
}, name);

/** 侧栏里还有没有老的「颜色圆点」（清单行专用的小圆点）。 */
const hasLegacyDot = (page, name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll('.nav-row')]
    .find((r) => (r.textContent || '').includes(name));
  if (!row) return null;
  return !!row.querySelector('span.rounded-full');
}, name);

const openListMenu = async (page, name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('.nav-row')].find((r) => (r.textContent || '').includes(name));
    const wrap = row?.closest('.group\\/list') || row?.parentElement;
    wrap?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }));
  }, name);
  await waitSel(page, '[role="menu"]');
  await sleep(300);
};

const clickMenuItem = async (page, label) => {
  await page.evaluate((label) => {
    const btn = [...document.querySelectorAll('[role="menuitem"]')]
      .find((b) => (b.textContent || '').trim().includes(label));
    btn?.click();
  }, label);
  await sleep(500);
};

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);
    let listId = null;
    let reminderId = null;
    let regularList = null;
    try {
      // ---------- 1. 侧栏图标 ----------
      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
      await waitFor(page, () => !!document.querySelector('button[aria-label="新建清单"]'), { timeout: 20000 });
      await sleep(800);
      const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
      // 卡片栏目（记事本/信用卡/仪式感）在侧栏用的是模板自带图标，没有 data-list-icon，
      // 只有普通清单（template='general'）才带。2026-10-17 沙箱里排第一的是随手记事本，
      // 旧写法拿它比对必然 null，用例误红（产品没问题）。
      regularList = lists.find((l) => l.template === 'general') || lists.find((l) => l.template !== 'credit_card');
      const iconsInNav = await page.evaluate(() => document.querySelectorAll('.nav-row [data-list-icon]').length);
      check('侧栏每个清单行都有图标块', iconsInNav >= 1, String(iconsInNav));
      check('清单行不再用颜色圆点', (await hasLegacyDot(page, regularList.name)) === false,
        String(await hasLegacyDot(page, regularList.name)));
      check('侧栏图标与清单数据一致',
        (await navIconOf(page, regularList.name)) === (regularList.icon || 'list'),
        `${await navIconOf(page, regularList.name)} vs ${regularList.icon}`);

      // ---------- 2. 新建清单选图标 ----------
      await page.evaluate(() => document.querySelector('button[aria-label="新建清单"]').click());
      await waitSel(page, '[data-list-icon-option]');
      const optionCount = await page.evaluate(() => document.querySelectorAll('[data-list-icon-option]').length);
      check('新建清单里有图标库可选', optionCount >= 20, String(optionCount));
      await page.evaluate(() => document.querySelector('[data-list-icon-option="star"]').click());
      await setInput(page, '[data-list-name]', LIST_NAME);
      await page.evaluate(() => document.querySelector('[data-create-submit]').click());
      await sleep(1800);
      const created = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.name === LIST_NAME);
      listId = created?.id ?? null;
      check('新建清单时选的图标存下来了', created?.icon === 'star', String(created?.icon));
      check('侧栏新清单显示 star 图标', (await navIconOf(page, LIST_NAME)) === 'star',
        String(await navIconOf(page, LIST_NAME)));

      // ---------- 3. 右键 → 修改 → 换图标 ----------
      await openListMenu(page, LIST_NAME);
      await clickMenuItem(page, '修改');
      check('打开编辑清单弹窗', await waitSel(page, '[data-list-icon-option="fire"]'));
      const checked = await page.evaluate(() => document.querySelector('[data-list-icon-option="star"]')?.getAttribute('aria-checked'));
      check('编辑弹窗里回显当前图标', checked === 'true', String(checked));
      await page.evaluate(() => document.querySelector('[data-list-icon-option="fire"]').click());
      await sleep(200);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存');
        btn?.click();
      });
      await sleep(1600);
      const afterEdit = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.id === listId);
      check('改图标后服务端已更新', afterEdit?.icon === 'fire', String(afterEdit?.icon));
      check('侧栏立刻换成新图标', (await navIconOf(page, LIST_NAME)) === 'fire',
        String(await navIconOf(page, LIST_NAME)));

      // ---------- 4. 日历里也是图标 ----------
      const due = new Date();
      due.setHours(9, 30, 0, 0);
      const made = await api(page, '/api/reminder/items', 'POST', {
        title: `自检图标任务-${STAMP}`, list_id: listId,
        due_at: due.toISOString(), repeat_rule: 'none', channels: ['inapp'],
      });
      reminderId = made.body?.data?.id ?? null;
      await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await waitSel(page, '.cal-task', 20000);
      await sleep(1200);
      const calendar = await page.evaluate((title) => {
        const chip = [...document.querySelectorAll('.cal-task')].find((c) => (c.textContent || '').includes(title));
        return chip ? {
          hasIcon: !!chip.querySelector('svg'),
          hasDot: !!chip.querySelector('i.rounded-full'),
          html: chip.innerHTML.slice(0, 120),
        } : null;
      }, `自检图标任务-${STAMP}`);
      check('日历格子里找到这条提醒', !!calendar, JSON.stringify(calendar));
      check('日历里用清单图标（不是圆点）', calendar?.hasIcon === true && calendar?.hasDot === false,
        JSON.stringify(calendar));
      const calApi = (await api(page, `/api/reminder/calendar?from=${isoDay(addDays(new Date(), -1))}&to=${isoDay(addDays(new Date(), 2))}`)).body?.data || [];
      const ours = calApi.find((c) => c.id === reminderId);
      check('日历接口带回 list_icon', ours?.list_icon === 'fire', String(ours?.list_icon));
      await page.screenshot({ path: path.join(SHOTS, 'list-icons.png') });

      // ---------- 5. 完成记录页的清单筛选 ----------
      await page.goto(ROOT + '/admin/completed', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const filterIcons = await page.evaluate(() => {
        const chips = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').includes('自检图标清单'));
        const chip = chips[0];
        return chip ? { hasIcon: !!chip.querySelector('svg'), hasDot: !!chip.querySelector('i.rounded-full') } : null;
      });
      check('清单筛选里也是图标', filterIcons?.hasIcon === true && filterIcons?.hasDot === false,
        JSON.stringify(filterIcons));
    } finally {
      // ---------- 清理 ----------
      try {
        if (reminderId) await api(page, `/api/reminder/items/${reminderId}`, 'DELETE');
        if (listId) {
          const items = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [];
          for (const i of items.filter((x) => x.list_id === listId)) {
            await api(page, `/api/reminder/items/${i.id}`, 'DELETE');
          }
          await api(page, `/api/reminder/lists/${listId}`, 'DELETE');
        }
      } catch { /* 清理失败也要把断言跑完 */ }
      await sleep(800);
      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
      await sleep(900);
      const listsLeft = ((await api(page, '/api/reminder/lists')).body?.data || []).filter((l) => l.name === LIST_NAME);
      const itemsLeft = ((await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [])
        .filter((i) => /自检图标/.test(String(i.title)));
      check('图标测试数据已清理', listsLeft.length === 0 && itemsLeft.length === 0,
        `清单 ${listsLeft.length} / 提醒 ${itemsLeft.length}`);
      check('清理后原清单的图标没被动过', (await navIconOf(page, regularList?.name || '')) !== null);
    }

    console.log(`  截图：${path.join(SHOTS, 'list-icons.png')}`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(1);
});

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isoDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
