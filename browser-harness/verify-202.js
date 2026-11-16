/** 列表/日历切换移到全局右上角铃铛左边，并使用同一组 icon-button 风格。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const state = (page) => page.evaluate(() => {
  const group = document.querySelector('[data-view-switch]');
  const bell = document.querySelector('[data-notification-bell]');
  const links = group ? [...group.querySelectorAll('a')] : [];
  return {
    group: !!group,
    beforeBell: !!group && !!bell && group.nextElementSibling === bell,
    aria: group?.getAttribute('aria-label') || '',
    titles: links.map((a) => a.getAttribute('title')),
    iconButtons: links.every((a) => a.classList.contains('icon-button')),
    iconSize: links.map((a) => { const s = a.querySelector('svg'); return s ? [Math.round(s.getBoundingClientRect().width), Math.round(s.getBoundingClientRect().height)] : null; }),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1360, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(1400);
    const desktop = await state(page);
    check('右上角有列表/日历切换组', desktop.group && desktop.aria === '切换列表或日历视图', JSON.stringify(desktop));
    check('切换组紧挨在铃铛左边', desktop.beforeBell, JSON.stringify(desktop));
    check('两个按钮都使用统一的 icon-button 与 20px 线性图标',
      desktop.iconButtons && desktop.titles.join(',') === '列表视图,日历视图'
        && desktop.iconSize.every((s) => s && s[0] === 20 && s[1] === 20), JSON.stringify(desktop));
    check('桌面不横向溢出', !desktop.overflow, String(desktop.overflow));

    await page.click('[title="日历视图"]');
    await sleep(1200);
    check('点日历进入日历视图', await page.evaluate(() => location.pathname === '/admin/calendar'), await page.evaluate(() => location.pathname));
    await page.click('[title="列表视图"]');
    await sleep(1200);
    check('点列表回到列表视图', await page.evaluate(() => location.pathname === '/admin'), await page.evaluate(() => location.pathname));

    await page.setViewport({ width: 390, height: 844 });
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    check('手机端隐藏切换组（手机没有日历视图）', !(await page.$('[data-view-switch]')));
  }, { width: 1360, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
