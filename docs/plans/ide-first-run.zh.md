# 首次启动页

状态：用户 2026-11-07 批准设计和三项授权（“可以”），已实现。实现与原设计不同的地方见“实现时的调整”。

对应发现：20261107-131（界面看不到 DoltHub 和服务器配置）、20261107-129（无 view 时只有一行错误）。用户 2026-11-07
提出：没有 `TRADE_RESEARCH_ORIGIN` 时，在页面中央用打字机风格的表单让用户填，而不是写死。

## 目标

新操作者跑完 `docker compose up -d` 后，打开页面就能把账本建起来，不用在机器上装 Dolt，也不用手抄 key。

页面只问两件事：DoltHub 仓库和 key。市场范围不问，因为用户本来就要写 `.env`，默认值放进那一步就够了。

## 现状（2026-11-07 实测）

| 事实 | 怎么测的 |
|---|---|
| 这个值不在镜像里，只在部署配置里；作者默认值已由 #2237 去掉 | 读 `deploy/compose.yaml` |
| 没有这个值时，`ledger` 以 `USAGE_ERROR` 退出，`ide` 等 `ledger` 健康才启动，所以没有页面 | 读 `cli/service.py`、`deploy/compose.yaml` |
| `ide` 不依赖账本也能提供页面：`/` 200，`/api/view` 503 `LEDGER_UNKNOWN` | 本机起 `ide.py serve`，没有账本 |
| `up -d` 等依赖健康时，不依赖它的服务已在运行；依赖一健康，`up -d` 退出 0 | 一次性 compose 项目 |
| `dolt creds new` 生成的 `config_global.json` 和 `creds/` 正是 `install_key` 要读的结构；`creds ls -v` 给公钥 | 临时目录里的 Dolt 2.4.2 |
| `config_global.json` 已存在时，`creds new` 会把 `user.creds` 写进去 | 同上 |
| 未登记的 key，`dolt creds check` 报 `Unauthenticated ... key not found` | 同上，连 DoltHub |
| 不存在的仓库，`dolt clone` 报 `PermissionDenied` | 同上，连 DoltHub |
| 信号处理在 `start()` 之后才装，bootstrap 中的 SIGTERM 不走清理，下次启动是 `BOOTSTRAP_REFUSED` | 读 `cli/service.py:148,239,331` |
| `Waiting.tsx` 已是页面中央一行打字状态；`Typing` 循环打字，尊重 reduced motion | 读代码 |

## 用户看到的流程

终端步骤：写 `.env`（`TRADE_UID`、`TRADE_GID`、`TRADE_DATA` 和默认的 `TRADE_MARKET_ARGS`）、建目录、`deploy.images`、
`docker compose up -d`。不再需要 `dolt login` 和 `cp -R ~/.dolt`。`up -d` 会停在等 `ledger`，这时打开页面；账本建好后它自己结束。

默认的市场范围是 BTC、ETH、SOL 的 K 线，从 2024-01 起。`deploy/README.md` 说明成本和怎么改。

页面只有一列，居中。问题第一次出现时打一遍字，然后控件出现；回到带错误的步骤时整段直接显示，不再打字。已有的值直接跳过。

1. **Which DoltHub repository keeps your research?** 先说明一切公开且收不回。输入 `owner/repository` 或 DoltHub 页面地址。空仓库开新账本，已有账本的仓库接着用。
2. **Add this key to your DoltHub account.** 显示公钥、复制按钮和 DoltHub 设置页链接。按钮写 **Set up public ledger**：先跑 `dolt creds check`，通过了再开始。
3. **设置中**：`Typing` 循环显示真实步骤：读仓库，或发现仓库是空的、新建并发布。
4. **Your ledger is ready.** 告诉用户对 Agent 说什么。如果 `/api/paper/` 不通（用户中途按过 Ctrl-C），写明要再跑一次 `up -d`。

失败时回到对应那一步，保留已答的值，控件下方写明原因和拒绝码。

| 情况 | 信号 | 回到 |
|---|---|---|
| 仓库不存在或无权读 | `BOOTSTRAP_FAILED`（`PermissionDenied`） | 第 1 步 |
| 仓库有内容但不是账本 | 缺表的数据库异常，要映射成 `BOOTSTRAP_FAILED` | 第 1 步 |
| key 未登记 | `creds check`，报 `DOLTHUB_CREDENTIALS` | 第 2 步 |
| 新账本首次发布写不进去 | `PUBLISH_FAILED`，已自动清理 | 第 2 步 |
| 接续已有账本但没有写权限 | 设置时查不出，首次写入才失败 | 见“验证”第 6 条 |
| key 目录不空但没有可用的 key | `DOLTHUB_CREDENTIALS` | 页面只显示原因 |
| 上次 bootstrap 被强杀，留下目录 | `BOOTSTRAP_REFUSED` | 页面只显示原因和清理命令 |

## 改动

**`ledger service run`（`cli/service.py`）。** 加 `--setup-port`。带这个参数、是 active 服务、没有 `service.json` 时，都打开设置端口：

- 值已齐全就先试一次，失败不退出，继续等，所以 `.env` 写错也能在页面上看到原因（20261107-129）。
- bootstrap 在主线程跑；HTTP 在另一个线程，POST 立即返回，页面用 GET 查状态、步骤和拒绝。一次只跑一个 bootstrap，所以刷新和双标签页都安全。
- 进入等待前就把 SIGTERM、SIGINT 转成退出，让现有清理能跑。
- 复用现有 bootstrap 和清理。把 `_log` 的步骤也交给状态。
- 成功后关闭端口。

不带这个参数时行为不变：命令行和只读镜像照旧拒绝。设置端口做 Host 白名单，因为同一网络的其他容器不经过 `ide` 的令牌。

**key。** 只在 key 目录完全为空时才跑 `dolt creds new`，否则不写，缺 key 就报 `DOLTHUB_CREDENTIALS`，防止 `TRADE_DOLTHUB` 指向真实的 `~/.dolt` 时被改动。
`DOLT_ROOT_PATH` 指向 key 目录的上级，不用 service 的环境。生成位置就是 `install_key` 本来读的位置，所以它之后的代码不用改。重启不换 key。页面只拿公钥。

**`deploy/compose.yaml`。** `ledger` 的 key 目录去掉 `:ro`，传 `--setup-port`（不发布到宿主机）；`ide` 去掉 `depends_on: ledger`，传 `--setup=http://ledger:<port>`。`market-import` 不变。
远程叠加层有自己的 `command` 和 `!override`，不受影响（读代码，待实测）。

**`ide/research_graph/serve.py`。** `/api/setup/` 转发给 `--setup`，用 `/api/paper/` 现有的检查：Host 白名单、`Sec-Fetch-Site: same-origin`、页面令牌。`ide` 容器仍然写不了账本，也拿不到私钥。

**`ide/web`。** `main.tsx` 在 `follow` 前先问 `/api/setup/`。`/api/view` 报 `LEDGER_UNKNOWN` 时再问一次，因为启动竞态下转发的 502 分不清“已建好”和“还没起来”。
`FirstRun` 用现有的 `TextField`、`FormButton`；`Typing` 加“打一遍就停”的用法。界面文字用英文。

**文档和合同。** `README.md`、`deploy/README.md` 的步骤改短，默认 `TRADE_MARKET_ARGS` 进 `.env` 那一行；`cli/main.py` 的命令合同文字；`research-start` 的无账本分支指向这个页面，并跑它的 eval。

### 存了什么

没有新增字段或文件，只有生成的 key 放在 `TRADE_DOLTHUB` 目录。仓库地址存在账本数据库的 `origin` remote 里，这是现有事实。

## 需要用户授权

`AGENTS.md` 要求这些先问：

1. **放宽拒绝。** 现在第一次启动缺仓库（`USAGE_ERROR`）、缺 key（`DOLTHUB_CREDENTIALS`）或克隆失败（`BOOTSTRAP_FAILED`）就退出；改后带 `--setup-port` 时显示在页面上并继续等。不改的办法是继续用 `deploy/README.md` 的命令。
2. **key 目录改为可写。** 对所有 compose 部署都生效，这个目录可能在 `$TRADE_DATA` 之外。代码只在目录为空时写。
3. **页面能触发新建账本和首次公开发布。** 由用户在页面上点按钮完成，只开放到账本建好为止。

## 实现时的调整

- **参数合并成一个。** `--setup=ledger:8770` 同时给出端口和允许的 Host，不用 `--setup-port` 再加一个白名单参数。
- **端口建好后不关。** 只答 GET，POST 不再做任何事。如果一建好就关，页面看到的 502 就分不清“完成了”和“服务挂了”。POST 仍然只开放到账本建好为止，容器重启后也不再打开。
- **Dolt 只在临时目录里跑 key 命令。** 生成和读取都用一次性的 Dolt 主目录，复用 `publish.install_key`，不把 `DOLT_ROOT_PATH` 指向 key 目录的上级。这样不依赖目录名是 `.dolt`，也不会往用户的 `~/.dolt` 写 `eventsData`。
- **阻断时页面不给清理命令。** 只显示原因并指向 `deploy/README.md` 的 First start：这些目录里可能有 `service.json` 丢失的真账本，删除要人先看过。
- **页面会多问一次。** 服务还没起来时，页面先跟账本走，同时每 3 秒问一次设置端口，直到出现 view。这样不用解析 `LEDGER_UNKNOWN`。
- **`file://` 不跑 `creds check`。** 只有 DoltHub 地址才查 key。
- **按下后立刻切换。** 页面不等 POST 返回就显示设置中，失败再退回去。
- **新账本的第一屏。** `RESEARCH_LINE_REQUIRED` 不再显示成“图画不出来”，改为告诉用户去对 Agent 说什么。
- **远程叠加层保留依赖。** 基础配置的 `ide` 去掉 `depends_on` 后，叠加层把它加回去，服务器行为不变。

`research-start` 的无账本分支加了一句（净增 15 词）。

## 放弃的方案

| 方案 | 为什么不用 |
|---|---|
| 页面也问市场范围 | 要多一个配置文件、一处挂载、一个等待循环和一个写错会循环重启的自由输入，而用户本来就要写 `.env` |
| 只问仓库地址 | 用户还得装 Dolt、回终端处理 key |
| 在页面粘贴私钥 | 私钥会经过浏览器和 `ide`，而现在 `ide` 碰不到它 |
| 单独的 `setup` 容器 | 要多一个服务，而且 bootstrap 的失败要再传一次才能回到页面 |
| `ide` 写配置，或把 `.env` 挂进容器 | 破坏“这个容器什么都写不了”的边界 |
| 服务器也用这个页面 | 服务器是公开账本的只读镜像，不新建账本，值由管理员配置 |
| `ledger` 等待时报告健康 | `paper` 会在没有账本时启动 |
| 建好后还能在页面改仓库或 key | 没有对应机制：建好后不再读 origin，改公开副本要用户授权 |

## 风险

- **等待超过 `start_period` 的 6 小时。** `ledger` 变为 unhealthy，`up -d` 失败退出，但不会重启，`ide` 和 `ledger` 还在，页面仍可用；账本建好后要再跑一次 `up -d`，完成页会提示。Ctrl-C 也一样。
- **等待期间谁能设置。** `ide` 端口只绑 127.0.0.1，有上面的来源检查。本机其他进程仍可以先取令牌再提交，这与现在的 Paper 相同。
- **目录属主。** 目录不存在时 Docker 会以 root 创建，服务写不进去，所以 `mkdir` 那行要包含 `dolthub`。

## 验证

写代码前的验证已在临时仓库 `vincent/trade-first-run-probe` 上做完（2026-11-07），用一把临时 key，测完已从账号移除。结果：

1. **真实空仓库的 `dolt clone` 报错：** 匿名和未登记的 key 都得到 `clone failed; remote at that url contains no Dolt data`，与 `EMPTY_COPY` 一致。所以未登记的 key 也会被当成空仓库，必须先跑 `creds check`。
2. **`dolt creds new` 的 key：** 登记前推送失败（rc=1），仓库仍为空；登记后 `creds check` 报 `Success. User: vincent`。
3. **空仓库开新账本：** 真实 `service.bootstrap`（kind active，目录全部隔离）走完了 clone、判定为空、新建、发布。之后匿名 clone 读到 55 个 chunk、29 张表，`ledger_schema.version` 为 3。
4. **已有账本的仓库：** 新目录再跑一次 bootstrap，clone 后直接启动（rc=0）。
5. **写错仓库名（key 已登记）：** `BOOTSTRAP_FAILED`（`PermissionDenied`），不留下任何东西。

实现后在隔离目录用真实命令和 Dolt 2.7.2 跑过（2026-11-07）：

- 浏览器里走完未登记 key 被 DoltHub 拒绝、仓库不可读后回到第 1 步、改好重试、完成、进入 IDE。
- 账本服务没起来时打开页面，服务起来后 `hub` 自己恢复。
- 停止服务（SIGTERM）后不留下目录，key 留着。
- 真实 DoltHub 上的新账本：页面填 `vincent/trade-first-run-empty`（新建的空仓库），登记临时 key（测完已移除），走完查 key、读取、判定为空、新建、发布，读到 IDE 的第一屏。之后匿名 clone 读到 29 张表，`ledger_schema.version` 为 3，头部和本地相同。用的是本机 Dolt 2.7.2 和分支代码，不是 CI 镜像。
- 真实 DoltHub 上的接续路径：页面填 `vincent/trade-first-run-probe` 的页面地址，把页面给的公钥登记到账号（临时 key，测完已移除，之后 `dolt creds check` 报 `key not found`），走完查 key、clone、启动，读到 IDE 的第一屏。`origin` 指向该仓库；完成后 POST 不再起作用；再次启动不开设置端口，直接服务。用的是本机 Dolt 2.7.2 和分支代码，不是 CI 镜像。

仍未验证：

6. 能读不能写的 key：`dolt push` 没有 dry-run（Dolt 2.4.2 的 `--help`）。除非 DoltHub 另有接口，否则接续已有账本时的写权限问题只能在首次写入时暴露，页面的失败表按这个写。
7. ~~仓库有内容但不是账本时缺表的异常。~~ 已由 `tests/ledger/test_service.py` 用真实 Dolt 覆盖：报 `BOOTSTRAP_FAILED`，什么都不留。

实现时验证：

8. `ide/agent` 在没有账本时能否启动（读代码：启动时不碰账本；未实跑。这个 worktree 没装它的依赖）。
9. 在一台新机器上用 CI 构建的镜像走完整个流程。

## 不做

- 不做账号和注册：形态是自托管单操作者（20261107-101）。
- 不做设置页：建好之后改配置仍是改文件（20261107-131 的其余部分另算）。
- 不做私有模式，也不验证仓库是否公开（20261107-111）。
