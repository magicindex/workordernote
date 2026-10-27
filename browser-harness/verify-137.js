/**
 * 课程表周快照 + 课程备注
 *
 *   1) 本周课程独立成快照；切到下一周会继承一份，改下周不影响本周
 *   2) 更早的周没有快照时保持空白，历史周只读（没有编辑/添加）
 *   3) 课程备注写入随手记事本：标题「课程备注：<课程名>」、正文同步
 *   4) 同一门课再次保存更新同一条；删课不删备注
 *   5) 记事本「课程备注」筛选只显示课程备注，并用课程卡片样式
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-137.js
 */
const { withTab, sleep } = require('./harness');

const BASE = (process.env.APP_URL || 'http://127.0.0.1:8918').replace(/\/$/, '');
const STAMP = Date.now();
const PASSWORD = 'Test!137137';
const TITLE = `周快照自检-${STAMP}`;
const COURSE = `数学自检-${STAMP}`;
const NEXT_COURSE = `高数自检-${STAMP}`;
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
async function api(token, path, method = 'GET', body = null) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text };
}
async function waitSel(page, sel, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}
async function dismissAlert(page) {
  for (let i = 0; i < 3; i++) {
    const hit = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('知道了'));
      if (b) { b.click(); return true; }
      return false;
    }).catch(() => false);
    if (!hit) return;
    await sleep(400);
  }
}

(async () => {
  let tableId = 0, entryId = 0, noteId = 0, ownerToken = '';
  try {
    const login = await api(null, '/api/auth/login', 'POST', { username: '王耀辉', password: process.env.APP_PASS || 'Wyh!1984yelq.' });
    ownerToken = login.body?.data?.token || '';
    check('表主登录成功', !!ownerToken);
    if (!ownerToken) throw new Error('login failed');

    const table = await api(ownerToken, '/api/timetable/tables', 'POST', { name: TITLE });
    tableId = Number(table.body?.data?.id || 0);
    check('创建临时课程表', table.status === 200 && tableId > 0, JSON.stringify(table.body));
    const entry = await api(ownerToken, `/api/timetable/tables/${tableId}/entries`, 'POST', {
      title: COURSE, kind: 'course', weekday: 2, start_time: '08:00', end_time: '08:45', note: '第一周备注',
    });
    entryId = Number(entry.body?.data?.id || 0);
    check('创建本周课程并写备注', entry.status === 200 && entryId > 0, JSON.stringify(entry.body));

    const lists = await api(ownerToken, '/api/reminder/lists');
    const notebook = (lists.body?.data || []).find((l) => l.template === 'notebook');
    const noteTitle = `课程备注：${COURSE}`;
    const notes1 = (await api(ownerToken, `/api/reminder/items?view=all&status=all&list_id=${notebook?.id}`)).body?.data || [];
    const note1 = notes1.find((x) => x.title === noteTitle);
    noteId = Number(note1?.id || 0);
    check('课程备注写入随手记事本', !!note1 && note1.notes === '第一周备注', JSON.stringify(note1));

    await withTab(async (page) => {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => localStorage.setItem('reminders.token', t), ownerToken);
      await page.goto(BASE + '/admin/timetable', { waitUntil: 'domcontentloaded' });
      await sleep(1700);
      await dismissAlert(page);
      const tab = `[data-timetable-tab="${TITLE}"]`;
      check('打开临时课程表', await waitSel(page, tab));
      await page.click(tab);
      await sleep(900);

      const now = await page.evaluate(() => ({
        label: document.querySelector('[data-week-label]')?.textContent || '',
        edit: !!document.querySelector('[data-timetable-edit]'),
        entries: document.querySelectorAll('[data-entry-id]').length,
      }));
      check('本周显示本周标签与课程', now.label.includes('本周') && now.entries === 1 && now.edit, JSON.stringify(now));

      await page.click('[data-week-next]');
      await sleep(1100);
      const future = await page.evaluate(() => ({
        label: document.querySelector('[data-week-label]')?.textContent || '',
        entries: document.querySelectorAll('[data-entry-id]').length,
        edit: !!document.querySelector('[data-timetable-edit]'),
      }));
      check('下一周自动继承同一份课程', future.label.includes('未来') && future.entries === 1 && future.edit, JSON.stringify(future));

      const nextEntry = await page.evaluate(() => document.querySelector('[data-entry-id]')?.getAttribute('data-entry-id'));
      const patched = await api(ownerToken, `/api/timetable/entries/${nextEntry}`, 'PATCH', { title: NEXT_COURSE });
      check('下一周可以单独编辑', patched.status === 200 && patched.body?.data?.title === NEXT_COURSE, JSON.stringify(patched.body));

      await page.click('[data-week-prev]');
      await sleep(1000);
      const back = await page.evaluate(() => ({
        text: [...document.querySelectorAll('[data-entry-id]')].map((e) => e.innerText).join(' '),
        label: document.querySelector('[data-week-label]')?.textContent || '',
      }));
      check('改下一周不影响本周', back.text.includes(COURSE) && !back.text.includes(NEXT_COURSE) && back.label.includes('本周'), JSON.stringify(back));

      await page.click('[data-week-prev]');
      await sleep(1000);
      const past = await page.evaluate(() => ({
        past: !!document.querySelector('[data-week-past]'),
        edit: !!document.querySelector('[data-timetable-edit]'),
        add: !!document.querySelector('[data-timetable-add-entry]'),
        empty: !!document.querySelector('[data-week-empty]'),
        entries: document.querySelectorAll('[data-entry-id]').length,
      }));
      check('历史周只读且没有编辑/添加入口', past.past && !past.edit && !past.add && past.empty && past.entries === 0, JSON.stringify(past));
      await page.click('[data-week-current]');
      await sleep(900);

      // 更新本周备注：同一条记事更新，不新增。
      const updated = await api(ownerToken, `/api/timetable/entries/${entryId}`, 'PATCH', { note: '第二周更新备注' });
      check('保存课程备注', updated.status === 200, JSON.stringify(updated.body));
      const notes2 = (await api(ownerToken, `/api/reminder/items?view=all&status=all&list_id=${notebook?.id}`)).body?.data || [];
      const same = notes2.filter((x) => x.title === noteTitle);
      check('同一门课更新同一条备注', same.length === 1 && same[0].notes === '第二周更新备注', JSON.stringify(same));

      await page.goto(BASE + `/admin/list/${notebook?.id}`, { waitUntil: 'domcontentloaded' });
      await sleep(1600);
      await dismissAlert(page);
      check('记事本有课程备注筛选按钮', await waitSel(page, '[data-course-notes-filter]'));
      const before = await page.evaluate(() => document.querySelectorAll('[data-reminder-row]').length);
      await page.click('[data-course-notes-filter]');
      await sleep(500);
      const filtered = await page.evaluate(() => ({
        rows: document.querySelectorAll('[data-reminder-row]').length,
        badges: document.querySelectorAll('[data-course-note-badge]').length,
        courseClass: document.querySelectorAll('.course-note-row').length,
        text: document.querySelector('[data-reminder-row]')?.innerText || '',
      }));
      check('筛选后只剩课程备注且带课程卡片样式', before >= 1 && filtered.rows > 0 && filtered.rows === filtered.badges && filtered.rows === filtered.courseClass && filtered.text.includes('课程备注'), JSON.stringify({ before, filtered }));
    });

    await api(ownerToken, `/api/timetable/entries/${entryId}`, 'DELETE');
    const notes3 = (await api(ownerToken, `/api/reminder/items?view=all&status=all&list_id=${notebook?.id}`)).body?.data || [];
    check('删课不删课程备注', notes3.some((x) => x.id === noteId), JSON.stringify(notes3.filter((x) => x.title === noteTitle)));
  } finally {
    if (tableId && ownerToken) await api(ownerToken, `/api/timetable/tables/${tableId}`, 'DELETE').catch(() => {});
    if (noteId && ownerToken) await api(ownerToken, `/api/reminder/items/${noteId}`, 'DELETE').catch(() => {});
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
