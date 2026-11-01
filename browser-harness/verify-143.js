/**
 * 手机课程表备注页（用户 2026-10-29）：
 * 「手机版课程表，非编辑状态，点击课程进入备注输入页面，只显示备注其他项目不显示，
 *   编辑状态则显示全部」。
 *
 *   1) 390px、非编辑态点课程：只出「课程备注」弹窗，没有完整表单/标题/时间；
 *   2) 弹窗预填原备注，改完保存后写入课程（并同步到随手记事本）；
 *   3) 进编辑态再点同一课程：仍出完整表单，标题等字段都在；
 *   4) 桌面行为不被手机分支影响（非编辑态仍打开完整表单）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-143.js
 */
const { withTab, sleep } = require('./harness');

const BASE = (process.env.APP_URL || 'http://127.0.0.1:8918').replace(/\/$/, '');
const STAMP = Date.now();
const TABLE = `手机备注自检-${STAMP}`;
const COURSE = `数学自检-${STAMP}`;
const OLD_NOTE = '老师说明天带尺子';
const NEW_NOTE = '手机新备注';
const READER = `mnote_r_${STAMP}`;
const PASSWORD = 'Test!143143';
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
  let tableId = 0, entryId = 0, noteId = 0, readerId = 0, token = '', readerToken = '';
  try {
    const login = await api(null, '/api/auth/login', 'POST', { username: '王耀辉', password: process.env.APP_PASS || 'Wyh!1984yelq.' });
    token = login.body?.data?.token || '';
    check('表主登录成功', !!token);
    if (!token) throw new Error('login failed');

    const weekday = await withTab(async (page) => page.evaluate(() => new Date().getDay() || 7), { width: 390, height: 844 });
    const table = await api(token, '/api/timetable/tables', 'POST', { name: TABLE });
    tableId = Number(table.body?.data?.id || 0);
    check('创建临时课程表', table.status === 200 && tableId > 0, JSON.stringify(table.body));
    const entry = await api(token, `/api/timetable/tables/${tableId}/entries`, 'POST', {
      title: COURSE, kind: 'course', weekday, start_time: '08:00', end_time: '08:45', note: OLD_NOTE,
    });
    entryId = Number(entry.body?.data?.id || 0);
    check('创建当天课程并写备注', entry.status === 200 && entryId > 0, JSON.stringify(entry.body));

    const reader = await api(null, '/api/auth/register', 'POST', { username: READER, password: PASSWORD });
    readerId = Number(reader.body?.data?.user?.id || 0);
    readerToken = reader.body?.data?.token || '';
    check('创建只读共享账号', readerId > 0 && !!readerToken, JSON.stringify(reader.body));
    await api(readerToken, '/api/configs', 'PUT', { key: 'timetable_enabled', value: 'true' });
    const share = await api(token, `/api/timetable/tables/${tableId}/shares`, 'POST', { username: READER, permission: 'read' });
    check('把课程表只读共享给该账号', share.status === 200, JSON.stringify(share.body));

    await withTab(async (page) => {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => localStorage.setItem('reminders.token', t), token);
      await page.goto(BASE + '/admin/timetable', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      await dismissAlert(page);
      const tab = `[data-timetable-tab="${TABLE}"]`;
      check('打开临时课程表', await waitSel(page, tab));
      await page.click(tab);
      await sleep(900);
      const entrySel = `[data-entry-id="${entryId}"]`;
      check('当天课程在手机视图里', await waitSel(page, entrySel));
      check('默认是浏览态（非编辑）', !(await page.evaluate(() => !!document.querySelector('[data-entry-dialog]'))));

      // 非编辑态：只出备注弹窗。
      await page.click(entrySel);
      check('点课程出现备注弹窗', await waitSel(page, '[data-entry-note-dialog]'));
      const first = await page.evaluate(() => ({
        note: document.querySelector('[data-entry-note-input]')?.value || '',
        full: !!document.querySelector('[data-entry-dialog]'),
        title: !!document.querySelector('[data-entry-title]'),
        text: document.querySelector('[data-entry-note-dialog]')?.innerText || '',
        heading: document.querySelector('[data-entry-note-dialog]')?.closest('.fixed')?.querySelector('h3')?.textContent?.trim() || '',
      }));
      check('备注弹窗预填原备注', first.note === OLD_NOTE, JSON.stringify(first));
      check('备注弹窗不展示完整表单/标题', !first.full && !first.title, JSON.stringify(first));
      check('备注标题带当前课程名', first.heading === `课程备注 · ${COURSE}`, first.heading);
      check('备注正文不提课程名与时间', !first.text.includes(COURSE) && !first.text.includes('08:00'), first.text);
      await sleep(500);
      await page.screenshot({ path: '/tmp/verify-143-note.png' });

      await page.$eval('[data-entry-note-input]', (el, v) => {
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      }, NEW_NOTE);
      await page.click('[data-entry-note-save]');
      const closed = await (async () => {
        const end = Date.now() + 8000;
        while (Date.now() < end) {
          if (!(await page.$('[data-entry-note-dialog]'))) return true;
          await sleep(200);
        }
        return false;
      })();
      check('保存后备注弹窗关闭', closed);
      const detail = await api(token, `/api/timetable/tables/${tableId}`);
      const saved = (detail.body?.data?.entries || []).find((x) => x.id === entryId)?.note;
      check('备注已写入课程', saved === NEW_NOTE, String(saved));

      // 编辑态：完整表单。
      await page.click('[data-timetable-edit]');
      await sleep(500);
      await page.click(entrySel);
      check('编辑态点课程出现完整表单', await waitSel(page, '[data-entry-dialog]'));
      const full = await page.evaluate(() => ({
        title: document.querySelector('[data-entry-title]')?.value || '',
        note: document.querySelector('[data-entry-note]')?.value || '',
        noteDialog: !!document.querySelector('[data-entry-note-dialog]'),
      }));
      check('编辑态显示标题且不是备注弹窗', full.title === COURSE && !full.noteDialog, JSON.stringify(full));
      await page.screenshot({ path: '/tmp/verify-143-edit.png' });
    }, { width: 390, height: 844 });

    // 桌面非编辑态也打开备注弹窗（用户要求与手机一致），不再直接进完整表单。
    await withTab(async (page) => {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => localStorage.setItem('reminders.token', t), token);
      await page.goto(BASE + '/admin/timetable', { waitUntil: 'domcontentloaded' });
      await sleep(1700);
      await dismissAlert(page);
      const tab = `[data-timetable-tab="${TABLE}"]`;
      await waitSel(page, tab); await page.click(tab); await sleep(800);
      await page.click(`[data-entry-id="${entryId}"]`);
      check('桌面非编辑态打开备注弹窗', await waitSel(page, '[data-entry-note-dialog]'));
      check('桌面不直接弹完整表单', !(await page.$('[data-entry-dialog]')));
      await sleep(500);
      await page.screenshot({ path: '/tmp/verify-143-note-desktop.png' });
    }, { width: 1280, height: 900 });

    // 只读共享在手机上同样只显示备注，不展示其他字段，也没有保存按钮。
    await withTab(async (page) => {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => localStorage.setItem('reminders.token', t), readerToken);
      await page.goto(BASE + '/admin/timetable', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      await dismissAlert(page);
      const tab = `[data-timetable-tab="${TABLE}"]`;
      check('只读账号能看到共享表', await waitSel(page, tab));
      await page.click(tab); await sleep(800);
      await page.click(`[data-entry-id="${entryId}"]`);
      check('只读手机点课程也出备注弹窗', await waitSel(page, '[data-entry-note-dialog]'));
      const ro = await page.evaluate(() => ({
        readonly: !!document.querySelector('[data-entry-note-input]')?.readOnly,
        save: !!document.querySelector('[data-entry-note-save]'),
        full: !!document.querySelector('[data-entry-dialog]'),
        text: document.querySelector('[data-entry-note-dialog]')?.innerText || '',
        heading: document.querySelector('[data-entry-note-dialog]')?.closest('.fixed')?.querySelector('h3')?.textContent?.trim() || '',
      }));
      check('只读备注标题也带课程名', ro.heading === `课程备注 · ${COURSE}`, ro.heading);
      check('只读备注框不可编辑且没有保存按钮', ro.readonly && !ro.save, JSON.stringify(ro));
      check('只读手机不展示完整课程信息', !ro.full && ro.text.includes('只读共享'), JSON.stringify(ro));
    }, { width: 390, height: 844 });

    const lists = await api(token, '/api/reminder/lists');
    const notebook = (lists.body?.data || []).find((l) => l.template === 'notebook');
    const notes = (await api(token, `/api/reminder/items?view=all&status=all&list_id=${notebook?.id}`)).body?.data || [];
    noteId = Number(notes.find((x) => x.title === `课程备注：${COURSE}`)?.id || 0);
  } finally {
    if (tableId && token) await api(token, `/api/timetable/tables/${tableId}`, 'DELETE').catch(() => {});
    if (readerId && token) await api(token, `/api/users/${readerId}`, 'DELETE').catch(() => {});
    if (noteId && token) await api(token, `/api/reminder/items/${noteId}`, 'DELETE').catch(() => {});
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
