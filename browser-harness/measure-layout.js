/**
 * 量化布局：不用肉眼看截图，直接量关键元素的盒子。
 * 用于确认「日历上方空白」这类问题到底出在哪一段。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;

function r(el) {
  return el ? el.getBoundingClientRect().toJSON() : null;
}

(async () => {
  for (const [vp, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    await withTab(async (page) => {
      await page.setViewport({ width: w, height: h, isMobile: vp === 'phone', hasTouch: vp === 'phone' });
      await login(page, BASE);

      console.log('\n===== ' + vp + ' ' + w + 'x' + h + ' =====');

      // ---------- 日历页 ----------
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2200);
      const cal = await page.evaluate(() => {
        const out = { viewportH: window.innerHeight, scrollH: document.documentElement.scrollHeight };
        const main = document.querySelector('main');
        out.main = main ? main.getBoundingClientRect().toJSON() : null;
        const container = document.querySelector('.page-container');
        out.container = container ? container.getBoundingClientRect().toJSON() : null;
        if (container) {
          out.containerChildren = [...container.children].map((c) => ({
            tag: c.tagName,
            cls: String(c.className).slice(0, 60),
            rect: c.getBoundingClientRect().toJSON(),
          }));
        }
        const firstCell = document.querySelector('.cal-cell');
        const cells = [...document.querySelectorAll('.cal-cell')];
        out.grid = firstCell ? {
          firstTop: firstCell.getBoundingClientRect().top,
          lastBottom: cells.length ? cells[cells.length - 1].getBoundingClientRect().bottom : null,
          cellH: firstCell.getBoundingClientRect().height,
          count: cells.length,
        } : null;
        const aside = document.querySelector('aside.surface');
        out.dayPanel = aside ? aside.getBoundingClientRect().toJSON() : null;
        // 日历页顶部那些元素各自占多高
        out.tops = [...document.querySelectorAll('main h1, main h2, main h3, main .surface')]
          .slice(0, 6)
          .map((e) => ({ tag: e.tagName, text: (e.textContent || '').trim().slice(0, 14), rect: e.getBoundingClientRect().toJSON() }));
        return out;
      });
      const gapTop = cal.grid ? Math.round(cal.grid.firstTop - (cal.main ? cal.main.top : 0)) : null;
      const gridH = cal.grid && cal.grid.lastBottom ? Math.round(cal.grid.lastBottom - cal.grid.firstTop) : null;
      const below = cal.grid && cal.grid.lastBottom ? Math.round(cal.viewportH - cal.grid.lastBottom) : null;
      console.log('  [日历] 视口高=' + cal.viewportH + ' 页面可滚高=' + cal.scrollH);
      console.log('  [日历] main.top=' + Math.round(cal.main.top) + ' 日历格子首行 top=' + Math.round(cal.grid.firstTop)
        + ' → 顶部占用 ' + gapTop + 'px');
      console.log('  [日历] 格子区高=' + gridH + 'px  单格高=' + Math.round(cal.grid.cellH) + 'px  格子数=' + cal.grid.count);
      console.log('  [日历] 格子底部到视口底 = ' + below + 'px（负值=需要滚动）');
      console.log('  [日历] 容器子元素:');
      (cal.containerChildren || []).forEach((c) => {
        console.log('      ' + c.tag + ' h=' + Math.round(c.rect.height) + ' top=' + Math.round(c.rect.top) + '  ' + c.cls);
      });

      // ---------- 侧栏 ----------
      const side = await page.evaluate(() => {
        const aside = document.querySelector('aside.sidebar');
        if (!aside) return { none: true };
        const nav = aside.querySelector('nav');
        const rect = aside.getBoundingClientRect();
        const links = [...aside.querySelectorAll('a.nav-row')].map((a) => a.getBoundingClientRect().toJSON());
        const lastBottom = links.length ? links[links.length - 1].bottom : null;
        return {
          visible: rect.width > 0 && rect.left >= 0,
          rect,
          navH: nav ? nav.getBoundingClientRect().height : null,
          navScrollH: nav ? nav.scrollHeight : null,
          navClientH: nav ? nav.clientHeight : null,
          count: links.length,
          lastBottom,
          bottomOverflow: lastBottom ? Math.round(lastBottom - window.innerHeight) : null,
        };
      });
      console.log('  [侧栏] ' + JSON.stringify({
        visible: side.visible, w: side.rect ? Math.round(side.rect.width) : null,
        navH: side.navH ? Math.round(side.navH) : null,
        navScroll: side.navScrollH, navClient: side.navClientH,
        nav项数: side.count, 底部溢出: side.bottomOverflow,
      }));
    }, { width: w, height: h });
  }
})().catch((e) => { console.error('出错:', e && e.message); process.exit(1); });
