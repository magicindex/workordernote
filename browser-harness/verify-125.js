/**
 * 首页看板只负责展示，不提供新建入口（用户 2026-11-14：
 * 「首页 页面 新建按钮取消 ，首页只是用来展示」）。
 *
 * 钉住这几条：
 *   1) 侧栏最上面没有「新建提醒」；AI 入口是顶栏铃铛旁的 AI 星星（侧栏只留给手机抽屉）；
 *   2) 首页看板标题仍是「接下来 14 天」，但标题行右侧**没有**「新建提醒」按钮，
 *      页面里也没有任何写着「新建」的按钮 / 链接；
 *   3) 首页两列（未来 14 天待办 / 已逾期）仍然正常展示；
 *   4) 手机端全局「悬浮 +」在首页 Dashboard 隐藏，但在「待办」页照常保留（其它页面不受影响）。
 *
 * 只读不写。
 * 用法：APP_URL=http://127.0.0.1:8906 node verify-125.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}

const visible = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}, sel);

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    // ============ 1. 侧栏：没有新建提醒；AI 入口在顶栏 ============
    await gotoRetry(page, BASE + '/admin/home');
    await sleep(2500);
    const sidebar = await page.evaluate(() => {
      const aside = document.querySelector('aside.sidebar');
      const buttons = Array.from(aside?.querySelectorAll('button, a') || []);
      const drawerTrigger = aside?.querySelector('[data-assistant-sidebar]');
      const topbar = document.querySelector('[data-assistant-topbar]');
      const topbarRect = topbar?.getBoundingClientRect();
      return {
        newCount: buttons.filter((el) => /新建提醒/.test(el.textContent || '')).length,
        assistant: document.querySelectorAll('[data-assistant-trigger]').length,
        assistantText: (topbar?.innerText || '').trim(),
        drawerVisible: !!drawerTrigger && drawerTrigger.getBoundingClientRect().width > 0,
        topbarVisible: !!topbar && topbarRect.width > 0 && topbarRect.height > 0
          && getComputedStyle(topbar).position !== 'fixed',
        ball: !!document.querySelector('[data-assistant-ball]'),
      };
    });
    check('侧栏最上面不再有「新建提醒」按钮', sidebar.newCount === 0, `还在 ${sidebar.newCount} 个`);
    check('桌面端侧栏里不再显示「呼叫小秘」入口', sidebar.drawerVisible === false);
    check('桌面端 AI 入口是顶栏铃铛旁的星星（可见、不是浮球）',
      sidebar.topbarVisible === true && sidebar.ball === false, JSON.stringify(sidebar));
    check('AI 入口只剩顶栏一个（侧栏入口只留给手机抽屉）',
      sidebar.assistant === 1 && /^呼叫\S+/.test(sidebar.assistantText), JSON.stringify(sidebar));

    // ============ 2. 首页看板：只展示，没有新建入口 ============
    const header = await page.evaluate(() => {
      const box = document.querySelector('[data-home-dashboard]');
      const h1 = document.querySelector('[data-home-dashboard] h1');
      const newBtn = document.querySelector('[data-dashboard-new-reminder]');
      const newButtons = [...(box?.querySelectorAll('button, a') || [])]
        .filter((el) => /新建/.test(el.textContent || ''))
        .map((el) => (el.textContent || '').trim());
      return {
        title: (h1?.textContent || '').trim(),
        newBtn: !!newBtn,
        newButtons,
        upcoming: !!document.querySelector('[data-home-column="upcoming"]'),
        overdue: !!document.querySelector('[data-home-column="overdue"]'),
        counts: !!document.querySelector('[data-home-counts]'),
      };
    });
    check('首页看板标题还是「接下来 14 天」', /接下来 14 天/.test(header.title), header.title);
    check('首页标题行没有「新建提醒」按钮', header.newBtn === false);
    check('首页看板里没有任何「新建」按钮 / 链接', header.newButtons.length === 0, JSON.stringify(header.newButtons));
    check('首页两列仍在（未来 14 天待办 / 已逾期）', header.upcoming && header.overdue, JSON.stringify(header));
    check('首页不再出现重复的「待办 N · 逾期 N」计数', header.counts === false);

    // ============ 3. 手机：首页不显示悬浮 +，待办页照常显示 ============
    await page.setViewport({ width: 390, height: 844 });
    await gotoRetry(page, BASE + '/admin/home');
    await sleep(2200);
    const dashboardFab = await visible(page, '[data-mobile-fab]');
    check('手机端首页不显示全局「悬浮 +」新建入口', dashboardFab === false);

    await gotoRetry(page, BASE + '/admin');
    await sleep(2200);
    check('手机端「待办」页仍保留「悬浮 +」新建入口', await visible(page, '[data-mobile-fab]'));
    check('手机端顶栏 AI 星星仍在', await visible(page, '[data-assistant-topbar]'));

    await page.setViewport({ width: 1440, height: 1000 });
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})();
