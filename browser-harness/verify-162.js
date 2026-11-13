/**
 * 完成备注（用户 2026-11-12）：
 *   「点击任务前边按钮完成任务的时候 弹窗添加备注框，确定，取消，不要直接完成。
 *     弹窗默认聚焦备注框，回车确定，Esc 取消，空备注也允许直接完成。」
 *
 * 覆盖：
 *   1) 点行首圆扣**不再直接完成**，先弹窗；弹窗里默认聚焦备注框
 *   2) Esc / 取消：关窗、任务仍未完成、接口没被调用
 *   3) 回车确定：带备注完成，一次性任务的备注落库并在「已完成」里显示
 *   4) 空备注点确定：同样能完成（不报错、不拦）
 *   5) 循环任务：备注落在这一次的完成记录上，不会带到下一次（提醒上的 completed_note 仍为空）
 *   6) 「已完成」页行内显示「完成备注」；撤销完成后一次性任务的备注一起清掉
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-162.js
 * 数据：自建 3 条提醒，跑完删掉。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
const T_ONCE = `完成备注自检-一次性-${STAMP}`;
const T_REPEAT = `完成备注自检-循环-${STAMP}`;
const T_CANCEL = `完成备注自检-取消-${STAMP}`;

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
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}, { base: BASE, p, method, body });

/** 当前行：按标题找到列表行，返回它前面的完成按钮是否可点 */
const rowOf = (page, title) => page.evaluate((title) => {
  const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes(title));
  if (!row) return null;
  const btn = row.querySelector('.complete-button');
  return { hasButton: !!btn, disabled: btn ? btn.disabled : null };
}, title);

const clickComplete = (page, title) => page.evaluate((title) => {
  const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes(title));
  const btn = row && row.querySelector('.complete-button');
  if (!btn) return false;
  btn.click();
  return true;
}, title);

const dialogState = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[data-complete-dialog]');
  if (!dlg) return { open: false };
  const ta = dlg.querySelector('[data-complete-note]');
  return {
    open: true,
    hasNote: !!ta,
    focused: !!ta && document.activeElement === ta,
    rows: ta ? Number(ta.getAttribute('rows')) : 0,
    height: ta ? Math.round(ta.getBoundingClientRect().height) : 0,
    confirmText: (dlg.querySelector('[data-complete-confirm]') || {}).textContent?.trim() || '',
    cancelText: (dlg.querySelector('[data-complete-cancel]') || {}).textContent?.trim() || '',
    title: (dlg.querySelector('[data-complete-title]') || {}).textContent?.trim() || '',
    noteValue: ta ? ta.value : '',
  };
});

const setNote = (page, text) => page.evaluate((text) => {
  const ta = document.querySelector('[data-complete-note]');
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
  return true;
}, text);

const itemById = async (page, id) => {
  const res = await api(page, `/api/reminder/items/${id}`);
  return res.json?.data || null;
};
const completedRows = (page) => page.evaluate(() => [...document.querySelectorAll('.reminder-row')].map((r) => ({
  text: r.textContent.replace(/\s+/g, ' ').trim(),
  // 2026-11-13 起不再是一枚「完成备注」小标签，而是按时间戳拼接的备注时间线
  note: r.querySelector('[data-note-timeline]')?.textContent.replace(/\s+/g, ' ').trim() || '',
  timeline: [...r.querySelectorAll('[data-note-label]')].map((el) => el.textContent.trim()),
})));

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);
    await page.setViewport({ width: 1440, height: 900 });

    // 造数据：今天到期的一次性 / 循环各一条，外加一条用来测「取消」
    const now = new Date();
    now.setHours(now.getHours() + 2, 0, 0, 0);
    const dueAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00+08:00`;
    const lists = await api(page, '/api/reminder/lists');
    const listID = (lists.json?.data || [])[0]?.id;
    const created = {};
    for (const [key, title, repeat] of [['once', T_ONCE, 'none'], ['repeat', T_REPEAT, 'daily'], ['cancel', T_CANCEL, 'none']]) {
      const res = await api(page, '/api/reminder/items', 'POST', {
        title, list_id: listID, due_at: dueAt, repeat_rule: repeat, calendar: 'solar', priority: 0, kind: 'task',
      });
      created[key] = res.json?.data?.id;
      if (!created[key]) throw new Error('造数据失败: ' + JSON.stringify(res.json).slice(0, 200));
    }

    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.reminder-row'), { timeout: 20000 });
    await sleep(1200);

    // ---------- 1. 点圆扣先弹窗，不直接完成 ----------
    check('待办页能看到自检的一次性任务', !!(await rowOf(page, T_ONCE)), T_ONCE);
    await clickComplete(page, T_ONCE);
    await sleep(500);
    const dlg = await dialogState(page);
    check('点行首圆扣先弹出「完成备注」弹窗（不是直接完成）', dlg.open === true, JSON.stringify(dlg));
    check('弹窗里有备注框，且默认聚焦', dlg.hasNote && dlg.focused, JSON.stringify({ has: dlg.hasNote, focused: dlg.focused }));
    check('备注框是 3 行、不是被压成一行', dlg.rows === 3 && dlg.height >= 60, JSON.stringify({ rows: dlg.rows, h: dlg.height }));
    check('弹窗有「确定 / 取消」两个按钮', dlg.confirmText === '确定' && dlg.cancelText === '取消',
      JSON.stringify({ ok: dlg.confirmText, cancel: dlg.cancelText }));
    check('弹窗标题带上这条提醒的名字', dlg.title.includes(T_ONCE), dlg.title);
    const beforeCancel = await itemById(page, created.once);
    check('弹窗打开时这条还没被完成', beforeCancel && !beforeCancel.completed_at, JSON.stringify(beforeCancel && beforeCancel.completed_at));
    await page.screenshot({ path: path.join(SHOTS, 'complete-note-dialog.png') });

    // ---------- 2. Esc 取消：关窗、不完成 ----------
    await setNote(page, '写到一半算了');
    await page.keyboard.press('Escape');
    await sleep(500);
    const afterEsc = await dialogState(page);
    const afterEscItem = await itemById(page, created.once);
    check('Esc 关掉弹窗', afterEsc.open === false, JSON.stringify(afterEsc));
    check('Esc 之后这条仍是未完成（没调完成接口）', afterEscItem && !afterEscItem.completed_at,
      JSON.stringify(afterEscItem && afterEscItem.completed_at));

    // ---------- 3. 回车确定：带备注完成 ----------
    await clickComplete(page, T_ONCE);
    await sleep(500);
    const note = '已换好电瓶，旧的留在车库';
    await setNote(page, note);
    // 输入法组词时的回车不能误触发：这里只按普通回车
    await page.keyboard.press('Enter');
    await sleep(1800);
    const afterEnter = await dialogState(page);
    check('回车即确定，弹窗关闭', afterEnter.open === false, JSON.stringify(afterEnter));
    const onceItem = await itemById(page, created.once);
    check('回车确定后这条已完成', !!(onceItem && onceItem.completed_at), JSON.stringify(onceItem && onceItem.completed_at));
    check('一次性任务的备注落库（completed_note）', onceItem && onceItem.completed_note === note,
      JSON.stringify(onceItem && onceItem.completed_note));

    // ---------- 4. 空备注也能完成 ----------
    await clickComplete(page, T_REPEAT);
    await sleep(500);
    const emptyDlg = await dialogState(page);
    check('循环任务同样先弹窗', emptyDlg.open === true, JSON.stringify(emptyDlg));
    await page.evaluate(() => document.querySelector('[data-complete-confirm]').click());
    await sleep(1800);
    const repeatItem = await itemById(page, created.repeat);
    check('空备注点「确定」照样完成（循环任务：due_at 滚到下一次、completed_at 为空）',
      repeatItem && !repeatItem.completed_at && repeatItem.due_at, JSON.stringify(repeatItem && repeatItem.due_at));

    // ---------- 5. 循环任务的备注记在这一次完成上，不带到下一次 ----------
    // 再完成一次（这次写备注），然后看这条提醒自己身上没有备注残留
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);
    // 循环任务完成一次后 due_at 是明天，待办页看不到；直接从已完成页操作不可行，
    // 所以改用接口再完成一次并核对历史行的备注归属
    const complete2 = await api(page, `/api/reminder/items/${created.repeat}/complete`, 'POST', { note: '第二次完成' });
    check('接口带备注完成返回 200', complete2.status === 200, String(complete2.status));
    const repeatAfter = await itemById(page, created.repeat);
    check('循环任务的完成备注不挂在提醒上（不会带到下一次）',
      repeatAfter && (repeatAfter.completed_note || '') === '', JSON.stringify(repeatAfter && repeatAfter.completed_note));
    const history = await api(page, `/api/reminder/completed?range=all`);
    const histRows = (history.json?.data?.items || []).filter((it) => it.title === T_REPEAT);
    check('每次完成的备注各自记在完成记录上',
      histRows.length >= 2 && histRows.some((it) => it.note === '第二次完成') && histRows.some((it) => it.note === ''),
      JSON.stringify(histRows.map((h) => h.note)));

    // ---------- 5b. 循环任务：编辑面板按时间列出历次完成备注 ----------
    await page.goto(BASE + '/admin/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1800);
    const openEditor = await page.evaluate((title) => {
      const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes(title));
      const btn = row?.querySelector('button.min-w-0');
      if (!btn) return false;
      btn.click();
      return true;
    }, T_REPEAT);
    await sleep(1600);
    const editorTimeline = await page.evaluate(() => {
      const box = document.querySelector('[data-editor-note-timeline]');
      return {
        has: !!box,
        labels: [...(box?.querySelectorAll('[data-note-label]') || [])].map((e) => e.textContent.trim()),
        times: [...(box?.querySelectorAll('[data-note-time]') || [])].map((e) => e.textContent.trim()),
        text: (box?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      };
    });
    // 这条循环任务第一次完成是空备注（只写进历史、没有 note），第二次才有字，
    // 所以面板里应当只有 1 条「完成备注」，内容就是第二次那句。
    check('编辑面板里有「备注记录（按时间）」并列出写过的完成备注',
      openEditor === true && editorTimeline.has === true
        && editorTimeline.labels.filter((l) => l === '完成备注').length === 1
        && editorTimeline.times.length === 1
        && editorTimeline.text.includes('第二次完成'),
      JSON.stringify(editorTimeline));
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);

    // ---------- 6. 取消按钮同样不完成 ----------
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);
    await clickComplete(page, T_CANCEL);
    await sleep(400);
    await setNote(page, '这条不该完成');
    await page.evaluate(() => document.querySelector('[data-complete-cancel]').click());
    await sleep(500);
    const cancelItem = await itemById(page, created.cancel);
    const cancelDlg = await dialogState(page);
    check('点「取消」关窗且不完成', cancelDlg.open === false && cancelItem && !cancelItem.completed_at,
      JSON.stringify({ open: cancelDlg.open, completed: cancelItem && cancelItem.completed_at }));

    // ---------- 7. 已完成页显示「完成备注」 ----------
    await page.goto(BASE + '/admin/completed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.reminder-row'), { timeout: 20000 });
    await sleep(1200);
    const rows = await completedRows(page);
    const onceRow = rows.find((r) => r.text.includes(T_ONCE));
    check('已完成页这条的备注时间线里有「完成备注」与内容',
      !!onceRow && onceRow.note.includes(note) && onceRow.timeline.includes('完成备注'), JSON.stringify(onceRow));
    await page.screenshot({ path: path.join(SHOTS, 'completed-note-row.png') });

    // ---------- 7a. 新建备注与完成备注按时间戳拼在一起 ----------
    const bothTitle = `两条备注自检-${STAMP}`;
    const madeBoth = await api(page, '/api/reminder/items', 'POST', {
      title: bothTitle, notes: '建的时候写的新建备注', due_at: new Date(Date.now() + 3600e3).toISOString(),
      repeat_rule: 'none', channels: ['inapp'],
    });
    const bothId = madeBoth.json?.data?.id;
    if (bothId) {
      await api(page, `/api/reminder/items/${bothId}/complete`, 'POST', { note: '完成时写的完成备注' });
      await page.goto(BASE + '/admin/completed', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitFor(page, () => !!document.querySelector('.reminder-row'), { timeout: 20000 });
      await sleep(1200);
      const bothRows = await completedRows(page);
      const bothRow = bothRows.find((r) => r.text.includes(bothTitle));
      const times = await page.evaluate((title) => {
        const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes(title));
        return [...(row?.querySelectorAll('[data-note-time]') || [])].map((el) => el.textContent.trim());
      }, bothTitle);
      check('已完成行里两条备注都在（新建备注 + 完成备注）',
        !!bothRow && bothRow.timeline.includes('新建备注') && bothRow.timeline.includes('完成备注'), JSON.stringify(bothRow));
      check('两条备注各自带时间戳（按时间分割）',
        times.length === 2 && times.every((t) => /\d{2}-\d{2} \d{2}:\d{2}/.test(t)), JSON.stringify(times));
      await api(page, `/api/reminder/items/${bothId}`, 'DELETE');
    } else {
      check('已完成行里两条备注都在（新建备注 + 完成备注）', false, '造数据失败');
      check('两条备注各自带时间戳（按时间分割）', false, '造数据失败');
    }

    // ---------- 7b. 「已完成」的搜索能搜到完成备注 ----------
    const searchBox = 'input[placeholder*="搜索提醒"]';
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '电瓶');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, searchBox);
    await sleep(1500);
    const hitRows = await completedRows(page);
    check('「已完成」里按完成备注也能搜到', hitRows.some((r) => r.text.includes(T_ONCE)), JSON.stringify(hitRows.slice(0, 2)));
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '完全不存在的词');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, searchBox);
    await sleep(1500);
    const missRows = await completedRows(page);
    check('搜不到时列表是空的', missRows.length === 0, JSON.stringify(missRows.slice(0, 2)));
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, searchBox);
    await sleep(1500);

    // ---------- 8. 撤销完成后备注一起清掉 ----------
    const undo = await page.evaluate(async (title) => {
      const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes(title));
      const btn = row && row.querySelector('button[title="撤销完成，恢复为未完成"]');
      if (!btn) return false;
      btn.click();
      return true;
    }, T_ONCE);
    check('已完成页有「撤销完成」入口', undo === true);
    await sleep(1800);
    const restored = await itemById(page, created.once);
    check('撤销完成后备注一起清掉',
      restored && !restored.completed_at && (restored.completed_note || '') === '',
      JSON.stringify({ completed: restored && restored.completed_at, note: restored && restored.completed_note }));

    // ---------- 9. 手机端 390px：弹窗不溢出、备注框默认聚焦 ----------
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);
    await page.setViewport({ width: 390, height: 844 });
    await sleep(900);
    // QA 实例里有到点的提醒会弹「知道了 / 稍后提醒」，它会盖在截图上方
    // （我们的弹窗在它下面但仍在 DOM 里）。为了截到干净的图，先把队里的弹窗确认掉。
    for (let i = 0; i < 6; i += 1) {
      const clicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim().startsWith('知道了'));
        btns.forEach((b) => b.click());
        return btns.length;
      });
      if (!clicked) break;
      await sleep(700);
    }
    await clickComplete(page, T_ONCE);
    await sleep(700);
    const narrowDlg = await page.evaluate(() => {
      const dlg = document.querySelector('[data-complete-dialog]');
      if (!dlg) return null;
      const rect = dlg.getBoundingClientRect();
      const ta = dlg.querySelector('[data-complete-note]');
      return {
        focused: !!ta && document.activeElement === ta,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
        hasConfirm: !!dlg.querySelector('[data-complete-confirm]'),
      };
    });
    check('手机端弹窗落在视口内、备注框仍默认聚焦、确定按钮在',
      !!narrowDlg && narrowDlg.inViewport && narrowDlg.focused && narrowDlg.hasConfirm
        && narrowDlg.width <= 390 - 32 + 1,
      JSON.stringify(narrowDlg));
    await page.screenshot({ path: path.join(SHOTS, 'complete-note-dialog-390.png') });
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.setViewport({ width: 1440, height: 900 });

    // ---------- 10. 日历里点圆扣也是先弹窗（只开窗 + Esc，不改数据） ----------
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    // 日历详情面板里列的是「那一天」的任务，但用户库里的格子可能全是已完成的
    // （只显示「恢复提醒」）。为确定性：造一条今天到期的任务，再点今天那格。
    const calTitle = `完成备注日历自检-${STAMP}`;
    const nowCal = new Date();
    nowCal.setHours(nowCal.getHours() + 1, 0, 0, 0);
    const calDue = `${nowCal.getFullYear()}-${String(nowCal.getMonth() + 1).padStart(2, '0')}-${String(nowCal.getDate()).padStart(2, '0')}T${String(nowCal.getHours()).padStart(2, '0')}:${String(nowCal.getMinutes()).padStart(2, '0')}:00+08:00`;
    const calCreated = await api(page, '/api/reminder/items', 'POST', {
      title: calTitle, due_at: calDue, repeat_rule: 'none', channels: ['inapp'],
    });
    const calID = calCreated.json?.data?.id;
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2200);
    // 格子上的 date 属性就是它代表的那天（data-cal-date=YYYY-MM-DD）；点今天那格，
    // 别随手点第一格 —— 那会把详情面板切到别的日期，看不到刚建的任务。
    await page.evaluate(() => {
      const now = new Date();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const cell = document.querySelector(`[data-cal-date="${key}"]`);
      if (cell) cell.click();
    });
    await sleep(900);
    const calClicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-label="完成提醒"]')].find((b) => b.offsetParent !== null);
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(600);
    const calDlg = await dialogState(page);
    check('日历里点圆扣也先弹「完成备注」弹窗', calClicked === true && calDlg.open === true,
      JSON.stringify({ clicked: calClicked, open: calDlg.open }));
    const calNotified = await page.evaluate(() => !!document.querySelector('[data-complete-note]'));
    check('日历弹窗同样有备注框', calNotified === true);
    await page.keyboard.press('Escape');
    await sleep(400);
    check('日历弹窗 Esc 后关闭', (await dialogState(page)).open === false);

    // ---------- 收尾：删掉自检数据 ----------
    if (calID) await api(page, `/api/reminder/items/${calID}`, 'DELETE');
    for (const id of Object.values(created)) {
      await api(page, `/api/reminder/items/${id}`, 'DELETE');
    }
    const left = await page.evaluate(async ({ base, names }) => {
      const token = localStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/items?view=all&status=all', { headers: { Authorization: 'Bearer ' + token } });
      const json = await res.json().catch(() => null);
      return (json?.data || []).filter((it) => names.some((n) => it.title === n)).length;
    }, { base: BASE, names: [T_ONCE, T_REPEAT, T_CANCEL] });
    check('自检数据已清理', left === 0, `还剩 ${left} 条`);

    console.log(`  截图：${path.join(SHOTS, 'complete-note-dialog.png')} / completed-note-row.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
