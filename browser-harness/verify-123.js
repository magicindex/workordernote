/**
 * 仪式感「常用事项模板」的日期口径（用户 2026-10-15）：
 *
 *   1) 生日模板的日期栏写「第一次生日时间」（verify-119 也钉着这一条）
 *   2) 情人节 / 七夕改成「填第一次」：点模板先出表单（日期栏写「第一次情人节」「第一次七夕」），
 *      不再按固定月日一键建卡 —— 没有第一次就算不出「已过 N 次情人节」
 *   3) 婚庆里程碑补齐：银婚 25 / 金婚 50 / 钻石婚 60、75；填的是**结婚日期**，
 *      保存时把 due_at 换算成「结婚 + N 年」那一天，并且**不每年重复**（一次性倒计时）
 *   4) 里程碑卡片的倒计时是「还有 N 天」，不是从结婚那天起的累积天数
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-123.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

let passed = 0;
let failed = 0;
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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}

/** 「结婚 + N 年」同月同日同时刻（2 月 29 日结婚、周年落在平年时退回 2 月最后一天）。 */
function plusYears(d, years) {
  const pad = (n) => String(n).padStart(2, '0');
  const out = new Date(d.getFullYear() + years, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0);
  if (out.getMonth() !== d.getMonth()) out.setDate(0);
  return out;
}
function stamp(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const madeIds = [];

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, BASE);

    const ceremony = ((await api(page, '/api/reminder/lists')).body?.data?.items
      || (await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.template === 'ceremony');
    check('存在「人生要有仪式感」栏目', !!ceremony?.id, JSON.stringify(ceremony?.name));
    if (!ceremony?.id) { console.log('\n没有仪式感栏目，后续用例无法继续'); process.exit(1); }
    const ceremonyId = ceremony.id;
    const itemsOf = async () => (await api(page, `/api/reminder/items?view=all&status=all&list_id=${ceremonyId}`)).body?.data || [];
    // 已经见过的 id（基线 + 本次新建）：60 周年与 75 周年两张卡**同名**，只能靠 id 认新条目
    const known = new Set();
    for (const item of await itemsOf()) known.add(item.id);

    // ---------- 1. 新模板都在模板弹窗里 ----------
    await gotoRetry(page, BASE + `/admin/list/${ceremonyId}`);
    await sleep(2500);
    await page.evaluate(() => document.querySelector('[data-ceremony-presets]')?.click());
    await sleep(700);
    const presetKeys = await page.evaluate(() => [...document.querySelectorAll('[data-ceremony-preset]')]
      .map((b) => b.getAttribute('data-ceremony-preset')));
    for (const [key, label] of [['silver-wedding', '银婚'], ['golden-wedding', '金婚'],
      ['diamond-wedding-60', '钻石婚（60）'], ['diamond-wedding-75', '钻石婚（75）']]) {
      check(`模板里有「${label}」`, presetKeys.includes(key), JSON.stringify(presetKeys));
    }
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '取消');
      if (btn) btn.click();
    });
    await sleep(600);

    // ---------- 2. 四个里程碑：填结婚日期 → 倒计时到「结婚 + N 年」当天，且不重复 ----------
    // 表单默认日期 = 今天 09:00，所以「结婚日期」就等于今天，期望值可以精确算出来。
    const wedding = new Date();
    wedding.setHours(9, 0, 0, 0);
    const runMilestone = async (key, title, years) => {
      await gotoRetry(page, BASE + `/admin/list/${ceremonyId}`);
      await sleep(2200);
      await page.evaluate(() => document.querySelector('[data-ceremony-presets]')?.click());
      await sleep(500);
      const clicked = await page.evaluate((k) => {
        const btn = document.querySelector(`[data-ceremony-preset="${k}"]`);
        if (!btn) return false;
        btn.click();
        return true;
      }, key);
      await sleep(900);
      const form = await page.evaluate(() => ({
        open: !!document.querySelector('[data-ceremony-form-date]'),
        label: (document.querySelector('[data-ceremony-form-date]')?.closest('.field-label')?.textContent || '').replace(/\s+/g, ' ').trim(),
        repeat: document.querySelector('[data-ceremony-form-repeat]')?.value || '',
      }));
      await page.evaluate(() => document.querySelector('[data-ceremony-form-save]')?.click());
      await sleep(2200);
      const made = (await itemsOf()).filter((i) => !known.has(i.id) && i.title === title);
      const item = made[made.length - 1] || null;
      if (item) { madeIds.push(item.id); known.add(item.id); }
      return { clicked, form, item };
    };

    for (const [key, title, years, label] of [
      ['silver-wedding', '银婚纪念', 25, '银婚'],
      ['golden-wedding', '金婚纪念', 50, '金婚'],
      ['diamond-wedding-60', '钻石婚纪念', 60, '钻石婚（60 周年）'],
      ['diamond-wedding-75', '钻石婚纪念', 75, '钻石婚（75 周年）'],
    ]) {
      const r = await runMilestone(key, title, years);
      check(`${label}：点模板打开表单，日期栏写「结婚日期」、默认「不重复」`,
        r.clicked === true && r.form.open && r.form.label.includes('结婚日期') && r.form.repeat === 'none',
        JSON.stringify(r.form));
      const want = plusYears(wedding, years);
      const got = r.item?.due_at ? new Date(r.item.due_at) : null;
      check(`${label}：保存后 due_at = 结婚日期 + ${years} 年（${stamp(want)}）`,
        !!got && stamp(got) === stamp(want), JSON.stringify({ got: got ? stamp(got) : null, want: stamp(want) }));
      check(`${label}：一次性（repeat_rule=none）且备注里留了结婚日期`,
        r.item?.repeat_rule === 'none' && /结婚日期：/.test(r.item?.notes || '') && (r.item?.notes || '').includes(`${years} 周年倒计时`),
        JSON.stringify({ repeat: r.item?.repeat_rule, notes: r.item?.notes }));
    }

    // ---------- 3. 里程碑卡片是天数倒计时 ----------
    await gotoRetry(page, BASE + `/admin/list/${ceremonyId}`);
    await sleep(3000);
    const cards = await page.evaluate(() => [...document.querySelectorAll('[data-ceremony-card]')].map((c) => ({
      title: (c.querySelector('[data-ceremony-title]')?.textContent || '').trim(),
      days: Number(c.getAttribute('data-ceremony-days')),
      countdown: (c.querySelector('[data-ceremony-countdown]')?.innerText || '').replace(/\s+/g, ' ').trim(),
      pass: (c.querySelector('[data-ceremony-pass]')?.innerText || '').trim(),
    })));
    check('四张婚龄卡片都在（银婚 / 金婚 / 两张钻石婚）',
      cards.filter((c) => /银婚|金婚|钻石婚/.test(c.title)).length === 4,
      JSON.stringify(cards.map((c) => c.title)));
    // 60 与 75 周年两张卡同名（钻石婚纪念），按「天数对不对得上」认卡
    for (const [years, label] of [[25, '银婚'], [50, '金婚'], [60, '钻石婚（60 周年）'], [75, '钻石婚（75 周年）']]) {
      const want = Math.round((plusYears(wedding, years) - Date.now()) / 86400000);
      const c = cards.find((x) => Math.abs(x.days - want) <= 1) || null;
      check(`${label}卡片：倒计时是「还有 N 天」且天数对得上 ${years} 年`,
        !!c && /^还有 \d+ 天$/.test(c.countdown), JSON.stringify({ card: c, wantDays: want }));
      check(`${label}卡片：不显示「已过 N 年」这类循环徽标`, !!c && c.pass === '', JSON.stringify(c?.pass));
    }
    // 婚龄卡片不该出现「已过 N 次…」的循环文案
    check('里程碑卡片上都没有「已过 N 年」徽标',
      cards.filter((c) => /银婚|金婚|钻石婚/.test(c.title)).every((c) => c.pass === ''),
      JSON.stringify(cards.filter((c) => /银婚|金婚|钻石婚/.test(c.title)).map((c) => ({ t: c.title, pass: c.pass }))));

    // ---------- 4. 七夕改成「填第一次七夕」（农历） ----------
    await gotoRetry(page, BASE + `/admin/list/${ceremonyId}`);
    await sleep(2200);
    await page.evaluate(() => document.querySelector('[data-ceremony-presets]')?.click());
    await sleep(500);
    const qixi = await page.evaluate(() => {
      const btn = document.querySelector('[data-ceremony-preset="qixi"]');
      if (!btn) return { clicked: false };
      btn.click();
      return { clicked: true };
    });
    await sleep(900);
    const qixiForm = await page.evaluate(() => ({
      label: (document.querySelector('[data-ceremony-form-date]')?.closest('.field-label')?.textContent || '').replace(/\s+/g, ' ').trim(),
      calendar: document.querySelector('[data-ceremony-form-calendar]')?.value || '',
      repeat: document.querySelector('[data-ceremony-form-repeat]')?.value || '',
    }));
    check('七夕：点模板先出表单，日期栏写「第一次七夕」、按农历、默认每年',
      qixi.clicked === true && qixiForm.label.includes('第一次七夕') && qixiForm.calendar === 'lunar' && qixiForm.repeat === 'yearly',
      JSON.stringify(qixiForm));
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '取消');
      if (btn) btn.click();
    });
    await sleep(600);

    // ---------- 5. 清理 ----------
    let cleaned = 0;
    for (const id of madeIds) {
      const res = await api(page, `/api/reminder/items/${id}`, 'DELETE');
      if (res.status === 200) cleaned += 1;
    }
    check(`自检数据已清理（${cleaned}/${madeIds.length}）`, cleaned === madeIds.length, JSON.stringify(madeIds));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
