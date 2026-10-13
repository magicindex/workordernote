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
    const chipTimes = {};
    for (const kind of ['today', 'tomorrow', 'weekend']) {
      await page.evaluate((k) => {
        const btns = [...document.querySelectorAll('.quick-chip')];
        const hit = btns.find((b) => (b.textContent || '').trim() === ({ today: '今天', tomorrow: '明天', weekend: '本周末' })[k]);
        hit?.click();
      }, kind);
      await sleep(400);
      chipTimes[kind] = await page.evaluate(() => document.querySelector('[data-quick-date]')?.textContent.replace(/\s+/g, ' ').trim() || '');
    }
    check('「今天」芯片的时间是 23:59',
      /23:59$/.test(chipTimes.today), JSON.stringify(chipTimes));
    check('「明天」芯片的时间是 23:59',
      /23:59$/.test(chipTimes.tomorrow), JSON.stringify(chipTimes));
    check('「本周末」芯片的时间是 23:59',
      /23:59$/.test(chipTimes.weekend), JSON.stringify(chipTimes));

    // ---------------- 2. 剩余时间（实时，时:分） ----------------
    const remain1 = await page.evaluate(() => document.querySelector('[data-quick-remaining]')?.textContent.trim() || '');
    check('芯片行显示「剩余时间」（时:分）',
      /^剩余 (\d+ 天 )?\d{2}:\d{2}$/.test(remain1), remain1);
    // 换成明天：剩余时间要跟着变（实时反映所选结束时间）
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.quick-chip')];
      btns.find((b) => (b.textContent || '').trim() === '明天')?.click();
    });
    await sleep(500);
    const remain2 = await page.evaluate(() => document.querySelector('[data-quick-remaining]')?.textContent.trim() || '');
    check('改日期后剩余时间跟着变（明天 > 今天）',
      !!remain2 && remain2 !== remain1 && /^剩余 /.test(remain2), `${remain1} → ${remain2}`);
    // 回到「今天」再确认一次（分钟级刷新不会把它刷成空）
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.quick-chip')];
      btns.find((b) => (b.textContent || '').trim() === '今天')?.click();
    });
    await sleep(400);
    const remainToday = await page.evaluate(() => document.querySelector('[data-quick-remaining]')?.textContent.trim() || '');
    check('切回「今天」后剩余时间仍然正常显示', /^剩余 /.test(remainToday), remainToday);

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
