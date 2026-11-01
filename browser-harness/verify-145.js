/**
 * 课程表卡片就近归位（用户 2026-10-30 原话：「课程表卡片根据上课时间段自动选择最近位置安放，
 * 修改时间卡片根据时间段自动判断位置」）。
 *
 * 钉住：
 *   1) 13:05 这种落在午休空档的课，按「离下午第一节最近」归到下午，而不是上一节上午；
 *   2) 10:10 这种卡在两节之间的课，归到下一节（10:15），不是上一节（10:05 结束）；
 *   3) 编辑开始时间后，卡片自动移动到新节次，不需要刷新或重开页面。
 *
 * 用法：APP_URL=http://127.0.0.1:8919 node verify-145.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = 'NEAR' + Date.now().toString().slice(-6);
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
}, { base: BASE, p, method, body });

async function periodOf(page, id) {
  return page.evaluate((id) => {
    const card = document.querySelector(`[data-entry-id="${id}"]`);
    return card?.closest('[data-timetable-period]')?.getAttribute('data-timetable-period') || null;
  }, id);
}
async function rowOf(page, id) {
  return page.evaluate((id) => document.querySelector(`[data-entry-id="${id}"]`)?.getAttribute('data-align-row') || null, id);
}
async function waitFor(page, fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);
    const table = await api(page, '/api/timetable/tables', 'POST', { name: `${STAMP}-就近` });
    const tableId = table.body?.data?.id;
    check('建测试表', table.status === 200 && !!tableId, JSON.stringify(table.body));
    if (!tableId) return;

    const afterLunch = await api(page, `/api/timetable/tables/${tableId}/entries`, 'POST', {
      title: `${STAMP} 午休后`, kind: 'course', weekday: 1, start_time: '13:05', end_time: '13:50', color: 'sky',
    });
    const between = await api(page, `/api/timetable/tables/${tableId}/entries`, 'POST', {
      title: `${STAMP} 两节之间`, kind: 'course', weekday: 1, start_time: '10:10', end_time: '10:55', color: 'amber',
    });
    const id1 = afterLunch.body?.data?.id;
    const id2 = between.body?.data?.id;
    check('建两条测试课', afterLunch.status === 200 && between.status === 200, JSON.stringify([afterLunch.body, between.body]));

    await page.goto(BASE + '/admin/timetable', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await page.click(`[data-timetable-tab*="${STAMP}-就近"]`);
    await sleep(900);
    check('13:05 的课归到离得最近的下午', await periodOf(page, id1) === 'afternoon', String(await periodOf(page, id1)));
    check('13:05 的课落在下午第 1 节', await rowOf(page, id1) === 'r6', String(await rowOf(page, id1)));
    check('10:10 的课归到下一节而不是上一节', await periodOf(page, id2) === 'morning' && await rowOf(page, id2) === 'r4', `${await periodOf(page, id2)}/${await rowOf(page, id2)}`);
    await page.screenshot({ path: '/tmp/verify-145-before.png' });

    // 编辑开始时间后，卡片应自动换段换节。
    await page.click('[data-timetable-edit]');
    await sleep(400);
    await page.click(`[data-entry-id="${id1}"]`);
    const opened = await waitFor(page, () => page.evaluate(() => !!document.querySelector('[data-entry-start]')));
    check('编辑态能打开完整表单', opened);
    if (opened) {
      await page.$eval('[data-entry-start]', (el) => {
        el.value = '09:25';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(300);
      const endVal = await page.$eval('[data-entry-end]', (el) => el.value).catch(() => '');
      check('改开始时间后结束时间同步', endVal === '10:10', endVal);
      await page.click('[data-entry-save]');
      await sleep(1600);
      check('保存后卡片自动移动到上午', await periodOf(page, id1) === 'morning', String(await periodOf(page, id1)));
      check('保存后卡片落在上午第 1 节', await rowOf(page, id1) === 'r3', String(await rowOf(page, id1)));
      check('卡片时间同步为 09:25', await page.evaluate((id) => document.querySelector(`[data-entry-id="${id}"]`)?.textContent.includes('09:25'), id1));
    }

    await page.screenshot({ path: '/tmp/verify-145-nearest.png' });
    await api(page, `/api/timetable/tables/${tableId}`, 'DELETE').catch(() => {});
  }, { width: 1280, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
