/**
 * 拉取某个实例的**全部程序设置**（系统级 + 当前用户的个人偏好），供跨实例比对用。
 * 用法：node dump-configs.js http://127.0.0.1:8906 [输出json]
 */
const { withTab } = require('./harness');
const { login } = require('./reminders-app');
const fs = require('fs');

const BASE = (process.argv[2] || process.env.APP_URL || 'http://127.0.0.1:8918').replace(/\/$/, '');
const OUT = process.argv[3] || '';

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const data = await page.evaluate(async (base) => {
      const t = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const h = { Authorization: 'Bearer ' + t };
      const get = async (p) => { try { const j = await (await fetch(base + p, { headers: h })).json(); return j?.data; } catch { return null; } };
      const sys = await get('/api/configs');              // 系统级（管理员视角，user_id=0）
      const pub = await get('/api/configs/public');       // 公开值（前端实际用的）
      const userMeta = await get('/api/configs/user/meta'); // 个人偏好（含默认值）
      const user = {};
      for (const it of (userMeta || [])) user[it.key] = it.value;
      return { sys: sys || {}, pub: pub || {}, user };
    }, BASE);
    const out = { base: BASE, sys: data.sys, pub: data.pub, user: data.user };
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(BASE, '系统项', Object.keys(data.sys).length, '公开项', Object.keys(data.pub).length, '个人项', Object.keys(data.user).length);
  });
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
