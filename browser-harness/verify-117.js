/**
 * 这一批（用户 2026-10-13 要求）：
 *
 *   点击提醒 → 弹窗（编辑提醒）→ **在同一行右侧增加删除按钮**；而且
 *   **删除只对创建提醒的用户有效**。
 *
 * 这里验界面这一半：
 *   · 编辑弹窗头部那一行里有删除按钮，位置在标题右侧、和标题同一行；
 *   · 点了会先弹确认框，确认后弹窗关闭、列表里也没了；
 *   · 「新建」时没有这个按钮（还没有东西可删）；
 *   · DTO 如实给出 can_delete（服务端按 user_id 判定，只有创建者能删）。
 * 服务端那一半由 Go 的 TestDeleteOnlyByOwner 钉住。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-117.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const STAMP = Date.now();
const TITLE = `自检删除按钮-${STAMP}`;

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
  let createdId = null;
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    // 造一条今天的提醒（列表页「今天」能直接看到）
    const made = await api(page, '/api/reminder/items', 'POST', {
      title: TITLE, due_at: new Date().toISOString(), repeat_rule: 'none', channels: ['inapp'],
    });
    createdId = made.body?.data?.id ?? null;
    check('造一条测试提醒', !!createdId, JSON.stringify(made.body).slice(0, 160));
    check('DTO 里有 can_delete 且为 true（服务端判定：创建者能删）',
      made.body?.data?.can_delete === true, JSON.stringify(made.body?.data?.can_delete));

    await gotoRetry(page, BASE + '/admin');
    await sleep(2600);

    // 点这条提醒 → 打开编辑弹窗
    const opened = await page.evaluate((title) => {
      const rows = [...document.querySelectorAll('.reminder-row')];
      const row = rows.find((r) => (r.textContent || '').includes(title));
      if (!row) return { found: false };
      const clickable = row.querySelector('button.min-w-0') || row.querySelector('button');
      clickable?.click();
      return { found: true };
    }, TITLE);
    check('在列表里找到这条提醒并点开', opened.found === true);
    await sleep(1200);

    const header = await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      if (!panel) return null;
      const btn = panel.querySelector('[data-editor-delete]');
      const heading = [...panel.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('编辑'));
      const headingBox = heading?.getBoundingClientRect();
      const btnBox = btn?.getBoundingClientRect();
      return {
        hasPanel: true,
        hasHeading: !!heading,
        hasButton: !!btn,
        disabled: btn ? btn.disabled : null,
        // 同一行：垂直中心接近；右侧：按钮在标题右边
        sameRow: !!(headingBox && btnBox) && Math.abs((headingBox.top + headingBox.height / 2) - (btnBox.top + btnBox.height / 2)) <= 12,
        toTheRight: !!(headingBox && btnBox) && btnBox.left >= headingBox.right,
        headingText: headingBox ? '' : '',
      };
    });
    check('点开的是「编辑提醒」弹窗', !!header && header.hasPanel === true && header.hasHeading === true, JSON.stringify(header));
    check('弹窗头部有删除按钮，和「编辑提醒」在**同一行**、且在**右侧**',
      !!header && header.hasButton === true && header.sameRow === true && header.toTheRight === true,
      JSON.stringify(header));
    check('删除按钮可用（创建者本人）', !!header && header.disabled === false, JSON.stringify(header));

    // 点删除 → 先出确认框
    await page.evaluate(() => document.querySelector('[data-editor-delete]')?.click());
    await sleep(700);
    const confirmShown = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const dialog = [...document.querySelectorAll('[role="dialog"], .surface-modal, [class*="modal"]')]
        .find((d) => (d.innerText || '').includes('删除提醒'));
      const confirmBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '删除' && !b.hasAttribute('data-editor-delete'));
      return { hasConfirm: !!dialog || text.includes('删除提醒'), hasConfirmButton: !!confirmBtn };
    });
    check('点删除先弹确认框（不直接删）', confirmShown.hasConfirm === true && confirmShown.hasConfirmButton === true, JSON.stringify(confirmShown));

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent || '').trim() === '删除' && !b.hasAttribute('data-editor-delete'));
      btn?.click();
    });
    await sleep(2600);

    // 编辑器关掉是带动画的，多等几次再判，别把「正在收」当成「没关」
    let editorClosed = false;
    for (let i = 0; i < 10 && !editorClosed; i += 1) {
      await sleep(400);
      editorClosed = await page.evaluate(() => !document.querySelector('.editor-panel'));
    }
    const afterDelete = await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      return {
        panelOpen: !!panel,
        panelHeading: panel ? (panel.querySelector('h2')?.textContent || '').trim() : '',
        panelTitle: panel ? (panel.querySelector('input')?.value || '').slice(0, 40) : '',
        dialog: !!document.querySelector('[role="alertdialog"]'),
        confirmOpen: !![...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '删除'),
      };
    });
    check('确认后编辑弹窗关掉', editorClosed === true && afterDelete.panelOpen === false, JSON.stringify(afterDelete));

    const listed = (await api(page, '/api/reminder/items?view=all&status=all')).body?.data?.items || [];
    check('这条提醒真的删掉了（接口里查不到）',
      !listed.some((i) => String(i.title) === TITLE), '接口里还在');
    createdId = null;

    // 新建时没有删除按钮（还没东西可删）—— 用日历的「双击日期格新建」打开编辑器
    await gotoRetry(page, BASE + '/admin/calendar');
    await sleep(2600);
    const cell = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.cal-cell')];
      const target = cells.find((c) => (c.querySelector('span')?.textContent || '').trim() === '15') || cells[10];
      if (!target) return null;
      target.scrollIntoView({ block: 'center' });
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + 8 };
    });
    check('找到日历日期格（新建编辑器这一组的前提）', !!cell);
    if (cell) {
      await page.mouse.click(cell.x, cell.y, { clickCount: 2, delay: 40 });
      await sleep(1600);
      const createMode = await page.evaluate(() => {
        const panel = document.querySelector('.editor-panel');
        const heading = panel ? [...panel.querySelectorAll('h2')].map((h) => (h.textContent || '').trim()) : [];
        return {
          panel: !!panel,
          headings: heading,
          hasDelete: !!panel?.querySelector('[data-editor-delete]'),
        };
      });
      check('新建（日历双击）时编辑器里没有删除按钮',
        createMode.panel === true && createMode.hasDelete === false, JSON.stringify(createMode));
      await page.evaluate(() => {
        const panel = document.querySelector('.editor-panel');
        [...(panel?.querySelectorAll('button') || [])].find((b) => (b.textContent || '').includes('取消'))?.click();
      });
      await sleep(600);
    }

    // 清理
    if (createdId) await api(page, `/api/reminder/items/${createdId}`, 'DELETE');
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
