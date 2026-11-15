/** 侧栏菜单项之间增加细分隔线（用户 2026-11-15）。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1301, height: 900 });
    await login(page, BASE);
    await page.evaluate(() => localStorage.removeItem('ui_rail_collapsed'));
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    const info = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.sidebar nav .nav-row')];
      const myRows = [...document.querySelectorAll('.sidebar nav [data-my-row]')];
      const after = (el) => el ? getComputedStyle(el, '::after') : null;
      return {
        smartCount: rows.length,
        smartBorder: rows[1] ? after(rows[1]).height + ' ' + after(rows[1]).backgroundColor + ' ' + after(rows[1]).display : '',
        lastSmartBorder: rows.length ? after(rows[rows.length - 1]).display : '',
        myCount: myRows.length,
        myBorder: myRows[0] ? after(myRows[0]).height + ' ' + after(myRows[0]).backgroundColor + ' ' + after(myRows[0]).display : '',
      };
    });
    check('菜单项之间有细分隔线', info.smartCount > 1 && info.smartBorder.startsWith('1px') && !/rgba\(0, 0, 0, 0\)/.test(info.smartBorder) && !info.smartBorder.endsWith('none'), JSON.stringify(info));
    check('我的清单行也有分隔线', info.myCount === 0 || (info.myBorder.startsWith('1px') && !/rgba\(0, 0, 0, 0\)/.test(info.myBorder) && !info.myBorder.endsWith('none')), JSON.stringify(info));
    await page.screenshot({ path: require('path').join(__dirname, 'shots', 'sidebar-separators.png') });
  }, { width: 1301, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
