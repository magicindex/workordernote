/**
 * AI 提示词改成「每人一份统一提示词」（用户 2026-11-14）：
 *
 *   「后台设置 取消 各栏目的 AI 提示词，每个用户都可设置自己提示词，每个人都使用
 *     自己设定的统一提示词，设置项从管理员全局改为按用户独立保存，互不覆盖；
 *     旧全局值作为默认继承。」
 *
 * 钉住这几条：
 *   1) 偏好设置里只有「我的统一提示词」一份，不再出现「各栏目的 AI 提示词」；
 *   2) 后台设置接口不再暴露/接受全局 system_prompt，旧值只作为 default_system_prompt 继承；
 *   3) 清单接口不再带 ai_prompt 字段（各栏目提示词已取消）；
 *   4) 保存/清空「我的统一提示词」只改当前用户，接口读回来一致；清空后回到默认继承。
 *
 * 只读 + 临时写自己的提示词（收尾恢复原值），不碰别人的数据。
 * 用法：APP_URL=http://127.0.0.1:8906 node verify-167.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
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
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const original = (await api(page, '/api/assistant/prompts')).body?.data || {};
    const originalPrompt = String(original.system_prompt || '');
    try {
      // 后台设置 / 清单接口的结构
      const admin = (await api(page, '/api/assistant/admin/settings')).body?.data || {};
      check('后台设置不再暴露全局 system_prompt',
        !('system_prompt' in admin) && !('default_system_prompt' in admin), JSON.stringify(Object.keys(admin)));

      const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
      check('清单接口不再带 ai_prompt 字段（各栏目提示词取消）',
        lists.length > 0 && lists.every((row) => !('ai_prompt' in row)),
        JSON.stringify(lists.slice(0, 2).map((row) => Object.keys(row))));

      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      await page.click('[data-settings-tab="more"]');
      await sleep(400);
      const shape = await page.evaluate(() => {
        const box = document.querySelector('[data-ai-pref-prompt]');
        return {
          section: !!document.querySelector('[data-ai-prompt-prefs]'),
          prompt: !!box,
          label: (document.querySelector('[data-ai-pref-prompt-block] .text-xs.font-bold')?.textContent || '').trim(),
          listPrompts: !!document.querySelector('[data-ai-list-prompts]'),
          state: (document.querySelector('[data-ai-pref-prompt-state]')?.textContent || '').trim(),
          value: box ? box.value : '',
        };
      });
      check('偏好设置里有统一提示词输入框', shape.section && shape.prompt, JSON.stringify(shape));
      check('标题写明「统一提示词」', /统一提示词/.test(shape.label), shape.label);
      check('不再出现「各栏目的 AI 提示词」', shape.listPrompts === false, JSON.stringify(shape));

      // 保存一份临时提示词 → 接口读回来一致
      const MARK = `验证统一提示词-${Date.now().toString(36)}`;
      const save = await api(page, '/api/assistant/prompts', 'PUT', { system_prompt: MARK });
      check('保存自己的统一提示词成功', save.status === 200 && save.body?.code === 0, JSON.stringify(save.body).slice(0, 160));
      const afterSave = (await api(page, '/api/assistant/prompts')).body?.data || {};
      check('读回来是本人刚写的那份',
        afterSave.system_prompt === MARK && typeof afterSave.default_system_prompt === 'string',
        JSON.stringify({ mine: afterSave.system_prompt, default: afterSave.default_system_prompt }));

      // 清空 = 回到旧全局默认继承
      await api(page, '/api/assistant/prompts', 'PUT', { system_prompt: '' });
      const afterClear = (await api(page, '/api/assistant/prompts')).body?.data || {};
      check('清空后回到默认继承（不再有个人提示词）',
        afterClear.system_prompt === '' && typeof afterClear.default_system_prompt === 'string',
        JSON.stringify(afterClear).slice(0, 200));
    } finally {
      // 恢复用户原来的提示词（原来是空串就清空）。
      await api(page, '/api/assistant/prompts', 'PUT', { system_prompt: originalPrompt });
    }
  }, { width: 1440, height: 1000 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('出错:', err && err.message ? err.message : err);
  process.exit(1);
});
