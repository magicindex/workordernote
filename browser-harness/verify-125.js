/**
 * 「新建提醒」从侧栏搬到首页看板（用户 2026-10-16 原话：
 * 「呼叫小秘上面的 新建提醒按钮，移动到 首页：与 接下来 14 天 同行 靠右」）。
 *
 * 钉住这几条：
 *   1) 侧栏最上面**不再有**「新建提醒」按钮，「呼叫小秘」还在（它是原来上下并排的另一个）；
 *   2) 首页看板标题「接下来 14 天」那一行**右侧**多一个「新建提醒」，与标题**同行、靠右**，
 *      按钮左边原来的「待办 N · 逾期 N」计数已按用户 2026-10-16 的要求删掉；
 *   3) 点它**跳到「今天」页并展开新建卡片**（首页看板自己没有新建面板，走 MainLayout 的
 *      open-quick-add 流程，和以前侧栏那个按钮的落点一致），输入框自动聚焦；
 *   4) 移动端「悬浮 +」入口不受影响（`[data-mobile-fab]` 还在）。
 *
 * 只读不写：不提交任何提醒；点开的新建卡片在收尾时按 Esc 收起。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-125.js
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

    // ============ 1. 侧栏：新建提醒没了，呼叫小秘还在 ============
    await gotoRetry(page, BASE + '/admin/home');
    await sleep(2500);
    const sidebar = await page.evaluate(() => {
      const aside = document.querySelector('aside.sidebar');
      const buttons = Array.from(aside?.querySelectorAll('button, a') || []);
      return {
        // 侧栏里还有没有写着「新建提醒」的按钮（原来那个）
        newCount: buttons.filter((el) => /新建提醒/.test(el.textContent || '')).length,
        assistant: document.querySelectorAll('[data-assistant-trigger]').length,
        assistantText: (document.querySelector('[data-assistant-trigger]')?.textContent || '').trim(),
      };
    });
    check('侧栏最上面不再有「新建提醒」按钮', sidebar.newCount === 0, `还在 ${sidebar.newCount} 个`);
    // AI 入口的名字在「系统配置 → AI 助手」里能改（默认「望舒」），这里只认「呼叫」前缀，
    // 不再写死「呼叫小秘」—— 那是最早的默认名，改了名这条就假红。
    check('侧栏 AI 入口还在（原来与它上下并排的那个）',
      sidebar.assistant === 1 && /^呼叫\S+/.test(sidebar.assistantText), JSON.stringify(sidebar));

    // ============ 2. 首页看板：标题行右侧的新建按钮 ============
    const header = await page.evaluate(() => {
      const box = document.querySelector('[data-home-dashboard]');
      const h1 = document.querySelector('[data-home-dashboard] h1');
      const btn = document.querySelector('[data-dashboard-new-reminder]');
      const counts = document.querySelector('[data-home-counts]');
      const boxOf = (el) => { const r = el?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, t: r.top, b: r.bottom, cy: (r.top + r.bottom) / 2 } : null; };
      return { title: (h1?.textContent || '').trim(), panel: boxOf(box), h1: boxOf(h1), btn: boxOf(btn), btnText: (btn?.textContent || '').trim(), counts: boxOf(counts) };
    });
    check('首页看板标题还是「接下来 14 天」', /接下来 14 天/.test(header.title), header.title);
    check('标题行右侧有「新建提醒」按钮', !!header.btn && /新建提醒/.test(header.btnText), JSON.stringify(header.btnText));
    check('按钮与标题**同行**（垂直中心差 ≤ 30px）',
      !!header.btn && Math.abs(header.btn.cy - header.h1.cy) <= 30,
      JSON.stringify({ 标题中心: header.h1?.cy, 按钮中心: header.btn?.cy }));
    check('按钮**靠右**（右边缘与看板右边缘对齐，差 ≤ 16px）',
      !!header.btn && Math.abs(header.btn.r - header.panel.r) <= 16,
      JSON.stringify({ 按钮右: header.btn?.r, 看板右: header.panel?.r }));
    check('按钮在标题右边（不是挤在标题前面）', !!header.btn && header.btn.l > header.h1.l, JSON.stringify({ 标题左: header.h1?.l, 按钮左: header.btn?.l }));
    check('按钮左边不再有「待办 N · 逾期 N」计数（用户 2026-10-16 要求删掉）',
      header.counts === null, JSON.stringify(header.counts));

    // ============ 3. 点它 → 跳「今天」页并展开新建卡片 ============
    await page.click('[data-dashboard-new-reminder]');
    await sleep(2500);
    const after = await page.evaluate(() => ({
      url: location.pathname,
      card: !!document.querySelector('.quick-card'),
      input: !!document.querySelector('.quick-card input'),
      focused: (document.activeElement?.getAttribute?.('placeholder') || ''),
    }));
    check('点一下跳到「今天」页（离开首页看板）', /\/admin\/?$/.test(after.url), after.url);
    check('新建卡片自动展开（整块表单，不只是那个「新建」按钮）', after.card && after.input, JSON.stringify(after));
    check('光标已经落在新建输入框里', /写点什么|添加一条提醒|新建|标题|要做/.test(after.focused), after.focused);

    // 收尾：Esc 收起（没写标题时允许收起，不留下任何数据）
    await page.keyboard.press('Escape');
    await sleep(600);
    const collapsed = await page.evaluate(() => !document.querySelector('.quick-card'));
    check('收尾：Esc 把新建卡片收回去了（不留数据）', collapsed);

    // ============ 4. 手机：悬浮 + 入口还在 ============
    await page.setViewport({ width: 390, height: 844 });
    await gotoRetry(page, BASE + '/admin');
    await sleep(2200);
    check('手机端「悬浮 +」新建入口还在', await visible(page, '[data-mobile-fab]'));
    await page.setViewport({ width: 1440, height: 1000 });
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})();
