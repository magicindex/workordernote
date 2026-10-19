/**
 * 免打扰（用户 2026-10-16 原话：「增加一个免打扰功能，在首行 消息（铃铛图标）旁边放一个喇叭标志，
 * 点击进入静音标志，退出显示喇叭，点击进入免打扰模式。后台增加免打扰时间段。
 * 权责级别优先在 所有通知以上。」）
 *
 * 钉住前端这一半：
 *   1) 顶栏铃铛**右边**多一个喇叭按钮：正常是喇叭（带声波）、开着是静音（带叉），
 *      无障碍名 / 提示跟着换；
 *   2) 点一下就是手动开关（服务端 `dnd_manual`），刷新后仍然记着；
 *   3) 后台「系统配置 → 免打扰」有三项（总开关 + 起止时间）：**总开关默认关**（打开会改掉
 *      夜里到清晨的提醒，得用户自己决定），起止先备着 22:00–07:00；
 *      手动开关是**只读**的（通用配置接口改不了，只能走 `/reminder/dnd`）；
 *   4) **只**让时间段生效时（手动关着）：接口 `in_window` / `active` 为真、原因写时间段，
 *      按钮也变静音，并多一个小黄点 —— 用户能分清「自己开的」和「时间段到了」；
 *      手动开的（时间段没到）**没有**小黄点，这是那条小黄点存在的意义；
 *   5) 还原后一切复原并回读确认。
 *
 * 「免打扰真的不发提醒」那一半在 Go 用例里（`server/reminder/dnd_test.go`：逾期提醒整轮跳过、
 * 只挡自己、提醒@他照记通知中心、接口参数不对回 400）。
 *
 * 只动免打扰相关的三个系统配置 + 个人手动开关，收尾全部还原。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-129.js
 */
const path = require('path');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');

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

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: BASE, p, method, body });

/** 上海时区的 HH:MM（后台时间段就是这个口径），offsetMin 为相对此刻的偏移。 */
function shanghaiClock(offsetMin = 0) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(Date.now() + offsetMin * 60000));
}
const setConfig = (page, key, value) => api(page, '/api/configs', 'PUT', { key, value });
const readConfig = async (page, key) => {
  const all = await api(page, '/api/configs');
  return (all.body?.data || {})[key];
};

/** 顶栏那个按钮此刻长什么样。 */
const dndButton = (page) => page.evaluate(() => {
  const btn = document.querySelector('[data-dnd-toggle]');
  if (!btn) return null;
  const paths = [...btn.querySelectorAll('path')].map((p) => p.getAttribute('d') || '');
  return {
    active: btn.getAttribute('data-dnd-active') === 'true',
    muted: paths.some((d) => /m16 9 5 6/i.test(d)),
    // 喇叭图标 = 喇叭本体 + 两条声波（弧线）；静音图标 = 本体 + 一个叉
    waves: paths.filter((d) => /a5 5 0 0 1 0 7|a9 9 0 0 1 0 13/.test(d)).length,
    ariaLabel: btn.getAttribute('aria-label') || '',
    title: btn.getAttribute('title') || '',
    dot: !!btn.querySelector('[data-dnd-window-dot]'),
    amber: /amber/.test(btn.className),
  };
});

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);

    // 原始值：三个系统配置 + 手动开关，收尾按原样还原
    const originalEnabled = await readConfig(page, 'dnd_enabled');
    const originalStart = await readConfig(page, 'dnd_start_time');
    const originalEnd = await readConfig(page, 'dnd_end_time');
    const originalManual = (await api(page, '/api/reminder/dnd')).body?.data?.manual === true;
    console.log(`  原始：开关=${originalEnabled} 时间段=${originalStart}–${originalEnd} 手动=${originalManual}`);

    let windowCovering = false;
    try {
      // 基线：手动关着
      await api(page, '/api/reminder/dnd', 'PUT', { manual: false });
      await gotoRetry(page, BASE + '/admin');
      await sleep(2600);

      // ---------- 1. 入口：铃铛右边那个喇叭 ----------
      const entry = await page.evaluate(() => {
        const btn = document.querySelector('[data-dnd-toggle]');
        const bell = document.querySelector('a[aria-label="通知中心"]');
        if (!btn || !bell) return null;
        const b = btn.getBoundingClientRect();
        const n = bell.getBoundingClientRect();
        const sameRow = btn.parentElement === bell.parentElement;
        const siblings = [...btn.parentElement.children].filter((el) => el.getBoundingClientRect().width > 0);
        return {
          visible: b.width > 0 && b.height > 0,
          sameRow,
          order: siblings.indexOf(btn) - siblings.indexOf(bell),
          toTheRight: b.left > n.left,
        };
      });
      check('顶栏有免打扰按钮', !!entry && entry.visible, JSON.stringify(entry));
      check('它在「消息」铃铛的右边、同一排（紧邻的下一个）',
        !!entry && entry.sameRow && entry.order === 1 && entry.toTheRight, JSON.stringify(entry));

      const off = await dndButton(page);
      check('没开时是喇叭图标（本体 + 两条声波、没有叉）',
        !!off && !off.muted && off.waves === 2, JSON.stringify(off));
      check('没开时的提示是「开启免打扰」',
        !!off && /开启免打扰/.test(off.ariaLabel) && /开启免打扰/.test(off.title), JSON.stringify(off));

      const initial = (await api(page, '/api/reminder/dnd')).body?.data || {};
      check('免打扰状态接口字段齐全（手动 / 时间段 / 此刻是否生效 / 原因）',
        ['manual', 'window_enabled', 'window_start', 'window_end', 'in_window', 'active', 'reason']
          .every((k) => k in initial), JSON.stringify(initial));

      // ---------- 2. 点一下＝手动免打扰 ----------
      await page.evaluate(() => document.querySelector('[data-dnd-toggle]').click());
      await sleep(1600);
      const on = await dndButton(page);
      check('点一下变成静音图标（带叉）', !!on && on.muted && on.active, JSON.stringify(on));
      check('开着时提示是「免打扰已开启，点击关闭」',
        !!on && /免打扰已开启/.test(on.ariaLabel), JSON.stringify(on));

      const stateOn = (await api(page, '/api/reminder/dnd')).body?.data || {};
      check('接口同步：手动＝开、此刻生效、原因写「手动免打扰」',
        stateOn.manual === true && stateOn.active === true && /手动免打扰/.test(stateOn.reason || ''),
        JSON.stringify(stateOn));

      await gotoRetry(page, BASE + '/admin');
      await sleep(2600);
      const afterReload = await dndButton(page);
      check('刷新后仍是免打扰（服务端记着，不是只存在页面上）',
        !!afterReload && afterReload.active && afterReload.muted, JSON.stringify(afterReload));

      await page.evaluate(() => document.querySelector('[data-dnd-toggle]').click());
      await sleep(1600);
      const offAgain = await dndButton(page);
      check('再点一下回到喇叭、恢复正常',
        !!offAgain && !offAgain.active && !offAgain.muted, JSON.stringify(offAgain));

      // ---------- 3. 后台「免打扰」时间段 ----------
      const configs = (await api(page, '/api/configs')).body?.data || {};
      check('后台配置里有免打扰时间段三项：总开关是布尔值、起止备着 22:00 / 07:00',
        ['true', 'false'].includes(configs.dnd_enabled) && configs.dnd_start_time === '22:00' && configs.dnd_end_time === '07:00',
        JSON.stringify({ enabled: configs.dnd_enabled, start: configs.dnd_start_time, end: configs.dnd_end_time }));
      const manualViaConfigs = await api(page, '/api/configs', 'PUT', { key: 'dnd_manual', value: 'true' });
      check('手动开关不能经通用配置接口改写（只读，只走 /reminder/dnd）',
        manualViaConfigs.status === 403, JSON.stringify(manualViaConfigs).slice(0, 120));

      await gotoRetry(page, BASE + '/admin/configs');
      await sleep(3000);
      const rows = await page.evaluate(() => {
        const pick = (key) => {
          const row = document.querySelector(`[data-config-key="${key}"]`);
          if (!row) return null;
          return {
            group: row.parentElement?.parentElement?.querySelector('h2')?.textContent?.trim() || '',
            label: row.querySelector('span.text-sm.font-semibold')?.textContent?.trim() || '',
            switchOn: row.querySelector('button[role="switch"]')?.getAttribute('aria-checked') || null,
            time: row.querySelector('input[type="time"]')?.value || null,
          };
        };
        return { enabled: pick('dnd_enabled'), start: pick('dnd_start_time'), end: pick('dnd_end_time') };
      });
      check('配置页有「免打扰」组，三个设置项都在这一组里',
        ['enabled', 'start', 'end'].every((k) => rows[k] && rows[k].group === '免打扰'), JSON.stringify(rows));
      check('配置页上的值就是后台的值（总开关跟后台一致、起止 22:00 / 07:00）',
        rows.enabled?.switchOn === configs.dnd_enabled && rows.start?.time === '22:00' && rows.end?.time === '07:00',
        JSON.stringify(rows));

      // ---------- 4. 只让时间段生效：静音 + 小黄点 ----------
      const coveringStart = shanghaiClock(-60);
      const coveringEnd = shanghaiClock(60);
      await setConfig(page, 'dnd_start_time', coveringStart);
      await setConfig(page, 'dnd_end_time', coveringEnd);
      await setConfig(page, 'dnd_enabled', 'true');
      windowCovering = true;
      const windowState = (await api(page, '/api/reminder/dnd')).body?.data || {};
      check('时间段覆盖此刻时：手动仍是关的，但已经生效，原因写时间段',
        windowState.manual === false && windowState.in_window === true && windowState.active === true
          && /免打扰时间段/.test(windowState.reason || ''), JSON.stringify(windowState));
      check('原因里带上时间段起止，用户看得出是后台设的',
        (windowState.reason || '').includes(coveringStart) && (windowState.reason || '').includes(coveringEnd),
        windowState.reason);

      await gotoRetry(page, BASE + '/admin');
      await sleep(2600);
      const inWindow = await dndButton(page);
      check('这时按钮也变静音，并多一个小黄点（区分「时间段到了」）',
        !!inWindow && inWindow.active && inWindow.muted && inWindow.dot, JSON.stringify(inWindow));

      // 对照：手动开的、时间段没生效时，没有小黄点
      await setConfig(page, 'dnd_start_time', shanghaiClock(120));
      await setConfig(page, 'dnd_end_time', shanghaiClock(180));
      await api(page, '/api/reminder/dnd', 'PUT', { manual: true });
      await gotoRetry(page, BASE + '/admin');
      await sleep(2600);
      const manualOnly = await dndButton(page);
      const manualState = (await api(page, '/api/reminder/dnd')).body?.data || {};
      check('自己手动开的：静音但没有小黄点（小黄点只表示「后台时间段生效」）',
        !!manualOnly && manualOnly.active && manualOnly.muted && !manualOnly.dot
          && manualState.manual === true && manualState.in_window === false, JSON.stringify({ ui: manualOnly, api: manualState }));
      await api(page, '/api/reminder/dnd', 'PUT', { manual: false });

      // ---------- 5. 还原 ----------
      await setConfig(page, 'dnd_start_time', originalStart);
      await setConfig(page, 'dnd_end_time', originalEnd);
      await setConfig(page, 'dnd_enabled', originalEnabled);
      windowCovering = false;
      const restored = (await api(page, '/api/reminder/dnd')).body?.data || {};
      check('时间段还原后不再免打扰（手动也关着）',
        restored.in_window === false && restored.active === false && restored.manual === false, JSON.stringify(restored));

      await gotoRetry(page, BASE + '/admin');
      await sleep(2600);
      const finalUi = await dndButton(page);
      check('还原后小黄点消失、回到喇叭',
        !!finalUi && !finalUi.active && !finalUi.muted && !finalUi.dot, JSON.stringify(finalUi));

      const readback = await page.evaluate(async (base) => {
        const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
        const res = await fetch(base + '/api/configs', { headers: { Authorization: 'Bearer ' + token } });
        const json = await res.json().catch(() => null);
        return json?.data || {};
      }, BASE);
      check('三项配置回读与原始值一致',
        readback.dnd_enabled === originalEnabled && readback.dnd_start_time === originalStart
          && readback.dnd_end_time === originalEnd,
        JSON.stringify({ now: [readback.dnd_enabled, readback.dnd_start_time, readback.dnd_end_time], was: [originalEnabled, originalStart, originalEnd] }));

      await page.screenshot({ path: path.join(SHOTS, 'dnd-topbar-1440.png') }).catch(() => {});
    } finally {
      // 兜底还原：窗口 + 手动开关
      if (windowCovering) {
        await setConfig(page, 'dnd_start_time', originalStart);
        await setConfig(page, 'dnd_end_time', originalEnd);
        await setConfig(page, 'dnd_enabled', originalEnabled);
      }
      await api(page, '/api/reminder/dnd', 'PUT', { manual: originalManual });
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
