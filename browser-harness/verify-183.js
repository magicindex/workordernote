/** 偏好设置 → 栏目：系统栏目可折叠进系统清单或放到我的清单（用户 2026-11-14）。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });
const readPlacement = async (page) => JSON.parse(String(((await api(page, '/api/configs')).body?.data || {}).system_list_placement || '{}'));
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await readPlacement(page);
    try {
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1400);
      await page.click('[data-settings-tab="modules"]');
      await sleep(500);
      const prefs = await page.evaluate(() => ({
        card: !!document.querySelector('[data-system-placement-prefs]'),
        rows: [...document.querySelectorAll('[data-system-placement-row]')].map((el) => ({
          key: el.getAttribute('data-system-placement-row'),
          select: !!el.querySelector('[data-system-placement-select]'),
          value: el.querySelector('[data-system-placement-select]')?.value || '',
        })),
      }));
      check('栏目页有「系统栏目放在哪里」设置', prefs.card && prefs.rows.length === 5, JSON.stringify(prefs));
      check('每个系统栏目都有位置选择', prefs.rows.every((r) => r.select && (r.value === 'system' || r.value === 'my')), JSON.stringify(prefs.rows));

      await page.evaluate(() => {
        const sel = document.querySelector('[data-system-placement-select="cards"]');
        if (!sel) return;
        sel.value = 'my';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(900);
      const saved = await readPlacement(page);
      check('信用卡账单设为我的清单后落库', saved.cards === 'my', JSON.stringify(saved));

      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await sleep(1400);
      const sidebar = await page.evaluate(() => {
        const sysMenu = document.querySelector('[data-nav-system-menu]');
        const independent = document.querySelector('[data-nav-independent-system="cards"]');
        return {
          independent: !!independent,
          independentInMyLists: !!independent?.closest('[data-nav-group="my-lists"]'),
          inSystemMenu: !!sysMenu?.querySelector('[data-nav-system-item="cards"]'),
          parent: !!document.querySelector('[data-nav-system]'),
        };
      });
      check('卡片栏目独立显示在「我的清单」', sidebar.independent && sidebar.independentInMyLists, JSON.stringify(sidebar));
      check('卡片栏目不再出现在「系统清单」菜单', sidebar.inSystemMenu === false, JSON.stringify(sidebar));
      check('系统清单父项仍保留（其它栏目还折叠）', sidebar.parent === true, JSON.stringify(sidebar));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'system_list_placement', value: JSON.stringify(original) });
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
