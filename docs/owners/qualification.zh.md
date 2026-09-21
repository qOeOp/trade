# Qualification

## 职责

独立判断冻结候选是否满足预注册证据 holdout 成本 容量和运行条件。Qualification 拥有可部署资格证据，不拥有策略设计 激活或恢复。

## Eligibility 终端状态

本节是实现状态记录，不是契约。它本身不授予任何权限，列在这里的步骤也不构成建造 部署或驱动保护评估的权威。
下文契约不因某个步骤有没有调用者而改变。

**Eligibility 终端由有序 PostgreSQL 门禁驱动，而且只有它在驱动。** 每一步都被那个门禁自己的条目调用，
所以 Protected Replay Request Set、Attempt Frontier、Robustness Assessment 与 Eligibility Fact
在门禁的数据库里都存在。步骤清单就是 `scripts/ci/test-rd-owner-postgres.bash` 里那个有序数组中属于
Qualification 与 Backtest 的那些条目，那里始终是它们唯一的清单；没有任何一步在它之外有调用者。

第一步所需的 Shared Time 交接，由门禁从本仓库 sealed-acceptance 面的
`issue_protected_evaluation_shared_time_v1` 构造，不是从部署解析器取得。**部署解析器仍然是关闭的**，
原因记录在下文 需要部署授权的终端 一节，所以在门禁里驱动该终端，并不证明一次部署能驱动它。

有两条更早的条目仍然断言 Eligibility 不存在，而且它们仍然通过，因为有序门禁共用一个从不重置的数据库，
它们跑在提交第一条 Eligibility Fact 的那条条目之前。**在第 `n` 条断言的缺席，是第 `n` 条处的缺席，
不是本 Owner 的性质**。把那两条读成「Eligibility 永不存在」，正是这一段过去所编码的误读。

这些步骤严格串联。V2 请求是 V1 提案加一个 `ClockHeadHandoff`，而生产的共享时钟 resolver 由
`DEPLOYMENT_STORE_ADMISSION_MODE` 构造，它保持 `disabled`。门禁不使用那个 resolver，也不需要它：
`issue_protected_evaluation_shared_time_v1` 在 sealed-acceptance 面上签发该交接，
所以 V2 请求、非空请求集、终态结果、已关闭的 frontier 与一份评估，全都在那里被构造出来。
set 封存只接纳 `schema_version=2` 成员--Origin 行的规范编码不同，读进来会让 frontier 搁浅--
而门禁提供的正是 `schema_version=2` 成员。

因此把共享时钟证据准入到一次**部署**，仍然是部署驱动该终端的前置。它不再是驱动该终端本身的前置。

**TARGET - 需要部署授权的终端，以及它在等什么：** 这条终端是 TARGET，不是未完成的工作。
`DEPLOYMENT_STORE_ADMISSION_MODE` 保持 `disabled`，直到存在一个部署授权方能够签发 `required`
所要求的东西：custodian 签名历史、反回滚 witness、凭据租约与直接测量。这些在本仓库都不存在，
也未授权任何真实交易或生产写入，因此 resolver 返回空是正确的关闭状态而非缺陷。
Qualification 的其余部分并不排在它后面：attempt frontier、候选与评估规则，
以及上文的 protected-replay custody 都是可分离的工作；把这条终端当成它们的阻塞，
是对依赖关系的误读，而不是依赖本身的性质。

## 拥有的权威事实

- 持久 principal/scope 保护反馈历史及其不透明解析 frontier。Research 前的读取绑定一个准确 R&D
  Independence Basis Receipt，只能解析为 `GENESIS_EMPTY` `FRONTIER(ref, cut)` 或 `UNAVAILABLE`，并绑定
  source sequence/cut clock epoch 与半开有效期。
- R&D 拥有 Candidate 身份及其不可变穷尽 TrialFamily Census Frontier。Qualification 为一个稳定
  Qualification Review Request 与规范类型化含义拥有只写一次的 Candidate Intake Receipt；该回执绑定
  Research 终态 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition 不可变穷尽 TrialFamily
  Census Frontier 以及准确预注册保护决策政策身份与版本，状态为 `NOT_ADMITTED` 或
  `ADMITTED`，评估进度不会改写该关联请求回执。
- 具有不可变政策身份与版本的保护评估规则 holdout 预算与累计处理 embargo 成本 容量假设 试验族边界 跨 TrialFamily 前驱前沿和保护反馈观察前沿。
- Protected Robustness Assessment 绑定 Candidate 冻结 Protected Robustness Plan 和请求相等终态结果。
  它重复准确 plan-cell-set digest，把每个计划必需单元准确枚举一次为 `PASS` `FAIL` `NOT_APPLICABLE_ACCEPTED`
  `NOT_APPLICABLE_REJECTED` 或 `MISSING`，并绑定准确适用性 证据 政策和 Time Evidence。它只是
  Eligibility 分类证据；同一轴可以包含多个必需单元，且它绝不是向 Research 返回保护细节的通道。
- 冻结 Protected Replay Request 身份包含准确保护决策政策身份与版本 Strategy Artifact 请求 PIT 范围
  准确 PIT Market Snapshot 身份 快照与修订规则 重放配置摘要 Runtime 内核 模拟器及成本 滑点 容量模型版本。
  它声明 `PROTECTED_EVALUATION` 为规范 `timeEvidenceCutKind`，并密封 request-stage root cut。
- Protected Attempt Disposition 为 `REPLAY_REJECTED` `REPLAY_INVALID` 或 `ASSESSMENT_INVALID`，绑定 intake
  重放请求 终态结果和预注册 holdout 闭合，它不是 Eligibility。
- 每个初始或续期 Eligibility Fact 都交叉绑定准确 Protected Replay Request 准确 `TERMINAL_RESULT`
  Protected Run Result 保护决策政策身份与版本和已验证请求结果相等关系。
- 当前 Eligibility State 包含条件 过期时间 证据引用 撤销历史，以及 `QUALIFIED` 对应的下游可执行经济条件版本 已评估成本容量模型版本和资格容量上限。

## 模块

- **Candidate Intake** - 为不可变 Candidate 和证据包写入唯一回执；`NOT_ADMITTED` 不创建保护尝试也不消耗 holdout。
- **Protected Evaluation** - 按结果揭示前冻结的规则请求并评估隔离保护重放；只有匹配
  `TERMINAL_RESULT` 且按绑定保护决策政策版本评估后才能提交 Eligibility Fact。被拒绝 无效 非终态
  或不匹配证据均不能提交 Eligibility。
- **Eligibility State** - 发布当前不合格 合格 过期或撤销的可部署事实 条件 撤销历史，以及 Governance
  与 Risk 必须执行的有界经济容量契约。它把撤销作为 Eligibility 转换拥有，但不接管 Runtime 恢复。

## 实现状态台账

本台账只记录仓库在此切点已经到达的状态。它沿用
[Market Data](./market-data/) 台账的状态词汇，`CURRENT_PARTIAL` 表示已合入但不可达，本节自身不授予任何权限。
这里没有任何一行是 `IMPLEMENTATION_ADMITTED`：本 Owner 没有已准入的切片，要扩大准入集合必须先改本文档。
某项事实若已有独立小节，本行只指向它而不重复它，这样需要同步的地方只有一处。

- **CURRENT_PARTIAL - Candidate Intake：** `submit_candidate_intake_v1`（位于
  `crates/qualification/src/postgres.rs`）在 Candidate advisory lock 下写入回执，并对已 intake 的 Candidate 的
  第二次评审请求返回类型化冲突。它没有生产调用者：本 Owner 之外的每一处调用都在
  `sealed-develop-composer-acceptance` 测试模块里，该模块位于
  `crates/strategy_factory/src/iteration_decision_postgres.rs`。
- **CURRENT_PARTIAL - Protected Evaluation：** 每一个保护终端都由有序 PostgreSQL 门禁完整驱动，而且只有它在驱动。
  它的各条目与准入每个终端的密封证据，就是 `scripts/ci/test-rd-owner-postgres.bash` 里那个有序数组中属于
  Qualification 的那些行，而那个数组始终是它们唯一的清单；门禁到达不了的那两项行为，记录在下文
  有序门禁到达不了的行为 一节。
- **CURRENT_PARTIAL - Research 前保护反馈解析：** 这是唯一有生产调用者的能力。
  `resolve_or_create_for_basis` 与 `admit_in_transaction` 由
  `crates/strategy_factory/src/product_edge_postgres.rs` 调用，
  `admit_historical_projection_in_transaction` 由
  `crates/strategy_factory/src/rd_owner_postgres_custody.rs` 调用，都不在任何测试模块内。它的读回有一条有序链路
  条目作为证明；response-cut 回滚没有，原因记录在下文 有序门禁到达不了的行为 一节。
- **TARGET - Eligibility State：** 该模块拥有 `INELIGIBLE` `QUALIFIED` `EXPIRED` 与 `REVOKED`，其中只有前两个有实现。
  `EligibilityState::Expired` 与 `::Revoked`（在 `crates/strategy_governance/src/model.rs`）在全仓没有任何生产者，
  `QualificationPublicStatusV1` 的五个变体里没有这两个，本 Owner 的 `qualification_*_v1` 表里没有任何以到期或撤销
  命名的关系，也不存在阻止前驱复活的后继链。消费者类型存在于 Governance，而每一个
  `UntrustedEligibilityReadback` 都构造在该 crate 自己的测试里，所以读端口的形状在场，而两侧都从未写过这样一条事实。
- **TARGET - 需要部署授权的终端：** `DEPLOYMENT_STORE_ADMISSION_MODE` 保持 `disabled`，它在等什么记录在上文
  Eligibility 终端状态 一节。
- **CURRENT，且永久不可证 - 特定事故 Owner 重建：** 机器已合入，即 `crates/qualification/src/recovery.rs`，
  经 `run_owner_recovery_cli` 导出，并以 `qualification-owner-recovery` 二进制交付（在 `owner-recovery` 特性后面），
  而它唯一的证明永远无法通过。实测记录在下文 特定事故 Owner 重建 一节。
- **TARGET - 同宇宙随机对照：** 下文 失败与恢复 一节记录的那个交接已声明，既无生产者也无消费者。
  没有任何东西发布对照集定义，没有任何东西据此合成比较程序，`crates/qualification` 也没有对照臂。
  它必须遵循的建造顺序是那条 clause 的一部分，不是对它的一条注记。

## 有序门禁到达不了的行为

本节是实现状态记录，不是契约。下面两项行为都已实现；缺的是证明，而每一处缺失都是实测出来的，不是假定的。

- **首次创建与 `GENESIS_EMPTY`。** 没有任何一个已准入的 R&D 请求能在缺少自己 frontier 的情况下存在：R&D 在形成
  TrialFamily 策略时，就已经通过 Qualification 的密封准入 API 取得了那份投影，所以门禁手上的每一个 basis 都已经
  被投影过，也就没有哪个 Qualification 条目自己会是那次首次创建。一条跳过 Qualification 解析的血缘会立刻失败，
  这就是该结论的实测方式。该分支提交出来的形状不再是无证明的：保护反馈读回那一条现在断言它读回的投影是
  `GENESIS_EMPTY`、序号为零、落在规范的 genesis 切上、且没有 source frontier -- 这四项只有创建分支会写，
  把第一项改反，该条目对着门禁填充过的存储就会红。本机跑完整条链路留下二十份投影，每一份都是这个形状，
  一次续期也没有。仍然够不着的是该分支的条件 -- frontier 只在历史为空时才提交 -- 因为驱动它需要一个
  仍然够不着的是该分支的条件。解析有三条路径而不是两条：本 basis 的投影仍然新鲜时直接重放、什么都不写；
  本 basis 没有投影且该 scope 没有 frontier 时走 genesis 那一臂；本 basis 没有投影但该 scope 已有 frontier 时
  走 `FRONTIER` 那一臂。门禁走过 genesis 那一臂二十次，走过 `FRONTIER` 那一臂零次，所以从来没有任何东西产生过
  那个 resolution、它存下来的编码、或者一份 source frontier 的身份与摘要。在有东西产生它之前，
  「选了 genesis 那一臂」和「没有别的臂可选」是同一个观察。驱动另一臂需要同一 principal 与
  authorized scope 下的第二个研究请求。闸门从来没有过的是两个请求共享一个 principal：每条条目各自
  bootstrap 自己的准入，principal 是 `admin-{suffix}`，所以每条各带一个自己的 principal，每个 scope
  只见过一个请求。这是语料的性质，不是生产路径的性质；它下面还压着一个生产路径的性质：一个 scope 的
  第一份授权是 genesis，之后每一份都必须是 successor，所以两份共享 scope 的准入需要 `issue_successor`，
  而准入 bootstrap 只会 `issue_genesis`。两者都是驱动出来的：同一 suffix 下的两份准入被拒为冲突重放，
  因为授权身份是按 suffix 派生的；一份准入服务不了两个请求，因为准入绑定它被签发时的那个请求身份；
  而同一 principal 下的两份准入被拒，因为该 scope 已经有了 genesis。

  但让那一臂走不到的不是这两条。本台账此前记的是这两条，并且记着第二份 basis 会由第一份用过的那个
  `load_or_create_basis_in_transaction` 自己写出来。那是读代码读出来的，不是驱动出来的，而驱动它就推翻了它。
  `second_request_under_one_principal_is_refused_before_the_lineage_advances`
  供上了此前缺的那个配置（一个 deployment、一个 principal、一个 authorized scope、两个请求，各自一份准入），
  而第二份 basis 并没有被写出来。第二个请求撞上的是那个函数的 `head_lineage == lineage_digest` 分支，
  而那一支是为「创建了 head 的那个请求的重放」写的：它拿收到的请求身份去查 basis-stage 托管，
  对一个它没见过的请求当然查不到，于是以 `Owner storage unavailable: R&D basis-stage custody missing` 拒绝。
  `FRONTIER` 那一臂在该分支之后，只有 lineage 前进了才到得了，而 lineage 前进需要第一个请求走完。
  lineage 会不会前进，本台账尚未记载。此处早先写的是「第一个请求也走不完，因为没人发布 Catalog V3 head，
  所以那一臂的前置是一个运维动作」。**那是在一个四条目的本机子集上测的，在闸门上为假**：第 69 条
  `catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds` 会在本条目之前发布该 head，
  而在有序闸门上第一个请求是 `Accepted`。子集跳过了建立该前置的那一条，
  于是得到的拒绝读起来像一个领域结论，而它只是跳步的产物。
  第一个请求走完之后第二个请求会怎样，尚未测量，在有序运行报出它之前本台账就这么写着。

  这两处拒绝都不是以错误的形式到达调用方的。它们都被返回成 `Ok(unresolved_result_v2(..))`，
  是 `product_edge_postgres.rs` 里二十八处同形返回之一，于是 `submit_v2` 答的是 `SubmittedOrUnknown`
  并带 `next_legal_action = ResolveSameRequestIdentity`，而理由只进了一条 `tracing::warn!`，
  闸门并不为它装订阅者。一个按 `Result::is_ok` 断言的调用方，看到的是一次它完全有理由读成「已接受」的提交。
  所以上面那条条目把断言挂在 resolution 与库上，绝不挂在 `Ok` 上；并且它是被写成「情况变好时会失败」的：
  凡是让 lineage 得以前进的改动都会把它变红，而那个红就是把它改写成断言那一臂、而不是断言这次拒绝的信号。
- **Response-cut 回滚。** 要驱动它就需要一次创建或一次续期，也就需要一个缺席或已过期的当前 frontier。把一份投影的
  `valid_through_epoch_ms` 变旧，会让它与读回所校验的规范行失去同步，于是以
  `Qualification admission envelope projection mismatch` 失败，所以本 Owner 恰好禁掉了唯一能强行触发它的途径。
  那个仅为此存在的测试专用计时钩子已经被删掉，而不是留成死代码。缺的不是前提条件。有序门禁本来就常走创建分支：
  本机跑它的前五十七个条目，留下了十七份投影，每一份都是某个 principal 与 scope 的 `GENESIS_EMPTY` 首次创建，
  所以「缺席的 frontier」是常态，不是器具需要制造的东西。器具管不了的是那个越界。回滚只在响应切离开投影那个
  半开有效窗口时才触发，而该窗口可达的那一边是 `valid_through`；另一边是响应切早于投影本身，
  那需要服务器时钟往回跳。两个切都由
  `owner_clock_epoch_ms_in_transaction` 采样，它在同一个事务里读两次 `pg_catalog.clock_timestamp()`；该调用限定了
  schema，所以任何经 `search_path` 可达的函数都顶不掉它，而有序门禁另外断言了 `qualification_writer` 不是超级用户、
  且对 `public` 与 `rd_owner_api` 都不持有 `CREATE`，因此该角色也装不了影子时钟。窗口是私有的
  `PROJECTION_VALIDITY_MS`，十分钟，没有覆盖入口。于是器具还能变动的只剩事务内的真实流逝时间，每次尝试十分钟；
  比这更便宜的一切都是生产改动，而本 Owner 没有可供这样改动的已准入切片。

## Research 前保护反馈解析

Qualification 不接收调用方对 genesis 空历史或当前反馈的断言。它直接解析准确 R&D Independence Basis
Receipt，锁定受信 principal 与 Research request scope 的完整持久历史，且只有历史为空时才提交唯一
genesis frontier。已有历史返回完整当前不透明 frontier；缺失 过期 畸形 冲突 跨 principal 跨 scope 或
跨 basis 输入都返回 `UNAVAILABLE`，且不创建 frontier 转换。

普通 create、resolve 与事务内 admission 不接收任何调用方时间。直接解析 basis、取得 principal/scope advisory
lock 并完整 canonical verification Qualification history 后，Qualification 在同一事务内采样 PostgreSQL
`clock_timestamp()`；已有 read 的 freshness 使用该 Owner cut。新 projection 在最终写入边缘只采样一次，
并只用该 cut 形成 projection time、半开 `valid_through`、receipt commit time 及其 identity 与 digest。持久化并
canonical reread 新 history 后，Qualification 在 freshness validation 与 commit 紧前采样独立 Owner response
cut；跨越 `valid_through` 会原子 rollback projection、head 与 outbox。

投影只公开 resolution state 不透明 frontier reference 与 digest basis reference 与 digest principal scope
source sequence/cut clock epoch projection time 和半开有效期。它不包含保护 payload outcome measurement
parameter holdout detail 或可解引用 evidence。未来任何保护反馈写入都必须重复预提交 basis 关系。相同
basis 与规范 source cut 重放准确相同字节；改变 basis 或 source cut 不能加入。

## 特定事故 Owner 重建

Qualification 只能执行为 2026-08-21 本地保护反馈丢失授权并封闭的
`qualification-owner-incident-v1-01a02194-139a-7281-9d2b-a87ab29d67ba` 重建。这是单一事故的
`DETERMINISTIC_CANONICAL_RECONSTRUCTION_NO_BACKUP` 契约，不是通用 restore 或 import API。它只接受准确的
证据 session 资源定位符、事故身份、授权定位符和目标数据库资源定位符；projection row、JSON 值、时间戳、
摘要、genesis 状态和当前有效性都不能由调用方输入。

任何插入前，Qualification 严格重验绑定的 JSONL record 字节、call/output/turn 配对、冻结规范生成器身份、
完整预期语义向量、存续 R&D basis/receipt/head/outbox、全局空 Qualification 历史、缺失的 recovery receipt
与未运行的 outbox publisher。封闭事故契约把 PostgreSQL cluster `system_identifier`、database name/OID 与
role name/OID 绑定为类型化字段及 domain-separated 摘要；Qualification 在任何 DDL 或写入前于事务 custody
内比较该语义目标，并在第一次 DDL 紧前再次比较。一个 serializable 事务取得 principal/scope advisory lock 和表
exclusive lock，随后依次插入原 projection、head、原 domain outbox row 与独立的 Qualification custody/audit
receipt。该 receipt 不发 domain wake，并明确没有恢复物理备份、没有观察原 JSONB 存储字节、没有铸造新
有效期。准确完成后的重放只返回相同 receipt 而不写入；partial、冲突、过期、畸形或非空状态全部 fail
closed。重建 projection 保留原半开区间，因此普通 resolver 在当前 cut 仍为 `UNAVAILABLE`。

Executable provenance 是独立的效果边界。Qualification 记录实际使用的 executable hash 并验证数据库语义，
但不声称仓库代码能够独立证明自身 executable bytes。Hub 拥有的外部 effect controller 在释放数据库能力并
执行该 worker 前，绑定已审查的 Origin ancestry、candidate commit/tree、executable path 与 SHA-256。

本节以下是实现状态记录，不是契约，上文契约不因它改变。绑定的证据 session 资源已经不存在，所以本仓库既不能
再次执行这项重建，也不能重新证明它。两项实测让这件事是永久的而不是暂时的。该资源定位符是某个开发者主目录下的
绝对路径，而 `verify_evidence` 拒绝任何其它路径，因此这条证明从来只能在那一台机器上跑，在 Linux CI 上从不可能
通过。同一个函数还钉死了该文件指定行的 SHA-256，因此任何替代文件都无法满足它。而文件本身已从那台机器上消失：
没有配置 Time Machine 目标，没有本地快照保留它，主目录与任何已挂载卷下都没有携带该 session 标识的文件，
该产物也从未提交进仓库。于是它的证明
`isolated_postgres_recovery_is_atomic_fail_closed_and_replay_safe` 在任何地方都无法通过。上文契约继续作为
一次已封闭的单一事故重建的记录；它不会因为无法再被执行而扩大成通用 restore 路径，本节也不授权用夹具替代
被封存的证据。

## 输入交接

- [R&D](./rd/) 只提交拥有终态 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition
  的冻结 Candidate。Candidate disposition 与 intake 交叉绑定准确冻结 Intent 证伪条件和停止规则
  探索请求结果前沿 成本 容量假设，以及包含 Candidate 截面前已消费预算的不可变穷尽 TrialFamily Census Frontier。
  它们还交叉绑定唯一准确预注册保护决策政策身份与版本及一个冻结 Protected Robustness Plan。
- Product Edge 提交一个稳定评估请求，绑定来源 Research 请求 Candidate 规范类型化含义和从来源到当前的保护反馈观察前沿。
- [Backtest](./backtest/) 返回请求的保护 Run Result 和消费输入回执，每个实际消费执行字段必须与请求字段完全相等。
  该 Result 携带保护经济测量，它重复本 Owner 随请求集合封存的那份冻结 `ProtectedEconomicPolicyBundleV1`
  的度量身份与摘要 单位与标度；不能逐项重复它们的测量就不是对被封存政策的测量，该次尝试因此关闭。
- Operator Authorization 是需要部署授权的终端的上游。它必须签发什么
  以及这条交接为何是 TARGET，在 Eligibility 终端状态一节已述一次，此处不重复。
- 已提交证据变化可以触发重评，唤醒通道不能替代读取 Owner 事实。

以下是这些交接的实现状态记录，不是契约。只有 Product Edge 这条有生产调用者：
`resolve_or_create_for_basis` 与 `admit_in_transaction` 由 vibe-strategy-factory 的生产代码调用，
`admit_historical_projection_in_transaction` 由它的 R&D custody 路径调用。R&D 的 Candidate 那条没有：
本 Owner 之外每一处 `submit_candidate_intake_v1` 调用都位于一个密封验收测试模块里。
Backtest 在生产中无法完成经济测量中属于它的那一半，因为它没有任何已准入的途径读到冻结的度量引用：
读不到 R&D 的 plan，那条唯一的密封读返回的是原生重放源存储；也读不到
`qualification_protected_economic_policy_bundles_v1`，它的授权已被撤销。有序门禁之所以能走到测量，
是因为门禁步骤以本 Owner 自己的角色读取 Candidate，那是夹具发现，不是 Backtest 拥有的路径。
补上这个缺口需要一条 Backtest 真正读得到的交接，携带冻结的度量与覆盖策略引用以及单位与标度 - 放进请求
集合的封存里，或者作为一条密封的 `qualification_api` 读 - 而这是跨 Owner 的契约变更，不是一条证明。

## 输出交接

- 向 [Backtest](./backtest/) 提交一个冻结的 Protected Replay Request，它只在写入一次的 请求相关联的
  `ADMITTED` 回执与 holdout 预留之后创建，固定每一个定义执行的身份以及准确的 Candidate 与 Intake 保护政策对。
  每个请求处理一个已声明的 Protected Robustness Plan 单元或那个准确的冻结有界矩阵，因此不得在观察到结果之后
  再挑选单元。该请求集合封存冻结的 `ProtectedEconomicPolicyBundleV1`，返回的 Result 必须逐项重复它的测量。
  不是本 Owner 创建的请求就不是一个保护请求；而 Backtest 的接入拒绝要把它闭合为一份绑定同一请求的
  `RUN_REJECTED` Protected Run Result，而不是让它悬着。
- 向 [Strategy Governance](./strategy-governance/) 提供包含撤销在内的分类 Eligibility State 事实，绑定
  准确 Candidate 与事实版本 经济条件版本 已评估成本容量模型版本 资格容量上限 生效时间及不可解引用证据引用。
  过期 撤销 当前事实缺失和当前状态未知都是显式下游状态，任何状态都不能让 Governance 静默保留
  活动 generation 的新增风险权限。
- 只有资格事实提交后才向 Event Rail 发布唤醒提示。保护 payload 只能包含公共终态、类型不透明且不可
  解引用的 reference 和 source-frontier freshness。保护 phase、latency、terminal timing 与 timing-derived
  field 明确禁止公开；永不发布内部 `INELIGIBLE` 或其他保护终态 disposition。
- 向 Product Edge 在 Research 准入前返回 basis 绑定的不透明 `GENESIS_EMPTY` `FRONTIER` 或
  `UNAVAILABLE` 保护反馈投影。Candidate Intake 时，先返回直接闭合准确评估请求的已提交且只写一次
  `NOT_ADMITTED` 或 `ADMITTED` Candidate Intake Receipt，再单独提供关联请求的 Qualification Status
  Summary。回执缺失保持 `SUBMITTED_OR_UNKNOWN`，摘要不能替代或编造回执。摘要在接纳后继评估前推进
  有界保护反馈观察前沿；`EVALUATING` 由 `ADMITTED` 回执与 `IN_PROGRESS_OR_UNKNOWN` 请求派生；所有
  内部负面 attempt disposition 或 `INELIGIBLE` fact 只投影为 `CLOSED_NOT_QUALIFIED`，正向 Eligibility
  Fact 投影为 `QUALIFIED`。引用必须类型不透明且不可解引用。`UNAVAILABLE` 只绑定未解析请求和阶段身份，
  后续阶段不改写先前事实。

## 拒绝和禁止事项

- 不接收可变工件 结果后的预注册 隐藏试验族 缺失或不穷尽 Census Frontier 冻结后族分叉 未解析跨 TrialFamily 前驱 结果后独立性依据 过期反馈前沿 不完整保护尝试前沿或无边界 holdout 重用。
- 不接纳缺失或身份不匹配的仅选择 Research Selection Disposition。Research 终态停止没有 Selection
  或 Candidate，也不进入 intake。该无效请求不产生 Qualification
  ADMITTED，只闭合为 `NOT_ADMITTED`，不产生保护请求或 holdout 消耗。
- 不把保护结果送回已提交候选的 R&D 循环。
- 不把保护测量 参数 结果 holdout 细节或评估输出复制进 Governance 事实或决定理由。
- 不通过 Product Edge 暴露保护测量 参数 holdout 细节或评估输出，证据引用也不能解引用为保护细节。
- 不把资格等同于激活 资金分配 Runtime 启动或交易许可。
- 不从沉默 wake event 或曾经有效的事实推断活动 generation 仍然合格。
- 不停止订单，也不宣布 Recovery Case 已闭合。

## 失败与恢复

预注册缺失或可变 TrialFamily Census Frontier 缺失 可变 不穷尽或冻结后分叉 前驱关联未解析 独立性依据过晚 或反馈 尝试 累计 holdout 前沿不完整时，在评估前生成 `NOT_ADMITTED` 且不消耗 holdout。保护决策政策身份 版本或 Protected Robustness Plan 缺失或不匹配时同样为 `NOT_ADMITTED`。Qualification 只有在关联请求且只写一次的 `ADMITTED` 回执和 holdout 预留后才创建冻结 Protected Replay Request，并重复 Candidate Intake 的准确政策 pair 与 plan identity。请求不允许原地拒绝，创建后任何 Backtest 接入拒绝都必须提交绑定同一请求的 `RUN_REJECTED` Protected Run Result。Qualification 逐项校验请求与结果的 Artifact PIT 范围 PIT Market Snapshot 身份 快照规则 重放配置 Runtime 内核 模拟器 成本 滑点 容量模型 Protected Robustness Plan 与 plan-cell 身份；任何缺失 替换或不匹配都成为 `INVALID_REPLAY_EVIDENCE`，按预注册 holdout 处理闭合且不生成 Eligibility Fact。

holdout 预留前，Candidate Intake 先用准确且由 Qualification 拥有的版本化 robustness-adequacy policy
校验计划：时间覆盖至少两个不重叠预注册窗口；市场状态至少两个实质不同状态且含一个不利状态；只有
冻结单标的 scope 才能让 instrument 不适用；perturbation 覆盖每个重要输入类；每个可调参数都有有界
邻域或被接受的无可调参数依据。计划不足或政策不匹配时为 `NOT_ADMITTED`，绝不预留 holdout。

计划还携带一个同宇宙随机对照，而本 Owner 定义它。同宇宙指的是一个确切的
`vibe-indicators-kernel` 目录摘要、一组输入角色、一组图界。这三个量仓库已经冻结，所以该对照不引入任何新概念。
Qualification 固定种子、标的宇宙、预注册窗口与抽取规模；R&D 依该定义合成比较程序，因为 Composer 与 lowerer
在它手里而不在本 Owner 手里；Backtest 回放它们并返回其序列。这个分工不是为了方便：被评估方能影响的对照集不是对照，
所以定义不能出自那一侧，而合成可以，因为一个种子加一个宇宙不留任何可选余地。充分性要求版本化策略规定的抽取规模，
以及一个以该指标自身单位与标度表示的预注册裕度。凡计划缺少该对照、其定义来自本 Owner 以外、抽自不同的目录摘要、
宇宙或窗口集合、或在观察到任何结果之后才固定其裕度，一律 `NOT_ADMITTED`，且从不预留 holdout。

该对照的强度以那一版目录为界，而这个界是写明的，不是暗含的。目录不含平方根、方差、相关与秩，
因此波动率归一化因子与横截面因子在该宇宙内不可表达：通过该对照的 Candidate 被证明的是优于自一个目录中抽取的样本，
而不是优于所有因子。目录每增加一族原语，该界就抬高一档。

这回答了 formation 路径上那些试验数修正回答不了的问题。那些修正按搜索方自报的试验次数对选出的结果做紧缩；
这一条把 Candidate 与同一目录上、同一数据上可表达的任意程序相比，而抽取所依的定义不是搜索方写的。
前者在试验数被少报时就不再是一个修正。后者不会，而这正是保护评估存在的意义。

该交接按定义、合成、回放的顺序建造，而这个顺序是一条禁令，不是一种偏好。在 Qualification 发布对照集定义之前，
不得建造它的合成侧或消费侧，因为对着尚不存在的定义建起来的消费者无法被证伪。本 Owner 已经这样做过一次：
Eligibility 终端的每一步都在任何调用者之前合入，并一直维持到有序门禁的条目被写出来为止。

对请求相等的 `TERMINAL_RESULT`，Qualification 先消费 Backtest 完整 有限 非空的保护
`diagnosticCategorySet`、内容摘要和逐类别决定性证据，并保留全部独立支持成员。随后先校验它是
canonical 类别集合的无重复子集，再应用逐类别 disposition。空集合 重复 未知类别
`NO_EXECUTION_DEFECT` 混合集合或 `UNRESOLVED_FAILURE` 混合集合都闭合为
`DIAGNOSTIC_UNRESOLVED`。只有结构合法且包含 `MARKET_DATA` `ARTIFACT` `RUNTIME_KERNEL`
`BACKTEST_OPERATIONAL` `SIMULATOR`
或 `REPLAY_CONFIGURATION` 的集合闭合为 `DIAGNOSTIC_INVALID`，单元素 `UNRESOLVED_FAILURE` 闭合为
`DIAGNOSTIC_UNRESOLVED`；二者都不生成 assessment 或 Eligibility Fact。`BACKTEST_OPERATIONAL` 保持
密封 Backtest runner/service 类别：Qualification 闭合 holdout custody，但不向 R&D Product Edge 或
Governance 返回 operational evidence 或保护细节。不含缺陷但含 `VALID_ECONOMIC_FAILURE` 的集合必须进入失败 assessment 和
`INELIGIBLE`；`UNRESOLVED_FAILURE` 与 `NO_EXECUTION_DEFECT` 各自只能作为单元素集合，且只有单元素
`NO_EXECUTION_DEFECT` 才可能进入通过 assessment。Qualification 先按自身冻结 plan 把准确密封 Backtest
per-cell result 解析成一个完整且无重复的 result census。生成的 assessment 原子嵌入自身 census-finalization
proof；该 proof 绑定冻结 stop 与 missing-cell policy、assessment-stage Time Evidence，以及证明没有请求
单元仍处于非终态的密封 Backtest attempt frontier。缺少该 proof 时不存在 assessment，attempt 保持
`IN_PROGRESS_OR_UNKNOWN`。随后完整 assessment 在冻结 adjudication 与保护决策政策版本下重复准确
plan-cell-set digest，并对每个计划必需单元准确交代一次；同一轴可以包含多个单元。只有政策接受
结果前已冻结的不适用依据时，该 cell 才是 `NOT_APPLICABLE_ACCEPTED`；依据缺失 过期 被拒或政策
不匹配时为 `NOT_APPLICABLE_REJECTED`。任一 cell 缺失 重复 未知 请求结果不匹配 政策不匹配，或
全部 cell 均不适用，都成为 `INCOMPLETE_INVALID`，提交 `ASSESSMENT_INVALID`，按预注册规则闭合 holdout
且不生成 Eligibility Fact。只有计划已被接纳为 `PLAN_ADEQUATE`、诊断集合为单元素 `NO_EXECUTION_DEFECT`、至少一个 cell 适用、
全部适用 cell 为 PASS、全部不适用 cell 获接受时才是 `COMPLETE_PASS`；任一适用 cell 失败或不适用
依据被拒时为 `COMPLETE_FAIL`。`COMPLETE_PASS` 按冻结政策生成 `QUALIFIED`，`COMPLETE_FAIL` 生成
`INELIGIBLE`，并重复准确 intake 政策 pair plan request result cell census 与判定字段。

Protected Robustness Assessment 声明 `PROTECTED_EVALUATION` 为规范 `timeEvidenceCutKind`，直接绑定每个
已接纳 result-stage Time Evidence，并密封一个 assessment-stage cut。Qualification 在 categorical
assessment、holdout closure 或 Eligibility 写入前拒绝缺失、过期、epoch 无证明或互不可比、跳过阶段或
未推进的 Time Evidence。具有直接证明的 request-to-result epoch 转换有效，但同一 assessment 的全部
result 必须共享一个 result epoch，assessment 在该 epoch 内推进。

终态 `RUN_REJECTED` 或 `INVALID_REPLAY_EVIDENCE` 生成 `REPLAY_REJECTED` 或 `REPLAY_INVALID`：
Qualification 绑定 intake 请求 结果和预注册 holdout 闭合，不生成 Eligibility Fact，也不称为
`INELIGIBLE`。只有 `IN_PROGRESS_OR_UNKNOWN` 从未改变的 `ADMITTED` 回执和保护请求派生
`EVALUATING`，同时保留并计入累计前沿中的 holdout 托管。`REVOKED` 只用于曾生效后失效的资格。
Eligibility State 模块拥有 `INELIGIBLE` `QUALIFIED` `EXPIRED` 和 `REVOKED`；仅属于 attempt 的
`ASSESSMENT_INVALID` 不是 Eligibility 状态。revocation transition 通知 Governance，但不自行撤单。

Eligibility replay 必须绑定 frontier。同一 Fact 身份与内容摘要只加入原事实，不能延长 effective interval
或 `valid-through`；同一身份下状态 区间 前驱 政策 证据或 frontier 改变都是冲突重放。续期创建绑定前驱
和新区间的新不可变 Fact；一旦后继 过期或撤销成为 Qualification head，前驱永远不能重新成为 current。
Governance 可在每个不同的已授权 lifecycle request evaluation 与 decision frontier 中消费一次仍 current
的 Fact，而同一 frontier 内重复只加入，绝不恢复资金。

## 决策契约

- **输入** - 带准确 `READY_FOR_SELECTION` 血缘的唯一 selected Candidate、穷尽 TrialFamily Census、
  预注册保护政策 holdout ancestry 冻结 Replay Request 和密封 Run Result。
- **诊断与决定** - 接纳或拒绝 intake，隔离保护评估，校验请求结果完全相等，应用冻结政策并提交
  attempt disposition 或 Eligibility State 转换。
- **冲突解析** - 保护政策和累计 holdout frontier 不可变；重复 request 只加入一次，含义变化时拒绝，
  后续政策不能重新解释早期结果。
- **输出与终态负例** - Intake Receipt Protected Attempt Disposition 或 Eligibility State；
  `NOT_ADMITTED` replay rejected/invalid `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED`
  `ASSESSMENT_INVALID` `IN_PROGRESS_OR_UNKNOWN` `INELIGIBLE` 互相独立。
- **反馈与经济意义** - 独立拒绝过拟合或无经济价值候选，只暴露公共终态、不可解引用 reference 与
  source-frontier freshness，保存稀缺保护证据价值。
- **禁止** - 不向 R&D 反馈调参细节 不改写 artifact，不拥有 lifecycle 扩大资金 Runtime
  activation 订单 账户效果或保护细节 Product view。

## 后续实现验收

- 候选和评估规则在保护证据揭示前不可变。
- 事故 recovery binary 必须 feature-gated，并封闭到准确事故和四个资源定位符；它不能从调用方接收重建
  fact 或 freshness 断言。
- 复制 anchors 但 cluster/database/role identity 不同的 store，以及规范解码后 request scope 不同的 R&D
  head，都必须在 Qualification DDL 或 row 之前失败。
- 每次 recovery 写入后的 fault 必须把 projection、head、outbox、receipt 和事务 DDL 一并回滚；隔离
  PostgreSQL 验证必须使用与任何默认 Owner 数据库不同、显式 disposable 的 database 与 role。
- 成功重建后的全局计数必须准确为 `1/1/1` 加一个 recovery receipt，复现冻结规范 verifier 的
  identity/digest/time，不增加 domain outbox event，并且对普通 current-cut resolver 仍保持 stale。
- Candidate Intake Protected Replay Request Protected Run Result Protected Robustness Assessment 和每个
  Eligibility Fact 重复同一 Protected Robustness Plan 身份与版本。
- 每个 `ADMITTED` Intake Receipt 都交叉绑定准确 `SELECTED_FOR_QUALIFICATION` disposition 与其冻结
  Intent 证伪条件。其他任何 disposition 只生成 `NOT_ADMITTED` 且不消耗 holdout。
- holdout 消耗和试验族预算可计量，不能通过候选改名重置。
- 每个稳定评估请求只解析到一个 Intake Receipt；含义改变或裸用新身份重试不能创建第二个 intake 或 holdout 尝试。
- 累计 holdout 处理包含相关 TrialFamily 中被拒 无效 未知和终态保护尝试，改名不能重置。
- 遗漏失败同族试验 试验改名 预算不一致或冻结截面后出现新族成员时必须拒绝；新成员需要后继 Candidate。
- 保护请求要么因 intake 在预留前失败而不存在，要么通过绑定同一请求的 Protected Run Result 闭合；不存在会搁置 holdout 托管的请求级拒绝。
- 保护请求与结果必须在规范 `crossBindEquality` 派生的全部 16 组执行身份上逐项完全相等；缺失或替换会确定性闭合为 `REPLAY_INVALID` 且不生成 Eligibility Fact，文档不另行维护第二份清单。
- 每个初始或续期 Eligibility Fact 都绑定准确 Candidate/Intake 政策身份与版本 request 准确 `TERMINAL_RESULT` 和已验证
  相等关系；被拒绝 无效 非终态或不匹配证据不能创建该事实。
- 同身份重放绝不延长 Eligibility 区间；续期是绑定前驱的新事实，后继 过期或撤销 head 永久阻止前驱
  复活，同一 Governance lifecycle frontier 内重复消费不能创建第二个决定。
- `QUALIFIED` 要求全部计划必需时间 市场状态 标的 扰动和参数邻域单元满足冻结覆盖 容差 阈值 聚合
  与缺失单元规则。单个漂亮 aggregate 或一个终态结果不能替代该计划。
- 每个冻结计划必需单元必须准确解析一次，同一轴可以包含多个单元。缺失 重复 未知 不匹配或全不适用
  的 assessment 都是 `INCOMPLETE_INVALID`，提交 `ASSESSMENT_INVALID`，闭合 holdout 托管且不生成
  Eligibility Fact；接受不适用必须绑定准确冻结依据与政策。
- 保护结果不存在进入同一候选构建的依赖路径。
- Governance 可读取唯一当前资格事实及完整撤销历史。
- Eligibility 过期或撤销足以终止新增风险保留；Governance 必须进入 `DE_RISK_PENDING`，不能等待只在
  增加风险时才需要的容量或表现证据。
- Governance 或 Risk 的资金包络若宽于准确当前资格容量上限，或绑定其他 Candidate 条件 模型或事实版本，必须失败关闭。

## 可观测性与持久化

Qualification 把 intake、holdout reservation/consumption、保护 request/result 关联、robustness assessment、attempt disposition、Eligibility、expiry 与 revocation 持久化为原生审计链。共享 telemetry 只能含公共终态、类型不透明且不可解引用的事实引用和 source-frontier freshness；保护 phase、latency、terminal timing 与 timing-derived field 明确禁止公开。`REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与 `INELIGIBLE` 都以字节等价方式投影为 `CLOSED_NOT_QUALIFIED`，`QUALIFIED` 保持准确。保护测量、参数、cell outcome、holdout 内容、内部终态 disposition、负面原因与 evaluator 细节绝不能进入 Event Rail、trace、log、metric、alert 或 Dashboard；Qualification 外尤其不存在内部 `INELIGIBLE` event。Dashboard 统计只区分 `QUALIFIED`、`CLOSED_NOT_QUALIFIED`、expired 与 revoked；全部负面保护终态共享字节等价的 label 和 aggregate。
