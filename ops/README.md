# ops —— 部署与运维（工作序记 / WorkOrderNote）

这个目录放的是**部署、发版、验收**相关的东西；应用本身的代码在仓库根目录
（`server/`、`web/`、`Dockerfile*`）。回归测试套件在 `../browser-harness/`。

## 目录内容

| 文件 | 说明 |
| --- | --- |
| `deployment-README.md` | **201（本机生产）** 的部署记录：目录结构、compose、备份/升级步骤、**逐版本变更记录**（每版做了什么、怎么验证的、指纹与构件 md5）。这份文件就是 201 上 `/vol1/1000/Docker/reminders/README.md` 的源文件。 |
| `200-新NAS部署说明.md` | **200（第二台飞牛，远端生产）** 的部署记录与升级历史；对应 200 上的 `部署说明.md`。 |
| `待发布改动.md` | **发版节奏台账**：日常改动先攒在这里（只改代码、用临时容器自检），用户说「发版」时合成一版走完整流程；每次发版的记录也留在里面。 |
| `功能实施说明.md` | 功能清单与实现口径（做什么、口径怎么定、对应哪些用例）。 |
| `build-offline-package.sh` | 打 **Docker 离线一键安装包**（`install.sh` + `docker save` 的镜像 + `SHA256SUMS`），模板在 `offline/`。 |
| `offline/` | 离线安装包模板：`install.sh` / `uninstall.sh` / `docker-compose.yml` / `README.md`。 |
| `verify-data.sh` | 数据体检脚本（条数、时间口径、同步 UID 是否缺失等）。 |

## 两种目录布局都能用

脚本原先假设的是**工作区并排**布局：

```
工作区/
├── reminders-upstream/     ← 本仓库
├── browser-harness/        ← 回归套件
└── reminders-deploy/       ← 部署脚本与产物（本目录的来源）
```

本仓库里它们分别位于 `browser-harness/` 与 `ops/`。`build-offline-package.sh`、
`../browser-harness/verify-offline-package.sh`、`../browser-harness/verify-sync-e2e.sh`
都已经做了兼容：**在仓库里直接跑也能找到源码与产物目录**（仓库内为 `<仓库>/pkg`）。

## 常用命令

```bash
# 打离线包（默认读仓库 VERSION、用本机 workordernote:<版本> 镜像）
bash ops/build-offline-package.sh

# 验收离线包：解压 → 校验和 → 安装 → 建账号写数据 → 重装（数据不丢）→ 卸载
bash browser-harness/verify-offline-package.sh

# 全量回归（默认打沙箱 8908）
APP_URL=http://127.0.0.1:8908 bash browser-harness/run-all.sh

# 数据体检（把数据目录挂进容器跑，NAS 上 data 属主是 1000:1001）
docker run --rm -v /vol1/1000/Docker/reminders/data:/data alpine:latest sh /dev/stdin < ops/verify-data.sh
```

## 注意

- **`browser-harness/` 的脚本里有测试账号的默认口令**（`APP_PASS` 的默认值，方便无人值守跑套件）。
  仓库是私有的；要改成从环境变量读，把默认值去掉即可。
- 部署文档里出现的地址、目录、备份名都是**这两台 NAS 的真实值**，换环境要改。
- `browser-harness/node_modules/` 与 `browser-harness/shots/` 不入库（见 `.gitignore`）；
  首次跑套件先 `cd browser-harness && npm install`。
