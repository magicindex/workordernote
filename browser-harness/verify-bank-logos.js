/**
 * 银行标志「只留图形」的核对：
 *   1) 把裁前（git 里的原图）与裁后（当前工作区）都画进 128×128 画布，
 *      统计墨迹占比、连通块数量、最大连通块占比、墨迹外接框 ——
 *      文字是很多小块，图形是 1~3 大块，用这个区分「字还在不在」。
 *   2) 输出一张对照片（裁前 / 裁后 / 银行名）到 shots/bank-logos-marks.png，供人眼确认。
 *
 * 用法：node verify-bank-logos.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { withTab, sleep } = require('./harness');

const ROOT = path.join(__dirname, '..', 'reminders-upstream');
const BANKS = path.join(ROOT, 'web', 'src', 'assets', 'banks');
const SHOTS = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const LABELS = {
  abchina: '农业银行', bankcomm: '交通银行', bankofbeijing: '北京银行', boc: '中国银行',
  bosc: '上海银行', ccb: '建设银行', cebbank: '光大银行', cgbchina: '广发银行',
  cib: '兴业银行', citicbank: '中信银行', cmbc: '民生银行', cmbchina: '招商银行',
  czbank: '浙商银行', hfbank: '恒丰银行', hxb: '华夏银行', icbc: '工商银行',
  jsbchina: '江苏银行', nbcb: '宁波银行', njcb: '南京银行', pingan: '平安银行',
  psbc: '邮储银行', spdb: '浦发银行',
};

const analyze = (imageData, w, h) => {
  const ink = new Uint8Array(w * h);
  let count = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < w * h; i += 1) {
    const r = imageData[i * 4], g = imageData[i * 4 + 1], b = imageData[i * 4 + 2], a = imageData[i * 4 + 3];
    const isInk = a > 40 && (r < 235 || g < 235 || b < 235);
    if (!isInk) continue;
    ink[i] = 1; count += 1;
    const x = i % w, y = Math.floor(i / w);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // 连通块（4 邻域）
  const seen = new Uint8Array(w * h);
  const sizes = [];
  for (let i = 0; i < w * h; i += 1) {
    if (!ink[i] || seen[i]) continue;
    let size = 0;
    const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop(); size += 1;
      const x = cur % w, y = Math.floor(cur / w);
      const nb = [];
      if (x > 0) nb.push(cur - 1);
      if (x < w - 1) nb.push(cur + 1);
      if (y > 0) nb.push(cur - w);
      if (y < h - 1) nb.push(cur + w);
      for (const n of nb) if (ink[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  const big = sizes.filter((s) => s >= 4); // 忽略抗锯齿小点
  return {
    coverage: count / (w * h),
    blobs: big.length,
    biggest: big.length ? big[0] / count : 0,
    box: maxX < 0 ? null : { w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h },
  };
};

(async () => {
  const files = fs.readdirSync(BANKS).filter((f) => f.endsWith('.svg')).sort();
  const data = files.map((f) => {
    const code = f.replace('.svg', '');
    // 「裁前」取哪个版本：默认 HEAD；可用 BEFORE_REF 指定（例如看「只留图形」那一版
    // 与现在「完整标志」这一版的差别）。
    let before = '';
    const ref = process.env.BEFORE_REF || 'HEAD';
    try {
      before = execSync(`git show ${ref}:web/src/assets/banks/${f}`, { cwd: ROOT, encoding: 'utf8' });
    } catch { before = fs.readFileSync(path.join(BANKS, f), 'utf8'); }
    return { code, name: LABELS[code] || code, before, after: fs.readFileSync(path.join(BANKS, f), 'utf8') };
  });

  await withTab(async (page) => {
    const results = await page.evaluate(async (items) => {
      const draw = (svg) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const w = 128, h = 128;
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          // object-cover：正方形画布 + 正方形 viewBox，直接铺满
          ctx.drawImage(img, 0, 0, w, h);
          resolve(ctx.getImageData(0, 0, w, h));
        };
        img.onerror = () => resolve(null);
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      });
      const out = [];
      for (const it of items) {
        out.push({ code: it.code, before: await draw(it.before), after: await draw(it.after) });
      }
      return out;
    }, data);

    let cropped = 0, textGone = 0, bad = [];
    console.log('  银行            裁前(块/最大块占比/覆盖)      裁后(块/最大块占比/覆盖)   判定');
    for (const r of results) {
      const a = r.before ? analyze(r.before.data, 128, 128) : null;
      const b = r.after ? analyze(r.after.data, 128, 128) : null;
      if (!a || !b) { bad.push(r.code); continue; }
      const fmt = (x) => `${String(x.blobs).padStart(3)} / ${x.biggest.toFixed(2)} / ${x.coverage.toFixed(2)}`;
      const changed = JSON.stringify(a.blobs) !== JSON.stringify(b.blobs) || Math.abs(a.coverage - b.coverage) > 0.01;
      if (changed) cropped += 1;
      // 裁后应该「块少、有一块占主导」= 只有图形，没有一排小字
      const ok = b.blobs <= 6 && b.biggest >= 0.5;
      if (ok) textGone += 1; else bad.push(`${r.code}(块${b.blobs}/主导${b.biggest.toFixed(2)})`);
      console.log(`  ${(LABELS[r.code] || r.code).padEnd(12)} ${fmt(a).padEnd(28)} ${fmt(b).padEnd(26)} ${ok ? '✓' : '✗'}`);
    }
    console.log(`\n  被裁过的：${cropped} / ${results.length}；裁后像「单一图形」的：${textGone} / ${results.length}`);
    if (bad.length) console.log('  需要人眼确认：', bad.join('、'));

    // 对照片：两行一看，左边原图右边裁后
    await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
    await page.setContent(`<html><body style="margin:0;background:#f8fafc;font:12px/1.4 system-ui">
      <div style="padding:14px 18px;font-weight:700;font-size:15px">银行标志：左＝${process.env.BEFORE_LABEL || '旧版'} → 右＝${process.env.AFTER_LABEL || '当前版（完整标志、透明底、收紧 viewBox）'}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:0 18px 18px">
      ${data.map((d) => `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px;text-align:center">
        <div style="display:flex;align-items:center;justify-content:center;gap:8px">
          <div><img src="data:image/svg+xml;base64,${Buffer.from(d.before).toString('base64')}" style="width:56px;height:56px;object-fit:contain;border:1px dashed #e2e8f0;border-radius:8px">
            <div style="color:#94a3b8;font-size:10px">裁前</div></div>
          <div style="color:#cbd5e1;font-size:16px">→</div>
          <div><img src="data:image/svg+xml;base64,${Buffer.from(d.after).toString('base64')}" style="width:56px;height:56px;object-fit:cover;border-radius:9999px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15)">
            <div style="color:#94a3b8;font-size:10px">裁后</div></div>
        </div>
        <div style="margin-top:6px;font-weight:600">${d.name}</div>
      </div>`).join('')}
      </div></body></html>`, { waitUntil: 'load' });
    await sleep(1200);
    await page.screenshot({ path: path.join(SHOTS, 'bank-logos-marks.png'), fullPage: true });
    console.log(`  对照片：${path.join(SHOTS, 'bank-logos-marks.png')}`);
  });
})().catch((err) => { console.error('核对失败：', err.message); process.exit(1); });
