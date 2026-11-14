/** 编辑面板「边框透明拖拽区」测试辅助：不依赖可见手柄。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function editorInfo(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.editor-panel');
    const r = panel?.getBoundingClientRect();
    const edges = [...document.querySelectorAll('[data-editor-resize]')].map((el) => {
      const b = el.getBoundingClientRect();
      return {
        edge: el.getAttribute('data-editor-resize'),
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
      };
    });
    return {
      panel: !!panel,
      title: panel?.querySelector('h2')?.textContent || '',
      left: r?.left || 0,
      top: r?.top || 0,
      w: r?.width || 0,
      h: r?.height || 0,
      edges,
      btns: [...document.querySelectorAll('.editor-footer button')].map((b) => Math.round(b.getBoundingClientRect().width)),
      floatingHandle: !!document.querySelector('[data-note-resize-handle]'),
    };
  });
}

/** 拉宽度：左抽屉拉右边缘，右抽屉拉左边缘；向面板外侧拖 delta。 */
async function dragWidth(page, info, delta = 120) {
  const edge = info.edges.find((e) => e.edge === 'right') || info.edges.find((e) => e.edge === 'left');
  if (!edge) throw new Error('没有可用的左右边缘拖拽区');
  const dir = edge.edge === 'right' ? 1 : -1;
  const y = info.top + info.h / 2;
  await page.mouse.move(edge.x, y);
  await page.mouse.down();
  await page.mouse.move(edge.x + dir * delta, y, { steps: 12 });
  await page.mouse.up();
  await sleep(420);
  return edge.edge;
}

/** 拉底边：向上 = 高度变小。 */
async function dragBottom(page, info, dy = -100) {
  const edge = info.edges.find((e) => e.edge === 'bottom');
  if (!edge) throw new Error('没有底边拖拽区');
  const x = info.left + info.w / 2;
  await page.mouse.move(x, edge.y);
  await page.mouse.down();
  await page.mouse.move(x, edge.y + dy, { steps: 12 });
  await page.mouse.up();
  await sleep(420);
}

module.exports = { editorInfo, dragWidth, dragBottom };
