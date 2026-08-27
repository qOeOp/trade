# Backtest

## 职责

使用接纳的历史事实和生产等价交易语义重放冻结策略工件。Backtest 拥有重放实际消费了什么以及发生了什么，不决定结果是否可部署。

## 拥有的权威事实

- 重放身份 确定性时钟 冻结输入 运行与模拟版本和配置摘要。
- 重放产生的规范订单 成交 持仓 成本和结果。
- **TARGET：** 完整有序 shared-kernel semantic trace，把 normalized lifecycle event、checkpoint、primitive
  与 plugin result、target/protection transition 和 fill reconciliation 绑定到规范 replay。
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
- Backtest Repair Result 绑定一个 R&D-owned `native-repair-request`、准确 `SIMULATOR` 或
  `BACKTEST_OPERATIONAL` 类别、前驱 repair decision、稳定 correlation、原始 proof digest、类别专属旧
  identity 与 source cut、repair policy、决定性证据和新鲜 Time Evidence；只有 Backtest 能为该 attempt
  提交 `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`。

## 模块

- **Native Replay** - 使用确定性时间重放历史事件，并在适用处复用原生 Runtime Risk 和订单语义。
- **Sim Exchange** - 模拟场所接纳 延迟 成交 手续费和账户效果，不产生外部写入。
- **Run Result** - 把实际消费的数据 工件 配置 订单 成交 成本和终态结果绑定为规范回执。

## 共享策略生命周期契约

Backtest 只消费 [StrategyDesignV2 共享内核路径](../architecture/strategy-factory.zh.md#strategydesignv2-与共享生命周期内核)：
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

## 输入交接

- [R&D](./rd/) 提交一个冻结 Exploratory Replay Request，绑定准确不可变工件 请求 PIT 数据
  范围 重放配置，以及其 Research Intent 冻结的同一成本 滑点与容量模型版本。
- 已接纳 `D1_EXECUTABLE_REPAIR` 时，R&D 提交独立 `REPAIR_VALIDATION` request，绑定 D-only repair
  admission、前驱与后继 Artifact、defect oracle、完整 non-defect regression corpus、冻结语义相等证明
  和确定 event/signal/intent/order trace comparison。它既不是探索请求也不是保护请求。
- [Qualification](./qualification/) 发送只在 `ADMITTED` intake 和 holdout 预留后创建的保护请求，冻结
  全部执行身份及准确 Candidate/Intake 保护政策 pair。每个请求处理一个已声明 Protected Robustness
  Plan 单元或准确冻结有界矩阵，Backtest 不能在观察结果后挑选单元；接入拒绝仍必须提交绑定同一请求的 `RUN_REJECTED` 结果。
- [Market Data](./market-data/) 提供冻结 PIT 数据和标的条款。
- [R&D](./rd/) 还可提交一个冻结的 `SIMULATOR` 或 `BACKTEST_OPERATIONAL` `native-repair-request`。
  `SIMULATOR` 只能指向 Backtest 的 Sim Exchange 表面 `sim-exchange`；`BACKTEST_OPERATIONAL` 只能指向
  Native Replay 的 `BACKTEST_RUNNER_SERVICE`。目标 类别 前驱 proof 旧 identity source cut policy 时间错误或含义变化都不创建 Backtest repair
  attempt 或 result。

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
- 终态保护结果准确枚举每个必需计划单元一次，或记录其预注册终态 missing-cell disposition；Backtest
  不得静默丢弃失败 不可用或不完整单元。
- 任一保护请求与结果不匹配都必须成为 `INVALID_REPLAY_EVIDENCE`，且不生成 Eligibility Fact。
- 每个探索结果都关联同一稳定且由 R&D 拥有的请求身份；请求不匹配 可变 已取代或未解析时不生成运行。
- 每个终态探索结果都只有一个完整有限 `diagnosticCategorySet` diagnostic-policy 版本，以及每个支持
  成员的决定性证据截面或完整不可隔离证据集；同时支持的缺陷与经济失败都保持可见，Research 的
  唯一修复选择必须确定。
- 每个终态保护结果同样保留一个完整 有限 非空的 `diagnosticCategorySet` 与内容摘要，但只对
  Qualification 可见。`NO_EXECUTION_DEFECT` 与 `UNRESOLVED_FAILURE` 都只能单独出现；任一受支持执行
  缺陷优先于经济解释，任何保护集合成员都不得进入共享 telemetry 或 R&D。
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
