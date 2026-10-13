/**
 * 验证 0.1.2 的两项改动：
 *   1) 「已完成」时间段选项 = 全部 / 今天 / 本周 / 本月 / 本年 / 自定义
 *   2) 「导出表格」按当前筛选导出 CSV（列表口径 / 完成记录口径）
 *
 * 用法：APP_URL=http://192.168.3.201:8908 node verify-export.js
 *
 * 两个实现细节：
 *   - 导出是 axios(blob) + a.click()，这里监听那次 XHR 的响应来断言 URL / 状态 / 内容；
 *     BOM 另行用页面内 fetch 读原始字节（浏览器会吃掉 XHR 里的 BOM，text() 看不出来）。
 *   - 测试前清掉 localStorage 里的完成记录清单筛选：这个浏览器 profile 是共用的，
 *     别的用例留下的筛选会让「已完成」导出显示 0 行。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 点某个按钮并抓取它触发的那次导出请求。 */
async function clickAndCaptureExport(page, buttonText) {
  const captured = page
    .waitForResponse((res) => res.url().includes('/api/reminder/export'), { timeout: 20000 })
    .catch(() => null);
  await page.evaluate((text) => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith(text));
    if (button) button.click();
  }, buttonText);
  // 列表页的「导出表格」现在先弹导出对话框（选清单与列），需要再点一次「导出 CSV」。
  // 日历页的「导出本月」仍是直接下载，没有这一步。
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
    contentType: response.headers()['content-type'] || '',
    text: await response.text().catch(() => ''),
  };
}

/** 带鉴权头的 GET，返回 { status, body }。 */
const apiGet = (page, url) => page.evaluate(async (u) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
  return { status: res.status, body: await res.json().catch(() => null) };
}, url);

/** 用页面内 fetch 读导出的原始字节，验证 UTF-8 BOM。 */
function fetchExportBytes(page, url) {  return page.evaluate(async (target) => {
    const token = localStorage.getItem('reminders.token');
    const res = await fetch(target, { headers: { Authorization: 'Bearer ' + token } });
    const buffer = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, first3: [...buffer.slice(0, 3)] };
  }, url);
}

function csvLines(body) {
  return body.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
}

/**
 * 按 CSV 规则拆一行（引号内的逗号不算分隔符）。
 * 不能直接 split(',')：标题里出现逗号时列会整体错位，取值就成了垃圾。
 */
function csvFields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 时间段芯片：只取「自定义」那颗所在的容器，避免把清单筛选的「全部」也算进来。 */
function readRangeChips(page) {
  return page.evaluate(() => {
    const custom = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '自定义');
    if (!custom || !custom.parentElement) return [];
    return [...custom.parentElement.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  });
}

async function clickChip(page, label) {
  const waiting = page
    .waitForResponse((res) => res.url().includes('/api/reminder/completed?'), { timeout: 15000 })
    .catch(() => null);
  await page.evaluate((text) => {
    const chip = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === text);
    if (chip) chip.click();
  }, label);
  return waiting;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await withTab(async (page) => {
    console.log(`目标：${BASE}`);
    await login(page, BASE);
    // 共用 profile：先把上一次用例留下的完成清单筛选清掉，否则导出是 0 行。
    await page.evaluate(() => { try { localStorage.removeItem('ui_completed_lists') } catch { /* 忽略 */ } });

    // ── 列表页导出（scope=active）──
    await page.goto(BASE.replace(/\/$/, '') + '/admin/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    const listButton = await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('导出表格')));
    check('列表页有「导出表格」按钮', listButton);

    const active = await clickAndCaptureExport(page, '导出表格');
    check('点击后发出导出请求', !!active, active ? '' : '20s 内没有 /api/reminder/export');
    if (active) {
      check('返回 200', active.status === 200, `status=${active.status}`);
      check('是 CSV', /text\/csv/i.test(active.contentType), active.contentType);
      const lines = csvLines(active.text);
      check('表头正确', lines[0] === '标题,类型,清单,状态,到期时间,完成时间,重复,备注', lines[0]);
      check('导出的是列表口径（scope=active）', active.url.includes('scope=active'), active.url);
      check('有数据行', lines.length > 1, `行数=${lines.length - 1}`);
      console.log(`    行数=${lines.length - 1}`);
      console.log(`    首行=${lines[1] || '(空)'}`);
      const raw = await fetchExportBytes(page, active.url);
      check('原始字节带 UTF-8 BOM（Excel 中文不乱码）',
        raw.first3.join(',') === '239,187,191', raw.first3.join(','));
    }

    // ── 已完成页：时间段选项 ──
    await page.goto(BASE.replace(/\/$/, '') + '/admin/completed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    const chips = await readRangeChips(page);
    check('时间段选项 = 全部/今天/昨天/本周/上周/本月/上月/今年/自定义',
      chips.join('/') === '全部/今天/昨天/本周/上周/本月/上月/今年/自定义', chips.join('/'));

    const weekRequest = await clickChip(page, '本周');
    check('点「本周」按 range=week 重新查询',
      !!weekRequest && weekRequest.url().includes('range=week'), weekRequest ? weekRequest.url() : '没有请求');
    const activeChip = await page.evaluate(() =>
      ([...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '本周') || {}).className || '');
    check('「本周」处于选中态', /active/.test(activeChip), activeChip);

    // ── 逐个时间段导出：既要行数关系对，也要 CSV 里每一行的完成时间真落在区间内 ──
    // 「完成时间」在第 6 列（下标 5），格式 YYYY-MM-DD HH:MM。
    const completedDate = (line) => (csvFields(line)[5] || '').slice(0, 10);
    const counts = {};
    const rowDates = {};
    const shownSpans = {};
    for (const [label, value] of [
      ['今天', 'today'], ['昨天', 'yesterday'], ['本周', 'week'], ['上周', 'lastweek'],
      ['本月', 'month'], ['上月', 'lastmonth'], ['今年', 'year'], ['全部', 'all'],
    ]) {
      await clickChip(page, label);
      await sleep(700);
      // 0.1.5 起筛选器下方会显示后端算出来的实际区间，顺手记下来核对
      shownSpans[value] = await page.evaluate(() => {
        const line = [...document.querySelectorAll('p')].find((p) => (p.textContent || '').includes('当前区间'));
        return line ? (line.textContent || '').replace(/\s+/g, ' ').replace('当前区间：', '').trim() : '';
      });
      const csv = await clickAndCaptureExport(page, '导出表格');
      if (!csv) { check(`「${label}」导出有响应`, false, '没有请求'); counts[value] = -1; continue; }
      const lines = csvLines(csv.text);
      const dates = lines.slice(1).map(completedDate).filter(Boolean);
      counts[value] = lines.length - 1;
      rowDates[value] = dates;
      check(`「${label}」导出 200 且带上 range=${value}`,
        csv.status === 200 && csv.url.includes(`range=${value}`), `status=${csv.status} ${csv.url}`);
    }
    console.log('    行数：' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
    console.log('    当前区间：' + Object.entries(shownSpans).map(([k, v]) => `${k}=${v}`).join(' | '));

    // 逐行核对区间：先拿「全部」的记录自己分桶，再和每个时间段接口的条数对，
    // 等于用一份独立实现交叉验证后端的区间算法（比单纯看大小关系强得多）。
    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    const todayKey = dayKey(now);
    const yesterdayKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthEnd = firstOfMonth;                                            // 本月 1 号 0 点
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);    // 上月 1 号 0 点
    const firstOfYear = new Date(now.getFullYear(), 0, 1);
    // 上周 = 上一个自然周：本周一往前 7 天 → 本周一（左闭右开，正好接上本周）
    const lastWeekStart = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
    const lastWeekEnd = monday;

    const allDates = (rowDates.all || []).slice().sort();
    const inRange = (d, from, toExclusive) => d >= dayKey(from) && d < dayKey(toExclusive);
    const expected = {
      today: allDates.filter((d) => d === todayKey).length,
      yesterday: allDates.filter((d) => d === yesterdayKey).length,
      week: allDates.filter((d) => d >= dayKey(monday) && d <= todayKey).length,
      lastweek: allDates.filter((d) => inRange(d, lastWeekStart, lastWeekEnd)).length,
      month: allDates.filter((d) => d >= dayKey(firstOfMonth) && d <= todayKey).length,
      lastmonth: allDates.filter((d) => inRange(d, lastMonthStart, lastMonthEnd)).length,
      year: allDates.filter((d) => d >= dayKey(firstOfYear) && d <= todayKey).length,
      all: allDates.length,
    };
    console.log(`    独立统计：${Object.entries(expected).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    for (const [label, value] of [
      ['今天', 'today'], ['昨天', 'yesterday'], ['本周', 'week'], ['上周', 'lastweek'],
      ['本月', 'month'], ['上月', 'lastmonth'], ['今年', 'year'], ['全部', 'all'],
    ]) {
      check(`「${label}」条数与独立统计一致`, counts[value] === expected[value],
        `接口=${counts[value]} 期望=${expected[value]}`);
    }
    if (rowDates.yesterday && rowDates.yesterday.length) {
      check('「昨天」导出的每一行都是昨天的记录',
        rowDates.yesterday.every((d) => d === yesterdayKey),
        `样本=${rowDates.yesterday.slice(0, 3).join('/')}`);
    }
    if (rowDates.lastmonth && rowDates.lastmonth.length) {
      check('「上月」导出的每一行都在上个月',
        rowDates.lastmonth.every((d) => inRange(d, lastMonthStart, lastMonthEnd)),
        `样本=${rowDates.lastmonth.slice(0, 3).join('/')}`);
    }
    if (rowDates.lastweek && rowDates.lastweek.length) {
      check('「上周」导出的每一行都在上周（周一~周日）',
        rowDates.lastweek.every((d) => inRange(d, lastWeekStart, lastWeekEnd)),
        `样本=${rowDates.lastweek.slice(0, 3).join('/')}`);
    }
    check('「全部」导出的每一行都在今年或更早（排序正常）',
      allDates.length === 0 || allDates[allDates.length - 1] <= todayKey, `最新=${allDates[allDates.length - 1]}`);
    check('全部有数据', counts.all > 0, String(counts.all));

    // ── 「当前区间」文案：核对整段日历口径（0.1.5 起） ──
    const shift = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
    const lastDayOfMonth = (d) => dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const expectedSpans = {
      today: todayKey,
      yesterday: yesterdayKey,
      week: `${dayKey(monday)} ~ ${dayKey(shift(monday, 6))}`,
      lastweek: `${dayKey(lastWeekStart)} ~ ${dayKey(shift(lastWeekStart, 6))}`,
      month: `${dayKey(firstOfMonth)} ~ ${lastDayOfMonth(firstOfMonth)}`,
      lastmonth: `${dayKey(lastMonthStart)} ~ ${lastDayOfMonth(lastMonthStart)}`,
      year: `${now.getFullYear()}-01-01 ~ ${now.getFullYear()}-12-31`,
      all: '不限时间',
    };
    // 上周与本周必须首尾相接：上周的结束日（周日）+1 天 == 本周的第一天（周一）
    check('日历口径自洽：上周结束日的次日就是本周开始日',
      dayKey(shift(lastWeekStart, 7)) === dayKey(monday),
      `${dayKey(lastWeekStart)} 起 7 天后 = ${dayKey(shift(lastWeekStart, 7))}，本周一 = ${dayKey(monday)}`);
    for (const value of ['today', 'yesterday', 'week', 'lastweek', 'month', 'lastmonth', 'year', 'all']) {
      check(`「当前区间」显示正确（${value}）：${expectedSpans[value]}`,
        shownSpans[value] === expectedSpans[value], `实际「${shownSpans[value]}」`);
    }

    // ── 清单筛选也要写在这一行里（0.1.6 起）──
    // 这层筛选记在 localStorage，下次进来照旧生效；条数变少时得能一眼看出原因。
    const listsRes = await apiGet(page, `${BASE}/api/reminder/lists`);
    const firstList = ((listsRes.body && listsRes.body.data) || [])[0];
    check('能取到清单列表', !!firstList, JSON.stringify(listsRes.body).slice(0, 120));
    if (firstList) {
      const readSummaryLine = () => page.evaluate(() => {
        const line = [...document.querySelectorAll('p')].find((p) => (p.textContent || '').includes('当前区间'));
        return line ? (line.textContent || '').replace(/\s+/g, ' ').trim() : '';
      });
      await page.evaluate((id) => localStorage.setItem('ui_completed_lists', JSON.stringify([id])), firstList.id);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await clickChip(page, '本月');
      await sleep(1500);
      const withFilter = await readSummaryLine();
      check(`筛了清单时该行会写明清单：${firstList.name}`,
        withFilter.includes('清单：') && withFilter.includes(firstList.name), withFilter);
      await page.evaluate(() => localStorage.removeItem('ui_completed_lists'));
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await clickChip(page, '本月');
      await sleep(1500);
      const withoutFilter = await readSummaryLine();
      check('清掉清单筛选后不再显示清单段', !withoutFilter.includes('清单：'), withoutFilter);
    }

    await page.screenshot({ path: path.join(SHOTS, 'export-completed.png') });
    console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  });
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('FAILED:', error && error.message);
  process.exit(1);
});
