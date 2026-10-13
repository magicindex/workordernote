/**
 * 「新设备导入向导」的浏览器端验证（由 verify-098.sh 起容器后调用）：
 *   老设备 = PEER_URL（默认 8918），新设备 = APP_URL（默认 8921，空库）
 *
 * 覆盖：
 *   1) 向导三步：连对端 → 选账号 → 导入结果
 *   2) 对端账号概览（清单/内容/完成记录条数 + 「本机没有，将一并创建」）
 *   3) 导入后：同名账号被创建（可用向导里生成的密码登录）、清单与内容全部到位
 *   4) 同步设置被写好（对端地址/令牌/方向/间隔），面板随之刷新
 *   5) 再同步一次是幂等的（全部跳过）
 *
 * 数据：会在老设备上建一个临时账号与其清单/提醒（跑完删掉），
 *       新设备是临时容器（脚本负责销毁）。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { USER, PASS } = require('./reminders-app');

const BASE = process.env.APP_URL || 'http://127.0.0.1:8921';
const PEER = process.env.PEER_URL || 'http://127.0.0.1:8918';
const NEW = BASE.replace(/\/$/, '');
const PEER_ROOT = PEER.replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
const TEST_USER = `自检导入-${STAMP}`;
const TEST_PASS = 'Import!SelfTest1';
const LOCAL_ADMIN = `导入管理员-${STAMP}`;
const LOCAL_PASS = 'LocalAdmin!123';

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function api(base, p, { method = 'GET', token = '', body = null } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function signIn(base, username, password) {
  const res = await api(base, '/api/auth/login', { method: 'POST', body: { username, password } });
  return res.body?.data?.token || '';
}

/** 登录并把失败原因带出来（限流 429 / 账号密码不对都会有 message）。 */
async function signInDetailed(base, username, password) {
  const res = await api(base, '/api/auth/login', { method: 'POST', body: { username, password } });
  return { token: res.body?.data?.token || '', message: res.body?.message || '', status: res.status };
}

/** 登录，失败（比如公开接口限流）就等一会儿再试。 */
async function signInRetry(base, username, password, tries = 4) {
  for (let i = 0; i < tries; i += 1) {
    const token = await signIn(base, username, password);
    if (token) return token;
    await sleep(5000 * (i + 1));
  }
  return '';
}

/**
 * 用指定账号登录并落到一个已登录的页面。
 * 不能用 harness 的 login()：它固定用 APP_USER/APP_PASS，而新设备上的管理员是临时注册的。
 */
async function loginAs(page, base, username, password) {
  const token = await signInRetry(base, username, password);
  if (!token) throw new Error(`登录 ${base} 失败（${username}）`);
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((t) => { try { localStorage.setItem('reminders.token', t) } catch {} }, token);
  await page.goto(base + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitFor(page, () => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('版本信息')), { timeout: 20000 });
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  // ---------- 0. 准备：老设备上一个「本机没有」的账号 + 数据 ----------
  const peerAdmin = await signInRetry(PEER_ROOT, USER, PASS);
  check('能登录老设备的管理员', !!peerAdmin);
  const peerSettings = await api(PEER_ROOT, '/api/reminder/admin/sync', { token: peerAdmin });
  const peerToken = peerSettings.body?.data?.token || '';
  check('读到老设备的同步令牌', peerToken.length >= 8, peerToken.slice(0, 6) + '…');

  // 有些实例关掉了注册（allow_register=false），测试账号建不出来。
  // 临时打开、跑完还原——和别的配置用例一样的「读原值 → 改 → 验 → 改回」。
  const peerConfigs = await api(PEER_ROOT, '/api/configs', { token: peerAdmin });
  const originalAllowRegister = peerConfigs.body?.data?.allow_register ?? 'false';
  if (originalAllowRegister !== 'true') {
    await api(PEER_ROOT, '/api/configs', { method: 'PUT', token: peerAdmin, body: { key: 'allow_register', value: 'true' } });
  }
  const reg = await api(PEER_ROOT, '/api/auth/register', { method: 'POST', body: { username: TEST_USER, password: TEST_PASS } });
  check('在老设备上建好只属于它的测试账号（临时开注册）', reg.status === 200, `status=${reg.status}`);
  const peerUserToken = await signInRetry(PEER_ROOT, TEST_USER, TEST_PASS);
  const peerList = await api(PEER_ROOT, '/api/reminder/lists', {
    method: 'POST', token: peerUserToken, body: { name: `自检导入清单-${STAMP}`, color: 'emerald' },
  });
  const peerListId = peerList.body?.data?.id;
  for (const title of [`自检导入任务A-${STAMP}`, `自检导入任务B-${STAMP}`]) {
    await api(PEER_ROOT, '/api/reminder/items', {
      method: 'POST', token: peerUserToken,
      body: { title, list_id: peerListId, due_at: new Date(Date.now() + 86400000).toISOString(), repeat_rule: 'none', channels: ['inapp'] },
    });
  }
  // 「信用卡账单」是**个人偏好、默认关**：关着时卡片提醒不会出现在 /items 里（按设计隐藏），
  // 这里先给测试账号打开，才能用「条数」比对导入前后一致。
  await api(PEER_ROOT, '/api/configs', {
    method: 'PUT', token: peerUserToken, body: { key: 'credit_card_enabled', value: 'true' },
  });

  // 顺带造一张信用卡 + 一笔本期金额：验证卡片与账单期也能同步/导入过去。
  // 信用卡现在是固定栏目「信用卡账单」：不需要先建清单，建卡时自动归到那一栏。
  const peerCard = await api(PEER_ROOT, '/api/reminder/cards', {
    method: 'POST', token: peerUserToken,
    body: { bank: '自检导入银行', name: '同步卡', statement_day: 6, due_day: 22, advance_days: 3, auto_repeat: true },
  });
  const peerCardId = peerCard.body?.data?.id;
  const peerPeriod = peerCard.body?.data?.current?.period;
  if (peerCardId && peerPeriod) {
    await api(PEER_ROOT, `/api/reminder/cards/${peerCardId}/statements/${peerPeriod}`, {
      method: 'PUT', token: peerUserToken, body: { amount_cents: 888800, minimum_cents: 88880, note: '导入测试' },
    });
  }

  const peerItems = await api(PEER_ROOT, `/api/reminder/items?view=all&status=all`, { token: peerUserToken });
  const peerItemTitles = (peerItems.body?.data || []).map((i) => i.title).sort();
  // 2 条手动建的 + 信用卡自动生成的 3 条（账单日/还款日/提前提醒）
  check('老设备上这个账号有 5 条内容（2 手动 + 3 卡片提醒，供导入比对）', peerItemTitles.length === 5, JSON.stringify(peerItemTitles));

  // ---------- 1. 新设备：注册本机管理员（第一个用户即管理员） ----------
  const localReg = await api(NEW, '/api/auth/register', { method: 'POST', body: { username: LOCAL_ADMIN, password: LOCAL_PASS } });
  check('新设备上注册本机管理员', localReg.status === 200, `status=${localReg.status}`);

  let generatedPassword = '';
  try {
    await withTab(async (page) => {
      await loginAs(page, NEW, LOCAL_ADMIN, LOCAL_PASS);
      await page.goto(NEW + '/admin/configs', { waitUntil: 'domcontentloaded' });
      // waitFor 超时是「返回 false」而不是抛错，别再套 .then(() => true)（那样永远为真）
      const hasWizard = await waitFor(page, () => !!document.querySelector('[data-sync-import]'), { timeout: 20000 });
      check('新设备「系统配置」里有「从另一台设备导入」向导', hasWizard === true);
      if (!hasWizard) {
        // 把现场打出来，免得只看到一句「没找到」
        const diag = await page.evaluate(() => ({
          path: location.pathname,
          title: document.title,
          hasToken: !!localStorage.getItem('reminders.token'),
          text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
          scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).slice(0, 3),
        }));
        console.log('    现场：', JSON.stringify(diag));
        return;
      }
      await sleep(600);

      // ---------- 2. 第一步：连对端 ----------
      await page.evaluate(({ peer, token }) => {
        const set = (sel, v) => {
          const el = document.querySelector(sel);
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('[data-import-peer]', peer);
        set('[data-import-token]', token);
      }, { peer: PEER_ROOT, token: peerToken });
      await page.evaluate(() => document.querySelector('[data-import-connect]').click());
      const gotList = await waitFor(page, () => !!document.querySelector('[data-import-user]'), { timeout: 30000 });
      check('连接对端后列出它的账号', gotList === true, await page.evaluate(() => document.querySelector('[data-import-error]')?.textContent || ''));

      const users = await page.evaluate(() => [...document.querySelectorAll('[data-import-user]')].map((el) => ({
        username: el.getAttribute('data-import-user'),
        text: el.innerText.replace(/\s+/g, ' '),
        existsLocal: !!el.querySelector('[data-import-exists]'),
        hasPasswordInput: !!el.querySelector('[data-import-password]'),
      })));
      const testRow = users.find((u) => u.username === TEST_USER);
      check('对端账号列表里有刚建的测试账号', !!testRow, JSON.stringify(users.map((u) => u.username)));
      check('账号行显示清单/内容条数', !!testRow && /个清单/.test(testRow.text) && /条内容/.test(testRow.text), testRow?.text);
      check('本机没有的账号标为「将一并创建」并给出初始密码输入框',
        !!testRow && testRow.existsLocal === false && testRow.hasPasswordInput === true, JSON.stringify(testRow));

      const peerInfo = await page.evaluate(() => document.querySelector('[data-import-peer-info]')?.innerText || '');
      check('显示已连上的对端信息', /工作序记/.test(peerInfo), peerInfo);

      // ---------- 3. 第二步：导入（初始密码留空 → 自动生成） ----------
      const picked = await page.evaluate(() => [...document.querySelectorAll('[data-import-check]')].filter((c) => c.checked).map((c) => c.value));
      check('默认勾选本机还没有的账号', picked.includes(TEST_USER), JSON.stringify(picked));
      // 只留测试账号：对端还有正式账号，全勾上会在新设备里建一堆账号，也让「取密码」取错行
      // 逐个改、每次都重新查询：Vue 会因 v-model 变化重渲染列表，
      // 之前拿到的元素引用会失效，那些元素上派发的 change 没人接（踩过）。
      for (let i = 0; i < 8; i += 1) {
        const settled = await page.evaluate((target) => {
          const boxes = [...document.querySelectorAll('[data-import-check]')];
          const wrong = boxes.find((b) => !!b.checked !== (b.value === target));
          if (!wrong) return true;
          wrong.checked = wrong.value === target;
          wrong.dispatchEvent(new Event('change', { bubbles: true }));
          return false;
        }, TEST_USER);
        if (settled) break;
        await sleep(300);
      }
      await sleep(300);
      const onlyOne = await page.evaluate(() => [...document.querySelectorAll('[data-import-check]')].filter((c) => c.checked).map((c) => c.value));
      check('可以只勾选要导入的那一个账号', onlyOne.length === 1 && onlyOne[0] === TEST_USER, JSON.stringify(onlyOne));
      await page.evaluate(() => document.querySelector('[data-import-run]').click());
      const done = await waitFor(page, () => !!document.querySelector('[data-import-done]'), { timeout: 120000 });
      check('导入完成并显示结果', done === true, await page.evaluate(() => document.querySelector('[data-import-error]')?.textContent || ''));

      const result = await page.evaluate((target) => {
        const row = document.querySelector(`[data-import-created-user="${target}"]`);
        return {
          created: document.querySelector('[data-import-created]')?.innerText.replace(/\s+/g, ' ') || '',
          // 按账号取密码：弹窗里可能列出多个新账号，取第一个会拿错行（踩过）
          shown: row?.querySelector('[data-import-password-shown]')?.textContent.trim() || '',
          stats: document.querySelector('[data-import-stats]')?.innerText || '',
        };
      }, TEST_USER);
      check('结果里列出新建的账号', result.created.includes(TEST_USER), result.created.slice(0, 120));
      generatedPassword = result.shown;
      check('自动生成了初始密码并只显示一次', /^[A-Za-z0-9]{12}$/.test(generatedPassword), generatedPassword);
      check('显示本次同步结果（新增了内容）', /新增\s*[1-9]/.test(result.stats), result.stats);
      await page.screenshot({ path: path.join(SHOTS, 'sync-import-done.png') });

      // ---------- 4. 面板刷新后同步设置已生效 ----------
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /完成，刷新/.test(b.textContent)).click());
      await sleep(2000);
      // 面板里的对端地址是**输入框的 value**，不在 innerText 里（踩过），要读 value
      let shown = false;
      for (let i = 0; i < 15 && !shown; i += 1) {
        shown = await page.evaluate((peer) => document.querySelector('[data-sync-peer-url]')?.value === peer, PEER_ROOT);
        if (!shown) await sleep(1000);
      }
      const where = await page.evaluate(() => ({
        path: location.pathname,
        peerValue: document.querySelector('[data-sync-peer-url]')?.value || '',
      }));
      check('同步面板刷新后对端地址已写入', shown === true, `${JSON.stringify(where)} 期望 ${PEER_ROOT}`);
    });
  } finally {
    // ---------- 5. 校验新设备上的结果（Node 侧，避免受页面状态影响） ----------
    let localToken = '';
    let loginDetail = { message: '没有拿到密码', status: 0 };
    if (generatedPassword) {
      for (let i = 0; i < 4 && !localToken; i += 1) {
        loginDetail = await signInDetailed(NEW, TEST_USER, generatedPassword);
        if (loginDetail.token) { localToken = loginDetail.token; break; }
        await sleep(6000 * (i + 1)); // 公开接口限流：等窗口再试
      }
    }
    check('能用向导里生成的密码登录新设备上的这个账号', !!localToken,
      `密码=${generatedPassword || '无'} 结果=${loginDetail.status} ${loginDetail.message}`);
    if (localToken) {
      // 个人偏好不跨机同步（同步不带系统/个人配置）：新设备上要自己打开一次，
      // 打开后卡片提醒才会出现在列表里，条数才和老设备可比。
      await api(NEW, '/api/configs', {
        method: 'PUT', token: localToken, body: { key: 'credit_card_enabled', value: 'true' },
      });
      const lists = await api(NEW, '/api/reminder/lists', { token: localToken });
      const items = await api(NEW, '/api/reminder/items?view=all&status=all', { token: localToken });
      const titles = (items.body?.data || []).map((i) => i.title).sort();
      check('清单已导入新设备', (lists.body?.data || []).some((l) => l.name === `自检导入清单-${STAMP}`), JSON.stringify((lists.body?.data || []).map((l) => l.name)));
      check('内容与老设备一致', JSON.stringify(titles) === JSON.stringify(peerItemTitles), JSON.stringify(titles));

      // 同步设置与手动同步都是管理员接口：必须用本机管理员令牌，不能用刚导入的普通用户
      const adminToken = await signInRetry(NEW, LOCAL_ADMIN, LOCAL_PASS);
      // 信用卡也要跟着过来：卡片本身 + 三条提醒 + 本期金额
      const newLists = lists.body?.data || [];
      // 信用卡固定栏目：同步/导入过去后应是一条名叫「信用卡账单」的 credit_card 清单
      const cardList = newLists.find((l) => l.template === 'credit_card');
      const newCards = (await api(NEW, '/api/reminder/cards', { token: localToken })).body?.data || [];
      const newCard = newCards.find((c) => c.bank === '自检导入银行');
      if (!newCard) {
        console.log('  诊断 · 新设备清单：', JSON.stringify((newLists || []).map((l) => [l.id, l.name, l.template])));
        console.log('  诊断 · 新设备卡片：', JSON.stringify(newCards));
      }
      check('信用卡栏目与卡片都同步过来了',
        !!cardList && cardList.name === '信用卡账单' && !!newCard && newCard.statement_day === 6,
        JSON.stringify({ list: cardList?.name, bank: newCard?.bank }));
      check('卡片的本期金额也同步过来了',
        Number(newCard?.current?.amount_cents) === 888800 && Number(newCard?.current?.minimum_cents) === 88880,
        JSON.stringify({ amount: newCard?.current?.amount_cents, min: newCard?.current?.minimum_cents }));
      const cardReminders = ((await api(NEW, '/api/reminder/items?view=all&status=all', { token: localToken })).body?.data || [])
        .filter((i) => i.card_id === newCard?.id);
      check('卡片的账单日/还款日/提前提醒三条提醒都在新设备上',
        cardReminders.length === 3 && cardReminders.every((i) => i.repeat_rule === 'monthly'),
        JSON.stringify(cardReminders.map((i) => i.card_role)));

      const settings = await api(NEW, '/api/reminder/admin/sync', { token: adminToken });
      const s = settings.body?.data || {};
      check('同步设置写好了（对端地址 / 方向 / 间隔）',
        s.peer_url === PEER_ROOT && s.direction === 'both' && s.interval_minutes === 5,
        JSON.stringify({ peer: s.peer_url, dir: s.direction, interval: s.interval_minutes }));
      const again = await api(NEW, '/api/reminder/admin/sync/run', { method: 'POST', token: adminToken });
      check('再同步一次是幂等的（没有新增）', /新增 0/.test(again.body?.data?.message || ''), again.body?.data?.message);

      // 清理新设备上的测试账号与其数据（新设备是临时容器，但保持干净便于重复跑）
      // 删账号是管理员接口：用本机管理员，而不是刚导入的普通用户
      const localAdminToken = adminToken;
      const usersRes = await api(NEW, '/api/users', { token: localAdminToken });
      const target = (Array.isArray(usersRes.body?.data) ? usersRes.body.data : []).find((u) => u.username === TEST_USER);
      for (const i of items.body?.data || []) await api(NEW, `/api/reminder/items/${i.id}`, { method: 'DELETE', token: localToken });
      for (const l of lists.body?.data || []) await api(NEW, `/api/reminder/lists/${l.id}`, { method: 'DELETE', token: localToken });
      if (target) await api(NEW, `/api/users/${target.id}`, { method: 'DELETE', token: localAdminToken });
    }

    // ---------- 6. 清理老设备上的测试账号与数据 ----------
    const finalPeerAdmin = await signInRetry(PEER_ROOT, USER, PASS);
    const peersItems = await api(PEER_ROOT, `/api/reminder/items?view=all&status=all`, { token: peerUserToken });
    for (const i of peersItems.body?.data || []) await api(PEER_ROOT, `/api/reminder/items/${i.id}`, { method: 'DELETE', token: peerUserToken });
    if (peerCardId) await api(PEER_ROOT, `/api/reminder/cards/${peerCardId}`, { method: 'DELETE', token: peerUserToken });
    if (peerListId) await api(PEER_ROOT, `/api/reminder/lists/${peerListId}`, { method: 'DELETE', token: peerUserToken });
    const peerUsers = await api(PEER_ROOT, '/api/users', { token: finalPeerAdmin });
    const peerAll = Array.isArray(peerUsers.body?.data) ? peerUsers.body.data : (peerUsers.body?.data?.items || []);
    // 连历次失败运行遗留的「自检导入-*」账号一起清掉，别让它越攒越多
    for (const u of peerAll.filter((x) => String(x.username).startsWith('自检导入'))) {
      await api(PEER_ROOT, `/api/users/${u.id}`, { method: 'DELETE', token: finalPeerAdmin });
    }
    const leftUsersRaw = (await api(PEER_ROOT, '/api/users', { token: finalPeerAdmin })).body?.data;
    const leftUsers = Array.isArray(leftUsersRaw) ? leftUsersRaw : (leftUsersRaw?.items || []);
    const leftItems = (await api(PEER_ROOT, '/api/reminder/items?view=all&status=all', { token: finalPeerAdmin })).body?.data || [];
    if (originalAllowRegister !== 'true') {
      await api(PEER_ROOT, '/api/configs', { method: 'PUT', token: finalPeerAdmin, body: { key: 'allow_register', value: originalAllowRegister } });
      const back = await api(PEER_ROOT, '/api/configs', { token: finalPeerAdmin });
      check('老设备的「允许注册」已还原', (back.body?.data?.allow_register ?? '') === originalAllowRegister,
        `还原为 ${back.body?.data?.allow_register}`);
    }
    check('老设备上的测试账号与数据都已清理',
      !leftUsers.some((u) => u.username === TEST_USER) && !leftItems.some((i) => String(i.title).includes('自检导入')),
      `用户 ${leftUsers.length} / 条目 ${leftItems.length}`);
  }

  console.log(`  截图：${path.join(SHOTS, 'sync-import-done.png')}`);
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
