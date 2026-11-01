/**
 * 手机日历（用户 2026-10-29 原话：
 * 「取消 安卓客户端，清理相关文件及说明。分析一下怎么能同步手机日历，
 *   我想让软件支持同步内容到手机日历，或者日历添加信息同步到软件」）。
 *
 * 钉住这几条：
 *   1. 安卓客户端入口/接口已经不存在；
 *   2. 偏好设置里有「手机日历」卡，订阅地址是带令牌的 .ics 公开地址；
 *   3. 订阅地址能取到合法 VCALENDAR，ETag 支持 304，坏令牌 404；
 *   4. 页面能导入 .ics，重复导入会跳过；
 *   5. 重置订阅地址后旧地址立即失效，新地址可用；
 *   6. 手机 390px 下卡片不横向溢出。
 *
 * 用法：APP_URL=http://127.0.0.1:8919 node verify-142.js
 */
const fs = require('fs');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const TITLE = `日历导入自检 ${STAMP}`;
const ICS_PATH = `/tmp/verify-142-${STAMP}.ics`;
fs.writeFileSync(ICS_PATH, [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//WorkOrderNote//verify-142//CN',
  'BEGIN:VEVENT',
  `UID:verify-142-${STAMP}`,
  'DTSTART;TZID=Asia/Shanghai:20261201T093000',
  'DTEND;TZID=Asia/Shanghai:20261201T103000',
  `SUMMARY:${TITLE}`,
  'DESCRIPTION:自检导入\\, 不要删除别人的数据',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n'));

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const text = (page) => page.evaluate(() => document.body.innerText);

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setBypassServiceWorker(true);
    await page.setCacheEnabled(false);
    let token = '';
    let importedId = 0;
    try {
      await login(page, BASE);
      token = await page.evaluate(() => localStorage.getItem('reminders.token') || '');

      // 1. 安卓客户端已下线：公开接口与页面入口都不该再出现。
      const androidApi = await page.evaluate(async (base) => {
        const r = await fetch(base + '/api/reminder/android');
        return { status: r.status, type: r.headers.get('content-type') || '', body: await r.text() };
      }, BASE);
      // 路由删掉后，未知的 /api 路径会落到前端的 index.html（200 HTML）；
      // 只要不再是原来的 JSON 数据，就说明接口已经下线。
      check('安卓客户端数据接口已下线', androidApi.status === 404 || (!androidApi.type.includes('json') && !androidApi.body.includes('apk_url')),
        `status=${androidApi.status} type=${androidApi.type}`);

      const adminMeta = await page.evaluate(async (t) => {
        const r = await fetch('/api/configs/meta', { headers: { Authorization: 'Bearer ' + t } });
        const body = await r.json();
        return { status: r.status, items: Array.isArray(body.data) ? body.data : [] };
      }, token);
      const androidMeta = adminMeta.items.filter((it) => /^android/i.test(it.key) || it.group === 'android');
      check('后台设置元数据无安卓客户端项', adminMeta.status === 200 && androidMeta.length === 0,
        JSON.stringify(androidMeta));

      const adminConfigs = await page.evaluate(async (t) => {
        const r = await fetch('/api/configs', { headers: { Authorization: 'Bearer ' + t } });
        const body = await r.json();
        return { status: r.status, data: body.data || {} };
      }, token);
      const androidConfigKeys = Object.keys(adminConfigs.data).filter((k) => /^android/i.test(k));
      check('后台设置接口无安卓配置残留', adminConfigs.status === 200 && androidConfigKeys.length === 0,
        JSON.stringify(androidConfigKeys));

      await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      const mobileTab = await page.$('[data-settings-tab="mobile"]');
      if (mobileTab) { await mobileTab.click(); await sleep(500); }
      const settings = await text(page);
      check('偏好设置有手机日历卡', settings.includes('手机日历') && settings.includes('订阅到手机日历'));
      check('不再出现安卓客户端入口', !settings.includes('安卓客户端'));

      const url = await page.$eval('[data-calendar-url]', (el) => el.value);
      check('订阅地址是 .ics 公开地址', /^https?:\/\/.+\/api\/calendar\/feed\/[\w-]+\.ics$/.test(url), url);

      // 2. 订阅内容与缓存头。
      const feed = await page.evaluate(async (u) => {
        const r = await fetch(u);
        const body = await r.text();
        return { status: r.status, type: r.headers.get('content-type'), etag: r.headers.get('etag'), body };
      }, url);
      check('订阅地址无需登录即可读取', feed.status === 200, `status=${feed.status}`);
      check('返回 text/calendar', (feed.type || '').includes('text/calendar'), feed.type || '');
      check('内容是 VCALENDAR', feed.body.includes('BEGIN:VCALENDAR') && feed.body.includes('END:VCALENDAR'));
      const notModified = await page.evaluate(async ({ u, etag }) => {
        const r = await fetch(u, { headers: { 'If-None-Match': etag } });
        return r.status;
      }, { u: url, etag: feed.etag });
      check('ETag 命中返回 304', notModified === 304, `status=${notModified}`);
      const badToken = await page.evaluate(async (base) => (await fetch(base + '/api/calendar/feed/aaaaaaaaaaaaaaaaaaaaaaaa.ics')).status, BASE);
      check('坏令牌返回 404', badToken === 404, `status=${badToken}`);

      // 3. 页面导入 .ics，重复导入跳过。
      const input = await page.$('[data-calendar-import]');
      await input.uploadFile(ICS_PATH);
      const imported = await waitFor(page, () => document.body.innerText.includes('已导入 1 条'), { timeout: 20000 });
      check('页面导入 .ics 成功', imported);
      await input.uploadFile(ICS_PATH);
      const skipped = await waitFor(page, () => /跳过 1 条重复项/.test(document.body.innerText), { timeout: 20000 });
      check('重复导入会跳过', skipped);

      const afterImport = await page.evaluate(async (u) => (await (await fetch(u)).text()), url);
      check('导入的日程进入订阅', afterImport.includes(TITLE));
      for (const block of afterImport.split('BEGIN:VEVENT').slice(1)) {
        if (!block.includes('SUMMARY:' + TITLE)) continue;
        const m = block.match(/UID:workordernote-(\d+)@local/);
        if (m) importedId = Number(m[1]);
      }

      // 4. 重置订阅地址：旧地址失效、新地址可用。
      const oldUrl = await page.$eval('[data-calendar-url]', (el) => el.value);
      page.once('dialog', (d) => d.accept());
      await page.click('[data-calendar-rotate]');
      const rotated = await page.waitForFunction(
        (old) => document.querySelector('[data-calendar-url]')?.value !== old,
        { timeout: 15000 }, oldUrl,
      ).then(() => true).catch(() => false);
      const newUrl = await page.$eval('[data-calendar-url]', (el) => el.value);
      check('重置后订阅地址变化', rotated && newUrl !== oldUrl);
      const oldStatus = await page.evaluate(async (u) => (await fetch(u)).status, oldUrl);
      let newStatus = await page.evaluate(async (u) => (await fetch(u)).status, newUrl);
      // 公开接口有每分钟次数限制；连续跑本脚本时可能刚好撞上 429，等窗口过去再确认一次。
      if (newStatus === 429) {
        console.log('  · 命中公开接口限流，等待 61 秒后重试');
        await sleep(61000);
        newStatus = await page.evaluate(async (u) => (await fetch(u)).status, newUrl);
      }
      check('旧订阅地址立即失效', oldStatus === 404, `status=${oldStatus}`);
      check('新订阅地址可用', newStatus === 200, `status=${newStatus}`);

      // 5. 390px 下不横向溢出。
      await page.setViewport({ width: 390, height: 844 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1600);
      const width = await page.$eval('[data-calendar-sync]', (el) => Math.round(el.getBoundingClientRect().width));
      check('手机宽度下卡片不溢出', width <= 390, `width=${width}`);
    } finally {
      // 删掉自检创建的提醒，别把测试数据留在实例里。
      if (token && importedId) {
        try {
          const status = await page.evaluate(async ({ base, token, id }) => {
            const r = await fetch(base + '/api/reminder/items/' + id, {
              method: 'DELETE',
              headers: { Authorization: 'Bearer ' + token },
            });
            return r.status;
          }, { base: BASE, token, id: importedId });
          console.log(`  · 清理自检提醒 #${importedId}：${status}`);
        } catch { /* 清理失败不影响结论 */ }
      }
      try { fs.unlinkSync(ICS_PATH); } catch { /* ignore */ }
    }
  }, { width: 1440, height: 950 });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
