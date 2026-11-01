/**
 * 验证日历「周视图」的工字线与今天高亮：
 *   1) 不再给整段任务铺背景色块
 *   2) 只有今天保留一个实时高亮块（进行中 / 下一个任务）
 *   3) 跨天任务仍有完整工字线，中间断档不再合并成背景
 *   4) 每条任务一根工字线，只有真正开始/结束才有横杠
 *
 * 用法：APP_URL=http://127.0.0.1:8919 node verify-144.js
 */
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
const LIST_NAME = `周视图自检-${STAMP}`;
const SPAN_TITLE = `跨天色块-${STAMP}`;
const POINT_TITLE = `单点工字-${STAMP}`;
let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;

async function api(token, apiPath, method = 'GET', body = null) {
  const res = await fetch(ROOT + apiPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.code !== 0) throw new Error(`${method} ${apiPath} → ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}

(async () => {
  let token = '';
  let listId = 0;
  const ids = [];
  try {
    await withTab(async (page) => {
      await login(page, BASE);
      token = await page.evaluate(() => localStorage.getItem('reminders.token') || '');
      const list = await api(token, '/api/reminder/lists', 'POST', { name: LIST_NAME, color: 'blue', icon: 'list' });
      listId = Number(list.id);
      await page.evaluate((id) => localStorage.setItem('ui_calendar_lists', JSON.stringify([id])), listId);

      await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('知道了')); if (b) b.click(); });
      await sleep(500);
      await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
      await sleep(700);
      await page.evaluate(() => document.querySelector('[data-week-next]')?.click());
      await sleep(800);
      const keys = await page.$$eval('[data-week-col]', (els) => els.map((el) => el.getAttribute('data-week-col')));
      check('周视图有 7 列', keys.length === 7, keys.join(','));
      const d1 = keys[1], d2 = keys[2], d3 = keys[3], gapDay = keys[4];

      const mk = async (title, start, end) => {
        const body = {
          title, kind: 'task', due_at: null, start_at: start, end_at: end,
          repeat_rule: 'none', channels: ['inapp'], list_id: listId,
        };
        const item = await api(token, '/api/reminder/items', 'POST', body);
        ids.push(String(item.id));
        return String(item.id);
      };
      const spanId = await mk(SPAN_TITLE, `${d1}T10:00:00+08:00`, `${d3}T18:00:00+08:00`);
      const pointId = (await api(token, '/api/reminder/items', 'POST', {
        title: POINT_TITLE, kind: 'task', due_at: `${d1}T23:59:00+08:00`, start_at: `${d1}T23:59:00+08:00`,
        end_at: null, repeat_rule: 'none', channels: ['inapp'], list_id: listId,
      }));
      ids.push(String(pointId.id));
      const pointKey = String(pointId.id);
      await mk(`断档早-${STAMP}`, `${gapDay}T09:00:00+08:00`, `${gapDay}T10:00:00+08:00`);
      await mk(`断档晚-${STAMP}`, `${gapDay}T12:00:00+08:00`, `${gapDay}T13:00:00+08:00`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1600);
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('知道了')); if (b) b.click(); });
      await sleep(500);
      await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
      await sleep(700);
      // 切到下一周，保证所有 fixture 都在未来，不受「超时自动续日」影响。
      await page.evaluate(() => document.querySelector('[data-week-next]')?.click());
      await sleep(800);

      const data = await page.evaluate(({ keys, span, point }) => {
        const out = { days: {}, span: {}, point: null };
        for (const key of keys) {
          const col = document.querySelector(`[data-week-col="${key}"]`);
          if (!col) continue;
          const cr = col.getBoundingClientRect();
          const regions = [...col.querySelectorAll('[data-week-region]')].map((el) => {
            const r = el.getBoundingClientRect();
            return { top: Math.round(r.top - cr.top), height: Math.round(r.height), width: Math.round(r.width), left: Math.round(r.left - cr.left), bg: getComputedStyle(el).backgroundColor };
          });
          const bgEl = col.querySelector('[data-week-today-bg]');
          const todayBg = bgEl ? (() => {
            const r = bgEl.getBoundingClientRect();
            return { top: Math.round(r.top - cr.top), height: Math.round(r.height), width: Math.round(r.width), bg: getComputedStyle(bgEl).backgroundColor };
          })() : null;
          const beams = {};
          for (const el of col.querySelectorAll('[data-week-block]')) {
            const id = el.getAttribute('data-week-block');
            const r = el.getBoundingClientRect();
            beams[id] = {
              id, role: el.getAttribute('data-week-role'),
              top: Math.round(r.top - cr.top), height: Math.round(r.height), width: Math.round(r.width),
              capTop: el.getAttribute('data-week-cap-top') === '1',
              capBottom: el.getAttribute('data-week-cap-bottom') === '1',
              text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
              labelBottomGap: (() => { const label = el.querySelector('[data-week-label-mode]'); return label ? Math.round(r.bottom - label.getBoundingClientRect().bottom) : null; })(),
            };
          }
          out.days[key] = { regions, todayBg, beams, width: Math.round(cr.width) };
        }
        out.span = { start: out.days[keys[1]]?.beams[span], mid: out.days[keys[2]]?.beams[span], end: out.days[keys[3]]?.beams[span] };
        out.point = out.days[keys[1]]?.beams[point] || null;
        return out;
      }, { keys, span: spanId, point: pointKey });

      const regionCount = keys.reduce((n, key) => n + (data.days[key]?.regions.length || 0), 0);
      check('不再给整段任务铺背景色块', regionCount === 0, String(regionCount));

      const gapBeams = Object.values(data.days[gapDay]?.beams || {});
      check('断档任务仍各画一条工字线', gapBeams.length === 2, JSON.stringify(gapBeams.map((b) => b.top)));
      check('断档工字线分别在 09:00 与 12:00', gapBeams.some((b) => near(b.top, 396)) && gapBeams.some((b) => near(b.top, 528)), JSON.stringify(gapBeams.map((b) => b.top)));

      check('跨天任务每天都有工字线', !!data.span.start && !!data.span.mid && !!data.span.end, JSON.stringify(data.span));
      const overlapCollision = [];
      for (const key of keys) {
        const bs = Object.values(data.days[key]?.beams || {});
        for (let i = 0; i < bs.length; i++) {
          for (let j = i + 1; j < bs.length; j++) {
            const a = bs[i], b = bs[j];
            const overlap = a.top < b.top + b.height - 1 && b.top < a.top + a.height - 1;
            if (overlap && Math.abs(a.left - b.left) < 2) overlapCollision.push({ key, a: a.id, b: b.id, aTop: a.top, bTop: b.top, left: a.left });
          }
        }
      }
      check('所有时间重叠的线段都不重叠', overlapCollision.length === 0, JSON.stringify(overlapCollision));
      check('跨天起始段只有上横杠', data.span.start && data.span.start.capTop && !data.span.start.capBottom, JSON.stringify(data.span.start));
      check('跨天中间段没有横杠', data.span.mid && !data.span.mid.capTop && !data.span.mid.capBottom, JSON.stringify(data.span.mid));
      check('跨天结束段只有下横杠', data.span.end && !data.span.end.capTop && data.span.end.capBottom, JSON.stringify(data.span.end));
      check('单点任务上下横杠都有且不溢出次日', data.point && data.point.capTop && data.point.capBottom && !data.days[d2]?.beams[pointKey], JSON.stringify(data.point));
      check('跨天每天线段都带同一标题', [data.span.start, data.span.mid, data.span.end].every((x) => x && x.text.includes(SPAN_TITLE)), JSON.stringify([data.span.start?.text, data.span.mid?.text, data.span.end?.text]));
      check('跨天每天标题都对齐到当天线段末端', [data.span.start, data.span.mid, data.span.end].every((x) => x && x.labelBottomGap !== null && x.labelBottomGap <= 2), JSON.stringify([data.span.start?.labelBottomGap, data.span.mid?.labelBottomGap, data.span.end?.labelBottomGap]));
      check('起始段显示任务名', data.span.start && data.span.start.text.includes(SPAN_TITLE), data.span.start?.text);

      await page.screenshot({ path: path.join(SHOTS, 'verify-144-week.png') });
      await page.evaluate(() => localStorage.removeItem('ui_calendar_lists'));
    }, { width: 1440, height: 1000 });
  } catch (err) {
    failed++;
    console.error('测试异常：', err.message);
  } finally {
    try {
      if (token) {
        for (const id of ids) await api(token, `/api/reminder/items/${id}`, 'DELETE').catch(() => {});
        if (listId) await api(token, `/api/reminder/lists/${listId}`, 'DELETE').catch(() => {});
      }
      await withTab(async (page) => { await page.evaluate(() => localStorage.removeItem('ui_calendar_lists')); }, { width: 800, height: 600 }).catch(() => {});
    } catch (err) {
      console.warn('清理失败：', err.message);
    }
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('测试异常：', err);
  process.exit(1);
});
