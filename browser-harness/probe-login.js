/**
 * 临时探查：登录态到底记不记得住。
 *
 * 用法：APP_URL=http://127.0.0.1:8906 node probe-login.js
 */
const { withTab, sleep } = require('./harness');
const { APP, USER, PASS } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

(async () => {
  await withTab(async (page) => {
    // 1) 清干净，回到登录页
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);

    const form = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')];
      const user = inputs.find((i) => i.type === 'text' || i.autocomplete === 'username');
      const pw = inputs.find((i) => i.type === 'password');
      const remember = document.querySelector('[data-remember], input[type="checkbox"]');
      const formEl = document.querySelector('form');
      return {
        onLogin: !!pw,
        userAutocomplete: user?.getAttribute('autocomplete'), userName: user?.getAttribute('name'),
        pwAutocomplete: pw?.getAttribute('autocomplete'), pwName: pw?.getAttribute('name'),
        formAutocomplete: formEl?.getAttribute('autocomplete'), formAction: formEl?.getAttribute('action'),
        rememberChecked: remember ? remember.checked : null,
        rememberData: !!document.querySelector('[data-remember]'),
      };
    });
    console.log('  登录页字段：', JSON.stringify(form, null, 0));

    if (!form.onLogin) { console.log('  （当前没在登录页，可能已登录）'); return; }

    // 2) 用真实键盘输入 + 提交（模拟用户）
    await page.type('input[autocomplete="username"], input[type="text"]', USER, { delay: 20 });
    await page.type('input[type="password"]', PASS, { delay: 20 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /登\s*录/.test(b.textContent));
        if (btn) btn.click();
        else document.querySelector('form')?.requestSubmit?.();
      }),
    ]);
    await sleep(2500);
    const after = await page.evaluate(() => ({
      url: location.pathname,
      lsToken: !!localStorage.getItem('reminders.token'),
      ssToken: !!sessionStorage.getItem('reminders.token'),
      hasLoginForm: !!document.querySelector('input[type="password"]'),
    }));
    console.log('  提交后：', JSON.stringify(after));

    // 3) 新标签页（同一浏览器档案）打开，看还需不需要登录
    await withTab(async (page2) => {
      await page2.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(2500);
      const again = await page2.evaluate(() => ({
        url: location.pathname,
        hasLoginForm: !!document.querySelector('input[type="password"]'),
        lsToken: !!localStorage.getItem('reminders.token'),
      }));
      console.log('  新标签页打开：', JSON.stringify(again));
    });
  });
})().catch((err) => { console.error('探查失败：', err.message); process.exit(1); });
