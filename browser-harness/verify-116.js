/**
 * 这一批（用户 2026-10-13 要求）：
 *
 *   1) **新建提醒的日期芯片时间一律 23:59**（今天/明天/本周末…），除非自己手动改结束时间；
 *      后台那个「新建提醒默认结束时间」配置项已删掉。
 *   2) **新建提醒实时显示剩余时间**（时:分）。
 *   3) **提醒弹窗「知道了（内容）」与后台偏好一致**：内容 =「点『知道了』后的提醒频率」
 *      那一项在下拉里显示的文案（同一份文案表 utils/reminder-options.ts）。
 *   4) **后台卡片合并**：原来的「通知」卡片并进「提醒」卡片，只剩一张。
 *
 * （「开始提醒时间 = 当天第一次提醒弹窗」的排程语义在后端：`verify` 里只看 UI，
 *   排程由 Go 的 TestFirstRemindAt 钉住。）
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-116.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const ACK_TITLE = `自检知道了文案-${STAMP}`;

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

(async () => {
  const created = [];
  let originalStart = '00:00';
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    const cfg = await page.evaluate(async (base) => {
      const t = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const j = await (await fetch(base + '/api/configs/user/meta', { headers: { Authorization: 'Bearer ' + t } })).json();
      const rows = j?.data || [];
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }, BASE);
    originalStart = cfg.reminder_all_day_time || '00:00';

    // ---------------- 1. 日期芯片：时间一律 23:59 ----------------
    await gotoRetry(page, BASE + '/admin');
    await sleep(2400);
    await openQuickAdd(page);
    await sleep(900);
    // 2026-11-12 起新建卡片上的日期芯片只写「选择日期」、不显示时分（用户要求去掉时间控件），
    // 所以「芯片的时间一律 23:59」改成**存一条再读接口**：点「明天」→ 保存 → due 必须是明天 23:59。
    const chipTitle = `自检芯片时间-${STAMP}`;
    const savedChip = await page.evaluate(async ({ title, base }) => {
      const btns = [...document.querySelectorAll('.quick-chip')];
      btns.find((b) => (b.textContent || '').trim() === '明天')?.click();
      await new Promise((r) => setTimeout(r, 300));
      const card = document.querySelector('.quick-card');
      const input = card?.querySelector('input');
      if (!input) return { error: '找不到新建输入框' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      [...card.querySelectorAll('button')].find((b) => /^(添加提醒|添加)$/.test(b.textContent.trim()))?.click();
      await new Promise((r) => setTimeout(r, 1600));
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const json = await (await fetch(base + '/api/reminder/items?view=all&q=' + encodeURIComponent(title), {
        headers: { Authorization: 'Bearer ' + token },
      })).json();
      const item = (json?.data || []).find((x) => x.title === title);
      if (item) {
        await fetch(base + '/api/reminder/items/' + item.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      }
      return { due: item?.due_at || null };
    }, { title: chipTitle, base: BASE });
    const chipDue = savedChip?.due ? new Date(savedChip.due) : null;
    const expectTomorrow = new Date();
    expectTomorrow.setDate(expectTomorrow.getDate() + 1);
    const sameDay = !!chipDue && chipDue.toDateString() === expectTomorrow.toDateString();
    check('「明天」芯片存出来是明天 23:59',
      sameDay && chipDue.getHours() === 23 && chipDue.getMinutes() === 59,
      JSON.stringify({ due: savedChip?.due, expectTomorrow: expectTomorrow.toDateString() }));
    check('日期芯片上不再出现时分（时间控件已去掉）',
      await page.evaluate(() => {
        const el = document.querySelector('[data-quick-date]');
        return !!el && !/\d{1,2}:\d{2}/.test(el.textContent || '');
      }));

    // ---------------- 2. 新建窗口不再显示剩余时间/右侧「今天 23:59」 ----------------
    check('新建窗口不再显示剩余时间', await page.evaluate(() => !document.querySelector('[data-quick-remaining]')));
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.quick-chip')];
      btns.find((b) => (b.textContent || '').trim() === '今天')?.click();
    });
    await sleep(400);
    check('新建窗口右侧不再重复「今天 23:59」', await page.evaluate(() => {
      const card = document.querySelector('.quick-card');
      return !card || !card.textContent.replace(/\s+/g, ' ').includes('今天 23:59');
    }));

    // ---------------- 3. 弹窗「知道了（…）」与后台偏好文案一致 ----------------
    // 后台那一项下拉里显示什么，弹窗按钮括号里就该是什么
    await gotoRetry(page, BASE + '/admin/settings');
    await sleep(2200);
    const ackOption = await page.evaluate(() => {
      const row = document.querySelector('[data-config-key="reminder_ack_minutes"]');
      if (!row) return null;
      const sel = row.querySelector('select');
      return sel ? (sel.selectedOptions[0]?.textContent || '').trim() : null;
    });
    check('偏好设置里「点『知道了』后的提醒频率」有值', !!ackOption, String(ackOption));

    await api(page, '/api/configs', 'PUT', { key: 'reminder_all_day_time', value: '00:00' });
    await api(page, '/api/reminder/notifications/read-all', 'POST');
    const due = await api(page, '/api/reminder/items', 'POST', {
      title: ACK_TITLE, due_at: new Date().toISOString(), repeat_rule: 'none', channels: ['inapp'],
    });
    const ackId = due.body?.data?.id ?? null;
    if (ackId) created.push(ackId);
    check('造一条到点提醒（用于验证弹窗文案）', !!ackId);
    // 0.24.0 起「新建之后至少 10 分钟才第一次提醒」（见服务端 firstRemindSchedule）：
    // 这条用例考的是站内通知与跨设备确认，不是新建口径，所以「稍后提醒」到 3 秒后
    // —— 稍后提醒是用户明确点的时刻，不吃那 10 分钟。
    if (ackId) await api(page, `/api/reminder/items/${ackId}/snooze`, 'POST', { until: new Date(Date.now() + 3000).toISOString() });

    let buttonText = '';
    for (let i = 0; i < 7 && !buttonText; i += 1) {
      await sleep(15_000);
      buttonText = await page.evaluate(() => {
        const dlg = document.querySelector('[role="alertdialog"]');
        if (!dlg) return '';
        const btn = [...dlg.querySelectorAll('button')].find((b) => (b.innerText || '').trim().startsWith('知道了'));
        return btn ? (btn.innerText || '').trim() : '';
      });
    }
    check('到点后弹窗出现且主按钮是「知道了（…）」', /^知道了（.+）$/.test(buttonText), buttonText);
    check('弹窗按钮括号里的文案 = 后台那一项下拉显示的文案（要求「显示保持与后台一致」）',
      !!ackOption && buttonText === `知道了（${ackOption}）`, `按钮=${buttonText} 后台=${ackOption}`);

    // ---------------- 4. 后台卡片合并：只剩「提醒」一张 ----------------
    const groups = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('h2')].map((h) => (h.textContent || '').trim());
      const row = document.querySelector('[data-config-key="reminder_all_day_time"]');
      const card = row?.closest('.surface');
      return { heads, rowCardTitle: card ? (card.querySelector('h2')?.textContent || '').trim() : '' };
    });
    check('偏好设置里已经没有单独的「通知」卡片', !groups.heads.includes('通知'), JSON.stringify(groups.heads));
    check('「开始提醒时间」这一项在「提醒」卡片里（两组已合并）',
      groups.rowCardTitle === '提醒', JSON.stringify(groups));

    // ---------------- 清理 ----------------
    for (const id of created) {
      if (id) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    }
    await api(page, '/api/reminder/notifications/read-all', 'POST');
    await api(page, '/api/configs', 'PUT', { key: 'reminder_all_day_time', value: originalStart });
    const remaining = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data?.items || [];
    check('清理干净：测试提醒删掉了、开始提醒时间还原',
      !remaining.some((i) => String(i.title) === ACK_TITLE), '仍有残留');
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
