/**
 * 手机底部标签「信用卡」→「清单」+ 弹出全部清单切换（用户 2026-10-16 原话：
 * 「手机页面 中间 信用卡 改成 清单，点击清单弹出 所有清单列表，根据选择切换清单列表」）。
 *
 * 钉住这几条：
 *   1. 手机底部标签栏是 待办 / 计划 / **清单** / 通知 / 方式，中间那个不再叫「信用卡」；
 *   2. 点「清单」弹出底部弹层（`[data-lists-sheet]`），标题「全部清单」；
 *   3. 弹层里「我的清单」那一段 —— **名字与顺序完全一致**（同一份数据）；
 *      开了课程表时，弹层最上面还要多一行「课程表」（用户 2026-10-23「手机页面 中间清单
 *      显示不全，没有看到课程表」），点它进 `/admin/timetable`、弹层收起；
 *   4. 选一个自建清单 → 跳到 `/admin/list/<id>`、弹层自动收起、页面标题变成该清单名；
 *   5. 选「全部」→ 跳到 `/admin/all`；
 *   6. 当前所在的那一行有打勾标记；
 *   7. 关闭按钮 / 点遮罩都能收起，收起后弹层不在 DOM 里；
 *   8. 桌面宽度（1280）不显示这个弹层（手机专用）。
 *
 * 只读不写：不新建、不修改任何清单或提醒，也不改课程表开关。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-128.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const readConfig = (page, key) => page.evaluate(async ({ base, key }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + '/api/configs', { headers: { Authorization: 'Bearer ' + token } });
  const body = await res.json().catch(() => null);
  return body?.data?.[key];
}, { base: BASE, key });

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}

const readTabs = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.mobile-tabbar .mobile-tab small'))
  .map((el) => (el.textContent || '').trim()));

const readSidebarRows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-my-row]'))
  .map((el) => ({
    key: el.getAttribute('data-my-row'),
    // 侧栏那一行里「名字 + 角标数字」在同一个容器里，这里取整行文本、去掉空白，
    // 名字用 startsWith 比（弹层的名字是干净的）。
    text: (el.querySelector('.nav-row')?.textContent || el.textContent || '').replace(/\s+/g, '').trim(),
  })));

const readSheet = (page) => page.evaluate(() => {
  const sheet = document.querySelector('[data-lists-sheet]');
  if (!sheet) return null;
  return {
    title: (sheet.querySelector('.lists-sheet-head p')?.textContent || '').trim(),
    rows: Array.from(sheet.querySelectorAll('[data-lists-sheet-row]')).map((el) => ({
      key: el.getAttribute('data-lists-sheet-row'),
      name: el.getAttribute('data-list-name'),
      text: (el.textContent || '').replace(/\s+/g, ''),
      current: !!el.querySelector('[data-lists-sheet-current]'),
      visible: el.getBoundingClientRect().height > 0,
    })),
  };
});

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    try {
      // ---------- 0. 桌面下先记下侧栏「我的清单」的顺序与名字（作为弹层的对照） ----------
      await page.setViewport({ width: 1440, height: 1000 });
      await login(page, BASE);
      await gotoRetry(page, BASE + '/admin');
      await sleep(2500);
      const sidebar = await readSidebarRows(page);
      check('侧栏「我的清单」这一段读得到（作为对照）', sidebar.length >= 2, JSON.stringify(sidebar));
      const timetableEnabled = String(await readConfig(page, 'timetable_enabled')) === 'true';

      // ---------- 1. 手机标签栏 ----------
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await gotoRetry(page, BASE + '/admin');
      await sleep(2000);
      const tabs = await readTabs(page);
      check('手机底部标签里有「清单」', tabs.includes('清单'), JSON.stringify(tabs));
      check('中间那个不再叫「信用卡」', !tabs.includes('信用卡'), JSON.stringify(tabs));
      check('原来的其它标签都还在（待办 / 计划 / 通知 / 方式）',
        ['待办', '计划', '通知', '方式'].every((t) => tabs.includes(t)), JSON.stringify(tabs));
      check('标签顺序是 待办 / 计划 / 清单 / 通知 / 方式',
        tabs.slice(0, 5).join('/') === '待办/计划/清单/通知/方式', JSON.stringify(tabs));

      // ---------- 2. 点「清单」→ 弹出全部清单 ----------
      check('点之前弹层不在 DOM 里', (await readSheet(page)) === null);
      await page.click('[data-tab-lists]');
      await sleep(800);
      const sheet = await readSheet(page);
      check('点「清单」弹出了清单弹层', !!sheet, JSON.stringify(sheet));
      check('弹层标题是「全部清单」', sheet?.title === '全部清单', JSON.stringify(sheet?.title));
      const sheetLists = (sheet?.rows || []).filter((r) => String(r.key).startsWith('list:'));
      check('弹层里的「我的清单」与侧栏**顺序完全一致**（同一份数据、同一个排序）',
        !!sheet && sheetLists.map((r) => r.key).join('|') === sidebar.map((r) => r.key).join('|'),
        JSON.stringify({ 弹层: sheetLists.map((r) => r.key), 侧栏: sidebar.map((r) => r.key) }));
      check('弹层里每一行的名字与侧栏那一行对得上（侧栏那行带角标数字）',
        !!sheet && sheetLists.every((r) => {
          const row = sidebar.find((x) => x.key === r.key);
          return !!row && row.text.startsWith(String(r.name));
        }),
        JSON.stringify({ 弹层: sheetLists.map((r) => `${r.key}=${r.name}`), 侧栏: sidebar.map((r) => `${r.key}=${r.text}`) }));
      check('每一行都真的显示出来了', !!sheet && sheet.rows.every((r) => r.visible), JSON.stringify(sheet?.rows));
      check('弹层里不再有单独的「全部」行（已并入智能清单）',
        !!sheet && !sheet.rows.some((r) => r.key === 'all'),
        JSON.stringify(sheet?.rows?.map((r) => `${r.key}=${r.name}`)));
      // 课程表（用户 2026-10-23）：开关打开时排在弹层最上面，关着时不应出现。
      check(timetableEnabled ? '开了课程表时，弹层最上面有「课程表」' : '没开课程表时，弹层里没有「课程表」',
        timetableEnabled
          ? sheet?.rows?.[0]?.key === 'timetable' && sheet.rows[0].text.startsWith('课程表')
          : !!sheet && !sheet.rows.some((r) => r.key === 'timetable'),
        JSON.stringify({ timetableEnabled, rows: sheet?.rows?.map((r) => `${r.key}=${r.text}`) }));

      // ---------- 3. 选一个自建清单 → 切过去 ----------
      const target = (sheet?.rows || []).find((r) => String(r.key).startsWith('list:'));
      check('弹层里有可选的清单行', !!target, JSON.stringify(sheet?.rows?.map((r) => r.name)));
      if (target) {
        const listId = String(target.key).split(':')[1];
        await page.evaluate((name) => {
          const el = Array.from(document.querySelectorAll('[data-lists-sheet-row]'))
            .find((n) => n.getAttribute('data-list-name') === name);
          el?.click();
        }, target.name);
        await sleep(2200);
        const after = await page.evaluate(() => ({
          url: location.pathname,
          title: (document.querySelector('h1')?.textContent || '').trim(),
          sheet: !!document.querySelector('[data-lists-sheet]'),
        }));
        check('选一个清单就切到了它的页面', after.url === `/admin/list/${listId}`, JSON.stringify(after));
        check('切换后弹层自动收起', after.sheet === false, JSON.stringify(after));
        check('页面标题是这个清单的名字', after.title === target.name, JSON.stringify({ 期望: target.name, 实际: after.title }));

        // ---------- 4. 当前清单打勾 ----------
        await page.click('[data-tab-lists]');
        await sleep(700);
        const sheet2 = await readSheet(page);
        const marked = (sheet2?.rows || []).filter((r) => r.current);
        check('当前所在的那一行有打勾标记', marked.length === 1 && marked[0].key === target.key,
          JSON.stringify((sheet2?.rows || []).map((r) => ({ n: r.name, c: r.current }))));
        await page.click('[data-lists-sheet-close]');
        await sleep(600);
        check('关闭按钮能收起弹层', (await readSheet(page)) === null);
      }

      // ---------- 5. 「全部」只剩智能清单那一处：除课程表外都是具体清单 ----------
      await page.click('[data-tab-lists]');
      await sleep(700);
      const sheetAll = await readSheet(page);
      check('除课程表外，弹层里的行都是具体清单（没有重复的「全部」入口）',
        !!sheetAll && sheetAll.rows.filter((r) => r.key !== 'timetable').every((r) => String(r.key).startsWith('list:')),
        JSON.stringify(sheetAll?.rows?.map((r) => r.key)));
      if (timetableEnabled) {
        // ---------- 5b. 课程表行：能进、弹层收起、标签保持选中、回来打勾 ----------
        await page.evaluate(() => document.querySelector('[data-lists-sheet-row="timetable"]')?.click());
        await sleep(2000);
        const tt = await page.evaluate(() => ({
          url: location.pathname,
          sheet: !!document.querySelector('[data-lists-sheet]'),
          active: (document.querySelector('.mobile-tab.active small')?.textContent || '').trim(),
        }));
        check('点「课程表」进到课程表页、弹层收起', tt.url === '/admin/timetable' && tt.sheet === false, JSON.stringify(tt));
        check('从「清单」进去后，中间标签保持选中', tt.active === '清单', JSON.stringify(tt));
        await page.click('[data-tab-lists]');
        await sleep(700);
        const ttSheet = await readSheet(page);
        const ttMarked = (ttSheet?.rows || []).filter((r) => r.current);
        check('在课程表页打开弹层，「课程表」那一行打勾',
          ttMarked.length === 1 && ttMarked[0].key === 'timetable',
          JSON.stringify((ttSheet?.rows || []).map((r) => ({ k: r.key, c: r.current }))));
        await page.click('[data-lists-sheet-close]');
        await sleep(600);
        await gotoRetry(page, BASE + '/admin');
        await sleep(1500);
      } else {
        await page.click('[data-lists-sheet-backdrop]', { offset: { x: 10, y: 10 } });
        await sleep(600);
      }

      // ---------- 6. 点遮罩也能收起 + 桌面没有这个弹层 ----------
      await page.click('[data-tab-lists]');
      await sleep(700);
      await page.click('[data-lists-sheet-backdrop]', { offset: { x: 10, y: 10 } });
      await sleep(600);
      check('点遮罩能收起弹层', (await readSheet(page)) === null);

      await page.setViewport({ width: 1280, height: 900 });
      await gotoRetry(page, BASE + '/admin');
      await sleep(1500);
      const desk = await page.evaluate(() => ({
        tabbar: !!document.querySelector('.mobile-tabbar'),
        visible: !!document.querySelector('.mobile-tabbar')?.getBoundingClientRect().height,
        sheet: !!document.querySelector('[data-lists-sheet]'),
      }));
      check('桌面宽度下没有手机弹层（手机专用）', desk.sheet === false, JSON.stringify(desk));

      // ---------- 7. 收尾：没有留下任何弹层 ----------
      const finalState = await page.evaluate(() => !!document.querySelector('[data-lists-sheet]'));
      check('收尾：弹层没留在页面上', finalState === false);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ 套件异常：${err.message}`);
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
