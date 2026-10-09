# RD 资料管理评审：长期迭代中的检索与准确使用

评审日期：2026-10-09。代码与资料基线：`1b32849ca7ec6efd609b0a3bbbbd26bcd854103d`。M01–M06 保留迁移前的发现、验证及范围，不能据此当作迁移后的运行状态；M07 记录本轮 Dolt 接入与自动整理边界，M08 记录原导入队列的证据复核契约。当前蓝图以 [architecture.zh.md](../architecture.zh.md) 为准，操作以 [records README](../../research/records/README.md) 为准。

## 判定

现有 `research.records` 是可信实验档案的初版：尝试和实际运行分离，保留失败，绑定对照、源码和证据，可校验部分历史报告并封存新原生运行。它尚未覆盖投研资料的统一发现、具体结论的适用状态、纠错关系及后续引用。

目前存在局部归属混杂、人工索引和重复描述漂移。文件被保存，不保证后继 Agent 能发现它；哈希正确，不保证文件中的解释仍有效。已经观察到漏检、重复来源和延后纠错。尚无纵向试验证明研发效果随 loop 数量实际下降，也没有证据证明当前设计能支撑第 10,000 轮正确复用第 1 轮发现。

## 当前资料与能力

| 实查对象 | 当前状态 | 判读边界 |
| --- | --- | --- |
| Git attempt | 13 条：11 策略、2 诊断；11 事后转录、2 事前登记 | 不代表全部历史尝试，也不由记录总数推断独立试验数。 |
| Git run | 15 条：14 条 `temporary`、1 条 `sealed_local` | `temporary` 不等于已经遗失；其长期恢复不受封存流程保障。 |
| `research/r1_native/results/` | 427 个 Git 文件：400 JSON、25 gzip、1 CSV、1 PNG | 直接结构化引用共同覆盖其中 34 个 JSON；其他材料也可能由长台账或脚本引用，不能称为孤儿或据此计算覆盖率。 |
| 历史资料导航 | `RD_EXPERIMENTS.md` 1,649 行；F01–F97 findings 1,151 行；另有 SOURCE_CASES 与 RECORD_INDEX | [索引](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/RECORD_INDEX.md)明确保留未迁移 H/D/S 的原处检索，并限制人工交叉表的范围。 |
| 来源材料 | results JSON 中指向 `.local/share` 的 187 个不同文件路径，本次均存在 | 只验证存在，未重验全部来源字节；不能据此推断异机可恢复。 |
| 封存 | 配置既有 acceptance 根目录后，当前 `validate` 通过，封存 manifest 及原生报告检查通过 | [既有验收](research-artifact-custody-acceptance.zh.md)是本机恢复；异机备份与 Catalog 恢复不在已验收范围。 |

现有边界值得保留：假设父关系、组件来源、实际源码和经济对照各有自己的语义；H18a 可以复用 H08 的状态计算而不继承其失败的入场假设。`compare` 检查登记对照、账户、窗口、输入身份、版本、成本契约、币种及原生完整性。封存运行拒绝同 ID 覆盖，保存冻结源码、锁文件和原生证据。账户与交易事实仍由 Nautilus 负责。

## 共享缺口及实际成本

### M01：已保存的重要局部知识不能按其内容找到

- **受影响尝试：** H08、H18a、H13c、F01；凯利等诊断仍主要在旧台账与 findings 中。
- **受阻任务：** 后继 Agent 不知道旧 ID 时，发现可复用组件、负结果和相关反例。
- **直接证据：** [CLI `_find`](../../research/records/cli.py)只对子串 `attempt.mechanism` 搜索，不覆盖 question、hypothesis、decision、组件名、interpretation 或来源内容。本次 `find --mechanism 趋势线` 只返回 H08，漏掉 H18a；`find --mechanism ConfirmedLineSupportTouches` 返回空数组，但组件名明确出现在 H08 的下一步和 H18a 的组件引用。`find --mechanism 凯利` 也返回空数组，不能理解为没有相关历史研究。
- **迭代成本：** 需要记住旧编号、旧表述或重新跨文档搜索；增加重复读取和漏掉反例的风险。本次未测量其累计工时。
- **现有绕行：** `rg` 全文搜索、RECORD_INDEX、按已知 ID `show`，再人工拼接证据。
- **最小共享能力：** 对现存权威资料建立可重建的统一内容索引，覆盖问题、机制、组件、具体结论和来源片段；支持别名和双语词汇。返回命中的字段、对象类型、证据位置和搜索覆盖范围。未检索到、材料未纳入索引和证据不可用应分别显示。

### M02：知识纠错未形成可查询的引用关系

- **受影响尝试与来源：** H08→H18a 的局部复用；C02、D94、H27a、S46 的来源解释修正；S01/S15 的重复原片。
- **受阻任务：** 识别失败实验里仍有价值的部分，判断旧解释是否已被收窄，并找到使用它的后继研究。
- **直接证据：** [F97 段末](r1-native-rd-findings.zh.md#f97)及 [S46](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/RD_EXPERIMENTS.md#source-recheck-s46-c02-is-not-an-outside-a-stop-rule)保留 C02 纠错；[产品发现页首](r1-native-rd-findings.zh.md)说明该解释曾进入 D94/H27a 的研究语境。[S15 回执](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results/2026-10-08-s15-duplicate-source.json)保留误将 S01 原片当独立来源及后续身份修正。现有 attempt schema 没有可定位的具体命题、更正/反证关系或受影响下游查询；设计中的 `knowledge_links` 尚未进入当前 schema。
- **迭代成本：** 来源归因错误可能推进一次完整 37 币候选；重复获取已读来源；旧文与修正文同时被读取时，需人工确定当前适用解释。不能把 H27a 的经济失败全部归因于资料管理。
- **现有绕行：** 保留原文，追加更正，更新 SOURCE_CASES，以媒体哈希人工去重；依赖 Agent 主动读到修正段。
- **最小共享能力：** 给实际被复用或纠正的命题稳定的片段身份，保存精确陈述、适用条件、原证据、反例、未知项及版本；记录支持、反驳、收窄和替代关系，派生出被哪些 attempt 使用。读取旧命题时带回修正和边界；下游显示需要复核，由 Agent 判断影响，不自动改写策略结论。一次策略整体失败不应自动否定其全部子命题。

### M03：资料归属和汇总仍依赖手写维护

- **受影响资料：** F01–F97、全部已转录尝试及其原 H/D/S 段落。
- **受阻任务：** 区分策略结论、来源观察和共用产品问题；确认本次检索究竟覆盖哪些历史。
- **直接证据：** [findings](r1-native-rd-findings.zh.md)承认其历史混合内容，并通过 [RECORD_INDEX](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/RECORD_INDEX.md)重新归位。`F01` 同时是该页的第一个产品 finding 和四格策略 attempt，裸编号需要上下文消歧。README 仍写 11 attempts，当前加载为 13；设计文档仍有 8 attempts / 9 runs 的旧截面。
- **迭代成本：** 多处维护同一汇总，增加归属纠错和跨文件核对；概览落后于新增记录。本次不将这些小漂移视为经济结果错误。
- **现有绕行：** 页首规则、稳定 Markdown 锚点、人工交叉表。
- **最小共享能力：** 引用中包含对象类型与稳定 ID，例如 attempt:F01、product-finding:F01；保留现有编号和路径。清单、覆盖和反向引用从权威记录派生；未迁移历史保留明确入口和未结构化标记，不倒填事前身份。

### M04：可恢复证据、数据暴露与长链读取尚未覆盖长期 loop

- **受影响尝试：** H15a、H18a、H19a、H25a–H27a、F01 及后续同年度研究。
- **受阻任务：** 在换机器、换 Agent、历史变长后，准确恢复证据，辨认已暴露数据，并有界读取相关祖先。
- **直接证据：** 15 个 run 中只有 1 个使用 `sealed_local`；[README](../../research/records/README.md)明确 schema 缺独立 falsifier、selection_rule、exposure 字段，预登记四问仍由 Agent 审查。每个 CLI 命令加载并 schema 校验全体记录，`_lineage` 递归展开全部祖先；纯内存 1,100 层单父链探针出现 `RecursionError`。后者证明深链限制，不是 10,000 条记录的完整性能基准，迭代总量也不等于父链深度。
- **迭代成本：** 若临时原生报告不可恢复，逐事件复核可能需要重跑；缺失暴露信息会增加证据等级判断成本。长链输出和重复祖先展开可能超出工具及上下文预算，尚未测得实际大规模耗时。
- **现有绕行：** Git 时间线、人工登记暴露、临时 CSV、专用诊断；新 R1 决策性运行使用现有 artifacts 流程。
- **最小共享能力：** 落实现有新运行封存与备份规则；结构化关键暴露引用和登记内容的机械可检查部分，内容质量仍由 Agent 判断。关系查询按局部、方向和深度有界读取，祖先去重；明确截断和完整性。正式灾备需独立故障域与恢复演练，不能用第二个本机目录替代。

## 资料应如何摆放和使用

“办公桌”需要稳定归属和引用，不要求把所有东西复制到一张表里。

| 资料层 | 权威与用途 | 后续引用必须带回什么 |
| --- | --- | --- |
| 原始来源与数据 | 原片/论文/画面及其来源回执；行情留在 Catalog | 来源身份、版本、片段时点、可用性；作者明确表述与研究者解释分开。 |
| 尝试与原生运行 | Git attempt/run；原生大报告留在受管产物目录 | 登记时间、源码/输入/账户身份、合法对照、暴露和证据状态。 |
| 可复用命题 | 优先给现有记录中的实际复用/纠错片段稳定引用；确有跨记录复用需求才增加小型 Git 侧录 | 精确结论、适用边界、支持与反例、更正链、引用它的后继尝试。 |
| 查询与桌面视图 | 从上述权威对象派生，可删除并重建 | 命中依据、范围限制、当前状态和原证据入口，避免重复维护“最新结论”。 |

每轮开始，用研究问题检索旧机制、负结果、反例和修正，记录采用或排除的具体引用及理由；每轮结束，把新证据接回相关命题，保存最窄结论和未知范围。现有 AGENTS/README 已要求研究前检索，缺口在于可检索范围及复用关系的读回；无需另设研究调度器。

短摘要只负责导航，不替代原证据和关键反例。重要反例不能因年代久或经济结果差而自动降到不可检索的冷资料；保留策略可以分层存储，但需维持引用与恢复边界。无需保存每个无关日志或把整段 Agent 对话当作权威结论。

## 最小改进顺序与验收

1. 用 H08/H18a、C02/S46、S01/S15 三组真实资料，补统一检索、片段身份、更正与反向引用；保留当前 Git、Catalog、Nautilus 和封存产物的权威边界。
2. 将已存在的资料入口和索引覆盖变成可读的派生清单，减少手写汇总；新决策性运行按现有封存、校验、登记与备份规范执行。
3. 冻结真实检索任务集，包含只记得研究问题、换词或换语言、整体失败但局部可用、来源被纠正、重复来源、缺失证据和合法对照等情况；固定预算，保留完整作答和录入维护成本。
4. 再做规模与长距离检索测试：1,000/10,000 条资料下的局部链路、有界输出、损坏记录与索引重建；测旧知识找全率、错误引用率、更正漏读率、可打开证据比例、时间与返工成本。合成压力测试和真实研究任务分开报告。具体判定阈值须在测试前冻结。

验收关键是：第 10,000 轮只给研究问题，仍能找到第 1 轮的相关发现，并同时读到之后的反证、修正、适用条件及可用原证据。找到旧文件本身不算通过。

当前问题首先是资料关系和引用契约缺口，尚无依据先引入独立索引服务、向量库或图数据库。可先用现有文件和关系生成查询视图；只有实测性能或并发瓶颈成立，再按当前蓝图评估可重建索引。外部 Agent 继续选研究方法；该能力管理资料和引用，不承担交易、自动研究决策或策略资格裁定。

## 本次验证与效益边界

- `uv sync --frozen`、记录 CLI help、R1 runner help 均通过。
- 以 `/Users/vx/.local/share/trade/research-artifacts-acceptance` 配置当前记录 `validate` 通过：13 attempts / 15 runs。输出仍包含历史来源/登记的 `unknown`，通过不代表补齐了历史未知。
- `compare H18a-2026-10-08 H15a-paired-2026-10-08` 正常返回具名开发证据及 `temporary` 状态；这是既有证据读回，没有新增经济回放。
- 当时 `python -m unittest research.records.test_cli`：10 项通过；当前维护入口为 `python -m unittest tests.records.test_cli`。现有测试不证明召回、知识更正或长期复用有效。
- [既有隔离 Agent 试验](research-record-efficiency.zh.md)未测出决策质量、速度或调用次数收益；样本小且有明确局限，不能外推长期策略成功率。此次评审也不宣称改进建议已产生研究收益。

## M05：策略组织依赖固定目录，清理尚缺版本化源码闭包

- **受影响尝试：** H19a；旧台账中的 H23a/H24a；已事后转录的 H25a–H27a。H23a/H24a 当前未转录为 attempt JSON，不能以产品目录整理补称事前结构化登记。
- **受阻 Agent 任务：** 以简洁策略源码入口发现、修改和比较一个研究候选，同时准确保留实际执行依赖、旧证据与恢复能力。研究编号、逐币原生实例、独立产品策略及其账户身份需要分别读取。
- **直接证据：** 盘点底稿（归档 ID `material:research_notes/策略管理 与仓库 组织/repo_custody.md`）记录迁移前已跟踪快照为 54 Markdown，`strategies/r1` 为 31 文件，混放策略、共享信号、Node 装配、审计与回执；这些数量不是删除目标。[runner](../../strategies/r1/run_portfolio.py)为 H19a、H23a–H27a 分派研究名称；H19a 是参数化 tiered 行为，H25a–H27a 共用 [structural 类](../../strategies/r1/structural_support_strategy.py)。[封存器](../../research/records/artifacts.py)固定抓取 `strategies/r1/*.py`，从当前 worktree 复制 `pyproject.toml`／`uv.lock`，并硬编码 runner／auditor 路径；简要 `SOURCE_DIGEST_FILES` 映射尚未含 Brooks、gap、structural，完整封存 manifest 仍保存这些文件。部分 [evidence refs](../../research/records/cli.py)及[文档站来源](../../docs-site/scripts/prepare-content.mjs)依赖当前路径，因此机械移目录会触及复现和读回契约。固定 rc3 的同模块 Config／Strategy 原生加载探针（归档 ID `material:research_notes/策略管理 与仓库 组织/native_boundary.md`）已过，只验证加载，没有回放。
- **迭代成本：** Agent 需要从多个具体策略导入和 runner 分支拼出候选依赖；一次路径调整还须联动 imports／hash、冻结／执行／register、历史引用、CI 和站点来源。没有测量迁移耗时，也没有证据说明这些组织问题导致策略经济失败。
- **现有绕行：** 保留原目录与历史 commit/path/hash，用现有 records CLI、原台账、signal／exit 配置和封存 manifest 核对身份；不为每个 H 或每个币复制策略，不改旧 hash、旧 run 或预注册。当前 records／Git 继续持有正式权威。
- **最小共享能力：** 默认一个独立逻辑策略一个手写 `.py`，其独有 Config、Strategy 和私有行为函数同置；仅真实多消费者能力提取共享，复杂策略有明确维护收益才显式例外模块化。版本化入口与 source closure 清单，绑定 Git commit、闭包 digest、实际锁／配置／data／account manifests；同一研究台账增加最小 Strategy／StrategyRevision 固定引用，Run 引用 revision，登记及 alias 与 qualification 分离。共用原生回放／数据装配、审计比较及 records 各守现有职责，不新建 StrategyManager、DSL、撮合、账户或通用运行平台。Markdown 可以是正文；研究与报告应具有类型、版本及关系，本轮新 reports／notes 在未来台账落地后导入归档，无需每策略新增 README。
- **后续验收边界：** 先保留并验证原 commit/path/hash 映射和历史恢复，再进行小纵切片迁移；受影响版本须完成既有 native paired replay，并检查 orders、fills、fees、funding、account，以及新封存／旧引用恢复、CI 与文档站输入。现有 `restore` 只恢复报告，不是完整环境恢复；本机候选输入仅确认存在。该调查阶段只新增建议与产品发现，未迁移源码或执行经济回放。完整建议保存在归档 ID `material:reports/策略管理 与仓库 组织.md`；M07 接入资料后端仍不等于完成策略源码重组。


## M06：共享资料发表缺少原子版本与重试契约

- **受影响尝试与来源：** H08/H18a 的局部组件复用；C02/S46 纠错及 D94/H27a/D95 的影响链；S01/S15 来源身份。它们是本轮真实夹具的资料样本，不表示已发生数据库丢失或并发覆盖。
- **受阻 Agent 任务：** 多个 Agent 将对象、固定 revision 关系与操作回执作为一次发表写入；连接中断后判断是否已经发表；从旧 commit 读取原依据，并同时发现后继修正。
- **直接证据：** [合同 v3](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/ledger_probe/contract.json)与两份本机隔离 [Dolt 结果](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/ledger_probe/dolt_result.json)、[TerminusDB 结果](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/ledger_probe/terminus_result.json)使用相同 13 对象／13 关系。Dolt 七项通过，但 counter-only 负对照的两次不同对象发表均成功，证明唯一操作 token 不可省略；TerminusDB 其余六项通过，原生版本 header 的普通／延迟并发双成功，同事务 WOQL 条件 guard 补救均一成功、一空 binding→领域冲突。两个后端均读回旧 C02、影响关系、持久操作／原生 commit，并在本机新空环境恢复历史；模拟丢响应没有注入真实网络中断。
- **迭代成本：** 手工抽取范围、对齐固定证据、构造延迟并发、区分原生拒绝与领域映射，并保留恢复证据；累计工时和生产维护成本未量化。探针代码含 bootstrap、断言和证据输出，不能按行数排名；单次执行耗时也不包含资料整理与安装。
- **现有绕行：** 当前 records／Git 继续拥有正式权威；Agent 用旧 ID、`show`／`compare`、全文检索和人工修正链读回。本轮只用隔离测试 harness，不迁移正式记录、不新增双写 owner。
- **最小共享能力：** 在现有研究领域协议内增加稳定对象 ID／revision、固定原生 commit 引用、typed Relation、canonical operation fingerprint 与结果回执；版本守卫、对象／关系、operation 与原生 commit 同事务。首选映射是 MySQL SDK→Dolt 的薄 SQL guard＋每操作唯一 token＋`DOLT_COMMIT`；TerminusDB 对照需要 WOQL guard 及空 binding 的冲突映射。不新增 StrategyManager、通用 HTTP 平台、DSL、账户账本或研究调度器。append-only 由领域发表协议和权限承担，不能当数据库默认禁止后续更新。
- **验收与效益边界：** 此阶段的原生历史备份恢复已验证于本机隔离环境；尚无自动资料整理、一般语义召回、10k 检索、生产权限或独立主机灾备证据，也不产生策略收益或资格。完整选择与重跑范围收敛于归档 ID `material:reports/RD API 开源组件 选型.md` 与 [probe README](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/ledger_probe/README.md)。正式接入及自动整理验收另见 M07，不能用原 PoC 七项通过代替迁移验收。

## M07：正式资料迁移需要单写主与可复核的自动整理

- **受影响尝试与资料：** H08/H18a 的组件复用与假设父关系、H27a/D94 的既有来源语境、C02/S46 的新旧解释、S01/S15 的原片身份；既有 attempt/run、历史长台账、6 份 `reports` Markdown 与 18 份 `research_notes` Markdown。数量是本轮整理清单，不是全部研究资料或删除目标。
- **受阻 Agent 任务：** 通过 API 发现跨文件资料、明确对象类型与固定版本、从现有证据提取可确认的关系，并在发布新结果时避免 Git JSON 与数据库分别演化。只有保存旧文件不能回答“哪一版被采用，后来是否有纠错”。
- **直接证据：** M01 的 `ConfirmedLineSupportTouches` 漏检、M02 的 C02/S46 修正及 S01/S15 身份、M03 的 F01 编号混用和汇总漂移，分别需要内容索引、片段/关系与类型化身份。M06 的 counter-only 并发负对照说明同事务版本计数之外还需要唯一写入标记。现有 [CLI](../../research/records/cli.py)、[原生封存器](../../research/records/artifacts.py)和 [attempt/run schemas](../../research/records/schemas/)提供了可保留的领域边界。
- **迭代成本：** 过去要在 Markdown、JSON、源码和回执间人工拼接，同一份材料可能在多个概览中重复描述；迁移新增的成本是原文字节核对、关系待审、数据库运行与备份。本轮不能从文件数量或单次查询耗时推断研发收益，累计人工维护成本和长期决策准确度仍待量化。
- **本轮最小能力：** 在 `research.records` 领域接口后接固定 Dolt 2.4.2 适配器；默认读写 Dolt，`--backend git` 显式读取历史，不双写、不自动 fallback。保留原两 commit 预登记凭据，后续 decision/run 只发表 Dolt revision。资料保存原文、字节哈希、Git commit/path、worktree 状态与片段位置，显式 JSON 关系和链接绑定端点 revision；编号、标题、关键词不会自动升级成支持、收窄或反驳关系。含糊解释进入待审队列，由 Agent 决定。
- **整理与恢复规则：** 先导入并验证固定版本，再逐份恢复原文核对字节，并完成原生数据库备份/新空目录恢复后，才撤出本轮 reports/notes 原副本。原始来源回执、小型原生结果 JSON、Catalog、策略源码和必要产品/预登记文档保留现有路径；不迁走被封存或验证引用依赖的交易证据。归档 ID 可用 `uv run --frozen python -m research.records.cli material show '<ID>'` 读取，以 `material restore` 恢复，历史读回加 `--at <Dolt commit>`。
- **验收范围：** 自动提取需要检查 H18a→H15a 假设父关系与 H18a→H08 组件边界分别成立，C02 旧/current 原文字节分别可恢复，S01/S15 同媒体身份仍保留两条观察，F01 不同对象类型不会混为一条；S46 的语义修正未审阅时不得由标题自动推断。发表需要核对原子性、冲突、同操作重试和旧 commit；新 run 登记须证实仅写 Dolt。最终迁移 commit、对象/关系数量、待审清单、恢复哈希及实际测试结果以本轮运行回执为准，不用 PoC 手工夹具冒充自动整理结果。
- **保留边界：** 本轮不改 Strategy、数据适配或原生回放，也不宣称策略全部改为一个代码文件、全部 Markdown 已整理、一般语义检索有效、10,000 轮研发有效或完成异机灾备。追加 revision 是领域发表协议，不是 SQL 管理员不可篡改保证；Dolt 仍是 RD 元数据存储适配器，Nautilus 独占交易账、账户与资格相关原生事实。
- **2026-10-09 本机读回：** 初次导入提交 `rm3auu5u52edvuainhq5ofqt8b3n1r4l` 扫描当前 68 份 Markdown、72 份结构化 JSON 及旧 SOURCE_CASES 快照，保存 1,852 个对象 revision 和 2,604 条固定端点关系，其中 attempt 13、run 15。572 项待审包括历史链接解析和 S46 解释，不把它们算作已确认语义。原生备份恢复后对全部对象、关系、3 个历史提交及 925 份可恢复原文做哈希读回，24 份 reports/notes 逐文件恢复一致后撤出工作区，余 44 份 Markdown。CUSTODY-F01-37 原 seal 已通过正式 Dolt 登记与同操作恢复，提交 `6o3s8ti06bvjuq9e86j6ki5an3hfhhc9`；Git run JSON 未新写。验收回执保存在配置的外部资料根下，数据库仍需独立主机备份方案。

## M08：原导入待审队列需要固定来源与逐项证据闭环

- **受影响资料与 Agent 任务：** 原导入队列的 572 个 occurrence：452 项 `unresolved_local_link`、108 项 `unsafe_local_link`、11 项 `multiple_ids_in_heading`、1 项 S46 来源解释。Agent 需要辨别路径解析问题与语义问题，保存复核依据，并让后继查询读到当前有效引用。572 是原队列的固定大小；正式 review commit `4ncs20jpinhtgbbtdq8t0es5pemf83ki` 已读回 572 resolved、0 pending、0 unavailable。
- **固定来源：** inventory `inventory:ea8dba226a5caaec278dd24237cc3de3f8a7faffa53ff882e91708fc75f607d1@1`，原快照 `rm3auu5u52edvuainhq5ofqt8b3n1r4l`。原 `review_queue` 不删除、不改写；每项通过 inventory ID/revision、原索引和 item hash 绑定独立的 `review_decision`。后来修复解析或补采资料不能把新清单冒充这份原快照。
- **最小共享能力：** `material review status INVENTORY --revision 1 --source-at SOURCE_COMMIT [--items]` 读取每项最新决定，分别计数 `resolved/pending/unavailable`；全局 `--at READ_COMMIT` 固定决定的读回快照，`--source-at` 则始终固定原来源快照。`material review prepare INVENTORY --source-at SOURCE_COMMIT [--decisions PATH] [--supplemental PATH] --destination OUTSIDE_NEW_JSON` 只生成外部新 JSON 计划，冻结 base commit、expected version、operation ID、payload digest、proof 与固定端点关系。`material review apply --file SAVED_PLAN` 才向本机 Dolt 发表，不引入可变队列表或独立研究调度器。完整命令见 [README 的 review 操作](../../research/records/README.md#review-imported-materials)。
- **证据与发表规则：** 原来源引用必须在固定 source commit 存在且哈希相符；Agent 关闭语义项须保留带 reviewer、理由和适用范围的决定文件及其原始字节。证明、固定 revision 关系与逐 occurrence 决定在同一 Dolt 事务提交。计划文件保存在 Git 和 `/tmp` 之外，不覆盖旧计划；未知响应复用同计划恢复持久操作结果，版本冲突须重读竞争状态并重新 prepare，不自动换版本覆盖。新取得或新保管的资料带真实的后续 custody，可辅助判断但不能证明原快照已保管这些字节。
- **本轮 Agent 复核边界：** 11 个多 ID 标题可按标题首个明确对象 ID 消歧，其他 H/D/S 编号保留为提及，不因此合并业务身份或生成支持、继承关系。S46 以原 note 时段、实际查看的画面、来源 JSON 与原回执收窄 C02 的来源归因；六份原来源资产已复制到外部 private 目录并核对原 SHA-256。修正限于事后来源解释，不改 H27a 的既有经济失败，不把 D94/D95 的数值或原生路径诊断升级为新的因果结论。修改策略、数据或止损行为仍须新的事前规则与配对原生回放。
- **查询与验收边界：** `material show` 的 `resolved_references` 只采用最新 review revision 的有效解析，已被取代的旧解析保留在历史中；原文、原队列和旧 commit 仍可读回。验收须固定正式 review commit，核对原 572 项的分类计数、逐项 proof 与 fixed edges、旧 snapshot 原文和同计划重试结果。准备计划的 projected counts、Agent 复核完成或本机资产复制都不能代替正式发表与读回，也不证明一般语义召回、长期决策收益或异机灾备。
- **2026-10-09 正式验收：** 560 项导航复核含 557 项固定 Git/已保管载荷引用和 3 项锁定 Nautilus 版本的依赖描述；依赖描述不读取 `.venv` 内容或核验其行号。9 条 probe 引用所需的 4 份 JSON 已追加原始字节与后续 custody；12 项 Agent 复核保留完整决定与 6 份 S46 来源资产。两条字典内容完全相同的引用仍按原索引分别关闭。原队列和既有 13 个 attempt、15 个 run 的版本均保留，同计划重试及再次 prepare/apply 返回同一 native commit，没有额外 revision。最终 80 项测试通过；原生 v3 备份在本机新空目录恢复后，2,726 个对象版本、4,328 条关系、5 个原生提交与 937 份可恢复载荷一致，8 份新增审阅证据逐文件恢复哈希一致。回执位于配置的外部资料根。
