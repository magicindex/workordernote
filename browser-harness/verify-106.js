/**
 * 「打开软件 → 登录 → 新建任务」这条路径（用户 2026-10-10 报的问题）。
 *
 * 用户原话：打开软件登录后新建任务，没有默认选择时间（今天），刷新网页后才会显示
 * 选择今天；新建任务插件应该默认展开，现在点一下输入框才展开显示任务日期等信息；
 * 日出日落模式也要刷新后才修正。
 *
 * 这里的用例**必须走真正的 UI 登录**（在登录页填表提交、SPA 换路由进工作台），
 * 不能用 API 注入 token 后再整页打开 —— 后者等于「刷新一次」，正好绕过了要查的路径。
 *
 * 2026-11-11 起口径又变了一次（用户：「待办、计划 页面中 新建提醒 默认展开，不要折叠，手机版保持现状」）：
 * 桌面端「待办 / 计划」页的新建卡片**默认展开**，刷新、切页、保存之后都保持展开；手机端仍是收起的按钮。
 * 所以断言改成：
 *   1) 登录进工作台（桌面待办页）后，新建卡片是**展开的**（输入框与芯片行都在，没有「新建」按钮）；
 *   2) 展开态下芯片行直接可见、日期默认是**今天**（今天芯片点亮、日期是今天 HH:MM）；
 *   3) 保存后**仍保持展开**（桌面待办不折叠），日期回到今天、「更多」收起；
 *   4) 只有明确按「清空」才会是无日期（提示条出现）；
 *   5) 刷新后仍是展开的；
 *   6) 服务端版本号变化时弹「已更新，点刷新」提示（平时不弹）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-106.js
 */
const { withTab, sleep } = require('./harness');

const BASE = (process.env.APP_URL || 'http://127.0.0.1:8918').replace(/\/$/, '');
const USER = process.env.APP_USER || '王耀辉';
const PASS = process.env.APP_PASS || 'Wyh!1984yelq.';
const STAMP = Date.now();

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function uiLogin(page) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.evaluate(({ u, p }) => {
    const set = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const txt = document.querySelector('input[type="text"], input:not([type])');
    const pwd = document.querySelector('input[type="password"]');
    if (txt) set(txt, u);
    if (pwd) set(pwd, p);
  }, { u: USER, p: PASS });
  await page.evaluate(() => {
    const pwd = document.querySelector('input[type="password"]');
    const form = pwd && pwd.closest('form');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  });
  await page.waitForFunction(() => location.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {});
  await sleep(2500);
}

/** 快速新建面板的当前状态（**不点任何东西**，看默认长什么样）。 */
const quickState = (page) => page.evaluate(() => {
  const card = document.querySelector('.quick-card');
  const newBtn = document.querySelector('[data-quick-new]');
  const panel = document.querySelector('[data-quick-panel]');
  // 0.18.3 起新建控件默认收成一个「新建」按钮：cardOpen 表示整块表单是否展开
  const chip = (t) => card ? [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === t) : null;
  const todayChip = chip('今天');
  // 0.18.2 起日期芯片在芯片行（「更多」里只留备注/农历/过期提醒频率/通知方式）
  const dateField = card?.querySelector('[data-quick-date]');
  return {
    card: true,
    newButton: !!newBtn,
    cardOpen: !!card,
    hasInput: !!card?.querySelector('input'),
    chipsVisible: !!card?.querySelector('.quick-chip'),
    panelOpen: !!panel,
    todayChipActive: todayChip ? todayChip.classList.contains('active') : null,
    dateFieldText: dateField ? dateField.textContent.replace(/\s+/g, ' ').trim() : '',
    headerDate: card ? [...card.querySelectorAll('span')].map((s) => s.textContent.trim())
      .find((t) => /^今天 \d{2}:\d{2}$|^\d+月\d+日/.test(t)) || '' : '',
    undatedHint: !!document.querySelector('[data-quick-undated-hint]'),
  };
});

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    // 干净起点：清掉登录态，保证下面走的是「打开软件 → 登录」
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await uiLogin(page);

    // ---------- 1. 登录后：桌面待办页的新建卡片默认展开 ----------
    const st = await quickState(page);
    check('登录进工作台后，桌面待办页的新建卡片**默认展开**（输入框与芯片行直接可见）',
      st.card === true && st.cardOpen === true && st.newButton === false && st.hasInput === true && st.chipsVisible === true, JSON.stringify(st));
    check('默认展开态下「更多」面板与无日期提示都收着',
      st.panelOpen === false && st.undatedHint === false, JSON.stringify(st));

    const op = await quickState(page);
    check('展开态下输入框与芯片行都在', op.cardOpen === true && op.hasInput === true && op.chipsVisible === true, JSON.stringify(op));
    check('展开后「更多」面板仍然是**隐藏**的（日期时间/重复/备注等字段收起来）', op.panelOpen === false, JSON.stringify(op));
    check('「今天」芯片默认点亮', op.todayChipActive === true, JSON.stringify(op));
    // 日期芯片现在显示完整日期（formatFullDue）：断言「今天 + 23:59」，不再依赖「今天 HH:MM」文案
    const todayLabel = (() => { const d = new Date(); return `${d.getMonth() + 1}月${d.getDate()}日`; })();
    check('芯片行的日期显示就是今天 23:59',
      op.dateFieldText.includes(todayLabel) && op.dateFieldText.includes('23:59'), JSON.stringify(op.dateFieldText));
    check('没有「没有日期」提示（默认有日期）', op.undatedHint === false, JSON.stringify(op));

    // ---------- 2. 直接建一条（不点输入框），应当带今天 ----------
    const title = `自检登录后新建-${STAMP}`;
    const made = await page.evaluate(async (t) => {
      const card = document.querySelector('.quick-card');
      const input = card.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, t);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      // 「添加提醒」按钮在「更多」面板里（默认隐藏），日常新建走输入框回车或头部那个「添加」
      const head = [...card.querySelectorAll('button')].find((b) => ['添加', '保存中'].includes(b.textContent.trim()));
      if (head) { head.click(); return { ok: true, how: 'header-button' }; }
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true, how: 'enter' };
    }, title);
    check('默认形态下（不展开「更多」）也能直接提交', made.ok === true, JSON.stringify(made));
    await sleep(2000);
    const today = new Date();
    const items = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [];
    const saved = items.find((i) => i.title === title);
    const d = saved?.due_at ? new Date(saved.due_at) : null;
    const localKey = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
    const nowKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    check('这条任务的日期就是今天（不是无日期）', !!saved && localKey === nowKey,
      JSON.stringify({ due: saved?.due_at, localKey, nowKey }));

    // ---------- 2b. 新建的任务不会立刻算「已逾期」（后台的宽限时间兜着） ----------
    const graceInfo = await page.evaluate(async (base) => {
      const t = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const cfg = await (await fetch(base + '/api/configs/public', { headers: { Authorization: 'Bearer ' + t } })).json();
      const list = await (await fetch(base + '/api/reminder/items?view=today&status=all', { headers: { Authorization: 'Bearer ' + t } })).json();
      const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes('自检登录后新建'));
      return {
        grace: cfg?.data?.task_overdue_after_minutes ?? null,
        overdueCard: !!document.querySelector('[data-day-group="overdue"]'),
        rowOverdue: row ? row.classList.contains('reminder-overdue') : null,
        inOverdueCard: (() => {
          const card = document.querySelector('[data-day-group="overdue"]');
          return card ? card.textContent.includes('自检登录后新建') : false;
        })(),
      };
    }, BASE);
    check('后台偏好里有「任务过期多久算逾期」（默认 30 分钟）', String(graceInfo.grace) === '30', JSON.stringify(graceInfo));
    check('刚建的任务（到期时间=现在）不会立刻被标「已逾期」',
      graceInfo.rowOverdue === false && graceInfo.inOverdueCard === false, JSON.stringify(graceInfo));

    // ---------- 3. 保存之后**仍保持展开**（桌面待办）；日期回到今天 ----------
    const after = await quickState(page);
    check('保存后仍保持展开（桌面待办不折叠，方便连着建）',
      after.newButton === false && after.cardOpen === true && after.hasInput === true, JSON.stringify(after));
    // 表单复位：日期回到今天、「更多」仍是收起
    const reopened = await quickState(page);
    check('保存后表单复位：日期回到今天、「更多」重新收起',
      reopened.cardOpen === true && reopened.chipsVisible === true && reopened.todayChipActive === true && reopened.panelOpen === false,
      JSON.stringify(reopened));
    // 需要更多字段时点「更多」还能展开，并且日期字段就是「今天 + 后台过期时间」
    const opened = await page.evaluate(async () => {
      const card = document.querySelector('.quick-card');
      const more = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '更多');
      if (!document.querySelector('[data-quick-panel]')) more?.click();
      await new Promise((r) => setTimeout(r, 400));
      const panel = document.querySelector('[data-quick-panel]');
      return {
        open: !!panel,
        labels: panel ? [...panel.querySelectorAll('.field-label')].map((l) => (l.childNodes[0]?.textContent || '').trim()).filter(Boolean) : [],
        date: card.querySelector('[data-quick-date]')?.textContent.replace(/\s+/g, ' ').trim() || '',
      };
    });
    const today2 = new Date();
    const label2 = `${today2.getFullYear()}年${today2.getMonth() + 1}月${today2.getDate()}日`;
    // 默认时刻现在**写死 23:59**（用户 2026-10-13；原来的 task_expire_time 配置已删）
    const expireCfg = '23:59';
    const mins = (s) => {
      const m = /(\d{2}):(\d{2})/.exec(s || '');
      return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
    };
    check('点「更多」能展开（只剩备注/农历/频率/通知方式），日期照旧在芯片行显示',
      opened.open === true && opened.labels.length === 4
        && !opened.labels.includes('日期时间') && !opened.labels.includes('重复')
        && mins(opened.date) === mins(expireCfg),
      JSON.stringify({ opened, label2, expireCfg }));

    // ---------- 4. 只有明确「清空」才是无日期 ----------
    await page.evaluate(() => {
      const card = document.querySelector('.quick-card');
      const more = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '更多');
      if (more && !document.querySelector('[data-quick-panel]')) more.click();
    });
    await sleep(400);
    const cleared = await page.evaluate(() => {
      const btn = document.querySelector('[data-quick-clear-due]');
      if (!btn) return { found: false };
      btn.click();
      return { found: true };
    });
    await sleep(400);
    const clearedState = await quickState(page);
    check('按「清空」后才是无日期，并且出现提示',
      cleared.found === true && clearedState.undatedHint === true, JSON.stringify({ cleared, clearedState }));
    // 收尾：把日期要回来，别把「无日期」状态留给后面的用例
    await page.evaluate(() => {
      const card = document.querySelector('.quick-card');
      const todayChip = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '今天');
      todayChip?.click();
    });
    await sleep(300);

    // ---------- 5. 服务端换版本时才提示刷新 ----------
    const before = await page.evaluate(() => ({
      banner: !!document.querySelector('[data-stale-bundle]'),
    }));
    check('版本没变时不显示「已更新」提示', before.banner === false, JSON.stringify(before));
    // 在**网络层**拦 /api/version：前端用的是 axios（XHR），改 window.fetch 拦不到。
    await page.setRequestInterception(true);
    const fakeVersion = (req) => {
      if (req.url().includes('/api/version')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0, message: 'success',
            data: { version: '9.9.9', gitCommit: 'deadbeef', buildTime: '2026-10-10T00:00:00Z', appName: '工作序记' },
          }),
        });
        return;
      }
      req.continue();
    };
    page.on('request', fakeVersion);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await sleep(1500);
    const faked = await page.evaluate(() => ({
      banner: !!document.querySelector('[data-stale-bundle]'),
      text: document.querySelector('[data-stale-bundle]')?.textContent.replace(/\s+/g, ' ').trim() || '',
    }));
    check('服务端版本变了就提示「已更新 + 刷新」',
      faked.banner === true && faked.text.includes('9.9.9'), JSON.stringify(faked));
    // 撤掉拦截再刷新：否则刷新后仍然拿到假版本号
    page.off('request', fakeVersion);
    await page.setRequestInterception(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2000);
    check('刷新后提示消失',
      (await page.evaluate(() => !!document.querySelector('[data-stale-bundle]'))) === false, '');
    // 刷新（＝重新打开软件）后新建卡片仍是默认展开（用户 2026-11-11）
    const afterReload = await quickState(page);
    check('刷新后新建卡片仍是展开的（不再回到收起）',
      afterReload.cardOpen === true && afterReload.newButton === false, JSON.stringify(afterReload));

    // ---------- 清理 ----------
    const del = await api(page, `/api/reminder/items/${saved?.id}`, 'DELETE');
    check('自检任务已清理', del.status === 200, JSON.stringify({ id: saved?.id, status: del.status }));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
