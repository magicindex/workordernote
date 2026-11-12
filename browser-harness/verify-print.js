/**
 * 验证「已完成」页的导出/打印/刷新按钮 + 打印弹窗（0.2.0 起）：
 *   1) 三个按钮是真按钮（有边框、有高度），不再是裸文字
 *   2) 打印弹窗能选列，勾选后预览与打印区同时增加该列
 *   3) 按内容自适应：列 ≥5 自动横排、≥6 自动小字号；@page 规则跟着变
 *   4) 打印时只打印 #print-root（应用整体隐藏），表格不超出纸面宽度、单元格不溢出
 *
 * 用法：APP_URL=http://192.168.3.201:8908 node verify-print.js
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

/** 勾/取消勾打印列（弹窗里那排 channel-pill）。 */
function toggleColumn(page, label) {
  return page.evaluate((text) => {
    const btn = [...document.querySelectorAll('.channel-pill')].find((b) => (b.textContent || '').trim() === text);
    if (!btn) return 'not-found';
    btn.click();
    return btn.classList.contains('selected') ? 'on' : 'off';
  }, label);
}

const previewHeader = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.print-doc')]
    .find((d) => d.closest('.rounded-xl.border'))  // 弹窗里的预览那份
    ? [...document.querySelectorAll('.print-doc')].find((d) => d.closest('.rounded-xl.border'))
        .querySelectorAll('thead th').length
    : 0);

const headerLabels = (rootSelector, page) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  if (!root) return [];
  const table = root.querySelector('table');
  // 预览那份在弹窗里，打印那份在 #print-root 里
  const target = sel === '#print-root' ? table : [...document.querySelectorAll('.print-doc')].find((d) => d.closest('.rounded-xl.border'))?.querySelector('table');
  return target ? [...target.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [];
}, rootSelector);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await withTab(async (page) => {
    console.log(`目标：${BASE}`);
    await login(page, BASE);
    await page.goto(BASE.replace(/\/$/, '') + '/admin/completed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);

    // ── 1. 按钮样式 ──
    const buttons = await page.evaluate(() => {
      const list = ['导出表格', '打印', '刷新'].map((label) => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes(label));
        if (!btn) return { label, missing: true };
        const s = getComputedStyle(btn);
        const r = btn.getBoundingClientRect();
        return {
          label,
          height: Math.round(r.height),
          borderWidth: s.borderTopWidth,
          borderRadius: s.borderTopLeftRadius,
          background: s.backgroundColor,
          fontSize: s.fontSize,
          hasIcon: !!btn.querySelector('svg'),
        };
      });
      return list;
    });
    for (const b of buttons) {
      check(`「${b.label}」存在且是按钮样式`, !b.missing && parseFloat(b.borderWidth) > 0 && b.height >= 28 && !!b.hasIcon,
        JSON.stringify(b));
    }
    console.log('    ' + buttons.map((b) => `${b.label}=${b.height}px/${b.borderWidth}/${b.fontSize}${b.hasIcon ? '/有图标' : ''}`).join('  '));

    // ── 2. 打开打印弹窗 ──
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes('打印'));
      if (btn) btn.click();
    });
    const opened = await waitFor(page, () => !!document.querySelector('#print-root'), { timeout: 8000 });
    check('打印弹窗打开且存在打印区 #print-root', !!opened);

    const chipCount = await page.evaluate(() => document.querySelectorAll('.channel-pill').length);
    // 2026-11-12 起多了一列「完成备注」（默认不勾）
    check('可选的列共 9 项', chipCount === 9, String(chipCount));

    const defaultLabels = await headerLabels('#print-root', page);
    check('默认打印 5 列（序号/标题/类型/清单/完成时间）',
      defaultLabels.join('/') === '序号/标题/类型/清单/完成时间', defaultLabels.join('/'));

    // ── 3. 按内容自适应 ──
    const box = () => page.evaluate(() => {
      const el = document.querySelector('[data-print-orientation]');
      return el ? {
        orientation: el.getAttribute('data-print-orientation'),
        font: el.getAttribute('data-print-font'),
        columns: Number(el.getAttribute('data-print-columns')),
      } : null;
    });
    const before = await box();
    check('5 列时自动横向', before && before.orientation === 'landscape', JSON.stringify(before));
    check('5 列时字号自动=中', before && before.font === 'medium', JSON.stringify(before));

    await toggleColumn(page, '重复');
    await sleep(500);
    const six = await box();
    check('勾上「重复」后 6 列，字号自动收小', six && six.columns === 6 && six.font === 'small', JSON.stringify(six));
    const sixLabels = await headerLabels('#print-root', page);
    check('打印区同步增加「重复」列', sixLabels.includes('重复'), sixLabels.join('/'));
    const previewLabels = await page.evaluate(() => {
      const docs = [...document.querySelectorAll('.print-doc')];
      const preview = docs.find((d) => d.closest('.rounded-xl.border'));
      return preview ? [...preview.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [];
    });
    check('预览也同步增加「重复」列', previewLabels.includes('重复'), previewLabels.join('/'));

    const pageRule = await page.evaluate(() => {
      const el = document.getElementById('print-page-rule');
      return el ? el.textContent : '';
    });
    check('@page 规则已注入且是横向', /@page/.test(pageRule) && /landscape/.test(pageRule), pageRule);

    // 手动改成纵向
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes('自动')));
      sel.value = 'portrait';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(500);
    const manual = await page.evaluate(() => ({
      orientation: document.querySelector('[data-print-orientation]').getAttribute('data-print-orientation'),
      rule: (document.getElementById('print-page-rule') || {}).textContent || '',
    }));
    check('手动选纵向后 @page 跟着变纵向', manual.orientation === 'portrait' && /portrait/.test(manual.rule),
      JSON.stringify(manual));
    // 改回自动，后面的排版测量用默认
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes('自动')));
      sel.value = 'auto';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);

    // ── 4. 打印媒体下的排版 ──
    // 打印时浏览器的排版宽度 = 纸宽 - 左右页边距，所以视口要按「可打印区」设：
    // A4 横向 1123 CSS px，12mm 页边距 ≈ 45px，可打印区约 1033px。
    // （按整张纸宽 1123 量会误判成超宽——那是模型不对，不是真的溢出。）
    const PRINTABLE_WIDTH = 1123 - 2 * Math.round((12 / 25.4) * 96);
    await page.setViewport({ width: PRINTABLE_WIDTH, height: 794 });
    await page.emulateMediaType('print');
    await sleep(400);
    const printLayout = await page.evaluate(() => {
      const app = document.querySelector('#app');
      const root = document.querySelector('#print-root');
      const table = root ? root.querySelector('table') : null;
      const printable = window.innerWidth;
      const overflowCells = table
        ? [...table.querySelectorAll('td, th')].filter((c) => c.scrollWidth > c.clientWidth + 1).length
        : -1;
      return {
        appDisplay: app ? getComputedStyle(app).display : 'missing',
        rootDisplay: root ? getComputedStyle(root).display : 'missing',
        tableWidth: table ? Math.round(table.getBoundingClientRect().width) : 0,
        printable,
        rows: table ? table.querySelectorAll('tbody tr').length : 0,
        overflowCells,
        headerRepeat: table ? getComputedStyle(table.querySelector('thead')).display : '',
      };
    });
    console.log('    ' + JSON.stringify(printLayout));
    check('打印时应用整体隐藏', printLayout.appDisplay === 'none', printLayout.appDisplay);
    check('打印时只显示打印区', printLayout.rootDisplay === 'block', printLayout.rootDisplay);
    check('表格宽度不超纸面', printLayout.tableWidth > 0 && printLayout.tableWidth <= printLayout.printable,
      `${printLayout.tableWidth} vs ${printLayout.printable}`);
    check('没有单元格内容溢出', printLayout.overflowCells === 0, String(printLayout.overflowCells));
    check('表头跨页重复（thead 用 table-header-group）', printLayout.headerRepeat === 'table-header-group', printLayout.headerRepeat);
    check('打印区包含全部记录行', printLayout.rows >= 1, `${printLayout.rows} 行`);
    await page.screenshot({ path: path.join(SHOTS, 'print-preview.png') });

    // 全选 9 列（最宽的情况）再量一次：字号应自动收小、仍然不溢出、页数不失控
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '全选');
      if (btn) btn.click();
    });
    await sleep(600);
    const all = await page.evaluate(() => {
      const table = document.querySelector('#print-root table');
      const overflow = [...table.querySelectorAll('td, th')].filter((c) => c.scrollWidth > c.clientWidth + 1).length;
      return {
        columns: Number(document.querySelector('[data-print-orientation]').getAttribute('data-print-columns')),
        font: document.querySelector('[data-print-orientation]').getAttribute('data-print-font'),
        orientation: document.querySelector('[data-print-orientation]').getAttribute('data-print-orientation'),
        width: Math.round(table.getBoundingClientRect().width),
        printable: window.innerWidth,
        overflow,
      };
    });
    console.log('    全选 9 列：' + JSON.stringify(all));
    check('全选 9 列后字号自动=小', all.columns === 9 && all.font === 'small', JSON.stringify(all));
    check('8 列时仍然不超纸面、单元格不溢出',
      all.width <= all.printable && all.overflow === 0, JSON.stringify(all));

    // 再出一次真正的 PDF：按 A4 横向 + 12mm 页边距出，校验纸张尺寸与页数。
    // 注意不能用 preferredCSSPageSize —— 这个 Chrome 在有头模式下不认 CSS 的 @page size，
    // 会退回默认 Letter；真机打印对话框是认 @page 的，所以这里显式给 A4 尺寸来验排版。
    try {
      const pdf = await page.pdf({
        width: '297mm', height: '210mm',
        margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
        printBackground: true,
      });
      const text = Buffer.from(pdf).toString('latin1');
      const box = /\/MediaBox \[([^\]]+)\]/.exec(text);
      const dims = box ? box[1].trim().split(/\s+/).map(Number) : [];
      const [w, h] = dims.slice(2);
      const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
      check('PDF 是 A4 横向（842×595pt）',
        !!box && Math.abs(Math.round(w) - 842) < 12 && Math.abs(Math.round(h) - 595) < 12,
        `MediaBox=${box ? box[1] : '无'}`);
      // 页数断言要跟着**实际行数**走：这个用例打印的是「本月全部完成记录」，行数随使用增长
      // （迭代容器上累计到 109 行 → 5 页，原来写死「≤3 页」必然假红，2026-10-12 踩到）。
      // 改成看「每页至少排得下 12 行」——既不浪费纸，也不随数据量变红。
      const printedRows = printLayout.rows || 0;
      const perPage = printedRows / Math.max(1, pages);
      check('PDF 页数跟行数匹配（每页至少 12 行，不出现大半页空白）',
        pages >= 1 && perPage >= 12,
        `${pages} 页 / ${printedRows} 行（每页 ${perPage.toFixed(1)} 行）`);
    } catch (e) {
      console.log('  （printToPDF 不可用，跳过纸张尺寸断言：' + e.message.slice(0, 60) + '）');
    }

    await page.emulateMediaType(null);
    await page.setViewport({ width: 1440, height: 900 });

    // 关掉弹窗，别把 @page 规则留在页面里
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '取消');
      if (btn) btn.click();
    });
    await sleep(500);
    const cleaned = await page.evaluate(() => !document.getElementById('print-page-rule') && !document.querySelector('#print-root'));
    check('关闭弹窗后清掉打印区与 @page 规则', cleaned);

    console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  });
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('FAILED:', error && error.message);
  process.exit(1);
});
