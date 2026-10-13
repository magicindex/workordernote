#!/usr/bin/env bash
# 工作序记（WorkOrderNote）离线一键安装 / 升级
#
# 用法（解压后在本目录里执行）：
#   sudo bash install.sh                    # 默认端口 8906，数据放 ./data
#   sudo bash install.sh --port 8906 --data-dir /vol1/1000/Docker/workordernote
#   bash install.sh --help
#
# 特性：
#   - 全程离线：从包内自带的镜像 tar 加载，绝不联网拉镜像；
#   - 可重复执行：已安装时等价于「升级到本包版本」；
#   - 数据目录属主按当前用户设置（容器以同一 uid 运行），避免「写不进 SQLite 却不报错」。
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"

PORT=""
DATA_DIR=""
CONTAINER_NAME=""
FORCE_LOAD=0
NO_START=0

usage() {
  cat <<'USAGE'
用法: bash install.sh [选项]

选项:
  --port <端口>        对外端口，默认 8906
  --data-dir <目录>    数据目录（数据库/日志/上传），默认 ./data
  --name <容器名>      容器名，默认 workordernote
  --force-load         即使本机已有同名镜像也重新 docker load（用于校验包内镜像）
  --no-start           只加载镜像与准备目录，不启动容器
  -h, --help           显示本帮助
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --name) CONTAINER_NAME="${2:-}"; shift 2 ;;
    --force-load) FORCE_LOAD=1; shift ;;
    --no-start) NO_START=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1"; usage; exit 2 ;;
  esac
done

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---- 包信息 ----
[ -f package.env ] || die "缺少 package.env：请在解压后的安装包目录里执行本脚本"
# shellcheck disable=SC1091
. ./package.env
IMAGE_TAR_PATH="$HERE/${IMAGE_TAR:-image/image.tar.gz}"
[ -f "$IMAGE_TAR_PATH" ] || die "缺少镜像包：$IMAGE_TAR_PATH"

# ---- 前置检查 ----
command -v docker >/dev/null 2>&1 || die "没有找到 docker：本安装包需要先装好 Docker（飞牛 fnOS 自带 Docker 应用）"
docker info >/dev/null 2>&1 || die "当前用户无法访问 Docker：请用 sudo 执行，或把用户加入 docker 组后重新登录"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "没有找到 Docker Compose（v2 的 docker compose 或独立的 docker-compose 均可）"
fi

# ---- 读取旧配置（重复执行时保留上次的端口/目录）----
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
  PORT="${PORT:-${OLD_PORT:-}}"
  DATA_DIR="${DATA_DIR:-${OLD_DATA_DIR:-}}"
  CONTAINER_NAME="${CONTAINER_NAME:-${OLD_NAME:-}}"
fi

PUID_V=$(id -u)
PGID_V=$(id -g)
PORT="${PORT:-8906}"
DATA_DIR="${DATA_DIR:-$HERE/data}"
CONTAINER_NAME="${CONTAINER_NAME:-workordernote}"

case "$PORT" in
  ''|*[!0-9]*) die "端口必须是数字：$PORT" ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then die "端口超出范围：$PORT"; fi

# ---- 端口占用检查（本机已有别的服务占用时给出可操作的提示）----
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${PORT}\$"; then
  warn "提示：本机 ${PORT} 端口已被占用；若这个端口上跑的就是本应用（重复安装），可以忽略。"
fi

say "1/5 加载镜像 ${IMAGE} ..."
if [ "$FORCE_LOAD" = "1" ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker load -i "$IMAGE_TAR_PATH"
else
  echo "  本机已有 $IMAGE，跳过加载（要强制校验包内镜像请加 --force-load）"
fi
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "镜像加载后仍找不到 $IMAGE"
LOADED_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
if [ -n "${IMAGE_ID:-}" ] && [ "$LOADED_ID" != "$IMAGE_ID" ]; then
  warn "注意：本机 $IMAGE 的 ID（$LOADED_ID）与包内清单（$IMAGE_ID）不一致。"
  warn "      这说明本机原来就有同名镜像。要按包内镜像运行，请执行："
  warn "        docker rmi $IMAGE && bash install.sh --force-load"
fi
TITLE=$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.title"}}' 2>/dev/null || echo "")
echo "  镜像 ID: $LOADED_ID${TITLE:+（$TITLE）}"

say "2/5 准备数据目录 $DATA_DIR ..."
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R "$PUID_V:$PGID_V" "$DATA_DIR" 2>/dev/null || true
fi
touch "$DATA_DIR/.write-test" 2>/dev/null || die "数据目录不可写：$DATA_DIR（请换成有写权限的目录，或用 sudo 执行）"
rm -f "$DATA_DIR/.write-test"

say "3/5 写入配置 .env ..."
cat > .env <<ENVEOF
# 本文件由 install.sh 生成，重复安装时会被覆盖。
# 注意：第一次安装后若要改端口/目录，改这里再跑一次 install.sh 即可（数据不会丢）。
IMAGE=$IMAGE
CONTAINER_NAME=$CONTAINER_NAME
PORT=$PORT
DATA_DIR=$DATA_DIR
PUID=$PUID_V
PGID=$PGID_V
TZ=${TZ:-Asia/Shanghai}
ENVEOF
echo "  端口 $PORT → 容器 8906；数据目录 $DATA_DIR；容器名 $CONTAINER_NAME"

if [ "$NO_START" = "1" ]; then
  say "已完成（--no-start：未启动容器）"
  exit 0
fi

say "4/5 启动容器 ..."
$COMPOSE --env-file .env up -d

say "5/5 等待服务就绪 ..."
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$HOST_IP" ] || HOST_IP="<本机IP>"
READY=0
for _ in $(seq 1 60); do
  STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "healthy" ]; then READY=1; break; fi
  if [ "$STATUS" = "unhealthy" ]; then break; fi
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done

if [ "$READY" != "1" ]; then
  warn "服务在 120 秒内没有就绪（状态：${STATUS:-unknown}）。最近日志："
  $COMPOSE --env-file .env logs --tail 40 || true
  die "安装未完成：请把上面的日志发出来排查"
fi

VERSION_IN_APP=$(curl -fsS "http://127.0.0.1:${PORT}/api/version" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
cat <<DONE

────────────────────────────────────────
 工作序记（WorkOrderNote）已就绪
────────────────────────────────────────
 访问地址   http://${HOST_IP}:${PORT}/
 应用版本   ${VERSION_IN_APP:-$VERSION}
 数据目录   ${DATA_DIR}
 容器名     ${CONTAINER_NAME}
 查看日志   $COMPOSE --env-file .env logs -f
 停止服务   $COMPOSE --env-file .env down
 卸载       bash uninstall.sh            # 保留数据
            bash uninstall.sh --purge    # 连数据一起删

 首次使用：打开上面的地址，按提示创建管理员账号（用户名 + 密码）。

 两台飞牛互相同步：
   1) 两台都装好本包，且用同一个用户名创建账号；
   2) 各自打开「系统管理 → 系统配置 → 双机同步」；
   3) 在 A 上点「复制」拿令牌，粘到 B（两端令牌必须一致），填对方地址；
   4) 方向建议两端都选「双向同步」，先「测试连接」再「立即同步」。
────────────────────────────────────────
DONE
