/**
 * 计划页卡片三行 + 手机清单弹层去掉「提醒@他」（用户 2026-10-29 原话：
 * 「计划页面 名称一行（自动换行），循环周期+剩余时间 一行，备注信息一行；
 *   所有卡片类型都按此设定；手机页面清单弹出菜单里面取消 提醒@他，
 *   在下方快捷托盘中已经有 入口图标了」）。
 *
 * 钉住这几条：
 *   1. 计划页卡片第一行只有名称，**允许自动换行**（手机、桌面都不截断）；
 *      循环/倒计时/过期提醒等徽标不再挤在名称行里；
 *   2. 第二行是循环周期 + 剩余时间（同一行、不折行），没有的就整行不占位；
 *   3. 第三行是备注，固定**一行**（超出省略）；
 *   4. 原来的「时间 · 清单 · 通知方式」信息行保留，但计划页不再重复倒计时；
 *   5. 手机「清单」弹层里不再有「提醒@他」这一行，底部「提醒」标签仍能进。
 *
 * 只建一条自检提醒并在结尾删除；不改任何偏好。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-140.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
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
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}, { base: BASE, p, method, body });

async function gotoRetry(page, url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); return true; }
    catch { await sleep(1200); }
  }
  return false;
}

async function waitRow(page, slice) {
  for (let i = 0; i < 20; i += 1) {
    const ok = await page.evaluate((t) => [...document.querySelectorAll('.reminder-row')]
      .some((r) => (r.textContent || '').includes(t)), slice);
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

const measureRow = (page, slice) => page.evaluate((t) => {
  const row = [...document.querySelectorAll('.reminder-row')].find((r) => (r.textContent || '').includes(t));
  if (!row) return null;
  const btn = row.querySelector('button.min-w-0') || row.querySelector('button');
  const h3 = btn?.querySelector('h3');
  if (!btn || !h3) return null;
  const titleRow = h3.parentElement;
  const status = btn.querySelector('[data-plan-status]');
  // 备注行：按钮里唯一带 text-xs 的 <p>（完成时段那行在按钮外）
  const notes = btn.querySelector('p.text-xs');
  const line = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      height: Math.round(el.getBoundingClientRect().height * 10) / 10,
      lineHeight: parseFloat(cs.lineHeight) || null,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      overflow: cs.overflow,
    };
  };
  const metaRow = [...btn.querySelectorAll('div')].find((d) => /\d{2}\/\d{1,2} \d{2}:\d{2}/.test(d.textContent || ''));
  return {
    title: (h3.textContent || '').trim(),
    titleStyle: line(h3),
    titleScrollWidth: h3.scrollWidth,
    titleClientWidth: h3.clientWidth,
    titleRowText: (titleRow.textContent || '').replace(/\s+/g, ''),
    statusText: status ? (status.textContent || '').replace(/\s+/g, '') : '',
    statusStyle: line(status),
    statusAfterTitle: !!status && !!(titleRow.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING),
    notesText: notes ? (notes.textContent || '').trim() : '',
    notesStyle: line(notes),
    notesAfterStatus: !!notes && !!status && !!(status.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING),
    metaText: metaRow ? (metaRow.textContent || '').replace(/\s+/g, '') : '',
    hasRemainingInMeta: !!metaRow && /(剩余|已逾期)\d/.test((metaRow.textContent || '').replace(/\s+/g, '')),
  };
}, slice);

const isOneLine = (m) => !!m && m.height > 0 && (!m.lineHeight || m.height <= m.lineHeight * 1.75);

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    let madeId = 0;
    try {
      await page.setViewport({ width: 1440, height: 1000 });
      await login(page, BASE);
      await gotoRetry(page, BASE + '/admin');

      // ---------- 0. 夹具：一条长名称 + 长备注的循环任务（按计划页过滤规则一定进计划页） ----------
      // 名称要长到桌面 1440 也放不下一行（约 90 个汉字），用来验证「自动换行」而不是截断。
      const title = '自检计划卡片布局' + '长名称自动换行'.repeat(8) + STAMP;
      const notes = '自检备注信息' + '这一段故意写得很长，用来确认计划页的备注固定只占一行、超出省略。'.repeat(3) + STAMP;
      const due = new Date();
      due.setDate(due.getDate() + 2);
      due.setHours(9, 0, 0, 0);
      const created = await api(page, '/api/reminder/items', 'POST', {
        title,
        notes,
        due_at: due.toISOString(),
        repeat_rule: 'daily',
        channels: ['inapp'],
      });
      madeId = created.body?.data?.id || 0;
      check('夹具（长名称 + 长备注的循环任务）建好了', !!madeId, JSON.stringify(created.body).slice(0, 300));
      const listName = created.body?.data?.list_name || '';

      // ---------- 1. 手机 390：名称换行、周期+剩余一行、备注一行 ----------
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await gotoRetry(page, BASE + '/admin/planned');
      check('计划页找到这条自检卡片', await waitRow(page, title.slice(0, 12)));
      await sleep(800);
      const m = await measureRow(page, title.slice(0, 12));
      check('名称完整显示在卡片里（没被省略号切掉）',
        !!m && m.title === title && m.titleStyle.textOverflow !== 'ellipsis',
        JSON.stringify(m && { title: m.title.slice(0, 20), style: m.titleStyle }));
      check('名称一行放不下时自动换行（高度超过一行）',
        !!m && !!m.titleStyle.lineHeight && m.titleStyle.height > m.titleStyle.lineHeight * 1.8,
        JSON.stringify(m && m.titleStyle));
      check('名称没有被横向裁掉（scrollWidth 不超 clientWidth）',
        !!m && m.titleScrollWidth <= m.titleClientWidth + 1,
        JSON.stringify(m && { scroll: m.titleScrollWidth, client: m.titleClientWidth }));
      check('名称那一行不再夹带「每天 / 剩余 / 已逾期」徽标',
        !!m && !/每天|剩余|已逾期/.test(m.titleRowText),
        JSON.stringify(m?.titleRowText.slice(0, 80)));
      check('第二行是「循环周期 + 剩余时间」同一行',
        !!m && /每天/.test(m.statusText) && /(剩余|已逾期)\d/.test(m.statusText)
          && m.statusAfterTitle,
        JSON.stringify(m && { status: m.statusText, afterTitle: m.statusAfterTitle }));
      check('第二行只占一行（不折行）', isOneLine(m?.statusStyle), JSON.stringify(m?.statusStyle));
      check('第三行是备注，文字完整在 DOM 里',
        !!m && m.notesText === notes && m.notesAfterStatus,
        JSON.stringify(m && { notes: m.notesText.slice(0, 30), afterStatus: m.notesAfterStatus }));
      check('备注固定只占一行、超出用省略号',
        isOneLine(m?.notesStyle) && m.notesStyle.textOverflow === 'ellipsis' && m.notesStyle.whiteSpace === 'nowrap',
        JSON.stringify(m?.notesStyle));
      check('原来的「时间 · 清单 · 通知方式」行保留',
        !!m && /\d{2}\/\d{1,2}\d{2}:\d{2}/.test(m.metaText) && !!listName && m.metaText.includes(listName),
        JSON.stringify(m && { meta: m.metaText, listName }));
      check('计划页的信息行不再重复倒计时', !!m && m.hasRemainingInMeta === false, JSON.stringify(m?.metaText));

      // ---------- 2. 桌面 1440：同样允许换行、三行结构一致 ----------
      await page.setViewport({ width: 1440, height: 1000 });
      await gotoRetry(page, BASE + '/admin/planned');
      await waitRow(page, title.slice(0, 12));
      await sleep(800);
      const d = await measureRow(page, title.slice(0, 12));
      check('桌面端名称也自动换行（不再 sm:truncate）',
        !!d && d.title === title && d.titleStyle.textOverflow !== 'ellipsis'
          && !!d.titleStyle.lineHeight && d.titleStyle.height > d.titleStyle.lineHeight * 1.8,
        JSON.stringify(d && d.titleStyle));
      check('桌面端第二行仍是周期+剩余一行', isOneLine(d?.statusStyle) && /每天/.test(d?.statusText || ''), JSON.stringify(d?.statusText));
      check('桌面端备注仍是一行省略', isOneLine(d?.notesStyle) && d.notesStyle.textOverflow === 'ellipsis', JSON.stringify(d?.notesStyle));
      check('桌面端计划页信息行也不重复倒计时', !!d && d.hasRemainingInMeta === false, JSON.stringify(d?.metaText));

      // ---------- 3. 手机「清单」弹层：没有提醒@他，底部「提醒」入口还在 ----------
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await gotoRetry(page, BASE + '/admin');
      await sleep(1200);
      const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.mobile-tabbar .mobile-tab small'))
        .map((el) => (el.textContent || '').trim()));
      check('底部快捷托盘里「提醒」入口还在', tabs.includes('提醒'), JSON.stringify(tabs));
      await page.click('[data-tab-lists]');
      await sleep(700);
      const sheetRows = await page.evaluate(() => [...document.querySelectorAll('[data-lists-sheet-row]')]
        .map((el) => el.getAttribute('data-lists-sheet-row')));
      check('手机清单弹层里已经没有「提醒@他」行', !sheetRows.includes('nudge'), JSON.stringify(sheetRows));
      const timetableEnabled = String(await page.evaluate(async (base) => {
        const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
        const res = await fetch(base + '/api/configs', { headers: { Authorization: 'Bearer ' + token } });
        return (await res.json().catch(() => null))?.data?.timetable_enabled;
      }, BASE)) === 'true';
      check('垃圾箱仍是弹层最后一行；开了课程表时它也还在（只删提醒@他这一行）',
        sheetRows[sheetRows.length - 1] === 'trash' && (!timetableEnabled || sheetRows.includes('timetable')),
        JSON.stringify({ timetableEnabled, sheetRows }));
      await page.click('[data-lists-sheet-close]');
      await sleep(500);
      if (tabs.includes('提醒')) {
        await page.click('[data-tab-nudges]');
        await sleep(1200);
        const nd = await page.evaluate(() => location.pathname);
        check('点底部「提醒」仍能进提醒@他页', nd === '/admin/nudges', nd);
      }
    } catch (err) {
      failed += 1;
      console.log(`  ✗ 套件异常：${err.message}`);
    } finally {
      if (madeId) {
        const res = await api(page, `/api/reminder/items/${madeId}`, 'DELETE');
        check('自检提醒已删除', res.status === 200 || res.status === 204, String(res.status));
      }
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
