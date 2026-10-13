/** 临时：打印信用卡页实际渲染顺序，用于人工核对排序。用法 APP_URL=... node probe-order.js */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const data = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token');
      const cards = (await (await fetch(base + '/api/reminder/cards', { headers: { Authorization: 'Bearer ' + token } })).json()).data;
      const lists = (await (await fetch(base + '/api/reminder/lists', { headers: { Authorization: 'Bearer ' + token } })).json()).data;
      return { cards, bucket: lists.find((l) => l.template === 'credit_card') };
    }, BASE);
    await page.goto(`${BASE}/admin/list/${data.bucket.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 40; i += 1) {
      if (await page.evaluate(() => !!document.querySelector('[data-card-item]'))) break;
      await sleep(250);
    }
    await sleep(1000);
    const midnight = new Date(new Date().toDateString()).getTime();
    const left = (c) => (c.current?.due_date ? Math.round((new Date(c.current.due_date).getTime() - midnight) / 86400000) : 9999);
    const byId = new Map(data.cards.map((c) => [String(c.id), c]));
    const dom = await page.evaluate(() => [...document.querySelectorAll('[data-card-item]')].map((el) => el.getAttribute('data-card-item')));
    console.log('页面实际顺序（智能排序）：');
    dom.forEach((id, i) => {
      const c = byId.get(String(id)) || {};
      console.log(`  ${i + 1}. ${c.bank || ''} ${c.name || ''}｜账单日 ${c.statement_day} / 还款日 ${c.due_day}｜本期还款 ${String(c.current?.due_date || '').slice(0, 10)}｜剩 ${left(c)} 天`);
    });
  });
})().catch((e) => { console.error(e.message); process.exit(1); });
