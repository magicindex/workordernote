/**
 * 页面截图：登录后按给定视口逐个页面截图，用于人工核对布局。
 * 用法：node shot.js [标签前缀]
 * 输出：shots/<前缀>-<页面>-<宽>.png
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const prefix = process.argv[2] || 'now';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['calendar', '/admin/calendar'],
  ['today', '/admin'],
  ['settings', '/admin/settings'],
];
const VIEWPORTS = [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
];

(async () => {
  // 桌面与手机分别跑：手机用 isMobile 才能触发真实的移动端媒体查询
  for (const [vpName, width, height] of VIEWPORTS) {
    await withTab(async (page) => {
      await page.setViewport({ width, height, isMobile: vpName === 'phone', hasTouch: vpName === 'phone' });
      await login(page, BASE);
      for (const [name, url] of PAGES) {
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2200);
        const file = path.join(OUT, `${prefix}-${name}-${width}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log('  已截图', path.relative(process.cwd(), file));
      }
    }, { width, height });
  }
  console.log('完成，输出目录:', OUT);
})().catch((e) => { console.error('出错:', e && e.message); process.exit(1); });
