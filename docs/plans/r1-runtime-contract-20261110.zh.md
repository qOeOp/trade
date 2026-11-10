# R1 新运行契约设计（重排计划第 2 步）

2026-11-10，用户说"Start step 2"。依据 `execution-paths-replan-20261110.zh.md` 的 R1 和第 5 节。
本文是设计，不授权代码改动：第 9 节逐条列出要用户授权的检查和拒绝改动，批准后才实施。
基线 `main` `454a3eb29`（已含第 1 步的 Live 证据包，#2557）。初稿经过一轮独立审查，审查意见已经并入正文。

## 1. 范围

新契约把回放、Paper、Live 的输入、账户、预热、订单规则、分配和停止定成一份，版本号 `replay-contract@v8`。
它在新账本开张前一次合入，不保留 v7：旧源码、旧 manifest 格式和旧运行不再能跑或复现（用户 11-10 已决定）。

不在本步：
- R2：Live 只跑候选本身，预检要求证据。
- R3.2：共用对照工具。
- R4：Paper 资金费、放行条件、封存审计。
- R5：连续运行。
- 成员资格跨月规则。
- 运行结束时对未结订单和持仓的处理：现在回放留着，Paper 全撤（`engine/paper.py:650-652`），Live 平仓。父计划 R1.6 只要求 `on_stop` 一致；结束处理属于运行生命周期，归 R5。
- Paper 的恢复路径：保持 v7 的做法和它的拒绝（`engine/paper_session.py:87-92`、`engine/paper.py:878-879`），只随第 5 节换掉日线预热的来源。

## 2. 原生探针（rc7，`BacktestEngine`）

脚本在会话临时目录，结论如下。

| 探针 | 结果 | 结论 |
| --- | --- | --- |
| 整段历史一次请求：`request_bars(1-MINUTE-EXTERNAL, params={"bar_types": [15 分钟, 1 日], "update_subscriptions": True})` | 只有 1 分钟历史回调；聚合历史进缓存。审查者另测：T 不在桶边界或历史长度不是整天时，缓存里最早一根聚合 K 线不完整（日线成交量 53，不是 1440）；缓存每种类型只存 1 万根；28.8 万根 1 分钟历史时进程峰值约 755 MB | 不用这种方式 |
| 先订阅聚合类型再请求 | 回放里报 ERROR，没有回应 | runner 必须先预热、后让源码订阅 |
| 直接请求复合类型 | 拒绝："Composite bar types are not supported" | 聚合只能经 `bar_types` 预热 |
| **采用的方式**：<br>1. 每个周期 P 请求非复合的 `P-LAST-EXTERNAL` 历史，止于 `floor(T,P) − 1ms`；<br>2. 每个聚合周期另发一个 1 分钟请求，只覆盖当前未完成的桶 `[floor(T,P), T)`，带该周期的 `bar_types` 和 `update_subscriptions`。<br>T 取 00:07 和 00:00 各跑一次 | 15 分钟 8 根、日线 2 根历史，各一次回调，止于桶边界前 1ms。两个预热请求可以并存。第一根实时 15 分钟成交量 15，是完整的。缓存里没有不完整的聚合 K 线。T 在边界上时不发预热请求，桶 `[T−P, T)` 只在历史里出现一次 | 历史量等于声明的根数，加最多一个周期的 1 分钟；不需要跳过首根 |
| `max_order_submit_rate="10/00:00:01"`，同一根 K 线提交 15 笔 | 10 笔 ACCEPTED，5 笔 DENIED，不排队；整个引擎共用一个限流 | 见第 8 节 |

预热请求的回应会回调给发请求的一方。所以预热请求由 runner 自己的 `DataActor` 发出。Paper 恢复已用这种做法（`engine/paper_session.py:263-286`，在 `LiveNode` 上，Catalog 回应）。
那里的注释记了一个已知行为：Catalog 边界没有对齐到微秒时，原生用 Binance REST 补边缘。所以 Paper 和 Live 的 Catalog 要用同样的精确边界，并逐根核对回应。

## 3. 源码契约（作者写的部分）

一个文件、一个入口类，原生 `Strategy` 子类。和 v7 相比：

- **不写 `__new__`。** runner 用 `Strategy.__new__(cls, StrategyConfig(...))` 分配，注入以下配置：
  - `strategy_id`、`oms_type=NETTING`、`use_uuid_client_order_ids=True`；
  - `manage_stop=False`、`manage_gtd_expiry=False`、`manage_contingent_orders=False`；
  - `market_exit_reduce_only=True`。

  `__init__(self, instrument_id, bar_type, **kwargs)` 调用 `super().__init__()`。源码出现 `__new__` 或把配置传给 `super().__init__`，加载时拒绝。
- **构造参数**：`instrument_id`、`bar_type`（1 分钟 EXTERNAL）、`trade_start_ns`、`strategy_id`、`universe_membership`、`execution_bar_minutes`。删除 `historical_daily_bars` 和 `daily_bar_type`。
- **类属性**（加载时用 AST 读，不执行文件）：
  - `WARMUP`：周期到根数的字典，如 `{"15-MINUTE": 81, "1-DAY": 200}`，取代 `DAILY_WARMUP`。
    - 键必须是 Binance K 线也有的周期（1、3、5、15、30 分钟，1、2、4、6、8、12 小时，1 天）。
    - 除 1 分钟外，键就是源码能订阅的聚合周期，根数可以是 0。
  - `USES_STOP_LOSS` 必须为 `True`（A4）。
- **回调**：
  - 每个周期一次 `on_historical_bars(bars)`：`P-LAST-EXTERNAL` 类型，按时间升序，最后一根止于 `floor(T,P) − 1ms`。
  - 全部历史就绪后，runner 才调用源码的 `on_start`，源码在这里订阅实时数据。
  - 实时聚合 K 线的类型是 `P-LAST-INTERNAL`，打在桶结束时刻；历史是 EXTERNAL，打在结束前 1ms。这与 v7 的日线约定相同，三处一样。
  - 不能定义 `on_stop`（第 8 节）。

技能 `research-round/references/strategy-authoring.md` 的 Entry class、Causal clock、Orders、Live 各节随之重写。Live 一节大部分并入通用规则后删除。

## 4. 数据

- **能订阅的**：
  - 1 分钟 LAST EXTERNAL K 线，和 `WARMUP` 声明周期的 `INTERNAL@1-MINUTE-EXTERNAL` 聚合；
  - MARK、资金费、合约状态和收盘价；
  - 回放的 `--trade-ticks`、`--metrics` 自定义数据（只在回放有）。
- **拒绝的**（三处一样）：
  - 报价、盘口、指数价、原生逐笔成交；
  - 契约外的 K 线类型和未声明的聚合周期；
  - Paper 和 Live 里的逐笔成交和 metrics 自定义数据：没有实时来源，所以用了它们的候选上不了 Live。

  实现：把 `engine.strategy.Subscriptions` 扩到这些种类，三处的源码包装都用它。Live 现在没有它。
  回放的拒绝和 `TRADES_NOT_SERVED` 一样，在当前分块结束后停止并拒绝（`engine/run.py:688`）。
- **`quotes` 执行环境**：仍用导出的报价驱动撮合，但报价不再是源码的信号输入。R2 规定 Live 证据用 `bars`。
- **节奏**：Paper 和 Live 的源码只看到每分钟第一个 MARK 和每次结算的一条资金费。用 `engine/cadence.py`（第 1 步已从 Paper 移出），Live 的源码包装加上和 Paper 一样的门。
- **首根 K 线**：三处 `time_bars_skip_first_non_full_bar=False`，预热请求也显式传 `skip_first_non_full_bar=False`。聚合器由当前桶的 1 分钟数据填好，第一根实时聚合 K 线是完整的。

## 5. 预热

1. **T。** 回放是 `--trade-start`。Paper 和 Live 是启动后的下一个整分钟，用原生定时器等到 T。
   - 回放第一个分块显式 `run(start=T)`，现在是 `start=None`（`engine/run.py:674-688`）。
2. **历史请求。** 在 T，源码包装为 `WARMUP` 的每个周期 P（根数 n > 0）发一个请求：`request_bars(P-LAST-EXTERNAL, [floor(T,P) − n·P, floor(T,P) − 1ms])`。回应回调给源码，但先经第 4 点的核对。
3. **聚合器预热。** runner 的 `DataActor` 为每个聚合周期 P 发一个请求，前提是 `floor(T,P) < T`：
   - 请求是 `request_bars(1-MINUTE-EXTERNAL, [floor(T,P), T − 1ms], params={"bar_types": [P], "update_subscriptions": True, "skip_first_non_full_bar": False})`；
   - 回应只到 actor，由它核对，不给源码；
   - 每个周期最多一个周期长度的 1 分钟数据，日线最多 1440 根。
4. **核对。**
   - 回应必须和 Catalog 写入的逐根相同：升序、无重复、不晚于 T、在请求区间内。
   - 每个周期最后 n 根前后相邻（间隔 P），最后一根止于 `floor(T,P) − 1ms`。这是 v7 日线 `daily_run` 规则的推广（`engine/load.py:522-534`）。
   - 1 分钟数据有缺口时照样送（与实时流相同，`market/coverage.py:31-44`），只有声明的历史根数不满足相邻规则时才算不足。
5. **交给源码。** 全部回应核对通过后，调用源码的 `on_start`。
6. **下单闸门。** 第 5 步之前提交任何订单都拒绝。
7. **衔接。** 第一根实时 1 分钟 K 线必须是 `T + 60s − 1ms`。Paper 和 Live 中，回应在 `T + 30s` 后才到就拒绝启动（时长实施时实测后定）。
8. **历史不足。**
   - 回放保留 v7 的 `plan_instances` 做法（`engine/run.py:697-726`）：实例推迟到它的历史满足的第一个时刻，用原生定时器在那时发请求；整个窗口都不满足就不建实例，没有任何实例时拒绝（`WARMUP_INSUFFICIENT`）。
   - Paper 和 Live 历史不足时拒绝启动。
9. **数据从哪里来。**
   - 回放：导出的 Catalog 已有 1 分钟和派生日线（`engine/load.py:512`）。其他周期在回放准备时从 1 分钟派生，写进同一运行的临时 Catalog（`catalogs=[导出, 临时]`），用与日线相同的派生规则。
   - Paper 和 Live：在 T 之后用 Binance 公开 K 线（`fapi/v1/klines`，无凭据，与 Paper 现有日线预热同一接口）取每个周期的历史和当前桶的 1 分钟，写进临时 Catalog，再发请求。
     - Live 主机没有挂载市场目录（`deploy/live_host.py:144-152`）。市场目录本身也来自 Binance 的公开归档，所以 Paper 和 Live 不读市场目录。
     - 派生 K 线与 Binance 同周期 K 线是否逐根相等，实施时用历史数据核对；不相等就改为从 1 分钟派生。
   - Paper 和 Live 实际送入的预热 K 线记入证据包（`historical_bar` 行，第 1 步已实现），由 R3.2 先比。
10. **缓存容量。** 三处把 `CacheConfig(bar_capacity)` 设为至少 `WARMUP` 最大根数加一天的分钟数，避免历史被原生缓存截断。

取代：
- `DAILY_WARMUP`、`historical_daily_bars`；
- 回放窗口的第三个时间点和经 `on_bar` 送入的分钟预热；
- Paper 的 REST 日线预热、`warmup_digest`，以及恢复时"原日线预热变了"的拒绝；
- Live 的 `LIVE_WARMUP_UNSUPPORTED`。

## 6. 账户与合约条款

一份账户契约，三处共用：`BINANCE`、USDT、`MARGIN` 账户，源码 NETTING。起始资金、杠杆和执行环境是运行参数。

- **杠杆。** 新运行参数 `--leverage`，三处一致。
  - Live 启动时读交易所该合约的实际杠杆，不等于契约值就拒绝。Live 从不改账户设置，杠杆由用户在 Binance 上设好。
  - 现在回放杠杆 1、合约 `margin_init` 0.1（`engine/config.py:91`、`market/instrument.py:22`）。rc7 怎么把两者结合成初始保证金要先探针，再定回放的保证金设置，使它等于 Binance 的 名义价值/杠杆。"入场可到 3 倍权益，所以杠杆至少 3"的结论以这个探针为前提。
  - `--leverage` 会进入保存的有效配置。按 AGENTS.md，实施前先做一次新增保存字段的独立审查，结论记在 `docs/plans/`。
- **合约条款。**
  - Paper 和 Live 的原生合约来自 Binance 合约加载器（`engine/paper.py:736-737`、`engine/live_node.py:21`）。不在原生层替换它们。
  - 启动时把加载的合约和 `exchangeInfo` 的最小价位、数量步长、最小名义价值与市场导出的合约比对，不一致就拒绝。交易所改了条款，市场要先跟上。
  - 保证金率和手续费仍然不同：前者等上面的探针决定，后者由账户等级决定，由 R3.2 归因。
  - 修正：初稿说 Paper 用 `rest_terms` 取合约精度，不对。它只给日线预热 K 线定精度（`engine/paper.py:867-868`）。
- **持仓模式。** 不变：交易所 Hedge 加 Multi-assets，执行客户端 `HEDGING`，源码 NETTING。
- **爆仓。** 不变：`bars` 不模拟，`quotes` 模拟。

## 7. 订单规则与保护单覆盖

### 7.1 订单规则：一个函数，三处调用

`engine/order_rules.py`（新）返回违规代码或空。三处源码包装在 `submit_order` 等入口调用它：
- 回放和 Paper：记下违规、不提交该订单，分块结束后以违规代码拒绝运行；
- Live：照旧当场拒绝，并进入停止路径。

规则：
1. 入场（非 reduce-only）必须是基础数量的 LIMIT，且该策略在该合约上没有持仓和未结订单（一次一笔）。
2. 入场在限价处的名义价值不超过账户 USDT 权益的 3 倍（`ENTRY_EQUITY_MULTIPLE`，原生组合权益）。
3. 退出必须 reduce-only，带 `position_id`，不超过当前持仓的方向和数量。
4. 不改单；不用订单列表、括号单、模拟触发、执行算法、订单参数、关联单、按报价货币下单。
5. GTD 的到期时间至少在 600 秒之后（Binance 的限制，现在哪里都不查）。
6. 只能撤自己的单。

加载时的 AST 检查（文件中出现 `submit_order_list`、`bracket`、`add_exec_algorithm`、`close_all_positions` 就拒绝）从 Live 扩到三处。

Live 另外保留它自己的账户准入，这是真实账户托管的需要，不放进共用规则：
- 入场时整个账户在原生缓存里无持仓、无未结订单（`engine/live_commands.py:124-125`）；
- 交易所快照无持仓（`require_flat`）；
- 3 倍限额的权益取 REST 快照的 `min(钱包, 可用)`（`engine/live_venue.py:244`），不是原生组合权益。

Live 开始时要求账户为空、只跑一个策略，所以两种口径在 Live 上一般一致；不一致时 Live 更严。这是留下的唯一一处 Live 专有入场检查，记为执行差异。

### 7.2 保护单覆盖：一个语义

`engine/protection.py`（新）只有一个判定：
- 同合约、同策略、平仓方向、reduce-only 的止损类订单；
- 状态是 ACCEPTED，即已接受、未触发、未成交；
- 按剩余数量求和，不小于持仓数量才算覆盖。

| 位置 | 现在 | 改后 |
| --- | --- | --- |
| Live（`engine/live_session.py:116-138`） | 只数 ACCEPTED，与此一致 | 改为调用它 |
| Paper（`engine/paper.py:615-630`） | 按订单总量，不排除已触发的单；连续两次分钟快照不足才记录，实际 60 到 120 秒 | 调用它，按事件时间 60 秒，仍只记录 `protection_gap`（封存审计是 R4） |
| 研究审计（`engine/audit.py:296-356`） | 已接受、未结束、有未成交量的止损都算，已触发的也算（`OrderTriggered` 是被动事件，`:41`） | 从事件重建订单状态后调用同一判定：已触发的止损不再算覆盖。这是收紧，见 A5 |

允许时长：回放审计和 Paper 都是 60 秒。Live 是 60 秒加 30 秒检测延迟（具名常量）。
Live 多出的 30 秒有真实执行上的原因：经 REST 接受的止损没有 WebSocket 事件，原生要靠 10 秒一次的未结订单检查才看到。

## 8. 分配、频率和停止

- **分配。** 见第 3 节。删除：
  - `__new__` 例外（README "Native strategy allocation"）；
  - `LIVE_SOURCE_CONFIG`、`LIVE_SOURCE_STOP`、`LIVE_SOURCE_REVIEW`（`single_order_source_reviewed`）；
  - Paper 恢复订单工厂计数的代码和它的拒绝（`engine/paper_session.py:133-141`）。UUID 订单号用不到计数。

  `require_source_config` 留作注入后的断言：违反说明产品自身出错。
- **下单频率。** 建议不改：回放和 Paper 保持 200/秒，Live 保持 10/秒。理由：
  - rc7 的限流是整个引擎共用的，超出直接拒绝（第 2 节）。回放改成 10/秒后，多合约回放在日线收盘时同时入场，会出现被拒订单，触发 `ORDERS_DENIED_OR_REJECTED`（`engine/config.py:237`）。
  - Live 只能跑一个合约（`engine/live_venue.py:179`），10/秒是产品自己的设置，不是 Binance 的限制。
  - 第 7.1 节"一次一笔、不用订单列表"之后，一个实例每秒至多几笔，碰不到 10/秒。

  父计划写的是改成 10/秒；若用户仍要求三处一致，就是 A7。
- **停止。** 三处都不运行源码的 `on_stop`，源码定义了就在加载时拒绝。运行结束由 runner 负责，见第 1 节。

## 9. 需要用户授权的改动

每一项都改变某个拒绝或审计检查。

2026-11-10 用户答复"Authorize as recommended"：A1–A6、A8、A9 照本节授权，A7 按建议不改（回放和 Paper 保持 200/秒）。

| 编号 | 改动 | 现在 | 改后 |
| --- | --- | --- | --- |
| A1 | 扩大不提供的订阅，Live 加入同一检查 | 回放和 Paper 只拒绝原生逐笔成交和未服务的 metrics；Live 什么都不拒绝 | 三处拒绝报价、盘口、指数价、原生逐笔成交、契约外 K 线；Paper 和 Live 拒绝逐笔成交和 metrics 自定义数据 |
| A2 | 首根规则 | Paper 新启动和 Live 跳过首根不完整聚合 K 线，回放不跳过 | 三处都不跳过，由预热保证首根完整 |
| A3 | 预热契约 | 三处来源不同；Live 拒绝 `DAILY_WARMUP`（`LIVE_WARMUP_UNSUPPORTED`）；Paper 恢复时比对日线预热指纹 | 第 5 节：<br>- 预热完成前提交订单拒绝；<br>- 核对、衔接、超时、历史不足时拒绝启动；<br>- `WARMUP_INSUFFICIENT`、`WARMUP_NOT_ADJACENT` 推广到所有声明周期；<br>- `DAILY_WARMUP` 及其 `DECLARATION_NOT_BOOL` 换成 `WARMUP` 的声明检查；<br>- 删除 `LIVE_WARMUP_UNSUPPORTED` 和 Paper 的"原日线预热变了"拒绝；<br>- Paper 和 Live 启动时比对合约条款（A9） |
| A4 | 订单规则三处执行 | 只有 Live 检查；GTD 600 秒哪里都不查；研究允许 `USES_STOP_LOSS = False` | 第 7.1 节的规则和 AST 检查三处执行，回放和 Paper 违规即运行无效；新增 GTD 至少 600 秒；`USES_STOP_LOSS` 必须为 `True`；Live 的账户级准入保留 |
| A5 | 保护单覆盖合一 | 三份实现；审计把已触发的止损算作覆盖；Paper 按总量算 | 第 7.2 节一个判定；审计收紧；Paper 按 60 秒记录 |
| A6 | 分配注入 | 源码自己写 `__new__`；Live 有 `LIVE_SOURCE_CONFIG`、`LIVE_SOURCE_STOP`、`LIVE_SOURCE_REVIEW`；Paper 有订单工厂计数拒绝 | runner 注入配置；源码写 `__new__` 在加载时拒绝（`SOURCE_REACH`）；删除这三条 Live 拒绝和 Paper 的计数拒绝 |
| A7 | 回放和 Paper 下单频率（建议不改） | 200/秒；Live 10/秒 | 若改：10/秒，超出被拒，运行无效 |
| A8 | `on_stop` | 回放和 Paper 运行源码的 `on_stop`，Live 换成空操作 | 源码定义 `on_stop` 在加载时拒绝 |
| A9 | 账户契约比对 | Live 接受任意正杠杆，不比对合约条款 | 新参数 `--leverage`；Live 杠杆不等于契约值就拒绝；Paper 和 Live 的最小价位、数量步长、最小名义价值与市场导出不一致就拒绝 |

## 10. 实施顺序与验证

实施分三个 PR，都基于 `main`。v8 一次启用，不同时支持 v7。
1. **共用模块**：`order_rules`、`protection`、`Subscriptions` 扩展、Live 节奏门。接入三处，审计判定同时切换。
2. **契约 v8**：
   - 分配注入、构造参数和 `WARMUP`；
   - 预热：回放用 Catalog 加临时 Catalog，Paper 和 Live 用临时 Catalog，runner 的预热 actor；
   - 首根、`on_stop`、`--leverage` 与条款比对；
   - 技能文字同一个 PR 改。
3. **清理**：删除 v7 分支、`RETAINED_FORMATS`、旧 manifest 读取、Paper 工厂计数恢复。

合并前要知道的：v8 合并后，现有账本里的候选不能再跑（研究会话、Paper 新启动、Live 声明）。这与用户"备份后删除旧账本"的决定一致。合并时机由用户定。

验证：
- **原生负例探针**，每种一个失败用例：
  - 预热缺根、重复；
  - 回应超时、衔接错位；
  - 预热前下单；
  - 先订阅后预热；
  - GTD 不足 600 秒；
  - 实例晚开始。
- **账户探针**：rc7 杠杆和 `margin_init` 的保证金公式。
- **派生与原生聚合逐根相等**：OHLCV 相同，时间按约定差 1ms。另核对 Binance 同周期 K 线与派生值是否相等。
- **同一源码三处各跑一次**：
  - 回放；
  - Paper 隔离运行；
  - Live 的离线原生测试（`BacktestEngine` 驱动 Live 包装，同 `tests/engine/test_live_connection.py`）。

  核对输入、首根、预热和订单规则一致。
- **确定性**：同一回放跑两次，指纹相同。
- **成对回放**：一份参考源码分别按 v7 和 v8 写，在同一窗口成对回放。差别只能来自本文列出的改动，逐项解释。

## 11. 实施时还要定的

- 预热回应超时的值（Paper 和 Live 实测）。
- rc7 的 Catalog 能否读到建节点之后才写入的文件。Paper 和 Live 的 T 晚于建节点，历史只能在 T 之后写；读不到就先建好 Catalog 再建节点，节点延后到 T 之后启动。
- Binance 刚收盘的 K 线在 T 之后几秒取到的是否已是终值。在证据包里记录取数时刻，由 R3.2 比对。
- 多实例回放里，各实例的历史请求在同一时刻是否互相影响。
- `WARMUP` 根数的上限（按内存实测）。
