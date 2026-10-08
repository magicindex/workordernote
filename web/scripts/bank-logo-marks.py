#!/usr/bin/env python3
"""把「银行标志（图形 + 文字）」裁成「只有图形」。

背景：`assets/banks/*.svg` 来自 `@icongo/bl`（Bank Logos Icons，MIT），都是
「图形 + 银行名文字」的完整标志，画在 1024×1024 的画布上。卡面上那个 36px 的
白底圆里，文字缩成一小团糊字（用户要求：只显示图标，不要图标中的字）。

做法：**只改 viewBox**（不动任何 path 数据）——按子路径的包围盒把图形那一块
框出来，文字自然就被裁到画布外了。原来的完整标志随时可以还原（git 里有）。

用法：
  python3 web/scripts/bank-logo-marks.py --dry-run   # 只打印每个银行的判定
  python3 web/scripts/bank-logo-marks.py             # 就地改 viewBox
"""
import re
import sys
import glob
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
BANKS = HERE.parent / "src" / "assets" / "banks"

TOKEN = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?")
CMD = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]")
VIEWBOX = re.compile(r'viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"')
# 图形与文字之间的空白通常 ≥ 40px（画布 1024）；小于这个值就算同一个簇
CLUSTER_GAP = 28
# 图形本身的宽高比必须像「一个方块图形」，不像就会退回整幅
MIN_ASPECT, MAX_ASPECT = 0.55, 1.95


def subpaths(d: str):
    """把一条 path 的 d 拆成子路径，返回每个子路径的粗略包围盒（控制点也当点算）。"""
    toks = TOKEN.findall(d)
    boxes = []
    xs, ys = [], []
    cur = [0.0, 0.0]
    start = [0.0, 0.0]
    op = None
    i = 0
    while i < len(toks):
        t = toks[i]
        if CMD.fullmatch(t):
            op = t
            i += 1
            if op in "Zz":
                cur = start[:]
                continue
            if op in "Mm" and xs:
                boxes.append((min(xs), min(ys), max(xs), max(ys)))
                xs, ys = [], []
        if op is None:
            break
        rel = op.islower()
        c = op.upper()

        def take(n):
            nonlocal i
            vals = [float(x) for x in toks[i:i + n]]
            i += n
            return vals

        try:
            if c == "M":
                x, y = take(2)
                cur = [cur[0] + x, cur[1] + y] if rel else [x, y]
                start = cur[:]
                xs.append(cur[0]); ys.append(cur[1])
                op = "l" if rel else "L"
            elif c == "L":
                x, y = take(2)
                cur = [cur[0] + x, cur[1] + y] if rel else [x, y]
                xs.append(cur[0]); ys.append(cur[1])
            elif c == "H":
                x = take(1)[0]
                cur[0] = cur[0] + x if rel else x
                xs.append(cur[0])
            elif c == "V":
                y = take(1)[0]
                cur[1] = cur[1] + y if rel else y
                ys.append(cur[1])
            elif c in ("C", "S"):
                v = take(6 if c == "C" else 4)
                for k in range(0, len(v), 2):
                    xs.append(cur[0] + v[k] if rel else v[k])
                    ys.append(cur[1] + v[k + 1] if rel else v[k + 1])
                cur = [cur[0] + v[-2], cur[1] + v[-1]] if rel else [v[-2], v[-1]]
            elif c in ("Q", "T"):
                v = take(4 if c == "Q" else 2)
                for k in range(0, len(v), 2):
                    xs.append(cur[0] + v[k] if rel else v[k])
                    ys.append(cur[1] + v[k + 1] if rel else v[k + 1])
                cur = [cur[0] + v[-2], cur[1] + v[-1]] if rel else [v[-2], v[-1]]
            elif c == "A":
                v = take(7)
                nx = cur[0] + v[5] if rel else v[5]
                ny = cur[1] + v[6] if rel else v[6]
                xs += [cur[0], nx]; ys += [cur[1], ny]
                cur = [nx, ny]
            else:
                i += 1
        except (ValueError, IndexError):
            break
    if xs:
        boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes


def total_head(clusters):
    """所有簇的并集包围盒（--full 用）。"""
    return [min(c[0] for c in clusters), min(c[1] for c in clusters),
            max(c[2] for c in clusters), max(c[3] for c in clusters)]


def merge(boxes):
    """把挨得很近的包围盒并成一个簇（图形常由好几段笔画组成）。"""
    clusters = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        out = []
        while clusters:
            a = clusters.pop()
            merged = False
            for b in out:
                if not (a[2] < b[0] - CLUSTER_GAP or b[2] < a[0] - CLUSTER_GAP
                        or a[3] < b[1] - CLUSTER_GAP or b[3] < a[1] - CLUSTER_GAP):
                    b[0] = min(b[0], a[0]); b[1] = min(b[1], a[1])
                    b[2] = max(b[2], a[2]); b[3] = max(b[3], a[3])
                    merged = True
                    changed = True
                    break
            if not merged:
                out.append(a)
        clusters = out
    return sorted(clusters, key=lambda c: c[0])


def decide(path: Path, vb, clusters):
    """挑出「图形」那一簇。

    不能只看最左边：工商银行的标志是「ICBC 字母 + 圆形徽标 + 中文名」，最左边那簇
    是又扁又宽的字母；而文字里单个汉字也可能接近方形（中国银行的「中」宽高比 0.70）。
    所以规则是：在**宽高比像个图形（0.55–1.95）**的簇里挑**面积最大**的，并且要求它
    明显大于次大的候选（≥1.6 倍）、高度接近整幅内容高度（≥55%）。都不满足就退回整幅
    （那种标志要么本身就是纯图形，要么是纯文字，裁了反而更糟）。
    """
    vx, vy, vw, vh = vb
    total = [min(c[0] for c in clusters), min(c[1] for c in clusters),
             max(c[2] for c in clusters), max(c[3] for c in clusters)]
    if len(clusters) < 2:
        return total, "单个簇（本来就是纯图形）", 1
    overall_h = total[3] - total[1]
    candidates = []
    for c in clusters:
        w, h = c[2] - c[0], c[3] - c[1]
        if h <= 0:
            continue
        aspect = w / h
        if MIN_ASPECT <= aspect <= MAX_ASPECT and h >= 0.55 * overall_h:
            candidates.append((w * h, c, aspect))
    if not candidates:
        return total, "没有像图形的簇 → 不裁", 0
    candidates.sort(key=lambda x: -x[0])
    area, best, aspect = candidates[0]
    second = candidates[1][0] if len(candidates) > 1 else 0
    if second and area < 1.6 * second:
        return total, f"最大的方形簇只比次大的大 {area / second:.2f} 倍（像文字）→ 不裁", 0
    return best, f"裁到面积最大的图形簇（宽高比 {aspect:.2f}）", 1


def main():
    dry = "--dry-run" in sys.argv
    # --full：不再只留图形，而是把 viewBox 收紧到**整个标志**（图形 + 银行名文字）的
    # 包围盒。卡面要的是「透明底 + 完整标志」：标志本身画在 1024×1024 画布中间的一条
    # 横带上，不裁紧的话按高度显示只有几个像素高，等于看不见。
    full = "--full" in sys.argv
    files = sorted(glob.glob(str(BANKS / "*.svg")))
    cropped = 0
    for f in files:
        p = Path(f)
        s = p.read_text()
        m = VIEWBOX.search(s)
        if not m:
            print(f"  {p.name}: 没有 viewBox，跳过")
            continue
        vb = tuple(float(x) for x in m.groups())
        boxes = []
        for d in re.findall(r'<path[^>]*\bd="([^"]+)"', s):
            boxes += subpaths(d)
        clusters = merge(boxes)
        if full:
            crop = [total_head(clusters)[0], total_head(clusters)[1], total_head(clusters)[2], total_head(clusters)[3]]
            why = "收紧到整个标志（图形+文字）"
            changed = 1
        else:
            crop, why, changed = decide(p, vb, clusters)
        w, h = crop[2] - crop[0], crop[3] - crop[1]
        if full:
            # 保留真实宽高比，只留 2% 内边距（透明底，直接贴在卡面上）
            pad = max(w, h) * 0.02
            new = (crop[0] - pad, crop[1] - pad, w + 2 * pad, h + 2 * pad)
        else:
            # 裁出来的块要尽量方：圆形里 object-cover 才不会又切掉内容
            side = max(w, h) * 1.16  # 留一点边距，别顶到圆边
            cx, cy = (crop[0] + crop[2]) / 2, (crop[1] + crop[3]) / 2
            new = (cx - side / 2, cy - side / 2, side, side)
        txt = "  ".join(f"{v:.0f}" for v in new)
        print(f"  {p.name:18s} 簇 {len(clusters):2d}  原 {vb[0]:.0f},{vb[1]:.0f},{vb[2]:.0f},{vb[3]:.0f} → "
              f"viewBox=\"{txt}\"  图形宽高比 {w/h if h else 0:.2f}  {why}")
        if changed and not dry:
            new_vb = f'viewBox="{new[0]:.0f} {new[1]:.0f} {new[2]:.0f} {new[3]:.0f}"'
            p.write_text(VIEWBOX.sub(new_vb, s, count=1))
            cropped += 1
    print(f"\n共 {len(files)} 个标志，{'（dry-run）' if dry else f'已裁 {cropped} 个'}")


if __name__ == "__main__":
    main()
