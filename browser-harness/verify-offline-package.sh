#!/usr/bin/env bash
# 验证 Docker 离线一键安装包：解压 → 校验和 → 安装 → 建账号写数据 → 重复安装（升级）
# → 数据仍在 → 卸载（留数据）→ 卸载（--purge 删数据）。
#
# 用法：
#   bash verify-offline-package.sh [包路径]
# 默认包路径：<工作区>/reminders-deploy/pkg/WorkOrderNote-0.3.0-offline-amd64.tar.gz
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# 兼容两种存放方式：① 工作区里 browser-harness 与 reminders-upstream 并排；
# ② 本目录就是仓库里的 browser-harness/（源码在上一级、离线包在 <仓库>/pkg）。
if [ -f "$HERE/../reminders-upstream/VERSION" ]; then
  REPO=$(cd "$HERE/../reminders-upstream" && pwd)
else
  REPO=$(cd "$HERE/.." && pwd)
fi
if [ -d "$HERE/../reminders-deploy/pkg" ]; then
  PKG_DIR=$(cd "$HERE/../reminders-deploy/pkg" && pwd)
else
  PKG_DIR="$REPO/pkg"
fi
# 默认版本从仓库 VERSION 读，别再写死：写死时「刚打完 0.4.0 的包、脚本却去验 0.3.0」
# 这种事只会在发布当天骗过自己（本轮真踩过一次）。
VERSION=${VERSION:-$(cat "$REPO/VERSION" 2>/dev/null || echo 0.3.0)}
TARBALL=${1:-$PKG_DIR/WorkOrderNote-$VERSION-offline-amd64.tar.gz}
PORT=${PORT:-8919}
WORK="$REPO/tmp/pkg-test"
DATA_DIR="$WORK/data"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
check_eq() { if [ "$1" = "$2" ]; then ok "$3（$1）"; else bad "$3：期望 $2，实际 $1"; fi; }
json() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print($2)" "$1" 2>/dev/null || echo "__PARSE_ERROR__"; }

cleanup() {
  local dir=$1
  docker rm -f workordernote-pkgtest >/dev/null 2>&1 || true
  ( cd "$dir" 2>/dev/null && bash uninstall.sh >/dev/null 2>&1 ) || true
}

step "0. 准备：解压安装包到 $WORK"
[ -f "$TARBALL" ] || { bad "找不到安装包：$TARBALL"; exit 1; }
docker rm -f workordernote-pkgtest >/dev/null 2>&1 || true
rm -rf "$WORK"
mkdir -p "$WORK"
tar -xzf "$TARBALL" -C "$WORK"
PKG="$WORK/WorkOrderNote-$VERSION-offline"
[ -d "$PKG" ] && ok "解压出 $PKG" || { bad "解压目录不存在"; exit 1; }
ls "$PKG/image/"*.tar.gz >/dev/null 2>&1 && ok "镜像包在内（$(du -h "$PKG"/image/*.tar.gz | cut -f1)）" || bad "缺少镜像包"

step "1. 校验和与清单"
if ( cd "$PKG" && sha256sum -c SHA256SUMS >/dev/null 2>&1 ); then ok "SHA256SUMS 全部校验通过"; else bad "校验和不匹配"; fi
MANIFEST=$(cat "$PKG/manifest.json")
check_eq "$(json "$MANIFEST" "d['version']")" "$VERSION" "manifest 版本号"
check_eq "$(json "$MANIFEST" "d['image']['title_label']")" "WorkOrderNote" "manifest 显示名（镜像仓库名只能小写）"
TAR_SHA_IN_MANIFEST=$(json "$MANIFEST" "d['image']['tar_sha256']")
TAR_SHA_REAL=$(sha256sum "$PKG"/image/*.tar.gz | awk '{print $1}')
check_eq "$TAR_SHA_REAL" "$TAR_SHA_IN_MANIFEST" "包内镜像 tar 的 SHA256 与清单一致"

step "2. 一键安装（--port $PORT，数据放 $DATA_DIR，--force-load 走一遍镜像加载）"
cd "$PKG"
OUTPUT=$(timeout 600 bash install.sh --port "$PORT" --data-dir "$DATA_DIR" --name workordernote-pkgtest --force-load 2>&1)
if printf '%s' "$OUTPUT" | grep -q "已就绪"; then ok "install.sh 报「已就绪」"; else bad "install.sh 未报就绪"; printf '%s\n' "$OUTPUT" | tail -20; fi
if printf '%s' "$OUTPUT" | grep -qE "Loaded image|Loading layer"; then
  ok "走了 docker load（加载包内镜像：$(printf '%s' "$OUTPUT" | grep -m1 -E "Loaded image" | sed 's/^ *//')）"
else
  bad "没有看到 docker load 的输出"
fi
printf '%s' "$OUTPUT" | grep -q "双机同步" && ok "安装完成提示里包含双机同步步骤" || bad "缺少双机同步提示"
[ -f "$PKG/.env" ] && ok "生成了 .env" || bad "没有生成 .env"
check_eq "$(grep -c "^PORT=$PORT$" "$PKG/.env")" "1" ".env 里的端口"
check_eq "$(grep -c "^DATA_DIR=$DATA_DIR$" "$PKG/.env")" "1" ".env 里的数据目录"

step "3. 服务可用性与镜像内容"
HEALTH=$(curl -sS "http://127.0.0.1:$PORT/api/health")
check_eq "$(json "$HEALTH" "d['data']['status']")" "ok" "健康检查"
VERSION_API=$(curl -sS "http://127.0.0.1:$PORT/api/version")
check_eq "$(json "$VERSION_API" "d['data']['version']")" "$VERSION" "应用版本"
check_eq "$(json "$VERSION_API" "d['data']['appName']")" "工作序记" "应用名"
LABEL_TITLE=$(docker image inspect "workordernote:$VERSION" --format '{{index .Config.Labels "org.opencontainers.image.title"}}')
check_eq "$LABEL_TITLE" "WorkOrderNote" "镜像 OCI 显示名标签"
CONTAINER_USER=$(docker inspect workordernote-pkgtest --format '{{.Config.User}}')
check_eq "$CONTAINER_USER" "$(id -u):$(id -g)" "容器以当前用户身份运行（能写数据目录）"
WATCHTOWER=$(docker inspect workordernote-pkgtest --format '{{index .Config.Labels "com.centurylinklabs.watchtower.enable"}}')
check_eq "$WATCHTOWER" "false" "watchtower 屏蔽标签"
LOGGING=$(docker inspect workordernote-pkgtest --format '{{index .HostConfig.LogConfig.Config "max-size"}}')
check_eq "$LOGGING" "10m" "日志大小上限"
check_eq "$(json "$(curl -sS "http://127.0.0.1:$PORT/api/reminder/admin/sync")" "d['code']")" "401" "同步管理接口存在且需鉴权"
FRONT=$(curl -sS "http://127.0.0.1:$PORT/" | grep -c "工作序记")
[ "$FRONT" -ge 1 ] && ok "首页返回应用外壳（含站点名）" || bad "首页内容不对"

step "4. 建账号并写数据（模拟真实使用）"
TOKEN=$(json "$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"username":"包测试账号","password":"Pkg!Test1234"}' "http://127.0.0.1:$PORT/api/auth/register")" "d['data']['token']")
[ "${TOKEN:0:2}" = "ey" ] && ok "创建管理员并登录成功" || bad "注册失败：$TOKEN"
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"升级后应当还在的提醒","due_at":"2026-12-31T09:00:00+08:00","repeat_rule":"none","channels":["inapp"]}' \
  "http://127.0.0.1:$PORT/api/reminder/items" >/dev/null
COUNT_BEFORE=$(json "$(curl -sS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/reminder/items?view=all")" "len(d['data'])")
check_eq "$COUNT_BEFORE" "1" "安装后可正常写入数据"

step "5. 重复安装（等价升级）：沿用上次端口/目录，数据不丢"
OUTPUT2=$(timeout 600 bash install.sh 2>&1)
if printf '%s' "$OUTPUT2" | grep -q "已就绪"; then ok "重新安装后仍报「已就绪」"; else bad "重复安装失败"; printf '%s\n' "$OUTPUT2" | tail -15; fi
printf '%s' "$OUTPUT2" | grep -q "本机已有" && ok "已存在的镜像跳过加载（未强制时不会重复 load）" || bad "重复安装时镜像处理不符合预期"
TOKEN2=$(json "$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"username":"包测试账号","password":"Pkg!Test1234"}' "http://127.0.0.1:$PORT/api/auth/login")" "d['data']['token']")
COUNT_AFTER=$(json "$(curl -sS -H "Authorization: Bearer $TOKEN2" "http://127.0.0.1:$PORT/api/reminder/items?view=all")" "len(d['data'])")
check_eq "$COUNT_AFTER" "1" "升级/重装后数据仍在"
check_eq "$(grep -c "^DATA_DIR=$DATA_DIR$" "$PKG/.env")" "1" "重装后配置未被重置"

step "6. 卸载（先留数据，再 --purge 删除）"
bash uninstall.sh >/dev/null 2>&1
if docker inspect workordernote-pkgtest >/dev/null 2>&1; then bad "容器没有被移除"; else ok "uninstall.sh 移除了容器"; fi
[ -f "$DATA_DIR/db/workordernote.db" ] && ok "默认卸载保留数据目录（数据库仍在）" || bad "默认卸载把数据也删了"
bash uninstall.sh --purge --yes >/dev/null 2>&1
if [ -e "$DATA_DIR" ]; then bad "--purge 没有删除数据目录"; else ok "--purge 删除了数据目录"; fi
rm -rf "$PKG/.env"

printf '\n\033[1m结果：%d 项通过，%d 项失败\033[0m\n' "$PASS" "$FAIL"
printf '包：%s\n' "$TARBALL"
[ "$FAIL" -eq 0 ]
