/**
 * 验证 0.1.7 的两项修复：
 *   1) 深色模式下原生下拉（<select> 弹层 / option）文字可读
 *   2) 「过期提醒频率」控件与同行其它字段尺寸一致（编辑面板 + 首页快速新建）
 *
 * 用法：APP_URL=http://192.168.3.201:8908 node verify-017.js
 *
 * 说明：
 *   - 弹层本身不在 DOM 里，没法直接量；能验的是两件事：<html> 的 color-scheme
 *     是否为 dark（浏览器据此画弹层），以及 <option> 的前景/背景是否被我们的
 *     样式钉住（对比度算出来）。两者合起来覆盖「白底浅字」这个失败模式。
 *   - 主题设置会临时改成深色，结束时（失败也）恢复原值。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP, openQuickAdd } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 读某个 select 与一份参照控件的尺寸/排版信息，用来做「一致」判断。 */
function measureFields(page, notifySelector, referenceSelector) {
  return page.evaluate(({ notifySel, refSel }) => {
    const pick = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        height: Math.round(r.height * 10) / 10,
        width: Math.round(r.width),
        fontSize: s.fontSize,
        paddingX: s.paddingLeft + '/' + s.paddingRight,
        paddingY: s.paddingTop + '/' + s.paddingBottom,
        radius: s.borderTopLeftRadius,
        borderWidth: s.borderTopWidth,
      };
    };
    return { notify: pick(document.querySelector(notifySel)), reference: pick(document.querySelector(refSel)) };
  }, { notifySel: notifySelector, refSel: referenceSelector });
}

function sameBox(a, b) {
  if (!a || !b) return '控件没找到';
  const diffs = [];
  if (Math.abs(a.height - b.height) > 1) diffs.push(`高 ${a.height} vs ${b.height}`);
  if (a.fontSize !== b.fontSize) diffs.push(`字号 ${a.fontSize} vs ${b.fontSize}`);
  if (a.radius !== b.radius) diffs.push(`圆角 ${a.radius} vs ${b.radius}`);
  if (a.paddingY !== b.paddingY) diffs.push(`上下内边距 ${a.paddingY} vs ${b.paddingY}`);
  if (a.borderWidth !== b.borderWidth) diffs.push(`边框 ${a.borderWidth} vs ${b.borderWidth}`);
  return diffs.length ? diffs.join('，') : '';
}

/** 相对亮度 → WCAG 对比度，用来判断「字看不清」这件事。 */
function contrastRatio(colorA, colorB) {
  const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [l1, l2] = [lum(parse(colorA)), lum(parse(colorB))].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

async function setTheme(page, mode) {
  await page.goto(BASE.replace(/\/$/, '') + '/admin/settings', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2200);
  const set = await page.evaluate((m) => {
    const row = [...document.querySelectorAll('div')].find((d) => {
      const code = d.querySelector(':scope > div > div > code');
      return code && code.textContent.trim() === 'theme_mode';
    });
    if (!row) return 'row-not-found';
    const select = row.querySelector('select');
    select.value = m;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }, mode);
  if (set !== 'ok') return set;
  await sleep(300);
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('div')].find((d) => {
      const code = d.querySelector(':scope > div > div > code');
      return code && code.textContent.trim() === 'theme_mode';
    });
    const save = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '保存');
    if (!save) return 'save-button-not-found';
    if (save.disabled) return 'save-disabled';
    save.click();
    return 'ok';
  });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await withTab(async (page) => {
    console.log(`目标：${BASE}`);
    await login(page, BASE);

    const original = await page.evaluate(() => localStorage.getItem('reminder-theme-mode') || 'system');
    try {
      // ── 1. 深色模式下的下拉可读性 ──
      check('切到深色（保存成功）', (await setTheme(page, 'dark')) === 'ok');
      await sleep(1000);
      const darkInfo = await page.evaluate(() => {
        const html = document.documentElement;
        const select = [...document.querySelectorAll('select')].find((s) => s.options.length > 3);
        const option = select ? select.options[0] : null;
        const optionStyle = option ? getComputedStyle(option) : null;
        const selectStyle = select ? getComputedStyle(select) : null;
        return {
          hasDarkClass: html.classList.contains('dark'),
          colorScheme: getComputedStyle(html).colorScheme,
          optionColor: optionStyle ? optionStyle.color : '',
          optionBackground: optionStyle ? optionStyle.backgroundColor : '',
          selectColor: selectStyle ? selectStyle.color : '',
          selectBackground: selectStyle ? selectStyle.backgroundColor : '',
        };
      });
      console.log('    深色下：' + JSON.stringify(darkInfo));
      check('深色模式已生效（html.dark）', darkInfo.hasDarkClass === true);
      check('声明了 color-scheme: dark（浏览器据此画下拉弹层）',
        /dark/.test(darkInfo.colorScheme), darkInfo.colorScheme);
      const darkContrast = contrastRatio(darkInfo.optionColor, darkInfo.optionBackground);
      check(`option 前景/背景对比度足够（实测 ${darkContrast}:1）`, darkContrast >= 4.5,
        `color=${darkInfo.optionColor} background=${darkInfo.optionBackground}`);
      check('option 不是「浅字 + 白底」',
        !(darkInfo.optionBackground.startsWith('rgb(255, 255, 255)') && contrastRatio(darkInfo.optionColor, 'rgb(255,255,255)') < 4.5),
        JSON.stringify({ c: darkInfo.optionColor, b: darkInfo.optionBackground }));

      // 浅色模式也顺手验一下没被改坏（同样是白底深字）
      check('切回浅色（保存成功）', (await setTheme(page, 'light')) === 'ok');
      await sleep(900);
      const lightInfo = await page.evaluate(() => {
        const select = [...document.querySelectorAll('select')].find((s) => s.options.length > 3);
        const option = select ? getComputedStyle(select.options[0]) : null;
        return {
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          optionColor: option ? option.color : '',
          optionBackground: option ? option.backgroundColor : '',
        };
      });
      const lightContrast = contrastRatio(lightInfo.optionColor, lightInfo.optionBackground);
      check(`浅色下对比度仍然足够（实测 ${lightContrast}:1）`, lightContrast >= 4.5,
        JSON.stringify(lightInfo));

      // ── 2. 「过期提醒频率」与同行字段尺寸一致 ──
      // 2a. 编辑面板（日历双击新建，字段与列表页共用同一个编辑器）
      for (const [name, width, height] of [['桌面', 1440, 900], ['手机', 390, 844]]) {
        await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
        if (width < 500) {
          // 手机端没有日历视图（入口隐藏 + 路由守卫），所以改用列表视图打开编辑面板：
          // 点任务行标题即打开同一个编辑器（抽屉形态），要验的字段与尺寸规则完全一样。
          await page.goto(BASE.replace(/\/$/, '') + '/admin/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(2200);
          const opened = await page.evaluate(() => {
            const row = document.querySelector('article.reminder-row');
            const btn = row && row.querySelector('button.min-w-0.flex-1.text-left');
            if (!btn) return false;
            btn.click();
            return true;
          });
          if (opened) {
            await waitFor(page, () => !!document.querySelector('.editor-panel'), { timeout: 8000 });
            await sleep(400);
          }
        } else {
          await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(2200);
          const cell = await page.evaluate(() => {
            const target = [...document.querySelectorAll('.cal-cell')]
              .find((c) => (c.querySelector('span')?.textContent || '').trim() === '15');
            if (!target) return null;
            target.scrollIntoView({ block: 'center' });
            const rect = target.getBoundingClientRect();
            // 任务条自己吃双击（= 编辑），点格子上方的空白处才会走「双击新建」
            return { x: rect.left + rect.width / 2, y: rect.top + 8 };
          });
          if (cell) {
            await page.mouse.click(cell.x, cell.y, { clickCount: 2, delay: 40 });
            await waitFor(page, () => (document.body.innerText || '').includes('新建提醒'), { timeout: 8000 });
            await sleep(400);
          }
        }
        const panel = await page.evaluate(() => {
          const fields = [...document.querySelectorAll('.editor-panel .editor-field')];
          const byLabel = (text) => fields.find((f) => (f.textContent || '').trim().startsWith(text));
          const notify = byLabel('过期提醒频率');
          const repeat = byLabel('重复');
          const sel = (el) => (el ? el.querySelector('select') : null);
          const info = (el) => {
            if (!el) return null;
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
              height: Math.round(r.height * 10) / 10, width: Math.round(r.width),
              fontSize: s.fontSize, radius: s.borderTopLeftRadius,
              paddingY: s.paddingTop + '/' + s.paddingBottom, borderWidth: s.borderTopWidth,
            };
          };
          return { notify: info(sel(notify)), reference: info(sel(repeat)) };
        });
        const diff = sameBox(panel.notify, panel.reference);
        check(`编辑面板（${name}）「过期提醒频率」与「重复」尺寸一致`, diff === '', diff || JSON.stringify(panel));
        console.log(`    ${name}：频率=${JSON.stringify(panel.notify)} 重复=${JSON.stringify(panel.reference)}`);
        await page.evaluate(() => {
          const cancel = [...document.querySelectorAll('.editor-panel button')].find((b) => (b.textContent || '').trim() === '取消');
          if (cancel) cancel.click();
        });
        await sleep(500);
      }

      // 2b. 首页快速新建（紧凑那排，参照 .compact-input）
      await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
      await page.goto(BASE.replace(/\/$/, '') + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2200);
      // 新建控件默认收成一个「新建」按钮（0.18.3 起）：先点开
      await openQuickAdd(page);
      // 用真鼠标点标题输入框：headless 下 element.focus() 不一定派发 focus 事件
      // （document.hasFocus() 为假时 Chrome 不派发），点了才会展开上半排芯片。
      const inputBox = await page.evaluate(() => {
        const input = document.querySelector('.quick-card input');
        if (!input) return null;
        const r = input.getBoundingClientRect();
        return { x: r.left + 10, y: r.top + r.height / 2 };
      });
      if (inputBox) {
        await page.mouse.click(inputBox.x, inputBox.y);
        await sleep(700);
      }
      // 「过期提醒频率」在「更多」展开后的字段网格里。
      // 0.16.3 起面板**默认展开**，而「更多」是 toggle —— 无条件点一下会把它收起来，
      // 所以先看面板在不在，只有收起时才点。
      await page.evaluate(() => {
        if (document.querySelector('[data-quick-panel]')) return;
        const more = [...document.querySelectorAll('.quick-card button')].find((b) => (b.textContent || '').trim() === '更多');
        if (more) more.click();
      });
      await sleep(800);
      const quick = await page.evaluate(() => {
        const card = document.querySelector('.quick-card');
        if (!card) return null;
        const info = (el) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            height: Math.round(r.height * 10) / 10, width: Math.round(r.width),
            fontSize: s.fontSize, radius: s.borderTopLeftRadius,
            paddingY: s.paddingTop + '/' + s.paddingBottom, borderWidth: s.borderTopWidth,
          };
        };
        return {
          notify: info(card.querySelector('.repeat-notify select.preset')),
          reference: info(card.querySelector('.compact-input')),
        };
      });
      const quickDiff = sameBox(quick && quick.notify, quick && quick.reference);
      check('首页快速新建里「过期提醒频率」与紧凑字段等高同字号', quickDiff === '',
        quickDiff || JSON.stringify(quick));
      console.log(`    快速新建：频率=${JSON.stringify(quick && quick.notify)} 参照=${JSON.stringify(quick && quick.reference)}`);

      await page.screenshot({ path: path.join(SHOTS, '017-fields.png') });
    } finally {
      const restore = await setTheme(page, original).catch(() => 'error');
      console.log(`  已恢复主题：${original}（${restore}）`);
    }
  });
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('FAILED:', error && error.message);
  process.exit(1);
});
