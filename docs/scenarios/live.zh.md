# 实盘自动交易场景

实盘把受治理策略信号自动转换为场所效果，不为每笔订单请求人工批准。预先批准的生命周期政策、
独立交易前风控、许可绑定、Execution 权威、场所回读、对账和恢复共同约束风险暴露并让效果可追责，
但不保证最大实际亏损。

## Entry / 入口

Strategy Governance 以生效资金政策为实盘模式授权具有资格的策略 generation，但不启动 Runtime。所需行情、账户、
风控、执行、对账和恢复事实都可用。该决定绑定一个使用场所账户和效果命名空间的 `LIVE` Execution Scope。
`INITIAL_ACTIVATION` 还绑定包含新鲜候选无关 gross Capacity View 的 Portfolio Lifecycle Evidence
Receipt；它必须兼容预先存在 Capacity Scope。后续 `PROMOTION` 还要求按 `PROMOTION`
transition-evidence key 绑定新鲜准确 Performance 与 Exposure 回执。
自动产生意图前 Runtime 提交 `APPLIED` Generation Application Receipt，把唯一 Strategy Instance 和
checkpoint 绑定到该决定 generation scope 工件 fence epoch 完整请求 Authorization Lineage 与显式
Autonomous Policy Authorization。该 policy 才允许有界无人值守意图，裸 Governance 决定不能授权。
`INITIAL_ACTIVATION` `PROMOTION` `APPLIED` 以及正常自动 Live 新增风险或场所效果都要求
`UNATTENDED_REQUEST_WITH_POLICY`。`ATTENDED_REQUEST` 只能处于未运行和 decrease-only 状态；除非未来
另行定义独立 attended-effect 契约，否则不能进入 Live。

## Value path / 价值路径

Strategy Instance 消费实时 Market Data，并在策略条件成立时自动生成 Trade Intent。Risk 对每个意图
返回明确拒绝终态，或决定与一次性预留。Runtime 把获准许可绑定进订单命令。Execution 验证同一绑定并
提交一个稳定 Reservation Claim Request。只有 Risk `CONSUMED` 才允许 Execution 记录一个 `PREPARED` attempt
再发送 `ADAPTER_ADMISSION_REQUEST`。Risk 在与 recovery fence activation 排序的同一 frontier mutation 中提交唯一
不可变 admission result；只有 `ADMITTED_ONCE` 允许 `INVOCATION_STARTED` 并触达场所适配器。
Execution 随后写入订单生命周期 回读外部效果并完成对账。Execution 向 Risk 回报结算事实，
向 Portfolio 回报账户事实。Risk 独占 Reservation 状态迁移，Portfolio 独占账户投影更新。
request principal scope 已准入 Shell binding 与 history head Operator Authorization operation manifest
和 Autonomous Policy Authorization 必须在 Governance 决定 Runtime 意图 Risk 许可 Execution Effect
Journal 与场所回读中保持完全一致。

正常 decrease-only Live 工作使用独立准确路径：Governance 决定 → Runtime 本地停止 → Risk
`PERMIT_DECREASE_ONLY` → Reservation/claim 明确为空的命令 → Execution `PREPARED` →
`ADAPTER_ADMISSION_REQUEST` → Risk `ADMITTED_ONCE` 或终态抑制/拒绝。只有 `ADMITTED_ONCE` 允许
`INVOCATION_STARTED` 并触达场所适配器。该路径没有 Reservation Claim Result 或 `CONSUMED`，但
preparation 和同 frontier fence arbitration 仍为必需门禁。

## Owner handoffs / Owner 交接

Governance 授权激活并控制 Risk 政策；Portfolio 向 Governance 提供必需容量与生命周期证据。Runtime 向 Governance 与 Product Edge 返回唯一能证明实际
应用结果的 Generation Application Receipt。Market Data 向 Runtime 与 Portfolio 提供事实。Portfolio 向 Risk
提供准确候选无关 gross Capacity View 与一致 Portfolio Risk Evidence Bundle。其不可变 Capacity Scope
是账户加 `LIVE` 模式加经济资金池，不含策略或 generation。Risk 在同 scope 唯一 Aggregate Commitment
Frontier 上持久序列化每个新增风险决定，usage 按经济 lineage 合并该 bundle 与 held Reservation liability。
Runtime → Risk → Runtime 交换意图与许可。Runtime → Execution 发送授权命令。
Execution → Risk 依次请求 Reservation claim 与 adapter admission 并回报 settlement lineage，Risk → Execution 返回唯一不可变 claim 与 admission result，Execution → Runtime 回报订单 成交 拒绝 回读和对账事实，
Execution → Portfolio 回报账户 订单 成交 费用和场所事实。Risk 闭合 Reservation 状态，Portfolio
更新投影并 → Governance 闭合反馈。

## Proof / 证明

证明从绑定唯一 Strategy Instance 的 `APPLIED` Generation Application Receipt 开始，并包括与授权命令关联的场所回读、仅新增风险具有的 Risk-owned Reservation Claim Result、每个 Adapter Admission Result、`PREPARED` 及准入后的 `INVOCATION_STARTED` record、Effect Journal、订单与预留终态、完成的对账、一致的 Portfolio
账户投影，以及能归因到同一策略 generation 和准确 `LIVE` 账户及效果命名空间的生命周期反馈。

## Development outcome / 开发结果

- **受益者** — 需要无人值守交易同时约束风险暴露和风险预算 归因外部效果并获得可审计反馈的资金负责人和运营者。
- **可观测结果** — 每个实盘信号终止于明确 Risk 拒绝，或唯一绑定许可的场所尝试，且回读 账户投影 liability 结算和生命周期反馈共享准确身份。
- **未改变伤害** — 重复或未授权场所效果 过期容量 无法解释的 PnL 和不安全生命周期晋级可能在没有唯一负责人的情况下累积。
- **终态负例** — 事实缺失或过期 Risk 拒绝 admission 被抑制 应用未知或效果未知都不产生新增风险成功，并保持阻断或进入 Recovery。

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- 行情 账户 资格 政策 Capacity View 或许可事实缺失或过期时，依赖订单必须停止。scope 经济条件 方法 假设 流动性或有效期不匹配时 Risk 必须终态 `REJECT` 且不创建 Reservation。
- Aggregate Commitment Frontier 缺失或过期 序列化尝试过期，或按最坏情况计入 `UNKNOWN_EFFECT` 后容量不足时，Risk 必须终态 `REJECT` 且不创建 Reservation。
- Governance 已授权但 Runtime 未提交 `APPLIED` 时不存在运行策略；`APPLICATION_UNKNOWN` 阻止重复应用与自动意图。
- Eligibility 过期 撤销，或必需 Performance Exposure degradation 证据过期时，Governance 必须提交
  `DE_RISK_PENDING`。Runtime 立即停止新意图且 Risk 拒绝新增风险；容量或表现证据缺失不能阻断
  decrease-only 暂停 降权或退役。
- Authorization Lineage 或 Autonomous Policy Authorization 缺失 过期 撤销或不匹配时，必须在创建
  Reservation 前阻止依赖意图。
- `ATTENDED_REQUEST` 不能产生 `ACTIVE` `APPLIED` 正常 Live 新增风险或场所效果；只允许
  decrease-only 暂停 减仓 退役和恢复。
- attended 正常生命周期 de-risk 只有绑定准确当前 Risk `PERMIT_DECREASE_ONLY` 才能触达场所 adapter。
  Recovery 改为要求准确当前 `ACTIVE` Risk Fence，且动作属于其有界集合；两者都不授权场所新增风险。
- decrease-only 不创建 Reservation 或 claim，但仍必须产生 `PREPARED`、一个
  `ADAPTER_ADMISSION_REQUEST`、一个不可变 admission result 和最多一个 `INVOCATION_STARTED`。
- Risk 不能下单，Execution 不能接受未绑定、过期、不匹配或已消费的许可。
- 非 `CONSUMED` claim 不产生 prepared attempt。`SUPPRESSED_BY_FENCE` 或 `REJECTED` admission 不触达场所适配器。响应丢失 重启和重放只加入同一 claim 与 prepared attempt，不能重复调用。
- `SETTLED` 继续保持 held liability，直到一致 Portfolio Risk Evidence Bundle 覆盖同一 settlement
  lineage，并由一次 Risk 序列化转换替换；权威 claim 前 `WITHDRAWN` 或消费后 `NO_EFFECT` 可直接释放。
- Runtime 不能把发送成功或本地确认当成外部成功，场所回读才拥有外部事实。
- Runtime 就绪丢失在本地停止后发布 `NOT_READY`，并独立激活 Risk fence。`RUNTIME_INCIDENT` 只绑定准确
  `runtime-incident-fact`，`RECONCILIATION_DRIFT` 只绑定准确
  `reconciliation-drift-fact`；两者分别先取得自己的 Execution-owned Recovery Admission
  Disposition，任一单独分支都不要求另一来源，两者同时准入时加入同一 case。只有带匹配活动 fence 的
  `RECOVERY_ADMITTED` 才允许 Reconciler 创建或加入 case 并记录 `FENCED_OPEN`，
  `NO_RECOVERY_REQUIRED` 与 `UNRESOLVED_NO_CASE` 不创建 case 或 command。
- Paper 或不匹配的 generation 账户 效果 政策或 Portfolio 事实截面不能授权或更新 Live 状态。
- 相反模式命名空间别名在重放或重启后仍必须拒绝。
