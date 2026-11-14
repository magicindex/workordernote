/**
 * 这一批（用户 2026-10-11 要求）：
 *
 *   1) **计划页周期**：天 / 周 / 月 / 年**都保留数量输入框**（原来只有「天」能调数量），
 *      下拉标签也跟着显示 N；「年终 / 自定义」不显示数量框（年终锚定 12-31，自定义自己挑结束）。
 *   2) **今天 / 计划页的「新建」按钮**：实线边框 + **流光**（.flow-frame 的旋转光带）。
 *   3) 新建提醒默认预填「今天当前时刻」（2026-11-11 起，不再写死 23:59）；
 *      逾期口径 = **当天到这个点才算过期**，再叠加「过期多久算逾期」的宽限分钟数。
 *   4) **周起始日搬到个人偏好，选项显示中文**（周一 / 周日，原来直接显示 monday/sunday）。
 *   5) **偏好设置里已删掉「清单顺序」**（用户 2026-10-16：与侧栏重复），侧栏那一套见 verify-121；
 *      同页的「默认清单」还在。
 *   6) **人生要有仪式感卡片**：倒计时放最上面、字号放大，卡片加高；卡面跟着所选过渡色变，
 *      浅色档自动配深字。倒计时**自 2026-10-28 改版**：纯色大数字 + 一层柔和落影，
 *      不再用「渐变字 + 彩色流光 + 双层黑白描边」那一套（所以这里的断言按现状写，
 *      紫罗兰档也只比「和默认卡不同」，不钉死调色板的 rgb）。
 *
 * 2026-11-12 顺手把第 6 组里 10 条**陈旧断言**按现在的设计改掉了（原来一直假红：
 * 期望 64px 图标 / 徽标 ≥11.5px / 渐变字 / 流光动画 / 双层描边 / 写死的 violet rgb）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-112.js
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

/** 默认展示页可能是首页看板：落在 /admin 时会自动跳走，再进一次就能停在待办。 */
async function gotoTodo(page) {
  await gotoRetry(page, BASE + '/admin');
  if (!/\/admin$/.test(new URL(page.url()).pathname)) await gotoRetry(page, BASE + '/admin');
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

const createdIds = [];
const cleanUp = (page) => Promise.all(createdIds.map((id) => api(page, `/api/reminder/items/${id}`, 'DELETE')));

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    // =============== 1. 计划页周期：所有按数量的档位都有输入框 ===============
    await gotoRetry(page, BASE + '/admin/planned');
    await sleep(2500);
    await openQuickAdd(page);
    await page.evaluate(() => document.querySelector('.quick-card input')?.focus());
    await sleep(400);
    const periods = await page.evaluate(async () => {
      const sel = document.querySelector('[data-plan-period]');
      const setNative = (el, v) => {
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const out = {};
      for (const v of ['days', 'week', 'month', 'year', 'yearend', 'custom']) {
        setNative(sel, v);
        await new Promise((r) => setTimeout(r, 300));
        out[v] = !!document.querySelector('[data-plan-days]');
      }
      return out;
    });
    check('周期：天 / 周 / 月 / 年 都有数量输入框（原来只有「天」有）',
      periods.days && periods.week && periods.month && periods.year, JSON.stringify(periods));
    check('「年终」「自定义」不显示数量输入框（年终锚定 12-31，自定义自己挑结束）',
      periods.yearend === false && periods.custom === false, JSON.stringify(periods));

    const ranges = await page.evaluate(async () => {
      const sel = document.querySelector('[data-plan-period]');
      const setNative = (el, v) => {
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const startBtn = [...document.querySelectorAll('.quick-card button')].find((b) => /选择开始时间|\d{4}年/.test(b.textContent));
      startBtn?.click();
      await new Promise((r) => setTimeout(r, 600));
      const cell = [...document.querySelectorAll('.day-cell')].find((c) => c.classList.contains('today')) || document.querySelector('.day-cell');
      cell?.click();
      await new Promise((r) => setTimeout(r, 700));
      const out = {};
      for (const v of ['days', 'week', 'month', 'year']) {
        setNative(sel, v);
        await new Promise((r) => setTimeout(r, 300));
        setNative(document.querySelector('[data-plan-days]'), '3');
        await new Promise((r) => setTimeout(r, 500));
        out[v] = {
          range: [...document.querySelectorAll('.quick-card span')].map((x) => x.textContent.trim()).find((x) => x.includes('–')) || '',
          opts: [...sel.options].map((o) => o.textContent.trim()),
        };
      }
      return out;
    });
    // 区间串形如「2026年10月11日 04:44 – 2026年10月13日 23:59」；– 右边同一天时只写时分。
    const parts = (s) => {
      const m = /(\d{4})年(\d{1,2})月(\d{1,2})日\s+\d{2}:\d{2}\s+–\s+(?:(\d{4})年)?(?:(\d{1,2})月(\d{1,2})日\s+)?\d{2}:\d{2}/.exec(s);
      return m ? { start: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
        end: new Date(Number(m[4] || m[1]), Number(m[5] || m[2]) - 1, Number(m[6] || m[3])) } : null;
    };
    const pDays = parts(ranges.days.range);
    const pWeeks = parts(ranges.week.range);
    const pMonths = parts(ranges.month.range);
    const pYears = parts(ranges.year.range);
    const plusDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const eq = (a, b) => !!a && !!b && a.getTime() === b.getTime();
    check('「3 天」的结束日 = 开始日 + 2 天',
      !!pDays && eq(pDays.end, plusDays(pDays.start, 2)), JSON.stringify(ranges.days));
    check('「3 周」的结束日 = 开始日 + 20 天（同一周基准）',
      !!pDays && !!pWeeks && eq(pWeeks.end, plusDays(pWeeks.start, 20)) && eq(pDays.start, pWeeks.start),
      JSON.stringify({ days: ranges.days.range, weeks: ranges.week.range }));
    check('「3 月」的结束日 = 开始日 + 3 个月 − 1 天',
      !!pMonths && eq(pMonths.end, new Date(pMonths.start.getFullYear(), pMonths.start.getMonth() + 3, pMonths.start.getDate() - 1)),
      JSON.stringify({ months: ranges.month.range }));
    check('「3 年」的结束日 = 开始日 + 3 年 − 1 天',
      !!pYears && eq(pYears.end, new Date(pYears.start.getFullYear() + 3, pYears.start.getMonth(), pYears.start.getDate() - 1)),
      JSON.stringify({ years: ranges.year.range }));

    // =============== 2. 新建按钮：实线边框 + 流光 ===============
    await gotoTodo(page);
    await sleep(2200);
    // 2026-11-11 起桌面待办页默认展开，按钮只在收起态出现：先点圆圈＋收起再量样式
    await page.evaluate(() => document.querySelector('[data-quick-collapse]')?.click());
    await sleep(500);
    const newBtn = await page.evaluate(() => {
      const el = document.querySelector('[data-quick-new]');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      return {
        borderStyle: cs.borderStyle, borderWidth: cs.borderWidth,
        flow: el.classList.contains('flow-frame'),
        ring: before.backgroundImage.slice(0, 20), anim: before.animationName,
        bg: cs.backgroundImage, color: cs.color,
      };
    });
    check('今天页「新建」按钮是**实线**边框（不是虚线）',
      !!newBtn && newBtn.borderStyle === 'solid' && newBtn.borderWidth !== '0px', JSON.stringify(newBtn));
    // 用户 2026-10-11 第二次明确：收缩态这个按钮**取消流光**（只保留蓝紫底色）；
    // 流光仍在展开后的新建卡片上（由 verify-105 第 2 组覆盖）。
    check('「新建」按钮**没有**流光（收缩态只要底色）',
      !!newBtn && newBtn.flow === false && newBtn.anim === 'none', JSON.stringify(newBtn));
    check('「新建」按钮是**蓝紫过渡色**（与左侧「新建提醒」同一套渐变）+ 白字',
      !!newBtn && /linear-gradient/.test(newBtn.bg) && /59, 130, 246/.test(newBtn.bg) && /99, 102, 241/.test(newBtn.bg)
        && /255, 255, 255/.test(newBtn.color),
      JSON.stringify(newBtn));

    // =============== 2b. 日期插件：点击标题快速选年月 ===============
    // 用户 2026-10-11：「新建卡片 日期栏目没有办法快速选择年月」→ 插件里点年月标题
    // 展开「年份下拉 + 12 个月」面板，选完直接跳过去。
    await openQuickAdd(page);
    await sleep(500);
    await page.evaluate(() => document.querySelector('[data-quick-date]')?.click());
    await sleep(800);
    const picker = await page.evaluate(async () => {
      const title = document.querySelector('[data-picker-title]');
      const openedBefore = !!document.querySelector('[data-picker-quick]');
      title?.click();
      await new Promise((r) => setTimeout(r, 400));
      const panel = document.querySelector('[data-picker-quick]');
      const sel = document.querySelector('[data-picker-year]');
      const months = [...document.querySelectorAll('[data-picker-month]')].map((b) => b.textContent.trim());
      return {
        hasTitle: !!title, openedBefore, open: !!panel,
        yearOptions: sel ? sel.options.length : 0,
        firstYear: sel ? sel.options[0].textContent.trim() : '',
        lastYear: sel ? sel.options[sel.options.length - 1].textContent.trim() : '',
        months,
      };
    });
    check('日期插件有可点的年月标题（默认不展开面板）',
      picker.hasTitle && picker.openedBefore === false, JSON.stringify(picker));
    check('点标题展开「快速选年月」面板：年份下拉 + 12 个月',
      picker.open === true && picker.yearOptions >= 50 && picker.months.length === 12,
      JSON.stringify(picker));
    const jumped = await page.evaluate(async () => {
      const sel = document.querySelector('[data-picker-year]');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, '1984');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      [...document.querySelectorAll('[data-picker-month]')].find((b) => b.textContent.trim() === '6 月')?.click();
      await new Promise((r) => setTimeout(r, 800));
      return {
        title: document.querySelector('[data-picker-title]')?.textContent.replace(/\s+/g, ' ').trim() || '',
        firstCell: document.querySelector('.day-cell')?.getAttribute('title') || '',
        closed: !document.querySelector('[data-picker-quick]'),
      };
    });
    check('选「1984 年 6 月」后日历跳过去、面板自动收起',
      /1984\s*年\s*6\s*月/.test(jumped.title) && jumped.firstCell.startsWith('1984-') && jumped.closed === true,
      JSON.stringify(jumped));
    // 收尾：把插件关掉（点日期插件外面的空白）
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);

    // =============== 3. 新建默认时间（今天当前时刻）+ 逾期口径 ===============
    // 用户 2026-11-11：「默认选择今天当前时间」（2026-10-13 的「芯片一律 23:59」仍适用于
    // 今天/明天/本周末这些芯片，只改默认值）。
    await openQuickAdd(page);
    await sleep(600);
    // 2026-11-12 起新建卡片上不再显示日期时间（芯片只写「选择日期」、默认由「今天」表达），
    // 默认到期时刻改成「真的存一条再看接口回来的 due_at」：今天 + 当前时刻（±10 分钟）。
    const defaultTitle = `自检默认时间-${STAMP}`;
    const defaultDue = await page.evaluate(async ({ title, base }) => {
      const card = document.querySelector('.quick-card');
      const input = card?.querySelector('input');
      if (!input) return { error: '找不到新建输入框' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      [...card.querySelectorAll('button')].find((b) => /^(添加提醒|添加)$/.test(b.textContent.trim()))?.click();
      await new Promise((r) => setTimeout(r, 1600));
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const json = await (await fetch(base + '/api/reminder/items?view=all&q=' + encodeURIComponent(title), {
        headers: { Authorization: 'Bearer ' + token },
      })).json();
      const item = (json?.data || []).find((x) => x.title === title);
      if (item) {
        await fetch(base + '/api/reminder/items/' + item.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      }
      // 待办页回来的是 due_at；如果此刻停在计划页，新建的是「开始/结束」→ 取 start_at
      return { due: item?.due_at || item?.start_at || null };
    }, { title: defaultTitle, base: BASE });
    const dt = defaultDue?.due ? new Date(defaultDue.due) : null;
    const sameDay = !!dt && dt.toDateString() === new Date().toDateString();
    const diffMin = dt ? Math.abs(dt.getTime() - Date.now()) / 60000 : 999;
    check('新建提醒默认今天当前时刻（不再是 23:59）',
      sameDay && diffMin <= 12, JSON.stringify({ due: defaultDue?.due, diffMin }));

    // 逾期口径：昨天 23:00 的 → 已逾期；今天 09:00 的 → **还没逾期**（要等今天 23:59 + 宽限）
    const mk = async (title, iso) => {
      const res = await api(page, '/api/reminder/items', 'POST', {
        title, kind: 'task', due_at: iso, repeat_rule: 'none', channels: ['inapp'],
      });
      const id = res.body?.data?.id;
      if (id) createdIds.push(id);
      return id;
    };
    const at = (dayOffset, h, m) => {
      const d = new Date();
      d.setDate(d.getDate() + dayOffset);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    // 夹具要跨过「当天过期时间 + 宽限」：前天 23:00 的截止时刻是**前天 23:59 + 30 分钟**，
    // 必定已过；今天 00:10 的截止时刻是**今天 23:59 + 30 分钟**，今天之内必定还没过。
    // （原来用「昨天 23:00」，在凌晨 00:00–00:29 跑时宽限还没走完 → 假红，2026-10-12 00:26 踩过。）
    await mk(`自检过期口径-前天-${STAMP}`, at(-2, 23, 0));
    await mk(`自检过期口径-今天-${STAMP}`, at(0, 0, 10));
    // 剩余 > 24 小时的对照项（用户 2026-10-20：只有不足 24 小时才转红）
    await mk(`自检剩余-远-${STAMP}`, at(3, 23, 59));
    await gotoTodo(page);
    await sleep(2500);
    const overdueView = await page.evaluate((ts) => {
      const rows = [...document.querySelectorAll('.reminder-row')];
      const find = (t) => rows.find((r) => r.textContent.includes(t));
      const y = find(`自检过期口径-前天-${ts}`);
      const t = find(`自检过期口径-今天-${ts}`);
      const f = find(`自检剩余-远-${ts}`);
      return {
        foundY: !!y, foundT: !!t,
        yOverdue: y ? y.classList.contains('reminder-overdue') : null,
        tOverdue: t ? t.classList.contains('reminder-overdue') : null,
        yRemaining: y?.querySelector('[data-item-remaining]')?.textContent?.trim() || '',
        tRemaining: t?.querySelector('[data-item-remaining]')?.textContent?.trim() || '',
        tColor: t?.querySelector('[data-item-remaining]') ? getComputedStyle(t.querySelector('[data-item-remaining]')).color : '',
        fColor: f?.querySelector('[data-item-remaining]') ? getComputedStyle(f.querySelector('[data-item-remaining]')).color : '',
        inOverdueCard: (t) => {
          const card = document.querySelector('[data-day-group="overdue"]');
          return card ? card.textContent.includes(t) : false;
        },
      };
    }, String(STAMP));
    check('前天 23:00 的任务算「已逾期」（截止时刻已过）',
      overdueView.foundY === true && overdueView.yOverdue === true, JSON.stringify(overdueView));
    check('今天 00:10 的任务**当天不算逾期**（要等当天的「过期时间」23:59 + 宽限）',
      overdueView.foundT === true && overdueView.tOverdue === false, JSON.stringify(overdueView));
    // 用户 2026-10-20：「已逾期项目后边增加已逾期多少时间；未逾期项目增加剩余到期时间」
    check('已逾期条目行尾写「已逾期 N 天 …」',
      /^已逾期 (\d+ 天 )?\d+ 小时 \d+ 分$/.test(overdueView.yRemaining), overdueView.yRemaining);
    check('未逾期条目行尾写「剩余 N 小时 …」',
      /^剩余 (\d+ 天 )?\d+ 小时 \d+ 分$/.test(overdueView.tRemaining), overdueView.tRemaining);
    check('剩余不足 24 小时：倒计时转红（rose-500）',
      overdueView.tColor === 'rgb(244, 63, 94)', overdueView.tColor);
    check('剩余超过 24 小时：倒计时不转红', overdueView.fColor !== 'rgb(244, 63, 94)', overdueView.fColor);

    // =============== 4. 周起始日改成个人偏好（中文选项） ===============
    await gotoRetry(page, BASE + '/admin/configs');
    await sleep(2200);
    const systemHasWeek = await page.evaluate(() => !!document.querySelector('[data-config-key="calendar_week_start"]'));
    check('系统配置里不再有「周起始日」（已搬到偏好设置）', systemHasWeek === false, String(systemHasWeek));

    await gotoRetry(page, BASE + '/admin/settings');
    await sleep(2600);
    const weekRow = await page.evaluate(() => {
      const row = document.querySelector('[data-config-key="calendar_week_start"]');
      if (!row) return null;
      return {
        options: [...row.querySelectorAll('option')].map((o) => o.textContent.trim()),
        value: row.querySelector('select')?.value || '',
      };
    });
    check('偏好设置里「周起始日」的选项是中文（周一 / 周日）',
      !!weekRow && weekRow.options.includes('周一') && weekRow.options.includes('周日')
        && !weekRow.options.some((t) => /monday|sunday/i.test(t)),
      JSON.stringify(weekRow));

    // =============== 5. 偏好设置里**不再**有「清单顺序」 ===============
    // 用户 2026-10-16：「前台可以调整 清单顺序，与后台偏好中 清单顺序 重复，删除后台清单顺序模块」。
    // 侧栏「我的清单」那一套（点标题旁的排序开关，含系统内置 4 个栏目）是唯一入口，由 verify-121 盯着。
    await gotoRetry(page, BASE + '/admin/settings');
    await sleep(2600);
    const orderGone = await page.evaluate(() => ({
      block: !!document.querySelector('[data-list-order]'),
      rows: document.querySelectorAll('[data-list-order-row]').length,
      defaultCard: !!document.querySelector('[aria-label="默认清单"]'),
    }));
    check('偏好设置里已删掉「清单顺序」模块（排序只留侧栏那一处）',
      orderGone.block === false && orderGone.rows === 0, JSON.stringify(orderGone));
    check('同一页的「默认清单」还在（只删了顺序那一块）', orderGone.defaultCard === true, JSON.stringify(orderGone));

    // =============== 6. 仪式感卡片：倒计时在上面、放大 ===============
    const ceremonyList = await page.evaluate(async (base) => {
      const t = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const lists = await (await fetch(base + '/api/reminder/lists', { headers: { Authorization: 'Bearer ' + t } })).json();
      return ((lists.data || []).find((l) => l.template === 'ceremony') || {}).id || null;
    }, BASE);
    if (!ceremonyList) {
      check('找得到「人生要有仪式感」栏目（这一组的前提）', false, '没有 ceremony 清单');
    } else {
      const target = new Date();
      target.setDate(target.getDate() + 40);
      const made = await api(page, '/api/reminder/items', 'POST', {
        title: `自检倒计时-${STAMP}`, kind: 'task', list_id: ceremonyList,
        due_at: target.toISOString(), repeat_rule: 'yearly', channels: ['inapp'],
      });
      const id = made.body?.data?.id;
      if (id) createdIds.push(id);
      await gotoRetry(page, BASE + `/admin/list/${ceremonyList}`);
      await sleep(2600);
      // 卡面过渡色（用户 2026-10-11）：色板里有多种颜色，选一个保存后卡片渐变跟着变，
      // 选「默认」则清掉。
      await page.evaluate(() => document.querySelector('[data-ceremony-add]')?.click());
      await sleep(700);
      const swatches = await page.evaluate(() => [...document.querySelectorAll('[data-ceremony-form-accent]')]
        .map((b) => ({ key: b.getAttribute('data-ceremony-form-accent'), bg: getComputedStyle(b).backgroundImage })));
      check('新建事项表单里有多种卡片过渡色可选（含「默认」与鎏金）',
        swatches.length >= 6 && swatches.filter((x) => /linear-gradient/.test(x.bg)).length >= 6
          && swatches.some((x) => x.key === 'default') && swatches.some((x) => x.key === 'violet')
          && swatches.some((x) => x.key === 'gold'),
        JSON.stringify(swatches.map((x) => x.key)));
      const accentTitle = `自检卡片色-${STAMP}`;
      await page.evaluate(async ({ t }) => {
        const input = document.querySelector('[data-ceremony-form-title]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, t);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
        document.querySelector('[data-ceremony-form-accent="violet"]')?.click();
        await new Promise((r) => setTimeout(r, 200));
        document.querySelector('[data-ceremony-form-save]')?.click();
      }, { t: accentTitle });
      await sleep(2400);
      const accented = await page.evaluate(async ({ b, t }) => {
        const tok = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
        const items = (await (await fetch(b + '/api/reminder/items?view=all&status=all', { headers: { Authorization: 'Bearer ' + tok } })).json()).data || [];
        const it = items.find((i) => i.title === t);
        const hero = [...document.querySelectorAll('[data-ceremony-countdown]')]
          .find((h) => (h.closest('[data-ceremony-card]')?.textContent || '').includes(t));
        // 同一页里找一张「没挑颜色」的卡片做对照：颜色跟不跟着 accent 变，比钉死 rgb 值稳
        // （调色板换过几次色值，旧断言就是死在写死了 #7c3aed 的 rgb 上）。
        const allCards = [...document.querySelectorAll('[data-ceremony-card]')];
        const other = allCards.find((c) => !(c.textContent || '').includes(t));
        return {
          id: it?.id, apiAccent: it?.accent,
          bgKey: hero ? hero.closest('[data-ceremony-card]')?.getAttribute('data-ceremony-bg') : '',
          otherBg: other ? getComputedStyle(other.querySelector('.ceremony-bg-fill') || other).backgroundImage : '',
          // 倒计时已经没有自己的底色块（2026-10-13 起直接压在卡面上）：
          // 看卡片的渐变，以及倒计时用的字色变量。
          cardBg: hero ? getComputedStyle(hero.closest('[data-ceremony-card]').querySelector('.ceremony-bg-fill') || hero.closest('[data-ceremony-card]')).backgroundImage : '',
          heroBg: hero ? getComputedStyle(hero).backgroundImage : '',
          heroInk: hero ? getComputedStyle(hero).getPropertyValue('--ceremony-ink').trim() : '',
        };
      }, { b: BASE, t: accentTitle });
      if (accented.id) createdIds.push(accented.id);
      check('色板里有金属四档（白银/黄金/青铜/黑铁）',
        ['silver', 'golden', 'bronze', 'iron'].every((k) => swatches.some((x) => x.key === k)),
        JSON.stringify(swatches.map((x) => x.key)));
      check('色板里有「浅色」档（浅天蓝/浅紫/浅玫/浅金/浅绿/浅青）',
        ['light-sky', 'light-violet', 'light-rose', 'light-amber', 'light-emerald', 'light-teal']
          .every((k) => swatches.some((x) => x.key === k)),
        JSON.stringify(swatches.map((x) => x.key)));
      // 卡面渐变由 cardStyle 现算（叠蒙板后具体 rgb 会变），所以只钉「确实是渐变 + 与默认档不同 + 白字」。
      check('选「紫罗兰」保存后：接口里 accent=violet、卡面换成紫罗兰的渐变（与默认浅色卡不同）',
        accented.apiAccent === 'violet' && accented.bgKey === 'violet'
          && /linear-gradient/.test(accented.cardBg) && !!accented.otherBg && accented.cardBg !== accented.otherBg
          // CSS 变量里存的是内联写的原值（#ffffff），不是计算后的 rgb()，两种写法都认
          && (/^#fff(fff)?$/i.test(accented.heroInk) || accented.heroInk === 'rgb(255, 255, 255)'),
        JSON.stringify(accented));
      // 再打开编辑：色板应选中 violet；改成「默认」保存 → accent 清空
      await page.evaluate((t) => {
        const card = [...document.querySelectorAll('[data-ceremony-card]')].find((c) => c.textContent.includes(t));
        card?.querySelector('[data-ceremony-edit]')?.click();
      }, accentTitle);
      await sleep(800);
      const editSelected = await page.evaluate(() => document.querySelector('[data-ceremony-form-accent].selected')?.getAttribute('data-ceremony-form-accent'));
      check('编辑时色板选中当前颜色（violet）', editSelected === 'violet', String(editSelected));
      await page.evaluate(async () => {
        document.querySelector('[data-ceremony-form-accent="default"]')?.click();
        await new Promise((r) => setTimeout(r, 200));
        document.querySelector('[data-ceremony-form-save]')?.click();
      });
      await sleep(2200);
      const accentCleared = await page.evaluate(async ({ b, id }) => {
        const tok = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
        const j = await (await fetch(`${b}/api/reminder/items/${id}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
        return String(j?.data?.accent ?? '');
      }, { b: BASE, id: accented.id });
      check('选回「默认」保存后 accent 被清空', accentCleared === '', accentCleared);

      const cardShadow = await page.evaluate(() => {
        const card = document.querySelector('[data-ceremony-card]');
        return card ? getComputedStyle(card).boxShadow : '';
      });
      check('卡片有投影（多层，不是 none）',
        !!cardShadow && cardShadow !== 'none' && cardShadow.split('rgb').length >= 3,
        cardShadow.slice(0, 120));

      // 浅色档：卡面是浅底，字必须自动变深（用户 2026-10-19：「倒计时卡片增加一些浅色的背景颜色」）。
      const lightTitle = `自检浅色-${STAMP}`;
      const lightCreated = await page.evaluate(async ({ b, t, list }) => {
        const tok = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
        const res = await fetch(b + '/api/reminder/items', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ list_id: list, title: t, due_date: '2026-12-31', due_time: '23:59', accent: 'light-sky', repeat: 'yearly', repeat_mode: 'date' }),
        });
        const j = await res.json().catch(() => null);
        return { status: res.status, id: j?.data?.id, accent: j?.data?.accent, message: j?.message };
      }, { b: BASE, t: lightTitle, list: ceremonyList });
      if (lightCreated.id) createdIds.push(lightCreated.id);

      await gotoRetry(page, BASE + `/admin/list/${ceremonyList}`);
      await sleep(2400);
      const lightCard = await page.evaluate(({ t }) => {
        const card = [...document.querySelectorAll('[data-ceremony-card]')].find((c) => c.textContent.includes(t));
        if (!card) return null;
        const color = getComputedStyle(card).color;
        const m = color.match(/\d+/g) || [];
        const dark = m.length >= 3 && Number(m[0]) + Number(m[1]) + Number(m[2]) < 420;
        return { color, dark };
      }, { t: lightTitle });
      check('浅色档卡片自动配深字（不是白字糊在浅底上）',
        !!lightCard && lightCard.dark && lightCreated.accent === 'light-sky',
        JSON.stringify({ created: lightCreated, card: lightCard }));

      // 默认档（没挑颜色）的卡面不再是纯白：浅色按 id 稳定随机，且倒计时块比卡面更浓
      const defaultCards = await page.evaluate(() => [...document.querySelectorAll('[data-ceremony-card]')]
        .map((c) => {
          const hero = c.querySelector('[data-ceremony-countdown]');
          return {
            t: (c.querySelector('[data-ceremony-title]')?.textContent || '').trim(),
            cardBg: getComputedStyle(c.querySelector('.ceremony-bg-fill') || c).backgroundImage,
            heroBg: hero ? getComputedStyle(hero).backgroundImage : '',
            heroInk: hero ? getComputedStyle(hero).color : '',
          };
        }));
      check('默认档卡面有背景色（不是纯白，浅色渐变）',
        defaultCards.length > 0 && defaultCards.every((c) => /linear-gradient/.test(c.cardBg)
          && !/rgba\(0, 0, 0, 0\)/.test(c.cardBg)),
        JSON.stringify(defaultCards.slice(0, 2)));
      check('浅色是「随机搭配」：多张默认卡不会全一个色',
        new Set(defaultCards.map((c) => c.cardBg)).size >= Math.min(2, defaultCards.length),
        JSON.stringify({ distinct: new Set(defaultCards.map((c) => c.cardBg)).size, total: defaultCards.length }));
      // 用户 2026-10-13：「倒计时不增加卡片效果，直接显示在大卡片中」
      check('倒计时没有自己的底色/圆角块了（背景透明，直接压在卡片上）',
        defaultCards.length > 0 && defaultCards.every((c) => !c.heroBg || c.heroBg === 'none' || /rgba\(0, 0, 0, 0\)/.test(c.heroBg)),
        JSON.stringify(defaultCards.slice(0, 2).map((c) => c.heroBg)));

      const card = await page.evaluate(() => {
        const c = document.querySelector('[data-ceremony-card]');
        if (!c) return null;
        const hero = c.querySelector('[data-ceremony-countdown]');
        const title = c.querySelector('[data-ceremony-title]');
        if (!hero || !title) return { missing: true };
        const r = (el) => el.getBoundingClientRect();
        return {
          cardH: Math.round(r(c).height),
          heroH: Math.round(r(hero).height),
          heroTop: Math.round(r(hero).top),
          titleTop: Math.round(r(title).top),
          heroFont: parseFloat(getComputedStyle(hero).fontSize),
          bigFont: hero.querySelector('b') ? parseFloat(getComputedStyle(hero.querySelector('b')).fontSize) : 0,
          heroText: (hero.textContent || '').trim(),
        };
      });
      check('仪式感卡片加高了（≥165px）', !!card && card.cardH >= 165, JSON.stringify(card));
      check('倒计时在标题**上方**（卡片最上面那块）',
        !!card && !card.missing && card.heroTop < card.titleTop, JSON.stringify(card));
      // 用户 2026-10-13：「倒计时和下面信息中间用横线隔开」
      const divider = await page.evaluate(() => {
        const c = document.querySelector('[data-ceremony-card]');
        if (!c) return null;
        const hero = c.querySelector('[data-ceremony-countdown]');
        const line = c.querySelector('[data-ceremony-divider]');
        const body = c.querySelector('.ceremony-body');
        if (!hero || !line || !body) return { missing: true };
        const style = getComputedStyle(line);
        const r = (el) => el.getBoundingClientRect();
        return {
          heroBottom: Math.round(r(hero).bottom),
          lineTop: Math.round(r(line).top),
          lineBottom: Math.round(r(line).bottom),
          bodyTop: Math.round(r(body).top),
          width: Math.round(r(line).width),
          cardWidth: Math.round(r(c).width),
          height: parseFloat(style.height),
          color: style.backgroundColor,
          // 横线要真的可见：不是 transparent、也不是整块实色
          alpha: Number((/rgba?\([^)]*?([0-9.]+)\)$/.exec(style.backgroundColor) || [])[1] ?? 1),
        };
      });
      check('倒计时与下方信息之间有横线（位置就在两者之间、横向铺满）',
        !!divider && !divider.missing
          && divider.lineTop >= divider.heroBottom - 1 && divider.lineBottom <= divider.bodyTop + 1
          && divider.width >= divider.cardWidth * 0.8,
        JSON.stringify(divider));
      check('横线可见且是半透明的（细线、不是一块色块）',
        !!divider && !divider.missing && divider.height > 0 && divider.width > 0
          && /rgba|rgb/.test(divider.color) && divider.alpha > 0.05 && divider.alpha < 0.7,
        JSON.stringify(divider));

      // 用户 2026-10-11 又说「倒计时还不够显眼，继续放大」：桌面 44px（手机 36px）
      // 用户 2026-10-13 又要求「同时增加 2 个字号」：桌面 44 → **52px**（手机 36 → 44px）
      check('倒计时再次放大（大数字 ≥44px，比正文大一截）',
        !!card && !card.missing && card.bigFont >= 44 && card.bigFont > card.heroFont,
        JSON.stringify(card));
      // 字色可读性（用户 2026-10-11：「浅色背景影响字体显示，字体是白色的，自动调整字体颜色」）：
      // 每张卡的标题/日期字色与倒计时字色，都要跟它自己的渐变底色有足够对比度。
      const contrast = await page.evaluate(() => {
        const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 };
        const lum = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb); return m ? 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]) : NaN };
        const cr = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05) };
        const stops = (el) => [...getComputedStyle(el).backgroundImage.matchAll(/rgb\([^)]+\)/g)].map((m) => m[0]);
        return [...document.querySelectorAll('[data-ceremony-card]')].map((c) => {
          const hero = c.querySelector('[data-ceremony-countdown]');
          const title = c.querySelector('[data-ceremony-title]');
          const cardStops = stops(c);
          // 带背景图的卡片：真正垫在字下面的是「图片 + 可调蒙板」，不是卡面渐变 ——
          // 拿渐变去算对比度没有意义（2026-10-13 加蒙板后，这类卡片交给 verify-115 管）。
          const hasImage = !!c.querySelector('.ceremony-bg-img');
          // 倒计时数字现在是「渐变字 + 透明色」（流光），量不到 color：
          // 用 --ceremony-ink（就是它原来的字色）跟**卡面**渐变比 —— 倒计时直接压在卡面上。
          const heroInk = hero ? getComputedStyle(hero).getPropertyValue('--ceremony-ink').trim() : '';
          const titleInk = getComputedStyle(title).color;
          return {
            accent: c.getAttribute('data-ceremony-bg'),
            hero: cardStops.length && heroInk ? Number(Math.min(...cardStops.map((x) => cr(heroInk, x))).toFixed(2)) : null,
            title: cardStops.length && !hasImage ? Number(Math.min(...cardStops.map((x) => cr(titleInk, x))).toFixed(2)) : null,
            hasImage,
            heroInk,
            titleInk,
          };
        });
      });
      check('每张卡的倒计时字色与卡面渐变对比度足够（≥3.5，浅底自动配深字；带背景图的卡片走 verify-115）',
        contrast.length > 0 && contrast.every((c) => c.hero === null || c.hero >= 3.5),
        JSON.stringify(contrast.map((c) => [c.accent, c.hero, c.heroInk])));

      // 倒计时改版（2026-10-28，CSS 里写着「不再用描边 + 流光动画，改成大号、克制的数字」）：
      // 现在的设计是**纯色大数字 + 一层柔和落影**。下面按现状钉住，别再按旧版的
      // 「渐变字 + 彩色流光 + 双层黑白描边」断言（那几条会一直假红）。
      const heroNumber = await page.evaluate(() => {
        const b = document.querySelector('[data-ceremony-countdown] b[data-count]')
          || document.querySelector('[data-ceremony-countdown] b');
        if (!b) return null;
        const s = getComputedStyle(b);
        const before = getComputedStyle(b, '::before');
        return {
          bg: s.backgroundImage,
          clip: s.webkitBackgroundClip || s.backgroundClip,
          fill: s.webkitTextFillColor || s.color,
          color: s.color,
          anim: s.animationName,
          stroke: s.getPropertyValue('-webkit-text-stroke-width') || s.webkitTextStrokeWidth || '',
          shadow: s.textShadow,
          beforeContent: before.content,
          beforeStroke: before.getPropertyValue('-webkit-text-stroke-width') || '',
        };
      });
      check('倒计时是纯色大数字（不再用渐变字裁在文字里）',
        !!heroNumber && heroNumber.bg === 'none' && heroNumber.clip !== 'text',
        JSON.stringify(heroNumber));
      check('数字没有跑动动画（流光已撤，字是静的）',
        !!heroNumber && heroNumber.anim === 'none', JSON.stringify(heroNumber));
      check('数字有一层柔和落影（层次来自阴影，而不是描边）',
        !!heroNumber && !!heroNumber.shadow && heroNumber.shadow !== 'none', JSON.stringify(heroNumber));
      check('数字没有描边、也没有 ::before 复制层（旧版的双层描边已删）',
        !!heroNumber && parseFloat(heroNumber.stroke || '0') === 0
          && (heroNumber.beforeContent === 'none' || heroNumber.beforeContent === '')
          && parseFloat(heroNumber.beforeStroke || '0') === 0,
        JSON.stringify(heroNumber));
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      const reduced = await page.evaluate(() => {
        const b = document.querySelector('[data-ceremony-countdown] b');
        return b ? getComputedStyle(b).animationName : null;
      });
      check('「减少动态效果」下同样没有动画（现在的数字本来就是静态）', reduced === 'none', String(reduced));
      await page.emulateMediaFeatures([]);
      check('每张卡的标题字色与卡面底色对比度足够（≥4.5，浅色卡面不会被白字糊住）',
        contrast.length > 0 && contrast.every((c) => c.title === null || c.title >= 4.5),
        JSON.stringify(contrast.map((c) => [c.accent, c.title, c.titleInk])));

      // 排序（用户 2026-10-11：「倒计时最短的在最前边，以此类推」）
      //   —— 未到的按天数从小到大，已过的全部排到最后（过得少的在前）。
      const ordering = await page.evaluate(() => [...document.querySelectorAll('[data-ceremony-card]')]
        .map((c) => Number(c.getAttribute('data-ceremony-days'))));
      const upcoming = ordering.filter((d) => d >= 0);
      const passed = ordering.filter((d) => d < 0);
      check('卡片按倒计时排序：未到的从小到大、已过的全部排在最后',
        ordering.length > 0
          && JSON.stringify(upcoming) === JSON.stringify([...upcoming].sort((a, b) => a - b))
          && (passed.length === 0
            || ordering.lastIndexOf(upcoming[upcoming.length - 1]) < ordering.indexOf(passed[0])),
        JSON.stringify(ordering));

      // 用户 2026-10-12：「卡片内容：名称，时间，循环，次数 等所有内容均放大；图标放内容左侧放大2倍」
      const layout = await page.evaluate(() => {
        const c = document.querySelector('[data-ceremony-card]');
        const hero = c?.querySelector('[data-ceremony-countdown]');
        const body = c?.querySelector('.ceremony-body');
        const title = c?.querySelector('[data-ceremony-title]');
        const date = c?.querySelector('.ceremony-date');
        const badge = date?.querySelector('.tiny-badge') || c?.querySelector('[data-ceremony-cycle]');
        const icon = c?.querySelector('.ceremony-icon');
        const iconSvg = icon?.querySelector('svg');
        if (!c || !hero || !body || !title || !date || !icon) return null;
        const r = (el) => el.getBoundingClientRect();
        const mid = (el) => { const b = r(el); return Math.round((b.left + b.right) / 2); };
        const cr = r(c);
        return {
          cardMid: Math.round(cr.left + cr.width / 2),
          heroMid: mid(hero), bodyMid: mid(body),
          iconRight: Math.round(r(icon).right), titleLeft: Math.round(r(title).left),
          iconBox: `${Math.round(r(icon).width)}x${Math.round(r(icon).height)}`,
          iconSvg: Math.round(r(iconSvg).width),
          titleFont: parseFloat(getComputedStyle(title).fontSize),
          dateFont: parseFloat(getComputedStyle(date).fontSize),
          badgeFont: badge ? parseFloat(getComputedStyle(badge).fontSize) : 0,
        };
      });
      check('倒计时**居中**在卡片中线上', !!layout && Math.abs(layout.heroMid - layout.cardMid) <= 2, JSON.stringify(layout));
      check('图标在内容**左侧**、整组（图标 + 文字）居中',
        !!layout && layout.iconRight <= layout.titleLeft + 1 && Math.abs(layout.bodyMid - layout.cardMid) <= 2,
        JSON.stringify(layout));
      // 2026-10-28 起图标只显示图形、不带方框，底盘 112px（h-28）、图形 88px。
      check('图标放大到约 2 倍（88px 图标 / 112px 底盘，原来 22px / 36px）',
        !!layout && layout.iconSvg >= 80 && /112x112/.test(layout.iconBox), JSON.stringify(layout));
      // 名称 20px / 时间 13px / 徽标 11px（.ceremony-title、.ceremony-date、卡面 .tiny-badge）
      check('名称 / 时间 / 循环次数徽标都放大（≥20 / ≥13 / ≥11px）',
        !!layout && layout.titleFont >= 20 && layout.dateFont >= 13 && (layout.badgeFont === 0 || layout.badgeFont >= 11),
        JSON.stringify(layout));
    }

    // =============== 清理 ===============
    await cleanUp(page);
    await sleep(800);
    const left = ((await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [])
      .filter((i) => String(i.title).includes(`-${STAMP}`));
    check('自检数据已清理', left.length === 0, JSON.stringify(left.map((i) => i.title)));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
