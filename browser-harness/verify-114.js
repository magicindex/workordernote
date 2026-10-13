/**
 * 这一批（用户 2026-10-12 要求）：
 *
 *   1) **开始提醒时间**（reminder_all_day_time，个人偏好）：每天这个时间之前**不发任何提醒**
 *      ——「类似手机的免打扰」，0:00 起静默，到点后把攒着的提醒依次发出去。
 *   2) **逾期提醒时间**（task_overdue_time，个人偏好，默认 23:59）：**到期日当天过了这个点
 *      还没完成就算逾期**（与任务写了几点无关），并**发一条「已逾期」站内提醒**。
 *   3) **新建提醒默认结束时间**（task_expire_time，系统配置，默认 23:59）与逾期判定解耦：
 *      它只管新建时的默认值，用户把逾期时间设成 20:30 不会再被 23:59 顶掉。
 *
 * 实测（会临时改这三项配置，结束时全部还原）：
 *   · 把开始提醒时间设成「两小时后」→ 造一条刚过期的提醒 → 等 80 秒，**不该**有通知；
 *     再把它设成 00:00（不静默）→ 等 80 秒，通知**必须**到（证明是静默在拦，不是发不出去）。
 *   · 逾期时间设成「三分钟前」+ 宽限 0 → 造一条今天到期、已经过了这个点的任务 →
 *     等一会儿应出现 `reminder_overdue` 通知，且「今天」页把它画进「已逾期」卡片。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-114.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const QUIET_TITLE = `自检免打扰-${STAMP}`;
const OVERDUE_TITLE = `自检逾期-${STAMP}`;

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

const setConfig = (page, key, value) => api(page, '/api/configs', 'PUT', { key, value });
const getConfigs = async (page) => {
  const res = await api(page, '/api/configs');
  const list = res.body?.data;
  return Array.isArray(list) ? Object.fromEntries(list.map((i) => [i.key, i.value])) : (list || {});
};
const notificationsFor = async (page, reminderID, type) => {
  const res = await api(page, '/api/reminder/notifications');
  const rows = res.body?.data || [];
  return rows.filter((n) => n.reminder_id === reminderID && (!type || n.type === type));
};

(async () => {
  const created = [];
  let original = {};
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    original = await getConfigs(page);
    // 只有「显式写过」的个人偏好会出现在 /api/configs 里：没写过的实例（例如刚装的沙箱）
    // 读不到 task_overdue_time —— 那正好等于默认值 23:59，收尾按默认还回去即可。
    check('读到当前配置（用于收尾还原）', !!original.reminder_all_day_time,
      JSON.stringify({ start: original.reminder_all_day_time, overdue: original.task_overdue_time || '（未显式设置 → 默认 23:59）' }));

    // ---------------- 1. 偏好设置里的三项（标签 + 时刻控件） ----------------
    await gotoRetry(page, BASE + '/admin/settings');
    await sleep(2200);
    const settingsUi = await page.evaluate(() => {
      const read = (key) => {
        const row = document.querySelector(`[data-config-key="${key}"]`);
        if (!row) return null;
        const input = row.querySelector('input, select');
        return { text: (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), type: input?.getAttribute('type') || input?.tagName?.toLowerCase() || '' };
      };
      return {
        start: read('reminder_all_day_time'),
        overdue: read('task_overdue_time'),
        defaultDue: read('task_expire_time'),
      };
    });
    check('偏好设置里有「开始提醒时间」，且是时刻控件（input[type=time]）',
      !!settingsUi.start && settingsUi.start.text.includes('开始提醒时间') && settingsUi.start.type === 'time',
      JSON.stringify(settingsUi.start));
    check('偏好设置里有「逾期提醒时间」，且是时刻控件',
      !!settingsUi.overdue && settingsUi.overdue.text.includes('逾期提醒时间') && settingsUi.overdue.type === 'time',
      JSON.stringify(settingsUi.overdue));
    check('「新建提醒默认结束时间」也在设置里（系统配置页），不再是「任务过期时间」的叫法',
      !settingsUi.defaultDue || !settingsUi.defaultDue.text.includes('任务过期时间'),
      JSON.stringify(settingsUi.defaultDue));

    // ---------------- 2. 开始提醒时间：静默窗口真的拦得住 ----------------
    const now = new Date();
    // 挑一个「现在一定在它之前」的时刻：两小时后；靠近午夜时用 23:59（跨天就不试了，直接说明）
    const twoHoursLater = new Date(now.getTime() + 2 * 3600_000);
    const quietStart = twoHoursLater.getDate() === now.getDate()
      ? `${String(twoHoursLater.getHours()).padStart(2, '0')}:${String(twoHoursLater.getMinutes()).padStart(2, '0')}`
      : '23:59';
    const minutesToMidnight = (24 * 60) - (now.getHours() * 60 + now.getMinutes());
    if (minutesToMidnight < 10) {
      console.log('  · 离午夜不到 10 分钟，跳过「静默窗口」实测（跨天会让期望值不稳）');
    } else {
      check('把开始提醒时间设成两小时后（现在处于静默窗口里）',
        (await setConfig(page, 'reminder_all_day_time', quietStart)).status === 200, quietStart);
      const dueNow = new Date().toISOString();
      const madeQuiet = await api(page, '/api/reminder/items', 'POST', {
        title: QUIET_TITLE, due_at: dueNow, repeat_rule: 'none', channels: ['inapp'],
      });
      const quietID = madeQuiet.body?.data?.id ?? null;
      if (quietID) created.push(quietID);
      check('造一条刚过期的提醒（用于验证静默）', !!quietID);
      // 0.24.0 起「新建之后至少 10 分钟才第一次提醒」（用户 2026-10-13，见服务端
      // firstRemindSchedule）：下面这几条用例考的是站内通知/弹窗本身，不是新建口径，
      // 所以把这条「稍后提醒」到 3 秒后 —— 稍后提醒是用户明确点的时刻，不吃那 10 分钟。
      if (quietID) await api(page, `/api/reminder/items/${quietID}/snooze`, 'POST', { until: new Date(Date.now() + 3000).toISOString() });
      await sleep(80_000);
      const quietNotes = quietID ? await notificationsFor(page, quietID) : [];
      check(`静默窗口里不发提醒（等了 80 秒，通知数 ${quietNotes.length}）`,
        quietNotes.length === 0, JSON.stringify(quietNotes.map((n) => n.type)));

      // 关掉静默：同一个提醒应该马上发出来（证明前面不是「发不出去」）
      check('把开始提醒时间设成 00:00（不静默）',
        (await setConfig(page, 'reminder_all_day_time', '00:00')).status === 200);
      let delivered = [];
      for (let i = 0; i < 4 && !delivered.length; i += 1) {
        await sleep(30_000);
        delivered = quietID ? await notificationsFor(page, quietID, 'reminder_due') : [];
      }
      check('静默结束后这条提醒补发出来了（说明是静默在拦）',
        delivered.length > 0, JSON.stringify(delivered.map((n) => n.type)));
    }

    // ---------------- 3. 逾期提醒时间：进入逾期 + 提醒 ----------------
    const overdueNow = new Date();
    const cutoff = new Date(overdueNow.getTime() - 3 * 60_000);
    const cutoffText = `${String(cutoff.getHours()).padStart(2, '0')}:${String(cutoff.getMinutes()).padStart(2, '0')}`;
    let dueCandidate = new Date(overdueNow.getTime() - 20 * 60_000);
    // 刚过午夜时「20 分钟前」会落到昨天：那它的到期日就不是今天，取今天 00:01
    if (dueCandidate.getDate() !== overdueNow.getDate()) {
      dueCandidate = new Date(overdueNow.getFullYear(), overdueNow.getMonth(), overdueNow.getDate(), 0, 1, 0, 0);
    }
    check('设置：逾期提醒时间 = 三分钟前、宽限 0、不静默',
      (await setConfig(page, 'task_overdue_time', cutoffText)).status === 200
      && (await setConfig(page, 'task_overdue_after_minutes', '0')).status === 200
      && (await setConfig(page, 'reminder_all_day_time', '00:00')).status === 200,
      cutoffText);
    const madeOverdue = await api(page, '/api/reminder/items', 'POST', {
      title: OVERDUE_TITLE, due_at: dueCandidate.toISOString(), repeat_rule: 'none', channels: ['inapp'],
    });
    const overdueID = madeOverdue.body?.data?.id ?? null;
    if (overdueID) created.push(overdueID);
    check('造一条「今天到期、已过逾期提醒时间」的任务', !!overdueID);

    let overdueNotes = [];
    for (let i = 0; i < 5 && !overdueNotes.length; i += 1) {
      await sleep(25_000);
      overdueNotes = overdueID ? await notificationsFor(page, overdueID, 'reminder_overdue') : [];
    }
    check('到了逾期提醒时间会发一条「已逾期」站内提醒', overdueNotes.length > 0,
      JSON.stringify(overdueNotes.map((n) => n.type)));
    if (overdueNotes.length) {
      check('逾期提醒的标题/内容写清了到期日与逾期时间',
        overdueNotes[0].title.includes('已逾期') && overdueNotes[0].body.includes(cutoffText),
        `${overdueNotes[0].title} | ${overdueNotes[0].body}`);
    }

    // 前端：列表页把它画进「已逾期」卡片（口径与后端一致）
    await gotoRetry(page, BASE + '/admin');
    await sleep(2600);
    const inOverdueCard = await page.evaluate((title) => {
      const card = document.querySelector('[data-day-group="overdue"]');
      if (!card) return { found: false, titles: [] };
      const titles = [...card.querySelectorAll('h3')].map((h) => (h.textContent || '').trim());
      return { found: titles.some((t) => t.includes(title)), titles };
    }, OVERDUE_TITLE);
    check('前端「今天」页把这条任务归进「已逾期」卡片（前后端口径一致）',
      inOverdueCard.found === true, JSON.stringify(inOverdueCard.titles.slice(0, 5)));

    // ---------------- 4. 清理与还原 ----------------
    // 逾期提醒是**会弹窗**的站内通知（与到点提醒同一套）：不清掉的话它会盖在页面上
    // 挡住后面的用例点击（本轮全量回归里 verify-013/017/reminders 就是这么假红的）。
    const notesRes = await api(page, '/api/reminder/notifications');
    for (const n of (notesRes.body?.data || [])) {
      if (!n.read_at && created.includes(n.reminder_id)) {
        await api(page, `/api/reminder/notifications/${n.id}/read`, 'POST');
      }
    }
    for (const id of created) {
      if (id) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    }
    for (const [key, value] of Object.entries({
      reminder_all_day_time: original.reminder_all_day_time || '08:00',
      task_overdue_time: original.task_overdue_time || '23:59',
      task_overdue_after_minutes: original.task_overdue_after_minutes || '30',
    })) {
      await setConfig(page, key, value);
    }
    await sleep(800);
    const restored = await getConfigs(page);
    const remaining = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data?.items || [];
    check('清理干净：两条测试提醒都删掉了',
      !remaining.some((i) => [QUIET_TITLE, OVERDUE_TITLE].includes(String(i.title))),
      JSON.stringify(remaining.filter((i) => String(i.title).includes('自检')).map((i) => i.title).slice(0, 5)));
    check('三项配置都还原成原值',
      restored.reminder_all_day_time === (original.reminder_all_day_time || '08:00')
      && restored.task_overdue_time === (original.task_overdue_time || '23:59')
      && restored.task_overdue_after_minutes === (original.task_overdue_after_minutes || '30'),
      JSON.stringify({
        start: restored.reminder_all_day_time, overdue: restored.task_overdue_time, grace: restored.task_overdue_after_minutes,
      }));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
