# 研究场景

R&D 把带来源市场假设转化为冻结且可复现的策略工件，同时把探索迭代与保护资格评估隔离。

## Entry / 入口

Product Edge 提交带来源链接的假设。请求说明预期机制和待证伪问题，并提交已经投影给该 principal 的
有界 Qualification 阶段事实前沿，但此时既不是策略证据，也不是交易权限。

## Value path / 价值路径

Source Intake 记录来源，并把来源或工具内容视为不可信数据而非指令。Intent 冻结前，R&D 内的 Research 能力记录合理
替代解释 能区分机制的预测和证伪条件。R&D 在提交前冻结初始 PIT Market Snapshot Request；Market
Data 只把 snapshot disposition 关联到准确身份 摘要 scope 决定截面 provenance license correction 和
Time Evidence。提交或静默不是市场事实。Research Intent 冻结机制、数据范围、
provider-neutral 获取基线见[研究来源接入指南](../../guide/source-intake/)，它不增加 Flow 节点或业务权威。
准确成本 滑点与容量模型版本 容量假设 永久 TrialFamily 完整语义前驱前沿 预提交独立性依据 预算 证伪条件和停止规则。Develop Sandbox 在隔离环境构建。
Strategy Artifact 绑定冻结意图、代码、依赖和运行环境身份。探索性 Native Replay 只有在结果逐项重复
且等于请求的 Artifact PIT 范围与 snapshot universe selection 与修订规则 重放配置 Runtime 内核
模拟器 成本 滑点和容量身份时，才可以返回供 R&D 创建新一轮意图的规范事实。每个终态探索结果
先提供一个完整 有限 非空的 `diagnosticCategorySet`，保留所有同时得到支持的类别。六种执行缺陷映射到同名 `REPAIR_INPUTS`；
`NO_EXECUTION_DEFECT` 与 `VALID_ECONOMIC_FAILURE` 允许解释，`UNRESOLVED_FAILURE` 不产生决定。
Research 再诊断证据
机制 经济 稳健性 失败原因和序数信息价值，再提交一个 Iteration Decision：`REPAIR_INPUTS`；从
`RETURN_MECHANISM` `MARKET_REGIME` `INSTRUMENT_SCOPE` `FEATURE_SIGNAL` `ENTRY_RULE` `EXIT_RULE`
`POSITION_AND_HOLDING` `FREQUENCY_AND_COST` `CAPACITY_AND_PORTFOLIO_ROLE` 中选择一个
`SINGLE_DIMENSION` 后继；一个预注册有限联合实验；`READY_FOR_SELECTION`
或终态停止。Selection 必须绑定唯一 `READY_FOR_SELECTION` 以及相同政策 证据和 Census 截面。
`REPAIR_INPUTS` 必须从 `MARKET_DATA` `ARTIFACT` `RUNTIME_KERNEL` `BACKTEST_OPERATIONAL`
`SIMULATOR` `REPLAY_CONFIGURATION` 中选择唯一类别及其原生
Owner 边界。它是所消费结果的终态，本身不启动修复 后继 Artifact Replay Request 或 Selection。Market
Data 拥有 PIT 修复，R&D 拥有 Artifact 与 Replay Configuration 修复。对 `RUNTIME_KERNEL` `SIMULATOR`
或 `BACKTEST_OPERATIONAL`，R&D 冻结一个 `native-repair-request`，绑定前驱 repair decision、稳定
correlation、原始 proof digest、类别专属旧 identity 与 source cut、目标 Owner、policy 和新鲜 Time
Evidence。Runtime 只接受 kernel 修复；Backtest 只在 Sim Exchange 表面 `sim-exchange` 接受
`SIMULATOR`，并只在 Native Replay 的 `BACKTEST_RUNNER_SERVICE` 接受 `BACKTEST_OPERATIONAL`。
`BACKTEST_OPERATIONAL` 绑定 operational profile、run attempt、runner readiness、backpressure、
resource exhaustion 或 outage 证据和 Time Evidence；它先于经济解释，且不能伪装成 `RUNTIME_KERNEL`
或 `SIMULATOR`。只有 native Owner 能提交 `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`：`REPAIRED`
只允许一个新请求相等 Replay Request，绑定准确前驱 `REPAIR_INPUTS` 决定、类别、native repair request
与 result identity、原始 proof digest、稳定 correlation、前驱与后继 native identity 及 cut，以及未改变
的前驱请求语义。`BACKTEST_OPERATIONAL` 还绑定后继 operational-profile identity 与 cut。只有
`REPAIRED` 允许 re-entry；`UNAVAILABLE` 只闭合为准确
关联的 `STOP_INPUT_UNAVAILABLE`；`OUTCOME_UNKNOWN`、请求投递、静默或非终态证据不产生 stop retry
后继 Artifact Selection 或 Replay Request。
下一动作总优先级为：修复、hard stop、ready for selection、low-information-value stop、唯一 change。
有限 change set 使用序数 rank 确定 tie-break 和无碰撞 identity 加 content digest；identity 或完整
comparison key 重复时集合无效且不产生动作。

有人值守 D-only 分支与这个自适应 TrialFamily 循环分离。Product Edge 提交唯一准确
`ATTENDED_D_ONLY_REPAIR`，接受回执只证明 R&D admission；admission 前拒绝只在该 receipt 上记为
`REJECTED_NO_WRITE`，不创建 repair attempt 或 disposition。R&D 随后写入一个关联 request 与 attempt 的
D-only Repair Disposition。`D0_COMPLETED_NO_ARTIFACT` 证明声明的非可执行修复且没有 Artifact；
`D1_VALIDATED` 要求新的不可变 Artifact 和通过且请求相等的 repair validation，之后才允许另行创建
attended-repair Candidate；`D1_VALIDATION_FAILED` 保留已构建后继 Artifact 与失败验证，但不创建
Candidate；`D1_BUILD_FAILED` 在任何 canonical 后继 Artifact validation result 或 Candidate 出现前终态记录
确定性 build package 或 Artifact Security Admission 失败，且不授权重试；`REJECTED_NOT_D_ONLY` 把语义变化路由到独立的带来源假设请求；`OUTCOME_UNKNOWN` 在最后
权威 frontier 闭合 attempt，不产生成功或裸重试。相同 request admission attempt 与含义的重放加入同一
只写一次 disposition；另一次 attempt 必须有新的显式用户请求 后继 admission 和后继 attempt。

## Owner handoffs / Owner 交接

Product Edge → R&D 传递带来源请求。R&D → Product Edge 返回只写一次的 R&D Request
Receipt：`ACCEPTED` 绑定结果 Research Intent，`REJECTED_NO_WRITE` 证明没有 Research 转换；没有回执时
原请求保持未决。R&D → Market Data 传递冻结初始 PIT Market Snapshot Request；Market Data →
R&D 只返回与它完全关联的 disposition。
提交 `REPAIR_INPUTS` 决定后，R&D → Market Data 传递关联 Market Data Repair Request；Market Data
→ R&D 只返回匹配的 `AVAILABLE` 或 `UNAVAILABLE` PIT Snapshot 终态。送达 静默和证明摘要变化
都不是修复结果。
R&D 内的 Research 与 Develop 共用一个 Owner；Develop 生成不可变 Artifact 与构建证据，不形成第二
权威。R&D → Backtest 传递不可变 Artifact，并另行传递一个冻结 Exploratory Replay Request，绑定准确
工件 数据范围 重放配置和 Intent 的准确成本 滑点与容量模型身份；Backtest → R&D 只返回探索事实，
不能替 R&D 选择下一动作。native repair 时，R&D → Runtime 只传递 `RUNTIME_KERNEL`
`native-repair-request`，R&D → Backtest 只传递
`SIMULATOR` 或 `BACKTEST_OPERATIONAL` `native-repair-request`；每个 Owner 返回准确 request-correlated
终态结果，只有 R&D 可以形成由此产生的 replay 或 stop 转换。
Market Data → Backtest 提供冻结回放输入。后续 Market Data 修订只能作为
后继专用的已提交 provenance 进入 R&D，不能改写旧请求 Intent Selection 或已部署 generation。
只有 `SELECTED_FOR_QUALIFICATION` 可以把冻结 Candidate 与准确 disposition 交给 Qualification；
任何终态停止都只保留在 Iteration Decision，不产生 Selection Qualification intake 或保护 holdout 消耗。
Candidate 还携带结果前 Protected Robustness Plan，覆盖必需时间 市场状态 标的 扰动和合理参数邻域
单元及覆盖 容差 阈值 聚合与缺失单元政策。Qualification 和保护 Backtest 原样消费且不返回保护细节。
已提交 Live Performance Runtime Incident 和 Reconciliation Drift 事实只能进入后继 source lineage，
不能改写已选择或已部署 Intent。

## Proof / 证明

场景只有在 `ACCEPTED` Research Request Receipt 绑定准确 `FROZEN` Research Intent 后才开始，并以该意图 永久 TrialFamily 身份 内容寻址 Strategy Artifact 与 Build Receipt
稳定且由 R&D 拥有的 Exploratory Replay Request 带身份 PIT Market Snapshot，以及关联该请求的规范探索 Run Result 结束。
只有 Iteration Decision 为 `READY_FOR_SELECTION` 时，证明才包含唯一仅选择 Research Selection
Disposition，绑定冻结 Intent 证伪条件与选择采用的完整探索和 Census 前沿。终态停止只由 Iteration
Decision 证明，不存在 Selection 或 Candidate。Intent Request Result Diagnosis Iteration Decision 和
任何 Selection Candidate 重复同一准确成本 滑点与容量模型身份。

## Development outcome / 开发结果

- **受益者** — 需要快速迭代又不能消耗保护证据或隐藏失败试验的研究员与策略开发者。
- **可观测结果** — 带来源假设成为可复现工件和明确 Iteration Decision；只有
  `READY_FOR_SELECTION` 才在 Qualification 前增加绑定证伪条件的 Selection。
- **未改变伤害** — 探索赢家可能擦除失败同族试验 偏离冻结证伪条件，或让 Research 未选择的候选消耗 holdout。
- **终态负例** — 证伪拒绝 停止规则 预算耗尽或关联输入修复不可用进入明确 Iteration Decision 停止，
  不产生 Selection 或保护回放。身份不完整 不匹配 未知或非终态尝试保持未决或成为类型化修复证据，
  不能当作停止。

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- 来源、PIT 时间、标的身份、成本、预算或证伪条件缺失时，工件不得进入后续路径。
- 生成代码不能从 Develop Sandbox 获得账户或执行权限。
- 探索结果不是资格、部署决定或实盘证据。
- 探索请求可变 已取代 不匹配 不完整或未解析时，不生成运行或结果。
- 只有请求相等的 `TERMINAL_RESULT` 可以进入 Research Selection。被拒 无效 未知 非终态或请求不匹配
  的尝试只留在 TrialFamily Census。被拒或无效证据只能产生类型化 `REPAIR_INPUTS`，未知证据不产生
  决定。后继实验必须等于冻结 tie-break 下最高排名的可接纳选项。
- 诊断分类 change identity content digest 或完整 comparator key 重复时，不能按到达顺序处理，只能保持
  unresolved/no-decision。
- purge 与 embargo 派生 family-aware multiplicity 完整 attempt frontier 保护政策 experiment mode 变化
  维度和有限联合组合都在结果前冻结并原样传递。
- 保护结果不得返回本研究循环。
- 仅选择 Research Selection Disposition 缺失或与证伪条件不匹配时不能进入 Qualification；不存在
  未选择 disposition。
- 后续请求可以引用不透明反馈前沿，但 Research 永不读取保护类别或细节，也不能通过更换 TrialFamily 获得新 holdout 预算。
- 没有 R&D-owned 回执时，Shell 送达不能创建或证明 Research Intent。
