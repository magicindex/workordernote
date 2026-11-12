/**
 * 验证「信用卡账单」固定栏目（v3：栏目 + 只新建卡片 + 卡面 + 本周待还长条卡 + 后台开关）。
 *
 * 覆盖：
 *   1) 侧栏有固定栏目「信用卡账单」（受后台偏好 credit_card_enabled 控制），点进去是它自己的页
 *      （手机端的入口在底部「清单」标签弹出的清单列表里，见 verify-128）
 *   2) 这一页只有卡片：没有快速新建、没有提醒列表行
 *   3) 「新建清单」里不再有信用卡模板（只建普通清单）
 *   4) 新建卡片 → 自动归到栏目里 + 生成账单日/还款日/提前提醒三条
 *   5) 卡面（银行卡样式：银行+卡名、掩码卡号、渐变）
 *   6) 长条卡片：左边今天（日期+星期），右边本周待还的小卡面
 *   7) 金额与还款闭环（标记已还 → 完成记录 +1；撤销已还 → 完成记录撤回 + 提醒回本期）
 *   8) 还款计划（多期 / 导出 / 打印 / 打印区表格）
 *   9) 编辑改账单日 → 提醒跟着变且不增多；删除卡片 → 提醒一并消失
 *  10) 后台关掉栏目 → 侧栏入口消失、卡片页被送走、卡片提醒从列表与日历里消失；重新打开就回来
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-097.js
 * 数据：卡片用「自检银行…」命名，收尾全部删掉；后台偏好会改也会还原。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
// 银行现在是**预设下拉**（带银行标志），所以用真实银行名；卡名带「自检」便于收尾清理。
const BANK = '招商银行';
const BANK_CODE = 'cmbchina';
const BANK2 = '中信银行';
const BANK2_CODE = 'citicbank';
const CARD = `自检白金卡${STAMP % 1000}`;
const CARD2 = `自检第二卡${STAMP % 1000}`;
const TEMP_LIST = `自检普通清单-${STAMP}`;
// 第二张卡还款日 = 今天 → 一定落在本周内，「本周待还」长条卡片才会显示它。
const TODAY_DAY = new Date().getDate();

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
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: ROOT, p, method, body });

// 注意：harness 的 waitFor 不支持把参数传进页面（fn 必须无参），
// 选择器要在外面拼好再传 —— 之前写成 (s) => querySelector(s) 永远返回 false。
/** 打开某张卡的「⋯ 更多」抽屉（次要操作现在收在里面；v-show 隐藏时点不动）。 */
async function openCardDrawer(page, id) {
  await page.evaluate((cardId) => {
    const btn = document.querySelector(`[data-card-more="${cardId}"]`);
    if (btn) btn.click();
  }, id);
  await sleep(500);
}

async function waitSel(page, sel, timeout = 8000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const hit = await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)
    if (hit) return true
    if (Date.now() > deadline) return false
    await sleep(250)
  }
}

const setInput = (page, sel, value) => page.evaluate(({ sel, value }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, { sel, value });

const setSelect = (page, sel, value) => page.evaluate(({ sel, value }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.value = String(value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, { sel, value });

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);
    let bucketId = null;
    let card1 = null;
    let card2 = null;
    const createdCards = [];
    // 完成记录接口返回的是分页结构 {items,total}，直接当数组取会得到 undefined。
    // 完成记录条数。读数偶发失败（登录限流等）时**要重试并报错**，
    // 不能静默当成 0 —— 之前就有一次把「读失败」当成「本来 0 条」，
    // 于是收尾比对莫名其妙红了（生产回归里真踩到过）。
    // 只数**本套件自己造出来的**完成记录（标题带「自检」）：生产上用户本人可能同时在用，
    // 全局总数会漂（真踩过：跑用例时用户完成了一条自己的提醒，26→28 看着像「多写了一笔」）。
    const completedCount = async () => {
      for (let i = 0; i < 4; i += 1) {
        const d = (await api(page, '/api/reminder/completed?range=all')).body?.data
        if (d) {
          const items = Array.isArray(d) ? d : d.items || []
          return items.filter((r) => /自检/.test(String(r.title))).length
        }
        await sleep(3000)
      }
      throw new Error('读不到完成记录（连续 4 次失败）')
    }
    const itemsAll = async () => (((await api(page, '/api/reminder/items?view=all&status=all')).body?.data) || [])
    const cardsOf = async () => ((await api(page, '/api/reminder/cards')).body?.data || [])
    // 套件开始时就存在的「自检」条目/卡片（迭代容器与沙箱的数据是从生产拷来的，
    // 前几轮回归被打断时可能留下残渣）：收尾**只要求不新增**，不拿 0 当标准。
    // 与 verify-091 一个口径 —— 否则单跑时会因为他人的残渣假红（2026-10-10 踩过）。
    const baseSelfCheck = new Set((await itemsAll()).filter((i) => /自检/.test(String(i.title))).map((i) => String(i.title)))
    const baseSelfCards = new Set((await cardsOf()).filter((c) => /自检/.test(String(c.name))).map((c) => String(c.name)))
    let beforePay = 0;
    // 套件开始时就已经存在的「自检」完成记录（数据是从生产拷来的，里面本来就有历史遗留）：
    // 收尾只要求「不新增」，不拿 0 当标准。
    let beforeHistory = 0;
    let originalFeature = 'true';
    try {
      // ---------- 0. 「信用卡账单」是个人偏好（**默认开**：用户要求信用卡账单与记事本
      // 都默认开启），先确认开关在偏好设置里，再关掉/打开验证隐藏与恢复 ----------
      const featureMeta = async () => ((await api(page, '/api/configs/user/meta')).body?.data || [])
        .find((c) => c.key === 'credit_card_enabled') || null;
      const meta0 = await featureMeta();
      originalFeature = meta0?.value ?? 'true';
      check('信用卡栏目是**个人偏好**且默认开启',
        meta0?.scope === 'user' && meta0?.default === 'true',
        `scope=${meta0?.scope} default=${meta0?.default}`);
      if (originalFeature !== 'true') {
        await api(page, '/api/configs', 'PUT', { key: 'credit_card_enabled', value: 'true' });
        await sleep(2600); // 后端按用户缓存 2 秒
      }
      check('打开后本人的开关读回来是开的', (await featureMeta())?.value === 'true');

      await page.goto(ROOT + '/admin/settings', { waitUntil: 'domcontentloaded' });
      const inPrefs = await waitSel(page, '[data-config-key="credit_card_enabled"]', 20000);
      const prefGroup = await page.evaluate(() => {
        const row = document.querySelector('[data-config-key="credit_card_enabled"]');
        const panel = row?.closest('.surface');
        return panel?.querySelector('h2')?.innerText.trim() || '';
      });
      check('偏好设置里有这个开关', inPrefs, String(inPrefs));
      check('开关归在「功能开关」分组下', prefGroup === '功能开关', prefGroup);
      await page.goto(ROOT + '/admin/configs', { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      const inSystem = await page.evaluate(() => !!document.querySelector('[data-config-key="credit_card_enabled"]'));
      check('系统配置里不再有这个开关（它不是系统开关）', inSystem === false, String(inSystem));

      // ---------- 1. 固定栏目：侧栏入口 + 它自己的页面 ----------
      // 实例上可能本来就有卡片（用户自己建的、老数据并进来的），所以断言一律看增量，
      // 不假设「栏目里本来是空的」。
      const beforeCards = (await cardsOf()).length;
      const beforeCardReminders = (await itemsAll()).filter((i) => !!i.card_id).length;
      const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
      const bucket = lists.find((l) => l.template === 'credit_card');
      bucketId = bucket?.id ?? null;
      check('清单里有固定的「信用卡账单」栏目', !!bucketId && bucket.name === '信用卡账单',
        JSON.stringify({ id: bucketId, name: bucket?.name }));

      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
      await waitFor(page, () => !!document.querySelector('button[aria-label="新建清单"]'), { timeout: 20000 });
      await sleep(600);
      const navText = await page.evaluate(() => document.querySelector('[data-nav-cards]')?.innerText.replace(/\s+/g, ' ') || '');
      check('侧栏有「信用卡账单」固定入口', /信用卡账单/.test(navText), navText);

      await page.evaluate(() => document.querySelector('[data-nav-cards]').click());
      await sleep(1500);
      const onCardPage = await page.evaluate((id) => ({
        url: location.pathname,
        urlOk: location.pathname === `/admin/list/${id}`,
        hasPanel: !!document.querySelector('[data-card-panel]'),
        hasQuick: !!document.querySelector('.quick-card'),
        rows: document.querySelectorAll('.reminder-row').length,
        title: document.querySelector('h1')?.innerText.trim() || '',
      }), bucketId);
      check('点进去是信用卡栏目的独立页面', onCardPage.urlOk && onCardPage.hasPanel, JSON.stringify(onCardPage));
      check('页面标题是「信用卡账单」', onCardPage.title === '信用卡账单', onCardPage.title);
      check('这一页没有快速新建框、也没有提醒列表',
        !onCardPage.hasQuick && onCardPage.rows === 0,
        JSON.stringify({ quick: onCardPage.hasQuick, rows: onCardPage.rows }));

      // 日历 / 已完成页的「清单」筛选里必须能选到信用卡账单栏目
      // （卡片提醒也会出现在日历与完成记录里；之前把它整个从筛选里排除了，用户找不到）
      await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await waitSel(page, '.cal-cell', 20000);
      await sleep(1200);
      const calChips = await page.evaluate(() => [...document.querySelectorAll('button.quick-chip')]
        .map((b) => b.textContent.trim()));
      // 0.44.0 起清单芯片后面跟着未完成条数（同一个按钮里两个 span），
      // textContent 会拼成「信用卡账单11」，所以按「包含」判断，别再要求整串相等。
      check('日历的清单筛选里有「信用卡账单」', calChips.some((t) => t.includes('信用卡账单')), JSON.stringify(calChips));
      await page.goto(ROOT + '/admin/completed', { waitUntil: 'domcontentloaded' });
      await sleep(1400);
      const doneChips = await page.evaluate(() => [...document.querySelectorAll('button.quick-chip')]
        .map((b) => b.textContent.trim()));
      check('已完成页的清单筛选里有「信用卡账单」', doneChips.some((t) => t.includes('信用卡账单')), JSON.stringify(doneChips));
      await page.goto(ROOT + `/admin/list/${bucketId}`, { waitUntil: 'domcontentloaded' });
      await waitSel(page, '[data-card-panel]', 20000);
      await sleep(600);

      // ---------- 2. 新建清单里不再有信用卡模板 ----------
      await page.evaluate(() => document.querySelector('button[aria-label="新建清单"]').click());
      await waitSel(page, '[data-list-name]');
      await sleep(400);
      const hasCardTemplate = await page.evaluate(() => !!document.querySelector('[data-template="credit_card"]'));
      check('新建清单弹窗里没有信用卡模板了', hasCardTemplate === false, String(hasCardTemplate));
      await setInput(page, '[data-list-name]', TEMP_LIST);
      await page.evaluate(() => document.querySelector('[data-create-submit]').click());
      await sleep(1500);
      const normalList = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.name === TEMP_LIST);
      check('仍然可以建普通清单（且建出来就是普通清单）',
        !!normalList && normalList.template === 'general', JSON.stringify(normalList?.template));

      // ---------- 3. 新建卡片：一律归到栏目里 ----------
      await page.goto(ROOT + `/admin/list/${bucketId}`, { waitUntil: 'domcontentloaded' });
      await waitSel(page, '[data-card-add]', 20000);
      await sleep(600);
      await page.evaluate(() => document.querySelector('[data-card-add]').click());
      check('打开新建卡片弹窗（银行是预设下拉）', await waitSel(page, '.fixed.inset-0.z-50 [data-card-bank-select]'));
      check('新建卡片里有信用额度一栏', await waitSel(page, '.fixed.inset-0.z-50 [data-card-limit]'));
      const bankOptions = await page.evaluate(() => document.querySelectorAll('[data-card-bank-select] option').length);
      check('银行下拉是预存好的国内银行（含「其它银行」）', bankOptions >= 20, String(bankOptions));
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-bank-select]', BANK_CODE);
      await sleep(300);
      const pickerLogo = await page.evaluate(() => document.querySelector('.fixed.inset-0.z-50 [data-card-bank-logo]')?.getAttribute('src') || '');
      check('选银行后立刻显示银行标志', /\.svg(\?|$)/.test(pickerLogo), pickerLogo);
      await setInput(page, '.fixed.inset-0.z-50 [data-card-name]', CARD);
      await setInput(page, '.fixed.inset-0.z-50 [data-card-holder]', '自检持卡人');
      await setInput(page, '.fixed.inset-0.z-50 [data-card-no]', '6225 8800 1234 9876');
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-statement]', 5);
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-due]', 25);
      await setInput(page, '.fixed.inset-0.z-50 [data-card-notes]', '年费刷 6 次免');
      await sleep(300);
      const preview = await page.evaluate(() => document.querySelector('.fixed.inset-0.z-50 [data-card-preview]')?.innerText.replace(/\s+/g, ' ') || '');
      check('新建时实时显示免息期（5 号 → 25 号 = 20 天）', /免息期\s*20\s*天/.test(preview), preview);
      await page.evaluate(() => document.querySelector('.fixed.inset-0.z-50 [data-card-submit]').click());
      await waitSel(page, '[data-card-panel]', 20000);
      await sleep(1500);

      const cards = await cardsOf();
      card1 = cards.find((c) => c.name === CARD) || null;
      if (card1) createdCards.push(card1.id);
      check('卡片创建成功且挂在信用卡栏目下',
        !!card1 && card1.list_id === bucketId && card1.statement_day === 5 && card1.due_day === 25,
        JSON.stringify({ id: card1?.id, list: card1?.list_id, day: card1?.statement_day, due: card1?.due_day }));
      // 用户 2026-10-13：卡片不再单独「提前 N 天提醒」（被「从账单日提醒到还款日」覆盖），
      // 卡片设置里也没有那一项了 —— 这里只确认接口字段还在（老数据不丢）。
      check('卡片设置里不再有「提前提醒」下拉（字段仍在接口里）',
        Number.isFinite(card1?.advance_days), String(card1?.advance_days));
      const advanceSelect = await page.evaluate(() => !!document.querySelector('[data-card-advance]'));
      check('卡片编辑弹窗里没有 data-card-advance 了', advanceSelect === false);
      const listsAfterCard = (await api(page, '/api/reminder/lists')).body?.data || [];
      check('侧栏栏目的角标带上卡片数量（比原来多 1）',
        (listsAfterCard.find((l) => l.id === bucketId)?.card_count || 0) === beforeCards + 1,
        `${beforeCards} → ${listsAfterCard.find((l) => l.id === bucketId)?.card_count}`);

      // ---------- 4. 自动生成的还款提醒（只有一条） ----------
      const plan = (await itemsAll()).filter((i) => i.card_id === card1?.id);
      const byRole = Object.fromEntries(plan.map((i) => [i.card_role, i]));
      check('只生成 1 条提醒（还款日）；账单日/提前提醒都不再生成',
        plan.length === 1 && !!byRole.due && !byRole.statement && !byRole.advance,
        JSON.stringify(plan.map((i) => i.card_role)));
      check('挂在卡片上且按月循环',
        plan.every((i) => i.card_id === card1?.id && i.repeat_rule === 'monthly' && i.all_day === true),
        JSON.stringify(plan.map((i) => `${i.card_role}:${i.card_id}/${i.repeat_rule}`)));
      // 到期时间 = 还款日 23:59（用户 2026-10-13：「信用卡新建时间同新建提醒一致默认 23:59」）
      check('到期时间落在还款日 23:59',
        !!byRole.due && new Date(byRole.due.due_at).getHours() === 23 && new Date(byRole.due.due_at).getMinutes() === 59,
        byRole.due?.due_at);
      check('标题带银行与卡名',
        !!byRole.due && byRole.due.title.includes(BANK) && byRole.due.title.includes(CARD), byRole.due?.title);

      // 信用卡的还款日也要进日历数据（日历里能按信用卡账单筛选）
      const calRange = (await api(page, `/api/reminder/calendar?from=${isoDay(addDays(new Date(), -25))}&to=${isoDay(addDays(new Date(), 44))}`)).body?.data || [];
      const cardDays = calRange.filter((c) => c.card_id === card1.id);
      check('信用卡的日子出现在日历数据里（带 card_role）',
        cardDays.length >= 1 && cardDays.every((c) => !!c.card_role),
        JSON.stringify(cardDays.map((c) => `${c.card_role}@${c.due_date}`)));

      // 日历里这些日子必须用**卡片图标**（不是圆点）
      await page.goto(ROOT + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await waitSel(page, '.cal-task', 20000);
      await sleep(1200);
      // 月历格子每天只铺 3 条，生产上数据多时这条会被挤成「+N」——
      // 所以点开那一天，看右侧详情里的那一行（详情不截断）。
      const dueDay = (await api(page, `/api/reminder/items?view=all&status=all`)).body?.data
        ?.find((i) => i.card_id === card1.id && i.card_role === 'due')?.due_at?.slice(0, 10);
      if (dueDay) {
        await page.evaluate((d) => document.querySelector(`[data-cal-date="${d}"]`)?.click(), dueDay);
        await sleep(900);
      }
      const cardChip = await page.evaluate((needle) => {
        const rows = [...document.querySelectorAll('article')];
        const row = rows.find((r) => (r.textContent || '').includes(needle));
        if (!row) return null;
        return {
          text: (row.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
          hasIcon: !!row.querySelector('svg'),
          hasDot: !!row.querySelector('i.rounded-full'),
        };
      }, `${CARD} 还款日`);
      check('日历里信用卡的日子用卡片图标（不是圆点）',
        cardChip?.hasIcon === true && cardChip?.hasDot === false, JSON.stringify(cardChip));

      // 回卡片页继续后面的断言（上面为了看日历离开过这一页）
      await page.goto(ROOT + `/admin/list/${bucketId}`, { waitUntil: 'domcontentloaded' });
      await waitSel(page, '[data-card-panel]', 20000);
      await sleep(900);

      // ---------- 5. 卡面（银行卡样式） ----------
      const face = await page.evaluate((id) => {
        const el = document.querySelector(`[data-card-item="${id}"] [data-card-face]`);
        return el ? {
          text: el.innerText.replace(/\s+/g, ' '),
          mask: el.querySelector('[data-card-number]')?.textContent.trim() || '',
          bg: getComputedStyle(el).backgroundImage.slice(0, 60),
          logo: el.querySelector('[data-card-face-logo] img')?.getAttribute('src') || '',
          urgency: el.getAttribute('data-card-urgency') || '',
          // 原来那个黄色仿芯片是一个 bg-gradient-to-br 的 span，去掉后卡面里不该再有
          hasChip: !!el.querySelector('span.bg-gradient-to-br'),
          status: el.querySelector('[data-card-status]')?.innerText.trim() || '',
        } : null;
      }, card1.id);
      check('卡片面板里有卡面', !!face, JSON.stringify(face).slice(0, 80));
      // 卡面文字只留卡名：银行名由**完整银行标志**（图形+文字）表达，不再重复写「XX银行」
      // （用户要求「图标后边不再加 XXX银行字样，完整图标后边直接显示卡名」）。
      check('卡面显示卡名与掩码卡号（银行名由标志表达，不再重复文字）',
        (face?.text || '').includes(CARD) && !(face?.text || '').includes(BANK)
        && /9876/.test(face?.mask || ''),
        JSON.stringify({ text: face?.text?.slice(0, 40), mask: face?.mask }));
      check('卡面用银行标志区分（不是靠颜色）', /\.svg(\?|$)/.test(face?.logo || ''), face?.logo);
      check('卡面用了渐变色（不是白底）', /gradient/.test(face?.bg || ''), face?.bg);
      check('卡面去掉了黄色仿芯片图案', face?.hasChip === false, String(face?.hasChip));
      // 排序设定按钮 + 卡面配色说明
      check('新建卡片旁有「排序」按钮', await waitSel(page, '[data-card-sort]', 5000));
      const legend = await page.evaluate(() => document.querySelector('[data-card-legend]')?.innerText.replace(/\s+/g, ' ') || '');
      check('写清了账单日→还款日的卡面配色规则',
        /账单日/.test(legend) && /黄/.test(legend) && /橘/.test(legend) && /3 天/.test(legend) && /红/.test(legend), legend);
      check('卡片默认不是「每张一个颜色」：默认档是同一套配色',
        ['normal', 'soon', 'urgent', 'overdue', 'paid'].includes(face?.urgency || ''), String(face?.urgency));
      await page.screenshot({ path: path.join(SHOTS, 'credit-card-face.png') });

      // ---------- 5b. 卡片列数与真卡比例 ----------
      // 2026-10-10 用户确认：**一行三张最合适、效果最好**（0.18.1 曾上到超大屏 4 列，
      // 这版去掉），中屏 2 列、窄屏 1 列；卡面始终保持 1.586:1（85.6×54mm）。
      const gridInfo = await page.evaluate(() => {
        const grid = document.querySelector('[data-card-panel] .grid');
        const face = document.querySelector('[data-card-face]');
        const fr = face?.getBoundingClientRect();
        const meta = face?.querySelector('[data-card-meta]');
        return {
          cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          ratio: fr ? Number((fr.width / fr.height).toFixed(2)) : 0,
          metaWrap: meta ? getComputedStyle(meta).whiteSpace : '',
          metaLines: meta ? new Set([...meta.querySelectorAll('p')].map((p) => Math.round(p.getBoundingClientRect().top))).size : 0,
        };
      });
      check('宽屏（1280）一行三张卡', gridInfo.cols === 3, JSON.stringify(gridInfo));
      check('卡面按真卡比例（约 1.586:1，卡片高度跟宽度走）',
        Math.abs(gridInfo.ratio - 1.59) <= 0.06, JSON.stringify(gridInfo));
      check('账单日/还款日/额度固定不换行（永远 3 行、待在原位）',
        gridInfo.metaWrap === 'nowrap' && gridInfo.metaLines === 3, JSON.stringify(gridInfo));
      // 超大屏（≥1536）**仍然是一行三张**（不再升到四列），卡片按比例放大、不溢出
      await page.setViewport({ width: 1600, height: 1000 });
      await sleep(900);
      const wide = await page.evaluate(() => {
        const grid = document.querySelector('[data-card-panel] .grid');
        const fr = document.querySelector('[data-card-face]')?.getBoundingClientRect();
        return {
          cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          ratio: fr ? Number((fr.width / fr.height).toFixed(2)) : 0,
          width: fr ? Math.round(fr.width) : 0,
          overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
      });
      check('超大屏（1600）仍然一行三张卡（用户要求：三列最合适），比例不变且不溢出',
        wide.cols === 3 && Math.abs(wide.ratio - 1.59) <= 0.06 && wide.overflow === true, JSON.stringify(wide));

      // ---------- 6. 长条卡片：今天 + 本周待还 ----------
      const weekStrip = await page.evaluate(() => {
        const strip = document.querySelector('[data-billing-strip]');
        const firstCard = document.querySelector('[data-card-item]');
        return strip ? {
          today: strip.querySelector('[data-billing-today]')?.innerText.trim() || '',
          weekday: strip.querySelector('[data-billing-weekday]')?.innerText.replace(/\s+/g, ' ') || '',
          cards: strip.querySelectorAll('[data-billing-card]').length,
          // 位置：长条卡片必须在银行卡面**上方**（用户要求：时间卡片放银行卡片最上方）
          aboveCards: !!firstCard && strip.getBoundingClientRect().top < firstCard.getBoundingClientRect().top,
          // 0.18.3 起：时间卡片**单独一行**、放在页面标题下方（用户要求），
          // 并占满整行宽度（不再挤在标题右侧，也不再随窄屏折行）
          rect: strip.getBoundingClientRect().toJSON(),
          titleRect: document.querySelector('h1')?.getBoundingClientRect().toJSON() || null,
          rowRect: document.querySelector('[data-billing-row]')?.getBoundingClientRect().toJSON() || null,
          wraps: getComputedStyle(strip).flexWrap,
        } : null;
      });
      const now = new Date();
      const dayLabel = `${now.getMonth() + 1}月${now.getDate()}日`;
      check('页面有「今天 + 本周待还」长条卡片', !!weekStrip, JSON.stringify(weekStrip));
      check('长条卡片在银行卡面**上方**', !!weekStrip && weekStrip.aboveCards === true,
        JSON.stringify({ above: weekStrip?.aboveCards }));
      const belowTitle = !!weekStrip?.titleRect
        && weekStrip.rect.top >= weekStrip.titleRect.bottom - 1;
      check('时间卡片在页面标题「信用卡账单」**下方单独一行**', belowTitle,
        JSON.stringify({ strip: weekStrip?.rect?.top, titleBottom: weekStrip?.titleRect?.bottom }));
      check('时间卡片占满整行（与它所在的整行左右对齐）',
        !!weekStrip?.rect && !!weekStrip?.rowRect
          && Math.abs(weekStrip.rect.left - weekStrip.rowRect.left) <= 1
          && Math.abs(weekStrip.rect.right - weekStrip.rowRect.right) <= 1
          && (weekStrip?.rect?.width || 0) >= 600,
        JSON.stringify({ strip: weekStrip?.rect, row: weekStrip?.rowRect }));
      check('时间卡片按页面宽度自动换行', weekStrip?.wraps === 'wrap', String(weekStrip?.wraps));
      // 窄一点的窗口：仍然在标题下方、占满整行（同一个 DOM，不靠折行搬位置了）
      await page.setViewport({ width: 860, height: 900 });
      await sleep(600);
      const wrapped = await page.evaluate(() => {
        const strip = document.querySelector('[data-billing-strip]');
        const title = document.querySelector('h1');
        const row = document.querySelector('[data-billing-row]');
        const s = strip?.getBoundingClientRect();
        return strip && title && row ? {
          below: s.top >= title.getBoundingClientRect().bottom - 1,
          fullRow: Math.abs(s.left - row.getBoundingClientRect().left) <= 1
            && Math.abs(s.right - row.getBoundingClientRect().right) <= 1,
        } : null;
      });
      check('窗口变窄后时间卡片仍在标题下方、占满整行',
        wrapped?.below === true && wrapped?.fullRow === true, JSON.stringify(wrapped));
      await page.setViewport({ width: 1440, height: 900 });
      await sleep(500);
      const backRow = await page.evaluate(() => {
        const strip = document.querySelector('[data-billing-strip]');
        const title = document.querySelector('h1');
        const row = document.querySelector('[data-billing-row]');
        const s = strip?.getBoundingClientRect();
        return strip && title && row ? {
          below: s.top >= title.getBoundingClientRect().bottom - 1,
          fullRow: Math.abs(s.left - row.getBoundingClientRect().left) <= 1
            && Math.abs(s.right - row.getBoundingClientRect().right) <= 1,
        } : null;
      });
      check('窗口变宽后时间卡片还是在标题下方单独一行',
        backRow?.below === true && backRow?.fullRow === true, JSON.stringify(backRow));
      const threeLines = await page.evaluate(() => {
        const strip = document.querySelector('[data-billing-strip]');
        const date = strip?.querySelector('[data-billing-today]')?.getBoundingClientRect();
        const weekday = strip?.querySelector('[data-billing-weekday]')?.getBoundingClientRect();
        return date && weekday ? { sameLine: Math.abs(date.top - weekday.top) < 6 } : null;
      });
      check('时间卡片左侧是「今天+日期 / 星期 / 待还」三行', threeLines?.sameLine === false,
        JSON.stringify(threeLines));
      check('长条卡片左侧显示今天日期与星期',
        !!weekStrip && weekStrip.today === dayLabel && /星期/.test(weekStrip.weekday),
        JSON.stringify(weekStrip));

      // ---------- 7. 金额与还款闭环（卡 1） ----------
      await page.evaluate((id) => document.querySelector(`[data-card-set-amount="${id}"]`).click(), card1.id);
      check('打开填金额弹窗', await waitSel(page, '[data-amount-input]'));
      await setInput(page, '[data-amount-input]', '1234.56');
      await setInput(page, '[data-minimum-input]', '123.45');
      await setInput(page, '[data-amount-note]', '本期有分期');
      await page.evaluate(() => document.querySelector('[data-amount-save]').click());
      await sleep(1600);
      const afterAmount = await page.evaluate((id) => ({
        amount: document.querySelector(`[data-card-item="${id}"] [data-card-amount]`)?.innerText.replace(/\s+/g, ' ') || '',
        period: document.querySelector(`[data-card-item="${id}"] [data-card-current="period"]`)?.innerText.replace(/\s+/g, ' ') || '',
      }), card1.id);
      check('面板显示本期应还金额（1,234.56）', /1,234\.56/.test(afterAmount.amount), afterAmount.amount);
      check('面板标出本期账单期', /\d{4}-\d{2}/.test(afterAmount.period), afterAmount.period);

      beforePay = await completedCount();
      beforeHistory = (((await api(page, '/api/reminder/completed?range=all')).body?.data?.items) || [])
        .filter((r) => /自检/.test(String(r.title))).length;
      const dueBeforePay = (await itemsAll()).find((i) => i.card_id === card1.id && i.card_role === 'due');
      const beforePayCard = (await cardsOf()).find((c) => c.id === card1.id);
      const periodBeforePay = beforePayCard?.current?.period || '';
      const dueDateBeforePay = String(beforePayCard?.current?.due_date || '');
      await page.evaluate((id) => document.querySelector(`[data-card-pay="${id}"]`).click(), card1.id);
      await sleep(2200);
      // 还完之后卡片要**跳到下一期**：当前期不再是刚还过的那一期、应还额度清零、
      // 倒计时指向下一期（用户报过「已还款后倒计时没跳到下一周期，导致排序错误」）。
      const cardAfterPay0 = (await cardsOf()).find((c) => c.id === card1.id);
      check('标记已还后当期跳到下一期（倒计时/排序跟着走）',
        !!cardAfterPay0?.current?.period && cardAfterPay0.current.period !== periodBeforePay
        && !cardAfterPay0.current.paid_at && Number(cardAfterPay0.current.amount_cents || 0) === 0
        && String(cardAfterPay0.current.due_date || '') > dueDateBeforePay,
        JSON.stringify({ before: periodBeforePay, after: cardAfterPay0?.current?.period, dueBefore: dueDateBeforePay, due: cardAfterPay0?.current?.due_date, amount: cardAfterPay0?.current?.amount_cents }));
      const afterHistory = await completedCount();
      check('完成记录里多了一笔（还款闭环）', afterHistory === beforePay + 1, `${beforePay} → ${afterHistory}`);
      const cardAfterPay = (await cardsOf()).find((c) => c.id === card1.id);
      check('服务端记下了 paid_at（记在刚还的那一期上）且待还归零',
        !!cardAfterPay?.last_paid?.paid_at && cardAfterPay.unpaid_total_cents === 0,
        JSON.stringify({ paid: !!cardAfterPay?.current?.paid_at, total: cardAfterPay?.unpaid_total_cents }));

      // 撤销已还必须是完整撤回（完成记录 + 滚到下月的提醒都回来）
      await page.evaluate((id) => document.querySelector(`[data-card-unpay="${id}"]`).click(), card1.id);
      await waitFor(page, () => !!document.querySelector(`[data-card-item="${card1.id}"] [data-card-pay]`), { timeout: 15000 });
      await sleep(900);
      const afterUndo = await completedCount();
      check('撤销已还后完成记录里的那一笔被撤回', afterUndo === beforePay,
        `自检记录 ${afterHistory} → ${afterUndo}`);
      const cardAfterUndo = (await cardsOf()).find((c) => c.id === card1.id);
      check('撤销已还后本期回到未还',
        !cardAfterUndo?.current?.paid_at && cardAfterUndo.unpaid_total_cents > 0,
        JSON.stringify({ paid: !!cardAfterUndo?.current?.paid_at, total: cardAfterUndo?.unpaid_total_cents }));
      const dueAfterUndo = (await itemsAll()).find((i) => i.card_id === card1.id && i.card_role === 'due');
      check('撤销已还后还款日提醒滚回本期（不是留到下个月）',
        !!dueAfterUndo && dueAfterUndo.due_at === dueBeforePay?.due_at,
        `${dueBeforePay?.due_at} → ${dueAfterUndo?.due_at}`);
      // 再标一次已还，让后面的还款计划截图是「已还」的样子
      await page.evaluate((id) => document.querySelector(`[data-card-pay="${id}"]`).click(), card1.id);
      await waitFor(page, () => !!document.querySelector(`[data-card-item="${card1.id}"] [data-card-paid]`), { timeout: 15000 });
      await sleep(700);

      // ---------- 8. 还款计划（含导出与打印） ----------
      await openCardDrawer(page, card1.id);
      await page.evaluate((id) => document.querySelector(`[data-card-schedule="${id}"]`).click(), card1.id);
      await waitSel(page, '[data-schedule-table]');
      await sleep(1200);
      const schedule = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-schedule-period]')];
        return {
          count: rows.length,
          hasExport: !!document.querySelector('[data-schedule-export]'),
          hasPrint: !!document.querySelector('[data-schedule-print]'),
        };
      });
      check('还款计划列出多期', schedule.count >= 2, String(schedule.count));
      check('还款计划提供导出与打印', schedule.hasExport && schedule.hasPrint, JSON.stringify(schedule));
      await page.emulateMediaType('print');
      await sleep(400);
      const printRoot = await page.evaluate(() => {
        const root = document.querySelector('#print-root');
        const rows = root ? root.querySelectorAll('tbody tr').length : 0;
        const app = document.querySelector('#app');
        return { rows, appHidden: app ? getComputedStyle(app).display === 'none' : false };
      });
      check('打印区含还款计划表格、打印时应用隐藏', printRoot.rows >= 2 && printRoot.appHidden === true, JSON.stringify(printRoot));
      await page.emulateMediaType(null);
      await sleep(300);
      await page.screenshot({ path: path.join(SHOTS, 'credit-card-schedule.png') });
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭' && b.closest('section'));
        if (btn) btn.click();
      });
      await sleep(700);

      // ---------- 9. 第二张卡：还款日就在今天 → 一定出现在「本周待还」 ----------
      await page.evaluate(() => document.querySelector('[data-card-add]').click());
      await waitSel(page, '.fixed.inset-0.z-50 [data-card-bank-select]');
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-bank-select]', BANK2_CODE);
      await setInput(page, '.fixed.inset-0.z-50 [data-card-name]', CARD2);
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-statement]', 1);
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-due]', TODAY_DAY);
      await page.evaluate(() => document.querySelector('.fixed.inset-0.z-50 [data-card-submit]').click());
      await sleep(2200);
      const twoCards = await cardsOf();
      card2 = twoCards.find((c) => c.name === CARD2) || null;
      if (card2) createdCards.push(card2.id);
      check('同一个栏目里可以放两张卡（比原来多 2）', twoCards.length === beforeCards + 2, String(twoCards.length));
      const faceCount = await page.evaluate(() => document.querySelectorAll('[data-card-face]').length);
      check('面板上的卡面数与卡片数一致', faceCount === twoCards.length, `${faceCount} vs ${twoCards.length}`);
      const plan2 = (await itemsAll()).filter((i) => i.card_id === card1.id || i.card_id === card2?.id);
      check('两张新卡共两条提醒（每卡只有一条还款日提醒）', plan2.length === 2, String(plan2.length));

      // 给卡 2 记本期金额 → 它会作为「本周待还」出现在长条卡片里
      await page.evaluate((id) => document.querySelector(`[data-card-set-amount="${id}"]`).click(), card2.id);
      await waitSel(page, '[data-amount-input]');
      await setInput(page, '[data-amount-input]', '88.88');
      await page.evaluate(() => document.querySelector('[data-amount-save]').click());
      await sleep(1800);
      const weekAfter = await page.evaluate((id) => {
        const strip = document.querySelector('[data-billing-strip]');
        const mini = strip?.querySelector(`[data-billing-card="${id}"]`);
        return {
          count: strip?.querySelectorAll('[data-billing-card]').length || 0,
          text: mini?.innerText.replace(/\s+/g, ' ') || '',
          cardsText: strip?.querySelector('[data-billing-cards]')?.innerText.replace(/\s+/g, ' ') || '',
        };
      }, card2.id);
      check('本周待还里出现今天到期的卡（小卡面）', weekAfter.count >= 1 && /88\.88/.test(weekAfter.text),
        JSON.stringify(weekAfter));
      check('小卡面写明「就是今天」与银行',
        /就是今天/.test(weekAfter.text) && new RegExp(BANK2).test(weekAfter.text), weekAfter.text);
      const urgent2 = await page.evaluate((id) => {
        const el = document.querySelector(`[data-card-item="${id}"] [data-card-face]`);
        return el ? {
          level: el.getAttribute('data-card-urgency'),
          bg: getComputedStyle(el).backgroundImage,
          status: el.querySelector('[data-card-status]')?.innerText.trim() || '',
        } : null;
      }, card2.id);
      check('还款日 ≤3 天的卡显示红色（urgent）',
        urgent2?.level === 'urgent' && /239,\s*68,\s*68|153,\s*27,\s*27/.test(urgent2?.bg || ''),
        JSON.stringify(urgent2));
      check('红色卡上写明到期日与应还金额', /到期/.test(urgent2?.status || '') && /88\.88/.test(urgent2?.status || ''), urgent2?.status);
      // 时间卡片里的缩略小卡面，颜色必须和那张大卡一致
      const miniSync = await page.evaluate((id) => {
        const big = document.querySelector(`[data-card-item="${id}"] [data-card-face]`);
        const mini = document.querySelector(`[data-billing-card="${id}"]`);
        return {
          big: big ? getComputedStyle(big).backgroundImage : '',
          mini: mini ? getComputedStyle(mini).backgroundImage : '',
          bigColor: big ? getComputedStyle(big).color : '',
          miniColor: mini ? getComputedStyle(mini).color : '',
        };
      }, card2.id);
      check('缩略小卡面的配色与大卡一致（含文字色）',
        !!miniSync.big && miniSync.big === miniSync.mini && miniSync.bigColor === miniSync.miniColor,
        JSON.stringify(miniSync));
      await page.screenshot({ path: path.join(SHOTS, 'credit-card-week.png') });

      // ---------- 9b. 卡号与持卡人换位、卡名可换行、次要操作收进抽屉 ----------
      // 前面的拖动用例会把鼠标停在页面上，可能正悬停在卡片上（抽屉已被 hover 打开）。
      // 重新加载一次卡片页，拿到「刚进页面」的干净状态再验「默认收起」。
      await page.mouse.move(4, 4).catch(() => {});
      await page.goto(ROOT + `/admin/list/${bucketId}`, { waitUntil: 'domcontentloaded' });
      await waitSel(page, '[data-card-face]', 20000);
      await sleep(1200);
      const layout = await page.evaluate((id) => {
        const item = document.querySelector(`[data-card-item="${id}"]`);
        const holder = item?.querySelector('[data-card-holder]');
        const title = item?.querySelector('[data-card-title]');
        const number = item?.querySelector('[data-card-number]');
        const faceEl = item?.querySelector('[data-card-face]');
        const drawer = item?.querySelector('[data-card-drawer]');
        if (!item || !title || !number || !faceEl) return null;
        const face = faceEl.getBoundingClientRect();
        const t = title.getBoundingClientRect();
        const h = holder?.getBoundingClientRect();
        const n = number.getBoundingClientRect();
        const ts = getComputedStyle(title);
        const faceInnerRight = face.right - parseFloat(getComputedStyle(faceEl).paddingRight);
        return {
          // 0.18.3 起：持卡人**与卡名同一行**、右对齐到卡面右边缘（用户要求）
          holderSameRowAsTitle: h ? Math.abs(h.top - t.top) < 12 : null,
          holderRightAligned: h ? Math.abs(h.right - faceInnerRight) <= 1 : null,
          // 卡号现在**左对齐**（用户要求），但仍是单独一行、尾号完整
          numberLeftAligned: n.left <= face.left + 24,
          numberFull: /\d{4}\s*$/.test(number.innerText.trim()),
          numberBelowTitle: n.top >= t.bottom - 2,
          numberText: number.innerText.trim(),
          titleWraps: ts.whiteSpace !== 'nowrap' && ts.textOverflow !== 'ellipsis',
          drawerHidden: drawer ? getComputedStyle(drawer).display === 'none' : null,
        };
      }, card1.id);
      check('持卡人与卡名同一行、右对齐到卡面右边缘',
        layout?.holderSameRowAsTitle === true && layout?.holderRightAligned === true, JSON.stringify(layout));
      check('卡号单独一行、左对齐、尾号完整',
        layout?.numberLeftAligned === true && layout?.numberBelowTitle === true && layout?.numberFull === true,
        JSON.stringify(layout));
      check('卡名不再被截断（窄屏自动换行）', layout?.titleWraps === true, JSON.stringify(layout));
      check('还款计划/编辑/删除默认收在「⋯ 更多」抽屉里', layout?.drawerHidden === true, String(layout?.drawerHidden));
      await page.evaluate((id) => document
        .querySelector(`[data-card-more="${id}"]`)?.click(), card1.id);
      await sleep(400);
      const drawerClick = await page.evaluate((id) => {
        const d = document.querySelector(`[data-card-item="${id}"] [data-card-drawer]`);
        return d ? getComputedStyle(d).display !== 'none' : null;
      }, card1.id);
      check('点「⋯ 更多」抽屉展开', drawerClick === true, String(drawerClick));
      await page.mouse.click(4, 4);
      await sleep(400);
      const drawerOutside = await page.evaluate((id) => {
        const d = document.querySelector(`[data-card-item="${id}"] [data-card-drawer]`);
        return d ? getComputedStyle(d).display === 'none' : null;
      }, card1.id);
      check('点页面其他位置抽屉收起', drawerOutside === true, String(drawerOutside));
      await openCardDrawer(page, card1.id);
      await page.evaluate((id) => document
        .querySelector(`[data-card-more="${id}"]`)?.click(), card1.id);
      await sleep(400);
      const drawerToggle = await page.evaluate((id) => {
        const d = document.querySelector(`[data-card-item="${id}"] [data-card-drawer]`);
        return d ? getComputedStyle(d).display === 'none' : null;
      }, card1.id);
      check('再点一次「⋯ 更多」收起抽屉', drawerToggle === true, String(drawerToggle));

      // ---------- 9c. 头部卡片口径：账单已出就进来（不再按「本周」），红色排最前 ----------
      // card1 在「还款闭环」那一段为了截图被重新标记成已还——已还的不该出现在待还里，
      // 所以先撤销，让它作为「账单已出、还款日还远」的样本。
      await api(page, `/api/reminder/cards/${card1.id}/statements/${card1.current.period}/unpay`, 'POST');
      await page.evaluate(() => document.querySelector('[data-card-refresh]')?.click());
      await sleep(1800);
      const stripState = await page.evaluate(() => {
        const strip = document.querySelector('[data-billing-strip]');
        return {
          ids: [...strip.querySelectorAll('[data-billing-card]')].map((el) => Number(el.getAttribute('data-billing-card'))),
          text: strip.innerText.replace(/\s+/g, ' '),
        };
      });
      check('账单已出但还款日还远的卡也在头部卡片里（不再按本周筛）',
        stripState.ids.includes(card1.id), JSON.stringify(stripState.ids));
      check('红色（还款日前 3 天）的卡排在头部卡片最前',
        stripState.ids[0] === card2.id, JSON.stringify(stripState.ids));
      check('头部卡片不再显示「本周 x ~ x」', !/本周/.test(stripState.text), stripState.text);

      // ---------- 9d. 排序设定：默认智能（红色最前），可切成按账单日 ----------
      const orderDefault = await page.evaluate(() => [...document.querySelectorAll('[data-card-item]')]
        .map((el) => Number(el.getAttribute('data-card-item'))));
      check('默认排序把红色卡放在最前', orderDefault[0] === card2.id, JSON.stringify(orderDefault));
      await page.evaluate(() => document.querySelector('[data-card-sort]').click());
      await waitSel(page, '[role="menu"]');
      const sortMenuLabels = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.innerText.trim()));
      check('排序菜单有「智能 / 按账单日 / 按还款日」三项',
        sortMenuLabels.length === 3 && /智能/.test(sortMenuLabels.join('/')) && /账单日/.test(sortMenuLabels.join('/')) && /还款日/.test(sortMenuLabels.join('/')),
        JSON.stringify(sortMenuLabels));
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.includes('按账单日'));
        btn?.click();
      });
      await sleep(600);
      const orderByStatement = await page.evaluate(() => [...document.querySelectorAll('[data-card-item]')]
        .map((el) => Number(el.getAttribute('data-card-item'))));
      const stored = await page.evaluate(() => localStorage.getItem('ui_card_sort'));
      check('切成「按账单日」后顺序按账单日排（并记住选择）',
        stored === 'statement' && orderByStatement.length >= 2
        && orderByStatement[0] !== orderByStatement[1], `存储=${stored} 顺序=${JSON.stringify(orderByStatement)}`);
      // 切回智能，后面的断言沿用默认
      await page.evaluate(() => document.querySelector('[data-card-sort]').click());
      await waitSel(page, '[role="menu"]');
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.includes('智能'));
        btn?.click();
      });
      await sleep(400);

      // ---------- 9e. 头部卡片超出时不显示滚动条、可以按住鼠标拖动 ----------
      const scrollState = await page.evaluate(() => {
        const box = document.querySelector('[data-billing-cards]');
        const style = getComputedStyle(box);
        return { overflowX: style.overflowX, scrollbarWidth: style.scrollbarWidth };
      });
      check('头部卡片区可横向滚动且隐藏滚动条',
        scrollState.overflowX === 'auto' && scrollState.scrollbarWidth === 'none', JSON.stringify(scrollState));
      // 拖动：临时把内容撑宽（只改这次页面里的 DOM，不动数据），再派发真实鼠标事件，
      // 这样不依赖「当天恰好有几张卡超出宽度」——生产上卡片少时会假红过一次。
      const dragResult = await page.evaluate(() => {
        const box = document.querySelector('[data-billing-cards]');
        const sample = box.firstElementChild;
        if (!sample) return { ok: false, reason: '没有卡片可拖' };
        for (let i = 0; i < 4; i += 1) box.appendChild(sample.cloneNode(true));
        box.scrollLeft = 0;
        const rect = box.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const fire = (type, x) => box.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        fire('mousedown', rect.left + rect.width - 20);
        for (let i = 1; i <= 6; i += 1) {
          fire('mousemove', rect.left + rect.width - 20 - i * 20);
        }
        fire('mouseup', rect.left + rect.width - 140);
        const left = box.scrollLeft;
        for (let i = 0; i < 4; i += 1) box.removeChild(box.lastElementChild);
        return { ok: left > 0, left, scrollWidth: box.scrollWidth };
      });
      check('按住鼠标拖动可以左右查看', dragResult.ok === true, JSON.stringify(dragResult));
      await page.setViewport({ width: 1440, height: 900 });
      await sleep(400);

      // ---------- 10. 编辑卡片改账单日 → 提醒跟着变 ----------
      await openCardDrawer(page, card2.id);
      await page.evaluate((id) => document.querySelector(`[data-card-edit="${id}"]`).click(), card2.id);
      await waitSel(page, '.fixed.inset-0.z-50 [data-card-statement]');
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-statement]', 12);
      await page.evaluate(() => document.querySelector('.fixed.inset-0.z-50 [data-card-submit]').click());
      await sleep(2200);
      const secondAfter = (await cardsOf()).find((c) => c.id === card2.id);
      const secondPlan = (await itemsAll()).filter((i) => i.card_id === card2.id);
      const dueReminder = secondPlan.find((i) => i.card_role === 'due');
      check('改账单日后卡片信息更新', secondAfter?.statement_day === 12, String(secondAfter?.statement_day));
      check('不再有账单日提醒（账单日只在卡片页面用）', !secondPlan.some((i) => i.card_role === 'statement'),
        JSON.stringify(secondPlan.map((i) => i.card_role)));
      // 第二张卡的还款日就是「今天」（见第 9 节），改它的账单日不该动还款日提醒
      check('还款日提醒的到期时间不受账单日影响（仍是它自己的还款日）',
        !!dueReminder && new Date(dueReminder.due_at).getDate() === new Date().getDate(),
        dueReminder ? `day=${new Date(dueReminder.due_at).getDate()}` : '没有还款日提醒');
      check('重建后仍是 1 条（不越改越多）', secondPlan.length === 1, String(secondPlan.length));

      // ---------- 11. 删除卡片 → 提醒一并消失 ----------
      await openCardDrawer(page, card2.id);
      await page.evaluate((id) => document.querySelector(`[data-card-delete="${id}"]`).click(), card2.id);
      await waitFor(page, () => document.body.innerText.includes('删除这张卡'), { timeout: 8000 });
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '删除卡片');
        if (btn) btn.click();
      });
      await sleep(2200);
      const afterDelete = await cardsOf();
      const leftovers = (await itemsAll()).filter((i) => i.card_id === card2.id);
      check('删除后卡片列表里剩原来那些 + 1', afterDelete.length === beforeCards + 1, String(afterDelete.length));
      check('被删卡片的提醒也一并消失', leftovers.length === 0, String(leftovers.length));
      createdCards.splice(createdCards.indexOf(card2.id), 1);
      card2 = null;

      // ---------- 12. 后台关掉栏目：隐藏但保留数据 ----------
      await api(page, '/api/configs', 'PUT', { key: 'credit_card_enabled', value: 'false' });
      await sleep(2600); // 后端这个开关有 2 秒进程内缓存
      const itemsHidden = (await itemsAll()).filter((i) => !!i.card_id);
      const calendars = ((await api(page, '/api/reminder/calendar?from=' + isoDay(new Date(Date.now() - 3 * 86400000))
        + '&to=' + isoDay(new Date(Date.now() + 40 * 86400000)))).body?.data) || [];
      const cardsStill = (await api(page, '/api/reminder/cards')).body?.data || [];
      check('关掉后卡片数据仍在（个人开关只管显示，不是接口权限）',
        cardsStill.length === beforeCards + 1, `${cardsStill.length} vs ${beforeCards + 1}`);
      check('关掉后卡片提醒从提醒列表里消失', itemsHidden.length === 0, String(itemsHidden.length));
      check('关掉后日历里没有卡片提醒', calendars.every((c) => !c.card_id), String(calendars.filter((c) => c.card_id).length));

      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
      await waitFor(page, () => !!document.querySelector('button[aria-label="新建清单"]'), { timeout: 20000 });
      await sleep(800);
      const navGone = await page.evaluate(() => !document.querySelector('[data-nav-cards]'));
      check('关掉后侧栏不再有「信用卡账单」入口', navGone);
      const layoutLists = ((await api(page, '/api/reminder/lists')).body?.data || []);
      check('关掉后 lists 不再返回该栏目（重新打开会回来）',
        !layoutLists.some((l) => l.template === 'credit_card'), JSON.stringify(layoutLists.map((l) => l.template)));

      // 注意：这里要恢复成 **true** 而不是 originalFeature —— 用例后面还要用栏目。
      // originalFeature（用户原本的设置）留到最后的清理里还原。
      await api(page, '/api/configs', 'PUT', { key: 'credit_card_enabled', value: 'true' });
      await sleep(2600);
      const itemsBack = (await itemsAll()).filter((i) => !!i.card_id);
      // 此刻还活着的自检卡片只有 card1（第二张在第 11 节删掉了）→ 它那**一条**还款日提醒要回来；
      // 列表里其余的是实例上本来就有的卡片提醒，只断言「不比关之前少」。
      const mineBack = itemsBack.filter((i) => i.card_id === card1.id);
      check('重新打开后卡片提醒回到列表',
        mineBack.length === 1 && itemsBack.length >= beforeCardReminders + 1,
        `本卡 ${mineBack.length} 条 / 列表共 ${itemsBack.length}（关前 ${beforeCardReminders}）`);
      await page.goto(ROOT + `/admin/list/${bucketId}`, { waitUntil: 'domcontentloaded' });
      await waitSel(page, '[data-card-panel]', 20000);
      await sleep(800);
      const backPanel = await page.evaluate(() => document.querySelectorAll('[data-card-face]').length);
      check('重新打开后栏目页照旧显示卡片', backPanel === beforeCards + 1, `${backPanel} vs ${beforeCards + 1}`);
      // ---------- 13. 手机端入口 ----------
      // 2026-10-16 口径变了（用户：「手机页面 中间 信用卡 改成 清单，点击清单弹出 所有清单列表」）：
      // 中间那个标签现在是「清单」，点它弹出全部清单，信用卡账单在那一份列表里 —— 所以下面
      // 走「标签 → 弹层 → 选信用卡账单 → 进卡片页」，断言的落点（进卡片页、不横向溢出）不变。
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const mobileTabs = await page.evaluate(() => [...document.querySelectorAll('.mobile-tab')].map((a) => a.innerText.trim()));
      check('手机底部标签栏有「清单」入口（原来的「信用卡」）',
        mobileTabs.includes('清单') && !mobileTabs.includes('信用卡'), JSON.stringify(mobileTabs));
      await page.evaluate(() => document.querySelector('[data-tab-lists]')?.click());
      await sleep(900);
      const sheetHasCards = await page.evaluate(() => Array.from(document.querySelectorAll('[data-lists-sheet-row]'))
        .some((el) => (el.getAttribute('data-list-name') || '') === '信用卡账单'));
      check('点「清单」弹出的清单列表里有「信用卡账单」', sheetHasCards === true);
      await page.evaluate(() => {
        Array.from(document.querySelectorAll('[data-lists-sheet-row]'))
          .find((el) => (el.getAttribute('data-list-name') || '') === '信用卡账单')?.click();
      });
      await sleep(1800);
      const mobilePage = await page.evaluate(() => ({
        url: location.pathname,
        panel: !!document.querySelector('[data-card-panel]'),
        faces: document.querySelectorAll('[data-card-face]').length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      check('手机从「清单」里选「信用卡账单」能进卡片页且没有横向溢出',
        mobilePage.panel && mobilePage.faces >= 1 && mobilePage.overflow === false,
        JSON.stringify(mobilePage));

      // ---------- 14. 后台关掉栏目后：标签还在（它现在是清单总入口），清单列表里不再有「信用卡账单」 ----------
      await api(page, '/api/configs', 'PUT', { key: 'credit_card_enabled', value: 'false' });
      await sleep(2600);
      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      await page.evaluate(() => document.querySelector('[data-tab-lists]')?.click());
      await sleep(900);
      const tabsAfter = await page.evaluate(() => [...document.querySelectorAll('.mobile-tab')].map((a) => a.innerText.trim()));
      const sheetAfter = await page.evaluate(() => Array.from(document.querySelectorAll('[data-lists-sheet-row]'))
        .map((el) => el.getAttribute('data-list-name')));
      check('关掉栏目后清单列表里不再有「信用卡账单」',
        !sheetAfter.includes('信用卡账单'), JSON.stringify(sheetAfter));
      check('「清单」标签本身还在（它现在是清单总入口，不再跟着信用卡开关）',
        tabsAfter.includes('清单'), JSON.stringify(tabsAfter));
      await api(page, '/api/configs', 'PUT', { key: 'credit_card_enabled', value: 'true' });
      await sleep(2600);
      await page.setViewport({ width: 1440, height: 900 });
      // ---------- 12b. 跨月卡（上月 25 账单日 / 本月 19 还款日）颜色要变 ----------
      // 上一段在手机视口的列表页收尾，这里先回卡片页（桌面视口）
      await page.goto(ROOT + `/admin/list/${bucketId}`, { waitUntil: 'domcontentloaded' });
      await waitSel(page, '[data-card-add]', 20000);
      await sleep(900);
      await page.evaluate(() => document.querySelector('[data-card-add]').click());
      await waitSel(page, '.fixed.inset-0.z-50 [data-card-bank-select]');
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-bank-select]', 'icbc');
      await setInput(page, '.fixed.inset-0.z-50 [data-card-name]', `自检跨月卡${STAMP % 1000}`);
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-statement]', 25);
      await setSelect(page, '.fixed.inset-0.z-50 [data-card-due]', 19);
      await page.evaluate(() => document.querySelector('.fixed.inset-0.z-50 [data-card-submit]').click());
      await sleep(2200);
      const crossCard = (await cardsOf()).find((c) => String(c.name).includes('自检跨月卡'));
      if (crossCard) createdCards.push(crossCard.id);
      // 期望值按后端同一套规则算（currentPeriod：从上一期起找「还款日还没过的最早一期」），
      // 这样月初跑、账单日当天跑、还款日次日跑都不会误报。
      const pad2 = (n) => String(n).padStart(2, '0');
      const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const crossNow = new Date();
      const today0 = dayOnly(crossNow);
      let expStatement = null;
      let expDue = null;
      for (let i = -1; i < 3; i++) {
        const m = new Date(today0.getFullYear(), today0.getMonth() + i, 1);
        const st = new Date(m.getFullYear(), m.getMonth(), 25);
        const du = new Date(m.getFullYear(), m.getMonth() + 1, 19);
        if (dayOnly(du).getTime() >= today0.getTime()) { expStatement = st; expDue = du; break; }
      }
      const expStatementText = `${expStatement.getFullYear()}-${pad2(expStatement.getMonth() + 1)}-25`;
      check('跨月卡（25 账单 / 19 还款）当期算在还款日未过的最早一期',
        !!crossCard && /^\d{4}-\d{2}$/.test(crossCard.current?.period || '')
        && crossCard.current?.period === expStatementText.slice(0, 7)
        && crossCard.current?.statement_date?.slice(0, 10) === expStatementText,
        JSON.stringify({ period: crossCard?.current?.period, statement: crossCard?.current?.statement_date?.slice(0, 10), expected: expStatementText }));
      const daysToDue = Math.round((dayOnly(expDue).getTime() - today0.getTime()) / 86400000);
      const expLevel = daysToDue < 0 ? 'overdue' : daysToDue <= 3 ? 'urgent'
        : today0.getTime() >= dayOnly(expStatement).getTime() ? 'soon' : 'normal';
      const crossFace = await page.evaluate((id) => {
        const el = document.querySelector(`[data-card-item="${id}"] [data-card-face]`);
        return el ? {
          level: el.getAttribute('data-card-urgency'),
          bg: getComputedStyle(el).backgroundImage,
          status: el.querySelector('[data-card-status]')?.innerText.trim() || '',
        } : null;
      }, crossCard?.id);
      check('跨月卡的卡面阶段与账期一致（账单日之后为黄→橘，还款日前 3 天转红）',
        crossFace?.level === expLevel
        && (expLevel !== 'soon' || !crossFace.bg.includes('rgb(100, 116, 139)')),
        JSON.stringify({ ...crossFace, expectedLevel: expLevel, daysToDue }));

    } finally {
      // ---------- 清理 ----------
      // 先撤销已还（撤回完成记录那笔），再删卡；栏目清单本身是系统的固定栏目，留着。
      try {
        for (const id of [...new Set(createdCards)]) {
          const card = (await cardsOf()).find((c) => c.id === id);
          const period = card?.current?.period;
          if (card?.current?.paid_at && period) {
            await api(page, `/api/reminder/cards/${id}/statements/${period}/unpay`, 'POST');
          }
          await api(page, `/api/reminder/cards/${id}`, 'DELETE');
        }
        // 测试建的普通清单也删掉
        const leftLists = (await api(page, '/api/reminder/lists')).body?.data || [];
        const temp = leftLists.find((l) => l.name === TEMP_LIST);
        if (temp) {
          for (const i of (await itemsAll()).filter((x) => x.list_id === temp.id)) {
            await api(page, `/api/reminder/items/${i.id}`, 'DELETE');
          }
          await api(page, `/api/reminder/lists/${temp.id}`, 'DELETE');
        }
        // 后台偏好还原
        await api(page, '/api/configs', 'PUT', { key: 'credit_card_enabled', value: originalFeature });
        // 卡片提醒会生成站内通知（通知没有删除接口，只能标已读）。不标掉的话，
        // 同一次回归里排在后面的 verify-100 弹窗用例会先弹到这条，点「知道了」
        // 点不到自己造的那条 —— 曾因此在沙箱上假红两条。
        const notif = (await api(page, '/api/reminder/notifications?page=1&pageSize=100')).body?.data;
        const notifRows = Array.isArray(notif) ? notif : notif?.items || [];
        for (const n of notifRows.filter((x) => /自检/.test(String(x.title)) && !x.read_at)) {
          await api(page, `/api/reminder/notifications/${n.id}/read`, 'POST');
        }
      } catch { /* 清理失败也要把断言跑完 */ }
      await sleep(900);

      const cardsLeft = ((await cardsOf()) || []).filter((c) => /自检/.test(String(c.name)) && !baseSelfCards.has(String(c.name)));
      const itemsLeft = (await itemsAll()).filter((i) => /自检/.test(String(i.title)) && !baseSelfCheck.has(String(i.title)));
      const listsLeft = ((await api(page, '/api/reminder/lists')).body?.data || []).filter((l) => l.name === TEMP_LIST);
      check('卡片、提醒与测试清单都已清理（只判本次新增）',
        cardsLeft.length === 0 && itemsLeft.length === 0 && listsLeft.length === 0,
        `卡片 ${cardsLeft.length} / 提醒 ${itemsLeft.length} / 清单 ${listsLeft.length}`);
      const historyLeft = (((await api(page, '/api/reminder/completed?range=all')).body?.data?.items) || [])
        .filter((r) => /自检/.test(String(r.title)));
      const afterCleanup = await completedCount();
      // 只要求「这一次没留下新的」：迭代容器/沙箱的数据是从生产拷来的，里面本来就有
      // 历史自检完成记录（早期几轮回归的遗留），拿 0 当标准会把历史数据当成这次的红。
      check('完成记录里没有留下**新的**自检痕迹',
        historyLeft.length === beforeHistory && afterCleanup === beforePay,
        `残留 ${historyLeft.length} 条（开始时 ${beforeHistory}）/ 总数 ${afterCleanup}（本套件开始时 ${beforePay}）`);
      const featureBack = ((await api(page, '/api/configs/user/meta')).body?.data || [])
        .find((c) => c.key === 'credit_card_enabled')?.value;
      check('后台偏好已还原', featureBack === originalFeature, `还原为 ${featureBack}`);
      const notifLeft = (await api(page, '/api/reminder/notifications?page=1&pageSize=100')).body?.data;
      const notifRowsLeft = Array.isArray(notifLeft) ? notifLeft : notifLeft?.items || [];
      const unreadSelf = notifRowsLeft.filter((n) => /自检/.test(String(n.title)) && !n.read_at);
      check('自检通知都已标为已读（不给后面的弹窗用例留干扰）', unreadSelf.length === 0, String(unreadSelf.length));
    }

    console.log(`  截图：${path.join(SHOTS, 'credit-card-face.png')} / credit-card-schedule.png / credit-card-week.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(1);
});

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isoDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
