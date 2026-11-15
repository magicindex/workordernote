/** 后台邮箱发件配置：SMTP 字段 + 测试邮件接口（真实 SMTP 由服务端处理）。 */
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
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1360, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await page.evaluate(() => document.querySelector('[data-settings-tab="more"]')?.click());
    await sleep(800);
    const ui = await page.evaluate(() => ({
      panel: !!document.querySelector('[data-email-sender-settings]'),
      host: !!document.querySelector('[data-email-smtp-host]'),
      port: !!document.querySelector('[data-email-smtp-port]'),
      username: !!document.querySelector('[data-email-smtp-username]'),
      password: !!document.querySelector('[data-email-smtp-password]'),
      from: !!document.querySelector('[data-email-smtp-from]'),
      fromName: !!document.querySelector('[data-email-smtp-from-name]'),
      test: !!document.querySelector('[data-email-test-send]'),
    }));
    check('更多里有「邮箱发件配置」', ui.panel, JSON.stringify(ui));
    check('SMTP 服务器/端口/账号/密码/发信人字段齐全',
      ui.host && ui.port && ui.username && ui.password && ui.from && ui.fromName, JSON.stringify(ui));
    check('有「发送测试邮件」入口', ui.test, JSON.stringify(ui));

    const got = await api(page, '/api/reminder/admin/providers/email');
    check('后台能读取发件配置（密码不回显）',
      got.status === 200 && got.body?.code === 0 && typeof got.body?.data?.host === 'string'
        && !Object.prototype.hasOwnProperty.call(got.body?.data || {}, 'password'), JSON.stringify(got.body).slice(0, 200));
    const bad = await api(page, '/api/reminder/admin/providers/email/test', 'POST', { to: 'not-an-email' });
    check('测试邮件先校验收件邮箱并返回原因',
      bad.status === 400 && /邮箱/.test(String(bad.body?.message || '')), JSON.stringify(bad.body));
    const empty = await api(page, '/api/reminder/admin/providers/email/test', 'POST', { to: '' });
    check('测试收件人为空时返回明确错误', empty.status === 400 && String(empty.body?.message || '').length > 0, JSON.stringify(empty.body));
  }, { width: 1360, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
