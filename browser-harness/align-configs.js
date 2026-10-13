/**
 * 把一个实例的程序设置对齐到「源实例（默认 201）」：
 *   · 系统级配置（/api/configs，管理员写）—— 只补/改有差异的项；
 *   · 个人偏好（同一账号）—— 同样对齐。
 * 用法：node align-configs.js <目标URL> <源JSON> [--dry]
 */
const { withTab } = require('./harness');
const { login } = require('./reminders-app');
const fs = require('fs');

const TARGET = (process.argv[2] || '').replace(/\/$/, '');
const SRC = process.argv[3];
const DRY = process.argv.includes('--dry');
if (!TARGET || !SRC) { console.error('用法：node align-configs.js <目标URL> <源JSON> [--dry]'); process.exit(2); }
const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));

(async () => {
  await withTab(async (page) => {
    await login(page, TARGET);
    const before = await page.evaluate(async (base) => {
      const t = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const h = { Authorization: 'Bearer ' + t };
      const get = async (p) => { try { const j = await (await fetch(base + p, { headers: h })).json(); return j?.data || {}; } catch { return {}; } };
      const meta = await get('/api/configs/user/meta');
      const user = {}; for (const it of (Array.isArray(meta) ? meta : [])) user[it.key] = it.value;
      return { sys: await get('/api/configs'), pub: await get('/api/configs/public'), user };
    }, TARGET);

    // 系统级：源里有的键（含空字符串）都对齐；目标缺失的也补上
    const sysPlan = [];
    for (const [key, want] of Object.entries(src.sys)) {
      const have = before.sys[key];
      if (have === undefined || String(have) !== String(want)) sysPlan.push([key, String(want), have === undefined ? '缺失' : have]);
    }
    // 个人偏好：只动两边都登记的键（避免给目标写它不认识的项）
    const userPlan = [];
    for (const [key, want] of Object.entries(src.user)) {
      const have = before.user[key];
      if (have === undefined) continue;
      if (String(have) !== String(want)) userPlan.push([key, String(want), have]);
    }
    console.log(`目标 ${TARGET}`);
    console.log(`  系统级需改 ${sysPlan.length} 项：` + JSON.stringify(sysPlan));
    console.log(`  个人偏好需改 ${userPlan.length} 项：` + JSON.stringify(userPlan));
    if (DRY) return;

    const apply = async (key, value) => page.evaluate(async ({ base, key, value }) => {
      const t = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/configs', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const j = await res.json().catch(() => null);
      return { status: res.status, code: j?.code, message: j?.message };
    }, { base: TARGET, key, value });

    const fails = [];
    for (const [key, value] of [...sysPlan.map((x) => [x[0], x[1]]), ...userPlan.map((x) => [x[0], x[1]])]) {
      const r = await apply(key, value);
      if (r.status !== 200 || r.code !== 0) fails.push(`${key}=${value} → ${r.status}/${r.code} ${r.message || ''}`);
    }
    console.log('  写入失败：', fails.length ? JSON.stringify(fails) : '无');
  });
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
