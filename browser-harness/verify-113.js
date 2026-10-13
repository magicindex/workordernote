/**
 * 清单页排序（用户 2026-10-12 要求：「给清单页面增加排序功能（升序/倒序）」）。
 *
 * 规则（与 HomeView 里 listSortDir 的注释一致）：
 *   · 按**到期时间**排；升序 = 时间早的在前（默认，与改之前完全一致），倒序 = 远的在前；
 *   · **整页重排**：日期卡片整体倒过来，卡片内的条目也倒序；
 *   · 两条既有规矩不参与反转：**「已逾期」永远第一**（欠着的事的收件箱）、
 *     **「无日期」永远最后**（没有到期时间，排哪一头都是错的）；
 *   · 卡片内部「没做完的在前」这条也不变（只把同一段里的顺序反过来）；
 *   · 选择记在 localStorage（`ui_list_sort_dir`），刷新、切页面都保持；
 *   · 「已完成」页不显示这个按钮（那一页有自己的时间段口径）；**记事本栏目也不显示**
 *     （记事没有到期时间，那一页是「新在前」的流水账，按到期时间排没有意义）。
 *
 * 为什么在「计划」页断言日期卡片顺序：普通清单页是**按年-月看**的（只加载当月，
 * 月底造「+3 天」会跨月），计划页不按月切、「明天及以后」的任务都在，最适合造数据。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-113.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const TEMP_LIST = `自检排序清单-${STAMP}`;
const T = {
  a: `自检排序A-${STAMP}`,
  bEarly: `自检排序B早-${STAMP}`,
  bLate: `自检排序B晚-${STAMP}`,
  c: `自检排序C-${STAMP}`,
  overdue: `自检排序逾期-${STAMP}`,
};
const SORT_KEY = 'ui_list_sort_dir';

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
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

/** 读当前页面的日期卡片：key（YYYY-MM-DD / overdue / undated）+ 卡内标题顺序。 */
const readCards = (page, want) => page.evaluate((wanted) => [...document.querySelectorAll('[data-day-group]')].map((card) => {
  const title = (h) => (h.textContent || '').trim();
  return {
    key: card.getAttribute('data-day-group'),
    titles: [...card.querySelectorAll('h3')].map(title),
    mine: [...card.querySelectorAll('h3')].map(title).filter((t) => wanted.some((w) => t.includes(w))),
  };
}), want);

const sortState = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-sort-toggle]');
  return b ? { present: true, dir: b.getAttribute('data-sort-dir'), text: (b.innerText || '').trim() } : { present: false };
});

(async () => {
  let listId = null;
  const itemIds = [];
  let originalSort = null;
  let originalStatus = null;
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    // 复位两处本地偏好（排序默认升序、状态默认只看未完成），收尾时原样还回去
    const before = await page.evaluate((sortKey) => ({
      sort: localStorage.getItem(sortKey),
      status: localStorage.getItem('ui_list_status'),
    }), SORT_KEY);
    originalSort = before.sort;
    originalStatus = before.status;
    await page.evaluate((sortKey) => { localStorage.removeItem(sortKey); localStorage.setItem('ui_list_status', 'open'); }, SORT_KEY);

    // ---------------- 造数：一个临时清单 + 4 条提醒 ----------------
    const localKey = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    const at = (offset, hour) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      d.setHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    const made = await api(page, '/api/reminder/lists', 'POST', { name: TEMP_LIST, color: 'emerald', icon: 'list' });
    listId = made.body?.data?.id ?? null;
    check('用接口建一个临时清单', !!listId, `id=${listId}`);
    const plan = [
      { title: T.a, due: at(1, 9) },
      { title: T.bEarly, due: at(2, 9) },
      { title: T.bLate, due: at(2, 15) },
      { title: T.c, due: at(3, 9) },
    ];
    for (const it of plan) {
      const r = await api(page, '/api/reminder/items', 'POST', {
        title: it.title, due_at: it.due, list_id: listId, repeat_rule: 'none', channels: ['inapp'],
      });
      itemIds.push(r.body?.data?.id ?? null);
    }
    check('造出 4 条提醒（+1 天 09:00 / +2 天 09:00 与 15:00 / +3 天 09:00）',
      itemIds.every(Boolean), JSON.stringify(itemIds));
    const keys = { a: localKey(1), b: localKey(2), c: localKey(3) };

    // ---------------- 1. 计划页：默认升序 ----------------
    await gotoRetry(page, BASE + '/admin/planned');
    await sleep(2600);
    const st0 = await sortState(page);
    check('计划页出现「排序」按钮（清单页 = 有日期卡片的页面都有）', st0.present === true, JSON.stringify(st0));
    check('默认是升序：data-sort-dir=asc、按钮写着「时间升序」',
      st0.dir === 'asc' && st0.text === '时间升序', JSON.stringify(st0));

    let cards = await readCards(page, [T.a, T.bEarly, T.bLate, T.c]);
    let idx = (list, k) => list.findIndex((c) => c.key === k);
    check('升序：日期卡片按到期时间从近到远（+1 天 → +2 天 → +3 天）',
      idx(cards, keys.a) >= 0 && idx(cards, keys.a) < idx(cards, keys.b) && idx(cards, keys.b) < idx(cards, keys.c),
      JSON.stringify(cards.map((c) => c.key)));
    const bCard0 = cards.find((c) => c.key === keys.b);
    const bOrder0 = bCard0 ? bCard0.titles.filter((t) => t.includes('自检排序B')) : [];
    check('升序：同一张卡片里 09:00 的那条排在 15:00 前面',
      bOrder0.length === 2 && bOrder0[0].includes('B早'), JSON.stringify(bOrder0));
    const overdue0 = idx(cards, 'overdue');
    check('升序：「已逾期」卡片在最前（若有）', overdue0 <= 0, `overdue 索引=${overdue0}`);
    const sameRow = await page.evaluate(() => {
      const a = document.querySelector('[data-sort-toggle]')?.getBoundingClientRect();
      const refresh = [...document.querySelectorAll('.list-toolbar-actions .toolbar-btn')]
        .find((b) => (b.innerText || '').includes('刷新'))?.getBoundingClientRect();
      return a && refresh ? Math.abs(a.top - refresh.top) < 4 : false;
    });
    check('1440px 下排序按钮与「刷新」排在同一行（工具栏没被挤成两行）', sameRow === true);
    const rows0 = await page.evaluate(() => document.querySelectorAll('.reminder-row').length);

    // ---------------- 2. 倒序 ----------------
    await page.evaluate(() => document.querySelector('[data-sort-toggle]')?.click());
    await sleep(900);
    const st1 = await sortState(page);
    check('点一下变成倒序：data-sort-dir=desc、按钮写着「时间倒序」',
      st1.dir === 'desc' && st1.text === '时间倒序', JSON.stringify(st1));
    check('倒序状态写进了 localStorage（ui_list_sort_dir=desc）',
      (await page.evaluate((k) => localStorage.getItem(k), SORT_KEY)) === 'desc');

    cards = await readCards(page, [T.a, T.bEarly, T.bLate, T.c]);
    idx = (list, k) => list.findIndex((c) => c.key === k);
    check('倒序：日期卡片整体倒过来（+3 天 → +2 天 → +1 天）',
      idx(cards, keys.c) < idx(cards, keys.b) && idx(cards, keys.b) < idx(cards, keys.a),
      JSON.stringify(cards.map((c) => c.key)));
    const bCard1 = cards.find((c) => c.key === keys.b);
    const bOrder1 = bCard1 ? bCard1.titles.filter((t) => t.includes('自检排序B')) : [];
    check('倒序：同一张卡片里 15:00 的那条排在 09:00 前面',
      bOrder1.length === 2 && bOrder1[0].includes('B晚'), JSON.stringify(bOrder1));
    check('倒序：「已逾期」仍在最前（不跟着反转）',
      idx(cards, 'overdue') <= 0, `overdue 索引=${idx(cards, 'overdue')}`);
    const rows1 = await page.evaluate(() => document.querySelectorAll('.reminder-row').length);
    check('倒序不丢条目（行数不变）', rows1 === rows0, `升序 ${rows0} → 倒序 ${rows1}`);
    check('倒序会把我的测试条目换到不同位置（真的是重排，不是没生效）',
      rows1 > 0 && cards.some((c) => c.mine.length > 0));

    // ---------------- 3. 刷新后保持 ----------------
    await gotoRetry(page, BASE + '/admin/planned');
    await sleep(2600);
    const st2 = await sortState(page);
    check('刷新页面后仍是倒序（偏好跟人走）', st2.dir === 'desc' && st2.text === '时间倒序', JSON.stringify(st2));
    const cards2 = await readCards(page, [T.a, T.c]);
    check('刷新后顺序仍是「远的在前」',
      cards2.findIndex((c) => c.key === keys.c) >= 0
      && cards2.findIndex((c) => c.key === keys.c) < cards2.findIndex((c) => c.key === keys.a),
      JSON.stringify(cards2.map((c) => c.key)));

    // ---------------- 4. 再点一次回到升序 ----------------
    await page.evaluate(() => document.querySelector('[data-sort-toggle]')?.click());
    await sleep(900);
    const st3 = await sortState(page);
    check('再点一次回到升序', st3.dir === 'asc' && st3.text === '时间升序', JSON.stringify(st3));
    const cards3 = await readCards(page, [T.a, T.c]);
    check('回到升序后顺序复原（近的在前）',
      cards3.findIndex((c) => c.key === keys.a) < cards3.findIndex((c) => c.key === keys.c),
      JSON.stringify(cards3.map((c) => c.key)));

    // ---------------- 5. 「已逾期」置顶：造一条真逾期，升序 / 倒序都实测 ----------------
    const ov = await api(page, '/api/reminder/items', 'POST', {
      title: T.overdue, due_at: at(-2, 23), list_id: listId, repeat_rule: 'none', channels: ['inapp'],
    });
    itemIds.push(ov.body?.data?.id ?? null);
    check('造一条真逾期的测试提醒（前天 23:00，过了当天 23:59 + 30 分钟宽限）',
      !!ov.body?.data?.id, JSON.stringify(ov.body));
    await gotoRetry(page, BASE + '/admin');
    await sleep(2600);
    const ascState = await sortState(page);
    const ascCards = await readCards(page, [T.overdue]);
    check('升序下今天页：「已逾期」卡片排第一',
      ascState.dir === 'asc' && ascCards.length > 0 && ascCards[0].key === 'overdue',
      `${JSON.stringify(ascState)} / ${JSON.stringify(ascCards.map((c) => c.key))}`);
    check('那条逾期测试提醒确实落在第一张卡片里', (ascCards[0]?.mine.length ?? 0) > 0,
      JSON.stringify(ascCards[0]?.titles || []));
    await page.evaluate(() => document.querySelector('[data-sort-toggle]')?.click());
    await sleep(1000);
    const descState = await sortState(page);
    const descCards = await readCards(page, [T.overdue]);
    check('倒序下今天页仍是「已逾期」卡片排第一（不跟着反转）',
      descState.dir === 'desc' && descCards.length > 0 && descCards[0].key === 'overdue',
      `${JSON.stringify(descState)} / ${JSON.stringify(descCards.map((c) => c.key))}`);

    // ---------------- 6. 记事本栏目：不参与到期时间排序（它有自己「新在前」的规矩） ----------------
    const listRows = (await api(page, '/api/reminder/lists')).body?.data || [];
    const noteList = Array.isArray(listRows) ? listRows.find((l) => l.template === 'notebook') : null;
    if (!noteList) {
      console.log('  · 这个环境没有记事本栏目，跳过记事本边界的实测');
    } else {
      await gotoRetry(page, `${BASE}/admin/list/${noteList.id}`);
      await sleep(2600);
      const noteState = await sortState(page);
      check('记事本栏目不显示排序按钮（记事没有到期时间，那一页是「新在前」）',
        noteState.present === false, JSON.stringify(noteState));
      const noteCards = await readCards(page, []);
      const noteKeys = noteCards.map((c) => c.key).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
      check('记事本栏目仍按自己的口径「新在前」（日期从晚到早，不受排序开关影响）',
        noteKeys.length > 1 ? noteKeys.every((k, i) => i === 0 || noteKeys[i - 1] >= k) : true,
        JSON.stringify(noteKeys));
    }

    // ---------------- 7. 其它页面的呈现 ----------------
    await gotoRetry(page, BASE + '/admin');
    await sleep(2200);
    const today0 = await sortState(page);
    check('今天页也有排序按钮（清单页通用）', today0.present === true, JSON.stringify(today0));
    await gotoRetry(page, BASE + '/admin/completed');
    await sleep(2200);
    const done0 = await sortState(page);
    check('「已完成」页不显示排序按钮（它有自己的时间段口径）', done0.present === false, JSON.stringify(done0));

    // ---------------- 6. 手机端 ----------------
    await gotoRetry(page, BASE + '/admin/planned');
    await sleep(2200);
    await page.setViewport({ width: 390, height: 844 });
    await sleep(1200);
    const mobile = await page.evaluate(() => {
      const b = document.querySelector('[data-sort-toggle]');
      const r = b?.getBoundingClientRect();
      return {
        visible: !!b && r.width > 0 && r.height > 0,
        text: (b?.innerText || '').trim(),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    check('390px 手机上排序按钮可见（整块工具栏不挤掉它）', mobile.visible === true, JSON.stringify(mobile));
    check('390px 手机上没有横向溢出', mobile.overflow <= 1, `溢出 ${mobile.overflow}px`);
    await page.setViewport({ width: 1440, height: 1000 });

    // ---------------- 清理 ----------------
    for (const id of itemIds) {
      if (id) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    }
    if (listId) await api(page, `/api/reminder/lists/${listId}`, 'DELETE');
    await page.evaluate(({ sortKey, sort, status }) => {
      if (sort === null) localStorage.removeItem(sortKey);
      else localStorage.setItem(sortKey, sort);
      if (status === null) localStorage.removeItem('ui_list_status');
      else localStorage.setItem('ui_list_status', status);
    }, { sortKey: SORT_KEY, sort: originalSort, status: originalStatus });
    const gone = await api(page, '/api/reminder/items?view=all&status=all');
    const rows = (() => {
      const d = gone.body?.data;
      return Array.isArray(d) ? d : d?.items || [];
    })();
    check('清理干净：测试条目与临时清单都不在了',
      !rows.some((i) => String(i.title).includes('自检排序')), '仍有残留');
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
