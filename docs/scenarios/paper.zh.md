# 模拟交易场景

模拟交易使用与实盘相同的自动控制契约，只把外部场所边界替换为 Execution 模拟适配器。

## Entry / 入口

Strategy Governance 已为一个模拟 generation 授权具有资格的 Strategy Artifact 并分配资金政策，但尚未
启动 Runtime。
该决定绑定一个具有隔离账户和效果命名空间的 `PAPER` Execution Scope。
`INITIAL_ACTIVATION` 还绑定包含新鲜 Capacity View 的 Portfolio Lifecycle Evidence Receipt；该视图必须兼容该
scope，且不能为新 generation 编造历史表现。Execution Scope 另绑定一个预先准入的模拟 Adapter Binding。
Runtime 已提交 `APPLIED` Generation Application Receipt，把唯一 Strategy Instance 与 checkpoint 绑定到同一决定 generation
scope 工件和 fence epoch。Paper 与 Live 使用同一 Strategy Instance 语义；只有 Execution 选择预先
准入的模拟 adapter 及隔离账户与效果命名空间。
application 还绑定完整请求 Authorization Lineage 与 `PAPER` Autonomous Policy Authorization。此授权只适用于 `PAPER` scope。
模拟只替换 adapter，不能取消显式无人值守交易权限要求。
`INITIAL_ACTIVATION` `PROMOTION` `APPLIED` 以及正常自动 Paper 新增风险或模拟效果都要求
`UNATTENDED_REQUEST_WITH_POLICY`。`PROMOTION` 按自身 transition-evidence key 绑定新鲜兼容 Capacity
View Performance 与 Exposure 证据。`ATTENDED_REQUEST` 只能处于未运行和 decrease-only 状态；除非未来
另行定义独立 attended-effect 契约，否则不能进入 Paper。

## Value path / 价值路径

Market Data 向 Strategy Instance 推送行情，并向 Portfolio 提供估值事实。Strategy Instance 是正常
Trade Intent 的唯一写入者。Risk 返回明确终态和一次性 Reservation。Strategy Instance 把获准许可
绑定为 Authorized Order Command。Execution 验证绑定并提交一个稳定 Reservation Claim Request。只有 Risk
`CONSUMED` 才允许 Execution 记录一个 `PREPARED` attempt 再发送 `ADAPTER_ADMISSION_REQUEST`。Risk 在与
recovery fence activation 共用的 frontier 中原子提交不可变 admission result；
只有 `ADMITTED_ONCE` 允许 `INVOCATION_STARTED` 并触达模拟适配器。Execution 随后记录效果 完成对账并向 Risk
回报 settlement lineage，向 Runtime 回报订单 成交 拒绝 回读和对账事实，向 Portfolio
回报账户 订单 成交 费用和适配器事实。Risk 独占 Reservation 状态迁移，Portfolio 独占账户投影更新。
任何 paper `UNKNOWN_EFFECT` 都加入同一 `PAPER` generation 与效果命名空间的稳定 Recovery Case。
Risk 独立激活 fence，Execution 创建 case 并绑定该 fence 后才能执行恢复命令。该 paper scope 在同一 case 达到 `KNOWN_CLOSED`
前保持阻断；闭合只可支持新的 Paper 决定，永远不能支持 Live。

正常 decrease-only Paper 工作使用独立准确路径：Governance 决定 → Runtime 本地停止 → Risk
`PERMIT_DECREASE_ONLY` → Reservation/claim 明确为空的命令 → Execution `PREPARED` →
`ADAPTER_ADMISSION_REQUEST` → Risk `ADMITTED_ONCE` 或终态抑制/拒绝。只有 `ADMITTED_ONCE` 允许
`INVOCATION_STARTED` 并触达模拟适配器。该路径没有 Reservation Claim Result 或 `CONSUMED`，但
preparation 和同 frontier fence arbitration 仍为必需门禁。

## Owner handoffs / Owner 交接

Governance → Runtime 授权模拟 generation；Runtime → Governance 与 Product Edge 返回唯一能证明实际
应用结果的 Generation Application Receipt。Governance → Risk 提供政策和资金上限。Market Data →
Runtime 提供实时事实，Market Data 与 Execution → Portfolio 提供估值 流动性和账户事实。Portfolio → Governance
绑定激活容量证据，Portfolio → Risk 为每次新增风险决定提供准确候选无关 gross Capacity View 与一致
Portfolio Risk Evidence Bundle。其不可变
Capacity Scope 是账户加 `PAPER` 模式加经济资金池，不含策略或 generation。Risk 在同 scope 唯一
Aggregate Commitment Frontier 上持久序列化决定，usage 按经济 lineage 合并该 bundle 与 held
Reservation liability。Runtime → Risk 发送意图，Risk → Runtime 返回决定和预留，Runtime → Execution
发送绑定命令。Execution → Risk 依次请求 Reservation claim 与 adapter admission 并回报结算，Risk → Execution 返回唯一不可变
claim 与 admission result，Execution → Runtime 回报订单 成交 拒绝 回读和对账，Execution → Portfolio
回报账户 订单 成交 费用和适配器事实。
Paper Recovery 与 Live 使用同一 branch contract：Runtime `NOT_READY` 独立导致 Risk fence 与 case。
`RUNTIME_INCIDENT` 只绑定准确 `runtime-incident-fact`，`RECONCILIATION_DRIFT` 只绑定准确
`reconciliation-drift-fact`；两者分别先取得自己的 Execution-owned Recovery Admission
Disposition，任一单独分支都不要求另一来源。只有带匹配活动 fence 的 `RECOVERY_ADMITTED` 创建或加入
case，两者同时准入时加入同一 case；`NO_RECOVERY_REQUIRED` 或
`UNRESOLVED_NO_CASE` 不创建 case 或 command。模拟 adapter 或本地确认都不能编造或清除这些事实。

## Proof / 证明

证明从绑定唯一 Strategy Instance 的 `APPLIED` Generation Application Receipt 开始，并包括规范 `PAPER` mode 与 namespace identity、每个意图与风险终态、仅新增风险具有的 Risk-owned Reservation Claim Result、每个 Adapter Admission Result、`PREPARED` 及准入后的 `INVOCATION_STARTED` record、绑定许可的订单命令、模拟订单与成交事实、
Effect Journal、已结算预留、完成的对账，以及能解释余额、仓位、暴露和表现的 Portfolio 投影。
每份证明事实都重复同一 `PAPER` scope，任何模拟命名空间都不能与实盘命名空间互为别名或更新后者。
每个 `RUNTIME_INCIDENT` 或 `RECONCILIATION_DRIFT` 还必须包含各自同 scope Recovery Admission
Disposition，并只绑定自身准确来源事实，不能绑定另一分支来源。若为
`RECOVERY_ADMITTED`，还必须包含同 scope Recovery Case 与 `RecoveryCase.KNOWN_CLOSED`；
no-case disposition 不能被本地确认替代。

## Development outcome / 开发结果

- **受益者** — 在不使用场所资金时验证运行 风险 执行 账户和恢复契约的策略开发者与运营者。
- **可观测结果** — 一个 Paper generation 生成绑定许可的模拟效果 已对账 Portfolio 事实 已结算 Risk liability，以及与 Live 相同的运行回执。
- **未改变伤害** — 友好模拟器可能隐藏风险绕过 伪造成交 重复效果或恢复缺口，并在实盘前制造虚假信心。
- **终态负例** — 风险拒绝不产生效果；应用或效果未知时保持阻断或围栏，任何 Paper 结果或闭合都不授权 Live。

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- 不能因为适配器是模拟的就绕过 Risk。
- Runtime 与 Execution 必须拒绝缺失 `LIVE` 或不匹配的 Governance scope，不能把它重新解释为 `PAPER`。
- 只有授权决定但没有 `APPLIED` 时不得运行；`REJECTED_NO_INSTANCE` 是终态，`APPLICATION_UNKNOWN` 阻止重复应用。
- 裸决定或断裂 Authorization Lineage 不能产生自动模拟意图。application intent permit Effect Journal
  和回读必须保留同一 Autonomous Policy Authorization。
- `ATTENDED_REQUEST` 不能产生 `ACTIVE` `APPLIED` 正常 Paper 新增风险或模拟 adapter 效果；只允许
  decrease-only 暂停 减仓 退役和恢复。
- attended 正常生命周期 de-risk 只有绑定准确当前 Risk `PERMIT_DECREASE_ONLY` 才能触达模拟 adapter。
  Recovery 改为要求准确当前 `ACTIVE` Risk Fence，且动作属于其有界集合；两者都不授权模拟新增风险。
- decrease-only 不创建 Reservation 或 claim，但仍必须产生 `PREPARED`、一个
  `ADAPTER_ADMISSION_REQUEST`、一个不可变 admission result 和最多一个 `INVOCATION_STARTED`。
- Eligibility 丢失或必需保留证据过期时进入 `DE_RISK_PENDING` 并阻止新增模拟风险，同时保留
  decrease-only 暂停 降权和退役。
- Risk 拒绝时不得创建订单命令或 Effect Journal。
- Capacity View 缺失 过期 跨 scope，或经济条件 方法 假设 流动性不匹配时不得 `INITIAL_ACTIVATION`，Risk 必须终态 `REJECT` 且不创建 Reservation。
- Aggregate Commitment Frontier 缺失或过期 序列化尝试过期，或按最坏情况计入 `UNKNOWN_EFFECT` 后容量不足时，Risk 必须终态 `REJECT` 且不创建 Reservation。
- 非 `CONSUMED` claim 不产生 prepared attempt。`SUPPRESSED_BY_FENCE` 或 `REJECTED` admission 不产生调用。响应丢失 重启与重放只加入同一 claim 与 prepared attempt，不能重复调用模拟适配器。
- `SETTLED` 继续保持 held liability，直到一致 Portfolio Risk Evidence Bundle 覆盖同一 settlement
  lineage，并由一次 Risk 序列化转换替换该 liability；权威 claim 前 `WITHDRAWN` 或消费后 `NO_EFFECT`
  可直接释放。
- Runtime 不能伪造成交或账户状态，模拟效果属于 Execution。
- 模拟结果是有用的运行证据，但本身不授权实盘资金。
- Paper `UNKNOWN_EFFECT` 不能由重试 模拟成交或本地确认解除。它必须进入同一 Recovery Case，经过
  Execution-owned case 并绑定活动 Risk fence，在 `KNOWN_CLOSED` 前保持阻断；即使闭合也不能授权 Live 或充当 Live 证据。
- 跨模式 generation 账户或效果命名空间的事实必须先被拒绝，不能更新 Risk Portfolio 或 Governance 反馈。
- 相反模式命名空间别名在重放或重启后仍必须拒绝。
