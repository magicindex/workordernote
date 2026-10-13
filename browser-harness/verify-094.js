/**
 * 验证「手机端没有日历视图」（窄屏 ≤640px）：
 *   入口隐藏（顶栏切换、左上角 logo 不再指向日历）+ 直接输网址/书签也进不去（路由守卫）+
 *   从电脑宽度缩到手机宽度时自动回到列表 + 「默认首页=日历」的偏好在手机上忽略。
 * 电脑端（>640px）一切照旧。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-094.js
 * 数据：只碰一处服务端配置（默认首页），读完原值→临时改成 calendar→验证→改回并回读确认。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');
const ROOT = BASE.replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: ROOT, p, method, body });

/** 页面上的日历痕迹：格子、视图切换组、指向日历的链接、logo 的提示。 */
const calendarFootprint = (page) => page.evaluate(() => {
  const logo = document.querySelector('button[aria-label*="视图"]');
  return {
    cells: document.querySelectorAll('.cal-cell').length,
    viewSwitch: !!document.querySelector('[aria-label="切换列表或日历视图"]'),
    calendarLinks: document.querySelectorAll('a[href="/admin/calendar"]').length,
    logoAria: logo ? logo.getAttribute('aria-label') : '',
    logoTitle: logo ? logo.getAttribute('title') : '',
    url: location.pathname,
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    hasList: !!document.querySelector('.quick-card') || !!document.querySelector('article.reminder-row') || document.body.innerText.includes('我的清单'),
  };
});

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    // ---------- 1. 手机端：入口与直达都被挡掉 ----------
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1600);

    let fp = await calendarFootprint(page);
    check('手机端顶栏没有「列表 / 日历」切换组', fp.viewSwitch === false, JSON.stringify(fp));
    check('手机端页面上没有任何指向 /admin/calendar 的链接', fp.calendarLinks === 0, String(fp.calendarLinks));
    check('手机端左上角 logo 只说「回到列表视图」，不提日历',
      /回到列表视图/.test(fp.logoAria) && !/日历视图$/.test(fp.logoAria) && !/切到日历/.test(fp.logoTitle),
      `${fp.logoAria} | ${fp.logoTitle}`);
    check('手机端页面不横向溢出', fp.doc <= fp.win + 1, `${fp.doc} vs ${fp.win}`);

    // 点 logo：不能进日历
    await page.evaluate(() => document.querySelector('button[aria-label*="视图"]').click());
    await sleep(1200);
    fp = await calendarFootprint(page);
    check('点左上角 logo 不会进日历', !fp.url.includes('calendar') && fp.cells === 0, fp.url);

    // 直接访问日历地址：应被守卫送回列表
    await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1600);
    fp = await calendarFootprint(page);
    check('手机端直接访问 /admin/calendar 会被送到列表视图（看不到月历格子）',
      !fp.url.includes('calendar') && fp.cells === 0, `URL=${fp.url} 格子=${fp.cells}`);
    check('送过去之后确实是列表视图', fp.hasList === true, JSON.stringify(fp.hasList));
    await page.screenshot({ path: path.join(SHOTS, 'mobile-no-calendar.png') });

    // ---------- 2. 电脑端：一切照旧 ----------
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    let wide = await calendarFootprint(page);
    check('电脑端「列表 / 日历」切换组在', wide.viewSwitch === true, JSON.stringify(wide));
    check('电脑端有指向日历的链接', wide.calendarLinks >= 1, String(wide.calendarLinks));
    check('电脑端 logo 提示是「切换到日历视图」', /切换到日历视图/.test(wide.logoAria), wide.logoAria);

    await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('.cal-cell'), { timeout: 20000 });
    await sleep(1500);
    wide = await calendarFootprint(page);
    check('电脑端能正常进日历并渲染月历格子', wide.url.includes('calendar') && wide.cells >= 28,
      `URL=${wide.url} 格子=${wide.cells}`);

    // 从日历页缩到手机宽度：实时缩放也要回列表
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(1800);
    const afterResize = await calendarFootprint(page);
    check('电脑端开着日历、把窗口缩到手机宽度 → 自动回到列表视图',
      !afterResize.url.includes('calendar') && afterResize.cells === 0,
      `URL=${afterResize.url} 格子=${afterResize.cells}`);
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(1000);

    // ---------- 3. 「默认首页=日历」的偏好在手机上要被忽略 ----------
    const before = await api(page, '/api/configs');
    const originalView = before.body?.data?.default_view ?? null;
    check('读到了「默认首页」原值', originalView !== null, String(originalView));
    try {
      if (originalView !== 'calendar') {
        const put = await api(page, '/api/configs', 'PUT', { key: 'default_view', value: 'calendar' });
        check('已把默认首页临时改成「日历」', put.status === 200, `status=${put.status}`);
      }
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
      const mobileHome = await calendarFootprint(page);
      check('手机端即使默认首页设成「日历」，进应用也落在列表视图',
        !mobileHome.url.includes('calendar') && mobileHome.cells === 0, `URL=${mobileHome.url}`);

      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2200);
      const desktopHome = await page.evaluate(() => location.pathname);
      check('电脑端同一偏好仍然生效（默认首页=日历就进日历）',
        desktopHome.includes('calendar'), desktopHome);
    } finally {
      if (originalView !== 'calendar') {
        await api(page, '/api/configs', 'PUT', { key: 'default_view', value: originalView });
      }
      const after = await api(page, '/api/configs');
      check('默认首页已还原为原值并回读确认',
        (after.body?.data?.default_view ?? null) === originalView,
        `${originalView} → ${after.body?.data?.default_view}`);
    }

    await page.setViewport({ width: 1440, height: 900 });
    console.log(`  截图：${path.join(SHOTS, 'mobile-no-calendar.png')}`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
