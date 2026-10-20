/**
 * 课程表（用户 2026-10-18 原话：「增加一个课程表功能呢，支持多人表，通过索引分割标签切换，
 * 可以自定义课程表课程，和设定课外活动课，固定清单，通过后台开关打开关闭。」）
 *
 * 钉住这几件事：
 *   1) 开关在个人偏好：默认关（侧栏没有入口），打开后侧栏出现「课程表」；
 *   2) 一个账号可以建多张表（多人表），顶部标签切换，各表课程互不串；
 *   3) 课程 / 课外活动两类，活动卡片是虚线边，卡片上写「活动」；
 *   4) 增删改：按周几落列、时间校验（结束必须晚于开始）、改名、删表；
 *   5) 数据按账号隔离：另一个账号看不到这张表（用 API 口径验证）；
 *   6) 收尾：删掉自检建的表、把开关还原。
 *
 * 用法：APP_URL=http://127.0.0.1:8918 node verify-131.js
 */
const path = require('path');
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'shots');
const STAMP = 'TT' + Date.now().toString().slice(-6);

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
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

/** 关掉开局可能挡住点击的「到点提醒」气泡。 */
async function dismissAlerts(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /知道了|稍后提醒/.test(x.textContent || ''));
    if (b && /知道了/.test(b.textContent || '')) b.click();
  }).catch(() => {});
  await sleep(300);
}

async function waitForCard(page, selector, timeout = 12000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const n = await page.$$eval(selector, (els) => els.length).catch(() => 0);
    if (n) return true;
    if (Date.now() > deadline) return false;
    await sleep(300);
  }
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);
    await dismissAlerts(page);

    // 记下开关原值，收尾还原（多数实例应为 false）。
    const cfgBefore = await api(page, '/api/configs');
    const originalFlag = cfgBefore.body?.data?.timetable_enabled ?? 'false';
    const createdTables = [];

    try {
      // ---------------- 1. 默认关 → 侧栏没有入口 ----------------
      await api(page, '/api/configs', 'PUT', { key: 'timetable_enabled', value: 'false' });
      await page.goto(`${BASE}/admin/timetable`, { waitUntil: 'networkidle2' });
      await sleep(900);
      check('关掉开关后侧栏没有「课程表」入口', (await page.$$('[data-nav-timetable]')).length === 0);

      // ---------------- 2. 打开开关 → 入口出现 ----------------
      const enable = await api(page, '/api/configs', 'PUT', { key: 'timetable_enabled', value: 'true' });
      check('个人偏好里能打开课程表开关', enable.status === 200 && enable.body?.code === 0);
      const boot = await api(page, '/api/bootstrap');
      check('bootstrap 里 timetable_enabled 立刻变 true', String(boot.body?.data?.configs?.timetable_enabled) === 'true');
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1000);
      check('打开后侧栏出现「课程表」', (await page.$$('[data-nav-timetable]')).length === 1);

      // ---------------- 3. 建两张表（多人） ----------------
      const t1 = await api(page, '/api/timetable/tables', 'POST', { name: `${STAMP}-哥哥` });
      const id1 = t1.body?.data?.id;
      if (id1) createdTables.push(id1);
      const t2 = await api(page, '/api/timetable/tables', 'POST', { name: `${STAMP}-妹妹` });
      const id2 = t2.body?.data?.id;
      if (id2) createdTables.push(id2);
      check('能建多张表（同账号）', t1.body?.code === 0 && t2.body?.code === 0 && id1 !== id2);

      const list = await api(page, '/api/timetable/tables');
      const names = (list.body?.data?.tables || []).map((t) => t.name);
      check('表列表按账号返回两张新表', names.includes(`${STAMP}-哥哥`) && names.includes(`${STAMP}-妹妹`), names.join(','));

      const detail = await api(page, `/api/timetable/tables/${id1}`, 'GET');
      const pacing = detail.body?.data?.table || {};
      const slots = pacing.periods || [];
      check(
        '新表默认 45 分钟一节课 / 10 分钟课间 / 8 节骨架',
        pacing.lesson_minutes === 45 && pacing.break_minutes === 10 && slots.length === 8,
        JSON.stringify({ lesson: pacing.lesson_minutes, brk: pacing.break_minutes, n: slots.length }),
      );
      check(
        '骨架四段依次 早课 07:30/08:25、上午 09:20/10:15/11:10、下午 14:00/14:55、晚课 19:00',
        slots[0]?.start === '07:30' && slots[1]?.start === '08:25' &&
          slots[2]?.start === '09:20' && slots[4]?.start === '11:10' &&
          slots[5]?.start === '14:00' && slots[7]?.start === '19:00' &&
          slots[2]?.section === 'morning' && slots[7]?.section === 'evening',
        JSON.stringify(slots.map((p) => `${p.section}:${p.start}`)),
      );

      // 只挪早课第一节的开始：结束仍留 08:15，免得压到下面一节。
      const customPeriods = slots.map((p, i) => (i === 0 ? { ...p, start: '07:40' } : p));
      const custom = await api(page, `/api/timetable/tables/${id1}`, 'PATCH', { periods: customPeriods });
      check('每节次时间段可以自己设（第一节改 07:40）', custom.body?.data?.periods?.[0]?.start === '07:40', JSON.stringify(custom.body?.data?.periods?.[0]));
      // 新建表沿用当前这张表的节次与课时（用户 2026-10-19：「节次按当前时间设置成默认」）。
      const copiedTable = await api(page, '/api/timetable/tables', 'POST', { name: `${STAMP}-复制`, copy_from: Number(id1) });
      if (copiedTable.body?.data?.id) createdTables.push(String(copiedTable.body.data.id));
      check(
        '新建表沿用当前这张表的节次',
        JSON.stringify((copiedTable.body?.data?.periods || []).map((p) => p.start)) === JSON.stringify((custom.body?.data?.periods || []).map((p) => p.start)),
        JSON.stringify(copiedTable.body?.data?.periods?.map((p) => p.start)),
      );

      const overlap = await api(page, `/api/timetable/tables/${id1}`, 'PATCH', {
        periods: [{ section: 'early', start: '08:00', end: '08:45' }, { section: 'morning', start: '08:30', end: '09:15' }],
      });
      check('节次时间叠在一起会被拒（400）', overlap.status === 400, JSON.stringify(overlap.body));

      // ---------------- 4. 课程 / 课外活动 ----------------
      const course = await api(page, `/api/timetable/tables/${id1}/entries`, 'POST', {
        title: `${STAMP} 数学`, kind: 'course', weekday: 1, start_time: '08:00', end_time: '08:45',
        location: '三班', teacher: '李老师', note: `${STAMP} 带尺子`, color: 'indigo',
      });
      const activity = await api(page, `/api/timetable/tables/${id1}/entries`, 'POST', {
        title: `${STAMP} 机器人`, kind: 'activity', weekday: 3, start_time: '15:30', end_time: '17:00',
        location: '科技楼', teacher: '张老师', note: '带工具箱', color: 'amber',
      });
      // 上午 / 晚课各补一节，用来验「早课 / 上午 / 下午 / 晚课」四段的归位。
      await api(page, `/api/timetable/tables/${id1}/entries`, 'POST', {
        title: `${STAMP} 物理`, kind: 'course', weekday: 1, start_time: '10:20', end_time: '11:05',
        location: '三班', teacher: '李老师', note: '', color: 'sky',
      });
      await api(page, `/api/timetable/tables/${id1}/entries`, 'POST', {
        title: `${STAMP} 自习`, kind: 'activity', weekday: 1, start_time: '19:00', end_time: '20:00',
        location: '', teacher: '', note: '', color: 'slate',
      });
      check('课程能建', course.body?.code === 0 && course.body?.data?.kind === 'course');
      check('课外活动能建', activity.body?.code === 0 && activity.body?.data?.kind === 'activity');

      const badTime = await api(page, `/api/timetable/tables/${id1}/entries`, 'POST', {
        title: `${STAMP} 时间反了`, kind: 'course', weekday: 1, start_time: '10:00', end_time: '09:00',
      });
      check('结束早于开始被拒（400）', badTime.status === 400 && /结束时间/.test(badTime.body?.message || ''), JSON.stringify(badTime.body));

      const badWeekday = await api(page, `/api/timetable/tables/${id1}/entries`, 'POST', {
        title: `${STAMP} 星期越界`, kind: 'course', weekday: 9, start_time: '10:00', end_time: '11:00',
      });
      check('星期只能是 1–7', badWeekday.status === 400);

      // ---------------- 5. 账号隔离 ----------------
      // 第二个账号：注册一个临时用户，读表列表应当看不到上面两张。
      const uname = `tt${STAMP.slice(-6)}`.toLowerCase();
      const reg = await page.evaluate(async ({ base, uname }) => {
        const res = await fetch(base + '/api/auth/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: uname, password: 'Tt!2026pass', email: `${uname}@example.com` }),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      }, { base: BASE, uname });
      if (reg.body?.code === 0) {
        const otherToken = reg.body.data.token || reg.body.data?.access_token;
        const otherList = await page.evaluate(async ({ base, token }) => {
          const res = await fetch(base + '/api/timetable/tables', { headers: { Authorization: 'Bearer ' + token } });
          return await res.json().catch(() => null);
        }, { base: BASE, token: otherToken });
        const others = (otherList?.data?.tables || []).map((t) => t.name);
        check('另一个账号看不到这些表（按账号隔离）', !others.some((n) => n.startsWith(STAMP)), others.join(','));
      } else {
        // 实例关了注册也不算失败：只说明这条没验到，但把原因写清楚。
        console.log(`  · 跳过账号隔离：注册返回 ${reg.status} ${reg.body?.message || ''}`);
      }

      // ---------------- 6. 界面：按天列卡片 + 标签切换 ----------------
      await page.goto(`${BASE}/admin/timetable`, { waitUntil: 'networkidle2' });
      await sleep(1300);
      await dismissAlerts(page);
      const dayCols = await page.$$('[data-day-column]');
      check('一周七列都在', dayCols.length === 7, `实际 ${dayCols.length}`);
      const tabs = await page.$$eval('[data-timetable-tab]', (els) => els.map((e) => e.textContent.trim()));
      check('两张自检表都出现在顶部标签', tabs.some((t) => t.includes(`${STAMP}-哥哥`)) && tabs.some((t) => t.includes(`${STAMP}-妹妹`)), tabs.join(' | '));

      await page.click(`[data-timetable-tab*="${STAMP}-哥哥"]`);
      await sleep(700);
      const monCards = await page.$$eval('[data-day-column="1"] [data-entry-id]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      check('周一的数学落在周一这一列', monCards.some((t) => t.includes(`${STAMP} 数学`)), monCards.join(' | '));
      const wedCards = await page.$$eval('[data-day-column="3"] [data-entry-id]', (els) => els.map((e) => [e.getAttribute('data-entry-kind'), e.className]));
      check('课外活动卡片标 activity 且是虚线边', wedCards.some(([k, cls]) => k === 'activity' && /timetable-card-activity/.test(cls)), JSON.stringify(wedCards));

      // 按节次铺开整周骨架：每段从自己的第 1 节起算（40 项检查里的节次时间以标签为准）。
      // 用户 2026-10-20：「编辑按钮和空节次合并成一个按钮」——进编辑态即铺出空节次。
      await page.evaluate(() => {
        const btn = document.querySelector('[data-timetable-edit]');
        if (btn && btn.getAttribute('data-timetable-edit') !== 'on') btn.click();
      });
      await sleep(500);
      const slotsShown = await page.$$eval('[data-timetable-slot]', (els) => els.length);
      check('进编辑态后整周按节次铺出骨架', slotsShown >= 40, `实际 ${slotsShown}`);
      await page.click('[data-day-column="1"] [data-timetable-slot="3"]');
      await sleep(700);
      const slotPrefill = await page.evaluate(() => ({
        start: document.querySelector('[data-entry-start]')?.value,
        slot: document.querySelector('[data-entry-slot]')?.value,
      }));
      const slotLabel = await page.$eval('[data-day-column="1"] [data-timetable-slot="3"]', (el) => el.textContent.replace(/\s+/g, ' '));
      const slotStart = (slotLabel.match(/(\d{2}:\d{2})/) || [])[1] || '';
      check('点空节次会按该节时间预填', slotPrefill.slot === '3' && slotPrefill.start === slotStart, `${JSON.stringify(slotPrefill)} vs ${slotLabel}`);
      // 四段各自默认色：新建时预选的颜色应当等于这一段标题上的段色。
      const firstColor = await page.$eval('[data-entry-color-on="1"]', (el) => el.getAttribute('data-entry-color')).catch(() => '');
      const firstSection = await page.$eval('[data-day-column="1"] [data-timetable-slot="3"]', (el) => {
        const period = el.closest('[data-timetable-period]');
        return period ? period.getAttribute('data-timetable-period') : '';
      }).catch(() => '');
      const sectionColor = await page.$eval(`[data-day-column="1"] [data-timetable-period="${firstSection}"] [data-timetable-period-label]`, (el) => el.getAttribute('data-section-color')).catch(() => '');
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /取消/.test(x.textContent || '')); b && b.click(); });
      await sleep(500);
      check('该段新建默认用本段颜色', Boolean(firstColor) && firstColor === sectionColor, `${firstSection}: ${firstColor} vs ${sectionColor}`);
      check('段色取自四段色板（紫/蓝/绿/琥珀）', ['violet', 'sky', 'emerald', 'amber'].includes(firstColor), firstColor);
      await page.click('[data-timetable-edit]');
      await sleep(600);

      // 一天四段：08:00 早课、10:00 上午、19:00 晚课；周三 15:30 落下午。
      const monPeriods = await page.$$eval('[data-day-column="1"] [data-timetable-period]', (els) => els.map((e) => e.getAttribute('data-timetable-period')));
      const monLabels = await page.$$eval('[data-day-column="1"] [data-timetable-period-label]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      // 2026-10-19 起四段固定占位（行要对齐），没课的段也保留标题与空白行。
      check('周一四段固定排列：早课 / 上午 / 下午 / 晚课', JSON.stringify(monPeriods) === JSON.stringify(['early', 'morning', 'afternoon', 'evening']), monPeriods.join(','));
      check('分段标题齐全，有课的段带节数', monLabels.length === 4 && monLabels[0].startsWith('早课') && /早课\s*\d+/.test(monLabels[0]) && monLabels[2].trim() === '下午', monLabels.join(' | '));
      const wedPeriods = await page.$$eval('[data-day-column="3"] [data-timetable-period]', (els) => els.map((e) => e.getAttribute('data-timetable-period')));
      const wedRobotSection = await page.$$eval('[data-day-column="3"] [data-entry-id]', (els) => els.map((e) => {
        const period = e.closest('[data-timetable-period]');
        return `${e.getAttribute('data-entry-id')}:${period ? period.getAttribute('data-timetable-period') : ''}`;
      }));
      const robotInAfternoon = wedRobotSection.some((it) => it.endsWith(':afternoon'));
      check('周三 15:30 的课落在下午', wedPeriods.includes('afternoon') && robotInAfternoon, wedRobotSection.join(','));

      await page.screenshot({ path: path.join(SHOTS, 'timetable-1440.png') });

      // 切到妹妹：哥哥的课不该出现
      await page.click(`[data-timetable-tab*="${STAMP}-妹妹"]`);
      await sleep(800);
      const sisterCount = await page.$$eval('[data-entry-id]', (els) => els.length);
      check('切到另一张表看不到哥哥的课', sisterCount === 0, `实际 ${sisterCount}`);

      // ---------------- 7. 界面上加一节、改一节、删一节 ----------------
      await page.click(`[data-timetable-tab*="${STAMP}-哥哥"]`);
      await sleep(700);
      await page.click('[data-timetable-add-entry="7"]');
      await sleep(600);
      const defaults = await page.evaluate(() => ({
        start: document.querySelector('[data-entry-start]')?.value,
        end: document.querySelector('[data-entry-end]')?.value,
      }));
      const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
      check(
        '新建时按「一节课 45 分钟」自动带出结束时间',
        !!defaults.start && !!defaults.end && minutes(defaults.end) - minutes(defaults.start) === 45,
        JSON.stringify(defaults),
      );
      await page.type('[data-entry-title]', `${STAMP} 家庭日`);
      await page.type('[data-entry-note]', `${STAMP} 带泳衣`);
      await page.click('[data-entry-kind-activity]');
      await page.$eval('[data-entry-start]', (el) => { el.value = '09:00'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.$eval('[data-entry-end]', (el) => { el.value = '12:00'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.click('[data-entry-save]');
      const added = await waitForCard(page, '[data-day-column="7"] [data-entry-id]');
      check('界面上能加一节（落在周日）', added);
      const addedText = await page.$eval('[data-day-column="7"] [data-entry-id]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
      check('备注会显示在对应卡片里', addedText.includes(`${STAMP} 带泳衣`), addedText);

      await sleep(700);
      await page.click('[data-day-column="7"] [data-entry-id]');
      await sleep(800);
      const prefilled = await page.$eval('[data-entry-title]', (el) => el.value);
      check('点卡片打开的是这一节（表单预填）', prefilled === `${STAMP} 家庭日`, prefilled);
      // 颜色选中态：之前只有一个很淡的 ring，看不出来（用户 2026-10-19 反馈）。
      const colorMarked = await page.$$eval('[data-entry-color-on="1"]', (els) => els.map((e) => e.getAttribute('data-entry-color')));
      check('编辑课程时颜色有明确的选中态', colorMarked.length === 1, colorMarked.join(','));
      await page.click('[data-entry-color="rose"]');
      await sleep(250);
      const colorSwitched = await page.$$eval('[data-entry-color-on="1"]', (els) => els.map((e) => e.getAttribute('data-entry-color')));
      check('点别的颜色会切过去', colorSwitched.length === 1 && colorSwitched[0] === 'rose', colorSwitched.join(','));
      await page.click('[data-entry-color="indigo"]');
      await sleep(200);
      await page.$eval('[data-entry-start]', (el) => { el.value = '10:00'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.click('[data-entry-save]');
      await sleep(1200);
      const edited = await page.$$eval('[data-day-column="7"] [data-entry-id]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
      // 改开始时间会自动按课时（45 分钟）重算结束，所以卡片变成 10:00–10:45。
      check('改开始时间后按课时重算结束并落到卡片', edited.some((t) => t.includes('10:00–10:45')), edited.join(' | '));

      page.once('dialog', async (d) => { await d.accept(); });
      await page.click('[data-day-column="7"] [data-entry-id]');
      await sleep(500);
      await page.click('[data-entry-delete]');
      await sleep(1200);
      const afterDelete = await page.$$eval('[data-day-column="7"] [data-entry-id]', (els) => els.length);
      check('删除后卡片消失', afterDelete === 0, `剩 ${afterDelete}`);

      // ---------------- 8. 表设置：节次时间段 / 改名 ----------------
      await page.click('[data-timetable-settings]');
      await sleep(600);
      const addButtons = await page.$$eval('[data-table-add]', (els) => els.map((e) => e.getAttribute('data-table-add')));
      check('设置里四段各有「加一节」', addButtons.length === 4 && addButtons.includes('early') && addButtons.includes('evening'), addButtons.join(','));
      await page.$eval('[data-table-location]', (el) => {
        el.value = '三班 / 教学楼 201';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.$eval('[data-table-period-start="1"]', (el) => {
        el.value = '08:30';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.$eval('[data-table-period-end="1"]', (el) => {
        el.value = '09:00';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.click('[data-table-save]');
      await sleep(1200);
      const afterTable = (await api(page, `/api/timetable/tables/${id1}`, 'GET')).body?.data?.table || {};
      check('表设置能存班级 / 地点', afterTable.location === '三班 / 教学楼 201', JSON.stringify(afterTable.location));
      const monTexts = await page.$$eval('[data-day-column="1"] [data-entry-id]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      check('课程没填地点时卡片自动用表里的班级 / 地点', monTexts.some((t) => t.includes(`${STAMP} 自习`) && t.includes('三班 / 教学楼 201')), monTexts.join(' | '));
      check('课程自己填了地点仍以它为准', monTexts.some((t) => t.includes(`${STAMP} 数学`) && t.includes('三班')), monTexts.join(' | '));
      const afterPeriods = afterTable.periods || [];
      check('改完第 2 节时间段会存进这张表', afterPeriods[1]?.start === '08:30' && afterPeriods[1]?.end === '09:00', JSON.stringify(afterPeriods[1]));
      await page.evaluate(() => {
        const btn = document.querySelector('[data-timetable-edit]');
        if (btn && btn.getAttribute('data-timetable-edit') !== 'on') btn.click();
      });
      await sleep(600);
      const slotTwo = await page.$eval('[data-timetable-slot="2"]', (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
      check('改完第 2 节时间段，骨架立刻变成 08:30', slotTwo.includes('08:30'), slotTwo);

      await page.click('[data-timetable-settings]');
      await sleep(500);
      await page.$eval('[data-table-name]', (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, `${STAMP}-哥哥2`);
      await page.click('[data-table-save]');
      await sleep(1000);
      const renamed = await page.$$eval('[data-timetable-tab]', (els) => els.map((e) => e.textContent.trim()));
      check('表可以改名', renamed.some((t) => t.includes(`${STAMP}-哥哥2`)), renamed.join(' | '));

      // 拖动换课（用户 2026-10-19：「空节次左边增加编辑功能，点击编辑可以拖动课程到空位置，
      // 拖动位置如果又内容则交换」）。用一张临时表，别动前面那些断言依赖的课程。
      const dragTable = await api(page, '/api/timetable/tables', 'POST', { name: `${STAMP}-拖动` });
      const dragId = dragTable.body?.data?.id || dragTable.body?.data?.table?.id;
      createdTables.push(dragId);
      const mkEntry = (title, start, end) => api(page, `/api/timetable/tables/${dragId}/entries`, 'POST', {
        title, kind: 'course', weekday: 1, start_time: start, end_time: end, color: 'indigo',
      });
      await mkEntry(`${STAMP} 甲`, '07:30', '08:15');
      await mkEntry(`${STAMP} 乙`, '09:00', '09:45');
      await page.goto(`${BASE}/admin/timetable`, { waitUntil: 'networkidle2' });
      await sleep(1300);
      await dismissAlerts(page);
      await page.click(`[data-timetable-tab*="${STAMP}-拖动"]`);
      await sleep(700);
      // 「编辑」与「空节次」已合并（用户 2026-10-20）：关着时没有空节次，
      // 点开既有落点也能拖，退出后收起。
      const slotsBefore = await page.$$eval('[data-timetable-slot]', (els) => els.length);
      await page.click('[data-timetable-edit]');
      await sleep(500);
      const editOn = await page.$eval('[data-timetable-edit]', (el) => el.getAttribute('data-timetable-edit'));
      check('点「编辑」进入拖动模式', editOn === 'on', editOn || '');
      const slotsInEdit = await page.$$eval('[data-timetable-slot]', (els) => els.length);
      check('编辑态同时铺出空节次（有落点可拖）', slotsBefore === 0 && slotsInEdit > 0, `${slotsBefore} -> ${slotsInEdit}`);
      await page.click('[data-timetable-edit]');
      await sleep(500);
      const slotsRestored = await page.$$eval('[data-timetable-slot]', (els) => els.length);
      check('退出编辑后空节次一起收起', slotsRestored === 0, `slots=${slotsRestored}`);
      await page.click('[data-timetable-edit]');
      await sleep(500);
      const dragged = await page.evaluate(() => {
        const card = document.querySelector('[data-day-column="1"] [data-entry-id]');
        const slot = document.querySelector('[data-day-column="2"] [data-timetable-slot]');
        if (!card || !slot) return { ok: false };
        const dt = new DataTransfer();
        card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        slot.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        slot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        return { ok: true, title: card.getAttribute('data-entry-id'), slot: slot.textContent.replace(/\s+/g, ' ').trim() };
      });
      await sleep(1500);
      const dragAfter = (await api(page, `/api/timetable/tables/${dragId}`, 'GET')).body?.data?.entries || [];
      const movedOne = dragAfter.find((e) => String(e.id) === dragged.title);
      check('把课拖到空节次会挪到那一天的该节次', dragged.ok && movedOne?.weekday === 2 && movedOne?.start_time === '07:30', JSON.stringify({ dragged, moved: movedOne && { w: movedOne.weekday, s: movedOne.start_time } }));

      // 再拖一次，落点已经有课：两节互换星期与时间。
      const swapInfo = await page.evaluate(() => {
        const a = document.querySelector('[data-day-column="2"] [data-entry-id]');
        const b = document.querySelector('[data-day-column="1"] [data-entry-id]');
        if (!a || !b) return { ok: false };
        const dt = new DataTransfer();
        a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        return { ok: true, a: a.getAttribute('data-entry-id'), b: b.getAttribute('data-entry-id') };
      });
      await sleep(1500);
      const swappedList = (await api(page, `/api/timetable/tables/${dragId}`, 'GET')).body?.data?.entries || [];
      const aRow = swappedList.find((e) => String(e.id) === swapInfo.a);
      const bRow = swappedList.find((e) => String(e.id) === swapInfo.b);
      check(
        '拖到已有课上只对调课程，节次时间保持不变',
        swapInfo.ok
          && aRow?.weekday === 2 && aRow?.start_time === '07:30' && aRow?.title === `${STAMP} 乙`
          && bRow?.weekday === 1 && bRow?.start_time === '09:00' && bRow?.title === `${STAMP} 甲`,
        JSON.stringify({
          a: aRow && { w: aRow.weekday, s: aRow.start_time, t: aRow.title },
          b: bRow && { w: bRow.weekday, s: bRow.start_time, t: bRow.title },
        }),
      );
      await page.click('[data-timetable-edit]');
      await sleep(300);
      // 回到哥哥那张做打印校验（刚才在临时表上拖课）。
      await page.click(`[data-timetable-tab*="${STAMP}-哥哥2"]`);
      await sleep(800);

      // 打印：拦截 window.open，检查生成的当周页里有课程、班级与 A4 横向声明。
      await page.evaluate(() => {
        window.__printHtml = null;
        window.open = () => ({
          document: { open() {}, write(html) { window.__printHtml = html }, close() {} },
          focus() {}, print() {}, setTimeout(fn) { fn() },
        });
      });
      await sleep(200);
      await page.click('[data-timetable-print]');
      await sleep(400);
      const printHtml = await page.evaluate(() => window.__printHtml || '');
      check(
        '打印会生成当周页面（含课程、班级、备注与 A4 横向设置）',
        printHtml.includes(`${STAMP} 数学`) && printHtml.includes('三班 / 教学楼 201')
          && printHtml.includes(`${STAMP} 带尺子`) && printHtml.includes('A4 landscape'),
        `len=${printHtml.length}`,
      );
      // 打印的行数必须等于表里配的节次数：课要落在节次里，不能因为手工时间多长出一行。
      const printTable = (await api(page, `/api/timetable/tables/${id1}`, 'GET')).body?.data?.table || {};
      const periodTotal = (printTable.periods || []).length;
      const printedRows = (printHtml.match(/<th class="t"><span/g) || []).length;
      check('打印的行数等于节次数（课程都落在节次内）', printedRows === periodTotal, `${printedRows} vs ${periodTotal}`);

      // 移动端也看一眼（截图留档）
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(`${BASE}/admin/timetable`, { waitUntil: 'networkidle2' });
      await sleep(1200);
      await dismissAlerts(page);
      await page.screenshot({ path: path.join(SHOTS, 'timetable-390.png') });
      check('手机上一列一天，能正常打开', (await page.$$('[data-day-column]')).length === 7);
    } finally {
      // ---------------- 收尾 ----------------
      for (const id of createdTables) {
        await api(page, `/api/timetable/tables/${id}`, 'DELETE').catch(() => {});
      }
      await api(page, '/api/configs', 'PUT', { key: 'timetable_enabled', value: originalFlag });
      const left = await api(page, '/api/timetable/tables');
      const residue = (left.body?.data?.tables || []).filter((t) => t.name.startsWith(STAMP));
      check('收尾：自检表已删干净', residue.length === 0, residue.map((t) => t.name).join(','));
    }
  });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exitCode = failed ? 1 : 0;
})();
