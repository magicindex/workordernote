/**
 * 课程表共享：共享给另一个账号，只读 / 读写。
 *
 * 覆盖：
 *   1) 表主把自己的表共享给两个测试账号（read / write）；
 *   2) 表主弹窗里能看到共享名单、能改权限；
 *   3) 只读账号列表里带「只读」徽标，不能编辑/加课/改表设置，点课程只出只读详情；
 *   4) 读写账号带「可编辑」徽标，可以进编辑态，但不能改表设置/再共享；
 *   5) 通过接口确认只读写入 403、读写写入成功且条目归表主。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-134.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const PASSWORD = `Test!${STAMP}`;

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function callApi(token, path, method = 'GET', body = null) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}

async function loginToken(username, password) {
  const res = await callApi(null, '/api/auth/login', 'POST', { username, password });
  return res.body?.data?.token || '';
}

async function loginAs(page, username, password) {
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  const token = await loginToken(username, password);
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => { try { localStorage.setItem('reminders.token', t); } catch {} }, token);
  await page.goto(BASE + '/admin/timetable', { waitUntil: 'domcontentloaded' });
  await sleep(1600);
  return token;
}

async function waitSel(page, sel, timeout = 12000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(200);
  }
}

const readerName = `share_r_${STAMP}`;
const writerName = `share_w_${STAMP}`;
const extraName = `share_x_${STAMP}`;
let ownerToken = '';
let tableId = 0;
let readerId = 0;
let writerId = 0;
let extraId = 0;
let entryId = 0;

(async () => {
  try {
    ownerToken = await loginToken('王耀辉', process.env.APP_PASS || 'Wyh!1984yelq.');
    check('表主登录成功', !!ownerToken);
    if (!ownerToken) throw new Error('owner login failed');

    // 建一张临时表 + 一条课程，避免动到用户自己的表。
    const created = await callApi(ownerToken, '/api/timetable/tables', 'POST', { name: `共享自检-${STAMP}` });
    tableId = Number(created.body?.data?.id || 0);
    check('创建临时课程表', created.status === 200 && tableId > 0, JSON.stringify(created.body));
    const entry = await callApi(ownerToken, `/api/timetable/tables/${tableId}/entries`, 'POST', {
      title: '共享数学', kind: 'course', weekday: 1, start_time: '08:00', end_time: '08:45',
      location: '三班', teacher: '李老师', note: '共享自检', color: 'indigo',
    });
    entryId = Number(entry.body?.data?.id || 0);
    check('创建临时课程', entry.status === 200 && entryId > 0, JSON.stringify(entry.body));

    const reader = await callApi(null, '/api/auth/register', 'POST', { username: readerName, password: PASSWORD });
    readerId = Number(reader.body?.data?.user?.id || 0);
    const writer = await callApi(null, '/api/auth/register', 'POST', { username: writerName, password: PASSWORD });
    writerId = Number(writer.body?.data?.user?.id || 0);
    const extra = await callApi(null, '/api/auth/register', 'POST', { username: extraName, password: PASSWORD });
    extraId = Number(extra.body?.data?.user?.id || 0);
    check('创建只读/读写测试账号', readerId > 0 && writerId > 0 && extraId > 0, JSON.stringify({ reader, writer, extra }));

    const readerToken = reader.body?.data?.token || '';
    const writerToken = writer.body?.data?.token || '';
    await callApi(readerToken, '/api/configs', 'PUT', { key: 'timetable_enabled', value: 'true' });
    await callApi(writerToken, '/api/configs', 'PUT', { key: 'timetable_enabled', value: 'true' });

    const readShare = await callApi(ownerToken, `/api/timetable/tables/${tableId}/shares`, 'POST', { username: readerName, permission: 'read' });
    const writeShare = await callApi(ownerToken, `/api/timetable/tables/${tableId}/shares`, 'POST', { username: writerName, permission: 'write' });
    check('共享只读账号', readShare.status === 200, JSON.stringify(readShare.body));
    check('共享读写账号', writeShare.status === 200, JSON.stringify(writeShare.body));

    // 只读不能写；读写能写且条目归表主。
    const denied = await callApi(readerToken, `/api/timetable/tables/${tableId}/entries`, 'POST', {
      title: '越权', weekday: 2, start_time: '09:00', end_time: '09:45',
    });
    check('只读账号写课程被拒（403）', denied.status === 403, JSON.stringify(denied.body));
    const allowed = await callApi(writerToken, `/api/timetable/tables/${tableId}/entries`, 'POST', {
      title: '读写新增', weekday: 3, start_time: '10:00', end_time: '10:45',
    });
    const writeEntryId = Number(allowed.body?.data?.id || 0);
    check('读写账号可以新增课程', allowed.status === 200 && writeEntryId > 0, JSON.stringify(allowed.body));
    if (writeEntryId) await callApi(writerToken, `/api/timetable/entries/${writeEntryId}`, 'DELETE');

    await withTab(async (page) => {
      await login(page, BASE);
      await page.goto(BASE + '/admin/timetable', { waitUntil: 'domcontentloaded' });
      await sleep(1600);
      const tabSel = `[data-timetable-tab="共享自检-${STAMP}"]`;
      check('表主能看到临时表', await waitSel(page, tabSel));
      await page.click(tabSel);
      await sleep(700);
      check('表主能看到「共享」按钮', await waitSel(page, '[data-timetable-share]'));
      await page.click('[data-timetable-share]');
      check('共享弹窗打开', await waitSel(page, '[data-share-dialog]'));
      const rows = await page.evaluate(() => [...document.querySelectorAll('[data-share-row]')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
      check('共享名单列出两个账号', rows.length === 2 && rows.some((r) => r.includes(readerName)) && rows.some((r) => r.includes(writerName)), JSON.stringify(rows));
      const hasForm = await page.evaluate(() => !!(document.querySelector('[data-share-username]') && document.querySelector('[data-share-permission]') && document.querySelector('[data-share-add]')));
      check('共享弹窗有用户名/权限/共享按钮', hasForm);
      await page.type('[data-share-username]', extraName);
      await page.select('[data-share-permission]', 'read');
      await page.click('[data-share-add]');
      await sleep(900);
      const rowsAfterAdd = await page.evaluate(() => [...document.querySelectorAll('[data-share-row]')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
      check('弹窗里能直接添加共享账号', rowsAfterAdd.length === 3 && rowsAfterAdd.some((r) => r.includes(extraName)), JSON.stringify(rowsAfterAdd));

      // 改权限：把 writer 从读写改成只读，再改回来，接口应同步。
      await page.evaluate((name) => {
        const row = [...document.querySelectorAll('[data-share-row]')].find((r) => r.innerText.includes(name));
        const select = row?.querySelector('[data-share-row-permission]');
        if (select) { select.value = 'read'; select.dispatchEvent(new Event('change', { bubbles: true })); }
      }, writerName);
      await sleep(900);
      const sharesAfterChange = (await callApi(ownerToken, `/api/timetable/tables/${tableId}/shares`)).body?.data?.shares || [];
      const writerShare = sharesAfterChange.find((s) => s.username === writerName);
      check('改权限会保存（读写→只读）', writerShare?.permission === 'read', JSON.stringify(sharesAfterChange));
      await page.evaluate((name) => {
        const row = [...document.querySelectorAll('[data-share-row]')].find((r) => r.innerText.includes(name));
        const select = row?.querySelector('[data-share-row-permission]');
        if (select) { select.value = 'write'; select.dispatchEvent(new Event('change', { bubbles: true })); }
      }, writerName);
      await sleep(900);
      check('改权限能再改回读写', (await callApi(ownerToken, `/api/timetable/tables/${tableId}/shares`)).body?.data?.shares?.find((s) => s.username === writerName)?.permission === 'write');
      await page.evaluate(() => {
        const dialog = document.querySelector('[data-share-dialog]');
        const mask = dialog?.closest('.fixed')?.querySelector('.absolute.inset-0');
        if (mask) mask.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await sleep(400);

      // 只读账号。
      await loginAs(page, readerName, PASSWORD);
      const readerTab = `[data-timetable-tab*="共享自检-${STAMP}"]`;
      check('只读账号能看到共享表', await waitSel(page, readerTab));
      const readBadge = await page.evaluate((sel) => document.querySelector(sel + ' .timetable-share-chip')?.textContent.trim(), readerTab);
      check('只读表带「只读」徽标', readBadge === '只读', String(readBadge));
      check('只读没有设置按钮', !(await page.evaluate(() => !!document.querySelector('[data-timetable-settings]'))));
      check('只读没有共享按钮', !(await page.evaluate(() => !!document.querySelector('[data-timetable-share]'))));
      check('只读没有编辑按钮', !(await page.evaluate(() => !!document.querySelector('[data-timetable-edit]'))));
      await page.click(readerTab);
      await sleep(800);
      check('只读账号能打开课程详情', await waitSel(page, `[data-entry-id="${entryId}"]`));
      await page.click(`[data-entry-id="${entryId}"]`);
      check('只读点课程出现只读详情', await waitSel(page, '[data-entry-view]'));
      check('只读详情没有保存按钮', !(await page.evaluate(() => !!document.querySelector('[data-entry-view] [data-entry-save]'))));
      check('只读详情说明是只读共享', await page.evaluate(() => (document.querySelector('[data-entry-view]')?.innerText || '').includes('只读')));

      // 读写账号。
      await loginAs(page, writerName, PASSWORD);
      check('读写账号能看到共享表', await waitSel(page, readerTab));
      const writeBadge = await page.evaluate((sel) => document.querySelector(sel + ' .timetable-share-chip')?.textContent.trim(), readerTab);
      check('读写表带「可编辑」徽标', writeBadge === '可编辑', String(writeBadge));
      check('读写有编辑按钮', await waitSel(page, '[data-timetable-edit]'));
      check('读写没有设置按钮', !(await page.evaluate(() => !!document.querySelector('[data-timetable-settings]'))));
      check('读写没有共享按钮', !(await page.evaluate(() => !!document.querySelector('[data-timetable-share]'))));
      await page.click(readerTab);
      await sleep(700);
      await page.click('[data-timetable-edit]');
      await sleep(600);
      check('读写可以进编辑态', await page.evaluate(() => !!document.querySelector('[data-timetable-add-entry]')));
    });
  } finally {
    // 清理：删表（级联共享）、删两个测试账号。尽量不把自检数据留在库里。
    if (tableId && ownerToken) await callApi(ownerToken, `/api/timetable/tables/${tableId}`, 'DELETE').catch(() => {});
    if (readerId && ownerToken) await callApi(ownerToken, `/api/users/${readerId}`, 'DELETE').catch(() => {});
    if (writerId && ownerToken) await callApi(ownerToken, `/api/users/${writerId}`, 'DELETE').catch(() => {});
    if (extraId && ownerToken) await callApi(ownerToken, `/api/users/${extraId}`, 'DELETE').catch(() => {});
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('测试异常：', err);
  process.exit(1);
});
