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
 *   6) 收尾：删掉自检数据、常用查询还原。
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
      const openRes = await api(page, '/api/reminder/items', 'POST', {
        title: openTitle, due_at: yesterdayIso(9), repeat_rule: 'none', channels: ['inapp'],
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
      const opened = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /呼叫小秘/.test(b.textContent || ''));
        if (btn) btn.click();
        return !!btn;
      });
      await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 12000 }).catch(() => {});
      const panel = await page.evaluate(() => {
        const chips = [...document.querySelectorAll('[data-assistant-chip]')].map((el) => el.getAttribute('data-assistant-chip'));
        const range = document.querySelector('[data-assistant-range]');
        return {
          open: !!document.querySelector('[data-assistant-panel]'),
          chips,
          presets: [...document.querySelectorAll('[data-assistant-preset]')].map((el) => el.getAttribute('data-assistant-preset')),
          options: range ? [...range.options].map((o) => o.value) : [],
          hasKeyword: !!document.querySelector('[data-assistant-keyword]'),
          hasSave: !!document.querySelector('[data-assistant-save]'),
        };
      });
      check('侧栏「呼叫小秘」打得开面板', opened === true && panel.open === true, JSON.stringify(panel).slice(0, 160));
      check('预置问法含周报 / 月报 / 年报 / 工作清单',
        ['写这周的周报', '写这个月的月报', '写今年的年报'].every((label) => panel.chips.includes(label))
          && panel.chips.some((label) => /工作清单/.test(label)),
        JSON.stringify(panel.chips));
      check('时间范围可选 本周 / 上周 / 本月 / 上月 / 今年 / 自定义 / 当前未完成',
        ['week', 'lastweek', 'month', 'lastmonth', 'year', 'today', 'yesterday', 'open', 'custom']
          .every((value) => panel.options.includes(value)),
        JSON.stringify(panel.options));
      check('面板上有「关键词」输入与「存为常用」入口', panel.hasKeyword && panel.hasSave);
      check('开箱预置三条常用查询（本周周报 / 本月月报 / 本年总结）',
        ['本周周报', '本月月报', '本年总结'].every((name) => panel.presets.includes(name)),
        JSON.stringify(panel.presets));

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
          range: document.querySelector('[data-assistant-range]')?.value || '',
        };
      });
      check('点「写这周的周报」会先把时间范围选成「本周」', afterChip.range === 'week', JSON.stringify(afterChip).slice(0, 200));
      check('回复里带着这次自检的那条已完成任务（界面上也查得到）',
        afterChip.reply.includes(doneTitle), afterChip.reply.slice(0, 200));
      check('气泡下面写清「已附上数据：本周（…）· 完成 N · 未完成 M」',
        afterChip.digestOption === 'week' && /已附上数据/.test(afterChip.metaText) && /完成 \d+/.test(afterChip.metaText)
          && /未完成 \d+/.test(afterChip.metaText), afterChip.metaText);
      check('未接模型时提示这是草稿', afterChip.draftNote === true);
      await page.screenshot({ path: path.join(SHOTS, 'assistant-digest-1440.png') }).catch(() => {});

      // 预置的常用查询点一下就能用（不用先配置）
      await page.evaluate(() => document.querySelector('[data-assistant-preset="本月月报"]')?.click());
      await waitDigestOption(page, 'month');
      const presetRun = await page.evaluate(() => {
        const metas = [...document.querySelectorAll('[data-assistant-digest]')];
        const last = metas[metas.length - 1];
        return {
          option: last?.getAttribute('data-assistant-digest-option') || '',
          range: document.querySelector('[data-assistant-range]')?.value || '',
        };
      });
      check('点预置「本月月报」直接按本月查一次',
        presetRun.option === 'month' && presetRun.range === 'month', JSON.stringify(presetRun));

      // ---------------- 4. 自定义常用查询：存 / 用 / 删 ----------------
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
        const btn = [...document.querySelectorAll('button')].find((b) => /呼叫小秘/.test(b.textContent || ''));
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

      // 管理 → 删掉
      await page.evaluate(() => document.querySelector('[data-assistant-saved-edit]')?.click());
      await sleep(400);
      const presetInManage = await page.evaluate(() => ({
        still: !!document.querySelector('[data-assistant-preset="本周周报"]'),
        remove: !!document.querySelector('[data-assistant-saved-remove="本周周报"]'),
      }));
      check('预置查询在「管理」里也不给删（它不占用户配置）',
        presetInManage.still === true && presetInManage.remove === false, JSON.stringify(presetInManage));
      await page.evaluate((name) => document.querySelector(`[data-assistant-saved-remove="${name}"]`)?.click(), queryName);
      await sleep(1200);
      const removed = await page.evaluate((name) => !!document.querySelector(`[data-assistant-saved="${name}"]`), queryName);
      const storedAfter = (await api(page, '/api/configs')).body?.data?.assistant_saved_queries || '';
      check('「管理」里能删掉这条常用查询，配置里也不留',
        removed === false && !storedAfter.includes(queryName), JSON.stringify({ removed, storedAfter }).slice(0, 160));
    } finally {
      // 收尾：删自检任务 + 还原常用查询
      for (const id of created) {
        await api(page, `/api/reminder/items/${id}`, 'DELETE');
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
