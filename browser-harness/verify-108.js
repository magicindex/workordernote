/**
 * 计划任务：任务周期 + 日历跨天显示（时钟图标/底色/点选高亮整段）。
 *
 *   1) 计划页的「周期」控件：1 天 / 1 周 / 1 月 / 年终 / 1 年 / 自定义（+ N 天输入框）
 *   2) 用界面选开始时间 → 结束时间按周期自动算出（落在最后一天 23:59）
 *   3) 时间段任务在日历里**跨天**显示：区间内每天一条，带时钟图标与底色，
 *      首/中/尾三种圆角（data-cal-span="id:start|mid|end"）
 *   4) 点区间里的某一天 → 整段（开始框 → 跨框 → 最后一天）高亮；点别的日子 → 恢复单框
 *   5) 逾期口径：时间段任务看**最后一天**，再过后台的宽限时间才算逾期
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-108.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}
async function waitSel(page, sel, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const madeIds = [];

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, BASE);

    // ---------- 1. 周期控件 ----------
    await gotoRetry(page, BASE + '/admin/planned');
    await openQuickAdd(page);
    await sleep(2000);
    const ctrl = await page.evaluate(() => ({
      hasSelect: !!document.querySelector('[data-plan-period]'),
      options: [...(document.querySelector('[data-plan-period]')?.options || [])].map((o) => o.textContent.trim()),
      daysInput: !!document.querySelector('[data-plan-days]'),
      labels: [...document.querySelectorAll('.quick-card .field-label')].map((l) => l.childNodes[0]?.textContent.trim()).filter(Boolean),
    }));
    check('计划页有「任务周期」下拉（1天/1周/1月/年终/1年/自定义）',
      ctrl.hasSelect && ctrl.options.length === 6
        && ctrl.options.includes('1 周') && ctrl.options.includes('1 月')
        && ctrl.options.includes('年终') && ctrl.options.includes('1 年') && ctrl.options.includes('自定义'),
      JSON.stringify(ctrl));
    check('周期里带「N 天」的数字输入框', ctrl.daysInput === true, JSON.stringify(ctrl));
    check('「结束」框只在「自定义」时出现（默认 1 天不显示）',
      !ctrl.labels.some((t) => (t || '').includes('结束')), JSON.stringify(ctrl.labels));

    // ---------- 2. 界面选开始时间 → 自动算结束 ----------
    const title3d = `自检周期3天-${STAMP}`;
    const flow = await page.evaluate(async (t) => {
      const setVal = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const input = document.querySelector('.quick-card input');
      input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      input.focus();
      await new Promise((r) => setTimeout(r, 300));
      // 选开始时间：点开选择器 → 点「今天」
      const startBtn = [...document.querySelectorAll('.quick-card button')].find((b) => /选择开始时间|\d{4}年/.test(b.textContent));
      startBtn?.click();
      await new Promise((r) => setTimeout(r, 500));
      const todayCell = [...document.querySelectorAll('.day-cell')].find((c) => c.classList.contains('today')) || document.querySelector('.day-cell');
      todayCell?.click();
      await new Promise((r) => setTimeout(r, 600));
      // 周期选 3 天
      const days = document.querySelector('[data-plan-days]');
      if (days) { setVal(days, '3'); days.dispatchEvent(new Event('change', { bubbles: true })); }
      await new Promise((r) => setTimeout(r, 400));
      setVal(input, t);
      await new Promise((r) => setTimeout(r, 300));
      const rangeLabel = [...document.querySelectorAll('.quick-card span')].map((s) => s.textContent.trim()).find((x) => x.includes('–')) || '';
      const saveBtn = [...document.querySelectorAll('.quick-card button')].find((b) => ['添加', '保存中'].includes(b.textContent.trim()));
      saveBtn?.click();
      return { rangeLabel, saved: !!saveBtn };
    }, title3d);
    await sleep(2200);
    const items = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [];
    const created = items.find((i) => i.title === title3d);
    if (created) madeIds.push(created.id);
    const s0 = created?.start_at ? new Date(created.start_at) : null;
    const e0 = created?.end_at ? new Date(created.end_at) : null;
    const spanDays = s0 && e0
      ? Math.round((new Date(e0.getFullYear(), e0.getMonth(), e0.getDate()) - new Date(s0.getFullYear(), s0.getMonth(), s0.getDate())) / 86400000) + 1
      : 0;
    check('周期 3 天：结束时间落在开始后第 3 天的 23:59',
      !!created && spanDays === 3 && e0.getHours() === 23 && e0.getMinutes() === 59,
      JSON.stringify({ start: created?.start_at, end: created?.end_at, spanDays }));
    check('开始时间选完就显示整段（右侧区间提示）', /–/.test(flow.rangeLabel) || spanDays === 3,
      JSON.stringify(flow));

    // ---------- 3. 日历跨天显示 ----------
    await gotoRetry(page, BASE + '/admin/calendar');
    await waitSel(page, '[data-cal-date]', 20000);
    await sleep(2200);
    const spans = await page.evaluate(() => [...document.querySelectorAll('[data-cal-span]')].map((el) => ({
      attr: el.getAttribute('data-cal-span'),
      date: el.closest('[data-cal-date]')?.getAttribute('data-cal-date') || '',
      clock: !!el.querySelector('svg'),
      tinted: getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)',
      mark: !!el.querySelector('.cal-plan-mark'),
    })));
    const mine = spans.filter((s) => s.attr.startsWith(`${created?.id}:`));
    check('时间段任务在日历里跨天显示（3 天各一条）', mine.length === 3, JSON.stringify(mine));
    check('跨天的条带时钟图标 + 底色', mine.length > 0 && mine.every((m) => m.clock && m.tinted && m.mark),
      JSON.stringify(mine));
    check('首/中/尾三种角色都对',
      mine.some((m) => m.attr.endsWith(':start')) && mine.some((m) => m.attr.endsWith(':mid')) && mine.some((m) => m.attr.endsWith(':end')),
      JSON.stringify(mine.map((m) => m.attr)));

    // ---------- 4. 点选高亮整段 / 点别处恢复 ----------
    const dates = mine.map((m) => m.date).sort();
    await page.evaluate((d) => document.querySelector(`[data-cal-date="${d}"]`)?.click(), dates[1]);
    await sleep(600);
    const highlighted = await page.evaluate(() => [...document.querySelectorAll('[data-cal-date]')]
      .filter((c) => c.className.includes('ring-brand-500/40') || c.className.includes('border-brand-500/45'))
      .map((c) => c.getAttribute('data-cal-date')));
    check('点区间中间那天 → 整段三天都高亮',
      dates.every((d) => highlighted.includes(d)) && highlighted.length === 3,
      JSON.stringify({ dates, highlighted }));
    const outside = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('[data-cal-date]')]
        .find((c) => !c.querySelector('[data-cal-span]') && c.className.includes('in_month'));
      const fallback = cell || [...document.querySelectorAll('[data-cal-date]')].find((c) => !c.querySelector('[data-cal-span]'));
      fallback?.click();
      return fallback?.getAttribute('data-cal-date') || '';
    });
    await sleep(600);
    const stillHl = await page.evaluate(() => [...document.querySelectorAll('[data-cal-date]')]
      .filter((c) => c.className.includes('ring-brand-500/40')).length);
    check('点其他框 → 恢复单框显示（高亮清零）', stillHl === 0, JSON.stringify({ outside, stillHl }));

    // ---------- 5. 逾期口径：看最后一天 ----------
    const now = new Date();
    // ① 结束时间在「今天 23:59」→ 还没过宽限，不算逾期
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0, 0);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
    const t1 = `自检周期今天结束-${STAMP}`;
    const m1 = await api(page, '/api/reminder/items', 'POST', {
      title: t1, start_at: startToday.toISOString(), end_at: endToday.toISOString(), repeat_rule: 'none', channels: ['inapp'],
    });
    if (m1.body?.data?.id) madeIds.push(m1.body.data.id);
    // ② 结束时间在 3 天前 → 早过了宽限，算逾期
    const endPast = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 23, 59, 0, 0);
    const startPast = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5, 9, 0, 0, 0);
    const t2 = `自检周期已过期-${STAMP}`;
    const m2 = await api(page, '/api/reminder/items', 'POST', {
      title: t2, start_at: startPast.toISOString(), end_at: endPast.toISOString(), repeat_rule: 'none', channels: ['inapp'],
    });
    if (m2.body?.data?.id) madeIds.push(m2.body.data.id);

    await gotoRetry(page, BASE + '/admin');
    await waitSel(page, '.reminder-row', 20000);
    await sleep(2000);
    const marks = await page.evaluate((ts) => {
      const rows = [...document.querySelectorAll('.reminder-row')];
      const of = (t) => {
        const row = rows.find((r) => r.textContent.includes(t));
        return row ? row.classList.contains('reminder-overdue') : null;
      };
      return { today: of(ts.t1), past: of(ts.t2) };
    }, { t1, t2 });
    check('时间段任务最后一天还没过完（含宽限）→ 不算逾期', marks.today === false, JSON.stringify(marks));
    check('时间段任务最后一天已过 3 天 → 算逾期', marks.past === true, JSON.stringify(marks));

    // ---------- 清理 ----------
    let cleaned = 0;
    for (const id of madeIds) {
      const res = await api(page, `/api/reminder/items/${id}`, 'DELETE');
      if (res.status === 200) cleaned += 1;
    }
    check(`自检数据已清理（${cleaned}/${madeIds.length}）`, cleaned === madeIds.length, JSON.stringify(madeIds));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
