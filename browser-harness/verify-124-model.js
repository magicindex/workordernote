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
        choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
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
      if (madeId) await api(page, `/api/reminder/items/${madeId}`, 'DELETE');

      // 5) 面板：状态行与真回复
      await page.goto(`${BASE}/admin/home`, { waitUntil: 'networkidle2' });
      await sleep(500);
      await page.click('[data-assistant-trigger]');
      await sleep(700);
      const statusText = await page.evaluate(() => (document.querySelector('[data-assistant-status]')?.textContent || '').trim());
      check('面板状态行显示「模型已接入」', /模型已接入/.test(statusText), statusText);
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

      // 6) 收尾：清掉桩的参数，恢复成未启用
      const restore = await api(page, '/api/assistant/admin/settings', 'PUT', {
        enabled: false, provider: 'deepseek', base_url: '', model: '', timeout_seconds: 60, clear_api_key: true,
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
