/**
 * 记事本栏目 + 「全部」页时间范围条 + 导出对话框（这批）：
 *   1) 记事本偏好 notebook_enabled 默认开、登记为个人偏好、归在「功能开关」组
 *   2) 侧栏有记事本固定入口；新建记事一律落到记事本栏目，且不混进默认清单
 *   3) 记事本按创建（记录）时间倒序
 *   4) 智能清单「全部」仍能看到这些记事
 *   5) 「全部」页范围条 chips 存在且默认「本月」；切「今年」能多出其它月份的条目
 *   6) 导出对话框：选清单与列，CSV 表头与所选列一致
 *   7) 记事行前面是**清单图标 + 清单颜色**（用户 2026-10-17），任务行仍是勾选框
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-103.js
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now();

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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 导出是 CSV */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}
async function waitSel(page, sel, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate((q) => !!document.querySelector(q), sel).catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}
/** 按 CSV 规则解析成记录数组（备注里有换行，不能按行 split）。 */
function parseCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const records = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); records.push(row); row = []; cur = ''; }
    else if (ch === '\r') { /* 跳过 */ }
    else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); records.push(row); }
  return records;
}

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    const created = [];
    const iso = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      const off = -d.getTimezoneOffset();
      const s = off >= 0 ? '+' : '-';
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${s}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
    };
    const seed = async (body) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await api(page, '/api/reminder/items', 'POST', body);
        const id = res.body?.data?.id;
        if (id) { created.push(id); return id; }
        await sleep(6000);   // 多半是登录限流（20 次/分钟），退避后重试
      }
      return null;
    };

    const now = new Date();
    const cm = now.getMonth();
    // 同年、但不在本月的一个月份（1 月取 12 月，其余取 1 月或 12 月）
    const om = cm === 0 ? 11 : (cm >= 6 ? 0 : 11);
    const thisMonthDay = new Date(now.getFullYear(), cm, 15, 10, 0, 0, 0);
    const otherMonthDay = new Date(now.getFullYear(), om, 10, 10, 0, 0, 0);

    const noteATitle = `自检记事A-${STAMP}`;
    const noteBTitle = `自检记事B-${STAMP}`;
    const thisTaskTitle = `自检本月任务-${STAMP}`;
    const otherTaskTitle = `自检他月任务-${STAMP}`;
    const seeded = [];
    seeded.push(await seed({ title: noteATitle, kind: 'note', channels: ['inapp'] }));
    seeded.push(await seed({ title: noteBTitle, kind: 'note', channels: ['inapp'] }));
    seeded.push(await seed({ title: thisTaskTitle, due_at: iso(thisMonthDay), repeat_rule: 'none', channels: ['inapp'] }));
    seeded.push(await seed({ title: otherTaskTitle, due_at: iso(otherMonthDay), repeat_rule: 'none', channels: ['inapp'] }));
    check('自检数据都已建号（没有被限流吞掉）', seeded.every(Boolean), String(seeded.filter(Boolean).length) + '/' + seeded.length);

    await page.setViewport({ width: 1280, height: 900 });

    // ---------- 1. 记事本偏好默认开 ----------
    const meta = (await api(page, '/api/configs/user/meta')).body?.data || [];
    const nb = meta.find((c) => c.key === 'notebook_enabled') || null;
    check('记事本偏好已登记为个人偏好且默认开启',
      nb?.scope === 'user' && nb?.default === 'true',
      `scope=${nb?.scope} default=${nb?.default}`);
    check('记事本偏好归在「功能开关」分组', nb?.group === 'features', String(nb?.group));

    // ---------- 2. 记事本栏目 + 记事落库 ----------
    const lists = (await api(page, '/api/reminder/lists')).body?.data || [];
    const bucket = lists.find((l) => l.template === 'notebook') || null;
    check('记事本栏目用的是「笔记本」图标（不是默认清单图标）',
      bucket?.icon === 'notebook', JSON.stringify({ icon: bucket?.icon }));
    check('清单接口里有固定的「随手记事本」栏目（0.19.0 起改名）', !!bucket && bucket.name === '随手记事本',
      JSON.stringify({ id: bucket?.id, name: bucket?.name, template: bucket?.template }));

    const noteA = (await api(page, `/api/reminder/items/${seeded[0]}`)).body?.data || {};
    const noteB = (await api(page, `/api/reminder/items/${seeded[1]}`)).body?.data || {};
    check('新建记事落到记事本栏目', noteA.list_id === bucket?.id && noteB.list_id === bucket?.id,
      `A.list=${noteA.list_id} B.list=${noteB.list_id} bucket=${bucket?.id}`);

    const defaultList = lists.find((l) => l.is_default && l.template !== 'notebook') || null;
    if (defaultList) {
      const defItems = (await api(page, `/api/reminder/items?view=all&status=all&list_id=${defaultList.id}`)).body?.data || [];
      check('记事不会混进默认清单', !defItems.some((i) => i.title === noteATitle),
        defItems.map((i) => i.title).slice(0, 6).join('|'));
    } else {
      check('记事不会混进默认清单（无默认清单，跳过）', true);
    }

    // ---------- 3. 侧栏固定入口 ----------
    await gotoRetry(page, BASE + '/admin');
    const navEntry = await waitSel(page, '[data-nav-notebook]', 20000);
    check('侧栏有「随手记事本」固定入口', navEntry);
    if (navEntry) {
      // 侧栏这一行原来是**写死**的一本书（不读清单数据里的 icon）：只查接口会漏掉它，
      // 用户看到的还是旧的。这里直接看渲染出来的 SVG —— 笔记本有书签飘带
      // （M12.5 3.5v6.4），书（旧图标）是 M12 6.5C10.5 5.3 那条中缝。
      const navIcon = await page.evaluate(() => document.querySelector('[data-nav-notebook] svg')?.innerHTML || '');
      check('侧栏记事本那一行画的是「笔记本」图标（不是旧的书本图标）',
        navIcon.includes('M12.5 3.5') && !navIcon.includes('M12 6.5C10.5 5.3'),
        navIcon.slice(0, 100));
      await page.evaluate(() => document.querySelector('[data-nav-notebook]').click());
      await sleep(1200);
      const onPage = await page.evaluate((id) => ({
        onPage: location.pathname === `/admin/list/${id}`,
        title: document.querySelector('h1')?.innerText.trim() || '',
      }), bucket?.id);
      check('点进去是随手记事本栏目页，标题为「随手记事本」', onPage.onPage && onPage.title === '随手记事本', JSON.stringify(onPage));
    }

    // ---------- 4. 记事本按创建（记录）时间倒序 ----------
    await gotoRetry(page, BASE + `/admin/list/${bucket?.id}`);
    await waitSel(page, '.reminder-row', 20000);
    await sleep(1500);
    const noteRows = await page.evaluate(() =>
      [...document.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' ')));
    const ia = noteRows.findIndex((t) => t.includes(noteATitle));
    const ib = noteRows.findIndex((t) => t.includes(noteBTitle));
    check('记事本里两条记事都在，且后建的排在前面（按创建时间倒序）',
      ia !== -1 && ib !== -1 && ib < ia,
      `A@${ia} B@${ib} | ${JSON.stringify(noteRows.slice(0, 4))}`);
    await page.screenshot({ path: path.join(SHOTS, 'notebook-list.png') });

    // ---------- 4b. 记事本里不画删除线（记事是记录，不是完成的任务） ----------
    const noteStyle = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.reminder-row')].find((r) => /记事/.test(r.textContent));
      if (!row) return null;
      const h3 = row.querySelector('h3');
      const cs = h3 ? getComputedStyle(h3) : null;
      return {
        hasCompletedClass: row.className.includes('reminder-completed'),
        decoration: cs ? cs.textDecorationLine : '',
        opacity: getComputedStyle(row).opacity,
      };
    });
    check('记事本里的记事没有删除线、也没有变灰',
      !!noteStyle && noteStyle.hasCompletedClass === false
      && !String(noteStyle.decoration).includes('line-through'),
      JSON.stringify(noteStyle));

    // ---------- 4c. 历史记事（以前录在别的清单里的）也归到了记事本 ----------
    const noteCheck = await api(page, '/api/reminder/items?view=all&status=all');
    const notes = (noteCheck.body?.data || []).filter((i) => i.kind === 'note');
    const strays = notes.filter((i) => i.list_id !== bucket?.id);
    check(`所有记事都在记事本栏目里（${notes.length} 条，散落在外的 ${strays.length} 条）`,
      notes.length > 0 && strays.length === 0,
      JSON.stringify(strays.map((i) => `${i.title}@${i.list_name}`).slice(0, 4)));

    // ---------- 4d. 记事行前面是「清单图标 + 清单颜色」，不是勾选框 ----------
    // 用户 2026-10-17：「随手记事本 页面，项目列表前边的复选按钮改成 记事本图标，颜色与列表颜色一致」。
    const noteSlot = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.reminder-row')].find((r) => /记事/.test(r.textContent));
      const btn = row?.querySelector('.complete-button');
      const svg = btn?.querySelector('svg');
      const h3 = row?.querySelector('h3');
      if (!btn) return null;
      return {
        noteClass: btn.className.includes('complete-button-note'),
        borderWidth: getComputedStyle(btn).borderTopWidth,
        bg: getComputedStyle(btn).backgroundColor,
        disabled: btn.disabled,
        icon: !!svg,
        iconColor: svg ? getComputedStyle(svg).color : '',
        titleColor: h3 ? getComputedStyle(h3).color : '',
      };
    });
    check('记事行前面画的是图标，不再是那个勾选框（无边框、无底色）',
      !!noteSlot && noteSlot.noteClass === true && noteSlot.icon === true && noteSlot.borderWidth === '0px',
      JSON.stringify(noteSlot));
    check('图标用的是清单颜色（与同一行标题同色）',
      !!noteSlot && !!noteSlot.iconColor && noteSlot.iconColor === noteSlot.titleColor,
      JSON.stringify({ icon: noteSlot?.iconColor, title: noteSlot?.titleColor }));

    // ---------- 4e. 点开一条记事：编辑器从**左侧**划出，备注吃掉下方剩余高度 ----------
    // 用户 2026-10-18：「点击条目，左侧弹出编辑窗口，不改变当前格局，把下方剩余空间划给备注」。
    await page.evaluate(() => {
      const btn = document.querySelector('.reminder-row button.min-w-0.flex-1.text-left');
      if (btn) btn.click();
    });
    await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 10000 });
    await sleep(500);
    const noteDrawer = await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      const ta = panel.querySelector('textarea');
      return {
        left: Math.round(r.left),
        gapRight: Math.round(document.documentElement.clientWidth - r.right),
        height: Math.round(r.height),
        viewportH: document.documentElement.clientHeight,
        notesHeight: ta ? Math.round(ta.getBoundingClientRect().height) : 0,
      };
    });
    check('点记事从左侧划出编辑器（列表留在原位，不被右侧抽屉盖住）',
      !!noteDrawer && noteDrawer.left <= 2 && noteDrawer.gapRight > 100,
      noteDrawer ? JSON.stringify(noteDrawer) : '没打开');
    check('编辑器跟随窗口全高，备注框吃掉下方剩余空间',
      !!noteDrawer && noteDrawer.height >= noteDrawer.viewportH - 2 && noteDrawer.notesHeight >= 180,
      noteDrawer ? JSON.stringify(noteDrawer) : '没打开');
    await page.evaluate(() => {
      const panel = document.querySelector('.editor-panel');
      const cancel = panel && [...panel.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '取消');
      if (cancel) cancel.click();
    });
    await sleep(600);

    // ---------- 5. 智能清单「全部」仍能看到记事 ----------
    await gotoRetry(page, BASE + '/admin/all');
    await waitSel(page, '[data-range-bar]', 20000);
    await sleep(1000);
    await page.evaluate(() => {
      const seg = document.querySelector('[role="group"][aria-label="显示范围"]');
      [...(seg?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === '全部')?.click();
    });
    await sleep(1500);
    const allRows = await page.evaluate(() =>
      [...document.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' ')));
    check('智能清单「全部」仍能看到这条记事',
      allRows.some((t) => t.includes(noteATitle)), JSON.stringify(allRows.slice(0, 6)));

    // 「全部」页里记事同样用图标（同一支模板），而**任务行仍是勾选框** —— 这次改动不该带跑它。
    // 只量**带勾选框的行**：只读的历史/汇总行本来就没有 .complete-button，
    // 以前把它们也算进来（拿到空的 borderWidth/width）会假红。
    const allSlots = await page.evaluate(() =>
      [...document.querySelectorAll('.reminder-row')]
        .map((r) => {
          const btn = r.querySelector('.complete-button');
          if (!btn) return null;
          return {
            note: /记事/.test(r.textContent),
            noteClass: btn.className.includes('complete-button-note'),
            borderWidth: getComputedStyle(btn).borderTopWidth,
            width: getComputedStyle(btn).width,
          };
        })
        .filter(Boolean));
    const noteSlots = allSlots.filter((x) => x.note);
    const taskSlots = allSlots.filter((x) => !x.note);
    check('「全部」页里记事行也是图标（无边框、不是勾选框）',
      noteSlots.length > 0 && noteSlots.every((x) => x.noteClass && x.borderWidth === '0px'),
      JSON.stringify(noteSlots.slice(0, 3)));
    check('「全部」页里任务行仍是圆勾选框（2px 边框、24px 见方）',
      taskSlots.length > 0 && taskSlots.every((x) => !x.noteClass && x.borderWidth === '2px' && x.width === '24px'),
      JSON.stringify(taskSlots.slice(0, 3)));

    // ---------- 6. 范围条 chips + 默认本月 ----------
    const rangeBar = await page.evaluate(() => ({
      exists: !!document.querySelector('[data-range-bar]'),
      ranges: [...document.querySelectorAll('[data-range]')].map((b) => b.dataset.range),
      active: document.querySelector('[data-range].active')?.dataset.range || '',
    }));
    check('「全部」页有时间范围条', rangeBar.exists, JSON.stringify(rangeBar));
    check('范围条含 7 个 chips（今天/昨天/本周/上周/本月/今年/自定义）',
      ['today', 'yesterday', 'week', 'lastweek', 'month', 'year', 'custom'].every((r) => rangeBar.ranges.includes(r)),
      JSON.stringify(rangeBar.ranges));
    check('范围条默认选中「本月」', rangeBar.active === 'month', rangeBar.active);
    await waitSel(page, '[data-range="custom"]', 5000);
    await page.evaluate(() => document.querySelector('[data-range="custom"]').click());
    const customInputs = await waitSel(page, '[data-range-from]', 5000)
      && await page.evaluate(() => !!document.querySelector('[data-range-to]'));
    check('范围条也给出「自定义」的起止日期输入', customInputs, '');
    await page.evaluate(() => document.querySelector('[data-range="month"]')?.click());
    // 列表是异步重拉的：固定 1200ms 在慢机器上会读到上一轮（「今年」）的行，改成轮询到状态对上为止。
    // 2026-11-01 起「全部」页多了一张**只读的历史逾期卡**：本月窗口之外、还没做完的
    // 逾期项会集中出现在这里（设计如此）。它不是「本月条目」，量之前要把它排掉。
    let monthRows = [];
    for (let i = 0; i < 15; i += 1) {
      monthRows = await page.evaluate(() =>
        [...document.querySelectorAll('.reminder-row')]
          .filter((r) => !r.closest('[data-history-overdue]'))
          .map((r) => r.textContent.replace(/\s+/g, ' ')));
      if (monthRows.some((t) => t.includes(thisTaskTitle)) && !monthRows.some((t) => t.includes(otherTaskTitle))) break;
      await sleep(500);
    }
    check('「本月」范围只有本月条目（他月的不出现）',
      monthRows.some((t) => t.includes(thisTaskTitle)) && !monthRows.some((t) => t.includes(otherTaskTitle)),
      JSON.stringify(monthRows.slice(0, 6)));

    await page.evaluate(() => document.querySelector('[data-range="year"]')?.click());
    await sleep(1800);
    const yearRows = await page.evaluate(() =>
      [...document.querySelectorAll('.reminder-row')].map((r) => r.textContent.replace(/\s+/g, ' ')));
    void 0;
    check('切到「今年」能多出其它月份的条目',
      yearRows.some((t) => t.includes(thisTaskTitle)) && yearRows.some((t) => t.includes(otherTaskTitle)),
      JSON.stringify(yearRows.slice(0, 8)));

    // ---------- 7. 导出对话框：选清单 + 选列 ----------
    await gotoRetry(page, BASE + '/admin/all');
    const openBtn = await waitSel(page, '[data-export-open]', 20000);
    check('「全部」页有导出按钮（data-export-open）', openBtn);
    await sleep(1500);   // 等清单接口回来，对话框的「全选清单」才有数据
    await page.evaluate(() => document.querySelector('[data-export-open]').click());
    const dialogOpen = await waitSel(page, '[data-export-confirm]', 8000)
      && await waitSel(page, '[data-export-list]', 8000);
    check('点导出打开对话框，且有确定/取消', dialogOpen
      && await page.evaluate(() => !!document.querySelector('[data-export-cancel]')));

    // 清单只留「记事本」：其余全部取消选中
    await page.evaluate((bucketId) => {
      document.querySelectorAll('[data-export-list]').forEach((btn) => {
        if (Number(btn.dataset.exportList) !== bucketId && btn.getAttribute('aria-checked') === 'true') btn.click();
      });
    }, bucket?.id);
    // 列只留「标题」与「清单」
    await page.evaluate(() => {
      document.querySelectorAll('[data-export-column]').forEach((btn) => {
        const key = btn.dataset.exportColumn;
        if (!['title', 'list'].includes(key) && btn.getAttribute('aria-checked') === 'true') btn.click();
      });
    });
    const picked = await page.evaluate(() => ({
      lists: [...document.querySelectorAll('[data-export-list][aria-checked="true"]')].length,
      columns: [...document.querySelectorAll('[data-export-column][aria-checked="true"]')].map((b) => b.dataset.exportColumn),
    }));
    check('对话框支持清单与列多选（正好选中 1 个清单、2 列）',
      picked.lists === 1 && picked.columns.length === 2 && picked.columns.includes('title') && picked.columns.includes('list'),
      JSON.stringify(picked));

    const captured = page
      .waitForResponse((res) => res.url().includes('/api/reminder/export'), { timeout: 20000 })
      .catch(() => null);
    await page.evaluate(() => document.querySelector('[data-export-confirm]').click());
    const resp = await captured;
    const csvText = resp ? await resp.text().catch(() => '') : '';
    const url = resp ? resp.url() : '';
    check('确定后真的发出导出请求', !!resp, url);
    check('导出请求带上了所选清单 lists= 与所选列 columns=',
      url.includes(`lists=${bucket?.id}`) && /columns=title(%2C|,)list/i.test(url), url);
    const records = parseCsv(csvText);
    check('导出 CSV 的表头与所选列一致（标题,清单）',
      (records[0] || []).join(',') === '标题,清单', (records[0] || []).join(',') || '空');
    const dataRows = records.slice(1);
    check('只导出了所选清单（随手记事本）的行，且每行都是 2 列',
      dataRows.length >= 2 && dataRows.every((r) => r.length === 2 && r[1] === '随手记事本'),
      JSON.stringify(dataRows.slice(0, 4)));
    check('导出的记事本数据里含刚建的记事', dataRows.some((r) => r[0] === noteATitle) && dataRows.some((r) => r[0] === noteBTitle),
      JSON.stringify(dataRows.map((r) => r[0]).slice(0, 6)));
    await page.screenshot({ path: path.join(SHOTS, 'export-dialog.png') });

    // ---------- 清理 ----------
    for (const id of created) await api(page, `/api/reminder/items/${id}`, 'DELETE');
    await sleep(700);
    const left = ((await api(page, '/api/reminder/items?view=all&status=all')).body?.data || [])
      .filter?.((i) => String(i.title).includes(`-${STAMP}`)) || [];
    check('自检数据已清理', left.length === 0, String(left.length));
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error('运行失败：', err); process.exit(1); });
