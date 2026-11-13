/**
 * 这一批（0.15.4 后的 5 条用户反馈）：
 *   1) 【bug】「今天 / 明天 / 本周末」芯片原来是 toggle，再点一次会把日期清空，
 *      任务存成「无日期」→ 今天页找不到、全部里显示无日期（用户报的就是这条）。
 *      现在芯片只负责选中：连点两次仍然是今天；清空要按专门的「清空」按钮，
 *      并且会看到「这条没有日期」的提示。
 *   2) **新建任务卡片**（不是「更多」面板）带登录页那套流光边框（.flow-frame）。
 *   3) 信用卡卡面：银行标志单独一行在左上，**卡名在标志下边、与标志左端对齐**，
 *      持卡人与卡名同行、右对齐到卡面右边缘（0.18.3 起的排法）；卡名不按字断行。
 *   4) 记事本栏目里的记事显示「记于 X」而不是「无日期」。
 *   5) 列表按天分卡片：同一天的条目在同一个 data-day-group 卡片里。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-105.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();

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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}
async function waitSel(page, sel, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

const titles = {
  today: `自检今天芯片-${STAMP}`,
  clear: `自检清空日期-${STAMP}`,
  dayA: `自检当天A-${STAMP}`,
  dayB: `自检当天B-${STAMP}`,
  dayC: `自检明天C-${STAMP}`,
  note: `自检记事日期-${STAMP}`,
};
const createdIds = [];

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, BASE);
    await gotoRetry(page, BASE + '/admin');
    // 新建控件默认收成一个「新建」按钮（0.18.3 起）：先点开
    await openQuickAdd(page);
    // 等首屏渲染完再操作：domcontentloaded 时 Vue 还没把快速新建画出来
    await waitSel(page, '.quick-card input', 20000);
    await sleep(800);

    // ---------- 1. 芯片不再清空日期 ----------
    const chipFlow = await page.evaluate(async (title) => {
      const clickText = (txt) => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === txt);
        if (!btn) throw new Error('找不到按钮：' + txt);
        btn.click();
        return true;
      };
      // 芯片行只在输入框获得焦点（或已有标题）时出现 —— 先点一下输入框
      const input0 = document.querySelector('.quick-card input')
        || [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('添加一条'));
      if (!input0) throw new Error('找不到快速新建输入框');
      input0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      input0.focus();
      await new Promise((r) => setTimeout(r, 300));
      const panel = () => document.querySelector('[data-quick-panel]');
      // 0.18.2 起日期芯片在**芯片行**；2026-11-12 起它只写「选择日期」、默认不亮，
      // 所以「选中了哪一天」只能看芯片（今天/明天/本周末）的 active 状态。
      const chipOn = (t) => {
        const b = [...document.querySelectorAll('.quick-chip')].find((x) => (x.textContent || '').trim() === t);
        return b ? b.classList.contains('active') : false;
      };
      const dateText = () => document.querySelector('[data-quick-date]')?.textContent.trim() || '';
      // 「更多」面板在 0.16.3 起默认展开；它是 toggle，收起时才需要点（点两下会收起来）
      if (!panel()) clickText('更多');
      await new Promise((r) => setTimeout(r, 400));
      const first = (() => { clickText('今天'); return chipOn('今天'); })();
      const second = (() => { clickText('今天'); return chipOn('今天'); })();
      // 用户 2026-11-13：「清空」按钮去掉（没有意义）—— 芯片只负责选中，日期永远有来源。
      const hasClear = !!document.querySelector('[data-quick-clear-due]');
      const dateTextAfterChips = dateText();
      const undatedHint = !!document.querySelector('[data-quick-undated-hint]');
      // 流光边框：0.18.3 起挂在**新建任务卡片**上（原来错挂在「更多」面板里）。
      // 卡片外面套了一层 .quick-shell 承载 .flow-frame/.flow-glow（卡片自己 overflow-hidden
      // 会把柔光裁掉），所以这里读 shell 的样式，「更多」面板则要求**没有**流光。
      const p2 = panel();
      const shell = document.querySelector('.quick-card')?.parentElement || null;
      const before = shell ? getComputedStyle(shell, '::before') : null;
      const after = shell ? getComputedStyle(shell, '::after') : null;
      const panelBefore = p2 ? getComputedStyle(p2, '::before') : null;
      const flow = shell && before ? {
        hasClass: shell.classList.contains('flow-frame'),
        glow: shell.classList.contains('flow-glow'),
        bg: before.backgroundImage.slice(0, 40),
        anim: before.animationName,
        // 柔光要在外壳上、而且外壳不能裁剪（卡片自己是 overflow-hidden，光放卡上就没了）
        glowContent: after ? after.content : '',
        glowFilter: after ? after.filter : '',
        shellOverflow: getComputedStyle(shell).overflow,
        cardInsideShell: !!document.querySelector('.quick-card'),
        panelHasClass: p2 ? p2.classList.contains('flow-frame') || p2.classList.contains('flow-glow') : null,
        panelAnim: panelBefore ? panelBefore.animationName : null,
      } : null;
      const input = document.querySelector('.quick-card input')
        || [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('添加一条'));
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, title);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 200));
      clickText('添加提醒');
      await new Promise((r) => setTimeout(r, 1500));
      return { first, second, hasClear, dateTextAfterChips, undatedHint, typed: !!input, flow };
    }, titles.today);
    check('「今天」芯片连点两次仍是今天（不再把日期清空）',
      chipFlow.first === true && chipFlow.second === true, JSON.stringify(chipFlow));
    check('「清空」按钮已去掉（2026-11-13 用户要求，日期不再能清成空）',
      chipFlow.hasClear === false, JSON.stringify(chipFlow));
    check('芯片行里日期芯片仍显示「选择日期」，也没有出现「无日期」提示',
      chipFlow.dateTextAfterChips === '选择日期' && chipFlow.undatedHint === false, JSON.stringify(chipFlow));

    const afterCreate = await api(page, '/api/reminder/items?view=all&status=all');
    const todayItem = (afterCreate.body?.data || []).find((i) => i.title === titles.today);
    if (todayItem) createdIds.push(todayItem.id);
    // 日期比较按**本地日期**：toISOString 是 UTC，晚上 8 点后中国的日期会差一天。
    const d = todayItem?.due_at ? new Date(todayItem.due_at) : null;
    const localKey = d
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : '';
    const nowKey = (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    })();
    check('新建的任务带上了今天（不再存成无日期）',
      !!todayItem && localKey === nowKey, JSON.stringify({ due: todayItem?.due_at, localKey, nowKey }));
    const todayView = await api(page, '/api/reminder/items?view=today&status=all');
    check('这条任务在「今天」视图里能查到',
      (todayView.body?.data || []).some((i) => i.title === titles.today),
      JSON.stringify(((todayView.body?.data) || []).map((i) => i.title).slice(0, 8)));

    // ---------- 2. 快速新建面板的流光边框（样式在面板展开时已经读出来了）----------
    const flow = chipFlow.flow;
    check('**新建任务卡片**带流光边框（与登录页同一个 .flow-frame）',
      !!flow && flow.hasClass && flow.glow && flow.cardInsideShell
        && /conic/.test(flow.bg) && flow.anim !== 'none',
      JSON.stringify(flow));
    check('卡片背后那团柔光也在、且外壳不裁剪（不会被 overflow 吃掉）',
      !!flow && flow.glowContent !== 'none' && /blur/.test(flow.glowFilter) && flow.shellOverflow === 'visible',
      JSON.stringify(flow));
    check('「更多」面板**不再**带流光（原来挂反了）',
      !!flow && flow.panelHasClass === false && flow.panelAnim === 'none',
      JSON.stringify(flow));

    // ---------- 3. 列表按天分卡片 ----------
    // 造三条：今天两条 + 明天一条，检查分组
    const mk = async (title, iso) => {
      const res = await api(page, '/api/reminder/items', 'POST', {
        title, kind: 'task', due_at: iso, repeat_rule: 'none', channels: ['inapp'],
      });
      const id = res.body?.data?.id;
      if (id) createdIds.push(id);
      return id;
    };
    const now = new Date();
    // 用「现在 + 偏移」而不是固定钟点：固定 09:00/11:00 在上午跑是未来、下午跑就成了
    // 逾期（0.16.5 起还有 30 分钟宽限），会把「同一天放一张卡」的断言带偏。
    // A/B 差 30 分钟 —— 除非正好跨零点，否则同一天；C 放到两天后，必定另一张卡。
    const at = (minutesFromNow) => new Date(now.getTime() + minutesFromNow * 60_000).toISOString();
    // 临近午夜时 now+90min 会跨到**明天**，A/B 就不再同一天（22:4x 跑过一次假红）。
    // 那种情况改用今天 00:30 / 01:00：两条仍然同一天，只是都会算逾期、被收进
    // 最前面的「已逾期」卡片 —— 下面第二组断言因此也接受 overdue 卡。
    const crossesMidnight = new Date(now.getTime() + 90 * 60_000).getDate() !== now.getDate();
    const todayAt = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString(); };
    await mk(titles.dayA, crossesMidnight ? todayAt(0, 30) : at(60));
    await mk(titles.dayB, crossesMidnight ? todayAt(1, 0) : at(90));
    await mk(titles.dayC, at(50 * 60));

    // 先在「今天」页确认**明天的条目不会漏进来**（跨偏移比较的回归点）
    await gotoRetry(page, BASE + '/admin');
    await waitSel(page, '[data-day-group]', 20000);
    await sleep(1200);
    const todayKeys = await page.evaluate(() => ({
      keys: [...document.querySelectorAll('[data-day-group]')].map((c) => c.getAttribute('data-day-group')),
      titles: [...document.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' ')),
    }));
    const todayLocalKey = (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    })();
    // 待办页口径 2026-10-16 起是「近 7 天」（原来只放「今天 + 逾期」）：明天那条**现在应该在**
    // 自己的日期分组里。这一条继续守着跨时区偏移的老毛病 —— 不能出现「今天 + 7 天」以外的分组
    // （左闭右开：今天到第 7 天，所以最远的合法分组 key 是今天 + 6 天）。
    const limitKey = (() => {
      const d = new Date(); d.setDate(d.getDate() + 6);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    check('「待办」页按新口径收近 7 天（明天那条在自己的分组里，且没有超出今天 +7 天的分组）',
      todayKeys.titles.some((t) => t.includes(titles.dayC))
        && !todayKeys.keys.some((k) => k !== 'overdue' && k > limitKey),
      JSON.stringify({ keys: todayKeys.keys, todayLocalKey, limitKey }));

    // 逾期条目：单独一张卡片、排在最前面（用户 2026-10-09 追加要求）
    const overdueInfo = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-day-group]')];
      const card = cards.find((c) => c.getAttribute('data-day-group') === 'overdue');
      if (!card) return { present: false, firstKey: cards[0]?.getAttribute('data-day-group') || '' };
      const rows = [...card.querySelectorAll('.reminder-row')];
      return {
        present: true,
        isFirst: cards[0] === card,
        head: card.querySelector('.day-card-head')?.textContent.replace(/\s+/g, ' ').trim() || '',
        // 逾期卡片里每行都必须是未完成的、带逾期样式
        allOverdue: rows.every((r) => r.classList.contains('reminder-overdue')),
        rows: rows.length,
      };
    });
    check('逾期条目单独合并成一张卡片、排在第一行',
      !overdueInfo.present || (overdueInfo.isFirst && overdueInfo.allOverdue && /已逾期/.test(overdueInfo.head)),
      JSON.stringify(overdueInfo));

    // 合并后的卡片里：行与行之间是横线（divide-y），行本身不再是小卡片
    const mergedLook = await page.evaluate(() => {
      const body = document.querySelector('[data-day-group] .day-card-body');
      const rows = [...(body?.querySelectorAll('.reminder-row') || [])];
      if (!body || rows.length < 1) return null;
      const cs = getComputedStyle(body);
      const rowCs = getComputedStyle(rows[0]);
      const rowBox = rows[0].getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      return {
        rows: rows.length,
        divideW: cs.borderTopWidth,          // divide-y 靠子元素的上边框实现
        childBorder: getComputedStyle(rows[rows.length - 1]).borderTopWidth,
        rowRadius: rowCs.borderRadius,
        rowBorder: rowCs.borderTopWidth,
        rowShadow: rowCs.boxShadow,
        // 行宽应与卡片内宽一致（不再各自留边框缩进）
        fullWidth: Math.abs(rowBox.width - bodyBox.width) <= 1,
      };
    });
    check('卡片内条目不再各自成卡（无圆角/边框/阴影），靠横线分隔',
      !!mergedLook && mergedLook.rowRadius === '0px' && mergedLook.rowBorder === '0px'
        && mergedLook.rowShadow === 'none' && mergedLook.fullWidth,
      JSON.stringify(mergedLook));

    // 分组要看「全部」页：那里同一天与不同天的条目都在一起
    await gotoRetry(page, BASE + '/admin/all');
    await waitSel(page, '[data-day-group]', 20000);
    await sleep(1500);
    const groups = await page.evaluate((ts) => {
      const todayKey = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const key = `${todayKey.getFullYear()}-${pad(todayKey.getMonth() + 1)}-${pad(todayKey.getDate())}`;
      const cards = [...document.querySelectorAll('[data-day-group]')];
      const hit = cards.find((c) => [...c.querySelectorAll('.reminder-row')].some((r) => r.textContent.includes(ts.dayA)));
      if (!hit) return { found: false, cardCount: cards.length };
      const rows = [...hit.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' '));
      return {
        found: true,
        key: hit.getAttribute('data-day-group'),
        expectedKey: key,
        head: hit.querySelector('.day-card-head')?.textContent.replace(/\s+/g, ' ').trim() || '',
        rows,
        hasA: rows.some((t) => t.includes(ts.dayA)),
        hasB: rows.some((t) => t.includes(ts.dayB)),
        hasC: rows.some((t) => t.includes(ts.dayC)),
        cardCount: cards.length,
      };
    }, titles);
    check('同一天的两条在同一张卡片里（另一天的没有混进来）',
      groups.found && groups.hasA && groups.hasB && !groups.hasC, JSON.stringify(groups));
    // 正常时段：A/B 在「今天」那张日期卡里；临近午夜（两条都被迫排到今天凌晨）时
    // 它们是逾期项，会在「已逾期」卡里 —— 两者都算「同一天同一张卡」，但绝不该是别的日期卡。
    const dayCardOk = groups.found && groups.key === groups.expectedKey && groups.key !== 'overdue'
      && /\d+月\d+日/.test(groups.head) && /条/.test(groups.head);
    const overdueCardOk = groups.found && groups.key === 'overdue';
    check('A/B 归到同一张卡片（今天那张日期卡；临近午夜时进「已逾期」卡也算）',
      dayCardOk || overdueCardOk,
      JSON.stringify({ key: groups.key, expected: groups.expectedKey, head: groups.head, crossesMidnight }));
    check('不同天的条目分在不同卡片（至少两张日卡片）', (groups.cardCount || 0) >= 2, JSON.stringify(groups));
    const dayCSeparate = await page.evaluate((t) => {
      const cards = [...document.querySelectorAll('[data-day-group]')];
      const hit = cards.find((c) => [...c.querySelectorAll('.reminder-row')].some((r) => r.textContent.includes(t)));
      if (!hit) return { found: false };
      return {
        found: true,
        key: hit.getAttribute('data-day-group'),
        rows: [...hit.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' ')),
      };
    }, titles.dayC);
    check('明天那条单独一组（没有和今天混在一张卡片里）',
      dayCSeparate.found && dayCSeparate.rows.every((t) => t.includes(titles.dayC) || !t.includes(titles.dayA)),
      JSON.stringify(dayCSeparate));

    // ---------- 4. 记事本：显示记录日期 ----------
    const noteRes = await api(page, '/api/reminder/items', 'POST', {
      title: titles.note, kind: 'note', repeat_rule: 'none', channels: ['inapp'],
    });
    const noteId = noteRes.body?.data?.id;
    if (noteId) createdIds.push(noteId);
    const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
    const bucket = lists.find((l) => l.template === 'notebook');
    await gotoRetry(page, BASE + `/admin/list/${bucket?.id}`);
    await waitSel(page, '.reminder-row', 20000);
    await sleep(1200);
    const noteRow = await page.evaluate((t) => {
      const row = [...document.querySelectorAll('.reminder-row')].find((r) => r.textContent.includes(t));
      return row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
    }, titles.note);
    check('记事本里的记事显示记录时间（不再是「无日期」）',
      /记于/.test(noteRow) && !/无日期/.test(noteRow), noteRow.slice(0, 120));
    check('记事本也按天分了卡片', (await page.evaluate(() => document.querySelectorAll('[data-day-group]').length)) >= 1, '');

    // ---------- 5. 信用卡卡面：标志与卡名各占一行 ----------
    const cardLists = lists.find((l) => l.template === 'credit_card') || null;
    if (cardLists) {
      await gotoRetry(page, BASE + `/admin/list/${cardLists.id}`);
      const hasFace = await waitSel(page, '[data-card-face]', 20000);
      await sleep(1000);
      // 按**行**量卡名（块级 box 是整列宽，看不出文字实际起点）：0.18.3 起卡名在标志
      // **下边**，每一行的左边缘都等于标志**左**边缘（上下同一竖列起点）。
      const face = await page.evaluate(() => {
        const el = document.querySelector('[data-card-face]');
        if (!el) return null;
        const logo = el.querySelector('[data-card-face-logo]');
        const title = el.querySelector('[data-card-title]');
        if (!logo || !title) return { missing: true };
        const l = logo.getBoundingClientRect();
        const ts = getComputedStyle(title);
        const range = document.createRange();
        range.selectNodeContents(title);
        const rects = [...range.getClientRects()];
        const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
        const lefts = [...new Set(rects.map((r) => Math.round(r.left)))];
        return {
          lines: tops.length,
          lefts,
          logoLeft: Math.round(l.left),
          logoBottom: Math.round(l.bottom),
          titleTop: Math.round(title.getBoundingClientRect().top),
          alignsToLogo: lefts.every((x) => Math.abs(x - Math.round(l.left)) <= 2),
          belowLogo: title.getBoundingClientRect().top >= l.bottom - 1,
          wordBreak: ts.wordBreak,
          titleText: title.textContent.trim(),
        };
      });
      check('卡名在银行标志下边、与标志左端对齐（同一竖列起点）',
        !!face && !face.missing && face.alignsToLogo && face.belowLogo,
        JSON.stringify(face));
      check('卡名不按字换行（word-break: keep-all）',
        !!face && !face.missing && face.wordBreak === 'keep-all', JSON.stringify(face));
      check('卡面仍然找得到（前面的信用卡用例没被破坏）', hasFace === true, String(hasFace));

      // 空间不够（很长的卡名）时换行：换下来的每一行都要与标志**右侧**对齐
      const longName = `自检长名卡-${STAMP}超长名称测试`;
      const madeCard = await api(page, '/api/reminder/cards', 'POST', {
        list_id: cardLists.id, name: longName, bank: '工商银行',
        no: '6222023456789012', statement_day: 5, due_day: 25,
      });
      const cardId = madeCard.body?.data?.id;
      check('能造一张长名字的临时卡片', !!cardId, JSON.stringify(madeCard.body).slice(0, 120));
      if (cardId) {
        await page.setViewport({ width: 360, height: 900 });
        await gotoRetry(page, BASE + `/admin/list/${cardLists.id}`);
        await waitSel(page, '[data-card-face]', 20000);
        await sleep(1200);
        const wrapped = await page.evaluate((title) => {
          const face = [...document.querySelectorAll('[data-card-face]')]
            .find((f) => f.querySelector('[data-card-title]')?.textContent.includes(title));
          if (!face) return { found: false };
          const logo = face.querySelector('[data-card-face-logo]');
          const el = face.querySelector('[data-card-title]');
          const l = logo.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = [...range.getClientRects()];
          const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
          const lefts = [...new Set(rects.map((r) => Math.round(r.left)))];
          return {
            found: true,
            lines: tops.length,
            lefts,
            logoLeft: Math.round(l.left),
            // 换行后每一行都从标志左边缘开始（与图标同一竖列起点）
            allAligned: lefts.every((x) => Math.abs(x - Math.round(l.left)) <= 2),
            // 整块卡名确实在标志**下面**（不是顶到标志上面）
            belowLogo: el.getBoundingClientRect().top >= l.bottom - 1,
          };
        }, longName.slice(0, 8));
        check('名字太长时换行，且每一行都从标志左端开始（与图标对齐）',
          wrapped.found && wrapped.lines >= 2 && wrapped.allAligned && wrapped.belowLogo,
          JSON.stringify(wrapped));
        // 清理临时卡片，并把视口恢复成桌面宽度
        const cleaned = await api(page, `/api/reminder/cards/${cardId}`, 'DELETE');
        check('长名字临时卡片已清理', cleaned.status === 200, String(cleaned.status));
        await page.setViewport({ width: 1280, height: 900 });
      }
      // 非银行的消费/信用付平台（支付宝 / 微信 / 京东金融）：标志本身认不出名字，
      // 图标右边要写出名字；银行仍然只有标志（用户 2026-10-17 报
      // 「京东金融只有京东图标、没有京东金融文字」）。
      const faceLabelOf = (cardId) => page.evaluate((id) => {
        const art = document.querySelector(`[data-card-item="${id}"]`);
        const logo = art?.querySelector('[data-card-face-logo]');
        const label = art?.querySelector('[data-card-face-label]');
        const img = logo?.querySelector('img');
        return {
          found: !!art,
          label: label ? label.textContent.trim() : '',
          besideIcon: !!(label && img && label.getBoundingClientRect().left >= img.getBoundingClientRect().right - 1),
        };
      }, cardId);
      const madeJd = await api(page, '/api/reminder/cards', 'POST', {
        list_id: cardLists.id, name: `自检京东卡-${STAMP}`, bank: '京东金融',
        no: '6225888877776666', statement_day: 6, due_day: 24,
      });
      const jdId = madeJd.body?.data?.id;
      const madeBank = await api(page, '/api/reminder/cards', 'POST', {
        list_id: cardLists.id, name: `自检银行卡-${STAMP}`, bank: '工商银行',
        no: '6222023456789123', statement_day: 7, due_day: 25,
      });
      const bankId = madeBank.body?.data?.id;
      check('能造「京东金融 + 银行」两张临时卡来验名字标签', !!jdId && !!bankId,
        JSON.stringify({ jdId, bankId }));
      if (jdId && bankId) {
        await gotoRetry(page, BASE + `/admin/list/${cardLists.id}`);
        await waitSel(page, '[data-card-face]', 20000);
        await sleep(1200);
        const jd = await faceLabelOf(jdId);
        const bank = await faceLabelOf(bankId);
        check('京东金融卡：图标右边写着「京东金融」',
          jd.found && jd.label === '京东金融' && jd.besideIcon, JSON.stringify(jd));
        check('银行卡面仍然只有标志、不写名字', bank.found && bank.label === '', JSON.stringify(bank));
        const c1 = await api(page, `/api/reminder/cards/${jdId}`, 'DELETE');
        const c2 = await api(page, `/api/reminder/cards/${bankId}`, 'DELETE');
        check('名字标签的临时卡片已清理', c1.status === 200 && c2.status === 200,
          JSON.stringify({ jd: c1.status, bank: c2.status }));
      }
    } else {
      check('信用卡栏目存在（跳过卡面断言）', false, '没找到 credit_card 清单');
    }

    // ---------- 清理 ----------
    let cleaned = 0;
    for (const id of createdIds) {
      const res = await api(page, `/api/reminder/items/${id}`, 'DELETE');
      if (res.status === 200) cleaned += 1;
    }
    check(`自检数据已清理（${cleaned}/${createdIds.length}）`, cleaned === createdIds.length,
      JSON.stringify(createdIds));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
