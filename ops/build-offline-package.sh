#!/usr/bin/env bash
# 打「工作序记（WorkOrderNote）」Docker 离线一键安装包。
#
#   bash build-offline-package.sh              # 用仓库 VERSION 与 workordernote:<VERSION>
#   VERSION=0.3.0 OUT=/vol1/1000/Docker/reminders/images bash build-offline-package.sh
#
# 产物：
#   <OUT>/WorkOrderNote-<版本>-offline/            解压后的目录（可直接用）
#   <OUT>/WorkOrderNote-<版本>-offline-amd64.tar.gz 分发用的整包
#
# 只依赖本机已有的 docker 与 python3；不打网络请求。
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# 兼容两种存放方式：① 工作区里 reminders-deploy 与 reminders-upstream 并排；
# ② 本目录是仓库里的 ops/（源码在上一级，产物默认打到 <仓库>/pkg）。
if [ -d "$HERE/../reminders-upstream" ]; then
  REPO=${REPO:-$(cd "$HERE/../reminders-upstream" && pwd)}
else
  REPO=${REPO:-$(cd "$HERE/.." && pwd)}
fi
TPL="$HERE/offline"
if [ -d "$HERE/../reminders-deploy/pkg" ]; then
  OUT=${OUT:-$(cd "$HERE/../reminders-deploy" && pwd)/pkg}
else
  OUT=${OUT:-$REPO/pkg}
fi
VERSION=${VERSION:-$(cat "$REPO/VERSION" 2>/dev/null || echo "")}
ARCH=${ARCH:-amd64}
IMAGE=${IMAGE:-workordernote:$VERSION}

[ -n "$VERSION" ] || { echo "读不到版本号：请设置 VERSION=..." >&2; exit 1; }
[ -d "$TPL" ] || { echo "缺少打包模板目录：$TPL" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "本机没有镜像 $IMAGE：请先在 $REPO 里构建（docker build -f Dockerfile.custom -t $IMAGE .）" >&2; exit 1; }

IMAGE_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
IMAGE_CREATED=$(docker image inspect "$IMAGE" --format '{{.Created}}')
IMAGE_SIZE=$(docker image inspect "$IMAGE" --format '{{.Size}}')
GIT_COMMIT=$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || echo unknown)
BUILD_TIME=$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.created"}}' 2>/dev/null || echo unknown)
TITLE=$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.title"}}' 2>/dev/null || echo "")

PKG_NAME="WorkOrderNote-$VERSION-offline"
STAGE="$OUT/$PKG_NAME"
TARBALL="$OUT/$PKG_NAME-$ARCH.tar.gz"
IMAGE_TAR_REL="image/workordernote-$VERSION-$ARCH.tar.gz"

echo "== 打离线安装包 =="
echo "  镜像    : $IMAGE ($IMAGE_ID${TITLE:+ / $TITLE})"
echo "  版本    : $VERSION  架构: $ARCH  提交: $GIT_COMMIT"
echo "  输出目录: $OUT"

rm -rf "$STAGE"
mkdir -p "$STAGE/image"

echo "-- 1/5 导出镜像（docker save | gzip -9）..."
docker save "$IMAGE" | gzip -9 > "$STAGE/$IMAGE_TAR_REL"
IMAGE_TAR_SHA=$(sha256sum "$STAGE/$IMAGE_TAR_REL" | awk '{print $1}')
IMAGE_TAR_SIZE=$(stat -c%s "$STAGE/$IMAGE_TAR_REL")

echo "-- 2/5 放入安装脚本、说明与许可文件..."
cp "$TPL/install.sh" "$TPL/uninstall.sh" "$TPL/docker-compose.yml" "$TPL/README.md" "$TPL/.env.example" "$STAGE/"
# MIT 要求「著作权声明与许可声明随所有副本分发」：LICENSE 原文 + 衍生声明 NOTICE
# 随离线包分发（会被自动记入 manifest.json 的 files 与 SHA256SUMS）。
cp "$REPO/LICENSE" "$REPO/NOTICE" "$STAGE/"
chmod +x "$STAGE/install.sh" "$STAGE/uninstall.sh"

echo "-- 3/5 生成 package.env ..."
cat > "$STAGE/package.env" <<ENVEOF
# 由 build-offline-package.sh 生成，install.sh 读取。
IMAGE=$IMAGE
IMAGE_ID=$IMAGE_ID
VERSION=$VERSION
GIT_COMMIT=$GIT_COMMIT
BUILD_TIME=$BUILD_TIME
ARCH=$ARCH
IMAGE_TAR=$IMAGE_TAR_REL
ENVEOF

echo "-- 4/5 生成 manifest.json 与 SHA256SUMS ..."
PACKAGE_CREATED=$(date -Iseconds)
MANIFEST_FILES=$(cd "$STAGE" && find . -type f ! -name manifest.json ! -name SHA256SUMS | sed 's|^\./||' | sort)
FILE_ENTRIES="[]"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  sha=$(sha256sum "$STAGE/$f" | awk '{print $1}')
  size=$(stat -c%s "$STAGE/$f")
  FILE_ENTRIES=$(python3 -c "
import json,sys
arr=json.loads(sys.argv[1]); arr.append({'path':sys.argv[2],'sha256':sys.argv[3],'size':int(sys.argv[4])})
print(json.dumps(arr))" "$FILE_ENTRIES" "$f" "$sha" "$size")
done <<< "$MANIFEST_FILES"

python3 - "$STAGE" "$VERSION" "$GIT_COMMIT" "$BUILD_TIME" "$ARCH" "$IMAGE" "$IMAGE_ID" \
        "$IMAGE_TAR_REL" "$IMAGE_TAR_SHA" "$IMAGE_TAR_SIZE" "$PACKAGE_CREATED" "$FILE_ENTRIES" "$IMAGE_CREATED" <<'PY'
import json, sys
(stage, version, git_commit, build_time, arch, image, image_id, image_tar,
 image_tar_sha, image_tar_size, created, files_json, image_created) = sys.argv[1:14]
manifest = {
    "name": "WorkOrderNote-offline",
    "display_name": "工作序记（WorkOrderNote）",
    "version": version,
    "git_commit": git_commit,
    "build_time": build_time,
    "package_created": created,
    "arch": arch,
    "upstream": {
        "project": "TechFunWay/reminders",
        "url": "https://github.com/TechFunWay/reminders",
        "license": "MIT",
        "note": "本应用为该项目的衍生作品，遵循 MIT 许可，原项目著作权与出处均予保留。",
    },
    "image": {
        "tag": image,
        "id": image_id,
        "created": image_created,
        "title_label": "WorkOrderNote",
        "note": "Docker 仓库名只允许小写，显示名 WorkOrderNote 写在 OCI 标签里。",
        "tar": image_tar,
        "tar_sha256": image_tar_sha,
        "tar_size_bytes": int(image_tar_size),
    },
    "files": json.loads(files_json),
}
with open(f"{stage}/manifest.json", "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
print("  manifest.json: version=%s image=%s files=%d" % (version, image_id[:19], len(manifest["files"])))
PY

(cd "$STAGE" && sha256sum $(find . -type f ! -name SHA256SUMS | sed 's|^\./||' | sort) > SHA256SUMS)

echo "-- 5/5 打整包 tar.gz ..."
rm -f "$TARBALL"
tar -czf "$TARBALL" -C "$OUT" "$PKG_NAME"

echo
echo "== 完成 =="
printf '  目录包 : %s\n' "$STAGE"
printf '  分发包 : %s（%s）\n' "$TARBALL" "$(du -h "$TARBALL" | cut -f1)"
printf '  镜像 ID: %s\n' "$IMAGE_ID"
printf '  tar sha256: %s\n' "$(sha256sum "$TARBALL" | awk '{print $1}')"
printf '  校验   : cd %s && sha256sum -c SHA256SUMS\n' "$STAGE"
