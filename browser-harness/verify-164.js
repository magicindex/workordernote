/**
 * 验证「信用卡卡片 · 分期还款进度」（用户 2026-11-13）：
 *   1) 卡片的「第 x 期」取消：没分期、或已还清的卡一律不显示期数；
 *   2) 只有做了分期的卡才显示「分期 第 x/N 期」（已还 +1）；
 *   3) 分期弹窗允许手工改每期费率，默认用官方渠道费率。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-164.js
 * 数据：自建一张「自检分期卡…」，收尾删除。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
const CARD = `自检分期卡${STAMP % 1000}`;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  \x1b[32m✓\x1b[0m ${name}`); return; }
  failed += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`);
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: ROOT, p, method, body });

const setValue = (page, sel, value) => page.evaluate(({ sel, value }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, String(value));
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return true;
}, { sel, value });

const cardById = async (page, id) => ((await api(page, '/api/reminder/cards')).body?.data || []).find((c) => c.id === id) || null;

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  await withTab(async (page) => {
    await login(page, BASE);
    await page.setViewport({ width: 1440, height: 960 });

    // 准备：找「信用卡账单」栏目，建一张自检卡
    const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
    const cardList = lists.find((l) => l.template === 'credit_card');
    if (!cardList) { check('找到信用卡栏目', false, '没有 credit_card 清单'); return; }
    const created = await api(page, '/api/reminder/cards', 'POST', {
      list_id: cardList.id, name: CARD, bank: '招商银行', no: '6225 8800 0000 1234',
      holder: '王耀辉', limit_cents: 5000000, statement_day: 5, due_day: 25, advance_days: 0, auto_repeat: true,
    });
    const cardId = created.body?.data?.id;
    check('自检卡已建', created.status === 200 && !!cardId, JSON.stringify(created.body).slice(0, 160));
    if (!cardId) return;

    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    await page.evaluate(() => document.querySelector('[data-nav-cards]')?.click());
    await waitFor(page, () => !!document.querySelector('[data-card-grid]'), { timeout: 20000 });
    await sleep(1200);

    // 1. 没分期的卡：不显示任何期数
    const noBadge = await page.evaluate((id) => {
      const card = document.querySelector(`[data-card-item="${id}"]`);
      return { badge: !!document.querySelector(`[data-card-installment-badge="${id}"]`), text: card ? card.textContent.replace(/\s+/g, ' ') : '' };
    }, cardId);
    check('没分期的卡不显示「第 x 期」', noBadge.badge === false && !/第\s*\d+\s*期/.test(noBadge.text), JSON.stringify(noBadge).slice(0, 200));

    // 2. 打开分期弹窗：官方费率默认带出来
    await page.evaluate((id) => document.querySelector(`[data-card-installment="${id}"]`)?.click(), cardId);
    await waitFor(page, () => !!document.querySelector('[data-installment-save]'), { timeout: 8000 });
    await sleep(400);
    await setValue(page, '[data-installment-periods]', 12);
    await setValue(page, '[data-installment-principal]', '12000');
    await setValue(page, '[data-installment-paid]', 3);
    await sleep(400);
    const official = await page.evaluate(() => ({
      text: (document.querySelector('[data-installment-official]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      result: (document.querySelector('[data-installment-result]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      rateInput: document.querySelector('[data-installment-rate]')?.value ?? null,
    }));
    check('弹窗默认用官方渠道费率（12 期 0.75%）', official.text.includes('0.75%') && official.rateInput === '', JSON.stringify(official).slice(0, 200));
    check('剩余期数与每期手续费按官方费率算（12000 × 0.75% = 90）',
      /剩余\s*9\s*期/.test(official.result) && /每期手续费\s*¥90\.00/.test(official.result), JSON.stringify(official.result).slice(0, 200));

    // 3. 保存到卡片 → 卡面显示「分期 第 4/12 期」
    await page.evaluate(() => document.querySelector('[data-installment-save]')?.click());
    await sleep(1800);
    const afterSave = await page.evaluate((id) => ({
      badge: (document.querySelector(`[data-card-installment-badge="${id}"]`)?.textContent || '').replace(/\s+/g, ' ').trim(),
      cardText: document.querySelector(`[data-card-item="${id}"]`)?.textContent.replace(/\s+/g, ' ') || '',
    }), cardId);
    const savedCard = await cardById(page, cardId);
    check('做了分期的卡显示「分期 第 4/12 期」',
      afterSave.badge.includes('第 4/12 期'), JSON.stringify({ badge: afterSave.badge, text: afterSave.cardText.slice(0, 120) }));
    check('分期计划存到卡片上（12 期 / 已还 3 / 本金 12000 / 费率 0=官方）',
      savedCard && savedCard.installment_periods === 12 && savedCard.installment_paid === 3
        && savedCard.installment_principal_cents === 1200000 && savedCard.installment_rate === 0,
      JSON.stringify(savedCard && { p: savedCard.installment_periods, paid: savedCard.installment_paid, principal: savedCard.installment_principal_cents, rate: savedCard.installment_rate }));

    // 4. 已还清：期数不显示
    await page.evaluate((id) => document.querySelector(`[data-card-installment="${id}"]`)?.click(), cardId);
    await waitFor(page, () => !!document.querySelector('[data-installment-save]'), { timeout: 8000 });
    await sleep(400);
    const prefilled = await page.evaluate(() => ({
      periods: document.querySelector('[data-installment-periods]')?.value,
      paid: document.querySelector('[data-installment-paid]')?.value,
      principal: document.querySelector('[data-installment-principal]')?.value,
      rate: document.querySelector('[data-installment-rate]')?.value,
    }));
    check('再次打开时按卡上保存的计划回填', prefilled.periods === '12' && prefilled.paid === '3' && prefilled.principal === '12000.00' && prefilled.rate === '', JSON.stringify(prefilled));
    await setValue(page, '[data-installment-paid]', 12);
    await sleep(300);
    await page.evaluate(() => document.querySelector('[data-installment-save]')?.click());
    await sleep(1800);
    const paidOff = await page.evaluate((id) => ({
      badge: !!document.querySelector(`[data-card-installment-badge="${id}"]`),
      text: document.querySelector(`[data-card-item="${id}"]`)?.textContent.replace(/\s+/g, ' ') || '',
    }), cardId);
    check('已还清的卡不显示期数', paidOff.badge === false && !/第\s*\d+\/\d+\s*期/.test(paidOff.text), JSON.stringify(paidOff).slice(0, 200));

    // 5. 手工费率：0.62% → 每期手续费 74.40，保存后卡上记住
    await page.evaluate((id) => document.querySelector(`[data-card-installment="${id}"]`)?.click(), cardId);
    await waitFor(page, () => !!document.querySelector('[data-installment-save]'), { timeout: 8000 });
    await sleep(400);
    await setValue(page, '[data-installment-paid]', 3);
    await setValue(page, '[data-installment-rate]', '0.62');
    await sleep(400);
    const manual = await page.evaluate(() => ({
      result: (document.querySelector('[data-installment-result]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      official: (document.querySelector('[data-installment-official]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    check('手工填 0.62% 后按手工费率算（12000 × 0.62% = 74.40）',
      /每期手续费\s*¥74\.40/.test(manual.result) && manual.official.includes('已手工修改'), JSON.stringify(manual).slice(0, 240));
    await page.evaluate(() => document.querySelector('[data-installment-save]')?.click());
    await sleep(1800);
    const ratedCard = await cardById(page, cardId);
    check('手工费率存到卡片（0.62）', ratedCard && Math.abs(ratedCard.installment_rate - 0.62) < 1e-6, JSON.stringify(ratedCard && ratedCard.installment_rate));

    // 6. 取消分期：期数、费率一起清掉
    await page.evaluate((id) => document.querySelector(`[data-card-installment="${id}"]`)?.click(), cardId);
    await waitFor(page, () => !!document.querySelector('[data-installment-clear]'), { timeout: 8000 });
    await sleep(300);
    await page.evaluate(() => document.querySelector('[data-installment-clear]')?.click());
    await sleep(1800);
    const cleared = await cardById(page, cardId);
    const clearedBadge = await page.evaluate((id) => !!document.querySelector(`[data-card-installment-badge="${id}"]`), cardId);
    check('取消分期后卡面不再显示期数，卡片字段清零',
      clearedBadge === false && cleared && cleared.installment_periods === 0 && cleared.installment_paid === 0
        && cleared.installment_principal_cents === 0 && cleared.installment_rate === 0,
      JSON.stringify(cleared && { p: cleared.installment_periods, paid: cleared.installment_paid, principal: cleared.installment_principal_cents, rate: cleared.installment_rate }));

    await page.screenshot({ path: path.join(SHOTS, 'card-installment.png') });
    await api(page, `/api/reminder/cards/${cardId}`, 'DELETE');
    check('自检卡已清理', true);
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
