# Runtime

## 职责

应用 Governance 授权的 generation，消费实时行情事实并产生正常 Trade Intent。Governance 授权不能
证明实例已运行，只有 Runtime 的 Generation Application Receipt 可以证明。Runtime 把 Risk 许可绑定
成订单命令，但不拥有订单 成交 账户效果 Recovery Case 或闭合。

## 拥有的权威事实

- Strategy Instance 身份 generation 治理部署绑定和内部 checkpoint
- Generation Application Receipt，把 Governance 决定 Execution Scope adapter binding Strategy Artifact
  application attempt checkpoint frontier fence epoch 授权模式和完整请求 Authorization Lineage 绑定为
  `APPLIED` `REJECTED_NO_INSTANCE` 或 `APPLICATION_UNKNOWN`；无人值守回执还绑定 Autonomous Policy Authorization
- Trade Intent，绑定准确 generation Execution Scope 行情截面 意图类别 摘要 签发时间 Governance
  决定 授权模式 完整请求 Authorization Lineage，以及无人值守时的当前 Autonomous Policy Authorization
- Runtime Incident Fact 绑定事故身份 generation 影响范围 类别 严重度和共享 Time Evidence。它提交后
  不可变且永不增加 Recovery Case 反向引用；Execution 只在 case 原因集合中记录 incident 身份
- Runtime Readiness Fact，绑定实例 generation checkpoint 影响范围 原因前沿 `READY` 或 `NOT_READY`
  本地抑制回执和 `valid-through`
- **TARGET：** generation-scoped shared-kernel semantic trace 与版本化 strategy checkpoint，绑定准确 Plan、
  Artifact、ordered lifecycle frontier、strategy/plugin state、target、protection 与 fill reconciliation
- Runtime Kernel Repair Result，绑定一个 R&D-owned `native-repair-request`、稳定 correlation、前驱
  `REPAIR_INPUTS` 决定、原始 proof digest、旧 kernel version、决定性证据、repair policy 与新鲜 Time
  Evidence；只有 Runtime 能为该 attempt 提交 `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`

## 模块

- **Strategy Instance** - 运行治理工件 消费行情事实 产生 Trade Intent，并把 Risk 许可绑定为
  Authorized Order Command。Paper 与 Live 使用相同实例语义，只替换 Execution adapter、账户命名空间
  和效果命名空间
- **Readiness Gate** - 先停止本地意图和命令，再提交 `NOT_READY` 并向 Risk 与 Execution 发布准确
  generation checkpoint 影响范围和时间前沿

checkpoint 与 readiness 持久化属于 Runtime 内部关注点，不是第二个可见能力或权威。实现可以变化，
但重启必须加入相同身份并保留以上事实。

## 共享策略生命周期契约

Runtime 只能应用 governed generation 携带的准确 [StrategyDesignV2 共享内核路径](../architecture/strategy-factory.md#strategydesignv2-and-the-shared-lifecycle-kernel)：
`StrategyPlanV2`、内容寻址 Wasm Artifact、Owner binding、`ProgramHost`、lifecycle/checkpoint/kernel/plugin
版本及 Market Semantics Compatibility 身份。只有共享内核能消费全序 `START` `BAR` `EVENT` `FILL`
`TIMER` `STOP` envelope，并拥有 `ENTER` `ADD` `REDUCE` `EXIT` `HOLD`、target position/weight/rebalance、
protection adjustment 和 fill reconciliation。plugin 只能返回其有界 typed value 或 state proposal；它没有
raw-order、Risk、Execution、Portfolio、account 或 external-effect 权威。

在 Paper 与 Live adapter 存在并被另行接纳前，二者等价性均为 **TARGET / NOT_ADMITTED**。获准后，两种
mode 必须消费相同 Plan、Artifact、ordering、checkpoint 与 kernel，并对相同 normalized event prefix 在
Risk/Execution adapter boundary 之前产生相同 semantic trace。只能替换 adapter、account namespace 与
effect namespace。Risk 仍是最终 intent admission，Execution 拥有 order/fill/effect，Portfolio 拥有 position
与 account truth；Runtime 绝不能把 kernel target 或 plugin output 直接提升为 order 或 account state。

## 输入交接

- [Strategy Governance](./strategy-governance/) 提供 generation 特定的 `INITIAL_ACTIVATION` `PROMOTION`
  `REDUCTION` `PAUSE` `RETIREMENT` `DE_RISK` 或 `RECOVERY` 决定、
  Execution Scope、完整请求 Authorization Lineage，以及允许自动意图时的显式 Autonomous Policy
  Authorization 与保留有效期
- [Market Data](./market-data/) 提供当前市场和标的事实
- [Risk](./risk/) 返回终态 Risk Decision 一次性 Reservation decrease-only permit 或消费前终态撤回
- [Execution](./execution/) 返回订单 成交 拒绝 终态回读和对账事实，用于更新实例或声明就绪丢失
- [R&D](./rd/) 只提供冻结的 `RUNTIME_KERNEL` `native-repair-request`，绑定准确前驱决定 correlation proof
  digest 旧 kernel identity 与 source cut policy 和新鲜 Time Evidence。类别 目标 前驱 proof identity cut
  policy 时间错误或含义变化都不创建 attempt 或 result

## 输出交接

- 向 [Risk](./risk/) 提供正常 Trade Intent、decrease-only 生命周期意图、不可变 Runtime Readiness Fact
  与已提交 `runtime-incident-fact`。`RUNTIME_INCIDENT` 通过 `runtime-risk-incident-fence` 把该来源事实
  提交给 Risk；Runtime 永不写由此产生的 Recovery Fence
- 向 [Execution](./execution/) 正常提交 Authorized Order Command；Recovery 只提交实例 checkpoint
  就绪和事故事实，绝不提交 Recovery Command
- 向 [Strategy Governance](./strategy-governance/) 提供 Generation Application Receipt 和可直接读取的
  Runtime Incident Fact；`RecoveryCase.KNOWN_CLOSED` 由 Execution 单独提供
- 向 [R&D](./rd/) 提供已提交且按 generation 划分的 Incident 事实，只能作为后继来源证据。
  该交接不能调节运行中 generation 重开其 Intent 或暴露保护 Qualification 细节
- 向 [R&D](./rd/) 提供准确 request-correlated Runtime Kernel Repair Result。`REPAIRED` 命名新 kernel
  version，且只允许新请求相等 Replay Request，绑定准确 native repair request 与 result、新 kernel
  version、准确前驱 `REPAIR_INPUTS` 决定、`RUNTIME_KERNEL` 类别、稳定 correlation、原始 proof digest、
  前驱与后继 kernel identity 及 source cut，以及未改变的前驱请求语义。只有 `REPAIRED` 允许 re-entry；
  `UNAVAILABLE` 只允许关联 `STOP_INPUT_UNAVAILABLE`；
  `OUTCOME_UNKNOWN` 不允许 stop retry 后继 Artifact Selection 或 Replay Request。投递 接受 静默与
  telemetry 都不是 repair result
- 向 Event Rail 发布已提交事故和就绪变化唤醒提示。通知投递永远不是证据，不能证明就绪 fence
  Recovery Case 闭合或生命周期完成

## 拒绝和禁止事项

- 没有匹配当前 Risk Decision 与 Reservation 或 decrease-only permit 时不发送正常命令
- 匹配 `NOT_READY` 后不再产生新意图或命令；本地停止必须早于事实发布
- Governance 保留决定缺失 过期 撤销 未知或进入 `DE_RISK_PENDING` 时不得产生新意图；无人值守意图在
  Autonomous Policy Authorization 缺失 过期 撤销或不匹配时同样失败关闭。本地停止必须早于确认后继生命周期状态
- 不把 `REDUCTION` `PAUSE` 或 `RETIREMENT` 转换成 add-risk 意图或 Reservation
- 每个 attended decrease-only 生命周期命令都绑定准确 Risk `PERMIT_DECREASE_ONLY`，且只允许撤单 减仓
  清仓或回读；其他命令都不能到达 Execution adapter gate
- 无人值守且已应用的 Artifact 只能从绑定保护退出规则与触发证据产生
  `DECREASE_ONLY_STRATEGY_PROTECTIVE`。它仍是正常 Runtime intent：活动 `RISK_HARD_STOP` fence 会
  抑制它，且它永不授权或替代 Recovery Command
- `ATTENDED_REQUEST` 不得提交 `APPLIED` 不得产生新增风险 Trade Intent，也不得创建正常 Paper 或 Live
  命令。只有 `UNATTENDED_REQUEST_WITH_POLICY` 能驱动 `INITIAL_ACTIVATION` `PROMOTION` 或自动交易；attended 权威
  保持非运行和 decrease-only
- 不拥有订单生命周期 成交 场所效果 账户状态 Reservation 结算 Recovery Command Recovery Case 或 `KNOWN_CLOSED`
- 不从 Governance 状态推断实例运行，不把 `APPLICATION_UNKNOWN` 作为新应用重试
- 不把 `SIMULATOR` 或 `BACKTEST_OPERATIONAL` 当作 Runtime repair，不为含义变化改写 result，也不让
  repair 投递创建 kernel version Research 转换或重试
- Paper 模式不在 Runtime 编造成交或账户状态；所选模拟 Execution Adapter 在 Paper 专用命名空间拥有
  模拟订单与账户效果

## 失败与恢复

就绪丢失时，Runtime 先停止本地意图与命令，再为准确 generation checkpoint Execution Scope Capacity
Scope 原因前沿和时间有效性提交不可变 `NOT_READY`。Risk 根据该事实或其过期独立设共享活动 fence。
Runtime 事故则提交不可变 `runtime-incident-fact`，Runtime 可以保持 `READY`；
`runtime-risk-incident-fence` 把该准确事实提交给 Risk，只有 Risk 能提交匹配的 `RUNTIME_INCIDENT`
Recovery Fence；Execution 只解析独立
`RUNTIME_INCIDENT` Recovery Admission Disposition，只有带匹配活动 fence 的 `RECOVERY_ADMITTED` 才创建
或加入 case，绝不要求或替换 Execution drift 来源。对已接纳 case，
Execution Reconciler 拥有它，生成有界恢复动作，联结场所 Risk Portfolio 终态并独占 `KNOWN_CLOSED`。
Runtime 可以从 checkpoint 重启，但不能解除 fence 闭合 case 或恢复旧 generation；Governance 必须重新决定。

## 决策契约

- **输入** - 一个 Governance generation decision 与 artifact、当前 Market Data、终态 Risk decision 和
  Execution order fill readback 事实。
- **诊断与决定** - 应用或拒绝一个 generation，判断策略条件，生成正常 Trade Intent，绑定授权命令并
  提交 readiness 或 incident fact。
- **冲突解析** - generation checkpoint readiness identity 单调前进；更新 fence 或 lifecycle state 抑制
  旧写入，重复 application 只加入一次。
- **输出与终态负例** - Application Receipt Trade Intent Authorized Order Command readiness incident；
  拒绝 application unknown 与 `NOT_READY` 都不表示运行或成功。
- **反馈与经济意义** - Paper 与 Live 运行同一受治理策略语义并返回解释行为的运行事实，不宣称订单或 PnL。
- **禁止** - 不拥有超出绑定 scope 的 adapter 选择、成交 账户效果 订单生命周期 Reservation 状态
  Recovery 动作 case closure，也不把内部持久化变成独立权威。

## 后续实现验收

- Paper 与 Live 都只有 Strategy Instance 能写正常 Trade Intent
- 每个命令绑定准确当前决定 Reservation 或 decrease-only permit 以及 Execution Scope
- 每个正常命令还必须从 Governance 经 Trade Intent 与 Risk 许可保留来源 request principal scope
  已准入 Shell binding 与 history head Operator Authorization operation manifest 和授权模式；无人值守命令
  还必须保留 Autonomous Policy Authorization
- Paper 与 Live 保持隔离账户和效果命名空间
- 旧 generation 不能越过新 checkpoint 或 readiness frontier 写入
- Runtime 在 `NOT_READY` 前先提交本地抑制；就绪过期不能授权新意图
- Risk 设围栏不依赖 Runtime 确认或 Execution case 转换
- 重启加入相同 application checkpoint readiness 身份，不能创建第二实例
- Runtime 不存在创建 推进 指挥或闭合 Recovery Case 的 API 或状态转换
- Runtime Incident Fact 提交后不改变字节也不增加 case 身份；一个或多个 case 只能从只追加原因集合引用它
- 每个已接纳 `RUNTIME_KERNEL` native repair request 都有一个关联且只写一次的 result。准确 replay 加入
  相同 attempt 与 result；`UNAVAILABLE` 和 `OUTCOME_UNKNOWN` 不创建后继 kernel identity，只有绑定
  result 的 `REPAIRED` 能命名新身份

## 可观测性与持久化

Runtime 持久化 application、Strategy Instance checkpoint、readiness、lifecycle observation 与不可变 Incident fact。Telemetry 覆盖 load/start/stop 时延、heartbeat/readiness、重启、queue pressure、策略 invocation 次数和有界 incident 类别。Dashboard 的 uptime、downtime、running-since、重启次数、applied-generation 次数与使用时长必须从同一 Time Evidence epoch 下准确 application/readiness/incident 区间推导；缺失 heartbeat 不能单独宣告 incident 已解决、generation 已停止或 Recovery 已闭合。
