/** 清单筛选：装得下时不出「更多」；装不下才出，且右端与月历大卡片对齐。 */
const { withTab, sleep } = require('./harness');
const { USER, PASS } = require('./reminders-app');
const BASE = (process.env.APP_URL || 'http://127.0.0.1:8919').replace(/\/$/, '');
const NAME = `flt_${Date.now()}`;
const PASS2 = 'Flt!123456';
let passed = 0, failed = 0;
const check = (n, ok, x = '') => { ok ? (passed++, console.log('  ✓ ' + n)) : (failed++, console.log('  ✗ ' + n + (x ? ' — ' + x : ''))); };
async function req(p, method = 'GET', body = '', token = '') {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.code !== 0) throw new Error(`${method} ${p} ${r.status} ${JSON.stringify(d)}`);
  return d.data;
}
(async () => {
  let uid = 0, token = '', admin = '';
  try {
    const reg = await req('/api/auth/register', 'POST', { username: NAME, password: PASS2 });
    uid = Number(reg.user.id); token = reg.token;
    admin = (await req('/api/auth/login', 'POST', { username: USER, password: PASS })).token;
    await withTab(async (page) => {
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => localStorage.setItem('reminders.token', t), token);
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-list-filter]', { timeout: 8000 }).catch(() => {});
      await sleep(600);
      for (const b of await page.$$('button')) if ((await b.evaluate(el => el.textContent || '')).includes('知道了')) { await b.click(); await sleep(300); break; }
      const read = () => page.evaluate(() => {
        const f = document.querySelector('[data-list-filter]');
        const g = document.querySelector('[data-month-grid]');
        return {
          chips: document.querySelectorAll('[data-list-chip]').length,
          more: !!document.querySelector('[data-list-filter-more]'),
          filterRight: f ? Math.round(f.getBoundingClientRect().right) : 0,
          gridRight: g ? Math.round((g.closest('.surface') || g).getBoundingClientRect().right) : 0,
        };
      });
      const few = await read();
      check('新账号默认清单能全部展示', few.chips >= 1 && !few.more, JSON.stringify(few));
      check('没有更多时筛选右端贴大卡片', Math.abs(few.filterRight - few.gridRight) <= 4, JSON.stringify(few));

      for (let i = 0; i < 12; i++) await req('/api/reminder/lists', 'POST', { name: `筛选${i}`, color: 'blue', icon: 'list' }, token);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const many = await read();
      check('清单装不下时出现更多', many.more, JSON.stringify(many));
      check('更多时筛选右端仍贴大卡片', Math.abs(many.filterRight - many.gridRight) <= 4, JSON.stringify(many));
      await page.screenshot({ path: require('path').join(__dirname, 'shots', 'verify-159-more-fit.png') });
    }, { width: 1440, height: 1000 });
  } finally {
    if (admin && uid) await req(`/api/users/${uid}`, 'DELETE', '', admin).catch(() => {});
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
