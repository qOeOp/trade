# Trade Dashboard

## 有界准入：只读影子调度日历

用户准入 `/operations/schedules` 为 `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`，仅覆盖第一方
零 effect 影子读取调度。此窄例外覆盖该路由的通用 blueprint-only 分类，不准入 Scanner due-slot
Resolve 或 Windmill 通用调度。复用 `configuredShadowScheduleSetV1` 与 RunStore
`readBoundScheduledReads`：配置中的身份、摘要、operation 和 dispatch binding 必须与全部已注册
记录精确匹配（1-100 条）。配置、注册或兼容 custody 缺失时 fail closed。API 仅 GET；读取不创建
scheduler，不注册、tick 或入队。

浏览器只从成功 HTTP 响应及有效绑定投影接收正向数据。刷新得到不可用或被拒绝的证据时清除旧行与
选中详情。全程使用 UTC。`next_due_at` 与 cadence 描述**预计触发**，不是执行事实；调度器可能跳过
已过去的周期。只有返回的 `last_due_at` 与 `last_run_identity` 配对才是**已观测运行**，不得推断
更早历史、完成、时长、成功或 Owner acceptance。

路由只有一个标题/action header（`Shadow-read schedules`，随后 `Refresh`）和内嵌内容 body。
紧凑摘要依次显示配置调度数、观测时已到期调度数、已观测运行引用数；不可用显示横线而不是零。
单行工具栏依次为 Calendar/Table、Today、Previous、日期范围、Next、Day/Week/Month/Year/Agenda，
最后为右对齐搜索。窄屏控件横向滚动，不使用下钻筛选菜单。默认当前 UTC 日期的 Month 视图；搜索
匹配 operation 和 schedule identity。

日历保留 Vibe 的日期导航、五视图、事件查看、溢出展开及克制动画。Month 使用覆盖完整周的七列网格，
每天最多三个摘要条目及可访问的溢出按钮。Day/Week 按 UTC 小时展示零时长触发点，不伪造持续时长块。
Year 显示十二个月块，点击进入 Month；Agenda 展示选中月份的逐日列表。密集 cadence 按调度/日或
调度/小时以算术方式聚合；展开后每页 50 个精确预计时间戳，不物化无界事件列表。已观测记录独立标注，
链接现有 Run Detail。日历导航不得执行调度；Today 重置日期但保留当前视图。

表格列依次为 Operation、Cadence、Next expected trigger、Last observed run；默认按下次触发升序，
再按不可变 schedule identity 排序。先搜索再分页，默认 20 行，可选 10/20/50。选中打开与日历相同的
详情。不提供列选择器、批量选择或每列表头装饰图标。表头在有界 body 滚动区域内冻结。详情依次为
operation/标题、cadence 与下次预计触发、上次已观测 due/run 链接、默认折叠的身份/摘要/recovery 字段。
不提供 Run、Resolve、CRUD、拖拽或缩放操作。

1280px 及以上，日历/表格与详情使用 2:1 网格、16px 间距，共享按可用视口限制在 420-760px 的 body
高度，双方内部滚动。低于 1280px，详情在主卡片之后自然增高。低于 768px，Month/Week 保留至少
700px 的内部滚动宽度，其他视图适配卡片。header/footer 共用主题 chrome token，配内嵌 body、弱
分割线及克制橙色选中/焦点。图标使用 Lucide。动画 140-180ms 并遵循 reduced motion；键盘可操作
控件、开关溢出、选中条目及访问已观测运行链接，不依赖指针手势。

加载时主 body 展示六行 48px skeleton；空数据/搜索无结果使用单个 160px 提示区，不伪造事件。
不可用、兼容失败、格式错误及拒绝访问使用同样有界提示区、简短原因与 Refresh，不保留旧正向详情。
动态验收必须覆盖 disposable PostgreSQL 绑定读取到浏览器、失配/HTTP 失败拒绝、预计与观测区分、
五视图、溢出、键盘、双主题与窄/宽屏布局；fixture 不能替代动态验收。

## 有界准入：Backtest 收益带展示原子

`BacktestReturnBand` 是已文档化 `/backtest` 与 `/backtest/compare` 表面的
`TARGET_DRAFT / IMPLEMENTATION_ADMITTED` 只读展示原子。其源码保真基线是 Vibe Trading commit
`48c8315f74536d9d308347d63ac9c4e96c9a7120`、tree
`d226b620dc699c9e8e382274434b324a5fefe0e1` 中 factor home 的日收益带图。Trade 适配保留
quantile min/max 与 Q1/Q3 区间、选中策略的墨迹 overlay、月份色带或年份分割线、拖动聚焦时间窗口与
reset、回撤顶部纹理、可选的显式 benchmark 及外置 hover readout；同时使用 Dashboard 共享 panel、
主题 token、响应式测量、克制动画、reduced-motion 行为和 Lucide action。

正向渲染只接受一个精确、有界、Owner 投影的 result identity：canonical UTC 时间戳、有序有限 quantile、
严格按时间排序的 point，以及时间戳属于同一 cut 的可选 strategy/benchmark series。未知字段、错误顺序、
series 失配、携带陈旧值或非 canonical 时间全部 fail closed 为零图表数据。只有投影显式提供 benchmark
时才展示基准；浏览器绝不能从 band median 派生 baseline、合成收益或导入 Vibe mock factor data。
Loading、unavailable、合法 empty 与 available 是四种独立状态。

该原子不执行 Backtest dispatch、selection commit、comparison judgment、economic claim、Owner resolve、
provider call 或业务写。当前没有 Dashboard route 或已准入 Backtest Owner resolver 为它提供正向投影，
因此组件测试与静态渲染不能建立 live data、deployed-browser acceptance、S3 availability 或 Windmill
replacement。

## 有界准入：只读策略代码查看器

`StrategyCodeViewer` 是 `ArtifactReviewPanel` source/Wasm 区域的
`TARGET_DRAFT / IMPLEMENTATION_ADMITTED` 展示原子。其源码保真基线是 Vibe Trading commit
`48c8315f74536d9d308347d63ac9c4e96c9a7120`、tree
`d226b620dc699c9e8e382274434b324a5fefe0e1` 中 `apps/web/src/features/lab` 下的 CodeMirror 6
editor shell 与只读代码表面。Trade 适配保留真实 CodeMirror 的行号 gutter、语法高亮、折叠、文本选择、
有界滚动、文件 tab、编辑器 chrome、output pane、响应式布局、reduced-motion 动画和 Lucide action。
它是具有编辑器外观的**查看器**，不是编辑器：不存在内容输入、光标、自动补全、编辑快捷键、insert-cell、
Run、保存、改写、提交、kernel 连接、WebSocket 或 AI action。

正向渲染只接受一份精确且有界的 Owner 投影：artifact identity、canonical observation time、单份 source
filename/language/content/digest，以及一个显式 Wasm preview state。Source 上限为 256 KiB，preview output
上限为 64 KiB。Preview state 只有 `not_run`、`succeeded`、`failed`、`unavailable`；仅 succeeded/failed
携带精确 module identity、target、canonical observation time、有限 duration、有界 output 与有界 typed
diagnostics。未知字段、错误时间、非法 digest、超限文本、非法位置、状态字段矛盾或携带陈旧内容全部
fail closed 为零 source 和 preview 数据。浏览器不生成示例代码、不执行 source、不合成 Wasm 结果，也不把
transport success 提升为 Artifact fact。

唯一 local UI action 是 Copy source。折叠、选择和滚动仅属于展示状态，不能修改投影。Wasm pane 只展示
已经投影的 sandbox 结果，不提供 Run control，也不执行 module instantiation、network call、Owner resolve、
provider effect、业务写、Windmill mutation 或交易动作。

一个 `ACTIVE_OBSERVATION / IMPLEMENTATION_ADMITTED` 详情切片可以把
`/rd/artifacts/{build_request_identity}/attempts/{attempt_identity}` 绑定到精确且经过认证的 Owner GET
`/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/source`。只有精确匹配且 terminal
success 的 custody，在其 stored attempt、candidate、receipt、Artifact identity、source capsule、build recipe、
deterministic Wasm 和 review 全部通过现有完整 custody verifier 后，Owner 才能返回源码。Owner 以确定性方式
重建实际构建的 Rust source，并绑定 SHA-256 content digest 与 committed-at cut；其他状态只返回 absent 或
unavailable。Dashboard 还会重新计算 content digest，并拒绝未知字段、identity 漂移、超限 source 和非法时间。
独立 read port 不持有 mutation method。它在 canonical read-committed transaction 中复用现有完整 custody verifier，
包括历史 Product Edge admission read 与 row-lock 一致性，但不创建新 admission，也不执行 timeout
terminalization、sandbox invocation 或数据库写入。
在单独准入精确 sandbox preview readback 前，preview pane 明确为 `not_run`，且不携带 module、target 或 output。
这个详情切片不创建 Artifact 列表，不证明部署可用，也不建立 Windmill replacement。

本章是 Trade 自有 Dashboard 的滚动实现与分阶段准入合同，定义产品外壳、信息架构、可复用 UI 系统，
以及当前有证据支持的 Windmill 最小替代能力假设。用户已显式准入严格受本章精确合同约束的 Dashboard
实现与打包；该准入不声称 Dashboard 服务已经合并或可用，不声称能力目录已经定稿，也不
授权 Windmill 切换、业务验收、生产写、provider effect 或交易动作。

## 状态词汇与证据切面

- `CURRENT/PARTIAL` 表示能力已合并到当前 Trade main 并有真实消费者证据，但完整 Dashboard 仍不存在。
- `ACTIVE_OBSERVATION` 表示精确 Hub task 仍在实现、动态验收，或等待证明能力所需的显式动作。它的证据
  可以修订本章，但在 merge 与 readback 前不能建立当前产品事实。
- `OBSERVED_CANDIDATE_NOT_CURRENT` 表示能力或消费者可见缺陷在活跃 Hub task 或 worktree 中被观察到，
  但不是已交付产品能力，也不是 current fix。
- `RECOVERABLE_BY_RECONSTRUCTION_NOT_RESTORED` 表示现存精确证据可能足以让 canonical Owner 重建丢失事实，
  但可信 backup restore 或 Owner reconstruction 尚未发生。受影响能力保持 unavailable，不得推断历史状态或正向 action。
- `RESTORED_REVALIDATION_PENDING` 表示 canonical Owner custody reconstruction 与 direct Owner readback 已成功，
  但下游 consumer revalidation 尚未完成。它不是 `RESTORED`：stale fact 在 current cut 仍 unavailable，且不得启用
  任何正向 action。
- `TARGET_DRAFT` 表示当前设计预期未来 Dashboard 提供该能力；相关真实消费者流程终结前仍可修订。
- `IMPLEMENTATION_ADMITTED` 表示 repository 可以把已文档化的 `DRAWABLE_EXACT` route 或 reusable atom
  作为有边界、可独立 review 的切面实现。它只是构建与验证许可，不证明切面已合并、已部署、已被 Owner
  验收、已具备替换条件，或已被授权执行生产 effect。
- `NOT_ADMITTED` 表示 UI、绿色 job、图表、日志或本章都不能证明能力存在，也不能授权相关业务迁移。

### 2026-08-28 已合并 Source、Windmill、Scanner 与 Market Data 回读

当前 Trade main `e12adde09754e20953ac81ce86ffa5e7b3a05c99` 已包含完成的 Source Intake、Windmill 与
Scanner 切面。PR #356 以 `82c4f59fc600a1d5d0a9bc94eac83234c531e490` 合并，恢复了经过真实 Windmill
entry、PostgreSQL Owner custody 与 cleanup/readback 的隔离 Source Intake 验收。PR #361 以
`a7260f6563fbdf1c1b497087d638c0c406e4cefb` 合并，使检入的 Windmill workspace lock 成为 deterministic、
read-only-verifiable projection；这是仓库 tooling 证据，不是 deployment 证据。PR #360 以
`67d31f5398922680714827206ceb2583437a869b` 合并，为 Product Edge 添加 sealed Scanner terminal-receipt
read boundary；它仍是 static Owner contract，不能建立 Scanner operation 或 Windmill journey。

PR #362 是当前 Source Intake-to-Research 切面。默认 Windmill operation 现在把已准入的 Source terminal
发送到 canonical R&D Owner API：`RUN` 拥有第一次 mutation，`RESOLVE` 保持 read-only，且只有在精确 durable
receipt 已存在时才不返回 submitted-or-unknown。其 final tree 的 focused Source/Windmill check 通过
`5/5`，Workbench default check 通过 `164/164`，focused API check 通过 `5/5`。Disposable
Windmill/PostgreSQL sealed acceptance 在 pre-final tree 通过，但在最终 `RESOLVE` correction 与不相交的
main-only 变更后未重跑。因此其 maturity 是 `CURRENT/PARTIAL · EXACT_HEAD_COLD_ACCEPTANCE_NOT_ADMITTED`：
未来 Dashboard 可以保留这些 fail-closed action 与 recovery semantics，但不得仅根据 transport success
渲染正向 Source-to-Research 结果。Deployed default Windmill workspace、authenticated browser 或 native MCP
acceptance、Dashboard implementation、provider 或 network execution、production write 与 trading 全部仍为
`NOT_ADMITTED`。

PR #364 以 `e12adde09754e20953ac81ce86ffa5e7b3a05c99` 合并，进一步把 deployment-store admission 与
revalidation 收入 Market Data Owner boundary，并只向 Strategy Factory 暴露 move-only sealed
`ResearchPitTerminal`。Capability Adoption 现在把 pure `crates/product_edge_contracts` representation 收入
Product Edge，但不授予其 fact 或 authority ownership。这是
`CURRENT/PARTIAL · DYNAMIC_POSTGRES_PRODUCT_COMPOSITION_NOT_ADMITTED`：downstream code 无法构造 terminal，
也无法读取 raw store、PIT、Source Binding 或 clock row；在已观察的 Darwin 切面上，disposable
PostgreSQL acceptance 仍 unavailable。未来 Dashboard 可以把该 sealed handoff 显示为 Owner evidence，
但不得由此推断 Market Data availability、default Windmill readiness、production resolution 或正向
Source-to-Research 结果。

### 2026-08-23 已合并 H1 回读

PR #326 已作为 `81c519fade16810c3d9694226092c83f1f886b07` 合并到 Trade main。它的 merge tree
`1760234821f2e12e3e6ea452d1b8395e69a0a34f` 与独立审查 candidate
`142ba65ef069077b76106f0fe8afa853591926a3` 的 tree byte-identical；这是 squash merge 后的 tree equality，
不是 commit ancestry。该合并切面通过 Workbench `67/67`、focused consumer projection `14/14`、artifact
build `35/35`、focused 与 manifest-scoped Rust gate，以及五组 disposable Linux/PostgreSQL suite（fresh
migration、Product Edge、retry、recovery、ACL，各 `1/1`）。两个 independent exact-head review lens 均无
finding。这些 receipt 只准入以下窄状态变化：

| H1 表面                                                                                                                        | 当前证据状态                                               | Dashboard 解释                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator Authorization、Product Edge admission、claim/start custody、R&D invocation reservation 与 strict cross‑Owner readback | `CURRENT/PARTIAL`                                          | 未来 UI 可以依赖 exact locked cut、immutable receipt、direct‑successor distance、zero‑write rejection 与 fail‑closed unknown projection；它们仍是原生 Owner fact，不属于 Dashboard storage。                                                      |
| 仓库 Workbench S1/S2 consumer projection 与 control policy                                                                     | `CURRENT/PARTIAL · DEFAULT_WEB_NOT_REVALIDATED`            | 检入的三卡片 App、shared exact‑key projector、action admission policy、stale‑safe terminal display、四种 read‑only legacy disposition 与 same‑identity recovery 是 current source contract。Focused consumer test 不是 deployed‑browser receipt。 |
| Web/MCP operation selection                                                                                                    | `CURRENT/PARTIAL · CHANNEL_ACCEPTANCE_NOT_ADMITTED`        | 仓库 App 与 narrow MCP profile 都选择 `research_goal_v2`；`artifact_build_v1` 仍是 S2 operation。H1 未 mint 或使用 token，也没有执行 native MCP parity run。                                                                                      |
| Runtime foundation direct consumer                                                                                             | `CURRENT/PARTIAL · FOUNDATION_NOT_READY`                   | PR #330 只准入 non‑authoritative `NotReady` 与四个 exact revalidation dependency。不存在 Runtime custody、Strategy Instance、generation application、recovery 或 trading surface；`READY` 与 `APPLIED` 仍 unavailable。                           |
| Market Data durable Owner foundation                                                                                           | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER` | PR #331 只准入 private atomic custody 与 sealed Source Binding/PIT Snapshot readback contract。不存在 provider、ingestion、product resolver、H0/Dashboard/Workbench/Windmill consumer、default database、positive page row/action 或 cutover。    |
| Portfolio R0 Owner View contract                                                                                               | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`       | PR #332 只准入 deterministic request/replay validation 与 structured unavailable result。PAPER/LIVE 都仍 unavailable；不存在 positive Performance、Exposure、Capacity、Attribution、Risk、headroom、allocation、deployment 或 trading surface。   |
| Windmill Runs、Run Detail、log、worker、service log、audit 与 dependency job                                                   | 来自较早认证观察的 `TARGET_DRAFT`                          | H1 没有新增默认 Windmill journey。替代品只保留下文较早真实观察证明的 operational semantics 与固定 empty state。                                                                                                                                   |
| 默认 Windmill/PostgreSQL deployment、external provider execution、Dashboard service/code/package、真实交易与生产写             | `NOT_ADMITTED`                                             | Enabled button、green Windmill job、已合并 backend contract 或本文档都不能暗示这些能力。                                                                                                                                                          |

本次回读覆盖下文历史 H0/H1 defect 对 PR #326 已包含合同所标注的 candidate-only 状态：action-time Research
admission、original-authorization continuity、sealed claim/start custody、按 resolution 区分的 wire verification、
existing claim 的 prepare-free start、stale-safe terminal custody 与 legacy quarantine。旧行继续作为 incident
与设计决策历史，但不得再解释为 merged correction 的当前状态。默认 deployment 与真实 external effect 仍未晋级。

### 2026-08-23 已合并 Observability 回读

PR #327 已作为 `3ec29c7a4662efb2d4d28e2bb3e4181570a815b7` 合并到当前 Trade main。新的 workspace-owned
`vibe-observability` crate 与 root consumer test 把 read-only、rebuildable status projection source contract
提升为 `CURRENT/PARTIAL`：它保留 per-Owner/source frontier、freshness、partial/rebuilding/unavailable
visibility、identity-content conflict quarantine、opaque restart checkpoint 与 query-only
`GlobalStatusReadPort`。Crate test 通过 `18/18`，root consumer 通过 `1/1`，同时通过 focused
fmt/check/clippy/doc 与 independent review。Owner ingestion 在 crate-owned typed canonical outbox adapter 存在前
保持 sealed；telemetry visibility 被硬编码为 `Unavailable`，且没有运行 runtime adapter 或 authenticated
Windmill/Dashboard consumer。因此本次 merge 只准入固定 `/dashboard` 与 `/operations/telemetry` source
projection contract；不准入 telemetry availability、Owner health inference、command、retry、Dashboard
implementation、默认 Windmill、external provider execution 或 production effect。

### 2026-08-23 已合并 Scanner 与 Governance 回读

PR #334 已作为 `1a3c47b06470816da4974bfb85c9a8a140c60f7e` 合入当前 Trade main。Scanner terminal receipt
现在必须经过 sealed Owner admission；Governance 会在任何 receipt、lifecycle、outbox、Runtime handoff 或
successor 写入前拒绝 invalid/unavailable Eligibility。这些静态合同为 `CURRENT/PARTIAL ·
STATIC_CONTRACT_CLOSED_NOT_RUNTIME`；durable Owner adapter、Qualification terminal integration、
runtime/product readiness、Windmill、provider/network effect、LIVE、生产写与交易仍为 `NOT_ADMITTED`。

### 2026-08-23 已合并 Runtime foundation 回读

PR #330 已从 reviewed head `96296549794b5b66fb3d730a505cc0551fe80e16` 作为
`73edb0e32f1745cc835951a1b9bd6cb38e456c35` 合并到当前 Trade main。Workspace-owned `vibe-runtime` crate
与 direct consumer 只把 lower-maturity foundation contract 提升为
`CURRENT/PARTIAL · FOUNDATION_NOT_READY`：`RuntimeFoundation.status()` 始终为 `NotReady`，
`revalidate_after()` 精确返回 Governance authorized-generation decision read、canonical Runtime custody、
Artifact compatibility recovery read 与 Execution recovery frontier read。Direct consumer 与 crate unit test
各通过 `1/1`；PR 还记录 focused check、root pre-commit 与 independent authority-representation review。Crate
不暴露 authoritative Runtime fact/custody、Strategy Instance、generation、checkpoint、recovery、application、
order、provider、credential、network 或 trading-effect surface。因此 merge 只准入固定 foundation `NOT_READY`
card 与四行 dependency；不准入 deployed runtime/default-Windmill consumer、`READY`、`APPLIED`、Resolve、
Apply、recovery 或其他 effect。

### 2026-08-23 已合并 Market Data durable foundation readback

PR #331 以 head `c07da16786f6e845794790802761ad272342b987` 合并到当前 Trade main
`d790ae8702b1d254342ad81a82d8fc90e4b78d7a`。其 maturity 是
`CURRENT/PARTIAL · DURABLE_MD_OWNER_POSTGRES_FOUNDATION_NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER`。Private
PostgreSQL custody 原子提交 Source Binding 或 PIT Snapshot fact、native outbox、lineage head 与 Owner clock，
并精确处理 replay/conflict。Public code 只暴露 `SourceBindingOwnerResolver` /
`SourceBindingOwnerReadback` 与 `PitSnapshotOwnerResolver` / `PitSnapshotOwnerReadback`；caller 无法构造
sealed readback，也无法访问 writer、trusted clock、database constructor、raw envelope 或 canonical positive
type。Disposable PostgreSQL direct-consumer scenario 通过 `1/1`，`vibe-data` library 通过 `301`、并有一个
ignored disposable harness，compile-fail doctest 通过 `10/10`；PR verification 还记录 package/root gate
与 fresh no-HIGH/MEDIUM review。

该 merge 只准入 durable foundation contract 与 exact readback field geometry，不准入 provider authenticity、
ingestion、public/production writer composition、default/shared PostgreSQL、H0 HTTP/JSON resolve、
Workbench/Dashboard/Windmill consumer、LIVE provider use、trading 或 cutover。在产品 consumer 单独准入前，
`/data` 与 `/data/pit-catalog` 只渲染固定 foundation card，不显示 binding/snapshot count、row、
timeline、positive badge、resolver action 或 mutation action。

可以在不改变 route maturity 的前提下准备一个 `TARGET_DRAFT` 平铺 `MarketHeatmap` 展示原子。它只接受
server 已验证且有界的 projection：stable item identity、展示 label、正数布局 weight 与 percentage change。
它保留原源码的 squarified layout、响应式测量、搜索、键盘 focus 与 ripple hover redistribution，但明确没有
child node、breadcrumb、drill-down、candlestick preview、synthetic series 或 runtime mock data。Loading、
unavailable、合法 empty 与 filtered-empty 分开；unavailable 固定渲染零 tile。该原子不能 resolve Owner
custody、读取 private PostgreSQL、认证 provider，也不能把 `/data`、`/data/pit-catalog` 或 `/market` 提升为
available。任何 positive runtime item 进入该原子前，仍必须另行准入 Dashboard/H0 Market Data resolver。

### 2026-08-23 已合并 Portfolio R0 fail-closed readback

PR #332 已从 exact head `e2de832c09811f80158ffd5c70a538f5fad6055c` guarded squash-merge 到当前
Trade main `0ac5f4979bdc2169931f3b260f4459b4d258794b`，merge tree 是
`d4713c95d22cf49bdd63b2ae3243025a6efcaacf`。`PortfolioViewRequest` 绑定 schema version、stable request
identity、principal claim/issuer、principal、account、Execution Scope、PAPER/LIVE mode、
authorization-policy cut、common cut、projection/valid-through time 与精确十一类 direct-source
dependency。Fingerprint 覆盖所有 request、scope、source 与 time field；重排等价 dependency 是 exact
replay，同一 identity 下 changed meaning 是 conflict，新 identity 是 distinct。

Public resolver 始终返回 `UnavailablePortfolioView`：schema version、request identity/digest、
`UNAVAILABLE`、`INCOMPLETE_FAIL_CLOSED` 或 `STALE`、固定 disposition
`SOURCE_OWNER_RESOLVE_UNAVAILABLE` 与完整 structured failure set。PAPER 与 LIVE direct external consumer 都只能
resolve unavailable。十一项有序 dependency 是 Execution account/open orders/fills/fees/settlement、
Market Data price/FX/contract/valuation/liquidity，以及 prior Portfolio snapshot。所有 caller-supplied
principal claim 与 source locator 仍是 untrusted；Execution、Market Data 与 Portfolio direct Owner resolver
缺席。Sealed positive `PortfolioViewReadback` 没有 public constructor、`Default` 或 `Deserialize`，
public resolver 也没有构造它的 code path。

该 merge 只准入 fail-closed request 与 unavailable-envelope contract，不准入 Dashboard/H0/
Workbench/Windmill consumer、positive Account/Performance/Exposure/Gross Capacity projection、Attribution、
Risk、headroom、allocation、deployment、LIVE authority、trading 或其他 effect。在 private direct-source
composition 单独准入前，四个 Portfolio route 都渲染同一固定 unavailable card，不显示 domain
summary、chart、table、timeline、filter、refresh、resolve、allocation 或 trading action。

本设计的主要证据切面冻结在 2026-08-22 Dashboard baseline Origin
`6869be69256d093c222ae6e34027077efe83adeb`、tree `b4f23739eaf52c8c8efe213567904649e6a04677`。
该 baseline 只标识紧随其后的 incident 与 downstream-resolver evidence 的 source revision；后续 consumer row
各自绑定准确 candidate，绝不能把该 baseline 重新解释为当前 repository head。
已停止的精确未提交 R&D candidate `a05d76ea18e2b35d7e55d74357fbc30b971ec1a2`、tree
`eb25b1a8325c4711ebd8d2cd012b3a87f70741c6`、tracked diff
`a5896bb23294e00fce158eedf97a429f9f06c35b9f243264455c7877c87da6c3` 与 untracked set
`46ea5cd2ff29ef88a348a43c4d28c250b21a23ae90ac5871c8b581891567c722`，已实现双层 Product Edge downstream
resolver，并形成 OA `3/3`、PE `1/1`、Qualification `1/1`、首个 R&D-to-TrialFamily S1 `1/1` 与 Workbench `5/5`
聚焦证据。在任何 image 重建或新 Windmill/Provider run 前，一个 destructive Qualification test 被错误地用于默认
持久化数据库，把 protected-feedback projection、head 与 outbox 表 drop/recreate 为空。不存在 backup、PITR、
Owner archive 或完整 canonical row image。canonical Qualification Owner reconstruction 与 direct Owner readback
现已成功：projection、head、original outbox 为 `1/1/1`，并有一份独立 recovery receipt。incident 状态是
`RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`，不是 `RESTORED`。Recovery receipt
`qualification-owner-recovery-receipt-v1-8d4bc7a06d100b2e7fb1817a7ac3d1697412621024c34556fb8b7a8d1499a2b3`
的 digest 是 `sha256:8d4bc7a06d100b2e7fb1817a7ac3d1697412621024c34556fb8b7a8d1499a2b3`；精确 target fingerprint 是
`sha256:cb7a0b3d7041e007d87a1afc8b9aa7204535ef64706d7293337cca3c0a1ebd7e`。这是无 backup 的 deterministic
canonical reconstruction：未观察 raw original JSONB storage bytes，未恢复 physical backup，未 mint 新 validity，
也未 emit 新 domain wake。原 frontier 的 `valid_through=1787308603208`，在 current cut 已 stale/`UNAVAILABLE`。
default-Web、Product Edge 与 R&D consumer revalidation 尚未运行；Submit、S1、S2 与 provider action 保持 disabled。
Windmill 与 R&D 共用 volume，因此仍禁止整体 rollback。item-1406 Product Edge admission/receipt/outbox 保持
byte-identical，而 runtime/Web S1-to-S2、provider canary、完整 gate、candidate commit 与交付仍为
`OBSERVED_CANDIDATE_NOT_CURRENT / NOT_ADMITTED`。

较早的认证默认 Web S1 job `01a0258e-773e-d80b-e464-6b4cd7a20c7e` 仍是 layout 证据：它渲染
`REJECTED_NO_WRITE / CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST / missing Owner receipt` 并禁用 S2，但 durable
readback 显示 Product Edge admission/outbox 各一张、R&D receipt/Intent/family 为零、provider claim 为零。
Dashboard 仍必须把该 handoff 渲染为 `SUBMITTED_OR_UNKNOWN`，绝不能显示为输入拒绝。
较早直接相关的 TrialFamily Product slice 基于 Hub Origin
`8375a7b616d18c2084bcea7012ebc878afa1a96c`、tree
`0252b50de2951ce3e23cd4cb2b5dbe8aeb0b5b3a`。明确 architecture authorization 现已定义 R&D-owned
independence-basis/genesis contract，以及根据该精确 basis 发布 opaque protected-feedback frontier 的独立
Qualification Owner。Product Edge 只传 reference/cut；R&D 在 family formation 前重新解析 basis、Qualification
projection 与完整本地 lineage。被拒绝 candidate `222c7a669aa30b9f28c2191ff14b9c9b8f24e543`、tree
`3402b2e16971d1c56f9d375b5e673c4547337d05` 动态证明隔离 canonical-history 默认 Web 链路
`R&D basis receipt -> Qualification GENESIS_EMPTY receipt -> S1 ACCEPTED with family census -> S2 SUCCESS + time-bound binding receipt -> REVIEW_ARTIFACT`，
以及不重新执行 build 的 byte-identical S1/S2 restart 和 Windmill 页面状态/cache-loss recovery。在保持不变的
原 Owner 数据库上，成功 Windmill job 因不完整历史 custody fail closed，正确停留在业务
`SUBMITTED_OR_UNKNOWN`，且只有 `RESOLVE_SAME_REQUEST_IDENTITY`。Authority reviewer
`01a02410-4530-7010-b495-9d2a4e588239` 仍拒绝该 candidate：Qualification 可在未穷尽验证历史
projection/outbox 时根据 missing head 推断 `GENESIS_EMPTY`；positive TrialFamily graph 仍可 public deserialize；
Artifact custody 可在 canonical verification 前应用 JSON selector/predicate。Consumer review 与 delivery 未获
准入。Hub planner 正判断三项是否属于一个 candidate-local correction batch，因此成功 journey 仍只是
candidate‑only 设计证据，不是 current product fact。
在 lock-only commits `def6b37653` 与 `3183d3a280` 之后，PR #268 带来了第一项业务 diff：Strategy Factory
Product Edge 在 exclusive `valid_through` 边界已按 stale 处理。只有这一条 projection 是
`CURRENT/PARTIAL`；它本身并未把当时尚未合并的 F1 foundation、S3 replay 或任何 Dashboard/Windmill
service 升级为 CURRENT。PR #327 后续的 Observability disposition 记录在下文。随后 PR #269 带来结构性的
Risk-to-Model dependency edge；PR #270 只修改
`codex-skills.lock.json`，推进 control-plane bootstrap custody，但没有新增 Dashboard、Windmill 或业务能力。
S1 有来源研究 intake 与 S2 Artifact Formation 仍是 `CURRENT/PARTIAL`；S3 Exploratory Replay
仍是 `ACTIVE_OBSERVATION` 与 `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE`：历史 Web run
保留为设计证据，但当前 remote operation 已归档，不能派发。PR #326 还把窄 Operator Authorization、
Product Edge、Qualification custody、R&D invocation-custody 与 API-composition contract 提升为
`CURRENT/PARTIAL`；它不准入这些合同的默认 service/Windmill deployment 或 external effect。PR #327 后，F1
Observability source projection 也成为 `CURRENT/PARTIAL`，但其 Owner/telemetry adapter 与 runtime consumer
仍 unavailable。Scanner 与 Governance 采用上文已合并的静态合同 disposition；其 runtime 与 product
consumer 仍 unavailable。PR #330 Runtime foundation 是 `CURRENT/PARTIAL`，但唯一 state 是 non-authoritative
`NotReady`；全部 authoritative Runtime custody、instance 与 application surface 仍 unavailable。PR #331 也使
durable Market Data Owner foundation 成为 `CURRENT/PARTIAL`，但 provider authenticity、product resolver
composition、ingestion、cutover 与所有 positive Data page row/action 仍 unavailable。每项状态必须由
精确 checkout、candidate、merge tree 与 consumer identity 管辖；未来 agent 不能复制本页状态来升级观察结果。

### 观察 custody 与修订规则

观察来源为 Hub `01a014ef-d305-7b40-8d6b-f5c6d26fca56`，但本文档采用
**事件驱动，而不是 cursor 驱动**。只有 Hub 或 delegated Task 的变化至少改变下列一项时，才与本文档有关：

- 真实默认 Windmill/Workbench Web journey 或 native operation；
- 消费者可见的 route、tab、field、action、state、empty state、permission 或 recovery path；
- 渲染或执行上述可见行为直接需要的 Owner/backend contract；
- 有证据支持的 Windmill capability 保留、延后或排除决定。

内部 bug 修复、gate 执行、rebase、candidate commit、review、PR 与 merge 本身不触发文档修订。只有它们最终
产生真实 consumer contract 变化或新的动态 Windmill/Workbench observation 时才有关。

| Consumer line                                | 记录时 evidence state 或后续 disposition                   | Dashboard consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #326 H1 merged override                   | `CURRENT/PARTIAL · DEPLOYMENT_NOT_ADMITTED`                | 本行是下文 corrected S1/S2、Product Edge authorization、FirstMutation continuity、H0 与 H1 合同的最新 disposition。Merged source 与 isolated PostgreSQL suite 已 current；这些历史 defect 行上的旧 `OBSERVED_*_NOT_CURRENT` 只描述其 rejected candidate cut。默认 Windmill、native MCP parity、external provider execution 与 Dashboard implementation 仍为 `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S1 sealed basis stage recovery               | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | Fresh authority review 拒绝 `c72f44edb`：第一笔 transaction 可以提交 Independence Basis Receipt、basis head 与 outbox，而 Qualification 和 terminal Research receipt 仍缺失，但重试仍选择 `FirstMutation`；后续 generation-3 cutover、revocation 或 expiry 因而可能永久卡住 partial custody。TARGET 把该阶段 canonical seal 为 `SEALED_BASIS_PENDING_QUALIFICATION`；同一 request 从 historical custody Resolve 或完成，不重复 basis/head/outbox，changed request/admission 必须 conflict。Consumer v4 的 31/31 test 未发现另一组 H1 static defect，但 dynamic PostgreSQL、Windmill、provider 与 browser acceptance 仍 unavailable                                                                                                                                                                                                                                                                                                                                                                             |
| S1 Workbench resolve 与 terminal retention   | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | Fresh v5 authority 与 consumer review 拒绝 `e5893fd550`：Workbench public `RESOLVE` 不发送 request body，进入的 `resolve_v2` 只查 terminal Research custody，不能推进 sealed basis stage；唯一 Historical completion path 仍要求再次 `submit_v2`，但 unknown‑state App 禁止该动作。Qualification projection 若在 response loss 前已提交，Owner 又没有 successor/renewal path，之后会永久 stale；已经完整的 S1 receipt/TrialFamily 也会在 linked view expiry 时被隐藏成 `SUBMITTED_OR_UNKNOWN`。TARGET 为无 body 的 same‑identity Resolve seal 完整 typed request meaning，由 Qualification Owner 提供显式 verified renewal/successor recovery，并在撤销全部 positive action 的同时把完整 terminal receipt/family 保留为 read‑only `STALE`。S2 claim/start、stale terminal 与四种 legacy projection 仍通过 31/31 static check；dynamic PostgreSQL、Windmill、provider 与 browser evidence 仍 unavailable                                                                                                        |
| S2 action‑time Research freshness            | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | Consumer v6 拒绝 `4c28bd583f`：Workbench 缓存 Owner `AVAILABLE` projection 且只校验 interval shape，页面跨过 `valid_through` 后仍启用 S2 Run。冻结的 v7 candidate `b48b588f267f8222e98659bc397e362fc70248e6` 增加了 App same‑identity S1 Resolve 与 server‑locked current‑Research custody，但 fresh review 再次拒绝：transient S1 Resolve failure 保留了旧 S1 `AVAILABLE`，同时伪造一个 attempt 根本不存在的 Artifact unknown/Resolve；server path 也未要求 exact canonical effect set，且没有 dynamic `valid_through` lock‑wait race 证明零写。TARGET 把可取消的 read‑only `PREFLIGHTING` 与不可取消的 `ADMITTING` 分开；preflight failure 撤销 Research current‑positive gate 但不创建 attempt；只有 locked OA → Product Edge → R&D cut 且 effect 精确为 Artifact mutation + provider invocation 时才可跨过 effect boundary；只有 dispatch 后歧义才进入 `SUBMITTED_OR_UNKNOWN`。Workbench 34/34 与 static gate 只是 candidate evidence；live default‑Web、dynamic PostgreSQL 与 provider 证据仍 unavailable |
| S1 V2 TrialFamily -> S2 Artifact binding     | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                  | Replacement candidate `3862ed8bcb` 再次动态证明默认 App canonical‑history 链路 `basis receipt -> Qualification GENESIS_EMPTY receipt -> S1 ACCEPTED/family census -> S2 SUCCESS/time‑bound binding receipt -> REVIEW_ARTIFACT`；删除本任务三个 job 并重启 Owner/worker 后，在不重新执行 S2 时返回 byte‑identical request、attempt、basis、Qualification frontier、family、Artifact 与 binding identity。较早被拒绝的 candidate `222c7a669a` 还证明不变原历史可让 Windmill job `success` 的业务状态保持 `SUBMITTED_OR_UNKNOWN`，且只有 `RESOLVE_SAME_REQUEST_IDENTITY`，因此 operational success 与 Owner outcome 必须分离                                                                                                                                                                                                                                                                                                                                                                                      |
| R&D freshness 与 no‑Artifact receipt closure | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                  | Exact‑expiry zero‑write、relational mutation/restoration、locked binding read 与 stale S1/S2 resolve‑only 行为继续保留。Authority‑unavailable S1 resolve/replay 与 S2 prepare 归一为非终态 `SUBMITTED_OR_UNKNOWN`；semantic conflict 仍是 conflict。Invalid V2 只可持久化一张独立 rejection receipt，basis/projection/Research/Intent/family/member/head/outbox 必须零写入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| TrialFamily lineage/feedback authority       | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                  | Architecture 现已准入 R&D basis/genesis Owner fact 与 Qualification opaque frontier fact。App 不再接收 predecessor/feedback/independence authority field，而是显示 sealed basis 与 Qualification receipt。Positive S1 必须先验证完整 V2 request，再在 `scope -> request` lock 下无 raw selector 枚举全部 lineage receipt、逐行 canonical verify，最后才 filter/form family。Positive TrialFamily graph 必须是 sealed Owner output，绝不能 public `Deserialize`。损坏或 unavailable history 返回 `SUBMITTED_OR_UNKNOWN`，绝不能伪造 genesis                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Product Edge action authorization            | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                  | 已停止 candidate 实现了 Product Edge‑owned SQL‑envelope 加 Rust sealed‑readback resolver，并证明 OA‑to‑PE lock order、shared reader/exclusive writer、exact ACL、migration 幂等以及首个经固定 port 的 R&D S1。数据库事故前尚未完成重建 image 或默认 Web 验收，因此较早 UI 缺陷仍是当前 observation：committed PE admission 加 unavailable downstream R&D custody 必须是 `SUBMITTED_OR_UNKNOWN`，禁用 S2，只暴露 same‑identity Resolve。Provider、完整 runtime、commit、交付与最终 review 仍为 `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FirstMutation original OA continuity         | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | Authority v6 拒绝 `4c28bd583f`：尚未 mutation 的 admission 仅把 original Operator Authorization 作为 historical 验证，再让 immediate Product Edge successor 的 current OA 在 final cut 替代它。TARGET 要求在准确 final write cut 对 stored original OA 执行 `CurrentAtLock`；使用 immediate successor 时，还要在同一 cut 独立要求 successor OA 与 Product Edge binding current。Original OA expired/revoked 时显示 `ORIGINAL_AUTHORIZATION_NOT_CURRENT`，保留两个 evidence row 为 read‑only，禁用全部 FirstMutation action，且 basis、rejection receipt、provider invocation admission 与 claim 全部零写入。已提交 basis/terminal 的 Historical resolution 保持独立。Dynamic multi‑Owner PostgreSQL 与 Windmill evidence 仍 unavailable                                                                                                                                                                                                                                                                        |
| H0 exact‑head correction set                 | `CURRENT/PARTIAL · DEFAULT_WEB_NOT_REVALIDATED`            | PR #326 关闭 `c224927c54` 的六项 rejected‑contract defect：Qualification physical authority 保留在其 Owner；final write‑edge freshness 被锁定；policy‑equivalent cutover 保留 exact predecessor continuity；claimed invocation custody 暴露唯一 resumable Run action；unavailable S2 authority 保持 unknown 而不是 input rejection；App/MCP 选择 `research_goal_v2`。Isolated PostgreSQL evidence 已 current，但默认 App、native MCP parity、external provider execution 与 product acceptance 仍为 `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| H1 fresh invocation admission                | `CURRENT/PARTIAL · DEFAULT_WEB_NOT_REVALIDATED`            | PR #326 以 original‑or‑immediate‑successor distance、按 resolution 区分的 absent/present wire field、existing `CLAIMED` custody 的 prepare‑free start、stale‑safe terminal readback 与四种 read‑only legacy disposition 关闭 `6bd9f627` 的 rejected defect。Workbench `67/67`、consumer projection `14/14`、artifact build `35/35`、isolated dynamic PostgreSQL 与两个 independent review lens 支持 merged contract。默认 Windmill、external provider execution 与 real‑consumer deployment acceptance 仍 unavailable 或 `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Qualification protected‑feedback frontier    | `RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`             | canonical Qualification Owner reconstruction 与 direct Owner readback 已成功，projection/head/original outbox 为 `1/1/1`，另有一份独立 recovery receipt。原 frontier 在 `valid_through=1787308603208` 后仍 stale/`UNAVAILABLE`；default‑Web、Product Edge 与 R&D consumer revalidation 尚未运行。Dashboard 必须把 Owner store 渲染为 unavailable，绝不显示 fresh `GENESIS_EMPTY`；隐藏 Copy frontier 与全部正向 Submit/S1/S2/provider action；显示受影响 store/table 集合、last trusted cut、当前 `1/1/1 + receipt` readback、recovery classification 和 immutable incident evidence；只提供 Open incident evidence 与 Copy locator。没有 Restore、Reconstruct、Clear incident、successor 或 retry control                                                                                                                                                                                                                                                                                                     |
| S3 Exploratory Replay                        | `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE`  | 历史默认 Web 真实 run 已证明 Run Detail 信息架构与 Owner readback shape，但 TrialFamily deployment sync 已归档 remote S3 replay operation。Backtest route 必须显示 capability unavailable 并禁用调用，直至从 frozen candidate 显式恢复 S3 且重新验证。Native MCP parity 仍不可用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Observability status projection              | `CURRENT/PARTIAL · ADAPTERS_UNAVAILABLE`                   | PR #327 已合并 read‑only、rebuildable projection、per‑source frontier/freshness/completeness state、quarantine、restart checkpoint 与 query‑only consumer port。没有 crate‑owned typed canonical outbox adapter 时 Owner ingestion 保持 sealed，telemetry 始终为 `Unavailable`，stale 或 self‑asserted telemetry 不能产生 `Available`。Runtime consumer、Dashboard/Windmill integration 与 operational telemetry backend 仍为 `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Scanner public terminal projection           | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`     | PR #334 将 public terminal receipt construction 封闭在 exact Scanner Owner admission 之后。直接 Owner consumer 与 runtime adapter 分别准入前，Dashboard terminal row、count、badge、receipt、Matcher invocation 与 Proposal evidence 仍 unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Governance invalid Eligibility admission     | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`     | PR #334 在 Governance admission 前拒绝 invalid/unavailable Eligibility，且没有 receipt/lifecycle/outbox 写、Runtime handoff 或 successor action。Receipt‑backed `REJECTED_NO_WRITE` 是独立的已准入 Governance decision；positive application 与 runtime consumer 仍为 `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Qualification intake replay                  | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | F1 已证明同一 request/handoff identity 下两种不同非法 replay meaning 会错误 join 第一张 `NOT_ADMITTED` receipt。被拒绝的 candidate 必须修正为：精确语义 replay 解析原 receipt，任何 changed meaning 返回 `RequestSemanticConflict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Qualification public projection              | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | F1 已证明合法非终态 `Admitted` 与 `Evaluating` summary 可能被误报为终态 `ClosedNotQualified`。Public projector 必须拒绝非终态 summary；不得推断 terminal row、count、receipt、color 或 action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Market Data durable Owner foundation         | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER` | PR #331 准入 private atomic PostgreSQL custody 与 sealed read‑only Source Binding/PIT Snapshot resolver/readback contract。未准入 product composition、H0/Dashboard/Workbench/Windmill consumer、provider authentication、ingestion、public writer、default database、cutover 或任何 positive Data page row/action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Portfolio R0 public resolver                 | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`       | PR #332 使 deterministic request/replay validation 与 structured unavailable envelope 成为 current。PAPER/LIVE 都 fail closed；四个 Portfolio route 只暴露固定 contract card，不暴露 positive projection data 或 domain action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Risk                                         | `MECHANISM_REJECTED / NOT_ADMITTED`                        | Static schema 与 test‑constructed positive path 不是真实 consumer。Risk route 只保留 target skeleton，不得渲染 available state 或 enabled business action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

S3 Web observation 显示 Backtest receipt 与 canonical result、实际 Artifact/PIT/runtime/simulator identity、
完整 diagnostic set、R&D handoff、`EXPLORATION_ACTIVE · AVAILABLE`、明确的 `NOT_ADMITTED` boundary，
以及一次关联 engine invocation 且没有 duplicate attempt。该证据支持 Run Detail layout、tab、status
处理、receipt card、bounded log 与 recovery copy；它不能证明 native MCP parity，也不能把 replay 准入为
当前 shared-product capability。

剩余 action-time credential boundary 同样是消费者可见的：native MCP 验证需要只允许 replay operation 与
bounded read‑only job/log access 的可撤销短期 token，随后还要撤销并证明旧 token 被拒绝。只有该 journey
被实际执行后，本文档才可能变化；token planning、后台修复或 task progress 本身不会改变文档。

出现直接相关事件后，观察 agent 只对 Hub 与受影响 Task 做一次 bounded read，然后检查精确默认 Web journey、
native MCP operation set、job lifecycle、Owner receipt/view、recovery behavior 与 permission。Capability
只有在具备真实 consumer 或明确 architecture/safety requirement 时才能进入 `TARGET_DRAFT/KEEP`。没有
观察到使用时保持 `NOT_OBSERVED/CURRENTLY_EXCLUDE`，而不是永久删除。文档检查只证明文档完整性，绝不会
把后台工作升级为 Dashboard capability。

## 产品角色与权威

Dashboard 是单一本地操作者使用的第一方可视化 Product Edge。它展示原生 Owner View、提交类型化请求、
跟踪长任务，并呈现相关 Owner 返回的唯一下一合法动作。它也是 Observability projection 与 operational
job 状态的只读表面。

Dashboard 永远不是业务事实 Owner。它可以缓存 UI 状态与可丢弃 job projection，但不能拥有 Research
Intent、Artifact、Backtest Result、Qualification、Scanner Proposal、生命周期授权、Runtime application、
Portfolio、Risk、order、fill、reconciliation 或 Recovery 事实。每个业务状态与允许动作都携带 Owner
identity、source cut、observed time、freshness 或 availability，以及原生 receipt locator。unknown、stale、
partial、rebuilding、quarantined 与 unavailable 必须显式保留。
Product Edge 只把 `UntrustedOwnerEvidenceLocatorV1` 与 `UntrustedLocatorDigest` 当 routing/integrity vocabulary，
绝不能当作 proof。它必须调用被标识 source
Owner 的 typed public resolve port，并验证由该 Owner durable store/outbox 重读返回的 canonical bytes。浏览器、
BFF、共享 library 或 consumer service 都不能用 caller authority 文本、self-canonical digest、通用 verifier
或共享 signer 建立 provenance。

```text
User -> Dashboard typed request -> Product Edge admission -> native Owner
User <- Dashboard projection <- Owner receipt/view or explicit unavailable state

Telemetry/Event Rail -> rebuildable Dashboard projection
Windmill/Dashboard job success -X-> business success or trading authority
```

修改型控件必须等到当前 Owner projection 精确准入该动作后才启用。提交会创建类型化请求，绝不直接编辑
Owner 记录。unknown outcome 只能暴露 same-identity resolve。真实交易与其他生产写仍需本设计文档之外的
明确用户授权。

### Action authorization 准入合同

Owner projection 返回 next action 只是启用 button 的必要条件，不是充分条件。Dashboard 在渲染 enabled
修改型控件前，必须用稳定 request preview、有效 principal 与 scope、target Owner、canonical operation、
semantic payload identity 和 audit correlation 调用 typed Product Edge admission port。返回值是
`ActionAdmissionEnvelope`，且只能有以下一个状态：

```text
admitted | expired | revoked | stale_head | no_active_binding |
ambiguous_active_binding | manifest_mismatch | denied | unavailable
```

`admitted` 分支交叉绑定三张由独立 port 解析的 canonical record：

1. `ShellDeploymentBindingEnvelope`：binding identity、generation、deployment‑history head、`ACTIVE` state、
   principal、scope-policy/capability/audit-policy version、cutover epoch、source cut 与 valid-through time。
2. `OperatorAuthorizationEnvelope`：authorization identity、issuer、subject/effective principal、audience、准确
   scope、带 Time Evidence 的 issued/expiry time、revocation frontier、request-proof digest 与 manifest digest。
3. `AgentOperationManifestEnvelope`：content digest、operation identity/version/schema、target Owner、允许
   object class、禁止写入与 capability-policy digest。

Product Edge admission service 读取权威 deployment head，要求准确一张等于该 head 的 `ACTIVE` binding，
通过 trusted authority port 解析 Operator Authorization，再按 content digest 取得 immutable manifest。
`ShellBindingHistoryStore`、受信 `OperatorAuthorizationResolver` 与 content‑addressed
`OperationManifestStore` 是相互独立的 authority surface；Dashboard session state、environment/default
policy、本地配置、持有 credential，或由同一个 validator 构造的 object 都不能填充这些 store。Browser
只能收到 bounded projection，绝不获得 issuer 或 signing operation。

`POST /api/product-edge/actions/{operation_id}/admission` 返回用于渲染的 preflight envelope。只有
`admitted` 才启用准确 manifest member，并显示 authorization identity、binding/head、manifest digest、
scope、expiry 与 revocation frontier。提交必须在业务写入边界原子重复同一 admission；之前绿色的 preflight
绝不能授权之后的写入。每个非 admitted 分支都保持 disabled 并返回一个稳定 stop predicate。只有 same-identity
Owner resolve 自己的 read manifest member 被准入时才可用；transport credential 既不是 Operator Authorization，
也不能证明 admission。

对 S2 这种有 domain freshness prerequisite 的 operation，可见 primary control 是 `Check & Run`，不能让 cached
`AVAILABLE` 直接授权 effect。第一次 transition 是 read-only `PREFLIGHTING`：App 用 Owner current projection
Resolve 同一 S1 request/Intent，但这只是 fail-closed UX preflight。Pending 时 primary 显示
`Checking…`，固定 status line 是 accessible live region，且 Cancel 安全，因为尚未发送 Artifact request。
Cancel、timeout、malformed output、transport failure 或 non-current projection 会撤销 Research current-positive
gate，把 historical Research card 保留为 read-only，不创建 Artifact attempt，也不暴露 same-attempt Resolve。

只有 exact `AVAILABLE / INTENT_FROZEN` preflight 可以原子转入 `ADMITTING`。此时 effect‑capable
Artifact request 已发送，`Submitting…` 取代 Cancel，UI 不显示伪造百分比。最终权威 gate 属于
server，不属于 preflight：server 必须验证 exact operation/schema/effect set，并在首次写入紧前的
locked OA → Product Edge → R&D transaction 内重新解析 current R&D custody。Bounded server receipt 让
gate 进入信息蓝 `ADMITTED`；这只是 request admission，不是 Artifact 或 business success。Dispatch
后 timeout、disconnect 或 malformed output 进入 domain `SUBMITTED_OR_UNKNOWN`，并转交 same-attempt Resolve；
绝不返回 `PREFLIGHTING` 或 `REVALIDATION_REQUIRED`。Browser 可以保守地把 aging cached action
改为 `REVALIDATION_REQUIRED`，但只有 Owner response 可以标记 `STALE` 或重新启用 `Check & Run`。

Historical readback 与 current effect authority 是两种独立 projection。Canonical admission snapshot 在 binding
被 supersede 或 authorization 被 revoke 后仍可读，让 Audit 与 Run Detail 解释原始 cut 当时准入了什么；它绝不
参与 current gate。Historical authorization 过期后，policy-equivalent current authorization 只能通过 canonical
append-only Operator Authorization successor issuance 获得；该 issuance 必须绑定 prior identity/scope/sequence
与新的 validity。缺少该 Owner operation 或 receipt 时，`Current authority` 为 `Unavailable`；historical snapshot
仍可见，但 Dashboard 不提供本地 renewal、replacement selector 或推断出的 current authorization。

Admission 尚未执行第一次 downstream mutation 时，continuity 只能使用 original binding 或恰好一个
**immediate** policy-equivalent successor。因此 `successor_distance` 固定为 `0 | 1`；第二次 cutover、跳过
predecessor、出现分支或任意 chain head 时，即使最新 scope 文本等价，`Current authority` 与全部 first-mutation
action 也必须显示 `Unavailable`。固定 `AuthorizationSuccessorReadiness` geometry 显示 admission generation、
current generation、distance、predecessor locator 与 `DIRECT_SUCCESSOR_REQUIRED` stop；绝不能向前遍历直到
找到可用项，也不能代表 generation-1 admission 提升 generation-3 head。已经提交的 invocation
admission/claim/start fact 仍从 sealed custody 做 historical resolve，不重新进入 first-mutation gate。

Stored original Operator Authorization 绝不能变成新 FirstMutation 的 historical authority。Final locked write cut
必须把其自身 row 解析为 `CurrentAtLock`。若 `successor_distance=1`，immediate successor 的 Operator Authorization
与 Product Edge binding 是额外 current requirement，不能替代 original。`AuthorizationSuccessorReadiness` 因此
先渲染 `Original authorization at final cut`，再渲染 `Immediate successor at final cut`；任一 row non-current
都返回 `ORIGINAL_AUTHORIZATION_NOT_CURRENT` 或 successor-specific stop，并禁用全部 FirstMutation control。

第一次 provider claim 前，Product Edge 必须原子重读完整 current deployment 与 authorization history，并持久化
一张独立 sealed invocation‑admission receipt。该 receipt 绑定直接解析的 current
authorization identity/frontier、Time Evidence、policy-equivalent `ACTIVE` binding/head、准确 manifest digest、
historical request‑admission lineage，以及在完整锁集合内采样的一个 final write cut；其 commit time 不能越过
authorization 或 binding validity。Cutover、expiry、revocation、manifest mismatch 或任何
malformed/missing/extra history row 都返回 `unavailable`，且 invocation admission、claim、state 与 provider
effect 全部零写入。

Invocation-admission receipt、claim receipt 与 invocation state 是三个独立 Product Edge fact。Claim 必须消费并
引用 sealed invocation admission，不能用 original request admission 或 transient resolver output 代替。Versioned
public claim readback 必须包含 `invocation_admission_receipt_identity` 与
`invocation_admission_receipt_digest`；Windmill operation adapter 与共享 consumer projector 必须消费同一份
generated/exact parser，并在投影 claim 前绑定两个值。
该 parser 必须按 Owner resolution 分支并精确遵循 Rust serialization：`SUCCESS` 必须带 present/non-null 的
`trial_family_resolution` 与 `artifact_trial_family`；`CLAIMED`、`INVOCATION_STARTED`、
`FAILED_NO_ARTIFACT`、`OUTCOME_UNKNOWN` 与 `REJECTED_NO_WRITE` 必须省略这两个 optional family key；verified
legacy terminal 带 `trial_family_resolution=TRIAL_FAMILY_UNAVAILABLE_LEGACY`，并省略
`artifact_trial_family`。显式 `null` 与省略不可互换。Rust fixture bytes 必须直接输入两个 Windmill verifier 的
同一份跨语言 contract test；人工填写 `null` 的 fixture 不是 acceptance。
Missing、extra、schema-mismatched 或 tampered wire field
保持 A0/A1 geometry 并显示 `Unavailable`，只暴露 same‑attempt Resolve 与 operational evidence，绝不启用 Run。Claim disposition 为
`CLAIMED_NEW | ALREADY_CLAIMED`；state 为 `CLAIMED | INVOCATION_STARTED`；start disposition 为
`STARTED_NEW | OUTCOME_UNKNOWN`。Claim 响应丢失必须恢复同一张 durable `CLAIMED` receipt，并为同一
build request、attempt 与 claim 投影精确 next action `RUN_BOUNDED_EXECUTION_AGENT`。只有该 projection 才启用
**Run bounded Agent + sandbox**，且它必须与 sealed invocation‑admission receipt 直接一致；点击后只启动既有
claim 一次，绝不创建 successor、replacement claim 或第二次 provider invocation。Claim 提交后，任何上层都不能
重新执行 R&D `prepare` 或 current Research freshness 作为新的 start gate。
Start/recovery 只解析该 claim 已密封的 historical Intent/attempt custody；新的 Research cut 只约束 pre-claim
admission 或被明确准入的 successor。即使 claim row 存在，缺失、stale、malformed 或 mismatch 的 invocation
admission 仍渲染 unavailable。start 一旦提交，Run control 消失，任何 replay 都渲染 `OUTCOME_UNKNOWN` 与
`MANUALLY_RECONCILE_PROVIDER_INVOCATION`，绝不再次调用 provider 或伪造 provider outcome。
Operation adapter 必须在任何 pre-claim preparation 前 resolve 同一 attempt：恢复的 `CLAIMED` 直接 dispatch
start operation，只有真正未 claim 的 identity 才能调用 `prepare`。`INVOCATION_STARTED` 后，success/failure
terminalization 从 sealed attempt/claim custody 执行，不依赖 current Research freshness。此后的 Resolve 即使
linked Research View 已 stale，也必须返回精确 durable terminal receipt；stale 只禁用 review/successor action，
绝不能删除或改写 terminal business fact。固定展示顺序为
`Current authority`、`Admission snapshot`、`Invocation admission`、`Invocation claim`、`Invocation state`。

Current authority readiness 是合取条件。Operator Authorization genesis 或 issuance receipt 可以作为
sealed historical evidence 展示，但只有对应 Product Edge binding、head 与 outbox projection 在同一个 admitted
cut 上全部 canonical resolve 后才可启用 action。当 OA row 存在而任一 Product Edge row 缺失、unavailable
或与锁协议不兼容时，`AuthorizationLineagePanel` 分开保留两个 Owner row，把 Product Edge row 标为
`Unavailable`，显示精确 stop predicate，并让 `ActionAdmissionGate` 不渲染 primary action。浏览器不提供
bootstrap、repair、权限提升或 force-admit 控件。

已提交的 Product Edge admission snapshot 仍不是 R&D terminal。第一次 R&D mutation 前，一个 versioned、
Product Edge-owned `DownstreamAdmissionResolver` 必须在 caller 的物理 PostgreSQL transaction 内执行。它先取得
既有 OA shared lock，再锁定并验证 Product Edge binding/head/manifest/admission/outbox，最后只返回 sealed
canonical admission bytes，不暴露任何 Owner table。R&D 只获得该 port 的 execute 权限，绝不能获得 OA access
或 Product Edge table authority。若此 seam 缺失、denied、stale、corrupt 或不能保持 lock cut，页面把 Product
Edge admission 显示为 committed、downstream custody 显示为 `Unavailable`；整体 S1 为
`SUBMITTED_OR_UNKNOWN`，S2 保持 disabled，唯一业务 action 是 same-identity Resolve。页面不能仅因缺少 R&D
receipt 就把 request 错标为 `REJECTED_NO_WRITE` 或提供 Create successor。

S2 error projection 跟随 attempt identity，而不是 operational job result。`artifact_product_edge_error` 对
unavailable、storage 或 unknown Product Edge authority（包括已有 custody record）统一返回
`SUBMITTED_OR_UNKNOWN`，且唯一 business action 是 `RESOLVE_SAME_ATTEMPT_IDENTITY`。绝不渲染
`REJECTED_NO_WRITE`、Create successor、新 claim 或 provider action。

业务 outcome projection 使用另一条固定优先级。sealed R&D terminal receipt 高于 Product Edge invocation
fence：`SUCCESS` 渲染 canonical Artifact/Build Receipt/Review projection；`FAILED_NO_ARTIFACT` 渲染
`NoArtifactReceiptPanel` 且没有 Artifact。只有不存在任何 R&D terminal 且 Product Edge fence 为
`INVOCATION_STARTED` 时，页面才能渲染 `OUTCOME_UNKNOWN` 与
`MANUALLY_RECONCILE_PROVIDER_INVOCATION`；不能 retry、mark success 或 dismiss。来自旧 custody generation
的已验证历史 terminal 渲染为 `LEGACY_TERMINAL_QUARANTINED`，只显示历史 receipt，不创建 current
Research View、provider action、successor action 或 TrialFamily repair action。Owner wire discriminant、
request/attempt identity、terminal receipt、custody generation、quarantine reason 与 original disposition 必须作为
一个 strict legacy‑only branch 穿过共享 consumer projector。精确接受集合是
`SUCCESS | FAILED_NO_ARTIFACT | REJECTED_NO_WRITE | OUTCOME_UNKNOWN`；sparse legacy rejection 可以按 Rust Owner
wire 省略 Intent identity/digest。所有 variant 都保持 read-only，family/provider/actions 必须 absent。该 branch
缺失或 malformed 时，固定 legacy slot 显示 `Unavailable` 并只允许 same‑attempt Resolve，绝不能静默折叠成
untyped generic unknown。

## Windmill 能力证据台账

Windmill 是当前借用的应用与 job 外壳。替代品只保留被 Trade 消费者证明必要，或被既有架构合同要求的能力。

| Windmill 能力                                       | 已观察使用或需要                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 当前设计假设                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 认证浏览器 session                                  | S1‑S3 使用认证本地 App；S1 V2 -> S2 验收复用了已登录的本地 `admin` 浏览器 session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `TARGET_DRAFT/KEEP`：单一本地操作者与显式 `authenticated/expired/unavailable` shell state；禁止 anonymous，也不做通用角色管理产品                                                                                                                                                                                                                                                                                                                  |
| Credential/session bootstrap                        | 活跃 V2 journey 拒绝 stale `.env` 登录材料，并通过既有浏览器 session 完成；没有创建、轮换或检查 API token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `TARGET_DRAFT/KEEP_MINIMAL`：只保留本地 sign‑in/re‑auth 边界；domain page 排除 password import、token management、workspace credential conversion 与 secret display                                                                                                                                                                                                                                                                                |
| Workspace                                           | 一个 `trade-rd` workspace 约束 App、script 与 token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `TARGET_DRAFT/COMPRESS`：一个 installation profile，不做 workspace 产品                                                                                                                                                                                                                                                                                                                                                                            |
| Full‑code Raw App 与 sandbox                        | 承载当前 React Workbench，且无 frontend SDK/Data Table scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `TARGET_DRAFT/REPLACE`：第一方 route 与 component                                                                                                                                                                                                                                                                                                                                                                                                  |
| Versioned script 与 App dependency                  | PR #326 使 repository App 与 narrow MCP profile 选择同一个 `research_goal_v2` Product Edge operation；`artifact_build_v1` 仍是 S2。App import 的 shared empty‑input `consumer_projection_v1` exact‑key projector 会验证按 resolution 区分的 Rust wire，包括显式 absent/present field 与四种 legacy terminal disposition。已有 `CLAIMED` custody 不再经过一次 freshness‑sensitive prepare 就可进入 start。Repository projection 现在包含 legacy `research_goal_v1`、current `research_goal_v2`、`artifact_build_v1`、non‑business projector 与一个 Raw App；H1 未在默认 Windmill 部署或重新验证这组内容。Windmill 仍单独记录 dependency‑build job | `TARGET_DRAFT/KEEP_SEMANTICS`：一个 versioned operation registry entry、content digest、类型化 BFF gateway 与显式 dependency state。Adapter 与 projector 共用一份按 resolution 分支的 parser 和直接 serialization fixture；schema drift 保持固定 unavailable geometry。Projection verification 编译进 typed library，不产生 catalog item、route、action 或用户 run record。Legacy V1 只作为 migration/quarantine input，绝不是未来可选择 operation |
| Server 与 worker queue                              | 客户端断开后继续有界 provider/build/replay 工作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `TARGET_DRAFT/KEEP`：最小 durable dispatcher 与 worker lease                                                                                                                                                                                                                                                                                                                                                                                       |
| Run list、Run Detail、progress、result、bounded log | 真实 App/webhook run 展示 path、tag、trigger、timing、worker、input、result、memory、script hash，并提供 `getJob`/`getJobLogs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `TARGET_DRAFT/CORE_OPERATIONAL`：精确 Runs 与 Run Detail 合同；绝不是业务终态                                                                                                                                                                                                                                                                                                                                                                      |
| Worker status 与 service log                        | 一个 live `rd-product-edge` worker 执行已准入 script；service log 暴露 worker/server host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `TARGET_DRAFT/KEEP`：worker lease/capability、Run Detail 中的 exact‑run readiness 与有界 service‑log read；禁止 REPL 与通用 administration                                                                                                                                                                                                                                                                                                         |
| Audit log                                           | Windmill 记录认证 create/update/execute/delete operation，但 CE 会隐藏 resource detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `TARGET_DRAFT/KEEP_MINIMAL`：第一方 operation audit，包含 principal、operation、target identity、time、outcome、correlation；不依赖 enterprise redaction                                                                                                                                                                                                                                                                                           |
| 每个 run 的 Metrics、Traces、Assets tab             | 已观察 replay run 渲染三个 tab，但全部为空；metric 只给超过 500 ms 的 job，HTTP trace disabled/unused，且没有 run asset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `NOT_OBSERVED/CURRENTLY_EXCLUDE_AS_BACKENDS`；保留确定性 empty state，有 Trade consumer 产生数据后再加 backend                                                                                                                                                                                                                                                                                                                                     |
| Same‑identity resolve                               | S1 V2 已从 direct Owner fact 恢复 response loss 与 restart/cache‑loss；默认页面使用精确 request 和 build‑attempt resolve control，返回原 receipts、Intent、TrialFamily/frontier、Artifact review 与 binding。S2/S3 要求同一模式                                                                                                                                                                                                                                                                                                                                                                                                                  | `TARGET_DRAFT/CORE`：强制 request/attempt identity、direct Owner resolution、不可变 returned bytes/frontier、单独关联的 replacement operational run，并禁止 naked retry                                                                                                                                                                                                                                                                            |
| 可丢弃 completed‑job cache                          | S3 证明删除 job 后可从 Owner 事实恢复                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `TARGET_DRAFT/KEEP_DISPOSABLE`：TTL/delete/readback；无业务 custody                                                                                                                                                                                                                                                                                                                                                                                |
| Native MCP                                          | S1‑S2 使用窄 profile；S3 A/B parity 仍待验证                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `TARGET_DRAFT/KEEP_AS_CHANNEL`：共用 UI capability manifest                                                                                                                                                                                                                                                                                                                                                                                        |
| Scoped token lifecycle                              | S1‑S2 使用 scoped credential；S3 需要一次短期 replay‑only issue/use/revoke cycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `TARGET_DRAFT/KEEP_NARROW_ISSUANCE`：精确 operation allowlist、有界 read‑only job access、expiry、revocation、一次性 secret display、外部 custody                                                                                                                                                                                                                                                                                                  |

| Schedule | Scanner 现在把 due‑slot attempt 封闭为 unavailable，直到真实 source‑Owner typed resolve 存在；尚无 scheduler 或 Windmill schedule consumer | `TARGET_DRAFT/DEFERRED_UNTIL_CONSUMED` |
| Workspace Asset / file / object storage | Workspace 页面显示没有 Data Table、Ducklake、object storage 或 asset；数据库计数为零 | `NOT_OBSERVED/CURRENTLY_EXCLUDE`；Owner Artifact locator 不是 Windmill file |
| Workspace Resource 与 Variable | `trade-rd` 没有 Resource 或 Variable；worker credential 来自 Compose environment allowlist。数据库唯一 Resource 属于 `admins` App theme | `NOT_OBSERVED/CURRENTLY_EXCLUDE`；使用 runtime‑injected opaque secret reference，不做通用 manager |
| App/Flow builder、任意 Flow graph、preview tool | 没有已准入 Trade 消费者 | `NOT_OBSERVED/CURRENTLY_EXCLUDE` |
| Data Table 与 Windmill business storage | App 合同明确禁止 | `NOT_ADMITTED/DROP` |
| MCP workspace management | 当前 profile 明确排除 | `NOT_ADMITTED/DROP` |
| 通用 secret‑manager UI | secret 保存在 repository 与 App state 之外 | `NOT_OBSERVED/CURRENTLY_EXCLUDE`；只接收 opaque reference |
| 通用 Python/Deno/Bun/Bash runtime catalog | Trade 使用 exact repository operation 与 Owner service | `NOT_OBSERVED/CURRENTLY_EXCLUDE` |
| Multi‑tenancy、billing、marketplace、enterprise RBAC | 单用户没有消费者 | `TARGET_DRAFT/EXCLUDE_BY_PRODUCT_SCOPE` |

`OBSERVED_CANDIDATE_NOT_CURRENT`：2026-08-23 的 candidate lock 核对新增了一条更窄的 Windmill 边界。Immutable
observation packet 是 Hub thread `codex://threads/01a014ef-d305-7b40-8d6b-f5c6d26fca56`、turn
`01a02b42-82f7-71d3-b086-339a3b0bba28`，以及 tool-output receipt
`ctco_01a02b4d-9276-7793-bb29-691adbff2784`（queue/exit）、
`ctco_01a02b4d-d106-7b13-b965-634b8428d03c`（cancel）和
`ctco_01a02b4e-2c82-7e60-9d02-8162cb7f91ec`（offline rehash）。该 packet 是观察证据，不是 repository
capability 或 Dashboard implementation receipt。对三个 Product Edge script 与 Raw App
执行 `wmill sync push --dry-run --auto-metadata` 时没有发布，但仍创建了 dependency job
`01a02b4b-a5bc-c91c-d964-03f47a3d1564`。由于没有匹配 executor 领取，它一直位于队列第 1 位；CLI 最终以
`130` 结束，随后该精确 queued job 以 HTTP `200` 被取消。冻结候选改为离线执行
`wmill generate-metadata` rehash，范围精确为三个 script 加一个 App。因此替代品只在 build pipeline
保留确定性的 dependency/lock compilation，并把 remote dependency work 作为 operational run 展示；不复制
Windmill metadata editor、script catalog 或由 Dashboard 发起的 publish flow。

这次观察也收窄了 cancellation 与 readiness。只有 `kind=dependency`、`state=queued`、domain effect set
为空，且 Dispatcher 证明不存在 worker claim 时，Run Detail 才显示 `Cancel queued dependency`。它返回
immutable operational cancellation receipt，绝不改变 Owner truth。没有 batch cancel；provider、build、
replay、admission、claim 或其他 effect‑capable run 都没有 Cancel。Worker status 分成 lease liveness 与针对
selected job 的 kind/tag/runtime/required-isolation compatibility；有 live heartbeat 但没有兼容 executor 时，
该 job 必须显示 `online / incompatible`，绝不能显示 Ready。

### Windmill 原生表面与后台替代映射

以下 2026-08-20 snapshot 组合认证 Windmill UI、固定 `1.791.0` Compose deployment、App/script source 与只读
Windmill database count。计数只是观察证据，不是稳定产品限制。未来服务实现最后两列的合同，不实现 Windmill
table 或通用 low-code model。

布局和排除决策也对照了该 image 内嵌的 Windmill 官方精确源码：版本 `1.791.0`、revision
`ce71756c893c2ef1ea399ad50f0617015999ddd0`。这些只是实现证据锚点，不是 Trade UI 依赖：

| Windmill 实现锚点                                                                                         | Dashboard 保留的布局                                                                                                              | 明确排除的 Windmill 行为                                                                                       |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `RunsPage.svelte` → `RunsTable.svelte` 加 `JobRunsPreview.svelte`；完整 route `run/[...run]/+page.svelte` | URL-backed filter、auto‑refresh、按日期分组 table、selection drawer、Result 位于固定 `Logs / Metrics / Traces / Assets` tabs 之上 | batch rerun/cancel/resolve、`Run again`、Share、Edit、Code、schedule edit、restart 与 public‑link control      |
| `workers/+page.svelte`                                                                                    | group selection、worker table、host/IP grouping、occupancy/status、search 与 last‑run navigation                                  | worker config import/edit、tag administration、HTTP-agent creation、REPL、autoscaling 与 cache/restart control |
| `service_logs/+page.svelte` → `ServiceLogsInner.svelte`                                                   | timeframe/error/search filter、service/group/hostname selection、responsive split pane、context drawer 与 auto‑refresh            | superadmin management、unbounded file access，以及从 log 推断 Owner health                                     |
| `audit_logs/+page.svelte` 加 `AuditLogsFilters`、`AuditLogsTable`、`AuditLogsTimeline`、`AuditLogDetails` | filter、append‑only table、selected‑event timeline/detail 与 mobile drawer                                                        | mutation、replay、dismiss，以及从 CE 已脱敏 resource field 投影业务事实                                        |

在该精确 Workers source revision 中，worker 与 group read 每五秒 refresh；少于六个 group 时使用 tab，六个及以上
改用 selector。Search 对 worker name、worker-instance identity 或 IP 进行 case-insensitive 即时匹配。Table 插入
host/IP group row；始终显示 worker start、jobs ran、memory、limit、version、status；并按条件追加 tag、带四个
occupancy window 的 last job，以及 REPL。No workers 与 no search matches 分开，初始 loading 是四个 generic skeleton row。这些事实只证明应保留 grouping、
search、operational field 与显式 empty state，**不能**证明原生 selected-worker detail：该源码不存在 worker-row
selection 或 worker-detail drawer。因此未来的 `WorkerLeaseCard` 是 Trade TARGET 在 replacement read model 上的
组合。它也不继承 Windmill 的 conditional admin-shaped column、15/60 秒 UI liveness threshold、group-config
drawer 或 REPL authority；下文固定的 Trade column 与独立于 Owner 的 lease policy 仍是设计权威。

在精确 Audit source revision 中，username、page、before/after、page size、operation、resource、scope、action
kind 都是 URL-backed filter。Route 在上方 two-sixths timeline 下始终声明 70/30 table/detail split，pane 最小
share 为 50/15；同时另行声明一个 `md:hidden` table，其 selection 把同一个 `AuditLogDetails` 打开到 drawer。
仅凭该 source 不能证明 split pane 在 mobile runtime 被抑制。Split-pane initial branch 使用八个 skeleton row；
mobile `AuditLogsTable` 则使用自己的 centered loading spinner。CE 或 Pro license 显式显示 redacted-logs
warning。这些事实证明应保留 filter、timeline、selection、detail 与
responsive-drawer 布局。它们不把原生 default page size、missing-job-span lookup 或 redacted parameter byte
提升为 Trade authority：下文未来的 `OperationAuditStore` 与 Product Edge receipt panel 仍是 TARGET contract；
source layout 或额外 read 都不能制造 Owner business truth 或 effect action。

2026-08-22 的只读 Docker-label audit 发现一个 live Compose project：server 来自 worktree `5781`，Backtest
Owner 来自 `dc01`，PostgreSQL、worker、R&D Owner 与 build sandbox 来自
`trial-family-custody-replacement`。所有 container 都可以 healthy，但不存在 canonical artifact 把这些 source、
App/script hash 与 Owner compatibility 交叉绑定。Dashboard 因此把该 deployment provenance 视为
`unavailable`，而不是 runtime success。TARGET 使用一个 content-addressed compatibility envelope；它可以有意
绑定多个 service artifact，但没有该 envelope 的 mixed runtime 不能变为 available。

`TARGET_DRAFT` 本地入口拓扑让所有 Owner、Windmill 与 PostgreSQL container 只连接同一个 sealed internal
network，不发布端口，也不具备外部路由。唯一入口是一个同时连接该网络与独立 bridge 的 TCP sidecar；该
bridge 关闭 IP masquerade，sidecar 不含凭据、使用只读文件系统、drop 全部 Linux capability，并以固定命令
只把宿主 `127.0.0.1:<port>` 转发到内部 Windmill。验收必须动态证明宿主可通过该 loopback 端口访问
Windmill，同时每个业务 container 仍无外部路由；出现额外 published address、forwarding target、credential、
capability 或业务 container bridge attachment 时一律 fail close。隔离拓扑实验已经通过这条边界，但它仍
只是设计证据：不证明 default deployment、Dashboard implementation、provider/network execution、production
write 或 trading authority。

| 原生表面 / 当前 backend                    | 精确已观察状态                                                                                                                                            | Dashboard route 与固定 UI                                                                                                                                                                                                                | 替代 service/store 与 disposition                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home / App 与 script catalog               | 一个 Raw App `f/trade/rd_workbench`；当前 TrialFamily sync 部署 S1 V2 research 与 S2 Artifact operation，但已归档 remote S3 replay entry                  | Domain route 拥有四阶段 journey；Backtest route 保留但渲染 `DEPLOYMENT_UNAVAILABLE`；没有通用 Home catalog                                                                                                                               | Versioned `OperationRegistry` 加 `available/archived/unavailable` deployment state 与内建 frontend route；archive 禁止派发但不删除 Owner history。`KEEP_SEMANTICS`，排除任意 catalog                                                                                                                        |
| Runs / `v2_job*`                           | UI 显示 53 个用户可见 job；数据库有 88 行，其中 34 个是 App dependency job。真实 path 使用 App/webhook trigger 与 `rd-product-edge` tag                   | Operations / Runs：status segment；schedule/future toggle 只有准入后才显示；search、duration/concurrency filter、auto‑refresh、path/trigger/tag column、date group、pagination                                                           | `RunStore` + `DispatcherReadModel`；带 TTL 的 durable operational metadata、显式 dependency kind，只按 identity join Owner outcome                                                                                                                                                                          |
| Run Detail / completed job 加 result API   | 成功 replay 显示 received/started time、duration、worker、run ID、5 MB peak、script hash/language、App trigger、exact input、JSON result 与 Owner receipt | `/operations/runs/:runId`；breadcrumb 为 Back to Runs，header action 依次是 Copy locator、Refresh、条件式 Cancel queued dependency、Resolve same identity、Download bounded result/log。排除 `Run again`、Share、Edit 与任意 script link | `RunDetailProjection`；schema allowlist 限定的 immutable input 与 bounded result projection、exact‑run worker compatibility、固定 operational cancellation receipt readback、显式 withheld/redacted disclosure、timing/resource metadata 与 Owner receipt reference；无 raw payload fallback 或业务 custody |
| Run Logs / `job_logs` 加 worker log volume | 86 行 log；精确 run 提供 download endpoint、auto‑scroll、job/tag/worker/host/isolation header 与有界 text                                                 | Run Detail `Logs` tab：search、level/source chip、auto‑scroll switch、download bounded log、line viewport、truncation/retention notice                                                                                                   | `BoundedRunLogStore`；append‑only chunk、byte/age limit、redaction、correlation、TTL；MCP read scope 只能暴露 exact admitted run                                                                                                                                                                            |
| Run Metrics                                | 已观察 74 ms run 明示无 metric，因为 500 ms 后才采集                                                                                                      | Run Detail `Metrics` tab 固定几何；显示 `NotCollected`、`Unavailable` 或 time‑series，绝不伪造零值                                                                                                                                       | 延后 `RunMetricProjection`；出现 non‑empty consumer evidence 前为 `CURRENTLY_EXCLUDE_BACKEND`                                                                                                                                                                                                               |
| Run Traces                                 | 已观察 run 明示没有 HTTP request capture，或 tracing 未启用                                                                                               | Run Detail `Traces` tab：显式 not‑captured reason，不显示空成功图                                                                                                                                                                        | 延后 `RunTraceProjection`；`CURRENTLY_EXCLUDE_BACKEND`                                                                                                                                                                                                                                                      |
| Run Assets                                 | 已观察 run 显示 `No assets found`；workspace asset count 为零                                                                                             | Run Detail `Assets` tab：只显示显式 empty state；无全局 Assets route                                                                                                                                                                     | 当前无 store。未来 entry 只能是可丢弃 operational attachment，指向但不替代 Owner Artifact custody                                                                                                                                                                                                           |
| Workers / `worker_ping`                    | 一个 live `rd-product-edge` worker，version `1.791.0`，可见 job count、last‑job link、memory、status、tag；其他 group 为零                                | Operations / Workers：group chip、search、worker table、selected‑worker panel、last‑run link。只读 action 为 Refresh 与 Open last run                                                                                                    | `WorkerLeaseStore` + heartbeat；保留 identity/group/tag/version/start/last‑run/occupancy/memory、lease liveness 与 registered capability。Exact‑run readiness 只存在于 Run Detail。分别准入前排除 create config、cache clean、restart、REPL、autoscaling UI                                                 |
| Service Logs / server 与 worker log        | Auto‑refresh 页面列出 worker group 与 server host、time range、error‑only filter、service/host selector                                                   | Operations / Service Logs：time range、service、instance、severity、search、auto‑refresh、有界 log viewport                                                                                                                              | `ServiceLogGateway`；只读、redacted、retention‑bounded。它是 operational evidence，不是 Owner health 或 telemetry backend                                                                                                                                                                                   |
| Audit Logs / partitioned audit table       | 已存在认证 execute/update/create/delete record；CE 暴露 ID、time、principal、operation，隐藏 resource detail                                              | Operations / Audit：time/principal/operation/outcome filter、audit table、selected correlation panel；无修改按钮                                                                                                                         | `OperationAuditStore`；append‑only Dashboard/Product Edge control‑plane event，含 exact target/correlation/outcome。Owner business event 仍由 Owner/Event Rail custody                                                                                                                                      |
| Workspace/folder/auth                      | `trade` folder 包含三个 script 与一个 App，owner 为 `u/admin`；workspace 与 scoped token 限定 access                                                      | 只保留 installation profile 与 Access settings；无 workspace/folder administration route                                                                                                                                                 | `LocalSession` + `CapabilityManifest` + narrow token issuer；单 installation、单 operator profile、exact operation scope                                                                                                                                                                                    |
| Variables、Resources、Assets、Schedules    | `trade-rd` count 为 0/0/0/0。Compose 向 worker 注入 allowlisted environment；禁止 Data Table 与 frontend SDK access                                       | 无产品 tab。Settings 接收 opaque runtime reference；Scanner 显示 schedule unavailable/deferred                                                                                                                                           | 排除 Windmill 通用 store。只有出现真实 Owner consumer 与 custody contract 后才增加类型化 service                                                                                                                                                                                                            |

原生 `bun` runtime 只是三个 pinned script 的实现细节，不是用户可选 runtime catalog。PostgreSQL 保存
Windmill operational state；独立 R&D/Backtest Owner database/API 保存业务事实。即使所有服务随同一 image set
交付，替代方案也保持这条 ownership 分界。

### Operations API 与后台状态合同

这是 `TARGET_DRAFT` replacement contract，不证明这些 service 已经存在。Browser 与 MCP read 使用同一组
typed handler 与 capability check。Page cursor 对一个 filter cut opaque 且稳定；每个 response 都包含
`observed_at`、`projection_version`、`availability` 与 retention/expiry disclosure。Caller 能读取 operational
run，也绝不意味着 route 可以返回 Owner payload。

| UI read 或 action                 | 固定 Dashboard API                                                                                   | Backend owner 与精确规则                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs list、filter、pagination     | `GET /api/operations/runs` -> `RunPage`                                                              | `RunStore` 读取 immutable submission metadata 与 dispatcher‑owned operational state。Filter field 固定为 status/kind/path/trigger/principal/tag/duration/time cut；cursor 绑定该 filter cut。Owner outcome 是单独 resolve 的 optional envelope，绝不从 exit code 推导                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Run detail 与 bounded result      | `GET /api/operations/runs/{run_id}` -> `RunDetailEnvelope`                                           | `RunDetailProjection` 解析精确 operation/version manifest，只返回已注册且允许展示的 input/result 字段、timing/worker/resource metadata、immutable operational cancellation receipt readback、retention 与 Owner receipt locator。它在同一 observation cut 把该 path‑bound `run_id` 的 dispatcher requirement 与 immutable worker registration join，并返回 `RunWorkerCompatibilityMatrix`；missing、stale 或 mismatch input 均为 `unavailable`。Cancellation readback 为 `none / pending / receipt / unavailable`，A 消失后仍保持只读，且绝不改变 Owner truth。Secret、protected 与 unknown 字段被省略，只显示 typed withheld count/reason；viewport、Copy JSON 与 download 复用完全相同的 redacted bounded projection。Unknown operation version 或 schema mismatch 必须 `unavailable`，绝不 fallback 到 raw JSON。存在 Owner locator 时缺少 disposable data 表示 `operational_data_expired`，不是业务 absence |
| Same‑identity Owner resolution    | `POST /api/operations/runs/{run_id}/resolve-owner-outcome` -> `OwnerOutcomeEnvelope`                 | Product Edge 通过具名 Owner typed port 解析 immutable request/attempt identity；既不 dispatch job，也不 retry effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Queued dependency cancellation    | `POST /api/operations/runs/{run_id}/cancel-dependency` -> `OperationalCancellationReceipt`           | `OperationalActionEnvelope` 绑定 authenticated principal、`dependency.cancel.queued` capability、精确 run、current transition version、`kind=dependency`、`state=queued`、空 domain‑effect digest、no‑claim cut 与短 expiry。Dispatcher 在自己的 transition lock 下重读全部字段，compare‑and‑set 只把该精确 operational run 改为 `cancelled`；stale、revoked、已 claim、terminal、unknown、identity mismatch 或 effect‑capable input 一律 fail close。Receipt 记录 run、prior state/version、principal、authorization cut、time 与 transition；不能取消 domain request、provider/build/replay effect 或 Owner operation，且不存在 batch endpoint                                                                                                                                                                                                                                                                |
| Disposable completed‑run deletion | `DELETE /api/operations/runs/{run_id}/cache` -> `OperationalDeletionReceipt`                         | `RunStore` 只在 capability check 与 confirmation 后接受 terminal operational row；删除 bounded result/log/cache byte，保留 run tombstone 与 Owner locator，且不能触碰 Owner store                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Run log tail 或 download          | `GET /api/operations/runs/{run_id}/logs` 与 `/logs/download` -> `RunLogPage` 或 bounded stream       | `BoundedRunLogStore` 按 opaque cursor 读取 append‑only chunk。Viewport、download 与 MCP 使用完全一致的 search/severity/source filter、redaction、truncation、byte limit 与 retention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Metrics、traces、run assets       | `GET /api/operations/runs/{run_id}/{metrics\|traces\|assets}` -> discriminated tab envelope          | Producer 准入前，handler 返回带 reason 的 `not_collected`、`not_captured`、`empty` 或 `unavailable`；绝不伪造 zero、span、file 或 success，run asset 也不能解析到 global file browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Workers 与 selected lease         | `GET /api/operations/workers` 与 `/workers/{worker_id}` -> `WorkerPage` 或 `WorkerLeaseEnvelope`     | 只有 worker registration/heartbeat/claim/release 可以写 `WorkerLeaseStore`。UI 读取 identity/group/tag/version/start/limit/occupancy/last run/last observed，加已注册的 kind/tag/runtime/isolation capability set；lease expiry 产生 `unavailable`；这些只绑定 worker 的 route 不会为未绑定 run 推导 readiness，也绝不能由 UI 写 `dead` state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Service‑log viewport 或 download  | `GET /api/operations/service-logs` 与 `/service-logs/download` -> `ServiceLogPage` 或 bounded stream | `ServiceLogGateway` 要求 exact service/instance cut，并对两种输出应用相同 time/severity/search filter、redaction、cursor、retention 与 byte limit；不暴露 delete、clear、restart 或 health‑promotion endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Audit list 与 correlation detail  | `GET /api/operations/audit` 与 `/audit/{audit_id}` -> `AuditPage` 或 `AuditEventEnvelope`            | `OperationAuditStore` append‑only，由 authenticated Product Edge/Dashboard control‑plane middleware 写入，不由此 read route 写入。Unknown/redacted target 保持显式；没有 edit、delete、dismiss 或 replay endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

`RunOperationalState` 精确为 `queued | running | succeeded | failed | cancelled | unknown`；只有 Dispatcher 与
worker protocol event 能通过对最后 transition 的 compare-and-set 推进它。`OwnerOutcomeState` 是独立的
`available | rejected | unknown | unavailable | not_applicable` envelope，绝不参与 operational transition。同一
run identity 的 late terminal worker event 可以替换 operational `unknown`，但只有 Owner reread 能替换 Owner
`unknown`。Worker liveness 只从 stored lease deadline 与 last heartbeat 计算；只有 path‑bound
`RunDetailProjection` 才能在同一 observation cut 对该精确 run 的 kind、tag、runtime、required isolation 与
worker registration 做 canonical compatibility match。Client time、missing row、process/container health 或
service-log message 既不能提升 liveness，也不能伪造 compatibility。

替代品不是缩小版低代码平台，而是 Trade 专用 Dashboard、类型化 Product Edge gateway、窄 job dispatcher、
worker protocol、可丢弃 operational store，以及可选 exact-tool MCP channel。Native Owner 及其 store 仍是
独立服务。

## 产品外壳与布局

视觉方向来自中途停止的本地 `vibe-trading` 产品，而不是 Windmill：暖中性 canvas、紧凑 icon rail、胶囊
导航、白色内容 card、灰色 framed panel、小字号高信息密度排版与响应式 Bento 组合。Glass 只能用于导航
与瞬时 overlay，不能用于数据 card 或业务状态 panel。

### 参考实现锚点

视觉证据切面使用本地 checkout `/Users/vx/WebstormProjects/vibe-trading` 的 commit
`4a6d66fb77fc144c2a013417c703db2caf401641`、tree `984c7d684dba72a6af78dc3e6cf50191bc3622ea`。观察时，
下列 reference file 相对该 revision 均为 clean；中途停止 checkout 的其他 dirty file 不是设计证据。它是
source reference，不是 package dependency 或业务架构权威。未来 agent 修改 token 或 shell geometry 前必须
检查以下锚点：

| `apps/web/src` 下的参考路径                                                      | 继承                                                                                                                                                           | 明确不继承                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app/globals.css`                                                                | Mine 暖中性 raw palette、Inter/JetBrains Mono、market direction 分离，以及 `glass-heavy`、`glass-light`、tooltip glass 的允许区域与数值                        | Factor/status token 名称作为 Trade 业务语义；任意 literal color                                              |
| `components/layout/left-icon-sidebar.tsx`                                        | 52 px rail content、40 px 圆形 target、18 px icon、1 px item gap、居中/可滚动 heavy‑glass capsule、深色 active item                                            | 参考项目的 module identity 或 phase label                                                                    |
| `features/blueprint/components/doc-mode-shell.tsx`                               | Full‑viewport flex shell、12 px sidebar padding、16 px content gap 与右/下 gutter、有界 inner overflow                                                         | Blueprint mode、document toggle 或 mock content 作为产品功能                                                 |
| `components/shared/bento-grid.tsx`                                               | Container‑observed `wide/narrow/collapse` composition、`rowHeight=180`、`gap=16`、560 px collapse 与 700 px narrow 证据、1/2/3/4/8 column span 和 1-4 row span | 把它的 1/2/3/4/8 API 当成 routed‑page grid，或把 560/700 container threshold 当作 global viewport breakpoint |
| `components/layout/top-nav-bar.tsx`                                              | 56 px top bar、可替换 left context slot、light‑glass capsule tab、notification/action zone                                                                     | Market ticker data 作为全局 header 的硬要求；Dashboard 使用受证据约束的 status tape                          |
| `components/ui/card.tsx`                                                         | 白色 12 px card、Mine border、克制的双层 shadow、紧凑 structured header、可选 canonical‑detail expansion                                                       | 已存在的 `frosted` card variant；Dashboard 业务/data card 保持 opaque                                        |
| `components/ui/table.tsx`、`lib/data-table/components/data-table.tsx`            | Full‑width bounded scroll container、sticky 40 px dark header、8 px cell padding、fixed‑layout percentage column、ellipsis、row hover 与 96 px empty row       | 参考项目的业务 column、selected‑row/bulk behavior 或 client‑side data authority                              |
| `lib/data-table/components/data-table-pagination.tsx`、`data-table-skeleton.tsx` | Compact responsive pager geometry、32 px control、显式 page‑size selector、First/Previous/Next/Last 顺序，以及同形 filter/header/body/footer skeleton          | 参考项目的 selected‑row count、page‑size default 或 unbounded in‑memory pagination                           |
| `lib/chart-tokens.ts`                                                            | Canvas 或其他 JavaScript renderer 不能直接消费 `var(...)` 时解析 CSS custom property                                                                           | Component‑local chart palette 或 literal status color                                                        |
| `features/blueprint/data/modules.ts`                                             | 只继承视觉密度与 route‑backed capsule‑navigation pattern                                                                                                       | 中途停止项目的 module 顺序、label、phase badge、mock metric、workflow claim 或 trading capability            |

本章的 Trade navigation、状态词汇、domain component 与 capability admission 覆盖参考项目的信息架构。
Screenshot 匹配不能把 mock value 或参考 route 提升为 `CURRENT`。

```text
+----------------------------------------------------------------------------------+
| user | status tape / context                         tabs | search | notifications |
|------|---------------------------------------------------------------------------|
|      | page header / authority / freshness                                      |
| side |                                                                           |
| rail | responsive Bento: cards, panels, tables, charts, timelines               |
|      |                                                                           |
|      | optional right drawer: receipt, identity, evidence, action detail         |
+----------------------------------------------------------------------------------+
```

Desktop shell 合同：

- full-screen viewport，不能产生第二个 page scrollbar；
- 左列 76 px：12 px 外侧 padding、52 px rail content、12 px 内侧间隔；
- top bar 56 px；右侧/底部 gutter 16 px；Bento gap 16 px；
- icon rail 可垂直滚动但隐藏 scrollbar；
- card、table、log 使用有界滚动；
- 可选 detail drawer 宽 400-520 px，且不能替代 canonical route。

## 导航合同

### Side menu

Side menu 按工作流排序。icon、accessible label、route 与位置稳定。Feature flag 可以禁用 unavailable item，
但不能重新排序。

| 顺序 | 模块          | Route            | 用途                                                                       |
| ---: | ------------- | ---------------- | -------------------------------------------------------------------------- |
|   01 | Overview      | `/dashboard`     | Global Status View、attention queue、近期 Owner outcome                    |
|   02 | R&D           | `/rd`            | Source、research request、hypothesis、Artifact、decision                   |
|   03 | Backtest      | `/backtest`      | Exploratory run、compare、允许的 diagnostic                                |
|   04 | Qualification | `/qualification` | Intake、opaque protected‑feedback frontier 与有界 public outcome           |
|   05 | Scanner       | `/scanner`       | Schedule、attempt、receipt、proposal                                       |
|   06 | Strategy      | `/strategy`      | Registry、lifecycle authorization、allocation                              |
|   07 | Runtime       | `/runtime`       | Applied generation、instance、checkpoint、incident                         |
|   08 | Portfolio     | `/portfolio`     | Performance、exposure、capacity、attribution                               |
|   09 | Risk          | `/risk`          | Decision、reservation、claim、adapter admission、aggregate frontier、fence |
|   10 | Execution     | `/execution`     | Attempt、order、fill、reconciliation、Recovery readback                    |
|   11 | Data          | `/data`          | Source、PIT catalog、quality、correction、freshness                        |
|   12 | Operations    | `/operations`    | Run、worker、run/service log、audit、Event Rail、telemetry、alert          |
|   13 | Settings      | `/settings`      | Data‑source、Agent‑provider、notification、access 配置                     |

Rail 顶部放 user capsule 与本地 installation menu。模块 capsule 在可容纳时垂直居中，否则滚动。Active
item 使用深色圆形填充与白色 icon；hover、focus、disabled 与 attention 状态必须在无颜色时仍可区分。

### Top menu

Top bar 按顺序分成四区：

1. **Status tape** - active mode/scope、Market Data freshness、R&D queue、Scanner schedule、Runtime readiness、
   Risk fence 与 last reconciliation。Unavailable 不能隐藏。
2. **Module tabs** - route-backed 圆角 capsule，与 side rail 共用 active treatment。
3. **Global search/command** - 搜索 identity、receipt、Artifact、run、strategy、order 与 docs。Command 只能
   打开 route 或准备已准入类型化请求。
4. **Notifications** - unread count 与 alert drawer。Delivery 不是 Owner outcome 或 acknowledgement。

| 模块          | Tab 顺序                                                          |
| ------------- | ----------------------------------------------------------------- |
| Overview      | Status, Attention, Recent, Evidence                               |
| R&D           | Intake, Research, Hypotheses, Artifacts, Decisions                |
| Backtest      | Exploratory, Compare, Diagnostics                                 |
| Qualification | Intake, Outcomes, Eligibility                                     |
| Scanner       | Schedules, Runs, Proposals                                        |
| Strategy      | Registry, Lifecycle, Allocations                                  |
| Runtime       | Instances, Generations, Checkpoints, Incidents                    |
| Portfolio     | Performance, Exposure, Capacity, Attribution                      |
| Risk          | Decisions, Reservations, Claims & Admission, Fences               |
| Execution     | Attempts, Orders, Fills, Reconciliation, Recovery                 |
| Data          | Sources, PIT Catalog, Quality, Freshness                          |
| Operations    | Runs, Workers, Service Logs, Audit, Event Rail, Telemetry, Alerts |
| Settings      | Data Sources, Agents, Notifications, Access                       |

窄屏中 tape 收缩为 status button，tab 横向滚动，rail 变 drawer。顺序、route identity 与 authority label 不变。

## 页面与数据规则

每个 routed page 依次包含：带 scope/Owner/source cut/freshness 的 header；可推导 summary strip；主要 Bento
grid；可选 table/chart/timeline/comparison；仅在准入时出现的 exact next-action bar；以及 identity、receipt、
evidence、recovery detail drawer。

Overview 是只读 Global Status View，优先展示 incident 与 unknown effect、待处理 decision、stale/unavailable
input、active research、Scanner/Runtime state、Risk fence 与近期 Owner outcome。它不能把 unavailable 或
protected input 压成一个 opaque health score。每个 status item 都携带 source frontier、completeness、lag、
freshness 与 rebuild state。Freshness 按精确 source Owner/cut 分别计算；一个 source 的新数据绝不能续鲜另一个。
Sequence 与 frontier namespace 不能跨 Owner 合并。Empty telemetry 是 unavailable，不是 healthy。Raw、stale、
replayed 或 self-asserted telemetry 即使 payload 非空或过去曾被接受，也不能产生 `Available`。Positive
availability 必须来自 Owner-produced projection，并绑定 source identity、source cut/frontier、observation 与
validity time、canonical payload fingerprint，以及当前 loss/rebuild state。Telemetry loss 后，缺失或 non-current
evidence 只能渲染 `unavailable` 或 `stale`，绝不能回退到最后一次 positive state。该规则在被拒绝的 F1 path
完成修正并通过真实 consumer 前保持 `OBSERVED_CANDIDATE_NOT_CURRENT`。每个 protected
negative terminal 无论 opaque internal reference 如何，都必须产生相同 public bytes。Freshness、valid‑through
与 expiry disposition 只能来自 Owner‑validated Time Evidence；任意非空 label、client clock 或 UI‑derived
timestamp 都不能驱动业务状态。Event identity、digest 与 checkpoint equality 必须绑定完整 canonical
envelope，包括 source Owner/cut、observed/valid‑through time、payload reference 与 telemetry fields。相同
identity/frontier 下 fingerprint 改变必须 conflict 或 quarantine；rebuild 绝不能静默改写 freshness 或 Owner
fact。

R&D 保留 Windmill 中已真实执行的旅程：

Source and falsifiable goal -> R&D request receipt -> Frozen Intent -> bounded Agent/build -> immutable Artifact
and Build Receipt -> Artifact Review -> Exploratory Replay Request -> Backtest Result -> R&D handoff -> exact next
action。第一方 route 与可复用 detail panel 替代单一超长 Raw App；stable identity 保留 deep link 与
same-identity recovery。

S1 V2 是 staged Owner journey，不是一次 all-or-nothing request。Fresh authority review 拒绝 candidate
`c72f44edb06f927afe6b67e5890f4610f4edc727` 的阶段恢复：第一笔 transaction 已提交 Independence Basis
Receipt、basis head 与 Owner outbox，但 Qualification 和 terminal Research receipt 仍缺失。Dashboard 把该
partial geometry 固定为 `SEALED_BASIS_PENDING_QUALIFICATION`：绑定准确 request、original admission、basis
receipt/identity、basis head/outbox、commit cut、缺失的 next Owner receipt 与 next action
`RESOLVE_SAME_REQUEST_IDENTITY`，且不渲染 Submit 或 successor control。创建 basis stage 仍要求 current
authority；一旦提交，同一 request 只能跨后续 cutover、revocation 或 expiry 从 sealed historical custody
Resolve 或完成，绝不能创建第二份 basis/head/outbox；changed request 或 admission identity 必须 conflict。
独立 consumer review 对另一组 H1 claim/start/terminal 修复未发现 static consumer defect（31/31），但 dynamic
PostgreSQL、Windmill、provider 与 browser acceptance 仍 unavailable；该 candidate 的任何部分都不是 current
product capability。

Fresh v5 review 对 `e5893fd5503c65be2afaae0da4a8b234b211c80f` 的结论证明该 geometry 仍只是 target，
不是可达的 Workbench recovery。Public empty-body `RESOLVE` 必须消费完整 sealed request meaning，并推进 submit
内部使用的同一 Historical completion，不能停在 terminal-receipt lookup miss。若 Qualification 在 response loss
前已提交且 projection 随后 expiry，只有 Qualification Owner 可以为 sealed basis 发布 canonically linked
renewal/successor（或等价 recovery fact）。完整 S1 terminal receipt 与 TrialFamily 一旦通过验证，后续 read-time
expiry 只能改变 currentness 与 action admission，必须保留 historical fact，绝不能重新折叠成
`SUBMITTED_OR_UNKNOWN`。

Protected Qualification detail 保持 opaque。Dashboard 只能显示 Qualification 允许的 public terminal、
type-opaque non-dereferenceable reference、expiry/revocation 与 source-frontier freshness；绝不显示 protected
phase、latency、internal reason、diagnostic category 或派生 research funnel。Public outcome 必须从
Owner-produced projection 解析，并绑定 intake receipt、holdout reservation、完整 plan-cell/assessment frontier
与稳定 attempt identity。Client 不能从相等 request/result DTO 构造它，不能通过重命名重置 attempt，不能在
没有冻结依据时显示 N/A，也不能复活 revoked 或 expired Eligibility fact。Intake identity 必须绑定 validation
前的完整 replay meaning，包括非法值；validation failure 不能把不同 meaning 归一为同一个 empty sentinel。首次
非法提交渲染 immutable `NOT_ADMITTED` receipt；同一 request/handoff 的精确语义 replay 可以解析该 receipt，
但 invalid A→invalid B、invalid→valid、valid→invalid 或同 identity 下任意 changed meaning 都必须渲染
`RequestSemanticConflict`，保留并链接原 receipt，禁用 submit/resolve-as-success，且只有 Owner 准入 successor
时才提供新 identity。UI 只显示 redacted changed-meaning summary 与 semantic fingerprint，protected replay value
绝不进入 page model。修正后的 F1 candidate 进入真实 Product Edge consumer 前，该状态机保持
`OBSERVED_CANDIDATE_NOT_CURRENT`。Qualification public projection 只接受终态。`Admitted` 与 `Evaluating`
是合法 Owner-internal 非终态 summary，但不能转换为 `ClosedNotQualified`、`Qualified` 或其他 public terminal。
`/qualification/outcomes` 必须从所有 terminal count 与 row 中排除它们，也不渲染 public receipt；对应
`/qualification` intake row 只有在独立准入的 intake projection 存在时才显示 `pending` 或 `evaluating`，否则
显示 `awaiting_terminal / unavailable`。其 action 只能是 Refresh 与该 intake projection 准入的 exact
same-identity read；不得显示 terminal color、successor action 或 completion notification。第八 F1 修正通过
真实 consumer 验收前，该 negative projector rule 保持 `OBSERVED_CANDIDATE_NOT_CURRENT`。同一 fact identity 的 Owner Time
Evidence 与存储 fact head 必须单调推进；caller 选择更早 read time 不能恢复旧 eligible projection。
`effective_from` 仍在未来的 successor 要么被拒绝，要么保持为显式 Owner-produced pending successor，同时
predecessor 继续 current。Currentness 使用唯一半开区间：predecessor 在 `valid_through` 终止，successor 可在
该精确边界开始，两者绝不能同时 current。Public projection 把该 head transition 绑定进 Qualification frontier，
使相同 Time evidence 不能代表两个不同 head。Browser time、refresh 或 optimistic state 不能提前提升它。
即使请求的 successor transition 被拒绝，已验证的 late Time evidence 仍必须单调：Owner 先记录
expiry/latest-time cut，再返回 mismatch；client 不能重试更旧 boundary 来逆转该 cut。

在 `now == valid_through` 时，所有 Strategy Factory Product Edge、Qualification、Scanner、Observability、
Runtime 与 Governance projection 都必须把 predecessor 视为 non-current。Strategy Factory Product Edge 已在
main 上以 `CURRENT/PARTIAL` 证明该规则；其他 producing Owner 仍是 candidate‑only 且 unresolved。UI 只消费
Owner freshness projection，绝不根据 browser time 重新计算；任何
`available_at >= valid_through` 的 evidence/envelope interval 都是 invalid，不能显示 AVAILABLE。在所有 producing Owner
一致证明该精确边界前，canonical 页面渲染 `EXCLUSIVE_BOUNDARY_UNRESOLVED / unavailable`，保留最后一次
observation 供诊断，并禁用 admission 或 success action。Locator comparison、refresh timestamp 或更晚的
`+1` test 都不能填补这项缺口。

Runtime application 同样受证据约束。Dashboard 只能从绑定精确 generation、application attempt 与最终
Strategy Instance 的 Owner receipt 显示 `APPLIED`。`APPLICATION_UNKNOWN` 必须保持 unknown，直到 append-only
权威 reconciliation successor 解析同一 attempt。Unit test 或 PAPER harness state 绝不是产品 Runtime 证据。
Live admission 与 snapshot restore 必须共用同一精确 predecessor/reconciliation validator，包括有效时间、
单调 sequence 与 `observed_at`、frontier coverage，以及不早于 reconciliation observation 的 successor evidence。
不满足这些检查的 malformed/migrated snapshot 只能 unavailable 或 quarantine，不能通过 restore 成为权威状态。
当前 F1 correction 刻意不存在正向 cross-Owner product path：所有 public 或 caller-produced readback 都渲染为
`APPLICATION_UNKNOWN`。独立准入的 sealed‑receipt dependency restructuring 存在并通过真实 Owner-store reread
前，Dashboard 不暴露 Apply-success 状态。

Governance-to-Runtime 最早可独立接受的产品切面是负向而非正向：默认 Windmill journey 可以证明
`REJECTED_NO_WRITE`，再证明 Runtime 对同一 generation/request identity 没有产生 application receipt。
Lifecycle detail 固定显示 rejection receipt、no-write assertion、source frontier 与 exact identity；Runtime
Generations detail 固定显示 `NOT_APPLIED / NO_APPLICATION_RECEIPT` 并回链该 Governance receipt，不显示 Apply
或 retry button。正向 `APPLIED` 只有在 Qualification、Portfolio、Execution binding、authorization lineage 与
Runtime readiness 于同一 admitted consumer slice 汇合后才可用。

Governance view 保留完整 contender frontier，并最终按唯一 canonical strategy-generation bytes 排序，绝不按
arrival order 或 caller-controlled request identity。Duplicate generation identity、duplicate complete comparator key，
或没有已准入 resolver 的 policy tie，必须为完整集合产生确定性的 `INPUT_INCOMPLETE_NO_WRITE` terminal receipt；
exact replay join 相同 receipts，changed subset 不能准入 decision。显示 accepted decision 前必须通过各 source Owner
重读全部 authorization/evidence cut，并暴露所得 source frontier。F0 direct reread 不可用时，view 只能是
`stale`/`unavailable`；system-clock digest、UI time 或常量 frontier 不能让它变 current。

Execution 与 live 页面默认只读。未来 control 保留
`TradeIntent -> RiskDecision/Reservation -> AuthorizedOrderCommand -> EffectAttempt -> VenueReadback/Reconciliation`
与当前明确 effect authority。可视化 button 绝不能绕过该链。

### Windmill 页面证据与 route 拆分

已观察的认证页面是 workspace `trade-rd` 中的 `/apps_raw/get/f/trade/rd_workbench`。在 1280 px 浏览器
viewport 下，Windmill 提供约 208 px workspace sidebar 与 1072 px App iframe。Iframe 内部署的 Raw App 使用
1040 px shell、左右各 16 px margin、上/下 48/32 px padding 与单一纵向 flow。已观察的四卡片 candidate 使用
26 px card padding、18 px radius、18 px 垂直 margin；source form 是两个 485.5 px column，gap 15 px。
Primary、secondary、quiet action 均高 46.5 px，并保持该顺序。低于 720 px 时 form 与 receipt list 变为单列。

实现证据是已部署 iframe，以及 `product/rd-workbench/f/trade/rd_workbench.raw_app/App.tsx`、`index.css`、
`control-policy.mjs` 与 shared `consumer_projection_v1.ts`。Trade main `81c519fade` 渲染 `01` 至 `03`，并已
包含上文 merged H1 projection/control contract；H1 没有 rebuild 或重新验证默认 Windmill iframe。`04` 仅
存在于已观察的 S3 deployed candidate。因此 S3 replay 仍是 `OBSERVED_CANDIDATE_NOT_CURRENT`：其页面只证明
layout 与 interaction，不能证明 main 或产品准入。下表刻意同时保留 repository-current 与历史 deployed
evidence，不表示四个 stage 已同时存在于 current source 或同一个 accepted deployment。

| Windmill stage                         | 已观察内部顺序                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Dashboard 归属                                                                                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01` Source and research goal          | 可编辑 proposal field：Source URL、source cut、observed time、digest、license basis、required data、interpretation、hypothesis、mechanism、falsifier、expected observation、costs、capacity、Trial budget、预提交停止规则、PIT/cost/slippage/capacity model identity、independence rationale 与 stable request identity。Submit path 随后只读显示 R&D basis receipt、Qualification frontier receipt/state、resolved local lineage/frontier，最后是 S1 receipt。Submit / Resolve / Successor action 顺序不变 | R&D / Intake；拆成 Source Evidence、Falsifiable Goal、TrialFamily Policy 与 Canonical Authority Resolution Bento panel。Authority value 均不可编辑；Submit 启动 validation 与 bounded authority chain，所有 sealed row resolved 前内部 family formation disabled |
| `02` Owner receipt and Research View   | Status row；native receipt/disposition/Intent；availability/phase、source cut、projection/valid‑through；TrialFamily root receipt 与 root identity/digest；INTENT membership receipt；Census member/fact；Census head/frontier；exact next action；conditional warning                                                                                                                                                                                                                                      | R&D / Research 的 selected‑request detail、`OwnerReceiptDrawer` 与 `TrialFamilyReceiptPanel`                                                                                                                                                                     |
| `03` Strategy Artifact Formation       | Frozen Intent、build request、attempt、Run / Resolve / Successor action、status、Formation receipt、Research View、含 deterministic double‑build 与 sandbox policy 的 Artifact Review、Artifact -> TrialFamily binding、binding receipt、bound family/frontier、exact next action 与 conditional warning                                                                                                                                                                                                    | R&D / Artifacts 的 selected‑artifact detail 与 `ArtifactTrialFamilyBindingPanel`                                                                                                                                                                                 |
| `04` Exploratory Replay and Run Detail | Replay request、run attempt、Artifact、Build Receipt、三个 action、status、三个 Owner receipt/view、actual identity、diagnostic、bounded summary、next action、永久 non‑claim                                                                                                                                                                                                                                                                                                                               | Backtest / Exploratory 加 `RunDetailDrawer`；Compare 与 Diagnostics 复用同一 receipt‑backed view                                                                                                                                                                 |

#### 精确 S1 V2 与 S2 页面骨架

以下 S1/S2 合同组合了 authenticated historical default-Web geometry 与 repository-current H1 projection/control
policy。Merged source behavior 是 `CURRENT/PARTIAL`；该精确 source 的 default-Web deployment 仍为
`NOT_ADMITTED`。Desktop 使用 canonical 12-column route shell；`P` 为 8 列、`Q` 为 4 列。低于 768 px 时，
同一 block 按下列顺序堆叠，不得隐藏 identity 或 warning。

```text
/rd
P1 Source Evidence
   URL [12] -> source cut [6] | observed time [6] -> digest [12]
   license basis [6] | required data [6] -> interpretation [12]
P2 Falsifiable Goal
   hypothesis [12] -> mechanism [12] -> falsifier [12]
   expected observation [6] | costs [6] -> capacity boundary [12]
P3 TrialFamily Policy
   trial budget [6] -> precommitted stop rule [12]
   PIT rule [6] | cost model [6] -> slippage model [6] | capacity model [6]
P4 Canonical Authority Resolution (read‑only)
   R&D basis: state | receipt identity | basis identity | cut [12]
   stage custody: SEALED_BASIS_PENDING_QUALIFICATION | request/admission | basis head/outbox | cut [12]
   Qualification frontier: state/GENESIS_EMPTY | receipt identity | frontier identity | cut [12]
   R&D lineage: state | predecessor frontier | census cut [12]
I  stable request identity strip [12]
A  [Submit to R&D Owner] [Resolve same identity] [Create successor identity]
Q  source non-authority warning -> form completeness -> Owner custody incident (when active) ->
   current stop predicate
T  request list; selection opens the S1 detail drawer below

S1 selected-request drawer / /rd/research detail
S  semantic label | ACCEPTED / SUBMITTED_OR_UNKNOWN / REJECTED_NO_WRITE /
   IDENTITY_CONFLICT / unavailable
H  Product Edge handoff | admission receipt/cut | downstream resolver version/state |
   R&D custody state/stop predicate; committed admission plus missing R&D receipt is
   SUBMITTED_OR_UNKNOWN, never REJECTED_NO_WRITE
B  sealed basis stage -> basis receipt/identity -> basis head/outbox -> commit cut ->
   missing Qualification/Research terminal -> RESOLVE_SAME_REQUEST_IDENTITY; no Submit/successor
   merged Resolve consumes sealed complete typed request meaning and enters Historical completion;
   terminal-only lookup miss or caller-resubmitted request bytes cannot satisfy this path
K  Qualification response loss -> committed projection -> expiry -> Owner-issued verified renewal/successor ->
   fresh locked readback; R&D/Product Edge/Dashboard cannot extend validity or create that recovery fact
D  verified terminal custody -> Research receipt/Intent -> TrialFamily root/member/census stays visible after
   linked-view expiry as STALE/read-only; remove positive actions, never return SUBMITTED_OR_UNKNOWN
R1 native receipt -> disposition -> Research Intent
R2 availability/phase -> linked Artifact availability -> source cut -> projection/valid-through ->
   Owner‑projected read-time freshness/action
F  TrialFamily root receipt -> family identity/root digest -> INTENT membership receipt ->
   Census member/fact -> Census head/frontier
X  restart/cache loss: immutable request identity -> Resolve -> identical receipt/Intent/family/frontier;
   replacement operational run link stays separate from Owner truth
N  current linked view: ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT
   expired linked view: STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY
W  one state-specific warning; ACCEPTED without complete direct F is unavailable, never success;
   downstream resolver unavailable disables S2 and exposes only Resolve same identity
C  Owner custody incident, when active: affected Owner/store/tables -> last trusted cut/counts ->
   current direct readback -> RESTORED_REVALIDATION_PENDING -> recovery evidence class;
   fixed actions [Open incident evidence] [Copy affected locator], with no Restore/Reconstruct/Clear

/rd/artifacts selected-artifact drawer
G  ActionAdmissionGate, always visible before attempt/provider sections:
   R cached Research View/valid-through/currentness is historical display only, never effect authority
   U UI same-request Resolve: IDLE -> PREFLIGHTING; [Checking…] [Cancel] while no Artifact request exists
     failure/cancel -> REVALIDATION_REQUIRED with no attempt and no same-attempt Resolve
   P ArtifactRequestAdmissionPanel: build request + attempt + Intent + channel -> exact operation/schema/effects ->
     Product Edge admission locator/receipt/final cut -> sealed current-Research evidence identity/digest ->
     source S1 admission locator -> R&D resolver/version/cut -> stop predicate
   Sending the Artifact request changes U to ADMITTING: [Submitting…], no Cancel and no fake percentage.
   Only a bounded typed server projection changes P to informational ADMITTED. The current Workbench wire does not
   expose its stored current-Research custody, so P keeps fixed unavailable geometry rather than inferring success.
   A post-send unknown transfers to SUBMITTED_OR_UNKNOWN + SameIdentityResolvePanel. Server success reveals the
   admitted-attempt section; A0 remains absent until the separate provider claim admission exists.
I  Frozen Intent -> build request identity -> attempt identity
A0 sealed invocation admission -> current authorization/frontier -> policy-equivalent binding/head ->
   exact manifest -> historical request‑admission lineage -> final locked write cut
A1 CLAIMED response-loss recovery + exact next action RUN_BOUNDED_EXECUTION_AGENT;
   Run requires exact A0 receipt equality, not the historical admission or claim alone
   wire binds invocation_admission_receipt_identity + invocation_admission_receipt_digest;
   claim/non-success wires omit optional family keys; explicit null is a schema mismatch;
   fresh Research read is never a post-claim start gate; recovered CLAIMED dispatches start directly,
   never prepare
   [Run bounded Agent + sandbox] [Resolve same attempt] [Copy claim] [Open operational run]
A2 INVOCATION_STARTED / OUTCOME_UNKNOWN
   [Resolve same attempt] [Copy claim] [Open operational run]
   Run bounded Agent and Create successor are absent
L  LEGACY_TERMINAL_QUARANTINED -> original SUCCESS / FAILED_NO_ARTIFACT /
   REJECTED_NO_WRITE / OUTCOME_UNKNOWN -> historical receipt/custody generation/quarantine reason;
   sparse rejection may omit Intent identity/digest; family/provider/actions remain absent
   [Resolve same attempt] [Open historical receipt] with no Artifact/provider/successor
S  semantic label | SUCCESS / SUBMITTED_OR_UNKNOWN / FAILED_NO_ARTIFACT /
   REJECTED_NO_WRITE / OUTCOME_UNKNOWN / unavailable
C  durable terminal and currentness are separate: linked Research View STALE keeps SUCCESS history but
   removes every review action and permits only Resolve same attempt
R1 Formation receipt -> disposition/failure -> Artifact/Build Receipt
E  FAILED_NO_ARTIFACT canonical receipt identity binds attempt + Intent + disposition + failure code +
   commit time; optional family keys are absent; failure code independently determines disposition;
   stale linked Research never removes or rewrites the receipt and receipt fields never self-verify
R2 Research View -> Artifact/Build/Review identities
V  Artifact Review in fixed order: Artifact digest; Intent/semantic digest; request/source lineage;
   source/Wasm/recipe; structured logic; parameter/dependency identity; Build/Security with
   deterministic double-build and sandbox policy; toolchain/target; Agent explanation/authority;
   admitted actions; S2 NOT_ADMITTED actions
F  Artifact -> TrialFamily binding -> binding receipt -> bound family/frontier
X  restart/cache loss: immutable build request + attempt -> Resolve -> identical Artifact/Review/
   binding/frontier; never Run again or create a naked retry
N  exact next legal action
W  SUCCESS without complete direct F is unavailable; a green job or Agent text cannot fill the gap
```

Windmill 原生 workspace sidebar 不会整套复制。Home/catalog、Variables、Resources、全局 Assets、Folders、
Groups、Tutorials、通用 Schedules、editor link、App builder、任意 Run-again、worker REPL 与 worker
administration 都排除。具备证据的 Runs、Run Detail、Workers、Service Logs 与 Audit 重新分配到 Operations；
Settings 只拥有 opaque installation/access reference，domain route 拥有业务 journey。Settings 不是 deployment
configuration、Capacity Scope 或 `PORT_BOUND` 的权威。

#### 精确 Operations 导航与列表页骨架

Operations 顶部 `ModuleTabs` 的固定顺序是 `Runs`、`Workers`、`Service Logs`、`Audit`、`Event Rail`、
`Telemetry`、`Alerts`。前四项来自真实 Windmill 页面；后三项来自 Trade 架构。窄屏时它们变成同序的水平
scroll tab，不折入通用 More menu。Windmill 的 Home、Variables、Resources、global Assets、Schedules 不在该
tab row 中；Run Detail 的 Metrics、Traces、Assets 只是 run-scoped tab，也不会升级成全局 route。

`/operations` 是 Runs 的 canonical route。桌面版保持筛选器、表头、date group 与 row action 的稳定位置：

```text
H  Operations / Runs                        [Refresh] [Auto-refresh: Off v]
N  [Runs] [Workers] [Service Logs] [Audit] [Event Rail] [Telemetry] [Alerts]
F  [Runs|Dependencies] [All|Queued|Running|Succeeded|Failed|Unknown]
   [Search path / run ID] [Duration v] [Concurrency v] [More filters]
S  Queued | Running | Unknown | Completed/Failed
T  RunTable / date group
   Status | Started | Duration | Path | Trigger/principal | Tag | Owner outcome
   row selection -> D; final column [Open] -> /operations/runs/:runId
D  RunSummaryCard: statuses, immutable run/operation/Owner locators, retention
   [Open run] [Resolve Owner outcome]
B  shown rows / filtered total | Rows per page [25|50|100] | Page n of m
   [First] [Previous] [Next] [Last]
```

Runs table 在 `>=1280 px` 使用 fixed layout：sticky header 40 px、date-group header 32 px、body row 最小
44 px、horizontal cell padding 8 px；column 比例固定为 `Status 10 / Started 14 / Duration 9 / Path 21 /
Trigger-principal 14 / Tag 10 / Owner outcome 14 / Open 8`。Path、trigger/principal、tag、Owner outcome 只显示
一行并 ellipsis；hover/focus 只揭示同一 redacted value，绝不读取 raw payload。默认按 effective run time
descending，再按 immutable run ID ascending。Effective time 优先 `started_at`，未开始 run 回退到
`received_at`，但 Started cell 仍显示 em dash。只有 Started 与 Duration header 暴露 sort control，顺序都是
descending、ascending、恢复 default。Date group 使用 selected display time zone 且 newest first；filter、time
zone、grouping 或 sort 改变时回到第一页。

四个 `S` card 的数量与位置绝不改变。选择 `Runs` 时 label 精确为 `Queued`、`Running`、`Unknown`、
`Completed / Failed`；选择 `Dependencies` 时为 `Queued dependencies`、`Running dependencies`、
`Unknown dependencies`、`Completed / Failed dependencies`。前三个 value 各为一个 integer count，第四个按
`completed / failed` 顺序显示两个 integer count。缺失的 count 在原 value slot 显示 em dash。Count 使用 selected
kind 与所有已应用的 non-status filter，但忽略 selected status，因此选择一个 status 不会清空其他三张 summary。

Control contract 是闭合的，不继承 Windmill default。Kind segment 默认 `Runs`，唯一 peer 是 `Dependencies`；
status 默认 `All`。Search 默认为空，只匹配 redacted path 或 immutable run ID。`Duration` 默认 `Any`，其后固定为
`<1 s`、`1-10 s`、`10-60 s`、`>=60 s`。`Concurrency` 默认 `Any`，其后为 `Has key`、`No key`；它描述
immutable dispatcher concurrency key 是否存在，不表示 live worker count。Header auto-refresh menu 默认 `Off`，
其后是 `5 s`、`15 s`、`30 s`。Cadence 改变立即生效、不重置 pagination，且只执行与 Refresh 相同的 read；
tab hidden 或 offline 时不排队补读。

Kind、status、Duration、Concurrency 在 selection 时立即应用并返回第一页。Search 在最后一次 edit 后精确
300 ms 应用；Enter 或清空立即应用，blur 不增加另一次 transition。后到的 search application 取消此前 in-flight
list read。显式 Started 与 Duration sort 绝不改变 newest-first date-group row 的顺序：它们只在每个 group 内排序，
grouping 为 `None` 时才对全表排序。Started 先放具有 `started_at` 的 row，按所选方向排序、immutable run ID
ascending 打破 tie；未开始 row 永远在后，内部按同方向的 `received_at`、再按 run ID ascending。Duration 先放
具有 duration 的 row，按所选方向排序，再按 effective time descending、run ID ascending 打破 tie；缺失 duration
的 row 永远在后，按 effective time descending、run ID ascending 排序。

`More filters` 在按钮下方打开一个 360 px popover。Field 顺序固定为：`Trigger`（默认 `All`，然后 `App`、
`Webhook`、`Other`）、`Principal`（空的 exact-text input）、`Tag`（空的 exact-text input）、`Time cut`
（默认 `Last 24 h`，然后 `Last 1 h`、`Last 7 d`、`Last 30 d`、`Custom`）、`Display time zone`（默认
`UTC`，然后 `Browser local`）、`Group by`（默认 `Day`，然后 `Hour`、`None`）。`Custom` 依次追加 start、end
input，并按 selected display time zone 解释。Footer 固定为 `[Reset filters] [Apply]`；value 在 Apply 前只是
staged，Escape 或 outside-click 会丢弃；button badge 是已应用的 non-default field 数。Reset 恢复这六项 default
并立即应用。`None` 移除 date-group row；`Day` 与 `Hour` 都保持 newest-first group。

Pagination 默认 50 行，只提供 25、50、100。Footer 依次保持 shown rows、filtered total、page size、
`Page n of m`、First/Previous/Next/Last；total unavailable 时同一 slot 显示 em dash，并禁用 page movement。
Loading 精确为四个 summary skeleton、两行 filter、一个 40 px header、默认 `Day` grouping 的三个 32 px
date-group bar、十个 44 px row 与完整 pager skeleton。`Hour` 同样使用三个 group bar；`None` 不使用 group bar，
但仍精确保留十行。Unfiltered empty、filtered empty、permission denied、backend unavailable 各占一个
96 px full-width table row，包含不同 title、单行 explanation，不制造 count；只有 backend unavailable 通过既有
route header 暴露 Refresh。

`768-1279 px` 时保持同序并放入最小宽 960 px 的 bounded horizontal scroller。8% action cell 保持标准的 8 px
horizontal padding，内部依次是 32 px text Open button、4 px gap，以及获准入时出现的 24 px More button。Button
与 padding 精确占用 76 px，可放入 960 px 最小 table width 下的 76.8 px cell；更宽 table 保持同一 left-aligned
geometry。低于
`768 px` 时变成六行 run
card：status + effective time；path；Owner outcome；trigger/principal；duration + tag；最后 Open。Card padding
12 px、gap 12 px、最小高度 156 px；六个 loading card 替代 table row，filter 顺序与 pager 不变。Card selection
打开同一个 `D`；不存在 checkbox、column chooser、selection count、bulk action 或 swipe action。

`Show schedules` 与 `Show future jobs` 默认不出现；只有 typed schedule/future consumer 获准入后，才在 `F`
第二行末尾追加。8% 的 `Open` cell 先放 `[Open]`；仅当 completed run 同时具有 disposable cache 与 current
`OperationalActionEnvelope` 时，才在其后放一个 24 px `[More]` button。Menu 唯一 item 是
`Delete disposable cache`。`>=768 px` 时，该 item 打开 480 px dialog，字段顺序固定为 immutable run ID、cache locator、Owner
readback locator、固定陈述 `Business facts are unaffected`、consequence、stop predicate；footer button 顺序是
`[Cancel] [Delete cache]`。低于 `768 px` 时改为 `100vw × 100dvh`、zero radius 的 full-screen sheet；同序 field
在内部 scroll，同一 footer sticky 在底部。缺少 eligibility 或 envelope 时直接移除 More，而不是 disable。
Mobile card 第六行以同样的左右顺序放置这两个 control。列表没有 bulk rerun、bulk delete、editor link、checkbox 或其他 overflow
action；empty、filtered-empty、permission-denied、backend-unavailable 继续按上文分别渲染。

#### Workers 精确只读 skeleton

`/operations/workers` 与 `/operations/workers/:workerId` 为 `DRAWABLE_EXACT`，
仅对第一方 RunStore GET readback 授予 `IMPLEMENTATION_ADMITTED`。这个 Workers 专项闭合替代此前的
Windmill worker-table 草图，不改变任何其他路由成熟度。它不读取 Windmill `rd-product-edge` 管理面，
也不授权切换、Owner effect 或生产写入。

```text
H  Trade worker custody / Shadow read workers                         [Refresh]
N  Existing Operations tabs; Workers remains in its existing position
S  [Fleet] Online | Expired                 [Workload] Claimed | Active
T  [Lease: All / Available / Expired]                  [Search workers]
   Worker | Lease | Jobs | Last run | Operations
D  Identity + lease badge -> Lease -> Activity -> Last run -> Capabilities
   Heartbeat history unavailable -> artifact digest -> [Back to worker list]
```

- 布局：flat `PanelFrame` 内依次为 header、body；body 内依次为 `CompactStatusBar`、
  `SplitBento(T,D)`。省略 `P/Q`，不预留高度。宽度 >=1280 px 时两列为
  `minmax(560px,1.55fr) minmax(300px,.8fr)`，gap 12 px，高度跟随内容，D 在 top 0 sticky。
  低于 1280 px 时单列 T 后接 D；所有宽度下 T 保留横向 overflow，不转换 card list 或全屏 drawer。
  summary 胶囊最小高度 62 px，空间不足时横向滚动；group 最小高度 52 px，44 px title 胶囊后接数值。
  继续使用共享主题 token、标题/action header、圆角内部内容、克制的不连续分隔线与 Lucide icon。
- Summary：Online 为 list observation cut 中 available lease 数；Expired 为 expired lease 数；
  Claimed 为 durable job count 总和；Active 为 active job count 总和。这些只代表 operational observation，
  不是当前进程健康或未绑定 run 的 readiness。合法空列表显示四个零；初次加载、无效响应、transport error 或
  unavailable list 显示四个 `-`，不能把失败推断为零。Detail availability 不影响 list count；
  不推断 group、memory 或 occupancy。
- Table：固定列顺序为 Worker（最小 250 px，identity link 后接注册时间）、Lease（最小 125 px，
  available/expired badge）、Jobs（105 px，active / claimed）、Last run（最小 220 px，identity 后接
  state/time；缺少 claim 显示 Unavailable / No durable claim）、Operations（120 px，exact registered-operation
  count）。表头与 cell 全部左对齐。各列支持升降序；Jobs 按 active 后 claimed 排序，Operations 按 count。
  默认按 last-run time 从新到旧，无 last run 时回退 registration time；同时间的输入行按 identity 排列。
  浏览器校验只要求 identity 唯一，不强制数据库 collation 行序等同 JavaScript 排序。
  无 grouping、checkbox、bulk action 或 column chooser。
- Filter：同一行按序为 Lease selector（All、Available、Expired）和右对齐 Search workers（最多 128 字符）。
  本地不区分大小写搜索 identity、artifact digest、last-run identity/state 与 registered operations；
  共享 Worker/Lease column filter 同样仅在本地执行。先过滤后分页：默认 20 行，选项 20/50/100，
  footer 按序为 range、previous/next；lease/search 改变重置页码。List route row selection 更新 D，
  identity link 打开 exact route。Exact route 的选择始终绑定请求 identity，不随 list/filter 改变。
- Detail：heading 为 Selected worker 或 Exact worker readback、exact identity、lease badge。
  四簇按序排列，外层 gap/padding 8 px，圆角 13 px，内 padding 为 13 px × 14 px；
  fact 为两等宽列、gap 12 px。Lease：Registered、Expires。Activity：Claimed、Heartbeat，title 带 active count。
  Last run：Run link、Claimed at，title 带 state 或 No claim。Capabilities：整行 Registered operations，
  按 registry 顺序。然后显示 Heartbeat history unavailable，说明只保留 latest heartbeat/deadline，
  memory/host 不作推断；footer 为 artifact digest 与 no-unbound-run-readiness 说明。
  Back to worker list 仅在 exact route 显示。
- 状态几何：初始加载保留同一 header/summary，用 compact Worker store unavailable 区域显示
  `READING_WORKERS`；loading-row count 明确为零，不制造 worker skeleton 数据行。Pending 时 Refresh
  disabled 且标为 Reading；刷新期间保留上次 observation 到 replacement 到达，但不声称 fresh。
  合法 empty 与 filtered-empty 均保留 columns/toolbar，空 body 最小 220 px，不制造 worker detail。
  List/detail 部分可用各自独立：T 失败时成功 D 仍在旁边，D 失败时成功 T 保留。无效 JSON/envelope、
  transport error、permission-denied response 不提供该 endpoint 的数据，使用各自 compact unavailable 区域；
  exact D 保留 requested identity、unavailable badge/reason、Back link。Worker 缺失沿用 D 几何并显示
  WORKER_NOT_FOUND。Wire 没有独立 stale/partial status：expired lease 仍是 observed expired row；
  不支持的 stale/partial envelope fail closed；不以 timer 将旧数据提升为 live health。
  List error 绝不覆盖独立有效的 D。
- Action 顺序/准入：header Refresh；table identity navigation；D 仅在存在 exact run identity 时展示
  Last run link；exact-route footer Back to worker list。Filter/sort/pagination 均为本地交互。
  远程只允许 GET/no-store 与严格 endpoint-specific envelope；D 必须回显并匹配 path identity。
  本面无 mutation action，也无 operational/domain action envelope。Create/edit config、restart、
  cache-clean、REPL、autoscaling、host/group/version 及 heartbeat-history 编造均禁止。

`/operations/service-logs` 是 read‑only split pane：

```text
H  Operations / Service Logs                  [Refresh] [Auto-refresh on|off]
N  Operations tabs in the fixed order above
F  [Time range] [Worker|Server] [Service/group] [Instance/host] [Severity] [Search]
S  Error count | Worker hosts | Server hosts | Selected instance
P  Instance list: service/group, shortened host, readiness, last observed
Q  Selected instance: exact identity, service/group, host, readiness, source cut, last observed
T  ServiceLogPanel: Timestamp | severity | service | instance | correlation | bounded message
B  Showing newest n of retention limit | redaction/truncation notice [Download bounded]
```

初始状态要求选择 host，不把空 viewport 画成成功；auto-refresh 保留 filter 与 scroll position，只有用户位于尾部时
才跟随最新行。下载沿用同一 filter、redaction 与 byte limit。日志不能升级 Owner health、business success 或
Telemetry availability。

`/operations/audit` 保持 append-only control-plane 语义：

```text
H  Operations / Audit                                           [Refresh]
N  Operations tabs in the fixed order above
F  [Time range] [Principal] [Operation] [Outcome] [Target/correlation search]
S  Execute | Create/Update | Delete | Failed/Denied
P  OperationAuditTable: Time | audit ID | principal | operation | outcome | target | correlation
Q  Fixed selected-correlation stack, in order:
   AuditCorrelationCard -> InvocationAdmissionReceipt -> InvocationClaimReceipt -> ProviderInvocationStateCard
   exact target/correlation, request/run locator, redaction reason, receipt/state stops
T  Timeline: selected operation events in canonical order; no replay action
B  Retention / redaction disclosure                 [Copy audit locator]
```

Windmill CE 的 resource detail 被隐藏，因此当前迁移证据显示 `redacted`，不能伪造 target。第一方
`OperationAuditStore` 以后写入 exact target/correlation；页面仍没有 edit、delete、dismiss 或 replay action。
移动端的 split page 保持 `H -> N -> F -> S -> P -> Q -> T -> B`；Runs 与 Workers 省略 `P/Q`、保留 full-width
`T`。Runs 把 `D` 作为 full-screen overlay 打开，filter 收进 route-local drawer；Workers 则使用上方
精确 skeleton 的 inline filter 与 T/D 上下排列几何。

#### 精确 Run Detail 骨架

`/operations/runs/:runId` 是完整 route；`DetailDrawer` 以 480 px 显示 `RunDetailPanel` 的快速检查
projection。两者使用相同 ordered slot 与 route-backed tab：

```text
H  Breadcrumb / Runs > path > shortened run ID
   [Copy locator] [Refresh] [Cancel queued dependency…?] [Resolve same identity] [Download bounded result/log]
S  Semantic status | operational status | duration | received/started/completed
P  Run identity, path, kind, tag, trigger, principal, worker, version, hash, language,
   memory peak, parent/root correlation, retention; then allowlisted Inputs key/value table
   and `n fields withheld` disclosure with reason chips; RunWorkerCompatibilityMatrix is bound to this run ID
   OperationalCancellationReceiptCard is the fixed read-only post-attempt location: pending/unavailable/receipt
Q  Owner Outcome: availability, source Owner, next legal action, receipt identity, source cut
T  Result: allowlisted/redacted bounded JSON/tree view with Copy field, Copy JSON,
   Download bounded result, and the same withheld-field disclosure
   then the fixed nested tabs [Logs] [Metrics] [Traces] [Assets]
   Logs   = search/filter/autoscroll/download + bounded line viewport + truncation notice
   Metrics= NotCollected/Unavailable/time-series
   Traces = NotCaptured/Unavailable/request spans
   Assets = Empty/disposable attachments only; Owner artifacts appear only as receipt locators
A  DependencyCancellationPanel in the fixed action slot, present only for a queued, unclaimed,
   zero-domain-effect dependency run with a current OperationalActionEnvelope. The third H action opens/focuses
   this confirmation; the panel's sole effect button is Cancel queued dependency. It stays disabled as Cancelling…
   while CAS is pending, then A and H slot 3 disappear. P retains the immutable receipt or explicit unavailable state.
```

Button 不继承 Windmill 通用 `Run again`、`Share`、`Edit`、script editor、worker REPL、restart 或 cache clean。
只有 current Owner manifest 准入时，domain route 才能提供 successor request；run page 自身只提供 navigation、
有界 operational evidence 的 copy/download、refresh 与 same-identity resolve。
Inputs 与 Result 绝不渲染任意 stored JSON。精确 operation/version registry 为每个可展示字段标记 sensitivity；
secret、protected、unknown 与 schema-mismatched 字段都没有 value slot。Withheld value 的 Copy field disabled；
Copy JSON 与 Download bounded result 序列化的必须是屏幕上同一份 redacted projection，绝不是 raw job
payload 或 result bytes。Registry entry 缺失或 mismatch 时，两个 panel 保持固定几何并显示带
operation/version 与 stop reason 的 `Unavailable`。

#### 源自 Windmill 的 action 状态机

| 状态                                                                     | Primary action                        | Secondary action                                           | Quiet action                                    | 必须呈现                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初始有效输入                                                             | Submit 或 Run enabled                 | Resolve disabled；只有完整导入 exact identity tuple 时例外 | Successor disabled                              | Neutral `NOT_SUBMITTED`；identity 与 semantic field 可编辑                                                                                                                                                                                          |
| Effect‑capable request 已发送；delivery pending                          | Disabled，label 为 `Submitting…`      | 无 Cancel；只有 bounded call 返回 unknown 后才出现 Resolve | Disabled                                        | `ADMITTING` 使用 amber pending text/icon，无伪造百分比。Request 可能已经写入；timeout/disconnect 转入 domain unknown，绝不能声称零写或返回 preflight                                                                                                |
| Unknown outcome                                                          | Disabled                              | Resolve same request/attempt identity enabled              | Disabled                                        | Persistent warning、immutable identity tuple、禁止 naked retry                                                                                                                                                                                      |
| Historical OA 已过期；canonical equivalent successor unavailable         | Disabled                              | Open/Copy historical authorization evidence                | Disabled                                        | Current authority row unavailable；immutable snapshot 保留；无 renewal/replacement selector                                                                                                                                                         |
| Admission successor distance 大于一                                      | Disabled                              | Open/Copy authorization chain evidence                     | Disabled                                        | 显示 admission/current generation、distance 与 `DIRECT_SUCCESSOR_REQUIRED`；绝不选择 chain head                                                                                                                                                     |
| Product Edge admission 已提交；downstream R&D custody unavailable        | Disabled                              | Resolve same request identity enabled                      | Successor disabled                              | `SUBMITTED_OR_UNKNOWN`；admission receipt/outbox 加 resolver stop predicate；绝非拒绝                                                                                                                                                               |
| Sealed S1 basis；Qualification 与 terminal Research receipt 缺失         | Disabled                              | Resolve same request identity enabled                      | Disabled                                        | 仅为 TARGET：`SEALED_BASIS_PENDING_QUALIFICATION` 显示 basis receipt/head/outbox 与缺失的 next receipt；Resolve 必须推进 sealed Historical completion。被拒绝的 `e5893fd550` 只重复 terminal lookup miss，因此保持 unavailable，不能伪装为 recovery |
| Verified S1 terminal；linked view stale                                  | Disabled                              | Resolve same request identity enabled                      | Open/Copy terminal evidence                     | 只有 currentness 使用 amber `STALE`；verified Research receipt 与 TrialFamily 保持 neutral/read‑only，successor/S2/review action 全部 absent，且状态绝不能变为绿色 success 或灰色 unavailable                                                       |
| Cached `AVAILABLE`；S2 尚未开始                                          | `Check & Run` enabled                 | Refresh current Research state                             | Open/Copy historical evidence                   | Neutral `IDLE`；cached currentness 只供展示，effect gate 尚未 admitted                                                                                                                                                                              |
| S2 same‑identity Research preflight pending                              | Disabled，label 为 `Checking…`        | Cancel enabled                                             | Disabled                                        | `PREFLIGHTING` 为 read‑only；accessible live region 加 spinner/amber text 报告状态；不存在 Artifact request 或 attempt                                                                                                                              |
| S2 preflight cancelled、timeout、malformed 或 transport‑unavailable      | Disabled                              | Refresh/Resolve same Research request identity             | Open/Copy historical evidence                   | `REVALIDATION_REQUIRED`；historical S1 evidence 仍可见，但 current‑positive action 已撤销。Artifact attempt 不存在，因此没有 same‑attempt Resolve，Artifact 也不能标为 unknown                                                                      |
| S2 Owner preflight 返回 stale 或 unavailable                             | Disabled                              | Resolve same Research request identity                     | Open/Copy historical evidence                   | 只有 Owner readback 可以标记 `STALE`；unavailable 保持 non‑positive。Product Edge admission、R&D attempt、invocation admission、claim 与 provider effect 全部 absent                                                                                |
| S2 preflight current；Artifact request 已 dispatch                       | Disabled，label 为 `Submitting…`      | 无 Cancel                                                  | Open/Copy preflight evidence                    | `ADMITTING`；server 在最终 OA → Product Edge → R&D cut 重复 gate，并要求 exact operation/schema/effect set。Navigation 不能暗示 cancellation                                                                                                        |
| S2 bounded server admission projection 已返回                            | Pipeline 继续；无第二个 submit button | Open/Copy admission                                        | Open operational run                            | 信息蓝 `ADMITTED`，绝不使用绿色。`ArtifactRequestAdmissionPanel` 显示 receipt/cut 与 sealed current‑Research projection；缺少 public projection 时保留 unavailable geometry                                                                         |
| S2 request 已 dispatch；admission/write outcome unknown                  | Disabled                              | Resolve same attempt identity                              | Open/Copy preflight 与 transport evidence       | Domain `SUBMITTED_OR_UNKNOWN`；write outcome unknown，因此没有 retry、Cancel、preflight reset、success badge 或 zero‑write claim                                                                                                                    |
| FirstMutation original OA stale/revoked；immediate successor current     | Disabled                              | Open/Copy original 与 successor evidence                   | Disabled                                        | 固定两行 currentness geometry，original 在前；`ORIGINAL_AUTHORIZATION_NOT_CURRENT`。Successor 绝不能替代 original authority，且不写 basis/rejection/invocation fact                                                                                 |
| `CLAIMED` 但 invocation admission 缺失或 mismatch                        | Disabled                              | Resolve same attempt identity enabled                      | Disabled                                        | A0 receipt slot 显示 unavailable、保留 claim identity、没有 Run 或 replacement claim                                                                                                                                                                |
| Claim wire schema/version mismatch                                       | Disabled                              | Resolve same attempt identity enabled                      | Disabled                                        | 固定 A0/A1 slot unavailable；显示 operation/schema 与两个 expected receipt field；无 Run                                                                                                                                                            |
| Rust 省略 optional family key，但 gateway 期待 `null`                    | Disabled                              | Resolve same attempt identity enabled                      | Disabled                                        | 对应 A1/terminal slot unavailable；显示 absent‑vs‑null schema stop；不推断 fact                                                                                                                                                                     |
| Sealed `CLAIMED`；fresh Research read stale/unavailable                  | Run bounded Agent + sandbox enabled   | Resolve same attempt identity enabled                      | Disabled                                        | Historical claim/attempt custody 是 gate；Run 直接 dispatch start，绝不调用 `prepare`                                                                                                                                                               |
| Started claim；Research 在 terminal/readback 前过期                      | Disabled                              | Resolve same attempt identity enabled                      | Disabled                                        | 从 sealed custody terminalize/read exact receipt；stale linked view 只禁用 follow‑on action                                                                                                                                                         |
| Verified legacy terminal                                                 | Disabled                              | Resolve same attempt identity enabled                      | Disabled                                        | 固定 panel 显示四值 original disposition 与 historical receipt；无 Artifact/provider/successor                                                                                                                                                      |
| 带 Owner receipt 的成功终态                                              | 完成 identity 的 submit disabled      | 只有 Owner manifest 声明时才允许 Resolve                   | 只有 `next_legal_action` 准入时才创建 successor | Green semantic state、receipt、source frontier；Windmill job green 本身不够                                                                                                                                                                         |
| Rejected/no‑write terminal                                               | Disabled                              | 准入时解析原 receipt                                       | Owner 明确准入修正语义时才创建 successor        | Rejection code、zero‑created‑fact 说明、原 identity 保留                                                                                                                                                                                            |
| Identity conflict                                                        | Disabled                              | 只解析原 identity                                          | 原 meaning 可知前 disabled                      | Conflict state；绝不覆盖或暗示不存在                                                                                                                                                                                                                |
| Missing receipt、invalid evidence、stale、unavailable、permission denied | Disabled                              | 只有存在 typed Owner operation 时才 read/resolve           | Disabled                                        | `NotAdmittedNotice` 或 stop predicate；无 optimistic terminal                                                                                                                                                                                       |

### Canonical routed-page 骨架

每个 tab 在实现前都必须能从以下 desktop skeleton 直接绘制。Content region 使用 12-column grid；缺省 slot
折叠时不得改变其余 slot 的顺序。

```text
+-- 76 rail --+-- main -----------------------------------------------------------+
| user        | 56 top bar: status tape | tabs | search | notifications          |
| module rail +------------------------------------------------------------------+
|             | H  page title · scope · Owner · cut · freshness · route actions   |
|             +------------------------------------------------------------------+
|             | S1 summary | S2 summary | S3 summary | S4 summary                 |
|             +---------------------------------------------+--------------------+
|             | P primary workspace (8 columns, min 320)    | Q context (4 cols) |
|             +---------------------------------------------+--------------------+
|             | T table / chart / timeline / comparison (12 columns, min 360)    |
|             +------------------------------------------------------------------+
|             | A one admitted action: domain Owner | operational envelope       |
+-------------+------------------------------------------------------------------+
                                                    D detail drawer: 480 px max
```

`RouteGrid` 独占该 page-level geometry，并与参考项目派生的 `BentoGrid` 分离。Viewport width `>=1280px` 时，
它有 12 个等宽 logical column：`S1-S4=3`、`P=8`、`Q=4`、`T/A=12`。`768-1279px` 时有 6 列：每个 summary
占 3 列并每行两个，`P/Q/T/A=6` 且保持 source order。低于 `768px` 时只有一列，顺序为
`H -> S1 -> S2 -> S3 -> S4 -> P -> Q -> T -> A`；`D` 是 full-screen overlay，不占 grid slot。
`RouteSlot` 只拥有这些 span，不能接收任意 caller-supplied column count。Panel 内部的 `BentoGrid` 保留
container-observed `wide/narrow/collapse`、180 px minimum auto-row、16 px gap、1/2/3/4/8 column 与 1-4 row
span；绝不能改变 route order 或 drawer behavior。

- `H` 高 72-96 px，固定包含 page title、单行 purpose、适用时的 scope selector、Owner/source cut、freshness
  badge，以及仅 route-level action。
- `S1-S4` 是 104 px summary card。缺少 metric 时保留 slot 并显示 `Unavailable`，绝不能用零填补空位。
- `P` 与 `Q` 共用一个最小 320 px row。`Q` 放 context、stop predicate、evidence completeness 或当前 selected
  identity；它绝不能作为第二 writer 重复 `P`。
- `T` 是 canonical list/history/comparison surface。Selection 打开 `D`，不替换 URL。
- `A` 只为一个已准入的 `ActionAdmissionGate` branch 出现。`domain` variant 要求 Owner projection，并包含
  action label、target identity、consequence、stop predicate 与一个 primary button。`operational` variant 要求
  current `OperationalActionEnvelope`，保持同一 geometry，且不能承载 domain action 或替代 Owner admission。
- `D` 在 desktop 为 480 px、compact desktop 为 400 px、低于 768 px 为 full-screen。内部顺序固定为 status、
  immutable identities、Owner receipt、source cut/frontier/freshness、evidence、独立 operational job link、
  recovery，最后是同一个 `A` action；不得包含第二份 semantic form。
- Loading 为每个已占用 slot 使用保持形状的 skeleton。Empty、partial、stale、unavailable、unknown、rejected、
  conflict、quarantined 与 permission-denied 保持相同 geometry。

#### Skeleton 完整度 gate

Route name、`S/P/Q/T` slot assignment 或 PascalCase label 本身都不是可实现的 component contract。以下状态
具有规范性，防止 experimental chapter 高估当前 Dashboard 已经可以被绘制的程度：

| 完整度状态                            | 当前 page 或 surface                                                                                                                                                                                      | 准入含义                                                                                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRAWABLE_EXACT`                      | Operations Runs `/operations`、Run Detail `/operations/runs/:runId`、Workers `/operations/workers` 与 `/operations/workers/:workerId`；Market Data `/data` 与 `/data/pit-catalog`；全部四个 Runtime route | 本章固定 route slot、内部 field/column 顺序、尺寸或 responsive transformation、state geometry 与 button 顺序。Fail‑closed route 可以用固定 unavailable/not‑ready value 绘制；该状态不代表其 backend 或 Dashboard consumer available                              |
| `DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY` | R&D Intake `/rd` composer 与 authority‑resolution panel；R&D Research `/rd/research` selected‑request detail；R&D Artifacts `/rd/artifacts` selected‑artifact detail                                      | 具名 content/detail region 已精确，但其外围 route list 仍缺少 summary label、table column、row action、sort、pagination 或 loading‑row geometry 中的一项或多项；整个 route 不可绘制、不可实现                                                                    |
| `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE`    | Registry 中其他全部完整 route，明确包括 Service Logs、Audit、Event Rail、Telemetry、Alerts，以及全部四个 Portfolio route                                                                                  | Registry 只固定 navigation position、route slot、具名 page‑local composite 与 button intent。无人值守 Agent 不得从 component‑like name 或已排除的 Windmill/native layout 推断缺失的 list behavior、timeline row、responsive table transformation 或内部 geometry |

Route 引用但 reusable component inventory 中缺席的名称只是 page-local composite label，不是隐藏的 reusable
atom。将一个 blueprint 晋升为 `DRAWABLE_EXACT`，要求本章以双语指定：全部 summary label 与 value state；有序且带
尺寸的 `P/Q` child；每个 `T` column、row action、grouping、sort、filter、pagination 与 loading-row count；有序
`D` field；empty/partial/stale/unavailable/error/permission-denied geometry；以及准确 button order 与 admission
gate。其 reusable atom 随后还必须加入 inventory。Dashboard 实现仅对这些精确 route 与 shared atom 标记为
`IMPLEMENTATION_ADMITTED`，并必须作为有边界、可 review 的切面交付，保持 fail-closed data/effect 边界。
`DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY` 或 `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE` surface 在完成同样的双语闭合并
晋升前仍禁止实现；实现准入绝不提升 backend availability、Owner acceptance、replacement readiness、Windmill
cutover 或 production effect。

### Routed page blueprint registry

以下 registry 是 skeleton 的规范。Button 按列出的左右顺序出现。`Open`、`Copy`、`Refresh`、filter 与 compare
selection 是只读 UI action；其他 button 在 render 时还必须取得匹配的 admitted `ActionAdmissionGate` branch：
`domain` 使用具名 Owner action manifest，显式注册的 `operational` control 使用 current
`OperationalActionEnvelope`。

对 `/rd`、`/rd/research` 与 `/rd/artifacts`，最后一列保留的 H0/H1 defect narrative 是历史设计依据。当前
disposition 以上文章首的 merged H1 回读为准：具名 source contract 是 `CURRENT/PARTIAL`，其精确 default-Web
deployment 仍未验证；`ArtifactRequestAdmissionPanel` 在 bounded server projection 暴露所需 custody 前保持
固定 unavailable；actual provider execution 仍为 `NOT_ADMITTED`。该规则只解析 status，不改变 registry 中
固定的 panel、button 或 state geometry。

#### Overview 与 R&D

| Tab 与 route                     | 固定 `S / P / Q / T` 内容                                                                                                                                                                                                                                                                                                                                                                      | Button 顺序                                                                                                                                                                                                                                | 默认证据状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status `/dashboard`              | 四摘要：incident、unknown effect、stale/unavailable Owner、active work；`P=GlobalStatusMatrix`；`Q=AttentionQueue + OwnerCustodyIncidentPanel`；`T=OwnerOutcomeTimeline`                                                                                                                                                                                                                       | Refresh views、Open selected detail、Copy affected locator                                                                                                                                                                                 | `CURRENT/PARTIAL`；缺少 Owner adapter 时 unavailable。Qualification incident 占一个 row，显示当前 `1/1/1 + receipt` direct readback 与 `RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`；stale frontier 保持 unavailable，且绝不提供 restore action 或 healthy score                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Attention `/dashboard/attention` | 按 stop predicate 计数；`P=AttentionTable`；`Q=SelectedStopPredicate`；`T=EvidenceCompletenessMatrix`                                                                                                                                                                                                                                                                                          | Open detail、准入时 Resolve same identity、Copy locator                                                                                                                                                                                    | Read‑only；没有通用 dismiss                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Recent `/dashboard/recent`       | Owner terminal 计数；`P=RecentOwnerOutcomes`；`Q=SourceFreshness`；`T=ReceiptTimeline`                                                                                                                                                                                                                                                                                                         | Filter、Open receipt、Copy identity                                                                                                                                                                                                        | Read‑only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Evidence `/dashboard/evidence`   | Available/stale/unavailable/quarantined 计数；`P=OwnerFrontierMatrix`；`Q=RebuildState`；`T=EvidenceConflictTable`                                                                                                                                                                                                                                                                             | Refresh、Open evidence、Copy locator                                                                                                                                                                                                       | Static foundation 不等于产品 available                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Intake `/rd`                     | Form completeness/source count/request state/Owner freshness；`P=ResearchRequestComposer + TrialFamilyPolicyComposer + TrialFamilyAuthorityResolutionPanel`；`Q=OwnerCustodyIncidentPanel + SourceEvidenceCard + NonAuthorityCallout`；`T=DraftSourceList`                                                                                                                                     | Custody unavailable 时：Open incident evidence、Copy affected locator；Submit、Resolve 与 Create successor 全部 disabled。其他状态下 Submit 先完整 validation 再解析 basis/frontier/lineage；Create successor 需要 Owner‑admitted terminal | 既有 S1 仍是 `CURRENT/PARTIAL`；V2 authority chain 是 `OBSERVED_CANDIDATE_NOT_CURRENT`。当前默认 Qualification store 为 `RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`：canonical Owner recovery 与 direct Owner readback 已成功，但原 frontier stale，且 default‑Web/Product Edge/R&D revalidation 尚未运行。browser 不重建 pre‑loss receipt，也不显示任何正向 Submit/S1/S2/provider action                                                                                                                                                                                                                                                                                                                                                                                                                |
| Research `/rd/research`          | Active/stale/unknown/accepted/rejected 计数；`P=ResearchRequestTable`；`Q=ResearchViewCard + TrialFamilyReceiptPanel + S1TerminalCustodyPanel`；`T=ResearchReceiptTimeline`                                                                                                                                                                                                                    | Refresh、Open detail、Resolve same identity、准入时 Create successor                                                                                                                                                                       | 既有 S1 是 `CURRENT/PARTIAL`；v5 证明 `e5893fd550` 会把完整 stale S1 terminal 隐藏为 receipt‑less unknown，因此 TrialFamily root/member/frontier 与统一 read‑time freshness 是 `OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`。TARGET current linked state 为 `ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT`；在 `now >= valid_through` 时继续显示同一 verified Research receipt/TrialFamily 与 historical Artifact availability，同时 currentness 变为 `STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY`，并隐藏所有 positive action                                                                                                                                                                                                                                                                 |
| Hypotheses `/rd/hypotheses`      | Active/falsified/pending/unavailable 计数；`P=HypothesisLineageTable`；`Q=FalsifierCard`；`T=SourceToIntentGraph`                                                                                                                                                                                                                                                                              | Open source、Open Intent、在 Intake 准备 successor                                                                                                                                                                                         | 本 tab 不直接 mutate Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Artifacts `/rd/artifacts`        | Available/failed/unknown/review‑required 计数；`P=ArtifactTable`；`Q=ArtifactRequestAdmissionPanel + ArtifactOutcomeProjectionGate + ArtifactReviewPanel + ArtifactTrialFamilyBindingPanel + NoArtifactReceiptPanel + InvocationAdmissionReceipt + ProviderInvocationStateCard + LegacyTerminalQuarantinePanel`；`T=BuildAndSecurityEvidence`，含 deterministic double‑build 与 sandbox policy | Check & Run、Open Artifact、仅 dispatch 后 Resolve same attempt、Copy provider claim、Open operational run、Ask Agent to revise、Start exploratory replay                                                                                  | 既有 S2 是 `CURRENT/PARTIAL`；action‑time admission、result‑authority precedence、binding、no‑Artifact closure 与 invocation state 都是 `OBSERVED_*_NOT_CURRENT`。Dispatch 前 failure 让 Artifact request 保持未提交且没有 attempt Resolve；只有 `ADMITTING` 歧义才进入 `SUBMITTED_OR_UNKNOWN`。Outcome gate 先选择 sealed R&D terminal receipt；只有不存在 terminal 时 `INVOCATION_STARTED` 才能投影 `OUTCOME_UNKNOWN`。TARGET 同时使用按 resolution 区分的 absent/present key、direct claimed start、stale‑safe terminal receipt 与四种 read‑only legacy disposition。Server‑admission panel 在 bounded public projection 暴露其 receipt 与 sealed current‑Research custody 前保持 unavailable；job success 不能填充它。无 provider retry button；`ACTUAL_PROVIDER_CALL_AT_MOST_ONCE` 仍为 `NOT_ADMITTED` |
| Decisions `/rd/decisions`        | Accepted/rejected/unknown/action‑required 计数；`P=IterationDecisionTable`；`Q=DecisionEvidenceCard`；`T=DecisionLineage`                                                                                                                                                                                                                                                                      | Open decision、Resolve same identity、Prepare admitted successor                                                                                                                                                                           | Owner 返回 exact action 前只读                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

#### Backtest、Qualification 与 Scanner

| Tab 与 route                                           | 固定 `S / P / Q / T` 内容                                                                                                                                                                                  | Button 顺序                                                                                                                               | 默认证据状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exploratory `/backtest`                                | Running/unknown/terminal/rejected 计数加 operation deployment state；`P=ExploratoryReplayComposer`；`Q=CapabilityUnavailablePanel + OperationalJobCard`；`T=BacktestRunTable` 保留历史 Owner‑linked row    | operation archived 时依次为 Refresh registry、Open historical run、Copy capability locator。恢复并准入前禁用 Run/Resolve/Create successor | S3 `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE`；remote replay entry 当前已归档。历史设计证据保留，但页面不能派发或暗示 MCP parity                                                                                                                                                                                                                                                                                                                                     |
| Compare `/backtest/compare`                            | Selected‑run count 与 comparable cut；`P=RunPicker`；`Q=ComparisonBasis`；`T=RunComparePanel`                                                                                                              | Add run、Remove run、Swap baseline、Open run detail                                                                                       | Read‑only；比较 2-4 个 exact compatible run                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Diagnostics `/backtest/diagnostics`                    | Diagnostic category 计数；`P=DiagnosticFilter`；`Q=ModelIdentityList`；`T=DiagnosticTable + bounded summary`                                                                                               | Filter、Copy identity、Open source receipt                                                                                                | 仅允许的 category；无 protected Qualification data                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Intake `/qualification`                                | Submitted/pending/evaluating/unknown/not‑admitted/semantic‑conflict/unavailable 计数；`P=QualificationIntakeTable`；`Q=EvidenceCompleteness + QualificationIntakeConflictPanel`；`T=IntakeReceiptTimeline` | Submit intake、Refresh、Resolve exact same meaning、Open original receipt、Prepare admitted successor                                     | Pending/evaluating 需要独立准入的 intake projection，且绝不意味着 public terminal。Exact replay 可以 resolve；同 identity 下任意 changed valid/invalid meaning 都是 `RequestSemanticConflict`。`OBSERVED_CANDIDATE_NOT_CURRENT`；尚无真实 Product Edge consumer                                                                                                                                                                                                                     |
| Protected feedback `/qualification/protected-feedback` | Current/genesis‑empty/unknown/corrupt 计数；`P=QualificationFrontierTable`；`Q=QualificationFrontierReceiptPanel + IndependenceBasisLink`；`T=OpaqueFrontierTimeline`                                      | Refresh、按 exact basis Resolve current、Open R&D basis receipt、Copy opaque frontier reference                                           | `RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`；exhaustive canonical Owner history verification 与 direct `1/1/1 + receipt` readback 已成功，但重建的原 frontier 在 current cut stale/`UNAVAILABLE`，且 consumer revalidation 尚未运行。页面渲染 unavailable、隐藏 Copy frontier，只暴露 read‑only incident evidence。Identity/cut/digest/state 保持可见；protected content、candidate Intake、protected attempt、eligibility、holdout 与 cross‑family ancestry 仍为 `NOT_ADMITTED` |
| Outcomes `/qualification/outcomes`                     | 仅 Qualified/ineligible/expired/revoked public‑terminal 计数；`P=PublicOutcomeTable`；`Q=QualificationPublicOutcome`；`T=PublicFrontierTimeline`                                                           | Refresh、Open public outcome、Copy opaque reference                                                                                       | `Admitted/Evaluating` 不产生 row、terminal count、receipt、color、notification 或 action。仅 public redaction；protected field 没有 slot。`OBSERVED_CANDIDATE_NOT_CURRENT`                                                                                                                                                                                                                                                                                                          |
| Eligibility `/qualification/eligibility`               | Current/pending/expired/conflict 计数；`P=EligibilityIntervalTable`；`Q=HeadFrontierCard`；`T=TransitionTimeline`                                                                                          | Refresh、Resolve current head                                                                                                             | 仅 foundation；空或 dual‑current interval 为 unavailable                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Schedules `/scanner`                                   | Due/unknown/unavailable/failed 计数；`P=ScheduleTable`；`Q=DueSlotEvidence`；`T=AttemptTimeline`                                                                                                           | Open schedule、Resolve same due‑slot                                                                                                      | 有真实 schedule consumer 前延后 create/edit                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Runs `/scanner/runs`                                   | Running/unknown/rejected/terminal 计数；`P=ScannerAttemptTable`；`Q=AttemptReceipt + ScannerPublicReceiptIntegrityPanel`；`T=MatcherInvocationEvidence`                                                    | Open run、Resolve same attempt                                                                                                            | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`：PR #334 要求 sealed Scanner Owner admission。直接 Owner consumer 与 runtime adapter 分别准入前，不显示 row/count/badge/receipt 或 Matcher/Proposal evidence                                                                                                                                                                                                                                                                 |
| Proposals `/scanner/proposals`                         | New/accepted/rejected/unavailable 计数；`P=ProposalTable`；`Q=ProposalEvidence`；`T=ProposalLineage`                                                                                                       | Open proposal、Prepare admitted lifecycle request                                                                                         | Proposal 不授权 Governance 或 Runtime                                                                                                                                                                                                                                                                                                                                                                                                                                               |

#### Strategy、Runtime 与 Portfolio

| Tab 与 route                         | 固定 `S / P / Q / T` 内容                                                                                                                                           | Button 顺序                                                                                                                          | 默认证据状态                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry `/strategy`                 | Registered/current/superseded/unavailable 计数；`P=StrategyRegistryTable`；`Q=GenerationIdentityCard`；`T=GenerationLineage`                                        | Open generation、Copy identity                                                                                                       | 仅 static Governance foundation                                                                                                                                                                                                                                                                   |
| Lifecycle `/strategy/lifecycle`      | Pending/accepted/rejected‑no‑write/unknown 计数；`P=LifecycleRequestTable`；`Q=GovernanceEligibilityAdmissionPanel + GovernanceDecisionCard`；`T=ContenderFrontier` | Eligibility valid 时：Submit lifecycle request、Resolve same request、Create successor；否则 Open Eligibility evidence、Copy locator | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`：PR #334 使 invalid/unavailable Eligibility 成为 pre‑admission 零写入状态。Receipt‑backed `REJECTED_NO_WRITE` 是独立的已准入 Governance decision；positive Runtime application 与 product consumer 仍为 `NOT_ADMITTED`                     |
| Allocations `/strategy/allocations`  | Allocated/unallocated/capacity‑blocked/unavailable 计数；`P=AllocationTable`；`Q=CapacityEvidence`；`T=AllocationHistory`                                           | Open allocation、Prepare allocation request                                                                                          | Dashboard 没有 allocation writer                                                                                                                                                                                                                                                                  |
| Instances `/runtime`                 | 一个固定 not‑ready summary；`P=EmptyState`；`Q=RuntimeFoundationNotReadyCard`；`T=EmptyState`                                                                       | Refresh foundation、Open revalidation dependency、Copy foundation locator                                                            | `CURRENT/PARTIAL · FOUNDATION_NOT_READY`：显示 `NotReady` 与精确四项 dependency。没有 Strategy Instance row、readiness receipt、incident、Resolve、Apply 或绿色状态；未来 Owner‑backed `RuntimeReadinessCard` 缺席                                                                                |
| Generations `/runtime/generations`   | 不显示 generation 计数；`P=EmptyState`；`Q=RuntimeFoundationNotReadyCard`；`T=EmptyState`                                                                           | Refresh foundation、Open revalidation dependency、Copy foundation locator                                                            | `NOT_ADMITTED`：PR #330 不暴露 generation 或 application surface。即使 `NOT_APPLIED / NO_APPLICATION_RECEIPT` 也要等待单独准入的 Governance‑to‑Runtime consumer；未来 generation geometry、`APPLIED`、Resolve 与 Apply 都缺席                                                                     |
| Checkpoints `/runtime/checkpoints`   | 不显示 checkpoint 计数；`P=EmptyState`；`Q=RuntimeFoundationNotReadyCard`；`T=EmptyState`                                                                           | Refresh foundation、Open revalidation dependency、Copy foundation locator                                                            | `NOT_ADMITTED`：PR #330 不暴露 checkpoint 或 restore surface。未来 `CheckpointTable`、`RestoreValidationCard`、`CheckpointHistory`、Open checkpoint 与 Validate restore evidence 都缺席                                                                                                           |
| Incidents `/runtime/incidents`       | 不显示 incident 计数；`P=EmptyState`；`Q=RuntimeFoundationNotReadyCard`；`T=EmptyState`                                                                             | Refresh foundation、Open revalidation dependency、Copy foundation locator                                                            | `NOT_ADMITTED`：PR #330 不暴露 incident 或 Recovery surface。未来 `RuntimeIncidentTable`、`IncidentEvidence`、`IncidentTimeline`、Open incident 与 Open Recovery case 都缺席；missing heartbeat 不能制造 incident                                                                                 |
| Performance `/portfolio`             | 不显示 performance summary；`P=EmptyState`；`Q=PortfolioViewUnavailableCard`；`T=EmptyState`                                                                        | Open contract evidence、Copy contract locator                                                                                        | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`：只显示 request/envelope contract。未来 `PerformanceChart`、`AccountAndFactCut`、`PerformancePeriods`、range control 与 source‑fact action 都缺席；legacy `PortfolioSnapshot` 不是 Owner fact                                                |
| Exposure `/portfolio/exposure`       | 不显示 exposure summary；`P=EmptyState`；`Q=PortfolioViewUnavailableCard`；`T=EmptyState`                                                                           | Open contract evidence、Copy contract locator                                                                                        | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`：未来 `ExposureMatrix`、`CoherentEvidenceCut`、`ExposureTable`、scope filter 与 fact action 都缺席；shared Cache position 或 stale flag 不能填充该 card                                                                                      |
| Capacity `/portfolio/capacity`       | 不显示 capacity summary；`P=EmptyState`；`Q=PortfolioViewUnavailableCard`；`T=EmptyState`                                                                           | Open contract evidence、Copy contract locator                                                                                        | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`：request 绑定 scope/mode/policy/common cut，但不存在 positive Gross Capacity projection。未来 `CapacityScopeCard`、`GrossCapacityView`、`CapacitySourceCompleteness`、`CapacityViewHistory`、refresh/source action、usage 与 headroom 都缺席 |
| Attribution `/portfolio/attribution` | 不显示 attribution summary；`P=EmptyState`；`Q=PortfolioViewUnavailableCard`；`T=EmptyState`                                                                        | Open contract evidence、Copy contract locator                                                                                        | `NOT_ADMITTED · NO_ATTRIBUTION_SURFACE`：PR #332 不暴露 attribution projection identity。未来 `AttributionChart`、`AttributionEvidenceCut`、`AttributionTable`、period control 与 evidence action 都缺席；不推断 Alpha、Qualification 或 Risk usage                                               |

#### Risk、Execution 与 Data

| Tab 与 route                               | 固定 `S / P / Q / T` 内容                                                                                                                               | Button 顺序                                                         | 默认证据状态                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisions `/risk`                          | Allow/reject/decrease‑only/unavailable 计数；`P=RiskDecisionTable`；`Q=DecisionEvidenceAndLineage`；`T=RiskDecisionTimeline`                            | Open decision、Resolve same intent、Open source facts               | `NOT_ADMITTED`：legacy check/forward/denial event 不进入此页；无 manual override                                                                                                                                                                                                        |
| Reservations `/risk/reservations`          | Available/withdrawn/consumed/unknown‑effect/no‑effect/settled 计数；`P=ReservationTable`；`Q=ReservationLiabilityCard`；`T=ReservationHistory`          | Open reservation、Open claim result、Open linked effect             | Standalone Risk core 为 `MECHANISM_REJECTED / NOT_ADMITTED`；只有包含 Risk‑owned one‑use fact/store 的完整跨 Owner 输入链才能重新规划。Dashboard 不释放 liability                                                                                                                       |
| Claims & Admission `/risk/claims`          | Consumed/rejected/admitted‑once/suppressed/conflict/unavailable 计数；`P=ClaimAndAdmissionTable`；`Q=AggregateFrontierCard`；`T=ClaimAdmissionTimeline` | Open claim、Open prepared attempt、Open adapter binding、Open fence | Local‑core leaf 为 `MECHANISM_REJECTED / NOT_ADMITTED`；claim、admission 与 fence arbitration 必须在同一个真实消费者纵切中共用一个 Risk transaction frontier                                                                                                                            |
| Fences `/risk/fences`                      | Active/pending/cleared/unavailable 计数；`P=FenceTable`；`Q=FenceSetAndFrontier`；`T=FenceTimeline`                                                     | Open fence、Open Recovery case、Open source facts                   | Risk‑owned fence fact 存在前 `NOT_ADMITTED`；active fence 绝不隐藏或 dismiss                                                                                                                                                                                                            |
| Attempts `/execution`                      | Prepared/invoked/unknown/rejected 计数；`P=EffectAttemptTable`；`Q=EffectAuthorityCard`；`T=AttemptJournal`                                             | Open attempt、Resolve same effect                                   | 默认只读；无 explicit effect authority 时没有 invocation button                                                                                                                                                                                                                         |
| Orders `/execution/orders`                 | Open/partial/filled/rejected 计数；`P=OrderTable`；`Q=AuthorizedCommandCard`；`T=OrderStateTimeline`                                                    | Open order、Open command、Resolve venue readback                    | UI 不创建或修改 order                                                                                                                                                                                                                                                                   |
| Fills `/execution/fills`                   | Fill/fee/slippage/unavailable 摘要；`P=FillTable`；`Q=FillEvidence`；`T=FillTimeline`                                                                   | Filter、Open fill receipt                                           | Read‑only                                                                                                                                                                                                                                                                               |
| Reconciliation `/execution/reconciliation` | Matched/missing/conflicting/unknown 计数；`P=ReconciliationTable`；`Q=ReconciliationPanel`；`T=VenueReadbackTimeline`                                   | Refresh readback、Resolve same effect、Open Recovery case           | Unknown 持久显示                                                                                                                                                                                                                                                                        |
| Recovery `/execution/recovery`             | Open/contained/reconciling/closed 计数；`P=RecoveryCaseTable`；`Q=RecoveryEvidence`；`T=RecoveryTimeline`                                               | Open case、Run admitted read‑only reconciliation step               | UI 不推断 effect retry 或 closure                                                                                                                                                                                                                                                       |
| Sources `/data`                            | 不显示 binding 计数；`P=EmptyState`；`Q=MarketDataOwnerFoundationCard`；`T=EmptyState`                                                                  | Open foundation evidence、Copy foundation locator                   | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER`：PR #331 准入 sealed Source Binding readback schema，但未准入 Dashboard/H0 resolver composition。未来 `DataSourceTable`、`SourceBindingCard`、`SourceCutHistory`、positive admitted badge 与 resolver/mutation action 都缺席 |
| PIT Catalog `/data/pit-catalog`            | 不显示 snapshot 计数；`P=EmptyState`；`Q=MarketDataOwnerFoundationCard`；`T=EmptyState`                                                                 | Open foundation evidence、Copy foundation locator                   | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER`：PR #331 准入 sealed PIT Snapshot readback schema，但未准入 Dashboard/H0 resolver composition。未来 `PITCatalogTable`、`SnapshotIdentityCard`、`CorrectionTimeline`、available badge 与 resolver/mutation action 都缺席      |
| Quality `/data/quality`                    | Complete/partial/conflict/quarantined 计数；`P=QualityRuleMatrix`；`Q=SelectedQualityFinding`；`T=QualityTimeline`                                      | Open finding、Open source evidence                                  | 不自动 acceptance                                                                                                                                                                                                                                                                       |
| Freshness `/data/freshness`                | 按 source 的 current/stale/expired/unavailable 计数；`P=FreshnessMatrix`；`Q=TimeEvidenceCard`；`T=LagHistory`                                          | Refresh、Open frontier                                              | 禁止一个 global freshness maximum                                                                                                                                                                                                                                                       |

#### Operations 与 Settings

| Tab 与 route                                                     | 固定 `S / P / Q / T` 内容                                                                                                                                                                                                                                                                                                                                                                                    | Button 顺序                                                                                                    | 默认证据状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs `/operations`                                               | 四张固定 status card 按 selected Runs/Dependencies kind 限定 scope：queued、running、unknown、completed/failed；`T=RunTable`，含 status/date/path/trigger/principal/tag/duration；row selection 后 `D=RunSummaryCard`；省略 `P/Q`                                                                                                                                                                            | Refresh、Filter、Open run、Resolve Owner outcome、Delete disposable completed cache                            | Windmill 真实使用；仅 operational，删除不改变业务 truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Run Detail `/operations/runs/:runId`                             | Semantic/operational/timing summary；`P=RunMetadataAndInputs + RunWorkerCompatibilityMatrix + OperationalCancellationReceiptCard` 并绑定 `:runId`；`Q=OwnerViewCard`；`T=RunResultView`，后接固定嵌套 `Logs/Metrics/Traces/Assets` tabs                                                                                                                                                                      | Copy locator、Refresh、条件成立时 Cancel queued dependency、Resolve same identity、Download bounded result/log | 使用上方精确固定 skeleton；Cancel 只在 queued、unclaimed、zero‑domain‑effect dependency run 中占据第三个按钮位，其余状态该 slot 缺席。CAS 中以 disabled `Cancelling…` 显示；terminal transition 后 action/panel 缺席，P 保留 receipt 或 unavailable readback。Worker readiness 只针对这个精确 run 推导。无 batch cancel 或通用 rerun/edit/share                                                                                                                                                                                                                            |
| Workers `/operations/workers` 与 `/operations/workers/:workerId` | 使用上方 Workers 精确只读 skeleton：Fleet/Workload summary；P/Q 缺席；T 列为 Worker、Lease、Jobs、Last run、Operations；D 按 identity 绑定四簇事实                                                                                                                                                                                                                                                           | Refresh、Open exact worker、Open last run、Back to worker list                                                 | `IMPLEMENTATION_ADMITTED · FIRST_PARTY_RUN_STORE_GET_ONLY`；仅 registration/lease/claim observation；list/detail 独立 fail closed；无 Windmill 管理、未绑定 run 的 readiness、Owner acceptance 或切换                                                                                                                                                                                                                                                                                                                                                                      |
| Service Logs `/operations/service-logs`                          | Error/worker/server/instance 计数；`F=ServiceLogFilters`；`P=ServiceInstanceList`；`Q=ServiceInstanceCard`；`T=ServiceLogPanel`，内含 `BoundedLogViewport`                                                                                                                                                                                                                                                   | Refresh、Toggle auto‑refresh、Download bounded logs                                                            | Windmill 真实使用；只读、redacted、retention‑bounded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Audit `/operations/audit`                                        | Execute/update/create/delete/success/failure 计数；`P=OperationAuditTable`；`Q=AuditCorrelationCard + InvocationAdmissionReceipt + InvocationClaimReceipt + ProviderInvocationStateCard`，顺序固定；`T=Timeline` 显示 canonical operation events                                                                                                                                                             | Filter、Open correlation、Copy audit locator、Copy provider claim                                              | Windmill audit 仍是 append‑only control‑plane evidence，不是 Owner business truth。Product Edge 单独显示 invocation admission、claim disposition、`CLAIMED / INVOCATION_STARTED`、start disposition 与 state digest。`OUTCOME_UNKNOWN` 是持久 manual‑reconciliation stop；historical request admission、缺失 invocation admission 或 claim resolve 绝不意味着新 effect 或 provider retry                                                                                                                                                                                   |
| Event Rail `/operations/event-rail`                              | Ingested/conflict/quarantined/rebuilding 计数；`P=EventRailTable`；`Q=EnvelopeEvidence`；`T=RebuildTimeline`                                                                                                                                                                                                                                                                                                 | Filter、Open event、Copy locator                                                                               | 真实 adapter consumption 前仅 static Observability foundation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Telemetry `/operations/telemetry`                                | Available/stale/partial/rebuilding/unavailable/quarantined 计数；`P=TelemetryMatrix`；`Q=SourceFrontierCard`；`T=TelemetryTimeline`                                                                                                                                                                                                                                                                          | Refresh、Open source                                                                                           | PR #327 source projection 是 `CURRENT/PARTIAL`；per‑source frontier、freshness、completeness、rebuild state、quarantine 与 opaque checkpoint 使用固定 read‑only geometry。Owner 与 telemetry adapter unavailable，telemetry visibility 固定为 `Unavailable`，任何 empty、raw、stale、replayed 或 self‑asserted signal 都不能产生 `Available`                                                                                                                                                                                                                               |
| Alerts `/operations/alerts`                                      | Critical/warning/info/unread 计数；`P=AlertTable`；`Q=AlertDetail`；`T=DeliveryHistory`                                                                                                                                                                                                                                                                                                                      | Open alert、Mark presentation read、Open Owner evidence                                                        | Read acknowledgement 不是业务 acknowledgement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Data Sources `/settings`                                         | Configured/healthy/unavailable/secret‑missing 计数；`P=DataSourceConfigList`；`Q=OpaqueConnectionRefForm`；`T=ValidationHistory`                                                                                                                                                                                                                                                                             | Test read‑only connection、Save opaque reference                                                               | Page state 不展示或存储 secret value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Agents `/settings/agents`                                        | Configured/running/unavailable/budget‑blocked 计数；`P=AgentProfileList`；`Q=ProviderAndBudgetForm`；`T=InvocationHistory`                                                                                                                                                                                                                                                                                   | Test provider、Save profile                                                                                    | Provider key 不 pass‑through 到 Owner request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Notifications `/settings/notifications`                          | Channel/enabled/failed/unavailable 计数；`P=NotificationPreferenceForm`；`Q=ChannelStatus`；`T=DeliveryHistory`                                                                                                                                                                                                                                                                                              | Send local test、Save preferences                                                                              | 不 acknowledge Owner outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Access `/settings/access`                                        | Principal/session/token/revoked 计数，以及 binding `ACTIVE/SUPERSEDED/zero‑active` 与 authorization available/expired/revoked/unavailable 计数；`P=LocalPrincipalCard`；`Q=AuthorizationLineagePanel`，内部固定 `Current authority / Admission snapshot` tabs，并分开显示 `Operator Authorization / Product Edge readiness` rows；`T=AuthorizationSuccessorReadiness + CapabilityManifest + CredentialAudit` | Re‑authenticate local session、Issue narrow transport token、Revoke token、Copy once                           | Transport credential 控件绝不能签发、续期、撤销或 chain‑walk Operator Authorization。Historical expiry 缺少 immediate equivalent successor，或 `successor_distance>1` 时，`Current authority` 显示 unavailable，并列出 prior/current identity、generation、distance 与准确 stop；immutable snapshot 保留，且没有 renewal/replacement selector。只有 `Current authority` 驱动 action state。两个 tab 都显示准确 binding/head、issuer/audience/scope、expiry/revocation frontier、manifest digest、source cut 与 stop predicate；secret/token value 仍只显示一次且不记录日志 |

`/settings/access` 使用以下固定 read/control 分区：

```text
H  Settings / Access                                                   [Refresh]
S  Session | Current authority | Successor readiness | Revoked
P  Local principal/session: identity, authenticated/expired/unavailable, last re-auth
Q  [Current authority] [Admission snapshot]
   Operator Authorization: identity, issuer, audience, scope, sequence, validity, state, cut
   Product Edge readiness: binding/head, manifest digest, outbox, state, cut, stop predicate
R  Successor readiness: prior identity/scope/sequence -> Owner operation availability ->
   admission/current generation -> successor distance 0|1 -> predecessor locator ->
   successor receipt/identity or DIRECT_SUCCESSOR_REQUIRED / exact unavailable reason;
   no editable value, selector, or chain-head promotion
T  [Authorization successor] [Capability manifest] [Credential audit]
B  [Re-authenticate] [Issue narrow transport token] [Revoke token] [Copy once]
```

Successor issuance unavailable 时，`S` 保留四等分 slot，`R` 使用固定 amber unavailable geometry，`B` 只包含
transport/session control。任何 viewport 都不出现 Issue/Renew authorization、Select replacement、Force active
或 pasted-receipt control。

### Overlay、button 与状态渲染合同

- `OwnerReceiptDrawer` 与 `RunDetailDrawer` 使用固定 `D` 顺序。Receipt 是唯一终态证据时不能藏在 accordion。
- `GlobalSearchDialog` 包含 query input、type chip、result group、identity/source-cut preview，且只有 `Open`
  或 `Prepare request` action；不能执行 domain mutation。
- `NotificationDrawer` 按 incident、unknown、stale、fence 与 informational delivery 分组。`Mark read` 只改变
  presentation state。
- Primary button 提交一个 admitted semantic operation；secondary 解析同一 identity；outline/quiet 创建
  Owner-admitted successor；ghost 只导航、filter、refresh read 或 copy。
- 每个修改型 button 都由 `ActionAdmissionGate` 包裹，branch tag 只有 `domain` 与 `operational` 两个 variant。Domain branch
  要求当前 `NextLegalActionBar` operation 与 `admitted` envelope 在 principal、scope、Owner、operation、schema、
  exact effect set、binding head、authorization 与 manifest digest 上完全一致。S2 的 `Check & Run` 是 composite
  domain control：第一段只执行 read-only preflight，只有内部 dispatch transition 才能进入 `ADMITTING`。
  Operational branch 只适用于 `dependency.cancel.queued` 这类已注册 disposable control；必须持有绑定
  principal、capability、精确 operational identity、dispatcher transition version、zero domain effect、
  claim-absence cut 与短 expiry 的 current `OperationalActionEnvelope`。Backend 在自己的 transition lock 下重读
  envelope；它绝不替代 Owner envelope 或 `NextLegalActionBar`。Expiry、revocation、identity/version/head change、
  zero/dual `ACTIVE` binding、manifest mismatch、new claim、resolver unavailable 或 preflight failure 都必须
  disable 对应 branch，且不能保留之前的绿色状态。
- Disabled business button 只在 prerequisite 可本地说明时保留可见，help text 必须命名缺少的 receipt、
  capability、freshness、permission 或 identity。未准入 capability 使用 `NotAdmittedNotice`，而不是永久 disabled
  的假 control。
- Skeleton 保持最终 geometry：60/35% 宽 text line、四个 summary block、`P/Q/T` body、status badge 与 drawer
  row。无真实 job 时不能出现随机 value、success color 或 animated progress。
- 状态顺序和颜色固定：unavailable/neutral、pending/amber、success/green、rejected 或 incident/red、
  protected/purple、conflict/quarantine red 且有明确 label。每种 color meaning 都同时用 text 与 icon 重复。

## 可复用组件目录

高层只能依赖低层。Page 不得重定义 color、spacing、status semantic 或 action rule。

### Foundation primitive

| 组件                                                                              | 合同                                                              |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Text`, `Heading`, `Numeric`, `Code`, `Link`                                      | semantic typography；identity/数字使用 mono tabular numeral       |
| `Icon`                                                                            | 单一 library，默认 1.5 px stroke；交互时有 accessible label       |
| `Button`, `IconButton`, `ButtonGroup`                                             | primary、secondary、outline、ghost、destructive；loading/disabled |
| `Input`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `Switch`                   | label、help、error、disabled、readonly、pending                   |
| `Tabs`, `SegmentedControl`, `Breadcrumb`, `Pagination`                            | resource identity 改变时 route‑backed                             |
| `Badge`, `StatusDot`, `IdentityChip`, `ModeChip`                                  | text 加 icon/shape；禁止 color‑only                               |
| `Tooltip`, `Popover`, `Menu`, `Dialog`, `Drawer`                                  | bounded layer 与 keyboard dismissal                               |
| `Skeleton`, `Spinner`, `Progress`, `EmptyState`, `ErrorState`, `UnavailableState` | loading 与 unknown/empty/unavailable 分离                         |
| `Separator`, `ScrollArea`, `VisuallyHidden`, `CopyButton`                         | 共享结构与 accessibility                                          |

### Layout 与 navigation component

| 组件                                                                        | 合同                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DashboardShell`                                                            | full‑screen rail、top bar、viewport、overlay root                                         |
| `UserCapsule`                                                               | 本地 operator 与 installation menu；无业务权威                                            |
| `IconRail`, `IconNavItem`                                                   | 稳定顺序、tooltip、active/focus/disabled/attention                                        |
| `TopBar`, `StatusTape`, `ModuleTabs`, `GlobalCommand`, `NotificationButton` | top menu 四区                                                                             |
| `PageHeader`, `ScopeBar`, `AuthorityStamp`, `FreshnessStamp`                | Owner/evidence context                                                                    |
| `RouteGrid`, `RouteSlot`                                                    | page‑level 12/6/1‑column contract、固定 slot span/order、无 caller‑defined column count   |
| `BentoGrid`, `BentoItem`, `SplitPane`, `DetailDrawer`                       | panel 内部 container‑responsive 1/2/3/4/8‑column 组合、180 px minimum auto‑row、16 px gap |

### Data display component

| 组件                                                                         | 合同                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Card`, `CardHeader`, `CardBody`, `CardFooter`                               | 白色、12 px radius、可选 expand、禁用 glass                                                       |
| `PanelFrame`, `PanelFrameHeader`, `PanelFrameBody`, `PanelSection`           | 灰 frame、白 body、scroll/flex mode                                                               |
| `StatGrid`, `StatItem`, `KVRow`, `DataList`, `DataTable`                     | unit、source cut、empty/unavailable state                                                         |
| `ChartFrame`, `ChartLegend`, `ChartTooltip`, `TimeRangeControl`              | axis、unit、locale、disclosure、no‑data                                                           |
| `Timeline`, `EventRow`, `BoundedLogViewport`, `DiffView`, `ComparisonMatrix` | virtualization、stable key、redaction、truncation 与 retention disclosure                         |
| `FilterBar`, `FilterDrawer`, `DateGroup`, `TableToolbar`, `TableFooter`      | route‑backed filter、稳定 column/order、filtered‑empty、row count 与 pagination；移动端仅改变容器 |
| `StateBanner`, `Callout`, `AlertRow`                                         | success/pending/unknown/rejected/unavailable/protected/incident                                   |

### Domain component

| 组件                                                                                                                     | 合同                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OwnerReceiptCard`, `OwnerViewCard`, `ReceiptLink`                                                                       | Owner identity、disposition、cut、freshness、locator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `NextLegalActionBar`                                                                                                     | 只显示 current direct‑read projection 中 Owner‑admitted action；durable historical success 在 stale/unavailable/archived 状态下绝不保留 action；否则显示 stop predicate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ActionAdmissionGate`, `AuthorizationLineagePanel`                                                                       | discriminated input 精确为 `domain / operational`，绝不能同时出现。`domain` 把 `NextLegalActionBar` 与唯一 `ACTIVE` shell binding/history head、Operator Authorization、Time/revocation、Owner freshness、Product Edge readiness、exact effect set 与 manifest 交叉绑定。`operational` 只接受已注册 disposable capability 加 current `OperationalActionEnvelope`，绑定 principal、run、dispatcher transition version、空 domain‑effect digest、no‑claim cut 与 expiry；Dispatcher 在 lock 下重读，且它不能填充 `AuthorizationLineagePanel` 或替代 Owner authority。两者共用 `IDLE / PREFLIGHTING / ADMITTING / ADMITTED / REVALIDATION_REQUIRED / STALE / UNAVAILABLE`；dispatch 后 unknown 转到 branch‑specific same‑identity readback。Domain 显示 `Current authority` 再显示 `Admission snapshot`；operational 显示 envelope/transition/no‑claim evidence。Historical snapshot 不参与任一 branch，两个组件都不能构造或修复 authority                                                                                                                                                                                                                                                                                                                                            |
| `AuthorizationSuccessorReadiness`                                                                                        | 只读显示 prior authorization identity/scope/sequence、admission/current generation、`successor_distance=0\|1`、terminal expiry/revocation state、canonical direct‑successor operation availability、存在时的 successor receipt/identity，以及准确 missing/invalid stop。FirstMutation 固定增加 `Original authorization at final cut`、`Immediate successor at final cut` 两行；original 必须是 `CurrentAtLock`，successor 只是额外 current requirement。Distance 大于一显示 `DIRECT_SUCCESSOR_REQUIRED`；original non‑current 显示 `ORIGINAL_AUTHORIZATION_NOT_CURRENT`。它绝不遍历 chain、让 successor 替代 original authority、构造 scope、选择 replacement、签名、续期、撤销或调用 transport‑token control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `DownstreamAdmissionHandoffPanel`                                                                                        | 固定显示 Product Edge admission receipt/identity/cut、admission‑outbox locator、downstream‑resolver version/availability、target R&D Owner、R&D receipt/custody state 与 stop predicate。它区分 `admission committed / downstream unavailable` 和输入拒绝，把整体状态渲染为 `SUBMITTED_OR_UNKNOWN`，禁用 S2，只暴露 Copy admission、Open operational run 与 Resolve same identity；绝不提供 successor、retry、权限修复或推断出的 R&D receipt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ArtifactRequestAdmissionPanel`                                                                                          | 固定三行 S2 gate：historical cached Research View/currentness；可取消的 UI same‑request `PREFLIGHTING`；server‑authoritative Artifact request admission。Server row 绑定 build request、attempt、Intent、channel、exact operation/schema/effect set、Product Edge locator/receipt/final cut、sealed current‑Research evidence identity/digest、source S1 admission locator 与 R&D resolver/version/cut。Preflight failure 保留第一行只读、把 currentness 标为 non‑positive，且不渲染 attempt Resolve。Dispatch 进入 `ADMITTING`；unknown 转入 `SUBMITTED_OR_UNKNOWN`。只有 bounded public projection 才能显示信息蓝 `ADMITTED`；当前 private stored custody 或绿色 Windmill job 都不能填充该 panel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `InvocationAdmissionReceipt`                                                                                             | 第一次 claim 前创建的 sealed Product Edge receipt：identity/digest、original request‑admission lineage、build request 与 attempt、直接解析的 current authorization identity/frontier 与 Time Evidence、policy‑equivalent `ACTIVE` binding/head、准确 manifest digest、final locked write cut 与 commit time。Missing、expired、cross‑cut、malformed 或 mismatch custody 都是 unavailable，并抑制 claim/start/Run。它在 Dashboard 中只读，不能从 claim、admission snapshot、session 或 credential 重建                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `InvocationClaimReceipt`                                                                                                 | Product Edge claim 加准确 public wire field `invocation_admission_receipt_identity` 与 `invocation_admission_receipt_digest`、historical request‑admission lineage、attempt identity、committed time、claim digest、`CLAIMED_NEW / ALREADY_CLAIMED / unavailable`、current `CLAIMED / INVOCATION_STARTED` 与 Owner‑projected next action。Operation adapter/projector 共享一个按 resolution 分支、由 Rust serialization bytes 直接测试的 parser；claim/non‑success family key 必须 absent，绝不能合成 `null`。Missing/extra/tampered field 让 A0/A1 保持 unavailable。只有恢复的 `CLAIMED + RUN_BOUNDED_EXECUTION_AGENT` 与 sealed receipt 直接一致时，才可进入 start                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ArtifactOutcomeProjectionGate`                                                                                          | 一个 attempt 上的 read‑only 优先级 gate：canonical sealed R&D `SUCCESS`、canonical sealed R&D `FAILED_NO_ARTIFACT`，最后才是不存在 R&D terminal 时的 Product Edge `INVOCATION_STARTED`。它只渲染一个 downstream panel 并记录两个 source cut；conflict、missing custody 或 ambiguous dual terminal 显示 unavailable，不能按 first‑match 渲染 success                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ProviderInvocationStateCard`                                                                                            | 两种固定 geometry。可恢复 `CLAIMED` 先显示准确 sealed invocation‑admission receipt，再显示同一 request/attempt/claim、无 started time、next action `RUN_BOUNDED_EXECUTION_AGENT`，按钮依次为 Run bounded Agent + sandbox、Resolve same attempt、Copy claim、Open operational run。Missing/mismatch invocation admission 保持同一 geometry unavailable 并移除 Run。Claim 后 stale/unavailable fresh Research read 标为 non‑gating；Run 不经 prepare 直接 dispatch start。`INVOCATION_STARTED / OUTCOME_UNKNOWN` 使用固定红色 geometry 与 manual reconciliation，且无 Run/successor；terminalization 与后续 readback 消费 sealed custody，并跨 Research expiry 保留 terminal receipt。绝不创建 claim、重试 provider、标记 success、dismiss stop 或推断 outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `LegacyTerminalQuarantinePanel`                                                                                          | Owner discriminant、original `SUCCESS / FAILED_NO_ARTIFACT / REJECTED_NO_WRITE / OUTCOME_UNKNOWN` disposition、request/attempt identity、verified historical terminal receipt identity、optional sparse Intent field、legacy custody generation、observed time 与 quarantine reason 的 strict legacy‑only projection。只依次暴露 Resolve same attempt、Open/Copy historical receipt；family/provider/actions 保持 absent，且没有 current Research View、Artifact promotion、successor、TrialFamily repair 或 dismiss action。Missing/malformed projection 保留同一固定 geometry 并显示 unavailable，绝不折叠成 generic unknown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SameIdentityResolvePanel`                                                                                               | immutable request 或 request+attempt tuple、previous Owner receipt fingerprint、replacement operational‑run link、resolved Owner receipt/view fingerprint 与精确 equality/conflict/unavailable result；它是 unknown/response‑loss/restart/cache‑loss 的唯一 recovery，绝不派发 naked retry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ResearchRequestComposer`                                                                                                | 有来源可证伪 typed request；绝不直接创建 Intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `S1StageCustodyPanel`                                                                                                    | 只读 `SEALED_BASIS_PENDING_QUALIFICATION` geometry，绑定准确 request 与 original admission、sealed 完整 typed request meaning fingerprint、basis receipt/identity、basis head/outbox、commit cut、缺失的 Qualification/terminal Research receipt 及 next action。仅在 canonical basis‑stage verification 后渲染。Same‑identity Resolve 必须消费 sealed meaning 并推进 Historical completion；terminal‑only lookup miss 让 panel 保持 unavailable。Submit/successor 缺席，duplicate basis/head/outbox 为 unavailable，changed request/admission 为 conflict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `S1TerminalCustodyPanel`                                                                                                 | 固定 geometry 显示完整 verified Research receipt/Intent 与 TrialFamily root/member/Census，并把 terminal custody 和 linked‑view currentness 分成两行。Expiry 只把后者变为 `STALE`，移除 Submit/successor/S2/review action，保留 Resolve/Open/Copy evidence；绝不隐藏 terminal receipt/family 或把它重新标为 `SUBMITTED_OR_UNKNOWN`。Terminal part 缺失或 cross‑binding 失败时保持同一 geometry unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ResearchViewCard`                                                                                                       | immutable historical Research fact，加独立 linked‑Artifact availability、Owner‑projected read‑time availability/phase/action、source cut、projection time 与 `valid_through`；渲染 current `ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT`、保守 cached `REVALIDATION_REQUIRED`，或 Owner‑returned `STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY`，且不抹除 historical Artifact availability。`Check & Run` 进入 read‑only `PREFLIGHTING`；后两种 form 没有 positive next‑action slot，browser time 自身绝不能声称 `STALE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `TrialFamilyPolicyComposer`                                                                                              | 只编辑 proposal meaning：bounded trial budget、预提交停止规则、PIT/cost/slippage/capacity model identity、independence rationale 与 falsifier；没有 editable predecessor/frontier、protected‑feedback、independence disposition/basis identity、falsifier binding 或 family identity field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `TrialFamilyAuthorityResolutionPanel`                                                                                    | 固定三条只读 row：R&D basis receipt/basis/cut、Qualification frontier receipt/frontier/cut/state（如 `GENESIS_EMPTY`）、R&D resolved lineage/predecessor/census cut；每条包含 Owner、operation、locator、availability 与 stop reason。Positive row 只接受 sealed Owner output，绝不能接收 browser‑deserialized TrialFamily graph。Missing/corrupt/unknown authority 只暴露 same‑identity Resolve，并产生零 S1 family 写入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `QualificationFrontierReceiptPanel`, `IndependenceBasisLink`                                                             | sealed Qualification receipt identity、opaque frontier identity/digest/state/cut、source R&D basis receipt locator、exact resolution operation，且没有 protected payload slot；只有穷尽 canonical verification 证明不存在历史 projection/outbox 后，才能显示 `GENESIS_EMPTY`。Missing head 或 unverifiable history 渲染 `unknown/unavailable`、隐藏 Copy frontier，且只暴露 exact‑basis Resolve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `TrialFamilyReceiptPanel`                                                                                                | direct R&D Owner root receipt、family/root digest、INTENT membership receipt、Census member/fact 与 head/frontier 的固定顺序；available 要求 canonical JSON 与每个重复 relational identity、ordinal、digest、committed‑time 字段一致；缺失、损坏、不完整或不一致的 custody 必须 unavailable，不能与 S1 success badge 共存                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ArtifactReviewPanel`                                                                                                    | current linked Research projection 中的 immutable identity、lineage、logic、parameter、build/security 与 action；stale‑linked durable S2 success 保留 evidence，但不渲染 review action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ArtifactTrialFamilyBindingPanel`                                                                                        | 来自同一 locked direct‑Owner custody cut 的 binding identity、identity 包含 `committed_at` 的 binding receipt、独立显示的 commit cut、bound TrialFamily identity 与 Census frontier；只与 Owner‑resolved S2 Artifact 同时出现，绝不从 Intent/Artifact identifier 推导；未解决的并发 mutation 或任何 canonical/time mismatch 都渲染 unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `NoArtifactReceiptPanel`                                                                                                 | canonical receipt payload identity、attempt、Intent、独立推导的 disposition、failure code、commit time 与显式 zero‑Artifact statement。Exact wire 省略 optional family key。Research expiry 可以把 linked view 标为 stale 并移除 follow‑on action，但绝不能移除或改写 receipt；mismatch 或 self‑derived verification 渲染 unavailable，不暴露 positive action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `CapabilityUnavailablePanel`                                                                                             | operation identity/version、registry version、`archived/unavailable` state、compatibility‑envelope identity/digest、expected 与 observed component source/image/App/script hash、affected channel、observation cut、mismatch reason、preserved historical‑read disclosure 与精确 restoration/revalidation predicate。Healthy service 或 source text 相同都不能填补缺失的 envelope。只暴露 Refresh registry、Open historical run 与 Copy capability locator；无 dispatch、archive/restore、successor、permission repair 或 credential action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `OwnerCustodyIncidentPanel`                                                                                              | 固定红色 unavailable geometry：incident identity/evidence locator；affected Owner、store 与有序 table set；last trusted cut 与 pre‑loss counts；current direct‑read cut/counts；`backup / PITR / Owner archive / reconstruction evidence` source class；recovery state（`UNKNOWN`、`RESTORABLE_FROM_CANONICAL_SOURCE`、`RECOVERABLE_BY_RECONSTRUCTION_NOT_RESTORED`、`RESTORED_REVALIDATION_PENDING`、`RESTORED`）；shared‑volume rollback constraint；精确 revalidation predicate。按钮固定为 Open incident evidence、Copy affected locator。它绝不重建 row、接收 pasted JSON、清除 incident、标记 restored 或启用 domain action；只有 canonical recovery 加 fresh direct Owner/consumer readback 才能推进状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RunTable`, `RunSummaryCard`, `RunMetadataAndInputs`                                                                     | operational status/date/path/trigger/principal/tag/duration、schema allowlist 限定的 immutable input、typed withheld count/reason、dependency kind 与显式 Owner‑outcome join；无 raw payload fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `DependencyCancellationPanel`                                                                                            | 只针对一个 queued dependency run 的固定 operational confirmation：run/kind/path、queued‑since、required executor compatibility、current `OperationalActionEnvelope` identity/expiry、显式空 domain‑effect set、no‑claim proof 与 receipt handoff target。唯一 effect button 为 `Cancel queued dependency`；CAS pending 显示 disabled `Cancelling…`；terminal transition 移除 A 与 header slot 3。Missing/expired/revoked capability、identity/version conflict、claim、terminal 或 unknown 会移除 effect，且不存在 batch、retry 或 domain cancellation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `OperationalCancellationReceiptCard`                                                                                     | 按精确 `run_id` 绑定的固定只读 P 位置；state 为 `none / pending / receipt / unavailable`。Receipt 显示 prior state/version、principal、authorization cut、transition time 与 immutable receipt locator。A 消失后仍保留，不暴露 effect button，也绝不改变或替代 Owner truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `RunDetailPanel`, `RunResultView`, `RunComparePanel`                                                                     | 固定 metadata/result/tab skeleton；schema allowlist 限定且按 sensitivity redacted 的 bounded result，viewport/copy/download 三者完全共用；Owner‑correlated receipt/result、实际 Artifact/PIT/runtime/simulator identity、diagnostic、invocation count 与 handoff；registry 缺失/mismatch 时 unavailable；无 Selection authority                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RunLogPanel`, `RunMetricPanel`, `RunTracePanel`, `RunAssetPanel`                                                        | 精确四 tab 顺序；collected/not‑collected/unavailable/empty 必须区分且保持相同几何                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CompactStatusBar`、`CompactStatusGroup`、`CompactStatusItem`、`DetailClusterGrid`、`DetailCluster`、`DetailClusterFact` | Workers 精确 skeleton：按序 title/value summary group 与 Lease/Activity/Last run/Capabilities 簇，尺寸与 unavailable 行为见上方契约。组合现有 `PanelFrame`、`SplitBento`、`DataTableSurface`、`DataWorkspaceTable`、`DetailInspector`、`DetailNotice`、`DetailEmpty`、`UnavailableState`；无独立色板或 worker administration。`WorkerGroupTabs` 及编造 heartbeat history 的 panel 不属于本次准入。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RunWorkerCompatibilityMatrix`                                                                                           | path‑bound `run_id`、required kind/tag/runtime/isolation、单一 projection observation cut，以及每个 candidate worker 的 registration/lease evidence。`ready`、`online / incompatible`、expired lease、missing registration 与 isolation unavailable 是不同 fail‑closed state；缺少精确 run binding 时绝不渲染该矩阵                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ServiceLogFilters`, `ServiceInstanceList`, `ServiceInstanceCard`, `ServiceLogPanel`                                     | time/service/instance/severity/search、精确 selected instance/source cut、host‑required empty state、auto‑scroll/refresh 与有界 download                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `AuditFilters`, `OperationAuditTable`, `AuditCorrelationCard`                                                            | principal/operation/outcome、exact target/correlation、redaction/retention；append‑only 且无 dismiss                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `TelemetryMatrix`, `SourceFrontierCard`, `TelemetryTimeline`                                                             | 每个 positive cell 必须绑定 Owner/source/cut、canonical fingerprint、observed/valid‑through time 与 loss/rebuild state；raw、stale、replayed、self‑asserted 或 identity‑conflicting input 只能 unavailable/stale/quarantined，且绝不继承上一次 success color                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `QualificationIntakeConflictPanel`                                                                                       | 固定 `RequestSemanticConflict` banner、immutable request/handoff identity、原 `NOT_ADMITTED` receipt link、redacted changed‑meaning summary、semantic fingerprint 与可选 Owner‑admitted successor action；绝不显示 protected replay value，也不让 changed meaning 复用旧 receipt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `QualificationPublicOutcome`                                                                                             | 仅终态 Owner‑produced lineage、稳定 attempt、N/A basis、checked nonempty interval、单调 expiry/revocation 与 late Time cut、半开 pending/current transition、sealed Qualification head frontier；`Admitted/Evaluating` 必须 projection failure 并让组件缺席，绝不能成为 `ClosedNotQualified`；无 protected‑detail slot、empty current Fact、dual‑current boundary、time rollback 或 client promotion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ScannerPublicReceiptIntegrityPanel`                                                                                     | exact Scanner Owner resolve operation、attempt identity、canonical terminal receipt identity/digest、source cut 与 direct‑read locator。Missing、caller‑constructed、本地重建、mismatch 或 unavailable resolution 把 panel 固定为 unavailable，移除 terminal row/count/badge 与全部 Matcher/Proposal projection，只暴露 Open source evidence、Copy locator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GovernanceEligibilityAdmissionPanel`                                                                                    | Governance admission 前的 exact Eligibility identity、interval/frontier、source cut、validation disposition 与 zero‑write proof。Invalid、expired、conflicting 或 unavailable Eligibility 不产生 Governance receipt、lifecycle row、outbox、Runtime handoff 或 successor action，只暴露 Open Eligibility evidence、Copy locator。后续 receipt‑backed Governance rejection 是互斥的 admitted branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GovernanceDecisionCard`                                                                                                 | 完整 contender frontier、canonical generation ordering、确定性 no‑write tie receipt、decision/action cut、source frontier 与 revalidation；缺少 direct Owner reread 时 unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RuntimeFoundationNotReadyCard`                                                                                          | 固定 non‑authoritative foundation state `NotReady`、source revision，以及四行有序 dependency：Governance authorized‑generation decision read、canonical Runtime custody、Artifact compatibility recovery read、Execution recovery frontier read。每行只有 Open dependency；footer 只有 Copy foundation locator。没有 instance/generation/receipt/checkpoint/recovery/application/action slot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `RuntimeReadinessCard`                                                                                                   | 未来 Owner‑backed exact generation 与 Strategy Instance identity、canonical readiness fact/receipt、observation cut、freshness 与 incident locator。只有 `RuntimeFoundationNotReadyCard` 获准时该组件缺席；CI、review、mergeability、merge tree 或 delivery receipt 不能填充其 field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RuntimeApplicationCard`                                                                                                 | 未来 generation、attempt、Strategy Instance、application receipt、reconciliation successor 与 restore validation；PR #330 下缺席，且绝不从 job/harness、foundation dependency list、CI/review/merge tree、delivery receipt 或弱于 live admission 的 snapshot 推断                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `MarketDataOwnerFoundationCard`                                                                                          | 固定 PR #331 maturity 与 source revision，只有两组有序 schema。Source Binding label 为 binding identity、fact digest、lineage root/version、outbox digest、observational `is_admitted` 与 locator；PIT Snapshot label 为 request identity/digest、snapshot identity/fact digest、已消费 Source Binding identity、lineage root/version、outbox digest、observational `is_available` 与 locator。没有单独准入的 product resolver 时，每行 value 固定为 `UNAVAILABLE_NO_PRODUCT_RESOLVER`；footer button 依次是 Open foundation evidence、Copy foundation locator。不存在 provider‑authentication、ingestion、payload、credential、database locator、writer、resolve、refresh‑canary、positive badge、row、timeline 或 mutation slot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `PortfolioViewUnavailableCard`                                                                                           | 固定 PR #332 source revision 与 schema `1`。Header slot 依次是 request identity/digest、projection time、valid‑through time、availability 与 disposition。Principal‑claim block 依次排列 claim identity、issuer、principal、account、Execution Scope、PAPER/LIVE mode、authorization‑policy cut、not‑before time 与 valid‑through time，并始终显示 caller‑supplied/untrusted badge。Dependency table 分三个 Owner group，严格含十一行：Execution account/open orders/fills/fees/settlement；Market Data price/FX/contract/valuation/liquidity；Portfolio snapshot。Column 依次是 kind、claimed Owner、locator、frontier、sequence、common cut、principal、account、Execution Scope、mode、authorization‑policy cut、observed time、valid‑through time 与 applicable structured failure。由于不存在 Dashboard consumer，所有 request‑bound slot 都显示 em dash，固定 `UNAVAILABLE_NO_DASHBOARD_CONSUMER` banner 位于 contract legend 前；绝不伪造 `UNAVAILABLE`、`INCOMPLETE_FAIL_CLOSED` 或 `STALE` response instance。Footer button 依次是 Open contract evidence、Copy contract locator。不存在 positive Account/Performance/Exposure/Gross Capacity/Attribution value、chart、table、timeline、filter、refresh、resolve、headroom、allocation、Risk、deployment 或 trading slot |
| `PortfolioViewRequestBindingBlock`                                                                                       | `PortfolioViewUnavailableCard` header 下方、principal‑claim block 前方的强制第一 child。Request‑side operand 独立依次排列 principal identity、account identity、Execution Scope identity、PAPER/LIVE mode、authorization‑policy cut 与 common‑cut identity。Claim 与 dependency block 都对照这六个 slot，使 principal‑claim mismatch、cross‑scope 与 mixed‑cut geometry 可精确绘制。没有 Dashboard consumer 时，每个 value 都是 em dash；该 block 不存在 trusted、matched、resolved、available、retry 或 action state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PortfolioViewFailureList`                                                                                               | read‑only 有序 failure vocabulary：`UNSUPPORTED_SCHEMA_VERSION`、`INVALID_FIELD`、`MISSING_DEPENDENCY`、`DUPLICATE_DEPENDENCY`、`CROSS_OWNER_DEPENDENCY`、`INVALID_FRONTIER_SEQUENCE`、`PRINCIPAL_CLAIM_MISMATCH`、`CROSS_SCOPE_DEPENDENCY`、`MIXED_CUT_DEPENDENCY`、`FUTURE_DATED_DEPENDENCY`、`STALE_DEPENDENCY`、`EXPIRED_REQUEST`、`EXPIRED_PRINCIPAL_CLAIM`、`VALIDITY_OUTLIVES_PRINCIPAL_CLAIM`、`VALIDITY_OUTLIVES_DEPENDENCY`、`CALLER_SUPPLIED_PRINCIPAL_CLAIM`、`CALLER_SUPPLIED_SOURCE_LOCATOR`、`SOURCE_OWNER_RESOLVE_UNAVAILABLE`。每项在存在时显示 typed field/kind/owner coordinate；没有 dismiss、override、retry 或 promotion action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `CapacityScopeCard`, `GrossCapacityView`, `CapacitySourceCompleteness`                                                   | account/mode/economic‑pool scope、candidate‑neutral gross ceiling、exact Execution/Market Data cut、availability 与 frontier；configuration authority 未解决时固定为 `INCOMPLETE_FAIL_CLOSED`，明确缺失的 Owner/fact/state‑machine stop predicate，不展示正向 BOUND badge 或 action；没有 usage、headroom、Reservation、allocation 或 permit field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RiskDecisionTable`, `ReservationLiabilityCard`, `ClaimAndAdmissionTable`                                                | terminal decision lineage、one‑use Reservation state、stable claim/admission result、完整 rejection set 与 exact linked effect；legacy forwarded command 没有 row shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `AggregateFrontierCard`, `FenceSetAndFrontier`                                                                           | 单一 Risk‑owned Capacity Scope frontier、held liability、immutable fence‑set membership 与 transaction ordering；无 Portfolio write 或 UI release action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `WorkerCard`, `WorkerTable`, `ScheduleCard`                                                                              | operational state 与 business state 分离；无通用 worker administration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `FenceBanner`, `UnknownEffectBanner`, `ReconciliationPanel`                                                              | 持久 safety surface 与 locator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `NotAdmittedNotice`                                                                                                      | unavailable capability 与升级所需 evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

组件在可能时覆盖 loading、empty、partial、stale、unavailable、error 与 permission denied。Domain component
还覆盖 identity conflict 与 missing receipt。Story fixture 不是验收证据。

## CSS token 与调色板继承

CSS 使用四层。Component 只能消费 semantic 或 component token。

```text
raw palette -> semantic role -> component alias -> state modifier
neutral-950 -> text-primary -> panel-text -> [data-state="unavailable"]
```

Raw name 描述颜色；semantic role 描述含义；component alias 隔离组件变化；state modifier 选择 semantic
role，不能引入 literal color。

### 核心 theme token

| Semantic token         | Light                 | Dark target | 消费者                                       |
| ---------------------- | --------------------- | ----------- | -------------------------------------------- |
| `--surface-page`       | `oklch(0.92 0.01 85)` | `#111411`   | viewport                                     |
| `--surface-panel`      | `#f2f2f2`             | `#181c19`   | `PanelFrame`                                 |
| `--surface-card`       | `#ffffff`             | `#202521`   | card/panel body                              |
| `--surface-elevated`   | `#ffffff`             | `#272d28`   | menu/drawer/dialog                           |
| `--surface-hover`      | `#f7f5f1`             | `#2d342e`   | hover                                        |
| `--text-primary`       | `#1a1a1a`             | `#f1f4f1`   | heading/value                                |
| `--text-muted`         | `#5a5a5a`             | `#a7b0aa`   | label/hint                                   |
| `--border-default`     | `#e0ddd8`             | `#343c36`   | card/input/separator                         |
| `--nav-active`         | `#2d2d2d`             | `#f1f4f1`   | active rail/tab                              |
| `--nav-active-text`    | `#ffffff`             | `#171b18`   | active icon/text                             |
| `--focus-ring`         | `#3b82f6`             | `#60a5fa`   | keyboard focus                               |
| `--status-positive`    | `#0b8c5f`             | `#58ceaa`   | available/success，绝不表示 market direction |
| `--status-negative`    | `#cf304a`             | `#f87171`   | rejected/failure/incident                    |
| `--status-warning`     | `#f59e0b`             | `#fbbf24`   | pending/stale/unknown                        |
| `--status-info`        | `#3b82f6`             | `#60a5fa`   | information                                  |
| `--status-protected`   | `#8b5cf6`             | `#a78bfa`   | protected/opaque                             |
| `--status-unavailable` | `#76808e`             | `#9ca3af`   | unavailable/not observed                     |

Dark value 是 `TARGET`，不是参考项目已实现完整 dark theme 的证据。首个实现必须测试两个 theme 后才能
声称 parity。Market direction 使用独立且 locale-aware 的 `--market-up`、`--market-flat`、`--market-down`，
绝不能 alias 业务 success/failure。Chart 还要用 sign、label 或 glyph 重复方向。

`S1TerminalCustodyPanel [data-state="stale"]` 只把 warning style 应用于 currentness row：
`border-inline-start: 3px solid var(--status-warning)`，背景为
`background: color-mix(in oklab, var(--status-warning) 8%, var(--surface-card))`，state icon 与 `STALE` label 同样消费
`--status-warning`。Verified receipt 与 TrialFamily evidence row 继续继承 `--surface-card`、
`--text-primary`、`--border-default`，不出现 positive wrapper。Terminal custody 缺失或 cross-bound 时，整个
fixed geometry 切换为 `--status-unavailable`，不能复用 stale style。

### Component、geometry 与 motion token

- Card 从 semantic role 派生 `--card-bg`、`--card-border`、`--card-radius: 12px` 与 `--card-shadow`。
- Panel 派生 `--panel-frame-bg`、`--panel-body-bg` 与 `--panel-radius: 20px`。
- Heavy navigation glass 使用 40 px blur、40% surface alpha、60% light border 与柔和 8/32 shadow；light
  glass 使用 4 px blur 与 60% surface alpha。只有 rail/tab/tape/tooltip/transient overlay 使用 glass。
- Spacing 使用 4、8、12、16、24、32、48 px；Bento gap 16 px。Radius 是 6、8、12、16、20 px，再到 full capsule。
- UI 字体为 Inter；identity、digest、timestamp、tabular value 使用 JetBrains Mono/平台 mono。Panel label
  10 px uppercase，body/value 11 px，card title 14 px，page title 24-32 px。
- 普通 transition 为 150-200 ms。Status/receipt/numeric update 不动画穿过误导值；
  `prefers-reduced-motion` 移除非必要 motion 与连续 tape movement。
- Elevation 只有 `base`、`raised`、`overlay`、`modal` 命名层级；禁止任意 shadow。

## 交互、响应式与可访问性规则

- Keyboard 顺序是 rail、tape、tab、page control、content、detail drawer。
- Icon-only control 有 accessible name；focus 可见；overlay trap/restore focus。
- State 必须有 text，并可结合 icon/color；禁止 color-only。
- `PREFLIGHTING` 与 `ADMITTING` 使用 amber pending text，并分别显示 `Checking…` 与 `Submitting…`；
  `ADMITTED` 使用 `--status-info` blue，绝不使用 green。只有 Owner terminal receipt 才能使用 semantic success。
- Admission-state text 通过 polite live region 暴露；持续 unknown/unavailable transition 使用 alert announcement。
  Spinner、motion、color 或 operationally green job 都不能成为唯一状态信号。
- Identity 在组件内 wrap/scroll，并提供 copy action。
- Table 保留 header、unit、sort、source cut、pagination；大数据/log view 需要 virtualization。
- `>=1280 px` 使用完整 shell 与 multi-column grid；`768-1279 px` 折叠 span；`<768 px` 使用 navigation drawer、
  full-screen detail 与明确 card/horizontal table representation。
- 小 viewport 不能隐藏 incident、unknown effect、active fence、next legal action 或 unavailable state。
- Optimistic UI 可以显示 delivery progress，但 receipt 前不能显示 Owner terminal。

## 服务与数据边界

Dashboard service 只拥有 route/presentation state、本地 session/capability projection、versioned operation
descriptor、disposable run/worker/progress/result/log projection、有界 service log、append-only control-plane
audit、带 frontier/lag 的可重建 read cache，以及 notification presentation/delivery acknowledgement。

它不拥有 authorization lineage。`AuthorizationAdmissionGateway` 是调用三个 canonical port 的 typed Product
Edge orchestrator：deployment binding/history readback、带 Time Evidence 与 revocation frontier 的受信 Operator
Authorization resolve，以及 content‑addressed operation-manifest retrieval。它只可在 record valid-through cut
内缓存有界 positive/negative projection；cache loss 不改变 authority，cache hit 也不能跳过提交时的 atomic
admission reread。Missing、stale、expired、revoked、ambiguous、self-asserted、locally configured 或互相不一致的
input 必须返回 non‑admitted envelope 且 Owner 零写入。Dashboard 不提供创建、编辑、签名、续期、选择替代项或
强制激活这些 record 的 endpoint。

后台 authority TARGET 仍需要 Operator Authorization Owner 为既有 scope 提供 append-only successor issuance
operation。它必须绑定 prior authorization identity 与 sequence，保持同一 canonical
principal/audience/permission scope，追加新的 validity 与 receipt，并让 changed-scope 或 duplicate-sequence
request conflict。Admission 第一次 downstream mutation 前，只有 original binding 或一个 immediate successor
可以提供 current-policy evidence；即使每一环都等价，chain distance 大于一也必须 fail closed。
`AuthorizationSuccessorReadiness` 可以解析并显示该 Owner fact 与 distance，但 Dashboard BFF 绝不调用 issuance
或遍历到更晚的 head。Canonical Owner API、direct-successor enforcement 与 PostgreSQL evidence 存在前，
expired-history recovery 是 `NOT_ADMITTED`，所有依赖它的 Product Edge claim 都 unavailable。

被观察 candidate 证明三个必须独立渲染的 readiness stage：Operator Authorization custody、Product Edge current
binding/admission custody，以及 Product Edge-to-R&D downstream seam。OA 与 PE genesis 可以同时 canonical
resolve，Product Edge 也能原子提交 admission 与 outbox，但 R&D 仍可能无法在自己的 mutation transaction 内消费
该 admission。Dashboard 因此保留两张 sealed OA/PE receipt，并单独渲染 downstream seam；绝不能把缺失的 R&D
receipt 折叠为输入拒绝。

后台目标合同是 `ProductEdgeDownstreamAdmissionResolverV1`：一个 Product Edge-owned hardened port，由 R&D
在自己的物理 PostgreSQL transaction 内调用。其 SQL 边界只用 non-locking normalized hint 构造完整且有界的 OA
locator plan，先取得排序去重后的全部 OA shared lock，再锁定完整 Product Edge
binding/history/head/supersession/manifest/admission/receipt/outbox 集合，并返回带 provenance 的 read-only
envelope，不返回 table handle。SQL 不作 business admission、不写事实，也不构造 sealed authority。Product Edge
Rust 边界复用 OA 明确标为 non-authoritative 的 canonical-envelope parser，完整验证 OA/PE
row/digest/receipt/outbox/cross-binding 集合，并且只有它能通过私有 constructor 构造不可 Deserialize、可供 R&D
消费的 sealed downstream admission readback。hint cut 后出现变更或新增 locator 时必须中止整个 transaction；取得
任一 PE lock 后不得再取得新的 OA lock。R&D 只获得 schema usage 与该函数的 exact execute；PUBLIC 和无关 Owner
都没有权限。独立 Product Edge connection、unlocked read、R&D 直接 OA 权限、消费 raw SQL envelope 或
Dashboard/BFF reconstruction 都不能满足此合同，因为它们会破坏 lock cut 或 Owner boundary。在这两层及其
migration/ACL 获得动态准入前，seam 仍为后台 `NOT_ADMITTED`，BFF 返回带精确 stop predicate 的
`partial/unavailable`，S2/provider effect 保持零。

它绝不直接查询 Owner table。类型化 Dashboard API/BFF 调用 public Owner/Product Edge port，并返回
`available`、`stale`、`partial`、`unavailable`、`unknown`、`rejected`、`terminal` discriminated envelope。
每个 cache entry 携带 source identity/cut、projection version、observed time、expiry 与 rebuild path。删除
Dashboard 或 job storage 不会改变业务事实。

R&D S1 V2 具有 two-stage mutation boundary。创建新的 Independence Basis 使用 `FirstMutation`，因此要求
current Product Edge authority。basis receipt、basis head 与 Owner outbox 提交后，R&D-owned stage resolver
canonical verify 其准确 request、完整 typed request meaning、original admission、digest 与 commit cut。
Qualification 和 terminal Research receipt 仍缺失时，它返回 sealed
`SEALED_BASIS_PENDING_QUALIFICATION` custody。Public same-identity `resolve_v2` entrypoint 不接收 caller request
bytes，而是消费该 custody，并让第二笔 transaction 使用 `Historical` completion semantics；terminal-only
receipt lookup 不是 resolver。普通 row 存在不能构造该 custody；duplicate basis/head/outbox write 被禁止，
changed request 或 admission 必须 conflict。若 Qualification 在 response loss 前已提交并随后 stale，恢复需要
Qualification Owner 发布 canonically linked renewal/successor（或等价 typed recovery fact），再做 fresh locked
readback。R&D、Product Edge、Dashboard 与 caller 都不能延长其 validity。Dashboard/BFF 只能显示这些 sealed
projection，绝不能铸造它们或用 current authority 替代 historical completion。

R&D S1 V2 的一个 typed envelope 组合 request receipt、Research View、TrialFamily root receipt、
INTENT-membership receipt 与 direct R&D Owner readback 返回的 Census frontier。Terminalization 前，任一
prerequisite 缺失、损坏、stale 或语义不一致都必须是 `unavailable`。全部 terminal part 经过 direct 与
cross-binding verification 后，linked-view 后续 expiry 必须在独立 `terminal/stale` envelope 中保留完整历史
`ACCEPTED` receipt/family，并移除全部 positive action；绝不能返回 receipt-less unknown。S2 的
`SUCCESS` 要求同一 Owner transaction 返回 Artifact、Build Receipt、Artifact Review、
Artifact-to-TrialFamily binding receipt 与 bound Census frontier。BFF 暴露相互独立的 same-identity request
与 build-attempt resolve operation；二者都不能派发 replacement job，也不能从 caller-provided identifier
推导 family。

Replay action admission 必须消费完整的 selected S2 Owner projection，并针对 Replay request 验证每个必需的
identity、receipt/binding、locator、availability 与 currentness 字段。`selectedS2Available` 之类的 UI/display
boolean 只能描述派生的展示状态，绝不能授权 `RUN` 或替代 Owner projection。Projection missing、malformed、
mismatched、stale 或 unavailable 时必须禁用 `RUN`，且 Replay dispatch 与 business write 均为零。

S1 chain 首先完成纯 V2 validation。Invalid input 只可提交一张独立 rejection receipt；independence basis、
Qualification projection、Research receipt、Intent、family、member、head 与 outbox 必须零写入。只有由此产生的
opaque validated marker 可以进入 positive formation。随后 R&D 写入或复用 write-once basis fact；Qualification
解析该精确 basis 并发布或复用 opaque protected-feedback frontier；Product Edge 只携带二者 reference/cut。
最终 `scope -> request` locked transaction 中，R&D 在任何 Research/family 写入前重新读取两个 Owner fact 与
完整本地 lineage。

Qualification physical custody 是独立 Owner boundary。独立 `qualification_owner` 拥有 Qualification table、
sequence 与 writer role；`rd_owner` 对它们没有 ownership、raw `SELECT` 或 `INSERT/UPDATE/DELETE` 权限。R&D
只能在调用方 transaction 内获得精确 `EXECUTE` 权限，调用一个由 Qualification 拥有、范围窄化的
`SECURITY DEFINER` locked
resolver/admission function。该函数使用固定安全 `search_path`、全限定 relation 与既有全局 lock order，只返回
raw canonical envelope。只有 Qualification-owned Rust 可以验证该 envelope 并构造 sealed、不可
`Deserialize` 的 positive readback；不存在 public raw-envelope-to-positive constructor。

final mutation cut 只能在取得全部 OA、Product Edge、Qualification canonical lock 并完成最后一次
Qualification reread 后采样。OA authorization、Product Edge binding/manifest 与 Qualification half-open
validity 必须在该精确 cut 重新验证，并在首次写入前把同一个 cut 绑定到 identity 与 receipt。等待期间过期必须
零写入。对于已经提交 Product Edge admission 但尚无 R&D receipt 的请求，即使 policy-equivalent successor 已
`ACTIVE`，仍可针对其精确原 canonical binding 执行 FirstMutation，但 final cut 必须具有 current authorization
与精确 stored lineage。新 admission 仍要求 current `ACTIVE` head，并遵守 zero-active fence。

Lineage discovery 绝不能把 unverified JSON field 用作 SQL selector。它在 scope lock 下枚举该 scope 的每张
receipt row，通过同一个 central kernel 对每行 canonical decode 与 custody verification，再从 verified fact
中 filter。任一 row corrupt、missing、stale 或 unavailable，结果必须是非正向 `SUBMITTED_OR_UNKNOWN`；不得
跳过它而创建 `GENESIS_EMPTY`。Lineage 推进后 exact request replay 复用原 basis/receipts，不能根据当前 caller
data 重新计算 authority。

Qualification 对自己的 authority history 采用同样的穷尽规则。在 Owner lock 下枚举每个受支持的
protected-feedback projection/outbox row，canonical verify 完整 stored meaning，最后才按 exact R&D basis
filter。只有完全验证后的历史为空时才能准入 `GENESIS_EMPTY`；missing head、orphan projection/outbox、malformed
representation、ambiguous decoder 或 unavailable read 必须返回 `unknown/unavailable`，且只允许 exact-basis
Resolve。不得根据 absence 创建或修复 positive head。

Positive TrialFamily root/member/head/frontier graph 是 sealed direct R&D Owner output。Public deserialization、
caller construction、browser reconstruction 或 shared DTO 即使字节看似 canonical，也不能创建 admitted graph。
Dashboard 只接受 typed Owner projection，否则必须把 authority panel 渲染为 unavailable。

Stored Research history 保持 immutable；freshness 与唯一下一合法动作在每次 direct read 时由 R&D Owner
投影。Dashboard/BFF 不能跨 `valid_through` 缓存之前的 positive action：`now >= valid_through` 时 envelope 为
`STALE`、不含 positive action，只准入 same-identity Resolve。
该规则是端到端 transition invariant，不只是 disabled button：prepare、candidate 与 fail 必须在同一个
locked transaction 内、创建 attempt 或执行任何 Prepared-to-Building/terminal transition 前证明 Owner-cut
`AVAILABLE` Research View。Server-proven `STALE` 或 dispatch 前 `UNAVAILABLE` path 必须产生零业务写入。
`SUBMITTED_OR_UNKNOWN` 表示 effect boundary 已跨过且 write outcome unknown；它只能暴露 exact-identity
resolution，绝不能声称零写、返回 preflight 或 dispatch retry。Recovered canonical Prepared custody 是独立状态。
write-admission cut 只能在取得 custody lock、完成 canonical custody read 后，于首个 protected write 前紧邻
采样；pre-lock、request 或 response-projection timestamp 不能授权写入。等待锁期间跨过 `valid_through` 必须
进入 non-positive zero-write path。S2 no-Artifact envelope 只接受 Owner-verified
canonical receipt identity，必须绑定 attempt、Intent、disposition、failure code 与 commit time；
failure-code-to-disposition mapping 独立校验，绝不能从 caller/receipt 字段重建。任何 mismatch 都是
`unavailable`，不是 terminal failure badge。

TrialFamily 的 available 状态还要求所有重复 PostgreSQL relation 字段 - family/member/head/binding/outbox
identity、member ordinal 与 fact identity、digest、committed time - 逐一匹配已验证 canonical representation。
局部比较不能渲染 `ACCEPTED`、`AVAILABLE`、review action 或绿色 receipt panel；mismatch 或 unreadable custody
必须转为 `unavailable`，且没有 write-capable action。

Positive binding resolution 必须在一个 protected custody cut 内读取并验证 canonical binding、receipt、
family/frontier 与 outbox，并锁定 binding row 防止并发 mutation。之前读取的 READ COMMITTED snapshot 不能在
另一个 transaction 改变 custody 后继续保持 positive；未解决的 lock/mutation state 是 `unavailable`，只有
canonical restoration 后新的 exact direct read 才能恢复 availability。
Binding receipt identity 必须覆盖完整 receipt meaning，包括独立权威的 `committed_at` cut；协调修改
canonical/relational timestamp 必须改变 identity 或 fail closed。

Artifact custody discovery 不能用 raw JSON selector、discriminator 或 caller predicate 决定哪些 binding、
receipt、family/frontier 或 outbox row 值得验证。它必须先在 custody lock 下枚举 bounded candidate row，
canonical decode 并验证每种受支持 representation，最后才应用 verified predicate。Missing、malformed、
ambiguous 或 selector-only custody 必须是 `unavailable`，绝不能成为 partial Artifact success 或 review action。

Legacy Portfolio Cache snapshot 与 legacy Risk command/denial event 只能进入单独标记的
`MigrationDiagnostic` envelope。该 envelope 没有 Owner locator，不能满足 canonical page query，不能加入
Capacity/Risk summary，也不暴露 action。Portfolio/Risk canonical route 在 Owner-local store 与 direct typed
resolver 存在前保持 `unavailable`。

BFF 可以携带共享 untrusted fact-reference vocabulary 与 canonical framing，但不拥有 cross-Owner proof service。
它把每个 reference 路由到指定 source Owner 的 typed resolve operation；只有该 Owner durable store/outbox 的
重读才能向消费者返回 crate-private admitted projection。Resolve port 缺失、canonical-byte mismatch 或 Owner
storage unavailable 都返回 `unavailable`，并禁用 elevation/action。

当前没有准入任何 `DeploymentConfigurationAuthority` service。System/live configuration、routing map、Cache、
environment variable 与 Settings form 都只是 transport 或 installation mechanism，不是能建立 `PORT_BOUND` 的
唯一 Owner fact。Dashboard 可以显示这些机制的 redacted opaque reference；但在文档明确指定一个 Owner、
canonical fact identity、lifecycle/state machine、typed resolver 与 reread rule 前，BFF 必须返回
`CONFIG_AUTHORITY_UNRESOLVED / INCOMPLETE_FAIL_CLOSED`，也不能从多份配置值一致推断权威。

可视化 UI 与 MCP 消费同一 operation registry 与 policy compiler：exact version、schema、capability、Owner
route、timeout class、recovery identity field 与允许的 operational read。Operational implementation 拆成
`RunStore`、`Dispatcher`、`WorkerLeaseStore`、`BoundedRunLogStore`、`ServiceLogGateway` 与
`OperationAuditStore`；它们都不能暴露或修改 Owner payload table。任何 channel 都不能得到 workspace
management、deployment、preview、arbitrary script、database、shell、worker administration、object storage 或
secret-management tool。

每个 registry operation 还具有 `available`、`archived` 或 `unavailable` deployment state，并由一个
content-addressed compatibility envelope 支撑。该 envelope 绑定 operation/schema/effect set、required service
与 image digest、App 与 script-lock hash、Owner API/schema version、channel、source identity 与 observation cut。
它可以有意组合多个 service artifact；available 要求 observed component set 与这一个 envelope 完全一致，而
不能只因它们共享 Compose project、报告 healthy 或 source text 相似。Mixed config-file source、缺少 App/script
hash，或任意 expected/observed mismatch，都必须把 operation 渲染为 unavailable 并显示准确 failed predicate。
`archived` 从 UI 与 MCP 移除 dispatch 和 domain mutation action，同时保留 route geometry、capability identity 与
Owner-linked historical run 的只读访问。只有外部完成的 version-matched deployment 加 consumer revalidation
才能恢复为 `available`；Dashboard 绝不创建 envelope、执行 archive/restore，也不因 source code 或历史 run
存在而推断 available。

## 打包与部署目标

Dashboard 随 Trade image set 交付，成为默认 visual entry 与 control surface。它必须 pin frontend dependency；
产出 content-addressed artifact；使用 unprivileged process 与 read‑only filesystem，只给明确 cache 写权限；
暴露 process readiness 但不冒充 Owner/trading health；运行时接收 endpoint 与 opaque secret reference；阻止
credential 进入 image、HTML、bundle、URL、log、telemetry、error；保持 Owner store/credential 分离；并包含
asset manifest、provenance、compatibility declaration 与 route smoke test。

迁移中 Windmill 与 Dashboard 可以共存，但禁止双 business writer。Cutover 以消费者为准：每条已准入
Windmill Web/MCP journey 都要通过新 Dashboard/registry，得到相同 Owner receipt 与 fail-close 行为。只有
parity、cache-loss recovery 与 artifact custody 证明后，才能在独立可逆 cleanup 中移除 Windmill。

## 无人值守实现顺序

后台依赖波次是 `TARGET_DRAFT` development-custody 约束，不授权 Dashboard 实现。PR #327 已在独立
exact-head review 与 repository gate 后，把 F1 read-only Observability source projection 合并为
`CURRENT/PARTIAL`；其真实 Owner canonical-outbox adapter、telemetry backend、runtime/default-Windmill
consumer 与全部 Dashboard implementation 仍 unavailable 或 `NOT_ADMITTED`。PR #332 另行用
`CURRENT/PARTIAL` fail-closed public request/unavailable-envelope contract 取代计划中的 Portfolio static Scope
skeleton；它仍不暴露 direct-source composition、positive readback、`PORT_BOUND`、Dashboard consumer 或 effect。
Hub acceptance 后第一逻辑 W1 波次严格是五个并行 leaf：**Market Data Binding**、**Execution Binding**、
**Portfolio Scope fail-close skeleton**、**Risk-Execution edge-break** 与 **GR0 Governance-Runtime Sealed Read
Seams**。GR0 只修改两个既有 Owner crate，暴露 concrete sealed read seam；不创建 shared crate，也不修改
root workspace file。Edge-break 是五文件、zero-lock 的机械前驱：把 trailing algorithm 下沉到 Model，
Execution 保留 compatibility re-export，并把 Risk 的 Execution dependency 降为 dev-only；冻结前不能启动 Risk
Core。Market Data fact 后继于 Market Data Binding；Execution Sandbox descriptor 后继于 Execution Binding，
绝不能由同一个 leaf writer 同时实现。不存在 dependency-prewire Task：每个 leaf
只有在真实源码 import exact public API 时，才向自己的 package manifest 增加 Owner-evidence dependency。叶
Task 禁止修改 root `Cargo.toml`、`Cargo.lock` 或 `Makefile`；五个 head 全部冻结后，只能由唯一 **GR1
root/lock/testkit fan-in** 创建 read‑only relation crate、更新 lock/root inventory 并运行完整 locked gate。缺少冻结
predecessor、typed public port 或 exact Task identity 时，受影响 Dashboard projection 保持 `unavailable`，
无人值守 agent 不得自行发明依赖。

1. **Foundations** - token、theme、shell、route、navigation、responsive、accessibility、component catalog。
2. **Read-only projections** - typed BFF、stamp、Overview、identity search、stale/partial/unavailable 行为。
3. **R&D S1 replacement** - sourced request、TrialFamily policy、receipt、Research View、direct root/member/frontier
   readback、next action、reject-no-write、conflict、unknown 与 same-identity resolve。
4. **R&D S2 replacement** - bounded build job、Artifact/Build Receipt/Review、deterministic build evidence、
   direct Artifact-family binding/frontier readback、action admission、no-Artifact failure、restart recovery 与
   App/MCP parity。
5. **Exploratory replay replacement** - 只在 S3 merge 并独立重验后实现；保留独立 R&D/Backtest receipt 与
   `NOT_ADMITTED` economic claim。
6. **Operations** - worker lease；只给已准入消费者增加 schedule；job/progress/log view；disposable cache
   deletion、restart、Owner-based recovery。
7. **Portfolio projections** - PR #332 只准入 deterministic request/replay validation 与 structured
   unavailable envelope。在 private Execution、Market Data、Portfolio direct-source resolver 及其 composition
   分别准入前，四个 route 都渲染 `PortfolioViewUnavailableCard`，不暴露 request-bound value。后续 positive
   阶段只能从 sealed Owner readback contract 开始，并以真实 Dashboard consumer 单独准入为前提；绝不能从
   caller claim、legacy Cache snapshot 或 unavailable envelope 推断 `PORT_BOUND`、Account、Performance、
   Exposure、Gross Capacity、Attribution、Risk、usage 或 headroom。
8. **Risk projections** - 在 Portfolio fact 就绪并移除 Risk-to-Execution 生产依赖后，只从 Risk-owned fact
   增加 Decisions、Reservations、Claims & Admission、Aggregate Frontier 与 Fences。Legacy forwarded command
   与 denial 保持 migration diagnostic。
9. **Remaining domain views** - 按 side-menu 顺序并遵守当前 Owner disclosure contract；单独准入前无修改。
10. **Image integration and cutover** - provenance、packaging、migration parity、rollback，最后才是单独授权的
    Windmill retirement。

每个切片运行 component/accessibility、route/responsive、typed-contract、negative/unknown test、真实 Owner
journey、适用时 App/MCP parity、cache-loss/restart recovery、仓库 docs/root gate 与完整 diff 检查。Screenshot
和 mock 不能替代真实消费者。

## 非目标与停止条件

Dashboard 不是 notebook、code IDE、通用 automation builder、observability backend、data warehouse、secret
manager、business database、broker、exchange terminal 或 autonomous trading authority，也不重建完整 Windmill。

若实现需要第二 business writer、直接 Owner-table write、隐藏 protected detail、伪造 freshness、无 receipt
success、宽管理工具、unresolved effect、不可用的当前 Owner contract，或修改已记录顶层 authority，则停止。
顶层架构变化必须先获得明确用户授权，才能继续修改代码或文档。
