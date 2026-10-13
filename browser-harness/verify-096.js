/**
 * 验证这一批（待发布）：
 *   1) 记住登录：登录页有勾选框，勾了令牌存 localStorage（后台「记住登录天数」，默认 7 天）、
 *      不勾存 sessionStorage（「临时登录小时数」，默认 12 小时）——服务端签发的时间也按这个来。
 *   2) 浏览器安装（PWA）：manifest 合法且带 192/512 图标、Service Worker 能注册、
 *      「版本信息 → 装到桌面」卡片给出正确的安装指引。
 *   3) 手机端不提供导出表格（列表页「导出表格」、日历页「导出本月」在窄屏隐藏，电脑上仍在）。
 *   4) 列表页标题工具栏：条数 / 过期提示 / 未完成·全部 / 刷新都在，刷新真的会重新拉数据。
 *   5) 手机端渲染优化：行与卡片在窄屏去掉模糊阴影、hover 位移，transition 收窄，并量一次帧间隔。
 *   6) 安卓壳子里的登录页只显示「服务器设置」这行文字（不再摆出服务器地址），点了调原生设置。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-096.js
 * 数据：会临时改「记住登录天数」配置（读完原值→改→验→改回），并做一次登录/登出。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP, USER, PASS, openLoginForm, restoreToken } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
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
}, { base: ROOT, p, method, body });

/**
 * 直接调登录接口，返回令牌与解出来的有效期（秒）。
 * 带重试：一轮回归里登录次数很多，公开接口有限流，偶发 429/401 会让这里拿到空令牌
 * （之前就误报成「有效期为 0」）。失败时把状态码与消息带回去，方便一眼看出是限流还是真错。
 */
async function loginAndDecode(remember) {
  let last = { ok: false, ttlSeconds: 0, detail: '' };
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(ROOT + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS, remember }),
    });
    const body = await res.json().catch(() => null);
    const token = body?.data?.token || '';
    if (token) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      return { ok: true, ttlSeconds: (payload.exp || 0) - (payload.iat || 0), detail: '' };
    }
    last = { ok: false, ttlSeconds: 0, detail: `${res.status} ${body?.message || ''}` };
    await new Promise((r) => setTimeout(r, 8000 * (i + 1)));
  }
  return last;
}

/** 帧间隔采样：一边滚动一边数帧，返回 p50/p95/最长。 */
const measureFrames = (page) => page.evaluate(async () => {
  const samples = [];
  let last = performance.now();
  await new Promise((resolve) => {
    let frames = 0
    const tick = (t) => {
      samples.push(t - last)
      last = t
      if (++frames < 100) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
    let y = 0
    const timer = setInterval(() => {
      y += 90
      document.scrollingElement.scrollTop = y
      if (y > 1500) clearInterval(timer)
    }, 16)
  })
  const sorted = samples.slice(5).sort((a, b) => a - b)
  const at = (q) => Math.round(sorted[Math.floor(sorted.length * q)] * 10) / 10
  return { p50: at(0.5), p95: at(0.95), max: at(0.99), n: sorted.length }
})

/**
 * 跳转 + 重试：CDP 侧偶发「domcontentloaded 30 秒超时」（服务端毫秒级返回），
 * 一次抖动不该让整份用例红掉（这条在回归里出现过两次）。
 */
async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return true;
    } catch {
      await sleep(1500);
    }
  }
  return false;
}

// 注意这个分号：上一条是表达式语句（没有分号结尾），紧跟的 IIFE 会被解析成
// 「调用上一个函数的参数」，于是整个用例体永远不执行——症状是脚本静默退出、
// 一行输出都没有（排查了半天）。所有用例文件里 IIFE 前面都要有分号。
;(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    // ---------- 1. 记住登录：勾选框与令牌存放位置 ----------
    // 登录页要先清登录态才看得到（0.14.0 起已登录访问 /login 会被守卫送回工作台）
    await openLoginForm(page, BASE);
    const box = await page.evaluate(() => {
      const el = document.querySelector('[data-remember]')
      return el ? { exists: true, checked: el.checked, text: el.closest('label')?.innerText.replace(/\s+/g, ' ').trim() || '' } : { exists: false }
    });
    check('登录页有「记住密码」勾选框', box.exists === true, JSON.stringify(box));
    check('默认勾选（与之前的行为一致：默认长期有效）', box.checked === true, String(box.checked));
    check('勾选框旁边说明了有效期', /天|小时/.test(box.text), box.text);

    // 不勾「记住登录」：令牌应落在 sessionStorage
    await page.evaluate(() => { document.querySelector('[data-remember]').click() })
    await sleep(200);
    await page.evaluate(({ u, p }) => {
      const inputs = [...document.querySelectorAll('input')]
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(inputs.find((i) => i.autocomplete === 'username') || inputs[0], u)
      set(inputs.find((i) => i.type === 'password'), p)
    }, { u: USER, p: PASS });
    await page.evaluate(() => document.querySelector('form button[type="submit"]').click());
    await waitFor(page, () => location.pathname.startsWith('/admin'), { timeout: 20000 });
    await sleep(800);
    const noRemember = await page.evaluate(() => ({
      local: !!localStorage.getItem('reminders.token'),
      session: !!sessionStorage.getItem('reminders.token'),
    }));
    check('不勾「记住登录」时令牌只存 sessionStorage（关浏览器即失效）',
      noRemember.session === true && noRemember.local === false, JSON.stringify(noRemember));

    // 勾上「记住登录」再登一次：令牌应落在 localStorage
    await openLoginForm(page, BASE);
    const stillChecked = await page.evaluate(() => document.querySelector('[data-remember]').checked);
    check('重新打开登录页时勾选框回到默认（勾上）', stillChecked === true, String(stillChecked));
    await page.evaluate(({ u, p }) => {
      const inputs = [...document.querySelectorAll('input')]
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(inputs.find((i) => i.autocomplete === 'username') || inputs[0], u)
      set(inputs.find((i) => i.type === 'password'), p)
    }, { u: USER, p: PASS });
    await page.evaluate(() => document.querySelector('form button[type="submit"]').click());
    await waitFor(page, () => location.pathname.startsWith('/admin'), { timeout: 20000 });
    await sleep(800);
    const remembered = await page.evaluate(() => ({
      local: !!localStorage.getItem('reminders.token'),
      session: !!sessionStorage.getItem('reminders.token'),
    }));
    check('勾上「记住登录」时令牌存 localStorage', remembered.local === true && remembered.session === false, JSON.stringify(remembered));

    // 「记住密码」：勾上并登录成功后，账号密码要存在本机（下次打开登录页自动预填）
    const savedLogin = await page.evaluate(() => {
      const raw = localStorage.getItem('reminders.remembered_login');
      if (!raw) return null;
      try { return JSON.parse(decodeURIComponent(escape(atob(raw)))); } catch { return null; }
    });
    check('勾上「记住密码」后本机存下了账号密码',
      !!savedLogin && savedLogin.u === USER && savedLogin.p === PASS, JSON.stringify(savedLogin && { u: savedLogin.u, p: savedLogin.p ? '***' : '' }));

    // ---------- 2. 有效期：配置能改，服务端按配置签发 ----------
    const cfg0 = await api(page, '/api/configs');
    const days0 = cfg0.body?.data?.login_remember_days ?? '7';
    const hours0 = cfg0.body?.data?.login_session_hours ?? '12';
    const pub = await page.evaluate(async (base) => (await (await fetch(base + '/api/configs/public', { cache: 'no-store' })).json())?.data, ROOT);
    check('记住登录天数在公开配置里（登录页能显示出来）', pub?.login_remember_days !== undefined, JSON.stringify(pub?.login_remember_days));

    try {
      await api(page, '/api/configs', 'PUT', { key: 'login_remember_days', value: '3' });
      await api(page, '/api/configs', 'PUT', { key: 'login_session_hours', value: '5' });
      const remember3 = await loginAndDecode(true);
      const session5 = await loginAndDecode(false);
      check('勾「记住登录」按后台天数签发（改 3 天 → 3×24 小时）',
        Math.abs(remember3.ttlSeconds - 3 * 86400) <= 120, `${remember3.ttlSeconds}s ${remember3.detail}`);
      check('不勾按后台小时数签发（改 5 小时 → 5 小时）',
        Math.abs(session5.ttlSeconds - 5 * 3600) <= 120, `${session5.ttlSeconds}s ${session5.detail}`);
      // 看提示要临时登出；看完立刻把 token 放回去，后面 finally 里还要用 api() 还原配置
      const keep = await openLoginForm(page, BASE);
      const hint3 = await page.evaluate(() => document.querySelector('[data-remember]')?.closest('label')?.innerText || '');
      check('登录页的提示跟着配置走（显示 3 天）', /3\s*天/.test(hint3), hint3.replace(/\s+/g, ' '));
      await restoreToken(page, keep);
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'login_remember_days', value: String(days0) });
      await api(page, '/api/configs', 'PUT', { key: 'login_session_hours', value: String(hours0) });
      const back = await api(page, '/api/configs');
      check('两个有效期配置都已还原并回读确认',
        String(back.body?.data?.login_remember_days) === String(days0) && String(back.body?.data?.login_session_hours) === String(hours0),
        `${back.body?.data?.login_remember_days} / ${back.body?.data?.login_session_hours}`);
    }

    await login(page, BASE);

    // ---------- 3. 浏览器安装（PWA） ----------
    // manifest 与 sw.js 用 Node 侧取：浏览器里可能还挂着上一轮的 Service Worker，
    // 它会替我们把响应换掉（这正是「manifest 被缓存」那个 bug 的现场）。
    const mf = await (await fetch(ROOT + '/manifest.webmanifest', { cache: 'no-store' })).json();
    const swRes = await fetch(ROOT + '/sw.js', { cache: 'no-store' });
    const swBody = await swRes.text();
    const pwa = {
      name: mf.name,
      display: mf.display,
      startUrl: mf.start_url,
      icons: (mf.icons || []).map((i) => i.sizes),
      shortcutCount: (mf.shortcuts || []).length,
      swStatus: swRes.status,
      swType: swRes.headers.get('content-type') || '',
      swCachesAssetsOnly: swBody.includes('/assets/') && swBody.includes('no-store') === false,
    };
    check('manifest 合法且字段齐全（名称/display/start_url/图标）',
      !!pwa.name && pwa.display === 'standalone' && !!pwa.startUrl && pwa.icons.includes('192x192') && pwa.icons.includes('512x512'),
      JSON.stringify(pwa).slice(0, 160));
    check('manifest 里配了快捷入口', pwa.shortcutCount >= 2, String(pwa.shortcutCount));
    check('Service Worker 文件能取到且是 JS', pwa.swStatus === 200 && /javascript/.test(pwa.swType), `${pwa.swStatus} ${pwa.swType}`);
    check('SW 只对带 hash 的 /assets 做缓存优先（避免升级后拿到旧文件）', pwa.swCachesAssetsOnly === true);

    await gotoRetry(page, ROOT + '/admin');
    await sleep(2500);
    const swReg = await page.evaluate(async () => {
      // 非安全上下文（内网 http 的 IP 访问）里浏览器根本不暴露 navigator.serviceWorker，
      // 所以这里要区分「不支持」与「没注册」——生产就是这种情况（局域网 http）。
      if (!('serviceWorker' in navigator)) return { supported: false, scopes: [], secure: window.isSecureContext }
      const regs = await navigator.serviceWorker.getRegistrations()
      return { supported: true, scopes: regs.map((r) => r.scope), secure: window.isSecureContext }
    });
    if (!swReg.secure) {
      check('内网 http（非安全上下文）：浏览器不提供 Service Worker，代码按设计跳过注册',
        swReg.supported === false, JSON.stringify(swReg));
    } else if (!swReg.supported) {
      check('安全上下文下浏览器应当支持 Service Worker', false, JSON.stringify(swReg));
    } else {
      check('安全上下文下 Service Worker 已注册（安装能力的前提）', swReg.scopes.length >= 1, JSON.stringify(swReg));
    }

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('版本信息'))
      if (btn) btn.click()
    });
    await waitFor(page, () => !!document.querySelector('[data-install-card]'), { timeout: 8000 });
    await sleep(700);
    const installCard = await page.evaluate(() => {
      const el = document.querySelector('[data-install-card]')
      return {
        text: el.innerText.replace(/\s+/g, ' ').slice(0, 240),
        hasButton: !!el.querySelector('[data-install-button]'),
        hint: el.querySelector('[data-install-hint]')?.textContent.trim() || '',
      }
    });
    check('「版本信息」里有「装到桌面」卡片', /装到桌面|已经装到/.test(installCard.text), installCard.text.slice(0, 80));
    check('卡片给出了安装指引或安装按钮',
      installCard.hasButton || /添加|安装|地址栏|菜单|分享/.test(installCard.text), JSON.stringify(installCard).slice(0, 200));
    await page.screenshot({ path: path.join(SHOTS, 'install-card.png') });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭' && b.closest('section'))
      if (btn) btn.click()
    });
    await sleep(500);

    // ---------- 4. 标题工具栏 ----------
    // 「未完成 / 全部」开关只在「全部」页有（今天/计划页已取消），所以工具栏这一段在
    // 「全部」页上看，才能同时验到刷新/条数/开关三件套。
    await gotoRetry(page, ROOT + '/admin/all');
    await waitFor(page, () => !!document.querySelector('.list-toolbar'), { timeout: 15000 });
    await sleep(1200);
    const bar = await page.evaluate(() => {
      const el = document.querySelector('.list-toolbar')
      const refresh = el.querySelector('.toolbar-btn[aria-label="刷新"]')
      return {
        hasToolbar: !!el,
        number: el.querySelector('.count-number')?.textContent.trim() || '',
        unit: el.querySelector('.count-unit')?.textContent.trim() || '',
        overdue: el.querySelector('.count-overdue')?.textContent.replace(/\s+/g, ' ').trim() || '',
        seg: [...el.querySelectorAll('.seg-group .seg-btn')].map((b) => b.textContent.trim()),
        refresh: !!refresh,
        shadow: getComputedStyle(el).boxShadow !== 'none',
      }
    });
    check('列表页有标题工具栏', bar.hasToolbar === true, JSON.stringify(bar));
    check('工具栏显示条数与单位', /^\d+$/.test(bar.number) && bar.unit === '项', `${bar.number}${bar.unit}`);
    // 「未完成 / 全部」开关现在只在「全部」页有（今天/计划页取消了，用户要求只显示未完成）
    check('全部页工具栏有「未完成 / 全部」切换',
      JSON.stringify(bar.seg) === JSON.stringify(['未完成', '全部']), JSON.stringify(bar.seg));
    check('工具栏有刷新按钮', bar.refresh === true);
    check('工具栏是一张有质感的卡片（带轻阴影）', bar.shadow === true);

    // 刷新按钮真的会重新拉数据
    // axios 走的是 XMLHttpRequest，patch window.fetch 抓不到；用资源计时数请求
    // （performance.getEntriesByType('resource') 对 XHR 同样有记录）。
    const refreshed = await page.evaluate(async () => {
      const count = () => performance.getEntriesByType('resource')
        .filter((e) => e.name.includes('/api/reminder/items')).length
      const before = count()
      document.querySelector('.toolbar-btn[aria-label="刷新"]').click()
      await new Promise((r) => setTimeout(r, 2500))
      return count() - before
    });
    check('点「刷新」会重新请求列表数据', refreshed >= 1, `${refreshed} 次`);

    // ---------- 5. 手机端：不提供导出、渲染更轻 ----------
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await gotoRetry(page, ROOT + '/admin');
    await waitFor(page, () => !!document.querySelector('.list-toolbar'), { timeout: 15000 });
    await sleep(1500);
    const mobileList = await page.evaluate(() => {
      const exportBtn = [...document.querySelectorAll('.list-toolbar button')].find((b) => /导出表格/.test(b.textContent))
      const row = document.querySelector('.reminder-row')
      const surface = document.querySelector('.surface')
      const cs = row ? getComputedStyle(row) : null
      return {
        exportVisible: exportBtn ? exportBtn.offsetParent !== null : false,
        exportExists: !!exportBtn,
        rowShadow: cs ? cs.boxShadow : 'no-row',
        rowTransition: cs ? cs.transitionProperty : '',
        rowBlur: cs ? (cs.backdropFilter || cs.webkitBackdropFilter || 'none') : 'none',
        surfaceShadow: surface ? getComputedStyle(surface).boxShadow : '',
        tapHighlight: cs ? (getComputedStyle(document.body).webkitTapHighlightColor || '') : '',
      }
    });
    check('手机端隐藏「导出表格」', mobileList.exportExists === true && mobileList.exportVisible === false, JSON.stringify(mobileList).slice(0, 160));
    if (mobileList.rowShadow !== 'no-row') {
      check('手机端列表行不再用大模糊阴影', mobileList.rowShadow === 'none', mobileList.rowShadow);
      check('手机端行的过渡不再用 all（避免滚动中重排）', !/all/.test(mobileList.rowTransition), mobileList.rowTransition);
    } else {
      check('手机端列表行渲染更轻（本页没有行，跳过）', true);
    }

    const framesMobile = await measureFrames(page);
    console.log(`    手机端帧间隔：p50=${framesMobile.p50}ms p95=${framesMobile.p95}ms p99=${framesMobile.max}ms（样本 ${framesMobile.n}）`);
    check('手机端滚动帧间隔中位数在 25ms 以内（约 40fps 以上）', framesMobile.p50 <= 25,
      `p50=${framesMobile.p50}ms p95=${framesMobile.p95}ms`);

    // 日历页的「导出本月」同样隐藏
    await gotoRetry(page, ROOT + '/admin/calendar');
    await sleep(2000);
    const calExport = await page.evaluate(() => {
      const url = location.pathname
      if (url.includes('calendar')) {
        const btn = [...document.querySelectorAll('button')].find((b) => /导出本月/.test(b.textContent))
        return { redirected: false, exists: !!btn, visible: btn ? btn.offsetParent !== null : false }
      }
      return { redirected: true }
    });
    if (calExport.redirected) {
      check('手机端进不了日历（0.11.0 起的设计），导出自然也没有', true);
    } else {
      check('手机端日历页隐藏「导出本月」', calExport.exists === true && calExport.visible === false, JSON.stringify(calExport));
    }

    // 电脑端照旧有导出
    await page.setViewport({ width: 1440, height: 900 });
    await gotoRetry(page, ROOT + '/admin/all');
    await waitFor(page, () => !!document.querySelector('.list-toolbar'), { timeout: 15000 });
    await sleep(1200);
    const desktopExport = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.list-toolbar button')].find((b) => /导出表格/.test(b.textContent))
      return btn ? btn.offsetParent !== null : false
    });
    check('电脑端仍然有「导出表格」', desktopExport === true);

    // ---------- 6. 安卓壳子：登录页只显示「服务器设置」文字 ----------
    await page.evaluateOnNewDocument(() => {
      window.__shellOpened = 0
      window.AndroidShell = {
        getServerUrl: () => 'http://192.168.3.201:8906',
        getAppVersion: () => '0.1.0',
        openServerSettings: () => { window.__shellOpened += 1 },
        reload: () => {},
      }
    })
    // 壳子里的登录页同样要先登出才看得到（守卫会把已登录的人送回工作台）
    const shellKeep = await openLoginForm(page, BASE);
    const shellEntry = await page.evaluate(() => {
      const entry = document.querySelector('[data-server-entry]')
      return {
        exists: !!entry,
        text: entry ? entry.innerText.replace(/\s+/g, ' ').trim() : '',
        showsUrl: /https?:\/\//.test(entry ? entry.innerText : ''),
        hasUrlNode: !!document.querySelector('[data-server-url]'),
      }
    });
    check('壳子里登录页有「服务器设置」入口', shellEntry.exists === true, JSON.stringify(shellEntry));
    check('入口只有文字、不再显示服务器地址', shellEntry.text === '服务器设置' && shellEntry.showsUrl === false && shellEntry.hasUrlNode === false, JSON.stringify(shellEntry));
    await page.evaluate(() => document.querySelector('[data-server-edit]').click());
    await sleep(400);
    const opened = await page.evaluate(() => window.__shellOpened);
    check('点「服务器设置」会弹出原生地址输入', opened === 1, String(opened));
    await page.screenshot({ path: path.join(SHOTS, 'login-server-text.png') });
    await page.evaluateOnNewDocument(() => { delete window.AndroidShell; });
    await restoreToken(page, shellKeep);

    console.log(`  截图：${path.join(SHOTS, 'install-card.png')} / login-server-text.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
