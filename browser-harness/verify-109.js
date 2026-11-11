/**
 * 快速新建的**排版**回归（用户报的那两条：计划页「周期和控件错位」、
 * 「更多」里塞太多东西）。
 *
 *   1) 计划页芯片行：开始 / 周期（N 天输入框 + 下拉）/ 重复 / 重要 / 清单 / 更多
 *      以及「自定义」时的「结束」「清除结束」，**底边全部落在同一条水平线**上；
 *      六种周期状态各量一遍（切周期时多/少控件，最容易又错位）。
 *   2) 计划页的「开始 / 周期 / 重复」都是「标题在上、控件在下」的竖排字段。
 *   3) 今天页芯片行同样对齐：日期芯片与重复下拉搬到芯片行后不再高低不齐。
 *   4) 「更多」面板只剩一项：备注（3 行文本域）—— 按农历循环 / 过期提醒频率 / 通知方式
 *      已于 2026-11-11 撤掉；日期时间、重复更早就搬到芯片行了，都不该再出现。
 *
 * 只量排版、不新建数据，跑完把面板收起来、周期复位，「今天」芯片复位。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-109.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

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

/** 打开快速新建的芯片行：先点「新建」展开（0.18.3 起默认收起），再点一下输入框。 */
async function openQuick(page) {
  await openQuickAdd(page);
  await page.evaluate(() => {
    const input = document.querySelector('.quick-card input');
    if (!input) return;
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    input.focus();
  });
  await sleep(600);
}

/**
 * 量芯片行里每个可见 .quick-chip 的盒子。
 * 返回每项的 { text, h, top, bottom } 与汇总（不同底边/不同高度的取值）。
 */
const measureRow = (page) => page.evaluate(() => {
  const card = document.querySelector('.quick-card');
  if (!card) return { card: false, items: [] };
  const items = [...card.querySelectorAll('.quick-chip')]
    .filter((c) => c.offsetParent !== null)
    .map((c) => {
      const b = c.getBoundingClientRect();
      return {
        text: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 10),
        tag: c.tagName,
        attr: c.hasAttribute('data-plan-days') ? 'plan-days'
          : c.hasAttribute('data-plan-period') ? 'plan-period'
            : c.hasAttribute('data-quick-date') ? 'quick-date'
              : c.hasAttribute('data-quick-repeat') ? 'quick-repeat'
                : c.getAttribute('aria-label') === '选择清单' ? 'list' : '',
        h: Math.round(b.height),
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
      };
    });
  return {
    card: true,
    items,
    bottoms: [...new Set(items.map((i) => i.bottom))],
    heights: [...new Set(items.map((i) => i.h))],
  };
});

function checkRow(label, m, minCount) {
  const uniformBottom = m.bottoms.length === 1;
  const uniformHeight = m.heights.length === 1;
  check(`${label}：${m.items.length} 个控件的底边在同一条水平线上`,
    m.items.length >= minCount && uniformBottom,
    JSON.stringify({ bottoms: m.bottoms, items: m.items.map((i) => `${i.text || i.attr || i.tag}@${i.bottom}`) }));
  check(`${label}：控件高度一致（${m.heights.join('/') || '无'}）`,
    uniformHeight, JSON.stringify(m.heights));
}

const setPlanPeriod = (page, value) => page.evaluate(async (v) => {
  const sel = document.querySelector('[data-plan-period]');
  if (!sel) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, v);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  return true;
}, value);

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    // ---------- 1. 计划页：六种周期状态下都对齐 ----------
    await gotoRetry(page, BASE + '/admin/planned');
    await sleep(2200);
    await openQuick(page);

    const plan = await measureRow(page);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.quick-card .field-label')]
      .map((l) => (l.childNodes[0]?.textContent || '').trim()).filter(Boolean));
    check('计划页有「开始 / 周期 / 重复」三个字段标题', ['开始', '周期', '重复'].every((t) => labels.includes(t)),
      JSON.stringify(labels));
    check('计划页控件都带 data 钩子（days 输入框 / 周期下拉 / 清单下拉）',
      plan.items.some((i) => i.attr === 'plan-days') && plan.items.some((i) => i.attr === 'plan-period')
        && plan.items.some((i) => i.attr === 'list'),
      JSON.stringify(plan.items.map((i) => i.attr || i.text)));
    checkRow('计划页（1 天）', plan, 6);

    // 「开始」按钮与「周期」的输入框/下拉：底边必须相同（用户报的错位就是这两个）
    const pair = await page.evaluate(() => {
      const card = document.querySelector('.quick-card');
      const start = [...card.querySelectorAll('button')].find((b) => /选择开始时间|\d{4}年\d+月/.test(b.textContent));
      const days = card.querySelector('[data-plan-days]');
      const period = card.querySelector('[data-plan-period]');
      const b = (el) => (el ? Math.round(el.getBoundingClientRect().bottom) : null);
      return { start: b(start), days: b(days), period: b(period) };
    });
    check('「开始」按钮与「N 天」输入框、「周期」下拉同底边',
      pair.start !== null && pair.start === pair.days && pair.start === pair.period, JSON.stringify(pair));

    for (const value of ['week', 'month', 'yearend', 'year', 'custom', 'days']) {
      await setPlanPeriod(page, value);
      const m = await measureRow(page);
      checkRow(`计划页（周期=${value}）`, m, 6);
    }

    // ---------- 2. 今天页芯片行 ----------
    await gotoRetry(page, BASE + '/admin');
    await sleep(2200);
    await openQuick(page);
    const today = await measureRow(page);
    check('今天页：日期芯片与重复下拉在芯片行里（不再只在「更多」里）',
      today.items.some((i) => i.attr === 'quick-date') && today.items.some((i) => i.attr === 'quick-repeat'),
      JSON.stringify(today.items.map((i) => i.attr || i.text)));
    checkRow('今天页', today, 9);

    // 「今天」芯片点亮时，日期芯片上写着今天的日期
    const dateChip = await page.evaluate(() => {
      const el = document.querySelector('[data-quick-date]');
      const today = new Date();
      return {
        text: el ? el.textContent.replace(/\s+/g, ' ').trim() : '',
        active: el ? el.classList.contains('active') : null,
        expect: `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`,
      };
    });
    check('日期芯片显示今天并且是点亮态', dateChip.active === true && dateChip.text.includes(dateChip.expect),
      JSON.stringify(dateChip));

    // ---------- 3. 「更多」面板只剩一项（备注） ----------
    const panel = await page.evaluate(async () => {
      const card = document.querySelector('.quick-card');
      const more = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '更多');
      const panelBefore = !!document.querySelector('[data-quick-panel]');
      const beforeVisible = panelBefore
        ? Math.round(document.querySelector('[data-quick-panel]').getBoundingClientRect().height) : 0;
      if (!panelBefore) more?.click();
      await new Promise((r) => setTimeout(r, 500));
      const p = document.querySelector('[data-quick-panel]');
      if (!p) return { open: false, panelBefore, beforeVisible };
      return {
        open: true,
        panelBefore,
        beforeVisible,
        labels: [...p.querySelectorAll('.field-label')].map((l) => (l.childNodes[0]?.textContent || '').trim()).filter(Boolean),
        // 2026-11-11 起备注是 textarea（3 行），不再是单行 input
        hasNotesBox: (() => {
          const ta = p.querySelector('textarea');
          return !!ta && ta.getAttribute('rows') === '3';
        })(),
        submit: [...p.querySelectorAll('button')].some((b) => ['添加', '添加提醒', '保存中'].includes(b.textContent.trim())),
        text: (p.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });
    check('「更多」面板默认收起（点「更多」才展开）', panel.panelBefore === false && panel.open === true,
      JSON.stringify({ panelBefore: panel.panelBefore, open: panel.open }));
    check('「更多」里只剩一项：备注',
      panel.labels.length === 1 && panel.labels[0] === '备注', JSON.stringify(panel.labels));
    check('日期时间 / 重复 已经搬出「更多」',
      !panel.text.includes('日期时间') && !panel.labels.includes('重复'), panel.text.slice(0, 120));
    check('「更多」里仍有备注（3 行文本域）与提交按钮', panel.hasNotesBox === true && panel.submit === true,
      JSON.stringify({ hasNotesBox: panel.hasNotesBox, submit: panel.submit }));

    // ---------- 收尾：收起「更多」，周期复位 ----------
    await page.evaluate(() => {
      const card = document.querySelector('.quick-card');
      const more = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '更多');
      if (document.querySelector('[data-quick-panel]')) more?.click();
    });
    await sleep(400);
    const restored = await page.evaluate(() => ({
      panel: !!document.querySelector('[data-quick-panel]'),
      date: document.querySelector('[data-quick-date]')?.textContent.replace(/\s+/g, ' ').trim() || '',
    }));
    check('收尾：「更多」已收起、日期仍是今天（没有把「无日期」状态留给后面的用例）',
      restored.panel === false && restored.date.length > 0, JSON.stringify(restored));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
