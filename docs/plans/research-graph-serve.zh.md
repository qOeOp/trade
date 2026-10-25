# 研究图谱常驻只读服务

2026-10-25，用户决定：把研究图谱从「一次性生成到 `/tmp`」改为本机常驻的只读命令，不用 Docker；用只读账号读账本，
按账本提交缓存，目标值从网址传入。本文是动手前的方案，已经过一轮独立子代理审阅（结论：有条件通过，三处阻断），
下文已按审阅意见改过；第 4 节有一处需要用户授权。

## 起因

一次性页面把 `view.json` 嵌进 HTML。渲染器改了之后，旧页面不会自己更新：10-25 打开的
`/tmp/research-graph-ema/out/index.html` 是 10-24 18:57 生成的，不含 #1671 的改动。每次看图都要 Agent
重新跑三步（`research graph` → `check` → `render`）。

## 现状实测（10-25，活动账本 `digabm8f`，EMA 日线路线）

- `research graph` 一次 71–84 s，其中 99% 在 `report.comparison.compare`（64 次）：
  - 约 50 s 在 `report.seams._market_returns` → `market.read.daily_returns`：44 次比较读的是同一市场提交、
    同一窗口的同一份日收益（BTC 与等权篮子），每次都从市场库重读一遍（1232 次 `store.rows`）。
  - 约 21 s 在配对块自助法（`comparison._studentized` / `block_indices`），带固定种子，结果确定。
- 布局加渲染 0.4 s。
- `ledger sql "SELECT 1"` 走只读账号，0.36 s，输出带 `ledger_commit`。`--at` 经 `db.resolve_commit`
  解析：分支名、标签名或完整 32 位提交哈希，不认短哈希。
- `research graph` 走 `db.read_as_of`（reader 账号、固定到提交），市场日收益走市场库 reader 账号；整条取数链
  不碰写账号。除了账本提交、路线、`since`、目标值和产品代码，它不读时钟、Docker 镜像或别的本地状态
  （`availability.check_identity` 只调 `git rev-parse`，结果不进图）。
- 目标值不在账本里，只在路线说明的自由文本中；`research graph` 只把它们抄进 `line.targets`。

## 方案

### 1. 位置与分层

新增 `python3 services/research-graph/graph.py serve [--port 8765] [--ledger NAME]`，放在
`services/research-graph`，仍只用标准库。

服务不连数据库、不持有凭据、不导入产品包。它在仓库根目录以子进程调用两条现成的只读命令
（`uv run --frozen python -m cli.main …`）：

- `ledger sql [--ledger=…] [--at=REF] "SELECT 1"`：把头提交、`at`、`since` 都解析成完整哈希。
- `research graph [--ledger=…] [--line=…] [--since=<哈希>] [--max-drawdown=…] [--annual-return=…] --at=<哈希>`：取图。

页面上的图与一次性 `research graph` 是同一份文档，取数口径只有一处；产品包也不会反过来依赖
`services/research-graph`。不放进产品 CLI（如 `research graph --serve`），因为那样产品包要导入这里的布局和
渲染器，依赖方向就反了。

子进程用参数列表启动，不经过 shell，参数一律写成 `--name=value`，以 `-` 开头的值也只能是参数值。
`check_graph` 照一次性流程在布局前跑。子进程设超时，服务退出时结束子进程。

### 2. 网址与接口

只监听 `127.0.0.1`，只接受 GET。启动时打印 `http://127.0.0.1:<port>/…`，不用 `localhost`
（可能先解析到 `::1`）。

- `GET /?line=&max_drawdown=0.15&annual_return=0.20[&since=][&at=]#<version>`：返回构建好的页面，嵌入的数据为
  `null`。`#<version>` 仍归页面选中版本，所以目标值放在查询串里。省略 `line` 时取该提交上的当前路线。
  目标值由服务校验，必须是 0 到 1 之间的有限数；省略时照旧出图，`gaps` 会说明没有给目标。
- `GET /api/view?<同样的查询串>`：
  - `200` 加 view：命中缓存。布局每次请求现算（毫秒级），所以改了布局不用作废缓存。
  - `202` 加 `{ledger_commit, state: "extracting" | "queued", started_at}`：没命中，取数已开始或在排队。
  - `4xx/5xx` 加 CLI 的拒绝 JSON（路线不存在、参数不合法、账本连不上）。失败不缓存。
- 页面：嵌入数据为 `null` 时，用 `location.search` 请求 `./api/view`；收到 202 时显示「正在读取账本提交
  <短哈希>」或「排队中」，每 3 s 重试；收到错误时显示 CLI 给的拒绝码和说明。一次性 `render` 生成的页面行为不变。

页面 HTML 每次从 `renderers/web/render.py` 的 `built_page()` 拿，web 源码变了就会重建。这正好解决「渲染器
改了页面没跟上」，刷新即可，不用重启服务。`built_page()` 可能跑 `npm ci` 和 `npm run build`，所以服务给它
加进程锁；构建失败时返回一页能读懂的 500，不吐 traceback。

### 3. 缓存

- 只缓存在进程内存里，不落盘，容量为 8 条（LRU）。服务重启，第一次打开多等一次取数。
- 键：`(账本 profile 名与数据库, 完整 ledger_commit, line 或 "current", since 的完整哈希, max_drawdown,
  annual_return, 仓库 HEAD)`。
  - `since` 和 `at` 先解析成完整哈希再进键。分支名指向的提交会变（`dolt_branches` 不受版本控制），
    不能直接当键。
  - 目标值留在键里，使服务出的图和一次性 `research graph` 逐字节相同；目标值很少变，换一次只多取一次。
  - 工作树有改动时（`git status --porcelain` 非空，`docs/` 下除外），产品代码可能就是工作树里正在改的那份，
    此时一律不缓存，每次现取。
- 只缓存成功、且取数时没碰上环境故障的结果（见第 4 节）。
- 账本只追加、市场提交不可变，所以按完整提交缓存的条目不会过期，不需要作废逻辑。
- 每次请求先读一次头提交（0.36 s），账本有新提交就自然换键。
- 同一个键只取一次，后来的请求等同一个任务；全局同时只跑一个取数任务，因为本机瓶颈是内存。服务不主动轮询
  账本，也不预取：只在请求时取数，不是调度器。

### 4. `research graph` 本身要改的两处（与服务同一个 PR，先于服务代码提交）

**4a. 环境故障不能被吞进图里（需要用户授权）**

现在 `report/graph.py` 的 `_comparison` 会把 `comparison.compare` 抛出的所有 `Refusal` 都变成「没有比较」。
`report/measures.py` 的 `market_for` 也会把市场库连不上（`MARKET_UNREACHABLE`）变成 `{error}`，
预测结果随之变成 `untestable`，`gaps` 里却没有记录。一次性取图时，账本或市场库偶尔抖一下，就会静默出一张缺
比较的图；服务按提交缓存，这张错图就会一直被拿出来。

改法：只在 `research_graph` 里做，`measures.py` 和其他命令不动。

- 比较抛出的拒绝里，环境故障类（`LEDGER_UNAVAILABLE`、`LEDGER_PERMISSION`、`SCHEMA_MISMATCH`）重新抛出；
  无对照、不可比、缺证据这类比较事实照旧记为没有比较。
- 市场日收益的调用在本次取图里被包了一层（见 4b），碰上 `MARKET_UNREACHABLE` 就记下来，取图结束时整体拒绝。

效果：账本或市场库连不上时，`research graph` 拒绝出图（非零退出），不再输出一张缺东西的图。这算收紧了一条
拒绝路径，按 AGENTS.md 要用户授权，**待用户确认**。不授权的退路是服务完全不缓存，每次现取，代价是每次打开
页面都要等约 25 s。

**4b. 本次取图内复用市场日收益**

在 `research_graph` 里用 `seams.use(market_returns=…)` 把 `seams.current.market_returns` 包一层，按
`(market_database, commit, universe_rule, start, end)` 记住结果，只在这一次调用内有效，不在进程里放全局状态，
其他命令和测试替身都不受影响。

市场提交必须是完整哈希、按 `AS OF` 读，结果必然相同；调用方只读不改，仍返回副本。异常不缓存，其中的
`MARKET_UNREACHABLE` 交给 4a 记录。预期取图从约 75 s 降到约 25 s。

验证：改前改后对同一提交取图，`graph.json` 逐字节相同。

自助法的 21 s 不动：它决定比较结果，改它属于统计口径变化，不在本项范围内。

### 5. 安全

- 只绑 `127.0.0.1`。
- 校验 `Host` 头只能是 `127.0.0.1:<port>` 或 `localhost:<port>`，挡住 DNS 重绑定。
- 请求带 `Sec-Fetch-Site: cross-site`，或 `Origin` 不是本服务时，直接 403。别的网页虽然读不到响应，
  但能借 no-cors 请求触发取数。
- 不发 CORS 头；没有写接口，也没有能执行任意查询的接口（头提交查询是固定语句）。

### 6. 常驻方式与 skill

前台运行，由用户在自己的终端里启动和停止。Agent 起的后台进程会随会话一起结束，不算常驻。产品不带
launchd/systemd 配置，也不加守护或自动重启。

research-graph skill 加一句：用户要页面跟着账本走时，请用户在自己的终端运行 `graph.py serve`；Agent 用
`curl -s http://127.0.0.1:<port>/api/view?…` 确认服务在听，再把带目标值的网址交给用户。「同一账本提交总得到同一张图」
这句话在 4a 落地后才完全成立。

## 与仓库规矩的对照

- 新增产品代码的理由：常驻进程要比任何一个 Agent 会话活得久，属于「Agent 做不到的事」；用户 10-25 明确授权。
  4a 修的是现有缺陷（静默出错图），4b 是取图内的去重读取。
- 只读：服务本身无凭据；两条子进程命令都只用 reader 账号。账本写入路径不变。
- 不新增存储字段，不改 schema、审计检查或目标；4a 收紧拒绝路径，单独请用户授权。缓存只在进程内存里。
- 不是并行引擎、调度器或研究流程：只在请求时取数，不做任何研究判断。
- 目标值仍是用户的：服务不从路线说明里猜，只认网址上给的值。

## 交付

一个 `feat(research-graph)` PR，按提交拆开：

1. 4a 与 4b，附改前改后 `graph.json` 一致的证据。
2. `graph.py serve`。
3. 页面的拉取模式与错误、排队状态。
4. README 的阶段表加「Serve」，research-graph skill 加第 6 节那句话。

行为测试放 `tests/research_graph/`：用假的取数命令测缓存命中、同键只取一次、失败不缓存、错误 Host 和跨站请求
被拒、以 `-` 开头的参数值不被当成选项；4a 用 `seams.use` 的替身测环境故障会拒绝、比较事实不会。不写字面量检查。

用 `web/scripts/verify.mjs` 对服务出的页面截亮暗两张图。skill 的触发评测（`.agents/evals/research-graph/`）不改。

## 不做

- Docker 镜像，或者从容器连宿主机账本。
- 磁盘缓存。
- 页面上的路线切换器和提交切换器（换路线、看旧提交用网址参数）。
- 页面打开期间自动发现新提交并刷新（刷新页面即可拿到新图）。
- 把目标值写进账本。
- 改自助法。
