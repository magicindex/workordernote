/**
 * 智能清单：今天页 / 计划页的分工（0.15.0 这批）。
 *
 * 用户要求：
 *   1) 今天页只显示今天的信息（逾期未完成的置顶）
 *   2) 计划页只显示「预设信息」：有循环规则的、有时间段的、或排在明天以后的任务
 *   3) 计划页新建用**自定义时间/时间段**，没有「今天/明天/本周末」这类相对快捷项
 *   4) 计划页的输入窗口与今天页**不同**：没有「记事」，只有任务
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-101.js
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const ROOT = BASE;
const SHOTS = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now();

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

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}
async function waitSel(page, sel, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const created = [];   // 收尾清理

    const iso = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      const off = -d.getTimezoneOffset();
      const s = off >= 0 ? '+' : '-';
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${s}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
    };
    const now = new Date();
    const todayEvening = new Date(now); todayEvening.setHours(21, 0, 0, 0);
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); yesterday.setHours(9, 0, 0, 0);
    const future = new Date(now); future.setDate(now.getDate() + 3); future.setHours(10, 0, 0, 0);
    const rangeStart = new Date(now); rangeStart.setDate(now.getDate() + 4); rangeStart.setHours(14, 0, 0, 0);
    const rangeEnd = new Date(rangeStart); rangeEnd.setHours(16, 0, 0, 0);

    // 造四条：今天到期的普通任务 / 逾期未完成的普通任务 / 明天以后的普通任务 / 循环任务
    //        + 一条只在数据库层造的时间段任务（计划页新建走 UI，见下面）
    const seed = async (title, body) => {
      const res = await api(page, '/api/reminder/items', 'POST', body);
      const id = res.body?.data?.id;
      if (id) created.push(id);
      return id;
    };
    await seed(`自检今天-${STAMP}`, { title: `自检今天-${STAMP}`, due_at: iso(todayEvening), repeat_rule: 'none', channels: ['inapp'] });
    await seed(`自检逾期-${STAMP}`, { title: `自检逾期-${STAMP}`, due_at: iso(yesterday), repeat_rule: 'none', channels: ['inapp'] });
    await seed(`自检未来-${STAMP}`, { title: `自检未来-${STAMP}`, due_at: iso(future), repeat_rule: 'none', channels: ['inapp'] });
    await seed(`自检循环-${STAMP}`, { title: `自检循环-${STAMP}`, due_at: iso(yesterday), repeat_rule: 'daily', channels: ['inapp'] });
    const rangeID = await seed(`自检时间段-${STAMP}`, {
      title: `自检时间段-${STAMP}`, start_at: iso(rangeStart), end_at: iso(rangeEnd), repeat_rule: 'none', channels: ['inapp'],
    });

    const titlesIn = async (view) => {
      const rows = (await api(page, `/api/reminder/items?view=${view}&status=open`)).body?.data;
      const list = Array.isArray(rows) ? rows : rows?.items || [];
      return list.filter((r) => String(r.title).includes(`-${STAMP}`)).map((r) => r.title);
    };

    // ---------- 1. 计划页只放「预设」 ----------
    const planned = await titlesIn('planned');
    check('计划页有「未来时间点」的任务', planned.includes(`自检未来-${STAMP}`), JSON.stringify(planned));
    check('计划页有「循环」的任务', planned.includes(`自检循环-${STAMP}`), JSON.stringify(planned));
    check('计划页有「时间段」的任务', planned.includes(`自检时间段-${STAMP}`), JSON.stringify(planned));
    check('计划页没有「只有今天」的普通任务', !planned.includes(`自检今天-${STAMP}`), JSON.stringify(planned));

    // ---------- 2. 待办页：近 7 天 + 逾期，逾期的排最前 ----------
    const todayRows = (await api(page, '/api/reminder/items?view=today&status=open')).body?.data;
    const todayList = Array.isArray(todayRows) ? todayRows : todayRows?.items || [];
    const mine = todayList.filter((r) => String(r.title).includes(`-${STAMP}`)).map((r) => r.title);
    check('待办页有今天到期的任务', mine.includes(`自检今天-${STAMP}`), JSON.stringify(mine));
    check('待办页有逾期未完成的任务', mine.includes(`自检逾期-${STAMP}`), JSON.stringify(mine));
    // 口径 2026-10-16 改成「近 7 天要办的」（用户：「今天 改成 近 7 天」）：+3 天那条未来任务
    // 现在**就在这一页**；挑 7 天以外的边界由 verify-105 的日期分组守着。
    check('待办页按新口径收「近 7 天」的普通任务（+3 天那条也在）',
      mine.includes(`自检未来-${STAMP}`), JSON.stringify(mine));
    const overdueIdx = todayList.findIndex((r) => r.title === `自检逾期-${STAMP}`);
    const todayIdx = todayList.findIndex((r) => r.title === `自检今天-${STAMP}`);
    check('逾期未完成的排在今天到期之前（置顶）', overdueIdx >= 0 && todayIdx >= 0 && overdueIdx < todayIdx,
      `逾期@${overdueIdx} 今天@${todayIdx}`);

    // ---------- 3. 计划页的输入窗口 ----------
    await page.setViewport({ width: 1280, height: 900 });
    await gotoRetry(page, ROOT + '/admin/planned');
    await openQuickAdd(page);
    await waitSel(page, '.quick-card', 20000);
    await sleep(1200);
    // 展开输入窗口（点标题框）
    await page.evaluate(() => document.querySelector('.quick-card input')?.focus());
    await sleep(900);
    const bar = await page.evaluate(() => {
      const card = document.querySelector('.quick-card');
      const text = card ? card.innerText : '';
      const chips = card ? [...card.querySelectorAll('button')].map((b) => b.innerText.trim()) : [];
      return {
        hasStart: /开始/.test(text),
        // 0.18.0 起计划页不再让用户手挑「结束」时间，改成「任务周期」
        // （1 天 / 1 周 / 1 月 / 年终 / 1 年 / 自定义）——「结束」只在自定义时出现
        hasPeriod: !!card?.querySelector('[data-plan-period]'),
        periodOptions: [...(card?.querySelectorAll('[data-plan-period] option') || [])].map((o) => o.textContent.trim()),
        hasNote: chips.includes('记事'), hasTomorrow: chips.includes('明天'),
        hasWeekend: chips.includes('本周末'), hasToday: chips.includes('今天'),
        placeholder: card?.querySelector('input')?.getAttribute('placeholder') || '',
        chips,
      };
    });
    check('计划页新建窗口有「开始」+「任务周期」（自定义时间段）',
      bar.hasStart && bar.hasPeriod && bar.periodOptions.includes('自定义'), JSON.stringify(bar));
    check('计划页新建窗口没有「记事」入口（计划里只有任务）', bar.hasNote === false, JSON.stringify(bar.chips));
    check('计划页新建窗口没有「今天 / 明天 / 本周末」相对快捷项',
      !bar.hasTomorrow && !bar.hasWeekend, JSON.stringify(bar.chips));
    await page.screenshot({ path: path.join(SHOTS, 'planned-quick.png') });

    // 通过 UI 新建：计划任务必须有开始时间，没选就点「添加」要被拦下并提示
    const needStart = await page.evaluate(async (title) => {
      const input = document.querySelector('.quick-card input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      await new Promise((r) => setTimeout(r, 300));
      const btn = [...document.querySelectorAll('.quick-card button')].find((b) => ['添加', '添加提醒'].includes(b.innerText.trim()));
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 1200));
      return {
        toast: document.body.innerText.includes('请先选择开始时间'),
        stillThere: document.querySelector('.quick-card input')?.value || '',
      };
    }, `自检无开始-${STAMP}`);
    check('计划页没选开始时间就提交：被拦下并提示', needStart.toast === true, JSON.stringify(needStart));
    await page.evaluate(() => { const i = document.querySelector('.quick-card input'); if (i) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); } });
    await sleep(400);

    // ---------- 4. 列表显示时间段 ----------
    await gotoRetry(page, ROOT + '/admin/planned');
    await waitSel(page, '.reminder-row', 20000);
    await sleep(1200);
    // 用 textContent 而不是 innerText：.reminder-row 带 content-visibility:auto，
    // 屏外的行 innerText 会是空串（分卡片后页面更长了，这个坑更容易踩到）。
    const rangeText = await page.evaluate((title) => {
      const row = [...document.querySelectorAll('.reminder-row')].find((el) => el.textContent.includes(title));
      return row ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    }, `自检时间段-${STAMP}`);
    check('计划页里时间段任务显示「开始 – 结束」',
      /14:00/.test(rangeText) && /16:00/.test(rangeText) && /–|-/.test(rangeText), rangeText);

    // ---------- 5. 今天页的输入窗口保持原样 ----------
    await gotoRetry(page, ROOT + '/admin');
    await openQuickAdd(page);
    await waitSel(page, '.quick-card', 20000);
    await sleep(1000);
    await page.evaluate(() => document.querySelector('.quick-card input')?.focus());
    await sleep(900);
    const todayBar = await page.evaluate(() => {
      const card = document.querySelector('.quick-card');
      const text = card ? card.innerText : '';
      const chips = card ? [...card.querySelectorAll('button')].map((b) => b.innerText.trim()) : [];
      return { hasNote: chips.includes('记事'), hasToday: chips.includes('今天'), hasTomorrow: chips.includes('明天'), text };
    });
    check('今天页新建窗口仍是原来的：有「记事」与「今天 / 明天」快捷项',
      todayBar.hasNote && todayBar.hasToday && todayBar.hasTomorrow, JSON.stringify(todayBar.text.slice(0, 80)));

    // ---------- 6. 编辑一条时间段任务：区间要能读回来、改完还能保存 ----------
    const detail = (await api(page, `/api/reminder/items/${rangeID}`)).body?.data;
    check('接口读回时间段（start_at / end_at）',
      !!detail?.start_at && !!detail?.end_at && detail.due_at === detail.start_at,
      JSON.stringify({ start: detail?.start_at, end: detail?.end_at, due: detail?.due_at }));
    // 把结束时间延后一小时再保存
    const movedEnd = new Date(rangeEnd.getTime() + 3600_000);
    const saved = await api(page, `/api/reminder/items/${rangeID}`, 'PUT', {
      ...detail, start_at: detail.start_at, end_at: iso(movedEnd),
    });
    const after = (await api(page, `/api/reminder/items/${rangeID}`)).body?.data;
    check('改结束时间能保存并读回',
      saved.status === 200 && new Date(after?.end_at).getHours() === movedEnd.getHours(),
      JSON.stringify({ status: saved.status, end: after?.end_at, msg: saved.body?.message }));
    // 结束早于开始必须被拒绝
    const bad = await api(page, `/api/reminder/items/${rangeID}`, 'PUT', {
      ...detail, start_at: detail.start_at, end_at: detail.start_at,
    });
    check('结束不晚于开始会被拒绝', bad.status !== 200 || bad.body?.code !== 0,
      JSON.stringify({ status: bad.status, msg: bad.body?.message }));

    // ---------- 清理 ----------
    for (const id of created) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    await sleep(600);
    const left = ((await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [])
      .filter?.((i) => String(i.title).includes(`-${STAMP}`)) || [];
    check('自检数据已清理', left.length === 0, String(left.length));
    console.log(`  截图：${path.join(SHOTS, 'planned-quick.png')}`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error('运行失败：', err); process.exit(1); });
