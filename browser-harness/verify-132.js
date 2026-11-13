/**
 * 小秘名称（用户 2026-10-20 原话：「偏好设置中：AI提示词区域增加ai智能体名称修改功能，
 * 每个人可以定义自己的小秘名称，在对话等体现。」）
 *
 * 钉住：
 *   1) 偏好设置 → AI 提示词里有一块「小秘名称」，默认留空 = 「小秘」；
 *   2) 保存后侧栏入口、面板标题、头像上的字、问候语、输入框提示都跟着换；
 *   3) 「恢复默认」清回「小秘」；
 *   4) 名字是个人级 Internal 配置：系统配置页不出现，别人不受影响（后者在 Go 用例里）。
 *
 * 只动当前用户的名字，收尾还原。
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');

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
}, { base: BASE, p, method, body });

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);
    const original = (await api(page, '/api/assistant/prompts')).body?.data?.assistant_name || '';
    try {
      await api(page, '/api/assistant/prompts', 'PUT', { assistant_name: '' });
      await page.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded' });
      await sleep(1400);
      // 偏好设置 2026-10 起分了标签页，「小秘名称」在「更多」里；不切过去元素是 v-show 隐藏的
      // （以前这里直接 page.click 会报 “Node is either not clickable”）。
      await page.click('[data-settings-tab="more"]');
      await sleep(400);

      const initial = await page.evaluate(() => ({
        block: !!document.querySelector('[data-ai-name-block]'),
        input: !!document.querySelector('[data-ai-name-input]'),
        value: document.querySelector('[data-ai-name-input]')?.value ?? null,
        state: (document.querySelector('[data-ai-name-state]')?.textContent || '').trim(),
      }));
      check('偏好设置 → AI 提示词里有「小秘名称」一块', initial.block && initial.input, JSON.stringify(initial));
      check('没起名时留空并标「默认『小秘』」', initial.value === '' && initial.state.includes('默认'), JSON.stringify(initial));

      await page.evaluate(() => {
        const el = document.querySelector('[data-ai-name-input]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, '阿宝');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(250);
      const dirty = await page.evaluate(() => (document.querySelector('[data-ai-name-state]')?.textContent || '').trim());
      check('改过之后标「未保存」', dirty.includes('未保存'), dirty);

      await page.click('[data-ai-name-save]');
      await sleep(1000);
      const saved = await page.evaluate(() => ({
        state: (document.querySelector('[data-ai-name-state]')?.textContent || '').trim(),
        notice: !!document.querySelector('[data-ai-name-notice]'),
      }));
      const apiName = (await api(page, '/api/assistant/prompts')).body?.data?.assistant_name;
      check('保存后写进自己的配置并提示已保存', saved.state.includes('已保存') && apiName === '阿宝', JSON.stringify({ saved, apiName }));

      // 侧栏入口与对话面板
      await page.goto(`${BASE}/admin/home`, { waitUntil: 'domcontentloaded' });
      await sleep(1400);
      const side = await page.evaluate(() => (document.querySelector('[data-assistant-trigger]')?.innerText || '').trim());
      check('侧栏入口跟着改名（呼叫阿宝）', /呼叫阿宝/.test(side), side);
      await page.click('[data-assistant-trigger]');
      await sleep(900);
      const panel = await page.evaluate(() => ({
        title: (document.querySelector('[data-assistant-title]')?.textContent || '').trim(),
        avatar: (document.querySelector('.assistant-avatar')?.textContent || '').trim(),
        greet: (document.querySelector('[data-assistant-panel]')?.innerText || '').includes('你好，我是阿宝'),
        placeholder: document.querySelector('[data-assistant-panel] textarea')?.getAttribute('placeholder') || '',
      }));
      check('面板标题与头像用新名字', panel.title.includes('阿宝') && panel.avatar === '阿', JSON.stringify(panel));
      check('问候语与输入提示用新名字', panel.greet && panel.placeholder.includes('阿宝'), JSON.stringify(panel));
      await page.screenshot({ path: path.join(SHOTS, 'assistant-name-1440.png') }).catch(() => {});

      // 系统配置里不该出现
      await page.goto(`${BASE}/admin/config`, { waitUntil: 'domcontentloaded' });
      await sleep(1000);
      check('系统配置页不出现「小秘名称」（个人级 Internal）',
        await page.evaluate(() => !document.querySelector('[data-config-key="ai_assistant_name"]')));

      // 恢复正常（同样先切到「更多」标签页）
      await page.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      await page.click('[data-settings-tab="more"]');
      await sleep(400);
      await page.click('[data-ai-name-reset]');
      await sleep(900);
      const reset = await page.evaluate(() => ({
        value: document.querySelector('[data-ai-name-input]')?.value,
        state: (document.querySelector('[data-ai-name-state]')?.textContent || '').trim(),
      }));
      const resetApi = (await api(page, '/api/assistant/prompts')).body?.data?.assistant_name;
      check('「恢复默认」清空名字', reset.value === '' && resetApi === '' && reset.state.includes('默认'), JSON.stringify({ reset, resetApi }));
    } finally {
      await api(page, '/api/assistant/prompts', 'PUT', { assistant_name: original });
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
