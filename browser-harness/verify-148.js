/**
 * 手机端管理页优化：
 * - 用户列表在手机上改为卡片，桌面仍保留表格
 * - 操作日志在手机上改为卡片
 * - 这些页面不再悬浮「新建提醒」按钮挡住内容
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login } = require('./reminders-app');

const BASE = process.env.APP_URL || 'http://192.168.3.201:8906';
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    await page.setViewport({ width: 390, height: 844 });

    await page.goto(BASE + '/admin/users', { waitUntil: 'domcontentloaded' });
    await sleep(1400);
    check('手机用户列表显示卡片', await page.$$eval('[data-mobile-user-card]', (els) => els.length > 0));
    check('手机用户列表隐藏桌面表格', await page.evaluate(() => !document.querySelector('table')?.offsetParent));
    check('用户卡片有状态与操作按钮', await page.evaluate(() => {
      const card = document.querySelector('[data-mobile-user-card]');
      if (!card) return false;
      const t = card.innerText;
      return t.includes('启用') && card.querySelectorAll('button').length >= 3;
    }));
    check('用户页无横向滚动', await noOverflow(page));
    check('用户页不显示悬浮新建按钮', await page.evaluate(() => !document.querySelector('[data-mobile-fab]')));

    await page.goto(BASE + '/admin/audit', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    check('手机日志列表显示卡片', await page.$$eval('[data-mobile-audit-card]', (els) => els.length > 0));
    check('日志页无横向滚动', await noOverflow(page));
    check('日志页不显示悬浮新建按钮', await page.evaluate(() => !document.querySelector('[data-mobile-fab]')));

    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + '/admin/users', { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    check('桌面用户页仍显示表格', await page.evaluate(() => !!document.querySelector('table')?.offsetParent));
    check('桌面用户页不显示手机卡片', await page.evaluate(() => !document.querySelector('[data-mobile-user-card]')?.offsetParent));

    await page.setViewport({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(900);
    check('待办页仍保留悬浮新建按钮', await page.evaluate(() => !!document.querySelector('[data-mobile-fab]')));
  }, { width: 390, height: 844 });

  console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
