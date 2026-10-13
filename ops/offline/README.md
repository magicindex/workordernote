# 工作序记（WorkOrderNote）离线安装包

任务、记事与日历一体的提醒应用。本包**完全离线**：镜像、安装脚本、说明都在里面，
目标机器不需要能上外网。

## 包里有什么

| 路径 | 说明 |
| --- | --- |
| `install.sh` | 一键安装 / 升级（加载镜像 → 建数据目录 → 启动 → 等就绪 → 打印访问地址） |
| `uninstall.sh` | 停止并移除容器；`--purge` 才删数据目录 |
| `docker-compose.yml` | 部署定义（`pull_policy: never`，离线安全） |
| `package.env` | 包信息：镜像标签、镜像 ID、版本、构建提交与时间 |
| `image/*.tar.gz` | 镜像包（`docker save` 后 gzip） |
| `manifest.json` | 版本、镜像摘要、文件清单（含 SHA256），供核对 |
| `SHA256SUMS` | 校验和，安装前可核对包是否完整 |
| `.env.example` | 端口 / 数据目录 / 容器名的示例（`install.sh` 会自动生成 `.env`） |

## 环境要求

- 飞牛 fnOS（或任意 Linux）上已安装 Docker；
- Docker Compose v2（`docker compose`）或独立的 `docker-compose`；
- 架构 x86_64（amd64）。ARM 机器请另行构建镜像；
- 安装需要 root（或已加入 docker 组的用户）。

## 三步安装

```bash
tar -xzf WorkOrderNote-<版本>-offline-amd64.tar.gz
cd WorkOrderNote-<版本>-offline
sudo bash install.sh
```

默认：端口 **8906**，数据目录 `./data`（即安装包目录下的 `data/`）。
结束后终端会打印访问地址与「两台飞牛互相同步」的配置步骤。

### 自定义端口与数据目录

```bash
sudo bash install.sh --port 8907 --data-dir /vol1/1000/Docker/workordernote
```

配置会写进同目录的 `.env`；**再次执行 `install.sh` 会沿用上次的端口与目录**（数据不会丢）。

常用参数：`--port`、`--data-dir`、`--name`、`--no-start`（只加载镜像不启动）、
`--force-load`（强制用包内镜像覆盖本机同名镜像，用于核对镜像 ID）。

### 首次使用

打开 `http://<机器IP>:<端口>/`，按提示创建管理员账号（用户名 + 密码）。没有默认账号。

## 两台飞牛之间同步（0.3.0 起）

1. 两台机器都装好本包（同一版本或兼容版本），并用**同一个用户名**创建账号；
2. 各自进入「系统管理 → 系统配置 → 双机同步」；
3. 在 A 上点「复制」拿到令牌，粘到 B，使**两端令牌一致**；填对方的访问地址（如 `http://192.168.3.200:8906`）；
4. 方向建议两端都选「双向同步」（也可以一端「本机→对端」+ 另一端「对端→本机」）；
5. 先「测试连接」（会报对端版本、账号匹配与两端时钟差），再「立即同步」。

同步内容：清单、任务、记事、完成记录、提醒选用的渠道名。
不同步：账号密码、通知渠道凭据、管理员密钥、投递记录、系统配置。
详见应用内「版本信息 → 迭代说明」与 `deployment-README.md`。

## 升级

拿到新版本安装包后，解压并**在同一目录再跑一次** `install.sh`：

```bash
sudo bash install.sh
```

数据目录不变；建议先备份数据目录（`cp -a data data.bak-$(date +%Y%m%d-%H%M%S)`）。

## 卸载

```bash
bash uninstall.sh           # 停容器、留数据
bash uninstall.sh --purge   # 连数据一起删（需二次确认）
```

## 校验安装包

```bash
sha256sum -c SHA256SUMS
```

`manifest.json` 里的 `image.id` 应与 `docker image inspect workordernote:<版本> --format '{{.Id}}'` 一致。

## 关于镜像名

Docker 的镜像仓库名**只允许小写**，所以镜像标签是 `workordernote:<版本>`；
给人看的显示名 **WorkOrderNote** 写在镜像的 OCI 标签里
（`docker image inspect workordernote:<版本> --format '{{index .Config.Labels "org.opencontainers.image.title"}}'`），
容器上也有同名标签。这是 Docker 规范限制，不是命名错误。

## 来源与许可

本应用是开源项目 **TechFunWay/reminders** 的衍生作品，遵循 MIT 许可，
原项目的著作权与出处均予保留：<https://github.com/TechFunWay/reminders>
