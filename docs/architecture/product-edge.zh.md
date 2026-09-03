# Product Edge

## 职责

Product Edge 是应用与对话边界，把有人值守 UI 或自然语言意图转成受限请求，并返回只读产品视图。
选定的目标产品表面是 Windmill R&D Workbench；Windmill MCP endpoint 把同一组已准入操作暴露给可选
外部对话客户端。

## 目标产品表面与安装包

目标发行物是一套 VibeTrader Docker Compose 安装包，而不是一个单体镜像。它组合 Trade Runtime 与
Owner API、Windmill server 与 worker、所需持久化和本地入口。Windmill Web 应用是唯一默认产品入口，
其原生 MCP endpoint 是唯一目标对话出口，因此 LobeHub、OpenClaw、WorkBuddy 或其他兼容客户端无需
项目自有 adapter 或第二个 `trade-rd` MCP 服务即可接入。这些外部客户端只是可选 consumer，不随产品
打包，不拥有业务权威，也不作为实现验收依赖。

Windmill App 与 MCP endpoint 调用同一组经过挑选、带版本的 script 与 flow，并且只能通过有类型 Owner
port 工作。它们不能执行任意 Owner SQL、产生业务事实或保存影子 workflow truth。定时研究、scanner、
replay、报告与维护任务可以作为 Windmill job 运行并提供实时运维进度、日志、重试和 Owner-owned 工件引用。真实策略
循环、行情会话、订单状态机与恢复效果仍由 Trade Runtime、Risk、Execution 与 Recovery 拥有；Windmill
只能监督和展示，永远不是交易运行内核。

该选择仍是 `TARGET/ABSENT_TARGET_ONLY`。本地安装 Windmill、MCP 握手成功或 mock dashboard 都不能
让 Workbench 成为 `CURRENT`；验收必须覆盖下文定义的有界用户旅程、共同操作、Owner 回执、未解析
状态以及直接浏览器证据。

## Windmill 能力采用合同

已审计的实现下限是自托管 Windmill Community Edition。2026-08-18 证据截面验证了本地
`CE v1.791.0` server 与 worker 健康状态，并核对了 App、MCP、job、日志、schedule、worker、resource、
variable 的 Windmill 官方能力文档。该截面只达到 `VENDOR_DECLARED` 与 `LOCAL_REACHABLE`，不是
`PRODUCT_CURRENT`。每个产品发布都必须把 Windmill server、worker 与 CLI 固定到准确兼容版本和容器
digest；禁止 `main`、`latest` 或其他浮动 tag。

| Windmill 原语                 | Product Edge 采用职责                                                                               | 强制边界                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full‑code App                 | 一个由仓库拥有、从 `.raw_app/` 源码打包的 React Workbench                                           | 只允许登录访问和 `viewer` 执行政策。禁止 `publisher`、`anonymous` 和 `public`，因为它们会抹掉调用者的有效权限边界。                                                                             |
| Native MCP                    | 面向同一组带版本 operation 的可选对话 channel                                                       | workspace 范围 OAuth 或 scoped token 只暴露准确 allowlist。不得暴露 App、script、flow、resource、variable、schedule 或 worker 的 preview 与 create/update/delete 工具。只做 folder 过滤不充分。 |
| Script 与 Flow                | Owner port 上的类型化 adapter 与有界 orchestration                                                  | 可以路由、等待、重试和组合；不得写 Owner storage、发明业务状态，或把 flow success 变成 Owner 结果。                                                                                             |
| Job、progress、log 与 SSE     | 运行身份、实时进度、诊断和 UI streaming                                                             | Windmill job id、百分比、result 或 log 都不是 Owner receipt。自托管 CE 的 job detail 保留期有界，持久研究工件和结果事实仍归 Trade Owner。                                                       |
| Schedule                      | 触发有界 research、scanner、replay、report 与 maintenance flow                                      | schedule 不是 deployment registry、lifecycle authority 或真实策略 runtime。CE 正确性使用 flow‑level error path 和同请求解析，不依赖 Enterprise schedule error handler。                         |
| Worker 与 worker group        | 基于 queue 的执行，以及按已准入 tag 隔离工作负载                                                    | worker 丢失时业务结果保持未解析，直到查询 receiving Owner。不得依赖 Enterprise Agent Workers，也不得把它与 LLM agent 混为一谈。                                                                 |
| AI Agent flow step            | 可选的内部有界 R&D reasoning step，只获得明确准入的 script 或 MCP tool                              | Agent memory、模型输出和 tool‑call success 都不具权威性。该 step 不得获得任意 shell、Owner SQL、lifecycle、Risk、Execution、secret management 或 workspace management 能力。                    |
| Resource、variable 与 secret  | 类型化连接配置和不透明 credential custody                                                           | Windmill secret access 不是 Operator Authorization。必须使用最小权限 path；secret value 不得进入 prompt、Owner request、log、artifact 或 receipt。                                              |
| Data table 与 transient state | 只保存 UI preference 和明确可重建的非权威 cache                                                     | 禁止保存 Research lineage、receipt、Qualification、Governance、Runtime、Risk、Execution、Portfolio 与 Recovery 事实。长期工件使用 Owner storage 或已准入 object storage。                       |
| Git 与 deployment version     | App、script、flow、schedule、resource schema 与 `wmill.yaml` declaration 的 repository‑first source | UI state 是部署投影。promotion 把 Git revision、Windmill resource version、CLI version、image digest、schema version 与 rollback target 记录为一个 compatibility cut。                          |

Community Edition 下限在没有 service account、Agent Workers、schedule-level error handler、job debouncing、
critical alert、full-text job/log search、无限保留期或 Enterprise OTLP export 时仍必须正确。Enterprise 功能
可以改善隔离或运维，但不得成为业务正确性的前提。CE 中无人值守 schedule 代表专用最小权限 virtual
user 运行；EE 中可以换成 service account，但不得改变 Product Edge principal、scope、manifest 或 Owner
语义。Operator UI 可见性不是授权边界。

Windmill native MCP 包含强大的 workspace management tool，因此发布用 MCP profile 默认拒绝。只允许
经过挑选的 Product Edge operation，以及只读内置 tool `getJob` 与 `getJobLogs`。App 与 MCP
调用绑定同一个 operation version 和 semantic request；两个 channel 都不得部署或编辑自己正在使用的
operation。

无人值守执行从规范 due-slot identity 开始，并在第一次调用 Owner 前派生唯一稳定 Product Edge request
identity。retry、worker restart、timeout recovery 与 manual resolution 复用该 identity 和 meaning。如果
Windmill 不能证明 Owner 是否接受调用，run 保持 `SUBMITTED_OR_UNKNOWN`，resolver 查询 Owner receipt；
不得提交裸 successor。并行或重叠 schedule delivery 只有在 due-slot 与 Owner idempotency contract 汇合到
同一 receipt 时才无害。Flow error handling 可以通知并排队解析，但只有 Owner receipt 能闭合业务操作。

Artifact Formation 除冻结 Research Intent identity 外，还使用稳定 build-request identity 与稳定 attempt
identity。相同语义 tuple 的重放汇合到同一 Owner attempt；任一 identity 被不同语义复用都形成 identity
conflict。穷尽的 Owner disposition 是 `SUCCESS`、`FAILED_NO_ARTIFACT`、`REJECTED_NO_WRITE` 与
`OUTCOME_UNKNOWN`；`SUBMITTED_OR_UNKNOWN` 只是查询状态，不是业务 disposition。只有 `SUCCESS` 才原子
提交新的不可变 Artifact、Build Receipt、Artifact Review 与 `ARTIFACT_AVAILABLE` projection；其他处置
均不产生 Artifact。commit 后响应丢失会解析到准确回执，commit 前 timeout 只能以 unknown 且无 Artifact
闭合。App 与 MCP 调用同一个带版本 Formation operation，绝不以 Windmill job state 代替它。

Product Edge 只有在规范 authorization、deployment binding、manifest 与 admission 锁全部持有后，才会在第一笔写入前立即采样 request-admission commit cut。四项权威必须在同一个半开 cut 重新验证，该 cut 同时绑定 admission identity 与 receipt。如果锁等待期间跨过到期边界，请求必须零写入。Product Edge unavailable 或 storage unknown（包括 admission custody 可能已存在）必须返回 `SUBMITTED_OR_UNKNOWN`，且只有 `RESOLVE_SAME_ATTEMPT_IDENTITY`；绝不能转成 `REJECTED_NO_WRITE` 或 successor 权威。

Provider invocation claim 本身是持久且一次性的 custody。若 claim 已提交但响应丢失，同 attempt 解析必须返回准确 `CLAIMED` claim 与唯一动作 `RUN_BOUNDED_EXECUTION_AGENT`。App 与脚本随后只能启动这一个既有 claim 一次；不得创建 successor claim 或第二次调用 provider。进入 `INVOCATION_STARTED` 后，除非已有权威终态 Owner receipt，否则唯一安全投影是人工 provider 对账。

### Sealed Source Intake 验收拓扑

Source Intake 只有一个明确分离、编译期选择的 `SEALED_ACCEPTANCE` composition。它不属于生产工件，
默认禁用，且普通 Product Edge request、通用生产环境变量、runtime provider 名称、URL、header、
credential 或 DSN 都不能选择它。生产工件不包含 acceptance adapter；其唯一 acquisition 类别是
`LIVE_EXTERNAL`，并在全部真实政策、时间、DNS、权利、credential、egress 和 provider 权威已配置且
current 之前保持失败关闭。

验收 composition 只在 provider 边界换入 sealed adapter，输入限于固定 DOI corpus、固定 response bytes
和确定性拒绝案例。它使用非公开 provider 身份，没有外部网络能力，也不与生产或其他验收 run 共享
database、volume、workspace 或可变状态。它仍经过生产 Product Edge admission gateway、同一个 Source
Intake Owner orchestrator、持久 claim/start、move-only permit、R&D PostgreSQL 原子终态 transaction、
终态 receipt、readback，以及默认 Windmill `RUN` 与 `RESOLVE` 传输。API 只执行认证、DTO 校验与
projection；Windmill 只调度或传输调用，二者都不拥有或重建该生命周期。

每次验收部署都从准确 script content 及其 lock 与 content hash 创建 fresh unique Windmill
project/workspace、ingress port、database 和 volume。环境身份、provider-profile digest、fixture-corpus
digest、sealed policy 与 Time Evidence、binding evidence 和 retrieval evidence 必须交叉绑定进 admission、
acquisition binding、终态 receipt 和 readback。runner 必须：

1. 部署该准确身份，并依次调用已部署的 `RUN`、相同 `RUN` 和同请求 `RESOLVE`；
2. 验证一个完整 `RETRIEVED` receipt 及其 content-addressed locator、content digest、acquisition
   provenance、Source Candidate 与 outbox record；
3. 验证 sealed policy rejection 产生零 provider invocation 和零 positive record；
4. 在 provider execution 与原子终态 commit 之后注入第一次 `RUN` 的 response loss，解析同一 attempt，
   并证明 provider invocation count 准确为一；以及
5. 删除该唯一 project/workspace、port allocation、database 与 volume，再 read back 证明全部隔离工件
   均不存在，且没有 shared target 发生变化。

该 runner 通过只构成 `SEALED_ACCEPTANCE` 证据，绝不证明 Workbench 为 `CURRENT`，也不证明生产政策、
时间、DNS、权利、credential、egress、PostgreSQL、Windmill 或 live provider 已就绪。

### Source Intake-to-Composer D0 合同

本节冻结下一实现 DAG 的顶层合同，不会让任何目标能力成为当前能力。成熟度边界必须准确区分：

- **CURRENT/PARTIAL：** crate-local Source Intake 合同/回归证据与 Develop Composer V2，后者包含本地
  确定性 bounded-plugin build producer 与 `ProgramHostV2` consumer 证明。它们是相互分离的本地证明；
  当前没有证据建立隔离 PostgreSQL/Windmill Source Intake runner 或组合后的
  Source Intake-to-Research-to-Composer 路径。
- **TARGET A1 - 持久 Composer Owner operation：** 一个公开 Composer `RUN`/`RESOLVE` 合同、进程内消费
  A0 build，以及下文规定的私有规范 A0 Build Receipt bytes 原子 R&D PostgreSQL custody 与重启回读。
- **TARGET A2 - 类型化 ancestry 与隔离 transport：** 一个由 R&D 拥有的 Source Intake-to-Research
  operation，随后通过下文隔离 Windmill 拓扑调用 A1 Composer operation。
- **SEALED_ACCEPTANCE：** 只有完成所有动态 gate 的 A2 runner 才能宣称组合验收拓扑。该证据仍仅用于
  验收，不能建立 `PRODUCT_CURRENT` 或生产 readiness。

Replay Policy V2 只能来自 [R&D Owner 合同](../owners/rd)定义的密封 版本化且内容寻址的 R&D Catalog。
紧接第一笔 TrialFamily-formation write 前，私有 R&D formation resolver 在其既有 transaction 上锁定并重读
显式 current 且未撤销的 head，再把 policy 与 Catalog cross-binding 永久密封进 family。后续 Composer 与
Replay composition 只使用该 family-sealed policy 与 cross-binding，绝不把 Catalog 重读为 authority。可选
Catalog reread 仅用于 audit，不能影响 admissibility，因此后续 Catalog revocation、deletion、unavailability
或 tamper 不能使已形成 family 失效。公开 Composer 或 Research request 不携带 policy selector。Product
Edge、Windmill、caller、provider、environment value、default、migration 与 deployment configuration 都不能
创建或选择 version、推进 head、撤销 version、seed Catalog 或合成 fallback。只有私有且受审计的 R&D
Catalog Administration Port 拥有这些写入。

另行授权的 Catalog bootstrap composition 始终位于 Product Edge 之外。它是独立、显式启用、
单次运行的 `authority-admin` unit，不提供 HTTP 或 Windmill route；只有当其拒绝未知字段的
密封 V1 request 已使用 Ed25519 和另行信任的 verifier identity/key 完成认证后，才使用
`RD_FACT_WRITER_DATABASE_URL`。database credential 与 request field 都不能自行声明 authentication；
`authentication_fact_digest` 在 database access 之前从已验证 evidence 派生。Product Edge 不得提供
request、verifier、key、administrator identity、policy bytes、command identity、event time、signature 或
canonical Owner readback，也不得启动 R&D API。product startup boundary 只有在 schema materialization、
custody cutover、显式 Catalog bootstrap 或准确解析，以及 byte-identical Owner readback 验证完成后，
才准许 API 启动。该 byte-identical typed Owner readback 由准确 sealed request 与 immutable audited
record/head state 重建。首次 success 与准确 response-loss 或 restart replay 返回相同 bytes；不得使用
attempt-local `CREATED`/`RESOLVED` field 区分两者。immutable audit fact 是持久 command receipt，该 typed
readback 是唯一 projection，不存在 administration receipt 或 outbox。bootstrap custody 缺失或 conflict 时，
startup 必须在无 default 的情况下 fail closed。

公开 Composer `RUN` 只接收不受信的 request identity、Research custody reference、Design proposal、
binding request 和有界 plugin-source capsule。这些值只能是 proposal 与 locator，绝不是 verified fact。
operation 必须在同一进程调用已接纳的 A0 确定性 build 边界，在进程内保留其不透明 verified build，并以
move 消费该 token。该正向类型既不可 `Clone`，也不可序列化或反序列化。私有规范 A0 Build Receipt bytes
是另一项持久事实，不是 token representation。不存在公开 verified-build locator、verified-build read port、
数据库或 API token representation；provider、caller、Windmill flow 或重启路径都不得从 bytes、digest、
receipt 或 label 重建 verified token。

A0 完成后且正向提交前，A1 锁定并重读最终已接纳 Research custody 与每份准确 fact-Owner binding。R&D、
Composer 与 Market Data 路径使用一个已准入 R&D PostgreSQL transaction domain：A1 把其既有 transaction
capability 传给每个适用且由 Owner 拥有的密封 Composer 或 Market Data read method。每个 Owner 都在该准确
transaction 上 lock、规范回读、校验并密封自己的事实。任何 method 都不能打开另一个 pool、
connection 或 transaction；caller 与 Windmill 都不能读取 raw Owner table、重建 sealed evidence 或取得
Owner 的 fact authority。Composer 或 Market Data evidence 缺失、不可用、过期、不匹配、跨 cut 或
wrong-owner，或 family-sealed policy cross-binding 无效时，都必须在第一笔正向写入前失败。该同一个 R&D
transaction 原子存储规范 `StrategyDesignV2`、`StrategyPlanV2`、
`StrategyArtifactV2` package 与私有
module bytes、私有规范 A0 Build Receipt bytes，以及 Composer receipt、host-admission receipt、operation
receipt 和 R&D outbox。JSON 仅为 projection，不能作为规范回读或 hash 来源。重启和 `RESOLVE` 重读并解析
规范 Build Receipt，校验其 capsule、toolchain、linker、configuration 与确定性 two-build provenance，
把该 receipt 与 Artifact 和 Composer receipts 绑定，再重新计算并比较每个 content 与 binding digest，
然后把 Artifact 重新接纳到 `ProgramHostV2`。该校验绝不重建 move-only verified token。raw Wasm 与规范
Build Receipt bytes 保持私有；公开正向 Artifact projection 只包含 immutable Artifact locator 与 public
digest。operation envelope 单独携带 terminal disposition 与 receipt identity。

持久 operation 只序列化一个 semantic attempt。并发的准确相同 request 与 meaning 加入同一份字节一致
终态 receipt。request、Research/Intent、build-attempt 或 artifact identity 中任一 identity 被用于不同
meaning 或规范 byte 时都返回 `CONFLICT` 且零写入。只有一个 transaction 提交全部规范 bytes、receipts 与
outbox 后才可见正向终态；任何 rejection、unsupported/refinement、evidence unavailable、A0 failure、
reread drift、host rejection、serialization/storage failure 或 rollback 都留下零 partial positive row，且
不授予 successor authority。`REJECTED_NO_WRITE`、`UNSUPPORTED` 与 `NEEDS_RESEARCH_REFINEMENT` 只能返回
证明该缺失状态的权威 negative operation receipt；必需 evidence 缺失、过期或不可用时返回
`UNAVAILABLE`，只允许 same-attempt resolution，且不授予 successor authority。提交后 response 丢失保持
`SUBMITTED_OR_UNKNOWN`；同 request `RESOLVE` 直接返回已提交 receipt，不重新 build、不重新调用
provider，也不创建 successor attempt。无法证明 commit 的 storage uncertainty 保持 unresolved，绝不能
伪造 rejection 或 success。

来源 ancestry 是另一个由 R&D 拥有的类型化 operation。它锁定并重读准确 Source Intake `RETRIEVED`
terminal receipt、acquisition provenance record、Source Candidate 和匹配的 transition outbox，校验它们共享
request/attempt/content/retrieval/policy/rights lineage，并且只返回 sealed ancestry evidence。Source content
保持不受信，绝不授予 accepted Research custody。后续类型化 Research `RUN` 把不受信 Research proposal
与单独验证的 ancestry evidence 交给规范 R&D Research admission。R&D 仍是唯一 Intent owner：只有该
admission 可以解析 Independence Basis、当前 Qualification frontier 与本地 semantic-predecessor lineage，
再冻结 Intent、falsifier、永久 TrialFamily authority、receipts 和 Composer 消费的 current Research
custody。仅凭 Source attempt 绝不能派生 `CurrentResearchDevelopCustodyV2`。复制 caller 字段、只接收
provenance locator 而不执行 Owner 重读，或仅把 Source Intake 与 Composer 部署在一起，都不构成
composition。任一 ancestry member 缺失、不匹配、过期、不是 `RETRIEVED` 或不可用，或规范 Research
admission 失败时，都不得创建 accepted Research custody，并使该 ancestry 的 Composer 保持不可用。

A2 只把 Windmill 用作以下固定顺序的 transport：

`Source Intake RUN/RESOLVE -> typed Research RUN/RESOLVE -> Composer RUN/RESOLVE`。

每个已部署 script 只解析类型化 request 或 receipt 并调用下一个 Owner operation；它不拥有 lifecycle、
verified build、规范 bytes 或业务结果。验收 binary 在编译期选择 sealed adapter，使用固定 Source Intake
corpus 与固定 A0 source/build corpus，并且不暴露 runtime provider selector、provider URL、credential、
fixture path、DSN、header 或 environment switch。每次 run 都获得唯一内部 PostgreSQL instance/schema、
Windmill project/workspace、network、ingress allocation 与 volumes，不能与生产或另一 run 共享 route 或
mutable state。固定且内容寻址的 Replay Policy Catalog fixture 仅用于测试：隔离 harness 通过私有
administration port 创建它并显式推进其 head，再形成 disposable TrialFamily；后续验收步骤只消费
family-sealed policy。fixture、administration hook 与 policy bytes 只存在于编译期 `SEALED_ACCEPTANCE`
composition；它们不是 runtime default、migration seed、production artifact 或 deployment selector。该固定 fixture
hook 与密封的单次 product bootstrap 彼此独立；两条路径都不向 Product Edge 或 Windmill 授予 Catalog
authority。

组合 runner 必须针对已部署 operation 与规范 Owner 回读证明以下全部事项：

1. 并发相同 meaning 的 `RUN` 加入一份字节一致 receipt；并发相同 identity 但 changed meaning 的请求发生
   conflict，且没有 changed-meaning 或 partial row；
2. 在每个 A1 write boundary 注入失败，都留下零 partial Design、Plan、Artifact/module、receipt、
   host-admission、operation 或 outbox row；
3. 原子 commit 后丢失 response，仍能解析到准确终态，且只执行一次 A0、不创建 successor attempt；
4. process 与 database 重启后调用 `RESOLVE`，重读并解析私有规范 A0 Build Receipt，校验其
   capsule/toolchain/linker/configuration/two-build provenance 与 Artifact/Composer receipt binding，再完成
   其余规范 byte parse/hash 校验并成功重新接纳到 `ProgramHostV2` 后，返回字节一致的公开 evidence；
5. 对每个 Source Intake ancestry member、Research proposal/Design/binding/source-capsule input、A0
   identity、已存储规范 object、module byte、receipt 或 outbox binding 做单字段 mutation，都必须失败关闭
   且不创建正向 successor；另对私有规范 A0 Build Receipt 做一次单字段 mutation，也必须得到相同结果；
6. 已部署 Windmill golden path 达到 `RETRIEVED`、规范 Research admission 及其类型化 accepted Research
   custody 与持久 Composer terminal；准确 replay 使用三个 same-request `RESOLVE` path 并加入相同
   receipts；以及
7. cleanup 删除唯一 Windmill project/workspace、PostgreSQL state、network、ingress allocation 与所有
   volume，然后证明 byte-for-byte 或枚举 baseline equality、零隔离 residue 与零 shared-target change。

在这些 gate 全部通过前，持久 Composer custody、公开 API composition、类型化 Source
Intake-to-Research handoff 与 Windmill A2 topology 都保持 `TARGET`。生产 Market Data binding resolver、
live OpenAlex policy/rights/DNS/credentials/egress、`PRODUCT_CURRENT`、Dashboard implementation、Paper、
Live、deployment 与任何 trading effect 都保持不可用，也不在本验收权威内。固定 corpus、固定 adapter、
隔离 PostgreSQL/Windmill runner 即使通过也只构成 `SEALED_ACCEPTANCE` 证据，绝不代表生产 readiness。

外部对话 client 与 Windmill 内部 AI 是两个 credential plane。client 可以先使用自己的 model provider
key 再调用 MCP；内部 AI Agent step 使用单独 scoped Windmill AI resource。两种 model credential 都不能
认证 Trade；复用同一 provider account 是 operator 选择，不是架构依赖。

该下限的官方能力证据是 Windmill 的
[full-code App deployment](https://www.windmill.dev/docs/full_code_apps/deployment)、
[MCP tool 与 scope](https://www.windmill.dev/docs/core_concepts/mcp)、
[job 与 retention](https://www.windmill.dev/docs/core_concepts/jobs)、
[role 与 run-on-behalf](https://www.windmill.dev/docs/core_concepts/roles_and_permissions)、
[schedule](https://www.windmill.dev/docs/core_concepts/scheduling)、
[flow error handling](https://www.windmill.dev/docs/core_concepts/error_handling)、
[persistent storage](https://www.windmill.dev/docs/core_concepts/persistent_storage) 和
[Git sync](https://www.windmill.dev/docs/advanced/git_sync) 文档。后续实现 chunk 必须对其准确固定的 Windmill
版本重新审计这些声明，不得假设 2026-08-18 证据截面永久有效。

## Agent-native R&D 创作

目标产品只接纳一条面向用户的策略创作路径：用户用自然语言表达带来源的研究目标、问题、解释请求
或修改请求，由 Agent 调用已接纳的 R&D 类型化 operation。Windmill App 可以直接提供 attended 对话
表面，可选外部对话客户端也可以通过 Windmill MCP 调用同一组 operation。两个 channel 都不能创作
业务事实或编辑 Artifact。

该路径区分两个 Agent 角色。**Conversation Agent** 运行在有人值守的 Windmill 体验或 WorkBuddy 等
外部客户端中，负责组织意图、提交或查询类型化 operation，并解释返回视图。服务端
**R&D Execution Agent** 在 Windmill 监督的 job 和已准入 Development Sandbox 中运行；对话断开后仍
继续执行，完成有界研究与生成，再通过 R&D Owner port 提交候选输出。两个 Agent 都不拥有 Research
事实，Conversation Agent 也绝不逐步维持 Execution Agent 的运行生命周期。

MCP 只传递 operation 请求与有界结果，不传递 LLM session、隐藏推理、模型 entitlement 或 credential。
在部署政策明确配置时，两个 Agent 角色可以使用同一个 provider、gateway、计费账户，甚至同一底层
credential；但这是显式后台配置，不是 credential 穿透。每个角色都保留独立 invocation identity、
scope、能力政策、预算和审计轨迹。Secret 值绝不能进入 MCP payload、Owner 事实、Artifact metadata
或日志。

已接受的修改请求会启动一个新的受治理 R&D attempt。它要么产生新的不可变、内容寻址 Strategy
Artifact 及其自身构建和探索证据，要么以原生无 Artifact、失败、拒绝或未知 disposition 闭合。它绝不
在既有 Artifact identity 下修改字节。策略语义变化必须经过适用的后继假设与 Research Intent 路径；
attended D-only repair 仍受独立 repair 契约约束。可见的 **让 Agent 修改** 动作只提交该类型化请求，
在 R&D-owned 回执到达前始终为 `SUBMITTED_OR_UNKNOWN`。

首个已接纳 Artifact Review 表面不要求访问原始源码。它展示 Artifact identity、Research Intent 与
迭代血缘、结构化策略逻辑摘要、参数和依赖 identity、构建状态、Agent 变更解释、探索结果引用、
有界 Qualification 状态与允许的下一步动作。每一项都绑定原生 Owner 事实，或被明确标记为非权威
解释；Agent 摘要不能替代 Artifact 字节、Build Receipt、Run Result、Iteration Decision 或
Qualification 事实。R&D Owner 以版本化类型 projection 发布下一动作准入：只有穷尽定义的已知动作
才是 `ADMITTED`，未知和 legacy 动作一律为 `NOT_ADMITTED`；Web 与 MCP 展示同一 projection，
不得从动作名称推断权威。语义变更摘要只能使用 R&D-owned 血缘和允许的探索证据，绝不能使用受保护的
Qualification 细节。

完整源码查看、源码级 diff、受控源码下载和源码关联诊断属于 `DEFERRED_TARGET` 高级审计能力。
即使以后引入也只能只读，且不作为首期 Workbench 验收条件。产品内代码编辑器、Notebook-first
创作、原地修改 Artifact 和覆盖 Artifact 版本属于 `NOT_ADMITTED`。外部 IDE 或 notebook 可以继续
作为工程工具存在，但不属于产品契约，也不能建立 Product Edge 请求、Owner 事实或验收证据。

## Agent Shell 部署绑定

Product Edge 为每个部署拥有一个非业务 Agent Shell Deployment Binding。目标 binding 指向规范
`WINDMILL_PRODUCT_EDGE` 准入网关；Windmill App 与 MCP 调用是同一网关后的 channel，不是竞争 Shell
writer。binding 记录选择 generation、有效 principal、scope policy 版本、已批准 Skill/MCP 能力集版本、
审计政策版本和 cutover epoch。不同 channel 可以使用不同凭证，但有效 principal 与政策必须完全相同；
切换外部对话客户端或 transport 只改变归因，不改变权限。

每次 binding 提交还必须绑定提交前后的权威 deployment history head。只有部署从未存在 binding
历史时才允许 genesis，且必须是 generation 一并且没有 predecessor。历史一旦存在，后继必须以
在准确当前 head 上持久原子序列化，引用已 `SUPERSEDED` 的前驱，generation 只增加一，cutover
epoch 严格递增，并使用历史中从未出现过的 binding identity。零 `ACTIVE` 窗口不会清空 history head。

规范绑定状态只有 `ACTIVE` 和 `SUPERSEDED`，且 `SUPERSEDED` 单调不可逆。切换期间允许短暂没有 `ACTIVE` Shell，但此时必须失败
关闭且不得向 Owner 提交写请求；同时存在两个 `ACTIVE`、generation 过期或政策不匹配也不得写入。
准确前驱必须先提交 `SUPERSEDED`，以此形成持久请求来源围栏，政策完全等价的后继才能提交
`ACTIVE`。每个写请求原子读取并绑定权威 history head，且准入要求唯一 `ACTIVE` binding 等于该
head。已由合法前驱准入的请求保留原 request 与 binding 身份，新 head 生效后仍按该原绑定解析，
不会发生写入重叠或裸重试。如果其首次 downstream mutation 尚无回执，则只有在直接政策等价 successor 已成为 `ACTIVE`、原始存储 lineage 仍准确匹配且原 Operator Authorization 在 final write cut 仍 current 时才可继续。零 `ACTIVE` fence 会阻断这种连续性，所有新 admission 仍必须使用当前 `ACTIVE` head。

### 管理员 bootstrap 与控制面 writer

Product Edge 是 deployment binding 与 head、内容寻址 operation manifest、不可变 request admission 及其
outbox 的唯一 writer。独立命名的 **Operator Authorization Issuer** 是授权签发与 revocation frontier 的唯一
writer。它是 Product Edge 边界内独立控制面 writer，不是另一个业务 Owner，也不是 Product Edge admission
helper。Product Edge 只能直接解析其事实而不能写入；Windmill、API、R&D、配置和持有 token 都不能签发
authorization。

两个 writer 在同一 authority database 使用不同 PostgreSQL role。Request-admission transaction 在写入
admission 前以共享读锁锁定准确 issuance 与当前 revocation frontier；issuance 或 revocation 使用冲突的更新
锁。因此两个 writer 的提交截面可被强制执行，不需要第三 verifier、cache、Event Store 或复制的 caller
assertion。

第一个 deployment binding 只能由显式且执行一次的管理员 bootstrap 创建。Bootstrap 禁止出现在服务
启动和任何产品请求路径。它验证完整 binding 与 head 历史为空，要求 expected head 为 `EMPTY`、generation
为一、有限有效区间、内容寻址 manifest 和已预先签发且当前有效的 Operator Authorization。Binding、head、
manifest receipt 与 outbox 原子提交。准确重放加入原字节；含义改变或并发失败的 genesis 尝试发生冲突且
没有部分写入。后继属于独立管理员 cutover：先提交准确前驱的 `SUPERSEDED` fence，随后且仅随后政策
等价后继才能以 generation 加一成为 `ACTIVE`。

### 到期 manifest 恢复 epoch

普通 authorization 或 deployment 后继只有在提交截面的准确前驱仍 current 时才可准入。manifest 区间
到期后不能再走该续期路径；唯一前向路径是显式 `ExpiredManifestRecoveryEpochV1`，它绑定准确 Operator
Authorization issuance head 与 revocation frontier、准确 Product Edge deployment head 与 generation，以及
完整前驱和后继 manifest 集。它绝不是 rollback、第二次 genesis、服务启动动作或请求路径 fallback。

recovery 命令只接受一份内容绑定的 PostgreSQL target，其中声明准确 authority database、PostgreSQL system
identifier、Operator Authorization role，以及与其不同的 Product Edge role。在任一 Owner 写入前，命令以
只读方式连接两个给定 endpoint，并要求 `current_database()`、`current_user` 与 `pg_control_system()` system
identifier 回读匹配该 target，同时证明两个 role 到达同一 database cluster。缺失、空值、相同 role、环境
默认或交叉拼接 binding 一律失败关闭且不产生 Owner 写入；URL 与 secret 绝不记录。

epoch 必须把每个 manifest semantic key 准确枚举一次，并标为 `RETAINED`、`ADDED` 或 `REMOVED`，同时
绑定该处置对应的准确旧/新内容寻址 binding。保留项只能收窄 allowed effect，且必须保留前驱的全部
prohibited effect。新增项必须处于不变的 principal、audience、Operator Authorization scope、request proof、
scope policy 与 audit policy 内；必须保留不可变的 `LIVE_TRADING_V1`、`REAL_TRADING_V1` 和
`PROTECTED_FEEDBACK_DETAIL_V1` 禁止下限，且不能声明 live 或 trading target/allowed effect。删除项不授予
任何后继权威。只有内容寻址 epoch 含新增或删除项时 capability-policy 版本才可改变，且每个后继 manifest
必须绑定该准确版本。遗漏、重复、交叉拼接、陈旧或含义不同的 transition 全部失败关闭。

恢复有意保持两个 Owner 且只向前推进。Operator Authorization Issuer 先锁定到期 issuance head 与当前
frontier，再追加或准确重放 OA2；只有 OA2 不能形成 Product Edge 请求权威。Product Edge 随后在自己的
提交截面验证该规范 OA2，不可逆追加准确 B1 `SUPERSEDED` fence，进入零 `ACTIVE` 的失败关闭区间，并在
同一事务追加 B2、其 manifests、receipt 与 outbox，同时以 compare-and-swap 推进 deployment head。OA2 或
fence 之后崩溃时，只能使用同一 epoch 与完整相同字节续跑；改变 epoch 会冲突。该协议不声称跨 Owner
事务原子性，也绝不重写 OA1、B1、旧 manifest、admission、receipt、outbox 或 downstream Owner 事实。
从未在 B1 下准入的请求必须等 B2 current 后使用新 identity；恢复不能追认或完成它们。

本地 API token 只是 opaque request proof。Bootstrap 绑定其 digest，既不记录也不发布 secret；request
admission 将该 proof 与规范 issuance 和 binding 比较。环境值、默认值、同对象比较或有效 transport session
都不能提供 principal、scope、issuer、audience、authorization、manifest、deployment head、capability 或
audit authority。

## 类型化 Owner 请求

每次写请求必须绑定稳定 client request 身份、受信部署绑定、有效 principal 与 scope、能力与审计
政策版本、目标 Owner 与规范操作、类型化业务含义身份和审计关联。Shell 不能自行声明身份或扩大
权限。目标或含义不明确时必须在提交前失败关闭。

请求还必须绑定受信 authority 签发且不能自我声明的 Operator Authorization，包括 issuer、
subject/effective principal、audience、准确 scope、共享 Time Evidence 下的签发与到期时间、revocation
frontier、request-proof 摘要和内容寻址 Agent Operation Manifest。manifest 声明准确 operation
schema 目标 Owner 允许 object class 禁止写入和 capability-policy 摘要。Shell 只能选择 manifest 成员；
自然语言 本地配置或持有 credential 都不能自行产生授权。secret 只存在于不透明最小权限 handle 后，
永不进入请求。

稳定请求身份 有效 principal 与 scope 已准入的 `ACTIVE` Shell binding 及准确 deployment history head
Operator Authorization 和 Agent Operation Manifest 共同组成请求的 Authorization Lineage。Strategy
Governance 接受生命周期请求时，必须把完整 lineage 交叉绑定进结果 Authorized Generation Decision。
Scanner 证据 自然语言 Agent 计划或裸 Governance 决定都不能替代其中任何成员。

Product Edge 必须在任何 R&D mutation 前把该完整元组持久化为一份不可变 Request Admission。Admission
还绑定规范 typed-payload digest、operation schema、target Owner、允许与禁止的 effect、time evidence、
request-proof digest 和 audit correlation。R&D 只接收 opaque admission locator，并在锁内直接解析完整规范
字节；locator、序列化 readback 或 caller 可计算 digest 都不是 authority。相同 request 与含义加入原
admission；含义改变或 authority cut 改变会发生冲突且不得 downstream 写入。

Deployment binding 取代绝不重写已准入 request；其原 binding、head、authorization、frontier、manifest 与
cut 始终可直接解析。Authorization 到期或撤销同样绝不重写 admission 或已经提交的 downstream Owner
receipt。若尚无 downstream custody 提交，当前到期或撤销禁止第一次提交。若 R&D 已经提交 receipt 或
prepared attempt，recovery 可以解析或终态化该 custody；但新的 provider 或 effect invocation 必须取得一份
持久且只用一次、与当时当前 authorization frontier 序列化的 invocation admission。该 claim 响应丢失后
绝不允许第二次 invocation。Product Edge 持久区分 claim 与 `INVOCATION_STARTED`；start fence 提交后，
若 provider 没有可验证的幂等 key 或权威回读，只能返回 `OUTCOME_UNKNOWN` 并进行人工对账。该窗口的
自动恢复与 `ACTUAL_PROVIDER_CALL_AT_MOST_ONCE` 仍为 `NOT_ADMITTED`；start fact 绝不证明 provider 已经
执行或返回结果。

由环境授权的 legacy 行没有 Product Edge admission，绝不回填。终态 legacy 行只读并 quarantine；identity
碰撞失败关闭；只要存在 legacy 非终态 S2 attempt，R&D API 就拒绝 activation。authority 缺失、双重、过期、
畸形、失效、被撤销、issuer 错误、audience 错误、跨 principal、跨 scope、proof 不匹配、manifest 不匹配、
digest 不匹配或混合截面时，返回 `SUBMITTED_OR_UNKNOWN`，且不得创建 Product Edge admission、R&D/
Qualification/TrialFamily/attempt/Artifact 写入、outbox 或 provider 调用。

无人值守交易使用由该生命周期请求准入的独立显式 Autonomous Policy Authorization，不能伪装成每笔
订单都由用户或 Agent 再次授权。它绑定 policy 身份与版本 principal 与 scope strategy generation 与
Execution Scope、允许的 intent 和 action 类别、Capital Policy 边界、生效与到期时间、revocation
frontier 和已准入 operation manifest。Runtime Risk Execution 必须让该身份贯穿 application intent
decision reservation command Effect Journal 和权威回读。任一成员过期 撤销 scope 漂移或 lineage
断裂都必须阻止新增风险。

Shell 或传输成功只表示 `SUBMITTED_OR_UNKNOWN`。只有接收 Owner 的关联回执才是权威结果。
相同身份和含义的重放加入同一回执；相同身份但含义改变必须拒绝，新动作必须使用后继身份。

Research 用只写一次的 `ACCEPTED` 或 `REJECTED_NO_WRITE` Research Request Receipt 闭合研究请求；
接受回执必须绑定唯一结果 Research Intent 身份。Strategy Governance 以相同两个终态闭合生命周期
请求；接受回执必须绑定唯一 Authorized Generation Decision 身份及完整 Authorization Lineage。Owner 回执出现前 Product Edge
始终保留原请求的未知状态，不从 Shell 确认、只读视图或没有错误中推断接受。

`ATTENDED_D_ONLY_REPAIR` 使用同一请求 lineage 与 receipt 规则，但已接受的 R&D Request Receipt 只绑定
D-only repair admission，不证明修复完成。admission 前的 `REJECTED_NO_WRITE` receipt 不创建 repair
attempt，因此也没有 D-only Repair Disposition。R&D 随后准确提交一个关联请求与 attempt 的 D-only Repair
Disposition：`D0_COMPLETED_NO_ARTIFACT` `D1_VALIDATED` `D1_VALIDATION_FAILED` `D1_BUILD_FAILED`
`REJECTED_NOT_D_ONLY` 或 `OUTCOME_UNKNOWN`。Product Edge 只能通过现有 Research View 显示该事实；
它不拥有 disposition，不能从 Shell 投递推断结果，也不能把 `D1_VALIDATED` 提升为 Qualification
Governance 部署或交易权威。相同请求重放加入同一个只写一次 disposition；新 attempt 必须有新的显式
用户请求和后继 R&D admission。

Qualification Review Request 通过 Qualification 现有且只写一次的 Candidate Intake Receipt 闭合。
该回执绑定稳定评估请求身份 规范类型化含义 准确 Candidate 和 intake attempt。相同请求重放加入
同一回执；含义改变或裸用新身份不能创建第二次 intake 或 holdout 尝试。

Qualification 通过专用已提交事实交接返回该回执。Qualification Status Summary 是后续 intake 尝试或
eligibility 阶段的独立有界只读模型。摘要 事件 Shell 确认或没有错误都不能代替已提交回执，回执缺失
保持 `SUBMITTED_OR_UNKNOWN`。

## 只读视图

每个 Product Edge 只读模型都是有界 Owner 投影，不是影子存储。共同 envelope 绑定稳定 read-request
身份 trusted principal、准确授权 scope 或账户与 Execution Scope、authorization-policy 身份与截面、
来源 Owner、完整权威 source frontier 或 snapshot cut、observed/projection time、新鲜度和 valid-through。
可用结果明确为 `AVAILABLE` `STALE` 或 `UNAVAILABLE`；完整性要求更严格的模型还可额外失败关闭。
同一请求在同一来源截面重放返回同一投影身份；新来源截面创建后继视图。跨 principal scope 账户 mode、
政策过期 时间过期或同请求冲突重放都不返回缓存视图，也不创建 Owner transition。

Research View 状态为 `AVAILABLE` `STALE` 或 `UNAVAILABLE`，并暴露一个阶段：
`REQUEST_UNRESOLVED` `INTENT_FROZEN` `ARTIFACT_AVAILABLE` `EXPLORATION_ACTIVE` 或
`SELECTION_TERMINAL`。它只包含 R&D 拥有的来源血缘 Research Intent 状态 Strategy Artifact 与 Build
Receipt 引用 探索请求结果摘要 Research Selection Disposition，以及已授权请求的有界 D-only Repair
Disposition。它不包含保护重放测量 参数 结果 holdout 消耗或可解引用 Qualification 证据。

Exploratory Run Result View 只从完整 Backtest frontier 向已授权 Research scope 投影 Backtest-owned
探索结果。Governance Decision View 只从完整 Governance frontier 投影 lifecycle state、policy bounds、
effective interval、有界 rationale 和不透明已提交事实引用。两者读取可用性均为 `AVAILABLE` `STALE`
或 `UNAVAILABLE`，都不暴露保护评估细节；Governance view 也不证明 Runtime application 或外部效果。

Qualification Status Summary 只暴露 `NOT_ADMITTED` `ADMITTED` `EVALUATING` `CLOSED_NOT_QUALIFIED`
`QUALIFIED` `EXPIRED` `REVOKED` 或 `UNAVAILABLE`。内部 replay 拒绝或无效、diagnostic 无效或未解析、
assessment 无效以及 `INELIGIBLE` fact 全部映射为同一个 `CLOSED_NOT_QUALIFIED` outcome，并使用类型
不透明且不可解引用的 reference。Product Edge 不能区分、计数、分组或过滤这些内部负面原因。

Portfolio View 状态为 `AVAILABLE` `INCOMPLETE_FAIL_CLOSED` `STALE` 或 `UNAVAILABLE`，只包含 Portfolio 拥有的账户 暴露 表现
和 gross Capacity View 投影，并绑定获准读取的 Execution Scope 与一致 Portfolio 快照截面。它不包含
Risk Reservation Aggregate Commitment Frontier usage 剩余 headroom Risk Decision 或部署交易权限。
来源截面缺失 未授权 过期或混合时保持明确不可用，不能拼接或推断。

Effect Closure View 由 Product Edge 针对稳定 effect-view request 与已授权 Execution Scope 直接向
Execution 请求。`AVAILABLE` 只返回一个 `UNKNOWN_EFFECT` `NO_EFFECT` 或 `SETTLED` 投影，并绑定 attempt
账户 mode effect namespace Effect Journal frontier 回读/对账截面 blocker 责任 Owner projection cut 和
valid-through。政策缺失或过期、跨 principal/账户/mode、请求含义变化或 case/fence 不匹配时不返回
view。source frontier 或权威回读未解析时，同一请求保持 `UNAVAILABLE`，不能推断闭合。同一来源截面
准确重放加入同一投影，较新截面创建后继 view。Product Edge 可以用该 view 解释进度，但效果与
Recovery 状态只能由已提交 Execution 及其他来源 Owner 事实建立，Research 永不把该 view 当 provenance。

## 产品闭环与应用层

只有用户能把一个有界目标从入口推进到权威结果及其下一个合法动作，而不需要手工拼接 Owner 数据库、
回执、日志或终端输出时，产品闭环才成立。Product Edge 用类型化 Owner 请求、请求关联回执和有界只读
模型组合这段旅程，但不拥有旅程中展示的业务转换。

R&D 应用旅程展示 `Source / Hypothesis → Frozen Research Intent → Strategy Artifact and Build
Receipt → Exploratory Run → Run Detail or Compare → Diagnosis → Iteration Decision`。它的终态动作是停止、提交准确的
类型化输入修复请求、创建唯一已接纳后继，或把准确已选择 Candidate 交给 Qualification。每个阶段都
绑定原生 Owner 事实、来源 frontier、新鲜度和未解析状态。可见按钮只提交一个新的类型化请求，绝不
直接修改投影或推进阶段；原生 Owner 回执出现前，动作保持 `SUBMITTED_OR_UNKNOWN`。

Product Edge 可以拥有筛选、布局和未提交表单等短暂交互细节，但不拥有 Research 血缘、Iteration
Decision、Qualification 状态、生命周期状态或外部效果闭合。Observability 可以为旅程标注进度与诊断；
遥测可用性、Dashboard 状态和告警投递永远不能证明完成或选择下一个业务动作。

## 权威边界

它不拥有研究、策略、订单、账户、风险或恢复事实。Agent 操作成功只证明本地提交状态，不是 Owner 回执或业务结果。

向某 principal 投影每个有界 Qualification 阶段事实时，Product Edge 都推进不可解引用的保护反馈
观察前沿。后续 Research 与 Qualification 请求必须提交相关前沿和前驱身份，使 Shell 切换 请求改名
或新 TrialFamily 不能静默擦除已经观察到的反馈。

## 交接

研究与生命周期 admission 请求只能通过接收 Owner 的终态回执闭合；已接受 D-only admission 与后续由
R&D 拥有的 D-only Repair Disposition 保持分离。只有 Runtime 的 Generation Application
Receipt 才能把策略显示为正在运行，Governance 授权本身不能证明已运行。

Product Edge 可以请求 Research 工作、独立 Qualification 评估，或准确一个 Strategy Governance 规范生命周期动作：`INITIAL_ACTIVATION` `PROMOTION` `REDUCTION` `PAUSE` `RETIREMENT` `DE_RISK` 或 `RECOVERY`。冲突按 `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION` 解析；`PROMOTION` 要求无人值守政策，并按自身 evidence key 绑定新鲜兼容的 Capacity View、Performance 与 Exposure 证据。它可以读取 Research View Portfolio View 探索 Backtest 结果 有界 Qualification Status Summary 每个 ScheduledScanId 的唯一终态 Scanner Receipt，以及有界 Governance Decision View。Research View 的终态停止只来自 Iteration Decision，只有存在仅选择 `SELECTED_FOR_QUALIFICATION` disposition 才显示 Selection。Intake 状态保留只写一次的 `NOT_ADMITTED` 或 `ADMITTED` 回执；`EVALUATING` 是 `ADMITTED` 回执加上进行中或未知保护请求派生的摘要，不是 Intake Receipt 状态。所有负面保护终态只显示为 `CLOSED_NOT_QUALIFIED`，不投影内部 replay、diagnostic、assessment 或 ineligibility 原因。已提交正向 Eligibility Fact 以 `QUALIFIED` 取代视图阶段，但不改写先前事实。Product Edge 直接读取 Scanner Receipt，不保存竞争的 Scanner-owned 投影。回执显示准确完成状态和一个 expected-set 分支。已解析分支包含准确 expected observed 与 missing，未解析分支包含权威未解析 disposition observed 事实 missing-members-unavailable 标记和终态原因。只有完整 `PROPOSED` 回执含准确 proposal members，不完整 `FAILED` 不能宣称集合完整。Qualification 和 Governance 视图只含公共状态 条件或政策边界 生效区间和类型不透明且不可解引用的已提交事实引用，绝不暴露保护测量 负面原因或评估细节。Event Rail 通知不是终态证明。

## 禁止事项

它不得让 Windmill App、MCP client 或 workflow 成为竞争业务写入者，不接受自我声明 operator identity，不得用任意 SQL 或
命令绕过 Owner 存储，不调用 admitted manifest 之外的 operation，不暴露 credential，不绕过 Risk
创建订单 批准资格 解引用保护证据，也不得用 Agent 记忆宣告恢复成功。

## 决策契约

- **输入** - 自然语言意图 唯一 active Agent Shell Deployment Binding trusted principal 与 scope
  Operator Authorization admitted Agent Operation Manifest 和有界 Owner 只读模型请求。
- **诊断与决定** - 解析唯一规范 Owner operation 与 semantic payload，再以准确 Authorization Lineage
  提交一个类型化请求，或在任何业务写入前拒绝。
- **冲突解析** - 权威 deployment-history head 和政策等价 active binding 优先；意图歧义 双 Shell 写入
  过期切换 含义改变的重放或 scope 冲突都失败关闭。
- **输出与终态负例** - 请求关联 Owner 回执或有界视图；本地 Shell 成功仍为 `SUBMITTED_OR_UNKNOWN`，
  授权拒绝或 Owner 回执未解析都不能变成业务成功。
- **反馈与经济意义** - 把自然语言转成可归因 可安全重放的产品工作，同时不让 Agent credential 通知
  或 UI cache 成为交易权威。
- **禁止事项** - 不执行无 schema 命令或 SQL 不自签身份 不扩大能力 不写业务状态 不披露保护证据
  不创建订单 不分配资金 不绕过 Risk 也不宣称 Recovery。

## 实现验收

切换外部对话客户端或 Product Edge transport 时必须保持相同的有效主体、权限范围、能力与审计政策
和 Owner 权威规则。测试必须证明只选择一个准入网关、允许失败关闭的零活动切换窗口、前驱先
`SUPERSEDED` 后继再 `ACTIVE`、取代不可逆、双写或政策漂移被拒、每个请求按准确权威 head 准入，
以及所有已准入在途请求身份被保留。Windmill App 与 MCP 测试还必须证明相同语义请求到达相同带
版本 operation 与 Owner 回执，不兼容客户端在业务写入前失败关闭。每个写操作都有类型 可归因 可安全重放且绑定接收 Owner 回执。Qualification review 复用 Candidate Intake Receipt 作为关联请求终态回执，并独立于有界状态视图返回它。仅含义相同不能加入 Candidate 尝试 状态 结果或身份不同的回执。Research 与生命周期接受回执绑定准确结果事实，拒绝回执证明没有写入。Runtime 在证明 `APPLIED` 或 `REJECTED_NO_INSTANCE` 前必须显式保持 `APPLICATION_UNKNOWN`。自然语言存在歧义时必须在业务写入前失败关闭。

只读模型测试必须证明每个视图保留稳定请求 principal scope 授权政策截面 来源 Owner 来源截面
observed/projection time 新鲜度 valid-through 和明确可用状态；拒绝混合截面 过期政策 冲突重放和未授权
scope；并证明保护 Qualification 细节 Risk headroom 或授权不能进入任何投影。

未来 Dashboard 只读取 Observability-owned Global Status View。该视图必须显示 projection 版本、引用的
Owner/telemetry frontier、新鲜度、完整性、lag、quarantine 与 rebuild 状态。过期、部分、重建中或不可用
视图必须保持明确非当前。Dashboard 中任何可能改变 Owner 的动作都要转成新的 typed 且独立授权的
Product Edge 请求，绝不能直接写入 projection。

切换测试还必须拒绝历史存在后的伪 genesis 过期 history head 重用 binding identity 不递增的
generation 或 epoch，以及并发竞争同一 head 时除唯一序列化获胜者以外的所有后继。

安全测试还必须在提交前拒绝错误 issuer audience subject scope expiry revocation frontier proof digest
manifest operation schema 或 target Owner，并证明任何 Shell 都不能扩大已准入 operation。
Lineage 测试必须证明每个已接受生命周期决定及其最终效果与回读都解析到同一 request principal scope
已准入 Shell binding 与 history head Operator Authorization operation manifest 和授权模式；无人值守
lineage 还必须解析到同一 Autonomous Policy Authorization。任一必需成员缺失或不匹配时必须在新增风险前失败。
