/**
 * 「人生要有仪式感」固定栏目 + 循环周期（第 x 次 / 第 x 期）。
 *
 *   1) 后台偏好 ceremony_enabled 默认开、登记为个人偏好、归在「功能开关」
 *   2) 侧栏有固定入口，点进去是**倒计时卡片页**（不是普通清单列表）
 *   3) 常用事项模板一键创建：情人节（固定公历）、中秋节（农历八月十五，要算下一次）
 *   4) 自己新建事项（名称 + 日期）→ 卡片出现、天数正确
 *   5) 循环项目显示「第 x 次」：仪式感卡片角标 + 普通列表行角标（完成一次后变第 2 次）
 *   6) 信用卡卡面显示「第 x 期」
 *   7) 关掉偏好入口消失（关掉只隐藏、不删数据），测完还原
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-107.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();

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
async function waitSel(page, sel, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

const madeIds = [];

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, BASE);

    // ---------- 1. 偏好登记 ----------
    const meta = (await api(page, '/api/configs/user/meta')).body?.data || [];
    // 基线：这一栏里原本就有的条目（生产上可能是用户自己的生日/纪念日）与偏好的原值。
    // 用例只删**本次新建**的条目、只还原偏好原值 —— 否则在生产上跑一次会删掉用户的东西。
    const baselineIds = new Set();
    let prefOriginal = 'true';
    {
      const lists0 = (await api(page, '/api/reminder/lists')).body?.data || [];
      const b0 = lists0.find((l) => l.template === 'ceremony');
      if (b0) {
        const items0 = (await api(page, `/api/reminder/items?view=all&status=all&list_id=${b0.id}`)).body?.data || [];
        for (const it of items0) baselineIds.add(it.id);
      }
      const mine0 = (await api(page, '/api/configs/user')).body?.data || {};
      if (typeof mine0.ceremony_enabled === 'string') prefOriginal = mine0.ceremony_enabled;
    }
    const pref = meta.find((c) => c.key === 'ceremony_enabled') || null;
    check('「人生要有仪式感」已登记为个人偏好且默认开启',
      pref?.scope === 'user' && pref?.default === 'true', JSON.stringify({ scope: pref?.scope, default: pref?.default }));
    check('这个偏好归在「功能开关」分组', pref?.group === 'features', String(pref?.group));

    // ---------- 2. 侧栏入口 + 倒计时页 ----------
    await gotoRetry(page, BASE + '/admin');
    const navOk = await waitSel(page, '[data-nav-ceremony]', 20000);
    check('侧栏有「人生要有仪式感」固定入口', navOk);
    // 只该出现一次：固定栏目那一行。曾经因为它同时被当成普通清单列进了「我的清单」，
    // 侧栏出现两行，而且普通清单那一行**不受偏好控制**（用户报的「重复出现，有一个
    // 不受后台管理」就是这个）。
    const dup = await page.evaluate(() => {
      // 只看**侧栏**里的行：列表里的任务行文字里也会带清单名（「… · 人生要有仪式感」），
      // 那不是侧栏入口。
      const all = [...document.querySelectorAll('.sidebar .nav-row')].filter((el) => (el.textContent || '').includes('人生要有仪式感'));
      return {
        total: all.length,
        fixed: all.filter((el) => el.hasAttribute('data-nav-ceremony')).length,
        titles: all.map((el) => (el.getAttribute('title') || el.textContent || '').trim().slice(0, 18)),
      };
    });
    check('侧栏里「人生要有仪式感」只出现一次（就是那个固定栏目）',
      dup.total === 1 && dup.fixed === 1, JSON.stringify(dup));
    const bucket = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.template === 'ceremony') || null;
    check('清单接口里有固定的仪式感栏目（模板 ceremony、图标 ceremony）',
      !!bucket && bucket.icon === 'ceremony', JSON.stringify(bucket));
    if (!bucket) { console.log('\n没有仪式感栏目，后续用例无法继续'); process.exit(1); }

    await page.evaluate(() => document.querySelector('[data-nav-ceremony]').click());
    await sleep(1800);
    const pageInfo = await page.evaluate(() => ({
      url: location.pathname,
      panel: !!document.querySelector('[data-ceremony-panel]'),
      title: document.querySelector('[data-ceremony-page-title]')?.textContent.trim() || '',
      addBtn: !!document.querySelector('[data-ceremony-add]'),
    }));
    check('点进去是倒计时卡片页（有 ceremony-panel 与标题）',
      pageInfo.panel && pageInfo.url === `/admin/list/${bucket.id}` && pageInfo.title === '人生要有仪式感',
      JSON.stringify(pageInfo));

    // ---------- 3. 模板一键创建：情人节（公历）+ 中秋（农历） ----------
    const createByPreset = async (key) => {
      await page.evaluate(() => document.querySelector('[data-ceremony-presets]').click());
      await sleep(500);
      const clicked = await page.evaluate((k) => {
        const btn = document.querySelector(`[data-ceremony-preset="${k}"]`);
        if (!btn) return false;
        btn.click();
        return true;
      }, key);
      await sleep(1800);
      return clicked;
    };
    check('能打开「常用事项模板」并点到国庆节', await createByPreset('national-day'));
    check('能一键创建中秋节（农历八月十五）', await createByPreset('mid-autumn'));

    const cardOf = async (titlePart) => page.evaluate((t) => {
      const card = [...document.querySelectorAll('[data-ceremony-card]')]
        .find((c) => (c.querySelector('[data-ceremony-title]')?.textContent || '').includes(t));
      if (!card) return null;
      return {
        title: card.querySelector('[data-ceremony-title]')?.textContent.trim(),
        days: Number(card.getAttribute('data-ceremony-days')),
        countdown: card.querySelector('[data-ceremony-countdown]')?.textContent.replace(/\s+/g, ' ').trim(),
        meta: card.querySelector('.ceremony-date')?.textContent.replace(/\s+/g, ' ').trim(),
        lunar: card.querySelector('[data-ceremony-lunar]')?.textContent.trim() || '',
        lunarBelow: (() => {
          const solar = card.querySelector('[data-ceremony-solar]')?.getBoundingClientRect();
          const lunar = card.querySelector('[data-ceremony-lunar]')?.getBoundingClientRect();
          return !!(solar && lunar && lunar.top >= solar.bottom - 1);
        })(),
        cycle: card.querySelector('[data-ceremony-cycle]')?.textContent.trim() || '',
      };
    }, titlePart);
    const national = await cardOf('国庆');
    check('国庆节卡片出现，倒计时是天数、公历日期落在 10 月 1 日、另一行是农历',
      !!national && /还有 \d+ 天|今天|明天/.test(national.countdown) && /10月1日/.test(national.meta) && !!national.lunar && national.lunarBelow,
      JSON.stringify(national));
    // 情人节改成「填第一次」（用户 2026-10-15：情人节：第一次情人节；七夕：第一次七夕）：
    // 点模板先出表单（日期栏写「第一次情人节」、默认每年重复），填完保存才见卡片。
    // valentine 还要留给下面第 5 段查「第 1 次」角标。
    await page.evaluate(() => document.querySelector('[data-ceremony-presets]').click());
    await sleep(500);
    await page.evaluate(() => document.querySelector('[data-ceremony-preset="valentine"]')?.click());
    await sleep(900);
    const valentineForm = await page.evaluate(() => ({
      open: !!document.querySelector('[data-ceremony-form-date]'),
      label: (document.querySelector('[data-ceremony-form-date]')?.closest('.field-label')?.textContent || '').replace(/\s+/g, ' ').trim(),
      repeat: document.querySelector('[data-ceremony-form-repeat]')?.value || '',
      title: document.querySelector('[data-ceremony-form-title]')?.value || '',
    }));
    check('点「情人节」模板先打开表单，日期栏写「第一次情人节」',
      valentineForm.open && /第一次情人节/.test(valentineForm.label), JSON.stringify(valentineForm));
    check('情人节模板默认按「每年」重复', valentineForm.repeat === 'yearly', JSON.stringify(valentineForm.repeat));
    await page.evaluate(() => document.querySelector('[data-ceremony-form-save]')?.click());
    await sleep(2200);
    const valentine = await cardOf('情人节');
    check('保存后情人节卡片出现，标了「每年」',
      !!valentine && valentine.meta.includes('每年'), JSON.stringify(valentine));
    const midAutumn = await cardOf('中秋');
    check('中秋卡片同时显示公历和农历（八月十五）、不再单独标「农历」，并且每年重复',
      !!midAutumn && midAutumn.meta.includes('八月十五') && !midAutumn.meta.includes('农历') && midAutumn.meta.includes('每年'),
      JSON.stringify(midAutumn));
    // 中秋的日期必须是农历八月十五换算出来的那一天（用接口独立验一次）
    const nowYear = new Date().getFullYear();
    let lunarDay = null;
    for (const y of [nowYear, nowYear + 1]) {
      const res = await api(page, `/api/reminder/lunar/convert?lunar_year=${y}&lunar_month=8&lunar_day=15`);
      const d = res.body?.data;
      if (!d) continue;
      const when = new Date(d.year, d.month - 1, d.day, 9, 0, 0, 0);
      if (when.getTime() >= Date.now() - 86400000) { lunarDay = `${d.month}月${d.day}日`; break; }
    }
    check('中秋卡片上的日期 = 农历八月十五换算出来的下一个公历日期',
      !!midAutumn && !!lunarDay && midAutumn.meta.includes(lunarDay),
      JSON.stringify({ meta: midAutumn?.meta, lunarDay }));

    // ---------- 4. 自己新建事项 ----------
    const customTitle = `自检仪式-${STAMP}`;
    await page.evaluate(() => document.querySelector('[data-ceremony-add]').click());
    await sleep(600);
    const saved = await page.evaluate(async (t) => {
      const setVal = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const title = document.querySelector('[data-ceremony-form-title]');
      if (!title) return { ok: false, why: '没有表单' };
      setVal(title, t);
      await new Promise((r) => setTimeout(r, 300));
      const btn = document.querySelector('[data-ceremony-form-save]');
      if (!btn || btn.disabled) return { ok: false, why: '保存按钮不可用（默认日期没填上？）' };
      btn.click();
      return { ok: true };
    }, customTitle);
    await sleep(2000);
    check('自己新建事项能保存（表单默认带日期）', saved.ok === true, JSON.stringify(saved));
    const custom = await cardOf(customTitle);
    check('新建的事项在倒计时卡片里', !!custom, JSON.stringify(custom));

    // ---------- 5. 循环项目「第 x 次」 ----------
    const ceremonyItems = (await api(page, `/api/reminder/items?view=all&status=all&list_id=${bucket.id}`)).body?.data || [];
    for (const item of ceremonyItems) {
      if (!baselineIds.has(item.id)) madeIds.push(item.id);
    }
    const repeating = ceremonyItems.find((i) => i.title.includes('情人节')) || null;
    check('循环项目带 cycle_index（第一年就是第 1 次）',
      !!repeating && repeating.cycle_index === 1, JSON.stringify({ title: repeating?.title, cycle: repeating?.cycle_index }));
    check('仪式感卡片上写「与你共度 1 次」', !!valentine?.cycle.includes('与你共度 1 次'), JSON.stringify({ cycle: valentine?.cycle }));

    // 卡片透明度（用户 2026-10-19：「可以把整个卡片调整为透明（不含文字）」）
    const hasAlpha = await page.evaluate(() => {
      const card = [...document.querySelectorAll('[data-ceremony-card]')].find((c) => c.textContent.includes('情人节'));
      return !!card?.querySelector('[data-ceremony-form-bg-alpha]') || false;
    });
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('[data-ceremony-card]')].find((c) => c.textContent.includes('情人节'));
      card?.querySelector('[data-ceremony-edit]')?.click();
    });
    await sleep(700);
    const alphaSlider = await page.evaluate(() => !!document.querySelector('[data-ceremony-form-bg-alpha]'));
    check('编辑卡片时有「卡片透明度」滑杆', alphaSlider, JSON.stringify({ hasAlpha, alphaSlider }));
    await page.evaluate(() => {
      const el = document.querySelector('[data-ceremony-form-bg-alpha]');
      if (el) { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await sleep(200);
    await page.evaluate(() => document.querySelector('[data-ceremony-form-save]')?.click());
    await sleep(1800);
    const ghost = await page.evaluate(() => {
      const card = [...document.querySelectorAll('[data-ceremony-card]')].find((c) => c.textContent.includes('情人节'));
      if (!card) return null;
      const fill = card.querySelector('[data-ceremony-bg-fill]');
      const title = card.querySelector('[data-ceremony-title]');
      return {
        alpha: fill?.getAttribute('data-ceremony-bg-fill') || '',
        opacity: fill ? getComputedStyle(fill).opacity : '',
        titleColor: title ? getComputedStyle(title).color : '',
      };
    });
    check('卡片背景能淡到 30%，文字颜色保持不变',
      !!ghost && ghost.alpha === '30' && ghost.opacity === '0.3' && !!ghost.titleColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(ghost.titleColor),
      JSON.stringify(ghost));

    // 普通列表里的循环任务：完成一次后变「第 2 次」
    const loopTitle = `自检循环次数-${STAMP}`;
    const due = new Date(); due.setHours(23, 30, 0, 0);
    const loop = await api(page, '/api/reminder/items', 'POST', {
      title: loopTitle, due_at: due.toISOString(), repeat_rule: 'daily', channels: ['inapp'],
    });
    const loopId = loop.body?.data?.id;
    if (loopId) madeIds.push(loopId);
    await api(page, `/api/reminder/items/${loopId}/complete`, 'POST');
    await gotoRetry(page, BASE + '/admin/all');
    await waitSel(page, '.reminder-row', 20000);
    await sleep(1500);
    const loopBadge = await page.evaluate((t) => {
      const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes(t));
      return row ? (row.querySelector('[data-cycle-badge]')?.textContent.replace(/\s+/g, ' ').trim() || '') : '';
    }, loopTitle.slice(0, 10));
    check('列表里循环任务完成一次后显示「第 2 次」', loopBadge === '第 2 次', JSON.stringify({ loopBadge }));

    // 计划页的同一张卡片：不再说第几次，改成「剩余 天 小时 分」
    await gotoRetry(page, BASE + '/admin/planned');
    await waitSel(page, '[data-cycle-badge]', 20000);
    await sleep(1200);
    const planBadge = await page.evaluate((t) => {
      const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes(t));
      if (!row) return null;
      const badge = row.querySelector('[data-cycle-badge]');
      return badge ? {
        text: badge.textContent.replace(/\s+/g, ' ').trim(),
        remaining: badge.getAttribute('data-cycle-remaining') || '',
      } : null;
    }, loopTitle.slice(0, 10));
    check('计划页循环卡片改显示剩余时间（天/小时/分）',
      !!planBadge && /^(剩余|已逾期) (\d+ 天 )?\d+ 小时 \d+ 分$/.test(planBadge.text) && !/^第/.test(planBadge.text),
      JSON.stringify(planBadge));

    // ---------- 6. 信用卡「第 x 期」 ----------
    const cardList = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.template === 'credit_card');
    if (cardList) {
      await gotoRetry(page, BASE + `/admin/list/${cardList.id}`);
      await waitSel(page, '[data-card-face]', 20000);
      await sleep(1200);
      const periodBadges = await page.evaluate(() => [...document.querySelectorAll('[data-card-item]')].map((el) => ({
        id: Number(el.getAttribute('data-card-item')),
        badge: el.querySelector('[data-card-period-index]')?.textContent.trim() || '',
      })));
      const cards = (await api(page, '/api/reminder/cards')).body?.data || [];
      const expectedById = new Map(cards.map((c) => [c.id, c.current?.period && c.created_at
        ? (Number(c.current.period.slice(0, 4)) - Number(c.created_at.slice(0, 4))) * 12
          + (Number(c.current.period.slice(5, 7)) - Number(c.created_at.slice(5, 7))) + 1
        : 0]));
      const shown = periodBadges.filter((x) => x.badge);
      check('信用卡卡面显示「第 x 期」（按开卡月份算）',
        shown.length > 0 && shown.every((x) => x.badge === `第 ${expectedById.get(x.id)} 期`),
        JSON.stringify({ shown: shown.slice(0, 3), expected: [...expectedById].slice(0, 3) }));
    } else {
      check('信用卡栏目存在（跳过期数断言）', false, '没有信用卡栏目');
    }

    // ---------- 7. 关掉偏好：入口消失（只隐藏不删数据） ----------
    await api(page, '/api/configs', 'PUT', { key: 'ceremony_enabled', value: 'false' });
    await gotoRetry(page, BASE + '/admin');
    await sleep(2000);
    const hidden = await page.evaluate(() => {
      // 侧栏里一个都不该有（固定入口 + 普通清单行）；列表里的任务行不受影响（关掉只是隐藏栏目）
      const anyRow = [...document.querySelectorAll('.sidebar .nav-row')].some((el) => (el.textContent || '').includes('人生要有仪式感'));
      return !document.querySelector('[data-nav-ceremony]') && !anyRow;
    });
    const stillThere = ((await api(page, `/api/reminder/items?view=all&status=all&list_id=${bucket.id}`)).body?.data || []).length;
    check('关掉偏好后侧栏入口消失，但条目一条都没删',
      hidden === true && stillThere >= 2, JSON.stringify({ hidden, stillThere }));
    await api(page, '/api/configs', 'PUT', { key: 'ceremony_enabled', value: prefOriginal });
    await gotoRetry(page, BASE + '/admin');
    await sleep(1800);
    check('重新打开后入口回来', await waitSel(page, '[data-nav-ceremony]', 15000));

    // ---------- 清理 ----------
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
