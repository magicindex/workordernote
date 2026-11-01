/**
 * 验证周视图任务标题：
 *   1) 标签在线段右侧、横线居中
 *   2) 横线长度跟随标签文字，右侧与文字右端对齐
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
const STAMP = Date.now();
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
async function api(token, apiPath, method = 'GET', body = null) {
  const res = await fetch(ROOT + apiPath, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.code !== 0) throw new Error(`${method} ${apiPath} → ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}
(async () => {
  let token = '', listId = 0;
  const ids = [];
  try {
    await withTab(async (page) => {
      await login(page, BASE);
      token = await page.evaluate(() => localStorage.getItem('reminders.token') || '');
      const list = await api(token, '/api/reminder/lists', 'POST', { name: `竖排标签-${STAMP}`, color: 'blue', icon: 'list' });
      listId = Number(list.id);
      const today = await page.evaluate(() => {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      });
      const mk = async (title, offsetMin, durationMin, color = '') => {
        const start = new Date(Date.now() + offsetMin * 60_000);
        const end = new Date(start.getTime() + durationMin * 60_000);
        const item = await api(token, '/api/reminder/items', 'POST', {
          title, kind: 'task', start_at: start.toISOString(), end_at: end.toISOString(),
          due_at: end.toISOString(), repeat_rule: 'none', channels: ['inapp'], list_id: listId, color,
        });
        ids.push(String(item.id));
        return String(item.id);
      };
      // 放在未来，避免「超时未完成自动续日」把 10 分钟的短线拉长。
      const longId = await mk('竖排任务内容自检', 30, 120);
      const shortId = await mk('短线任务', 240, 10, 'rose');
      const shortB = await mk('短线任务乙', 240, 10, 'emerald');
      const shortC = await mk('短线任务丙', 240, 10, 'amber');
      await page.evaluate((id) => localStorage.setItem('ui_calendar_lists', JSON.stringify([id])), listId);
      await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      for (const b of await page.$$('button')) {
        if ((await b.evaluate(el => el.textContent || '')).includes('知道了')) { await b.click(); await sleep(700); break; }
      }
      await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
      await sleep(900);
      if (!(await page.$('[data-week-label-mode]'))) {
        await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
        await sleep(800);
      }

      const read = (id) => page.evaluate((bid) => {
        const block = document.querySelector(`[data-week-block="${bid}"]`);
        if (!block) return null;
        const label = block.querySelector('[data-week-label-mode]');
        if (!label) return { missing: true };
        const line = block.querySelector('span');
        const caps = [...block.querySelectorAll('[data-week-cap]')];
        const br = block.getBoundingClientRect(), lr = label.getBoundingClientRect();
        return {
          mode: label.dataset.weekLabelMode,
          writing: getComputedStyle(label).writingMode,
          writing: getComputedStyle(label).writingMode,
          writing: getComputedStyle(label).writingMode,
          lw: Math.round(lr.width), lh: Math.round(lr.height),
          lineRight: Math.round(line.getBoundingClientRect().right),
          labelLeft: Math.round(lr.left), labelRight: Math.round(lr.right),
          labelTop: Math.round(lr.top - br.top),
          insideTop: lr.top >= br.top - 1,
          insideBottom: lr.bottom <= br.bottom + 1,
          capRights: caps.map((c) => Math.round(c.getBoundingClientRect().right)),
          capWidths: caps.map((c) => Math.round(c.getBoundingClientRect().width)),
          text: label.textContent,
        };
      }, id);

      const long = await read(longId);
      const short = await read(shortId);
      check('标签在竖线右侧', long?.mode === 'right' && long?.labelLeft >= long?.lineRight - 1, JSON.stringify(long));
      check('标签顶端对齐线段开始横线', Math.abs((long?.labelTop ?? -1)) <= 1, JSON.stringify(long));
      check('标签字体竖排', long?.writing === 'vertical-rl', long?.writing || '');
      check('竖排背景长度贴近字数', Math.abs(long?.lh - (long?.text.length * 10 + 4)) <= 6, JSON.stringify(long));
      check('横线右端与标签右端对齐', long?.capRights.every((r) => Math.abs(r - long.labelRight) <= 2), JSON.stringify(long));
      check('横线长度跟随标签自动延长', long?.capWidths.every((w) => w >= long.lw), JSON.stringify(long));
      check('短标签不压竖线且向右延伸', short?.labelLeft >= short?.lineRight - 1, JSON.stringify(short));

      const all = await page.$$eval('[data-week-block]', els => els.map((block) => {
        const label = block.querySelector('[data-week-label-mode]');
        if (!label) return null;
        const line = block.querySelector('span');
        const caps = [...block.querySelectorAll('[data-week-cap]')];
        const lr = label.getBoundingClientRect(), ln = line.getBoundingClientRect();
        return {
          text: label.textContent,
          writing: getComputedStyle(label).writingMode,
          clear: lr.left >= ln.right - 1,
          aligned: caps.length > 0 && caps.every((c) => Math.abs(c.getBoundingClientRect().right - lr.right) <= 2),
          mode: label.dataset.weekLabelMode,
        };
      }).filter(Boolean));
      check('所有标签都不压自己的竖线', all.every((x) => x.clear), JSON.stringify(all));
      check('所有标签的横线都对齐文字右端', all.every((x) => x.aligned), JSON.stringify(all));
      check('所有标签都是竖排', all.length > 0 && all.every((l) => l.writing === 'vertical-rl'), JSON.stringify(all));

      await page.screenshot({ path: path.join(__dirname, 'shots', 'verify-150-label-right.png') });
    });
  } finally {
    if (token && ids.length) for (const id of ids) await api(token, `/api/reminder/items/${id}`, 'DELETE').catch(() => {});
    if (token && listId) await api(token, `/api/reminder/lists/${listId}`, 'DELETE').catch(() => {});
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
