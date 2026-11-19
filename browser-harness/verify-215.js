/**
 * 偏好设置「手机 → 手机栏目」（用户 2026-11-19）：
 *
 *   「增加首页初始页面选择以及底部导航顺序自定义，底部导航顺序支持拖拽调整并持久化保存。
 *     栏目配置支持恢复默认值，并提供预览确认后生效」
 *
 * 钉住这几条：
 *   1. 手机 tab 里有「手机栏目」面板：5 个栏目的顺序行 + 「打开先显示」单选；
 *   2. 拖拽把手能改顺序；
 *   3. 「恢复默认值」把草稿恢复到 首页 / 计划 / 清单 / 待办 / 提醒 + 首屏首页；
 *   4. 预览弹窗按草稿画底栏；**取消不保存**；
 *   5. 「确认并生效」后：页面底栏顺序立刻变、配置落库、刷新页仍保持；
 *   6. 「打开先显示=计划」后，手机冷启动 /admin 直接落 /admin/planned（不再固定首页）；
 *   7. 再恢复默认并确认：底栏与原顺序、冷启动回到 /admin/home；
 *   8. 收尾把两个配置键还原（登录辅助还会还原 default_view）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-215.js
 */
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const DEFAULT_ORDER = ['home', 'planned', 'lists', 'today', 'nudges'];
const DEFAULT_HOME = 'home';

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await res.json().catch(() => null);
}, { base: BASE, p, method, body });

const readConfigs = async (page) => ((await api(page, '/api/configs')) || {}).data || {};
const rowKeys = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-mobile-nav-row]'))
  .map((el) => el.getAttribute('data-mobile-nav-row')));
const barKeys = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.mobile-tabbar .mobile-tab'))
  .map((el) => el.getAttribute('data-mobile-tab') || (el.hasAttribute('data-tab-lists') ? 'lists' : '')));
const previewBarKeys = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-mobile-nav-preview-tab]'))
  .map((el) => el.getAttribute('data-mobile-nav-preview-tab')));

async function openMobilePrefs(page) {
  await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' }).catch(() => {});
  // 设置页先渲染骨架、再拉配置；等「手机」这个 tab 真的出来再点。
  await waitFor(page, () => !!document.querySelector('[data-settings-tab="mobile"]'), { timeout: 15000 }).catch(() => {});
  await sleep(700);
  await page.evaluate(() => document.querySelector('[data-settings-tab="mobile"]')?.click());
  await waitFor(page, () => !!document.querySelector('[data-mobile-nav-prefs]'), { timeout: 8000 }).catch(() => {});
  await sleep(300);
  await page.evaluate(() => document.querySelector('[data-mobile-nav-prefs]')?.scrollIntoView({ block: 'center' }));
  await sleep(250);
}

/** 用 ↑ 把某个栏目挪到目标下标（更稳、也覆盖键盘/点按路径）。 */
async function moveRowTo(page, key, targetIndex) {
  for (let i = 0; i < 8; i += 1) {
    const keys = await rowKeys(page);
    const at = keys.indexOf(key);
    if (at === targetIndex || at < 0) return;
    const dir = at > targetIndex ? 'up' : 'down';
    await page.evaluate(({ key, dir }) => {
      document.querySelector(`[data-mobile-nav-${dir}="${key}"]`)?.click();
    }, { key, dir });
    await sleep(180);
  }
}

/** 按住把手上下拖：返回拖拽前后的顺序，确认指针拖拽这条路真的能改。 */
async function dragRow(page, key, steps) {
  const before = await rowKeys(page);
  const rowCount = before.length;
  const geo = await page.evaluate((key) => {
    const handle = document.querySelector(`[data-mobile-nav-handle="${key}"]`);
    const rows = document.querySelectorAll('[data-mobile-nav-row]');
    if (!handle || !rows.length) return null;
    const hr = handle.getBoundingClientRect();
    const r0 = rows[0].getBoundingClientRect();
    return { x: hr.left + hr.width / 2, y: hr.top + hr.height / 2, step: r0.height + 6 };
  }, key);
  if (!geo) return { before, after: before };
  const from = before.indexOf(key);
  const to = Math.max(0, Math.min(rowCount - 1, from + steps));
  const dy = (to - from) * geo.step;
  await page.mouse.move(geo.x, geo.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(geo.x, geo.y + (dy * i) / 6);
    await sleep(60);
  }
  await page.mouse.up();
  await sleep(350);
  return { before, after: await rowKeys(page) };
}

async function openPreview(page) {
  await page.evaluate(() => document.querySelector('[data-mobile-nav-preview]')?.click());
  await sleep(500);
  return page.evaluate(() => !!document.querySelector('[data-mobile-nav-preview-modal]'));
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await login(page, BASE);

    const cfg = await readConfigs(page);
    const original = {
      mobile_tabs_order: cfg.mobile_tabs_order,
      mobile_home_view: cfg.mobile_home_view,
      nudge_enabled: cfg.nudge_enabled,
    };
    try {
      // 起点固定成默认值，后面断言才有确定答案
      await api(page, '/api/configs', 'PUT', { key: 'mobile_tabs_order', value: DEFAULT_ORDER.join(',') });
      await api(page, '/api/configs', 'PUT', { key: 'mobile_home_view', value: DEFAULT_HOME });
      await openMobilePrefs(page);

      // ---------------- 1. 面板与默认值 ----------------
      const panel = await page.evaluate(() => {
        const root = document.querySelector('[data-mobile-nav-prefs]');
        return {
          exists: !!root,
          visible: root ? root.getBoundingClientRect().height > 0 : false,
          rows: root ? root.querySelectorAll('[data-mobile-nav-row]').length : 0,
          homeSelected: root?.querySelector('[data-mobile-nav-home-view="home"]')?.getAttribute('aria-checked'),
        };
      });
      check('手机 tab 里有「手机栏目」面板', panel.exists && panel.visible, JSON.stringify(panel));
      check('默认 5 个栏目都在', panel.rows === 5, String(panel.rows));
      check('默认顺序是 首页 / 计划 / 清单 / 待办 / 提醒',
        JSON.stringify(await rowKeys(page)) === JSON.stringify(DEFAULT_ORDER), JSON.stringify(await rowKeys(page)));
      check('默认首屏选中「首页」', panel.homeSelected === 'true', String(panel.homeSelected));

      // ---------------- 2. 拖拽改顺序 ----------------
      const drag = await dragRow(page, 'nudges', -3);
      check('拖拽把手能改变顺序（提醒 从第 5 位拖到前面）',
        JSON.stringify(drag.before) !== JSON.stringify(drag.after) && drag.after.indexOf('nudges') < 3,
        JSON.stringify(drag));

      // ---------------- 3. 恢复默认值 ----------------
      await page.evaluate(() => document.querySelector('[data-mobile-nav-reset]')?.click());
      await sleep(300);
      check('「恢复默认值」把草稿恢复成默认顺序',
        JSON.stringify(await rowKeys(page)) === JSON.stringify(DEFAULT_ORDER), JSON.stringify(await rowKeys(page)));

      // ---------------- 4. 预览：顺序正确、取消不保存 ----------------
      // 先排一个确定的新顺序：提醒 → 首页 → 计划 → 清单 → 待办
      await moveRowTo(page, 'nudges', 0);
      await moveRowTo(page, 'home', 1);
      await moveRowTo(page, 'planned', 2);
      await moveRowTo(page, 'lists', 3);
      await moveRowTo(page, 'today', 4);
      const draftOrder = await rowKeys(page);
      const opened = await openPreview(page);
      check('预览弹窗能打开', opened === true, String(opened));
      check('预览底栏顺序与草稿一致', JSON.stringify(await previewBarKeys(page)) === JSON.stringify(draftOrder),
        JSON.stringify(await previewBarKeys(page)));
      await page.evaluate(() => document.querySelector('[data-mobile-nav-cancel]')?.click());
      await sleep(400);
      const afterCancel = await readConfigs(page);
      check('取消预览不保存（配置仍是默认顺序）',
        String(afterCancel.mobile_tabs_order || '') === DEFAULT_ORDER.join(','), String(afterCancel.mobile_tabs_order));
      check('取消后底栏也还是默认顺序', JSON.stringify(await barKeys(page)) === JSON.stringify(DEFAULT_ORDER),
        JSON.stringify(await barKeys(page)));

      // ---------------- 5. 确认后立刻生效 + 落库 + 刷新保持 ----------------
      await openPreview(page);
      await page.evaluate(() => document.querySelector('[data-mobile-nav-confirm]')?.click());
      await sleep(1200);
      const appliedBar = await barKeys(page);
      const appliedCfg = await readConfigs(page);
      check('确认后手机底栏顺序立刻生效', JSON.stringify(appliedBar) === JSON.stringify(draftOrder), JSON.stringify(appliedBar));
      check('顺序已保存到个人偏好',
        String(appliedCfg.mobile_tabs_order || '') === draftOrder.join(','), String(appliedCfg.mobile_tabs_order));
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(1800);
      check('刷新页面后底栏顺序仍保持', JSON.stringify(await barKeys(page)) === JSON.stringify(draftOrder),
        JSON.stringify(await barKeys(page)));

      // ---------------- 6. 打开先显示 = 计划 ----------------
      await openMobilePrefs(page);
      await page.evaluate(() => document.querySelector('[data-mobile-nav-home-view="planned"]')?.click());
      await sleep(250);
      await openPreview(page);
      const pvHome = await page.evaluate(() => ({
        home: document.querySelector('[data-mobile-nav-preview-home]')?.textContent?.trim(),
        tabHigh: document.querySelector('[data-mobile-nav-preview-tab="planned"]')?.className || '',
      }));
      check('预览里「打开先进入」是计划', pvHome.home === '计划', JSON.stringify(pvHome));
      await page.evaluate(() => document.querySelector('[data-mobile-nav-confirm]')?.click());
      await sleep(1200);
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(2200);
      const landed = await page.evaluate(() => ({
        path: location.pathname,
        active: (document.querySelector('.mobile-tab.active small')?.textContent || '').trim(),
        plannedPage: !!document.querySelector('.list-toolbar') || location.pathname === '/admin/planned',
      }));
      check('手机冷启动 /admin 落「计划」页', landed.path === '/admin/planned' && landed.plannedPage, JSON.stringify(landed));
      check('底栏高亮的是「计划」', landed.active === '计划', landed.active);

      // ---------------- 7. 恢复默认并确认：顺序 + 首屏都回来 ----------------
      await openMobilePrefs(page);
      await page.evaluate(() => document.querySelector('[data-mobile-nav-reset]')?.click());
      await sleep(300);
      check('恢复默认后首屏选中「首页」',
        (await page.evaluate(() => document.querySelector('[data-mobile-nav-home-view="home"]')?.getAttribute('aria-checked'))) === 'true',
        '未选中');
      await openPreview(page);
      await page.evaluate(() => document.querySelector('[data-mobile-nav-confirm]')?.click());
      await sleep(1200);
      const resetCfg = await readConfigs(page);
      check('恢复默认并确认后顺序回默认', String(resetCfg.mobile_tabs_order || '') === DEFAULT_ORDER.join(','),
        String(resetCfg.mobile_tabs_order));
      check('恢复默认并确认后首屏回首页看板', String(resetCfg.mobile_home_view || '') === DEFAULT_HOME,
        String(resetCfg.mobile_home_view));
      check('页面底栏也回到默认顺序', JSON.stringify(await barKeys(page)) === JSON.stringify(DEFAULT_ORDER),
        JSON.stringify(await barKeys(page)));
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(2200);
      const backHome = await page.evaluate(() => ({ path: location.pathname, dashboard: !!document.querySelector('[data-home-dashboard]') }));
      check('冷启动回到首页看板', backHome.path === '/admin/home' && backHome.dashboard, JSON.stringify(backHome));

      // ---------------- 8. 提醒@他关掉时，不提供「首屏=提醒@他」 ----------------
      const nudgeWas = String(original.nudge_enabled ?? 'true') !== 'false';
      if (nudgeWas) {
        await api(page, '/api/configs', 'PUT', { key: 'nudge_enabled', value: 'false' });
        await openMobilePrefs(page);
        const nudgeOption = await page.evaluate(() => !!document.querySelector('[data-mobile-nav-home-view="nudges"]'));
        check('关掉「提醒@他」后，首屏选项里没有它', nudgeOption === false, String(nudgeOption));
        const nudgesRow = await page.evaluate(() => document.querySelector('[data-mobile-nav-row="nudges"]')?.textContent || '');
        check('底栏顺序里仍保留这一行（开启后自动出现）', nudgesRow.includes('提醒'), nudgesRow.slice(0, 40));
        await api(page, '/api/configs', 'PUT', { key: 'nudge_enabled', value: 'true' });
      } else {
        console.log('  · 跳过「提醒@他」关闭态检查：原配置里它就是关的');
      }
    } finally {
      // 收尾：两个手机栏目键还原成进来的值（null/undefined 时写回默认）
      await api(page, '/api/configs', 'PUT', {
        key: 'mobile_tabs_order',
        value: original.mobile_tabs_order || DEFAULT_ORDER.join(','),
      });
      await api(page, '/api/configs', 'PUT', {
        key: 'mobile_home_view',
        value: original.mobile_home_view || DEFAULT_HOME,
      });
      if (original.nudge_enabled !== undefined && original.nudge_enabled !== null) {
        await api(page, '/api/configs', 'PUT', { key: 'nudge_enabled', value: String(original.nudge_enabled) });
      }
    }
  }, { width: 390, height: 844 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
