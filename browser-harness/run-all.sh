#!/bin/bash
# 全量回归（浏览器用例）。
#
# 用法：
#   APP_URL=http://127.0.0.1:8908 bash run-all.sh      # 沙箱
#   APP_URL=http://127.0.0.1:8918 bash run-all.sh      # 迭代容器
#   APP_URL=http://127.0.0.1:8906 bash run-all.sh      # 生产
#
# 为什么要写成一个脚本：
#   · **登录接口有 20 次/分钟/IP 的限流**（公开接口限流组，见 server/server.go）。
#     一口气跑二十几个套件，很容易在某个套件上撞到 429，表现成「token 拿不到、
#     后面全红」——单跑又全绿。所以这里：每个套件之间歇 5 秒，失败的歇 20 秒再试一次。
#   · 汇总里给出总项数，方便和发布说明里的数字对照。
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=${APP_URL:-http://127.0.0.1:8908}
SUITES=(
  verify-ux verify-filters verify-013 verify-017 verify-icon verify-print verify-export
  verify-040 verify-050 verify-052 verify-060 verify-070 verify-080
  verify-090 verify-091 verify-092 verify-093 verify-094 verify-096
  verify-097 verify-099 verify-100 verify-101 verify-102 verify-103 verify-104 verify-105 verify-106 verify-107 verify-108 verify-109 verify-110 verify-111 verify-112 verify-113 verify-114 verify-115 verify-116 verify-117 verify-118 verify-119 verify-120 verify-121 verify-122 verify-123 verify-124 verify-125 verify-126 verify-127 verify-128 verify-129 verify-130 verify-131 verify-132 verify-133 verify-134 verify-135 verify-136 verify-137 verify-138 verify-139 verify-140 verify-141 verify-142 verify-143 verify-144 verify-145 verify-146 verify-147 verify-148 verify-149 verify-150 verify-151 verify-152 verify-154 verify-155 verify-156 verify-157 verify-158 verify-159 verify-160 verify-162 verify-163 verify-165 verify-166
  verify-reminders
)
# 故意不进这份清单的：
#   verify-098（要 verify-098.sh 起两台实例：老机 + 空库新机）
#   verify-sync / verify-sync-e2e.sh / verify-sync-local.sh（双机同步，需要两个实例）
#   verify-124-model / verify-124-ollama（同一个用例的两条模型分支，手动跑）
#   verify-bank-logos（一次性核对银行标志裁图，不是回归项）

# 先探一下目标在不在：目标没起来的话每个套件都会「登录失败/全红」，白跑十几分钟
# （本轮就因为迭代容器被收尾删掉，连吃了两次「Failed to fetch」）。
if ! curl -s -o /dev/null --max-time 5 "$BASE/api/version"; then
  echo "目标不可达：$BASE —— 先确认实例/容器在跑（迭代容器：docker start wsn-iter）"
  exit 2
fi
echo "目标：$BASE（$(curl -s --max-time 5 "$BASE/api/version" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['version'],d['gitCommit'])" 2>/dev/null)）"

# 开跑前先清一遍上一轮可能留下的自检数据。某个套件被打断（最常见的是撞上登录限流）
# 时会留下「自检…」条目，后面的套件 —— 尤其是 verify-091 的「没有残留自检数据」——
# 会因此假红，而单跑又是绿的（反复踩过好几次）。
bash "$HERE/clean-self-test.sh" "$BASE" >/dev/null 2>&1 || true

total=0
suites_ok=0
suites_fail=0
failed_list=()

# SKIP_SUITES="verify-101 verify-102" 可以跳过某几条：发 0.14.x 候选版时，下一批
# 才有的用例（例如智能清单的 verify-101）在候选版上必然红，跳过比留一堆假红清楚。
for skip in ${SKIP_SUITES:-}; do
  SUITES=("${SUITES[@]/$skip/}")
done

for s in "${SUITES[@]}"; do
  [ -z "$s" ] && continue
  code=1
  out=""
  # 公开接口限流是 20 次/分钟/IP，而一个套件动不动登录十几次：连着跑很容易撞上。
  # 所以失败就退避重试（30 秒、60 秒），并明确把「第几次」打出来，便于分辨真假失败。
  for attempt in 1 2 3; do
    out=$(APP_URL="$BASE" timeout 900 node "$HERE/$s.js" 2>&1)
    code=$?
    [ $code -eq 0 ] && break
    if [ $attempt -lt 3 ]; then
      wait=$((attempt * 30))
      echo "[$s] 第 $attempt 次未通过（多为登录限流），${wait} 秒后重试…"
      sleep $wait
    fi
  done
  line=$(echo "$out" | grep -E "通过" | tail -1)
  echo "[$s] exit=$code | $line"
  if [ $code -eq 0 ]; then
    suites_ok=$((suites_ok + 1))
  else
    suites_fail=$((suites_fail + 1))
    failed_list+=("$s")
  fi
  n=$(echo "$line" | sed -nE 's/.*：([0-9]+) (项)?通过.*/\1/p; s/.*汇总: ([0-9]+)\/([0-9]+) 通过.*/\1/p' | head -1)
  [ -n "$n" ] && total=$((total + n))
  sleep 8
done

echo
echo "== 回归汇总 =="
echo "套件：$suites_ok 通过 / $suites_fail 失败（共 ${#SUITES[@]}）"
echo "项数：$total 项通过"
if [ $suites_fail -gt 0 ]; then
  echo "失败套件：${failed_list[*]}"
  exit 1
fi
