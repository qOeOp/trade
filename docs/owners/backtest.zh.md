# Backtest

## 职责

使用接纳的历史事实和生产等价交易语义重放冻结策略工件。Backtest 拥有重放实际消费了什么以及发生了什么，不决定结果是否可部署。

## 能力对照与 MCP 范围

对照分开记录 Nautilus 原生基础、仓库产品扩展与当前 MCP 可达能力。
原生接入以本仓库 Rust 源码为依据，上游 latest 文档补充能力发现；不把上游 API、某项测试或工具名
当成当前产品装配、部署或端到端交付证明。

| 功能                   | Nautilus 原生基础                                                          | 产品扩展与当前 MCP                                                      | 范围判断                                                              |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 历史事件回放           | BacktestEngine、模拟场所、时钟、事件排序与原生交易组件                     | `run` 经产品编排提交；原生执行取决于 feature 与服务装配                 | 原生已有引擎；提交被记录或 replay 被封存不等于完成执行                |
| Catalog 数据加载与分片 | BacktestNode 配置、标的加载、oneshot/streaming                             | 当前入口解析 Market Data PIT custody；没有通用 catalog 配置入口         | 复用原生加载；产品增加准确版本与消费绑定                              |
| 策略输入               | 原生 Strategy/Actor 生命周期与组件注册                                     | 当前 MCP 使用已入目录的单一 `strategy_id`，产品编写与 Host 提供受限映射 | 原生策略包封存属于 R&D；Backtest 校验并运行已冻结工件，不另建策略语言 |
| 多标的与多策略         | 多标的事件流、`add_strategies` 与共享原生账户                              | 当前 `run` 请求只有一个标的和一个策略；内部 target set 可含多标的       | 多标的策略不等于独立策略组合；组合 MCP 流程尚未交付                   |
| 挂单与退出             | 原生 OrderFactory、OMS、订单命令/事件、GTD、contingent 和 reduce_only 基础 | 当前 target adapter 固定 NETTING，按截面价格发 GTC limit                | R-1 的冻结目标价、条件撤单、按笔保护及分段退出仍需原生策略接入与验收  |
| 撮合与流动性假设       | bar/trade/book 撮合、部分成交与 Fill 模型                                  | MCP 无完整模型选择与配置绑定入口                                        | 复用原生撮合；模型名称存在不保证适合输入或已被本次运行采用            |
| 费用、滑点与延迟       | Fee、Fill、Latency 模型                                                    | 当前六字段请求未暴露这些配置，后端路径存在自身约束                      | 产品封存明确选择和实际使用配置；不新增平行成本模型                    |
| 余额、保证金与持仓     | 原生账户、Margin 模型、Portfolio、RiskEngine                               | 当前 Host 路径限制单 venue Margin account、NETTING                      | 原生拥有交易事实；账户池分配与研究场景政策属于产品扩展                |
| 资金费结算             | SimulatedExchange 处理 FundingRateUpdate 与结算边界                        | 产品有数据与结果基础；当前 MCP 请求不能表达完整资金费计划               | 需要证明完整 schedule 接入、账户变动和报告一致；不另写资金费账本      |
| 执行算法               | `add_exec_algorithm` / `add_exec_algorithms` 及原生算法接口                | 当前 MCP 无算法配置入口                                                 | 原生已有，按研究需要接入并绑定算法版本与参数                          |
| K 线内成交顺序         | 原生 OHLC 路径假设与分钟 bar 撮合                                          | 分钟执行、原生信号聚合及保守政策仍须接通验收                            | 路径假设不证明实际先后；缺失行情不能使用兜底                          |
| 输入修复与重新回测     | 原生 reset 与完整重复运行                                                  | 输入版本改变后由 Agent 提交新封存运行                                   | 保留前驱与准确证据，不拼接运行或改写旧输入                            |
| 运行身份与结果托管     | 原生 run/result 与统计基础                                                 | 产品有请求登记、同身份冲突检查、冻结/准入、attempt 与结果 custody       | 产品增加可接管的研究证据；是否成功须看实际终态与结果                  |
| 报告与绩效             | 原生结果、analysis 统计、订单/成交/持仓/账户事实                           | 有 OwnerBacktestReportV1 转换；当前 MCP `report` 对已记录运行统一拒绝   | 计算基础已有，MCP 报告读取尚未交付，不能以拒绝工具算报告完成          |
| 回测任务与恢复         | 原生重复运行、streaming 和状态操作                                         | `status` 读已记录请求/答案，`list` 列出运行；`run` 当前请求内编排       | 完整后台任务、取消、未知结果恢复和预算接管流程仍有整合缺口            |
| 组合资金与成员变更     | 原生共享账户、多策略、风险与事件时间线                                     | 产品已有组合/分配目标，当前单策略 MCP 不支持完整配置                    | 两边都未提供本产品试盘/正式池、等待加入和成员退出预案的完整历史流程   |
| 参数实验、比较与资格   | 原生重复运行、配置与结果提供基础                                           | Agent 比较实验，R&D 保存记录；Qualification 独立评价资格                | Backtest 提供冻结运行和事实，不拥有研究搜索、策略排名或上线决定       |

**当前 MCP 四工具。** `run`、`status`、`list` 已有后端操作路径；`report` 有协议与路由，
但已记录运行仍统一返回 `RUN_HAS_NO_RESULT`。`run` 只有六个请求字段：运行身份、策略身份、
标的、执行周期和窗口起止；没有独立组合成员、账户分配、执行算法或成本模型配置字段。
原生执行还受 `composer-v3-replay`、`native-replay-execution` 和后端服务可用性约束，
不能把编排接纳、封存成功或输入 custody 签发当成结果完成。

### MCP 目标功能集

保留一个 Backtest MCP，按用户故事提供以下候选能力；具体工具名与结构在契约层确定。

1. **准入检查**：检查冻结工件、数据绑定、场所/账户/OMS、模型和执行政策的支持范围，返回具名缺口。
   V0.1 不按策略名称或 R-1 模板设白名单；原生策略须满足已接入能力、冻结输入和资源边界。
2. **提交回放**：提交单策略或版本化组合的冻结运行；复用原生引擎与相同的交易语义。
3. **任务查询与控制**：查询、列出、取消运行并恢复原任务身份；区分运行停止、结果未定与实际完成。
4. **结果与报告**：返回不可变结果引用及有界报告，保留订单、成交、拒绝、成本、账户与策略归属事实。
5. **重放与后继运行**：用准确旧绑定复现；细化输入或变更配置时创建有谱系的新运行，不覆盖旧证据。

V0.1 交付任务查询与原身份恢复，不开放主动取消回测；已接纳运行在资源上限内执行至完成或失败。
目标取消能力不属于首版交付。任务与结果记录可恢复，不要求回测中间状态的断点续算。
服务重启后先按原身份查询：完整结果直接回读，状态未定继续解析，确认已中断后由 Agent 提交
相同冻结输入的关联新运行，从初始状态完整回放。旧尝试、失败与资源消耗保留，新运行按既有台账规则记账。

### 正式结果保管与存储边界

V0.1 的正式任务、结果、已接纳报告与证据明细不按年龄自动删除，也不自动把旧结果降为只有摘要。
结果的订单、成交、账户/净值序列及已保管诊断按原身份保持可读，继续遵守原访问权限和保护隔离。
可清理不属于正式证据的临时文件；用户决定扩容或清理正式证据前，存储不足时停止接纳受影响的新任务，
返回容量缺口，不通过淘汰旧结果换取继续运行。已接纳任务仍受资源上限约束；写入失败如实报告，
部分结果不冒充完整终态。该规则复用现有结果保管与资源准入，不新增归档服务或首版清理界面。

Admission、Replay、Results、Reports 是同一服务内的职责，任务控制不新增独立部门。
外部 Agent 组织各次实验、选择参数、比较结果并决定下一轮；R&D 保存实验及决定。
Backtest 在预算内排队并执行已提交的冻结运行，不展开参数搜索、不自动排名或挑选下一组参数。
V0.1 可接纳多个独立运行，排队逐个执行，同时最多执行一个回测；各自保留身份、状态与结果。
并行执行不属于首版要求，后续扩展仍须满足资源边界和任务隔离；服务端排队不引入研究判断。保护评估归 Qualification；
数据准备归 Market Data。Backtest 不调用实盘效果来模拟历史，不在撮合途中调用 MCP 补数。

V0.1 的结果回读同时提供有界策略诊断日志，复用 Nautilus 日志并关联准确运行与策略版本。
Agent 可在策略里记录未触发、过滤原因等信息，用于解释零成交或异常结果；产品不生成研究诊断结论。
订单是否提交、拒绝或成交及账户变化仍以原生事件和结果为准。日志截断或不可用须明确标识，
不能把未记录的消息解释成某个条件没有发生，也不能用日志文字替代成交与账户证据。

### 失败诊断与错误记录

V0.1 将失败信息保存在 Backtest 已有任务/结果数据库中，通过任务和诊断读接口提供，
不另建错误数据库或错误服务。记录关联原请求、已有 run/attempt、策略 hash、运行环境和输入版本，
保存发生时间、具名错误及可取得的异常位置/调用栈和有界原生日志；无对应运行或细节时明确缺失，不伪造字段。
各 Owner 写自己产生的错误事实，R&D 只关联公开任务回执与 Agent 的修复说明，不越权修改来源事实。

失败运行已有的原生订单、成交和账户记录可以在许可范围内作为诊断读取，明确记录是否完整及结束位置，
不能当作成功的完整回测、经济优势或资格证据。日志和事实只保管已记录内容，不保证崩溃前内存可恢复，
也不为诊断增加模拟器快照或断点续算。保护任务的错误细节仍不向研究侧公开，诊断不得泄漏凭据。
服务异常退出而尚无准确错误回执时，状态保持未定并解析原任务，不凭空补一条确定失败。

Agent 通过项目任务列表与 Backtest 回读看到已记录失败，可诊断策略问题并在 R&D 关联修复版本与验证运行。
服务器服务问题保留错误日志和准确版本/任务信息，供用户事后检查；研究流程不包含服务代码自修复或自动部署。

- **策略代码错误**：Agent 修改 Git 源码，封存新 Artifact 并提交关联的新完整回测。服务器执行新包，
  不需要为每次策略修改重新部署回测服务；旧错误、包和尝试保留。运行中的真钱策略不因研究修复被自动替换。
- **产品服务或固定环境错误**：保留服务版本、错误日志和相关任务信息，由用户事后检查、修复并自行部署。
  不新增故障修复工作流、内置修复模型或自动发布能力；研究 Agent 的策略提交权限不包含服务修复与部署。
  用户完成修复后，后续实验采用准确的新服务/环境版本，并保留旧失败记录。

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

### V0.1 服务操作与完成条件

MCP 与内部 API 调用同一组领域操作；本表定义消费含义，不提前指定工具 URL 或另建运行配置语言。

| 操作     | 输入                                                                                 | 返回与完成条件                                                             |
| -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 提交运行 | 已登记实验/attempt、稳定请求身份、封存包、输入清单、Run Specification 与准确资源承诺 | 原任务身份及准入/排队事实；接纳不等于回放成功                              |
| 查询运行 | 原请求、attempt 或任务身份                                                           | 同一任务的状态、输入绑定、实际消耗、可用结果或失败引用；未知与中断明确区分 |
| 读取结果 | 准确 run/result、报告种类、范围、上限与分页位置                                      | 原生摘要、订单/成交/账户、分钟净值及有界诊断；注明版本、完整性与后续位置   |

策略内容以 [Strategy Artifact 与 Run Specification](../architecture/strategy-factory.zh.md#策略包与内容身份)
分别绑定。一次提交只运行首版范围内的一项完整策略；多标的是同一账户回放，不拆成单币净值拼接。
Agent 可以直接读 Backtest 结果，R&D 只保留引用及 Agent 解释，不复制另一份原生账户或结果权威。

### 原生加载与结果保管顺序

本仓库 Python 入口位于 `vibe_trading`。先用 `BacktestNode.build` 创建准确 run config 的 engine，
再以 `add_strategy_from_config(run_config_id, ImportableStrategyConfig)` 加载封存模块；
入口使用原生 `module.path:ClassName`，配置类、参数及导入闭包来自策略包与固定环境。
节点不能从 Git 最新分支取代码。原生 Rust 注册与 Python 配置加载是不同入口，不能以其中一个存在证明另一个接通。

原生模块导入也执行 Python 代码；封存不是执行许可。普通研究的加载与回放在既有 Docker/任务资源隔离内进行，
只提供封存包、固定环境与获准研究输入，不挂载其他项目或保护数据，不提供交易凭据，也不允许策略
在运行中联网下载或安装依赖。R&D 的封存入口不在服务权限下任意导入源码；所需检查使用相同受限执行边界。
这些约束由普通进程/容器权限与领域准入实现，不新增自研沙箱引擎。

`crates/backtest/src/python/node.rs` 提供上述加载端口；直接 engine 的 `add_strategy` 和
`add_strategy_from_config` 位于 `crates/backtest/src/python/engine.rs`。执行算法沿 engine 原生接口注册，
不把编译进示例的 `add_builtin_strategy` 当作任意策略编写入口，也不重建策略 Host。

原生 `BacktestNode.run` 可在忽略错误时跳过 engine 或省略失败结果。产品路径使用
`BacktestRunConfig.raise_exception=true`，并核对
期望 run config 确实构建、运行且结果身份匹配；函数返回成功或结果列表非空都不足以宣布本任务成功。

原生节点还可在完成后 dispose engine。产品路径使用 `dispose_on_completion=false`，
在必要报告提取与托管前保持 engine 可读，沿原生
`get_result`、`generate_orders_report`、`generate_fills_report`、`generate_positions_report`、
`generate_account_report` 和 Portfolio 快照取事实，再提交不可变结果与报告，最后释放 engine。
托管确认后才可签发完整可读结果；此前保留原任务与结算状态继续解析。报告或分钟序列提取失败时，摘要不能替代完整结果。
对外有界报告从已托管原生事实生成，保留原生价格/数量精度、币种和金额单位、事件时刻及排序依据。
DataFrame 或 catalog 文件路径不是 MCP 数据契约；序列化不得用丢失精度的浮点数替换金额，
不得把无法返回的明细当作空集合，也不接受调用者任意 SQL、路径或脚本来读取报告。

### 原生运行准入与输入映射

V0.1 的初始账户只有明确配置的资金，无持仓和挂单；不提供已有交易状态导入。预热区间仅建立
指标和策略计算状态，不接纳订单或产生交易账户变化。正式区间起点的账户保持冻结初始状态，
首次交易不得早于正式区间；期末未平仓按既定政策保留并估值。

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

### 一分钟执行与结果复现

K 线回测用已准入的一分钟行情贯穿完整执行区间。策略通过原生订阅接收较大周期聚合 K 线，
这些内部聚合序列只驱动信号，不重复推动场所价格或成交。`bar_adaptive_high_low_ordering` 给出分钟内
OHLC/OLHC 路径假设，不能证明实际交易先后。

分钟数据版本、原生聚合设置和运行环境由现有策略包、数据引用与运行配置关联保存。数据或配置改变
时创建新封存运行，从完整初始状态重新回测；不回滚局部状态，也不拼接两次运行的成交。
已绑定输入可通过原生 streaming 分批消费，分片保留相同 `ts_init` 的完整批次。

分批不减少总事件数，也不证明所有加载路径都按批限制内存。当前
`crates/backtest/src/node.rs::run_streaming` 在单数据配置时直接使用 catalog 迭代器，多个配置时先经
`load_and_merge_data` 全量加载并归并；多标的、多周期内存目标须核验实际读取路径。

完整一分钟仍不明时，止损/止盈冲突取止损优先，入场/止盈先后不明取入场后持仓，并标注政策推定。
原生路径启发式不自动实现这一含义；须通过原生扩展及验收，未接通时返回顺序未决，不能声称政策已执行。
缺失分钟或无效行情属于数据缺口，不能使用歧义兜底伪造结果。

### V0.1 研究规模与性能验收

首版使用约 50 个永续标的、约五年历史验证单策略共享账户回测，不只验证单币短窗口。
规模来自 research R-1 的 17 个主流币和 36 个扩展币；具体合约与有效区间按币安点时事实冻结，
并绑定预热、一分钟执行行情、历史标记价及费用/资金费等经济输入。原型标的简称与 2018 至 2022 窗口
不是可直接消费的币安永续输入，不能伪造尚未上市合约的历史。

基准记录运行环境、输入行数、缓存状态、加载/回放/统计/回读分段耗时、峰值内存与资源消耗。
首次数据准备与已有数据上的单次回测分别计量；数据复用不省略实际执行行情。先测量，再定位原生加载、
排序或统计接线的瓶颈，沿原生路径优化，不增加精度切换或平行回测引擎。
资源超限或覆盖缺口保持具名失败，不能通过静默减少标的、缩短历史或拼接单币结果通过验收。
当前尚无该基准的执行测量，不从流式配置或原生 API 存在推定性能达标。

### 永续估值与成交价格

V0.1 永续持仓的未实现盈亏、分钟净值和期末净值使用已准入历史标记价，复用原生
`MarkPriceUpdate` 与 Portfolio 估值路径；限价、止损止盈和模拟成交仍使用各自冻结的成交行情语义。
Market Data 分别提供成交行情与标记价绑定，Backtest 检查覆盖、可得时间和陈旧性，不能把标记价 K 线冒充可成交行情。
原生 `use_mark_prices` 在缺失标记价时允许价格回退，但该回退不满足本版估值合同；必要输入缺失或无效时返回具名缺口，
不将成交价近似结果标成标记价净值。估值输入与执行输入分别封存并在报告中标明。

### 分钟主回撤与统计输入

V0.1 主最大回撤使用一分钟采样的原生 Portfolio 账户净值，包含未实现盈亏及已发生手续费、资金费；
日末回撤独立列出。复用原生细粒度快照和 `MaxDrawdown`，连接分钟估值输入，不另建组合账本或统计引擎。
当前分析器按日归集组合收益，开启分钟快照不等于已接通分钟主回撤；该接线及分钟内下跌、日末恢复的验收样例是首版交付要求。
冻结估值来源、时间、采样与同时间事件边界，保留初始和期末净值、账户变化；缺失或陈旧输入明确报告。
分钟回撤不宣称覆盖分钟内全部极值，不用各标的独立高低价合成组合路径，不静默改变其他统计量的采样口径。

### 分钟净值序列的有界读取

V0.1 的结果读取允许 Agent 按准确 run/result 身份和时间范围，分批获取一分钟账户净值序列，
用于自行画图、分析回撤持续时间、恢复过程或自定义指标。返回采样时刻、账户净值与币种/估值口径，
以及准确结果、估值来源和采样依据引用；保留初始、期末及账户变化的关联事实。
主最大回撤与序列读取复用同一运行的原生 Portfolio 快照和相同采样边界，不另算一份净值或维护第二账本。

读取有界并返回后续位置，分页保持同一结果版本；大范围结果不一次塞入对话，也不因截断宣称完整。
日末曲线可以另作摘要，但不能代替一分钟序列；缺失或无效估值明确报告，不用插值、成交价回退或省略区间
掩盖缺口。按原生账户事实解析的空仓区间必须可说明，不能把没有持仓快照误判为已返回完整分钟路径。
保护运行的细序列不向研究侧公开。Agent 的图表和自定义分析属于宿主探索，不要求上传保管。

例如 R-1 两个退出版本的最大回撤相近，Agent 可取回相应分钟序列，比较水下持续时间、恢复和重复下探，
将结论及准确结果引用写入 R&D。序列读回必须能与主回撤使用的输入对齐；当前已有统计能力不证明该读取链路已交付。

## TARGET - 资金与执行政策的一致回放

所有 Backtest 运行只使用封存的初始资金，不支持期间充值、提现或其他外部资本注入/提取，也不提供这类事件输入。
账户净值可因交易盈亏、手续费、资金费及估值变化而改变；池内/策略间分配变化仍在同一账户内部发生。
外部资金流属于真实账户的 Execution 对账、Portfolio 计量和 Governance 分配链路，不能作为回测资金事件注入。

规模政策没有默认模板。请求须绑定明确选择的模板/参数或准确冻结配置引用；缺少选择时拒绝准入，
不按策略类型或引擎默认补齐。相同冻结配置的重放保留原选择，不要求每次信号或重跑再次交互选择。

回测收益绑定策略版本及完整的账户/部署环境：初始账户、成员及加入时间/规则、两池政策、规模模板与参数、
杠杆/保证金/估值、Risk 限额和预留、退出及执行政策。单策略诊断与部署组合结果
分别标明运行环境，不把独立且资金充足的策略曲线当作共享账户可达收益。

产品控制的分配、规模、等待准入和风控决定，须在历史时钟下复用相同版本的领域政策与原生 Runtime/Risk/Execution/Portfolio
路径；使用封存数据、模拟场所与事实适配器，不启动真实 Governance 效果，不从回放调用生产 MCP/API，
也不另写一套简化资金或订单引擎。异步账户/事件的到达顺序在回放中明确建模；同代码不保证实盘事件顺序相同。
改变资金/规模/组合配置得到新封存运行及证据绑定，旧资格不能被默认为覆盖任意配置。

报告保留信号意图、请求数量、实际接纳数量、风险拒绝/排队原因、模拟成交、费用及账户路径，
用相同数据与冻结对照说明资金/执行政策如何影响结果。拒绝的信号不能记作已成交盈利交易。
用户上下架、网络故障或订单簿排队位置不能从历史价格推知；无事件数据的情形须声明情景假设。
滑点、延迟、流动性/成交、跳空和账户内部资金分配按预登记情景做敏感性/压力回放，不模拟充值提现。
报告不可建模的缺口，不声称收益预测精确。

真实试盘保留当时数据、政策与账户/订单事件，用于按信号、规模、准入、时序、成交及成本定位偏差。
Backtest 对照始终使用冻结初始资金；实际区间含充值提现时，不注入现金流重建账户，也不宣称两者净值可直接比较。
外部资金流及其资金归属影响由 Execution、Portfolio 与 Governance 的真实记录解释。
诊断既保留实际事实也保留模拟结果，不覆盖旧证据或用未来事实修饰事前回测。
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
- 原生输入的可用时刻、预热边界及实际订阅消费。缺失或尚不可用的输入不能当作策略条件为假的证据。需要诊断时读取原生事件与策略日志，不要求任意 Python 策略提交冻结程序图、谓词枚举或独立的逐条件普查。
- 探索运行与 Qualification 请求的保护运行之间的完整隔离。
- Exploratory Run Result 逐项重复实际消费的 Strategy Artifact 请求 PIT 范围 PIT Market Snapshot
  Universe Selection Record 与修订规则 重放配置 Runtime 内核 模拟器 成本 滑点和容量模型身份，
  让 Research 校验请求与结果完全相等。
- 现有兼容结果按绑定 diagnostic-policy 版本提交一个完整有限 `diagnosticCategorySet`。支持成员为
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
- **UNAVAILABLE 兼容接口 - `REPAIR_VALIDATION` 请求与结果：** 不存在任何实现。`REPAIR_VALIDATION` 与
  `RepairValidation` 不出现在 `crates/` 或 `product/` 下的任何文件里。
- **UNAVAILABLE 兼容接口 - `SIMULATOR` 与 `BACKTEST_OPERATIONAL` repair：** 不存在 Backtest 的 repair 面。四个 Backtest
  crate 里 `repair` 的全部出现都是 `crates/backtest_owner/src/postgres.rs` 里记录 custody 永不被修复的注释；
  `BACKTEST_RUNNER_SERVICE` 不出现在任何 Rust 文件里，而
  `product/dashboard/lib/rd-iteration-timeline-client.ts` 已经把它列为合法修复目标。消费侧词汇存在，生产方
  不存在。
- **CURRENT 可选计算；报告接入不可用 - 探索统计：** `crates/backtest_statistics` 已能按显式值计算匹配入场对照与聚类区间，但尚未接入探索报告。它不是原生报告前提，具体方法见下文。
- **UNAVAILABLE 可选 Forward Record 接口 - Forward Replay：** 尚不存在 Forward Replay。Forward Replay 在 Qualification Forward Record 的每个新观察到的
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

## 报告交付与可选诊断

### 原生报告交付

完成结果接通后，`GET /v1/backtests/{run_id}/report` 以运行记录的 `strategy_id` 和封存原生包说明策略：
内容摘要、Git 来源、入口、参数与冻结执行环境。报告描述实际消费的输入清单，包括多标的与原生聚合。
重新编译策略编写语言文档不是原生路线前置。

这是目标交付契约，不代表当前兼容 reader 已能解析完成结果。

### 可选探索统计

**CURRENT 计算；报告接入尚未连通。** `crates/backtest_statistics` 已提供接收显式值的纯函数
`matched_entry_control_v1` 与 `round_trips_from_fills`。Agent 可调用已准入的确定计算，也可使用自己的研究脚本，
在 R&D 记录输入、方法版本与解释。探索报告不以这项诊断为前提；它不能替代独立 Qualification，也不能把无效运行变成经济证据。

现有 V1 函数接收 bar 开盘价与时间、完整交易、单边成本、可选逐 bar 资金费及种子，返回输入摘要。
每笔交易抽取同一 UTC 年、同一方向、同一持有时长的 20 个入场，两端按 bar 开盘价计算。
净收益扣除已声明成本与资金费，再按 ISO 日历周聚类重抽样 4,000 次，读取 2.5% 与 97.5% 分位。
这些常量标识这个函数版本，不规定所有研究必须使用的方法，也不要求新增配置框架。

它不重放策略止损止盈，不等于 research T0 的 ATR 风险单位对照；不能从成交反推任意 Python 策略的退出规则，
也不能把两类对照当作等价。缺失资金费明确为 `funding_stated: false`，不能伪装成永续经济证据。
产品报告采用的额外输入必须解析该次运行准确的不可变数据绑定，不能替换成更新的 bar 或另一版资金费。
原生报告必需证据仍是实际订单、成交、持仓、成本与分钟级账户估值。
Agent 选择需要策略执行的额外对照时，单独登记原生回放，不在报告组装中隐藏第二套模拟器。

### 运行报告文档

**当前兼容组装；reader 已准入但结果接线未完成。** `backtest_run_report_document_v1` 从显式值组装
`backtest.run` 文档：四问题报告、成交、准确托管 head 的 bar、已声明资金费、标的 taker 费率和请求身份。
纯函数不读取 Owner 或时钟。

- 四问题报告完整放入 `report`；新增字段位于其旁，不给 Dashboard 四问题合同增加第五项。
- Qualification 保护分区尚未登记时，`standing` 为 `EXPLORATORY_ONLY`，`holdout` 为 `NO_HOLDOUT_PARTITION_DEFINED`。
- `pricing` 保留兼容 target-set Host 的 BAR close 决策、quote cut 成交、封存费用、
  `STATED / NOT_STATED` 资金费和 bar open 对照口径；不把这些值当原生策略的统一撮合政策。
- `fees` 按币种精确汇总佣金；`control` 使用上节纯统计函数，按请求身份设 seed。这是兼容报告字段，
  不是原生回放必做诊断。
- 保留具名拒绝：`REPORT_FILL_UNREADABLE`、`REPORT_COMMISSION_UNREADABLE`、
  `REPORT_FILLS_NOT_ROUND_TRIPS`、`REPORT_CONTROL_UNMEASURABLE`。
- bar 从本次运行固定的 custody head 读取；后续链推进不改变该切面。head 不在链中返回 `PitWindowHeadNotInChain`，
  bar 与本次 bundle 摘要不一致返回 `REPORT_BARS_DIGEST_MISMATCH`。
- 当前单阈值兼容 reader 保留 `AUTHORED_STATEMENT_NOT_REPRODUCED` 与 `REPORT_DATA_WINDOW_NOT_SINGLE`，
  不据此限制原生目标。
- 兼容 data window 来自固定 custody binding：唯一成员、Market Data 声明的执行周期、开始与排他结束时间、
  固定 head 和本次 custody cut 数；不是从新 PIT snapshot 推测。
- 当前 HTTP reader 对已登记运行返回 `RUN_HAS_NO_RESULT` 并携带原重放状态。feature-gated 原生执行能提交结果，
  不代表此 reader 已接通。目标交付必须解析已提交结果身份、准确绑定并组装报告；custody issuance 本身不足。

### 可选复现比较

`crates/backtest_statistics` 提供 `compare_replication_v1` 与 `t0-replication` CLI，比较显式给出的两份交易列表。
现有 T0 兼容政策按标的、方向和入场日关联交易，比较退出日，排除其 200 根预热 bar 与期末未完成退出，
并按标的 tick 核对入场价和执行 bar 开盘价。99.5% 是该政策的阈值，不是所有策略的产品门禁。

Agent 为新原生实验选择参考并预登记比较假设；持仓模式、目标基准、数据或成本差异明确报告，
不能为达到旧数字而隐藏。该函数不要求编写语言文档，不构建原生包，也不证明完整 R-1 撮合。
原生验收比较冻结实验下的实际订单、成交和账户事件。

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
- 在现有兼容接口接纳 `D1_EXECUTABLE_REPAIR` 时，R&D 提交独立 `REPAIR_VALIDATION` request，绑定 D-only repair
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

## 当前兼容协议的输出交接

原生运行报告引用封存 Python 包的内容摘要、Git 来源、入口、参数和固定环境，以及实际消费的多标的输入与聚合配置；不重新编译编写文档，也不要求 Composer 构建回执。下文单阈值族、V3 回执、唯一 universe 成员及对应拒绝码仅约束当前兼容报告读取形状，不能成为原生报告前提。

下列类型化诊断与修复记录约束现有兼容 schema 的消费者，不是原生研究提交必须实现的科学分类或修复工作流。原生服务故障保留任务身份、实际错误与日志，由用户修复服务器并部署；策略修正产生新的封存包与实验。无效、中断、未知或输入不相等的运行仍不能作为经济或资格证据，保护诊断仍只由 Qualification 持有。

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
- 现有兼容 schema 的每个终态探索结果都只有一个完整有限 `diagnosticCategorySet` diagnostic-policy 版本，以及每个支持
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
