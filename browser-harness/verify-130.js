/**
 * 「小秘看得到工作数据」（用户 2026-10-16 原话：「ai对话 写上周工作总结，查不到内容，
 * 检查数据接口是否没有开放，或者预置ai查询模板不对，周报 月报 年报，工作清单，
 * 自定义快速查询项目。」）
 *
 * 这一套钉住「查得到」这件事本身：
 *   1) 预置问法里有周报 / 月报 / 年报 / 工作清单，并且点了会先选好时间范围（不靠模型猜）；
 *   2) 面板上有「时间范围 + 关键词」选择条，还有「存为常用」的自定义查询（存用户配置，
 *      刷新后还在，可删）；
 *   3) 问周报时，回复里出现**这次自检真的建过的那条已完成任务**——也就是数据接口通了；
 *      面板下面还写清「已附上数据：本周（…）· 完成 N · 未完成 M」；
 *   4) 没接模型也能出草稿（`mode=draft` + 那条说明），不用等后台配好 AI；
 *   5) 时间段：本周 / 上周 / 本月 / 今年 / 自定义 / 当前未完成 / 关键词，服务端都认；
 *      话里带「上周」这种时间词时，不选范围也认得出来；
 *      自定义缺日期会明确报错，不会静默按空区间算；
 *   6) 「@清单名」：话里点名某一栏（打 @ 弹出的选择器只是把名字补进输入框），
 *      服务端就只看那一栏的数据；不存在的清单名不报错、退回全部清单；
 *   7) 收尾：删掉自检数据、常用查询还原。
 *
 * 只造两条自检任务（一条今天完成、一条逾期未完成），收尾删干净。
 *
 * 用法：APP_URL=http://127.0.0.1:8922 node verify-130.js
 */
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = 'AIDG' + Date.now().toString().slice(-6);

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function setManage(page, on) {
  const inManage = await page.evaluate(() => !!document.querySelector('[data-assistant-scope]')).catch(() => false);
  if (inManage !== on) {
    await page.evaluate(() => document.querySelector('[data-assistant-manage]')?.click());
    await sleep(450);
  }
}

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
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

/** 直接问小秘（API 口径，绕开界面）：digest 为 null 表示不指定口径，让服务端认时间词。 */
const askAssistant = (page, content, digest = undefined) => api(page, '/api/assistant/chat', 'POST',
  digest === undefined ? { messages: [{ role: 'user', content }] } : { messages: [{ role: 'user', content }], digest });

/** 等最后一条数据摘要变成某个口径（例如点上常用查询后应当出现「本月」那行）。 */
async function waitDigestOption(page, option, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate((value) => {
      const metas = [...document.querySelectorAll('[data-assistant-digest]')];
      const last = metas[metas.length - 1];
      return !!last && last.getAttribute('data-assistant-digest-option') === value;
    }, option).catch(() => false);
    if (ok) return true;
    if (Date.now() > deadline) return false;
    await sleep(300);
  }
}

/** 面板上某条常用查询出现没有（Vue 渲染是异步的，轮询一下）。 */
async function waitSavedChip(page, name, timeout = 12000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate((n) => !!document.querySelector(`[data-assistant-saved="${n}"]`), name).catch(() => false);
    if (ok) return true;
    if (Date.now() > deadline) return false;
    await sleep(300);
  }
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);

    // ---------------- 0. 手机端的 AI 入口（用户 2026-10-19：「在手机端 铃铛旁边增加 ai 图标」） ----------------
    // 先切到手机宽，验「铃铛旁边、点开就是小秘面板」，再把视口还原，后面的桌面流程照常。
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await gotoRetry(page, BASE + '/admin');
    await sleep(900);
    const mobileEntry = await page.evaluate(() => {
      const btn = document.querySelector('[data-assistant-mobile]');
      const bell = document.querySelector('header a[href="/admin/notifications"]');
      if (!btn || !bell) return { ok: false };
      const b = btn.getBoundingClientRect();
      const n = bell.getBoundingClientRect();
      return { ok: true, visible: b.width > 0 && b.height > 0, gap: Math.round(b.left - n.right) };
    });
    check('手机端铃铛旁边有 AI 图标', mobileEntry.ok && mobileEntry.visible && mobileEntry.gap >= -2 && mobileEntry.gap <= 16, JSON.stringify(mobileEntry));
    await page.click('[data-assistant-mobile]');
    await page.waitForSelector('[data-assistant-panel]', { timeout: 5000 }).catch(() => {});
    await sleep(400);
    const mobilePanel = await page.evaluate(() => !!document.querySelector('[data-assistant-panel]'));
    check('点手机端 AI 图标能打开小秘面板', mobilePanel, JSON.stringify({ mobilePanel }));
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await gotoRetry(page, BASE + '/admin');
    await sleep(800);

    // 前置：这一套是「没接模型」的口径（`mode=draft`、回复里原样出现条目标题）。
    // 实例若已经接上模型，回复会被模型改写，下面的断言必然不匹配——直接说清原因，
    // 免得后来的人把这堆红看成产品坏了。
    const liveStatus = (await api(page, '/api/assistant/status')).body?.data || {};
    if (liveStatus.active) {
      console.log(`  ✗ 前置：本套件要求测试实例「未接模型」，当前这台已接入 ${liveStatus.provider}/${liveStatus.model}`);
      console.log('    先在「后台 → AI 助手」关掉（或换一台没配过的实例）再跑；已接入模型时的通路由 verify-124-model.js 负责。');
      process.exitCode = 1;
      return;
    }

    const created = [];
    const createdLists = [];

    // 先把未读提醒清掉：「到点/逾期提醒」的未读会在屏幕正中弹一个全屏弹窗，
    // 那是正常产品行为，但会挡住面板上的鼠标点击（用户自己也有逾期任务，弹窗照弹）。
    await api(page, '/api/reminder/notifications/read-all', 'POST', {});
    const originalSaved = (await api(page, '/api/configs')).body?.data?.assistant_saved_queries ?? '';

    try {
      // ---------------- 1. 造数据：今天完成一条、逾期未完成一条 ----------------
      const todayIso = (hour, minute = 0) => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0).toISOString();
      };
      const yesterdayIso = (hour) => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, hour, 0, 0, 0).toISOString();
      };
      const doneTitle = `${STAMP}光缆割接已完成`;
      const openTitle = `${STAMP}基站巡检还没做`;

      const doneRes = await api(page, '/api/reminder/items', 'POST', {
        title: doneTitle, due_at: todayIso(10), repeat_rule: 'none', channels: ['inapp'],
      });
      const doneId = doneRes.body?.data?.id ?? null;
      if (doneId) created.push(doneId);
      // 不带站内通道：这条「已逾期未完成」的自检数据只要在库里，跑的过程中就会
      // 弹一次全屏提醒（那是正常产品行为，下面点鼠标时会绕开它）；不带通道是为了
      // 别在「提醒@他」里留下通知垃圾。
      const openRes = await api(page, '/api/reminder/items', 'POST', {
        title: openTitle, due_at: yesterdayIso(9), repeat_rule: 'none', channels: [],
      });
      const openId = openRes.body?.data?.id ?? null;
      if (openId) created.push(openId);
      if (doneId) await api(page, `/api/reminder/items/${doneId}/complete`, 'POST', {});
      check('造出两条自检任务（今天完成的 + 逾期未完成的）', created.length === 2, JSON.stringify(created));

      // ---------------- 2. 服务端：口径认得准、数据真的取到了 ----------------
      const week = await askAssistant(page, '帮我写这周的周报', { option: 'week', keyword: '' });
      const weekData = week.body?.data || {};
      check('问周报：后端按「本周」取到了数据（不再是一句空话）',
        week.status === 200 && weekData.digest?.option === 'week' && weekData.digest?.completed >= 1,
        JSON.stringify(weekData.digest || week.body).slice(0, 220));
      check('回复里出现这次自检建的那条已完成任务（数据接口通了）',
        String(weekData.reply || '').includes(doneTitle), String(weekData.reply || '').slice(0, 200));
      check('没接模型时给的是草稿（mode=draft）并说明原因',
        weekData.mode === 'draft' && !!weekData.reason, JSON.stringify({ mode: weekData.mode, reason: weekData.reason }));

      const openAnswer = await askAssistant(page, '手上还有哪些没做完', { option: 'open', keyword: '' });
      const openData = openAnswer.body?.data || {};
      check('问「当前未完成」：逾期那条被列出来（逾期条数 > 0）',
        openData.digest?.option === 'open' && openData.digest?.open >= 1
          && String(openData.reply || '').includes(openTitle),
        JSON.stringify(openData.digest || {}).slice(0, 200));

      const keywordAnswer = await askAssistant(page, '帮我查一下这几条', { option: '', keyword: STAMP });
      const keywordData = keywordAnswer.body?.data || {};
      check('按关键词查：两条自检任务都能查到（时间范围不限）',
        keywordData.digest?.keyword === STAMP
          && String(keywordData.reply || '').includes(doneTitle)
          && String(keywordData.reply || '').includes(openTitle),
        JSON.stringify(keywordData.digest || {}).slice(0, 200));

      const monthAnswer = await askAssistant(page, '写这个月的月报', { option: 'month', keyword: '' });
      check('月报 / 年报这些口径服务端都认',
        monthAnswer.status === 200 && monthAnswer.body?.data?.digest?.option === 'month'
          && monthAnswer.body?.data?.digest?.completed >= 1,
        JSON.stringify(monthAnswer.body?.data?.digest || {}).slice(0, 200));

      const autoWeek = await askAssistant(page, '帮我把上周的工作总结一下');
      check('话里带「上周」时，不选范围也认得出（自动识别）',
        autoWeek.body?.data?.digest?.option === 'lastweek', JSON.stringify(autoWeek.body?.data?.digest || {}).slice(0, 200));

      const plain = await askAssistant(page, '你好');
      check('普通寒暄不硬塞数据：这一轮没有 digest（没接模型时照旧提示去后台配置）',
        !plain.body?.data?.digest
          && (plain.status === 200 || /未启用/.test(plain.body?.message || '')),
        JSON.stringify({ status: plain.status, message: plain.body?.message || '' }).slice(0, 160));

      const today = new Date();
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const customAnswer = await askAssistant(page, '看下这两天的记录', { option: 'custom', from: iso(today), to: iso(today) });
      check('自定义时间段（今天~今天）取得到今天完成的那条',
        customAnswer.status === 200 && customAnswer.body?.data?.digest?.option === 'custom'
          && String(customAnswer.body?.data?.reply || '').includes(doneTitle),
        JSON.stringify(customAnswer.body?.data?.digest || {}).slice(0, 200));

      const badCustom = await askAssistant(page, '看下记录', { option: 'custom', from: '', to: '' });
      check('自定义时间段缺日期时明确报错（不静默按空区间算）',
        badCustom.status === 400 && /自定义/.test(badCustom.body?.message || ''),
        JSON.stringify(badCustom.body || {}).slice(0, 160));

      const badOption = await askAssistant(page, '看下记录', { option: '糊弄一下', keyword: '' });
      check('时间段参数不认识时回 400 并说明',
        badOption.status === 400 && /时间段参数无效/.test(badOption.body?.message || ''),
        JSON.stringify(badOption.body || {}).slice(0, 160));

      // ---------------- 3. 界面：预置问法 + 时间范围 + 常用查询 ----------------
      await gotoRetry(page, BASE + '/admin');
      await sleep(2800);
      // 别写死「呼叫小秘」：AI 助手是个人配置、可以改名（改了名的机器上按文字找不到），
      // 用稳定的 data 钩子。
      const opened = await page.evaluate(() => {
        const btn = document.querySelector('[data-assistant-trigger]')
          || [...document.querySelectorAll('button')].find((b) => /呼叫/.test(b.textContent || ''));
        if (btn) btn.click();
        return !!btn;
      });
      await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 12000 }).catch(() => {});
      const panel = await page.evaluate(() => {
        const chips = [...document.querySelectorAll('[data-assistant-chip]')].map((el) => el.getAttribute('data-assistant-chip'));
        return {
          open: !!document.querySelector('[data-assistant-panel]'),
          chips,
          presets: [...document.querySelectorAll('[data-assistant-preset]')].map((el) => el.getAttribute('data-assistant-preset')),
          // 范围/关键词/存为常用收进「管理」，默认不占输入框上面那一行。
          hasRange: !!document.querySelector('[data-assistant-range]'),
          hasKeyword: !!document.querySelector('[data-assistant-keyword]'),
          hasSave: !!document.querySelector('[data-assistant-save]'),
          hasManage: !!document.querySelector('[data-assistant-manage]'),
        };
      });
      check('侧栏「呼叫小秘」打得开面板', opened === true && panel.open === true, JSON.stringify(panel).slice(0, 160));
      check('预置问法含周报 / 月报 / 年报 / 工作清单',
        ['写这周的周报', '写这个月的月报', '写今年的年报'].every((label) => panel.chips.includes(label))
          && panel.chips.some((label) => /工作清单/.test(label)),
        JSON.stringify(panel.chips));
      check('输入框上面不再单独摆范围 / 关键词 / 存为常用，收进「管理」',
        panel.hasManage === true && !panel.hasRange && !panel.hasKeyword && !panel.hasSave,
        JSON.stringify(panel).slice(0, 200));
      await sleep(500);
      await page.evaluate(() => document.querySelector('[data-assistant-manage]')?.click());
      await sleep(500);
      const managePanel = await page.evaluate(() => {
        const range = document.querySelector('[data-assistant-range]');
        return {
          options: range ? [...range.options].map((o) => o.value) : [],
          hasKeyword: !!document.querySelector('[data-assistant-keyword]'),
          hasSave: !!document.querySelector('[data-assistant-save]'),
          removables: [...document.querySelectorAll('[data-assistant-chip-remove]')].map((el) => el.getAttribute('data-assistant-chip-remove')),
        };
      });
      check('「管理」里能选时间范围（本周 / 上月 / 今年 / 自定义 / 当前未完成）',
        ['week', 'lastweek', 'month', 'lastmonth', 'year', 'today', 'yesterday', 'open', 'custom']
          .every((value) => managePanel.options.includes(value)),
        JSON.stringify(managePanel.options));
      check('「管理」里有「关键词」与「存为常用」入口', managePanel.hasKeyword && managePanel.hasSave);
      check('「管理」里提示词都带删除按钮（含开箱卡片）',
        managePanel.removables.length >= 5, JSON.stringify(managePanel.removables));
      await setManage(page, false);
      // 2026-10-17 起预置三条与「卡片问法」合并成一排，不再在底部单独列一行。
      check('常用问法与卡片合并（底部不再单独列预置）',
        panel.presets.length === 0 && panel.chips.length >= 5,
        JSON.stringify({ presets: panel.presets, chips: panel.chips }));

      // 点预置「写这周的周报」：应当带上数据并把区间写在气泡下面
      await page.evaluate(() => {
        const chip = document.querySelector('[data-assistant-chip="写这周的周报"]');
        if (chip) chip.click();
      });
      await waitFor(page, () => !!document.querySelector('[data-assistant-digest]'), { timeout: 20000 }).catch(() => {});
      const afterChip = await page.evaluate(() => {
        const bubbles = [...document.querySelectorAll('[data-assistant-role="assistant"]')];
        const meta = document.querySelector('[data-assistant-digest]');
        return {
          reply: bubbles.length ? (bubbles[bubbles.length - 1].innerText || '') : '',
          digestOption: meta?.getAttribute('data-assistant-digest-option') || '',
          metaText: (meta?.innerText || '').replace(/\s+/g, ' ').trim(),
          draftNote: !!document.querySelector('[data-assistant-draft-note]'),
        };
      });
      check('点「写这周的周报」会先把时间范围选成「本周」', afterChip.digestOption === 'week', JSON.stringify(afterChip).slice(0, 200));
      check('回复里带着这次自检的那条已完成任务（界面上也查得到）',
        afterChip.reply.includes(doneTitle), afterChip.reply.slice(0, 200));
      check('气泡下面写清「已附上数据：本周（…）· 完成 N · 未完成 M」',
        afterChip.digestOption === 'week' && /已附上数据/.test(afterChip.metaText) && /完成 \d+/.test(afterChip.metaText)
          && /未完成 \d+/.test(afterChip.metaText), afterChip.metaText);
      check('未接模型时提示这是草稿', afterChip.draftNote === true);
      await page.screenshot({ path: path.join(SHOTS, 'assistant-digest-1440.png') }).catch(() => {});

      // 卡片问法点一下就能用（不用先配置）
      await page.evaluate(() => document.querySelector('[data-assistant-chip="写这个月的月报"]')?.click());
      await waitDigestOption(page, 'month');
      const presetRun = await page.evaluate(() => {
        const metas = [...document.querySelectorAll('[data-assistant-digest]')];
        const last = metas[metas.length - 1];
        return {
          option: last?.getAttribute('data-assistant-digest-option') || '',
        };
      });
      check('点卡片「写这个月的月报」直接按本月查一次',
        presetRun.option === 'month', JSON.stringify(presetRun));

      // ---------------- 4. 自定义常用查询：存 / 用 / 删 ----------------
      await setManage(page, true);
      await page.evaluate(() => {
        const setVal = (sel, value, evt) => {
          const el = document.querySelector(sel);
          if (!el) return;
          el.value = value;
          el.dispatchEvent(new Event(evt, { bubbles: true }));
        };
        setVal('[data-assistant-range]', 'month', 'change');
        setVal('[data-assistant-keyword]', 'AIDG', 'input');
      });
      await sleep(300);
      await page.evaluate(() => document.querySelector('[data-assistant-save]')?.click());
      await sleep(400);
      const saveName = await page.evaluate(() => {
        const input = document.querySelector('[data-assistant-save-name]');
        return input ? input.value : null;
      });
      const queryName = `本月${STAMP}`;
      await page.evaluate((name) => {
        const input = document.querySelector('[data-assistant-save-name]');
        if (!input) return;
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, queryName);
      await sleep(200);
      await page.evaluate(() => document.querySelector('[data-assistant-save-confirm]')?.click());
      await sleep(1200);
      // 存完还在管理态，先点「完成」回到普通态再看 chip。
      await setManage(page, false);
      const savedState = await page.evaluate((name) => ({
        chip: !!document.querySelector(`[data-assistant-saved="${name}"]`),
      }), queryName);
      const storedConfig = (await api(page, '/api/configs')).body?.data?.assistant_saved_queries || '';
      check('「存为常用」把这条查询记进了用户配置',
        savedState.chip === true && storedConfig.includes(queryName), JSON.stringify({ chip: savedState.chip, stored: storedConfig }).slice(0, 200));
      check('预置那三条不写进用户配置（只存用户自己存的）',
        !/本周周报|本月月报|本年总结/.test(storedConfig), storedConfig.slice(0, 200));
      check('保存时预填了这条查询的描述（时间范围 + 关键词）',
        !!saveName && /本月/.test(saveName), String(saveName));

      // 重开面板：常用查询还在（落库了，不是内存里）
      await page.evaluate(() => document.querySelector('[data-assistant-close]')?.click());
      await sleep(600);
      await page.evaluate(() => {
        const btn = document.querySelector('[data-assistant-trigger]')
          || [...document.querySelectorAll('button')].find((b) => /呼叫/.test(b.textContent || ''));
        if (btn) btn.click();
      });
      await waitSavedChip(page, queryName);
      const reopened = await page.evaluate((name) => {
        const chip = document.querySelector(`[data-assistant-saved="${name}"]`);
        return { present: !!chip, title: chip?.getAttribute('title') || '' };
      }, queryName);
      check('重开面板后常用查询还在，并写着它查什么',
        reopened.present === true && /本月/.test(reopened.title) && /关键词/.test(reopened.title),
        JSON.stringify(reopened));

      // 点它：直接按这条查询再问一次
      // 注意：上一轮「点预置本月月报」的气泡也是「本月」，只看「最后一条是本月」会抢跑，
      // 所以这里要等**新的一条**摘要出现。
      const digestBefore = await page.evaluate(() => document.querySelectorAll('[data-assistant-digest]').length);
      await page.evaluate((name) => document.querySelector(`[data-assistant-saved="${name}"]`)?.click(), queryName);
      const digestDeadline = Date.now() + 25000;
      while (Date.now() < digestDeadline) {
        const now = await page.evaluate(() => document.querySelectorAll('[data-assistant-digest]').length).catch(() => 0);
        if (now > digestBefore) break;
        await sleep(300);
      }
      await sleep(400);
      const usedQuery = await page.evaluate(() => {
        const metas = [...document.querySelectorAll('[data-assistant-digest]')];
        const last = metas[metas.length - 1];
        const bubbles = [...document.querySelectorAll('[data-assistant-role="assistant"]')];
        return {
          option: last?.getAttribute('data-assistant-digest-option') || '',
          text: (last?.innerText || '').replace(/\s+/g, ' ').trim(),
          reply: bubbles.length ? (bubbles[bubbles.length - 1].innerText || '') : '',
        };
      });
      check('点常用查询能直接按「本月 + 关键词」再问一次',
        usedQuery.option === 'month' && /关键词/.test(usedQuery.text), JSON.stringify(usedQuery).slice(0, 240));

      // 管理 → 删掉自己存的常用查询
      await setManage(page, true);
      await page.evaluate((name) => document.querySelector(`[data-assistant-saved-remove="${name}"]`)?.click(), queryName);
      await sleep(1200);
      const removed = await page.evaluate((name) => !!document.querySelector(`[data-assistant-saved="${name}"]`), queryName);
      const storedAfter = (await api(page, '/api/configs')).body?.data?.assistant_saved_queries || '';
      check('「管理」里能删掉这条常用查询，配置里也不留',
        removed === false && !storedAfter.includes(queryName), JSON.stringify({ removed, storedAfter }).slice(0, 160));

      // 开箱提示词也能删（用户 2026-10-19：「在管理中增加删除常用快速提示词」），删完可恢复
      await setManage(page, true);
      await page.evaluate(() => document.querySelector('[data-assistant-chip-remove="写今年的年报"]')?.click());
      await sleep(800);
      const chipHidden = await page.evaluate(() => ({
        gone: !document.querySelector('[data-assistant-chip-remove="写今年的年报"]'),
        restore: !!document.querySelector('[data-assistant-restore-chips]'),
      }));
      const hiddenConfig = (await api(page, '/api/configs')).body?.data?.assistant_hidden_chips || '';
      check('管理里能删掉开箱提示词，并记进配置',
        chipHidden.gone === true && hiddenConfig.includes('写今年的年报'), JSON.stringify({ chipHidden, hiddenConfig }).slice(0, 160));
      await page.evaluate(() => document.querySelector('[data-assistant-restore-chips]')?.click());
      await sleep(800);
      await setManage(page, false);
      const chipBack = await page.evaluate(() => !!document.querySelector('[data-assistant-chip="写今年的年报"]'));
      const restoredConfig = (await api(page, '/api/configs')).body?.data?.assistant_hidden_chips || '';
      check('删掉的提示词能一键恢复，配置里清空',
        chipBack === true && !restoredConfig.includes('写今年的年报'), JSON.stringify({ chipBack, restoredConfig }).slice(0, 160));
      // ---------------- 4.5 「@清单名」：把数据源收到某一栏 ----------------
      // 用户 2026-10-17：「ai数据来源 增加 @ 功能，使用@清单名称 来指定数据源，
      // 输入@自动显示列表通过选择补充到对话框中」。
      const listName = `${STAMP}专项`;
      const listRes = await api(page, '/api/reminder/lists', 'POST', { name: listName, color: 'emerald', icon: 'list' });
      const listId = listRes.body?.data?.id ?? null;
      if (listId) createdLists.push(listId);
      let inListId = null;
      if (listId) {
        const inListRes = await api(page, '/api/reminder/items', 'POST', {
          title: `${STAMP}专项里的活干完了`, list_id: listId, due_at: todayIso(11), repeat_rule: 'none', channels: ['inapp'],
        });
        inListId = inListRes.body?.data?.id ?? null;
        if (inListId) {
          created.push(inListId);
          await api(page, `/api/reminder/items/${inListId}/complete`, 'POST', {});
        }
      }
      check('造出一个自检清单，并在里面完成一条事项', !!listId && !!inListId, JSON.stringify({ listId, inListId }));

      const askChat = async (text) => {
        const res = await api(page, '/api/assistant/chat', 'POST', { messages: [{ role: 'user', content: text }] });
        return res.body?.data || {};
      };
      const onlyList = await askChat(`@${listName} 这周都干了什么`);
      check('@清单名：这一轮的数据只看点名的清单（回执里写明清单名）',
        onlyList.digest?.list_name === listName && onlyList.digest?.lists === 1,
        JSON.stringify(onlyList.digest || {}).slice(0, 200));
      check('@清单名：只列本栏的记录，别栏那条已完成的自检任务不出现',
        String(onlyList.reply || '').includes('专项里的活干完了') && !String(onlyList.reply || '').includes(doneTitle),
        String(onlyList.reply || '').slice(0, 200));
      const noMention = await askChat('这周都干了什么');
      check('不带 @ 时照旧是全清单口径（两条自检任务都在）',
        !noMention.digest?.list_name && String(noMention.reply || '').includes(doneTitle)
          && String(noMention.reply || '').includes('专项里的活干完了'),
        JSON.stringify(noMention.digest || {}).slice(0, 200));
      const bogus = await askChat('@摸鱼清单 这周都干了什么');
      check('@ 了一个不存在的清单：不报错，退回全部清单',
        !bogus.digest?.list_name && (bogus.digest?.lists || 0) > 1,
        JSON.stringify(bogus.digest || {}).slice(0, 200));

      // 界面：打 @ 弹出清单，选一个补进输入框
      await page.evaluate(() => document.querySelector('[data-assistant-close]')?.click());
      await sleep(500);
      await page.evaluate(() => {
        const btn = document.querySelector('[data-assistant-trigger]')
          || [...document.querySelectorAll('button')].find((b) => /呼叫/.test(b.textContent || ''));
        if (btn) btn.click();
      });
      await sleep(900);
      await page.evaluate(() => {
        const el = document.querySelector('[data-assistant-input]');
        if (el) { el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      await page.type('[data-assistant-input]', '@');
      let picker = await page.evaluate(() => {
        const box = document.querySelector('[data-assistant-mention]');
        const items = [...document.querySelectorAll('[data-assistant-mention-item]')].map((el) => el.getAttribute('data-assistant-mention-item'));
        return { open: !!box, items };
      });
      if (!picker.open) {
        await sleep(900);
        picker = await page.evaluate(() => {
          const box = document.querySelector('[data-assistant-mention]');
          const items = [...document.querySelectorAll('[data-assistant-mention-item]')].map((el) => el.getAttribute('data-assistant-mention-item'));
          return { open: !!box, items };
        });
      }
      check('打一个 @ 就弹出清单选择器，里面列着用户的清单',
        picker.open === true && picker.items.includes(listName), JSON.stringify(picker).slice(0, 240));
      await page.screenshot({ path: path.join(SHOTS, 'assistant-mention-1440.png') });

      // 接着打几个字：只留名字对得上的
      await page.type('[data-assistant-input]', STAMP);
      await sleep(400);
      const filtered = await page.evaluate(() => [...document.querySelectorAll('[data-assistant-mention-item]')].map((el) => el.getAttribute('data-assistant-mention-item')));
      check('继续打字就按名字过滤', filtered.length === 1 && filtered[0] === listName, JSON.stringify(filtered).slice(0, 200));

      // 键盘：↓ 选中 + Enter 补进输入框（不发送）
      await page.keyboard.press('ArrowDown');
      await sleep(150);
      await page.keyboard.press('Enter');
      await sleep(500);
      const completed = await page.evaluate(() => ({
        value: document.querySelector('[data-assistant-input]')?.value || '',
        open: !!document.querySelector('[data-assistant-mention]'),
      }));
      check('回车把「@清单名」补进输入框（没有直接发出去）',
        completed.value.trim() === `@${listName}` && completed.open === false, JSON.stringify(completed).slice(0, 200));

      // 补一句问话再发：回执行要写清「只看清单」
      await page.type('[data-assistant-input]', '这周都干了什么');
      await page.evaluate(() => document.querySelector('[data-assistant-send]')?.click());
      let mentionMeta = '';
      for (let i = 0; i < 40; i += 1) {
        await sleep(300);
        mentionMeta = await page.evaluate(() => {
          const metas = [...document.querySelectorAll('[data-assistant-digest]')];
          return metas.length ? metas[metas.length - 1].textContent.replace(/\s+/g, ' ').trim() : '';
        });
        if (mentionMeta.includes('只看清单')) break;
      }
      check('界面里问「@清单名」：回执行写明「只看清单「X」」',
        mentionMeta.includes(`只看清单「${listName}」`), mentionMeta.slice(0, 200));

      // 鼠标点选也能补进去
      await page.evaluate(() => {
        const el = document.querySelector('[data-assistant-input]');
        if (el) { el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      await page.type('[data-assistant-input]', '@' + STAMP);
      await sleep(600);
      const reachable = await page.evaluate((name) => {
        const item = document.querySelector(`[data-assistant-mention-item="${name}"]`);
        if (!item) return { item: false, alert: false, hit: null };
        const r = item.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          item: true,
          alert: !!document.querySelector('[role="alertdialog"]'),
          hit: top ? (item === top || item.contains(top)) : false,
        };
      }, listName);
      if (reachable.alert) {
        // 页面上有全屏提醒弹窗挡着（那是正常产品行为：用户自己的提醒在响），
        // 这时鼠标点不到面板，改成脚本派发 mousedown —— 断言的东西一样。
        console.log('  （页面上有提醒弹窗挡着，这一项改用脚本派发点击）');
        await page.evaluate((name) => {
          document.querySelector(`[data-assistant-mention-item="${name}"]`)
            ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
        }, listName);
      } else {
        check('选择器浮在输入框上方、鼠标点得到（没被别的层挡住）', reachable.item && reachable.hit === true, JSON.stringify(reachable));
        await page.click(`[data-assistant-mention-item="${listName}"]`).catch(() => {});
      }
      await sleep(500);
      const clicked = await page.evaluate(() => document.querySelector('[data-assistant-input]')?.value || '');
      check('用鼠标点一条清单也能补进输入框', clicked.includes(`@${listName}`), clicked.slice(0, 120));
      await page.evaluate(() => {
        const el = document.querySelector('[data-assistant-input]');
        if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
      });
    } finally {
      // 收尾：删自检任务 + 还原常用查询
      for (const id of created) {
        await api(page, `/api/reminder/items/${id}`, 'DELETE');
      }
      for (const id of createdLists) {
        await api(page, `/api/reminder/lists/${id}`, 'DELETE');
      }
      if (String(originalSaved) !== '') {
        await api(page, '/api/configs', 'PUT', { key: 'assistant_saved_queries', value: String(originalSaved) });
      } else {
        const left = (await api(page, '/api/configs')).body?.data?.assistant_saved_queries || '';
        if (left) await api(page, '/api/configs', 'PUT', { key: 'assistant_saved_queries', value: '' });
      }
    }

    const leftItems = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [];
    const residue = (Array.isArray(leftItems) ? leftItems : []).filter((row) => String(row.title || '').includes(STAMP));
    check('清理干净：自检任务都不在了', residue.length === 0, JSON.stringify(residue.map((r) => r.title)));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
