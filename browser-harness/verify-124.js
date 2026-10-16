/**
 * 「呼叫小秘」接上模型 + 模型参数在后台填（用户 2026-10-15）：
 *
 *   「继续 ai 接口开发，相关 key、模型什么的做成通用样式，通过后台填写实现。」
 *
 * 这一套钉住四件事：
 *   1) 侧栏「呼叫小秘」能开能关：未接模型时状态行如实说明；点「写这周的周报」这类问法会带上
 *      工作数据，未接模型时给的是按记录整理的**数据草稿**（2026-10-16 起，见 verify-130）；
 *   2) 模型参数（服务商 / 接口地址 / API Key / 模型名 / 提示词 / 超时）都在
 *      「系统配置 → AI 助手」里填，服务商只是**预设**，换厂家不用改代码；
 *   3) API Key 只存服务端：面板不回显明文，通用配置接口（/api/configs/meta）也读不到（ai_* 全是 Internal）；
 *   4) 参数没填全就不许启用（填了模型名、地址拨不通时「测试连接」要说实话）。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-124.js
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

/** 给输入框赋值（v-model 认 input 事件，直接改 value 不算数）。 */
const fill = (page, sel, value) => page.evaluate(({ sel, value }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, { sel, value });

const clickEl = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.click();
  return true;
}, sel);

const textOf = (page, sel) => page.evaluate((sel) => (document.querySelector(sel)?.textContent || '').trim(), sel);

const bubblesOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-assistant-role]')]
  .map((el) => ({ role: el.getAttribute('data-assistant-role'), text: (el.textContent || '').trim() })));

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, BASE);

    // 这一套原来默认「本机还没配过模型」；可一旦这台机器真的接上了模型（用户接了本机 Ollama
    // 就是这样），换一台已接模型的机器再跑就会红一片。所以先问一句真实状态，按状态选断言。
    const pre = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    const preLive = pre.enabled === true;

    // ---------- 1. 前端面板：未接模型时不能装成已接（已接的机器上验相反的那一面）----------
    await gotoRetry(page, BASE + '/');
    await sleep(3000);
    check('侧栏有「呼叫小秘」入口', await page.evaluate(() => !!document.querySelector('[data-assistant-trigger]')));
    await clickEl(page, '[data-assistant-trigger]');
    await sleep(1000);
    check('点入口后对话面板打开', await page.evaluate(() => !!document.querySelector('[data-assistant-panel]')));

    const statusLine = await textOf(page, '[data-assistant-status]');
    if (preLive) {
      check('已接模型时状态行如实说明「模型已接入」并写出服务商/模型', /模型已接入/.test(statusLine) && statusLine.length > 6, statusLine);
    } else {
      check('未接模型时状态行如实说明「模型未接入」', statusLine.includes('模型未接入'), statusLine);
      check('状态行不谎报「模型已接入」', !statusLine.includes('模型已接入'), statusLine);
    }

    const chips = await page.evaluate(() => [...document.querySelectorAll('[data-assistant-chip]')]
      .map((b) => (b.textContent || '').trim()));
    check('空状态给了 5 个快捷问法（周报/月报/年报/没做完/工作清单）',
      chips.length === 5 && chips.some((c) => c.includes('周报')) && chips.some((c) => c.includes('月报'))
        && chips.some((c) => c.includes('年报')) && chips.some((c) => c.includes('没做完')),
      JSON.stringify(chips));

    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('[data-assistant-chip]')].find((b) => (b.textContent || '').includes('周报'));
      if (chip) chip.click();
    });
    await sleep(preLive ? 12000 : 2500);
    const afterChip = await bubblesOf(page);
    check('点快捷问法后一问一答', afterChip.length === 2 && afterChip[0].role === 'user' && afterChip[1].role === 'assistant',
      JSON.stringify(afterChip.map((b) => b.role)));
    if (preLive) {
      check('已接模型时回答来自模型（不是本地占位文案）',
        (afterChip[1]?.text || '').length > 0 && !/占位/.test(afterChip[1]?.text || ''),
        (afterChip[1]?.text || '').slice(0, 30));
    } else {
      // 2026-10-16 起：点「写这周的周报」这类问法会带上工作数据，没接模型时也给**数据草稿**
      // （用户要求「不接模型也要出草稿」），所以这里不再断言本地占位文案。
      check('未接模型时点周报问法给的是按记录整理的草稿（不是一句空话）',
        /工作草稿/.test(afterChip[1]?.text || '') && /合计：完成/.test(afterChip[1]?.text || ''),
        (afterChip[1]?.text || '').slice(0, 60));
      check('草稿里写明了这是草稿、接上模型才润色',
        /没有经过模型润色/.test(afterChip[1]?.text || ''), (afterChip[1]?.text || '').slice(0, 80));
    }

    await fill(page, '[data-assistant-input]', '今天还剩什么没做');
    await sleep(400);
    const sendEnabled = await page.evaluate(() => {
      const btn = document.querySelector('[data-assistant-send]');
      return btn ? !btn.disabled : false;
    });
    check('输入内容后发送按钮可用', sendEnabled);
    await clickEl(page, '[data-assistant-send]');
    await sleep(preLive ? 12000 : 1800);
    const afterSend = await bubblesOf(page);
    check('发送后一共两问两答', afterSend.length === 4 && afterSend.filter((b) => b.role === 'assistant').length === 2,
      JSON.stringify(afterSend.map((b) => b.role)));

    await clickEl(page, '[data-assistant-clear]');
    await sleep(600);
    check('清空按钮清掉全部对话', await page.evaluate(() => document.querySelectorAll('[data-assistant-role]').length === 0));

    await clickEl(page, '[data-assistant-close]');
    await sleep(800);
    check('关闭按钮收起面板', await page.evaluate(() => !document.querySelector('[data-assistant-panel]')));

    // ---------- 2. 接口：状态公开但不含密钥，对话必须登录 ----------
    const status = await api(page, '/api/assistant/status');
    check('状态接口可用', status.status === 200 && status.body?.code === 0, JSON.stringify(status.body));
    check(preLive ? '状态接口：已启用、且不含地址/密钥' : '状态接口：未启用、且不含地址/密钥',
      status.body?.data?.active === preLive && !/sk-|api_key|base_url|\/v1/.test(status.text), status.text.slice(0, 120));

    const anonStatus = await page.evaluate(async (base) => {
      const res = await fetch(base + '/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: '在吗' }] }),
      });
      return res.status;
    }, BASE);
    check('未登录不能调对话接口（401）', anonStatus === 401, String(anonStatus));

    const direct = await api(page, '/api/assistant/chat', 'POST', { messages: [{ role: 'user', content: '在吗' }] });
    if (preLive) {
      check('已配置模型时对话接口能答（这条机器上不验拒绝）',
        direct.status === 200 && direct.body?.code === 0 && String(direct.body?.data?.reply || '').length > 0,
        JSON.stringify(direct.body).slice(0, 160));
    } else {
      check('未配置模型时对话接口直接拒绝并说明原因',
        direct.status === 400 && /未启用|还没有填写/.test(direct.body?.message || ''), JSON.stringify(direct.body));
    }

    const meta = await api(page, '/api/configs/meta');
    const aiKeys = (meta.body?.data || []).map((it) => it.key).filter((k) => /^ai_/.test(k));
    check('系统配置列表里没有 ai_ 键（密钥不走通用配置接口）', aiKeys.length === 0, JSON.stringify(aiKeys));

    // ---------- 3. 后台面板：通用样式、可填可测 ----------
    await gotoRetry(page, BASE + '/admin/configs');
    await sleep(3500);
    const before = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    check('系统配置页出现「AI 助手」面板', await page.evaluate(() => !!document.querySelector('[data-ai-panel]')));
    const stateText = await textOf(page, '[data-ai-state]');
    check(preLive ? '面板徽章显示已启用' : '面板徽章显示未启用',
      preLive ? /已启用|已接入/.test(stateText) : /未启用|未接入/.test(stateText), stateText);

    const providers = await page.evaluate(() => [...document.querySelectorAll('[data-ai-provider] option')].map((o) => o.value));
    check('服务商是下拉预设（含自定义）而不是写死一家',
      providers.includes('deepseek') && providers.includes('custom') && providers.length >= 6, JSON.stringify(providers));

    // ---------- 3b. 本机 Ollama：检测按钮、容器地址提醒、检测这条路能走通 ----------
    await fill(page, '[data-ai-provider]', 'ollama');
    await sleep(600);
    check('选到 Ollama 时出现「检测本机 Ollama」按钮',
      await page.evaluate(() => !!document.querySelector('[data-ai-detect]')));
    await fill(page, '[data-ai-base-url]', 'http://127.0.0.1:11434/v1');
    await sleep(600);
    const ollamaHint = await textOf(page, '[data-ai-base-url-hint]');
    check('地址填 127.0.0.1 时提醒「后端在容器里，127.0.0.1 指的是容器自己」',
      /容器/.test(ollamaHint), ollamaHint.slice(0, 90));
    await clickEl(page, '[data-ai-detect]');
    await sleep(16000);
    const detectText = await textOf(page, '[data-ai-detect-result]');
    // 这台机器上有没有 Ollama 不是断言的一部分：找到、没找到都必须说清楚，并把试过的地址列出来
    check('「检测本机 Ollama」给出结果（找到或没找到都要说明白）',
      /已找到本机 Ollama|没找到本机 Ollama/.test(detectText), detectText.slice(0, 120));
    // 回到默认服务商，后面的密钥相关断言按「要密钥的服务商」来验
    await fill(page, '[data-ai-provider]', 'deepseek');
    await fill(page, '[data-ai-base-url]', '');
    await sleep(600);

    const keyField = await page.evaluate(() => {
      const el = document.querySelector('[data-ai-api-key]');
      return { value: el?.value || '', placeholder: el?.placeholder || '' };
    });
    check('密钥输入框永远不回显明文', keyField.value === '', JSON.stringify(keyField));
    if (pre.api_key_set === true) {
      check('已存过密钥时提示「留空表示不改动」', /留空表示不改动/.test(keyField.placeholder), keyField.placeholder);
    } else {
      check('没保存过密钥时提示「粘贴服务商给的密钥」', /粘贴/.test(keyField.placeholder), keyField.placeholder);
    }

    const models = await page.evaluate(() => [...document.querySelectorAll('datalist option')].map((o) => o.value).filter(Boolean));
    check('模型名有候选、也允许手填', models.length >= 2, JSON.stringify(models.slice(0, 4)));

    await fill(page, '[data-ai-model]', 'deepseek-chat');
    await sleep(500);
    check('改了模型名后提示「有未保存的改动」',
      await page.evaluate(() => document.body.innerText.includes('有未保存的改动')));

    // 测试连接：拨一个必然拨不通的地址，面板必须说实话。
    // 先把「启用」勾掉：这台机器要是本来就配好并启用了模型，带着「启用 + 没填密钥」
    // 会被「填不全不许启用」先拦下，就轮不到测连接了。
    await page.evaluate(() => {
      const box = document.querySelector('[data-ai-enabled]');
      if (box && box.checked) box.click();
    });
    await sleep(300);
    await fill(page, '[data-ai-base-url]', 'http://127.0.0.1:9/v1');
    await sleep(400);
    await clickEl(page, '[data-ai-test]');
    await sleep(5000);
    const testText = await textOf(page, '[data-ai-test-result]');
    check('地址拨不通时「测试连接」报连接失败并给出原因',
      /连接失败/.test(testText) && testText.length > 8, testText.slice(0, 100));

    // 启用但没填模型名 → 保存被拒
    await fill(page, '[data-ai-model]', '');
    await page.evaluate(() => {
      const box = document.querySelector('[data-ai-enabled]');
      if (box && !box.checked) box.click();
    });
    await sleep(400);
    await clickEl(page, '[data-ai-save]');
    await sleep(2500);
    const rejectText = await textOf(page, '[data-ai-error]');
    check('填不全时不许启用（提示缺模型名）', /模型名称/.test(rejectText), rejectText || '(没有报错)');

    // 关掉启用、填回模型名 → 保存成功
    await page.evaluate(() => {
      const box = document.querySelector('[data-ai-enabled]');
      if (box && box.checked) box.click();
    });
    await fill(page, '[data-ai-base-url]', '');
    await fill(page, '[data-ai-model]', 'deepseek-chat');
    await sleep(400);
    await clickEl(page, '[data-ai-save]');
    await sleep(2500);
    const savedText = await textOf(page, '[data-ai-notice]');
    check('参数填齐后保存成功', /已保存/.test(savedText), savedText || '(没有提示)');
    const saved = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    check('保存后服务端读回来的值一致',
      saved.model === 'deepseek-chat' && saved.enabled === false, JSON.stringify({ model: saved.model, enabled: saved.enabled }));

    // ---------- 4. 密钥只存服务端：只回显掩码、留空即不改动、能清除 ----------
    const FAKE_KEY = 'sk-verify124-abcd1234';
    await fill(page, '[data-ai-api-key]', FAKE_KEY);
    await sleep(300);
    await clickEl(page, '[data-ai-save]');
    await sleep(2500);
    const keySavedRes = await api(page, '/api/assistant/admin/settings');
    const keySavedData = keySavedRes.body?.data || {};
    check('保存密钥后接口只给掩码、不给明文',
      keySavedData.api_key_set === true && !String(keySavedRes.text).includes(FAKE_KEY)
      && String(keySavedData.api_key || '').includes('…'),
      JSON.stringify({ set: keySavedData.api_key_set, masked: keySavedData.api_key, leaked: String(keySavedRes.text).includes(FAKE_KEY) }));
    const keyUi = await page.evaluate(() => ({
      value: document.querySelector('[data-ai-api-key]')?.value || '',
      placeholder: document.querySelector('[data-ai-api-key]')?.placeholder || '',
      hint: (document.querySelector('[data-ai-key-hint]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    check('面板不回显明文密钥，提示里只有掩码并说明留空即不改动',
      keyUi.value === '' && !keyUi.hint.includes(FAKE_KEY) && /留空表示不改动/.test(keyUi.placeholder),
      JSON.stringify(keyUi));

    await fill(page, '[data-ai-model]', 'deepseek-chat-verify124');
    await sleep(400);
    await clickEl(page, '[data-ai-save]');
    await sleep(2500);
    const kept = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    check('密钥留空再保存：已存的密钥没有被清掉', kept.api_key_set === true, JSON.stringify({ set: kept.api_key_set }));

    await clickEl(page, '[data-ai-clear-key]');
    await sleep(400);
    await clickEl(page, '[data-ai-save]');
    await sleep(2500);
    const cleared = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    const clearedUi = await page.evaluate(() => ({
      placeholder: document.querySelector('[data-ai-api-key]')?.placeholder || '',
      hint: (document.querySelector('[data-ai-key-hint]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    check('「清除密钥」保存后确实清空了',
      cleared.api_key_set === false && /粘贴/.test(clearedUi.placeholder) && !/已保存/.test(clearedUi.hint),
      JSON.stringify({ set: cleared.api_key_set, ...clearedUi }));

    // ---------- 5. 收尾：恢复原设置（密钥留空表示不动） ----------
    await api(page, '/api/assistant/admin/settings', 'PUT', {
      enabled: before.enabled === true,
      provider: before.provider || 'deepseek',
      base_url: before.base_url || '',
      api_key: '',
      model: before.model || '',
      system_prompt: before.system_prompt || before.default_system_prompt || '',
      timeout_seconds: before.timeout_seconds || 60,
    });
    await sleep(800);
    const after = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    check('收尾已恢复原设置（未启用、模型名回到原值）',
      after.enabled === (before.enabled === true) && after.model === (before.model || ''),
      JSON.stringify({ enabled: after.enabled, model: after.model, before: before.model }));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
