# Portfolio

## 职责

根据已提交执行事实和市场估值输入投影当前账户 持仓 暴露 表现和容量事实。Portfolio 是产品决策读取的账户真相，不分配资金 不许可交易也不拥有场所效果。

## 拥有的权威事实

- Account State 包含余额 持仓 保证金 权益 已实现和未实现损益，并绑定一个 Execution Scope 和账户命名空间。
- 按账户 资产 策略 方向 币种和相关风险维度划分的 Exposure。
- 按策略 generation 和治理窗口生成的 Performance Receipt，绑定准确 Execution Scope、Execution 与账户事实截面 估值与方法版本 实际风险资金和新鲜度。
- 按策略 generation 生成的 Exposure Receipt，绑定准确 Execution Scope、账户与暴露事实截面 估值与方法版本 暴露维度 限额上下文和新鲜度。
- Portfolio Lifecycle Evidence Receipt 绑定目标 Execution Scope 准确 Capacity View，以及转换需要时的 Performance Receipt 与 Exposure Receipt 身份。每个来源字段必须匹配对应命名空间；`INITIAL_ACTIVATION` 只要求兼容容量且不编造表现历史，`PROMOTION` 还要求按其 `PROMOTION` transition-evidence key 绑定准确且新鲜的表现与暴露证据。
- 不可变 Capacity Scope 身份只包含一个账户 一个 `PAPER` 或 `LIVE` 模式和一个经济资金池，绝不包含策略或 generation。所有共享且不可拆分的 gross 约束必须映射到同一个 key；Paper 与 Live key 隔离，重叠关系未知时必须不可用而不能猜测互不重叠。
- Capacity View 绑定该 Capacity Scope、准确账户与抵押品事实截面 估值版本 流动性输入截面 候选无关的资金池方法与假设版本 各维度与单位的 gross ceiling 测量时间和有效期。
- Portfolio Risk Evidence Bundle 绑定同一 Capacity Scope，以及 projected exposure open order 账户状态
  估值和所有已纳入 Execution settlement lineage 的一致截面。它只报告事实，不报告 Risk commitment
  usage 或剩余 headroom。
- Portfolio Interaction Receipt 绑定准确完整 contender set，以及共同 Capacity Scope 估值 方法 假设
  来源和 Time Evidence 截面。receipt 状态为 `CURRENT` `INSUFFICIENT` `STALE` 或 `AMBIGUOUS`；按唯一
  版本化 classification policy，每个 contender 准确取得 `DIVERSIFYING` `NEUTRAL` `CONCENTRATING`
  或 `UNDETERMINED` 之一，并绑定决定性相关性 集中度 方向 尾部 分散与边际价值证据。Portfolio 只报告
  事实，不排序 contender 也不分配资金。
- Portfolio Lifecycle Evidence Receipt 同时是 Portfolio 唯一的 degradation 归因权威。收益衰减 回撤
  暴露集中 滑点或估值丢失只是症状，不是根因。不利回执绑定准确 generation benchmark 与测量窗口、
  决定性 Performance Exposure Capacity 行情 估值 Execution fee slippage 与 capital-at-risk 证据截面、
  方法 政策 阈值和共享 Time Evidence。
- 归因状态为：`RESOLVED_ONE` 表示只有一个有独立证据支持的具名类别；`RESOLVED_MANY` 表示至少两个
  分别有决定性证据支持的具名类别；`UNRESOLVED` 只能携带 `MULTI_CAUSE_UNRESOLVED` 和完整但无法隔离
  的证据集；非不利转换用带明确依据的 `NOT_APPLICABLE`。具名类别为
  `STRATEGY_MECHANISM_DEGRADATION` `MARKET_REGIME_CHANGE` `EXECUTION_QUALITY_DEGRADATION`
  `DATA_QUALITY_DEGRADATION` `CAPACITY_OR_LIQUIDITY_COMPRESSION` `PORTFOLIO_INTERACTION_DEGRADATION`
  `VALUATION_UNCERTAINTY`。Portfolio 不丢弃第二个已受支持原因，也不选择方便的策略叙事。

每个具名原因都必须在同一准确 generation、Execution Scope、Capacity Scope、account、valuation、
source-frontier 与 Time Evidence common cut 上取得原生来源事实支持：

| 原因                                | 必需来源权威与决定性证据                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRATEGY_MECHANISM_DEGRADATION`    | R&D Research Intent 加 Portfolio Performance Receipt：冻结 prediction 与 falsifier 对照 performance deviation，并保留分别有证据支持的 regime data execution capacity interaction valuation 替代原因。 |
| `MARKET_REGIME_CHANGE`              | Market Data PIT Snapshot 与 Valuation Facts 加 Portfolio Performance Receipt：版本化 regime‑boundary membership 与匹配 response，不能只凭后续修订或执行症状。                                         |
| `EXECUTION_QUALITY_DEGRADATION`     | Execution Account Fact 加 Portfolio Performance Receipt：完整非 `NONE_OBSERVED` category set、逐类别决定性证据及同一 effect frontier 的 performance impact。                                          |
| `DATA_QUALITY_DEGRADATION`          | Market Data PIT Snapshot 加 Portfolio Performance Receipt：Owner‑owned gap correction rights 或 PIT semantic defect 及有界受影响 performance lineage。                                                |
| `CAPACITY_OR_LIQUIDITY_COMPRESSION` | 同一 methodology policy threshold 版本下的 Portfolio Capacity View、Market Data Valuation Facts、Performance Receipt 与 Exposure Receipt。                                                            |
| `PORTFOLIO_INTERACTION_DEGRADATION` | 完整 contender set 及其 marginal impact 的当前 Portfolio Interaction、Performance 与 Exposure Receipt。                                                                                               |
| `VALUATION_UNCERTAINTY`             | Market Data Valuation Facts 加 Portfolio Performance 与 Exposure Receipt：显式 uncertainty state methodology source frontier 与有界影响。                                                             |

证据缺失 过期 混合截面 不受支持或无法隔离时提交 `UNRESOLVED`，绝不挑选最方便的具名原因。每个分别
受支持且同时存在的具名原因都保留在唯一 supported category set 中，并带自己的证据。
`MULTI_CAUSE_UNRESOLVED` 是互斥状态，只表示完整但无法隔离的证据集，不能与具名原因共存。

- `PORTFOLIO_INTERACTION_DEGRADATION` 还必须绑定同一 Capacity Scope 完整 contender set 估值与方法截面
  及共享 Time Evidence 的准确 `CURRENT` Portfolio Interaction Receipt。交互证据缺失 过期 模糊或不匹配
  时只能为 `UNRESOLVED`。交互与决定无关时，生命周期回执记录明确 no-interaction-dependency 依据，且
  该依据不能与声称的交互退化原因共存。
- `EXECUTION_QUALITY_DEGRADATION` 还必须绑定同一 generation Execution Scope Capacity Scope effect
  namespace 政策 source frontier 与 Time Evidence 截面的准确当前非 `NONE_OBSERVED` Execution Quality
  Observation。观察缺失 过期 不匹配 不可用或为 `NONE_OBSERVED` 时只能支持 `UNRESOLVED`，不能归因
  为执行质量退化。

## 模块

- **Account State** - 把已提交账户和成交事实与当前估值输入组合为持仓 余额 保证金 损益和权益。
- **Exposure** - 使用当前合约和估值事实投影资产 策略 方向和币种暴露。
- **Performance** - 根据账户事实和明确窗口生成版本化 Performance Receipt，包含收益 回撤 稳定性 实际风险资金 方法 输入截面和新鲜度。
- **Capacity View** - 为 Capacity Scope 投影候选无关的 gross 经济上限。独立 Portfolio Risk Evidence
  Bundle 向 Risk 携带一个一致来源截面。Portfolio 不扣除 Risk Reservation liability，不计算剩余
  headroom，也不分配资金或批准部署。

## 输入交接

- [Execution](./execution/) 提供订单 成交 费用 账户和已对账场所回读事实。
- [Market Data](./market-data/) 提供价格 汇率 合约规格 估值事实和带身份流动性来源截面。

## 输出交接

- 在任何 Paper 或 Live Execution Scope 建立前，向 [Strategy Governance](./strategy-governance/) 提供唯一
  不可变 `BOUND` Capacity Scope，绑定准确账户命名空间 mode 经济池与不相交共享约束证明。缺失 过期
  重叠 跨 mode 或成员未知时，不创建 Execution Scope 或 Capital Envelope。
- 向 [Risk](./risk/) 提供同一 Capacity Scope 的当前 gross-ceiling Capacity View 与 Portfolio Risk
  Evidence Bundle。bundle 携带一致的 projected exposure open order 账户估值截面和已纳入的
  Execution settlement lineage。Portfolio 不读取 Risk 状态也不扣除 Reservation commitment；只有
  Risk 把 bundle 与自身 liability 合并并计算剩余 headroom。
- 向 [Strategy Governance](./strategy-governance/) 提供绑定兼容 Capacity View 的 Portfolio Lifecycle Evidence Receipt；`PROMOTION` 还按 `PROMOTION` transition-evidence key 绑定准确且新鲜的 Performance 与 Exposure 回执。
- 向 [Strategy Governance](./strategy-governance/) 为每个集合 Capital Allocation Disposition 提供一个
  Portfolio Interaction Receipt，并用同一 Portfolio Lifecycle Evidence Receipt 提供生命周期归因。
  Governance 拥有 contender 排序和生命周期动作，Portfolio 只提供一致来源事实与归因。
- 向 [Scanner](./scanner/) 提供只作为提案提示的有界 Capacity View。
- 恢复期间向 [Execution](./execution/) 提供 Recovery Case 所需已对账账户闭合投影。
- 向 Product Edge 提供一个有界 Portfolio View，绑定稳定请求 trusted principal 授权账户与 Execution Scope 授权政策截面和 Portfolio
  快照截面以及投影和 valid-through 时间。它以 `AVAILABLE` `INCOMPLETE_FAIL_CLOSED` `STALE` 或 `UNAVAILABLE` 报告账户 暴露 表现和容量投影，
  并携带来源事实引用与新鲜度；永不报告 Risk Reservation 状态 剩余 headroom Risk Decision 或部署交易权限。

## 拒绝和禁止事项

- 必要价格 汇率或合约条款不可用时不编造估值。
- 不分配资金 不维护 Aggregate Commitment Frontier，不从 Capacity View 扣除 open order 或 Reservation liability，不激活策略 不签发 Risk Decision 也不创建订单命令。
- Execution 已提交事实到达前不把本地订单意图视为账户效果。
- 不合并 Paper 与 Live 账户或效果命名空间，也不把跨 scope 事实用于 Risk 或 Governance 反馈。
- 不为资金池选择 generation 或策略特定经济条件。部署配置先准入不可变的账户 mode 经济池
  数据源和适配器绑定；Portfolio 由此派生候选无关 Capacity Scope 并发布 gross ceiling，之后
  Governance 才能把 generation 绑定到该 scope。generation 特定经济条件只属于 Qualification
  证据与 Governance Capital Envelope。
- 不宣布 Recovery Case 闭合，只提供其中一个必要闭合投影。
- contender 交互事实不可用时，不从单个策略表现推断边际价值；原因未解析时不把 degradation 强行
  归为机制失败。来源截面缺失或冲突时只能生成 unavailable 或 unresolved 回执。
- 不把缺失或含糊交互证据改成 `NEUTRAL`，也不把不完整执行观察改成 `NONE_OBSERVED` 或
  `EXECUTION_QUALITY_DEGRADATION`。

## 失败与恢复

估值输入缺失或过期时，受影响指标明确显示不可用，不能静默沿用误导值。账户投影与场所回读不一致属于对账漂移。恢复期间 Portfolio 根据已对账 Execution 事实和当前估值输入重新计算，返回闭合投影但不恢复交易。

## 决策契约

- **输入** - 同一一致截面上的 Execution 账户 订单 成交 fee settlement readback 事实，以及当前 Market
  Data 估值 FX 合约和流动性事实。
- **诊断与决定** - 投影账户 暴露 表现 容量 交互和 degradation；Portfolio 只决定事实可用性和归因状态，
  不决定资金或交易权限。
- **冲突解析** - 来源 Owner 事实和最新一致截面高于本地投影；截面混合 重叠未解析或估值冲突时保持不可用。
- **输出与终态负例** - 版本化回执或 `PARTIAL` `STALE` `UNAVAILABLE`
  `INCOMPLETE_FAIL_CLOSED` 和带准确缺失原因的 unresolved attribution。
- **反馈与经济意义** - 展示真实 PnL 暴露 边际组合价值 容量压缩和 degradation，让 Governance 根据
  经济事实分配或退出资金。
- **禁止** - 不拥有场所效果 资金分配 Risk 剩余 headroom 许可 生命周期转换 订单或 Recovery 闭合。

## 后续实现验收

- 每个持仓 余额和损益都能解析到已提交 Execution 事实和明确估值输入。
- 每个 Portfolio View 都能解析到 trusted principal 有权读取的账户与 Execution Scope 授权政策截面和一个一致 Portfolio
  快照截面与 valid-through 时间。来源截面缺失或混合时保持 `INCOMPLETE_FAIL_CLOSED` 或 `UNAVAILABLE`，视图不能从 Portfolio 事实合成
  Risk headroom 或任何授权。
- 跨 principal 账户 mode 过期政策或含义冲突的稳定读取请求必须拒绝且不返回视图。
- 每个账户 暴露 表现和生命周期回执都保留准确 generation 模式 账户命名空间和来源效果命名空间。
- 价格 汇率 合约或账户事实变化时当前暴露同步变化且可见新鲜度。
- Capacity View 与 Governance Capital Envelope 链、Risk Aggregate Commitment Frontier 和许可清楚区分：它是 Portfolio 拥有的 gross 上限，不是剩余 headroom。
- 每个 Portfolio Risk Evidence Bundle 都是一个 Capacity Scope 的一致来源截面，并且每条已纳入
  Execution settlement lineage 只出现一次；延迟或部分 bundle 不得与其他截面拼接，只能标记不可用。
- `AVAILABLE` Capacity View 必须证明不可变的账户加模式经济池 Capacity Scope、各维度与单位的 gross ceiling 及全部来源输入。scope 含策略或 generation、Paper 与 Live 混用、共享约束重叠未解析，或任一输入缺失 部分 过期 不可用 不匹配时，都不能支持 Scanner 必需匹配 Governance 新增风险转换或 Risk 允许决定。
- Performance 明确为 `AVAILABLE` `PARTIAL` `UNAVAILABLE` 或 `STALE`；只有来源完整且新鲜的回执可以支持 `PROMOTION`。
- `INITIAL_ACTIVATION` 要求新鲜兼容 Capacity View，但不编造表现历史。`PROMOTION` 还按其 `PROMOTION` evidence key 要求新鲜准确 Performance 与 Exposure 回执。容量证据缺失不能阻止 `PAUSE` `REDUCTION` 或 `RETIREMENT`。
- Performance Receipt 来自不同 generation、Execution Scope、测量窗口、Execution 或账户截面、估值版本或方法版本时，生命周期回执不能为 `AVAILABLE`，不得拼接不同事实前沿或 Paper 与 Live 命名空间。
- Performance Receipt 的实际风险资金或新鲜度不匹配，或 Exposure Receipt 的 generation、Execution Scope、事实截面、估值或方法版本、暴露维度、限额上下文或新鲜度不匹配时，生命周期回执同样不能为 `AVAILABLE`。
- 受影响账户或估值事实未知时恢复不能闭合。
- 每个集合资金分配都读取 contender set 和截面相同的完整 Portfolio Interaction Receipt；成员缺失
  估值前沿混合或重叠未解析时，不能当作互相独立的容量。
- `CURRENT` Interaction Receipt 中每个 contender 都只有一个版本化 interaction class 与决定性证据
  截面。证据缺失 重复 过期 mixed-cut 或不可隔离时为 `UNDETERMINED`，不能静默成为 NEUTRAL；相同
  集合重排保留身份，成员改变则创建后继。
- 每个 degradation 结论只由 Portfolio Lifecycle Evidence Receipt 携带，并追溯到准确来源截面和归因
  状态。`RESOLVED_ONE` 只有一个受支持类别，`RESOLVED_MANY` 保留每个分别受支持类别，`UNRESOLVED`
  不能转换成确定的 Governance 原因。
- 每个具名 degradation category 都证明其类别专属来源 Owner object 和决定性证据位于同一
  generation/scope/account/valuation/frontier/time cut。原因缺失 混合或不受支持时为 `UNRESOLVED`；
  同时受支持的原因保持集合，不能按优先级压成一个。
- 同一表现症状可以对应不同受支持原因。执行质量恶化需要匹配当前非 none Execution observation，市场状态变化需要带身份
  Market Data 事实，机制退化还要排除这些替代解释；仅观察到回撤不能证明其中任何一个。

## 可观测性与持久化

Portfolio 在准确 account/scope/mode/time cut 下持久化绑定 valuation 的 account state、Performance、Exposure、Capacity、Interaction、attribution 与 lifecycle-evidence receipt。Telemetry 记录 projection 时延、来源新鲜度、valuation gap、归因完整性与有界 degradation category。Dashboard 的 PnL、drawdown、exposure、capacity、interaction 与策略时长视图必须引用底层 receipt 与 freshness；观测 telemetry 或图表趋势不能创建 attribution、资金决定、生命周期变化或 Risk capacity proof。
