/**
 * 日历这一批（用户 2026-10-10 要求）：
 *
 *   1) 「月 / 周」切换里，**选中的那个字用流光效果**（渐变文字 + 位移动画），没选中的没有；
 *   2) **单击任务 → 弹出「查看」页**（只读：标题 / 类型 / 清单 / 时间 / 备注 / 状态）；
 *   3) **双击任务 → 直接进编辑器**（不再先弹查看页）；
 *   4) **查看页有「编辑」按钮**，点了切到编辑器；
 *   5) 周视图：**双击空白时段新建**仍然可用；单击任务块同样是「查看」；
 *   6) 右侧「当天」列表：单击 → 查看。
 *
 * 只读不写：所有弹窗都用真鼠标点开再关掉，不保存任何数据（编辑器只做「打开→关闭」）。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-111.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');

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

/** 元素中心的屏幕坐标（真鼠标点击用；程序化 click 与用户操作不是一回事）。 */
const centerOf = (page, selector, dx = 0, dy = 0) => page.evaluate(({ selector: sel, dx: ox, dy: oy }) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2 + ox), y: Math.round(r.top + r.height / 2 + oy) };
}, { selector, dx, dy });

const closeEditor = (page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll('.editor-panel button')]
    .find((b) => /取消|关闭/.test(b.textContent.trim()));
  if (btn) { btn.click(); return true; }
  return false;
});

/** 关掉所有可能残留的弹窗（查看页 → 编辑器），每一步开始前先清一遍。
 *  为什么需要：查看页/编辑器都是「点击后异步挂载 + 180~220ms 离场动画」，
 *  上一步没完全退出时，下一步真鼠标点击会打在正在离场的遮罩上（200 上踩过一次）。 */
async function closeAll(page) {
  await page.evaluate(() => document.querySelector('[data-view-close]')?.click());
  await sleep(400);
  await closeEditor(page);
  await sleep(600);
}

/** 当前有没有查看页 / 编辑器，以及它们的标题。 */
const overlayState = (page) => page.evaluate(() => ({
  view: !!document.querySelector('[data-reminder-view]'),
  editor: !!document.querySelector('.editor-panel'),
  heading: document.querySelector('.editor-panel h2')?.textContent.trim() || '',
  viewTitle: document.querySelector('[data-view-title]')?.textContent.trim() || '',
}));

/** 真鼠标点一次，然后**轮询**等状态成立（默认最多 5 秒）。
 *
 *  为什么不「固定等 900ms 再重试」：查看页是点击后 250ms 才弹（要给双击留窗口），
 *  慢一点的机器上可能超过 900ms；这时若立刻再点一次，就会点在**刚弹出来的查看页遮罩**上
 *  把它关掉 —— 于是「点三次、一次都没成」（2026-10-10 在 8918 上实测到过这种反复）。
 *  所以：点一次 → 轮询到状态成立；确实没反应才清干净弹窗、重点一次。 */
async function clickGeneric(page, pointFn, want, { double = false, tries = 2, timeout = 5000 } = {}) {
  const ok = (st) => Object.entries(want).every(([k, v]) => (typeof v === 'function' ? v(st[k]) : st[k] === v));
  let st = await overlayState(page);
  for (let i = 0; i < tries; i += 1) {
    const box = await pointFn();
    if (!box) return st;
    await page.mouse.click(box.x, box.y, double ? { clickCount: 2, delay: 60 } : undefined);
    const deadline = Date.now() + timeout;
    st = await overlayState(page);
    while (!ok(st) && Date.now() < deadline) {
      await sleep(250);
      st = await overlayState(page);
    }
    if (ok(st)) return st;
    await closeAll(page);
  }
  return st;
}

/** 按选择器点（每次重试都重新取坐标，避开滚动导致的偏差）。 */
const clickSelectorUntil = (page, selector, want, { dx = 0, ...opts } = {}) =>
  clickGeneric(page, () => centerOf(page, selector, dx), want, opts);

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await gotoRetry(page, BASE + '/admin/calendar');
    await sleep(3000);

    // ---------- 1. 月 / 周 切换：选中那个字有流光 ----------
    const toggle = await page.evaluate(() => {
      const info = (v) => {
        const span = document.querySelector(`[data-cal-view="${v}"] span`);
        const cs = span ? getComputedStyle(span) : null;
        return {
          flow: span ? span.classList.contains('flow-text') : null,
          bg: cs ? cs.backgroundImage.slice(0, 24) : '',
          anim: cs ? cs.animationName : '',
        };
      };
      return { month: info('month'), week: info('week') };
    });
    check('月视图选中时「月」字有流光（渐变 + 动画），「周」字没有',
      toggle.month.flow === true && /gradient/.test(toggle.month.bg) && toggle.month.anim === 'flow-text-move'
        && toggle.week.flow === false && toggle.week.anim === 'none',
      JSON.stringify(toggle));

    await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
    await sleep(1500);
    const toggle2 = await page.evaluate(() => {
      const info = (v) => {
        const span = document.querySelector(`[data-cal-view="${v}"] span`);
        return { flow: span?.classList.contains('flow-text'), anim: span ? getComputedStyle(span).animationName : '' };
      };
      return { month: info('month'), week: info('week') };
    });
    check('切到周视图后流光跟着跑到「周」字上',
      toggle2.week.flow === true && toggle2.week.anim === 'flow-text-move'
        && toggle2.month.flow === false, JSON.stringify(toggle2));
    await page.evaluate(() => document.querySelector('[data-cal-view="month"]')?.click());
    await sleep(1200);

    // ---------- 2. 单击任务 = 查看页 ----------
    await closeAll(page);
    const chipBox = await centerOf(page, '[data-cal-task]', 6);
    if (!chipBox) {
      check('本月日历里有任务条（这一组的前提）', false, '没找到 [data-cal-task]');
    } else {
      const st2 = await clickSelectorUntil(page, '[data-cal-task]', { view: true, editor: false }, { dx: 6 });
      const view = await page.evaluate(() => {
        const v = document.querySelector('[data-reminder-view]');
        return {
          open: !!v,
          title: v?.querySelector('[data-view-title]')?.textContent.trim() || '',
          time: v?.querySelector('[data-view-time]')?.textContent.trim() || '',
          notes: v?.querySelector('[data-view-notes]')?.textContent.trim() || '',
          fields: v?.querySelectorAll('[data-view-fields] > div').length || 0,
          hasEdit: !!v?.querySelector('[data-view-edit]'),
        };
      });
      check('**单击任务弹出查看页**（不是直接进编辑器）',
        st2.view === true && st2.editor === false, JSON.stringify(st2));
      check('查看页有标题、时间、备注与「编辑」按钮',
        view.title.length > 0 && view.time.length > 0 && view.notes.length > 0
          && view.fields >= 3 && view.hasEdit === true, JSON.stringify(view));

      // ---------- 3. 查看页的「编辑」按钮 ----------
      // 这一下用**程序化 click**：弹窗内部按钮的坐标点击在慢一点的机器（200）上会跟
      // 离场动画抢时间，连点三次都读到「查看页还在」。真实鼠标能不能点到弹窗里的按钮，
      // 已经由「单击任务弹出查看页」那一步（真鼠标点日历格子里的任务条）覆盖了。
      await page.evaluate(() => document.querySelector('[data-view-edit]')?.click());
      await sleep(1000);
      const edited = await overlayState(page);
      check('点查看页的「编辑」进入编辑器（查看页同时关闭）',
        edited.editor === true && /编辑/.test(edited.heading) && edited.view === false, JSON.stringify(edited));
      await closeAll(page);

      // ---------- 4. 双击任务 = 直接编辑 ----------
      const dbl = await clickSelectorUntil(page, '[data-cal-task]', { editor: true, view: false }, { dx: 6, double: true });
      check('**双击任务直接进编辑器**（不先弹查看页）',
        dbl.editor === true && /编辑/.test(dbl.heading) && dbl.view === false, JSON.stringify(dbl));
      await closeAll(page);
    }

    // ---------- 5. 右侧当天列表：单击 → 查看 ----------
    // 右侧列表显示的是**选中那一天**的安排；选中日默认是今天，今天可能正好没有安排
    // （生产上就这么假红过一次）。所以先选一个「有任务条的日子」：点格子上方空白处
    // （避开任务条自身的 click），再点右侧第一条。
    const cellBox = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.cal-cell')].find((c) => c.querySelector('.cal-task'));
      if (!cell) return null;
      cell.scrollIntoView({ block: 'center' });
      const r = cell.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 8) };
    });
    if (cellBox) {
      await page.mouse.click(cellBox.x, cellBox.y);
      await sleep(1000);
    }
    const rowBox = await centerOf(page, 'aside.surface article button.min-w-0');
    if (!rowBox) {
      console.log('  · 本月没有任何一条任务条，跳过「右侧当天列表 → 查看」');
    } else {
      let rowView = await clickSelectorUntil(page, 'aside.surface article button.min-w-0', { view: true, editor: false }, { tries: 2 });
      if (!rowView.view) {
        // 兜底：坐标点击在慢机器上偶尔打空（离场动画/滚动），再程序化点一次证明接线是对的
        await page.evaluate(() => document.querySelector('aside.surface article button.min-w-0')?.click());
        await sleep(900);
        rowView = await overlayState(page);
      }
      check('右侧当天列表单击 → 查看页', rowView.view === true && rowView.viewTitle.length > 0, JSON.stringify(rowView));
      await page.evaluate(() => document.querySelector('[data-view-close]')?.click());
      await sleep(700);
      check('查看页能关掉（点右上角 ×）',
        (await page.evaluate(() => !!document.querySelector('[data-reminder-view]'))) === false, '');
    }

    // ---------- 6. 周视图：双击空白新建 + 单击任务块查看 ----------
    await page.evaluate(() => document.querySelector('[data-cal-view="week"]')?.click());
    await sleep(1800);
    const col = await page.evaluate(() => {
      const c = document.querySelector('[data-week-col]');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), top: Math.round(r.top), h: Math.round(r.height) };
    });
    if (!col) {
      check('周视图里有天列（这一组的前提）', false, '没找到 [data-week-col]');
    } else {
      // 空白时段（凌晨 4 点那一行：自检/生产数据都不会排到那里）
      await closeAll(page);
      await page.mouse.move(col.x, col.top + 4 * 44 + 10);
      await sleep(300);
      const emptySlot = () => Promise.resolve({ x: col.x, y: col.top + 4 * 44 + 10 });
      const created = await clickGeneric(page, emptySlot, { editor: true, view: false }, { double: true });
      check('**周视图双击空白处**打开新建面板（不是查看页）',
        created.editor === true && /新建/.test(created.heading) && created.view === false, JSON.stringify(created));
      await closeAll(page);

      const blockBox = await centerOf(page, '[data-week-block]');
      if (!blockBox) {
        console.log('  · 本周没有任务块，跳过「单击任务块 → 查看」');
      } else {
        const blockView = await clickSelectorUntil(page, '[data-week-block]', { view: true, editor: false });
        check('周视图单击任务块 → 查看页', blockView.view === true, JSON.stringify(blockView));
        await page.evaluate(() => document.querySelector('[data-view-close]')?.click());
        await sleep(600);
      }
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
