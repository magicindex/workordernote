/** 备份状态详情：本机与 WebDAV 分行显示（用户 2026-11-14）。 */
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
    await sleep(1600);
    const info = await page.evaluate(() => ({
      lines: [...document.querySelectorAll('[data-backup-detail-line]')].map((el) => (el.textContent || '').trim()),
      text: (document.querySelector('[data-backup-status]')?.innerText || '').replace(/\s+/g, ' ').trim(),
    }));
    check('备份详情按行渲染', info.lines.length >= 2, JSON.stringify(info.lines));
    check('本机与 WebDAV 各占一行', info.lines.some((l) => /^本机：/.test(l)) && info.lines.some((l) => /^WebDAV：/.test(l)), JSON.stringify(info.lines));
    check('WebDAV 路径已解码为中文', info.lines.every((l) => !/%E[0-9A-F]{2}/i.test(l)), JSON.stringify(info.lines));
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
