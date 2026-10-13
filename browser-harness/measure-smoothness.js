/**
 * 手机端「显示流畅度」的量尺：把 CPU 降速 4 倍（模拟中低端手机），
 * 在列表页来回滚动，统计帧间隔与长任务。用来做前后对比，不作为通过/失败判据。
 *
 * 用法：APP_URL=http://192.168.3.201:8906 node measure-smoothness.js
 */
const { withTab, sleep, waitFor } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = process.env.APP_URL || APP;
const ROOT = BASE.replace(/\/$/, '');

(async () => {
  await withTab(async (page) => {
    await login(page, BASE);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(ROOT + '/admin/all', { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => !!document.querySelector('.list-toolbar'), { timeout: 20000 });
    await sleep(1500);
    await page.emulateCPUThrottling(4);
    const result = await page.evaluate(async () => {
      const samples = [];
      const longTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) longTasks.push(Math.round(e.duration));
        }).observe({ entryTypes: ['longtask'] });
      } catch { /* 不支持就不统计 */ }
      let last = performance.now();
      await new Promise((resolve) => {
        let frames = 0;
        const tick = (t) => {
          samples.push(t - last);
          last = t;
          if (++frames < 140) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
        let y = 0;
        let dir = 1;
        const timer = setInterval(() => {
          y += 60 * dir;
          if (y > 1800) { y = 1800; dir = -1; }
          if (y < 0) { y = 0; dir = 1; }
          document.scrollingElement.scrollTop = y;
        }, 16);
        setTimeout(() => clearInterval(timer), 2400);
      });
      const sorted = samples.slice(5).sort((a, b) => a - b);
      const at = (q) => Math.round(sorted[Math.floor(sorted.length * q)] * 10) / 10;
      return {
        frames: sorted.length,
        p50: at(0.5), p95: at(0.95), p99: at(0.99), max: Math.round(sorted[sorted.length - 1]),
        over33: sorted.filter((v) => v > 33).length,
        longTasks,
        longTaskTotal: longTasks.reduce((a, b) => a + b, 0),
      };
    });
    await page.emulateCPUThrottling(1);
    const label = process.env.LABEL || BASE;
    console.log(`${label}`);
    console.log(`  帧数=${result.frames}  p50=${result.p50}ms  p95=${result.p95}ms  p99=${result.p99}ms  最长=${result.max}ms`);
    console.log(`  掉帧(>33ms)=${result.over33}  长任务=${result.longTasks.length} 个，合计 ${result.longTaskTotal}ms`);
  });
  process.exit(0);
})().catch((e) => { console.error('出错:', e); process.exit(1); });
