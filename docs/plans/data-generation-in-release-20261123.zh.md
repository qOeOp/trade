# 数据代际随版本发布自动切换（2026-11-23）

> 同日修订：仓库与分支的安排、切换的触发和建库由
> [`version-line-branches-20261123.zh.md`](version-line-branches-20261123.zh.md) 取代：只有一个研究仓库，每个版本线
> 一个分支，升线（即使 schema 没变）就换代，不再有 `<基名>-g<N>`、API token 和建库。下文其余的切换步骤照旧。
> 其中“每个版本线一个分支”又由 [`main-is-the-ledger-in-use-20261123.zh.md`](main-is-the-ledger-in-use-20261123.zh.md)
> 取代：`main` 始终是在用的账本，旧线在升线时归档为同名分支。

依据：用户 2026-11-23 的决定（下列“用户决定”逐条记录，是本设计的授权）。在此之前，换一代账本是
`deploy/remote/README.md` “Starting a new data generation” 的 6 步手工清单：工作站建 DoltHub 仓库与新账本，服务器归档
旧数据、改 `TRADE_RESEARCH_ORIGIN`、从版本的 checkout 起服务。本记录把它换成代码：任何版本的发布，所有者只做一件事，
`gh workflow run release.yml -f version=X.Y.Z`。

## 用户决定（2026-11-23）

1. 代际由代码决定，不由人决定：一个版本的数据库 schema 代际（`ledger/db.py` 的 `SCHEMA_VERSION`，以及同一 Dolt
   服务上 Paper 库的 `PAPER_SCHEMA_VERSION`）与正在运行的不同，就是代际切换；否则账本不动。发布工作流拒绝不相称的
   版本号：0.x 时，相对上一个发布标签改了 schema 代际的补丁号升级（0.5.1→0.5.2）被拒，必须升次版本号；1.0 起必须升
   主版本号。
2. 所有者启动 `release.yml` 就是随后自动化建立并切换活动账本的授权（AGENTS.md 那一行写明这个例外，其余不变）。
3. 旧数据归档（同一文件系统内改名进归档目录），只保留上一代的归档，更早的自动删除。Mac 与服务器同一规则。
4. Mac 一侧仍由 Agent 运行 `deploy/update.sh`（Paper 空闲时的常设授权），不加 launchd 定时器。所以 update.py 在目标
   版本的代际与 Mac 账本不同时自己完成切换。
5. 服务器在代际切换时不失败、不等人：等到 (a) 新一代的公开 DoltHub 副本有数据（Mac 已发布）且 (b) Paper runner 与
   Live 都空闲（Live 永不被自动停止），然后停 ledger 与 market-import、归档、用该版本自己的定义起服务、检查，并在同一
   或下一个 tick 继续发布。等待期间发一条 Telegram 通知，同现有的等待。
6. 每一代的 DoltHub 仓库名由代码推出（基名加 `-g<N>`），不再每代改 env 文件。
7. 不为验证去建 DoltHub 仓库或推送任何东西。

## DoltHub 仓库能否由推送自动创建（调研结论）

不能用现有凭据做到：

- DoltHub 自己的文档只给两条建库路径：网页 “Create database”，或 `POST https://www.dolthub.com/api/v1alpha1/database`
  （`ownerName`、`repoName`、`visibility`），后者要求 `authorization: token <API token>` 头，即在 DoltHub 设置里另建的
  API token（<https://www.dolthub.com/docs/products/dolthub/api/v1alpha1/databases>）。入门文章写明推送前“需要先在
  DoltHub 上建一个库来推”（<https://www.dolthub.com/blog/2025-03-26-dolt-basics-push/>）。
- Dolt 客户端在 `GetRepoMetadata` 里带上 `ClientRepoFormat`（`go/libraries/doltcore/remotestorage/chunk_store.go`），
  Dolt 自带的 `remotesrv` 用它 `getOrCreateStore`（`go/libraries/doltcore/remotesrv/grpc.go`）；但那是 `dolt sql-server`
  的远程服务，不是 DoltHub 的 `doltremoteapi`（闭源），没有任何文档说 DoltHub 会因推送建库。
- 主机上的 `dolt login` 凭据是 JWK 推送密钥，不是 API token；两台主机都没有 API token。

一个仓库是否存在、是否已有某代账本，不需要凭据就能读：DoltHub 的公开 SQL API
`GET https://www.dolthub.com/api/v1alpha1/<owner>/<repo>/main?q=...` 对公开库有数据时答 `Success` 和行，对不存在的库答
`query_execution_message: "no such repository"`（2026-11-23 用公开库 `dolthub/us-housing-prices` 与一个不存在的库各读
一次确认，只读）。

所以设计是：仓库存在且没有账本时，账本首启照旧建新账本并发布（Dolt 对空库的克隆报
`remote at that url contains no Dolt data`，`ledger/service.py` 的 `EMPTY_COPY`）；仓库不存在时，Mac 的 update.py 用
所有者放在 `TRADE_DOLTHUB_TOKEN_FILE`（缺省 `$TRADE_DATA/dolthub-token`）的 API token 建公开空库，token 只在那一个请求
里读，不打印；没有这个文件就在改动任何东西之前拒绝，并写出要建的仓库全名。剩下的一次性所有者动作二选一：建一个
DoltHub API token 存到那个文件（之后每一代全自动），或每次代际切换前在网页建好空库 `<基名>-g<N>`。

## 设计

### 代际与 origin（产品代码，`ledger/publish.py` `research_origin`）

- DoltHub 地址去掉结尾的 `-g<数字>` 再加 `-g<SCHEMA_VERSION>`；`file://`（隔离检查）原样。`ledger service run` 与
  `ledger mirror` 的 `--research-origin`，以及首启页面上填的仓库（`ledger/first_run.py` `origin_of`）都过这个函数，
  所以 `TRADE_RESEARCH_ORIGIN` 只写基名，每个版本自己的代码决定连哪个仓库；env 文件不随代际改。镜像的
  `REMOTE_MISMATCH` 比较的也是推出的地址。
- 第一个带这条规则的版本（0.5.2）本身就在两台主机上触发代际切换（主机仍是第 1 代），所以推出的地址与新账本一起
  出现，不会让一个已有的镜像因 `REMOTE_MISMATCH` 起不来。
- Paper 库只在本地，不上 DoltHub。只有它的代际变时研究 origin 不变：照样整体归档，镜像与工作站都从同一个仓库重新
  克隆研究账本（有意统一处理，不单独删 Paper 库）；工作站为此要求旧账本先发布成功，否则拒绝。
- 市场目录没有格式代际（`market/` 没有版本常量，0.5.0 的更改说明写明存储文件不变），所以不归档、不重建；将来引入
  市场格式代际时按同一模式加。`TRADE_MARKET_ARGS` 不动：它是部署的范围设置，与代际无关。

### 发布工作流（`.github/scripts/release-generation.py`）

`release.yml` 在版本号检查之后、改版本号之前运行它；合并后的提交（可能带上后来的 `main` 提交）在打标签前再跑一次。
它用 `ast` 读最新发布标签与该提交的 `ledger/db.py` 两个常量（不导入模块）；不同而新版本与上一个版本的主、次号相同
（0.x）或主号相同（≥1.0）就失败，说出变化和应发的版本号。

### 共用部分（`deploy/generation.py`）

- `version`：在版本服务镜像里（无网络、只读）跑它自己的代码，得到 origin 和两个代际，主机代码不重复这条规则。
- `probe`：上面的公开 SQL API 读 `ledger_schema.version`。只认明确的答复：一行版本是有数据；`no such repository` 是
  不存在；`table not found: ledger_schema` 或 `branch not found`（2026-11-23 在公开库上读到的原文）是空库。其它任何
  答复或不答都是 `OriginUnreadable`，从不猜（把未知答复当空库会跳过建库，账本首启就会 `BOOTSTRAP_FAILED`）。
- `archive`/`prune`：在版本服务镜像里以 root（只加 `DAC_OVERRIDE`）、无网络运行（`python -m deploy.generation`），
  只挂 `$TRADE_DATA` 一个绑定挂载。归档目录是 `$TRADE_DATA/archive/<UTC 时间>-<版本前 12 位>/`，与数据同一个挂载、
  同一个文件系统，只用 `os.rename`，移动前比对 `st_dev`，不同就停。工作站的卷（写入账本本身）先写 `.partial` 再改名
  成 tgz；服务器的卷只是旧一代 DoltHub 仓库的镜像，不打包，直接删。每一步都可重入。
  `prune` 只删本代码命名格式的其它归档，从不删日志里的那个，也不碰旧手工清单留下的 `/srv/trade-archive`。

### 工作站（`deploy/update.py` `Cutover`）

在解析出目标版本的镜像之后，Paper 不空闲时照旧先拒绝：

1. 账本容器存在但没在跑就拒绝（否则比较不了代际）。在跑时，用目标版本的服务镜像对 `research` 与 `paper` 各跑一次
   只读的 `ledger service check`（与服务器相同：Paper 的 profile 卷、项目网络、账本容器的 UID:GID）。`SCHEMA_MISMATCH`
   即代际切换；其它失败报错。代际相同时，在账本容器里用它自己的 profile 读 `ledger service status` 的 `remote`
   （与发布同一条路径，不读凭据），与版本代码推出的 origin 不同就拒绝：否则服务器会一直等那个仓库。`--check` 只报告。
2. 改动任何东西之前（env 文件写新镜像也在这之后）：在旧账本容器里 `ledger publish`，失败就拒绝，不论哪个库换代
   （旧一代的公开副本必须完整，之后本地归档才可删）；由版本的代码推出新 origin 并探测；有别的代际的账本就拒绝；
   不存在就用 token 建库，没有 token 拒绝；env 没写 `TRADE_RESEARCH_ORIGIN` 时用旧账本发布到的仓库做基名，最后写入
   一次。然后写日志 `$TRADE_DATA/deploy/generation.json`（版本、归档名、步骤）。
3. `archiving`：停项目全部服务、删 ledger 容器、归档、删卷，记为 `archived`。
4. `archived`：只起 ledger（`up --wait ledger`），它的首启从推出的 origin 建新账本并发布或克隆；之后把归档里的
   `market.json` 放回 `ledgers/`（首启拒绝有 profile 的目录，所以先起 ledger 再放），删其它归档、删日志，然后照常
   `up -d` 其余服务。
5. 日志在时（中断），下一次 update 从记录的步骤继续，不再比较代际（账本可能没起来），已归档的不会再归档。

工作站没有 Live 控制，所以只看 Paper。

### 服务器（`deploy/generation.py` `Generation`，由 `Release.apply` 在原来只会等待的检查处调用）

1. 版本的检查有 `SCHEMA_MISMATCH` 时先看条件，任一不满足就等（不标失败，一条通知，下个 tick 再看）：env 有
   `TRADE_RESEARCH_ORIGIN`；没有 Paper runner 容器；新一代仓库已有该版本代际的账本。
2. 条件满足：`github.ensure(target)`，准备候选的 Live 快照，冻结 Paper 全部写入并排空生命周期锁（同 `Follow`），再
   确认经路由的 Web 列表里没有进行中的 Paper 操作、仍无 runner；在 Live 账户锁内确认 Live 空闲（忙就等，绝不停 Live）
   并在整个切换期间持锁；写日志（`/var/lib/trade-release/generation.json`：版本、服务镜像、归档名、步骤、
   market-import 是否在跑）。
3. 每个 tick 只走一步，使每个 tick 都远在 `trade-release.service` 的 `TimeoutStartSec`（75 分钟）之内（测试按单元
   文件核对：每步命令的超时总和不超过一半）。`archiving`（本 tick）：停 market-import 与 ledger、删 ledger 容器、改名
   归档（只改名，限 10 分钟）、删卷，记为 `archived`。`archived`（下一个 tick，冻结 Paper 写入）：按版本自己的
   compose 定义 `up --wait ledger`（不加 `--force-recreate`：续做时已起的首启只会被等待，不会被打断），market-import
   原先在跑就再起；再跑一次检查，必须不再 `SCHEMA_MISMATCH`；记为 `started`。`started`（再下一个 tick）：删其它归档，
   记为 `done`。发布在之后的 tick 进行（读到的受保护容器等事实都是新的）。发布单元只能写 `/var/lib/trade-release`，
   文件操作都在容器里做。
4. 中断与续做：`Release.tick` 在交接之后、任何恢复（会解冻 Paper、会读账本容器）之前先按日志走下一步。停服务的
   `archiving` 步续做前取与第一次相同的保持：冻结 Paper、排空、无进行中的操作与 runner、在经路由 Web 的 Live 账户锁内
   确认空闲；不满足就等（通知），不停任何东西。
5. 回滚：日志为 `started` 或 `done` 时，旧版本读不了新账本，所以失败的发布回滚到旧版本时不等它（Web 与 Paper 控制器）答健康，
   仍然标记失败；日志留到某个版本的 Web 发布提交后删除。
6. 交接：服务器跑的是 0.5.1 的控制；0.5.2 被接纳后，0.5.1 的 tick 先交接（`Release.tick` 先 `handoff`，它复制
   `deploy/*.py`，`generation.py` 只用标准库），第二个 tick 在 0.5.2 的控制下执行切换，0.5.1 的等待代码不参与。

### 不做的

- 不自动停 Live，不自动停 Paper 运行：等它们结束（通知说明）。
- 不改 env 文件里已有的值，不碰 `TRADE_MARKET_ARGS`。
- 不加账本字段；`generation.json` 是部署状态（同 `transaction.json`），不是研究数据。

## 设计评审（2026-11-23，独立 Plan 子 agent）

采纳的发现：回滚在切换后必然失败（加宽松回滚）；tick 先恢复会解冻 Paper、读已删的账本容器（续做提到恢复之前）；
无步骤的续做会把新一代归档（加步骤，不强制重建）；推出地址与已有镜像不符（第一个带规则的版本本身切代际）；首启页面
绕过规则（`origin_of` 也推出）、env 为空（用旧账本发布到的仓库）；runner 检查与新启动有竞争（冻结、排空、再查、持
Live 锁、先 `ensure`）；同 tick 接着发布用的是旧事实（改为下个 tick）；跨挂载改名会复制（只挂 `$TRADE_DATA`、只用
`os.rename`、比对 `st_dev`）；`dolt clone` 探测太重且要可写 HOME（改用公开 SQL API，同时核对代际）；工作流只查了
运行时的 HEAD（合并后的提交再查一次）；工作站：停着的账本要拒绝、任何情况先发布、先只起 ledger 再放回
`market.json`、token 不打印。

## 复审修正（2026-11-23，协调者独立评审）

旧账本发布失败一律拒绝（不只 Paper 换代）；拒绝都在 env 文件写新镜像之前；探测只认明确答复；代际相同但发布地址
与推出的不同就拒绝；服务器每个 tick 一步、改名归档限时、卷不打包（可从旧一代仓库重新克隆），使每个 tick 远在单元
超时之内；续做停服务的一步前重新取 Paper 与 Live 的保持。每条都有测试，并逐条做过反例（去掉修正，测试失败）。

## 检查

- `tests/deploy/test_generation.py`：等待的每个条件（不动任何东西、一条通知、Paper 写入不留冻结）、完整切换（归档内容、
  卷不打包、`dolt/paper` 留空、市场不动、只保留最新归档、手工目录不删）、每个 tick 一步且在单元超时一半之内、中断后
  逐步续做、续做归档前 Live 或 Paper 忙就等、切换后仍不读的版本、日志格式、API 的明确答复与其它答复。
- `tests/deploy/test_update.py` 另有：任何发布失败都拒绝、未知的 DoltHub 答复不建库、代际相同而发布地址不同就拒绝、
  `MainTests`（拒绝时 env 文件与定义目录都不变）。
- `tests/deploy/test_update.py` `CutoverTests`：只认 `SCHEMA_MISMATCH`、完整切换与顺序、建库要 token 且不打印、改动前的
  各种拒绝、基名取自旧账本、续做。
- `tests/deploy/test_release.py` `GenerationTests`：切换代替发布、宽松回滚（反例：不宽松时回滚保留日志），tick 先续做。
- `tests/test_release_generation.py`：版本号规则。
