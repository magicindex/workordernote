/**
 * 「卡片透明度」要覆盖首页等页面的卡片（用户 2026-11-16：「首页卡片透明度没有变化」）。
 *
 * 原来只有 `.surface`（列表卡片、侧栏、顶栏、手机底栏）跟着 `--card-bg-opacity`，
 * 首页两列、通知中心、垃圾箱、提醒@他、渠道卡片、快速新建卡都写死了 `bg-surface/85`，
 * 拖滑块时纹丝不动。现在统一用全局 `.card-bg` / 显式 var 跟随。
 *
 * 只改偏好、跑完还原；不造数据。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

const api = (page, path, method = 'GET', body = null) => page.evaluate(async ({ base, path, method, body }) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}, { base: BASE, path, method, body });

/** "rgba(255, 255, 255, 0.39)" → alpha */
function alphaOf(value) {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(String(value || ''));
  if (!m) return null;
  return m[4] === undefined ? 1 : Number(m[4]);
}

/** 各页面的「卡片」选择器（都是页面级大卡，不是行内小盒子） */
const PAGES = [
  ['/admin/home', '首页「未来 14 天待办」', '[data-home-column="upcoming"]'],
  ['/admin/home', '首页「已逾期」', '[data-home-column="overdue"]'],
  ['/admin', '待办页快速新建卡', '.quick-card'],
  ['/admin/trash', '垃圾箱卡片', 'section.card-bg'],
  ['/admin/notifications', '通知中心卡片', '.card-bg'],
  ['/admin/nudges', '提醒@他卡片', '[data-nudge-column]'],
  ['/admin/channels', '通知方式卡片', '.channel-card'],
  // 课表页：底板本身透明（只留边框 + 光晕），白底在七天格子上
  ['/admin/timetable', '课表七天格子', '[data-day-column]'],
];

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    const before = (await api(page, '/api/configs')).data || {};
    const oldOpacity = before.card_bg_opacity !== undefined ? String(before.card_bg_opacity) : '90';

    /** 逐页读卡片背景色；页面上没这个元素（例如没建过课程表）就跳过。 */
    async function readAll() {
      const out = [];
      const skipped = [];
      for (const [path, label, selector] of PAGES) {
        await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
        await sleep(1500);
        const bg = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).backgroundColor : '';
        }, selector);
        if (!bg) { skipped.push(label); continue; }
        out.push({ label, path, bg, alpha: alphaOf(bg) });
      }
      if (skipped.length) console.log(`    （跳过：本机没有这些页面/卡片：${skipped.join('、')}）`);
      return out;
    }

    try {
      // ── 1. 39%（用户当前档位）：每页卡片都半透明 ──
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: '39' });
      const soft = await readAll();
      const softBad = soft.filter((r) => r.alpha === null || Math.abs(r.alpha - 0.39) > 0.02);
      check('39%：所有页面卡片都跟着变半透明', soft.length > 0 && softBad.length === 0,
        softBad.map((r) => `${r.label} ${r.bg}`).join(' / '));
      check('39%：首页两列都在（用户截图的那两张卡）',
        soft.filter((r) => r.label.startsWith('首页')).length === 2,
        String(soft.filter((r) => r.label.startsWith('首页')).length));

      // ── 2. 20%（最低档）：还是跟得上 ──
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: '20' });
      const low = await readAll();
      const lowBad = low.filter((r) => r.alpha === null || Math.abs(r.alpha - 0.2) > 0.02);
      check('20%：所有页面卡片都跟到 0.2', lowBad.length === 0, lowBad.map((r) => `${r.label} ${r.bg}`).join(' / '));

      // ── 3. 100%：回到不透明白，和加这个功能之前一致 ──
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: '100' });
      const full = await readAll();
      const fullBad = full.filter((r) => r.alpha === null || Math.abs(r.alpha - 1) > 0.001);
      check('100%：所有页面卡片回到不透明', fullBad.length === 0, fullBad.map((r) => `${r.label} ${r.bg}`).join(' / '));

      // ── 3b. 课表底板本身透明：格子的透明度才透得出来 ──
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: '39' });
      await page.goto(BASE + '/admin/timetable', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const board = await page.evaluate(() => {
        const shell = document.querySelector('[data-timetable-board]');
        if (!shell) return null;
        const cells = [...document.querySelectorAll('[data-day-column]')];
        const cs = getComputedStyle(shell);
        return {
          cells: cells.length,
          shellAlpha: getComputedStyle(shell).backgroundColor,
          shellImage: cs.backgroundImage.slice(0, 30),
          cellBg: cells.map((c) => getComputedStyle(c).backgroundColor),
        };
      });
      if (!board) {
        console.log('    （跳过：这台实例没有建课程表）');
      } else {
        check('课表底板本身不铺不透明底（只留边框 + 光晕）',
          /rgba\(0, 0, 0, 0\)|transparent/.test(board.shellAlpha), board.shellAlpha);
        check(`课表七天格子都存在（${board.cells} 列）`, board.cells >= 7, String(board.cells));
        check('七天格子都按 39% 半透明',
          board.cellBg.length >= 7 && board.cellBg.every((bg) => Math.abs((alphaOf(bg) ?? -1) - 0.39) < 0.02),
          board.cellBg.join(' / '));
      }

      // ── 4. 首页卡片仍是圆角卡片、有边框（不是被改成了别的元素） ──
      await page.goto(BASE + '/admin/home', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const shape = await page.evaluate(() => {
        const el = document.querySelector('[data-home-column="upcoming"]');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { radius: parseFloat(cs.borderTopLeftRadius), border: cs.borderTopWidth, overflow: cs.overflow };
      });
      check('首页卡片仍是圆角 + 边框 + 裁剪的卡片', !!shape && shape.radius >= 16 && parseFloat(shape.border) >= 1 && shape.overflow === 'hidden',
        JSON.stringify(shape));
    } finally {
      await api(page, '/api/configs', 'PUT', { key: 'card_bg_opacity', value: oldOpacity });
      const restored = (await api(page, '/api/configs')).data || {};
      check('卡片透明度偏好已还原', String(restored.card_bg_opacity) === oldOpacity,
        `${restored.card_bg_opacity} / 原 ${oldOpacity}`);
    }
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
