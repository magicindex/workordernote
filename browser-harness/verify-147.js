/**
 * 偏好设置分区布局：常用 / 栏目 / 手机 / 更多。
 *
 * 目标：19 项个人配置不再一屏铺到底；分组只在所属分区出现，
 * 开发用的 config key 不在界面上显示，但 DOM 里保留给测试与无障碍。
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

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
    await sleep(1800);

    const tabs = await page.$$eval('[data-settings-tab]', els => els.map(e => (e.textContent || '').trim()));
    check('偏好设置分为常用/栏目/手机/更多四个分区', JSON.stringify(tabs) === JSON.stringify(['常用', '栏目', '手机', '更多']), JSON.stringify(tabs));

    const visibleGroups = () => page.evaluate(() => [...document.querySelectorAll('[data-config-key]')]
      .filter((el) => el.closest('.surface')?.offsetParent !== null)
      .map((el) => el.closest('.surface')?.querySelector('h2')?.textContent?.trim())
      .filter((v, i, a) => v && a.indexOf(v) === i));
    const visible = async (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      return !!el && el.offsetParent !== null;
    }, sel);

    let groups = await visibleGroups();
    check('常用分区只显示外观与提醒', JSON.stringify(groups) === JSON.stringify(['外观', '提醒']), JSON.stringify(groups));
    check('常用分区包含默认清单', await visible('[data-default-list] [aria-label="默认清单"]'));
    check('默认清单是独立卡片且紧挨外观卡下方', await page.evaluate(() => {
      const card = document.querySelector('[data-default-list]');
      const previous = card?.previousElementSibling;
      return !!card?.classList.contains('surface') && previous?.querySelector('h2')?.textContent?.trim() === '外观';
    }));

    const keyBox = await page.evaluate(() => {
      const code = document.querySelector('[data-config-key="theme_mode"] code');
      if (!code) return null;
      const r = code.getBoundingClientRect();
      return { w: r.width, h: r.height, text: code.textContent.trim() };
    });
    check('配置 key 不在界面上占位', !!keyBox && keyBox.w <= 1 && keyBox.h <= 1 && keyBox.text === 'theme_mode', JSON.stringify(keyBox));

    const draftValue = await page.evaluate(() => {
      const input = document.querySelector('[data-config-key="reminder_advance_days"] input');
      if (!input) return null;
      const next = String(Number(input.value || 0) + 1);
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return next;
    });
    await page.click('[data-settings-tab="modules"]'); await sleep(300);
    await page.click('[data-settings-tab="common"]'); await sleep(300);
    const draftKept = await page.evaluate(() => document.querySelector('[data-config-key="reminder_advance_days"] input')?.value || '');
    check('切换分区不会丢掉未保存的输入', !!draftValue && draftKept === draftValue, `${draftValue} → ${draftKept}`);

    await page.click('[data-settings-tab="modules"]'); await sleep(400);
    groups = await visibleGroups();
    check('栏目分区只显示功能开关与免打扰', JSON.stringify(groups) === JSON.stringify(['功能开关', '免打扰']), JSON.stringify(groups));
    check('栏目分区不再显示默认清单卡片', !(await visible('[data-default-list] [aria-label="默认清单"]')));

    await page.click('[data-settings-tab="mobile"]'); await sleep(400);
    check('手机分区显示 App 说明与手机日历', await visible('[data-install-card]') && await visible('[data-calendar-sync]'));

    await page.click('[data-settings-tab="more"]'); await sleep(400);
    check('更多分区显示 AI 提示词与原项目信息', (await page.evaluate(() => document.body.innerText)).includes('原项目信息') && await visible('[data-ai-prompt-prefs]'));

    await page.setViewport({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(1200);
    const bar = await page.evaluate(() => {
      const el = document.querySelector('[data-settings-tabs]');
      return el ? { sw: el.scrollWidth, cw: el.clientWidth } : null;
    });
    check('390px 下四个分区按钮不横向溢出', !!bar && bar.sw <= bar.cw + 1, JSON.stringify(bar));
    check('390px 下常用分区仍是单列卡片', await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-config-key="theme_mode"], [data-config-key="calendar_font_size"]')].map(el => el.closest('.surface')?.getBoundingClientRect());
      return cards.length === 2 && cards.every((r) => r && r.width > 300);
    }));
    await page.screenshot({ path: '/tmp/verify-147-settings-390.png' });
  });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('测试异常：', err); process.exit(1); });
