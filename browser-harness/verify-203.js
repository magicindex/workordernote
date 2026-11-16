/** 桌面日历：不出现页面纵向滚动条；卡片内任务/时段字号一致且长标题不溢出。 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');
const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}
(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await login(page, BASE);
    for (const h of [900, 768]) {
      await page.setViewport({ width: 1360, height: h });
      await page.goto(BASE + '/admin/calendar', { waitUntil: 'domcontentloaded' });
      await sleep(1800);
      const info = await page.evaluate(() => {
        const root = document.querySelector('[data-month-grid]')?.closest('.animate-fade-in');
        const task = document.querySelector('[data-cal-task]');
        const span = document.querySelector('[data-cal-span]');
        const taskTitle = task?.querySelector('.truncate');
        const longest = [...document.querySelectorAll('[data-cal-task]')].sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
        const cell = longest?.closest('.cal-cell');
        const lr = longest?.getBoundingClientRect();
        const cr = cell?.getBoundingClientRect();
        const lt = longest?.querySelector('.truncate');
        const lcs = lt ? getComputedStyle(lt) : null;
        return {
          docH: document.documentElement.scrollHeight,
          viewH: window.innerHeight,
          bodyH: document.body.scrollHeight,
          rootH: root ? Math.round(root.getBoundingClientRect().height) : 0,
          taskFont: task ? getComputedStyle(task).fontSize : '',
          spanFont: span ? getComputedStyle(span).fontSize : '',
          taskWeight: task ? getComputedStyle(task).fontWeight : '',
          spanWeight: span ? getComputedStyle(span).fontWeight : '',
          cardTitleFont: document.querySelector('.cal-card-title') ? getComputedStyle(document.querySelector('.cal-card-title')).fontSize : '',
          cardMetaFont: document.querySelector('.cal-card-meta') ? getComputedStyle(document.querySelector('.cal-card-meta')).fontSize : '',
          cardTitleWeight: document.querySelector('.cal-card-title') ? getComputedStyle(document.querySelector('.cal-card-title')).fontWeight : '',
          cardMetaWeight: document.querySelector('.cal-card-meta') ? getComputedStyle(document.querySelector('.cal-card-meta')).fontWeight : '',
          hasTask: !!task,
          hasSpan: !!span,
          taskOverflow: !!taskTitle && taskTitle.scrollWidth > taskTitle.clientWidth + 1,
          longestWithinCell: !!lr && !!cr && lr.right <= cr.right + 1 && lr.left >= cr.left - 1,
          longestEllipsis: lcs?.overflow === 'hidden' && lcs?.whiteSpace === 'nowrap' && lcs?.textOverflow === 'ellipsis',
          docW: document.documentElement.scrollWidth,
          viewW: window.innerWidth,
        };
      });
      check(`桌面 ${h}px 无页面纵向滚动条`, info.docH <= info.viewH + 1 && info.bodyH <= info.viewH + 1, JSON.stringify(info));
      check(`桌面 ${h}px 日历卡片不横向溢出`, info.docW <= info.viewW + 1, JSON.stringify(info));
      if (info.hasTask && info.hasSpan) {
        check(`桌面 ${h}px 任务与时间段字号/字重一致且不加粗`,
          info.taskFont === info.spanFont && info.taskWeight === '400' && info.spanWeight === '400',
          JSON.stringify({ task: info.taskFont, span: info.spanFont, tw: info.taskWeight, sw: info.spanWeight }));
        check(`桌面 ${h}px 右侧卡片标题与描述同为正文级 14px、不加粗`,
          info.cardTitleFont === '14px' && info.cardMetaFont === '14px'
            && info.cardTitleWeight === '400' && info.cardMetaWeight === '400', JSON.stringify(info));
      } else {
        check(`桌面 ${h}px 有任务/时间段可检查字号`, false, JSON.stringify(info));
      }
      if (info.hasTask) {
        check(`桌面 ${h}px 最长标题不冲出格子，并按省略号收口`,
          info.longestWithinCell && info.longestEllipsis, JSON.stringify(info));
      }
    }
  }, { width: 1360, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
