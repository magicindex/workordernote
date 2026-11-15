/** 偏好设置 → 提醒：当天任务提醒（开始后 1/2/4/8 小时；0 关闭）用户 2026-11-15。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });
const configs = async (page) => (await api(page, '/api/configs')).body?.data || {};
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = await configs(page);
    try {
      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const ui = await page.evaluate(() => {
        const row = document.querySelector('[data-config-key="reminder_same_day_hours"]');
        const sel = row?.querySelector('select');
        return {
          row: !!row,
          select: !!sel,
          value: sel?.value || '',
          options: sel ? [...sel.querySelectorAll('option')].map((o) => ({ value: o.value, text: (o.textContent || '').trim() })) : [],
          note: (row?.textContent || '').replace(/\s+/g, ' ').trim(),
        };
      });
      check('提醒设置里有「当天任务提醒」', ui.row && ui.select, JSON.stringify(ui));
      check('选项为关闭 / 1 / 2 / 4 / 8 小时', ui.options.map((o) => o.value).join(',') === '0,1,2,4,8' && ui.options[0].text.includes('关闭') && ui.options[1].text.includes('1 小时'), JSON.stringify(ui.options));
      check('说明写明距开始不足不提醒', ui.note.includes('距开始不足该小时数则不提醒'), ui.note);

      await page.select('[data-config-key="reminder_same_day_hours"] select', '2');
      await page.evaluate(() => {
        const row = document.querySelector('[data-config-key="reminder_same_day_hours"]');
        const btn = [...(row?.querySelectorAll('button') || [])].find((b) => (b.textContent || '').includes('保存'));
        btn?.click();
      });
      await sleep(900);
      const saved = String((await configs(page)).reminder_same_day_hours || '');
      check('选择 2 小时后保存到当前用户', saved === '2', saved);
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'reminder_same_day_hours', value: String(original.reminder_same_day_hours ?? '0') });
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
