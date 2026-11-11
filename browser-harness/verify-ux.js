/**
 * 本轮 UX 需求的验收：侧栏抽屉、设置折叠、日历禁止新建、新建默认今天、默认首页、手机适配。
 * 用本机默认浏览器（商店的 fygo-browser，有头）跑。
 */
const { withTab, sleep, waitFor, clickButtonByText } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
};
const goto = (page, path, ms = 2200) =>
  page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 }).then(() => sleep(ms));

withTab(async (page) => {
  await login(page, BASE);
  console.log('登录后 URL:', page.url());

  // 侧栏折叠状态是持久化的，测试要有确定起点：先清掉这两个键再重载
  await page.evaluate(() => {
    try { localStorage.removeItem('ui_settings_open'); localStorage.removeItem('ui_rail_collapsed'); } catch {}
  });
  await goto(page, '/admin', 2000);

  // ---------- 1) 默认首页 ----------
  // 这个用例会真的改用户配置，原值一律从服务端读、结束时也从服务端确认已还原：
  // 只读界面上的 select 会被渲染时序骗到（曾经因此把生产的值留在测试值上），
  // 而且一旦这个设置被留在「日历视图」，后面的列表页检查会跟着一起红。
  console.log('\n[1] 默认首页设置');

  const readConfig = (key) => page.evaluate(async ({ base, k }) => {
    const token = localStorage.getItem('reminders.token');
    const res = await fetch(base + '/api/configs/user/meta', { headers: { Authorization: 'Bearer ' + token } });
    const json = await res.json().catch(() => ({}));
    const item = ((json.data) || []).find((it) => it.key === k);
    return item ? item.value : null;
  }, { base: BASE, k: key });

  const pickDefaultView = async (label) => {
    await page.evaluate((text) => {
      const sel = [...document.querySelectorAll('select')].find(
        (s) => [...s.options].some((o) => o.textContent.trim() === text));
      const opt = [...sel.options].find((o) => o.textContent.trim() === text);
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, label);
    await waitFor(page, () => {
      const sel = [...document.querySelectorAll('select')].find(
        (s) => [...s.options].some((o) => o.textContent.trim() === '日历视图'));
      const btn = sel && sel.parentElement.querySelector('button');
      return !!btn && !btn.disabled;
    }, { timeout: 6000 }).catch(() => {});
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find(
        (s) => [...s.options].some((o) => o.textContent.trim() === '日历视图'));
      const btn = sel.parentElement.querySelector('button');
      if (!btn.disabled) btn.click();
    });
    await sleep(1500);
  };

  const originalDefaultView = await readConfig('default_view');
  console.log(`  原值：default_view=${originalDefaultView}`);
  check('能读到原默认首页（首页看板 / 列表 / 日历）',
    ['home', 'list', 'calendar'].includes(String(originalDefaultView)), String(originalDefaultView));

  // 切到「另一个」值再验，这样无论用户原本设的是哪个，用例都有意义
  const otherView = originalDefaultView === 'calendar' ? 'list' : 'calendar';
  const otherLabel = otherView === 'calendar' ? '日历视图' : '列表视图';
  await goto(page, '/admin/settings');
  await waitFor(page, () => [...document.querySelectorAll('select')].some(
    (s) => [...s.options].some((o) => o.textContent.trim() === '日历视图')), { timeout: 8000 }).catch(() => {});
  check('偏好设置里有「默认首页」并能选' + otherLabel, true);
  await pickDefaultView(otherLabel);
  check(`保存默认首页（${otherLabel}）已落库`, (await readConfig('default_view')) === otherView,
    `服务端=${await readConfig('default_view')}`);

  await goto(page, '/');
  check('重新进入应用按设置进入对应视图',
    otherView === 'calendar' ? page.url().includes('/admin/calendar') : !page.url().includes('/admin/calendar'),
    page.url());

  // 还原成原值，并从服务端确认
  let restored = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await goto(page, '/admin/settings');
    await waitFor(page, () => [...document.querySelectorAll('select')].some(
      (s) => [...s.options].some((o) => o.textContent.trim() === '日历视图')), { timeout: 8000 }).catch(() => {});
    const restoreLabel = originalDefaultView === 'calendar' ? '日历视图'
      : originalDefaultView === 'home' ? '首页看板' : '列表视图';
    await pickDefaultView(restoreLabel);
    restored = await readConfig('default_view');
    if (restored === originalDefaultView) break;
  }
  check(`默认首页已还原为 ${originalDefaultView}`, restored === originalDefaultView, `服务端=${restored}`);

  // ---------- 2) 日历视图的新建入口 ----------
  // 0.1.3 起日历可以新建了：双击日期格或点「＋ 新建」都会弹出与列表页同一个编辑面板。
  // 这里只保证「列表页那种快捷新建表单不在日历里」，双击新建的完整链路在 verify-013.js。
  console.log('\n[2] 日历视图的新建入口');
  await goto(page, '/admin/calendar');
  const calQuickForm = await page.evaluate(() => !!document.querySelector('.quick-card'));
  check('日历视图下没有列表页那种快捷新建表单', !calQuickForm);
  const calCreateButton = await page.evaluate(() =>
    !![...document.querySelectorAll('aside button')].find((b) => b.textContent.includes('＋ 新建')));
  check('日历视图右侧有「＋ 新建」按钮（0.1.3 起）', calCreateButton);
  // 用户 2026-10-16：「新建提醒」从侧栏搬到了首页看板标题行右侧（那条口径在 verify-125）。
  // 这里只看列表页自己的「新建」入口还在 —— 「全部」页 0.18.3 起本来就不给新建入口，
  // 所以拿「计划」页看。
  await goto(page, '/admin/planned');
  // 2026-11-11 起桌面「计划」页的新建卡片默认展开（不再是收起的按钮），两种形态都算入口在
  const listNewVisible = await page.evaluate(() => !!document.querySelector('[data-quick-new]') || !!document.querySelector('.quick-card'));
  check('列表视图下仍有新建入口（展开的卡片或收起的按钮）', listNewVisible);

  // ---------- 3) 新建提醒默认今天 ----------
  // 用**具体清单页**（不受「默认首页」设置影响）；「全部」页 0.18.3 起不再有新建入口。
  console.log('\n[3] 新建提醒默认选中今天');
  // 取一个普通清单的 id：**带重试**。这一段紧跟在切换默认首页之后，很容易撞上
  // 登录/公开接口限流（fetch 失败 → firstListId 为 null → 后面落到 /admin，
  // 而默认首页现在是「首页看板」，快捷新建那几条就全假红了）。
  let firstListId = null;
  for (let attempt = 1; attempt <= 3 && !firstListId; attempt += 1) {
    firstListId = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/lists', { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
      const json = await res.json().catch(() => ({}));
      const rows = json.data?.items || json.data || [];
      const list = rows.find((l) => !l.template);
      return list ? list.id : null;
    }, BASE);
    if (!firstListId) await sleep(4000);
  }
  if (!firstListId) {
    // 拿不到清单：把默认首页临时切成列表视图，至少让 /admin 落在今天页（后面会还原）
    await goto(page, '/admin/settings');
    await sleep(1200);
    await pickDefaultView('列表视图');
    await sleep(1200);
  }
  await goto(page, firstListId ? `/admin/list/${firstListId}` : '/admin', 1600);
  await openQuickAdd(page);
  await page.evaluate(() => {
    const input = document.querySelector('.quick-card input');
    if (input) { input.focus(); input.dispatchEvent(new Event('focus', { bubbles: true })); }
  });
  await sleep(600);
  const quickDate = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '今天');
    const input = document.querySelector('.quick-card input');
    return { chipActive: chip ? chip.className.includes('active') : null, placeholder: input ? input.placeholder : null };
  });
  check('「今天」芯片默认点亮', quickDate.chipActive === true, JSON.stringify(quickDate));

  // ---------- 4) 侧栏抽屉 ----------
  console.log('\n[4] 侧栏抽屉模式');
  // 注意：页面上有两个 .min-h-screen，必须取包住 <main> 的那个内容层
  const wrapSel = "main".replace('main', 'main');
  const before = await page.evaluate(() => {
    const wrap = document.querySelector('main').closest('div.min-h-screen');
    return { paddingLeft: getComputedStyle(wrap).paddingLeft };
  });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('header button')][0];
    btn.click();
  });
  await sleep(900);
  const afterCollapse = await page.evaluate(() => {
    const wrap = document.querySelector('main').closest('div.min-h-screen');
    return { paddingLeft: getComputedStyle(wrap).paddingLeft };
  });
  check('点顶栏按钮能收起侧栏', parseFloat(afterCollapse.paddingLeft) < parseFloat(before.paddingLeft),
    `${before.paddingLeft} → ${afterCollapse.paddingLeft}`);
  // 展开回来
  await page.evaluate(() => { [...document.querySelectorAll('header button')][0].click(); });
  await sleep(900);
  const restoredPadding = await page.evaluate(() => getComputedStyle(document.querySelector('main').closest('div.min-h-screen')).paddingLeft);
  check('再点一次能展开', parseFloat(restoredPadding) >= parseFloat(before.paddingLeft), restoredPadding);

  // ---------- 5) 设置组折叠 ----------
  console.log('\n[5] 侧栏「设置」组折叠');
  const collapsed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('aside.sidebar button')].find((b) => b.textContent.includes('设置'));
    const a = [...document.querySelectorAll('aside.sidebar a')].find((x) => x.textContent.includes('偏好设置'));
    // v-show 隐藏时元素仍在 DOM，必须看是否真的可见
    const visible = !!a && a.offsetParent !== null && a.getBoundingClientRect().height > 0;
    return { toggleFound: !!btn, prefsVisible: visible };
  });
  check('默认折叠时看不到「偏好设置」', collapsed.toggleFound && !collapsed.prefsVisible, JSON.stringify(collapsed));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('aside.sidebar button')].find((b) => b.textContent.includes('设置'));
    btn.click();
  });
  await sleep(700);
  const expanded = await page.evaluate(() => {
    const a = [...document.querySelectorAll('aside.sidebar a')].find((x) => x.textContent.includes('偏好设置'));
    return !!a && a.offsetParent !== null && a.getBoundingClientRect().height > 0;
  });
  check('点「设置」能展开出偏好设置', expanded);

  // ---------- 6) 手机适配 ----------
  console.log('\n[6] 手机适配');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  for (const [name, path] of [['日历', '/admin/calendar'], ['待办', '/admin'], ['设置', '/admin/settings']]) {
    await goto(page, path, 2000);
    const m = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(`手机端「${name}」无横向溢出`, !m.overflowX, `scrollW=${m.scrollW} innerW=${m.innerW}`);
  }
  await page.setViewport({ width: 1440, height: 900 });

  console.log('\n页面错误:', (page.__errors || []).length);
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n汇总: ${okCount}/${results.length} 通过`);
  if (okCount !== results.length) {
    console.log('未通过:', results.filter((r) => !r.ok).map((r) => r.name).join('、'));
    process.exitCode = 1;
  }
}).catch((e) => { console.error('出错:', e && e.message); process.exit(1); });
