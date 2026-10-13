/**
 * 临时探查：① 初次登录后侧栏为什么不显示信用卡栏目；② 偏好设置里的开关错位到哪了。
 * 用法：APP_URL=http://127.0.0.1:8908 node probe-credit.js
 */
const { withTab, sleep } = require('./harness');
const { APP, USER, PASS } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

(async () => {
  await withTab(async (page) => {
    // 干净访客：清掉本地登录态，再从登录页正常登录（复现「初次加载」）
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 40; i += 1) {
      if (await page.evaluate(() => !!document.querySelector('input[type="password"]'))) break;
      await sleep(250);
    }
    await page.evaluate(({ u, p }) => {
      const set = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('input[autocomplete="username"], input[name="username"]'), u);
      set(document.querySelector('input[type="password"]'), p);
      document.querySelector('form button[type="submit"]')?.click();
    }, { u: USER, p: PASS });

    for (let i = 0; i < 60; i += 1) {
      if (await page.evaluate(() => location.pathname.startsWith('/admin'))) break;
      await sleep(300);
    }
    await sleep(2500);

    const after = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token');
      const cfg = await (await fetch(base + '/api/configs', { headers: { Authorization: 'Bearer ' + token } })).json();
      const lists = await (await fetch(base + '/api/reminder/lists', { headers: { Authorization: 'Bearer ' + token } })).json();
      return {
        path: location.pathname,
        navCards: !!document.querySelector('[data-nav-cards]'),
        serverFlag: cfg?.data?.credit_card_enabled,
        bucket: (lists?.data || []).find((l) => l.template === 'credit_card') || null,
        // 侧栏有没有渲染「信用卡账单」这一行
        navText: [...document.querySelectorAll('.nav-row')].map((a) => a.innerText.replace(/\s+/g, ' ').trim()).slice(0, 12),
      };
    }, BASE);
    console.log('  登录后（未进偏好设置）：', JSON.stringify({ path: after.path, navCards: after.navCards, serverFlag: after.serverFlag, bucket: after.bucket?.name, navText: after.navText }));

    // 进偏好设置页，量一下开关的几何
    await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    const toggle = await page.evaluate(() => {
      const sw = document.querySelector('[role="switch"]');
      if (!sw) return { found: false };
      const knob = sw.querySelector('span');
      const row = sw.closest('.surface, .rounded-2xl, li, div');
      const r = sw.getBoundingClientRect();
      const k = knob?.getBoundingClientRect();
      const rowR = row?.getBoundingClientRect();
      return {
        found: true,
        switch: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        knob: k ? { x: Math.round(k.x), y: Math.round(k.y), w: Math.round(k.width), h: Math.round(k.height) } : null,
        knobOffsetTop: k ? Math.round(k.y - r.y) : null,
        knobOffsetLeft: k ? Math.round(k.x - r.x) : null,
        rowBox: rowR ? { x: Math.round(rowR.x), y: Math.round(rowR.y), w: Math.round(rowR.width), h: Math.round(rowR.height) } : null,
        label: sw.getAttribute('aria-label'),
        checked: sw.getAttribute('aria-checked'),
        inlineStyle: getComputedStyle(knob).cssText ? { mt: getComputedStyle(knob).marginTop, transform: getComputedStyle(knob).transform } : null,
        otherControls: [...document.querySelectorAll('[role="switch"]')].length,
      };
    });
    console.log('  偏好设置里的开关几何：', JSON.stringify(toggle));
    const navAfter = await page.evaluate(() => !!document.querySelector('[data-nav-cards]'));
    console.log('  进过偏好设置之后侧栏有信用卡栏目：', navAfter);
    await page.screenshot({ path: require('path').join(__dirname, 'shots', 'probe-credit-toggle.png') });
  });
})().catch((err) => { console.error('探查失败：', err.message); process.exit(1); });
