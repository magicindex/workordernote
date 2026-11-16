/** 日历格子边框：今天流光与外边框只留一条；选中/悬停不再叠 ring。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1360, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    const info = await page.evaluate(() => {
      const today = document.querySelector('[data-month-today-flow]')?.closest('.cal-cell');
      const flow = today?.querySelector('[data-month-today-flow]');
      const cells = [...document.querySelectorAll('.cal-cell')];
      const selected = cells.find((c) => c.getAttribute('data-cal-date') && c !== today && getComputedStyle(c).borderTopColor !== 'rgba(0, 0, 0, 0)');
      const norm = cells.find((c) => c !== today && c !== selected && !c.classList.contains('opacity-45'));
      const cs = (el) => el ? { bw: getComputedStyle(el).borderTopWidth, color: getComputedStyle(el).borderTopColor, shadow: getComputedStyle(el).boxShadow } : null;
      return {
        todayBorder: today ? getComputedStyle(today).borderTopWidth : '',
        todayHasFlow: !!flow,
        todayFlowRadius: flow ? parseFloat(getComputedStyle(flow).borderTopLeftRadius) : 0,
        selected: cs(selected),
        norm: cs(norm),
        ringClass: cells.some((c) => /\bring-/.test(c.className)),
      };
    });
    check('今天的格子外边框为 0（只留流光边）', info.todayBorder === '0px' && info.todayHasFlow, JSON.stringify(info));
    check('今天流光仍是圆角', info.todayFlowRadius > 0, JSON.stringify(info));
    check('选中态不加 ring / 不叠第二层边', !info.ringClass && info.selected && info.selected.shadow === 'none', JSON.stringify(info));
    check('普通格子保留 1px 边框', info.norm && info.norm.bw === '1px', JSON.stringify(info));

    // 悬停/选中都只改边框颜色或底色，不增加第二圈阴影
    const hoverCheck = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.cal-cell')].find((c) => !c.querySelector('[data-month-today-flow]'));
      if (!cell) return null;
      const before = getComputedStyle(cell).boxShadow;
      cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const after = getComputedStyle(cell).boxShadow;
      return { before, after, border: getComputedStyle(cell).borderTopWidth };
    });
    check('悬停不叠加 ring/阴影', hoverCheck && hoverCheck.before === 'none' && hoverCheck.after === 'none' && hoverCheck.border === '1px', JSON.stringify(hoverCheck));
  }, { width: 1360, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
