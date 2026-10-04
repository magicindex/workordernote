# 工作序记 · WorkOrderNote

任务、记事与日历一体的提醒应用。清单管理、定时提醒、记事归档、月历总览，
支持站内消息、电子邮件、短信、飞书机器人和 QQ 机器人通知。

> **本项目是衍生作品。** 基于开源项目
> [TechFunWay/reminders](https://github.com/TechFunWay/reminders)（MIT 许可）衍生开发，
> 原项目的著作权与出处均予保留。详见文末「原项目信息」。
>
> 版本：`0.0.1`（版本号规则：主版本号.小版本号.修正号，本分支从 0.0.1 起）

---

## 与上游的差异

本分支在上游 `v0.3.0` 的基础上做以下改造：

| 功能 | 说明 |
| --- | --- |
| **任务 / 记事** | 任务需要确认完成；记事只作记录，保存即归入「已完成」，且不会发出任何通知 |
| **已完成按时间段查看** | 全部 / 今天 / 一周 / 一月 / 一年 / 自定义起止日期；并接入重复提醒的完整完成历史 |
| **全屏日历** | 顶栏主题按钮旁可切换「列表 / 日历」；月历同时显示公历、农历、节气与节日 |
| **默认清单设定** | 「偏好设置」里可指定默认清单，侧栏对应清单带星标 |
| **版本信息入口** | 侧栏「系统管理」下方，点开是迭代说明与原项目信息 |
| **移除赞赏/付费提示** | 上游的赞赏弹窗、顶部横幅与设置页入口全部移除，保留原项目信息与 MIT 许可声明 |

上游自带的能力（跨设备自动同步、到点催办、农历重复、多邮箱通知、飞牛一键登录等）全部保留。

---

## 技术栈

- 后端：Go 1.26 + Gin + GORM + SQLite（CGO）
- 前端：Vue 3 + TypeScript + Vite + Tailwind CSS
- 部署：单二进制或 Docker；数据全部落在本地数据目录

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
  -t workordernote:$(cat VERSION) .
```

> tzdata 不是可选项：服务端多处调用 `time.LoadLocation("Asia/Shanghai")`，
> 缺失时返回 `nil`，紧接着的 `now.In(loc)` 会 panic。

## docker compose 部署

```yaml
services:
  workordernote:
    image: workordernote:0.0.1
    container_name: workordernote
    # 数据目录属主是 1000:1001 时必须对齐，否则容器写不进 SQLite 且不报错
    user: "1000:1001"
    ports:
      - "8906:8906"
    volumes:
      - ./data:/app/data
      # 镜像内时区数据齐全，但挂上本机 localtime 更稳妥
      - /etc/localtime:/etc/localtime:ro
    environment:
      - ENV=release
      - DATA_DIR=/app/data
      - TZ=Asia/Shanghai
    command: ["-data-dir", "/app/data", "-web-dir", "./static/dist", "-log-console"]
    restart: unless-stopped
    # 若本机跑着 watchtower，建议加这一条，避免自建镜像被上游原版覆盖
    labels:
      com.centurylinklabs.watchtower.enable: "false"
```

## 版本号规则

- **软件版本**：根目录 `VERSION` 文件，格式 `主版本号.小版本号.修正号`，本分支从 `0.0.1` 起。
  对外展示与 `web/src/data/release-notes.ts` 里的迭代说明保持同步。
- **数据库结构版本**：`server/database/Upgrades` 与 `server/reminder/register.go` 里注册的升级条目，
  同样从 `0.0.1` 起递增，**只增不改**。继承自上游的 `0.1.2 / 0.3.0 / 0.3.2` 三条保留原编号，
  由 `database.inheritedUpstreamUpgrades` 豁免版本比较——否则切换到本分支后，
  启动时会因「数据库 schema 比程序新」而拒绝服务。

发新版时：改 `VERSION` → 在 `release-notes.ts` 最前面加一条迭代说明 → 如有表结构变更，
在 `register.go` 追加一条 `database.Upgrade`。

## 运行日志

```bash
docker compose logs -f          # 需要 -log-console（compose 示例里已带）
./verify-data.sh                # 数据体检：表数量、行数、integrity_check
```

## 在线统计

应用内置匿名使用统计上报（仅设备级哈希标识/系统/架构/版本，不含任何用户数据）。
本分支已移除上游的赞赏计数，只保留心跳。

关闭方式（任选其一）：

- 启动参数 `-disable-stats`
- 环境变量 `DISABLE_STATS=1`
- 系统配置里的 `stats_enabled` 运行时开关

上报地址可用环境变量 `STATS_ENDPOINT` 覆盖。

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
