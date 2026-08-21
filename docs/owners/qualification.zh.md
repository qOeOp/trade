# Qualification

## 职责

独立判断冻结候选是否满足预注册证据 holdout 成本 容量和运行条件。Qualification 拥有可部署资格证据，不拥有策略设计 激活或恢复。

## 拥有的权威事实

- 持久 principal/scope 保护反馈历史及其不透明解析 frontier。Research 前的读取绑定一个准确 R&D
  Independence Basis Receipt，只能解析为 `GENESIS_EMPTY` `FRONTIER(ref, cut)` 或 `UNAVAILABLE`，并绑定
  source sequence/cut clock epoch 与半开有效期。
- R&D 拥有 Candidate 身份及其不可变穷尽 TrialFamily Census Frontier。Qualification 为一个稳定
  Qualification Review Request 与规范类型化含义拥有只写一次的 Candidate Intake Receipt；该回执绑定
  Research 终态 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition 不可变穷尽 TrialFamily
  Census Frontier 以及准确预注册保护决策政策身份与版本，状态为 `NOT_ADMITTED` 或
  `ADMITTED`，评估进度不会改写该关联请求回执。
- 具有不可变政策身份与版本的保护评估规则 holdout 预算与累计处理 embargo 成本 容量假设 试验族边界 跨 TrialFamily 前驱前沿和保护反馈观察前沿。
- Protected Robustness Assessment 绑定 Candidate 冻结 Protected Robustness Plan 和请求相等终态结果。
  它重复准确 plan-cell-set digest，把每个计划必需单元准确枚举一次为 `PASS` `FAIL` `NOT_APPLICABLE_ACCEPTED`
  `NOT_APPLICABLE_REJECTED` 或 `MISSING`，并绑定准确适用性 证据 政策和 Time Evidence。它只是
  Eligibility 分类证据；同一轴可以包含多个必需单元，且它绝不是向 Research 返回保护细节的通道。
- 冻结 Protected Replay Request 身份包含准确保护决策政策身份与版本 Strategy Artifact 请求 PIT 范围
  准确 PIT Market Snapshot 身份 快照与修订规则 重放配置摘要 Runtime 内核 模拟器及成本 滑点 容量模型版本。
- Protected Attempt Disposition 为 `REPLAY_REJECTED` `REPLAY_INVALID` 或 `ASSESSMENT_INVALID`，绑定 intake
  重放请求 终态结果和预注册 holdout 闭合，它不是 Eligibility。
- 每个初始或续期 Eligibility Fact 都交叉绑定准确 Protected Replay Request 准确 `TERMINAL_RESULT`
  Protected Run Result 保护决策政策身份与版本和已验证请求结果相等关系。
- 当前 Eligibility State 包含条件 过期时间 证据引用 撤销历史，以及 `QUALIFIED` 对应的下游可执行经济条件版本 已评估成本容量模型版本和资格容量上限。

## 模块

- **Candidate Intake** - 为不可变 Candidate 和证据包写入唯一回执；`NOT_ADMITTED` 不创建保护尝试也不消耗 holdout。
- **Protected Evaluation** - 按结果揭示前冻结的规则请求并评估隔离保护重放；只有匹配
  `TERMINAL_RESULT` 且按绑定保护决策政策版本评估后才能提交 Eligibility Fact。被拒绝 无效 非终态
  或不匹配证据均不能提交 Eligibility。
- **Eligibility State** - 发布当前不合格 合格 过期或撤销的可部署事实 条件 撤销历史，以及 Governance
  与 Risk 必须执行的有界经济容量契约。它把撤销作为 Eligibility 转换拥有，但不接管 Runtime 恢复。

## Research 前保护反馈解析

Qualification 不接收调用方对 genesis 空历史或当前反馈的断言。它直接解析准确 R&D Independence Basis
Receipt，锁定受信 principal 与 Research request scope 的完整持久历史，且只有历史为空时才提交唯一
genesis frontier。已有历史返回完整当前不透明 frontier；缺失 过期 畸形 冲突 跨 principal 跨 scope 或
跨 basis 输入都返回 `UNAVAILABLE`，且不创建 frontier 转换。

投影只公开 resolution state 不透明 frontier reference 与 digest basis reference 与 digest principal scope
source sequence/cut clock epoch projection time 和半开有效期。它不包含保护 payload outcome measurement
parameter holdout detail 或可解引用 evidence。未来任何保护反馈写入都必须重复预提交 basis 关系。相同
basis 与规范 source cut 重放准确相同字节；改变 basis 或 source cut 不能加入。

## 特定事故 Owner 重建

Qualification 只能执行为 2026-08-21 本地保护反馈丢失授权并封闭的
`qualification-owner-incident-v1-01a02194-139a-7281-9d2b-a87ab29d67ba` 重建。这是单一事故的
`DETERMINISTIC_CANONICAL_RECONSTRUCTION_NO_BACKUP` 契约，不是通用 restore 或 import API。它只接受准确的
证据 session 资源定位符、事故身份、授权定位符和目标数据库资源定位符；projection row、JSON 值、时间戳、
摘要、genesis 状态和当前有效性都不能由调用方输入。

任何插入前，Qualification 严格重验绑定的 JSONL record 字节、call/output/turn 配对、冻结规范生成器身份、
完整预期语义向量、存续 R&D basis/receipt/head/outbox、目标 fingerprint、全局空 Qualification 历史、缺失的
recovery receipt 与未运行的 outbox publisher。一个 serializable 事务取得 principal/scope advisory lock 和表
exclusive lock，随后依次插入原 projection、head、原 domain outbox row 与独立的 Qualification custody/audit
receipt。该 receipt 不发 domain wake，并明确没有恢复物理备份、没有观察原 JSONB 存储字节、没有铸造新
有效期。准确完成后的重放只返回相同 receipt 而不写入；partial、冲突、过期、畸形或非空状态全部 fail
closed。重建 projection 保留原半开区间，因此普通 resolver 在当前 cut 仍为 `UNAVAILABLE`。

## 输入交接

- [R&D](./rd/) 只提交拥有终态 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition
  的冻结 Candidate。Candidate disposition 与 intake 交叉绑定准确冻结 Intent 证伪条件和停止规则
  探索请求结果前沿 成本 容量假设，以及包含 Candidate 截面前已消费预算的不可变穷尽 TrialFamily Census Frontier。
  它们还交叉绑定唯一准确预注册保护决策政策身份与版本及一个冻结 Protected Robustness Plan。
- Product Edge 提交一个稳定评估请求，绑定来源 Research 请求 Candidate 规范类型化含义和从来源到当前的保护反馈观察前沿。
- [Backtest](./backtest/) 返回请求的保护 Run Result 和消费输入回执，每个实际消费执行字段必须与请求字段完全相等。
- 已提交证据变化可以触发重评，唤醒通道不能替代读取 Owner 事实。

## 输出交接

- 向 [Strategy Governance](./strategy-governance/) 提供包含撤销在内的分类 Eligibility State 事实，绑定
  准确 Candidate 与事实版本 经济条件版本 已评估成本容量模型版本 资格容量上限 生效时间及不可解引用证据引用。
  过期 撤销 当前事实缺失和当前状态未知都是显式下游状态，任何状态都不能让 Governance 静默保留
  活动 generation 的新增风险权限。
- 只有资格事实提交后才向 Event Rail 发布唤醒提示。保护 payload 只能包含公共终态、类型不透明且不可
  解引用的 reference 和 source-frontier freshness。保护 phase、latency、terminal timing 与 timing-derived
  field 明确禁止公开；永不发布内部 `INELIGIBLE` 或其他保护终态 disposition。
- 向 Product Edge 在 Research 准入前返回 basis 绑定的不透明 `GENESIS_EMPTY` `FRONTIER` 或
  `UNAVAILABLE` 保护反馈投影。Candidate Intake 时，先返回直接闭合准确评估请求的已提交且只写一次
  `NOT_ADMITTED` 或 `ADMITTED` Candidate Intake Receipt，再单独提供关联请求的 Qualification Status
  Summary。回执缺失保持 `SUBMITTED_OR_UNKNOWN`，摘要不能替代或编造回执。摘要在接纳后继评估前推进
  有界保护反馈观察前沿；`EVALUATING` 由 `ADMITTED` 回执与 `IN_PROGRESS_OR_UNKNOWN` 请求派生；所有
  内部负面 attempt disposition 或 `INELIGIBLE` fact 只投影为 `CLOSED_NOT_QUALIFIED`，正向 Eligibility
  Fact 投影为 `QUALIFIED`。引用必须类型不透明且不可解引用。`UNAVAILABLE` 只绑定未解析请求和阶段身份，
  后续阶段不改写先前事实。

## 拒绝和禁止事项

- 不接收可变工件 结果后的预注册 隐藏试验族 缺失或不穷尽 Census Frontier 冻结后族分叉 未解析跨 TrialFamily 前驱 结果后独立性依据 过期反馈前沿 不完整保护尝试前沿或无边界 holdout 重用。
- 不接纳缺失或身份不匹配的仅选择 Research Selection Disposition。Research 终态停止没有 Selection
  或 Candidate，也不进入 intake。该无效请求不产生 Qualification
  ADMITTED，只闭合为 `NOT_ADMITTED`，不产生保护请求或 holdout 消耗。
- 不把保护结果送回已提交候选的 R&D 循环。
- 不把保护测量 参数 结果 holdout 细节或评估输出复制进 Governance 事实或决定理由。
- 不通过 Product Edge 暴露保护测量 参数 holdout 细节或评估输出，证据引用也不能解引用为保护细节。
- 不把资格等同于激活 资金分配 Runtime 启动或交易许可。
- 不从沉默 wake event 或曾经有效的事实推断活动 generation 仍然合格。
- 不停止订单，也不宣布 Recovery Case 已闭合。

## 失败与恢复

预注册缺失或可变 TrialFamily Census Frontier 缺失 可变 不穷尽或冻结后分叉 前驱关联未解析 独立性依据过晚 或反馈 尝试 累计 holdout 前沿不完整时，在评估前生成 `NOT_ADMITTED` 且不消耗 holdout。保护决策政策身份 版本或 Protected Robustness Plan 缺失或不匹配时同样为 `NOT_ADMITTED`。Qualification 只有在关联请求且只写一次的 `ADMITTED` 回执和 holdout 预留后才创建冻结 Protected Replay Request，并重复 Candidate Intake 的准确政策 pair 与 plan identity。请求不允许原地拒绝，创建后任何 Backtest 接入拒绝都必须提交绑定同一请求的 `RUN_REJECTED` Protected Run Result。Qualification 逐项校验请求与结果的 Artifact PIT 范围 PIT Market Snapshot 身份 快照规则 重放配置 Runtime 内核 模拟器 成本 滑点 容量模型 Protected Robustness Plan 与 plan-cell 身份；任何缺失 替换或不匹配都成为 `INVALID_REPLAY_EVIDENCE`，按预注册 holdout 处理闭合且不生成 Eligibility Fact。

holdout 预留前，Candidate Intake 先用准确且由 Qualification 拥有的版本化 robustness-adequacy policy
校验计划：时间覆盖至少两个不重叠预注册窗口；市场状态至少两个实质不同状态且含一个不利状态；只有
冻结单标的 scope 才能让 instrument 不适用；perturbation 覆盖每个重要输入类；每个可调参数都有有界
邻域或被接受的无可调参数依据。计划不足或政策不匹配时为 `NOT_ADMITTED`，绝不预留 holdout。

对请求相等的 `TERMINAL_RESULT`，Qualification 先消费 Backtest 完整 有限 非空的保护
`diagnosticCategorySet`、内容摘要和逐类别决定性证据，并保留全部独立支持成员。随后先校验它是
canonical 类别集合的无重复子集，再应用逐类别 disposition。空集合 重复 未知类别
`NO_EXECUTION_DEFECT` 混合集合或 `UNRESOLVED_FAILURE` 混合集合都闭合为
`DIAGNOSTIC_UNRESOLVED`。只有结构合法且包含 `MARKET_DATA` `ARTIFACT` `RUNTIME_KERNEL`
`BACKTEST_OPERATIONAL` `SIMULATOR`
或 `REPLAY_CONFIGURATION` 的集合闭合为 `DIAGNOSTIC_INVALID`，单元素 `UNRESOLVED_FAILURE` 闭合为
`DIAGNOSTIC_UNRESOLVED`；二者都不生成 assessment 或 Eligibility Fact。`BACKTEST_OPERATIONAL` 保持
密封 Backtest runner/service 类别：Qualification 闭合 holdout custody，但不向 R&D Product Edge 或
Governance 返回 operational evidence 或保护细节。不含缺陷但含 `VALID_ECONOMIC_FAILURE` 的集合必须进入失败 assessment 和
`INELIGIBLE`；`UNRESOLVED_FAILURE` 与 `NO_EXECUTION_DEFECT` 各自只能作为单元素集合，且只有单元素
`NO_EXECUTION_DEFECT` 才可能进入通过 assessment。随后完整 assessment 在冻结 adjudication 与保护决策政策版本下重复准确
plan-cell-set digest，并对每个计划必需单元准确交代一次；同一轴可以包含多个单元。只有政策接受
结果前已冻结的不适用依据时，该 cell 才是 `NOT_APPLICABLE_ACCEPTED`；依据缺失 过期 被拒或政策
不匹配时为 `NOT_APPLICABLE_REJECTED`。任一 cell 缺失 重复 未知 请求结果不匹配 政策不匹配，或
全部 cell 均不适用，都成为 `INCOMPLETE_INVALID`，提交 `ASSESSMENT_INVALID`，按预注册规则闭合 holdout
且不生成 Eligibility Fact。只有计划已被接纳为 `PLAN_ADEQUATE`、诊断集合为单元素 `NO_EXECUTION_DEFECT`、至少一个 cell 适用、
全部适用 cell 为 PASS、全部不适用 cell 获接受时才是 `COMPLETE_PASS`；任一适用 cell 失败或不适用
依据被拒时为 `COMPLETE_FAIL`。`COMPLETE_PASS` 按冻结政策生成 `QUALIFIED`，`COMPLETE_FAIL` 生成
`INELIGIBLE`，并重复准确 intake 政策 pair plan request result cell census 与判定字段。

终态 `RUN_REJECTED` 或 `INVALID_REPLAY_EVIDENCE` 生成 `REPLAY_REJECTED` 或 `REPLAY_INVALID`：
Qualification 绑定 intake 请求 结果和预注册 holdout 闭合，不生成 Eligibility Fact，也不称为
`INELIGIBLE`。只有 `IN_PROGRESS_OR_UNKNOWN` 从未改变的 `ADMITTED` 回执和保护请求派生
`EVALUATING`，同时保留并计入累计前沿中的 holdout 托管。`REVOKED` 只用于曾生效后失效的资格。
Eligibility State 模块拥有 `INELIGIBLE` `QUALIFIED` `EXPIRED` 和 `REVOKED`；仅属于 attempt 的
`ASSESSMENT_INVALID` 不是 Eligibility 状态。revocation transition 通知 Governance，但不自行撤单。

Eligibility replay 必须绑定 frontier。同一 Fact 身份与内容摘要只加入原事实，不能延长 effective interval
或 `valid-through`；同一身份下状态 区间 前驱 政策 证据或 frontier 改变都是冲突重放。续期创建绑定前驱
和新区间的新不可变 Fact；一旦后继 过期或撤销成为 Qualification head，前驱永远不能重新成为 current。
Governance 可在每个不同的已授权 lifecycle request evaluation 与 decision frontier 中消费一次仍 current
的 Fact，而同一 frontier 内重复只加入，绝不恢复资金。

## 决策契约

- **输入** - 带准确 `READY_FOR_SELECTION` 血缘的唯一 selected Candidate、穷尽 TrialFamily Census、
  预注册保护政策 holdout ancestry 冻结 Replay Request 和密封 Run Result。
- **诊断与决定** - 接纳或拒绝 intake，隔离保护评估，校验请求结果完全相等，应用冻结政策并提交
  attempt disposition 或 Eligibility State 转换。
- **冲突解析** - 保护政策和累计 holdout frontier 不可变；重复 request 只加入一次，含义变化时拒绝，
  后续政策不能重新解释早期结果。
- **输出与终态负例** - Intake Receipt Protected Attempt Disposition 或 Eligibility State；
  `NOT_ADMITTED` replay rejected/invalid `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED`
  `ASSESSMENT_INVALID` `IN_PROGRESS_OR_UNKNOWN` `INELIGIBLE` 互相独立。
- **反馈与经济意义** - 独立拒绝过拟合或无经济价值候选，只暴露公共终态、不可解引用 reference 与
  source-frontier freshness，保存稀缺保护证据价值。
- **禁止** - 不向 R&D 反馈调参细节 不改写 artifact，不拥有 lifecycle 扩大资金 Runtime
  activation 订单 账户效果或保护细节 Product view。

## 后续实现验收

- 候选和评估规则在保护证据揭示前不可变。
- 事故 recovery binary 必须 feature-gated，并封闭到准确事故和四个资源定位符；它不能从调用方接收重建
  fact 或 freshness 断言。
- 每次 recovery 写入后的 fault 必须把 projection、head、outbox、receipt 和事务 DDL 一并回滚；隔离
  PostgreSQL 验证必须使用与任何默认 Owner 数据库不同、显式 disposable 的 database 与 role。
- 成功重建后的全局计数必须准确为 `1/1/1` 加一个 recovery receipt，复现冻结规范 verifier 的
  identity/digest/time，不增加 domain outbox event，并且对普通 current-cut resolver 仍保持 stale。
- Candidate Intake Protected Replay Request Protected Run Result Protected Robustness Assessment 和每个
  Eligibility Fact 重复同一 Protected Robustness Plan 身份与版本。
- 每个 `ADMITTED` Intake Receipt 都交叉绑定准确 `SELECTED_FOR_QUALIFICATION` disposition 与其冻结
  Intent 证伪条件。其他任何 disposition 只生成 `NOT_ADMITTED` 且不消耗 holdout。
- holdout 消耗和试验族预算可计量，不能通过候选改名重置。
- 每个稳定评估请求只解析到一个 Intake Receipt；含义改变或裸用新身份重试不能创建第二个 intake 或 holdout 尝试。
- 累计 holdout 处理包含相关 TrialFamily 中被拒 无效 未知和终态保护尝试，改名不能重置。
- 遗漏失败同族试验 试验改名 预算不一致或冻结截面后出现新族成员时必须拒绝；新成员需要后继 Candidate。
- 保护请求要么因 intake 在预留前失败而不存在，要么通过绑定同一请求的 Protected Run Result 闭合；不存在会搁置 holdout 托管的请求级拒绝。
- 保护请求与结果必须在规范 `crossBindEquality` 派生的全部 16 组执行身份上逐项完全相等；缺失或替换会确定性闭合为 `REPLAY_INVALID` 且不生成 Eligibility Fact，文档不另行维护第二份清单。
- 每个初始或续期 Eligibility Fact 都绑定准确 Candidate/Intake 政策身份与版本 request 准确 `TERMINAL_RESULT` 和已验证
  相等关系；被拒绝 无效 非终态或不匹配证据不能创建该事实。
- 同身份重放绝不延长 Eligibility 区间；续期是绑定前驱的新事实，后继 过期或撤销 head 永久阻止前驱
  复活，同一 Governance lifecycle frontier 内重复消费不能创建第二个决定。
- `QUALIFIED` 要求全部计划必需时间 市场状态 标的 扰动和参数邻域单元满足冻结覆盖 容差 阈值 聚合
  与缺失单元规则。单个漂亮 aggregate 或一个终态结果不能替代该计划。
- 每个冻结计划必需单元必须准确解析一次，同一轴可以包含多个单元。缺失 重复 未知 不匹配或全不适用
  的 assessment 都是 `INCOMPLETE_INVALID`，提交 `ASSESSMENT_INVALID`，闭合 holdout 托管且不生成
  Eligibility Fact；接受不适用必须绑定准确冻结依据与政策。
- 保护结果不存在进入同一候选构建的依赖路径。
- Governance 可读取唯一当前资格事实及完整撤销历史。
- Eligibility 过期或撤销足以终止新增风险保留；Governance 必须进入 `DE_RISK_PENDING`，不能等待只在
  增加风险时才需要的容量或表现证据。
- Governance 或 Risk 的资金包络若宽于准确当前资格容量上限，或绑定其他 Candidate 条件 模型或事实版本，必须失败关闭。

## 可观测性与持久化

Qualification 把 intake、holdout reservation/consumption、保护 request/result 关联、robustness assessment、attempt disposition、Eligibility、expiry 与 revocation 持久化为原生审计链。共享 telemetry 只能含公共终态、类型不透明且不可解引用的事实引用和 source-frontier freshness；保护 phase、latency、terminal timing 与 timing-derived field 明确禁止公开。`REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与 `INELIGIBLE` 都以字节等价方式投影为 `CLOSED_NOT_QUALIFIED`，`QUALIFIED` 保持准确。保护测量、参数、cell outcome、holdout 内容、内部终态 disposition、负面原因与 evaluator 细节绝不能进入 Event Rail、trace、log、metric、alert 或 Dashboard；Qualification 外尤其不存在内部 `INELIGIBLE` event。Dashboard 统计只区分 `QUALIFIED`、`CLOSED_NOT_QUALIFIED`、expired 与 revoked；全部负面保护终态共享字节等价的 label 和 aggregate。
