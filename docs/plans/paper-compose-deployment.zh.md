# 模拟盘守护进程进 compose：决定记录（2026-10-29）

对应 `paper-trading-design.zh.md` §3 的部署方式。本文只有方案，没有代码；§5 列的授权点经用户确认后，按 §6 分 PR
实现。初稿经一个独立子代理对照代码审过一遍，它找到的遗漏都已改进正文（市场库连接、子进程环境、root 的用途、
代理要放行的接口等）。

## 1. 为什么

2026-10-28 出了两次事，原因相同：模拟盘里只有守护进程（`paper serve`）没人看管。

- 12:54 UTC Docker 重启，运行 2、3 收到 `SIGTERM` 结束。重开的办法已在 #1827 合并，但它只在守护进程活着时
  起作用：宿主机或 Docker 重启后，守护进程不会自己回来，运行既不封存也不重开。
- 守护进程是某个会话在它自己的终端标签里手动起的。标签和会话一结束，进程就没了。IDE 拿到
  `PAPER_UNAVAILABLE`，Paper 部分整块不显示，看上去像运行全没了；其实运行 4 的容器一直在跑、在记录。

IDE 容器（`restart: unless-stopped`）和每条运行的容器都由 Docker 管，夹在中间的守护进程却只能手动起。

## 2. 用户定（2026-10-29）

**方案 B：一个 compose 项目就是整体部署单元；IDE、守护进程和每条运行的容器在同一个 Docker 引擎上平行；
只有守护进程能起容器，而且要经一个受限的 Docker API 代理；IDE 不碰 Docker。** 本机和服务器用同一份
compose 文件。

被否掉的两种：

- **launchd 用户服务**：只管得了 macOS，上服务器要重写。
- **真嵌套（Docker-in-Docker）**：外层容器要 `--privileged`，等于给了宿主机 root；里层的引擎另有一份镜像缓存，
  按 digest 钉住的运行时镜像要重新拉；在 Mac 上还要多套一层虚拟机；外层一重启，所有东西一起倒。

## 3. 目标结构

```
compose 项目 trade-ide（services/ide/docker/compose.yaml；本机和服务器同一份）
│
├─ ide          页面、只读副本、聊天；127.0.0.1:8765 发布到宿主机
│     │ /api/paper/* 反代到 http://paper:8767
│     ▼
├─ paper        守护进程：python -m cli.main paper serve；端口不发布到宿主机
│     │ DOCKER_HOST=tcp://docker-api:2375（只在 docker-api 网络上）
│     │ 账本和市场库：TCP 连宿主机的 Dolt 服务（第一阶段，见 §4.5）
│     ▼
├─ docker-api   受限的 Docker API 代理，唯一挂载 /var/run/docker.sock 的容器
│     ▼
└─ trade-paper-<key>-<id>-runner / -egress   每条运行一对，由 paper 经代理创建，和上面几个平行
```

两个网络：

| 网络 | 谁在上面 | 作用 |
|---|---|---|
| `default` | ide、paper | ide 拉 DoltHub、反代到 paper；paper 经 `host.docker.internal` 连宿主机的 Dolt |
| `docker-api`（`internal`） | paper、docker-api | 只用来让守护进程调 Docker API |

IDE 不在 `docker-api` 网络上，所以连不到 Docker API；IDE 镜像里也不带 docker 客户端。

## 4. 各部分怎么定（实现细节，不需要授权）

### 4.1 镜像

`services/ide/docker/Dockerfile` 加一个 `paper` 目标，和 IDE 共用 Python、uv 和产品代码那几层，另装 docker
客户端（按 checksum 钉住的静态包），镜像发布为 `ghcr.io/qoeop/trade-paper:main`。IDE 镜像不变。IDE 镜像设的
`TRADE_LEDGER_HOME=/data/ledgers` 和 `DOLT_ROOT_PATH` 在 `paper` 目标里改掉（见 §4.3），`HOME` 指向一个可写目录。

守护进程从此跑 CI 构建的代码，不再是某个检出目录里恰好检出的分支；更新就是 `docker compose pull &&
docker compose up -d`。每条运行的容器仍用按 digest 钉住的运行时镜像，和守护进程镜像无关。容器里拉
`trade-runtime:main` 是匿名拉取（公开镜像），不经宿主机的凭据助手。

### 4.2 Docker API 代理

用通用的按 API 段放行的代理（HAProxy 实现，第三方镜像，按 digest 钉住）。放行的是守护进程和它起的命令行子进程
实际用到的调用，逐条来自代码：

| 调用 | 代码里的出处 |
|---|---|
| `_ping`、`version` | 每次 docker 命令行都先调 |
| 容器：create、start、attach、wait、inspect、logs、stop、kill、remove、list（`ps`） | `paper/runs.py`；对账时的身份探测和回放（`runtime/image.py`、`replay/seams.py`）用前台 `docker run`，要 attach 和 wait |
| 网络：create、connect、remove | `paper/runs.py` |
| 镜像：pull、inspect | `runtime/image.py` 每次开始都按标签拉一次 |

`exec`、卷、swarm、插件、系统、构建都关。对账时一次 attach 最长挂 3600 秒（`paper/serve.py` 的对账超时），代理的
超时要设得比这长。守护进程已经把 `DOCKER_HOST` 传给命令行子进程（`paper/runs.py` 的 `DOCKER_ENV`、
`paper/serve.py` 的 `CHILD_ENV`），所以指向代理不用改代码。

**残余风险要写明白**：代理按 API 段放行，看不到 create 请求的内容。能建容器，就能建一个挂载宿主机 `/` 的
特权容器，所以守护进程一旦被攻破，仍等于拿到宿主机 root。代理挡住的是其余接口；真正的边界是 IDE 和浏览器
够不到 Docker API。上服务器时再加一层：rootless Docker 或 Podman，或者换成自己写的校验代理，只放行
`runtime/container.py` 生成的那种容器（钉住的运行时镜像、只读根、去掉全部 capability、挂载只在运行目录
下）。这一步留到服务器阶段（§7）。

### 4.3 路径：在容器里用和宿主机相同的绝对路径挂载

有三处要求路径和宿主机一字不差：

- 每条运行的容器用 bind 挂载运行目录（`runtime/container.py` 写 `source={host.resolve()}`，挂载前还检查源
  路径存在）。经代理建的容器由宿主机上的引擎解析这个路径，所以守护进程看到的路径必须就是宿主机路径；
- 容器名和标签里的 `ledger_key` 是 `service_root.resolve()` 加数据库名的哈希（`paper/runs.py`）。路径一变，
  守护进程就认不出已经在跑的运行（比如现在的运行 4）；
- 对账的导出缓存、市场目录和成员表的临时目录都建在 `tempfile.gettempdir()` 下，再挂进回放容器，所以 `TMPDIR`
  也要是宿主机上同一路径的目录。`TMPDIR` 不存在或不可写时 Python 会悄悄退回 `/tmp`，那是只有容器里才有的路径，
  宿主机的引擎挂不上。所以守护进程启动时检查它，不对就拒绝启动。

compose 用一个变量 `TRADE_DATA`（默认 `${HOME}/.local/share/trade`）把下面几项按原路径挂进 paper：

| 宿主机路径 | 挂法 | 为什么 |
|---|---|---|
| `$TRADE_DATA/ledgers/` | 只读 | 账本和市场库的 profile（`TRADE_LEDGER_HOME`） |
| `$TRADE_DATA/dolt/service.json` | 只读，单个文件 | 服务的连接配置和账户 |
| `$TRADE_DATA/dolt/paper/` | 读写 | 运行目录 |
| `$TRADE_DATA/paper-tmp/` | 读写 | 守护进程的 `TMPDIR` |

只挂 `service.json` 一个文件，不挂整个服务目录：服务目录里的 `server.pid` 会被 `_pid` 在找不到进程时删掉
（`ledger/db.py`），容器里看不到宿主机的进程，挂了就可能误删；数据目录、`home/`（DoltHub 密钥）和备份目录
守护进程也都用不到。单文件挂载有一个代价：`ledger init` 等命令用原子替换重写 `service.json`，挂载还指着旧文件，
所以改过服务的账户后要重建 paper 容器（`docker compose up -d --force-recreate paper`）。

### 4.4 用户身份

`runtime/container.py` 用守护进程自己的 uid 和 gid 起运行容器（`--user`）。compose 里 paper 用宿主机用户的
uid 和 gid 跑，运行目录里的文件属主就和现在一样。zsh 和 bash 都不导出 `UID`、`GID`，compose 读不到，所以
写进 compose 文件旁边的 `.env`（`TRADE_UID`、`TRADE_GID`、`TRADE_DATA`），README 给出生成它的一行命令。

### 4.5 账本和市场库的连接（第一阶段）

现在两处连接都走服务目录里的 Unix socket：账本的 `ledger/db.py` `service_connection`，市场库的
`market/store.py` `_service_connection`（`paper start` 读成员表、`paper reconcile` 导出行情都用它）。Docker
Desktop 下，容器经 bind 挂载连宿主机上的 Unix socket 不可靠，所以两处都改走 TCP，按同一条规则各改各的（市场库不依赖账本模块，保持两份平行的小函数）：

- 环境变量 `TRADE_DOLT_HOST`（compose 里设成 `host.docker.internal`）存在时，连这个主机，端口取
  `service.json` 里这个服务自己的 `port`；不设时照旧走 socket，宿主机上的命令行和测试不受影响。只给主机、不给
  端口，是因为每个服务（包括隔离的测试服务）都有自己的端口，写死一个端口会让别的服务连到活动账本上去。
- 这个变量加进 `paper/serve.py` 的 `CHILD_ENV`，否则守护进程起的 `paper start|stop|seal|delete` 子进程拿不到它，
  仍然去找 socket。

这是本机的连接配置，不是账本里的存储字段。宿主机的 Dolt 服务现在只听 `127.0.0.1:13330`；Docker Desktop 把
`host.docker.internal` 转到宿主机的回环地址，所以本机不用改 Dolt 配置。

**root 经 TCP 能不能连，要先探测。** 服务的 root 账户只建成 `'root'@'localhost'`（writer 和 reader 是
`'%'`）。每次 paper 写入后命令行都会以 root 发布（`cli/main.py` 的 `_publish_after`），删除也用 root。经
Docker Desktop 转进来的连接在 Dolt 看来算不算 `localhost`，第 2 个 PR 先原生探测；不算的话，发布会以
`publish_failed` 失败（写入仍在，宿主机上下一次写入或 `ledger publish` 会补发），删除会失败。探测在隔离账本上
做，隔离账本要配一个 `file://` 的 origin，发布才真的走 `DOLT_PUSH`。

守护进程从不管理服务的启停：paper 的命令都只连接，不调 `start_service`。发布和发布锁（`GET_LOCK`）都在服务端
执行，经 TCP 照常可用。

**第一阶段留下的缺口**：宿主机重启后，Dolt 服务要等有人执行 `ledger service start` 才会起来。在那之前守护进程
会回来，但封存会失败、记进日志；它的封存循环会一直重试，Dolt 起来后补上。第二阶段（§7）把 Dolt 也放进 compose，
补上这个缺口。

### 4.6 守护进程的监听

守护进程在容器里听 `0.0.0.0:8767`，compose 不发布这个端口，宿主机和外部都连不到，只有 compose 网络上的容器
连得到。允许的 `Host` 用已有的 `--allow-host paper:8767` 加上，不用改代码。防护分在两边，不变：守护进程查
`Host` 白名单和 `Sec-Fetch-Site`；页面的令牌（`X-Trade-Paper-Token`）由 IDE 在反代前检查。
监听这一条要改一条拒绝检查，见 §5 第 1 条。

### 4.7 重启和接管

ide、paper、docker-api 都设 `restart: unless-stopped`。宿主机或 Docker 重启后，三者自动回来。守护进程的第一轮
封存循环会处理被 `SIGTERM` 停掉的运行：封存，并按 #1827 开新运行。每条运行的容器仍然不设重启策略（设计稿
§3「资源」：失败不重启）。

切换那一次：先停掉宿主机上的守护进程（现在开在本会话的终端标签里），再 `docker compose up -d`。正在跑的运行 4
的容器不动；新的守护进程用同一路径算出同一个 `ledger_key`，按容器名和标签接管它。停宿主机进程要用户授权，见
§5 第 4 条。

Docker Desktop 要设成登录时自动启动，这是用户自己在 Docker Desktop 里的设置，本文不替用户改。

### 4.8 页面不再整块消失

守护进程连不上时（`PAPER_UNAVAILABLE`），工具栏的运行组件和 Paper 页显示「Paper daemon offline」，并说明怎么
起它（compose 部署下是 `docker compose up -d`）；不再把 Paper 部分整块藏起来，免得被误读成运行没了。和容器化无关，
单独一个 PR。

## 5. 需要用户授权的点

用户 2026-10-29 按推荐批准了下面四条。

1. **改一条拒绝检查（产品代码，在 §6 第 2 个 PR 里）**
   - 现在：`paper serve --host` 不是回环地址就拒绝（`USAGE_ERROR`，「the paper daemon listens on loopback only」）。
   - 改后：只有在容器里（有 `/.dockerenv`）才允许非回环地址；在宿主机上仍只许回环。端口不发布到宿主机。
   - 不改的办法：paper 用 `network_mode: service:ide`，和 IDE 共用一个网络空间，仍听 127.0.0.1。代价是守护进程
     的生命周期绑在 IDE 上（IDE 一更新重建，paper 也得跟着重建），不再是平行的关系；而且要让 IDE 连不到 Docker
     API，代理就只能改成经共享卷里的 Unix socket 访问。所以不推荐。
2. **让一个容器能在宿主机的 Docker 上建容器（Docker 配置，在 §6 第 3 个 PR 里）**
   - 现在：只有宿主机上的进程（你的终端、各会话的命令行）用 Docker。
   - 改后：compose 里加一个第三方的 Docker API 代理（HAProxy 实现的通用代理，按 digest 钉住），挂载
     `/var/run/docker.sock`；守护进程经它建、停、删运行容器和网络，并拉运行时镜像。残余风险见 §4.2：守护进程
     被攻破仍等于宿主机 root。
   - 不改的办法：没有。守护进程要在容器里起兄弟容器，就得有 Docker API。
3. **服务的全部账户进容器（本机配置，在 §6 第 3 个 PR 里）**
   - 现在：`$TRADE_DATA/dolt/service.json` 只有宿主机上的进程读得到。这个服务同时承载研究账本和市场库，文件里有
     root 密码、研究账本的 writer 和 reader、市场库的 import 和 reader。
   - 改后：整个文件以只读方式挂进 paper 容器。writer 用于开始和封存；root 用于每次写入后的发布和删除（writer
     没有这两种权限）；市场库的 reader 用于读成员表和导出行情。市场库的 import 账户用不到，但在同一个文件里。
   - 为什么不精简：守护进程有了第 2 条的 Docker 权限，本来就能建一个挂载 Dolt 数据目录的容器，所以把 root 交给它
     并不扩大被攻破时的损失。精简的办法是生成一份只含研究账本 writer、reader 和市场库 reader 的连接文件，代价是
     页面上的删除按钮失效、发布要等宿主机下一次写入，还要多维护一个文件。不推荐。
4. **切换时停掉宿主机上的守护进程（终止宿主机进程）**
   - 第 3 个 PR 合并、镜像发布后，在本会话的终端标签里按 Ctrl-C 停掉现在的 `paper serve`，接着
     `docker compose up -d`。中间几十秒页面显示离线，运行 4 的容器不受影响。

不需要授权的：镜像、代理放行哪些接口、网络、路径挂载、TCP 连接开关、页面提示。这些按 §4 定，在 PR 里说明。

## 6. 分 PR

1. `docs(plans)`：本文，以及设计稿 §3 的部署说明。
2. `feat(paper)`：账本和市场库共用的连接函数，`TRADE_DOLT_HOST` 改走 TCP，加进 `CHILD_ENV`；`TMPDIR` 启动检查；
   §5 第 1 条的监听检查；Dockerfile 的 `paper` 目标和 CI 构建 `trade-paper` 镜像。附原生探测：容器经 TCP 连宿主机
   上的隔离服务，开始、封存、删除、发布（`file://` origin）各走一遍，root 能不能连也在这里定下来。
3. `feat(ide)`：compose 加 paper 和 docker-api 两个服务、`docker-api` 网络和 `.env` 说明；ide 改为
   `--paper=http://paper:8767`；`services/ide/README.md`。第 2 个 PR 合并、镜像发布后才能合；合并后按 §5 第 4 条
   切换。
4. `fix(ide)`：页面显示守护进程离线（§4.8），不依赖上面几个，可以先做。

每个 PR 都只在隔离的 Dolt 库上验证，不碰活动账本。切换那一步才在活动账本上真的跑起来。

## 7. 第二阶段（另行确认）

- **Dolt 进 compose**：活动账本的服务改由 compose 管，宿主机上的命令行经 `127.0.0.1:13330` 连它。这牵涉服务
  启停（`ledger service start/stop`）、`ledger init`、备份目录、DoltHub 密钥的位置，以及 root 只许 `localhost`
  这条，改的是账本服务的运行方式，要单独设计、单独确认。做完后宿主机重启也不用人管。
- **上服务器**：镜像加 amd64（现在只构建 arm64）；Docker 换 rootless 或 Podman，或者换成 §4.2 的校验代理。
  Linux 上 `host.docker.internal` 到不了宿主机的回环地址，root 经 TCP 也不算 `localhost`，所以必须先完成上一条。

## 8. 不做

- 把守护进程并进 IDE 容器：IDE 面对浏览器和聊天，不给它 Docker 权限。
- 给运行容器加重启策略：失败的运行仍然停在 Failed。
- 自己写调度器或进程管理器：重启交给 Docker 的重启策略。
