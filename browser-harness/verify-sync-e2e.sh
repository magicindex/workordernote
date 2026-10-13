#!/usr/bin/env bash
# 双机同步端到端验证：起两台真实容器（8911 / 8912），让它们真的通过 HTTP 互相同步。
#
# 覆盖：单向推送 / 单向拉取 / 双向合并 / 冲突（谁新谁赢）/ 删除传播 /
#       完成历史 / 令牌鉴权 / 对端指向自己 / 定时同步的开关。
#
# 用法：
#   bash verify-sync-e2e.sh            # 跑完保留容器（供浏览器验证继续用）
#   KEEP=0 bash verify-sync-e2e.sh     # 跑完自动清理容器
#
# 前置：本机已有 workordernote:<版本> 镜像（IMAGE 环境变量可覆盖）。
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# 默认镜像跟仓库 VERSION 走，别再写死：写死 0.3.0 时，脚本看着全绿，其实跑的是几个月前那版二进制
# （0.9.0 这轮就发现了这个坑：容器里是 workordernote:0.3.0）。
# 兼容两种存放方式（同 verify-offline-package.sh）：工作区并排 或 仓库内
if [ -f "$HERE/../reminders-upstream/VERSION" ]; then
  SYNC_REPO=$(cd "$HERE/../reminders-upstream" && pwd)
else
  SYNC_REPO=$(cd "$HERE/.." && pwd)
fi
IMAGE=${IMAGE:-workordernote:$(cat "$SYNC_REPO/VERSION" 2>/dev/null || echo 0.3.0)}
A_NAME=wsn-sync-a
B_NAME=wsn-sync-b
A_PORT=8911
B_PORT=8912
KEEP=${KEEP:-1}
# 可选：把本地已构建的前端挂进容器，用于「改了前端不重建镜像」的快速迭代。
# 留空则用镜像里自带的前端。
WEB_DIST=${WEB_DIST:-}
TOKEN="e2e-shared-token-123456"
USER_NAME="王耀辉"
USER_PASS="E2e!Passw0rd"
WORKDIR=$(cd "$(dirname "$0")/.." && pwd)
DATA_DIR="$WORKDIR/tmp/sync-e2e"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

check_eq() { # check_eq <实际> <期望> <说明>
  if [ "$1" = "$2" ]; then ok "$3（$1）"; else bad "$3：期望 $2，实际 $1"; fi
}

json() { # json <json串> <python表达式，d 为解析后的对象>
  python3 -c "import json,sys; d=json.loads(sys.argv[1]); print($2)" "$1" 2>/dev/null || echo "__PARSE_ERROR__"
}

# api <端口> <方法> <路径> [json体] [token]  —— 输出响应体，失败时输出 __HTTP_<码>__
api() {
  local port=$1 method=$2 path=$3 body=${4:-} token=${5:-}
  local args=(-sS -m 60 -X "$method" "http://127.0.0.1:$port$path" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  local out code
  out=$(curl "${args[@]}" -w '\n%{http_code}' 2>/dev/null)
  code=$(printf '%s' "$out" | tail -n1)
  out=$(printf '%s' "$out" | sed '$d')
  if [ "$code" != "200" ]; then echo "__HTTP_${code}__"; else printf '%s' "$out"; fi
}

cleanup_containers() {
  docker rm -f "$A_NAME" "$B_NAME" wsn-sync-fresh >/dev/null 2>&1 || true
}

# 数据目录清空：容器以本机 uid 运行（见下面 --user），所以直接 rm -rf 就够；
# 万一有上一轮以别的 uid 写下的文件，再用一个 root 容器兜底删掉。
reset_dir() {
  local dir=$1
  rm -rf "$dir" 2>/dev/null || true
  if [ -e "$dir" ]; then
    docker run --rm -v "$dir":/d alpine:latest sh -c 'rm -rf /d/* /d/.[!.]* 2>/dev/null' >/dev/null 2>&1 || true
  fi
  mkdir -p "$dir"
}

step "0. 准备两台全新实例（镜像 $IMAGE）"
cleanup_containers
mkdir -p "$DATA_DIR"
reset_dir "$DATA_DIR/a"
reset_dir "$DATA_DIR/b"
# --user 用本机 uid：镜像默认的 appuser 是 1000，测试目录归本机账号所有，
# 不指定的话容器写出来的文件属主不同，下一轮清理会 Permission denied。
RUN_USER="$(id -u):$(id -g)"
WEB_MOUNT=()
if [ -n "$WEB_DIST" ]; then WEB_MOUNT=(-v "$WEB_DIST:/app/static/dist:ro"); fi
docker run -d --name "$A_NAME" -p "$A_PORT:8906" -e TZ=Asia/Shanghai --user "$RUN_USER" \
  ${WEB_MOUNT[@]+"${WEB_MOUNT[@]}"} -v "$DATA_DIR/a:/app/data" "$IMAGE" >/dev/null
docker run -d --name "$B_NAME" -p "$B_PORT:8906" -e TZ=Asia/Shanghai --user "$RUN_USER" \
  ${WEB_MOUNT[@]+"${WEB_MOUNT[@]}"} -v "$DATA_DIR/b:/app/data" "$IMAGE" >/dev/null

for port in "$A_PORT" "$B_PORT"; do
  ready=0
  for _ in $(seq 1 40); do
    if [ "$(json "$(api "$port" GET /api/health)" "d['data']['status']")" = "ok" ]; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" = "1" ]; then ok "端口 $port 已就绪"; else bad "端口 $port 起不来"; fi
done

step "1. 两端创建同名账号「$USER_NAME」（自增 ID 相同也无妨，同步按用户名配对）"
TOKEN_A=$(json "$(api "$A_PORT" POST /api/auth/register "{\"username\":\"$USER_NAME\",\"password\":\"$USER_PASS\"}")" "d['data']['token']")
TOKEN_B=$(json "$(api "$B_PORT" POST /api/auth/register "{\"username\":\"$USER_NAME\",\"password\":\"$USER_PASS\"}")" "d['data']['token']")
if [ "${TOKEN_A:0:2}" = "ey" ]; then ok "A 端注册并登录成功"; else bad "A 端注册失败：$TOKEN_A"; fi
if [ "${TOKEN_B:0:2}" = "ey" ]; then ok "B 端注册并登录成功"; else bad "B 端注册失败：$TOKEN_B"; fi

step "2. B 端造数据：清单 1 个 + 任务 2 条 + 记事 1 条 + 重复提醒完成 1 次"
LIST_B=$(json "$(api "$B_PORT" POST /api/reminder/lists '{"name":"项目现场","color":"violet","icon":"list"}' "$TOKEN_B")" "d['data']['id']")
if [ "$LIST_B" != "__PARSE_ERROR__" ] && [ -n "$LIST_B" ]; then ok "B 端清单已建（id=$LIST_B）"; else bad "B 端建清单失败"; fi
DUE_B=$(date -d '+3 hours' -Iseconds)
api "$B_PORT" POST /api/reminder/items \
  "{\"title\":\"B 的单向任务\",\"list_id\":$LIST_B,\"due_at\":\"$DUE_B\",\"repeat_rule\":\"none\",\"channels\":[\"inapp\"]}" \
  "$TOKEN_B" >/dev/null
RECUR_ID=$(json "$(api "$B_PORT" POST /api/reminder/items \
  "{\"title\":\"B 的重复任务\",\"list_id\":$LIST_B,\"due_at\":\"$DUE_B\",\"repeat_rule\":\"monthly\",\"channels\":[\"inapp\"]}" \
  "$TOKEN_B")" "d['data']['id']")
api "$B_PORT" POST /api/reminder/items \
  "{\"title\":\"B 的记事\",\"list_id\":$LIST_B,\"kind\":\"note\",\"repeat_rule\":\"none\"}" "$TOKEN_B" >/dev/null
api "$B_PORT" POST "/api/reminder/items/$RECUR_ID/complete" "" "$TOKEN_B" >/dev/null
check_eq "$(json "$(api "$B_PORT" GET /api/reminder/items?view=all "" "$TOKEN_B")" "len(d['data'])")" "2" "B 端有 2 条进行中的任务（另有 1 条记事，见「已完成」）"
check_eq "$(json "$(api "$B_PORT" GET /api/reminder/completed "" "$TOKEN_B")" "len(d['data']['items'])")" "2" "B 端「已完成」2 条（1 条完成历史 + 1 条记事）"

check_eq "$(json "$(api "$A_PORT" GET /api/reminder/items?view=all "" "$TOKEN_A")" "len(d['data'])")" "0" "同步前 A 端一条都没有"

step "3. 单向推送：A 拉取 B 的数据（A=pull，B=push 的反向配法同样支持）"
B_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$B_NAME")
A_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$A_NAME")
printf '  容器内地址：A=%s  B=%s\n' "$A_IP" "$B_IP"

# B 设为「单向推送（本机 → 对端）」，A 设为「单向拉取」，等价于 A 从 B 拉数据。
check_eq "$(json "$(api "$B_PORT" PUT /api/reminder/admin/sync \
  "{\"direction\":\"push\",\"peer_url\":\"http://$A_IP:8906\",\"token\":\"$TOKEN\",\"interval_minutes\":0}" "$TOKEN_B")" "d['code']")" "0" "B 端保存同步设置（单向推送）"
check_eq "$(json "$(api "$A_PORT" PUT /api/reminder/admin/sync \
  "{\"direction\":\"pull\",\"peer_url\":\"http://$B_IP:8906\",\"token\":\"$TOKEN\",\"interval_minutes\":0}" "$TOKEN_A")" "d['code']")" "0" "A 端保存同步设置（单向拉取）"

TEST_A=$(api "$A_PORT" POST /api/reminder/admin/sync/test "" "$TOKEN_A")
check_eq "$(json "$TEST_A" "d['code']")" "0" "A 端「测试连接」成功"
check_eq "$(json "$TEST_A" "d['data']['matched_users'][0]")" "$USER_NAME" "测试结果里账号匹配成功"
check_eq "$(json "$TEST_A" "d['data']['reminders']")" "3" "测试结果报出对端 3 条提醒"

PULL=$(api "$A_PORT" POST /api/reminder/admin/sync/run "" "$TOKEN_A")
check_eq "$(json "$PULL" "d['data']['status']")" "ok" "A 端同步成功"
check_eq "$(json "$PULL" "d['data']['pulled']['reminders_created']")" "3" "A 端拉到 3 条提醒/记事"
check_eq "$(json "$PULL" "d['data']['pulled']['completions_created']")" "1" "A 端拉到 1 条完成历史"
check_eq "$(json "$(api "$A_PORT" GET /api/reminder/items?view=all "" "$TOKEN_A")" "len(d['data'])")" "2" "A 端现在有 2 条进行中的任务"
check_eq "$(json "$(api "$A_PORT" GET /api/reminder/completed "" "$TOKEN_A")" "[x['title'] for x in d['data']['items'] if x['kind']=='note'][0]")" "B 的记事" "记事（note）也同步过来了"
check_eq "$(json "$(api "$A_PORT" GET /api/reminder/completed "" "$TOKEN_A")" "len(d['data']['items'])")" "2" "A 端「已完成」里能看到拉来的完成历史与记事"
check_eq "$(json "$(api "$A_PORT" GET /api/reminder/items?view=all "" "$TOKEN_A")" "sorted(x['list_name'] for x in d['data'])[0]")" "项目现场" "清单归属也同步过来了"

step "4. 重复同步是幂等的（不会重复造数据）"
AGAIN=$(api "$A_PORT" POST /api/reminder/admin/sync/run "" "$TOKEN_A")
check_eq "$(json "$AGAIN" "d['data']['pulled']['reminders_created']")" "0" "第二次拉取没有新增"
check_eq "$(json "$AGAIN" "d['data']['pulled']['reminders_updated']")" "0" "第二次拉取没有改写"
check_eq "$(json "$(api "$A_PORT" GET /api/reminder/items?view=all "" "$TOKEN_A")" "len(d['data'])")" "2" "A 端仍是 2 条"

step "5. 双向同步：两边各自新建，跑一次同步后两边都有"
check_eq "$(json "$(api "$A_PORT" PUT /api/reminder/admin/sync \
  "{\"direction\":\"both\",\"peer_url\":\"http://$B_IP:8906\",\"token\":\"$TOKEN\",\"interval_minutes\":0}" "$TOKEN_A")" "d['code']")" "0" "A 端改为双向"
check_eq "$(json "$(api "$B_PORT" PUT /api/reminder/admin/sync \
  "{\"direction\":\"both\",\"peer_url\":\"http://$A_IP:8906\",\"token\":\"$TOKEN\",\"interval_minutes\":0}" "$TOKEN_B")" "d['code']")" "0" "B 端改为双向"

api "$A_PORT" POST /api/reminder/items \
  "{\"title\":\"A 新建的任务\",\"due_at\":\"$DUE_B\",\"repeat_rule\":\"none\",\"channels\":[\"inapp\"]}" "$TOKEN_A" >/dev/null
api "$B_PORT" POST /api/reminder/items \
  "{\"title\":\"B 新建的任务\",\"due_at\":\"$DUE_B\",\"repeat_rule\":\"none\",\"channels\":[\"inapp\"]}" "$TOKEN_B" >/dev/null
BOTH=$(api "$A_PORT" POST /api/reminder/admin/sync/run "" "$TOKEN_A")
check_eq "$(json "$BOTH" "d['data']['status']")" "ok" "A 端发起双向同步成功"
check_eq "$(json "$(api "$A_PORT" GET /api/reminder/items?view=all "" "$TOKEN_A")" "len(d['data'])")" "4" "A 端 4 条进行中的任务（2 + A 新建 + B 新建）"
check_eq "$(json "$(api "$B_PORT" GET /api/reminder/items?view=all "" "$TOKEN_B")" "len(d['data'])")" "4" "B 端 4 条（双向后两边一致）"

step "6. 冲突：同一条数据两边都改，改得晚的一方生效"
TARGET_ID=$(json "$(api "$A_PORT" GET /api/reminder/items?view=all "" "$TOKEN_A")" "[x['id'] for x in d['data'] if x['title']=='B 的单向任务'][0]")
TARGET_B=$(json "$(api "$B_PORT" GET /api/reminder/items?view=all "" "$TOKEN_B")" "[x['id'] for x in d['data'] if x['title']=='B 的单向任务'][0]")
api "$A_PORT" PUT "/api/reminder/items/$TARGET_ID" \
  "{\"title\":\"先在 A 改的标题\",\"due_at\":\"$DUE_B\",\"repeat_rule\":\"none\",\"channels\":[\"inapp\"]}" "$TOKEN_A" >/dev/null
sleep 2
api "$B_PORT" PUT "/api/reminder/items/$TARGET_B" \
  "{\"title\":\"后在 B 改的标题\",\"due_at\":\"$DUE_B\",\"repeat_rule\":\"none\",\"channels\":[\"inapp\"]}" "$TOKEN_B" >/dev/null
api "$A_PORT" POST /api/reminder/admin/sync/run "" "$TOKEN_A" >/dev/null
check_eq "$(json "$(api "$A_PORT" GET /api/reminder/items?view=all "" "$TOKEN_A")" "[x['title'] for x in d['data'] if '标题' in x['title']][0]")" "后在 B 改的标题" "A 端接受了较新的改动"
check_eq "$(json "$(api "$B_PORT" GET /api/reminder/items?view=all "" "$TOKEN_B")" "[x['title'] for x in d['data'] if '标题' in x['title']][0]")" "后在 B 改的标题" "B 端保持自己的较新改动"

step "7. 删除传播：在 A 删掉的任务不会在 B 复活"
api "$A_PORT" DELETE "/api/reminder/items/$TARGET_ID" "" "$TOKEN_A" >/dev/null
DEL=$(api "$A_PORT" POST /api/reminder/admin/sync/run "" "$TOKEN_A")
check_eq "$(json "$DEL" "d['data']['pushed']['reminders_deleted']")" "1" "推送里带上了 1 条删除"
check_eq "$(json "$(api "$B_PORT" GET /api/reminder/items?view=all "" "$TOKEN_B")" "len(d['data'])")" "3" "B 端只剩 3 条进行中的任务"
check_eq "$(json "$(api "$B_PORT" GET /api/reminder/items?view=all "" "$TOKEN_B")" "[x['title'] for x in d['data'] if '标题' in x['title']]")" "[]" "被删的任务在 B 端不再出现"
# 再过一轮，确认不会「复活」
api "$B_PORT" POST /api/reminder/admin/sync/run "" "$TOKEN_B" >/dev/null
check_eq "$(json "$(api "$A_PORT" GET /api/reminder/items?view=all "" "$TOKEN_A")" "len(d['data'])")" "3" "反向同步后 A 端仍是 3 条"

step "8. 令牌与配置错误必须被挡住"
WRONG=$(api "$B_PORT" GET /api/reminder/sync/info "" "" )
check_eq "$WRONG" "__HTTP_401__" "不带令牌访问对端接口 → 401"
WRONG2=$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Sync-Token: bad-token-000" "http://127.0.0.1:$B_PORT/api/reminder/sync/info")
check_eq "$WRONG2" "401" "令牌错误 → 401"
RIGHT=$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Sync-Token: $TOKEN" "http://127.0.0.1:$B_PORT/api/reminder/sync/info")
check_eq "$RIGHT" "200" "令牌正确 → 200"
SELF=$(api "$A_PORT" PUT /api/reminder/admin/sync \
  "{\"direction\":\"both\",\"peer_url\":\"http://127.0.0.1:8906\",\"token\":\"$TOKEN\",\"interval_minutes\":0}" "$TOKEN_A")
check_eq "$(json "$SELF" "d['code']")" "0" "把对端地址暂时改成自己（保存成功）"
SELFTEST=$(curl -sS -o /tmp/wsn-selftest.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' "http://127.0.0.1:$A_PORT/api/reminder/admin/sync/test")
check_eq "$SELFTEST" "400" "对端指向自己时「测试连接」被拒绝"
grep -q "对端实例标识与本机相同" /tmp/wsn-selftest.json && ok "拒绝原因说明了对端指向自己" || bad "拒绝原因不够明确：$(cat /tmp/wsn-selftest.json)"
# 改回去
api "$A_PORT" PUT /api/reminder/admin/sync \
  "{\"direction\":\"both\",\"peer_url\":\"http://$B_IP:8906\",\"token\":\"$TOKEN\",\"interval_minutes\":0}" "$TOKEN_A" >/dev/null
SHORT=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d "{\"direction\":\"both\",\"peer_url\":\"http://$B_IP:8906\",\"token\":\"abc\",\"interval_minutes\":0}" \
  "http://127.0.0.1:$A_PORT/api/reminder/admin/sync")
check_eq "$SHORT" "400" "令牌太短被拒绝（HTTP 400）"

step "9. 未启用同步的实例不接受对端数据"
FRESH_NAME=wsn-sync-fresh
FRESH_PORT=8913
docker rm -f "$FRESH_NAME" >/dev/null 2>&1 || true
reset_dir "$DATA_DIR/fresh"
docker run -d --name "$FRESH_NAME" -p "$FRESH_PORT:8906" -e TZ=Asia/Shanghai --user "$RUN_USER" \
  -v "$DATA_DIR/fresh:/app/data" "$IMAGE" >/dev/null
for _ in $(seq 1 40); do
  [ "$(json "$(api "$FRESH_PORT" GET /api/health)" "d['data']['status']")" = "ok" ] && break
  sleep 1
done
FRESH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Sync-Token: $TOKEN" "http://127.0.0.1:$FRESH_PORT/api/reminder/sync/info")
check_eq "$FRESH_CODE" "403" "全新实例（方向=关闭）拒绝同步请求 → 403"
docker rm -f "$FRESH_NAME" >/dev/null 2>&1

step "10. 同步不会把「对端的环境」搬过来"
check_eq "$(json "$(api "$A_PORT" GET /api/configs/system "" "$TOKEN_A")" "'allow_register' in d['data']")" "True" "系统配置仍由本机管理（未被对端覆盖）"
A_LOCAL_TOKEN=$(json "$(api "$A_PORT" GET /api/reminder/admin/sync "" "$TOKEN_A")" "d['data']['instance_id']")
B_LOCAL_TOKEN=$(json "$(api "$B_PORT" GET /api/reminder/admin/sync "" "$TOKEN_B")" "d['data']['instance_id']")
if [ "$A_LOCAL_TOKEN" != "$B_LOCAL_TOKEN" ]; then ok "两台机器的实例标识各自独立（$A_LOCAL_TOKEN / $B_LOCAL_TOKEN）"; else bad "实例标识竟然相同"; fi

printf '\n\033[1m结果：%d 项通过，%d 项失败\033[0m\n' "$PASS" "$FAIL"
printf '容器：%s（http://127.0.0.1:%s）、%s（http://127.0.0.1:%s），账号 %s / %s\n' \
  "$A_NAME" "$A_PORT" "$B_NAME" "$B_PORT" "$USER_NAME" "$USER_PASS"
if [ "$KEEP" = "1" ]; then
  printf '已保留容器供浏览器验证使用；不需要时执行：docker rm -f %s %s\n' "$A_NAME" "$B_NAME"
else
  cleanup_containers
  printf '已清理容器。\n'
fi
[ "$FAIL" -eq 0 ]
