/**
 * 验证日历打印的「列表」模式（0.10.x 新增，参考「已完成记录」的表格打印）。
 *
 * 覆盖：
 *   1) 弹窗顶部有「月历 / 列表」切换，默认月历；切到列表后打印区从月历格子变成表格
 *   2) 默认 7 列（序号/日期/时间/标题/类型/清单/状态），列 ≥5 自动横向、≥6 自动小字号
 *   3) 勾选/取消列、全选、恢复默认都同步到打印区；一列不选时禁止打印
 *   4) 行数 = 本月全部安排（与月历模式、工具条计数一致），按日期时间升序
 *   5) 状态列区分 未完成/已完成/记录，类型列区分 提醒/记事，记事开关能过滤掉记事行
 *   6) 打印媒体下表格不超可打印区、单元格不溢出、表头跨页重复
 *   7) 列表模式也能出 A4 PDF
 *   8) 切回月历能恢复格子；关闭后清理干净；标题默认随模式切换（未手改时）
 *      （手机端不提供日历视图，这个弹窗只在电脑上能打开，故不做窄屏分支；手机端见 verify-094）
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-093.js
 * 数据：只读，不改服务端任何东西。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');
const ROOT = BASE.replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 打印文档状态（预览那份；sel='#print-root' 时读打印区）。 */
const docState = (page, sel) => page.evaluate((sel) => {
  const el = sel === 'preview'
    ? [...document.querySelectorAll('.print-doc')].find((d) => !d.closest('#print-root'))
    : document.querySelector(sel);
  if (!el) return null;
  const table = el.querySelector('table');
  const rows = table ? [...table.querySelectorAll('tbody tr')] : [];
  return {
    isTable: !!table,
    isGrid: !!el.querySelector('.cal-print-grid'),
    title: el.querySelector('h1')?.textContent.trim() || '',
    meta: el.querySelector('.meta')?.textContent.trim() || '',
    headers: table ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [],
    rows: rows.length,
    firstRow: rows[0] ? [...rows[0].querySelectorAll('td')].map((td) => td.textContent.trim()) : [],
    lastRow: rows.length ? [...rows[rows.length - 1].querySelectorAll('td')].map((td) => td.textContent.trim()) : [],
    kinds: rows.map((r) => r.lastElementChild?.previousElementSibling?.previousElementSibling?.textContent.trim() || ''),
  };
}, sel);

// 注意：属性挂在 section 上是 data-print-layout，按钮上是 data-print-mode——同名会一次选中三个元素
const modeOf = (page) => page.evaluate(() => document.querySelector('section[data-print-layout]')?.getAttribute('data-print-layout'));
const setMode = async (page, m) => {
  await page.evaluate((m) => document.querySelector(`[data-print-mode="${m}"]`).click(), m);
  await sleep(450);
};
const colLabels = (page) => page.evaluate(() => [...document.querySelectorAll('[data-print-col]')].map((b) => ({ key: b.getAttribute('data-print-col'), on: b.classList.contains('selected') })));

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.cal-cell'), { timeout: 20000 });
    await sleep(1800);

    // 工具条计数（未完成/已完成/记事）：用来核对列表行数
    const bar = await page.evaluate(() => {
      const t = [...document.querySelectorAll('span')].map((s) => s.textContent.trim())
        .filter((x) => /^(未完成|已完成|记事)\s*\d+$/.test(x)).join(' ');
      const num = (label) => { const m = new RegExp(label + '\\s*(\\d+)').exec(t); return m ? Number(m[1]) : 0; };
      return { open: num('未完成'), done: num('已完成'), notes: num('记事'), text: t };
    });
    const expectAll = bar.open + bar.done + bar.notes;
    console.log(`  本月：未完成 ${bar.open} / 已完成 ${bar.done} / 记事 ${bar.notes} = ${expectAll} 条`);

    await page.evaluate(() => document.querySelector('button[aria-label="打印日历"]').click());
    await waitFor(page, () => !!document.querySelector('#print-root'), { timeout: 8000 });
    await sleep(700);

    // ---- 1. 模式切换 ----
    const modes = await page.evaluate(() => [...document.querySelectorAll('[data-print-mode]')].map((b) => ({ key: b.getAttribute('data-print-mode'), label: b.textContent.trim(), active: b.classList.contains('active') })));
    check('弹窗顶部有「月历 / 列表」切换', JSON.stringify(modes.map((m) => m.key)) === JSON.stringify(['calendar', 'list']),
      JSON.stringify(modes));
    check('默认是月历模式', await modeOf(page) === 'calendar', await modeOf(page));
    const gridDoc = await docState(page, '#print-root');
    check('月历模式下打印区是格子（没有表格）', gridDoc?.isGrid === true && gridDoc.isTable === false, JSON.stringify({ grid: gridDoc?.isGrid, table: gridDoc?.isTable }));

    await setMode(page, 'list');
    const listDoc = await docState(page, '#print-root');
    check('切到列表后打印区变成表格（格子消失）', listDoc?.isTable === true && listDoc.isGrid === false, JSON.stringify({ grid: listDoc?.isGrid, table: listDoc?.isTable }));
    const previewDoc = await docState(page, 'preview');
    check('预览与打印区都是这份表格', previewDoc?.isTable === true && previewDoc.headers.join('/') === listDoc.headers.join('/'),
      `${previewDoc?.headers.join('/')} vs ${listDoc?.headers.join('/')}`);

    // ---- 2. 默认列 ----
    const cols = await colLabels(page);
    check('列出 9 个可选列', cols.length === 9, JSON.stringify(cols.map((c) => c.key)));
    check('默认选中 7 列（序号/日期/时间/标题/类型/清单/状态）',
      cols.filter((c) => c.on).map((c) => c.key).join(',') === 'index,date,time,title,kind,list,status',
      JSON.stringify(cols.map((c) => `${c.key}=${c.on}`)));
    check('表头与所选列一致', JSON.stringify(listDoc.headers) === JSON.stringify(['序号', '日期', '时间', '标题', '类型', '清单', '状态']),
      JSON.stringify(listDoc.headers));
    const autoDir = await page.evaluate(() => ({
      orientation: document.querySelector('section[data-print-orientation]')?.getAttribute('data-print-orientation'),
      font: document.querySelector('section[data-print-font]')?.getAttribute('data-print-font'),
      columns: document.querySelector('section[data-print-columns]')?.getAttribute('data-print-columns'),
    }));
    check('7 列时自动横向 + 自动小字号（照「已完成记录」的规则）',
      autoDir.orientation === 'landscape' && autoDir.font === 'small' && autoDir.columns === '7', JSON.stringify(autoDir));

    // ---- 3. 行内容与排序 ----
    check('行数 = 本月全部安排（未完成+已完成+记事）', listDoc.rows === expectAll, `${listDoc.rows} vs ${expectAll}`);
    const sorted = await page.evaluate(() => {
      const table = document.querySelector('#print-root table');
      const keys = [...table.querySelectorAll('tbody tr')].map((tr) => {
        const tds = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim());
        // 「全天」在真实排序里是当天 00:00（排最前），字符串比较时它却比数字大，
        // 所以要归一成 00:00 再比，否则一旦有全天提醒这条断言就假红（踩过）。
        const time = tds[2] === '全天' ? '00:00' : tds[2];
        return `${tds[1]} ${time}`; // 日期 时间
      });
      return { keys, ok: keys.every((k, i) => i === 0 || keys[i - 1] <= k) };
    });
    check('按日期 + 时间升序排列（读起来像日程表）', sorted.ok, sorted.keys.slice(0, 4).join(' | '));
    check('第一行是序号 1', listDoc.firstRow[0] === '1', JSON.stringify(listDoc.firstRow));
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(listDoc.firstRow[1] || '');
    const timeOk = /^(\d{2}:\d{2}|全天)$/.test(listDoc.firstRow[2] || '');
    check('日期列是 YYYY-MM-DD、时间列是 HH:MM 或「全天」', dateOk && timeOk, JSON.stringify(listDoc.firstRow.slice(1, 3)));

    const bodyText = await page.evaluate(() => [...document.querySelectorAll('#print-root tbody tr')].map((tr) => tr.textContent));
    check('状态列区分未完成 / 已完成 / 记录',
      bodyText.some((t) => t.includes('未完成')) && bodyText.some((t) => t.includes('已完成')) && bodyText.some((t) => t.includes('记录')),
      bodyText.slice(0, 3).join(' || '));
    check('类型列区分提醒 / 记事',
      bodyText.some((t) => t.includes('提醒')) && (bar.notes === 0 || bodyText.some((t) => t.includes('记事'))),
      `记事 ${bar.notes} 条`);

    // ---- 4. 勾选列 ----
    await page.evaluate(() => document.querySelector('[data-print-col="repeat"]').click());
    await sleep(400);
    const withRepeat = await docState(page, '#print-root');
    check('勾上「重复」后表头多一列（8 列）', withRepeat.headers.length === 8 && withRepeat.headers.includes('重复'),
      withRepeat.headers.join('/'));
    check('列数变化后字号仍然自动=小（≥6 列）', (await page.evaluate(() => document.querySelector('section[data-print-font]')?.getAttribute('data-print-font'))) === 'small');
    await page.evaluate(() => document.querySelector('[data-print-resetcols]').click());
    await sleep(400);
    const reset = await docState(page, '#print-root');
    check('「恢复默认」回到 7 列', reset.headers.length === 7, reset.headers.join('/'));
    await page.evaluate(() => document.querySelector('[data-print-allcols]').click());
    await sleep(400);
    const all = await docState(page, '#print-root');
    check('「全选」到 9 列', all.headers.length === 9, all.headers.join('/'));

    // ---- 5. 记事筛选对列表也生效 ----
    if (bar.notes > 0) {
      await page.evaluate(() => document.querySelector('[data-print-toggle="notes"]').click());
      await sleep(500);
      const noNotes = await docState(page, '#print-root');
      check('关掉「记事」后列表里没有「记录」行了',
        noNotes.rows === expectAll - bar.notes && !(await page.evaluate(() => document.querySelector('#print-root').textContent.includes('记录'))),
        `${listDoc.rows} → ${noNotes.rows}（记事 ${bar.notes}）`);
      await page.evaluate(() => document.querySelector('[data-print-toggle="notes"]').click());
      await sleep(400);
    } else {
      check('本月没有记事，跳过「记事」筛选断言', true);
    }

    // ---- 6. 打印媒体下的排版 ----
    const PRINTABLE_WIDTH = 1123 - 2 * Math.round((10 / 25.4) * 96);
    await page.setViewport({ width: PRINTABLE_WIDTH, height: 794 });
    await page.emulateMediaType('print');
    await sleep(400);
    const printLayout = await page.evaluate(() => {
      const app = document.querySelector('#app') || document.body.firstElementChild;
      const root = document.querySelector('#print-root');
      const table = root.querySelector('table');
      const overflowing = [...table.querySelectorAll('td, th')].filter((c) => c.scrollWidth > c.clientWidth + 1).length;
      return {
        appDisplay: app ? getComputedStyle(app).display : 'none',
        rootDisplay: getComputedStyle(root).display,
        tableWidth: Math.round(table.getBoundingClientRect().width),
        printable: window.innerWidth,
        overflow: overflowing,
        headerRepeat: getComputedStyle(table.querySelector('thead')).display,
      };
    });
    check('打印时只显示打印表格', printLayout.appDisplay === 'none' && printLayout.rootDisplay === 'block', JSON.stringify(printLayout));
    check('表格不超可打印区', printLayout.tableWidth > 0 && printLayout.tableWidth <= printLayout.printable + 2,
      `${printLayout.tableWidth} vs ${printLayout.printable}`);
    check('没有单元格内容溢出', printLayout.overflow === 0, String(printLayout.overflow));
    check('表头跨页重复（table-header-group）', printLayout.headerRepeat === 'table-header-group', printLayout.headerRepeat);
    await page.emulateMediaType(null);
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(300);

    // ---- 7. A4 PDF ----
    try {
      const pdf = await page.pdf({ width: '297mm', height: '210mm', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
      const text = Buffer.from(pdf).toString('latin1');
      const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
      const box = /\/MediaBox \[([^\]]+)\]/.exec(text);
      const dims = box ? box[1].trim().split(/\s+/).map(Number) : [];
      const [w, h] = dims.slice(2);
      fs.writeFileSync(path.join(SHOTS, 'calendar-print-list-a4.pdf'), pdf);
      check('列表模式能导出 A4 横向 PDF', pdf.length > 1024 && pages >= 1, `${Math.round(pdf.length / 1024)}KB / ${pages} 页`);
      check('PDF 纸张是 A4 横向（842×595pt）',
        !!box && Math.abs(Math.round(w) - 842) < 12 && Math.abs(Math.round(h) - 595) < 12, box ? box[1] : '无');
    } catch (err) {
      check('列表模式能导出 A4 横向 PDF', false, String(err && err.message));
    }

    // ---- 8. 标题随模式、切回月历、关闭清理 ----
    const titleList = (await docState(page, '#print-root'))?.title || '';
    check('列表模式默认标题是「…安排」', /安排$/.test(titleList), titleList);
    await setMode(page, 'calendar');
    const titleCal = (await docState(page, '#print-root'))?.title || '';
    const backGrid = await docState(page, '#print-root');
    check('切回月历恢复格子', backGrid?.isGrid === true && backGrid.isTable === false, JSON.stringify({ grid: backGrid?.isGrid }));
    check('标题跟着切换成「…日历」', /日历$/.test(titleCal), titleCal);

    await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消' && b.closest('section')).click(); });
    await sleep(600);
    const cleaned = await page.evaluate(() => ({ root: !!document.querySelector('#print-root'), rule: !!document.getElementById('print-page-rule') }));
    check('关闭弹窗后清掉打印区与 @page 规则', !cleaned.root && !cleaned.rule, JSON.stringify(cleaned));

    await page.evaluate(() => document.querySelector('button[aria-label="打印日历"]').click());
    await waitFor(page, () => !!document.querySelector('#print-root'), { timeout: 8000 });
    await sleep(600);
    await setMode(page, 'list');

    // 手机端不测这个弹窗：0.10.x 起手机端不提供日历视图（见 verify-094），
    // 这个打印弹窗只能在电脑上打开，所以它不做窄屏分支——两种情况都要所见即所得。
    await page.screenshot({ path: path.join(SHOTS, 'calendar-print-list.png') });
    console.log(`  截图：${path.join(SHOTS, 'calendar-print-list.png')} / calendar-print-list-a4.pdf`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
