/**
 * 验证「日历任务字号」设置端到端生效：UI 改设置 → 保存 → 日历里字号真的变。
 * 用本机默认浏览器（商店的 fygo-browser，有头）。
 *
 * 三个容易踩的坑（都已处理）：
 *   1. 保存按钮与 select 同在一个父容器里，别向上找祖先（会点到别的行）；
 *   2. 改完 select 要等 Vue 刷新禁用态再点保存，同一个 tick 里按钮还是 disabled；
 *   3. 选成"和当前一样"的值不会变 dirty，按钮永远禁用——所以要双向切换来验证。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;

async function setFontSize(page, label) {
  await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1800);
  const fired = await page.evaluate((text) => {
    const sel = [...document.querySelectorAll('select')].find(
      (s) => [...s.options].some((o) => o.textContent.trim() === text));
    if (!sel) return 'no-select';
    const opt = [...sel.options].find((o) => o.textContent.trim() === text);
    if (sel.value === opt.value) return 'already:' + opt.value;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'changed:' + opt.value;
  }, label);
  await sleep(500); // 等 Vue 把禁用态刷新掉
  const saved = await page.evaluate((text) => {
    const sel = [...document.querySelectorAll('select')].find(
      (s) => [...s.options].some((o) => o.textContent.trim() === text));
    const btn = sel.parentElement.querySelector('button');
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'clicked';
  }, label);
  await sleep(2200);
  return { fired, saved };
}

async function measure(page) {
  await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2200);
  return page.evaluate(() => {
    const el = document.querySelector('.cal-task');
    const cell = document.querySelector('.cal-cell');
    return {
      font: el ? getComputedStyle(el).fontSize : null,
      cell: cell ? getComputedStyle(cell).minHeight : null,
    };
  });
}

withTab(async (page) => {
  await login(page, BASE);
  const results = [];
  const check = (name, ok, extra = '') => {
    results.push(ok);
    console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  };

  console.log('先设为「标准」');
  console.log('  ', JSON.stringify(await setFontSize(page, '标准')));
  const medium = await measure(page);
  console.log('  日历:', JSON.stringify(medium));
  check('标准字号 = 10px', medium.font === '10px', medium.font);

  console.log('再设为「特大」');
  console.log('  ', JSON.stringify(await setFontSize(page, '特大')));
  const xlarge = await measure(page);
  console.log('  日历:', JSON.stringify(xlarge));
  check('特大字号 = 13px', xlarge.font === '13px', xlarge.font);
  check('字号确实变大了', parseFloat(xlarge.font) > parseFloat(medium.font));
  check('格子高度同步放大', parseFloat(xlarge.cell) > parseFloat(medium.cell), `${medium.cell} → ${xlarge.cell}`);

  console.log('还原为「标准」');
  console.log('  ', JSON.stringify(await setFontSize(page, '标准')));
  const back = await measure(page);
  console.log('  日历:', JSON.stringify(back));
  check('已还原 = 10px', back.font === '10px', back.font);

  const okCount = results.filter(Boolean).length;
  console.log(`\n汇总: ${okCount}/${results.length} 通过`);
  if (okCount !== results.length) process.exitCode = 1;
}).catch((e) => { console.error('出错:', e && e.message); process.exit(1); });
