# Risk

## 职责

根据当前政策 账户暴露和聚合承诺独立检查每个正常 Trade Intent。Risk 拥有明确终态决定 一次性预留 同 scope 承诺前沿和紧急围栏，永不拥有订单命令 Portfolio 投影或外部效果。

## 拥有的权威事实

- 绑定单个意图及摘要 Execution Scope 政策版本与截面 Portfolio 账户与暴露截面 决定时间 authorization
  mode 和完整请求 Authorization Lineage 的 Risk Decision。`UNATTENDED_REQUEST_WITH_POLICY` 还必须
  绑定当前 Autonomous Policy Authorization。
- 每个终态 `REJECT` 保留完整且唯一的非空 supported rejection-category set、各 category 的决定性事实
  身份与截面、已评估 policy head 与 limit、新鲜 Time Evidence，以及由绑定版本化 total precedence
  确定选择的唯一 primary category。primary 只排序解释；每个有效集合都产生同一个不带 Reservation 的
  `REJECT` 动作。
- 准确 `PERMIT_DECREASE_ONLY` 只授权一次撤单 减仓 清仓或回读，并绑定当前暴露截面 生命周期或
  Governance 正常生命周期权威 scope 和有效期；它不创建 add-risk Reservation，也不是 Recovery 权威。
- 具有 `AVAILABLE` `WITHDRAWN` `CONSUMED` `UNKNOWN_EFFECT` `NO_EFFECT` 和 `SETTLED` 生命周期状态的一次性 Risk Reservation，并单独明确 commitment liability 是 held 还是 released。
- 仅新增风险使用的不可变 Reservation Claim Result 只能是 `CONSUMED` `WITHDRAWN` 或 `REJECTED`；claim
  被消费后才有不可变 Adapter Admission Result，只能是 `ADMITTED_ONCE` `SUPPRESSED_BY_FENCE` 或
  `REJECTED`。decrease-only 不创建 claim，但其 `PREPARED` attempt 取得同样三态 Adapter Admission
  Result。adapter admission 与 recovery fence activation 在同一前沿提交，是正常适配器调用的唯一权威。
- 每个 Portfolio-owned 不可变 Capacity Scope 唯一持久原子序列化 Aggregate Commitment Frontier。它把
  一个一致 Portfolio Risk Evidence Bundle 与所有 held Reservation liability 合并，每条稳定经济
  lineage 只计一次。只有 Risk 计算 usage 与剩余 headroom。
- 生效 Recovery Fence 的 fence epoch 影响 generation 范围和允许恢复动作边界，Risk 是唯一 writer。
  每个 fence 准确绑定一个来源分支：`RUNTIME_NOT_READY` 绑定准确不可变 `NOT_READY` Readiness Fact；
  `RUNTIME_INCIDENT` 绑定经 `runtime-risk-incident-fence` 收到的已提交 `runtime-incident-fact`；
  `RECONCILIATION_DRIFT` 绑定经 `execution-risk-drift-fence` 收到的已提交 `reconciliation-drift-fact`；
  或 `RISK_HARD_STOP` 绑定准确原因证据 政策和 Aggregate Commitment Frontier 截面。Risk hard stop 可在
  Runtime 仍为 `READY` 时设 fence。
- Risk 还在每个 Aggregate Commitment Frontier 独占完整活动 fence-set identity 与 content digest。集合
  保留每个来源独立 fence lineage；有效 Recovery action set 是全部 member action set 的确定性交集，
  绝不是并集，交集为空时不授权任何命令。
- 稳定同 scope 执行仲裁：并发正常 intent 根据已声明政策顺序在唯一序列化 commitment frontier 上
  接纳。Risk 不发明 contender 优先级，也不重新分配 Governance 比例；业务优先级缺失或 tie 时失败
  关闭，不能让到达顺序成为分配规则。

## 模块

- **Risk Reservation** - 在同 scope frontier 上持久序列化一个 Execution claim 或撤回未消费额度，再
  保持 替换或释放 liability。已消费 liability 只根据 Execution settlement 事实和匹配 Portfolio Risk
  Evidence Bundle 闭合；仅有 `SETTLED` 不能释放。
- **Risk Engine** - 对每个正常意图返回决定与预留，或明确终态拒绝。
- **Kill Switch** - 阻止新增风险并围栏受影响 generation，定义有界撤销 减仓 清仓恢复范围。

## 输入交接

- [Runtime](./runtime/) 提交 Trade Intent、不可变 Readiness Fact，并为 `RUNTIME_INCIDENT` 通过
  `runtime-risk-incident-fence` 提交已提交 `runtime-incident-fact`。Risk 把来源事实当作自己独立提交
  fence 的证据，不把它们当成请求或确认。
- [Strategy Governance](./strategy-governance/) 提供适用 `POOL_ROOT` 与准确 `STRATEGY_GENERATION`
  Capital Envelope 链，以及当前 Eligibility 每个 envelope 的生效区间和完整共享 Time Evidence、
  authorization mode 和完整请求 Authorization Lineage。`UNATTENDED_REQUEST_WITH_POLICY` 还携带当前
  Autonomous Policy Authorization。一个 intent 只使用自身链，兄弟 envelope 不参与 global minimum。
- [Portfolio](./portfolio/) 提供不可变 Capacity Scope、候选无关 gross Capacity View，以及包含 exposure
  open order 账户估值截面和已纳入 Execution lineage 的一致 Portfolio Risk Evidence Bundle。它不提供
  Risk commitment state 或 net headroom。
- [Execution](./execution/) 对新增风险先提交稳定 Reservation Claim Request。匹配 `CONSUMED` 后持久化
  `PREPARED` attempt，再提交稳定 `ADAPTER_ADMISSION_REQUEST`。准确 decrease-only 不提交 claim，
  持久化带明确空 Reservation/claim lineage 的 `PREPARED` 后直接提交 admission request。之后回报未知
  效果 结算或唯一无效果证明：不含调用与回读身份的持久预调用抑制，或绑定一个已准入 attempt 的权威适配器回读。
- 对 `RECONCILIATION_DRIFT`，Execution 通过 `execution-risk-drift-fence` 提交已提交的准确
  `reconciliation-drift-fact`；该关系只携带来源证据，不授予 Execution fence 写权威。
- Recovery 期间 Execution 回报共同 case、完整 fence-set identity/digest、command、effect 身份与按状态
  区分的证据。已提交 drift `UNKNOWN_EFFECT` 提供 effect-journal 与 uncertainty lineage、最后回读尝试或
  已证明缺失，以及完整 source/time evidence；它可激活围栏但不宣称结果。`NO_EFFECT` 与 `SETTLED`
  要求权威终态回读和对账截面。Risk 把它们与自己的成员前沿联结，并独占非空 明确空或未解析判定。

## 输出交接

- 向 [Runtime](./runtime/) 返回明确终态拒绝，或批准的 Risk Decision 与一次性 Reservation，以及任何消费前终态 `WITHDRAWN` 结果。
- 向 [Execution](./execution/) 为每个稳定新增风险 claim 返回唯一 Reservation Claim Result，再为每个
  prepared 新增风险或 decrease-only attempt 返回唯一 Adapter Admission Result。Risk 在同一次 Aggregate Commitment Frontier mutation
  中把 admission 与 fence activation 排序并提交 `ADMITTED_ONCE` `SUPPRESSED_BY_FENCE` 或 `REJECTED`，
  同时向 Reconciler 提供完整活动 fence set 终态 Reservation 成员和剩余暴露闭合事实。
- 完整集合向 Reconciler 明确每个独立活动的 `RUNTIME_NOT_READY`、`RUNTIME_INCIDENT`、
  `RECONCILIATION_DRIFT` 或 `RISK_HARD_STOP` member，且分别携带各分支必需
  证据。Execution 可直接根据 hard-stop fence 创建或加入 Recovery；Runtime 无需先改变 readiness。
- 每个终态拒绝都绑定完整 supported category set、一个确定 primary、决定性政策与证据身份、准确事实
  截面和 no-Reservation 证明，让 Runtime 无需解释文字即可停止或路由后继。
  类别为 `STALE_OR_MISSING_AUTHORIZATION` `SCOPE_OR_GENERATION_MISMATCH`
  `EVIDENCE_UNAVAILABLE_OR_MIXED_CUT` `GOVERNANCE_POLICY_EXCEEDED`
  `QUALIFIED_ECONOMIC_BOUND_EXCEEDED` `AGGREGATE_CAPACITY_EXHAUSTED`
  `FENCE_OR_READINESS_BLOCKED` `DUPLICATE_OR_CONFLICTING_INTENT`。primary precedence 为
  `STALE_OR_MISSING_AUTHORIZATION > SCOPE_OR_GENERATION_MISMATCH > DUPLICATE_OR_CONFLICTING_INTENT >
  FENCE_OR_READINESS_BLOCKED > EVIDENCE_UNAVAILABLE_OR_MIXED_CUT > GOVERNANCE_POLICY_EXCEEDED >
  QUALIFIED_ECONOMIC_BOUND_EXCEEDED > AGGREGATE_CAPACITY_EXHAUSTED`，与证据或请求到达顺序无关。
  Governance policy 违反 Qualification 经济边界违反与聚合资金池耗尽保持可同时存在的不同原因，
  不能共用一个不透明 limit 类别。

## 拒绝和禁止事项

- 当前 Eligibility 经济容量 生命周期政策或 Capacity View 事实不完整时不得允许新增风险。证据缺失 过期 跨 scope，或经济条件 方法 假设 流动性 版本不匹配时返回终态 `REJECT` 且不创建 Reservation。
- 裸 Governance 决定或 `ATTENDED_REQUEST` 都不能允许新增风险。只有
  `UNATTENDED_REQUEST_WITH_POLICY` 可以取得新增风险决定或 Reservation，其 Trade Intent 生命周期决定
  当前保留续期和 Autonomous Policy Authorization 必须保留同一完整请求 Authorization Lineage。
  `ATTENDED_REQUEST` 只允许准确 decrease-only 动作。
- 活动 generation 保留缺失 过期 撤销 未知或为 `DE_RISK_PENDING`，或必需 Eligibility Performance
  Exposure degradation 证据过期时不得新增风险。decrease-only 暂停 降权和退役不要求新鲜容量或表现证据。
- 不创建或转发订单命令 不重试外部效果 不宣称场所已结算。
- 不依据 Runtime 确认 Execution `SETTLED` 或适配器回执单独释放 Reservation。
- 不重复计算同一经济成员，也不把 `UNKNOWN_EFFECT` 当作空闲容量。`WITHDRAWN` 与消费后权威
  `NO_EFFECT` 可以释放 liability；`SETTLED` 必须保持到一次序列化 frontier 转换用覆盖同 lineage 的
  Portfolio bundle 替换它。
- 不为 Governance 降权 暂停或退役转换签发 add-risk Reservation。decrease-only 决定只允许撤单
  减仓 清仓或回读，未知效果必须升级到 Recovery。
- 不把 decrease-only 权威编码成普通 `ALLOW` 或可重用政策。只有准确 `PERMIT_DECREASE_ONLY` 可以
  穿过 adapter gate，任何新增风险形状都必须终态拒绝。
- 不要求也不接受 `PERMIT_DECREASE_ONLY` 作为 Recovery 权威。Recovery 只受 Risk-authoritative 完整
  `ACTIVE` fence set 及其 member action set 交集约束；集合过期 遗漏 未激活 扩大 不匹配 无法证明
  完整或交集为空时，不能接纳任何 Recovery 动作。
- 匹配 `NOT_READY` 就绪过期或 `ACTIVE` fence 时不允许新增风险。Fence activation 不依赖 Recovery Case 状态或确认。

## 失败与恢复

正常意图被拒后得到明确终态且不创建外部 attempt。每次新增风险决定都在准确 Capacity Scope
Aggregate Commitment Frontier 上持久原子序列化。Capacity View 提供候选无关 gross pool ceiling；
Portfolio Risk Evidence Bundle 提供一致 exposure open order 与已纳入 settlement lineage；held Reservation
liability 补足 usage。序列化过期、scope 重叠未知或成员缺失 过期 不匹配时拒绝且不创建 Reservation。
每个 intent 只检查自身 `POOL_ROOT` → `STRATEGY_GENERATION` applicability chain，但全部兄弟 usage 共享
root pool ceiling。政策收窄到小于 usage 时提交 `OVERCOMMITTED_NO_NEW_RISK`，不保留新增风险权限。

Execution 先提交一个稳定 Reservation Claim Request。Risk 持久序列化 `CONSUMED` `WITHDRAWN` 或
`REJECTED`。只有匹配 `CONSUMED` 才允许一个 `PREPARED` attempt 与 `ADAPTER_ADMISSION_REQUEST`，仍不能
外部调用。Risk 把 admission 与 recovery fence activation 序列化后返回唯一不可变结果。只有 `ADMITTED_ONCE`
允许 `INVOCATION_STARTED`；响应丢失或重启只能加入同一结果和 attempt。`SUPPRESSED_BY_FENCE` 或
`REJECTED` 证明没有调用。Reservation 图严格固定：
claim 前过期 撤回或证明未调用都以 `WITHDRAWN` 结束；只有 `CONSUMED` 能进入 `UNKNOWN_EFFECT`
权威 `NO_EFFECT` 或 `SETTLED`；`UNKNOWN_EFFECT` 之后只能进入权威 `NO_EFFECT` 或 `SETTLED`。
`SETTLED` 保持 held，直到一致 Portfolio Risk Evidence Bundle 含准确 settlement lineage，并由一次
序列化转换以该投影替换而非叠加 liability。

准确 decrease-only 可以来自 Governance 授权的生命周期减仓，也可以来自无人值守
`DECREASE_ONLY_STRATEGY_PROTECTIVE` intent；后者必须绑定已应用 Artifact 的保护退出规则 触发证据和
当前暴露 open-order 截面。两者都要求 `PERMIT_DECREASE_ONLY`、明确空 Reservation 与 claim lineage，以及持久
`PREPARED` attempt。Risk 不创建 claim result，但把 `ADAPTER_ADMISSION_REQUEST` 与同 scope fence
按新增风险相同方式序列化。只有 `ADMITTED_ONCE` 允许调用；抑制 拒绝 重启与重放都保留同一 attempt
和 admission identity。

Risk 在同 scope frontier 从准确一个来源分支独立原子激活 fence，不等待 Recovery Case 确认。
`RUNTIME_NOT_READY` 要求 Runtime 本地停止和不可变 `NOT_READY` Readiness Fact；`RUNTIME_INCIDENT`
要求来自 `runtime-risk-incident-fence` 的准确已提交 `runtime-incident-fact`；`RECONCILIATION_DRIFT`
要求来自 `execution-risk-drift-fence` 的准确已提交 `reconciliation-drift-fact`。这两条关系只提供来源
证据。`RISK_HARD_STOP` 改为绑定 Risk 原因 决定性证据 政策和 frontier cut，并可在 Runtime 仍为 `READY` 时激活。Fence
activation 与每个在途正常 adapter admission 只有一个顺序。
fence 先发生时返回 `SUPPRESSED_BY_FENCE`；正常 admission 先发生时返回一个 `ADMITTED_ONCE` attempt
并纳入 Recovery effect frontier。Artifact 保护止损与 `RISK_HARD_STOP` 同时成立时，fence 压过所有尚未
准入的正常 permit 或 command，同时保留保护 intent 触发与终态抑制作为原因证据。已经先获准入的路径
保持准确一个 attempt 等待权威回读，但不产生 Recovery 权威。Risk 向 Execution Reconciler 提供活动 fence，只有 Reconciler 拥有
case 和有界 Recovery Command。Risk 独占 Reservation 成员的非空 显式空 未解析结果；Execution 在
匹配 Risk 与 Portfolio 闭合事实后独占写 `KNOWN_CLOSED`。

## 决策契约

- **输入** - 一个 Runtime intent 与 readiness 截面、Governance envelope 和授权 lineage、一致 Portfolio
  risk bundle，以及后续 Execution claim admission settlement 事实。
- **诊断与决定** - 检查授权 身份 证据 limit commitment frontier 与 fence，提交唯一终态拒绝或一次性
  decision 和 Reservation。
- **冲突解析** - 同 scope mutation 按已声明执行顺序序列化；Governance 分配保持不变，重复身份只加入
  一次，业务优先级未解析时拒绝。
- **输出与终态负例** - decision Reservation claim/admission result fence，或带完整 supported set、确定
  primary、决定性事实与未创建 Reservation 证明的类型化 `REJECT`；证据缺失或 mixed-cut 支持
  `EVIDENCE_UNAVAILABLE_OR_MIXED_CUT`，不能成为隐式允许。
- **反馈与经济意义** - 约束未闭合 liability 的最坏占用，阻止过期 重复或超限暴露，但不决定哪个
  策略应获得资金。
- **禁止** - 不拥有 contender 分配 订单命令 adapter 调用 场所事实 Portfolio 投影 生命周期决定
  Recovery Case 或闭合。

## 后续实现验收

- 每个正常 Trade Intent 都产生唯一当前终态决定。
- 终态 decision 是可区分形状：新增风险 `ALLOW` 必须携带一个 Reservation；准确
  `PERMIT_DECREASE_ONLY` 必须携带当前 Governance de-risk 权威或已应用 Artifact 保护止损权威，以及暴露 open-order 截面且禁止
  Reservation；`REJECT` 必须携带唯一非空 supported rejection-category set、一个确定 primary 与未创建
  Reservation 的证明。
- 每个分别受支持的拒绝原因及其证据都保留在终态记录中。primary 是冻结 total precedence 中第一个
  受支持成员，绝不是第一个到达的证据或请求；所有 supported-set 变体都保持同一 `REJECT` 动作且不
  创建 Reservation。
- 每个允许决定与 Reservation 都保留 Governance authorization mode 和完整请求 Authorization Lineage。
  `UNATTENDED_REQUEST_WITH_POLICY` 还必须保留并重验 Autonomous Policy Authorization；任一必需
  lineage 断裂都必须终态 `REJECT` 且不创建 Reservation。
- 每个新增风险决定绑定准确有效的 gross-ceiling Capacity View 和不可变账户加模式经济池 Capacity Scope。scope 不得含策略或 generation；Paper 与 Live 必须不同，重叠未知时失败关闭。
- 每个 intent 受自身 `POOL_ROOT` 和 `STRATEGY_GENERATION` envelope 链、Qualification 与 lifecycle ceiling、Risk limit 限制；兄弟 generation envelope 不能折叠进它的 minimum。
- Risk 必须用同一 decision time 与共享 Time Evidence 截面检查两个 envelope 的状态和重叠生效区间。
  任一成员缺失 过期 已取代 跨 epoch 区间不重叠 parent 错误 跨账户 跨 mode 或跨 scope 时，都必须终态
  `REJECT` 且不创建 Reservation。
- 每个同 scope 新增风险决定必须赢得一次持久原子序列化。usage 按经济 lineage 计算一个一致 Portfolio
  projection bundle 和 held Reservation liability，未知 liability 按最坏情况占用，证据不完整或过期时拒绝。
- 每个允许决定创建不可重放 不可重复消费的一次性 Reservation。
- 即使请求并发，第二个命令也不能占用同一 Reservation；准确重放只加入首次占用。
- 每个稳定 claim 只有一个 Reservation Claim Result。只有 `CONSUMED` 才允许一个 prepared attempt，
  该 attempt 获得与 fence activation 串行化的不可变 Adapter Admission Result；只有 `ADMITTED_ONCE`
  能进入 `INVOCATION_STARTED`。
- 响应丢失 重启或重放只能加入同一 prepared attempt 与 admission result，不能重复调用适配器。
- Execution 不能接收许可绑定缺失 过期或不匹配的正常命令。
- 外部效果未知时始终保留预留和恢复围栏直到终态事实到达。
- `RecoveryCase.KNOWN_CLOSED` 不取代 不停用 不解除也不复用前驱 `ACTIVE` Risk Fence。旧 generation
  永久保持围栏；新 generation 必须有不同 Governance 决定和普通新增风险门禁，但在自身四种准确
  Recovery 来源分支之一独立激活前没有 Recovery Fence。
- 每个活动 fence 都证明准确一个 `RUNTIME_NOT_READY`、`RUNTIME_INCIDENT`、`RECONCILIATION_DRIFT` 或
  `RISK_HARD_STOP` 来源分支。hard-stop fence
  不要求也不编造 Runtime `NOT_READY`，但会进入同一 Execution-owned Recovery 路径。
- `SETTLED` 仍保留 commitment liability，直到 Portfolio bundle 覆盖同一 Execution settlement lineage，
  并由一次序列化转换以投影成员替换而非叠加。`WITHDRAWN` 与消费后权威 `NO_EFFECT` 可直接释放；
  `AVAILABLE` 永不直接转换成 `NO_EFFECT`。
- Recovery 事实请求普通适配器准入 包含新增风险动作或 case fence 不匹配时不能改变 Reservation 状态。
- Fence activation 与任何在途 `ADAPTER_ADMISSION_REQUEST` 只有一个同 scope 原子顺序；fence 获胜时
  提交 `SUPPRESSED_BY_FENCE`，正常 admission 获胜时提交唯一 `ADMITTED_ONCE` attempt 并纳入 Recovery effect frontier。
- 只有 Risk 拥有 Reservation 成员前沿及其 `RESOLVED_NONEMPTY`、`RESOLVED_EMPTY` 或 `UNRESOLVED` 状态。隐式空集合或 `UNRESOLVED` 不能支持闭合；`RESOLVED_EMPTY` 必须把完整 Risk 前沿与 Execution 外部回读截面联结起来。
- Paper 与 Live 风险决定绑定隔离的账户和效果命名空间，并拒绝跨模式 Portfolio 或 Execution 事实。

## 可观测性与持久化

Risk 持久化 policy、decision、Reservation、claim membership、aggregate commitment frontier、Kill Switch/Fence、liability 与 closure fact。Telemetry 覆盖决策与序列化时延、有界 supported rejection set 与确定 primary category、reservation age、frontier contention、fence 状态和 policy/readiness failure。Dashboard 的 allow/reject/decrease-only 次数、rejection-set/primary 分布、未清 liability、aggregate commitment、fence 次数与持续时间必须从准确事实推导；metric 或 alert delivery 不能释放 Reservation、解除 fence、授权 Execution 或证明 closure。
