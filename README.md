# 工作序记 · WorkOrderNote

任务、记事与日历一体的提醒应用。清单管理、定时提醒、记事归档、月历总览，
支持站内消息、电子邮件、短信、飞书机器人和 QQ 机器人通知。

- 仓库：<https://gitea.topzero.cn:10241/cyberzero/WorkOrderNote>
- 发布与安装包：<https://gitea.topzero.cn:10241/cyberzero/WorkOrderNote/releases>
- GitHub 镜像：<https://github.com/magicindex/workordernote>
- 当前版本：`0.43.6`

> **本项目是衍生作品。** 基于开源项目
> [TechFunWay/reminders](https://github.com/TechFunWay/reminders)（MIT 许可）衍生开发，
> 原项目的著作权与出处均予保留。详见文末「原项目信息」。

---

## 功能

| 模块 | 说明 |
| --- | --- |
| **任务 / 记事** | 任务需确认完成；记事只作记录，保存即归档、不发送通知 |
| **清单与提醒** | 多清单、优先级、重复提醒（含农历）、逾期提醒、提醒@他 |
| **视图** | 列表、全屏日历（公历/农历/节气/节日）、首页看板、倒计时卡片 |
| **课程表** | 按周排课、每周独立留档，可切上周/下周查看历史（历史只读）；课程与课外活动分色，支持打印；手机默认只看今天，可点日期切换；可按账号批量共享多张表（只读 / 读写）；课程备注自动收进随手记事本，可按「课程备注」筛选 |
| **随手记事本** | 随手记录，按时间倒序归档，可搜索 |
| **人生要有仪式感** | 生日、纪念日、节日、考试倒计时卡片，公历与农历双行显示（干支年份、彩色日期胶囊，「每年」跟随创建历法） |
| **信用卡账单** | 多卡管理，账单日/还款日/额度/本期金额，临近还款日变色提醒；更多菜单点按展开 |
| **通知渠道** | 站内消息、电子邮件、短信、飞书机器人、QQ 机器人；支持免打扰 |
| **AI 小秘** | 接入多家模型服务商，可选模型；基于工作数据回答问题，支持改名 |
| **数据与同步** | 本机/WebDAV 每日自动备份（自签名证书可跳过校验）、整库与上传文件恢复、导入导出、双机同步（除密码外全部） |
| **打印** | 日历整月打印，或切换列表按行打印；可调方向、字号、标题与打印列 |
| **多端** | 桌面与手机自适应，支持 PWA 安装；手机底部「提醒」直达提醒@他，悬浮新建按当前频道分流 |

上游自带的能力（到点催办、重复提醒、多邮箱通知、飞牛一键登录等）全部保留。

---

## 技术栈

- 后端：Go 1.26 + Gin + GORM + SQLite（CGO）
- 前端：Vue 3 + TypeScript + Vite + Tailwind CSS
- 部署：单二进制或 Docker；数据全部落在本地数据目录

## 快速开始（Docker Compose）

镜像发布在仓库自带的容器仓库，可直接拉取：

```bash
docker pull gitea.topzero.cn:10241/cyberzero/workordernote:0.43.6
```

同一版本也发布在 GHCR：`ghcr.io/magicindex/workordernote:0.43.6`；Gitea 容器仓库不可用时可直接改用。

### 用仓库里的 compose 文件安装

```bash
mkdir -p ~/workordernote && cd ~/workordernote
curl -fsSLO https://gitea.topzero.cn:10241/cyberzero/WorkOrderNote/raw/branch/main/docker-compose.yml
docker compose up -d
```

从 GitHub 镜像下载同款文件：

```bash
curl -fsSLO https://raw.githubusercontent.com/magicindex/workordernote/main/docker-compose.yml
```

启动后访问 `http://<主机>:8906`，首次打开按页面提示注册管理员账号。

### compose 内容

仓库根目录的 `docker-compose.yml` 已指向当前版本镜像：

```yaml
services:
  workordernote:
    image: gitea.topzero.cn:10241/cyberzero/workordernote:0.43.6
    container_name: workordernote
    # 数据目录属主是 1000:1001 时必须对齐，否则容器写不进 SQLite 且不报错
    user: "1000:1001"
    ports:
      - "8906:8906"
    volumes:
      - workordernote-data:/app/data
      - /etc/localtime:/etc/localtime:ro
    environment:
      - ENV=release
      - DATA_DIR=/app/data
      - TZ=Asia/Shanghai
    command: ["-data-dir", "/app/data", "-web-dir", "./static/dist", "-log-console"]
    restart: unless-stopped
    labels:
      com.centurylinklabs.watchtower.enable: "false"

volumes:
  workordernote-data:
```

- **数据**：默认存命名卷 `workordernote-data`；想改用本机目录，把 `workordernote-data:/app/data` 换成 `./data:/app/data`，并确保 `user` 与目录属主一致。
- **属主**：`user` 要与数据目录属主一致（常见为 `1000:1001`），否则 SQLite 写入会静默失败。
- **端口**：宿主 8906 被占用时，改 `"8906:8906"` 左侧的端口。
- **watchtower**：若本机运行 watchtower，`watchtower.enable=false` 可避免被上游镜像覆盖。
- **飞牛 NAS**：也可用 Release 里的 `*.fpk` 或离线包安装，无需联网拉镜像。

### 日常操作

```bash
docker compose logs -f        # 查看日志（compose 里已带 -log-console）
docker compose ps             # 查看状态
docker compose down           # 停止并删除容器，数据卷保留
```

升级时，把 compose 里的镜像 tag 改成新版本，再执行：

```bash
docker compose pull && docker compose up -d
```

## 本地开发

```bash
# 构建 Vue 前端、复制到后端静态目录、构建并启动 Go 后端
make dev

# 仅构建
make build

# 跑测试
cd server && go test ./...
```

## 构建 Docker 镜像

上游的 `Dockerfile` 在部分内网环境拉不到 `alpine:3.20`、`npm`/`go` 官方源也不通，
因此本仓库提供了 `Dockerfile.custom`：改用本地可用的 `alpine:latest`（与
`golang:1.26-alpine` 同为 3.24.x，musl ABI 匹配），并把包源换成国内镜像
（apk → mirrors.aliyun.com，npm → registry.npmmirror.com，go → goproxy.cn），
运行阶段的 ca-certificates 与 tzdata 从已有镜像 COPY。

```bash
docker build -f Dockerfile.custom \
  --build-arg VERSION=$(cat VERSION) \
  --build-arg BUILD_TIME=$(date +%Y-%m-%dT%H:%M:%S) \
  --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) \
  -t gitea.topzero.cn:10241/cyberzero/workordernote:$(cat VERSION) .
```

> tzdata 不是可选项：服务端多处调用 `time.LoadLocation("Asia/Shanghai")`，
> 缺失时返回 `nil`，紧接着的 `now.In(loc)` 会 panic。

## 版本号规则

- **软件版本**：根目录 `VERSION` 文件，格式 `主版本号.小版本号.修正号`。
  对外展示与 `web/src/data/release-notes.ts` 里的迭代说明保持同步。
- **数据库结构版本**：`server/database/Upgrades` 与 `server/reminder/register.go` 里注册的升级条目，
  **只增不改**。继承自上游的 `0.1.2 / 0.3.0 / 0.3.2` 三条保留原编号，
  由 `database.inheritedUpstreamUpgrades` 豁免版本比较——否则切换到本分支后，
  启动时会因「数据库 schema 比程序新」而拒绝服务。

发新版时：改 `VERSION` → 在 `release-notes.ts` 最前面加一条迭代说明 → 如有表结构变更，
在 `register.go` 追加一条 `database.Upgrade`。

## 运行日志

```bash
docker compose logs -f          # 需要 -log-console（compose 示例里已带）
./verify-data.sh                # 数据体检：表数量、行数、integrity_check
```

---

## 回归测试与部署运维

| 目录 | 说明 |
| --- | --- |
| `browser-harness/` | **浏览器回归套件**（39 个套件 / 1000+ 项断言）：登录、列表与日历、信用卡账单、记事本、仪式感卡片、通知弹窗、清单排序、免打扰与逾期提醒、卡片背景图、双机同步、离线包安装……跑之前先 `cd browser-harness && npm install`，用法见该目录的 `README.md` 与 `run-all.sh`。 |
| `ops/` | **部署与发版**：部署记录与逐版本变更、发版台账（`待发布改动.md`）、离线包打包脚本与模板、数据体检脚本。入口见 `ops/README.md`。 |

常用的两条：

```bash
# 全量回归（默认打沙箱 8908；也可指向刚起好的临时容器）
APP_URL=http://127.0.0.1:8908 bash browser-harness/run-all.sh

# 打 Docker 离线一键安装包（默认读仓库 VERSION）
bash ops/build-offline-package.sh
```

---

## 原项目信息

| 项目 | 内容 |
| --- | --- |
| 上游项目 | [TechFunWay/reminders](https://github.com/TechFunWay/reminders) |
| 上游作者 | 科技智趣坊（TechFunWay） |
| 许可 | MIT License，见 [LICENSE](LICENSE) |
| 本项目 | WorkOrderNote（工作序记），基于上游衍生开发 |

本衍生作品遵循上游的 MIT 许可，保留原始版权声明；上游项目名称、作者与链接
均如实标注，未作删改。上游的能力与设计成果归原作者所有。
