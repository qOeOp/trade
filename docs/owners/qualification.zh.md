# Qualification

## 职责

独立判断冻结候选是否满足预注册证据 holdout 成本 容量和运行条件。Qualification 拥有可部署资格证据，不拥有策略设计 激活或恢复。

## TARGET - 组合资格

成员经济资格评估完整冻结策略；对冲规则与其他交易腿可以是该策略内部组成部分，不要求各腿单独盈利。
例如现货多、永续空的 carry，按整体净收益、风险、成本与资本占用评估；完整策略须独立具有经济优势。
各成员自身资格与联合组合资格分别绑定准确评估对象和范围，不能从对方结果推导；不提供单独不合格成员的
组合限定上线资格，也不让内部对冲腿取得独立运行授权。

在成员自身资格之外，独立接纳 R&D 选定的冻结组合方案，用同一 Backtest 原生共享账户语义评估。 共同运行与冻结成员退出预案还须在未向研究侧暴露的保护数据上独立验证，不能用研究挑选组合时的回测 替代资格证据。
Qualification 拥有保护协议与评估引用，Market Data 提供已验证输入和暴露沿革，隔离 Backtest 负责运行。 成员研发、组合搜索、按需发现和导入来源的既有暴露均须核对；换请求或重新下载
不把已见数据变成独立数据，成员通过也不证明组合验证的独立性。 缺少可准入的保护证据时保留不可用状态， 不授予组合资格；不因此自动重做每个成员的完整资格流程，也不向研究侧公开保护回测与结果。

消费准确、不可变的 R&D 组合配置引用；Qualification 拥有独立评估与资格事实，不拥有配置定义。 组合资格绑定其版本/hash、成员
hash/Artifact、账户和分配/风险配置、评估协议、数据/成本/执行版本及适用范围； 候选子集与其他运行成员共同采用前，评估变更后的账户整体组合；只评估 AB 的证据不能授权 AB 与 C/D
共同运行，除非有匹配的账户整体范围覆盖。 账户试盘/正式池共用一份生效组合配置，转换评估包含下架后 受保护的残余敞口。 单策略通过不能拼成组合通过。 组合内容身份不改写成员策略版本，也不授予上线或分配资金权限。
保护评估继续使用独立凭据、输入、缓存和输出空间，研究侧只见允许的二级结论。

目标须扩展当前单 Artifact 候选绑定，不能把其现有资格解释成任意多策略组合资格。

新成员加入前评估预登记的共同运行与成员退出预案，资格覆盖须明确成员版本、允许转换、分配规则与
资金/风险边界，并有回放证据支持，包括下架后的残余持仓保护。共同运行的比较目标与退出后继续运行的
约束分别登记；安全退出不要求优于完整组合。分别完成几个终态回测不证明转换过程有效，未验证状态
不能继承资格，公式相同也不证明可复用范围。研究反馈保持二级，向 Governance 提供允许范围与证据绑定。

部署环境证据还绑定规模模板/参数、成员加入/等待规则、初始资金与账户风险及执行配置，
不能仅凭策略 hash 把某种资金条件下的通过结果用于另一种条件。单策略诊断仍可用于研究，
不替代所声明部署环境的评估；未覆盖政策/范围须另行评估。试盘偏差证据依冻结方法与判定条件处理，
不自动修改门槛、资格或真实授权，也不公开保护数值。

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

这些步骤严格串联。 V2 请求是 V1 提案加一个 `ClockHeadHandoff`，而生产的共享时钟 resolver 由 `DEPLOYMENT_STORE_ADMISSION_MODE` 构造，它保持
`disabled`。 门禁不使用那个 resolver，也不需要它： `issue_protected_evaluation_shared_time_v1` 在 sealed-acceptance 面上签发该交接， 所以 V2
请求、非空请求集、终态结果、已关闭的 frontier 与一份评估，全都在那里被构造出来。

set 封存只接纳 `schema_version=2` 成员--Origin 行的规范编码不同，读进来会让 frontier 搁浅-- 而门禁提供的正是 `schema_version=2` 成员。

因此把共享时钟证据准入到一次**部署**，仍然是部署驱动该终端的前置。它不再是驱动该终端本身的前置。

**TARGET - 需要部署授权的终端，以及它在等什么：** 这条终端是 TARGET，不是未完成的工作。 `DEPLOYMENT_STORE_ADMISSION_MODE` 保持
`disabled`，直到存在一个部署授权方能够签发 `required` 所要求的东西：custodian 签名历史、反回滚 witness、凭据租约与直接测量。
这些在本仓库都不存在， 也未授权任何真实交易或生产写入，因此 resolver 返回空是正确的关闭状态而非缺陷。

Qualification 的其余部分并不排在它后面：attempt frontier、候选与评估规则， 以及上文的 protected-replay custody 都是可分离的工作；把这条终端当成它们的阻塞，
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
  命名的关系。消费者类型存在于 Governance，而每一个
  `UntrustedEligibilityReadback` 都构造在该 crate 自己的测试里，所以读端口的形状在场，而两侧都从未写过这样一条事实。

  现在已经有一条后继链阻止前驱复活。一份 Eligibility Fact 绑定它的前驱和它自己的半开窗口，
  且 `predecessor_eligibility_identity` 是 UNIQUE，所以一份 Fact 至多被继任一次。本 Owner 为当前
  Eligibility State 发布的性质里仍有两项不可得，把是哪两项说出来正是记录它们的意义。经济条件版本
  无需新的生产：一份 Fact 交叉绑定保护决策政策身份与版本，而 `ProtectedEconomicPolicyBundleV1`
  携带同一对，所以引用其 Fact 的 State 就拥有它。已评估的成本与容量模型版本则完全没有产出者。
  `cost_model_identity` `slippage_model_identity` 与 `capacity_model_identity` 由 Candidate Intake
  以裸字符串供给，旁边既无版本也无摘要，而同一结构里别的身份确实带摘要，所以这是一处缺席而不是
  一个未被读到的字段。它的供给方是 Candidate Intake，判定它到位的判据是那三者旁边出现版本或摘要。
  一个只可能为 NULL 的列被刻意不加，因为下游读到 NULL 时无法区分没有版本的模型、没有算出一个的记录，
  以及可能无权看见它的读者。

  过期与撤销不是 Fact 行。一份 Fact 交叉绑定一个确切的 Protected Replay Request 与一个确切的
  `TERMINAL_RESULT` Protected Run Result，而一次过期两者皆无，所以它满足不了 Fact 之所以为 Fact 的条件。
  它们的关系正是上面记录为缺失的那一个。Operator Authorization 已经用
  `operator_authorization_revocation_frontiers_v1` 与 `operator_authorization_revocation_heads_v1`
  解过同一形状，那一对是应当遵循的形状而不是重新设计。本 Owner 今天刻意不建撤销前沿，
  理由是没有任何消费方，不是这个形状不好。
- **TARGET - 需要部署授权的终端：** `DEPLOYMENT_STORE_ADMISSION_MODE` 保持 `disabled`，它在等什么记录在上文
  Eligibility 终端状态 一节。
- **CURRENT，且永久不可证 - 特定事故 Owner 重建：** 机器已合入，即 `crates/qualification/src/recovery.rs`，
  经 `run_owner_recovery_cli` 导出，并以 `qualification-owner-recovery` 二进制交付（在 `owner-recovery` 特性后面），
  而它唯一的证明永远无法通过。实测记录在下文 特定事故 Owner 重建 一节。
- **TARGET - 同宇宙随机对照：** 下文 失败与恢复 一节记录的那个交接已声明，既无生产者也无消费者。
  没有任何东西发布对照集定义，没有任何东西据此合成比较程序，`crates/qualification` 也没有对照臂。
  它必须遵循的建造顺序是那条 clause 的一部分，不是对它的一条注记。
- **TARGET - 前向记录：** 尚不存在 Forward Registration、Forward Replay 请求、Forward Decision 或前向普查，Eligibility
  也没有前向淘汰这一撤销原因。契约见下文 TARGET - 前向记录 一节。

## 验证覆盖与限制

### 保护反馈解析

解析有三条路径：同 basis 的新鲜投影无写入重放；scope 为空且 basis 未投影时走 `GENESIS_EMPTY`；scope 已有规范 frontier 且 basis 未投影时走 `FRONTIER`。Genesis 在规范 genesis cut 提交序号零，且没有 source frontier。

`second_request_under_one_principal_resolves_through_the_frontier_arm` 覆盖一个 deployment、principal 与授权 scope 下两个各自准入的请求。两者均为 `Accepted`，各有自己的 basis，第二份投影为 `FRONTIER`。证据为 owner-chains run `35654451152`：190 通过，94 条目。其有序前置 `catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds` 提供 Catalog head；省略它的本机子集不证明完整路径。

scope 首份授权为 genesis，后继使用 `issue_successor`。准入绑定准确请求身份，同 suffix 不得创建不同授权含义。不能凭 `Result::is_ok` 判成功：`SubmittedOrUnknown` 必须走 `ResolveSameRequestIdentity` 并读回权威 resolution/存储；日志或传输成功不证明准入。

### Response-cut 回滚

响应 cut 离开投影半开有效窗口才触发回滚。到期边界为 `valid_through`，早于投影的 cut 需要服务器时钟倒退；创建或续期提供分支前置。改写 `valid_through_epoch_ms` 破坏规范投影相等，按 `Qualification admission envelope projection mismatch` 拒绝。

`owner_clock_epoch_ms_in_transaction` 在同一事务内两次读取限定 schema 的 `pg_catalog.clock_timestamp()`。`qualification_writer` 非超级用户，对 `public` 和 `rd_owner_api` 无 `CREATE`，不能安装影子时钟。`PROJECTION_VALIDITY_MS` 为十分钟且没有覆盖入口。测试只能改变真实流逝时间；注入时钟、篡改规范行或生产改动不是已准入替代。这是覆盖限制，不授予修改时钟契约的权限。

## Research 前保护反馈解析

Qualification 不接收调用方对 genesis 空历史或当前反馈的断言。它直接解析准确 R&D Independence Basis
Receipt，锁定受信 principal 与 Research request scope 的完整持久历史，且只有历史为空时才提交唯一
genesis frontier。已有历史返回完整当前不透明 frontier；缺失 过期 畸形 冲突 跨 principal 跨 scope 或
跨 basis 输入都返回 `UNAVAILABLE`，且不创建 frontier 转换。

普通 create、resolve 与事务内 admission 不接收任何调用方时间。 直接解析 basis、取得 principal/scope advisory lock 并完整 canonical
verification Qualification history 后，Qualification 在同一事务内采样 PostgreSQL `clock_timestamp()`；已有 read 的
freshness 使用该 Owner cut。

新 projection 在最终写入边缘只采样一次， 并只用该 cut 形成 projection time、半开 `valid_through`、receipt commit time 及其 identity
与 digest。 持久化并 canonical reread 新 history 后，Qualification 在 freshness validation 与 commit 紧前采样独立 Owner
response cut；跨越 `valid_through` 会原子 rollback projection、head 与 outbox。

投影只公开 resolution state 不透明 frontier reference 与 digest basis reference 与 digest principal scope
source sequence/cut clock epoch projection time 和半开有效期。它不包含保护 payload outcome measurement
parameter holdout detail 或可解引用 evidence。未来任何保护反馈写入都必须重复预提交 basis 关系。相同
basis 与规范 source cut 重放准确相同字节；改变 basis 或 source cut 不能加入。

### 受保护反馈 generation

每个 principal/scope 历史带一个受保护反馈 generation：该历史产生过的公开 Qualification phase fact 的计数，projection 把
它陈述为 source sequence。它就是 Qualification Status Summary 推进的观察前沿，所以一个在某个 projection 下冻结的
Research Intent，可以在之后的 Owner cut 上判断此后是否有受保护评估变得对它可观察。

- **什么推进它：** 候选的受保护反馈 frontier 属于该历史的每个公开状态 phase fact 首次提交时，各推进一步：`NOT_ADMITTED`、
  `ADMITTED`、`EVALUATING`、`CLOSED_NOT_QUALIFIED` 与 `QUALIFIED`。phase fact 是 R&D 对受保护评估所能观察到的东西，所以
  generation 计的就是它。重放的 phase fact 不推进。
- **什么不推进：** projection 的创建或续期、十分钟有效窗口、读取，以及事故重建。续期取 generation 的当前值，所以单凭时间
  永远不会改变它。
- **原子性：** 这一步写在提交 phase fact 的事务里，持有 projection 写入同样会取的 principal/scope 锁与该历史 head 行锁。
  每个受保护关闭，无论 attempt disposition 还是 assessment，都在自己的 serializable 事务里提交 phase fact，并在同一事务
  里读取 Protected Replay Attempt Frontier，所以 generation、phase fact 与它记录的受保护状态一起提交或一起回滚。
- **每一步都有证据：** 每一步是一行只追加的记录，写明它的历史、它的 generation 以及导致它的 phase fact，从一开始连续编号、
  不留空档。head 的 source sequence 是该历史最新的 generation，其 source cut 是
  `qualification-protected-feedback-cut-v1-<generation>`，genesis cut 就是 generation 零。历史校验要求 head 等于最新记录
  的那一步，每条记录都指向该历史一个已存的 phase fact，且每个 projection 的 source sequence 不大于其后继的；没有 phase
  fact 对应的 generation 无法通过校验。
- **当前性：** projection 只有在新鲜且其 source sequence 等于该历史的 generation 时才是当前的。
  `resolve_or_create_for_basis` 对 generation 已被超过的新鲜 projection 续出新的，`admit_in_transaction` 把它当作过期拒
  绝。Candidate intake 以同样方式读取候选的 feedback frontier：只有当它是该历史的 head、在 intake 的 cut 上新鲜、并且等于
  该历史的 generation 时才是当前的，所以其 frontier 已被某个 phase fact 越过的候选是 `NOT_ADMITTED`。
  `admit_historical_projection_in_transaction` 仍按 projection 自己的 cut 读取。
- **不续期的读取：** `read_protected_feedback_generation_in_transaction` 对调用方冻结的那个 projection，只回答其历史当前
  的 generation 与 source cut。它在调用方的 read committed 事务里对该历史的 head 行取 `FOR SHARE`，所以答案在该事务结束
  前一直成立；它既不检查 projection 的有效窗口，也不写任何东西，所以已过窗口的调用方读它既不会把窗口带回来，也不会引起
  Qualification 写入。其 SQL 函数只向 `rd_owner` 授予 `EXECUTE`。调用方比较自己冻结的 source cut 与读到的：不相等即表示
  冻结之后该历史有 phase fact 变得可观察。
- **候选自己的 phase fact 也计数：** 一个 Research 请求自己的候选一旦进入 Qualification，它的第一个 phase fact（
  `ADMITTED` 或 `NOT_ADMITTED`）及其后的每一个，都会推进该请求冻结的 generation。这是有意的：Qualification 一旦观察过这个
  候选，在它上面的迭代就要经过一次新的冻结。有两项后果依赖本 Owner 之外的工作，要等那些工作落地才成立。R&D 通过它的延续检查
  拒绝冻结的 source cut 已被 generation 越过的延续，该检查排在 slice 1 之后。继续迭代要经过一个在家族 basis 下冻结当前投影
  的后继 Intent，即 slice 1，qOeOp/trade#1197。slice 1 之前，后继 Intent 复制前驱的投影，因而也复制它冻结的 source cut。
- **从部署开始计数：** generation 存在之前提交的 phase fact 不计入，也不为它们重建任何一步。首次部署时每个历史的
  generation 都是零，即使此前已经发生过受保护评估，所以 generation 比较的是部署之后的两个时刻，对部署之前的历史不作任何
  陈述。部署前冻结的 Intent 冻结的是 genesis cut，部署后其历史的第一个 phase fact 就会让它的延续被拒绝：比较结果偏向停止。

## 特定事故 Owner 重建

Qualification 只能执行为 2026-08-21 本地保护反馈丢失授权并封闭的
`qualification-owner-incident-v1-01a02194-139a-7281-9d2b-a87ab29d67ba` 重建。这是单一事故的
`DETERMINISTIC_CANONICAL_RECONSTRUCTION_NO_BACKUP` 契约，不是通用 restore 或 import API。它只接受准确的
证据 session 资源定位符、事故身份、授权定位符和目标数据库资源定位符；projection row、JSON 值、时间戳、
摘要、genesis 状态和当前有效性都不能由调用方输入。

任何插入前，Qualification 严格重验绑定的 JSONL record 字节、call/output/turn 配对、冻结规范生成器身份、 完整预期语义向量、存续 R&D
basis/receipt/head/outbox、全局空 Qualification 历史、缺失的 recovery receipt 与未运行的 outbox publisher。

封闭事故契约把 PostgreSQL cluster `system_identifier`、database name/OID 与 role name/OID 绑定为类型化字段及 domain-separated
摘要；Qualification 在任何 DDL 或写入前于事务 custody 内比较该语义目标，并在第一次 DDL 紧前再次比较。

一个 serializable 事务取得 principal/scope advisory lock 和表 exclusive lock，随后依次插入原 projection、head、原 domain outbox
row 与独立的 Qualification custody/audit receipt。 该 receipt 不发 domain wake，并明确没有恢复物理备份、没有观察原 JSONB 存储字节、没有铸造新 有效期。
准确完成后的重放只返回相同 receipt 而不写入；partial、冲突、过期、畸形或非空状态全部 fail closed。

重建 projection 保留原半开区间，因此普通 resolver 在当前 cut 仍为 `UNAVAILABLE`。

Executable provenance 是独立的效果边界。Qualification 记录实际使用的 executable hash 并验证数据库语义，
但不声称仓库代码能够独立证明自身 executable bytes。Hub 拥有的外部 effect controller 在释放数据库能力并
执行该 worker 前，绑定已审查的 Origin ancestry、candidate commit/tree、executable path 与 SHA-256。

本节以下是实现状态记录，不是契约，上文契约不因它改变。 绑定的证据 session 资源已经不存在，所以本仓库既不能 再次执行这项重建，也不能重新证明它。 两项实测让这件事是永久的而不是暂时的。
该资源定位符是某个开发者主目录下的 绝对路径，而 `verify_evidence` 拒绝任何其它路径，因此这条证明从来只能在那一台机器上跑，在 Linux CI 上从不可能 通过。
同一个函数还钉死了该文件指定行的 SHA-256，因此任何替代文件都无法满足它。

而文件本身已从那台机器上消失： 没有配置 Time Machine 目标，没有本地快照保留它，主目录与任何已挂载卷下都没有携带该 session 标识的文件， 该产物也从未提交进仓库。 于是它的证明
`isolated_postgres_recovery_is_atomic_fail_closed_and_replay_safe` 在任何地方都无法通过；用同一个文件重算封存向量的 `frozen_evidence_recomputes_exact_canonical_vector` 也一样。 两者都以 unrunnable 标记为 ignore。 该模块的其它测试不读
这个文件：`make cargo-test` 以 `vibe-qualification/owner-recovery` 构建，所以 workspace 测试 job 会运行它们。

上文契约继续作为 一次已封闭的单一事故重建的记录；它不会因为无法再被执行而扩大成通用 restore 路径，本节也不授权用夹具替代 被封存的证据。

## 输入交接

- [R&D](./rd/) 只提交拥有终态 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition
  的冻结 Candidate。Candidate disposition 与 intake 交叉绑定准确冻结 Intent 证伪条件和停止规则
  探索请求结果前沿 成本 容量假设，以及包含 Candidate 截面前已消费预算的不可变穷尽 TrialFamily Census Frontier。
  它们还交叉绑定唯一准确预注册保护决策政策身份与版本及一个冻结 Protected Robustness Plan。
- Product Edge 提交一个稳定评估请求，绑定来源 Research 请求 Candidate 规范类型化含义和从来源到当前的保护反馈观察前沿。
- [Backtest](./backtest/) 返回请求的保护 Run Result 和消费输入回执，每个实际消费执行字段必须与请求字段完全相等。
  该 Result 携带保护经济测量，它重复本 Owner 随请求集合封存的那份冻结 `ProtectedEconomicPolicyBundleV1`
  的度量身份与摘要 单位与标度；不能逐项重复它们的测量就不是对被封存政策的测量，该次尝试因此关闭。
- 探索路径的 Run Result 不是本 Owner 的输入，这是设计而不是缺口。
  本 Owner 只评估它自己那些保护请求的结果，因为 Eligibility Fact 是一次 qualification 变成的东西，
  而一份本 Owner 没有请求过的结果不携带可供衡量它的冻结保护政策。
  探索 Run Result 是给研究者读的报告。
- Operator Authorization 是需要部署授权的终端的上游。它必须签发什么
  以及这条交接为何是 TARGET，在 Eligibility 终端状态一节已述一次，此处不重复。
- 已提交证据变化可以触发重评，唤醒通道不能替代读取 Owner 事实。

以下是这些交接的实现状态记录，不是契约。 只有 Product Edge 这条有生产调用者： `resolve_or_create_for_basis` 与 `admit_in_transaction` 由
vibe-strategy-factory 的生产代码调用， `admit_historical_projection_in_transaction` 由它的 R&D custody 路径调用。 R&D 的 Candidate 那条没有： 本 Owner 之外每一处
`submit_candidate_intake_v1` 调用都位于一个密封验收测试模块里。 Backtest 在经济测量中属于它的那一半现在有了交付路径，却没有任何东西驱动它。

冻结的度量与覆盖策略引用连同单位与标度随请求集合的封存一起交付： `ProtectedReplayRequestSetSealDtoV1` 携带本 Owner 封存的 `ProtectedEconomicPolicyBundleV1`， 而
`ResolvedProtectedReplayRequestSetV1::economic_computation` 从它解析出计算。 这正是此缺口先前被记录为需要的 两条交接里的第一条。 没有东西驱动它：`economic_computation` 有两个调用者，都在一个测试模块里，
而有序门禁并不经由封存走到测量。 它之所以能走到，只是因为门禁步骤以本 Owner 自己的角色读取 Candidate， 那是夹具发现，不是 Backtest 拥有的路径，且该步骤在它自己的注释里这样说明。

能让 Backtest 直接读取 `qualification_protected_economic_policy_bundles_v1` 的授权仍被撤销，而封存使它不再必要。 上游剩下的是：没有任何生产代码构造
`ProtectedEconomicPolicyBundleV1`，它的四个构造点都位于测试模块里。 与探索路径的分离在三层上都是封闭的，这是实测不是假定。 本 Owner 的源码没有任何一处提到 `backtest_replay_results_v2`
`backtest_replay_result_receipts_v1` 或 `resolve_exploratory_replay_result_v2`/`_v3`，而 `backtest_protected_replay_results_v1` 被提到四次。

两个探索解析函数的 `EXECUTE` 只授予 `rd_owner`，而对应的保护函数授予 `qualification_writer`。 并且
`backtest_replay_results_v2` 有六个读取者，其中没有本 Owner， 所以它在这里的缺席是一条边界而不是一张死表。

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
- `TARGET` - 向 [Backtest](./backtest/)：已登记的 Forward Record 每有一个新观察到的 cut，就提交一个绑定该登记确切身份的
  Forward Replay 请求。不是本 Owner 创建的请求不是前向请求。
- `TARGET` - 向 [Strategy Governance](./strategy-governance/)：当前的 Forward Decision，以及确切的 Forward Registration 与
  Eligibility Fact 版本。只有 `FORWARD_ADMITTED` 加上当前的 `QUALIFIED` Eligibility State 才允许提出模拟盘
  `INITIAL_ACTIVATION` 提案；其他、缺失或未知的决策都不允许。
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

预注册缺失或可变 TrialFamily Census Frontier 缺失 可变 不穷尽或冻结后分叉 前驱关联未解析 独立性依据过晚 或反馈 尝试 累计 holdout 前沿不完整时，在评估前生成
`NOT_ADMITTED` 且不消耗 holdout。 保护决策政策身份 版本或 Protected Robustness Plan 缺失或不匹配时同样为 `NOT_ADMITTED`。

Qualification 只有在关联请求且只写一次的 `ADMITTED` 回执和 holdout 预留后才创建冻结 Protected Replay Request，并重复 Candidate
Intake 的准确政策 pair 与 plan identity。 请求不允许原地拒绝，创建后任何 Backtest 接入拒绝都必须提交绑定同一请求的 `RUN_REJECTED` Protected
Run Result。

Qualification 逐项校验请求与结果的 Artifact PIT 范围 PIT Market Snapshot 身份 快照规则 重放配置 Runtime 内核 模拟器 成本 滑点 容量模型 Protected
Robustness Plan 与 plan-cell 身份；任何缺失 替换或不匹配都成为 `INVALID_REPLAY_EVIDENCE`，按预注册 holdout 处理闭合且不生成 Eligibility Fact。

holdout 预留前，Candidate Intake 先用准确且由 Qualification 拥有的版本化 robustness-adequacy policy
校验计划：时间覆盖至少两个不重叠预注册窗口；市场状态至少两个实质不同状态且含一个不利状态；只有
冻结单标的 scope 才能让 instrument 不适用；perturbation 覆盖每个重要输入类；每个可调参数都有有界
邻域或被接受的无可调参数依据。计划不足或政策不匹配时为 `NOT_ADMITTED`，绝不预留 holdout。

计划还携带一个同宇宙随机对照，而本 Owner 定义它。 同宇宙指的是一个确切的 `vibe-indicators-kernel` 目录摘要、一组输入角色、一组图界。 这三个量仓库已经冻结，所以该对照不引入任何新概念。
Qualification 固定种子、标的宇宙、预注册窗口与抽取规模；R&D 依该定义合成比较程序，因为 Composer 与 lowerer 在它手里而不在本 Owner 手里；Backtest 回放它们并返回其序列。
这个分工不是为了方便：被评估方能影响的对照集不是对照， 所以定义不能出自那一侧，而合成可以，因为一个种子加一个宇宙不留任何可选余地。

充分性要求版本化策略规定的抽取规模， 以及一个以该指标自身单位与标度表示的预注册裕度。 凡计划缺少该对照、其定义来自本 Owner 以外、抽自不同的目录摘要、 宇宙或窗口集合、或在观察到任何结果之后才固定其裕度，一律
`NOT_ADMITTED`，且从不预留 holdout。

该对照的强度以那一版目录为界，而这个界是写明的，不是暗含的。目录自版本 3 起含定点平方根，
自版本 4 起含 trailing window percent rank，但不含相关，也不含跨品种的秩，因此横截面因子在该宇宙内不可表达：通过该对照的 Candidate 被证明的是优于自一个目录中抽取的样本，
而不是优于所有因子。目录每增加一族原语，该界就抬高一档。

这回答了 formation 路径上那些试验数修正回答不了的问题。那些修正按搜索方自报的试验次数对选出的结果做紧缩；
这一条把 Candidate 与同一目录上、同一数据上可表达的任意程序相比，而抽取所依的定义不是搜索方写的。
前者在试验数被少报时就不再是一个修正。后者不会，而这正是保护评估存在的意义。

该交接按定义、合成、回放的顺序建造，而这个顺序是一条禁令，不是一种偏好。在 Qualification 发布对照集定义之前，
不得建造它的合成侧或消费侧，因为对着尚不存在的定义建起来的消费者无法被证伪。本 Owner 已经这样做过一次：
Eligibility 终端的每一步都在任何调用者之前合入，并一直维持到有序门禁的条目被写出来为止。

对请求相等的 `TERMINAL_RESULT`，Qualification 先消费 Backtest 完整 有限 非空的保护
`diagnosticCategorySet`、内容摘要和逐类别决定性证据，并保留全部独立支持成员。 随后先校验它是 canonical 类别集合的无重复子集，再应用逐类别 disposition。 空集合 重复 未知类别
`NO_EXECUTION_DEFECT` 混合集合或 `UNRESOLVED_FAILURE` 混合集合都闭合为 `DIAGNOSTIC_UNRESOLVED`。

只有结构合法且包含 `MARKET_DATA` `ARTIFACT` `RUNTIME_KERNEL` `BACKTEST_OPERATIONAL`
`SIMULATOR` 或 `REPLAY_CONFIGURATION` 的集合闭合为 `DIAGNOSTIC_INVALID`，单元素 `UNRESOLVED_FAILURE` 闭合为
`DIAGNOSTIC_UNRESOLVED`；二者都不生成 assessment 或 Eligibility Fact。

`BACKTEST_OPERATIONAL` 保持 密封 Backtest runner/service 类别：Qualification 闭合 holdout custody，但不向 R&D Product Edge 或
Governance 返回 operational evidence 或保护细节。

不含缺陷但含 `VALID_ECONOMIC_FAILURE` 的集合必须进入失败 assessment 和 `INELIGIBLE`；`UNRESOLVED_FAILURE` 与
`NO_EXECUTION_DEFECT` 各自只能作为单元素集合，且只有单元素 `NO_EXECUTION_DEFECT` 才可能进入通过 assessment。 Qualification 先按自身冻结 plan
把准确密封 Backtest per-cell result 解析成一个完整且无重复的 result census。

生成的 assessment 原子嵌入自身 census-finalization proof；该 proof 绑定冻结 stop 与 missing-cell policy、assessment-stage Time
Evidence，以及证明没有请求 单元仍处于非终态的密封 Backtest attempt frontier。 缺少该 proof 时不存在 assessment，attempt 保持
`IN_PROGRESS_OR_UNKNOWN`。

随后完整 assessment 在冻结 adjudication 与保护决策政策版本下重复准确 plan-cell-set digest，并对每个计划必需单元准确交代一次；同一轴可以包含多个单元。 只有政策接受
结果前已冻结的不适用依据时，该 cell 才是 `NOT_APPLICABLE_ACCEPTED`；依据缺失 过期 被拒或政策 不匹配时为 `NOT_APPLICABLE_REJECTED`。

任一 cell 缺失 重复 未知 请求结果不匹配 政策不匹配，或 全部 cell 均不适用，都成为 `INCOMPLETE_INVALID`，提交 `ASSESSMENT_INVALID`，按预注册规则闭合
holdout 且不生成 Eligibility Fact。 只有计划已被接纳为 `PLAN_ADEQUATE`、诊断集合为单元素 `NO_EXECUTION_DEFECT`、至少一个 cell 适用、 全部适用
cell 为 PASS、全部不适用 cell 获接受时才是 `COMPLETE_PASS`；任一适用 cell 失败或不适用 依据被拒时为 `COMPLETE_FAIL`。

`COMPLETE_PASS` 按冻结政策生成 `QUALIFIED`，`COMPLETE_FAIL` 生成 `INELIGIBLE`，并重复准确 intake 政策
pair plan request result cell census 与判定字段。

Protected Robustness Assessment 声明 `PROTECTED_EVALUATION` 为规范 `timeEvidenceCutKind`，直接绑定每个 已接纳 result-stage Time
Evidence，并密封一个 assessment-stage cut。 Qualification 在 categorical assessment、holdout closure 或 Eligibility
写入前拒绝缺失、过期、epoch 无证明或互不可比、跳过阶段或 未推进的 Time Evidence。

具有直接证明的 request-to-result epoch 转换有效，但同一 assessment 的全部 result 必须共享一个 result epoch，assessment 在该 epoch 内推进。

终态 `RUN_REJECTED` 或 `INVALID_REPLAY_EVIDENCE` 生成 `REPLAY_REJECTED` 或 `REPLAY_INVALID`： Qualification
绑定 intake 请求 结果和预注册 holdout 闭合，不生成 Eligibility Fact，也不称为 `INELIGIBLE`。 只有 `IN_PROGRESS_OR_UNKNOWN` 从未改变的
`ADMITTED` 回执和保护请求派生 `EVALUATING`，同时保留并计入累计前沿中的 holdout 托管。

`REVOKED` 只用于曾生效后失效的资格。 Eligibility State 模块拥有 `INELIGIBLE` `QUALIFIED`
`EXPIRED` 和 `REVOKED`；仅属于 attempt 的 `ASSESSMENT_INVALID` 不是 Eligibility 状态。 revocation
transition 通知 Governance，但不自行撤单。

Eligibility replay 必须绑定 frontier。 同一 Fact 身份与内容摘要只加入原事实，不能延长 effective interval 或 `valid-through`；同一身份下状态
区间 前驱 政策 证据或 frontier 改变都是冲突重放。 续期创建绑定前驱 和新区间的新不可变 Fact；一旦后继 过期或撤销成为 Qualification head，前驱永远不能重新成为 current。

Governance 可在每个不同的已授权 lifecycle request evaluation 与 decision frontier 中消费一次仍 current 的 Fact，而同一 frontier
内重复只加入，绝不恢复资金。

## TARGET - 在 Candidate Intake 处按累计试验打折

Research 不再在某个试验次数上停下（[R&D](./rd/#cumulative-trial-accounting-and-spend-ceilings)，用户 2026-09-27
的决定）；取而代之的是，一条血缘试得越多，它的 Candidate 在这里要过的门槛就越高。Qualification 用的是它自己推导出的试验
次数，从不是别人告诉它的。

- *折扣对象。* Candidate 的 Research Selection 所指的那个被选中的探索结果，在它的日频非年化收益序列上，用 Bailey 与
  López de Prado 的 Deflated Sharpe Ratio。它就是 `analyze_formation_robustness` 曾在 legacy formation 路径上计算的统计量
  （`crates/strategy_factory/src/robustness.rs`），那里的试验次数在一次 formation 内固定为四或二；这条路径就是上文所说的
  「formation 路径上的试验次数修正」。legacy formation 路径已在 #1207 退役，这个文件随之删除。TB2 从 `main`
  f2238c09b1e2b89b16a9965104375dbb72748f9d 上的 `crates/strategy_factory/src/robustness.rs` 移植它，而不是重写：第 92 至
  181 行的 `analyze_formation_robustness` 是打折后比率及其 PBO 门槛，第 183 至 354 行是它的辅助函数，其中第 222 行的
  `cscv_pbo` 是 CSCV 版的 PBO 估计、第 314 行是 `daily_risk_return_ratio`，测试从第 355 行开始。移植把 N 从固定的四或二改为
  累计计数，所以这些测试要按这个计数重新校验，而不是原样搬过来。
- *N。* 累计试验次数：Candidate 为其 TrialFamily 与跨 family 前驱所绑定的 census 前沿上的 `trial_count` 之和，再加上这条
  血缘里的每一次保护性尝试，因为每消耗一次留出数据就是又看了一次。Qualification 从这些前沿重新计算它，前沿不完整时照旧是
  `NOT_ADMITTED`。
- *试验比率的离散度。* 血缘中 `TERMINAL_RESULT` 试验的日频比率的样本标准差，这些是探索性证据而非保护性证据，并以一个预注册的
  最小值为下限。没有终态结果的试验计入 N 但不贡献比率；终态试验少于两个时只用下限。
- *门槛。* 保护性决策策略版本在观察任何结果之前固定最小的打折后概率与下限。低于它的 Candidate 以
  `DEFLATED_SHARPE_BELOW_POLICY` 为 `NOT_ADMITTED`，不预留任何留出数据，所以打折不花费任何保护性证据。
- *确定性。* 这个统计量是每次试验的规范结果字节的函数，其概率以百万分之一为单位向下取整记录，与 formation 报告的记录方式
  相同。读取试验收益序列的字节，就是它的生产构建写下的那些。

同宇宙随机对照与封存的留出数据保持上文所述。计数被低报时，仍然成立的是对照；留出数据从不向 R&D 返回细节。

**已有什么、缺什么**，在 `main` 019f231b0 上实测。打折统计量只存在于 legacy formation 路径上，试验次数固定且没有 census。
`crates/qualification` 没有打折、没有随机对照的比较臂，也没有跨 family 的留出计数：它按 Candidate 预留一次留出、按结果关闭，
而下文的验收要求跨相关 TrialFamily 的累计处置。这个计数属于这一片，因为 N 包含血缘中的保护性尝试。它读取的试验次数需要
R&D 尚未具备的生产 census 追加。

## TARGET - 前向记录

Forward Record 是独立的只记录模拟证据能力，不是[回测合格、真实试盘与转正](../scenarios/research.zh.md#回测合格真实试盘与转正)
路线的必经阶段；它不能代替真实试盘收益、创建试盘许可或触发正式策略池转正。Qualification 持有回测资格与保护事实，
Governance 持有晋级阶段、授权和分配，Runtime/Risk/Execution 持有实际运行及交易事实；新路线不能静默改变封存接口。

本节陈述的是一份尚无实现的契约；它不授予构建、部署或驱动前向记录的任何许可。

Forward Record 只能从一个当前的 `QUALIFIED` Eligibility Fact 开始，以一个终态 Forward Decision 结束。它只做记录：不创建
Strategy Instance、Runtime generation、trade intent、order command 或 Execution 效果，不读取任何凭据，也不持有任何资金。
Governance 消费它的决策，它自己从不运行 Governance 的控制链。

一份只写一次、在第一个前向 cut 之前提交的 Forward Registration 绑定：

- 确切的 Eligibility Fact、Candidate、Artifact 与受保护策略对；
- 取得资格时那个 Protected Replay Request 的 Runtime kernel、模拟器、成本、滑点与容量模型身份；
- 标的与交易所范围，以及决策节奏；
- 中期日与决策日；
- 淘汰线与准入线，每条都写明推导方式（例如：对取得资格时的周收益流做规定条数的块自助抽样路径并取分位数，写明块长），
  以及任何最少已平仓交易数；
- 下面的序贯检验，以及前向起始 cut。

一旦记录了第一个前向 cut，任何字段都不再改变。改过的登记是一份新登记，有它自己的记录，两者都要报告。

在记录的周收益上运行 Wald 序贯概率比检验（Wald，1945）。H0 为 Sharpe 0；H1 为登记的折扣乘以取得资格时的 Sharpe，二分之一
是登记必须写明的默认值，不能默认假设。σ 取自取得资格时的收益流并固定，每周把 (μ1 / σ²) · (xₜ − μ1 / 2) 累加到对数似然比
上。越过 ln(β / (1 − α)) 即淘汰，越过 ln((1 − β) / α) 即到达扩大边界：在 α = 5%、检验力 80% 时为 −1.56 与 +2.77。登记写明
α、β、折扣、σ 和观测单位。越过扩大边界本身并不准入候选，而是把准入复核提前到那个 cut。

Backtest 在每个新观察到的点时 cut 上（Forward Replay）按登记的确切身份回放冻结的 Artifact，使用让它取得资格的那一套订单类型 （限价、止损、有效期与到期、撤单）与决策节奏。
挂单与未平仓位在 Backtest 的托管中从一个 cut 延续到下一个 cut，成交只能来自 订单存在之后观察到的数据，持仓槽位与占用按成交顺序决定，因为为回测决定它们的是同一个模拟器。 一份信号日志不是
Forward Record：它无法持有挂单，还会给止损或目标早已成交的信号计分。

一个与回测分开决定占用的前向工具也不是：按挂单顺序而不是成交 顺序分配槽位，曾把一条规则的回测优势从 +0.22 抬到 +0.34，而前向工具无声地给出了不同结果。 Forward Replay 是由每个 Market
Data cut 驱动，还是按记录自己的节奏批量驱动，仍是开放问题；契约只固定：节奏所消费的每个 cut 都恰好重放一次、按顺序。

每份记录以一个终态 Forward Decision 结束：

- `FORWARD_KILLED`：在越过任一淘汰线或淘汰边界的那个 cut；它同时在 Eligibility Fact 上提交以前向淘汰为原因的 `REVOKED`；
- `FORWARD_ADMITTED`：在决策日，或在扩大边界触发的准入复核中，每条准入线都成立时；它只表示该候选可以被提议进行模拟盘
  激活；
- `FORWARD_WITHDRAWN`：记录因其他任何原因结束，例如 Eligibility Fact 过期或被撤销、登记被替换，或来源停止。

中期日只检查淘汰线。决策日既没有淘汰、准入线又没有全部成立时，提交带下一个登记日期的 `FORWARD_CONTINUES`，这是一个阶段
事实，不是终态决策。被淘汰与被撤回的记录都保留，从不删除。

Qualification 报告每一份 Forward Registration 及其当前阶段或终态决策；任何关于已准入候选的报告都要写出全部登记普查和
每一个结果，使激励偏差无法通过省略来只挑幸存者。前向记录及其度量与任何 Qualification 结果一样受保护：R&D 只能看到公开
阶段（`FORWARD_RECORDING`、`FORWARD_CONTINUES`、`FORWARD_KILLED`、`FORWARD_ADMITTED`、`FORWARD_WITHDRAWN`），它们每一个
的首次提交都是一个公开阶段事实，会推进该候选的受保护反馈 generation。

Forward Replay 需要产品在部署中尚未提供的东西：随数据到达的点时 cut，这需要 Market Data Owner 时钟随摄入推进；每个帧成交
所需的报价 cut；多帧回放；对挂单类规则，还需要产品路径上带到期的限价入场、止盈与目标阶梯，以及止损与目标的成交对账。

## 决策契约

- **输入** - 带准确 Agent 选择记录和冻结版本血缘的 selected Candidate、穷尽 TrialFamily Census、
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

Qualification 把 intake、holdout reservation/consumption、保护 request/result 关联、robustness assessment、attempt
disposition、Eligibility、expiry 与 revocation 持久化为原生审计链。 共享 telemetry 只能含公共终态、类型不透明且不可解引用的事实引用和 source-frontier
freshness；保护 phase、latency、terminal timing 与 timing-derived field 明确禁止公开。

`REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与
`INELIGIBLE` 都以字节等价方式投影为 `CLOSED_NOT_QUALIFIED`，`QUALIFIED` 保持准确。

保护测量、参数、cell outcome、holdout 内容、内部终态 disposition、负面原因与 evaluator 细节绝不能进入 Event Rail、trace、log、metric、alert 或
Dashboard；Qualification 外尤其不存在内部 `INELIGIBLE` event。 Dashboard 统计只区分
`QUALIFIED`、`CLOSED_NOT_QUALIFIED`、expired 与 revoked；全部负面保护终态共享字节等价的 label 和 aggregate。
