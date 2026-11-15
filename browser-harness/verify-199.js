/** 手机短信通知已取消：渠道不再出现，通知中心不保留短信失败记录。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const api = (page, p) => page.evaluate(async ({ base, p }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
  return await res.json().catch(() => null);
}, { base: BASE, p });
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);
    const channels = (await api(page, '/api/reminder/channels')).data || [];
    check('通知渠道里不再有手机短信', !channels.some((c) => c.channel === 'sms' || c.label === '手机短信'), JSON.stringify(channels.map((c) => c.channel)));
    const notes = (await api(page, '/api/reminder/notifications')).data || [];
    check('通知中心不显示短信记录', !notes.some((n) => String(n.body || '').startsWith('手机短信：')), JSON.stringify(notes.filter((n) => String(n.body || '').includes('短信')).slice(0, 3)));
    await page.goto(BASE + '/admin/channels', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    const text = await page.evaluate(() => document.querySelector('main')?.innerText || '');
    check('通知方式页面没有手机短信卡片', !/手机短信/.test(text), text.slice(0, 80));
  }, { width: 1280, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
