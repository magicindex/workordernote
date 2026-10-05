#!/bin/bash
# 打「工作序记」安卓客户端的 APK。
#
# 不用 Gradle / AndroidX：本机 Docker 镜像站拉不到任何 JDK 基础镜像，而飞牛本身是
# Debian glibc，于是把 JDK 与 Android 命令行工具解在工作区（android-build/）里，
# 直接用 aapt2 + javac + d8 + zipalign + apksigner 编。只用框架 API 的纯 Java 工程
# （一个 WebView 壳子）不需要依赖解析，这条路比装 Gradle 稳得多。
#
# 用法：
#   bash build-apk.sh                 # 版本号取 ./VERSION
#   VERSION_CODE=200 bash build-apk.sh
#
# 前置：先跑过 ../android-build/setup-sdk.sh（装 JDK 17 与 platform-34/build-tools 34）
set -euo pipefail

# 本机默认 LANG/LC_ALL 为空（POSIX locale），而工作目录路径里有中文：
# 这种组合下 Java 会加载不了原生库与 classpath 里的类（javac 报 UnsatisfiedLinkError、
# java 报 ClassNotFoundException）。所有调用都必须带上 UTF-8 locale。
export LANG=C.UTF-8
export LC_ALL=C.UTF-8

HERE=$(cd "$(dirname "$0")" && pwd)
BUILD_ROOT=${ANDROID_BUILD_ROOT:-$(cd "$HERE/../.." && pwd)/android-build}
JDK="$BUILD_ROOT/jdk"
SDK="$BUILD_ROOT/sdk"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
# d8 / apksigner 这些包装脚本内部直接调 java，得把 JDK 放进 PATH
export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"

VERSION=${VERSION:-$(cat "$HERE/VERSION")}
# versionCode 用 主*10000 + 小*100 + 修正 换算，保证单调递增
VERSION_CODE=${VERSION_CODE:-$(echo "$VERSION" | awk -F. '{printf "%d", $1*10000 + $2*100 + $3}')}
PKG_NAME="WorkOrderNote-android-$VERSION"
OUT="$HERE/build"
KS="$HERE/keystore/workordernote.jks"
KS_PASS=workordernote
KS_ALIAS=workordernote

for f in "$JDK/bin/javac" "$BT/aapt2" "$BT/d8" "$BT/apksigner" "$BT/zipalign" "$PLATFORM"; do
  [ -e "$f" ] || { echo "缺少 $f —— 先跑 bash $BUILD_ROOT/setup-sdk.sh" >&2; exit 1; }
done

echo "== 工作序记安卓客户端 =="
echo "  版本    : $VERSION (versionCode=$VERSION_CODE)"
echo "  JDK     : $("$JDK/bin/java" -version 2>&1 | head -1)"
echo "  平台    : $PLATFORM"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "-- 1/7 编译资源（aapt2 compile）"
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip"

echo "-- 2/7 链接资源与清单（aapt2 link）"
# versionCode/versionName 直接写进临时清单：aapt2 link 的 --version-code 不会覆盖
# 清单里已经写死的值（编出来还是 1），而升级安装要看 versionCode 递增，必须自己替换。
sed -E "s/android:versionCode=\"[0-9]+\"/android:versionCode=\"$VERSION_CODE\"/; s/android:versionName=\"[^\"]*\"/android:versionName=\"$VERSION\"/" \
  "$HERE/AndroidManifest.xml" > "$OUT/AndroidManifest.xml"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM" \
  --manifest "$OUT/AndroidManifest.xml" \
  -R "$OUT/res.zip" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION" \
  --auto-add-overlay

echo "-- 3/7 编译 Java（javac）"
find "$HERE/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
"$JDK/bin/javac" -encoding UTF-8 --release 11 -classpath "$PLATFORM" -d "$OUT/classes" @"$OUT/sources.txt"

echo "-- 4/7 转 dex（d8）"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$BT/d8" --release --lib "$PLATFORM" --min-api 24 --output "$OUT/dex" @"$OUT/classes.txt"

echo "-- 5/7 打包 classes.dex"
cp "$OUT/base.apk" "$OUT/app-unsigned.apk"
( cd "$OUT/dex" && zip -q -X "$OUT/app-unsigned.apk" classes.dex )

echo "-- 6/7 对齐（zipalign）"
"$BT/zipalign" -f 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"

echo "-- 7/7 签名（apksigner）"
if [ ! -f "$KS" ]; then
  echo "   首次生成签名密钥：$KS（密码 $KS_PASS，别名 $KS_ALIAS）"
  echo "   注意：这个文件必须留下来——换密钥签的包无法覆盖安装，只能卸载重装。"
  "$JDK/bin/keytool" -genkeypair -keystore "$KS" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=WorkOrderNote, OU=SelfBuild, O=WorkOrderNote, C=CN"
fi
"$BT/apksigner" sign \
  --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$OUT/$PKG_NAME.apk" "$OUT/app-aligned.apk"

"$BT/apksigner" verify --print-certs "$OUT/$PKG_NAME.apk" | head -6
SIZE=$(stat -c%s "$OUT/$PKG_NAME.apk")
SHA=$(sha256sum "$OUT/$PKG_NAME.apk" | cut -d' ' -f1)
echo
echo "== 完成 =="
echo "  APK     : $OUT/$PKG_NAME.apk"
echo "  大小    : $((SIZE / 1024)) KB"
echo "  sha256  : $SHA"
echo "  版本    : $VERSION (versionCode=$VERSION_CODE)"
