# 2026-10-29 交易投研文档与产品审计

当前产品的原生执行、账本身份和只读工具边界已有清晰基础；主要问题是公开文档没有随实现收敛，以及部分统计读数的定义和消费口径尚未闭合。逐章扫描47对中英页面后形成 **24个去重条目**：1个P1、22个P2、1个P3。最先应处理样本外报告的登记族与Holm校正子集冲突；其余多数可先通过校正文档、删除不存在的承诺、复用已有拥有者解决。Agent快照继承、长输出和领域评测列为待测优化，不能据静态代码当成已发生的研究损害。逐章加权均分约 **73/100**，它是文档和产品支持研究程度的审查判断，不是策略盈利评价或上线认证。

完整交付：[47章评分矩阵](2026-10-29-doc-product-score-matrix.zh.md)；[24项issue list与逐项证据](2026-10-29-doc-product-issues.zh.md)。

## 审计范围与当前交付状态

| 项目 | 记录 |
|---|---|
| 被审研究会话 | 不适用；本次是文档和产品形态审阅，没有被审投研transcript |
| 审计宿主 | Codex本地；3个独立审阅工作流，另1个汇总复核工作流；精确模型标识与会话起止未提供 |
| 实现 / ledger | checkout `773ac59b4c5c6043668961703c0294cef7e58e5f`；远端main核对一致；未访问真实ledger，提交区间不适用 |
| 覆盖 | 47对/94个MDX、5份README、7个runtime skills及相关references；A研究流程17对、B数据执行14对、C平台Agent16对 |
| 扫描深度 | 全量目录/语言/链接静态扫描，逐章契约审阅；长API页逐节/符号扫描和重点语义复核；不等于全部运行分支动态验收 |
| 历史材料 | docs/plans按关联主张与既有决定回查；没有把所有历史计划逐份当成当前承诺 |
| 时间和成本 | 研究/发现/修复/等待及token成本未可靠拆分；不作节省量估计 |
| 无效试验 | 未读真实试验，产品造成的无效试验数未知；本次没有登记或回放 |
| 行动分布 | fix 14 / remove 2 / authority 1 / measure 7 / skill 0 / none 0；另有保留机制清单 |
| 复发与用户先发现 | 复用既有ID不等于新会话复发；本轮没有依据新增recurrence或用户先发现计数 |
| 实际净变化 | 产品机制、拒绝/审计、存储字段、skills规则均0变化；只新增审计交付 |
| 建议净变化 | 优先统一或删除重复说明；MinTRL与归一交互虚假承诺各删除1处主张；上下文/投影/导出器重构由测量决定，尚不能量化实施净分支/字数 |

查阅的当前 [quality运行](https://github.com/qOeOp/trade/actions/runs/40820589069) 显示660项测试、ruff、mypy通过；[docs-pages运行](https://github.com/qOeOp/trade/actions/runs/40820589137)成功。它们是已有CI证据，本轮没有在本地重跑完整产品套件。部署只直接抽查[英文概念页](https://qoeop.github.io/trade/en/docs/concepts/)与[研究图设计页](https://qoeop.github.io/trade/zh/docs/design-skill-research-graph/)两页；前者仍有中文主体，后者仍有未限定代理范围的“没有写接口”表述。构建成功不能替代语义核对。

## 会改变研究解释的问题先于文档整理

**20261029-101为P1统计契约冲突**：高层文档说同窗口/范围的登记族固定、不事后增减；实现展示完整族大小，却只把已有p值的成员送入Holm。独立只读mock探针已重跑（未绑定成员与p本身为注入输入，仅验证读口校正族口径）：族大小3、唯一观测p=.02时返回校正p=.02，区间覆盖率仍用完整3项族；若按完整族并对未观察p作保守处理则该项为.06。底层设计页反而明确写只校正有p者，因此这是两套契约需要选择，而非只修一个数字。R官方允许比较数大于观测p个数，支持保守方案可表达；它不决定本产品的retry、缺失与分阶段输出策略。没有查真实验证记录，尚不能声称已产生错误研究结论。([R stats p.adjust](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html))

**20261025-35继续跟踪DSR**：文档把CDF型读数说成“扣运气后的夏普”，且精确窗口raw trial/source计数与经济可用运行的Sharpe方差不是同一总体；重叠窗口搜索的披露规则还与ratio指引不一致。先把raw trials、distinct sources、有效独立N、方差总体及敏感性假设写清，不能直接把全账本raw数当正确N，也不能把两个raw端点称已校准区间。DSR原论文支持处理选择偏差与非正态性的必要性，不证明本库effective N已估好，更不证明BTC策略收益。([Bailey与López de Prado 2014](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf))

其余优先勘误包括：MinTRL链接对应的skill没有该能力；归因承诺的平均敞口归一交互项不存在；OOS日志收益Sharpe与headline简单收益Sharpe缺少紧邻区分。这里应先删除虚假能力或标清估计量，保持现有数值和研究目标。事前声明用于约束事后分析自由度，而收益、基准和频率决定比率的解释；这些方法证据没有赋予新增硬门槛的理由。([Nosek等2018](https://pmc.ncbi.nlm.nih.gov/articles/5856500/)，[Sharpe 1994](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm))

| ID | 当前问题或缺口 | 行动 | 状态 |
|---|---|---|---|
| [20261029-101](2026-10-29-doc-product-issues.zh.md#20261029-101) | 样本外登记族不完整时Holm校正族随可用结果缩小 | authority | verified |
| [20261025-35](2026-10-29-doc-product-issues.zh.md#20261025-35) | DSR总体、有效独立试验数与统计量定义没有闭合 | measure | known gap |
| [20261029-102](2026-10-29-doc-product-issues.zh.md#20261029-102) | 样本外文档要求最短记录长度但指向的skill无此能力 | remove | verified |
| [20261029-17](2026-10-29-doc-product-issues.zh.md#20261029-17) | 策略库仍只列模板/用户根遗漏已批准Agent原创根 | fix | verified |
| [20261029-103](2026-10-29-doc-product-issues.zh.md#20261029-103) | 根文件头写成九组各一行但实际要求27职责各一行 | fix | verified |
| [20261029-104](2026-10-29-doc-product-issues.zh.md#20261029-104) | 归因章节承诺平均敞口归一交互项但实际读口没有 | remove | verified |
| [20261029-105](2026-10-29-doc-product-issues.zh.md#20261029-105) | 报告存储与计算职责出现多套矛盾描述 | fix | verified |
| [20261029-106](2026-10-29-doc-product-issues.zh.md#20261029-106) | OOS同一报告的简单收益Sharpe与对数收益Sharpe缺紧邻区分 | fix | verified |
| [20261029-107](2026-10-29-doc-product-issues.zh.md#20261029-107) | 市场提交的格式被写成40位，实际严格接受32位Dolt base32 | fix | verified |
| [20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108) | 代码设计页的接口快照与实现入口已成组漂移 | fix | verified |
| [20261029-109](2026-10-29-doc-product-issues.zh.md#20261029-109) | 完整agg_trade已上线，但数据库目录与市场设计页仍没有它 | fix | verified |
| [20261029-110](2026-10-29-doc-product-issues.zh.md#20261029-110) | 输入消费审计被描述为“只数bar且期望值独立数文件”，与实际事件核对不同 | fix | verified |
| [20261029-111](2026-10-29-doc-product-issues.zh.md#20261029-111) | 市场写入互斥被错归因给import_seq计数器冲突 | fix | verified |
| [20261029-05](2026-10-29-doc-product-issues.zh.md#20261029-05) | 预检设计页未说明runtime可缺省，返回缺exposure_exemption | fix | verified |
| [20261029-112](2026-10-29-doc-product-issues.zh.md#20261029-112) | 复现合同遗漏当前host导出器与历史布局可用性的依赖 | measure | known gap |
| [20261029-113](2026-10-29-doc-product-issues.zh.md#20261029-113) | 共同范围“只用当时可知数据”的总括没有交代当前分类快照和导入scope | fix | verified |
| [20261029-114](2026-10-29-doc-product-issues.zh.md#20261029-114) | 归档原件的持久留存与恢复仍只有局部盘点证据 | measure | known gap |
| [20261029-115](2026-10-29-doc-product-issues.zh.md#20261029-115) | 推算报价的局限应覆盖成交瞬间与API可成交BBO的差别 | measure | known gap |
| [20261029-116](2026-10-29-doc-product-issues.zh.md#20261029-116) | 英文路由仍以中文为主，翻译状态与页面语言元数据不完整 | fix | verified |
| [20261029-117](2026-10-29-doc-product-issues.zh.md#20261029-117) | 设计站的当前平台图和操作契约漏掉Paper及内嵌Agent服务 | fix | verified |
| [20261029-118](2026-10-29-doc-product-issues.zh.md#20261029-118) | 聊天工具未默认继承页面的研究线和账本快照 | measure | inferred |
| [20261029-119](2026-10-29-doc-product-issues.zh.md#20261029-119) | 工具按字符硬裁剪可能迫使Agent反复查SQL，尚缺信息完整性成本测量 | measure | inferred |
| [20261029-120](2026-10-29-doc-product-issues.zh.md#20261029-120) | 内嵌Agent的接入测试与投研问答质量评估尚未形成同一交付证据 | measure | inferred |
| [20261029-121](2026-10-29-doc-product-issues.zh.md#20261029-121) | 首页流程图把锁定登记放在原生预检和独立审查之前 | fix | verified |

## 产品优化围绕拥有者与消费结果收敛

第一层是让公开契约回到实际拥有者。首页的“登记→预检”顺序、27职责行与九组的区别、报告封存/读时派生/原生缓存职责、32位Dolt身份、消费审计和并发锁说明均有确定的本地勘误路径。API设计页与hover复用了手写快照，250个可解析函数中23处名称/参数差异只应作为逐项核对输入；先以源码和现有CLI help为参数拥有者，减少重复抄写，不能由此直接推导必须建设新文档生成器。参考资料的精确性与解释/操作文档的分工可作为维护原则。([Diátaxis Reference](https://diataxis.fr/reference/))

第二层是补齐现有产品形态。设计站缺少完整agg_trade、Paper生命周期、paper_run及可选Agent/Paper代理的操作入口，README和现有服务实现已经有这些事实。应补当前四服务拓扑、读写边界与命令导航，明确图API只读和可选代理的差别，不合并服务或再造投研调度。英语内容42/47页尚非完整英文，其中33页明确待译、9个数据库页中文主体无同样注记；先准确标注主体语言和发布状态，再按使用路径补译。语言元数据是可访问性事实，不要求由此增加自动拒绝发布门槛。([W3C Language of Page](https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html))

第三层是先证明恢复与信息消费的收益。旧运行重建还依赖host导出器及历史布局，单有账本/镜像/市场提交不自动证明当前checkout能再生旧Catalog；先用已有Git/hash/metrics_revision做隔离恢复recipe。共同范围也要把过去成交选择、元数据观测时点、初次导入scope分开；源ZIP可被官方修订，重下成功不等于历史字节恢复。推算quote的近似还应包括当前USD-M RPI成交与API可执行BBO不同的边界，但具体历史品种/日期影响未知，不能据新FAQ回推旧档案已受损。([Binance Public Data](https://github.com/binance/binance-public-data)，[Binance USD-M RPI说明](https://www.binance.com/en/support/faq/detail/92c83c53173947c4a44f9a7277c3b9ce)，[FAIR provenance](https://www.gofair.foundation/r1-2))

Agent侧只提出三个有具体夹具的测量：历史图/当前head存在差异时是否混读；长state/report裁剪是否漏关键身份并增加补取；协议接入成功是否对应正确的投研解释。若已有line/ledger_commit上下文和窄SQL足够，就保持现状；若真实失败成立，再把请求上下文默认注入已有只读工具或做任务相关投影。用事实正确、引用时点、资格/审计/OOS区分、补取次数和成本验收，不凭更多Agent、RAG或更长prompt推定改善。简单可组合工具和基于任务的eval支持这个顺序，不给本产品指定通过阈值。([Anthropic Building effective agents](https://www.anthropic.com/research/building-effective-agents)，[OpenAI Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices))

| 顺序 | 具体交付 | 成功判据 | 机制取舍 |
|---|---|---|---|
| 1 统计契约 | 完整族/缺p声明，DSR与两种Sharpe的意义，删除未提供能力 | 固定夹具与文档/输出表达一致，原始结果及限制可读 | 修改统计/审计条件前单独授权；不先增门槛 |
| 2 公开契约 | 入口顺序、单一报告owner表、API/数据/服务目录 | 从页面能定位当前命令/源码；无相反承诺与伪签名 | 减少重复描述；产品机制0新增 |
| 3 恢复链 | 旧导出器定位与跨布局隔离恢复recipe | 原input/report指纹可匹配，失败明确缺什么 | 优先既有身份；未证明必要不加字段 |
| 4 Agent消费 | 历史快照、长输出、领域问答固定任务集 | 事实与时点正确、成本及补取可比较 | 先measure，才决定默认context/投影；不加第二workflow |

## 保留边界与已有修复不重新开单

| 机制 | 防护或职责 | 本轮判断 |
|---|---|---|
| Nautilus订单、成交、结算、账户事实 | 单一经济事实拥有者 | 保留；已有费用、funding、quote/mark与近似说明，不应笼统报缺失 |
| CLI唯一写入口、Agent allowlist/argv及DB reader权限 | 把写权限与模型文本分开 | 保留；没有发现需要改为自建研究engine的依据 |
| 图extract/contract/layout/render/compare分离 | 各阶段产物有明确消费者 | 保留；没有已证实合并可减少成本 |
| 七个skills渐进披露 | runtime原则与按需reference分开 | 入口约34–131行，篇幅本身不构成整体重写理由 |
| 视频独立checker与语义判断分离 | 材料内部一致不冒充语义完整 | 保留；未重跑视频不构成删除边界的证据 |

能力要由任务结果而非流程数量证明，skills应保持按需披露；评测还要区分协议transcript、环境结果和人工判断。这些原则支持先量具体失败再改机制，不支持因未触发就删掉独立保护。([Anthropic Skill authoring](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)，[Anthropic Agent evals](https://www.anthropic.com/research/demystifying-evals-for-ai-agents))

当前源码已包含20261029-07的按执行方式省略未消费quote及历史receipt投影、20261029-16的coverage固定处理解释；P5/P7/P8的runtime核心文字也已存在。本轮没有走真实研究消费者，故写作“已见实现，路径未验证”，不把旧索引open直接当当前仍缺失，也不宣称已经完成会话验收。20261029-05的CLI help症状已更新，仍保留设计页剩余勘误；20261029-17只补公开策略库尚未同步的部分。

## 验证范围与待用户决定的边界

独立汇总重跑了完全mock的Holm报告组装，读取实际源代码并复核R官方说明；三组另提供文档函数AST比对、简单/对数Sharpe数值例、工具outcome纯函数裁剪和公开HTTP检查。没有读真实ledger、做原生paired replay、恢复数据库/旧Catalog、运行Paper、调用真实问答模型、重跑全部skills eval或做整站浏览器/辅助技术验收。因此恢复成功率、统计覆盖率、真实模型误判和经济影响仍未知；工程CI不能替代它们。

本轮没有新的实施授权，也没有提出即时权限问题。20261029-101涉及统计契约/潜在审计口径，后续实施前需按AGENTS单独说明当前行为、改后允许/表达什么及替代路径。既有2026-10-29 consolidation决定保持：P1/P3及P5–P9按已批准范围，P2不批、P4不动、P10/P11暂缓；本报告不借文档审计重新开启被拒或暂缓方案。任何新存储字段仍需独立评审并另记设计决定。

各条目网络来源、适用范围与限制在issue详情就地列出，访问日期均为2026-10-29；外部规范只支持方法与机制解释，本产品事实由固定checkout和明确探针支持。三份交付记录本次审阅，不代替doctor索引，也不关闭未到达的消费者路径。
