/**
 * 邮箱找回密码（用户 2026-10-29 原话：
 * 「个人修改页面 ：安全问题 删除，改成邮箱找回密码，
 *   系统后台增加邮箱密码找回通知 设置」）。
 *
 * 钉住这几条：
 *   1. 个人修改页不再出现安全问题表单，改成「邮箱找回密码」状态卡；
 *   2. 登录页仍有「忘记密码？」，找回页第一步只需用户名，并说明验证码发到
 *      「通知方式 → 邮件」已绑定的接收邮箱；
 *   3. 提交后进入第二步（验证码 + 新密码 + 确认），有重发冷却与有效期文案；
 *   4. 错误的验证码只回统一错误，不会泄露账号是否存在；
 *   5. 系统配置里有「账号安全」组，含开关与验证码有效期；
 *   6. 公开配置暴露 password_reset_email_enabled / password_reset_code_ttl_minutes。
 *
 * 刻意**不改任何人的密码**：只提交一个不存在的用户名 + 错误验证码，验证 UI 与
 * 统一错误；真正的重置成功路径由 server/server_test.go 的单测覆盖。
 *
 * 用法：APP_URL=http://127.0.0.1:8919 node verify-141.js
 */
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const text = (page) => page.evaluate(() => document.body.innerText);
const fill = (page, sel, value) => page.evaluate(({ sel, value }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, { sel, value });

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    // 部署后 Service Worker 可能还端着旧 bundle，这里绕过缓存，确保测的是新前端。
    await page.setBypassServiceWorker(true);
    await page.setCacheEnabled(false);
    let token = '';
    try {
      await login(page, BASE);
      token = await page.evaluate(() => localStorage.getItem('reminders.token') || '');
      // 找回页只对未登录访客开放；清 token 后刷新，Pinia 才会重新判断。
      await page.evaluate(() => localStorage.removeItem('reminders.token'));
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      check('登录页保留「忘记密码？」', (await text(page)).includes('忘记密码'));

      await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('忘记密码'))?.click());
      await sleep(1000);
      check('进入找回密码页', /\/forgot-password/.test(page.url()));
      const step1 = await text(page);
      check('第一步只要求用户名', step1.includes('用户名') && !step1.includes('安全问题'));
      check('提示验证码发到已绑定的接收邮箱', step1.includes('通知方式 → 邮件'));

      await fill(page, 'input[autocomplete="username"]', `nobody-${STAMP}`);
      await page.evaluate(() => document.querySelector('button[type="submit"]').click());
      const step2 = await waitFor(page, () => !!document.querySelector('input[name="reset-code"]'), { timeout: 15000 });
      check('提交用户名后进入验证码步骤', step2);
      const t2 = await text(page);
      check('有重发冷却', /\d+ 秒后可重发/.test(t2));
      check('有验证码有效期文案', t2.includes('分钟内有效'));

      await fill(page, 'input[name="reset-code"]', '000000');
      await page.evaluate(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        for (const el of document.querySelectorAll('input[autocomplete="new-password"]')) {
          setter.call(el, 'selfcheck123');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.evaluate(() => document.querySelector('button[type="submit"]').click());
      const err = await waitFor(page, () => document.body.innerText.includes('验证码无效或已过期'), { timeout: 12000 });
      check('错误验证码回统一提示', err);
      check('错误提示不区分账号是否存在', !(await text(page)).includes('用户不存在'));

      // 恢复登录态，检查个人页与系统配置。
      await page.evaluate((t) => localStorage.setItem('reminders.token', t), token);
      await page.goto(BASE + '/admin/profile', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const profile = await text(page);
      check('个人页有邮箱找回密码卡', profile.includes('邮箱找回密码'));
      check('个人页不再有安全问题', !profile.includes('安全问题'));
      check('个人页说明复用已绑定的接收邮箱', profile.includes('接收邮箱'));

      const publicCfg = await page.evaluate(async (base) => {
        const r = await fetch(base + '/api/configs/public');
        return r.json();
      }, BASE);
      const cfg = (publicCfg && publicCfg.data) || {};
      check('公开配置含找回开关', cfg.password_reset_email_enabled === 'true' || cfg.password_reset_email_enabled === 'false');
      check('公开配置含验证码有效期', /^\d+$/.test(cfg.password_reset_code_ttl_minutes || ''));

      await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded' });
      await sleep(1600);
      const admin = await text(page);
      check('系统配置有「账号安全」组', admin.includes('账号安全'));
      check('后台有邮箱找回开关', admin.includes('邮箱找回密码'));
      check('后台有验证码有效期', admin.includes('验证码有效期'));
    } finally {
      if (token) {
        await page.evaluate((t) => localStorage.setItem('reminders.token', t), token).catch(() => {});
      }
    }
  }, { width: 390, height: 900 });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
