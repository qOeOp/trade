# Strategy Factory

## 职责

Strategy Factory 是包围 R&D、探索性 Backtest 和独立 Qualification 的价值流边界。R&D 内含 Research 与 Develop 能力；该边界让 R D Q 分离清晰可见，但不成为新的 Owner。本页凡提到规范化、绑定、验证或 lowering 一个 Design 的执行者，指的都是 R&D 的 Develop 能力；边界本身不执行任何动作。

### 如何阅读本页

边界契约很短：职责、正向路径、价值流交接、保护路径、权威边界、实现验收。这几节说明 R&D、Backtest 与
Qualification 之间哪个 Owner 拥有哪项事实，以及哪些对象在它们之间跨越。

共享生命周期内核一节，以及其下的 Bounded Feature Program 一节，是编译器规格：类型化 Design 形状、fail-closed
流水线、已 pin 的 primitive catalog、图上界、ABI 与 build capsule。它们对实现编译器的人是规范性的，但理解价值流
并不需要它们。这些节里的执行者始终是 R&D 的 Develop 能力。

策略形状包络一节记录这些 Owner 与编译器要长成的、已准入的目标，以及用户授权它改动哪些已陈述的界。

## 正向路径

带来源假设只是一项提案。在任何保护反馈之前，R&D 先原子预提交一个绑定 principal 与 request scope 的 Independence Basis Receipt。Qualification 直接解析该准确 R&D 回执，并在检查其完整持久 principal/scope 历史后只返回 `GENESIS_EMPTY` 当前不透明 `FRONTIER(ref, cut)` 或 `UNAVAILABLE`；只有经证明 Qualification 历史为空时 genesis 才有效。Product Edge 仅搬运绑定同 principal/scope 的不透明投影，不接收保护细节。R&D 在锁定的准入事务内把自身完整本地语义前驱血缘解析为 `GENESIS_EMPTY` `COMPLETE_FRONTIER` 或 `UNAVAILABLE`。只有两个 Owner 的准确当前规范回读都成立时，才能原子创建冻结 Research Intent 永久 TrialFamily root 初始 census member 与 head 回执和 outbox。调用方不能提供或覆盖任一 frontier 独立性 disposition 或 basis identity。

Qualification 的 PostgreSQL custody 在物理上独立：`qualification_owner` 拥有其表与锁定准入函数，另一个 Qualification writer 执行投影写入。R&D role 对 Qualification 表没有 ownership、raw `SELECT` 或 DML。它只能在调用方 R&D 事务中执行固定安全 `search_path` 的 `SECURITY DEFINER` 准入函数；该函数使用全限定读取并保持锁顺序，只返回不可信 raw envelope。Qualification-owned Rust 必须把 envelope 与规范 R&D basis 和完整 Qualification 历史交叉验证后，才能构造密封且不可反序列化的正向 readback；不得公开 raw-envelope 正向构造器。

Replay Policy Catalog 与 durable Composer custody 采用相同的物理隔离。`rd_database_owner` 是仅负责
database/public schema 的 NOLOGIN custodian；`replay_policy_catalog_owner` 与 `composer_owner` 是分别拥有
private data/API schema 的 NOLOGIN object owner。`rd_owner` 没有 membership、ownership、schema `CREATE` 或
raw table 权限；它保留固定 lock/read API 以及恰好一项不可转授的 mutation `EXECUTE`，即 Composer 提交 routine
`commit_develop_composer_v2`/`v3`，使冻结的 Bounded Feature Program 能在一个 Owner 事务内被重读、锁定、绑定并提交。只有另行提供的
`replay_policy_catalog_admin_writer` LOGIN 获得 Catalog 管理 routine 的不可转授 `EXECUTE`；
`rd_fact_writer` 只保留 Composer commit 权限。所有 routine 都使用全限定关系、
`search_path=pg_catalog,pg_temp` 并运行在调用方既有事务中。fresh deployment 必须先在 `rd_owner` 仍拥有
`public` 时运行同一套有界 Rust schema materializer；完成后 custody migration 才能把 database/schema
移交给 `rd_database_owner` 并撤销 `rd_owner` 的 schema `CREATE`。随后必须完成显式、单次运行的
Catalog bootstrap 或准确解析，并验证其 canonical Owner readback，R&D API 才能开始 listen。runtime
startup 不得重新获得 schema lease 或编写 Catalog state；预物化 legacy table 缺失，或 bootstrap
readback 缺失、不匹配、未认证或尚未解析时，必须 fail closed。read 不创建 custody，cutover 保留
既有 OID、row 与 bytes。

TARGET Composer product entry 只携带规范 Research request locator。R&D 使用一笔 transaction 与
Owner-internal exact request/aggregate commit-cut lock，重读规范 Research custody，并派生完整 request、
Design、digest、binding、provider、Operator Authorization frontier 与 final-cut lineage。只读 GET projection
可以暴露发送前 request identity 以供 response-loss recovery，但 POST 不接收这些字段回灌。sealed A0 Build
Receipt 被规范化为一项 intrinsic content-addressed build fact；独立 ordered use relation 把每个 Artifact 绑定
到该 fact，因此两个 Research-derived Artifact 可以共享一个 build corpus，但不共享 Research 或 Artifact
custody。准确 legacy bytes 只允许一次 normalization；其他 schema shape 全部 fail closed。在隔离第一方
验收链及其 dual-custody、locator-negative、transaction-fault、concurrency、restart 与 cleanup gate 全部
通过前，该能力保持 `TARGET`，不构成 deployed 或 production maturity。

Qualification 投影构成一条按 principal/scope 绑定、只追加且无环的单链。某个准确且已验证的 Independence Basis 的最新投影若在 Qualification 提交或响应丢失后过期，只有 Qualification Owner 能在同一 principal/scope 锁下追加后继；该后继绑定准确 basis ref/digest、前驱投影 ref/digest、不变的规范 source sequence/cut/frontier、Owner clock epoch、新半开有效期、回执与 outbox，并原子推进 head。仍为 current 的投影必须按字节等价 join；调用方与 R&D 均不得自行续期。历史 R&D 终态 custody 继续绑定并暴露其实际消费的准确历史投影，而新的 S1 写入必须在最终锁定 cut 使用规范最新且仍 current 的投影。

R&D 内的 Develop 能力返回内容寻址 Strategy Artifact 和 Build Receipt，Research 能力再冻结一个 Exploratory Replay Request，绑定准确工件 数据范围 重放配置和模型身份后，独立 Backtest 服务才接收。探索事实只返回 R&D 并可形成后继 Intent。R&D 维护只追加 TrialFamily Census Frontier，且只有 R&D 能提交 Iteration Decision；终态停止不创建 Selection。只有 `READY_FOR_SELECTION` 决定才能产生仅选择 `SELECTED_FOR_QUALIFICATION` disposition 并提交 Qualification Candidate。

<a id="strategy-design-v2-shared-lifecycle-kernel"></a>

## StrategyDesignV2 与共享生命周期内核

这是把任意已接纳 Research 转换为可执行策略的顶层契约，不是第二个 Strategy Owner 或 runtime。唯一
正向形态是：

`Research Intent -> StrategyDesignV2 -> StrategyPlanV2 -> StrategyArtifactV2 package -> generic ProgramHostV2 ->`
`shared lifecycle kernel`。

成熟度边界必须明确：

- **CURRENT/PARTIAL：** V2 冻结下文所述的规范 Design/Plan 含义、内容寻址 package、有界 plugin ABI，
  以及通用 host/shared-kernel 执行边界。共享内核现已包含有界的"准确两个成员"Market Data universe
  纵向切片：一份完整 Owner-sealed frame 只调用一次 plugin、只返回一份按规范 instrument key 排序的 target
  set；只有完整集合校验成功后，host 才同时提交两个成员的生命周期状态和单一组合 checkpoint。一份
  non-default、零参数 sealed acceptance corpus 会执行真实 Market Data Owner issuance、准确 Plan 编译、单次
  guest 调用、member-causal target、malformed output 原子拒绝、replay 与 restore；这只属于有界 crate-local
  acceptance 证据。本地 bounded-plugin producer 接纳准确且 fail-closed 的 macOS arm64 host profile。
  Linux ARM64 与 x86_64 当前为 **REVALIDATION REQUIRED**：实现已冻结当前观测到的 canonical `wasm32v1-none`
  sysroot digest，但只有该 digest 在该主机上通过 main-bound hosted native gate 后才能达到 CURRENT/PARTIAL。此前的证据
  边界是准确 workflow
  [`strategy-factory-linux-a0`](https://github.com/qOeOp/trade/blob/9e5149d4293a800be3a35e6b747a9f3dba304e1f/.github/workflows/strategy-factory-linux-a0.yml)、
  head `9e5149d4293a800be3a35e6b747a9f3dba304e1f` 上的 `workflow_dispatch`
  [run 33250411708](https://github.com/qOeOp/trade/actions/runs/33250411708)，以及 job
  [`strategy factory A0 native gate (linux arm64)`](https://github.com/qOeOp/trade/actions/runs/33250411708/job/99095016988)
  已在 GitHub-hosted `ubuntu-22.04-arm` 成功，并绑定为 `github-hosted/Linux/ARM64/aarch64`。该历史 gate
  覆盖的是已被替换的 sysroot digest，不能作为新 freeze 的验收证据。该 gate 校验
  immutable CI input、Rust 1.97.1 Cargo/rustc 的准确 commit 与 host、唯一 `wasm32v1-none` target、pure-Rust
  canonical sysroot digest、确定性双构建/准确 replay，以及真实 build 进入唯一 Composer 与 `ProgramHostV2`
  consumer 路径；builder 在每次 build 前后重读准确 tool 与 canonical target sysroot。hosted job 成功不是
  R&D Owner 业务回执。当前不具备 kernel network confinement、持久化/已部署/Dashboard readiness、Paper、
  Live、deployed runtime 或生产成熟度；下述有界 Backtest
  target-set 切片是当前唯一的成员级 fill routing、account/equity 与 price conversion 证据。
  ComplexStrategy V1 只提供迁移/等价性 baseline。R&D 还可以冻结
  一个已完整绑定且消费 Owner-sealed PIT 的 pre-Artifact Develop Evaluation。该 evaluation 只是一项
  R&D 内部事实，不是 Strategy Artifact、Exploratory Replay Request 或 Result、Qualification 证据、
  Candidate 或可部署程序。
- **CURRENT/DYNAMIC，隔离 Backtest 首个纵向切片：** 一个确定性 stateful corpus 从两个 pre-admitted
  bound field 出发，经 `StrategyDesignV2`、确定性 `StrategyPlanV2`、`StrategyArtifactV2`、
  `ProgramHostV2` 与共享内核驱动真实 `BacktestEngine`/Sim Exchange consumer。它证明原生 partial/full
  order fill、cache/position 转换、`ENTER -> ADD -> REDUCE -> EXIT`、保护 replace/adjust/clear、不中断执行
  与 checkpoint restore 后缀相等，以及重复运行相等。这只是一项隔离动态 Backtest 证明，不代表 Paper、
  Live、生产 Owner readiness 或交易授权。
- **CURRENT/PARTIAL，隔离 multi-leg/multi-timeframe input join：** 第三组不可变 corpus 把 Research 声明的
  四个准确 role（两个 AAPL 1 分钟 field、一个 MSFT 1 小时 field、一个 QQQ 1 天 field）绑定到各自的
  compile-time-sealed Market Data Owner receipt。Market Data 在完整已验证 PIT/correction census 上执行
  latest-not-after argmax，并签发一份不透明 `StrategyInputJoinedCutReceiptV1`；Host 不再具有 frame-slice
  selection 路径。通用 `ProgramHostV2` 与共享内核经普通类型化 plugin 路径消费该完整 joined cut，保留
  regime state，并且每个 trigger 只产生一份原子 target intent。真实
  `BacktestEngine`/Sim Exchange consumer 证明确定性 join ordering、`ENTER -> ADD -> REDUCE`、原生 submit/fill、
  重复运行相等和 checkpoint/restore 后缀相等。缺失、过期、来自未来、不匹配、跨 Design/role 或 lineage
  冲突的 input 都在 guest、plugin state、lifecycle state、target 或 checkpoint 变更前被拒绝。这只是并行的
  complex-strategy substrate 与隔离 Backtest acceptance；不是默认 R&D 路径、产品 readiness、Paper、Live、
  生产 Owner readiness 或交易授权。**CURRENT/PARTIAL，仅 Native Replay preparation：** preparation seam
  现在还必须接收准确 Owner-sealed V1 joined-cut receipt 与 move-only V2 JOINED_CUT projection readback。
  在构造 ProgramHost handoff 前，它校验 EVENT lifecycle、准确 joined-cut subject digest、正且完整的
  component count，以及 projection role/binding set 与已编译 Plan 的严格相等。handoff 保留准确 projection
  digest/count，并在 promote 前重新校验绑定。这只是 fail-closed preparation 与 public consumer-shape
  evidence；它不执行 Native Replay，不启动 production resolver，不证明 dynamic PostgreSQL product
  composition 或 end-to-end 第一方验收，也不准入 trading。
- **CURRENT/DYNAMIC，有界准确双成员 Backtest target-set 纵向切片：** 一份完整 Owner-sealed universe
  frame 先在克隆的 `ProgramHostV2` 上 prepare，只产生一份规范 target set 与一次 plugin 调用；只有单份
  account-scoped `Portfolio::equity` 快照、两个准确 instrument fact、Decimal target conversion、成员
  reconciliation 与两份原生 order 全部校验成功后，才提交 host。该 equity 是 margin account 的 total balance
  加 unrealized PnL；venue account 缺失或不唯一、currency 多个或错误、任一 open position 无法定价时都会
  fail closed。支持范围仅限 linear、non-inverse、non-quanto，且 settlement
  与 quote currency 都等于正 equity currency 的 instrument。weight target 使用
  `trunc_toward_zero(equity * weight_micros / 1_000_000 / price / multiplier / size_increment)` 得到有符号 grid
  units；position target 本身已是有符号 grid units。两者都只能通过 adapter 封存的不透明 reconciliation
  capability；该 capability 绑定准确 prepared target-set、运行中 Host instance、account/equity snapshot、两份
  instrument fact 与 price、current position、公式及 derived target，crate peer 与 caller 都不能构造或修改其
  数值。随后以 grid units 乘 size increment 准确重建原生 quantity，
  且 instrument normalization 必须保持其不变。提交前的 host commit 与 order preflight 对整批原子；Sim
  Exchange submit 与 fill 按顺序发生，不具备 venue 原子性：后续 submit 失败会 fault 本次运行，并保留较早的
  原生 effect 与进程内 replay 证据。一个有界 test-only second-submit boundary fault 动态证明：Host commit 后
  第一份真实 submit 已成功且原生 cached order 被保留；这不代表 venue rollback 或 all-or-none submit。每个
  `ClientOrderId` 都绑定准确 instrument 与 host-derived intent；partial/
  full/canceled/rejected progress 只推进对应成员，保留独立 residual，并把该成员 protection quantity 同步到
  实际 filled quantity。真实 `BacktestEngine`/Sim Exchange acceptance corpus 使用不同 price、multiplier 与
  size grid，证明重复运行相等，以及不中断执行与同一运行中仅恢复不透明 Host checkpoint 的后缀相等。另一份
  real-Sim regression 使用 Owner-sealed 第一帧和 test-only admitted successor frame，先开仓并形成非零
  unrealized PnL，再证明下一 weight target 使用该 batch 的 account-scoped equity，而不是 cash balance；它
  不构成第二次 dynamic Owner issuance 证据。独立创建的等价 Host 或 restored Host 也会拒绝旧 prepared
  capability。它不证明 cold engine restart、venue atomicity、Paper、Live、provider/network、persistence、
  生产 readiness 或交易授权。
- **TARGET / IMPLEMENTATION_ADMITTED，单成员 Backtest target-set 纵向切片：** 上述纵向切片在保留双成员形态的同时，也准入准确含一个
  成员的 universe；准入单成员不改变任何双成员的行为或字节。用户于 2026-09-24 选定加密永续合约与单品种策略为首个产品范围时准入了这一点，
  原话为："我会把执行链的成员数从「恰好 2」放宽到支持 1 个，这是文档里写着的有界切片，放宽要改文档但不移除任何性质"。
  单品种策略是一份角色使用 `UniverseMembers` scope 的 Design，运行在单成员的 Owner-sealed universe 上；instrument 由
  Research request 指名，由 Market Data universe selection 在请求时求值，因此既不由 Design 也不由 R&D 选定（该请求
  范围由 R&D Owner 契约陈述）。角色为 `EXACT_INSTRUMENT` 的 Design 在 Owner
  universe 下仍被拒绝，由实现改动引入的具名拒绝 `ExactInstrumentRolesUnderOwnerUniverse` 给出。universe 纵向切片的输入契约（准确
  一个固定 `OPEN` 与一个固定 `CLOSE` member role）后来由 Design 声明的角色集取代（见下文 P1）；single-threshold 编写面新增 universe-member 形态，其 channel
  是该成员的日线收盘价，并以承载 input 的方式携带固定的 open role，其程序从不读取它。编写请求在必填的 `scope`
  中写明自己的形态，因此缺少它的请求被拒绝，而不是被当作 exact-instrument 形态读取。该形态只在成员序号 0 上消费每个 role，其 bounded feature program
  仍产出单品种 proposal：在单成员 universe 下，host 把该 proposal 提升为单成员规范 target set，因此该纵向切片仍只提交
  一份规范 target set，只是其产出者从插件移到了 host。在首个正例运行之前，single-threshold 报告族及其 data window
  所指的 instrument 扩展到该形态。target-set schema version 与语义 identity 均不变，准入单成员也不改变任何双成员原像：
  target-set codec 与 Instrument Master cut 本来就编码了成员数，而 V1 scheduling receipt digest 与 Strategy Factory
  中对成员做哈希时不带数量的 digest（Backtest target-set 快照、execution-profile binding、native materialization、
  execution census 与 round-trip closure digest）对其他成员数改用写明该数量的 domain，双成员的 domain 与字节保持不变。
  提升出的单成员 target set 取待处理 target set 之后的 sequence，没有待处理时取 1。
  在实现改动落地并更新上面的 CURRENT 陈述之前，这里的内容都不是 current。
- **TARGET / NOT_ADMITTED：** Paper 与 Live 只有在各自 Owner adapter 存在且被另行接纳后，才消费
  相同 plan、Artifact、事件排序、checkpoint schema、内核和语义 trace 契约。本文不声称当前已有
  Paper 或 Live 等价性、应用、外部写入或交易能力。
- **TARGET / NOT_ADMITTED - ARC Complex D Bounded Feature Program V1：** frozen Research 可提供下文定义的
  有界类型化 feature/state program。R&D 的 Develop 能力使用 first-party source 对该规范 program 做确定性
  lowering，生成一个现有 bounded plugin，随后只经过 `PluginManifestV2`、`StrategyPlanV2`、
  `StrategyArtifactV2`、`ProgramHostV2` 与共享生命周期内核。仓库当前没有 executable
  `BoundedFeatureProgramV1`、V3 producer 或持久 V3 readback。本契约不声称 executable D-loop、Native Replay、
  第一方验收、稳定盈利、Paper、Live、production 或 trading authority。

`StrategyDesignV2` 是类型化、版本化、内容寻址的描述，覆盖 input role、join、parameter、feature、
state、生命周期反应、portfolio target、保护政策和可选 custom-plugin 调用。它只能使用稳定 primitive
semantic ID，不能使用 renderer label、enum ordinal、生成类名或 raw order。`StrategyPlanV2` 是确定性
编译结果，绑定准确 Design 与 Intent、已解析 Owner input receipt、Market Semantics Compatibility 身份、
capability closure、primitive 与 plugin ABI 版本、资源上限、lifecycle/checkpoint schema 及规范 lowering digest。

编译器只有一条 fail-closed pipeline：

1. **Canonicalization** 校验 schema、有限集合与依赖上限、unit、scale、声明顺序、semantic ID、state
   topology 和生命周期覆盖，再输出 byte-stable Design 含义。
1. **Capability closure** 传递闭合每个被引用 primitive、lifecycle hook 和 plugin capability；未声明、
   未版本化、重复或成环 capability 一律拒绝。
1. **Binding** 通过事实 Owner 的类型化 sealed receipt 解析每个 Research 声明的 input role。receipt 绑定
   role、field semantics、instrument/universe、timeframe、PIT/live cut、unit 与 Market Semantics
   Compatibility 身份。caller 与 compiler 都不能通过启发式字符串映射、alias、名称相似度或到达顺序
   推断 Owner、instrument 或 field。
1. **Lowering** 为 `ProgramHostV2` 生成唯一规范 `StrategyPlanV2` 和内容寻址 `StrategyArtifactV2` package。
   相同输入必须产生字节完全相同的 plan、Artifact 与 binding digest。

**TARGET / NOT_ADMITTED，Market W3 持久 role-set attestation：** R&D Owner 必须在与 Composer aggregate、
receipt 和 outbox 相同的 positive Develop Composer transaction 中持久化一份不可变、完整的 Strategy Design
role-set attestation。该 attestation 绑定准确 Research
request、Composer aggregate 与 `StrategyDesignV2`、按规范顺序排列的每个 typed role 及 semantic coordinate、
完整 role coverage，以及其内容寻址准确 locator。它唯一的跨 Owner surface 是受数据库 ACL 保护、按准确 locator
读取的 R&D read function；不存在 public constructor、deserializer、bearer token、cryptographic-key authority、
latest/history scan 或 raw-table access。由于 locator 在发送前已知，response loss 只能通过解析同一 locator 并逐字节
校验同一份已提交 attestation 来恢复，绝不能铸造 replacement。

**TARGET / NOT_ADMITTED，密封 Replay request 前驱：** Market Data 选择任何 event 前，其
`market_data_owner` SERIALIZABLE transaction 只能把准确 request/meaning/receipt/seal locator 交给 R&D-owned
`lock_sealed_exploratory_replay_request_for_market_data_v1` 固定 facade。该 facade 与两个传递 verifier 均由
隔离的 `NOLOGIN` `rd_exploratory_replay_api_owner` 拥有；此
role 只能读取 canonical verifier chain 所需的九张 R&D relation，且没有任何 table-level 或 column-level
mutation privilege。Market principal 不获得 R&D raw relation
访问或 routine-owner membership。该 read 在 caller transaction 内保持 request-scoped transaction advisory
shared fence；它与 R&D writer-exclusive fence 配对，并由 SERIALIZABLE 提供稳定 read snapshot，且不授予 event
selector、binding、execution、deployment 或 trading authority。在隔离 PostgreSQL positive、drift、isolation 与
no-write gate 通过前，它保持 NOT_ADMITTED。

Market Data 的 positive Replay composition 只接受该不受信 attestation locator 与准确原生 dependency locator。
Market Data 在内部校验 R&D attestation，但在原子签发 `ReplayCompositionBindingV1` 前，仍必须独立重新解析自身的
持久 binding registry、完整 observation census、joined cut、sample projection、R0 与 Market Semantics fact。
caller 提供的 receipt、readback、role set、count、authoritative token 或 `StrategyPlanV2` 永远不是 positive
evidence。Market Data 不解析 R&D raw table，也不依赖 R&D；R&D 不能选择或重新解释任何 Market
fact。证据缺失、partial、stale、reordered、digest mismatch 或 cross-splice 时，binding、Replay V2 fact、receipt
与 outbox 均保持零写入。该设计保留上述唯一前向形态，既不增加新 Owner，也不增加第二个 canonicalization authority。

在 disposable PostgreSQL Owner readback 与最终 consumer path 证明 positive、rejection 和 response-loss case
之前，该 target 不声称 implementation、admitted store、deployed composition、production write、runtime 或
trading authority。

### TARGET - ARC Complex D Bounded Feature Program V1

`BoundedFeatureProgramV1`（BFP V1）是唯一接纳的通用 Complex D 表示。R&D/Develop 将其规范含义与 Research
Intent、`StrategyDesignV2` 一同冻结；R&D 的 Develop 能力负责验证与 lowering，但不能发明 Research 含义。
它唯一的前向路径是：

`Frozen Research -> canonical BoundedFeatureProgramV1 typed DAG -> deterministic first-party source lowering ->`
`versioned V3 build capsule/receipt -> existing PluginManifestV2/Composer/StrategyArtifactV2 ->`
`existing ProgramHostV2 -> shared lifecycle kernel -> Backtest`。

BFP 是 Design 所声明准确一个 bounded plugin 的 build input，不是 Host graph extension、Host feature opcode、
interpreter、runtime、strategy template、raw-order program 或新 Owner。LLM 或 caller 可以提出 Research 含义，
但不能创作 Rust、Wasm、dependency、ABI、公式实现、build command、clock、Owner receipt 或 executable
fallback。只有冻结的规范 BFP 能进入 first-party lowerer。lowerer 必须确定且 dependency-closed，只能从已 pin
SDK 与 primitive-kernel catalog 组装 source；不得接纳 caller source、package、build script、带 ambient input 的
macro、network、filesystem input、randomness、floating point 或未声明 import/export。尤其是 BFP 含义、
lowering、plugin state、wire value 和 acceptance 中任何 `f32` 或 `f64` value/operation 都不合法。

规范 BFP schema 必须绑定下列全部内容，并拒绝 unknown field 与 unknown semantic ID：

- schema 与 semantic version；准确 Research request、Research Intent、`StrategyDesignV2`、plugin semantic ID
  和规范 `PluginManifestV2` digest；
- 每个 input 的 Owner、fact type、role identity、timeframe、signed fixed-I128 unit 与 decimal scale、静态
  binding receipt digest，以及声明的 trigger 或 sample clock；
- primitive-catalog semantic version 与 content digest、first-party SDK/source digest、lifecycle-output
  semantic ID，以及按规范拓扑顺序排列的完整 typed DAG；
- node、edge、depth、port、constant、lag/rolling window、state cell/byte、source byte、Wasm byte、fuel、
  linear memory 与每 event invocation 的有限上限；
- 覆盖上述所有字段、全部 constant 与 frozen rounding mode 的 domain-separated 规范 bytes 与 digest。

node ID 与 port ID 都是唯一稳定 string；edge 只能引用更早的 typed output；每个 output 都必须被消费或声明为
terminal，每个 fan-out 都必须显式且有界，state 只有一个 writer 且声明初值。unreachable node、cycle、forward reference、duplicate
ID、implicit cast、implicit rescale、unit mismatch、unbounded window 或与 manifest 不一致的 bound 都在 source
generation 前成为 `UNSUPPORTED`。规范排序只使用 schema 定义的 byte key，不使用 source order、map
iteration、locale、platform、enum ordinal 或 caller-provided digest。对规范 bytes 再 canonicalize 必须字节一致。

每个声明的 input 都必须被读取。唯一的例外是程序列在 `carried_input_role_ids` 中的 input：Design 要求这个
role，而程序用不到它。承载 input 保留自己的 value port、coordinate port 与 binding，host 像传其他 input 一样传入它。
graph 读取承载 input，无论作为 value、作为 coordinate，还是作为 node 推进所依据的 clock，都以
`CarriedInputRead` 拒绝。既未读取也未列出的 input 仍被拒绝，因此豁免只来自这项声明。列表为空时不写入规范
bytes，没有承载 input 的程序保持原有 bytes。

对于每个 output rule 为 `AvailableFixedAndCoordinate` 的 catalog row，value 与其 provenance coordinate 构成
一个原子 pair。只有 value projection 可以被引用；引用它即为 graph closure 原子消费 coordinate sidecar。
两个 projection 必须始终具有相同 availability。value consumer 必须声明 `require_ready = true`，并且 pair 为
`WARMING` 时两个 projection 都不可读。coordinate 不得被独立引用，也不得进入 primitive input、strategy
state、lifecycle terminal 或 manifest output。

首个 primitive catalog 必须版本化并由 `vibe-indicators-kernel` 拥有。R&D 的 Develop 能力只引用每个 primitive
的 semantic ID 与已 pin catalog/source digest，不得复制、重新解释或独立实现公式。首个 catalog 至少包括：

- checked fixed-I128 add、subtract、multiply、divide、显式 rescale、compare 与 select，全部绑定 frozen
  rounding 与 overflow terminal；
- lag 与 rolling sum、mean、minimum、maximum；
- EMA、Wilder smoothing、true range、ATR 与 RSI；
- candle body、range、upper/lower wick 与 gap geometry；
- rolling swing high 与 low；
- `range_fraction(low, high, numerator, denominator)`：ratio 是冻结且约分后的 rational，denominator 为正，
  bounds 与 scale 显式，Fibonacci level 只能使用冻结的有理常量。

之后的版本只追加。版本 2 追加 fused rational，版本 3 追加定点平方根，版本 4 追加 trailing window 内距最大值与距
最小值的 bar 数（精确整数，相等极值中取最新的那个）以及 trailing window percent rank（最新样本的中位秩，最低为 0、
最高为 1，窗口至少为二，只做一次最终舍入）。

price-action rule 与 candlestick pattern 是这些 catalog primitive 的类型化组合，不是命名 strategy template、
opaque label、复制的公式或新 Host opcode。

#### 数值、指标与 availability 语义

BFP V1 fixed decimal 是带 `0..=38` base-10 scale 的 signed I128 coefficient；其数学值为
`coefficient * 10^-scale`。scale 是每个 port 与 state type 的组成部分。node 不得推断、对齐或静默改变
scale。add、subtract、compare、select 与 OHLC geometry 要求 input scale 相等；其他 scale 变化都必须是显式
rescale 或 node-declared output scale。唯一接纳的 rounding mode 是 `TowardZero` 与
`NearestTiesToEven`。每次 arithmetic/indicator update 都把所有十进制幂和 rational factor 纳入一个准确 signed
two's-complement I256 expression，然后只做一次最终 division/rounding，得到声明 output scale。intermediate
超过 I128 但能装入 I256 且舍入后能装入 I128 时合法。I256 overflow、divide by zero、invalid scale、在未声明
rounding mode 时丢弃非零 remainder，或最终 I128 overflow（包括 I128 `MIN / -1`）都返回命名终态
`NUMERIC_FAILURE_NO_STATE_CHANGE`。有一类运算经用户授权豁免：TARGET 的自然对数与指数 catalog 行（V4b）没有精确的
单次舍入形式，所以每一行改为钉住自己的算法与 golden 测试向量，豁免只覆盖这些新行。钉住的算法是该行身份的一部分，
改算法就是新的一行；它用 catalog 自己的定点运算写成，绝不调用宿主数学库，所以 guest 与宿主一致；定义域失败 - 对零
或负数取对数、指数上溢 - 仍然返回 `NUMERIC_FAILURE_NO_STATE_CHANGE`。豁免只覆盖「最后一次舍入」这一条，绝不覆盖失败
语义。

`NUMERIC_FAILURE_NO_STATE_CHANGE` 是 failure-atomic：input admission 可以被记录，但 primitive state、warm-up
counter、已存 sample coordinate、plugin/BFP/kernel state、lifecycle output、target/protection、semantic trace 与
checkpoint bytes 必须和 event 前逐字节相同。执行前发现的 validation failure 仍是 `UNSUPPORTED`，且不生成
Artifact。合法 warm-up event 不是 numeric failure：它推进已声明 state，并暴露没有可读 value 的类型化
`WARMING` availability。下游 node 不能读取 `WARMING` value；warm-up 期间的 lifecycle output 必须由 Design
把 availability 显式 wiring 到现有 `HOLD` semantic。每个成功的 ABI 3 output frame 都必须在第一个 manifest
output value 之前紧接一个规范 availability byte：`0 = READY`、`1 = WARMING`；其他值均为 unsupported。
该 tag 纳入规范 frame length 与 identity，不能从 lifecycle value 或 post-state 推断。每次 ABI 3 BFP
warm-up invocation 仍必须返回一份按 manifest 顺序排列的完整 output frame：position intent 是
`kernel.position.hold.v1`，target variant 是
`kernel.target.keep.v1`，protection variant 是 `kernel.protection.keep.v1`；在这两个 Keep variant 下被忽略的
八个 scalar field-target position units、target weight micros、rebalance sequence、reconciliation target
units、stop-loss ticks、take-profit ticks、trailing-distance ticks 与 trailing-stop ticks-必须是各自准确宽度的
规范零值。post-state 是本次已接纳 coordinate 推进所有适用 primitive 与 BFP state cell 后的规范 state。对于
绑定 BFP V1 的 ABI 3 manifest，`ProgramHostV2` 必须在提交 scratch bundle 前复核 `WARMING` tag、三个
lifecycle value、八个 scalar 零值与规范 post-state；tag 缺失或矛盾、非零 ignored scalar 或不完整 warm-up
frame 必须 fail closed。`READY` frame 即使返回 `HOLD`/Keep/Keep，也绝不能作为 warm-up 证据。该规则不重新
解释既有 ABI 2 output byte 与 Host semantic。

以下 V1 定义为规范语义：

- `lag(offset)` 要求 `offset` 属于 `1..=declared_max_lag`，返回当前 coordinate 之前准确 `offset` 次 advance 的
  value 与 Owner sample coordinate，并首次成为 `READY` 于 sample `offset + 1`。
- rolling sum、mean、minimum、maximum 与 rolling swing 要求正 window。它们保持 `WARMING`，直到准确
  `window` 个不同 update-clock sample 已接纳；此时状态为 `READY`，对应 sample `window`。mean 使用一次
  I256 sum 除以 `window`，按 node rounding mode 只舍入一次；V1 不接纳 partial-window result。
- period `p > 0` 的 EMA 在首个 sample 即 `READY` 并以该准确 sample 为 seed；之后把
  `previous + (2 / (p + 1)) * (sample - previous)` 作为一个 wide expression，只做一次最终舍入。
- period `p > 0` 的 Wilder smoothing 在首个 sample 即 `READY` 并以该准确 sample 为 seed；之后把
  `previous + (1 / p) * (sample - previous)` 作为一个 wide expression，只做一次最终舍入。
- true range 先校验 OHLC。首个 sample 为 `high - low`；之后为
  `max(high - low, abs(high - previous_close), abs(low - previous_close))`。ATR V1 只能是该 true-range series
  经过前述 first-sample-seeded Wilder update 的结果；configurable SMA ATR 不属于 V1。
- period `p > 0` 的 RSI 先保存 previous close，再准确累计 `p` 个 delta 的 gain/loss。它的首次 `READY` output
  是 sample `p + 1`，使用这 `p` 个 gain 与这 `p` 个 loss 的 arithmetic mean；后续 average gain/loss 使用前述 Wilder
  update。output 是 node-declared scale 上 `[0, 100]` 的 dimensionless value。average gain/loss 同时为零时准确
  为 `50`；gain 为正且 loss 为零时准确为 `100`；gain 为零且 loss 为正时准确为 `0`；其他情况按
  `100 * gain / (gain + loss)` 只做一次最终舍入。
- candle body 为 `abs(close - open)`，range 为 `high - low`，upper wick 为
  `high - max(open, close)`，lower wick 为 `min(open, close) - low`，gap 是 signed
  `open - previous_close`。只有 gap 在首个 sample 为 `WARMING`。scale mismatch 或违反
  `low <= min(open, close) <= max(open, close) <= high` 时，必须在任何 geometry 或 previous-close state 推进前
  返回 no-state-change terminal。
- rolling swing high 是声明完整 trailing window 内的 maximum high，rolling swing low 是 minimum low。每个
  output 同时包含获胜 value 与其完整 Owner sample coordinate；extremum 相等时选择 Owner order 中最新的
  coordinate。它是 trailing-window extremum，不是 future-looking confirmed pivot。
- `range_fraction(low, high, numerator, denominator)` 要求 low/high scale 相等、`low <= high`、rational 已
  约分、numerator/denominator 编码为规范 unsigned 32-bit、denominator 为正且
  `0 <= numerator <= denominator`。它把
  `low + (high - low) * numerator / denominator` 作为一个 I256 expression，在声明 output scale 只做一次
  最终舍入。闭区间之外的 ratio 在 V1 中 unavailable，不得 clamp 或 extension。

warm-up count、period/window/lag value、ring index 与 add count 是规范 unsigned 32-bit field；Owner sequence
是规范 unsigned 64-bit field；numeric coefficient 是规范 signed 128-bit field；scale 与 rounding tag 是规范
unsigned 8-bit field；保存的 Owner coordinate 使用 `StrategyInputSampleCoordinateV1` 的准确 fixed-width
canonical field。所有 integer 在规范 state bytes 中使用 little-endian。Rust layout、`usize`、pointer width、
platform alignment、map order 与 JSON number parsing 均无 authority。

primitive catalog 原子发布整个 family。下列清单是封闭的 V1 namespace，共准确 57 行：

- Numeric policy：`bfp.numeric.fixed-i128.max-scale-38.explicit-rescale.i256-single-round.v1`、
  `bfp.round.toward-zero.v1`、`bfp.round.nearest-ties-to-even.v1` 与
  `bfp.numeric.failure.no-state-change.v1`。
- Add：`bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`。
- Subtract：`bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`。
- Multiply：`bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`。
- Divide：`bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`。
- Rescale：`bfp.fixed-i128.rescale.max-scale-38.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.rescale.max-scale-38.i256-single-round.nearest-ties-to-even.v1`。
- Compare/select：`bfp.fixed-i128.compare.equal-scale.v1` 与 `bfp.fixed-i128.select.equal-scale.v1`。
- Availability/state：`bfp.availability.warming-ready.v1`、`bfp.state.post.fixed-canonical.v1` 与
  `bfp.lag.coordinate.offset.full-history.v1`。
- Rolling：`bfp.rolling.sum.full-window.v1`、`bfp.rolling.mean.full-window.toward-zero.v1`、
  `bfp.rolling.mean.full-window.nearest-ties-to-even.v1`、`bfp.rolling.min.full-window.v1` 与
  `bfp.rolling.max.full-window.v1`。
- EMA：`bfp.ema.first-sample.alpha-2-over-period-plus-1.toward-zero.v1` 与
  `bfp.ema.first-sample.alpha-2-over-period-plus-1.nearest-ties-to-even.v1`。
- Wilder：`bfp.wilder.first-sample.alpha-1-over-period.toward-zero.v1` 与
  `bfp.wilder.first-sample.alpha-1-over-period.nearest-ties-to-even.v1`。
- TR/ATR：`bfp.true-range.ohlc.first-high-low.v1`、
  `bfp.atr.true-range.wilder-first-sample.toward-zero.v1` 与
  `bfp.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1`。
- RSI：`bfp.rsi.period-deltas.wilder.flat-50.toward-zero.v1` 与
  `bfp.rsi.period-deltas.wilder.flat-50.nearest-ties-to-even.v1`。
- Candle：`bfp.candle.body-magnitude.ohlc-validated.v1`、`bfp.candle.range.ohlc-validated.v1`、
  `bfp.candle.upper-wick.ohlc-validated.v1`、`bfp.candle.lower-wick.ohlc-validated.v1` 与
  `bfp.candle.gap-signed.previous-close.ohlc-validated.v1`。
- Swing：`bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1` 与
  `bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1`。
- Range fraction：`bfp.range-fraction.closed-unit-rational.toward-zero.v1` 与
  `bfp.range-fraction.closed-unit-rational.nearest-ties-to-even.v1`。
- Kernel output reference：`kernel.position.enter.v1`、`kernel.position.add.v1`、
  `kernel.position.reduce.v1`、`kernel.position.exit.v1`、`kernel.position.hold.v1`、
  `kernel.target.keep.v1`、`kernel.target.position.v1`、`kernel.target.weight.v1`、
  `kernel.target.rebalance.v1`、`kernel.protection.keep.v1`、`kernel.protection.clear.v1`、
  `kernel.protection.replace.v1`、`kernel.protection.stop-loss.v1`、`kernel.protection.take-profit.v1` 与
  `kernel.protection.trailing-adjust.v1`。

其他 primitive、alias、optional subset 或 extension 都不属于 catalog V1。每一行都在规范 catalog bytes 中
绑定其准确 formula、type/unit/scale contract、适用的 rounding ID、availability/update-clock rule、state
encoding 与 required golden-vector identity。缺失或增加任一行、formula、semantic ID、golden vector 或
failure oracle 都使整个 V1 catalog digest unavailable；R&D 的 Develop 能力必须拒绝 BFP，不能发布或替换为
partial toy catalog。

<a id="catalog-versioning-and-frozen-program-readback"></a>

##### Catalog 版本化与冻结程序读回

Catalog 按 semantic version 分版本发布，而不是一次性发布。版本 `N` 固定一个封闭行集及其 formula、rounding
ID、availability rule、state encoding 与 required golden-vector identity。在该版本内上述封闭陈述是精确的：
缺失或增加任一行、formula、semantic ID、golden vector 或 failure oracle 都使版本 `N` unavailable。

两个 identity 相互独立，任何一个都不能替代另一个。

- 版本 `N` 的 **semantic digest** 是对 version-semantic domain、版本号、该版本规范行集与该版本规范 goldens 的
  SHA-256。它绑定含义而非代码，因此在 kernel 实现变动时保持稳定。
- **kernel implementation identity** 是对准确编译 kernel 源文件集的 SHA-256。它标识一次构建，任何 kernel
  源字节改动都会使其改变，它是证据而不是准入闸门。

冻结的 `BoundedFeatureProgramV1` 声明自己的 catalog semantic version 与该版本的 semantic digest。准入解析所
声明的版本，拒绝未发布的版本，拒绝不等于该版本 semantic digest 的 digest。它绝不把声明与恰好最新的那个版本
比较。

读回在版本 `N` 下冻结的程序，要求运行中的 kernel 在解析该程序之前逐字节复现版本 `N` 的每一个 required golden
vector。使较早冻结程序保持诚实的是这项证明，而不是 kernel implementation identity。保持版本 `N` 语义的实现变
动使冻结继续可读；不保持的实现变动在这些 goldens 上失败，使冻结 unavailable，而不是在改变后的语义下静默重新
求值已提交的 Research 含义。

发布版本 `N+1` 既不改变也不作废版本 `N`。被退役的 primitive 离开 `N+1` 的行集，而版本 `N` 只要仍有冻结程序声
明它，就保留其行集与 goldens 处于编译状态；因此退役把一个 primitive 从新程序中移除，而不重写已提交的 Research
含义。

这是一次有意的取舍。冻结不再钉死产出它的准确 kernel 二进制，其强度恰好等于该版本 golden 语料的覆盖度，而上
文逐 primitive 的穷举要求已经固定了这一覆盖度。

<a id="declared-expressions-and-what-bounds-them"></a>

##### 声明的表达式，以及什么在约束它

指标不必是 primitive。版本 2 发布一个 fused rational primitive，它的参数是一个声明的表达式：在该节点的两个输入
与整数常量之上的分子程序与分母程序，全程在 I256 中求值，只做一次最终舍入。Wilder 更新、初始均值与 RSI 收盘是同
一个形状配不同的程序，因此它们可以是库片段而不是 catalog row，而这样的组合逐系数复现现货 primitive 的值。

这种精确性是由分别舍入的节点组合而成的写法达不到的。每个节点输出都是已舍入的 `FixedI128`，所以用分立算术节点组
合 Wilder 会舍入三次，而 primitive 只舍一次。把指标逼进 catalog 的是精确性而不是表达力，而声明的表达式把它还
了回来。

把指标移出 catalog 就是把它移进程序，于是 bound 也跟着移。**Description bound** 约束一个程序被写得多长：node、
edge、port、input、constant、decision branch 与 fan-out。**Resource bound** 约束它做多少事：fuel、state byte、
linear memory、每事件调用次数、window 与 lag。组合改变前者而不改变后者，所以只有前者被重新标定，并且依据的是准
入成本对程序规模的实测而不是猜测。Depth 保持原值：它才是有意义的结构上限，而并排放置的指标并不增加它。

每个 golden 都是规范 `BoundedFeatureGoldenVectorV1` binary bytes：magic `BFGV` `[u8; 4]`、schema
`u16 = 1`、reserved-zero `u16`、ASCII vector semantic ID 与 primitive semantic ID（各自编码为
`u16 length || bytes`）、rounding tag `u8`（`0 = none`、`1 = TowardZero`、
`2 = NearestTiesToEven`）、terminal tag `u8`（`0 = READY`、`1 = WARMING`、
`2 = NUMERIC_FAILURE_NO_STATE_CHANGE`、`3 = UNSUPPORTED`），随后依次为 pre-state、规范 input frame、
expected output 与 post-state 四个 `u32 length || bytes` field。integer 使用 little-endian，string 必须为
non-empty ASCII，reserved byte 与 trailing byte 被禁止，重新编码必须逐字节相同。vector identity 是
`bfp.golden-vector.v1\0 || canonical bytes` 的 SHA-256。catalog 按 vector semantic-ID bytes 排序完整 vector，
拒绝 duplicate，并把各 vector 的 `u32 length || canonical bytes` 拼接后纳入自身 digest。

对于上述 Add 至 Range fraction 各 family 的每个 executable primitive ID，V1 准确要求一个
`bfp.golden.primitive.<primitive-id-without-bfp-prefix>.success.v1` vector；semantic ID 已经冻结 rounding
选择，规范 node argument 与 expected readiness 则位于 vector bytes 中。Numeric policy ID 与 kernel-output
reference ID 不 mint primitive success vector。额外的封闭 cross-cutting vector-ID set 是这里明确命名的
Cartesian product：rounding mode token `toward-zero|nearest-ties-to-even`、sign token
`positive|negative` 与 quotient token `even|odd`，套入
`bfp.golden.round.<rounding>.<sign>.<quotient>-half.v1`；frontier token
`before-ready|first-ready` 与每个 family token
`lag-offset-2|rolling-sum-window-3|rolling-mean-window-3|rolling-min-window-3|rolling-max-window-3|swing-high-window-3|swing-low-window-3|rsi-period-3`，
套入 `bfp.golden.warm-up.<family>.<frontier>.v1`；以及 literal ID
`bfp.golden.ema-period-3.first-ready.v1`、`bfp.golden.wilder-period-3.first-ready.v1`、
`bfp.golden.atr-period-3.first-ready.v1`、`bfp.golden.gap.before-ready.v1`、
`bfp.golden.gap.first-ready.v1`、`bfp.golden.rsi.flat-50.v1`、
`bfp.golden.rsi.zero-loss-100.v1`、`bfp.golden.rsi.zero-gain-0.v1`、
`bfp.golden.true-range.first.v1`、`bfp.golden.true-range.previous-close.v1`、
`bfp.golden.numeric.i256-overflow.state-byte-identity.v1`、
`bfp.golden.numeric.divide-by-zero.state-byte-identity.v1`、
`bfp.golden.numeric.invalid-scale.state-byte-identity.v1`、
`bfp.golden.numeric.remainder-without-rounding.state-byte-identity.v1`、
`bfp.golden.numeric.final-i128-overflow.state-byte-identity.v1`、
`bfp.golden.numeric.min-div-negative-one.state-byte-identity.v1`、
`bfp.golden.numeric.scale-mismatch.state-byte-identity.v1`、
`bfp.golden.ohlc.ordering-violation.state-byte-identity.v1`、
`bfp.golden.swing-high.latest-coordinate-tie.v1`、
`bfp.golden.swing-low.latest-coordinate-tie.v1`、`bfp.golden.sample.same-no-advance.v1`、
`bfp.golden.sample.equal-value-new-advance.v1`、`bfp.golden.numeric.wide-fit-after-scale.v1`、
`bfp.golden.range-fraction.denominator-zero.v1`、
`bfp.golden.range-fraction.non-reduced-rational.v1`、`bfp.golden.range-fraction.above-one.v1` 与
`bfp.golden.range-fraction.low-above-high.v1`。发布时有限 token set 展开成 literal ID；brace、token 或
generator text 都不进入 catalog bytes。这些 literal state-byte-identity ID 穷尽 primitive numeric 与 OHLC
failure golden。coordinate/receipt、ABI、build 与 resource rejection 位于 primitive evaluation 之外，是下文
required corpus oracle，而不是额外 catalog golden。

每个 stateful primitive 准确声明一个 update coordinate：reaction trigger clock，或一个命名 input 的 sample
clock。BFP 还声明有界的 holding status、add count、high-water mark、protection state 等策略 state，并且只能
生成 manifest-typed post-state、现有 `PositionIntentV1`、`TargetVariantV1`、`ProtectionVariantV1`、target 与
protection field。Host 校验这些 bytes、封存 proposal identity/order，再把 proposal 交给共享生命周期内核。
只有内核解释 `ENTER`、`ADD`、`REDUCE`、`EXIT`、`HOLD`、target position/weight、stop-loss、take-profit、
trailing protection 与 fill reconciliation。BFP/plugin 绝不能输出 order、`Action::Submit`、Risk permit、
Execution request 或 external effect。

动态 lifecycle 选择只能通过规范 BFP 含义中的一个有界 whole-proposal decision table 表达。该表包含有限的
branch，各 branch 具有唯一显式 priority，并且必须有一个 default。每个 priority 都是规范 little-endian
`u16`；数值越小优先级越高，branch 按 priority 升序 canonicalize，caller collection order 没有 authority。
`max_decision_branches` 是非零 `u16`，不得超过 64，并约束 branch 数量。`READY` invocation 按该顺序求值
predicate，选择第一个为 true 的 branch；没有 predicate 为 true 时选择 default。每个 branch 与 default 都
原子提供完整 lifecycle terminal tuple：position action、target variant 及全部 target scalar、
protection variant 及全部 protection scalar，以及其他所有 required scalar output。field 可以引用类型相容的
DAG value 或规范 constant，但任何 branch 都不能省略、继承或合并 field。duplicate priority、default 缺失、
tuple 不完整、选出多个 proposal，或 ordering 无法确定唯一 whole proposal 的 encoding，都必须在执行前成为
`UNSUPPORTED`。唯一 first match 之后的其他 true predicate 不产生额外 proposal。`WARMING` 绕过该表，使用
上文完整的 HOLD/Keep/Keep/zero-scalar frame。

所有声明的 primitive 与 strategy state cell 共用一个规范 plugin-state bundle。空 pre-state 是唯一初始化
encoding，表示每个 cell 的声明 initial value。每次成功或 `WARMING` invocation 后，post-state 准确等于所有
cell 完整规范 bytes 的拼接；cell 按 `state_id` bytes 的 lexical order 排列，不能有 gap、alignment byte 或
padding。primitive cell 使用该 primitive 既有的规范 state bytes。strategy-defined writable slot 具有一个
声明 fixed width，其 declared maximum 必须准确等于该 width，并且只有 owning node 可以写入。对于非空 cell
set，即使某个 cell 未改变，每份 post-state 也必须包含完整拼接宽度；非初始化 pre-state 必须具有相同的准确
总宽度。total size 错误、boundary 截断或重叠、undeclared byte、padding、variable-width strategy slot 或其他
非规范 cell boundary，都必须在执行前成为 `UNSUPPORTED`，且不推进任何 state。

#### Sample-coordinate 契约

数值相等不代表 sample identity。BFP V1 可以执行之前，Market Data 必须为每个已接纳 event 或 joined cut
component 提供 dependency-neutral、Owner-sealed `StrategyInputSampleCoordinateV1`。其 canonical bytes 按以下
顺序准确为 308 bytes：schema `u16 = 1`、reserved-zero `u16`、input role identity `[u8; 32]`、timeframe
identity `[u8; 32]`、Owner event identity `[u8; 16]`、sample identity `[u8; 32]`、logical time `u64`、
event-effective time `u64`、Owner sequence `u64`、static binding receipt digest `[u8; 32]`、dynamic
canonical-row digest `[u8; 32]`、Source Binding lineage root `[u8; 32]`、lineage version `u64`、Market
Semantics identity `[u8; 32]` 与 stable Owner sample-receipt digest `[u8; 32]`。integer 使用 little-endian；
reserved 或 trailing byte 被禁止。coordinate digest 是
`strategy.input.sample-coordinate.v1\0 || canonical bytes` 的 SHA-256。Market Data event/joined-cut receipt
cross-bind 该 digest；coordinate 不包含 enclosing trigger receipt，因此被后续 trigger 携带的同一个 component
sample 保持逐字节相同。此处的 `Owner event identity` 是 Market Data 定义的 role-independent native
sample-event identity，不是绑定 Design、role 与 static binding 的 V1 frame-trigger event identity。

这些保持不变的 308 bytes 的 Owner-native 来源是新增的 Market Data `SampleFactV1` 与 trigger-independent
`SampleReceiptV1` 合同。`TimeframeSpecV1` 在 `market-data.timeframe.identity.v1` 下把 kind/step/unit 与
anchor、calendar、session、time-zone、label、partial-bar identity/rule 一起绑定；`1d` 是
exchange-session day，绝不是 UTC-duration day。
`SampleFactV1` 绑定 series/slot 与 predecessor topology、source snapshot/fact/batch、instrument/channel/
data-kind/field meaning/timeframe、Owner event/sequence、logical time 以及四个 event-effective/provider-available/
retrieval/correction-publication clock、准确 value semantic/bytes/scale、canonical-row digest，以及
binding/lineage/frontier/master/universe/Market Semantics/correction evidence。
`fact_digest = SHA-256(market-data.sample-fact.v1\0 || fact_bytes)`，且
`sample_identity = SHA-256(market-data.sample.identity.v1\0 || fact_digest)`；两者不同于既有 BLAKE3 row
digest。

未改变的 V1 binding timeframe string 不授权该 identity。只有 Market Data 能提供以准确 V1
binding-receipt digest 为键的 immutable `TimeframeProjectionReceiptV1`，其中携带完整 spec bytes/identity
及其 Owner evidence identity。projection 缺失、冲突、不唯一或由 caller 解析时，都必须在 coordinate 构造
前失败；后续 calendar/mapping 改变不能修改 historical readback。

`SampleReceiptV1` 携带准确 role-independent Owner fact projection。其 domain-separated SHA-256 stable digest
提供既有 sample-receipt-digest 字段；fact identity 与 receipt digest 均不依赖 trigger、frame、join、
consumer、Design、role 或 static binding。新增 `StrategyInputFrameEvidenceIdentityV2` 在不改变 V1 的前提下，
以 additive 方式标识穷尽且有序的 V1 trigger/value evidence。`StrategyInputSampleProjectionReceiptV2` 是唯一
V2 frame/join envelope；其闭集 `FRAME|JOINED_CUT` kind、FRAME evidence identity 或准确 V1 JOINED_CUT
receipt digest 与按 role 严格排序的 fixed entry，把每份未改变的 V1
binding/frame-evidence/trigger/value receipt 与其 timeframe-projection receipt、native sample receipt 和准确
308-byte coordinate cross-bind。不存在独立 V2 event/value/frame/join codec。envelope 把 role-bound V1 trigger
identity 与 role-independent native event identity 分开。ProgramHostV2 与 Backtest 只能接收该准确 V2
projection 及其引用的原生历史 receipt，不能从 value、row digest、frame/event digest、
trigger time、latest head 或本地 timeframe 解释派生或修复任何一个。restart 必须为同一 identity 解析出
相同 native receipt bytes，并为同一 role/binding 解析出相同 coordinate bytes。

**CURRENT/PARTIAL：** 保留的 JOINED_CUT slice 已为 EVENT component 实现该 V2 结构 projection 与准确 digest
readback shape；Native Replay preparation 仅在同时持有准确 V1 joined-cut receipt 和完整 Plan binding set 时消费
它。这不会使未来 BFP coordinate port 可执行，也不证明 Native Replay run、production startup、durable product
composition 或 Backtest 闭合。

**CURRENT/PARTIAL，请求绑定的 Native Replay execution input：** R&D Owner 为一份准确、已密封的
Exploratory Replay request 签发并持久化唯一、不可变的 `NativeReplayExecutionInputBindingV1`。R&D 的 Develop 能力拥有纯结构 validator 与 preparation boundary；它没有独立 storage authority，也不能铸造、替换或
重新解释任何 constituent Owner fact。该 binding 是跨 Owner composition locator，不是 market、instrument、
schedule、universe 或 economic truth 的新来源。

Canonical binding 交叉绑定 R&D request、TrialFamily、Artifact、Strategy Plan、Replay execution-profile seal，
并按 Owner-sealed universe selection 固定的规范双成员顺序准确绑定以下 constituent：一份准确 Market Data
V2 public Instrument Master cut/readback，其中包含两份 public fact；两份准确 Instrument Owner
`InstrumentEconomicTermsFactV1` receipt/readback locator；一份准确双成员
`StrategyInputUniverseFrameReceipt`；以及两份准确 Market Data BAR schedule cut/receipt readback locator。
每个 member entry 重复 canonical member key、public instrument identity/digest、venue、account scope、schedule
identity，以及证明相等所需的每个 constituent locator/digest。Binding 持久化 locator 与 digest，move-only
typed readback 保留其原 Owner authority；它不会把 private economic term 复制进 Market Data，也不会把
universe/schedule receipt 变成 Instrument Master truth。

R&D 提交 binding 前，R&D 的 Develop 能力必须消费全部 exact-locator Owner readback，并证明：准确两个不同
member 且没有 extra；universe member 顺序与 identity 等于 Plan；每份 public fact 等于对应 Instrument
Economic Terms 的 public-fact reference；venue、account scope、currency、半开 validity 与 event time 均符合
Replay profile；每个 member 的 BAR timeframe 等于其准确 schedule readback。随后 R&D 在已经密封的 request
下原子持久化 canonical binding、deterministic receipt 与 outbox。按准确 request/binding locator 的 replay
或 response-loss recovery 以零 append 返回相同 bytes。任一 missing、duplicate、reordered、latest-selected、
caller-reconstructed、V1-to-V2-synthesized、cross-request、cross-member、cross-venue、stale、tampered 或
ACL-drifted constituent 都必须在 binding、ProgramHost、Backtest 或 result state 改变前失败。

初始组合 adapter 只从已封存值派生 Market Data request。它消费 Replay PIT snapshot identity/digest 与 window、
Plan 的完整 universe-role declaration 与 selection projection，以及规范 Master V2 member。它只映射闭集 Market
Data semantic/channel/unit registry，保留 Plan 的 role identity、timeframe 与 scale，再把该有界 request 交给固定
Owner resolver。返回的 universe frame 与两份 schedule readback 必须等于 Plan selection 与 Master V2 member
order，才可进入 R&D binding issuer。该路径没有 caller 提供的 schedule locator 或通用 Owner-input map。

Native Replay preparation 与 Backtest 只能消费 R&D Owner 的 move-only binding readback，并在 native
materialization 前独立重新解析每个嵌入的准确 Owner locator。Caller 只能提交 sealed Replay request locator；
不能提交 constituent list、fact、value、symbol、order、resolver、store 或 fallback。当前切面已经实现不可变
PostgreSQL ledger、exact-locator recovery、typed Owner-readback validator、binding/receipt/outbox 的原子签发，
以及固定的初始 universe/schedule resolution bridge。Authenticated R&D service 只接受完整 sealed Replay
locator：签发操作首先让 Market Data 以该 request 为 key，在其 sealed V3 记录所指 composition binding 已绑定的
Universe Selection 上签发 Instrument Master V2 cut；没有这份记录的 request 按名拒绝，而不是自行选择 binding。
该签发在 Market Data 自己的 transaction 中提交，因此其后 R&D 一步失败时，重试会复用这份 cut。随后签发操作解析
sealed preparation、Composer Plan 与 Artifact、请求绑定的 Instrument Master V2 cut、每个成员一份同账户 economic terms fact、
universe frame 和每个成员一份 BAR schedule，再通过一笔 R&D transaction 提交 binding；
读取操作只返回已签发 binding 的 projection。独立 consumer composition 会先读取该 durable binding，再重新
解析准确 Composer、Instrument Master V2、economic、universe 与 schedule input，逐字节复现持久 binding 后才
materialize 现有 native execution bundle。现有 sealed production R&D resolver 会在一笔
repeatable-read R&D transaction 内完成该重建，派生绑定 attempt 的 runtime identity，并向 Backtest 交付
move-only bundle 与按固定顺序排列的完整 28-component observation package。Research、TrialFamily 与 Replay
authority bytes 来自 R&D source record；Design、Plan 与 Artifact bytes 来自已接受的 Composer custody；其余
resolved-input evidence 来自独立逐字节复现的 durable binding。现有 Backtest preparation Owner 直接接受该
sealed resolver，并在进入 ProgramHost 前再次校验 request、component 与 execution locator。这次 materialize 经
Market Data V1 native scheduling seal 封存每一帧，该 seal 现在从帧自己的报价 cut 取 Quote，不再从 BAR 那份只有
一个时刻的 batch 中取；目前还没有证明在 Owner 托管数据上把这次 materialize 驱动到完成。

**IMPLEMENTATION_ADMITTED / NOT_CUT_OVER，生产 Native Replay 入口：** authenticated R&D API 的
`POST /v2/exploratory-replays` 被准入为生产 route；body 只含准确 sealed request locator 与 attempt identity。
它尚未切换。handler、它调用的 execution service 与 router 注册在生产 feature `native-replay-execution` 下
编译，它不带任何验收代码，部署镜像不开启它，所以今天没有任何已部署镜像提供该 route，验收之外也从未有请求到达过它。execution service 对 Composer
的需要已经是无门的生产代码：它的 sealed read port 由生产 Composer
`PostgresSourceResearchComposerProductionV2` 实现，而这个 Composer 的 final-evidence port
`LockedOwnerEvidenceV2` 对给定的 locator 锁定并重读证据；不存在、也不需要另一个
`PostgresDevelopComposerSealedReadPortV2`。开启 `composer-v3-replay` 与 `native-replay-execution` 的构建带上它们且不带任何验收代码，
`scripts/ci/check-production-features.py` 按镜像实际构建的 feature 检查这一点。所以 feature gate 就是这条 route 与一个构建之间的
全部距离，切换就是让部署镜像带上这样的构建，这是一个部署决定。切换之后，只有 `BACKTEST_OWNER_DATABASE_URL` 准入规范 Backtest Owner principal，
且 Market Data scheduling capability 存在时，startup 才暴露 execution capability。Coordinator 确认 Result、
全部 28 份 evidence envelope 与 semantic trace 后，handler 只返回实际持久化的 canonical Result bytes；未获
确认的提交保持 unavailable。该准入不授予 disposable PostgreSQL acceptance、已部署或正在运行的服务、
production invocation、Paper/Live execution 或 trading。

**SUPERSEDED TARGET，Owner 封存的 Native Replay 帧序列 V2：** 策略形状包络以 PIT 窗口托管取代这个 profile；
该 profile 没有调用方，切片 T1 里各 Owner 删除各自那一部分，表经迁移删除。下面几段保留下来，作为取代方案的搬迁表所继承的那些不变式的陈述。现有
`NativeReplayExecutionInputBindingV1`、单帧、28 项观测证据、执行 bundle、请求和 Result 的字节与身份
均保持不变。新增独立的 `NativeReplayExecutionInputBindingV2`，针对请求窗口内整条相邻、完整且
分别由 Market Data Owner 签发的 frame 序列。第一帧必须等于重新解析得到的 V1 初始帧；其后每一帧
都必须来自另一份真实 PIT snapshot 和 observation batch，不能取 PIT correction successor、测试帧或调用方
输入。Market Data 必须按封存的窗口和决策 cut 枚举完整可用 frame；帧数少于两个、帧间漏帧、重复、乱序或
证据缺失时，这个 V2 档不可用，而更长的窗口是更长的序列不是一次拒绝。一次运行消费除最后一帧以外的每一
帧，最后那帧只用来给它前一帧的流动性划界。每帧都绑定自己的 PIT cut、batch、trigger、BAR schedule（每个成员
一个 receipt digest），以及独立经过 Owner 验证的 Quote EVENT 流动性 receipt，包括成员顺序、价量和事件时间；
各帧使用同一 Plan/Design role schema、同一组 canonical member（即 V1 binding 的成员）、universe selection、
Instrument Master cut、timeframe、venue 和账户。帧宽因此随成员数变化；V2 字节不重复写成员数，而是取自
V1 binding，双成员 binding 的字节保持不变，恢复时由存储长度反推成员数。

R&D 仅在准确读取 V1 binding 和每一帧的 Owner 能力后，原子托管 V2 binding、确定性 receipt 与 outbox；
V2 sequence digest 覆盖各帧顺序及全部 frame、schedule、liquidity receipt。精确重试和响应丢失恢复只回读
原记录，意义变化零写入冲突。Native preparation 必须独立重解每个 Owner cut、逐字节复现 V2 binding，再交付
move-only bundle；bundle 在 ProgramHost 或 Backtest 改变状态前验证每帧完整 BAR、随后真实 EVENT 流动性、
跨帧时间顺序和请求窗口。不能把 V1 解释成 V2，也不能在 V2 来源不可用时退回 V1。Market Data 按规范 scale 签发每个
BAR 与 Quote 的值，所以 0.001 tick 上的收盘价 123.450 到达时是 123.45。bundle 把每个价格与数量在不改变数值的前提下
改写为其 instrument 的精度，比 instrument 网格更细的值按名拒绝；随后对任何不在其 instrument 精度上的 BAR 或 Quote 按名
拒绝，否则引擎会静默丢弃该数据，运行却照常完成。

Backtest V2 Result custody 绑定 V2 binding、sequence digest、每帧消费顺序、实际 target set/fill 和本次
canonical Result bytes；单帧 V1 的 28 项证据不能证明一次序列运行。只有每个成员真实进场成交、出场再次成交、
停机空仓且本次 canonical Result 记录仓位已关闭，才产生与 Result digest 绑定的闭环证据；仍持仓或部分成交
不得声称闭环，无法对账的减仓必须失败。按准确 attempt/Result 的恢复只能回读已提交 Result 与证据，不能
重跑或制造闭环。该设计尚未证明动态 Owner 签发、disposable PostgreSQL 验收、策略盈利或交易权限。

**为什么更长的回测是一份窗口托管，而不是更长的帧序列：** 一个 PIT batch 就是一个时刻，而解析成员角色行的那一步
不按事件时间过滤，所以一个 batch 里若还有同一角色的后一个时刻，就有两条精确匹配的行，于是根本绑不出 universe
frame；`a_batch_holding_a_second_instant_of_one_role_binds_no_frame` 测的正是这件事。帧序列 profile 的回答是每个
时刻一份快照、一个 universe frame 和一个原生调度封印，代价是每帧一次外部提交，而且整次运行只能有一个周期。窗口
托管保留这两条事实 - 每一帧仍然经下文那唯一的构造点、从一瞬 batch 绑定 - 但这个 batch 是从只铸造一次的托管里
派生出来的，如策略形状包络所述。

**今天一次运行被钉在一帧上的位置：**
`ReplayTargetSetExecutionBundleV1::new_from_single_frame_v1` 有一个生产调用方，在
`native_replay_execution_binding_consumer_v1.rs` 里，那一处调用就是一次运行不再是一帧的地方。
它旁边那个 N 帧构造器恰好只有一个调用点，在
`compose_native_replay_execution_bundle_v2` 内部，而后者一个调用方都没有；
`native_replay_execution_input_binding_v2` 的每一个条目在默认库构建里都是死的。在那里做替换
需要第二个 `StrategyInputUniverseFrameReceipt`；该收据只有一个构造点，在
`bind_strategy_input_universe_frame` 里，而它吃一个 `VerifiedPitObservationBatch`。所以第二帧
不只是没人写，而是在 Market Data 提交第二份批次之前不可构造，并且
`pit_snapshot/sealed_acceptance.rs` 带着 `compile_fail` doctest，断言即使打开 acceptance feature，
反序列化与结构体字面量都伪造不出它。

**那「一个生产调用方」不意味着什么：** 它是一个调用方计数，不是「这条路径会跑」的陈述。今天在任何
可编译配置下都没有东西签发 `NativeReplayExecutionInputBindingV1`。它的签发收敛到
`issue_native_replay_execution_input_binding_v1`，而后者唯一的调用方是一个 HTTP handler，
只在 `rd-owner-api` 这个 crate 自己的 `composer-replay-issuance` 下注册，
部署镜像不开启它，有序链路的构建只经由 `sealed-develop-composer-acceptance` 打开它；没有 SQL 或脚本直接写那几张绑定表，
也没有测试或客户端提到那条路由。签发者与它旁边的解析者都是 `PostgresResearchGoalOwnerV1` 上
无门的生产函数，相距四十三行，要的协作者是同一套。所以这条执行路径是没被走到，而不是走不到，
而一条先签发再解析的有序链路条目就能驱动它，既不必启用 feature 也不必扩任何 union。

**TARGET / NOT_ADMITTED，BAR FRAME 与 JOINED_CUT composition：** additive
`StrategyInputSampleProjectionV4` 是唯一可在完整 native join 中组合 BAR component 的 projection。
它的 projection kind 闭集为 `FRAME|JOINED_CUT`，lifecycle 闭集为 `BAR`；V2 EVENT/FRAME/JOINED_CUT 与 V3
BAR/FRAME 的 bytes、identity、semantics 和 resolver 保持不变。V4 JOINED_CUT 以准确、未改变的 V1 joined-cut
receipt digest 为 subject。其 receipt identity 还覆盖准确 canonical schedule-dependency-set digest，且每个 V4
component 的 role、binding、frame、timeframe、sample、coordinate 与 schedule dependency field 都必须严格等于
对应 Owner-resolved V3 BAR FRAME component。caller、Composer 或 consumer 均不得重新 canonicalize、narrow
或 substitute 任一集合。

首个 corpus 准确包含六个 role：1-minute OPEN、HIGH、LOW 与 CLOSE，1-hour CLOSE，以及 exchange-session
1-day CLOSE。1-minute CLOSE 是 trigger。四个 1-minute role 必须解析同一个完整 schedule slot 与 observation
batch。1-hour 与 1-day component 必须是在其 Owner schedule 下不晚于该 trigger 的完整 latest-closed sample；
1-day component 是 exchange-session day，绝不能替换为 UTC day 或 24-hour interval。W3 只能消费按准确 locator
回读的 V4 JOINED_CUT，绝不能把 V2 或 V3 当作 joined composition。证据缺失、partial、future、stale、duplicate、
cross-batch、cross-slot、schedule-set、V1-subject 或 strict component-equality failure，必须在 Composer、Plan、
Artifact、Host、Backtest 或 lifecycle mutation 前拒绝。该 target 不授予 production、deployment、runtime 或
trading authority。

Market Data 为 sealed static binding 解析准确 historical timeframe-projection receipt，并从 verified census
中选择、封存 coordinate。R&D、Host caller、Backtest 与 plugin 都不能 mint、narrow、
hash-substitute 或 advance 它。对于一个 role，replay 只有在 308 bytes 全部相同时才能 join。同一
role/timeframe/sample identity 若对应不同 bytes 即为 conflict。新 sample 必须保持 static binding、timeframe、
lineage root 与 Market Semantics identity 不变，lineage version 不递减，sample identity 不同，并且
`(logical_time, event_time, owner_sequence, event_identity, sample_identity)` tuple 按 lexicographic order 严格
增大。cross-lineage coordinate 不可比较且 fail closed。state 是否推进由这些 equality/order rule 决定，而不
由 numeric value equality 决定。

TARGET Design/Plan seam 是版本化 source semantic
`strategy.value-ref.owner-sample-coordinate.v1(input_role_id)`。每个 BFP input role（包括 trigger role）都必须
准确具有一个 value binding 与一个 coordinate binding。lowerer 必须为每个这样的 role 创建一个 manifest
input port，其 literal semantic ID 是
`strategy.input.sample-coordinate.v1.<role_identity_hex>`，其中 `role_identity_hex` 准确为该 role
`[u8; 32]` identity 的 64 个 lowercase hex character。uppercase、非 64-length suffix 或与绑定 role 不等的
suffix 都是 noncanonical。该 port 的 type 为 `ValueTypeV2::Bytes`，准确 `max_bytes = 308`。规范 BFP
role-binding table 按 `(role_identity_bytes, kind_tag)` 排序，其中 `kind_tag = 0` 是 role value binding，
`kind_tag = 1` 是其 coordinate binding；该顺序证明准确的 value-coordinate 配对，但不定义 ABI wire order。
manifest input frame 仍只按规范 `PluginManifestV2.input_ports` 顺序排列，每个 role-binding-table entry 都绑定
其准确 manifest port ordinal。`StrategyPlanV2` 绑定 role、完整 derived port ID、coordinate-source semantic
ID、port ordinal、static binding、coordinate codec/digest rule 与 update clock。Plan 只能从准确的 Owner-verified
coordinate projection 投影该 source；Plan 与 Host 都不得接受 caller 提供或重建的 coordinate bytes。不含这一
tagged source 的既有 Design 保持逐字节相同的 V2 含义。

universe-member role 的两个 binding 都使用成员版本：value 用 `UniverseMemberInput`，coordinate 用
`UniverseMemberSampleCoordinate`，两者都写明成员序号，source semantic 与 port ID 规则不变。bounded feature
program 产出单品种 proposal，所以它只在 Owner universe 准确有一个成员时读取 universe，且只在序号 0 上读取。这类
role 的 static binding 是该 role 在该成员上的 Owner binding。任何其他成员数的 universe 都被具名拒绝，绝不绑定到
其第一个成员。Plan 的 role-binding 行携带成员序号，exact-instrument 行省略它，因此其 Plan bytes 不变；Host 按该
role 与序号解析 coordinate。CURRENT_PARTIAL：Design 变体、Plan 投影、BFP 准备与 Host 解析均已实现，并在单元层
证明。目前还没有任何 Owner projection 携带 universe 帧的成员 coordinate。这个 projection 是 Market Data 的
universe-frame sample projection，尚未写明；在它存在之前，Host 在 input admission 时拒绝面向 BFP Plan 的 universe
帧，因为该帧缺少 coordinate。

唯一通用 `ProgramHostV2` 扩展其既有 Owner-event evidence adapter，而不是扩展 graph opcode set 或 runtime，
以保留 Owner-verified projection 的准确 coordinate bytes 并解析该 Plan-bound metadata source。它拒绝未被
已接纳 Market Data receipt cross-bind 的 coordinate，随后把这准确 308 Owner bytes 复制到其 Plan 绑定 manifest
ordinal 的 coordinate port。guest 不会收到 caller coordinate，也不能请求另一个 role。这是唯一接纳的
transport；禁止从 I128 value、driver envelope、trigger count、local hash 或 guest state 派生 coordinate。

trigger-clock node 对其命名 trigger role 的每个新接纳 coordinate 推进一步。sample-clock node 只有在其命名
sample role 收到严格新的 Owner-sealed sample coordinate 时才推进。因此每个 clock 都消费与其命名 role 配对
的准确 coordinate；trigger coordinate 不能代替另一 role 的 sample coordinate。同一 1-hour sample 被多个
1-minute trigger 携带时，必须复用旧 sample-clock state 而不推进，即使其他 trigger value 改变；新封存的
1-hour sample 即使 OHLC 数值与前一个完全相同，也必须准确推进一次。value comparison、caller time、trigger
count、arrival order、narrowed R04 或 event hash、本地派生 timestamp 都不是合法替代。缺失、stale、
duplicate-conflicting、cross-role、cross-timeframe、cross-lineage、regressed-version、receipt-mismatched 或
非规范 coordinate，都必须在 guest 调用或任何 BFP/plugin/lifecycle/target/protection/trace/checkpoint mutation
前失败。

已接纳 correction 是具有准确 series/correction predecessor 的 immutable successor sample。它创建新的
fact、receipt、identity 与 coordinate，并让 sample clock 准确推进一次；绝不 rewrite、追溯 replace 或
replay predecessor state。普通的等值 successor 也推进一次。单一 V2 projection receipt 交叉绑定准确
sample identity、native receipt digest 与 coordinate digest，同时保留所有 V1 byte
与含义。一个 sample 被后续 trigger 重复选择时保持逐字节相同，且不会再次推进。

该 TARGET 仍只达到 architecture-contract maturity。规范 acceptance 必须复用既有 disposable PostgreSQL
harness 和仓库权威 Makefile、pre-commit、CI wiring，以证明逐字段 mutation、idempotency/conflict 与
correction topology、response loss/restart/rollback/historical readback、tamper/cross-splice rejection、V1
preservation 与 Owner-only ACL。consumer oracle 覆盖同一 1-hour 与 exchange-session `1d` sample 在 1-minute
trigger 间重复、等值 successor、correction，以及 restart 后 byte-identical native receipt recovery。它不
证明 provider authenticity、production migration/deployment、Dashboard、Paper、Live、BFP executable
maturity 或 trading authority。

#### TARGET plugin failure-status 兼容

命名 numeric terminal 使用既有 manifest、wire 与 `ProgramHostV2` 的兼容版本化扩展，而不是 plugin output、
Host feature opcode 或第二 runtime。既有 ABI 2 manifest、frame bytes、receipt 与
`strategy.plugin.failure.unsupported.v1` handling 保持逐字节权威。BFP V1 plugin 改用
`PluginManifestV2.abi_version = 3` 与
`failure_semantic_id = bfp.numeric.failure.no-state-change.v1`；Plan、V3 build receipt、
`PluginImplementationReceiptV2`、module identity 与 Artifact 全部绑定这两个值。ABI 3 保留规范 port-entry
layout，frame header 使用 ABI `u16 = 3`，并在每个成功 output body 的 manifest output value 之前加上上文定义
的规范 one-byte availability tag；该 byte 不是 manifest port entry。除此以外，它只改变 invocation status
map：nonnegative 值是规范 output length，`-1` 是 `NUMERIC_FAILURE_NO_STATE_CHANGE`，其他所有 negative 值
都是 unsupported/unknown guest status。

当 ABI 3 status 为 `-1` 时，`ProgramHostV2` 不 decode output，丢弃 scratch guest/BFP/kernel bundle，发出绑定
已接纳 event 与 plugin identity 的命名 terminal，并证明 pre-event checkpoint bytes/digest 未改变。output
frame 不能声明该 terminal，status 也不能携带 post-state、intent、target、protection 或 effect bytes。
ABI/version/failure-ID mismatch、unknown status、trap 或 status/output-length conflict 都通过既有通用
unsupported boundary fail closed。任何 V2 row 或 receipt 都不会被 rewrite、reinterpret 或 promote。

#### V3 build capsule 与持久兼容

`DevelopPluginBuildProducerV2` 是 CURRENT/PARTIAL，只从 manifest 派生固定空实现，无法诚实承载可变 BFP
含义。因此 TARGET producer 接受单独 tagged V3 capsule，绝不对 V2 做未版本化改写。规范 V3 capsule 与
build receipt 绑定 plugin semantic ID/manifest digest、BFP 规范 bytes/digest、准确 first-party SDK 与
`vibe-indicators-kernel` catalog/source digest、lowerer identity/source digest、compiler/linker/target sysroot/
toolchain/target/build-profile identity、固定 command/configuration、完整 source-file set/digest，以及声明的
source/Wasm、fuel、memory、import、export、ABI、port、state、invocation bounds。两个 fresh private build
必须成功完成，并生成字节一致的 source 与 Wasm。随后现有 ABI/resource verifier 拒绝所有未声明 import/
export、start function、`memory.grow`、floating-point opcode、ABI/manifest mismatch 或资源超限。

`PluginImplementationReceiptV2` 可以继续绑定结果 module 与不透明 `verified_build_receipt_digest`，但不解释
或 mint V3 authority。Composer durable custody 必须存储并回读显式
`V2(existing canonical bytes) | V3(canonical bytes)` receipt tag，使用对应 decoder 校验所选 schema，并把 tagged
receipt digest 绑定进 Plan/Artifact 路径。既有 V2 row 与 digest 保持逐字节权威和可读；migration 不得 rewrite、
reinterpret、backfill 或静默提升为 V3。missing tag、unknown version、cross-tag replay、V3 tag 下的 V2 bytes、
同一 build identity 下改变 BFP，或 V3 coverage 不完整，都必须 fail closed 且不生成 Plan/Artifact。

新 corpus 通过唯一 BFP-to-Wasm 路径证明仍被接纳的 legacy behavior 等价后，`complex_strategy_ir`、
`complex_strategy_program`、其 interpreter/compiler 路径和手写 V1 complex program 必须被删除或退休为非
authoritative。其 floating-point semantics 与 raw `Action::Submit` plumbing 不得被翻译、包装或保留为 BFP、
SDK、primitive、Host 或 migration authority。

#### 首个未来 executable corpus 与 falsifier

首个未来 executable corpus 必须不可变且预提交。其单一 `InputJoinV2` 包含 1-minute raw
open/high/low/close price role，以及 1-hour-close 与 1-day-close regime-source price role。每个 joined role
都具有相同 fixed-I128 value type、price unit 与 scale；1-minute-close role 是显式 trigger。这个 V1 corpus
不包含 volume role。在 1-minute trigger clock 上计算 ATR、RSI、candle geometry、rolling swing 与 rational
Fibonacci range fraction，在命名的 1-hour-close/1-day-close sample clock 上更新 multi-timeframe regime state。
reaction 准确消费该完整 join role set。有界 holding、add-count、high-water 与 protection state 驱动一段连续
event sequence，其中包含
`ENTER -> ADD -> REDUCE -> EXIT` 和显式 `HOLD`，并输出动态 stop-loss、take-profit 与 trailing protection。
每个 `READY` frame 的 `ProtectionVariantV1` 必须准确属于 `ProgramHostV2` 已识别的 variant：
`kernel.protection.keep.v1`、`kernel.protection.clear.v1`、`kernel.protection.trailing-adjust.v1` 或
`kernel.protection.replace.v1`。Host 只按该准确 variant 读取 protection scalar field；corpus 覆盖 Keep、Clear、
trailing adjustment 与 Replace，且不引入第二套 protection 解释。

验收要求规范 BFP 两次 lowering 得到字节一致 source，两次 build 得到字节一致 Wasm 与 tagged V3 receipt，
经 Composer 进入同一 `StrategyArtifactV2`，并通过真实 `ProgramHostV2`/Backtest shared-kernel path 执行。
完整重复运行必须生成字节一致的 BFP、source、Wasm、build receipt、Plan/Artifact identity、ordered semantic
trace、checkpoint、fill、position、protection、cost 与规范 Backtest result。在每个声明 state frontier 恢复
checkpoint 都必须复现字节一致 suffix。

字节一致只在同一种定点精度模式内成立。产品运行在 `FIXED_PRECISION` 16：`vibe-strategy-factory` 在自己的
`vibe-model` 依赖上声明 `high-precision`，因此本地、CI、Owner 链路与生产构建共用它，
`scripts/ci/check-production-features.py` 会拒绝任何链接 `vibe-model` 却不带它的生产包。定点值换算成 `f64`
在两种模式下都只做一次正确舍入，所以规范 result 不依赖模式；依赖模式的是可表示范围和准入接受什么。

corpus 必须为以下情况提供负向 oracle：unknown opcode/field/semantic ID；scale/unit mismatch；每个 checked
overflow 与 rounding boundary；missing/stale/cross-lineage binding/coordinate；same-sample duplicate；
equal-valued new sample；duplicate/conflicting state advance；DAG/window/state/fuel/memory/source/Wasm
exhaustion；noncanonical bytes；build/source/Wasm inequality；ABI/import/export violation；floating-point
presence；以及任何 raw-order output。它还覆盖 missing/duplicate/noncanonical golden ID 或 vector、ABI 3
failure-semantic mismatch、unknown negative status、status/output-length conflict，以及携带 output 或 post-state
的伪造 numeric terminal。每个负向案例都必须在命名 boundary 终止且不生成 fallback，并按适用
情况让 checkpoint、BFP/plugin/kernel state、target/protection、semantic trace、Plan、Artifact 与 external
effect 保持字节不变或不存在。

golden vector 还必须冻结：两种 rounding mode 的正负 half tie；每个 lag、rolling、EMA、Wilder、ATR、RSI、
gap 与 swing 在 `READY` 前一刻和首次 READY 的 warm-up frontier；flat-price RSI `50`；zero-loss RSI `100`；
zero-gain RSI `0`；首个及后续 true range；OHLC rejection；latest-coordinate swing tie；same-sample 不推进；
equal-valued-new-sample 推进；I128 intermediate 会 overflow 但 I256 intermediate 与最终 scaled result 均可容纳
的计算；I128 `MIN / -1`；denominator 为零、rational 未约分、numerator 大于 denominator 或 low 大于 high
这些可表示的 invalid range fraction；以及上述 closed state-byte-identity ID 命名的每个 primitive
failure class。每个这类 vector 的 pre/post state 与 checkpoint 必须逐字节相同。transport、receipt、ABI、
build 与 resource failure path 则通过各自不同的命名 corpus oracle 证明同一 no-change property。任一 required
golden vector 缺失，或在两次 lowering、两次 build、完整 rerun、checkpoint-restored suffix 之间不同，都必须
使 publication 失败。

`InputJoinV2` version 1 只接纳一种 alignment semantic：
`strategy.input-join.latest-not-after-trigger.v1`。Research 必须声明非空且唯一的 join ID、至少两个唯一的
原始类型化 input-role ID、该准确集合中的一个显式 trigger role，以及大于零、有限且不超过 31 天的
`max_staleness_ns`。join-to-join edge（包括 cycle）、重复或未知 role、一个 role 被两个 join 共用，以及
fact class、scope、value type、unit 或 scale 不兼容都属于 `UNSUPPORTED`。每个 joined role 都是带显式
instrument 与 timeframe 的 exact-instrument Market Data Owner role；一个 reaction 要么消费完整规范 role
集合，要么完全不消费。接纳时 trigger 固定 joined event 的 lifecycle 与 logical time；每个 component 必须
具有相同 lifecycle、时间不晚于 trigger，并满足
`trigger_time - component_time <= max_staleness_ns`。Market Data 在一份完整已验证 PIT/correction census 与
frontier 上执行逐 role latest-not-after argmax，再把 trigger、准确 Design/join/role 集合、所选 frame identity
与 digest、selection-basis/frontier digest、source/correction lineage、staleness proof、Market Semantics identity
和 receipt digest 封存在不可 `Deserialize`、没有 public constructor 的
`StrategyInputJoinedCutReceiptV1` 中。Host 只接收该 receipt，校验其准确 Plan 投影和 Owner 规范 component
顺序，不能选择、替换、重排或推断 frame；`SealedReplayInput` 只能作为 Owner 内部证据基础。缺失、重复、
过期、来自未来、receipt/role/Plan 不匹配、跨 census 或跨 Design 拼接、跨 lineage version 回退、同 root
的冲突 version，或 component/event identity 冲突，
都会在 scratch execution 或任何 guest、state、target、checkpoint 变更前失败。join 是由唯一通用 Host 与
共享 lifecycle kernel 消费的规范 Plan 数据；它不会引入 feature opcode、第二 interpreter、heuristic
binding 或 raw-order 路径。

连续 EVENT replay 只接受新增、move-only 的 `StrategyInputEventCorpusV1`。其完整集合权威是新增、move-only 的 Market Data
`StrategyInputEventSourceV1`，且只能由针对 verified PIT batch 解析的 Owner frame 签发；不得把 `SealedReplayInput` V1
重新解释为多事件权威。Develop preparation 会针对
准确 Plan binding 集合重新校验 corpus 中每份 joined cut 与 V2 projection，并在构造 Host 前校验完整 corpus digest。
随后一份 `PreparedProgramHostHandoffV2` 把完整 corpus 一次性转交给单个持久 Host consumer；不存在 lazy resolve、
caller-selected event vector 或每个 event 重建一个 Host 的路径。缺失、重复、非规范 native 顺序、BAR 替换、等值跨
snapshot/batch 替换，或任何
request/census/frontier/cut/projection/native-trigger 拼接都会在 Host 构造前失败，因此 Host checkpoint 不会推进。
历史 single-event preparation 入口继续独立存在并保持原有行为。

`StrategyArtifactV2` 是单个 package，其中包含规范 `StrategyPlanV2` bytes，并为 Plan 声明的每个 plugin
准确包含一个独立构建的 Wasm module。不同 plugin 声明不能共享 module。系统不会生成外层或根 strategy
Wasm module：通用 `ProgramHostV2` 解释 Plan graph、调用其 plugin module，再把得到的类型化值交给共享
生命周期内核；只有该内核拥有状态转换。这是唯一 V2 执行路径。V1 只保留为迁移与等价性 baseline，绝不
成为另一个 V2 runtime。

对于准确两个成员的纵向切片，selected instrument 只能来自实际由 Market Data Owner 封存的
`StrategyInputUniverseSelectionReceipt`，并由封闭、不可伪造的 sealed acceptance adapter 携带；两份各自有效的 singular input-binding receipt 绝不构成共享 universe
权威。该 adapter 还携带每个已声明 role/member 的准确 Owner binding identity，包括 Research request、
Strategy Design、role 与 binding digest。编译必须验证这些 identity 与规范 Design 一致；host 还必须验证每个
admitted frame value 的 role coordinate 与 binding digest 都等于 Plan 投影，因此不能仅凭相同 selection 与
role name 拼接另一份 Design 的 frame。Plan 把该 receipt 的 selection identity/digest、规范排序的 member-key/instrument 对、Instrument Master
digest、Source Binding lineage root、Market Semantics identity 与 receipt digest 投影进规范 lowering。Design
role 显式区分兼容的 exact-instrument scope 与 universe-member scope；默认 exact-instrument scope 在 schema-2
规范 JSON 中保持省略，因此 Origin Design/role identity 不漂移。当前 universe 纵向切片只声明一次 OPEN
与 CLOSE，graph reference 只能选择 Owner 规范 member 顺序中的 ordinal；role 与 guest 都不能提供 instrument
或 selection identity。每个 BAR 或 EVENT reaction 都必须消费一份实际 Owner-sealed
`StrategyInputUniverseFrameReceipt`：其 selection 必须与
Plan 投影完全一致，规范 values 必须准确覆盖每个 required role/member 坐标以及两个不同规范 instrument。
singular event frame 的 vector 不是 universe frame。每个 BAR/EVENT graph 必须准确包含一个 compute/target-producing
node，因此准确一次 plugin 调用返回
固定大小、按 instrument key 排序的规范 target set。member 缺失、重复、未知、乱序、越界、混合或非规范
时，host 必须在任一成员内核、plugin/strategy state、target set、sequence 或 checkpoint 前进前拒绝整个
结果。host 在 guest output 外层封存 selection、admitted frame、capability、program/artifact、state 与每个
成员的 lifecycle identity；guest 与 caller 都不能选择这些权威。单一不透明组合 checkpoint 包含两个成员
内核、各自 pending target/protection、规范 target set、完整 host/plugin state 与组合 sequence，因此 restore
和准确 replay 会产生相同后缀。这是一个 `ProgramHostV2`，不是每个 instrument 一个 host。当前有界
Backtest adapter 只通过原生 `ClientOrderId -> {instrument, intent identity}` binding 提供成员坐标，并在上述
限制内消费进程内 Backtest account/instrument snapshot；它不接受 caller-selected fill coordinate 或 weight
reconciliation。只有 adapter 能封存不透明 reconciliation capability；`ProgramHostV2` 不接受 free-form
target-unit array，且只有 in-process instance token 与 checkpoint frontier 仍准确匹配时才提交 prepared value。
Execution/Paper/Live routing、外部 account truth、更广 currency conversion、inverse/quanto
instrument 与 cold-engine restore 仍不可用。

每次 plugin 调用都使用 fresh 或 reset 的 module instance。guest memory 与 guest state 均不得跨调用保留；
plugin state 是通过规范 frame 搬运的显式、有界、host-owned bytes。V2 plugin module 没有 import 或 start
function，不能执行 `memory.grow`，且必须准确导出以下六项，不能有额外 export：

- `memory`；
- `strategy_factory_plugin_input_ptr_v2() -> i32` 与
  `strategy_factory_plugin_input_capacity_v2() -> i32`；
- `strategy_factory_plugin_output_ptr_v2() -> i32` 与
  `strategy_factory_plugin_output_capacity_v2() -> i32`；
- `strategy_factory_plugin_invoke_v2(i32) -> i32`。

input 与 output codec 都使用规范 96-byte header。各字段按 byte 顺序为 magic（input 用 `SFPI`，output 用
`SFPO`）、codec `u16 = 2`、ABI `u16 = 2`、规范 manifest digest `[u8; 32]`、module identity `[u8; 32]`、
host-derived invocation identity `[u8; 16]`、value count `u16`、reserved-zero `u16` 与 body length `u32`。
body 按 manifest 顺序包含 entry：ordinal `u16`、type `u8`、零 flags `u8`、length `u32` 与 payload bytes；
plugin state 使用 ordinal `0xffff`。scalar 必须是 exact-width little-endian，bytes value 不得超过声明的
bound。unknown field 或 type、trailing bytes、错误顺序、重复或缺失 entry、非零 reserved/flags、width
mismatch 以及任何其他非规范编码都必须 fail closed。output 只能包含 manifest-typed value 与 post-state。
plugin 绝不能选择或返回 proposal identity、proposal order、order 或其他 effect。host 对按 Plan 顺序排列的
plugin state bytes 计算 domain-separated 聚合 plugin-state-set digest。

Research 拥有每个 input role 的声明及其实验含义；只有事实 Owner 能把该 role 绑定到可消费事实。按事实
类别固定 binding 权威：

| Input fact 类别                                                       | Binding 权威                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| hypothesis parameter、mechanism state 与 Research‑controlled constant | R&D                                                                                 |
| market、reference、instrument、universe 与 calendar fact              | Market Data                                                                         |
| order、fill、venue acceptance 与 execution readback fact              | Runtime 中为 Execution；仅在隔离 replay namespace 中可由 Backtest Sim Exchange 提供 |
| position、balance、exposure 与 account truth                          | Portfolio                                                                           |
| limit、decision、Reservation 与 permit                                | Risk                                                                                |

compiler 校验这些类型化 receipt；绝不能把一个 Owner 的权威转交另一个 Owner，也不能把 Backtest
simulation fact 当成 Runtime account、Execution 或 Risk truth。

对于 Market Data input，静态 `StrategyInputBindingReceipt` 是唯一 role/stream 权威。其与 role 无关的
`selection_identity` 绑定 field semantics、规范 instrument 或稳定 universe scope、channel、data kind、
timeframe、unit、scale、Source Binding lineage root、correction stream 与 Market Semantics identity；PIT
request、snapshot、batch、准确 frontier/version、time、sequence、row 与 value 均为可更新 event evidence，
不进入静态 digest。runtime 使用一个
Owner-sealed event frame，而不是让每个 field row 各自拥有 lifecycle identity。Market Data 只有在持有
verified multi-field observation batch，且所选 rows 共享 snapshot/fact/batch identity、event-effective
time、provider-available time、correction-publication time、非零 correction sequence 与 event class 时，
才能签发 trigger。同一个 reaction 共同消费的所有 role 还必须共享同一个 Source Binding lineage root、
correction stream 与 Market Semantics identity，作为 frame anchor；不同 reaction 可以使用不同 lineage
root。trigger 保留这些身份，并绑定排序后的 `(input-role identity, original binding
digest, selection identity, dynamic canonical-row digest)` 集合。确定性映射为 `BAR -> BAR`、
`QUOTE|TRADE|REFERENCE|ECONOMIC|SCALAR -> EVENT`；`logical_time` 为
`max(provider_available, correction_publication)`，`event_time` 为 `event_effective`，`owner_sequence` 为
correction sequence。`event_identity` 是对规范 domain `VIBE_STRATEGY_INPUT_EVENT_FRAME_V1` 与完整 frame
projection 做 BLAKE3 后的前 16 bytes。

frame 必须消费既有静态 receipt 并在当前 verified batch 中重新解析 row，且不再复制静态 receipt。
每份按 role 排序的 value receipt 均保留原 `StrategyInputBindingReceipt` digest 与 role identity，封存带
明确 fixed-value semantic 的准确 signed i128 little-endian bytes、scale 和 canonical-row digest，并交叉
绑定 trigger 与 observation-batch digest。R&D 私有 adapter 只校验一次 trigger，只对当前
reaction 实际引用的 Owner facts 按 Plan role/type 和 frame/as-of 进行校验，并直接从 sealed trigger 派生
SDK envelope 与 order key。聚合 admitted-event digest 只补充而不替代任何原始 Owner identity；不存在
public caller envelope/value constructor。compiler 必须拒绝没有已准入 trigger 与 fact contract 可执行的
reaction/input 组合。sealed Plan binding projection 保留 Owner 的准确 `data_kind`：`BAR` fact 只能由
`BAR` reaction 引用，`QUOTE|TRADE|REFERENCE|ECONOMIC|SCALAR` fact 只能由 `EVENT` reaction 引用。
Market Data 只能签发 `BAR` 与 `EVENT`；Time/Scheduler 是未来唯一的 `TIMER`
trigger Owner，Execution 是未来唯一的 `FILL` trigger Owner，而在真实 Owner contract 存在前，两者的
positive admission 均不可用。

只有共享生命周期内核能排序并应用 `START` `BAR` `EVENT` `FILL` `TIMER` `STOP`。每个输入先规范化
为版本化 envelope，其 total-order tuple 依次为 logical/event time、按上述声明顺序固定的 lifecycle-kind
precedence、Owner sequence 和最终 stable event identity。准确 identity replay 必须按字节等价 join；相同
identity 字节冲突或缺失任一排序坐标都必须 fail closed。host 计算 `envelope_digest` 的方法是：对 domain
`strategy.lifecycle.envelope.v1\0` 与规范 128-byte envelope 拼接后取 SHA-256；计算时 envelope 的 bytes
`56..88` 必须归零。host 计算 `proposal_digest` 的方法是：对 domain
`strategy.lifecycle.proposal.v1\0` 与规范 224-byte、已完全 host-sealed 的 proposal 拼接后取 SHA-256；
计算时 proposal 的 bytes `32..64` 必须归零。caller 提供的非零 digest 绝不足以成为任一身份的权威。
版本化 checkpoint 绑定 Design、Plan、Artifact、`ProgramHostV2`、kernel、plugin 与 Market Semantics 身份，
最后消费的 order key，strategy/plugin state，
target/protection state，以及 order/fill reconciliation frontier。它还绑定按 Source Binding lineage root
确定性排序的 version frontier：version 只在同一个 lineage root 内可比较；同 root 降级必须在 guest 或
state mutation 前失败；另一 root 的较低 version 不构成降级。重启只能从完全匹配且不透明的
`ProgramCheckpointBundleV2` 恢复，并产生相同后续 semantic trace。其规范 bytes 与 digest 仍可作为
content-addressing evidence，但 caller 持有的 bytes 即使重新计算 digest 也不构成 restore authority；Host
必须在 decode 前校验 bundle 私有保存的 digest。

admission 与 evaluation 是一个 failure-atomic boundary。host 必须在任何 guest 调用前完成 admission 或
exact-replay join，然后 clone 完整 host 与 kernel state；只有 `BAR`、`EVENT` 或 `TIMER` 才 evaluation
plugin。host 必须校验所有 plugin result、post-state 与完全 host-sealed 的 proposal，把 proposal 应用到
cloned kernel，并证明规范 checkpoint encode/decode roundtrip，最后才执行一次 whole-bundle swap。
`START`、`FILL` 与 `STOP` 只由 kernel 处理，绝不调用 guest。任何 fault 都必须让 checkpoint、已消费
order、host/plugin/kernel state、digest 与 semantic trace 保持 byte-identically unchanged，并产生零
semantic effect 或 external effect。

只有内核拥有下列稳定语义 primitive 及其状态转换，Design 与 plugin 均不拥有：

- `ENTER` `ADD` `REDUCE` `EXIT` 与 `HOLD` position intent，对应 `kernel.position.enter.v1`、
  `kernel.position.add.v1`、`kernel.position.reduce.v1`、`kernel.position.exit.v1` 与
  `kernel.position.hold.v1`；
- target position、target weight 与 target rebalance，对应 `kernel.target.position.v1`、
  `kernel.target.weight.v1` 与 `kernel.target.rebalance.v1`；
- stop-loss、take-profit 与 trailing-protection adjustment，对应 `kernel.protection.stop-loss.v1`、
  `kernel.protection.take-profit.v1` 与 `kernel.protection.trailing-adjust.v1`；
- fill reconciliation 对应 `kernel.fill.reconcile.v1`，包括 partial fill、rejection、cancellation 和乱序
  readback。

rebalance 目标的序号属于 Host，不属于程序。程序对 `kernel.target.rebalance.v1` 目标在
`proposal.rebalance-sequence.v1` 上发出 `0`，由 Host 在解码提案时分配序号：在 target-set 路径上，是提案被提升进的
那个 target set 的序号，提升要求每个成员都带上它；在单品种路径上，是成员内核当前 rebalance 序号加一，内核要求一次
rebalance 超过它。两条规则都由构造成立，而程序原本只能去猜那个只在一帧上满足它们的数。程序对 rebalance 目标发出
任何其他值，都以 `REBALANCE_SEQUENCE_IS_HOST_ASSIGNED` 按名拒绝；这个端口仍留在插件 ABI 里，其他目标都不读它。

每个 primitive 都有跨 Backtest 与 Runtime 含义稳定的版本化 semantic ID。内核把 target 与 protection
转换为 semantic intent record；在 Runtime 中，Risk 仍是最终准入权威，Execution 仍是 order/fill/effect
权威，Portfolio 仍是 position/account truth。R&D、Backtest、compiler 与 plugin 都不能绕过这些 Owner。

Custom plugin 是唯一有界逃生口。它是作用于 allowlisted、版本化输入记录与有界私有 state 的纯类型
函数，只能返回 allowlisted typed value 或 state proposal。manifest 固定 ABI 与 semantic ID、input/output/
state schema 与 byte limit、fuel、linear memory、invocation count 和确定性失败行为。它没有 Owner 读写、
network、filesystem、clock、randomness、subprocess、secret、account、raw-order、Risk-permit、
Execution-adapter、deployment 或 external-effect 权威。plugin 不能新增 core opcode 或返回 order；plan 只能
把其有界输出交给 kernel-owned primitive。资源耗尽或畸形 plugin 以结构化 unsupported 结果终止，并且
该事件产生零策略 effect。

编译只有两个非正向语义终态。`UNSUPPORTED` 指出准确 schema coordinate、缺失或版本不匹配的 primitive/
capability、plugin/resource bound、Owner binding 或 runtime profile，且不生成 Plan 或 Artifact。
`NEEDS_RESEARCH_REFINEMENT` 指出 Research 必须在后继 Design 冻结的含糊或未充分指定 mechanism、input
role、timeframe、state transition、target、protection rule 或 falsifier，同样不生成 Plan 或 Artifact。
两者都不能启用猜测 binding、生成 fallback code、toy renderer 或 partial executable。

ComplexStrategy V1 的 canonicalization、bounds、frozen-Intent 校验和准确 Owner binding 是迁移输入，不是
第二门永久语言。它们必须被吸收到 V2 compiler，并通过唯一 `StrategyArtifactV2`/`ProgramHostV2` 路径
lowering。
冻结等价 corpus 在产品精度模式下证明 byte-identical semantic trace 与规范 Backtest result 后，必须删除重复 V1
interpreter 与 toy renderer。禁止第三个 runtime、sidecar interpreter、生成的无限制策略代码路径或
feature-specific core opcode。

验收使用三组版本化不可变 corpus；每组都包含正向、unsupported、畸形 binding、资源耗尽和
checkpoint/restart 案例：

1. **Stateful trend：** entry、pyramiding、partial fill、stop-loss/take-profit 与 trailing-stop adjustment、
   timer action、reduction 和 exit。
1. **Cross-sectional rebalance：** 类型化 universe role、ranking、target weight、rebalance cadence、partial
   fill 和确定性 residual reconciliation。
1. **Multi-leg、multi-timeframe regime：** 准确 leg 与 timeframe role、joined event ordering、regime state、
   atomic target intent，以及 leg input 缺失或过期时 fail closed。

每组已接纳 corpus 在产品精度模式下的重复 Backtest 必须产生 byte-identical Design/Plan/Artifact 身份、ordered semantic
trace、checkpoint、fill、position、cost 和规范 result。未来获准的 Paper 或 Live Runtime 对同一
normalized event prefix 必须在 Risk/Execution adapter boundary 之前产生相同 semantic trace。任何 divergence、
heuristic binding、把 unsupported feature 提升为 opcode、plugin raw-order attempt 或保留重复 interpreter
都导致验收失败。

## TARGET / NOT_ADMITTED - TrialFamily 拥有的 Replay execution policy V2

R&D 必须在 TrialFamily formation 时冻结准确一份规范嵌套 `replay_execution_policy_v2`。永久 family root、
policy 与初始 Census Frontier 必须交叉绑定各自身份和规范摘要，使后续 family member、Composer、Dashboard
operation、Backtest adapter 或其他 caller 都不能替换或重新解释该 policy。该内容仍是目标架构契约；当前
caller-authored `ReplayRequestDtoV2` 路径不满足此契约，本文不声称已有 PostgreSQL 或第一方验收。

这些值在 formation 前的唯一来源是 R&D Owner 内部密封、版本化的 Replay Policy Catalog fact；该 catalog
既不是新 Owner，也不是第二个 TrialFamily aggregate。每条 immutable record 包含唯一、永不复用的非空 ASCII
`catalog_record_id`，唯一、严格递增且永不复用的 unsigned 64-bit `catalog_version`，用于标识准确 policy
schema、canonical grammar 与 parser contract 的非空 versioned ASCII `policy_grammar_parser_id`、其 32-byte
`policy_grammar_parser_digest`、完整规范 `replay_execution_policy_v2` bytes，以及
`policy_digest = SHA-256("rd.replay-execution-policy.v2\0" || policy_canonical_bytes)`。其 canonical record
bytes 按此固定顺序编码 ASCII record ID 的 `u32 length || bytes`、little-endian `u64` version、ASCII
grammar/parser ID 的 `u32 length || bytes`、32-byte grammar/parser digest、policy bytes 的
`u32 length || bytes` 与 32-byte policy digest；每个 length 均为 little-endian。`catalog_record_digest` 为
`SHA-256("rd.replay-policy-catalog-record.v2\0" || canonical_record_bytes)`。

Catalog bootstrap 是独立、显式启用、单次运行的 `authority-admin` composition，绝不是 R&D API
route、Product Edge/Dashboard operation、default service、migration 或 runtime selector。它只使用
`REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL` 调用固定私有 write port。Rust one-shot composition 必须在
database access 前验证拒绝未知字段的密封 V1 request。PostgreSQL 不独立验证 Ed25519；它信任独占的
`replay_policy_catalog_admin_writer` principal 作为已认证 broker 的 mutation boundary。该 credential 绝不能
分发给 operator、ordinary service、Dashboard 或 generic SQL client；在 broker 外持有或使用即为 trust-boundary
breach。该 request 由
Ed25519 签名，并绑定 schema version、bootstrap identity、administrator identity、单独信任的
verifier identity、Catalog record identity、完整 canonical policy bytes、确定性 create 与 head-advance
command identity、event time 与 signature。composition 必须在任何 database access 之前验证准确
schema、signature、受信 verifier identity/key、已绑定 identity 与 canonical digest，再从该已验证
evidence 派生 `authentication_fact_digest`，不得接受 caller 或 credential 自行声明的值。

transaction 必须先锁定并分类 records/head/revocations/audits 四表 census：只有准确 `0/0/0/0` 可以在同一
transaction 中创建 version 1 并推进其 head；resolution 只接受准确 `1/1/0/2` 以及准确 record、head 与 audit
bytes。genesis record 的 predecessor 必须为 NULL，其 `created_by`/`created_at_epoch_ms` 与 head 的
`advanced_by`/`advanced_at_epoch_ms` 必须分别等于签名 administrator 与 event time。任何其他 partial、extra
或 provenance-mismatched shape 都保持不变并 conflict。准确 identity 与
逐字节相同 meaning 必须从准确 sealed request 与 immutable audited record/head state 重建一份确定性
typed Owner readback。首次 success 与准确 response-loss 或 restart replay 都以零写入返回该逐字节相同
readback；任何 attempt-local `CREATED`/`RESOLVED` field 或 execution-path marker 都不得改变其 bytes。
identity 或 meaning 改变，以及 orphaned、divergent、revoked、tampered、partially initialized 或
unauthenticated state 都必须 conflict，并对 record、head、revocation 与 audit 零变化。每个 immutable audit
fact 就是持久 command receipt，该 typed readback 是唯一 projection；不存在单独的 administration receipt 或
outbox。不得推断或合成 policy、identity、head、authentication fact 或 success result。

只有在上述绑定的准确 schema/grammar/parser identity 与 digest 下，`policy_canonical_bytes` 才能唯一复现。
该 contract 规定唯一固定 field order、明确 integer width 与 endianness、按适用类型使用 `u32` length-prefixed
UTF-8、ASCII 与任意 byte string、在 order 具有语义时保留 list order，并在允许 map 时使用 canonical key
order。每个 integer 均使用 schema 声明的固定 width 与 little-endian encoding，禁止 variable-width integer，
且 string length 按 encoded byte 计数。canonical encoder 与 parser 必须拒绝 duplicate key、unknown field、
noncanonical encoding 或 map order、invalid enum value 或 version、length overflow 与 trailing bytes；接收并
重新编码任何 valid policy 必须逐字节复现输入。

在第一笔 TrialFamily-formation 写入前，同一 Owner transaction 内的 R&D-private formation resolver 必须锁定
并重新读取当时 current 且未被 revoked 的 catalog record，验证其 identity、version、canonical bytes、policy
digest、grammar/parser identity/digest、record digest、currentness 与 unrevoked status，且不得从任何其他位置
解析 policy field。永久 family root 与初始 Census Frontier 都嵌入完整 policy bytes 与 policy digest，并交叉绑定
`policy_grammar_parser_id`、`policy_grammar_parser_digest`、catalog record identity、version 与 digest。caller、
Dashboard operation、environment variable、deployment configuration、default 或后续 catalog record 都不能
select、override、synthesize、backfill 或 infer 任何 field。

该嵌套 policy 拥有组合完整 `ReplayRequestDtoV2` 含义所需的每项执行选择：

- runtime-kernel、simulator、cost、slippage 与 capacity profile 的身份和版本；
- runner operational profile、diagnostic policy 与 deterministic seed；
- 可准入的半开 replay 范围，以及 calendar、session 与 time-zone 的身份和版本；以及
- correction-rule 与 market-semantics 的身份和版本、corporate-action cut、historical-membership cut，及请求中
  其他应由 family policy 而非 input Owner 选择的内容。

请求的 replay window 是它所组合的 Market Data facts 的窗口，落在 policy 可准入的范围之内；今天是一帧
`[C, C+1)`，`C` 是 Market Data 切出该家族快照的时刻。policy 限定窗口，调用方两者都不能提供；policy 不能直接
固定窗口本身，因为家族的 policy 在家族成形时封存，那时它的任何快照都还不存在。组合出的窗口落在范围之外时按名
被拒，`FactsWindowOutsidePolicyRange`。legacy exploratory 请求仍然直接携带 policy 窗口。

### TARGET / NOT_ADMITTED - Replay execution profile V1

TrialFamily policy 选择两个分别密封且内容寻址的值：economic replay configuration 与 runner operational
profile。economic seal 将首条路径固定为 `EVENT`、单 venue、Margin/Netting/L1、准确 starting balance 与共同
quote currency、准确 leverage、deterministic full fill、禁用 slippage/latency/capacity model，并显式固定每个
原生 Sim Exchange behavioral switch。operational seal 显式固定每个 Backtest engine state、timeout、logging、
instance、cache 与 subsystem field。两者都使用严格 canonical codec、固定宽度整数或准确十进制定点值、闭集
model enum，且没有隐藏 default、floating-point、environment 或 caller fallback。

永久 TrialFamily binding 与 R&D-owned request binding 都重复准确的两个 seal digest，并交叉绑定相同 family
identity/digest。maker/taker fee 与 initial/maintenance margin 只有通过 Instrument Owner verified
exact-locator readback 铸造的独立、不可伪造 provenance value 才可使用。
该 readback 只能由 deployment configuration root `INSTRUMENT_OWNER_DATABASE_URL` 打开的 Owner 签发；public
boundary 不接受 caller 选择的 pool、URL、expected store identity 或 expected digest。缺少配置或另建的
PostgreSQL store 都会在 provenance 存在前失败。private fact 与 atomic receipt 绑定
Owner 还会拒绝任何非超级用户登录角色的直接或角色派生有效访问，包括 Owner 角色成员关系与 PostgreSQL
全库读写角色。
public-fact identity/digest、venue、margin-account scope、半开 event validity、source/provenance、revision、
quote/fee currency 与每个准确 term byte。首版只接受正 fixed initial/maintenance value，语义为
`STANDARD_NOTIONAL_RATE` 或 `FIRST_BRACKET_NOTIONAL_RATE`，并明确选择 `StandardMarginModel`（`notional * rate`，
不经 leverage）；绝不推断 `LeveragedMarginModel`。first-bracket terms 只在其 `margin_notional_cap` 以内成立，binding
把该上限与比率一起记录并绑定进 terms digest。引擎运行之后、任何结果封存之前，Sim EVENT consumer 在每一帧、对每个
有上限的 member，取持有与派生目标两者中较大的持仓，乘以该帧的价格、multiplier 与 size increment，与上限比较，超出则把
该运行按名拒绝为 `ECONOMIC_TERMS_NOTIONAL_ABOVE_RECORDED_TIER`。在 native run 能提交 `TERMINAL_RESULT` 以外的结果之前，该拒绝使运行不产生
结果而结束；之后它会成为 `ReplayConfiguration` 诊断类别下的 `INVALID_REPLAY_EVIDENCE` 结果。可见 economic configuration 不能自证这些值，missing value 也绝不会变为零或原生
default。错误 fact、receipt、terms、venue、account 或 time，以及 noncanonical、partial、extra、
cross-spliced、tampered 或 ACL-drifted custody 都会在 `ProgramHostV2` 或 Backtest state 存在前失败。既有
profile canonical bytes 与 digest 保持不变。

一次 Replay 用哪个品种的 terms，按它的请求解析，而不是由它的 family 钉死。economic configuration 的 schema 1
还钉死了一个品种的 terms（`instrument_terms`：品种、public fact 与 receipt digest、费率与保证金），profile
binding 随后要求恰好一个成员与之相等。这条规则随 #468 的密封验收配置引入，此前本文没有陈述过。schema 1 对在其下
密封的每个 family 保持可读，字节与 digest 不变。schema 2 不钉任何品种，只固定跨品种成立的东西：venue、币种、
杠杆，以及 fill、fee 与 margin model；每次 Replay 的品种 terms，是签发 execution-profile binding 时 Instrument
Owner 按它的成员、在它窗口起点解析出的那一份。binding 记录它们的 provenance：品种、public fact digest、terms
receipt、terms digest、费率与保证金。再次解析 terms 的消费方必须恰好遇到这些事实，否则拒绝。因此费率变更是一条
新的 terms fact，而不是新的 Catalog 版本。不钉 terms 的 schema 1，或钉了 terms 的 schema 2，都以
`InstrumentTermsPinningMismatch` 拒绝。不钉品种并不放宽 venue：配置未指名的 venue 上的 terms 在 provenance
存在前就被拒绝，成员位于其他 venue 时 Instrument Owner 什么也解析不出。account scope 是 Owner 为每个成员都持有的
唯一完整 scope；schema 2 不钉费率档位。terms 用带 venue 的 canonical identity 指名品种（`LINKUSDT-PERP.BINANCE`）：
Instrument Owner 按这个 identity 解析一次 Replay 的成员 terms，原生 materialization 拿它与 public fact 的 canonical
identity 比对，并把它解析为原生 instrument id，其 venue 必须是配置里的 venue。不带 venue 的 symbol 不指名任何品种。

原生 engine materialization 保持 `UNAVAILABLE`。V1 只把 liquidation 表示为 disabled，不携带 numeric ratio；
adapter 必须另行证明原生 float-only inactive liquidation field 不会被读取，或在 policy meaning 之外绑定
version-specific inactive constant。materialization 前，一个 version-bound、fail-closed adapter 还必须证明每个
原生 identifier、currency/fixed-point、message-bus codec、time-origin、rate-limit 与 deterministic instance-UUID
转换，并且在没有 host randomness 或隐式 model default 的前提下选择准确的原生 fill、fee 与 margin model。
这些都是显式 unavailable prerequisite，不得从 sealed policy 推断转换。真实非测试
`ProgramHostV2 -> BacktestEngine/Sim Exchange EVENT` consumer 也必须先存在并产生 actual-consumption evidence，
之后才能 admission。该 TARGET 不声称 runnable RDQ loop、Native Replay、Backtest result、Paper、Live、
production 或 trading capability。

TrialFamily 既有顶层 cost-model、slippage-model 与 capacity-model 身份必须与对应嵌套 model profile 准确
相等；不匹配即 unavailable，而不是另一种兼容表示。缺少密封 policy 的 legacy TrialFamily 仍可按历史事实
读取，但对 Replay V2 composition 不合格且不可用：不得提供 default、backfill、caller substitution，也不得从
更新的 family 推断。

Dashboard effect worker 与其他任何 Exploratory Replay caller 只能提交 Artifact 与 TrialFamily 身份，以及 Owner-sealed
Composer 和 Market Data locator/digest。这些值只是证据定位器，不是选择权威；replay-policy locator 或 value
不是 caller input。只有 R&D Owner 能够解析 family-sealed policy 并组合完整规范 Replay request；caller 不能
提供或覆盖 runtime/model profile、replay window、calendar/session/time zone、deterministic seed、diagnostic
policy、correction rule、market semantics 或任一 historical cut。

在同一个 `commit_v2` 事务内、第一笔 `INSERT` 之前，R&D 必须锁定并重新读取 composition 使用的每一项规范
Owner fact，包括 Artifact-family binding、family root 与当前 Census Frontier、Composer fact 和 Market Data
cut。对于 policy，composition 只使用永久密封在 family 内的完整 canonical policy bytes/digest、grammar/parser
identity/digest 与 catalog record identity/version/digest；绝不把 Catalog 重新读取为 authority。任何 input
缺失、过期、摘要不匹配、跨来源拼接或被 caller 覆盖，都必须拒绝操作，并保证 Replay request、receipt、
outbox 与 head 全部零变化。Backtest 只接收由 R&D Owner 生成的密封 request，且只拥有其 result；它绝不创建
request 或选择 execution policy。

formation 时 catalog record 缺失、stale 或 revoked，identity/version/bytes/digest mismatch、catalog-to-family
cross-splice，或任何 prohibited source 到达 formation，都必须在 mutation 前失败，并对 family、Replay
request、receipt、outbox 与 head 全部零写入。family 一旦成功形成，其嵌入的 policy bytes/digest 与 catalog
record identity/version/digest，以及 grammar/parser identity/digest 即永久冻结。后续 catalog version、
revocation、deletion、unreadability 或 storage tamper 既不能替换它们，也不能使已形成 family unavailable。

Replay composition 只验证 family-sealed canonical policy bytes/digest 在已密封 grammar/parser
identity/digest 下成立，并验证由这些密封值重建的 embedded catalog identity/version/digest cross-binding；
它不执行 Catalog authority lookup。可选 Catalog reread 仅用于 audit，不能影响 admissibility；后续 Catalog
deletion、unreadability、revocation 或 tamper 不能使已形成 family 失效。family 内部 canonical-bytes、digest、
grammar/parser 或 cross-binding mismatch 会让 Replay V2 unavailable，并对 Replay request、receipt、outbox
与 head 全部零写入。formation 与 composition 都不得通过选择 default 或更新的 catalog record 修复任何失败。

该设计既不增加第二个 request aggregate，也不增加新 Owner。它保留
`StrategyDesignV2 -> StrategyPlanV2 -> StrategyArtifactV2 -> ProgramHostV2`、既有 R&D request identity 与
custody，以及 response-loss recovery：准确 `RESOLVE` 只能恢复同一份既存密封 request meaning，不能组合
replacement、改变 policy，或创建第二份 request、receipt、outbox 或 head。只有实现完成，并由真实 disposable
PostgreSQL Owner readback 与 end-to-end 第一方验收证明完整 composition 和每种零变化拒绝后，该
TARGET 才能获准；它不授予 production 或 trading authority。

<a id="strategy-shape-envelope"></a>

## TARGET - 策略形状包络

用户于 2026-09-27 定下这个目标，原话是：「你的设计要增强表达力 用设计承接住我要的那种可能形态的策略形状
多周期多标的是肯定的」，以及「目前的设计也不一定是最好的 有时候比起扩展还有可能推翻重新设计」。点到的形状有：
突破与区间、支撑与阻力、K 线形态与指标、多周期多标的策略、斐波那契位。消费者是用户自己的语料：每一种形状都必须
经编写语言编译成 Bounded Feature Program，并在多帧 Backtest 上跑到报告。第一次可执行验收（F）保持它的单品种
永续范围，本节的一切都排在它之后。这里不准入任何 Paper 或 Live 路径、生产写入或交易，也不新增第二个策略解释器
或运行时：每一种形状仍然降级为 Bounded Feature Program 与共享生命周期内核。

**为什么这是重新设计而不是扩展：** 从成员数那几片起，F 的每个阻断都是改掉一条路径上的一个数来修的，之后下一条
路径又拒绝同一个形状。它们同出一因：形状元组 - 角色、成员、窗口、周期 - 没有单一 Owner。它被编码成变体（精确
品种对 universe 成员；单一目标对成员目标集）和常量（一到两个成员、至少两帧、一天周期的 OPEN 与 CLOSE、每次组合
一个 PIT 时刻），又在七个面上重复声明：Design 角色、角色条目、Market Data 绑定请求、Composer claim、Bounded
Feature Program 输入、Plan 绑定、Research scope 及其 PIT 请求。逐个扩展这些常量只会重复同一个模式；下面的目标
改为删掉这些变体。

同一条路径上还出现了另外两种压力形状。包络不消除它们，所以记下来留到 F 之后评估。一种是消费方按一个从未建出的
产出者建好了，其范围由「包络对 F 的假设」一节划定。另一种是用全局扫描代替按身份精确读：一次 Research 提交、当前
Research 锁与历史 readback 都会准入存储里的每一份 Research custody，读两遍，第二遍还带共享行锁，所以一份验证失败的
custody 会挡住之后的每一次提交，而成本随整个历史增长。

### 前置切片

- **P0，形状元组只有一个来源：** 陈述了 scope 的 Research 请求带成员集，Design 带角色集（P1），TrialFamily 封存的
  回放策略带可接纳的回放区间；其余每个面都从它们推导，不再各自声明。运行的实际窗口由在该区间内组合的 Market Data
  facts 推导，绝不在旁边另行给出。在陈述了 scope 的请求下，精确品种就是一成员 universe，所以 Design 不得指名品种：
  发布、冻结或声明这样的 Design 以 `DESIGN_ROLE_NAMES_INSTRUMENT_UNDER_RESEARCH_SCOPE` 拒绝。凡是随成员数不同的
  东西，例如 Market Data 的 PIT 请求 preimage 域，都由成员数推导，不在旁边另行声明。对陈述了 scope 的 Research
  请求，改成员数只改 scope、加一个角色只改 Design 时，P0 才算完成。它本身不改动任何已准入的界。V2 请求不陈述
  scope，仍是 legacy 的 exact 通道，它的 Design 照旧指名品种；退役它是 T1 之后的一个独立切片，前提是每个在 V2 下
  创建 exact 托管的链路条目都有了陈述 scope 的替身。
- **P1，角色集来自 Design：** 原生 Plan 契约不再固定为一天周期的 OPEN 与 CLOSE。Design 用它已有的字段声明自己的
  角色、执行角色和定价角色，也就是各角色的 field semantic 和 join 的 trigger，不新增字段。universe 角色必须是
  `I128` 的 Market Data BAR open、high、low、close 或 volume 角色，target-set Host 用自己的原生 bar 核对它；其他角色以
  `TargetSetRoleNotHostBindable` 拒绝。为订单定价的角色是唯一读 BAR close 的那个角色，它同时也是执行角色：没有这样的
  角色是 `ExecutionPricingRoleAbsent`，不止一个是 `ExecutionPricingRoleAmbiguous`，由别的角色触发的 join 是
  `ExecutionRoleNotPricingRole`；今天没有东西构造出后者，因为 universe 角色上的 join 会先被拒绝。Host 从 Plan 读取它的
  成员角色和定价角色。角色的周期标签仍然只是 provenance，所以这里不从它推出执行周期：Market Data 从自己的 binding
  取执行角色的 typed 周期，周期不止一种、或者某种日它无法 typed 时按名拒绝。这项调度改动取代
  `native_replay_scheduling_v1` 里的标签比较，归 Market Data。
- **P2，报告陈述每个成员：** 报告族陈述 universe 运行的每个成员，把 Backtest 已经做到的一成员陈述推广开。它与 I2
  一同落地，由第一个超过一个成员的运行驱动：I2 之前没有程序读第一个成员以外的成员，陈述每个成员就无物可陈述。

### 时间：PIT 窗口托管

PIT 快照仍然是一个时刻，Market Data 的快照路径、它的封印以及 F 使用的 quote cut 端口都不变。多帧 Backtest 改读
一份 **PIT 窗口托管**：这是 Market Data 新增的只追加聚合，把整个窗口的回补历史一次性放进托管，再由 Market Data
逐帧从中派生出满足帧回执已经在核的那些 batch 不变式的一瞬视图。托管契约由 Market Data 的 Owner 页陈述。它取代
下文的帧序列 profile（该 profile 没有调用方），因为那个 profile 每帧要一次外部 PIT 快照提交和一次调度提交：两年
日线约 730 次，一年一分钟线约 520,000 次，而且所有帧必须同一周期。

- 每帧有两个时刻：`e_k` 是定义该帧的执行周期那根 bar 的收盘，`d_k` 是按 Source Binding 上声明的可得规则该帧
  数据变为可见的时刻，且满足 `d_k < e_{k+1}`。帧从执行周期的 Owner BAR schedule 枚举，绝不从托管行枚举，所以缺
  一根 bar 会拒绝该帧，而不是跳过它。
- 最后一帧 `N` 没有后一帧，所以 `e_{N+1}` 是同一 schedule 在 `e_N` 之后声明的下一次收盘，也就是晚一个执行间隔，
  因为只接纳固定间隔的执行周期。窗口的终点不早于 `e_{N+1}`，于是最后一帧的 quote cut 和其他帧一样有
  `(d_N, e_{N+1})` 可以落。单帧运行就是 `N = 1` 的情形：窗口终点若是 `e_1` 加一纳秒，帧与终点之间就没有任何严格
  居中的时刻，推不出 quote cut。
- 派生视图的 decision cut 是 `d_k`，绝不是托管的铸造 cut：否则每个读 decision cut 的地方看到的 cut 都比该帧
  实际的晚。视图的顺序检查是 event ≤ available ≤ publication ≤ `d_k`。
- 多周期角色（切片 T2）在帧 `k` 解析为它自己周期的 Owner schedule 在 `d_k` 之前最后一次收盘的那根 bar，而且
  必须恰好是那一根；中间有缺口就拒绝该帧。binder 只对托管视图按来源放宽它的单一 trigger 检查：trigger 是执行
  角色那一行，其余每个角色各带自己的生命周期坐标，并满足 available ≤ `d_k`。
- 成员集整次运行固定。某成员的 Instrument Master 有效期或 Universe 成员资格在窗口内开始或结束，就以
  `WINDOW_MEMBER_NOT_VALID_THROUGHOUT` 按名拒绝整次运行；今天没有任何东西能构造出这个拒绝，因为托管还不存在。
- 某帧没有完整截面，就以 `PIT_WINDOW_FRAME_NOT_COVERED` 拒绝整次运行，并写出 `e_k` 与阻断原因；今天同样
  无法构造，理由相同。
- 托管运行的 Backtest 结果托管绑定托管 identity 与有序的视图 identity。

帧序列设计原先守住的每一条不变式都有新落点，只有一条例外：

| 不变式                                                                | 今天在哪里                    | 窗口托管下在哪里                                                                       |
| --------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| 一个 batch 是一个时刻                                                 | Market Data PIT 快照          | 每个派生视图在 `e_k` 上是一瞬；T2 下只有非执行角色对齐到各自最后一次收盘               |
| 行内时间顺序与单一时钟                                                | PIT batch 校验                | 视图行：event ≤ available ≤ publication ≤ `d_k`；retrieval ≤ 铸造 cut 留在托管证据里   |
| 每帧同一成员集、角色集、Instrument Master cut、周期、venue 与账户范围 | 帧序列 V2                     | 不变：成员集固定，有成员不能全程有效就拒绝整次运行                                     |
| 不留缺口、不跳帧、调用方不能提供帧列表                                | 帧序列 V2                     | 帧从执行周期的 Owner schedule 枚举；缺口即 `PIT_WINDOW_FRAME_NOT_COVERED`              |
| 取最新可见更正、绝不回退到被取代版本、有歧义的分支拒绝                | 帧序列 V2 与 quote cut census | 在 `d_k` 上按截面选版本；分支拒绝该帧                                                  |
| 单凭 BAR 回执不能授权成交                                             | 帧序列 V2                     | 每帧仍需自己的派生 quote cut，严格落在 `(d_k, e_{k+1})` 之内                           |
| 按准确定位重读逐字节相等                                              | 帧序列 V2                     | 托管提交后不可变；视图 identity 可重算                                                 |
| 受验 batch 只能来自已提交的快照                                       | Market Data 封印              | 第二个受封来源 `CustodyView`，自带 `compile_fail` 与篡改测试                           |
| 不看未来                                                              | 快照边界                      | 声明的可得规则、在 `d_k` 上选版本、binder 的 available ≤ `d_k`；该规则是声明，不是观测 |
| **每帧各自带有铸造 cut 与可信时钟证据**                               | 帧序列 V2                     | **没有同等的新落点**：托管只铸造一次。授权见下                                         |

最后一行收窄了一条已陈述的性质。用户于 2026-09-27 选择了下面这个选项，以此授权：「换成窗口托管。回补的历史按
整段一次放进托管；每根 bar 何时可见，由 Source Binding 上声明的规则推导；实时交易仍然每个时刻取一次快照。用户
授权收窄『每帧各自带有铸造证据』这一性质的适用域：在回测里，帧不再各自带铸造证据，并且只准入回补的历史。」因此
窗口托管只准入对回补历史的回测。

切片：**T0** 是 Market Data 托管（截面更正模型、可得规则、帧枚举、派生视图、`CustodyView` 封印）；**T1** 由它
组合单周期 N 帧 Backtest；**T2** 在 P1 之后加入多周期角色；**T3** 按角色预热，预热期内输出中性成员目标。它们
的证伪条件现在就定下：N=1 以及两帧单周期数据，在值、坐标、事件时间、bar 类型与成员顺序这组投影上必须等于快照
路径；两份只差「某个更正是否在 `d_k` 之前发布」的托管，帧 `k` 的值必须不同，去掉 publication 条件必须变红
（Binance 不发布更正流，所以由合成源驱动）；可得规则设为铸造时刻时，每一帧都必须看不见；去掉 available ≤ `d_k`
检查，T2 的前视测试必须变红；同一根高周期 bar 在相邻帧上必须带逐字节相同的坐标。

### 成员：一个参数

Research scope 是成员集的唯一来源（P0）。一到两个成员的界变成一处声明的上界。用户于 2026-09-27 选择了下面这个
选项，以此授权放宽用户路径：「放宽到 N。上界暂定 16，等 I1.5 量完 `max_edges` 再定。」冻结的程序只对它自己的成员
数有效；换成员集就是一次新的 Research。

- **I1** 把上界变成一处声明，把目标集变成有界变长，并删掉 Host 里单一与成员两条分支。Market Data 保留一成员 PIT
  请求的 preimage 域，所以已存的一成员请求 identity 不会重新定键；成员域承载两个及以上。
- **I1.5** 在定下上界之前，量出按成员展开后的边数与图上界的关系。
- **I2** 给 Bounded Feature Program 加成员维：程序里按下标引用，编写语言里按成员广播，跨成员归约（rank、mean、
  minimum、maximum、第 n 名）作为追加的 catalog primitive。rank 取平均秩，所以并列的成员共用一个秩，置换成员就
  置换它们的秩；第 n 名返回第 n 个顺序统计量的值，任何置换都不改变它。这会改动受管面，四条更便宜的路各自走不通：
  新字段语义值不行，因为成员轴不是数据含义；新 catalog primitive 不行，因为它作用于图里已有的值，造不出按成员的
  端口；新动作 catalog 项不行，因为它仍需要一个产出目标集字节的终端；已有节点的组合不行，因为没有节点带目标集
  类型。改动是输入 meaning 上一个可选的 `member_ordinal`，以及一个把 N 个成员权重变成规范目标集的终端。编码器
  在 `member_ordinal` 缺省时省略它，所以每份已冻结的 meaning 重新编码后字节与摘要都相同，这就是 I2 的证伪条件。
  meaning 的 schema 版本不变且保持封闭：I2 之前的解码器拒绝带 `member_ordinal` 的字节，这与「冻结的程序只对它
  自己的成员数有效」一致。
- **I3** 加总敞口与净敞口上限，作为 Design 合法性约束，而不是 Risk 决策；超限的提议以
  `TARGET_SET_EXPOSURE_CAP_EXCEEDED` 拒绝，今天没有任何东西能构造它，因为还没有成员维。

证伪条件：N 次一成员运行与一次互不交叉的 N 成员运行，在每单位目标与成交上一致（不比权重，权重共享同一份权益）；
置换成员后，每个归约不变，成员目标随之置换，
有并列的输入也一样。

### 值、输入与动作

- **值：** catalog V4a 追加窗口 rank 与百分位、距极值的 bar 数、协方差与相关。catalog 版本 4 发布了前两者，它们的
  首批使用者 `w1` 与 `w2` 已在手写语料中；之后的版本追加的行，在有手写程序使用之前构建就会拒绝它。协方差与相关需要
  一个双序列窗口状态，仍是 TARGET。V4b 追加自然对数与指数。用户于
  2026-09-27 选择了下面这个选项，以此授权它们的数值规则：「引入 ln/exp，钉住算法加 golden 测试向量，只适用于新增
  的 catalog 行；这一类运算豁免『一个精确表达式、最后只舍入一次』。」V5 增加两条定槽状态规则：一个定桶数组，以及最近 N 个事件的
  记忆，每个槽存一组冻结的值。把 Bollinger 方差写成
  `Mean(x²) − Mean(x)²` 时必须用 `Select` 守住被开方数，因为两项各自舍入。
- **输入：** 资金费率与持仓量扩展既有的 Binance futures PIT 源，追加行字段与字段语义（N1）。已结算的 funding 行已经就位
  （见 Market Data 的「Binance 永续已结算 funding 行」）；持仓量的行与 Design 可以引用的字段语义还没有。Binance 公开归档
  有标记价、指数价、溢价指数 K 线、metrics、盘口深度与资金费率的历史。强平没有已准入的历史源 - USDⓈ-M 归档没有，
  币本位 `BTCUSD_PERP` 快照止于 2024-10-14 - 所以要它的 Design 以 `INPUT_FACT_UNAVAILABLE_FROM_ADMITTED_SOURCE` 拒绝，今天没有
  任何字段词表能让 Design 走到这里。
- **动作：** 两帧之间成交的保护单在 `kernel.fill.reconcile.v1` 下对账（D1）。D1 之前目标集 Host 忽略这种成交，
  于是下一帧对账失败、整次运行中止。现在 FILL 用信封里的一个字节写明它推进的是哪条腿 - 待成交意图、止损或止盈；
  此前的 FILL 这个字节都为零，所以此前的信封字节与摘要都不变。内核只在该腿已布防、没有待成交的提议、且成交只减仓
  不越过零时接纳保护单成交，其余情形各按名拒绝：`ProtectiveLegNotArmed`、`ProtectiveFillWithPendingIntent`、
  `ProtectiveFillDoesNotReduce`。部分成交的保护单占住成交前沿，直到它成交完或余量被撤销，期间任何提议都不能在旁边
  开出意图（`ProtectiveFillInProgress`）。把仓位平掉的那条腿会清除保护，Host 只下内核持有的保护。Native Replay 读回
  把保护单成交与目标集成交分开上报，在有序轨迹里把每笔绑定到它的 FILL 转换，并把它算作往返的退出；没有保护单
  成交的运行序列化结果与之前相同。`a_triggered_stop_reconciles_the_member_flat_and_the_run_continues` 跑两个真实
  的 Sim 帧：止损成交，退出帧看到该成员已平仓，而照样要退出它的程序以 `InvalidPositionTransition` 被拒；
  「近止损但价格不下破」和「价格下破但够不着远止损」是它的两个干净对照。A1 把 `DecisionTime` 与 `AccountEquity`
  （以及按成交计的入场价与持有 bar 数）作为程序可读的 `LifecycleContext` 值开放，其中 `DecisionTime` 是该帧的 decision cut `d_k`；按意图计的入场价与持有 bar 数
  已经能在程序内表达。A2 把止盈下成 reduce-only 限价单。A3 先量「每根 bar 一张限价单」的阶梯，不够才增加内核
  阶梯。

### 覆盖语料

每一种形状至少有一个参考策略，每个都必须经编写语言编译，并在多帧 Backtest 上跑到报告，由它的链路条目按测试名证明。
语料与每一项需要的切片：

| 形状                  | 参考                                         | 需要               |
| --------------------- | -------------------------------------------- | ------------------ |
| 均线交叉              | C1                                           | P0、P1、T1         |
| 突破加 ATR 止损       | C2，吊灯止损                                 | P1、T1、D1         |
| 超卖反转加趋势过滤    | C3                                           | P1、T1             |
| 区间四分              | 罗尼 S3，4h                                  | P1、T1、A1         |
| 支撑阻力限价单        | 罗尼 S1，4h 结构、1h 执行                    | P1、T2、A1、A2、V5 |
| 大实体突破            | 罗尼 S2b                                     | P1、T1、A1         |
| 斐波分层进场          | 罗尼 S4                                      | P1、T1、V4a、A3    |
| 关键位逆势短单        | 罗尼 S5                                      | P1、T1、D1、A1     |
| 布林状态过滤          | 罗尼 F1(c)，带 `Select` 被开方数守卫         | P1、T1             |
| 周线动能              | 罗尼 F2，周线信号、日线执行                  | T2                 |
| 独立多品种            | F2 分别跑 BTC 与 ETH                         | I1                 |
| 跨品种条件            | BTC 趋势过滤 ETH                             | I2                 |
| 配对价差              | BTC 与 ETH 的 z 分数                         | I2、V4a            |
| 截面轮动              | 八选二按动能                                 | I2、I3             |
| 资金费率过滤          | 资金费率极值反向                             | N1                 |
| 动能背离              | 价格对 RSI 或 MACD 柱在两个已确认拐点上比较  | P1、T1             |
| 上升与下降楔形        | 过最近两个已确认高点拐点与低点拐点的两条线   | P1、T1             |
| 三推与五推            | 在已确认拐点上计推动次数，结构须守住         | P1、T1             |
| 公允价值缺口          | 三根 bar 的缺口占固定槽，直到后来的 bar 回补 | P1、T1             |
| 流动性扫单            | 影线刺破已确认拐点，收盘回到它的近侧         | P1、T1             |
| 交付状态转换          | 收盘越过反向序列第一根 bar 的开盘价          | P1、T1             |
| 罗尼画线规则 R1 至 R6 | 水平与宽区域、趋势线带、斐波、四分、周期角色 | 见下               |

罗尼的画线规则取自他 17 个视频的 2,512 张截图测量，归纳成六条可计算的规则。它们需要这些切片：

- **R1 与 R2，水平区域与宽区域：** P1、T1，以及 V5 的「最近 N 次反应」记忆，每个槽存一个摆点的影线极值与最近
  实体边；聚类、外沿与内沿、厚度 clip 都是对这些槽的归约，ATR 今天就能表达。order-k 摆点是一个 lag 加一个居中
  窗口的最大值或最小值。
- **R3，趋势线带：** P1、V4a 的「距锚点的 bar 数」，以及编写语言的 `capture` 与 `latch`，用来在事件发生时移动
  锚点。线值是两个锚点的线性外推，只做一次最终舍入；交易需要的是这个值，不是画出来的坐标。
- **R4，斐波：** P1、用 V4a 要求高点在低点之后，以及 `capture`；档位是冻结的有理数，罗尼的 0.764 是 191/250。
- **R5，四分：** 对上下两个 R1 或 R2 区域内沿的算术。
- **R6，周期角色：** T2 覆盖日线定方向、4h 定结构、1h 执行，加上 A1 定仓位与 V5 的区域；它是 T2 的验收范例。

对这些规则，编译通过不够。R1 至 R6 每一条都带一个在真实数据上的行为正控：程序在每个被测帧所显示的品种、交易所、
周期与窗口的公开 K 线上运行，它算出的区域边沿、线值与斐波档位，必须在测量本身的误差内与从那些帧上量出的价格
一致 - 帧上自己印出了价格时，每条边约一美元、区域厚度的 0.9%，其余情况为该帧价格刻度上的两个像素。这个正控分
两半，使得一次不符只有一个成因：程序的输出必须与同一条规则的直接参考计算逐位相等，这检验的是编译出的程序；该参考
必须在容差内符合量出的价格，这检验的是规则本身，以及测量时补上而非观测到的参数。它要在 T1 与 V5 之后才能构造。

动能背离、楔形、三推与五推建立在同一个构件上，即已确认拐点，除 P1 与 T1 外不需要别的切片：

- **已确认拐点：** 位于 bar `t - k` 的 order-k 高点拐点，恰在 `Lag(high, k)` 等于 `Maximum(high, 2k + 1)` 时于 bar
  `t` 被确认；低点拐点同理，对 low 取 `Minimum`。目录里的 `SwingHigh` 是尾随窗口里最高的那根 bar，仍在上涨的
  bar 也算，所以它不是拐点。拐点总是晚 k 根 bar 才知道，这个滞后就是定义本身，不是实现的限制。
- **背离：** 看跌背离是新确认的高点拐点严格高于前一个，而新拐点处的指标 `Lag(indicator, k)` 严格低于前一个拐点
  处的值；看涨背离在低点上镜像。信号在确认那根 bar 发出。前一个拐点的价格与指标是两个定点策略状态格。`d1` 是
  日线收盘价上以 RSI(3) 判定的看跌背离，也是第一个声明它们的已编写程序：
  `a_divergence_program_carries_its_previous_pivot_through_fixed_point_state` 把它构建成 Wasm，它只在第二个
  拐点之后两根 bar 处出场；每根 bar 前把这两个格放回零种子，出场就消失，而拐点照样被找到。
- **楔形：** 过最近两个已确认高点拐点与最近两个低点拐点各画一条线。两条斜率都为正且下线更陡时为上升楔形，镜像
  情形为下降楔形；它声明一个收敛比例和一个以 ATR 计的突破容差。线在当前 bar 的值是 `p2 + (p2 - p1) * a / b`，
  其中 `a` 是距后一个锚点的 bar 数，`b` 是两个锚点之间的 bar 数；减法、乘法与加法在各自声明的精度上都是精确的，
  所以除法是唯一一次舍入。过三个及以上拐点的线需要 V5 的记忆，且每个节点各舍入一次，定义必须声明这一点。
- **推动：** 每当新确认的高点拐点严格高于上一推、且两推之间的低点拐点严格高于再前一个时，计数加一，否则重新
  开始；由三个策略状态格承载。在 4h 上读推动、在 1h 上进场属于 T2。

每一项都有一个合成正控，把信号 bar 钉死：背离恰在拐点加 k 处、绝不提前；平行通道不产生楔形；结构被破坏时计数
重新开始。另有一个真实数据正控：在公开的 BTC K 线上，程序的拐点与信号必须与该定义的一份独立参考实现逐一相等。
这三种形态在这里没有人工标注的真值，所以检验的是程序对它的定义，不是程序对交易员。

三种 ICT 形态，即公允价值缺口、流动性扫单与交付状态转换，同样除 P1 与 T1 外不需要别的切片：

- **公允价值缺口：** 在 bar `t` 上，最低价严格高于 `Lag(high, 2)` 时为看涨缺口，缺口就是两者之间的区间；看跌缺
  口在镜像情形。缺口保持未回补，直到后来某根 bar 回到缺口里，这就是信号，随后缺口被清掉。每个未回补缺口占三个
  定点策略状态格：上沿、下沿、是否未回补；程序声明它持有几个缺口，以及所有槽都被占用时新缺口替换最旧的一个。
  V5 的「最近 N 个事件」记忆就是把这条规则变成一条声明；今天用 `Select` 手写出来，缺口不必等 V5。`g2` 与 `g3`
  是同一个看涨缺口程序的两个槽与三个槽版本，是继 `d1` 之后经 Wasm 证明其状态的已编写程序：
  `a_fair_value_gap_program_evicts_the_oldest_gap_only_when_its_slots_are_full` 形成三个缺口，两个槽时第三个挤掉第
  一个，于是后来回到第一个缺口区间的 bar 不发信号；同样的 bar 在三个槽时发出信号。
- **流动性扫单：** 在 bar `t` 上，最高价严格高于最近一个已确认高点拐点、而收盘价严格低于它时为看跌扫单；看涨扫
  单在低点上镜像；拐点占一个状态格。一根 bar 的最高价与收盘价说不出 bar 内部什么时候越过了那个价位，所以信号
  在扫单那根 bar 收盘时发出；要在刺破的那一刻进场，需要 T2 的更低周期或报价数据。拐点总是晚 k 根 bar 才知道，
  所以扫过一个尚未确认的拐点是看不到的。
- **交付状态转换：** 一个序列是收盘价都落在各自开盘价同一侧的连续 bar。在 bar `t` 上，若此前是一段不短于声明
  长度的看跌序列，而收盘价严格高于该序列第一根 bar 的开盘价，则为看涨转换；看跌转换在镜像情形。一个计数器和
  那根 bar 的开盘价是两个状态格，开盘价在计数器离开零时捕获；它与推动计数是同一类结构。

它们的正控沿用上面的形式：合成正控把信号 bar 钉死，即没有 bar 回到的缺口不发信号，刺破拐点但收盘没回来的影线
不算扫单，收盘价等于序列第一根开盘价不算转换；真实数据正控要求程序在公开的 BTC K 线上与一份独立参考实现相等。

ICT 方法里有两部分不属于这些形状。时段窗口（killzone）今天表达不了：没有哪个输入事实是一天中的时刻，也没有
哪个目录行能把样本坐标（它带着样本的时间）变成时刻。补法是追加一个目录行，从样本坐标读出 UTC 小时与分钟，这
需要一个新的目录版本，以及 kernel、golden 与 lowerer 的改动；V3 构建胶囊绑定目录与 lowerer 的源码摘要，所以此
后构建的每个程序都带上新的构建身份。以纽约时间表述的窗口会在每次夏令时切换时移动一个 UTC 小时，这个目录行不
表示这一点，所以 Design 要声明它指的 UTC 窗口。把高周期的缺口与低周期的交付状态转换组合起来属于 T2。

### 包络对 F 的假设

包络自己不增加任何生产路径：每个切片都经 F 的验收所建立的路径跑 Backtest。这条路径的第一代 Replay 与 legacy 路径一样，
绑定的是 family 形成时的前沿，因为 family 在任何 attempt 之前形成，而 attempt 是一个已经产出 Result 的 Replay。所以第一代
Replay 不需要 attempt cut，也不需要 R&D Decision composition，上面每一个语料项都是第一代运行。后继 Replay - 同一 family
的后一轮研究 - 读的是 TrialFamily Census V2，它需要 attempt cut，而 attempt cut 唯一的写入者在等 Decision composition
消费方；后继在 R&D Owner 里仍是 `TARGET / NOT_ADMITTED`，包络既不需要它们，也不建它们。凡是在同一个 family 上迭代的验收都会
依赖那个产出者，届时单独列出。

### 顺序与以后要问的

P0、P1 与 T0 并行推进：T0 在 Market Data 内部，它的托管请求自己陈述成员集与周期。T1 依赖这三项，因为它从
Research scope 与 Design 推导出托管请求；T1 的首个正例只用 CLOSE 和一个成员，它需要的 D1 已先行落地。P2 与 I2 一同落地。A1 与 V4a 与 T1 并行；然后 T2、I1、I1.5、I2、
I3；再然后 N1、A2、A3、V4b、V5。按帧 as-of 成员（T4）会移除「每帧共用一个成员集」这条不变式，所以在提出它时再
问用户。

单阈值编写器接受的每一种目标变体，都能在 target-set Host 上跑过一帧。曾有两种不能，各是一片，排在 F 之后、T1 之前，
两者都在 `main` 3a465a537 上实测过：现状为红，在一个随后还原的临时改动下越过了点名的那道检查；在各自那一片落地之前，
编写器按名拒绝它们。

- **Rebalance 序号。** Host 按上面那条规则分配序号，编写器写 `0`。常量为 1 时只有第一帧能提升；拿掉 Host 的分配而写
  `0` 时，连第一帧也不能。`an_authored_rebalance_program_lifts_three_consecutive_frames` 把编写出的程序构建成 Wasm，经
  target-set Sim 跑三帧，进场、出场、再进场，序号依次为 1、2、3；
  `a_single_instrument_host_assigns_each_rebalance_the_next_sequence` 守住单品种路径。
- **Weight 对账。** target-set Host 在对账时从权益与价格推出 weight 成员的 grid 仓位，并拒绝一个已经带着 reconciliation
  target 的 weight 成员，而 Host 除 `Keep` 以外对每种目标都解码出一个，所以 weight 一侧在第一帧就以 `InputCoverage`
  失败。越过这道检查后，该帧以 `InvalidPositionTransition` 失败，因为编写器让两侧共用一个为 0 的 target weight。现在
  Host 对 weight 目标不解码 reconciliation target，每一侧各自声明 `target_weight_micros`：只有 weight 一侧可以给出它
  （`SINGLE_THRESHOLD_WEIGHT_NOT_READ`），且只能在正负 1,000,000 micros 之内（`SINGLE_THRESHOLD_WEIGHT_OUT_OF_RANGE`）；
  不给出 weight 的请求字节不变。`an_authored_weight_program_enters_exits_and_enters_again` 让编写出的程序跑同样的三帧。

rebalance 那次运行找到了一个任何变体拒绝都没覆盖的缺陷：编写器让两侧共用一个 protection，即 `keep`，而内核在出场时拒绝
`keep`，所以没有哪个编写出的程序能出场。现在每一侧的 protection 跟随它的意图：出场清除，其余各侧保持；
`every_authored_side_runs_through_the_kernel` 把每一个编写出的侧，从它可能被提出的每个仓位，施加到一个真实的生命周期
内核上，于是一个本该跟随各侧却被共用的终端，会在那里失败，而不是在之后某一帧。

## TARGET - Research 运行到出策略为止，由花费约束

用户于 2026-09-27 决定：Research 不因试验次数停下；每次试验都记账并跨轮累计，Qualification 的折扣随这个计数增长，随机对照
与留出数据保留，一个用户设定的花费上限约束 Research 的花费。[R&D](../owners/rd/#target---cumulative-trial-accounting-and-the-spend-cap)
定义一次试验、它累计所跨的血缘、移除与花费上限；
[Qualification](../owners/qualification/#target---cumulative-trial-deflation-at-candidate-intake) 定义打折。这些都不阻塞 F，
在 F 之后按以下顺序实现：

| 切片               | Owner                               | 内容                                                                                    | 之后                 |
| ------------------ | ----------------------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| TB1 血缘试验计数   | R&D                                 | 生产 census 追加、`trial_count`、在所绑定前驱前沿上的血缘求和                           | Decision composition |
| TB2 累计打折       | Qualification                       | 在 Candidate Intake 处按推导出的计数打折、跨 family 的保护性尝试计数                    | TB1                  |
| TB3 随机对照       | Qualification、R&D、Backtest        | 已规定的定义、合成与重放，按此顺序                                                      | 无                   |
| TB4 花费账本与上限 | R&D、R&D Owner client、Product Edge | 用量采集、预留与结算、`PAUSED_SPEND_CAP_REACHED`、环境设定的上限，然后是 Dashboard 控件 | 无                   |
| TB5 移除试验上限   | R&D、Product Edge、Dashboard        | 没有预算的 TrialFamily Policy V2，对 V2 family 去掉准入拒绝与 `TRIAL_BUDGET_EXHAUSTED`  | TB1、TB2、TB4        |

TB1 现在还不能开工。它计数的是
[R&D](../owners/rd/#target--not_admitted---same-cut-decision-and-selection-composition) 中同一截面的 Decision 与 Selection
composition 所做的 census 追加，而这个 composition 本身是 `TARGET / NOT_ADMITTED`：在它被准入并建成之前，后继迭代没有生产
路径，也不存在可计数的 census 追加。TB5 排在最后，因为它移除的正是其他几片所替代的约束：TB2 之前没有东西会给长时间的搜索打折，TB4 之前没有东西会约束它的成本。
TB3 本来就是任何 Eligibility 的条件，所以不论顺序如何它都约束 Qualification。一条血缘停止后接着做什么，即来自 Source Intake
的新假设，不在这几片之内。

## 价值流交接

R&D、Backtest 与 Qualification 之间的阶段关系恰以下列对象跨越价值流。每个 Owner 页定义自己发出的对象，接收页
重复自己接受的内容；本页只把它们列在一起，让价值流可以从头读到尾。

- R&D → Backtest：一个 R&D 拥有的冻结 Exploratory Replay Request，绑定准确的 Artifact、PIT 范围、重放配置以及成本
  滑点与容量模型身份。相同请求身份与规范字节加入同一个 attempt；含义变化即冲突，不执行任何写入。
- Backtest → R&D：每个请求对应一个 Exploratory Run Result，状态恰为 `RUN_REJECTED` `IN_PROGRESS_OR_UNKNOWN`
  `TERMINAL_RESULT` 或 `INVALID_REPLAY_EVIDENCE` 之一，重复每个实际消费的执行定义身份与完整有限的
  `diagnosticCategorySet`。只有请求相等的 `TERMINAL_RESULT` 能进入 Research Selection；其他 attempt 只保留为
  TrialFamily Census 事实，最多只能产生 `REPAIR_INPUTS`。
- R&D → Qualification：一个带终态 `SELECTED_FOR_QUALIFICATION` Research Selection Disposition 的冻结 Candidate，
  由稳定的 Qualification Review Request 承载，交叉绑定冻结的 Intent 证伪条件与停止规则、完整预注册、不可变且穷尽的
  TrialFamily Census Frontier、探索请求/结果前沿、跨 family 前驱前沿、预提交的独立性依据、保护反馈观察前沿、
  Protected Robustness Plan，以及预注册的保护决策策略身份与版本。
- Qualification → Product Edge 与 R&D：一个只写一次的 Candidate Intake Receipt，`ADMITTED` 或 `NOT_ADMITTED`，
  关闭该准确的评审请求。回执缺席保持 `SUBMITTED_OR_UNKNOWN`，任何状态摘要、传输成功或事件投递都不能替代它。
  `NOT_ADMITTED` 不创建保护 attempt 也不消耗 holdout。随后 Qualification 在隔离中向 Backtest 请求并消费保护重放，
  且不向 Research 返回任何保护测量。

## 保护路径

Research 在提交前冻结 TrialFamily 穷尽 Census Frontier 跨 TrialFamily 前驱前沿 预提交独立性依据 PIT 规则 成本 容量假设 预算 证伪条件和停止规则。Qualification 校验这些 frontier 预注册内容 准确 `READY_FOR_SELECTION` 决定和仅选择 disposition，并拥有相关 TrialFamily 的累计 holdout 预留与处理，再请求保护重放。仅选择 disposition 缺失 证伪条件不匹配 遗漏同族试验 试验改名 预算不符 frontier 可变 祖先未解析 独立性依据过晚 反馈前沿过期或截面后新增族成员时都在保护回放前闭合为 `NOT_ADMITTED` 且不消耗 holdout；Research 终态停止永不进入 intake，后续试验需要后继 Candidate。保护结果可以更新 Eligibility State，但绝不能反馈同一研发循环。

## Schema 冻结条件

往目录里加一个取值是常规加法。目录条目声明载荷形状，因此 schema 不会变宽：一个有界特征节点只指名一个
primitive 语义 ID，由目录合约固定该 primitive 接受几个绑定、各是什么类型。

往 `StrategyDesignV2`、`ProposalWiringV2` 或 `BoundedFeatureProgramMeaningV1` 加字段，或往 `ValueTypeV2`、
`LifecycleKindV2`、`InputFactClassV2` 加变体，都不是加法。每个这样的成员都必须由 lowerer、共享生命周期内核、
Backtest 语义轨迹、Runtime 以及每条黄金向量各自承载，所以加起来便宜的成员，留着很贵。

因此这类改动只有在证明该能力无法表达为下列任意一种之后才可准入：

- 字段语义词表中的一个新取值；
- 一条新的 primitive 目录条目；
- 一条新的 action 目录条目；
- 既有节点的一个组合。

action 目录本身是 `TARGET / NOT_ADMITTED`。在它存在之前，该替代路径解析为不可用；记录中如实写明这一点，
而不是把它的缺席当成加宽 schema 的理由。

改动本身记录排除了哪些替代路径、为什么。该记录随改动走，不进本文档：在这里维护一份已批准例外清单，
会比它所限定的规则烂得更快。

记录是否成立由评审者判断。自动检查最多只能确认记录存在并指名了那四条替代路径，判不了某条排除是否站得住，
因此检查通过绝不构成"该能力没有目录表达"的证据。

受管面是 `crates/strategy_factory/src/strategy_design_v2.rs`，它定义 `StrategyDesignV2`、
`ProposalWiringV2`、`ValueTypeV2`、`LifecycleKindV2` 与 `InputFactClassV2`；以及
`crates/strategy_factory/src/bounded_feature_program_derivation_v1.rs`，它定义
`BoundedFeatureProgramMeaningV1`。

规则跟随定义，不跟随提及。仅引用受管类型的文件不是受管面，因此只改夹具、lowerer、host 或存储适配层的改动，
即使文中出现这些类型名，也不承担举证义务。

可选字段不构成豁免。它承担与必需字段相同的举证义务，因为每个消费者仍然必须为它的缺席分支。

## 权威边界

R&D 拥有 Intent TrialFamily Artifact Exploratory Replay Request 和 Candidate 身份。Develop 是 R&D 内部能力，不是第二 Owner。Backtest 拥有重放结果且不能替 R&D 选择下一动作，Qualification 拥有 intake 状态 holdout 状态 资格和撤销。Strategy Factory 不拥有这些事实，也没有独立存储权威。

## 实现验收

每次交接都保留不可变身份 请求关联 保护反馈祖先和实际消费输入回执。R&D basis 创建必须早于任何 Qualification 保护反馈写入。Qualification 投影绑定准确 basis ref/digest principal request scope source sequence/cut clock epoch 与半开有效期；过期 畸形 不匹配或不可用权威都不能创建 S1 转换。每个探索结果都关联一个稳定且由 R&D 拥有的请求身份，不匹配时运行前失败。Candidate intake 必须证明准确 `READY_FOR_SELECTION` 决定与 `SELECTED_FOR_QUALIFICATION` disposition 交叉绑定冻结证伪条件与探索前沿，TrialFamily frontier 在截面前不可变且穷尽，并证明累计 holdout 处理不会被 TrialFamily 改名重置。终态停止不创建 Selection 不能为 `ADMITTED` 且不消耗 holdout。任何保护结果都不能改写 R&D 输入 参数或被评估的 Artifact。

首次 S1 写入前，R&D 必须持有规范 Operator Authorization、Product Edge、本地 lineage 与 Qualification 锁，完成最后一次 Qualification 回读，然后才在第一笔写入前立即采样唯一 final cut。所有结果身份与回执都绑定同一 cut，authorization、binding、manifest 与 Qualification 的半开有效区间必须在该 cut 同时仍为 current。cut 等于任一 `valid_through` 即为 stale，并且 R&D receipt、Intent、TrialFamily、census 与 outbox 全部零写入。

在该终态写入之前，已提交的 Independence Basis 阶段即为持久下游 custody：它密封完整规范 R&D 请求含义、语义摘要、Product Edge admission locator 与历史 lineage、basis 回执及 outbox。准确 `RESOLVE` 只能使用这份经验证的密封含义恢复历史完成路径，且不得创建第二份 basis、head 或 outbox；含义变化、admission 变化、仅有裸行、custody 畸形或缺失都必须 fail closed。R&D 终态回执提交后，后续 authorization 或 view 过期仍保留准确回执、Intent、TrialFamily、basis 与历史 Qualification 投影，并以 `STALE` 只读结果返回；唯一动作是同请求解析，不授予新提交、后继或 provider effect。
