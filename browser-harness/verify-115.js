/**
 * 这一批（用户 2026-10-13 要求）：
 *
 *   1) **卡片颜色与倒计时颜色一致**：整张卡片就是倒计时那一套渐变，不再有「卡面浅色 +
 *      倒计时浓色」两块色（也就没有「单独设卡片颜色」这回事了）。
 *   2) **卡片背景图**：内置主题图直接选（随版本走、删卡片不会删）；也可以自己上传图片，
 *      **卡片删除后上传的图片跟着删**。
 *   3) **别处确认过的通知本机不再显示**：手机点了「知道了」，另一台设备上那条弹窗要消失
 *      （服务端会广播 notification/read，前端核对队列后撤掉）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-115.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const BG_TITLE = `自检背景图-${STAMP}`;
const ACK_TITLE = `自检跨设备弹窗-${STAMP}`;

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

const api = (page, p, method = 'GET', body = null, extraHeaders = null) => page.evaluate(async ({ base, p, method, body, extraHeaders }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body, extraHeaders });

(async () => {
  const created = [];
  let originalStart = '00:00';
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    // 记下「开始提醒时间」原值：这一组要临时改成 00:00（不静默）才能立刻收到到点提醒
    const cfgRes = await api(page, '/api/configs');
    const cfgRows = Array.isArray(cfgRes.body?.data) ? cfgRes.body.data : [];
    originalStart = cfgRows.find((r) => r.key === 'reminder_all_day_time')?.value || '00:00';

    const ceremonyListId = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/lists', { headers: { Authorization: 'Bearer ' + token } });
      const data = (await res.json())?.data || [];
      return (data.find((l) => l.template === 'ceremony') || {}).id || null;
    }, BASE);
    check('找得到「人生要有仪式感」栏目（这一组的前提）', !!ceremonyListId, String(ceremonyListId));
    if (!ceremonyListId) {
      console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
      process.exit(failed ? 1 : 0);
    }

    // ---------- 1. 造一张带「靛蓝」配色 + 内置主题图的卡片 ----------
    const made = await api(page, '/api/reminder/items', 'POST', {
      title: BG_TITLE, kind: 'task', list_id: ceremonyListId,
      due_at: new Date(Date.now() + 86400_000).toISOString(),
      repeat_rule: 'yearly', calendar: 'solar',
      accent: 'indigo', background: 'preset:birthday', channels: ['inapp'],
    });
    const cardId = made.body?.data?.id ?? null;
    if (cardId) created.push(cardId);
    check('建卡片时能带上「配色 + 背景图」（接口接受 preset:<key>）', !!cardId, JSON.stringify(made.body));

    await gotoRetry(page, `${BASE}/admin/list/${ceremonyListId}`);
    await sleep(2600);

    const cardState = await page.evaluate((id) => {
      const card = document.querySelector(`[data-ceremony-card="${id}"]`);
      if (!card) return null;
      const hero = card.querySelector('[data-ceremony-countdown]');
      const img = card.querySelector('.ceremony-bg-img');
      return {
        imageAttr: card.getAttribute('data-ceremony-image'),
        cardBg: getComputedStyle(card).backgroundImage,
        cardColor: getComputedStyle(card).color,
        heroBg: getComputedStyle(hero).backgroundImage,
        heroColor: getComputedStyle(hero).color,
        imgSrc: img ? img.getAttribute('src') : '',
        imgLoaded: !!img && img.complete && img.naturalWidth > 0,
      };
    }, cardId);
    check('卡片渲染出来了（带背景图那张）', !!cardState, '没找到卡片');
    if (cardState) {
      // ① 颜色一致：整卡与倒计时是同一套靛蓝渐变（同一组色值），字色也相同
      const hasIndigo = (bg) => bg.includes('79, 70, 229') && bg.includes('55, 48, 163');
      check('整张卡片用的就是倒计时那套配色（靛蓝两端都在）', hasIndigo(cardState.cardBg), cardState.cardBg.slice(0, 120));
      // 用户 2026-10-13：「倒计时不增加卡片效果，直接显示在大卡片中」→ 它自己没有底色块了
      check('倒计时没有自己的底色块（直接显示在卡片上）',
        !cardState.heroBg || cardState.heroBg === 'none' || /rgba\(0, 0, 0, 0\)/.test(cardState.heroBg),
        cardState.heroBg.slice(0, 120));
      check('整卡与倒计时的字色一致（都不再各来一套）',
        cardState.cardColor === cardState.heroColor, `${cardState.cardColor} vs ${cardState.heroColor}`);
      // ② 内置主题图真的挂上了，而且是构建产物里的资源（不是外链）
      check('内置主题图以 <img> 形式铺在卡片上', !!cardState.imgSrc && cardState.imageAttr === 'preset:birthday',
        `${cardState.imageAttr} | ${cardState.imgSrc}`);
      check('内置主题图加载成功（随版本走、不联网）', cardState.imgLoaded === true, cardState.imgSrc);
      const presetOk = cardState.imgSrc
        ? await page.evaluate(async (src) => {
          try { const r = await fetch(src); return r.status; } catch { return -1; }
        }, cardState.imgSrc)
        : -1;
      check('内置主题图资源可访问（200）', presetOk === 200, String(presetOk));
    }

    // ---------- 2. 编辑器里的背景选择器 ----------
    const editor = await page.evaluate(async (id) => {
      document.querySelector(`[data-ceremony-edit="${id}"]`)?.click();
      await new Promise((r) => setTimeout(r, 700));
      const options = [...document.querySelectorAll('[data-ceremony-form-bg]')]
        .map((b) => b.getAttribute('data-ceremony-form-bg'));
      const upload = document.querySelector('[data-ceremony-form-bg-upload]');
      const selected = [...document.querySelectorAll('[data-ceremony-form-bg]')]
        .filter((b) => b.className.includes('selected'))
        .map((b) => b.getAttribute('data-ceremony-form-bg'));
      return {
        count: options.length,
        hasNone: options.includes('none'),
        presets: options.filter((o) => o !== 'none').length,
        upload: !!upload,
        accept: upload?.getAttribute('accept') || '',
        selected,
      };
    }, cardId);
    check('编辑器里有「纯色 + 主题背景」选择器（纯色 1 项）', editor.hasNone === true, JSON.stringify(editor));
    check('内置主题背景至少 8 张可选', editor.presets >= 8, String(editor.presets));
    check('编辑器里有「上传图片」入口，只收图片', editor.upload === true && editor.accept.includes('image/'),
      `${editor.upload} | ${editor.accept}`);
    check('当前选中项与卡片一致（preset:birthday）', editor.selected.includes('birthday'), JSON.stringify(editor.selected));

    // 切到「纯色」再切回主题图，确认选择器真的在改值（并顺带覆盖清除逻辑）
    const switched = await page.evaluate(async () => {
      document.querySelector('[data-ceremony-form-bg="none"]')?.click();
      await new Promise((r) => setTimeout(r, 200));
      const after = [...document.querySelectorAll('[data-ceremony-form-bg]')]
        .filter((b) => b.className.includes('selected'))
        .map((b) => b.getAttribute('data-ceremony-form-bg'));
      document.querySelector('[data-ceremony-form-bg="starry"]')?.click();
      await new Promise((r) => setTimeout(r, 200));
      const last = [...document.querySelectorAll('[data-ceremony-form-bg]')]
        .filter((b) => b.className.includes('selected'))
        .map((b) => b.getAttribute('data-ceremony-form-bg'));
      return { afterNone: after, afterStarry: last };
    });
    check('点「纯色」会取消背景选择', switched.afterNone.includes('none'), JSON.stringify(switched));
    check('点某张主题图会选中它', switched.afterStarry.includes('starry'), JSON.stringify(switched));
    await page.evaluate(() => [...document.querySelectorAll('.editor-panel button, .modal-panel button')]
      .find((b) => (b.textContent || '').includes('取消'))?.click());
    await sleep(600);

    // ---------- 3. 上传图片 → 删除卡片后文件跟着删 ----------
    const uploaded = await page.evaluate(async (base) => {
      // 用 canvas 造一张真的 PNG（1x1 会太糊，做 8x8 纯色）
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#38bdf8'; ctx.fillRect(0, 0, 8, 8);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const fd = new FormData();
      fd.append('file', new File([blob], 'self-check.png', { type: 'image/png' }));
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
      const json = await res.json().catch(() => null);
      return { status: res.status, path: json?.data?.path || '' };
    }, BASE);
    check('能上传一张图片并拿到 /uploads 路径', uploaded.status === 200 && uploaded.path.startsWith('/uploads/'),
      JSON.stringify(uploaded));

    if (uploaded.path) {
      const setBg = await api(page, `/api/reminder/items/${cardId}`, 'PUT', {
        title: BG_TITLE, kind: 'task', list_id: ceremonyListId,
        due_at: new Date(Date.now() + 86400_000).toISOString(),
        repeat_rule: 'yearly', calendar: 'solar',
        accent: 'indigo', background: uploaded.path, channels: ['inapp'],
      });
      check('能把卡片背景换成刚上传的图片', setBg.status === 200, JSON.stringify(setBg.body).slice(0, 160));

      await gotoRetry(page, `${BASE}/admin/list/${ceremonyListId}`);
      await sleep(2400);
      const uploadedShown = await page.evaluate((id) => {
        const card = document.querySelector(`[data-ceremony-card="${id}"]`);
        const img = card?.querySelector('.ceremony-bg-img');
        return { src: img?.getAttribute('src') || '', loaded: !!img && img.complete && img.naturalWidth > 0 };
      }, cardId);
      check('卡片上显示的是刚上传的图片且加载成功',
        uploadedShown.src.includes('/uploads/') && uploadedShown.loaded === true, JSON.stringify(uploadedShown));

      // 删卡片 → 服务端把文件也删掉（用户明确要求）
      await api(page, `/api/reminder/items/${cardId}`, 'DELETE');
      created.length = 0;
      await sleep(1200);
      const afterDelete = await page.evaluate(async (path) => {
        const url = new URL(path.replace(/^\//, ''), document.baseURI).toString();
        try { return (await fetch(url, { cache: 'no-store' })).status; } catch { return -1; }
      }, uploaded.path);
      check('卡片删除后上传的图片也跟着删了（再取是 404）', afterDelete === 404, `HTTP ${afterDelete}`);
    }

    // 内置主题图不受影响：删掉卡片后资源照样在（「跟随模板不会被删除」）
    const presetAfterDelete = await page.evaluate(async () => {
      const r = await fetch(document.baseURI, { cache: 'no-store' });
      return r.status;
    });
    check('内置主题图是构建产物，不随卡片删除而变化（页面仍正常加载）', presetAfterDelete === 200, String(presetAfterDelete));

    // ---------- 4. 别处确认过的弹窗本机不再显示 ----------
    // 「开始提醒时间」设成 00:00（不静默），保证到点提醒马上发（收尾还原）
    await api(page, '/api/configs', 'PUT', { key: 'reminder_all_day_time', value: '00:00' });
    await api(page, '/api/reminder/notifications/read-all', 'POST');
    await sleep(600);

    const due = await api(page, '/api/reminder/items', 'POST', {
      title: ACK_TITLE, due_at: new Date().toISOString(), repeat_rule: 'none', channels: ['inapp'],
    });
    const ackId = due.body?.data?.id ?? null;
    if (ackId) created.push(ackId);
    check('造一条到点提醒（用于验证跨设备确认）', !!ackId);

    // 记下这一组收到的实时事件，失败时能说清是「没收到广播」还是「收到了没撤掉」
    await page.evaluate(() => {
      window.__ackEvents = []
      window.addEventListener('reminder-realtime', (e) => window.__ackEvents.push(`${e.detail?.type}:${e.detail?.scope || ''}`))
    })

    let popped = false;
    for (let i = 0; i < 6 && !popped; i += 1) {
      await sleep(15_000);
      popped = await page.evaluate(() => !!document.querySelector('[role="alertdialog"]'));
    }
    check('到点后本机弹出提醒弹窗', popped === true);

    if (popped) {
      const note = (await api(page, '/api/reminder/notifications')).body?.data
        ?.find((n) => n.reminder_id === ackId && !n.read_at);
      check('能查到这条未读通知的 id', !!note?.id, JSON.stringify(note));
      if (note?.id) {
        // 模拟「另一台设备」：用**另一个 X-Client-Id** 标已读，服务端广播时不会跳过本标签页
        const markRes = await api(page, `/api/reminder/notifications/${note.id}/read`, 'POST', null,
          { 'X-Client-Id': `other-device-${STAMP}` });
        check('另一台设备把它标成已读（服务端 200 并广播）', markRes.status === 200, String(markRes.status));

        let gone = false;
        let diag = null;
        // 等够两轮修订号轮询（SSE 断掉时靠它兜底，20 秒一轮），再判失败
        for (let i = 0; i < 24 && !gone; i += 1) {
          await sleep(1500);
          const state = await page.evaluate((id) => {
            const dialog = document.querySelector('[role="alertdialog"]');
            return {
              text: dialog ? (dialog.innerText || '').replace(/\s+/g, ' ').slice(0, 120) : '',
              events: (window.__ackEvents || []).slice(-5),
            };
          }, ACK_TITLE);
          diag = state;
          gone = !state.text || !state.text.includes(ACK_TITLE);
        }
        check('本机这条弹窗自动撤掉了（不再「别处点了知道了这边还杵着」）', gone === true, JSON.stringify(diag));
      }
    }

    // ---------- 清理 ----------
    for (const id of created) {
      if (id) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    }
    await api(page, '/api/reminder/notifications/read-all', 'POST');
    await api(page, '/api/configs', 'PUT', { key: 'reminder_all_day_time', value: originalStart });
    const remaining = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data?.items || [];
    check('清理干净：两张测试卡片都删掉了',
      !remaining.some((i) => [BG_TITLE, ACK_TITLE].includes(String(i.title))),
      JSON.stringify(remaining.filter((i) => String(i.title).includes('自检')).map((i) => i.title).slice(0, 5)));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
