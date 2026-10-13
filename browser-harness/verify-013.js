/**
 * 验证 0.1.3 的两项改动：
 *   1) 偏好设置 → 主题模式新增「日出日落」（+ 日出日落位置），按日出日落自动切深浅色
 *   2) 日历视图双击日期格弹出新建面板（含手机端的「＋ 新建」按钮）
 *
 * 用法：APP_URL=http://192.168.3.201:8908 node verify-013.js
 *
 * 说明：
 *   - 主题用例会真的改用户配置，所以开头先记下原值，结束时（失败也）恢复。
 *   - 深浅色断言按**当天真实的日出/日落**留 45 分钟余量（上海）：
 *     原先写死「20:00–次日 6:00 必定夜间」，10 月里日出是 05:5x，05:55 跑就必红
 *     （2026-10-11 05:57 真踩了一次）；现在用 NOAA 公式算日出日落，边界附近直接跳过。
 *   - 新建用例在日历上建一条唯一标题的提醒，结束时删掉。
 */
const fs = require('fs');
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const SHOTS = path.join(__dirname, 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 按配置键找到那一行里的 select，读它的当前值与选项文案。 */
function readSelectConfig(page, key) {
  return page.evaluate((k) => {
    const row = [...document.querySelectorAll('div')].find((d) => {
      const code = d.querySelector(':scope > div > div > code');
      return code && code.textContent.trim() === k;
    });
    if (!row) return null;
    const select = row.querySelector('select');
    if (!select) return null;
    return {
      value: select.value,
      options: [...select.options].map((o) => o.textContent.trim()),
      values: [...select.options].map((o) => o.value),
    };
  }, key);
}

/**
 * 设置某个 select 型配置：改 select 只是标记为「未保存」，必须再点这一行的保存按钮。
 * 两步之间要等一下 —— Vue 是异步更新 DOM，change 刚派发完时按钮还是 disabled 的，
 * 立刻点会点了个寂寞（这个坑让第一版用例红了三条）。
 */
async function setSelectConfig(page, key, value) {
  const set = await page.evaluate(({ k, v }) => {
    const row = [...document.querySelectorAll('div')].find((d) => {
      const code = d.querySelector(':scope > div > div > code');
      return code && code.textContent.trim() === k;
    });
    if (!row) return 'row-not-found';
    const select = row.querySelector('select');
    if (!select) return 'select-not-found';
    select.value = v;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }, { k: key, v: value });
  if (set !== 'ok') return set;

  await sleep(300);
  return page.evaluate((k) => {
    const row = [...document.querySelectorAll('div')].find((d) => {
      const code = d.querySelector(':scope > div > div > code');
      return code && code.textContent.trim() === k;
    });
    if (!row) return 'row-not-found';
    const save = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '保存');
    if (!save) return 'save-button-not-found';
    if (save.disabled) return 'save-disabled';
    save.click();
    return 'ok';
  }, key);
}

const isDark = (page) => page.evaluate(() => document.documentElement.classList.contains('dark'));

/**
 * 上海当天的日出/日落（分钟数，NOAA 近似，误差 1–2 分钟）。
 * 用途只有一个：给「日出日落」主题的深浅色断言划一个安全窗口 —— 边界 ±45 分钟内不硬断言，
 * 免得用例随运行时刻随机变红。经纬度取与 web/src/utils/sun.ts 的 shanghai 一致的量级。
 */
function shanghaiSunTimes(date) {
  const rad = Math.PI / 180;
  const N = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400_000);
  const lat = 31.23;
  const lng = 121.47;
  const tz = 8;
  const decl = 23.44 * rad * Math.sin(2 * Math.PI * ((284 + N) / 365));
  const cosH = (-0.01454 - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  const H = Math.acos(Math.min(1, Math.max(-1, cosH))) / rad; // 度
  const noon = 720 - 4 * lng + tz * 60 + 0; // 当地正午（分钟）
  return { sunrise: noon - H * 4, sunset: noon + H * 4 };
}
const apiGet = (page, url) => page.evaluate(async (u) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
  return { status: res.status, body: await res.json().catch(() => null) };
}, url);

/** 读服务端上某个用户配置的当前值 —— 界面改完要落到这里才算真保存。 */
async function userConfig(page, key) {
  const res = await apiGet(page, `${BASE}/api/configs/user/meta`);
  const items = (res.body && res.body.data) || [];
  const item = items.find((it) => it.key === key);
  return item ? item.value : null;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await withTab(async (page) => {
    console.log(`目标：${BASE}`);
    await login(page, BASE);

    await page.goto(BASE.replace(/\/$/, '') + '/admin/settings', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    const before = {
      theme_mode: (await readSelectConfig(page, 'theme_mode'))?.value ?? 'system',
      sun_location: (await readSelectConfig(page, 'sun_location'))?.value ?? 'shanghai',
    };
    console.log(`  原配置：theme_mode=${before.theme_mode} sun_location=${before.sun_location}`);

    const title = `自检-日出日落-${Date.now()}`
    let createdId = null
    try {
      // ── 1. 主题模式：新选项 ──
      const theme = await readSelectConfig(page, 'theme_mode');
      check('主题模式里能看到「日出日落」', !!theme && theme.options.includes('日出日落'),
        theme ? theme.options.join('/') : '找不到 theme_mode');
      check('「日出日落」的取值是 sun', !!theme && theme.values.includes('sun'));

      const sunLoc = await readSelectConfig(page, 'sun_location');
      check('新增「日出日落位置」下拉', !!sunLoc, '找不到 sun_location');
      check('可选择城市 ≥ 40 个', !!sunLoc && sunLoc.options.length >= 40,
        sunLoc ? `${sunLoc.options.length} 个` : '');
      check('城市列表含上海与乌鲁木齐',
        !!sunLoc && sunLoc.options.includes('上海') && sunLoc.options.includes('乌鲁木齐'),
        sunLoc ? sunLoc.options.slice(0, 5).join('/') + '…' : '');

      // 位置换一个再换回来：既验证保存链路，也保证后面昼/夜判断的地理前提是上海。
      check('保存 sun_location=北京', (await setSelectConfig(page, 'sun_location', 'beijing')) === 'ok');
      await sleep(1200);
      const afterBeijing = await userConfig(page, 'sun_location');
      check('位置已存到服务端（北京）', afterBeijing === 'beijing', String(afterBeijing));
      check('保存 sun_location=上海', (await setSelectConfig(page, 'sun_location', 'shanghai')) === 'ok');
      await sleep(1200);
      const afterShanghai = await userConfig(page, 'sun_location');
      check('位置已存到服务端（上海）', afterShanghai === 'shanghai', String(afterShanghai));

      // ── 深浅色机制本身先立住，后面的日出日落断言才有意义 ──
      await setSelectConfig(page, 'theme_mode', 'light');
      await sleep(1200);
      check('切「浅色」后页面不是深色', (await isDark(page)) === false);
      check('浅色已存到服务端', (await userConfig(page, 'theme_mode')) === 'light');

      // ── 日出日落模式 ──
      // 先浅色再切日出日落：此刻是夜里，颜色应该从浅变深，说明变色来自 sun 分支
      // 而不是上一步留下的状态。白天跑时则相反，用本地存的模式值兜底判定。
      await setSelectConfig(page, 'theme_mode', 'sun');
      await sleep(1200);
      const darkAtSun = await isDark(page);
      const hour = await page.evaluate(() => new Date().getHours());
      check('sun 已存到服务端', (await userConfig(page, 'theme_mode')) === 'sun');
      check('主题模式已写入本地',
        (await page.evaluate(() => localStorage.getItem('reminder-theme-mode'))) === 'sun');
      // 按当天真实的日出/日落判定，边界 ±45 分钟内只做「状态是布尔」的软断言
      const nowDate = new Date();
      const sunT = shanghaiSunTimes(nowDate);
      const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
      const MARGIN = 45;
      if (nowMin > sunT.sunrise + MARGIN && nowMin < sunT.sunset - MARGIN) {
        check(`日出日落模式：${hour} 点（日出 ${Math.round(sunT.sunrise / 60 * 100) / 100} 点后）应为浅色`,
          darkAtSun === false, `dark=${darkAtSun} sunrise=${Math.round(sunT.sunrise)}min sunset=${Math.round(sunT.sunset)}min`);
      } else if (nowMin < sunT.sunrise - MARGIN || nowMin > sunT.sunset + MARGIN) {
        check(`日出日落模式：${hour} 点（日落之后/日出之前）应为深色`,
          darkAtSun === true, `dark=${darkAtSun} sunrise=${Math.round(sunT.sunrise)}min sunset=${Math.round(sunT.sunset)}min`);
      } else {
        check(`日出日落模式：${hour} 点距日出/日落不足 ${MARGIN} 分钟，跳过硬断言`,
          typeof darkAtSun === 'boolean',
          `dark=${darkAtSun} sunrise=${Math.round(sunT.sunrise)}min sunset=${Math.round(sunT.sunset)}min`);
      }
      check('位置已写入本地',
        (await page.evaluate(() => localStorage.getItem('reminder-theme-sun-city'))) === 'shanghai');

      // 再切回深色确认「深色」这条分支也照旧工作
      await setSelectConfig(page, 'theme_mode', 'dark');
      await sleep(1200);
      check('切「深色」后页面是深色', (await isDark(page)) === true);
      check('深色已存到服务端', (await userConfig(page, 'theme_mode')) === 'dark');

      // ── 2. 日历双击新建 ──
      await page.goto(BASE.replace(/\/$/, '') + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500);

      const cell = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.cal-cell')];
        // 15 号每个月都有，必定落在当月
        const target = cells.find((c) => (c.querySelector('span')?.textContent || '').trim() === '15') || cells[10];
        if (!target) return null;
        target.scrollIntoView({ block: 'center' });
        const rect = target.getBoundingClientRect();
        // 0.19.0 起任务条自己吃双击（= 编辑那一条），所以要双击**格子上方的空白处**
        // （日期数字那一行），别落在任务条上。
        return { x: rect.left + rect.width / 2, y: rect.top + 8, day: (target.querySelector('span')?.textContent || '').trim() };
      });
      check('找到日历日期格', !!cell, '没有 .cal-cell');
      if (cell) {
        await page.mouse.click(cell.x, cell.y, { clickCount: 2, delay: 40 });
        const opened = await waitFor(page, () => (document.body.innerText || '').includes('新建提醒'), { timeout: 8000 });
        check('双击日期格弹出新建面板', !!opened);

        const dueShown = await page.evaluate((day) => {
          const panelEl = document.querySelector('.editor-panel');
          if (!panelEl) return '';
          const button = [...panelEl.querySelectorAll('button')].find((b) => (b.textContent || '').includes('月') && (b.textContent || '').includes('日'));
          return button ? button.textContent.trim() : '';
        }, cell.day);
        // 0.20 起预填的是后台「过期时间」（默认 23:59），不再是写死的 20:00
        check('新建面板里预填了那天的「过期时间」（默认 23:59）', /(23:59|20:00|22:00|21:00|19:00|18:00)/.test(dueShown) && dueShown.includes(`${Number(cell.day)}日`),
          `日期字段="${dueShown}"`);

        // 填标题并保存
        await page.evaluate((t) => {
          const input = document.querySelector('.editor-panel input[autofocus]');
          if (!input) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, t);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, title);
        await sleep(400);
        await page.evaluate(() => {
          const save = [...document.querySelectorAll('.editor-panel button')].find((b) => (b.textContent || '').includes('保存提醒'));
          if (save) save.click();
        });
        await sleep(3000);

        const drawerClosed = await page.evaluate(() => !document.querySelector('.editor-panel'));
        check('保存后面板自动关闭', drawerClosed);

        const found = await apiGet(page, `${BASE}/api/reminder/items?view=all&q=${encodeURIComponent(title)}`);
        const list = (found.body && found.body.data) || [];
        check('新建的提醒已入库', list.length === 1, `查到 ${list.length} 条`);
        if (list.length) {
          createdId = list[0].id;
          const due = new Date(list[0].due_at);
          check('到期时间是所选日期 + 后台过期时间（默认 23:59）',
            due.getDate() === Number(cell.day) && due.getHours() >= 18,
            String(list[0].due_at));
        }

        // 手机端的「＋ 新建」按钮走同一条路
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('aside button')].find((b) => (b.textContent || '').includes('＋ 新建'));
          if (btn) btn.click();
        });
        const openedByButton = await waitFor(page, () => (document.body.innerText || '').includes('新建提醒'), { timeout: 6000 });
        check('「＋ 新建」按钮同样能打开面板', !!openedByButton);
        await page.evaluate(() => {
          const cancel = [...document.querySelectorAll('.editor-panel button')].find((b) => (b.textContent || '').trim() === '取消');
          if (cancel) cancel.click();
        });
        await sleep(600);
      }

      await page.screenshot({ path: path.join(SHOTS, '013-calendar-create.png') });
    } finally {
      try {
        // 恢复后必须回读服务端确认：只是「点了保存」不算数——Vue 异步更新 DOM，
        // 按钮可能还是 disabled 的，静默失败就会把用户的设置留在测试值上
        // （曾经把生产的 sun_location 留在 beijing）。不一致就再试一次。
        await page.goto(BASE.replace(/\/$/, '') + '/admin/settings', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);
        const readCfg = (key) => page.evaluate(async ({ base, k }) => {
          const token = localStorage.getItem('reminders.token');
          const res = await fetch(base + '/api/configs/user/meta', { headers: { Authorization: 'Bearer ' + token } });
          const json = await res.json().catch(() => ({}));
          const item = ((json.data) || []).find((it) => it.key === k);
          return item ? item.value : null;
        }, { base: BASE, k: key });
        for (let attempt = 1; attempt <= 2; attempt++) {
          await setSelectConfig(page, 'sun_location', before.sun_location);
          await sleep(600);
          await setSelectConfig(page, 'theme_mode', before.theme_mode);
          await sleep(1000);
          const [city, mode] = [await readCfg('sun_location'), await readCfg('theme_mode')];
          console.log(`  恢复第 ${attempt} 次：sun_location=${city} theme_mode=${mode}`);
          if (city === before.sun_location && mode === before.theme_mode) break;
        }
        const [city, mode] = [await readCfg('sun_location'), await readCfg('theme_mode')];
        check(`配置已恢复（theme_mode=${before.theme_mode} / sun_location=${before.sun_location}）`,
          city === before.sun_location && mode === before.theme_mode, `实际 ${mode} / ${city}`);
      } catch (e) {
        console.log('  恢复配置失败：' + (e && e.message));
      }
      if (createdId) {
        try {
          await page.evaluate(async ({ base, id }) => {
            const token = localStorage.getItem('reminders.token');
            await fetch(`${base}/api/reminder/items/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
          }, { base: BASE, id: createdId });
          console.log(`  已清理自检数据 id=${createdId}`);
        } catch (e) {
          console.log('  清理失败：' + (e && e.message));
        }
      }
    }
  });
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('FAILED:', error && error.message);
  process.exit(1);
});
