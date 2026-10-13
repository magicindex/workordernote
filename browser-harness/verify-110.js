/**
 * 这一批（用户 2026-10-10 第三次反馈）的三件事：
 *
 *   1) **新建控件收成一个「新建」按钮**：默认收起，点一下才展开；
 *      **刷新、切换页面都回到收起**；快捷键 N 能展开；Esc（没写标题时）能收起。
 *   2) **「全部」页取消新建提醒**：那一页没有新建入口（连空状态的「添加第一条提醒」也没有）；
 *      在这一页按 N 会先去「今天」页再展开。
 *   3) **信用卡页头部与卡面**：
 *      · 「到期卡片」**单独一行**、放在标题下方（占满整行）；
 *      · 小卡面里的**时间信息右对齐**（位置不变，仍在卡片底部两行）；
 *      · 卡面：银行标志单独一行在左上；**卡名在标志下边、与标志左端对齐**；
 *        **持卡人与卡名同行、右对齐到卡面右边缘**；
 *      · 卡片**固定一行三张**（0.18.1 的超大屏四列已去掉）；
 *      · 银行下拉新增**支付宝 / 微信 / 京东金融**，且三个标志都能加载出来。
 *
 * 只读不写：不新建提醒、不改配置、不建卡片（弹窗读完就点「取消」）；跑完把页面停在默认状态。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-110.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

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

/** 新建入口当前形态：收起（按钮）还是展开（整块表单）。 */
const quickShape = (page) => page.evaluate(() => ({
  addBlock: !!document.querySelector('[data-quick-add]'),
  newButton: !!document.querySelector('[data-quick-new]'),
  newButtonText: (document.querySelector('[data-quick-new]')?.textContent || '').trim(),
  card: !!document.querySelector('.quick-card'),
  input: !!document.querySelector('.quick-card input'),
  chips: document.querySelectorAll('.quick-card .quick-chip').length,
  focusedPlaceholder: (document.activeElement?.getAttribute?.('placeholder') || ''),
}));

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);

    // ================= 1. 新建按钮：收起 / 展开 / 刷新 / 切页 / 快捷键 =================
    await gotoRetry(page, BASE + '/admin');
    await sleep(2200);
    let st = await quickShape(page);
    check('今天页：新建控件默认**收成一个「新建」按钮**（没有整块表单、没有输入框）',
      st.addBlock === true && st.newButton === true && st.newButtonText === '新建' && st.card === false && st.input === false,
      JSON.stringify(st));

    await page.evaluate(() => document.querySelector('[data-quick-new]')?.click());
    await sleep(600);
    st = await quickShape(page);
    check('点「新建」后展开：出现输入框与芯片行，「新建」按钮消失',
      st.card === true && st.input === true && st.chips >= 9 && st.newButton === false, JSON.stringify(st));
    check('展开后光标在标题输入框里', /提醒|记一笔/.test(st.focusedPlaceholder), st.focusedPlaceholder);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2200);
    st = await quickShape(page);
    check('**刷新**后回到收起状态（还是那个「新建」按钮）',
      st.newButton === true && st.card === false, JSON.stringify(st));

    await page.evaluate(() => document.querySelector('[data-quick-new]')?.click());
    await sleep(500);
    await gotoRetry(page, BASE + '/admin/planned');
    await sleep(2000);
    st = await quickShape(page);
    check('**切换页面**后回到收起状态（今天页展开着，进计划页也是收起的）',
      st.newButton === true && st.card === false, JSON.stringify(st));

    await page.keyboard.press('n');
    await sleep(700);
    st = await quickShape(page);
    check('快捷键 N 也能展开（计划页）', st.card === true && st.input === true, JSON.stringify(st));

    await page.keyboard.press('Escape');
    await sleep(600);
    st = await quickShape(page);
    check('没写标题时按 Esc 收起（内容不丢的前提：标题是空的）',
      st.newButton === true && st.card === false, JSON.stringify(st));

    // ================= 2. 「全部」页没有新建入口 =================
    await gotoRetry(page, BASE + '/admin/all');
    await sleep(2400);
    st = await quickShape(page);
    const allPage = await page.evaluate(() => ({
      emptyAdd: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '添加第一条提醒'),
      rangeBar: !!document.querySelector('[data-range-bar]'),
      rows: document.querySelectorAll('.reminder-row').length,
    }));
    check('「全部」页没有新建入口（`[data-quick-add]` / 「新建」按钮 / 输入框都没有）',
      st.addBlock === false && st.newButton === false && st.card === false && st.input === false,
      JSON.stringify({ st, allPage }));
    check('「全部」页空状态里也没有「添加第一条提醒」按钮（这一页就是不给新建）',
      allPage.emptyAdd === false, JSON.stringify(allPage));
    check('「全部」页本身照常工作（时间范围条与列表都在）',
      allPage.rangeBar === true && allPage.rows > 0, JSON.stringify(allPage));

    await page.keyboard.press('n');
    await sleep(2200);
    st = await quickShape(page);
    const jumped = await page.evaluate(() => location.pathname);
    check('在「全部」页按 N：先跳到「今天」页再展开新建',
      jumped === '/admin' && st.card === true && st.input === true, JSON.stringify({ jumped, st }));

    // ================= 3. 信用卡页：头部到期卡片 + 卡面 =================
    const bucketId = await page.evaluate(async (base) => {
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const res = await fetch(base + '/api/reminder/lists', { headers: { Authorization: 'Bearer ' + token } });
      const json = await res.json().catch(() => ({}));
      const list = (json.data || []).find((l) => l.template === 'credit_card');
      return list ? list.id : null;
    }, BASE);
    if (!bucketId) {
      check('找得到信用卡栏目（这一组的前提）', false, '没有 template=credit_card 的清单');
    } else {
      await gotoRetry(page, BASE + `/admin/list/${bucketId}`);
      await sleep(3000);
      const head = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        const row = document.querySelector('[data-billing-row]');
        const strip = document.querySelector('[data-billing-strip]');
        const r = (el) => el && el.getBoundingClientRect();
        const R = (o) => o && { top: Math.round(o.top), bottom: Math.round(o.bottom), left: Math.round(o.left), right: Math.round(o.right), width: Math.round(o.width) };
        return { h1: R(r(h1)), row: R(r(row)), strip: R(r(strip)) };
      });
      check('信用卡页：「到期卡片」在**标题下方单独一行**',
        !!head.row && !!head.h1 && head.row.top >= head.h1.bottom - 1,
        JSON.stringify(head));
      check('到期卡片占满整行（与它所在的整行左右对齐、不再挤在标题右侧）',
        !!head.strip && !!head.row
          && Math.abs(head.strip.left - head.row.left) <= 1 && Math.abs(head.strip.right - head.row.right) <= 1,
        JSON.stringify(head));

      const mini = await page.evaluate(() => {
        const card = document.querySelector('[data-billing-card]');
        if (!card) return null;
        const cs = getComputedStyle(card);
        const innerRight = card.getBoundingClientRect().right - parseFloat(cs.paddingRight);
        const lines = [...card.querySelectorAll('p')].map((p) => ({
          text: (p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20),
          align: getComputedStyle(p).textAlign,
          right: Math.round(p.getBoundingClientRect().right),
        }));
        return { innerRight: Math.round(innerRight), lines };
      });
      if (!mini) {
        check('到期卡片里有小卡面（这一组的前提）', false, '当前没有「账单已出」的卡');
      } else {
        const timeLines = mini.lines.slice(-2);
        const otherLines = mini.lines.slice(0, -2);
        check('小卡面里的**时间信息右对齐**（末尾两行）',
          timeLines.length === 2 && timeLines.every((l) => l.align === 'right'),
          JSON.stringify(mini));
        check('时间信息位置不变（仍在卡片底部两行，且右边缘贴齐卡片内边）',
          timeLines.every((l) => Math.abs(l.right - mini.innerRight) <= 1), JSON.stringify(mini));
        check('小卡面的名称 / 尾号 / 金额仍保持左对齐（只动时间那两行）',
          otherLines.length >= 3 && otherLines.every((l) => l.align !== 'right'), JSON.stringify(mini));
      }

      const face = await page.evaluate(() => {
        const face = document.querySelector('[data-card-face]');
        if (!face) return null;
        const R = (el) => el && el.getBoundingClientRect();
        const cs = getComputedStyle(face);
        const fr = face.getBoundingClientRect();
        const inner = {
          left: fr.left + parseFloat(cs.paddingLeft),
          right: fr.right - parseFloat(cs.paddingRight),
          top: fr.top + parseFloat(cs.paddingTop),
        };
        const logo = face.querySelector('[data-card-face-logo] img') || face.querySelector('[data-card-face-logo] svg');
        const title = face.querySelector('[data-card-title]');
        const holder = face.querySelector('[data-card-holder]');
        const num = face.querySelector('[data-card-number]');
        const meta = face.querySelector('[data-card-meta]');
        const g = (el) => { const r = R(el); return r && { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
        return {
          inner: { left: Math.round(inner.left), right: Math.round(inner.right), top: Math.round(inner.top) },
          logo: g(logo), title: g(title), holder: g(holder), num: g(num), meta: g(meta),
          holderText: (holder?.textContent || '').trim(),
          faceText: (face.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        };
      });
      if (!face || !face.logo || !face.title) {
        check('卡面上有银行标志与卡名（这一组的前提）', false, JSON.stringify(face));
      } else {
        check('银行标志**单独一行**在左上（卡名在标志下边，不在同一行）',
          face.title.top >= face.logo.bottom - 1, JSON.stringify(face));
        check('卡名左端与标志左端对齐（上下同一竖列起点）',
          Math.abs(face.title.left - face.logo.left) <= 1, JSON.stringify(face));
        if (!face.holder) {
          check('卡面上有持卡人（这一组的前提）', false, '这张卡没填持卡人');
        } else {
          check('持卡人与卡名**同一行**',
            Math.abs(face.holder.top - face.title.top) < 12 && face.holder.bottom <= face.num.top + 1,
            JSON.stringify(face));
          check('持卡人**右对齐到卡面右边缘**（不是对齐到标志右边缘）',
            Math.abs(face.holder.right - face.inner.right) <= 1, JSON.stringify(face));
          check('卡名与持卡人没有重叠（放不下时各自换行）',
            face.title.right <= face.holder.left + 1, JSON.stringify(face));
        }
        check('「账单日 / 还款日 / 额度」仍在右上角（没被这次调整挪走）',
          Math.abs(face.meta.top - face.inner.top) <= 2 && Math.abs(face.meta.right - face.inner.right) <= 1,
          JSON.stringify(face));
      }

      // 手机端 390：这一页不横向溢出，卡面里卡名与持卡人不重叠
      await page.setViewport({ width: 390, height: 900 });
      await sleep(900);
      const mobile = await page.evaluate(() => {
        const bad = [...document.querySelectorAll('[data-card-face]')].filter((f) => {
          const t = f.querySelector('[data-card-title]')?.getBoundingClientRect();
          const h = f.querySelector('[data-card-holder]')?.getBoundingClientRect();
          return t && h && t.right > h.left + 1;
        }).length;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          overlapped: bad,
        };
      });
      check('手机端 390px：信用卡页不横向溢出', mobile.overflow <= 0, JSON.stringify(mobile));
      check('手机端 390px：卡面里卡名与持卡人不重叠', mobile.overlapped === 0, JSON.stringify(mobile));
      await page.setViewport({ width: 1440, height: 1000 });

      // ---------- 3b. 卡片列数固定一行三张（用户：三列最合适） ----------
      const cols = await page.evaluate(() => {
        const grid = document.querySelector('[data-card-panel] .grid');
        const face = document.querySelector('[data-card-face]')?.getBoundingClientRect();
        return {
          cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          cls: grid ? grid.className : '',
          ratio: face ? Number((face.width / face.height).toFixed(2)) : 0,
        };
      });
      check('宽屏（1440）就是一行三张卡（没有更宽的档位）',
        cols.cols === 3 && !/2xl:grid-cols-4/.test(cols.cls), JSON.stringify(cols));
      check('卡面仍是真卡比例（约 1.586:1）', Math.abs(cols.ratio - 1.59) <= 0.06, JSON.stringify(cols));
      await page.setViewport({ width: 1600, height: 1000 });
      await sleep(700);
      const colsWide = await page.evaluate(() => {
        const grid = document.querySelector('[data-card-panel] .grid');
        return { cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0 };
      });
      check('1600px 超大屏也还是一行三张（0.18.1 的四列已去掉）', colsWide.cols === 3, JSON.stringify(colsWide));
      await page.setViewport({ width: 1440, height: 1000 });
      await sleep(500);

      // ---------- 3c. 银行信息新增支付宝 / 微信 / 京东金融（含标志） ----------
      // 只打开「新建卡片」弹窗读一遍下拉与标志预览，最后点「取消」——不写任何数据。
      const banks = await page.evaluate(async () => {
        const add = document.querySelector('[data-card-add]');
        if (!add) return { dialog: false };
        add.click();
        await new Promise((r) => setTimeout(r, 700));
        const sel = document.querySelector('[data-card-bank-select]');
        if (!sel) return { dialog: true, select: false };
        const setVal = (v) => {
          const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          s.call(sel, v);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const labels = [...sel.options].map((o) => o.textContent.trim());
        const out = {};
        for (const name of ['支付宝', '微信', '京东金融']) {
          const opt = [...sel.options].find((o) => o.textContent.trim() === name);
          if (!opt) { out[name] = { found: false }; continue; }
          setVal(opt.value);
          await new Promise((r) => setTimeout(r, 500));
          const img = document.querySelector('[data-card-bank-logo]');
          out[name] = {
            found: true,
            hasPreview: !!img,
            file: img ? String(img.getAttribute('src')).split('/').pop() : '',
            loaded: img ? img.naturalWidth : 0,
            complete: img ? img.complete : false,
          };
        }
        // 关掉弹窗（取消）：不建卡片
        const cancel = [...document.querySelectorAll('.fixed.inset-0.z-50 button')]
          .find((b) => ['取消', '关闭'].includes(b.textContent.trim()));
        if (cancel) cancel.click();
        await new Promise((r) => setTimeout(r, 600));
        return { dialog: true, select: true, labels, out, closed: !document.querySelector('.fixed.inset-0.z-50') };
      });
      if (!banks.dialog || !banks.select) {
        check('新建卡片弹窗里有银行下拉（这一组的前提）', false, JSON.stringify(banks));
      } else {
        check('银行下拉里新增了「支付宝 / 微信 / 京东金融」',
          ['支付宝', '微信', '京东金融'].every((n) => banks.labels.includes(n)),
          JSON.stringify(banks.labels.filter((l) => /支付宝|微信|京东/.test(l))));
        const miss = ['支付宝', '微信', '京东金融'].filter((n) => !banks.out?.[n]?.found);
        check('三个新选项都能选中', miss.length === 0, JSON.stringify({ miss, out: banks.out }));
        const badLogo = ['支付宝', '微信', '京东金融']
          .filter((n) => !(banks.out?.[n]?.hasPreview && banks.out[n].loaded > 0));
        check('三个新选项都有能真正加载出来的标志（不是空白图）', badLogo.length === 0,
          JSON.stringify({ badLogo, out: banks.out }));
        check('读完标志后弹窗已取消（没有新建卡片）', banks.closed === true, JSON.stringify({ closed: banks.closed }));
      }
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('套件异常：', err); process.exit(1); });
