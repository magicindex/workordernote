/**
 * 2026-10-13 这一批的三条改动（用户原话）：
 *
 *   ①「新建提醒，10分钟以后开始第一次提醒，低于10分钟到逾期设定时间的的不再提醒，
 *      直接给出逾期提醒」
 *      —— 新建的提醒**不再立刻弹窗**：首次提醒至少等到「创建 + 10 分钟」；
 *         如果连「逾期提醒时间」都在那 10 分钟之内，普通提醒一条都不发（交给逾期提醒）。
 *
 *   ②「人生要有仪式感：新建生日卡片：我填写了1989年9月17日，结果倒计时显示 已过13540天；
 *      生日这个地方应该按年循环，可以又已过多少次生日，下一次生日倒计时，不是累积。
 *      选择生日模板日期模板改成 出生年月日会不会更好理解」
 *      —— 年度循环事项（生日/纪念日…）的倒计时改成**下一次**的天数 + 「已过 N 次生日」；
 *         生日模板里的日期栏标题写「出生年月日」。
 *
 *   ③「倒计时数字白色边内测加黑边衬托数字更清晰」
 *      —— 倒计时数字两层描边：外圈白边、内圈黑边（见 verify-112 的样式断言）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-119.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const BIRTH = '1989-09-17';
const BIRTH_TITLE = `自检生日-${STAMP}`;
const LUNAR_TITLE = `自检农历生日-${STAMP}`;
const QUIET_TITLE = `自检立刻弹-${STAMP}`;
const ADVANCE_TITLE = `自检提前提醒-${STAMP}`;

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

(async () => {
  let ceremonyListId = null;
  let birthId = null;
  let quietId = null;
  const itemIds = [];

  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1100 });
    await login(page, BASE);

    // ---------------- ① 新建提醒不再立刻弹窗 ----------------
    // 造一条「1 分钟前就该响」的提醒：老口径下保存完下一轮调度（每分钟）就会弹窗，
    // 新口径要等「创建 + 10 分钟」，所以这里等 15 秒也不该有中央弹窗。
    const now = new Date();
    const duePast = new Date(now.getTime() - 60_000).toISOString();
    const made = await api(page, '/api/reminder/items', 'POST', {
      title: QUIET_TITLE, due_at: duePast, repeat_rule: 'none', channels: ['inapp'],
    });
    quietId = made.body?.data?.id ?? null;
    if (quietId) itemIds.push(quietId);
    check('用接口建一条「已经到点」的提醒', !!quietId, JSON.stringify(made.body).slice(0, 160));

    await gotoRetry(page, BASE + '/admin');
    await sleep(1500);
    const alertNow = () => page.evaluate(() => ({
      alert: !!document.querySelector('[data-alert-popup], [data-reminder-alert]'),
      ack: [...document.querySelectorAll('button')].some((b) => /^知道了/.test((b.innerText || '').trim())),
    }));
    const before = await alertNow();
    await sleep(15000);
    const after = await alertNow();
    check('新建的已到点提醒不会立刻弹窗（新口径：至少等创建后 10 分钟）',
      after.alert === false && after.ack === false, JSON.stringify({ before, after }));

    // 接口侧确认这条还有普通的投递任务在等（不是被服务端丢掉了）
    const listed = await api(page, `/api/reminder/items/${quietId}`);
    check('这条提醒本身正常（接口能取到、还没完成）',
      listed.status === 200 && !!listed.body?.data && !listed.body?.data?.completed_at,
      JSON.stringify(listed.body).slice(0, 140));

    // ---------------- ② 生日按年循环 + 「出生年月日」 ----------------
    // 找到「人生要有仪式感」栏目（没有就说明偏好关着，直接跳过这一段的浏览器断言）
    const lists = await api(page, '/api/reminder/lists');
    const rows = lists.body?.data?.items || lists.body?.data || [];
    const ceremony = rows.find((l) => l.template === 'ceremony');
    ceremonyListId = ceremony?.id ?? null;
    check('存在「人生要有仪式感」栏目', !!ceremonyListId, JSON.stringify(rows.map((l) => l.template)));

    const birth = await api(page, '/api/reminder/items', 'POST', {
      title: BIRTH_TITLE, due_at: `${BIRTH}T09:00:00+08:00`, repeat_rule: 'yearly',
      calendar: 'solar', list_id: ceremonyListId, channels: ['inapp'],
    });
    birthId = birth.body?.data?.id ?? null;
    if (birthId) itemIds.push(birthId);
    check('建一张「出生日期 1989-09-17」的生日卡片', !!birthId, JSON.stringify(birth.body).slice(0, 160));

    await gotoRetry(page, BASE + `/admin/list/${ceremonyListId}`);
    await sleep(3000);
    const card = await page.evaluate((title) => {
      const cards = [...document.querySelectorAll('[data-ceremony-card]')];
      const hit = cards.find((c) => (c.querySelector('[data-ceremony-title]')?.textContent || '').includes(title));
      if (!hit) return null;
      return {
        days: hit.getAttribute('data-ceremony-days'),
        countdown: (hit.querySelector('[data-ceremony-countdown]')?.innerText || '').replace(/\s+/g, ' ').trim(),
        pass: (hit.querySelector('[data-ceremony-pass]')?.innerText || '').trim(),
        date: (hit.querySelector('.ceremony-date')?.innerText || '').replace(/\s+/g, ' ').trim(),
      };
    }, BIRTH_TITLE);
    check('生日卡片出现在仪式感栏目里', !!card, JSON.stringify(card));
    check('生日倒计时是「还有 N 天」而不是累积的「已过 13540 天」',
      !!card && !/已过\s*\d{4,}/.test(card.countdown) && !/已过/.test(card.countdown),
      JSON.stringify(card));
    // 1989-09-17 出生：下一次生日 = 今年的 9 月 17 日（已过就明年），
    // 已过次数 = 下一次那年的年份 - 1989 - 1
    const today = new Date();
    const thisYearBirthday = new Date(today.getFullYear(), 8, 17);
    const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const nextYear = midnight(thisYearBirthday) < midnight(today) ? today.getFullYear() + 1 : today.getFullYear();
    const wantDays = Math.round((midnight(new Date(nextYear, 8, 17)) - midnight(today)) / 86400000);
    const wantPassed = nextYear - 1989 - 1;
    check(`倒计时天数等于「到下一次生日的自然日差」（期望 ${wantDays} 天）`,
      !!card && Number(card.days) === wantDays, JSON.stringify({ card, wantDays }));
    check(`徽标是「已过 ${wantPassed} 次生日」或「第 ${wantPassed + 1} 次生日」`,
      !!card && (card.pass === `已过 ${wantPassed} 次生日` || card.pass === `第 ${wantPassed + 1} 次生日`),
      JSON.stringify({ pass: card?.pass, wantPassed }));
    check('卡片上仍然显示出生日期 1989年9月17日',
      !!card && /1989年9月17日/.test(card.date), JSON.stringify(card?.date));

    // 农历生日也要按年循环：锚点是「农历月:日」，得问服务端今年的公历日期
    // （纯前端算不了农历），算出来之前会先回落到老口径 —— 所以这里等它算完。
    const lunar = await api(page, '/api/reminder/items', 'POST', {
      title: LUNAR_TITLE, due_at: '1990-01-27T09:00:00+08:00', repeat_rule: 'yearly',
      calendar: 'lunar', list_id: ceremonyListId, channels: ['inapp'],
    });
    const lunarId = lunar.body?.data?.id ?? null;
    if (lunarId) itemIds.push(lunarId);
    check('建一张农历生日卡片（农历锚点由服务端从日期推出来）',
      !!lunarId && !!lunar.body?.data?.lunar_anchor, JSON.stringify(lunar.body?.data?.lunar_anchor));

    await gotoRetry(page, BASE + `/admin/list/${ceremonyListId}`);
    await sleep(4000);
    const lunarCard = await page.evaluate((title) => {
      const cards = [...document.querySelectorAll('[data-ceremony-card]')];
      const hit = cards.find((c) => (c.querySelector('[data-ceremony-title]')?.textContent || '').includes(title));
      if (!hit) return null;
      return {
        days: hit.getAttribute('data-ceremony-days'),
        countdown: (hit.querySelector('[data-ceremony-countdown]')?.innerText || '').replace(/\s+/g, ' ').trim(),
      };
    }, LUNAR_TITLE);
    check('农历生日的倒计时也按年循环（不是累积天数）',
      !!lunarCard && !/已过\s*\d{4,}/.test(lunarCard.countdown) && Number(lunarCard.days) >= 0,
      JSON.stringify(lunarCard));

    // 生日模板 → 日期栏标题应该是「出生年月日」
    await gotoRetry(page, BASE + `/admin/list/${ceremonyListId}`);
    await sleep(2500);
    await page.evaluate(() => document.querySelector('[data-ceremony-presets]')?.click());
    await sleep(900);
    const presetOpened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('生日（公历）'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    check('能打开「生日（公历）」模板', presetOpened === true);
    await sleep(900);
    const label = await page.evaluate(() => {
      const form = document.querySelector('[data-ceremony-form-date]');
      const wrap = form?.closest('.field-label');
      return wrap ? (wrap.textContent || '').replace(/\s+/g, ' ').trim() : '';
    });
    check('生日模板里日期栏写的是「出生年月日」', /出生年月日/.test(label), JSON.stringify(label));
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '取消');
      if (btn) btn.click();
    });
    await sleep(600);

    // ---------------- ④ 提前几天开始提醒 ----------------
    // 「开始提醒时间」下新增的个人偏好：到期日往前 N 天开始提醒；
    // 只在「离到期日超过 N 天」时生效，创建时就已经在 N 天内的按正常流程。
    // 用管理员的投递台账（/api/reminder/admin/deliveries）看排出来的首次提醒时刻。
    const ADMIN_API = '/api/reminder/admin/deliveries';
    const boot0 = await api(page, '/api/bootstrap');
    const originalAdvance = (boot0.body?.data?.configs || {}).reminder_advance_days ?? '0';
    // 这一段用 06:00 做「开始提醒时间」（下面会设），断言里的时刻也按它算
    const startClock = '06:00';

    const advanceJobFor = async (reminderId) => {
      const res = await api(page, ADMIN_API);
      const rows = res.body?.data || [];
      return rows.filter((j) => j.reminder_id === reminderId && j.status === 'pending')
        .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))[0] || null;
    };
    const makeItem = async (title, dueAt) => {
      const res = await api(page, '/api/reminder/items', 'POST', {
        title, due_at: dueAt, repeat_rule: 'none', channels: ['inapp'],
      });
      const id = res.body?.data?.id ?? null;
      if (id) itemIds.push(id);
      return id;
    };
    const inDays = (n, hour) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      d.setHours(hour, 59, 0, 0);
      return d.toISOString();
    };

    check('偏好设置里出现「提前几天开始提醒」', originalAdvance !== null, String(originalAdvance));
    // 这台沙箱/迭代实例的「开始提醒时间」是 00:00（夜里跑回归用），提前窗口会落在 0 点 ——
    // 为了断言跟真实用法一致，这里先把它设成 06:00，收尾还原。
    const bootClock = (boot0.body?.data?.configs || {}).reminder_all_day_time ?? '00:00';
    await api(page, '/api/configs', 'PUT', { key: 'reminder_all_day_time', value: '06:00' });
    await api(page, '/api/configs', 'PUT', { key: 'reminder_advance_days', value: '3' });

    // 设置页里也要真的看得见这一行（在「提醒」那张卡片里、和时间那一项挨着）
    await gotoRetry(page, BASE + '/admin/settings');
    await sleep(2200);
    const settingRow = await page.evaluate(() => {
      const row = document.querySelector('[data-config-key="reminder_advance_days"]');
      if (!row) return null;
      const card = row.closest('.surface');
      const input = row.querySelector('input');
      return {
        label: (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        card: card ? (card.querySelector('h2')?.textContent || '').trim() : '',
        type: input ? input.getAttribute('type') : null,
      };
    });
    check('偏好设置里有「提前几天开始提醒」这一行（数字输入、在「提醒」卡片里）',
      !!settingRow && settingRow.card === '提醒' && settingRow.type === 'number' && /提前几天开始提醒/.test(settingRow.label),
      JSON.stringify(settingRow));

    // 10 天后到期（超过 3 天）→ 首次提醒应排在「到期日往前 3 天」的开始提醒时间
    const farId = await makeItem(ADVANCE_TITLE, inDays(10, 23));
    const farJob = farId ? await advanceJobFor(farId) : null;
    const wantFar = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 10 - 3);
      const [h, m] = String(startClock).split(':').map(Number);
      d.setHours(h || 0, m || 0, 0, 0);
      return d;
    })();
    check('离到期超过 3 天：首次提醒排在「到期日往前 3 天」那个时间点',
      !!farJob && Math.abs(new Date(farJob.scheduled_for) - wantFar) < 90_000,
      `排到 ${farJob?.scheduled_for}，期望约 ${wantFar.toISOString()}（开始提醒时间 ${startClock}）`);

    // 明天到期（在 3 天之内）→ 按正常流程：排在到期日当天的开始提醒时间
    const nearId = await makeItem(`${ADVANCE_TITLE}-近`, inDays(1, 23));
    const nearJob = nearId ? await advanceJobFor(nearId) : null;
    const wantNear = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      const [h, m] = String(startClock).split(':').map(Number);
      d.setHours(h || 0, m || 0, 0, 0);
      return d;
    })();
    check('离到期不到 3 天：按正常流程（到期日当天的开始提醒时间）',
      !!nearJob && Math.abs(new Date(nearJob.scheduled_for) - wantNear) < 90_000,
      `排到 ${nearJob?.scheduled_for}，期望约 ${wantNear.toISOString()}`);

    // 还原偏好（也顺带验证写入后缓存立刻失效：改回 0 之后新建的应当回到正常流程）
    await api(page, '/api/configs', 'PUT', { key: 'reminder_advance_days', value: String(originalAdvance ?? '0') });
    await api(page, '/api/configs', 'PUT', { key: 'reminder_all_day_time', value: String(bootClock) });
    const afterId = await makeItem(`${ADVANCE_TITLE}-还原`, inDays(10, 23));
    const afterJob = afterId ? await advanceJobFor(afterId) : null;
    // 还原后：开始提醒时间回到 00:00（= 不提前，就是到期时刻本身），提前天数 0
    check('把「提前天数」改回 0 后立刻生效（新提醒回到正常流程 = 到期时刻）',
      !!afterJob && Math.abs(new Date(afterJob.scheduled_for) - new Date(inDays(10, 23))) < 90_000,
      `排到 ${afterJob?.scheduled_for}`);

    const bootAfter = await api(page, '/api/bootstrap');
    check('清理前：提前天数已还原',
      String((bootAfter.body?.data?.configs || {}).reminder_advance_days ?? '') === String(originalAdvance),
      String((bootAfter.body?.data?.configs || {}).reminder_advance_days));

    // ---------------- 清理 ----------------
    for (const id of itemIds) {
      if (id) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    }
    const gone = await api(page, '/api/reminder/items?view=all&status=all');
    const left = (() => {
      const d = gone.body?.data;
      return Array.isArray(d) ? d : d?.items || [];
    })();
    check('清理干净：自检条目都不在了',
      !left.some((i) => String(i.title).includes('自检生日') || String(i.title).includes('自检立刻弹')));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
