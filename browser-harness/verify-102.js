/**
 * 列表页按月与日历细节（这批）：
 *   1) 全部页按月翻页：每页只显示当月，底部左右切换，只在有数据的月份之间可翻
 *   2) 已完成页默认「本月」
 *   3) 计划页「全部」包含本月已完成、不含上月完成
 *   4) 日历经格子超过上限收进「+N 条…」下拉
 *   5) 日历里信用卡标记有底色（参考「记」字标记）
 *   6) 导出仍然是所有数据（不受页面按月影响）
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-102.js
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 导出是 CSV */ }
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

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const created = [];
    const iso = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      const off = -d.getTimezoneOffset();
      const s = off >= 0 ? '+' : '-';
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${s}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
    };
    const now = new Date();
    const thisMonthDay = new Date(now.getFullYear(), now.getMonth(), 15, 10, 0, 0, 0);
    const nextMonthDay = new Date(now.getFullYear(), now.getMonth() + 1, 15, 10, 0, 0, 0);
    const lastMonthDay = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10, 0, 0, 0);
    const crowdedDay = new Date(now.getFullYear(), now.getMonth(), 20, 9, 0, 0, 0);
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const nextKey = `${nextMonthDay.getFullYear()}-${String(nextMonthDay.getMonth() + 1).padStart(2, '0')}`;
    const prevKey = `${lastMonthDay.getFullYear()}-${String(lastMonthDay.getMonth() + 1).padStart(2, '0')}`;

    const seed = async (title, body) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await api(page, '/api/reminder/items', 'POST', body);
        const id = res.body?.data?.id;
        if (id) { created.push(id); return id; }
        await sleep(6000);   // 多半是登录限流（20 次/分钟），退避后重试
      }
      return null;
    };
    const seeded = [];
    const seedChecked = async (title, body) => {
      const id = await seed(title, body);
      seeded.push(!!id);
      return id;
    };
    await seedChecked(`自检本月-${STAMP}`, { title: `自检本月-${STAMP}`, due_at: iso(thisMonthDay), repeat_rule: 'none', channels: ['inapp'] });
    await seedChecked(`自检下月-${STAMP}`, { title: `自检下月-${STAMP}`, due_at: iso(nextMonthDay), repeat_rule: 'none', channels: ['inapp'] });
    // 上个月完成的**循环**任务（计划页「全部」不该出现）
    const lastDone = await seedChecked(`自检上月完成-${STAMP}`, { title: `自检上月完成-${STAMP}`, due_at: iso(lastMonthDay), repeat_rule: 'daily', channels: ['inapp'] });
    // 本月完成的循环任务
    const thisDone = await seedChecked(`自检本月完成-${STAMP}`, { title: `自检本月完成-${STAMP}`, due_at: iso(new Date(now.getFullYear(), now.getMonth(), 2, 9, 0, 0, 0)), repeat_rule: 'daily', channels: ['inapp'] });
    for (const id of [lastDone, thisDone]) {
      if (id) await api(page, `/api/reminder/items/${id}/complete`, 'POST');
    }
    // 同日 5 条，逼出「+N 条…」下拉
    for (let i = 0; i < 6; i += 1) {
      await seedChecked(`自检挤${i}-${STAMP}`, { title: `自检挤${i}-${STAMP}`, due_at: iso(crowdedDay), repeat_rule: 'none', channels: ['inapp'] });
    }
    check('自检数据都已建号（没有被限流吞掉）', seeded.every(Boolean), String(seeded.filter(Boolean).length) + '/' + seeded.length);

    // ---------- 1. 全部页按月 ----------
    await page.setViewport({ width: 1280, height: 900 });
    await gotoRetry(page, BASE + '/admin/all');
    await waitSel(page, '[data-month-nav]', 20000);
    await sleep(1500);
    const monthInit = await page.evaluate(() => ({
      label: document.querySelector('[data-month-label]')?.innerText.trim() || '',
      prevDisabled: document.querySelector('[data-month-prev]')?.disabled ?? null,
      nextDisabled: document.querySelector('[data-month-next]')?.disabled ?? null,
      // textContent：.reminder-row 带 content-visibility:auto，屏外的行 innerText 是空串
      rows: [...document.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
    }));
    check('全部页底部有月份切换', !!monthInit.label, JSON.stringify(monthInit).slice(0, 80));
    const thisMonthShown = monthInit.rows.some((t) => t.includes(`自检本月-${STAMP}`));
    const nextMonthShown = monthInit.rows.some((t) => t.includes(`自检下月-${STAMP}`));
    check('当月页只显示当月条目（下月的不出现）', thisMonthShown && !nextMonthShown,
      JSON.stringify(monthInit.rows));
    check('默认停在当月', monthInit.label.includes(monthKey.slice(0, 4)), monthInit.label);

    // 翻到下个月：显示下月那条、本月那条消失
    await page.evaluate(() => document.querySelector('[data-month-next]')?.click());
    await sleep(1800);
    const nextView = await page.evaluate(() => ({
      label: document.querySelector('[data-month-label]')?.innerText.trim() || '',
      // textContent：.reminder-row 带 content-visibility:auto，屏外的行 innerText 是空串
      rows: [...document.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
      nextDisabled: document.querySelector('[data-month-next]')?.disabled ?? null,
    }));
    check('翻到下个月后只显示下月条目',
      nextView.rows.some((t) => t.includes(`自检下月-${STAMP}`))
      && !nextView.rows.some((t) => t.includes(`自检本月-${STAMP}`)),
      JSON.stringify(nextView.rows));
    // 「下个月」到哪一天置灰，取决于**有数据的最后一个月** —— 不能假设只有自检那三条：
    // 生产上有 2027 年的银行账单/节日条目（2026-10-11 实测这条断言在生产上也假红过）。
    // 所以先按 /items/months 的 last 算期望，再真的往后点到边界上验一次。
    const monthsRange = (await api(page, '/api/reminder/items/months')).body?.data || {};
    const lastMonthKey = String(monthsRange.last || '');
    const firstMonthKey = String(monthsRange.first || '');
    check('「下个月」的置灰状态与「有数据的最后一个月」一致',
      lastMonthKey ? nextView.nextDisabled === (nextKey === lastMonthKey) : nextView.nextDisabled === true,
      JSON.stringify({ nextKey, lastMonthKey, disabled: nextView.nextDisabled }));
    let atLast = nextView.label.includes(lastMonthKey.slice(0, 4)) && nextView.nextDisabled === true;
    for (let i = 0; i < 30 && lastMonthKey && !atLast; i += 1) {
      await page.evaluate(() => document.querySelector('[data-month-next]')?.click());
      await sleep(900);
      const st = await page.evaluate(() => ({
        key: document.querySelector('[data-month-label]')?.innerText.trim() || '',
        disabled: document.querySelector('[data-month-next]')?.disabled ?? null,
      }));
      if (st.disabled === true) {
        atLast = /^(\d{4}) 年 (\d{1,2}) 月$/.test(st.key.replace(/\s+/g, ' ').trim())
          && st.key.includes(`${Number(lastMonthKey.slice(5))} 月`);
      }
    }
    check('一路「下个月」翻到最后一个有数据的月份时置灰（不再假设只有自检数据）',
      !lastMonthKey || atLast === true, JSON.stringify({ lastMonthKey, atLast }));
    await page.screenshot({ path: path.join(SHOTS, 'list-month-nav.png') });

    // 先回到本月（上面那段「一路点到最后一个有数据的月份」会把光标留在别的月份），
    // 再往左一步到上个月看箭头边界。按标签回退而不是写死点几次，月份范围变了也不会错位。
    for (let i = 0; i < 40; i += 1) {
      const label = await page.evaluate(() => document.querySelector('[data-month-label]')?.innerText.trim() || '');
      if (label.includes(monthKey.slice(0, 4)) && label.includes(`${Number(monthKey.slice(5))} 月`)) break;
      await page.evaluate(() => document.querySelector('[data-month-prev]')?.click());
      await sleep(900);
    }
    await page.evaluate(() => document.querySelector('[data-month-prev]')?.click());
    await sleep(1500);
    const prevView = await page.evaluate(() => ({
      label: document.querySelector('[data-month-label]')?.innerText.trim() || '',
      prevDisabled: document.querySelector('[data-month-prev]')?.disabled ?? null,
      // textContent：.reminder-row 带 content-visibility:auto，屏外的行 innerText 是空串
      rows: [...document.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
    }));
    check('能翻到有数据的最早月份（上个月）并显示上月条目',
      prevView.rows.some((t) => t.includes(`自检上月完成-${STAMP}`)), JSON.stringify(prevView.rows).slice(0, 120));
    check('「上个月」的置灰状态与「有数据的最早一个月」一致',
      firstMonthKey ? prevView.prevDisabled === (prevKey === firstMonthKey) : prevView.prevDisabled === true,
      JSON.stringify({ prevKey, firstMonthKey, disabled: prevView.prevDisabled }));
    void monthKey; void nextKey; void prevKey;

    // ---------- 2. 已完成页默认本月 ----------
    await gotoRetry(page, BASE + '/admin/completed');
    await waitSel(page, '.quick-chip', 20000);
    await sleep(1500);
    const completedDefault = await page.evaluate(() => {
      const active = [...document.querySelectorAll('.quick-chip')].filter((b) => b.className.includes('active')).map((b) => b.innerText.trim());
      return { active, span: document.body.innerText.match(/当前区间[^\n]*/)?.[0] || '' };
    });
    check('已完成页默认选中「本月」', completedDefault.active.includes('本月'),
      JSON.stringify(completedDefault));

    // ---------- 3. 计划页「全部」包含本月已完成 ----------
    await gotoRetry(page, BASE + '/admin/planned');
    await waitSel(page, '.reminder-row', 20000);
    await sleep(1200);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.seg-btn')].find((b) => b.innerText.trim() === '全部');
      btn?.click();
    });
    await sleep(1800);
    const plannedAll = await page.evaluate(() => [...document.querySelectorAll('.reminder-row')].map((r) => r.innerText.replace(/\s+/g, ' ')));
    check('计划页「全部」含本月已完成的预设',
      plannedAll.some((t) => t.includes(`自检本月完成-${STAMP}`)), JSON.stringify(plannedAll).slice(0, 160));
    // 「上月已完成的不出现」这条依赖把 completed_at 改到上个月，浏览器接口做不到，
    // 由 Go 用例 TestMonthScopedViews 覆盖。

    // ---------- 4/5. 日历：+N 下拉 与 信用卡标记底色 ----------
    await gotoRetry(page, BASE + '/admin/calendar');
    await waitSel(page, '[data-cal-date]', 20000);
    await sleep(1800);
    // 认准「我塞满的那一天」：页面上可能还有别的日子也有溢出（+1 条…），
    // 用 first-match 会量到别人身上（上一次就是这么假红的）。
    const crowdedKey = `${crowdedDay.getFullYear()}-${String(crowdedDay.getMonth() + 1).padStart(2, '0')}-${String(crowdedDay.getDate()).padStart(2, '0')}`;
    const more = await page.evaluate((key) => {
      const cell = document.querySelector(`[data-cal-date="${key}"]`);
      const btn = cell?.querySelector('[data-cal-more]');
      return {
        exists: !!btn,
        text: btn?.innerText.trim() || '',
        chips: cell ? cell.querySelectorAll('.cal-task').length : 0,
      };
    }, crowdedKey);
    check('日历里超过上限的条目收进「+N 条…」', more.exists, JSON.stringify(more));
    let overflowCount = 0;
    if (more.exists) {
      await page.evaluate((key) => document.querySelector(`[data-cal-date="${key}"] [data-cal-more]`)?.click(), crowdedKey);
      await sleep(700);
      overflowCount = await page.evaluate((key) =>
        document.querySelectorAll(`[data-cal-date="${key}"] [data-cal-overflow] button`).length, crowdedKey);
      check(`点「+N 条…」会弹出下拉并列出被折叠的条目（${crowdedKey}）`,
        overflowCount >= 2, `下拉里 ${overflowCount} 条`);
      await page.screenshot({ path: path.join(SHOTS, 'calendar-overflow.png') });
    }
    const cardMark = await page.evaluate(() => {
      const mark = document.querySelector('.cal-card-mark');
      if (!mark) return null;
      const cs = getComputedStyle(mark);
      const r = mark.getBoundingClientRect();
      return { bg: cs.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), hasIcon: !!mark.querySelector('svg') };
    });
    check('日历里信用卡标记带底色（参考「记」字标记）',
      !!cardMark && cardMark.hasIcon && !/rgba\(0, 0, 0, 0\)/.test(cardMark.bg),
      JSON.stringify(cardMark));

    // ---------- 6. 导出仍然是所有数据 ----------
    const csv = await api(page, '/api/reminder/export?scope=active&view=all');
    const text = csv.text || '';
    check('导出的 CSV 含下个月的条目（导出不受页面按月限制）',
      csv.status === 200 && text.includes(`自检下月-${STAMP}`),
      `status=${csv.status} 含下月=${text.includes(`自检下月-${STAMP}`)}`);
    check('导出的 CSV 也含上个月的条目',
      text.includes(`自检上月完成-${STAMP}`), String(text.length));

    // ---------- 清理 ----------
    // 先「恢复」被标记完成的条目：直接删提醒会留下自检完成记录（历史表只增不减）
    for (const id of [lastDone, thisDone]) {
      if (id) await api(page, `/api/reminder/items/${id}/restore`, 'POST');
    }
    for (const id of created) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    await sleep(700);
    const left = ((await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [])
      .filter?.((i) => String(i.title).includes(`-${STAMP}`)) || [];
    check('自检数据已清理', left.length === 0, String(left.length));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error('运行失败：', err); process.exit(1); });
