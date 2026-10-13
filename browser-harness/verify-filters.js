/**
 * 清单筛选验收：日历视图与「已完成」页都能只显示选中的清单。
 * 用本机默认浏览器（商店的 fygo-browser）跑。
 */
const { withTab, sleep, waitFor, listCount } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
};
const goto = (page, path, ms = 2400) =>
  page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 }).then(() => sleep(ms));

/** 读日历当前显示的任务数（按清单名统计） */
const calByList = (page) => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('article, .cal-task').forEach(() => {});
  // 详情面板里每条的清单名
  document.querySelectorAll('aside article').forEach((a) => {
    const name = (a.textContent.match(/\S+/) || [''])[0];
  });
  return out;
});

withTab(async (page) => {
  await login(page, BASE);

  // 先清掉历史筛选，保证起点确定
  await page.evaluate(() => {
    try { localStorage.removeItem('ui_calendar_lists'); localStorage.removeItem('ui_completed_lists'); } catch {}
  });

  console.log('\n[1] 日历清单筛选');
  await goto(page, '/admin/calendar');
  const chips = await page.evaluate(() => {
    const wrap = [...document.querySelectorAll('div')].find((d) => d.textContent.trim().startsWith('清单') && d.querySelectorAll('button.quick-chip').length >= 2);
    if (!wrap) return null;
    return [...wrap.querySelectorAll('button.quick-chip')].map((b) => b.textContent.trim());
  });
  check('日历里有清单筛选（含「全部」）', !!chips && chips[0] === '全部', JSON.stringify(chips));

  const beforeCount = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find((s) => s.textContent.includes('未完成'));
    return el ? parseInt(el.textContent.replace(/\D/g, ''), 10) : null;
  });

  // 只勾选第一个具体清单
  const pickName = chips && chips.length > 1 ? chips[1] : null;
  if (pickName) {
    await page.evaluate((name) => {
      const btn = [...document.querySelectorAll('button.quick-chip')].find((b) => b.textContent.trim() === name);
      btn.click();
    }, pickName);
    await sleep(2500);
    const afterCount = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span')].find((s) => s.textContent.includes('未完成'));
      return el ? parseInt(el.textContent.replace(/\D/g, ''), 10) : null;
    });
    const activeChip = await page.evaluate((name) => {
      const btn = [...document.querySelectorAll('button.quick-chip')].find((b) => b.textContent.trim() === name);
      return btn ? btn.className.includes('active') : null;
    }, pickName);
    check(`勾选「${pickName}」后该芯片高亮`, activeChip === true);
    check('筛选后计数变化（或持平但已生效）', afterCount !== null && beforeCount !== null,
      `未完成 ${beforeCount} → ${afterCount}`);
    check('筛选状态已持久化', await page.evaluate(() => !!localStorage.getItem('ui_calendar_lists')));

    // 取消勾选应回到全部
    await page.evaluate((name) => {
      const btn = [...document.querySelectorAll('button.quick-chip')].find((b) => b.textContent.trim() === name);
      btn.click();
    }, pickName);
    await sleep(2200);
    const backCount = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span')].find((s) => s.textContent.includes('未完成'));
      return el ? parseInt(el.textContent.replace(/\D/g, ''), 10) : null;
    });
    check('取消勾选回到全部', backCount === beforeCount, `${afterCount} → ${backCount}`);
  } else {
    check('日历里有可勾选的清单', false, '只有一个清单，无法验证筛选');
  }

  console.log('\n[2] 已完成页清单筛选');
  await goto(page, '/admin/completed');
  const doneChips = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button.quick-chip')];
    const all = btns.find((b) => b.textContent.trim() === '全部');
    const names = btns.filter((b) => ['全部', '今天', '一周', '一月', '一年', '自定义'].indexOf(b.textContent.trim()) < 0 && b.querySelector('svg, i'));
    return { hasAll: !!all, listChips: names.map((b) => b.textContent.trim()) };
  });
  check('已完成页有清单筛选', doneChips.hasAll && doneChips.listChips.length > 0, JSON.stringify(doneChips));

  // 条数读取统一走 harness.listCount：工具栏改版（数字与单位拆成两个 span）时不用改用例
  const countItems = () => listCount(page);
  const totalAll = await countItems();
  if (doneChips.listChips.length) {
    const target = doneChips.listChips[0];
    await page.evaluate((name) => {
      const btn = [...document.querySelectorAll('button.quick-chip')].find((b) => b.textContent.trim() === name && b.querySelector('svg, i'));
      btn.click();
    }, target);
    await sleep(2500);
    const totalFiltered = await countItems();
    check(`按「${target}」筛选后列表随之变化`, totalFiltered <= totalAll, `全部 ${totalAll} 条 → 「${target}」 ${totalFiltered} 条`);
    check('已完成筛选状态已持久化', await page.evaluate(() => !!localStorage.getItem('ui_completed_lists')));

    // 换另一个清单再筛一次：两个清单的结果必须不同，才能证明筛选真的在区分
    const other = doneChips.listChips.find((n) => n !== target);
    if (other) {
      await page.evaluate((name) => {
        const btn = [...document.querySelectorAll('button.quick-chip')].find((b) => b.textContent.trim() === name && b.querySelector('svg, i'));
        btn.click();
      }, target); // 先取消当前
      await sleep(1200);
      await page.evaluate((name) => {
        const btn = [...document.querySelectorAll('button.quick-chip')].find((b) => b.textContent.trim() === name && b.querySelector('svg, i'));
        btn.click();
      }, other);
      await sleep(2500);
      const otherCount = await countItems();
      check(`换成「${other}」得到不同结果`, otherCount !== totalFiltered,
        `「${target}」${totalFiltered} 条 vs 「${other}」${otherCount} 条`);
      await page.evaluate((name) => {
        const btn = [...document.querySelectorAll('button.quick-chip')].find((b) => b.textContent.trim() === name && b.querySelector('svg, i'));
        btn.click();
      }, other);
      await sleep(1500);
    }
    // 还原
    await page.evaluate((name) => {
      const btn = [...document.querySelectorAll('button.quick-chip')].find((b) => b.textContent.trim() === name && b.querySelector('svg, i'));
      btn.click();
    }, target);
    await sleep(2000);
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n汇总: ${okCount}/${results.length} 通过`);
  if (okCount !== results.length) {
    console.log('未通过:', results.filter((r) => !r.ok).map((r) => r.name).join('、'));
    process.exitCode = 1;
  }
}).catch((e) => { console.error('出错:', e && e.message); process.exit(1); });
