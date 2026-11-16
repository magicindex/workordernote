/**
 * 信用卡账单：卡面上的「还款日」显示**完整年月日**。
 *
 * 用户 2026-11-16：「信用卡账单页面：卡片中 还款日期 当前显示年月 改为 年月日：
 * 还款日期需要精确到具体日期，方便用户安排还款」。
 *
 * 只读用例（不造数据）：拿实例上现有的卡，按接口给的本期还款日核对卡面文字；
 * 实例上一张卡都没有时才用接口临时建一张「自检…」卡，跑完删掉。
 */
const { withTab, sleep } = require('./harness');
const { login, APP } = require('./reminders-app');

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '');
let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
}

/** 用页面里的 token 调接口。 */
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const token = localStorage.getItem('reminders.token');
    const res = await fetch(path, {
      ...(init || {}),
      headers: { ...(init?.headers || {}), Authorization: 'Bearer ' + token },
    });
    return res.json().catch(() => null);
  }, { path, init });
}

(async () => {
  console.log(`目标：${BASE}`);
  await withTab(async (page) => {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, BASE);

    const lists = (await api(page, '/api/reminder/lists'))?.data || [];
    const bucket = lists.find((l) => l.name === '信用卡账单');
    check('侧栏里有「信用卡账单」栏目', !!bucket, JSON.stringify(lists.map((l) => l.name)));
    if (!bucket) return;

    let cards = (await api(page, '/api/reminder/cards'))?.data || [];
    let createdId = 0;
    if (!cards.length) {
      // 实例上一张卡都没有：临时建一张（自检），只为看渲染
      const res = await api(page, '/api/reminder/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '自检还款日精确到日', bank: '招商银行', statement_day: 5, due_day: 25, auto_repeat: true,
        }),
      });
      createdId = res?.data?.id || 0;
      cards = (await api(page, '/api/reminder/cards'))?.data || [];
      console.log('  （实例上没有卡，临时建了一张自检卡）');
    }
    check('取到了卡片数据', cards.length > 0, String(cards.length));

    await page.goto(BASE + `/admin/list/${bucket.id}`, { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // 卡面「还款日 X」文案 + 归属卡片
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-card-item]')].map((el) => ({
      id: Number(el.getAttribute('data-card-item')),
      text: (el.querySelector('[data-card-due-countdown]')?.textContent || '').trim(),
    })));

    check('卡片区域渲染出卡面', rows.length > 0, String(rows.length));
    // 两段是两个 span（窄卡片上会分开换行），textContent 里可能没有空格
    const shape = /^还款日 (\d{4}-\d{2}-\d{2})\s*（(还有 \d+ 天|就是今天)）$/;
    const bad = rows.filter((r) => !shape.test(r.text));
    check('每张卡的「还款日」都是完整年月日', rows.length > 0 && bad.length === 0,
      bad.map((r) => `${r.id}: ${r.text}`).join(' / '));

    // 文案里的日期必须等于接口里这一期的还款日（后端口径为准）
    const expect = new Map(cards.map((c) => [c.id, String(c.current?.due_date || c.summary?.due_date || '').slice(0, 10)]));
    const mismatch = rows.filter((r) => {
      const m = r.text.match(shape);
      return m && expect.get(r.id) && m[1] !== expect.get(r.id);
    });
    check('卡面日期与接口的本期还款日一致', rows.length > 0 && mismatch.length === 0,
      mismatch.map((r) => `${r.id}: 卡面 ${r.text} / 接口 ${expect.get(r.id)}`).join(' / '));

    // 旧的「月-日」写法不许再出现（避免只改了一部分）
    const old = rows.filter((r) => /还款日 \d{2}-\d{2}（/.test(r.text));
    check('不再出现「还款日 11-28」这种省略年份的写法', old.length === 0, old.map((r) => r.text).join(' / '));

    // 年份是真实年份：取第一张卡，与接口日期同一年
    const first = rows[0] || { text: '' };
    const m0 = first.text.match(shape);
    check('年份四位、与账期同年',
      !!m0 && /^20\d{2}$/.test(m0[1].slice(0, 4)) && (expect.get(first.id) || '').slice(0, 4) === m0[1].slice(0, 4),
      first.text);

    // 手机端：一行放得下、不撑破卡片（用户主要在手机上看还款日）
    await page.setViewport({ width: 390, height: 844 });
    await sleep(900);
    const mobile = await page.evaluate(() => [...document.querySelectorAll('[data-card-item]')].map((el) => {
      const meta = el.querySelector('[data-card-due-countdown]');
      const box = el.getBoundingClientRect();
      const r = meta ? meta.getBoundingClientRect() : null;
      return { text: (meta?.textContent || '').trim(), overflowX: !!r && r.right > box.right + 1 };
    }));
    check('手机端仍显示完整年月日', mobile.length > 0 && mobile.every((r) => shape.test(r.text)),
      mobile.map((r) => r.text).join(' / '));
    check('手机端还款日文案不溢出卡片', mobile.every((r) => !r.overflowX),
      mobile.filter((r) => r.overflowX).map((r) => r.text).join(' / '));
    await page.screenshot({ path: 'shots/verify-209-card-due.png' });

    if (createdId) {
      await api(page, `/api/reminder/cards/${createdId}`, { method: 'DELETE' }).catch(() => {});
      const after = (await api(page, '/api/reminder/cards'))?.data || [];
      check('自检卡已清理', !after.some((c) => c.id === createdId), String(after.length));
    }
  }, { width: 1440, height: 900 });
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('出错:', err?.message || err); process.exit(1); });
