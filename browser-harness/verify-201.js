/** 全局右上角偏好设置入口：放在免打扰旁边，桌面/手机均可直达偏好设置。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
async function dismissAlert(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /知道了|关闭/.test(b.textContent || '') && b.getBoundingClientRect().width > 0)
    if (btn) btn.click()
  }).catch(() => {})
  await sleep(350)
}

const info = (page) => page.evaluate(() => {
  const pref = document.querySelector('[data-preferences-topbar]');
  const dnd = document.querySelector('[data-dnd-toggle]');
  return {
    exists: !!pref,
    tag: pref?.tagName || '',
    href: pref?.getAttribute('href') || '',
    title: pref?.getAttribute('title') || '',
    aria: pref?.getAttribute('aria-label') || '',
    afterDnd: !!pref && !!dnd && dnd.nextElementSibling === pref,
    visible: !!pref && pref.getBoundingClientRect().width > 0 && pref.getBoundingClientRect().height > 0,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1360, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1300);
    const desktop = await info(page);
    check('桌面右上角有偏好设置按钮', desktop.exists && desktop.visible && desktop.href === '/admin/settings', JSON.stringify(desktop));
    check('偏好设置紧挨着免打扰按钮（后一个兄弟）', desktop.afterDnd, JSON.stringify(desktop));
    check('按钮有无障碍名称', desktop.title === '偏好设置' && desktop.aria === '偏好设置', JSON.stringify(desktop));
    await dismissAlert(page);
    // 生产上可能正好有到点提醒弹窗盖住顶栏；用 DOM click 验证链接本身可直达。
    await page.evaluate(() => document.querySelector('[data-preferences-topbar]').click());
    await sleep(1200);
    check('点击直达偏好设置', await page.evaluate(() => location.pathname === '/admin/settings'), await page.evaluate(() => location.pathname));

    await page.setViewport({ width: 390, height: 844 });
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1300);
    const mobile = await info(page);
    check('手机右上角仍可见且不挤出屏幕', mobile.exists && mobile.visible && !mobile.overflow, JSON.stringify(mobile));
    await dismissAlert(page);
    await page.click('[data-preferences-topbar]');
    await sleep(1000);
    check('手机点击直达偏好设置', await page.evaluate(() => location.pathname === '/admin/settings'), await page.evaluate(() => location.pathname));
  }, { width: 1360, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
