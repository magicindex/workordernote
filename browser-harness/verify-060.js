/**
 * 验证 0.6.0：侧栏折叠成「图标栏」+ 进日历自动收起 + 悬停提示
 *   1) 折叠 = 56px 图标栏（不是整条消失）：只留图标，文字/角标藏起来，内容区让出空间；
 *   2) 切到日历视图自动收起；离开自动还原（且不改写用户的折叠偏好）；
 *   3) 图标栏里的图标有 hover 提示（title）；
 *   4) 在日历里手动展开之后不会被反复收起；
 *   5) 手机抽屉不受影响（仍然是带文字的完整侧栏）。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-060.js
 * 只改浏览器本地的 ui_rail_collapsed，结束时还原。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 侧栏与内容区的几何 + 图标栏状态。 */
const measure = (page) => page.evaluate(() => {
  const aside = document.querySelector('aside.sidebar');
  if (!aside) return null;
  // 内容区容器：唯一带 lg:pl- 的那个（侧栏让位就是用它的 padding-left 表达的）
  const main = [...document.querySelectorAll('div')].find((d) => String(d.className).includes('lg:pl-')) || null;
  const label = aside.querySelector('.nav-row > .flex-1');
  const icon = aside.querySelector('.nav-row .nav-symbol');
  const cs = getComputedStyle(aside);
  const titledIcons = [...aside.querySelectorAll('.nav-row')].map((row) => ({
    width: Math.round(row.getBoundingClientRect().width),
    title: row.getAttribute('title') || '',
    text: (row.textContent || '').trim().slice(0, 12),
  }));
  return {
    asideWidth: Math.round(aside.getBoundingClientRect().width),
    asideLeft: Math.round(aside.getBoundingClientRect().left),
    railClass: aside.classList.contains('sidebar-rail'),
    dockedClass: aside.classList.contains('sidebar-docked'),
    labelHidden: label ? label.offsetParent === null : null,
    labelVisible: label ? label.offsetParent !== null : null,
    iconVisible: icon ? icon.offsetParent !== null : null,
    iconWidth: icon ? Math.round(icon.getBoundingClientRect().width) : null,
    contentPadLeft: main ? getComputedStyle(main).paddingLeft : null,
    // 图标栏里的行是否居中（行中心与侧栏中心对齐，误差 ≤2px）
    rowCentered: (() => {
      const row = aside.querySelector('.nav-row');
      if (!row) return null;
      const r = row.getBoundingClientRect(), a = aside.getBoundingClientRect();
      return Math.abs((r.left + r.width / 2) - (a.left + a.width / 2)) <= 2;
    })(),
    titledIcons,
    railPref: (() => { try { return localStorage.getItem('ui_rail_collapsed'); } catch { return null; } })(),
    url: location.pathname,
  };
});

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);

    // 记下用户原本的折叠偏好，结束时还原
    const originalPref = await page.evaluate(() => {
      try { return localStorage.getItem('ui_rail_collapsed'); } catch { return null; }
    });

    // 先确保是「展开」的完整侧栏
    await page.evaluate(() => { try { localStorage.removeItem('ui_rail_collapsed') } catch { /* 忽略 */ } });
    await page.goto(BASE.replace(/\/$/, '') + '/admin/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !!document.querySelector('aside.sidebar .nav-row'), { timeout: 20000 });
    await sleep(1200);
    const expanded = await measure(page);
    check('非日历页：侧栏展开（约 292px，文字可见）',
      expanded?.asideWidth > 250 && expanded?.labelVisible === true,
      JSON.stringify({ w: expanded?.asideWidth, label: expanded?.labelVisible }));
    check('内容区为侧栏让出 292px', expanded?.contentPadLeft === '292px', expanded?.contentPadLeft);

    // ---- 1. 用顶栏的「列表 / 日历」开关切到日历：应自动收成图标栏 ----
    // 注意：侧栏里并没有「日历」链接，日历是从顶栏那个开关进的（用户的实际走法）。
    const switched = await page.evaluate(() => {
      const link = [...document.querySelectorAll('a[title="日历视图"]')][0];
      if (!link) return false;
      link.click();
      return true;
    });
    check('顶栏有「切到日历视图」的入口', switched);
    await waitFor(page, () => location.pathname.endsWith('/admin/calendar'), { timeout: 15000 });
    await sleep(1200);
    const cal = await measure(page);
    check('切到日历后侧栏收成图标栏（约 56px，rail 类生效）',
      cal?.asideWidth > 40 && cal?.asideWidth < 90 && cal?.railClass === true,
      JSON.stringify({ w: cal?.asideWidth, rail: cal?.railClass, docked: cal?.dockedClass }));
    check('图标栏里文字隐藏、图标还在',
      cal?.labelHidden === true && cal?.iconVisible === true,
      JSON.stringify({ label: cal?.labelHidden, icon: cal?.iconVisible }));
    check('图标栏里图标居中', cal?.rowCentered === true, String(cal?.rowCentered));
    check('内容区只留 56px 边距（日历拿到更多横向空间）', cal?.contentPadLeft === '56px', cal?.contentPadLeft);
    check('侧栏仍在屏幕内（不是整条藏起来）', cal?.asideLeft === 0, String(cal?.asideLeft));
    check('没有改写用户的折叠偏好（临时收起）', cal?.railPref === null, `ui_rail_collapsed=${cal?.railPref}`);

    // ---- 1b. 图标栏里不该挤着文字/星标 ----
    const railDetail = await page.evaluate(() => {
      const aside = document.querySelector('aside.sidebar');
      const toggle = aside.querySelector('.nav-settings-toggle');
      const toggleLabel = toggle.querySelector('span.text-xs');
      const star = aside.querySelector('.group\\/list span svg path[d^="m12 3.6"]')?.closest('span') || null;
      const listRow = aside.querySelector('.group\\/list a');
      return {
        toggleText: (toggle.innerText || '').trim(),
        toggleLabelHidden: toggleLabel ? toggleLabel.offsetParent === null : null,
        gearVisible: !!toggle.querySelector('svg circle')?.closest('svg') && toggle.querySelector('svg circle').offsetParent !== null,
        listRowText: (listRow ? listRow.innerText : '').trim(),
        starInAside: !!star,
        starHidden: star ? star.offsetParent === null : null,
      };
    });
    check('图标栏里「设置」只剩齿轮（文字已隐藏）',
      railDetail.toggleLabelHidden === true && !railDetail.toggleText.includes('设置') && railDetail.gearVisible === true,
      JSON.stringify(railDetail));
    check('图标栏里清单行只剩色点（默认清单的星标隐藏）',
      railDetail.starInAside && railDetail.starHidden === true && railDetail.listRowText === '',
      JSON.stringify(railDetail));

    // ---- 2. 图标上的悬停提示 ----
    const withTitles = (cal?.titledIcons || []).filter((r) => r.title);
    check('图标栏里的图标带 hover 提示（title）', withTitles.length >= 5,
      `${withTitles.length} 个：${withTitles.slice(0, 5).map((r) => r.title).join(' / ')}`);
    // 「今天」这一栏 2026-10-16 改名「待办」（用户要求），提示文字跟着走。
    check('提示文字就是菜单名（如「待办」「我的清单」）',
      withTitles.some((r) => r.title === '待办') && withTitles.some((r) => r.title === '已完成'),
      withTitles.slice(0, 6).map((r) => r.title).join(','));
    await page.screenshot({ path: path.join(SHOTS, 'rail-calendar.png') });

    // ---- 3. 离开日历：还原（用顶栏切回列表）----
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('a[title="列表视图"]')][0];
      if (link) link.click();
    });
    await waitFor(page, () => !location.pathname.endsWith('/admin/calendar'), { timeout: 15000 });
    await sleep(1200);
    const back = await measure(page);
    check('离开日历后侧栏还原为展开',
      back?.asideWidth > 250 && back?.labelVisible === true && back?.railClass === false,
      JSON.stringify({ w: back?.asideWidth, label: back?.labelVisible, rail: back?.railClass }));

    // ---- 3b. 展开后星标与文字都回来 ----
    const expandedDetail = await page.evaluate(() => {
      const aside = document.querySelector('aside.sidebar');
      const star = aside.querySelector('.group\\/list span svg path[d^="m12 3.6"]')?.closest('span') || null;
      const toggleLabel = aside.querySelector('.nav-settings-toggle span.text-xs');
      return {
        starVisible: star ? star.offsetParent !== null : null,
        settingsLabelVisible: toggleLabel ? toggleLabel.offsetParent !== null : null,
      };
    });
    check('展开后默认清单的星标重新出现', expandedDetail.starVisible === true, JSON.stringify(expandedDetail));
    check('展开后「设置」文字重新出现', expandedDetail.settingsLabelVisible === true, JSON.stringify(expandedDetail));

    // ---- 4. 在日历里手动展开：不该被反复收起 ----
    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    const inCal = await measure(page);
    check('（直接打开日历同样自动收起）', inCal?.railClass === true, JSON.stringify({ rail: inCal?.railClass }));
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /侧栏/.test(b.getAttribute('aria-label') || ''));
      btn.click();
    });
    await sleep(900);
    const manualOpen = await measure(page);
    check('在日历里手动展开后保持展开（不会被自动收起覆盖）',
      manualOpen?.asideWidth > 250 && manualOpen?.railClass === false,
      JSON.stringify({ w: manualOpen?.asideWidth, rail: manualOpen?.railClass }));
    check('手动展开会记进用户偏好', manualOpen?.railPref === '0', `ui_rail_collapsed=${manualOpen?.railPref}`);
    // 再点一次收回图标栏，并还原偏好
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /侧栏/.test(b.getAttribute('aria-label') || ''));
      btn.click();
    });
    await sleep(700);

    // ---- 5. 手机抽屉不受影响 ----
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /侧栏/.test(b.getAttribute('aria-label') || ''));
      if (btn) btn.click();
    });
    await sleep(900);
    const mobile = await page.evaluate(() => {
      const aside = document.querySelector('aside.sidebar');
      const label = aside.querySelector('.nav-row > .flex-1');
      return {
        width: Math.round(aside.getBoundingClientRect().width),
        left: Math.round(aside.getBoundingClientRect().left),
        labelVisible: label ? label.offsetParent !== null : null,
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      };
    });
    check('手机抽屉仍是完整侧栏（文字可见，图标栏不生效）',
      mobile.width > 250 && mobile.labelVisible === true && mobile.left >= 0,
      JSON.stringify(mobile));
    check('手机上没有横向溢出', mobile.doc <= mobile.win + 1, JSON.stringify(mobile));
    await page.screenshot({ path: path.join(SHOTS, 'rail-mobile-drawer.png') });
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });

    // ---- 6. 还原用户偏好 ----
    await page.evaluate((value) => {
      try {
        if (value === null) localStorage.removeItem('ui_rail_collapsed');
        else localStorage.setItem('ui_rail_collapsed', value);
      } catch { /* 忽略 */ }
    }, originalPref);
    const restored = await page.evaluate(() => {
      try { return localStorage.getItem('ui_rail_collapsed'); } catch { return null; }
    });
    check(`折叠偏好已还原（原值 ${originalPref === null ? '未设置' : originalPref}）`,
      restored === originalPref, `现在 ${restored}`);
    console.log(`  截图：${path.join(SHOTS, 'rail-calendar.png')} / rail-mobile-drawer.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
