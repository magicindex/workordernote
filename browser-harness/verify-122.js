/**
 * 「首页」看板每条提醒**下面的时间信息**（用户 2026-10-15 要求）：
 *
 *   「首页，提醒下面的时间信息改为橘黄色醒目显示创建时间，结束时间，清单，剩余时间」
 *
 * 钉住这几条：
 *   1. 每条 [data-home-item] 里都有时间信息行 [data-home-meta]；
 *   2. 这一行是**橘黄色加粗**（浅色主题 = orange-500，深色主题 = orange-400）；
 *   3. 四项都在：[data-home-created]（创建）/ [data-home-due]（结束）/
 *      [data-home-list]（清单，有清单名时）/ [data-home-remaining]（剩余）；
 *   4. 创建时间与结束时间都带 时:分；结束时间沿用「今天 / 明天 / 后天 / M月D日」口径；
 *   5. 剩余时间沿用倒计时口径（剩余…／已逾期…），且**每条只写一次**（原来行尾那个
 *      和这一行是同一个值，不该重复显示）；
 *   6. 创建时间读的确实是这一条自己的 created_at：新造一条 → 这一行应写「今天 时:分」，
 *      且时:分与接口里的 created_at 一致。
 *
 * 数据：优先用实例里已有的行；某一列空着就临时造一条（今天 / 逾期），跑完删掉。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-122.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const T = { today: `自检首页时间-${STAMP}`, overdue: `自检首页时间逾期-${STAMP}` };

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

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

const itemsOf = (res) => {
  const d = res?.body?.data;
  return Array.isArray(d) ? d : (d?.items || []);
};

/** 读两列每一行的时间信息行 */
const readMeta = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-home-item]')];
  return rows.map((li) => {
    const meta = li.querySelector('[data-home-meta]');
    const cd = meta ? getComputedStyle(meta) : null;
    const pick = (sel) => {
      const el = li.querySelector(sel);
      return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : null;
    };
    return {
      text: (li.innerText || '').replace(/\s+/g, ' ').trim(),
      color: cd ? cd.color : null,
      weight: cd ? Number(cd.fontWeight) || 0 : 0,
      created: pick('[data-home-created]'),
      due: pick('[data-home-due]'),
      list: pick('[data-home-list]'),
      remaining: pick('[data-home-remaining]'),
      remainingCount: li.querySelectorAll('[data-home-remaining]').length,
      metaCount: li.querySelectorAll('[data-home-meta]').length,
      countdownInMeta: !!(meta && meta.querySelector('[data-home-remaining]')),
    };
  });
});

/** 橘黄色（浅色 orange-500 / 深色 orange-400 都算） */
function isOrange(css) {
  const m = /^rgba?\((\d+), (\d+), (\d+)/.exec(String(css || ''));
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return r >= 230 && g >= 90 && g <= 175 && b <= 95 && r > g && g > b;
}

(async () => {
  const created = [];
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1100 });
    await login(page, BASE);

    // ---------------- 1. 先看实例里现有的行 ----------------
    await gotoRetry(page, BASE + '/admin/home');
    await sleep(3000);
    let rows = await readMeta(page);
    check('首页看板上有条目', rows.length > 0, `共 ${rows.length} 行`);

    const colOf = (title) => page.evaluate((t) => {
      const li = [...document.querySelectorAll('[data-home-item]')].find((el) => (el.innerText || '').includes(t));
      if (!li) return null;
      const col = li.closest('[data-home-column]');
      return col ? col.getAttribute('data-home-column') : null;
    }, title);

    // 缺哪一列就补哪一列（生产数据一般两列都有）
    const hasUpcoming = await page.evaluate(() => !!document.querySelector('[data-home-column="upcoming"] [data-home-item]'));
    const hasOverdue = await page.evaluate(() => !!document.querySelector('[data-home-column="overdue"] [data-home-item]'));
    const now = new Date();
    const at = (dayOffset, hour, minute = 0) => new Date(
      now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0,
    ).toISOString();
    const plan = [];
    if (!hasUpcoming) plan.push({ title: T.today, due: at(0, 23, 59) });
    if (!hasOverdue) plan.push({ title: T.overdue, due: at(-2, 9) });
    for (const item of plan) {
      const res = await api(page, '/api/reminder/items', 'POST', {
        title: item.title, due_at: item.due, repeat_rule: 'none', channels: ['inapp'],
      });
      const id = res.body?.data?.id ?? null;
      if (id) created.push(id);
    }
    if (plan.length) {
      await gotoRetry(page, BASE + '/admin/home');
      await sleep(3000);
      rows = await readMeta(page);
    }
    check('两列都有条目可查（未来 14 天待办 / 已逾期）',
      await page.evaluate(() => !!document.querySelector('[data-home-column="upcoming"] [data-home-item]')
        && !!document.querySelector('[data-home-column="overdue"] [data-home-item]')),
      JSON.stringify({ hasUpcoming, hasOverdue, made: created.length }));

    // ---------------- 2. 每一行都有橘黄色的时间信息行 ----------------
    check('每条提醒下面都有时间信息行 [data-home-meta]',
      rows.length > 0 && rows.every((r) => r.metaCount === 1),
      JSON.stringify(rows.map((r) => r.metaCount)));
    check('时间信息行是橘黄色',
      rows.length > 0 && rows.every((r) => isOrange(r.color)),
      JSON.stringify([...new Set(rows.map((r) => r.color))]));
    check('时间信息行是加粗（醒目）',
      rows.length > 0 && rows.every((r) => r.weight >= 600),
      JSON.stringify([...new Set(rows.map((r) => r.weight))]));

    // ---------------- 3. 四项内容都在 ----------------
    check('每一项都写了「创建 时:分」',
      rows.length > 0 && rows.every((r) => /^创建 .*\d{2}:\d{2}$/.test(r.created || '')),
      JSON.stringify(rows.map((r) => r.created).slice(0, 4)));
    check('每一项都写了「结束 …」（带时:分；逾期那列写「M月D日（已过 N 天）」）',
      rows.length > 0 && rows.every((r) => {
        const s = r.due || '';
        return /^结束 /.test(s)
          && (/\d{2}:\d{2}/.test(s) || /（已过 \d+ 天）/.test(s) || s === '结束 未设日期');
      }),
      JSON.stringify(rows.map((r) => r.due)));
    check('至少有一项写了「清单 …」（条目挂在清单上时）',
      rows.some((r) => /^清单 \S/.test(r.list || '')),
      JSON.stringify(rows.map((r) => r.list).slice(0, 4)));
    check('每一项都写了「剩余 …」或「已逾期 …」',
      rows.length > 0 && rows.every((r) => /^(剩余|已逾期)/.test(r.remaining || '')),
      JSON.stringify(rows.map((r) => r.remaining).slice(0, 4)));
    check('剩余时间就在这一行里（不是行尾另起一个）',
      rows.length > 0 && rows.every((r) => r.countdownInMeta === true),
      JSON.stringify(rows.map((r) => r.countdownInMeta)));

    // ---------------- 4. 剩余时间每条只写一次 ----------------
    check('剩余 / 已逾期 每条只出现一次（不再重复显示）',
      rows.length > 0 && rows.every((r) => {
        const n = (r.text.match(/剩余|已逾期/g) || []).length;
        return n === 1 && r.remainingCount === 1;
      }),
      JSON.stringify(rows.map((r) => (r.text.match(/剩余|已逾期/g) || []).length)));

    // ---------------- 5. 创建时间读的是这一条自己的 created_at ----------------
    const madeToday = await api(page, '/api/reminder/items', 'POST', {
      title: T.today, due_at: at(0, 23, 59), repeat_rule: 'none', channels: ['inapp'],
    });
    const todayId = madeToday.body?.data?.id ?? null;
    if (todayId) created.push(todayId);
    await gotoRetry(page, BASE + '/admin/home');
    await sleep(3000);
    const fresh = await page.evaluate((id) => {
      const li = document.querySelector(`[data-home-item][data-home-goto="${id}"]`);
      const meta = li ? li.querySelector('[data-home-meta]') : null;
      return meta ? {
        created: (meta.querySelector('[data-home-created]')?.innerText || '').replace(/\s+/g, ' ').trim(),
        due: (meta.querySelector('[data-home-due]')?.innerText || '').replace(/\s+/g, ' ').trim(),
        list: (meta.querySelector('[data-home-list]')?.innerText || '').replace(/\s+/g, ' ').trim(),
        remaining: (meta.querySelector('[data-home-remaining]')?.innerText || '').replace(/\s+/g, ' ').trim(),
        color: getComputedStyle(meta).color,
      } : null;
    }, todayId);
    const createdFromApi = new Date(madeToday.body?.data?.created_at || Date.now());
    const hhmm = `${String(createdFromApi.getHours()).padStart(2, '0')}:${String(createdFromApi.getMinutes()).padStart(2, '0')}`;
    check('刚建的那条写「创建 今天 时:分」，时:分与接口的 created_at 一致',
      !!fresh && fresh.created === `创建 今天 ${hhmm}`, JSON.stringify({ fresh, hhmm }));
    check('刚建的那条「结束」是今天 23:59',
      !!fresh && /^结束 今天 23:59$/.test(fresh.due), JSON.stringify(fresh));
    check('刚建的那条也带「清单 …」', !!fresh && /^清单 \S/.test(fresh.list || ''), JSON.stringify(fresh));
    check('刚建的那条「剩余」带 时:分',
      !!fresh && /^剩余/.test(fresh.remaining || '') && /\d{2}:\d{2}/.test(fresh.remaining || ''),
      JSON.stringify(fresh));
    check('刚建的那条时间信息行同样是橘黄色', !!fresh && isOrange(fresh.color), JSON.stringify(fresh?.color));
    const freshCol = todayId ? await colOf(T.today) : null;
    check('今天到期的那条落在「未来 14 天待办」那一列', freshCol === 'upcoming', String(freshCol));

    // ---------------- 清理 ----------------
    for (const id of created) {
      await api(page, `/api/reminder/items/${id}`, 'DELETE');
    }
    const left = itemsOf(await api(page, '/api/reminder/items?view=all&status=all'))
      .filter((i) => String(i.title).includes(String(STAMP)))
      .map((i) => i.title);
    check('清理干净：自检任务都不在了', left.length === 0, JSON.stringify(left));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
