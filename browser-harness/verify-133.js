#!/usr/bin/env node
// 数据备份：系统配置里的「数据备份」分组 + 立即备份。
// 备份范围必须是整库 + 上传文件（用户 2026-10-20：「增加备份功能 支持 webdav 定时备份 和 本地定时备份」）。
const { withTab, sleep } = require('./harness');
const { login } = require('./reminders-app');

const BASE = process.env.APP_URL || 'http://127.0.0.1:8918';
const USER = process.env.APP_USER || '王耀辉';
const PASS = process.env.APP_PASS || 'Wyh!1984yelq.';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

(async () => {
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 1000 });
    await login(page, BASE, USER, PASS);
    await page.goto(`${BASE}/admin/configs`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-backup-panel]', { timeout: 15000 });
    await sleep(800);

    const panel = await page.evaluate(() => {
      const p = document.querySelector('[data-backup-panel]');
      return {
        text: (p?.innerText || '').replace(/\s+/g, ' '),
        hasRun: !!document.querySelector('[data-backup-run]'),
      };
    });
    check('系统配置里有「数据备份」面板与「立即备份」按钮', panel.hasRun, panel.text.slice(0, 80));
    check('面板说明写明备份整库与上传文件', /整库\s*\+\s*上传文件/.test(panel.text), panel.text.slice(0, 120));

    const group = await page.evaluate(() => {
      const title = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === '数据备份');
      if (!title) return null;
      return {
        title: title.textContent.trim(),
        keys: [...document.querySelectorAll('[data-config-key]')].map((n) => n.getAttribute('data-config-key')).filter((k) => k.startsWith('backup_')),
      };
    });
    // backup_webdav_insecure：自建 NAS 自签名证书 / 用 IP 访问没有 IP SAN 时必须能跳过校验，
    // 否则备份只会在「上次结果」里留下 x509 报错（用户 2026-10-26 报的失败）。
    const needed = ['backup_enabled', 'backup_time', 'backup_local_enabled', 'backup_local_dir', 'backup_webdav_enabled', 'backup_webdav_url', 'backup_webdav_username', 'backup_webdav_password', 'backup_webdav_dir', 'backup_webdav_insecure', 'backup_keep'];
    check('「数据备份」分组含本机与 WebDAV 的全部必填项',
      !!group && needed.every((k) => group.keys.includes(k)), JSON.stringify(group));
    const secretType = await page.evaluate(() => {
      const row = document.querySelector('[data-config-key="backup_webdav_password"] input');
      return row ? row.getAttribute('type') : '';
    });
    check('WebDAV 密码用密码框输入', secretType === 'password', secretType);

    await page.click('[data-backup-run]');
    await page.waitForSelector('[data-backup-notice]', { timeout: 60000 });
    const after = await page.evaluate(() => ({
      notice: (document.querySelector('[data-backup-notice]')?.textContent || '').trim(),
      status: (document.querySelector('[data-backup-status]')?.textContent || '').replace(/\s+/g, ' '),
    }));
    check('点「立即备份」后提示生成的备份文件', /已备份/.test(after.notice) && /\.tar\.gz/.test(after.notice), after.notice);
    check('备份成功后状态显示成功', /成功/.test(after.status), after.status.slice(0, 120));

    const status = await page.evaluate(async () => {
      const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token');
      const res = await fetch('/api/backup/status', { headers: { Authorization: 'Bearer ' + token } });
      return (await res.json()).data;
    });
    check('备份状态里记录了本机目录与详情',
      !!status.local_dir && /\.tar\.gz/.test(status.last_detail || ''), JSON.stringify(status));

    // 数据恢复：本机备份列表、上传入口、危险确认框；这里只取消，不真的覆盖测试数据。
    await page.waitForSelector('[data-backup-file]', { timeout: 15000 });
    const restoreUI = await page.evaluate(() => ({
      hasList: !!document.querySelector('[data-backup-restore-list]'),
      files: document.querySelectorAll('[data-backup-file]').length,
      hasUpload: !!document.querySelector('[data-backup-upload]'),
      uploadAccept: document.querySelector('[data-backup-upload]')?.parentElement?.querySelector('input[type=file]')?.getAttribute('accept') || '',
    }));
    check('数据恢复区列出本机备份并提供上传入口',
      restoreUI.hasList && restoreUI.files > 0 && restoreUI.hasUpload, JSON.stringify(restoreUI));
    check('上传恢复只接受 tar.gz 备份', /\.tar\.gz/.test(restoreUI.uploadAccept), restoreUI.uploadAccept);

    await page.click('[data-backup-restore]');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    const dialog = await page.evaluate(() => ({
      text: (document.querySelector('[role="dialog"]')?.innerText || '').replace(/\s+/g, ' '),
    }));
    check('点恢复先弹危险确认框并说明覆盖范围',
      /从备份恢复/.test(dialog.text) && /覆盖当前所有账号/.test(dialog.text), dialog.text.slice(0, 160));
    const cancelled = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[role="dialog"] button')];
      const cancel = buttons.find((b) => b.textContent.trim() === '取消');
      if (cancel) cancel.click();
      return !!cancel;
    });
    check('确认框可取消', cancelled);
    await sleep(300);
    check('取消后没有执行恢复', !(await page.$('[data-backup-restore-notice]')));
  });
  console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('FATAL', err); process.exit(2); });
