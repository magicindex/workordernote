/**
 * 系统设置 → 数据备份：拆成「备份计划 / 本机备份 / WebDAV 远程备份」三组，
 * WebDAV 关闭时只留开关、详情收起（用户 2026-11-14）。
 * 只读，不改配置。
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
const api = (page, p) => page.evaluate(async ({ base, p }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
  const res = await fetch(base + p, { headers: { Authorization: 'Bearer ' + token } });
  return await res.json().catch(() => null);
}, { base: BASE, p });

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE);
    await page.goto(BASE + '/admin/configs', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const ui = await page.evaluate(() => {
      const cardOf = (key) => {
        const row = document.querySelector(`[data-config-key="${key}"]`);
        return row?.closest('.surface')?.querySelector('h2')?.textContent?.trim() || '';
      };
      const visible = (key) => {
        const row = document.querySelector(`[data-config-key="${key}"]`);
        return !!row && row.offsetParent !== null;
      };
      const localGroupTitle = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '本机备份');
      return {
        titles: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()),
        schedule: cardOf('backup_enabled'),
        remote: (() => { const el = document.querySelector('[data-webdav-settings]'); return el?.closest('.surface')?.querySelector('h2')?.textContent?.trim() || ''; })(),
        urlVisible: (() => { const input = document.querySelector('[data-webdav-server]'); return !!input && input.offsetParent !== null; })(),
        panelLocal: !!document.querySelector('[data-backup-panel] [data-backup-local]'),
        localGroupVisible: !!localGroupTitle && localGroupTitle.offsetParent !== null,
        panelLocalDirVisible: (() => { const input = document.querySelector('[data-backup-local-dir]'); return !!input && input.offsetParent !== null; })(),
        panelLocalToggle: document.querySelector('[data-backup-local-toggle]')?.getAttribute('aria-checked') || '',
      };
    });
    const cfg = (await api(page, '/api/configs'))?.data || {};
    check('备份设置分成「备份计划 / WebDAV 远程备份」，本机并入顶部卡片', ['备份计划', 'WebDAV 远程备份'].every((t) => ui.titles.includes(t)), JSON.stringify(ui.titles));
    check('自动备份/时间/保留份数在「备份计划」', ui.schedule === '备份计划', ui.schedule);
    check('WebDAV 连接信息在「WebDAV 远程备份」', ui.remote === 'WebDAV 远程备份', ui.remote);
    check('本机备份设置已并进顶部「数据备份」卡片', ui.panelLocal === true, JSON.stringify(ui));
    check('不再单独显示「本机备份」分组卡', ui.localGroupVisible === false, JSON.stringify(ui));
    const davOn = String(cfg.backup_webdav_enabled || 'false') === 'true';
    check(`WebDAV ${davOn ? '开启' : '关闭'}时详情${davOn ? '显示' : '收起'}`,
      davOn ? ui.urlVisible === true : ui.urlVisible === false, JSON.stringify({ davOn, url: ui.urlVisible }));
    const localOn = String(cfg.backup_local_enabled || 'false') === 'true';
    check(`卡片内本机目录 ${localOn ? '显示' : '收起'}`,
      localOn ? ui.panelLocalDirVisible === true : ui.panelLocalDirVisible === false, JSON.stringify({ localOn, dir: ui.panelLocalDirVisible }));
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
