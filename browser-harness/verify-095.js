/**
 * 验证安卓客户端（WebView 壳子）的配套功能：
 *   1) 登录页「服务器地址」入口——只在壳子里出现（有 AndroidShell 桥才显示），
 *      显示当前地址、「修改」调起原生弹窗；普通浏览器里没有这一块。
 *   2) 「版本信息 → 安卓客户端」卡片：版本号 / 更新说明 / 大小 / 下载地址 / 二维码，
 *      内网、外网两条地址可切换并记住选择（localStorage），没配外网时该档不可用。
 *   3) 管理员在「偏好设置」上传/下架安装包：上传后卡片立即更新；下载链接（不带登录态）
 *      拿到的是同一个文件（比对 sha256）。
 *   4) 「系统配置 → 安卓客户端」分组里能改版本号 / 更新说明 / 内外网地址。
 *   5) 版本弹窗置顶块里的**原项目信息**（2026-10-15：原来单列在页尾，现在并进首屏）——
 *      上游项目 / 许可 / 衍生开发说明都在，页尾不再单列那一节。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node verify-095.js
 * 数据：会改两处服务端配置（外网地址、更新说明）——读原值→改→验→改回并回读确认；
 *       安装包会上传成当前构建的 APK（这是要发布的东西，保持不变）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP, USER, PASS, openLoginForm } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const BUILD_DIR = path.join(__dirname, '..', 'reminders-upstream', 'android-shell', 'build');

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token');
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { base: ROOT, p, method, body });


// ---- Node 侧的接口助手 ----
// 注意：页面是 http://<内网IP>，不是安全上下文，页面里没有 crypto.subtle；
// 而 FormData/File 也没法从 Node 传进浏览器。所以「上传/下载并算 sha256」都放在 Node 里做。
async function nodeToken() {
  // 登录接口在公开接口限流里（20 次/分钟）。一轮回归里登录很多次，
  // 撞上 429 时不重试就会连累上传/下载的断言（沙箱上就这么假红过一次）。
  for (let i = 0; i < 4; i += 1) {
    const r = await fetch(ROOT + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    const body = await r.json().catch(() => null);
    const token = body?.data?.token || '';
    if (token) return token;
    await new Promise((res) => setTimeout(res, 6000 * (i + 1)));
  }
  return '';
}

async function nodeUpload(apkPath, version) {
  const token = await nodeToken();
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(apkPath)]), path.basename(apkPath));
  fd.append('version', version);
  const r = await fetch(ROOT + '/api/reminder/admin/android/apk', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function nodeDownload() {
  const r = await fetch(ROOT + '/api/reminder/android/apk');
  const buf = Buffer.from(await r.arrayBuffer());
  return {
    status: r.status,
    type: r.headers.get('content-type') || '',
    disposition: r.headers.get('content-disposition') || '',
    size: buf.length,
    sha: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

function findApk() {
  if (!fs.existsSync(BUILD_DIR)) return null;
  const f = fs.readdirSync(BUILD_DIR).filter((n) => /^WorkOrderNote-android-.*\.apk$/.test(n)).sort().pop();
  return f ? path.join(BUILD_DIR, f) : null;
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const apkPath = findApk();
  // UI 上传必须用一个**纯 ASCII 路径**：工作目录里有中文（编程开发），而 harness 进程没有
  // UTF-8 locale，CDP 的 setFileInputFiles 会静默失败（files.length 还是 0，按钮保持禁用）。
  // 拷到 /tmp 再传，内容一样，sha256 不受影响。
  const uploadPath = apkPath ? path.join(os.tmpdir(), path.basename(apkPath)) : null;
  if (uploadPath) fs.copyFileSync(apkPath, uploadPath);
  const apkSha = apkPath ? crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex') : '';
  console.log(`  安装包：${apkPath ? path.basename(apkPath) : '（没找到，先跑 android-shell/build-apk.sh）'}`);

  await withTab(async (page) => {
    // 这个套件会切到「外网」档并把选择记进 localStorage（ui_android_addr）——
    // 不清掉的话，run-all 里重试的那一次（或紧接着单跑的下一次）一进来就是 wan，
    // 「地址有内网 / 外网两档，默认内网」立刻假红（本轮踩了两次）。
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.evaluate(() => { try { localStorage.removeItem('ui_android_addr'); } catch {} });

    // ---------- 1. 普通浏览器里没有「服务器地址」入口 ----------
    await login(page, BASE);
    // 想看登录页得先清登录态（0.14.0 起已登录访问 /login 会被守卫送回工作台）
    await openLoginForm(page, BASE);
    const plain = await page.evaluate(() => ({
      entry: !!document.querySelector('[data-server-entry]'),
      bridge: typeof window.AndroidShell,
    }));
    check('普通浏览器登录页没有「服务器地址」入口（网页端不需要这个概念）',
      plain.entry === false && plain.bridge === 'undefined', JSON.stringify(plain));

    // ---------- 2. 模拟壳子：注入 AndroidShell 桥 ----------
    await page.evaluateOnNewDocument(() => {
      window.__shellOpened = 0;
      window.AndroidShell = {
        getServerUrl: () => 'http://192.168.3.201:8906',
        getAppVersion: () => '0.1.0',
        openServerSettings: () => { window.__shellOpened += 1; },
        reload: () => {},
      };
    });
    await openLoginForm(page, BASE);
    const inShell = await page.evaluate(() => {
      const entry = document.querySelector('[data-server-entry]');
      return {
        entry: !!entry,
        text: entry?.innerText.replace(/\s+/g, ' ').trim() || '',
        showsUrl: /https?:\/\//.test(entry?.innerText || ''),
        hasEdit: !!entry?.querySelector('[data-server-edit]'),
      };
    });
    check('壳子内登录页出现「服务器设置」入口', inShell.entry === true, JSON.stringify(inShell));
    // 0.12 起这一块只留一行文字：地址不摆在登录页上（用户要求），点文字弹原生输入
    check('入口是纯文字「服务器设置」，不再显示服务器地址',
      inShell.text === '服务器设置' && inShell.showsUrl === false, JSON.stringify(inShell));
    check('入口可点（点了调原生设置）', inShell.hasEdit === true);
    await page.evaluate(() => document.querySelector('[data-server-edit]').click());
    await sleep(400);
    const opened = await page.evaluate(() => window.__shellOpened);
    check('点「修改」会调起原生设置（桥被调用一次）', opened === 1, String(opened));
    await page.screenshot({ path: path.join(SHOTS, 'android-login-server.png') });
    // 后面的用例回到正常上下文（不带桥）
    await page.evaluateOnNewDocument(() => { delete window.AndroidShell; });

    await login(page, BASE);

    // ---------- 3. 版本信息里的安卓客户端卡片 ----------
    const cfgBefore = await api(page, '/api/configs');
    const originalWan = cfgBefore.body?.data?.android_wan_url ?? '';
    const originalNotes = cfgBefore.body?.data?.android_notes ?? '';

    try {
      // 先确保有安装包：没上传过就用 Node 侧接口传一份当前构建的（版本号取 APK 文件名里的）
      let client = (await api(page, '/api/reminder/android')).body?.data;
      if (!client?.has_apk && apkPath) {
        const v = (path.basename(apkPath).match(/(\d+\.\d+\.\d+)/) || [])[1] || '0.1.0';
        const up = await nodeUpload(apkPath, v);
        check('（前置）上传当前构建的安装包', up.status === 200 && up.body?.data?.has_apk === true, `status=${up.status}`);
      }

      await page.goto(ROOT + '/admin', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('版本信息'));
        if (btn) btn.click();
      });
      await waitFor(page, () => !!document.querySelector('[data-android-card]'), { timeout: 8000 });
      await sleep(900);

      const card = await page.evaluate(() => {
        const el = document.querySelector('[data-android-card]');
        const qr = el.querySelector('[data-android-qr]');
        return {
          text: el.innerText.replace(/\s+/g, ' ').slice(0, 200),
          version: (el.innerText.match(/\b\d+\.\d+\.\d+\b/) || [''])[0],
          url: el.querySelector('[data-android-url]')?.textContent.trim() || '',
          downloadHref: el.querySelector('[data-android-download]')?.getAttribute('href') || '',
          qrSrc: qr ? qr.getAttribute('src') : '',
          qrLoaded: qr ? qr.complete && qr.naturalWidth > 0 : false,
          addrButtons: [...el.querySelectorAll('[data-android-addr]')].map((b) => ({ key: b.getAttribute('data-android-addr'), disabled: b.disabled, active: b.classList.contains('active') })),
          notes: el.querySelector('[data-android-notes]')?.textContent.trim() || '',
        };
      });
      check('版本信息里有「安卓客户端」卡片', /安卓客户端/.test(card.text), card.text.slice(0, 80));
      check('卡片显示版本号', /^\d+\.\d+\.\d+$/.test(card.version), card.version);
      check('卡片给出下载地址（内网，默认取当前访问地址）', card.url.includes('/api/reminder/android/apk'), card.url);
      check('下载按钮指向同一个地址', card.downloadHref === card.url, card.downloadHref);
      check('二维码走服务端接口（/api/reminder/android/qrcode，内网档）',
        card.qrSrc.includes('/api/reminder/android/qrcode') && card.qrSrc.includes('addr=lan'),
        card.qrSrc);
      check('二维码图片真的加载出来了', card.qrLoaded === true);
      check('地址有内网 / 外网两档，默认内网', card.addrButtons.length === 2
        && card.addrButtons.find((b) => b.key === 'lan')?.active === true
        && !card.addrButtons.find((b) => b.key === 'lan')?.disabled, JSON.stringify(card.addrButtons));

      // ---------- 3.5 置顶块里的原项目信息（0.29.0 起从页尾并进首屏） ----------
      const about = await page.evaluate(() => {
        const el = document.querySelector('[data-about-pinned]');
        const headings = [...document.querySelectorAll('h3, h4')].map((h) => h.textContent.trim());
        return {
          text: el ? el.innerText.replace(/\s+/g, ' ') : '',
          upstreamHref: el?.querySelector('a')?.getAttribute('href') || '',
          standalone: headings.filter((t) => t.includes('原项目信息')),
        };
      });
      check('置顶块里有上游项目与许可（衍生开发的出处没丢）',
        about.text.includes('上游项目') && about.text.includes('TechFunWay/reminders') && about.text.includes('MIT'),
        about.text.slice(0, 120));
      check('置顶块里写明基于该项目衍生开发、著作权与出处保留',
        about.text.includes('衍生开发') && about.text.includes('著作权'),
        about.text.slice(-120));
      check('上游链接指向原项目', about.upstreamHref.includes('github.com/TechFunWay/reminders'), about.upstreamHref);
      check('页尾不再单列「原项目信息」一小节', about.standalone.length === 0, JSON.stringify(about.standalone));

      // ---------- 4. 配一条外网地址 → 可切换、会记住 ----------
      const wan = 'https://note.example.com/api/reminder/android/apk';
      const put = await api(page, '/api/configs', 'PUT', { key: 'android_wan_url', value: wan });
      check('能把外网下载地址写进配置', put.status === 200, `status=${put.status}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1500);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('版本信息'));
        if (btn) btn.click();
      });
      await waitFor(page, () => !!document.querySelector('[data-android-card]'), { timeout: 8000 });
      await sleep(900);
      const wanBtnDisabled = await page.evaluate(() => document.querySelector('[data-android-addr="wan"]').disabled);
      check('配好外网地址后「外网」这一档可选', wanBtnDisabled === false);
      await page.evaluate(() => document.querySelector('[data-android-addr="wan"]').click());
      await sleep(500);
      const sw = await page.evaluate(() => ({
        url: document.querySelector('[data-android-url]').textContent.trim(),
        qr: document.querySelector('[data-android-qr]').getAttribute('src'),
        saved: localStorage.getItem('ui_android_addr'),
      }));
      check('切到外网后地址换成外网那条、二维码跟着换档',
        sw.url === wan && sw.qr.includes('addr=wan'), JSON.stringify(sw).slice(0, 160));
      check('选择记在本地（localStorage）', sw.saved === 'wan', String(sw.saved));

      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1500);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('版本信息'));
        if (btn) btn.click();
      });
      await waitFor(page, () => !!document.querySelector('[data-android-card]'), { timeout: 8000 });
      await sleep(900);
      const afterReload = await page.evaluate(() => ({
        active: document.querySelector('[data-android-addr="wan"]')?.classList.contains('active'),
        url: document.querySelector('[data-android-url]')?.textContent.trim() || '',
      }));
      check('刷新后仍停在外网那一档', afterReload.active === true && afterReload.url === wan, JSON.stringify(afterReload));
      await page.screenshot({ path: path.join(SHOTS, 'android-card.png') });

      // ---------- 5. 公开下载：不带登录态也能下到同一个文件 ----------
      const res = await nodeDownload();
      check('不带登录态也能下载（新手机扫码即可下）', res.status === 200, `status=${res.status}`);
      check('下载回来的是 APK（Content-Type / 附件头都对）',
        /android\.package-archive/.test(res.type) && /attachment/.test(res.disposition), `${res.type} | ${res.disposition}`);
      if (apkSha) {
        check('下载到的文件与本地构建的 APK 完全一致（sha256）', res.sha === apkSha, `${res.sha.slice(0, 16)} vs ${apkSha.slice(0, 16)}`);
      } else {
        check('下载接口返回了内容', res.size > 1024, `${res.size} 字节`);
      }

      // ---------- 6. 管理员上传 / 下架 ----------
      await page.goto(ROOT + '/admin/configs', { waitUntil: 'domcontentloaded' });
      await waitFor(page, () => !!document.querySelector('[data-android-uploader]'), { timeout: 15000 });
      await sleep(900);
      const uploader = await page.evaluate(() => {
        const el = document.querySelector('[data-android-uploader]');
        return {
          text: el.innerText.replace(/\s+/g, ' ').slice(0, 160),
          hasFile: !!el.querySelector('[data-android-file]'),
          hasVersion: !!el.querySelector('[data-android-version]'),
          hasSubmit: !!el.querySelector('[data-android-submit]'),
          hasDelete: !!el.querySelector('[data-android-delete]'),
        };
      });
      check('系统配置页有安装包上传区', uploader.hasFile && uploader.hasVersion && uploader.hasSubmit, JSON.stringify(uploader));
      check('已有安装包时提供「下架」', uploader.hasDelete === true, uploader.text);

      // 配置分组：安卓客户端那几个字段
      const groups = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          group: t.includes('安卓客户端'),
          version: t.includes('客户端版本号'),
          notes: t.includes('更新说明'),
          lan: t.includes('内网下载地址'),
          wan: t.includes('外网下载地址'),
        };
      });
      check('系统配置里有「安卓客户端」分组与四个字段',
        groups.group && groups.version && groups.notes && groups.lan && groups.wan, JSON.stringify(groups));

      if (apkPath) {
        const input = await page.$('[data-android-file]');
        await input.uploadFile(uploadPath);
        await sleep(400);
        await page.evaluate(() => document.querySelector('[data-android-submit]').click());
        await waitFor(page, () => /上传成功/.test(document.body.innerText), { timeout: 30000 });
        await sleep(800);
        const afterUpload = await page.evaluate(() => document.body.innerText);
        check('上传 APK 成功并提示', /上传成功/.test(afterUpload));
        const client2 = (await api(page, '/api/reminder/android')).body?.data;
        check('服务端记下了文件名 / 大小 / sha256',
          client2?.has_apk === true && /\.apk$/.test(client2.file_name) && client2.file_size > 1024 && client2.sha256.length === 64,
          JSON.stringify({ name: client2?.file_name, size: client2?.file_size, sha: (client2?.sha256 || '').slice(0, 12) }));
        check('记录的 sha256 与本地文件一致', client2?.sha256 === apkSha, `${(client2?.sha256 || '').slice(0, 16)}`);

        // 下架 → 卡片给出「还没上传」的提示；再传回来（这是要发布的东西）
        await page.evaluate(() => document.querySelector('[data-android-delete]').click());
        await waitFor(page, () => /已下架/.test(document.body.innerText), { timeout: 15000 });
        await sleep(600);
        const gone = (await api(page, '/api/reminder/android')).body?.data;
        check('下架后服务端标记为没有安装包', gone?.has_apk === false, JSON.stringify({ has: gone?.has_apk }));
        const dlGone = (await nodeDownload()).status;
        check('下架后下载链接返回 404', dlGone === 404, String(dlGone));

        const input2 = await page.$('[data-android-file]');
        await input2.uploadFile(uploadPath);
        await sleep(400);
        await page.evaluate(() => document.querySelector('[data-android-submit]').click());
        await waitFor(page, () => /上传成功/.test(document.body.innerText), { timeout: 30000 });
        await sleep(600);
        const back = (await api(page, '/api/reminder/android')).body?.data;
        check('重新上传后恢复可用', back?.has_apk === true && back.sha256 === apkSha);
      } else {
        check('没找到构建好的 APK，跳过上传/下架断言（先跑 android-shell/build-apk.sh）', false);
      }
    } finally {
      // 还原被改动的配置
      await api(page, '/api/configs', 'PUT', { key: 'android_wan_url', value: originalWan });
      await api(page, '/api/configs', 'PUT', { key: 'android_notes', value: originalNotes });
      const after = await api(page, '/api/configs');
      check('外网地址与更新说明已还原并回读确认（空值也能存回去）',
        (after.body?.data?.android_wan_url ?? '') === originalWan && (after.body?.data?.android_notes ?? '') === originalNotes,
        `wan="${after.body?.data?.android_wan_url}" notes="${after.body?.data?.android_notes}"`);
    }

    console.log(`  截图：${path.join(SHOTS, 'android-login-server.png')} / android-card.png`);
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('运行失败：', err);
  process.exit(2);
});
