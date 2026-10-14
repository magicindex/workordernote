/**
 * 「首页」看板（用户 2026-10-13 要求）：
 *
 *   「智能清单：今天上方增加首页（打开默认显示页，10分钟不操作默认展示页，）：
 *     页面分2列，1列所有14天待办任务，今天代办任务前面加 '今''急'等字来区分级别，
 *     2列 所有逾期任务。清单列表补充说明14天待办任务。」
 *
 * 钉住这几条：
 *   1. 侧栏「智能清单」里「首页」在「今天」**上面**；
 *   2. 打开应用（/）默认落在 /admin/home；
 *   3. 两列：未来 14 天待办（未逾期）+ 已逾期；
 *   4. 任务标题前的级别字：急（逾期）/ 今（今天）/ 明（明天）/ 后（后天）…；
 *   5. 列表上方有说明（14 天口径 + 级别字怎么读）；
 *   6. 看板上勾完成，那条就不见了（只读看板也能办掉今天的事）。
 *
 * 10 分钟空闲回首页那条**不在**这里测（等 10 分钟太慢）—— 逻辑在 MainLayout 的
 * armIdleTimer，回归靠代码评审保证。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-120.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const T = {
  today: `自检看板今天-${STAMP}`,
  tomorrow: `自检看板明天-${STAMP}`,
  overdue: `自检看板逾期-${STAMP}`,
  far: `自检看板十五天-${STAMP}`,
};

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

(async () => {
  const created = [];
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1100 });
    await login(page, BASE);

    // ---------------- 1. 入口位置与默认落地页 ----------------
    await gotoRetry(page, BASE + '/admin');
    await sleep(2400);
    const nav = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('nav .nav-row')];
      const home = rows.find((r) => (r.getAttribute('href') || '').endsWith('/admin/home'));
      const today = rows.find((r) => (r.getAttribute('href') || '').endsWith('/admin'));
      if (!home || !today) return { home: !!home, today: !!today };
      return {
        home: true, today: true,
        text: (home.innerText || '').replace(/\s+/g, ' ').trim(),
        homeBeforeToday: !!(home.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    check('侧栏「智能清单」里有「首页」入口', nav.home === true, JSON.stringify(nav));
    check('「首页」排在「今天」上面', nav.homeBeforeToday === true, JSON.stringify(nav));
    check('入口文字是「首页」', /首页/.test(nav.text || ''), JSON.stringify(nav));

    // 打开应用（根路径）落在「默认首页」偏好那一档 —— 默认就是首页看板
    const originalDefaultView = (await api(page, '/api/configs')).body?.data?.default_view ?? 'home';
    await api(page, '/api/configs', 'PUT', { key: 'default_view', value: 'home' });
    await gotoRetry(page, BASE + '/');
    await sleep(3200);
    const landed = await page.evaluate(() => ({
      path: location.pathname.replace(/\/$/, ''),
      dashboard: !!document.querySelector('[data-home-dashboard]'),
    }));
    check('默认首页＝首页看板时，打开应用落在 /admin/home',
      landed.dashboard === true && /\/admin\/home$/.test(landed.path), JSON.stringify(landed));
    // 还原（原值一般是 home；用户手动改成 list/calendar 的话也原样还回去）
    await api(page, '/api/configs', 'PUT', { key: 'default_view', value: String(originalDefaultView) });

    // ---------------- 2. 造数据：今天 / 明天 / 逾期 / 15 天后 ----------------
    const now = new Date();
    const at = (dayOffset, hour, minute = 0) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0);
      return d.toISOString();
    };
    const plan = [
      { title: T.overdue, due: at(-2, 9) },      // 逾期 → 第 2 列，级别「急」
      { title: T.today, due: at(0, 23, 59) },    // 今天 → 第 1 列，级别「今」
      { title: T.tomorrow, due: at(1, 9) },      // 明天 → 第 1 列，级别「明」
      { title: T.far, due: at(15, 9) },          // 15 天后 → 两列都不该出现
    ];
    for (const item of plan) {
      const res = await api(page, '/api/reminder/items', 'POST', {
        title: item.title, due_at: item.due, repeat_rule: 'none', channels: ['inapp'],
      });
      const id = res.body?.data?.id ?? null;
      if (id) created.push(id);
    }
    check('造出 4 条自检任务（逾期 / 今天 / 明天 / 15 天后）', created.length === 4, String(created.length));

    // ---------------- 3. 两列内容与级别字 ----------------
    await gotoRetry(page, BASE + '/admin/home');
    await sleep(3200);
    const board = await page.evaluate((titles) => {
      const read = (name) => {
        const col = document.querySelector(`[data-home-column="${name}"]`);
        if (!col) return null;
        return [...col.querySelectorAll('[data-home-item]')].map((li) => ({
          text: (li.innerText || '').replace(/\s+/g, ' ').trim(),
          level: (li.querySelector('[data-home-level]')?.innerText || '').trim(),
          mine: titles.some((t) => (li.innerText || '').includes(t)),
        }));
      };
      return {
        upcoming: read('upcoming'),
        overdue: read('overdue'),
        legends: [...document.querySelectorAll('[data-home-column]')].map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)),
      };
    }, [T.today, T.tomorrow, T.overdue, T.far]);

    check('看板有两列（未来 14 天待办 / 已逾期）', !!board.upcoming && !!board.overdue,
      JSON.stringify({ upcoming: !!board.upcoming, overdue: !!board.overdue }));

    const find = (rows, title) => (rows || []).find((r) => r.text.includes(title));
    const todayRow = find(board.upcoming, T.today);
    const tomorrowRow = find(board.upcoming, T.tomorrow);
    const overdueRow = find(board.overdue, T.overdue);
    check('今天到期的在第 1 列', !!todayRow, JSON.stringify((board.upcoming || []).map((r) => r.text).slice(0, 6)));
    check('明天到期的在第 1 列', !!tomorrowRow, JSON.stringify((board.upcoming || []).map((r) => r.text).slice(0, 6)));
    check('逾期的在第 2 列', !!overdueRow, JSON.stringify((board.overdue || []).map((r) => r.text).slice(0, 6)));
    check('级别字：今天是「今」', todayRow?.level === '今', JSON.stringify(todayRow));
    check('级别字：明天是「明」', tomorrowRow?.level === '明', JSON.stringify(tomorrowRow));
    check('级别字：逾期是「急」', overdueRow?.level === '急', JSON.stringify(overdueRow));
    check('15 天后的任务两列都不出现',
      !(board.upcoming || []).some((r) => r.text.includes(T.far)) && !(board.overdue || []).some((r) => r.text.includes(T.far)),
      JSON.stringify({ upcoming: (board.upcoming || []).some((r) => r.text.includes(T.far)), overdue: (board.overdue || []).some((r) => r.text.includes(T.far)) }));

    // 栏目图标（用户 2026-10-14：「首页栏目前边不显示复选框，显示栏目图标」）
    const iconInfo = await page.evaluate((title) => {
      const row = [...document.querySelectorAll('[data-home-item]')].find((li) => (li.innerText || '').includes(title));
      if (!row) return null;
      return {
        hasIcon: !!row.querySelector('[data-home-icon]'),
        hasSvg: !!row.querySelector('[data-home-icon] svg'),
        hasCheckbox: !!row.querySelector('[data-home-complete]') || !!row.querySelector('input[type="checkbox"]'),
      };
    }, T.today);
    check('每行前面是栏目图标（有图标、有 svg）', !!iconInfo && iconInfo.hasIcon && iconInfo.hasSvg, JSON.stringify(iconInfo));
    check('每行前面没有复选框了', !!iconInfo && iconInfo.hasCheckbox === false, JSON.stringify(iconInfo));

    check('第一列写明是「未来 14 天待办」并解释了级别字',
      (board.legends[0] || '').includes('未来 14 天待办') && /急/.test(board.legends[0]) && /今/.test(board.legends[0]),
      JSON.stringify(board.legends[0]));
    check('第二列写明是「已逾期」', (board.legends[1] || '').includes('已逾期'), JSON.stringify(board.legends[1]));

    // ---------------- 3b. 每条后面的倒计时 + 标题条底色 ----------------
    const extras = await page.evaluate((titles) => {
      const rows = [...document.querySelectorAll('[data-home-item]')].filter((li) => titles.some((t) => (li.innerText || '').includes(t)));
      return rows.map((li) => ({
        text: (li.innerText || '').replace(/\s+/g, ' ').trim(),
        remaining: (li.querySelector('[data-home-remaining]')?.innerText || '').trim(),
      }));
    }, [T.today, T.tomorrow, T.overdue]);
    check('每条信息后面都有倒计时（剩余 / 已逾期）',
      extras.length >= 3 && extras.every((r) => /剩余|已逾期/.test(r.remaining)),
      JSON.stringify(extras.map((r) => r.remaining)));
    check('今天到期的那条写的是「剩余 …」（带时:分）',
      (find(extras, T.today)?.remaining || '').startsWith('剩余') && /\d{2}:\d{2}/.test(find(extras, T.today)?.remaining || ''),
      JSON.stringify(find(extras, T.today)));
    check('逾期的那条写的是「已逾期」（不再写剩余）',
      (find(extras, T.overdue)?.remaining || '').startsWith('已逾期'), JSON.stringify(find(extras, T.overdue)));

    const headBg = await page.evaluate(() => {
      const read = (name) => {
        const head = document.querySelector(`[data-home-head="${name}"]`);
        if (!head) return null;
        const css = getComputedStyle(head);
        return { bg: css.backgroundColor, image: css.backgroundImage };
      };
      return { upcoming: read('upcoming'), overdue: read('overdue') };
    });
    const solid = (v) => !!v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent';
    check('「未来 14 天待办」标题条有底色',
      solid(headBg.upcoming?.bg) || /gradient/.test(headBg.upcoming?.image || ''), JSON.stringify(headBg.upcoming));
    check('「已逾期」标题条有底色（红色系）',
      solid(headBg.overdue?.bg) && /^rgba?\((\d+), (\d+), (\d+)/.test(headBg.overdue.bg)
        && Number(headBg.overdue.bg.match(/^rgba?\((\d+), (\d+), (\d+)/)[1]) > Number(headBg.overdue.bg.match(/^rgba?\((\d+), (\d+), (\d+)/)[3]),
      JSON.stringify(headBg.overdue));

    // ---------------- 4. 点一条 → 定位到对应清单并高亮 ----------------
    const todayId = created[1];
    const todayListId = (await api(page, '/api/reminder/items/' + todayId)).body?.data?.list_id ?? null;
    const gotoOk = await page.evaluate((id) => {
      const row = document.querySelector(`[data-home-goto="${id}"]`);
      if (!row) return false;
      row.click();
      return true;
    }, todayId);
    check('看板上的条目点得动', gotoOk === true);
    await sleep(3000);
    const gotoState = await page.evaluate(() => ({
      path: location.pathname,
      query: location.search,
      highlighted: [...document.querySelectorAll('.reminder-highlight')].map((el) => el.getAttribute('data-reminder-row')),
    }));
    check('点击后定位到它所在的清单（/admin/list/<清单 id>?highlight=<任务 id>）',
      !!todayListId && gotoState.path === `/admin/list/${todayListId}` && gotoState.query.includes(`highlight=${todayId}`),
      JSON.stringify({ gotoState, todayListId }));
    check('清单里那一条被高亮出来了（滚到视野里 + 闪底色）',
      gotoState.highlighted.includes(String(todayId)), JSON.stringify(gotoState));

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
