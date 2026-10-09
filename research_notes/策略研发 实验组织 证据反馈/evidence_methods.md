# 策略研发的证据生产与统计推断

## 问题一：回测前应先产出什么可信输入，原生回放能证明到哪一步？

### Takeaway
先建立可比较、可追溯的原生事实，再谈统计效应。这里的事实是指定时间可见的数据、固定的策略/账户/执行配置和逐事件报告；回放成功本身只证明该模拟在给定假设下运行完成。[Nautilus v2.0.0rc3 数据文档](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/data/index.md)；[Nautilus v2.0.0rc3 报告文档](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)

### Cited Findings
- **操作 1，做时点可得性审计。**输入：每项字段的事件时间、真正可用时间、bar 起止、源文件与数据快照。输出：`available_at <= decision_at` 判定、缺失/重复/延迟样本清单、数据覆盖。Nautilus v2.0.0rc3 按 `ts_init` 排序回放；`ts_init` 是对象初始化时间，未必等于外部数据真实接收时间，所以单有引擎时间戳并不足以证明一切外部数据当时可得。bar 的 `ts_init` 必须代表区间收盘，避免整根 bar 提前可见。[v2.0.0rc3 数据时间语义](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/data/index.md)；[v2.0.0rc3 bar 时间约束](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/bar-execution.md)
- **操作 2，冻结同口径配对回放。**输入：`S`、`S+A`、`S+A+B`（B 单独有定义时再加 `S+B`）、相同数据快照/时间窗/初始账户/风险预算/执行与费用配置、锁定版本和种子。输出：各自完整账户、订单、成交、仓位、手续费和资金费报告以及运行清单。Nautilus v2.0.0rc3 的 `BacktestNode`/原生报告提供订单、逐笔成交、持仓和账户记录；模拟账户会按 `FundingRateUpdate` 的边界结算资金费。[v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)；[v2.0.0rc3 账户与资金费](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/accounts-and-margin.md)
- **操作 3，确定性地核对行为。**输入：上述逐事件报告。输出：两版本信号/订单/撤单/成交/账户第一次分叉的时间与事件 ID，并以账户余额、佣金、资金费等原生记录复核差异归因。v2.0.0rc3 文档明确每个数据点先更新交易所和旧单匹配，再派发策略，最后结算新指令；事件顺序会改变成交和后续账户路径。[v2.0.0rc3 执行顺序](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/execution-flow.md)；[v2.0.0rc3 报告字段](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)
- **操作 4，单列执行模型敏感性。**输入：当前 bar/quote/depth 粒度、成交假设和关键订单。输出：策略结论依赖多少同 bar 止盈止损排序、价差、深度、队列和滑点假设。v2.0.0rc3 官方文档指出 bar 没有真实的区间内价格先后、价差、深度与队列；引擎用合成 OHLC 路径，执行敏感策略需更细数据验证。这个检查是模型风险诊断，不应据此声称真实可成交。[v2.0.0rc3 数据粒度限制](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/data-and-venues.md)；[v2.0.0rc3 bar 执行](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/bar-execution.md)
- **操作 5，封存失败和不匹配。**输入：所有候选、包括失败者的运行清单与源/依赖/数据哈希。输出：可读的失败原因、配对是否可比标记和不可比较理由。Nautilus 原生报告能呈现订单、成交、持仓及账户事实；White 的数据窥探检验以规格搜索中遇到的最佳模型为对象，因此若仅保留赢家，后续无法诚实定义已搜索的候选集合。[v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)；[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)

### Inferences
- 建议证据包按“输入合同 → 原生事件/账户 → 行为分叉 → 描述性指标 → 统计不确定性 → 搜索历史/样本暴露 → 允许结论”顺序组织，让 Agent 先处理事实错误再解释收益。依据是事件顺序、报告可读性和模型选择偏差各自解决不同问题。[Nautilus v2.0.0rc3 执行顺序](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/execution-flow.md)；[Cawley & Talbot 2010](https://www.jmlr.org/beta/papers/v11/cawley10a.html)
- 37 币共享一个账户时，统计推断的观测单位应是账户的时间序列；把 37 币或订单数当独立重复会忽略共同资金、市场冲击和跨期依赖。配对时间序列推断应保留相关性。[Newey & West 1987](https://www.nber.org/papers/t0055)；[Politis & Romano 1994](https://doi.org/10.1080/01621459.1994.10476870)

### Gaps
- 外部行情供应商的真实可得时间、历史合约费率快照、掉线/缺失覆盖和市场冲击误差，需要审计本项目实际数据源；Nautilus 引擎时间戳及本条目所引官方文档不能独立证实这些事实。[v2.0.0rc3 数据时间语义](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/data/index.md)；[v2.0.0rc3 数据粒度限制](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/data-and-venues.md)

## 问题二：单个 A→A+B 的净账户改善应怎样量化不确定性？

### Takeaway
先定义唯一主要净账户目标和风险限制，再配对同日期账户收益，对增量估计时间依赖下的不确定性；指标区间是对**预先固定的一次比较**作推断，不能清除先挑 A、B 的选择偏差。[Newey & West 1987](https://www.nber.org/papers/t0055)；[Politis & Romano 1994](https://doi.org/10.1080/01621459.1994.10476870)；[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)

### Cited Findings
- **操作 6，定义主要估计量。**输入：两条策略同起点、同日历、同账户模型的每日盯市权益 (E_{A,t}, E_{AB,t})。输出：同日净账户收益差 (d_t=r_{AB,t}-r_{A,t}) 的均值/累计经济差异，以及事前选择的主要风险约束（例如最大回撤不得恶化超过阈值）；保留期末权益、Sharpe、回撤、成交数、佣金、资金费等辅助结果，不临时换主目标。配对差值之所以有用，是共同日期冲击可在差值中抵消；时间序列预测比较的原始方法亦基于同一时点的损失差序列。[Diebold & Mariano 1995](https://www.nber.org/papers/t0169)；[Nautilus v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)
- **操作 7，对固定比较做依赖稳健区间。**输入：已对齐的 (d_t) 或两条收益组成的同步向量。输出：平均增量和 HAC/Newey–West 标准误与区间，或对同步向量按时间块重采样、每次重算目标指标的区间；报告样本日期数、缺口、块长/滞后与敏感性。Newey–West 提供异方差与自相关稳健协方差估计；stationary bootstrap 通过连续时间块估计弱依赖平稳时间序列的标准误与置信区域。[Newey & West 1987](https://www.nber.org/papers/t0055)；[Politis & Romano 1994](https://doi.org/10.1080/01621459.1994.10476870)
- **操作 8，分别解释数值、区间和经济意义。**区间跨零表示按所选数据和假设无法明确增量方向；不跨零也只说明固定比较的统计证据，不能说明未来一定有效。区间很宽时按“证据不足”处理；即使区间完全为正，也要判断改善是否超过预定的经济门槛和执行模型不确定性。Sharpe 的年化与标准误对序列相关敏感，不能一律用独立同分布的平方根规则。[Lo 2002](https://alo.mit.edu/research-page/the-statistics-of-sharpe-ratios/)；[Newey & West 1987](https://www.nber.org/papers/t0055)；[v2.0.0rc3 执行粒度限制](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/data-and-venues.md)
- **操作 9，把机制归因与显著性分开。**若 A+B 变差，按第一次分叉追查：新信号、被取消/拒绝的订单、资本锁定与并发、成交、佣金、资金费、后续仓位，再回到日账户差序列。原生报告足以提供这些对象；时间序列区间回答的是效应估计的不确定性，不能识别具体哪一条订单造成了因果变化。[v2.0.0rc3 报告字段](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)；[v2.0.0rc3 执行顺序](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/execution-flow.md)；[Diebold & Mariano 1995](https://www.nber.org/papers/t0169)

### Inferences
- 对 `S, S+A, S+B, S+A+B` 四格，交互量可报告为 `(AB−A)−(B−S)`，但 B 只有在不依赖 A 仍有明确行为定义时才可跑 `S+B`；否则只报告条件增量 `AB−A`。完整 2×2 设计用于区分主效应与交互，不能把随意缺一格的比较解释成完整交互。[NIST 全因子设计](https://www.itl.nist.gov/div898/handbook/pri/section3/pri333.htm)
- 每日净账户收益的均值区间与“期末权益差”的统计对象不同；报告不能让一个显著均值区间替代期末资金、回撤和最坏路径的风险判断。[Lo 2002](https://alo.mit.edu/research-page/the-statistics-of-sharpe-ratios/)；[Nautilus v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)

### Gaps
- 一年数据能否近似弱依赖平稳、块长如何选、资金费边界和极端行情下区间覆盖率如何，不能靠一次默认重采样自动确定；需报敏感性和“不确定”而非固定门槛幻觉。[Politis & Romano 1994](https://doi.org/10.1080/01621459.1994.10476870)；[Lo 2002](https://alo.mit.edu/research-page/the-statistics-of-sharpe-ratios/)

## 问题三：Agent 试了很多变体后，怎样评估选择偏差并保住独立确认？

### Takeaway
开发期每次读回、改阈值、组合 A/B，都会把同一段年份变成选择数据；常规区间和一次配对回放不校正这一点。先保留完整候选历史并标注暴露范围，再决定使用多重比较/PBO/DSR，最终在未参与选择的时间或预先冻结的前瞻阶段做确认。[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)；[Cawley & Talbot 2010](https://www.jmlr.org/beta/papers/v11/cawley10a.html)；[Bailey et al. 2015](https://escholarship.org/uc/item/4w1110bb)

### Cited Findings
- **操作 10，保留搜索族。**输入：所有实际查看结果的候选、参数变体、组合、评估窗口、指标和失败原因，含 Agent 在读结果后放弃的尝试。输出：一个定义清晰的候选矩阵、真实尝试次数/相互依赖性、何时开始暴露某段数据。White 的 Reality Check 测试“规格搜索中最好候选相对基准没有优势”的零假设；Sullivan、Timmermann、White 的技术规则论文实际把规则全集和 bootstrap 一起评估，显示必须知道搜索范围。[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)；[Sullivan, Timmermann & White 1999](https://onlinelibrary.wiley.com/doi/pdf/10.1111/0022-1082.00163)
- **操作 11，按决策问题选校正而不堆分数。**“筛出的最佳规则是否优于固定基准”用 White Reality Check；候选中大量差规则降低检验能力时，可考虑 Hansen SPA；若要对多个具体候选控制家族错误率，可用 Romano–Wolf stepdown；若已按 Sharpe 选赢家，DSR校正多次尝试与非正态收益；若有完整候选×时间段回报矩阵，可用 PBO 的组合对称交叉验证估计样本内赢家在样本外排名恶化的概率。[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)；[Hansen 2005](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=264569)；[Romano & Wolf 2005](https://doi.org/10.1198/016214504000000539)；[Bailey & López de Prado 2014](https://doi.org/10.2139/ssrn.2460551)；[Bailey et al. 2015](https://escholarship.org/uc/item/4w1110bb)
- **操作 12，缺搜索历史时降级结论。**输出必须写“尝试数未知，不能做可信的搜索校正”，不得把历史留下来的少数成功候选伪装成全集。DSR 依赖试验次数及候选相关结构，PBO 依赖可比较的候选策略绩效矩阵；选择准则本身可被重复优化而过拟合。[Bailey & López de Prado 2014](https://doi.org/10.2139/ssrn.2460551)；[Bailey et al. 2015](https://escholarship.org/uc/item/4w1110bb)；[Cawley & Talbot 2010](https://www.jmlr.org/beta/papers/v11/cawley10a.html)
- **操作 13，冻结独立确认。**输入：候选代码与依赖/数据合同、主指标、风险上限、判定阈值、检验次数、之前暴露过的日期。输出：一次事前定义的未参与选择数据或前瞻观察结果；失败即回到新假想，不把读过的同段继续称作独立测试。Cawley–Talbot 证明模型选择准则本身可过拟合，外部评估需与选择过程分开；White 将同一数据多次用于推断或模型选择定义为数据窥探。[Cawley & Talbot 2010](https://www.jmlr.org/beta/papers/v11/cawley10a.html)；[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)
- **操作 14，区分因子与完整策略。**IC/IR 研究信号与后续收益的关联及稳定性；完整策略还需要基于成交、账户、费用、资金费和风险的净结果，且这些由原生报告分别提供。金融因子文献本身也面对大量检验导致的发现膨胀，IC/IR 也不能豁免多重测试。[Harvey, Liu & Zhu 2016](https://www.nber.org/papers/w20592)；[Nautilus v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)；[v2.0.0rc3 资金费](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/accounts-and-margin.md)

### Inferences
- 同一年反复暴露时，可以用来调试、发现机制、排除明显坏想法，但不能再被当前 Agent 宣称为同一选择过程的“独立样本外”；即使把它重新按月切块、回看留出月份，也无法撤销 Agent 已从全年结果吸收的信息。[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)；[Cawley & Talbot 2010](https://www.jmlr.org/beta/papers/v11/cawley10a.html)
- 多重比较方法是对“给定搜索空间和模型假设”的统计校正，不是没有过拟合的保证；PBO 或 DSR 的单个分数不应覆盖原生执行模型误差和未来市场机制变化。[Bailey et al. 2015](https://escholarship.org/uc/item/4w1110bb)；[Bailey & López de Prado 2014](https://doi.org/10.2139/ssrn.2460551)；[v2.0.0rc3 数据粒度限制](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/data-and-venues.md)

### Gaps
- 是否有真正未暴露数据、完整候选历史和足够长期的前瞻观察，必须由当前项目记录核实；论文不能替项目提供这些输入。[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)；[Bailey et al. 2015](https://escholarship.org/uc/item/4w1110bb)

## 问题四：交给 Agent 的最小“证据包”应包含什么，缺什么就应拒绝怎样的结论？

### Takeaway
一张排行榜会丢失来源、行为和选择路径，直接诱导 Agent 追分。最小证据包应让它读到“可比性、第一次行为分叉、净账户效应及不确定性、搜索历史、样本暴露”并逐级限定措辞。[Nautilus v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)；[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)

### Cited Findings
- **证据包字段 1，比较合同。**候选/对照源码哈希，依赖版本，输入 Catalog/时间窗/币池/初始权益/账户与执行配置，时点可得性判定，主指标与风险约束。缺任何决定可比性的关键字段时，工具输出 `not_comparable` 和具体缺项，Agent 不解释绩效差为策略增量。[v2.0.0rc3 数据时间语义](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/data/index.md)；[v2.0.0rc3 数据与场地](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/data-and-venues.md)；[Diebold & Mariano 1995](https://www.nber.org/papers/t0169)
- **证据包字段 2，原生事实。**运行状态、异常、订单完整性、逐笔成交及佣金、持仓/账户变化、资金费、第一处分叉、交易密度和关键差异事件 ID。没有原生完整性或经济核对时只能报告“运行/数据待修”，不解释差异来自策略机制。[v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)；[v2.0.0rc3 资金费](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/accounts-and-margin.md)；[v2.0.0rc3 执行顺序](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/execution-flow.md)
- **证据包字段 3，效应与不确定性。**同日期收益差序列、主指标点估计和区间、风险约束、时间块/滞后敏感性、分段描述及执行粒度限制。只有整年期末数值时仅能说“该回放实现了多少差额”，不能说差异稳定或显著。[Newey & West 1987](https://www.nber.org/papers/t0055)；[Politis & Romano 1994](https://doi.org/10.1080/01621459.1994.10476870)；[Lo 2002](https://alo.mit.edu/research-page/the-statistics-of-sharpe-ratios/)；[v2.0.0rc3 bar 限制](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/backtesting/bar-execution.md)
- **证据包字段 4，选择过程与结论上限。**本家族全部尝试/失败/主指标变更/数据窗口暴露、采用的多重比较方法及其输入充分性、独立确认是否存在。若只在反复暴露年看到改善，Agent 最多写“开发期观察”；若候选族不完整，不能提供可信 PBO/DSR 或“已校正数据窥探”结论。[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)；[Bailey et al. 2015](https://escholarship.org/uc/item/4w1110bb)；[Bailey & López de Prado 2014](https://doi.org/10.2139/ssrn.2460551)
- **输出决策枚举（建议）。**`invalid_input_or_run`、`mechanism_explained_effect_uncertain`、`development_negative`、`development_promising_needs_independent_test`、`independently_not_confirmed/confirmed_under_defined_contract`，并给出下一次最小实验。这是基于先排数据/执行、再推断和最后处理选择偏差的工程编排推论，不能替代原始统计结论。[v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)；[Newey & West 1987](https://www.nber.org/papers/t0055)；[Cawley & Talbot 2010](https://www.jmlr.org/beta/papers/v11/cawley10a.html)

### Inferences
- 以现有原生 runner 和研究索引为证据底座即可；统计脚本做可重复计算并把假设与失败条件写入结果，Agent 读证据包并决定下一实验。避免另建一套回测、订单账本或由 LLM 自算显著性。Nautilus 已提供回测原生事件与账户对象，统计方法另有明确输入假设。[v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)；[Newey & West 1987](https://www.nber.org/papers/t0055)；[White 2000](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152)

### Gaps
- 这份方法研究未核查本项目当前 `run/compare/validate` 是否已经生产上述每个字段，也未评估项目一年结果在各统计假设下的数值；必须从当前封存产物和代码另行核对，不能把“建议的证据包”描述成已经实现。[Nautilus v2.0.0rc3 报告](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/docs/concepts/reports.md)
