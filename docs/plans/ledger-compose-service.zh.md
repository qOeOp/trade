# Dolt 服务进 compose，首次启动自己建好：决定记录（2026-10-29）

本文是 `paper-compose-deployment.zh.md` §7 第二阶段的方案，只讲方案，不含代码。§5 列出的授权点经用户确认后，按 §6
分 PR 实现。初稿经一个独立子代理对照代码审过一遍，它指出的问题都已经改进正文，包括 root 的全部用途、健康检查、
自举的检查顺序和清理范围、迁移时的账户，以及宿主机上 Dolt 的版本。

## 1. 目标

用户 2026-10-29 的原话是：“服务器上一条 `docker compose up -d` 就起整套。”所以：

- 账本和市场库所在的 Dolt 服务交给 compose 管。宿主机重启、Docker 重启后它自己回来，不用人去
  `ledger service start`。
- 在一台新机器上第一次 `up` 时，Dolt 服务自己从 DoltHub 的公开副本克隆两个库，自己建账户，自己写
  `service.json` 和配置文件，服务器上不用跑任何命令。
- 本机和服务器用同一份 compose 文件。第一阶段 §6 的第 3 个 PR（compose 加 paper 和 docker-api）并进本阶段，这样
  只切换一次；否则要先接 `host.docker.internal`，紧接着又改成连 compose 里的 Dolt，白切一次。

## 2. 现在的服务为什么不能直接搬进容器

以下都来自代码（`ledger/db.py`、`ledger/admin.py`、`ledger/publish.py`、`cli/main.py`）：

- **启停假定 Dolt 是宿主机上的进程。**
  - `start_service` 用 `service.json` 里的 `binary` 在宿主机上起 `dolt sql-server`，并记下 `server.pid`；
    `_pid` 用 `ps` 核对这个进程；`stop_service` 发 `SIGTERM`。
  - 调 `start_service` 的有 `ledger init`、`market init`、`upgrade`、`upgrade_market` 和 `ledger service start`。
    服务进了容器以后，宿主机上随便哪条这样的命令，都可能在同一份数据上再起一个服务。
  - `ledger service start` 读不到账本时会调 `stop_service`。
- **服务配置写死了宿主机。** `_create_service` 生成的 `config.yaml` 只听 `127.0.0.1`，端口随机挑；socket 和数据
  目录写的都是宿主机上的绝对路径。
- **root 只认 `localhost`。**
  - 服务上只有 `'root'@'localhost'` 一个 root。
  - 用 root 的地方有：每次写入后的发布检查（`unpublished`）和发布本身、`ledger publish --remote`、`upgrade` 和
    `upgrade_market`、关闭研究线时打的 `DOLT_TAG`、两种备份（`DOLT_BACKUP`），以及 `paper delete`。
  - 第一阶段的原生探测（#1834）量过：Docker Desktop 下，容器经 `host.docker.internal` 连宿主机上的服务，Dolt
    把它看成 `root@localhost`。可一旦 Dolt 自己跑在容器里，别的容器连过来、宿主机经发布端口连过来，来源都是
    网关或容器的地址，root 就连不上了。
- **只能建新库。** `_provision` 遇到已有的库就拒绝（`LEDGER_EXISTS`），因为它把建表和建账户放在一起做。克隆
  来的库已经有表和历史，只缺账户、授权和分支控制。
- **备份要求两头路径一致。**
  - `DOLT_BACKUP('sync-url', file://…)` 在服务端执行，写的是服务端看到的路径。
  - `backup_head` 在客户端用 `service.json` 的 `binary` 跑 `dolt backup restore`。`ledger review` 的备份核对和
    `_sync_backup` 都靠它。宿主机 `PATH` 上的 Dolt 是 1.80.2，不能替代那个 2.4.2 的 `binary`。
- **DoltHub 密钥。** `ledger publish --remote` 把 `dolt login` 得到的密钥复制到 `<服务>/home/.dolt`，服务启动时读取
  （`DOLT_ROOT_PATH`）。`_key_after_start` 根据 `server.pid` 判断装完密钥后要不要重启服务。

## 3. 目标结构

```
compose 项目 trade-ide（services/ide/docker/compose.yaml）
│
├─ ide        页面、只读副本、聊天；127.0.0.1:8765 发布到宿主机；/api/paper/* → http://paper:8767
├─ paper      守护进程；不发布端口；TRADE_DOLT_HOST=ledger；DOCKER_HOST=tcp://docker-api:2375
├─ docker-api 受限的 Docker API 代理（第一阶段 §4.2）
└─ ledger     dolt sql-server，承载账本 research 和市场库 market
                 在容器内听 0.0.0.0:13330，只发布到宿主机的 127.0.0.1:13330
                 第一次启动：从 DoltHub 克隆、建账户、写 service.json 和配置文件
                 以后每次启动：先核对，再起服务

宿主机上的命令行（Agent 跑的 python -m cli.main）→ 127.0.0.1:13330
```

`ide` 继续用它自己的只读副本（`DOLT_PULL` 跟 DoltHub），本阶段不改它。

## 4. 各部分怎么定（实现细节，不需要授权）

### 4.1 镜像和入口

`ledger` 和 `paper` 两个服务用同一个镜像。这个镜像里已经有 Python、Dolt 和产品代码，第一阶段第二个 PR 构建的
就是它。改动有三处：

- 镜像的 `paper` 目标改名为通用的 `service`；
- 镜像名改为 `ghcr.io/qoeop/trade-service:main`；
- 去掉 `ENTRYPOINT`，由 compose 给每个服务写各自的命令。

两个服务的命令：

- `ledger`：`python -m cli.main ledger service run`，`ledger service` 的新动作。它在前台运行：
  1. 没有服务就先自举（§4.3）；有服务就先核对（§4.4）。
  2. 以 `DOLT_ROOT_PATH=<服务>/home` 起 `dolt sql-server`，作为自己的子进程，并把收到的信号转给它。
  3. 等它退出。`init: true` 负责回收子进程。
- `paper`：`python -m cli.main paper serve --host 0.0.0.0`。

两个服务都以 `user: ${TRADE_UID}:${TRADE_GID}` 运行。`service.json` 和配置文件都是 0600，所以必须属于在宿主机上
跑命令行的那个用户。

### 4.2 数据放在哪

服务目录 `$TRADE_DATA/dolt`、配置文件目录 `$TRADE_DATA/ledgers` 和备份目录 `$TRADE_DATA/dolt-backups`，都照第一
阶段 §4.3 的做法，在容器里挂到和宿主机相同的路径上。这样 `service.json`、配置文件和 `DOLT_BACKUP` 的
`file://` 路径，在宿主机和各个容器里指的是同一个东西。

本机迁移就是原地接管：现有的服务目录直接挂进去，17 GB 的 `market` 不拷贝。

**量过了（2026-10-29，Docker Desktop，Dolt 2.4.2）。** 同一个 100 万行的库，在宿主机、容器里经 bind 挂载、
容器里经命名卷上各跑一遍，结果见下表。三处的性能没有差别：

| 操作 | 宿主机 | bind 挂载 | 命名卷 |
| --- | --- | --- | --- |
| 写入 | 7.2 秒 | 7.3 秒 | 7.3 秒 |
| 范围查询 | 0.33 秒 | 0.27 秒 | 0.26 秒 |
| `dolt gc` | 0.52 秒 | 0.49 秒 | 0.46 秒 |

问题出在文件锁：**Dolt 的文件锁过不了 virtiofs。**

- 只在宿主机上时，第二个 `dolt sql-server` 会被拒绝：“locked by another dolt process”。
- 容器里的服务占着经 bind 挂载的目录时，宿主机上照样能再起一个服务，也能直接写；写进去的东西，容器里的服务
  看不到。

所以 `data` 一律放进命名卷：`config.yaml` 的 `data_dir` 指向卷，宿主机上的进程根本碰不到它。本机切换时把
`data` 整份拷进卷，原来的 `data` 改名为 `data.before-compose`，留着不动。`service.json`、`cfg`、`home` 和备份
仍然走 bind 挂载，路径和宿主机相同。

同一次探测也量到：经发布端口连进来时，Dolt 拒绝 `'root'@'localhost'`、接受 `'root'@'%'`，这是 §5 第 1 条的依据。
另外，Dolt 默认会在命令结束后另起一个后台进程，往它的 home 里写使用事件（usage events）。所以 `ledger service
run` 关掉了这些事件（`DOLT_DISABLE_EVENT_FLUSH`、`metrics.disabled`），否则失败自举清空的目录会被它重新写满。

### 4.3 第一次启动：自举

条件：服务目录 `$TRADE_DATA/dolt` 和数据卷都不存在或里面没有文件（空目录不算，比如 paper 的挂载建出的运行目录 `paper/`），而且 `$TRADE_DATA/ledgers` 里没有配置文件。

只要两者有一个不满足，又没有 `service.json`，就拒绝启动，什么也不动，日志里写明原因。例如 `TRADE_DATA` 设错了、
或者 `service.json` 丢了：自举绝不在别人的数据上动手。

满足条件时按下面的顺序做。步骤里的检查都在克隆之前或之后立刻做，任何一步失败，就删掉这次自举自己建的服务
目录和配置文件，下次启动从头再来：

1. 先查 DoltHub 密钥目录（§4.6）。没有就拒绝，拒绝码 `DOLTHUB_CREDENTIALS`，这时还没下载任何东西。
2. 建服务目录。`config.yaml` 只听 `0.0.0.0:13330`，端口固定，因为要发布出去；不开 Unix socket。Dolt 的提交人
   配置照 `_create_service` 的写法。
3. 在 `data` 下用 `dolt clone` 克隆两个公开库：`vincent/trade-research` 克隆成 `research`，
   `vincent/trade-market` 克隆成 `market`。
   - 克隆完，把远端的每个分支都建成同名的本地分支，例如市场库的 `legacy-20261025`。
   - 标签随克隆一起过来。
   - 克隆的来源就是两个库的 `origin`，之后照旧发布到那里。
4. 核对克隆来的两个库，有一项不对就拒绝，什么也不留：
   - 账本：`ledger_schema` 的版本必须等于 `SCHEMA_VERSION`，写入账户也是这么要求的；`dolt_tests` 必须等于
     `review.product_commit_tests()`，这和 `ledger init` 的回读检查是同一个标准。
   - 市场库：`market_schema` 的版本必须等于市场库代码读的版本；`dolt_tests` 必须是 `market/store.py` 定义的那组
     提交测试。
5. 起服务，用 root 设口令，建 `'root'@'%'` 和它的分支控制行（§5 第 1 条），然后 `_secure`。
6. 给两个库各建账户、授权和分支控制，做法是“接管已有库”：把 `_ledger_tables` 和 `_market_tables` 的后半段
   （建账户、授权、分支控制）拆出来复用，建表的前半段不跑。
   - 先用 `_clear` 清掉同名的残留账户。
   - 失败时不走 `_remove`，因为它会删库。
   - 研究分支用 `main`。
7. 写 `service.json`，写法见 §4.4，`secured` 为真，`databases` 记两个库的账户。再写两个配置文件，检查照
   `init` 的规矩：只有一个活动账本、一个活动市场库，服务和备份都不在源码目录和临时目录里。
   - `research.json`：活动账本，研究分支 `main`，备份放在 `$TRADE_DATA/dolt-backups/research`。
   - `market.json`：同上，备份放在 `$TRADE_DATA/dolt-backups/market`。

自举拿到的是 DoltHub 公开副本上已有的全部历史。本机迁移不走这条路（§4.2 原地接管），所以本机上还没发布的写入
不会丢。

### 4.4 `service.json`、连接规则和宿主机命令

**不加新键。** compose 管的服务，`service.json` 的写法：

- 没有 `socket`，`port` 固定 13330；
- `binary` 照旧，是宿主机上客户端用的那个 Dolt 2.4.2：
  - 本机迁移时不改；
  - 服务器上自举时写镜像里的 `/usr/local/bin/dolt`，因为那里没有宿主机命令行。

“没有 `socket`”本身就说明这个服务不归宿主机进程管、要走 TCP。

连接规则在第一阶段第二个 PR 的基础上补一条，按顺序取第一条成立的：

1. 有环境变量 `TRADE_DOLT_HOST`：连这个主机的 `port`。只有 compose 里的 `paper` 设它（设成 `ledger`），那个容器
   只用活动服务。
2. 否则 `service.json` 有 `socket`：走 socket，和现在一样。测试起的临时服务都走这条。
3. 否则：连 `127.0.0.1:port`。宿主机上的命令行走这条，所以不用在每个 shell 里设环境变量。

对没有 `socket` 的服务，下面这些操作的行为要改：

- **`start_service`**：只等服务能连上，不起进程，不写 `server.pid`。`ledger init` 在这个服务上建新库照样能用。
- **`stop_service`**：拒绝，拒绝码 `SERVICE_MANAGED`，提示“这个服务由 compose 管，请用
  `docker compose stop ledger`”（§5 第 3 条）。
- **`ledger service start`**：读不到账本时不再去停服务，照旧报 `SERVICE_START_FAILED`，但说明要改成
  “服务由 compose 管，没有停”。
- **`ledger service status`**：`pid` 为空，`address` 报 `127.0.0.1:13330`。
- **`PUBLISH_FAILED` 的提示**：现在提示的是 `ledger service stop/start`，对这种服务改成提示
  `docker compose restart ledger`。
- **`_key_after_start`**：不再看 `server.pid`。`ledger service run` 在 Dolt 启动前就装好密钥，之后只有宿主机上的
  `ledger publish --remote` 会换密钥，而 `_install_key` 对没变的密钥什么也不做。所以 `restart_required` 就是“这次装进了
  一个新密钥”。

`ledger service run` 每次启动（不只第一次）都核对三件事，任何一件不对就拒绝起服务，什么也不改：

1. 服务级的 `dolt_commit_verification_groups` 是 `commit`；
2. `service.json` 里记的每个库，服务上都有；
3. 两个库的 schema 版本照 §4.3 第 4 步的标准。

另外，paper 容器只读挂整个服务目录，`home/` 用 tmpfs 盖住（第一阶段 §4.3）。不挂 `service.json` 这一个文件：
compose 建 paper 容器时 ledger 还没自举，这个文件还不存在。`paper` 依赖 `ledger` 健康后才启动（§4.5），所以它
启动时文件一定已经在了。

### 4.5 启动顺序和健康检查

- `ledger` 的健康检查用 `ledger service check`，这是新加的动作：用 reader 账户分别读 research 和 market，读到
  符合 §4.3 第 4 步的 schema 版本才退出 0。现有的 `ledger service status` 读不到也退出 0，而且只看 research，
  所以不能拿来当健康检查。
- 第一次启动要克隆约 17 GB，所以 `start_period` 给得很长（6 小时），期间每 30 秒查一次。
- `paper` 依赖 `ledger` 健康（`depends_on: condition: service_healthy`）。`ide` 不依赖它，第一次 `up` 时页面
  马上就能打开；克隆期间，Paper 部分按 #1833 的样子显示“守护进程离线”，克隆完自己连上。代价是在服务器上第一次
  `docker compose up -d` 会一直等到克隆完才返回。
- 四个服务都是 `restart: unless-stopped`。

### 4.6 DoltHub 密钥

发布要密钥，克隆公开库不要。

- `.env` 里的 `TRADE_DOLTHUB` 指向一个目录，结构和 `dolt login` 产出的 `~/.dolt` 一样：`config_global.json`
  加上 `creds/`。
- 这个目录只读挂进 `ledger` 容器，别的容器看不到。
- `ledger service run` 每次启动都用现有 `_install_key` 的逻辑，把密钥装进 `<服务>/home/.dolt`。

第一次自举时如果没有这个目录，就拒绝（§4.3 第 1 步）：活动账本的每次写入都要发布，发布不了的活动账本不该先
跑起来。

本机迁移时，服务目录里已经有 `ledger publish --remote` 装好的密钥，`TRADE_DOLTHUB` 可以不设。

### 4.7 一个部署只有一个活动账本

同一个 DoltHub 仓库只能有一个写者，本机和服务器不能各有一个活动账本、同时往同一个 `origin` 发布。

现有的发布检查已经能挡住分叉：远端的历史不是本地历史的祖先时，拒绝并报 `PUBLISH_REJECTED`。但被挡住的那份
写入会一直留在本地发不出去，所以从本机换到服务器要按“搬家”来做：

1. 本机最后发布一次；
2. 本机 `docker compose down`；
3. 服务器 `up`，从 DoltHub 自举。

宿主机上 Agent 跑的命令行，连的是本机 compose 里的服务。服务器上的研究从哪里写，不在本阶段（§7）。

### 4.8 上服务器

- **架构选 arm64。** 运行时镜像的身份里钉了 `platform`（`runtime/container.py`），现有的运行和模拟盘都钉在
  `linux/arm64` 的 digest 上。服务器用 arm64，这些钉住的镜像能原样跑，不用为 amd64 另出镜像、另起身份。
- **Docker 用 rootless。** Docker API 代理放行“建容器”。在 rootful Docker 上，能建容器就等于拿到服务器的 root；
  在 rootless Docker 上，这个权限止于那一个普通用户。rootless 下有两处不同：
  - 容器里的 uid 0 就是宿主机上的那个用户，所以 `.env` 里写 `TRADE_UID=0`、`TRADE_GID=0`；
  - 代理挂的 socket 是 `$XDG_RUNTIME_DIR/docker.sock`，由 `.env` 的 `DOCKER_SOCK` 给出，默认是
    `/var/run/docker.sock`。
- **服务器上要放的东西**：`compose.yaml`、`.env` 和密钥目录。`.env` 写 `TRADE_DATA`、`TRADE_UID`、`TRADE_GID`、
  `DOCKER_SOCK` 和 `TRADE_DOLTHUB`。装 Docker 是一次性的服务器准备，不归本仓库。之后部署和更新都只是
  `docker compose pull && docker compose up -d`。
- **备份**：服务器上起初没有备份，所以第一次 `ledger review` 会报“备份未核对”这条限制，直到有人做过一次备份。
  服务器上的备份谁来做、多久做一次，留到上服务器的那个 PR 再定。

## 5. 需要用户授权的点

用户 2026-10-29 按推荐批准了下面五条。

1. **root 开放给网络连接。** 新建 `'root'@'%'`，口令和 `'root'@'localhost'` 相同，并加一行分支控制
   `('%', '%', 'root', '%', 'admin')`。
   - 现在：只有本机进程能以 root 登录。
   - 改后：能连到 13330 端口的人，凭 root 口令都能登录。不过端口只发布到宿主机的回环地址；容器之间只在 compose
     的网络里互通；口令只写在 0600 的 `service.json` 里，第一阶段已批准把它只读挂进 paper 容器。
   - 什么时候建：本机切换时在现有服务上建（第 2 条），服务器在自举时建。
   - 替代办法：另建一个专用的管理账户，把所有用 root 的地方都改成用它。要改的代码更多，安全上没有区别，所以
     不推荐。
2. **本机切换**：停掉宿主机上的 Dolt 服务，改写它的配置，然后交给 compose。按顺序：
   1. 本机最后发布一次。
   2. 用 `ledger service stop` 停掉现在的 `dolt sql-server`。
   3. 原样留一份 `service.json.before-compose` 和 `config.yaml.before-compose`。
   4. 改 `service.json`：去掉 `socket`，其余不变，端口本来就是 13330。
   5. 把 `data` 整份拷进命名卷（§4.2 量过，必须这样），原来的 `data` 改名为 `data.before-compose`，留着不动。
   6. `docker compose up -d`。`config.yaml` 由 `ledger service run` 每次启动按参数写（只听 `0.0.0.0:13330`、
      不开 socket、`data_dir` 指向卷）；`'root'@'%'` 和它的分支控制行也由它在每次启动时补齐，已有就不动。
   7. 用宿主机命令行和 paper 容器各走一遍 root、writer、reader 和发布。

   第一阶段已批准的“停宿主机守护进程”放在同一步做，所以只切一次。数据不删不改：原来的 `data` 改名留作回退，
   删不删由用户以后决定。
3. **新增和收紧的拒绝**，都要登记进 `ledger/refusals.py`：
   - **新增 `SERVICE_MANAGED`**：
     - 现在：`ledger service stop` 能停任何服务。
     - 改后：compose 管的服务拒绝，要用 `docker compose stop ledger`。
   - **`ledger service run` 每次启动的三项核对**（§4.4）：
     - 现在：服务起不起来，不看这三项。
     - 改后：任何一项不对就不起服务。
   - **自举的拒绝**（§4.3）：
     - 现有数据不是空的，拒绝；
     - 没有密钥，拒绝；
     - 克隆来的库 schema 版本或提交测试不对，拒绝。
   - **行为变化，不是新拒绝**：
     - compose 管的服务读不到时，`ledger service start` 不再停服务；
     - `start_service` 遇到这样的服务，只等它能连上；
     - `SERVICE_START_FAILED` 和 `PUBLISH_FAILED` 的说明文字要跟着改。
4. **DoltHub 密钥的位置。** 密钥目录由 `.env` 指定，只读挂进 `ledger` 容器（§4.6）；第一次自举时没有它就拒绝。
   这是产品代码读一份凭据，和 `ledger publish --remote` 现在读 `~/.dolt` 是同一份东西、同一种读法，只是来源改由
   `.env` 指定。
5. **服务器选型**（§4.8）：arm64 加 rootless Docker。真上服务器时，装 Docker、配 rootless 都是改那台机器的主机
   配置，到时候再单独问。

## 6. 分 PR

1. `docs(plans)`：本文，以及第一阶段文档 §6、§7 的改动（把第 3 个 PR 并进本阶段）。
2. `feat(ledger)`，包括：
   - 第三条连接规则；
   - 对没有 `socket` 的服务，`start_service`、`stop_service`、`ledger service start/status`、
     `_key_after_start` 和两条提示文字的行为；
   - 接管已有库，即把建账户、授权、分支控制那半段拆出来；
   - `ledger service run`（自举、核对、在前台跑 Dolt）和 `ledger service check`；
   - 在 `ledger/refusals.py` 里登记 `SERVICE_MANAGED`。

   测试都在临时服务上做，覆盖：
   - 从 `file://` 远端克隆后自举，包括远端的分支和标签都过来了；
   - 自举的每条拒绝，以及拒绝后只删掉自己建的东西；
   - 每次启动的三项核对；
   - 经 TCP 的连接；
   - `SERVICE_MANAGED`。

   另附原生探测：在容器里经 bind 挂载跑一个隔离服务，量 §4.2 那几项。
3. `feat(ide)`，包括：
   - 镜像目标改名 `service`，去掉 `ENTRYPOINT`，CI 改推 `trade-service`；
   - compose 加 ledger、paper、docker-api 三个服务和两个网络；
   - `.env` 的说明；
   - ide 改成 `--paper=http://paper:8767`；
   - 更新 `services/ide/README.md`。

   验证：在一个空的 `TRADE_DATA` 上跑 `up`，自举时用 `file://` 远端或隔离的 DoltHub 仓库，代替两个公开库。合并后
   按 §5 第 2 条切换本机。
4. 上服务器（arm64、rootless、备份）另开一个 PR，到时候再定。

每个 PR 都只在隔离的库上验证。只有切换那一步才动活动账本的服务，而且只改它的运行方式，不动数据。

## 7. 不做

- **IDE 改读 compose 里的账本**（去掉它自己的副本和 `DOLT_PULL`）：值得做，但改的是 IDE 的数据来源，另行设计。
- **服务器上的研究入口**（服务器上由谁来跑命令行写研究）：本阶段只做到服务器能把整套服务和模拟盘跑起来。
- **多个部署共写一个 DoltHub 仓库**：§4.7 只允许一个写者。
- **自己写进程管理或部署工具**：启停交给 compose 和 Docker 的重启策略。
