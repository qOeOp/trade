# 双向 Live 设计与 Nautilus 原生能力独立评审

日期：2026-11-06。结论：**账户级架构合理，但当前设计还不能直接作为实盘接入和并发阶段的
完整实施契约。需要补两项具体原生配置；不需要重做持仓引擎、订单编码器或恢复账本。**
原生验证阶段可以继续，原稿已列出的恢复、均价和保护竞态仍按原条件验收。

## 审查对象与分工

用户要求两个 agent 分别审查设计、Nautilus 源码及文档，重点排除因不清楚原生能力边界而
产生的错误实现和绕行方案。本轮两个 agent 使用独立上下文，先各自调查，再交叉核对。

| 项目 | 固定证据 |
| --- | --- |
| 设计 | [双向账户与多策略 Live 设计](binance-live-hedge-design.zh.md)，提交 `82f6c85560e9e3f7f639d8f48bf25df805a23ec4` |
| 设计 SHA256 | `6e0ae489d7e9e0e621692616c8e42e90791c08ae7aedc528a9ac28e6a1262bbf` |
| 产品基线 | 本轮开始及写报告前 fetch 核实 `origin/main` 为 `dc49edba7751e0732563200fc9347e42aeaac79e` |
| 原生版本 | 锁定 `2.0.0rc7`；官方 tag commit `55c0e82053142bce3a5cba4de4221d3929c2d3bc` |
| 设计审查 | `independent_design_audit`：设计充分性、实际消费者、生命周期、身份与存储 |
| 原生能力审查 | `independent_nautilus_audit`：固定版源码完整调用链、官方文档、上游测试与 Python 可达接口 |

本轮使用 `product-doctor` 聚焦诊断步骤 3–5，未做整段研究会话审计。Context7 的 develop
资料仅作定位，能力结论均回到固定 rc7；上游有测试与本机实际运行分开陈述。
主代理复核了两项发现的关键消费者、原生源码与实际探针输出。

## R1 · P1：固定长身份没有配套原生 UUID 订单 ID 模式

设计第 153、163、165–169 行沿用 `LIVE-<12hex>` trader ID，并给每个成员同样长度的
strategy ID，但没有选择兼容交易所限制的订单 ID 配置。

完整链路为：当前 `live/runs.py:285` 构造 trader ID，`engine/live.py:222` 传入 strategy ID；
两份 Retest 适配工作稿的 `StrategyConfig` 都只设置 strategy_id。rc7 默认
`use_uuid_client_order_ids=False`，OrderFactory 会把两个 tag 放进默认 O 格式订单 ID。
两位 agent 各自运行原生 wheel 探针，均得到 **45 字符**，超过 Binance 普通订单和算法订单的
**36 字符**限制。虚拟时钟日期不影响这一长度结论。

适配器不是对任意长字符串自动压缩：原生 broker encoder 只识别有限数字/短 tag、UUID
等格式；两个长 hex tag 无法按这些规则压缩，fallback 原样发送。因此，原生注册、模拟执行
成功不能证明此身份方案可以向 Binance 下单。设计中的准备检查即使阻止发送，也只能拒绝
这个默认配置，不能使它成为可用方案。

**建议修订：**实际适配源码明确使用原生 `StrategyConfig(use_uuid_client_order_ids=True)`，
保持确定性的 trader/strategy 身份。原生生成 36 字符 UUID，Binance 自带 encoder 已有可逆
压缩为 34 字符 wire ID 的路径。普通开仓、算法保护、退出、撤单和 REST/WS 回报都应走
这条原生链路并验收往返身份；不增加自定义编码器或 ID 映射表，不需要升级框架。

依据：[原生 StrategyConfig](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/crates/trading/src/strategy/config.rs#L55)、
[默认 ID 生成器](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/crates/common/src/generators/client_order_id.rs#L65)、
[Binance encoder](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/crates/adapters/binance/src/common/encoder.rs#L184)、
[Binance 官方交易接口](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade)。

这是实际原生 ID 生成结果加源码/接口约束证明的实施缺口；没有声称本轮已向真实交易所下单或观察到实盘拒单。
处置为 `fix` 设计及后续配置，新增持久字段和执行机制均为零。

## R2 · P2：Observer-only 冷对账没有恢复成员 OMS 注册

设计第 34–38、115–118 行将客户端改为 HEDGING、交易成员显式 NETTING，同时沿用
reconcile-only 只注册 Observer 的实现。原生区分了两种信息：

- 已存在 position 的 ID/OMS 会随 cache 持久保存；这类已关联仓位通常仍能保持原配置。
- 成员的 strategy OMS override 是 `LiveNode.add_strategy` 写入执行引擎的内存注册，
  `load_cache` 不会恢复这个注册表。只有 Observer 时，原成员的注册不存在。

具体窗口是：entry 已发送或接受，但首个 fill 尚未进入 cache，提交时也没有显式 position ID。
冷启动补到首笔成交时，没有已缓存的 order→position 映射，也没有原成员 NETTING override，
引擎会采用客户端 HEDGING，生成 P-ID，而非不中断路径应使用的
`{instrument_id}-{strategy_id}` NETTING ID。

这是原身份/OMS 契约在该窗口发生漂移的源码路径证据，**不能扩大为全部持仓恢复失败、必然串仓
或已发生经济损失**。本轮没有运行完整持久缓存加 mass-status 的端到端恢复回归。

**建议修订：**在原生 load/reconcile 前，按固定成员身份注册不加载交易源码的原生 base
`Strategy`，设 `oms_type=NETTING`，关闭 `manage_stop`、`manage_gtd_expiry`、
`manage_contingent_orders`，不配置外来订单认领，不订阅行情或发交易命令。这样利用公开的
`LiveNode.add_strategy` 注册原成员配置；Observer 继续负责观察。reconcile-only 仍不运行
旧交易源码和任意回调，也不开放完整策略恢复。

可达性已用 rc7 原生 LiveNode 验证：两个这样的对象正常启动、停止，最终 0 orders、
0 positions。此探针证明公开注册入口和无交易行为，不代表真实恢复已通过。阶段 A 增加
“已持久化但尚未首成交的 entry，冷加载后补首个 fill”的对照，核对重启前后 position ID、
OMS 与归属一致；已有持仓部分成交及双成员漏成交另作对照。

依据：[原生策略注册 OMS](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/crates/live/src/python/node.rs#L1408)、
[配置选择与仓位 ID](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/crates/execution/src/engine/mod.rs#L3563)、
[已有仓位 OMS 优先级](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/crates/execution/src/engine/mod.rs#L3250)、
[官方 OMS 契约](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/concepts/execution/index.md)。

处置为 `fix` 注册方案；原成员 ID 与 OMS 从固定声明和 runtime 契约取得，无需新增持久路由表、
持仓分摊或自制 OMS 恢复代码。

## 原生复用与必要产品边界

| 设计领域 | 原生能力与边界 | 审查决定 |
| --- | --- | --- |
| 账户 Hedge、策略 NETTING | 原生支持两层 OMS 分离、虚拟仓位和按策略归属 | 保留；不新增策略账户模式字段或虚拟持仓引擎 |
| 一账户多策略 | LiveNode/Trader/Controller 已支持多策略及按成员生命周期操作 | 保留单节点单 cache；共同启停是首批产品范围，不能描述成框架限制 |
| 启动先对账后运行策略 | 原生 LiveNode 已按 load/connect/reconcile/start 顺序执行 | 直接复用；不另造同义的“原生 ready”对账状态机 |
| 实际账户模式一致 | Binance native connect 读取模式，但配置不一致只 warn | 产品严格准入仍必要；连接成功不等于实际模式已被严格校验 |
| 断线与重连观察 | Python 可订阅原生 socket state，适配器已有流恢复路径 | 采用原生事件；connected 本身不证明模式、数据连续性及归属已重新确认 |
| 禁止开仓、保留退出 | Rust RiskEngine 有 REDUCING/HALTED；rc7 Python LiveNode/Strategy/Controller 无公开 setter | 不虚构 Python API，也不声称框架无此能力；保留薄的产品准入边界并验收实际命令入口 |
| 保留保护的 STOP | `manage_stop/market_exit` 先 cancel_all 再 close_all | 不能直接替换设计要求的保护保留顺序；协调层只组合原生撤单、平仓、事件和 cache |
| 批量退出本策略仓位 | `Strategy.close_all_positions` 本身按调用者 strategy_id 过滤，再带原生 position ID 退出 | 它不是全账户平仓；不因名字含 all 就新增等价自写循环 |
| 冷恢复状态 | 原生有 `on_save/on_load` 和 cache persistence | 继续禁止旧源码重启是产品范围；R2补原生配置注册，不扩成任意策略状态恢复 |
| 定期与启动对账 | 原生周期流程已核多空两侧；启动的逐报告修正、均价校验不同 | 保留阶段 A 的分别验收，不新增外部多空聚合器 |
| 无法归属交易 | 原生可保留 EXTERNAL/RECONCILIATION；过滤不等于证明账户没有未知活动 | 不猜测分摊；账户占用、准入和 clean-stop 仍是产品信任边界 |
| 同向保护单竞态 | 交易所只识别账户 LONG/SHORT 腿，虚拟策略 ID 不提供交易所隔离 | 保留原稿验收条件；不通过则顺序执行，不改策略信号来掩盖问题 |

`close_all_positions` 是非阻断的复用澄清：当前 `engine/live.py:117–119` 将其作为
待独立审查的 broad action 拒绝，而 rc7 helper 明确按 strategy 过滤。两份 Retest 未使用
这个 helper，当前设计也不因此整体失效。后续应准确说明 API 的作用域，并优先评估原生 helper；
本轮没有放开现有拒绝，也不将“原生支持”当作已获授权改变检查。

主要文档依据：[执行与交易状态](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/concepts/execution/index.md)、
[策略生命周期](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/concepts/strategies.md)、
[Live 生命周期](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/concepts/live.md)、
[Binance 集成](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/integrations/binance.md)、
[对账](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/concepts/execution/reconciliation.md)。

## 完成度与后续顺序

1. 修改设计明确 R1 的原生 UUID 配置、R2 的无交易成员注册，并补上上表的原生 API/产品边界区分。
2. 在既有阶段 A 内验证 ID 的普通/算法协议往返，以及未首成交订单的完整冷恢复对照。
3. 继续原稿已列的启动修正、合法均价差、保护迟到触发等验收，不把它们重复登记为本轮新缺陷。
4. 这些适用项通过后再进入相应 B/C 实施范围；配置、拒绝语义、账户写入和真实订单按既有授权处理。

本轮实际执行：两名 agent 分别运行 rc7 订单 ID 探针；原生能力 agent 运行无客户端的 LiveNode
空策略启停探针，并对照公开绑定/文档。未运行完整 Redis 冷加载、Binance HTTP/WS 协议、
保护竞态或真实交易测试；没有把上游 Rust 测试的存在写成本机通过。

详细独立报告与原始探针保留在工作目录，不复制原始回执进 Git：

- `/tmp/trade-hedge-independent-design-review-20261106.md`
- `/tmp/trade-hedge-independent-nautilus-review-20261106.md`（含 21 项能力映射）
- `/tmp/trade-independent-design-audit-20261106/`
- `/tmp/trade-hedge-independent-probes-20261106/`

本次交付只有评审记录；冻结设计、执行代码、拒绝检查、账户、凭据和研究账本均未改变。
