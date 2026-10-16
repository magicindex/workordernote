/**
 * 手机端「内容超出屏幕自动换行」（用户 2026-10-16 要求）：
 *
 *   「手机页面显示，增加换行功能，当内容超出屏幕后自动换行」
 *
 * 之前窄屏上长标题 / 长备注是被 `truncate` 切掉加省略号的——用户在手机上看到的是
 * 「9月份非立项及自主施工项目情…」。改成：手机宽度下让文字换行、一个字都不丢；
 * 桌面宽度（≥ sm 断点）保持原来的单行省略观感（这次只动手机端）。
 *
 * 钉住这几条：
 *   1. 390px（常见手机）下，长标题**换行显示**（不是 nowrap + 省略号），且占两行以上；
 *   2. 标题文字**没被吃掉**（页面上读到的就是完整标题）；
 *   3. 长备注同样换行；
 *   4. 整页没有横向溢出（scrollWidth ≤ 屏宽 + 1）；
 *   5. 320px（最窄的手机）下同样成立；
 *   6. 1280px 桌面下仍然是单行省略（桌面观感不变）；
 *   7. 「待办」与「全部」两个列表页（同一个列表组件）都成立；首页看板本来就换行，一并确认。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-127.js
 * 数据：临时造 1 条长标题 + 长备注的提醒，跑完删掉并回读确认。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const LONG_TITLE = `自检长标题-${STAMP}-`
  + '这是一条故意写得很长的提醒标题，用来验证手机上会不会换行显示而不是被省略号切掉后面半句话';
const LONG_NOTES = `自检长备注-${STAMP}-`
  + '备注也要能换行：账单日每月 12 号、还款日每月 2 号，账单日到还款日之间会一直提醒，括号里是尾号 8997。';

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

/** 页面内直接打接口（带登录 token）——puppeteer 的 evaluate 只能传一个参数。 */
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

/** 读某条提醒那一行里标题 / 备注的排版状态。 */
async function readRow(page, id) {
  return page.evaluate((rid) => {
    const row = document.querySelector(`[data-reminder-row="${rid}"]`);
    if (!row) return null;
    const box = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const lh = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.5;
      const h = el.getBoundingClientRect().height;
      return {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow,
        lines: Math.max(1, Math.round(h / lh)),
        clipped: el.scrollWidth > el.clientWidth + 1,
      };
    };
    return {
      title: box(row.querySelector('h3')),
      notes: box(row.querySelector('p')),
      vw: window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
    };
  }, id);
}

const created = [];

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    try {
      // ---------- 0. 造一条长标题 + 长备注的提醒 ----------
      const now = new Date();
      const made = await api(page, '/api/reminder/items', 'POST', {
        title: LONG_TITLE,
        notes: LONG_NOTES,
        due_at: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0).toISOString(),
        repeat_rule: 'none',
        channels: ['inapp'],
      });
      const id = made.body?.data?.id ?? null;
      if (id) created.push(id);
      check('自检提醒建好了（长标题 + 长备注）', !!id, `status=${made.status}`);

      // ---------- 1. 手机宽度：标题换行、字不丢、备注换行、页面不溢出 ----------
      for (const [w, pages] of [[390, ['/admin', '/admin/all']], [320, ['/admin']]]) {
        await page.setViewport({ width: w, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        for (const p of pages) {
          await gotoRetry(page, BASE + p);
          await sleep(2500);
          const info = id ? await readRow(page, id) : null;
          const label = `${w}px ${p}`;
          if (!info || !info.title) {
            check(`${label} 能找到自检那条提醒`, false, JSON.stringify(info));
            continue;
          }
          check(`${label} 长标题换行显示（不是 nowrap + 省略号）`,
            info.title.whiteSpace !== 'nowrap' && info.title.textOverflow !== 'ellipsis',
            JSON.stringify({ ws: info.title.whiteSpace, to: info.title.textOverflow }));
          check(`${label} 长标题真的占了 2 行以上`, info.title.lines >= 2, `lines=${info.title.lines}`);
          check(`${label} 标题一个字都没被吃掉`, info.title.text === LONG_TITLE,
            `「${String(info.title.text).slice(0, 40)}…」`);
          check(`${label} 长备注也换行`, !!info.notes && info.notes.whiteSpace !== 'nowrap'
            && info.notes.lines >= 2, JSON.stringify(info.notes && { ws: info.notes.whiteSpace, lines: info.notes.lines }));
          check(`${label} 整页没有横向溢出`, info.scrollW <= info.vw + 1,
            `scrollW=${info.scrollW} vw=${info.vw}`);
        }
      }

      // ---------- 2. 首页看板：标题本来就是换行的，一并确认 ----------
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await gotoRetry(page, BASE + '/admin/home');
      await sleep(2500);
      const dash = await page.evaluate((rid) => {
        const row = document.querySelector(`[data-home-item][data-home-goto="${rid}"]`);
        const h = row?.querySelector('p');
        if (!h) return null;
        const cs = getComputedStyle(h);
        return { ws: cs.whiteSpace, text: (h.textContent || '').trim(), scrollW: document.documentElement.scrollWidth, vw: window.innerWidth };
      }, id);
      check('390px 首页看板：长标题也不截断',
        !!dash && dash.ws !== 'nowrap' && dash.text === LONG_TITLE,
        JSON.stringify(dash && { ws: dash.ws, text: String(dash.text).slice(0, 30) }));
      check('390px 首页看板：整页没有横向溢出', !!dash && dash.scrollW <= dash.vw + 1,
        JSON.stringify(dash && { scrollW: dash.scrollW, vw: dash.vw }));

      // ---------- 3. 桌面宽度：保持单行省略（这次只改手机端） ----------
      await page.setViewport({ width: 1280, height: 900 });
      await gotoRetry(page, BASE + '/admin');
      await sleep(2500);
      const desk = id ? await readRow(page, id) : null;
      check('1280px 桌面：标题仍是单行省略（桌面观感不变）',
        !!desk && !!desk.title && desk.title.whiteSpace === 'nowrap' && desk.title.textOverflow === 'ellipsis',
        JSON.stringify(desk?.title && { ws: desk.title.whiteSpace, to: desk.title.textOverflow }));

      // ---------- 4. 清理 ----------
      for (const rid of created) await api(page, `/api/reminder/items/${rid}`, 'DELETE');
      const left = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data;
      const rest = (Array.isArray(left) ? left : (left?.items || []))
        .filter((i) => String(i.title).includes(String(STAMP)));
      check('清理干净：自检提醒已删除', rest.length === 0, JSON.stringify(rest.map((i) => i.title)));
    } catch (err) {
      failed += 1;
      console.log(`  ✗ 套件异常：${err.message}`);
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
