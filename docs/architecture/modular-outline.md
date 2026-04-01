# Modular Outline

更新时间：2026-04-01  
范围：只定义 outline、边界、schema 与 future split points，不引入业务逻辑、实现代码或自动化执行器。

## First Principles

1. 这个仓库的运行时已经存在，就是 Codex 对话；当前不需要再造 agent runtime。
2. 当前真实承重资产只有三类：operator docs、repo-local skills、append-only records/templates。
3. 模块拆分必须跟着独立资产、独立生命周期和独立 change triggers 走，而不是跟着候选名词走。
4. append-only lineage 比“目录看起来完整”更重要，因为交易判断必须可追溯、可反驳、可复盘。
5. 在没有实现前，稳定的 module contract 比更多目录更重要。
6. 默认新增 reader/transform contract，不默认新增 writer。
7. `module` 是 bounded context 与 owner；append-only `chain` 是 storage truth。chain 数量本身不驱动 module 数量。

## Divergent Hypotheses

### H1. Conservative

- 核心想法：保留当前 5 个 active modules 与 latent contracts，只微调 prose。
- 优点：churn 最低。
- 问题：module field names 不稳定，dependency rules 容易继续散落在文档叙述里。

### H2. Modular-Composable

- 核心想法：保持模块集合不变，把 canonical module map 规范成固定 10 字段，并把 dependency rules 抽成单独文档。
- 优点：边界更稳，几乎不增加 surface area，未来更容易 promotion / split。
- 代价：要维护更像接口契约的文档，而不是自由 prose。

### H3. Radical-Agentic

- 核心想法：现在就创建多-agent / 多链路 / 多 future module 的目录骨架。
- 优点：看起来完整，像“已经准备好扩张”。
- 问题：会提前冻结未成熟边界，制造假复杂度和未来 rename/move/split churn。

## First-Principles Convergence

结论：选择 `H2`，但落地方式保持保守。

原因：

- 它保留了当前 5 个 active modules，不引入新的 runtime 或空目录。
- 它把最容易漂移的地方从“措辞”升级成“合同”。
- 它最符合外部高质量参考的一致结论：先稳定 context boundaries、asset ownership、event lineage，再决定是否需要更重的模块化。

明确不做：

- 不创建 `market-ingest/`、`news-chain/`、`backtest-lab/` 等真实目录。
- 不把 `research-synthesis` 与 `scenario-planning` 合并。
- 不让任何非 `decision-chain` 模块写 `records/`。

## Best-In-Class Outline

- active modules 维持 5 个：`operator-surface`、`risk-guard`、`research-synthesis`、`scenario-planning`、`decision-chain`
- `operator-surface` 继续是 docs-owned active module；active module 数量不要求等于 skill 数量
- latent modules 继续只保留为文档合同
- 每个 module 使用同一组固定字段
- cross-module coupling truth 移到 `docs/architecture/dependency-rules.md`
- `decision-chain` 继续是唯一 active records writer
- `decision-chain` 当前拥有一个小型 decision-record family：`records/daily/` 与 `records/trades/`；链数量本身不构成拆模块理由

## Module And Chain

- `module` 负责拥有合同、边界、change triggers 与 allowed / forbidden dependencies。
- `chain` 负责承载 append-only 的实例真相，是 storage truth，不是自动独立的 bounded context。
- 一个 writer module 可以拥有多条同族 chains，只要它们仍共享 schema owner、核心 invariants 与 review cadence。
- 只有当 chain family 不再共享 contract owner、写入边界或 change triggers 时，才考虑把 chain family 拆成多个 writer modules。

## Truth Surfaces

为避免同一条结构真相在不同文档里反复长出“近似但不完全一致”的版本，仓库内文档按 change cadence 和 truth scope 分层：

| surface | sole responsibility | can change when | must not do |
| --- | --- | --- | --- |
| `AGENTS.md` | 路由规则、仓库级工作约束 | 入口流程或路由变化 | 重新定义 module contract、dependency edges、record schema |
| `README.md` | 操作入口说明与高层摘要 | onboarding 视角或使用方式变化 | 变成第二份 canonical architecture spec |
| `docs/architecture/modular-outline.md` | canonical module map | module boundary、ownership、split logic 变化 | 承担 records schema 或模板细节 |
| `docs/architecture/dependency-rules.md` | cross-module edges、writer ownership、chain ownership、promotion rules | coupling truth 或 promotion rules 变化 | 重复模块内部 contract 字段定义 |
| `docs/architecture/adr/*.md` | 被接受的结构决策与取舍原因 | 有实质性 boundary decision 被接受时 | 代替 canonical spec 本体 |
| `records/schema.md` | canonical record schema 与 lineage rules | record contract 变化 | 承担 skill workflow 或 operator routing |
| `records/README.md`、`templates/` | 示例、路径提示、作者体验 | 示例需要更清晰或更易落盘时 | 引入新的必填 schema 字段或改写 chain ownership |
| `skills/*/SKILL.md`、`skills/*/references/` | conversation behavior、输出骨架、局部检查清单 | skill workflow 或 phrasing 变化 | 重新定义 architecture truth 或 records truth |

### Anti-Drift Rules

1. 字段级 contract 只能有一个 canonical owner；其他文档只能摘要或链接。
2. 如果 `README.md`、`records/README.md`、skill references 与 canonical docs 冲突，以 canonical docs 为准。
3. template 是示例，不是 schema authority；若 template 落后，先修 template，不扩散 schema 真相。
4. skill skeleton 负责“怎么回答 / 怎么落盘”，不负责“模块拥有什么资产”或“哪条链由谁独占写入”。
5. 如果 skill skeleton 为了 operator 可读性而镜像 active module 的 10 字段，字段顺序与 dependency 摘要必须直接跟随 canonical module contract；workflow、checklist 与输出模板放在字段区块之后。

## Canonical Module Contract Schema

下面每个 module 都必须按同一顺序声明这 10 个字段：

1. `mission`
2. `owned_artifacts`
3. `upstream_inputs`
4. `downstream_outputs`
5. `invariants`
6. `allowed_dependencies`
7. `forbidden_dependencies`
8. `non_goals`
9. `change_triggers`
10. `future_split_points`

## Active Modules

### `operator-surface`

- `mission`: 作为人和仓库的稳定入口，声明规则、路由和 architecture truth。
- `owned_artifacts`: `AGENTS.md`、`README.md`、`docs/architecture/`。
- `upstream_inputs`: 用户意图、仓库级规范、已接受 ADR、active / latent module 状态。
- `downstream_outputs`: 路由规则、工作方式说明、architecture decisions。
- `invariants`: 只描述边界和流程，不承载具体交易逻辑，不持有市场或执行真相。
- `allowed_dependencies`: 所有 architecture / records / skills 文档只读。
- `forbidden_dependencies`: `records/` 写入、市场判断生成、情景计划生成、执行记录生成。
- `non_goals`: 不是市场分析模块，不是风控模块，不是 record writer。
- `change_triggers`: 新增或删除 active module；工作入口变化；路由或 architecture truth 变化。
- `future_split_points`: 当 routing rules 与 workspace handbook 出现独立 owner 或独立维护节奏时，可拆成 `operator-routing` 与 `workspace-handbook`。

### `risk-guard`

- `mission`: 在所有交易相关回答前提供最外层风险边界与降风险 framing。
- `owned_artifacts`: `skills/trade-risk-guard/`。
- `upstream_inputs`: 用户请求、market brief、scenario draft、已有记录上下文。
- `downstream_outputs`: 安全语言、风险提示、必要时的拒绝或降级。
- `invariants`: 不承诺收益；不鼓励极端杠杆；不鼓励报复性交易；保留用户决策权。
- `allowed_dependencies`: `operator-surface`；`research-synthesis` 与 `scenario-planning` 输出只读；`decision-chain` 历史只读。
- `forbidden_dependencies`: `records/` 写入、独立 market brief、独立 trade plan、个性化 sizing。
- `non_goals`: 不是市场方向模块，不是情景规划模块，不是执行模块。
- `change_triggers`: 新危险请求模式出现；边界政策变化；风险语言模板失效。
- `future_split_points`: 当“风险教育”和“执行前核查”出现独立变更节奏时，可拆成 `risk-language` 与 `risk-checks`。

### `research-synthesis`

- `mission`: 把已验证的市场事实压缩成简明、可引用、可接续的 BTC 结构判断。
- `owned_artifacts`: `skills/btc-market-brief/`。
- `upstream_inputs`: fresh market data、用户截图、`records/daily/`、既有 trade cases 只读上下文。
- `downstream_outputs`: market brief、关键支撑阻力、偏向与结构切换条件。
- `invariants`: 事实与解释分离；实时结论必须说明数据时间；输出只能是 brief，不是执行指令。
- `allowed_dependencies`: `operator-surface`、`risk-guard`、`decision-chain` 只读。
- `forbidden_dependencies`: `records/` 写入、完整 trade scenario 生成、未验证新闻或订单簿细节。
- `non_goals`: 不是新闻链路，不是回测模块，不是执行模块。
- `change_triggers`: 需要稳定整合多源研究资产；BTC 之外出现多品种支持；brief 格式持续失效。
- `future_split_points`: 当“市场事实提取”和“观点压缩”出现不同 owner 或不同输入资产时，可拆成 `market-facts` 与 `research-briefs`。

### `scenario-planning`

- `mission`: 把市场简报收敛为条件式多空计划，而不是预言式指令。
- `owned_artifacts`: `skills/btc-trade-scenarios/`。
- `upstream_inputs`: `research-synthesis` 输出、用户时间框架、`decision-chain` 只读上下文、`risk-guard` 约束。
- `downstream_outputs`: long / short / no-trade scenarios，包含触发、入场、止损、止盈、失效条件。
- `invariants`: 必须条件式；必须写清 invalidation；默认双边计划；结构脏时允许以观望为主。
- `allowed_dependencies`: `research-synthesis`、`risk-guard`、`decision-chain` 只读。
- `forbidden_dependencies`: `records/` 写入、实时执行、个性化仓位建议、跳过 invalidation。
- `non_goals`: 不是复盘模块，不是实时数据验证模块，不是 record writer。
- `change_triggers`: 稳定的策略家族分化；需要对多个时间框架输出独立计划；需要引入 plan scoring。
- `future_split_points`: 当“情景生成”和“计划评分/筛选”出现独立变更时，可拆成 `scenario-builder` 与 `scenario-eval`。

### `decision-chain`

- `mission`: 把用户明确要求保存的判断、更新、执行、风险变化、平仓与复盘落成 append-only 决策链。
- `owned_artifacts`: `records/`、`records/schema.md`、`records/README.md`、`templates/`、`skills/trade-record-chain/`。
- `upstream_inputs`: 用户显式持久化意图、daily note、market brief、scenario、具体交易事实。
- `downstream_outputs`: `records/daily/YYYY/YYYY-MM-DD.md` 与 `records/trades/YYYY/YYYY-MM-DD-<slug>/`。
- `invariants`: 不偷偷写入；不回改旧事件；事件编号单调递增；`derived_from` 只能指向过去；`events/` 是 trade lifecycle truth；`meta.md` 只承载 case identity 与慢变化元数据。
- `allowed_dependencies`: `operator-surface`、`risk-guard`、`research-synthesis`、`scenario-planning` 只读。
- `forbidden_dependencies`: 实时市场真伪验证、回测、执行自动化、替上游模块改写历史判断。
- `non_goals`: 不是数据库替代品，不是研究计算层，不是市场判断模块。
- `change_triggers`: record schema 演进；需要更强 lineage；daily note 与 trade case 出现不同 owner。
- `future_split_points`: 当 `daily` 与 `trade-case` 同时出现独立 schema owner、独立 invariants 或独立 review cadence，且继续共挂在同一 writer 下会造成耦合时，才可拆成 `daily-chain` 与 `trade-chain` writer modules。

## Latent Modules

### `rd-lab`

- `mission`: 容纳探索性研究、假设、特征构想与实验协议草案。
- `owned_artifacts`: 未来的 research notes、experiment outlines、paper digests。
- `upstream_inputs`: `market-cleanroom`、`news-chain`、`backtest-lab`、外部研究材料。
- `downstream_outputs`: 可复核的研究假设、候选 features、候选 playbooks。
- `invariants`: 研究资产必须 append-only；研究草案不是 operator truth，不直接进入用户交易回复。
- `allowed_dependencies`: `market-cleanroom`、`news-chain`、`backtest-lab`、`eval-bench`。
- `forbidden_dependencies`: `decision-chain` 写入、替代 `research-synthesis`、伪装成实时市场结论。
- `non_goals`: 不是日常记录目录，不是 record writer。
- `change_triggers`: 跨多次 run 复用的研究资产出现；实验协议需要独立 lineage。
- `future_split_points`: 当“实验记录”和“论文摘录”出现独立 owner 或维护节奏时。

### `market-ingest`

- `mission`: 定义并采集原始市场数据快照入口。
- `owned_artifacts`: 未来的 source contracts、raw snapshot manifests、ingest runbooks。
- `upstream_inputs`: 交易所 API、行情聚合源、用户上传快照。
- `downstream_outputs`: append-only 原始快照与抓取元数据。
- `invariants`: raw layer append-only；原始层不可就地清洗、聚合或解释。
- `allowed_dependencies`: 外部数据源、`operator-playbooks`。
- `forbidden_dependencies`: `scenario-planning`、`decision-chain`、cleanroom 之后的解释层直写。
- `non_goals`: 不是指标计算层，不是 user-facing brief。
- `change_triggers`: 同类 raw snapshots 被多次手工复用；source contract 开始稳定。
- `future_split_points`: 按 venue、品种或 cadence 拆分。

### `market-cleanroom`

- `mission`: 把原始市场数据规范化为可分析、可回测、可复现的 clean assets。
- `owned_artifacts`: 未来的 normalization specs、clean schemas、quality checks。
- `upstream_inputs`: `market-ingest` 原始快照。
- `downstream_outputs`: 标准化 OHLCV、range facts、volatility windows 等 clean artifacts。
- `invariants`: 变换必须可复现；不掺入主观结论；clean asset 与 raw asset 必须可回链。
- `allowed_dependencies`: `market-ingest`、`market-catalog`。
- `forbidden_dependencies`: `decision-chain`、`scenario-planning`、用户可见市场判断。
- `non_goals`: 不是 catalog，也不是回测结果层。
- `change_triggers`: 相同清洗逻辑在多个位置重复；clean schema 开始稳定。
- `future_split_points`: 当 spot / perp / macro 数据形成独立契约。

### `market-catalog`

- `mission`: 为市场与研究资产提供 discoverability、schema registry 与 lineage map。
- `owned_artifacts`: 未来的 asset index、schema registry、lineage conventions。
- `upstream_inputs`: `market-cleanroom`、`news-chain`、`backtest-lab`、`eval-bench`。
- `downstream_outputs`: 数据集目录、字段契约、资产关系图。
- `invariants`: catalog 只描述资产，不生成资产；命名与 schema version 必须稳定。
- `allowed_dependencies`: 所有数据生产模块只读。
- `forbidden_dependencies`: 实际存储真相、交易判断、records 写入。
- `non_goals`: 不是 ingest 层，不是执行日志。
- `change_triggers`: 资产数量或 schema 数量达到手工说明不可维护。
- `future_split_points`: 当 schema registry 与 lineage registry 分别演进。

### `news-ingest`

- `mission`: 定义并采集原始新闻、公告与宏观事件流入口。
- `owned_artifacts`: 未来的 source lists、raw article manifests。
- `upstream_inputs`: 新闻 API、RSS、手工粘贴链接。
- `downstream_outputs`: append-only 原始新闻条目。
- `invariants`: 原始文本、发布时间、来源引用不可丢；raw news 不做观点提炼。
- `allowed_dependencies`: 外部数据源、`operator-playbooks`。
- `forbidden_dependencies`: `research-synthesis` user-facing 输出、`scenario-planning`、`decision-chain`。
- `non_goals`: 不是摘要器，不是观点模块。
- `change_triggers`: 新闻成为稳定上游输入而非偶发引用。
- `future_split_points`: 按 macro / crypto-native / regulatory 来源拆分。

### `news-chain`

- `mission`: 把原始新闻条目整理成可追溯的事件链和主题链。
- `owned_artifacts`: 未来的 dedupe rules、event schema、theme lineage docs。
- `upstream_inputs`: `news-ingest`。
- `downstream_outputs`: 主题聚合、事件节点、source-backed summaries。
- `invariants`: event/theme assets append-only；每个摘要都必须回链原始条目。
- `allowed_dependencies`: `news-ingest`、`market-catalog`。
- `forbidden_dependencies`: 交易计划生成、records 写入、替代 `research-synthesis`。
- `non_goals`: 不是 market brief，不是 trade planner。
- `change_triggers`: 同一事件跨多来源需要持续合并；news lineage 需要独立 review。
- `future_split_points`: 当“事件抽取”和“主题归因”需要不同 owner。

### `backtest-lab`

- `mission`: 用历史数据评估规则表达，而不是为当前回复制造伪确定性。
- `owned_artifacts`: 未来的 backtest specs、run manifests、result summaries。
- `upstream_inputs`: `market-cleanroom`、`rd-lab`、可回测的 scenario/rule 表达。
- `downstream_outputs`: 样本交易、收益风险指标、失败样本。
- `invariants`: 假设、时间区间、费用、滑点必须显式；run metadata append-only。
- `allowed_dependencies`: `market-cleanroom`、`rd-lab`、`eval-bench`、`market-catalog`。
- `forbidden_dependencies`: 反向覆盖历史记录、直接输出实时指令、直接写 user-facing trades。
- `non_goals`: 不是生产执行层，不是 current market brief。
- `change_triggers`: 同一策略族反复需要历史验证；回测口径开始稳定。
- `future_split_points`: 当“信号回测”和“执行仿真”需要不同引擎。

### `eval-bench`

- `mission`: 作为研究与回测的固定评估台，防止每次按不同口径讲故事。
- `owned_artifacts`: 未来的 benchmark sets、scorecards、regression criteria。
- `upstream_inputs`: `backtest-lab` 结果、基准数据集、固定评估口径。
- `downstream_outputs`: 可比较的评分、退化信号、failure taxonomy。
- `invariants`: benchmark 版本化；评分口径稳定；结果可重放；bench truth 不回写策略叙事。
- `allowed_dependencies`: `backtest-lab`、`market-catalog`。
- `forbidden_dependencies`: 直接对用户生成交易建议、records 写入、替代研究解释层。
- `non_goals`: 不是 research notebook，不是 operator-facing planner。
- `change_triggers`: 出现多套策略或模型需要横向比较。
- `future_split_points`: 当“离线评分”和“回归预警”需要不同资产。

### `operator-playbooks`

- `mission`: 沉淀重复性人工流程，让 operator 行为可复制但不自动化过度。
- `owned_artifacts`: 未来的 runbooks、checklists、handoff notes。
- `upstream_inputs`: `operator-surface`、各模块合同、复盘经验。
- `downstream_outputs`: 标准操作步骤、升级路径、人工核查清单。
- `invariants`: playbook 只描述流程，不持有状态真相；流程文档不替代 chain。
- `allowed_dependencies`: 所有文档模块只读。
- `forbidden_dependencies`: 市场数据写入、交易结论写入、record chain 共写。
- `non_goals`: 不是执行引擎，不是记录真相面。
- `change_triggers`: 某类操作步骤在多个 run 中重复出现。
- `future_split_points`: 按 daily prep / decision logging / review loops 分拆。

## Promotion Truth

latent module 是否升级为真实目录，属于 cross-module coupling、writer ownership 与 chain ownership 决策，而不是 module map 决策。

为避免 promotion 条件在两份 canonical 文档里继续漂移，本文件不再复制具体 promotion rules；统一以 [dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md) 为准。

## Dependency Truth

更细的 cross-module allowed / forbidden edges、writer ownership、append-only chain ownership 与 promotion rules 见：

- [dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md)

## References

- [LangChain Context Engineering](https://docs.langchain.com/oss/javascript/langchain/context-engineering)
- [LangChain Multi-agent](https://docs.langchain.com/oss/javascript/langchain/multi-agent/index)
- [Dagster Assets](https://docs.dagster.io/guides/build/assets)
- [OpenLineage About](https://openlineage.io/docs/)
- [OpenLineage Object Model](https://openlineage.io/docs/spec/object-model)
- [Qlib Recorder](https://qlib.readthedocs.io/en/stable/component/recorder.html)
