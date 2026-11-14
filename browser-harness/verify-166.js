/**
 * 聊天消息的 Markdown 渲染（用户 2026-11-14 截图：AI 回复里的 `**项目管理**`
 * 在气泡里显示成了原始星号）。
 *
 * 钉住这几条：
 *   1) 小秘的回答按 Markdown 渲染：**加粗** → <strong>、`1.` → <ol>、`-` → <ul>、
 *      ``` 代码块、表格、[链接] 都变成真正的 DOM；
 *   2) 气泡里不再出现原始 `**`；
 *   3) 模型输出属于外部内容：<script>、<img onerror> 等危险 HTML 必须被清洗掉；
 *   4) 用户自己发的话仍按纯文本显示（不渲染 Markdown，避免把用户输入的星号也吃掉）。
 *
 * 不依赖模型：拦截 `/api/assistant/status` 让它以为模型已接入，拦截
 * `/api/assistant/chat` 返回一段固定的 Markdown 回复，其它请求照常放行。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-166.js
 */
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const REPLY = [
  '**项目管理**：完成电话系统安装，**工作序记**更新到 0.48.0。',
  '',
  '1. **第一项**',
  '2. 第二项',
  '3. 第三项',
  '',
  '- 列表项 **加粗**',
  '- 行内 `code`',
  '',
  '```js',
  'const a = 1 < 2',
  '```',
  '',
  '> 引用一段',
  '',
  '[链接](https://example.com)',
  '',
  '| 列1 | 列2 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '<img src=x onerror=alert(1)>',
  '<script>alert(2)</script>',
].join('\n');

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
    await sleep(1500);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (req.method() === 'GET' && /\/api\/assistant\/status(\?|$)/.test(url)) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, message: 'success', data: {
            active: true, provider: 'test', provider_label: '测试', model: 'markdown-test',
            timeout_seconds: 30, thinking_mode: 'brief', reason: '',
          } }),
        });
        return;
      }
      if (req.method() === 'POST' && /\/api\/assistant\/chat(\?|$)/.test(url)) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, message: 'success', data: {
            reply: REPLY, mode: 'model', model: 'markdown-test', reason: '',
            digest: null, thinking: '', thinking_truncated: false, thinking_mode: 'brief',
          } }),
        });
        return;
      }
      req.continue();
    });

    await page.click('[data-assistant-topbar]');
    await waitFor(page, () => !!document.querySelector('[data-assistant-panel]'), { timeout: 8000 });
    await sleep(700);

    await page.evaluate(() => {
      const el = document.querySelector('[data-assistant-input]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, '按 markdown 回复我 **原文**');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(200);
    await page.click('[data-assistant-send]');
    await waitFor(page, () => document.querySelectorAll('[data-assistant-role="assistant"]').length > 0, { timeout: 8000 });
    await sleep(500);

    const result = await page.evaluate(() => {
      const bot = document.querySelector('[data-assistant-role="assistant"] .assistant-bubble');
      const user = document.querySelector('[data-assistant-role="user"] .assistant-bubble');
      const link = bot?.querySelector('a');
      return {
        text: bot?.textContent || '',
        html: bot?.innerHTML || '',
        strong: bot?.querySelectorAll('strong').length || 0,
        ol: bot?.querySelectorAll('ol > li').length || 0,
        ul: bot?.querySelectorAll('ul > li').length || 0,
        pre: !!bot?.querySelector('pre code'),
        table: !!bot?.querySelector('table'),
        link: link ? { href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel') } : null,
        hasRawStars: (bot?.textContent || '').includes('**'),
        script: !!bot?.querySelector('script'),
        img: !!bot?.querySelector('img'),
        onerror: /onerror/i.test(bot?.innerHTML || ''),
        markdownHook: !!document.querySelector('[data-assistant-markdown]'),
        userHtml: user?.innerHTML || '',
        userHasStrong: !!user?.querySelector('strong'),
        userText: user?.textContent || '',
      };
    });
    console.log('  ' + JSON.stringify({
      strong: result.strong, ol: result.ol, ul: result.ul, pre: result.pre, table: result.table,
      link: result.link, rawStars: result.hasRawStars, script: result.script, img: result.img,
    }));

    check('回答气泡带 Markdown 渲染钩子', result.markdownHook === true);
    check('加粗渲染成 <strong>，不再是原始星号', result.strong >= 2 && /工作序记/.test(result.text) && !result.hasRawStars);
    check('有序列表渲染成 <ol>（3 项）', result.ol === 3);
    check('无序列表渲染成 <ul>（2 项）', result.ul === 2);
    check('代码块渲染成 <pre><code>', result.pre === true);
    check('表格渲染成 <table>', result.table === true);
    check('链接带 target=_blank rel=noopener noreferrer', !!result.link && result.link.target === '_blank' && /noopener/.test(result.link.rel || ''));
    check('危险 HTML 被清洗（无 script / img / onerror）', !result.script && !result.img && !result.onerror);
    check('用户气泡仍是纯文本（不渲染 Markdown）', result.userHasStrong === false && result.userText.includes('**原文**'));
    check('用户气泡里没有注入的 HTML', !/<strong|<em|<script/i.test(result.userHtml));

    await page.screenshot({ path: path.join(SHOTS, 'assistant-markdown.png') }).catch(() => {});
  }, { width: 1440, height: 900 });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('出错:', err && err.message ? err.message : err);
  process.exit(1);
});
