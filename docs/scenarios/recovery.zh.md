# 恢复场景

Recovery 把 Runtime 就绪丢失 事故 对账漂移或 Risk hard stop 分类为有权威的无 case disposition 或
可证明闭合的外部效果状态。它是架构中最大的安全边界，永远不复用普通新增风险路径。

## Entry / 入口

每个已提交 initiating cause 必须准确分类到一个适用 trigger branch。不同原因同时出现时保留各自
branch membership，并加入同一只追加 Recovery Case causal frontier；任一分支都不要求只属于另一
分支的证据。
场景顶层 PRIMARY/SUPPORTING relation set 只是 Flow 与页面聚合覆盖，不是全部关系的 conjunction；
真正可执行的必经路径由下列每个适用 branch 自己的 relation set 决定。

- `RUNTIME_NOT_READY` 在准确实例 generation checkpoint Execution Scope 与受影响 Capacity Scope 的
  不可变 Runtime Readiness Fact 为 `NOT_READY` 时适用。Runtime 发布前提交本地意图/命令抑制，Risk
  独立创建匹配 fence。不要求 Runtime Incident Execution drift 或 hard-stop cause；`NOT_READY` 自身就
  创建或加入 case。
- `RUNTIME_INCIDENT` 只在准确 generation 与 scope 存在不可变 `runtime-incident-fact` 时适用。任何 case
  存在前，`runtime-risk-incident-fence` 把该准确已提交来源事实交给 Risk，只有 Risk 写入匹配的
  `RUNTIME_INCIDENT` Recovery Fence；只有 Execution 能为该准确来源提交一个只写一次 `recovery-admission-disposition`。
  `RECOVERY_ADMITTED` 要求该 incident fact 与匹配 `ACTIVE` Risk Recovery Fence，只有此时才允许创建或
  加入 case；该单独分支不要求 reconciliation-drift fact。
- `RECONCILIATION_DRIFT` 只在准确 generation 与 scope 存在不可变
  `reconciliation-drift-fact` 时适用。`execution-risk-drift-fence` 把该准确已提交来源事实交给 Risk，
  只有 Risk 写入匹配的 `RECONCILIATION_DRIFT` Recovery Fence。它遵循同一先处置规则，但 disposition 只绑定该 drift
  来源，绝不替换 Runtime incident；该单独分支不要求 incident fact。
- 对任一来源分支，若 Runtime 为 `READY`、不存在匹配 hard-stop 或 not-ready fence，且新鲜共同
  Execution/Portfolio/Risk/Time 截面证明没有外部效果或已完整对账且无剩余 liability，Execution 提交
  `NO_RECOVERY_REQUIRED`；否则在最后权威 admission frontier 提交 `UNRESOLVED_NO_CASE`。后两种状态不
  创建 case command effect attempt fence，也不编造 Runtime/Risk 事实。两者都准入时，各自 disposition
  加入同一只追加 case。
- `RISK_HARD_STOP` 在 Risk 提交一个绑定准确 hard-stop 原因证据 政策版本 Aggregate Commitment
  Frontier generation 与 scope 的 `ACTIVE` fence 时适用。即使 Runtime 保持 `READY` 且不存在 Runtime
  Incident 或 Execution drift，它也直接创建或加入 case。

readiness 的 `valid-through` 过期必须失败关闭，不能推断为 `READY`。Risk 激活适用 fence 时不等待
Runtime 或 Execution case 确认。重复原因加入同一 case，同一 generation 与影响范围不能有并行未终结
case。case 保存不可变原因引用；来源 Incident Readiness 和 Drift 事实不增加 case 反向引用也不改字节。

## Value path / 价值路径

`RUNTIME_INCIDENT` 或 `RECONCILIATION_DRIFT` 来源只有 `RECOVERY_ADMITTED` 才能进入本路径。对已具备独立适用 `ACTIVE` fence
的 case，Risk 在同 scope 前沿给 fence activation 与每个在途正常
`ADAPTER_ADMISSION_REQUEST` 排出唯一顺序。
fence 先获胜时返回 `SUPPRESSED_BY_FENCE`；正常 admission 先获胜时，只有一个不可变
`ADMITTED_ONCE` attempt 进入 Recovery effect frontier。只有 Risk 能在 Aggregate Commitment Frontier
证明完整活动 fence set；Execution 不能根据收到的 fence 消息推断完整性。Execution 把准确 set identity、
content digest 与每个来源独立 member 的 identity、epoch、policy、action set 和 source cut 绑定到
`OPEN` case 后才推进到 `FENCED_OPEN`。`RUNTIME_NOT_READY` 分支中 Runtime 不再生成正常意图；hard-stop
分支即使 Runtime 仍为 `READY`，Risk 也阻止新增风险。只有 Execution Reconciler 能创建 Recovery
Command。有效 allowed action 是所有 member fence action set 的确定性交集，绝不是并集；交集为空时
不允许任何命令。

每个 case causal frontier 的 fence membership 只追加。每个 plan、command、effect attempt、Execution
fact、Portfolio/Risk closure fact、Product Edge closure view 与 Runtime recovery fact 都绑定同一不可变
完整集合快照。调用前新增 fence 会使旧 plan 和 command 失效；调用后新增 fence 保留原 attempt 身份，
只扩展后续 case frontier。

Order Engine 验证命令，Execution Adapters 执行有界动作，Effect Journal 记录 attempt 与结果，
Reconciler 读取权威场所或模拟器状态。Recovery 对完整 affected set 使用版本化确定顺序：变更前先
回读 先撤单再减仓 先减仓再清仓 零暴露不变更，并用稳定 instrument 与 order 身份打破 tie。成员缺失
或 tie 未解析时不变更。每个选中动作在调用前提交 Recovery Effect Attempt `PREPARED`，紧邻调用前
提交 `INVOCATION_STARTED`。已经在途的正常 attempt 必须具备持久 `PREPARED` 和
`INVOCATION_STARTED` 记录；崩溃 响应丢失和重启只加入原记录与权威回读，不进行裸重试。恢复命令
不使用普通 Trade Intent add-risk Reservation Claim 正常 adapter admission 协议或正常生命周期
`PERMIT_DECREASE_ONLY`。

减仓或清仓绑定 Execution 权威暴露回读截面 方向 绝对数量 有界目标和 reduce-only 政策。Execution
在调用前立即重验同一截面。较新截面 部分或并发成交 零或翻转暴露 不支持 reduce-only 或可能穿越
零点时提交持久无效果拒绝。Reconciler 只能根据新的权威回读构建后继命令，绝不重试旧命令。

Execution 向 Risk 回报绑定 case 完整 fence set command effect 的事实。已提交
`reconciliation-drift-fact.UNKNOWN_EFFECT` 绑定 effect journal frontier、invocation 或 uncertain-effect
lineage、不确定性观察、最后一次权威回读尝试或已证明缺失，以及完整 source 与 Time Evidence frontier。
这个完整事实可激活自身 `RECONCILIATION_DRIFT` fence，但绝不编造外部结果。缺失 含义不明 未提交或
state binding 不完整的证据不激活 fence。只有后继 `NO_EFFECT` 与 `SETTLED` 绑定权威终态回读与对账
截面。Risk 独占 Reservation 成员与
liability 解析，包括已证明孤儿外部效果的显式空集合。Portfolio 独占账户和暴露投影更新。Reconciler
只有在一个共同证据前沿覆盖全部原因和受影响效果时才写 `KNOWN_CLOSED`。

## Owner handoffs / Owner 交接

- Runtime → Risk 为 `RUNTIME_NOT_READY` 提供不可变就绪事实；`RUNTIME_INCIDENT` 则由
  `runtime-risk-incident-fence` 携带准确已提交 `runtime-incident-fact`。两者都只是来源证据，Risk 仍是
  Recovery Fence 唯一 writer
- Runtime → Execution 提供实例 checkpoint 就绪和已提交事故事实 绝不发送 Recovery Command
- Execution 在任何 case 前为每个 `RUNTIME_INCIDENT` 与 `RECONCILIATION_DRIFT` 拥有一个来源准确的
  Recovery Admission Disposition。只有 `RECOVERY_ADMITTED` 可创建或加入 case；任一单独分支都不需要
  另一来源，两者同时准入时各自 disposition 加入同一 case；`NO_RECOVERY_REQUIRED` 与
  `UNRESOLVED_NO_CASE` 是终态 no-case 事实
- Execution → Risk 为 `RECONCILIATION_DRIFT` 通过 `execution-risk-drift-fence` 携带准确已提交
  `reconciliation-drift-fact`；该关系不授予 Execution Recovery Fence 写权威
- Risk → Execution 提供一个 Aggregate Commitment Frontier 上的 Risk-authoritative 完整活动 fence set，
  包含准确 set identity/digest 与全部来源独立 member；同时提供终态 Reservation 成员和剩余暴露闭合事实
- Execution → Risk 提供不含普通 claim 或 adapter admission 的围栏恢复效果事实
- Execution → Portfolio 提供订单 成交 账户 费用和权威回读事实
- Market Data → Portfolio 提供当前估值 汇率和标的事实
- Portfolio → Risk 与 Execution 提供一致账户暴露 bundle 和匹配账户闭合投影
- Execution → Governance 提供不可变 `RecoveryCase.KNOWN_CLOSED` 只有 Governance 可决定新 generation

Event Rail 只能唤醒 Governance 与 Observability 读取已提交 Owner 事实，不参与恢复也不拥有业务终态。

## Proof / 证明

每个 `RUNTIME_INCIDENT` 或 `RECONCILIATION_DRIFT` 来源先证明自己的 Execution-owned Recovery Admission
Disposition，并只绑定准确 `runtime-incident-fact` 或 `reconciliation-drift-fact`。source fact
generation scope policy evidence frontier 与含义准确相同的 replay 加入该只写一次事实；来源 scope
policy 或 evidence 改变时需要后继 disposition，且绝不改写或编造 case。
当 disposition 为 `RECOVERY_ADMITTED` 时，终态证明是 Execution 独占的不可变
`RecoveryCase.KNOWN_CLOSED`。它绑定唯一 case generation scope
完整活动 Risk fence-set identity/digest 与 member set 完整原因集合 全部受影响效果 Runtime checkpoint 与就绪前沿 Execution 回读与对账截面
Risk Reservation 闭合和 Portfolio 账户投影，并要求共同有效时间前沿。更晚原因创建后继案例，不能
改写既有闭合。
`KNOWN_CLOSED` 是硬终态证明而非状态摘要：case 前沿中的每个原因与受影响效果都必须可解析，任一
缺失 过期 未知 混合截面或不可解引用成员都会阻止闭合。
该证明绑定所有 Recovery 动作使用的同一完整仍为 `ACTIVE` 的来源独立 Risk Fence 集合。闭合不取代
不停用 不解除也不修改任何 member：旧 generation 永久被围栏，每个 fence 都没有 `SUPERSEDED` 或
inactive 转换。任何后续
generation 都必须取得新的 Governance 决定并通过普通新增风险门禁，绝不改变或复用前驱 fence；该
generation 在自身四种准确 Recovery 来源分支之一独立激活前没有 Recovery Fence。
每个受影响正常效果还必须经 Effect Journal 与回读保留其原始请求 Authorization Lineage 和
Autonomous Policy Authorization。Recovery Command 只从 Execution-owned case 与完整活动 Risk fence set 派生，
不是新的正常交易授权。

## Development outcome / 开发结果

- **受益者** - 必须确认不确定外部效果已被完整约束和对账的运营者与资金负责人
- **可观测结果** - 每个 Runtime incident 或 reconciliation drift 先产生一个来源准确的权威 admission disposition；只有已接纳原因进入一个
  Execution 案例，把全部原因和效果联结到场所回读 Risk 闭合 Portfolio 闭合和不可变 `KNOWN_CLOSED`
- **未改变伤害** - 分裂权威会造成裸重试 孤儿仓位 未解析 liability 或过早复用资金
- **终态负例** - 任一效果未知 Reservation 未解析 对账未闭合 原因缺失 就绪过期或证据截面混合都保持围栏

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- Runtime 不创建 指挥 推进或闭合 Recovery Case，只提供实例 checkpoint 就绪和事故事实
- Risk 遇到 `NOT_READY` 或过期 Runtime scope 时不等待 case 确认，必须独立设围栏
- Risk 也可以根据准确 `RISK_HARD_STOP` 原因证据与政策在 Runtime 为 `READY` 时设 fence；Execution
  必须进入同一 Recovery 路径，不能编造 Runtime `NOT_READY`
- Runtime incident 或 reconciliation drift 自身绝不编造 fence 或 case。没有匹配 `ACTIVE` fence 时，权威 no-effect 或已完整
  对账且无剩余 liability 的证明产生 `NO_RECOVERY_REQUIRED`；证明缺失 混合截面或无法隔离时产生
  `UNRESOLVED_NO_CASE`。两种状态都不允许 command effect attempt 或 case
- 即使没有 Incident 或 Drift，`NOT_READY` 自身也必须创建或加入 case；等待其他原因会让 Recovery
  无法闭合，属于无效实现
- Recovery Command 不能激活策略 增加暴露或使用普通 Trade Intent Reservation Claim 或适配器准入
- Recovery 命令缺少准确 Risk-authoritative 完整 `ACTIVE` fence set，或动作不在所有 member
  allowed-action set 交集时不能穿过 adapter gate。过期 遗漏 未激活 扩大 不匹配或无法证明完整的集合
  都拒绝动作，新增风险永远不属于 Recovery allowed action
- Recovery 不能擦除或替换受影响正常效果的 Authorization Lineage，Agent 或 operator 确认不能自行
  产生 Recovery Command 权限
- 证据缺失 过期 含义不明或不匹配时，只阻断依赖对应 trigger branch 的转换。不能把另一分支不要求的
  事实编造成前置条件或替代品；每个 Recovery action 仍要求准确当前 `ACTIVE` fence，且
  `RUNTIME_INCIDENT` 与 `RECONCILIATION_DRIFT` 都不能在自己的 `RECOVERY_ADMITTED` 前打开 case
- 正常 adapter admission 先于 fence 获胜时准确 attempt 纳入 effect frontier；fence 先获胜时
  `SUPPRESSED_BY_FENCE` 证明没有正常适配器调用
- `DECREASE_ONLY_STRATEGY_PROTECTIVE` 与 `RISK_HARD_STOP` 在同一 frontier 成立时保留两个可归因原因，
  但 Risk fence 是唯一 Recovery 权威。fence 先发生会抑制正常 intent；admission 先发生则保留准确一个
  attempt 等待回读。Execution 再用同一 open-order 暴露 回读截面去重正常保护 lineage，因此任何到达
  顺序都最多产生一个外部减仓效果
- case fence 暴露截面或 reduce-only 能力缺失 过期或不匹配时禁止 Execution 调用
- 隐式空或未解析 Reservation 集合不能闭合；显式空必须联结完整 Risk 成员证据与权威 Execution 回读
- 同一 generation 与 scope 同时准入的事故和漂移 disposition 加入同一案例，任一单独分支不要求另一
  来源；遗漏原因或效果 闭合前新增原因或混合
  Execution Portfolio Risk 时间截面都会阻止闭合
- Recovery Case 可以引用不可变 Incident Readiness 与 Drift 原因；这些来源事实永不改写为反向指向 case
- Telegram 投递 Runtime 存活 本地撤单或 Event Rail 沉默都不能证明闭合
- `KNOWN_CLOSED` 不可变 不解除 Risk fence 不恢复旧 generation，只允许 Governance 考虑新授权
