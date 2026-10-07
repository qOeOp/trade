# Portfolio

## 职责

根据已提交执行事实和市场估值输入投影当前账户 持仓 暴露 表现和容量事实。Portfolio 是产品决策读取的账户真相，不分配资金 不许可交易也不拥有场所效果。

## TARGET - 动态分配的账户事实

目标交易账户专用于产品管理的订单和持仓；充值、提现是账户资金事件，不是策略交易。意外订单/持仓
或缺失归属属于对账证据，Portfolio 计入其真实账户敞口，不编造策略归属。对账与执行归属沿用原生
账户/Execution 路径，不建立第二账本或手工交易管理能力。

估值与保证金读取首先复用 `crates/portfolio/src/portfolio.rs`、原生账户模型和 cache。
当前 target-set Host 仅在单 Margin account/单币种条件下按截面价格手工汇总权益，这不证明通用多币种估值已接通。
扩展须改用原生账户/Portfolio 路径并绑定缺价格、FX 和保证金模型的拒绝，不推广该局部公式为另一个总账。

复用原生账户、cache、事件及估值提供统一新鲜视图。净权益作为 Governance 的分配基数，
账户可用保证金及实际占用作为 Risk 的执行约束；两个量不得混用。账户更新由执行适配器及对账链路接纳，
消费者在资金决策时读取并检查准确版本、时间与 scope，过期或冲突时按现有规则限制新增风险。
不要求每个策略或模块各自调用交易所查余额；需要刷新时走统一适配器路径。Portfolio 不计算策略剩余额度，
不重复扣除已经反映在账户中的订单或 Risk 预留，不建立第二账户账本。

## 拥有的权威事实

- Account State：余额、持仓、保证金、权益与已实现/未实现损益，绑定准确账户命名空间和 Execution Scope。
- Exposure 与 Performance：按账户、资产、策略 generation、方向、币种和窗口投影，绑定原生 Execution 事实、估值/FX、合约精度、实际风险资金、确定计算方法版本与新鲜度。定义变化创建后继版本，不能改写旧回执或混用不同方法/来源截面。
- Capacity Scope：不可变的账户、PAPER/LIVE 模式与经济池身份，不含策略/generation。不可拆分 gross 约束属于同一 key；模式隔离，重叠未知保持不可用。
- Capacity View：候选无关 gross ceiling，绑定账户/抵押品、估值、流动性、方法/假设、维度/单位、测量时间与有效期。
- Portfolio Risk Evidence Bundle：同一 Capacity Scope 的 projected exposure、open order、账户估值与已纳入 settlement lineage 一致截面；不报告 Risk commitment usage 或剩余 headroom。
- 生命周期条件读取所需的准确 Capacity/Performance/Exposure 来源引用。INITIAL_ACTIVATION 不编造表现历史；PROMOTION 消费准确新鲜表现/暴露。

Portfolio 提供可复算事实和明确可用性，科学原因、机制退化与边际价值解释属于 Agent。Governance 仅执行用户冻结的数值或状态条件。默认等分实际运行成员不需要 Interaction Receipt。
旧 `PortfolioInteractionReceipt` / degradation 类别没有类型或 custody；它们不是目标权威。若显式批准条件要求交互度量，输出确定计算、完整成员和方法/来源截面，不从缺失证据推断 NEUTRAL、独立性或机制失败。

## 模块

- **Account State** - 把已提交账户和成交事实与当前估值输入组合为持仓 余额 保证金 损益和权益。
- **Exposure** - 使用当前合约和估值事实投影资产 策略 方向和币种暴露。
- **Performance** - 根据账户事实和明确窗口生成版本化 Performance Receipt，包含收益 回撤 稳定性 实际风险资金 方法 输入截面和新鲜度。
- **Capacity View** - 为 Capacity Scope 投影候选无关的 gross 经济上限。独立 Portfolio Risk Evidence
  Bundle 向 Risk 携带一个一致来源截面。Portfolio 不扣除 Risk Reservation liability，不计算剩余
  headroom，也不分配资金或批准部署。

## 实现状态台账

本台账只记录仓库在本截面实际到达的状态。它沿用 [Market Data](./market-data/) 台账的状态词汇，并以
`CURRENT_PARTIAL` 表示已合并但不可触达的形态；台账本身不授予任何许可。下文标为 `IMPLEMENTATION_ADMITTED` 的行是仅有的已准入切片，均于
2026-09-18 作为有界、可单独评审的工作准入，其验收是一次性 PostgreSQL 证明、有序链路条目在 Linux 上通过，以及不依赖
testkit 或 acceptance feature 的生产路径；其余各行不授予任何东西，扩大准入集必须先修改本文档。

- **CURRENT_PARTIAL / IMPLEMENTATION_ADMITTED - Capacity Scope 契约：**
  `crates/portfolio_owner/src/capacity_scope.rs` 拥有不可信请求词汇、完整注册表解析规则，以及只有该规则能铸造的 sealed
  `BoundCapacityScopeReadback`；公开的 `resolve_capacity_scope` 仍是失败关闭的 `Discovery` 边界。
  `crates/portfolio_owner/src/capacity_scope_postgres.rs` 是生产 Owner store：`portfolio_private` 下的 PostgreSQL
  custody，保存只追加的完整成员普查注册表、其 head、密封回读，以及 Strategy Governance 解析 `BOUND` scope 所经的只读
  `portfolio_api` 函数。一个 cut 一经提交即不可变，重复提交同一普查只加入当前 head。它的 `#[ignore]` 证明对着 canonical
  Owner PostgreSQL 拓扑运行。尚无已部署二进制装配它，所以它没有生产装配根或可触达的消费者。
- **CURRENT_PARTIAL - Portfolio View R0 契约：** `crates/portfolio_owner/src/portfolio_view.rs` 拥有请求指纹、重放
  分类、按来源 Owner 划分的依赖种类，以及返回 `UnavailablePortfolioView` 的失败关闭 `resolve_portfolio_view`；
  不存在正向来源 resolver。`crates/portfolio_owner/tests/portfolio_view_contract.rs` 证明了它。
  `crates/operator_authorization` 里的 `portfolio:view` 资源授权经 Operator Authorization Issuer 的 PostgreSQL
  custody 解析，但没有任何 Product Edge 路由提供 Portfolio View。
- **TARGET - Account State、Exposure、Performance Receipt 与 Exposure Receipt：** `crates/portfolio/src/portfolio.rs`
  与 `crates/portfolio/src/manager.rs` 里继承的 `Portfolio` 为继承的 kernel、Backtest 与 live-node 装配从引擎 cache
  事件计算持仓、余额、保证金与 PnL；它是迁移来源，不绑定 Execution Scope、receipt、估值版本或新鲜度。
- **CURRENT_PARTIAL / IMPLEMENTATION_ADMITTED - Capacity View：** `crates/portfolio_owner/src/capacity_view.rs` 拥有
  密封视图与本切片唯一准入的方法 `paper-collateral-gross-ceiling.v1`：对于与账户抵押品同币种计价的模拟 `PAPER` 资金池，
  gross ceiling 就是该抵押品，且没有流动性约束压缩它。估值是恒等映射，因为两个币种相同；视图为这一声明的流动性输入
  缺席绑定一个显式身份，而不是留空字段。任何其他币种的资金池在 Market Data 估值事实出现前失败关闭。上限来自
  Execution 自己已提交的开仓账户事实，在提交事务内经 Execution Owner 的只读 API 读取，绝不取自调用方声明。
  `crates/portfolio_owner/src/capacity_scope_postgres.rs` 存放这些视图，并暴露 Strategy Governance 重读当前上限所经的
  `portfolio_api` 函数。Portfolio 在此不扣除 Reservation liability，也不计算剩余 headroom。
- **TARGET - Portfolio Risk Evidence Bundle：** 不存在 projected exposure、open order、账户状态与已纳入 settlement
  lineage 的一致来源截面，因此 Risk 没有可与自身 liability 合并的 bundle。
- **未实现：** Portfolio Lifecycle Evidence Receipt 尚无类型或 custody。旧 Portfolio Interaction Receipt 与 degradation 归因也无类型/custody，不是默认分配目标。
- **CURRENT_PARTIAL - 通向 Governance 的读 port：** Owner 自己的迁移
  `crates/portfolio_owner/src/capacity_scope_postgres.rs` 建出 `portfolio_api.read_bound_capacity_scope_v1` 与
  `portfolio_api.read_current_capacity_view_v1`，并把两者都授给 `governance_writer`；该 schema 的 `USAGE` 也只授给
  它，在 `database/postgres-init/10-migrate-authority-custody.sh` 里。所以第二个消费方需要的是分处两地
  的两条授权，两者都不是还没写出来的函数。
- **TARGET - 其余交接与持久化：** 没有通向 Risk、Scanner、Execution 或 Product Edge 的 port；除上述 Capacity Scope
  注册表与 PAPER Capacity View custody 之外，没有任何 Portfolio 事实的持久关系。

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
- 向 [Strategy Governance](./strategy-governance/) 提供账户净权益、准确 Capacity View、实际运行成员占用及新鲜 Performance/Exposure，供已批准池比例和等分政策使用。新成员只在全部已有占用适合缩小后的份额时加入；分配由 Governance 原子提交。仅显式批准的交互敏感条件要求确定交互度量，不要求科学分类回执。
- 旧兼容交接向 [Scanner](./scanner/) 提供只作为提案提示的有界 Capacity View；保留旧回执，不新建定时发现或部署路线。
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

- **输入**：一致截面的 Execution 账户、订单、成交、费用、settlement/readback，以及 Market Data 估值、FX、合约与流动性。
- **计算**：复用原生 Portfolio/cache，产出有版本的账户、表现、暴露和 gross 容量；Portfolio 判断事实可用性，不判断科学原因、资金或交易权限。
- **冲突**：来源事实优先于本地投影；混合截面、过期输入、未解析重叠或估值冲突返回 PARTIAL/STALE/UNAVAILABLE/INCOMPLETE_FAIL_CLOSED。
- **消费者**：Agent 解释研究含义，Governance 执行已批准条件，Risk 结合自己的真实 liability 计算 headroom。恢复投影不宣布 Recovery Case 闭合。

## 后续实现验收

- 持仓、余额、损益与指标可复算并解析到准确 Execution、Market Data、估值与方法版本；账户、generation、窗口和 PAPER/LIVE 命名空间不混合。
- Portfolio View 绑定 trusted principal、授权范围、一致来源截面及 valid-through；跨账户、过期、含义冲突或缺来源拒绝，不合成权限或 Risk headroom。
- Capacity Scope 保留账户/mode/经济池、共享约束和维度单位；Capacity View 是 gross 上限，Risk bundle 对已纳入 settlement lineage 恰好计一次，不扣除 Risk liability。
- INITIAL_ACTIVATION 要求兼容新鲜容量，PROMOTION 另需准确新鲜表现/暴露；容量缺失不能阻止 PAUSE/REDUCTION/RETIREMENT 或真实仓位保护。
- 默认等分消费已批准池比例、实际运行成员与占用；新成员加入前证明已有占用均适合缩小份额，Governance 原子分配。不强制 Interaction 分类或 degradation 根因。
- 显式交互条件只消费其声明的确定计算和完整来源；缺失、模糊或混合证据不可当作中性或独立，解释不能创建资金/交易许可。
- 来源账户/估值未知时恢复投影不可用，不声明真实 liability 已闭合。

## 可观测性与持久化

按准确 account/scope/mode/time cut 保管原生账户事实及绑定估值和方法的 Performance、Exposure、Capacity 与条件计算引用。Telemetry 记录投影时延、来源新鲜度及缺口；图表引用底层事实，不创建科学归因、资金决定、生命周期权限或 Risk 容量证明。
