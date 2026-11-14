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

/** 拉宽度：左抽屉拉右边缘，右抽屉拉左边缘；向面板外侧拖 delta。
 *  用合成 PointerEvent 直接打到拖拽区/ window，避免生产库上的提醒弹窗盖住鼠标坐标。 */
async function dragWidth(page, info, delta = 120) {
  const edge = info.edges.find((e) => e.edge === 'right') || info.edges.find((e) => e.edge === 'left');
  if (!edge) throw new Error('没有可用的左右边缘拖拽区');
  await page.evaluate(({ edgeName, delta }) => {
    const zone = [...document.querySelectorAll('[data-editor-resize]')].find((el) => el.getAttribute('data-editor-resize') === edgeName);
    const panel = document.querySelector('.editor-panel');
    if (!zone || !panel) return;
    const b = zone.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    const dir = edgeName === 'right' ? 1 : -1;
    const x = b.x + b.width / 2;
    const y = r.top + r.height / 2;
    const opts = (px, py) => ({ bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: px, clientY: py });
    zone.dispatchEvent(new PointerEvent('pointerdown', opts(x, y)));
    window.dispatchEvent(new PointerEvent('pointermove', opts(x + dir * delta, y)));
    window.dispatchEvent(new PointerEvent('pointerup', opts(x + dir * delta, y)));
  }, { edgeName: edge.edge, delta });
  await sleep(420);
  return edge.edge;
}

/** 拉底边：向上 = 高度变小。同样用合成 PointerEvent。 */
async function dragBottom(page, info, dy = -100) {
  const edge = info.edges.find((e) => e.edge === 'bottom');
  if (!edge) throw new Error('没有底边拖拽区');
  await page.evaluate(({ dy }) => {
    const zone = [...document.querySelectorAll('[data-editor-resize]')].find((el) => el.getAttribute('data-editor-resize') === 'bottom');
    const panel = document.querySelector('.editor-panel');
    if (!zone || !panel) return;
    const b = zone.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = b.y + b.height / 2;
    const opts = (px, py) => ({ bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: px, clientY: py });
    zone.dispatchEvent(new PointerEvent('pointerdown', opts(x, y)));
    window.dispatchEvent(new PointerEvent('pointermove', opts(x, y + dy)));
    window.dispatchEvent(new PointerEvent('pointerup', opts(x, y + dy)));
  }, { dy });
  await sleep(420);
}

module.exports = { editorInfo, dragWidth, dragBottom };
