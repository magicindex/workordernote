/**
 * 新建卡片的日期控件（用户 2026-11-12 截图）：
 *   「默认选择今天，本周末后边日期不应该被选择，同时选中今天和时间，容易出现冲突，
 *     这个时间控件删除不保留。」
 *
 * 口径：
 *   1) 默认只有「今天」亮着；日期芯片**不选中**、只写「选择日期」，也不再显示时分；
 *   2) 日期芯片打开的选择器**没有时间**这一项；
 *   3) 自己挑一天：芯片显示「YYYY年M月D日」并且是唯一亮着的，今天/明天/本周末全灭；
 *      挑的日子落到那天 23:59（与三个芯片同一口径）；
 *   4) 「清空」按钮 2026-11-13 已撤掉：日期只能从芯片或日期选择器来，不会再清成空。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-163.js
 * 数据：自建 1 条提醒，跑完删掉。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
const TITLE = `日期芯片自检-${STAMP}`;

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
  return { status: res.status, json: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });

const chipState = (page) => page.evaluate(() => {
  const on = (t) => {
    const b = [...document.querySelectorAll('.quick-chip')].find((x) => (x.textContent || '').trim() === t);
    return b ? b.classList.contains('active') : null;
  };
  const dateEl = document.querySelector('[data-quick-date]');
  return {
    today: on('今天'),
    tomorrow: on('明天'),
    weekend: on('本周末'),
    dateText: dateEl ? dateEl.textContent.replace(/\s+/g, ' ').trim() : null,
    dateActive: dateEl ? dateEl.classList.contains('active') : null,
    clearVisible: !!document.querySelector('[data-quick-clear-due]'),
    undatedHint: !!document.querySelector('[data-quick-undated-hint]'),
    rowText: (document.querySelector('.quick-card')?.textContent || '').replace(/\s+/g, ' ').slice(0, 200),
  };
});

const clickChip = (page, text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('.quick-chip')].find((x) => (x.textContent || '').trim() === t);
  if (!b) return false;
  b.click();
  return true;
}, text);

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.quick-card'), { timeout: 20000 });
    await sleep(1500);
    await openQuickAdd(page);
    await sleep(600);

    // ---------- 1. 默认态：只亮今天 ----------
    const initial = await chipState(page);
    check('默认只有「今天」亮着（明天 / 本周末 / 日期芯片都不亮）',
      initial.today === true && initial.tomorrow === false && initial.weekend === false && initial.dateActive === false,
      JSON.stringify(initial));
    check('日期芯片默认只写「选择日期」，不再同时选中一个日期时间',
      initial.dateText === '选择日期', String(initial.dateText));
    check('新建卡片上不再出现「HH:mm」时间显示',
      !/\d{1,2}:\d{2}/.test(initial.rowText), initial.rowText);

    // ---------- 2. 选择器里没有时间 ----------
    await page.evaluate(() => document.querySelector('[data-quick-date]')?.click());
    await sleep(700);
    const picker = await page.evaluate(() => ({
      open: !!document.querySelector('[data-picker-title]'),
      title: document.querySelector('[data-picker-title]')?.textContent.replace(/\s+/g, ' ').trim() || '',
      timeInputs: [...document.querySelectorAll('input[type="time"]')].filter((e) => e.offsetParent).length,
      hourMinutePickers: [...document.querySelectorAll('[data-time-picker], [data-hour], [data-minute]')].length,
      cells: document.querySelectorAll('.day-cell').length,
    }));
    check('点日期芯片能打开日期选择器', picker.open === true && picker.cells > 27, JSON.stringify(picker));
    check('选择器里没有时间这一项（时间控件已删）',
      picker.timeInputs === 0 && picker.hourMinutePickers === 0, JSON.stringify(picker));

    // ---------- 3. 挑一个具体日期：只亮它、落到 23:59 ----------
    const target = new Date();
    target.setDate(target.getDate() + 3);
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
    const label = `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日`;
    const picked = await page.evaluate((iso) => {
      const cells = [...document.querySelectorAll('.day-cell')];
      const hit = cells.find((c) => (c.getAttribute('title') || '').startsWith(iso));
      if (!hit) return false;
      hit.click();
      return true;
    }, iso);
    await sleep(700);
    // 选择器点完日期不会自己收（沿用原来的行为：点外面或「今天」才收），这里点空白收起
    await page.mouse.click(1200, 820);
    await sleep(400);
    const pickerClosed = await page.evaluate(() => !document.querySelector('[data-picker-title]'));
    check('点空白处能收起日期选择器', pickerClosed === true);
    const afterPick = await chipState(page);
    check(`挑 ${iso} 之后芯片写着这一天`, picked === true && afterPick.dateText === label,
      JSON.stringify({ picked, text: afterPick.dateText, label }));
    check('挑了具体日期后只有它亮着（今天 / 明天 / 本周末全灭）',
      afterPick.dateActive === true && afterPick.today === false && afterPick.tomorrow === false && afterPick.weekend === false,
      JSON.stringify(afterPick));
    await page.screenshot({ path: path.join(SHOTS, 'quick-chip-custom-date.png') });

    // 保存后核对 due = 那天 23:59
    await page.evaluate((t) => {
      const card = document.querySelector('.quick-card');
      const input = card.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, t);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, TITLE);
    await sleep(300);
    await page.evaluate(() => {
      const card = document.querySelector('.quick-card');
      [...card.querySelectorAll('button')].find((b) => /^(添加提醒|添加)$/.test(b.textContent.trim()))?.click();
    });
    await sleep(1800);
    const found = await api(page, '/api/reminder/items?view=all&q=' + encodeURIComponent(TITLE));
    const item = (found.json?.data || []).find((x) => x.title === TITLE);
    const due = item?.due_at ? new Date(item.due_at) : null;
    const dueKey = due ? `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())} ${pad(due.getHours())}:${pad(due.getMinutes())}` : '';
    check('保存后到期时间就是挑的那天 23:59', dueKey === `${iso} 23:59`, dueKey);
    if (item) await api(page, `/api/reminder/items/${item.id}`, 'DELETE');

    // ---------- 4. 三个芯片各自独占，「清空」已撤掉 ----------
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);
    await openQuickAdd(page);
    await sleep(500);
    await clickChip(page, '明天');
    await sleep(300);
    const tomorrow = await chipState(page);
    check('点「明天」后只有明天亮着，日期芯片熄灭',
      tomorrow.tomorrow === true && tomorrow.today === false && tomorrow.dateActive === false,
      JSON.stringify(tomorrow));
    // 用户 2026-11-13：「清空」按钮去掉（没有意义）。
    const afterTomorrow = await chipState(page);
    check('「清空」按钮已去掉，日期不再能清成空',
      afterTomorrow.clearVisible === false && afterTomorrow.undatedHint === false
        && afterTomorrow.tomorrow === true,
      JSON.stringify(afterTomorrow));
    await clickChip(page, '今天');
    await sleep(300);
    const restored = await chipState(page);
    check('点「今天」后今天亮、日期芯片熄灭',
      restored.today === true && restored.dateText === '选择日期' && restored.undatedHint === false, JSON.stringify(restored));

    // ---------- 5. 手机端 390px：这一排不塌 ----------
    await page.setViewport({ width: 390, height: 844 });
    await sleep(900);
    const narrow = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.quick-card .quick-chip')].filter((c) => c.offsetParent !== null);
      const card = document.querySelector('.quick-card');
      const cardRect = card.getBoundingClientRect();
      return {
        count: chips.length,
        overflow: chips.filter((c) => {
          const r = c.getBoundingClientRect();
          return r.right > cardRect.right + 1;
        }).length,
      };
    });
    check('390px：芯片都落在卡片宽度内，没有横向溢出', narrow.count >= 6 && narrow.overflow === 0, JSON.stringify(narrow));
    await page.screenshot({ path: path.join(SHOTS, 'quick-chip-row-390.png') });

    console.log(`  截图：${path.join(SHOTS, 'quick-chip-custom-date.png')} / quick-chip-row-390.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
