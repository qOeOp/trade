# 2026-10-29 文档与产品问题清单

固定实现版本 `773ac59b4c5c6043668961703c0294cef7e58e5f`。三组26个候选按根因合为 **24项：P1 1项、P2 22项、P3 1项**；其中17项有当前契约/实现证据，4项是既有或静态可见的证据缺口，3项是待测的Agent优化。复用3个既有doctor ID；原件留存与quote适用性还延续既有记录，不能把24项都称作新产品缺陷。

范围和证据边界见[审计报告](2026-10-29-doc-product-audit.zh.md)；逐章评分见[评分矩阵](2026-10-29-doc-product-score-matrix.zh.md)。本清单没有创建GitHub issue，没有实施修复或改变产品边界。

## 优先级与状态

P0指已证实需要立即处理的严重破坏，本轮无。P1指可改变研究推断或关键信任契约的当前问题；P2指会使操作、解释或维护失真的缺口；P3指先测收益再决定投入的较低紧迫优化。P级是行动顺序，不代表已观察资金损失。`verified`只表示写明的静态事实或隔离探针已核实；`known gap`表示缺口延续或恢复/经济影响未验；`inferred`表示存在具体风险路径但尚无真实误判证据。

工作量S/M/L仅表示相对范围，不是工时估计。主动作互斥统计：fix 14、remove 2、authority 1、measure 7；一项可同时含文档修正和测量，表中按先做的动作归类。

| ID | 优先级 | 类别 | 问题 | 证据状态 | 主动作 |
|---|---|---|---|---|---|
| [20261029-101](#20261029-101) | P1 | 方法契约冲突 | 样本外登记族不完整时Holm校正族随可用结果缩小 | verified | authority |
| [20261025-35](#20261025-35) | P2 | 描述不清晰 | DSR总体、有效独立试验数与统计量定义没有闭合 | known gap | measure |
| [20261029-102](#20261029-102) | P2 | 描述不清晰 | 样本外文档要求最短记录长度但指向的skill无此能力 | verified | remove |
| [20261029-17](#20261029-17) | P2 | 文档不符 | 策略库仍只列模板/用户根遗漏已批准Agent原创根 | verified | fix |
| [20261029-103](#20261029-103) | P2 | 文档不符 | 根文件头写成九组各一行但实际要求27职责各一行 | verified | fix |
| [20261029-104](#20261029-104) | P2 | 文档不符 | 归因章节承诺平均敞口归一交互项但实际读口没有 | verified | remove |
| [20261029-105](#20261029-105) | P2 | 文档不符 | 报告存储与计算职责出现多套矛盾描述 | verified | fix |
| [20261029-106](#20261029-106) | P2 | 描述不清晰 | OOS同一报告的简单收益Sharpe与对数收益Sharpe缺紧邻区分 | verified | fix |
| [20261029-107](#20261029-107) | P2 | 文档不符 | 市场提交的格式被写成40位，实际严格接受32位Dolt base32 | verified | fix |
| [20261029-108](#20261029-108) | P2 | 文档不符 | 代码设计页的接口快照与实现入口已成组漂移 | verified | fix |
| [20261029-109](#20261029-109) | P2 | 文档不符 | 完整agg_trade已上线，但数据库目录与市场设计页仍没有它 | verified | fix |
| [20261029-110](#20261029-110) | P2 | 文档不符 | 输入消费审计被描述为“只数bar且期望值独立数文件”，与实际事件核对不同 | verified | fix |
| [20261029-111](#20261029-111) | P2 | 文档不符 | 市场写入互斥被错归因给import_seq计数器冲突 | verified | fix |
| [20261029-05](#20261029-05) | P2 | 文档不符 | 预检设计页未说明runtime可缺省，返回缺exposure_exemption | verified | fix |
| [20261029-112](#20261029-112) | P2 | 产品优化与重构 | 复现合同遗漏当前host导出器与历史布局可用性的依赖 | known gap | measure |
| [20261029-113](#20261029-113) | P2 | 描述不清晰 | 共同范围“只用当时可知数据”的总括没有交代当前分类快照和导入scope | verified | fix |
| [20261029-114](#20261029-114) | P2 | 产品优化与重构 | 归档原件的持久留存与恢复仍只有局部盘点证据 | known gap | measure |
| [20261029-115](#20261029-115) | P2 | 描述不清晰 | 推算报价的局限应覆盖成交瞬间与API可成交BBO的差别 | known gap | measure |
| [20261029-116](#20261029-116) | P2 | 描述不清晰 | 英文路由仍以中文为主，翻译状态与页面语言元数据不完整 | verified | fix |
| [20261029-117](#20261029-117) | P2 | 文档不符 | 设计站的当前平台图和操作契约漏掉Paper及内嵌Agent服务 | verified | fix |
| [20261029-118](#20261029-118) | P2 | 产品优化与重构 | 聊天工具未默认继承页面的研究线和账本快照 | inferred | measure |
| [20261029-119](#20261029-119) | P2 | 产品优化与重构 | 工具按字符硬裁剪可能迫使Agent反复查SQL，尚缺信息完整性成本测量 | inferred | measure |
| [20261029-120](#20261029-120) | P3 | 产品优化与重构 | 内嵌Agent的接入测试与投研问答质量评估尚未形成同一交付证据 | inferred | measure |
| [20261029-121](#20261029-121) | P2 | 文档不符 | 首页流程图把锁定登记放在原生预检和独立审查之前 | verified | fix |

## 可执行条目

<a id="20261029-101"></a>
### 20261029-101 样本外登记族不完整时Holm校正族随可用结果缩小

**P1 · 方法契约冲突 · verified · authority · 相对工作量 M**。原审阅编号：A01。

**文档证据**：[docs/rd/validation.zh.mdx:233-239](../../../docs/rd/validation.zh.mdx#L233) 登记族由登记固定、事后不增减，三候选p=.02示例校正.06；[docs/rd/validation.mdx:236-242](../../../docs/rd/validation.mdx#L236) 同上；[docs/rd/design-code-report.zh.mdx:432](../../../docs/rd/design-code-report.zh.mdx#L432) 反规定只在有p者间校正；[docs/rd/design-code-report.mdx:435](../../../docs/rd/design-code-report.mdx#L435) 同上。

**实现与消费者证据**：[report/comparison.py:584-587](../../../report/comparison.py#L584) 全family按窗口+universe读取；[report/comparison.py:618-624](../../../report/comparison.py#L618) with_p删缺值成员后holm，区间仍用原family_size；[report/comparison.py:539-551](../../../report/comparison.py#L539) 未封存/invalid/经济不可用/序列拒绝不给p；[report/comparison.py:238-240](../../../report/comparison.py#L238) 零SE不给p。

**影响**：隔离真实validation_report读口输出family.size=3，p_holm=.02，interval coverage=.983333；完整族保守示例应.06。缺p是执行后的可用性，不是事前声明的族剔除。未观察活动账本真实错误验证结论或资金影响。

**处理方案**：先明确声明族、retry链与部分结果缺失的语义。方案一保留完整事前登记族，对未观察p采用已声明的保守处理；方案二事前明确可校正子族与不完整阶段的provisional输出，避免称作完整族结果。不能只事后把缺p成员静默删除。R的n参数只证明第一方案可表达，不决定产品唯一修法。原始结果照实披露；改校正或资格/审计条件前需单独授权。

**验收条件**：隔离fixture覆盖三成员仅一p=.02、unbound、unfinished、invalid、资格不可用、零SE、retry链，证明声明族与计算一致。[tests/report/test_integrity.py:167](../../../tests/report/test_integrity.py#L167)只测各成员用自身design；[tests/report/test_review.py:141](../../../tests/report/test_review.py#L141)只测全未绑定，未覆盖部分缺p。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 校正/审计契约变更须单独获得用户授权，本轮只诊断。

**取舍与净变化**：已有机制或公开指引直接冲突，不能依赖Agent自行猜测哪份才准确。 优先重述/合并现有机制；不默认新增存储字段、门槛或并行引擎。具体分支/字数在实施方案冻结后量。

**独立复核**：汇总审阅者已读取脚本确认所有DB/资格/单序列输入均为mock，并实际运行 `uv run --frozen python /tmp/trade-doc-audit-20261029/holm_probe.py`。未绑定成员是mock的unbound输入，p值也由mock注入；本探针验证校正族的组装口径，不验证bootstrap数值精度或真实OOS结果。真实 `validation_report` 组装返回 `family.size=3`、唯一观测 `p=.02`、`p_holm=.02`、`interval_coverage=.9833333333`。完整三项族、缺失p保守视为大于已观测p时，该项应为`.06`；当前结果与完整族声明不同。没有查询真实验证记录，不能据此称已经发生错误接受或经济损失。

**网络方法依据**：[R stats official: Adjust P-values for Multiple Comparisons](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html)：Holm针对声明的比较族；比较数可大于已观测p个数，缺失p可按大于观测值保守处理。 限制：不规定本产品retry或不完整族的唯一处理方案。；[Nosek et al 2018 The preregistration revolution](https://pmc.ncbi.nlm.nih.gov/articles/5856500/)：事前声明区分预测与事后解释，减少分析自由度。 限制：不证明本产品已改善金融收益。 检索/访问日期均为2026-10-29。

<a id="20261025-35"></a>
### 20261025-35 DSR总体、有效独立试验数与统计量定义没有闭合

**P2 · 描述不清晰 · known gap · measure · 相对工作量 M**。原审阅编号：A02。

**文档证据**：[docs/rd/comparison.zh.mdx:517-523](../../../docs/rd/comparison.zh.mdx#L517) 同精确窗口raw去重数/trial数各作端点，称扣掉运气后的夏普；[docs/rd/comparison.mdx:520-526](../../../docs/rd/comparison.mdx#L520) 同上；[.agents/skills/nautilus-report-analysis/references/ratios.md:14-23](../../../.agents/skills/nautilus-report-analysis/references/ratios.md#L14) N取精确窗口计数，V却取经济可用研究运行；[.agents/skills/research-round/SKILL.md:96-99](../../../.agents/skills/research-round/SKILL.md#L96) 重叠窗口须报全账本搜索上界。

**实现与消费者证据**：[report/status.py:158-205](../../../report/status.py#L158) 计数跨purpose，排复现/策略前失败；[report/status.py:221-226](../../../report/status.py#L221) by_development_window按精确起止分组；[docs/plans/doctor/index.zh.md:53](index.zh.md) 既有20261025-35 measure/open。

**影响**：重叠但不相等窗口搜索可漏出精确窗口N；raw源码数和trial数并未证明夹住有效独立N；Φ(...)输出DSR不是调整后SR，.3—.6应为假设敏感性读数。

**处理方案**：复用20261025-35；测重叠窗口、用途、重复源码对N/V的敏感性。区分raw trials、distinct source、effective N、V总体；全账本raw计数仅补暴露，不自动当正确N；不新增门槛。

**验收条件**：N=1、单一可用SR、方差退化、重叠窗口/跨提交和反复预检均有明确说明。报告不把两端当已校准置信范围，不把DSR称折扣后的Sharpe值。

**既有追踪与权限**：20261025-35; related20261025-10 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：已有机制或公开指引直接冲突，不能依赖Agent自行猜测哪份才准确。 优先重述/合并现有机制；不默认新增存储字段、门槛或并行引擎。具体分支/字数在实施方案冻结后量。

**网络方法依据**：[Bailey and López de Prado 2014 The Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)：DSR需要试验Sharpe的方差与有效独立尝试数，CDF型读数不是调整后的Sharpe值。 限制：不证明本库有效N、bootstrap覆盖率或任何BTC策略收益。；[Nosek et al 2018 The preregistration revolution](https://pmc.ncbi.nlm.nih.gov/articles/5856500/)：事前声明区分预测与事后解释，减少分析自由度。 限制：不证明本产品已改善金融收益。；[Harvey and Liu 2015 Backtesting](https://people.duke.edu/~charvey/Research/Published_Papers/P120_Backtesting.PDF)：搜索多重性需要明确处理，而非任意给Sharpe打折。 限制：不提供可照搬的本库或BTC通过阈值。 检索/访问日期均为2026-10-29。

<a id="20261029-102"></a>
### 20261029-102 样本外文档要求最短记录长度但指向的skill无此能力

**P2 · 描述不清晰 · verified · remove · 相对工作量 S**。原审阅编号：A03。

**文档证据**：[docs/rd/validation.zh.mdx:277](../../../docs/rd/validation.zh.mdx#L277) 指向nautilus-report-analysis/SKILL.md#deflated-sharpe并要求MinTRL；[docs/rd/validation.mdx:280](../../../docs/rd/validation.mdx#L280) 同上。

**实现与消费者证据**：[.agents/skills/nautilus-report-analysis/SKILL.md:69-80](../../../.agents/skills/nautilus-report-analysis/SKILL.md#L69) 只有references无该anchor；[.agents/skills/nautilus-report-analysis/references/ratios.md:14-23](../../../.agents/skills/nautilus-report-analysis/references/ratios.md#L14) 有DSR无MinTRL方法；[.agents/skills/research-round/references/validation.md:47-50](../../../.agents/skills/research-round/references/validation.md#L47) 缺效应分辨依据留未知，未承接MinTRL；[report/comparison.py:256-263](../../../report/comparison.py#L256) single也无MinTRL输出。

**影响**：跟随已标verified例子会找不到算法和目标，可能临时造长度或把配对MDE误当单候选MinTRL。

**处理方案**：删除虚假能力要求/死链接，描述当前窗口不确定性，缺依据留未知。若确需MinTRL，另定目标SR、置信度、依赖与成本口径，不用修链接暗加方法。

**验收条件**：所有MinTRL入口对应真实明确方法，或明确当前未提供；中英文一致且Agent不被要求凭空给数。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：已有机制或公开指引直接冲突，不能依赖Agent自行猜测哪份才准确。 优先重述/合并现有机制；不默认新增存储字段、门槛或并行引擎。具体分支/字数在实施方案冻结后量。

**网络方法依据**：[Bailey and López de Prado 2014 The Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)：DSR需要试验Sharpe的方差与有效独立尝试数，CDF型读数不是调整后的Sharpe值。 限制：不证明本库有效N、bootstrap覆盖率或任何BTC策略收益。；[William F Sharpe 1994 The Sharpe Ratio](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm)：收益定义、差额基准与观测频率决定Sharpe的解释。 限制：不要求改变现有零基准约定，也不证明策略有效。 检索/访问日期均为2026-10-29。

<a id="20261029-17"></a>
### 20261029-17 策略库仍只列模板/用户根遗漏已批准Agent原创根

**P2 · 文档不符 · verified · fix · 相对工作量 S**。原审阅编号：A04。

**文档证据**：[docs/rd/library.zh.mdx:5](../../../docs/rd/library.zh.mdx#L5) 根仅模板/用户资料两类；[docs/rd/library.mdx:8](../../../docs/rd/library.mdx#L8) 同上。

**实现与消费者证据**：[.agents/skills/research-start/SKILL.md:58-62](../../../.agents/skills/research-start/SKILL.md#L58) Agent自己设计2—3个新起点，root不用模板授权；[.agents/skills/research-round/references/template.md:21-22](../../../.agents/skills/research-round/references/template.md#L21) 原创root走同样预检/评审/登记；[ledger/strategies.py:72-118](../../../ledger/strategies.py#L72) 发布没有来源enum限制。

**影响**：可能让Agent多问模板授权，或把原创探索假设冒作原版参数转写。

**处理方案**：更新根分类与流程指针，区分来源转写和原创假设；沿用description/header/rationale表达来源，不加origin字段。

**验收条件**：chapter2与entry能正确导航到Agent原创起点，不重复问授权、不虚构一手参数出处，预检评审登记保持现有规则。

**既有追踪与权限**：复用20261029-17（已批P7）；runtime已有原创root路径，本次仅记录公开chapter2尚未同步。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：已有机制或公开指引直接冲突，不能依赖Agent自行猜测哪份才准确。 优先重述/合并现有机制；不默认新增存储字段、门槛或并行引擎。具体分支/字数在实施方案冻结后量。

**网络方法依据**：[Nosek et al 2018 The preregistration revolution](https://pmc.ncbi.nlm.nih.gov/articles/5856500/)：事前声明区分预测与事后解释，减少分析自由度。 限制：不证明本产品已改善金融收益。 检索/访问日期均为2026-10-29。

<a id="20261029-103"></a>
### 20261029-103 根文件头写成九组各一行但实际要求27职责各一行

**P2 · 文档不符 · verified · fix · 相对工作量 S**。原审阅编号：A05。

**文档证据**：[docs/rd/library.zh.mdx:119/125](../../../docs/rd/library.zh.mdx#L119) 每组一行、eval九组各一行；[docs/rd/library.mdx:122/128](../../../docs/rd/library.mdx#L122) 同上。

**实现与消费者证据**：[cli/templates/strategy-header.md:3/63](../../../cli/templates/strategy-header.md#L3)-68 每职责一行共27行；[.agents/skills/research-round/references/template.md:52-53](../../../.agents/skills/research-round/references/template.md#L52) 27duty lines in9groups。

**影响**：按章写9行会把多个经济政策合并，遗漏职责立场及登记预测的受影响ID。

**处理方案**：改为27职责逐行、分9组，引用candidate new/export给出的唯一模板，修正eval范围描述，不加格式检查。

**验收条件**：章节指引与scaffold产生同27行结构，四硬契约保留。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：已有机制或公开指引直接冲突，不能依赖Agent自行猜测哪份才准确。 优先重述/合并现有机制；不默认新增存储字段、门槛或并行引擎。具体分支/字数在实施方案冻结后量。

<a id="20261029-104"></a>
### 20261029-104 归因章节承诺平均敞口归一交互项但实际读口没有

**P2 · 文档不符 · verified · remove · 相对工作量 S**。原审阅编号：A06。

**文档证据**：[docs/rd/attribution.zh.mdx:214](../../../docs/rd/attribution.zh.mdx#L214) 仓位/容量改动另给归一交互项；[docs/rd/attribution.mdx:217](../../../docs/rd/attribution.mdx#L217) 同上。

**实现与消费者证据**：[report/comparison.py:495-503](../../../report/comparison.py#L495) 只返回四角日对数mean/contributions/test；[report/attribution.py:314-319](../../../report/attribution.py#L314) 只透传interaction。

**影响**：分析者找不到产品指标，或自行除平均敞口冒作正式交互/品质证据。

**处理方案**：优先删不存在的承诺，保留账户log交互与capital切面及条件性；不默认实现新归一指标。

**验收条件**：中英归因输出条目对应真实interaction keys；单位敞口读数不称scale-free/因果证明。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：已有机制或公开指引直接冲突，不能依赖Agent自行猜测哪份才准确。 优先重述/合并现有机制；不默认新增存储字段、门槛或并行引擎。具体分支/字数在实施方案冻结后量。

**网络方法依据**：[William F Sharpe 1994 The Sharpe Ratio](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm)：收益定义、差额基准与观测频率决定Sharpe的解释。 限制：不要求改变现有零基准约定，也不证明策略有效。 检索/访问日期均为2026-10-29。

<a id="20261029-105"></a>
### 20261029-105 报告存储与计算职责出现多套矛盾描述

**P2 · 文档不符 · verified · fix · 相对工作量 S**。原审阅编号：A07, C03。

**文档证据**：[docs/rd/report.zh.mdx:51-55](../../../docs/rd/report.zh.mdx#L51) 代码只算四类且封存一次；[docs/rd/report.mdx:54-58](../../../docs/rd/report.mdx#L54) 同上；[docs/rd/report.zh.mdx:233](../../../docs/rd/report.zh.mdx#L233) 计划胜率封存时算；[docs/rd/report.zh.mdx:89/433](../../../docs/rd/report.zh.mdx#L89) 又说年化/胜率/利润/结构读时派生不存；[docs/rd/concepts.zh.mdx:53-55](../../../docs/rd/concepts.zh.mdx#L53)（英文页同主体）运行带原生报告，seal把原生报告/日志/退出码原样存进账本；[docs/rd/ledger-runtime.zh.mdx:209-245](../../../docs/rd/ledger-runtime.zh.mdx#L209) 正确区分封存读数、语义指纹、日志及缓存。

**实现与消费者证据**：[report/measures.py:46-62](../../../report/measures.py#L46) 数十项catalogue度量；[report/measures.py:101-121](../../../report/measures.py#L101) 读取基础事实供派生；[report/measures.py:133-138](../../../report/measures.py#L133) 读时Sharpe函数；[.agents/skills/nautilus-report-analysis/SKILL.md:34-41](../../../.agents/skills/nautilus-report-analysis/SKILL.md#L34) 目录外Agent分析边界；[ledger/trials.py:274-295](../../../ledger/trials.py#L274) 封存fingerprints/结果；[ledger/execution.py:252-253](../../../ledger/execution.py#L252) 预检/正式指纹归属；执行捕获复用已存事实；[report/runs.py:135-141](../../../report/runs.py#L135) 原捕获技术事实与复现缓存区别。

**影响**：维护者无法从报告章判断哪些数应存/应复现/应由Agent算，容易加派生字段或重复实现，影响store-once和clean architecture。 概念页还把原生报告描述成原样永久入账，使新读者误以为无需镜像/输入即可直接取回所有报表。

**处理方案**：一张owner/时机表替换旧四类限定：Nautilus事实→不可再生封存读数→目录内读时派生→目录外Agent分析，链接唯一owner。 同步概念页：原生明细是可重建缓存，账本存封存读数、不可复得原件和语义指纹。

**验收条件**：年化、计划胜率、MARK回撤、capital、目录外分析各有单一owner与时机，全章无相反表述。 新读者能区分直接读取封存读数与需复现的原生明细；维护者能从唯一owner表判断应存/应算/应复现。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：已有机制或公开指引直接冲突，不能依赖Agent自行猜测哪份才准确。 优先重述/合并现有机制；不默认新增存储字段、门槛或并行引擎。具体分支/字数在实施方案冻结后量。

<a id="20261029-106"></a>
### 20261029-106 OOS同一报告的简单收益Sharpe与对数收益Sharpe缺紧邻区分

**P2 · 描述不清晰 · verified · fix · 相对工作量 S**。原审阅编号：A08。

**文档证据**：[docs/rd/validation.zh.mdx:203](../../../docs/rd/validation.zh.mdx#L203) 与开发同口径；[docs/rd/validation.zh.mdx:219](../../../docs/rd/validation.zh.mdx#L219) 均值/Sharpe区间未说log基底；[docs/rd/design-code-report.zh.mdx:385](../../../docs/rd/design-code-report.zh.mdx#L385) 底层设计已披露log，信息分散。

**实现与消费者证据**：[report/measures.py:133-138](../../../report/measures.py#L133) headline用simple returns；[report/comparison.py:224-232](../../../report/comparison.py#L224) single先log1p再算Sharpe；[report/comparison.py:237](../../../report/comparison.py#L237) limitations未说和headline基底不同；[tests/report/test_numerics.py:99-110](../../../tests/report/test_numerics.py#L99) 明确测log Sharpe。

**影响**：隔离同输入[.10,-.05,.07,-.03,.01,.02]：headline simple SR6.671746032482892，single log SR6.31389135055953。各自定义可成立，但single区间不能直接套到headline。

**处理方案**：保持数值不变，在输出局限/字段描述与高层文案紧邻说明simple/log、零基准、365日年化和区间对应统计量。

**验收条件**：两种Sharpe都有清楚收益基底，用户不把log区间当simple区间；不默改公式。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：已有机制或公开指引直接冲突，不能依赖Agent自行猜测哪份才准确。 优先重述/合并现有机制；不默认新增存储字段、门槛或并行引擎。具体分支/字数在实施方案冻结后量。

**网络方法依据**：[William F Sharpe 1994 The Sharpe Ratio](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm)：收益定义、差额基准与观测频率决定Sharpe的解释。 限制：不要求改变现有零基准约定，也不证明策略有效。 检索/访问日期均为2026-10-29。

<a id="20261029-107"></a>
### 20261029-107 市场提交的格式被写成40位，实际严格接受32位Dolt base32

**P2 · 文档不符 · verified · fix · 相对工作量 S**。原审阅编号：B01。

**文档证据**：[docs/rd/design-code-market.zh.mdx:52](../../../docs/rd/design-code-market.zh.mdx#L52)；[docs/rd/design-code-market.zh.mdx:58](../../../docs/rd/design-code-market.zh.mdx#L58)；[docs/rd/design-code-market.zh.mdx:68](../../../docs/rd/design-code-market.zh.mdx#L68)。

**实现与消费者证据**：[market/store.py:50](../../../market/store.py#L50)；[market/store.py:256](../../../market/store.py#L256)。

**影响**：读者按接口规范构造40位市场提交必被MARKET_COMMIT_INVALID拒绝；Git build_revision与Dolt market_commit概念混淆。

**处理方案**：fix：改为32位[0-9a-v]的已解析Dolt提交，并与Git 40位版本分别命名。

**验收条件**：双语三处统一；只读正反示例分别能被现有正则接受/拒绝，不改拒绝条件。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent照文档操作或解释时会被错误事实误导，现有机制不能让错误文字自动变真。 产品机制/拒绝/存储字段0变化；替换错误说明。

**网络方法依据**：[Dolt 官方哈希说明](https://www.dolthub.com/blog/2024-11-11-dolt-hashes/)：Dolt log使用32字符内容地址；区别于Git的40位标识 限制：不证明本地任意提交存在 检索/访问日期均为2026-10-29。

<a id="20261029-108"></a>
### 20261029-108 代码设计页的接口快照与实现入口已成组漂移

**P2 · 文档不符 · verified · fix · 相对工作量 M**。原审阅编号：B02, C04。

**文档证据**：[docs/rd/design-code-engine.zh.mdx:1486](../../../docs/rd/design-code-engine.zh.mdx#L1486)；[docs/rd/design-code-engine.zh.mdx:1678](../../../docs/rd/design-code-engine.zh.mdx#L1678)；[docs/rd/design-code-engine.zh.mdx:1951](../../../docs/rd/design-code-engine.zh.mdx#L1951)；[docs/rd/design-code-ledger.zh.mdx:514](../../../docs/rd/design-code-ledger.zh.mdx#L514)；[docs/rd/design-code-market.zh.mdx:877](../../../docs/rd/design-code-market.zh.mdx#L877)；[docs/rd/design-code-market.zh.mdx:178](../../../docs/rd/design-code-market.zh.mdx#L178)；[docs/rd/design-code-runtime.zh.mdx:82](../../../docs/rd/design-code-runtime.zh.mdx#L82)；[docs/rd/design-code-cli.zh.mdx:1184-1195](../../../docs/rd/design-code-cli.zh.mdx#L1184) replay_explore签名以`) -> JSON {purpose`截断；[docs/rd/design-code-cli.zh.mdx:5](../../../docs/rd/design-code-cli.zh.mdx#L5) 声称每函数列全；全文缺market_import_trades、market_upgrade的入口说明；同类问题由A/B分别找到registration与ledger/read/replay页漏参/删参，应统一根因去重；[docs/rd/design-code-registration.zh.mdx:209-213](../../../docs/rd/design-code-registration.zh.mdx#L209) export_fingerprint返回签名被截断为伪语法。

**实现与消费者证据**：[engine/run.py:818](../../../engine/run.py#L818)；[engine/run.py:805](../../../engine/run.py#L805)；[engine/run.py:683](../../../engine/run.py#L683)；[ledger/db.py:191](../../../ledger/db.py#L191)；[market/read.py:50](../../../market/read.py#L50)；[market/export.py:443](../../../market/export.py#L443)；[runtime/container.py:93](../../../runtime/container.py#L93)；[cli/main.py:736-744](../../../cli/main.py#L736) replay_explore实际签名/返回调用；:848 market_import_trades、:863 market_upgrade；[docs-site/scripts/prepare-content.mjs:35-45](../../../docs-site/scripts/prepare-content.mjs#L35)只复制MDX；[docs-site/scripts/lib/rd-index.mjs:123-155](../../../docs-site/scripts/lib/rd-index.mjs#L123)只抽已有fence作hover，未从实现反射；[docs-site/package.json](../../../docs-site/package.json) scripts仅i18n/mermaid/routes/types/build，没有签名同步；[registration/inputs.py:57](../../../registration/inputs.py#L57) export_fingerprint真实返回dict。

**影响**：add_venue漏必需fees、fill_model漏account；market_events仍列已删batch；daily_returns漏profile；service_connection仍宣称socket_path/Unix但实际config含TCP。这些是可直接误用的API，不是单纯文字风格。另有可选参/参数改名低风险漂移应一起按owner核对。 CLI页另有截断伪签名和market_import_trades/market_upgrade遗漏；三组发现属于同一手写快照漂移根因。

**处理方案**：先修已核实的当前签名与入口；操作参数以现有CLI --help为拥有者，设计页保留职责、消费者、不变量和源码定位，删除重复手抄。对需要保留的快照先用一次性AST比对验证必要/可选/keyword-only参数；只有反复漂移且收益可证时才论证生成或构建校验，不先建设新生成器。

**验收条件**：A/B/C已核实差异逐一核对当前源码；命令目录能发现market_import_trades、market_upgrade及Paper入口；hover不显示截断伪签名；250个可解析函数的23处名称/参数差异逐项判定，不把23自动计为23缺陷；设计函数与真实Python函数分清。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent照文档操作或解释时会被错误事实误导，现有机制不能让错误文字自动变真。 产品运行机制、拒绝、字段均0变化；减少重复签名来源。永久生成器或构建检查不在本轮批准范围。

**网络方法依据**：[Diataxis Reference](https://diataxis.fr/reference/)：reference需准确、精确、完整、清晰，API部分可由软件生成并链接解释/操作文档 限制：方法原则，不意味着所有文档都应自动生成 检索/访问日期均为2026-10-29。

<a id="20261029-109"></a>
### 20261029-109 完整agg_trade已上线，但数据库目录与市场设计页仍没有它

**P2 · 文档不符 · verified · fix · 相对工作量 S**。原审阅编号：B03。

**文档证据**：[docs/rd/design-database-market.zh.mdx:1](../../../docs/rd/design-database-market.zh.mdx#L1)；[docs/rd/design-ledger.zh.mdx:15](../../../docs/rd/design-ledger.zh.mdx#L15)；[docs/rd/design-ledger.zh.mdx:23](../../../docs/rd/design-ledger.zh.mdx#L23)；[docs/rd/design-code-market.zh.mdx:7](../../../docs/rd/design-code-market.zh.mdx#L7)。

**实现与消费者证据**：[market/schema.sql:100](../../../market/schema.sql#L100)；[market/aggtrades.py:1](../../../market/aggtrades.py#L1)；[market/README.md:69](../../../market/README.md#L69)。

**影响**：从设计站不能发现源交易表、八列编码和导入入口，容易把quote当完整交易原件或再次设计一张重复源表；README已准确记录但未流入设计目录。

**处理方案**：fix：补已有agg_trade与market/aggtrades.py的责任/字段/入口和不供TradeTick执行的现状，复用第一阶段已批准字段决定。

**验收条件**：数据库图/目录/代码owner索引都能定位；说明×1e8独立于bar比例、主键与无需RPI新增字段；与paper_run目录缺口由writer按根因去重。

**既有追踪与权限**：[docs/plans/aggtrades-source-import.zh.md](../../../docs/plans/aggtrades-source-import.zh.md)（已实现的phase one；不是重新批准字段） 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent照文档操作或解释时会被错误事实误导，现有机制不能让错误文字自动变真。 产品机制/拒绝/存储字段0变化；替换错误说明。

**网络方法依据**：[Binance Public Data](https://github.com/binance/binance-public-data)：官方月/日归档和CHECKSUM；官方声明归档可被后续修订；USD-M字段与时间单位 限制：不证明任一具体本地归档已经被修订或缺失；[Diataxis Reference](https://diataxis.fr/reference/)：reference需准确、精确、完整、清晰，API部分可由软件生成并链接解释/操作文档 限制：方法原则，不意味着所有文档都应自动生成 检索/访问日期均为2026-10-29。

<a id="20261029-110"></a>
### 20261029-110 输入消费审计被描述为“只数bar且期望值独立数文件”，与实际事件核对不同

**P2 · 文档不符 · verified · fix · 相对工作量 S**。原审阅编号：B04。

**文档证据**：[docs/rd/audit.zh.mdx:187](../../../docs/rd/audit.zh.mdx#L187)；[docs/rd/audit.zh.mdx:193](../../../docs/rd/audit.zh.mdx#L193)；[docs/rd/design-code-engine.zh.mdx:1803](../../../docs/rd/design-code-engine.zh.mdx#L1803)。

**实现与消费者证据**：[engine/load.py:300](../../../engine/load.py#L300)；[engine/run.py:909](../../../engine/run.py#L909)；[engine/run.py:910](../../../engine/run.py#L910)；[engine/run.py:912](../../../engine/run.py#L912)。

**影响**：当前result.iterations核对LAST+MARK+funding+生命周期及所选quotes的总事件数，期望来自export receipt；只有MARK估值时刻另从文件计算。文档的3×1000=3000例子及“完全不使用自报计数”夸大独立性，也让读者误判现有保护职责。

**处理方案**：fix：分别描述引擎消费总事件数与独立MARK估值时钟，写明receipt由导出器生成；不因文档夸大而盲加审计。

**验收条件**：双语例子按LAST与MARK及funding相加；所引用test_stream计数口径和实现一致；无需改DATA_COUNT_MISMATCH或审计。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent照文档操作或解释时会被错误事实误导，现有机制不能让错误文字自动变真。 产品机制/拒绝/存储字段0变化；替换错误说明。

**网络方法依据**：[Nautilus Bar-Based Execution](https://nautilustrader.io/docs/latest/concepts/backtesting/bar-execution/)：bar通过OHLC合成更新执行；数据粒度与撮合时序影响可解释性 限制：latest当前文档，不能直接替代uv.lock 2.0.0rc7的行为证据；本审计以本地代码/既有测试判断实现；[Diataxis Reference](https://diataxis.fr/reference/)：reference需准确、精确、完整、清晰，API部分可由软件生成并链接解释/操作文档 限制：方法原则，不意味着所有文档都应自动生成 检索/访问日期均为2026-10-29。

<a id="20261029-111"></a>
### 20261029-111 市场写入互斥被错归因给import_seq计数器冲突

**P2 · 文档不符 · verified · fix · 相对工作量 S**。原审阅编号：B05。

**文档证据**：[docs/rd/design-database-coordination.zh.mdx:39](../../../docs/rd/design-database-coordination.zh.mdx#L39)；[docs/rd/design-database-coordination.zh.mdx:49](../../../docs/rd/design-database-coordination.zh.mdx#L49)。

**实现与消费者证据**：[market/store.py:557](../../../market/store.py#L557)；[market/store.py:570](../../../market/store.py#L570)；[market/store.py:740](../../../market/store.py#L740)。

**影响**：两并发事务从同一seq各+1会写相同值，Dolt能合并；当前正常导入依赖GET_LOCK拒绝第二个导入。维护者若相信seq独立保护而绕过/删除lock，会失去该职责。当前未证实正常路径并发缺陷。

**处理方案**：fix：把互斥保证归到连接级GET_LOCK，seq只描述导入序号及允许更新范围；保留现有实现。

**验收条件**：代码设计/数据库页与README在CONCURRENT_IMPORT和锁生命周期上相同；不改锁或事务规则。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent照文档操作或解释时会被错误事实误导，现有机制不能让错误文字自动变真。 产品机制/拒绝/存储字段0变化；替换错误说明。

**网络方法依据**：[Dolt Concurrent Transaction Example](https://www.dolthub.com/blog/2023-12-14-concurrent-transaction-example/)：相同单元格写成相同值可无冲突合并；计数器+1不是独立互斥 限制：本地正常路径的GET_LOCK另有保护，不能据此断言当前产品存在并发数据损坏 检索/访问日期均为2026-10-29。

<a id="20261029-05"></a>
### 20261029-05 预检设计页未说明runtime可缺省，返回缺exposure_exemption

**P2 · 文档不符 · verified · fix · 相对工作量 S**。原审阅编号：B06。

**文档证据**：[docs/rd/design-code-replay.zh.mdx:155](../../../docs/rd/design-code-replay.zh.mdx#L155)；[docs/rd/design-code-replay.zh.mdx:160](../../../docs/rd/design-code-replay.zh.mdx#L160)；[docs/rd/design-code-replay.zh.mdx:162](../../../docs/rd/design-code-replay.zh.mdx#L162)。

**实现与消费者证据**：[replay/entry.py:406](../../../replay/entry.py#L406)；[replay/entry.py:455](../../../replay/entry.py#L455)；[cli/main.py:1328](../../../cli/main.py#L1328)。

**影响**：--runtime当前可省略并解析main；旧页仅写str且缺省说明缺失，容易再次引导照抄旧摘要。预检与随后登记仍须按现有检查匹配同一运行镜像，此处不建议删掉该条件。CLI当前已写exposure_exemption，所以旧index中的help症状不可照搬成未修。

**处理方案**：fix：校正runtime可省略/默认main和返回exposure_exemption的文档，不改变预检与登记的同镜像匹配或是否算暴露。

**验收条件**：中英文runtime类型/缺省值、返回scope与exposure_exemption都与当前help/源码一致，整项按现有ID追踪。

**既有追踪与权限**：20261029-05（部分实现/CLI已更新，设计页未更新） 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent照文档操作或解释时会被错误事实误导，现有机制不能让错误文字自动变真。 产品机制/拒绝/存储字段0变化；替换错误说明。

**网络方法依据**：[Diataxis Reference](https://diataxis.fr/reference/)：reference需准确、精确、完整、清晰，API部分可由软件生成并链接解释/操作文档 限制：方法原则，不意味着所有文档都应自动生成 检索/访问日期均为2026-10-29。

<a id="20261029-112"></a>
### 20261029-112 复现合同遗漏当前host导出器与历史布局可用性的依赖

**P2 · 产品优化与重构 · known gap · measure · 相对工作量 M**。原审阅编号：B07。

**文档证据**：[docs/rd/ledger-runtime.zh.mdx:1004](../../../docs/rd/ledger-runtime.zh.mdx#L1004)；[engine/README.md:347](../../../engine/README.md#L347)。

**实现与消费者证据**：[replay/reproduce.py:62](../../../replay/reproduce.py#L62)；[replay/reproduce.py:74](../../../replay/reproduce.py#L74)；[replay/reproduce.py:77](../../../replay/reproduce.py#L77)；[registration/comparability.py:20](../../../registration/comparability.py#L20)；[registration/inputs.py:82](../../../registration/inputs.py#L82)；engine/runtime/Dockerfile:8；[runtime/image.py:38](../../../runtime/image.py#L38)；[ledger/metrics.py:698](../../../ledger/metrics.py#L698)。

**影响**：镜像仅含engine与依赖，没有market exporter。reproduce用当前host重新导出并拒绝不同export_content；exporter源码hash只作provenance，OCI build_revision标的是runtime代码。metrics_revision可帮助定位当时host HEAD，但明确不覆盖dirty修改。三份依赖齐全并不自动证明可用当前checkout再生完全相同Catalog。现有include_quotes历史分支已说明恢复须理解历史投影。

**处理方案**：measure+fix：先补恢复recipe，区分当前读取旧seal、同契约再生与旧checkout恢复；用既有代码hash/metrics_revision/Git历史验证旧exporter，再用隔离库做跨导出版本恢复。若缺口重现，再决定把exporter纳入已钉运行边界或现有host身份；不默认新字段。

**验收条件**：选一条历史bars含quotes记录、一条新bars不含quotes记录及一个布局升级边界，在隔离恢复中证明可定位host源码并匹配原input/report指纹；无法恢复逐项报缺口。未跑前不能称全面可复现。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：纯人工临时排障能恢复个案，但当前三依赖声明隐藏了必要条件；先文档与既有身份恢复验证比增字段或兼容分支更小。 当前0；仅替换合同并做一次有边界验证。未来重构净增减待验证结果决定。

**网络方法依据**：[GO FAIR R1.2 provenance](https://www.gofair.foundation/r1-2)：数据及元数据应关联来源、生成条件和处理过程，帮助人与机器判断复用条件 限制：方法原则；不要求新增表或特定存储架构 检索/访问日期均为2026-10-29。

<a id="20261029-113"></a>
### 20261029-113 共同范围“只用当时可知数据”的总括没有交代当前分类快照和导入scope

**P2 · 描述不清晰 · verified · fix · 相对工作量 S**。原审阅编号：B08。

**文档证据**：[docs/rd/replay-environment.zh.mdx:351](../../../docs/rd/replay-environment.zh.mdx#L351)；[docs/rd/replay-environment.zh.mdx:361](../../../docs/rd/replay-environment.zh.mdx#L361)；[docs/rd/design-database-market.zh.mdx:127](../../../docs/rd/design-database-market.zh.mdx#L127)。

**实现与消费者证据**：[market/store.py:624](../../../market/store.py#L624)；[market/store.py:628](../../../market/store.py#L628)；[market/store.py:794](../../../market/store.py#L794)；[market/store.py:836](../../../market/store.py#L836)；[market/README.md:58](../../../market/README.md#L58)；[market/README.md:193](../../../market/README.md#L193)。

**影响**：成员的成交历史选择是向后看的，也保留后来下架者；但分类取最早存储观测（首导历史时来自今日exchangeInfo/名称推断），不等于各历史月当时可见元数据。pool还受初次导入scope约束。不能从这套机制直接推出完整PIT universe或覆盖全部Binance历史。已披露current terms近似不等于分类和scope也被读者理解。

**处理方案**：fix+measure：把过去成交选择、分类快照、获取范围三层并列陈述，沿用freshness.scope和instrument.observed_at，不新增存储。需要评价某窗口代表性时再核对具体历史分类/缺合约，不无条件补造或拒绝。

**验收条件**：示例清晰说明pool是钉提交内的共同范围；不得称当前分类快照为历史元数据证明；一条允许列表实例的读者能从既有命令确认scope。

**既有追踪与权限**：未在本轮关联到既有doctor ID；不代表GitHub没有同类issue。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent照文档操作或解释时会被错误事实误导，现有机制不能让错误文字自动变真。 产品机制/拒绝/存储字段0变化；替换错误说明。

**网络方法依据**：[Binance USD-M Futures Market Data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)：/fapi/v1/exchangeInfo返回当前交易规则；/fapi/v1/aggTrades聚合同价同主动方向100ms成交，包含无专用标签的RPI 限制：不能由当前说明确定各历史币种RPI上线时点或档案内实际比例；[GO FAIR R1.2 provenance](https://www.gofair.foundation/r1-2)：数据及元数据应关联来源、生成条件和处理过程，帮助人与机器判断复用条件 限制：方法原则；不要求新增表或特定存储架构 检索/访问日期均为2026-10-29。

<a id="20261029-114"></a>
### 20261029-114 归档原件的持久留存与恢复仍只有局部盘点证据

**P2 · 产品优化与重构 · known gap · measure · 相对工作量 M**。原审阅编号：B09。

**文档证据**：[market/README.md:44](../../../market/README.md#L44)；[docs/rd/design-database-market.zh.mdx:84](../../../docs/rd/design-database-market.zh.mdx#L84)。

**实现与消费者证据**：[market/sources.py:157](../../../market/sources.py#L157)；[ledger/admin.py:148](../../../ledger/admin.py#L148)；[docs/plans/market-archive-retention-inventory.zh.md:5](../../../docs/plans/market-archive-retention-inventory.zh.md#L5)；[docs/plans/market-archive-retention-inventory.zh.md:13](../../../docs/plans/market-archive-retention-inventory.zh.md#L13)。

**影响**：Dolt备份保存表历史，不自动保存外部ZIP；62份旧quote原件当时缓存哈希齐全，但查过位置未找到独立副本且未做恢复。官方可修订归档，所以未来重新下载不保证同历史字节。完整agg_trade能恢复数值语义，不恢复ZIP字节。本次未重扫host，旧盘点不能作当前丢失证明。

**处理方案**：measure：沿用现有留存缺口，先确定哪些源原件必须保留且现有备份是否已有，再做授权范围内隔离恢复；不以重下成功冒充备份验收，不默认额外备份服务或新表。

**验收条件**：有明确日期/hash清单、已存在副本位置与恢复结果；找不到时维持unknown，不修改任何备份或历史数据。

**既有追踪与权限**：[docs/plans/market-archive-retention-inventory.zh.md](../../../docs/plans/market-archive-retention-inventory.zh.md)（已知缺口，本轮未重测） 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：现有文档已诚实披露，none不足以关闭恢复缺口；只测量，不因未找到证据就新增机制。 0；留存/备份配置若需改动另行用户授权。

**边界**：本次没有重扫宿主缓存、备份或凭据，也没有修改/删除任何原件。既有盘点的62份记录只代表当时检查范围。

**网络方法依据**：[Binance Public Data](https://github.com/binance/binance-public-data)：官方月/日归档和CHECKSUM；官方声明归档可被后续修订；USD-M字段与时间单位 限制：不证明任一具体本地归档已经被修订或缺失；[GO FAIR R1.2 provenance](https://www.gofair.foundation/r1-2)：数据及元数据应关联来源、生成条件和处理过程，帮助人与机器判断复用条件 限制：方法原则；不要求新增表或特定存储架构 检索/访问日期均为2026-10-29。

<a id="20261029-115"></a>
### 20261029-115 推算报价的局限应覆盖成交瞬间与API可成交BBO的差别

**P2 · 描述不清晰 · known gap · measure · 相对工作量 S**。原审阅编号：B10。

**文档证据**：[market/README.md:104](../../../market/README.md#L104)；[market/README.md:112](../../../market/README.md#L112)；[docs/rd/replay-environment.zh.mdx:89](../../../docs/rd/replay-environment.zh.mdx#L89)；[docs/rd/replay-environment.zh.mdx:91](../../../docs/rd/replay-environment.zh.mdx#L91)。

**实现与消费者证据**：[market/quotes.py:3](../../../market/quotes.py#L3)；[market/quotes.py:63](../../../market/quotes.py#L63)；[market/quotes.py:69](../../../market/quotes.py#L69)；[market/export.py:380](../../../market/export.py#L380)。

**影响**：现有近似主要说明成交之间旧边陈旧，开头却把maker成交价当该刻best bid/ask。Binance USD-M的RPI成交进入aggTrades但无标签，API盘口排除且API订单不能吃RPI；于是最新trade也不一定是算法可执行BBO。官方FAQ发布于2025-11-17，不能拿它证明2025-10档案含RPI。当前声明近似与逐合约验证仍有用，不因这个新例子新加gate。

**处理方案**：measure+fix：作为既有quote适用性边界的补充，改“等于”为推断规则；按实际USD-M品种/启用区间查免费官方说明及已有观测BBO配对。无法区分的历史RPI影响保持unknown；不修改quote_rule、既有记录或审计资格。

**验收条件**：说明latest trade和可执行BBO差异；核对具体symbols/date与免费参考源才报告影响；旧报价规则不变，任何规则/拒绝变更另需授权。

**既有追踪与权限**：延续既有推算报价适用性缺口；本次补充USD-M RPI机制证据，不另建quote准入机制。 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent照文档操作或解释时会被错误事实误导，现有机制不能让错误文字自动变真。 产品机制/字段/拒绝0；合并一条模型假设说明，取证只围绕会改变的决策。

**网络方法依据**：[Binance USD-M Futures Market Data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)：/fapi/v1/exchangeInfo返回当前交易规则；/fapi/v1/aggTrades聚合同价同主动方向100ms成交，包含无专用标签的RPI 限制：不能由当前说明确定各历史币种RPI上线时点或档案内实际比例；[Binance What Is an RPI Order](https://www.binance.com/en/support/faq/detail/92c83c53173947c4a44f9a7277c3b9ce)：USD-M选定合约RPI仅匹配非算法订单、API订单簿与bookTicker不含RPI，aggTrades包含且无标签；发布2025-11-17/更新2026-01-05 限制：不把发布日期当所有symbols实际生效日，不外推到2025-10历史数据，不证明已有回放经济影响 检索/访问日期均为2026-10-29。

<a id="20261029-116"></a>
### 20261029-116 英文路由仍以中文为主，翻译状态与页面语言元数据不完整

**P2 · 描述不清晰 · verified · fix · 相对工作量 语言标记/状态小；全量翻译中到大（未估工时）**。原审阅编号：C01。

**文档证据**：[docs/rd/concepts.mdx:3](../../../docs/rd/concepts.mdx#L3) 明示translation pending；正文仍中文；[docs/rd/design-database-validation.mdx:1-11](../../../docs/rd/design-database-validation.mdx#L1) 英文标题/开头后直接中文表说明且无pending注记；全量inventory：47页中33页pending，9个database页中文主体无pending，5页完整英文主体。

**实现与消费者证据**：[docs-site/scripts/check-i18n.mjs:15-23](../../../docs-site/scripts/check-i18n.mjs#L15) 仅检查路由和文件存在，输出bilingual不验证译文；[docs-site/scripts/prepare-content.mjs:35-45](../../../docs-site/scripts/prepare-content.mjs#L35) 复制英文路径所对应正文；[docs-site/app/[lang]/layout.tsx:19](../../../docs-site/app/[lang]/layout.tsx#L19) en路由固定lang=en；公开HTTP：/trade/en/docs/concepts/返回200、lang=en、中文封存定义。

**影响**：英语用户和读取英文文档的Agent无法直接使用42页完整内容；辅助技术被lang=en引导读取中文。33页已诚实提示待译，不把它们描述为伪造翻译。

**处理方案**：把待译作为明确发布状态；未译主体正确标注语言，并优先补交易流程/操作页译文。check:i18n的结果文字区分路由齐备和翻译完成；不要先加自动语言拒绝门槛。

**验收条件**：代表en页的内容语言与lang一致；9个database页状态明确；英文核心流程能完整读懂；补译与原文在关键条件/单位/命令上人工核对；保留47对导航与引用可用

**既有追踪与权限**：未在当前doctor索引找到同根因已跟踪项；不是声称GitHub无同类issue 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：现有pending注记只覆盖33页，且不能修复已发布页面的语言元数据。 0：只修文档/复用既有接口

**网络方法依据**：[W3C Understanding SC 3.1.1 Language of Page](https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html)：页面主要人类语言应能被程序判断；语言元数据影响辅助技术。 限制：不要求所有内容必须翻译，不证明产品投研能力。 检索/访问日期均为2026-10-29。

<a id="20261029-117"></a>
### 20261029-117 设计站的当前平台图和操作契约漏掉Paper及内嵌Agent服务

**P2 · 文档不符 · verified · fix · 相对工作量 未测量；待实施拆分**。原审阅编号：C02。

**文档证据**：[docs/rd/design-skill-research-graph.zh.mdx:29](../../../docs/rd/design-skill-research-graph.zh.mdx#L29) 声称服务没有写接口，且说有无at都轮询；[docs/rd/platform-architecture.zh.mdx:3-9](../../../docs/rd/platform-architecture.zh.mdx#L3) 与ArchitectureOverview只提供Code/Database/Skill清单；[docs/rd/entries.json](../../../docs/rd/entries.json) 无Paper/Agent服务页；[docs/rd/design-code-cli.zh.mdx](../../../docs/rd/design-code-cli.zh.mdx)全文无paper命令；database页无paper_run说明。

**实现与消费者证据**：[services/ide/research_graph/serve.py:15-22](../../../services/ide/research_graph/serve.py#L15) 明确optional Agent/Paper proxy与Paper token；:413-427代理POST/PUT/PATCH/DELETE；:234-244仅有live页面时轮询；[services/ide/README.md:37-88](../../../services/ide/README.md#L37) 已正确说明Agent、Paper及4个compose服务；[cli/main.py:1921-1979](../../../cli/main.py#L1921) Paper start/stop/seal/delete/list/reconcile/serve；[ledger/schema.sql:240](../../../ledger/schema.sql#L240) paper_run；[ledger/paper.py:1-14](../../../ledger/paper.py#L1) 声明/封存/用户删除边界；[services/ide/docker/compose.yaml](../../../services/ide/docker/compose.yaml):ide.command默认连Paper、ledger服务及docker-api网络。

**影响**：从设计站理解部署或数据写入的用户，会把整个IDE服务当成只读graph服务，找不到Paper的生命周期、删除由用户决定、数据/镜像/网络边界。图谱API本身仍只读；这不是权限漏洞发现，proxy已有独立token/Host规则。

**处理方案**：为平台增加服务拓扑和Paper/Agent操作入口，链接已有README和CLI help，区分graph只读API、Agent只读产品工具、Paper经CLI写入；补paper_run的既有事实及消费者。修正固定at不轮询。不要合并服务、引入第二workflow或重复存储。

**验收条件**：从架构页能找到4服务拓扑、端口、谁能访问Docker、谁写哪个库；常见Paper动作按现有help可定位，删除的用户决定边界明确；同一页明确历史固定图与live刷新行为；图谱只读与optional代理边界准确；不凭文档修改放宽权限

**既有追踪与权限**：未在当前doctor索引找到同根因已跟踪项；不是声称GitHub无同类issue 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：README已正确，但当前入口/设计站明确旧主张仍发布，消费者无法仅由该页辨识作用范围。 0：只修文档/复用既有接口

**网络方法依据**：[Anthropic Building effective agents](https://www.anthropic.com/research/building-effective-agents)：优先简单可组合结构；工具接口与说明清楚；从环境反馈获取事实；复杂度由结果改善证明。已读原文§When to use agents、§Agents、§Summary。 限制：2024-12-19方法文章，页面已注明工具生态变化；只用稳定架构原则，不沿用旧SDK建议。 检索/访问日期均为2026-10-29。

<a id="20261029-118"></a>
### 20261029-118 聊天工具未默认继承页面的研究线和账本快照

**P2 · 产品优化与重构 · inferred · measure · 相对工作量 未测量；待实施拆分**。原审阅编号：C05。

**文档证据**：[services/ide/README.md:37-48](../../../services/ide/README.md#L37) 只读工具问答；[docs/plans/product-agent-chat-design.zh.md:75-80](../../../docs/plans/product-agent-chat-design.zh.md#L75)上下文进system prompt（历史设计，当前代码确实这样实现，不视为文档违约）。

**实现与消费者证据**：[services/ide/web/src/shell/agent/AgentRuntime.tsx:71-76](../../../services/ide/web/src/shell/agent/AgentRuntime.tsx#L71)发送页面line/ledger_commit；[services/ide/agent/src/chat.ts:32-38](../../../services/ide/agent/src/chat.ts#L32) context只转system文字；:61-66使用固定deps.tools；[services/ide/agent/src/main.ts:27-34](../../../services/ide/agent/src/main.ts#L27) tools在服务启动时创建，无per-request context；[services/ide/agent/src/tools.ts:17-27](../../../services/ide/agent/src/tools.ts#L17) at/line显式可选，默认head/only-open-line。

**影响**：静态事实：模型漏传at/line时读到head或别的唯一开线，即使页面显示历史图；可能把不同时点/路线的资格、目标、推荐混在一个回答里。尚无实际错误回答证据；模型现可显式传at/line，系统未自动保证同快照。

**处理方案**：先用历史图与head存在资格/目标差异的固定夹具评估；若漏传造成混读，把已有context作为请求级只读查询的默认line/at（用户显式要求当前态仍可覆盖），不要新增持久字段、会话记忆或流程引擎。返回并展示实际ledger_commit。

**验收条件**：历史图问“此时为何推荐”时，每次工具命令/结果都能核对为该快照/路线；显式“最新状态”仍能读head并说明时点改变；同一回答里跨快照比较必须明确两侧身份；无写权限变化

**既有追踪与权限**：未在当前doctor索引找到同根因已跟踪项；不是声称GitHub无同类issue 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：Agent可以手填，但同一页面时点是产品已掌握的请求上下文；先量错读率，若无影响则none，不先加检查。 建议仅工具默认值绑定1处，持久字段0、检查0；是否实施待夹具评估

**网络方法依据**：[Anthropic Building effective agents](https://www.anthropic.com/research/building-effective-agents)：优先简单可组合结构；工具接口与说明清楚；从环境反馈获取事实；复杂度由结果改善证明。已读原文§When to use agents、§Agents、§Summary。 限制：2024-12-19方法文章，页面已注明工具生态变化；只用稳定架构原则，不沿用旧SDK建议。 检索/访问日期均为2026-10-29。

<a id="20261029-119"></a>
### 20261029-119 工具按字符硬裁剪可能迫使Agent反复查SQL，尚缺信息完整性成本测量

**P2 · 产品优化与重构 · inferred · measure · 相对工作量 未测量；待实施拆分**。原审阅编号：C06。

**文档证据**：[services/ide/README.md:43-45](../../../services/ide/README.md#L43)列固定只读工具；[docs/plans/product-agent-chat-design.zh.md:74-76](../../../docs/plans/product-agent-chat-design.zh.md#L74)明示被截断会标字符数，设计上允许裁剪。

**实现与消费者证据**：[services/ide/agent/src/tools.ts:14](../../../services/ide/agent/src/tools.ts#L14) LIMIT=20000；:86-93超限把JSON字符串截为前20000字符；ToolOutput.output声明unknown，SDK可以把它当文本，JSON.parse失败本身不违约；[services/ide/agent/src/tools.test.ts:35-40](../../../services/ide/agent/src/tools.test.ts#L35)已有裁剪与原长度测试；纯函数probe提取当前outcome，经Node stripTypeScriptTypes执行：25062→20000chars，output为string，truncated=25062，ok=true；没有调用产品/模型。

**影响**：已验证交付会缺尾部且标记truncated；潜在代价是关键资格/主体/原因在尾部时，要再借SQL取数，或Agent误把局部作为全体。未观察实际误判/额外成本；ok只代表CLI成功，不声称完整。

**处理方案**：用真实形状的长state/status/report夹具量遗漏关键字段、补取调用数与token成本；首先采用窄查询/任务相关现有SQL。只有证实固定裁剪阻断决策，才在现有工具加字段投影/分页或结构化摘要，保留来源提交、缺失范围和continuation；不增加新的研究状态存储。

**验收条件**：长输出时模型知道总体范围和未读部分；关键身份/资格/局限不会仅因排序被隐藏；同一fixture比较当前策略与窄投影，报告答对率、补取次数和字符/token成本；不把原JSON可解析作为唯一成功标准

**既有追踪与权限**：未在当前doctor索引找到同根因已跟踪项；不是声称GitHub无同类issue 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：现有truncated提示是有效保护，不能直接认定产品bug；先测潜在成本，若SQL已足够则不加接口。 当前建议measure，机制净增0；后续投影/分页必须有任务收益证据

**网络方法依据**：[Anthropic Building effective agents](https://www.anthropic.com/research/building-effective-agents)：优先简单可组合结构；工具接口与说明清楚；从环境反馈获取事实；复杂度由结果改善证明。已读原文§When to use agents、§Agents、§Summary。 限制：2024-12-19方法文章，页面已注明工具生态变化；只用稳定架构原则，不沿用旧SDK建议。；[Anthropic Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)：按需披露、精简内容、适当自由度与实际使用评估；入口建议少于500行。 限制：不是把所有指导强制编码的依据；500行是建议而非质量证明。 检索/访问日期均为2026-10-29。

<a id="20261029-120"></a>
### 20261029-120 内嵌Agent的接入测试与投研问答质量评估尚未形成同一交付证据

**P3 · 产品优化与重构 · inferred · measure · 相对工作量 未测量；待实施拆分**。原审阅编号：C07。

**文档证据**：[services/ide/README.md:41-47](../../../services/ide/README.md#L41)准确说明active仅来自列模型/回答/工具调用测试，并未承诺投研能力；[docs/rd/design-skill-product-doctor.zh.mdx:26-33](../../../docs/rd/design-skill-product-doctor.zh.mdx#L26)要求沿消费与决定验证，评分和数量本身不证明改进。

**实现与消费者证据**：[services/ide/agent/src/probe.ts:33-59](../../../services/ide/agent/src/probe.ts#L33)只测models、非空ready、ping token；[services/ide/agent/src/app.test.ts:11-20](../../../services/ide/agent/src/app.test.ts#L11)固定state与mock model；:70起流式结构测试； [.github/workflows/ide-web.yml](../../../.github/workflows/ide-web.yml):agent job跑typecheck与npm test，没有调用真实研究问答模型；这是合理CI边界，不能说没测试。

**影响**：接入成功能证明工具协议可用，不能证明模型会正确区分经济资格/审计有效、开发/OOS、历史/当前快照。本轮没有实测模型失误，所以作为质量测量缺口，不把active改成新的研究资格门槛。

**处理方案**：用现有只读工具与固定公开/隔离fixture做小型领域任务集：解释失去资格的历史运行、区分OOS与开发、回答多线/长输出、不从预检指标推荐。先人工标事实、引用和时点，再跑不同provider/模型多次并量成本。用结果决定prompt/工具调整，不先加多Agent、RAG或新调度器。

**验收条件**：接入测试和研究问答评估在结果展示/文档中分清；任务答案能对照确切ledger commit与预期事实；同时报正确率、漏引/错时点、重复调用和成本，复核失败case；不以聊天评估结果改变ledger资格/审计规则

**既有追踪与权限**：未在当前doctor索引找到同根因已跟踪项；不是声称GitHub无同类issue 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：现有工程测试已充分覆盖协议，保留；产品问答承担研究解释，需要领域评估才能证明优化值得做。无实测损害前只measure。 评估工作副本/tmp与现有tests/evals数据组织；产品机制0，资格检查0，持久字段0

**网络方法依据**：[OpenAI Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)：§Evaluation process：目标、领域数据、指标、对比和持续评估；§Multi-agent：以eval结果决定复杂度。 限制：不指定本产品的通过阈值；不能把官方例子阈值照搬为投研资格门槛。；[Anthropic Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)：§Structure区分transcript与环境最终结果；§Graders区分代码、模型与人的验证职责。 限制：评测方法论，不证明某次本地回答正确。 检索/访问日期均为2026-10-29。

<a id="20261029-121"></a>
### 20261029-121 首页流程图把锁定登记放在原生预检和独立审查之前

**P2 · 文档不符 · verified · fix · 相对工作量 未测量；待实施拆分**。原审阅编号：C08。

**文档证据**：[docs/index.zh.mdx:5](../../../docs/index.zh.mdx#L5)（英文页同图）H“提假设：登记并锁定”→P“原生预检与独立审查”；[docs/rd/principles.zh.mdx:65-69](../../../docs/rd/principles.zh.mdx#L65)明确第4步预检审查、第5步登记。

**实现与消费者证据**：[registration/register.py:490](../../../registration/register.py#L490) 对每grid点require_precheck再允许登记；[docs-site/lib/research-map.ts:54](../../../docs-site/lib/research-map.ts#L54)C.6→H.4“预检通过才可登记”已正确表达。

**影响**：新读者按首页主流程先登记会被产品拒绝；正文和总览相互冲突。产品检查仍保护真实顺序，本轮未造成账本错误。

**处理方案**：首页拆开提假设与登记节点：假设/候选→预检/独立审查→登记锁定→正式回放；与已有research-map和principles共用同一叙述。

**验收条件**：首页图与skills命令顺序一致；以根/派生候选两个路径手工顺读，登记前已有同身份precheck/review；无需调整任何产品准入检查

**既有追踪与权限**：未在当前doctor索引找到同根因已跟踪项；不是声称GitHub无同类issue 本方案先修公开描述或测量；不改变现有拒绝/审计/资格条件。涉及这些条件、宿主配置或新字段的后续变更另行授权。

**取舍与净变化**：明确的入口顺序错误，已有正确拥有者可复用。 0：只修文档/复用既有接口

## 去重对应

| 原审阅编号 | 最终条目 | 去重说明 |
|---|---|---|
| A01 | 20261029-101 | 独立根因 |
| A02 | 20261025-35 | 复用既有ID，仅补当前证据/剩余范围 |
| A03 | 20261029-102 | 独立根因 |
| A04 | 20261029-17 | 复用既有ID，仅补当前证据/剩余范围 |
| A05 | 20261029-103 | 独立根因 |
| A06 | 20261029-104 | 独立根因 |
| A07, C03 | 20261029-105 | 合并同一根因，保留各消费者与验收 |
| A08 | 20261029-106 | 独立根因 |
| B01 | 20261029-107 | 独立根因 |
| B02, C04 | 20261029-108 | 合并同一根因，保留各消费者与验收 |
| B03 | 20261029-109 | 独立根因 |
| B04 | 20261029-110 | 独立根因 |
| B05 | 20261029-111 | 独立根因 |
| B06 | 20261029-05 | 复用既有ID，仅补当前证据/剩余范围 |
| B07 | 20261029-112 | 独立根因 |
| B08 | 20261029-113 | 独立根因 |
| B09 | 20261029-114 | 独立根因 |
| B10 | 20261029-115 | 独立根因 |
| C01 | 20261029-116 | 独立根因 |
| C02 | 20261029-117 | 独立根因 |
| C05 | 20261029-118 | 独立根因 |
| C06 | 20261029-119 | 独立根因 |
| C07 | 20261029-120 | 独立根因 |
| C08 | 20261029-121 | 独立根因 |
| shared-C-api-signatures | 20261029-108 | A三章的共享占位引用已映射；不另计问题 |

## 实施顺序

先处理20261029-101的统计契约选择；并行修正DSR/Sharpe、MinTRL和归因的解释边界。第二批集中修复入口流程、报告职责、API快照与数据/服务目录，使公开入口回到当前拥有者。第三批以既有Git/hash、ledger_commit、line和只读工具完成恢复与Agent消费夹具测量。只有测量证明现有接口无法满足任务，才论证请求级默认上下文、投影/分页或导出器执行边界重构；不预先添加存储字段、第二工作流或新的资格门槛。
