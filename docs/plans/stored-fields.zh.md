# 存储字段登记表

AGENTS.md 要求新增存储字段（账本或记录的列、表或存储值）前先由独立子代理审阅，并在本目录记下决定。本表把 2026-10-18..11-21 的 10 份审阅合成一份：每个经过审阅的字段一行，写它的消费者、它记的独立事实、为什么不能从已存数据推出，以及用户的授权原话。审阅的完整推理、备选做法与实测在各自 PR 和 [合并前的原文](https://github.com/qOeOp/trade/tree/fb37817f4c3d6a26ca472ccae298db239ccfcd81/docs/plans)（`*-field-review*`、`report-storage-fields`、`store-once-review`、`paper-run-storage-decision`、`live-paper-reconciliation-gate-review-20261121`）。

2026-11-21 合并，依据 [0.5.0 计划](breaking-release-0.5-20261121.zh.md) X3（Claude 决定，用户委托：「需要我定的部份最后也是一样由你决定按推荐做」）。0.5.0 从新一代账本开始，表名按 schema 第 2 代写。

**新增字段加在这里**：独立审阅之后，在对应的节里加一行（字段、位置、消费者、独立事实、为何不能派生、授权原话与日期、PR）；审阅过但决定不存的，加在最后一节。审阅过程写进 PR 正文，不另开文件。

## 研究账本

账本只存回放给不回来的东西；能从下表推出的读数（年化、夏普、计划胜率、利润来源拆分、交易结构等）读时按当前代码算，不存。

| 字段 | 消费者 | 独立事实 | 为何不能派生 | 授权 |
|---|---|---|---|---|
| `run`：状态、无效原因、原生报告语义指纹 | 复现与重封核对、`ledger review`、读取入口 | 封存时的审计发现与原生报告指纹 | 指纹是账本与 `/tmp` 缓存之间唯一的连接；审计发现是封存时的观察 | 2026-10-18 用户同意「一套度量目录、两种报告、其余动态」 |
| `run_reading.report`：资格事实、标记价回撤及区间与主导合约、资金使用峰值与在市时间、锁定保证金峰值、按流动性方向的手续费与成交额、订单漏斗、计划统计是否成立、本运行特有的局限 | `replay report`、`research status`、比较报告 | 封存时从原生报告一次算出的读数 | 要逐分钟敞口、账户状态或订单明细，这些原件不进账本，每次读都重放不现实 | 同上 |
| `run_reading.report` 资金块里的 `participation@1`（每笔市场成交占那一分钟 LAST 成交量的比，及计数） | 研究资金规模（G3）的 Agent 读单运行报告；不进度量目录，不设门槛 | 每笔成交那一分钟的 K 线成交量（引擎写 `fill_volumes.csv`，只记哈希，纳入指纹） | 账本不存成交，只能复现后再算；每读一次都要重放 | 2026-10-31 用户同意加字段，按审阅的 (a) 做（记录里没有原话） |
| `run_reading.report` 回撤块里的 `years`（每个开发年的标记价最大回撤及其峰、谷时刻；年按交易起点的周年切，末尾不满一年的算一段，峰值跨年延续；一年及以内的窗口为 null） | `replay report` 的 `dev_years` 逐年读数，Agent 按用户的回撤目标逐年看 | 每年内逐 K 线收盘标记价权益离延续峰值的最大跌幅 | 要逐 K 线的标记价权益路径，原件不进账本；`run_return` 只给日收盘权益，算出的是日收盘回撤，是另一种口径，会漏掉日内谷底；否决年是各自独立的回放，不是从一个运行切出来的 | 2026-11-21 用户「全按推荐」（D-107：评审认定回放之外给不回就加） |
| `run_return`：日收益、当日平均名义敞口 | 配对检验、回撤与资金使用读数 | 引擎的逐日收益 | 日收益是配对检验的单位；逐分钟敞口不进账本后，平均敞口无处可算 | 2026-10-18，同第一行 |
| `run_cycle`：合约、方向、开平时刻、已实现盈亏、手续费、资金费、期末浮动、计划标签、最后一张平仓单的类型与标签 | 交易结构、交易配对、出场类别（含 `exit_net`）、逐合约与逐月下钻 | 原生持仓的每个周期 | 订单、成交、持仓明细不进账本；价格盈亏由三列推出，不存 | 2026-10-18，同第一行 |
| `judgment` 正文首行 `Evaluated variants: K`（`search_exposure`） | `research status` 的 `multiple_testing`：`sweep_variants`、`trials_with_sweeps`，折扣夏普上端 | Agent 离线评估过、没登记也没回放的规则或参数变体个数 | 扫描跑在 `/tmp`，跑完就没了，只有写判断的 Agent 知道；不加列，存在已有的正文里 | 2026-11-12 用户“按建议做”；拒绝码 `SEARCH_EXPOSURE_VARIANTS_MISSING` 由用户委托的圆桌决定 |

**每件事实只存一份**（2026-10-20，用户授权去掉新试验和新运行的重复存储，请求方转述）：策略源码只在候选行（没有候选时留在开始回执）；覆盖回执只在开始回执；指纹只在 `run.fingerprints`；捕获里的这些副本只记哈希；引擎不再把摘要回显到标准输出；导出回执不存资金费逐次时刻（钉住的市场提交能读回）。

## Paper 库与 Paper 日志

Paper 记录只在远端主机的私有 Paper 库，不进研究账本、DoltHub 或 Git。

| 字段 | 消费者 | 独立事实 | 为何不能派生 | 授权 |
|---|---|---|---|---|
| `paper_source`、`paper_run`：源码、镜像、合约、成员市场日、生效配置 | `paper list`、IDE 运行卡片、`paper compare` 找回同一份源码和镜像 | 用户启动了哪一次 Paper 运行 | 用户的决定，重放不出来；复用 `trial` 会让试验计数、暴露检查和指纹语义都变错 | 2026-10-25 决定；2026-11-11 移出研究账本（#2587） |
| `paper_seal`、`paper_file`：按 UTC 日切的事件日志、停止概要、`seal.json` 读数、出网与运行器日志 | 对账逐笔比较成交与 K 线；IDE 回看已停止的运行；封存读数 | 不会再发生的实时观测，含实时 K 线（归档补不回来） | 实时数据不可重放；标记价与资金费估计不进日志，持仓与订单明细只在 `state.json` | 同上；删除已封存运行由用户本人在面板操作（2026-10-29 用户定） |
| 日志 `warmup` 事件的 `FUNDING` 周期（每合约条数、首末时刻、哈希） | `paper compare` 的预热比对 | 这个 Paper 进程从 REST 收到的结算的摘要 | 事后重读 REST 是那时的答案，不是当时收到的 | 2026-11-15 用户“授权”，选了“#3016 的两项”；2026-11-21 起与 Live 同一函数写出（`engine.realtime.MarketRows`），不再写 `fetched_ns` |
| 日志 `metrics` 行（`wall_ns`、`instrument_id`、`ts_event`、持仓量与三个多空比，不存 `ts_init`） | `paper compare` → `replay.comparison.compare_metrics`：缺失、数值不同、迟到 | Feed 实际交给源的行与时刻 | REST 只留 30 天且给最终值；只存摘要定位不到行 | 2026-11-15 用户授权加这个字段，并要求 Paper 与 Live 同样比较（记录里没有原话） |
| 日志 `metrics_unsubscribed` 行（`wall_ns`、`instrument_id`） | 同上，按退订切分跟随区间 | 源何时不再要 metrics | 不记就把退订后的档案行全算成缺失；截在最后收到的一行会藏住真缺的尾部 | 同上 |

## Live 证据包

只在 Live 私有根的 `evidence/market.jsonl`，不进研究账本、DoltHub 或 Git。2026-11-21 起与 Paper 日志的行情行是同一格式（`engine.realtime.MarketRows`），两边的比较读同一个 `replay.comparison.run_record`。

| 字段 | 消费者 | 独立事实 | 为何不能派生 | 授权 |
|---|---|---|---|---|
| `warmup` 行，每合约每周期一行（`wall_ns`、`instrument_id`、`period`，资金费为 `FUNDING`；`bars`、`first_ts_event`、`last_ts_event`、`sha256`），取代原始的 `historical_bar`、`historical_funding` 行 | `live compare`：`replay.comparison.warmup` 与档案同一 T 的聚合比对，算出差异原因 `warmup` 的影响范围；`history_start` 定回放起点；`segment` 按 `wall_ns` 把重启后的预热分给各自进程 | 源在预热时实际收到的历史与结算。与原始行是同一事实，不是新增一份：过去 `received_warmup` 也只是把原始行压成这份摘要，别处不读原始行 | 原始行不再写后无处可推：原生报告不含历史，档案是比较的另一边；事后重读 REST 不是当时收到的 | 0.5.0 计划 E7，Claude 决定，用户委托：「需要我定的部份最后也是一样由你决定按推荐做」（2026-11-21） |
| `metrics` 行（字段同 Paper 日志） | `live compare` → `compare_metrics`；差异原因 `metrics`；IDE 比较视图 | Feed 实际交给源的行与时刻，含截止时为 None 的比值、因无持仓量跳过的行 | REST 只留 30 天、给最终值；永不结束的运行没有写摘要的时点 | 2026-11-15 用户选“Live 记录 metrics” |
| `metrics_unsubscribed` 行（`wall_ns`、`instrument_id`） | `compare_metrics` 切分跟随区间 | 源何时退订 metrics | 回放给的是回放里的退订时刻，两边一分岔就不同；与 `metrics` 行同文件，一起丢或一起在 | 随 #3077 合入（记录里没有原话） |

## 浏览器偏好

| 字段 | 消费者 | 独立事实 | 为何不能派生 | 授权 |
|---|---|---|---|---|
| localStorage `rg-time-zone`（`UTC`、`America/New_York`、`Asia/Shanghai`、`Asia/Tokyo`，错值回退 UTC） | IDE 全部时刻展示、图表轴与浮层、Settings | 用户选的展示时区 | 同一 UTC 时刻有四种合法展示，推不出用户选哪个；只转换展示，不动原始时刻与 UTC 业务日 | 2026-11-08 用户选默认 UTC，加纽约、中国、日本（审阅稿转述，没有原话） |

## 审阅过、决定不存

| 提议 | 决定 | 依据 |
|---|---|---|
| Live 准入记下放行它的 Paper 对账（缓存文件或清单字段） | 不存：后台从 Paper 库、市场与镜像推导，每次发布后重算；不过就拒绝 `LIVE_PAPER_UNRECONCILED` | 2026-11-21「我都授权」，「需要我拍板的都按照你的建议来」；哪些 Paper 运行算数见[原决定](https://github.com/qOeOp/trade/blob/fb37817f4c3d6a26ca472ccae298db239ccfcd81/docs/plans/live-paper-reconciliation-gate-review-20261121.zh.md) |
| Paper 与 Live `warmup` 行的 `fetched_ns`；Live 日志 `warmup` 事件的 `fetched_ns` 与每周期根数 `bars` | 不存：没有读者，根数与证据包 `warmup` 行的 `bars` 重复；日志事件只留 `at_ns`（T） | 0.5.0 E7 独立审阅，2026-11-21，委托同上 |
| Live 证据包的聚合 K 线与 `bar` 行的 `bar_type` | 不存：只记一分钟线，与 Paper 同形；聚合由一分钟线算出，比较、`window`、`journal` 都只读一分钟行 | 同上 |
| 离线扫描变体数单开一列 `judgment.variants` | 不开列，写在正文首行（见上） | 2026-11-12；2026-11-21 重审（D-108），用户看过评审后定「108按你建议来」：K 已在正文首行，格式由 `SEARCH_EXPOSURE_VARIANTS_MISSING` 严格检查，已有字段能表达，加列只换格式不添事实，反要改 CLI、拒绝码、op_id 载荷和 research-round 技能，维持不开列 |
| 参与率读时现算或封存时读市场库 | 不采用：读时每次重放；封存不能多一个对市场库的依赖 | 2026-10-20、10-31 审阅 |
