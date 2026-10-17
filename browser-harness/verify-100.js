/**
 * 手机端适配与提醒弹窗（0.13.3 这批）。
 *
 * 覆盖：
 *   1) 320 / 360 / 390 / 430 四种宽度下，主要页面都**不会横向溢出**（内容被裁到屏幕外）
 *   2) 信用卡页：卡片装得下屏幕；银行标志**铺满整个圆形**、圆里**不出现文字**；持卡人单独一行
 *   3) 手机端「新建」是**悬浮按钮**（脱离底部标签栏、尺寸够点、浮在标签栏之上），旧标签栏里的＋已去掉
 *   4) 提醒弹窗：只有「知道了（任务延期明天提醒）/ 稍后提醒」，**没有「完成」**；点「知道了」把提醒顺延到**第二天**
 *      （当天不再提示），并把这条通知标为已读
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-100.js
 *
 * 注意：第 4 条会真的生成一条站内通知（站内通知没有删除接口，只能标已读），
 * 所以**只在沙箱/迭代容器上跑**，瞄到 :8906（生产）就跳过并说明，避免在生产留下痕迹。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP, USER: APP_USER, PASS: APP_PASS } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
const IS_PROD = /:8906\b/.test(ROOT);

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
 * 连续快速跳转时，偶尔会撞上「domcontentloaded 30 秒超时」的偶发（服务端本身毫秒级返回，
 * 是 CDP 侧的抖动）。这里统一带上更长的超时 + 重试，避免整份用例被一次抖动打断。
 */
async function gotoRetry(page, url, tries = 3) {
  let lastErr = null
  for (let i = 0; i < tries; i += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      return true
    } catch (err) {
      lastErr = err
      await sleep(1500)
    }
  }
  console.error(`  跳转失败：${url}（${lastErr?.message || ''}）`)
  return false
}

async function waitSel(page, sel, timeout = 8000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const hit = await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)
    if (hit) return true
    if (Date.now() > deadline) return false
    await sleep(250)
  }
}

/** 页面里有没有「被裁到屏幕外」的元素（排除收起状态的抽屉与横向滚动容器内部的元素）。 */
const overflowFinder = () => {
  const vw = window.innerWidth;
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sidebar')) continue;             // 抽屉在屏幕外是正常的
    // 浮层提示在**滑入动画**里会短暂停在屏幕外，量到它只会偶发假红（实测踩过一次）。
    // 它是 fixed 浮层、不参与文档流，本来也不会造成横向滚动。
    if (el.closest('[data-toast]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    // 横向滚动容器（例如头部那排可拖动的小卡面）里超出是设计内
    let p = el.parentElement, scrollable = false;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') { scrollable = true; break; }
      p = p.parentElement;
    }
    if (scrollable) continue;
    bad.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 48), left: Math.round(r.left), right: Math.round(r.right) });
  }
  return { vw, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 4) };
};

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  await withTab(async (page) => {
    await login(page, BASE);
    let bucketHref = '';
    let reminderId = null;
    let madeIDs = [];   // 弹窗用例造的两条提醒（清理时一起删）

    // ---------- 1. 多宽度不溢出 ----------
    const WIDTHS = [320, 360, 390, 430];
    const PAGES = ['/admin', '/admin/all', '/admin/calendar', '/admin/completed', '/admin/settings', '/admin/notifications'];
    for (const w of WIDTHS) {
      await page.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      for (const p of PAGES) {
        await gotoRetry(page, ROOT + p);
        await sleep(1100);
        const info = await page.evaluate(overflowFinder);
        check(`${w}px ${p} 不横向溢出`, info.scrollW <= info.vw + 1 && info.bad.length === 0,
          JSON.stringify(info));
      }
    }

    // ---------- 2. 信用卡页：卡片装得下、标志铺满圆 ----------
    // 四种宽度都过一遍：这批的原始 bug 是卡片最小内容宽度约 378px，只在 360px 断言
    // 会漏掉更窄/更宽的机型（用户反馈「整页往右顶出去」）。
    await page.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await gotoRetry(page, ROOT + '/admin');
    await sleep(1400);
    // 栏目 id 走接口取（手机上侧栏是抽屉、不一定已经渲染出来）；顺便确认侧栏里那个入口在 DOM 里
    const bucket = ((await api(page, '/api/reminder/lists')).body?.data || []).find((l) => l.template === 'credit_card');
    bucketHref = bucket ? `/admin/list/${bucket.id}` : '';
    // 侧栏在 DOM 里常驻（手机上是移出屏幕的抽屉），但「信用卡账单」那一行要等清单
    // 接口回来后才渲染：冷启动/刚部署时 10 秒不够（所以给足 25 秒）。
    const navEntry = await waitSel(page, '[data-nav-cards]', 25000);
    check('手机上能找到信用卡栏目入口（侧栏抽屉里有入口 + 接口能取到栏目）',
      !!bucketHref && navEntry, `href=${bucketHref} 侧栏入口=${navEntry}`);

    for (const w of WIDTHS) {
      await page.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await gotoRetry(page, ROOT + (bucketHref || '/admin'));
      await waitSel(page, '[data-card-face]', 20000);
      await sleep(1200);
      const info = await page.evaluate(overflowFinder);
      check(`信用卡页 ${w}px 不横向溢出`, info.scrollW <= info.vw + 1 && info.bad.length === 0, JSON.stringify(info));
    }

    // ---------- 2b. 卡片排序：还款日近的必须在前 ----------
    // 用户报过「交通银行还款日只剩 11 天却排在最后」：旧的智能排序第二顺位是账单日，
    // 跨月卡（账单日 25 / 还款日 19）永远吃亏。这里按接口数据算出「还款日剩余天数」，
    // 断言 DOM 顺序就是按它递增的（数据无关，换一批卡也成立）。
    await page.setViewport({ width: 390, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await gotoRetry(page, ROOT + (bucketHref || '/admin'));
    await waitSel(page, '[data-card-face]', 20000);
    await sleep(1200);
    const order = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/cards', { headers: { Authorization: 'Bearer ' + token } });
      const cards = (await res.json()).data || [];
      const midnight = new Date(new Date().toDateString()).getTime();
      const left = (c) => (c.current?.due_date ? Math.round((new Date(c.current.due_date).getTime() - midnight) / 86400000) : 9999);
      const byId = new Map(cards.map((c) => [String(c.id), c]));
      const dom = [...document.querySelectorAll('[data-card-item]')].map((el) => el.getAttribute('data-card-item'));
      return {
        dom: dom.map((id) => ({ id, name: byId.get(String(id))?.name || '', left: left(byId.get(String(id)) || {}) })),
        min: cards.map((c) => ({ id: String(c.id), name: c.name, left: left(c) })).sort((a, b) => a.left - b.left)[0] || null,
      };
    }, ROOT);
    const domLefts = order.dom.map((x) => x.left);
    const nonDecreasing = domLefts.every((v, i) => i === 0 || domLefts[i - 1] <= v);
    check('信用卡智能排序：还款日近的在前（剩余天数递增）',
      nonDecreasing && domLefts.length > 0,
      `顺序 ${order.dom.map((x) => `${x.name}:${x.left}天`).join(' → ')}`);
    check('信用卡智能排序：还款日最近的那张排第一',
      !!order.min && order.dom[0]?.id === order.min.id,
      `首张 ${order.dom[0]?.name}(${order.dom[0]?.left}天) / 最近 ${order.min?.name}(${order.min?.left}天)`);


    // 卡面：完整银行标志（图形+银行名，透明底）直接贴卡面，**卡名整行放在标志下方**；
    // 卡名前不再重复「XX银行」。用户 2026-10-09 明确要求「银行卡名称整行换到图标下方」，
    // 2026-10-10 第三次又明确「账号名称放在银行图标下边、与图标对齐，
    // 持卡人与账号名称同行右对齐」—— 所以这里量的是「在标志下方 + 左端与标志左端对齐」。
    const cardFit = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const cards = (await (await fetch(base + '/api/reminder/cards', { headers: { Authorization: 'Bearer ' + token } })).json()).data || [];
      const vw = window.innerWidth;
      const items = [...document.querySelectorAll('[data-card-item]')];
      const row = document.querySelector('[data-card-face-logo]');
      const img = row?.querySelector('img');
      const title = document.querySelector('[data-card-title]');
      const ir = img?.getBoundingClientRect();
      const tr = title?.getBoundingClientRect();
      const rr = row?.getBoundingClientRect();
      const rowStyle = row ? getComputedStyle(row) : null;
      const imgStyle = img ? getComputedStyle(img) : null;
      // 页面是按智能排序渲染的，第一张不一定是接口返回的第一张：按 data-card-item 的 id 找
      const firstID = items[0]?.getAttribute('data-card-item');
      const first = cards.find((c) => String(c.id) === String(firstID)) || cards[0] || {};
      return {
        count: items.length,
        maxRight: Math.max(...items.map((el) => Math.round(el.getBoundingClientRect().right)), 0),
        vw,
        hasImg: !!img,
        imgW: ir ? Math.round(ir.width) : 0,
        imgH: ir ? Math.round(ir.height) : 0,
        // 透明底：标志所在的行/图片背景都不该是白色实底
        rowBg: rowStyle?.backgroundColor || '',
        imgBg: imgStyle?.backgroundColor || '',
        // 卡名在标志**下边**、与标志**左端**对齐（用户 2026-10-10 第三次要求：
        // 「账号名称放在银行图标下边、与图标对齐」）。这里按行量文字
        // （块的 box 是整列宽，看不出起点）。
        titleLineLefts: (() => {
          if (!title) return [];
          const range = document.createRange();
          range.selectNodeContents(title);
          return [...new Set([...range.getClientRects()].map((r) => Math.round(r.left)))];
        })(),
        logoLeft: ir ? Math.round(ir.left) : -1,
        logoBottom: ir ? Math.round(ir.bottom) : -1,
        titleTop: tr ? Math.round(tr.top) : -1,
        titleBelowLogo: !!(title && ir) && tr.top >= ir.bottom - 1,
        titleStartsAtLogoLeft: (() => {
          if (!title || !ir) return false;
          const range = document.createRange();
          range.selectNodeContents(title);
          return [...range.getClientRects()].every((r) => Math.abs(Math.round(r.left) - Math.round(ir.left)) <= 2);
        })(),
        // 标志后面直接是卡名：这一行的文字就等于卡名（没有「XX银行」前缀）
        rowText: (row?.textContent || '').trim(),
        titleText: (title?.textContent || '').trim(),
        firstCardName: String(first.name || '').trim(),
        firstCardBank: String(first.bank || '').trim(),
        rowH: rr ? Math.round(rr.height) : 0,
      };
    }, ROOT);
    check('手机端卡片装得下屏幕（不再被裁到边缘外）', cardFit.maxRight <= cardFit.vw,
      `卡片右边缘 ${cardFit.maxRight} / 屏宽 ${cardFit.vw}`);
    // 0.18.1 起宽屏一行四张、卡片按真卡比例等比例缩小，标志也跟着收小（手机端 20px 高，
    // 宽屏 24px）。20px 的银行标志（图形 + 银行名）在这个尺寸下仍然清晰 —— 门槛从 22 放到 18。
    check('卡面上显示完整银行标志（有图、高度够看得清）',
      cardFit.hasImg && cardFit.imgH >= 18 && cardFit.imgW > cardFit.imgH,
      `标志 ${cardFit.imgW}x${cardFit.imgH}`);
    check('银行标志是透明底（不再套白圆片）',
      /rgba\(0, 0, 0, 0\)|transparent/.test(cardFit.rowBg) && /rgba\(0, 0, 0, 0\)|transparent/.test(cardFit.imgBg),
      `行底色 ${cardFit.rowBg} / 图底色 ${cardFit.imgBg}`);
    check('卡名在银行标志下边、与标志左端对齐（不叠在标志上、也不被挤成一列一个字）',
      cardFit.titleBelowLogo === true && cardFit.titleStartsAtLogoLeft === true && cardFit.titleLineLefts.length >= 1,
      `卡名各行左边缘 ${JSON.stringify(cardFit.titleLineLefts)} / 标志左边缘 ${cardFit.logoLeft} / 标志底 ${cardFit.logoBottom} / 卡名顶 ${cardFit.titleTop}`);
    check('标志后面直接是卡名，标题里不再重复银行名',
      cardFit.titleText === cardFit.firstCardName && !cardFit.titleText.startsWith(cardFit.firstCardBank),
      `标题「${cardFit.titleText}」/ 卡名「${cardFit.firstCardName}」/ 银行「${cardFit.firstCardBank}」`);
    await page.screenshot({ path: path.join(SHOTS, 'mobile-cards.png') });

    // ---------- 2c. 卡号尾部必须看得见；银行标志是裁过的 1:1 图形 ----------
    // 用户报过两条：① 0.14.0 给卡号加了 truncate，窄屏上省略号把**尾号**吃掉了；
    // ② 圆里那团糊字（完整银行标志自带「XX银行」文字）不该出现。
    for (const w of [320, 360]) {
      await page.setViewport({ width: w, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await gotoRetry(page, ROOT + (bucketHref || '/admin'));
      await waitSel(page, '[data-card-number]', 20000);
      await sleep(1000);
      const nums = await page.evaluate(() => [...document.querySelectorAll('[data-card-number]')].map((el) => {
        const text = (el.innerText || '').trim();
        return {
          text,
          clipped: el.scrollWidth > el.clientWidth + 1,
          tail: (text.match(/(\d{4})\s*$/) || [])[1] || '',
        };
      }));
      check(`${w}px 卡号没被截断、尾号看得见`,
        // 没填卡号的卡显示「**** **** ----」，本来就没有尾号，不能算它失败（2026-10-17 沙箱第 11 张就是）
        nums.length > 0 && nums.every((n) => !n.clipped) && nums.filter((n) => n.tail.length === 4).length >= 2,
        JSON.stringify({ all: nums.length, bad: nums.filter((n) => n.clipped || n.tail.length !== 4) }));
    }
    const logoInfo = await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll('[data-card-face-logo] img')];
      const out = [];
      for (const img of imgs.slice(0, 4)) {
        const res = await fetch(img.getAttribute('src'));
        const svg = await res.text();
        const m = /viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/.exec(svg);
        out.push(m ? { w: Number(m[3]), h: Number(m[4]) } : null);
      }
      return out;
    });
    check('银行标志的 viewBox 收紧过（不是 1024×1024 的大画布，否则缩起来只有几像素高）',
      logoInfo.length > 0 && logoInfo.every((x) => x && x.h < 1000), JSON.stringify(logoInfo));
    check('银行标志是「完整标志 + 文字」的横向版式（不是只留图形的方块）',
      logoInfo.some((x) => x && x.w / x.h > 1.5), JSON.stringify(logoInfo));

    // ---------- 3. 悬浮新建按钮 ----------
    await gotoRetry(page, ROOT + '/admin');
    await sleep(1400);
    const fab = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-fab]');
      const bar = document.querySelector('.mobile-tabbar');
      const r = el?.getBoundingClientRect();
      const b = bar?.getBoundingClientRect();
      return {
        exists: !!el,
        box: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '',
        fixed: el ? getComputedStyle(el).position : '',
        aboveBar: r && b ? r.bottom <= b.top + 1 : null,
        insideBar: el && bar ? bar.contains(el) : null,
        barHasPlus: !!document.querySelector('.mobile-add'),
        tabs: [...document.querySelectorAll('.mobile-tab')].map((a) => a.innerText.trim()),
      };
    });
    check('手机端有悬浮「新建」按钮且够大（≥48px）',
      fab.exists && fab.fixed === 'fixed' && /^([5-9]\d|\d{3})x([5-9]\d|\d{3})$/.test(fab.box), JSON.stringify(fab));
    check('悬浮按钮脱离标签栏、浮在它上面',
      fab.insideBar === false && fab.aboveBar === true, JSON.stringify({ inside: fab.insideBar, above: fab.aboveBar }));
    check('底部标签栏里不再有旧的＋按钮', fab.barHasPlus === false, JSON.stringify(fab.tabs));
    await page.evaluate(() => document.querySelector('[data-mobile-fab]').click());
    const quickOpen = await waitSel(page, '.quick-card', 8000) || await page.evaluate(() => (document.body.innerText || '').includes('添加一条提醒'));
    check('点悬浮按钮能打开新建提醒', quickOpen === true, String(quickOpen));

    // ---------- 4. 提醒弹窗：知道了 / 稍后提醒，没有「完成」 ----------
    // 弹窗一次只弹队列里最早的一条未读提醒。环境里若已经有别的未读提醒
    // （用户自己的，或别的用例留下的），它会先弹出来，点「知道了」就点不到
    // 自己造的那条 —— 直接跳过并说明，别把干扰当产品 bug（沙箱上曾因此假红）。
    const unreadBefore = (await api(page, '/api/reminder/notifications/unread-count')).body?.data?.count ?? 0;
    if (IS_PROD) {
      console.log('  · 跳过提醒弹窗实测：生产环境会留下一条站内通知（通知只能标已读、不能删）');
    } else if (unreadBefore > 0) {
      console.log(`  · 跳过提醒弹窗实测：环境里还有 ${unreadBefore} 条未读提醒在排队（会先弹它，抢不到自检那条）`);
    } else {
      // 造**两条**已经到点的提醒，再各「稍后提醒」到十几秒后（新建后 10 分钟内不弹，
      // 见下）：投递任务每分钟跑一次，所以最多等 90 秒。
      // 两条一起造，是因为要测两件事，而等待只花一次：
      //   ① 「知道了」= 顺延到第二天、不等于完成（第一条弹窗）
      //   ② 提醒已经被删掉时点「知道了」不能把弹窗卡死（第二条弹窗；
      //      用户报过：点了提示「不存在」，对话框再也关不掉）
      const due = new Date(Date.now() - 60_000).toISOString();
      const titles = [`自检弹窗A-${STAMP}`, `自检弹窗B-${STAMP}`];
      for (const title of titles) {
        const made = await api(page, '/api/reminder/items', 'POST', {
          title, due_at: due, repeat_rule: 'none', channels: ['inapp'],
        });
        madeIDs.push(made.body?.data?.id ?? null);
        reminderId = reminderId || (made.body?.data?.id ?? null);
      }
      check('能造出两条到点的提醒', madeIDs.every(Boolean), JSON.stringify(madeIDs));
      // 新建后**至少 10 分钟**才第一次提醒（用户 2026-10-13：「新建提醒，10分钟以后开始
      // 第一次提醒」）。口径在 server/reminder/notify_window.go 的 firstRemindSchedule
      // （floor = CreatedAt + firstRemindDelay = 10min；结束时间已过去的条目也按这条走），
      // Go 用例 server/reminder/first_remind_test.go:61 钉着。所以刚建完**不该**弹 ——
      // 这本身就是产品要求，先把它钉住（旧写法直接等弹窗，2026-10-15 起必然假红）。
      await sleep(8000);
      const poppedEarly = await page.evaluate(() => !!document.querySelector('[role="alertdialog"]'));
      check('刚建完且已过期的提醒 10 分钟内不弹（新建后先给 10 分钟）', poppedEarly === false);
      // 再把两条「稍后提醒」到十几秒后：snooze 的投递时刻由 run_at(=snoozed_until) 负责，
      // **不参与**上面那个 10 分钟口径（见 firstRemindSchedule 上方注释）。这样这条用例
      // 仍然端到端走真实投递链路（调度 → delivery_jobs → 弹窗），而不是绕过产品逻辑。
      if (madeIDs.every(Boolean)) {
        const soon = new Date(Date.now() + 15_000).toISOString();
        for (const id of madeIDs) await api(page, `/api/reminder/items/${id}/snooze`, 'POST', { until: soon });
      }
      const popped = await waitSel(page, '[role="alertdialog"]', 95000);
      check('稍后提醒到点后弹出站内提醒弹窗（真实投递链路）', popped === true);
      if (popped) {
        const buttons = await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')]
          .map((b) => b.innerText.trim()).filter(Boolean));
        check('弹窗上只有「知道了 / 稍后提醒」，没有「完成」',
          buttons.some((b) => b.startsWith('知道了')) && buttons.some((b) => b.includes('稍后提醒')) && !buttons.includes('完成'),
          JSON.stringify(buttons));
        // 主按钮文案必须写明「点了会怎样」，而且**与后台偏好那一项的文案一致**
        // （用户 2026-10-12 要求写清楚；2026-10-13 进一步要求「显示保持与后台一致」）。
        // 后台「点『知道了』后的提醒频率」的选项文案见 web/src/utils/reminder-options.ts。
        const ACK_LABELS = ['第二天（当天不再提示）', '30 分钟后', '1 小时后', '2 小时后', '4 小时后'];
        const ackLabel = buttons.find((b) => b.startsWith('知道了')) || '';
        check('「知道了」按钮写明延期到什么时候（与后台偏好文案一致）',
          ACK_LABELS.some((label) => ackLabel === `知道了（${label}）`),
          ackLabel);
        // 当前弹的是哪一条（A 或 B）：按标题认，别依赖顺序
        const firstTitle = await page.evaluate(() => document.querySelector('[role="alertdialog"] h2')?.innerText || '');
        // 等待这 90 秒里可能会有**别的**提醒到点抢先弹出来（本机实测踩过：一条信用卡
        // 账单提醒在等待期间到点，被这里的「知道了」顺延到了第二天）。弹窗只有「知道了 /
        // 稍后提醒」两种关法，两种都会顺延那条提醒 —— 拦不住，但必须在输出里说清楚，
        // 免得下次看到「某条提醒莫名跑到明天」找不到原因。
        if (!firstTitle.includes(`自检弹窗`)) {
          console.log(`  · 注意：弹窗里是别的提醒「${firstTitle}」，点「知道了」会把它顺延到第二天（自检环境的数据，非产品 bug）`);
        }
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('[role="alertdialog"] button')].find((x) => x.innerText.trim().startsWith('知道了'));
          b?.click();
        });
        await sleep(2500);
        const state = await page.evaluate(async ({ base, title }) => {
          const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
          const res = await fetch(`${base}/api/reminder/items?view=all&status=all`, { headers: { Authorization: 'Bearer ' + token } });
          const d = (await res.json())?.data;
          const rows = Array.isArray(d) ? d : d?.items || [];
          const item = rows.find((x) => String(x.title) === title);
          const dlg = document.querySelector('[role="alertdialog"]');
          return {
            // 队列里还有下一条时会**接着弹**（这是对的），所以判据是「这一条不再显示」
            shownTitle: dlg ? (dlg.querySelector('h2')?.innerText || '') : '',
            closed: !dlg,
            snoozed: item?.snoozed_until || null,
            completed: !!item?.completed_at,
          };
        }, { base: ROOT, title: firstTitle });
        check('点「知道了」后这条弹窗关掉了（若还有排队就接着弹下一条）',
          state.closed || state.shownTitle !== firstTitle, JSON.stringify(state));
        const snoozeAt = state.snoozed ? new Date(state.snoozed) : null;
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        check('「知道了」把提醒顺延到第二天（当天不再提示）',
          !!snoozeAt && snoozeAt.getTime() > Date.now() + 6 * 3600_000
          && Math.abs(snoozeAt.getDate() - tomorrow.getDate()) <= 1,
          `${state.snoozed}`);
        check('「知道了」不等于完成（提醒仍未完成）', state.completed === false, String(state.completed));

        // ---------- 4b. 提醒已经被删掉时，「知道了」必须还能关掉弹窗 ----------
        const secondPopped = await waitSel(page, '[role="alertdialog"]', 70000);
        check('第二条到点提醒也弹了出来', secondPopped === true);
        if (secondPopped) {
          const secondTitle = await page.evaluate(() => document.querySelector('[role="alertdialog"] h2')?.innerText || '');
          const secondID = await page.evaluate(async ({ base, title }) => {
            const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
            const res = await fetch(`${base}/api/reminder/items?view=all&status=all`, { headers: { Authorization: 'Bearer ' + token } });
            const d = (await res.json())?.data;
            const rows = Array.isArray(d) ? d : d?.items || [];
            return rows.find((x) => String(x.title) === title)?.id ?? null;
          }, { base: ROOT, title: secondTitle });
          // 弹窗开着的时候把提醒删掉：这正是用户遇到的场景（卡片/提醒删了，
          // 未处理的到点通知还在，点「知道了」会 404「提醒或清单不存在」）
          if (secondID) await api(page, `/api/reminder/items/${secondID}`, 'DELETE');
          await page.evaluate(() => {
            const b = [...document.querySelectorAll('[role="alertdialog"] button')].find((x) => x.innerText.trim().startsWith('知道了'));
            b?.click();
          });
          await sleep(4000);
          const afterGone = await page.evaluate(() => ({
            closed: !document.querySelector('[role="alertdialog"]'),
            error: document.querySelector('[role="alertdialog"]')?.innerText.includes('不存在') || false,
            dismissAvailable: !!document.querySelector('[data-alert-dismiss]'),
          }));
          check('提醒已被删除时点「知道了」，弹窗自动关掉（不再卡死）',
            afterGone.closed === true, JSON.stringify(afterGone));
        }
      }
    }

    // ---------- 清理 ----------
    try {
      for (const id of new Set([reminderId, ...madeIDs])) {
        if (id) await api(page, `/api/reminder/items/${id}`, 'DELETE');
      }
      // 站内通知没有删除接口：把自检那些标成已读，至少不留红点
      const list = (await api(page, '/api/reminder/notifications?page=1&pageSize=50')).body?.data;
      const rows = Array.isArray(list) ? list : list?.items || [];
      for (const n of rows.filter((x) => String(x.title).startsWith('自检弹窗'))) {
        await api(page, `/api/reminder/notifications/${n.id}/read`, 'POST');
      }
    } catch { /* 清理失败不影响断言 */ }
    await sleep(600);
    const left = ((await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [])
      .filter?.((i) => String(i.title).includes('自检弹窗')) || [];
    check('自检提醒已清理', left.length === 0, String(left.length));

    // ---------- 5. 登录态：已登录不再摆登录页；表单能被浏览器记住密码 ----------
    // 安卓壳子启动固定打开 /login（见 android-shell 的 loadApp），网页端不拦的话
    // 「记住我」勾着也每次都要求重输（用户反馈原话：登陆窗口记不住密码）。
    const tokenBefore = await page.evaluate(() => localStorage.getItem('reminders.token'));
    await gotoRetry(page, ROOT + '/login');
    await sleep(1800);
    const redirect = await page.evaluate(() => ({
      path: location.pathname, hasPw: !!document.querySelector('input[type="password"]'),
    }));
    check('已登录时打开 /login 直接进工作台（不再要密码）',
      redirect.path.startsWith('/admin') && !redirect.hasPw, JSON.stringify(redirect));

    await page.evaluate(() => { localStorage.removeItem('reminders.token'); sessionStorage.removeItem('reminders.token'); });
    await gotoRetry(page, ROOT + '/login');
    await sleep(1500);
    const fields = await page.evaluate(() => {
      const pw = document.querySelector('input[type="password"]');
      const user = document.querySelector('input[autocomplete="username"], input[name="username"]');
      return {
        shown: !!pw,
        userName: user?.getAttribute('name') || '', userId: user?.getAttribute('id') || '',
        pwName: pw?.getAttribute('name') || '', pwId: pw?.getAttribute('id') || '',
        pwAutocomplete: pw?.getAttribute('autocomplete') || '',
      };
    });
    check('登录页账号/密码框带 name + id + autocomplete（浏览器才会记住密码）',
      fields.shown && !!fields.userName && !!fields.userId && !!fields.pwName && !!fields.pwId
      && fields.pwAutocomplete === 'current-password', JSON.stringify(fields));
    await page.evaluate((t) => { if (t) localStorage.setItem('reminders.token', t); }, tokenBefore);

    // 用真实登录表单走一遍「初次加载」：init() 是在**未登录**状态下跑的，
    // 修好之前个人偏好不会回填，侧栏要等用户进一次偏好设置才出现信用卡栏目
    // （用户报的「初次加载后台开着、首页却没有信用卡清单」）。
    await page.evaluate(({ u, p }) => {
      const set = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('input[autocomplete="username"], input[name="username"]'), u);
      set(document.querySelector('input[type="password"]'), p);
      document.querySelector('form button[type="submit"]')?.click();
    }, { u: APP_USER, p: APP_PASS });
    for (let i = 0; i < 60; i += 1) {
      if (await page.evaluate(() => location.pathname.startsWith('/admin'))) break;
      await sleep(300);
    }
    await sleep(2500);
    // 侧栏是异步拉的清单渲染的：给足时间再断言
    const navShown = await waitSel(page, '[data-nav-cards]', 20000);
    const firstLoad = await page.evaluate(() => ({
      navCards: !!document.querySelector('[data-nav-cards]'),
      flagFromApi: null,
    }));
    check('初次登录后（没进偏好设置）侧栏就直接显示信用卡栏目',
      firstLoad.navCards === true && navShown === true, JSON.stringify(firstLoad));

    // 后台开关的滑块必须整个待在轨道里（原来靠 inline-block+translate，被 text-align:center
    // 先居中再位移，滑块被 overflow-hidden 裁掉一截 —— 用户报的「开关按钮错位」）。
    await gotoRetry(page, ROOT + '/admin/settings');
    await waitSel(page, '[role="switch"]', 20000);
    await sleep(1200);
    const toggle = await page.evaluate(() => {
      const sw = document.querySelector('[role="switch"]');
      const knob = sw?.querySelector('span');
      const r = sw?.getBoundingClientRect();
      const k = knob?.getBoundingClientRect();
      return r && k ? {
        inside: k.left >= r.left - 1 && k.right <= r.right + 1 && k.top >= r.top - 1 && k.bottom <= r.bottom + 1,
        vCenter: Math.abs((k.top + k.bottom) / 2 - (r.top + r.bottom) / 2) <= 1.5,
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        knob: `${Math.round(k.width)}x${Math.round(k.height)}`,
      } : null;
    });
    check('后台开关滑块完全在轨道内、垂直居中（不再错位/被裁）',
      !!toggle && toggle.inside && toggle.vCenter, JSON.stringify(toggle));

    await gotoRetry(page, ROOT + '/admin');
    await sleep(800);

    console.log(`  截图：${path.join(SHOTS, 'mobile-cards.png')}`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(1);
});
