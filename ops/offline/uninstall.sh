#!/usr/bin/env bash
# 工作序记（WorkOrderNote）卸载 / 停止
#
#   bash uninstall.sh            # 停止并移除容器（数据目录保留）
#   bash uninstall.sh --purge    # 连数据目录一起删除（会二次确认）
#
# 默认不会删数据：库里有账号、提醒与渠道凭据，误删无法恢复。
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"

PURGE=0
YES=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    --yes|-y) YES=1 ;;
    -h|--help) echo "用法: bash uninstall.sh [--purge] [--yes]"; exit 0 ;;
    *) echo "未知参数: $arg"; exit 2 ;;
  esac
done

[ -f .env ] || { echo "没有找到 .env：请在本安装包目录里执行（未安装过则无需卸载）"; exit 1; }
# shellcheck disable=SC1091
. ./.env

if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi

echo "停止并移除容器 ${CONTAINER_NAME:-workordernote} ..."
$COMPOSE --env-file .env down
echo "容器已移除；数据目录 ${DATA_DIR:-./data} 保持原样。"

if [ "$PURGE" = "1" ]; then
  TARGET="${DATA_DIR:-$HERE/data}"
  echo
  echo "警告：--purge 会永久删除数据目录：$TARGET"
  echo "      里面是数据库（账号、清单、提醒、记事、完成记录、渠道凭据）与日志，删了无法恢复。"
  if [ "$YES" != "1" ]; then
    printf '确认删除请输入 yes：'
    read -r answer
    [ "$answer" = "yes" ] || { echo "已取消，数据目录未删除。"; exit 0; }
  fi
  case "$TARGET" in
    ""|"/"|"/root"|"/vol1"|"/vol1/"|"$HERE") echo "拒绝删除危险路径：$TARGET"; exit 1 ;;
  esac
  rm -rf "$TARGET"
  echo "已删除 $TARGET"
fi
