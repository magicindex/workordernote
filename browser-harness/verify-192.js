/** 提醒@他：手机端「别人提醒我」在上、「我提醒他人」在下；桌面仍左发右收（用户 2026-11-15）。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const columns = (page) => page.evaluate(() => {
  const get = (k) => document.querySelector(`[data-nudge-column="${k}"]`)?.getBoundingClientRect();
  const sent = get('sent');
  const received = get('received');
  return {
    sent: sent ? { top: Math.round(sent.top), left: Math.round(sent.left) } : null,
    received: received ? { top: Math.round(received.top), left: Math.round(received.left) } : null,
  };
});
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(BASE + '/admin/nudges', { waitUntil: 'domcontentloaded' });
    await sleep(1600);
    const mobile = await columns(page);
    check('手机端「别人提醒我」在上', mobile.received && mobile.sent && mobile.received.top < mobile.sent.top, JSON.stringify(mobile));

    await page.setViewport({ width: 1280, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1400);
    const desktop = await columns(page);
    check('桌面端仍是左「我提醒他人」右「别人提醒我」', desktop.sent && desktop.received && desktop.sent.left < desktop.received.left && Math.abs(desktop.sent.top - desktop.received.top) < 8, JSON.stringify(desktop));
  }, { width: 390, height: 844 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
