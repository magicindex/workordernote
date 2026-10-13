#!/bin/bash
# 「新设备导入向导」端到端：
#   · 起一台**空库**实例当新设备（默认 8921，用当前开发镜像）
#   · 用 8918（迭代容器）当老设备，并在它上面造一个「只存在于老设备」的账号与其数据
#   · 在新设备上用浏览器走完向导：连对端 → 勾账号 → 导入
#   · 校验：账号被创建、能用生成的密码登录、清单与内容都到位、同步设置写好、再次同步幂等
#   · 收尾：删掉老设备上的测试账号与数据，删掉新设备容器
#
# 用法：IMAGE=workordernote:dev-card bash verify-098.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WORKSPACE=$(cd "$HERE/.." && pwd)
IMAGE=${IMAGE:-workordernote:dev-card}
PORT=${PORT:-8921}
# 注意：新设备跑在容器里，容器内的 127.0.0.1 指向它自己——对端地址必须是
# 宿主机的局域网地址（默认取 192.168.3.201:8918）
PEER=${PEER:-http://192.168.3.201:8918}
NAME=wsn-import-newdev
DATA="$WORKSPACE/tmp/import-newdev"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1
  # 数据目录属主是容器里的 1000，宿主机账号删不掉：用 root 容器清
  docker run --rm -v "$WORKSPACE/tmp:/w" alpine:latest sh -c 'rm -rf /w/import-newdev' >/dev/null 2>&1
}
trap cleanup EXIT

echo "== 起一台空库新设备（端口 $PORT，镜像 $IMAGE）=="
rm -rf "$DATA" && mkdir -p "$DATA"
docker rm -f "$NAME" >/dev/null 2>&1
docker run -d --name "$NAME" -p "$PORT:8906" --user 1000:1000 \
  -v "$DATA":/app/data -v /etc/localtime:/etc/localtime:ro \
  -e TZ=Asia/Shanghai -e ENV=release -e DATA_DIR=/app/data "$IMAGE" >/dev/null
for i in $(seq 1 20); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/version" && break
  sleep 1
done
echo "  新设备版本：$(curl -s "http://127.0.0.1:$PORT/api/version" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["version"])' 2>/dev/null)"

APP_URL="http://127.0.0.1:$PORT" PEER_URL="$PEER" node "$HERE/verify-098.js"
