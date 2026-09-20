# Scanner

## 职责

按固定周期在受治理策略和当前市场条件之间执行慢轨匹配，再向 Strategy Governance 提交绑定证据的部署提案。Scanner 永不激活 Runtime，也不拥有策略生命周期状态。

## 拥有的权威事实

- 版本化 Scanner Schedule Definition 绑定 scan-scope 身份与版本、calendar time zone cadence、时区规则、
  fold/gap disposition、due-slot derivation、misfire/backfill policy、共享时钟和有效期。稳定 attempt 身份只
  由 definition version、准确 scan-scope 身份与版本和规范无歧义 due-slot boundary 派生；clock epoch 与
  continuity 只是准入证据，不属于身份。重复投递 并发 重启或迟到触发都加入同一 attempt 与终态回执。
- 每个纳入策略都有一个 Scanner Strategy Disposition：`MATCHED` `NO_MATCH` `INSUFFICIENT_DATA`
  `INPUT_UNAVAILABLE` 或 `CONDITION_FAILED`；`FAILED` 绝不是逐策略状态。每个 disposition 都绑定 ArtifactRef
  条件版本和消费输入。
- 每轮只有一个 batch Scanner Receipt，为 `PROPOSED` `NO_MATCH` `INSUFFICIENT_DATA`
  `COMPLETED_NO_PROPOSAL` 或 `FAILED`；仅 `PROPOSED` 携带证据完整的匹配策略。完整集合没有 `MATCHED`
  且至少一个本地 `CONDITION_FAILED` 时为 `COMPLETED_NO_PROPOSAL`，并保留每个成员 disposition。
- 其他策略失败或数据不足仍保留在回执中，即使 batch 为 `PROPOSED` 也不会抹掉负面结果。
- 完整回执的 expected 与 observed 策略集必须相等。不完整 `FAILED` 回执采用互斥分支：expected 成员已知时绑定准确 expected observed 以及 `missing = expected − observed`；成员尚未解析时绑定权威未解析 disposition observed 事实 明确的 missing-members-unavailable 标记和不可变终态原因，绝不编造成员。

## 模块

- **Strategy Loader** - 从治理注册表加载可部署 ArtifactRef 激活条件 数据需求 版本和生命周期限制。
- **Market Snapshot** - 按策略推导外部提供的 universe-selection rule 所需标的与窗口，绑定 PIT 行情
  calendar session/time-zone corporate-action 历史 membership 与 semantics 输入或明确负面 disposition。
- **Strategy Matcher** - 按各自绑定输入评估激活条件，一个策略缺数据或执行失败不得压制其他完整匹配。
- **Proposal Builder** - 把匹配策略 证据 可选 Capacity View 身份和停止条件封装为可审计提案。

## 实现状态台账

本台账只记录仓库在本截面实际到达的状态。它沿用 [Market Data](./market-data/) 台账的状态词汇，并以
`CURRENT_PARTIAL` 表示已合并但不可触达的形态；台账本身不授予任何许可：本截面上 `IMPLEMENTATION_ADMITTED`
的恰好是输出交接中 Product Edge 那条点名的终态回执托管切片，扩大准入集必须先按 `AGENTS.md` 的架构权威规则
修改本文档。已合并的 crate、已命名的类型、一次绿色作业或本台账的一行都不是实现权威，既不证明存在生产消费者，
也绝不授权任何生产效应、部署切换或真实交易。

- **CURRENT_PARTIAL - 确定性的 Scanner 核心：** `crates/scanner` 拥有带 fold、gap 与 misfire 处置的 `ScheduleDefinition`、
  due-slot 派生与稳定的 `AttemptId`、逐策略 `StrategyDisposition`、带五种状态与互斥成员分支的终态 `ScannerReceipt`、
  `BatchOperationalFailure` 类别、其 Time 与 Governance 成员来源 Owner 准入为 crate 私有的 `Scanner` 服务、
  `TerminalReceiptStore` port，以及 `ProductEdgeTerminalReceiptReader` 读缝。`crates/scanner/src/tests.rs`、
  `crates/scanner/tests/public_owner_admission.rs` 与编译失败测试证明了这一失败关闭形状。
- **TARGET - 生产装配：** 不存在调度器触发、sealed 来源 Owner 准入的生产构造器、`TerminalReceiptStore` 背后的持久
  回执 custody，以及 Product Edge 消费者；唯一的外部使用是 `crates/testkit/tests/f1_current_workspace.rs` 里的一个
  类型导入。本条点名的持久 custody 与 Product Edge 消费者即已准入的切片；调度器触发与 sealed 准入构造器不是。
- **TARGET - Strategy Loader、Market Snapshot 与 Capacity View 输入：** `StrategyLoader` 与 `MarketSnapshot` port 没有
  任何基于受治理注册表、Market Data PIT 事实或 Portfolio Capacity View 的实现。
- **TARGET - 交接与持久化：** 没有任何终态回执到达 Governance 或 Product Edge，也没有任何 Scanner 事实被持久化。
  本条中 Product Edge 的那一半已准入；到 Governance 的交接没有。

## 输入交接

以下每条契约陈述的是 Scanner 要求什么 拒绝什么，而不是上游返回什么。四条缝在本截面上都不存在，台账中
关于 `StrategyLoader`、`MarketSnapshot` 与 Capacity View 输入的那条已记；满足一条契约是对未来实现的条件，
绝不是某条实现已被准入的证据。

- 调度器提供固定周期触发而不提供事实，它没有部署权威。触发不携带任何 Scanner 信任的身份：尝试身份只由
  Schedule Definition 版本 准确的扫描范围身份与版本 以及规范无歧义的到期槽边界导出。重复 并发 重启或迟到的
  触发并入同一次尝试与同一份终态回执。缺失触发根本不产生尝试，因为没有尝试的回执等于断言发生过一次扫描。
  Scanner 绝不让触发创造定义导不出的到期槽，也绝不把触发的时钟纪元纳入稳定身份。
- [Strategy Governance](./strategy-governance/) 为一个到期槽提供受治理策略前沿：每个成员的准确 ArtifactRef
  Eligibility 激活条件版本 资金封套版本 声明的数据需求与生效区间，与该到期槽相关联，并携带前沿自身的身份与
  内容摘要。Scanner 要求的回答只有两种：要么绑定一个它可以据以核算的期望成员集合，要么绑定成员无法解析的
  权威原因；其余一律拒绝。只有前者准入期望集合，因此也只有前者能到达任何状态的完整回执。后者与缺失回答都
  在未解析集合分支上把尝试闭合为 `INCOMPLETE_FAILED`。Scanner 绝不从先前前沿 从它碰巧观察到的策略 或从一份
  部分回答重建成员，也绝不把更小的前沿当作完整的前沿。
- [Market Data](./market-data/) 为每个策略及其声明的数据需求提供一份密封 PIT 回读，与准确的请求身份和内容
  摘要相关联，携带该 Owner 已发布的六态判定 `AVAILABLE` `INSUFFICIENT` `STALE` `UNLICENSED` `AMBIGUOUS` 或
  `UNAVAILABLE`，连同准确的 Universe Selection Record 身份与摘要 Instrument Master 日历 交易时段与时区
  公司行动与历史成员截面 以及 Market Semantics Compatibility 身份。只有 `AVAILABLE` 能把一个策略带到
  `MATCHED`。`INSUFFICIENT` 提交该策略的 `INSUFFICIENT_DATA`；其余四态各自提交它的 `INPUT_UNAVAILABLE`，
  缺失回答同样如此，且都只针对该策略。这些都不是 batch 失败：一个策略缺少输入绝不能压住另一个策略的完整
  匹配。Scanner 绝不修复语义不匹配 绝不替换为相邻截面 也绝不把一个否定判定读作没有不利数据。
- [Portfolio](./portfolio/) 只在已发布激活条件要求容量时提供有界 Capacity View。Scanner 绑定候选中立的
  Capacity Scope 准确的账户事实 估值与流动性截面 资金池方法与假设版本 测量时刻 以及有效期限。只有 Capacity
  Scope 截面 版本与新鲜度全部与该条件匹配的 `AVAILABLE` 视图才能把该策略带到 `MATCHED`；部分 过期 不可用 跨 scope，或
  方法 假设 输入截面不匹配的视图提交 `INPUT_UNAVAILABLE`，缺失回答同样如此。条件不要求容量时，视图缺失不是
  缺陷，也绝不改变任何判定。Scanner 绝不把带策略或带 generation 的 scope 一个 Paper/Live 别名 或一处未解析的
  共享约束重叠，当作条件所指的候选中立 scope。

## 输出交接

- 每个定时 ScanId 向 [Strategy Governance](./strategy-governance/) 提交且只提交一个终态 Scanner Receipt，
  绑定稳定的尝试身份，并且只携带 `PROPOSED` `NO_MATCH` `INSUFFICIENT_DATA` `COMPLETED_NO_PROPOSAL` 或
  `FAILED` 之一。只有 `PROPOSED` 携带 proposal members，而 Governance 只能考虑那些策略条目 ArtifactRef 与
  条件版本都与其决定对象完全相等的成员。缺失回执保持未知：绝不读作 `NO_MATCH`，绝不读作一次已完成的扫描，
  在激活依赖条件时也绝不读作可以不凭 Scanner 证据继续的许可。回执是证据，绝不是授权。
- 向 Product Edge 提供每个 ScheduledScanId 的 Scanner-owned 终态回执直接读取，以该身份为键，返回回执准确的
  完成状态 它互斥的 expected-set 分支 它的终态原因，以及只在 `PROPOSED` 时才有的 proposal members。一次读取
  要么返回恰好一个绑定到所请求尝试的终态回执，要么拒绝。以下四种情况分别拒绝：该尝试没有回执；存储返回了
  绑定到别的尝试的回执；存储自述语义冲突；存储不可用。中间两种是**已检出的托管故障**，绝不得显示成缺失或
  未知的结果。Product Edge 不创建第二份 Scanner-owned 投影，不派生自己的状态，也绝不把一个不完整的
  `FAILED` 集合标为完整，或把一个未解析的期望集合渲染成空集。
  **IMPLEMENTATION_ADMITTED，终态回执托管及其 Product Edge 读回：** 一个位于 `TerminalReceiptStore` 之后的生产
  实现，为每个 ScheduledScanId 持久保存且只保存一个终态 Scanner Receipt；以及其上的一个
  `ProductEdgeTerminalReceiptReader`，它对一次读取要么返回恰好那一份回执，要么给出上述四种拒绝之一，其中
  中间两种仍然区分为已检出的托管故障。这一切片是有界的，因为两端都已经作为 port 存在于 `crates/scanner` 内部，
  且两个名字在该 crate 之外都没有任何引用，所以它不等待任何尚不存在的缝。
  **NOT_ADMITTED：** 调度器触发、sealed 来源 Owner 准入的生产构造器、任何 `StrategyLoader` `MarketSnapshot`
  或 Capacity View 实现、到 Governance 的回执交接、终态回执以外的任何 Scanner 事实，以及一切生产效应
  部署切换与真实交易。

## 拒绝和禁止事项

- Scanner 提案只是证据，不能创建授权血缘 批准无人值守运行或自行合法进入 Runtime。Governance
  只能在既有已授权无人值守生命周期血缘内考虑它，并另外提交生命周期决定。
- 不启动 停止或修改 Runtime 策略实例。
- 不改变 Strategy Registry 生命周期 Qualification 或资金政策。
- 不把历史不足或低质量数据当作满足激活条件。
- 不产生 Trade Intent Risk Decision Reservation 或订单命令。
- 不把部分 过期 不可用 跨 scope，或经济条件 方法 假设 输入截面不匹配的 Capacity View 当作已满足的必需输入。

## 失败与恢复

单个策略输入不可用或条件错误只把该策略闭合为 `INPUT_UNAVAILABLE` 或 `CONDITION_FAILED`，两者都
不能制造 batch operational failure。完整集合没有 `MATCHED` 且至少一个 `CONDITION_FAILED` 时闭合为
`COMPLETED_NO_PROPOSAL`，并保留每个成员。batch `FAILED` 只保留给 `INCOMPLETE_FAILED` 或有独立证据的
`BATCH_OPERATIONAL_FAILED`；后者准确绑定 `SCHEDULER_ORCHESTRATION_FAILURE`
`SCANNER_SERVICE_FAILURE` 或 `SHARED_DEPENDENCY_OPERATIONAL_FAILURE` 之一，以及 failure identity、证据
source cut 与 Time Evidence。expected 已知且不完整时记录准确缺失成员；expected 未解析时记录成员
不可用原因且绝不编造 missing 集。任何失败分支即使已有局部匹配也不含提案。总优先级为独立证明的
batch `FAILED`、完整 `PROPOSED`、完整 `COMPLETED_NO_PROPOSAL`、`INSUFFICIENT_DATA`、`NO_MATCH`。

调度定义在执行前决定 due slot。相同 definition version、scan-scope 身份与版本和规范 boundary 始终
解析到同一 attempt 与终态回执。cadence calendar time zone 时区规则 fold/gap misfire 或 backfill rule
变化时创建后继 definition。clock continuity 缺失，或 scope/slot 证据冲突 无法解析时，不创建 attempt；
基于墙钟的重试不能发明新 slot，也不能把新 clock epoch 写入稳定身份。

## 决策契约

- **输入** - 一个 due slot、完整受治理 registry frontier、策略激活条件、所需 PIT snapshot 和仅在条件
  要求时使用的 Capacity View。
- **诊断与决定** - 独立评估每个策略，覆盖完整 expected set，再为每个策略提交 disposition 并为 batch
  提交唯一终态回执。
- **冲突解析** - due-slot identity 汇合重复；总优先级为独立证明的 batch `FAILED`、完整 `PROPOSED`、
  本地 `CONDITION_FAILED` 对应的完整 `COMPLETED_NO_PROPOSAL`、`INSUFFICIENT_DATA`、`NO_MATCH`。
  membership 不完整为 `INCOMPLETE_FAILED`；独立类型化 batch operational failure 为
  `BATCH_OPERATIONAL_FAILED`。
- **输出与终态负例** - 证据提案或准确 no-match insufficiency failure unknown membership 证据；都不是部署权威。
- **反馈与经济意义** - 定期发现冻结激活证据当前匹配的策略，避免无价值常驻实例和数据不足造成假匹配。
- **禁止** - 不拥有 lifecycle 分配 Runtime application Trade Intent 风险 订单 账户或效果。

## 后续实现验收

- 每个定时触发都准确产生一个 `PROPOSED` `NO_MATCH` `INSUFFICIENT_DATA`
  `COMPLETED_NO_PROPOSAL` 或 `FAILED` 终态回执。
- 每个 attempt 与 receipt 重复准确 schedule-definition version、scan-scope identity/version 和规范
  due-slot boundary；clock-epoch 变化要求 continuity 或新准入证明，但不改写 attempt 身份。
- 每个纳入策略都有一个绑定条件版本和消费事实或负面 disposition 的终态结果。
- 某些策略条件失败或数据不足时，其他完整匹配仍可使 batch 为 `PROPOSED`；无匹配且有本地
  `CONDITION_FAILED` 时为 `COMPLETED_NO_PROPOSAL`，绝不是 `FAILED`，之后才按数据不足与无匹配汇总。
- 完整逐策略 disposition 集提交前不能为 `PROPOSED`。`FAILED` 只表示 `INCOMPLETE_FAILED` 或绑定一个
  已准入类别并有独立证据的 `BATCH_OPERATIONAL_FAILED`；任何逐策略 disposition 都不能创建或替换它。
- Product Edge 必须显示准确完成状态和互斥分支：已知时显示 expected observed 与 missing，未知时显示未解析 disposition observed 事实和 missing-members-unavailable 标记。不能把不完整 `FAILED` 集标为完整。
- Governance 只能激活策略条目 ArtifactRef 和条件版本都与决定目标完全相同的 proposal member。
- Strategy Loader 和 Market Snapshot 共同输入 Strategy Matcher，只有匹配结果进入 Proposal Builder。
- 激活条件要求容量时，`MATCHED` 必须绑定候选无关 Capacity Scope、准确账户事实与流动性截面、
  资金池方法与假设版本、测量时间和新鲜度；generation 特定条件证据另行绑定对应策略。任一字段缺失
  或不匹配都提交 `INPUT_UNAVAILABLE`。
- 每个 match 绑定 Strategy Artifact 要求的准确 Universe Selection Record、Instrument Master、
  calendar/session/time-zone、corporate-action 与历史 membership cut 及 Market Semantics Compatibility
  身份。Scanner 不编造成员，也不修复语义不匹配。
- 相同注册表版本 快照和条件版本可重现相同匹配结果。
- 任何 Scanner 路径都不能绕过独立 Governance 决定激活 Runtime。
- Governance 若基于提案作决定，必须绑定准确 due slot 终态回执 proposal member 和既有无人值守授权
  血缘；不能把 Scanner 的证据输出解释成授权。

## 可观测性与持久化

Scanner 原生持久化 Schedule Definition、稳定 due-slot Attempt、准确输入 frontier、逐策略 disposition、
终态 Scanner Receipt 与 Proposal；`BATCH_OPERATIONAL_FAILED` 还持久化 batch failure identity、唯一已准入
类别、证据 source cut 与 Time Evidence。Telemetry 覆盖调度延迟、attempt 时长、逐策略隔离、缺失输入
类别、聚合完整性和类型化独立 batch operational failure。Dashboard 分别统计 condition-failed member、
`COMPLETED_NO_PROPOSAL` 与类型化 batch `FAILED` receipt；retry 必须 join 同一稳定 attempt，不能重复
增加 scan 或 proposal。
