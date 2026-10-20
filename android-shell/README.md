# 工作序记 安卓客户端（WebView 壳子）

一个装在手机上的壳子：打开就是网页版（全屏 WebView），外加两件原生能力——**服务器地址设置**与
**文件选择**。不做第二套业务逻辑，网页怎么改，客户端就是什么。

版本：见 `VERSION`（当前 0.1.0）。

## 它做了什么

| 能力 | 说明 |
| --- | --- |
| 全屏 WebView | 打开就加载 `<服务器地址>/login`，登录态用网页自己的 Cookie/Token |
| 服务器地址设置 | **登录页上**就有一块「服务器地址」，点「修改」调起原生弹窗；首次安装（没存过地址）会自动弹一次，必须填了才能用。地址存在手机本地（SharedPreferences） |
| 离开壳子 | 指向其它站点（上游项目链接等）的链接交给系统浏览器；`.apk` 之类的下载也交给系统，方便装更新 |
| 返回键 | 先回退网页历史，已经在首页时连按两次退出 |
| 文件选择 | 网页里的上传按钮能选手机上的文件（`onShowFileChooser`） |
| 明文 HTTP | `usesCleartextTraffic="true"`：内网多半是 `http://192.168.x.x:8906`，不放开根本连不上 |

网页端通过 JS 桥识别「在壳子里」：`window.AndroidShell` 存在时，登录页才显示服务器地址那一块。

```
AndroidShell.getServerUrl()        // 当前服务器地址，登录页展示用
AndroidShell.openServerSettings()  // 调起原生的服务器地址弹窗
AndroidShell.getAppVersion()       // 客户端版本号
AndroidShell.reload()              // 重新加载当前页
```

## 怎么编译

**不需要 Android Studio、不需要 Gradle**。本机（飞牛 NAS）上装一套命令行工具链即可：

```bash
# 1) 一次性装工具链（JDK 17 + Android 命令行工具 + platform-34/build-tools 34）
bash ../android-build/setup-sdk.sh

# 2) 打 APK
cd android-shell && bash build-apk.sh
#   → build/WorkOrderNote-android-0.1.0.apk
```

为什么不用 Gradle：本机 Docker 镜像站拉不到任何 JDK 基础镜像（`eclipse-temurin` 等一律 401），
而飞牛本身是 Debian glibc，于是把 JDK 解在工作目录里直接用；只用框架 API 的纯 Java 工程不需要
依赖解析，`aapt2 + javac + d8 + zipalign + apksigner` 五步就够了，比装 Gradle 稳得多。

**两个已经踩过的坑**（脚本里都处理了）：

- **必须带 UTF-8 locale**（脚本里 `export LANG=C.UTF-8 LC_ALL=C.UTF-8`）。工作目录路径含中文，
  而本机默认 `LANG` 为空，这种组合下 Java 会报 `UnsatisfiedLinkError` / `ClassNotFoundException`。
- **`versionCode` 要自己写进清单**：`aapt2 link --version-code` 不会覆盖清单里已写死的值，
  而升级安装看的就是它（脚本用 `sed` 生成临时清单）。

## 签名与升级

签名密钥在 `keystore/workordernote.jks`（别名/口令都是 `workordernote`，有效期 30 年），
**必须保留**：换了密钥签出来的包无法覆盖安装，只能卸载重装。

版本号在 `VERSION`；`versionCode` 按 `主*10000 + 小*100 + 修正` 自动换算，保证递增。

## 发布给用户

APK 由应用自己托管，不需要另外的下载站：

1. 「系统配置 → 安卓客户端」里改**版本号**、**更新说明**、按需填**内网/外网下载地址**（内网留空即
   自动用当前访问地址）；
2. 同一页下面的「安卓客户端安装包」上传刚打出来的 APK（文件名按版本号自动生成，同版本重复上传即覆盖）；
3. 手机上打开「版本信息 → 安卓客户端」卡片就能看到下载按钮与二维码，扫一下即可安装。

二维码由服务端出图（`GET /api/reminder/android/qrcode?addr=lan|wan`），内网/外网两条地址在卡片上可切换。

## 已验证 / 未验证

- ✅ APK 能编出来并通过签名校验（`apksigner verify`），包名 `com.workordernote.shell`、minSdk 24、
  targetSdk 34、版本号正确；`aapt2 dump badging` 检查过权限、图标、启动 Activity。
- ✅ 网页侧全部功能有自检用例：`browser-harness/verify-095.js`（30 项）。
- ⚠️ **没有在真机/模拟器上跑过**（本机没有安卓设备也没有 emulator 镜像）：
  安装、WebView 实际加载、服务器地址弹窗、返回键、文件选择这些「跑起来才知道」的行为，
  首次装机时请留意一下。有问题按上面的坑排查（locale、明文 HTTP、地址是否可达）。
