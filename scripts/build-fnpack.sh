#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME=$(python3 -c "import json; print(json.load(open('app.json'))['appname'])")
APP_DISPLAY_NAME=$(python3 -c "import json; print(json.load(open('app.json'))['display_name'])")
FNOS_PKG_NAME=$(awk -F'=' '/^appname/ {gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' fnpack/manifest)
VERSION=$(cat VERSION | tr -d '\n')
BUILD_TIME=$(date +%Y-%m-%dT%H:%M:%S)
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LDFLAGS="-X smallgo/server/version.Version=${VERSION} -X smallgo/server/version.BuildTime=${BUILD_TIME} -X smallgo/server/version.GitCommit=${GIT_COMMIT} -X smallgo/server/version.AppName=${APP_DISPLAY_NAME}"

# 桌面可见入口必须和彩彩助手（lottery）一致，留在飞牛统一网关域：
# protocol="" + gatewayPrefix + gatewaySocket + url=/app/<包名>。这样应用页面
# 无论从桌面图标、飞牛手机 App 还是远程域名打开，都跑在网关域上，飞牛会话就在
# 本域，登录票据（POST api/auth/fnos/ticket）当场就能签发，不需要任何跳转。
# 反面教材是 v0.3.12 把主入口改成「应用自己的直连服务端口」+ v0.3.15/16 围绕它
# 加的一堆跳转补丁：直连端口签不到票，只能整页跳到网关域取票，而飞牛 App 的
# 内嵌网页视图会拦下这次跨端口导航——用户看到的就是「点了飞牛登录又回到登录页」。
# 网关域里的隐藏入口 FnOSLogin 仍然保留：直连端口（局域网直连、旧书签）上的
# 访问者靠它做登录跳板（见 AGENTS.md「fnOS authorization」）。
python3 - <<'PY'
import json

with open("fnpack/app/ui/config", encoding="utf-8") as source:
    config = json.load(source)
entries = config[".url"]
main = entries.get("workordernote.main")
login = entries.get("workordernote.FnOSLogin")
if not main or main.get("type") != "url":
    raise SystemExit("fnOS desktop entry must use type=url")
if main.get("protocol") != "" or main.get("gatewayPrefix") != "/app/workordernote" or main.get("gatewaySocket") != "app.sock":
    raise SystemExit("fnOS main entry must stay on the unified gateway (protocol=\"\" + gatewayPrefix + gatewaySocket)")
if main.get("url") != "/app/workordernote":
    raise SystemExit("fnOS main entry must open /app/workordernote")
if "port" in main:
    raise SystemExit("fnOS main entry must not point at the app's own TCP port (the fnOS App blocks that jump)")
if not login or login.get("gatewayPrefix") != "/app/workordernote" or login.get("gatewaySocket") != "app.sock":
    raise SystemExit("fnOS hidden entry must use the workordernote unified gateway")
if not login.get("noDisplay") or login.get("url") != "/app/workordernote/fnos-entry.html":
    raise SystemExit("fnOS hidden entry must point to the login trampoline and stay hidden")
PY

# Verify Docker is available (required for CGO cross-compilation)
if ! command -v docker &>/dev/null; then
  echo "Error: Docker is required for fnOS package builds (CGO cross-compilation)."
  echo "Install Docker Desktop and try again."
  exit 1
fi

echo "Building frontend..."
if [ ! -d web/node_modules ]; then
  VITE_FNOS_APP=true VITE_BASE_PATH="/app/${FNOS_PKG_NAME}/" npm --prefix web ci
fi
VITE_FNOS_APP=true VITE_BASE_PATH="/app/${FNOS_PKG_NAME}/" npm --prefix web run build

echo "Copying frontend..."
rm -rf server/static/dist
cp -r web/dist server/static/dist

BUILD_DIR="release/${VERSION}"
mkdir -p ${BUILD_DIR}

# Save original manifest
cp fnpack/manifest fnpack/manifest.bak

for ARCH in "amd64" "arm64"; do
  echo "Building fnOS package for ${ARCH}..."

  # arm64 要能在本机跑 linux/arm64 容器（binfmt 里的 qemu-aarch64）。没有就直接跳过，
  # 别拿一个必然失败（或卡在 apk 下载上）的架构拖住整轮发布。
  if [ "${ARCH}" = "arm64" ] && [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    echo "  跳过 arm64：本机没有 qemu-aarch64，Docker 跑不了 linux/arm64 容器"
    continue
  fi

  echo "  Compiling Go binary via Docker (CGO_ENABLED=1, linux/${ARCH})..."
  # apk 源换成国内镜像：dl-cdn.alpinelinux.org 在 NAS 上不可达，直接用官方源会挂在
  # 「Installing gcc」上不动（2026-10-16 实测 27 分钟零进度）。与 Dockerfile.custom 同一套源。
  docker run --rm \
    -v "${ROOT_DIR}/server:/src" \
    -v "go-build-cache:/root/.cache/go-build" \
    -v "go-mod-cache:/go/pkg/mod" \
    -w /src \
    --platform "linux/${ARCH}" \
    -e "LDFLAGS=${LDFLAGS}" \
    -e "ARCH=${ARCH}" \
    golang:1.26-alpine \
    sh -c 'sed -i "s|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g" /etc/apk/repositories; for i in 1 2 3; do apk add --no-cache gcc musl-dev && break; echo "apk retry $i"; sleep 5; done && CGO_ENABLED=1 go build -ldflags "$LDFLAGS -extldflags -static" -o "reminder-linux-${ARCH}" .'

  # Prepare build directory
  BUILD_PACK="${BUILD_DIR}/${APP_NAME}_${ARCH}"
  rm -rf "${BUILD_PACK}"
  mkdir -p "${BUILD_PACK}"

  # Copy fnpack template (only essential directories)
  cp -r fnpack/cmd "${BUILD_PACK}/"
  cp -r fnpack/config "${BUILD_PACK}/"
  cp -r fnpack/wizard "${BUILD_PACK}/"
  mkdir -p "${BUILD_PACK}/app"
  cp -r fnpack/app/ui "${BUILD_PACK}/app/"
  cp fnpack/ICON.PNG "${BUILD_PACK}/"
  cp fnpack/ICON_256.PNG "${BUILD_PACK}/"

  # Copy binary
  cp server/reminder-linux-${ARCH} "${BUILD_PACK}/app/reminder"
  chmod +x "${BUILD_PACK}/app/reminder"
  rm server/reminder-linux-${ARCH}

  # Copy frontend to app/ui
  cp -r server/static/dist/* "${BUILD_PACK}/app/ui/"

  # MIT 要求「著作权声明与许可声明随所有副本分发」：LICENSE 原文与衍生声明 NOTICE
  # 放进包内 app/ui（随静态资源一起安装，可在应用里访问到）。
  cp LICENSE NOTICE "${BUILD_PACK}/app/ui/"

  # Generate manifest with correct platform
  if [ "$ARCH" = "amd64" ]; then
    FNOS_PLATFORM="x86"
  else
    FNOS_PLATFORM="arm"
  fi
  sed "s/^platform.*/platform              = ${FNOS_PLATFORM}/" fnpack/manifest > "${BUILD_PACK}/manifest"

  # Update version in manifest
  sed -i '' "s/^version.*/version               = ${VERSION#v}/" "${BUILD_PACK}/manifest" 2>/dev/null || \
  sed -i "s/^version.*/version               = ${VERSION#v}/" "${BUILD_PACK}/manifest"

  # Strip macOS metadata so it never ships inside the package
  find "${BUILD_PACK}" -name '.DS_Store' -delete

  # Build with fnpack
  cd "${BUILD_PACK}"
  fnpack build
  cd "$ROOT_DIR"

  # Move the built fpk to release directory（文件名带版本号）
  if [ -f "${BUILD_PACK}/${FNOS_PKG_NAME}.fpk" ]; then
    mv "${BUILD_PACK}/${FNOS_PKG_NAME}.fpk" "${BUILD_DIR}/${FNOS_PKG_NAME}_${VERSION}_${ARCH}.fpk"
  elif [ -f "${BUILD_PACK}/../${FNOS_PKG_NAME}.fpk" ]; then
    mv "${BUILD_PACK}/../${FNOS_PKG_NAME}.fpk" "${BUILD_DIR}/${FNOS_PKG_NAME}_${VERSION}_${ARCH}.fpk"
  fi

  # Clean up
  rm -rf "${BUILD_PACK}"

  echo "Built ${FNOS_PKG_NAME}_${VERSION}_${ARCH}.fpk"
done

# Restore original manifest
mv fnpack/manifest.bak fnpack/manifest

# 截图、更新日志与部署 compose 随发行目录分发（与 build-all.sh 保持一致，
# 独立执行 fnpack 打包时也补齐发行目录必备文件，清单见 AGENTS.md「打包与发行」）
if [ -d images/screenshots ]; then
  mkdir -p "${BUILD_DIR}/screenshots"
  cp images/screenshots/* "${BUILD_DIR}/screenshots/"
  (cd "${BUILD_DIR}" && zip -qr "screenshots-${VERSION}.zip" screenshots)
fi
[ -f CHANGELOG.md ] && cp CHANGELOG.md "${BUILD_DIR}/CHANGELOG.md"
# 部署 compose 随发行目录分发。deploy/ 目录来自旧工作区，本仓库里并不存在——
# 当前发行物统一由 ops/build-offline-package.sh 生成（模板见 ops/offline/）。
if [ -f deploy/docker-compose.yml ]; then
  sed "s|workordernote:latest|workordernote:${VERSION}|" deploy/docker-compose.yml > "${BUILD_DIR}/docker-compose.yml"
  if [ -f deploy/docker-compose.latest.yml ]; then
    cp deploy/docker-compose.latest.yml "${BUILD_DIR}/docker-compose.latest.yml"
  fi
else
  echo "notice: deploy/docker-compose.yml 不存在，跳过发行目录的 compose 文件"
fi

# fnpack 构建用的是网关前缀版前端（VITE_BASE_PATH=/app/<包名>/），打完后恢复
# 标准构建，避免开发服务器（make dev 直连端口模式）的静态资源被替换成前缀版。
echo "Restoring standard frontend build..."
npm --prefix web run build
rm -rf server/static/dist
mkdir -p server/static/dist
cp -R web/dist/. server/static/dist/

echo "fnOS packages completed in ${BUILD_DIR}/"
