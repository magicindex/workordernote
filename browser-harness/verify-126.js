/**
 * 「今天」改名「待办」+ 内容改成近 7 天 + 清单页按钮文案（用户 2026-10-16 原话：
 * 「智能清单  今天  改为待办，今天页面 内容显示 改为 今天 明天 后天；
 *   所有 清单页面里面的 + 新建 按钮  改成 +新建提示」）。
 * 追问后用户确认：内容＝「近期待办（7 天）：今天到第 7 天」；按钮写「+ 新建提醒」；
 * 侧栏和页面标题都改「待办」。
 *
 * 钉住这几条：
 *   1) 侧栏智能清单与手机底部标签都叫「待办」，不再有「今天」（列表视图的入口没变，还是 /admin）；
 *   2) 页面标题是「待办」，副标题写出「今天 – 第 7 天」这一段区间；
 *   3) 窗口＝今天到第 7 天：+2 天的条目落在「后天」卡片里、+4 天的在（窗口内）、
 *      +9 天的不在待办页（对照组：它在「计划」页能找到，说明数据确实建好了）；
 *   4) 待办页 / 计划页的收起按钮文案是「新建提醒」（原来只有「新建」）。
 *
 * 会写数据：用 API 建 3 条「自检」提醒（+2 / +4 / +9 天），收尾全部删掉并回读确认。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-126.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}

/** 页面内直接打接口（带登录 token）——只传一个参数，puppeteer 的 evaluate 限制。 */
async function api(page, p, method = 'GET', body = null) {
  return page.evaluate(async ({ base, p, method, body }) => {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + p, {
      method, headers, cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* 非 JSON 就当空 */ }
    return { status: res.status, body: json };
  }, { base: BASE, p, method, body });
}

/** 今天 23:59 往后 n 天（本地时区），转成 ISO 交给接口。 */
function dueInDays(n) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 23, 59, 0).toISOString();
}

const created = [];

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    try {
      // ============ 0. 先用接口把 3 条自检数据建好 ============
      for (const [title, days] of [['自检·两天后', 2], ['自检·四天后', 4], ['自检·九天后', 9]]) {
        const res = await api(page, '/api/reminder/items', 'POST', {
          title, due_at: dueInDays(days), repeat_rule: 'none',
        });
        if (res.body?.data?.id) created.push({ id: res.body.data.id, title });
      }
      check('自检数据建好了（+2 / +4 / +9 天各一条）', created.length === 3, JSON.stringify(created));

      // ============ 1. 侧栏与手机标签：待办（不再有「今天」） ============
      await gotoRetry(page, BASE + '/admin');
      await sleep(2600);
      const nav = await page.evaluate(() => ({
        rail: [...document.querySelectorAll('aside a')].map((a) => (a.textContent || '').trim()),
        tabs: [...document.querySelectorAll('.mobile-tab small')].map((s) => (s.textContent || '').trim()),
      }));
      // 侧栏条目带角标数字（「待办6」），所以按前缀认
      check('侧栏智能清单里有「待办」', nav.rail.some((t) => /^待办/.test(t)), JSON.stringify(nav.rail));
      check('侧栏不再有「今天」这一项', !nav.rail.some((t) => /^今天/.test(t)), JSON.stringify(nav.rail));

      // ============ 2. 页面标题与副标题 ============
      const head = await page.evaluate(() => {
        const h1s = [...document.querySelectorAll('h1')].map((h) => (h.textContent || '').trim());
        const eyebrow = [...document.querySelectorAll('div,span,p')]
          .map((e) => (e.textContent || '').trim()).find((t) => t === '近 7 天要办的') || '';
        const sub = [...document.querySelectorAll('p')].map((p) => (p.textContent || '').trim())
          .find((t) => /\d+月\d+日.*[–-].*\d+月\d+日/.test(t)) || '';
        return { h1s, eyebrow, sub };
      });
      check('页面标题是「待办」', head.h1s.includes('待办'), JSON.stringify(head.h1s));
      check('小标题写「近 7 天要办的」', head.eyebrow === '近 7 天要办的', head.eyebrow);
      check('副标题写出区间（今天 – 第 7 天）', !!head.sub, head.sub || '没找到区间文案');

      // ============ 3. 窗口：+2 / +4 在，+9 不在 ============
      const onToday = await page.evaluate((titles) => {
        const rows = [...document.querySelectorAll('[data-reminder-row]')].map((r) => (r.textContent || ''));
        const groups = {};
        document.querySelectorAll('[data-day-group]').forEach((g) => {
          groups[g.getAttribute('data-day-group')] = (g.querySelector('.day-card-label')?.textContent || '').trim();
        });
        const found = {};
        titles.forEach((t) => { found[t] = rows.some((txt) => txt.includes(t)); });
        return { found, groups };
      }, created.map((c) => c.title));
      check('窗口内：「自检·两天后」在待办页', onToday.found['自检·两天后'] === true);
      check('窗口内：「自检·四天后」在待办页', onToday.found['自检·四天后'] === true);
      check('窗口外：「自检·九天后」不在待办页', onToday.found['自检·九天后'] === false, JSON.stringify(onToday.found));
      const labels = Object.values(onToday.groups);
      check('第 2 天的卡片标着「后天」', labels.some((l) => /^后天/.test(l)), JSON.stringify(labels));

      // ============ 4. 对照组：+9 天在「计划」页（数据确实建好了） ============
      await gotoRetry(page, BASE + '/admin/planned');
      await sleep(2400);
      const onPlanned = await page.evaluate((t) => {
        const rows = [...document.querySelectorAll('[data-reminder-row]')].map((r) => (r.textContent || ''));
        return rows.some((txt) => txt.includes(t));
      }, '自检·九天后');
      check('对照组：「自检·九天后」在计划页找得到', onPlanned === true);

      // ============ 5. 按钮文案：待办 / 计划 页都是「新建提醒」 ============
      // 2026-11-11 起桌面这两页默认展开，按钮只在收起态出现：先点圆圈＋收起再读文案
      const collapseAndRead = () => page.evaluate(async () => {
        document.querySelector('[data-quick-collapse]')?.click();
        await new Promise((r) => setTimeout(r, 350));
        return (document.querySelector('[data-quick-new]')?.textContent || '').trim();
      });
      const btnPlanned = await collapseAndRead();
      check('计划页收起按钮写着「新建提醒」', /新建提醒/.test(btnPlanned), btnPlanned);
      await gotoRetry(page, BASE + '/admin');
      await sleep(2200);
      const btnToday = await collapseAndRead();
      check('待办页收起按钮写着「新建提醒」', /新建提醒/.test(btnToday), btnToday);

      // ============ 6. 手机底部标签 ============
      await page.setViewport({ width: 390, height: 844 });
      await gotoRetry(page, BASE + '/admin');
      await sleep(2200);
      const tabs = await page.evaluate(() => [...document.querySelectorAll('.mobile-tab small')].map((s) => (s.textContent || '').trim()));
      check('手机底部标签也叫「待办」', tabs.includes('待办') && !tabs.includes('今天'), JSON.stringify(tabs));
      await page.setViewport({ width: 1440, height: 1000 });
    } finally {
      // ============ 收尾：删掉自检数据并回读 ============
      for (const c of created) await api(page, `/api/reminder/items/${c.id}`, 'DELETE');
      const left = await api(page, '/api/reminder/items?view=all&range=year');
      const rows = left.body?.data?.items || left.body?.data || [];
      const rest = (Array.isArray(rows) ? rows : []).filter((r) => String(r.title || '').startsWith('自检·'));
      check('收尾：自检数据都删干净了', rest.length === 0, JSON.stringify(rest.map((r) => r.title)));
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})();
