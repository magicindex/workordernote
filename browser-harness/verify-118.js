/**
 * 「提醒@他」（用户 2026-10-13 要求）：多人之间互相推提醒的页面。
 *
 * 需求原文：「在我的清单里面增加：提醒@他，该页面通过后台系统偏好打开关闭，页面用于把
 * 消息推送给其他用户，或其他用户推送提醒消息给我，增加两列，一列是我提醒他人，另外一列
 * 是别人提醒我的，提醒消息归到智能清单显示统计中，我推送给别人的消息别人收到了会反馈到
 * 消息面板，别人完成后也同步到消息面板。此页面功能仅限于多人消息提醒用途，不能自己提醒
 * 自己。页面注意风格统一。」
 *
 * 本套件逐条钉住：
 *   1. 侧栏「我的清单」下出现「提醒@他」入口，两列（我提醒他人 / 别人提醒我）；
 *   2. 通过界面选人 + 发内容能真的推给对方（左列出现、状态「待查看」）；
 *   3. 对方在自己那一侧看得到（右列），侧栏角标 = 别人提醒我未完成的条数；
 *   4. 对方点「已收到」「已完成」，两个回执都回到发起人的**通知中心（消息面板）**；
 *   5. 不能自己提醒自己（前端选人列表里没有自己 + 服务端 400 兜底）；
 *   6. 后台系统偏好 nudge_enabled 关掉后入口消失、打开后回来；
 *   7. 390px 手机上不横向溢出。
 *
 * 需要**第二个账号**：套件自己临时开注册、建一个一次性用户（`nudgeprobe<时间戳>`），
 * 收尾时把提醒、用户、注册开关都还原。只有一个账号的实例上会先建一个，不会长期留垃圾。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-118.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const PROBE_USER = `nudgeprobe${STAMP}`;
const PROBE_PASS = `Probe!${STAMP}`;
const CONTENT = `自检提醒@他-${STAMP}`;
const NOTE = '自检备注';

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
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

/** 以另一个账号登录：直接拿 token 写进 localStorage，再回到首页。 */
async function loginAs(page, username, password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json().catch(() => null);
  const token = json && json.data && json.data.token;
  if (!token) throw new Error(`切换账号登录失败：${JSON.stringify(json).slice(0, 120)}`);
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((t) => { try { localStorage.setItem('reminders.token', t); } catch {} }, token);
  return token;
}

/** 读页面上的两列状态。 */
const readPage = (page) => page.evaluate((content) => {
  const col = (name) => document.querySelector(`[data-nudge-column="${name}"]`);
  const rows = (name) => [...(col(name)?.querySelectorAll('[data-nudge-item]') || [])].map((li) => (li.innerText || '').replace(/\s+/g, ' ').trim());
  return {
    hasSent: !!col('sent'),
    hasReceived: !!col('received'),
    sentTitles: [...(col('sent')?.querySelectorAll('h2') || [])].map((h) => h.innerText.trim()),
    receivedTitles: [...(col('received')?.querySelectorAll('h2') || [])].map((h) => h.innerText.trim()),
    sentRows: rows('sent'),
    receivedRows: rows('received'),
    mine: [...rows('sent'), ...rows('received')].filter((t) => t.includes(content)),
    badge: (document.querySelector('[data-nav-nudges] .nav-count')?.innerText || '').trim(),
  };
}, CONTENT);

(async () => {
  let probeId = null;
  let createdUserId = null;
  let nudgeId = null;
  const nudgeIds = [];
  let originalAllowRegister = null;

  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    // 当前登录用户名：用户对象不落 localStorage，问接口最稳。
    const mee = await api(page, '/api/auth/me');
    const me = mee.body?.data?.username || '';

    // ---------------- 0. 准备第二个账号 ----------------
    const before = await api(page, '/api/reminder/nudges/users');
    let candidates = before.body?.data || [];
    if (!candidates.length) {
      const sys = await api(page, '/api/configs/system');
      const configs = sys.body?.data || {};
      originalAllowRegister = configs.allow_register ?? null;
      await api(page, '/api/configs', 'PUT', { key: 'allow_register', value: 'true' });
      const reg = await api(page, '/api/auth/register', 'POST', { username: PROBE_USER, password: PROBE_PASS });
      createdUserId = reg.body?.data?.user?.id ?? null;
      if (!createdUserId) {
        // 有些版本注册接口只回 token，不回 user 对象
        const list = await api(page, '/api/users');
        createdUserId = (list.body?.data || []).find((u) => u.username === PROBE_USER)?.id ?? null;
      }
      await api(page, '/api/configs', 'PUT', { key: 'allow_register', value: String(originalAllowRegister ?? 'false') });
      const after = await api(page, '/api/reminder/nudges/users');
      candidates = after.body?.data || [];
    }
    check('实例上存在第二个可提醒的用户（没有就临时建一个）', candidates.length > 0, JSON.stringify(candidates));
    probeId = candidates[0]?.id ?? null;
    if (!probeId) throw new Error('没有可提醒的第二个用户，无法继续');

    // ---------------- 1. 入口与两列 ----------------
    await gotoRetry(page, BASE + '/admin');
    await sleep(2500);
    const nav = await page.evaluate(() => {
      const row = document.querySelector('[data-nav-nudges]');
      if (!row) return { present: false };
      const caption = [...document.querySelectorAll('.nav-caption')].find((c) => (c.innerText || '').includes('我的清单'));
      return {
        present: true,
        text: (row.innerText || '').replace(/\s+/g, ' ').trim(),
        afterCaption: caption ? !!(caption.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
        visible: row.getBoundingClientRect().width > 0,
      };
    });
    check('侧栏「我的清单」下有「提醒@他」入口', nav.present && nav.visible, JSON.stringify(nav));
    check('入口文字是「提醒@他」，且排在「我的清单」标题之后', nav.text.includes('提醒@他') && nav.afterCaption, JSON.stringify(nav));

    await gotoRetry(page, BASE + '/admin/nudges');
    await sleep(1800);
    const page0 = await readPage(page);
    check('页面渲染两列：我提醒他人 / 别人提醒我',
      page0.hasSent && page0.hasReceived
      && page0.sentTitles.includes('我提醒他人') && page0.receivedTitles.includes('别人提醒我'),
      JSON.stringify({ sent: page0.sentTitles, received: page0.receivedTitles }));

    // ---------------- 2. 不能自己提醒自己 ----------------
    await page.evaluate(() => document.querySelector('[data-nudge-new]')?.click());
    await sleep(800);
    const picker = await page.evaluate((probe) => {
      const select = document.querySelector('[data-nudge-target]');
      if (!select) return { open: false };
      return {
        open: true,
        options: [...select.options].map((o) => ({ value: o.value, text: o.textContent.trim() })),
        probe,
      };
    }, PROBE_USER);
    check('点「提醒@他」打开新建弹窗，下拉里列出其他用户',
      picker.open && picker.options.some((o) => String(o.value) === String(probeId)),
      JSON.stringify(picker));
    check('下拉里没有自己（不能自己提醒自己）',
      picker.open && me && !picker.options.some((o) => o.text === me),
      JSON.stringify({ me, options: picker.options }));

    // 服务端兜底：直接打接口也必须 400
    const selfTry = await page.evaluate(async ({ base, content }) => {
      const token = localStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/nudges', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_user_id: 1, content }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { base: BASE, content: `自检自己提醒自己-${STAMP}` });
    check('服务端挡住「自己提醒自己」（400）', selfTry.status === 400, JSON.stringify(selfTry));

    // ---------------- 3. 通过界面发一条 ----------------
    const filled = await page.evaluate(({ probe, content, note }) => {
      const select = document.querySelector('[data-nudge-target]');
      const area = document.querySelector('[data-nudge-content]');
      if (!select || !area) return 'missing';
      select.value = String(probe);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const setValue = (el, v) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue(area, content);
      const noteInput = [...document.querySelectorAll('.modal-field')].find((el) => el.tagName === 'INPUT' && (el.getAttribute('placeholder') || '').includes('补充说明'));
      if (noteInput) setValue(noteInput, note);
      return 'ok';
    }, { probe: probeId, content: CONTENT, note: NOTE });
    check('弹窗里能选中对象并填内容', filled === 'ok', filled);
    // 控件必须有真实样式：`modal-field` 这类原子类曾经只写在 ChannelsView 的
    // `<style scoped>` 里，别的组件照抄类名就完全没有边框与高度（0.24.0 修过一次），
    // 所以这里量一下计算样式，光看到 DOM 不算数。
    const fieldStyle = await page.evaluate(() => {
      const el = document.querySelector('[data-nudge-target]');
      if (!el) return null;
      const css = getComputedStyle(el);
      return { height: el.getBoundingClientRect().height, border: css.borderTopWidth, borderStyle: css.borderTopStyle };
    });
    check('弹窗控件有真实样式（高度 ≥40px 且有边框）',
      !!fieldStyle && fieldStyle.height >= 40 && parseFloat(fieldStyle.border) > 0 && fieldStyle.borderStyle !== 'none',
      JSON.stringify(fieldStyle));
    await sleep(300);
    await page.evaluate(() => document.querySelector('[data-nudge-submit]')?.click());
    await sleep(2200);
    const page1 = await readPage(page);
    check('发送后左列出现这条提醒、状态「待查看」',
      page1.mine.some((t) => t.includes('待查看')) && page1.mine.some((t) => t.includes(PROBE_USER)),
      JSON.stringify(page1.mine));

    const sent = await api(page, '/api/reminder/nudges');
    nudgeId = (sent.body?.data?.sent || []).find((n) => n.content === CONTENT)?.id ?? null;
    if (nudgeId) nudgeIds.push(nudgeId);
    check('接口侧确认这条进了「我提醒他人」', !!nudgeId, JSON.stringify(sent.body?.data?.counts));

    // ---------------- 4. 对方视角：右列 + 角标 ----------------
    await loginAs(page, PROBE_USER, PROBE_PASS);
    await gotoRetry(page, BASE + '/admin/nudges');
    await sleep(2200);
    const page2 = await readPage(page);
    check('对方在自己那一侧看到这条（右列「别人提醒我」）',
      page2.receivedRows.some((t) => t.includes(CONTENT)),
      JSON.stringify(page2.receivedRows));
    check('对方看到的状态是「待处理」', page2.receivedRows.some((t) => t.includes(CONTENT) && t.includes('待处理')),
      JSON.stringify(page2.receivedRows));
    check('侧栏角标 = 别人提醒我未完成条数（≥1）', Number(page2.badge) >= 1, `角标=${page2.badge}`);

    // ---------------- 5. 点「已收到」→ 发起人消息面板 ----------------
    const r1 = await page.evaluate((content) => {
      const row = [...document.querySelectorAll('[data-nudge-item]')].find((li) => (li.innerText || '').includes(content));
      if (!row) return 'row-missing';
      const btn = [...row.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '已收到');
      if (!btn) return 'btn-missing';
      btn.click();
      return 'ok';
    }, CONTENT);
    check('对方的「已收到」按钮点得到', r1 === 'ok', r1);
    await sleep(2000);
    const page3 = await readPage(page);
    check('点完「已收到」状态变「已收到」', page3.receivedRows.some((t) => t.includes(CONTENT) && t.includes('已收到')),
      JSON.stringify(page3.receivedRows));
    // 角标口径是「别人提醒我、**我还没做完**」（/summary 的 nudge_pending），
    // 不是「未读」：点过「已收到」但还没做完时它照旧挂着，做完了才消失。
    check('「已收到」后角标还在（还没做完，角标按未完成算）', Number(page3.badge) >= 1, `角标=${page3.badge}`);

    const r2 = await page.evaluate((content) => {
      const row = [...document.querySelectorAll('[data-nudge-item]')].find((li) => (li.innerText || '').includes(content));
      if (!row) return 'row-missing';
      const btn = [...row.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '已完成');
      if (!btn) return 'btn-missing';
      btn.click();
      return 'ok';
    }, CONTENT);
    check('对方的「已完成」按钮点得到', r2 === 'ok', r2);
    await sleep(2000);
    const page4 = await readPage(page);
    check('点完「已完成」状态变「已完成」', page4.receivedRows.some((t) => t.includes(CONTENT) && t.includes('已完成')),
      JSON.stringify(page4.receivedRows));
    check('做完之后侧栏角标清零', Number(page4.badge) === 0 || page4.badge === '', `角标=${page4.badge}`);

    // ---------------- 6. 发起人：状态同步 + 消息面板两条回执 ----------------
    await loginAs(page, process.env.APP_USER || '王耀辉', process.env.APP_PASS || 'Wyh!1984yelq.');
    await gotoRetry(page, BASE + '/admin/nudges');
    await sleep(2200);
    const page5 = await readPage(page);
    check('发起人这边看到「对方已收到」与「已完成」',
      page5.sentRows.some((t) => t.includes(CONTENT) && t.includes('已完成')),
      JSON.stringify(page5.sentRows));
    const withdrawGone = await page.evaluate((content) => {
      const row = [...document.querySelectorAll('[data-nudge-item]')].find((li) => (li.innerText || '').includes(content));
      if (!row) return null;
      return [...row.querySelectorAll('button')].some((b) => (b.innerText || '').trim() === '撤回');
    }, CONTENT);
    check('对方完成后发起人不能再撤回（撤回按钮消失）', withdrawGone === false, `撤回按钮存在=${withdrawGone}`);

    const notes = await api(page, '/api/reminder/notifications');
    const mine = (notes.body?.data || []).filter((n) => (n.body || '').includes(CONTENT) || (n.title || '').includes(CONTENT));
    check('对方「已收到」反馈到了消息面板（nudge_read）', mine.some((n) => n.type === 'nudge_read'), JSON.stringify(mine.map((n) => n.type)));
    check('对方「已完成」也反馈到了消息面板（nudge_done）', mine.some((n) => n.type === 'nudge_done'), JSON.stringify(mine.map((n) => n.type)));

    // 消息面板（通知中心）的界面上也要看得见这两条回执，并且用「提醒@他」自己的图标
    await gotoRetry(page, BASE + '/admin/notifications');
    await sleep(2200);
    const center = await page.evaluate((content) => {
      const rows = [...document.querySelectorAll('.notification-row, button')];
      const hit = rows.filter((r) => (r.innerText || '').includes(content));
      return {
        rows: hit.length,
        withNudgeIcon: hit.some((r) => !!r.querySelector('[data-notification-nudge]')),
        text: hit.map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 2),
      };
    }, CONTENT);
    check('通知中心里能看到这条提醒的回执', center.rows >= 1, JSON.stringify(center));
    check('回执用的是「提醒@他」自己的图标', center.withNudgeIcon === true, JSON.stringify(center));

    // ---------------- 7. 系统偏好开关 ----------------
    await api(page, '/api/configs', 'PUT', { key: 'nudge_enabled', value: 'false' });
    await gotoRetry(page, BASE + '/admin');
    await sleep(2500);
    const offNav = await page.evaluate(() => !!document.querySelector('[data-nav-nudges]'));
    check('后台系统偏好关掉后，侧栏入口消失', offNav === false);
    await gotoRetry(page, BASE + '/admin/nudges');
    await sleep(1500);
    const offPage = await page.evaluate(() => !!document.querySelector('[data-nudge-page]'));
    check('关掉后直接访问 /admin/nudges 是空白/兜底页（不再渲染这个页面）', offPage === false);
    await api(page, '/api/configs', 'PUT', { key: 'nudge_enabled', value: 'true' });
    await gotoRetry(page, BASE + '/admin');
    await sleep(2500);
    const onNav = await page.evaluate(() => !!document.querySelector('[data-nav-nudges]'));
    check('重新打开后入口恢复', onNav === true);

    // ---------------- 8. 手机宽度 ----------------
    await gotoRetry(page, BASE + '/admin/nudges');
    await sleep(1800);
    await page.setViewport({ width: 390, height: 844 });
    await sleep(1200);
    const mobile = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      columns: document.querySelectorAll('[data-nudge-column]').length,
      newBtn: !!document.querySelector('[data-nudge-new]'),
    }));
    check('390px 手机：两列都在、新建按钮在、不横向溢出',
      mobile.columns === 2 && mobile.newBtn && mobile.overflow <= 1, JSON.stringify(mobile));
    await page.setViewport({ width: 1440, height: 1000 });

    // ---------------- 清理 ----------------
    for (const id of nudgeIds) {
      await api(page, `/api/reminder/nudges/${id}`, 'DELETE');
    }
    if (createdUserId) {
      // 先让探针账号把自己那一侧也删干净，再删账号
      await loginAs(page, PROBE_USER, PROBE_PASS);
      const mineList = await api(page, '/api/reminder/nudges');
      for (const row of [...(mineList.body?.data?.sent || []), ...(mineList.body?.data?.received || [])]) {
        await api(page, `/api/reminder/nudges/${row.id}`, 'DELETE');
      }
      await loginAs(page, process.env.APP_USER || '王耀辉', process.env.APP_PASS || 'Wyh!1984yelq.');
      await api(page, `/api/users/${createdUserId}`, 'DELETE');
    }
    const leftover = await api(page, '/api/reminder/nudges');
    const rows = [...(leftover.body?.data?.sent || []), ...(leftover.body?.data?.received || [])];
    check('清理干净：自检提醒都不在了', !rows.some((n) => (n.content || '').includes('自检提醒@他')), JSON.stringify(rows.map((n) => n.content)));
    const users = await api(page, '/api/reminder/nudges/users');
    check('清理干净：临时探针账号已删除', !(users.body?.data || []).some((u) => u.username === PROBE_USER),
      JSON.stringify(users.body?.data));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
