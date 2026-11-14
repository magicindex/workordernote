/**
 * 两个个人偏好（用户 2026-11-14）：
 *   1) 「周起始日」从系统配置搬到偏好设置，每个用户自己选，日历跟着自己的值；
 *   2) 「AI 入口样式」可选顶栏星星 / 右下角悬浮球（桌面端），手机端始终顶栏星星。
 *
 * 收尾恢复原配置。
 * 用法：APP_URL=http://127.0.0.1:8906 node verify-168.js
 */
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, BASE);
    const cfg = (await api(page, '/api/configs')).body?.data || {};
    const originalWeek = String(cfg.calendar_week_start || 'monday');
    const originalStyle = String(cfg.assistant_entry_style || 'topbar');
    try {
      // ---------- 1. 设置位置：系统配置没有，偏好设置里有 ----------
      await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      const systemRows = await page.evaluate(() => ({
        week: !!document.querySelector('[data-config-key="calendar_week_start"]'),
        style: !!document.querySelector('[data-config-key="assistant_entry_style"]'),
      }));
      check('系统配置里不再有「周起始日」/「AI 入口样式」',
        !systemRows.week && !systemRows.style, JSON.stringify(systemRows));

      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      const prefRows = await page.evaluate(() => {
        const week = document.querySelector('[data-config-key="calendar_week_start"]');
        const style = document.querySelector('[data-config-key="assistant_entry_style"]');
        const opts = (row) => [...(row?.querySelectorAll('option') || [])].map((o) => (o.textContent || '').trim());
        return {
          week: !!week,
          weekOptions: opts(week),
          style: !!style,
          styleOptions: opts(style),
        };
      });
      check('偏好设置里有「周起始日」且选项中文',
        prefRows.week && prefRows.weekOptions.includes('周一') && prefRows.weekOptions.includes('周日'),
        JSON.stringify(prefRows));
      check('偏好设置里有「AI 入口样式」且选项为顶栏图标 / 悬浮球',
        prefRows.style && prefRows.styleOptions.includes('顶栏图标') && prefRows.styleOptions.includes('悬浮球'),
        JSON.stringify(prefRows));

      // ---------- 2. 周起始日：周日 → 周视图第一列变周日 ----------
      await api(page, '/api/configs', 'PUT', { key: 'calendar_week_start', value: 'sunday' });
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await waitFor(page, () => !!document.querySelector('[data-cal-view-toggle]'), { timeout: 15000 });
      await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
      await waitFor(page, () => !!document.querySelector('[data-week-col]'), { timeout: 15000 });
      await sleep(900);
      let firstCol = '';
      for (let i = 0; i < 15; i += 1) {
        firstCol = await page.evaluate(() => {
          const head = document.querySelector('[data-week-grid] div[class*="text-center"]');
          return (head?.innerText || '').trim();
        });
        if (/周日/.test(firstCol)) break;
        await sleep(300);
      }
      check('把「周起始日」改成周日后，周视图第一列是周日', /周日/.test(firstCol), firstCol);

      // ---------- 3. AI 入口样式：悬浮球 ----------
      await api(page, '/api/configs', 'PUT', { key: 'assistant_entry_style', value: 'floating' });
      await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      const floating = await page.evaluate(() => {
        const top = document.querySelector('[data-assistant-topbar]');
        const ball = document.querySelector('[data-assistant-ball]');
        const tr = top?.getBoundingClientRect();
        const br = ball?.getBoundingClientRect();
        return {
          topDisplay: top ? getComputedStyle(top).display : 'missing',
          ballDisplay: ball ? getComputedStyle(ball).display : 'missing',
          topVisible: !!tr && tr.width > 0 && tr.height > 0,
          ballVisible: !!br && br.width > 0 && br.height > 0,
          ballFixed: ball ? getComputedStyle(ball).position === 'fixed' : false,
        };
      });
      check('选悬浮球后桌面顶栏 AI 图标隐藏', floating.topDisplay === 'none' || floating.topVisible === false, JSON.stringify(floating));
      check('选悬浮球后右下角悬浮球出现（fixed、可见）',
        floating.ballVisible === true && floating.ballFixed === true, JSON.stringify(floating));

      // ---------- 4. 手机端始终顶栏星星，不显示悬浮球 ----------
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      const mobile = await page.evaluate(() => {
        const top = document.querySelector('[data-assistant-topbar]');
        const ball = document.querySelector('[data-assistant-ball]');
        const tr = top?.getBoundingClientRect();
        return {
          topVisible: !!tr && tr.width > 0 && tr.height > 0,
          ballDisplay: ball ? getComputedStyle(ball).display : 'missing',
        };
      });
      check('手机端仍显示顶栏 AI 星星', mobile.topVisible === true, JSON.stringify(mobile));
      check('手机端不显示悬浮球', mobile.ballDisplay === 'none', JSON.stringify(mobile));

      // ---------- 5. 切回顶栏图标 ----------
      await page.setViewport({ width: 1440, height: 900 });
      await api(page, '/api/configs', 'PUT', { key: 'assistant_entry_style', value: 'topbar' });
      await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      const topbar = await page.evaluate(() => ({
        topVisible: (() => { const el = document.querySelector('[data-assistant-topbar]'); const r = el?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; })(),
        ball: !!document.querySelector('[data-assistant-ball]'),
      }));
      check('切回顶栏图标后悬浮球消失', topbar.ball === false, JSON.stringify(topbar));
      check('切回顶栏图标后顶栏 AI 星星可见', topbar.topVisible === true, JSON.stringify(topbar));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'calendar_week_start', value: originalWeek || 'monday' });
      await api(page, '/api/configs', 'PUT', { key: 'assistant_entry_style', value: originalStyle || 'topbar' });
    }
  }, { width: 1440, height: 900 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('出错:', err && err.message ? err.message : err);
  process.exit(1);
});
