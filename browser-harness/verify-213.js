/**
 * 侧栏图标栏里的「系统清单」（用户 2026-11-16）：
 *   1) 图标旁边那个箭头不再显示（56px 宽里挤着图标很难看）；
 *   2) 点图标本身就能正常展开 —— 先把侧栏展开，再打开系统清单菜单。
 *      （图标栏里原地展开只会多出一列没有名字的图标，看着像「点了没反应」。）
 *
 * 只改浏览器本地的 ui_rail_collapsed，跑完还原。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const state = (page) => page.evaluate(() => {
  const aside = document.querySelector('.sidebar');
  const chev = document.querySelector('[data-nav-system-chevron]');
  const menu = document.querySelector('[data-nav-system-menu]');
  const labels = [...document.querySelectorAll('[data-nav-system-item] .flex-1')];
  return {
    rail: !!aside && aside.classList.contains('sidebar-rail'),
    chevron: chev ? getComputedStyle(chev).display : 'missing',
    menu: menu ? getComputedStyle(menu).display : 'missing',
    labels: labels.map((e) => ({ text: (e.textContent || '').trim(), display: getComputedStyle(e).display })),
  };
});

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, BASE);
    const before = await page.evaluate(() => localStorage.getItem('ui_rail_collapsed'));
    try {
      // ── 1. 图标栏：箭头不显示 ──
      await page.evaluate(() => localStorage.setItem('ui_rail_collapsed', '1'));
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      const rail = await state(page);
      check('侧栏是图标栏（sidebar-rail）', rail.rail === true, JSON.stringify(rail));
      check('图标栏里「系统清单」旁边的箭头不显示', rail.chevron === 'none', rail.chevron);
      check('图标栏里菜单默认是收起的', rail.menu === 'none', rail.menu);

      // ── 2. 点图标 → 侧栏展开 + 菜单打开、文字可见 ──
      await page.click('[data-nav-system]');
      await sleep(700);
      const opened = await state(page);
      check('点「系统清单」图标后侧栏展开（不再是图标栏）', opened.rail === false, JSON.stringify(opened));
      check('系统清单菜单打开', opened.menu !== 'none' && opened.menu !== 'missing', opened.menu);
      check('菜单里的文字看得见（不是一列没名字的图标）',
        opened.labels.length > 0 && opened.labels.every((l) => l.display !== 'none' && l.text.length > 0),
        JSON.stringify(opened.labels));
      check('箭头在展开态正常显示', opened.chevron !== 'none' && opened.chevron !== 'missing', opened.chevron);

      // ── 3. 日历视图（侧栏被临时收起）里同样能点开 ──
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(2000);
      const calRail = await state(page);
      check('日历视图侧栏临时收起时箭头也不显示', calRail.rail === true && calRail.chevron === 'none',
        JSON.stringify(calRail));
      await page.click('[data-nav-system]');
      await sleep(800);
      const calOpened = await state(page);
      check('日历视图里点图标也能展开侧栏并打开菜单',
        calOpened.rail === false && calOpened.menu !== 'none' && calOpened.menu !== 'missing',
        JSON.stringify(calOpened));
      await page.screenshot({ path: 'shots/verify-213-rail-system.png' });
    } finally {
      await page.evaluate((v) => {
        try { if (v === null) localStorage.removeItem('ui_rail_collapsed'); else localStorage.setItem('ui_rail_collapsed', v); } catch {}
      }, before);
    }
  }, { width: 1440, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
