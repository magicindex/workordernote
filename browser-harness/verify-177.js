/**
 * WebDAV 服务器地址与路径同行；远程目录逐级下钻选择（用户 2026-11-14）。
 * 只读：不保存配置，点确定只改页面上的路径输入框。
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
const browseState = (page) => page.evaluate(() => ({
  modal: !!document.querySelector('[data-webdav-browse-panel]'),
  current: (document.querySelector('[data-webdav-browse-panel] p.font-mono')?.textContent || '').replace(/\s+/g, ' ').trim(),
  dirs: document.querySelectorAll('[data-webdav-browse-dir]').length,
  parentDisabled: !!document.querySelector('[data-webdav-parent]')?.disabled,
  confirm: !!document.querySelector('[data-webdav-use-current]'),
  pathInput: document.querySelector('[data-webdav-path]')?.value || '',
}));
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const layout = await page.evaluate(() => {
      const row = document.querySelector('[data-webdav-address-row]');
      return {
        hasRow: !!row,
        server: !!document.querySelector('[data-webdav-server]'),
        path: !!document.querySelector('[data-webdav-path]'),
        browse: !!document.querySelector('[data-webdav-browse]'),
        sameRow: !!row?.contains(document.querySelector('[data-webdav-server]')) && !!row?.contains(document.querySelector('[data-webdav-path]')),
      };
    });
    check('服务器地址与路径在同一个地址行', layout.hasRow && layout.sameRow, JSON.stringify(layout));
    check('地址行有服务器地址、路径、查看远程目录', layout.server && layout.path && layout.browse, JSON.stringify(layout));

    await page.evaluate(() => document.querySelector('[data-webdav-browse]')?.click());
    await sleep(1500);
    const first = await browseState(page);
    check('点「查看远程目录」弹出逐级导航弹窗', first.modal === true, JSON.stringify(first));
    check('弹窗有上一级、确定选择，并显示当前路径', first.confirm && /当前：/.test(first.current) && first.parentDisabled === true, JSON.stringify(first));

    if (first.dirs > 0) {
      await page.evaluate(() => document.querySelector('[data-webdav-browse-dir]')?.click());
      await sleep(1300);
      const second = await browseState(page);
      check('点目录只下一级，弹窗保持打开', second.modal === true && second.current !== first.current, `${first.current} → ${second.current}`);
      await page.evaluate(() => document.querySelector('[data-webdav-parent]')?.click());
      await sleep(1300);
      const back = await browseState(page);
      check('「上一级」能返回上一层', back.modal === true && back.current === first.current, `${second.current} → ${back.current}`);
      await page.evaluate(() => document.querySelector('[data-webdav-use-current]')?.click());
      await sleep(400);
      const done = await browseState(page);
      const want = first.current.includes('（根目录）') ? '' : first.current.replace(/^当前：\//, '').replace(/\s+/g, '');
      check('点「确定选择」关闭弹窗并把路径写回输入框', done.modal === false && done.pathInput === want, JSON.stringify({ done, want }));
    } else {
      await page.evaluate(() => document.querySelector('[data-webdav-use-current]')?.click());
      await sleep(400);
      const done = await browseState(page);
      check('根目录下点「确定选择」也能写回输入框', done.modal === false, JSON.stringify(done));
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
