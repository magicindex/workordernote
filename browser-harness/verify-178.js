/**
 * 本机备份目录逐级下钻选择（用户 2026-11-14）：弹窗从数据目录开始，点目录下钻、
 * 支持上一级；确定后把目录写回输入框，不自动保存。
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
const state = (page) => page.evaluate(() => ({
  modal: !!document.querySelector('[data-backup-local-browse-panel]'),
  current: (document.querySelector('[data-backup-local-browse-panel] p.font-mono')?.textContent || '').replace(/\s+/g, ' ').trim(),
  dirs: document.querySelectorAll('[data-backup-local-browse-dir]').length,
  parentDisabled: !!document.querySelector('[data-backup-local-browse-parent]')?.disabled,
  confirm: !!document.querySelector('[data-backup-local-browse-confirm]'),
  input: document.querySelector('[data-backup-local-dir]')?.value || '',
}));
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const ui = await page.evaluate(() => ({
      panel: !!document.querySelector('[data-backup-local]'),
      browse: !!document.querySelector('[data-backup-local-browse]'),
      def: !!document.querySelector('[data-backup-local-default]'),
    }));
    check('本机备份里有「选择目录」和「默认目录」', ui.panel && ui.browse && ui.def, JSON.stringify(ui));

    await page.evaluate(() => document.querySelector('[data-backup-local-browse]')?.click());
    await sleep(900);
    const first = await state(page);
    check('点选择目录弹出本机目录弹窗', first.modal === true, JSON.stringify(first));
    check('弹窗有上一级/确定选择并显示当前目录', first.confirm && /当前：/.test(first.current), JSON.stringify(first));

    if (first.dirs > 0) {
      await page.evaluate(() => document.querySelector('[data-backup-local-browse-dir]')?.click());
      await sleep(700);
      const second = await state(page);
      check('点目录只下一级，弹窗保持打开', second.modal === true && second.current !== first.current, `${first.current} → ${second.current}`);
      await page.evaluate(() => document.querySelector('[data-backup-local-browse-parent]')?.click());
      await sleep(700);
      const back = await state(page);
      check('上一级能返回', back.modal === true && back.current === first.current, `${second.current} → ${back.current}`);
      await page.evaluate(() => document.querySelector('[data-backup-local-browse-dir]')?.click());
      await sleep(700);
      const picked = await state(page);
      await page.evaluate(() => document.querySelector('[data-backup-local-browse-confirm]')?.click());
      await sleep(300);
      const done = await state(page);
      check('确定选择关闭弹窗并写回目录输入框', done.modal === false && !!done.input && done.input !== first.input, JSON.stringify({ done, picked }));
    } else {
      check('数据目录下没有子目录（当前环境）', false, JSON.stringify(first));
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
