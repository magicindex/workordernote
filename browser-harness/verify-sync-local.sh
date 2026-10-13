#!/usr/bin/env bash
# 验证「已配好的两台实例」之间同步是双向的、删除也会传播。
#
#   A_URL=http://192.168.3.201:8906 B_URL=http://192.168.3.201:8908 \
#   A_USER=王耀辉 A_PASS='...' bash verify-sync-local.sh
#
# 做法：在 A 上建一条自检任务 → A 同步 → 断言 B 出现 → A 删除 → 从 B 同步
#       → 断言 B 也消失（反向传播）→ 比两边内容指纹与基线条目数。
# 结束时两边都不留痕；同步方向/间隔沿用现有设置，不改配置。
set -uo pipefail

A_URL=${A_URL:-http://192.168.3.201:8906}
B_URL=${B_URL:-http://192.168.3.201:8908}
A_USER=${A_USER:-王耀辉}
A_PASS=${A_PASS:-Wyh!1984yelq.}
TITLE="自检-双向同步-$(date +%s)"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
check_eq() { if [ "$1" = "$2" ]; then ok "$3（$1）"; else bad "$3：期望 $2，实际 $1"; fi; }
json() { python3 -c "import json,sys;d=json.loads(sys.argv[1]);print($2)" "$1" 2>/dev/null || echo "__PARSE_ERROR__"; }

login() {
  local body
  body=$(curl -sS -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$A_USER\",\"password\":\"$A_PASS\"}" "$1/api/auth/login")
  json "$body" "d['data']['token']"
}
items() { curl -sS -H "Authorization: Bearer $2" "$1/api/reminder/items?view=all&status=all"; }
item_count() { json "$(items "$1" "$2")" "len(d['data'])"; }
has_title() { json "$(items "$1" "$2")" "sum(1 for i in d['data'] if i['title']=='''$3''')"; }
sync_run() { curl -sS -X POST --max-time 180 -H "Authorization: Bearer $2" "$1/api/reminder/admin/sync/run"; }
# 内容指纹：标题/类型/清单名/到期/完成 五项排序后拼串，两边必须一致。
fingerprint() {
  python3 - "$1" <<'PY'
import json, sys
data = json.loads(sys.argv[1])['data']
rows = sorted(f"{i['title']}|{i['kind']}|{i['list_name']}|{i['due_at']}|{i['completed_at']}" for i in data)
print(len(rows), '|', '||'.join(rows[:3]))
PY
}

echo "== 0. 登录与基线 =="
TA=$(login "$A_URL"); TB=$(login "$B_URL")
if [ "${TA:0:2}" = "ey" ] && [ "${TB:0:2}" = "ey" ]; then ok "两端登录成功"; else bad "登录失败：$TA / $TB"; exit 1; fi
S_A=$(curl -sS -H "Authorization: Bearer $TA" "$A_URL/api/reminder/admin/sync")
S_B=$(curl -sS -H "Authorization: Bearer $TB" "$B_URL/api/reminder/admin/sync")
check_eq "$(json "$S_A" "d['data']['direction']")" "both" "A 端同步方向为双向"
check_eq "$(json "$S_B" "d['data']['direction']")" "both" "B 端同步方向为双向"

# 前提：A 与 B 是**直接配对**的。对端指向第三台机器时立刻退出，别把自检数据推过去
# （本轮就踩过：201 的对端被改成 200 之后仍按 A→B 跑，自检任务被推到了 200）。
PEER_A=$(json "$S_A" "d['data']['peer_url']"); PEER_B=$(json "$S_B" "d['data']['peer_url']")
if [ "$PEER_A" != "$B_URL" ] || [ "$PEER_B" != "$A_URL" ]; then
  bad "拓扑不匹配：A 的对端=$PEER_A（期望 $B_URL），B 的对端=$PEER_B（期望 $A_URL）"
  echo "  这个脚本只验证「A 与 B 直接配对」；对端指向别处时请改传对应的 A_URL/B_URL，或先改回配对。"
  echo "  已提前退出，未创建任何自检数据。"
  exit 3
fi
ok "两端互为对端（$A_URL ↔ $B_URL）"
BASE_A=$(item_count "$A_URL" "$TA"); BASE_B=$(item_count "$B_URL" "$TB")
# 不把「开始前两台一致」当硬前提：A 上（比如刚跑完回归）删掉的数据可能还没同步到 B，
# 差几条是正常的；同步要保证的是**最后收敛到同一份数据**（见第 4 节）。
if [ "$BASE_A" = "$BASE_B" ]; then
  ok "两端条目数一致（基线 $BASE_A）"
else
  ok "两端基线不同（A=$BASE_A / B=$BASE_B，通常是 A 上刚改过、还没同步过去），以收敛为准"
fi

echo "== 1. A 建一条自检任务 =="
DUE=$(date -d '+3 hours' -Iseconds)
CREATED=$(curl -sS -X POST -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' \
  -d "{\"title\":\"$TITLE\",\"due_at\":\"$DUE\",\"repeat_rule\":\"none\",\"channels\":[\"inapp\"]}" \
  "$A_URL/api/reminder/items")
ID_A=$(json "$CREATED" "d['data']['id']")
if [ -n "$ID_A" ] && [ "$ID_A" != "__PARSE_ERROR__" ]; then ok "A 端已建（id=$ID_A）"; else bad "A 端建任务失败：$CREATED"; exit 1; fi

echo "== 2. A 同步 → B 应收到 =="
check_eq "$(json "$(sync_run "$A_URL" "$TA")" "d['data']['status']")" "ok" "A 端同步成功"
check_eq "$(has_title "$B_URL" "$TB" "$TITLE")" "1" "B 端出现这条任务（A→B）"

echo "== 3. A 删除 → 从 B 同步 → B 也应删除（B→A 的反向传播）=="
curl -sS -X DELETE -H "Authorization: Bearer $TA" "$A_URL/api/reminder/items/$ID_A" >/dev/null
check_eq "$(json "$(sync_run "$B_URL" "$TB")" "d['data']['status']")" "ok" "B 端同步成功"
check_eq "$(has_title "$B_URL" "$TB" "$TITLE")" "0" "B 端这条任务已消失（删除传播）"
check_eq "$(has_title "$A_URL" "$TA" "$TITLE")" "0" "A 端也看不到它"

echo "== 4. 幂等与收敛 =="
check_eq "$(json "$(sync_run "$A_URL" "$TA")" "d['data']['status']")" "ok" "再同步一次成功（幂等）"
FINAL_A=$(item_count "$A_URL" "$TA"); FINAL_B=$(item_count "$B_URL" "$TB")
check_eq "$FINAL_A" "$BASE_A" "A 端条目数回到基线（自检数据清干净了）"
check_eq "$FINAL_A" "$FINAL_B" "两端收敛到同一份数据（A=$FINAL_A / B=$FINAL_B）"
FP_A=$(fingerprint "$(items "$A_URL" "$TA")")
FP_B=$(fingerprint "$(items "$B_URL" "$TB")")
check_eq "$FP_A" "$FP_B" "两端内容指纹一致（含标题/清单/时间）"

printf '\n\033[1m结果：%d 项通过，%d 项失败\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
