# Strategy Governance

## 职责

从资格成立到退役，拥有可部署策略注册表 生命周期决定和允许资金政策。Governance 决定某个策略 generation 是否可以运行，但不设计工件 不判断单笔交易也不拥有订单效果。

## 拥有的权威事实

- Governed Strategy Entry 绑定 ArtifactRef 准确 Eligibility Fact 与 generation 特定经济条件版本 资格容量
  上限 ActivationConditionVersion CapitalEnvelopeVersion 生效区间和唯一不可变 Execution Scope。该 scope
  绑定预先准入的候选无关 Capacity Scope、准确 adapter 实现配置与 trust-policy 摘要、场所或 simulator
  endpoint、账户 binding、capability 与 reduce-only policy，以及不透明 credential handle。
- 生命周期状态 Authorized Generation Decision 生效时间 活跃 generation 精确已提交事实身份和有界理由类别。每个 generation 决定交叉绑定来源请求的完整 Authorization Lineage；无人值守交易还绑定独立 Autonomous Policy Authorization。Governance 绝不复制保护 Qualification 内容。
- 版本化 Capital Envelope applicability chain：Portfolio-owned Capacity Scope 对应一个 `POOL_ROOT` envelope，
  每个受治理 generation 对应一个 `STRATEGY_GENERATION` envelope。两种 kind 都绑定各自
  `effective-from`/`effective-through` 区间和同一完整共享 Time Evidence 形状；它们不是已承诺用量或
  可用 headroom。
- 一个完整 contender set 与一个 Portfolio Interaction Receipt 对应一个 Capital Allocation Disposition。
  它记录 policy version contender-set frontier 接受资金比例 被拒或延迟成员及准确共同证据截面。
  版本化 priority vector 只包含 Governance 拥有的 `POLICY_PRIORITY_CLASS` Portfolio 拥有的
  `PORTFOLIO_INTERACTION_CLASS` 和 Governance 拥有的 `REQUESTED_CAPITAL_FRACTION`；每项声明比较方向
  与缺失处置。`POLICY_PRIORITY_CLASS` 还必须绑定有限版本化 class 字典及每类语义、classification rule
  身份、决定性 Governance 事实截面、逐 contender 理由和 classified-at Time Evidence；未知 未映射或
  无解释序数一律为 `INPUT_INCOMPLETE_NO_WRITE`。最终 tie-break 是规范 strategy-generation identity，永远不是到达顺序。Governance
  一次性分配稀缺资金池，Risk 只执行结果 envelope。
  排序前必须冻结 Governance-owned contender-membership frontier：包括同一 scope 内仍保有有效新增风险
  权威的全部 generation，以及将建立或增加新增风险的全部待处理已授权请求；其他已知 generation 或请求
  各有一个类型化排除。expected 与 observed 身份、基数和摘要必须完全相等。该 frontier 只从现有 Strategy
  Registry 生命周期 授权与政策 head 派生，不创建第二个 registry。
  分配状态为 `ALLOCATED` `NO_ALLOCATION` 或 `INPUT_INCOMPLETE_NO_WRITE`；每个成员准确为
  `ALLOCATED` `REDUCED` `DEFERRED` 或 `REJECTED`。完整填充为 allocated，触及上限但正数部分填充为
  reduced，高优先级 capped fill 后零剩余为 deferred，政策不准入成员为 rejected。
- 规范生命周期动作准确只有 `INITIAL_ACTIVATION` `PROMOTION` `REDUCTION` `PAUSE` `RETIREMENT`
  `DE_RISK` 和 `RECOVERY`。保留续期是证据评估，不是额外动作别名。活动 generation 丢失维持新增
  风险所需证据时，`DE_RISK_PENDING` 是必须提交的后继状态。
- 每个生命周期决定都包含 authorization mode。`ATTENDED_REQUEST` 只能保持非运行，或授权只减不增的
  `REDUCTION` `PAUSE` `RETIREMENT` `DE_RISK` 或 `RECOVERY`。`INITIAL_ACTIVATION` `PROMOTION` 及自动
  Paper 或 Live 都要求 `UNATTENDED_REQUEST_WITH_POLICY` 和当前 Autonomous Policy Authorization。
  `PROMOTION` 包含有界提高资金或活动后继转换；恢复和增资不是生命周期动作别名。
- 只写一次的 Lifecycle Request Receipt：`ACCEPTED` 绑定唯一结果 Authorized Generation Decision，`REJECTED_NO_WRITE` 不产生治理转换。

## 模块

- **Strategy Registry** — 保存当前治理部署决定、可部署 ArtifactRef 和不可变 generation Execution Scope，但不拥有工件内容。
- **Lifecycle Manager** — 根据资格 表现 暴露 degradation 政策 事故 漂移和恢复闭合事实计算 `INACTIVE`
  `ACTIVE_GENERATION` `DE_RISK_PENDING` `REDUCED` `PAUSED` 或 `RETIRED`。只有必需证据新鲜时才续期
  `ACTIVE_GENERATION`。Risk 的 Aggregate Commitment Frontier 状态不属于该生命周期状态机。
- **Capital Policy** — 版本化供 Risk 消费的 `POOL_ROOT` 加 `STRATEGY_GENERATION` Capital Envelope 链，不创建已承诺容量 交易命令或最终交易数量。
  `POOL_ROOT` 绑定 Capacity Scope 账户命名空间 gross limit policy provenance 和有效区间，但禁止策略
  generation Execution Scope parent Eligibility 或分配字段。`STRATEGY_GENERATION` envelope 绑定唯一 generation
  Execution Scope parent pool root Eligibility gross limit 和有效区间，但禁止 sibling parent Portfolio
  usage Risk headroom 或 admission result。

## 输入交接

- [Qualification](../qualification/) 提供绑定准确 Candidate 事实 经济条件 已评估成本容量模型和资格容量版本的已提交 Eligibility State 与 Revocation 事实。
- [Scanner](../scanner/) 每轮提交一个终态 Scanner Receipt；条件激活必须绑定与决定目标拥有相同策略条目 ArtifactRef 和条件版本的准确 matched proposal member。
- [Portfolio](../portfolio/) 提供 Portfolio Lifecycle Evidence Receipt。`INITIAL_ACTIVATION` 绑定预先存在
  Capacity Scope 的新鲜候选无关 gross Capacity View；`PROMOTION` 还必须按自身 `PROMOTION`
  transition-evidence key 绑定准确且新鲜的 Performance 与 Exposure 回执。generation 特定经济条件来自
  Qualification 和 Capital Policy，不属于 pool ceiling。
- 建立 Execution Scope 前，[Portfolio](../portfolio/) 提供当前 `BOUND` Capacity Scope，
  [Execution](../execution/) 提供当前 `ADMITTED` Execution Adapter Binding。账户 mode 效果命名空间
  endpoint capability valid-through 与共享约束分区必须准确一致；预绑定未知或冲突时不产生生命周期授权。
- [Portfolio](../portfolio/) 为集合资金决定提供 Portfolio Interaction Receipt，在一个一致 contender
  与估值截面上包含集中度 相关性 方向与因子重叠 尾部贡献 分散贡献和边际组合价值。缺少交互证据时
  整个分配决定不可用，不能把各策略独立批准后再拼接。
  每个 contender 必须携带该 receipt 中 Portfolio 拥有的准确 interaction class；Governance 不重新计算
  或替换该分类。
- [Runtime](../runtime/) 提供 Generation Application Receipt 和可直接读取的 Runtime Incident Fact。
- [Execution](../execution/) 在新 generation 启动前提供不可变 `RecoveryCase.KNOWN_CLOSED`。
- [Execution](../execution/) 提供可直接读取的已提交 Reconciliation Drift Fact，包括明确效果未知状态和权威回读切面。
- Product Edge 提供明确生命周期请求，但不能直接修改治理状态。每个请求携带 request identity
  principal scope 已准入 active-shell binding 与 history head Operator Authorization 和 operation
  manifest。Governance 用自己的终态回执闭合稳定请求身份；回执缺失时保持未知。

## 输出交接

- 向 [Scanner](../scanner/) 提供准确 ArtifactRef Eligibility ActivationConditionVersion CapitalEnvelopeVersion 数据需求和生效区间。
- 向 [Runtime](../runtime/) 授权一个 generation 的 `INITIAL_ACTIVATION` 或 `PROMOTION`，或只减不增的
  `REDUCTION` `PAUSE` `RETIREMENT` 转换。每次新增风险转换都重复完整请求 Authorization Lineage 并
  绑定显式 Autonomous Policy Authorization。Runtime
  单独证明应用结果，Governance 不宣称实例已经运行。
- 向 [Risk](../risk/) 提供适用 `POOL_ROOT` 与准确 `STRATEGY_GENERATION` Capital Envelope、当前 Eligibility Fact、兼容 Capacity View 规则、生效区间和经济容量契约。一个 intent 只受自身 applicability chain 约束，兄弟 generation envelope 不参与 global minimum；所有 generation 的聚合承诺仍受共同 pool ceiling 限制并由 Risk 在同 scope Aggregate Commitment Frontier 准入。它不是订单命令。
- 向 [Risk](../risk/) 提供的每个 generation envelope 都重复对应 Capital Allocation Disposition 与 contender
  set。Risk 拒绝超出 generation envelope 或 pool 的请求，但不能选择赢家 重新分配闲置比例或让并发
  到达顺序改变分配。
- 向 Product Edge 提供终态 Lifecycle Request Receipt，以及只读生命周期和部署决定视图；视图只含状态 政策边界 生效区间 有界理由类别和不可解引用已提交事实引用。

## 拒绝和禁止事项

- 不基于部分 contender set、过期或混合 Portfolio Interaction Receipt、或不确定请求顺序分配稀缺
  资金。相同集合 事实和政策重放时，必须与投递顺序无关地得到相同 Capital Allocation Disposition。
- 同一 generation 和决定前沿的不同生命周期请求必须按稳定政策优先级原子解析，不能后写覆盖。
  完整规范顺序为 `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION`；
  同级冲突使用规范 request identity。等价重复加入同一回执，过期 混合截面或低优先级请求提交明确
  no-write。该请求优先级不能替代从不利证据中选择动作。
- 不利证据使用另一套版本化 lifecycle disposition policy。`RETIREMENT` 要求终态证伪或结构无效且没有
  有界可行后继；`PAUSE` 用于安全未解析或必需证据暂时缺失；`REDUCTION` 要求退化证据成立且更低资金
  仍具经济与运行可行性。多个不利 predicate 同时成立时，唯一胜出顺序为
  `RETIREMENT > PAUSE > REDUCTION`；该证据处置顺序与请求优先级相互独立。Governance 记录全部适用替代项
  唯一选择结果 决定性 Portfolio 类别与截面和政策版本；输入缺失时不提交决定。
- 不注册缺少当前 Qualification 证据的工件，也不静默替换 ArtifactRef。过期 跨 Candidate 条件不匹配或扩大后的经济容量绑定不属于当前证据。
- 条件激活不能绕过 Scanner 证据，也不能从 `PROPOSED` batch 激活负面或非成员策略。
- 不把保护 Qualification 测量 参数 结果 holdout 细节或评估输出复制进决定 理由或只读视图。
- 兼容 Capacity View Eligibility 必需 Scanner 证据或 Recovery 事实缺失 过期 不匹配或不可用时不得接纳 `INITIAL_ACTIVATION`。`PROMOTION` 还要求匹配准确 generation 的新鲜 Performance 与 Exposure 回执及准确 `PROMOTION` evidence key。`PAUSE` `REDUCTION` 和 `RETIREMENT` 不增加风险，因此不能被容量或表现证据缺失阻断。
- Scanner 提案只是证据。Governance 只能在既有已授权无人值守生命周期血缘内使用它，并且仍独占
  部署决定和 Capital Allocation Disposition。提案本身不能创建 Runtime application 或资金权限。
- Eligibility 过期 撤销 缺失或未知，或必需 Performance Exposure degradation 证据过期或不可用时，
  不得静默保留 `ACTIVE_GENERATION`。必须提交 `DE_RISK_PENDING` 立即取代新增风险权限，并推动
  decrease-only 链直到暴露闭合或受限。容量 表现或暴露证据缺失不得阻断暂停 降权或退役。
- 不把裸 Authorized Generation Decision 当成无人值守交易权限。决定必须绑定当前 Autonomous Policy
  Authorization 与来源请求的完整 Authorization Lineage。
- 不把 `ATTENDED_REQUEST` 转成 `ACTIVE_GENERATION`，不要求 Runtime 应用它，也不让它发起正常 Paper
  或 Live 新增风险意图或效果。未来 attended-effect 路径必须另有显式契约。
- 不创建 Trade Intent Risk Decision Reservation 订单命令 成交或账户效果。
- 后继 Capital Envelope 收窄时不得静默保留原有新增风险权限。Governance 只发布或取代 envelope，
  发布行为不证明当前 usage。只有 Risk 能独立在 Aggregate Commitment Frontier 上提交
  `OVERCOMMITTED_NO_NEW_RISK`。Governance 的降权 暂停和退役只使用已建模资格 表现 政策 事故
  漂移和闭合证据，不依赖隐藏 Risk 交接。
- Runtime 提交 `APPLIED` 前不把已授权 generation 报告为正在运行；`APPLICATION_UNKNOWN` 不得转成重复应用命令。
- 不从治理决定直接宣告降权 暂停或退役完成。Runtime 必须停止新意图，Risk 只能签发不增加暴露且
  不含 add-risk Reservation 的决定，Execution 必须撤单 减仓 清仓或回读，Portfolio 必须证明结果暴露。
  外部效果未知时进入 Recovery。
- `RecoveryCase.KNOWN_CLOSED` 前不得恢复围栏范围，闭合只允许重新决定而不自动启动。
- 不把 Event Rail 或通知投递当作事故 差异 对账或恢复证据，必须绑定准确来源 Owner 事实身份。

## 失败与恢复

资格过期或撤销 表现恶化 违反政策 事故或对账漂移都可以触发降权 暂停或退役。外部效果未知时必须
暂停并禁止新 generation。Execution Reconciler 的 Recovery Case 闭合只解决新 Governance 决定所需的
未知效果前置条件。前驱 generation 及其 Risk Fence 永久保持围栏；后续 generation 使用不同决定与
普通新增风险门禁，但在自己的 `RUNTIME_NOT_READY` 或 `RISK_HARD_STOP` 条件激活前没有 Recovery Fence。

保留活动状态必须显式续期，不能依靠沉默。Eligibility 过期 撤销 缺失或未知，或必需 performance
exposure degradation 截面过期时，Governance 立即提交 `DE_RISK_PENDING` 并移除新增风险权限。
Runtime 与 Risk 对后继状态失败关闭，同时继续 decrease-only 链；容量或表现证据不可用不能阻止更安全
的暂停 降权或退役。

只减不增生命周期路径不能复用普通 add-risk Reservation。其持久结果绑定 Governance 决定 Runtime
应用 Risk decrease-only 决定 Execution 效果与回读和 Portfolio 投影。拒绝或事实不可用时保留前一
生命周期状态；外部效果未知时打开 Recovery，而不是伪造成功暂停或退役。

当 contender 超出共享资金池时，Governance 等待声明的完整 contender-set frontier，使用一个一致
Portfolio Interaction Receipt 和版本化分配政策提交唯一 Capital Allocation Disposition。
Governance 先移除政策明确拒绝成员，再按已声明序数 policy priority、Portfolio interaction class、
requested capital fraction 和唯一规范 generation bytes 作字典序排序，最后执行 capped priority fill。
成员或属性缺失 generation identity 重复 完整 comparator key 重复 重叠未解析 截面过期或混合 政策
含糊时提交 `INPUT_INCOMPLETE_NO_WRITE`，不做部分分配。Risk 随后执行，但不重新计算 envelope。

## 决策契约

- **输入** — 当前 Eligibility、条件激活所需完整 Scanner 证据、完整 contender set、Portfolio lifecycle
  interaction degradation 回执、Runtime application 或 incident、Execution drift closure 和授权生命周期请求。
- **诊断与决定** — 判断资格与保留，再决定生命周期状态和唯一确定 Capital Allocation Disposition；
  Governance 决定部署和资金比例，不决定单笔交易。
- **冲突解析** — 完整集合分配可重放且与顺序无关；生命周期冲突按
  `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION` 只解析一次；
  `PROMOTION` 始终按该声明 rank 参与，且必须携带 `PROMOTION` evidence key；
  不利证据动作选择仍是独立的版本化三结果政策。
- **输出与终态负例** — lifecycle decision envelope allocation disposition 或明确 no-write；证据缺失
  过期 混合截面 无政策 tie 或未知时不产生新增风险转换。
- **反馈与经济意义** — 表现 暴露 交互 degradation 事故和漂移共同决定稀缺资金是否启动 续期 降权 暂停或退役。
- **禁止** — 不创作 Artifact 不读取保护细节，不拥有 Trade Intent 风险许可 订单 场所效果 账户投影，
  也不证明 Runtime 已应用决定。

## 后续实现验收

- 每个活跃 generation 都能解析到唯一合格 ArtifactRef 生命周期决定 资金政策 生效区间、不可变
  mode 账户与效果命名空间、预先准入 Capacity Scope 和不可变 adapter binding。
- Paper generation 永远不能与 Live 账户或效果命名空间重名，也不能向其写入事实。
- 命名空间身份检查在重放和重启后仍然成立；跨 generation 的相反模式账户或效果命名空间绑定必须拒绝。
- 激活条件变化超出 Qualification 已评估边界时必须创建新 Candidate 并重新评估。
- 每个 Capital Envelope 只有一种 applicability 和一个 parent：`POOL_ROOT` 绑定 Portfolio Capacity Scope，`STRATEGY_GENERATION` 绑定一个 generation 与该 root。Intent 只使用自身链，聚合承诺仍受 pool root 和 Capacity View gross ceiling 限制。
- `POOL_ROOT` 不含策略 generation 或 Execution Scope。一个 root 只有在每个 generation child 保留各自
  准确 Execution Scope，且共享同一 Capacity Scope 账户 政策和生效时间截面时，才能拥有多个 child。
- Risk 只有在准确 `POOL_ROOT` 与 `STRATEGY_GENERATION` envelope 都为 `EFFECTIVE`、两者区间覆盖同一
  decision time，且 clock epoch monotonic sequence policy-head frontier 账户 mode scope 和 parent linkage
  全部一致时才可接纳新增风险。链缺失 过期 跨 epoch 或区间不重叠时必须无政策写入地拒绝。
- 后继 envelope 收窄到低于既有承诺时取代原更宽 Capital Envelope。只有 Risk 能判断并提交 Aggregate Commitment Frontier 是否为 `OVERCOMMITTED_NO_NEW_RISK`；Governance 不制造该状态，也不把发布 envelope 当成当前使用量证明。
- 每次 `INITIAL_ACTIVATION` 或 `PROMOTION` 都绑定准确 Portfolio lifecycle receipt 与 Capacity View 身份；
  `PROMOTION` 还绑定准确且新鲜的 Performance 与 Exposure 回执和自身 `PROMOTION` evidence key。scope 经济条件 方法
  假设 流动性截面或有效期不匹配必须失败关闭。
- `PROMOTION` 必须创建新的 Authorized Generation Decision，重放不得生成重复 generation。
- 注册表和生命周期历史不能被改写，只能追加可审计后继决定。
- 每个已接受 generation 决定都在终态回执中保留 request principal scope 已准入 Shell binding 与
  history head Operator Authorization operation manifest 和授权模式；无人值守决定还保留 Autonomous
  Policy Authorization。
- 每个继续活动的 generation 都有绑定新鲜必需 Eligibility Performance Exposure degradation 证据的
  续期决定；任何必需成员丢失都进入 `DE_RISK_PENDING`，不得静默保留。
- Governance 不能生成执行命令，也不能把外部效果标记为已结算。
- 暂停或围栏 generation 在所需终态事实可读前不能重新激活。
- 每次由事故或对账差异驱动的生命周期转换都能解析到触发它的准确 Runtime Incident Fact 或 Execution Reconciliation Drift Fact。
- 生命周期请求并发或重启送达时加入同一只写回执；Runtime 并发送达时加入同一 Generation Application Receipt，且最多形成一个 Strategy Instance。
- 相同完整 contender set Portfolio Interaction Receipt policy version 与证据截面，不论请求投递顺序
  都生成相同 Capital Allocation Disposition。
- 每个 contender 都携带三项版本化 priority attribute 及其来源 方向和缺失处置。属性缺失或未知时
  产生 `INPUT_INCOMPLETE_NO_WRITE`；完全相同只按规范 strategy-generation identity 解析。
- 分配是完整无序集合上的确定 capped fill。generation identity 或完整 comparator key 重复，或任一
  属性缺失 未知，都提交 `INPUT_INCOMPLETE_NO_WRITE` 且不创建 Authorized Generation Decision。
- 并发冲突生命周期请求只按
  `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION` 解析一次；低优先级请求不能覆盖已提交的更安全状态。
- 每次不利转换都按当前 disposition policy 证明为何选择 `RETIREMENT` `PAUSE` 或 `REDUCTION`；请求优先级
  不能替代该证据选择；predicate 重叠时必须准确按 `RETIREMENT > PAUSE > REDUCTION` 得出唯一结果。

## 可观测性与持久化

Strategy Governance 持久化 Registry entry、lifecycle request/receipt、allocation contender/disposition、capital envelope、authorized-generation decision 与不利生命周期证据。Dashboard 生命周期投影从这些事实与 Runtime application evidence 推导当前部署策略、generation、mode、生效开始/停止时间、活跃时长、pause/retire/resume 历史和资金变化。仅有 Governance 授权不能让 projection 标记策略正在运行；alert 或 Dashboard action 也不能绕过新的受治理请求改变生命周期。
