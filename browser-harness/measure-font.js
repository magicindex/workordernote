const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = process.env.APP_URL || APP;

withTab(async (page) => {
  await login(page, BASE);
  const measure = async (label) => {
    await page.goto(BASE + '/admin/calendar', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2200);
    const m = await page.evaluate(() => {
      const el = document.querySelector('.cal-task');
      const cell = document.querySelector('.cal-cell');
      return { font: el ? getComputedStyle(el).fontSize : null, cell: cell ? getComputedStyle(cell).minHeight : null };
    });
    console.log('  ' + label + ':', JSON.stringify(m));
    return m;
  };
  // 当前服务端配置为 xlarge（由 API 写入）
  await measure('当前（服务端为 xlarge）');
}).catch((e) => { console.error('出错:', e.message); process.exit(1); });
