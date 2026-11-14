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
      return {
        titles: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()),
        schedule: cardOf('backup_enabled'),
        local: cardOf('backup_local_dir'),
        remote: cardOf('backup_webdav_url'),
        urlVisible: visible('backup_webdav_url'),
        localDirVisible: visible('backup_local_dir'),
      };
    });
    const cfg = (await api(page, '/api/configs'))?.data || {};
    check('备份设置分成三组', ['备份计划', '本机备份', 'WebDAV 远程备份'].every((t) => ui.titles.includes(t)), JSON.stringify(ui.titles));
    check('自动备份/时间/保留份数在「备份计划」', ui.schedule === '备份计划', ui.schedule);
    check('本机备份目录在「本机备份」', ui.local === '本机备份', ui.local);
    check('WebDAV 连接信息在「WebDAV 远程备份」', ui.remote === 'WebDAV 远程备份', ui.remote);
    const davOn = String(cfg.backup_webdav_enabled || 'false') === 'true';
    check(`WebDAV ${davOn ? '开启' : '关闭'}时详情${davOn ? '显示' : '收起'}`,
      davOn ? ui.urlVisible === true : ui.urlVisible === false, JSON.stringify({ davOn, url: ui.urlVisible }));
    const localOn = String(cfg.backup_local_enabled || 'false') === 'true';
    check(`本机备份 ${localOn ? '开启' : '关闭'}时目录${localOn ? '显示' : '收起'}`,
      localOn ? ui.localDirVisible === true : ui.localDirVisible === false, JSON.stringify({ localOn, dir: ui.localDirVisible }));
  }, { width: 1440, height: 1000 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
