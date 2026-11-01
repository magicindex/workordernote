/**
 * 日历周视图（这批）：
 *   1) 月 / 周 切换；周视图＝7 列天 × 24 小时
 *   2) 上一周 / 本周 / 下一周 导航
 *   3) 鼠标在时间线上移动显示时分；双击按所在时分新建 1 小时时段
 *   4) 任务按时段画块、按清单上色；重叠的并排分栏并给出提示
 *   5) 后台「周起始日」（周一/周日）决定第一列
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-104.js
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now();

let passed = 0;
let failed = 0;
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}
async function waitSel(page, sel, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const created = [];
    const iso = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      const off = -d.getTimezoneOffset();
      const s = off >= 0 ? '+' : '-';
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${s}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
    };
    const now = new Date();
    // 造两条**重叠**的时间段任务。放在当前时间 1 小时后，避免「超时未完成自动续日」
    // 把 14:00 的旧 fixture 滚到未来，导致当周找不到块。
    const a1 = new Date(now.getTime() + 60 * 60e3); a1.setSeconds(0, 0);
    const a2 = new Date(a1.getTime() + 60 * 60e3);
    const b1 = new Date(a1.getTime() + 30 * 60e3);
    const b2 = new Date(b1.getTime() + 60 * 60e3);
    const expectedTop = (a1.getHours() + a1.getMinutes() / 60) * 44;

    const seed = async (title, start, end) => {
      for (let i = 0; i < 3; i += 1) {
        const res = await api(page, '/api/reminder/items', 'POST', {
          title, due_at: iso(start), start_at: iso(start), end_at: iso(end), repeat_rule: 'none', channels: ['inapp'],
        });
        const id = res.body?.data?.id;
        if (id) { created.push(id); return id; }
        await sleep(6000);
      }
      return null;
    };
    const idA = await seed(`自检周块A-${STAMP}`, a1, a2);
    const idB = await seed(`自检周块B-${STAMP}`, b1, b2);
    check('自检时间段任务已建号', !!idA && !!idB, `${idA} / ${idB}`);

    // 「周起始日」决定「本周」是哪七天，而下面造数据用的是**周一为一周之始**的算法：
    // 先把它固定成周一（跑完还原原值），否则实例上若残留 sunday，造出来的周三会落在
    // 上一周、周视图里一条块都看不到（2026-10-11 就这么假红过一次）。
    const weekStartBefore = String((await api(page, '/api/configs')).body?.data?.calendar_week_start ?? 'monday');
    if (weekStartBefore !== 'monday') {
      await api(page, '/api/configs', 'PUT', { key: 'calendar_week_start', value: 'monday' });
    }

    await page.evaluate(() => localStorage.removeItem('ui_calendar_lists'));
    await page.setViewport({ width: 1440, height: 900 });
    await gotoRetry(page, BASE + '/admin/calendar');
    await waitSel(page, '[data-cal-view-toggle]', 20000);
    await sleep(1500);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('知道了')); if (b) b.click(); });
      await sleep(500);
      
    // 1) 切到周视图
    await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
    await waitSel(page, '[data-week-grid]', 15000);
    await sleep(1500);
    const grid = await page.evaluate(() => ({
      cols: document.querySelectorAll('[data-week-col]').length,
      hours: document.querySelectorAll('[data-week-grid] .relative > div').length,
      firstHeader: document.querySelector('[data-week-grid] div[class*="text-center"]')?.innerText.trim() || '',
      label: document.querySelector('[data-week-label]')?.innerText.trim() || '',
    }));
    check('周视图有 7 天列', grid.cols === 7, JSON.stringify(grid));
    check('周视图有周区间标签与上一周/下一周', !!grid.label, JSON.stringify(grid));

    // 2) 导航
    const before = grid.label;
    await page.evaluate(() => document.querySelector('[data-week-next]')?.click());
    await sleep(1800);
    const after = await page.evaluate(() => document.querySelector('[data-week-label]')?.innerText.trim() || '');
    check('「下一周」会换一周', after !== before && !!after, `${before} → ${after}`);
    await page.evaluate(() => document.querySelector('[data-week-today]')?.click());
    await sleep(1800);
    const backLabel = await page.evaluate(() => document.querySelector('[data-week-label]')?.innerText.trim() || '');
    check('「本周」回到本周', backLabel === before, `${backLabel} vs ${before}`);

    // 3) 任务块 + 重叠并排
    const blocks = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[data-week-block]')];
      const mine = all.filter((b) => /自检周块/.test(b.innerText));
      const col = mine[0]?.closest('[data-week-col]');
      const colW = col ? col.getBoundingClientRect().width : 0;
      return {
        mineCount: mine.length,
        overlap: mine.map((b) => Number(b.getAttribute('data-overlap'))),
        widths: mine.map((b) => Math.round(b.getBoundingClientRect().width)),
        colW: Math.round(colW),
        bg: mine.map((b) => getComputedStyle(b).backgroundColor),
        tops: mine.map((b) => Math.round(b.getBoundingClientRect().top - (col ? col.getBoundingClientRect().top : 0))),
        caps: mine.map((b) => [b.getAttribute('data-week-cap-top'), b.getAttribute('data-week-cap-bottom')]),
        regions: [...(col ? col.querySelectorAll('[data-week-region]') : [])].map((r) => {
          const rr = r.getBoundingClientRect();
          return {
            top: Math.round(rr.top - (col ? col.getBoundingClientRect().top : 0)),
            height: Math.round(rr.height),
            width: Math.round(rr.width),
            bg: getComputedStyle(r).backgroundColor,
          };
        }),
      };
    });
    check('两条时间段任务都画成了块', blocks.mineCount === 2, JSON.stringify(blocks));
    check('重叠的任务并排分栏（按重叠数均分列宽）',
      blocks.widths.length === 2 && blocks.colW > 0 && blocks.overlap[0] > 1
      && blocks.widths.every((w) => Math.abs(w - blocks.colW / blocks.overlap[0]) <= 3),
      JSON.stringify(blocks));
    check('重叠时给出重叠提示（data-overlap ≥ 2）',
      blocks.overlap.every((n) => n >= 2), JSON.stringify(blocks.overlap));
    check('不再给整段任务铺背景色块',
      blocks.regions.length === 0, JSON.stringify(blocks.regions));
    check('工字线首尾都有横杠',
      blocks.caps.length === 2 && blocks.caps.every((c) => c[0] === '1' && c[1] === '1'), JSON.stringify(blocks.caps));
    check('任务块画在开始时刻那一行（top ≈ 开始时间×44）',
      blocks.tops.some((t) => Math.abs(t - expectedTop) <= 3), JSON.stringify({ tops: blocks.tops, expectedTop }));

    // 4) 悬停显示时分
    const colBox = await page.evaluate(() => {
      const col = document.querySelector('[data-week-col]');
      const r = col.getBoundingClientRect();
      return { x: r.left + r.width / 2, top: r.top, h: r.height };
    });
    await page.mouse.move(colBox.x, colBox.top + 10 * 44 + 20);
    await sleep(400);
    const hover = await page.evaluate(() => document.querySelector('[data-week-hover]')?.innerText.trim() || '');
    check('鼠标放到时间线上显示时分（≈10:30）', /^10:(15|30|45|00)$/.test(hover), hover);

    // 5) 双击时间线按所在时分新建（1 小时时段）
    await page.mouse.click(colBox.x, colBox.top + 9 * 44 + 10, { clickCount: 2, delay: 60 });
    await waitSel(page, '.editor-panel, [role="dialog"]', 12000);
    await sleep(1200);
    const preset = await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel') || document.querySelector('[role="dialog"]');
      const text = panel ? panel.innerText.replace(/\s+/g, ' ') : '';
      const time = text.match(/(\d{1,2})月(\d{1,2})日 (\d{2}:\d{2})/);
      return { text: text.slice(0, 120), time: time ? time[3] : '', hasEnd: /结束时间/.test(text) };
    });
    check('双击时间线打开新建面板', !!preset.text, preset.text.slice(0, 60));
    check('新建面板预填了鼠标所在的时分（≈09:15）', /09:(00|15|30|45)/.test(preset.time), preset.time);
    check('新建面板同时带上结束时间（1 小时时段）', preset.hasEnd === true, preset.text.slice(0, 80));
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(600);
    await page.screenshot({ path: path.join(SHOTS, 'calendar-week.png') });

    // 6) 后台「周起始日」：改成周日，第一列应变成周日
    await api(page, '/api/configs', 'PUT', { key: 'calendar_week_start', value: 'sunday' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitSel(page, '[data-cal-view-toggle]', 20000);
    await sleep(1500);
    await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
    await waitSel(page, '[data-week-col]', 15000);
    await sleep(1200);
    // 周起始日是进页面后异步读的（启动引导），这里等它生效，别抢在读取之前断言
    let firstCol = '';
    for (let i = 0; i < 25; i += 1) {
      firstCol = await page.evaluate(() => {
        const head = document.querySelector('[data-week-grid] div[class*="text-center"]');
        return (head?.innerText || '').trim();
      });
      if (/周日/.test(firstCol)) break;
      await sleep(400);
    }
    check('把后台「周起始日」改成周日后，第一列变成周日', /周日/.test(firstCol), firstCol);
    await api(page, '/api/configs', 'PUT', { key: 'calendar_week_start', value: String(weekStartBefore) });
    await sleep(600);
    const weekStartAfter = String((await api(page, '/api/configs')).body?.data?.calendar_week_start ?? '');
    check('周起始日配置已还原（真回读核对）', weekStartAfter === String(weekStartBefore),
      `原值 ${weekStartBefore} → 现 ${weekStartAfter}`);

    // ---------- 清理 ----------
    for (const id of created) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    await sleep(600);
    const left = ((await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [])
      .filter?.((i) => String(i.title).includes(`-${STAMP}`)) || [];
    check('自检数据已清理', left.length === 0, String(left.length));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error('运行失败：', err); process.exit(1); });
