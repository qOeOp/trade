# 投研记录如何服务策略迭代（待验证设计）

## 决策与证据边界

本设计的消费者是**后继研究 Agent**。它要从旧研究中找可复用的机制和反例、选有效的经济对照、确定失败发生在哪一层，以及找到可以回退的实际源码。记录准确率和决策效能是近期可测目标；**可用策略的产出率是否提高，目前没有证据**，需要后继的独立验证。现有[Git 记录与本机封存命令](../../research/records/README.md)收录七条事后回填的历史尝试与一条事前登记的 F01 尝试；[H18a 案例](research-record-h18a-case.zh.md)检验依赖式组件组合，[F01 四格案例](r1-factorial-line-cancel-result.zh.md)检验可开关组合。单机封存与恢复已用真实回放验收；异机备份、长期保管及研究效率的量化验证尚未完成。

外部依据与 Trade 的推断必须分开：

| 外部依据 | 能支持什么 | 不能直接推出什么 |
| --- | --- | --- |
| [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)用实体、活动、责任主体及派生关系表达来源；[FAIR 原则](https://www.nature.com/articles/sdata201618)要求可查找、可访问、可互操作、可重用的标识与元数据。 | 保存源码、输入、报告的身份和关联；原物缺失后仍保留其元数据与可用状态。 | 本项目必须用图数据库、四类对象或某种文件格式。 |
| [Sandve 等的可复现研究规则](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003285)强调保存影响结果的输入、程序版本、参数与结果链。 | 结果须绑定**实际执行字节**；单独一个 Git 提交号不足以证明带未提交修改的运行。 | 保存整段 Agent 对话，或证明记录会增加策略收益。 |
| [Bailey 等的 PBO](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)与[败者调整 Sharpe 的 DSR](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)讨论多候选选择导致的回测偏差。 | 保留失败与未选候选、选择过程、同口径逐期收益及数据暴露；重复看过的年度不能充当新的独立样本。 | 将 S/D/H 编号数直接当成有效独立试验数，或从现有台账算出可靠的 PBO/DSR。 |
| [Qlib Recorder 官方文档](https://github.com/microsoft/qlib/blob/main/docs/component/recorder.rst)把 experiment、recorder、参数、指标和产物分层；[MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)提供 run ID 与可查的元数据和产物；[DVC Experiments](https://doc.dvc.org/user-guide/experiment-management)围绕 Git 基线管理文件化实验。 | 借用“研究集合—运行—产物”的读回方式，并在出现明确瓶颈时评估现成工具。 | 这些工具知道假设为何改变、哪个运行是合法对照，或能替代 Nautilus 的账户事实。 |

Trade 的工程推断是：先补**可信的关系与证据读回**，再看是否有必要做独立模块。当前 [R1 runner](../../strategies/r1/run_portfolio.py)已产生摘要和原生报告，[实验台账](../../research/r1_native/RD_EXPERIMENTS.md)持续记录研究；但 [R1 README](../../strategies/r1/README.md)将 `/tmp` 回放目录视为本地证据。[F12](r1-native-rd-findings.zh.md)、F09、F05 的运行源码身份、长报告接管、已暴露数据记录是具体动机。H19a 的配对及审计更正还说明，“通过/失败”一个标签会丢失重要的原生事件与修正链。

## 第一版产品形态与保管

**当前形态是 Git 侧录 + 可配置本机产物目录 + 命令行。** 新研究在仓库内存放版本化的 `attempt.json`、`run.json` 和简短 Markdown 解释；用 [JSON Schema](https://json-schema.org/understanding-json-schema/reference/schema)固定键、类型与 `schema_version`。JSON 便于校验和 Agent 精确查询，Markdown 写机制、反例与裁决理由，原生 CSV/Parquet 保持行级事实。产物根目录位于 Git 与 `/tmp` 之外，由调用方配置：

```text
research/records/schemas/{attempt,run}.schema.json
research/records/attempts/<attempt_id>/attempt.json
research/records/attempts/<attempt_id>/interpretation.md
research/records/runs/<run_id>/run.json
<configured local artifact root>/<run_id>/{input-identity.json,source,reports,manifest.json}
```

### MVP 技术决定与试点现状

沿用仓库的 [Python 3.14 与 uv 锁定环境](../../pyproject.toml)。记录读回和本机封存都用 Python 标准库与现有 Git；研究解释继续用 Markdown。格式采用 [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)，已锁定 `jsonschema` 并在项目 Python 环境运行校验。Nautilus 原生 CSV 报告和现有 `ParquetDataCatalog` 保持权威数据格式，不另建交易结果库。

**Git 边界：**直接使用 Trade 项目所在宿主机的现有 Git 仓库及 `git` 命令；`attempt.json`、`run.json`、解释和 schema 与 Strategy 源码一起提交、评审和合并。不创建第二个 Git 仓库或代替项目 Git 的封装层。当前封存命令只接受已提交的源码 ref，提取其 Python 字节到运行目录并从该副本执行；不能拿工作树当时的 `HEAD` 冒充实际运行字节。多个 Agent 各自在项目工作树或分支登记，沿用项目现有合并流程。

大型原生报告与输入身份放在可配置的本机文件根目录，位于 Git 和 `/tmp` 之外。已实现同文件系统 staging、逐文件 SHA-256、原子发布、拒绝同 ID 覆盖、校验、第二目录复制与恢复；真实 37 币回放通过本机副本恢复。两目录目前在同一宿主机，磁盘损坏仍可能同时丢失，异机备份与长期恢复是单独的运维验收。**不引入 SQLite、服务、MLflow 或 DVC**；只有实测文件查询耗时或并发错误成为问题，才从侧录重建 SQLite 派生索引。

产物 manifest 保存输入身份、实际执行源码包或可精确恢复的源码引用、锁文件身份、Nautilus 原生报告的相对 URI 与 SHA-256。历史 Catalog 不复制进 Git，侧录只记录其数据身份、覆盖、可交易窗口和读取状态。运行可先分配 ID，封存后才把该 `run_id` 标为可引用的完成产物；缺失文件保留原 URI/哈希与 `unavailable`，不得声称仍可逐事件复核。Git 提交记录登记先后；它不保证远端历史永远不可改写，因此重要登记和产物还须按摘要核对。

已实现只读 `uv run --frozen python -m research.records.cli show H13c`、`find --mechanism ... --failure-layer ...`、`compare <run-id> <control-run-id>` 与 `validate`，以及 `research.records.artifacts run/verify/backup/restore/register`。后者从冻结源码运行既有 R1 runner，核对输入 Catalog 身份、原生报告和审计，再封存；Git `run.json` 以 manifest SHA-256 绑定本机目录。历史 `/tmp` CSV 仍不能因新工具存在而宣称可恢复，记录的同口径比较也不能单凭契约字段证明逐事件成本完全相同。SQLite 如被引入，仍只是可从 Git JSON 与 manifest 重建的索引，不是第二份权威。需要共享 UI、跨机器运行跟踪时才评估 MLflow；主要痛点是大数据及流水线版本时才评估 DVC。两者在本仓库的版本兼容、上传成本、并发与集成工作量均未验证；官方存储分层见 [MLflow 架构](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/)及 [DVC 远端存储](https://doc.dvc.org/user-guide/data-management/remote-storage)。

## 最小数据模型

**只设两种侧录：一次研究尝试与一次实际运行。** Strategy 仍由 Git 管源码，不另建策略版本主表；证据先作为带类型的引用嵌入记录，复用需求成立后再考虑独立登记。一次尝试可以没有回放，也可有 pilot、失败、修复与完整配对的多个运行。旧历史只补已证实字段，缺失写 `unknown`；不得把事后补录写成事前预测。当前 JSON Schema 覆盖八条尝试、九条已保留的运行及 F01 的四格引用；新运行可以引用 `artifact://` 封存目录，失败执行允许缺少未产生的原生摘要与审计。Agent 的假设登记仍由 Agent 自己完成，不由封存工具自动生成。

| 侧录 | 建议最小字段及语义 |
| --- | --- |
| `attempt.json` | `schema_version`, `attempt_id`, `question`, `hypothesis`, `mechanism`, `falsifier`, `hypothesis_parent`（及其被否定的精确命题）, `code_parent`（源码 Git ref/摘要）, `planned_control`, `comparison_family_id`, `selection_rule`, `exposure`（已读数据/结果窗口）, `registration_ref`, `evidence_refs`。没有父节点或对照时写原因；`registration_ref` 只有结果读取前封存才可标 `preregistered`。 |
| `run.json` | `schema_version`, `run_id`, `attempt_id`, `role`（候选/对照/诊断）, `status`, `source_digest`, `runner_digest`, `dependency_digest`, `nautilus_version`, `input_manifest_digest`, `data_refs`, `windows`, `account_contract`, `fee_funding_assumptions`, `artifact_refs`（URI、SHA-256、可用性）, `integrity_result`, `limitations`, `control_run`, `fixes_run`。失败运行的经济指标可缺，但已产生的报告仍要引用。 |

`hypothesis_parent` 表示新问题承接哪个失败命题；`code_parent` 表示实际源码从何处修改；`control_run` 表示本次要与哪个冻结运行作经济对照；`fixes_run` 仅表示新运行修复了旧运行的执行或报告缺陷。它们可指向不同对象，不能以 Git 父提交或 MLflow 父 run 自动推断。H18a 案例还需要单独的运行 `source_revision`：试点已核对冻结提交中四个源码文件的字节哈希与原生摘要一致，但不能由此倒推出 `code_parent`、完整依赖环境或当时的输入字节。Markdown 解释写“原生事件支持了什么、否定了什么、仍未知什么、下一步为何回退/延伸/停止”，并引用具体 run 与报告哈希。若只是审计解释有误，在新的 Git 版本中指明被更正的旧解释提交，保留原始报告，不伪造修复运行。事前登记以首次提交的 `attempt.json` 版本为准；后续版本可填 `registration_ref` 指向该提交，不能用文件内自引用的提交哈希。JSON Schema 应约束必需键、枚举、引用类型及 `unknown/unavailable` 状态；这里列的是**最小草案**，应先用真实记录检验而非一次性冻结长期标准。

比较前必须核对同一策略/共享账户资本口径、数据身份及可交易窗口、合约/费用/资金费假设、原生版本与订单完整性。对照不可比时返回具名原因，不计算“提升”；已暴露样本的较好结果只能标为研发证据。H19a 的 37 币是**一个 Strategy、一个原生账户**，不能拆成 37 份独立资金曲线再挑赢家。新记录不设计交易语言、撮合器、账本、自动研究决策或资格判定；订单、成交、风控、资金费与账户仍以 Nautilus 为准。

## 假设分叉与受控组合的待实施契约

这里的“蜂窝”是 Agent 可查询的**局部视图**，不是新的策略语言或图数据库。每个真实提出的研究尝试使用稳定、不编码祖先序列的 `attempt_id`；`A1B`、`A6D3` 只可作为显示别名。尚未提出的理论组合不建节点。尝试的创建、结果、更正各保留 Git 历史，不用覆盖失败节点来表达一次修复。

**三种关系必须分开。** `parents[]` 描述新假设由哪些旧假设延伸、修复或组合，必须指向登记时间更早的节点，构成可验证的多父无环图。每条边写被保留的机制、被放弃的前提及这次差异；同一节点可有多个假设父节点，但实际源码基底由单独的 `code_parent` 和执行源码摘要证明，不能由假设父节点推断。`mechanism_refs[]` 说明从别的尝试借用了什么可独立识别的组件，以及**没有继承**其完整假设和失败结论；它不充当假设父节点。`knowledge_links[]` 可记录 `revisits`、`challenges`、`corroborates` 等跨研究解释，并注明适用市场、窗口和证据；它们可以双向或有环，但不参与版本衍生与回放血缘。试点已用 H18a→H15a 的假设父关系和 H18a→H08 的组件来源检验前两类；F01 还以 H19a 与 H18a 为两个假设贡献来源，并绑定 00/10/01/11 四次实际运行。知识链接仍缺真实样例。

一个 A1+B 组合须在读取新结果前登记以下**决策契约**，并与之后的证据分开保存：

| 必填问题 | A1+B 示例的含义 |
| --- | --- |
| `origin`、两个因素及父贡献 | 固定共同基线；A1 改哪一类错误，B 改哪一类错误；分别保留 A1/B 的哪项机制，是否依赖或冲突。A、B 整体未达 Goal 不等于其组件可用。 |
| 可否证预期与停止条件 | B 为什么预计修复 A1 的剩余失败；来源、数据、执行、容量和经济门槛分别怎样使组合停止。不能由已读年度利润反填预期。 |
| 候选全集、预算与暴露 | 同族还考虑过哪些组合及淘汰原因、允许多少次原生回放、哪些窗口和指标已被 Agent 看过。失败的来源门槛也占一个实际尝试，但不冒充经济试验。 |
| 冻结比较口径 | 四格使用同一输入身份、交易窗口、37 币共享账户、起始资本、风险和成本假设、Nautilus 版本及原生审计；预先指定主要经济响应和非劣条件。旧 A1/B 运行若口径不同，不能直接凑成四格。 |

若 A1 和 B 能在共同 origin 上**独立开关**，以 `00=origin`、`10=A1`、`01=B`、`11=A1+B` 组成一个 `comparison_family_id`。每格绑定一个实际 `run_id`、源码摘要、原生报告、完整性和暴露等级；任一格无运行时保留其缺失原因，结论只能是“组合观察”，不能称交互已测。对事前定义的可加响应 `Y`，可描述 `Y11−Y10−Y01+Y00`；Sharpe、最大回撤或共享账户资金占用不能当作可加机制贡献。四格必须检查原生订单、费用、资金费、净账户逐期结果，以及组合是否因同账户资金争用改变执行路径。如果 B 只有在 A1 存在时才有定义，设置 `composition_mode=dependent`，只做与冻结母策略的同口径配对，不制造一个不存在的 B-only 格子，也不使用二因子交互语言。[NIST 全因子设计](https://www.itl.nist.gov/div898/handbook/pri/section3/pri333.htm)支持四格识别交互的实验结构；将其用于本项目的原生回放仍是待验证的工程推断。

组合完成后，无论来源门槛失败、执行失败、经济失败还是不确定，A1+B 节点都保存**最窄失败层**、已完成和未完成的格子、原生证据、下一步是停止、修复、回退还是等待新数据。只要没有真实回放，就不造 `run`；回放发生后，即使失败也保留运行及审计。再改出 A1B1 时创建新节点并指向 A1+B，不能改写 A1+B 的结论。查询至少要回答“为什么组合”“四格是否同口径”“失败发生在哪层”“回退到哪个假设及哪份源码”“这个组合是否已在已暴露年度试过”。

**两种组合形态已有真实读回。** [H18a 案例](research-record-h18a-case.zh.md)证明“借用 H08 的趋势线状态”与“继承 H08 的入场假设”必须区分：H18a 真正延伸 H15a，并以 H15a 为经济对照；没有合法的 H08-only 格子。[F01 四格案例](r1-factorial-line-cancel-result.zh.md)在共同 H15a 基线上分别开关 H19a 整套计划 A 和趋势线取消 B，事前登记后实际运行四格，保存失败的 11 格及两个假设贡献来源。`show F01` 能读回四格运行 ID，`compare F01-11-20261008 F01-10-20261008` 能核对同口径账户差。随后 F01 完整 37 币运行也经本机封存、恢复与同口径原生配对验收。它只证明这一小段血缘、配对及单机保管可表达、可检索；知识链接、异机长期恢复及 Agent 决策效益尚未由真实案例验收。图形布局是否值得做，仍以既定交叉盲评的检索正确率、决策质量、时间及维护成本决定；策略成功率需另用未来未暴露证据判断。

## 下游 Agent 应能做的事

| 查询/动作 | 记录帮助它避免什么错误 | 硬限制 |
| --- | --- | --- |
| “H13c 为什么出现？H13、H13b 各失败在哪层？”沿假设父链读来源、首次可下单条件、原生运行。 | 将来源时序失败误算为经济亏损，或重复试已证伪的精确定义。 | 侧录不能替 Agent 选择下一个机制；来源仍需回看原片。 |
| “H19a 比谁好？”按 `control_run` 取 H18a 的同窗口、同账户配对及原生报告。 | 只拿两个摘要数值作无效对比。 | 同一年反复研究属于已暴露样本，配对优势不是独立资格。 |
| “这次变坏回退到哪里？”分查 `code_parent`、`hypothesis_parent` 和最近可复核的对照。 | 回退源码却继续沿用已否定的假设，或回退假设却错用运行字节。 | 回退点是建议与证据，不自动部署或替 Agent 作交易决定。 |
| “旧负结果是否能用于新研究？”按机制、失败层、市场/周期、来源、数据暴露检索，并打开 typed 证据。 | 只找赢家，重复昂贵年度回放，引用遗失的原生报告。 | 搜到相似案例不证明新机制可赚钱；`unavailable` 只能保留线索。 |

## 如何量化是否值得继续投入

已完成[四题命令层机械基准](research-record-efficiency.zh.md)：`show --brief` 对 H13c/F01 相比完整读回减少 58.8%/85.8% 的输出字节，但文件搜索的机器耗时更短，且各题输出长短并非总有利于索引。**Agent 检索准确率、决策质量、总耗时和录入成本仍未量出。**现有台账可提供真实测试题，但 F25 的“八个完整候选”只是截止 H12 的历史截面，不能用作今天的实验总数；D59 来源门槛失败、H19a 两币 pilot 和 H19a/H18a 年度配对也不能混作同一种试验。F24 的双零集误判和 H19a 审计更正可测试错误识别。先建立逐条可查的答案和证据，记录目前文件搜索条件下的基线；不预填 Agent 效率改善百分比。

**近期交叉试点：**封存两组难度相近的真实任务，覆盖 H13 失败链、H18a/H19a 合法配对、负结果复用和审计更正。固定模型、工具权限、时间与计算预算，让同一批 Agent 在“现有台账 + 文件搜索”与“少量经核实的侧录 + 按 ID 读回”之间交叉切换，平衡顺序；裁判只看匿名答案与原始证据。历史侧录只能补实证可查字段，不能把答案或后见结论倒填成事前登记。交叉设计仍会受学习、任务难度和模型变化影响，因此记录这些混杂并报告样本量与不确定区间。

| 指标 | 量法与预先判定方向 |
| --- | --- |
| 检索正确性 | 父假设、源码字节、主要对照、原生报告及更正结论找对率；误报/漏报、可打开原始证据比例。**正确率不得下降**，速度快而错更多视为失败。 |
| 决策质量 | 盲评下一步是否定位最窄失败层、给出不同且可否证机制、选择合法对照、识别已暴露数据与账户/费用/资金费/Sharpe/回撤限制；以预先公开的评分表计分。 |
| 时间与成本 | 每题总时长、检索/返工时长、侧录写入及维护人时、工具调用和计算成本；固定研究预算下无效或重复年度回放比例、每个可复核配对结论的总成本。提前正确否掉坏机制可以少跑回放。 |

继续投资的**拟议门槛**是：检索正确率不下降，盲评决策质量改善，并且节省的检索与返工成本超过侧录维护成本；数值阈值和任务集须在试点前冻结。这只检验研究服务效率，不能据此宣称策略成功率提升。更长的观察须把后继策略、候选全集与选择规则事前冻结，在此前未暴露的窗口或前向数据，依据 Nautilus 原生订单完整性、净收益、胜率、Sharpe、回撤及账户风险联合验收。若没有足够独立样本，就记录“尚未观察”；不能用已暴露年度的最优点估计代替。
