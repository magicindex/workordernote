# ops —— 部署与运维（工作序记 / WorkOrderNote）

这个目录放的是**部署、发版、验收**相关的东西；应用本身的代码在仓库根目录
（`server/`、`web/`、`Dockerfile*`）。回归测试套件在 `../browser-harness/`。

## 目录内容

| 文件 | 说明 |
| --- | --- |
| `deployment-README.md` | **201（本机生产）** 的部署记录：目录结构、compose、备份/升级步骤、**逐版本变更记录**（每版做了什么、怎么验证的、指纹与构件 md5）。这份文件就是 201 上 `/vol1/1000/Docker/workordernote/README.md` 的源文件。 |
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
└── workordernote-deploy/       ← 部署脚本与产物（本目录的来源）
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
docker run --rm -v /vol1/1000/Docker/workordernote/data:/data alpine:latest sh /dev/stdin < ops/verify-data.sh
```

## 临时迭代容器（跑回归用）

回归要一个能随便毁数据的实例，做法是拷一份生产库、起一个独立容器。**关键：拷过来的库带着生产的同步配置，
必须清掉** —— 否则临时实例会顶着生产账号把「自检…」数据同步进 201/200（2026-10-15 真踩到过：回归跑到一半，
生产的清单/提醒里被同步进自检条目，删掉之后还会留下成片墓碑；临时实例和沙箱 8908 拷贝自同一份数据时，
连 `sync_instance_id` 都一样，等于两个实例抢一个身份）。

```bash
# ① 用 sqlite backup API 做一致性拷贝（正在写的库不要直接 cp），并删掉同步配置
docker run --rm -v "$PWD/tmp:/t" -v /vol1/1000/Docker/workordernote/data:/src:ro python:3.12-alpine python -c "
import sqlite3, glob, os, shutil
src = glob.glob('/src/db/*.db')[0]
os.makedirs('/t/feature-data/db', exist_ok=True)
for sub in ('logs','uploads'):
    if os.path.isdir('/src/'+sub): shutil.copytree('/src/'+sub, '/t/feature-data/'+sub, dirs_exist_ok=True)
dst = '/t/feature-data/db/'+os.path.basename(src)
c = sqlite3.connect('file:%s?mode=ro' % src, uri=True); d = sqlite3.connect(dst)
c.backup(d)
d.execute(\"delete from system_configs where key like 'sync_%'\"); d.commit()
c.close(); d.close()"
docker run --rm -v "$PWD/tmp:/t" alpine sh -c 'chown -R 1000:1000 /t/feature-data'

# ② 起容器（--user 1000:1000；只测前端改动时把宿主 web/dist 挂进去就不用重建镜像）
docker run -d --name wsn-feature -p 8920:8906 --user 1000:1000 \
  -v "$PWD/web/dist:/app/static/dist:ro" -v "$PWD/tmp/feature-data:/app/data" \
  -v /etc/localtime:/etc/localtime:ro -e TZ=Asia/Shanghai -e ENV=release -e DATA_DIR=/app/data \
  workordernote:0.29.0 -data-dir /app/data -web-dir ./static/dist -log-console

# ③ 确认同步是关的：sync_direction 应是 off、sync_peer_url 与 sync_last_at 应为空
docker run --rm --user root -v "$PWD/tmp/feature-data:/d:ro" python:3.12-alpine python -c "
import sqlite3,glob
con=sqlite3.connect('file:%s?mode=ro'%glob.glob('/d/db/*.db')[0],uri=True)
print(list(con.execute(\"select key,value from system_configs where key like 'sync_%'\")))"

# ④ 跑全量回归（默认打 8908，这里显式指定临时实例）
APP_URL=http://127.0.0.1:8920 bash browser-harness/run-all.sh
```

应用启动时会用默认值重建 `sync_*` 键（`sync_direction=off`、peer 为空），所以**只要拷库时清过就不会再连生产**；
如果没清，启动后 `sync_direction` 会是 `both`/`pull`、`sync_peer_url` 指向生产，看到就说明这份数据不能用来跑回归。

## 发版时把构件也放进仓库（Gitea）

代码推到 Gitea（`origin` = <https://gitea.topzero.cn:10241/cyberzero/WorkOrderNote>），构件走**两条路**：

```bash
VERSION=0.23.0

# ① 打标签（Release 的锚点）
git tag -a v$VERSION -m "工作序记 $VERSION" && git push origin v$VERSION

# ② 建 Release 并挂附件（镜像 + 离线包 + 校验和）
curl -u cyberzero:*** -H 'Content-Type: application/json' \
  -d "{\"tag_name\":\"v$VERSION\",\"name\":\"工作序记 $VERSION\"}" \
  https://gitea.topzero.cn:10241/api/v1/repos/cyberzero/WorkOrderNote/releases
curl -u cyberzero:*** -F "attachment=@pkg/WorkOrderNote-$VERSION-offline/image/workordernote-$VERSION-amd64.tar.gz" \
  "https://gitea.topzero.cn:10241/api/v1/repos/cyberzero/WorkOrderNote/releases/<id>/assets?name=workordernote-$VERSION-amd64.tar.gz"

# ③ 镜像推进 Gitea 的容器仓库（用 alpine 里的 skopeo，不依赖本机 docker 的 insecure 配置）
docker run --rm -v "$PWD/pkg/WorkOrderNote-$VERSION-offline/image":/src:ro alpine:latest sh -c "
  sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories; apk add --no-cache skopeo >/dev/null
  gunzip -c /src/workordernote-$VERSION-amd64.tar.gz > /tmp/img.tar
  skopeo copy --dest-tls-verify=false --dest-creds 'cyberzero:***' \
    docker-archive:/tmp/img.tar:workordernote:$VERSION \
    docker://gitea.topzero.cn:10241/cyberzero/workordernote:$VERSION"
```

本仓库的默认远端就是 Gitea（`origin`），上游 GitHub 是 `upstream`；本机已用 Gitea 访问令牌
（`workordernote-push`，只有仓库读写权限）配好免密，`git fetch/push` 不用输密码。
镜像仓库与 Gitea 同址，走 **HTTPS**（`https://gitea.topzero.cn:10241`），证书链完整
（Certum DV `*.topzero.cn`），可以直接
`docker pull gitea.topzero.cn:10241/cyberzero/workordernote:<版本>`。
推送新镜像仍需带 `write:package` 权限的访问令牌。

> **不要直推 CIFS 路径（2026-10-21 修订）**：裸库虽然能从
> `/vol02/1000-0-aea4b1f9/gitea/data/git/repositories/cyberzero/workordernote.git` 直接写，
> 但钩子会在 **201 本机**执行，而本机没有 `/usr/local/bin/gitea`：要么被拒，要么（钩子缺失时）
> 静默写进去。后者会让 Gitea 的 `branch` 表停在旧提交，页面随即报「Git 钩子似乎已损坏」——
> 这不是钩子文件坏了，是 DB 分支指针与裸库 HEAD 不一致。
>
> 仓库地址统一为 HTTPS 端点 `https://gitea.topzero.cn:10241/cyberzero/workordernote.git`
> （本机出网若被 WAF 拦成 403，推送可继续走内网端点）；
> 令牌存在仓库私有的 `.git/gitea-credentials`（0600，只对本仓库生效）：
>
> ```bash
> git config credential.helper "store --file=$PWD/.git/gitea-credentials"
> git push origin main
> ```
>
> 该账号已启用 2FA，密码只能读不能写；写操作必须用「设置 → 应用」里带
> `write:repository` 的令牌。若页面仍提示钩子损坏，推一个新提交让钩子重跑即可刷新 DB。

推完可以回读校验：`skopeo inspect --tls-verify=false --creds ... docker://gitea.topzero.cn:10241/cyberzero/workordernote:$VERSION`。
本机要直接 `docker pull` 这个仓库，得先把 `gitea.topzero.cn:10241` 加进 daemon 的 `insecure-registries`（自签证书）。

## 注意

- **`browser-harness/` 的脚本里有测试账号的默认口令**（`APP_PASS` 的默认值，方便无人值守跑套件）。
  仓库是私有的；要改成从环境变量读，把默认值去掉即可。
- 部署文档里出现的地址、目录、备份名都是**这两台 NAS 的真实值**，换环境要改。
- `browser-harness/node_modules/` 与 `browser-harness/shots/` 不入库（见 `.gitignore`）；
  首次跑套件先 `cd browser-harness && npm install`。
