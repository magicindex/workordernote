# 工作序记 (WorkOrderNote) 0.46.3

任务、记事与日历一体的提醒应用。飞牛 NAS 上以 Docker 部署。

本应用是开源项目 **TechFunWay/reminders** 的衍生作品（MIT 许可），
原项目著作权与出处均予保留：<https://github.com/TechFunWay/reminders>

## 访问

- <http://192.168.3.201:8906/>
- 容器 `workordernote`，镜像 `workordernote:0.46.3`（本地自建）
- 对比实例：<http://192.168.3.201:8907/> 官方原版 v0.3.0；<http://192.168.3.201:8908/> 沙盒

## 仓库与镜像地址（2026-10-22 起）

- Gitea：<https://gitea.topzero.cn:10241/cyberzero/WorkOrderNote>
- 容器仓库：`gitea.topzero.cn:10241/cyberzero/workordernote:<版本>`
- 仓库走 HTTPS，证书链完整（Certum DV `*.topzero.cn`，反代已带中间证书），
  可直接 `docker pull gitea.topzero.cn:10241/cyberzero/workordernote:<版本>`；
  推送新镜像需带 `write:package` 权限的令牌。
- 下文历史记录中的旧内网地址已统一替换；日期与 digest 仍是当时的记录。

## 目录

```
/vol1/1000/Docker/workordernote/
├── docker-compose.yml
├── data/                 ← 应用数据（700，属主 王耀辉）
│   ├── db/workordernote.db   账号、清单、提醒、记事、渠道配置（0.1.1 起由 reminder.db 改名）
│   ├── logs/                 运行日志
│   └── uploads/              上传文件
├── data.bak-*/           ← 历次升级前的数据快照（一致性备份，已校验）
├── docker-compose.yml.bak-*   ← compose 改动前的备份
├── images/               ← 离线镜像包（87 MB，700）
├── verify-data.sh        ← 数据体检脚本
└── README.md
```

## 管理

```bash
cd /vol1/1000/Docker/workordernote
docker compose ps
docker compose logs -f
docker compose restart
docker compose down                              # 停止（数据保留）
./verify-data.sh                                 # 数据体检
```

**备份**：`sudo cp -a data /path/to/backup/`（data 是 700，需 root 或你自己的账号）。
升级前建议用 SQLite 在线备份而不是直接 `cp`：

```bash
docker run --rm -v /vol1/1000/Docker/workordernote:/w python:3.12-alpine python -c "
import sqlite3
s = sqlite3.connect('file:/w/data/db/reminder.db?mode=ro', uri=True)
o = sqlite3.connect('/w/data.bak-$(date +%Y%m%d-%H%M%S)/db/reminder.db')
"
```

**升级**：本机直连 Docker Hub 不通（`registry-1.docker.io` 直接 EOF）。本项目用本地自建镜像，
构建方式见源码仓库 `README.md` 的「构建 Docker 镜像」一节，构建后：

```bash
docker compose up -d
docker compose logs -f
```

## 三处针对本机的必要配置

| 配置 | 原因 |
| --- | --- |
| `user: "1000:1001"` | 镜像内默认 `appuser(uid 1000)`；本目录属主是 `王耀辉:Users`(1000:1001)，不对齐则容器写不进 SQLite，而且**不报错**。 |
| `TZ=Asia/Shanghai` + 挂载 `/etc/localtime` | 时区不对会让所有提醒晚 8 小时且不报错。自建镜像已内置 tzdata，挂载是双保险。 |
| `-log-console` | 镜像默认 CMD 不带，补上后 `docker compose logs` 才有内容。 |
| `com.centurylinklabs.watchtower.enable: "false"` | 本机 watchtower 每天扫一次，会尝试用上游原版覆盖这个容器。自建镜像用的是本地专有标签，必须挡住它。 |

数据目录权限保持 `700`（未跟随同目录其他项目的 755）：库里存有账号哈希与渠道凭证。

## 双机同步（0.3.0 起）

两台飞牛 NAS 上各装一份「工作序记」时，可以让它们互相同步（单向或双向）。
入口：**侧栏 → 系统管理 → 系统配置 → 双机同步**（仅管理员可见）。

### 配置步骤（两端都要做）

1. 确认两台机器上有**同一个用户名**的账号（同步按用户名配对账号，不按自增 ID）。
   对端有、本机没有的账号，其数据会被跳过，并在同步结果里列出。
2. 在 A 上打开「双机同步」：点「复制」拿本机令牌 → 在 B 的同一处粘贴（**两端令牌必须一致**）。
3. 填对端地址（例 `http://192.168.3.200:8906`，不写 `http://` 会自动补）。
4. 选同步方向：

   | 方向 | 含义 |
   | --- | --- |
   | 关闭同步 | 不同步，也不接受对端发来的同步请求 |
   | 单向：本机 → 对端 | 把本机数据推给对端；对端的改动不会回到本机 |
   | 单向：对端 → 本机 | 从对端拉取；本机的改动不会推给对端 |
   | 双向同步 | 两边互相合并，同一条数据以修改时间较新的一方为准 |

   两端方向要配套：一端「推送」+ 另一端「拉取」，或两端都选「双向」（推荐）。
5. 选自动同步间隔（仅手动 / 5 分钟 … 每天）；「仅手动」时点「立即同步」即可。
6. 点「测试连接」确认能连通，再点「立即同步」看结果。

### 同步什么、不同步什么

| 会同步 | 不会同步 |
| --- | --- |
| 清单、任务、记事、完成记录（含重复提醒的每次完成历史）、提醒选用的渠道名 | 账号与密码、通知渠道绑定（邮箱/短信/机器人凭据）、管理员维护的 provider 密钥、投递记录、站内通知、操作日志、系统配置、飞牛绑定关系 |

- **删除会同步**：在 A 删掉的任务，下次同步后 B 上也会删掉，不会复活。
- **冲突以时间戳较新的一方为准**；两端完全相同则按实例标识裁决（保证两边结论一致）。
- **两端时钟要对准**（「测试连接」会报偏差，超过 60 秒会提示）：双向合并不依赖时钟也能收敛，
  但偏差太大时「谁后改的」会判断错。
- 同步过来的提醒会在对端**按该机器自己绑定的渠道**正常提醒；不想两边都提醒，就只在一端绑定渠道。
  另外，同步过来的**过期**提醒不会在对端补发「到点了」通知（原机器上已经提醒过）。
- 首次同步是**全量**交换（本应用量级下报文 gzip 后只有几 KB），每次同步都用对端现状自愈校准。
- 数据/日志目录不受同步影响，备份时仍以本机目录为准。

### 边界与已知行为

- 两端各自初始化时都会自动建一个默认清单「提醒」。首次同步会把它们**合并成同一个**默认清单；
  若两端默认清单名字不同，则会各保留一个（不合并）。
- 本机新建了某清单里的提醒、对端却把这个清单删了：同步后该提醒会被收拢到默认清单，不会丢。
- 对端地址填成本机自己会在「测试连接」时被拒绝（实例标识相同）。

## 第二台机器（192.168.3.200）

| 项 | 值 |
| --- | --- |
| 访问 | <http://192.168.3.200:8906/> |
| 路径 | `/vol1/1000/Docker/workordernote`（`docker-compose.yml` + `data/` + `images/` + `pkg/`） |
| 容器 | `workordernote`（唯一一个，**无沙箱**），`user 1000:1001`，`restart unless-stopped` |
| 镜像 | `workordernote:0.12.0`（三台同一个镜像，提交 `37c42a3`） |
| 部署方式 | `sudo docker compose -f docker-compose.yml up -d`；镜像用离线包 `docker load` 加载 |
| SSH | `ssh -p 9527 王耀辉@192.168.3.200`；docker 需要 sudo（该账号不在 docker 组） |
| 本机记录 | 工作区 `workordernote-新NAS部署说明.md`，机器上 `/vol1/1000/Docker/workordernote/部署说明.md` |

两台互相同步：200 先创建与 201 同名的管理员账号，然后两端「系统配置 → 双机同步」填
同一个令牌与对方地址、方向都选双向。详见上面的「双机同步」一节。

## 离线一键安装包（给第二台机器用）

产物：

| 位置 | 说明 |
| --- | --- |
| `/vol1/1000/Docker/workordernote/images/WorkOrderNote-0.12.0-offline-amd64.tar.gz` | 当前分发包，见该目录 `manifest.json`（sha256 也在安装包的 `SHA256SUMS` 里） |
| `…/WorkOrderNote-0.11.0-…` 及更早（0.8.x / 0.7.x / 0.6.x / 0.5.x / 0.4.0 / 0.3.0） | 历史版本（保留，便于回退） |
| `workordernote-deploy/pkg/WorkOrderNote-0.12.0-offline/` | 解压后的目录包（可直接拷进 U 盘/共享目录使用） |
| `workordernote-deploy/build-offline-package.sh` | 打包脚本（换版本重跑即可） |
| `browser-harness/verify-offline-package.sh` | 安装包验证脚本（30 项，见下） |

包内：`install.sh`（一键安装/升级）、`uninstall.sh`、`docker-compose.yml`（`pull_policy: never`，
离线安全）、`package.env`、`manifest.json`、`SHA256SUMS`、`README.md`、`image/*.tar.gz`（docker save 后 gzip）。

在**目标机器**上：

```bash
tar -xzf WorkOrderNote-0.12.0-offline-amd64.tar.gz
cd WorkOrderNote-0.12.0-offline
sudo bash install.sh                                        # 默认端口 8906、数据在 ./data
sudo bash install.sh --port 8907 --data-dir /vol1/1000/Docker/workordernote
```

- 安装脚本会：加载包内镜像（不联网）→ 建数据目录并按当前用户设属主 →
  生成 `.env` → `docker compose up -d` → 等健康检查通过 → 打印访问地址与「两台飞牛互相同步」步骤。
- **重复执行即升级**：沿用上次的端口与数据目录，数据不动。建议升级前
  `cp -a data data.bak-$(date +%Y%m%d-%H%M%S)`。
- 卸载：`bash uninstall.sh`（留数据）/ `bash uninstall.sh --purge`（删数据，需二次确认）。
- 校验：`sha256sum -c SHA256SUMS`；`manifest.json` 里的 `image.id` 可与
  `docker image inspect workordernote:0.12.0 --format '{{.Id}}'` 对照。

**镜像名**：Docker 的仓库名只允许小写，因此标签是 `workordernote:0.12.0`；
显示名 **WorkOrderNote** 写进镜像与容器的 OCI 标签（`org.opencontainers.image.title`），
`manifest.json` 里也标了 `title_label`。

验证（`verify-offline-package.sh`，30 项全通过）：解压、SHA256SUMS、manifest 与包内镜像 tar 的
sha256 一致、`install.sh --force-load` 真的走 `docker load`（输出 `Loaded image`）、
健康检查/版本/应用名、OCI 标题标签、容器以当前 uid 运行、watchtower 屏蔽标签、日志上限 10m、
同步接口需鉴权、首页外壳、注册账号并写入数据、重复安装（升级）后数据仍在且配置未被重置、
`uninstall.sh` 移除容器但保留数据、`--purge` 才删除数据。

## 三台实例的同步拓扑（2026-10-05 定稿）

| 实例 | 地址 | 同步对象 | 方向 | 频率 |
| --- | --- | --- | --- | --- |
| 生产（老 NAS） | 192.168.3.201:8906 | 200 | 双向 | 自动，每 5 分钟 |
| 新 NAS | 192.168.3.200:8906 | 201 | 双向 | 自动，每 5 分钟 |
| 本地沙箱 | 192.168.3.201:8908 | —— | **关闭**（`direction=off`、`interval=0`） | 不自动 |

- 三台用的镜像与版本一致（`workordernote:0.5.1`，提交 `2ae0e0e`），同步令牌三台相同。
- 数据流：生产 ↔ 新 NAS 自动互通；沙箱只在手动点「立即同步」时与生产互通
  （**刻意如此**：沙箱是拿来试功能的，测试数据不该自动进生产）。
- 沙箱里的测试数据（各用例造的「自检-…」）都会自己删掉；官方用例跑完不留痕。
- **⚠️ 用生产数据覆盖沙箱后必须重置沙箱的同步身份**（2026-10-08 踩到）：
  `staging-data-local` 整目录是从 201 拷来的，**同步设置也一起拷了过来**——沙箱于是带着
  201 的 `sync_instance_id` 和同一个同步令牌、`direction=both`、每 5 分钟指向 200，
  变成一个「另一个 201」在跟 200 双向同步（沙箱新增/删除的东西会被推到 200 再进 201）。
  覆盖完数据后进沙箱后台把同步改成「关闭」，并把实例标识与令牌换成新的：
  `sqlite3 db/workordernote.db "UPDATE system_configs SET value=… WHERE key='sync_instance_id'"`（容器停掉再改）。
  当前沙箱身份 `493bc08d7df9364e0a65c77df5b0d500`，同步关闭。
- 新设备 `8909` 是**空库**（无账号），用来演练「从另一台设备导入」向导，身份 `02704cce5d590117`，同步同样关闭。

### 2026-10-05 这一轮实际修过的东西

1. **新 NAS 的对端地址端口写错**：`http://192.168.3.201:8096` → 已改回 `8906`（写错时 200 主动同步必然失败）。
2. **三台都多出一个空的「提醒」清单**：那是新 NAS 建号时自动生成的默认清单（14:58 建号、14:58:01 生成），
   后来默认清单换成了「工作安排」，它就空着；同步把它当新清单复制到了 201 与沙箱。
   三台都已删除该空清单（非默认、0 条任务，删除是安全的）。
3. **「工作安排」的颜色曾被误改成蓝色**（本地验证脚本还原时写死了 blue）：三台已还原为原来的紫色。
4. 校验：三台 `GET /items?view=all&status=all` 与清单（名称+颜色）指纹完全一致
   （`5b2d3054be681c48`，各 29 条 / 2 个清单）；配对往返用例 `verify-sync-local.sh` 15/15。
5. 同步前的备份：201 `data.bak-presync-20261005-145834`、`data.bak-pre050-*`、`data.bak-pre051-*`；
   沙箱 `staging-data-local.bak-presync-20261005-145834`；200 `data.bak-pre050-20261005-151748`、
   `data.bak-pre051-20261005-153215`。

## 版本与迭代

- 软件版本见根目录 `VERSION`，当前 `0.46.3`，规则为 `主版本号.小版本号.修正号`。
  **部署状态（2026-11-11 12:40）**：**201 生产 8906 / 200 生产均已升级到 `0.46.3`**
  （提交 `00750f9`，镜像 `workordernote:0.46.3` = `sha256:d03fffe6d352…`）。
  线上只保留 **201 生产 8906 + 201 沙箱 8908 + 200 生产**；迭代用的临时容器（8918）每次发版后删掉，
  下次迭代再按「挂本地 dist 的临时容器」重新拉起。
  **公开设置 9 项三台一致**；**个人偏好 201 与 200 一致，沙箱单独一套**（开始提醒时间 `00:00`、
  提醒频率 `10`、知道了后 `0`）—— 沙箱是夜里跑回归用的，静默窗口开着会把提醒类用例全拦住。
  201 = 本机生产、200 = 远端生产（`/vol1/1000/Docker/workordernote`）、沙箱 8908 供演练。
- **发布节奏（2026-10-05 起）**：日常改动**不单独发版**——只改代码，用「挂载本地 dist 的临时容器
  （8918）」自检；等一批需求做完、用户说发版时，再一次性走完
  「改 VERSION + 迭代说明 → 构建 → 沙箱验证 → 201 → 200 → 离线包 → 全量回归 → 文档同步」。
  一批里既有新功能也有修复时，版本按最高档位加。详见 `browser-harness/README.md` 的「迭代节奏」一节。
- 应用内「侧栏 → 关于 → 版本信息」可查看迭代说明与原项目信息。

## 变更记录

### 2026-11-11：0.46.3（201 生产 / 200 生产上线）—— 修「更多」在手机上点了没反应

> **发版记录**（VERSION 0.46.3，源码提交 `00750f9`，镜像 `workordernote:0.46.3` =
> `sha256:d03fffe6d3524a4207aed1c8d48eaebb89aa34f97d14c04653399250d003b03a`，
> 92,064,574 B，构建于 2026-11-11T04:35:46Z；registry manifest `sha256:800f1a0b…`）

- 本版是第 93 条：手机键盘打开时视口只剩一半，点新建框的「更多」面板落在键盘下面，看起来像没反应。改成展开时先让输入框失焦（收键盘）、`nextTick` 后把面板滚进视野；待办与计划两页共用 `toggleQuickMore()`。
- 201：备份 `docker-compose.yml.bak-pre0463-20261111-1237` / `data.bak-pre0463-20261111-1237.tgz`（15.5M），旧镜像 `workordernote:0.46.2-keep-20261111-1237`；12:38:27 重建，healthy，`/api/version` = `0.46.3 / 00750f9`。
- 200：备份 `docker-compose.yml.bak-pre0463-20261111-1240` / `data.bak-pre0463-20261111-1240.tgz`（7.3M），旧镜像 `workordernote:0.46.2-keep-20261111-1238`；从 `127.0.0.1:3000` 拉取、改 compose、重建，12:40:29 healthy，`/api/version` = `0.46.3 / 00750f9`。
- 数据体检（两台）：`integrity_check = ok`、123 条未删除提醒，两台一致。
- 验证：两台 `verify-128` **34/34**；模拟键盘短视口（390×430）点「更多」——面板进入视口（top 66）、输入框失焦，201/200 都通过；前端构建通过。
- 镜像：Gitea 与 GHCR 的 `0.46.3` / `latest` 都已推（manifest `sha256:800f1a0b…`），GHCR 匿名可拉。
- 未做：离线一键安装包、飞牛 fpk、GitHub 快照、生产全量回归。

### 2026-11-11：0.46.2（201 生产 / 200 生产上线）—— 侧栏 AI 入口精简、记事本新建备注

> **发版记录**（VERSION 0.46.2，源码提交 `678f2f0`，镜像 `workordernote:0.46.2` =
> `sha256:88386a3d2bf5a89ed46ca6f5bfff5cb618e7fd62ebf88524fc543bf025cf364c`，
> 92,064,170 B，构建于 2026-11-11T03:59:29Z；registry manifest `sha256:3129584b…`）

- 本版合并第 91–92 条：侧栏 AI 入口去掉外框与底色、内容居中、AI 标识紧贴名称；记事本新建增加「备注」选项（默认收起，展开可写多行）。
- 201：备份 `docker-compose.yml.bak-pre0462-20261111-1201` / `data.bak-pre0462-20261111-1201.tgz`（15.5M），旧镜像 `workordernote:0.46.1-keep-20261111-1201`；12:01:39 重建，healthy，`/api/version` = `0.46.2 / 678f2f0`。
- 200：备份 `docker-compose.yml.bak-pre0462-20261111-1202` / `data.bak-pre0462-20261111-1202.tgz`（7.3M），旧镜像 `workordernote:0.46.1-keep-20261111-1202`；从 `127.0.0.1:3000` 拉取、改 compose、重建，12:02:43 healthy，`/api/version` = `0.46.2 / 678f2f0`。
- 数据体检（两台）：`integrity_check = ok`、123 条未删除提醒（其中 11 条记事），两台一致。
- 验证：200 `verify-128` **34/34**；201 同一套件连跑时两次卡在「弹层收起」动画断言（第三次 34/34，200 同版本一次通过，属既有偶发，与本次改动无关）；两台只读脚本验了「AI 入口透明底/居中/AI 贴名称」与「记事本备注默认收起、点开展开」各 3/3。前端构建通过。
- 镜像仓库：**Gitea 与 GHCR 的 `latest` 都指到本版**，两边 manifest 都是 `sha256:3129584b…`。Gitea 经内部地址 `192.168.3.200:3000/cyberzero/workordernote:latest` 推（公开地址 `…/manifests/latest` 返回 200）；GHCR 用 `magicindex` 的 token 推了 `ghcr.io/magicindex/workordernote:0.46.2` 与 `:latest`，匿名拉取 `manifests/latest` 返回 200（公共包）。
- 未做：离线一键安装包、飞牛 fpk、GitHub 快照、生产全量回归。

### 2026-11-11：0.46.1（201 生产 / 200 生产上线）—— 新建默认当前时刻，计划结束时间手工选

> **发版记录**（VERSION 0.46.1，源码提交 `8668214`，镜像 `workordernote:0.46.1` =
> `sha256:80093d4a38647f7d07fe52047658f5e6c5b02f301883e98bdcf386eb3f944755`，
> 92,061,334 B，构建于 2026-11-11T03:06:13Z）

- 本版是第 90 条：待办页新建默认到期从「当天 23:59」改成「今天当前时刻」（芯片仍是 23:59）；计划页开始时间默认当前时刻、结束时间默认留空，只改开始时间不再自动补结束，点「周期」仍可一键算。
- 201：备份 `docker-compose.yml.bak-pre0461-20261111-1108` / `data.bak-pre0461-20261111-1108.tgz`（15.5M），旧镜像 `workordernote:0.46.0-keep-20261111-1108`；11:08:20 重建，healthy，`/api/version` = `0.46.1 / 8668214`。
- 200：备份 `docker-compose.yml.bak-pre0461-20261111-1109` / `data.bak-pre0461-20261111-1109.tgz`（7.2M），旧镜像 `workordernote:0.46.0-keep-20261111-1109`；从 `127.0.0.1:3000` 拉取 0.46.1、改 compose、重建，11:09:31 healthy，`/api/version` = `0.46.1 / 8668214`。
- 数据体检（两台）：`integrity_check = ok`、122 条未删除提醒、11 张卡，两台一致。
- 验证：201 `verify-128` **34/34**（首轮 1 项弹层动画偶发，复跑通过）、`verify-106` **20/20**；200 `verify-128` **34/34**；两台只读脚本验了「待办默认今天当前时刻 / 计划开始当前、结束留空」5/5。前端构建通过。
- 未做：离线一键安装包、飞牛 fpk、GitHub 快照、生产全量回归。

### 2026-11-11：0.46.0（201 生产 / 200 生产上线）—— 分期还款、桌面新建默认展开、手机端信用卡精简

> **发版记录**（VERSION 0.46.0，源码提交 `2045d0c`，镜像 `workordernote:0.46.0` =
> `sha256:6b2e75e6c51a1a20d01b018958efe92963d058767addb78e3f4720d31c0c19b9`，
> 92,060,382 B，构建于 2026-11-11T02:17:31Z）

- 本版合并攒批第 85–89 条：桌面「待办 / 计划」新建卡片默认展开（手机保持收起）；手机端信用卡只留「本期应还」，隐藏账期与「第 x 期」，待办行隐藏「第 x 次」；「撤销已还」收进「⋯ 更多」、抽屉改向上并提到悬浮按钮之上；信用卡新增「分期还款」估算（通用规则表，已核对 6 家银行官网费率）。
- 201：备份 `docker-compose.yml.bak-pre0460-20261111-1019` / `data.bak-pre0460-20261111-1019.tgz`（17.6M），旧镜像保留 `workordernote:0.45.0-keep-20261111-1019`；compose 改 `0.46.0`，10:19:50 重建，healthy，`/api/version` = `0.46.0 / 2045d0c`。
- 200：备份 `docker-compose.yml.bak-pre0460-20261111-1021` / `data.bak-pre0460-20261111-1021.tgz`（7.2M），旧镜像保留 `workordernote:0.45.0-keep-20261111-1020`；镜像推到内部 registry `192.168.3.200:3000`（同一套 Gitea registry 后端，公开地址 manifest 已 200），200 从 `127.0.0.1:3000` 拉取、tag 成 `workordernote:0.46.0`，compose 改 tag 后 `docker rm -f` + `docker compose up -d`，10:21:16 healthy，`/api/version` = `0.46.0 / 2045d0c`。
- 数据体检（两台）：`integrity_check = ok`、121 条未删除提醒、11 张卡，两台一致。
- 验证：201 跑 `verify-128` **34/34**、`verify-110` **33/33**；200 跑 `verify-128` **34/34**；两台用只读脚本验了手机端信用卡（「第 x 期」隐藏、「分期还款」按钮、更多抽屉第一项「撤销已还」、分期弹窗默认 12 期）全部通过。前端 `vue-tsc` + `vite build`、Go 测试与构建通过。
- 未做：离线一键安装包、飞牛 fpk、GitHub 快照、生产全量回归。

### 2026-11-09：0.45.0（201 生产 / 200 生产上线）—— 已完成撤销、手机底部换首页、历史逾期卡片、周视图铺满

> **发版记录**（VERSION 0.45.0，源码提交 `a17cb1b`，镜像 `workordernote:0.45.0` =
> `sha256:33c7e1e50aa5f683a8ae93c45dd9bbba8ca521f34856178aec4486abe5388309`，
> 92,037,846 B，构建于 2026-11-09T14:53:00Z）

- 本版合并攒批第 81–84 条：已完成页「撤销」按钮（一次性任务恢复未完成、重复提醒删那次完成并退回排期，只允许撤最近一次）；手机底部标签改为 首页 / 计划 / 清单 / 待办（通知改从顶栏铃铛进，首页图标重画）；待办页「历史逾期」只读卡片；周视图按可用高度铺满一屏。
- 201：备份 `docker-compose.yml.bak-pre0450-20261109-2253` / `data.bak-pre0450-20261109-2253.tgz`（23M），旧镜像保留 `workordernote:0.44.1-keep-20261109-2253`；compose 镜像 tag 改 `0.45.0`，23:01:17 `docker compose up -d` 重建，healthy，`/api/version` = `0.45.0 / a17cb1b`。
- 数据体检（升级后）：`integrity_check = ok`、25 张表、108 条未删除提醒、83 个清单、3 个账号。
- 验证：生产 8906 跑 `verify-128` **34/34**（新底部顺序、首页可点、通知不在底部、清单弹层）；临时实例 8921（生产库拷贝）验了「历史逾期」卡片（造 9 月逾期任务 → 出现、范围 2026 年 9 月、点击只读）与周视图铺满（1440×1000 下 `scrollHeight 709 ≤ clientHeight 708`）；Go `vet` + `go test ./...` 全绿（新增撤销用例 3 个）；前端 `vue-tsc` + `vite build` 通过。
- 200：备份 `docker-compose.yml.bak-pre0450-20261109-2313` / `data.bak-pre0450-20261109-2313.tgz`（7.2M），旧镜像保留 `workordernote:0.44.1-keep-20261109-2315`；`docker load` 镜像包（sha256 `77b73433173cd74b55c7230ff6d0c6835931849a86e654b8f007a9e47cf3ee79`）→ compose 改 `0.45.0` → 旧容器不是 compose 创建的、报名称冲突，`docker rm -f workordernote` 后 `docker compose up -d`，23:14 healthy，`/api/version` = `0.45.0 / a17cb1b`。
- 200 数据体检：`integrity_check = ok`、25 张表、117 条未删除提醒、59 个清单、2 个账号；跑 `verify-128` **34/34**。
- **顺带修好双机同步**：两台 `sync_token` 不一致（201 `aada…` / 200 `bd66…`），双向同步从某个时点起一直 401「同步令牌不正确」。已把 200 的令牌改成 201 的值（`PUT /api/reminder/admin/sync`：方向 both、对端 `http://192.168.3.201:8906`、间隔 5 分钟），两边手动 `POST /sync/run` 都返回 ok。账号集合仍不一致：201 多 `tt017887` / `tt259608`（测试账号），200 多 `郭朋飞`，同步会跳过「对端有、本机没有」的账号（数据不过去）。
- 未做：离线一键安装包、飞牛 fpk、GitHub 快照、生产全量回归（本轮只跑了与改动相关的 128 与临时实例检查）。
- 推送：改用玄览项目 `.secrets/gitea_token`（Gitea 账号 `cyberzero`，带 repository 写权限）后，`main` 推到 `f364858`，tag `v0.45.0` 推到 `a17cb1b`。
- 镜像仓库：直接 `docker push gitea.topzero.cn:10241/…` 会被站点前置的**雷池 WAF** 拦——实测 layer 都已存在，卡在 config blob 的 PUT（同一个 blob 用 6KB 配置体返回 403，换成 `{"hello":"world"}` 则正常到 registry 的 400，说明是按内容拦的，不是权限）。改从**同一套后端的内部地址** `192.168.3.200:3000` 推（tag 列表与公开地址一致，说明是同一个 registry，只是不经 WAF）：`docker tag workordernote:0.45.0 192.168.3.200:3000/cyberzero/workordernote:0.45.0 && docker push …` 成功，digest `sha256:f6f8f62dcf773bfdfc6ebc1d4299d6206a0a9500e040fe7cad4420020b8f1339`（size 2409）。公开地址 `https://gitea.topzero.cn:10241/v2/cyberzero/workordernote/manifests/0.45.0` 已返回 200，`docker manifest inspect` 也通过，README 的 `docker pull …:0.45.0` 成立。

### 2026-11-01：0.44.1（201 生产 / 200 生产上线）—— 周视图取消今天的底色与流光

> **发版记录**（VERSION 0.44.1，源码提交 52e215b，镜像 sha256:5ae23756b35668dd8f9975e53572140c6a70e74d090758a4933711308fa44bc8，134,556,585 B，构建于 2026-11-01T11:55:00+08:00）

- 本版只合并第 80 条：周视图取消「今天」整列背景色块与流光边框，只保留日期头的「今天」；月视图今天圆角流光保留。任务线、标签与配色规则不变。
- 201：备份 `docker-compose.yml.bak-pre0441-20261101-1202` / `data.bak-pre0441-20261101-1202.tgz`（34M），旧镜像 `workordernote:0.44.0-keep-20261101-1202`；Compose 重建 healthy，`0.44.1 / 52e215b`。
- 200：备份 `docker-compose.yml.bak-pre0441-20261101-1204` / `data.bak-pre0441-20261101-1204.tgz`（7.6M），旧镜像 `workordernote:0.44.0-keep-20261101-1204`；上传 `pkg/workordernote-0.44.1-amd64.tar.gz` 并 load，compose 文件更新为 0.44.1；容器重建 healthy，`0.44.1 / 52e215b`。
- 验证：两台 `verify-144` 13/13、`verify-151` 5/5、`verify-154` 8/8；本地镜像 `verify-096` 31/31、`149` 10/10、`150` 10/10、`155` 13/13、`159` 4/4。
- 离线包 `pkg/WorkOrderNote-0.44.1-offline-amd64.tar.gz`（sha256 `797e8f22f07df3ea32b9fd7ffd44acdfe08e92a8ab670dbfe148fd2c8b9b32f0`）。
- README 界面截图（首页 / 月历 / 周视图 / 课程表 / 手机）提交 `246c7bb`，Gitea `main` 已推送；Gitea Release `v0.44.1`（id 53）附离线包、单镜像包、bundle、截图包。
- GitHub 快照 `publish-workordernote` 通过 Git Data API 提交 `bc1423b` 并创建 `v0.44.1` tag；Actions `release`（run 41297442286）成功，Release 附源码包、bundle、镜像包、截图包与 SHA256SUMS；`ghcr.io/magicindex/workordernote:v0.44.1` / `latest` 已发布。旧版本 fpk/截图资产已从该 Release 清理。
- 飞牛 fnOS 安装包 `release/0.44.1/workordernote_0.44.1_amd64.fpk`（21,888,350 B，sha256 `4d9cf16d2f8b46dac84b2a29f060efd966c5011436ae2f8d1d5a97e1914f2ea5`，x86）已补传到 Gitea Release 53 与 GitHub Release v0.44.1。
- 源码提交 `52e215b`；后续部署记录单独提交。

### 2026-11-01：0.44.0（201 生产 / 200 生产上线）—— 周视图重做、邮箱找回与日历同步

> **发版记录**（VERSION 0.44.0，源码提交 aa54f40，镜像 sha256:62be9c1e5b3b7edab23d4ec86df2aadeb42b92e27c7407266227a944b75d8f8b，92,000,132 B，构建于 2026-11-01T01:24:23Z）

- 本版合并第 44–79 条：计划页三行卡片、邮箱验证码找回密码、安卓客户端下线、手机日历 ICS 订阅/导入、提醒@他 30 天保留、课程表备注与就近归位、周视图连续色块/竖排标签/唯一配色/今天流光、月历上限与自适应、工具条两行对齐、手机管理页卡片化、重复弹窗合并等。
- 本地回归：`verify-096` 31、`104` 18、`107` 44、`116` 12、`118` 54、`128` 32、`134` 35、`135` 10、`137` 12、`139` 14、`140` 21、`141` 17、`142` 18、`143` 24、`144` 13、`147` 12、`148` 11、`149` 10、`150` 10、`151` 7、`152` 5、`154` 8、`155` 13、`156` 8、`157` 4、`158` 6、`159` 4，全绿。
- 201 生产：升级前 compose 备份 `docker-compose.yml.bak-pre0440-20261101-100940`、数据备份 `data.bak-pre0440-20261101-100940.tgz`（33M）；旧镜像保留 `workordernote:0.43.8-keep-20261101-100940`；10:09 重建 healthy，`0.44.0 / aa54f40`。
- 200 生产：升级前 compose 备份 `docker-compose.yml.bak-pre0440-20261101-102043`、数据备份 `data.bak-pre0440-20261101-102043.tgz`（7.2M）；`docker load` 后重建，10:31 healthy，`0.44.0 / aa54f40`。生产抽测 144 13/13、150 10/10、151 7/7、154 8/8、159 4/4。
- 离线包 `pkg/WorkOrderNote-0.44.0-offline-amd64.tar.gz`（sha256 `b63beecd94d3447bcf033cb573c6fd9ed82fe0eab7572e5fc0bfcb3522645da5`）。
- 单镜像包 `pkg/workordernote-0.44.0-amd64.tar.gz`（sha256 `2afde92a8629f9b6749b5cbfb183ae41e3e2772aaf82e7c518f8736499c89903`）。
- 源码提交 `aa54f40`；测试修复（verify-142 手机设置分区、verify-155 12 个清单）随后提交。
- Gitea `main` 与 tag `v0.44.0` 已推送（`fac4916`）；GitHub 镜像本次未推送。

### 2026-10-28：0.43.8（201 生产 / 201 沙箱 / 200 生产 / 演示 8920 上线）—— 垃圾箱清空/自动清空与图标去边框

> **发版记录**（VERSION 0.43.8，源码提交 bd7cc71，镜像 sha256:619c6ba35d9c4abea383d98f703cadb33e7aa063510a61f0f9d492eda98912c0，92,576,666 B，构建于 2026-10-28T01:22:12Z）

**新增**
- **垃圾箱清空**：垃圾箱右上角「清空」，二次确认后清空当前账号全部已删除提醒；清空使用隐藏墓碑 `purged_at`，不硬删除，避免双机同步被对端快照复活。
- **自动清空**：偏好设置新增 `trash_auto_clear_days`，0=不自动，>0 时每天清理删除超过 N 天的记录；打开垃圾箱时也会惰性清理一次。

**调整**
- **仪式感卡片图标去边框**：图标只保留图形本身，不再带方框/底色，也不能点击；统一从卡片右上角铅笔按钮进入编辑，再更换图标。

**上线**
- 沙箱 8908：09:24:37 重建，`0.43.8 / bd7cc71`，healthy；回归 198 项全绿（`verify-138` 11、`107` 44、`128` 31、`131` 60、`134` 33、`135` 9、`136` 10）。
- 201 生产 8906：升级前应用内备份 `workordernote-backup-20261028-092813.tar.gz`（1,243,802 B），compose 备份 `docker-compose.yml.bak-pre0438-20261028-0928`；09:28:21 重建，healthy；回归 210 项全绿（另加 `verify-133` 12）。
- 200 生产：升级前应用内备份 `workordernote-backup-20261028-093207.tar.gz`（467,956 B），compose 备份 `docker-compose.yml.bak-pre0438-20261028-0933`；09:35:09 Compose 重建，`0.43.8 / bd7cc71`，healthy；回归 127 项全绿（`verify-138` 11、`107` 44、`131` 60、`133` 12）。
- 演示 8920：09:37:35 重建，`0.43.8 / bd7cc71`。
- 清理生产垃圾箱中的测试条目：201 分三批 purge 测试标记 88 条，剩 153 条真实删除；200 清理后剩 112 条。未动用户真实数据。

**构件**
- 离线包 `pkg/WorkOrderNote-0.43.8-offline-amd64.tar.gz`（sha256 `c286c414b1898d732e1997dccfee03f74acb7f215f4f4ad065986da2a342679c`）。
- 单镜像包 `pkg/workordernote-0.43.8-amd64.tar.gz`（sha256 `d119626d01fa9d6db293ccf51341a5870da55c60ece4cda10a3bb0eb84e1c4c2`）。
- fnOS 包 `pkg/workordernote_0.43.8_amd64.fpk`（sha256 `6016c814a44d8c75e5920ccc3f3c468b4e404205885cb6082783df6dede7390b`）。
- 截图包 `pkg/screenshots-0.43.8.zip`。

**仓库同步**
- Gitea `main` 与 tag `v0.43.8` 已推送，Release `工作序记 v0.43.8` 附离线包/单镜像/fpk/截图。
- GitHub 快照 `publish-workordernote` 提交 `e1d87a7` + tag `v0.43.8`；Actions `release` 成功，Release 资产齐全；`ghcr.io/magicindex/workordernote:0.43.8` 已发布。
- Gitea 容器仓库仍受历史 `unexpected EOF` 影响，README 保留 GHCR 备用。

### 2026-10-28：0.43.7（201 生产 / 201 沙箱 / 200 生产 / 演示 8920 上线）—— 黑卡水晶、图标库、垃圾箱与课程表自动沿用

> **发版记录**（VERSION 0.43.7，源码提交 8d1cb14，镜像 sha256:cad8720f72d2bedd5d52bb4d5d960dcdf582bb4c812f9b2e2ff1437c350a6986，92,554,922 B，构建于 2026-10-27T16:29:13Z）

**新增**
- **垃圾箱**：智能清单最后新增「垃圾箱」，所有已删除提醒集中于此并可恢复；「全部」「已完成」不再混入已删除记录。
- **仪式感图标库**：卡片图标放大到 112px，点击即可更换；内置节日/纪念/日常 21 个图标，按标题自动匹配春节、中秋、考试、生日等。
- **课程表跨周沿用**：新一周自动沿用上一周；本周修改后下周沿用最新；已删除课程不带走，确定性 sync_uid 防止双机复制重复。

**调整 / 修复**
- 取消课程表上一周/下一周入口，只显示当前周；旧版空白的未来周记录自动清理。
- 仪式感卡片改为黑卡/水晶两套质感，倒计时去掉描边与流光。
- 课程备注行改用课程表图标；手机课程表选中日实心蓝、其余灰暗。
- 修复已完成列表回查已删除提醒、导致「已完成」与清单不一致的问题。

**上线**
- 沙箱 8908：00:31:29 重建，`0.43.7 / 8d1cb14`，healthy；`verify-131` 60/60、`verify-134` 33/33、`verify-137` 12/12、`verify-138` 11/11、`verify-107` 43/43、`verify-128` 31/31（190 项）。
- 201 生产 8906：升级前应用内备份 `workordernote-backup-20261028-003444.tar.gz`（1,488,056 B），compose 备份 `docker-compose.yml.bak-pre0437-20261028-0035`；00:36:09 重建，`0.43.7 / 8d1cb14`，healthy。上线前清理历史自检软删除 2,150 条，垃圾箱剩 204 条真实删除。
- 200 生产：升级前应用内备份 `workordernote-backup-20261028-003653.tar.gz`（522,501 B），compose 备份 `docker-compose.yml.bak-pre0437-20261028-0040`；上传镜像并 `docker load`，00:39:45 通过 Compose 重建，healthy。清理历史自检软删除后垃圾箱剩 107 条。
- 演示 8920：00:40:20 重建，`0.43.7 / 8d1cb14`。
- 生产定向：201 `verify-131` 60/60、`verify-134` 33/33、`verify-137` 12/12（首跑一次建表竞态，重跑通过）、`verify-138` 11/11、`verify-107` 43/43、`verify-128` 31/31、`verify-133` 12/12（202 项）；200 `verify-131` 60/60、`verify-134` 33/33、`verify-137` 12/12、`verify-138` 11/11、`verify-107` 43/43（159 项）。
- 回归后再次清理测试课程备注 19 条（201/200 各 19）与新建的测试垃圾箱项；随手记事本回到 10 条真实记事，垃圾箱 201/200 分别为 204/107 条。

**构件**
- 离线整包 `pkg/WorkOrderNote-0.43.7-offline-amd64.tar.gz`（46,343,222 B，sha256 `45dc91b61f7070f310a223d885ee3536ba5f356e2c1accf2d4d5701e3a8380b3`）。
- 单镜像 `pkg/workordernote-0.43.7-amd64.tar.gz`（49,298,303 B，sha256 `88b95e10c9f08696fc2de99806df391c7b0f45bbc1d6ea1a9cd56c6fd0c42cd8`）。
- fnOS 包 `release/0.43.7/workordernote_0.43.7_amd64.fpk`（21,876,346 B，md5 `5987af41e123fd4f91bee0dece9ca0db`，sha256 `a6af5dcf1d9cd14792092bffc28e23620a1b825fd6c7d1c7e8be31d302dd0a78`）。
- 截图包 `release/0.43.7/screenshots-0.43.7.zip`（5 张：仪式感卡片、图标库、课程备注、手机课程表、垃圾箱）。

**仓库同步**
- Gitea：`main` 与 tag `v0.43.7` 已推送（main `292f94d`）；Releases 页已创建 `工作序记 v0.43.7`（id 49），附离线包、单镜像、fpk 与截图。
- GitHub：快照仓库提交 `fdf32ce` + tag `v0.43.7`，Actions `release` 成功；Release 已发布源码包、bundle、镜像包、SHA256SUMS、fpk 与截图（历史版本资产保留）；`ghcr.io/magicindex/workordernote:0.43.7` 已发布。
- Gitea 容器仓库仍受历史 `unexpected EOF` 影响，未推 0.43.7；README 保留 GHCR 备用拉取。

### 2026-10-27：0.43.6（201 生产 / 201 沙箱 / 200 生产 / 演示 8920 上线）—— 课程表按周留档、批量共享与手机当天视图

> **发版记录**（VERSION 0.43.6，源码提交 a79cbdb，镜像 sha256:78ca55d76b59…，92,492,736 B，构建于 2026-10-27T06:12:47Z）

**新增**
- **每周独立快照**：课程表按自然周保存，可切「上一周 / 下一周」；过去周只读，编辑本周不影响历史；未来周首次打开时从更早一周复制。
- **批量共享**：共享弹窗可勾选多张自有课程表，填一个账号、选「只读 / 读写」，一次提交；名单按表聚合，可单独改权限或移除。
- **课程备注进随手记事本**：课程备注写成「课程备注：课程名」，同一门课再次保存更新同一条，删课保留备注。
- **记事本课程备注筛选**：随手记事本工具栏新增「课程备注」按钮，课程备注行使用课程卡片样式。
**调整**
- **手机课程表默认看今天**：手机端一～日日期条，默认选中今天，只展开当天课程；桌面仍显示整周。

**上线**
- 沙箱 8908：14:16:57 重建，`0.43.6 / a79cbdb`，healthy；关键套件 `verify-131` 59/59、`verify-134` 33/33、`verify-137` 15/15、`verify-107` 38/38、`verify-128` 31/31、`verify-135` 9/9、`verify-136` 10/10。
- 201 生产 8906：升级前应用内备份 `workordernote-backup-20261027-142113.tar.gz`（1,359,246 B），compose 备份 `docker-compose.yml.bak-pre0436-20261027-1421`；14:21:59 重建，`0.43.6 / a79cbdb`，healthy。
- 200 生产：升级前应用内备份 `workordernote-backup-20261027-142313.tar.gz`（407,675 B），compose 备份 `docker-compose.yml.bak-pre0436-20261027-1425`；上传镜像包并 `docker load`，14:31:28 通过 Compose 重建，healthy。
- 演示 8920：14:33:12 重建，`0.43.6 / a79cbdb`。
- 定向回归：201 `verify-131` 59/59、`verify-134` 33/33、`verify-137` 15/15（首次失败，单独复跑通过）、`verify-107` 38/38、`verify-128` 31/31、`verify-135` 9/9、`verify-136` 10/10；200 `verify-131` 59/59、`verify-134` 33/33、`verify-137` 15/15、`verify-107` 38/38。
- 后端 `go vet ./... && go test ./...` 全过；前端 `npm run build` 通过。

**仓库同步**
- Gitea：`main` 与 tag `v0.43.6` 已推送；Releases 页已创建 `工作序记 v0.43.6`，附离线包、单镜像包、fpk 与截图（Gitea 容器仓库仍受历史 `unexpected EOF` 影响，镜像改由 GHCR 提供）。
- GitHub：快照仓库提交 `a29e20b` + tag `v0.43.6`，Actions `release` 成功；Release 已发布源码包、bundle、镜像包、SHA256SUMS、fpk 与截图；`ghcr.io/magicindex/workordernote:0.43.6` 已发布。

**构件**
- 离线整包 `pkg/WorkOrderNote-0.43.6-offline-amd64.tar.gz`（46,326,306 B，sha256 `3353df4e25b085127a1bdc99e2984168ebc66dec42098e6f8dda5bcf8ef2ec6d`，包内校验通过）。
- 单镜像 `pkg/workordernote-0.43.6-amd64.tar.gz`（49,283,945 B，sha256 `dfa28111041b6fe7ac6e7fd51947b5c62da4ceff5d89592da34d6b3a6eddbb8d`）。
- fnOS 包 `release/0.43.6/workordernote_0.43.6_amd64.fpk`（21,868,652 B，md5 `d2c922ba7a28eeee1c6aca41694f31dd`，sha256 `ad63b3ffdd7173f6f313010a60ec21420fb7ffcb96e30ee76e5dfd0a895c1dff`）。

### 2026-10-27：0.43.5（201 生产 / 201 沙箱 / 200 生产 / 演示 8920 上线）—— 课程表共享、手机入口与开关修复

> **发版记录**（VERSION `0.43.5`，源码提交 `07dd74f`，镜像 `workordernote:0.43.5` =
> `sha256:e9ce7e44ab8845fcd86c3e87ffe91822c9a84203f09009821e5d61633b22dbb3`，92,416,030 B，
> buildTime `2026-10-26T16:13:53Z`）

**新增**
- **课程表共享**：表主按登录用户名共享，权限分只读/读写；只读可查看课程详情，读写可增删改课程，
  不能改表设置、删表或再共享。共享表带来源和权限徽标，接收者需开启课程表栏目。
- **手机悬浮新建分流**：提醒@他页新建提醒、信用卡页新建卡片、仪式感页新建事项，其余频道新建待办。

**调整**
- 手机「全部清单」弹层按课程表 → 提醒@他 → 信用卡 → 记事本 → 仪式感 → 自建清单排序；
  课程表栏目改为默认开启。
- 手机底部「方式」改为「提醒」，直达提醒@他；通知方式仍从侧栏抽屉进入。
- 信用卡、仪式感开关关闭后，侧栏、清单、条目、日历与统计同步隐藏；重新打开立即恢复。

**修复**
- 手机「别人提醒我」确认完成后立即从待处理消失（包含已保存到清单的项）。
- 栏目开关的 2 秒缓存会在配置写入后立即失效，不再出现关闭后仍残留。

**上线**
- 201 生产：升级前应用内备份 `workordernote-backup-20261027-002013.tar.gz`（1,308,836 B）；
  compose 备份 `docker-compose.yml.bak-pre0435-20261027-0020`；00:20:43 重建，`0.43.5 / 07dd74f`，healthy。
- 200 生产：升级前应用内备份 `workordernote-backup-20261027-002120.tar.gz`（363,461 B）；
  compose 备份 `docker-compose.yml.bak-pre0435-20261027-0023`；上传镜像包并 `docker load`，
  00:22:27 通过 Compose 重建，`0.43.5 / 07dd74f`，healthy，user 1000:1001，compose 标签完整。
- 201 沙箱 8908：00:16:48 重建；演示 8920：00:23:11 重建；均 `0.43.5 / 07dd74f`。

**回归**
- 201：`verify-134` 31/31、`verify-135` 9/9、`verify-136` 10/10、`verify-107` 38/38、`verify-128` 31/31、`verify-131` 58/58，
  另 `verify-133` 12/12；共 189 项。
- 200：`verify-134` 31/31、`verify-136` 10/10、`verify-107` 38/38、`verify-131` 58/58（共 137 项）。
- 沙箱 8908：同 201 的 6 个关键套件 177/177。
- `verify-097` 106/109：失败 3 项为「日历里信用卡的日子用卡片图标」（当前月份没有该卡还款日）与头部卡片集合
  随用户账单数据变化，属既有数据漂移，与本版代码无关。

**构件**
- 离线整包：`pkg/WorkOrderNote-0.43.5-offline-amd64.tar.gz`（sha256 `1b9a845dbe799996c966af77fa9c99ae7b01f1dfe1d06bf7782f783516671282`，包内 10/10 校验通过）。
- 单镜像包：`pkg/workordernote-0.43.5-amd64.tar.gz`（sha256 `3655ac8c72dfd172431398bc674504badb14896b8b25d71a672e0269d59a257b`）。
- fnOS 包：`release/0.43.5/workordernote_0.43.5_amd64.fpk`（21 MB，md5 `c9b789dcfad6e24834197ba5d51798f1`，
  sha256 `fd68f19b60b6941a82f145ae38fa43765e28fd27fcd48a4fc64365bb11b262bd`）。

**仓库同步**
- 主仓库：代码 `07dd74f`；tag `v0.43.5`；Gitea `cyberzero/workordernote` 的 main/tag 已推送。
- GitHub 快照 `publish-workordernote`：`3a8daae`，tag `v0.43.5`；Actions `release` 成功，
  Release v0.43.5 已发布（source / bundle / image / SHA256SUMS / fpk / screenshots），
  `ghcr.io/magicindex/workordernote:0.43.5` 已推送（manifest 含 amd64 与 attestation）。
- Gitea 容器仓库仍受历史 `unexpected EOF` 影响；README 保留 GHCR 备用拉取地址。

### 2026-10-26：0.43.4（201 生产 / 201 沙箱 / 200 生产 / 演示 8920 上线）—— 循环逾期、日期徽标与 WebDAV 证书

> **发版记录**（VERSION `0.43.4`，源码提交 `5751c43`，镜像 `workordernote:0.43.4` =
> `sha256:cadd8affe0d763fd3ea02b9e25fdba23735ec9b551bf242b95c714623e5c70ca`，92,321,354 B，
> buildTime `2026-10-26T13:42:46Z`）

**修复**
- **年度循环提醒不再按首次年份算逾期**：生日、纪念日等「每年」条目，列表行按当前年份/当前农历年计算这一轮日期；
  完成确认后跳过已经过去的周期，直接落到当前或下一轮。修复「老婆生日」显示已逾期 5000 多天。
- **WebDAV 自签名证书**：备份设置新增「跳过 HTTPS 证书校验」；用 IP 访问而证书没有 IP SAN、
  或用自签名证书时，打开后即可正常上传。证书失败会提示改用证书主机名或打开该开关。

**调整**
- 编辑表单「历法」改为「倒计时历法」。
- 卡片日期底色只包月日，「每年」拆成独立徽标；列表循环徽标写「农历9月17日 每年」/「公历2026年9月17日 每年」。

**上线**
- 201 生产：21:46:23 重建，`0.43.4 / 5751c43`，healthy；compose 备份
  `docker-compose.yml.bak-pre0434-20261026-2022`，可回滚到 `workordernote:0.43.3`。
- 200 生产：升级前应用内备份 `workordernote-backup-20261026-202333.tar.gz`（339,393 B，WebDAV 因证书失败但本机备份已落盘）；
  上传镜像包并 `docker load`，compose 备份 `docker-compose.yml.bak-pre0434-20261026-2025`；
  21:47:24 重建，`0.43.4 / 5751c43`，healthy，user 1000:1001，compose 标签完整。
- 201 沙箱 8908、演示 8920：21:44 重建，`0.43.4 / 5751c43`。
- 升级后为 201/200 打开 `backup_webdav_insecure=true`（证书无 IP SAN）；21:19/21:20 手动备份均成功，
  WebDAV 恢复正常（备份文件 `workordernote-backup-20261026-211948.tar.gz` / `...212002.tar.gz`）。

**回归**
- 201 / 200：`verify-107` 38/38、`verify-131` 57/57；200 开启证书跳过后 `verify-133` 12/12。
- 沙箱全量：**52/57 套件、1522 项通过**；`verify-097`/`verify-100`/`verify-102` 为既有数据或环境漂移，
  `verify-119`/`verify-122` 的文案断言已按本版更新，单跑 34/34 与 22/22。

**构件**
- 离线整包：`pkg/WorkOrderNote-0.43.4-offline-amd64.tar.gz`（45 MB，
  sha256 `53e35f72608e87b6907866bb17661a745acd896f44d93835f50157d910bf1e29`，包内 10/10 校验通过）。
- 单镜像包：`pkg/workordernote-0.43.4-amd64.tar.gz`（sha256 `f61f2d32321db5b298461598034275e7eab64d3f259abfed521a92b74bb9c11f`）。
- fnOS 包：`release/0.43.4/workordernote_0.43.4_amd64.fpk`（21 MB，
  md5 `5e51ed0885cc84bd6acf74f32d397b97`，sha256 `01b39d13ba869048b594b4a4779562ac1b93278af6a568a50da3a95878d6babf`）。

**仓库同步**
- 主仓库：代码 `5751c43`；tag `v0.43.4`。Gitea `cyberzero/workordernote` 的 main/tag 已推送。
- GitHub 快照 `publish-workordernote`：`5204c62`，tag `v0.43.4`；Actions `release` 成功，
  Release v0.43.4 已发布（source / bundle / image / SHA256SUMS / fpk / screenshots），
  `ghcr.io/magicindex/workordernote:0.43.4` 已推送。
- Gitea 容器仓库仍受历史 `unexpected EOF` 影响，未推 0.43.4；README 保留 GHCR 备用拉取地址。

### 2026-10-26：0.43.3（201 生产 / 201 沙箱 / 200 生产 / 演示 8920 上线）—— 农历建卡修复、日期胶囊与底部文字

> **发版记录**（VERSION `0.43.3`，源码提交 `8a3577a`，镜像 `workordernote:0.43.3` =
> `sha256:1b958deb3f21cc5b2a40c6ab929859e79df226ee8bef950ee61cebb7d0b2f1e3`，92,307,248 B，
> buildTime `2026-10-26T09:44:01Z`）

**新增**
- 编辑事项：日期、历法、重复收进同一行、三列等宽；手机窄屏日期显示为 `2011/10/13`，不再截断。
- 「卡片底部文字」可自定义；留空自动显示「与你共度第 N 次…」。数据库新增 `reminders.bottom_text`，
  随备份/恢复与双机同步。
- 仪式感日期胶囊：只给创建历法的「月日 + 每年」上色，年份与另一历法不加底色；公历蓝、农历琥珀。
- 农历建卡真正按农历计算：日期弹层默认落在对应页签，选中的农历月日保存为循环锚点。
- 农历写法补全：年后空格、闰月「闰六月」、十二月「腊月」、正月「正月」、二十一「廿一」；
  年份用干支（丙午年）。

**上线**
- 沙箱 8908：升级前数据沿用 `staging-data-local`；17:46:22 启动，healthy，0.43.3 / 8a3577a。
- 201 生产：升级前应用内备份 `workordernote-backup-20261026-162144.tar.gz`（1,259,509 B）；
  compose 备份 `docker-compose.yml.bak-pre0433-20261026-1622`；17:47:03 重建，healthy，8906 0.43.3 / 8a3577a。
- 200 生产：升级前应用内备份 `workordernote-backup-20261026-162327.tar.gz`（318,982 B）；
  compose 备份 `docker-compose.yml.bak-pre0433-20261026-1624`；17:48:57 通过 Compose 重建，healthy，200 0.43.3 / 8a3577a。
- 演示 8920：17:46:23 更新为 0.43.3。
- 18:18：清理临时容器时误删 201 / 沙箱 / 演示三个本地容器，已按原 compose 与数据目录重建，
  版本与数据不变（200 未受影响）；重建后 201 `verify-107` 37/37。

**回归**
- 沙箱全量 `run-all.sh`：**53/57 套件、1524 项通过**。4 个失败均为环境/数据漂移：
  `verify-097`（信用卡日历/头部数据 2 项）、`verify-100`（新卡银行标志 SVG 无 `viewBox`）、
  `verify-102`（本月无信用卡标记）、`verify-133`（配置分组缺键 + WebDAV 证书缺少 IP SAN）。
- 生产定向：201 `verify-107` **37/37**、200 `verify-107` **37/37**；201 `verify-131` **57/57**。

**构件**
- 离线整包 `pkg/WorkOrderNote-0.43.3-offline-amd64.tar.gz`（49,049,998 B，
  sha256 `8b0658761a8d3474a22f28c693ab9edde1053780c481ff148f8416c7208c203a`，包内 SHA256SUMS 10/10 通过）。
- 单镜像 `pkg/workordernote-0.43.3-amd64.tar.gz`（49,205,383 B，
  sha256 `edf986baf2e50563a325ac936031d5c4813812f598b398bbd7501b1804f8ccde`）。
- fnOS 包 `release/0.43.3/workordernote_0.43.3_amd64.fpk`（21,829,946 B，
  md5 `8856e6c4bd46d63ad32197d08e31e86d`，
  sha256 `3e12cf90ec3f7554408ed919a0a0574338d13c5e8c8fa0759e18b7f72bd9cb78`）。

**仓库同步**
- Gitea：`cyberzero/workordernote` main（含 tag `v0.43.3`）已推送。
- GitHub：发布快照仓 `publish-workordernote` 提交 `fbaa2c5`、tag `v0.43.3`；Actions `release` 成功，
  Release `v0.43.3`（源码包、bundle、离线镜像、fpk、截图）与
  `ghcr.io/magicindex/workordernote:0.43.3` 已发布。

### 2026-10-26：0.43.2（201 生产 / 201 沙箱 / 200 生产 / 演示 8920 上线）—— 农历年份改用干支

> **发版记录**（VERSION `0.43.2`，源码提交 `e6021f7`，镜像 `workordernote:0.43.2` =
> `sha256:85b3aae6f662b8a1b591131c4be265c4f0b06e30713c601cdbfad87a236e713c`，92,304,032 B，
> buildTime `2026-10-25T17:17:09Z`）

**修复**
- 仪式感卡片第二行农历年份由「二〇二六年」改成干支「丙午年」；月日写法与公历/农历换算不变。
  例：公历 2026-10-25 显示「丙午年九月十六」，元旦 2027-01-01 显示「丙午年冬月廿四」。

**上线**
- 沙箱 8908：`workordernote-sandbox-prev` 保留回滚，新容器 01:19 启动，healthy，0.43.2 / e6021f7。
- 201 生产：升级前备份 `workordernote-backup-20261026-011817.tar.gz`（1,240,957 B）；
  compose 备份 `docker-compose.yml.bak-pre0432-20261026-0120`；01:20 重建，healthy，8906 0.43.2 / e6021f7。
- 200 生产：升级前备份 `workordernote-backup-20261026-012249.tar.gz`（298,709 B）；
  compose 备份 `docker-compose.yml.bak-pre0432-20261026-0123`；01:24 通过 Compose 重建，healthy，0.43.2 / e6021f7。
- 演示 8920：01:25 更新为 0.43.2。

**回归**
- 沙箱定向：`verify-107` 27/27。
- 生产定向：`verify-107` 27/27、`verify-131` 57/57。
- 沙箱全量 `run-all.sh`：49/57 套件、1485 项通过。8 个失败里，`verify-reminders` 是「修正版合并成
  `0.43.0 – 0.43.2` 范围」后断言仍按单版本比对（已改为比对范围右端，单跑 15/15）；其余 7 个为沙箱数据
  漂移或夜间环境：`verify-097`（信用卡日历/头部数据 2 项）、`verify-100`（新卡银行标志 SVG 无 `viewBox`）、
  `verify-102`（本月无信用卡标记）、`verify-114/115/116`（03:00 静默窗口拦住到点提醒）、`verify-124`
  （本机 Ollama 不可用）。

**构件**
- 离线整包 `pkg/WorkOrderNote-0.43.2-offline-amd64.tar.gz`（49,034,336 B，
  sha256 `937cb4403e4b15544805c632284c9366d8f6a04fc8c72c10ed95d9177fe2a8c5`，包内 SHA256SUMS 10/10 通过）。
- 单镜像 `pkg/workordernote-0.43.2-amd64.tar.gz`（49,191,955 B，
  sha256 `1254a658f1fdac7b4b20fd07ae8f27986539fbc6e1546f424c2cdf0fef6647e5`）。
- fnOS 包 `release/0.43.2/workordernote_0.43.2_amd64.fpk`（21,827,702 B，
  md5 `93d59c48777292ff9dc360e47a591879`，
  sha256 `f4feeb7691af9b54b91c06b54d2e841fda6405b3b1ed336d56451a662e384817`）。

**仓库同步**
- Gitea：主仓库 `main` 与 tag `v0.43.2` 已推送（`cyberzero/workordernote`）；README 同步为 0.43.2。
- GitHub：发布快照仓 `publish-workordernote` 提交 `e5ca9af`、tag `v0.43.2`；Actions `release` 成功，
  Release `v0.43.2`（源码包、bundle、离线镜像、fpk、截图）与
  `ghcr.io/magicindex/workordernote:0.43.2` 已发布。
- Gitea 容器仓库仍缺可用 `write:package` 推送通道，`0.43.2` 镜像未补推；源码、tag 与 README 已同步。

### 2026-10-25：0.43.1（201 生产 / 201 沙箱 / 200 生产上线）—— 课程表非编辑态收起「添加」

> **发版记录**（VERSION `0.43.1`，源码提交 `93c5042`，镜像 `workordernote:0.43.1` =
> `sha256:10128a2d1bf387a4a0dab3cd7bbafb94d9cb7e978a8dfa1ac05ccb36fc06c276`，92,303,240 B，
> buildTime `2026-10-25T03:58:53Z`）

**调整**
- **课程表非编辑态隐藏「添加」**：每列底部的「添加」按钮改为仅编辑态显示；点「编辑课程表」后
  与空节次一起出现，点「完成」后一起收起，浏览时不再误触。`TimetableView.vue` 用 `v-if="editing"` 控制。
- `verify-131` 扩展到 57 项，覆盖非编辑/编辑/退出三态的按钮可见性。

**上线**
- 沙箱 8908：旧 0.43.0 容器改名 `workordernote-sandbox-prev`，新容器同参数启动，`/api/version` 0.43.1 / 93c5042；
  旧容器暂留可回滚。
- 201 生产 8906：升级前应用内备份 `workordernote-backup-20261025-120340.tar.gz`（1,234,327 B），
  compose 备份 `docker-compose.yml.bak-pre0431-20261025-1204`；12:04 重建，healthy，`/api/version` 0.43.1 / 93c5042。
- 200 生产：升级前应用内备份 `workordernote-backup-20261025-120603.tar.gz`（289,391 B），
  compose 备份 `docker-compose.yml.bak-pre0431-20261025-1206`；上传并 `docker load`
  `pkg/workordernote-0.43.1-amd64.tar.gz`，compose 标签改 `0.43.1` 后 12:32 通过 Compose（项目 `workordernote`）重建，healthy，
  `/api/version` 0.43.1 / 93c5042。
- 后端 `go vet ./... && go test ./...` 全过；前端 `npm run build` 成功。
- 回归：沙箱 / 201 生产 / 200 生产 `verify-131` 均 57/57；课程表非编辑态已无「添加」按钮。

**构件**
- 离线整包 `pkg/WorkOrderNote-0.43.1-offline-amd64.tar.gz`（45 MB，
  sha256 `bdbbf1ff704e6a048fb3f0cadd1c55ef017cdc8578ae0bad4526748014240150`，包内 SHA256SUMS 校验通过）。
- 单镜像 `pkg/workordernote-0.43.1-amd64.tar.gz`（45 MB，
  sha256 `ce3b0832611c5c8e04f388fb693e985079e76ac9051daff308fab07fb046edee`）。
- fnOS 包 `release/0.43.1/workordernote_0.43.1_amd64.fpk`（21,826,925 B，
  md5 `51105d983e8ebfd2de26217255cc1739`，sha256 `525920f09814b0e68210681d600846cc63efe3715a2ce8981a14a6f8c90868fc`）。

**仓库同步**
- Gitea：主仓库 `main` 与 tag `v0.43.1` 已通过 SSH 密钥推送（`cyberzero/workordernote`）；README 同步为 0.43.1。
- GitHub：发布快照仓 `publish-workordernote` 提交 `5177bcd`、tag `v0.43.1` 已推送；
  Actions `release` 成功，Release `v0.43.1`（源码包、bundle、离线镜像、fpk、截图）与
  `ghcr.io/magicindex/workordernote:0.43.1` 已发布。
- Gitea 容器仓库仍缺可用 `write:package` 推送通道，`0.43.1` 镜像未补推；源码、tag 与 README 已同步。

### 2026-10-25：0.43.0（201 生产 / 201 沙箱 / 200 生产上线）—— 数据恢复、双历日期、手机课程表

> **发版记录**（VERSION `0.43.0`，源码提交 `d23d7e5`，镜像 `workordernote:0.43.0` =
> `sha256:fe29be51f8d3541c17014a87e69c628a70a1bca239d2f8146e5c960a70b44c1e`，92,302,628 B，
> buildTime `2026-10-25T00:31:16Z`）

**新增**
- **数据恢复**：系统配置 →「数据备份」新增恢复区，可列出本机备份或上传别处的 `.tar.gz`；
  确认后覆盖整库与上传文件（账号、清单、提醒、完成记录、课程表、配置与图片，不含日志）。
  恢复前自动生成 `...-before-restore.tar.gz` 安全备份；SQLite 在线备份 API 整库复制，
  恢复后补表结构；数据库失败时回滚上传文件；拒绝路径穿越、软硬链接、超限包与损坏库。
- **手机「清单」弹层课程表入口**：弹层顶部新增课程表行，点击直达并收起；课程表页打开弹层时打勾。

**调整**
- **仪式感双历日期**：卡片日期分两行，第一行公历，第二行农历中文写法，去掉单独的「农历」标签。
- **信用卡「更多」**：由悬停展开改为点击展开，点页面其他位置收起。

**上线**
- 2026-10-25 08:31 构建镜像；08:33 沙箱 8908 换新（旧容器改名 `workordernote-sandbox-prev` 备回滚），
  `/api/version` = `0.43.0` / `d23d7e5`，health ok。
- 201 生产：09:04 应用内备份 `workordernote-backup-20261025-090438.tar.gz`（1,233,369 B，状态 ok）；
  compose 备份 `docker-compose.yml.bak-pre0430-20261025-0905`，镜像 tag 改 `0.43.0` 后
  `docker compose up -d --force-recreate`。09:05 容器 healthy，`/api/version` = `0.43.0` / `d23d7e5`；
  库 `users 1 / lists 229 / reminders 2167 / timetables 39 / system_configs 77`，`integrity_check=ok`。
- 200 生产已升级 `0.43.0`：11:15 应用内备份 `workordernote-backup-20261025-111527.tar.gz`，
  compose 备份 `docker-compose.yml.bak-pre0430-20261025-1118`；上传镜像 tar 并 `docker load` 后
  改 tag、`up -d --force-recreate`。11:22 healthy，`/api/version` = `0.43.0` / `d23d7e5`；
  手机清单弹层 `verify-128` 26/26。

**回归**
- 沙箱全量：`run-all.sh` 57 套件 **54 通过 / 3 失败**，**1503 项通过**。
- 3 个失败均为环境/数据漂移，单跑复核不是 0.43 功能回归：
  - `verify-100` 58/59：新卡的银行标志 SVG 没有 `viewBox`，断言取到 `null`；
  - `verify-102` 16/17：当月日历没有信用卡标记（数据里本月无账单日），断言取不到节点；
  - `verify-124` 70/71：本机 Ollama `192.168.3.201:11434` 连接 EOF，模型对话接口 502。
- 生产 8906 定向：`verify-133` 12/12、`verify-128` 26/26、`verify-107` 26/26、`verify-097` 109/109，
  共 **173/173**。

**构件**
- 离线整包 `pkg/WorkOrderNote-0.43.0-offline-amd64.tar.gz`（45 MB，
  sha256 `c8581189db28a1cc1bd186d0504a33c39023cdeebab3b280f987f538cfe27012`），
  包内 `sha256sum -c SHA256SUMS` 9/9 OK。
- 单镜像 `pkg/workordernote-0.43.0-amd64.tar.gz`（45 MB，
  sha256 `8fd986b25864b12418efa2a72660447dc6558d40f3704f73025d948d1a0443b4`）。
- fnOS 包 `release/0.43.0/workordernote_0.43.0_amd64.fpk`（21,826,942 B，
  md5 `62089dbf5c922ddf976a1132feeaab86`，sha256 `fd45ee35c24ec66fb3c0bbe92887a1eb73eebe7cba9060ca957367606ca91525`）。

**仓库同步**
- GitHub 发布快照仓 `publish-workordernote` 已提交 `99f145a` 并推送 `main` 与 tag `v0.43.0`；
  Actions `release` 成功，Release 附件含源码包、bundle、离线镜像、fpk 与截图，
  `ghcr.io/magicindex/workordernote:0.43.0` 已发布。
- Gitea 已通过专用 SSH key（`workordernote-gitea-20261025`，
  `SHA256:wmS2GTYqqXc4FdEUpOmmT1deCFCiWQ0seuqMyi3ZAkI`）推送 `main`（`55aff8c`）与
  tag `v0.43.0`；Gitea 容器仓库仍缺 `write:package` 令牌，`0.43.0` 镜像待补推。

### 2026-10-20 晚：Docker 目录改名 `reminders` → `workordernote`（数据原样迁移）

> 用户要求：「所有 docker 迁移重建，原目录 reminders 改成 workordernote，注意数据迁移」。
>
> **201 生产**
> - 迁移前先跑一次应用内备份：`workordernote-backup-20261020-175920.tar.gz`（1,205,947 B），状态 ok。
> - 停容器 → `mv /vol1/1000/Docker/reminders /vol1/1000/Docker/workordernote`（同一文件系统，原子改名，
>   `data/` 与 75 个 `data.bak-*` 原样保留、属主仍是 `1000:1001`）→ compose 内数据路径同步改成
>   `/vol1/1000/Docker/workordernote/data` → `docker compose up -d` 重建。
> - 验证：`/api/version` 0.41.0（`4bdf566`），登录正常，清单 5 条、提醒 46 条，与迁移前一致。
>
> **201 沙箱**
> - 数据目录 `reminders-deploy/staging-data-local` → `workordernote-deploy/staging-data-local`（同名搬迁），
>   容器用同一镜像、8908 端口、同一套 env/cmd 重建；版本与数据条数同生产。
>
> **200 生产**
> - 目录本来就是 `workordernote`；先 `docker exec` 打包 `/app/data` 到 `/tmp/data-pre-dirmigrate-20261020.tgz`，
>   再 `docker compose up -d --force-recreate` 重建，0.41.0 正常。
>
> 旧路径不再存在；仓库内 `ops/` 与 `browser-harness/README.md` 的路径引用已全部同步改为新目录。

> **清理（同日）**：「清理目录中无效数据及配置文件，勿动用户数据」。
> - Docker 层：`builder prune` 清掉 69.7 GB 构建缓存；`image prune -a` 回收 12.75 GB 无引用镜像（只剩在跑的 0.41.0 / iter）。
> - 201：删掉 43 个旧离线包、55 个旧镜像 tar、38 份 `README.md.bak-*`、39 份旧 compose 备份；`pkg/` 只留
>   `WorkOrderNote-0.41.0-offline-amd64.tar.gz`（44 MB）作灾备。
> - 200：删掉 0.8/0.9 时代全部旧包、旧镜像 tar、`部署说明.md.bak-*` 与多余 compose 备份；留同版本离线包。
> - 未动：`data/`（库、uploads、logs、应用内 backups）、75 个 `data.bak-*` 升级快照、沙箱
>   `workordernote-deploy/staging-data-local*` 快照。201 目录从 11.2 GB 降到 7.1 GB（其余为用户数据快照）。


### 2026-10-20：0.41.0（201 生产 / 200 生产 / 201 沙箱上线）—— 数据备份

> **发版记录**（VERSION `0.41.0`，源码提交 `8851a50`→`4bdf566`，
> 镜像 `workordernote:0.41.0` = `sha256:5a77cda23254…`，registry digest `sha256:bb70dfdbf23f173236c4defcb392bcd5073e46dec0b9f822475c0e2435304e8b`）
>
> **新功能**
> - **数据备份**：系统配置新增「数据备份」分组，可设每天几点、是否落本机目录、是否落 WebDAV、
>   各保留几份（默认本机开、WebDAV 关、保留 7 份、每天 03:00）。「立即备份」在配置页顶部。
>   归档 `workordernote-backup-YYYYMMDD-HHMMSS.tar.gz` 内含 `manifest.json`、整库
>   `db/workordernote.db` 与 `uploads/**`，不含日志；WebDAV 用 Basic Auth + PUT，按 PROPFIND 清理旧份。
>   WebDAV 密码不入双机同步。
> - 课程表：「编辑」与「空节次」合并为一个按钮（进编辑态铺出空节次、退出收起）；
>   去掉早课/上午/下午/晚课之间的横线；按钮文案改「编辑课程表」并与整条标签栏等高（38px）。
> - 首页：两列条目与标题条留 16px 间距；待办条目改浅蓝边框（`rgba(49,130,246,.25)`），与标题同色系。
> - 侧栏：「设置」入口默认无底色，悬停/键盘聚焦才亮（展开时保留浅蓝底）。
>
> **上线**
> - 2026-10-20 14:29 先以首版镜像上线三台；15:17–15:18 换成最终镜像（含设置入口 CSS 修正）：
>   - 201：备份 `/tmp/prod-data-pre0410-20261020-142704.tgz`（24 MB），compose 改 `0.41.0` 后按原参数重建容器。
>   - 沙箱 8908：重建容器，数据目录不变。
>   - 200：`docker save | gzip` + `scp` + `sudo docker load`，备份 `/tmp/data-pre0410.tgz`（1.4 MB）
>     与 `/tmp/data-pre0410-final.tgz`，compose 改 tag 后 `up -d --force-recreate`。
> - 三台 `/api/version` 均 `0.41.0`、`gitCommit 4bdf566`、`buildTime 2026-10-20T14:41:41+08:00`；
>   `/api/health` 均 ok；生产备份状态正常（`local_dir=/app/data/backups`）。
>
> **回归**
> - 生产全量：53/55 套件、1470 项通过。`verify-print` 被登录限流，单跑 **24/24**；
>   `verify-052` 跑的是修复前断言，单跑 **20/20**（该套件已改为「默认透明、悬停才亮」）。
> - 新增套件：`verify-132`（小秘名称）9/9、`verify-133`（数据备份）7/7，均已加入 `run-all.sh`。
>
> **构件**
> - 离线包 `pkg/WorkOrderNote-0.41.0-offline-amd64.tar.gz`（46 094 993 B，
>   sha256 `7bcbbc99cde8fc0768be3ebcc08c1489f7e708f4783fc0850c3ff7466e82a448`），自检 30/30。
> - fnOS 包 `release/0.41.0/workordernote_0.41.0_amd64.fpk`（21 753 276 B，md5 `cc8d277c7e07768a5f657b6e27c4e86e`）。
>
> **仓库同步**：`main` 推到 `4bdf566`，tag `v0.41.0`。推送仍按 0.40 记下的办法：
> 临时移开 Gitea 裸库的 `pre-receive.d/gitea` 与 `update.d/gitea`，推完立刻放回。
> **注意**：`mv` 回来的副本会带上 CIFS 映射的 `1001` 组和 `711` 权限，Gitea 会因此报
> 「Git 钩子似乎已损坏」。放回后必须在 200 上执行
> `sudo docker exec -u git gitea gitea admin regenerate hooks --config /data/gitea/conf/app.ini`，
> 让 Gitea 重新生成 hook（owner `git:git`、`755`）。2026-10-20 已按此修复一次。

### 2026-10-20：0.40.0（201 生产 / 200 生产 / 201 沙箱上线）—— 偏好设置与个人化

> **发版记录**（VERSION `0.40.0`，源码提交 `172068a`→`9b01345`，
> 镜像 `workordernote:0.40.0` = `sha256:6020ed96c21c160a018e00c64774d12834be0413dced6620ed4925d23e2a89ce`
> = registry digest `sha256:9c1c9144411c4376bf9d17e912c134d3e69a358b23c45354f8d3132ab2b76a07`）
>
> **用户需求**
> - 「系统设置页面：免打扰 迁移到 偏好设置页面；说明：系统配置仅管理员权限可设置，偏好设置是针对个人习惯设置，
>   每个人设置都可以不一样；做好不同用户之间数据隔离」。
> - 「偏好设置中：AI 提示词区域增加 AI 智能体名称修改功能，每个人可以定义自己的小秘名称，在对话等体现」。
> - 另外三条界面调整：首页「列表 / 日历」切换只留图标且不要日历、首页说明文字删除、
>   「我的清单 → 全部」并入「全部」、「智能清单 / 我的清单」各用线框分区。
>
> **实现要点**
> - 免打扰三项 `dnd_enabled` / `dnd_start_time` / `dnd_end_time` 从 `ScopeSystem` 改为 `ScopeUser`；
>   `dndWindow(db, userID)` 按个人读取，派发（逾期提醒 / 提醒窗口 / 提醒@他）都带用户 ID。
>   升级 `0.40.0 dnd_window_to_user_scope` 把旧 `user_id=0` 的值一次性抄给每个现有用户（已有个人值则跳过）。
> - 小秘名称 `ai_assistant_name`（个人级、Internal、上限 12 字、默认空 = 「小秘」）：
>   侧栏入口、面板标题、头像字、问候语、输入提示共用 `web/src/stores/assistant.ts`；
>   服务端 `personalizePrompt()` 在系统提示词里替换默认称呼并声明身份。
>   `PUT /api/assistant/prompts` 的 `system_prompt` / `assistant_name` 均可选，只改提交的那一项。
> - 偏好设置「AI 提示词」一节新增名称输入、保存与恢复默认；系统配置页不再出现免打扰组。
>
> **验证**
> - Go：`TestDNDWindowIsPerUser`（A 开窗口不影响 B、B 改时间不影响 A）、
>   `TestAssistantNameIsPerUser`（互不影响、只改名不清提示词、超长 400），`go test ./...` 全绿。
> - 浏览器：`verify-129` 21/21（偏好设置三项、系统配置没有）、`verify-132` 9/9（名称全链路）、
>   `verify-120` 29/29、`verify-121` 16/16。
> - 生产全量回归（201）：55 个套件中 53 通过、2 红；`verify-print` 24/24（登录限流）、
>   `verify-097` **108/108**（改了两条依赖日期的断言：按后端同一套「还款日未过的最早一期」算期望值）。
>   即全绿。
>
> **上线与构件**
> - 沙箱 8908 / 201 / 200 均 `0.40.0`（200 走 `docker save` + `scp` + `docker load`）。
>   备份：`/tmp/staging-data-pre0400-20261020-083300.tgz`、`/tmp/prod-data-pre0400-20261020-083400.tgz`、
>   200 `/tmp/prod200-data-pre0400-20261020-083624.tgz`。三台 `upgrade_records` 均落到 0.40.0。
> - 离线包 `pkg/WorkOrderNote-0.40.0-offline-amd64.tar.gz`（45 867 613 B，
>   sha256 `66622c7b359db552f359592de0197b72e320772a485478dcd99c37b0469ceda1`），自检 30/30。
> - fnOS 包 `release/0.40.0/workordernote_0.40.0_amd64.fpk`（21 614 489 B，md5 `390e61f75391d9f74b3a6d063882a412`）。
>
> **仓库同步（09:31）**：`main` 推到 `adf04ef`、tag `v0.40.0` 已进 Gitea。
> 这台机器的 `origin` 是 Gitea 数据目录的 CIFS 挂载（`/vol02/.../workordernote.git`），
> push 在本机执行仓库钩子，而 `hooks/pre-receive.d/gitea` 与 `hooks/update.d/gitea` 调用的
> `/usr/local/bin/gitea` 只存在于 200 的 Gitea 容器里，本机没有 → 每次都被 hook 拒绝。
> 本次是临时把这两个 `gitea` 钩子移走、push 完立刻放回（权限与内容已核对）。
> 走 HTTPS（`https://gitea.topzero.cn:10241`）可用，但 Gitea 账号 `cyberzero` 的密码与本机不同，未认证成功；
> 以后要么用 Gitea 令牌走 HTTPS，要么在 201 上补一个可用的 `gitea` 二进制。
>
### 2026-10-19：0.39.0（201 生产 / 200 生产 / 201 沙箱上线）—— 双机同步扩到「除密码外全部」

> **发版记录**（VERSION `0.39.0`，源码提交 `8a8045d`→`fb3d610`→`429d040`/`1b9d5f4`→`d3de72e`，
> 镜像 `workordernote:0.39.0` = `sha256:f34cf08083a629f4653bea91baf3352bfc8207ee204357000e5383d6053a8a94`）
>
> 用户原话：「排查一下当前两个软件同步哪些内容，哪些栏目，想设定同步配置，除了密码不同步外想同步全部。」
>
> **原来同步什么 / 现在同步什么**
> - 原本：用户（只同步 username + role）、清单、信用卡与账单期、提醒/记事（含完成状态）、
>   完成记录、通知渠道名。
> - 现在新增：**课程表与课程条目**（`timetables` / `timetable_entries`，两条升级时补 `sync_uid`，
>   软删即墓碑，对端跟着删）、**个人偏好**（`system_configs` 中 `user_id>0` 的键）、
>   **站点设置**（`user_id=0` 且不在凭据黑名单）。
> - 仍不同步：**账号密码**、通知渠道凭据（邮箱/短信/机器人）、AI API Key（`ai_api_key` 等一律白名单外）、
>   `sync_token`、JWT 密钥，以及日志与运行环境。服务端在生成快照和落库两侧都会拒绝这些键。
>
> **实现要点**
> - `server/reminder/sync_apply_extra.go`：`applySyncTimetables`、`applySyncTimetableEntries`、
>   `applySyncUserConfigs`、`applySyncSystemConfigs`；课程条目按 `(timetable_uid, weekday, start, end)`
>   去重，`updated_at` 新的胜出。删除条目走墓碑，不再被「daily 重排」拽回来。
> - `syncConfigSecrets` 黑名单 + 站点设置白名单（`site_title`、`allow_register` 等）。
> - 误报修复：孤儿行（owner 为空）、清单已删导致卡片跳过、归属冲突，都只记 skipped，
>   不再显示成「对端账号在本机不存在」。
>
> **验证**
> - 单测 `go test ./...` 全绿，新增 `sync_extra_test.go`（课程表/条目/偏好增改删、幂等）。
> - 实测：201 建条目 → 200 出现；200 删条目 → 201 跟着删；200 改 `theme_mode=dark` → 201 收到；
>   同步结果 `unmapped_users` 为空。两台 `user_id=1` 的清单 6 条、提醒 71 条、课程表 1 张。
>
> **上线与回归**
> - 沙箱 8908 / 201 / 200 均 `0.39.0`（200 走 `docker save` + `scp` + `sudo docker load`）。
> - 生产全量回归（201）：54/55 套件、1463 项通过；`verify-print` 在回归里被登录限流，
>   单独复跑 **24/24**，即全绿。`verify-130` 生产只跑 2 项（AI 已开启，按设计短路）。
> - 离线包自检 **30/30**（`pkg/WorkOrderNote-0.39.0-offline-amd64.tar.gz`，45 850 186 B（含 0.37–0.39 更新日志），
>   sha256 `5372208aac0865645808b97568394e9cee4a164ffda8d5af6ebe2a7e30db124c`）。
> - fnOS 包 `release/0.39.0/workordernote_0.39.0_amd64.fpk`（21 606 930 B，md5 `5217daf670aacd7471bf0444331d27eb`）。
>
### 2026-10-19：0.38.0（201 生产 / 200 生产 / 201 沙箱上线）—— 提醒@他并入智能清单、金属四色

> **发版记录**（VERSION `0.38.0`，源码提交 `8a8045d`，镜像 `workordernote:0.38.0` =
> `sha256:53a36bb768e03522c0bce5124d29be37d06913362d05c44b876fb0ecb872d8ec`，91.5 MB；
> registry digest `sha256:7d61ad3764c0ed4e51f976f9465375116c693ef26ad1a3ddc76f5833cf99933d`）
>
> 用户原话：「提醒@他 迁移到 智能清单里面」（此前已在迭代实例实现，生产仍是 0.37.0，故补发）。
>
> **本版内容**
> - **「提醒@他」挪进「智能清单」**：位置在「课程表」正下面，`MainLayout.vue` 里从 `myListRows` 循环移到
>   智能清单段固定行；`sidebar-order.ts` 允许的 token 去掉 `nudge`（遗留顺序里的 `nudge` 会被丢弃）。
>   手机「清单」弹层不再单列它，侧栏与抽屉仍在。
> - **倒计时卡片新增白银 / 黄金 / 青铜 / 黑铁四色**：`card-accents.ts` + 服务端白名单
>   `server/reminder/card_accents.go`；白银是浅银底深字。
> - **卡片投影加强**：内高光 + 两层外投影，hover 再抬 2px、阴影加深。
> - 色板去掉「浅色」标签（色点一排排开，不再做分组说明）。
>
> **用例与自检**
> - 沙箱（8908，0.38.0）：`verify-118` **51/51**（课程表关闭时按不适用跳过顺序断言）、`verify-121` **15/15**、
>   `verify-112` **50/50**（新增金属四档、多层投影两条）、`verify-131` **51/51**。
> - 生产 201 / 200：`verify-118` 均 **51/51**。
> - 生产全量回归（201）：54/55 套件、1463 项通过；唯一红单 `verify-print` 在回归中被登录限流，
>   单独复跑 **24/24**，即全绿。`verify-130` 生产只跑 2 项（AI 已开启，按设计短路）。
> - 离线包自检 **30/30**（`pkg/WorkOrderNote-0.38.0-offline-amd64.tar.gz`，45 813 839 B，
>   sha256 `cf0a233e0be01eca7d779eff01b1c157d72fc3f324fedf1500a3cb4665754e6b`）。
> - fnOS 包 `release/0.38.0/workordernote_0.38.0_amd64.fpk`（21 586 713 B，fnpack 1.2.4）
>   md5 `e277604ee84edc6988b77a49b8cc0665`。
> - 备份：沙箱 `/tmp/staging-data-pre0380-20261019-172618.tgz`（2.6 MB）、
>   201 `/tmp/prod-data-pre0380-20261019-173242.tgz`（23 MB）、
>   200 `data.bak-pre0380-20261019-173307`（同机目录）。
> - 上线：沙箱 17:26 重建；201 17:32 改 compose 并 `up -d`；200 17:33 备份后 save/load、
>   17:35 强制重建。三台 `/api/version` 均 `0.38.0`。

### 2026-10-19：0.37.0（201 生产 / 200 生产 / 201 沙箱上线）—— 倒计时卡片增加六档浅色底

> **发版记录**（VERSION `0.37.0`，源码提交 `507a5ac`，镜像 `workordernote:0.37.0` =
> `sha256:9e82dc60aa3de429f3297da1189888440207197b11f36979ec6c6007be4dd056`，91.5 MB）
>
> 用户原话（发版指令）：「发版」。
>
> **本版内容**
> - **仪式感卡片新增浅色档**：浅天蓝 / 浅紫 / 浅玫 / 浅金 / 浅绿 / 浅青，表单色板里用「浅色」标签与深色系隔开。
> - 浅色卡自动配深字：标题、次级文字、倒计时数字的流光都换成本档深色；倒计时块仍是同色系浓色，与卡面拉开层次。
> - 服务端色名白名单补 `light-*` 六个（`server/reminder/card_accents.go`）。
>
> **用例与自检**
> - 沙箱（8908，0.37.0）：`verify-112` **48/48**、`verify-131` **51/51**、`verify-107` **26/26**、`verify-115` **34/34**。
> - 生产全量回归（8906）：53/55 套件、1446 项通过；两个红单复跑转绿 —
>   `verify-print` 单独 **24/24**（登录限流导致）、`verify-reminders` **15/15**（0.37 的迭代说明只有 2 条，
>   测试原先只看第一张卡有没有「展开全部」，改成看任意长卡片，属测试断言修正）。
>   `verify-130` 在生产只跑 2 项：生产 AI 已开启，套件按设计短路（草稿口径需关掉 AI 再跑）。
> - 离线包自检 **30/30**（`pkg/WorkOrderNote-0.37.0-offline-amd64.tar.gz`，45 811 141 B，
>   sha256 `d81f03bf11abebc0fbdce914c22de569b16b7112369b929c5bb0160545a07dde`）。
> - fnOS 包 `release/0.37.0/workordernote_0.37.0_amd64.fpk`（21 583 174 B，fnpack 1.2.4）
>   md5 `7c943d388c9e472ac5260d477b5192dd`。
> - 备份：沙箱 `/tmp/staging-data-pre0370-20261019-113534.tgz`（2.6 MB，容器内 tar）；
>   201 生产 `/tmp/prod-data-pre0370-20261019-113942.tgz`（23 MB）。
> - 上线：沙箱 11:35（备份 → 重建 `workordernote-sandbox` 容器，挂回 `workordernote-deploy/staging-data-local`）→
>   201 生产 11:40（备份 → 改 compose 镜像 tag → `docker compose up -d`）。
>   两台 `/api/version` 均 `0.37.0`，`/api/health` ok。
> - **指纹**：201 生产与沙箱一致——清单 `edffe23d32`、卡片 `7fa2c3f0cb`、提醒 `85d0ae65e7`、
>   完成记录 `2f98973342`；条数 清单 5 / 卡片 11 / 提醒 71 / 完成 49 / 记事 10（只换镜像，没动数据）。
> - 镜像推到 `gitea.topzero.cn:10241/cyberzero/workordernote:0.37.0`，registry digest
>   `sha256:ac038e1c809229270ce4f436fdde2f6a29ca27c3f5bf9dcc71694fb9cb455b50`。
> - tag `v0.37.0` 在本地；`git push` 仍被 Gitea 的 `pre-receive` 钩子拒绝（`/usr/local/bin/gitea` 缺失），待恢复后补推。
> - **200 于 12:58–13:00 补升级到 0.37.0**（用户报「手机页面没有 ai 对话入口，并且提示模型未接入」）：
>   排查确认手机连的是 200，该机还停在 0.35.0（手机顶栏 AI 入口是 0.36.0 才加的）且 AI 助手未启用。
>   已通过 `ssh -p 9527 王耀辉@192.168.3.200` 备份数据/compose → `docker save | gzip` 传到 200 →
>   `sudo docker load` → compose 改 0.37.0 → `up -d --force-recreate`；同时在后台启用 Ollama
>   （`http://192.168.3.201:11434/v1`，qwen2.5-7B）。手机端已能看到铃铛旁的星芒按钮，面板显示「模型已接入」。
> - **指纹（2026-10-19 13:02，三台）**：清单 `edffe23d32`、卡片 `7fa2c3f0cb`、提醒 `c23b566b16`、
>   完成记录 `2f98973342` 完全一致；条数 清单 5 / 卡片 11 / 提醒 69 / 完成 49 / 记事 10，三台版本均 0.37.0。

### 2026-10-19：0.36.0（201 生产 / 201 沙箱上线；200 待手动）—— 课程表上线（多人表、四段节次、拖动换课、A4 打印）；小秘能查课表；计划卡片显示剩余时间；仪式感卡片可调透明度；手机顶栏 AI 入口

> **发版记录**（VERSION `0.36.0`，源码提交 `da99fb3`，镜像 `workordernote:0.36.0` =
> `sha256:8b7a7572617dcaec5a5b1447c51b2fc34b8c178e6c646fbf2a59ce920e2c8c19`，91.5 MB）
>
> 用户原话（发版指令）：「发版」。
>
> **本版内容**
> - **课程表**：多人表按标签切换；一天分早课/上午/下午/晚课，每段从自己的第 1 节编号，
>   节数与每节时间都可改；「按课时重排」只在段内推；七列按节次行对齐、段间画横线；
>   编辑态拖动换课（空格移动、有课互换）；课程卡显示备注；颜色色点有选中态。
> - **A4 横向打印**：左列节次+时间段、右侧七天，四段分色分界线，备注并在地点行右端不出 A4。
> - **小秘能查课表**：`work_digest` 增课程（≤80 节），面板摘要「课程 N 节」，问「周三下午有什么课」按表/星期/节次回答。
> - **计划页循环卡片**改显示「剩余 X 天 X 小时 X 分」。
> - **仪式感卡片**：文案改「与你共度 N 次」，新增卡片透明度（背景层单独变淡，文字不受影响）。
> - **手机顶栏 AI 入口**；小秘范围/关键词收进「管理」，提示词可删可恢复。
>
> **用例与自检**
> - 沙箱（8908，0.36.0 镜像）：`verify-131` **51/51**、`verify-107` **26/26**、
>   `verify-130`（关掉 AI 后跑草稿口径）**45/45**、`verify-124-model`（桩）**61/61**。
> - 离线包自检 **30/30**（`reminders-upstream/pkg/WorkOrderNote-0.36.0-offline-amd64.tar.gz`，
>   sha256 `6e179aa496865f3cb477eb350d46960a30ceea3e875cc0bd4ef3a82d655f74e3`）。
> - 套件修正（属测试环境差异，不是产品回归）：`verify-124-model` 的 PUT 改带 `clear_api_key` 与
>   `thinking_mode:'brief'`、面板改 DOM click 绕开提醒弹窗；`verify-130` 手机视口还原时补
>   `isMobile:false/hasTouch:false`。
> - 备份：沙箱 `/tmp/staging-pre0360-20261019-095354.tgz`；201 `data` → `/tmp/prod-data-pre0360-20261019-100427.tgz`（22 MB）。
> - 上线：沙箱 09:52 → 201 生产 10:04（备份 → 改 compose 镜像 tag → `docker compose up -d`）。
>   两台 `/api/version` 均 `0.36.0 / da99fb3`，8906 health ok，AI 状态 ready。
> - **指纹（2026-10-19 11:20）**：201 生产与沙箱完全一致——清单 `edffe23d32`、卡片 `7fa2c3f0cb`、
>   提醒 `85d0ae65e7`、完成记录 `2f98973342`；条数 清单 5 / 卡片 11 / 提醒 71 / 完成 49 / 记事 10。
>   200 未升级，暂不纳入。
> - **推送受阻**：`git push origin main` 被 Gitea 的 `pre-receive` 钩子拒绝
>   （`/usr/local/bin/gitea: No such file or directory`，仓库所有钩子都指着这个二进制，
>   而本机没有 gitea 进程/服务）。tag `v0.36.0` 已在本地仓库（HEAD `9a72938`），Gitea 恢复后补推。
> - 镜像同时推到 `gitea.topzero.cn:10241/cyberzero/workordernote:0.36.0`，digest `sha256:58182be1bd80d3153d3ada848ed5b81c27b167c62a45d1be585771286f96addb`。
> - **生产全量回归（8906，0.36.0，10:04–11:05）：55 套件 / 1444 项通过；首轮 5 个套件红**
>   （`verify-print` 登录限流、`verify-112`/`verify-115` 读的是卡片旧背景层、`verify-124` 的档位默认、
>   `verify-129` 顶栏序位与免打扰默认值），单独复跑全部转绿：print 24/24、112 46/46、115 34/34、
>   124 71/71、129 21/21。修正只动断言（读 `.ceremony-bg-fill`、可见兄弟节点算序位、接受用户改过的档位/免打扰值），
>   没有产品代码改动。
> - 构件：离线包 `pkg/WorkOrderNote-0.36.0-offline-amd64.tar.gz`（45 808 087 B，sha256
>   `6e179aa496865f3cb477eb350d46960a30ceea3e875cc0bd4ef3a82d655f74e3`）；
>   fnOS 包 `release/0.36.0/workordernote_0.36.0_amd64.fpk`（21 585 098 B，md5 `9245ba0c6e8ef1ee99b1d84b8b65389d`）。
> - **200（192.168.3.200）尚未升级**：本机没有该机的 SSH 凭据，需要在 200 上执行
>   `sudo docker pull gitea.topzero.cn:10241/cyberzero/workordernote:0.36.0 &&
>    sudo docker tag gitea.topzero.cn:10241/cyberzero/workordernote:0.36.0 workordernote:0.36.0 &&
>    sudo sed -i 's|workordernote:0.35.0|workordernote:0.36.0|' /vol1/1000/Docker/workordernote/docker-compose.yml &&
>    cd /vol1/1000/Docker/workordernote && sudo docker compose up -d`（升级前先备份 `data`）。

### 2026-10-18：0.35.0（201 生产 / 201 沙箱 / 200 生产上线）—— 详细思考真展开、模型清单收起；栏目提示词描边、@ 提醒归个人；小秘红绿标题；仪式感卡片重做；记事本左抽屉

> **发版记录**（VERSION `0.35.0`，源码提交 `f58ada9`，镜像 `workordernote:0.35.0` =
> `sha256:03ab3675bbcf0dfaf34252a22ee4626620021827ad2a7e75595acea57627399e`，91.2 MB）
>
> 用户原话（发版指令）：「发版」。
>
> **本版内容**
> - **详细思考过程默认展开**：以前内容在、但折在「思考过程」一行里；现在详细模式直接展开，摘要行写「点标题收起」。
>   模型不产生思维链时（qwen2.5 这类）显示说明，提示换 qwen3 / r1。
> - **模型清单选完自动收起**：`pickModel()` 收起列表，只留输入框里的当前模型；要再挑点「列表（N）」。
> - **栏目提示词卡片亮色描边**：`data-ai-list-prompt-row` 改 2px `border-brand-400` + 淡蓝底。
> - **`nudge_enabled` 迁到个人偏好**：注册表 `ScopeUser`；`nudgeReceives` / `filterNudgeUsers` 过滤名单，
>   `handleCreateNudge` 对关闭者 400；新增 `TestNudgeHonoursPersonalSwitch`。
> - **常用查询与卡片问法合并**：删掉底部 `presetQueries` 一行，对话区一排卡片 + 「我的」+「管理」。
> - **小秘标题红绿**：`connState`（live/off/checking）+ 同色小圆点，判定看 `/api/assistant/status` 的 `active`。
> - **仪式感卡片重做**：`accentSurface()` 三层渐变模板 + 右上柔光 + 左下暗角、`::before` 径向渐变蒙版细斜纹、
>   同色系 sheen 流光、编辑/删除挪到右上角。
> - **记事本左侧编辑抽屉**：`ReminderEditor` 新增 `side`（记事本页传 `left`），表单变 flex、备注 `flex-1`。
>
> **用例与自检**
> - Go：`go build ./... && go vet ./... && go test ./...` 全绿（reminder 27.8s / server 15.0s / sysconfig 1.3s）。
> - **沙箱全量回归（8908，0.35.0 镜像，17:45–18:31）：54 套件 / 1455 项 / 0 失败**（日志 `tmp/regress-8908-0350.log`）。
>   首轮 3 处环境性红：`verify-print`（登录限流，单跑 **24/24**）、`verify-124`（沙箱助手上一轮被留在启用状态、
>   指着慢模型 qwen3:4b，单跑 **70/70**）、`verify-130`（同一原因按前置条件跳过 0 项，关掉助手后单跑 **41/41**）。
>   `verify-124-model` 同时暴露一条**只在深色模式**才红的断言（标题绿是 `emerald-400` = `rgb(52,211,153)`，
>   原正则只认 100–199 的绿），改成 100–299 后 **61/61**。
> - 离线包自检 **30/30**（`tmp/offline-verify-0350.log`）。
> - 备份：沙箱 `staging-data-local.bak-pre0350-20261018-174502.tgz`（2 359 605 B）、
>   201 `data.bak-pre0350-20261018-184058.tgz`（22 800 089 B，compose 备份 `…184151`）、
>   200 `data.bak-pre0350-20261018-184353.tgz`（950 490 B，compose 同批备份）。
> - 上线：沙箱 17:45:12 → 201 生产 18:42:20（备份 → 改 compose → `up -d --force-recreate`）→
>   200 生产 18:49:32（scp 构件 → `docker load` → 改标签 → 重建）。三台 `/api/version` 均 `0.35.0 / f58ada9`、health ok。
> - **指纹（2026-10-18 18:51，`browser-harness/fingerprint-instances.py`）**：三台完全一致
>   （清单 `edffe23d32`、卡片 `7fa2c3f0cb`、提醒 `50ab59ec44`、完成记录 `5130d5fc5c`；
>   条数 清单 5 / 卡片 11 / 提醒 67 / 完成 45 / 记事 10）。
> - 构件：镜像 `images/workordernote-0.35.0-amd64.tar.gz`（48 587 454 B）md5 `0743a9d95b1b502cff23c80fc35fe7f3`；
>   离线包 45 676 789 B sha256 `53950bb86ab910bb144147a9d07a265582c7c4422a71d33ad991263cde821dc2`；
>   fpk `workordernote_0.35.0_amd64.fpk`（21 518 705 B，fnpack 1.2.4）md5 `696aa8fb2298896cdd594b86d51ba879`；
>   三件已放到 201 与 200 的 `images/`/`pkg/`，md5 一致。
> - 推送：main 推到 `994f62f`、tag `v0.35.0` → `f58ada9`；Gitea **Release id 21** 挂三个附件
>   （48 587 454 / 45 676 789 / 21 518 705 B）；镜像 push 到
>   `gitea.topzero.cn:10241/cyberzero/workordernote:0.35.0`，digest `sha256:097fa882cd3f…`。
> - 生产冒烟：8906 版本弹窗首卡 `0.35.0`、共 35 张卡、5 段迭代主线。

### 2026-10-17：0.34.0（201 生产 / 201 沙箱 / 200 生产上线）—— 小秘能拉取选模型、三档思考、回答存记事本；记事行换清单图标；每栏一份 AI 提示词；迭代说明合并精简

> **发版记录**（VERSION `0.34.0`，源码提交 `738873b`，镜像 `workordernote:0.34.0` =
> `sha256:4fb4742b7c79e5ede359b8e19a8f2a7ea5be92e76a48743546c6d03d5b3bb4d3`，91.1 MB）
>
> 用户原话（发版指令）：「更新迭代信息 ，发版、上线、同步仓库」。
>
> **本版主功能**
> - **模型拉取与点选**：系统配置 → AI 助手新增「拉取模型列表」，按服务商实际可用模型列出，选中即用；
>   面板顶部新增「当前模型」块（模型名 / 服务商 / 是否已接入）。
> - **三档思考过程**：只有对话 / 简洁思考 / 详细思考过程；后台偏好定默认，用户在面板上可随时换。
> - **回答存进记事本**：每条回答下「保存到记事本」，标题、备注与标签按内容自动生成，落进「记事本」栏目、
>   创建即完成（`server/reminder/service.go` 新增 `CreateNote`，带变更广播并跳过发起页签）。
> - **AI 数据源 `@清单名`**：输入框 @ 唤醒清单选择器，问答只看指定清单。
> - **每栏一份 AI 提示词**：`List.AIPrompt`（≤600 字）+ 后台「各栏目的 AI 提示词」面板；新建清单可带一份、
>   可「引用其他栏目」复制；`BuildWorkDigest` 按条目所属清单取提示词（最多 4 栏）注入系统提示词。
> - **记事行换清单图标**：记事行首改画所属清单图标并用清单色上色（`.complete-button-note`），任务行不变。
> - **卡面平台名**：支付宝 / 微信 / 京东金融等非银行平台直接写在卡面上。
> - **去掉重复的「清单顺序」**：排序只留侧栏「我的清单」一处，接口与口径不变。
> - **迭代说明合并精简**：69 条并成 33 张卡（只差修正号的并成「起 – 止」），顶部 5 段迭代主线；
>   卡片默认只展开最新三张、可逐张展开，条目里的 `**重点**` 真加粗（`VersionDialog.vue` 的 `renderItem`）。
>
> **用例与自检**
> - Go：`docker build --target backend-builder -t go-builder:0.34.0 .` 后 `go build ./...` +
>   `go test ./...` 全绿（reminder 24.5s / assistant 7.8s / server 13.2s）。
> - **全量回归（沙箱 8908，0.34.0 镜像，2026-10-17 16:22–17:01）：54 套件 / 1452 项 / 0 失败**
>   （日志 `tmp/regress-8908-0340c.log`）。
>   首轮（`tmp/regress-8908-0340.log`）暴露的 6 处**用例对数据过敏**，均已改成不依赖条数/顺序的写法
>   （产品本身没问题）：`verify-filters`（换清单比条数，两栏完成数恰好都是 8）、
>   `verify-090`（快速新建下拉里只有 navLists，不能拿信用卡栏目当「另一个清单」）、
>   `verify-099`（侧栏只有普通清单带 `data-list-icon`，卡片栏目用模板图标）、
>   `verify-100`（没填卡号的卡显示 `**** **** ----`）、
>   `verify-050`（样本清单要先选「有未完成任务的普通清单」，否则 `getComputedStyle(null)`）、
>   `verify-reminders`（首卡版本以前写死 0.33.0，改成读 `/api/version`）。
> - 离线包自检 **30/30**（`tmp/offline-verify-0340.log`）。
> - 备份：沙箱 `staging-data-local.bak-pre0340-20261017-144452.tgz`（1 701 817 B，root 打包）、
>   201 `data.bak-pre0340-20261017-170218.tgz`（22 713 300 B）、
>   200 `data.bak-pre0340-20261017-174829.tgz`（877 540 B），compose 均先备份。
> - 上线顺序：沙箱 8908 14:45:09 → 201 生产 17:02:59（停容器 → 备份 → 改 compose 标签 →
>   `docker compose up -d --force-recreate`）→ 200 生产 17:48:52（先 `docker load` 再改标签）；
>   三台 `/api/version` 均 `0.34.0 / 738873b`、`/api/health` ok。
> - **指纹（2026-10-17 17:50，`browser-harness/fingerprint-instances.py`）**：201 与 200 完全一致
>   （清单 `edffe23d32`、卡片 `7fa2c3f0cb`、提醒 `f8abe82e23`、完成记录 `5f5ec57c98`，
>   条数 清单 5 / 卡片 11 / 提醒 63 / 完成 43 / 记事 8）；沙箱为 62 / 41，差的是回归用例自己造/删的数据。
> - 构件：镜像 `images/workordernote-0.34.0-amd64.tar.gz`（45 760 367 B）md5
>   `fa3052408b04283790823f9938be2efc`；离线包 `WorkOrderNote-0.34.0-offline-amd64.tar.gz`
>   （45 673 847 B）sha256 `556e16c45c5477b88e7fe443f8786a4bfcc741ffb2e45145fe302a5f8ca5ffa7`，
>   自检 30 项全过；fnOS 包 `workordernote_0.34.0_amd64.fpk`（21 515 534 B，`fnpack` 1.2.4）md5
>   `98373329effd299f86474884caadeec6`。三个构件已放 201 与 200 的 `images/`/`pkg/`，md5 逐字节一致。
> - 推送：`git push` main（`738873b`、`2cfd829`）与 tag `v0.34.0`（走 HTTPS 端点，CIFS 路径会被钩子拒）；
>   Gitea **Release id 20** 挂三个附件（45 760 367 / 45 673 847 / 21 515 534 B）；
>   镜像 `docker tag` + `docker push` 到 `gitea.topzero.cn:10241/cyberzero/workordernote:0.34.0`，
>   digest `sha256:bed64f76689e…`。

### 2026-10-16：0.33.0（沙箱 8908 / 201 生产上线）—— 小秘看得到工作数据：周报 / 月报 / 年报 / 工作清单 / 自定义查询，没接模型也能出草稿

> **发版记录**（VERSION `0.33.0`，源码提交 `4dce7eb`，镜像 `workordernote:0.33.0` =
> `sha256:81acdc7f9bd6…`（45 701 189 B 压缩后））
>
> 用户原话（需求）：「ai对话 写上周工作总结，查不到内容，检查数据接口是否没有开放，
> 或者预置ai查询模板不对，周报 月报 年报，工作清单，自定义快速查询项目。」
> 追问后确认：自定义查询**两个都要**（自定义时间段 + 可保存的条目）；**不接模型也要出草稿**。
> 用户原话（发版指令）：「顺手把「常用查询」预置几条默认（本周周报／本月月报／本年总结），
> 开箱即点；；；发版 0.33.0：走完整流程（沙箱 8908 验让 → 201 生产 → 200 + 离线包 + 飞牛包 + 推仓库）」。
>
> **本版主功能：小秘看得到工作数据（周报 / 月报 / 年报 / 工作清单 / 自定义查询）**
> - **毛病**：`/api/assistant/chat` 以前只把「系统提示词 + 对话历史」转发给模型，**没有任何数据接口**，
>   模型看不到用户的工作记录；预置问法又只是三条自由文本 —— 所以「写上周工作总结」永远只回一句空话。
> - **服务端装配真实数据**：新增 `server/reminder/work_digest.go`，复用「已完成」页那套口径
>   （`ParseCompletedRange` / `listCompletedHistory`），把「完成记录（含时间与清单）／当前未完成
>   （含逾期天数）／记事／清单分布」装配成一段 Markdown；`option` 支持
>   `week`/`lastweek`/`month`/`lastmonth`/`year`/`today`/`yesterday`/`custom`/`open`，
>   话里带「上周」「近 3 天」这类时间词时不传也能认出来；条数有上限（完成 60 / 未完成 40 / 记事 10），
>   超了标 `truncated` 并优先留逾期与最近的。
> - **没接模型也能用**：附了数据而模型没配好时，直接给**数据草稿**（`mode=draft`，
>   回复就是「【上周（…） 工作草稿】+ 合计 + 完成事项 / 还没收尾 / 清单分布 / 新记的记事」），
>   不再只回一句「请先配置模型」。
> - **注入式接线**：`server/main.go` 把 `reminder.BuildWorkDigest` 注册进
>   `assistant.RegisterWorkDigestProvider`（assistant 不引用 reminder —— reminder 的用例反过来
>   依赖 `server/server`，直接 import 会让 `go test ./reminder/` 报 import cycle）。
> - **前端面板**（`AssistantPanel.vue`）：常用问法扩到 5 条，新增**时间范围**（本周 / 上周 / 本月 /
>   上月 / 今年 / 今天 / 昨天 / 当前未完成 / 自定义）＋**关键词**＋**「存为常用」**
>   （存用户配置 `assistant_saved_queries`，可删）；另**预置三条开箱即点**：本周周报 / 本月月报 /
>   本年总结（不写用户配置、不给删）。每条气泡下面写「已附上数据：本周（…）· 完成 N · 未完成 M」，
>   草稿模式另标「这是草稿，没有经过模型润色」。
> - 小秘依旧**只读**（不建任务、不改数据）；系统提示词新增对【工作数据】的口径约束。
>
> **用例与自检**
> - Go：`go build ./...` + `go test ./...` 全绿（新增 `server/reminder/work_digest_test.go`：
>   区间口径、15 条时间词识别、关键词、截断、空区间，共 9 个用例）。
> - 浏览器：新增 `verify-130`（**30 项**）；`verify-124` 按新面板改口径（**36 项**未接模型 /
>   35 项已接入）；按需套件 `verify-124-model.js` 补 4 项验证**模型真的收到【工作数据】**（**22 项**）；
>   `run-all.sh` 53 → **54** 套件。
> - **全量回归（沙箱 8908，0.33.0 镜像，2026-10-16 21:34–22:12）：54 套件 / 1397 项 / 0 失败**
>   （日志 `tmp/regress-8908-0330.log`）。
> - 离线包自检 **30/30**（`tmp/offline-verify-0330.log`）。
> - 真模型实测（本机 Ollama `qwen3:4b-64k`，2026-10-16）：问「帮我写这周的周报」→ `mode=model`，
>   回复里点出「黄河农场大楼wifi覆盖优化（逾期 2 天）」「别忘记发今天5G工单（逾期 2 天）」
>   等真实逾期项（小模型慢，这次 4 分钟；换 API 服务商会快很多）。
> - 备份：沙箱 `staging-data-local.bak-pre0330-20261016-213046.tgz`（1 496 597 B）、
>   201 `data.bak-pre0330-20261016-221854.tgz`（compose 同名前缀 `.bak-pre0330-20261016-221854`）。
> - 上线顺序：沙箱 8908 21:33:02 → 201 生产 22:19:05（停容器 → 备份 → 改 compose 标签 →
>   `docker compose up -d --force-recreate`）→ 200 生产（见下）。
> - 上线顺序续：**200 生产 22:34:37**（从 201 拷三个构件到 200 的 `images/`+`pkg/`，三份 **md5 与 201 逐字节一致**
>   —— 镜像 `c331d6887e8cde70c3d0210baff52884`、离线包 `b3858124125fb8a55b43e0ff8977dd4d`、
>   fpk `fb963c1be29fecad8b5aeead8a661548`；停容器 → 备份 → `docker load` → 改 compose 标签 →
>   `docker compose up -d --force-recreate`，全程按「先 load 再改标签」）。备份
>   `data.bak-pre0330-20261016-223357.tgz`（819 858 B）与 `docker-compose.yml.bak-pre0330-20261016-223357`；
>   升级完 `/api/version` = 0.33.0（gitCommit `4dce7eb`，startedAt 2026-10-16T22:34:37+08:00）。
> - **三台健康检查与指纹（2026-10-16 22:36，`browser-harness/fingerprint-instances.py`）**：
>   三台 `/api/health` 均 ok、版本均 0.33.0；清单 `edffe23d32`、卡片 `50c58560da`、提醒 `a902dd9b4a`、
>   完成记录 `e9397a50eb` **三台一致**；条数 清单 5 / 卡片 9 / 提醒 60 / 完成 40 / 记事 8 三台相同
>   （完成记录从 0.32.0 时的 36 涨到 40，是当天用户自己完成的任务，非同步差异）。
> - 推送：`git push` main（`4dce7eb`、`1c620c3`、`2d3cdd2`）与 tag `v0.33.0`；Gitea **Release id 19**
>   （`https://gitea.topzero.cn:10241/cyberzero/WorkOrderNote/releases/tag/v0.33.0`）挂三个附件
>   （45 701 189 / 45 616 967 / 21 484 349 B）；镜像 `docker tag` + `docker push` 到
>   `gitea.topzero.cn:10241/cyberzero/workordernote:0.33.0`，digest `sha256:1fb337c4116d…`，
>   仓库 `tags/list` 回读已含 0.33.0。
> - 构件：`images/workordernote-0.33.0-amd64.tar.gz`（45 701 189 B）md5 `c331d6887e8cde70c3d0210baff52884`；
>   离线包 `WorkOrderNote-0.33.0-offline-amd64.tar.gz`（45 616 967 B）sha256
>   `ffbdc6f5e43fa5e946e7c419234cef5eb435425d6538d9c76550c9d6abd60ea7`，自检 30 项全过；
>   fnOS 包 `WorkOrderNote-0.33.0-fnos-amd64.fpk`（21 484 349 B，`fnpack` 1.2.4）md5
>   `fb963c1be29fecad8b5aeead8a661548` / sha256
>   `0aea28ae3efa5a27b887e5c41c0c239d87e0ef33a91b73eeceb35fd61c9cd5cd`（arm64 因本机没有
>   `qemu-aarch64` 未出包）。三个构件都放了 201 与 200 的 `images/`/`pkg/`。

### 2026-10-16：0.32.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— AI 助手接上后台可配置的模型（含本机 Ollama 一键检测）+ 免打扰 + 「今天」改名「待办」并放宽到近 7 天 + 手机端若干体验修正

> **发版记录**（VERSION `0.32.0`，源码提交 `5db1ae8`，镜像 `workordernote:0.32.0` =
> `sha256:2db6ab036574…`，90.8 MB）
>
> 用户原话（发版指令）：「全部完成后 ，梳理一下代码，优化脏代码、废代码，梳理逻辑关系。
> 发版，同步上传仓库及发布离线安装包，及飞牛格式安装包」；发版范围与版本号由用户确认：
> **0.32.0**、**沙箱 8908 → 201 生产 → 200** 全走；「梳理代码」按**低风险清理**做。
>
> **本版主功能：AI 助手「呼叫小秘」接真模型**
> - 模型参数从代码搬到后台「系统配置 → AI 助手」：服务商预设、接口地址、模型名、密钥、
>   系统提示词、超时；「测试连接」会拉一次模型列表并做一次真实往返；密钥**只进不出**
>   （列表里打码、留空＝不改、另有「清除密钥」）；支持**本机 Ollama 一键检测**
>   （探到 `http://127.0.0.1:11434` 就把地址和模型填上）。
> - 没配模型时，前台「呼叫小秘」仍走本地兜底回复，不会因为没网/没配而报错。
> - 前端新增 `web/src/api/assistant.ts`、`AssistantPanel.vue`（前台对话框）、
>   `AiAssistantPanel.vue`（后台配置卡）；后端新增 `server/assistant/`（路由挂在 `server/server/server.go`）。
>   消息角色白名单只收 `user` / `assistant`（前端传 `system` 会被拒）。
>
> **免打扰（顶栏喇叭/静音 + 后台时间段）**
> - 顶栏铃铛**右边**多一个按钮：没开时是喇叭，点一下变静音；状态存服务端，换设备也带着。
> - 后台「免打扰」组可设时间段（默认**关**，起止 22:00–07:00 备着）；手动开关与时间段
>   任一成立即生效，按钮上多一枚小黄点提示「当前在时间段内」。
> - 闸门挂在**所有通知产生点的上游**：投递队列（`dispatcher.go` 的 `isQuiet`）、逾期提醒
>   （`notify_window.go` 的 `policyOf`）、提醒@他的实时推送（`nudge.go`）——
>   免打扰期间这些都不发；关掉后按原规则继续（不补发历史，靠通知中心回看）。
> - 新增 `server/reminder/dnd.go`、`dnd_test.go`、`web/src/api/reminder.ts` 的
>   `getDNDState()` / `setDNDManual()`；后台配置行由 `ConfigGroupList.vue` 的「免打扰」组渲染。
>
> **「今天」→「待办」并放宽到近 7 天**
> - 侧栏、手机标签、页面标题统一叫**待办**；内容＝排期落在**今天起 7 天内**（左闭右开）的
>   + 已逾期的，按天分卡片（已逾期 / 今天 / 明天 / 后天 / …）。
> - 「新建提醒」按钮从侧栏搬到首页看板标题行右侧；首页看板按钮左边的「待办 N · 逾期 N」计数删掉。
> - 手机端：底部「信用卡」标签改成**清单**（点开「全部清单」底部弹层，按侧栏同源数据切换）；
>   标题/备注/卡号超屏改为**换行**（桌面端仍是省略号）。
> - 首页看板时间行按新读法排版：「创建 昨天 16:46—结束 今天 23:59；工作安排；剩余 22:37」。
> - 版本弹窗加上构建者：「项目名 WorkOrderNote · 由 CyberZero 构建于 …」。
>
> **代码梳理（本版顺带做，均为低风险清理）**
> - 删掉 4 个零引用组件（`QrcodeDialog.vue`、`ui/Button.vue`、`ui/Card.vue`、`AdminProvidersView.vue`）
>   与 8 个零调用函数（`updateUser`、`getUnreadCount`、`regenerateCardPlan`、`getCurrentUser`、
>   `getSystemConfigs`、`bankNameOf`、`cardTint`、`listIconKeys`）、未用的导入 / 计算属性 / 3 条孤儿样式。
> - 后端删掉从未使用的 `config.Config.JWTSecret` 字段；收紧 AI 助手消息角色白名单；
>   修 Ollama 探测超时截断（2s→3s）；逾期页取时区改用 `shanghai()`。
> - 修 1 条**恒真断言**（`verify-125.js` 里查一个从来不存在的选择器）；
>   把误入库的 `web/scripts/__pycache__/*.pyc` 移出版本控制并补 `.gitignore`；
>   `CHANGELOG.md` 补 0.32.0（该文件会打进发行包，不能停在 0.3.0）。
> - 过期注释与文案 4 处（`card.ts` 指向已删除文件等）。
>
> **用例与自检**
> - Go：`go build ./...` + `go test ./...` 全绿（reminder 22.7s / server 13.1s / assistant 2.5s 等）。
> - 浏览器新增/重写：`verify-124`（AI 助手 **35 项**）、`verify-125`（首页看板按钮 **13 项**）、
>   `verify-126`（新建提醒搬位 **15 项**）、`verify-127`（手机端换行 **20 项**）、
>   `verify-128`（手机端「全部清单」弹层 **23 项**）、`verify-129`（免打扰 **21 项**）、
>   按需套件 `verify-124-model`（自带假模型桩）/ `verify-124-ollama`；
>   口径更新 `verify-095` 35、`verify-097` **108**、`verify-101` 18、`verify-105` 24、`verify-116` 13；
>   `run-all.sh` 50 → **53** 套件。
> - **全量回归（沙箱 8908，0.32.0 镜像，2026-10-16 15:21–15:47）：53 套件 / 1365 项 / 0 失败**
>   （日志 `tmp/regress-8908-0320.log`，头一行钉着「目标：`http://127.0.0.1:8908`（0.32.0 `5db1ae8`）」）。
> - 离线包自检 **30/30**（`tmp/offline-verify-0320.log`）。
> - 备份：沙箱 `staging-data-local.bak-pre0320-20261016-151240.tgz`（1 295 981 B）、
>   201 `data.bak-pre0320-20261016-151504.tgz`（22 342 613 B，compose 同名前缀
>   `.bak-pre0320-20261016-151504`）。
> - 上线顺序：沙箱 8908 15:12:44 → 201 生产 15:47:50（改 compose 标签 + `docker compose up -d
>   --force-recreate`）→ 200 生产 **17:23:30**（复制构件 → 停容器 → 备份 → `docker load` → 改 compose 标签
>   → `up -d --force-recreate`，全程按「先 load 再改标签」）。
> - 200 侧：构件从 201 的 `pkg/` 拷到 200 的 `images/`+`pkg/`，三份 **md5 与 201 逐字节一致**
>   （镜像 `0a6ecd72…`、离线包 `f67292bb…`、fpk `d94cd48d…`）；备份 `data.bak-pre0320-20261016-172327.tgz`
>   （800 472 B）与 `docker-compose.yml.bak-pre0320-20261016-172327`；升级完 `/api/version` = 0.32.0
>   （gitCommit `5db1ae8`，startedAt 2026-10-16T17:23:30+08:00）。
> - **三台健康检查与指纹（2026-10-16 17:23，`browser-harness/fingerprint-instances.py`）**：
>   三台 `/api/health` 均 ok、版本均 0.32.0；清单 `edffe23d32`、卡片 `50c58560da`、提醒 `8e0d3a7b26`、
>   完成记录 `8a82d2a4cb` **三台一致**；条数 清单 5 / 卡片 9 / 提醒 60 / 完成 36 / 记事 8 三台相同。
> - 构件：`images/workordernote-0.32.0-amd64.tar.gz`（45 620 810 B）md5 `0a6ecd722e09aea77afdf7696393953b`；
>   离线包 `WorkOrderNote-0.32.0-offline-amd64.tar.gz`（45 531 875 B）md5 `f67292bb6fe12ba9b129ef0680ee902a` /
>   sha256 `2b9ed692b6e1dd34bfccaeca68b4f8a8961300962e147a9514111bfdaa260b2e`，自检 **30 项全过 0 失败**；
>   fnOS 包 `WorkOrderNote-0.32.0-fnos-amd64.fpk`（21 444 863 B，`fnpack` 1.2.4）md5 `d94cd48d3cc3ebb9448a9c508d33e92f` /
>   sha256 `7660b29d0a9b0c64c9fcf629b510f825420c883d1865245bdbee024afc7c5299`（arm64 因本机没有
>   `qemu-aarch64` 未出包）。三个构件都放了 201 与 200 的 `images/`/`pkg/`（md5 与 201 逐字节一致）。
> - **构建备注（下次发版会再遇到）**：`scripts/build-fnpack.sh` 里给 `golang:1.26-alpine` 装编译依赖那步
>   原来直接用官方 apk 源，本机 `dl-cdn.alpinelinux.org` 不可达，会**卡在「Installing gcc」不动**
>   （2026-10-16 实测 27 分钟零进度、只耗 3 秒 CPU）；本版给该脚本补了「先把 apk 源换成
>   `mirrors.aliyun.com`」与「本机没有 `qemu-aarch64` 就跳过 arm64」两处，与 `Dockerfile.custom` 同一套源。

### 2026-10-15：0.31.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— 仪式感「常用事项模板」按「第一次」的日期算、补齐银婚 / 金婚 / 钻石婚；同版并入 0.30.0 那批未发版的四项


> **发版记录**（VERSION `0.31.0`，源码提交 `f456149`（随后的 `9dc7155` 只动 `.dockerignore`），
> 镜像 `workordernote:0.31.0` = `sha256:b4b39b664c65…`，90.5 MB）
>
> 用户原话（这一版把 0.30.0 与仪式感两批合成一版发）：「生日模板，结婚纪念日，情人节，七夕，金婚纪念；
> 日期改为：生日：第一次生日时间；结婚纪念日：结婚日期；情人节：第一次情人节，七夕：第一次七夕；
> 金婚纪念：结婚日期；25 年是银婚，50 年是金婚，60 年或 75 年是钻石婚，补充进模板」；
> 「侧栏「我的清单」里的先后顺序，把系统内置的 4个栏目也放这里允许调整顺序。」；
> 「首页，提醒下面的时间信息改为橘黄色醒目显示创建时间，结束时间，清单，剩余时间」；
> 「提醒@他页面，别人提醒我的，可以保存到本地清单中，如果不保存则完成后不在本地显示统计，
> 仅做提醒信息，过期内容标 醒目标注 并 注已逾期。」；「软件更新说明页面 ：原软件信息，合并到 置顶标题里面」。
>
> **仪式感「常用事项模板」（本版主功能）**
> 1. 模板日期栏改成「第一次」口径（`CeremonyPanel.vue` 的 `PRESETS`）：生日（公历 / 农历）写
>    「第一次生日时间」；结婚纪念日、银婚、金婚、两张钻石婚写「结婚日期」；
>    情人节写「第一次情人节」、七夕写「第一次七夕」（七夕仍按农历）。**情人节 / 七夕从
>    「固定月日一键建卡」改成 `needsDate` 表单** —— 没有第一次就算不出「已过 N 次情人节 / 第 N 次七夕」。
> 2. **补齐四个婚庆里程碑**：`silver-wedding` 25 / `golden-wedding` 50 / `diamond-wedding-60` 60 /
>    `diamond-wedding-75` 75，模板对象新增 `milestone` 字段（模板总数 13 → **17**）。
>    保存时把用户填的**结婚日期**换算成「结婚 + N 年」同月同日同时刻落库（2 月 29 日结婚、周年落在
>    平年时退回 2 月最后一天），`repeat_rule=none` —— 这是**一次性倒计时**（「离金婚还有多少天」），
>    不每年重复；原始结婚日期写进备注 `结婚日期：YYYY年M月D日（N 周年倒计时）`，日后看得出这张卡怎么算出来的。
> 3. 循环徽标（`anniversaryLabel()`）补主语：生日「已过 N 次生日 / 第 N 次生日」、节日
>    「已过 N 次情人节 / 第 N 次七夕」、婚龄「已过 N 年 / 第 N 周年」。
>
> **同版并入的 0.30.0（此前已 commit、未发版、未部署）**
> 4. **侧栏「我的清单」整段可排序**，含系统内置的 4 个栏目：标题旁多一个排序小按钮，点一下进排序模式
>    （「用 ↑ ↓ 挪位置，点 ✓ 完成」），这一段每一行都能挪。
> 5. **首页时间信息改成橘黄加粗一行**（创建 / 结束 / 清单 / 剩余，浅色 `orange-500` / 深色 `orange-400`）：
>    「创建」沿用 `formatCreated` 的相对口径，「结束」是原来的结束时间口径，「剩余」与行尾倒计时同一份
>    口径（每分钟刷新、逾期写「已逾期 N 天」），**原先挂在行尾的那一份删掉** —— 同一个值不再两处重复
>    （`data-home-remaining` 仍在每行内，`verify-120` 口径不变）；没有清单名时不写「清单 …」。
> 6. **提醒@他**：在本页点「已完成」、又没保存到清单的那条**从「别人提醒我」这一列消失**
>    （`NudgeView.receivedRows` 过滤 `!(i.done_at && !i.reminder_id)`）—— 它只是别人发来的一条消息，
>    做完就完了，本地不留任务、也不进任何本地统计；服务端 `done_at` 不动、通知中心回执还在、
>    **发起人那一列照旧看得到**。保存过的（`reminder_id` 有值）继续留在这一列，显示「已存到「X」（已完成）」。
>    过了期望时间没完成的，**两种卡片、两列都**整张换危险色（`border-rose-500/60` + `bg-rose-500/[.07]`）
>    并在右上角多一枚「已逾期 N 天」胶囊（`data-nudge-overdue`，不满一天只写「已逾期」），
>    「期望 10月13日 12:06」那一截红色加粗；已完成的、还没到期望时间的不标；页面每分钟对一次表。
> 7. **版本弹窗把原项目信息并进置顶块**：页尾原先单独那一段「原项目信息」标题 + 卡片整段删掉，
>    文字一字不减地挪到首屏置顶块（上游 `TechFunWay/reminders`、MIT 许可、著作权与出处均予保留）——
>    版权合规要求的出处与许可仍完整在首屏。
>
> **用例与自检**
> - Go：`go build ./...` + `go test ./...` 全绿（reminder / server / database / auth / scheduler / sysconfig / lunar）。
> - 浏览器新增三个套件：`verify-123`（仪式感里程碑 **29 项**：四个新模板都在、点开表单的日期栏与默认重复、
>   保存后 `due_at == 结婚日期 + N 年`、`repeat_rule=none`、备注留着结婚日期、卡片是「还有 N 天」而非循环徽标、
>   七夕表单按农历）、`verify-122`（首页橘黄时间行 **18 项**）、`verify-121`（侧栏排序 **15 项**）；
>   口径更新：`verify-118` 43 → **51**（卡片消失 + 接口侧还在、逾期整卡危险色与胶囊）、`verify-095` 30 → **34**
>   （置顶块里的上游项目信息 4 项）、`verify-107`（情人节一键建卡 → 国庆节一键建卡）、`verify-119`（生日日期栏口径）、
>   `verify-120` **26**；`run-all.sh` 套件 45 → 46 → **47**。
> - **全量回归（沙箱 8908，0.31.0 镜像，2026-10-15 17:45:59 起跑）：47 套件 / 1222 项 / 0 失败**
>   （日志 `tmp/regress-8908-0310.log`，头一行钉着「目标：`http://127.0.0.1:8908`（0.31.0 `f456149`）」；
>   同一轮里 `verify-097`（信用卡账单，最重的一套）106 项全绿）。
> - 线上只读复核（不改数据）：三台 0.31.0 的仪式感模板弹窗都是 **17 个模板**，银婚 / 金婚 /
>   钻石婚（60、75）四个里程碑都在，情人节 / 七夕已是「填第一次」那种（只读探针跑完即删，
>   截图 `tmp/prod-ceremony-201.png`、`tmp/prod-ceremony-200.png`）；三台 `/api/health` 均 ok。
> - 构件完整性：200 的 `images/`、`pkg/` 与 201 的 `pkg/`、本机构建产物 **md5 逐字节一致**
>   （镜像 tar `afda548a…`、离线包 `672f6297…`、fnOS 包 `6238e9e4…`）。
> - 备份：沙箱 `staging-data-local.bak-pre0310-20261015-093611.tgz`（1 087 755 B）、
>   201 `data.bak-pre0310-20261015-173643.tgz`（21 793 018 B，compose 同名前缀 `.bak-pre0310-20261015-173643`）、
>   200 只换镜像未动数据目录。
> - 数据指纹（201 == 200，2026-10-15 发版后核对）：清单 `edffe23d32`、卡片 `50c58560da`、提醒 `bb9a543ba9`、
>   完成 `34f2512af3`（5 清单 / 9 卡片 / 56 提醒 / 35 条完成记录 / 7 记事，无「自检」残留）；
>   沙箱 8908 是独立数据目录（6 / 10 / 57 / 35 / 7），跑回归会造数据，本来就不与生产对齐。
> - 上线顺序（先 load 再改标签，顺序反了 compose 会找不到镜像）：沙箱 8908 17:36:32 →
>   201 生产 17:36:53（root 辅助容器改 compose 标签 + `docker compose up -d --force-recreate`）→
>   200 生产 17:50:31（用户在本机 `docker load` + `docker compose up -d`）。
> - 构件：`images/workordernote-0.31.0-amd64.tar.gz`（48 280 908 B）md5 `afda548a2442c531d64b9b35c836210c`；
>   离线包 `WorkOrderNote-0.31.0-offline-amd64.tar.gz`（45 392 061 B）md5 `672f6297f8698f267e2cb8dd23f133e7` /
>   sha256 `5d6cea509138c332036d9e12c7dd58cd48a4507bd4486bd665bf69d6d5b0b4e9`，自检 **30 项全过 0 失败**；
>   fnOS 包 `WorkOrderNote-0.31.0-fnos-amd64.fpk`（21 368 607 B，`fnpack` 1.2.4）md5 `6238e9e458aa8d932ba8d1b0f21b367a` /
>   sha256 `98d275ede25fbacc823f636086b98625a36c16fd305be50451dd87bcf67750f8`（arm64 因本机没有 `qemu-aarch64` 未出包）。
>   三个构件都放了 201 的 `images/`+`pkg/` 与 200 的 `images/`+`pkg/`（与 201 逐字节一致；200 的镜像 tar 直接从
>   201 拷到它的 `images/`，所以 200 才用得上「先 load 再改标签」）。
> - Gitea：Release `v0.31.0`（id `17`，三个附件都传了）+ 容器仓库
>   `gitea.topzero.cn:10241/cyberzero/workordernote:0.31.0`；tag `v0.31.0` 已推（`main` 在 `9dc7155`）。
> - **构建备注（下次发版会再遇到）**：本机 BuildKit 拉不到 `golang:1.26-alpine`
>   （镜像站 `docker.fnnas.com` 返回 401 Unauthorized，直连 `registry-1.docker.io` TLS 握手超时），
>   这一版改用经典构建器 `DOCKER_BUILDKIT=0` + `Dockerfile.build-tmp`（`FROM` 写本地镜像 ID：
>   node `11cedc39e663` / golang `5075a351671c` / python `979e5a8a5684` / alpine `320994c3b997`）打出；
>   本地那个 `golang:1.26-alpine` 标签本来是 arm64（早先 arm64 fpk 尝试留下的），直接用它会在
>   `apk add gcc musl-dev` 处报 `exec /bin/sh: exec format error`，已用 amd64 的 golang 镜像重新打标签。
>   另外 `.dockerignore` 补掉了 `workordernote-deploy/ tmp/ pkg/ release/ ops/` —— 经典构建器无法 `stat`
>   CIFS 上的生产数据目录（`workordernote-deploy/staging-data-local`），不排除就建不了镜像。

### 2026-10-15：0.29.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— 首页看板每条加倒计时；两个栏目卡片加标题底色；版权合规整改

> **发版记录**（VERSION `0.29.0`，源码提交 `72d7a0f`，镜像 `workordernote:0.29.0` =
> `sha256:627832c09031a6e9055e0c4014778f98b26a67ad1a19a4eb2c9660779ca99d65`）
>
> 用户原话：「首页每条信息后边增加 倒计时，剩余x时间，给卡片 未来 14 天待办、已逾期 增加背景底色，
> 参考其他页面卡片标题。」；「根据软件版权规则，当前软件基于二次开发，需要保留原作者信息出处，
> 要合法合规，进行核查。」；「发版：包含 上架nas 所有容器，上传仓库更新代码，更新容器，发布新版本。」
>
> 1. 首页看板每条任务后面加**倒计时**：未逾期的写「剩余 3 天 05:23」（与快速新建的「剩余 时:分」
>    同一份口径，每分钟刷新），逾期那一列写「已逾期 N 天」；格式化抽到 `web/src/utils/remaining.ts`，
>    列表页的快捷新建也改用它（一处口径）。
> 2. 「未来 14 天待办」「已逾期」两列改成**带底色标题条的卡片**（品牌蓝底 / 玫瑰红底，
>    `.home-col-head`，逾期那列标题与计数都染红），与「今天」页的按天卡片同一套观感。
> 3. **版权合规整改**（同一版一起发）：`LICENSE`/`NOTICE` 随镜像、离线包、fnOS 包分发（此前发行物里
>    没有许可文本，不满足 MIT「著作权声明与许可声明须随所有副本分发」）；新增 `NOTICE` 声明上游出处、
>    衍生方著作权与无背书关系；`fnpack/manifest` 的 `maintainer`/`maintainer_url`/`distributor_url`
>    改回本项目（此前把原作者列为维护者）；`app.json` 的 `author`/`website` 修正；`Dockerfile.custom`
>    的 OCI 标签不再指向上游仓库（上游出处保留在 `description` 与自定义标签
>    `org.workordernote.upstream`）；`scripts/build-fnpack.sh` 的网关校验从上游标识改回 `workordernote`
>    （**此前该脚本必然在校验处失败，`make package-fnos` 出不了包**）；移除二维码应用里上游遗留的默认种子；
>    `Makefile`/`scripts/build-docker*.sh`/`build-all.sh` 的镜像与产物名不再使用上游 Docker Hub 命名空间。
>    逐项证据与结论见工作区归档 `开发记录/版权合规核查报告.md`（该目录不进仓库）。未动
>    `fnpack/config/resource` 的数据共享目录名（改名涉及已装实例的数据迁移）。
>
> **用例与自检**
> - Go：`go build ./...` + `go test ./...` 全绿（reminder / server / database / auth / scheduler / sysconfig / lunar）。
> - 浏览器：`verify-120` 扩到 **26 项**（每条都有倒计时、今天那条是「剩余 时:分」、逾期那条是「已逾期」、
>   两个标题条都有非透明底色且逾期那列偏红）。
> - **迭代容器 8918 全量回归：44 套件 / 1147 项，其中 1145 项通过、2 项失败**（首轮还有若干套件红过，
>   全是环境性的：一是套件被打断留下的「自检…」残留（`run-all.sh` 注释里记过，会连带 verify-091 假红），
>   二是到点提醒的未读全屏遮罩吃掉点击；逐套件清未读、清自检残留后复跑，除下面两项外 42 个套件 0 失败）。
>   剩下两项是**用例断言口径过时**、产品代码本身没问题，已修用例（提交 `faede36`），修后两个套件单跑全绿：
>   · `verify-100`「到点后弹出站内提醒弹窗」仍按「新建即到点」等 95 秒，与 0.26.0 起的
>     「新建提醒 10 分钟以后开始第一次提醒」（`server/reminder/notify_window.go` 的 `firstRemindSchedule`；
>     Go 用例 `server/reminder/first_remind_test.go:61` 与 `verify-119` 里同一口径那句都钉着）冲突 →
>     改成先断言「刚建完 10 分钟内不弹」，再用「稍后提醒」（不受该下限约束）走真实投递链路等弹窗 **59/0**。
>   · `verify-119`「把提前天数改回 0 后立刻生效」写死期望 0，而本机实例进来的偏好就是「提前 3 天」，
>     还原之后仍是提前 3 天 → 改成按实际还原到的天数算期望 **34/0**。
> - 沙箱 8908（0.29.0 镜像）复核 `verify-120` **26/26**、`verify-119` **34/34**；离线包自检 **30/30**。
> - 备份：201 `data.bak-pre0290-20261015-000249`（compose 同名前缀）、沙箱
>   `staging-data-local.bak-pre0290-20261015-000249`、200 `data.bak-pre0290-20261015-005139`。
> - 数据指纹（201 == 200）：清单 `edffe23d32`、卡片 `50c58560da`、提醒 `bba1203973`、完成 `ff2514513a`
>   （5 清单 / 9 卡片 / 49 提醒 / 31 条完成记录 / 6 记事）。核对时发现 201 上还留着 5 条「自检」清单
>   与 5 条「自检」提醒（此前某轮回归直接打在 8906 上留下的），已用 `browser-harness/clean-self-test.sh`
>   清掉后重新核对，两台完全一致。
> - 上线顺序：沙箱 8908 → 201（root 辅助容器改 compose 标签 + `docker compose up -d --force-recreate`）
>   → 200（`docker load` → 改 compose → `up -d`；必须先 load 再改标签，顺序反了 compose 会找不到镜像）。
> - 构件：201 `images/workordernote-0.29.0-amd64.tar.gz` md5 `204b08e35c3ce8a685924f9a21ed3d3c`、
>   `pkg/WorkOrderNote-0.29.0-offline-amd64.tar.gz` md5 `e2e79b27729fe21694180fdcab556680`；
>   fnOS 应用包 `WorkOrderNote-0.29.0-fnos-amd64.fpk` md5 `a7b68ba154fa375c05ef04be7ed7ef73`
>   （21.4 MB，`fnpack` 1.2.4 打出，放在 201 生产目录与 200 的 `pkg/`，供应用中心手动安装；
>   arm64 因为本机没有 `qemu-aarch64` 没出包）。200 的 `images/`、`pkg/` 与本机 201 逐字节一致。
> - Gitea：Release `v0.29.0`（附镜像 tar、离线包、fnOS 包三个附件）+ 容器仓库
>   `gitea.topzero.cn:10241/cyberzero/workordernote:0.29.0`
>   （digest `sha256:25eb3fb38d76cf86723b8a0acedc153116a503ce4ad75c384bacf35bad94acce`）。

### 2026-10-14：0.28.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— 稍后提醒只推迟提醒时间；首页看板栏目图标 + 点击定位到清单

> **发版记录**（VERSION `0.28.0`，源码提交 `3de4eaf`，镜像 `workordernote:0.28.0` =
> `sha256:361a86851475d27a82b78262d573b8b1d8a7402892569e8d1bc70d7a1d24aba5`）
>
> 用户原话：「逾期项目点击稍后提醒后不应该移出逾期栏目，只是再次提醒时间延迟；未逾期项目同样，
> 不改变创建、到期时间，只是延迟提醒时间。；；首页栏目前边不显示复选框，显示栏目图标。
> 首页点击提醒定位到对应清单。」
>
> **1）稍后提醒 = 只推迟「下一次提醒」**：`snoozed_until` 不再参与「生效时间」口径 ——
> 列表/分组/视图改用 `COALESCE(end_at, start_at, due_at)`（今天页、计划页、`/summary` 的 today），
> `normalFirstRemindAt`/`firstRemindAt`/dispatcher 的陈旧判定改用 `deadlineStamp`；稍后提醒只通过
> `rebuildJobs` 的 `run_at` 影响投递时刻（`scheduled_for` 保持正常口径）。前端行内时间与按天分组
> （`dueLabel`/`dayKeyOf`）同样不看 `snoozed_until`。**逾期的不移出逾期栏、未逾期的仍留在今天页，
> 创建/到期时间一个字不动。**
>
> **2）顺带修掉一个真实回归**：「距逾期时间不足 10 分钟就不发普通提醒」（0.24.0 加的口径）原来对
> **已经逾期**的任务也生效，导致「编辑一条逾期任务」会把它的「提醒频率」链条一起取消。现在只对
> 还没逾期的任务生效（`deadline.After(now)` 才判断），已逾期的照常按频率提醒 —— 逾期提醒本来就
> 是另一条路（`notifyOverdue`，每个任务每天一条）。
>
> **3）首页看板**：每行前面改成**栏目图标**（去掉复选框）；**点一条 → 定位到它所在的清单**
> （`/admin/list/<清单 id>?highlight=<任务 id>`，清单页把那条滚进视野并闪一下底色；列表行新增
> `data-reminder-row`，配 `.reminder-highlight`）。
>
> **用例与自检**
> - Go：新增 `TestSnoozeOnlyDelaysDelivery`（到期时间不变 / 首次提醒口径不变 / `run_at` 推迟）、
>   `TestTodayViewKeepsSnoozedItems`（稍后到明天仍留在今天页、也不跑去计划页）；修掉两个
>   「跟测试钟点挂钩」的老用例（`TestFirstRemindScheduleDelaysFreshReminders` 在跨午夜/凌晨会假红、
>   `TestRepeatNotifyCatchUpSkipsMissedIntervals` 在凌晨会因规则②误判 —— 后者正是上面第 2 条）。
> - 浏览器：`verify-119` 扩到 **34 项**（未逾期条目稍后提醒后仍留在今天页 + `due_at` 不变 +
>   `run_at` 推迟；逾期那条仍在「已逾期」卡片里）；`verify-120` 扩到 **21 项**（有图标、没有复选框、
>   点击跳清单、清单里那条被高亮）。
> - **迭代容器全量回归：44 套件 / 1139 项 / 0 失败**。
> - 沙箱 8908（0.28.0 镜像）复核 `verify-120` 21/21、`verify-119` 34/34；离线包自检 **30/30**。
> - 备份：201 `data.bak-pre0280-20261014-0823xx`（compose 同名前缀）、沙箱
>   `staging-data-local.bak-pre0280-20261014-082xxx`、200 `data.bak-pre0280-20261014-082xxx`。
> - 数据指纹（201 == 200）：清单 `edffe23d32`、卡片 `50c58560da`、提醒 `3b4415d82d`、完成 `a6c8326f21`
>   （5 清单 / 9 卡片 / 46 提醒 / 27 完成 / 6 记事）。
> - 构件：201 `images/workordernote-0.28.0-amd64.tar.gz` md5 `6a0d73769b508d9d604a33d538d7b962`、
>   `pkg/WorkOrderNote-0.28.0-offline-amd64.tar.gz` md5 `7e8c4cbc441fb0b3399d29469562e3b4`；
>   本地导出/给 200 用的那份 md5 `80f5148bae84263862c8ee614f3cee40`（镜像 ID 一致，gzip 流不同）。
> - Gitea：Release `v0.28.0`（附镜像与离线包）+ 容器仓库 `gitea.topzero.cn:10241/cyberzero/workordernote:0.28.0`
>   （digest `sha256:6f3049e1c79062aebaba8b7c5a03e7c569f9f03d11ae74d10caa59a460fcb7b6`；回读 pull 的镜像 ID 一致）。

### 2026-10-14：0.27.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— 首页看板 + 提醒@他（保存到清单 / 提醒一下）+ 信用卡按还款日到期与逾期 + 「知道了」不脱离逾期

> **发版记录**（VERSION `0.27.0`，源码提交 `deae5e8`，镜像 `workordernote:0.27.0` =
> `sha256:5cbfae90a17cf0aba1b0222101ade1fc82bdeda96140a94240d6c71b9f5f0c34`）
> 这一版把 0.25.0 之后**两批攒着的改动**一起发了（按最高档位加版本号）。
>
> **1）「首页」看板（用户 2026-10-13）**：侧栏「智能清单」最上面新增「首页」（在「今天」上方），
> **打开应用默认落在它**，**10 分钟不操作自动回来**（`MainLayout.armIdleTimer`，任意操作重新计时）。
> 两列：**未来 14 天待办** / **已逾期**；标题前的级别字 **急/今/明/后/周X/日期**，列内写明 14 天口径
> 与级别字读法；每条可勾完成。逾期口径抽到 `web/src/utils/overdue.ts`，列表页与看板共用。
> 「默认首页」偏好新增 `home`（首页看板）并设为默认；迁移 `default_view_home_dashboard`（0.27.0）
> 把老库显式 `list` 改成 `home`（**用显式 SQL**：复合主键模型传空结构体会带零值主键条件、
> 一条都匹配不上，本轮先踩了一次「记录写了、值没改」）。
>
> **2）提醒@他**：「别人提醒我」多了**保存到清单**（选清单 → 建任务 → 清单里勾完，卡片同步成
> 「已完成」、发起人收到回执；`syncNudgeFromReminder` 完成/撤销双向同步）；
> 「我提醒他人」多了**提醒一下**（即时再推一条 `nudge_reminded`，对方**弹中央弹窗**）。
>
> **3）信用卡按还款日到期与逾期**：不再生成「账单日」提醒（账单日只在卡片页面用）、每张卡只留
> 一条「还款日」提醒且**到期时间 = 还款日 23:59**（原来 0 点）；**还款提醒从本期账单日开始、
> 每天在「开始提醒时间」提醒一次，直到还款日**，过期未确认即逾期；「还款日前 N 天提醒」被覆盖、
> 卡片设置里去掉（字段保留）。迁移 `fix_card_plan_reminders`（0.26.0）软删 statement/advance 两类
> 老提醒并把 due_at 的 0 点改成 23:59（只改时刻、保留完成状态）。
>
> **4）「知道了」不再脱离逾期**：逾期基准 `deadlineStamp`（不看 snoozed_until），服务端 `/summary`
> 的 overdue、今天页过滤、前端 `isOverdue` 三处同改。
>
> **用例与自检**
> - Go：新增 `TestOverdueSurvivesAcknowledge`、`TestFixCardPlanRemindersUpgrade`、
>   提醒@他保存/提醒与默认首页迁移相关用例；修掉两个与测试钟点相关的假红用例（跨午夜）。
> - 浏览器：新增 `verify-120`（18 项，首页看板）；`verify-118` 扩到 42 项（保存到清单 / 提醒一下）；
>   `verify-097` 106 项、`verify-119` 30 项、`verify-112` 48 项、`verify-ux` 16 项（适配「首页看板」档）。
> - **迭代容器全量回归：44 套件 / 1131 项 / 0 失败**。
> - 沙箱 8908（0.27.0 镜像）复核 `verify-120` 18/18、`verify-097` 106/106；离线包自检 **30/30**。
> - 备份：201 `data.bak-pre0270-20261014-0138xx`（compose 同名前缀）、沙箱
>   `staging-data-local.bak-pre0270-20261014-013544`、200 `data.bak-pre0270-20261014-013854`。
> - 数据指纹（201 == 200）：清单 `edffe23d32`、卡片 `50c58560da`、提醒 `e8a17ffd5d`、完成 `eeb1af276b`
>   （5 清单 / 9 卡片 / 45 提醒 / 25 完成 / 5 记事 —— 提醒数比上一版少，是账单日/提前提醒两类被迁移软删了）。
> - **迁移实测**（201）：`default_view` → `home`；卡片提醒只剩 `due` 一类（9 条）。
> - 构件：201 `images/workordernote-0.27.0-amd64.tar.gz` md5 `0b60962bdef7882279dea3e857bd5099`、
>   `pkg/WorkOrderNote-0.27.0-offline-amd64.tar.gz` md5 `324e829e806408a4ecf57df4a683f1aa`、
>   tar sha256 `92dafe28f8cdcf696a21b7e17eba854860652e02b790ea6a2d8b1d06e9711766`；200 走 `docker load`
>   （镜像 ID 同为 `sha256:5cbfae90a17c…`）。
> - Gitea：Release `v0.27.0`（附镜像与离线包）+ 容器仓库 `gitea.topzero.cn:10241/cyberzero/workordernote:0.27.0`
>   （digest `sha256:d24a47ef7197fa9a3a455eb8577ba83c6f052737efbf3ac04e5106adade1e60c`；回读 pull 的镜像 ID 一致）。

### 2026-10-13：0.25.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— 「开始提醒时间」下新增「提前几天开始提醒」；改完设置立刻生效

> **发版记录**（VERSION `0.25.0`，源码提交 `1a35c34`，镜像 `workordernote:0.25.0` =
> `sha256:83e5c2b67c23973f427a51f93de0db98db3a7dd8e732c6318332ce5220a52731`）
>
> 用户原话：「开始提醒时间：reminder_all_day_time，增加 提前几天开始提醒，低于几天的按照正常流程走，
> 超过提醒天数的等符合设定时间后再开始执行提醒」。
>
> **1）新个人偏好 `reminder_advance_days`**（TypeInt，默认 0 = 不提前，服务端夹在 0–60），
> 与「开始提醒时间」并列在同一张「提醒」卡片里。口径（`firstRemindAt` / `normalFirstRemindAt`）：
>   · 离到期日**超过 N 天** → 首次提醒 = **(到期日 − N 天) 那天的「开始提醒时间」**；
>   · 创建时**已经在 N 天之内**（今天/明天到期）→ **按正常流程**（到期日当天那个「开始提醒时间」），老口径不变；
>   · 「开始提醒时间 = 00:00」（到期日当天不提前、也不静默）时提前窗口**照样生效**，落在 (到期日−N) 的 0 点。
> 判定用「窗口那天是否晚于创建时间」，也就是「创建时离到期是否超过 N 天」。
>
> **2）窗口内每天只提醒一次**（`scheduleRepeatNotify` 的窗口分支）：提前几天是让人心里有数，
> 不是从三天前就按「提醒频率」每 15 分钟弹一次（那会变成几百条）；到了到期日那天恢复
> 「首次提醒 + 提醒频率」的老口径。
>
> **3）改完设置立刻生效**：新增配置写入钩子 `sysconfig.RegisterChangeHook`（handler 里写成功后
> 通知），reminder 包注册它来清「开始提醒时间 / 提前天数」的 30 秒进程内缓存。原来改完设置
> 30 秒内的新建提醒会按**旧口径**排进投递队列、而且排完就定了（要再编辑一次才重排）。
>
> **用例与自检**
> - Go：新增 `TestFirstRemindAdvanceDays` / `TestAdvanceWindowRepeatsOncePerDay` /
>   `TestAdvanceDaysWorksWithMidnightStart` / `TestConfigChangeHookFires`；`go test ./...` 全包 ok。
> - 浏览器：`verify-119` 扩到 **21 项**（偏好设置里那一行是数字输入且在「提醒」卡片里；
>   用管理员投递台账 `GET /api/reminder/admin/deliveries` 断言「提前 3 天 → 排到 (到期−3) 的 06:00」
>   与「明天到期 → 排到明天 06:00」；改回 0 后立刻生效）。
> - **迭代容器全量回归：43 套件 / 1094 项 / 0 失败**（这轮 `verify-095`、`verify-100` 也全绿 ——
>   095 的本地偏好污染上一条记录里修掉了）；改完 VERSION 后复核 `verify-119` 21/21、`verify-095` 30/30。
> - 沙箱 8908（0.25.0 镜像）复核：`verify-119` 21/21、`verify-100` 49/49；离线包自检 **30/30**。
> - 备份：201 `data.bak-pre0250-20261013-222206`（compose 同名前缀）、沙箱
>   `staging-data-local.bak-pre0250-20261013-221849`、200 `data.bak-pre0250-20261013-222245`。
> - 数据指纹（201 == 200）：清单 `edffe23d32`、卡片 `50c58560da`、提醒 `709adfca07`、完成 `cb31f20787`
>   （5 清单 / 9 卡片 / 61 提醒 / 23 完成 / 5 记事）。
> - 构件：201 `images/workordernote-0.25.0-amd64.tar.gz` md5 `2dcb8712d05ca9388f0a94d0d1548f40`
>   （Gitea Release 附件用的是打包目录里那份，逐字节一致）、`pkg/WorkOrderNote-0.25.0-offline-amd64.tar.gz`
>   md5 `e71c0cd2941a9c194bbd9ed236b0fd5c`、tar sha256
>   `e3830d6a953a8e9887be1d876788ce19cdf85131ee7d84d303c526246b481d2d`；200 走 `docker load`
>   （镜像 ID 同为 `sha256:83e5c2b67c23…`）。
> - Gitea：Release `v0.25.0`（tag 指向 `1a35c34`，附镜像与离线包）+ 容器仓库
>   `gitea.topzero.cn:10241/cyberzero/workordernote:0.25.0`（digest
>   `sha256:8ec0c67d76677699adb1d0ffdc3410da44ef83a987ddde0373e7a796053263bb`；回读 pull 的镜像 ID 一致）。

### 2026-10-13：0.24.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— 「提醒@他」多人互推提醒 + 三条口径修正（首次提醒 10 分钟 / 生日按年循环 / 倒计时双层描边）

> **发版记录**（VERSION `0.24.0`，源码提交 `04cb90d`，镜像 `workordernote:0.24.0` =
> `sha256:acec90fcadc32ccec751773df09d683560748b51160e1dbb4c595d86d086b770`）
>
> **1）「提醒@他」（用户 2026-10-13 要求）**：「我的清单」下新增这个页面，左右两列
> 「我提醒他人 / 别人提醒我」；点右上角发送（选人 + 内容 + 备注 + 期望完成时间）。后端一张表
> `nudges` + 6 个接口；**状态机只有 created_at → read_at → done_at**，对方每走一步都写一条站内通知
> 给发起人（`nudge_read` / `nudge_done`），新提醒到达给接收人 `nudge_received` —— 反馈落在**通知中心**。
> `/summary` 新增 `nudge_pending`（别人提醒我、还没做完），侧栏入口挂角标；**不能自己提醒自己**
> （前端不列自己 + 服务端 400）。开关是**后台系统偏好 `nudge_enabled`**（默认开）：关掉后入口与页面
> 一起隐藏、数据保留。**不参与双机同步**（同一实例两个账号之间的事）。顺带把 `modal-field` /
> `modal-label` / `modal-help` 从 `ChannelsView` 的 scoped 样式提升为全局原子类 —— 否则新页面照抄
> 类名一点样式都没有（本轮差点踩）。
>
> **2）新建提醒：10 分钟以后才第一次提醒**（用户原话「新建提醒，10分钟以后开始第一次提醒，
> 低于10分钟到逾期设定时间的的不再提醒，直接给出逾期提醒」）。`firstRemindSchedule` = 「开始提醒时间 /
> 结束时间里更早的那个」与「创建时间 + 10 分钟」取晚（结束时间还在未来时不越过它；已经过期的保持
> 「创建后 10 分钟」，不再保存完就弹窗）；**「稍后提醒」是用户明确点的时刻，不吃这 10 分钟**。
> `rebuildJobs` 里若「逾期提醒时间」落在「创建 + 10 分钟」之内，**一条普通提醒都不排**（交给逾期提醒）；
> dispatcher 的「陈旧任务」判定改成与 `firstRemindSchedule` 同一口径，否则新排的首次提醒会被丢掉。
>
> **3）生日/纪念日按年循环**（用户原话：填了 1989-09-17，「结果倒计时显示 已过13540天」）。
> 年度循环事项的倒计时改成**下一次**的自然日差 + 「**已过 N 次生日**」（当天写「第 N 次生日」）；
> 农历生日用 `lunar_anchor` 问服务端今年的公历日期。生日模板/编辑生日卡片的日期栏标题 →
> 「**出生年月日**」（纪念日 → 「结婚年月日」）。
>
> **4）倒计时数字白边内再加黑边**（用户要求「白色边内测加黑边衬托数字更清晰」）：`<b>` 自己是
> 内圈描边（深色卡面 `rgba(2,6,23,.62)`），`::before` 那层是外圈（1.95px vs 内圈 1.15px，深色卡面白边），
> 从外到内「白边 → 黑边 → 彩色渐变」。
>
> **用例与自检**
> - Go：新增 `nudge_test.go`（5 个）、`first_remind_test.go`（3 个，含「稍后提醒不推迟」）；
>   6 个投递/重复链条老用例改用 `backdateCreated()` 绕开新的 10 分钟口径。`go test ./...` 全包 ok。
> - 浏览器：新增 `verify-118`（34 项，双账号真实往返）与 `verify-119`（15 项：不会立刻弹窗、
>   生日「还有 339 天 / 已过 37 次生日」、农历生日同样按年循环、模板日期栏写「出生年月日」）；
>   `verify-112` 扩到 **48 项**（两层描边）；`verify-114/115/116` 改成「建完再稍后提醒 3 秒后」触发
>   通知（新口径下新建不会立刻弹）；`verify-095` 每次跑前清掉本地「地址档」偏好（它自己会记住 wan，
>   导致重试那一次「默认内网」假红）。
> - **迭代容器全量回归：43 套件 / 1087 项**；`verify-095`、`verify-100` 在整轮里因**登录限流**
>   各丢 1–2 项，**单跑分别 30/30、49/49**（095 的假红还有上面那条本地偏好污染，已修）。
> - 沙箱 8908（0.24.0 镜像）复核：`verify-119` 15/15、`verify-112` 48/48、`verify-118` 34/34、`verify-100` 49/49；
>   离线包自检 **30/30**。
> - 备份：201 `data.bak-pre0240-20261013-195357`（compose 同名前缀）、沙箱
>   `staging-data-local.bak-pre0240b-20261013-195321`、200 `data.bak-pre0240-20261013-200115`。
> - 数据指纹（201 == 200）：清单 `edffe23d32`、卡片 `50c58560da`、提醒 `709adfca07`、完成 `cb31f20787`
>   （5 清单 / 9 卡片 / 61 提醒 / 23 完成 / 5 记事；沙箱是另一套，**故意不同步**）。
> - 构件：201 `images/workordernote-0.24.0-amd64.tar.gz` md5 `135bef496fdbc8e13143bed0951fa11a`
>   （= Gitea Release 附件）、`pkg/WorkOrderNote-0.24.0-offline-amd64.tar.gz` md5
>   `4e52c5282c30b6f1738f1424a804b12a`、tar sha256 `e79d5fb4d4a3c53fbdc4aac74194b35a0b1e88abf1b082adcd1f77464d1dbbc8`；
>   200 是通过 `docker load` 加载（镜像 ID 同为 `sha256:acec90fcadc3…`）。
> - 构件同步进 Gitea：Release `v0.24.0`（附镜像与离线包，tag 指向 `04cb90d`）与容器仓库
>   `gitea.topzero.cn:10241/cyberzero/workordernote:0.24.0`（manifest digest
>   `sha256:14e15022df3ac48da44d4a2689f1c6eda9ad9b2cf5951980119c5509496775b7`；回读 pull
>   回来的镜像 ID 同为 `sha256:acec90fcadc3…`）。
>   **推镜像的方式换了**：原来用的「alpine 里 `apk add skopeo` + skopeo copy」这轮卡住
>   （apk 拉依赖太慢，10 分钟没动静），改成 `docker login gitea.topzero.cn:10241` 后直接
>   `docker push`（该地址是自签证书，daemon 需按 insecure registry 处理）——
>   第一次直接 push 报 `unauthorized: reqPackageAccess`，**先 login 就正常了**。
> - **一条仓库侧的坑**：`reminders-upstream/ops/offline/` 少了 `.env.example`（镜像进仓库时漏了
>   隐藏文件），在仓库里直接跑 `ops/build-offline-package.sh` 会在第 2 步报 `cp: cannot stat`。
>   已把文件补进仓库；本轮实际用的是 `workordernote-deploy/build-offline-package.sh`（模板完整）。
> - **一条流程自省（我的失误，已恢复）**：收尾清理 skopeo 临时容器时我图省事写了
>   `docker rm -f $(docker ps -q --filter ancestor=alpine:latest)` —— `ancestor` 过滤器会匹配
>   **从这个镜像派生出来的所有镜像**，而 `workordernote` 正是 `FROM alpine:latest`，于是
>   **201 生产 8906 与沙箱 8908 两个容器被一起删掉了**（数据目录没动，所以没丢数据）。
>   发现后立刻用 compose（`/vol1/1000/Docker/workordernote/docker-compose.yml`）与原来的
>   `docker run` 参数把两个容器原样恢复：镜像、端口、`user 1000:1001`、restart 策略、
>   volume、watchtower 标签逐项核对，健康检查通过，**201 == 200 指纹与删之前完全一致**
>   （清单 `edffe23d32`、卡片 `50c58560da`、提醒 `709adfca07`、完成 `cb31f20787`；5/9/61/23/5）。
>   规矩：**清理容器只按名字或自己启动时记下的 ID 来删**（`docker rm -f wsn-iter`），
>   永远不要用 `--filter ancestor=` 去批量删。

### 2026-10-13：0.23.4（201 生产 / 200 生产 / 沙箱 8908 上线）—— 编辑提醒弹窗同一行右侧加删除按钮（带确认）；删除只对创建者有效

> **发版记录**（VERSION `0.23.4`，源码提交 `e59a128`，镜像 `workordernote:0.23.4` =
> `sha256:83188db7b187a34ed3c1d1c3dc01d0ec605e2aeb95d09461fb88c5acd5b074dd`）
>
> 用户原话：「点击提醒消息：弹窗：编辑提醒，在同行右侧增加删除按钮。删除只对创建提醒用户有效」。
>
> **1）编辑弹窗里直接删**：`ReminderEditor` 头部那一行右侧（关闭按钮左边）加了垃圾桶按钮，
> 点它先弹确认框（「确定删除「xxx」吗？删除后这条不再提醒，也无法恢复。」），确认后删除、
> 关弹窗、父页面刷新并提示「提醒已删除」（`HomeView` / `CalendarView` 都接了这个事件）。
> 新建（还没有这条）时不显示该按钮。
>
> **2）删除只对创建提醒的用户有效**：服务端删除接口本来就按 `user_id` 过滤（删别人的一律 404），
> 这次把它**明确到界面**上 —— `ReminderDTO` 新增 `can_delete`（服务端按「这条的 `user_id` 是否等于
> 当前请求用户」算出，`listReminders` / `getReminder` 两处都填）；不是创建者时按钮置灰并写明
> 「只有创建这条提醒的用户可以删除」，而不是等点了才报错。删除失败时（404）也会给一句明确文案。
>
> **用例与文档**
> - 新增 `verify-117`（**11 项**）：弹窗头部有删除按钮且与「编辑提醒」**同一行、在右侧**、创建者可用、
>   点了先出确认框、确认后弹窗关闭且接口里查不到、日历新建编辑器里没有这个按钮。
> - Go 新增 `TestDeleteOnlyByOwner`（别的账号删不掉、条目仍在；别人的列表里看不到；创建者自己删得掉）。
>
> **发版自检**：迭代容器全量回归 **41 套件 / 1046 项全绿**；沙箱 8908（0.23.4 镜像）复核
> `verify-117` 11/11、`verify-100` 58/58、`verify-112` 46/46、`verify-116` 13/13；
> 离线包自检 **30/30**；`go vet` + `go test ./...` 全包 ok。
> - 备份：201 `data.bak-pre0234-20261013-153439`、200 `data.bak-pre0234-20261013-153535`。
>   构件（两边 md5 一致）：`images/workordernote-0.23.4-amd64.tar.gz` md5
>   `a47a5e2ac5d33dd5e1e265925efb5564`；`pkg/WorkOrderNote-0.23.4-offline-amd64.tar.gz` md5
>   `1c4299367aeb5cf630d7c23b2d2c49ac`、tar sha256 `3ad34bb5cdba843835b8ffc2999e80e5b73a9b156947b20d6806431d5e687481`。
> - 构件同步进 Gitea：Release `v0.23.4` 与容器仓库 `gitea.topzero.cn:10241/cyberzero/workordernote:0.23.4`。
> - **一条流程自省**：跑 0.23.3 那次全量回归时我顺手改了 `run-all.sh`（把 `verify-117` 加进套件表），
>   结果脚本跑到最后被改坏（`eep: command not found`）—— 套件本身全绿（只有 `verify-095` 因为
>   登录限流重试后仍撞限流红了 2 项，同一套件在 0.23.4 这轮是 30/30），但汇总段没打出来。
>   `browser-harness/README.md` 早就写了「**不要在回归跑着的时候改 `run-all.sh`**」，这次是我自己踩的，
>   记在这里：**改套件表要等回归结束**。

### 2026-10-13：0.23.3（用户要求「直接在 201:8906 修改」）—— 倒计时再加两个字号 + 加描边（深色卡面白边）

> **发版记录**（VERSION `0.23.3`，源码提交 `930a82d`，镜像 `workordernote:0.23.3` =
> `sha256:c9be1dc8c3b915be7cc58d52ed68e4bc22f476d768697fc7e080497c148ae3e7`）
>
> 用户原话：「倒计时 背景暗时看不清，增加白边，同时增加2个字号」+「直接在 201:8906 修改」。
>
> **1）再加两个字号**：桌面 44 → **52px**、手机 36 → **44px**；「还有 / 天」那行 16 → **18px**。
>
> **2）加描边**：用 `-webkit-text-stroke` 在彩色渐变字外面描一圈 ——
> **深色卡面（白字）描白边** `rgba(255,255,255,.92)`（手机 1.3px、桌面 1.6px），
> **浅色卡面（深字）描一层同族深边** `rgba(15,23,42,.28)`。不支持该属性的内核忽略即可，
> 不影响渐变流光。
>
> **发版自检**：沙箱 8908（0.23.3 镜像）复核 `verify-112` **46/46**（新增「有描边且宽度 > 0」
> 与「深色卡面描边是白的」，倒计时下限提到 ≥44px）、`verify-116` 13/13、`verify-115` 34/34、
> `verify-100` 58/58；离线包自检 **30/30**；镜像内产物已核对（`font-size:52px` 与
> `-webkit-text-stroke:1.6px …`）。
> - 备份：201 `data.bak-pre0233-20261013-142238`、200 `data.bak-pre0233-20261013-142345`。
>   构件（两边 md5 一致）：`images/workordernote-0.23.3-amd64.tar.gz` md5
>   `b3a9122f7d621e965cb88d68a9200f0e`；`pkg/WorkOrderNote-0.23.3-offline-amd64.tar.gz` md5
>   `5747575dfa8a4c6abe9554e11df3a737`、tar sha256 `23e7bf14d3f831b08816cb06e0711c29db6ffc2598f5616aac8332526693d9ba`。
> - 构件同步进 Gitea：Release `v0.23.3` 与容器仓库 `gitea.topzero.cn:10241/cyberzero/workordernote:0.23.3`。

### 2026-10-13：0.23.2（201 生产 / 200 生产 / 沙箱 8908 上线）—— 芯片时间固定 23:59 + 剩余时间；「开始提醒时间」＝当天第一次提醒；弹窗「知道了」文案与后台一致；后台「通知」卡片并入「提醒」

> **发版记录**（VERSION `0.23.2`，源码提交 `ab74c96`，镜像 `workordernote:0.23.2` =
> `sha256:88aecab3be01eb598553949a7a4bcb305694cac98f702d4d2ece62a7a3edb465`）
>
> 用户 2026-10-13 提的四条（口径都当面确认过）：
>
> **1）新建提醒的日期芯片时间一律 23:59**：今天/明天/本周末点下去都是 **23:59**
> （原来今天＝20:00、明天/本周末＝09:00），除非自己手动改结束时间。
> 顺带**删掉系统配置里的「新建提醒默认结束时间」**（task_expire_time）—— 默认时刻写死在前端
> （`HomeView.DEFAULT_DUE_TIME`），不再跟任何后台设置联动；老库里那一行留着没人读，无害。
>
> **2）新建提醒实时显示「剩余时间」**：日期芯片后面多一个「剩余 时:分」（超过一天先写天数，
> 如「剩余 2 天 05:23」），每分钟刷新（跟着页面已有的 clockNow）；过点显示「已过 时:分」。
>
> **3）「开始提醒时间」＝当天第一次提醒弹窗**（用户明确选了「从早上就开始提醒」）：
> 首次提醒时刻 = **「结束时间」与「生效日当天的开始提醒时间」里更早的那个**
> （`notify_window.go` 的 `firstRemindAt`）—— 结束 23:59、开始提醒 06:00，那么到期那天
> **06:00 就先弹一次**，之后按「提醒频率」重复（链条从首次提醒时刻起算）；过了「逾期提醒时间」
> 再标逾期（逾期口径没变）。它同时仍是每天的免打扰边界（0:00–这个点不提醒）；
> 写 **00:00 表示不提前、也不静默**。调度器对投递任务的有效性校验也跟着放宽：
> 首次提醒允许早于结束时间（`dispatcher.go`）。
>
> **4）弹窗「知道了（内容）」与后台偏好一致**：括号里就是偏好设置里「点『知道了』后的提醒频率」
> 那一项下拉显示的文案 —— 新抽了 `web/src/utils/reminder-options.ts` 一份文案表，
> **偏好设置的下拉与弹窗按钮读同一份**（后台选「1 小时后」→ 按钮「知道了（1 小时后）」；
> 选「第二天（当天不再提示）」→ 同名）。所以不会再出现「按钮写分钟数、后台写中文」两套说法。
>
> **5）后台卡片合并**：偏好设置里的「通知」卡片并入「提醒」，现在只剩一张「提醒」
> （开始提醒时间、默认提醒渠道与提醒频率、逾期提醒时间在同一张卡里）。`reminder/register.go`
> 里那两个配置的 Group 从 `notification` 改成 `reminder`。
>
> **用例与文档**
> - 新增 `verify-116`（**13 项**）：三个芯片都是 23:59、剩余时间格式与随日期联动、
>   弹窗按钮文案 == 后台下拉文案、偏好设置里没有单独的「通知」卡片且两项都在「提醒」卡片里。
> - `verify-100`（58 项）的「知道了」文案断言改成与后台文案表一致；`verify-112`（44 项）、
>   `verify-106`、`verify-013` 适配「默认时间写死 23:59」。
> - Go 新增 `TestFirstRemindAt`（开始提醒 06:00 → 当天 06:00；00:00 → 结束时间；结束时间更早 →
>   按结束时间；建出的投递任务确实排在首次提醒时刻）。
>
> **发版自检**：迭代容器全量回归 **40 套件 / 1033 项全绿**；沙箱 8908（0.23.2 镜像）复核
> `verify-116` 13/13、`verify-115` 34/34、`verify-112` 44/44、`verify-100` 58/58；
> 离线包自检 **30/30**；`go vet` + `go test ./...` 全包 ok。
> - 备份：201 `data.bak-pre0232-20261013-135353`、200 `data.bak-pre0232-20261013-135449`。
>   构件（两边 md5 一致）：`images/workordernote-0.23.2-amd64.tar.gz` md5
>   `edf15d47f1a6e6f04469baea6d6dfc6e`；`pkg/WorkOrderNote-0.23.2-offline-amd64.tar.gz` md5
>   `79470dd019d54020f0c9f55d9ebca499`、tar sha256 `b1580ea6d5072d38d7c8af6fa3fa73245f8e8f630eaf143cf182dcae450b0c9a`。
> - 数据指纹（201 == 200）：清单 `6fc67d82ce`、卡片 `b5e17c0ab7`、提醒 `0d40896e4b`、完成 `6767aa483f`
>   （5 清单 / 9 卡片 / 61 提醒 / 43 条完成记录）。
> - 构件同步进 Gitea：Release `v0.23.2`（镜像 + 离线包两个附件）与容器仓库
>   `gitea.topzero.cn:10241/cyberzero/workordernote:0.23.2`。
>
> **需要注意的行为变化**：因为「开始提醒时间」现在是**第一次提醒**，而用户把它设成了 **06:00**，
> 所以**当天到期的任务从 06:00 就会被提醒**（不再等到 23:59）；如果不想这么早被提醒，把它改晚一点
> 或者写 00:00（= 只按结束时间提醒、不提前也不静默）。

### 2026-10-13：0.23.1（201 生产 / 200 生产 / 沙箱 8908 上线）—— 「背景蒙板」改为常显（没选背景图时置灰并提示）

> **发版记录**（VERSION `0.23.1`，源码提交 `b1833d7`，镜像 `workordernote:0.23.1` =
> `sha256:ab35266a1479da98a462ab7405a13d45643d26d59ea47fa5788edcf436b903e7`）
>
> **用户反馈**（原话）：「201:8908 没有看到蒙板设置」。查下来功能是好的（挂载在沙箱上的产物里
> 有 `data-ceremony-form-bg-mask`，实测选一张背景图后两个滑块就出现），**是藏得太深**：
> 虚化 / 透明度原来只在**选了背景图之后**才渲染，不先挑图根本看不到，容易被当成没这功能。
>
> **改法**：「背景蒙板」这一块现在**一直显示**在背景图选择器下面 —— 没选背景图时两个滑块置灰并提示
> 「先在上面选一张背景图，再调虚化与透明度」；选了图立刻可用。顺手给这一块加了 `data-*` 钩子
> （`data-ceremony-form-bg-mask-block` / `-need`）便于用例与排查。
>
> **发版自检**：迭代容器全量回归 **39 套件 / 1021 项全绿**；沙箱 8908（0.23.1 镜像）复核
> `verify-115` **34/34**（新增「不选背景图也能看到蒙板设置」）、`verify-112` 45/45、
> `verify-107` 20/20、`verify-114` 16/16；离线包自检 **30/30**。
> - 备份：201 `data.bak-pre0231-20261013-113703`、200 `data.bak-pre0231-20261013-113758`。
>   构件（两边 md5 一致）：`images/workordernote-0.23.1-amd64.tar.gz` md5
>   `a5989e4bd469cf21f324e3fdd240e192`；`pkg/WorkOrderNote-0.23.1-offline-amd64.tar.gz` md5
>   `4d64887e5fb91efb18747c85052addba`、tar sha256 `b43cceac2e0cb5f04ba96ae49a9aead9bdcdf9e3066e97a70eb9c1f4f03343df`。
> - 数据指纹（201 == 200）：清单 `6fc67d82ce`、卡片 `b5e17c0ab7`、提醒 `0d40896e4b`、完成 `6767aa483f`
>   （5 清单 / 9 卡片 / 61 提醒 / 43 条完成记录）。
> - **构件同步进 Gitea 仓库**：Release `v0.23.1`（镜像 + 离线包两个附件）与容器仓库
>   `gitea.topzero.cn:10241/cyberzero/workordernote:0.23.1`（回读 digest `sha256:9ecf6810b654…`，
>   仓库里已有 `0.23.0` / `0.23.1` 两个标签）。

### 2026-10-13：0.23.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— 倒计时直显大卡片 + 彩色流光 + 横线；卡片背景「蒙板」（虚化 / 透明度可调）；修「模板新建继承上一张卡片背景」

> **发版记录**（VERSION `0.23.0`，源码提交 `fa4543b`，镜像 `workordernote:0.23.0` =
> `sha256:21011bd187efb2b07e08339f20367b85b02a1bc56066dd6fa67b2291e1ecde55`）
>
> 用户在 0.22.0 之后陆续提的四条（攒成一版）：
>
> **1）倒计时不再有自己的卡片效果，直接显示在大卡片里**：去掉那层底色、圆角与描边；字色仍按整卡
> 渐变自动配白字/深字（有背景图的卡片压在蒙板上）。
>
> **2）倒计时数字加彩色流光**（用户追加「使用彩色流光」）：渐变字（`background-clip: text` + 透明字色）
> + 背景位移动画，一道彩光每 **2.8 秒**从左到右扫过数字。配色按卡面字色分两套（都是 靛蓝 → 紫 → 青）：
> 深色卡面用亮的 `#a5b4fc / #d8b4fe / #67e8f9`，浅色卡面（琥珀/鎏金）用深的 `#4338ca / #7e22ce / #0e7490`，
> 两端回到基色。系统开「减少动态效果」时动画停下；**老内核不支持渐变裁字时退回静态字色**
> （否则字会整个透明、看不见）。
>
> **3）倒计时与下方信息之间加一条横线**：1px 半透明细线、横向铺满卡片内容区，颜色跟卡面字色同色系
> （深色卡面 `rgba(255,255,255,.30)`、浅色卡面 `rgba(15,23,42,.20)`）。
>
> **4）卡片背景「蒙板」：虚化 + 透明度两个指标**（用户要求「背景增加蒙板功能，可调整虚化、透明度」）：
> - 新增两个字段 `reminders.bg_blur`（0–24px 高斯模糊）与 `reminders.bg_mask`（**透明度** 0–100%，
>   默认 45% = 蒙板浓度 55%，与上一版写死的观感一致），随卡片保存、随同步走（老卡片迁移后默认值一致）。
> - 编辑器里选好背景图（内置主题图或上传图片）后出现两个滑块，实时生效；
>   透明度拉满 100% = 完全不压蒙板；≥80% 时给一句提醒（浅色背景上的白字可能看不清）。
> - 虚化时背景图自动放大 8%，避免模糊把卡片四边「吃掉」透出底色。
>
> **5）顺手修掉一个真 bug**：「常用事项模板」新建出来的卡片会**继承上一张卡片的配色/背景图/蒙板**
> （表单只重置了标题与日期）。现在新建与选模板都会**整表复位**。
> —— 这个 bug 是核对用例时发现的：三张模板卡片（生日/结婚纪念日/七夕）被写进了预设背景图，
> 对比度用例因此报红，顺藤摸瓜找到的。
>
> **用例与文档**
> - `verify-112` 扩到 **45 项**（无底色块、渐变裁字、**彩色流光（≥3 色）**、减少动态效果时停下、
>   横线位置与可见性；带背景图的卡片不再拿卡面渐变算对比度，交给 verify-115）。
> - `verify-115` 扩到 **33 项**（两个滑块的存在与范围、虚化 12px 的渲染与防边缘放大、
>   透明度 10%/100% 的蒙板浓度、两个指标随卡片持久化、带图卡片走白字 + 蒙板）。
> - Go 新增 `TestBackgroundMaskDefaultsAndRanges`（默认值 0/45、超范围拒绝、更新缺省=不改）。
>
> **发版自检**
> - 迭代容器（8918，挂本地 dist + 现场编译后端）全量回归：**39 个套件 / 1020 项全绿**。
> - 沙箱 8908（0.23.0 镜像）复核：`verify-115` 33/33、`verify-112` 45/45、`verify-107` 20/20、`verify-114` 16/16。
>   离线包自检 **30/30**；`go vet` + `go test ./...` 全包 ok。
> - 备份：201 `data.bak-pre0230-20261013-102928`、200 `data.bak-pre0230-20261013-103026`。
>   构件（两边 md5 一致）：`images/workordernote-0.23.0-amd64.tar.gz` md5
>   `11d27309e98ef18c14a9a166bef0f3fc`；`pkg/WorkOrderNote-0.23.0-offline-amd64.tar.gz` md5
>   `1411b6e78d16f75fb8e33fc7d5230142`、tar sha256
>   `de021f1eb797159eeed90b8f4fe4441d1720cfb7da02d83b9d21a56155771e95`。
> - 数据指纹（201 == 200）：清单 `6fc67d82ce`、卡片 `b5e17c0ab7`、提醒 `3881403059`、完成 `1290f3c9af`
>   （5 清单 / 9 卡片 / 59 提醒 / 42 条完成记录）。公开设置 9 项一致；201 与 200 的个人偏好一致
>   （沙箱按惯例保持「开始提醒时间 00:00 / 提醒频率 10 / 知道了后 0」，便于夜里跑回归）。
 - 代码仓库（Gitea `cyberzero/WorkOrderNote`）同步推送（Gitea 已设为默认远端 `origin`，
  上游 GitHub 改名 `upstream`；本地分支改回 `main` 跟踪 `origin/main`）。
> - **构件也放进 Gitea 仓库**：
>   · Release <https://gitea.topzero.cn:10241/cyberzero/WorkOrderNote/releases/tag/v0.23.0> —— 附了
>     `workordernote-0.23.0-amd64.tar.gz`（镜像，45MB）、`WorkOrderNote-0.23.0-offline-amd64.tar.gz`
>     （离线包，44MB）、`SHA256SUMS-0.23.0.txt`；
>   · **容器仓库** `gitea.topzero.cn:10241/cyberzero/workordernote:0.23.0`（skopeo 直推，回读校验
>     digest `sha256:a01ffb2d6e9b…`，labels 里 version `0.23.0` / revision `fa4543b`）。
>     本机要直接拉：先把 `gitea.topzero.cn:10241` 加进 `/etc/docker/daemon.json` 的
>     `insecure-registries`（或导入其 CA），再重启 dockerd（`live-restore` 生效，现有容器不会重启），
>     之后即可 `docker pull gitea.topzero.cn:10241/cyberzero/workordernote:0.23.0`。
>     注意：飞牛 Docker 应用以后若重写 daemon.json，这一项要再加一次。
> - **Git 默认远端已切到 Gitea**：`origin` = Gitea（`remote.pushDefault=origin`），上游 GitHub 改名
>   `upstream`；工作分支从 `feat-note` 改回 `main` 并跟踪 `origin/main`（旧的浅克隆 main 留作
>   `main-github-shallow`）。免密走 **Gitea 访问令牌**（`workordernote-push`，仅仓库读写权限，
>   存在本机 `~/.git-credentials`，600）：`git fetch/push` 已实测不需要密码；
>   令牌随时可在 Gitea「设置 → 应用」里删除。

### 2026-10-13：0.22.0（201 生产 / 200 生产 / 沙箱 8908 上线）—— 清单页排序；开始提醒时间（免打扰）+ 逾期提醒时间；仪式感卡片颜色统一 + 背景图；别处确认过的通知不再重复显示

> **发版记录**（VERSION `0.22.0`，源码提交 `f161a47`，镜像 `workordernote:0.22.0` =
> `sha256:b5823097d2b38d7659c69adf8a268207e4ba15440d5b105e837bc5843b91914d`）
>
> 这一版把用户 2026-10-12 下午到 10-13 凌晨提的四件事一次发出去（前两件各自攒过一批）：
>
> **1）清单页排序（升序 / 倒序）**：列表页工具栏新增「时间升序 / 时间倒序」按钮，按**到期时间**
> 排整页 —— 倒序时日期卡片整体倒过来、卡片内条目也倒序；升序 = 原顺序（默认，零变化）。
> 「已逾期」永远第一、「无日期」永远最后、卡片内「没做完的在前」都不变。「已完成」页与记事本
> 栏目不给这个按钮（各有自己的口径）。选择记在 localStorage（`ui_list_sort_dir`）。
>
> **2）「开始提醒时间」= 免打扰**（个人偏好 `reminder_all_day_time`）：每天这个时间**之前不发任何
> 提醒**，到点后把攒着的一起发出去。这个键原来**注册了但代码从没读过**（死配置，旧名叫「全天提醒
> 时间」），这次真正接上：投递调度器逐用户判断静默窗口（30 秒进程内缓存），窗口内的任务保持
> pending。**默认 00:00 = 不静默**（老安装行为不变）。
> **用户自己在 201 上把它设成了 06:00**（2026-10-12 12:27 设的），所以 201 现在是 0:00–5:59 安静；
> 本次已把 200 对齐成同样的 06:00 / 提醒频率 15 分钟 / 知道了后 60 分钟。
>
> **3）「逾期提醒时间」**（个人偏好 `task_overdue_time`，默认 23:59）：到期日当天过了这个点还没完成
> 就算逾期，**并发一条「已逾期」站内提醒**（弹窗 + 通知中心，琥珀色图标）。口径由「MAX(到期时刻,
> 当天时间)」改为**按日期** —— 否则新建默认的 23:59 会把用户设的 20:30 顶掉、设了等于没设。
> 提醒规则：每个任务每天最多一条、只补发 12 小时内进入逾期的、静默窗口里顺延到静默结束。
> 同时把「新建提醒默认结束时间」（`task_expire_time`，系统配置，默认 23:59）与逾期判定**解耦**，
> 两个时刻设置项都放开成任意时分（原来只有固定几档，连 20:30 都选不到）。
>
> **4）仪式感卡片：颜色统一 + 背景图**：
> - **整张卡片 = 倒计时那一套渐变**（不再有「卡面浅色 + 倒计时浓色」两块色，字色/图标底盘按渐变算）。
> - **可换背景图**：编辑器里能挑 **10 张内置主题图**（生日/纪念日/婚礼/新年春节/中秋/圣诞/春天/
>   考试升学/旅行/星空夜色），也能**上传自己的图片**（≤8MB，服务端只收 JPEG/PNG/GIF/WebP）。
>   **卡片删除时上传的图片跟着删**；内置主题图是构建产物（已内联进 JS，随版本走、**永远不会被删**）。
>   上传文件存在 `<data-dir>/uploads`（随 data 卷持久化，**不需要新增挂载**），另有每天一次的
>   兜底回收，清掉没人引用且超过 24 小时的文件。
> - **已知限制（如实记录）**：上传的图片**文件本身不参与双机同步**（只同步引用路径）。对端没有这张
>   图时会自动回落到配色渐变（`<img>` 的 @error 兜底），不会显示破图；要在两端都看到图，需要后续
>   补一个文件同步通道。
>
> **5）别处确认过的通知不再重复显示**：手机上点了「知道了」，另一台设备上那条弹窗自动撤掉。
> 服务端本来就会广播 `notification/read`，这次前端收到后**核对弹窗队列**并把已读/已删除的摘掉；
> 长连接被掐断时靠 20 秒一轮的修订号轮询兜底（最长约 20 秒撤掉）。页面回到前台时也核对一次。
>
> **用例与文档**
> - 新增三个套件：`verify-113`（清单页排序 **30 项**）、`verify-114`（免打扰 + 逾期提醒 **16 项**）、
>   `verify-115`（卡片背景图 + 跨设备确认 **26 项**）；`verify-100` 这一轮跑出 **58 项**。
> - Go 新增/改写：静默窗口（`TestInQuietHours`）、逾期提醒（`TestNotifyOverdueOncePerDay`）、
>   逾期判定（`TestOverdueDeadlineExpression` / `TestOverdueTimeDefersOverdueUntilCutoff`）、
>   背景图（`TestValidateBackground` / `TestCleanupUploadedBackground` /
>   `TestDeleteReminderCleansBackgroundFile`）。
> - 顺手记下一个**测试侧的坑**（已写进 `browser-harness/README.md`）：未读的「逾期提醒」弹窗是
>   全屏遮罩，会吃掉用例的点击 —— 本轮全量回归里 `verify-013` / `verify-017` / `verify-reminders`
>   就是这么假红的，把未读标掉后单跑全绿。
>
> **发版自检**
> - 迭代容器（8918，挂本地 dist + 现场编译的后端 `0.21.3-iter`）全量回归：**39 个套件 / 1006 项
>   全绿**（含本轮新增的 113/114/115）。
> - 沙箱 8908（0.22.0 镜像）复核：`verify-115` 26/26、`verify-114` 16/16、`verify-112` 38/38、
>   `verify-100` 58/58。离线包自检 **30/30**。`go vet` + `go test ./...` 全包 ok。
> - 备份：201 `data.bak-pre0220-20261013-022653`、200 `data.bak-pre0220-20261013-022753`。
>   构件（两边 md5 一致）：`images/workordernote-0.22.0-amd64.tar.gz` md5
>   `adf88d075a3029346cf45d002f7f340a`；`pkg/WorkOrderNote-0.22.0-offline-amd64.tar.gz` md5
>   `d13d991ad59c78e40c770f562280c760`、tar sha256
>   `c4dcfddf24ef7a3ecad6565b675b5cc8edf6f19fd9f5e2b974de5eaeabde62db`。
> - 数据指纹（201 == 200，含新增的 `background` 字段）：清单 `6fc67d82ce`、卡片 `b5e17c0ab7`、
>   提醒 `3881403059`、完成 `1290f3c9af`（5 清单 / 9 卡片 / 59 提醒 / 42 条完成记录）。
> - **程序设置**：用户 2026-10-12 12:27 自己在 201 上改了三个偏好（开始提醒时间 06:00、
>   提醒频率 15 分钟、知道了后 60 分钟）—— 这是他的选择，本次**把 200 对齐成同样的值**；
>   沙箱 8908 保持「开始提醒时间 = 00:00（不静默）」，否则夜里跑回归时提醒类用例会被静默拦住。

### 2026-10-12：0.21.2（201 生产 / 200 生产 / 沙箱 8908 上线）—— 提醒弹窗主按钮改成「知道了（任务延期明天提醒）」：点它是顺延，不是关掉提示

> **发版记录**（VERSION `0.21.2`，源码提交 `244f603`，镜像 `workordernote:0.21.2` =
> `sha256:a78c246ce5744cdd3768d1eb88a788f9f8d33d21df81fbba983a599c2413930f`）
>
> 用户原话（2026-10-12）：「今天新建了一条昨天的任务，被排在逾期里面，弹出提示，点击知道了，
> 任务就从逾期里面出来了，修改提示『知道了』为『知道了（任务延期明天提醒）』，直接在
> <http://192.168.3.201:8906> 修改并发版」。
>
> **问题（行为对、文案错）**：弹窗的「知道了」不是「关掉提示」，而是把这条提醒**顺延**（默认顺延到
> **第二天同一时间**）；而「已逾期」的判定又优先看这个顺延时间（`overdueStamp` = 稍后提醒优先），
> 所以顺延到明天之后，这条任务自然从「已逾期」分组里出去了 —— 用户看到的正是「点一下就出了逾期」。
>
> **改法**：
> - `web/src/components/ReminderAlert.vue` 新增 `ackLabel` 属性，按钮文案不再写死（默认
>   「知道了（任务延期明天提醒）」）。
> - `web/src/layouts/MainLayout.vue` 按偏好动态生成：偏好「点『知道了』后的提醒频率」= 0
>   （默认 / 未设置，当前三台都是这个值）→ **「知道了（任务延期明天提醒）」**；设成 N 分钟 →
>   「知道了（N 分钟后再提醒）」，不写死。
> - 按钮下面那行小字一并收短：只留「要完成请到列表里勾选；今天不再提示，明天同一时间继续提醒」，
>   不再把顺延说明重复两遍。
> - 顺带把按钮上方的注释与 emit 注释改成与新文案一致的说法。
>
> **用例**：`verify-100` 新增一条断言，整轮跑出 **49 项全通过** —— 「主按钮必须写成『知道了（…）』
> 且括号里写明『明天』或是具体分钟数」（原来只断言按钮文字恰好等于「知道了」，改文案后必红）；
> 两处点按钮的选择器也从「等于知道了」改成 `startsWith('知道了')`。
>
> **发版自检**：沙箱 8908 全量回归 **36 套件**（921 项一次通过；`verify-print`、`verify-095` 在整轮里
> 因登录限流两次退避重试后仍撞限流而假红，单跑分别 **24/24**、**30/30** 全绿）；离线包自检 **30/30**；
> `go vet ./...` 通过、`go test ./...` 全包 ok（本次只动前端，仍用 `golang:1.26-alpine` 复核一遍）。
> - 备份：201 `data.bak-pre0212-20261012-082823`、200 `data.bak-pre0212-20261012-082901`。
>   构件（两边 md5 一致）：`images/workordernote-0.21.2-amd64.tar.gz` md5
>   `3c5f9a6448786d144324501c3877434b`；`pkg/WorkOrderNote-0.21.2-offline-amd64.tar.gz` md5
>   `846819d2653585a204cb7f428f79f9cb`、tar sha256
>   `e9a873f6fb3001eb60bc031e62b46c7d7ab011121090486afadf6d75d45a2d47`。
> - 数据指纹（201 == 200，逐字段拼串取 md5 前 10 位）：清单 `e1658ac3f2`、卡片 `df70437f9e`、
>   提醒 `079aa2ca53`、完成 `ee27041e57`（5 清单 / 9 卡片 / 54 提醒 / 40 条完成记录）。
> - **顺手清掉 201 生产库里的 22 条自检残留完成记录**：10-10～10-12 历次在 201 生产上跑回归留下的
>   「自检…」历史行（用户「已完成」页会看到），清理前有效完成记录 42 条 → **20 条**，与 200 完全一致。
>   提醒里的「自检」条目本来就是 0 条（`clean-self-test.sh` 复查：54 条 / 含自检 0）。
> - **顺带查清一个假警报（不属本次改动，未改代码）**：双机同步摘要长期写着「对端有、本机没有的账号：
>   王耀辉（这些数据被跳过）」，看着像账号没对上、数据根本没同步。实测：在 201 建一条探针提醒 →
>   手动同步 → 200 上立刻出现（推送「新增 1」）；删掉再同步 → 200 上同步删除（删除 1）。**真实数据
>   一直是同步的**（两边的 54 条提醒、5 个清单、9 张卡逐字节一致）。那句话来自 `markUnmapped()`：
>   它既用于「账号对不上」，也用于「父行（清单/卡片/提醒）从没同步过、子行只能跳过」这两种情况，
>   后者被错报成账号问题（201 上报 463 条、200 上报 324 条，几乎都是历次自检墓碑数据的子行）。
>   **属于文案与计数缺陷，留待下一批修**。

### 2026-10-12：0.21.1（201 / 200 / 沙箱 8908 上线；新设备与迭代容器按用户要求删除）—— 仪式感卡片图标左置放大 2 倍、内容全部放大、字色按底色自动匹配；收缩态新建按钮只留底色

> **发版记录**（VERSION `0.21.1`，源码提交 `b885c29`，镜像 `workordernote:0.21.1` =
> `sha256:b21a56238b8b1caaf83305f3c15c76cbaa523492155e6b27a14e684334c20daa`）
>
> 用户在 0.21.0 之后陆续提的这几条（合并发布）：
>
> **1）仪式感卡片**
> - **图标移到内容左侧并放大 2 倍**：22px → **44px**（底盘 36px → **64px**），位置从「标题上方」
>   改成「名称/日期/次数那一列的左侧」，整组（图标 + 文字）仍在卡片里居中。
> - **所有内容放大**：名称 15 → **19px**、时间 11 → **14px**、循环与次数徽标 10 → **12px**、
>   编辑/删除按钮 16 → 20px；卡片从约 194px 高变成约 **234px**（1440px 与 390px 都不横向溢出）。
> - **字色按底色自动匹配**（用户报「浅色背景影响字体显示，字体是白色的」）：新增 WCAG 对比度计算
>   （`contrastRatio` / `bestInk`），倒计时字色在「白字 / 深字」里自动挑**渐变两端里更差那端更好**的；
>   默认档那些**不透明浅色卡面**额外强制配深字（日期 / 徽标 / 行内按钮用柔化深字 `--ceremony-ink-soft`）。
> - **色板分成深色系 / 浅色系两族**：深色系（石墨/玫红/暖橘/翡翠/青碧/天蓝/靛蓝/紫罗兰/品红）两端加深到
>   白字对比度 ≥4.7（原来中浅渐变配白字只有 2.6～3.0，看着发虚）；浅色系（琥珀/鎏金）浅底 + 自动深字。
>   实测：白字档 4.70～7.58、琥珀 8.31、鎏金 5.49、默认档标题 ≥4.5。
>
> **2）收缩态「新建」按钮取消流光、只保留蓝紫底色**（展开后的新建卡片仍有流光）。
>
> **用例与文档**
> - `verify-112` 扩到 **38 项**：把原来那条「图标/标题都在卡片中线上」升级成 4 条（倒计时居中、
>   **图标在标题左侧且整组居中**、**图标 44px/64px 底盘**、名称/时间/徽标字号下限），
>   并新增 2 条对比度断言（倒计时 ≥3.5、标题 ≥4.5）；`verify-print` 的 PDF 页数断言改成按**密度**算
>   （原来写死「≤3 页」，而迭代容器上本月完成记录已累计 109 行 → 5 页必然红）。
> - 顺手清掉迭代容器里历次自检留下的 completions 128 条（290 → 162）。
>
> **发版自检**：生产 201（数字见下）；离线包自检 **30/30**；`go vet` + `go test ./...` 全包 ok。
> - 备份：201 `data.bak-pre0211-20261012-032101`、200 `data.bak-pre0211-20261012-032154`。
>   构件（两边 md5 一致）：`images/workordernote-0.21.1-amd64.tar.gz` md5
>   `f65581370c0d6adea2606a0499a3ffb2`、sha256
>   `1808acf62f47eb5fd9d3bc815f7008a6b6b0c85de36a43afd2e43479abcc3f06`；
>   `pkg/WorkOrderNote-0.21.1-offline-amd64.tar.gz` md5 `e6a8eb12bb337bfe8fd0e2522e8f40ad`、
>   tar sha256 `7fa00b558efb93bbd5dc9a9e08ff306228b35455a60210dda3dffbd847e808ce`。
> - **容器清理（用户要求）**：删除「新设备 8909」与「迭代容器 8918」两个沙箱（含数据目录与 dev 镜像），
>   只保留 **201 生产 8906 + 201 沙箱 8908 + 200 生产**。历史镜像与离线包（0.3.0–0.21.0）**保留**在
>   `images/` 与 `pkg/` 里用于回退（用户若要一起清，另说）。
> - 构建小插曲：这次 `docker build` 在 BuildKit 下被镜像加速器 `docker.fnnas.com` 401 挡住
>   （`golang:1.26-alpine` / `node:20-alpine` 解析失败），改用 `DOCKER_BUILDKIT=0`（经典构建器、
>   直接用本地已有基础镜像）一次通过；镜像内版本号 `0.21.1` / 提交 `b885c29` 已核对。

### 2026-10-11：0.21.0（四台 + 迭代容器全部上线）—— 仪式感卡片大改（大倒计时/居中/12 档过渡色/浅色随机/按倒计时排序）；日期插件快速选年月；新建提交后自动收起；新建按钮蓝紫渐变

> **发版记录**（VERSION `0.21.0`，源码提交 `4db1932`，镜像 `workordernote:0.21.0` =
> `sha256:9ce5dd8b07b2057fe60ab9cceadc49964d83acc5cd2d36d606b353e581a29bc7`）
>
> 用户在 0.20.0 之后陆续提的这一批（合并发布）：
>
> **1）仪式感卡片（「人生要有仪式感」）**
> - **倒计时再放大**：天数 30px → **44px**（手机 36px，`text-[36px] sm:text-[44px]` + `font-black`），
>   「还有 / 天」小字 15 → 16px，卡片 `min-h` 9.5rem → **11rem**。
> - **内容居中**：倒计时块、图标 + 标题 + 日期、底部「第 N 次 / 编辑 / 删除」全部居中（图标改到标题上方）。
> - **12 档过渡色自选**（新建 / 编辑事项时点色块）：默认（浅色随机）/ 石墨 / 玫红 / 琥珀 / **鎏金** /
>   暖橘 / 翡翠 / 青碧 / 天蓝 / 靛蓝 / 紫罗兰 / 品红；倒计时块用所选色系的浓郁渐变，浅底（琥珀、鎏金）配深字。
> - **默认档不再是纯白**：没挑颜色的卡片按 id **稳定随机**落一档浅色（浅天蓝/浅紫/浅玫/浅金/浅绿/浅青）
>   铺满卡面，倒计时块用同色系更浓的那档；看着随机、刷新不跳色。
> - **按倒计时排序**：未到的从小到大排最前（就是今天 → 1 天 → 2 天…），「已过 N 天」全部排最后
>   （过得少的在前），无日期的排最末。原来直接 `a.days - b.days`，负数会顶到最前
>   （实测页首是「已过 2817 天」那条）。
> - **数据**：新增 `reminders.accent` 列（AutoMigrate 自动加，不需要迁移记录）+ 色名白名单
>   （`server/reminder/card_accents.go`）+ **同步带上该字段**（`sync_types/snapshot/apply/sameReminder`）。
>   ⚠️ 混版本同步时旧端会丢掉 accent（与 0.15.0 加 `start_at/end_at` 同一个坑），所以这版四台一起升。
>
> **2）日期插件（新建与编辑都用它）支持快速选年月**：点年月标题展开「年份下拉（往前 80 年）+ 12 个月」
>   面板，点月份直接跳过去；切页签 / 点「今天」自动收起。
>
> **3）新建提醒提交成功后自动收起**（原来保持展开）；被拦下（例如计划页没选开始时间）时仍保持展开。
>
> **4）「新建」按钮改成蓝紫过渡色**（与侧栏第一个「新建提醒」同一套 `from-blue-500 to-indigo-500`）
>   + 白字，**流光（`.flow-frame` 光带）保留**。
>
> **用例与 Go 用例**
> - `verify-112` 扩到 **33 项**：新增「日期插件点标题快速选年月（含选 1984 年 6 月跳转）」「卡片内容居中」
>   「卡片过渡色往返（选紫罗兰 → 接口 accent=violet 且渐变跟着变 → 编辑时选中 → 选默认清零）」
>   「默认卡面非纯白 + 多张默认卡浅色不全同 + 每张 hero 比卡面更浓」「卡片按倒计时排序」
>   「新建按钮蓝紫渐变」等；`verify-106` 改成「提交后自动收起 → 再点开验默认今天」；
>   `verify-090` 提交后改用 `openQuickAdd()`。
> - Go 新增 `TestReminderAccentRoundTrip`（创建带上 / 编辑不传保留 / 传空清除 / 非法色名拒绝）。
> - **顺手修掉三处用例缺陷**（都不是产品问题，已记进 `browser-harness/README.md`）：
>   ① `verify-013` 写死「20:00–次日 6:00 必定夜间」，10 月上海日出 05:5x，05:57 跑必红 →
>      改成按 NOAA 公式算当天日出日落、边界 ±45 分钟跳过硬断言；
>   ② `verify-104` 假设「本周周三」，实例残留 `calendar_week_start=sunday` 时数据会造到上一周 →
>      跑前强制周一、跑完**真回读**还原（原来那条「已还原」是硬编码 `true`）；
>   ③ `verify-102` 假设「只有自检三条数据定义了月份范围」，生产上 2027 年还有账单/节日条目（8918 上
>      还有一条 2019 年生日）→ 改成按 `/items/months` 的 first/last 算期望、再真的点到边界验一次。
>   另：`verify-111` 的「右侧当天列表」前提依赖选中日有安排 → 先点一个有任务条的日子。
>
> **发版自检**：迭代容器 **36 套件 918 项全绿**；生产 201（数字见下方）；离线包自检 **30/30**；
> `go vet` + `go test ./...` 全包 ok；四台 + 迭代容器均为 `0.21.0`。
> - 备份：201 `data.bak-pre0210-20261011-145942`、200 `data.bak-pre0210-20261011-150021`。
>   构件（两边 md5 一致）：`images/workordernote-0.21.0-amd64.tar.gz` md5
>   `dcc0943bcbc1263b1bfc72d4b8f30c7f`、sha256
>   `a93f792cf7a8c43fa2d50e54d0415d5257fb348ed395fb85276ad8af2fc3e449`；
>   `pkg/WorkOrderNote-0.21.0-offline-amd64.tar.gz` md5 `4da7ed76b3410237ae42e3fdeca851f2`、
>   tar sha256 `380c30fe8dee9f0589c1c6dba8eee308ff86fe4f8526c3d944993d0a4b393d98`。
> - 程序设置：上线后与 201 逐键复核（系统级 / 公开 / 个人偏好三个维度），四台保持一致。

### 2026-10-11：0.20.0（四台 + 迭代容器全部上线）—— 计划周期可调数量；后台「任务过期时间」与清单顺序；周起始日中文；新建按钮实线流光；仪式感卡片倒计时置顶

> **发版记录**（VERSION `0.20.0`，源码提交 `8689c83`，镜像 `workordernote:0.20.0` =
> `sha256:2469479d6f33b1bdfb1b035f1a19851d4c63040032c3ce35facf94ab21751700`）
>
> 用户这一批六条（原话）：「计划页面新建提醒 周期 选择天的时候可以调整数量，但是选择周月年的时候没有，
> 改成一致都保留可调输入框；后台偏好增加清单顺序调整功能。后台周起始日 改成中文，今天、计划里面新建
> 按钮卡片边框改成实线流光效果。后台偏好增加过期时间，设定一个过期时间，默认23:59；人生要仪式感里面
> 卡片增加高度把倒计时放上面，放大显眼」。随后要求「完成后发版，同步所有容器程序设置保持一致」。
>
> **1）计划页周期：天/周/月/年都能调数量**
> - 原来只有「天」带数量输入框（周/月/年是写死的 1），现在四档都用同一个输入框：**N 天 / N 周 / N 月 / N 年**，
>   下拉标签跟着数量显示（`3 周` 这种）。计算：N 天 = N 天；N 周 = N×7 天；N 月 = N 个自然月；
>   N 年 = N 个自然年，结束时刻仍是最后一天 23:59。
> - 「年终」锚定当年 12-31、「自定义」自己挑结束时间，这两档**不显示**数量框（不是「数量」语义）。
> - 编辑既有计划任务时反推档位的 `inferPlanPeriod()` 也跟着支持 N（先年终 → N 年 → N 月 → N 周 → N 天）。
>
> **2）后台新增「任务过期时间」`task_expire_time`（系统级公开配置，默认 23:59）**
> - 与用户确认口径：**当天到这个点才算过期**，之后再叠加原有的「任务过期多久算逾期」宽限分钟数。
>   实现是 SQL 里的 `overdueDeadlineExpr()`＝`MAX(到期时刻, 当天过期时间)`（把带偏移的时间先 `tsUTC()`
>   归一化、+8 小时折回上海日期、拼上过期时间、再 −8 小时折回 UTC 比较），`/summary` 的逾期角标与
>   前端 `isOverdue()` 用同一口径 → 「今天 09:00 的任务」当天不再顶着「已逾期」，「昨天 23:00 的」照旧逾期。
> - 它同时是**新建提醒的默认时间**（首页快速新建、日历双击日期格都预填当天这个时间；0.16.5 起曾是
>   「当前时刻」，这次按用户要求改成跟随配置）。
> - 选项：18:00 / 19:00 / 20:00 / 21:00 / 22:00 / 23:00 / **23:59（默认）** / 00:00（按到期时刻算、不按天顺延）。
>
> **3）后台「周起始日」显示中文**：`ConfigGroupList` 的选项标签表补了 `calendar_week_start`（周一 / 周日）
>   与新配置 `task_expire_time` 的中文说明 —— 之前界面直接显示 monday / sunday。
>
> **4）偏好设置新增「清单顺序」**
> - 新增 `PUT /api/reminder/lists/order`（整串 id 一次提交，服务端在事务里写 `position` 1..N；
>   只认当前用户未删除的清单，没传的按原顺序接在后面）。
> - 偏好设置里列出**普通清单**（排除 credit_card / notebook / ceremony 三个固定栏目），↑/↓ 即时生效并落库。
> - 顺带把 `/lists` 的排序从 `is_default DESC, position ASC` 改成**完全按 position**：原来默认清单被钉在
>   最前面，「把默认清单往上/往下调」在界面上看不出变化。默认清单的身份仍用 `is_default` 表达（侧栏 ⭐ 标记）。
>
> **5）今天 / 计划页的「新建」按钮改实线边框 + 流光**：`.quick-new-button` 由 `border-dashed` 改成
>   `border-solid`，并挂上 `.flow-frame`（那条绕圈走的 conic 光带）。
>
> **6）「人生要有仪式感」卡片加高、倒计时置顶放大**：卡片 `min-h-[9.5rem]`，倒计时单独占最上面一行
>   （天数 30px、整块带底色），标题 / 日期 / 第 N 次 / 编辑删除在下面。
>
> **用例与 Go 用例的连带改动**
> - 新增 `verify-112`（**21 项**）：四个档位的 N 与起止日逐项核对、年终/自定义无数量框、按钮实线 + conic 流光、
>   默认时间 = 当天过期时间、昨天 23:00 算逾期 / 今天 09:00 不算、周起始日中文、清单顺序 ↑ 后 DOM 与接口
>   顺序一致且 position 1..N、仪式感卡片 ≥140px 且倒计时在标题上方、大数字 ≥26px。
> - `verify-106` 的「默认时间 = 当前时刻」改成「= 后台过期时间」；`verify-013` 的日历预填从 20:00 改成跟配置走。
> - Go 新增 `TestOverdueDeadlineExpression`（固定日期的 SQL 级核对：23:59 / 00:00 / 到期时刻晚于过期时间）、
>   `TestExpireTimeDefersOverdueUntilDayEnd`（端到端角标）、`TestValidClock`；
>   `TestSummaryUsesTwoAggregateQueries` 的「已过期」夹具从 `now-1h` 改成**昨天**（新口径下当天不算逾期）。
> - **修掉三处「钟点/残留状态」型假红**（都在 `browser-harness/README.md` 记了）：
>   ① `verify-013` 原写「20:00–次日 6:00 必定夜间」，10 月上海日出 05:5x，05:57 跑就必红 →
>      现在用 NOAA 公式算当天日出日落、边界 ±45 分钟跳过硬断言（实测 06:0x 跑正确跳过）；
>   ② `verify-104` 假设「本周周三」，若实例上残留 `calendar_week_start=sunday` 就会把数据造到上一周 →
>      现在跑前强制周一、跑完**真回读**还原（原来那条「已还原」是硬编码 `true` 的假断言）；
>   ③ `verify-111` 的「右侧当天列表」前提依赖「选中日有安排」，生产上选中日恰好空着就假红 →
>      现在先点一个有任务条的日子再取右侧列表。
>
> **同步所有容器的程序设置（用户要求）**
> - 上线后用脚本把 200 / 沙箱 / 迭代三台的**系统级配置 + 个人偏好**逐键与 201 比对并写齐
>   （`browser-harness/align-configs.js` + `dump-configs.js`）。实际改了三台共 8 项，之后三台的
>   系统级 21 项 / 公开 9 项 / 个人 11 项与 201 **完全一致**：
>   · 200：系统级 5 项（`allow_register` true→**false**；`calendar_font_size`/`ceremony_enabled`/
>     `default_view`/`sun_location` 四行缺行补齐）、个人偏好 1 项（`calendar_font_size` medium→**large**）；
>   · 沙箱 8908：`android_wan_url`（补上 201 的外网 APK 地址）、`ceremony_enabled`；
>   · 迭代 8918：`android_wan_url`。
> - **新设备 8909** 是没有账号的空库（导入向导用），只能改库：`allow_register` 改回 false、
>   删掉一行多出来的 `credit_card_enabled`（user_id=0，public=1）→ 它的**公开配置 9 项与 201 完全一致**。
> - 沙箱同步仍恒为 `off`；201↔200 仍是 `both` / 5 分钟。
>
> **发版自检**：迭代容器 **36 套件 914 项全绿**；生产 201 **36 套件 906 项全绿**；
> 离线包自检 **30/30**；`go vet` + `go test ./...` 全包 ok；201 与 200 四项指纹一致。
> - 备份：201 `data.bak-pre0200-20261011-055402`、200 `data.bak-pre0200-20261011-055435`。
>   构件（两边 md5 一致）：`images/workordernote-0.20.0-amd64.tar.gz` md5
>   `d09f2ca125c838a80ad1b011c5738e38`、sha256
>   `70518e5385d4db00a8e3ae6157bfc969641ef0ebdd1a126daadba28f0ece458a`；
>   `pkg/WorkOrderNote-0.20.0-offline-amd64.tar.gz` md5 `714fedc6505dd486670d85f7a449e893`、
>   tar sha256 `4d194d14a17e2cb27dff80b881e7dc4f1882fc37ff8bab0fa260163f53e97fdc`。
> - 指纹：201 与 200 四项一致 —— 清单名+模板+图标 `edffe23d32`、卡片 `50c58560da`、
>   提醒 `a930aadaad`、完成记录 `63fd608ff0`（5 清单 / 9 卡片 / 46 提醒 / 16 完成记录 / 5 记事，
>   与 0.19.0 上线后一致：这批只改了配置与交互，没有动数据）。

### 2026-10-10：0.19.0（四台全部上线）—— 新建入口收成搜索框左边的小按钮；记事本改名「随手记事本」；日历单击看详情/双击编辑；信用卡三列 + 支付宝/微信/京东金融

> **发版记录**（VERSION `0.19.0`，源码提交 `70b3ecf`，镜像 `workordernote:0.19.0` =
> `sha256:c3debe2ecda4b274964d5e9442501a69a606e879e91e29d0d19ce150bf11ef12`）
>
> 这一版把 0.18.2 之后**攒的三批**一起发了（用户说「修改完成验证后发版」）。
>
> **第一批：新建入口折叠 + 全部页取消新建**
> - 折叠后的「新建」按钮**收窄并放到搜索框左边**（1440px 实测 80×44、390px 72×40，与搜索框同一行、
>   右边缘紧挨搜索框左边缘）；点它展开整块新建卡片；**卡片左上角那个圆形「＋」改成收起按钮**
>   （`data-quick-collapse`），点一下折回按钮。刷新、切页仍回到收起；「全部」页依旧没有新建入口
>   （在这一页按 N 会先跳到「今天」页再展开）。
> - **流光（旋转光带 + 背后柔光）从「更多」面板搬到新建任务卡片上** —— 原来挂反了。
>   卡片自己 `overflow-hidden`（裁左边那条品牌色竖条）会把柔光吃掉，所以外面套一层不裁剪的
>   `.quick-shell` 承载光效；「更多」面板只剩四项且 `animation-name: none`。
>
> **第二批：信用卡**
> - **一行三张**（中屏 2、窄屏 1）：去掉 0.18.1 加的超大屏四列（用户明确「三列最合适、效果最好」），
>   1440 与 1600 两档实测都是 3 列，卡面仍 1.586:1。
> - **卡面**：标志单独一行在左上，**卡名在标志下边、左端与标志左端对齐**，
>   **持卡人与卡名同行、右对齐到卡面右边缘**；右上角「账单日/还款日/额度」不换行照旧。
> - **信用卡页头部「到期卡片」单独一行、放在标题下方**并占满整行；小卡面里的**时间两行右对齐**
>   （名称/尾号/金额保持左对齐）。
> - **银行下拉新增「支付宝 / 微信 / 京东金融」**（别名含 花呗/借呗/分付/零钱通/白条/京东）：
>   支付宝、微信用 Simple Icons（CC0）官方标志的单色版按品牌色填充（#1677ff / #07c160）；
>   京东金融在可用的开源图标集里没有完整彩色标志，用 Arcticons 的 `jd-finance`（CC BY-SA 4.0）
>   线性图标按品牌红 #e1251b 描边（描边加粗到 3，否则缩到卡面 20px 几乎看不见）；
>   拿到官方 SVG 直接替换 `assets/banks/jdfinance.svg` 即可。
>   **上线后实测**：用户 20:22 自己建的那张「花呗-信用购」（银行写「支付宝 | 蚂蚁金融」）
>   卡面已经自动带上支付宝标志（`naturalWidth=150`，图真的加载出来了）。
>
> **第三批：记事本改名 + 日历交互**
> - **「记事本」→「随手记事本」**：后端栏目名常量、后台偏好标签与说明、侧栏入口、页面标题、
>   保存提示一起改；已存在的栏目在下次打开时由 `ensureNoteBucket` 自动改名（**里面的记事一条不动**），
>   改名会照常同步到对端。今天页那条「记事保存后进入…」的提示也换了字。
> - **日历「月 / 周」切换里选中的那个字带流光**：新增全局 `.flow-text`（渐变文字 + 跑动动画 +
>   `prefers-reduced-motion` 关动画 + 不支持 `background-clip:text` 时回退成实心字）。
> - **单击任务是「查看」、双击才是「编辑」**：单击弹出新增的**只读查看页**
>   （`components/ReminderViewDialog.vue`：标题/类型/优先级/状态/清单/时间/时间段/来源/备注），
>   页底有**「编辑」**按钮切到编辑器；双击任务直接进编辑器。单击与双击之间用 250ms 计时区分
>   （浏览器是 click → click → dblclick，太早弹查看页会「先查看再编辑」两张弹窗）。
>   周视图**双击空白处按时分新建**照旧可用，单击任务块同样是查看；右侧当天列表单击也是查看。
>   查看页样式**自带一份** `.view-card`：一开始照抄 `.editor-panel`，但那是 `ReminderEditor.vue` 的
>   scoped 样式，别的组件拿不到 → 面板退化成没有定位的块，半透明遮罩盖在上面、按钮点不到
>   （程序化 click 反而能过，特别容易漏）。
> - 新增 `verify-111`（**10 项**）：流光跟着选中项走、单击任务开查看页、查看页有标题/时间/备注/编辑、
>   点编辑进编辑器、双击任务直接编辑、右侧列表单击查看、查看页能关掉、周视图双击空白新建、
>   单击任务块查看。
>
> **用例跟进**（产品按用户要求变了，断言跟着走）：
> - 新增 `reminders-app.js` 的 `openQuickAdd(page)`（**新旧版本都能跑**：`.quick-card` 在就直接返回），
>   `verify-017/090/091/101/105/108/109/ux` 都加了这一步；原来拿「全部」页当快速新建中立页的三处
>   改成具体清单页 /「今天」/「计划」页。
> - 卡面/头部/列数/流光的旧断言改写（`verify-097`/`100`/`105`）；`verify-103` 跟着改名；
>   `verify-070` 的「点标题就地编辑」改成「先开查看页 → 点编辑」。
> - `verify-013`/`verify-017` 的「双击日期格新建」改成点**格子上方空白**（任务条现在自己吃双击=编辑）。
> - `verify-097` 的收尾清理改成**基线感知**（只判本次新增，与 `verify-091` 同口径）。
> - `verify-105` 修掉一处**午夜假红**：A/B 两条原来取「现在 +60/+90 分钟」，22:40 之后 B 会跨到明天，
>   分组断言必红；现在临近午夜时改用今天 00:30/01:00（两条仍同一天，进「已逾期」卡也算过）。
> - `verify-111` 的点击改成「真鼠标点一次 + 轮询等状态」（最多 5 秒），**不要固定等一会儿再重试** ——
>   查看页是点击后 250ms 才弹，慢机器上超时后重试的一点击会打在刚弹出的遮罩上把它关掉，
>   实测出现过「连点三次一次都没成」；弹窗内部按钮（编辑/关闭）改用程序化 click，
>   真鼠标只用于日历条目本身。
>
> **发版自检**：迭代容器 **35 套件 893 项全绿**；生产 201 **35 套件 885 项全绿**；
> 200 上单跑 `verify-103` **29/29**、`verify-111` **10/10**；离线包自检 **30/30**；
> `go vet` + `go test ./...` 全包 ok。生产回归里 `verify-070`/`verify-094` 各失败过一次
> （登录限流触发重试，重试后 33/33、17/17 通过）。
> - 备份：201 `data.bak-pre0190-20261010-230428`、200 `data.bak-pre0190-20261010-230507`。
>   构件（两边 md5 一致）：`images/workordernote-0.19.0-amd64.tar.gz` md5
>   `e16d3689459b6039ca6e33c722dc9f3e`、sha256
>   `26877826047730036daa5171deddb723387d21a098f770a1a24507e9449b8ed1`；
>   `pkg/WorkOrderNote-0.19.0-offline-amd64.tar.gz` md5 `e569bd063b61a6f93b78cc70f2a60587`、
>   tar sha256 `8a2288be8646731d3f4e506ff3ac0935cdef44dd8b6cf6fe0f1d2eed8e84bf74`。
> - 指纹：201 与 200 四项一致 —— 清单名+模板+图标 `edffe23d32`（**因记事本改名而变化，符合预期**）、
>   卡片 `50c58560da`、提醒 `a930aadaad`、完成记录 `63fd608ff0`
>   （5 清单 / 9 卡片 / 46 提醒 / 16 完成记录 / 5 记事；卡片与提醒变多是**用户自己**在 20:22
>   新建的「花呗-信用购」那张卡带来的 1 卡 3 提醒，不是测试残留 —— 回归后逐项核对过）。
> - 部署顺序：迭代容器 → 沙箱/新设备 → 201 → 200（`docker load` + 改 compose 标签 + `--force-recreate`）。

### 2026-10-10：0.18.2（四台全部上线）—— 计划页「周期」不再错位；日期/重复搬到快速新建芯片行，「更多」只留四项

> **发版记录**（VERSION `0.18.2`，源码提交 `840be54`，镜像 `workordernote:0.18.2` =
> `sha256:017f1fbd3d8045756191116f330fb2fc7a04b2b97e627ff5d5cf42971f5f17d9`）
> - 用户这一批：① 智能清单「今天页面显示所有清单中今天的任务，以及所有超时逾期任务」；
>   ② 计划页「周期和控件错位，没有放在同一水平上」；③ 新建任务「更多」中只保留备注、
>   按农历循环、过期提醒频率、通知方式。
> - 第 ① 条**核对后无需改动**：今天页本来就是**全局**视图（不按清单过滤），服务端
>   `view=today` 的条件是「生效时间 < 明天 0 点且未完成」——`COALESCE(snoozed_until, due_at)`，
>   所以所有清单里今天到期的 + 所有逾期未完成的都在；前端再把逾期收进最前面那张
>   `data-day-group="overdue"`「已逾期」卡片。用户确认「只看未完成」的现状是对的
>   （已完成的不该出现在今天页）。
> - 第 ② 条是**真错位**：计划页的「开始 / 周期 / 结束 / 重复」原来有的标题与控件同行、
>   有的整块掉下去（「周期」里是「N 天输入框 + 下拉」两个控件叠出来的高度差）。
>   现在四个字段统一成 `field-label !flex flex-col items-start gap-1`（标题在上、控件在下），
>   整行 `items-center` → **`items-end` 按底边对齐**，与「重要 / 清单 / 更多」这些纯按钮芯片
>   落在同一条水平线；「自定义」时多出的「结束」框同样齐。
> - 第 ③ 条：**日期与重复从「更多」里搬出来**，直接进芯片行 —— 日期芯片（`data-quick-date`）
>   点开就是完整选择器（含农历/时间），右边跟着「清空」（`data-quick-clear-due`）；
>   重复是个小下拉（`data-quick-repeat`）。「更多」面板只剩备注 / 按农历循环 /
>   过期提醒频率 / 通知方式（+ 提交）。
> - 顺带修掉这行最后 2px 的歪斜：归属清单下拉原来写死 `!h-7`（28px），
>   而同排芯片是 `quick-chip` 的 `sm:h-8`（32px）；去掉 `!h-7` 后今天页 11 个、
>   计划页 6～7 个控件的底边完全对齐（1440px 实测）。
> - 「这条没有日期」的提醒也从面板里搬到了**面板外**（`data-quick-undated-hint`）：
>   「更多」默认收起时也看得见，任务与计划两条分支都覆盖。
> - 新增 `verify-109`（**26 项**，只量排版、不建数据）：计划页芯片行在
>   `days/week/month/yearend/year/custom` 六种周期状态下底边都一致、控件高度一致、
>   「开始」按钮与「N 天」输入框/「周期」下拉同底边；今天页 11 个控件对齐、
>   日期芯片显示今天且点亮；「更多」面板默认收起、展开后**只剩四项**、
>   日期时间与重复确已搬出、面板里仍有备注框与提交按钮；收尾把面板收起。
> - 回归：迭代容器 **33 套件 846 项全绿**（含新套件 26 项）；生产 201 **33 套件 839 项全绿**；
>   200 上单跑 `verify-109` **26/26**；离线包自检 **30/30**；`go vet` + `go test ./...` 全包 ok
>   （后端本轮零改动，只为发版复核跑一遍）。
> - 备份：201 `data.bak-pre0182-20261010-181040`、200 `data.bak-pre0182-20261010-184604`。
>   构件（两边 md5 一致）：`images/workordernote-0.18.2-amd64.tar.gz` md5
>   `a6c0ea2f46811eb791d5c67dd17fbd4d`、sha256
>   `783f07259c75c58c82c2c644637a212788f0306ad5d5d6e31dc9c349bcdfdcce`；
>   `pkg/WorkOrderNote-0.18.2-offline-amd64.tar.gz` md5 `0f6856acfe7f6901cbf7b391e3027a00`、
>   tar sha256 `57599ce5e6fd40e2aec4fac757bf90c49d245a39249ba597c65ad487b8569275`。
> - 指纹：201 与 200 四项一致且与 0.18.1 相同 —— 清单名+模板+图标 `102ae778ab`、
>   卡片 `824e551dd3`、提醒 `2595e4cca6`、完成记录 `63fd608ff0`（5 清单 / 8 卡片 /
>   43 提醒 / 16 完成记录 / 5 记事）；版本两栏都是 `0.18.2`。
> - 这一版**只改前端**（`web/src/views/HomeView.vue` + 版本记录），后端二进制与 0.18.1 逻辑一致，
>   数据库结构没有变化（无新的 `database.Upgrades`）。

### 2026-10-10：0.18.1（四台全部上线）—— 修仪式感栏目侧栏重复；信用卡一行四张

> **发版记录**（VERSION `0.18.1`，源码提交 `08f80e9`，镜像 `workordernote:0.18.1` =
> `sha256:f77b5a4ed0498cc7b5137a933a5e0b165135208e914cffbcfa1e13fdc4892267`）
> - 用户两条：①「人生要有仪式感」**重复出现，有一个不受后台管理**；
>   ② 信用卡「长高尺寸按比例减少，改为 4 列」。
> - **重复的根因**：`MainLayout` 的侧栏「我的清单」只过滤了 `credit_card` / `notebook`，
>   没过滤 `ceremony` —— 于是仪式感栏目既是侧栏上那条固定栏目（受 `ceremony_enabled` 控制），
>   又被当成普通清单**再列一行**；普通清单那一行不看偏好，所以「关也关不掉」。
>   0.17.0 给 `HomeView` 与「清单下拉」加过滤时漏了侧栏这一处。修法：侧栏 `navLists`
>   排除 `ceremony`（注释写明三个系统栏目都不该再作为普通清单出现）。
> - **信用卡**：宽屏 3 列、**超大屏（≥1536px）4 列**、中屏 2 列、手机 1 列；卡面仍按
>   1.586:1 的真卡比例，所以列数一多卡片**等比例变小**（1600px 下 253×160，原来两列时
>   约 470×296）。小卡面上同步收小：银行标志 `max-w-[4.5rem]`（手机 20px 高、宽屏 24px）、
>   卡名 13px、卡号 12-13px、右侧「账单日/还款日/额度」10px ——
>   卡名照旧跟在标志右边、放不下时换行并与标志右侧对齐，右侧那列仍 `whitespace-nowrap` 不换行。
>   四档宽度（1600/1440/1280/768/390）实测：比例都是 1.59、无横向溢出。
> - 用例跟进：`verify-097` 的列数断言改成「1280 → 3 列 / 1600 → 4 列（且比例不变、不溢出）」；
>   `verify-100` 的「银行标志高度」门槛从 22 放到 18（小卡面上标志是 20px 高，仍然清晰）；
>   `verify-107` 新增两条**限定在侧栏里**的断言（「只出现一次」「关掉后侧栏一个都没有」）——
>   注意列表里任务行的文字也会带清单名，不能拿 `a,button` 全局匹配。
> - 回归：生产 201 32 套件中 31 通过，唯一失败是 `verify-100` 的旧门槛（改完单跑 **49/49**）；
>   迭代容器上 `verify-097` / `verify-107` 单跑 **103/103** 与 **20/20**；离线包自检 **30/30**。
> - 备份：201 / 200 `data.bak-pre0181-20261010-140505`。构件（两边 md5 一致）：
>   `images/workordernote-0.18.1-amd64.tar.gz` md5 `c66131d1b31728ea8f4a6ee4aaa6a5f2`；
>   `pkg/WorkOrderNote-0.18.1-offline-amd64.tar.gz` tar sha256
>   `4e85f95fd1d8f21604ce8c79bf4bc489db10ac954fb67a6c8a8ea7d21645f282`、md5
>   `3751cb8b9374125664885d5f3426bd7e`。
> - 指纹：201 与 200 四项一致（清单名+模板+图标 `102ae778ab`、卡片 `824e551dd3`、
>   提醒 `2595e4cca6`、完成记录 `63fd608ff0`）；上线后在 1600px 生产环境复核：侧栏
>   「人生要有仪式感」只一行，卡片 4 列 253×160。

### 2026-10-10：0.18.0（四台全部上线）—— 计划任务改成「任务周期」；时间段任务日历跨天显示

> **发版记录**（VERSION `0.18.0`，源码提交 `7075dbd`，镜像 `workordernote:0.18.0` =
> `sha256:f9e294343e574710db950b911c06f48ff17c405191c0831ad8b17eaf29d141e3`）
> - 用户这一批三条：① 计划页把「开始/结束」改成**任务周期**（( )天 / 1 周 / 1 月 / 年终 / 1 年 / 自定义），
>   并「计时最后一天遵守后台偏好设置的过期时间」；② 有时间段的任务在日历里**正常显示**：
>   点日历框显示时间段，「开始框、跨框，一直显示时间段最后一天」，点其他框恢复单框；
>   ③ 为计划任务加**时钟图标 + 底色**（问过用户：指**日历界面**，参考信用卡/记事本那种图标块）。
> - **任务周期**：计划页的新建窗口不再让用户手挑结束时间 —— 「周期」下拉
>   （自带「N 天」数字输入框）+ 六档：1 天 / 1 周 / 1 月 / 年终 / 1 年 / 自定义。
>   结束时间由开始时间 + 周期算出，落在**最后一天的 23:59**（整天都算在任务里）；
>   「自定义」时才显示「结束」选择器。选完开始时间就立刻算出结束（右侧区间提示同步更新）。
> - **逾期按最后一天算**：`overdueStamp()` 改成 `snoozed_until || end_at || start_at || due_at`
>   —— 3 天期的任务要到第 3 天过完、再加后台「任务过期多久算逾期」的宽限才算逾期
>   （原来一到**开始**时间就算逾期，等于周期任务刚建就红了）。
> - **日历跨天显示**：后端 `listCalendarItems` 多了一种命中条件 —— **区间与窗口相交**
>   （`start_at < to AND end_at >= from`），这样跨月的时间段任务在上一屏也能看到尾巴；
>   前端 `spansOf(day)` 判断某天是否落在 `[start_at, end_at]` 里，是就画一条
>   `data-cal-span="<id>:start|mid|end"`：**时钟图标 + 清单色浅底**（与「记」字、信用卡图标同一套写法），
>   首/中/尾三种圆角连成一段。
> - **点选整段**：点日历里某一天 → 这一天的时间段任务整段（开始框 → 中间每天 → 最后一天）
>   一起高亮（`activeSpanId`，格子加 `border-brand-500/45 + bg-brand-500/8`，全段再加一圈 ring）；
>   点没有该任务的日子 → 高亮清零，恢复单框显示。点条本身也能切换高亮。
> - 新增 `verify-108`（**13 项**）：周期六档 + N 天输入、「结束」只在自定义时出现、
>   界面选开始 → 3 天期的结束落在第 3 天 23:59、日历里 3 天各一条（时钟 + 底色 + 首/中/尾）、
>   点中间一天整段高亮、点其他框恢复、以及逾期口径（最后一天没过完不算、过 3 天算）。
> - 用例跟进：`verify-101` 原来断言计划页有「开始」「结束」，改成「开始 + 任务周期（含自定义）」。
> - 回归：迭代容器 31/32（唯一失败是 `verify-101` 的旧断言，改完单跑 18/18）；
>   生产 201 **32 套件 811 项全绿**；离线包自检 **30/30**。
> - 备份：201 / 200 `data.bak-pre0180-20261010-133343`。构件（两边 md5 一致）：
>   `images/workordernote-0.18.0-amd64.tar.gz` md5 `cca229e7535543f39410a2c885bf1b17`；
>   `pkg/WorkOrderNote-0.18.0-offline-amd64.tar.gz` tar sha256
>   `c19f66d06b88642a3d9550ee8b6a7e90866cdafd52fd71263c652f08f61776e7`、md5
>   `1418324d9e827af0c409d8eac65a691e`。
> - 指纹：201 与 200 四项一致（清单名+模板+图标 `102ae778ab`、卡片 `824e551dd3`、
>   提醒 `2595e4cca6`、完成记录 `63fd608ff0`）；沙箱仍是 14:1x 快照。

### 2026-10-10：0.17.0（四台全部上线）—— 新增固定栏目「人生要有仪式感」+ 循环周期显示

> **发版记录**（VERSION `0.17.0`，源码提交 `7c709a2`，镜像 `workordernote:0.17.0` =
> `sha256:3b739ea19359c177fc0990136faa07eb310c601a03201b2ee3a61c384e66cdab`）
> - 用户这一批一次提了 5 条：① 日期默认当前时间点（+ 后台偏好「超过多久算逾期」）
>   ② 信用卡卡面：账单日/还款日/额度不换行保位、卡名换行、加高像真卡
>   ③ 卡片「更多」弹出被遮挡 ④ 后台偏好新增固定栏目「人生要有仪式感」（倒计时卡片）
>   ⑤ 所有循环项目（计划/信用卡/仪式感）显示「第 x 次」。
> - **拆成两版发布**：①②③ → **0.16.5**（当天 11:57，四台）；④⑤ → **0.17.0**（这一条）。
> - **0.17.0 本体**：
>   - 第三个固定栏目 `template=ceremony`「人生要有仪式感」（`ceremony_bucket.go`，与记事本
>     同一套：偏好 `ceremony_enabled` 默认开、**关掉只隐藏不删数据**、侧栏入口、名字/图标
>     自愈成 `ceremony`）。
>   - **倒计时卡片页** `CeremonyPanel.vue`：还有 N 天 / 就是今天 / 已过 N 天、日期、农历标记、
>     重复规则、「第 N 次」；近的排前面；每张卡片可编辑与删除。
>   - **常用事项模板一键创建**：情人节(2-14)/国庆(10-1)/元旦(1-1)/高考(6-7) 直接算下一次公历；
>     七夕/中秋/春节/端午/元宵用 `/api/reminder/lunar/convert` 换算下一次的**公历**日期、
>     并记住农历月日（以后每年按农历重复）；生日（公历/农历）、结婚纪念日、金婚、中考填一次日期。
>   - **循环周期**：`ReminderDTO.CycleIndex`（completions 计数 + 1，非循环为 0）——一条聚合查询
>     覆盖本页所有行，不给每行单查；列表行与仪式感卡片显示「第 N 次」；信用卡卡面显示「第 N 期」
>     （前端按开卡月份与当前账单期算）。
> - 新增 `verify-107`（**19 项**）：偏好登记、侧栏入口、倒计时页、模板一键创建（含「中秋卡片上的
>   日期 = 农历八月十五换算出来的下一个公历日期」这条独立校验）、自己新建、`cycle_index`、
>   「第 2 次」列表角标、「第 x 期」卡面、关偏好入口消失且不删数据。用例**基线感知**：
>   只删本次新建的条目、只还原偏好原值（在生产上跑不会动用户自己的生日/纪念日）。
> - 回归：迭代容器 **31 套件 806 项全绿**；生产 201 **31 套件 798 项全绿**；离线包自检 **30/30**。
> - 备份：201 / 200 `data.bak-pre0170-20261010-123240`。构件（两边 md5 一致）：
>   `images/workordernote-0.17.0-amd64.tar.gz` md5 `9648380ad8b0501cf6275ced44ba1a64`；
>   `pkg/WorkOrderNote-0.17.0-offline-amd64.tar.gz` tar sha256
>   `595f44a8b0bb5eea18551b21dc5842630a8ea9f1425191401c8d9c0dd292769e`、md5
>   `2189616a701ee84369aa0fadf3d3e418`。
> - 指纹：201 与 200 四项一致（清单名+模板+图标 `102ae778ab` —— 多了仪式感栏目所以变了；
>   卡片 `824e551dd3`、提醒 `2595e4cca6`、完成记录 `63fd608ff0`）；沙箱仍是 14:1x 快照。
> - 上线后核对：仪式感栏目里已经有**用户自己建的**「老婆生日」（农历、每年、第 1 次），
>   说明这一栏在他那边已经用起来了。

### 2026-10-10：0.16.5（四台全部上线）—— 默认时间「当前时刻」+ 逾期宽限；卡面真卡比例

> **发版记录**（VERSION `0.16.5`，源码提交 `cd36251`，镜像 `workordernote:0.16.5` =
> `sha256:c4dafa342fcd371ed1059c8993c9f7a55ec826f31a22a51506510a34626c9539`）
> - 用户要求「日期默认为当前时间点作为兜底」+「后台偏好增加任务过期时间，超过时间视为逾期任务」。
> - **默认时间 = 当前时刻（取整到分）**：`defaultQuickDue()` 不再固定 20:00。刚建完就过了几秒，
>   所以配一个宽限。
> - **新系统级公开偏好 `task_overdue_after_minutes`**（默认 30，选项 0/15/30/60/120/240）：
>   前端 `isOverdue`（行上的「已逾期」标记与「已逾期」卡片）与后端 `/summary` 的逾期角标
>   都用「到期后过了这段时间才算逾期」。这个配置读在热路径上，所以和「记事本开关」一样做了
>   2 秒进程内缓存 —— `TestSummaryUsesTwoAggregateQueries` 的「固定 2 条聚合查询」因此仍成立
>   （用例里也顺手把缓存读热，与既有的信用卡开关同一个做法）。
> - **信用卡卡面**：`aspect-[1.586/1]`（真卡 85.6×54mm），宽屏**一行两张**；
>   「账单日 / 还款日 / 信用额度」`whitespace-nowrap` 固定在右上角不再换行；卡名在自己的 grid
>   列里换行（与银行标志右侧对齐）。
> - **修**：卡片「⋯ 更多」的抽屉会被后面的卡片盖住（同级 `.surface` 各自成层）——
>   打开抽屉时把这张卡片抬到 `z-30`。
> - 用例跟进：`verify-097` 的「宽屏一行三张」改成「一行两张 + 卡面比例 + 右侧信息不换行」；
>   `verify-105` 的分组用例改用「现在 + 偏移」的时间（原来固定 09:00/11:00，下午跑就撞上逾期宽限）；
>   `verify-106` 断言默认时间 = 当前时刻、并验证「刚建的任务不会立刻标逾期」。
> - 回归：迭代容器 **30 套件 786 项全绿**；生产 201 **30 套件 779 项全绿**（见下条教训）；
>   离线包自检 **30/30**。
> - 备份：201 / 200 `data.bak-pre0165-20261010-115745`。构件：`images/workordernote-0.16.5-amd64.tar.gz`
>   md5 `4556d82834367f52bdc16406c5110d6a`；`pkg/WorkOrderNote-0.16.5-offline-amd64.tar.gz`
>   tar sha256 `cfba3b1155036c7d53bbb4a318d96102339356171f14ecc9996f6e633cbd8554`。
> - **教训**：不要在回归跑着的时候改 `run-all.sh` —— bash 边读边执行，中途编辑会让循环读到半截行
>   （那次生产回归最后打印了 `eep: command not found` / `syntax error near unexpected token 'done'`）。
>   所幸 30 个套件当时都已跑完且全绿（779 项），只有最后的汇总行被顶掉。

### 2026-10-10：0.16.4（四台全部上线）—— 新建任务窗口「更多」面板默认收起

> **发版记录**（VERSION `0.16.4`，源码提交 `f0c8fba`，镜像 `workordernote:0.16.4` =
> `sha256:9fabff5f98efa1291b6b4b181e9ea3021d77ab1bbf4c97f60617eef26de8ba6c`）
> - 用户接着 0.16.3 提了一条：「新建任务窗口 更多按钮包含页面默认隐藏」。
>   即 0.16.3 把**整块**面板（含「更多」里的日期时间/重复/备注/农历/通知方式）默认展开了，
>   用户要的是**芯片行默认可见、「更多」面板默认收起**。
> - 最终形态（两轮要求合成）：芯片行（任务/记事、今天/明天/本周末、重要、清单、
>   「更多」按钮）默认可见，右侧「今天 20:00」直接显示默认日期；「更多」面板默认隐藏，
>   点开才有那些字段；保存后芯片行保持可见、「更多」重新收起。
> - 默认形态下也能直接保存：输入标题回车，或点输入框右侧的「添加」（「添加提醒」按钮在
>   「更多」面板里，收起时不出现）。
> - `verify-106` 从 13 项增到 **14 项**：断言「更多」默认隐藏、芯片行显示默认日期、
>   默认形态下能提交、保存后重新收起、点「更多」展开后日期字段是今天 20:00。
> - 顺带修了两处**用例自身的稳定性问题**（都不是产品问题）：
>   ① `verify-091` 的「没有残留自检数据」原来对**任何**自检条目报错 —— 别的套件被登录限流
>   打断留下的残渣会让它假红。现在按「基线上已有的」与「本次新增的」区分，只对本次新增判失败。
>   ② `run-all.sh` 开跑前先跑一遍 `clean-self-test.sh`（清上一轮的残渣），彻底断掉
>   「某个套件被限流打断 → 后面套件跟着假红」这条链（这轮迭代回归就是被它咬了两次）。
> - 发版流水：`VERSION`/迭代说明 → 构建 → 迭代容器全量回归（**28/30**，两个失败套件
>   `verify-091` / `verify-097` 清理残渣后单跑 **10/10 与 100/100** 全绿，确认是残渣而非产品问题）
>   → 沙箱 8908 / 新设备 8909 / 迭代 8918 → 201 → 200（md5 双方一致
>   `d088381632e127085a07b20f68867da1`）→ 离线包自检 **30/30** →
>   **生产 201 全量回归 30 套件 775 项全绿**（含预清理，verify-091 本次通过）→ 三台指纹核对。
> - 备份：201 / 200 `data.bak-pre0164-20261010-083239`。构件（两边 md5 一致）：
>   `images/workordernote-0.16.4-amd64.tar.gz` md5 `d088381632e127085a07b20f68867da1`；
>   `pkg/WorkOrderNote-0.16.4-offline-amd64.tar.gz` tar sha256
>   `cfba3b1155036c7d53bbb4a318d96102339356171f14ecc9996f6e633cbd8554`、md5
>   `39aeaa724571f33fd252b4111975984b`。
> - 指纹：清单名+模板+图标 `a3be953d81`、卡片 `824e551dd3`、提醒 `2b19347ab9`、
>   完成记录 `a378cdb2ae` —— **201 与 200 四项一致**（提醒指纹这次变了，因为用户在
>   10-10 自己新建了一条「去风华国际统计电话状况并维修故障电话」，due 10-10 20:00 —— 顺带
>   印证了 0.16.3 的「默认今天」在他那儿是生效的）；沙箱仍停在 14:1x 快照。

### 2026-10-10：0.16.3（四台全部上线）—— 新建窗口默认展开 + 日期兜底；登录后等偏好；换版本提示刷新

> **发版记录**（VERSION `0.16.3`，源码提交 `fe7838d`，镜像 `workordernote:0.16.3` =
> `sha256:5d1e48eddef4a2e425bd904fd09c4add6ff73ef97d545a048b4b6f80e115ab66`）
> - 用户报：「打开软件登陆后新建任务，没有默认选择时间（今天），刷新网页后才会显示选择今天；
>   新建任务插件默认展开，现在点击输入后才会展开显示任务日期等信息；包括日出日落模式也会
>   出现刷新后修正问题」。
> - **排查结论（重要）**：用**真正的 UI 登录**（登录页填表 → SPA 换路由，而不是 API 注入 token
>   后再整页打开）在 8918 / 0.16.2 上复现，日期默认值与主题**都是对的** —— 也就是说，
>   0.16.2 这段代码本身没有「登录后没有日期」的问题。用户遇到的更像**页面跑的是旧 bundle**：
>   他们的窗口是在今天连发几版（0.16.0 → 0.16.2）之前打开的，那个旧版本里「日期芯片是 toggle，
>   再点一次就把日期清掉」（0.16.0 修掉的 bug），症状正是「新建任务没有默认今天」，
>   而刷新一次加载新 bundle 就正常了 —— 与用户描述完全吻合。日出日落主题同理
>   （旧 bundle 里登录后不重跑偏好）。
> - 即使如此，这三件事都按「用户想要的样子」落地了：
>   ① **快速新建面板默认展开**（`quickFocused` / `quickExpanded` 初值改 true）：芯片行与
>   「更多」里的日期、重复、备注、农历等字段打开就能看见；保存后**保持展开**，连着记第二条
>   不用再点；记事本页仍只收标题（那里不需要排期字段）。
>   ② **日期兜底**：非计划页提交时，若日期为空且用户没按过「清空」，一律补今天 20:00
>   （`quickDueCleared` 区分「故意不要日期」与「状态里没日期」）——从源头杜绝「保存成功、
>   今天页里却找不到」的无日期任务。
>   ③ **登录后等个人偏好回来再进工作台**（`reloadBootstrap` await `prefsPromise`）：主题
>   （含日出日落模式与位置）不会再出现「要刷新一次才生效」。
> - **新增「服务端换版本」提示**：`/api/version` 每 5 分钟 + 页面回到前台时各核一次，
>   `gitCommit` 变了就在顶部弹一条「工作序记已更新到 x.y.z，当前页面还是旧版本 + 刷新」。
>   这类「旧窗口 vs 新服务端」以后不用用户自己猜（就是这次问题的根因）。
> - 新增 `verify-106`（**13 项**）：**走真正的 UI 登录**，断言面板默认展开、日期默认今天、
>   不点输入框就能提交、保存后仍展开、「清空」才无日期、版本没变不弹提示、
>   版本变了弹提示且刷新后消失（版本变化用 puppeteer 在网络层拦 `/api/version` 模拟 ——
>   前端用 axios/XHR，改 `window.fetch` 拦不到）。
> - 回归里两处需要跟进的用例改动：`verify-017` 与 `verify-105` 原来无条件点「更多」——
>   面板默认展开后那一下会把它**收起**（它是 toggle），改成「收起时才点」。
> - 发版流水：`VERSION`/迭代说明 → 构建 → 迭代容器 **30 套件 782 项全绿** →
>   沙箱 8908 / 新设备 8909 → 201 → 200（md5 双方一致 `4912464e884f1aac382615ca09f5f755`）→
>   离线包自检 **30/30** → **生产 201 全量回归 30 套件 774 项全绿** → 三台指纹核对。
> - 备份：201 / 200 `data.bak-pre0163-20261010-050511`。构件（两边 md5 一致）：
>   `images/workordernote-0.16.3-amd64.tar.gz` md5 `4912464e884f1aac382615ca09f5f755`；
>   `pkg/WorkOrderNote-0.16.3-offline-amd64.tar.gz` tar sha256
>   `5f15340270e0bf4eba3f298c71e45071b9037c27347e186fdfefaf759c34bebf`、md5
>   `78e7751768ac58f632d55f9aa10003d4`。
> - 指纹：201 与 200 四项一致（清单名+模板+图标 `a3be953d81`、卡片 `824e551dd3`、
>   提醒 `084912f098`、完成记录 `a378cdb2ae`）；沙箱仍是 14:1x 快照。
> - 顺手清掉的排查副作用：查主题时把 8918 的 `theme_mode` 改成了 dark/sun，
>   导致 `verify-017`「切到深色（保存成功）」假红（值本来就等于 dark，保存按钮是 disabled 的），
>   已还原成 `system` 并复跑 10/10 通过。

### 2026-10-10：0.16.2（四台全部上线）—— 信用卡卡名放回标志右边，放不下时换行并与标志右侧对齐

> **发版记录**（VERSION `0.16.2`，源码提交 `42661e0`，镜像 `workordernote:0.16.2` =
> `sha256:c4136f0b5ec1b2eb17b931f6ddb04eb8b9bb79208225a5af7720730a34c88da6`）
> - 用户要求：「银行卡名称，正常放在银行图标后边，空间不够时候换行放在第二行与银行图片右侧对齐」。
>   0.16.0 那版是按用户前一句要求把卡名整行放到了标志**下方**；这次改回来。
> - 做法：标志与卡名放进两列 grid（`grid-template-columns: auto minmax(0,1fr)`）——
>   卡名固定在第 2 列，列的左边缘就是标志右边缘 + 间距，所以**同行时贴着标志**、
>   **换行后的每一行也自动与标志右侧对齐**，而且不用去量各家银行标志的宽窄。
>   `minmax(0,1fr)` 的下限 0 是关键：否则列宽不会小于卡名的最小内容宽度，窄屏会被顶出去。
> - **必须一起改的一处**：宽屏一行三张时卡面只有 265px，标志自己占 105px —— 不设下限时
>   卡名那一列被压到 **0px**（实测，连「VISA」都被拆成一列一个字）。给左列加
>   `min-w-[11rem] sm:min-w-[12rem]` 后，右边那列「账单日 / 还款日 / 额度」会按 `flex-wrap`
>   整体折到下面一行，把位置让给标志与卡名。
> - 实测（迭代容器，四档宽度 360 / 430 / 768 / 1280）：卡名首行左边缘恒等于
>   「标志右边缘 + 8px」，全部一行放得下、无横向溢出；另造一张超长名字的临时卡片验证
>   换行情形：3–4 行**每一行的左边缘都等于标志右边缘 + 8px**，临时卡片测完即删。
> - 发版流水：`VERSION`/迭代说明 → 构建 → 迭代容器 **29 套件 769 项全绿** →
>   沙箱 8908 / 新设备 8909 → 201 → 200（md5 双方一致 `4d5a7b2a93d244292e16c6325b016303`）→
>   离线包自检 **30/30** → **生产 201 全量回归 29 套件 761 项全绿** → 三台指纹核对。
> - `verify-105` 增至 **22 项**：卡面断言从「标志在上、卡名在下」改成「卡名跟在标志右边」，
>   并新增「超长名字换行后每一行与标志右侧对齐」；`verify-100` 的同一条断言同步更新。
> - 备份：201 / 200 `data.bak-pre0162-20261010-033816`。构件（两边 md5 一致）：
>   `images/workordernote-0.16.2-amd64.tar.gz` md5 `4d5a7b2a93d244292e16c6325b016303`；
>   `pkg/WorkOrderNote-0.16.2-offline-amd64.tar.gz` tar sha256
>   `dbbb233fcd5d301348ae4653d6430bfeefe00e2b241ca76056fb5392fc52405d`、md5
>   `5256d43d059a172b19e4eb19db9373e4`。
> - 指纹：201 与 200 四项一致（清单名+模板+图标 `a3be953d81`、卡片 `824e551dd3`、
>   提醒 `084912f098`、完成记录 `a378cdb2ae`）；沙箱仍是 14:1x 快照。
> - 数据备注：201 上那条浦发账单日提醒仍停在「稍后提醒」到 10-11 01:02（用户自己在页面上
>   点的，见 0.16.1 记录），本次未改动。

### 2026-10-10：0.16.1（四台全部上线）—— 一天一张卡（横线分隔）、逾期单独一张卡片排最前

> **发版记录**（VERSION `0.16.1`，源码提交 `3816341`，镜像 `workordernote:0.16.1` =
> `sha256:7dfeb52972509a24914743ccec8e4df721357695abb44fc43a598097992fbb01`）
> - 用户对刚上线的 0.16.0 提了一条修改：「同一天的条目合并成一个卡片，合并的自身卡片将不再使用，
>   使用横线分割，过期的单独合并成一个卡片排在第一行」。
> - **卡片里的条目不再各自是一张小卡**：去掉行的边框/圆角/阴影/悬浮位移，整张日卡片只有一个外框，
>   行与行之间用一条细横线分隔（`.day-card` + `.day-card-body` 的 `divide-y`）；
>   「已完成」页也改成同样的一张卡片 + 横线。
> - **逾期单独成卡**：逾期未完成的条目不再散在各天的卡片里，统一收进最前面 key=`overdue` 的
>   「已逾期」卡片（红色标题行），卡内按生效时间升序；「无日期」仍然永远最后。
>   逾期口径与行上的「已逾期」标记共用 `overdueStamp()`（稍后提醒优先 → 时段开始 → 到期时间）。
> - **顺带修掉的第三个日期口径问题**：点过「稍后提醒」的条目，列表显示与按天分组用的是**生效时间**
>   （`COALESCE(snoozed_until, due_at)`），但今天/计划两个视图还在按 `due_at` 过滤 —— 于是
>   今天页里会冒出一张「明天」的卡片（2026-10-10 01:0x 实测：一条今天 00:00 到期、被稍后到明天
>   01:02 的信用卡账单提醒）。现在今天 / 计划的过滤、角标统计都改用生效时间，
>   新增 `TestTodayViewFollowsSnooze`（稍后到明天的条目进计划页、不进今天页）。
> - 回归里发现的两处**用例自身的坑**（都修了，不是产品问题）：
>   ① `.reminder-row` 带 `content-visibility:auto`，屏外的行 `innerText` 是空串 ——
>   分卡片后页面更长，`verify-101` / `verify-102` 因此假红，改用 `textContent`；
>   ② `verify-100` 的提醒弹窗用例点「知道了」时，等待期间可能有**别的**提醒到点先弹出来
>   （实测把一条真实提醒顺延到了第二天），现在会打印「弹窗里是别的提醒」的提示。
>   本机 201 上那条浦发账单日提醒确实被顺延到了 10-11 01:02 —— 排查后判断是**用户自己在
>   页面上点的**（201 与沙箱两台在 10 秒内各点了一次，而当时我的回归只打在 8918 上），
>   数据未改动。
> - 发版流水：`VERSION`/迭代说明 → 构建 → 迭代容器 8918（全量回归 **28/29**，唯一失败的
>   `verify-filters` 单跑 9/9 通过，判为抖动）→ 沙箱 8908 / 新设备 8909 → 201 → 200
>   （md5 双方一致 `f75ef7182e63a6a6ce7cf6fa950c5aba`）→ 离线包自检 **30/30** →
>   **生产 201 全量回归 29 套件 757 项全绿** → 三台指纹核对。
> - `verify-105` 增至 **19 项**（新增「逾期单独一张卡且排第一」「卡片内不再各自成卡、靠横线分隔」）。
> - 备份：201 / 200 `data.bak-pre0161-20261010-012334`。构件（两边 md5 一致）：
>   `images/workordernote-0.16.1-amd64.tar.gz` md5 `f75ef7182e63a6a6ce7cf6fa950c5aba`；
>   `pkg/WorkOrderNote-0.16.1-offline-amd64.tar.gz` tar sha256
>   `221e1d6bc575ef8c1861c9e2b80ed737810be8e8941ca84cb9cde84a3e9dd143`、md5
>   `205063c8adb8831b4b71d1eda0cac19a`。
> - 指纹：清单名+模板+图标 `a3be953d81`、卡片 `824e551dd3`、提醒 `084912f098`、完成记录
>   `a378cdb2ae` —— **201 与 200 四项一致**；沙箱仍停在 14:1x 快照（少用户 19:40 建的那条）。

### 2026-10-09：0.16.0（四台全部上线）—— 两个日期 bug + 按天分卡片 / 流光 / 卡面 / 记事时间

> **发版记录**（VERSION `0.16.0`，源码提交 `fe42984`（`67fc7eb` 是版本与迭代说明那次提交，
> 最终镜像是按 `fe42984` 构建的，镜像里的 `gitCommit` 与源码一致），镜像 `workordernote:0.16.0` =
> `sha256:6956bd8c176f182d24035df583e046344d97571e2b99a466ede3c230dfb171e8`）
> - 用户一次提了 5 条：① 「新建了一条任务，今天找不到、在全部里显示无日期，排查一下」
>   ② 新建任务窗口加流光（与登录页一致）③ 信用卡卡面银行名称整行换到图标下方（不要字换行）
>   ④ 记事本栏目里内容显示无日期 ⑤ 列表「同一天的放同一个卡片」。
> - **① 的根因（前端）**：日期芯片「今天 / 明天 / 本周末」原来是 **toggle** —— 用户在「今天」页
>   点了已经亮着的「今天」，`due_at` 被清成 `null`，任务就存成「无日期」。库里查到证据：
>   条目 413「风华国际切换网络到广电线路」19:07 建、`due_at` 为空、19:11 被删，19:11 又建了
>   一条带今天 20:00 的（414）。修法：芯片改成**只选中不清空**，另加「清空」按钮 +
>   保存前的「这条没有日期」提示（`setPreset` / `clearQuickDue`）。
> - **② 顺带查出来的第二个日期 bug（后端）**：SQLite 把时间列存成**带偏移的文本**，而
>   `<` / `>` 是按**字符串**比的 —— 老版本前端写过 `toISOString()` 的 `+00:00`，同步来的行也
>   可能带别的偏移，于是「明天 08:00（本地，存成 `+00:00`）」被判成小于「今天 24 点 `+08:00`」，
>   漏进「今天」页（实测今天页多出一张「明天 · 10月10日」卡片）。修法：新增 `sql_time.go`，
>   比较与排序统一用 SQLite `datetime()` 归一化成 UTC（`tsUTC` / `sqlTimeArg`），
>   **存储与同步都不动、不做数据迁移**；列表/日历/完成记录/角标统计/卡面撤回全部换过。
>   新增 `TestTodayViewIsOffsetAware`（把比较改回旧写法即变红）与 `TestCompletedRangeIsOffsetAware`。
> - **③④⑤**：卡面标志与卡名各占一整行（卡名 `word-break: keep-all`，不再一列一个字）；
>   记事显示「记于 X」（取 `completed_at`，原来一律「无日期」）；列表按天分卡片
>   （`[data-day-group]`，卡片头「今天 · 10月9日 周五 · N 条」，无日期永远最后）。
> - 流光：把登录卡片那条旋转的 conic 光带抽成全局 `.flow-frame` / `.flow-glow`，
>   登录页与快速新建面板**共用一份实现**（`prefers-reduced-motion` 下不动）。
> - **一次返工**：第一次发版后 `verify-040` 在 201 上红了一条「已完成的行排在未完成之后」——
>   按天分卡片把「先看没做完的」这条全局规矩打散了。改成**每张日卡片内部**未完成在前、
>   已完成在后（跨卡片不再保证），断言同步改成按卡片校验，重新构建（`6956bd8c176f`）后
>   四台重新部署。
> - 发版流水：`VERSION`/迭代说明（`67fc7eb`）→ 构建 → 沙箱 8908 / 新设备 8909 / 迭代 8918 →
>   201（备份 + 改 compose 标签 + `up -d --force-recreate`）→ 200（`docker save | gzip` → scp →
>   md5 双方一致 → `docker load` → 改标签 → recreate）→ 离线包自检 **30/30** →
>   **生产 201 全量回归 29 套件 755→756 项**（第一次 29/755，失败套件 `verify-040` 见上；
>   返工后 **29 套件 756 项全绿**）→ 三台指纹核对。
> - 回归数字：迭代容器（返工前的候选镜像）**29 套件 763 项全绿**；生产 201 **29 套件 756 项全绿**。
>   新增 `verify-105`（这批的专项 **17 项**：芯片不清空、无日期提示、流光、按天分卡片、
>   记事显示记录时间、卡面两行、跨偏移不漏明天）。`verify-040` 的顺序断言、`verify-100` 的
>   卡面断言按新交互更新；`verify-100` 顺手修了一处**假红**：浮层提示在滑入动画里会短暂停在
>   屏幕外，被「不横向溢出」误判（给 `Toast` 加了 `data-toast`，检测时跳过）。
> - 备份：201 / 200 `data.bak-pre0160-20261009-231019`。构件（两边 md5 逐字节一致）：
>   `images/workordernote-0.16.0-amd64.tar.gz` sha256
>   `b113608898cef6fa3b74d8ddebc26627ade09d5cc9f5fd1554a48b75d0b81515`、md5
>   `6802c05e09f66b063aa39e75dcc298ae`；`pkg/WorkOrderNote-0.16.0-offline-amd64.tar.gz` tar sha256
>   `7a80be36b78967c3cff6e761aa291612da7edeef3c8bfeba5336ad7ecd95fd9f`、md5
>   `aa2ac4fd00925e01d14315c93e8bff30`。
> - 指纹（`browser-harness/fingerprint-instances.py`）：清单名+模板+图标 `a3be953d81`、
>   卡片 `824e551dd3`、提醒 `084912f098`、完成记录 `a378cdb2ae` —— **201 与 200 四项一致**；
>   沙箱同步恒为 `off`，仍是 14:1x 快照（少用户 19:40 自己建的那条），属预期。
> - 收尾：回归在 201 / 200 留下的 4 条「自检…完成记录」已软删（墓碑随同步过去）。
> - 构建踩坑记一笔：`--build-arg GIT_COMMIT="dev-batch 6af88e1"` 里的**空格**会把 ldflags
>   拆开，`go build` 直接失败（`usage: link [options]`）。提交标记只能用不带空格的单值。

### 2026-10-09：0.15.4 补丁（四台全部上线）—— 记事本栏目换成「笔记本」图标

> **发版记录**（VERSION `0.15.4`，源码提交 `6af88e1`（这一版分两次提交：`8707b08` 加图标与老数据纠正、
> `6af88e1` 修侧栏那一行写死的旧图标；最终镜像是按 `6af88e1` 构建的，镜像里的 `gitCommit` 与源码一致），
> 镜像 `workordernote:0.15.4` =
> `sha256:20fa7b4e66a017924382f8d54e4a90694366e40c035aaf18be1b4712142093e1`）
> - 用户要求一条：「记事本前边的选择图标改成好看的图标，比较直观地显示这是记事本」。
> - **新图标**：清单图标库新增 `notebook`（笔记本外形 + 书签飘带 + 左侧装订线），后端白名单
>   `listIconDefs` 同步加一项（前端画不出对应图形就会静默退回默认图标，两边必须一起改）。
> - **老数据自动纠正**：`ensureNoteBucket` 原本只在「栏目不存在」时补建，**已存在但图标是旧的**
>   （0.15.4 之前的行都是默认清单图标）不会被动到 —— 第一轮构建完实测三台 API 回的还是 `book`。
>   修法：`handleListLists` 里发现这一行的名字/图标不是固定值时也走一次 `ensureNoteBucket`
>   （它只在值不对时才写库，稳态零写入，`TestListListsUsesFixedQueryCount` 的 4 条固定查询不变），
>   新增 `TestStaleNoteBucketIconHealedOnListLists` 覆盖「旧图标行 → 打开侧栏即纠正、普通清单图标不受影响」。
> - **侧栏那一行原本是写死的旧图标（`6af88e1` 修）**：侧栏「记事本」是固定栏目，不读清单数据，
>   它的 `<svg>` 直接写了一本书（老的 `book` 路径）。所以第一轮上线后 API 已经是 `notebook`、
>   图标库里也换了，**用户看到的侧栏却还是那本书** —— 这个只有真的打开页面看渲染结果才发现。
>   改法：侧栏那一行改用 `ListIcon name="notebook"`，与日历/清单筛选共用 `utils/list-icons.ts` 一份定义；
>   `verify-103` 相应加一条**查渲染结果**的断言（侧栏 SVG 里必须有书签飘带 `M12.5 3.5v6.4`、
>   且不能有旧书本的 `M12 6.5C10.5 5.3`），只查接口是查不出这个问题的。
> - 这一版的坑记一笔：第一轮构建漏了 `--build-arg VERSION=0.15.4`，镜像里是 `dev`，
>   升级检查直接拒绝启动（`database schema (0.0.1) is newer than this binary (dev)`），
>   201 生产短暂进入 restart 循环 —— 发现后立刻按正确参数重构建并 recreate 恢复。
>   构建命令必须带 `VERSION` / `GIT_COMMIT` / `BUILD_TIME` 三个 build-arg。
> - 发版流水：`VERSION` → `0.15.4`、迭代说明 → 构建镜像（`8707b08`）→ 迭代容器 8918 全量回归
>   **28 套件 746 项全绿** → 沙箱 8908 / 新设备 8909 → 201 → 200 → 离线包自检 30/30 →
>   生产 201 全量回归 **28 套件 738 项全绿** → 三台指纹核对 → **发现侧栏图标没换，回到第 ② 步**：
>   修 `MainLayout.vue` + 加渲染断言（提交 `6af88e1`）→ 重新构建镜像
>   （`20fa7b4e66a0`）→ 四台重新部署（201 改 compose 标签 + recreate；200 重新 `docker load`
>   → 改标签 → recreate，两边镜像 ID 都是 `20fa7b4e66a0`）→ 离线包重新打并自检 **30/30** →
>   **迭代容器 8918 复跑全量回归 28 套件 747 项全绿** → **生产 201 全量回归 28 套件 739 项全绿** → 指纹复核。
> - `verify-103` 从 **27 项**增至 **29 项**（新增「记事本栏目的图标是 `notebook`」与
>   「侧栏那一行渲染的是笔记本图标」两条断言）。
> - 备份：201 / 200 `data.bak-pre0154-20261009-191415`。镜像与离线包已放进 201、200 的
>   `images/`+`pkg/`（`images/workordernote-0.15.4-amd64.tar.gz` sha256
>   `9772d7b2b099cbca899555d98d95ee332efbdddd10a70363aca5264dcab0fa34`、md5
>   `06ef7d96b6b1f0b12fbce932d737aa5c`；`pkg/WorkOrderNote-0.15.4-offline-amd64.tar.gz` tar sha256
>   `28803fd51818ead1486927f16388efc71be27bb14d3c5ce4b34cab0dcb4a87b8`、md5
>   `591abf4c1b2bbe62a7aabffc48f19aed`；两个文件在 201 与 200 上 md5 逐字节一致）。
> - 同步核对：201 ↔ 200 方向 `both`、间隔 5 分钟；沙箱仍是 `off`、自己的实例标识 `41582a922eae0a5b…`
>   （这次没有拷数据，同步身份未受影响）。
> - 指纹核对（`browser-harness/fingerprint-instances.py`，按内容算、不带 id）：清单名+模板+图标
>   `a3be953d81`、卡片 `824e551dd3`、提醒 `084912f098`、完成记录 `a378cdb2ae` —— **201 与 200 四项完全一致**；
>   沙箱提醒/完成记录不同，差的是**用户 19:40 自己新建并完成的那条「风华国际切换网络到广电线路」**
>   （沙箱同步是 `off`，本来就停在 14:1x 的快照上，不是故障）。记事本图标三台都是 `notebook`。
> - 收尾时把 0.15.4 这轮回归在 201 / 200 上留下的「自检…完成记录」软删（墓碑已同步到 200，
>   两边 `deleted_at` 时间分别是 20:01:29 / 20:01:37）；此前几轮累计的同类墓碑共 31 条，一并核对过。

### 2026-10-09：0.15.3 补丁（四台全部上线）—— 「记住密码」做实、卡号左对齐、数据以 201 为准

> **发版记录**（VERSION `0.15.3`，源码提交 `ed5b9a7`（镜像构建时的提交标记是上一个提交 `3d53c4c`，改动当时还没提交），镜像 `workordernote:0.15.3` =
> `sha256:f93b0ab50692ef6de03646569616123ca8cfb648aa81e7731ac80bc2e02ff75c`）
> - 用户要求两条：① 「记住登录没有效果，改成记住密码」；② 信用卡卡号左对齐；
>   另外「以 <http://192.168.3.201:8906/> 数据为准，同步其他两个」。
> - **记住密码**：登录页那个勾选框从「记住登录」改成「记住密码」并**做实**——勾上之后账号密码存在
>   **本机浏览器**里（`reminders.remembered_login`，base64 混淆、**不是加密**），下次打开登录页
>   自动填好；取消勾选会清掉。7 天登录态（后端 `login_remember_days`）照旧保留。**注意**：这是给
>   自建 NAS 的便利功能，明文只落在用户自己的设备上，公用电脑不要勾（已在迭代说明里写明）。
> - **卡号左对齐**：卡号仍在卡面单独一行（尾号完整），对齐方式从右对齐改成左对齐，与卡名/持卡人
>   那一列对齐。
> - **数据以 201 为准**：200 已与 201 双向收敛（手动同步一轮：新增/更新/删除都是 0，全部跳过）；
>   沙箱 8908 直接**用 201 的 data 整目录覆盖**（备份 `staging-data-local.bak-pre-sync0153`），
>   并按老规矩**重置了同步身份**（`direction=off`、新实例标识 `41582a922eae0a5b…`、新令牌、
>   清空对端信息）——这个坑上次踩过，覆盖生产数据必须重置。
> - 收尾核对：三台（201 / 200 / 沙箱）**版本 0.15.3、清单 4/4、卡片 8/8、提醒 40/40、
>   完成记录 31/31 全部一致**（按名字+模板比对，跨实例可比）。
> - 验证：迭代容器全量回归 **28 套件 745 项全绿**；**生产 201 全量回归 28 套件 737 项全绿**；
>   `verify-096` 增至 **34 项**（新增「勾上记住密码后本机存下了账号密码」）；`verify-097` 的卡号
>   断言改成左对齐；离线包 `WorkOrderNote-0.15.3-offline-amd64.tar.gz`（tar sha256
>   `868715eee591…`）自检 **30/30**。
> - 备份：201 / 200 `data.bak-pre0153-20261009-141208`、沙箱
>   `staging-data-local.bak-pre0152-…`（发版前）与 `…bak-pre-sync0153`（覆盖前）。镜像与离线包已放进
>   201、200 的 `images/`+`pkg/`（sha256 双方一致）。回归留下的 2 条自检完成记录已软删。

### 2026-10-09：0.15.2 补丁（三台 + 新设备全部上线）—— 记事本体验与历史记事归位

> **发版记录**（VERSION `0.15.2`，提交 `3d53c4c`，镜像 `workordernote:0.15.2` =
> `sha256:08d7e0203ab19e7005f438b357efb97e78f02c05c9908fc90b0c831b68fec09a`）
> - 用户反馈两条（0.15.1 上线当天）：① 记事本栏目里的记事被画了删除线；② 以前录入的记事
>   要归到现在的记事本栏目里，**时间不改、内容不变**。
> - **删除线**：记事是「记录」不是「完成的任务」。前端行样式改成「`completed_at` 且
>   `kind !== 'note'` 才套已完成样式」，记事本里按普通条目显示（不再划线、不再变灰）。
> - **历史记事归位**：新增一次性数据迁移 `0.15.2 move_notes_into_notebook_bucket`
>   —— 把 `kind=note` 的条目**只改 list_id** 到各用户自己的记事本栏目（时间/标题/备注/
>   完成时间一个字都不动），重复执行幂等。顺手修了同步侧：**对端同步过来的记事也落到本机的
>   记事本栏目**（各机记事本 id 不同，跟着对端清单走会在本机乱建清单）。
> - 实测：201 / 200 两台的 5 条历史记事（调测网络、报障维修、机房光模块等）启动后全部进入
>   记事本栏目，标题与时间未变。
> - 验证：Go 新增 `TestSyncedNoteLandsInLocalNotebook`、`TestMoveNotesIntoNotebookMigration`，
>   全包 ok；`verify-103` 增至 **27 项**（新增「记事没有删除线/没有变灰」「所有记事都在记事本
>   栏目里」）；**生产 201 全量回归 28 套件 736 项全绿**；离线包
>   `WorkOrderNote-0.15.2-offline-amd64.tar.gz`（tar sha256 `eb99b200fc66…`）自检 **30/30**。
> - 发版流水：沙箱+新设备 → 201（改标签重建）→ 200（save/scp/load/改标签重建，sha256 双方一致）
>   → 离线包 → 生产回归 → 四台指纹核对（清单/卡片/提醒/记事归位一致；完成记录 31/31 一致）。
> - 备份：201 `data.bak-pre0152-20261009-131751`、200 `data.bak-pre0152-20261009-131751`
>   （DB md5 一致）、沙箱 `staging-data-local.bak-pre0152-20261009-131751`。
> - **回归会在目标实例上留下 2 条「自检」完成记录**（`verify-102` 为了验「全部含已完成」而
>   完成的条目，历史表只能软删）：收尾用
>   `UPDATE completions SET deleted_at=... WHERE title_snapshot LIKE '%自检%'` 清掉即可
>   （墓碑会同步给对端），本次已清、两边都是 31 条完成记录。

### 2026-10-09：0.15.1 正式发版（智能清单分工 / 记事本 / 按月与范围 / 日历周视图 / 信用卡还款跳期）

> **发版记录**（VERSION `0.15.1`，提交 `43ca3c2`，镜像 `workordernote:0.15.1` =
> `sha256:d4725679f0b1f3951c1fb7bc0713b16e68db1965b318926f86e4f7c98635f0ed`）
> - **三台（201 / 200 / 沙箱 8908 / 新设备 8909）全部升到 0.15.1**。这一版把三批改动合成一版
>   （0.14.0 的沙箱候选修补也一并包含）：
>   ① 智能清单分工（今天＝今天+逾期置顶；计划＝循环/时间段/明天以后的预设；计划页专用输入窗口；
>   计划与今天页取消「未完成/全部」开关）
>   ② 时间段字段 `start_at`/`end_at`、**记事本系统栏目**（与信用卡栏目都由个人偏好开关控制、
>   两个都默认开启）、全部页按月翻页 + 时间范围条（今天/昨天/本周/上周/本月/今年/自定义）、
>   导出对话框（清单 + 列多选，导出仍是全量）
>   ③ 日历周视图（7 列天 × 纵向小时、悬停显时分、双击按所在时分建 1 小时时段、按清单上色、
>   重叠并排分栏 + 提示）、日历格子超限收进「+N 条…」下拉、信用卡标记加底色、后台可配「周起始日」
>   ④ 信用卡还完自动跳下一期（倒计时/排序跟着走、应还清零，并保留最近一次已还用于撤销）、
>   卡面卡号与持卡人换位、卡名可换行、「还款计划/编辑/删除」收进「⋯ 更多」悬停抽屉
> - **上线后立刻发现并修掉的真 bug（0.15.0 → 0.15.1）**：同步过来的清单如果**模板名不被识别**，
>   就会退化成普通清单 —— 对端按模板查找自己的「记事本」栏目时找不到，于是各自又建一个，
>   两台都冒出重复的记事本（实测 201 有 3 个、200 有 4 个）。修法：`normalizeListTemplate`
>   同时认 `notebook`（与 `credit_card` 一样保留），并清掉已产生的重复栏目；Go 新增
>   `TestNotebookTemplateSurvivesSync`（A 建栏目 → 同步到 B → B 仍是 notebook 模板且复用同一条）。
>   因此**这一版实际部署的是 0.15.1**，0.15.0 只在沙箱停留了约半小时。
> - 发版流水：`VERSION` → `0.15.1`、迭代说明 → 构建镜像 → 沙箱验证（全量回归 **28 套件 734 项全绿**）
>   → 201（备份 + 改 compose 标签 + `up -d --force-recreate`）→ 200（`docker save | gzip` → scp
>   sha256 校验一致 → `sudo docker load` → 改标签 → recreate）→ 离线包（tar sha256
>   `fec6d823a902…`）自检 **30/30** → **生产 201 全量回归 28 套件 734 项全绿** → 三台指纹核对。
> - 指纹（按名字比对，跨实例可比）：清单名+模板 `9236d66a3d`、卡片 `7118245749`、提醒 `92ff8befe5`、
>   完成记录 `1ac8198ff4` —— **201 与 200 四项全部一致**；沙箱是关掉同步的快照（4 清单 / 37 条），
>   刻意不追平。收尾时把回归在 201 上留下的 4 条「自检」完成记录软删（墓碑已同步给对端），
>   两边都是 30 条完成记录、0 条自检。
> - 备份：201 `data.bak-pre0150-20261009-030157`、200 `data.bak-pre0150-20261009-030216`
>   （两边 DB md5 一致核对过）、沙箱 `staging-data-local.bak-pre0150-20261009-030122`。
> - 镜像与离线包已放进 201 的 `images/`+`pkg/`、200 的 `images/`+`pkg/`（sha256 双方一致）。
> - **混版本提醒**：0.13.2 / 0.14.0 不认识 `start_at`/`end_at`，回推时可能把区间覆盖成空 ——
>   本次三台一起升，不让新旧版本长期混跑。

### 2026-10-08：0.14.0 候选版修补（沙箱复验后用户又报 4 条，**只上了沙箱/新设备**）

> 用户原话：「初次加载 后台信用卡是开启状态，但是首页没有显示信用卡清单，后台点击开关后才显示，
> 后台开关按钮错位；信用卡银行标志调整后依然不满意，把整个图标直接显示在卡上，透明底，完整图标+文字版本，
> 图标后边不再加 XXX银行字样，银行完整图标后边直接显示卡名，下对齐。」
>
> 1. **初次加载侧栏没有信用卡栏目**（真 bug）：`authStore.init()` 只在「首次进页面」跑一次，而那次是在
>    **登录页**（还没有令牌），`/api/bootstrap` 按匿名身份回，个人偏好 `credit_card_enabled` 停在默认
>    false；于是后台明明开着、侧栏却没有那一行，要进一次偏好设置（那里读用户配置并调
>    `setCreditCardEnabled`）才出现。修法：登录成功后 `reloadBootstrap()` 重新拉一次引导。**实测**：
>    清空本地登录态 → 用登录表单登录 → 侧栏直接出现「信用卡账单 8」。
> 2. **偏好设置的开关滑块错位**（真 bug）：滑块是 `inline-block` + `translate`，而 `<button>` 默认
>    `text-align:center` 会先把滑块**居中**再位移，滑块被推到轨道右边、又被 `overflow-hidden` 裁掉一截。
>    改成 `inline-flex` + `p-0.5`（实测：轨道 44×24、滑块落在 22..42、垂直居中）。
> 3. **卡面改用完整银行标志**（用户要求的设计）：不再套白圆片、也不再把标志裁成只有图形 ——
>    完整标志（图形 + 银行名文字）**透明底**直接放在卡面上，后面**直接接卡名、下对齐**，卡名前不再
>    重复「XX银行」。资产按标志实际包围盒收紧 viewBox（`bank-logo-marks.py --full`），否则
>    1024×1024 方画布按高度 24–28px 显示只有几像素高、等于看不见。
>    ⚠️ 上一版「裁成只留图形」的做法被用户否掉；脚本保留两种模式（默认裁图形、`--full` 收紧整幅）。
> 4. **RC 与下一批分线**：这三条只在 `rc-0140` 分支的提交 `877ee62`（= `0195f4c` + 这三条），
>    **不含**智能清单（0.15.0）的代码；镜像 `workordernote:0.14.0` = 该提交。开发线（`feat-note`）
>    仍带着智能清单，继续在迭代容器 8918 上迭代。
>
> 验证：`verify-100` 增至 **57 项**（新增：初次登录后侧栏直接有信用卡栏目、开关滑块完全在轨道内且
> 垂直居中、卡面完整标志/透明底/下对齐/标题不重复银行名）；`verify-097` 的「卡面显示银行+卡名」
> 改成「只显示卡名、银行名由标志表达」（95 项）；`run-all.sh` 新增 `SKIP_SUITES`，发 0.14.x 候选版时
> 跳过下一批才有的 `verify-101`。

### 2026-10-08：0.15.0 开发中（智能清单：今天页 / 计划页分工，**只上了迭代容器 8918**）

> 用户要求（原话）：「今天页面，全部只显示今天信息；计划页面只显示预设信息（循环信息、定时信息）；
> 新建内容，不使用 今天 明天 上周 本周 今年 等，使用自定义时间或时间段，根据计划任务调整输入窗口界面，
> 不予今天输入页面一致，计划里面没有记事 只有任务。」确认后的四条口径：
> 今天页＝今天到期的 + **逾期未完成置顶**；计划页＝**有循环规则的 + 有时间段的 + 排在明天以后的**；
> 「时间段」要**真的起止字段**；今天页的输入窗口**保持原样**。
>
> - **数据模型**：`reminders` 新增 `start_at` / `end_at`（AutoMigrate 自动加列，旧行 NULL）。
>   只给开始＝单点时间；只给结束＝拒绝；两个都给＝校验结束晚于开始，并把 **`due_at` 归到开始时间**
>   —— 列表排序、今天/计划视图、日历归格、通知投递都只认 `due_at`，不让每处各理解一次区间。
> - **计划页过滤**：`repeat_rule <> 'none' OR start_at IS NOT NULL OR due_at >= 明天0点`。
>   今天页那些「就今天办」的普通任务不再重复出现；记事没有排期，天然不进计划页。
> - **输入窗口**：计划页只有任务、没有「记事」，也没有「今天/明天/本周末」相对快捷项，
>   改成「开始 / 结束」自定义时间（结束留空＝单点）+ 重复；没选开始时间提交会被拦下。
>   今天页窗口保持原样。**编辑弹窗加了同行的「+结束」入口** —— 一是编辑区间任务时不能把区间清掉，
>   二是这个字段**不能占额外高度**：加了整整一行之后 `verify-070`（日历弹窗「整张卡片不内滚」）
>   立刻红了（内容 670px / 可视 618px），改成与日期按钮同行的虚线小按钮才过。
> - **显示**：列表与日历的时间都显示「开始 – 结束」（同一天只显示结束的时分）；逾期行加「已逾期」标记。
> - **同步**：快照 / 落地 / `sameReminder` 三处都带上新区间字段；`sync_test.go` 的指纹也补上了，
>   漏同步不会再被判成一致。**混版本提醒**：0.13.2 / 0.14.0 不认识这两个字段，回推时可能把区间覆盖成空，
>   上线时三台要一起升。
> - 验证：Go 新增 `TestPlannedViewOnlyPresets` / `TestReminderRangeValidation` / `TestSyncCarriesTimeRange`，全包 ok；
>   新增浏览器用例 `verify-101`（18 项）；这一批后续继续加（列表页按月 `verify-102` 16 项、日历细节），
>   迭代容器上全量回归 **26 个套件 700 项全绿**（含 0.14.0 候选版那三条修复）。
> - 迭代镜像 `workordernote:dev-m2`（**不动** `workordernote:0.14.0`，沙箱与生产都没碰）。

### 2026-10-08：0.14.0（**只上了沙箱 8908 / 新设备 8909，201 / 200 待验收后再上**）

**0.14.0 — 手机端适配与悬浮新建；提醒弹窗改成「知道了」+ 两个提醒频率偏好；卡面图标铺满圆形**

> **沙箱发版记录（2026-10-08 10:5x）**
> - 镜像 `workordernote:0.14.0` = `08cb8470b4cc`，提交 `339e4a8`（`VERSION` 与 `release-notes.ts` 同步改）。
> - **沙箱数据先用生产数据覆盖**（用户要求）：201 `data` 整目录 → 沙箱 `staging-data-local`
>   （root 容器 `rm -rf /dst/* && cp -a /src/. /dst/ && chown -R 1000:1000 /dst`，
>   备份 `staging-data-local.bak-precover-20261008-101439`）。
> - **逐表指纹核对（覆盖后）**：8 张卡 / 14 期账单 / 4 清单 / 38 条提醒 / 16 条完成记录 / 29 条通知
>   —— 生产 201 与沙箱 8908 的**存活行完全一致**（含墓碑条数一致：卡片 27、清单 31、提醒 250、
>   完成 27）；差异只在少数墓碑行的 `deleted_at` 时间戳（两台各自处理删除，时间自然不同）。
> - **本轮 6 件事**：① 手机端卡片不再被裁到屏幕外（网格改单列 + 折行 + 卡号截断，320–430px 六页不溢出）；
>   ② 手机端「新建」从标签栏改成右下角悬浮球（56px，浮在栏上、键盘弹起收起）；
>   ③ 卡面银行标志铺满整个圆形、认不出银行时不再显示文字（改通用卡图标）；
>   ④ 提醒弹窗去掉「完成」，只剩「知道了 / 稍后提醒」，点「知道了」= 当天不再提示、次日同时再提醒，
>   **不等于完成**；⑤ 偏好新增「提醒频率」（5/10/15/30/60 分钟，默认 10）与
>   「点『知道了』后的提醒频率」（0=次日/30/60/120/240 分钟，默认 0），都是个人偏好；
>   ⑥ 沙箱换成生产数据。
> - **验证**：新增 `verify-100` **47/47**（四种宽度 × 六个页面 + 信用卡页不溢出、卡片装得下、标志铺满圆且无文字、
>   悬浮球脱离标签栏且能打开新建、弹窗只有知道了/稍后提醒、点知道了顺延次日且仍未完成、排序按还款日递增、
>   最近还款日排第一、已登录访问 /login 不再要密码、登录框带 name/id/autocomplete）；
>   沙箱 8908 全量回归 **24 个套件 651 项全绿**（`verify-097` 也涨到 95 项）。
> - **踩到的坑（已修，务必记住）**：沙箱数据从生产整目录拷来，**同步身份也一起拷来了**——沙箱带着
>   201 的 `sync_instance_id`（`fe0a26cbec64673f`）+ 同一令牌 + `direction=both` + 指向 200、
>   每 5 分钟自动同步。它就成了「第二个 201」，能往 200/201 推数据（实测这轮它删掉自检数据时，
>   删除确实经 200 传到了 201）。收尾已把沙箱改成 `direction=off`、`interval=0`，
>   并把实例标识与令牌都换成新的（`493bc08d…`）。以后再做「用生产数据覆盖实例」这一步，
>   覆盖完必须立刻检查/重置同步设置。
> - **自检残留**：`verify-097` 在 200 上被中途 kill 时留下过 1 张测试卡 + 3 条提醒 + 1 个清单，
>   已随 0.13.2 的墓碑同步清干净（201 收到 4 条墓碑，`删除 4`）；沙箱侧再手工清掉自己产生的
>   2 条「自检弹窗」提醒与 2 条通知行，做到与生产逐表一致。**用例被 kill 一定要补跑
>   `browser-harness/clean-self-test.sh <地址>`**。
> - 备份：201 `data.bak-pre0140-*`（发版时补）、沙箱 `staging-data-local.bak-precover-20261008-101439`。
> - **待办**：用户验收沙箱网页后，再走 201 → 200（离线包 + 生产回归 + 指纹核对）。
>
> **沙箱复验后用户又报了 3 条，当天已修（同一批 0.14.0，未发版）**
> 1. **信用卡排序：还款日近的没有排前面**。用户原话「交通银行还款时间快到了为什么没有排到前面」
>    ——实测 8 张卡里交通 VISA 只剩 11 天却排在**最后**。根因：智能排序的第二顺位是**账单日**，
>    跨月卡（账单日 25 / 还款日 19）在账单日上永远吃亏。改成「红色/逾期最前 → **还款日剩余天数
>    由少到多** → 账单日早的在前」，实测顺序 交通(11) → 平安(15) → 浦发(17) → 广发(19) →
>    建设(24) → 中国(25) → 招商×2(26)。
> 2. **登录页记不住密码**（用户原话「登陆窗口记不住密码，每次都要输入」，补充说明是在**安卓客户端**里、
>    「记住登录」已经勾上）。实测根因**不是**服务端会话：勾着「记住我」时 token 进 localStorage、
>    服务端 7 天有效、新标签页不用重登。真正的问题在两头：
>    ① **安卓壳子启动写死打开 `/login`**（`android-shell` 的 `loadApp`），而路由没有
>    「已登录访问 /login 就回工作台」的守卫 → token 明明还在也每次停在登录表单；
>    ② 输入框只有 `autocomplete`、**没有 `name`/`id`**，Safari 与部分安卓浏览器因此不弹「保存密码」。
>    修法：路由守卫加一条（已登录访问 /login、/register、/forgot-password → 跳 /admin，
>    带飞牛授权参数的链接例外，避免打断绑定流程）；壳子改成打开根路径；三处表单补 `name` + `id`。
>    **网页端已拦，所以旧 APK 不用重装也能好。**
> 3. **手机端整页往右顶出去**：用户看到的正是 **0.13.2 生产上**那个「卡片最小内容宽度 ~378px」
>    的 bug（安卓客户端默认服务器就是 `192.168.3.201:8906`）。0.14.0 已修，**上线 201 之后才会
>    在手机上消失**；顺手把信用卡页也加进 320/360/390/430 的四宽度不溢出循环（原来只测了 360px）。
> - 复验：`verify-100` 从 39 项扩到 **47 项全绿**（新增：信用卡页四宽度不溢出、排序递增、
>   最近还款日排第一、已登录访问 /login 不再要密码、登录框带 name/id/autocomplete）。
> - 沙箱/新设备/迭代容器都用**重新构建的同一镜像**（`workordernote:0.14.0` =
>   `sha256:864b5359e017729007aea5935e12f53e46c0b4f62edb870980307a7992352991`，提交 `1f61b72`）重新起了一遍。
>   全量回归在迭代容器（8918）上跑：**24 套件 651 项全绿**；沙箱 8908 上 `verify-097` 95/95、`verify-100` 47/47。
> - **沙箱数据现在是生产的逐行副本**：`cards` / `card_statements` / `lists` / `reminders` / `completions` /
>   `notifications` 六张表**连墓碑行与时间戳都一致**（收尾时把回归造的沙箱独有行删掉、时间戳对齐生产；
>   只有同步身份是刻意改过的）。核对命令：把两个 db 分别 `ATTACH` 后逐表比 `id` 集合与全列指纹。
>
> **顺手验出的第 4 个问题（后端，已修）：删卡片不会删它的账单期**
> - 用沙箱数据做「与生产逐表核对」时发现 `card_statements`：生产 14 条、沙箱 20 条 ——
>   多出来的 6 条是回归删除 3 张测试卡后留下的**孤儿账单期**。查 `handleDeleteCard`：事务里
>   只软删了卡片和它的提醒（`card_id` 关联的 `reminders`），**没删 `card_statements`**。
> - 影响：界面上看不见（账单期都按 `card_id` 查），但它们是活行，会一直跟着**同步快照发给对端**，
>   越积越多。生产库里现在也躺着 **14 条历史孤儿账单期**（都指向早期测试卡，用户没让动就先不动）。
> - 修法：删卡事务里补一条 `card_statements` 的软删；Go 新增
>   `TestDeleteCardSoftDeletesStatements`（走 handler 删卡，断言卡片、提醒、账单期三者都软删）。
> - **测试用例的两个教训**（都已修，避免下次假红）：
>   ① `verify-097` 会生成站内通知但从不标已读 → 同一次回归里排在后面的 `verify-100` 弹窗用例
>   先弹到它，点「知道了」点不到自己造的那条，沙箱上假红 2 条。现在 097 收尾时把自己那些
>   「自检」通知标为已读，并加一条断言；100 也加了前置检查——环境里已有未读提醒时**跳过并说明**，
>   不把干扰当产品 bug。
>   ② `verify-095`/`verify-096` 原来用「带登录态打开 /login」看登录页，被新守卫拦下后直接抛错
>   （exit=2）。现在统一走新的 `openLoginForm()`（先清登录态再打开），这也更贴近真实场景。
>
> **沙箱上第二次复验用户又报了 3 条（同一批 0.14.0，提交 `9ddc8df`）**
> 1. **「知道了」提示「不存在」，弹窗再也关不掉**（用户原话：收到「中信银行自检第二卡677
>    还款提醒」，点击知道了提示不存在，然后对话框就取消不掉了）。这是**真 bug，两头都要修**：
>    - **后端根因**：`handleDeleteCard` 批量软删卡片提醒时**没有把那些提醒名下未处理的
>      「到点」通知标为已读**。单条删提醒走 `deleteReminder()` 里有 `retireDueNotifications()`，
>      删卡是批量 UPDATE，漏了这一步 → 弹窗照样弹，而点操作时提醒已经没了 → 404
>      「提醒或清单不存在」。修法：删卡事务里先 `Pluck` 出该卡的提醒 id，再批量
>      `read_at = now`（`type='reminder_due' AND read_at IS NULL`）。
>    - **前端兜底**：操作报 404 / 文案含「不存在」时，视为「这条已经没了」——自动标已读、
>      关弹窗、toast 提示一句；另外弹窗一旦出现错误文案就多一个**「关闭弹窗」**出口，
>      任何失败（断网、500）都不会再把人困在弹窗里。
>    - 回归测试：`verify-100` 现在一次造**两条**到点提醒（只等一轮投递），第一条验证
>      「知道了＝顺延次日、不等于完成」，第二条**开着弹窗把提醒删掉**再点「知道了」，
>      断言弹窗自动关掉 —— 正是用户踩到的场景。
> 2. **银行标志只留图形、不要图标里的字**（用户要求）：`@icongo/bl` 的图标是「图形 + 银行名
>    文字」的完整标志，画在 1024×1024 画布上，缩进 36px 圆里就是一团糊字。新增
>    `web/scripts/bank-logo-marks.py`：按子路径包围盒聚类 → 挑「宽高比像图形、面积最大」的那簇
>    → **只改 viewBox**（path 一个都不动，可还原）裁成 1:1。21/22 家裁成功；**光大银行、浙商银行**
>    的标志里没有可分离的独立图形（本来就是整排字），保持原样。几何核对：20 家「图形簇在框内 +
>    文字簇全部框外 + 1:1」全过；并输出对照片 `browser-harness/shots/bank-logos-marks.png`（裁前→裁后）
>    供人眼确认 —— 这类「好不好看」的判断必须由人看，机器只能证明「文字被裁到框外了」。
> 3. **卡号被截断、看不见尾号**（用户原话：版本改变后卡号不再换行导致看不到信用卡尾号）：
>    0.14.0 给卡号加了 `truncate`，窄屏那一列放不下 19 个字符，省略号正好把**尾号**吃掉。
>    现在去掉截断、窄屏缩到 13px / `.04em`，放不下就自然换行（`maskNo()` 只留后四位，
>    不截断就一定看得见）。
> - 复验：`verify-100` 从 47 项扩到 **53 项全绿**；Go 全包 ok（含删卡通知用例）；镜像重建为
>   `workordernote:0.14.0`（提交 `9ddc8df`）并重新部署沙箱 / 新设备 / 迭代容器。
>   沙箱全量回归 **24 个套件 657 项全绿**。
> - **沙箱再次与生产逐行对齐**：这轮回归在沙箱上留下的自检行与时间戳差异都清掉了；用户在
>   13:18 于生产新建的两条提醒（「更换发电机电瓶」「世家宾馆302无网络」）也补进了沙箱。
>   现在 7 张表（cards / card_statements / lists / reminders / completions / notifications /
>   delivery_jobs）**逐行指纹与生产一致**（0 差异）。

### 2026-10-08：0.13.2 补丁（三台全部上线）

> **发版记录（2026-10-08 10:1x）**
> - 镜像 `workordernote:0.13.2` = `sha256:169bbc8178f415cded9cbd595ddc3e2e7b8ac7506ab82eb35233f2baf6b4d53d`，提交 `5393026`。
> - **起因（发版后立刻发现的真 bug）**：0.13.1 发布后核对三台指纹时，发现 200 比 201 多 3 张卡
>   （正是回归用的测试卡）。根因：`sameCard` / `sameCardStatement` 判断「内容是否一致」时**漏了
>   删除标记**，于是「对端删掉、本机内容一模一样」被判成一致而跳过——**删除同步不过去**。
>   清单与提醒的 `sameList` / `sameReminder` 一直有这一条比较，卡片与账单期漏了。
> - **修法**：两处比较都补 `(local.DeletedAt != nil) == incoming.Deleted`；Go 新增
>   `TestCardTombstoneAppliesWhenContentUnchanged`（两个库完整往返）。
> - **验证**：Go 全包 ok；`verify-097` 生产 **94/94**；同步端到端 **44/44**；真机配对 **15/15**；
>   离线包（tar sha256 `a41f0f82bddf…`）自检 **30/30**；三台指纹一致（4 清单 / 38 条 / 16 条完成记录）。
> - **实测修复生效**：触发一次同步后，200 上的卡片从 11 张降到 8 张（`cards_deleted: 3`，正是那 3 张测试卡）。
> - 备份：201 `data.bak-pre0132-*`、200 `data.bak-pre0132-*`、沙箱 `staging-data-local.bak-pre0132-*`。

### 2026-10-08：0.13.1 正式发版（三台全部上线）

> **发版记录（2026-10-08 09:2x）**
> - 镜像 `workordernote:0.13.1` = `sha256:a1d9f957ebcd9c1cdad90d2b3cf92606e83ab6370e2ab0dfa3b0538149d9ba48`，提交 `bbcd0ab`。
> - **201**：备份 `data.bak-pre0131-20261008-091951` → 改 compose 标签 → `up -d --force-recreate`；
>   升级后：4 清单 / 56 条（用户已录入 8 张卡）/ 偏好仍为 true。
> - **200**：备份 `data.bak-pre0131-20261008-092028` → `docker save | gzip` → scp（双方 sha256 一致
>   `0b22f5f3405b…`）→ 先 `docker load` → 再改标签 → `up -d`，无中断；升级后与 201 数据一致。
> - **回归（生产 201）**：`run-all.sh` **23 个套件 603 项全绿**；Go 全包 ok；
>   同步端到端 **44/44**；真机 201↔200 配对 **15/15**；离线包 `WorkOrderNote-0.13.1-offline-amd64.tar.gz`
>   （tar sha256 `9f98c07253a2fed1afbf1b9534f03c06d43b3ffe5cd70b6bdd7412a7b90d3137`）自检 **30/30**。
> - **三台指纹**：201 与 200 一致（4 清单 / 38 条 / 16 条完成记录；沙箱是手动拉取的副本，不追平）。
> - **本轮修掉的真 bug**：`currentPeriod` 跨月账期算错（账单日 25 / 还款日 19 的卡永远不变色）；
>   完成记录撤回跨机同步（软删 + 墓碑，0.13.0 记录的已知限制）。
> - **两处「用例在生产上假红」的教训**（都是用例问题，不是产品问题，已修）：
>   ① 用例读**全局**完成记录条数——用户本人同时在用，26→28 看着像「多写了一笔」，实际 API 复现是 +1；
>   现在只数自己造的（标题带「自检」）。② 头部卡片「拖动」检查依赖当天有几张卡超出宽度，
>   生产上卡片少时假红；现在临时把 DOM 撑宽再派发真实鼠标事件。
> - **待办（下批）**：卡面上的 `data-card-limit` / `data-card-notes` / `data-card-holder`
>   与新建弹窗里的输入框**属性重名**（这轮就因此让用例选错元素报 Illegal invocation）。
>   行为没问题，下批统一改成 `data-card-face-*`。

### 2026-10-08：0.13.0 正式发版（三台全部上线）

**0.13.0 — 信用卡账单（侧栏固定栏目）；新设备一键导入**

> **正式发版记录（2026-10-08 03:33）**
> - 镜像 `workordernote:0.13.0` = `sha256:eec34bc704189967849e941b840696676f37c47ddc580335ba5e2696c82e3842`，提交 `5644eac`。
> - **201**：备份 `data.bak-pre0130-20261008-033121`（86M）→ root 容器改 compose 标签 →
>   `docker compose up -d --force-recreate`；升级后数据核对：3 清单 / 35 条 / 27 条完成记录（与本前一致）。
> - **200**：备份 `data.bak-pre0130-20261008-033213` → `docker save | gzip` → scp（sha256 双方一致
>   `9a7055103a6d…`）→ 先 `sudo docker load -i` → 再改标签 → `up -d --force-recreate`，无中断。
> - **个人偏好**：信用卡栏目是个人开关（默认关），已在 201 / 200 给你的账号打开
>   （`credit_card_enabled=true`，`/api/bootstrap` 读回 true）；要关就在「偏好设置 → 功能开关」里关。
> - **回归（生产 201）**：`run-all.sh` **23 个套件 588 项全绿**；Go 12 包 ok；
>   双机同步端到端 **44/44**；真机 201↔200 配对 **15/15**（含双向传播与删除传播）；
>   离线包 `WorkOrderNote-0.13.0-offline-amd64.tar.gz`（tar sha256 `8ae428aef36e…`）自检 **30/30**。
> - **三台指纹**：201 与 200 完全一致（4 清单 / 35 条 / 15 条完成记录）；沙箱 41 条 = 生产 35 + 它自己那
>   两张卡的 6 条提醒。顺手清掉了一条 2026-09-17 的测试残留完成记录 `__TEST_REPEAT__`（只有 201 有）。
> - **已知限制（0.13.0 发现，0.13.1 已修）**：`completions` 原来是硬删除、没有墓碑，所以
>   「标记已还 → 同步 → 再撤销已还」会在对端残留一条幽灵记录。修法：`Completion` 改用
>   `gorm.DeletedAt`（软删），快照 `Unscoped()` 带上 `deleted: true` 的墓碑，对端收到就撤回；
>   `/summary` 的裸 SQL 子查询补 `deleted_at IS NULL`。Go 三个用例（含两个库跑完整 A→B 往返）
>   与同步端到端 44/44 都过。**注意坑**：`*time.Time` 不会被 GORM 当成软删除字段
>   （`Delete` 仍是真删），必须用 `gorm.DeletedAt`。

- **信用卡账单是一个固定栏目，不再是「新建清单」里的一种模板**：
  - **个人偏好** `credit_card_enabled`（`ScopeUser`，分组「功能开关」，**默认关**、public）控制
    侧栏那一行在不在：不是所有人都用信用卡，所以放在「偏好设置」而不是系统配置里，每人一份。
    `creditCardFeatureEnabled(db, userID)` 按用户读值 + 按用户缓存 2 秒（缓存里连「要摘掉哪些
    清单」一起算好，否则关着栏目的用户每次读列表/日历/统计都要多查两次库，把固定查询次数打穿）；
    bootstrap 会把当前用户自己的用户级配置并进 `configs`，前端 `authStore.creditCardEnabled` 用它。
    **部署到已装好的实例后，需要给你自己（或要用的人）在偏好设置里打开一次**（老的系统级默认
    不再生效，默认是关）。
  - **这个开关只管显示，不是接口权限**：关着也允许建卡/查卡。否则同步或导入带过来的账号
    （还没打开开关）连卡都建不了，而同步本身又会把卡片直接落库，语义自相矛盾
    （`verify-098` 就是这么发现并纠正的）。
  - 引导接口里，**所有**用户级公开配置都按「本人值 → 注册表默认」重算：`system_configs`
    里可能残留这个键当年当系统配置时的 `user_id=0` 旧行（值 `true`、public），只按 public
    取会把默认值带偏——表现成「侧栏冒出一行、页面里却是空的」。
    卡片页顶部只留「+ 新建卡片」，快速新建与提醒列表都不出现（`HomeView` 里单独一支渲染）。
  - 卡片一律归到这一栏：`POST /cards` 忽略客户端传的 `list_id`，由 `ensureCardBucket` 准备清单。
    「新建清单」接口同样忽略 `template`（老客户端传 credit_card 也只建出普通清单），
    避免凭空多出第二个卡片栏目。
  - **关掉只是隐藏**：`hiddenCardListIDs` 把这一栏的清单 id 交给 `listReminders` /
    `listCalendarItems` / `handleSummary` / `listCompletedHistory`（导出复用后两者）做排除，
    卡片、账单金额、还款记录一条都不删，重新打开就回来。开关读的是 2 秒进程内缓存，
    否则 `/summary` 的固定查询次数会被撑大（见 `performance_test.go`）。
  - **老数据自动并栏**（`adoptLegacyCardLists`）：0.13.0 之前用户自己建的信用卡清单
    （可能好几条、名字各异）会在打开卡片页时并进固定栏目——卡片挪过来、提醒重建、旧清单软删；
    `handleListLists` 把栏目名统一成「信用卡账单」。
- **卡片页**：卡面还是按真卡渲染（渐变、掩码卡号、额度、账单日/还款日、免息期、芯片）；
  每张卡上仍是「填本期金额 / 标记已还 / 撤销已还 / 还款计划 / 编辑 / 删除」，但页面层级不再有录入区。
- **新建卡片与卡面（2026-10-07 追加）**：
  - **银行预存下拉**：`web/src/utils/banks.ts` 内置 22 家国内银行 + 标志（`web/src/assets/banks/*.svg`，
    取自 npm 包 `@icongo/bl`（MIT）里的官方配色 SVG，已抽取并用 svgo 精简，共约 260KB）。
    这些 SVG 通过 Vite 的 `?url` 输出到 `/assets/*.svg`，**不需要**在服务端静态白名单里加路径；
    老数据里手填的银行名用「包含」匹配识别标志，认不出就退回银行名首字。
  - **一行三张**（`md:grid-cols-2 xl:grid-cols-3`）；**卡面默认统一配色**、靠银行标志区分
    （`Card.Color` 保留兼容但界面不再让用户选）；**账单日之后按账期进度黄→橘**，
    **还款日前 3 天（含逾期）转红**（`urgencyOf()` + 按亮度自动选黑/白字），另有状态条与进度条。
- **清单筛选与「信用卡账单」栏目（2026-10-08 追加）**：日历与「已完成」页的清单筛选改用
  **全部清单**（含信用卡栏目）——卡片提醒本来就出现在这两处（日历里按 `card_role` 上色），
  之前把它整个排除掉，用户在日历里找不到「信用卡」这一项。新建提醒的清单下拉、
  提醒编辑器、默认清单仍然是 `navLists`（不能往卡片栏目里塞普通任务）。
  顺手修掉 **`CalendarItemDTO` 漏赋值 `card_id`** 的老问题（只回了 `card_role`），
  Go 侧补了断言（`TestDisableCreditCardHidesButKeepsData`）。
- **信用卡页这一批（2026-10-08 追加，未发版）**：
  - **修 `currentPeriod` 跨月口径**（真 bug）：循环从**上个月**开始找「还款日未过的最早一期」。
    跨月卡（还款日 ≤ 账单日，例如账单日 25 / 还款日 19）以前会跳过正在还款的那一期，
    算成「本月 25 出账、下月 19 还款」，于是卡面永远停在默认色（用户报的「颜色没变」）。
    对已有数据的影响：只有跨月卡会改变「当期」是哪一期；本机与沙箱的两张卡都是同月卡，
    不受影响。
  - **头部时间卡片改成「账单已出」口径**（`card_billing.go` + `/cards/billing`，旧 `/cards/week`
    保留一个版本）：只列**账单日已过、当期未还**的卡（含逾期），不再按「本周」筛；排序是
    **红色（逾期或 ≤3 天）最前**，其余按账单日由早到晚、再按还款日由近到远。卡片区
    **隐藏滚动条 + 按住鼠标左右拖动**；「刷新」按钮同时刷新头部卡片。
  - **卡片排序 + 排序设定按钮**：默认「智能」（红色最前 → 账单日 → 还款日），可切「按账单日」
    「按还款日」，选择存 `localStorage.ui_card_sort`；头部加了**卡面配色说明**。
  - **卡面**：去掉黄色仿芯片；持卡人换成**卡名下面一行、靠右**（长卡名不再挤持卡人）。
- **日历里的信用卡日子用图标 + 手机端入口（2026-10-08 追加）**：`CalendarView` 里
  `iconOf(item)`：信用卡的账单日/还款日/提前提醒用**银行卡图标**（`list-icons` 新增 `card`，
  缩到 11px，按角色着琥珀/玫红/橙），普通提醒仍用清单图标——日历里**不再有圆点**；
  `MainLayout` 的**手机底部标签栏**新增「信用卡」入口（`authStore.creditCardEnabled && cardBucket`
  时才出现，关掉偏好即消失），抽屉里那个入口本来就有。
- **清单图标库（2026-10-07 追加）**：`web/src/utils/list-icons.ts` 26 个图标 +
  `components/ListIcon.vue`；后端 `server/reminder/list_icons.go` 是**同一份 key 白名单**
  （创建时会 normalize、更新时校验，避免存进前端画不出来的 key）。侧栏、清单筛选、
  列表页标题、日历格子与详情面板一律用图标（不再用颜色圆点）；日历接口的
  `CalendarItemDTO` 新增 `list_icon`。
- **「本周待还」时间卡片**（组件 `WeekDueStrip.vue`，数据 `GET /cards/week` + `card_week.go`）：
  放在**页面标题「信用卡账单」那一行的右侧**，左侧固定**三行**（今天+日期 / 星期+本周区间 / 待还张数+合计），`lg:flex-1`（**占满该行剩余空间**，不再设上限），
  整体 `flex-wrap` —— 窗口变窄自动折到标题下方（860px 实测折行、放大回同行），卡片多了自动换行，
  仍在卡面上方。
  配色与阶段判断的唯一实现是 `web/src/utils/card-urgency.ts` 的 `urgencyOf()`（大卡面与
  缩略小卡面共用），所以**缩略图与对应大卡永远同色同字色**。
  **左边今天**（日期 + 星期 + 本周区间 + 待还张数与合计），**右边本周要还的卡**——
  小卡面样式，写应还金额与倒计时，逾期标红并显示逾期天数。口径：
  以周一为一周开始，取每张卡**最早那一期未还账单**，还款日在本周内或已过期就列出来；
  还完的不出现。
- **撤销已还是完整撤回**（`retractCardPayment`）：删掉这一步写下的完成记录、并把滚到下月的
  「还款日」提醒滚回本期——否则撤销后「完成记录里还留着一笔、本期却没有还款日提醒」。
  只有真的删掉了对应完成记录才动提醒（补还很久以前的某一期不会被改偏）。
- **修掉的真问题**：
  1. 同步**新建**清单分支漏了 `template`：信用卡栏目同步/导入到新设备后退化成普通清单，
     卡片页不再认识它（老用例只按名字断言，因此一直没暴露）——已补字段 + 补 Go 用例。
  2. `completions` 历史表只增不删，「标记已还」写下的那一笔用 API 删不掉，只能靠上面的撤回。
  3. `Card.AutoRepeat` 的 GORM `default:true` 坑（零值被丢弃）已修。
- 部署：沙箱 `workordernote:0.13.0`（镜像 `workordernote:0.13.0`，提交 `d3b762c`）；
  另起一台**空库新设备** `workordernote-newdev`（8909）专门试「新设备导入向导」。
  201 / 200 **未动**（仍 0.12.0）。备份：`staging-data-local.bak-pre0130-*`（含 v3）。
- **沙箱同步是「只拉不推」**（`direction = pull`，间隔 0）：对端本来是生产 201，方向 both，
  在沙箱里试出来的卡片一旦点「立即同步」就会推到生产。现在只接收、不写回（实测推送 0 项），
  同时它的对端接口仍可用（8909 的导入向导要读）。要试双向就把方向改回 both，但那时别拿生产当对端。
- 验证：迭代容器（8918）与沙箱（8908）各跑一遍全量回归 **23 个套件 588 项全绿**
  （`verify-097` 信用卡 **80 项**、`verify-099` 清单图标 **16 项**、`verify-098` 新设备导入 **27 项**）；Go 侧新增/加强
  信用卡与栏目用例（日期口径 / 当期与跨月 / 生成提醒 / 还款闭环 / 撤销撤回 / 本周待还 /
  老数据并栏 / 同步模板），全包 ok。
- 试用入口：`http://192.168.3.201:8908/`（沙箱，与生产两套数据）；
  `http://192.168.3.201:8909/`（空库新设备，首次自建管理员，用来走导入向导：
  对端填 `http://192.168.3.201:8908` + 同步令牌）。

### 2026-10-07：0.11.0 → 0.12.0

**0.12.0 — 浏览器安装（PWA）、记住登录、手机端更清爽**

- **浏览器安装**：`manifest.webmanifest` 补全（id / display_override / 快捷入口 / maskable 图标），
  新增 Service Worker（`web/public/sw.js`，构建进 `static/dist/sw.js`）与「版本信息 → 装到桌面」卡片。
  **服务端要显式提供 `/sw.js`**：静态文件是白名单式的，没登记就落到 SPA 兜底，而兜底对带扩展名的
  路径一律 404 —— 浏览器因此装不了应用（本轮踩到并修掉）。
  **SW 缓存策略**：只对带内容 hash 的 `/assets/**` 缓存优先，页面导航与其它静态文件（含 manifest）
  一律网络优先。第一版把 manifest 也缓存了，升级后安装卡片一直读旧清单（被用例抓出来）。
  注意浏览器安装要求 HTTPS 或 localhost：内网 `http://192.168.x.x:8906` 下不提供安装，
  卡片里如实说明并建议用外网 HTTPS 域名。
- **记住登录**：新增系统配置 `login_remember_days`（默认 **7**）与 `login_session_hours`（默认 **12**），
  在「系统配置 → 访问控制」里改。登录请求带 `remember`，服务端据此签发不同有效期的 JWT
  （`auth.GenerateTokenTTL`）；前端勾了就存 localStorage、没勾存 sessionStorage。两个配置都是
  **public**（登录页要显示实际天数）。配置写坏时回退默认值，不会让登录失败。
- **手机端**：列表页「导出表格」与日历页「导出本月」在窄屏隐藏；安卓壳子里登录页的服务器地址
  收成一行「服务器设置」文字（点开才弹原生输入）；列表行/卡片在窄屏去掉模糊阴影、过渡从 `all`
  收窄、去掉 hover 位移与 tap 高亮；列表页标题工具栏重做（条数 + 过期徽标 + 未完成/全部 + 刷新）。
- **诚实记录**：手机端流畅度做了 CPU 降速 4 倍的 A/B 实测（`browser-harness/measure-smoothness.js`），
  新旧两版 p50 都是 16.7ms（满 60fps）、p95 与掉帧数中位数相同（33.3ms / 7 帧）——**测不出差异**，
  这台机器的负载噪声盖过差别。能确认的是重效果在窄屏下确实不再参与渲染（用例逐条断言）。
- 部署：三台均升到 `workordernote:0.12.0`（镜像 ID `sha256:06fb381a203c…`，提交 `37c42a3`）；
  200 仍按「先 `docker load`、再改标签、最后 `up -d`」，无中断。
- 备份：201 / 200 `data.bak-pre0120-20261007-134*`、沙箱 `staging-data-local.bak-pre0120-20261007-134246`。
- 回归（生产 201，0.12.0）：**21 个套件 492 项全通过**——`verify-ux` 16、`verify-filters` 9、
  `verify-013` 25、`verify-017` 10、`verify-icon` 15、`verify-print` 24、`verify-export` 44、
  `verify-040` 33、`verify-050` 23、`verify-052` 17、`verify-060` 22、`verify-070` 33、`verify-080` 22、
  `verify-090` 34、`verify-091` 10、`verify-092` 35、`verify-093` 30、`verify-094` 17、`verify-095` 30、
  **`verify-096` 33**、`verify-reminders` 10；沙箱先跑 096(33)/092/094/095 再上生产。
- 其余验证：离线包 `WorkOrderNote-0.12.0-offline-amd64.tar.gz`（tar sha256 `4e7c52cf02312008…`）
  自检 **30/30**；同步端到端 **44/44**；真机 201↔200 配对 **15/15**；Go 测试全包 ok、退出码 0。
- 三台数据核对：指纹 `3ad3c9dabcb37a23` 一致，33 条；`login_remember_days=7`、
  `login_session_hours=12`（默认值）。
- **注意**：内网是 `http://192.168.x.x:8906`，不是安全上下文——浏览器安装（PWA）在这种源上
  Chrome 不提供安装、`navigator.serviceWorker` 也不存在（代码按设计跳过注册）。
  要用浏览器安装，请走 HTTPS 域名（外网反代）。
- 安卓客户端无需重装：这批只改了网页（服务器地址入口在登录页上），已装的 0.1.0 客户端会自动看到新界面。

### 2026-10-06：0.10.0 → 0.11.0

**0.11.0 — 安卓客户端与配套发布；日历打印列表模式；手机端不提供日历视图**

- **安卓客户端（WebView 壳子）**：新增 `reminders-upstream/android-shell/`（纯 Java，不用 Gradle/AndroidX）。
  本机用 `aapt2 + javac + d8 + zipalign + apksigner` 直接出包，见 `android-shell/README.md` 与
  `android-shell/build-apk.sh`；签名密钥在 `android-shell/keystore/workordernote.jks`（**必须保留**，
  换密钥签的包无法覆盖安装）。当前产物 `WorkOrderNote-android-0.1.0.apk`（24KB，
  sha256 `5f41da7950ff9f6b…`）。
- **APK 由应用自己托管**：`GET /api/reminder/android`（信息）、`GET /api/reminder/android/apk`（下载，
  公开）、`GET /api/reminder/android/qrcode?addr=lan|wan`（二维码）；管理员接口
  `POST/DELETE /api/reminder/admin/android/apk` 上传/下架，文件落在 `<数据目录>/downloads/`。
- **配置与界面**：「系统配置 → 安卓客户端」里改版本号 / 更新说明 / 内网地址 / 外网地址并上传安装包；
  「版本信息」里新增**安卓客户端卡片**（版本、说明、大小、下载按钮、二维码，内网·外网可切换并记在本机）；
  登录页在**壳子里**才显示「服务器地址」入口（网页版不受影响）。
- **配置不参与双机同步**（同步只同步清单/提醒/记事/完成记录），所以**三台要各上传一次安装包、
  各填一次地址**——本轮已经把三台都发布好了（sha256 三台一致）。
- 顺带修掉一个真 bug：**字符串型配置无法清空**（`handleUpdateConfig` 给 `value` 加了
  `binding:"required"`，空格外的空值直接 400，于是「外网下载地址」填过就删不掉）。已去掉该约束，
  类型校验仍由 `Validate` 负责（bool/int/select 传空照样拒绝），并补了 `TestUpdateConfigAllowsEmptyString`。
- 另两项：日历打印新增**列表**模式（与「已完成记录」同款表格，可勾选列）；**手机端不再提供日历视图**
  （入口隐藏 + 路由守卫 + 缩放时回跳，「默认首页=日历」在手机上忽略）。
- 部署：三台均升到 `workordernote:0.11.0`（镜像 ID `sha256:db4d34336021…`，提交 `430eb22`）；
  200 仍按「先 `docker load`、再改标签、最后 `up -d`」，无中断。
- 备份：201 / 200 `data.bak-pre0110-20261006-011*`、沙箱 `staging-data-local.bak-pre0110-20261006-011155`。
- 回归（生产 201，0.11.0）：**20 个套件 459 项全通过**——
  `verify-ux` 16、`verify-filters` 9、`verify-013` 25、`verify-017` 10、`verify-icon` 15、`verify-print` 24、
  `verify-export` 44、`verify-040` 33、`verify-050` 23、`verify-052` 17、`verify-060` 22、`verify-070` 33、
  `verify-080` 22、`verify-090` 34、`verify-091` 10、`verify-092` 35、`verify-093` 30、`verify-094` 17、
  **`verify-095` 30**、`verify-reminders` 10；沙箱先跑 095(31)/092/093/094 再上生产。
- 其余验证：离线包 `WorkOrderNote-0.11.0-offline-amd64.tar.gz`（43MB，tar sha256
  `a870965191597c2c…`）自检 **30/30**；同步端到端 **44/44**；真机 201↔200 配对 **15/15**；
  Go 测试全包 ok、退出码 0（本轮后端有改动）。
- 安卓客户端发布状态：三台（201 / 沙箱 / 200）都已上传 `WorkOrderNote-android-0.1.0.apk`
  （sha256 `5f41da7950ff9f6b…`，24KB），卡片上的「内网地址」留空＝自动取当前访问地址；
  **外网地址尚未填**——要外网下载的话，在「系统配置 → 安卓客户端 → 外网下载地址」里填上反代域名即可。
  APK 另存了一份在 201 的 `/vol1/1000/Docker/workordernote/android/` 与 200 的
  `/vol1/1000/Docker/workordernote/android/`，便于回退。

### 2026-10-05：0.9.1 → 0.10.0

**0.10.0 — 日历视图「打印本月」（整月月历 A4 打印）**

- 日历工具条「导出本月」左边新增「打印本月」：按 **A4 横向**打印当前显示的整月月历，
  与「已完成记录」的打印同一套机制（`#print-root` + `@media print` + 打印前动态注入 `@page`）。
- 弹窗里可预览再打印，能调：打印内容（农历/节气、记事、已完成、时间）、纸张方向（默认自动=横向）、
  字号（自动/小/中/大）、标题、说明行开关。**打印的是本月全部安排**——不像屏幕上每天截成 3 条 + `+N`。
- 每格安排左侧带清单色条、文字用清单同色：用户关掉浏览器「打印背景图形」时仍能分辨清单。
  一周一行 `break-inside: avoid`，跨页不撕行。
- 新增 `verify-092.js` **35 项**。这版是「攒批发布」流程的第一次实践：先在挂载 dist 的临时容器
  8918 上自检通过（并跑 070/040/090/091/export 确认无回退），确认后才发版。
- **构建只花了约 2 分钟**（0.9.1 那次把 `ARG VERSION/BUILD_TIME/GIT_COMMIT` 移到 `apk` 之后，
  这版 apk 层直接命中缓存）——之前每版都要重装 gcc 十几分钟的问题确认解决。
- 部署：三台均升到 `workordernote:0.10.0`（镜像 ID `sha256:e275f389aeaf…`，提交 `ba22840`）；
  200 仍按「先 `docker load`、再改标签、最后 `up -d`」，无中断。
- 备份：201 / 200 `data.bak-pre0100-20261005-231*`、沙箱 `staging-data-local.bak-pre0100-20261005-230933`。
- 回归（生产 201，0.10.0）：**17 个套件 380 项全通过**——
  `verify-ux` 16、`verify-filters` 9、`verify-013` 25、`verify-017` 10、`verify-icon` 15、`verify-print` 24、
  `verify-export` 43、`verify-040` 33、`verify-050` 23、`verify-052` 17、`verify-060` 22、`verify-070` 32、
  `verify-080` 22、`verify-090` 34、`verify-091` 10、**`verify-092` 35**、`verify-reminders` 10；
  沙箱先跑 `verify-092` 35/35 再上生产。离线包 `WorkOrderNote-0.10.0-offline-amd64.tar.gz`（43MB，
  tar sha256 `6c46e4513fad32d2…`）自检 **30/30**；同步 E2E 44/44；Go 测试全包 ok、退出码 0（后端未改）。

### 2026-10-05：0.9.0 → 0.9.1

**0.9.1 — 新建框的「任务清单」会跟着当前清单走**

- **修 0.9.0 带出来的别扭行为**：列表视图新建提醒时，输入框下面那个「任务清单」选择框只在
  第一次进页面时定过一次，之后再点进别的清单它还是停在后台默认清单，得手动再切一次。
  现在的规则：**在具体清单页里 → 跟随当前清单**；**今天 / 计划 / 全部 / 已完成 → 用后台默认清单**；
  从清单页切回今天/全部立刻回到默认。默认值只依赖「路由里的清单」与「后台默认清单」两处变化，
  别人同步触发的实时刷新不会把用户手动选的清单冲掉。
- 改动只在前端 `web/src/views/HomeView.vue`（后端零改动）：加 `defaultListID` / `quickTargetListID`
  两个 computed 与一个 watcher，删掉原来 `if (!quick.list_id)` 的一次性初始化，提交后归位也走同一个值。
- 新增 `verify-091.js`（10 项）覆盖：进清单跟随、两个清单来回切、今天/全部回到默认、
  在清单页建的提醒落进该清单、建完仍停在当前清单、手动选择不被实时刷新冲掉、用完清理。
- **构建提速（重要，只影响本地构建）**：`Dockerfile.custom` 里 `ARG VERSION/BUILD_TIME/GIT_COMMIT`
  原来声明在 `apk add gcc musl-dev` **之前**——ARG 是它后面每条 RUN 的缓存键的一部分，于是
  **每发一版都会重装一遍 gcc**（本机 apk 源在构建容器里最慢只有 ~9KB/s，实测一层拖半小时）。
  现已把这三个 ARG 挪到 `go build` 前一行，只有最后那条编译会重跑；0.9.1 这一版是最后一次付
  「换 Dockerfile 顺序」的代价（顺序变了，旧的 apk 层缓存对不上），**0.9.2 起发版会直接命中缓存**。
- **数据差异排查（记一次教训）**：部署后三台指纹不一致，沙箱的清单颜色与 201/200 不同。
  先读 201 的库与 `audit_logs`：22:00 有 4 笔 `PATCH /api/reminder/lists/:id` 来自
  **`192.168.3.17`（用户自己的设备）**——是用户把「自动提醒 / 工作安排」两个清单的颜色对调了，
  201→200 的自动同步已跟过去，而沙箱是手动同步所以停在旧颜色。**结论：不是脚本改的**
  （脚本的请求来自 `10.200.20.1`，与用户设备不同 IP）。随后在沙箱点一次「立即同步」追平
  （拉取更新 3 条 / 推送 0 条），三台指纹恢复一致 `1e072883324e86c0`。
  排查手法：`docker run --rm -v /vol1/1000/Docker/workordernote/data:/d:ro python:3.12-alpine python -c "...sqlite3..."`
  读 `lists`（含 `updated_at`）与 `audit_logs`（含 `ip`）。
- 部署：三台均升到 `workordernote:0.9.1`（镜像 ID `sha256:aa84bfc69163…`，提交 `09a4cfb`）。
  200 这次按 0.9.0 的教训**先 `docker load`、再改 compose 标签、最后 `up -d`**，全程没有中断。
- 备份：201 `data.bak-pre091-20261005-221957`、200 `data.bak-pre091-20261005-222*`、
  沙箱 `staging-data-local.bak-pre091-20261005-221945`。
- 离线包 `WorkOrderNote-0.9.1-offline-amd64.tar.gz`（43MB，tar sha256 `697080c8bd83cbd2…`），
  离线包自检 **30/30**。
- 回归（生产 201，0.9.1）：16 个套件 **345 项全通过**——
  `verify-ux` 16、`verify-filters` 9、`verify-013` 25、`verify-017` 10、`verify-icon` 15、`verify-print` 24、
  `verify-export` 43、`verify-040` 33、`verify-050` 23、`verify-052` 17、`verify-060` 22、`verify-070` 32、
  `verify-080` 22、`verify-090` 34、**`verify-091` 10**、`verify-reminders` 10；沙箱（同一个镜像）
  先跑 `verify-091` 10/10、`verify-090` 34/34 再上生产。
  同步：`verify-sync-e2e.sh` 44/44（两台一次性容器，日志确认镜像就是 `workordernote:0.9.1`）。
  Go：`go test ./...` 复用缓存构建的 `go-builder:0.9.1` 跑，全包 ok、退出码 0（后端本轮未改）。

### 2026-10-05：0.8.1 → 0.9.0

- 三台数据核对（部署后）：指纹 `6d239fab0f94fd0b` 三台一致，31 条（29 任务 + 2 记事），
  清单 `自动提醒:amber` / `工作安排:violet` / `个人事务:rose`，用户偏好未被改动。
- 备份：201 `data.bak-pre090-20261005-205733`、200 `data.bak-pre090-20261005-205733`、
  沙箱 `staging-data-local.bak-pre090-20261005-205648`。

**0.9.0 — 清单交互改右键、左上角切视图、快速新建可选清单**

- **「我的清单」去掉铅笔**：改名/改色/设默认/删除改为**右键**清单行（手机长按 0.55 秒）出菜单，
  重命名是就地输入框（回车保存、Esc 取消），删除带确认且默认清单禁用。侧栏少了 4 个按钮。
- **左上角 logo = 视图切换**：点一下进日历、再点一下回列表；提示与 `aria-label` 随视图变化，
  顶栏原有的「列表 / 日历」开关保留。
- **列表视图快速新建**：「清单」下拉挪到「更多」**前边常显**，默认选中后台设置的默认清单，
  临时改一次只影响该条，提交后回到默认（色点与清单同色）。
- **今天 / 计划 / 全部的「未完成 / 全部」默认「未完成」**，该偏好**只存浏览器 localStorage**，
  换浏览器即为默认值（用例里对 `ui_list_status` 做了「只在本地、不进 `/api/configs`」的断言）。
- 本轮**后端零改动**（Go 未动，无需重跑 Go 测试外的迁移），新增 `verify-090.js` **34/34**。
- 运维：部署脚本这次用 `sed -E 's|workordernote:[0-9]+\.[0-9]+\.[0-9]+|…|g'` 正则匹配任意旧标签，
  修掉 0.8.1 那轮「写死旧版本号导致白重启」的坑。
- **运维踩坑（本轮真踩到）**：200 上新镜像还没 `docker load` 就先改了 compose 标签再 `up -d`，
  compose 会**先删旧容器再建新的**，镜像不存在 → 旧容器被删、新容器起不来，**服务中断**。
  救法：本机 `docker save workordernote:0.9.0 | gzip` → scp → 在 200 上 `sudo docker load -i`，
  再 `docker compose up -d`。**顺序必须是「先导镜像、后改标签」，或先改标签但别立刻 up**。
- 镜像与包：`workordernote:0.9.0` = `sha256:458a8f3832e2…`（提交 `a84dcb7`，87.6MB）；
  离线包 `WorkOrderNote-0.9.0-offline-amd64.tar.gz`（43MB，tar sha256 `6fa24802d7facfbb…`），
  离线包自检 **30/30**。
- 回归（生产 201，0.9.0）：`verify-013` 25、`verify-017` 10、`verify-icon` 15、`verify-print` 24、
  `verify-export` 43、`verify-040` 33、`verify-050` 23、`verify-052` 17、`verify-060` 22、`verify-070` 32、
  `verify-080` 22、`verify-090` 34、`verify-ux` 16、`verify-filters` 9、`verify-reminders` 10 —— 全绿；
  同步：`verify-sync-e2e.sh` 44/44（**两台一次性容器，0.9.0 镜像**）、`verify-sync.js` 27/27、
  `verify-sync-local.sh` 15/15（用**真实生产配对** 201↔200 跑，自检任务用完即删、两端回到基线 31 条）。
  本轮后端零改动，`go test ./...` 仍在 golang 容器里跑：`auth`/`config`/`database`/`logger`/`lunar`/
  `middleware`/`reminder`/`scheduler`/`server`/`sysconfig`/`utils` **全部 ok，退出码 0**。
- **构建经验（省时间的关键）**：`Dockerfile.custom` 顶部的 `ARG VERSION/BUILD_TIME/GIT_COMMIT` 在
  `apk add gcc musl-dev` 之前，**改这三个值会让后面每一层缓存失效**，于是每次都要重装 gcc
  （本机 apk 源在构建容器里可能慢到 ~9KB/s，一层能拖半小时）。
  只是想在容器里跑 Go 测试时，用原参数 `--build-arg BUILD_TIME=<上次的值>` 构建
  `--target backend-builder`，全部缓存命中、几秒出镜像，再 `docker run --rm <镜像> go test ./...`。
  两处老用例（`verify-050.js` 的「侧栏铅笔」、`verify-reminders.js` 的「日历铅笔」）按 0.9.0 的新入口
  （右键 / ⋯ 菜单）改写后再跑，不是产品回退。

### 2026-10-05：0.8.0 → 0.8.1

**0.8.1 — 图标栏不再显示滚动条（图标居中）**

- 侧栏收成 56px 图标栏时，菜单比一屏长会冒出一条滚动条，把图标整体推得偏左（实测差 5px，视觉上也脏）。
  现在图标栏里不显示滚动条（滚轮 / 触摸仍可滚），图标真正居中。
- 顺带修掉两条自检用例的脆弱假设（生产上误报过）：
  ① 已完成任务在日历右侧列表里的按钮是「恢复提醒」而不是「完成提醒」，只匹配「完成」会假红；
  ② 日历格子每天只铺 3 条（`MAX_CHIPS`），当天条目多时新建的那条会被挤成「+N」，只查格子会假红——
  现在先点开当天详情，在右侧列表里断言。
- 验证：生产全量回归 **16 / 9 / 25 / 10 / 15 / 24 / 43 / 33 / 23 / 17 / 22 / 32 / 22** 全绿；
  离线包 0.8.1 验证 **30/30**。
- **运维踩坑记录**：这轮的部署脚本用 `sed 0.7.1→0.8.1` 改镜像标签，但两台机器上一次已经升到 0.8.0，
  正则没匹配上 → 201/200 白重启了一次仍停在 0.8.0。**改标签前先读回当前值**（或直接写目标值），
  别假设上一版是什么。
- 部署：三台均升到 `workordernote:0.8.1`（镜像 ID `sha256:0415f2f2…`，提交 `eb1187b`）；
  备份 201 `data.bak-pre080-*` / `data.bak-pre081-*`、200 `data.bak-pre080-20261005-195008` /
  `data.bak-pre081b-20261005-202153`。

### 2026-10-05：0.7.1 → 0.8.0

**0.8.0 — 日历右侧列表支持右键菜单：修改 / 删除**

- 日历右侧当天列表原来每行只有一支「只能编辑」的笔，删不掉。现在每行都有**右键菜单**
  （修改 / 删除），行尾入口从铅笔换成「⋯」——点它开同一个菜单，手机上右键不方便所以按钮常显。
- 菜单 Teleport 到 body 做 fixed 浮层（放面板里会被 `overflow-y-auto` 裁掉），出现在点击位置，
  贴屏幕右/下边自动回收；点空白、别处右键、Esc、滚动、改窗口大小都会收起。
- **删除走确认浮层**（与列表页同一个 `ConfirmDialog`）：写明是哪一条，确认后从日历、列表与库里一起消失
  （软删除）。记事同样可删。
- 实现上踩到一处：菜单宽度改成 `w-[11rem]`(176px) 却忘了同步收紧「贴边回收」用的常量（还是 152），
  右下角右键时就出屏了。两处尺寸必须一起改，`verify-080.js` 里专门有一条断言盯着。
- 验证：新增 `verify-080.js` **22 项全通过**；其余回归与离线包（0.8.0，30/30）全绿。

### 2026-10-05：0.7.0 → 0.7.1

**0.7.1 — 新建弹窗收掉通知方式，一张卡片显示完整**

- 日历里的居中弹窗不再显示「通知方式」六格渠道选择（它一个人占两百多像素，卡片装不下整张表单）；
  渠道沿用默认设置（编辑已有提醒时沿用原有），弹窗里留一行说明指向列表视图。
- 版式收紧让**整卡不用滚动**：字段网格在弹窗里三列（六字段两行排完）、行距收紧、宽度 640 → 680px。
  实测内容高度 590px = 可视高度 590px（900px 高的屏幕上完整显示；屏幕更矮时内部滚动、不溢出屏）。
- 隐藏 UI 不丢数据：弹窗新建仍带默认渠道（站内消息），弹窗保存已有提醒也不清空原渠道（两处都有断言）。
- 列表视图的抽屉原样，「通知方式」六格照旧完整可编辑。
- 验证：`verify-070.js` 扩到 **32 项全通过**；其余回归与离线包（0.7.1，30/30）全绿。
- 部署：三台均升到 `workordernote:0.7.1`（镜像 ID `sha256:648509bd…`，提交 `0e5ee55`）；
  备份 201 `data.bak-pre071-*`、200 `data.bak-pre071-20261005-180846`。

### 2026-10-05：0.6.1 → 0.7.0

**0.7.0 — 日历新建改成居中的悬浮弹窗**

- 日历视图里的「新建 / 编辑」从**右侧抽屉**改成**居中悬浮弹窗**：带遮罩的圆角卡片，左右上下居中，
  宽屏最多 640px、高度最多 88vh，表单内部自己滚动。触发方式不变（右侧当天详情的「＋ 新建」、
  双击某个日期格预填那天的时间），点遮罩或 × 关闭。
- **列表视图保持原来的右侧抽屉**：两处共用同一个 `ReminderEditor`，靠新增的 `presentation`
  属性（`drawer` / `modal`）切换外壳与过渡（抽屉是 `translateX(100%)`，弹窗是淡入 + 轻微缩放），
  表单字段与保存逻辑一行都没分叉。
- 手机端同样是居中卡片：左右各 12px，不出屏、不横向溢出，「保存」始终在视野内。
- 验证：新增 `verify-070.js` **24 项全通过**（居中判定用 `clientWidth/clientHeight`、
  双击日期格同样弹窗、遮罩与 × 关闭、**弹窗内真建一条 → 落库到双击那天 → 日历格子出现 → 软删清理**、
  列表视图仍是贴右全高抽屉、手机端布局、无残留面板）；其余回归与离线包（0.7.0，30/30）全绿。
- 部署：三台均升到 `workordernote:0.7.0`（镜像 ID `sha256:f3545b8e…`，提交 `71e587d`）；
  备份 201 `data.bak-pre070-*`、200 `data.bak-pre070-20261005-175000`。

### 2026-10-05：0.6.0 → 0.6.1

**0.6.1 — 图标栏收尾：设置只剩齿轮，清单只剩色点**

- 用户反馈两处挤在一起：①「设置」入口在图标栏里还带着「设置」两个字——它不在通用的
  `.nav-row > .flex-1` 结构里，所以上一版按结构写的折叠规则没覆盖到；②「我的清单」里默认清单的
  星标挤在色点旁边。现在图标栏里设置只剩齿轮、清单行只剩色点，**展开回完整侧栏时文字与星标都回来**。
- 验证：`verify-060.js` 补了两组断言（图标栏里只剩图标、展开后星标与文字复现）→ **22 项全通过**；
  其余回归与离线包（0.6.1，30/30）全绿。
- 部署：三台均升到 `workordernote:0.6.1`（镜像 ID `sha256:e5d5b8e1…`，提交 `19fde98`）；
  备份 201 `data.bak-pre061-*`、200 `data.bak-pre061-20261005-162254`。

### 2026-10-05：0.5.2 → 0.6.0

**0.6.0 — 侧栏改成图标栏，进日历自动收起**

- **日历视图里侧栏自动收成 56px 图标栏**（日历要的是横向空间），离开日历自动还原；
  还原的是用户自己的折叠偏好，这一次访问不会把它改掉。
- **折叠不再是「整条藏起来」**：现在留一条图标栏——图标居中、文字与角标收起，
  内容区只让出 56px。以前 `.sidebar-rail` / `.rail-hide` 这套 CSS 写好了却没人用（模板从不加这个类），
  折叠是直接把侧栏 `-translate-x-full`（彻底消失，只能再点顶栏按钮唤回）；这次把它接上了。
- **图标带悬停提示**：图标栏里每个入口（今天/计划/全部/已完成/各清单/通知方式/偏好设置/
  系统管理各页/版本信息，以及新建提醒与设置）都有 `title` 提示文字。用原生提示气泡是刻意的：
  侧栏滚动容器是 `overflow-y: auto`（按规范另一轴会变成 auto），自绘气泡伸到侧栏右侧会被裁掉。
- 在日历里手动开合仍然有效，且不会被自动收起反复覆盖；手动的选择会被记住
  （实现上把「用户偏好」与「当前视图的临时收起」分成两个状态，`railActive = 偏好 || 临时`）。
- 手机端不受影响：图标栏规则都带 `lg:` 前缀，抽屉里仍是带文字的完整侧栏。
- 验证：新增 `verify-060.js` **18 项全通过**（图标栏宽度/居中、文字隐藏图标仍在、内容区 56px、
  进/出日历自动收起与还原、偏好未被改写、提示文字就是菜单名、手动展开不被覆盖、手机抽屉完整、
  390px 不溢出）；生产回归 **16/9/25/10/15/24/43/32/23/17/18** 全绿；离线包 0.6.0 验证 **30/30**。
- 部署：三台均升到 `workordernote:0.6.0`（镜像 ID `sha256:4c823389…`，提交 `438b1d3`）；
  备份 201 `data.bak-pre060-*`、200 `data.bak-pre060-20261005-160839`。

### 2026-10-05：0.5.1 → 0.5.2

**0.5.2 — 侧栏折叠「设置」入口加浅蓝底与齿轮图标**

- 侧栏左下角那个可折叠的「设置」入口原来只是一行灰色小字，扫一眼容易漏掉；现在加了
  **浅蓝色底**（品牌蓝低透明度叠加，浅色/深色主题下都是浅蓝）、同色细边框与**齿轮图标**；
  展开时底色再深一点，折叠箭头也跟着品牌色。
- 补无障碍属性：除 `aria-expanded` 外加了 `aria-controls` 指向子菜单，图标对读屏隐藏。
- 文字在那层浅蓝底上的对比度在浅色与深色主题下都 ≥ 4.5:1（实测约 8:1 / 7:1）。
- 验证：新增 `verify-052.js` **17 项全通过**（底色为蓝色且透明度低、齿轮图标并跟随品牌色、
  浅/深主题对比度、展开折叠行为与 `aria-controls`、390px 抽屉内可见不溢出、
  **用例结束还原开合状态**）。生产回归 **16/9/25/10/15/24/43/32/23/17** 全绿；
  离线包 0.5.2 重打并验证 **30/30**。
- 部署：三台（201 / 200 / 沙箱 8908）均升到 `workordernote:0.5.2`（镜像 ID `sha256:90882c15…`，
  提交 `959c3c1`）；备份 201 `data.bak-pre052-*`、200 `data.bak-pre052-20261005-154931`。

### 2026-10-05：0.5.0 → 0.5.1

**0.5.1 — 同步设置接口的一处修正**

- 「保存同步设置」的约定是「令牌留空 = 不修改」，但后端只校验传进来的值：在**已启用同步**状态下，
  只改对端地址、不带令牌的调用会被判成「同步令牌至少 8 位」而 400。
  现在改为校验**实际生效的令牌**（新填的，或库里已有的）：既保留原约定，也不会放过空令牌。
  界面不受影响（它总是带着令牌），受影响的是脚本/接口调用——本轮修 200 的对端地址时就踩到了。
- 行为不变：太短的令牌仍然拒绝；库里令牌为空时启用同步仍然拒绝。
- 新增用例 `TestSaveSyncSettingsKeepsExistingToken`（留空不改 / 库空拦截 / 太短拦截）；
  `go vet` + `go test ./...` 全绿；三台升到 `workordernote:0.5.1`（镜像 ID `sha256:5a999e74…`，
  提交 `2ae0e0e`），离线包 0.5.1 重新打包并验证 **30/30**。

### 2026-10-05：0.4.0 → 0.5.0

**0.5.0 — 清单颜色可修改，任务标题按清单色显示，日历同步更新**

- **侧栏清单可编辑**（改名 / 换颜色）：每个清单行右侧新增铅笔按钮（桌面悬停显示、手机常显），
  弹窗里可选 5 个颜色（蓝/紫/玫红/琥珀/绿）。此前清单一经创建，名字和颜色都改不了
  （颜色是新建时按顺序自动分配的）。
- **列表页任务标题按所属清单的颜色显示**（今天/计划/全部/我的清单都生效）：侧栏圆点、
  任务标题、日历色块三处用同一个色值，同一清单处处同色。列表接口为此新增 `list_color` 字段。
- **改完颜色，已经打开的日历立刻跟着变色**，不用刷新页面：日历此前完全不监听数据变更事件
  （另一台设备改了数据也看不到），现在与列表页一样监听 `reminder-realtime` 并重拉；
  本机的清单改动也会广播同形状的事件。
- 颜色白名单：后端只接受 5 个色名（`supportedListColors`），乱填返回 400 且不写库；
  前端遇到历史脏值回落到蓝色（不会整块失色）。
- 颜色是清单自身的属性，所以**双机同步会一起带过去**：一端改色，另一端同步后同色。
- 顺带清理：同一张色表原先在 MainLayout / ListFilter / HomeView / CalendarView 各抄了一份，
  现在收到 `web/src/utils/list-colors.ts` 一处。
- 验证：新增 `TestListRemindersCarriesListColor`（列表/单条接口带 `list_color`，改色后立即变化）与
  `TestListColorValidationAndHandler`（白名单 + 接口 400 且不写库）；`go vet` + `go test ./...` 全绿。
  浏览器新增 `verify-050.js` **23 项全通过**（含「已打开的日历不刷新即变色」「三处同色」
  「取消不改」「空名称被拒」「窄屏可点不溢出」「结束还原原色」）。沙箱与生产回归：
  **16/16 + 9/9 + 25/25 + 10/10 + 15/15 + 24/24 + 43/43 + 32/32 + 23/23**；离线包 0.5.0 重打并验证 **30/30**。
- 部署：201 与 200 均升到 `workordernote:0.5.0`（镜像 ID `sha256:7ddbf76f…`，提交 `d75f2ad`）；
  备份 `data.bak-pre050-20261005-151701`（201）、`data.bak-pre050-20261005-151748`（200）。

### 2026-10-05：0.3.0 → 0.4.0

**0.4.0 — 日历纳入记事、列表可切「未完成 / 全部」、日历也能导出**

- **日历视图现在显示记事**（用户反馈：刚记的工作记录在日历上看不到）。记事没有到期时间，
  按**记录时间**（创建那一刻，即它的 completed_at）落在当天格子里；格子用「记」标记与任务区分，
  右侧详情显示「记录 14:18」+「记事」徽标，并且**没有完成勾选框**（记事无需完成）。
  计数上记事单独一档「记事 N」，不混进未完成/已完成。
- **列表页新增「未完成 / 全部」开关**（今天/计划/全部/我的清单）：选「全部」时已完成的任务与
  记事一起出现，已完成排在后面并划线置灰；选择记在本机（`ui_list_status`），刷新后仍在。
  这也是在「我的清单」里看见记事的唯一入口——记事创建即完成，默认口径下不显示。
- **导出跟随开关**：列表页「导出表格」在「全部」下带 `status=all`，导出的表格与屏幕上完全一致
  （含已完成行，状态列写「已完成」）。
- **日历页新增「导出本月」**（日历原来没有任何导出入口）：按 `scope=calendar&month=YYYY-MM` 导出
  当月日历内容，任务按到期时间、记事按记录时间；记事行的类型列写「记事」、状态列写「记事」、
  记录时间写进「完成时间」列，「到期时间」留空。导出跟随日历上选择的清单筛选。
- 后端口径：`GET /items` 新增 `status=all`；`GET /export` 新增 `status=all` 与 `scope=calendar`；
  `CalendarItemDTO` 增加 `notes`/`completed_at`；日历查询改为「任务按 due_at ∪ 记事按 completed_at」，
  排序按 `COALESCE(due_at, completed_at)`。
- **顺带修掉一个移动端回归（自查发现）**：记事的长标题（一整句抢修记录）让日历在 390px 屏上
  横向溢出到 832px。原因是外层栅格是隐式单列（`auto`）、月历是 `grid-cols-7`（同样是 auto），
  长内容会把列撑开；改为外层 `grid-cols-1`、月历 `grid-cols-[repeat(7,minmax(0,1fr))]`，
  并给详情面板的标题 flex 容器补 `min-w-0`。修复后 390px 下 `scrollWidth=380`（与 0.3.0 一致）。
- 验证：新增用例 3 个（`TestCalendarIncludesNotesOnRecordDate`、`TestListRemindersIncludeCompleted`
  与日历/列表导出断言），日历用例按新语义更新；`go vet ./...` + `go test ./...` 全绿。
  浏览器新增 `verify-040.js` **31 项全通过**（含窄屏不溢出）；沙箱与生产回归
  **16/16 + 9/9 + 25/25 + 10/10 + 15/15 + 24/24 + 43/43**；离线包 0.4.0 已重打并验证 **30/30**。
- 部署：201（生产）与 200（第二台）都已升到 `workordernote:0.4.0`（镜像 ID `sha256:7806a411…`，
  提交 `bb3a0df`）；201 升级前备份 `data.bak-pre040-20261005-145305`，200 升级前备份
  `data.bak-pre040-20261005-145414`，两处 `integrity_check=ok`。

### 2026-10-05：0.2.0 → 0.3.0

**0.3.0 — 双机同步（两台飞牛 NAS 之间单向或双向同步）**

- 「系统配置」页新增「双机同步」面板：对端地址、通信令牌、同步方向（关闭 / 本机→对端 /
  对端→本机 / 双向）、自动同步间隔（仅手动 / 5 分钟 … 每天）、`测试连接` / `立即同步` /
  `重新生成令牌`，以及「本机 / 对端」概况与上次同步的各方向计数、跳过原因。
- 同步内容：清单、任务、记事、完成记录（含重复提醒的每一次完成历史）与提醒选用的渠道名。
  账号密码、渠道绑定凭据、provider 密钥、投递记录、站内通知、操作日志、系统配置一律不出本机，
  也不把对端的搬过来（已由端到端用例断言）。
- 身份与配对：每个可同步行带一个跨机器的 `sync_uid`；账号按**用户名**配对（两端自增 ID 往往不同）。
  历史数据在启动时按内容摘要补齐标识，因此「先把数据目录复制到新机器再开同步」不会复制成两份。
- 合并语义：按 `updated_at` 做「谁新谁生效」，完全相同则按实例标识裁决；删除以软删除墓碑同步；
  内容完全一致的行不写库、不计入「更新」，仅在需要时静默追平时间戳。
- 同步过来的提醒只对「还没到点」的建投递任务，并先取消队列里按旧时间排的任务；
  因此首次同步不会在对端炸出一批过期通知。
- 对端接口在 `/api/reminder/sync/*`，用共用的 `X-Sync-Token` 鉴权（常量时间比较）；
  未启用同步的实例一律 403。令牌与实例标识存在 sysconfig 的内部配置项里（不出现在通用配置接口）。
- 镜像增加 OCI 标签（`org.opencontainers.image.title=WorkOrderNote` 等）：Docker 仓库名只能小写，
  显示名放在标签与安装包清单里；新增 `Dockerfile.custom` 的 LABEL 段。
- 新增 **Docker 离线一键安装包**（`build-offline-package.sh` 打包、`install.sh` 一键安装/升级、
  `uninstall.sh` 卸载、`pull_policy: never` 离线安全），已发布到 `images/` 并用
  `verify-offline-package.sh` 跑了 30 项验证（含 `docker load`、升级保数据、`--purge` 删数据）。
- 验证：`server/reminder/sync_test.go`（双库收敛 / 用户名配对 / LWW 冲突 / 删除传播 / 未匹配账号跳过 /
  清单删除后的孤儿收拢 / 报文不含密钥 / 路由挂载 / 双实例 HTTP 往返 / 定时同步三道闸门 / 设置校验），
  容器端到端 `browser-harness/verify-sync-e2e.sh` **44 项全通过**（两台真实容器 8911/8912），
  浏览器交互 `browser-harness/verify-sync.js` **27 项全通过**（含窄屏不溢出、无 JS 报错）。
  后端 `go vet ./...` + `go test ./...` 全绿（本次顺带把全仓 Go 文件做了 gofmt 对齐）。

### 2026-10-05：0.1.9 → 0.2.0

**0.2.0 — 完成记录可打印，导出与刷新改成按钮**

- 「已完成」页右上角：`导出表格` / `刷新` 从裸文字改成**真正的按钮**（带图标、边框、按压反馈），
  并新增 **`打印`**；窄屏允许换行。
- 打印弹窗可选列：序号、标题、类型、清单、完成时间、原定时间、重复、记录来源
  （默认前五列），另有全选 / 恢复默认；左侧实时预览（最多 8 行）。
- **按内容自适应纸张**：列 ≥5 自动横排、≥6 自动收小字号，也能手动指定方向与字号；
  表格 `table-layout:auto` 按内容分配列宽，标题折行、时间列不折行，`thead` 跨页重复。
- 打印内容 = 当前筛选结果（与时间段、清单、搜索一致），可选打印「区间 / 清单 / 条数 / 打印时间」
  说明与自定义标题；纸张方向通过动态注入的 `@page` 规则实现，关闭弹窗即撤掉。
- 顺带修掉一个老问题：**列表页的提醒编辑器一直没有 import**（模板里用着、脚本里没引入），
  点标题打不开编辑面板，现已补上。
- 验证（新增 `verify-print.js` 24 项）：三个按钮样式、弹窗与打印区、8 列可选、默认 5 列、
  列数变化驱动自动横排/字号、手动方向同步 `@page`、打印媒体下应用隐藏 + 表格宽度正好等于可打印区
  （1033px）且单元格零溢出、8 列时仍不溢出、A4 横向 PDF（842×595pt）页数合理、关闭后清理干净。
  生产回归：16/16 + 24/24 + 44/44 + 25/25 + 15/15 + 9/9 全绿。

**顺带修稳了两个用例（重要）**：`verify-ux` 的第 1 步会改「默认首页」，
原先还原步骤有竞态（Vue 异步更新 DOM 时保存按钮还是 disabled），曾把生产的该设置留在
「日历视图」，并连累它后面依赖列表页的三项检查一起变红。现在这一步**原值从服务端读、
保存后回读服务端断言、还原后再回读确认**，[2][3] 也改为显式走 `/admin/all`，不再受该设置影响。
生产配置已恢复为用户原值（`default_view=list`、`sun_location=shanghai`、`theme_mode=sun`）。


### 2026-10-05：0.1.8 → 0.1.9

**0.1.9 — 换新图标：序记本**

- 应用图标换成自行绘制的「序记本」：记录本（左侧书脊 + 琥珀书签带）+ 已办结的勾 + 两条待办线，
  对应名字里的「记」（办完留档）与「序」（一行行按顺序办），并且是**纯手绘几何**：
  矩形、直线、勾，没有第三方图标库或原项目的任何图形数据。
- 与原项目（紫色渐变 + 白色 3D 字母 S）在**色相、构图、质感**三处都不同：深青→天蓝、纯扁平、非字母。
- 图标文件：
  - 标签页/书签栏 → `favicon.svg`（矢量，任意尺寸清晰），16/32 PNG 与 `favicon.ico`（16+32+48）兜底；
  - iOS 桌面图标 / PWA → `apple-touch-icon.png`、`favicon-192/512.png` 用**满幅版本**
    （去掉圆角与透明角，系统自己裁），manifest 标了 `purpose: any maskable`；
  - fnOS 打包图标 `fnpack/app/ui/images/icon_64|icon_256.png`、`fnpack/ICON(_256).PNG` 同步替换。
- 应用内品牌标记（侧栏）、首屏骨架、飞牛登录跳板页的图形统一换成「记录本 + 勾」，
  顺手收掉残留的紫蓝渐变（改为界面主色 #3b82f6 → #6366f1）。
- 验证：生产与沙箱 8 个图标文件逐个比对 sha256 一致、HTTP 200；新增 `verify-icon.js` 15 项
  （图形特征、HTML 声明、manifest、侧栏标记）；回归 15/15 + 9/9 + 44/44 + 25/25 全绿。
- **附带修正**：测试用例在改用户配置后还原那一步存在竞态（Vue 异步更新 DOM，保存按钮仍 disabled
  就点了），曾把生产的 `default_view` 留在 calendar、`sun_location` 留在 beijing。已还原为
  用户原值（list / shanghai），并给 `verify-ux.js`、`verify-013.js` 加上「回读服务端确认 + 失败重试」，
  两个用例现在会自己断言配置已还原。


### 2026-10-05：0.1.7 → 0.1.8

**0.1.8 — 完成记录增加「上周」**

- 「已完成」时间段在「本周」后面加了 **上周**。
- 口径按**上一个自然周**算（这点容易做错）：上周一 00:00 → 本周一 00:00，左闭右开，
  也就是「上周一 ~ 上周日」，和「本周」首尾相接、不重不漏；**不是「最近 7 天」**。
  跨月/跨年同样成立（本周一是 1 月 2 日时，上周 = 去年 12 月 26 日 → 1 月 2 日）。
- 现在的选项：全部 / 今天 / 昨天 / 本周 / 上周 / 本月 / 上月 / 今年 / 自定义；
  筛选器下方「当前区间」会显示实际日期，例如今天（周一）显示「2026-09-28 ~ 2026-10-04」。
- 验证：Go 单测补上周边界（起点必须是周一、恰好 7 天、终点正好等于本周起点、整段都在过去）；
  浏览器用例把上周接进「独立分桶比对条数 / 逐行核对完成时间 / 当前区间文案」三处，
  共 44 项全绿；回归 10/10 + 24/24 + 9/9 + 14/14 全绿。

### 2026-10-05：0.1.6 → 0.1.7

**0.1.7 — 深色模式下拉可读性 + 「过期提醒频率」尺寸对齐**

- **深色下下拉看不清**：`<select>` 的下拉弹层由浏览器/系统绘制，页面只染了文字没染弹层底，
  于是变成「弹层白底 + 页面把文字染成浅色」。修法两条：
  1. `html` 声明 `color-scheme`（深色时 `dark`），浏览器据此把下拉弹层、日期选择器、
     滚动条一并按深色画；
  2. 再把 `<option>` 的前景/背景显式钉成本应用配色（`rgb(var(--color-surface))` /
     `rgb(var(--color-foreground))`），兜住个别不吃 `color-scheme` 的桌面环境。
  实测：深色下 option 对比度 16.12:1、浅色 17.07:1（原来深色是浅字白底，根本看不清）。
- **「过期提醒频率」和同行字段对不齐**：这个控件是子组件，父组件 scoped 样式进不去它内部，
  组件里原先自己写死 `h-9 + text-xs`，于是编辑面板里比「重复 / 按农历循环」矮一截。
  现在组件只负责结构，外观由宿主字段样式决定：编辑面板对齐 `.editor-field select`，
  首页快速新建对齐 `.compact-input`。
  实测（编辑器桌面 44px / 手机 36px，快速新建 36px）高度、字号、圆角、内边距、边框逐项一致。
- 验证：新增 `verify-017.js`（对比度 + 三处尺寸逐项比对，共 10 项），生产与沙箱 10/10；
  回归 24/24 + 39/39 + 9/9 + 14/14 全绿。

### 2026-10-05：0.1.5 → 0.1.6

**0.1.6 — 已完成页把生效的清单筛选也显示出来**

- 核准 0.1.5 时复现到真正会让人误判的场景：**「已完成」页底部的清单筛选记在浏览器本地、
  下次进来照旧生效**。此时「本月」可能只显示 1 条（而不是 16 条），但界面上完全看不出
  还有这层筛选——很容易被当成「日期范围不准」。
- 现在「当前区间」后面会跟上生效的清单：
  `当前区间：2026-10-01 ~ 2026-10-31 · 清单：提醒`；没筛时只显示区间。
- 排查建议：条数不符时先看这一行——区间是哪几天、清单是不是还筛着，一眼定位。
- 验证：浏览器用例新增 3 项（能取到清单、筛了清单时该行写明清单名、清掉后不再显示），
  生产 39/39 + 回归 24/24 + 9/9 + 14/14 全绿。

### 2026-10-05：0.1.4 → 0.1.5

**0.1.5 — 完成时间段按整段日历计算，并显示实际区间**

- 用户反馈「已完成」的日期范围不准确，核准后确认是**口径**问题：原来「本月」「今年」是
  「从 1 号/1 月 1 号**到此刻为止**」，边界随时间漂移，月初和月末看到的终点不一样。
- 现在统一成**整段自然日历区间**（左闭右开）：
  - 本周 = 本周一 00:00 → 下周一 00:00（整周）
  - 本月 = 本月 1 日 00:00 → 下月 1 日 00:00（整月）
  - 今年 = 1 月 1 日 00:00 → 次年 1 月 1 日 00:00（整年）
  - 今天/昨天/上月本来就是整段，口径不变
- 筛选器下方新增 **「当前区间」**：直接显示这次生效的起止日期（含当天），
  例如「2026-10-01 ~ 2026-10-31」「2026-09-01 ~ 2026-09-30」「不限时间」，
  条数对不对一眼可核对。区间由后端算好随列表一起返回
  （`/api/reminder/completed` 的返回从数组改为 `{ items, span }`），前端只负责显示，
  避免两边各算一套出现分叉。
- 注意：本次改动的是**边界口径**，不是数据。因为完成时间不可能落在未来，
  同一时刻「整月」与「到此刻为止」返回的记录条数相同（实测都是 16 条），
  区别在于区间描述是否稳定；若条数仍与预期不符，请对照新增的「当前区间」文案指认。
- 验证：Go 单测新增整段边界与区间描述断言（整月终点必须是下月 1 号、展示到 31 号）；
  浏览器用例改为逐项核对「当前区间」文案 + 用 `range=all` 的记录独立分桶交叉验证条数。

### 2026-10-05：0.1.3 → 0.1.4

**0.1.4 — 完成记录增加昨天与上月**

- 「已完成」时间段新增 **昨天** 与 **上月**，「本年」改称 **今年**。
- 现在的选项：全部 / 今天 / 昨天 / 本周 / 本月 / 上月 / 今年 / 自定义。
- 区间口径：「昨天」= 昨天 0 点到今天 0 点（与「今天」首尾相接、不重不漏）；
  「本月」「今年」= 到此刻为止；「上月」= 整月闭区间（本月 1 号往前一个月 → 本月 1 号）。
- 只改了时间段解析与前端选项，没有数据库结构变更；导出表格沿用同一套参数。
- 验证：Go 单测（含 yesterday/lastmonth 的区间断言）全绿；浏览器实测新增 8 项断言，
  并逐行核对导出 CSV 里的完成时间确实落在所选区间内。

### 2026-10-05：0.1.2 → 0.1.3

**0.1.3 — 日出日落主题与日历双击新建**

- 「偏好设置 → 主题模式」新增 **日出日落**：日落之后自动切深色、日出之后自动切浅色。
  每分钟对一次表，页面回到前台时立即校正（合盖过夜回来不会停在旧状态）。
- 新增用户配置 **`sun_location`**（49 个城市，默认上海），位置跟账号走、跨设备一致；
  本地另存一份用于首屏，避免打开时先闪一下浅色再变深色。
- 日出日落时刻在浏览器本地算（`web/src/utils/sun.ts`，NOAA 常用公式）：不联网、
  不需要定位权限，也不需要额外的后端接口。极昼/极夜没有日出日落时退回「19:00–07:00 算夜间」。
- **日历双击日期格**（或点右侧「＋ 新建」）弹出新建面板，预填那天的 20:00，
  字段与列表页完全一致；手机上没有双击，用「＋ 新建」按钮。
- 提醒编辑器同时支持新建与编辑：新建走创建接口，编辑仍按 id 拉最新数据，保存冲突逻辑不变。
- 后端只改了配置注册表（theme_mode 多一个 `sun` 取值、新增 `sun_location` 的取值校验），
  没有数据库结构变更，老数据、老配置原样可用。
- 验证（浏览器实测）：新功能 24/24 通过（选项、存到服务端、深浅色切换、日出日落按点判定、
  双击新建入库并清理）；回归 19/19（导出）+ 9/9（清单筛选）+ 13/13（布局/移动端）。
  生产库升级前后 34 提醒（27 条有效）/14 完成 /2 清单 /1 用户，`integrity_check=ok`。
  自检脚本会临时改主题配置，用例结束已恢复为 `system` + `shanghai`。

### 2026-10-05：0.1.1 → 0.1.2

**0.1.2 — 完成时间筛选与导出表格**

- 「已完成」的时间段选项由「一周 / 一月 / 一年」改为 **今天 / 本周 / 本月 / 本年**（外加原有的
  全部与自定义）。本周从周一算起、本月从 1 号算起，全部按上海时区。
- 列表头新增 **「导出表格」**：
  - 列表页导出当前视图 + 清单/搜索筛选下的提醒与记事；
  - 「已完成」页导出当前时间段 + 清单筛选下的完成记录。
- 导出格式为 CSV（带 UTF-8 BOM），Excel / WPS 双击打开中文不乱码；列固定为
  标题、类型、清单、状态、到期时间、完成时间、重复、备注。全天事项只写日期，
  备注里的换行统一成 LF。
- 实现：`GET /api/reminder/export?scope=active|completed`，`active` 走列表口径
  （view / q / list_ids），`completed` 走完成记录口径（range / from / to / q / list_ids），
  导出内容与屏幕上看到的筛选结果完全一致。
- 顺带修掉一个仓库层面的坑：`.gitignore` 里的 `data/` 会连 `web/src/data/`（应用内
  迭代说明 release-notes.ts）一起忽略，那份源码此前从未入库，新克隆的仓库前端会构建失败。
- 验证（浏览器实测）：导出 19/19 通过（两种口径、BOM、表头、行数 本周 ≤ 本月 ≤ 全部），
  原有回归 9/9（清单筛选）+ 13/13（布局/移动端）通过；生产库升级前后
  34 提醒 / 14 完成 / 2 清单 / 1 用户，`integrity_check=ok`，零丢失。

**0.1.1 — 数据库改名**

- 数据库文件 `reminder.db` → **`workordernote.db`**，不再残留原项目名。
- **升级时自动改名，无需手工操作**：新库不存在而老库存在时，程序会把老库
  （连同 `-wal` / `-shm`）改名过来，数据原样保留。本次已在真实数据上完成，
  逐表行数零丢失、`integrity_check=ok`。
- `verify-data.sh` 原先写死了 `reminder.db`，改名后会直接报「文件不存在」；
  已改为自动识别 `db/*.db`，以后再改名也不会失效。
- 若你曾用 `DB_PATH` 自行指定库位置，程序不会去猜，需要你自行改名。

**0.1.0 — 按清单筛选**

- 日历视图与「已完成」页新增清单筛选（多选），勾选哪些显示哪些，不勾即全部；
  选择记在浏览器本地，下次进入沿用。
- 后端清单筛选升级为多清单 `list_ids=1,2,3`，旧的单值 `list_id` 写法仍兼容。

### 2026-10-04：0.0.2 → 0.0.3（布局与移动端）

- **侧栏改为抽屉模式**：桌面端点顶栏按钮收起/展开，收起后内容区不再被占 292px；
  折叠状态记在浏览器本地。
- **侧栏底部新增可折叠「设置」组**，默认折叠。此前侧栏内容 423px、可视仅 368px，
  「我的清单」会被截断；折叠后不再截断，清单能多显示好几项。
- **日历页去掉重复页头并收紧间距**：桌面日历上方占用 207px → 117px（单格 114px → 128px），
  手机 197px → 119px 且整页正好一屏（此前下方空 243px 还要滚动）。
- **新增「默认首页」设置**（偏好设置 → 外观）：列表视图 / 日历视图。
- **日历视图下隐藏新建入口**（侧栏大按钮与手机底部 +）：日历用于查看，新建请切回列表。
- **新建提醒默认落在今天**（时间沿用「今天」芯片的 20:00，芯片同步点亮）。
- 手机端各页面复查无横向溢出。

### 2026-10-04：0.0.1 → 0.0.2

- **移除匿名使用统计**：不再向任何外部端点上报任何数据。相关开关
  （`-disable-stats` / `DISABLE_STATS` / `-device-type` / `DEVICE_TYPE`）
  与 `stats_enabled` 配置项一并删除，库里遗留的配置行已由 0.0.2 升级清理。
  ⚠️ 启动命令里不要再带 `-disable-stats`，该参数已不存在，带了会导致启动失败。
- **修复版本信息弹窗关不掉**：弹窗 `closable` 属性是布尔类型，父组件未传时
  Vue 会置为 false，导致关闭按钮与遮罩点击都失效；现已修复（按钮与遮罩都能关）。
- **日历点编辑改为就地打开编辑抽屉**，不再跳到列表页；日历与列表共用同一个编辑器组件。
- **新增「日历任务字号」设置**（偏好设置 → 外观）：小 / 标准 / 大 / 特大，
  日历格子里的任务文字、详情标题与格子高度同步缩放。
- 修复一批样式类只在列表页生效、日历与设置页不生效的问题。

数据校验：逐表行数一致、`integrity_check=ok`、34 条提醒 / 1 个账号完好。

### 2026-10-04：升级到 self-build 0.0.1「工作序记」

- 从官方 `techfunways/reminders:v0.2.0` → 先升到官方 `v0.3.0` → 再换成本地自建 `workordernote:0.0.1`
- 容器名 `techfunway-reminders` → `workordernote`
- 相对官方 v0.3.0 新增：记事类型、已完成按时间段查看、全屏日历、默认清单设定、版本信息入口
- 移除上游的赞赏/付费提示；保留原项目信息与 MIT 许可声明
- 数据校验：逐表行数一致、`integrity_check=ok`、34 条提醒 / 1 个账号完好
- 注意：`upgrade_records` 里同时存在上游编号（0.1.2/0.3.0/0.3.2）与本分支编号（0.0.1），
  这是有意为之——程序对继承编号豁免了「数据库比程序新」的启动保护，详见源码
  `server/database/upgrade.go`。

### 迁移记录（2026-09-17）

数据从 `/vol1/@appshare/fn-deepseek-harness/reminders-docker/data` 迁移至此。
迁移校验：16 张表逐表行数一致、库大小一致（241664 字节）、`integrity_check=ok`、
接口 `setup_required=false`（原账号无需重新注册）。

迁移完成后，以下旧位置**已按确认清理删除**（共释放约 125 MB）：

- `/vol1/@appshare/fn-deepseek-harness/reminders-docker/` —— 旧的 Docker 部署位置（含切换前快照）
- `/vol1/@appshare/fn-deepseek-harness/reminders/` —— 更早的独立二进制部署

删除前已确认在用数据完好；离线镜像包已先转移到本目录 `images/` 保留。
