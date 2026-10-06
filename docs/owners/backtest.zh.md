# Backtest

## 职责

使用接纳的历史事实和生产等价交易语义重放冻结策略工件。Backtest 拥有重放实际消费了什么以及发生了什么，不决定结果是否可部署。

## 能力对照与 MCP 范围

对照分开记录 Nautilus 原生基础、仓库产品扩展与当前 MCP 可达能力。
原生接入以本仓库 Rust 源码为依据，上游 latest 文档补充能力发现；不把上游 API、某项测试或工具名
当成当前产品装配、部署或端到端交付证明。

| 功能                   | Nautilus 原生基础                                                          | 产品扩展与当前 MCP                                                      | 范围判断                                                                   |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 历史事件回放           | BacktestEngine、模拟场所、时钟、事件排序与原生交易组件                     | `run` 经产品编排提交；原生执行取决于 feature 与服务装配                 | 原生已有引擎；提交被记录或 replay 被封存不等于完成执行                     |
| Catalog 数据加载与分片 | BacktestNode 配置、标的加载、oneshot/streaming                             | 当前入口解析 Market Data PIT custody；没有通用 catalog 配置入口         | 复用原生加载；产品增加准确版本与消费绑定                                   |
| 策略输入               | 原生 Strategy/Actor 生命周期与组件注册                                     | 当前 MCP 使用已入目录的单一 `strategy_id`，产品编写与 Host 提供受限映射 | 原生策略包封存属于 R&D；Backtest 校验并运行已冻结工件，不另建策略语言      |
| 多标的与多策略         | 多标的事件流、`add_strategies` 与共享原生账户                              | 当前 `run` 请求只有一个标的和一个策略；内部 target set 可含多标的       | 多标的策略不等于独立策略组合；组合 MCP 流程尚未交付                        |
| 挂单与退出             | 原生 OrderFactory、OMS、订单命令/事件、GTD、contingent 和 reduce_only 基础 | 当前 target adapter 固定 NETTING，按截面价格发 GTC limit                | R-1 的冻结目标价、条件撤单、按笔保护及分段退出仍需原生策略接入与验收       |
| 撮合与流动性假设       | bar/trade/book 撮合、部分成交与 Fill 模型                                  | MCP 无完整模型选择与配置绑定入口                                        | 复用原生撮合；模型名称存在不保证适合输入或已被本次运行采用                 |
| 费用、滑点与延迟       | Fee、Fill、Latency 模型                                                    | 当前六字段请求未暴露这些配置，后端路径存在自身约束                      | 产品封存明确选择和实际使用配置；不新增平行成本模型                         |
| 余额、保证金与持仓     | 原生账户、Margin 模型、Portfolio、RiskEngine                               | 当前 Host 路径限制单 venue Margin account、NETTING                      | 原生拥有交易事实；账户池分配与研究场景政策属于产品扩展                     |
| 资金费结算             | SimulatedExchange 处理 FundingRateUpdate 与结算边界                        | 产品有数据与结果基础；当前 MCP 请求不能表达完整资金费计划               | 需要证明完整 schedule 接入、账户变动和报告一致；不另写资金费账本           |
| 执行算法               | `add_exec_algorithm` / `add_exec_algorithms` 及原生算法接口                | 当前 MCP 无算法配置入口                                                 | 原生已有，按研究需要接入并绑定算法版本与参数                               |
| K 线内成交顺序         | bar OHLC 路径；可按距离选择高低先后；细事件可直接回放                      | 当前 MCP 无完整细化计划入口                                             | 原生路径是启发式，不能声称恢复真实顺序或自动向数据服务取数                 |
| 歧义细化与后继运行     | 原生可重放更细数据，有 reset/重新运行能力                                  | 产品目标是外部准备新输入后完整后继重放；一分钟保守政策未据此证明已执行  | 两边没有直接满足本产品的完整自动流程；扩展调度与原生政策，不写第二个撮合器 |
| 运行身份与结果托管     | 原生 run/result 与统计基础                                                 | 产品有请求登记、同身份冲突检查、冻结/准入、attempt 与结果 custody       | 产品增加可接管的研究证据；是否成功须看实际终态与结果                       |
| 报告与绩效             | 原生结果、analysis 统计、订单/成交/持仓/账户事实                           | 有 OwnerBacktestReportV1 转换；当前 MCP `report` 对已记录运行统一拒绝   | 计算基础已有，MCP 报告读取尚未交付，不能以拒绝工具算报告完成               |
| 回测任务与恢复         | 原生重复运行、streaming 和状态操作                                         | `status` 读已记录请求/答案，`list` 列出运行；`run` 当前请求内编排       | 完整后台任务、取消、未知结果恢复和预算接管流程仍有整合缺口                 |
| 组合资金与成员变更     | 原生共享账户、多策略、风险与事件时间线                                     | 产品已有组合/分配目标，当前单策略 MCP 不支持完整配置                    | 两边都未提供本产品试盘/正式池、等待加入和成员退出预案的完整历史流程        |
| 参数实验、比较与资格   | 原生重复运行、配置与结果提供基础                                           | Agent 比较实验，R&D 保存记录；Qualification 独立评价资格                | Backtest 提供冻结运行和事实，不拥有研究搜索、策略排名或上线决定            |

**当前 MCP 四工具。** `run`、`status`、`list` 已有后端操作路径；`report` 有协议与路由，
但已记录运行仍统一返回 `RUN_HAS_NO_RESULT`。`run` 只有六个请求字段：运行身份、策略身份、
标的、执行周期和窗口起止；没有独立组合成员、账户分配、执行算法或成本模型配置字段。
原生执行还受 `composer-v3-replay`、`native-replay-execution` 和后端服务可用性约束，
不能把编排接纳、封存成功或输入 custody 签发当成结果完成。

### MCP 目标功能集

保留一个 Backtest MCP，按用户故事提供以下候选能力；具体工具名与结构在契约层确定。

1. **准入检查**：检查冻结工件、数据绑定、场所/账户/OMS、模型和执行政策的支持范围，返回具名缺口。
2. **提交回放**：提交单策略或版本化组合的冻结运行；复用原生引擎与相同的交易语义。
3. **任务查询与控制**：查询、列出、取消运行并恢复原任务身份；区分运行停止、结果未定与实际完成。
4. **结果与报告**：返回不可变结果引用及有界报告，保留订单、成交、拒绝、成本、账户与策略归属事实。
5. **重放与后继运行**：用准确旧绑定复现；细化输入或变更配置时创建有谱系的新运行，不覆盖旧证据。

Admission、Replay、Results、Reports 是同一服务内的职责，任务控制不新增独立部门。
外部 Agent 组织各次实验、选择参数、比较结果并决定下一轮；R&D 保存实验及决定。
Backtest 在预算内排队并执行已提交的冻结运行，不展开参数搜索、不自动排名或挑选下一组参数。
多个运行可并行执行，每个保留独立身份与结果；服务端排队不引入研究判断。保护评估归 Qualification；
数据准备归 Market Data。Backtest 不调用实盘效果来模拟历史，不在撮合途中调用 MCP 补数。

### 接入证据与限制

当前入口：`services/backtest-mcp/src/lib.rs` → `backtest_run_routes.rs` →
`backtest_run_v1.rs` 的 R&D 编排 → 条件装配的 `NativeReplayExecutionServiceV2`。
共享 API 装配根不把回测事实的所有权移给 R&D，也不要求每个逻辑服务拆成独立进程。

原生证据见 `crates/backtest/src/engine.rs`、`node.rs`、`config.rs`、`exchange.rs`
与 `crates/execution/src/models/`；当前 Host 映射见
`crates/strategy_factory/src/program_host_backtest_target_set_v2.rs`，报告转换见
`crates/strategy_factory/src/owner_backtest_report_v1.rs`。
`get_backtest_run_report` 的实际响应和 `execute_committed_replay_v1` 的条件分支优先于陈旧源码注释。
上游能力参考 [Backtesting](https://nautilustrader.io/docs/latest/concepts/backtesting/)、
[Bar execution](https://nautilustrader.io/docs/latest/concepts/backtesting/bar-execution/) 与
[Accounts and margin](https://nautilustrader.io/docs/latest/concepts/backtesting/accounts-and-margin/)。

## 原生回测接入与能力边界

### 原生运行准入与输入映射

Backtest 扩展原生 `BacktestEngine`。 封存清单绑定原生 Strategy 包、算法、Instrument、OMS/account/book 类型、
初始余额、Fee/Fill/Latency/Margin 模型、GTD/contingent/reduce-only/position-ID 支持、bar execution/路径政策、 Risk
配置、随机种子及数据排序。 经济评估不能隐式 bypass 原生 RiskEngine；不支持的组合先拒绝，不另写撮合器。

原生 `add_strategies` / `add_exec_algorithm` 执行注册，产品增加封存、授权、输入解析与报告托管。 catalog 驱动运行优先复用 `BacktestNode`
的配置校验、标的加载和 oneshot/streaming 路径， 通过其 engine 接入 Strategy/算法；不为准备任务重写历史读取与分片器。 配置忽略构建错误时，成功返回不证明所有 engine 已建好。

当前 `program_host_backtest_target_set_v2.rs` 固定 NETTING、单 venue Margin account，按截面价格创建 GTC limit。 `Position` /
`WeightMicros` 是净目标数量/权重，不是冻结挂单价、保证金比例或止损风险比例。 `backtest_run_v1.rs` 接收一个 `strategy_id`；多标的 target
set 不等于多个独立策略组合。

R-1 使用原生 Strategy 的 `OrderFactory` 和命令，绑定精确 `Price` / `Quantity`、
原始目标价、GTD/条件撤单、按笔保护、部分成交数量和 reduce-only 分段退出。 原生 cache、事件与 OMS 管理实际状态；不更改已有字段含义，也不强塞进当前净目标适配器。

`crates/backtest/src/exchange.rs` 已处理 `FundingRateUpdate` 与资金费结算边界。
产品须接入 Market Data 准入的完整结算序列并核对账户/报告；来源记录器或 schedule 值类型不证明接线完成。
结算成本与策略当时可见的 funding 输入分别绑定，不另写资金费现金账本。

### 成交顺序与数据后继

原生 `bar_adaptive_high_low_ordering` 按开盘到高低点的距离选择 OHLC/OLHC，不能证明真实先后。 细数据按冻结计划回放；每个区间只选一条推动撮合的行情路径，粗信号 K
与细成交流分角色，不能重复推动场所价格。 流式分片保留完整相同 `ts_init` 批次。 Market Data 在回放外准备细数据，后继绑定默认从完整初始状态重放。 原生
`reset`、策略状态或账户快照不是完整回滚点；只有证明 clock、cache、订单/持仓/账户、算法、定时器 和模型状态全部恢复一致才允许续跑。

一分钟仍不明时，已确认政策为止损/止盈冲突取止损优先，入场/止盈先后不明取入场后持仓。 原生路径启发式不实现这一含义；须通过原生扩展及验收，未接通时返回顺序未决，不能声称该政策已执行。

## TARGET - 资金与执行政策的一致回放

规模政策没有默认模板。请求须绑定明确选择的模板/参数或准确冻结配置引用；缺少选择时拒绝准入，
不按策略类型或引擎默认补齐。相同冻结配置的重放保留原选择，不要求每次信号或重跑再次交互选择。

回测收益绑定策略版本及完整的账户/部署环境：初始账户、成员及加入时间/规则、两池政策、规模模板与参数、
杠杆/保证金/估值、Risk 限额和预留、退出及执行政策，以及已声明的外部资金流。单策略诊断与部署组合结果
分别标明运行环境，不把独立且资金充足的策略曲线当作共享账户可达收益。

产品控制的分配、规模、等待准入和风控决定，须在历史时钟下复用相同版本的领域政策与原生 Runtime/Risk/Execution/Portfolio
路径；使用封存数据、模拟场所与事实适配器，不启动真实 Governance 效果，不从回放调用生产 MCP/API，
也不另写一套简化资金或订单引擎。异步账户/事件的到达顺序在回放中明确建模；同代码不保证实盘事件顺序相同。
改变资金/规模/组合配置得到新封存运行及证据绑定，旧资格不能被默认为覆盖任意配置。

报告保留信号意图、请求数量、实际接纳数量、风险拒绝/排队原因、模拟成交、费用及账户路径，
用相同数据与冻结对照说明资金/执行政策如何影响结果。拒绝的信号不能记作已成交盈利交易。
未知未来充值、用户上下架、网络故障或订单簿排队位置不能从历史价格推知；无事件数据的情形须声明情景假设。
滑点、延迟、流动性/成交、跳空和资金变化按预登记情景做敏感性/压力回放，报告不可建模的缺口，不声称收益预测精确。

真实试盘保留当时数据、政策与账户/订单事件，可在隔离的历史任务中重放同一观察区间，按信号、规模、准入、
时序、成交及成本定位偏差。诊断既保留实际事实也保留模拟结果，不覆盖旧证据或用未来事实修饰事前回测。
部署资格只能使用实际被评估且证据有效的环境；详细覆盖与判定门槛须冻结。相关原生边界见
[Nautilus 回测与实盘差异](https://nautilustrader.io/docs/latest/concepts/live/#backtest-and-live-differences)。

## TARGET - 组合回放

组合回放覆盖试盘达标但正式池占用阻塞：策略继续按试盘政策产生订单和盈亏，正式接纳后才转换两池成员与分配。
等待中的试盘交易真实影响后续占用与净值，不提前使用正式额度或重置证据。

回放输入支持独立版本成员集合及封存的共同账户/分配/风险配置。用原生多策略注册、共享账户和事件时间线执行，
不得把成员分别跑完再拼接收益。每个订单、成交、拒绝和持仓保留准确成员/实例归属，报告账户整体表现及成员贡献，
并绑定资金竞争、保证金、成本和实际分配状态。成员需求由 Market Data 统一准备，策略不负责跨成员取数或资金调度。
现有单策略入口须扩展后验收；原生 `add_strategies` 或已有多腿 Artifact 本身不证明产品组合入口已经可用。

组合回放还须支持冻结的成员加入与分配转换政策：新成员等待所有受影响占用满足后继额度，
再在同一账户时间线上切换，等待期间保留旧分配。验收同时覆盖可立即加入、有效挂单/预留阻塞、
条件刚满足却被旧版本订单改变，以及权益变化后重新计算额度；不把尚未启动的等待者当成已经运行。

仓位政策比较应复用原生固定风险计算作为基线，按封存的分数凯利估计/更新规则提供规模输入。
只在当时可得数据上更新，不能用全期胜率回填历史订单；报告资金占用、回撤及同时亏损的账户路径。
凯利建议与 Risk/执行实际接纳数量分别保留，不把理论规模当作模拟成交或部署权限。

回放还须覆盖等待中的试盘策略不再满足当前转正条件：重新达标前不取得正式额度；最长观察期已经结束时
停止新入场、撤未成交入场单并退回 R&D，已有持仓继续按原保护退出。当前仍达标的容量等待者继续留在试盘。

预先验证的成员退出预案须在同一连续账户时间线上回放：两个成员运行、任一停止新入场并撤入场单但
旧持仓仍受保护、剩余成员按批准后继分配继续运行。保留真实预留、费用与残余占用；下架不能让锁定资金消失。
不能重置净值或拼接单独终态回测代替转换过程，报告绑定准确预案与状态/转换覆盖，供 Qualification 与 Governance 消费。

## TARGET - 研究报告与多腿回放

报告是原生结果的有界投影，不建立第二份成交账本。复用原生 Portfolio/分析器的组合、持仓和费用事实，
绑定估值采样、收益单位、成本和对照版本，提供逐交易卡、配对变体差异、事件发生率/首次触碰等研究诊断。
非交易事件研究明确不产生交易净值或资格；冻结评估所用统计方法与参数。
Agent 复用原生统计或自己的分析工具计算跨运行估计并作判断；R&D 保存方法版本、输入引用与结论。Backtest 不选择胜者或判断稳定优势，也不新增通用脚本解释器。
原生统计输入不足时返回具名缺口，不把已平仓收益替代完整组合表现。零交易、未平仓和部分覆盖分别陈述。

一个双腿/配对 Artifact 绑定每腿标的、数量/对冲关系、报价/结算币、保证金模式和资金来源， 并冻结触发及分腿执行/撤销规则。 Backtest 复用原生订单、场所与账户，报告每腿真实模拟成交顺序、费用、资金费、
保证金、净敞口与未对冲时长；现货资金和永续保证金不能各自复用同一笔可用资金。 市场没有原子成交保证，不能以同一根 K 的价格假造双腿同时成功。 部分腿成交、拒绝、未知或离场时，
按冻结执行政策处理未成交单和已成交敞口，策略不会负责网络重试。 政策必须声明允许的未对冲敞口/期限、 停止新增与退出动作；缺政策或必要标的/成本/资金事实则不准入该实验，不使用隐式默认值。

回放按一条账户时间线推进，多腿资金与风险仍统一核算。 此目标尚需 Strategy/执行政策与账户接线验收， 不因原生存在多场所或多订单类型就声明完整双腿故事可用。

验收复现同冻结输入的单腿和双腿对照、资金费结算、第二腿拒绝/部分成交/未知、手续费与汇率，
再核对组合报告与原生账户事实。保护任务使用独立凭据、缓存和输出空间；诊断不能成为保护信息出口。

## 拥有的权威事实

- 重放身份 确定性时钟 冻结输入 运行与模拟版本和配置摘要。
- 重放产生的规范订单 成交 持仓 成本和结果。
- **CURRENT_PARTIAL：** 完整有序 shared-kernel semantic trace，把 normalized lifecycle event、checkpoint、primitive
  与 plugin result、target/protection transition 和 fill reconciliation 绑定到规范 replay。
- **TARGET：** 一次重放的逐条件决策普查，把每个决策分支谓词绑定到三样东西：它的输入按冻结时的目录可用性规则
  首次满足的那一拍、请求区间在那一拍之后留给它的可求值拍数、以及它的结果在这些拍上的有序游程。尚不可求值的
  谓词绝不被记成为假的谓词，普查还说明是哪条规则与哪个窗口让它不可求值，而不只说它不可求值。它是有界的：
  结果翻转频率超过普查容量的谓词退化为计数并把已退化这件事记下来，而不是截断成一段声称结果不再变化的游程。
  它与语义轨迹同构，封印在规范 Result 之旁而不在其中，因此 Result 保持它自己的相等证明所需的大小。
- 探索运行与 Qualification 请求的保护运行之间的完整隔离。
- Exploratory Run Result 逐项重复实际消费的 Strategy Artifact 请求 PIT 范围 PIT Market Snapshot
  Universe Selection Record 与修订规则 重放配置 Runtime 内核 模拟器 成本 滑点和容量模型身份，
  让 Research 校验请求与结果完全相等。
- 每个终态探索结果都按绑定 diagnostic-policy 版本提交一个完整有限 `diagnosticCategorySet`。支持成员为
  `NO_EXECUTION_DEFECT` `MARKET_DATA` `ARTIFACT` `RUNTIME_KERNEL` `BACKTEST_OPERATIONAL` `SIMULATOR`
  `REPLAY_CONFIGURATION` `VALID_ECONOMIC_FAILURE` 和 `UNRESOLVED_FAILURE`。所有分别有证据支持且同时
  出现的类别都必须保留，并分别绑定决定性证据截面。`NO_EXECUTION_DEFECT` 不能与缺陷类别共存；含糊
  或无法隔离的证据必须为 `UNRESOLVED_FAILURE`，不能猜测缺陷或经济结果。
- `BACKTEST_OPERATIONAL` 绑定准确 operational-profile 身份与版本、run-attempt 身份、runner/service
  readiness、backpressure、resource exhaustion 或 outage 证据及新鲜 Time Evidence。它是 Backtest 在
  Native Replay 服务边界拥有的 operational diagnosis，不是 Runtime kernel 或 Sim Exchange/Simulator
  缺陷；未修复或排除前禁止经济解释。
- 保护重放身份在执行前绑定准确 Strategy Artifact、请求 PIT 范围、PIT Market Snapshot 与 Universe
  Selection Record 身份与摘要、calendar/session/time-zone、corporate-action 与历史 membership cut、Market
  Semantics Compatibility 身份、快照与修订规则、重放配置摘要、Runtime 内核、simulator 成本 滑点
  容量模型版本，以及准确 Candidate/Intake 保护决策政策身份与版本。它还在任何保护观测前重复冻结
  Protected Robustness Plan 身份 必需单元身份 指标集 覆盖规则 容差 阈值 聚合 缺失单元和停止政策。
- Protected Run Result 逐项重复保护请求对应的实际消费字段与保护政策 pair，并要求请求与结果完全相等。
  它声明 `PROTECTED_EVALUATION` 为规范 `timeEvidenceCutKind`，直接绑定 request Time Evidence，并为准确
  request、attempt、plan 与 plan cell 密封 result-stage clock cut。
- Backtest Repair Result 绑定一个 R&D-owned `native-repair-request`、准确 `SIMULATOR` 或
  `BACKTEST_OPERATIONAL` 类别、前驱 repair decision、稳定 correlation、原始 proof digest、类别专属旧
  identity 与 source cut、repair policy、决定性证据和新鲜 Time Evidence；只有 Backtest 能为该 attempt
  提交 `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`。

## 模块

- **Native Replay** - 使用确定性时间重放历史事件，并在适用处复用原生 Runtime Risk 和订单语义。
- **Sim Exchange** - 模拟场所接纳 延迟 成交 手续费和账户效果，不产生外部写入。
- **Run Result** - 把实际消费的数据 工件 配置 订单 成交 成本和终态结果绑定为规范回执。

## 实现状态台账

本台账只记录仓库在本截面实际到达的状态。它沿用 [Market Data](./market-data/) 台账的状态词汇，并以
`CURRENT_PARTIAL` 表示已合并但不可触达的形态；台账本身不授予任何许可。下文没有任何一行标为
`IMPLEMENTATION_ADMITTED`：各行不授予任何东西，扩大准入集必须先修改本文档。

- **CURRENT_PARTIAL - 有序 shared-kernel semantic trace：** 有序词汇与其失败关闭的普查位于
  `crates/backtest_owner_contracts/src/native_replay_trace.rs`，生产方与 Backtest Owner 双方都在封印 trace
  字节之前施加该普查，因此跳过 checkpoint、重复一次生命周期或留下未对账原生成交的 trace 是一个 fault，
  什么都提交不了。只有一条纵向到达它：Sim `EVENT` 消费者是该普查在自身模块之外的唯一调用方，没有第二条
  纵向产出 trace。
- **CURRENT_PARTIAL - 持久 Result custody 与 R&D 加锁读：** 有序链路证明了什么见同名小节。
  `crates/backtest_owner/Cargo.toml` 与 `crates/backtest_result_custody/Cargo.toml` 都没有声明
  `[features]` 表，因此这条 custody 路径在任何构建里都是同一份代码。
- **CURRENT_PARTIAL - 向 Product Edge 提供的探索 Run Result 视图：** Dashboard 读 API 通过
  `resolve_exploratory_replay_result_v2` 解析准确的规范 Result 字节，它位于
  `crates/strategy_factory_rd_owner_api/src/dashboard_read_api.rs`，且只对其 TrialFamily census 已计数的 Result
  这样做（[R&D](./rd/)，「CURRENT - 每个已提交的探索性 Result 都被计数」）。`product/rd-workbench/Dockerfile.owner`
  构建并安装该二进制。有序链路以 `replay_result_dashboard_read_api_refuses_a_result_no_census_counts` 覆盖拒绝，
  以 `backtest_run_report_browser_acceptance_reads_the_owner_answer` 覆盖已计数的 Result 经已部署的读 API 被打开。
  这是 Backtest 唯一一条在已部署产物里端到端可触达的输出交接。
- **CURRENT_PARTIAL - 探索重放的生产入口：** 重放本身已实现并已证明，而已部署产物里没有任何东西能进入它。
  `run_exploratory_replay_v2` 在自身 crate 之外恰有一个调用方，即
  `crates/strategy_factory_rd_owner_api/src/exploratory_replay.rs`，而该调用方位于
  生产 feature `#[cfg(feature = "native-replay-execution")]` 之下；镜像构建
  `--bin strategy-factory-rd-owner-api` 时只带 `--features composer-v3-replay`。这量的是部署产物，不是历史。另一条公开
  提交路径 `commit_exploratory_replay_result_v2` 的调用方只存在于
  `crates/backtest_owner/src/lib.rs` 的 `#[cfg(test)]` 模块内。
- **CURRENT_PARTIAL - 保护观测：** Backtest 从它自己执行的那次运行的规范结果派生出观测，现在也能得知为那次
  运行冻结的是哪一个观测：`derive_protected_economic_measurement_v1` 从规范 Result 字节计算并封印它，而
  `ResolvedProtectedReplayRequestSetV1::economic_computation` 从请求集所携带的那个 bundle 解析出指标与覆盖
  规则，因此调用方只能选择一个已发布的计算，描述不出任何计算。剩下的缺口在两者的上游。生产代码不构造
  `ProtectedEconomicPolicyBundleV1`，它的构造点全都位于 `#[cfg(test)]` 模块之内；而把它封印进请求集的
  那一步只被有序门禁自己的条目调用、此外没有调用方，这一点 [Qualification](./qualification/) 已为该终端的
  每一步写明。Backtest 能选出那个计算，而门禁之外没有东西产出那项选择。
- **CURRENT_PARTIAL - 各决策条件的首个可求值拍：** 推导已存在，而没有任何重放产出它。
  `crates/strategy_factory/src/condition_readiness_derivation_v1.rs` 里的
  `derive_condition_readiness_census_v1` 读一份冻结程序的图与决策表，逐条件返回：其闭包中每个输入
  都满足冻结时可用性规则的首个拍、定下该拍的那条规则、以及施加它的那个节点。它从已发布的目录读取
  每条规则，而不是从节点参数去推断，因此一个带着周期却并不为此等待的原语不会被算成在等待。
  它的调用方只有它自己的证明。
- **CURRENT_PARTIAL - 一次重放的可读经济结果：** V4 BAR joined cut 的消费方在确定性回执之外，一并返回该次
  运行的规范结果；`crates/strategy_factory/src/owner_backtest_report_v1.rs` 里的 `OwnerBacktestReportV1`
  把那份结果读成这次运行的成交、收益序列、净收益与最大回撤。最大回撤是算出来的而不是读出来的：默认的
  `PortfolioAnalyzer` 注册了二十个统计量，`MaxDrawdown` 不在其中，因此没有任何规范结果携带它；报告用同一个
  统计量从收益序列算出它，而不是再写一份它的实现。当一次运行没有记录任何收益时，净收益与最大回撤是缺席而
  不是零，于是「取不到的数」与「挣到的零」保持可区分。有序链路为
  `owner_postgres_v4_moves_through_program_host_and_real_backtest` 打印这份报告，而该条目只喂一根 BAR，
  因此报告的是一次什么都没成交的运行。没有生产调用方读这份报告，也没有任何 Owner 消费它；
  下文 Dashboard 的运行报告交接从已提交托管中读它。
- **TARGET - 保护经济测量的生产驱动方：**
  `derive_protected_economic_measurement_v1` 与 `produce_and_commit_protected_replay_result_v3` 都是完整实现，
  且都没有生产调用方；而这是被写下来的设计，不是缺口：[Qualification](./qualification/)
  陈述了谁可以驱动一次保护评估，也陈述了有序闸门是 eligibility 终态的唯一驱动方。因此建一个生产驱动方，
  等于改掉那份文档陈述的一条界限，需要先取得用户授权。本行刻意不重复那条界限的措辞，因为同一事实的第二份副本
  会在只改一处时漂掉；去那里读它。有两件事值得记在这里，免得将来的驱动方重新发现：
  `crates/backtest_owner/src/protected_replay.rs` 里的校验器会拒绝这样一个结果：它的格子可适用且不带执行缺陷，
  却没有随附一份封印测量，所以测量是前置条件而不是附加物；以及探索路径是分开的，
  因此这里的任何一条都不阻塞一份探索 Run Result 报告。
- **TARGET - `REPAIR_VALIDATION` 请求与结果：** 不存在任何实现。`REPAIR_VALIDATION` 与
  `RepairValidation` 不出现在 `crates/` 或 `product/` 下的任何文件里。
- **TARGET - `SIMULATOR` 与 `BACKTEST_OPERATIONAL` 原生 repair：** 不存在 Backtest 的 repair 面。四个 Backtest
  crate 里 `repair` 的全部出现都是 `crates/backtest_owner/src/postgres.rs` 里记录 custody 永不被修复的注释；
  `BACKTEST_RUNNER_SERVICE` 不出现在任何 Rust 文件里，而
  `product/dashboard/lib/rd-iteration-timeline-client.ts` 已经把它列为合法修复目标。消费侧词汇存在，生产方
  不存在。
- **TARGET - 探索性匹配入场对照与聚类区间：** 没有任何探索性 Result 带匹配入场对照或区间，也没有任何探索性回放累计资金
  费。契约见下文同名一节。
- **TARGET - Forward Replay：** 尚不存在 Forward Replay。Forward Replay 在 Qualification Forward Record 的每个新观察到的
  cut 上，按登记的确切 Runtime kernel、模拟器、成本、滑点与容量身份增量回放一个冻结的 Artifact。挂单与未平仓位在 Backtest
  的托管中从一个 cut 延续到下一个 cut，成交只能来自订单存在之后观察到的数据。它使用受保护回放所用的同一个 Sim Exchange，
  从不使用另一套前向实现，不产生任何 Execution 效果，也不声称修复 Runtime kernel 或 Simulator。

## 原生策略与实际消费证据

Backtest 加载准确[原生策略包](../architecture/strategy-factory/#strategy-package-and-content-identity)、环境、参数和 Owner 输入绑定。
原生 Engine/Strategy 处理生命周期和订单命令，Sim Exchange 产生模拟接纳、成交、拒绝与账户效果；不运行产品策略解释器。

Backtest 保存实际事件序列、命令、成交、保护变化、账户、费用和终态结果，不决定它们的研究或部署意义。
多时间尺寸、动态成员、多腿或多策略都必须记录实际消费的有序数据版本/帧，不能用单帧或单策略证据冒充完整运行。

实际消费记录只能由 Backtest 在执行时产生。调用者/R&D 可以提出请求，不能提供或反序列化构造消费侧证明。
结果绑定策略包、参数、依赖/环境、输入回执与 cut、配置、原生 engine/simulator 身份、费用/滑点/容量模型、seed、窗口、日历/时区和事件/结果摘要。
缺失或不匹配不生成正向回执；两个 caller DTO 相等不能证明请求被执行。

当前 ProgramHost/Plan 回执是已有实现的兼容读回，不是目标原生包加载证据。迁移保留实际输入核验、Owner 密封读回及不可变结果，不能换名后省略检查。

### CURRENT_PARTIAL - 持久 Result custody 与 R&D 锁定读取

Backtest Owner 拥有私有规范 Result 表及其只追加 outbox，且只有 Backtest writer 可以执行 DML。

固定的 `SECURITY DEFINER` `owner_api` 锁定读取函数 `resolve_exploratory_replay_result_v2/v3` 已经存在，有序 PostgreSQL 链路已证明正向锁定
readback、function source 漂移、Owner API 兄弟例程、裸表 ACL 漂移、继承 owner 成员关系与 owner 属性漂移的拒绝、拓扑围栏序列化、提交中途回滚、restart 逐字节一致
readback，以及 R&D 只读访问 （`scripts/ci/test-rd-owner-postgres.bash` 中测试名以 `postgres_result_` 开头的那些 `vibe-backtest-owner`
条目；`postgres_protected_result_` 那条有意不在其中）。

Backtest 仍是 Result fact 的唯一权威， Protected Result custody 继续隔离，不能通过该 R&D seam 读取。

Backtest Owner 暴露一个固定、使用安全 `search_path` 的 `SECURITY DEFINER` `owner_api` 锁定读取函数。 其全限定读取在
caller 已开启的 PostgreSQL transaction 内锁定准确 Result、receipt 与 outbox row，并返回 不受信任 envelope。 locator 或
dependency-neutral contract 只是查询，不携带任何 Result 权威。

目标 dependency-neutral `vibe-backtest-result-custody` adapter 只有在校验 schema、function 与 table owner、已安装 function
source、`SECURITY DEFINER` 设置、table 与 function ACL、规范 Result bytes 与 digest、request correlation、Backtest
receipt 及 outbox binding 后，才能构造不可伪造的正向 readback。

它只接受 caller 提供的 transaction；另开 pool 或 transaction 所得 readback 不能用于 R&D decision。

该设计保留无环 crate 方向 `vibe-strategy-factory -> vibe-backtest-result-custody -> vibe-backtest-owner-contracts`：custody adapter 不依赖 `vibe-backtest-owner`，而 `vibe-backtest-owner` 保留
Result 构造与写权威。 custody 缺失、过期、跨来源拼接、 owner 错误、function 错误、ACL 不匹配、非规范、digest 不匹配、receipt/outbox 不完整或由独立
transaction 读取时都为 `UNAVAILABLE`。

response loss 后，准确 `RESOLVE` 只能返回同一份既存且逐字节相同的 Backtest Result 与 receipt；不能创建首次 custody、重新组合
result，或追加第二份 Result、receipt 或 outbox event。 已在该 disposable PostgreSQL 证明上准入；它仍不授予 Dashboard 实现、deployment、
production write、provider effect、Paper、Live 或交易权威。

同一接缝列出一个请求的 Result。 `read_exploratory_replay_result_directory_v1` 接收请求身份及其 meaning digest， 是第五个 `owner_api`
函数：固定、safe-`search_path`、`SECURITY DEFINER` 且 `STABLE`，只有 `rd_owner` 可执行，
并由与其余函数相同的 topology census 钉住。

每一项陈述 `attempt_identity`、`result_identity`、`terminal` 与 receipt 上的 `committed_at_epoch_ms`，按该时间、再按
attempt 排序。 Backtest 不保存 attempt 表，所以一个 attempt 只以一份 终态 Result 的形式出现在这里：仍在途的 attempt，或在产生任何 Result 之前就失败的
attempt，归 R&D 陈述；被拒的运行 以其自身的 terminal 照常列出。 目录要么完整，要么什么都不给。

某个列出的 Result 缺 receipt 或 outbox event 时，整次读取 以 `EXPLORATORY_RECEIPT_ABSENT` 或 `EXPLORATORY_OUTBOX_ABSENT` 拒绝，而不是列出比事实少的
Result；adapter 还核对 每一项的 receipt 与 outbox 陈述的是同一请求、meaning digest 与 Result。 Backtest 在某请求下不持有任何 Result 时答
`EXPLORATORY_REQUEST_RESULTS_ABSENT`，读作空目录：Backtest 没有请求表，所以分不清未知的请求与尚无 Result 的请求。

同一请求身份下存在另一 meaning digest 的 Result 时，读取以 `EXPLORATORY_REQUEST_MEANING_MISMATCH` 拒绝；超过 256 份 Result 时以 `EXPLORATORY_REQUEST_RESULTS_EXCEED_BOUND` 拒绝。
该读取不取行锁：它在 `READ ONLY` 事务中运行，只持有 `AccessShareLock` 与每次 Backtest 读取都会取的 topology fence。 它只陈述哪些
Result 存在及其 terminal，从不陈述报告 能否被陈述，那仍是报告读取的判断；它也不列出任何 Protected Result。

## TARGET - 探索性匹配入场对照与聚类区间

本节陈述的是一份尚无实现的契约；它不授予构建或部署其中任何部分的许可。

探索性 Result 在运行自身的成交之外，还带一个匹配入场对照，以及运行相对于它的优势的按日期聚类区间。两者都是探索性度量。
它们都不出现在受保护路径上，那里适用 Qualification 的同宇宙随机对照与 holdout，它们也不取代后者。

- **匹配入场。** 对运行成交的每一笔入场，Backtest 在同一标的上回放 20 笔入场，入场 bar 从同一日历年中、留得下时间限制的
  bar 里随机抽取，与策略的信号无关。每一笔取该入场的方向，在其 bar 的开盘价入场，并保持该入场的几何：止损在入场前一根 bar
  上测得的平均真实波幅的同一倍数处，目标在该风险的同一倍数处，时间限制相同。抽取的种子由请求身份派生，所以请求方不选择
  任何东西，同一请求的重放抽到同样的入场。一笔入场的对照值是其 20 笔匹配入场结果的均值。没有止损的入场没有风险单位，
  不配对照；Result 如实报告这一点，而不是把它丢掉。
- **同一模拟器、同一经济。** 匹配入场与该入场自身的成交一样，经过运行的模拟器及其成本、滑点与容量模型；对永续合约，
  还计入持仓期间累积的资金费。不计资金费的对照不是永续成交的对照。
- **区间。** 运行的优势是各入场结果减去其对照值、以该入场风险为单位的均值。其区间用整周日历重抽样的 bootstrap 计算，
  请求写明按日时则按整个日历日重抽样，使不同标的在同一些日子里的入场一起移动。Result 记录聚类单位、重抽样次数、置信
  水平与种子。按日期聚类是有意的选择：按标的聚类会把同一周里不同标的的入场当作相互独立，得到的区间过窄。
- **是对照，不是选择依据。** 对照说明运行的入场是否胜过同样形状的随机入场。它不给任何东西排序：没有任何 Iteration
  Decision 据它选择或排列候选，它也从不替代 Qualification 的 holdout 或同宇宙随机对照。

它依赖探索性回放尚未做到的事：目前没有任何探索性回放累计永续资金费，所以成本模型须先承载来自 Market Data 的资金费事实
（Binance 公开资金费档案是已获授权的部署来源）；带出场的运行还需要多帧回放。

## 输入交接

- R&D 经 typed 向下端口传入完整封存 Exploratory Replay Request 值，绑定请求身份、规范含义/摘要、Artifact、PIT 范围、Intent、成本/滑点/容量及执行模型。上层边界在接纳前解析生产者托管；Backtest 检查自身准确输入绑定/当前适用性并记录 attempt/result，不反读 R&D。缺失、陈旧、冲突或未知输入保留具名无尝试/未决含义，不缺省、虚构或替换字段。

**定位符协议兼容。** 下述已有解析规则只保留封存请求/回执含义；反向读取 R&D 是迁移责任，不是目标分层例外。迁移将规范解析移到上层准入边界，仍保留准确字节、稳定截面、摘要相等、未知/零写入及同身份恢复：

- [R&D](./rd/) 提交一个冻结 Exploratory Replay Request，由一个 R&D 拥有的定位符寻址，该定位符携带请求身份
  规范请求含义摘要 回执身份与封存摘要。Backtest 通过固定的只读 R&D Owner 端口重新解析该定位符，并在读取任何
  其他字段之前先用摘要校验规范请求字节；一个定位符标签 一份下游证言 或调用方自带的字节副本都不是该请求。
  该请求固定准确不可变 Artifact 请求的 PIT 数据范围 重放配置 其 Research Intent 冻结的同一成本 滑点与容量
  模型版本，以及一个正向终态结果必须逐项核对的请求含义的其余每个组成部分。Backtest 在 R&D 一侧可能观察到
  `AVAILABLE` `STALE` 或 `UNAVAILABLE`；只有 `AVAILABLE` 准入一次尝试，而 `STALE` 与 `UNAVAILABLE` 都不是对
  请求的拒绝，它们只说明该 Owner 当前无法供给。解析不到任何东西的定位符 摘要不符的字节 同一身份下含义已变的
  请求 以及不作答的 R&D 端口，都不产生尝试也不产生结果：沉默绝不是 `UNAVAILABLE`，而 `UNAVAILABLE` 也绝不是
  一个终态重放结果。Backtest 绝不重建 缺省或替换任何被请求的组成部分，绝不把两份调用方自撰表示之间的相等
  当作请求与结果的相关性，也绝不为一份它自己没有校验过规范字节的请求开始尝试。
- 已接纳 `D1_EXECUTABLE_REPAIR` 时，R&D 提交独立 `REPAIR_VALIDATION` request，绑定 D-only repair
  admission、前驱与后继 Artifact、defect oracle、完整 non-defect regression corpus、冻结语义相等证明
  和确定 event/signal/intent/order trace comparison。它既不是探索请求也不是保护请求。
- [Qualification](./qualification/) 发送只在 `ADMITTED` intake 和 holdout 预留后创建的保护请求，冻结
  全部执行身份及准确 Candidate/Intake 保护政策 pair。每个请求处理一个已声明 Protected Robustness
  Plan 单元或准确冻结有界矩阵，Backtest 不能在观察结果后挑选单元；接入拒绝仍必须提交绑定同一请求的 `RUN_REJECTED` 结果。
- [Market Data](./market-data/) 提供一次重放所消费的冻结 PIT 事实与标的条款：PIT Market Snapshot 身份与摘要
  Universe Selection Record 身份与摘要 快照与更正规则 公司行动与历史成员截面 Market Semantics Compatibility
  身份，以及逐标的的密封事实摘要 回执摘要与条款摘要，连同场所 报价与结算币种 有效期窗口 保证金模型与费用
  条款。Backtest 以 Owner 密封回执的形式消费它们；它不查询存储 不挑选切片 也不接受调用方自带的夹具来顶替。
  一份回执要么对准确的请求绑定范围是密封且可解析的 要么不是，不存在部分或临时形态：只有覆盖每个被请求标的
  与整个被请求范围的完整集合才准入执行，而靠替换相邻截面 更晚的更正前沿 或不同成员来覆盖该范围的集合不准入。
  缺失的回执 解析不了的身份 不符的摘要 请求绑定域之外的标的 不包含所请求截面的有效期窗口，或计算只容许一种
  结算币种时出现多于一种，每一种都在 `ProgramHost` 调用之前失败且不产生任何正向回执，因为数据缺口是一个重放
  证据事实，绝不是一个经济结果。Backtest 绝不推断缺失的价格 条款或成员，绝不悄悄改变成本，绝不替换为另一份
  快照或另一个模拟版本，也绝不让遥测或投影顶替一份密封回执。
- [R&D](./rd/) 还可提交一个冻结的 `SIMULATOR` 或 `BACKTEST_OPERATIONAL` `native-repair-request`。
  `SIMULATOR` 只能指向 Backtest 的 Sim Exchange 表面 `sim-exchange`；`BACKTEST_OPERATIONAL` 只能指向
  Native Replay 的 `BACKTEST_RUNNER_SERVICE`。目标 类别 前驱 proof 旧 identity source cut policy 时间错误或含义变化都不创建 Backtest repair
  attempt 或 result。

这两条上游契约的准入程度不高于上游自己的记载：对应的 [Market Data](./market-data/) 输出交接把直连 `BACKTEST_OWNER_V1` Instrument Master 解析标为
**TARGET**，因此此处任何内容都不得读作一条已准入的消费路径。 探索路径在已部署的产物里同样不可达：`run_exploratory_replay_v2` 在其自身 crate 之外唯一的调用者位于 生产 feature
`#[cfg(feature = "native-replay-execution")]` 之下，而 `product/rd-workbench/Dockerfile.owner` 构建 `strategy-factory-rd-owner-api` 时不带它。

这测的是部署产物而不是历史；它没有断言 该路径是否曾在别的环境里跑过。

## 输出交接

- 向 [R&D](./rd/) 返回带完整有限 `diagnosticCategorySet` 及各成员决定性证据截面的探索 Run
  Result。任一执行缺陷成员都优先于经济解释；Research 保留全部支持成员，再按冻结优先级选择唯一修复。
  只有不含缺陷的集合才能用 `NO_EXECUTION_DEFECT` 或 `VALID_ECONOMIC_FAILURE` 做经济解释；
  `UNRESOLVED_FAILURE` 不允许产生决定。
- 对 [R&D](./rd/) 的 `REPAIR_INPUTS_SIMULATOR` 或 `REPAIR_INPUTS_BACKTEST_OPERATIONAL`，只有 Backtest
  能返回准确 request-correlated `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`。`REPAIRED` 命名新
  simulator 或 operational-profile identity，且只允许一个新请求相等 Replay Request，绑定准确前驱
  `REPAIR_INPUTS` 决定、类别、native repair request 与 result identity、原始 proof digest、稳定
  correlation、前驱与后继 native identity 及 cut，以及未改变的前驱请求语义。`BACKTEST_OPERATIONAL`
  还包含后继 operational-profile identity 与 cut。只有 `REPAIRED` 允许 re-entry；`UNAVAILABLE` 只
  允许关联 `STOP_INPUT_UNAVAILABLE`；`OUTCOME_UNKNOWN` 不允许 stop retry 后继 Artifact Selection 或
  Replay Request。任何结果都不改写或重试已消费 run attempt。
- 只有请求相等的探索 `TERMINAL_RESULT` 可以进入选择；被拒 无效 未知 非终态或不匹配尝试只留在
  TrialFamily Census。
- 向 R&D 的有人值守修复路径只返回请求相等的 `REPAIR_VALIDATION` 事实；只有通过结果可支持
  `D1_VALIDATED`。失败 被拒 无效 未知或不相等结果不支持 Candidate，也不能重标为 Research 证据；
  只有 R&D 能提交 D-only Repair Disposition。
- 向 [Qualification](./qualification/) 只返回逐项重复实际消费执行身份以供完全相等校验的密封 Protected Run Result 和完整消费输入证据。
- 只向 Product Edge 提供只读探索 Run Result 视图；保护请求 测量 结果和 holdout 细节永不投影。
- 向 Dashboard 有两条交接，每条只承载它点名的内容：
  - 结果读回，即 `exploratory_replay_result.shadow_read.v2` 背后的 `resolve_exploratory_replay_result_v3`，
    只交出规范结果字节本身，不交出任何由它派生的量。它在 `product/dashboard/lib/operation-registry.ts`
    里的条目只允许 `terminal`、`reconciliation_summary`、`diagnostic_summary` 与
    `semantic_trace_presence`，不含任何经济字段。
  - 运行报告，即 `crates/strategy_factory/src/backtest_run_report_read_v1.rs` 里的
    `resolve_backtest_run_report_v1`，承载 `BacktestRunReport` 的具名字段。运行产出的部分是
    `OwnerBacktestReportV1` 从同一份已提交字节派生出的：该次运行的 result、request 与 attempt 身份，以及其
    结果证据所绑定的引擎结果摘要；由 Owner 判定的状态（`AVAILABLE` 或 `EMPTY`）；该次运行记录的每一个
    收益观测，时间为规范 UTC；净收益；最大回撤；以及每一笔成交的方向，价格与数量按引擎写出的原样给出。
    它不承载统计量映射，因为那些映射合法地含有非有限值。`EMPTY` 的报告还会以 `empty_reason` 说出这次运行
    为什么没有记录收益，只从同一份字节推出，不引入别的输入。决定它的是引擎自己的规则：`Portfolio::statistics`
    从组合快照取日权益收益（`calculate_snapshot_returns`），快照解不出结果时，取每个已平仓持仓的收益。一次运行
    不记录收益，当且仅当快照解不出结果且它没有平过仓。原因是引擎的快照解析按它自己的顺序遇到的第一个成因：
    - `MORE_THAN_ONE_EQUITY_CURRENCY`：运行某个账户的一个已定价快照带不止一个权益，或两个这样的快照币种不同。
    - `ACCOUNT_WITHOUT_PRICED_SNAPSHOT`：运行没有账户，或它的某个账户没有已定价快照，因为该账户的每个快照都
      指名了一个未定价的合约。
    - `FEWER_THAN_TWO_ENGINE_DAYS`：按引擎计日、并把每个账户的权益向后沿用的方式，已定价快照给出的「每个账户
      都已有过权益」的天少于两个。`snapshot_day_start` 把每个账户的第一个已定价快照、以及任何恰好落在 UTC
      零点的快照，都归到前一天，所以单账户的运行只要有一个之后的、不在零点的快照，就有两天。于是没有成交的运行是 `AVAILABLE`、收益为零，
      有没有成交不是原因。
    - `NO_DEFINED_DAILY_RETURN`：这样的天有两个或更多，但没有一天的收益有定义，因为每一天都需要它相对前一天
      非零权益的有限比值。

    一份 `EMPTY` 却平过仓、或快照其实解得出日序列的 canonical result，不是引擎会写出的结果，按
    `ENGINE_RESULT_NONCANONICAL` 拒绝，而不是给它一个原因。规则读的每个输入都在已提交的字节里：账户的身份，
    每个组合快照的账户、`ts_event`、`total_equity`、`base_currency_equity` 与 `unpriced_instruments`，以及
    每个持仓的 `ts_closed` 与 `realized_pnl`。投影直接向引擎的解析要它的成因，而不是另存一份规则。今天各原因
    由什么走到：
    - `FEWER_THAN_TWO_ENGINE_DAYS`：所有快照都落在同一个零点的运行，`a_run_whose_snapshots_all_fall_on_a_midnight_reports_empty`
      跑的就是它，并以晚一分钟作对照；以及任何落在 epoch 第一天的运行，那里前一天不能低于第零天，例如
      `an_authored_universe_member_program_enters_once_through_the_target_set_sim` 用的 25 ns 的 sealed 帧。
      F 的单帧不在此列：它的注册快照在帧的零点、成交快照在其后，所以是带一个收益的 `AVAILABLE`。
    - `MORE_THAN_ONE_EQUITY_CURRENCY`、`ACCOUNT_WITHOUT_PRICED_SNAPSHOT` 与 `NO_DEFINED_DAILY_RETURN`：没有运行
      走得到，因为每个准入账户都只持一种币种、给它的合约定价、并以非零权益开始；各由一个对改过的快照做投影的
      测试走到。

    这个键恒在：`AVAILABLE` 的报告里为 `null`，`EMPTY` 的报告里是集合中的一个。策略与数据窗口不在回测结果里，所以取自上游：
    该次运行所回应的 replay 请求，以及冻结在该请求所指 Design 之下的 Design 与程序。三次读取都在报告自己开的
    一个 `SERIALIZABLE, READ ONLY, DEFERRABLE` 事务里：三者共用一个安全快照，同时保留请求存储函数的隔离规则（它只在
    `read committed` 或 `serializable` 下作答，因为在 `repeatable read` 下它的快照早于它的请求栅栏），且 PostgreSQL
    拒绝这条路径上的任何行锁。等待该快照有上限，超时的报告以 `REPORT_SNAPSHOT_UNAVAILABLE` 拒绝，而不是一直等。请求经
    `rd_owner_api.read_exploratory_replay_request_v2` 读取，它不加锁；`resolve_exploratory_replay_request_v2`
    为之后还要写入的调用方保留它的锁，并经同一个函数读取。策略只对已准入的单阈值族陈述，而且只有当把从那对冻结值读回的陈述重新编写一遍、能逐字节复现该对
    的规范程序时才陈述；任何其他运行都以这个具名理由整体拒绝。这个族不带版本，所以由更早的编写器冻结、
    而当前编写器已不能复现的程序，也以同样方式被拒绝。族内的运行只有在冻结程序锚定到该次运行实际执行的
    artifact 时才被陈述：请求点名的是 Design，而不是其 artifact 构建所依据的程序。锚点是 artifact 的
    Composer 构建回执，在报告的事务内经 Composer Owner 不上锁的回执读取读出：至少要有一条，而且每一条都必须是
    带有该冻结 `joint_freeze_digest` 的 V3 插件构建，这个值由报告从冻结行重新推导。V2 构建不带冻结，
    永远锚不上。未锚定的运行以 `STRATEGY_NOT_ANCHORED_TO_RUN` 拒绝，读不出回执则以
    `ARTIFACT_BUILD_RECEIPTS_UNAVAILABLE` 拒绝。legacy 请求的 artifact 不是 Composer 构建的，所以永远锚不上。
    Composer V3 请求在带 Composer 回放特性的构建里经其自校验的声明不加锁读取，在不带该特性的构建里（部署镜像即是）
    以 `REPLAY_REQUEST_V3_NOT_YET_REPORTED` 拒绝。至今没有任何族内运行被端到端陈述过：没有哪条有序链路条目提交
    Composer V3 运行。
    通道按运行实际读取的样子陈述（角色、品种、事实、时间粒度、单位与精度），而不是按请求
    编写它的形式；因此间接指定品种的编写形式同样给出这六个字段，编写通道的方式变了，这份交接也不变。
    universe 成员形态只通过运行的 universe 选择给出品种。报告在自己的事务内，经 Market Data 不加锁的 R&D 读取
    `market_data_rd_api.read_universe_selection_for_rd_v1` 读出该选择中被纳入的成员，并在冻结 Design 的 CLOSE 角色上
    陈述通道，以唯一被纳入成员的 Instrument Master 身份作为品种。纳入成员不恰好为一个的选择以
    `UNIVERSE_SELECTION_NOT_ONE_MEMBER` 拒绝，读不出或校验不过的选择以 `UNIVERSE_SELECTION_UNAVAILABLE` 拒绝。
    数据窗口是通道的品种与时间粒度、请求的时间
    窗口（结束端不含）、请求绑定的 PIT 快照个数，以及以该快照身份作为的切面。

  序列不是每根 bar 一个点：组合收益按日计算，组合快照跨不到两个 UTC 日的运行退回为每个已平仓位一个收益。
  序列中的每个值、净收益与最大回撤都是分数，0.01 即百分之一，这条交接对它们只陈述这一点。它不说明它们
  衡量的是哪种收益：按日的点是权益收益，按平仓的点是忽略仓位大小的价格收益，而交接目前不携带一次运行
  产出的是哪一种。因此在交接携带从规范结果读回的这一依据之前，任何消费方都不得把这些数呈现为权益收益。
  运行报告目前没有 HTTP 调用方。它的 PostgreSQL 证明读回的是一次真实的引擎运行，但
  那次运行是经验收模块自己的写入进入托管的，而不是经 `run_exploratory_replay_v2`；后者没有任何有序链路
  条目驱动。而且它的程序在族外，所以链路证明的是整体拒绝与结果那一半。族内的运行在链路里今天不可构造：
  没有任何条目从编写出的 Design 组出 replay 请求。

## 拒绝和禁止事项

- 不推断缺失数据 不静默改变成本 不替换工件或模拟版本。
- 不混合探索与保护结果，也不把保护结果暴露给同一研发循环。
- 不把回放存活 统计显著或单次 holdout 当作部署权威。
- 不拥有 Eligibility State 生命周期 资金 实盘订单或账户真相。
- 不把 Run Result 解释为可部署资格；只有 Qualification 可以把保护证据写入 Eligibility State。
- 不因另一类别存在就丢弃已支持诊断，也不把重复或含糊证据猜成修复目标；保留支持成员，并把无法
  隔离的证据分类为 `UNRESOLVED_FAILURE`。
- runner readiness、backpressure、resource exhaustion 或 service outage 证据明确时，不得重标为
  `RUNTIME_KERNEL` `SIMULATOR` 有效经济结果或 unresolved。
- 不把 `RUNTIME_KERNEL` 当作 Backtest repair，不为含义变化改写 repair result，也不把请求投递 接受
  静默或 telemetry 当作终态 native repair result。
- 即使只读也不通过 Product Edge 暴露保护结果。

## 失败与恢复

数据缺口 标的条款无效 非确定性，或 Artifact PIT 范围 PIT Market Snapshot 身份 Universe Selection Record 身份或摘要 快照规则 重放配置 Runtime 内核
模拟器 成本 滑点 容量模型有任一缺失 替换或不匹配时，以 `RUN_REJECTED` 或 `INVALID_REPLAY_EVIDENCE` 终止。 两者只是重放证据事实，不是 Candidate 准入或
Eligibility。

Qualification 记录对应终态尝试 disposition 和预注册 holdout 闭合，但不称为 `INELIGIBLE`；只有 `IN_PROGRESS_OR_UNKNOWN` 保持未解决。
无法保持隔离的保护运行不能降级为探索证据。 复现必须从冻结回执开始。

明确 runner readiness、backpressure、resource exhaustion 或 service outage 失败属于 `BACKTEST_OPERATIONAL`。
它先于经济解释，只把修复路由到 Backtest operational profile 与 runner service，绝不声称 Runtime kernel 或 Simulator 修复。

保护路径中 Qualification 只把密封类别消费为 `DIAGNOSTIC_INVALID`，按预注册政策闭合 holdout，不生成 Eligibility Fact，也不向 R&D 或 Product
Edge 泄漏 operational evidence 或保护细节。

## 决策契约

- **输入** - 一个冻结探索或保护 Replay Request，以及准确已接纳 PIT snapshot artifact runtime
  simulator cost slippage capacity identity。
- **诊断与决定** - 接纳或拒绝准确 request，确认 runner/service operational readiness，确定重放并
  提交实际消费 operational diagnosis 与终态 result，不解释可部署性。
- **冲突解析** - request identity 与 namespace 决定 run；含义变化时拒绝，重放加入同一结果而不替换默认值。
- **输出与终态负例** - Run Result 或 `RUN_REJECTED` `INVALID_REPLAY_EVIDENCE`
  `IN_PROGRESS_OR_UNKNOWN`；所有分支都只是事实证据。
- **反馈与经济意义** - 展示扣成本行为与可复现性，让 Research 学习且 Qualification 独立检验，但不
  授予资格或资金。
- **禁止** - 不拥有 Candidate selection 保护结果反馈 Research Eligibility 生命周期 实盘订单 账户真相或部署权威。

## 后续实现验收

- 相同接纳输入可以重现同一规范事件和结果序列。
- Protected Run Result 能证明请求与实际消费的 Artifact PIT 范围 snapshot universe
  calendar/session/time-zone corporate-action 历史 membership market-semantics correction replay kernel
  simulator 成本 滑点 容量模型 Protected Robustness Plan 和计划单元身份逐项完全相等。
- 每个终态保护结果只对其请求的计划单元准确交代一次，并重复完整 cell-set digest。只有 Qualification
  能按冻结计划解析全部密封 per-cell result，并在消费证明没有请求单元仍处于非终态的密封 Backtest
  attempt frontier 后分配 missing-cell disposition；Backtest 不能声称完整计划已完成，也不能静默改写不可用证据。
- 任一保护请求与结果不匹配都必须成为 `INVALID_REPLAY_EVIDENCE`，且不生成 Eligibility Fact。
- 每个探索结果都关联同一稳定且由 R&D 拥有的请求身份；请求不匹配 可变 已取代或未解析时不生成运行。
- 每个终态探索结果都只有一个完整有限 `diagnosticCategorySet` diagnostic-policy 版本，以及每个支持
  成员的决定性证据截面或完整不可隔离证据集；同时支持的缺陷与经济失败都保持可见，Research 的
  唯一修复选择必须确定。
- 每个终态保护结果同样保留一个完整 有限 非空的 `diagnosticCategorySet` 与内容摘要，但只对
  Qualification 可见。`NO_EXECUTION_DEFECT` 与 `UNRESOLVED_FAILURE` 都只能单独出现；任一受支持执行
  缺陷优先于经济解释，任何保护集合成员都不得进入共享 telemetry 或 R&D。
- 每个终态保护 cell result 都携带密封且由 Backtest 拥有的 applicability 与 outcome evidence，以及完整
  `PROTECTED_EVALUATION` result-stage Time Evidence。Backtest 报告 observation，不分配 Qualification 的
  `PASS` `FAIL` 或 non-applicability 分类。
- 每个 `BACKTEST_OPERATIONAL` 结果都证明准确 operational profile、run attempt、readiness/backpressure/
  resource-exhaustion/outage 证据和 Time Evidence；关联修复只指向 `BACKTEST_RUNNER_SERVICE`，后继
  profile 只能由新 Replay Request 消费。
- 每个已接纳 Backtest native repair request 都有一个关联且只写一次的 result。准确 replay 加入相同
  attempt 与 result；只有 `REPAIRED` 能命名新类别专属 identity，`UNAVAILABLE` 与 `OUTCOME_UNKNOWN`
  不授予后继 identity 或重试。
- 每个完成的探索结果都证明 Artifact PIT 范围与 snapshot universe selection 与修订 重放配置
  Runtime 内核 模拟器 成本 滑点和容量的请求与实际消费完全相等；只有相等的 `TERMINAL_RESULT`
  可以进入 Research Selection。
- 探索与保护运行的命名空间 访问路径和结果消费者可证明互相隔离。
- Backtest 结果不能授权或应用策略 generation；Qualification 决定资格，Governance 授权，只有 Runtime 能证明应用。
- Backtest 只能写 `RUN_REJECTED` `IN_PROGRESS_OR_UNKNOWN` `TERMINAL_RESULT` 或 `INVALID_REPLAY_EVIDENCE`，不能写准入或资格状态。
- 已创建保护请求不能在没有 Protected Run Result 时被拒绝，该结果用于让 Qualification 闭合 holdout 托管。

## 可观测性与持久化

Backtest 持久化每个 Replay Request、run attempt、已消费 Artifact 与 PIT 身份、operational-profile 身份 与版本、runner/service
readiness 与有界 backpressure/resource/outage 证据、成本/容量输入、完整 diagnostic set、Exploratory Result 和 Protected Run
Result。

运行信号覆盖 queue time、engine/simulator 时长、资源使用与 repair dependency，但不能把保护测量或内部终态 disposition 复制到共享 telemetry。 探索
投影可以暴露其 diagnostic category set；保护投影只能暴露公共终态 `CLOSED_NOT_QUALIFIED` 或 `QUALIFIED`、类型不透明且不可解引用的
reference，以及 source-frontier freshness。

保护 phase、run latency、terminal timing 和 timing-derived field 明确禁止公开；也绝不暴露通用 terminal disposition、 内部原因或内部状态。
`REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与
`INELIGIBLE` 六种负面终态都以字节等价方式归一为 `CLOSED_NOT_QUALIFIED`，正向 `QUALIFIED` 保持准确。

任何保护 category 或 category-derived aggregate 都不得用于 label group filter count alert health score 或 research
funnel。 遥测丢失不能制造 Result、替 Research 诊断保护 attempt，也不能让 Qualification 闭合 attempt。
