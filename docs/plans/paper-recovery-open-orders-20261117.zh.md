# Paper 恢复：带持仓和工作单的运行也能恢复（设计，2026-11-17）

状态：设计已定，分四个 PR 实施（各自基于 main）：索引缺陷修复 #3151（已合并）；带工作单的切点、暂停不撤单与停机检查 #3154（已合并；实施时把"不撤单"放宽到任何在源码启动之前就停下的恢复，不只停机检查拒绝，STOP 与时长到照旧撤单；`.agents/evals/research-round/paper-recovery-protocol` 的 Q2 因此过时，按 `.agents/README.md` 另开 PR 改）；跨聚合桶补齐；无协议源码的保持模式。用户 2026-11-17 选"1"，授权改 Paper 恢复的拒绝条件，目标是让持仓带着保护单（止损、目标）的运行像 Live 那样挺过中断；同日对本文的待决定事项作了决定（"用户决定"一节）。实施按 AGENTS.md 走成对验收。

## 起因

- `engine/paper_session.py` `Session.cut` 要求所有订单都已终结（"orders are not all terminal at the checkpoint"），所以一个持仓挂着止损的运行永远存不下切点；`before_stop` 在暂停时见到非终结订单也把切点标为不可用。
- SIGTERM 时，没有声明 `PAPER_RECOVERY = 1` 的源码照 STOP 撤掉工作单（`engine/paper.py` `pausing()` 为假）；声明了的源码暂停不撤单，但最后一个切点早于进场，恢复拿不回持仓和止损。
- 2026-11-17 主机重启结束了 Paper 运行 2（`pa-trend-second-entry@52`，无恢复协议）：1000PEPE 多单的止损和目标被撤，运行结束（发现 20261117-04，`docs/plans/doctor/2026-11-16-release-weak-points.zh.md`）。
- Live 的做法（`engine/README.md` Live execution；`live-continuous-step4-resume-20261113.zh.md`）：SIGTERM 只撤在途入场单，持仓和交易所止损留着；同一个原生缓存重启。中断期间止损仍在交易所工作，这是 Paper 没有的。

## 原生探针（锁定 Nautilus 2.0.0rc7）

探针脚本只在本机临时目录，不是产品代码。环境：`ghcr.io/qoeop/trade-runtime:exec-main` 镜像（nautilus_trader 2.0.0rc7，镜像自带的 Redis），`--network none` 的一次性容器；真实的 `LiveNode`、Binance USD-M 数据客户端、Sandbox 执行客户端、原生 Redis 缓存；数据客户端的 `base_url_http` / `base_url_ws` 指向容器内的回环假服务器，只答 `exchangeInfo`（取自 Binance 公开接口，只留 BTCUSDT）和收盘的 1 分钟 kline。Sandbox 配置照 `engine.paper.build_node`（HEDGING、MARGIN、L1、bar 撮合、GTD 和条件单开、`use_position_ids=False`、默认填充模型、maker/taker 0.0002/0.0005），策略配置用 `engine.strategy.source_config`。

剧本：第 1 根 bar 两张可成交限价入场（0.010 与 0.020），成交后挂：仓位 1 的只减仓止损 99000 和目标 103000、仓位 2 的止损 99500、一张 GTD 1 小时的买限价 98500、一张 9 秒后到期的 GTD 买限价 90000、一张买入止损入场 104000。之后第 5 根 bar 低点 99400、第 6 根 98900、第 7 根高点 104200、第 8 根低点 98400。三种跑法：

- baseline：0–9 连续跑；
- first + resume：跑到第 4 根后停节点（不撤单，同 Paper 的暂停），Redis `SAVE` 出 RDB，进程退出；新 Redis 从 RDB 起，新节点 `with_load_state(True)`、`with_reconciliation(True)`、起始余额取缓存里的账户（同 `build_node`），继续 5–9；
- resume_gap：同上，但跳过第 5、6 根（模拟停机期间的行情没进撮合）。

结果：

| 检查 | baseline | first + resume |
|---|---|---|
| 停点的工作单 | — | 止损×2、目标、GTD×2、买入止损全部 ACCEPTED，venue 订单号与触发价、到期时间原样回到缓存 |
| 恢复后账户 total / locked / free | — | 99998.50 / 1975.00 / 98023.50，与停点相同（工作单的保证金也回来了） |
| 第 5 根：仓位 2 止损 99500 | 成交 0.020 @ 99500，手续费 0.995 | 相同，且只平仓位 2 |
| 第 6 根：仓位 1 止损 99000；目标 103000 | 成交 0.010 @ 99000；目标随仓位平掉被撤 | 相同 |
| 第 7 根：买入止损 104000 | 成交 @ 104000，新仓位 | 相同 |
| 第 8 根：GTD 买限价 98500 | 成交 @ 98500 | 相同 |
| 结束账户 total / locked / free | 99976.293 / 675 / 99301.293 | 相同 |
| 短 GTD | 到期后第一根 bar（第 7 根）发 OrderExpired | 到期落在停机期间，恢复后第一根 bar（第 5 根）发 OrderExpired，时间戳是那根 bar 的 |
| 原生回读（`NativeCache._native`：属主缓存的 orders、positions 对 `load_all()`，在 `node.dispose()` 之后比） | 一致 | first、resume 都一致（含恢复后的限价单） |

resume_gap（评审后重跑，同一个 first 的 RDB）：第 5、6 根没进撮合。第 7 根开盘 99100：仓位 2 的止损 99500 按开盘价成交在 99100（连续跑是 99500），仓位 1 的止损从未触发，第 7 根高点 104200 打到目标 103000，仓位 1 以 +29.294 平仓（连续跑是 −10.995 止损出场）。结束 total 100008.586，连续跑 99976.293。停机期间的行情若够到工作单，恢复后的结果就是编出来的。

探针没覆盖的（列入实施的成对验收）：运行中、恢复之后、仍有工作单时由 `_freeze` 做的切点（含账户的回读比较）；恢复后再下新单（venue 订单号计数从头数、跳过冲突的路径）；PARTIALLY_FILLED 与已触发 STOP_LIMIT 的恢复。

由此得出的原生事实：

1. Sandbox `start()` 调 `load_open_orders()`，把缓存里 `orders_open` 的订单（ACCEPTED、TRIGGERED、PENDING_*、PARTIALLY_FILLED，非 emulated）按 `ts_init` 排序交给各合约撮合引擎的 `restore_open_order`（`crates/adapters/sandbox/src/execution.rs`，`crates/execution/src/matching_engine/mod.rs`）。恢复后止损、限价、GTD 到期都照常在后续 bar 上发生，结果与连续跑逐笔相同。
2. 恢复的订单都进入"撮合后维护"集合，GTD 由撮合引擎在下一次撮合时按 bar 的时间判到期；停机期间到期的订单在恢复后第一根 bar 才到期。
3. 撮合引擎自己不进缓存的状态：OTO 子单的待触发集合（`pending_oto_order_ids`；待触发的子单是 SUBMITTED，不在 `orders_open`，恢复时直接丢）、L1 的买卖价和最新价（恢复后由第一根 bar 重建）、venue 订单号与仓位号计数（已知：订单号冲突时跳过，日志 ERROR；仓位号已改用执行引擎的 `P-…`）、跟踪止损的激活与跟踪价。项目的订单规则禁止列表、括号、条件和关联单、改单和 emulated（`engine/order_rules.py` 规则 4），所以 OTO/OCO 不会出现；跟踪止损作为出场单没被规则禁止。
4. **缺陷**：恢复后 `cache.position_id(order)`（订单→仓位，`load_index_order_position` 从库里读回）正确，但 `cache.orders_for_position(position)` 只列出已成交进仓位的订单，未成交的止损、目标不在其中。原因在 rc7 `Cache.build_index`：`position_orders` 只由 `position.client_order_ids()`（成交过的订单）建。撮合不受影响（它用订单→仓位），但本项目两处用 `orders_for_position`：`engine.protection.of_position`（运行中的保护缺口判定，恢复后会误报 `protection_gap`）和 `engine.order_rules.stops_held`（规则 3 "一个仓位的工作止损不超过其数量"，恢复后看不见已恢复的止损，源码能再挂一张而不被拒）。Live 同样受影响：带 `load_state` 重启后 `engine/live_session.py` 的保护判定也走 `protection.of_position`。pyo3 的 `Cache` 没有公开重建索引或 `add_position_id`。

## 设计

### 切点要存什么

不加新东西。原生 RDB 已经带着工作单（含全部事件、venue 订单号、触发价与限价、到期时间、标签）、订单→仓位索引、仓位和账户；策略私有状态照旧走 `on_save`/`on_load`（源码要自己存"哪张工作单属于哪个计划"，或像现有 EMA 源码那样从原生订单的标签推回）；Recorder 的保护缺口状态已在切点里。停机期间行情的检查（下文）在恢复时现取 Binance 公开 klines，不存。

### 切点的拒绝条件（改）

`Session.cut` 和 `before_stop` 的"订单必须全部终结"换成"每张未终结的订单都处在 Sandbox 能原样恢复、且停机检查能判定的状态"：

- 状态是 ACCEPTED（STOP_LIMIT 还可以是 TRIGGERED），不在途（没有 INITIALIZED、SUBMITTED、PENDING_UPDATE、PENDING_CANCEL）；
- 不是 emulated，没有 `contingency_type`、`parent_order_id`、`linked_order_ids`（规则 4 已拒，这里是恢复自己的前提，不依赖规则）；
- 不是 TRAILING_STOP_MARKET / TRAILING_STOP_LIMIT（停机期间跟踪价会移动，下文的检查判不了）；
- PARTIALLY_FILLED：bar 撮合、不消耗流动性时实际不会出现；实施阶段若成对探针证明恢复正确就允许，否则也拒。

其余条件不变：回调已完成、没有挂起的数据回调、没有用户定时器、订阅固定、保存钩子返回字节、原生回读一致（`_freeze`）。拒绝的写法沿用 `PAPER_RECOVERY_UNAVAILABLE` 推迟切点。

### SIGTERM 时做什么

- 声明恢复协议的源码：照旧暂停、不撤单。暂停在调 `handle.stop()` 之前等在途订单（已提交未受理）落定，上限沿用 `STOP_CANCEL_SECONDS`（Sandbox `stop()` 会拒掉还在入站队列里的命令，所以必须在停节点之前等）；之后 `before_stop` 按上面的条件判，最后一次 `try_cut` 发布带工作单的切点。
- 没有声明的源码：同样暂停、不撤单，进入保持模式（见"保持模式"一节，用户决定第 1 条）。
- 被直接杀掉（SIGKILL、OOM、断电）：仍以每秒的运行中切点为准；最后一次切点之后有回调就是 dirty，拒绝恢复，原件保留。不变。

### 恢复时怎么还原和核对

1. 和现在一样：校验原件、从切点的 RDB 起新 Redis、`with_load_state`、起始余额取缓存账户、`with_reconciliation(True)`；Sandbox 自己从缓存恢复工作单（原生事实 1）。不写任何订单、余额或成交。
2. 不跨未观察的资金费结算（不变）。跨声明聚合的桶边界不再拒绝，改为补齐（见"跨聚合桶边界"一节，用户决定第 3 条）。
3. **新增：停机期间的行情检查**。在 T 的预热读取里一并做（同一个读取线程、同一个公开接口 `engine.klines.bars`、经出口代理），在任何源码启动、任何实时订阅开始之前判定：对每个持有工作单的合约，取从日志里该合约最后一根 bar 之后到 T 为止（含收于 T 的那一分钟）的 1 分钟 klines，对缓存里每张恢复的工作单判断这段行情是否"可能改变了它"：
   - 止损类（STOP_MARKET、未触发的 STOP_LIMIT）：买单 high ≥ 触发价，卖单 low ≤ 触发价；
   - 限价类（LIMIT、已触发的 STOP_LIMIT）：买单 low ≤ 限价，卖单 high ≥ 限价；
   - LIMIT_IF_TOUCHED：买单 low ≤ 触发价，卖单 high ≥ 触发价；
   - GTD：到期时间 ≤ T。
   写成"能证明没被碰到才放行"：上面没列出的订单类型（如 MARKET_IF_TOUCHED）、状态（如已触发的 LIMIT_IF_TOUCHED）或触发价类型（`trigger_type` 不是 DEFAULT/LAST，例如按 MARK 触发，LAST 的 klines 判不了）一律拒。用"碰到"而不是填充模型的"穿过"，宁可多拒。任何一张命中、或这段 klines 取不全，都以 `PAPER_RECOVERY_UNAVAILABLE` 拒绝这次恢复，原因写明哪张单、哪一分钟。
   拒绝时：日志一条 `refusal`（`code`、`reason` 两个已有字段），然后**按暂停停下，不撤单**（停止序列里 `pausing()` 对这个原因也为真），封存原因 `REFUSED:PAPER_RECOVERY_UNAVAILABLE`。现有的被拒运行停止序列会撤掉所有工作单（`pausing()` 只对 SIGTERM/SIGINT 为真）；今天切点里没有工作单，所以无害，改后它会在恢复时刻的墙钟上撤掉恢复出来的止损和目标，记下中断的行情里没发生过的事，而运行照样以无保护的持仓结束。不编任何成交。这个运行就此结束、不再重试：一旦 `resumed` 及之后的行写进日志，`checkpoint.read` 会因日志尾部不再匹配而永久拒绝（`engine/paper_checkpoint.py`），最后一个好切点和它的原件只作为证据保留、随封存存档。
   这不是第二个撮合引擎：它不产生任何成交或状态，只判断"停机期间什么都不会发生"这一前提是否成立；成立才让 Nautilus 接着撮合。
   检查的区间止于 T。T 之后到第一根实时 bar 之间若再缺 bar（订阅晚于 T，最多到预热期限），按运行中的普通行情缺口处理：日志记 `data_gap`，Sandbox 不撮合那几分钟，`paper compare` 归到 `missing_bar`，今天运行中的 WebSocket 断线也是这样。停机比普通缺口管得严，原因是停机的缺口是确定的、可以长达数小时，而且发生在本设计要接管的持仓上；订阅延迟的缺口有预热期限封顶，和运行中的断线同类。评审建议把区间延到第一根实时 bar，见"独立评审"。
4. 恢复后的 bar 照常：Recorder 的 `last_bar` 从日志恢复，第一根实时 bar 记 `data_gap`，停机区间在日志里本来就看得见。
5. 修缺陷 4：`engine.protection.of_position` 与 `engine.order_rules.stops_held` 取一个仓位的订单时，除 `orders_for_position` 外再并入 `cache.position_id(订单) == 该仓位` 的未终结订单（订单→仓位索引恢复后是对的）。未中断的运行结果不变（两者在那时一致），属于"修已有缺陷"。这也改了 Live 带缓存重启后的保护判定，验收要包括 Live 的恢复。另在 `strategy-authoring.md` 写两句：找一个仓位的工作单用 `cache.position_id`，恢复后 `orders_for_position` 只列已成交的单；`on_load` 之后缓存里已有的保护单不要在 `on_start` 里再挂，否则规则 3 会拒掉运行。已单独修复：PR #3151（配对回放验收一致，见该 PR 的评论）。上游未报，见"用户决定"。

### 考虑过、没选的做法

- **把停机期间的 bar 补喂进撮合再上线**：成交时间戳会是恢复时的墙钟而不是那根 bar 的；源码在停机期间对这些 bar 和成交的反应没法补；等于在 Nautilus 之外拼一段回放。违背"停机期间不编造成交和结算"。
- **停机期间命中就照样恢复、只记一笔**：resume_gap 探针说明结果会是编出来的盈亏，不诚实。
- **每次重启都从头重建（新账户）**：已被既有决定否掉（恢复绝不换新账户）。

### 拒绝条件的变化一览

| 位置 | 现在 | 改后 |
|---|---|---|
| `Session.cut`（两处） | 任何非终结订单 → 推迟切点 | 只有在途、emulated、条件/关联、跟踪止损（及未证明的部分成交）→ 推迟 |
| `Session.before_stop` | 暂停时有非终结订单 → 切点不可用 | 同上的条件；先等在途订单落定 |
| 恢复（`Session` 构造、`maybe_begin`；T 的预热读取） | 跨聚合桶边界、跨资金费结算 → 拒 | 跨聚合桶边界 → 补齐后继续；跨资金费结算 → 拒（不变）；加：停机期间的 1 分钟行情碰到任一恢复的工作单（含补齐时源码新下的单），GTD 到期落在停机期间，有判不了的订单类型、状态或触发价类型，或取不到这段行情 → 拒，按暂停停下、不撤单 |
| `Session.cut`（无协议源码） | 一律推迟（"the source has not completed its recovery protocol"） | 同上的订单条件；有持仓才发布（保持切点）；空仓的暂停不发布，照今天封存 |
| `pausing()` | 只对声明协议的源码 | 所有带原生缓存的运行 |
| 切点（声明聚合） | — | 加：某个声明聚合的桶已结束、它的聚合 bar 还没交给源码时推迟 |

### 与回放的一致（`paper compare`）

不改比较代码。停机区间在日志里是 `data_gap`，比较按已有的 `missing_bar` 原因解释该窗口内的差异。新增的停机检查保证恢复的工作单在停机期间不会有成交或到期，所以停机带来的差异只剩源码自己错过的决策（现有协议已接受，也归到 `missing_bar`）。实施时的成对验收：同一段行情上的连续 Paper 与中断—恢复 Paper（用上面的回环假服务器跑产品的 `engine.paper.main`），orders、fills、fees、account 逐项相同，其中包括恢复后、仍有工作单时由 `_freeze` 发布的切点（账户也回读比较）和恢复后再下的新单；再加拒绝路径（在途单、跟踪止损、停机命中、GTD 落在停机期间、按 MARK 触发的单、取不到 klines）各一条，拒绝后日志里不得有撤单；再加 Live 带缓存重启后的保护判定。

### 存储字段

无新增。检查点 RDB 与 `current.json` 的格式不变（RDB 里多的只是原本就会有的工作单）；日志不加新行或新字段：停机检查的拒绝用已有的 `refusal` 行（`code`、`reason`；订单号和分钟只是 `reason` 里的文字，消费者只读 kind 与 code，`ledger/paper.py`），运行中的推迟沿用运行器日志的 `Paper checkpoint deferred`；检查通过时不写东西，停机区间由已有的 `resumed` 与 `data_gap` 行表明。若评审或实施发现需要把停机检查的结论写进 `events.jsonl`，那是新存储字段，先停下问用户。

保持模式与补齐也不加存储字段。已有字段的新取值只有一个：概要与封存的 `stop_reason` 多 `HELD_FLAT`（保持中仓位全平、运行结束），它要进 `ledger/paper.py` 的 `CLEAN_STOPS`（否则封存会记 `STOPPED:HELD_FLAT`），IDE 的 `ide/web/src/model/ending.ts` 要给它一个说法。保持状态本身不存：由源码类是否声明协议推出。

### 实施要改的文字

`engine/README.md` Paper trading 一节（"User timers and nonterminal orders are outside this protocol"）、`engine/paper.py` 与 `engine/paper_session.py` 的模块说明、`.agents/skills/research-round/references/strategy-authoring.md` 第 64–67 行（"A run with any order not final, a working stop included, is not resumed even then"）——后者是技能文字，按 `.agents/README.md` 改；同处写明跟踪止损会让切点存不下（中断即结束），无协议源码中断后进入保持模式，跨桶恢复时补齐的聚合 bar 会在 `on_start` 之后、实时数据之前交给 `on_bar`。

## 用户决定（2026-11-17，经协调会话转达）

- 待决定第 1 条（无恢复协议的源码像 Live 一样保持）：「要，和 Live 一致」。
- 待决定第 3 条（聚合桶边界的拒绝）：「放宽，补齐后继续」。
- 第 2 条 GTD 到期落在停机期间：拒绝恢复（本设计原案）。
- 第 4 条停机检查拒绝之后：不撤恢复出来的工作单（本设计原案）；无协议源码的情形由保持模式接管。
- 第 5 条跟踪止损：在策略编写指引里写明它会让切点存不下。
- `orders_for_position` 的索引缺陷单独修，单独一个 PR，带不修就失败的测试；Live 重启同样受影响。上游 nautechsystems/nautilus_trader 按 `orders_for_position`、`position_orders`、缓存重启后的索引检索 issue 与 PR，没有找到报过这个问题的（#4688 "Fix orderless position cache indexing" 修的是另一处）；develop 分支的 `Cache.build_index` 仍只由 `position.client_order_ids()` 建 `position_orders`。没有替用户去上游开 issue（对外发帖要用户点头）。

## 保持模式：无恢复协议的源码（「要，和 Live 一致」）

### 原生探针

同上文的回环环境与剧本（两张多单各带止损、仓位 1 带目标、两张 GTD 买限价与一张买入止损入场）。first 照旧在第 4 根后停节点、不撤单、存 RDB；held 从这个 RDB 起新节点，**不加源码**，只加一个运行器自己的策略类，用同一个策略 ID（`source_config`），它在 on_start 撤掉所有非只减仓的工作单（入场单），其余什么都不做；然后照常喂第 5–9 根。

| 检查 | baseline | held |
|---|---|---|
| 启动时 | — | 账户 99998.50 / 1975.00 / 98023.50 与停点相同；买入止损、两张 GTD 入场被撤（OrderCanceled 回到同一个策略 ID） |
| 第 5 根仓位 2 止损 99500 | 0.020 @ 99500，手续费 0.995，只平仓位 2 | 相同 |
| 第 6 根仓位 1 止损 99000；目标 | 0.010 @ 99000；目标随仓位平掉被撤 | 相同 |
| 结束 | 还有入场单打出的新仓位 | 空仓，locked 0，total 99977.01 |
| 回读 | 一致 | 一致 |

结论：订单事件按策略 ID 路由，运行器自己的策略类用源码的 ID 就能收到恢复出来的订单的成交与撤单、也能撤它们；保护单的结果与连续跑逐笔相同。入场单被撤是保持模式有意的差别（与 Live 一致）。

### 设计

- **原生状态从哪来**：无协议源码今天从不发布切点（`Session.cut` 第一个条件就拒）。改后它也发布原生切点：原生 RDB（订单、仓位、账户、订单→仓位索引）加 Recorder 状态，`sources` 为空，`current.json` 格式不变；不存源码状态，因为恢复时不启动源码。切点条件取与源码状态无关的那部分：没有正在执行的回调、没有挂起的数据回调、没有运行时失败、订单都能原样恢复（上文"切点的拒绝条件"），另加"至少有一个持仓"——空仓时没有要保持的东西，不发布，中断后照今天封存。保存钩子、订阅、用户定时器这几条对它不适用。运行中照样每秒尝试（`try_cut`），所以 SIGTERM 之外的中断也有最近的切点可用。Redis 的缓存文件就是这份切点里的 RDB，不另留。
- **SIGTERM**：所有带原生缓存的运行都按暂停停下、不撤单（`pausing()` 不再看源码是否声明协议），停节点前等在途订单落定，最后发布切点。用户 STOP、时长到、运行被拒或失败照旧撤单。
- **kill -9、OOM、断电**：同有协议源码：以最后一次切点为准；最后一次切点之后有过回调就是 dirty，拒绝恢复，运行结束，原件保留（和今天一样丢保护，Paper 没有交易所替它守止损）。保持中的运行回调很少（只有订单、仓位事件和 Recorder 的 bar），切点之后没回调的概率比有源码时高，但不保证。
- **恢复（保持启动）**：源码类没有声明 `PAPER_RECOVERY = 1` 的运行，恢复一律是保持启动（不存标志，由封存的源码推出）。校验原件、`with_load_state`、起始余额取缓存账户、`with_reconciliation(True)`；Sandbox 自己恢复工作单。每个实例不构建源码，换成运行器自己的保持策略（同一个 `source_config`、同一个策略 ID，原生事件按策略 ID 路由，探针已证），不预热、不补齐聚合；资金费结算检查不适用：拒绝它是因为源码看不到那次结算，保持中没有源码；钱的一面本来就由封存按 Binance 公布的结算、对日志里当时的持仓结算（`ledger.paper.settlements`），停机期间的也算到。停机行情检查照做：在 T（`history.start_at`）用同一个读取线程取 klines，碰到即拒、按暂停停下不撤单，运行结束。通过后保持策略在启动时撤掉继承来的入场单（非只减仓的工作单，与 Live 一致），止损和目标留着；Recorder 照常订阅 1 分钟 bar 并写日志（`bar`、`order`、`position`、`data_gap` 行），保护缺口判定照常。
- **结束**：所有仓位都平了，保持策略撤掉剩下的工作单并请求停止（`stop_reason` = `HELD_FLAT`），写概要，守护进程照常封存。保持中用户 STOP 照 STOP（撤单、结束）；保持中再 SIGTERM 又是暂停，恢复后继续保持。
- **记录**：日志不加新行或新字段；哪段是保持由已有的 `resumed` 行加源码类推出。`paper compare` 把首个 `resumed` 之后的差异另归一类（"保持"，由同样两件事推出），不算未解释：保持中不再入场，回放里的源码会。
- **有协议源码的恢复被拒后要不要也转保持**（用户默认里"若第 1 条覆盖则适用保持"）：本设计的第 1 条按用户原话覆盖的是无协议源码。有协议源码被拒的原因里，停机检查命中、GTD 落在停机期间、取不到 klines 这几种，转保持也不诚实（停机期间本该发生的成交补不回来，resume_gap 探针），所以照原案：按暂停停下、不撤单、运行结束。剩下的资金费结算拒绝，转保持在经济上说得通，但要让之后的每次恢复都知道"这次是保持"：有协议源码的切点 `sources` 为空本身分不清是保持还是尚未启动，得新存一个值或从日志推（如 `resumed` 之后的 `refusal` 行），这需要另行设计，本次不做，列为待办。

## 跨聚合桶边界：补齐后继续（「放宽，补齐后继续」）

### 原生探针

同一套回环环境（`exec-main` 镜像，rc7 `LiveNode`，Sandbox，原生 Redis，`time_bars_timestamp_on_close`、`time_bars_build_delay = BUILD_DELAY_US`，同 `build_node`），实时墙钟跑。P 取 3 分钟与 15 分钟各跑一遍。源码订阅 1 分钟 bar 和一个 INTERNAL 聚合 P；每根 P 收盘按桶号下买限价：桶 0 收盘 L1 98000，桶 1 收盘 L2 97500。行情：桶 0、1 都够不到这两个价，T 之后第二、三分钟依次打到 98000 和 97500。三种跑法同上（baseline 连续；first 跑到桶 1 的第二分钟后停节点、不撤单、存 RDB；resume 从 RDB 起，停机跨过桶 1 的结束，T 落在下一个桶里）。runner 端的补齐用一个运行器自己的 DataActor：在 T 后 2 秒请求 [F 起点, T) 的 1 分钟 bar（缺的分钟写进临时 Catalog，同 `history.fetch`），之后再让源码订阅并把补齐的聚合 bar 交给它。

| 跑法 | P = 3 分钟 | P = 15 分钟 |
|---|---|---|
| baseline | 桶 0 → L1，桶 1 → L2；L1 @ 98000、L2 @ 97500 成交，total 99999.609 | 同（时间不同，价位同） |
| 一次请求带 `update_subscriptions`，回答之后才订阅 | 回答里只有 1 分钟 bar，没有聚合 bar；桶 1 的 bar 没交给源码，L2 没下；之后的实时聚合 bar 正确（只含当前桶的分钟） | — |
| 先订阅 P 再请求 | 请求被拒："Cannot request aggregated bars: one of the aggregators in `bar_types` is already running" | 同 |
| 请求之后立即订阅（同一回调里） | 订阅收不到补齐的 bar | — |
| 拆成两次：已结束的桶不带 `update_subscriptions`，当前桶带 | 两次回答都只有 1 分钟 bar | — |
| 一次请求带 `update_subscriptions`（即现在的预热请求，只是起点前移到 F），回答后读 `cache.bars`：用组合类型（`…-P-LAST-INTERNAL@1-MINUTE-EXTERNAL`）读 | 0 根 | 0 根 |
| 同上，用标准类型（`bar_type.standard()`，`…-P-LAST-INTERNAL`）读，交给源码 on_bar 后才订阅 | 读到桶 1 的 bar：o/h/l/c/v 100100/100300/99700/99900/30，`ts_event` = 桶结束 + 5 秒，与连续跑的那根相同；源码据此下 L2；L1 @ 98000、L2 @ 97500 成交，手续费 0.196/0.195，期末 total 99999.609、locked 651.667，与连续跑相同 | 读到桶 1 的 bar：100110/100230/100050/100170/150，`ts_event` 同连续跑；L2 下单；成交、手续费、期末账户与连续跑相同 |
| 拆成两次但已结束的桶那次也覆盖到 T，再按标准类型读 | 同上一行 | 同上一行 |

与连续跑唯一的差别是 L2 的提交、受理时间：连续跑在桶 1 收盘时，恢复在 T 之后（预热读取完成时）。之后的实时聚合 bar（当前桶）与连续跑相同，说明同一个聚合器在回答后转成了实时的，接着走当前桶。

原因在锁定版本的 `crates/data/src/engine/bar.rs`（`set_request_bar_aggregator_chain_handlers`）："Request-generated bars are delivered only through the cache"：请求里聚合出来的 bar 只经 `cache.add_bar_historical` 进缓存，不进回答，也不发布到订阅；缓存按 bar 自己的类型（标准类型）存，所以用组合类型读不到。补齐的聚合 bar 因此由运行器在回答之后按标准类型从原生缓存里读，再交给源码。探针里按 `ts_event` 筛出 (F 起点, T] 的那几根；产品里还要排除 T 之前当前桶里已存在的 bar（不会有：当前桶未完成）。

### 设计

- 资金费结算的拒绝不变。
- 设 P 是源码声明的一个聚合周期，L 是日志里该合约最后一根 1 分钟 bar，F 是 L 之后第一分钟所在的桶（L 是某桶最后一分钟时 F 是下一个桶，否则 F 是 L 所在的桶）。跨了桶边界（F 的结束 ≤ T）时：
  1. P 的声明历史按 F 的起点取（`history_range(F 起点, P, count)`），即源码在 F 开始前本来就知道的那些 bar，而不是按 T 取（按 T 取会把补齐的 bar 当历史再给一遍）。
  2. WarmupActor 用原生聚合器补齐：把现在的预热请求从 [floor(T, P), T) 前移到 [F 起点, T)（1 分钟 bar 由 `history.fetch` 写进临时 Catalog，`bar_types` 为 P 的聚合类型、`update_subscriptions`，同现在）；回答之后从原生缓存 `cache.bars(P 的聚合类型.standard())` 读出结束在 (L, T] 的完整聚合 bar（rc7 只把请求里聚合出的 bar 放进缓存，按标准类型存，见探针），在源码 on_load、on_start 之后、任何实时数据之前，按结束时间依次交给源码的 on_bar（与实时一样经 `_hold`）；当前桶由同一个聚合器接着实时数据走。1 分钟 bar 本身仍不补给源码（现有协议）。不自己折算 OHLCV。
  3. 源码处理补齐的 bar 时新下的单，要过同一个停机行情检查：从那根聚合 bar 结束到 T 之间的 1 分钟 bar 碰到它，就拒绝恢复（按暂停停下，不撤单）。规则同上文"能证明没碰到才放行"，所以 MARKET 单（连续跑里在那根 bar 收盘时成交，恢复后会在 T 之后的价位成交）一律拒。没碰到，它在 T 之后第一次撮合的结果与连续跑相同；与连续跑不同的只有订单的提交、受理时间（T 之后而不是那根 bar 收盘时），`paper compare` 按已有的 `missing_bar` 归因。补齐时撤的单是恢复出来的单，它们已过停机检查，撤早撤晚撮合结果相同。
  4. 切点再加一个条件：某个声明聚合的桶已经结束、而它的聚合 bar 还没交给源码（结束后 `BUILD_DELAY_US` 内）时不发布切点，否则恢复时分不清那根 bar 交过没有。

## 原待用户决定（2026-11-17 已决定，见"用户决定"）

1. **不声明恢复协议的源码要不要也像 Live 一样"保持"**：运行 2 正是这类源码，本设计救不了它。Live 对恢复不了源码状态的情形用"保持"：不构建源码、不入场，只让交易所的止损管着持仓直到空仓。Paper 可以对应地做：中断时不撤保护单、存只含原生缓存的切点；恢复时不启动源码，只让 Sandbox 用实时 bar 撮合已有的止损、目标，空仓后结束运行。这要放开无协议源码的切点、新的启动分支和页面显示，是另一项范围，需要用户点头。
2. **GTD 到期落在停机期间**：本设计拒绝（"停机期间什么都没变"这个前提才干净）。另一种是接受，由 Sandbox 在恢复后第一根 bar 到期、时间戳晚于真实到期（探针已见）。Paper 运行中本来就接受 GTD 晚一根 bar 到期（`replay/comparison.py` 的 `bars` 说明，2026-11-14 探针），接受在做法上与之一致，只是停机时晚得更多。前者少恢复，后者有一个时间不准的到期事件。
3. **聚合桶边界的拒绝**：15 分钟聚合的源码，两三分钟的重启有一成多的概率跨桶被拒，持仓同样丢保护。放宽它是另一条拒绝的改动，不在这次授权内。
4. **停机检查拒绝之后，恢复出来的工作单撤不撤**：本设计不撤，按暂停停下，日志里不出现中断行情里没发生过的撤单；运行就此结束并封存，持仓连同仍在缓存里的止损和目标一起留在记录里。另一种是沿用现有被拒运行的停止序列，在恢复时刻撤掉它们（运行的事件记录多出几条撤单）。
5. **跟踪止损**：订单规则允许跟踪止损作为出场单，但按本设计，持有跟踪止损的运行一个切点也存不下，中断即结束。要不要在策略编写指引里写明，或另行设计。

## 独立评审

2026-11-17，一个新开的子代理只读审阅本文、相关代码、锁定版本的 Rust 源码和探针原始输出，没有拿到作者的结论。结论：**approve with changes**。逐条处理：

| # | 评审意见 | 级别 | 处理 |
|---|---|---|---|
| 1 | 现有的被拒运行停止序列会撤掉恢复出来的工作单；"最后一个好切点保留"说过头了，日志写入 `resumed` 后旧切点永久不可用 | 阻塞 | 采纳：拒绝时按暂停停下、不撤单；写明运行就此结束，原件只作证据；列为待用户决定第 4 条 |
| 2 | 检查止于 T，T 到第一根实时 bar 之间的缺口没人查 | 阻塞 | 部分采纳：写明区间止于 T，T 之后按运行中的普通缺口处理，并说明停机为何更严；没有延长区间，若用户要求再改 |
| 3 | 原始输出里没有 resume_gap；回读只比了 orders/positions、只在 dispose 之后；没下过恢复后的新单 | 非阻塞 | 采纳：重跑 resume_gap 并更新数字；收窄说法；三项列入成对验收 |
| 4 | 原生事实与锁定源码相符（恢复、索引缺口、成交号不撞、到期扫描只管合约到期、恢复的止损仍收 taker 费） | — | 无需改动 |
| 5 | Live 带缓存重启后也走 `protection.of_position`，同样受索引缺口影响 | 非阻塞 | 采纳：写明修复也改 Live，验收包括 Live |
| 6 | 规则 3 看见恢复的止损后，`on_start` 重挂保护的源码会被拒 | 非阻塞 | 采纳：写进策略编写指引的修改 |
| 7 | 检查要失败即拒：MARKET_IF_TOUCHED、已触发的 LIMIT_IF_TOUCHED、非 LAST 触发价没列 | 非阻塞 | 采纳："能证明没碰到才放行"；评审认为这是无状态的保守拒绝，不是平行撮合引擎 |
| 8 | 等在途订单必须在 `handle.stop()` 之前；部分成交"不会出现"没有证据 | 非阻塞 | 采纳 |
| 9 | 与回放一致的说法在机制上成立（`missing_bar` 归因） | — | 无需改动 |
| 10 | 存储字段：确认没有新增；`reason` 里的文字没有消费者解析 | — | 补一句说明 |
| 11 | 第 2 条应引已有的 GTD 晚一根到期先例；补问拒绝后撤不撤单、跟踪止损的后果 | 非阻塞 | 采纳：第 2 条补先例，新增第 4、5 条 |
