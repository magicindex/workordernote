/**
 * 「工作序记」的浏览器测试辅助：登录 + 打开某个页面。
 * 与 harness.js 配合使用，默认走商店的 fygo-browser。
 */
const { sleep, waitFor } = require('./harness');

const APP = process.env.APP_URL || 'http://192.168.3.201:8906';
const USER = process.env.APP_USER || '王耀辉';
const PASS = process.env.APP_PASS || 'Wyh!1984yelq.';

// 前端把登录态存在这个键下（见 web/src/utils/storage-keys.ts）
const TOKEN_KEY = 'reminders.token';

/**
 * 直接调 API 拿 token 再写进浏览器 localStorage，绕开 UI 登录。
 *
 * 为什么优先用这条：UI 登录要先渲染表单、填值、提交、等路由切换，
 * 在无显示服务的兜底实例上步骤多且不稳；而登录接口本身很稳。
 */
async function loginViaApi(page, base = APP) {
  // 登录接口在「公开接口」限流窗口里（默认 20 次/分钟，见 server 的 -rate-limit）。
  // 一轮回归跑下来登录几十次，很容易撞上 429——不重试的话表现为「token 拿不到，
  // 后面所有断言都莫名其妙地失败」。所以这里等窗口过去再试几次。
  let json = null;
  let status = 0;
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch(base.replace(/\/$/, '') + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    status = res.status;
    json = await res.json().catch(() => null);
    const t = json && json.data && json.data.token;
    if (t) break;
    // 429 就等窗口；其它错误也别立刻放弃（网络抖动）
    await sleep(6000 * (i + 1));
  }
  const token = json && json.data && json.data.token;
  if (!token) throw new Error(`API 登录失败（${status}）: ` + JSON.stringify(json).slice(0, 140));

  // 测试实例上把「默认首页」固定成列表视图：0.27.0 起默认是「首页」看板，而绝大多数套件
  // 都假设 `goto('/admin')` 落在**今天**页（快捷新建、日期芯片、按天卡片……）。改偏好比改
  // 几十个套件的导航靠谱；要看默认落地行为的套件（verify-ux / verify-120）自己改再还原。
  try {
    await fetch(base.replace(/\/$/, '') + '/api/configs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ key: 'default_view', value: 'list' }),
    });
  } catch { /* 只是让回归稳定，失败不拦 */ }
  // 必须先落到同源页面，才能写它的 localStorage
  await page.goto(base.replace(/\/$/, '') + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((t) => { try { localStorage.setItem('reminders.token', t); } catch {} }, token);
  return token;
}

async function login(page, base = APP) {
  // 优先走 API 注入
  try {
    await loginViaApi(page, base);
    await page.goto(base.replace(/\/$/, '') + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ok = await waitFor(page, () => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('版本信息')),
      { timeout: 20000 });
    if (ok) return true;
  } catch { /* 落到下面的 UI 登录 */ }

  // 用 domcontentloaded 而不是 networkidle2：这个应用常驻一条 SSE 长连接，
  // 在干净 profile 上 networkidle2 可能一直等不到「空闲」而超时。
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 等首屏定型：要么是登录表单，要么已经是登录后的侧栏
  const firstScreen = () => !!document.querySelector('input[type="password"]')
    || [...document.querySelectorAll('button')].some((b) => b.textContent.includes('版本信息'));
  await waitFor(page, firstScreen, { timeout: 25000 });
  if (!(await page.evaluate(() => !!document.querySelector('input[type="password"]')))) {
    return false; // 已有登录态
  }
  // 全程用 evaluate 操作，不用 page.$/page.type：在没有显示服务的兜底实例上
  // 这两个 API 会挂住（evaluate 正常）。直接给 input 赋值 Vue 感知不到，
  // 所以走原生 setter + 派发 input 事件。
  await page.evaluate(({ user, pass }) => {
    const setValue = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const txt = document.querySelector('input[type="text"], input:not([type])');
    const pwd = document.querySelector('input[type="password"]');
    if (txt) setValue(txt, user);
    if (pwd) setValue(pwd, pass);
  }, { user: USER, pass: PASS });
  // 提交必须「不等待」：这次 evaluate 会引发页面跳转，导航把执行上下文销毁后
  // 该 Promise 可能永远不 settle，await 就会卡死。
  void page.evaluate(() => {
    const pwd = document.querySelector('input[type="password"]');
    const form = pwd && pwd.closest('form');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }).catch(() => {});
  await sleep(2500);
  // 登录后 SPA 换路由，等侧栏出来再继续
  await waitFor(page, () => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('版本信息')),
    { timeout: 20000 });
  return true;
}

/** 打开应用内某个路径并等页面定型（替代 networkidle2）。 */
async function open(page, path, settleMs = 2000) {
  await page.goto(String(APP).replace(/\/$/, '') + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(settleMs);
}

/**
 * 以「未登录访客」的身份打开登录页，返回原来的 token（调用方可自行恢复）。
 *
 * 为什么必须清 token：0.14.0 起路由有「已登录访问 /login 就回工作台」的守卫
 * （修的是「安卓壳子启动固定开 /login，于是每次都要求重输密码」），不清就看不到登录表单。
 * 这也更贴近真实场景——真实用户只在没登录时才会看到登录页。
 */
async function openLoginForm(page, base = APP) {
  await page.goto(String(base).replace(/\/$/, '') + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const prev = await page.evaluate(() => {
    const t = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
    localStorage.removeItem('reminders.token');
    sessionStorage.removeItem('reminders.token');
    return t;
  }).catch(() => null);
  await page.goto(String(base).replace(/\/$/, '') + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitFor(page, () => !!document.querySelector('input[type="password"]'), { timeout: 20000 });
  return prev;
}

/** 把 openLoginForm 清掉的 token 放回去（后续断言还要用登录态调接口）。 */
async function restoreToken(page, token) {
  if (!token) return;
  await page.evaluate((t) => { try { localStorage.setItem('reminders.token', t); } catch {} }, token);
}

/**
 * 展开「新建」窗口。
 *
 * 0.18.3 起新建控件**默认收成一个「新建」按钮**（`[data-quick-new]`），点一下才展开出
 * `.quick-card`；刷新/切页都会收回。所以任何要操作快速新建的用例，先调这个函数。
 *
 * 写成「`.quick-card` 在就直接返回」的形式：在还没有这个按钮的旧版本（≤0.18.2）
 * 上同样可用 —— 那时窗口本来就是展开的，函数什么都不用做。
 */
async function openQuickAdd(page, tries = 20) {
  for (let i = 0; i < tries; i += 1) {
    const state = await page.evaluate(() => ({
      card: !!document.querySelector('.quick-card'),
      btn: !!document.querySelector('[data-quick-new]'),
    })).catch(() => ({ card: false, btn: false }));
    if (state.card) return true;
    if (!state.btn) { await sleep(250); continue; }
    await page.evaluate(() => document.querySelector('[data-quick-new]')?.click());
    await sleep(400);
  }
  return false;
}

module.exports = { APP, USER, PASS, TOKEN_KEY, loginViaApi, login, open, openLoginForm, restoreToken, openQuickAdd };
