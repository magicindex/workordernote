/**
 * WebDAV 测试连接 + 连接状态（用户 2026-11-14）。
 * 只点「测试连接」，不改任何配置。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const cfg = (await api(page, '/api/configs')).body?.data || {};
    if (String(cfg.backup_webdav_enabled || 'false') !== 'true') {
      check('WebDAV 已开启（未开启则无法显示测试区）', false, '请先在系统配置打开「备份到 WebDAV」');
      return;
    }
    await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const ui = await page.evaluate(() => {
      const btn = document.querySelector('[data-webdav-test-button]');
      return {
        area: !!document.querySelector('[data-webdav-test]'),
        button: !!btn,
        inFirstRow: !!btn?.closest('[data-config-key="backup_webdav_enabled"]'),
        disabled: !!btn?.disabled,
        state: document.querySelector('[data-webdav-test-status]')?.getAttribute('data-state') || '',
        text: (document.querySelector('[data-webdav-test-status]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });
    check('WebDAV 分组里有测试连接按钮', ui.area && ui.button, JSON.stringify(ui));
    check('测试按钮在「备份到 WebDAV」第一行开关后，且已启用时可点',
      ui.inFirstRow === true && ui.disabled === false, JSON.stringify(ui));
    check('测试前状态是「未测试」', ui.state === 'idle' && ui.text.includes('未测试'), JSON.stringify(ui));

    await page.evaluate(() => document.querySelector('[data-webdav-test-button]')?.click());
    let result = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(700);
      result = await page.evaluate(() => ({
        state: document.querySelector('[data-webdav-test-status]')?.getAttribute('data-state') || '',
        text: (document.querySelector('[data-webdav-test-status]')?.textContent || '').replace(/\s+/g, ' ').trim(),
        message: (document.querySelector('[data-webdav-test] p')?.textContent || '').trim(),
      }));
      if (result.state === 'ok' || result.state === 'error') break;
    }
    check('点测试后显示连接状态（成功或失败）', result?.state === 'ok' || result?.state === 'error', JSON.stringify(result));
    check('状态文案是「连接正常」或「连接失败」',
      /连接正常|连接失败/.test(result?.text || ''), `${result?.text} ${result?.message}`.trim());
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
