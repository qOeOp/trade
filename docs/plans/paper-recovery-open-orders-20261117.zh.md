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
| `build_node`（恢复时） | 有账户而 `sources` 为空 → 拒 | 只对 supported 源码拒；不 supported 的源码按保持启动 |
| 补齐时源码新下的单 | — | 碰到 (bar 结束, T] 的 1 分钟行情或那根 bar 的收盘价（提交时即可成交，含 MARKET）→ 拒，按暂停停下 |
| `paper compare`（审计） | 保持后回放独有的差异会判为 `unexplained` / `look_ahead_suspect` | 加一个归因"保持"（由首个 `resumed` 与源码不 supported 推出）；这是放宽一项审计，用户已允许（见"用户决定"） |
| `ledger/paper.py` `CLEAN_STOPS`（审计） | 不含 `HELD_FLAT` | 加 `HELD_FLAT`；只给新取值归类，不放宽已有结束原因；用户已允许 |

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
- 第 2 条 GTD 到期落在停机期间：拒绝恢复（本设计原案）。2026-11-17 用户改为不拒绝，见"GTD 在停机期间到期：不再拒绝"一节。
- 第 4 条停机检查拒绝之后：不撤恢复出来的工作单（本设计原案）；无协议源码的情形由保持模式接管。
- 第 5 条跟踪止损：在策略编写指引里写明它会让切点存不下。
- `orders_for_position` 的索引缺陷单独修，单独一个 PR，带不修就失败的测试；Live 重启同样受影响。上游 nautechsystems/nautilus_trader 按 `orders_for_position`、`position_orders`、缓存重启后的索引检索 issue 与 PR，没有找到报过这个问题的（#4688 "Fix orderless position cache indexing" 修的是另一处）；develop 分支的 `Cache.build_index` 仍只由 `position.client_order_ids()` 建 `position_orders`。没有替用户去上游开 issue（对外发帖要用户点头）。

- 第二次评审后的三个问题（2026-11-17，用户在主会话的选择题里作答，经协调会话转达）：`paper compare` 把保持开始之后的差异归到新原因"保持"而不是 `unexplained`——「允许 (Recommended)」；`HELD_FLAT` 加进 `ledger/paper.py` 的 `CLEAN_STOPS`——「允许 (Recommended)」；就 `orders_for_position` 的索引缺陷向 nautechsystems/nautilus_trader 提公开 issue（只含最小、自足的复现，不含账户数据、项目名、路径、订单号或本仓库链接，提之前再查一次有无现成 issue）——「提 (Recommended)」。

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
- **SIGTERM**：无协议源码只在 `stop_requested` 那一刻有持仓时按暂停停下、不撤单，停节点前等在途订单落定，最后发布保持切点；空仓时照今天撤单、封存（否则入场单会以 ACCEPTED 留在封存里）。用户 STOP、时长到、运行被拒或失败照旧撤单。
- **保持与完整恢复怎么分**：规则是"`sources` 为空 ⇔ 源码不 supported"（`Session.supported`：声明 `PAPER_RECOVERY = 1` 且有 `on_save`/`on_load`），不只看声明。`build_node` 现在对"有账户而 `sources` 为空"的切点拒绝，改为只对 supported 源码拒绝；supported 源码的空 `sources` 切点仍拒。现在没有别的路径会发布空 `sources` 的切点（`cut` 在就绪前一律拒），所以没有歧义。
- **kill -9、OOM、断电**：同有协议源码：以最后一次切点为准；最后一次切点之后有过回调就是 dirty，拒绝恢复，运行结束，原件保留（和今天一样丢保护，Paper 没有交易所替它守止损）。保持中的运行回调很少（只有订单、仓位事件和 Recorder 的 bar），切点之后没回调的概率比有源码时高，但不保证。
- **恢复（保持启动）**：源码不 supported（见上）的运行，恢复一律是保持启动（不存标志，由封存的源码推出）。校验原件、`with_load_state`、起始余额取缓存账户、`with_reconciliation(True)`；Sandbox 自己恢复工作单。每个实例不构建源码，换成运行器自己的保持策略（同一个 `source_config`、同一个策略 ID，原生事件按策略 ID 路由，探针已证），不预热、不补齐聚合；资金费结算检查不适用：拒绝它是因为源码看不到那次结算，保持中没有源码；钱的一面本来就由封存按 Binance 公布的结算、对日志里当时的持仓结算（`ledger.paper.settlements`），停机期间的也算到。停机行情检查照做：在 T（`history.start_at`）用同一个读取线程取 klines，碰到即拒、按暂停停下不撤单，运行结束。通过后保持策略在启动时撤掉继承来的入场单（非只减仓的工作单，与 Live 一致），止损和目标留着；Recorder 照常订阅 1 分钟 bar 并写日志（`bar`、`order`、`position`、`data_gap` 行），保护缺口判定照常。
- **保持分支要绕开的现有调用**：概要里的 `replay_integrity_findings`、`diagnostics` 是源码类的方法，保持策略没有，跳过（否则封存多一条 `RUNTIME_FAILURES`）；`cut` 里逐个源码读的 `_paper_*` 状态与 `save()` 不适用，保持切点只查订单、回调与运行时失败；STOP 的撤单照遍历 `STRATEGIES`（保持策略同名注册、同样的撤单接口）。停机行情由保持策略在 T 用自己的读取线程取（同 #3154 的 `engine.klines.bars` 与重试、期限），不经源码预热。
- **结束**：所有仓位都平了，保持策略撤掉剩下的工作单并请求停止（`stop_reason` = `HELD_FLAT`），写概要，守护进程照常封存。保持中用户 STOP 照 STOP（撤单、结束）；保持中再 SIGTERM 又是暂停，恢复后继续保持。保持期间同一源码不能另起新运行（`paper/runs.py` 的 `_source_running`），保持可能持续很久，页面要说清这一点。
- **记录**：日志不加新行或新字段；哪段是保持由已有的 `resumed` 行加源码不 supported 推出。`paper compare` 要把首个 `resumed` 之后的差异另归一类（"保持"），否则保持中不再入场、回放里的源码会，这些差异会判成 `unexplained` 或 `look_ahead_suspect`。这是一项审计的放宽，用户已允许（见"用户决定"）。
- **有协议源码的恢复被拒后要不要也转保持**（用户默认里"若第 1 条覆盖则适用保持"）：本设计的第 1 条按用户原话覆盖的是无协议源码。有协议源码被拒的原因里，停机检查命中、GTD 落在停机期间、取不到 klines 这几种，转保持也不诚实（停机期间本该发生的成交补不回来，resume_gap 探针），所以照原案：按暂停停下、不撤单、运行结束。剩下的资金费结算拒绝，转保持在经济上说得通，但要让之后的每次恢复都知道"这次是保持"：有协议源码的切点 `sources` 为空本身分不清是保持还是尚未启动，得新存一个值或从日志推（如 `resumed` 之后的 `refusal` 行），这需要另行设计，本次不做，列为待办。2026-11-17 用户决定转保持，见"资金费结算被错过时转保持"一节（不需要新存储的值）。

### 实施（2026-11-17）

按上面的设计实施，与设计不同或补充的三点（实施 PR 的独立评审提出）：

- SIGTERM 时无协议源码按暂停停下，条件除了有持仓，还要求每张未终结的订单都能进切点（在途的单照旧等）。否则（例如持有跟踪止损）暂停发布不了切点，运行会以未撤的入场单封存，正是第二次评审第 6 条要避免的，所以这时照今天撤单、结束。
- 恢复的期限到了而源码（或保持策略）还没启动时，拒绝原因写进 `Session.refused`，之后才完成的读取不会再启动任何东西（否则会在已经按暂停停下的运行里撤掉恢复出来的入场单）。这也适用于有协议源码的恢复，属于修已有缺陷。
- `paper compare` 判断源码是否声明协议，用页面同一个读源码文本的判定（`paper.serve.declares_recovery`），不运行源码。

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
- 设 P 是源码声明的一个聚合周期，F 是切点时刻 `cut_ns` 所在的桶（与现有跨桶判定同一个基准；不用日志里最后一根 1 分钟 bar，因为实时断线或桶末分钟晚到时，那根之后的聚合 bar 可能已经交给源码，按它定会把同一根 bar 再交一次）。配合第 4 条，结束在 `cut_ns` 之前的聚合 bar 都已交给源码、在切点的源码状态里。跨了桶边界（F 的结束 ≤ T）时：
  1. P 的声明历史按 F 的起点取（`history_range(F 起点, P, count)`），即源码在 F 开始前本来就知道的那些 bar，而不是按 T 取（按 T 取会把补齐的 bar 当历史再给一遍）。
  2. WarmupActor 用原生聚合器补齐：把现在的预热请求从 [floor(T, P), T) 前移到 [F 起点, T)（1 分钟 bar 由 `history.fetch` 写进临时 Catalog，`bar_types` 为 P 的聚合类型、`update_subscriptions`，同现在）；回答之后从原生缓存 `cache.bars(P 的聚合类型.standard())` 读出结束在 (`cut_ns`, T] 的完整聚合 bar（rc7 只把请求里聚合出的 bar 放进缓存，按标准类型存，见探针），在源码 on_load、on_start 之后、任何实时数据之前，按结束时间依次交给源码的 on_bar（与实时一样经 `_hold`）；当前桶由同一个聚合器接着实时数据走。1 分钟 bar 本身仍不补给源码（现有协议）。不自己折算 OHLCV。
  3. 源码处理补齐的 bar 时新下的单，要过同一个停机行情检查：从那根聚合 bar 结束到 T 之间的 1 分钟 bar 碰到它，就拒绝恢复（按暂停停下，不撤单）。规则同上文"能证明没碰到才放行"，触碰的集合除这些 1 分钟 bar 外还包括那根聚合 bar 的收盘价：提交时就可成交的单（限价买 ≥ 收盘、卖 ≤ 收盘，止损买 ≤ 收盘、卖 ≥ 收盘，以及所有 MARKET 单）在连续跑里会按那时的 L1 立即撮合，恢复后要等 T 之后第一根 bar，一律拒（即使那根 bar 恰好结束在 T、分钟区间为空）。没碰到，它在 T 之后第一次撮合的结果与连续跑相同；与连续跑不同的只有订单的提交、受理时间（T 之后而不是那根 bar 收盘时），`paper compare` 按已有的 `missing_bar` 归因。补齐时撤的单是恢复出来的单，它们已过停机检查，撤早撤晚撮合结果相同。
  4. 顺序：补齐的 bar 交完、这一步的检查通过之后，才置 `Session.ready` 并开始实时订阅；检查拒绝时 `ready` 仍为假，停止序列按 #3154 的规则不撤单（`pausing()` 对未就绪的恢复为真），也不发布切点。
  5. 切点再加一个条件：某个声明聚合的桶已经结束、而它的聚合 bar 还没交给源码（结束后 `BUILD_DELAY_US` 内）时不发布切点，否则恢复时分不清那根 bar 交过没有。

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

## 第二次独立评审（新增部分，2026-11-17）

一个新开的子代理只读审阅"用户决定""保持模式""跨聚合桶边界"三节与变化一览、存储字段的新增内容，对照 main（含 #3151、#3154）、锁定版本的 Rust 源码与探针原始输出，没有拿到作者的结论。结论：**approve with changes**，其中一条阻塞。逐条处理：

| # | 评审意见 | 级别 | 处理 |
|---|---|---|---|
| 1 | 补齐的 F 按日志最后一根 1 分钟 bar 定，实时断线或桶末分钟晚于聚合延迟到达时，会把源码已收到的聚合 bar 再交一次 | 阻塞 | 采纳：F 改按 `cut_ns` 所在的桶（与现有跨桶判定同一基准），配合切点窗口规则 |
| 2 | 补齐时新下的单只查 (bar 结束, T] 的分钟；桶恰在 T 结束时区间为空；连续跑会按收盘时的 L1 立即撮合可成交的单 | 应改 | 采纳：触碰集合加上那根聚合 bar 的收盘价，提交时即可成交的单（含 MARKET）一律拒 |
| 3 | 补齐的检查必须在 `ready` 之前，否则拒绝会走撤单 | 应改 | 采纳：写明顺序 |
| 4 | 保持切点会撞上 `build_node` 的"有账户而 `sources` 为空"拒绝；判定应看 `Session.supported` | 应改 | 采纳：规则写成"`sources` 为空 ⇔ 不 supported"，变化一览加一行 |
| 5 | `paper compare` 加"保持"归因是放宽审计，与"不改比较代码"矛盾 | 应改 | 采纳：列入变化一览，标为需用户确认 |
| 6 | SIGTERM 时空仓但有入场单，不撤单又不发布切点，封存里留着 ACCEPTED 入场单 | 应改 | 采纳：只在有持仓时暂停，否则照今天撤单 |
| 7 | 保持策略缺 `replay_integrity_findings`/`diagnostics`；`cut` 读源码字段；不预热时谁读停机行情 | 应改 | 采纳：逐项写明 |
| 8 | `HELD_FLAT` 进 `CLEAN_STOPS` 也算改审计清单；`ending.ts`；保持期间同源码不能新起运行 | 次要 | 采纳：写明，标为需用户确认 |
| 9 | 补齐探针只跨了一个桶；保持探针没跑到 `HELD_FLAT`、保持中再次恢复 | 次要 | 采纳：列入实施的成对验收（跨 ≥2 个桶、跨桶前有实时断线、`HELD_FLAT`、保持中二次恢复） |
| 10–13 | 资金费说法属实；读缓存的做法有 rc7 源码与探针支持，不是平行聚合器；kill -9 与按策略 ID 路由属实；没有新存储字段 | — | 无需改动 |

按协调会话转达的要求（评审发现阻塞即停下报告），阻塞项改完后先停下报告；用户随后允许了第 5、8 条的审计改动（见"用户决定"），补齐与保持两个实施 PR 随后开始。

## GTD 在停机期间到期：不再拒绝（2026-11-17 用户决定「GTD 在停机期间到期不再拒绝」）

原案（用户决定第 2 条）把"恢复时 GTD 已到期"一律拒绝。用户改为：停机期间到期、且停机的 1 分钟行情表明到期之前没碰到它的 GTD，按已到期处理，继续恢复，结果要与连续跑相同。

### 原生事实（rc7 `crates/execution/src/matching_engine/mod.rs`）

`iterate_with_mode` 先撮合（`iterate_bids`/`iterate_asks` 的 FillLimit、TriggerStop），之后才对撮合后维护集合里的订单做 `post_match_order_action`：`timestamp_ns >= expire_time` 才发 OrderExpired（7742–7767）。时间戳是 bar 到达时的墙钟。所以：连续跑在到期之前到达的每根 bar 上都撮合它，到期所在那分钟（到达晚于到期）的开盘一步也撮合，之后才到期；恢复后 Sandbox 在第一根实时 bar 的开盘一步还会撮合一次（重启后 `core.last` 为空，开盘按市价一步，见上文 resume_gap），然后才到期。

### 探针（`exec-main` 镜像，`--network none`，回环假服务器，Sandbox 配置同 `build_node`）

脚本：`/private/tmp/claude-501/-Users-vx-WebstormProjects-trade/0660267b-ae67-4c05-b258-d74244daae37/scratchpad/gtd/`（`node.py`、`run.py`、`summarize.py`；输出 `out2/run-1794928203`）。第 0 根 bar：市价多 0.010 @ 100000 并挂只减仓止损 98000，另挂两张 GTD 买限价 G1 99000、G2 99800，到期 = 墙钟 + 6 秒。bar 都是 100000/100100/99900/100000；cross 变体的第 4 根开盘 99700（穿过 G2，不到 G1）。baseline 连续推 0–7，第 3 根在到期 1.5 秒后才推；first 推 0–2 后停节点、不撤单、SAVE；停 8 秒（到期落在其间）；resume 从 RDB 起，推 4–7（第 3 根是停机）。

| 跑法 | G1、G2 | 期末 total / locked / free |
|---|---|---|
| baseline | 第 3 根（到期后第一根）OrderExpired，未成交 | 99999.50 / 33.33 / 99966.17 |
| resume | 恢复后第一根（第 4 根）OrderExpired，未成交 | 相同 |
| baseline_cross | 第 3 根 OrderExpired；第 4 根开盘 99700 时已到期 | 99999.50 / 33.33 / 99966.17 |
| resume_cross | 第 4 根开盘先撮合：**G2 成交 @ 99800**，G1 到期 | 99999.3004 / 66.60 / 99932.7004 |

### 规则（`engine/paper_session.py` `touched`、`expiring`）

停机期间到期（到期 ≤ T）的恢复单，判"没碰到"用的分钟是：开盘早于到期的每一分钟（含到期所在那分钟，到达晚于收盘时再多一分钟，宁可多拒），加上停机的最后一分钟（收于 T）——第一根实时 bar 的开盘紧接它的收盘，resume_cross 说明那一步会撮合。规则同其他恢复单（碰到即拒）；分钟必须取全。到期之后、最后一分钟之前碰到它不拒：连续跑那时已到期，恢复后 Sandbox 在第一根实时 bar 把它到期。补齐时源码新下的 GTD 若在 T 之前到期，照旧拒。

与连续跑的差别：OrderExpired 的时间是恢复后第一根实时 bar，不是到期后第一根（`paper compare` 里这组订单的差异落在停机的 `missing_bar` 区间内）；中间这段时间入场单的保证金仍锁着（停机期间没有记录）。剩下的风险与所有恢复单相同：T 之后到第一根实时 bar 之间的行情没人查，第一根实时 bar 的开盘若跳过它的价位，就会像 resume_cross 那样成交，而连续跑不会。保持中的运行在启动时撤掉继承来的入场单（非只减仓），GTD 入场单因此不会走到这一步。

## 订阅其他合约的聚合 bar（2026-11-17 用户决定「允许」）

原先切点要求每个源码实例的订阅恰好是自己合约的 1 分钟 bar 加自己声明的聚合，订阅别的合约的聚合就推迟切点、不能恢复。用户允许之后：

- 切点（`Session.cut`、`subscriptions`）：每个实例必须订阅自己的 1 分钟 bar 和声明的聚合，另外可以订阅本运行其他合约的声明聚合（同样的周期）；别的合约的 1 分钟 bar、未声明的周期、动态改订阅仍推迟切点。
- 补齐（`backfill`）：每个合约的实例照旧预热自己合约的聚合；读出的补齐 bar 交给每个订阅它的实例。同一时刻结束的 bar 按固定顺序交：先按时间，再按本运行的合约顺序，每根依次交给订阅者（按合约顺序）。
- 补齐时下的单（`submitted`）：只能是接收实例自己合约的单，用自己合约从桶结束到 T 的分钟判"没碰到"，用自己合约在桶结束那一分钟的收盘判"不可立即成交"（原先用 bar 自己的收盘，对自己合约的 bar 两者相同）。下在别的合约上的单拒绝（那个实例没读那个合约的分钟）。

### 原生成对探针（2026-11-18，`exec-main` 镜像，`--network none`，回环假 Binance，真实 `engine.paper.main`，分支代码只读挂载）

脚本与输出：`/private/tmp/claude-501/-Users-vx-WebstormProjects-trade/0660267b-ae67-4c05-b258-d74244daae37/scratchpad/xagg/`（`strategy.py`、`fake.py`、`run_paper.py`、`orchestrate.py`、`compare.py`、`dispatch.py`；输出 `full2/`）。BTCUSDT、ETHUSDT 两个合约，源码 `WARMUP = {"3-MINUTE": 2}`，每个实例订阅自己的 1 分钟、自己的 3 分钟和另一个合约的 3 分钟；在对方的 3 分钟 bar 上按其收盘挂买限价或撤最高的限价，在自己的 3 分钟 bar 上挂买止损。

| 跑法 | 停机 | T | 补齐 |
|---|---|---|---|
| C1、C2 | 连续 | — | — |
| I1 | A+6.5 分 SIGTERM | A+9（由 A+8 后移） | A+8 一个边界 |
| I2 | A+6.5 分 SIGTERM | A+12（由 A+11 后移） | A+8、A+11 两个边界 |
| R | A+12.5 分 SIGTERM | A+16 | A+14，预期拒绝 |

- C1 与 C2、C 与 I1/I2 共五对相同：每张单的事件序列、成交与手续费、订单事件多重集（掩码后 10 张单）、持仓事件、`fills.csv`/`positions.csv`/`orders.csv` 行多重集、期末余额 99998.36941 USDT 与四个持仓、`STOP_FILE`、0 运行失败、`account.csv` 末行、每个实例处理的聚合 bar 多重集（接收者、类型、时间、OHLCV）。补齐时下的跨合约决定（ETH bar 上的 BTC 限价 99550、BTC bar 上撤 ETH 限价 2995）都发出了，之后的成交、撤单与连续跑一致。
- 预期内的差别：补齐决定的 init/submit/accept 时间是 T+15 s；日志里订单交错不同；I1 恢复后第一张快照标 A+6、取于 A+9.27；I 跑多一条初始账户状态（每次进程启动一条），`account.csv` 中间行因交错不同（C1 与 C2 之间也不同），末行相同。
- R：四张恢复单 `touched` 通过；补齐按 BTC→BTC、BTC→ETH（ETH 限价 2979 通过、发出）、ETH→BTC 交，最后这根上 BTC 限价 99600 对 BTC 分钟收盘 99580 可立即成交，日志 `refusal PAPER_RECOVERY_UNAVAILABLE … is marketable at the close 99580.00`，停止原因 `PAPER_RECOVERY_UNAVAILABLE`，恢复后 0 撤单、5 张单留着；先发出的 ETH 单保留。判定用的是 BTC 自己的分钟收盘，不是 ETH bar 的 2996。
- 每次恢复后都发布了切点（放宽后的订阅检查通过）。

### 实时分发没有固定顺序

15 个运行器进程的 50 组同一时刻的 bar，8 种顺序都出现，只有 5 组与补齐顺序相同；同一进程里哪个合约的 bar 先到逐桶变化（rc7 每个聚合器的定时器是独立的 tokio 任务，`crates/common/src/live/timer.rs:391`）；同一根 bar 先给哪个订阅者在进程内固定、跨进程变化（订阅者按模式、再按 handler id 排序，`typed_router.rs:64-69`，id 含随机 UUID，`typed_handler.rs:269-272`）。所以补齐的顺序是一个固定顺序，不是"实时的顺序"；决定依赖同一时刻 bar 先后的源码，连续跑本身也不可复现。文档按此写。rc7 对第二个订阅者记一条 "Aggregator … is currently in use, subscription can't be started" 警告，两个订阅者实时和补齐都收到了每根 bar。

覆盖范围：一个确定的行情脚本、一个 A、一个聚合周期（3 分钟）、两个合约；与顺序无关的源码。


## 资金费结算被错过时转保持（2026-11-17 用户决定「资金费结算被错过时转托管」）

有协议的源码，恢复因为停机期间跨过了一次资金费结算而被拒（`_no_settlement_missed`）时，不再停下，改为像无协议源码那样保持：不恢复源码，持有者接管同一个策略 ID，撤掉继承来的入场单，止损和目标照常工作到空仓，`HELD_FLAT` 结束。

### 之后的恢复怎么分辨"这是保持"（不需要新存储的值）

- 第一次（跨结算的那次）：`Session` 构造时就判定，`hold()` 把 `supported` 置假、记下原因 `fallen`；之后切点、暂停、结束都走保持的分支（切点 `sources` 为空、只在有持仓时发布）。
- 之后的每次：有协议源码的切点里有原生账户而 `sources` 为空，只有这种转保持之后的保持切点才会这样：源码运行时的切点总带每个源码的状态，等待中的切点（`cut(cache=None)`）没有账户。`build_node` 原先把它当"账户与源码状态不一致"拒绝，现在把它判为保持（`hold("an earlier recovery of this run was held")`）。无协议源码的切点带 `sources` 照旧拒。这是把一项一致性拒绝换成了保持，用户的决定覆盖它；坏处是一个丢了源码状态的切点（目前没有能产生它的路径）会被当成保持，而不是拒绝——保持不编造任何成交，只让已有的保护单工作。
- 日志：第一次转保持时，运行器在 `resumed` 之后紧接着写一条已有的 `refusal` 行（`code` = `PAPER_RECOVERY_UNAVAILABLE`，`reason` 写明跨过结算、转为保持）。封存因此带 `REFUSED:PAPER_RECOVERY_UNAVAILABLE`：源码的恢复确实被拒了，之后的记录不是源码的。没有新行种、新字段或新取值。
- `paper compare`：`held_since` 对声明协议的源码，取"紧跟着 `PAPER_RECOVERY_UNAVAILABLE` 拒绝、之后还有 bar"的那个 `resumed`；真正被拒的恢复（停机碰到恢复单等）停下时没有 bar，不算。

### 没变的

- 节点已经在跑源码之后才到期的结算（进程启动到源码启动之间），仍拒绝（`maybe_begin`）：这时节点里已经是源码而不是持有者，换不过来。窗口只有几十秒。
- 保持中的资金费：不拒，封存按 Binance 公布的结算对日志里的持仓结算（同无协议源码的保持）。
- 没有原生探针：转保持之后的启动、切点、暂停、结束与无协议源码的保持是同一条代码路径，#3157 的探针已覆盖；这里改的只是"什么时候走这条路径"，由单元测试覆盖。


## 跟踪止损、MARKET_IF_TOUCHED、按 MARK 触发的单（2026-11-17 调研与原生探针；只是提案，放宽拒绝要用户授权）

现在这三种工作单都推迟切点（`unrestorable`），持有它们的运行中断即结束。本节查清 rc7 怎样恢复它们、停机期间能否用公开数据判定"没碰到"，并提出设计；没有改代码。

### 原生事实（rc7）

- 恢复路径对所有类型一样：Sandbox `start()` 调 `load_open_orders()`（`crates/adapters/sandbox/src/execution.rs:946-990`），按 `ts_init` 交给 `restore_open_order`（mod.rs:3455-3496）；撮合核心条目的 `is_activated` 取自订单本身：跟踪止损用 `o.is_activated`，其他一律为真（mod.rs:6551-6584）。
- Redis 里的订单是事件列表，读回由 `OrderAny::from_events` 重建（`crates/infrastructure/src/redis/cache.rs:900-945`）。跟踪止损：每次上移的触发价（止损限价单还有限价）是 `OrderUpdated`，会恢复；**激活不是事件**（`crates/execution/src/trailing.rs:245-268`，原文 "Activation is not an order event"），激活时补上的激活价也不落库。所以恢复后每张跟踪止损都是未激活。
- 恢复后第一步：`core.last` 为空，第一根 bar 总处理开盘一步（mod.rs:1993-2004）；不带激活价的跟踪止损这一步还没激活，不能被触发，撮合后维护时才重新激活。
- 按 MARK 触发：Sandbox 不订阅标记价（`execution.rs:314-320`），撮合引擎遇到 MARK 类型的 bar 直接返回（mod.rs:1931-1937）；bar 撮合时每一步都是合成成交，bid = ask = last（mod.rs:2085-2116，`matching_core.rs:580-597`）。**Paper 与回放里按 MARK 触发的单实际按 LAST bar 的价格触发**，与 DEFAULT/LAST 一样。这是 Paper/回放与 Live（Binance `workingType=MARK_PRICE`）之间已有的差异，与恢复无关，另记为一条发现。
- MARKET_IF_TOUCHED：条目为激活状态，触发价在初始化事件里，按触碰触发（mod.rs:4033-4064、6871），与 LIMIT_IF_TOUCHED 一样原样恢复。按订单规则它只能是只减仓的 GTC 出场单。
- 风控：没有触发价的跟踪止损，rc7 风控只看缓存里的 trade/quote，Paper 与回放只有 bar，于是以 `MARKET_PRICE_UNAVAILABLE` 拒单（`crates/risk/src/engine/mod.rs:2123-2131`、2283-2403）。所以能被受理的跟踪止损都带初始触发价；不带激活价的受理后第一次撮合就激活。"切点时未激活"只会出现在带激活价、价格还没到过激活价的跟踪止损上。

### 原生探针（`exec-main` 镜像，`--network none`，回环假服务器，Sandbox 配置同 `build_node`）

脚本：`/private/tmp/claude-501/-Users-vx-WebstormProjects-trade/0660267b-ae67-4c05-b258-d74244daae37/scratchpad/item4/`（`node.py`、`run.py`、`summarize.py`、`replay_trailing.py`；输出 `out/run-1794927608`）。第 0 根 bar 开 6 个 0.010 多仓，各挂一张只减仓出场单：TS1 跟踪止损市价（偏移 500，DEFAULT，初始触发 99500，无激活价）、TS2 跟踪止损市价（偏移 300，LAST，激活价 101000，初始触发 100700）、TS3 跟踪止损限价（40/50 bp，LAST）、MIT 卖 101500、MARK1 STOP_MARKET MARK 99700、MARK2 STOP_MARKET MARK 99000；每根 bar 后推标记价 98000（若按标记价触发，两张 MARK 都会立即成交）。first 跑到第 4 根后停节点、不撤单、SAVE；resume 跑 5–9；gap 变体第 5 根开盘跳到 100500；first3/resume3 在第 2 根后切（TS2 尚未激活）。

切点时与恢复后读回（触发价 / 激活价 / is_activated）：TS1 100700 / 99950 / 真 → 100700 / None / **假**；TS2 100900 / 101000 / 真 → 100900 / 101000 / **假**；TS3 同 TS1 的形态；MIT、MARK1、MARK2 不变。

| 单 | base | resume | base_gap | resume_gap | resume3（切点时 TS2 未激活） |
|---|---|---|---|---|---|
| TS1 | 100700 | 100700 | **100500** | **100700** | 100700 |
| TS2 | **100900**（第 5 根） | **101300**（第 8 根） | 100500 | 101300 | 100900 |
| TS3 | 101600 | 101600 | 100850 | 100850 | 101600 |
| MIT | 101500 | 101500 | 101500 | 101500 | 101500 |
| MARK1 | 99700（LAST 低点触发） | 99700 | 99700 | 99700 | 99700 |
| MARK2 | 未触发 | 未触发 | 未触发 | 未触发 | 未触发 |
| 期末 total | 100038.478 | **100042.476** | 100024.98475 | **100034.97975** | **100038.478** |

- 已激活、带激活价的 TS2 恢复后未激活，晚三根 bar、在不同价位成交。
- 已激活、无激活价的 TS1：开盘不跳空时相同；跳空穿过触发价时连续跑按开盘 100500 成交，恢复后按触发价 100700。
- 切点时未激活的跟踪止损（resume3）逐笔相同，账户相同。
- MIT 与两张 MARK 止损在所有跑法里相同；标记价 98000 推了 10 次，MARK2 始终没触发。
- 回放对照（BacktestEngine + 产品的 `engine.run.add_venue`，只喂 bar）：不带触发价的跟踪止损 `OrderDenied MARKET_PRICE_UNAVAILABLE`；带触发价的照常上移、成交，标记价不影响。

### 停机期间的判定

- MARK 触发与 MIT：Sandbox 只看 bar 各步的价格，停机用同一份 LAST 1 分钟 klines 判定"碰到"。止损类（含按 MARK 触发）：买 high ≥ 触发价、卖 low ≤ 触发价；MIT 同 LIT：买 low ≤ 触发价、卖 high ≥ 触发价。不读 markPriceKlines（Sandbox 不用它）。
- 未激活、带激活价的跟踪止损：激活前它的状态只因价格碰到激活价而变；卖单每分钟 high < 激活价、买单每分钟 low > 激活价即证明不变。激活价在初始化事件里；"切点时未激活"由切点那一刻读 `order.is_activated`。恢复后读回一律未激活，所以只能由切点把已激活的推迟，切点里的跟踪止损就都是未激活的：不需要新存储的值。
- 已激活的跟踪止损：停机这一半可以证明，但原生恢复本身不精确（TS1、TS2），后者发生在 T 之后，无法事先证明，照样推迟。

### 提案（放宽 `unrestorable`，要用户授权）

| `engine/paper_session.py` | 现在 | 提案 |
|---|---|---|
| 触发类型（`TRIGGERS`、`unrestorable`、`_level`） | 只认 DEFAULT/LAST_PRICE | 加 MARK_PRICE，停机检查用同一份 LAST klines；理由依赖 bar 撮合、L1_MBP、不向 Sandbox 提供 quotes/trades/订单簿 |
| MARKET_IF_TOUCHED | 推迟切点 | 已受理的放行；`_level` 按 LIT 判 |
| 跟踪止损（两种） | 一律推迟切点 | 已受理、`is_activated` 为假、带激活价的放行；恢复时卖单任一分钟 high ≥ 激活价、买单任一分钟 low ≤ 激活价即拒绝（按暂停停下、不撤单，同现有规则） |
| 已激活的跟踪止损、已触发的跟踪止损限价单 | 推迟切点 | 不变；原因写成"激活状态不进缓存（rc7 trailing.rs:245），恢复后不能原样撮合"；已触发的那种没有探针覆盖 |

- 改后允许：持有按 MARK 触发的止损、MIT 止盈、还在等激活的跟踪止损的运行，中断后也能恢复。
- 仍然推迟：已激活的跟踪止损，中断即结束（无协议源码照今天保持或结束）。
- 不变：不新增存储字段、不加日志行；停机检查只多读同一个 LAST 1 分钟接口。
- 实施时的成对验收：用 `engine.paper.main` 跑连续与中断—恢复，覆盖 MIT、MARK 止损、未激活的跟踪止损；拒绝路径各一条（停机碰到激活价、已激活的在切点推迟）；已触发的跟踪止损限价单单独探一次再决定。技能文字（`strategy-authoring.md`）按 `.agents/README.md` 同步：跟踪止损必须给初始触发价，否则回放与 Paper 以 `MARKET_PRICE_UNAVAILABLE` 拒单。
- 上游（可选，对外发帖要用户点头）：rc7 跟踪止损的激活状态不持久化，带 `load_state` 重启后已激活的跟踪止损变成未激活；Live 带缓存重启同样受影响（止损在交易所工作，但缓存里的订单状态会丢）。

### 已实施（2026-11-18，用户选「放宽能精确恢复的」）

按上表放宽 `engine/paper_session.py`：`unrestorable` 放行已受理的 MIT、按 MARK 触发的单、未激活且带激活价的跟踪止损（切点时读缓存里的 `is_activated`：rc7 撮合引擎激活时就写回缓存，`store_trailing_stop_activation`）；`touched`/`_level` 对恢复的单按上节判定（跟踪止损用激活价）。在回补 bar 上新下的单（`Session.submitted`）不在授权里，规则不变：MIT、MARK 触发、跟踪止损照旧拒绝。已触发的跟踪止损限价单照旧推迟（状态不是 ACCEPTED），没有另探。成对验收结果见 PR。

## `recovery_declared` 由运行记录的入口类推出（2026-11-18）

页面的 `recovery_declared` 与 `paper compare` 的 `held_since` 原先在源码文本里找"任一个类"声明了 `PAPER_RECOVERY = 1` 且（连同同文件里的基类）实现了 `on_save`、`on_load`。运行器检查的是它加载的入口类（`Session.declared`：`getattr(strategy_class, "PAPER_RECOVERY")`），所以一个文件里另有一个声明了协议的类、入口类却没有时，页面会说"能恢复"，`paper compare` 也不会把保持归因为 `held`。

现在两处都只看运行的入口类：取自日志 `started` 行的 `strategy_entry_class`（`engine.strategy_metadata`，运行器写的，不是新存的值），沿同文件的基类链判定。还读不到 `started` 行、入口类不是文件里的类、或文本解析不了时为 None（页面不标、`held_since` 不当保持）。

仍然不精确的一处：入口类从别的模块导入的基类里继承来的声明或钩子，文本里读不到（运行器能看到）。要精确只能运行源码或让运行器把它判定的结果写进日志（如 `started` 行加一个值），后者是新存储的值，需要用户授权，本次不做。
