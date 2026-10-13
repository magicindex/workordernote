/**
 * 验证 0.4.0 的三件事（都在真界面上点，不直接调接口）：
 *   1) 日历视图纳入记事：记事按记录时间落在当天，格子里有「记」标记，
 *      右侧详情显示「记录 HH:MM」+「记事」且没有完成勾选框；计数里记事单独一档。
 *   2) 列表页「未完成 / 全部」开关：切换后已完成的行出现/消失、已完成排在后面、
 *      状态记在本机（刷新后仍在）。
 *   3) 导出：列表页导出跟随开关（status=all），日历页新增「导出本月」（scope=calendar&month=）。
 *
 * 用法：
 *   APP_URL=http://192.168.3.201:8908 node verify-040.js
 *
 * 前置：目标实例上至少有一条**今天创建的记事**（沙箱里就有）；
 * 没有的话本脚本会在 1) 处明确失败并给出提示，而不是静默跳过。
 *
 * 数据安全：全程只读服务端（导出是 GET），改的是浏览器本地的 ui_list_status，
 * 结束时恢复原值（这个 profile 是你在用的那个浏览器）。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const apiGet = (page, url) => page.evaluate(async (u) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
  return { status: res.status, body: await res.json().catch(() => null) };
}, url);

async function clickAndCaptureExport(page, buttonText) {
  const captured = page
    .waitForResponse((res) => res.url().includes('/api/reminder/export'), { timeout: 20000 })
    .catch(() => null);
  await page.evaluate((text) => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith(text));
    if (button) button.click();
  }, buttonText);
  // 列表页「导出表格」现在先弹导出对话框（选清单与列），再点「导出 CSV」。
  // 日历页「导出本月」仍是直接下载，没有这一步。
  for (let i = 0; i < 12; i += 1) {
    const clicked = await page.evaluate(() => {
      const confirm = document.querySelector('[data-export-confirm]');
      if (!confirm) return false;
      confirm.click();
      return true;
    });
    if (clicked) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const response = await captured;
  if (!response) return null;
  return {
    url: response.url(),
    status: response.status(),
    text: await response.text().catch(() => ''),
  };
}

/**
 * 按 CSV 规则解析成记录数组。
 *
 * 不能按行 split：备注列里有真实换行（例如 Nextcloud 迁移过来的备注），
 * 一条记录会占好几行，行数比记录数多好几倍（实测 29 条被数成 101 条）。
 */
function parseCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n') { record.push(field); records.push(record); record = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || record.length) { record.push(field); records.push(record); }
  return records;
}

function csvLines(body) {
  return body.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    // 记住用户原来的开关状态，结束时恢复
    const originalStatus = await page.evaluate(() => {
      try { return localStorage.getItem('ui_list_status') || 'open' } catch { return 'open' }
    });

    // 今天（上海时区）的日期串，用于日历定位
    const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
    const month = today.slice(0, 7);

    // 前提：今天至少有一条记事。没有（例如生产库）就自己建一条自检记事，
    // 结束时删掉；同时先清掉上一轮失败可能残留的自检记事。
    const TEST_NOTE_PREFIX = '自检记事-';
    const listNotesToday = async () => {
      const res = await apiGet(page, BASE.replace(/\/$/, '') + '/api/reminder/completed?range=today');
      return (res.body?.data?.items || []).filter((i) => i.kind === 'note');
    };
    const removeTestNotes = () => page.evaluate(async ({ base, prefix }) => {
      const token = localStorage.getItem('reminders.token');
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      const res = await fetch(base + '/api/reminder/items?view=completed', { headers });
      const body = await res.json().catch(() => null);
      const stale = (body?.data || []).filter((i) => i.kind === 'note' && String(i.title).startsWith(prefix));
      for (const item of stale) {
        await fetch(base + '/api/reminder/items/' + item.id, { method: 'DELETE', headers });
      }
      return stale.length;
    }, { base: BASE.replace(/\/$/, ''), prefix: TEST_NOTE_PREFIX });

    const cleaned = await removeTestNotes();
    if (cleaned) console.log(`  （清掉上一轮残留的自检记事 ${cleaned} 条）`);

    let notes = await listNotesToday();
    let createdNoteId = null;
    if (notes.length === 0) {
      createdNoteId = await page.evaluate(async ({ base, title }) => {
        const token = localStorage.getItem('reminders.token');
        const res = await fetch(base + '/api/reminder/items', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, kind: 'note', repeat_rule: 'none' }),
        });
        const body = await res.json().catch(() => null);
        return body?.data?.id || null;
      }, { base: BASE.replace(/\/$/, ''), title: `${TEST_NOTE_PREFIX}${Date.now()}` });
      notes = await listNotesToday();
      check('目标实例今天没有记事，已自动建一条自检记事', !!createdNoteId, createdNoteId ? `id=${createdNoteId}` : '创建失败');
    } else {
      check('目标实例今天有记事数据（验证前提）', true,
        `${notes.length} 条：${notes.map((n) => n.title).join(' / ').slice(0, 60)}`);
    }

    // ---- 1. 日历纳入记事 ----
    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const calendarReady = await waitFor(page, () => !!document.querySelector('.cal-cell'), { timeout: 20000 });
    check('日历视图打开', calendarReady);
    await sleep(1500);

    const counters = await page.evaluate(() => {
      const text = document.body.innerText;
      const num = (label) => {
        const m = text.match(new RegExp(label + '\\s*(\\d+)'));
        return m ? Number(m[1]) : null;
      };
      return { open: num('未完成'), done: num('已完成'), note: num('记事') };
    });
    check('日历计数里出现「记事 N」且 N ≥ 1', (counters.note || 0) >= 1, JSON.stringify(counters));
    check('未完成/已完成计数不含记事', counters.open !== null && counters.done !== null,
      JSON.stringify(counters));

    // 今天那格里应该有带「记」标记的记事
    const todayCell = await page.evaluate((date) => {
      const cells = [...document.querySelectorAll('.cal-cell')];
      // 今天的格子：标题里有当天的日号且是 today 高亮类
      const target = cells.find((c) => c.querySelector('.cal-note-mark')) || null;
      if (!target) return null;
      const marks = [...target.querySelectorAll('.cal-note-mark')].map((m) => m.textContent.trim());
      const chips = [...target.querySelectorAll('.cal-task')].map((s) => s.innerText.trim());
      return { marks, chips: chips.slice(0, 6), date };
    }, today);
    check('月历格子里出现「记」标记（记事已进日历）', !!todayCell && todayCell.marks.length >= 1,
      todayCell ? JSON.stringify(todayCell.marks) : '整月都没找到 .cal-note-mark');

    // 进入今天：详情面板要有记事行（记事徽标 + 记录时间 + 没有完成勾选框）
    await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.cal-cell')].find((c) => c.querySelector('.cal-note-mark'));
      if (cell) cell.click();
    });
    await sleep(900);
    const panel = await page.evaluate(() => {
      // 页面上第一个 aside 是侧栏；日历的详情面板是 aside.surface
      const aside = document.querySelector('aside.surface');
      if (!aside) return null;
      const articles = [...aside.querySelectorAll('article')].map((a) => ({
        text: a.innerText.replace(/\s+/g, ' ').slice(0, 80),
        hasNoteMark: !!a.querySelector('.cal-note-mark'),
        // 任务行的勾选按钮：未完成时标签是「完成提醒」，已完成时是「恢复提醒」——
        // 只认「完成」会在这一格里有已完成任务时假红（生产上就踩到过）。
        hasCheckbox: [...a.querySelectorAll('button')].some((b) => /完成|恢复/.test(b.getAttribute('aria-label') || '')),
      }));
      return { articles, text: aside.innerText.replace(/\s+/g, ' ').slice(0, 200) };
    });
    const noteRow = panel?.articles.find((a) => a.hasNoteMark);
    check('详情面板里记事行带「记事」标记', !!noteRow, panel ? panel.text : 'no panel');
    check('记事行显示「记录 HH:MM」', !!noteRow && /记录\s*\d{1,2}:\d{2}/.test(noteRow.text),
      noteRow ? noteRow.text : '');
    check('记事行没有完成勾选框（记事无需完成）', !!noteRow && !noteRow.hasCheckbox,
      noteRow ? JSON.stringify(noteRow) : '');
    const taskRow = panel?.articles.find((a) => !a.hasNoteMark);
    if (taskRow) {
      check('任务行仍有完成/恢复按钮', taskRow.hasCheckbox, JSON.stringify(taskRow));
    }

    await page.screenshot({ path: path.join(SHOTS, 'calendar-notes.png') });

    // ---- 2. 日历导出本月 ----
    const calExport = await clickAndCaptureExport(page, '导出本月');
    check('日历页有「导出本月」按钮并触发导出请求', !!calExport, calExport ? '' : '没抓到 /api/reminder/export 请求');
    if (calExport) {
      check('导出参数带 scope=calendar 与当月 month', /scope=calendar/.test(calExport.url) && calExport.url.includes(`month=${month}`),
        calExport.url);
      const records = parseCsv(calExport.text);
      check('日历导出带表头', records[0]?.join(',') === '标题,类型,清单,状态,到期时间,完成时间,重复,备注',
        records[0]?.join(',') || '空');
      const noteRow = records.slice(1).find((cols) => cols[1] === '记事');
      check('日历导出包含记事行', !!noteRow, noteRow ? noteRow[0].slice(0, 40) : `共 ${records.length - 1} 行数据`);
      if (noteRow) {
        check('记事行「状态」列写「记事」、且没有到期时间', noteRow[3] === '记事' && noteRow[4] === '', noteRow.join('|'));
        check('记事行「完成时间」列填了记录时间', /\d{4}-\d{2}-\d{2}/.test(noteRow[5] || ''), noteRow.join('|'));
      }
    }

    // ---- 3. 列表页「未完成 / 全部」开关 ----
    await page.goto(BASE.replace(/\/$/, '') + '/admin/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '全部'), { timeout: 20000 });
    await sleep(1200);

    const segInfo = () => page.evaluate(() => {
      const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
      if (!seg) return null;
      const buttons = [...seg.querySelectorAll('button')];
      // 同上：工具栏改版后数字在 .count-number 里，两处都认
      const countText = [...document.querySelectorAll('h2')].map((h) => h.textContent).find((t) => /项/.test(t))
        || (document.querySelector('.list-toolbar-count')?.textContent || '');
      const count = countText.match(/(\d+)\s*项/);
      const articles = [...document.querySelectorAll('article.reminder-row')];
      return {
        labels: buttons.map((b) => b.textContent.trim()),
        pressed: buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
        count: count ? Number(count[1]) : null,
        rows: articles.length,
        completedRows: articles.filter((a) => a.classList.contains('reminder-completed')).length,
        // 用 textContent 而不是 innerText：.reminder-row 带 content-visibility:auto，
        // 屏幕外的行浏览器根本不排版，innerText 会返回空串（实测 5 行已完成全是 ""）。
        noteBadges: articles.filter((a) => (a.textContent || '').includes('记事')).length,
      };
    });

    // 明确先切到「未完成」
    await page.evaluate(() => {
      const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
      const btn = [...seg.querySelectorAll('button')].find((b) => b.textContent.trim() === '未完成');
      btn.click();
    });
    await sleep(1200);
    const openState = await segInfo();
    check('列表页有「未完成 / 全部」开关', !!openState && openState.labels.join(',') === '未完成,全部',
      openState ? JSON.stringify(openState.labels) : 'no switch');
    check('「未完成」为选中态', openState?.pressed.join(',') === '未完成', JSON.stringify(openState?.pressed));
    check('未完成口径下没有已完成行', openState.completedRows === 0, JSON.stringify(openState));

    await page.evaluate(() => {
      const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
      const btn = [...seg.querySelectorAll('button')].find((b) => b.textContent.trim() === '全部');
      btn.click();
    });
    await sleep(1400);
    const allState = await segInfo();
    check('「全部」为选中态', allState?.pressed.join(',') === '全部', JSON.stringify(allState?.pressed));
    check('「全部」下条数增加（含已完成）', (allState?.count || 0) > (openState?.count || 0),
      `未完成 ${openState?.count} → 全部 ${allState?.count}`);
    check('「全部」下出现已完成行', (allState?.completedRows || 0) > 0, JSON.stringify(allState));
    check('「全部」下能看到记事（记事徽标）', (allState?.noteBadges || 0) > 0, JSON.stringify(allState));

    // 已完成的行要排在后面。0.16.0 起列表**按天分卡片**（用户要求「同一天的放同一个
    // 卡片」），于是这条规矩落在**每张日卡片内部**：卡片里未完成的在前、已完成的在后。
    // 跨卡片不再保证（昨天的已完成条目本来就该排在今天之前）。
    // 注意：**记事**按设计不再带 `reminder-completed` 类（不画删除线），但它仍然是
    // 「已完成」的行（记录即完成）——所以判定不能只看类名，要拿接口的 completed_at 对齐。
    const orderInfo = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/items?view=all&status=all', { headers: { Authorization: 'Bearer ' + token } });
      const items = (await res.json())?.data || [];
      const done = new Map(items.map((i) => [String(i.title), !!i.completed_at]));
      const groups = [...document.querySelectorAll('[data-day-group]')].map((card) => ({
        key: card.getAttribute('data-day-group'),
        flags: [...card.querySelectorAll('article.reminder-row')].map((r) => {
          const title = r.querySelector('h3')?.innerText.trim() || '';
          return { title, done: done.get(title) === true };
        }),
      }));
      // 每张日卡片内：出现第一个已完成之后，不该再有未完成的
      const offenders = [];
      for (const g of groups) {
        const firstDone = g.flags.findIndex((f) => f.done);
        if (firstDone === -1) continue;
        for (const f of g.flags.slice(firstDone)) if (!f.done) offenders.push(`${g.key} / ${f.title}`);
      }
      return {
        groups: groups.length,
        offenders: offenders.slice(0, 4),
        total: groups.reduce((n, g) => n + g.flags.length, 0),
        doneRows: groups.reduce((n, g) => n + g.flags.filter((f) => f.done).length, 0),
      };
    }, BASE);
    check('每张日卡片里，已完成的行排在未完成之后',
      orderInfo.offenders.length === 0 && orderInfo.groups > 0, JSON.stringify(orderInfo));

    // 已完成的行视觉上要能区分（划掉/置灰）
    const dimmed = await page.evaluate(() => {
      const row = document.querySelector('article.reminder-row.reminder-completed');
      if (!row) return null;
      const h3 = row.querySelector('h3');
      const cs = getComputedStyle(h3);
      return { decoration: cs.textDecorationLine, opacity: getComputedStyle(row).opacity };
    });
    check('已完成行有划线/置灰', !!dimmed && (dimmed.decoration.includes('line-through') || Number(dimmed.opacity) < 1),
      JSON.stringify(dimmed));

    // 刷新后开关仍在（记在本机）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const afterReload = await segInfo();
    check('刷新后「全部」状态仍在（本地记住）', afterReload?.pressed.join(',') === '全部', JSON.stringify(afterReload?.pressed));

    // ---- 4. 列表页导出跟随开关 ----
    const allExport = await clickAndCaptureExport(page, '导出表格');
    check('「全部」下导出请求带 status=all', !!allExport && /status=all/.test(allExport.url), allExport?.url || '没抓到导出请求');
    if (allExport) {
      const records = parseCsv(allExport.text);
      check('「全部」导出包含已完成的行', records.slice(1).some((cols) => cols[3] === '已完成'),
        `共 ${records.length - 1} 条记录`);
      const exportedRows = records.length - 1;
      // 「全部」页现在按月翻页（只显示当月）——这是刻意的：避免数据量把页面拖垮。
      // 但**导出必须仍是所有数据**（用户要求），所以这里改成：导出条数 ≥ 当月行数，
      // 且等于「不限月份的接口条数」。
      const unscoped = await page.evaluate(async (base) => {
        const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
        const res = await fetch(base + '/api/reminder/items?view=all&status=all', { headers: { Authorization: 'Bearer ' + token } });
        return ((await res.json())?.data || []).length;
      }, BASE);
      check('导出是所有数据（≥ 当月页面行数，且等于不限月份的条数）',
        exportedRows === unscoped && exportedRows >= (afterReload?.rows || -1),
        `导出 ${exportedRows} 条 / 不限月份 ${unscoped} 条 / 界面当月 ${afterReload?.rows} 行`);
    }

    // 切回「未完成」再导出：不应带 status=all，且没有已完成行
    await page.evaluate(() => {
      const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
      const btn = [...seg.querySelectorAll('button')].find((b) => b.textContent.trim() === '未完成');
      btn.click();
    });
    await sleep(1400);
    const openExport = await clickAndCaptureExport(page, '导出表格');
    check('「未完成」下导出不带 status=all', !!openExport && !/status=all/.test(openExport.url), openExport?.url || '');
    if (openExport) {
      const records = parseCsv(openExport.text);
      check('「未完成」导出里没有已完成行', !records.slice(1).some((cols) => cols[3] === '已完成'),
        `共 ${records.length - 1} 条记录`);
    }

    // 窄屏（390px）下日历与列表都不横向溢出
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    check('窄屏日历不横向溢出', overflow.doc <= overflow.win + 1, JSON.stringify(overflow));
    await page.screenshot({ path: path.join(SHOTS, 'calendar-notes-mobile.png') });
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });

    // 清理自检数据（软删除，界面与日历都不会再看到它）
    const removedCreated = createdNoteId
      ? await page.evaluate(async ({ base, id }) => {
        const token = localStorage.getItem('reminders.token');
        const res = await fetch(`${base}/api/reminder/items/${id}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
        return res.ok;
      }, { base: BASE.replace(/\/$/, ''), id: createdNoteId })
      : null;
    const leftovers = await removeTestNotes();
    check('自检记事已清理（含历史残留）',
      removedCreated !== false && leftovers === 0,
      createdNoteId ? `删除结果 ${removedCreated}，残留 ${leftovers}` : `残留 ${leftovers}`);

    // 恢复用户原来的开关状态（本地存储，不改服务端）
    await page.evaluate((value) => {
      try {
        if (value === 'open') localStorage.removeItem('ui_list_status');
        else localStorage.setItem('ui_list_status', value);
      } catch { /* 忽略 */ }
    }, originalStatus);
    check(`开关状态已恢复（原值 ${originalStatus}）`, true);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
