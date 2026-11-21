/**
 * 提醒编辑页精简（用户 2026-11-21）：
 *
 *   「提醒编辑页面 取消图片中 通知方式，取消颜色部分，取消过期提醒频率，取消按农历循环，
 *     尽量调整精简，编辑一般只是为了修改内容，频率和颜色这些默认值保持不动即可，
 *     界面只留标题、内容、时间、分类和清单。」
 *
 * 钉住这几条：
 *   1. 编辑抽屉（列表页）与编辑弹窗（日历里）都只剩：标题 / 备注 / 日期时间 / 类型 / 清单 / 重复；
 *      不再出现 通知方式、颜色、优先级、按农历循环、过期提醒频率；
 *   2. 只改标题保存后，这条提醒原有的 颜色 / 优先级 / 农历 / 过期提醒频率 / 渠道 **原样保留**；
 *   3. 新建出来的提醒用默认值（color 空、priority 0、calendar solar、repeat_notify 0、channels inapp、repeat none）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-216.js
 */
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const TITLE = `精简自检-${STAMP}`;
const MODAL_TITLE = `精简新建-${STAMP}`;
let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await res.json().catch(() => null);
}, { base: BASE, p, method, body });

/** 编辑面板里可见的字段名（.editor-field 的第一行文字）。 */
const fieldLabels = (page) => page.evaluate(() => {
  const root = document.querySelector('.editor-panel');
  if (!root) return null;
  return {
    fields: [...root.querySelectorAll('.editor-field')].map((f) => ((f.querySelector(':scope > span')?.textContent || '').trim())
      || (f.textContent || '').trim().split('\n')[0]),
    text: root.innerText,
    colorButtons: root.querySelectorAll('[data-editor-color]').length,
    channelOptions: root.querySelectorAll('.channel-option').length,
    repeatNotify: root.querySelectorAll('.repeat-notify').length,
  };
});

const expectSimplified = (label, st) => {
  check(`${label}：面板里只剩 标题/备注/日期时间/类型/清单/重复`,
    !!st && ['标题', '备注', '日期时间', '类型', '清单', '重复'].every((t) => st.fields.includes(t)),
    JSON.stringify(st?.fields));
  check(`${label}：通知方式 / 颜色 / 优先级 / 按农历循环 / 过期提醒频率 都不见了`,
    !!st && !st.text.includes('通知方式') && st.colorButtons === 0 && st.channelOptions === 0
      && st.repeatNotify === 0 && !st.text.includes('按农历循环') && !st.text.includes('过期提醒频率')
      && !st.fields.includes('优先级'),
    JSON.stringify({ channels: st?.channelOptions, colors: st?.colorButtons, repeatNotify: st?.repeatNotify }));
};

(async () => {
  console.log(`目标：${BASE}`);
  let itemId = 0;
  let modalId = 0;
  await withTab(async (page) => {
    await login(page, BASE);
    const lists = (await api(page, '/api/reminder/lists'))?.data || [];
    const listId = lists.find((l) => l.template !== 'credit_card')?.id;
    const tomorrow = await page.evaluate(() => {
      const d = new Date(Date.now() + 24 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });
    const seeded = await api(page, '/api/reminder/items', 'POST', {
      title: TITLE, kind: 'task', list_id: listId,
      due_at: `${tomorrow}T10:00:00+08:00`,
      repeat_rule: 'yearly', calendar: 'lunar', priority: 3, color: 'rose',
      repeat_notify_minutes: 15, channels: ['inapp'],
    });
    itemId = Number(seeded?.data?.id || 0);
    check('造好一条「带颜色/优先级/农历/过期频率」的提醒', itemId > 0, JSON.stringify(seeded?.message || ''));

    try {
      // ---------------- 1. 列表页编辑抽屉 ----------------
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(BASE + '/admin/all', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitFor(page, () => !!document.querySelector('.reminder-row'), { timeout: 20000 }).catch(() => {});
      await sleep(1200);
      await page.evaluate((t) => {
        const row = [...document.querySelectorAll('article.reminder-row')].find((r) => (r.textContent || '').includes(t));
        row?.querySelector('button.min-w-0.flex-1.text-left')?.click();
      }, TITLE);
      await waitFor(page, () => !!document.querySelector('[data-reminder-view]'), { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => document.querySelector('[data-view-edit]')?.click());
      await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 8000 }).catch(() => {});
      await sleep(500);
      expectSimplified('列表编辑抽屉', await fieldLabels(page));

      // 只改标题并保存
      const edited = `${TITLE}-改`;
      await page.evaluate((t) => {
        const input = document.querySelector('.editor-panel .editor-field input');
        if (!input) return;
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, t);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, edited);
      await page.evaluate(() => {
        const save = [...document.querySelectorAll('.editor-panel button')].find((b) => /保存提醒/.test(b.textContent || ''));
        save?.click();
      });
      await waitFor(page, () => !document.querySelector('.editor-panel'), { timeout: 10000 }).catch(() => {});
      await sleep(600);
      const after = (await api(page, `/api/reminder/items/${itemId}`))?.data || {};
      check('标题改成功了', after.title === edited, String(after.title));
      check('原颜色/优先级/农历/过期频率/渠道 原样保留',
        after.color === 'rose' && Number(after.priority) === 3 && after.calendar === 'lunar'
          && Number(after.repeat_notify_minutes) === 15 && (after.channels || []).includes('inapp')
          && after.repeat_rule === 'yearly',
        JSON.stringify({ color: after.color, priority: after.priority, calendar: after.calendar, notify: after.repeat_notify_minutes, rule: after.repeat_rule }));

      // ---------------- 2. 日历里新建（居中弹窗） ----------------
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitFor(page, () => !!document.querySelector('.cal-cell'), { timeout: 20000 }).catch(() => {});
      await sleep(1500);
      const cell = await page.evaluate(() => {
        const target = [...document.querySelectorAll('.cal-cell')]
          .find((c) => (c.querySelector('span')?.textContent || '').trim() === '15');
        if (!target) return null;
        target.scrollIntoView({ block: 'center' });
        const r = target.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + 8 };
      });
      if (cell) {
        await page.mouse.click(cell.x, cell.y, { clickCount: 2, delay: 40 });
        await waitFor(page, () => (document.body.innerText || '').includes('新建提醒'), { timeout: 8000 }).catch(() => {});
        await sleep(500);
      }
      expectSimplified('日历新建弹窗', await fieldLabels(page));
      // 填标题并保存（其余全默认）
      await page.evaluate((t) => {
        const input = document.querySelector('.editor-panel .editor-field input');
        if (!input) return;
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, t);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, MODAL_TITLE);
      await page.evaluate(() => {
        const save = [...document.querySelectorAll('.editor-panel button')].find((b) => /保存提醒/.test(b.textContent || ''));
        save?.click();
      });
      await sleep(1500);
      const found = (await api(page, `/api/reminder/items?q=${encodeURIComponent(MODAL_TITLE)}`))?.data || [];
      const created = (Array.isArray(found) ? found : found.items || []).find((x) => x.title === MODAL_TITLE);
      modalId = Number(created?.id || 0);
      check('新建的提醒拿到了', modalId > 0, JSON.stringify(found).slice(0, 120));
      if (modalId) {
        const fresh = (await api(page, `/api/reminder/items/${modalId}`))?.data || {};
        check('新建提醒用的是默认值（默认色 / 优先级 0 / 公历 / 过期频率 0 / 站内消息 / 不重复）',
          (fresh.color || '') === '' && Number(fresh.priority) === 0 && (fresh.calendar || 'solar') === 'solar'
            && Number(fresh.repeat_notify_minutes) === 0 && (fresh.channels || []).includes('inapp')
            && fresh.repeat_rule === 'none',
          JSON.stringify({ color: fresh.color, priority: fresh.priority, calendar: fresh.calendar, notify: fresh.repeat_notify_minutes, rule: fresh.repeat_rule }));
      }
    } finally {
      if (modalId) await api(page, `/api/reminder/items/${modalId}`, 'DELETE').catch(() => {});
      if (itemId) await api(page, `/api/reminder/items/${itemId}`, 'DELETE').catch(() => {});
    }
  }, { width: 1440, height: 1000 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
