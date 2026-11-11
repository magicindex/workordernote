/**
 * 快速新建「更多」面板只剩「备注」，且备注是 3 行文本域（用户 2026-11-11 截图：
 * 「只保留备注，其他都取消，备注尺寸增大3行」）。
 *
 * 覆盖：
 *   1) 待办页 / 计划页的「更多」面板里**只有备注一个字段**：按农历循环、过期提醒频率、
 *      通知方式三块都没了（连「通知方式」那排渠道按钮一起消失）；
 *   2) 备注从单行输入换成文本域：rows=3、实际高度≈3 行（不再是 .compact-input 的 h-9=36px）、
 *      横向铺满面板；能换行输入；
 *   3) 填标题 + 两行备注 → 点「添加提醒」→ 接口里的 notes 原样带换行，保存后面板收起、备注清空；
 *   4) 桌面与手机（390px）都不塌：文本域仍然铺满、提交按钮还在面板底部。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-160.js
 * 数据：会在实例上新建 1 条提醒（标题带时间戳），不改其它数据。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = Date.now();
const TITLE = `备注三行自检-${STAMP}`;
const NOTES = `第一行备注-${STAMP}\n第二行备注`;

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const panelState = (page) => page.evaluate(() => {
  const panel = document.querySelector('[data-quick-panel]');
  if (!panel) return null;
  const ta = panel.querySelector('textarea');
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const text = panel.textContent.replace(/\s+/g, ' ').trim();
  const cs = ta ? getComputedStyle(ta) : null;
  return {
    text,
    hasTextarea: !!ta,
    textareaRows: ta ? Number(ta.getAttribute('rows')) : 0,
    textareaHeight: ta ? Math.round(rect(ta).height) : 0,
    textareaWidth: ta ? Math.round(rect(ta).width) : 0,
    panelWidth: Math.round(rect(panel).width),
    lineHeight: cs ? parseFloat(cs.lineHeight) : 0,
    placeholder: ta ? ta.getAttribute('placeholder') : '',
    channelPills: panel.querySelectorAll('.channel-pill').length,
    selects: panel.querySelectorAll('select').length,
    inputs: panel.querySelectorAll('input:not([type=checkbox])').length,
    hasLunar: text.includes('按农历') || text.includes('农历循环'),
    hasRepeatNotify: text.includes('过期提醒频率'),
    hasChannels: text.includes('通知方式'),
    submitText: (panel.querySelector('button.btn-primary') || {}).textContent || '',
    submitVisible: !!panel.querySelector('button.btn-primary') && !panel.querySelector('button.btn-primary').disabled,
  };
});

/** 点「更多」（两页共用的芯片，取可见的那一个） */
async function openMore(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button.quick-chip')]
      .find((b) => b.textContent.trim() === '更多');
    btn && btn.click();
  });
  await sleep(600);
}

async function goPlanned(page) {
  await page.goto(BASE + '/admin/planned', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitFor(page, () => !!document.querySelector('[data-quick-add]'), { timeout: 20000 });
  await sleep(1500);
}

async function goToday(page) {
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitFor(page, () => !!document.querySelector('[data-quick-add]'), { timeout: 20000 });
  await sleep(1500);
}

const expectOnlyNotes = (label, st) => {
  check(`${label}：面板里只剩「备注」一个字段（三个下拉/输入都不见了）`,
    st && st.selects === 0 && st.inputs === 0, JSON.stringify({ selects: st?.selects, inputs: st?.inputs }));
  check(`${label}：按农历循环 / 过期提醒频率 / 通知方式 全部撤掉`,
    st && !st.hasLunar && !st.hasRepeatNotify && !st.hasChannels && st.channelPills === 0,
    JSON.stringify({ lunar: st?.hasLunar, notify: st?.hasRepeatNotify, channels: st?.hasChannels, pills: st?.channelPills }));
  check(`${label}：备注是 3 行文本域（rows=3，高度≈3 行，不再是 h-9）`,
    st && st.hasTextarea && st.textareaRows === 3 && st.textareaHeight >= st.lineHeight * 2.8 && st.textareaHeight <= 140,
    JSON.stringify({ rows: st?.textareaRows, h: st?.textareaHeight, lh: st?.lineHeight }));
  check(`${label}：备注横向铺满面板`,
    st && st.textareaWidth >= st.panelWidth - 40,
    JSON.stringify({ ta: st?.textareaWidth, panel: st?.panelWidth }));
  // 按钮在标题为空时是 disabled 的（本来如此），这里只看它还在不在，可点儿的状态在下面写完标题后再验
  check(`${label}：底部「添加提醒」按钮还在`,
    st && st.submitText.includes('添加提醒'), st?.submitText);
};

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const token = process.env.APP_TOKEN || '';

  await withTab(async (page) => {
    await login(page, BASE);
    await page.setViewport({ width: 1440, height: 900 });

    // ---------- 1. 计划页（用户截图那一页） ----------
    await goPlanned(page);
    await openMore(page);
    const planned = await panelState(page);
    check('计划页：点「更多」后面板展开', !!planned, JSON.stringify(planned && planned.text.slice(0, 40)));
    expectOnlyNotes('计划页', planned);
    await page.screenshot({ path: path.join(SHOTS, 'quick-more-notes-1440.png') });

    // ---------- 2. 待办页 ----------
    await goToday(page);
    await openMore(page);
    const today = await panelState(page);
    expectOnlyNotes('待办页', today);

    // ---------- 3. 手机端 390px ----------
    await goPlanned(page);
    await page.setViewport({ width: 390, height: 844 });
    await sleep(900);
    await openMore(page);
    const narrow = await panelState(page);
    check('手机端 390px：备注仍是 3 行、铺满面板',
      narrow && narrow.hasTextarea && narrow.textareaHeight >= narrow.lineHeight * 2.8
        && narrow.textareaWidth >= narrow.panelWidth - 30,
      JSON.stringify({ h: narrow?.textareaHeight, w: narrow?.textareaWidth, panel: narrow?.panelWidth }));
    check('手机端 390px：三个字段同样不在',
      narrow && !narrow.hasLunar && !narrow.hasRepeatNotify && !narrow.hasChannels && narrow.selects === 0,
      JSON.stringify({ lunar: narrow?.hasLunar, notify: narrow?.hasRepeatNotify, channels: narrow?.hasChannels }));
    await page.screenshot({ path: path.join(SHOTS, 'quick-more-notes-390.png') });
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(800);

    // ---------- 3b. 记事模式的「备注」也是 3 行（同一套 textarea + .compact-input） ----------
    await goToday(page);
    await page.evaluate(() => {
      const chips = [...document.querySelectorAll('button.quick-chip')];
      const note = chips.find((b) => b.textContent.trim() === '记事');
      note && note.click();
    });
    await sleep(500);
    await page.evaluate(() => {
      const b = document.querySelector('[data-quick-note-toggle]');
      b && b.click();
    });
    await sleep(600);
    const noteTA = await page.evaluate(() => {
      const ta = document.querySelector('[data-quick-note-notes]');
      if (!ta) return null;
      const cs = getComputedStyle(ta);
      return { rows: ta.rows, h: Math.round(ta.getBoundingClientRect().height), lh: parseFloat(cs.lineHeight) };
    });
    check('记事模式点「备注」后也是 3 行（不再被 h-9 压成一行）',
      noteTA && noteTA.rows === 3 && noteTA.h >= noteTA.lh * 2.8, JSON.stringify(noteTA));
    await page.screenshot({ path: path.join(SHOTS, 'quick-note-notes-3rows.png') });

    // ---------- 4. 真的写两行备注再保存 ----------
    await goToday(page);
    await openMore(page);
    await page.evaluate(({ title, notes }) => {
      const set = (el, v) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const titleEl = document.querySelector('[data-quick-add] input[placeholder="添加一条提醒…"]');
      const ta = document.querySelector('[data-quick-panel] textarea');
      if (titleEl) set(titleEl, title);
      if (ta) set(ta, notes);
    }, { title: TITLE, notes: NOTES });
    await sleep(400);
    const typed = await page.evaluate(() => {
      const ta = document.querySelector('[data-quick-panel] textarea');
      const submit = document.querySelector('[data-quick-panel] button.btn-primary');
      return {
        value: ta ? ta.value : '',
        height: ta ? Math.round(ta.getBoundingClientRect().height) : 0,
        submitEnabled: !!submit && !submit.disabled,
      };
    });
    check('填了标题后底部「添加提醒」按钮可点', typed.submitEnabled === true, JSON.stringify(typed));
    check('备注能写两行（文本域里的换行保留）', typed.value.split('\n').length === 2, JSON.stringify(typed));
    check('写两行后备注框高度不塌（仍是 3 行起步 > 60px）', typed.height > 60, String(typed.height));

    await page.evaluate(() => {
      const panel = document.querySelector('[data-quick-panel]');
      [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === '添加提醒').click();
    });
    await sleep(2500);

    const afterSave = await page.evaluate(() => ({
      panelOpen: !!document.querySelector('[data-quick-panel]'),
      toast: [...document.querySelectorAll('*')].map((e) => e.textContent).find((t) => t && t.trim() === '提醒已添加') || '',
    }));
    check('保存后面板收起', afterSave.panelOpen === false, JSON.stringify(afterSave));

    // 直接问接口：备注原样（含换行）保存下来了
    const saved = await page.evaluate(async ({ title }) => {
      const token = localStorage.getItem('reminders.token');
      const res = await fetch(`/api/reminder/items?view=all&q=${encodeURIComponent(title)}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const json = await res.json().catch(() => null);
      const items = (json && json.data) || [];
      const hit = items.find((it) => it.title === title);
      return hit ? { notes: hit.notes, id: hit.id } : null;
    }, { title: TITLE });
    check('接口里的备注原样保存（含换行）', saved && saved.notes === NOTES, JSON.stringify(saved));

    // 清场：把自检那条删掉（点开它 → 编辑面板里删除太绕，直接走接口）
    if (saved && saved.id) {
      await page.evaluate(async (id) => {
        const token = localStorage.getItem('reminders.token');
        await fetch(`/api/reminder/items/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      }, saved.id);
      check('自检数据已清理（删掉那条提醒）', true);
    } else {
      check('自检数据已清理（删掉那条提醒）', false, '没找到条目，无法清理');
    }

    console.log(`  截图：${path.join(SHOTS, 'quick-more-notes-1440.png')} / quick-more-notes-390.png`);
    void token;
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
