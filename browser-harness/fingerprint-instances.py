#!/usr/bin/env python3
# 跨实例数据指纹：三台（201 / 200 / 沙箱 8908）的清单、卡片、提醒、完成记录、记事
# 各自算一个**跨实例可比**的指纹，然后逐项对照。
#
# 为什么不能用 id：id 是各实例自己的自增/本地 id，跨机必然不同（沙箱还是整目录拷过去的）。
# 所以清单按「名字 + 模板 + 图标」，卡片按「卡名 + 尾号 + 清单名」，提醒按
# 「标题 + 类型 + 清单名 + 到期 + 完成时间」，完成记录按「标题 + 完成时间」。
# 排序后拼串取 sha256 前 10 位 —— 只比对内容，不比对顺序（顺序另有断言）。
#
# 用法：python3 fingerprint-instances.py [http://127.0.0.1:8906 ...]
import hashlib
import json
import sys
import urllib.request

USER = "王耀辉"
PASS = "Wyh!1984yelq."
DEFAULT_TARGETS = [
    "http://127.0.0.1:8906",
    "http://192.168.3.200:8906",
    "http://127.0.0.1:8908",
]


def call(url, path, token=None, method="GET"):
    req = urllib.request.Request(url + path, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def login(url):
    req = urllib.request.Request(
        url + "/api/auth/login",
        data=json.dumps({"username": USER, "password": PASS}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())["data"]["token"]


def digest(rows):
    rows = sorted(rows)
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()[:10]


def collect(url):
    token = login(url)
    lists = call(url, "/api/reminder/lists", token)["data"]
    cards = call(url, "/api/reminder/cards", token)["data"]
    items = call(url, "/api/reminder/items?view=all&status=all", token)["data"]
    done = call(url, "/api/reminder/items?view=completed&status=all", token)["data"]
    notes = [i for i in items if i.get("kind") == "note"]
    note_bucket = [l for l in lists if l.get("template") == "notebook"]
    return {
        "版本": call(url, "/api/version")["data"]["version"],
        "清单名+模板+图标": digest(
            [f"{l['name']}|{l.get('template') or 'list'}|{l.get('icon')}" for l in lists]
        ),
        "卡片": digest(
            [f"{c.get('name')}|{c.get('bank')}|{c.get('no')}|{c.get('color')}" for c in cards]
        ),
        "提醒": digest(
            [f"{i['title']}|{i['kind']}|{i['list_name']}|{i.get('due_at')}|{i.get('completed_at')}" for i in items]
        ),
        "完成记录": digest([f"{i['title']}|{i.get('completed_at')}" for i in done]),
        "记事本图标": (note_bucket[0].get("icon") if note_bucket else "（没有）"),
        "条数": f"清单 {len(lists)} / 卡片 {len(cards)} / 提醒 {len(items)} / 完成 {len(done)} / 记事 {len(notes)}",
    }


def main():
    targets = sys.argv[1:] or DEFAULT_TARGETS
    data = {}
    for url in targets:
        try:
            data[url] = collect(url)
        except Exception as exc:  # noqa: BLE001 - 自检脚本，失败就直接说明
            data[url] = {"错误": f"{type(exc).__name__}: {exc}"}
    keys = [k for k in next(iter(data.values())) if k not in ("版本", "条数", "记事本图标")]
    head = "项".ljust(16) + "".join(u.replace("http://", "").ljust(24) for u in targets)
    print(head)
    for key in keys + ["记事本图标", "版本", "条数"]:
        row = key.ljust(16)
        for url in targets:
            row += str(data[url].get(key, "-")).ljust(24)
        same = len({str(data[url].get(key)) for url in targets}) == 1
        print(row + ("" if same else "  ← 不一致"))
    print()
    for key in keys:
        if len({str(data[u].get(key)) for u in targets}) == 1:
            print(f"✓ {key} 三台一致：{data[targets[0]][key]}")
        else:
            print(f"✗ {key} 不一致：{ {u: data[u].get(key) for u in targets} }")


if __name__ == "__main__":
    main()
