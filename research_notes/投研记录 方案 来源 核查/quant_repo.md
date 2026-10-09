# Qlib / Nautilus 与本仓库的投研记录形态核查

## 开源量化项目实际提供了什么记录能力？

### Takeaway

Qlib 的可借鉴点是“研究项目或实验 → 多个运行 → 参数、指标、产物”的可检索层级；它的官方实现基于 MLflow。Qlib 并没有替本项目定义“父假设、否证命题、经济对照”语义，也不能成为本项目的第二套回测引擎。

### Cited Findings

- Qlib 官方 Recorder 文档定义 `ExperimentManager`、`Experiment`、`Recorder` 三层；一个实验下有多个 recorder，recorder 对应一次运行；官方实现 `MLflowExpManager` 基于 MLflow，可用 MLflow UI 查结果。— [Qlib Recorder 官方文档](https://github.com/microsoft/qlib/blob/main/docs/component/recorder.rst)
- Qlib Recorder 源码有 `SCHEDULED/RUNNING/FINISHED/FAILED` 状态、保存对象/本地文件、记录参数与指标、列出及下载产物的接口；其 MLflow 包装器在运行开始时还记录 `git diff`、`git status`、暂存区 diff、命令行和部分环境变量。这支持“运行时实际字节/状态比提交号更重要”的设计动机。— [Qlib Recorder 源码](https://github.com/microsoft/qlib/blob/main/qlib/workflow/recorder.py)
- Qlib 的 `qrun` workflow 包含数据处理、模型训练/推理、评估与回测；其示例使用 Qlib 自己的 `SimulatorExecutor`。因此借用其记录层级与界面概念，不意味着引入 Qlib 的数据、策略或回测执行栈。— [Qlib Workflow 官方文档](https://github.com/microsoft/qlib/blob/main/docs/component/workflow.rst); [Qlib 官方示例](https://github.com/microsoft/qlib/blob/main/examples/tutorial/detailed_workflow.ipynb)
- MLflow 将 run ID、参数、指标、标签、时间等元数据与较大的 artifact 分开存放；当前官方文档列 SQLite 为默认元数据后端，artifact 可在本地文件系统或 S3 等存储。官方也指出文件型 metadata backend 已处维护模式，并建议数据库后端。— [MLflow Backend Store](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/); [MLflow Artifact Store](https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/)

### Inferences

- Qlib 证明把一次研究尝试与多次运行分开有实际先例；它不能证明原稿里四类对象、全部字段、关系名都正确。这些仍是本项目的设计假设，应拿现有 H13、H18a/H19a 记录验证。
- MLflow 是成熟的现成界面选项，但若只需单人 Agent 在 Git 仓库中追溯假设与运行，完整引入 MLflow/Qlib 会增加依赖、服务和两个权威来源。可先借其 metadata/artifact 分离与 run ID，不引入其模拟器。

### Gaps

- Qlib 官方 Recorder 没有提供本项目所需的“假设父子、否证对象、同账户配对对照、样本暴露等级”标准 schema；未找到可直接复用的量化项目统一标准。

## Nautilus 已提供什么事实与本仓库现在保存了什么？

### Takeaway

Nautilus 已有 Catalog、配置化运行、原生订单/成交/持仓/账户报告和统计；需要设计的是这些事实的长期身份、索引与保管，不是另建回测账本。本仓库现有记录可读但分散，且主要大报告留在 `/tmp`。

### Cited Findings

- Nautilus 官方 BacktestNode 用 `BacktestRunConfig`、`BacktestDataConfig`、Catalog 描述高层回测；原生 `ReportProvider`/Node 提供 orders、fills、positions、account 等 DataFrame 报告，结果还含 returns/PnL/general statistics。— [Nautilus 回测 API](https://github.com/nautechsystems/nautilus_trader/blob/develop/docs/concepts/backtesting/apis-and-runs.md); [Nautilus Reports](https://nautilustrader.io/docs/latest/concepts/reports/)
- 本项目钉住 `nautilus_trader[visualization]==2.0.0rc3`；R1 README 把 `run_portfolio.py` 作为单个 100,000 USDT 共享账户的原生入口，Catalog、MARK 缓存和运行输出示例均位于 `/tmp`，并明确称 `/tmp` 结果只是本地证据。— [pyproject.toml](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/pyproject.toml#L7); [R1 README](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/strategies/r1/README.md#L1)
- 当前 runner 写 `orders.csv`、`fills.csv`、`positions.csv`、`account.csv`、`returns_series.csv` 和 `summary.json`；summary 包含若干源码文件的 SHA-256、runner SHA-256、信号/出场变体、完整性、账户口径、收益、Sharpe、回撤、窗口和限制。`SOURCE_COMMIT` 是源原型常量 `0725a7b3...`，不能作为当前执行代码的 Git commit。— [run_portfolio.py](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/strategies/r1/run_portfolio.py#L193); [run_portfolio.py](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/strategies/r1/run_portfolio.py#L253); [replay_util.py](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/strategies/r1/replay_util.py#L10)
- 当前 `research/r1_native/results/` 有 255 个已跟踪文件，其中 250 个 JSON，总约 4.8 MB（本地 `find`/`git ls-files`/`os.path.getsize`，2026-10-08）；`RD_EXPERIMENTS.md` 有 1,227 行、约 580 KB，`SOURCE_CASES.md` 有 105 行、约 24 KB。可见 JSON 摘要放 Git 可行，但一个长篇 Markdown 台账已增加定向检索成本。— [结果目录](https://github.com/qOeOp/trade/tree/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/results); [RD_EXPERIMENTS.md](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/RD_EXPERIMENTS.md#L1); [SOURCE_CASES.md](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/SOURCE_CASES.md#L1)
- 本机现存 `/tmp/nautilus-upstream-final-h18a-37` 约 174 MB；`account.csv` 约 157 MB、56,531 数据行，`orders.csv` 约 11 MB、29,712 数据行，`positions.csv` 约 5.3 MB。此量级适合单独 artifact root，Git 存摘要与 digest；`/tmp/r1-node-h19a-37` 在本次核查时已不存在，显示文档示例路径不能当持久地址。— [R1 README](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/strategies/r1/README.md#L38); [run_portfolio.py](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/strategies/r1/run_portfolio.py#L193)
- 现有实验台账有 S/D/H 尝试的叙述、预登记 commit、配对对照和数据回执；同时源案例与诊断 JSON 的键并不统一（例如 `registration_commit`、`registration`、`preregistration_commit`）。— [RD_EXPERIMENTS.md](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/RD_EXPERIMENTS.md#L9); [D59 result](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/results/2026-10-08-d59-s44-h15a-geometry.json#L1); [D62 result](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/results/2026-10-08-d62-h19a-first-r.json#L1)

### Inferences

- 产品最小形态可先是 Git 内的少量可校验 JSON 侧录、现有 Markdown 解释、长期 artifact root、按 ID 查询的 CLI；Nautilus 继续唯一生成交易事实。独立服务或 UI 没有被当前规模证明为必需。
- 不应一次性迁移 250 份旧 JSON。可用 H13 链与 H18a/H19a 配对两个样例验证“从版本追父假设、找对照、辨认失败层级、打开原始证据”的读回，再决定 schema 是否足够。
- 当前 runner 的单文件 SHA 列表虽然比 commit 精确，但依赖锁、运行配置、所有被 import 的源码、Catalog 树、产物文件均尚未作为一份可核对的运行 manifest 统一冻结。设计里 `source_bundle_digest`、`input_manifest_digest` 是目标字段，不是已实现的现状。

### Gaps

- 未运行钉住 rc3 的安装或年度配对回放；Nautilus 网站当前文档是较新版本，因此具体 API 可用性仅以本地源代码现状为准，不据此主张 rc3 所有当前文档特性都存在。
- 本次仅核对本机现存 `/tmp` 样本，未普查其他机器、备份或对象存储；不能断言所有旧大报告丢失。

## 什么产品形态、存储和数据结构较适合？

### Takeaway

建议第一版用“Git 记录 + 外部不可变产物目录 + 可重建检索索引”，并用 JSON Schema 定义少量稳定键；解释和研究判断仍留 Markdown。SQLite/MLflow 是需求达到跨 Agent 并发、复杂筛选或 UI 时的下一步，而不是前置依赖。

### Cited Findings

- JSON Schema 官方规范提供类型、必需键和 schema 版本声明（`$schema`）；适合作为 JSON 记录的机器校验契约。— [JSON Schema 官方说明](https://json-schema.org/understanding-json-schema/reference/schema); [JSON Schema 入门](https://json-schema.org/learn/getting-started-step-by-step)
- SQLite 官方支持普通/复合/唯一/部分索引；若后期要按策略、假设父节点、市场、失败层级、来源案例等组合筛选，可由 Git 中的记录构建查询表。— [SQLite CREATE INDEX](https://www.sqlite.org/lang_createindex.html)
- MLflow 官方把 metadata backend 与 artifact store 分开：SQLite 适合本地开始，较高并发可用 PostgreSQL/MySQL；artifact 可用本地或远端对象存储。这是元数据与原始大报告分离的产品先例。— [MLflow Tracking Server](https://www.mlflow.org/docs/latest/self-hosting/architecture/tracking-server/); [MLflow Artifact Store](https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/)
- 现有架构稿列出 Strategy 版本、研究尝试、运行/诊断、证据引用四类对象及多个必填字段，但这是此前拟定的规范；它本身没有给出开源或论文依据，应标为本项目设计提案。— [research-record-contract.zh.md](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/docs/plans/research-record-contract.zh.md#L23)

### Inferences

- **先收窄数据模型。** `attempt.json` 记录一次问题/预注册假设/父尝试/对照/决策（可空）以及 `notes.md` 解释；`run.json` 记录 attempt ID、实际运行源码与 lockfile digest、参数、窗口、数据身份、原生版本、状态、原生报告引用与哈希；artifact 引用先作为 run/attempt 的数组，待跨研究复用需求被样例证实时再独立实体化。Strategy 版本优先由 Git commit + 实际源码包哈希确定，不预造另一个复杂版本注册表。只有运行过的对象才需要 run 记录，来源核查和失败诊断同样保留 attempt。
- **格式取舍。** Git 中 JSON 便于 schema 校验、稳定字段检索与内容哈希；YAML 便于手写但缩进/隐式类型与解析器差异增加校验成本，现有产物也已是 JSON；Markdown 留给解释而不承担唯一可检索键；CSV/Parquet 继续承载 Nautilus 行级报告，不能塞进 JSON 元数据。
- **持久 artifact root。** 每次运行在配置的非 `/tmp` 目录按 run ID 保留原生六份报告、源码包或准确的可还原引用、manifest、哈希清单；用不可变内容地址或“写完封存”的目录以及校验脚本。可先是本机受管目录并备份，随后需要多机时迁到对象存储；Git 只放 digest/URI/可读状态。`/tmp` 可作为 staging，成功后复制并验证再公布引用。失败运行也应保留足够的原生诊断证据。
- **SQLite 仅作派生索引。** 从 Git 侧录和 artifact manifests 重建，不能让数据库成为与 Git 冲突的新事实源。需求触发点可量化：简单 `rg`/脚本已无法在合理时间回答父链、同口径对照、证据可读性问题，或存在并发写入/跨机器读回需求。若直接采用 MLflow，仍需额外定义 hypothesis lineage 和 exposure/comparability 语义；它本身不解决研究路线管理。
- **需要先做小样例验收。** 用 H13b/H13c 的源时序失败链、H18a/H19a 同账户配对，人工填两三个 sidecar；让另一 Agent 仅用 ID 回答“为什么改、比谁、坏了回哪、原始报告还在否”。若做不到，再调 schema。这个试验比先宣布新模块/DB 更能验证 ROI。

### Gaps

- 还没有测过本地 Git JSON + CLI 在数百次尝试下的查询延迟、多人写冲突、artifact 备份/保留成本；不能声称它一定优于 MLflow 或 SQLite。
- 现有 H13/H18a/H19a 的历史记录并非全部都有完整可还原的运行源码包；补录必须允许 `unknown`，不能把事后重建写成事前登记。

## 后续策略迭代价值如何被证伪或证成？（补充核查）

### Takeaway

现有资料只能证明记录分散、比对和复用确实出过错，不能证明一套新记录会提高产出率。试点必须同时测“找得准”和“下一次研究决策更有辨别力”，并把最终独立资格作为长期结果。

### Cited Findings

- F25 是**当时的历史截面**：其统计只到 H12，称清洁基线后完整 37 币共享账户年度经济回放的候选为 H01、H03、H04、H06、H08b、H10、H11、H12，且特别指出 S/D/H 号不能等同“策略版本”。因此不能把 F25 的八个候选误报为本次全库的最新总数。— [F25](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/docs/plans/r1-native-rd-findings.zh.md#L267)
- 后续台账确实增加了完整经济候选：H14a 的 37 币回放与 H13f 配对通过原生订单审计，但 H14a 年化 -10.4350%、254/651 胜；H19a 与 H18a、H15a 在同 runner/数据/账户窗口下三跑，H19a 年化 +12.00%、212/496 胜，H18a +5.04%、380/676 胜，H15a +4.28%、382/676 胜；三个都只是已暴露一年的研发结果。不能从所有 S/D/H 标题数量推算有效完成回放的吞吐。— [H14a 台账](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/RD_EXPERIMENTS.md#L925); [H19a 配对台账](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/RD_EXPERIMENTS.md#L1183)
- 来源/诊断与经济候选的差别有具体反例：D59 的 H15a 源图宽波段门槛失败，没有新订单或经济分数；D60 的触价容量通过只允许后续原生订单门槛；H19a 两币 pilot 的收益点估计不用于选择候选。— [D59/D60 台账](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/RD_EXPERIMENTS.md#L1163); [H19a pilot 台账](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/RD_EXPERIMENTS.md#L1181)
- 检索/比较/复用已出现可验证失败：D21 前的 H06 PEPE/SHIB 用别名查得双零集而误报 37 币精确一致；H19a 第一次独立审计把部分成交后取消的父单当作零成交，产生伪缺陷，修正后审计通过；D66 特别指出原生 `fills.position_id` 与 netting `positions.position_id` 不能直接相连。记录若能暴露输入身份、原生事件关联方法和修正谱系，才可能降低这类决策错误。— [F24](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/docs/plans/r1-native-rd-findings.zh.md#L259); [H19a 审计修正](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/RD_EXPERIMENTS.md#L1183); [D66 台账](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/research/r1_native/RD_EXPERIMENTS.md#L1223)
- F57 核查认为已有 H14a→H15a→H16a 等机制延伸，但记录中没有找到论文/DOI/相邻策略方法的显式引用，并明确不能从此推断研究者没读文献或把低于目标的收益归因于该缺环。现有年度结果重复使用已暴露的一年，没有独立确认的收益优势。— [F57](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/docs/plans/r1-native-rd-findings.zh.md#L569)
- 报告可用性目前不等于内容摘要存在：R1 README 明言 `/tmp` 报告只是本机证据；本机某 H18a 原生报告目录仍在且约 174 MB，而文档示例 `/tmp/r1-node-h19a-37` 本次不存在。— [R1 README](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/strategies/r1/README.md#L38); [运行输出代码](https://github.com/qOeOp/trade/blob/163478559baa8560d2dd8670ab25847c4804d7e6/strategies/r1/run_portfolio.py#L193)

### Inferences

- **试点对象。** 事前冻结一组真实待处理问题，以两个以上难度相近的批次做交叉试验：同一组 Agent 分别用当前 `RD_EXPERIMENTS.md`/文件搜索与最小 `attempt.json`/`run.json`/artifact manifest；批次顺序对调，避免第二轮熟悉资料带来的优势。任务至少覆盖 H13 假设链的失败归因、H18a/H19a 同口径对照和一个跨来源负结果复用；题目、正确答案、裁判依据与数据暴露在试点前封存。旧历史补录只允许已可证实字段，不能把先看答案后的知识写进试验组。
- **即时读回指标（领先指标）。** 盲评“找到正确父假设/主要对照/源码与数据身份/原生报告/更正后权威版本”的准确率、漏报/误报率、完成用时、打开原始报告成功率；用本仓库真实修正案例测试能否拒绝双零集伪 parity 与部分成交审计伪缺陷。时间和准确率都报，不能为了快而猜测。
- **决策质量指标（更接近目标，仍是领先指标）。** 对每题输出下一研究动作，由事前公布的独立评分表盲评：是否指出最窄失败层级，是否与父假设有实质机制差异，是否有来源/论文或原生事件支撑、可否事前证伪，是否指定合法同口径对照、成本/资金费/回撤与联合 Goal 缺口，是否避免已曝光数据上的参数扫优。除评分外，记录后续最小门槛实际否证了多少错误想法、哪些想法在源/订单门槛后被明确停止或进入完整回放；不把“更多子假设”直接当进步。
- **下游效率指标。** 在固定研究时段和预算下计数“通过来源及原生完整性门槛、完成同账户同窗口配对且保留报告的全组合回放”，同时记从假设登记到明确停止/回放结论的时间、无效或重复回放比例、能回溯的反事实控制比例、每个有效结论消耗的计算量/人工时。吞吐可升可降；若结构化记录让廉价门槛及时终止错误想法，较少全回放也可能是正面结果。
- **最终成功指标（长滞后）。** 预先定义的独立后继时间段/前向资格中出现满足收益、胜率、Sharpe、回撤与原生执行要求的策略，并在资格判定时保留完整假设/对照/源代码/数据身份。样本不足或没有新市场期时只能记“未观察到”，不能用已暴露一年的更好点估计代替。
- **混杂与 Goodhart 控制。** 同一 Agent 的学习效应、题目难度/资料量差异、同期 Nautilus/数据修复、市场时期、模型能力变化及幸存者偏差会污染比较；交叉顺序、固定输入/工具/预算、盲评和错误分析只能减少，不能完全消除。奖励记录数、引用数、运行数、胜率单项或回放速度会诱导过度拆分、引用堆砌、跳过门槛、扩大风险或只挑赢家；把联合经济目标、失败保留和独立资格作为共同约束。试点没有预设效果量，不对未来策略可用性作保证。

### Gaps

- 尚无按“来源/只读诊断/两币 pilot/完整共享账户经济候选/独立验证”统一审计的全库 census；F25 的八候选不是更新后全集，也没有可直接用于前后测的全局有效回放率。
- 旧任务做交叉试验会有答案泄漏和历史补录优势；即便试点的读回/盲评改善，也只能证明决策支持的短期效果，不能证明策略收益的因果改善。
