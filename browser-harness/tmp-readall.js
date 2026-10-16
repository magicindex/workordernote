const { withTab } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const out = await page.evaluate(async (base) => {
      const t = localStorage.getItem('reminders.token') || '';
      const h = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
      const read = await (await fetch(base + '/api/reminder/notifications/read-all', { method: 'POST', headers: h })).json();
      const st = await (await fetch(base + '/api/assistant/status', { headers: h })).json();
      return { read: read?.data, assistant: st?.data && { active: st.data.active, provider: st.data.provider, model: st.data.model, reason: st.data.reason } };
    }, BASE);
    console.log(JSON.stringify(out));
  });
})().catch((e) => { console.error(e); process.exit(1); });
