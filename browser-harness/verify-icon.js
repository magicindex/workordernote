/**
 * 验证图标换代（0.1.9 起）：
 *   1) 服务端真的在发新图标（favicon.svg 内容里能看到新图形的特征路径）
 *   2) HTML 里声明了 svg / png / ico / apple-touch
 *   3) 应用内品牌标记（侧栏）已经换成「记录本 + 勾」，不再是老的那个孤零零的勾
 *
 * 用法：APP_URL=http://192.168.3.201:8908 node verify-icon.js
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

// 应用图标（512 网格）的特征：书脊、书签带、勾
const ICON_SPINE = 'M188 112 H166';
const ICON_RIBBON = 'x="296" y="100"';
const ICON_TICK = 'M214 252 L250 288 L338 202';
// 应用内 24×24 标记的特征：书脊竖线、勾
const FEATURE_SPINE = 'M9.4 3.4v17.2';
const FEATURE_TICK = 'm11.6 12.1';
const OLD_GLYPH = 'm7 12 3 3 7-7';

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await withTab(async (page) => {
    console.log(`目标：${BASE}`);
    await login(page, BASE);

    // ── 1. 图标文件本身 ──
    const assets = await page.evaluate(async (base) => {
      const get = async (p) => {
        const res = await fetch(base + p, { cache: 'no-store' });
        const text = await res.text().catch(() => '');
        return { status: res.status, type: res.headers.get('content-type') || '', body: text };
      };
      return {
        svg: await get('/favicon.svg'),
        html: await get('/'),
        manifest: await get('/manifest.webmanifest'),
      };
    }, BASE);

    check('/favicon.svg 返回 200', assets.svg.status === 200, String(assets.svg.status));
    check('favicon.svg 里能看到新图形的书脊', assets.svg.body.includes(ICON_SPINE));
    check('favicon.svg 里能看到书签带', assets.svg.body.includes(ICON_RIBBON));
    check('favicon.svg 里能看到新图形的勾', assets.svg.body.includes(ICON_TICK));
    check('favicon.svg 不再是老图标（没有立体 S）', !assets.svg.body.includes('M338 160C338 114'));

    // ── 2. HTML 声明 ──
    const html = assets.html.body;
    check('声明了 svg 图标', html.includes('type="image/svg+xml"') && html.includes('/favicon.svg'));
    check('声明了 ico 兜底', html.includes('rel="icon"') && html.includes('/favicon.ico'));
    check('声明了 apple-touch-icon', html.includes('/apple-touch-icon.png'));

    // ── 3. manifest 图标指向满幅版本 ──
    check('manifest 里 192/512 仍在且标了 maskable',
      assets.manifest.body.includes('favicon-192.png') && assets.manifest.body.includes('maskable'));

    // ── 4. 应用内品牌标记 ──
    await page.goto(BASE.replace(/\/$/, '') + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    const mark = await page.evaluate(() => {
      const el = document.querySelector('.logo-mark svg');
      if (!el) return null;
      return {
        html: el.outerHTML,
        rects: el.querySelectorAll('rect').length,
        paths: [...el.querySelectorAll('path')].map((p) => p.getAttribute('d')),
        width: Math.round(el.getBoundingClientRect().width),
      };
    });
    check('侧栏品牌标记存在', !!mark);
    if (mark) {
      check('标记里是「记录本」外形（含矩形本面）', mark.rects >= 1, JSON.stringify(mark.rects));
      check('标记里有新图形的书脊线', mark.paths.includes(FEATURE_SPINE), mark.paths.join(' | '));
      check('标记里是新图形的勾', mark.paths.some((d) => d.startsWith(FEATURE_TICK)), mark.paths.join(' | '));
      check('标记不再是老的那个裸勾', !mark.paths.includes(OLD_GLYPH));
      console.log(`    标记尺寸 ${mark.width}px，${mark.rects} 个矩形 + ${mark.paths.length} 条路径`);
    }

    // 首屏骨架里的图形（HTML 里的静态标记，登录后已移除，只能看源码）
    check('首屏骨架用的是同一套图形', html.includes(FEATURE_SPINE) && !html.includes('>提</div>'));

    await page.screenshot({ path: path.join(SHOTS, 'icon-sidebar.png') });
    console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
  });
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('FAILED:', error && error.message);
  process.exit(1);
});
