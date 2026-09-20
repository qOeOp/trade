# Backtest

## 职责

使用接纳的历史事实和生产等价交易语义重放冻结策略工件。Backtest 拥有重放实际消费了什么以及发生了什么，不决定结果是否可部署。

## 拥有的权威事实

- 重放身份 确定性时钟 冻结输入 运行与模拟版本和配置摘要。
- 重放产生的规范订单 成交 持仓 成本和结果。
- **CURRENT_PARTIAL：** 完整有序 shared-kernel semantic trace，把 normalized lifecycle event、checkpoint、primitive
  与 plugin result、target/protection transition 和 fill reconciliation 绑定到规范 replay。
- **TARGET：** 一次重放的逐条件决策普查，把每个决策分支谓词绑定到三样东西：它的输入按冻结时的目录可用性规则
  首次满足的那一拍、请求区间在那一拍之后留给它的可求值拍数、以及它的结果在这些拍上的有序游程。尚不可求值的
  谓词绝不被记成为假的谓词，普查还说明是哪条规则与哪个窗口让它不可求值，而不只说它不可求值。它是有界的：
  结果翻转频率超过普查容量的谓词退化为计数并把已退化这件事记下来，而不是截断成一段声称结果不再变化的游程。
  它与语义轨迹同构，封印在规范 Result 之旁而不在其中，因此 Result 保持它自己的相等证明所需的大小。
- 探索运行与 Qualification 请求的保护运行之间的完整隔离。
- Exploratory Run Result 逐项重复实际消费的 Strategy Artifact 请求 PIT 范围 PIT Market Snapshot
  Universe Selection Record 与修订规则 重放配置 Runtime 内核 模拟器 成本 滑点和容量模型身份，
  让 Research 校验请求与结果完全相等。
- 每个终态探索结果都按绑定 diagnostic-policy 版本提交一个完整有限 `diagnosticCategorySet`。支持成员为
  `NO_EXECUTION_DEFECT` `MARKET_DATA` `ARTIFACT` `RUNTIME_KERNEL` `BACKTEST_OPERATIONAL` `SIMULATOR`
  `REPLAY_CONFIGURATION` `VALID_ECONOMIC_FAILURE` 和 `UNRESOLVED_FAILURE`。所有分别有证据支持且同时
  出现的类别都必须保留，并分别绑定决定性证据截面。`NO_EXECUTION_DEFECT` 不能与缺陷类别共存；含糊
  或无法隔离的证据必须为 `UNRESOLVED_FAILURE`，不能猜测缺陷或经济结果。
- `BACKTEST_OPERATIONAL` 绑定准确 operational-profile 身份与版本、run-attempt 身份、runner/service
  readiness、backpressure、resource exhaustion 或 outage 证据及新鲜 Time Evidence。它是 Backtest 在
  Native Replay 服务边界拥有的 operational diagnosis，不是 Runtime kernel 或 Sim Exchange/Simulator
  缺陷；未修复或排除前禁止经济解释。
- 保护重放身份在执行前绑定准确 Strategy Artifact、请求 PIT 范围、PIT Market Snapshot 与 Universe
  Selection Record 身份与摘要、calendar/session/time-zone、corporate-action 与历史 membership cut、Market
  Semantics Compatibility 身份、快照与修订规则、重放配置摘要、Runtime 内核、simulator 成本 滑点
  容量模型版本，以及准确 Candidate/Intake 保护决策政策身份与版本。它还在任何保护观测前重复冻结
  Protected Robustness Plan 身份 必需单元身份 指标集 覆盖规则 容差 阈值 聚合 缺失单元和停止政策。
- Protected Run Result 逐项重复保护请求对应的实际消费字段与保护政策 pair，并要求请求与结果完全相等。
  它声明 `PROTECTED_EVALUATION` 为规范 `timeEvidenceCutKind`，直接绑定 request Time Evidence，并为准确
  request、attempt、plan 与 plan cell 密封 result-stage clock cut。
- Backtest Repair Result 绑定一个 R&D-owned `native-repair-request`、准确 `SIMULATOR` 或
  `BACKTEST_OPERATIONAL` 类别、前驱 repair decision、稳定 correlation、原始 proof digest、类别专属旧
  identity 与 source cut、repair policy、决定性证据和新鲜 Time Evidence；只有 Backtest 能为该 attempt
  提交 `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`。

## 模块

- **Native Replay** - 使用确定性时间重放历史事件，并在适用处复用原生 Runtime Risk 和订单语义。
- **Sim Exchange** - 模拟场所接纳 延迟 成交 手续费和账户效果，不产生外部写入。
- **Run Result** - 把实际消费的数据 工件 配置 订单 成交 成本和终态结果绑定为规范回执。

## 实现状态台账

本台账只记录仓库在本截面实际到达的状态。它沿用 [Market Data](./market-data/) 台账的状态词汇，并以
`CURRENT_PARTIAL` 表示已合并但不可触达的形态；台账本身不授予任何许可。下文没有任何一行标为
`IMPLEMENTATION_ADMITTED`：各行不授予任何东西，扩大准入集必须先修改本文档。

- **CURRENT_PARTIAL - 有序 shared-kernel semantic trace：** 有序词汇与其失败关闭的普查位于
  `crates/backtest_owner_contracts/src/native_replay_trace.rs`，生产方与 Backtest Owner 双方都在封印 trace
  字节之前施加该普查，因此跳过 checkpoint、重复一次生命周期或留下未对账原生成交的 trace 是一个 fault，
  什么都提交不了。只有一条纵向到达它：Sim `EVENT` 消费者是该普查在自身模块之外的唯一调用方，没有第二条
  纵向产出 trace。
- **CURRENT_PARTIAL - 持久 Result custody 与 R&D 加锁读：** 有序链路证明了什么见同名小节。
  `crates/backtest_owner/Cargo.toml` 与 `crates/backtest_result_custody/Cargo.toml` 都没有声明
  `[features]` 表，因此这条 custody 路径在任何构建里都是同一份代码。
- **CURRENT_PARTIAL - 向 Product Edge 提供的探索 Run Result 视图：** Dashboard 读 API 通过
  `resolve_exploratory_replay_result_v2` 解析准确的规范 Result 字节，它位于
  `crates/strategy_factory_rd_owner_api/src/bin/dashboard_read_api.rs`；`product/rd-workbench/Dockerfile.owner`
  构建并安装该二进制；有序链路以
  `replay_result_dashboard_read_api_returns_exact_canonical_bytes` 覆盖这道缝。这是 Backtest 唯一一条在已部署
  产物里端到端可触达的输出交接。
- **CURRENT_PARTIAL - 探索重放的生产入口：** 重放本身已实现并已证明，而已部署产物里没有任何东西能进入它。
  `run_exploratory_replay_v2` 在自身 crate 之外恰有一个调用方，即
  `crates/strategy_factory_rd_owner_api/src/exploratory_replay.rs`，而该调用方位于
  `#[cfg(feature = "sealed-develop-composer-acceptance")]` 之下；镜像构建
  `--bin strategy-factory-rd-owner-api` 时根本不带 `--features` 参数。这量的是部署产物，不是历史。另一条公开
  提交路径 `commit_exploratory_replay_result_v2` 的调用方只存在于
  `crates/backtest_owner/src/lib.rs` 的 `#[cfg(test)]` 模块内。
- **CURRENT_PARTIAL - 保护观测：** Backtest 从它自己执行的那次运行的规范结果派生出观测，现在也能得知为那次
  运行冻结的是哪一个观测：`derive_protected_economic_measurement_v1` 从规范 Result 字节计算并封印它，而
  `ResolvedProtectedReplayRequestSetV1::economic_computation` 从请求集所携带的那个 bundle 解析出指标与覆盖
  规则，因此调用方只能选择一个已发布的计算，描述不出任何计算。剩下的缺口在两者的上游。生产代码不构造
  `ProtectedEconomicPolicyBundleV1`，它的构造点全都位于 `#[cfg(test)]` 模块之内；而把它封印进请求集的
  那一步只被有序门禁自己的条目调用、此外没有调用方，这一点 [Qualification](./qualification/) 已为该终端的
  每一步写明。Backtest 能选出那个计算，而门禁之外没有东西产出那项选择。
- **CURRENT_PARTIAL - 各决策条件的首个可求值拍：** 推导已存在，而没有任何重放产出它。
  `crates/strategy_factory/src/condition_readiness_derivation_v1.rs` 里的
  `derive_condition_readiness_census_v1` 读一份冻结程序的图与决策表，逐条件返回：其闭包中每个输入
  都满足冻结时可用性规则的首个拍、定下该拍的那条规则、以及施加它的那个节点。它从已发布的目录读取
  每条规则，而不是从节点参数去推断，因此一个带着周期却并不为此等待的原语不会被算成在等待。
  它的调用方只有它自己的证明。
- **TARGET - `REPAIR_VALIDATION` 请求与结果：** 不存在任何实现。`REPAIR_VALIDATION` 与
  `RepairValidation` 不出现在 `crates/` 或 `product/` 下的任何文件里。
- **TARGET - `SIMULATOR` 与 `BACKTEST_OPERATIONAL` 原生 repair：** 不存在 Backtest 的 repair 面。四个 Backtest
  crate 里 `repair` 的全部出现都是 `crates/backtest_owner/src/postgres.rs` 里记录 custody 永不被修复的注释；
  `BACKTEST_RUNNER_SERVICE` 不出现在任何 Rust 文件里，而
  `product/dashboard/lib/rd-iteration-timeline-client.ts` 已经把它列为合法修复目标。消费侧词汇存在，生产方
  不存在。

## 共享策略生命周期契约

Backtest 只消费 [StrategyDesignV2 共享内核路径](../architecture/strategy-factory#strategy-design-v2-shared-lifecycle-kernel)：
准确 `StrategyPlanV2`、其内容寻址 Wasm Artifact、已解析 Owner input binding、`ProgramHost` 以及版本化
lifecycle/checkpoint/kernel 身份。Native Replay 提供确定性 `START` `BAR` `EVENT` `FILL` `TIMER` `STOP`
envelope stream；共享内核拥有 position action、portfolio target、protection adjustment 和 fill reconciliation。
Sim Exchange 提供事实性的模拟 acceptance、fill、rejection 与 account effect。Design、plugin 或 Backtest
adapter 均不能提交 raw order 或实现平行 action state machine。

Backtest 拥有结果 ordered semantic trace 与规范 replay fact，但不拥有其 research 或 deployment 含义。
trace 绑定每个 normalized event order key、前后 checkpoint digest、plugin invocation 与有界 result、kernel
primitive semantic ID、target/protection transition、模拟 order/fill reconciliation、position、cost 和终态
result。首个已接纳纵向切片是确定性 stateful-trend corpus；cross-sectional rebalance 与 multi-leg/
multi-timeframe regime 是必需验收 corpus，不授权编造缺失 binding 或实现第三个 runtime。

正向 Run Result 的实际消费记录只能由 Backtest 在内部根据 Native Replay、`ProgramHost`、共享内核与
Sim Exchange 实际接纳的准确输入生成。caller 或 R&D request 可以提出 requested meaning，但不能提供、
反序列化构造或证明 consumed side。engine-produced record 必须绑定 Design、Plan、Artifact、已解析 Owner
input receipt 与 cut、replay configuration、runtime/kernel/simulator identity、cost/slippage/capacity model、
seed、range、calendar/time-zone 含义和 semantic-trace digest。消费证据缺失或不匹配时不得生成正向
receipt；两个 caller-authored DTO 相等绝不构成 request-result correlation。

### CURRENT_PARTIAL - 持久 Result custody 与 R&D 锁定读取

Backtest Owner 拥有私有规范 Result 表及其只追加 outbox，且只有 Backtest writer 可以执行 DML。固定的
`SECURITY DEFINER` `owner_api` 锁定读取函数 `resolve_exploratory_replay_result_v2/v3` 已经存在，有序 PostgreSQL
链路已证明正向锁定 readback、function source 漂移、Owner API 兄弟例程、裸表 ACL 漂移、继承 owner 成员关系与
owner 属性漂移的拒绝、拓扑围栏序列化、提交中途回滚、restart 逐字节一致 readback，以及 R&D 只读访问
（`scripts/ci/test-rd-owner-postgres.bash` 中测试名以 `postgres_result_` 开头的那些 `vibe-backtest-owner`
条目；`postgres_protected_result_` 那条有意不在其中）。Backtest 仍是 Result fact 的唯一权威，
Protected Result custody 继续隔离，不能通过该 R&D seam 读取。

Backtest Owner 暴露一个固定、使用安全 `search_path` 的 `SECURITY DEFINER` `owner_api` 锁定读取函数。
其全限定读取在 caller 已开启的 PostgreSQL transaction 内锁定准确 Result、receipt 与 outbox row，并返回
不受信任 envelope。locator 或 dependency-neutral contract 只是查询，不携带任何 Result 权威。目标
dependency-neutral `vibe-backtest-result-custody` adapter 只有在校验 schema、function 与 table owner、已安装
function source、`SECURITY DEFINER` 设置、table 与 function ACL、规范 Result bytes 与 digest、request
correlation、Backtest receipt 及 outbox binding 后，才能构造不可伪造的正向 readback。它只接受 caller
提供的 transaction；另开
pool 或 transaction 所得 readback 不能用于 R&D decision。

该设计保留无环 crate 方向
`vibe-strategy-factory -> vibe-backtest-result-custody -> vibe-backtest-owner-contracts`：custody adapter 不依赖
`vibe-backtest-owner`，而 `vibe-backtest-owner` 保留 Result 构造与写权威。custody 缺失、过期、跨来源拼接、
owner 错误、function 错误、ACL 不匹配、非规范、digest 不匹配、receipt/outbox 不完整或由独立 transaction
读取时都为 `UNAVAILABLE`。response loss 后，准确 `RESOLVE` 只能返回同一份既存且逐字节相同的 Backtest
Result 与 receipt；不能创建首次 custody、重新组合 result，或追加第二份 Result、receipt 或 outbox event。
已在该 disposable PostgreSQL 证明上准入；它仍不授予 Dashboard 实现、deployment、
production write、provider effect、Paper、Live 或交易权威。

## 输入交接

- [R&D](./rd/) 提交一个冻结 Exploratory Replay Request，由一个 R&D 拥有的定位符寻址，该定位符携带请求身份
  规范请求含义摘要 回执身份与封存摘要。Backtest 通过固定的只读 R&D Owner 端口重新解析该定位符，并在读取任何
  其他字段之前先用摘要校验规范请求字节；一个定位符标签 一份下游证言 或调用方自带的字节副本都不是该请求。
  该请求固定准确不可变 Artifact 请求的 PIT 数据范围 重放配置 其 Research Intent 冻结的同一成本 滑点与容量
  模型版本，以及一个正向终态结果必须逐项核对的请求含义的其余每个组成部分。Backtest 在 R&D 一侧可能观察到
  `AVAILABLE` `STALE` 或 `UNAVAILABLE`；只有 `AVAILABLE` 准入一次尝试，而 `STALE` 与 `UNAVAILABLE` 都不是对
  请求的拒绝，它们只说明该 Owner 当前无法供给。解析不到任何东西的定位符 摘要不符的字节 同一身份下含义已变的
  请求 以及不作答的 R&D 端口，都不产生尝试也不产生结果：沉默绝不是 `UNAVAILABLE`，而 `UNAVAILABLE` 也绝不是
  一个终态重放结果。Backtest 绝不重建 缺省或替换任何被请求的组成部分，绝不把两份调用方自撰表示之间的相等
  当作请求与结果的相关性，也绝不为一份它自己没有校验过规范字节的请求开始尝试。
- 已接纳 `D1_EXECUTABLE_REPAIR` 时，R&D 提交独立 `REPAIR_VALIDATION` request，绑定 D-only repair
  admission、前驱与后继 Artifact、defect oracle、完整 non-defect regression corpus、冻结语义相等证明
  和确定 event/signal/intent/order trace comparison。它既不是探索请求也不是保护请求。
- [Qualification](./qualification/) 发送只在 `ADMITTED` intake 和 holdout 预留后创建的保护请求，冻结
  全部执行身份及准确 Candidate/Intake 保护政策 pair。每个请求处理一个已声明 Protected Robustness
  Plan 单元或准确冻结有界矩阵，Backtest 不能在观察结果后挑选单元；接入拒绝仍必须提交绑定同一请求的 `RUN_REJECTED` 结果。
- [Market Data](./market-data/) 提供一次重放所消费的冻结 PIT 事实与标的条款：PIT Market Snapshot 身份与摘要
  Universe Selection Record 身份与摘要 快照与更正规则 公司行动与历史成员截面 Market Semantics Compatibility
  身份，以及逐标的的密封事实摘要 回执摘要与条款摘要，连同场所 报价与结算币种 有效期窗口 保证金模型与费用
  条款。Backtest 以 Owner 密封回执的形式消费它们；它不查询存储 不挑选切片 也不接受调用方自带的夹具来顶替。
  一份回执要么对准确的请求绑定范围是密封且可解析的 要么不是，不存在部分或临时形态：只有覆盖每个被请求标的
  与整个被请求范围的完整集合才准入执行，而靠替换相邻截面 更晚的更正前沿 或不同成员来覆盖该范围的集合不准入。
  缺失的回执 解析不了的身份 不符的摘要 请求绑定域之外的标的 不包含所请求截面的有效期窗口，或计算只容许一种
  结算币种时出现多于一种，每一种都在 `ProgramHost` 调用之前失败且不产生任何正向回执，因为数据缺口是一个重放
  证据事实，绝不是一个经济结果。Backtest 绝不推断缺失的价格 条款或成员，绝不悄悄改变成本，绝不替换为另一份
  快照或另一个模拟版本，也绝不让遥测或投影顶替一份密封回执。
- [R&D](./rd/) 还可提交一个冻结的 `SIMULATOR` 或 `BACKTEST_OPERATIONAL` `native-repair-request`。
  `SIMULATOR` 只能指向 Backtest 的 Sim Exchange 表面 `sim-exchange`；`BACKTEST_OPERATIONAL` 只能指向
  Native Replay 的 `BACKTEST_RUNNER_SERVICE`。目标 类别 前驱 proof 旧 identity source cut policy 时间错误或含义变化都不创建 Backtest repair
  attempt 或 result。

这两条上游契约的准入程度不高于上游自己的记载：对应的 [Market Data](./market-data/) 输出交接把直连
`BACKTEST_OWNER_V1` Instrument Master 解析标为 **TARGET**，因此此处任何内容都不得读作一条已准入的消费路径。
探索路径在已部署的产物里同样不可达：`run_exploratory_replay_v2` 在其自身 crate 之外唯一的调用者位于
`#[cfg(feature = "sealed-develop-composer-acceptance")]` 之下，而 `product/rd-workbench/Dockerfile.owner`
构建 `strategy-factory-rd-owner-api` 时完全不带任何 feature 开关。这测的是部署产物而不是历史；它没有断言
该路径是否曾在别的环境里跑过。

## 输出交接

- 向 [R&D](./rd/) 返回带完整有限 `diagnosticCategorySet` 及各成员决定性证据截面的探索 Run
  Result。任一执行缺陷成员都优先于经济解释；Research 保留全部支持成员，再按冻结优先级选择唯一修复。
  只有不含缺陷的集合才能用 `NO_EXECUTION_DEFECT` 或 `VALID_ECONOMIC_FAILURE` 做经济解释；
  `UNRESOLVED_FAILURE` 不允许产生决定。
- 对 [R&D](./rd/) 的 `REPAIR_INPUTS_SIMULATOR` 或 `REPAIR_INPUTS_BACKTEST_OPERATIONAL`，只有 Backtest
  能返回准确 request-correlated `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`。`REPAIRED` 命名新
  simulator 或 operational-profile identity，且只允许一个新请求相等 Replay Request，绑定准确前驱
  `REPAIR_INPUTS` 决定、类别、native repair request 与 result identity、原始 proof digest、稳定
  correlation、前驱与后继 native identity 及 cut，以及未改变的前驱请求语义。`BACKTEST_OPERATIONAL`
  还包含后继 operational-profile identity 与 cut。只有 `REPAIRED` 允许 re-entry；`UNAVAILABLE` 只
  允许关联 `STOP_INPUT_UNAVAILABLE`；`OUTCOME_UNKNOWN` 不允许 stop retry 后继 Artifact Selection 或
  Replay Request。任何结果都不改写或重试已消费 run attempt。
- 只有请求相等的探索 `TERMINAL_RESULT` 可以进入选择；被拒 无效 未知 非终态或不匹配尝试只留在
  TrialFamily Census。
- 向 R&D 的有人值守修复路径只返回请求相等的 `REPAIR_VALIDATION` 事实；只有通过结果可支持
  `D1_VALIDATED`。失败 被拒 无效 未知或不相等结果不支持 Candidate，也不能重标为 Research 证据；
  只有 R&D 能提交 D-only Repair Disposition。
- 向 [Qualification](./qualification/) 只返回逐项重复实际消费执行身份以供完全相等校验的密封 Protected Run Result 和完整消费输入证据。
- 只向 Product Edge 提供只读探索 Run Result 视图；保护请求 测量 结果和 holdout 细节永不投影。

## 拒绝和禁止事项

- 不推断缺失数据 不静默改变成本 不替换工件或模拟版本。
- 不混合探索与保护结果，也不把保护结果暴露给同一研发循环。
- 不把回放存活 统计显著或单次 holdout 当作部署权威。
- 不拥有 Eligibility State 生命周期 资金 实盘订单或账户真相。
- 不把 Run Result 解释为可部署资格；只有 Qualification 可以把保护证据写入 Eligibility State。
- 不因另一类别存在就丢弃已支持诊断，也不把重复或含糊证据猜成修复目标；保留支持成员，并把无法
  隔离的证据分类为 `UNRESOLVED_FAILURE`。
- runner readiness、backpressure、resource exhaustion 或 service outage 证据明确时，不得重标为
  `RUNTIME_KERNEL` `SIMULATOR` 有效经济结果或 unresolved。
- 不把 `RUNTIME_KERNEL` 当作 Backtest repair，不为含义变化改写 repair result，也不把请求投递 接受
  静默或 telemetry 当作终态 native repair result。
- 即使只读也不通过 Product Edge 暴露保护结果。

## 失败与恢复

数据缺口 标的条款无效 非确定性，或 Artifact PIT 范围 PIT Market Snapshot 身份 Universe Selection Record 身份或摘要 快照规则 重放配置 Runtime 内核 模拟器 成本 滑点 容量模型有任一缺失 替换或不匹配时，以 `RUN_REJECTED` 或 `INVALID_REPLAY_EVIDENCE` 终止。两者只是重放证据事实，不是 Candidate 准入或 Eligibility。Qualification 记录对应终态尝试 disposition 和预注册 holdout 闭合，但不称为 `INELIGIBLE`；只有 `IN_PROGRESS_OR_UNKNOWN` 保持未解决。无法保持隔离的保护运行不能降级为探索证据。复现必须从冻结回执开始。

明确 runner readiness、backpressure、resource exhaustion 或 service outage 失败属于
`BACKTEST_OPERATIONAL`。它先于经济解释，只把修复路由到 Backtest operational profile 与 runner
service，绝不声称 Runtime kernel 或 Simulator 修复。保护路径中 Qualification 只把密封类别消费为
`DIAGNOSTIC_INVALID`，按预注册政策闭合 holdout，不生成 Eligibility Fact，也不向 R&D 或 Product Edge
泄漏 operational evidence 或保护细节。

## 决策契约

- **输入** - 一个冻结探索或保护 Replay Request，以及准确已接纳 PIT snapshot artifact runtime
  simulator cost slippage capacity identity。
- **诊断与决定** - 接纳或拒绝准确 request，确认 runner/service operational readiness，确定重放并
  提交实际消费 operational diagnosis 与终态 result，不解释可部署性。
- **冲突解析** - request identity 与 namespace 决定 run；含义变化时拒绝，重放加入同一结果而不替换默认值。
- **输出与终态负例** - Run Result 或 `RUN_REJECTED` `INVALID_REPLAY_EVIDENCE`
  `IN_PROGRESS_OR_UNKNOWN`；所有分支都只是事实证据。
- **反馈与经济意义** - 展示扣成本行为与可复现性，让 Research 学习且 Qualification 独立检验，但不
  授予资格或资金。
- **禁止** - 不拥有 Candidate selection 保护结果反馈 Research Eligibility 生命周期 实盘订单 账户真相或部署权威。

## 后续实现验收

- 相同接纳输入可以重现同一规范事件和结果序列。
- Protected Run Result 能证明请求与实际消费的 Artifact PIT 范围 snapshot universe
  calendar/session/time-zone corporate-action 历史 membership market-semantics correction replay kernel
  simulator 成本 滑点 容量模型 Protected Robustness Plan 和计划单元身份逐项完全相等。
- 每个终态保护结果只对其请求的计划单元准确交代一次，并重复完整 cell-set digest。只有 Qualification
  能按冻结计划解析全部密封 per-cell result，并在消费证明没有请求单元仍处于非终态的密封 Backtest
  attempt frontier 后分配 missing-cell disposition；Backtest 不能声称完整计划已完成，也不能静默改写不可用证据。
- 任一保护请求与结果不匹配都必须成为 `INVALID_REPLAY_EVIDENCE`，且不生成 Eligibility Fact。
- 每个探索结果都关联同一稳定且由 R&D 拥有的请求身份；请求不匹配 可变 已取代或未解析时不生成运行。
- 每个终态探索结果都只有一个完整有限 `diagnosticCategorySet` diagnostic-policy 版本，以及每个支持
  成员的决定性证据截面或完整不可隔离证据集；同时支持的缺陷与经济失败都保持可见，Research 的
  唯一修复选择必须确定。
- 每个终态保护结果同样保留一个完整 有限 非空的 `diagnosticCategorySet` 与内容摘要，但只对
  Qualification 可见。`NO_EXECUTION_DEFECT` 与 `UNRESOLVED_FAILURE` 都只能单独出现；任一受支持执行
  缺陷优先于经济解释，任何保护集合成员都不得进入共享 telemetry 或 R&D。
- 每个终态保护 cell result 都携带密封且由 Backtest 拥有的 applicability 与 outcome evidence，以及完整
  `PROTECTED_EVALUATION` result-stage Time Evidence。Backtest 报告 observation，不分配 Qualification 的
  `PASS` `FAIL` 或 non-applicability 分类。
- 每个 `BACKTEST_OPERATIONAL` 结果都证明准确 operational profile、run attempt、readiness/backpressure/
  resource-exhaustion/outage 证据和 Time Evidence；关联修复只指向 `BACKTEST_RUNNER_SERVICE`，后继
  profile 只能由新 Replay Request 消费。
- 每个已接纳 Backtest native repair request 都有一个关联且只写一次的 result。准确 replay 加入相同
  attempt 与 result；只有 `REPAIRED` 能命名新类别专属 identity，`UNAVAILABLE` 与 `OUTCOME_UNKNOWN`
  不授予后继 identity 或重试。
- 每个完成的探索结果都证明 Artifact PIT 范围与 snapshot universe selection 与修订 重放配置
  Runtime 内核 模拟器 成本 滑点和容量的请求与实际消费完全相等；只有相等的 `TERMINAL_RESULT`
  可以进入 Research Selection。
- 探索与保护运行的命名空间 访问路径和结果消费者可证明互相隔离。
- Backtest 结果不能授权或应用策略 generation；Qualification 决定资格，Governance 授权，只有 Runtime 能证明应用。
- Backtest 只能写 `RUN_REJECTED` `IN_PROGRESS_OR_UNKNOWN` `TERMINAL_RESULT` 或 `INVALID_REPLAY_EVIDENCE`，不能写准入或资格状态。
- 已创建保护请求不能在没有 Protected Run Result 时被拒绝，该结果用于让 Qualification 闭合 holdout 托管。

## 可观测性与持久化

Backtest 持久化每个 Replay Request、run attempt、已消费 Artifact 与 PIT 身份、operational-profile 身份
与版本、runner/service readiness 与有界 backpressure/resource/outage 证据、成本/容量输入、完整
diagnostic set、Exploratory Result 和 Protected Run Result。运行信号覆盖 queue time、engine/simulator
时长、资源使用与 repair dependency，但不能把保护测量或内部终态 disposition 复制到共享 telemetry。探索
投影可以暴露其 diagnostic category set；保护投影只能暴露公共终态 `CLOSED_NOT_QUALIFIED` 或
`QUALIFIED`、类型不透明且不可解引用的 reference，以及 source-frontier freshness。保护 phase、run
latency、terminal timing 和 timing-derived field 明确禁止公开；也绝不暴露通用 terminal disposition、
内部原因或内部状态。`REPLAY_REJECTED`
`REPLAY_INVALID` `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与 `INELIGIBLE`
六种负面终态都以字节等价方式归一为 `CLOSED_NOT_QUALIFIED`，正向 `QUALIFIED` 保持准确。任何保护
category 或 category-derived aggregate 都不得用于 label group filter count alert health score 或 research
funnel。遥测丢失不能制造 Result、替
Research 诊断保护 attempt，也不能让 Qualification 闭合 attempt。
