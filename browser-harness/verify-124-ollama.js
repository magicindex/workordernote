// 本机 Ollama 按需实测（**不进 run-all.sh**，需要宿主机上真的装着 Ollama，
// 而且容器能拨到它）：用浏览器走一遍用户的真实路径 ——
//   打开地址 → 系统配置 → 选「Ollama（本机）」→ 点「检测本机 Ollama」
//   → 面板自动填好宿主的局域网地址与真实模型 → 勾启用、保存
//   → 回首页点「呼叫小秘」问一句，确认回复真的来自本机 Ollama。
//
// 跑法（一定要用**局域网地址**打开，检测才会把 «你访问本服务的地址»
// 当成候选；用 127.0.0.1 打开时容器里的 127.0.0.1 指的是容器自己，必然找不到）：
//
//   APP_URL=http://192.168.3.201:8920 node verify-124-ollama.js
//
// 本地模型冷启动慢，脚本最多等 6 分钟才判「没回话」。
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const textOf = (page, sel) => page.evaluate((sel) => (document.querySelector(sel)?.textContent || '').trim(), sel);
const fill = (page, sel, value) => page.evaluate(({ sel, value }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, { sel, value });
const clickEl = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; }, sel);

/** 直接在页面里调后台接口（带上登录令牌），用来快照/还原设置。 */
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

(async () => {
  console.log(`目标：${BASE}（用局域网地址打开，才是用户的真实场景）`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    // 先记下进来时的设置，收尾要还原（改过配置的套件都得这样）
    const before = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    console.log(`    进来时：enabled=${before.enabled} provider=${before.provider} model=${before.model || '(空)'}`);

    await fill(page, '[data-ai-provider]', 'ollama');
    await sleep(800);
    check('服务商切到「Ollama（本机）」', (await page.evaluate(() => document.querySelector('[data-ai-provider]')?.value)) === 'ollama');
    await clickEl(page, '[data-ai-detect]');
    await sleep(15000);
    const text = await textOf(page, '[data-ai-detect-result]');
    check('检测到本机 Ollama', /已找到本机 Ollama/.test(text), text.slice(0, 200));
    const filled = await page.evaluate(() => ({
      base: document.querySelector('[data-ai-base-url]')?.value || '',
      model: document.querySelector('[data-ai-model]')?.value || '',
    }));
    check('地址自动填成宿主局域网地址', /11434/.test(filled.base) && !/127\.0\.0\.1/.test(filled.base), JSON.stringify(filled));
    check('模型名自动填了本机真实模型', !!filled.model, JSON.stringify(filled));
    console.log(`    （自动填入：${filled.base} / ${filled.model}）`);

    // 保存启用
    await page.evaluate(() => { const el = document.querySelector('[data-ai-enabled]'); if (el && !el.checked) el.click(); });
    await sleep(500);
    await clickEl(page, '[data-ai-save]');
    await sleep(4000);
    const stateText = await textOf(page, '[data-ai-state]');
    check('保存后徽章显示已接入', /已接入/.test(stateText), stateText);

    // 呼叫小秘真问一句
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3500);
    await clickEl(page, '[data-assistant-trigger]');
    await sleep(1200);
    const statusLine = await textOf(page, '[data-assistant-status]');
    check('小秘面板状态行显示「模型已接入」', /模型已接入/.test(statusLine), statusLine);
    await fill(page, '[data-assistant-input]', '用一句话说明你能帮我做什么');
    await sleep(300);
    await clickEl(page, '[data-assistant-send]');
    // 本地模型冷启动慢：最多等 6 分钟
    let bubbles = [];
    for (let i = 0; i < 72; i += 1) {
      await sleep(5000);
      bubbles = await page.evaluate(() => [...document.querySelectorAll('[data-assistant-role]')]
        .map((el) => ({ role: el.getAttribute('data-assistant-role'), text: (el.textContent || '').trim() })));
      if (bubbles.some((b) => b.role === 'assistant' && b.text)) break;
    }
    const reply = (bubbles.find((b) => b.role === 'assistant') || {}).text || '';
    check('本机 Ollama 真的回了话', !!reply && !/占位|失败|没接上|连接/.test(reply), reply.slice(0, 160));
    console.log(`    回复原文：${reply}`);

    // 收尾：清空面板对话，并把后台设置还原成进来时的样子（回读确认）
    await clickEl(page, '[data-assistant-clear]');
    await sleep(500);
    await api(page, '/api/assistant/admin/settings', 'PUT', {
      enabled: !!before.enabled,
      provider: before.provider || 'deepseek',
      base_url: before.base_url || '',
      model: before.model || '',
      system_prompt: before.system_prompt || '',
      timeout_seconds: before.timeout_seconds || 60,
      clear_api_key: !before.api_key_set,
    });
    const after = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
    check('收尾把后台设置还原回去了（未启用、模型名回到原值）',
      after.enabled === !!before.enabled && (after.model || '') === (before.model || ''),
      JSON.stringify({ 进来时: { enabled: before.enabled, model: before.model }, 现在: { enabled: after.enabled, model: after.model } }));
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})();
