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
