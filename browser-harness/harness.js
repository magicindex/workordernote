/**
 * 浏览器测试统一入口。
 *
 * 默认浏览器 = 飞牛应用商店安装的 fygo-browser（Chrome 152），它常驻一个
 * 带 CDP 的有头实例：
 *   二进制: /vol1/@appcenter/fygo-browser/app/vendor/runtime/usr/lib/chromium/chromium
 *   CDP   : http://127.0.0.1:16003   （--remote-debugging-address=127.0.0.1）
 *   配置  : /vol1/@appdata/fygo-browser/{profile,cache,config}
 *
 * 为什么用它而不是容器里的 headless：
 *   - 它是本机唯一的浏览器，也是你自己看到的那一个，版本最新（152 vs 容器 124），
 *     渲染、字体、点击命中都与你实际所见一致；
 *   - CDP 只监听 127.0.0.1，所以调用方容器必须用 --network host。
 *
 * 安全约定（务必遵守）：只 newPage() 开自己的标签页，测完 page.close()，
 * 绝不 browser.close()——那会关掉你正在用的浏览器。
 *
 * 覆盖默认值：环境变量 BROWSER_CDP_URL。
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { spawn } = require('child_process');

const DEFAULT_CDP = process.env.BROWSER_CDP_URL || 'http://127.0.0.1:16003';

// 飞牛商店那个浏览器；CDP 端口不通时用它把浏览器拉起来。
const CHROME_BIN = process.env.BROWSER_BIN ||
  '/vol1/@appcenter/fygo-browser/app/vendor/runtime/usr/lib/chromium/chromium';
// 自动拉起时用独立 profile，避免和在跑的商店实例抢同一份用户数据
// （Chrome 的 SingletonLock 会让第二个实例直接退出）。
//
// 注意：profile 路径必须是纯 ASCII。放在含中文的目录（如 …/编程开发/…）下时，
// Chrome 的 localStorage 会「写进去读得到、几百毫秒后消失」——落盘静默失败，
// 表现为登录态永远存不住、页面反复回到登录页。这个坑排查了很久，别再踩。
const CHROME_PROFILE = process.env.BROWSER_PROFILE ||
  '/vol1/@apphome/fn-deepseek-harness/dsh-browser-profile';
// 自动拉起时用**另一个端口**，绝不占用商店应用自己的 16003：
// 否则等用户在应用中心启动浏览器时，会因为这个端口被占而启动失败。
const DEBUG_PORT = process.env.BROWSER_PORT || '16099';
const FALLBACK_CDP = `http://127.0.0.1:${DEBUG_PORT}`;

// 该内核是应用自带 bundle，必须带它的 runtime 库目录，否则报
// libopenh264.so.7: cannot open shared object file。
const RUNTIME_ROOT = process.env.BROWSER_RUNTIME ||
  '/vol1/@appcenter/fygo-browser/app/vendor/runtime';
const RUNTIME_LIB_PATH = [
  `${RUNTIME_ROOT}/usr/lib/x86_64-linux-gnu`,
  `${RUNTIME_ROOT}/lib/x86_64-linux-gnu`,
  `${RUNTIME_ROOT}/usr/lib`,
].join(':');

async function isCdpUp(url = DEFAULT_CDP, timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url + '/json/version', { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 确保有浏览器可用：
 *   1. 商店应用的 CDP（默认 16003）通 → 直接用它，不动任何东西；
 *   2. 不通 → 用同一个内核 + 独立 profile + 另一个端口（16099）拉起一个兜底实例。
 *      这样既不抢占应用的端口，也不会和它的用户数据抢 SingletonLock。
 * 返回 { started, cdpUrl, pid?, headed?, log? }，调用方应使用返回的 cdpUrl。
 *
 * 前提：脚本要跑在能读到浏览器内核的机器上（即宿主机）。塞进容器跑时，
 * 容器既看不到 /vol1/@appcenter 也起不了宿主进程，会抛出明确错误。
 */
async function ensureBrowser() {
  if (await isCdpUp(DEFAULT_CDP)) return { started: false, cdpUrl: DEFAULT_CDP };
  if (!fs.existsSync(CHROME_BIN)) {
    throw new Error(
      `CDP ${DEFAULT_CDP} 不通，且找不到浏览器内核 ${CHROME_BIN}。` +
      `若脚本跑在容器里，请改到宿主机上执行（容器无法启动宿主机进程）。`);
  }
  // 已经有一个兜底实例在跑就直接复用
  if (await isCdpUp(FALLBACK_CDP)) {
    return { started: false, cdpUrl: FALLBACK_CDP, log: `（复用兜底实例 ${FALLBACK_CDP}）` };
  }
  // 这个内核是飞牛商店应用自带的 bundle，直接跑会因为找不到自带动态库报
  // libopenh264.so.7 之类的错，必须把它的 runtime 库目录加进 LD_LIBRARY_PATH。
  const env = { ...process.env, LD_LIBRARY_PATH: RUNTIME_LIB_PATH +
    (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') };
  // 有显示服务才是"有头"；没有（比如纯 SSH）就退回 headless=new，但仍然用同一个内核。
  const headed = !!process.env.DISPLAY;
  const args = [
    `--user-data-dir=${CHROME_PROFILE}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--password-store=basic',
    '--use-mock-keychain',
    '--window-position=0,0',
    '--start-maximized',
    ...(headed ? [] : ['--headless=new']),
    'about:blank',
  ];
  const child = spawn(CHROME_BIN, args, { detached: true, stdio: 'ignore', env });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await isCdpUp(FALLBACK_CDP)) {
      return {
        started: true, cdpUrl: FALLBACK_CDP, pid: child.pid, headed,
        log: `商店浏览器未运行，已用同一内核在 ${FALLBACK_CDP} 拉起兜底实例 pid=${child.pid}（${headed ? '有头' : '无显示服务，headless'}）`,
      };
    }
  }
  throw new Error(`已拉起兜底浏览器（pid ${child.pid}）但 ${FALLBACK_CDP} 仍未就绪`);
}

/**
 * 轮询等待条件成立。刻意不用 page.waitForFunction：它依赖注入脚本轮询，
 * 在部分环境下（干净 profile / 严格 CSP）会卡住不返回，而 evaluate 轮询可控。
 */
async function waitFor(page, fn, { timeout = 15000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (await page.evaluate(fn)) return true;
    } catch { /* 页面切换中，忽略这一次 */ }
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

async function connect(cdpUrl) {
  const status = await ensureBrowser();
  // 没显式指定就连 ensureBrowser 实际可用的那个（应用实例或兜底实例）
  const target = cdpUrl || status.cdpUrl || DEFAULT_CDP;
  if (status.log) console.log(status.log);
  const browser = await puppeteer.connect({ browserURL: target, defaultViewport: null });
  return browser;
}

/**
 * 开一个受控标签页跑测试，结束后必定关掉它。
 * @param {(page, ctx) => Promise<any>} fn
 * @param {{cdpUrl?: string, width?: number, height?: number, onConsole?: boolean}} opts
 */
async function withTab(fn, opts = {}) {
  // cdpUrl 不传就让 connect 自己决定（商店实例优先，否则用兜底实例）
  const { cdpUrl, width = 1440, height = 900, onConsole = true } = opts;
  const browser = await connect(cdpUrl);
  const page = await browser.newPage();
  const errors = [];
  try {
    await page.setViewport({ width, height });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    if (onConsole) {
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push('console: ' + m.text());
      });
    }
    const result = await fn(page, { browser, errors, cdpUrl, width, height });
    return result;
  } finally {
    try { await page.close(); } catch { /* 标签页可能已被测试自身关闭 */ }
    browser.disconnect(); // 只断开，不关闭浏览器
  }
}

/**
 * 列表页「N 项」的条数。
 * 兼容两种写法：老版是一个 h2「N 项」，新版工具栏把数字与单位拆成两个 span
 * （.list-toolbar-count > .count-number + .count-unit）。改版工具栏时用例不用跟着改。
 */
async function listCount(page) {
  return page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((e) => /^\s*\d+\s*项\s*$/.test(e.textContent || ''));
    if (h) return parseInt((h.textContent || '').replace(/\D/g, ''), 10);
    const n = document.querySelector('.list-toolbar-count .count-number')?.textContent?.trim() || '';
    return /^\d+$/.test(n) ? parseInt(n, 10) : null;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等到页面上出现满足条件的按钮（按文本匹配）。 */
async function waitForButton(page, text, timeout = 20000) {
  return page.waitForFunction(
    (t) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(t)),
    { timeout },
    text,
  );
}

/** 按文本点按钮，返回是否点到。 */
async function clickButtonByText(page, text) {
  return page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
}

/** 页面里是否还存在含指定文本的标题元素（用于判断弹窗是否关闭）。 */
async function hasHeading(page, text) {
  return page.evaluate((t) => !![...document.querySelectorAll('h3')].find((e) => e.textContent.includes(t)), text);
}

module.exports = {
  listCount,
  DEFAULT_CDP,
  CHROME_BIN,
  connect,
  ensureBrowser,
  isCdpUp,
  withTab,
  sleep,
  waitFor,
  waitForButton,
  clickButtonByText,
  hasHeading,
};
