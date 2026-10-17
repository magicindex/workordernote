// 模型通路按需实测（**不进 run-all.sh**，需要一个真容器 + 宿主与容器能互通）：
//
//   APP_URL=http://127.0.0.1:8920 node verify-124-model.js
//
// 和 verify-124.js 的分工：verify-124 验「后台能填、存得住、填不全不许启用、密钥不外泄」，
// 全在「没接模型」这条路上；这个脚本自己起一个假的 OpenAI 兼容接口（桩），
// 把后台参数指过去，验**真的接通**那条路：
//   测试连接列出桩的模型 → 启用 → 状态接口说可用 → 对话接口的回复来自桩
//   → 面板状态行显示「模型已接入」且面板里也拿得到桩的回复
// 顺带核对发出去的请求长什么样（模型名、stream:false、服务端自己加的 system 提示词、
// 没填密钥时不带 Authorization）。
//
// 桩要能被**容器里**的后端拨到，所以绑 0.0.0.0 并用宿主的局域网 IP 填进后台
// （默认挑第一个非回环 IPv4，可用 STUB_HOST / STUB_URL 覆盖）。
const http = require('http');
const os = require('os');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const PORT = Number(process.env.STUB_PORT || 18099);
const REPLY = '桩服务收到了：这是模型回复。';
// 思考模型那一段思维链：故意做成「多行 + 超长」，好区分三种显示口径
// （简洁思考要压成一行并截断，详细思考过程要原样给）。
const THINKING = `第一步：先确认链路\n第二步：${'想'.repeat(200)}`;
const THINKING_FLAT = THINKING.replace(/\s+/g, ' ');
const MODELS = ['stub-model-a', 'stub-model-b'];
let passed = 0;
let failed = 0;

function check(name, ok, extra) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failed += 1; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`); }
}

function firstLanIPv4() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach((list) => {
    (list || []).forEach((info) => { if (info.family === 'IPv4' && !info.internal) out.push(info.address); });
  });
  return out[0] || '';
}

// 桩：GET /v1/models 给一份模型表，POST /v1/chat/completions 回一句固定的话；把收到的请求记下来。
function startStub(seen) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
      seen.push({ url: req.url, method: req.method, auth: req.headers.authorization || '', body: parsed });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.includes('/models')) {
        res.end(JSON.stringify({ object: 'list', data: MODELS.map((id) => ({ id })) }));
        return;
      }
      res.end(JSON.stringify({
        id: 'chatcmpl-stub',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: REPLY, reasoning: THINKING }, finish_reason: 'stop' }],
      }));
    });
  });
  return new Promise((resolve) => server.listen(PORT, '0.0.0.0', () => resolve(server)));
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token') || '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, text, body: parsed };
}, { base: BASE, p, method, body });

async function main() {
  const seen = [];
  const stubUrl = process.env.STUB_URL || `http://${process.env.STUB_HOST || firstLanIPv4()}:${PORT}/v1`;
  const server = await startStub(seen);
  console.log(`桩服务：${stubUrl}（填进后台的地址）`);
  try {
    await withTab(async (page) => {
      await login(page, BASE);

      // 1) 后台把参数指到桩上（自定义服务商，不需要密钥）
      const saved = await api(page, '/api/assistant/admin/settings', 'PUT', {
        enabled: false, provider: 'custom', base_url: stubUrl, model: MODELS[0], timeout_seconds: 30,
      });
      check('保存参数成功', saved.body?.code === 0, JSON.stringify(saved.body));

      // 2) 「测试连接」：应该列出桩给的模型，并且走的是模型列表接口
      const test = await api(page, '/api/assistant/admin/test', 'POST', {});
      const tdata = test.body?.data || {};
      check('测试连接成功', tdata.ok === true, JSON.stringify(tdata));
      check('列出了桩的模型', Array.isArray(tdata.models) && MODELS.every((m) => tdata.models.includes(m)), JSON.stringify(tdata.models));
      check('走的是模型列表接口', tdata.via === 'models' && /\/models$/.test(String(tdata.endpoint || '')), JSON.stringify({ via: tdata.via, endpoint: tdata.endpoint }));
      const listReq = seen.find((r) => r.method === 'GET' && r.url.includes('/models'));
      check('没填密钥时上游请求不带 Authorization', !!listReq && !listReq.auth, JSON.stringify(listReq));

      // 3) 启用（面板保存时整体提交表单，这里照做）
      const enable = await api(page, '/api/assistant/admin/settings', 'PUT', {
        enabled: true, provider: 'custom', base_url: stubUrl, model: MODELS[0], timeout_seconds: 30,
      });
      check('启用保存成功', enable.body?.code === 0, JSON.stringify(enable.body));
      const status = await api(page, '/api/assistant/status');
      const sdata = status.body?.data || {};
      check('状态接口说已启用且可用', sdata.enabled === true && sdata.active === true && sdata.ready === true, JSON.stringify(sdata));
      check('状态接口不带地址与密钥', !status.text.includes(String(PORT)) && !/api_key"\s*:\s*"[^"]/.test(status.text), status.text.slice(0, 300));

      // 4) 对话接口：回复来自桩，且发出去的请求符合 OpenAI 兼容约定
      const chat = await api(page, '/api/assistant/chat', 'POST', { messages: [{ role: 'user', content: '你好，帮我看看链路通不通' }] });
      const cdata = chat.body?.data || {};
      check('对话接口返回成功', chat.body?.code === 0, JSON.stringify(chat.body).slice(0, 300));
      check('回复来自桩（模型真的被调用了）', String(cdata.reply || '').includes('桩服务收到了'), JSON.stringify(cdata.reply));
      check('回复里带上了实际模型名', cdata.model === MODELS[0], JSON.stringify(cdata.model));
      const chatReq = seen.find((r) => r.method === 'POST' && r.url.includes('/chat/completions'));
      const msgs = (chatReq && chatReq.body && chatReq.body.messages) || [];
      check('请求体：模型名 + stream:false + 两条消息', !!chatReq && chatReq.body.model === MODELS[0] && chatReq.body.stream === false && msgs.length === 2, JSON.stringify(chatReq && chatReq.body));
      check('服务端自己加了 system 提示词', msgs[0]?.role === 'system' && /小秘/.test(String(msgs[0]?.content || '')), JSON.stringify(msgs[0]));
      check('用户那句原样带上', msgs[1]?.role === 'user' && msgs[1]?.content === '你好，帮我看看链路通不通', JSON.stringify(msgs[1]));

      // 4.5) 带上工作数据再问一次：模型收到的 system 里要能看到【工作数据】
      const stamp = `AIMG${Date.now().toString(36)}`;
      const made = await api(page, '/api/reminder/items', 'POST', {
        title: `${stamp}桩实测完成`, due_at: new Date().toISOString(), repeat_rule: 'none', channels: ['inapp'],
      });
      const madeId = made.body?.data?.id ?? null;
      if (madeId) await api(page, `/api/reminder/items/${madeId}/complete`, 'POST', {});

      // 4.4) 栏目提示词（用户 2026-10-17）：清单上的「这一栏该怎么分析」只进 system，
      //      分栏列出；清空后就不再出现。挑自检任务所在的栏目，保证它这一轮真有数据。
      const promptListId = made.body?.data?.list_id ?? null;
      const promptListName = made.body?.data?.list_name ?? '';
      const promptText = `${stamp}栏目要求：先说结论`;
      const promptSet = promptListId
        ? await api(page, `/api/reminder/lists/${promptListId}`, 'PATCH', { ai_prompt: promptText })
        : { body: { code: -1 } };
      check('清单能存下 AI 提示词', !!promptListId && promptSet.body?.code === 0, JSON.stringify(promptSet.body).slice(0, 200));

      const seenBefore = seen.length;
      const digestChat = await api(page, '/api/assistant/chat', 'POST', {
        messages: [{ role: 'user', content: '帮我写这周的周报' }],
        digest: { option: 'week' },
      });
      const ddata = digestChat.body?.data || {};
      check('带工作数据提问仍然走模型（mode=model）', digestChat.body?.code === 0 && ddata.mode === 'model', JSON.stringify(digestChat.body).slice(0, 240));
      const digestReq = seen.slice(seenBefore).find((r) => r.method === 'POST' && r.url.includes('/chat/completions'));
      const dmsgs = (digestReq && digestReq.body && digestReq.body.messages) || [];
      const dsystem = String(dmsgs[0]?.content || '');
      check('模型收到的 system 里有【工作数据】段', /【工作数据】/.test(dsystem), dsystem.slice(0, 200));
      check('自检那条已完成任务进了给模型的资料', dsystem.includes(`${stamp}桩实测完成`), dsystem.slice(0, 400));
      check('回复带数据摘要回执（前端据此写「已附上数据」）',
        !!ddata.digest && ddata.digest.option === 'week' && (ddata.digest.completed || 0) >= 1 && (ddata.digest.lists || 0) >= 1,
        JSON.stringify(ddata.digest).slice(0, 240));
      check('栏目提示词进了给模型的 system（分栏列出、带栏目名）',
        dsystem.includes('【各栏目的分析要求】') && dsystem.includes(`- ${promptListName}：${promptText}`),
        dsystem.slice(-320));
      check('栏目提示词没混进用户消息或数据摘要',
        !String(dmsgs[1]?.content || '').includes('栏目要求') && !JSON.stringify(ddata.digest || {}).includes('栏目要求'),
        JSON.stringify({ user: dmsgs[1]?.content, digest: ddata.digest }).slice(0, 240));
      if (promptListId) {
        await api(page, `/api/reminder/lists/${promptListId}`, 'PATCH', { ai_prompt: '' });
        const seenClear = seen.length;
        await api(page, '/api/assistant/chat', 'POST', {
          messages: [{ role: 'user', content: '再写一次周报' }],
          digest: { option: 'week' },
        });
        const clearReq = seen.slice(seenClear).find((r) => r.method === 'POST' && r.url.includes('/chat/completions'));
        const clearSystem = String(((clearReq && clearReq.body && clearReq.body.messages) || [])[0]?.content || '');
        // 只断言「被清空那一栏」的要求消失了：别的栏目可能也写着要求（比如展示实例上的
        // 「信用卡账单」），那些照样该出现，不能拿整段标题当判据。
        check('清空某栏的提示词后，system 里不再有那一栏的要求',
          !clearSystem.includes(`- ${promptListName}：${promptText}`), clearSystem.slice(-260));
      }
      if (madeId) await api(page, `/api/reminder/items/${madeId}`, 'DELETE');

      // 5) 面板：状态行与真回复
      await page.goto(`${BASE}/admin/home`, { waitUntil: 'networkidle2' });
      await sleep(500);
      await page.click('[data-assistant-trigger]');
      await sleep(700);
      const statusText = await page.evaluate(() => (document.querySelector('[data-assistant-status]')?.textContent || '').trim());
      check('面板状态行显示「模型已接入」', /模型已接入/.test(statusText), statusText);
      const connLive = await page.evaluate(() => ({
        state: document.querySelector('[data-assistant-conn]')?.getAttribute('data-assistant-conn-state') || '',
        color: getComputedStyle(document.querySelector('[data-assistant-title]')).color,
      }));
      check('接上模型后「AI 小秘」标题标绿',
        connLive.state === 'live' && /rgb\(\d+, 1[0-9]{2}, \d+\)/.test(connLive.color), JSON.stringify(connLive));
      // 顶部「没有可用模型」横幅只属于未接模型那一面（用户 2026-10-17）：接了模型就不许出现。
      const offlineBanner = await page.evaluate(() => (document.querySelector('[data-assistant-offline]')?.textContent || '').trim());
      check('已接模型时顶部没有「没有可用模型」横幅', !offlineBanner, offlineBanner);
      await page.type('[data-assistant-input]', '面板里也试一句');
      await page.click('[data-assistant-send]');
      let bubbles = [];
      for (let i = 0; i < 20; i += 1) {
        await sleep(500);
        bubbles = await page.evaluate(() => Array.from(document.querySelectorAll('[data-assistant-role="assistant"]'))
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()));
        if (bubbles.some((t) => t.includes('桩服务收到了'))) break;
      }
      check('面板里拿到了模型回复', bubbles.some((t) => t.includes('桩服务收到了')), JSON.stringify(bubbles));
      check('面板没有退回本地占位文案', !bubbles.some((t) => /占位/.test(t)), JSON.stringify(bubbles));
      await page.click('[data-assistant-close]');
      await sleep(300);

      // 5.5) 后台选模型：拉取列表 → 点选 → 保存后「当前模型」跟着变
      // （用户 2026-10-16：「添加模型后，不能选择，希望改成 拉取服务器列表后可以选择，然后有专门位置显示当前模型」）
      await page.goto(`${BASE}/admin/configs`, { waitUntil: 'networkidle2' });
      await sleep(900);
      check('面板上有拉列表的按钮（`data-ai-pull-models`，按钮字面是「拉取服务器列表」）',
        await page.evaluate(() => {
          const el = document.querySelector('[data-ai-pull-models]');
          return !!el && /拉取/.test(el.textContent || '');
        }));
      await page.click('[data-ai-pull-models]');
      let picks = [];
      for (let i = 0; i < 25; i += 1) {
        await sleep(400);
        picks = await page.evaluate(() => Array.from(document.querySelectorAll('[data-ai-model-option]'))
          .map((el) => el.getAttribute('data-ai-model-option') || ''));
        if (MODELS.every((m) => picks.includes(m))) break;
      }
      check('拉取后桩的两个模型都进了可点清单', MODELS.every((m) => picks.includes(m)), JSON.stringify(picks));
      const listShape = await page.evaluate(() => ({
        options: Array.from(document.querySelectorAll('[data-ai-model-option]')).map((el) => el.getAttribute('data-ai-model-option')),
        presets: Array.from(document.querySelectorAll('[data-ai-model-preset-hint]')).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()),
        title: (document.querySelector('[data-ai-model-list]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      }));
      check('可点清单只放服务器真有的模型（预设常见名字不混进来）',
        listShape.options.length === MODELS.length && MODELS.every((m) => listShape.options.includes(m)),
        JSON.stringify(listShape.options));
      check('预设常见名字不占可点位置（最多在下面一行提示里）',
        listShape.presets.length <= 1 && !listShape.presets.some((t) => MODELS.some((m) => t.includes(m))),
        JSON.stringify(listShape.presets));
      check('清单标题写明是「服务器上可用」', /服务器上可用/.test(listShape.title), listShape.title);
      await page.click(`[data-ai-model-option="${MODELS[1]}"]`);
      await sleep(400);
      const held = await page.evaluate(() => ({
        value: document.querySelector('[data-ai-model]')?.value || '',
        pending: (document.querySelector('[data-ai-model-pending]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      }));
      check('点选后模型名输入框换成所选那条', held.value === MODELS[1], JSON.stringify(held));
      check('未保存时「当前模型」块提示会换成所选那条', held.pending.includes(MODELS[1]), JSON.stringify(held));
      await page.click('[data-ai-save]');
      await sleep(2200);
      const nowModel = await page.evaluate(() => ({
        name: (document.querySelector('[data-ai-current-model-name]')?.textContent || '').trim(),
        pending: !!document.querySelector('[data-ai-model-pending]'),
        block: (document.querySelector('[data-ai-current-model]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      }));
      check('保存后「当前模型」块显示的就是所选模型', nowModel.name === MODELS[1], JSON.stringify(nowModel));
      check('保存后不再提示「未保存」', nowModel.pending === false, JSON.stringify(nowModel));
      const savedModel = (await api(page, '/api/assistant/admin/settings')).body?.data?.model || '';
      check('服务端读回来的模型名与所选一致', savedModel === MODELS[1], savedModel);

      // 5.6) 思考过程三种口径（用户 2026-10-16：「对话框中给出 3种模式，只有对话，
      // 简洁思考，详细思考过程。通过后台偏好可以设定」）
      // 桩每轮都回同样的 reasoning，正好用来分辨后端是按哪种口径裁的。
      const askOnce = async (thinking) => {
        const payload = { messages: [{ role: 'user', content: '你好' }] };
        if (thinking) payload.thinking = thinking;
        const res = await api(page, '/api/assistant/chat', 'POST', payload);
        return res.body?.data || {};
      };

      const brief = await askOnce();
      check('不带档位时按后台偏好（默认简洁思考）', brief.thinking_mode === 'brief', JSON.stringify({ mode: brief.thinking_mode }));
      check('简洁思考：压成一行且截断', brief.thinking === THINKING_FLAT.slice(0, 120) && brief.thinking_truncated === true,
        JSON.stringify({ thinking: String(brief.thinking).slice(0, 60), truncated: brief.thinking_truncated }));
      check('简洁思考不影响正式回答', brief.reply === REPLY, String(brief.reply).slice(0, 60));

      const full = await askOnce('full');
      check('详细思考过程：整段原样给（换行保留）', full.thinking === THINKING && full.thinking_truncated === false,
        JSON.stringify({ len: String(full.thinking || '').length, truncated: full.thinking_truncated }));
      check('详细思考过程：档位如实回传', full.thinking_mode === 'full', JSON.stringify({ mode: full.thinking_mode }));

      const off = await askOnce('off');
      check('只有对话：思维链不下发给浏览器', off.thinking === '' && off.thinking_mode === 'off',
        JSON.stringify({ thinking: off.thinking, mode: off.thinking_mode }));
      check('只有对话：回答本身照旧', off.reply === REPLY, String(off.reply).slice(0, 60));

      const dirty = await askOnce('乱写的档位');
      check('非法档位退回默认而不是报错', dirty.thinking_mode === 'brief' && String(dirty.reply).includes('桩服务收到了'),
        JSON.stringify({ mode: dirty.thinking_mode }));

      // 后台偏好：能选、能存、能读回来；面板打开时按它初始化
      await page.goto(`${BASE}/admin/configs`, { waitUntil: 'networkidle2' });
      await sleep(900);
      const modeField = await page.evaluate(() => {
        const el = document.querySelector('[data-ai-thinking-mode]');
        return {
          exists: !!el,
          options: el ? Array.from(el.options).map((o) => o.value) : [],
          value: el ? el.value : '',
          note: (document.querySelector('[data-ai-thinking-mode]')?.parentElement?.textContent || '').replace(/\s+/g, ' ').trim(),
        };
      });
      check('后台有「对话里显示思考过程」下拉且三档齐全',
        modeField.exists && modeField.options.join(',') === 'off,brief,full', JSON.stringify(modeField));
      check('下拉默认是简洁思考', modeField.value === 'brief', JSON.stringify({ value: modeField.value }));
      check('说明里写清「模型仍然会想、只影响显示」', /仍然会先想|不改变上游/.test(modeField.note), modeField.note.slice(0, 160));

      await page.select('[data-ai-thinking-mode]', 'full');
      await sleep(300);
      await page.click('[data-ai-save]');
      await sleep(2200);
      const savedMode = (await api(page, '/api/assistant/admin/settings')).body?.data?.thinking_mode || '';
      check('后台偏好保存成功（服务端读回来是 full）', savedMode === 'full', savedMode);
      const statusMode = (await api(page, '/api/assistant/status')).body?.data?.thinking_mode || '';
      check('状态接口把后台偏好带给面板', statusMode === 'full', statusMode);

      // 面板：三个档位能当场切，切完照各自口径显示
      await page.goto(`${BASE}/admin/home`, { waitUntil: 'networkidle2' });
      await sleep(500);
      await page.click('[data-assistant-trigger]');
      await sleep(800);
      const chips = await page.evaluate(() => Array.from(document.querySelectorAll('[data-assistant-thinking-option]'))
        .map((el) => ({ mode: el.getAttribute('data-assistant-thinking-option'), active: el.getAttribute('data-assistant-thinking-active') === '1' })));
      check('面板上有三个思考过程档位', chips.length === 3 && ['off', 'brief', 'full'].every((m) => chips.some((c) => c.mode === m)), JSON.stringify(chips));
      check('面板默认落到后台偏好那一档', chips.find((c) => c.active)?.mode === 'full', JSON.stringify(chips));

      const sendAndRead = async (label) => {
        await page.click(`[data-assistant-thinking-option="${label}"]`);
        await sleep(250);
        await page.type('[data-assistant-input]', `换档试试 ${label}`);
        await page.click('[data-assistant-send]');
        let shot = { brief: '', full: '', reply: '' };
        for (let i = 0; i < 24; i += 1) {
          await sleep(500);
          // 只看**最后一条回复**那一组：每条回复各自记着自己当时的档位，
          // 整页 querySelector 会先撞上前面那些条目。
          shot = await page.evaluate(() => {
            const kids = Array.from(document.querySelector('[data-assistant-scroll]')?.children || []);
            let start = -1;
            kids.forEach((el, i) => { if (el.getAttribute('data-assistant-role') === 'assistant') start = i; });
            const tail = start >= 0 ? kids.slice(start) : [];
            const text = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
            return {
              brief: text(tail.find((el) => el.hasAttribute('data-assistant-thinking-brief'))),
              full: text(tail.find((el) => el.hasAttribute('data-assistant-thinking-full'))),
              reply: text(kids[start]),
            };
          });
          if (/桩服务收到了/.test(shot.reply)) break;
        }
        return shot;
      };

      const fullShot = await sendAndRead('full');
      check('详细思考过程：面板出现折叠块，内容是整段思维链', /第一步：先确认链路/.test(fullShot.full) && /思考过程/.test(fullShot.full), fullShot.full.slice(0, 80));
      check('详细思考过程：不再显示成一行小字', fullShot.brief === '', fullShot.brief.slice(0, 60));

      const briefShot = await sendAndRead('brief');
      check('简洁思考：面板显示一行小字（带省略号）', /^思考：第一步/.test(briefShot.brief) && briefShot.brief.endsWith('…'), briefShot.brief.slice(0, 80));
      check('简洁思考：不出现折叠块', briefShot.full === '', briefShot.full.slice(0, 60));

      const offShot = await sendAndRead('off');
      check('只有对话：面板既没有一行小字也没有折叠块', offShot.brief === '' && offShot.full === '', JSON.stringify(offShot).slice(0, 120));
      check('只有对话：回答照常显示', /桩服务收到了/.test(offShot.reply), offShot.reply.slice(0, 60));

      // 用户当场换的档位要记住（存用户配置 assistant_thinking_mode），重开面板仍是它
      const mine = await api(page, '/api/configs');
      check('面板换的档位存进了用户配置', String(mine.body?.data?.assistant_thinking_mode || '') === 'off',
        String(mine.body?.data?.assistant_thinking_mode || ''));
      await page.click('[data-assistant-close]');
      await sleep(300);
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(600);
      await page.click('[data-assistant-trigger]');
      await sleep(900);
      const reopened = await page.evaluate(() => Array.from(document.querySelectorAll('[data-assistant-thinking-option]'))
        .map((el) => ({ mode: el.getAttribute('data-assistant-thinking-option'), active: el.getAttribute('data-assistant-thinking-active') === '1' })));
      check('重开面板仍是用户上次选的那一档', reopened.find((c) => c.active)?.mode === 'off', JSON.stringify(reopened));
      await page.click('[data-assistant-close]');
      await sleep(300);

      // 6) 收尾：清掉桩的参数与用户自己存的档位，恢复成未启用
      await api(page, '/api/configs', 'PUT', { key: 'assistant_thinking_mode', value: '' });
      const restore = await api(page, '/api/assistant/admin/settings', 'PUT', {
        enabled: false, provider: 'deepseek', base_url: '', model: '', timeout_seconds: 60, clear_api_key: true,
        thinking_mode: 'brief',
      });
      const after = await api(page, '/api/assistant/status');
      check('收尾已恢复未启用', restore.body?.code === 0 && after.body?.data?.enabled === false, JSON.stringify(after.body?.data));
    });
  } finally {
    server.close();
  }
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('套件异常：', err); process.exit(1); });
