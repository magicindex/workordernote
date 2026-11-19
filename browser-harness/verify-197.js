/** 手机登录后第一页按「手机栏目」偏好（这里固定成首页）；深色首页顶栏深色、文字浅色。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return await res.json().catch(() => null);
}, { base: BASE, p, method, body });
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await login(page, BASE);
    const cfg = (await api(page, '/api/configs')).data || {};
    const originalDefault = String(cfg.default_view || 'home');
    const originalTheme = String(cfg.theme_mode || 'system');
    const originalMobileHome = String(cfg.mobile_home_view || 'home');
    try {
      // 默认视图故意设成「列表」，手机登录仍必须落到首页
      await api(page, '/api/configs', 'PUT', { key: 'default_view', value: 'list' });
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: 'dark' });
      // 0.48.4 起手机首屏按「手机栏目 → 打开先显示」走；这里把它固定成首页再验
      // 「电脑端默认=列表 不影响手机首屏」这条老约定，跑完还原用户自己的选择。
      await api(page, '/api/configs', 'PUT', { key: 'mobile_home_view', value: 'home' });
      await page.evaluate(() => localStorage.setItem('reminder-theme-mode', 'dark'));
      // 登录后直接打开 /admin；手机端 MainLayout 会按 'mobile' 规则落首页。
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await sleep(2600);
      const landed = await page.evaluate(() => ({
        path: location.pathname,
        dashboard: !!document.querySelector('[data-home-dashboard]'),
        tab: (document.querySelector('.mobile-tab.active small')?.textContent || '').trim(),
      }));
      check('手机登录后第一页固定是首页', landed.path === '/admin/home' && landed.dashboard, JSON.stringify(landed));
      check('底部「首页」标签保持选中', landed.tab === '首页', landed.tab);

      const top = await page.evaluate(() => {
        const bar = document.querySelector('.topbar');
        const cs = bar ? getComputedStyle(bar) : null;
        const h2 = bar?.querySelector('h2');
        const tab = document.querySelector('.mobile-tabbar');
        const ts = tab ? getComputedStyle(tab) : null;
        return { bg: cs?.backgroundColor || '', color: h2 ? getComputedStyle(h2).color : '', tabBg: ts?.backgroundColor || '' };
      });
      check('深色首页顶栏是深色底、浅色字', /rgba?\((?:[0-9]|[0-9]{2}), (?:[0-9]|[0-9]{2}), (?:[0-9]|[0-9]{2})/.test(top.bg)
        && /rgb\((?:2[0-9]{2}), (?:2[0-9]{2}), (?:2[0-9]{2})\)/.test(top.color), JSON.stringify(top));
      check('手机底栏也是深色', /rgba?\(17, 24, 39/.test(top.tabBg), JSON.stringify(top));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'default_view', value: originalDefault });
      await api(page, '/api/configs', 'PUT', { key: 'theme_mode', value: originalTheme });
      await api(page, '/api/configs', 'PUT', { key: 'mobile_home_view', value: originalMobileHome });
      await page.evaluate((m) => localStorage.setItem('reminder-theme-mode', m), originalTheme);
    }
  }, { width: 390, height: 844 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
