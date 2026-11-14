/** 系统清单二级菜单（用户 2026-11-14）：已完成下方、展开/收起、角标汇总、新消息点。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const api = (page, p) => page.evaluate(async ({ base, p }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { headers: { Authorization: 'Bearer ' + token } });
  return (await res.json().catch(() => null))?.data || {};
}, { base: BASE, p });
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.evaluate(() => localStorage.removeItem('ui_rail_collapsed'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const shape = await page.evaluate(() => {
      const sys = document.querySelector('[data-nav-system]');
      const menu = document.querySelector('[data-nav-system-menu]');
      const completed = [...document.querySelectorAll('a[href="/admin/completed"]')][0];
      const items = [...document.querySelectorAll('[data-nav-system-item]')].map((el) => ({
        key: el.getAttribute('data-nav-system-item'),
        label: (el.querySelector('.flex-1')?.textContent || '').trim(),
        count: Number((el.querySelector('.nav-count')?.textContent || '0').trim()) || 0,
      }));
      return {
        sys: !!sys,
        menu: !!menu,
        menuVisible: !!menu && menu.offsetParent !== null,
        afterCompleted: !!(completed && sys && (completed.compareDocumentPosition(sys) & Node.DOCUMENT_POSITION_FOLLOWING)),
        items,
        parentCount: Number((document.querySelector('[data-nav-system-count]')?.textContent || '0').trim()) || 0,
        unreadDot: !!document.querySelector('[data-nav-system-unread]'),
      };
    });
    const summary = await api(page, '/api/reminder/summary');
    check('「系统清单」按钮在「已完成」下面', shape.sys && shape.afterCompleted, JSON.stringify(shape));
    check('默认收起', shape.menu && shape.menuVisible === false, JSON.stringify(shape));
    check('二级菜单包含系统栏目', ['cards', 'notebook', 'ceremony', 'nudges'].every((k) => shape.items.some((i) => i.key === k)) || shape.items.length >= 3, JSON.stringify(shape.items));
    check('父行角标等于子项角标合计', shape.parentCount === shape.items.reduce((s, i) => s + i.count, 0), JSON.stringify(shape));
    const unread = Number(summary.unread || 0) > 0;
    check('新消息点随未读通知出现', shape.unreadDot === unread, JSON.stringify({ unread, dot: shape.unreadDot }));

    await page.evaluate(() => document.querySelector('[data-nav-system]')?.click());
    await sleep(350);
    const opened = await page.evaluate(() => ({
      visible: document.querySelector('[data-nav-system-menu]')?.offsetParent !== null,
      expanded: document.querySelector('[data-nav-system]')?.getAttribute('aria-expanded'),
      items: [...document.querySelectorAll('[data-nav-system-item]')].map((el) => ({ key: el.getAttribute('data-nav-system-item'), visible: el.offsetParent !== null })),
    }));
    check('点击后展开所有系统栏目', opened.visible === true && opened.expanded === 'true', JSON.stringify(opened));
    check('展开后子项可见', opened.items.length > 0 && opened.items.every((i) => i.visible), JSON.stringify(opened.items));

    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await sleep(300);
    check('点击其他地方自动收起', await page.evaluate(() => document.querySelector('[data-nav-system-menu]')?.offsetParent === null));

    await page.evaluate(() => document.querySelector('[data-nav-system]')?.click());
    await sleep(250);
    const cards = await page.evaluate(() => {
      const el = document.querySelector('[data-nav-cards]');
      el?.click();
      return el?.getAttribute('href') || '';
    });
    await sleep(900);
    const after = await page.evaluate(() => ({ path: location.pathname, menuOpen: document.querySelector('[data-nav-system-menu]')?.offsetParent !== null }));
    check('点系统栏目能进入页面并自动收起', !!cards && after.path === cards && after.menuOpen === false, JSON.stringify({ cards, after }));
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
