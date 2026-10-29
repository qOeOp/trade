# 文档与产品评分矩阵

本轮 **47 对页面、94 个 MDX 文件的章节等权总分为 73.17/100**。分数保留三组审阅笔记的原始判断，按统一权重机械换算；它表示当前文档与产品契约的审阅结果，不是测试通过率、交易绩效或投研效率实测。固定检出为 `773ac59b4c5c6043668961703c0294cef7e58e5f`，日期为 2026-10-29（Asia/Tokyo）。

本附件配合[主审计](2026-10-29-doc-product-audit.zh.md)和[issue list](2026-10-29-doc-product-issues.zh.md)使用；问题证据、验收条件和状态以issue list为准。

## 五维评分与换算口径

每个中英页面对合成一行，47 行等权。先计算每章五维加权总分，再对 47 章求平均；不按文档长度、发现数量、风险等级或已运行测试数重新加权。未运行动态验证保留为覆盖缺口，不自动计作失败。

| 维度 | 权重 | 评估问题 | 47 章等权均分（0–5） | 换算为 100 分制 |
|---|---:|---|---:|---:|
| 文档与实现一致性 | 30% | 当前契约、接口、记录和消费者是否一致 | 3.51 | 70.21 |
| 描述清晰度 | 15% | 条件、单位、状态和语言是否足以避免误读 | 3.38 | 67.66 |
| 投研方法适用性 | 25% | 是否支持有边界的研究判断及证据使用 | 3.83 | 76.60 |
| Agent 可用性 | 20% | Agent 能否发现入口、获得所需事实并完成职责 | 3.66 | 73.19 |
| 架构与维护性 | 10% | 是否有清楚拥有者、合理分工和可维护交付 | 4.09 | 81.70 |

五维均分按上述权重合成 **73.17/100**；对外可取整为 **73/100**。单章总分公式：`6×一致性 + 3×清晰度 + 5×投研方法 + 4×Agent + 2×架构`。所有单维原始分均为 0–5：5 为当前证据充分可用，4 为有小缺口，3 为存在明显改进空间，2 为影响研究判断，1 为关键错误，0 为缺失。该刻度是审阅标尺，不是统计校准后的测量。

## 47 对页面逐章矩阵

每行的中文名称链接中文源文件，EN 链接对应英文源文件。A 为研究流程审阅，B 为数据与执行审阅，C 为平台与 Agent 审阅。问题列同时保留最终编号和括号内原始编号，方便与 issue list 对照；同一根因可关联多章。

**†** 表示英文主体交付仍有缺口，统一归 `20261029-116（C01）`：33 页有待译注记，另外 9 个数据库页主体仍为中文且无同等注记。此标记覆盖 42 页，不在原始分数之上重复扣分。问题列不反复列这项跨章问题；“—”仅表示没有另外关联的具体发现，不表示已证明没有缺陷。

| 文档对 | 审阅 | 一致性 | 清晰度 | 投研方法 | Agent | 架构 | 总分 /100 | 关联问题（最终 / 原始） |
|---|:---:|---:|---:|---:|---:|---:|---:|---|
| [研发长链](../../../docs/index.zh.mdx) · [EN](../../../docs/index.mdx) † | C | 3 | 3 | 4 | 3 | 4 | 67 | [20261029-121](2026-10-29-doc-product-issues.zh.md#20261029-121)（C08） |
| [一轮研究走一遍](../../../docs/rd/tour.zh.mdx) · [EN](../../../docs/rd/tour.mdx) † | C | 4 | 3 | 4 | 4 | 4 | 77 | — |
| [核心概念](../../../docs/rd/concepts.zh.mdx) · [EN](../../../docs/rd/concepts.mdx) † | C | 2 | 3 | 3 | 3 | 4 | 56 | [20261029-105](2026-10-29-doc-product-issues.zh.md#20261029-105)（C03） |
| [1 入口](../../../docs/rd/entry.zh.mdx) · [EN](../../../docs/rd/entry.mdx) † | A | 4 | 4 | 4 | 4 | 4 | 80 | — |
| [2 策略库](../../../docs/rd/library.zh.mdx) · [EN](../../../docs/rd/library.mdx) † | A | 3 | 3 | 4 | 3 | 4 | 67 | [20261029-17](2026-10-29-doc-product-issues.zh.md#20261029-17)（A04）；[20261029-103](2026-10-29-doc-product-issues.zh.md#20261029-103)（A05） |
| [3 候选谱系](../../../docs/rd/lineage.zh.mdx) · [EN](../../../docs/rd/lineage.mdx) † | A | 4 | 4 | 4 | 4 | 5 | 82 | — |
| [4 策略文件](../../../docs/rd/strategy-file.zh.mdx) · [EN](../../../docs/rd/strategy-file.mdx) † | A | 4 | 4 | 4 | 4 | 5 | 82 | [20261029-103](2026-10-29-doc-product-issues.zh.md#20261029-103)（A05） |
| [5 提假设](../../../docs/rd/hypothesis.zh.mdx) · [EN](../../../docs/rd/hypothesis.mdx) † | A | 4 | 4 | 4 | 4 | 5 | 82 | — |
| [6 回放环境](../../../docs/rd/replay-environment.zh.mdx) · [EN](../../../docs/rd/replay-environment.mdx) † | B | 4 | 3 | 3 | 4 | 4 | 72 | [20261029-113](2026-10-29-doc-product-issues.zh.md#20261029-113)（B08）；[20261029-115](2026-10-29-doc-product-issues.zh.md#20261029-115)（B10） |
| [7 完整性审计与证据资格](../../../docs/rd/audit.zh.mdx) · [EN](../../../docs/rd/audit.mdx) † | B | 3 | 3 | 4 | 4 | 4 | 71 | [20261029-110](2026-10-29-doc-product-issues.zh.md#20261029-110)（B04） |
| [8 报告](../../../docs/rd/report.zh.mdx) · [EN](../../../docs/rd/report.mdx) † | A | 3 | 3 | 4 | 3 | 4 | 67 | [20261029-105](2026-10-29-doc-product-issues.zh.md#20261029-105)（A07）；[20261029-106](2026-10-29-doc-product-issues.zh.md#20261029-106)（A08） |
| [9 比较证据](../../../docs/rd/comparison.zh.mdx) · [EN](../../../docs/rd/comparison.mdx) † | A | 3 | 3 | 3 | 3 | 4 | 62 | [20261025-35](2026-10-29-doc-product-issues.zh.md#20261025-35)（A02） |
| [10 绩效归因](../../../docs/rd/attribution.zh.mdx) · [EN](../../../docs/rd/attribution.mdx) † | A | 3 | 4 | 4 | 4 | 4 | 74 | [20261029-104](2026-10-29-doc-product-issues.zh.md#20261029-104)（A06） |
| [11 反馈与研究优先级](../../../docs/rd/feedback.zh.mdx) · [EN](../../../docs/rd/feedback.mdx) † | A | 4 | 4 | 4 | 4 | 5 | 82 | — |
| [12 样本外验证：用户发起的一次性检验](../../../docs/rd/validation.zh.mdx) · [EN](../../../docs/rd/validation.mdx) † | A | 2 | 3 | 2 | 3 | 4 | 51 | [20261029-101](2026-10-29-doc-product-issues.zh.md#20261029-101)（A01）；[20261029-102](2026-10-29-doc-product-issues.zh.md#20261029-102)（A03）；[20261029-106](2026-10-29-doc-product-issues.zh.md#20261029-106)（A08） |
| [13 账本与运行环境](../../../docs/rd/ledger-runtime.zh.mdx) · [EN](../../../docs/rd/ledger-runtime.mdx) † | B | 3 | 3 | 4 | 4 | 4 | 71 | [20261029-112](2026-10-29-doc-product-issues.zh.md#20261029-112)（B07） |
| [14 总则](../../../docs/rd/principles.zh.mdx) · [EN](../../../docs/rd/principles.mdx) † | C | 4 | 3 | 4 | 4 | 4 | 77 | — |
| [架构总览](../../../docs/rd/platform-architecture.zh.mdx) · [EN](../../../docs/rd/platform-architecture.mdx) | C | 3 | 3 | 4 | 3 | 4 | 67 | [20261029-117](2026-10-29-doc-product-issues.zh.md#20261029-117)（C02）；[20261029-118](2026-10-29-doc-product-issues.zh.md#20261029-118)（C05）；[20261029-119](2026-10-29-doc-product-issues.zh.md#20261029-119)（C06）；[20261029-120](2026-10-29-doc-product-issues.zh.md#20261029-120)（C07） |
| [市场数据](../../../docs/rd/design-code-market.zh.mdx) · [EN](../../../docs/rd/design-code-market.mdx) † | B | 2 | 3 | 4 | 3 | 3 | 59 | [20261029-107](2026-10-29-doc-product-issues.zh.md#20261029-107)（B01）；[20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108)（B02）；[20261029-109](2026-10-29-doc-product-issues.zh.md#20261029-109)（B03）；[20261029-113](2026-10-29-doc-product-issues.zh.md#20261029-113)（B08） |
| [引擎运行器与审计器](../../../docs/rd/design-code-engine.zh.mdx) · [EN](../../../docs/rd/design-code-engine.mdx) † | B | 3 | 3 | 4 | 3 | 3 | 65 | [20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108)（B02）；[20261029-110](2026-10-29-doc-product-issues.zh.md#20261029-110)（B04） |
| [运行环境身份](../../../docs/rd/design-code-runtime.zh.mdx) · [EN](../../../docs/rd/design-code-runtime.mdx) † | B | 3 | 4 | 4 | 4 | 4 | 74 | [20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108)（B02）；[20261029-112](2026-10-29-doc-product-issues.zh.md#20261029-112)（B07） |
| [账本读写](../../../docs/rd/design-code-ledger.zh.mdx) · [EN](../../../docs/rd/design-code-ledger.mdx) † | B | 3 | 3 | 4 | 3 | 3 | 65 | [20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108)（B02） |
| [经济证据资格](../../../docs/rd/design-code-qualification.zh.mdx) · [EN](../../../docs/rd/design-code-qualification.mdx) † | A | 4 | 4 | 4 | 4 | 5 | 82 | [20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108)（shared-C-api-signatures） |
| [登记与准入](../../../docs/rd/design-code-registration.zh.mdx) · [EN](../../../docs/rd/design-code-registration.mdx) † | A | 3 | 3 | 4 | 3 | 4 | 67 | [20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108)（shared-C-api-signatures） |
| [回放入口](../../../docs/rd/design-code-replay.zh.mdx) · [EN](../../../docs/rd/design-code-replay.mdx) † | B | 3 | 3 | 4 | 3 | 4 | 67 | [20261029-05](2026-10-29-doc-product-issues.zh.md#20261029-05)（B06）；[20261029-112](2026-10-29-doc-product-issues.zh.md#20261029-112)（B07） |
| [报告读口](../../../docs/rd/design-code-report.zh.mdx) · [EN](../../../docs/rd/design-code-report.mdx) † | A | 3 | 3 | 3 | 3 | 4 | 62 | [20261029-101](2026-10-29-doc-product-issues.zh.md#20261029-101)（A01）；[20261029-106](2026-10-29-doc-product-issues.zh.md#20261029-106)（A08）；[20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108)（shared-C-api-signatures） |
| [命令行](../../../docs/rd/design-code-cli.zh.mdx) · [EN](../../../docs/rd/design-code-cli.mdx) † | C | 2 | 3 | 4 | 3 | 3 | 59 | [20261029-117](2026-10-29-doc-product-issues.zh.md#20261029-117)（C02）；[20261029-108](2026-10-29-doc-product-issues.zh.md#20261029-108)（C04） |
| [视频证据核验](../../../docs/rd/design-code-video-evidence.zh.mdx) · [EN](../../../docs/rd/design-code-video-evidence.mdx) | C | 4 | 4 | 4 | 4 | 4 | 80 | — |
| [数据库总览](../../../docs/rd/design-ledger.zh.mdx) · [EN](../../../docs/rd/design-ledger.mdx) | B | 3 | 3 | 4 | 4 | 3 | 69 | [20261029-109](2026-10-29-doc-product-issues.zh.md#20261029-109)（B03） |
| [候选与谱系](../../../docs/rd/design-database-candidates.zh.mdx) · [EN](../../../docs/rd/design-database-candidates.mdx) † | A | 5 | 4 | 4 | 4 | 5 | 88 | — |
| [试验与登记绑定](../../../docs/rd/design-database-trials.zh.mdx) · [EN](../../../docs/rd/design-database-trials.mdx) † | A | 5 | 4 | 4 | 4 | 5 | 88 | — |
| [运行结果与封存读数](../../../docs/rd/design-database-runs.zh.mdx) · [EN](../../../docs/rd/design-database-runs.mdx) † | B | 4 | 4 | 4 | 4 | 4 | 80 | — |
| [证据包与原件](../../../docs/rd/design-database-evidence.zh.mdx) · [EN](../../../docs/rd/design-database-evidence.mdx) † | B | 4 | 4 | 4 | 4 | 4 | 80 | [20261029-114](2026-10-29-doc-product-issues.zh.md#20261029-114)（B09） |
| [研究判断与主体](../../../docs/rd/design-database-judgments.zh.mdx) · [EN](../../../docs/rd/design-database-judgments.mdx) † | A | 5 | 4 | 4 | 4 | 5 | 88 | — |
| [样本外登记与时间见证](../../../docs/rd/design-database-validation.zh.mdx) · [EN](../../../docs/rd/design-database-validation.mdx) † | A | 4 | 4 | 3 | 4 | 5 | 77 | [20261029-101](2026-10-29-doc-product-issues.zh.md#20261029-101)（A01） |
| [市场数据与交易范围](../../../docs/rd/design-database-market.zh.mdx) · [EN](../../../docs/rd/design-database-market.mdx) † | B | 3 | 3 | 3 | 3 | 4 | 62 | [20261029-109](2026-10-29-doc-product-issues.zh.md#20261029-109)（B03）；[20261029-113](2026-10-29-doc-product-issues.zh.md#20261029-113)（B08）；[20261029-114](2026-10-29-doc-product-issues.zh.md#20261029-114)（B09）；[20261029-115](2026-10-29-doc-product-issues.zh.md#20261029-115)（B10） |
| [模式版本与写入协调](../../../docs/rd/design-database-coordination.zh.mdx) · [EN](../../../docs/rd/design-database-coordination.mdx) † | B | 3 | 3 | 4 | 3 | 4 | 67 | [20261029-111](2026-10-29-doc-product-issues.zh.md#20261029-111)（B05） |
| [读取视图与研究史](../../../docs/rd/design-database-views.zh.mdx) · [EN](../../../docs/rd/design-database-views.mdx) † | B | 4 | 4 | 4 | 4 | 4 | 80 | — |
| [研究入口与恢复](../../../docs/rd/design-skill-research-start.zh.mdx) · [EN](../../../docs/rd/design-skill-research-start.mdx) † | C | 4 | 3 | 4 | 4 | 4 | 77 | — |
| [研究迭代](../../../docs/rd/design-skill-research-round.zh.mdx) · [EN](../../../docs/rd/design-skill-research-round.mdx) † | C | 4 | 3 | 4 | 4 | 4 | 77 | — |
| [外部研究来源](../../../docs/rd/design-skill-research-sources.zh.mdx) · [EN](../../../docs/rd/design-skill-research-sources.mdx) † | C | 4 | 3 | 4 | 4 | 4 | 77 | — |
| [视频证据采集与核验](../../../docs/rd/design-skill-video-evidence.zh.mdx) · [EN](../../../docs/rd/design-skill-video-evidence.mdx) | C | 4 | 4 | 4 | 4 | 4 | 80 | — |
| [研究图](../../../docs/rd/design-skill-research-graph.zh.mdx) · [EN](../../../docs/rd/design-skill-research-graph.mdx) | C | 3 | 3 | 4 | 4 | 4 | 71 | [20261029-117](2026-10-29-doc-product-issues.zh.md#20261029-117)（C02） |
| [原生报告分析](../../../docs/rd/design-skill-nautilus-report-analysis.zh.mdx) · [EN](../../../docs/rd/design-skill-nautilus-report-analysis.mdx) † | C | 4 | 3 | 4 | 4 | 4 | 77 | — |
| [产品诊断](../../../docs/rd/design-skill-product-doctor.zh.mdx) · [EN](../../../docs/rd/design-skill-product-doctor.mdx) † | C | 4 | 4 | 4 | 4 | 4 | 80 | — |
| [参考资料](../../../docs/rd/appendix-references.zh.mdx) · [EN](../../../docs/rd/appendix-references.mdx) † | C | 4 | 3 | 4 | 4 | 4 | 77 | — |
| [待定与待验证事项](../../../docs/rd/appendix-open.zh.mdx) · [EN](../../../docs/rd/appendix-open.mdx) † | C | 4 | 3 | 4 | 4 | 4 | 77 | — |

## README 与运行技能的补充覆盖

以下材料参与契约核对，不另计入 47 章均分。覆盖以实际笔记为准：静态阅读、结构扫描和关键消费路径点查不等于逐行行为验收。

| README | 审阅 | 本轮覆盖 | 未完成的验证 |
|---|:---:|---|---|
| [README.md](../../../README.md) | C | 入口、存储/复现边界、目录与检查说明静态阅读 | 未逐命令初始化真实环境 |
| [engine/README.md](../../../engine/README.md) | B | 运行器、原生配对与相关实现说明对照 | 本轮未运行 paired native replay，不据此宣称 parity |
| [market/README.md](../../../market/README.md) | B | 市场数据、版本与相关导入/读取说明对照 | 未导入数据、重盘点原件或恢复备份 |
| [services/ide/README.md](../../../services/ide/README.md) | C | 图服务、Agent/Paper 代理与 Compose 拓扑对照 | 未启动真实 Paper run 或做 Docker 重启验收 |
| [services/video-evidence/README.md](../../../services/video-evidence/README.md) | C | bundle 布局、checker 职责与结果语义对照 | 未重跑真实视频采集、ASR 与媒体校验 |

| 运行技能 | 审阅 | 本轮覆盖 | 验证限制 |
|---|:---:|---|---|
| [research-start](../../../.agents/skills/research-start/SKILL.md) | A | 入口与 recommendation/readiness/selection 三份 references，关联设计说明 | 未重跑技能评测或真实起线会话 |
| [research-round](../../../.agents/skills/research-round/SKILL.md) | A | 入口、10 份 references、report 模板及相关源码消费链 | 不宣称全部 assets/模板逐行覆盖；未做真实完整研究回合验收 |
| [nautilus-report-analysis](../../../.agents/skills/nautilus-report-analysis/SKILL.md) | A | 入口与 depth/exit-reasons/ratios/capital 四份 references | 有隔离数值探针；未重演所有分析或技能评测 |
| [research-sources](../../../.agents/skills/research-sources/SKILL.md) | C | 入口及 papers/data references，来源使用与证据边界 | 未调用带密钥数据源，不把读取说明等同端点全部实测 |
| [video-evidence](../../../.agents/skills/video-evidence/SKILL.md) | C | 入口及 acquire/custody/frames/transcribe/note references；checker 关键职责点查 | 未逐函数动态验证、未执行真实媒体工作流 |
| [research-graph](../../../.agents/skills/research-graph/SKILL.md) | C | 入口、图阶段与 IDE 相关消费者；实际服务边界对照 | 未以真实会话重新构图或做 fidelity test |
| [product-doctor](../../../.agents/skills/product-doctor/SKILL.md) | C | 入口及 hosts/lenses/fidelity/attach/record 五份 references | 本轮为产品文档审查，不是研究 transcript 审计；未重跑评测 |

## 覆盖边界与机械验证

三组均对负责的中英页面进行结构、章节/规则、差异或接口扫描，并追踪选定主张的实际生产者与消费者。长 API、技能设计和参考页采用逐节/符号扫描与重点语义核对；这不等于每段文档、每个函数的所有分支都做了动态验证。历史 `docs/plans/` 做目录清单及相关决定回查，不把历史计划当作当前承诺。

本轮没有写活动账本或市场库，没有执行 native replay、真实 Paper run、完整真实投研流程、收费模型问答或当前全部 skill eval，也没有重新校准统计设计或恢复数据库备份。A 执行了隔离读口/数值探针，C 执行了输出裁剪纯函数探针；它们只支持各自注明的现象。已有代码与测试可作为静态证据，不能替代未做的路径验收。

当前提交的远端 [quality CI](https://github.com/qOeOp/trade/actions/runs/40820589069) 成功（660 项测试，ruff 与 mypy 通过）；[docs-pages CI](https://github.com/qOeOp/trade/actions/runs/40820589137) 成功。这是读取已有 CI 结果，本轮没有重跑完整套件。部署正文只通过公开 HTTP 核实了 [英文核心概念](https://qoeop.github.io/trade/en/docs/concepts/) 与 [中文研究图设计](https://qoeop.github.io/trade/zh/docs/design-skill-research-graph/) 两页；未做整站浏览器呈现、交互或辅助技术验收。

机械核对已通过：47 个 slug 各出现一次；A/B/C 分工为 17/14/16，集合无重叠且等于 `entries.json` 的页面清单；94 个 MDX 路径唯一且存在；五维分数均位于 0–5；各行总分由原始分重算；47 行均分与五维均分加权结果一致；所有关联原始编号均能映射到最终 issue 编号。README 和技能补表不计入分母，没有对跨章语言问题重复扣分。

该矩阵是可维护附件。复审时应同时保留适用 commit、改变的证据与评分理由，再重新计算；分数变化本身不证明研究效率或策略质量改善。
