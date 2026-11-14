/**
 * WebDAV 服务器地址与路径同行、可查看远程目录（用户 2026-11-14）。
 * 只读：不修改路径、不保存。
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
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const ui = await page.evaluate(() => {
      const row = document.querySelector('[data-webdav-address-row]');
      return {
        hasRow: !!row,
        server: !!document.querySelector('[data-webdav-server]'),
        path: !!document.querySelector('[data-webdav-path]'),
        browse: !!document.querySelector('[data-webdav-browse]'),
        sameRow: !!row?.contains(document.querySelector('[data-webdav-server]')) && !!row?.contains(document.querySelector('[data-webdav-path]')),
      };
    });
    check('服务器地址与路径在同一个地址行', ui.hasRow && ui.sameRow, JSON.stringify(ui));
    check('地址行有服务器地址、路径、查看远程目录', ui.server && ui.path && ui.browse, JSON.stringify(ui));

    await page.evaluate(() => document.querySelector('[data-webdav-browse]')?.click());
    await sleep(1500);
    const panel = await page.evaluate(() => ({
      open: !!document.querySelector('[data-webdav-browse-panel]'),
      current: (document.querySelector('[data-webdav-browse-panel]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      dirs: document.querySelectorAll('[data-webdav-browse-dir]').length,
      useCurrent: !!document.querySelector('[data-webdav-use-current]'),
    }));
    check('点「查看远程目录」出现目录选择面板', panel.open === true, JSON.stringify(panel));
    check('面板显示当前路径并可选当前目录', panel.useCurrent === true && /当前：/.test(panel.current), JSON.stringify(panel));
    // 不点目录、不保存，直接关掉面板。
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-webdav-browse-panel] button')];
      buttons.find((b) => b.textContent.trim() === '关闭')?.click();
    });
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
