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
      const connOff = await page.evaluate(() => ({
        state: document.querySelector('[data-assistant-conn]')?.getAttribute('data-assistant-conn-state') || '',
        color: getComputedStyle(document.querySelector('[data-assistant-title]')).color,
      }));
      check('未配置模型时「AI 小秘」标题标红',
        connOff.state === 'off' && /rgb\(2[0-9]{2}, \d+, \d+\)/.test(connOff.color), JSON.stringify(connOff));
      check('状态行不谎报「模型已接入」', !statusLine.includes('模型已接入'), statusLine);
    }

    // 顶部醒目横幅（用户 2026-10-17：「如果没有模型被加载给出提示，可以在聊天窗口最上边
    // 用醒目颜色文字说明」）：没接模型时必须在对话区**之前**、用警示色说清楚；已接的不许冒出来。
    const banner = await page.evaluate(() => {
      const box = document.querySelector('[data-assistant-offline]');
      const scroll = document.querySelector('[data-assistant-scroll]');
      const cs = box ? getComputedStyle(box) : null;
      return {
        text: (box?.textContent || '').replace(/\s+/g, ' ').trim(),
        color: cs?.color || '',
        bg: cs?.backgroundColor || '',
        weight: Number(cs?.fontWeight || 0),
        above: !!(box && scroll && (box.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    });
    if (preLive) {
      check('已接模型时顶部不出现「没有可用模型」横幅', !banner.text, banner.text);
    } else {
      check('没接模型时提示挂在对话窗口最上边（对话区之前）', banner.above, JSON.stringify(banner));
      check('提示直说「没有可用模型」并点明后果（本地草稿、不调用模型）',
        banner.text.includes('没有可用模型') && banner.text.includes('不调用任何模型'), banner.text);
      check('提示指出到哪儿接上（设置 → 系统配置 → AI 助手）',
        banner.text.includes('系统配置') && banner.text.includes('AI 助手'), banner.text);
      const rgb = (banner.color.match(/(\d+),\s*(\d+),\s*(\d+)/) || []).slice(1).map(Number);
      const [r, g, b] = rgb.length === 3 ? rgb : [0, 0, 0];
      const warm = r > 180 && r - b > 60;
      const tinted = !/rgba?\(0, 0, 0, 0\)/.test(banner.bg);
      check('提示是警示色（暖色文字 + 有底色）而不是普通灰字', warm && tinted && banner.weight >= 600,
        `${banner.color} / ${banner.bg} / ${banner.weight}`);
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

    // 控件高度一致性（用户 2026-10-17：「AI 助手（呼叫小秘）：统一 控件高度，保持一致性」）：
    // 单行控件（输入框 / 下拉）与下面那排按钮一律 40px、圆角 12px。改之前是 34/39/40 三种高。
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector('[data-ai-panel]');
      const one = (sel) => {
        const el = panel?.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { h: Math.round(r.height), radius: getComputedStyle(el).borderRadius };
      };
      return {
        provider: one('[data-ai-provider]'), model: one('[data-ai-model]'), base: one('[data-ai-base-url]'),
        key: one('[data-ai-api-key]'), thinking: one('[data-ai-thinking-mode]'), timeout: one('[data-ai-timeout]'),
        save: one('[data-ai-save]'), test: one('[data-ai-test]'),
      };
    });
    const singles = ['provider', 'model', 'base', 'key', 'thinking', 'timeout'].map((k) => metrics[k]);
    check('AI 面板的单行控件高度一致（输入框与下拉都是 40px）',
      singles.every((m) => m && m.h === 40), JSON.stringify(metrics));
    check('按钮与输入框同高同圆角（40px / 12px，原来按钮是 16px 圆角）',
      [metrics.save, metrics.test].every((m) => m && m.h === 40 && m.radius === '12px')
      && singles.every((m) => m && m.radius === '12px'),
      JSON.stringify({ save: metrics.save, test: metrics.test, provider: metrics.provider }));

    const providers = await page.evaluate(() => [...document.querySelectorAll('[data-ai-provider] option')].map((o) => o.value));
    check('服务商是下拉预设（含自定义）而不是写死一家',
      providers.includes('deepseek') && providers.includes('custom') && providers.length >= 6, JSON.stringify(providers));

    // 思考过程显示口径：后台偏好可设（用户 2026-10-16：「通过后台偏好可以设定」）
    const thinkingField = await page.evaluate(() => {
      const el = document.querySelector('[data-ai-thinking-mode]');
      return {
        exists: !!el,
        options: el ? Array.from(el.options).map((o) => o.value) : [],
        value: el ? el.value : '',
      };
    });
    check('后台有「对话里显示思考过程」下拉（三档）',
      thinkingField.exists && thinkingField.options.join(',') === 'off,brief,full', JSON.stringify(thinkingField));
    check('默认档位是简洁思考', thinkingField.value === 'brief', JSON.stringify({ value: thinkingField.value }));

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

    // 模型候选从「datalist」改成可点的清单（datalist 在手机上弹不出来，用户报「加了模型选不了」）。
    // 清单默认收起、选完自动隐藏（2026-10-17 要求），读候选前先展开。
    if (await page.$('[data-ai-model-expand]')) {
      await page.click('[data-ai-model-expand]');
      await sleep(300);
    }
    const models = await page.evaluate(() => [...document.querySelectorAll('[data-ai-model-option]')]
      .map((el) => el.getAttribute('data-ai-model-option') || '').filter(Boolean));
    check('模型名有候选清单（可点选）', models.length >= 2, JSON.stringify(models.slice(0, 4)));
    const listTitle = await page.evaluate(() => (document.querySelector('[data-ai-model-list]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
    check('清单标题写明了来源（预设常见名字 / 服务器上可用）',
      /预设常见名字|服务器上可用/.test(listTitle), listTitle);

    if (models.length) {
      await clickEl(page, `[data-ai-model-option="${models[0]}"]`);
      await sleep(400);
      const picked = await page.evaluate(() => document.querySelector('[data-ai-model]')?.value || '');
      check('点清单里的一条会填进模型名输入框', picked === models[0], JSON.stringify({ picked, want: models[0] }));
      const collapsed = await page.evaluate(() => ({
        list: !!document.querySelector('[data-ai-model-list]'),
        expand: !!document.querySelector('[data-ai-model-expand]'),
      }));
      check('选完自动收起清单，只留输入框里的当前模型',
        collapsed.list === false && collapsed.expand === true, JSON.stringify(collapsed));
    }

    const currentModel = await page.evaluate(() => {
      const box = document.querySelector('[data-ai-current-model]');
      const name = document.querySelector('[data-ai-current-model-name]')?.textContent?.trim() || '';
      return { box: !!box, name, text: (box?.textContent || '').replace(/\s+/g, ' ').trim() };
    });
    check('有专门的「当前模型」块并写出模型名', currentModel.box && currentModel.text.includes('当前模型') && !!currentModel.name,
      JSON.stringify(currentModel));
    // 填一个明显不是当前在用的名字，再确认那句「未保存」提醒会出现
    await fill(page, '[data-ai-model]', 'verify124-pending-model');
    await sleep(400);
    const pending = await page.evaluate(() => ({
      shown: !!document.querySelector('[data-ai-model-pending]'),
      text: (document.querySelector('[data-ai-model-pending]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    check('选的与当前在用的不一样时提示「未保存」', pending.shown && pending.text.includes('verify124-pending-model'),
      JSON.stringify(pending));

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
    // 顺手把档位改成「详细思考过程」再存一次，确认后台偏好真的落库了
    await page.select('[data-ai-thinking-mode]', 'full');
    await sleep(400);
    await clickEl(page, '[data-ai-save]');
    await sleep(2500);
    const modeSaved = (await api(page, '/api/assistant/admin/settings')).body?.data?.thinking_mode || '';
    check('后台偏好「详细思考过程」能保存并读回来', modeSaved === 'full', modeSaved);
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

    // ---------- 5. 保存到记事本：一键存 + 标题标签自动生成（用户 2026-10-17）----------
    //   「ai聊天输出内容增加 保存到记事本功能，自动生成标签。」
    // 没接模型也能存（草稿那条路一样走），所以这一节在两种状态下都执行。
    await page.goto(`${BASE}/admin/home`, { waitUntil: 'networkidle2' });
    await sleep(900);
    await clickEl(page, '[data-assistant-trigger]');
    await sleep(900);
    await clickEl(page, '[data-assistant-chip="写这周的周报"]');
    await sleep(preLive ? 12000 : 2200);

    const saveBtn = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[data-assistant-save-note]'));
      return { count: buttons.length, label: (buttons[buttons.length - 1]?.textContent || '').trim() };
    });
    check('回答下面有「保存到记事本」按钮', saveBtn.count >= 1 && /保存到记事本/.test(saveBtn.label), JSON.stringify(saveBtn));

    await clickEl(page, '[data-assistant-save-note]');
    for (let i = 0; i < 20; i += 1) {
      await sleep(400);
      const done = await page.evaluate(() => !!document.querySelector('[data-assistant-note-saved]'));
      if (done) break;
    }
    const savedUi = await page.evaluate(() => {
      const saved = document.querySelector('[data-assistant-note-saved]');
      const open = document.querySelector('[data-assistant-open-note]');
      const error = document.querySelector('[data-assistant-note-error]');
      return {
        saved: (saved?.textContent || '').trim(),
        open: (open?.textContent || '').trim(),
        error: (error?.textContent || '').trim(),
        saveButtonsLeft: document.querySelectorAll('[data-assistant-save-note]').length,
      };
    });
    check('点一下就存好了（按钮换成「已存进记事本」+「去看」）',
      /已存进记事本/.test(savedUi.saved) && /去看/.test(savedUi.open) && savedUi.saveButtonsLeft === 0,
      JSON.stringify(savedUi));
    check('保存没报错', !savedUi.error, savedUi.error);

    // 存下来的是一条真正的记事：标题前半是自动标签，落在「随手记事本」那一栏。
    const notebookNotes = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      const lists = await (await fetch(base + '/api/reminder/lists', { headers: auth })).json();
      const bucket = (lists?.data || []).find((row) => row.template === 'notebook');
      if (!bucket) return { bucket: null, items: [] };
      const res = await (await fetch(`${base}/api/reminder/items?list_id=${bucket.id}&status=all&view=all`, { headers: auth })).json();
      const rows = Array.isArray(res?.data) ? res.data : (res?.data?.items || []);
      return { bucket, items: rows.map((row) => ({ id: row.id, title: row.title, kind: row.kind, notes: row.notes || '' })) };
    }, BASE);
    const aiNotes = notebookNotes.items.filter((row) => row.title.startsWith('#AI小秘'));
    check('记事本里多了一条自动标签的记事（#AI小秘 开头）', aiNotes.length >= 1,
      JSON.stringify(notebookNotes.items.slice(0, 3)));
    const freshNote = aiNotes[0] || null;
    check('标题里带上了这一轮的主题标签（#周报）', !!freshNote && freshNote.title.includes('#周报'), freshNote?.title || '');
    check('备注里留着回答原文与来源行',
      !!freshNote && /来自 AI 小秘对话/.test(freshNote.notes) && freshNote.notes.length > 60,
      freshNote ? freshNote.notes.slice(0, 80) : '');

    // 「去看」跳到记事本那一栏，刚存的那条就在列表里。
    await clickEl(page, '[data-assistant-open-note]');
    await sleep(1500);
    const looking = await page.evaluate(() => ({
      path: location.pathname,
      titles: Array.from(document.querySelectorAll('[data-reminder-row]')).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()),
      bodyHas: /AI小秘/.test(document.body.innerText),
    }));
    check('「去看」跳到记事本那一栏', /\/admin\/list\/\d+/.test(looking.path), looking.path);
    check('记事本页上看得见刚存的那条', looking.bodyHas, JSON.stringify(looking.titles.slice(0, 3)));

    // 收走这一节造出来的那条记事（别把展示数据搞脏）。
    if (freshNote) {
      const del = await api(page, `/api/reminder/items/${freshNote.id}`, 'DELETE');
      check('收尾把测试记事删掉了', del.status === 200 && del.body?.code === 0, JSON.stringify(del.body));
    }

    // ---------- 5b. 各栏目的 AI 提示词：存在清单上、可引用、清空即生效（用户 2026-10-17）----------
    await page.goto(`${BASE}/admin/configs`, { waitUntil: 'networkidle2' });
    await sleep(900);
    const listRows = (await api(page, '/api/reminder/lists')).body?.data || [];
    check('清单接口带 ai_prompt 字段（默认是空串）',
      listRows.length > 0 && listRows.every((row) => typeof row.ai_prompt === 'string'),
      JSON.stringify(listRows.slice(0, 2).map((row) => ({ name: row.name, ai_prompt: row.ai_prompt }))));

    const generalLists = listRows.filter((row) => !row.template || row.template === 'general');
    const target = generalLists[0] || null;
    const other = generalLists[1] || null;
    check('至少有两条普通清单可用来验「各栏一条 / 互相引用」', !!target && !!other,
      JSON.stringify(generalLists.map((row) => row.name)));

    const sectionShape = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-ai-list-prompt-row]'));
      return {
        hasSection: !!document.querySelector('[data-ai-list-prompts]'),
        names: rows.map((el) => el.getAttribute('data-ai-list-prompt-row')),
        rows: rows.length,
      };
    });
    check('后台有「各栏目的 AI 提示词」一节', sectionShape.hasSection, JSON.stringify(sectionShape));
    check('每个清单一行', sectionShape.rows === listRows.length
      && listRows.every((row) => sectionShape.names.includes(row.name)),
      JSON.stringify({ ui: sectionShape.names, api: listRows.map((row) => row.name) }));

    if (target && other) {
      // 先清到已知状态（展示实例上可能已经写过），再走一遍「填 → 未保存 → 保存 → 已设置」。
      await api(page, `/api/reminder/lists/${target.id}`, 'PATCH', { ai_prompt: '' });
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(900);
      const PROMPT = '按基站/线路分组，多说进度';
      const targetSel = `[data-ai-list-prompt=${JSON.stringify(target.name)}]`;
      await page.click(targetSel);
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.type(PROMPT);
      await sleep(250);
      const dirtyRow = await page.evaluate((name) => (document.querySelector(`[data-ai-list-prompt-row=${JSON.stringify(name)}]`)?.textContent || '').replace(/\s+/g, ' '), target.name);
      check('改过之后那一行标「未保存」', /未保存/.test(dirtyRow), dirtyRow.slice(0, 80));
      await page.click(`[data-ai-list-prompt-save=${JSON.stringify(target.name)}]`);
      await sleep(1000);
      const savedState = await page.evaluate((name) => {
        const row = document.querySelector(`[data-ai-list-prompt-row=${JSON.stringify(name)}]`);
        return {
          text: (row?.textContent || '').replace(/\s+/g, ' '),
          flash: !!document.querySelector('[data-ai-list-prompt-saved]'),
        };
      }, target.name);
      check('点保存后这一行标「已设置」并提示「已保存」', /已设置/.test(savedState.text) && savedState.flash, JSON.stringify(savedState));
      const readBack = (await api(page, '/api/reminder/lists')).body?.data?.find((row) => row.id === target.id);
      check('写进清单的提示词读回来一字不差', readBack?.ai_prompt === PROMPT, JSON.stringify(readBack?.ai_prompt));

      // 引用：从别的栏目复制一段（一次性复制，不是共享引用）。
      await page.select(`[data-ai-list-prompt-ref=${JSON.stringify(other.name)}]`, String(target.id));
      await sleep(300);
      const copied = await page.evaluate((name) => document.querySelector(`[data-ai-list-prompt=${JSON.stringify(name)}]`)?.value || '', other.name);
      check('「引用其他栏目」把那段文字复制过来', copied === PROMPT, copied);

      const tooLong = await api(page, `/api/reminder/lists/${target.id}`, 'PATCH', { ai_prompt: '字'.repeat(601) });
      check('超长提示词被拒绝并说清上限',
        tooLong.status === 400 && /600/.test(tooLong.body?.message || ''), JSON.stringify(tooLong.body).slice(0, 160));
      const cleared = await api(page, `/api/reminder/lists/${target.id}`, 'PATCH', { ai_prompt: '' });
      check('清空提示词接口正常', cleared.body?.code === 0, JSON.stringify(cleared.body).slice(0, 120));
    }

    // ---------- 6. 收尾：恢复原设置（密钥留空表示不动） ----------
    await api(page, '/api/assistant/admin/settings', 'PUT', {
      enabled: before.enabled === true,
      provider: before.provider || 'deepseek',
      base_url: before.base_url || '',
      api_key: '',
      model: before.model || '',
      system_prompt: before.system_prompt || before.default_system_prompt || '',
      timeout_seconds: before.timeout_seconds || 60,
      thinking_mode: before.thinking_mode || 'brief',
    });
    await sleep(800);
    const after = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    check('收尾已恢复原设置（未启用、模型名与思考档位回到原值）',
      after.enabled === (before.enabled === true) && after.model === (before.model || '')
        && after.thinking_mode === (before.thinking_mode || 'brief'),
      JSON.stringify({ enabled: after.enabled, model: after.model, thinking: after.thinking_mode, before: before.model }));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
