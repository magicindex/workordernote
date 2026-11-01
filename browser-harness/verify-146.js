/**
 * 待办卡片显示「创建时间 – 结束时间」，计划循环项目不显示创建时间。
 *
 * 用户 2026-10-30 原话：「待办里面只有任务结束时间，没有当前创建时间，默认当前创建时间
 * 不在创建页面显示，只在创建列表显示，创建时间-结束时间；；计划项目因为是循环的就不显示创建时间了。」
 *
 * 用法：APP_URL=http://127.0.0.1:8919 node verify-146.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = 'CR' + Date.now().toString().slice(-6);
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
}, { base: BASE, p, method, body });

async function waitRow(page, id, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate((id) => !!document.querySelector(`[data-reminder-row="${id}"]`), id)) return true;
    await sleep(250);
  }
  return false;
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);
    const due = new Date(Date.now() + 2 * 3600_000);
    const taskTitle = `${STAMP}-待办`;
    const task = await api(page, '/api/reminder/items', 'POST', {
      title: taskTitle, due_at: due.toISOString(), repeat_rule: 'none', channels: ['inapp'],
    });
    const taskId = task.body?.data?.id;
    check('创建普通待办', task.status === 200 && !!taskId, JSON.stringify(task.body));
    check('创建时间由服务端自动生成', !!task.body?.data?.created_at, JSON.stringify(task.body?.data?.created_at));

    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await waitRow(page, taskId);
    const taskInfo = await page.evaluate((id) => {
      const row = document.querySelector(`[data-reminder-row="${id}"]`);
      return row ? {
        range: row.querySelector('[data-created-range]')?.getAttribute('data-created-range') || '',
        text: row.innerText.replace(/\s+/g, ' ').trim(),
      } : null;
    }, taskId);
    check('待办卡片出现创建–结束范围', !!taskInfo?.range && taskInfo.range.startsWith('创建 ') && taskInfo.range.includes('–'), JSON.stringify(taskInfo));
    await page.screenshot({ path: '/tmp/verify-146-todo.png' });
    await page.setViewport({ width: 390, height: 844 });
    await sleep(500);
    await page.screenshot({ path: '/tmp/verify-146-todo-390.png' });
    await page.setViewport({ width: 1280, height: 900 });
    await sleep(400);
    check('待办卡片仍显示清单与通知方式', !!taskInfo?.text.includes('工作安排') && !!taskInfo?.text.includes('站内'), taskInfo?.text.slice(0, 120));

    // 创建页不出现创建时间输入/说明。
    await page.click('[data-new-reminder]').catch(async () => {
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /新建提醒/.test(b.textContent || ''))?.click());
    });
    await sleep(700);
    const editorHasCreated = await page.evaluate(() => {
      const panel = document.querySelector('.modal-panel') || document.querySelector('[role="dialog"]');
      return !!panel && /创建时间/.test(panel.innerText || '');
    });
    check('创建页面不显示创建时间', !editorHasCreated);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(400);

    // 计划页的循环项目不显示创建时间。
    const planTitle = `${STAMP}-计划`;
    const plan = await api(page, '/api/reminder/items', 'POST', {
      title: planTitle, due_at: new Date(Date.now() + 2 * 86400_000).toISOString(), repeat_rule: 'daily', channels: ['inapp'],
    });
    const planId = plan.body?.data?.id;
    check('创建循环计划项目', plan.status === 200 && !!planId, JSON.stringify(plan.body));
    await page.goto(BASE + '/admin/planned', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await waitRow(page, planId);
    const planInfo = await page.evaluate((id) => {
      const row = document.querySelector(`[data-reminder-row="${id}"]`);
      return row ? { hasRange: !!row.querySelector('[data-created-range]'), text: row.innerText.replace(/\s+/g, ' ').trim() } : null;
    }, planId);
    check('计划卡片不显示创建时间', !!planInfo && !planInfo.hasRange && !planInfo.text.includes('创建 '), JSON.stringify(planInfo));
    await page.screenshot({ path: '/tmp/verify-146-plan.png' });
    check('计划卡片仍显示周期', !!planInfo?.text.includes('每天'), planInfo?.text.slice(0, 100));

    // 循环项目出现在「全部」时也不能带创建时间。
    await page.goto(BASE + '/admin/all', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    await waitRow(page, planId);
    check('全部视图里循环项目仍不显示创建时间', await page.evaluate((id) => !document.querySelector(`[data-reminder-row="${id}"] [data-created-range]`), planId));

    await api(page, `/api/reminder/items/${taskId}`, 'DELETE').catch(() => {});
    await api(page, `/api/reminder/items/${planId}`, 'DELETE').catch(() => {});
  }, { width: 1280, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
