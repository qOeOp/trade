# 研究图谱：目标值入账、数据公开到 DoltHub、网页做成 Docker 服务

2026-10-25 用户决定：

1. 网页只是 Dolt 数据的展示，它要用的东西必须在 Dolt 里。两个研究目标（最大回撤上限、年化收益下限）入账，
   每条研究路线都能绑定，并有一个默认值。这推翻了 10-11「账本只存状态，不存目标」的决定。
2. 所有数据公开，不存在私有存储：研究账本和市场库都推到公开的 DoltHub。
   10-25 已建好两个空的公开库：[`vincent/trade-research`](https://www.dolthub.com/repositories/vincent/trade-research)
   和 [`vincent/trade-market`](https://www.dolthub.com/repositories/vincent/trade-market)；本机 `dolt login` 已通过（账号 `vincent`）。
3. 研究图谱网页做成 Docker 服务，从 Dolt 读数据渲染，不再一次性生成到 `/tmp`。

本文是动手前的方案，已经过两轮独立子代理审阅（记录见文末）。同日用户又确认两件事：账本默认目标为回撤 0.15、
年化 0.20；授权第 4 节的 4a（环境故障时 `research graph` 拒绝出图）。

## 起因与实测

- 一次性页面把 `view.json` 嵌进 HTML，渲染器改了之后旧页面不会更新（10-25 打开的页面不含 #1671）。
- 目标值只在路线说明的自由文本里。`research graph` 要靠 Agent 读出来再传参数，网页服务拿不到。
- `research graph` 一次 71–84 s：约 50 s 是 44 次比较重复读同一份市场日收益，约 21 s 是带固定种子的块自助法。
  布局加渲染 0.4 s。
- 研究账本 83 MB，市场库 6.8 GB。取图时的比较要读市场日收益，所以两个库都要读。
- 公开后能被任何人读到的内容：账本里每个版本的完整策略源码、判断、假设和预测；作为来源原件存入的第三方论文
  （19 个 PDF，共 29 MB；另有 21 个 HTML 页面）；从 Binance 公开归档推算的市场数据。第三方论文和市场数据的
  转发条款没有核实，由用户判断。账号密码不在数据库里（`service.json`、`privileges.db` 在数据目录之外），
  提交作者是 `research-ledger@example.invalid`。

## 1. 目标值入账

### 记录

新表 `line_target`，只追加：

| 列 | 说明 |
|---|---|
| `target_id` | 自增主键 |
| `line_bundle` | `research-line-…`，外键到 `evidence_bundle`；`NULL` 表示账本默认值。`CHECK (line_bundle IS NULL OR line_bundle LIKE 'research-line-%')` |
| `max_drawdown` | `DECIMAL(7,4)`，`CHECK (max_drawdown > 0 AND max_drawdown < 1)` |
| `annual_return` | `DECIMAL(7,4)`，`CHECK (annual_return > 0)` |
| `supersedes` | `BIGINT NULL UNIQUE`，外键到本表，指向同一范围（同一路线，或默认值）当前生效的那条 |
| `op_id`、`created_at` | 现有写入协议；`created_at` 由 `BEFORE INSERT` 触发器填写，与其他表一致 |

为什么要 `supersedes`：`op_id` 由写入内容派生，同样的内容再写一次会被当作重放。没有它，0.15 → 0.20 → 0.15
时第三次写入会被吞掉。把 `supersedes` 放进写入内容，每次改动就都是新记录，「最新」也就定义成链的末端，
不靠时间排序。

读取规则（在某个账本提交上）：取该路线链末端的记录；没有就取默认值链的末端；都没有就是「未设目标」。
读出时附带来源（`line` 或 `default`）和生效记录的 `target_id`。数据库返回的是 `Decimal`，进入 `graph.json`
前转成浮点数。

### 为什么现有结构表达不了（独立审阅已确认）

- 路线记录 `research-line.json` 只追加，选线时就固定了，现有路线绑不上，以后也改不了。
- `judgment` 是 Agent 的研究判断：正文是自由文本，并绑在 `based_on_commit` 上。目标值是用户的声明，要结构化数值。
- 路线说明是自由文本，程序读不出来，这正是现在的问题。

### 写入与使用

- `line select` 加 `--max-drawdown/--annual-return` 两个参数，目标和路线在同一个事务里写入，新路线不会有
  落到默认值的空档。不给目标时，新路线使用默认值。
- `line targets --max-drawdown … --annual-return … (--line BUNDLE | --default)`：改目标。已结束的路线拒绝，
  因为它的标签就是终态快照。
- 目标值仍是用户的决定，Agent 只照用户的话写（AGENTS.md「需要用户授权」一节不变）。
- `research state` 输出生效的目标及其来源。`research graph` 从账本读目标，去掉原来的参数；重构期不兼容旧用法。
- skill：research-start 选线时问目标，经 `line select` 写入，不再写进说明。research-graph 不再读说明。
  research-round 从 `research state` 读目标。research-start 的评测 `start-sets-goal` 同步改。
- 目标值仍只用于读报告，不参与候选资格筛选。

### 迁移

- 不升 schema 版本（仍是 3），只加表。升版本要改 `ledger_schema` 那一行，整本审查会永远报 ROW_CHANGED；
  `READABLE_VERSIONS` 也会让迁移前的提交、`line/…` 标签全部读不了。读取时，某个提交上没有这张表就视为「未设目标」。
- 新增管理员命令 `ledger upgrade`，照 `market upgrade`（`db.upgrade_market`）的样子写：工作集干净，只加表、
  触发器和授权，一次提交并跑提交校验组。
- 迁移后：给当前 EMA 路线写一条路线目标（回撤 0.15、年化 0.20），出自它说明里用户的原话
  「最大回撤不超过15%，最低年化收益20%」。
- 再写一条账本默认值：回撤 0.15、年化 0.20（用户 10-25 确认）。

## 2. 数据公开到 DoltHub

不用 Dolt 的自动复制（`dolt_replicate_to_remote`）。理由：

- 它对整个服务生效，研究库、市场库和隔离测试库共用这一个服务。
- 服务配置只在创建时写一次。
- 异步推送失败了没人知道。
- 是否推送标签、是否强推，都没有核实。

改为显式发布：

- 新增管理员命令 `ledger publish` 和 `market publish`，照现有 `_sync_backup` 的样子写：
  - 把 main 和标签普通推送（不强推）到 `origin`，再核对远端头与本地头相同。
  - 推送被拒（说明历史被改写过）就拒绝并报出来，绝不强推。
  - 只对活动库开放，隔离库和临时库拒绝。
- 写入后自动发布：`python -m cli.main` 的写命令在事务提交成功后调用一次发布。
  - 发布失败不回滚写入，命令输出里报 `publish_failed`，可以手动重跑 `ledger publish`。
  - 市场库在每次 `market import` 后同样处理。
- 凭据：服务以 `DOLT_ROOT_PATH=<服务目录>/home` 运行，用户的 `dolt login` 写在 `~/.dolt` 里，服务看不到。
  安装步骤要把凭据放进 `<服务目录>/home/.dolt`，再由管理员对每个库执行一次 `DOLT_REMOTE add origin`。
- 整本审查不加新检查：加检查等于收紧审计，要用户授权；发布命令自己已经同步核对了远端头。
- 已有的 `dolt_backup` 本地备份保留。AGENTS.md「持久研究数据只在 Dolt 账本（及其 `dolt_backup`）」一句，
  改为也包括公开的 DoltHub 副本。
- 待实现时实测：6.8 GB 市场库首次推送的耗时；DoltHub 公开库有没有大小限制。

## 3. Docker 网页服务

### 读哪份数据

容器读 DoltHub 上的公开副本，不连宿主机。这样网页就是公开数据的视图，放在哪台机器上都能跑。代价是它
落后本地一次发布；写命令会自动发布，正常情况下只落后几秒。

### 容器里有什么

镜像包含：

- Dolt 2.4.2 和 `git`。
- 仓库在构建提交上的副本，带 `.git`。`availability.check_identity()` 要跑 `git rev-parse HEAD`，
  缓存键的代码版本也取这个值。
- `uv sync --frozen` 装好的 Python 环境，以及构建时就建好的网页。运行时不跑 npm。

数据放在 Docker 卷里。入口脚本：

1. 第一次启动时从 DoltHub `dolt clone` 两个库，以后复用。
2. 起容器内的 Dolt sql-server，并 `SET PERSIST dolt_commit_verification_groups = 'commit'`。否则产品的每次
   连接都会被 `COMMIT_CHECKS_DISABLED` 拒绝。
3. 建一个只有 SELECT 的 reader 账号。写 `service.json` 时账号里只放 reader，再写一个 `kind: null` 的账本
   profile 和一个市场 profile。产品用写账号连接会直接失败。
4. 起 `graph.py serve`。容器内监听，宿主机只发布到 `127.0.0.1:8765`。

### 什么时候更新

2026-10-25 用户追加决定：页面打开期间自动更新，不用手动刷新；取图要快到跟得上。目标是 Codex 写入后
尽快跟着变；镜像由 CI 构建。延迟预算：写后发布几秒（首次全量推送 14 秒，之后是增量）、查头最多 5 秒、
取图 6–7 秒，合计约 10–20 秒。

不用 Dolt 的 read replica 模式：它在每个事务开始时拉取，而产品读者是自动提交，一个语句就是一个事务，
取一次图约 2.6 万次查询。也不用推送通知：Dolt 没有 LISTEN/NOTIFY；binlog 主库还是预览功能，只复制一个
分支，断线后补不回漏掉的事件；DoltHub 的 `on_push` webhook 要公网能访问的地址，本机容器收不到。

改为服务端定时查头：

- 服务每 5 秒对研究库执行一次 `CALL DOLT_PULL('origin', 'main', '--ff-only')`。
  - 由镜像里的 `dolt` 命令行以容器内 root 账号连本容器的 sql-server 执行（服务只用标准库，不装 pymysql）。
    这是 DoltHub 公开副本的只读镜像，不是活动账本；第 7 步同时在 AGENTS.md 写明这一例外。
  - 实现时核实：拉取是否带回 `line/…` 标签，以及合并时是否跑提交校验组。
  - 同一时刻只跑一个；上一次还没结束就跳过这一轮。远端没有新提交时只交换引用，不传数据。
  - 快进失败（说明 DoltHub 历史被改过）就停下并在页面上报错，绝不重置。
  - 没有页面连着（下文的 SSE 连接数为 0）时不查；连接数从 0 变 1 时立刻查一次。
- 头变了，后台为每个连着的页面的键（路线、`since`）各取一次图。一轮回放连续产生多个提交时只取最新的：
  取图中又来了新头，取完这一张就接着取最新的，中间的跳过。
- 取图前先确认路线指向的市场提交容器里已有，没有就先拉市场库。否则市场读取会退化成缺项（`UNKNOWN_REF`
  不是环境故障码，4a 不拒绝）。
- 改结构代数的提交在取图途中快进进来，剩下的连接会报 `SCHEMA_MISMATCH`，这一张图失败，下一轮在新提交上重取。
- 取图时用 reader profile，并显式传 `--ledger=…` 和解析好的 `--at=<完整哈希>`。取图期间发生快进也无妨，
  因为固定提交的修订库不会变。
- 这是一个只读视图的刷新循环，不是调度器：不写库，不排研究任务。
- 实现时实测：每 5 秒拉取一次 DoltHub 有无限流。

### 并行取图

一次取图约 25 秒，几乎全是各次比较各自重跑成对块自助法与归因（10-25 在活动账本上实测 64 次比较，
共 27 秒）。比较按 AGENTS.md 不入账（能从已存数据推出），所以每张图都从头算。

原先考虑按「读集」缓存比较结果：比较时记下每条账本查询及其结果，新提交上重放查询，结果全同就复用。
独立审阅指出它不划算也不安全：

- 重放要搬的数据和重算一样多，只省下自助法；
- 每次比较都扫全部源码审查，而 research-round 每轮正式回放前都会记一次审查，所以每轮那个提交上全部
  比较都失效；
- 连接时的 `USE db/<旧提交>` 若被一起重放，会永远命中；市场读取失败会被当成结果缓存。

改为把一张图里互不依赖的比较放进进程池并行算，不存任何状态：

- 在 `research_graph` 内，用 `concurrent.futures.ProcessPoolExecutor` 跑全部 `_comparison`。每个工作进程
  装一份按窗口复用的市场读取（4b 的 `_reusing`），并把它记下的环境故障交回主进程，4a 照旧拒绝出图。
- 进程数默认 `min(8, CPU 数)`，`--workers` 可改；`--workers=1` 就是现在的顺序取图。
- 结果按原顺序合并，输出与顺序取图逐字节相同。
- 10-25 实测：64 次比较顺序 27.1 秒，4 进程 8.0 秒，8 进程 5.1 秒，12 进程 4.7 秒，结果均与顺序一致。
  整张图预计 6–7 秒，实现时实测。
- 为什么是产品代码：无人值守的网页服务要在十几秒内跟上，Agent 在会话里做不到；不加存储
  字段，不加缓存状态。
- 验收：在测试账本和活动账本上，`--workers=1` 与 `--workers=8` 的 `graph.json` 逐字节相同。

### 服务、缓存与页面

- `graph.py serve` 只用标准库，以子进程调 `uv run --frozen python -m cli.main`：`ledger sql` 读头提交，
  `research graph` 取图。服务不导入产品包。参数一律写成 `--name=value`，不经 shell。
- 网址：`http://127.0.0.1:8765/?line=&since=&at=#<version>`。`since`、`at` 先解析成完整哈希。给了 `at`
  的页面是固定版本，不自动更新。
- 图缓存：进程内存，LRU 8 条。键是 `(库名, 完整 ledger_commit, line 或 "current", since 完整哈希, 镜像构建提交)`。
  只缓存成功的结果。
- `/api/view` 返回 200（view）、202（取数中或排队中）或错误（CLI 的拒绝 JSON）。同一个键只取一次；全局同时只跑
  一个取数任务。
- `/api/events`：Server-Sent Events。推送 `{state: fetching|computing|ready|error, ledger_commit}`。
  - 每次新连接先发一份当前状态（EventSource 断线会自动重连，漏掉的 `ready` 靠它补上）。
  - 每 15 秒发一次心跳；写失败就关掉这条连接，连接数才能真正降到 0。
  - 每个客户端一个只留最新状态的队列，慢客户端不会卡住查头的线程。
  - 用多线程服务；每个标签页只开一条 SSE 连接。
- 页面：
  - 嵌入的数据为 `null` 时去拉 `/api/view`，并显示取数中、排队中或错误。
  - 同时订阅 `/api/events`；收到 `ready` 且提交变了，就拉新的 view 原地替换。当前选中的版本、打开的工具
    窗口和视图位置保持不变；选中的版本在新图里没有了才回到默认。
  - 一次性 `render` 出的页面行为不变。
- 数据本身公开，但仍要防止别的网页借本机浏览器反复触发取数：校验 `Host`，拒绝 `Sec-Fetch-Site: cross-site`，
  不发 CORS 头，不开写接口。

### 镜像在哪构建

照 `trade-runtime` 的做法：新增 workflow，合进 main 且相关路径有改动时由 CI 构建，推到
`ghcr.io/qoeop/trade-research-graph`，打 `main` 标签，`org.opencontainers.image.revision` 写构建提交；
PR 构建打 `pr-N`。compose 用 `main` 标签，更新就是 `docker compose pull && docker compose up -d`。
不在本机构建：缓存键和资格检查的代码版本取镜像里的提交，CI 构建保证它就是 main 上的那个提交。
不用 GitHub Releases：产品没有版本号，main 就是当前版本。

## 4. 取图要修的两处

- **4b**：在 `research_graph` 内用 `seams.use` 按 `(市场库, 提交, 规则, 起止)` 复用市场日收益，只在这一次
  调用内有效，不影响其他命令和测试替身；调用方只读结果，返回副本；异常不缓存。预期从约 75 s 降到约 25 s。
  验证方法：改前改后对同一提交取图，`graph.json` 逐字节相同。
- **4a（用户 10-25 已授权）**：账本或市场库连不上时，`research graph` 现在会静默出一张缺比较的图，服务一缓存就一直给
  错图。改为只在 `research_graph` 里，遇到 `LEDGER_UNAVAILABLE`、`LEDGER_PERMISSION`、`SCHEMA_MISMATCH`、
  `MARKET_UNREACHABLE` 就拒绝出图。无对照、不可比这类比较事实照旧。

## 交付顺序

1. `docs(plans)`：本文。
2. `perf(report)`：4b，附 `graph.json` 逐字节一致的证据。
3. `feat(ledger)`：`line_target`、`ledger upgrade`、`line select/targets`、`research state/graph` 读目标、
   相关 skill 与评测。
4. `fix(report)`：4a。
5. `feat(ledger)`：`ledger publish` / `market publish`、写后自动发布、AGENTS.md 那一句。两个公开库
   和 `dolt login` 已就绪。（#1700 已合并。10-25 首次发布实测：装好密钥后要重启一次服务才能推送，
   研究账本首推 14 秒。）
6. `perf(report)`：并行取图（`research graph --workers`），附 `--workers=1` 与 `--workers=8` 逐字节一致的证据。
7. `feat(research-graph)`：镜像与 CI 构建、compose、`graph.py serve`、SSE 自动更新。验收：`docker compose up`
   后打开 `http://127.0.0.1:8765/`，能看到当前路线的图；本机写一条新记录，不刷新页面，20 秒内图跟着变。

## 不做

- 私有存储、私有 DoltHub 库。
- Dolt 自动复制、read replica 模式。
- 整本审查里新加 DoltHub 检查。
- 任何缓存落盘：图只放进程内存，比较结果不缓存。
- 页面上的路线切换器、提交切换器（用网址参数）。
- 改自助法。

## 独立审阅记录

**第一轮（服务方案）**：有条件通过。已按意见修改：

- 环境故障会被吞进图里（改为 4a）。
- 工作树有改动时缓存仍会给旧图（容器里改用镜像构建提交作代码版本）。
- `since` 是分支名时会漂移（改为先解析成完整哈希）。
- 市场日收益复用只在单次调用内有效（4b）。
- 构建加锁，补充若干安全细节。

**第二轮（目标入账、DoltHub、Docker）**：有条件通过，`line_target` 作为新存储字段的理由成立。已按意见修改：

- 同值重写被当作重放：加 `supersedes` 链。
- 升版本会让审查永远报错、旧提交读不了：改为不升版本，缺表即视为未设目标，并新增 `ledger upgrade`。
- 默认值数值属于用户决定：只迁移当前路线说明里用户的原话，默认值等确认。
- 审查里加 DoltHub 检查等于收紧审计：不加，改由发布命令同步核对。
- 自动复制和服务现状不符（凭据目录、只在创建时写配置、整服务生效、标签与强推未核实）：改为显式发布。
- 容器读不了：补提交校验组、`git` 与 `.git`、root 与 reader 分开。
- 第三方论文公开的风险：写进风险说明。
- 列定义、选线同事务写目标、容器 profile 写法、交付顺序：照办。

审阅另提出容器直接读宿主机 Dolt 更简单。没有采用：用户定了数据放 DoltHub，网页是公开数据的视图。

**第三轮（自动更新、增量取图、镜像构建）**：有条件通过。已按意见修改：

- 读集缓存收益小、风险大（只省自助法；每轮源码审查让全部比较失效；`USE` 旧提交会永远命中；市场失败
  会被缓存）：改为进程池并行取图，实测 8 进程把比较从 27 秒降到 5 秒，不存状态。
- `DOLT_MERGE('--ff-only')` 缺分支：改为 `DOLT_PULL('origin', 'main', '--ff-only')`，并写明由容器里的
  `dolt` 命令行执行，以及对 AGENTS.md 的例外。
- SSE 缺心跳、连接时补发状态、有界队列，后台取图只覆盖当前路线：照改。
- 取图前先确保市场提交已拉到，取图途中遇结构代数变更的处理：照改。
- `UNKNOWN_REF` 让图静默退化：改成拒绝要改拒绝检查，需用户授权；本方案靠先拉市场库避开，不改拒绝。
