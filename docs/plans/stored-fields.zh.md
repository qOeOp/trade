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
| 日志 `late_aggregate` 行（`wall_ns` 收到时刻、`bar_type`、`ts_event`），只在源收到的聚合时间 K 线比它的桶末晚 60 秒以上时写；与 Live 同一函数写出（`engine.realtime.MarketRows`） | `paper compare` → `replay.comparison.attribute`：差异原因 `late_aggregate`，按合约在 (since, last] 计数；IDE 比较视图 | 主机休眠或 VM 挂起后 rc7 的聚合定时器错位，源按过时的桶做决策；这时一分钟线仍准时 | 一分钟线和档案都看不出聚合 K 线何时送到源；桶末与迟到时长由三列读时推出（`engine.history.bucket_end`），不存；不存价格 | 2026-11-21 用户「批准」，回答“批准新存 late_aggregate 这种行（三列），并给对照加 late_aggregate 原因吗？”（C-142） |

## Live 证据包

只在 Live 私有根的 `evidence/market.jsonl`，不进研究账本、DoltHub 或 Git。2026-11-21 起与 Paper 日志的行情行是同一格式（`engine.realtime.MarketRows`），两边的比较读同一个 `replay.comparison.run_record`。

| 字段 | 消费者 | 独立事实 | 为何不能派生 | 授权 |
|---|---|---|---|---|
| `warmup` 行，每合约每周期一行（`wall_ns`、`instrument_id`、`period`，资金费为 `FUNDING`；`bars`、`first_ts_event`、`last_ts_event`、`sha256`），取代原始的 `historical_bar`、`historical_funding` 行 | `live compare`：`replay.comparison.warmup` 与档案同一 T 的聚合比对，算出差异原因 `warmup` 的影响范围；`history_start` 定回放起点；`segment` 按 `wall_ns` 把重启后的预热分给各自进程 | 源在预热时实际收到的历史与结算。与原始行是同一事实，不是新增一份：过去 `received_warmup` 也只是把原始行压成这份摘要，别处不读原始行 | 原始行不再写后无处可推：原生报告不含历史，档案是比较的另一边；事后重读 REST 不是当时收到的 | 0.5.0 计划 E7，Claude 决定，用户委托：「需要我定的部份最后也是一样由你决定按推荐做」（2026-11-21） |
| `metrics` 行（字段同 Paper 日志） | `live compare` → `compare_metrics`；差异原因 `metrics`；IDE 比较视图 | Feed 实际交给源的行与时刻，含截止时为 None 的比值、因无持仓量跳过的行 | REST 只留 30 天、给最终值；永不结束的运行没有写摘要的时点 | 2026-11-15 用户选“Live 记录 metrics” |
| `metrics_unsubscribed` 行（`wall_ns`、`instrument_id`） | `compare_metrics` 切分跟随区间 | 源何时退订 metrics | 回放给的是回放里的退订时刻，两边一分岔就不同；与 `metrics` 行同文件，一起丢或一起在 | 随 #3077 合入（记录里没有原话） |
| `late_aggregate` 行（字段同 Paper 日志）；入场闸门关闭时也写 | `live compare` → `attribute`：原因 `late_aggregate`，覆盖入场闸门（`entry_gate`）管不到的迟到 K 线触发的出场 | 同 Paper 日志 | 同 Paper 日志；日志的 `entries_closed` 事件只记 `bar_type` 与这根 K 线的 `received_ns`（它的 `ts_event`），#3356 加的 `bucket_end_ns`、`late_ns` 能由这两列与本行推出，删去 | 同上 |

## Live 运行清单

只在 Live 私有根的 `runs/<run>/inputs/manifest.json`，不进研究账本、DoltHub 或 Git。

| 字段 | 消费者 | 独立事实 | 为何不能派生 | 授权 |
|---|---|---|---|---|
| `config.environment`（`live` 或 `demo`，清单格式升为 `live-run-6`）（D-102） | 运行器选 Binance 主机与 Nautilus `BinanceEnvironment`（`engine/live.py`、`engine/live_node.py`、`engine/realtime.py`、`engine/klines.py`、`engine/kline_events.py`）；出口代理按运行放行的主机（`live/host.py`、`engine/egress.py`）；密钥检查（`live/key.py`，demo 没有 `apiRestrictions`）；`live compare`、每日对照、Telegram 与 Live 页标出 Demo | 用户为这次运行选的 Binance 环境 | `account_id`、`credential_binding`（API key 的 SHA-256）、`credential_ref` 都不含它；向交易所试探要有效 key 和一次网络调用，key 被撤销时两边答得一样，而运行器在第一次读之前就要选主机；出口日志要启动后才有 | 2026-11-21 用户「同意」（#3367） |
| 凭证按环境分目录：`credentials/<environment>/`（各自的版本、`metadata.jsonl` 与选中），环境是路径，不是记录里的值 | Live 页的 Live/Demo 开关（列出、保存、删除、检查哪个环境的 key）；准备运行时只从运行的环境里取选中的 key（`live/credentials.py`） | 这把 key 属于哪个环境 | 独立审阅（#3367）认为一次只跑一个运行时不必存：交易所在准入时拒绝另一环境的 key，运行经 `credential_ref` 绑定 key 版本，代价是换环境要重新保存。用户不接受这个代价，两个环境各有自己的 key；key 字符串、`credential_binding`、`credential_ref` 都推不出环境。选了最省的形状：按目录分，不在行里加值 | 2026-11-21 用户「为什么只存一把 这是两个不同的环境吧 应该有按钮切换 demo 和 live都有各自的key才对吧」（#3367） |

## 市场目录

| 字段 | 消费者 | 独立事实 | 为何不能派生 | 授权 |
|---|---|---|---|---|
| `instrument.max_market_quantity`（可空字符串，交易所原文，取自 exchangeInfo `MARKET_LOT_SIZE.maxQty`；`inferred` 行为 null，交易所行缺这个过滤器时也为 null，即“上限未知、不检查”；同时加进 `instrument.TERMS`）（#3552） | `engine/order_rules.violation`：上限非 null 时，市价类订单（`MARKET`、`STOP_MARKET`、`MARKET_IF_TOUCHED`、`TRAILING_STOP_MARKET`）数量超出就拒绝，回放、Paper、Live 读同一份运行条款快照，拒绝一致。今天没有已存运行接近上限（2026-11-24 只读核对：83 个运行只交易 BTC、ETH、SOL，最大到 SOL 上限的 10.5%）；消费者是今后集中在低上限合约上的研究线（2026-11-24 有 171/522 个永续的市价上限不到 5 万 USDT） | 交易所对市价单另设的数量上限，与限价单的 `LOT_SIZE.maxQty`（今天的 `max_quantity`）不同 | 两个上限之比因合约而异，不能互推；Nautilus 2.0.0rc7 的合约只有一个 `max_quantity`，它的 Binance 解析器只读 `LOT_SIZE`，安装包和 `_libnautilus` 里都没有 `MARKET_LOT_SIZE`；市场目录、导出快照都不存 exchangeInfo 原始过滤器；回放时现读 exchangeInfo 会让回放随运行日变、下市合约读不到；用市价上限覆盖 `max_quantity` 会错拒限价单，还会缩小推断报价的数量（`market/export.py` 取 `max_quantity`）；只在 Paper/Live 检查会让 Paper 拒绝回放接受的订单 | **待用户授权**。2026-11-29 独立审阅结论：存。2026-11-29 的授权「都授权 找证据 全模块slim doctor继续完善测试迭代」不含新增字段。未决：Binance 是否对只减仓的出场与保护止损也用这个上限（拒绝出场之前先在 Demo 上探明）；历史上限取不回，和 `max_quantity` 一样整段窗口用快照当日的值；第一次跟随后每个合约追加一行条款 |

## 浏览器偏好

| 字段 | 消费者 | 独立事实 | 为何不能派生 | 授权 |
|---|---|---|---|---|
| localStorage `rg-time-zone`（`UTC`、`America/New_York`、`Asia/Shanghai`、`Asia/Tokyo`，错值回退 UTC） | IDE 全部时刻展示、图表轴与浮层、Settings | 用户选的展示时区 | 同一 UTC 时刻有四种合法展示，推不出用户选哪个；只转换展示，不动原始时刻与 UTC 业务日 | 2026-11-08 用户选默认 UTC，加纽约、中国、日本（审阅稿转述，没有原话） |

## 审阅过、决定不存

| 提议 | 决定 | 依据 |
|---|---|---|
| Live 准入记下放行它的 Paper 对账（缓存文件或清单字段） | 不存：后台从 Paper 库、市场与镜像推导，每次发布后重算；不过就拒绝 `LIVE_PAPER_UNRECONCILED` | 2026-11-21「我都授权」，「需要我拍板的都按照你的建议来」；哪些 Paper 运行算数见[原决定](https://github.com/qOeOp/trade/blob/fb37817f4c3d6a26ca472ccae298db239ccfcd81/docs/plans/live-paper-reconciliation-gate-review-20261121.zh.md) |
| Paper 与 Live `warmup` 行的 `fetched_ns`；Live 日志 `warmup` 事件的 `fetched_ns` 与每周期根数 `bars` | 不存：没有读者，根数与证据包 `warmup` 行的 `bars` 重复；日志事件只留 `at_ns`（T） | 0.5.0 E7 独立审阅，2026-11-21，委托同上 |
| Live 证据包的聚合 K 线与 `bar` 行的 `bar_type` | 聚合 K 线的价格仍不存：只记一分钟线，与 Paper 同形；聚合由一分钟线算出，比较、`window`、`journal` 都只读一分钟行。迟到的送达时刻改存为 `late_aggregate` 行（见上） | 同上；迟到时刻见 `late_aggregate` 行的授权 |
| 离线扫描变体数单开一列 `judgment.variants` | 不开列，写在正文首行（见上） | 2026-11-12；2026-11-21 重审（D-108），用户看过评审后定「108按你建议来」：K 已在正文首行，格式由 `SEARCH_EXPOSURE_VARIANTS_MISSING` 严格检查，已有字段能表达，加列只换格式不添事实，反要改 CLI、拒绝码、op_id 载荷和 research-round 技能，维持不开列 |
| 参与率读时现算或封存时读市场库 | 不采用：读时每次重放；封存不能多一个对市场库的依赖 | 2026-10-20、10-31 审阅 |
| 环境写进 `prepared` 行、`events.jsonl`、`compare.json` 或通知状态 | 不存：从清单读 | 2026-11-21 独立审阅（D-102，#3367） |
| 源在每次入场决定时读到的权益（#3542：`paper compare` 用它给数量差异定原因）。Paper 侧会是日志里的一个键，落在私有 Paper 库 `paper_file.content`，是存储字段；回放侧的报告是复现出来的工作副本，不是存储字段 | 审阅建议不存，待用户定。(1) 取不到可信的值：源在同一进程里可从多处账户接口读、可缓存、可不用；源自写的标签今天两侧都存得下（`tags`），但造得出来；提交时由引擎取样又不是源读的那个值（技能要求读更早事件的权益），这样的入场只复现 3/50 与 11/18。(2) 定不出精确规则：不知道取量函数，只能假设按比例；±1 步的错量接受一半（155/310），非比例的取量（权益分档、先减固定额）只解释 5/38、40/184。(3) 加一个原因会比公式松得多：`attribute` 只判每个合约的第一组差异，其后算 `consequence`，准入不看，116/155 组任何错量都会记成 `consequence`（链规则本已如此，有解释的首组会让准入放行整条链）。(4) 第 2 轮还有三分钟权益差单独拒绝（同类见 #3617），加了字段也不放行。只加 Paper 侧不够，`live compare` 同样要。若一定要存：不是逐入场的权益，是 Paper 日志行 `account_read`（`wall_ns`、`strategy_id`、`dispatch`、`call`、`seq`、`value`；粒度：每个策略、每次回调中值变化的那次读；`value` 为 USDT 的十进制文本、8 位小数，引擎没给值时为 null；每行约 180 B，六合约每分钟各读一次约 1.6 MB/天未压缩，估算），对照回放把这些读数喂回去，数量逐个精确相等才算解释，不开 `consequence` 链；回放侧不存。不加字段的先行办法：源用确定的权益（只计上一分钟收盘前已成交的、按那一分钟 LAST 收盘估值），两侧计入的成交集合 0/155、0/54 处不同；2026-11-25 用户选定，闭环 Paper 运行（六合约 3 小时）151/151 个入场与回放逐位相同（期间没有带持仓的资金费结算；Paper 账户不记资金费，跨结算后仍会不同），成交的截断取两次收盘的中点（容器时钟慢约 2 秒时，取收盘时刻会把本分钟的成交算进来） | 2026-11-24 独立审阅；用户「授权全部按建议修」只含先审阅，字段未授权 |
