/**
 * 周视图时间线：今天新建的待办不再画成 24 小时长线（用户 2026-11-16）。
 *
 * 用户原话：「今天新建了一条待办，线段自动加 24 小时，这是错误的，今天新建的待办时间
 * 应该是到今天 23:59，如果今天未完成则自动延长，明天 0 点后按剩余时间到明天 23:59；
 * 如果明天上午 9 点完成则线段自动截至到 9 点，不再显示到 23:59」。
 *
 * 旧口径：未完成 + 已过到期时间 → 线段续到「次日同一时刻」，08:19 到期的待办会画成
 * 08:19 → 次日 08:19 的 24 小时长线，并且溢出到第二天的列。
 * 新口径：续到「当前这一天 23:59」；完成时截到实际完成时刻。
 *
 * 造 3 条自检任务（今天 23:59 到期 / 今天已过时 / 今天已完成），只看周视图块的
 * 起止分钟，收尾全部删掉。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const api = (page, path, method = 'GET', body = null) => page.evaluate(async ({ base, path, method, body }) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}, { base: BASE, path, method, body });

/** 本地时区的 ISO（带 +08:00 偏移，后端按它存 due_at）。 */
function localIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
    + `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

const KEY = '自检时间线';

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    const now = new Date();
    const today2359 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);
    const todayPast = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 19, 0);
    if (todayPast.getTime() > now.getTime()) todayPast.setTime(now.getTime() - 3600_000);

    const created = [];
    try {
      // A：今天新建、今天 23:59 到期、未完成
      const a = await api(page, '/api/reminder/items', 'POST', {
        title: `${KEY}-今天新建`, due_at: localIso(today2359), repeat_rule: 'none', channels: ['inapp'],
      });
      if (a?.data?.id) created.push(a.data.id);
      // B：今天早于现在到期、未完成（旧逻辑会续到次日 08:19 → 溢出到第二天）
      const b = await api(page, '/api/reminder/items', 'POST', {
        title: `${KEY}-已过时未完成`, due_at: localIso(todayPast), repeat_rule: 'none', channels: ['inapp'],
      });
      if (b?.data?.id) created.push(b.data.id);
      // C：今天 09:00 开始、23:59 到期，但已经完成（完成时刻 = 现在）。
      // 带 start_at 是为了让线段够长：极短的块有 22px 最小高度，量不出真实结束时刻。
      const today9 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
      const c = await api(page, '/api/reminder/items', 'POST', {
        title: `${KEY}-今天已完成`, due_at: localIso(today2359), start_at: localIso(today9),
        repeat_rule: 'none', channels: ['inapp'],
      });
      if (c?.data?.id) created.push(c.data.id);
      check('造出 3 条自检任务', created.length === 3, String(created.length));
      if (created.length === 3) {
        const done = await api(page, `/api/reminder/items/${created[2]}/complete`, 'POST');
        check('第三条已标记完成', done?.code === 0, JSON.stringify(done).slice(0, 120));
      }

      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(2000);
      await page.click('[data-cal-view="week"]');
      await sleep(1800);

      // 短块的文字会被截成「自…」（weekBlockLabel 按高度截断），所以按任务 id 定位。
      const info = await page.evaluate((ids) => {
        const cols = [...document.querySelectorAll('[data-week-col]')];
        const colH = cols[0] ? cols[0].getBoundingClientRect().height : 0;
        const hourH = colH / 24;
        const read = (id) => {
          const out = [];
          for (const col of cols) {
            const colTop = col.getBoundingClientRect().top;
            for (const blk of col.querySelectorAll('[data-week-block]')) {
              if (blk.getAttribute('data-week-block') !== String(id)) continue;
              const r = blk.getBoundingClientRect();
              out.push({
                day: col.getAttribute('data-week-col'),
                role: blk.getAttribute('data-week-role'),
                startMin: Math.round(((r.top - colTop) / hourH) * 60),
                endMin: Math.round(((r.top - colTop + r.height) / hourH) * 60),
              });
            }
          }
          return out.sort((x, y) => x.startMin - y.startMin);
        };
        return { hourH, a: read(ids[0]), b: read(ids[1]), c: read(ids[2]) };
      }, created);

      console.log('    ' + JSON.stringify(info));
      const colOf = (arr, day) => arr.filter((x) => x.day === day);
      const p2 = (n) => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
      const nextDay = (() => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
      })();
      // 单块的高度是 raw-2px，换算回分钟会少 120/hourH（≈4 分钟），容差给 8 分钟。
      const near = (a, b, tol = 8) => Math.abs(a - b) <= tol;

      // A：今天新建 → 今天 23:59 收尾，不溢出到明天
      const aToday = colOf(info.a, today);
      check('今天新建的待办有线段', aToday.length === 1, JSON.stringify(info.a));
      check('今天新建的待办收在今天 23:59（不是 +24 小时）',
        aToday.length === 1 && near(aToday[0].endMin, 23 * 60 + 59), JSON.stringify(aToday));
      check('今天新建的待办没有画到明天',
        colOf(info.a, nextDay).length === 0, JSON.stringify(info.a));

      // B：过了到期时刻、未完成 → 续到当天 23:59，也不跑到明天
      const bToday = colOf(info.b, today);
      check('已过时未完成的待办收在今天 23:59（旧逻辑是次日同一时刻）',
        bToday.length === 1 && near(bToday[0].endMin, 23 * 60 + 59), JSON.stringify(info.b));
      check('已过时未完成的待办没有溢出到明天',
        colOf(info.b, nextDay).length === 0, JSON.stringify(info.b));

      // C：已完成 → 截到完成时刻（现在），不再画到 23:59
      const cToday = colOf(info.c, today);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      check('已完成的待办线段截到完成时刻（约现在）',
        cToday.length === 1 && Math.abs(cToday[0].endMin - nowMin) <= 8,
        JSON.stringify({ block: cToday, nowMin }));
      check('已完成的待办不再画到 23:59',
        cToday.length === 1 && cToday[0].endMin < 23 * 60, JSON.stringify(cToday));

      await page.screenshot({ path: 'shots/verify-212-week-timeline.png' });
    } finally {
      for (const id of created) {
        await api(page, `/api/reminder/items/${id}`, 'DELETE').catch(() => {});
      }
      const after = await api(page, '/api/reminder/items?q=' + encodeURIComponent(KEY));
      const left = (after?.data || []).filter((it) => String(it.title || '').includes(KEY));
      check('自检任务已清理', left.length === 0, String(left.length));
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
