# 回测与资格场景

本场景独立评估冻结候选。Qualification 在不可变历史中保留只写一次的 Intake Receipt，并投影当前分支：`EVALUATING` 终态尝试 disposition 或 Eligibility。

## Entry / 入口

Product Edge 请求独立审查已存在且由 R&D 拥有的 Candidate。Research 已冻结 TrialFamily 及其不可变穷尽 Census Frontier Artifact
PIT 规则 purge 或 embargo 成本 容量假设 预算 证伪条件 完整跨 TrialFamily 语义前驱前沿 来源反馈前沿和保护反馈前提交的独立性依据。Research 还提交终态 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition，交叉绑定准确证伪条件 停止规则 探索前沿 Candidate 和 Census Frontier。评估请求绑定稳定身份 规范类型化含义以及唯一 `READY_FOR_SELECTION` Iteration Decision 和相同 decision-policy version 与证据截面。Qualification 校验证据包并独占 holdout 预留与消耗。
Candidate 与 Intake 绑定唯一准确预注册保护决策政策身份与版本及一个冻结 Protected Robustness Plan。
该计划冻结必需时间窗口 市场状态 标的切片 扰动 合理参数邻域单元，以及覆盖 指标 容差 阈值 聚合
缺失单元与停止规则。同一轴可以包含多个单元，准确完整 plan-cell-set digest 在重放前冻结。
`ADMITTED` 后，Qualification 在一个 Protected Replay Request 中冻结准确 Strategy Artifact 请求 PIT
范围 准确 PIT Market Snapshot 身份 Universe Selection Record 身份与摘要 快照修订规则 重放配置摘要
Runtime 内核 模拟器 成本 滑点 容量模型版本，以及准确同一保护政策 pair。

## Value path / 价值路径

Qualification 把冻结候选发送到隔离保护回放。Market Data 提供准确的 PIT 回放输入。Native Replay
使用确定性交易内核，Sim Exchange 生成模拟效果，Run Result 记录实际消费的输入与结果。
Protected Evaluation 只有在每个实际消费执行身份与请求字段完全相等后才应用预注册判断规则。保护请求一旦创建，即使 Backtest 接入拒绝也必须提交绑定同一请求的 `RUN_REJECTED` 结果。被拒绝或无效的终态重放闭合为 Protected Attempt Disposition。只有实际消费身份与 Protected Replay Request 完全相等的准确 `TERMINAL_RESULT` 才能按绑定保护决策政策版本评估，并闭合为初始或续期 Eligibility Fact；只有进行中或未知结果派生 `EVALUATING`，其依据是未改变的 `ADMITTED` 回执和保护请求。
经济或稳健性 assessment 前，Qualification 先消费密封、完整、有限且非空的
`diagnosticCategorySet` 与内容摘要，并保留每个独立支持成员及逐类别决定性证据。在处理任一执行缺陷
成员之前，Qualification 先校验它是受支持类别的有限 非空 无重复子集。空集合 重复 未知类别
`NO_EXECUTION_DEFECT` 混合集合或 `UNRESOLVED_FAILURE` 混合集合都先闭合
`DIAGNOSTIC_UNRESOLVED`，不进入类别优先级。只有结构合法的集合中，任一执行缺陷成员才优先于
经济解释并闭合 `DIAGNOSTIC_INVALID`；`UNRESOLVED_FAILURE` 只能作为单元素未解析集合；
`NO_EXECUTION_DEFECT` 也只能作为单元素集合，且只有它可能进入通过 assessment。明确的 Backtest runner
readiness、backpressure、resource exhaustion 或 service outage 结果是 `BACKTEST_OPERATIONAL`，不是
`RUNTIME_KERNEL` 或 `SIMULATOR`；它闭合为 `DIAGNOSTIC_INVALID`，按预注册规则处理 holdout，且不生成
Eligibility Fact。operational profile、run attempt、证据和保护细节保持 Qualification-only，永不返回
R&D Product Edge 或 Governance。
Observability 只能暴露保护运行的公共终态 `CLOSED_NOT_QUALIFIED` 或 `QUALIFIED`、类型不透明且不可
解引用的 reference，以及 source-frontier freshness。保护 phase、latency、terminal timing 与
timing-derived field 明确禁止公开；也绝不暴露通用 terminal disposition、内部原因或内部状态。`REPLAY_REJECTED`
`REPLAY_INVALID` `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与 `INELIGIBLE`
六种负面终态都以字节等价方式归一为 `CLOSED_NOT_QUALIFIED`，正向 `QUALIFIED` 保持准确。它不得暴露
或按保护 diagnostic set membership 做 group filter label count alert，也不得从中派生 aggregate；探索 category
按独立 disclosure policy 仍可观测。
Qualification 重复准确 plan-cell-set digest，并把每个计划必需单元准确枚举一次为 `PASS` `FAIL`
`NOT_APPLICABLE_ACCEPTED` `NOT_APPLICABLE_REJECTED` 或 `MISSING`。完整通过要求至少一个 cell 适用、
所有适用 cell 通过，且每个不适用 cell 都按冻结 adjudication policy 获接受。assessment 缺失 重复 未知
不匹配或全部不适用时为 `INCOMPLETE_INVALID`，提交 `ASSESSMENT_INVALID` 并闭合 holdout，不创建
Eligibility Fact；`COMPLETE_FAIL` 生成 `INELIGIBLE`，只有 `COMPLETE_PASS` 生成 `QUALIFIED`。
Qualification 把只写一次的 Intake Receipt 直接返回 Product Edge，作为评估请求的权威结果，独立状态摘要不能替代该回执。`QUALIFIED` Eligibility Fact 绑定 Governance 与 Risk 必须执行的经济条件版本 已评估成本容量模型版本和容量上限。

## Owner handoffs / Owner 交接

Product Edge → Qualification 是稳定且关联请求的评估，并包含从来源到当前的有界保护反馈前沿。R&D → Qualification 是冻结 Candidate 准确 Research Selection Disposition 证伪条件 探索前沿和跨 TrialFamily 祖先交接。
Qualification → Backtest 请求保护回放，Market Data → Backtest 提供冻结事实，Backtest →
Qualification 返回规范证据。只有存在包含撤销在内的 Eligibility State 事实时，Qualification 才向 Strategy Governance 发布。Qualification 另向 Product Edge 返回已提交 Intake Receipt，有界状态视图仍只是只读模型。Protected Attempt Disposition 保持 Qualification-owned，对 Product 只暴露有界分类状态。

## Proof / 证明

证明始终包括冻结 Candidate、准确 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition 与 Intent
证伪条件、TrialFamily、不可变穷尽 Census Frontier、完整跨 TrialFamily 前驱前沿、保护反馈与保护尝试
前沿、累计 holdout 处理、预注册、稳定评估请求及其关联且只写一次的 Intake Receipt。
`NOT_ADMITTED` 在保护重放前结束且不消耗 holdout。`ADMITTED` 后，`IN_PROGRESS_OR_UNKNOWN` 增加
Protected Replay Request 和 holdout 预留但没有终态事实；`RUN_REJECTED` 或
`INVALID_REPLAY_EVIDENCE` 增加密封 Protected Run Result、holdout 闭合以及唯一 `REPLAY_REJECTED` 或 `REPLAY_INVALID` Attempt Disposition，且没有 Eligibility Fact。有效 `TERMINAL_RESULT` 若有执行缺陷（包括 `BACKTEST_OPERATIONAL`）
诊断则增加 `DIAGNOSTIC_INVALID`，`UNRESOLVED_FAILURE` 增加 `DIAGNOSTIC_UNRESOLVED`；二者都闭合
holdout 且不生成 assessment 或 Eligibility Fact。`VALID_ECONOMIC_FAILURE` 只能产生 `INELIGIBLE`。
若 `TERMINAL_RESULT` assessment 为 `INCOMPLETE_INVALID`，则增加 `ASSESSMENT_INVALID` 和 holdout 闭合且不生成 Eligibility Fact。只有有效
完整 assessment 才增加密封 Protected Run Result 和唯一 `INELIGIBLE` 或 `QUALIFIED` Eligibility Fact，
并交叉绑定准确 Protected Replay Request、准确结果、保护决策政策身份与版本和已验证请求结果相等关系。
该事实还绑定生效区间；合格时绑定可执行经济条件版本、成本容量模型版本与容量上限。后续过期或撤销
是不可变后继 Eligibility Fact。`UNAVAILABLE` 只绑定请求的 Candidate 与摘要阶段身份，不编造当前
权威阶段事实。

该 Eligibility Fact 还必须重复 Candidate Intake 与 Protected Replay Request 的准确保护决策政策身份和版本。

## Development outcome / 开发结果

- **受益者** - 判断冻结候选是否可部署的独立评估者 治理运营者和资金负责人。
- **可观测结果** - 每个请求闭合为 intake 拒绝 保护尝试处置或资格，并带准确 holdout 成本 容量和消费输入血缘。
- **未改变伤害** - 过拟合候选 模拟器不匹配 隐藏试验族或重复使用 holdout 可能被提升为经济有效证据。
- **终态负例** - 未选择或 intake 不完整为 `NOT_ADMITTED`；回放拒绝或无效不生成 Eligibility Fact；有效失败为 `INELIGIBLE`，均不能作为合格事实进入 Governance。

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- 预注册不完整 Census Frontier 缺失 可变 不穷尽或冻结后分叉，或者 PIT 数据不可用时，保护评估必须停止。
- 祖先未解析 独立性依据过晚 反馈前沿过期或同一 intake 使用新请求身份时必须 `NOT_ADMITTED`，且不创建 holdout 尝试。
- Research 终态停止不创建 Candidate，也不进入 intake。仅选择 Research Selection Disposition 缺失，
  或与 Candidate 证伪条件 停止规则 探索前沿 Census 不匹配时，在保护回放前闭合为 `NOT_ADMITTED`
  且不消耗 holdout。
- 保护请求不能原地拒绝；Backtest 拒绝必须生成绑定同一请求的 `RUN_REJECTED` 结果，使 Qualification 能闭合 holdout 托管。
- Artifact PIT 范围 PIT Market Snapshot 身份 Universe Selection Record 身份或摘要 快照规则 重放配置 Runtime 内核 模拟器 成本 滑点 容量模型任一缺失 替换或不匹配都生成 `INVALID_REPLAY_EVIDENCE`，按预注册 holdout 处理闭合且不生成 Eligibility Fact。
- 被拒绝 无效 非终态或请求结果不匹配证据不能创建或续期 Eligibility；保护决策政策版本变化必须重新
  评估，不能重新解释之前的结果。
- Candidate `ADMITTED` Intake Protected Replay Request 与 Eligibility 必须携带同一保护决策政策身份与
  版本；政策身份或版本缺失 替换时失败关闭。
- Backtest 不能授予资格，Qualification 不能激活策略。
- 同一试验族的保护结果不得返回 R&D 调参。
- 保护 diagnostic category 与 category-derived aggregate 不得进入 Dashboard metric alert health score 或
  research-funnel projection；有界运行状态必须保持 category 不可区分。
- 通过一次保护测试不能消除多重试验、成本、容量或 holdout 消耗限制。
- Qualification 不能根据单个漂亮 aggregate 写入 `QUALIFIED`。Candidate Intake 必须先按准确且由
  Qualification 拥有的 robustness-adequacy policy 接纳计划，包括至少两个不重叠窗口、至少两个实质
  不同且含一个不利状态的市场 regime，以及每轴被接受的覆盖或不适用依据。完整 Protected Robustness Plan 必须满足
  预注册单元覆盖 容差 阈值 聚合与缺失单元规则；遗漏或结果后选择的单元必须失败关闭。
- 每个计划必需 cell 必须准确解析一次，同一轴可以包含多个 cell。不适用需要被绑定政策接受的明确
  结果前依据；依据缺失 过期 被拒或政策不匹配时为 rejected，全不适用 census 是
  `INCOMPLETE_INVALID` 并提交 `ASSESSMENT_INVALID`，不是通过或 Eligibility Fact。
- purge 与 embargo 派生 family-aware multiplicity 和 attempt-frontier basis 必须版本化并在 Candidate
  Intake Protected Replay Request Run Result Eligibility 间保持冻结；basis 改变只能创建后继评估，
  不能重新解释已消费 holdout。
- Governance 或 Risk 不能扩大容量上限，也不能把它绑定到其他 Candidate 条件 模型或 Eligibility Fact 版本。
- 更换 TrialFamily Candidate Artifact Shell 或请求身份都不能重置被拒 无效 未知或终态保护尝试的累计消耗。
