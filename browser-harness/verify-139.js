/**
 * iPhone / iPad 添加到主屏幕（PWA）支持。
 *
 * 检查：manifest / sw.js 可被 GET、iOS Safari 首次进入出现引导条、
 * 步骤弹窗说明 Safari 分享 → 添加到主屏幕、关闭后 7 天内不再出现、
 * 偏好设置里有「手机 App 设置说明」卡片，文案不误导为「必须 HTTPS」。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-139.js
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  await withTab(async (page) => {
    await page.setUserAgent(IOS_UA);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await login(page, BASE);
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    await page.evaluate(() => localStorage.removeItem('reminders.ios-install-tip-dismissed-at'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1200);

    const banner = await page.evaluate(() => {
      const el = document.querySelector('[data-ios-install-banner]');
      return el ? { text: el.innerText.replace(/\s+/g, ' ').trim(), visible: getComputedStyle(el).display !== 'none' } : null;
    });
    check('iPhone Safari 首次进入显示「添加到主屏幕」引导', !!banner && banner.visible && banner.text.includes('Safari') && banner.text.includes('添加到主屏幕'), JSON.stringify(banner));

    await page.click('[data-ios-install-help]');
    await sleep(400);
    const steps = await page.evaluate(() => document.querySelector('[data-ios-install-steps]')?.innerText.replace(/\s+/g, ' ').trim() || '');
    check('步骤写明 Safari → 分享 → 添加到主屏幕', steps.includes('Safari') && steps.includes('分享') && steps.includes('添加到主屏幕'), steps.slice(0, 160));
    check('说明内网 HTTP 也能添加，离线缓存才需要 HTTPS', steps.includes('HTTP') && steps.includes('离线缓存'), steps.slice(-120));

    await page.click('[data-ios-install-close]');
    await sleep(300);
    await page.click('[data-ios-install-dismiss]');
    await sleep(300);
    check('点关闭后本次提示消失', await page.evaluate(() => !document.querySelector('[data-ios-install-banner]')));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1000);
    check('关闭后 7 天内不再重复提示', await page.evaluate(() => !document.querySelector('[data-ios-install-banner]')));

    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    await page.click('[data-settings-tab="mobile"]');
    await sleep(400);
    const install = await page.evaluate(() => {
      const card = document.querySelector('[data-install-card]');
      return {
        card: card ? card.innerText.replace(/\s+/g, ' ').trim() : '',
        heading: document.querySelector('[data-install-heading]')?.textContent?.trim() || '',
        text: document.body.innerText.replace(/\s+/g, ' ').trim(),
      };
    });
    check('偏好设置显示「手机 App 设置说明」卡片', install.heading === '手机 App 设置说明' && !!install.card, JSON.stringify(install));
    check('卡片引导添加到主屏幕且不出现原生安装包', install.card.includes('添加到主屏幕') && !/APK|安卓客户端/.test(install.text), install.card.slice(0, 180));

    const guide = await page.evaluate(() => ({
      ios: document.querySelector('[data-guide-platform="ios"]')?.innerText.replace(/\s+/g, ' ').trim() || '',
      android: document.querySelector('[data-guide-platform="android"]')?.innerText.replace(/\s+/g, ' ').trim() || '',
      note: document.querySelector('[data-mobile-guide-note]')?.innerText.replace(/\s+/g, ' ').trim() || '',
    }));
    check('iPhone 与安卓分开说明', guide.ios.includes('Safari') && guide.ios.includes('分享') && guide.android.includes('Chrome') && guide.android.includes('菜单'), JSON.stringify(guide));
    check('当前 iPhone 标出「当前设备」，安卓组不标', guide.ios.includes('当前设备') && !guide.android.includes('当前设备'), JSON.stringify(guide));
    check('明确提示微信/QQ 不支持且不需要应用商店', guide.note.includes('微信') && guide.note.includes('应用商店'), guide.note);

    const assets = await page.evaluate(async () => {
      const m = await fetch('/manifest.webmanifest', { cache: 'no-store' });
      const ms = await m.json();
      const s = await fetch('/sw.js', { cache: 'no-store' });
      return { mStatus: m.status, mType: m.headers.get('content-type'), id: ms.id, display: ms.display, sStatus: s.status, sType: s.headers.get('content-type') };
    });
    check('manifest 可 GET 且为 application/manifest+json', assets.mStatus === 200 && String(assets.mType).includes('manifest+json'), JSON.stringify(assets));
    check('manifest 的 id/display 适配 iOS 独立窗口', assets.id === './' && assets.display === 'standalone', JSON.stringify(assets));
    check('sw.js 可 GET 且为 JavaScript', assets.sStatus === 200 && String(assets.sType).includes('javascript'), JSON.stringify(assets));

    await page.screenshot({ path: '/tmp/verify-139.png' });

    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1200);
    await page.click('[data-settings-tab="mobile"]');
    await sleep(400);
    const desktopGuide = await page.evaluate(() => document.querySelector('[data-install-card]')?.innerText.replace(/\s+/g, ' ').trim() || '');
    check('电脑上两套步骤都在，且不显示电脑安装步骤', desktopGuide.includes('iPhone / iPad') && desktopGuide.includes('安卓') && !desktopGuide.includes('地址栏右侧'), desktopGuide.slice(0, 200));
    await page.screenshot({ path: '/tmp/verify-139-desktop.png' });
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})();
