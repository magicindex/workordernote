/** 用户头像改为生成的几何头像，不再用首字文字（用户 2026-11-14）。 */
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
    await page.goto(BASE + '/admin/profile', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    const profile = await page.evaluate(() => {
      const el = document.querySelector('[data-user-avatar]');
      return {
        avatar: !!el,
        text: (el?.textContent || '').trim(),
        rects: el?.querySelectorAll('svg rect').length || 0,
        topbar: !!document.querySelector('a[href="/admin/profile"] [data-user-avatar]'),
      };
    });
    check('个人页头像是生成图，不是文字', profile.avatar && profile.text === '' && profile.rects >= 4, JSON.stringify(profile));
    check('顶栏头像也使用生成图', profile.topbar === true, JSON.stringify(profile));
    const firstHtml = await page.evaluate(() => document.querySelector('[data-user-avatar]')?.innerHTML || '');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1000);
    const secondHtml = await page.evaluate(() => document.querySelector('[data-user-avatar]')?.innerHTML || '');
    check('同一用户刷新后头像保持一致', !!firstHtml && firstHtml === secondHtml);
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
