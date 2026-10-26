/**
 * 内置栏目开关：信用卡 / 仪式感关掉后，侧栏、清单接口、条目接口与手机清单弹层
 * 都要立刻按关闭处理；重新打开立刻恢复。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-136.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

async function api(page, path, method = 'GET', body = null) {
  return page.evaluate(async ({ base, path, method, body }) => {
    const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* noop */ }
    return { status: res.status, body: json, text };
  }, { base: BASE, path, method, body });
}

const flagSelector = (key) => `[data-config-key="${key}"] [role="switch"]`;

async function setFlag(page, key, on) {
  const sel = flagSelector(key);
  await page.waitForSelector(sel, { timeout: 15000 });
  const current = await page.$eval(sel, (el) => el.getAttribute('aria-checked') === 'true');
  if (current !== on) {
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
    await sleep(250);
    await page.click(sel);
    await sleep(600);
  }
  const after = await page.$eval(sel, (el) => el.getAttribute('aria-checked') === 'true');
  if (after !== on) throw new Error(`开关 ${key} 没有切到 ${on}`);
}

const listTemplates = async (page) => {
  const r = await api(page, '/api/reminder/lists');
  return (r.body?.data || []).map((l) => l.template);
};
const listIDs = async (page) => {
  const r = await api(page, '/api/reminder/items?view=all&status=all');
  const rows = r.body?.data || [];
  return [...new Set(rows.map((x) => x.list_id))];
};

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    const original = {};
    for (const key of ['credit_card_enabled', 'ceremony_enabled']) {
      original[key] = await page.$eval(flagSelector(key), (el) => el.getAttribute('aria-checked') === 'true');
    }
    try {
      // ---------- 仪式感：关掉立刻从侧栏 / lists / items 消失 ----------
      await setFlag(page, 'ceremony_enabled', false);
      check('仪式感关掉后侧栏立刻隐藏', await page.evaluate(() => !document.querySelector('[data-nav-ceremony]')));
      check('仪式感关掉后 lists 不再返回该栏目', !(await listTemplates(page)).includes('ceremony'));
      check('仪式感关掉后 all 条目不再包含 101', !(await listIDs(page)).includes(101));
      await setFlag(page, 'ceremony_enabled', true);
      check('仪式感重新打开后侧栏立刻恢复', await page.evaluate(() => !!document.querySelector('[data-nav-ceremony]')));
      check('仪式感重新打开后 lists 恢复', (await listTemplates(page)).includes('ceremony'));

      // ---------- 信用卡：同上 ----------
      await setFlag(page, 'credit_card_enabled', false);
      check('信用卡关掉后侧栏立刻隐藏', await page.evaluate(() => !document.querySelector('[data-nav-cards]')));
      check('信用卡关掉后 lists 不再返回该栏目', !(await listTemplates(page)).includes('credit_card'));
      check('信用卡关掉后 all 条目不再包含 13', !(await listIDs(page)).includes(13));
      await setFlag(page, 'credit_card_enabled', true);
      check('信用卡重新打开后侧栏立刻恢复', await page.evaluate(() => !!document.querySelector('[data-nav-cards]')));

      // ---------- 手机清单弹层同样即时 ----------
      await page.setViewport({ width: 390, height: 844, isMobile: true });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1000);
      await setFlag(page, 'ceremony_enabled', false);
      await page.click('[data-tab-lists]');
      await sleep(400);
      const sheetText = await page.$eval('[data-lists-sheet]', (el) => el.innerText);
      check('手机清单弹层不再显示已关闭的仪式感', !sheetText.includes('人生要有仪式感'));
      await page.click('[data-lists-sheet-close]');
      await setFlag(page, 'ceremony_enabled', true);
    } finally {
      // 无论断言是否失败都恢复用户原值。
      for (const key of ['credit_card_enabled', 'ceremony_enabled']) {
        await api(page, '/api/configs', 'PUT', { key, value: original[key] ? 'true' : 'false' }).catch(() => {});
      }
    }
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
