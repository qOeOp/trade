# R&D

## 职责

把 Research 与 Develop 统一在一个业务事实 Owner 内。Research 能力把可追踪假设转化为可证伪 Research Intent；Develop 能力生成不可变 Strategy Artifact 并执行有界的有人值守修复。R&D 同时拥有实验与工件身份，使用 Backtest 作为证据生产服务，但不拥有保护资格 部署或交易权威。

## 拥有的权威事实

- 不可变 Research Source Provenance Record，绑定来源身份 内容摘要 位置 检索截面 共享时间证据
  许可依据，以及形成假设时采用的有界解释身份与摘要。
- 冻结的机制 数据范围 准确成本 滑点与容量模型身份 容量假设 永久 TrialFamily 身份 预算 证伪条件和停止规则。
- 冻结的信息价值策略：声明的序数不确定性削减排序规则及其版本、确定性 tie-break key，以及每个候选据以比较的停止
  阈值。由本 Owner 固定并带版本，任何提案方 调用方或配置都不能选择它们。TrialFamily 在成型时把它们封入自己的
  decision-policy binding，而成型早于该 family 的任何 attempt；每次决策都从候选所属 family 的冻结 binding 读取。
  因此一次决策能够证明自己是在哪条规则下比较的，而看到结果也改变不了那条规则：换一条规则就是另一个 family，
  它的决策只引用它自己的。R&D 从不计算信息价值分数：它接纳被声明的排名，然后证明 census 完整、每个成员可准入
  且被可比地评分、理由齐备、胜出者唯一。策略缺失 事后补写 被改动或无版本时，不准入任何后继实验，也不准入
  `STOP_LOW_INFORMATION_VALUE`。
- 只写一次的 Independence Basis Receipt，必须在保护反馈之前提交，并绑定有效 principal Research request scope
  不受信用户理由摘要 R&D 拥有的独立性 disposition，以及不可变 basis identity 与 digest。
- 只能从锁定 R&D 历史解析为 `GENESIS_EMPTY` `COMPLETE_FRONTIER` 或 `UNAVAILABLE` 的自适应研究血缘，
  以及绑定 principal/scope 的 Qualification 不透明保护反馈 frontier 投影。
- 绑定意图 TrialFamily 准确代码字节 依赖来源与 lock 身份 工具链与运行环境身份 Market Semantics
  Compatibility 身份 sandbox policy capability manifest 和 Artifact Security Admission 结果的 Strategy Artifact
  与 Build Receipt。
- **TARGET：** 共享生命周期内核契约下内容寻址的 `StrategyDesignV2`、确定性 `StrategyPlanV2`、准确
  Owner input-binding receipt set、compiler disposition 与 lowering digest。
- **TARGET：** R&D 冻结的规范 `BoundedFeatureProgramV1` identity/digest 及其准确 Design/plugin binding，
  以及 tagged V3 first-party lowering/build capsule 与持久 receipt；这些不是 CURRENT executable fact。
- 冻结 Exploratory Replay Request，绑定准确意图 TrialFamily 工件 请求 PIT 数据范围 重放配置和成本容量模型。
- **TARGET / NOT_ADMITTED：** 密封 版本化且内容寻址的 Replay Policy V2 Catalog version、显式
  current-head fact、revocation fact 及其私有 administration audit。Catalog 只属于 R&D，是
  TrialFamily formation 前唯一 policy 来源；caller 选择的 policy 不是权威事实。
- **TARGET / `ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1`：** 版本化 密封的 Exploratory Replay Request locator 与
  receipt，只能由 R&D 根据该 canonical 请求签发，并绑定其准确 canonical bytes 与 digest Owner 请求者角色和
  请求身份。只有 R&D 提供该 locator 的固定只读 resolver 与持久 逐字节一致的 readback。locator caller 提供的
  digest 或其他 Owner 的 binding 都不能构造 反序列化 签名 替换或证明该 receipt。Market Data 只有先通过固定
  `lock_sealed_exploratory_replay_request_for_market_data_v1` Owner port resolve 并验证这个 R&D-native receipt
  与 canonical 请求，才能独立签发任何 event-binding receipt。
  **TARGET / NOT_ADMITTED：** 该固定路径的三个可执行 routine 由隔离的 `NOLOGIN`
  `rd_exploratory_replay_api_owner` 拥有；它只对 canonical verifier chain 实际遍历的准确 relation 集合拥有
  `SELECT`，且没有任何 table-level 或 column-level mutation privilege。`market_data_owner` 只获得 schema
  usage 与准确四字段 `SECURITY DEFINER` facade 的执行权，且必须
  在其既有 SERIALIZABLE transaction 内调用。runtime role 不属于 routine owner，不能替换 facade 或任一 verifier。
- 探索请求与结果必须在 Strategy Artifact 请求 PIT 范围 PIT Market Snapshot Universe Selection Record
  与修订规则 重放配置 Runtime 内核 模拟器 成本 滑点和容量模型身份上完全相等。只有请求相等的
  `TERMINAL_RESULT` 可以进入 Research Selection。
- 只追加 TrialFamily Census Frontier，记录冻结截面前每个探索 Intent Request Result 身份，包括失败 被拒 无效 未知试验以及已消费族预算。
- 可以支持新 Research Intent 的探索发现，但不能改写已冻结前序事实。
- 写一次的 Iteration Result Admission，把一个已加锁的 canonical Backtest Result 绑定到可以消费它的迭代。
  Owner 在单个可串行化 R&D 事务内，从加锁的 Result 字节、确切 TrialFamily 普查截面与已封存试验预算推导全部被接纳事实；
  调用方只提供定位符、result 与 request meaning 摘要、按规范排序的候选提案集合，以及授权该 mutation 的
  Product Edge admission locator。Owner 在持有 Result 锁的同一笔可串行化事务内解析该 admission，核验它命名的
  正是这一条 request、operation、schema、target Owner、payload 与单一 effect，并要求它在事务开启时与提交截面上
  都授权该 mutation。重放按历史解析，因为已提交的事实是按 request 含义内容寻址的，而不是按谁授权的。
  提案集合为空 超限 乱序 重复
  与声明基数不一致或超出剩余封存预算时，接纳关闭且不创建任何托管。同一请求的精确重放汇入已提交的接纳；
  同一 Result 上改变的含义返回 `Conflict`。接纳发出一条 `RD_ITERATION_RESULT_ADMITTED_V1` outbox 事件，
  不创建 Decision Selection Candidate 或 Qualification 转换。
- Research Iteration Decision：唯一记录完整支持诊断集合、按确定规则选出的单一类型修复类别与目标边界的 `REPAIR_INPUTS` 后继实验
  `READY_FOR_SELECTION` 或命名终态停止的 Research 事实。停止 修复和后继结果都不会创建 Selection。
  未知或非终态运行不存在 Iteration Decision。
- 在保护证据出现前提交的冻结 Protected Robustness Plan 身份与版本。它声明必需时间窗口 市场状态
  标的切片 扰动和合理参数邻域单元，以及指标 覆盖 容差 阈值 聚合 缺失单元和停止政策，并绑定准确
  TrialFamily Artifact 成本 滑点 容量模型 purge 与 embargo。Research 定义计划但永不读取保护测量或结果细节。
- Research Selection Disposition：只在已选择时提交 `SELECTED_FOR_QUALIFICATION`，绑定准确
  `READY_FOR_SELECTION` 决定 Research Intent 证伪条件与停止规则 探索请求结果前沿 成本 容量假设
  TrialFamily Census Frontier 预注册保护决策政策身份与版本和 R&D 拥有的选择理由类别。
- 只写一次的 Research Request Receipt：`ACCEPTED` 绑定唯一结果 Research Intent 身份，`REJECTED_NO_WRITE` 不绑定任何 Research 转换。
- 只写一次且关联请求的 D-only Repair Disposition，绑定已接纳 repair admission、准确前驱 generation 与
  Artifact、允许修复面、impact class、构建与验证证据以及共享 Time Evidence。穷尽状态只有
  `D0_COMPLETED_NO_ARTIFACT` `D1_VALIDATED` `D1_VALIDATION_FAILED` `D1_BUILD_FAILED` `REJECTED_NOT_D_ONLY`
  和 `OUTCOME_UNKNOWN`。

## 实现状态台账

本台账只记录仓库在本截面实际到达的状态。它沿用 [Market Data](./market-data/) 台账的状态词汇，并以
`CURRENT_PARTIAL` 表示已合并但不可触达的形态；台账本身不授予任何许可：本文档没有任何切片是
`IMPLEMENTATION_ADMITTED`，扩大准入集必须先修改本文档。每一行都点名那个可以证伪它的符号或路径。

- **CURRENT - 已部署的服务，以及它暴露面的边界：** `product/rd-workbench/Dockerfile.owner` 构建
  `--bin strategy-factory-rd-owner-api` 时完全不带 `--features`，该文件唯一的 `--features` 属于 dashboard
  那个二进制。所以部署镜像就是 `crates/strategy_factory_rd_owner_api/src/main.rs` 里未加门的那个 router，
  而其后由 `#[cfg(feature = "sealed-develop-composer-acceptance")]` 与
  `#[cfg(feature = "sealed-source-intake-composer-acceptance")]` 注册的六条路由不在其中：
  `/v2/exploratory-replay/execution-input-bindings`、`/v3/exploratory-replay-requests/composer-backed`，
  以及四条 `/_sealed-acceptance/v1/develop-composer/*`。一条验收路由绝不是生产能力的证据，
  而密封 feature 的存在就是为了让这个区别是机械的而不是靠记住的。
- **CURRENT - 有一条只读操作只能经由写 API 触达：** Dashboard 的操作登记表声明了十一条 Owner 路由，
  其中十条是 `GET`。第十一条 `research_goal.legacy_quarantine_read.v1` 声明 `effect_set: []`，
  解析到 `POST /v1/research-goals/{request_identity}/resolve`，它注册在
  `crates/strategy_factory_rd_owner_api/src/main.rs` 里，而读 API 那个二进制里没有它。
  空效果集是准确的：该处理函数忽略自己的请求体，它的三条路径
  `resolve_legacy_quarantined_v1`、`resolve_admission` 与 `resolve_historical_v1` 全部只读，
  取的是 `FOR SHARE` 而不是 `FOR UPDATE`，也不发出任何 `INSERT`、`UPDATE` 或 `DELETE`。
  错的是这条操作住在哪里：一个只认领只读操作的消费方仍然需要写 API 凭据，
  因为它的其中一条读是一个本 Owner 别处都不暴露的 `POST`。在那条路由被读 API 提供之前，
  一个持有写 API 凭据的只读消费方是这条约束本身而不是权限泄漏，
  而把它收窄到读 API 那一对会打断这条操作而不是收紧它。具体地，
  `product/rd-workbench/docker-compose.yml` 里 shadow worker 服务需要它那对写 API 凭据正是因为这个：
  在整理那个文件时顺手删掉它，worker 会停在 `WORKER_CONFIGURATION_UNAVAILABLE`，
  而那个文件里没有任何东西说明那对凭据为什么在。将来若再有一条在 `POST` 上声明
  `effect_set: []` 的操作，这个问题要重新问一次，因为效果集描述的是操作，而凭据准入的是整条路由。
- **CURRENT - 其它 Owner 被授权读取的跨 Owner 读面：** `rd_owner_api` 是本仓库唯一一个把执行权授予
  多于一个消费方 Owner 角色的 schema：`product_edge_owner`、`qualification_writer`、`backtest_owner`、
  `market_data_owner` 与 `market_data_reader`，`rd_owner` 是该 schema 自己的角色。这些 schema、
  它们的函数与每一条授权，都由 `product/rd-workbench/postgres-init/10-migrate-authority-custody.sh`
  所运行的 Owner 迁移确立；该脚本连同它调用的那些迁移，才是任一截面上"存在什么"的权威。
  本行刻意不写函数个数。个数在任何一个 Owner 添一个函数的那天就过期，而且它即使正确也高估这个面：
  一个住在 `_api` schema 里的函数，只有在某个角色持有它的 `EXECUTE` 时才可触达，而本 schema 两类都有：
  授予了某个消费方 Owner 的入口，以及对其它每个角色都已撤权的内部谓词。可判定的是授权。
  本截面上有两条这样的事实，它们更正了本行早先"`portfolio_api` 与 `governance_api` 一个都没有"的说法：
  两者都有函数，而 `governance_api` 恰好有一个，已对 `PUBLIC` 撤权，全仓没有任何针对它的 `GRANT EXECUTE`，
  也没有任何 `GRANT USAGE ON SCHEMA governance_api`：已建成，且没有任何角色够得到。
  这些被授权的函数是 `SECURITY DEFINER` 且函数体内不点名任何调用者，所以访问由授权决定，
  没有授权的调用者收到的是权限错误而不是空结果。本行记录的是这个面与它的授权，
  它不确立任何消费方在生产中读过它。
- **CURRENT_PARTIAL - 生产 Composer 读端口：**
  `crates/strategy_factory/src/source_research_composer_postgres_v2.rs` 为
  `PostgresSourceResearchComposerProductionV2` 实现了 `DevelopComposerSealedReadPortV2`，其上没有任何
  `cfg` 属性，所以部署构建携带它，解析一次已提交的 Composer 操作不需要任何 acceptance feature。
  它证明该读取能解析同一事务提交的东西；它不证明有序链路之外存在任何消费方。
- **TARGET - PIT 输入缝已接线但惰性：** `rd.md` 陈述 Market Data 为每个 PIT Market Snapshot Request
  返回一份封缄的 `ResearchPitTerminal`。`crates/strategy_factory_rd_owner_api/src/main.rs` 导入了
  `ResearchPitTerminalResolver`，声明了 `_market_data_research_pit` 并在构造时赋值，
  然后从不读它，下划线是唯一的现场标记，而 `crates/data` 之外没有任何一处调用该解析器的 trait 方法。
  该解析器还是可选的：`bootstrap_deployment_store_admission` 返回 `Option`，
  所以部署中该字段可能持有 `None`。补上这条需要本 Owner 出一个消费方，不是要 Market Data 开更多读。
- **TARGET / ISOLATED_ACCEPTANCE_ONLY - 探索重放的生产入口：** `run_exploratory_replay_v2` 在
  `vibe-backtest-owner` 之外唯一的调用者位于 `run_native_replay` 内，而后者带
  `#[cfg(feature = "sealed-develop-composer-acceptance")]`，且全仓没有任何 `cfg(not(...))` 孪生体。
  在部署镜像不带 feature 的前提下，该路径在已部署产物里不可达。这测的是部署产物，不是历史。

## 模块

- **Source Intake** - 把论文 观察 笔记 媒体和工具输出作为带来源与内容身份的不可信数据接纳。来源
  内容永远不是指令 能力授权或调用其他 Owner 的权威。provider-neutral 实现基线见
  [研究来源接入指南](../guide/source-intake/)。
- **Research Intent** - 在观察结果前冻结可证伪机制和实验契约。
- **Strategy Artifact** - 保存不可变内容 依赖来源 市场语义 runtime capability sandbox policy 和
  Artifact Security Admission，供重放 资格与治理应用原样消费。
- **Development Sandbox** - 只通过显式输入输出 mount 构建并诊断策略代码，没有环境 filesystem network
  subprocess 或 process-tree escape inherited capability secret 账户 部署或 effect-port 权威。

## 策略设计与 Develop 编译

[StrategyDesignV2 契约](../architecture/strategy-factory#strategy-design-v2-shared-lifecycle-kernel)治理任意已
接纳 Research 如何变为可执行策略。只有 R&D 能冻结类型化且内容寻址的 `StrategyDesignV2`，包括稳定
primitive semantic ID、已声明 input role、lifecycle/state/target/protection 含义、可选有界 plugin manifest
和 Research Intent binding。Develop 确定性执行 canonicalization、capability closure、消费准确 Owner
binding receipt，并 lowering 到 `StrategyPlanV2` 及唯一 Wasm Strategy Artifact/`ProgramHost` 路径。它不得
生成无限制策略代码、发明 core opcode、通过启发式字符串推断来源，或创建另一个 interpreter/runtime。

**TARGET / NOT_ADMITTED - ARC Complex D Bounded Feature Program V1：** R&D 将一份规范
`BoundedFeatureProgramV1` 与其 Research Intent、`StrategyDesignV2`、bounded-plugin semantic ID 和 manifest
digest 一同冻结。该 program 声明类型化 Owner role、unit/scale、trigger/sample clock、版本化
`vibe-indicators-kernel` primitive-catalog digest、fixed-I128 DAG、有界 state/resource、lifecycle output 及规范
bytes/digest。R&D 拥有这些冻结的 Research/Design/program 含义；它不能 mint Market Data sample
coordinate、build provenance、Host proposal identity、lifecycle transition、Backtest result、raw order 或
trading effect。

**CURRENT_PARTIAL - R&D 联合冻结写入路径：** R&D Owner 现在具备持久 PostgreSQL 组合根与三条带鉴权的路由
`POST /v1/bounded-feature-programs/{declare,freeze,lower}`。`declare` 是提案者的路由：它接收 Design 与
program 的含义，从该 Design、钉定的 catalog 与 Owner 自己的 binding custody 推导出提案者无从知晓的一切，
并在取得这些 binding 行锁的同一个事务内冻结结果。`freeze` 则接收已经组装好的一对。两者都对照当前已接纳的
Research custody 与钉定的 primitive catalog 接纳这一对，恰好写入一行联合冻结及其 outbox event，并对同一
Research identity 的不同含义以 conflict 回应。`lower` 把这份冻结对读回并降级，因此被冻结的 program 现在
经由生产路径产出规范的第一方 ABI3 源码，而不再只存在于 sealed 验收内部。

**CURRENT_PARTIAL - 降级出的源码不是可执行物：** 该降级不带 build receipt、不带 Wasm、不带 Artifact，
也不带任何 qualification 含义。它只证明冻结 program、钉定的 `vibe-indicators-kernel` catalog
与第一方 SDK 恰好产出那些字节，以及被篡改的存储字节会关闭该路径。V3 build 与持久 Composer RUN
现在有了下文描述的生产入口；Artifact 下游的一切仍为 TARGET。

TARGET V1 catalog 是原子整体，不是 primitive name 菜单：fixed I128 scale 最大为 38，rescale 必须显式，
rounding mode 只有 `TowardZero` 与 `NearestTiesToEven`，每项 operation 使用一个准确 I256 expression 并只做
一次最终舍入。catalog 冻结 lag/rolling readiness、EMA/Wilder seed、Wilder ATR、period-delta RSI、OHLC
geometry、trailing-window swing coordinate 与 closed-unit rational `range_fraction` 语义。缺失任何 required
formula、semantic ID、golden vector 或 no-state-change oracle 都使该 catalog 版本 unavailable。

封闭的 TARGET catalog namespace 与规范 golden-vector codec 按 semantic version 分版本发布，每个版本以原子整体
发布。冻结程序声明自己的 catalog semantic version 与该版本的 semantic digest，后者绑定含义而非 kernel 代码；
发布较晚的版本既不改变也不作废较早的版本，而读回较早的冻结要求运行中的 kernel 逐字节复现该版本的 required
golden vector。参见
[Catalog 版本化与冻结程序读回](../architecture/strategy-factory#catalog-versioning-and-frozen-program-readback)。对于每个 sample-clock
role，R&D 在 Design/Plan 中绑定准确的版本化 Owner-coordinate source 与普通有界 Bytes port，但只有 Market
Data 能封存 308-byte coordinate 及其 receipt cross-binding。唯一通用 `ProgramHostV2` 校验并传输这些 bytes；
它不 mint coordinate，也不获得 feature opcode。BFP plugin 使用单独 tagged ABI 3 failure status 表达
`NUMERIC_FAILURE_NO_STATE_CHANGE`，同时所有既有 ABI 2 manifest、receipt、frame 与通用 failure 含义保持
逐字节不变。这些都是 TARGET seam，不声称 CURRENT Market Data、Host、plugin、Composer 或 Backtest 已支持，
也不要求第二 runtime 或 raw-order authority。

只有 R&D 的 Develop 能力能验证规范 DAG 与 capability/resource/state bound，并使用内容寻址的 first-party
SDK/kernel source 做确定性 lowering。它引用版本化 primitive semantic ID 与 source digest，而不复制公式。
结果是准确一个现有 bounded plugin，其 output 仅限 typed post-state、`PositionIntentV1`、target 与
protection field；`ProgramHostV2` 封存 proposal，只有共享生命周期内核能应用它。caller/LLM-authored
Rust/Wasm/dependency、floating point、Host feature opcode、第二 interpreter/runtime、raw-order plumbing 与
executable fallback 都不被接纳。

未来 V3 build capsule/receipt 必须绑定规范 program、manifest、SDK/kernel、lowerer/compiler、toolchain/
profile、完整 source set、两次字节一致 build、Wasm、ABI 和 resource/import/export bounds。
`PluginImplementationReceiptV2` 可以继续绑定其不透明 verified-receipt digest，但 Composer durable readback
必须区分 tagged V2 与 V3，并逐字节保留所有既有 V2 row/digest。架构契约与可证伪首个 corpus 见
[Strategy Factory](../architecture/strategy-factory#target---arc-complex-d-bounded-feature-program-v1)。在对应
code、Owner custody 与真实 `ProgramHostV2`/Backtest check 存在前，这不是 executable D-loop、Native Replay、
第一方验收、稳定盈利声明或 Paper/Live/production/trading authority。

CURRENT ComplexStrategy V1 pre-Artifact Develop Evaluation 只有在 current accepted Research custody、完整
TrialFamily frontier、规范有界 IR、准确 predecessor 与 Owner-sealed PIT readback 全部绑定且在提交时重新
校验后，才是一项 R&D 内部事实。它不是 Artifact，也不是 Backtest Replay、Qualification、Candidate、
Eligibility、Governance 或 Runtime 证据；其正向结果不能进入 Research Selection。V1 canonicalization、
bounds、frozen-Intent 校验和 Owner binding 只是 V2 迁移输入；只有经 Wasm 路径证明 corpus 等价后才能
删除重复 V1 interpreter 与 toy renderer。

只有每个 input role 都有类型化 fact-Owner binding、capability closure 完整且 lifecycle/checkpoint/plugin
上限受支持时，Develop 才返回内容寻址 Plan 与 Artifact。否则它返回指出准确失败坐标的结构化
`UNSUPPORTED` 或 `NEEDS_RESEARCH_REFINEMENT`，且不创建 Plan、Artifact、Replay Request、Candidate 或
下游 effect。`NEEDS_RESEARCH_REFINEMENT` 只能为后继 Research decision 提供信息；Develop 不能静默补全
Research 含义。一个 Research intent 至多封存一个正向 Artifact：同一 intent 之后的 build request 不被接纳，
后续开发经由 successor Research intent 进行，绝不重新封存 Product Edge 窥视的证据。

**CURRENT/PARTIAL - crate-local Develop Composer V2：** R&D 可以重读一份当前已接纳 V2 Research custody
投影，重新推导 Design 中由 Research 控制的 request/Intent 身份与 falsifier，解析准确密封 input-binding
和已验证有界 plugin build 证据，并调用现有 V2 compiler 与 `StrategyArtifactV2` issuer。一个内存 Owner
join 对准确重放返回字节一致的 Design/Plan/Artifact receipt，并拒绝同一 Intent 的不同 proposal。任何
custody、覆盖、build、compiler 或 Artifact 失败只返回一个不携带部分 Plan/Artifact 的结构化终态。产生的
Artifact 已由 `ProgramHostV2` 动态接纳；这只证明 crate-local 合约与隔离 consumer 路径。持久 PostgreSQL
custody、跨进程重启恢复、provider/API/Dashboard composition 和已部署 Owner readiness 仍不可用，不能从内存
join 推断。

**Composer 在生产中只从冻结的 Bounded Feature Program 运行。**
默认 feature 下 `POST /v2/develop-composer/runs` 接收规范的 Research request locator，重读
`POST /v1/bounded-feature-programs/{declare,freeze}` 针对该 Research 托管封存的程序，在 Owner 自己的事务里
锁定 Research 并解析其 Market Data 绑定，把程序降级并构建两次得到逐字节相同的 Wasm，然后在同一事务中提交
每一条正向 Composer 事实。没有冻结程序的 Research request 在其精确坐标处被拒绝；不会从语料编译任何东西。
覆写固定语料 Design 四个身份字段的 `derive_source_research_composer_request_v2` 只存活于 sealed acceptance
之内。有序链路在托管 Linux runner 上端到端证明了这条生产路径
（`frozen_program_runs_the_production_composer_to_a_durable_artifact`）。该路由做不到的是发明 Design：
下面的契约写明这份 Design 由谁撰写。它下游的一切都已存在：生产提交函数、store、写入器、两张 build-receipt
关系，以及生产 binding 接缝。

**CURRENT/PARTIAL：第一圈已有立足之处。** 封存语料 run 之后，`run_bounded_feature_program` 成为唯一的生产入口，
而它需要一份已冻结的 joint program。冻结需要 Strategy Input declaration；Market Data 过去只从一份
Composer attestation 注册它们，而铸造该 attestation 的正是一次 Composer 提交。此后每一圈都自洽：
一次提交的响应恰好带着注册所需的 locator；唯独第一圈没有来源，且任何与 artifact 绑定的形状都给不出这个来源，
因为 program 的身份恰恰折叠了该注册所签发的那些绑定回执。于是本 Owner 发布一份 Design 级 role intent：
它只指名一个 Design、该 Design 被接纳时所依据的 Research request 与 custody，以及它所声明的角色，别无其他。
`POST /v1/strategy-designs/publish-role-intent` 依据当前已接纳的 custody 派生它，并按 Design 一次性写入；
`rd_owner_api.resolve_design_role_intent_for_market_data_v1` 只对 Market Data 的读取主体暴露它。
有序 PostgreSQL 链路见证了一个在 `composer_private` 中无人指名的 Design，
从没有任何 PIT 坐标，走到 Market Data 自行解析出的那一个，并与它必须一致的那次 attestation 准入并排。

**TARGET：** 那份 Design 由谁撰写。发布陈述的是本 Owner 对收到的 Design 所知道的事实，
它并不导出一份 Design，而这正是下面契约仍在交付的那个未决问题。

这条入口的绑定那一半是 `dynamic`。隔离 R&D Owner PostgreSQL 链路会针对 Market Data Owner
经自身验收 basis 签发的绑定，声明并冻结一个六角色 BAR program，再用 RUN 所用的同一个生产
绑定 Owner 解析该冻结对，并要求每个已声明角色恰好对应一份回执。

**CURRENT/PARTIAL：** RUN 验收本身 - 对降级源码的两次字节一致构建、带标签的 V3 回执，
以及在单个事务内提交全部正向 Composer 事实 - 已由有序链路在托管 Linux runner 上的端到端条目承载。
**TARGET：** 已部署 Owner 就绪度与跨进程重启恢复，尚无任何链路条目观测到它们。

### CURRENT_PARTIAL - Strategy Design 由谁撰写

R&D 不从研究散文导出 Design。本仓库没有任何规则把 hypothesis、mechanism 与 falsification
question 变成输入角色与 reaction graph，也不打算有：那项转换是一次判断，而 Owner 作出的判断
就是 Owner 发明的事实。

**本仓库里有两样东西都叫 Research Intent，而这条禁止仍然成立，因为 Composer 路径握着的是
没有东西可投影的那一样。**

`crates/strategy_factory/src/research.rs` 里的 `ResearchIntent` 确实带 `data.channels`，
每条 channel 声明了自己的 `role`、`asset_id`、`timeframe`、是否必需、来源与陈旧度上界，
`data.decision_clock_channel` 点名其中哪一条推进决策。投影这些不会选择任何东西。但这个类型
只有一个构造器 `frozen_representative()`，它解析一个编译期常量，然后拒绝任何 SHA-256、identity、
revision 与 schema 版本不等于冻结值的东西；它的调用方只有 formation 路径
（`family_adapters.rs`、`representative.rs`、`formation_adapters.rs`）。Composer 路径从不握着它。

Composer 路径握着的是 `CurrentResearchDevelopCustodyV2`，它的十四个字段是定位符、身份与摘要，
外加一个 `falsifier` 字符串；它背后存着的 `intent_json` 反序列化成 `FrozenResearchGoalIntentV2`，
而那份 intent 的 `goal` 是一个 `SourcedResearchGoalV2`：`hypothesis`、`mechanism`、
`falsification_question`、`expected_observation`、`cost_assumption`、`capacity_assumption`、
`sources`，以及 `required_data: Vec<String>`，它的取值是 `PIT bars`、`sealed market bars`
这类散文。**它不声明任何 channel、任何标的、任何周期、任何角色。**

所以生产路径上没有东西可投影，而把 `required_data` 的散文变成输入角色，正是上一段禁止的那种推断。
只有当 Owner 在 Composer 截面上握有 channel 声明时，投影才成为可能：要么存着的 intent 带上它们，
要么有什么东西能从 intent 身份解析出它们，而这两样今天都不存在。在那之前，输入角色和 reaction graph
一样，是提案者的声明、由本 Owner 准入。

reaction graph 才是仍然属于判断的那一部分，而它仍然归提案者。为它准入第一个有界族，
不准入更宽的任何东西：**单一已声明 channel 与单一阈值的比较**，决策时钟取自
`data.decision_clock_channel`。这个族之外的每一种图，两个信号、一个合取、一个依赖状态的
阈值、一个本 Owner 不得不去选的阈值，都仍然是提案者的声明，本 Owner 准入而不导出。
这个族的存在是为了让第一条生产路径能在 Owner 不发明任何机制的前提下闭合；它不是在主张
单阈值是一个好策略，扩大它必须先修改本文档。

改由**提案者**声明。提案者可以是语言模型、人，或任何其他 caller；本契约不指名它，
也不随它改变。契约钉死的是**输出**：恰好一份规范 `StrategyDesignV2`，在 bounded-plugin
路径上再加该 program 的含义：它的类型化节点图、常量、状态单元、决策表终端、warmup 契约、
图自身的界，以及每个被声明输入角色上「图读取哪个取值端口」与「哪个时钟推进它」。
输入是不设边界的研究散文，输出是一个拒绝未知字段与未知 semantic ID 的封闭类型 schema。
那项转换就是提案者的全部职责。

提案者只声明含义，绝不声明身份。它不声明 schema 与 semantic 版本、不声明 Research/Intent/Design
的身份与摘要、不声明 plugin manifest 摘要、不声明钉定 catalog 身份、不声明第一方 SDK 摘要、
不声明 plugin manifest 已固定的那四个界，也不声明任何静态绑定回执。Owner 从收到的 Design、
钉定的 catalog 与自己的绑定托管中逐一推导，因此提案者无法陈述它无从知道的事实，
也无法与它所命名的 Design 发生分歧。这些推导与随后的冻结发生在同一笔事务内：
绑定托管读取在某个切面上取行锁，用另一个切面去冻结，就会封印一个
「其回执在封印那一刻从未被证明」的 program。

Owner 只**接纳**，不导出。它把被声明的这一对绑定到当前已接纳的 Research custody，
并拒绝 Research 与 Intent 身份或摘要不匹配的 Design。它重新规范化被声明的字节而不信任
被声明的摘要，对照钉定的 `vibe-indicators-kernel` catalog 与 manifest 边界校验该 program，
再以一个域分隔摘要冻结这一对。对同一 Research 身份的第二次、不同的声明是改变含义的冲突，
绝不是更新。

提案者只撰写 Research 含义，别无其他。它不得撰写 Rust、Wasm、依赖、ABI、公式实现、
构建命令、时钟、Owner receipt、Market Data sample coordinate、Backtest result、raw order
或可执行回退。那些来自确定性的第一方降级器、钉定的 catalog 以及持有它们的 Owner；
伸手去碰其中任何一项的声明会被拒绝，而不是被净化。
**TARGET - 规范 Research-to-Composer custody：** public operation 只接收规范 Research request locator。在一笔
R&D transaction 上，Owner-internal exact commit-cut capability 取得 request/aggregate row lock，规范重读
current Research custody，并在任何写入前派生 request、Design、全部 Research/Intent/Design digest、binding、
source capsule、provider、Operator Authorization frontier 与 final cut。已认证 GET request projection 只是
只读 recovery metadata；POST 独立派生，不能接收 projection 回灌。同一 transaction 要么持久化全部正向
Composer fact，要么零写入。sealed A0 Build Receipt 是一项 intrinsic content-addressed fact，而每个 Artifact
拥有独立且规范排序的 use relation。因此两份不同 Research custody 可以产生两个 Artifact 与两条 use row，
共享一份 build fact 而不合并其 lineage。intrinsic relation 是
`rd_develop_build_receipts_v2(receipt_identity, build_attempt_identity, capsule_identity, canonical_bytes)`；
`rd_develop_artifact_build_receipt_uses_v2(artifact_identity, ordinal, receipt_identity)` 拥有 ordered reference。
只有准确 legacy embedded-receipt schema 允许一次 byte-preserving normalization；partial、mismatched、
ambiguous 或其他 shape 均 fail closed。在隔离第一方验收链、
locator/full-DTO negative、dual-custody sharing、concurrency/conflict、fault atomicity、response loss、restart
readback 与准确 cleanup baseline 全部通过前，该能力保持 `TARGET`。

**CURRENT/PARTIAL - authenticated Strategy Design role-set readback：** 固定 R&D Owner adapter 可用一个
准确的已接纳 Composer request locator 解析既有持久 Design/Plan/Composer custody，并返回 additive
`StrategyDesignRoleSetReceiptV1`。它重复 schema/reserved、准确 request 与 operation receipt、Research request
与 Intent、Design identity/digest、canonical-Design 与 Plan digest、Artifact identity，按派生 role identity
严格排序并携带完整 semantic coordinate 的全部 role，以及按派生 join identity 严格排序、同时保留声明 role
顺序、alignment、trigger 与最大 staleness 的全部 join。其 SHA-256 domain 为
`rd.strategy-design-role-set.receipt.v1\0`；hash 只保护 integrity，authority 来自固定且已准入的 R&D resolver。
**CURRENT/PARTIAL：** 固定 R&D API 在 Market Data binding issuance 前解析该准确 readback；caller 不能提供
receipt、role、count 或 resolver。同一 Market transaction 签发并存储未改变的 Replay V2 facts；准确 binding
locator recovery 返回 byte-identical binding 与 Replay payload。**TARGET：** admitted deployment 与隔离
PostgreSQL acceptance。**NOT_ADMITTED：** 该 projection 不是第二个 Design store，不把
Design/role/join authority 转给 Market Data，也不声称 default deployment、Replay composition、Dashboard、
production write、runtime、Backtest result 或 trading authority。

该 receipt canonical binary codec 已固定且不依赖 JSON。整数均为 unsigned big-endian；digest 是原始 32
bytes；string 是 UTF-8 byte length `u32BE` 后接这些 bytes；list 是 item count `u32BE` 后接各 item。bytes
准确顺序为：receipt schema `u16BE`、reserved-zero `u16BE`；Composer locator schema `u16BE`、request identity
string、operation-receipt digest、artifact-locator string、Artifact digest、Plan digest、Design digest；再次编码
operation-receipt、Research-request、Intent、Design-identity、Design、canonical-Design、Plan、Artifact digest；
role count，随后每个 role 的 identity digest、semantic-id、fact-class、instrument、scope、field-semantic-id、
channel、timeframe、unit string、scale `u8`、value-type string；join count，随后每个 join 的 identity digest、
semantic-id string、ordered-role count、每个有序 role 的 semantic-id string 与 identity digest、alignment 与
trigger string、maximum staleness `u64BE`。不得有 trailing bytes。`receipt_digest` 是以上 domain 后紧接这些
准确 bytes 的 SHA-256；canonical bytes 与 digest 自身都不编码进 canonical bytes。准确 locator recovery 从
既有 Composer custody 重新 projection，并且必须返回 byte-identical canonical bytes 与 digest。caller 自建
的 bytes 或 hash 即使 self-consistent 仍不可信，不能进入固定 resolver path。

**macOS 为 CURRENT/PARTIAL；hosted Linux ARM64 与 x86_64 为 REVALIDATION REQUIRED - 本地 bounded-plugin build
producer：** 对准确一个当前 `PluginManifestV2`，R&D 只接纳
固定 `rust.no_std.fixed-abi-source.v2` 语言中一份有内容上限的 `src/lib.rs`，拒绝其他路径、symlink、文件、
dependency、build script、toolchain、target 或 command。它物化两个相互独立的私有临时 Cargo project；
每次构建在定位任何 tool 之前先选择一个 frozen host profile，把准确 host、三项 executable digest 与唯一
`wasm32v1-none` target admission 一次性绑定。CURRENT macOS arm64 profile 绑定 canonical Cargo 1.97.1
（`c980f486…bf5`，SHA-256 `7672ead3…bbf5`）、rustc 1.97.1（`8bab26f…452`，SHA-256
`210df679…a4da`）、rust-lld（SHA-256 `8f5fe507…548d`）及 `aarch64-apple-darwin`。hosted Linux ARM64 A0
候选 profile 记录了 `aarch64-unknown-linux-gnu` 的相同准确 release/commit，Cargo SHA-256 为
`c5dcff70…1808`、rustc SHA-256 为 `a3d4dfcd…e78`、rust-lld SHA-256 为 `533dffee…eb7`。hosted Linux x86_64
候选 profile 记录了 `x86_64-unknown-linux-gnu` 的相同准确 release/commit，Cargo SHA-256 为 `82898072…1953`、
rustc SHA-256 为 `d3a664c9…7eea`、rust-lld SHA-256 为 `38a9f284…5721`，并绑定同一个 frozen `wasm32v1-none`
sysroot digest，该值由 hosted x86_64 测试主机实测。每次已接纳构建
都拒绝 ambient ancestor Cargo 配置，并要求每个 tool 的 `-Vv` host 与所选 profile 一致。`RUSTUP_HOME` 或
`HOME/.rustup` 只定位该 profile 的准确 release 候选 toolchain；路径字节不具 authority 且不进入
semantic identity。随后执行固定的
`wasm32v1-none --offline --locked` command。它要求两份 finished zero-status receipt 与字节一致的 Wasm，
process diagnostic 不进入 semantic receipt identity，然后调用唯一现有 plugin ABI/resource verifier。
move-bound verified build/read 结果可供应 crate-local Develop Composer evidence port；进程内准确重放复用
receipt 且不重新构建，同一 plugin identity 的冲突 capsule fail closed。每个终态路径都显式关闭两个临时
root，cleanup failure 优先于原始终态。这只证明本地隔离确定性 producer 与 consumer contract；Cargo
offline mode 与固定的无依赖 source 不证明 kernel-level network confinement，也不证明持久 PostgreSQL
custody、provider/API/Dashboard 执行、部署或生产 readiness。
已被替换的 Linux pins 来自一次隔离的 Linux/arm64 BuildKit readback：index
`sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`、platform manifest
`sha256:5a8cd84cb3fcfd082789a08f92bd36f8e745c6231edd78e24a3bf34fd471a823`，以及 normalized exact
`lib/rustlib/wasm32v1-none` sysroot tar SHA-256
`92fcee2e35330d22e879b640064e2e4b4e47157af1a7e05fc942dc6cc12b8faf`。2026-09-14 有一次测量报出
`830cb504e83fd5cc9a5ba451b555cd3c9fb177b39647f3a775ce0d5f1d63300f`，freeze 因此被替换为该值，
并等待一次新的 hosted A0 回读。该回读此后已在 `refs/heads/main` 上执行，报出的是原值；hosted x86_64
测试主机、以及钉死的基础 image 在 `linux/arm64` 与 `linux/amd64` 上同样报出原值：五个互相独立的主机、
一个 digest，而 2026-09-14 那个值在其中任何一个上都未被复现。因此 freeze 恢复为每台可达主机实际携带的值。
基础 Rust image 仍由 Dockerfile pin，带 created timestamp 的 local OCI manifest
不是 registry、deployment 或 reproducible-image pin。runtime authority 现在来自 pure-Rust canonical sysroot
verifier：它复现 frozen GNU tar normalization，把 digest 绑定进每份 Linux build receipt，并与 executable
的 build 前后重读一起，在两个相互独立的 build 每次执行前后重读准确 sysroot。准确 workflow
[`strategy-factory-linux-a0`](https://github.com/qOeOp/trade/blob/9e5149d4293a800be3a35e6b747a9f3dba304e1f/.github/workflows/strategy-factory-linux-a0.yml)
已通过准确 main head `9e5149d4293a800be3a35e6b747a9f3dba304e1f` 上的 `workflow_dispatch`
[run 33250411708](https://github.com/qOeOp/trade/actions/runs/33250411708) 回读。其
[`strategy factory A0 native gate (linux arm64)`](https://github.com/qOeOp/trade/actions/runs/33250411708/job/99095016988)
job 在 GitHub-hosted `ubuntu-22.04-arm` 上成功，绑定为 `github-hosted/Linux/ARM64/aarch64`；该运行针对已被
替换的 digest 完成 immutable input verification、Rust 1.97.1 Cargo/rustc 的准确 commit 与 host、唯一
`wasm32v1-none` target、三项准确 consumer 及 post step，因此不能验收 replacement freeze；仍需新的准确
main-bound hosted run。三项准确 consumer 是
`develop_plugin_build_v2_tests::canonical_linux_sysroot_matches_the_frozen_generator_digest`、
`develop_plugin_build_v2_tests::real_bounded_plugin_builds_twice_and_exact_replay_joins` 与
`develop_composer_v2_tests::real_local_plugin_builder_supplies_composer_and_program_host`：它们分别证明已安装
canonical sysroot 匹配 frozen generator digest、真实 bounded plugin 完成双构建并由准确 replay join，以及
真实 build 供应唯一 crate-local Composer 与 `ProgramHostV2` 路径。这只是 main-bound hosted native
builder/Composer/ProgramHost 证据，不是 R&D Owner 业务回执、持久
custody、已部署 Dashboard 或产品 readiness、kernel network confinement、Backtest 或完整 RDQ 证明、Paper、
Live、production/runtime deployment、provider integration、trading authority，或任意复杂策略证据。未 pin
host 仍 fail closed，绝不替换为 generic toolchain。

### 策略编写面

**TARGET / NOT_ADMITTED - 被编写的策略形态：** Bounded Feature Program 今天是以节点图的形式写出来的。
现存的两个程序由手写生成器产出，而那些生成器实际做了什么，就是这一层必须长成什么样的证据，
取代一套从零设计的抽象。

它们的抽象里只有两个是策略概念而不是图的管道：作用于一组条件的 `all_of`，它降级为 `k+1` 个节点的
嵌套 `Select` 链；以及作用于一个度量与一组有序阈值权重对的 `banded`，它降级为嵌套 `Select`。
第一个在一个生成器里被抽象、在第二个里又被手工展开了一遍，这是它是真原语的最强证据：
它被需要了两次，而第二次是重写的。两者都是在冻结原语目录之上的纯组合，所以新增一个策略原语
在目录层面零成本。**第三个程序刻意选了与前两个毫无共同形状的题目，产出了它们都没有的四个原语，
其中一个 - `not` - 在三个程序里都出现过，而三次都是手写的。
所以缺的不是样本量，而是一个把重复出现的东西提出来的步骤，
这一层因此在那一点上被规定为开放的而不是完备的。**

那些生成器手工维持的七处一致性里，有五处是推导而不是决策：总状态字节，它写在三处并由手数的单元格
个数求和；每个单元格的字节公式；八个 `bounds` 整数，填的是选得够大的数；沿 DAG 的单位与标度；
以及那些仅仅为了给某个端口一个同单位同标度的值而存在的常量。
**Owner 已经在算每一项，而它们没有一项是作者做的选择。** 后来十个程序由 Owner 自己的推导从
它们的 meaning 重建出来，与参照逐字段相同，所以这一层的工作不是再算一遍，而是停在它们之前。

把那些生成器统一起来，就是对这个说法的一次测量：八个变成一个，1232 行变成 487 行，二十四份产物
逐字节与原先相同，所以没有任何关于某个程序的东西是活在写它的那个生成器里的。**界线不是这一层
什么都不推导，而是 proposal 那一层整个不必建。** 那十个程序里，作者写出的 `design` 与 `meaning`
是 228 KB 与 297 KB，而 378 KB 的 proposal 是 Owner 的。留在作者这一侧的是角色身份，因为 `design`
把它嵌在每个坐标端口 id 里，而 `project_bfp_role_bindings`（在 `strategy_plan_v2.rs` 里）会拒绝
坐标端口 id 不逐字等于它的绑定，所以这是强制的而不是惯例。它是对 `InputRoleV2` 求的摘要，所以这一层确实依赖一个没有任何契约
文字陈述过、也没有承诺保持的结构体字段顺序，而这份耦合是一处被点名的残留，不是这次划分去掉的东西。

完全没有抽象的那一块恰好就是声明面。端口身份由角色身份派生，而第二个生成器的解法是读一张由另一次
运行产出的角色到摘要的表。**这与校验器报出的是同一个划分：把第一个真策略推过它的十次拒绝里，
八次是声明面与图没有被同时改对，两次才是表达能力的边界。** 一份产物同时生成两侧，
才是让那一类不可表达的东西。事后加进校验器的一条规则 - 变体类型端口的终端
必须读一个带着它自己语义 id 的变体常量 - 在这一层的原型里找出四处已经潜伏的错误，
说明那一类还在继续到来。而在契约对一处声明根本没有约束的地方，这一层也没法让它对：
今天一个带时钟的极值读哪个字段是不受约束的，仓库里有两份夹具把 `CLOSE` 喂给了摆动高点。

这一层是编译器而不是运行时。它产出 `declare` 已经接受的 `design` 与 `meaning` - 绝不产出
`BoundedFeatureProgramProposalV1`，那是 Owner 从它们推导出来的 - 而被编写的文档只在产出那一对时被求值。
单位是语法上的乘积而不是一套代数 - 两个价格的商带的单位是 `PRICE/PRICE` 而不是无量纲  -
所以一个相对阈值要么由这一层做单位归一，要么把那个拼写泄漏进作者写的东西里。
**推导绝不取代校验：一个被推导出来的字段，事后由检查手写字段的同一份契约来检查，
所以一次错误的推导 fail closed，而不是放行一个校验器本会拒绝的程序。**

**IMPLEMENTATION_ADMITTED - 一个停在 meaning 的编写出口：** 一个有界切片，它的产物是
`design` 与 `meaning` 这一对，再无其他。此前一版准入的是相反的切片 - 算出状态字节、`bounds`
整数、单位与标度 - 理由是那是这一层的第一份工作。它们根本不是这一层的工作：它们是 Owner 的，
而一个产出它们的生成器被实测为在重做已经存在的事。所以这个切片加的代码少于它删掉的代码。
它不引入任何编写语法、任何新原语、任何执行路径，而它产出的东西由检查手写声明的同一份契约来检查。

## 血缘与保护反馈准入

用户或 App 只能提供不受信的独立性理由。R&D 派生并持久化 disposition basis identity 与 basis receipt；
Product Edge 不能构造这些事实。Qualification 直接回读准确 R&D basis，并且只有在检查自身完整
principal/scope 历史后才返回不透明投影。Product Edge 把该投影绑定到受信请求上下文，仅搬运 ref digest
source cut clock epoch 与半开有效期。

在同一个锁定 S1 准入事务内，R&D 回读 basis 解析完整本地前驱历史并校验当前 Qualification 投影。
经证明为空的本地历史产生 `GENESIS_EMPTY`，非空历史产生准确 `COMPLETE_FRONTIER`；缺失 过期 畸形
冲突 跨 principal 跨 scope 或跨 basis 的证据都产生 `UNAVAILABLE`。`UNAVAILABLE` 返回
`SUBMITTED_OR_UNKNOWN`，且不写 Research receipt Intent TrialFamily root/member/head 或转换 outbox。
在其他权威均当前时，畸形理由只能产生 `REJECTED_NO_WRITE`。相同 request 理由和规范 Owner cuts
重放准确相同字节；含义或 cut 改变不能加入。R&D 永不读取保护 payload 或细节。

## 有人值守的 D-only 修复

授权用户可以选择一个准确的当前策略 generation 与 Artifact，要求 R&D 只修复实现缺陷而不启动自适应
Research。Product Edge 只提交类型化 `ATTENDED_D_ONLY_REPAIR` 请求并显示有界结果，只有 R&D 能接纳
请求并提交 D-only Repair Disposition；Shell 确认或可见视图都不是该终态事实。

- admission 前的过期 无效 未授权或含义已变请求只通过 R&D Request Receipt 闭合为
  `REJECTED_NO_WRITE`；此时没有 repair attempt，因此不创建 D-only Repair Disposition。
- `D0_NON_EXECUTABLE` 只有在可执行字节 依赖 lock capability manifest 确定性 trace 和全部可部署
  身份均未变化时才闭合为 `D0_COMPLETED_NO_ARTIFACT`；它不创建 Artifact Candidate Qualification
  attempt Governance generation 或替换。
- `D1_EXECUTABLE_REPAIR` 先执行确定性 build package 与 Artifact Security Admission attempt。该阶段的
  确定性失败在任何 canonical 后继 Artifact、security admission、repair-validation result 或 Candidate
  出现前闭合为 `D1_BUILD_FAILED`；失败证据与新鲜 Time Evidence 对本次 attempt 为终态，且不授权裸重试。
  构建完成后才生成新的不可变 Artifact，再执行请求相等且非自适应的 Backtest 修复验证。通过时闭合为
  `D1_VALIDATED`，此后才允许另行创建 attended-repair Candidate 进入独立 Qualification；
  验证失败 被拒 无效或语义不相等时闭合为 `D1_VALIDATION_FAILED`，保留不可变构建证据但不创建
  Candidate 或生命周期转换。
- admission 后的机制 参数 universe PIT 或数据语义 市场语义 成本 滑点 容量 allowed surface 或其他
  Research 维度违反都闭合为
  `REJECTED_NOT_D_ONLY`；它不创建 repair Artifact 或 Candidate，只能另行授权进入带来源假设的
  Research Intent。
- 构建或验证 custody 缺失或无法对账时，在最后权威 frontier 明确闭合为 `OUTCOME_UNKNOWN`；投递
  静默 超时 telemetry 或 Product view 都不能提升为成功。它不创建 Artifact Candidate Qualification
  或部署转换，也不能触发裸重试。
- 前序 Artifact 与 generation 永不原地修改。每个 disposition 都重复原始 request admission attempt
  身份和准确 admitted cut。相同 request admission attempt 与含义的重放加入只写一次的 disposition；
  含义变化必须拒绝，另一次尝试需要新的显式用户请求 后继 admission 与后继 attempt。Backtest 只返回
  修复验证事实，不选择修改内容；保护 Qualification 细节永不返回 R&D。

## Research 诊断与迭代契约

Source Intake 不能从来源直接跳到代码。Intent 冻结前，Research 至少记录一个合理替代解释、一个能区分
首选机制与替代解释的可观察预测，以及一个证伪条件。缺少替代解释或预测没有区分力时，来源可以被
接纳，但不能生成可交接 Intent。

| 诊断维度   | 必需诊断                                                                                                                                                  | 决策用途                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 证据完整性 | 校验来源 PIT 时间 universe 与修订身份 Artifact 配置 runtime simulator 以及确定性请求结果相等。                                                            | 解释策略表现前先修复或拒绝证据。                                                                              |
| 机制有效性 | 对照冻结因果机制 证伪条件与停止规则，判断观察方向 路径 市场状态和失败方式。                                                                               | 停止已证伪机制，或只创建一个后继机制假设。                                                                    |
| 经济可行性 | 按冻结模型版本归因换手 费用 spread 滑点 冲击 流动性和容量。                                                                                               | 经济不可能时停止，或在稳健性检验前只修改一个经济假设。                                                        |
| 稳健性     | 在不消费保护证据时检验时间 市场状态 标的 扰动和合理参数邻域敏感性。                                                                                       | 区分稳定机制支持与狭窄参数偶然。                                                                              |
| 失败归因   | 把失败分类为数据 工件 runtime simulator 机制 经济 稳健性或未解析不确定性。                                                                                | 把修复路由到所属边界，防止无效运行成为负 Alpha 证据。                                                         |
| 信息价值   | 每个预注册下一实验都绑定决定不确定性 区分性观察或证伪 结果到动作映射 有界获取成本 剩余 family 预算影响 竞争替代项，以及同一证据截面的可重放序数比较理由。 | 以确定 tie‑break 选择排名最高的可接纳实验；无解释序数不可接纳，只有完整且非空的全员低于阈值 census 才能停止。 |

Backtest 为每个终态探索结果提供完整有限 `diagnosticCategorySet`；Research 必须保留全部支持成员，
并先按以下准确映射再解释经济表现：

| Run Result 诊断集合                                                                                        | Research 处置                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 含任一 `MARKET_DATA` `ARTIFACT` `RUNTIME_KERNEL` `BACKTEST_OPERATIONAL` `SIMULATOR` `REPLAY_CONFIGURATION` | 缺陷证据优先于经济解释；保留全部支持缺陷，再按 `MARKET_DATA > ARTIFACT > RUNTIME_KERNEL > BACKTEST_OPERATIONAL > SIMULATOR > REPLAY_CONFIGURATION` 选择唯一 `REPAIR_INPUTS` 目标。 |
| 不含缺陷，且含 `NO_EXECUTION_DEFECT` 或 `VALID_ECONOMIC_FAILURE`                                           | 允许经济与机制解释，但都不强制迭代或选择。                                                                                                                                         |
| `UNRESOLVED_FAILURE`                                                                                       | 不产生 Iteration Decision；保留在 census，直到取得可隔离证据。                                                                                                                     |

### TARGET / NOT_ADMITTED - Replay Policy V2 权威与事务拓扑

Replay Policy V2 Catalog 保持 R&D 私有。每个 policy version 都是密封 版本化且内容寻址的事实；显式
current-head fact 与 revocation fact 是规范 R&D 事实。紧接第一笔 TrialFamily-formation write 之前，私有 R&D
formation resolver 把既有 R&D transaction 传给其密封 Catalog read capability；该 capability 不打开第二个
pool、connection 或 transaction。它锁定并重读 current 且未撤销的 Catalog record，并绑定准确 version、
content digest、head 与 revocation cut。Catalog 是 formation 前唯一 policy 来源。head 不存在、version 已
撤销、cut 过期、digest 不匹配或回读不可用时必须失败关闭，且 TrialFamily、initial Census Frontier、
receipt 与 outbox 全部零写入；不存在隐式 fallback。

Catalog 唯一 writer 是私有且受审计的 R&D Catalog Administration Port。它拥有 policy create、immutable
version append、显式 current-head advance 与 revocation。每个已接纳 administration command 都原子记录其
已认证 administrative identity、准确 predecessor/head、结果 content identity 与 immutable audit fact。该 audit
fact 就是持久 command receipt。Catalog authority 只包含 immutable record、singleton head、revocation 与 audit
table；不存在单独的 administration receipt 或 outbox table。普通 caller、Product Edge、Dashboard、provider
与其他 Owner 不能调用该 port、选择 policy version、推进 head、撤销 version 或写入 Catalog storage。
environment value、default、migration、deployment configuration 与 runtime selector 都不能 seed 或合成
policy 或 current head。

唯一可以 bootstrap 空 Catalog 的产品 composition 是一个独立、显式启用、单次运行的
`authority-admin` composition。它不提供 API route，Product Edge、Dashboard、R&D API、default service、
migration 与 runtime selector 均不能调用它。只有该 composition 使用另行提供且 broker-only 的
`REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL` 访问固定 Catalog Administration Port。Rust composition 在 database
access 前验证 sealed Ed25519 request；PostgreSQL 不独立验证 Ed25519，而是信任独占的
`replay_policy_catalog_admin_writer` principal 作为该 broker 的 mutation boundary。该 credential 绝不能分发给
operator、ordinary service、Dashboard 或 generic SQL client；在 broker 外持有或使用即为 trust-boundary breach。
`rd_fact_writer` 只保留 Composer 写入，不能调用 Catalog mutation。

其私有 V1 request 是由 Ed25519 签名、拒绝未知字段的密封文档，它绑定 request schema
version、bootstrap identity、administrator identity、单独信任的 verifier identity、Catalog record
identity、完整 canonical policy bytes、确定性 create 与 head-advance command identity、event time 与
signature。在打开 database connection 之前，composition 必须按准确 V1 schema 解析、拒绝任何
未知或畸形字段、使用另行信任的 verifier identity 与 key 验证签名，并交叉验证每个
绑定 identity 与 canonical policy digest。`authentication_fact_digest` 只能从该已验证证据派生；
不得从 request、credential、environment 或 caller assertion 接收它。

transaction 必须先锁定并分类完整 records/head/revocations/audits census。只有准确 `0/0/0/0` storage
可以创建 version 1，把显式 current head 推进到该
record，并把两个确定性 command 作为 immutable authenticated audit fact 原子提交。唯一公开
projection 是从准确 sealed request 与 audited record/head state 重建的一份确定性 typed Owner readback。
resolution 要求准确 `1/1/0/2` 以及准确 record、head 与 audit bytes；record 的 genesis predecessor 必须为
NULL，其签名 actor/time provenance 及 head 的签名 actor/time provenance 也必须匹配。任何其他 partial、extra
或 provenance-mismatched shape 都保持不变并 conflict。
首次 success 与准确 response-loss 或 restart replay 都必须以零写入返回该逐字节相同 readback；任何
attempt-local `CREATED`/`RESOLVED` field 或 execution-path marker 都不得改变其 bytes。任何 bootstrap、
create-command 或 head-advance identity 或 meaning 改变，或遇到 orphaned、divergent、revoked、tampered、
partially initialized、unauthenticated 或其他非规范状态时，必须返回 conflict，并对 Catalog record、
head、revocation 与 audit 全部零变化。response loss 与 process restart 只能解析同一组确定性
command，不得合成 replacement policy、identity、head、receipt、outbox 或 success result。

deployment 顺序严格固定为：有界 schema materialization，然后 custody cutover，再显式执行
`authority-admin` Catalog bootstrap。default startup 只执行已签名的准确 `rd_owner` readback，之后 R&D API
才能开始 listen。不存在
隐式 policy 或 current head。bootstrap readback 缺失、无法验证、不匹配或尚未解析时，startup 必须
fail closed。

该有界 composition 按上面的契约、且仅按该契约 **IMPLEMENTATION_ADMITTED**；只有在 merged implementation 与
具名 acceptance evidence 证明 authentication rejection、empty-store creation、exact replay、changed-identity 与
changed-meaning conflict、response-loss/restart resolution、tamper rejection、每种零变化失败，以及 fresh
disposable PostgreSQL 与隔离第一方验收拓扑中随后的 accepted TrialFamily formation 之后，才能把它称为
**CURRENT**。该状态不证明 production
deployment、Workbench product readiness、provider readiness 或任何真实交易权威。

TrialFamily formation 成功后，完整 policy 及其 Catalog identity、version、digest、grammar/parser identity
与 digest cross-binding 永久密封在 family 中。后续 Replay 或 Composer composition 只使用该 family-sealed
policy 与 cross-binding，绝不把 Catalog 重读为 authority。Catalog reread 可以只用于 audit，不能影响
admissibility；后续 Catalog version、revocation、deletion、unavailability 或 tamper 不能替换 policy，也不能
使已形成 family 失效。

后续 Replay Policy V2 composition 使用一个 R&D-owned A1 orchestration，跨两个边界明确的 Owner
transaction。read-only `market_data_reader` transaction 先取得准确 Composer request 的 shared cut lock，
通过 Owner-owned sealed function lock 并规范回读完整 Composer aggregate，完成校验，并保持开启直到 Market
terminal decision。只有此后，固定 `market_data_owner` login principal 才可打开一个 SERIALIZABLE
transaction，证明两条连接到达同一 live primary、database、postmaster incarnation 与 advisory lock manager，
取得同一个 shared Composer cut lock 作为 database-level handoff，并执行全部 Market Data lock、规范回读、
校验、seal 与 positive write。Composer writer 在每次 mutation 前都使用匹配的 exclusive cut lock，因此任一
存续 shared lock 都会阻止 Composer 漂移，直至 Market transaction commit 或 rollback。任何 Owner 或 A1 都
不得读取另一 Owner 的 raw table、重建 sealed evidence、转移 fact authority、获得另一 Owner 的 raw access，
或声称 shared XID、MVCC snapshot 或 cross-Owner atomic commit。`market_data_owner` 仅对自己的 private Market
Data relation 保留 raw authority。任何 unavailable、stale、mismatched、cross-cut、wrong-owner 或
wrong-database evidence、lock-manager proof 失败，或 family-sealed policy cross-binding 无效，都必须在第一笔
positive Market write 前失败。Binding、Replay fact、receipt、outbox 与 issuance response bytes 只在 Market
Data Owner transaction 内原子提交；Composer evidence 在 guarded window 中保持稳定，但此前已经独立提交。

disposable Catalog fixture 仅用于测试。隔离的 `SEALED_ACCEPTANCE` harness 可以通过私有 administration
port 在其 fresh PostgreSQL instance 中创建并显式推进一个固定的内容寻址 policy head。fixture、
administrative hook 与 policy bytes 都不是 runtime default、migration seed data、production configuration，
也不是 deployed Owner/Dashboard readiness 证据。

### TARGET / NOT_ADMITTED - 同一截面的 Decision 与 Selection composition

`DecisionCompositionRequest` 只含 locator：它标识 R&D-owned TrialFamily 和一个 Backtest-owned 探索
Result，但不提供 Result bytes、diagnosis、readiness judgment、policy outcome、next action 或 Selection。
neutral locator 或 `vibe-backtest-owner-contracts` representation 不携带权威。R&D 只从规范 Owner fact
内部派生全部六个 diagnosis dimension、result readiness、total-precedence branch、policy outcome 与 selected
identity。

R&D 在一个由 R&D Owner 持有的 PostgreSQL transaction 内锁定其规范 TrialFamily Census、已消费 budget、
candidate-set 与 attempt frontier、decision-policy version，以及 composition 使用的全部其他 predecessor；
并在同一 transaction 上使用 dependency-neutral 但绑定 Backtest Owner 的
`vibe-backtest-result-custody` adapter，锁定并校验规范 Backtest Result、receipt 与 outbox。第一笔写入前，
R&D 立即采样唯一 final cut，派生 Diagnosis 与 readiness，并同事务提交准确一个 Iteration Decision；只有
该决定为 `READY_FOR_SELECTION` 时才同时提交 selected-only Research Selection，并为它们写入 R&D outbox。
Backtest 仍只拥有 result 权威；R&D 仍是 diagnosis、Decision 与 Selection 的唯一 Owner。

Result 缺失、过期、跨来源拼接、owner 错误、function 错误、ACL 不匹配、非规范、digest 不匹配、
receipt/outbox 不完整，Census/budget/frontier/policy 不完整，存在 caller-authored 派生字段，或通过独立 pool
或 transaction 读取时，都必须在第一笔写入前失败，且 Iteration Decision、Selection 与 outbox 全部零变化。
含义相同的 retry 加入同一份已提交 composition 并返回逐字节相同的 receipt；response loss 后，准确
`RESOLVE` 只能恢复该既存结果，不能创建首次 custody、在新截面重新执行 policy，或创建替代 Decision 或
Selection。该契约在真实 disposable PostgreSQL 证据证明同截面正向路径、全部零变化拒绝、restart 与
response-loss recovery 前保持 TARGET。它不增加 dependency cycle，也不授予 Dashboard 实现、deployment、
production write、provider effect、Paper、Live 或交易权威。

每个后继只声明一种 experiment mode。一次迭代在 `SINGLE_DIMENSION` 模式下只改变一个与决定相关的假设
dimension，并从以下九个 typed dimension 中选择：
`RETURN_MECHANISM` `MARKET_REGIME` `INSTRUMENT_SCOPE` `FEATURE_SIGNAL` `ENTRY_RULE`
`EXIT_RULE` `POSITION_AND_HOLDING` `FREQUENCY_AND_COST` `CAPACITY_AND_PORTFOLIO_ROLE`。只有假设
确实需要有限组合时才允许
`PREREGISTERED_FINITE_JOINT`；必须在观察结果前冻结全部变化维度 有界组合 归因规则 预算 证伪与停止
规则。它不能成为开放参数搜索，也不能掩盖观察结果后的捆绑调参。

准确开发流程是 **Run Result → Diagnosis → Iteration Decision → Successor Intent / Selection**：

1. 只有请求相等的 `TERMINAL_RESULT` 进入 Diagnosis，并先按上表映射其完整 Backtest
   `diagnosticCategorySet`。所有同时有证据支持的成员都保留在结果与决定上；任一缺陷都优先于经济解释，
   Research 再按冻结类别优先级选择唯一修复而不丢弃低优先级事实。来源 provenance 缺陷使
   Intent 准入失败，有效经济模型变化属于 typed successor hypothesis，而不是证据修复。
   `UNRESOLVED_FAILURE`、未知或非终态尝试、无效候选集都不产生 Iteration Decision。全部尝试保留在
   TrialFamily Census，不能重新解释为负 Alpha 证据。
2. Diagnosis 记录全部六个维度，引用准确 Intent Request Result Artifact 数据 runtime simulator 和
   成本 滑点 容量模型身份，不改写任何事实。
3. 下一动作使用完整优先级：`REPAIR_INPUTS`；再处理 input unavailable 证伪 规则或预算 hard stop；再
   `READY_FOR_SELECTION`；再 `STOP_LOW_INFORMATION_VALUE`；最后才选择唯一 change。change 分支中，
   证据修复优先于解释，机制优先于参数细化，再检查经济与稳健性。只有冻结生成规则 candidate-set
   frontier expected cardinality observed membership 与每个候选的类型化 admissibility reason 共同证明没有
   候选缺失或未解析时，候选 census 才完整。完整有限集合按 admissibility、序数
   uncertainty-reduction rank、确定 tie-break key、无碰撞候选身份加内容摘要作字典序比较；这些都取自 Intent
   冻结的信息价值策略，而不是在决策时重新计算。身份 摘要或
   完整比较 key 重复都会使集合无效，不创建后继 选择 修复效果或低信息停止。只有完整 census 中每个
   成员均可接纳、都已按预注册阈值可比打分且全部低于阈值时，才能提交
   `STOP_LOW_INFORMATION_VALUE`。集合不完整 未知 因其他理由不可接纳或不可比较时不产生 Iteration
   Decision；所选身份必须等于唯一计算胜者。
4. Iteration Decision 只提交一个互斥结果：`REPAIR_INPUTS` 后继实验 `READY_FOR_SELECTION` 或终态停止。
   后继冻结新 Research Intent 必要时的新 Artifact 和 Replay Request 身份。Research Selection 只能绑定
   唯一 `READY_FOR_SELECTION` 决定及相同 decision-policy version TrialFamily Census 与证据截面；停止
   状态与选择不能并存。

`REPAIR_INPUTS` 按类别路由，绝不表示任意重试。它是所消费结果的不可变终态处置，本身不创建
Selection 后继 Intent Artifact Replay Request 或修复效果。`MARKET_DATA` 指向 Market Data，也是唯一能
在决定提交后产生关联 Market Data Repair Request 的类别；`ARTIFACT` 指向 Research 经 Develop 重建并
要求新 Artifact 身份；`RUNTIME_KERNEL` 指向 Runtime 并要求新 kernel 身份；`BACKTEST_OPERATIONAL`
指向 Backtest 在 Native Replay 表面的
`BACKTEST_RUNNER_SERVICE`，绑定 operational-profile version、run attempt、runner/service readiness、
backpressure、resource exhaustion 或 outage 证据和 Time Evidence。它必须先于经济解释闭合，且不能
重标为 `RUNTIME_KERNEL` 或 `SIMULATOR`；`SIMULATOR` 指向 Backtest 的 Sim Exchange 表面
`sim-exchange`，并要求新 simulator 身份。
`REPLAY_CONFIGURATION` 仍由 R&D 拥有，并要求带新配置摘要的新
Replay Request。对 `RUNTIME_KERNEL` `SIMULATOR` 与 `BACKTEST_OPERATIONAL`，R&D 从准确前驱
`REPAIR_INPUTS` 决定、稳定 correlation、原始缺陷 proof digest、类别专属旧 native identity 与 source
cut、目标 Owner、policy 和新鲜 Time Evidence 冻结一个 `native-repair-request`。Runtime 只接受
`RUNTIME_KERNEL`，Backtest 只接受 `SIMULATOR` 或 `BACKTEST_OPERATIONAL`；含义相同的 replay 加入同一
native attempt，含义变化则需要后继 R&D-owned request identity。

只有 native Owner 能把关联修复结果提交为 `REPAIRED` `UNAVAILABLE` 或 `OUTCOME_UNKNOWN`。
`REPAIRED` 命名新的类别专属 native identity，并只允许 R&D 冻结一个新请求相等 Replay Request，绑定
准确 native-repair-request identity、准确 repair-result identity、新类别专属 native identity、原始
defect-proof digest、准确前驱 `REPAIR_INPUTS` 决定、类别、稳定 correlation、前驱与后继类别专属 native
identity 及 source cut，以及未改变的前驱请求语义。`BACKTEST_OPERATIONAL` 还绑定后继 operational-profile
identity 与 cut。只有匹配的 `REPAIRED` result 允许该 re-entry；`UNAVAILABLE` 与 `OUTCOME_UNKNOWN`
都不允许。`UNAVAILABLE` 对本次 attempt 为终态，只允许准确关联的 `STOP_INPUT_UNAVAILABLE`；
`OUTCOME_UNKNOWN` 不提交 stop retry 后继 Intent Selection Artifact 或 Replay Request。请求投递 接受 静默
或 telemetry 都不能替代终态结果；任何 native repair 都不改写旧 Intent，也不静默开工。

Market Data Repair Request 绑定原始 PIT 请求与证明摘要 标的范围 决策截面 类别 稳定 correlation 身份
和共享 Time Evidence。Market Data 返回关联的 `AVAILABLE` 或 `UNAVAILABLE` PIT Snapshot 终态；传输
送达 静默或证明摘要变化都不是结果。匹配 `UNAVAILABLE` 会提交只追加 Research 终态
`STOP_INPUT_UNAVAILABLE`，绑定前驱修复决定 准确请求结果 证据截面和时间证据，不创建 Selection
重试或后继 Intent。匹配可用修复可以支持新请求。修复不改写旧 Intent，也不静默开工。

触发冻结证伪条件 停止规则 预算耗尽 已证明经济不可能或预期信息价值过低时必须停止。低信息价值只能
由上述完整已比较候选 census 证明；未知 不完整 因其他理由不可接纳或不可比较的选项都不能推出该停止。
完整证据截面已可选择时也结束探索。保护测量 结果 类别和 holdout 细节永不进入 Diagnosis 或 Iteration Decision。
purge 与 embargo 派生规则、TrialFamily-aware multiplicity policy、attempt frontier 和保护决策政策都在
结果前冻结，并在 Replay Request Run Result Iteration Decision Selection 与 Candidate 之间原样传递。
其中任一改变都创建后继血缘，不能重新解释旧结果。

## 输入交接

- Product Edge 提供带来源研究请求而不是无来源交易指令，请求提交已经投影给该 principal 的有界保护反馈前沿。Research 用自己的终态回执解析稳定请求身份，并保留语义前驱而不读取保护类别或细节；回执缺失时保持未知。
- [Market Data](./market-data/) 提供 PIT 事实 数据版本与标的语义。对每个初始 PIT Market Snapshot Request，它返回一个
  move-only、由 Market Data 密封的 `ResearchPitTerminal`，关联准确的请求身份与内容摘要，携带规范六态处置
  `AVAILABLE` `INSUFFICIENT` `STALE` `UNLICENSED` `AMBIGUOUS` 或 `UNAVAILABLE`，以及准确的 Universe Selection
  Record 身份与摘要。只有 `AVAILABLE` 能进入冻结或后继 Intent；其他状态只冻结依赖它的 Intent，没有响应则保持
  未知。对已提交的 Market Data Repair Request，它另行返回关联的 `AVAILABLE` 或 `UNAVAILABLE` 终态。
- [Backtest](./backtest/) 对每个 R&D 拥有的 Exploratory Replay Request 返回一个 Exploratory Run Result，状态恰为
  `RUN_REJECTED` `IN_PROGRESS_OR_UNKNOWN` `TERMINAL_RESULT` 或 `INVALID_REPLAY_EVIDENCE` 之一。结果重复实际消费的
  Artifact、PIT 范围与 PIT Market Snapshot、Universe Selection Record 与修正规则、重放配置、Runtime kernel、simulator
  以及成本 滑点与容量模型身份，并附带完整有限的 `diagnosticCategorySet` 与每个成员的决定性证据截面。Research 只能使用
  请求相等的 `TERMINAL_RESULT`；被拒绝 无效 未知 非终态或不相等的 attempt 只保留为 TrialFamily Census 事实，最多只能
  产生 `REPAIR_INPUTS`，绝不产生 Selection 或后继假设。读取结果本身绝不自动创建后继 Intent。
- [Qualification](./qualification/) 不向已提交 Candidate 的研究循环返回任何保护反馈。Research 只能通过 Product Edge
  观察到关闭该准确 Qualification Review Request 的只写一次 `ADMITTED` 或 `NOT_ADMITTED` Candidate Intake Receipt，
  以及有界的公开 Qualification Status Summary。回执缺席保持 `SUBMITTED_OR_UNKNOWN`；`NOT_ADMITTED` 不创建保护
  attempt 也不消耗 holdout，含义变化不能加入该回执或创建第二次 intake。
- 已提交且绑定 generation 的 Performance Runtime Incident Execution 账户 订单 成交 quality observation
  Effect Journal 回读与 Reconciliation Drift 事实，只能作为新
  Research Source Provenance Record 进入后继血缘。它们不能改写已部署或已选择的 Intent Artifact
  Candidate，也不能越过保护证据边界。
- [Runtime](./runtime/) 直接提供已提交且按 generation 划分的 Incident 事实，只允许作为后继来源接纳。
  [Execution](./execution/) 直接提供已提交账户 订单 成交 quality observation Effect Journal 回读和
  Reconciliation Drift 事实，用途相同。两种交接都不能调节运行中 generation 或暴露保护
  Qualification 证据。每条 Research Source Provenance Record 都绑定准确已提交事实身份与来源截面；
  Effect Closure View 或 Event Rail wake 不能替代这些事实。

## 输出交接

- 向 [Market Data](./market-data/) 在探索性消费之前交付一个 R&D 拥有的冻结初始 PIT Market Snapshot Request，绑定
  Research Request、Intent 与 TrialFamily 身份、请求的标的或宇宙范围身份与版本、四时间决策截面与 PIT 语义、所需的
  provenance、Source Binding 与数据集版本集、许可 权利 保留与署名策略截面、修正与修订前沿截面、稳定的请求关联身份，
  以及请求时刻的 Time Evidence。R&D 拥有其身份与内容摘要；相同身份与摘要加入同一个 Market Data attempt，范围 截面
  provenance 许可 修正或含义变化则需要后继请求。传输成功只让请求保持 `SUBMITTED_OR_UNKNOWN`，不证明任何快照可用。
- 向 [Market Data](./market-data/) 只在已提交 `REPAIR_INPUTS` Iteration Decision 后发出 Market Data
  Repair Request。请求要求原生 Owner 修复证据，不指定 adapter 不改写旧 snapshot 也不宣称数据可用。
- 向 [Backtest](./backtest/) 交付一个由 R&D 拥有的冻结 Exploratory Replay Request，绑定准确意图
  工件 数据范围 重放配置以及成本 滑点与容量模型身份。隔离 EVENT replay 路径只交付其 R&D-native 密封
  locator/receipt；每个下游 Owner 都必须重新 resolve 固定 R&D 只读 port 并验证 canonical request bytes 与
  digest，不能信任 locator 标签或下游 Owner 的自我证明。
  `REPAIR_INPUTS_SIMULATOR` 或 `REPAIR_INPUTS_BACKTEST_OPERATIONAL` 决定还可创建一个关联
  `native-repair-request`；只有 Backtest 能针对该准确类别专属 attempt 返回 `REPAIRED` `UNAVAILABLE`
  或 `OUTCOME_UNKNOWN`。
- 向 [Runtime](./runtime/) 只在已提交 `REPAIR_INPUTS_RUNTIME_KERNEL` 决定后创建一个关联
  `native-repair-request`；只有 Runtime 能针对该准确 kernel attempt 返回 `REPAIRED` `UNAVAILABLE`
  或 `OUTCOME_UNKNOWN`。
- 向 [Strategy Governance](./strategy-governance/) 交付 Owner admission 在一次生命周期决定之前重读的那份封存
  Build Receipt，按该回执被封存时的准确 Artifact 身份与摘要解析，携带它绑定的 intent TrialFamily 代码字节与
  依赖集合。R&D 只陈述自己构建了什么，不陈述该 Artifact 是否可以运行：一份 Build Receipt 绝不是一次激活，绝不是
  一次 qualification，绝不是一次资金决定，也绝不是任何生命周期状态已达成的证据。在那个准确身份与摘要下解析不到的
  回执是缺失而不是陈旧，而缺失的回执不准入任何生命周期转换，也不准入一个更保守的转换。
- 向 [Portfolio](./portfolio/) 交付一次退化归因所点名的那份冻结 Research Intent，按准确的 intent 身份与摘要解析，
  携带该 intent 冻结的预测与证伪条件，以及它们被冻结时所处的截面。R&D 只供给冻结的预测；它不观察已实现的绩效，
  不归因，也不测量偏离。一份 Research Intent 绝不是一个绩效主张，绝不是一个容量陈述，其本身也绝不是某个机制已经
  退化的证据 - 偏离及其被保留的替代解释属于 Portfolio，两个 Owner 都不得推导对方那一半。
- 探索结束后只向 [Qualification](./qualification/) 交付拥有终态 `SELECTED_FOR_QUALIFICATION`
  Research Selection Disposition 的冻结 Candidate。交接交叉绑定准确 Intent 证伪条件与停止规则 完整预注册
  不可变穷尽 TrialFamily Census Frontier 探索请求结果前沿 完整跨 TrialFamily 语义前驱前沿 来源反馈前沿
  和预提交独立性依据。Candidate 与 Selection 重复 Intent 和探索请求结果前沿冻结的准确成本 滑点与
  容量模型身份以及预注册保护决策政策身份与版本。Candidate 还绑定冻结 Protected Robustness Plan
  身份与版本；Qualification 和保护 Backtest 原样消费它且不向 Research 返回保护测量。Candidate 与选择身份由 R&D 拥有，Qualification
  拥有 intake 与累计 holdout 状态。
- Selection 还必须绑定唯一 `READY_FOR_SELECTION` Iteration Decision，并且 policy version TrialFamily
  Census 和证据截面完全一致。`REPAIR_INPUTS` 后继 停止 被拒 无效 未知或非终态不能产生 Candidate。
- 向 Product Edge 提供终态 Research Request Receipt 和一个有界 Research View。有人值守修复时，同一
  view 还可投影 R&D-owned D-only Repair Disposition，但不拥有或重新解释它。视图绑定稳定请求
  trusted principal 授权 Research scope 授权政策截面 准确 Research 前沿 投影和 valid-through 时间，状态为 `AVAILABLE` `STALE`
  或 `UNAVAILABLE`，阶段为 `REQUEST_UNRESOLVED` `INTENT_FROZEN` `ARTIFACT_AVAILABLE`
  `EXPLORATION_ACTIVE` 或 `SELECTION_TERMINAL`。它可以汇总 R&D 拥有的来源 意图 工件 探索和
  决定事实，但不包含保护 Qualification 细节。终态停止只能来自 Iteration Decision，只有存在仅选择
  disposition 时视图才显示 Selection。

**CURRENT_PARTIAL - 有界的已验证 outcome 读面。** R&D Owner 回答两个经认证的 zero-effect read，它们都基于
这个 Owner 自己解析出的同一个 historical custody cut：verified Research outcome 清单与 verified Build
outcome 清单。两者都按最新在前回答，至多返回调用方请求的行数、且绝不超过这个 Owner 自己拥有的上限，并同时
回显它解析所依据的 custody cut 与是否发生截断。Research 行携带 request 身份 提交时间 resolution 与
question 绑定；Build 行携带 build request 身份 attempt 身份 提交时间与 disposition。调用方既不指名 cut
也不指名超出上限的行，因此消费方无法声称一个这个 Owner 没有解析过的坐标。两个清单相互独立：其中一个回答
unavailable 或位于不同 cut 时，只撤回它自己的行与计数。两个读都不接纳 Plan Artifact 收据字节 源码文本或
任何 mutation，也都不是 Selection Candidate 或 Qualification 事实。

## 拒绝和禁止事项

- 不使用已提交候选的保护评估或 holdout 结果继续调优同一候选。
- 不原地修改冻结意图或工件，任何迭代必须创建新身份。
- 不用变化后的内容 检索截面 许可依据或解释重用 Research Source Provenance Record 身份；变化证据必须创建后继记录和 Research Intent。
- 不通过 Candidate 或 Artifact 改名重置 TrialFamily 或 holdout 历史。
- 不通过新 TrialFamily Shell principal 别名或请求身份擦除语义前驱或已经投影的保护反馈前沿。
- 不遗漏失败或无效同族试验 不重分 TrialFamily 也不在冻结 Candidate 后追加试验；新族成员必须创建后继 frontier 与 Candidate。
- 不选择实际消费身份与请求不同的探索结果。被拒 无效 未知 非终态或请求不匹配的尝试只留在 census。
- 不编造未选择 disposition。停止只属于 Iteration Decision；缺少仅选择 disposition 就不存在 Candidate 交接。
- 不在没有已提交 `REPAIR_INPUTS` 决定时发出 Market Data Repair Request，不把传输送达当作修复证明，
  也不在旧 Intent 下重新解释修复后的 snapshot。
- 不把非 `MARKET_DATA` 修复路由给 Market Data，不把 `UNAVAILABLE` 当作空结果，也不把未知或非终态
  尝试当作停止。`STOP_INPUT_UNAVAILABLE` 必须绑定准确关联终态结果。
- 冻结排名和 tie-break 指向另一实验时，不得选择排名较低的可接纳下一实验。
- 候选 census 不完整 membership 未知 因其他理由不可接纳或不可比较时，不得提交
  `STOP_LOW_INFORMATION_VALUE`；每个候选都必须存在 可接纳 已与阈值比较且低于阈值。
- 不按到达顺序打破重复或碰撞 comparison key；候选集无效且不产生下一动作。
- 不把来源 LLM 输出 漂亮回测或统计分数直接提升为部署资格。
- 不执行外部来源或工具响应中嵌入的指令。所有此类内容都只是未信任证据输入；只有接收 Owner 的
  类型化契约和已准入主体才能授权操作。
- 不准入依赖可变或未解析、capability 或 Artifact Security Admission 缺失、市场语义不匹配、可访问
  环境 secret、可逃逸 subprocess 或 process tree、继承环境权限，或使用未声明 filesystem network
  账户 部署 effect port 的工件。
- 不激活 Runtime 不分配资金 不签发风险许可也不发送订单。
- 不把 Shell 送达当成接受，不为含义改变的请求改写回执，也不让 `REJECTED_NO_WRITE` 绑定 Research Intent。

## 失败与恢复

来源缺失 数据语义不清 试验族无边界 成本不可用或预算耗尽时，禁止提交候选。未准入 build failure 只
作为 Develop Sandbox 诊断；已接纳 D1 repair 内的确定性 build package 或 security-admission 失败把
attempt 闭合为 `D1_BUILD_FAILED`。生产恢复不会重开冻结研究身份，运行事故只有在提交事实可读后才能
形成新的带来源假设。

## 决策契约

- **输入** - 已接纳来源 provenance PIT 事实 冻结 Intent 与实验政策 穷尽 TrialFamily Census 和请求
  相等探索结果。
- **诊断与决定** - 解释六类诊断维度，再按 typed experiment 规则只提交修复 后继 ready 或停止之一。
- **冲突解析** - 证据有效性和冻结 falsifier 高于漂亮表现；其他可接纳下一实验按序数信息价值和已
  声明 tie-break 选择。
- **输出与终态负例** - 后继 Intent `READY_FOR_SELECTION` 带类型 `REPAIR_INPUTS` 或命名停止；关联
  Market Data 修复不可用时产生 `STOP_INPUT_UNAVAILABLE`，未知证据不产生决定。
- **反馈与经济意义** - 探索和已提交 Owner 事实只能改善后继血缘；成本 滑点 容量 family 预算和预期
  决定价值共同阻止无经济意义的无限搜索。
- **禁止** - 不反馈保护细节 不原地修改 不隐藏同族试验，也不拥有部署 资金 风险 订单 账户或外部效果权威。

## 后续实现验收

- 每个工件都能解析到唯一不可变意图 代码字节摘要 依赖来源 可复现构建 Market Semantics
  Compatibility 身份 sandbox policy capability manifest 和 Artifact Security Admission 身份。
- 每次探索运行都能解析到唯一稳定且由 R&D 拥有的请求身份；工件 数据范围 配置或模型变化必须创建后继请求。
- 每个探索结果都逐项重复并等于请求的 Artifact PIT 范围与 snapshot universe selection 与修订规则
  重放配置 Runtime 内核 模拟器 成本 滑点和容量身份；只有相等的 `TERMINAL_RESULT` 可被选择，
  其他处置只保留在 census。
- 每个 Candidate 绑定不可变穷尽 Census Frontier 和已消费预算；缺失 可变 不完整或冻结后分叉的 frontier 禁止交接。
- 每个 Candidate 交接都解析到唯一 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition，
  并交叉绑定冻结 Intent 证伪条件 Protected Robustness Plan 和用于决定的全部探索证据。终态停止没有 Selection 或 Candidate，
  不产生 Qualification intake，也不消耗保护 holdout。
- 每个 Research View 都解析到一个一致 Research 前沿和 valid-through 时间。它不包含保护测量 参数
  结果 holdout 消耗或可解引用保护证据引用。
- Research View 重放若更换 principal scope 或授权政策截面必须拒绝，不能沿用旧请求身份返回视图。
- 终态选择只在存在唯一准确 `READY_FOR_SELECTION` Iteration Decision 时成立；任何停止或修复状态与
  选择互斥且不创建 Candidate。
- 每个 Market Data Repair Request 都解析到匹配 PIT 证明与 Time Evidence 的关联 `AVAILABLE` 或
  `UNAVAILABLE` 终态。缺失 不匹配或仅传输响应保持未决且不创建后继 Intent。
- 每个 `UNAVAILABLE` 修复结果都解析到一个 `STOP_INPUT_UNAVAILABLE`，绑定前驱 `REPAIR_INPUTS`
  请求 结果 截面与 Time Evidence。准确重放加入该停止，含义变化必须使用后继身份。
- 每个 Runtime 或 Backtest native repair request 都绑定唯一准确类别 前驱 repair decision 稳定 correlation
  原始 proof digest 旧 native identity source cut policy 和新鲜 Time Evidence。只有匹配 `REPAIRED` 结果
  可以支持新请求相等 Replay Request；`UNAVAILABLE` 只通过关联停止闭合，`OUTCOME_UNKNOWN` 不创建
  Research 转换或重试。
- 每个后继实验决定都证明其身份等于冻结序数排名与 tie-break 下最高排名的可接纳选项。
- 每个下一动作都证明其 total-precedence 分支；迭代还必须证明有限比较集无碰撞。身份 摘要或完整
  key 重复时不产生决定。
- 每个 `STOP_LOW_INFORMATION_VALUE` 都绑定完整 candidate-set frontier expected 与 observed membership、
  每个成员的类型化 admissibility、预注册阈值及证明全部成员低于阈值的比较证据；membership 未知或
  不完整时不产生 Iteration Decision。
- 每个已选择 Candidate 携带结果前 Protected Robustness Plan；必需单元 覆盖 容差 阈值 聚合 缺失单元
  政策和执行身份都可检查，同时不向 Research 暴露保护细节。
- 实验契约的时间戳早于被评估结果的揭示时间。
- 保护 Qualification 结果不存在写回同一 Research Intent 或 Strategy Artifact 的路径。
- 每次迭代都创建新血缘节点并明确前序身份和改变的假设。
- `SINGLE_DIMENSION` 下每个后继只能改变一个影响决定的假设维度；`PREREGISTERED_FINITE_JOINT` 下只允许改变观察结果前冻结的有限命名组合，并绑定归因规则 预算 证伪与停止规则。其他同时改变机制 参数 经济模型与稳健性条件的组合都不构成可归因实验。
- 有界 Qualification 反馈后的后继必须保留完整跨 TrialFamily 祖先；Research 可声明独立性但不能自行获得新 holdout 预算。
- Research Intent 状态只有 `DRAFT_NOT_HANDOFFABLE` `FROZEN` `SUPERSEDED`；探索证据只能创建后继意图。
- 同一请求身份与含义并发或重启重放时加入同一回执；接受回执必须绑定唯一结果 Research Intent。
- 每个已接纳 D-only attempt 准确提交一个只写一次 D-only Repair Disposition。D0 证明没有 Artifact；
  `D1_BUILD_FAILED` 证明 Artifact 前的确定性 build package 或 security-admission 失败，且不创建 Artifact
  validation result 或 Candidate；D1 验证失败不创建 Candidate；`REJECTED_NOT_D_ONLY` 不创建 repair transition；`OUTCOME_UNKNOWN` 绑定
  最后权威 frontier 且不允许裸重试。只有 request admission attempt correlation 与含义全部匹配时，
  replay 才加入原 disposition。

## 可观测性与持久化

R&D 原生持久化 Source Provenance、Research Intent、假设 lineage、TrialFamily 成员、Iteration Decision、
Selection、Artifact build/admission、D-only repair attempt、validation 与 D-only Repair Disposition。已提交
转换与 outbox 同事务写入；intake、sandbox、build、等待 replay 和决策时延只发送有界
trace/log/metric。Dashboard 可以从这些身份推导使用来源、假设数、开发尝试、失败类别、迭代次数、
到选中 Artifact 的耗时与 D-only repair 历史，但不能替代原事实，也不能暴露原始 source body、
credential、prompt 或 Qualification 保护证据。
