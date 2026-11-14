/**
 * AI 对话浮窗可拉边框改宽高，并按用户记住尺寸（用户 2026-11-14）。
 * 收尾恢复测试前的尺寸缓存与 --assistant-float-width。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const saved = await page.evaluate(() => ({
      sizes: Object.fromEntries(Object.keys(localStorage).filter((k) => k.includes('assistant_panel_size')).map((k) => [k, localStorage.getItem(k)])),
      var: document.documentElement.style.getPropertyValue('--assistant-float-width'),
    }));
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('assistant_panel_size')).forEach((k) => localStorage.removeItem(k)));
    const info = () => page.evaluate(() => {
      const shell = document.querySelector('.assistant-shell');
      const r = shell?.getBoundingClientRect();
      return {
        open: !!document.querySelector('[data-assistant-panel]'),
        w: r?.width || 0,
        h: r?.height || 0,
        top: r?.top || 0,
        left: r?.left || 0,
        zones: [...document.querySelectorAll('[data-assistant-resize]')].map((el) => {
          const b = el.getBoundingClientRect();
          return { edge: el.getAttribute('data-assistant-resize'), x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }),
        cssVar: getComputedStyle(document.documentElement).getPropertyValue('--assistant-float-width').trim(),
        stored: Object.keys(localStorage).filter((k) => k.includes('assistant_panel_size')).map((k) => localStorage.getItem(k)),
      };
    });
    const openPanel = async () => {
      await page.evaluate(() => {
        const top = document.querySelector('[data-assistant-topbar]');
        if (top) top.click();
        else window.dispatchEvent(new CustomEvent('open-assistant'));
      });
      await sleep(700);
    };
    const closePanel = async () => {
      await page.evaluate(() => document.querySelector('[data-assistant-close]')?.click());
      await sleep(450);
    };
    const drag = async (edgeName, dx, dy) => {
      await page.evaluate(({ edgeName, dx, dy }) => {
        const zone = [...document.querySelectorAll('[data-assistant-resize]')].find((el) => el.getAttribute('data-assistant-resize') === edgeName);
        const shell = document.querySelector('.assistant-shell');
        if (!zone || !shell) return;
        const z = zone.getBoundingClientRect();
        const r = shell.getBoundingClientRect();
        const x = edgeName === 'bottom' ? r.left + r.width / 2 : z.x + z.width / 2;
        const y = edgeName === 'left' ? r.top + r.height / 2 : z.y + z.height / 2;
        const opts = (px, py) => ({ bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: px, clientY: py });
        zone.dispatchEvent(new PointerEvent('pointerdown', opts(x, y)));
        window.dispatchEvent(new PointerEvent('pointermove', opts(x + dx, y + dy)));
        window.dispatchEvent(new PointerEvent('pointerup', opts(x + dx, y + dy)));
      }, { edgeName, dx, dy });
      await sleep(450);
    };
    try {
      await openPanel();
      const before = await info();
      check('AI 对话浮窗已打开', before.open === true, JSON.stringify({ w: before.w, h: before.h }));
      check('浮窗顶部贴视口顶部，不再空着', before.top <= 2, `top=${before.top}`);
      check('左侧 / 底边有透明拖拽区', before.zones.length >= 2, JSON.stringify(before.zones));
      check('没有浮在角落的可见手柄', (await page.evaluate(() => !document.querySelector('[data-assistant-resize-handle]'))));
      check('默认宽度约 388px', before.w >= 300 && before.w <= 520, String(before.w));

      await drag('left', -120, 0);
      const afterWidth = await info();
      check('向左拉左边缘后宽度增加约 120px', afterWidth.w > before.w + 90, `${before.w} → ${afterWidth.w}`);
      check('主内容留槽跟着变（--assistant-float-width 同步）', Math.abs(parseFloat(afterWidth.cssVar) - afterWidth.w) <= 2, `${afterWidth.cssVar} vs ${afterWidth.w}`);
      await drag('bottom', 0, -100);
      const after = await info();
      check('向上拉底边后高度减少约 100px', after.h < afterWidth.h - 70, `${afterWidth.h} → ${after.h}`);
      check('尺寸已按用户写入本地缓存', after.stored.some((raw) => /"w":\d+/.test(String(raw)) && /"h":\d+/.test(String(raw))), JSON.stringify(after.stored));

      await closePanel();
      await openPanel();
      const reopened = await info();
      check('关闭再打开，宽度保持', Math.abs(reopened.w - after.w) <= 3, `${after.w} → ${reopened.w}`);
      check('关闭再打开，高度保持', Math.abs(reopened.h - after.h) <= 3, `${after.h} → ${reopened.h}`);
      await closePanel();
    } finally {
      await page.evaluate((saved) => {
        Object.keys(localStorage).filter((k) => k.includes('assistant_panel_size')).forEach((k) => localStorage.removeItem(k));
        for (const [k, v] of Object.entries(saved.sizes)) localStorage.setItem(k, v);
        if (saved.var) document.documentElement.style.setProperty('--assistant-float-width', saved.var);
        else document.documentElement.style.removeProperty('--assistant-float-width');
      }, saved);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
