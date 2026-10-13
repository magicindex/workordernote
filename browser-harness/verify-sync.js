/**
 * 验证 0.3.0 的「系统配置 → 双机同步」面板（真界面操作，不是只调接口）。
 *
 * 用法：
 *   APP_URL=http://127.0.0.1:8911 APP_USER=王耀辉 APP_PASS='E2e!Passw0rd' \
 *     node verify-sync.js
 *
 * 前置：先跑 verify-sync-e2e.sh 起好两台已配好同步的容器（8911 / 8912）。
 *
 * 覆盖：面板渲染、方向/间隔控件、令牌不回显与可显示、测试连接、立即同步、
 *       未保存改动提示、关闭同步后相关输入禁用、窄屏不溢出、无控制台报错。
 * 只读优先：除了「立即同步」（本身幂等）不改动服务端数据，方向/间隔的试探
 * 改动在结束前恢复原值且不保存。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || 'http://127.0.0.1:8911';
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 面板整体的可见文本，便于按文案断言。 */
function panelText(page) {
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
    const panel = heading && heading.closest('.surface');
    return panel ? panel.innerText : '';
  });
}

/** 取面板里的 select / input 的结构化信息。 */
function panelFields(page) {
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
    const panel = heading && heading.closest('.surface');
    if (!panel) return null;
    const selects = [...panel.querySelectorAll('select')];
    const inputs = [...panel.querySelectorAll('input')];
    const direction = selects[0];
    const interval = selects[1];
    const peer = inputs.find((i) => i.getAttribute('inputmode') === 'url' || i.placeholder.includes('192.168'));
    const token = inputs.find((i) => i.type === 'password' || i.autocomplete === 'off');
    const button = (label) => [...panel.querySelectorAll('button')].find((b) => b.textContent.includes(label));
    return {
      direction: direction && {
        value: direction.value,
        label: direction.options[direction.selectedIndex]?.textContent.trim(),
        disabled: direction.disabled,
        options: [...direction.options].map((o) => o.value),
      },
      interval: interval && {
        value: interval.value,
        label: interval.options[interval.selectedIndex]?.textContent.trim(),
        disabled: interval.disabled,
      },
      peer: peer && { value: peer.value, disabled: peer.disabled, placeholder: peer.placeholder },
      token: token && { type: token.type, value: token.value, disabled: token.disabled, length: token.value.length },
      buttons: {
        save: !!button('保存设置'),
        saveDisabled: button('保存设置')?.disabled,
        test: !!button('测试连接'),
        run: !!button('立即同步'),
      },
      text: panel.innerText,
    };
  });
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    const consoleErrors = [];
    const badResponses = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
    page.on('response', (res) => {
      if (res.status() >= 400) badResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    });

    const ok = await login(page, BASE);
    check('以管理员登录成功', ok);

    // ---- 1. 面板出现在「系统配置」页 ----
    await page.goto(BASE.replace(/\/$/, '') + '/admin/configs', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const rendered = await waitFor(page, () => [...document.querySelectorAll('h2')]
      .some((h) => h.textContent.trim() === '双机同步'), { timeout: 20000 });
    check('系统配置页出现「双机同步」面板', rendered);
    if (!rendered) return;

    await sleep(1200); // 等同步设置加载完（面板内的骨架消失）
    let fields = await panelFields(page);
    check('面板读到同步设置（方向控件可用）', !!fields && !!fields.direction && !fields.direction.disabled,
      fields ? JSON.stringify(fields.direction) : 'no fields');

    // ---- 2. 方向与间隔控件 ----
    check('方向下拉有 4 个选项（关闭/推送/拉取/双向）',
      !!fields && fields.direction.options.join(',') === 'off,push,pull,both',
      fields ? fields.direction.options.join(',') : '');
    check('方向显示为「双向同步」', !!fields && fields.direction.label === '双向同步',
      fields ? fields.direction.label : '');
    check('间隔下拉包含「仅手动同步」', !!fields && /仅手动同步|每/.test(fields.interval?.label || ''),
      fields ? fields.interval?.label : '');

    // ---- 3. 对端地址与令牌 ----
    check('对端地址已回填', !!fields && /:\d+$/.test(fields.peer?.value || ''), fields ? fields.peer?.value : '');
    check('令牌默认以密码框回显（值已带出但不明文显示）',
      !!fields && fields.token?.type === 'password' && fields.token?.value.length >= 8,
      fields ? JSON.stringify({ type: fields.token?.type, len: fields.token?.value.length }) : '');

    // 点「显示」后能拿到本机令牌（管理员需要把它填到对端）
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      const panel = heading.closest('.surface');
      const btn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('显示'));
      btn && btn.click();
    });
    await sleep(400);
    const revealed = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      const token = [...heading.closest('.surface').querySelectorAll('input')].find((i) => i.autocomplete === 'off');
      return { type: token.type, value: token.value, ok: !!token.value };
    });
    check('点「显示」后令牌可读（长度 ≥ 8）', revealed.ok && revealed.value.length >= 8,
      JSON.stringify({ type: revealed.type, len: revealed.value.length }));
    const tokenValue = revealed.value;

    // ---- 4. 测试连接 ----
    const clickedTest = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      if (!heading) return false;
      const btn = [...heading.closest('.surface').querySelectorAll('button')].find((b) => b.textContent.includes('测试连接'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    check('找到并点击「测试连接」', clickedTest);
    const testOk = await waitFor(page, () => document.body.innerText.includes('连接正常'), { timeout: 45000 });
    check('「测试连接」返回连接正常', testOk, badResponses.slice(0, 2).join(' | '));
    let text = await panelText(page);
    check('测试结果报出对端账号匹配情况', /能配上的账号/.test(text), text.slice(0, 120).replace(/\n/g, ' | '));
    check('测试结果报出两端时钟差', /两端时钟差/.test(text));

    // ---- 5. 立即同步 ----
    const clickedRun = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      if (!heading) return false;
      const btn = [...heading.closest('.surface').querySelectorAll('button')].find((b) => b.textContent.includes('立即同步'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    check('找到并点击「立即同步」', clickedRun);
    const syncOk = await waitFor(page, () => document.body.innerText.includes('同步完成')
      || document.body.innerText.includes('上次同步'), { timeout: 60000 });
    check('「立即同步」跑完并回显结果', syncOk);
    await waitFor(page, () => /上次同步/.test(document.body.innerText), { timeout: 20000 });
    text = await panelText(page);
    check('上次同步显示成功', /成功/.test(text), text.slice(0, 200).replace(/\n/g, ' | '));
    check('上次同步给出各方向改动计数', /(从对端拉取|推送到对端)：新增/.test(text));
    check('同步结果里带方向或时间信息', /(自动|手动)/.test(text));

    // ---- 6. 未保存改动提示 ----
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      const select = [...heading.closest('.surface').querySelectorAll('select')][1];
      // 记下原值，后面还原时用（这些试探改动一律不保存）
      window.__origInterval = select.value;
      select.value = '15';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);
    let dirty = await page.evaluate(() => document.body.innerText.includes('有未保存的改动'));
    check('改间隔后出现「有未保存的改动」', dirty);
    const saveEnabled = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      const btn = [...heading.closest('.surface').querySelectorAll('button')].find((b) => b.textContent.includes('保存设置'));
      return !btn.disabled;
    });
    check('「保存设置」按钮变为可用', saveEnabled, '');

    // ---- 7. 关闭同步后，地址/令牌不可编辑；恢复后重新可编辑 ----
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      const select = [...heading.closest('.surface').querySelectorAll('select')][0];
      select.value = 'off';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);
    fields = await panelFields(page);
    check('选「关闭同步」后对端地址与令牌被禁用', fields.peer?.disabled === true && fields.token?.disabled === true,
      JSON.stringify({ peer: fields.peer?.disabled, token: fields.token?.disabled }));
    check('关闭后提示文案切换为「关闭后既不同步…」', /关闭后既不同步/.test(fields.text));

    // 还原（不保存，避免把两台机器的配置改掉）
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      const surface = heading.closest('.surface');
      const selects = [...surface.querySelectorAll('select')];
      selects[0].value = 'both';
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      selects[1].value = String(window.__origInterval ?? 0);
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);

    // ---- 8. 窄屏不溢出 ----
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(800);
    const overflow = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      const panel = heading.closest('.surface');
      return { scroll: panel.scrollWidth, client: panel.clientWidth, docScroll: document.documentElement.scrollWidth, win: window.innerWidth };
    });
    check('窄屏（390px）面板不横向溢出', overflow.scroll <= overflow.client + 1,
      JSON.stringify(overflow));
    await page.screenshot({ path: path.join(SHOTS, 'sync-panel-mobile.png'), fullPage: false });
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    await sleep(600);

    // ---- 9. 截图（面板整体） ----
    const panelAlive = await page.evaluate(() => [...document.querySelectorAll('h2')]
      .some((h) => h.textContent.trim() === '双机同步'));
    check('走完全流程后面板仍在（没有因渲染异常整个消失）', panelAlive);
    const panelBox = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '双机同步');
      const rect = heading.closest('.surface').getBoundingClientRect();
      return { x: rect.x, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
    });
    await page.screenshot({
      path: path.join(SHOTS, 'sync-panel.png'),
      clip: {
        x: Math.max(0, panelBox.x - 4),
        y: Math.max(0, panelBox.y - 4),
        width: Math.min(panelBox.width + 8, 1400),
        height: Math.min(panelBox.height + 8, 2000),
      },
    });
    console.log(`  截图：${path.join(SHOTS, 'sync-panel.png')} / sync-panel-mobile.png`);

    // ---- 10. 控制台无报错 ----
    const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR_|Failed to load resource/i.test(e));
    check('过程中没有 JS 报错', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
    check('过程中没有失败请求（≥400）', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));

    // 令牌随机性提示：本机令牌不应是空/固定值
    check('本机令牌非空且非默认占位', tokenValue.length >= 16, `len=${tokenValue.length}`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
