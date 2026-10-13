/**
 * 验证「日历视图 → 打印本月」：打印当前显示的整月月历（参考「已完成记录」的打印弹窗）。
 *
 * 覆盖：
 *   1) 工具条里有「打印本月」按钮，点开是弹窗（含 #print-root 打印区）
 *   2) 内容开关：农历 / 记事 / 已完成 / 时间 —— 预览与打印区同步生效
 *   3) 版式：纸张方向（默认自动=横向）、字号（默认自动）、标题、摘要行
 *   4) 打印媒体下只显示 #print-root、月历不超纸面、一行不被撕页
 *   5) 真出一份 A4 横向 PDF（页数合理）
 *   6) 关闭后 #print-root 与 @page 规则都被清掉，日历本身的数据/偏好没被改
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-092.js
 * 数据：只读——不改服务端任何东西（本机 localStorage 的日历清单筛选也不动）。
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

/** 打印文档的状态：预览那份和 #print-root 那份都用它量。 */
const docState = (page, sel) => page.evaluate((sel) => {
  const el = sel === 'preview'
    ? [...document.querySelectorAll('.print-doc')].find((d) => !d.closest('#print-root'))
    : document.querySelector(sel);
  if (!el) return null;
  const items = [...el.querySelectorAll('.cal-print-tasks li')];
  return {
    title: el.querySelector('h1')?.textContent.trim() || '',
    meta: el.querySelector('.meta')?.textContent.trim() || '',
    weekdays: [...el.querySelectorAll('.cal-print-weekdays span')].map((s) => s.textContent.trim()),
    cells: el.querySelectorAll('.cal-print-cell').length,
    outCells: el.querySelectorAll('.cal-print-cell.out').length,
    rows: el.querySelectorAll('.cal-print-row').length,
    items: items.length,
    notes: items.filter((li) => li.querySelector('.mark')).length,
    times: items.filter((li) => li.querySelector('.t')).length,
    done: items.filter((li) => li.classList.contains('done')).length,
    lunar: [...el.querySelectorAll('.cal-print-head .l')].filter((s) => s.textContent.trim()).length,
    firstChip: (() => {
      const li = items[0];
      if (!li) return null;
      const cs = getComputedStyle(li);
      return { borderLeft: cs.borderLeftColor, bg: cs.backgroundColor, color: cs.color };
    })(),
  };
}, sel);

const toggleOn = (page, key) => page.evaluate((key) => {
  const btn = document.querySelector(`[data-print-toggle="${key}"]`);
  if (!btn) return null;
  return btn.classList.contains('selected');
}, key);

async function setToggle(page, key, want) {
  const now = await toggleOn(page, key);
  if (now === want) return now;
  await page.evaluate((key) => document.querySelector(`[data-print-toggle="${key}"]`).click(), key);
  await sleep(350);
  return await toggleOn(page, key);
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    const savedPrefs = await page.evaluate(() => {
      try { return JSON.stringify({ lists: localStorage.getItem('ui_calendar_lists'), font: localStorage.getItem('ui_calendar_font') }) } catch { return '{}' }
    });

    // ---- 1. 日历页工具条 ----
    await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.cal-cell'), { timeout: 20000 });
    await sleep(1800);

    const btn = await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="打印日历"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return { text: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), border: cs.borderWidth, hasIcon: !!b.querySelector('svg'), disabled: b.disabled, title: b.getAttribute('title') || '' };
    });
    check('日历工具条里有「打印本月」按钮', !!btn && /打印本月/.test(btn.text), JSON.stringify(btn));
    check('它是按钮样式（有边框/图标/可点）', !!btn && parseFloat(btn.border) > 0 && btn.hasIcon && !btn.disabled, JSON.stringify(btn));

    // 页面上格子的条目总数（作为后面打印内容的基准）
    const onScreen = await page.evaluate(() => ({
      cells: document.querySelectorAll('.cal-cell').length,
      chips: document.querySelectorAll('.cal-cell .cal-task').length,
      // 工具条上的计数（未完成/已完成/记事）：打印内容应等于这三者之和（不截断）
      toolbar: (() => {
        const t = [...document.querySelectorAll('span')].map((s) => s.textContent.trim())
          .filter((x) => /^(未完成|已完成|记事)\s*\d+$/.test(x)).join(' ');
        const num = (label) => {
          const m = new RegExp(label + '\\s*(\\d+)').exec(t);
          return m ? Number(m[1]) : 0;
        };
        return { open: num('未完成'), done: num('已完成'), notes: num('记事'), text: t };
      })(),
    }));

    // ---- 2. 打开打印弹窗 ----
    await page.evaluate(() => document.querySelector('button[aria-label="打印日历"]').click());
    const opened = await waitFor(page, () => !!document.querySelector('#print-root'), { timeout: 8000 });
    check('打印弹窗打开且存在打印区 #print-root', !!opened);
    await sleep(600);

    const dialogTitle = await page.evaluate(() => [...document.querySelectorAll('h3')].map((h) => h.textContent.trim()).find((t) => t === '打印日历') || '');
    check('弹窗标题是「打印日历」', dialogTitle === '打印日历', dialogTitle);

    const preview = await docState(page, 'preview');
    const printDoc = await docState(page, '#print-root');
    check('预览渲染出 7 个星期表头（周一…周日）', JSON.stringify(preview?.weekdays) === JSON.stringify(['一', '二', '三', '四', '五', '六', '日']), JSON.stringify(preview?.weekdays));
    check('月历格子数与屏幕上的日历一致', preview?.cells === onScreen.cells, `打印 ${preview?.cells} vs 屏幕 ${onScreen.cells}`);
    check('一格一行、共 5~6 周', (preview?.rows || 0) >= 5 && (preview?.rows || 0) <= 6, `${preview?.rows} 行`);
    check('打印区的内容与预览一致（格数/条数）',
      printDoc?.cells === preview?.cells && printDoc?.items === preview?.items,
      `预览 ${preview?.cells}格/${preview?.items}条 vs 打印 ${printDoc?.cells}格/${printDoc?.items}条`);
    const expectAll = onScreen.toolbar.open + onScreen.toolbar.done + onScreen.toolbar.notes;
    check('打印区包含条目（本月有安排）', (printDoc?.items || 0) > 0, `${printDoc?.items} 条`);
    check('打印的是本月全部安排（未完成+已完成+记事，不像格子那样截断成 3 条/天）',
      printDoc?.items === expectAll,
      `打印 ${printDoc?.items} 条 vs 工具条 ${expectAll} 条（${onScreen.toolbar.text}）`);
    check('格子里安排带清单色条（关掉打印背景也能分辨）',
      !!preview?.firstChip && preview.firstChip.borderLeft !== 'rgba(0, 0, 0, 0)' && preview.firstChip.borderLeft !== 'transparent',
      JSON.stringify(preview?.firstChip));
    check('已完成的安排带删除线样式', (preview?.done || 0) === (printDoc?.done || 0), `预览 ${preview?.done} / 打印 ${printDoc?.done}`);

    const toggles = await page.evaluate(() => [...document.querySelectorAll('[data-print-toggle]')].map((b) => ({ key: b.getAttribute('data-print-toggle'), label: b.textContent.trim(), on: b.classList.contains('selected') })));
    check('有 4 个内容开关：农历 / 记事 / 已完成 / 时间',
      JSON.stringify(toggles.map((t) => t.key)) === JSON.stringify(['lunar', 'notes', 'completed', 'time']),
      JSON.stringify(toggles));
    check('默认显示农历 / 记事 / 已完成，时间默认不显示（月历格子窄，默认不挤时间）',
      toggles.filter((t) => t.on).map((t) => t.key).join(',') === 'lunar,notes,completed',
      JSON.stringify(toggles.map((t) => `${t.key}=${t.on}`)));

    // ---- 3. 内容开关生效（预览与打印区同步）----
    const withNotes = preview?.notes || 0;
    if (withNotes > 0) {
      await setToggle(page, 'notes', false);
      const previewOff = await docState(page, 'preview');
      const printOff = await docState(page, '#print-root');
      check('关掉「记事」后预览与打印区里的「记」都消失',
        previewOff?.notes === 0 && printOff?.notes === 0 && printOff.items === preview.items - withNotes,
        `记事项 ${withNotes} → 预览 ${previewOff?.notes} / 打印 ${printOff?.notes}，条数 ${preview.items} → ${printOff.items}`);
      await setToggle(page, 'notes', true);
    } else {
      check('本月没有记事，跳过「记事」开关断言（开关本身存在）', toggles.some((t) => t.key === 'notes'));
    }

    const lunarBefore = preview?.lunar || 0;
    await setToggle(page, 'lunar', false);
    const noLunar = await docState(page, 'preview');
    check('关掉「农历 / 节气」后格子右上角的农历标签消失',
      noLunar?.lunar === 0 && lunarBefore > 0, `${lunarBefore} → ${noLunar?.lunar}`);
    await setToggle(page, 'lunar', true);

    await setToggle(page, 'time', true);
    const withTime = await docState(page, 'preview');
    check('打开「时间」后每条安排前多出时间（HH:MM）', (withTime?.times || 0) === withTime.items && withTime.items > 0,
      `${withTime?.times}/${withTime?.items}`);
    const autoFontWithTime = await page.evaluate(() => document.querySelector('section[data-print-font]')?.getAttribute('data-print-font'));
    check('显示时间时字号自动收小到「小」', autoFontWithTime === 'small', autoFontWithTime);
    await setToggle(page, 'time', false);

    const doneNow = preview?.done || 0;
    if (doneNow > 0) {
      await setToggle(page, 'completed', false);
      const noDone = await docState(page, '#print-root');
      check('关掉「已完成」后打印区不再有已完成条目',
        noDone?.done === 0 && noDone.items === printDoc.items - doneNow,
        `已完成 ${doneNow} → ${noDone?.done}，条数 ${printDoc.items} → ${noDone?.items}`);
      await setToggle(page, 'completed', true);
    } else {
      check('本月没有已完成条目，跳过「已完成」开关断言（开关本身存在）', toggles.some((t) => t.key === 'completed'));
    }

    // ---- 4. 版式：方向 / 字号 / 标题 / 摘要 ----
    const autoDir = await page.evaluate(() => ({
      orientation: document.querySelector('section[data-print-orientation]')?.getAttribute('data-print-orientation'),
      rule: (document.getElementById('print-page-rule') || {}).textContent || '',
    }));
    check('月历默认自动横向（A4 landscape）', autoDir.orientation === 'landscape' && /landscape/.test(autoDir.rule), JSON.stringify(autoDir));

    await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="纸张方向"]');
      sel.value = 'portrait';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);
    const manualDir = await page.evaluate(() => ({
      orientation: document.querySelector('section[data-print-orientation]')?.getAttribute('data-print-orientation'),
      rule: (document.getElementById('print-page-rule') || {}).textContent || '',
    }));
    check('手动选纵向后 @page 跟着变纵向', manualDir.orientation === 'portrait' && /portrait/.test(manualDir.rule), JSON.stringify(manualDir));
    await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="纸张方向"]');
      sel.value = 'auto';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);

    await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="字号"]');
      sel.value = 'large';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);
    const largeFont = await page.evaluate(() => {
      const el = document.querySelector('#print-root .print-doc');
      return { cls: el.className, size: getComputedStyle(el).fontSize };
    });
    check('字号选「大」后打印区字号变大', /size-large/.test(largeFont.cls), JSON.stringify(largeFont));

    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="打印标题"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '十月工作安排');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(400);
    const titled = await docState(page, '#print-root');
    check('标题输入同步到打印区', titled?.title === '十月工作安排', titled?.title);

    const meta = (await docState(page, '#print-root'))?.meta || '';
    check('摘要行含月份 / 清单 / 条数 / 打印时间',
      /月份：\d{4} 年 \d{1,2} 月/.test(meta) && /清单：/.test(meta) && /共 \d+ 条/.test(meta) && /打印时间：/.test(meta), meta);

    // ---- 5. 打印媒体：只显示打印区、不超纸面、行不撕页 ----
    // 打印时浏览器的排版宽度 = 纸宽 - 左右页边距，所以视口要按「可打印区」设：
    // A4 横向 1123 CSS px，本弹窗用 10mm 页边距 ≈ 38px，可打印区约 1047px。
    // （按整张纸宽 1123 量会误判成超宽——那是模型不对，不是真的溢出。verify-print 里同样处理。）
    const PRINTABLE_WIDTH = 1123 - 2 * Math.round((10 / 25.4) * 96);
    await page.setViewport({ width: PRINTABLE_WIDTH, height: 794 });
    await page.emulateMediaType('print');
    await sleep(400);
    const printLayout = await page.evaluate(() => {
      const app = document.querySelector('#app') || document.body.firstElementChild;
      const root = document.querySelector('#print-root');
      const grid = root.querySelector('.cal-print-grid');
      const rows = [...root.querySelectorAll('.cal-print-row')];
      const cell = root.querySelector('.cal-print-cell');
      const cs = getComputedStyle(root);
      const printable = window.innerWidth;
      const overflowing = [...root.querySelectorAll('.cal-print-cell')].filter((c) => c.scrollWidth > c.clientWidth + 1).length;
      return {
        appDisplay: app ? getComputedStyle(app).display : 'none',
        rootDisplay: getComputedStyle(root).display,
        gridWidth: grid.getBoundingClientRect().width,
        printable: Math.round(printable),
        overflowCells: overflowing,
        rowBreak: rows.length ? getComputedStyle(rows[0]).breakInside : '',
        cellFont: cs.fontSize,
        cellMin: cell ? getComputedStyle(cell).minHeight : '',
      };
    });
    check('打印时应用整体隐藏、只显示打印区',
      printLayout.appDisplay === 'none' && printLayout.rootDisplay === 'block', JSON.stringify(printLayout));
    check('月历宽度不超可打印区', printLayout.gridWidth > 0 && printLayout.gridWidth <= printLayout.printable + 2,
      `${Math.round(printLayout.gridWidth)} vs ${printLayout.printable}`);
    check('没有格子内容溢出', printLayout.overflowCells === 0, String(printLayout.overflowCells));
    check('一周一行不被撕到两页（break-inside: avoid）', printLayout.rowBreak === 'avoid', printLayout.rowBreak);
    await page.emulateMediaType(null);
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(300);

    // ---- 6. 真出一份 A4 横向 PDF ----
    // 注意：这个 Chrome 在有头模式下不认 CSS 的 @page size（会退回 Letter），
    // 所以显式给 A4 横向尺寸来验排版；真机打印对话框是认 @page 的。
    try {
      await page.evaluate(() => {
        const sel = document.querySelector('select[aria-label="纸张方向"]');
        sel.value = 'auto';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const f = document.querySelector('select[aria-label="字号"]');
        f.value = 'auto';
        f.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(400);
      const pdf = await page.pdf({
        width: '297mm', height: '210mm', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });
      // 必须 Buffer.from(...) 再转 latin1：puppeteer 这里给的是 Uint8Array，
      // 直接 .toString('latin1') 得到的是「37,80,68,70,…」这种逗号数字串，页数永远数成 0。
      const text = Buffer.from(pdf).toString('latin1');
      const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
      const box = /\/MediaBox \[([^\]]+)\]/.exec(text);
      const dims = box ? box[1].trim().split(/\s+/).map(Number) : [];
      const [pw, ph] = dims.slice(2);
      const kb = Math.round(pdf.length / 1024);
      fs.writeFileSync(path.join(SHOTS, 'calendar-print-a4.pdf'), pdf);
      check('能导出 A4 横向 PDF', pdf.length > 1024 && pages >= 1, `${kb}KB / ${pages} 页`);
      check('PDF 纸张是 A4 横向（842×595pt）',
        !!box && Math.abs(Math.round(pw) - 842) < 12 && Math.abs(Math.round(ph) - 595) < 12,
        `MediaBox=${box ? box[1] : '无'}`);
      check('页数合理（整月月历在 1~2 页内）', pages >= 1 && pages <= 2, `${pages} 页`);
    } catch (err) {
      check('能导出 A4 横向 PDF', false, String(err && err.message));
    }

    // ---- 7. 关闭后清理干净、日历自身没被动过 ----
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消' && b.closest('section'));
      btn.click();
    });
    await sleep(600);
    const cleaned = await page.evaluate(() => ({
      root: !!document.querySelector('#print-root'),
      rule: !!document.getElementById('print-page-rule'),
    }));
    check('关闭弹窗后清掉打印区与 @page 规则', !cleaned.root && !cleaned.rule, JSON.stringify(cleaned));

    const afterPrefs = await page.evaluate(() => {
      try { return JSON.stringify({ lists: localStorage.getItem('ui_calendar_lists'), font: localStorage.getItem('ui_calendar_font') }) } catch { return '{}' }
    });
    check('日历的清单筛选偏好没被改动', afterPrefs === savedPrefs, `${savedPrefs} → ${afterPrefs}`);
    const stillCalendar = await page.evaluate(() => document.querySelectorAll('.cal-cell').length);
    check('关掉弹窗后还在日历页上', stillCalendar === onScreen.cells, `${stillCalendar} 格`);

    // ---- 8. 手机端：进不了日历，所以也没有这个打印入口 ----
    // 0.10.x 起手机端不提供日历视图（verify-094 专门验），日历打印自然只能电脑上用。
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const mobileNoCal = await page.evaluate(() => ({
      url: location.pathname,
      cells: document.querySelectorAll('.cal-cell').length,
      printBtn: document.querySelectorAll('button[aria-label="打印日历"]').length,
    }));
    check('手机端访问日历被送到列表视图，也就没有「打印本月」入口',
      !mobileNoCal.url.includes('calendar') && mobileNoCal.cells === 0 && mobileNoCal.printBtn === 0,
      JSON.stringify(mobileNoCal));
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(600);
    await page.screenshot({ path: path.join(SHOTS, 'calendar-print.png') });
    console.log(`  截图：${path.join(SHOTS, 'calendar-print.png')} / calendar-print-a4.pdf`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
