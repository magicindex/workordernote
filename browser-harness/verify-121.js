/**
 * 侧栏「我的清单」整段排序（用户 2026-10-15）：
 *
 *   「侧栏「我的清单」里的先后顺序，把系统内置的 4个栏目也放这里允许调整顺序」
 *
 * 改造前：只有自建清单能排，而且要点开「偏好设置 → 清单顺序」；「全部 / 提醒@他 /
 * 信用卡账单 / 随手记事本 / 人生要有仪式感」这几行是写死的，位置动不了。
 * 改造后：「我的清单」标题旁多一个排序开关，进去以后这一段**每一行**都能用 ↑ ↓ 挪，
 * 顺序存进用户配置 sidebar_order（没存过就用默认先后），清单行同时把先后写回各清单的
 * position，所以偏好设置里的清单顺序、清单筛选下拉看到的顺序也跟侧栏一致。
 *
 * 钉住这几条：
 *   1. 侧栏这一段按 myListRows 渲染（每行有 data-my-row），日常态不显示 ↑ ↓；
 *   2. 点开关进排序模式后，**每一行**（含系统内置栏目）都有可用的 ↑ ↓，首行 ↑ / 末行 ↓ 置灰；
 *   3. 点 ↓ 后顺序立刻变，并且**存到了服务端**（配置 sidebar_order）；
 *   4. 清单行的先后写回 position：接口 /lists 的顺序与侧栏一致；
 *   5. 排序模式下点行本体不跳页（免得刚点开排序就被带走）；
 *   6. 退出排序模式按钮消失、顺序保持，刷新页面后也还在。
 * 测完把顺序与清单 position 还原成测试前的样子，不留脏数据。
 *
 * 用法：APP_URL=http://127.0.0.1:8920 node verify-121.js
 */
const { withTab, sleep } = require('./harness')
const { login, APP } = require('./reminders-app')

const BASE = (process.env.APP_URL || APP).replace(/\/$/, '')

let passed = 0
let failed = 0
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}

const api = (page, p, method = 'GET', body = null) => page.evaluate(async ({ base, p, method, body }) => {
  const token = localStorage.getItem('reminders.token') || sessionStorage.getItem('reminders.token')
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}, { base: BASE, p, method, body })

/** 侧栏这一段现在渲染出来的行：key、显示名、有没有 ↑ ↓ */
const rowsOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-my-row]')].map((el) => {
  // 显示名 = 整行文字去掉角标（角标是 .nav-count，不能算进名字里）
  const clone = el.querySelector('.nav-row')?.cloneNode(true)
  clone?.querySelectorAll('.nav-count').forEach((n) => n.remove())
  return {
    key: el.getAttribute('data-my-row'),
    label: (clone?.textContent || '').trim(),
    up: !!el.querySelector('[data-my-move] button[aria-label*="上移"]'),
    down: !!el.querySelector('[data-my-move] button[aria-label*="下移"]'),
  }
}))

async function main() {
  return withTab(async (page) => {
    await login(page, BASE)
    // 侧栏折叠态记在本地：先清掉再进，保证这个断言的 ↑ ↓ 是**看得见、点得到**的
    await page.evaluate(() => localStorage.removeItem('ui_rail_collapsed'))
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
    await sleep(2500)
    // 未读提醒会弹全屏遮罩盖住侧栏，先标已读（只对测试实例做）
    await api(page, '/api/reminder/notifications/read-all', 'POST')
    await sleep(300)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(2500)

    const hasCaption = await page.evaluate(() => [...document.querySelectorAll('.nav-caption')]
      .some((c) => (c.textContent || '').includes('我的清单')))
    check('侧栏有「我的清单」这一段', hasCaption)
    check('标题旁有排序开关', (await page.$('[data-my-order-toggle]')) !== null)

    const before = await rowsOf(page)
    const beforeCfg = (await api(page, '/api/configs')).body?.data?.sidebar_order ?? ''
    const beforeLists = (await api(page, '/api/reminder/lists')).body?.data?.map((l) => l.id) ?? []
    // 期望出现的系统栏目：接口里有这个栏目、并且它的开关是开着的（关掉的本来就不该出现）
    const listsAll = (await api(page, '/api/reminder/lists')).body?.data ?? []
    const cfgs = (await api(page, '/api/configs')).body?.data ?? {}
    const flagOn = (k) => String(cfgs[k] ?? 'true') !== 'false'
    const sysLabels = []
    if (flagOn('credit_card_enabled') && listsAll.some((l) => l.template === 'credit_card')) sysLabels.push('信用卡账单')
    if (flagOn('notebook_enabled') && listsAll.some((l) => l.template === 'notebook')) sysLabels.push('随手记事本')
    if (flagOn('ceremony_enabled') && listsAll.some((l) => l.template === 'ceremony')) sysLabels.push('人生要有仪式感')

    check('这一段渲染成可排的行（全部 / 系统栏目 / 自建清单）',
      before.length >= 5, JSON.stringify(before.map((r) => `${r.key}=${r.label}`)))
    check('日常态不显示 ↑ ↓', before.every((r) => !r.up && !r.down))
    check('开着的系统栏目都在侧栏里（信用卡 / 记事本 / 仪式感）',
      sysLabels.every((n) => before.some((r) => r.label === n)),
      JSON.stringify({ sysLabels, labels: before.map((r) => r.label) }))

    // ---------- 1. 进排序模式 ----------
    await page.click('[data-my-order-toggle]')
    await sleep(400)
    const sorting = await rowsOf(page)
    check('进排序模式后每一行都有 ↑ ↓',
      sorting.length === before.length && sorting.every((r) => r.up && r.down),
      JSON.stringify(sorting.map((r) => ({ key: r.key, up: r.up, down: r.down }))))
    check('第一行的 ↑ 与最后一行的 ↓ 置灰（到边了）', await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-my-row]')]
      const up = rows[0]?.querySelector('[data-my-move] button[aria-label*="上移"]')
      const down = rows[rows.length - 1]?.querySelector('[data-my-move] button[aria-label*="下移"]')
      return !!(up && up.disabled && down && down.disabled)
    }))
    check('系统内置栏目（含「全部」）在排序模式下也能挪',
      sysLabels.every((n) => sorting.some((r) => r.label === n && r.up && r.down))
      && sorting.some((r) => r.label === '全部' && r.up && r.down)
      && !sorting.some((r) => r.label === '提醒@他'),
      JSON.stringify(sorting.map((r) => r.label)))

    // ---------- 2. 排序模式下点行本体不跳页 ----------
    const pathBefore = await page.evaluate(() => location.pathname)
    await page.click('[data-my-row] .nav-row')
    await sleep(700)
    const pathAfter = await page.evaluate(() => location.pathname)
    check('排序模式下点行本体不跳页', pathAfter === pathBefore, `${pathBefore} → ${pathAfter}`)

    // ---------- 3. 点 ↓ 挪一行：顺序立刻变 ----------
    const firstKey = sorting[0].key
    await page.click(`[data-my-move="${firstKey}"] button[aria-label*="下移"]`)
    await sleep(800)
    const moved = await rowsOf(page)
    check('点 ↓ 后第一行换人、原第一行落到第二位',
      moved[0]?.key !== firstKey && moved[1]?.key === firstKey,
      JSON.stringify(moved.map((r) => r.key)))

    // ---------- 4. 顺序存到服务端 ----------
    let cfgRaw = ''
    for (let i = 0; i < 12; i++) {
      cfgRaw = (await api(page, '/api/configs')).body?.data?.sidebar_order ?? ''
      if (cfgRaw) break
      await sleep(300)
    }
    let parsed = []
    try { parsed = JSON.parse(cfgRaw) } catch { parsed = [] }
    check('顺序已存到服务端（配置 sidebar_order）',
      parsed[0] === moved[0].key && parsed[1] === moved[1].key,
      cfgRaw)

    // ---------- 5. 清单行的先后写回 position ----------
    const listRowKeys = moved.filter((r) => r.key.startsWith('list:')).map((r) => r.key)
    const listsNow = (await api(page, '/api/reminder/lists')).body?.data?.map((l) => `list:${l.id}`) ?? []
    const ranked = listsNow.filter((k) => listRowKeys.includes(k))
    check('清单行的先后写回了 position（接口 /lists 与侧栏一致）',
      JSON.stringify(ranked) === JSON.stringify(listRowKeys),
      JSON.stringify({ ranked, listRowKeys }))

    // ---------- 6. 退出排序模式：按钮消失、顺序保持；刷新后还在 ----------
    await page.click('[data-my-order-toggle]')
    await sleep(400)
    const afterExit = await rowsOf(page)
    check('退出排序模式后 ↑ ↓ 消失、顺序保持',
      afterExit.every((r) => !r.up && !r.down) && afterExit[0]?.key === moved[0].key,
      JSON.stringify(afterExit.map((r) => r.key)))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(2500)
    const afterReload = await rowsOf(page)
    check('刷新页面后顺序还在（服务端那份生效）',
      JSON.stringify(afterReload.map((r) => r.key)) === JSON.stringify(moved.map((r) => r.key)),
      JSON.stringify(afterReload.map((r) => r.key)))

    // ---------- 7. 还原测试前的顺序与 position（不留脏数据给后面的用例） ----------
    const restoreOrder = beforeCfg || JSON.stringify(before.map((r) => r.key))
    await api(page, '/api/configs', 'PUT', { key: 'sidebar_order', value: restoreOrder })
    if (beforeLists.length) await api(page, '/api/reminder/lists/order', 'PUT', { ids: beforeLists })
    const back = (await api(page, '/api/configs')).body?.data?.sidebar_order ?? ''
    check('测试后顺序已还原', back === restoreOrder, back)
  })
}

main().then(() => {
  console.log(`\n结果：${passed} 项通过，${failed} 项失败`)
  process.exit(failed ? 1 : 0)
}).catch((err) => {
  console.error('运行失败：', err)
  process.exit(1)
})
