/**
 * 「工作序记」关键交互验收：用本机默认浏览器（飞哥商店的 fygo-browser，有头）跑。
 * 覆盖三件事：
 *   1. 版本信息弹窗能打开、也能关掉（此前关不掉）
 *   2. 日历里点编辑就地打开抽屉，不跳去列表页
 *   3. 日历任务字号设置生效（切到「特大」后任务条字号变大）
 */
const { withTab, sleep, clickButtonByText, hasHeading } = require('./harness');
const { login, APP } = require('./reminders-app');

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? '  ' + extra : ''}`);
}

withTab(async (page, ctx) => {
  console.log('浏览器:', ctx.cdpUrl, '| 视口:', ctx.width + 'x' + ctx.height);

  const didLogin = await login(page);
  console.log('登录:', didLogin ? '已登录' : '沿用已有会话', '| URL:', page.url());

  // ---------- 1. 版本信息弹窗 ----------
  console.log('\n[1] 版本信息弹窗');
  await clickButtonByText(page, '版本信息');
  await sleep(700);
  check('弹窗能打开', await hasHeading(page, '版本信息与迭代说明'));

  // 点右侧关闭按钮
  const clicked = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((e) => e.textContent.includes('版本信息与迭代说明'));
    let panel = h;
    while (panel && !String(panel.className).includes('max-w-2xl')) panel = panel.parentElement;
    const btn = panel && panel.querySelector('button');
    if (!btn) return null;
    btn.click();
    return true;
  });
  await sleep(900);
  const stillOpen = await hasHeading(page, '版本信息与迭代说明');
  check('点关闭按钮能关掉', clicked === true && !stillOpen, stillOpen ? '（仍开着）' : '');

  // 再开一次，点遮罩空白处也应关闭
  await clickButtonByText(page, '版本信息');
  await sleep(600);
  const opened2 = await hasHeading(page, '版本信息与迭代说明');
  await page.mouse.click(8, 8); // 左上角空白 = 遮罩
  await sleep(900);
  const closedByBackdrop = !(await hasHeading(page, '版本信息与迭代说明'));
  check('点遮罩能关掉', opened2 && closedByBackdrop, opened2 ? '' : '（第二次没打开）');

  // 迭代说明改版（用户 2026-10-17：「优化精简迭代说明，把相近内容的迭代信息合并」）
  await clickButtonByText(page, '版本信息');
  await sleep(800);
  const notes = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-release-note]')];
    const firstOpen = cards.find((el) => el.querySelector('[data-release-body]'));
    const closed = cards.find((el) => !el.querySelector('[data-release-body]'));
    return {
      themes: document.querySelectorAll('[data-version-theme]').length,
      firstTheme: document.querySelector('[data-version-theme]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      cards: cards.length,
      versions: cards.slice(0, 3).map((el) => el.getAttribute('data-release-version')),
      ranged: cards.map((el) => el.getAttribute('data-release-version')).filter((v) => String(v).includes(' – ')).length,
      openCount: cards.filter((el) => el.querySelector('[data-release-body]')).length,
      firstHasMore: !!firstOpen?.querySelector('[data-release-more]'),
      closedVersion: closed?.getAttribute('data-release-version') || '',
    };
  });
  const currentVersion = await page.evaluate(async () => {
    const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
    const res = await fetch('/api/version', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    const body = await res.json().catch(() => null);
    return String(body?.data?.version || '');
  });
  check('弹窗先给「迭代主线」', notes.themes >= 5 && notes.firstTheme.includes('起步'), JSON.stringify(notes).slice(0, 200));
  check('版本卡片按小版本合并，只差修正号的并成一张（带「起 – 止」）',
    notes.cards > 10 && notes.cards < 45 && notes.ranged >= 8, `卡片=${notes.cards} 合并=${notes.ranged}`);
  // 最新一版要跟当前版本对得上（以前写死 0.33.0，0.34.0 一发版就红）
  check('最新一版排在最前，且默认只展开前几张',
    notes.versions[0] === currentVersion && notes.openCount === 3,
    `首卡=${notes.versions[0]} 当前=${currentVersion} 展开=${notes.openCount}`);
  check('条目多的卡片先收 3 条，给「展开全部」', notes.firstHasMore === true, '');
  // 点一张收着的卡片，应该展开出条目
  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-release-note]')].find((el) => !el.querySelector('[data-release-body]'));
    if (!card) return false;
    card.querySelector('[data-release-toggle]')?.click();
    return !!card.getAttribute('data-release-version');
  });
  await sleep(400);
  const openedNow = await page.evaluate((version) => {
    const card = [...document.querySelectorAll('[data-release-note]')].find((el) => el.getAttribute('data-release-version') === version);
    return !!card?.querySelector('[data-release-body]');
  }, notes.closedVersion);
  check('点开了更早的一版，能读到它的条目', opened === true && openedNow === true, notes.closedVersion);
  await page.mouse.click(8, 8);
  await sleep(700);

  // ---------- 2. 日历里就地编辑 ----------
  console.log('\n[2] 日历就地编辑');
  await page.goto(APP + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2500);
  const cellCount = await page.evaluate(() => document.querySelectorAll('.cal-cell').length);
  check('日历渲染出格子', cellCount >= 28, `格子数=${cellCount}`);

  // 找一天有任务的，点行尾的「⋯」→ 菜单里的「修改」，打开编辑面板
  // （0.8.0 起行尾由铅笔换成 ⋯ 菜单，0.9.0 起编辑面板在日历里以居中弹窗呈现）
  //
  // 先**挑一个有任务的格子点开**：不能假设「今天一定有任务」——跨过零点之后
  // 今天可能恰好吃空，这时详情面板是空的、连 article 都没有（本用例就这么红过一次）。
  const pickedDay = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('.cal-cell')].find((c) => c.querySelector('.cal-task'));
    if (!cell) return null;
    cell.click();
    return cell.getAttribute('data-cal-date');
  });
  await sleep(900);
  const openedEditor = await page.evaluate(() => {
    const arts = [...document.querySelectorAll('article')];
    if (!arts.length) return 'no-task';
    const art = arts[0];
    const btn = art.querySelector('.row-action');
    if (!btn) return 'no-btn';
    btn.click();
    return 'clicked';
  });
  await sleep(600);
  const menuLabels = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()));
  const picked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim().startsWith('修改'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(1200);
  const urlAfter = page.url();
  const drawerOpen = await page.evaluate(() =>
    !![...document.querySelectorAll('h2')].find((e) => e.textContent.trim().startsWith('编辑')));
  check('点行尾「⋯」出菜单、选「修改」打开编辑面板',
    openedEditor === 'clicked' && picked && drawerOpen,
    `结果=${openedEditor} 选中日期=${pickedDay} 菜单=${menuLabels.join('/')} 选中=${picked}`);
  check('未跳离日历页', urlAfter.includes('/admin/calendar'), `URL=${urlAfter}`);
  check('浏览器历史未被推入列表页', !urlAfter.includes('/admin/all'));

  // 关掉抽屉
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.trim().startsWith('编辑'));
    const aside = h && h.closest('aside');
    const btn = aside && [...aside.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭');
    if (btn) btn.click();
  });
  await sleep(800);

  // ---------- 3. 日历任务字号 ----------
  console.log('\n[3] 日历任务字号');
  const before = await page.evaluate(() => {
    const el = document.querySelector('.cal-task');
    return el ? getComputedStyle(el).fontSize : null;
  });
  check('默认字号可读', !!before, `默认=${before}`);

  await page.goto(APP + '/admin/settings', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);
  const optionCount = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find(
      (s) => [...s.options].some((o) => o.textContent.includes('特大')));
    return sel ? sel.options.length : 0;
  });
  check('偏好设置里有字号下拉（含「特大」）', optionCount > 0, `选项数=${optionCount}`);

  await page.goto(APP + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2500);
  const after = await page.evaluate(() => {
    const el = document.querySelector('.cal-task');
    return el ? getComputedStyle(el).fontSize : null;
  });
  check('日历任务字号已生效', !!after, `当前=${after}（设置项改了会在下次进入日历时生效）`);

  console.log('\n页面错误:', ctx.errors.length ? ctx.errors.slice(0, 5) : '无');
  console.log('\n汇总: ' + results.filter((r) => r.ok).length + '/' + results.length + ' 通过');
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.log('未通过:', failed.map((f) => f.name).join('、')); process.exitCode = 1; }
}).catch((e) => { console.error('脚本出错:', e && e.message); process.exit(1); });
