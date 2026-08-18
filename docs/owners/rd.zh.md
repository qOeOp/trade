# R&D

## 职责

把 Research 与 Develop 统一在一个业务事实 Owner 内。Research 能力把可追踪假设转化为可证伪 Research Intent；Develop 能力生成不可变 Strategy Artifact 并执行有界的有人值守修复。R&D 同时拥有实验与工件身份，使用 Backtest 作为证据生产服务，但不拥有保护资格 部署或交易权威。

## 拥有的权威事实

- 不可变 Research Source Provenance Record，绑定来源身份 内容摘要 位置 检索截面 共享时间证据
  许可依据，以及形成假设时采用的有界解释身份与摘要。
- 冻结的机制 数据范围 准确成本 滑点与容量模型身份 容量假设 永久 TrialFamily 身份 预算 证伪条件和停止规则。
- 自适应研究血缘 完整语义前驱前沿 Product Edge 的不透明保护反馈观察前沿，以及保护反馈前已提交的独立性依据。
- 绑定意图 TrialFamily 准确代码字节 依赖来源与 lock 身份 工具链与运行环境身份 Market Semantics
  Compatibility 身份 sandbox policy capability manifest 和 Artifact Security Admission 结果的 Strategy Artifact
  与 Build Receipt。
- 冻结 Exploratory Replay Request，绑定准确意图 TrialFamily 工件 请求 PIT 数据范围 重放配置和成本容量模型。
- 探索请求与结果必须在 Strategy Artifact 请求 PIT 范围 PIT Market Snapshot Universe Selection Record
  与修订规则 重放配置 Runtime 内核 模拟器 成本 滑点和容量模型身份上完全相等。只有请求相等的
  `TERMINAL_RESULT` 可以进入 Research Selection。
- 只追加 TrialFamily Census Frontier，记录冻结截面前每个探索 Intent Request Result 身份，包括失败 被拒 无效 未知试验以及已消费族预算。
- 可以支持新 Research Intent 的探索发现，但不能改写已冻结前序事实。
- Research Iteration Decision：唯一记录完整支持诊断集合、按确定规则选出的单一类型修复类别与目标边界的 `REPAIR_INPUTS` 后继实验
  `READY_FOR_SELECTION` 或命名终态停止的 Research 事实。停止 修复和后继结果都不会创建 Selection。
  未知或非终态运行不存在 Iteration Decision。
- 在保护证据出现前提交的冻结 Protected Robustness Plan 身份与版本。它声明必需时间窗口 市场状态
  标的切片 扰动和合理参数邻域单元，以及指标 覆盖 容差 阈值 聚合 缺失单元和停止政策，并绑定准确
  TrialFamily Artifact 成本 滑点 容量模型 purge 与 embargo。Research 定义计划但永不读取保护测量或结果细节。
- Research Selection Disposition：只在已选择时提交 `SELECTED_FOR_QUALIFICATION`，绑定准确
  `READY_FOR_SELECTION` 决定 Research Intent 证伪条件与停止规则 探索请求结果前沿 成本 容量假设
  TrialFamily Census Frontier 预注册保护决策政策身份与版本和 R&D 拥有的选择理由类别。
- 只写一次的 Research Request Receipt：`ACCEPTED` 绑定唯一结果 Research Intent 身份，`REJECTED_NO_WRITE` 不绑定任何 Research 转换。
- 只写一次且关联请求的 D-only Repair Disposition，绑定已接纳 repair admission、准确前驱 generation 与
  Artifact、允许修复面、impact class、构建与验证证据以及共享 Time Evidence。穷尽状态只有
  `D0_COMPLETED_NO_ARTIFACT` `D1_VALIDATED` `D1_VALIDATION_FAILED` `D1_BUILD_FAILED` `REJECTED_NOT_D_ONLY`
  和 `OUTCOME_UNKNOWN`。

## 模块

- **Source Intake** - 把论文 观察 笔记 媒体和工具输出作为带来源与内容身份的不可信数据接纳。来源
  内容永远不是指令 能力授权或调用其他 Owner 的权威。provider-neutral 实现基线见
  [研究来源接入指南](../guide/source-intake/)。
- **Research Intent** - 在观察结果前冻结可证伪机制和实验契约。
- **Strategy Artifact** - 保存不可变内容 依赖来源 市场语义 runtime capability sandbox policy 和
  Artifact Security Admission，供重放 资格与治理应用原样消费。
- **Development Sandbox** - 只通过显式输入输出 mount 构建并诊断策略代码，没有环境 filesystem network
  subprocess 或 process-tree escape inherited capability secret 账户 部署或 effect-port 权威。

## 有人值守的 D-only 修复

授权用户可以选择一个准确的当前策略 generation 与 Artifact，要求 R&D 只修复实现缺陷而不启动自适应
Research。Product Edge 只提交类型化 `ATTENDED_D_ONLY_REPAIR` 请求并显示有界结果，只有 R&D 能接纳
请求并提交 D-only Repair Disposition；Shell 确认或可见视图都不是该终态事实。

- admission 前的过期 无效 未授权或含义已变请求只通过 R&D Request Receipt 闭合为
  `REJECTED_NO_WRITE`；此时没有 repair attempt，因此不创建 D-only Repair Disposition。
- `D0_NON_EXECUTABLE` 只有在可执行字节 依赖 lock capability manifest 确定性 trace 和全部可部署
  身份均未变化时才闭合为 `D0_COMPLETED_NO_ARTIFACT`；它不创建 Artifact Candidate Qualification
  attempt Governance generation 或替换。
- `D1_EXECUTABLE_REPAIR` 先执行确定性 build package 与 Artifact Security Admission attempt。该阶段的
  确定性失败在任何 canonical 后继 Artifact、security admission、repair-validation result 或 Candidate
  出现前闭合为 `D1_BUILD_FAILED`；失败证据与新鲜 Time Evidence 对本次 attempt 为终态，且不授权裸重试。
  构建完成后才生成新的不可变 Artifact，再执行请求相等且非自适应的 Backtest 修复验证。通过时闭合为
  `D1_VALIDATED`，此后才允许另行创建 attended-repair Candidate 进入独立 Qualification；
  验证失败 被拒 无效或语义不相等时闭合为 `D1_VALIDATION_FAILED`，保留不可变构建证据但不创建
  Candidate 或生命周期转换。
- admission 后的机制 参数 universe PIT 或数据语义 市场语义 成本 滑点 容量 allowed surface 或其他
  Research 维度违反都闭合为
  `REJECTED_NOT_D_ONLY`；它不创建 repair Artifact 或 Candidate，只能另行授权进入带来源假设的
  Research Intent。
- 构建或验证 custody 缺失或无法对账时，在最后权威 frontier 明确闭合为 `OUTCOME_UNKNOWN`；投递
  静默 超时 telemetry 或 Product view 都不能提升为成功。它不创建 Artifact Candidate Qualification
  或部署转换，也不能触发裸重试。
- 前序 Artifact 与 generation 永不原地修改。每个 disposition 都重复原始 request admission attempt
  身份和准确 admitted cut。相同 request admission attempt 与含义的重放加入只写一次的 disposition；
  含义变化必须拒绝，另一次尝试需要新的显式用户请求 后继 admission 与后继 attempt。Backtest 只返回
  修复验证事实，不选择修改内容；保护 Qualification 细节永不返回 R&D。

## Research 诊断与迭代契约

Source Intake 不能从来源直接跳到代码。Intent 冻结前，Research 至少记录一个合理替代解释、一个能区分
首选机制与替代解释的可观察预测，以及一个证伪条件。缺少替代解释或预测没有区分力时，来源可以被
接纳，但不能生成可交接 Intent。

| 诊断维度   | 必需诊断                                                                                                                                                  | 决策用途                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 证据完整性 | 校验来源 PIT 时间 universe 与修订身份 Artifact 配置 runtime simulator 以及确定性请求结果相等。                                                            | 解释策略表现前先修复或拒绝证据。                                                                              |
| 机制有效性 | 对照冻结因果机制 证伪条件与停止规则，判断观察方向 路径 市场状态和失败方式。                                                                               | 停止已证伪机制，或只创建一个后继机制假设。                                                                    |
| 经济可行性 | 按冻结模型版本归因换手 费用 spread 滑点 冲击 流动性和容量。                                                                                               | 经济不可能时停止，或在稳健性检验前只修改一个经济假设。                                                        |
| 稳健性     | 在不消费保护证据时检验时间 市场状态 标的 扰动和合理参数邻域敏感性。                                                                                       | 区分稳定机制支持与狭窄参数偶然。                                                                              |
| 失败归因   | 把失败分类为数据 工件 runtime simulator 机制 经济 稳健性或未解析不确定性。                                                                                | 把修复路由到所属边界，防止无效运行成为负 Alpha 证据。                                                         |
| 信息价值   | 每个预注册下一实验都绑定决定不确定性 区分性观察或证伪 结果到动作映射 有界获取成本 剩余 family 预算影响 竞争替代项，以及同一证据截面的可重放序数比较理由。 | 以确定 tie‑break 选择排名最高的可接纳实验；无解释序数不可接纳，只有完整且非空的全员低于阈值 census 才能停止。 |

Backtest 为每个终态探索结果提供完整有限 `diagnosticCategorySet`；Research 必须保留全部支持成员，
并先按以下准确映射再解释经济表现：

| Run Result 诊断集合                                                                                        | Research 处置                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 含任一 `MARKET_DATA` `ARTIFACT` `RUNTIME_KERNEL` `BACKTEST_OPERATIONAL` `SIMULATOR` `REPLAY_CONFIGURATION` | 缺陷证据优先于经济解释；保留全部支持缺陷，再按 `MARKET_DATA > ARTIFACT > RUNTIME_KERNEL > BACKTEST_OPERATIONAL > SIMULATOR > REPLAY_CONFIGURATION` 选择唯一 `REPAIR_INPUTS` 目标。 |
| 不含缺陷，且含 `NO_EXECUTION_DEFECT` 或 `VALID_ECONOMIC_FAILURE`                                           | 允许经济与机制解释，但都不强制迭代或选择。                                                                                                                                         |
| `UNRESOLVED_FAILURE`                                                                                       | 不产生 Iteration Decision；保留在 census，直到取得可隔离证据。                                                                                                                     |

每个后继只声明一种 experiment mode。一次迭代在 `SINGLE_DIMENSION` 模式下只改变一个与决定相关的假设
dimension，并从以下九个 typed dimension 中选择：
`RETURN_MECHANISM` `MARKET_REGIME` `INSTRUMENT_SCOPE` `FEATURE_SIGNAL` `ENTRY_RULE`
`EXIT_RULE` `POSITION_AND_HOLDING` `FREQUENCY_AND_COST` `CAPACITY_AND_PORTFOLIO_ROLE`。只有假设
确实需要有限组合时才允许
`PREREGISTERED_FINITE_JOINT`；必须在观察结果前冻结全部变化维度 有界组合 归因规则 预算 证伪与停止
规则。它不能成为开放参数搜索，也不能掩盖观察结果后的捆绑调参。

准确开发流程是 **Run Result → Diagnosis → Iteration Decision → Successor Intent / Selection**：

1. 只有请求相等的 `TERMINAL_RESULT` 进入 Diagnosis，并先按上表映射其完整 Backtest
   `diagnosticCategorySet`。所有同时有证据支持的成员都保留在结果与决定上；任一缺陷都优先于经济解释，
   Research 再按冻结类别优先级选择唯一修复而不丢弃低优先级事实。来源 provenance 缺陷使
   Intent 准入失败，有效经济模型变化属于 typed successor hypothesis，而不是证据修复。
   `UNRESOLVED_FAILURE`、未知或非终态尝试、无效候选集都不产生 Iteration Decision。全部尝试保留在
   TrialFamily Census，不能重新解释为负 Alpha 证据。
2. Diagnosis 记录全部六个维度，引用准确 Intent Request Result Artifact 数据 runtime simulator 和
   成本 滑点 容量模型身份，不改写任何事实。
3. 下一动作使用完整优先级：`REPAIR_INPUTS`；再处理 input unavailable 证伪 规则或预算 hard stop；再
   `READY_FOR_SELECTION`；再 `STOP_LOW_INFORMATION_VALUE`；最后才选择唯一 change。change 分支中，
   证据修复优先于解释，机制优先于参数细化，再检查经济与稳健性。只有冻结生成规则 candidate-set
   frontier expected cardinality observed membership 与每个候选的类型化 admissibility reason 共同证明没有
   候选缺失或未解析时，候选 census 才完整。完整有限集合按 admissibility、序数
   uncertainty-reduction rank、确定 tie-break key、无碰撞候选身份加内容摘要作字典序比较。身份 摘要或
   完整比较 key 重复都会使集合无效，不创建后继 选择 修复效果或低信息停止。只有完整 census 中每个
   成员均可接纳、都已按预注册阈值可比打分且全部低于阈值时，才能提交
   `STOP_LOW_INFORMATION_VALUE`。集合不完整 未知 因其他理由不可接纳或不可比较时不产生 Iteration
   Decision；所选身份必须等于唯一计算胜者。
4. Iteration Decision 只提交一个互斥结果：`REPAIR_INPUTS` 后继实验 `READY_FOR_SELECTION` 或终态停止。
   后继冻结新 Research Intent 必要时的新 Artifact 和 Replay Request 身份。Research Selection 只能绑定
   唯一 `READY_FOR_SELECTION` 决定及相同 decision-policy version TrialFamily Census 与证据截面；停止
   状态与选择不能并存。

`REPAIR_INPUTS` 按类别路由，绝不表示任意重试。它是所消费结果的不可变终态处置，本身不创建
Selection 后继 Intent Artifact Replay Request 或修复效果。`MARKET_DATA` 指向 Market Data，也是唯一能
在决定提交后产生关联 Market Data Repair Request 的类别；`ARTIFACT` 指向 Research 经 Develop 重建并
要求新 Artifact 身份；`RUNTIME_KERNEL` 指向 Runtime 并要求新 kernel 身份；`BACKTEST_OPERATIONAL`
指向 Backtest 在 Native Replay 表面的
`BACKTEST_RUNNER_SERVICE`，绑定 operational-profile version、run attempt、runner/service readiness、
backpressure、resource exhaustion 或 outage 证据和 Time Evidence。它必须先于经济解释闭合，且不能
重标为 `RUNTIME_KERNEL` 或 `SIMULATOR`；`SIMULATOR` 指向 Backtest 的 Sim Exchange 表面
`sim-exchange`，并要求新 simulator 身份。
`REPLAY_CONFIGURATION` 仍由 R&D 拥有，并要求带新配置摘要的新
Replay Request。对 `RUNTIME_KERNEL` `SIMULATOR` 与 `BACKTEST_OPERATIONAL`，R&D 从准确前驱
`REPAIR_INPUTS` 决定、稳定 correlation、原始缺陷 proof digest、类别专属旧 native identity 与 source
cut、目标 Owner、policy 和新鲜 Time Evidence 冻结一个 `native-repair-request`。Runtime 只接受
`RUNTIME_KERNEL`，Backtest 只接受 `SIMULATOR` 或 `BACKTEST_OPERATIONAL`；含义相同的 replay 加入同一
native attempt，含义变化则需要后继 R&D-owned request identity。

只有 native Owner 能把关联修复结果提交为 `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`。
`REPAIRED` 命名新的类别专属 native identity，并只允许 R&D 冻结一个新请求相等 Replay Request，绑定
准确 native-repair-request identity、准确 repair-result identity、新类别专属 native identity、原始
defect-proof digest、准确前驱 `REPAIR_INPUTS` 决定、类别、稳定 correlation、前驱与后继类别专属 native
identity 及 source cut，以及未改变的前驱请求语义。`BACKTEST_OPERATIONAL` 还绑定后继 operational-profile
identity 与 cut。只有匹配的 `REPAIRED` result 允许该 re-entry；`UNAVAILABLE` 与 `OUTCOME_UNKNOWN`
都不允许。`UNAVAILABLE` 对本次 attempt 为终态，只允许准确关联的 `STOP_INPUT_UNAVAILABLE`；
`OUTCOME_UNKNOWN` 不提交 stop retry 后继 Intent Selection Artifact 或 Replay Request。请求投递 接受 静默
或 telemetry 都不能替代终态结果；任何 native repair 都不改写旧 Intent，也不静默开工。

Market Data Repair Request 绑定原始 PIT 请求与证明摘要 标的范围 决策截面 类别 稳定 correlation 身份
和共享 Time Evidence。Market Data 返回关联的 `AVAILABLE` 或 `UNAVAILABLE` PIT Snapshot 终态；传输
送达 静默或证明摘要变化都不是结果。匹配 `UNAVAILABLE` 会提交只追加 Research 终态
`STOP_INPUT_UNAVAILABLE`，绑定前驱修复决定 准确请求结果 证据截面和时间证据，不创建 Selection
重试或后继 Intent。匹配可用修复可以支持新请求。修复不改写旧 Intent，也不静默开工。

触发冻结证伪条件 停止规则 预算耗尽 已证明经济不可能或预期信息价值过低时必须停止。低信息价值只能
由上述完整已比较候选 census 证明；未知 不完整 因其他理由不可接纳或不可比较的选项都不能推出该停止。
完整证据截面已可选择时也结束探索。保护测量 结果 类别和 holdout 细节永不进入 Diagnosis 或 Iteration Decision。
purge 与 embargo 派生规则、TrialFamily-aware multiplicity policy、attempt frontier 和保护决策政策都在
结果前冻结，并在 Replay Request Run Result Iteration Decision Selection 与 Candidate 之间原样传递。
其中任一改变都创建后继血缘，不能重新解释旧结果。

## 输入交接

- Product Edge 提供带来源研究请求而不是无来源交易指令，请求提交已经投影给该 principal 的有界保护反馈前沿。Research 用自己的终态回执解析稳定请求身份，并保留语义前驱而不读取保护类别或细节；回执缺失时保持未知。
- [Market Data](./market-data/) 提供 PIT 事实 数据版本 标的语义，以及对已提交 Market Data Repair
  Request 的关联 `AVAILABLE` 或 `UNAVAILABLE` 终态。
- 探索性 [Backtest](./backtest/) 结果可以支持创建新的意图和工件版本。
- 已提交且绑定 generation 的 Performance Runtime Incident Execution 账户 订单 成交 quality observation
  Effect Journal 回读与 Reconciliation Drift 事实，只能作为新
  Research Source Provenance Record 进入后继血缘。它们不能改写已部署或已选择的 Intent Artifact
  Candidate，也不能越过保护证据边界。
- [Runtime](./runtime/) 直接提供已提交且按 generation 划分的 Incident 事实，只允许作为后继来源接纳。
  [Execution](./execution/) 直接提供已提交账户 订单 成交 quality observation Effect Journal 回读和
  Reconciliation Drift 事实，用途相同。两种交接都不能调节运行中 generation 或暴露保护
  Qualification 证据。每条 Research Source Provenance Record 都绑定准确已提交事实身份与来源截面；
  Effect Closure View 或 Event Rail wake 不能替代这些事实。

## 输出交接

- 向 [Market Data](./market-data/) 只在已提交 `REPAIR_INPUTS` Iteration Decision 后发出 Market Data
  Repair Request。请求要求原生 Owner 修复证据，不指定 adapter 不改写旧 snapshot 也不宣称数据可用。
- 向 [Backtest](./backtest/) 交付一个由 R&D 拥有的冻结 Exploratory Replay Request，绑定准确意图
  工件 数据范围 重放配置以及成本 滑点与容量模型身份。
  `REPAIR_INPUTS_SIMULATOR` 或 `REPAIR_INPUTS_BACKTEST_OPERATIONAL` 决定还可创建一个关联
  `native-repair-request`；只有 Backtest 能针对该准确类别专属 attempt 返回 `REPAIRED` `UNAVAILABLE`
  或 `OUTCOME_UNKNOWN`。
- 向 [Runtime](./runtime/) 只在已提交 `REPAIR_INPUTS_RUNTIME_KERNEL` 决定后创建一个关联
  `native-repair-request`；只有 Runtime 能针对该准确 kernel attempt 返回 `REPAIRED` `UNAVAILABLE`
  或 `OUTCOME_UNKNOWN`。
- 探索结束后只向 [Qualification](./qualification/) 交付拥有终态 `SELECTED_FOR_QUALIFICATION`
  Research Selection Disposition 的冻结 Candidate。交接交叉绑定准确 Intent 证伪条件与停止规则 完整预注册
  不可变穷尽 TrialFamily Census Frontier 探索请求结果前沿 完整跨 TrialFamily 语义前驱前沿 来源反馈前沿
  和预提交独立性依据。Candidate 与 Selection 重复 Intent 和探索请求结果前沿冻结的准确成本 滑点与
  容量模型身份以及预注册保护决策政策身份与版本。Candidate 还绑定冻结 Protected Robustness Plan
  身份与版本；Qualification 和保护 Backtest 原样消费它且不向 Research 返回保护测量。Candidate 与选择身份由 R&D 拥有，Qualification
  拥有 intake 与累计 holdout 状态。
- Selection 还必须绑定唯一 `READY_FOR_SELECTION` Iteration Decision，并且 policy version TrialFamily
  Census 和证据截面完全一致。`REPAIR_INPUTS` 后继 停止 被拒 无效 未知或非终态不能产生 Candidate。
- 向 Product Edge 提供终态 Research Request Receipt 和一个有界 Research View。有人值守修复时，同一
  view 还可投影 R&D-owned D-only Repair Disposition，但不拥有或重新解释它。视图绑定稳定请求
  trusted principal 授权 Research scope 授权政策截面 准确 Research 前沿 投影和 valid-through 时间，状态为 `AVAILABLE` `STALE`
  或 `UNAVAILABLE`，阶段为 `REQUEST_UNRESOLVED` `INTENT_FROZEN` `ARTIFACT_AVAILABLE`
  `EXPLORATION_ACTIVE` 或 `SELECTION_TERMINAL`。它可以汇总 R&D 拥有的来源 意图 工件 探索和
  决定事实，但不包含保护 Qualification 细节。终态停止只能来自 Iteration Decision，只有存在仅选择
  disposition 时视图才显示 Selection。

## 拒绝和禁止事项

- 不使用已提交候选的保护评估或 holdout 结果继续调优同一候选。
- 不原地修改冻结意图或工件，任何迭代必须创建新身份。
- 不用变化后的内容 检索截面 许可依据或解释重用 Research Source Provenance Record 身份；变化证据必须创建后继记录和 Research Intent。
- 不通过 Candidate 或 Artifact 改名重置 TrialFamily 或 holdout 历史。
- 不通过新 TrialFamily Shell principal 别名或请求身份擦除语义前驱或已经投影的保护反馈前沿。
- 不遗漏失败或无效同族试验 不重分 TrialFamily 也不在冻结 Candidate 后追加试验；新族成员必须创建后继 frontier 与 Candidate。
- 不选择实际消费身份与请求不同的探索结果。被拒 无效 未知 非终态或请求不匹配的尝试只留在 census。
- 不编造未选择 disposition。停止只属于 Iteration Decision；缺少仅选择 disposition 就不存在 Candidate 交接。
- 不在没有已提交 `REPAIR_INPUTS` 决定时发出 Market Data Repair Request，不把传输送达当作修复证明，
  也不在旧 Intent 下重新解释修复后的 snapshot。
- 不把非 `MARKET_DATA` 修复路由给 Market Data，不把 `UNAVAILABLE` 当作空结果，也不把未知或非终态
  尝试当作停止。`STOP_INPUT_UNAVAILABLE` 必须绑定准确关联终态结果。
- 冻结排名和 tie-break 指向另一实验时，不得选择排名较低的可接纳下一实验。
- 候选 census 不完整 membership 未知 因其他理由不可接纳或不可比较时，不得提交
  `STOP_LOW_INFORMATION_VALUE`；每个候选都必须存在 可接纳 已与阈值比较且低于阈值。
- 不按到达顺序打破重复或碰撞 comparison key；候选集无效且不产生下一动作。
- 不把来源 LLM 输出 漂亮回测或统计分数直接提升为部署资格。
- 不执行外部来源或工具响应中嵌入的指令。所有此类内容都只是未信任证据输入；只有接收 Owner 的
  类型化契约和已准入主体才能授权操作。
- 不准入依赖可变或未解析、capability 或 Artifact Security Admission 缺失、市场语义不匹配、可访问
  环境 secret、可逃逸 subprocess 或 process tree、继承环境权限，或使用未声明 filesystem network
  账户 部署 effect port 的工件。
- 不激活 Runtime 不分配资金 不签发风险许可也不发送订单。
- 不把 Shell 送达当成接受，不为含义改变的请求改写回执，也不让 `REJECTED_NO_WRITE` 绑定 Research Intent。

## 失败与恢复

来源缺失 数据语义不清 试验族无边界 成本不可用或预算耗尽时，禁止提交候选。未准入 build failure 只
作为 Develop Sandbox 诊断；已接纳 D1 repair 内的确定性 build package 或 security-admission 失败把
attempt 闭合为 `D1_BUILD_FAILED`。生产恢复不会重开冻结研究身份，运行事故只有在提交事实可读后才能
形成新的带来源假设。

## 决策契约

- **输入** - 已接纳来源 provenance PIT 事实 冻结 Intent 与实验政策 穷尽 TrialFamily Census 和请求
  相等探索结果。
- **诊断与决定** - 解释六类诊断维度，再按 typed experiment 规则只提交修复 后继 ready 或停止之一。
- **冲突解析** - 证据有效性和冻结 falsifier 高于漂亮表现；其他可接纳下一实验按序数信息价值和已
  声明 tie-break 选择。
- **输出与终态负例** - 后继 Intent `READY_FOR_SELECTION` 带类型 `REPAIR_INPUTS` 或命名停止；关联
  Market Data 修复不可用时产生 `STOP_INPUT_UNAVAILABLE`，未知证据不产生决定。
- **反馈与经济意义** - 探索和已提交 Owner 事实只能改善后继血缘；成本 滑点 容量 family 预算和预期
  决定价值共同阻止无经济意义的无限搜索。
- **禁止** - 不反馈保护细节 不原地修改 不隐藏同族试验，也不拥有部署 资金 风险 订单 账户或外部效果权威。

## 后续实现验收

- 每个工件都能解析到唯一不可变意图 代码字节摘要 依赖来源 可复现构建 Market Semantics
  Compatibility 身份 sandbox policy capability manifest 和 Artifact Security Admission 身份。
- 每次探索运行都能解析到唯一稳定且由 R&D 拥有的请求身份；工件 数据范围 配置或模型变化必须创建后继请求。
- 每个探索结果都逐项重复并等于请求的 Artifact PIT 范围与 snapshot universe selection 与修订规则
  重放配置 Runtime 内核 模拟器 成本 滑点和容量身份；只有相等的 `TERMINAL_RESULT` 可被选择，
  其他处置只保留在 census。
- 每个 Candidate 绑定不可变穷尽 Census Frontier 和已消费预算；缺失 可变 不完整或冻结后分叉的 frontier 禁止交接。
- 每个 Candidate 交接都解析到唯一 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition，
  并交叉绑定冻结 Intent 证伪条件 Protected Robustness Plan 和用于决定的全部探索证据。终态停止没有 Selection 或 Candidate，
  不产生 Qualification intake，也不消耗保护 holdout。
- 每个 Research View 都解析到一个一致 Research 前沿和 valid-through 时间。它不包含保护测量 参数
  结果 holdout 消耗或可解引用保护证据引用。
- Research View 重放若更换 principal scope 或授权政策截面必须拒绝，不能沿用旧请求身份返回视图。
- 终态选择只在存在唯一准确 `READY_FOR_SELECTION` Iteration Decision 时成立；任何停止或修复状态与
  选择互斥且不创建 Candidate。
- 每个 Market Data Repair Request 都解析到匹配 PIT 证明与 Time Evidence 的关联 `AVAILABLE` 或
  `UNAVAILABLE` 终态。缺失 不匹配或仅传输响应保持未决且不创建后继 Intent。
- 每个 `UNAVAILABLE` 修复结果都解析到一个 `STOP_INPUT_UNAVAILABLE`，绑定前驱 `REPAIR_INPUTS`
  请求 结果 截面与 Time Evidence。准确重放加入该停止，含义变化必须使用后继身份。
- 每个 Runtime 或 Backtest native repair request 都绑定唯一准确类别 前驱 repair decision 稳定 correlation
  原始 proof digest 旧 native identity source cut policy 和新鲜 Time Evidence。只有匹配 `REPAIRED` 结果
  可以支持新请求相等 Replay Request；`UNAVAILABLE` 只通过关联停止闭合，`OUTCOME_UNKNOWN` 不创建
  Research 转换或重试。
- 每个后继实验决定都证明其身份等于冻结序数排名与 tie-break 下最高排名的可接纳选项。
- 每个下一动作都证明其 total-precedence 分支；迭代还必须证明有限比较集无碰撞。身份 摘要或完整
  key 重复时不产生决定。
- 每个 `STOP_LOW_INFORMATION_VALUE` 都绑定完整 candidate-set frontier expected 与 observed membership、
  每个成员的类型化 admissibility、预注册阈值及证明全部成员低于阈值的比较证据；membership 未知或
  不完整时不产生 Iteration Decision。
- 每个已选择 Candidate 携带结果前 Protected Robustness Plan；必需单元 覆盖 容差 阈值 聚合 缺失单元
  政策和执行身份都可检查，同时不向 Research 暴露保护细节。
- 实验契约的时间戳早于被评估结果的揭示时间。
- 保护 Qualification 结果不存在写回同一 Research Intent 或 Strategy Artifact 的路径。
- 每次迭代都创建新血缘节点并明确前序身份和改变的假设。
- `SINGLE_DIMENSION` 下每个后继只能改变一个影响决定的假设维度；`PREREGISTERED_FINITE_JOINT` 下只允许改变观察结果前冻结的有限命名组合，并绑定归因规则 预算 证伪与停止规则。其他同时改变机制 参数 经济模型与稳健性条件的组合都不构成可归因实验。
- 有界 Qualification 反馈后的后继必须保留完整跨 TrialFamily 祖先；Research 可声明独立性但不能自行获得新 holdout 预算。
- Research Intent 状态只有 `DRAFT_NOT_HANDOFFABLE` `FROZEN` `SUPERSEDED`；探索证据只能创建后继意图。
- 同一请求身份与含义并发或重启重放时加入同一回执；接受回执必须绑定唯一结果 Research Intent。
- 每个已接纳 D-only attempt 准确提交一个只写一次 D-only Repair Disposition。D0 证明没有 Artifact；
  `D1_BUILD_FAILED` 证明 Artifact 前的确定性 build package 或 security-admission 失败，且不创建 Artifact
  validation result 或 Candidate；D1 验证失败不创建 Candidate；`REJECTED_NOT_D_ONLY` 不创建 repair transition；`OUTCOME_UNKNOWN` 绑定
  最后权威 frontier 且不允许裸重试。只有 request admission attempt correlation 与含义全部匹配时，
  replay 才加入原 disposition。

## 可观测性与持久化

R&D 原生持久化 Source Provenance、Research Intent、假设 lineage、TrialFamily 成员、Iteration Decision、
Selection、Artifact build/admission、D-only repair attempt、validation 与 D-only Repair Disposition。已提交
转换与 outbox 同事务写入；intake、sandbox、build、等待 replay 和决策时延只发送有界
trace/log/metric。Dashboard 可以从这些身份推导使用来源、假设数、开发尝试、失败类别、迭代次数、
到选中 Artifact 的耗时与 D-only repair 历史，但不能替代原事实，也不能暴露原始 source body、
credential、prompt 或 Qualification 保护证据。
