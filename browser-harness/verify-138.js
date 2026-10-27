/**
 * 垃圾箱：删除的提醒集中收进「智能清单 → 垃圾箱」，不再出现在「已完成」；
 * 恢复后回到原清单。侧栏与手机清单弹层里，垃圾箱始终排在最后。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-138.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
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
  let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });
async function waitGone(page, sel, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (!(await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false))) return true;
    await sleep(200);
  }
  return false;
}
async function dismissAlerts(page) {
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.includes('知道了')) b.click();
    }
  });
  await sleep(400);
}

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, BASE);
    const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
    const list = lists.find((l) => l.template !== 'credit_card' && l.template !== 'notebook' && l.template !== 'ceremony') || lists[0];
    const title = `自检垃圾桶-${Date.now()}`;
    const created = await api(page, '/api/reminder/items', 'POST', {
      title, kind: 'task', list_id: list.id,
      due_at: new Date(Date.now() + 86400000).toISOString(),
      channels: ['inapp'],
    });
    const id = created.body?.data?.id;
    check('能创建垃圾箱自检提醒', created.status === 200 && !!id, JSON.stringify(created.body).slice(0, 160));
    await api(page, `/api/reminder/items/${id}/complete`, 'POST');
    const completedBefore = (await api(page, '/api/reminder/completed?range=all')).body?.data?.items || [];
    check('完成后的提醒出现在「已完成」', completedBefore.some((x) => x.title === title));
    await api(page, `/api/reminder/items/${id}`, 'DELETE');
    const completedAfter = (await api(page, '/api/reminder/completed?range=all')).body?.data?.items || [];
    check('删除后不再出现在「已完成」', !completedAfter.some((x) => x.title === title));
    const trash = (await api(page, '/api/reminder/trash')).body?.data?.items || [];
    check('删除后进入垃圾箱', trash.some((x) => Number(x.id) === Number(id)));
    const allItems = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [];
    check('默认「全部」不包含已删除提醒', !allItems.some((x) => Number(x.id) === Number(id)));

    await page.goto(BASE + '/admin/trash', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    await dismissAlerts(page);
    const sideOrder = await page.evaluate(() => {
      const trash = document.querySelector('[data-nav-trash]');
      const after = [...document.querySelectorAll('aside .nav-row')].filter((e) => e !== trash && e.getClientRects().length
        && (trash.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { trash: !!trash, after: after.map((e) => e.getAttribute('href')) };
    });
    check('侧栏垃圾箱排在全部可见清单最后', sideOrder.trash && sideOrder.after.length === 0, JSON.stringify(sideOrder));
    check('垃圾箱页显示该条', await page.evaluate((tid) => !!document.querySelector(`[data-trash-item][data-trash-id="${tid}"]`), id));
    await page.screenshot({ path: 'shots/trash-1440.png' });

    await page.click(`[data-trash-item][data-trash-id="${id}"] [data-trash-restore]`);
    check('点恢复后该条从垃圾箱消失', await waitGone(page, `[data-trash-item][data-trash-id="${id}"]`));
    const trashAfter = (await api(page, '/api/reminder/trash')).body?.data?.items || [];
    check('恢复后接口垃圾箱也不再返回', !trashAfter.some((x) => Number(x.id) === Number(id)));
    const completedRestored = (await api(page, '/api/reminder/completed?range=all')).body?.data?.items || [];
    check('恢复后完成记录回到「已完成」', completedRestored.some((x) => x.title === title));

    // 自检收尾：再删一次（仍留在垃圾箱，但不再出现在清单/已完成）。
    await api(page, `/api/reminder/items/${id}`, 'DELETE');

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    await page.click('[data-tab-lists]');
    await sleep(500);
    const sheetOrder = await page.evaluate(() => [...document.querySelectorAll('[data-lists-sheet-row]')].map((e) => e.getAttribute('data-lists-sheet-row')));
    check('手机清单弹层垃圾箱排最后', sheetOrder[sheetOrder.length - 1] === 'trash', JSON.stringify(sheetOrder));
    await page.screenshot({ path: 'shots/trash-sheet-390.png' });
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
