# Execution

## 职责

独占订单生命周期 外部场所效果 权威回读 对账和 Recovery Case 闭合。Execution 在效果发生前验证
正常许可或活动 Risk fence，并向 Runtime Risk Portfolio 和 Governance 返回事实。

## 拥有的权威事实

- 订单身份 状态转换 接受或拒绝的命令和撤销历史。
- 把 Execution Scope、持久 `PREPARED` attempt record、Adapter Admission Result、`INVOCATION_STARTED`
  record、许可或围栏、订单 场所回执 成交和回读绑定起来的 Effect Journal。正常效果还必须保留命令
  携带的 authorization mode 与完整请求 Authorization Lineage。`UNATTENDED_REQUEST_WITH_POLICY`
  还必须保留其 Autonomous Policy Authorization。
- Execution Scope 与每个 attempt 重复的不可变 Execution Adapter Binding，包含实现与配置摘要、已认证
  场所或 simulator endpoint、账户 mapping、包括 reduce-only 语义的 capability、trust-policy 版本和
  不透明最小权限 credential handle。
- 保留来源身份和不确定性的适配器规范场所事实。
- 每个完整账户事实截面按唯一 observation-policy 版本提交有限 Execution Quality Observation，其完整
  `observationCategorySet` 取自 `SLIPPAGE` `LATENCY` `VENUE_REJECTION` `PARTIAL_FILL`
  `VENUE_ANOMALY` `READBACK_FAILURE` `RECONCILIATION_DRIFT` 和 `NONE_OBSERVED`。所有分别有证据支持且
  同时出现的类别都必须保留，并分别绑定决定性订单 成交 时间 回读 对账与场所证据；
  `NONE_OBSERVED` 只有在完整 census 后作为单元素集合才有效。
- 对账结果以及识别出的缺失 重复或未知外部效果。
- 已提交 Reconciliation Drift Fact，绑定差异身份 受影响 generation 和范围 权威回读切面 观察时间 类别
  和状态。不可变 drift 不增加 Recovery Case 反向引用，由 case 在原因集合保存 drift 身份。
- Reconciliation Drift 类别只能是 `ORDER_STATE_DIVERGENCE` `FILL_STATE_DIVERGENCE`
  `POSITION_DIVERGENCE` `BALANCE_DIVERGENCE` `ADAPTER_READBACK_UNAVAILABLE`
  `UNKNOWN_EXTERNAL_EFFECT`；原因未知时保持显式未知，不能猜成其他类别。
- 每个独立 `RUNTIME_INCIDENT` 或 `RECONCILIATION_DRIFT` 来源的 Recovery Admission Disposition，在任何
  case 前提交为 `RECOVERY_ADMITTED` `NO_RECOVERY_REQUIRED` 或 `UNRESOLVED_NO_CASE`。前者只绑定准确
  `runtime-incident-fact`，后者只绑定准确 `reconciliation-drift-fact`；两者分别绑定 generation scope
  Runtime readiness、适用 Risk fence、权威 Execution/Portfolio cut、policy 和新鲜 Time Evidence；含义
  相同的 replay 加入同一只写一次 disposition。任一单独已准入分支都不要求另一来源，两者同时准入
  时保留各自 disposition 后加入同一 case。
- Recovery Case Recovery Command 和不可变 `RecoveryCase.KNOWN_CLOSED`，把完整原因与受影响效果集合
  绑定到一个 Risk-authoritative 完整活动 fence-set identity/content digest 和共同 Runtime Execution
  Risk Portfolio 时间前沿。
- Recovery Effect Attempt 用持久 `PREPARED` 与 `INVOCATION_STARTED` 截面绑定 Recovery Case、准确当前
  `ACTIVE` Risk Fence、有界动作、动作前权威回读、adapter binding 和 attempt identity。崩溃或重放只
  加入同一 attempt，不能创建未记录或重复动作。

## 模块

- **Order Engine** — 验证许可或恢复围栏，并独占订单创建 修改 撤销和终态管理。
- **Execution Adapters** — 只准入 Execution Scope 固定的 adapter binding，再转换请求 回执 成交 错误和
  回读；重启时不能改变 endpoint 账户 capability 或 trust policy。
- **Effect Journal** — 请求准入前先持久化一个稳定 `PREPARED` attempt，只有匹配不可变 `ADMITTED_ONCE` 后才持久化 `INVOCATION_STARTED`，并把全部后续外部效果事实联结到该身份。
- **Reconciler** — 拥有 Recovery Case 状态与有界 Recovery Command，比较效果与权威回读，联结闭合
  证据，并独占不可变 `KNOWN_CLOSED` 且不恢复交易。

## 输入交接

- [Runtime](../runtime/) 发送 Authorized Order Command。新增风险命令绑定同一 Risk Decision 与
  Reservation；准确 decrease-only 命令改为绑定 `PERMIT_DECREASE_ONLY`，并明确不携带 Reservation
  或 claim。两者都绑定 authorization mode 与完整请求 Authorization Lineage。
  `UNATTENDED_REQUEST_WITH_POLICY` 还必须绑定当前 Autonomous Policy Authorization。
- [Risk](../risk/) 先返回唯一不可变 Reservation Claim Result。只有 `CONSUMED` 才允许 prepared attempt；随后 Risk 返回唯一不可变 Adapter Admission Result，且只有匹配 `ADMITTED_ONCE` 才允许写入 `INVOCATION_STARTED` 并调用正常适配器。
- Recovery 中 Runtime 只提供实例 checkpoint 就绪和事故事实。`NOT_READY` Readiness Fact 按相同
  generation scope cause 和 source frontier 直接创建或加入唯一 Execution-owned case。Incident Fact 或
  Execution Drift Fact 先取得一个 Execution-owned Recovery Admission Disposition；只有带匹配 `ACTIVE`
  fence 的 `RECOVERY_ADMITTED` 才允许 case。Reconciler 根据权威 Execution 暴露
  截面创建绑定 case 与 fence 的撤销 减仓 清仓或回读命令。
- [Risk](../risk/) 提供在唯一 Aggregate Commitment Frontier 证明的完整活动 fence set，包含全部来源
  独立 member identity epoch policy action set 与 cut，并提供终态 Reservation 成员和剩余暴露闭合事实。携带准确
  `RISK_HARD_STOP` 来源分支的 fence 也会在 Runtime 仍可为 `READY` 时直接创建或加入 case；Execution
  保留 hard-stop 原因与政策引用，但不拥有它们。
- [Portfolio](../portfolio/) 提供匹配账户闭合投影。
- 场所和模拟适配器提供权威回执 成交 账户回读和错误。

## 输出交接

- 在 Strategy Governance 建立 Paper 或 Live Execution Scope 前，向
  [Strategy Governance](../strategy-governance/) 提供唯一当前不可变 `ADMITTED` Execution Adapter
  Binding，绑定准确 mode 账户 效果命名空间 endpoint capability trust policy 与 valid-through。缺失
  撤销 跨 mode 命名空间别名或未知 binding 不产生 Execution Scope 或授权。
- Paper 或 Live 向 [Risk](../risk/) 先提交稳定 Reservation Claim Request；`CONSUMED` 后再提交绑定持久 `PREPARED` attempt 与命令的 `ADAPTER_ADMISSION_REQUEST`，之后才提供未知效果 结算或唯一无效果证明。`PRE_ADAPTER_SUPPRESSION` 绑定 `SUPPRESSED_BY_FENCE` 结果与持久未调用 record，`VENUE_READBACK` 绑定一次 `ADMITTED_ONCE` 与 `INVOCATION_STARTED` attempt 和权威回读，两种证明互斥。
- 准确 `PERMIT_DECREASE_ONLY` 命令绕过新增风险 Reservation 图：Execution 不创建 Reservation Claim
  Request 或 claim result，也不准入新增风险形状；但仍写入唯一稳定 `PREPARED` attempt，再发送
  `ADAPTER_ADMISSION_REQUEST`，由 Risk 把该请求与同 scope fence activation 排序。只有
  `ADMITTED_ONCE` 才允许 `INVOCATION_STARTED` 与有界 decrease 动作。Recovery 仍是独立活动 fence 路径。
- Recovery 准入前，`execution-risk-drift-fence` 向 [Risk](../risk/) 提交 `RECONCILIATION_DRIFT` 已提交的
  准确 `reconciliation-drift-fact`；Execution 永不写由此产生的 Recovery Fence。Recovery 中每个后续
  事实都绑定 case generation scope 完整活动 fence-set identity/digest Recovery Command 和 effect chain。
  已提交 drift `UNKNOWN_EFFECT` 绑定 effect journal、uncertain-effect lineage、不确定性观察、最后一次
  回读尝试或已证明缺失，以及完整 source/time frontier，不需要编造终态回读。只有 `NO_EFFECT` 与
  `SETTLED` 绑定权威终态回读和对账截面。恢复事实不属于
  `ADAPTER_ADMISSION_REQUEST`，Execution 既不读取也不断言 Risk 所有的 Reservation 成员关系。
- 向 [Runtime](../runtime/) 提供订单 成交 命令拒绝 终态场所回读和对账结果。
- 向 [R&D](../rd/) 提供已提交且按 generation 划分的账户 订单 成交 完整 Execution Quality
  Observation Effect Journal 权威回读和 Reconciliation Drift 事实，只能作为后继来源证据。Research
  provenance 绑定这些准确已提交事实身份与来源截面，永不绑定 Effect Closure View。该本地反馈不能
  改写运行中或已选择血缘，也不含保护 Qualification 细节。
- 向 [Portfolio](../portfolio/) 提供账户 订单 成交 费用 权威场所事实、稳定 settlement/readback lineage，
  以及 Portfolio 投影与归因使用的准确有限 Execution Quality Observation。
- 向 [Strategy Governance](../strategy-governance/) 提供可直接读取的已提交 Reconciliation Drift Fact；Event Rail 只负责唤醒。
- 向 [Strategy Governance](../strategy-governance/) 在任何新 generation 决定前提供不可变 `RecoveryCase.KNOWN_CLOSED`。
- 向 Event Rail 发布已提交订单 成交和对账事件作为唤醒提示。

## 拒绝和禁止事项

- 不接收缺少同一当前 Risk Decision 和 Reservation 绑定的 normal add-risk 命令。normal decrease-only
  命令改为要求准确 decrease-only permit 与显式 none Reservation/claim lineage。
- authorization mode request principal scope 已准入 Shell binding 或 history head Operator Authorization
  operation manifest Governance decision intent 或 Risk permit lineage 缺失 过期 撤销或不匹配时，不接收
  正常命令。`UNATTENDED_REQUEST_WITH_POLICY` 还要求当前且匹配的 Autonomous Policy Authorization，
  该政策授权永远不能替代任何请求 lineage 成员。
- 即使 principal 在场或请求已接受，也不准入携带 `ATTENDED_REQUEST` 的正常 Paper 或 Live 命令。正常
  新增风险和适配器效果要求 `UNATTENDED_REQUEST_WITH_POLICY`；在独立 attended-effect 契约出现前，
  attended 权威只允许 decrease-only 或恢复。
- adapter gate 只在 attended 生命周期绑定准确当前 Risk `PERMIT_DECREASE_ONLY` 时准入。Recovery 只接受
  准确 Risk-authoritative 完整 `ACTIVE` fence set。Execution 只取所有 member allowed-action set 的交集，
  绝不取并集；交集为空或完整性未证明时不接纳动作。两条路径都拒绝新增风险形状。
- 匹配 Runtime `NOT_READY` 或活动 Risk fence 后不接收正常或恢复新增风险命令，readiness 或 fence 前沿
  缺失 过期 不匹配时也必须拒绝。
- 不编造成交 不隐藏不确定性 不把未知场所状态标记为成功。
- 不把缺失 过期 mixed-scope mixed-effect 或政策不匹配的观察证据转换为 `NONE_OBSERVED`；该证据
  不能用于归因。
- 不接收不可用 不可信 已撤销 摘要不匹配 账户错误 模式错误或 capability 不足的 adapter binding，
  也不把 credential 内容写入 command 或 journal。
- 不拥有 Trade Intent 风险政策 账户投影 生命周期状态或 fence activation。

## 失败与恢复

正常调用前 Execution 先发送一个稳定 Reservation Claim Request。只有匹配不可变 `CONSUMED` 结果
才允许准备：Execution 可以持久记录一个 `PREPARED` attempt，再发送绑定该 attempt 命令 Risk Decision
Reservation 和不可变 adapter binding 的 `ADAPTER_ADMISSION_REQUEST`，但还不能外部调用。Risk 持久原子
序列化 admission 与同 scope recovery fence activation，再提交唯一不可变 `ADMITTED_ONCE`
`SUPPRESSED_BY_FENCE` 或 `REJECTED`。Execution 只有拿到匹配 `ADMITTED_ONCE` 才能在外部调用前
持久化 `INVOCATION_STARTED`。响应丢失 崩溃 重启或重放只能加入同一身份，不能改变 adapter binding
或调用第二个 attempt。`SUPPRESSED_BY_FENCE` 与 `REJECTED` 是持久未调用结果。调用开始后只有权威
回读能证明 `VENUE_READBACK` 无效果或结算。超时或含义不明响应保持 `UNKNOWN_EFFECT`，不能裸重试。

正常 decrease-only 命令携带 `PERMIT_DECREASE_ONLY`，Reservation 与 claim lineage 明确为空。Execution
保留相同稳定 `PREPARED` 边界，不创建 claim 而请求 adapter admission；Risk 仍把 admission 与 fence
activation 序列化。`SUPPRESSED_BY_FENCE` 和 `REJECTED` 证明没有调用，只有 `ADMITTED_ONCE` 可以进入
`INVOCATION_STARTED`。崩溃 重启和重放只能加入同一 attempt 与 result。

已应用 Artifact 的 `DECREASE_ONLY_STRATEGY_PROTECTIVE` 与 `RISK_HARD_STOP` 竞争时，Execution 保留
正常 intent 及其 Risk 抑制或已准入 attempt lineage，但只接受 Risk fence 作为 Recovery 权威。Recovery
plan 绑定一个准确 open-order 暴露 回读截面，以及同一稳定经济 lineage 中全部已准入或已开始的减仓
效果。fence 先发生不产生正常调用；admission 先发生则等待或消费该 attempt 的权威回读。任一顺序对
同一剩余数量都最多产生一个外部减仓效果。

Effect Closure View 投影 `UNKNOWN_EFFECT` `NO_EFFECT` 或 `SETTLED`，并绑定准确 attempt adapter binding
effect frontier 回读与对账截面 freshness blocker 和责任 Owner。每个 view 还绑定请求 principal 授权
scope authorization-policy cut 账户 mode effect namespace 稳定 request identity projection cut
valid-through replay meaning，以及适用时的 Recovery Case 与 fence。跨 principal 账户 mode、政策过期、
含义变化或 Recovery 不匹配的重放必须拒绝，不能返回旧 view。它只用于解释，权威仍来自 Effect Journal
和来源 Owner 事实。

恢复减仓或清仓由 Reconciler 根据权威场所仓位截面规划，Order Engine 在适配器调用前立即重验同一
方向与数量并要求可强制 reduce-only。较新截面 部分或并发成交 零暴露 方向翻转 不支持 reduce-only
或可能穿越零点都会提交持久无效果拒绝。Reconciler 只能基于新回读构建后继命令，不能重试旧命令。
Recovery 不复用普通 claim 仲裁。Reconciler 对完整受影响效果集合使用版本化确定政策：任何变更前先
回读 先撤销 open order 再减仓 先减仓再清仓 当前截面证明零暴露时不动作；以稳定 instrument 与 order
身份打破 tie。成员缺失或 tie 未解析时不产生外部动作。每个选中动作都在调用前提交 Recovery Effect
Attempt `PREPARED`，紧邻外部调用前提交 `INVOCATION_STARTED`。两个截面之间崩溃时只用权威回读解析
同一 attempt，不能盲目创建新重试。只有完整原因与受影响效果集合联结活动 Risk fence Runtime checkpoint
与当前 readiness 权威 Execution 回读 完整 Risk closure Portfolio closure 和共同时间前沿后，Reconciler
才能写 `KNOWN_CLOSED`。闭合不会解除围栏或恢复交易。

## 决策契约

- **输入** — 正常 Authorized Order Command 与 Risk claim/admission result，或 Execution-owned Recovery Case
  与准确当前 active Risk Fence；adapter venue Risk Portfolio 事实闭合循环。
- **诊断与决定** — 校验正常 effect 权威或选择一个有界 Recovery 动作，记录 attempt 截面，完成权威
  回读与对账，再决定效果或 case 是否闭合。
- **冲突解析** — 稳定正常 attempt identity 防止重复调用；Recovery 按回读 撤单 减仓 清仓和稳定身份
  tie-break 排序，成员未解析时不变更。
- **输出与终态负例** — order effect drift readback Effect Closure View Recovery Effect Attempt 和
  `KNOWN_CLOSED`；拒绝 no-effect unknown 保持互相独立的持久结果。
- **反馈与经济意义** — 让每个外部效果 fee fill drift closure 可归因，使 Portfolio 测量经济结果并让
  Governance 安全改变生命周期。
- **禁止** — 不拥有 Trade Intent 资金分配 Risk 状态 账户投影 生命周期状态，不盲重试 不编造成交，
  不把通知当证明也不激活 fence。

## 后续实现验收

- 只有 Order Engine 能改变订单生命周期状态。
- 每次外部尝试都能追踪到已验证许可或活动恢复围栏。
- 每个正常 Effect Journal record 和权威回读都解析到同一 authorization mode request principal scope
  已准入 Shell binding 与 history head Operator Authorization operation manifest Governance decision
  intent Risk decision 和 Reservation。`UNATTENDED_REQUEST_WITH_POLICY` 还必须解析到同一当前
  Autonomous Policy Authorization。
- 每个 normal add-risk 命令只有一个 Reservation Claim Result；只有 `CONSUMED` 才允许一个 `PREPARED`
  record、一个不可变 Adapter Admission Result 和最多一个 `INVOCATION_STARTED`。decrease-only 禁止任何
  Claim Result 或 Reservation，但仍要求准确 permit `PREPARED` Adapter Admission Result 和最多一个
  `INVOCATION_STARTED`。重启只能加入这些身份与回读，不能签发第二次尝试。
- Reservation Claim Result 从不绑定或要求 `PREPARED` receipt 或 adapter-admission fact。新增风险必须先
  提交 `CONSUMED`，Execution 随后写 `PREPARED`，且只有该 receipt 能进入之后的 Adapter Admission
  Request；任何循环或推测性 preparation 都不可接纳。
- 每个完整 execution observation 都解析到一个完整有限 `observationCategorySet` 及各成员政策与证据
  截面；同时有支持的类别全部保留，`NONE_OBSERVED` 只能作为证明完整 census 的单元素集合，不完整
  截面不产生可用 observation。
- 每个 decrease-only 命令都具有明确空 Reservation/claim lineage、一个 `PREPARED` attempt、一个不可变
  Adapter Admission Result 和最多一个 `INVOCATION_STARTED`，不能只凭 permit 调用。
- Paper 与 Live 适配器消费同一命令契约，但不能共享账户或效果命名空间。
- 并发命令不能消费同一 Reservation，同一命令重放只加入已有 Effect Journal。
- claim 与撤销先解析为一个 Risk-owned 结果；`CONSUMED` 后 `ADAPTER_ADMISSION_REQUEST` 与 fence activation 再解析为第二个 Risk-owned frontier 结果，全部发生在适配器调用前。
- `SUPPRESSED_BY_FENCE` 或 `REJECTED` 不能进入 `INVOCATION_STARTED`；`ADMITTED_ONCE` 是必要条件，但调用前仍必须持久化 invocation-start record。
- 恢复减仓或清仓在部分或并发成交后不能穿越零点或扩大反向暴露，旧截面必须在调用适配器前失败。
- 重复或延迟回执可以幂等汇合且不抹除不确定性。
- 场所回读 Risk 结算 Portfolio 投影和 Recovery Case 证据在闭合前一致。
- 恢复回读和对账必须覆盖准确案例效果集合与来源截面且不存在未知效果。
- 只有 Reconciler 创建 Recovery Command 并写 Recovery Case 或 `KNOWN_CLOSED`；Runtime 不能执行这些写入。
- 恢复事实永不请求普通适配器准入；未知恢复效果使受影响 Reservation 不可复用并保持 case 围栏。
- 对孤儿仓位和带外效果，Execution 提供外部回读但不能断言 Reservation 不存在；只有 Risk 能把自己的集合解析为 `RESOLVED_EMPTY`。
- 每个对账差异触发的生命周期响应都绑定准确 Execution-owned 差异事实身份，通知投递永远不能证明对账完成。
- 每个 `RUNTIME_INCIDENT` 准确 `runtime-incident-fact` 与每个 `RECONCILIATION_DRIFT` 准确
  `reconciliation-drift-fact` 都确定取得自己的 Recovery Admission Disposition；两种来源互不
  替换也互不要求。只有
  `RECOVERY_ADMITTED` 允许匹配 case；Runtime `READY` 加无匹配 fence 及权威 no-effect 或已完整对账且
  无剩余 liability 证明时提交 `NO_RECOVERY_REQUIRED`；其他未解析 admission 证据提交
  `UNRESOLVED_NO_CASE`。后两者不创建 case command effect 或 fence。
- 每个已接纳且匹配的 `RUNTIME_INCIDENT` 或 `RECONCILIATION_DRIFT` disposition、Runtime `NOT_READY`
  或 `RISK_HARD_STOP` fence source 按不可变身份加入同一 case；任一已准入单独分支不要求另一来源。
  hard-stop source 不要求 Runtime `NOT_READY`，也不把 fence 或原因
  权威转给 Execution。
- 每个 Recovery 动作都从完整 affected set 按同一版本化顺序选择，并追踪到一个 `PREPARED` 和最多一个
  `INVOCATION_STARTED` Recovery Effect Attempt。成员或顺序未知时不提交外部动作。
- 每个 Effect Closure View 绑定 principal scope policy 账户 mode namespace request meaning projection
  cut，以及适用时的 Recovery Case 与 fence。不匹配重放不返回 view。

## 可观测性与持久化

Execution 持久化 command admission、Effect Journal、adapter attempt、invocation boundary、order/fill/fee/readback fact、reconciliation drift、Recovery Case 与 effect-attempt closure。Telemetry 用准确 account/scope/mode/effect namespace 记录 queue、admission、adapter/venue 时延、retry suppression、partial fill、readback failure、unknown effect、drift 与 recovery duration。Dashboard 的 command、attempt、order、fill、rejection、unknown effect 与 recovery 次数必须从这些身份推导；span、transport acknowledgement、log 或 alert 永远不能证明外部效果或允许 retry。
