---
title: RD Replay Execution Plane Design
updated_at: 2026-07-16 CST
status: implemented-vertical-slice
---

# RD Replay Execution Plane Design

## 1. 结论与边界

Replay Execution Plane 是 **冻结实验的确定性执行与历史证据生产面**，不是研究决策面，也不是实盘执行面。它只做一件事：把 Research Control Plane 已冻结的 Trial，连同不可变 Experiment Contract、Candidate Identity、Dataset Manifest 与模拟政策，执行成可复读的事件链、统一账本和 Result Artifact。

当前成熟度判断：**M2 / 5，已认证的受限纵切**。Control Plane authority、provider certification registry/termination、Reservation/Attempt cancellation/fencing、local durable Artifact/cancellation outbox、checkpoint resume、Dataset Manifest v10、supplemental PIT Snapshot、PIT instrument status/provenance、Market Data immutable status archive/provider、current-status acquisition receipt、closed-candle/next-open、简单 bracket、EventKey、average-cost Position、Cash Ledger、Equity v1、Journal v4 与 isolated Margin v7 已贯通。Request v24 / Schedule v5 允许 pre-entry `no_action`、唯一 entry、position-open `no_action*`，并在互斥分支中选择至多一次 full-position stop tighten 或一次 fixed-quantity partial reduce；partial 后可追加一次末位 full exit。Result v36、Artifact v38、Run Outcome v35 与 Fingerprint 同时绑定 status schedule、provenance、provider capability 和 Control Plane certification receipt；clean/resume 哈希一致。该纵切仍不支持 venue 历史 archive 自动采集/签名/外部穷尽审计、remote cancellation outbox/transport/latency SLA、multiple partial、真实 liquidity partial、通用 cancel/amend、OS sandbox、remote adapter、停牌结算、cross/shared portfolio、tick/L2、generic matching 或 step/fast parity，因此不升到 M3。

R4.41 已将首条 partial reduce 边界收敛为**非可执行 draft**，但不改变上述成熟度。Draft 只允许一次小于初始仓位的 fixed-quantity market reduce-only；partial Fill 必须留下 open Position，然后在无 SourceEvent 插入的同一 boundary 取消当前 stop/target，按 `abs(post-fill position)` 保留原 trigger 价重建全量双保护。首版 draft 禁止与 stop replacement 组合，允许后续 final full exit。该 schema/capability 未进入 Request v20、Schedule v4 或 certified set；Runner 必须在 Engine 前拒绝它，故当前仍不得声称 partial strategy reduction 已实现。

R4.42 已将该 seam 升为**可执行且受限认证**。Partial Reduce Intent v1 必须 opposite-side、market、reduce-only、increment-aligned fixed quantity，并严格留下 open Position；Schedule v5 只允许一次且拒绝与 stop replacement 组合。partial fee/realized PnL、剩余 unrealized PnL、事件时 Funding、Margin 和下一次 State Snapshot v3 共用同一 Position/Ledger；terminal owner 在 executable open 前发生时取消 pending partial。该能力是确定性全成 fixed quantity，不代表历史委托簿的 partial liquidity。

R4.43 不增加新 capability，而是认证 partial Fill **之后**的唯一终态所有权：重建 stop、重建 target、exact-risk liquidation、EOD 与已认证 final strategy exit 均读取同一剩余 Position/current bracket；前三类全平，EOD 仅 mark open Position 且不造 Fill。Engine Checkpoint v15 将保护 trigger/order identity、Intent/Fill、Order 与最后 OrderEvent、全局 event sequence 纳入恢复时语义校验，故重算自哈希不能把伪造 protection 恢复成权威状态。该阶段证明模型内组合闭包，不证明真实成交队列、partial liquidation 或 multiple partial。

R4.44 不改变 Simulator v8 的经济执行语义，而将既有 simple-bracket OHLCV 保守规则提升为机器可审计证据。每次 stop/target 终止均生成自哈希 Resolution Evidence v1：绑定 source EventKey、bar、active bracket、P1/P2 outcome/path digest、canonical path 与 selection policy；open gap 和单触点为 `exact_under_ohlc`，双触点为 `resolution_limited / stop_target_order_ambiguous`，canonical 取 stop path。Result v31/Fingerprint/Artifact v33 独立绑定证据集合，Runner 幂等复读重验内容。该阶段只证明 two-path simple-bracket envelope，不证明真实 intrabar path，也不开放 limit queue 或通用多订单 resolver。

R4.45 不增加 production schema/version/capability，而用 certification-only `OHLCV Oracle Fixture v1` 检验该包络。8 条有序价格轨迹覆盖 long/short open gap、single touch、collision high-first/low-first；oracle 只按 synthetic piecewise-linear observations 的已知顺序取首个 bracket crossing。实际 outcome 必须落入 P1/P2 对应 path，canonical raw terminal PnL 不得优于实际 path；同一 OHLC 的两种极值顺序产生相反 owner，却必须得到同一 `resolution_limited` envelope。分段内加密采样不改变 bar、terminal outcome 或 evidence semantics。该结论是 simple-bracket envelope soundness，不是 tick runtime、真实成交 reconstruction 或 completeness proof。

R4.46 不改变 Simulator v8 经济语义，而修复“证据只记 trigger、未证明使用哪一代保护单”的 identity 缺口。OHLCV Resolution Evidence v2 内嵌 active protection：初始 stop/target 为 generation 1；已认证的 stop replacement 或 partial resize 原子完成后为 generation 2；同时绑定剩余数量、两个 Order id/trigger 与 protection hash。Checkpoint v16 保存并按 Schedule/Timeline/OrderEvent 重验 generation；Result v32/Artifact v34/Run Outcome v29 在发布和复读时把证据与 SourceEvent、保护单生命周期及 terminal Fill 交叉核对。v2 只认证当前互斥的一次 mutation，不预先规定多次 amend/resize 的长期上限或组合语义。

R4.47 不改变 Simulator v8 canonical Fill，而为每条 admissible path 增加确定性 terminal economics。Evidence v3 使用实际 entry Fill 价、当前保护数量、冻结 cost policy 与 instrument increments，计算 path execution price、gross realized PnL、exit fee、net terminal contribution，并输出 min/max/span/canonical shortfall；Result v33 Metrics 只聚合该敏感度。scope 明示排除所有 path 共同的 entry fee、funding、既有 partial cashflow，因此不能称为完整账户 equity interval，也不赋予路径概率。Artifact v35/Run Outcome v30 在首次发布与复读时重算，canonical path price/fee 必须等于实际 terminal Fill。

R4.48 不推进 production wire epoch，而以独立经济 oracle 认证 R4.47。Certification-local `Economic Oracle Fixture v1` 冻结 zero-cost、cost-aware fine-grid、fractional-bps coarse-grid 三套 quantity/cost/increment profile；test oracle 仅用本地 BigInt 有理数实现 buy-ceil/sell-floor 滑点价、signed PnL floor、fee ceil 与精确净额，不导入 Replay accounting/decimal 原语。24 个 profile×trace case 的两条 path、ordered actual path、min/max/span/canonical shortfall 均须与 Evidence v3 一致；long/short collision 手算 golden 和轨迹加密采样 metamorphic 另行锁定。它证明当前 simple-bracket terminal contribution 算术的实现独立 parity，不证明真实成交成本、路径概率、完整 equity interval 或跨语言一致性。

R4.49 继续不推进 production wire epoch，而把 R4.48 集成经济链扩展到 Python `Decimal` 跨语言 oracle。Certification-only Request/Response v1 只经 stdin/stdout 传 canonical decimal string；Python 独立执行滑点、price tick、signed gross、fee、settlement increment 与 net，不导入 TypeScript 实现。Bun 测试通过仓库 Python resolver 调用它，要求 48 条 path 的 execution price/gross/fee/net 与 test-local BigInt、production Evidence 三方逐字符串一致，并锁定非规范 decimal 的 typed `input_invalid`。这证明当前 fixture 范围内的跨语言十进制算术 parity，不把 Python 变成 Replay backend，也不证明不同 JS runtime、平台浮点、完整 Result 或真实 venue 成本可移植。

R4.50 冻结**执行相关时间网格缺失协议**。连续且完整的相邻 bar 若下一根 open 跳价，仍是 observed price gap，按 `worse_open` 执行；若 expected interval 上整根 bar 不存在，则没有可执行价格事实，禁止 synthetic bar、forward-fill 或跨越未知区间。冻结 earliest executable bar 缺失时 Adapter 在任何 Fill 前返回 `missing_earliest_executable_bar`；持仓后的网格缺失由 Engine 在前一根已观测 bar close 完成后、任何后续 Funding/Mark/open 与 checkpoint 前返回 `open_position_grid_gap`。两者共用自校验 `ReplayDataGapFailureEvidence`，绑定精确 bounds、interval/count 与 `fail_before_unobserved_interval_effects`，Runner 以 Run Outcome v31 的 non-retryable `data_integrity` failure 发布且不产生 partial Result/Artifact。若 terminal 已发生于未来 gap 前，该 gap 未被消费，Result/source prefix/limitations 均不变；resume 不能越过 continuity fence。Simulator 推进至 v9；Request、Dataset、Result、Artifact 与 Checkpoint schema 不变。

R4.51 冻结**PIT instrument trading-status 与 halt/resume 协议**。新增 `Instrument Status Snapshot v1`，Dataset Manifest v8 以连续半开 epochs 声明 `trading/halted`，Request v22、Trial Reservation v6 与 Result v34 Fingerprint 分别绑定 `instrument_status_schedule_hash`。缺 bar 不自动等于停牌；仅当 complete schedule 证明 `[previous.close, next.open)` 全程 halted 且 `next.open` 已为 trading，Engine 才允许跨越该区间。每个 decision 与冻结 earliest executable boundary 必须处于 trading，每根提供的 bar 必须完整落在 trading epoch。halt/resume 作为 phase-`00` SourceEvent 进入 consumed prefix，delisting sequence `0` 仍先行；停牌期间 protection/order state 保持但禁止 market/strategy Fill，exact Funding/Mark 继续结算和风险观察。恢复首个真实 open 继续使用 observed-open `worse_open`；停牌中 exact maintenance breach 返回 `maintenance-margin-breach-while-halted` 与非权威 observation，不造 liquidation Fill、Result 或 Artifact。Checkpoint v17 锁定 clean/resume parity；Simulator v10、Artifact v36、Run Outcome v32 同步推进。该协议不采集交易所历史状态、不重建缺失状态、不定义停牌结算或 delisting settlement。

R4.52 冻结**instrument-status producer authority 与 completeness attestation**。`Instrument Status Provenance v1` 不是第三份状态真相，而是 Market Data Products 对 `status_epochs` 的生产证明：绑定 producer domain/id/version、source owner/kind、normalization policy、effective coverage、source-observed-through、produced-at、原始记录 count/ref/hash 与 derived schedule hash。Dataset Manifest v9 内嵌 attestation；Request v23、Trial Reservation v7、Result v35 Fingerprint 独立绑定 `instrument_status_provenance_hash`，因此替换 producer、raw source、coverage 或 normalization 即使导出相同 epochs 也属于不同证据。`complete_history` 只接受 `venue_status_event_archive` 且 coverage 必须包住 Replay window；`venue_current_snapshot` 与 `periodic_snapshot_series` 只能是 `current_snapshot_only`，连续轮询“全为 trading”不能证明采样间没有 halt。Replay 只验证不可变声明与闭包，不采集、不补全、不替 Market Data 证明外部 archive 真实穷尽；production provider、archive certification、halt/delisting settlement 均未实现。

R4.53 落地 **Market Data immutable archive → Replay status evidence** 的生产接缝，不改变 Replay wire epoch 或 Simulator 经济语义。`market-data-store` 新增 Instrument Status Archive v1：原始 transition、coverage、finality watermark、source/content/archive hash 以 `BEGIN IMMEDIATE` create-or-identical CAS 原子提交，同一 id 不允许内容漂移。`market-data.instrument-status-provider` 只读该 archive，要求首个 coverage anchor、严格递增且交替的 `trading/halted` transition、`source_observed_through >= coverage_end` 与 requested-window containment，再按 hash-bound Normalization Policy v1 生成连续半开 epochs、Provenance v1、Provider Capability v1 与 self-hashed evidence。跨域 fixture 已证明输出可直接通过 Replay Request v23 / Dataset Manifest v9；但 archive 的 finality 是 source/import assertion，不是交易所签名或第三方穷尽证明，Control Plane 对 provider capability 的 registry admission 仍未冻结。

R4.54 冻结 **Control Plane provider certification admission**。`Provider Certification v1` 是 Control Plane 单写、self-hashed、create-or-identical 的不可变快照，绑定 certifier/policy、`[certified_at, valid_until)`、provider capability/build、normalization 与允许的 source/completeness；Trial Reservation v8 只能嵌入注册且在 `issued_at` 有效的认证。Market Data Provider 必须消费认证 ref/hash 且 capability hash 与自身固定 capability 完全一致，无权自签或延期。Dataset Manifest v10 的 Provenance v2、Request v24、Reservation v8、Result v36 Fingerprint 与 Runner 必须指向同一 certification/capability；任一自报、替换、未知或过期认证均在 Engine 前拒绝。该收据证明的是 Control Plane 对仓库内实现能力的准入，不证明 venue archive 外部真实、完整、签名或 finality。

R4.55 补齐 **Market Data imported archive 的仓库内来源闭包**，不改变 Replay wire、Simulator 或经济语义。Instrument Status Archive v2 必须内嵌有序 Source Batch Manifest v1：每批绑定 venue/symbol、半开 coverage、source watermark、retrieval time、source ref、raw content hash/count、前批 hash；Completeness Audit v1 只认证批次序号、hash link、coverage 无 gap/overlap、linked event count 与 archive window 闭合，固定声明 `audit_scope=batch_window_continuity`、`external_completeness=not_verified`。修订不覆盖旧行，而以同 venue/symbol/window、单后继 `supersedes_archive_hash + correction_reason` 追加；冻结 Trial 继续复现旧 hash，Control Plane 是否为新 Trial 选择修订版尚未制度化。Provider v3 / Evidence v3 将 archive/audit/batch-chain/supersession hash 带到跨域证据，能力/build hash 因 Archive v2 输入升级而变化，须重新获得 Control Plane certification。该闭包仍不证明交易所签名、collector 未漏采、源系统历史穷尽或外部事实真实性。

R4.56 冻结 **instrument-status acquisition receipt 与 capability fence**。Market Data Store 以 Acquisition Receipt v1 保存 request identity、source capability、transport、ordered Attempt、HTTP status、failure class/retryable、exact response BLOB ref/hash/bytes/count 与 terminal status；同 acquisition id 仅 create-or-identical，失败收据也持久化。Source Batch v2 / Archive v3 必须引用已落库 receipt id/hash，提交时再次核对 venue/symbol/window/watermark/raw hash/count 和成功 payload；只有 `historical_event_archive + offline_import` 可进入 batch，`current_snapshot_only` 永远不可晋升为 `complete_history`。新增 Binance USDⓈ-M read-only collector 调用官方 [Exchange Information](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Exchange-Information)，保存 429/5xx/invalid body 与重试链，但只出具当前 snapshot；官方 [Contract Info Stream](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Contract-Info-Stream) 是后续 prospective collection 候选，不被本阶段解释为历史回填。Provider v4 / Evidence v4 因 Archive v3 输入升级而需重新认证；Replay wire、Simulator、Checkpoint 与经济语义不变。Receipt 固定 `external_authenticity=not_verified`，证明本地采集过程和字节闭包，不证明 TLS 对端签名留存、venue 未遗漏、断线期间无事件或历史穷尽。

R4.57 冻结 **Provider Certification rotation/revocation lifecycle**。Certification v1 仍不可变；Control Plane 另写 self-hashed、create-or-identical 的 Termination v1，每份认证至多一个终止事实。`recorded_at <= effective_at` 禁止追溯撤销；`revoked` 不带 successor，`superseded` 必须引用预先注册、同一 `producer_id` 且在 cutover 可准入的新认证。有效准入窗变为 `[certified_at, min(valid_until, termination.effective_at))`，但只作用于 cutover 起签发的新 Reservation；此前已签发的 Reservation、后续 claim/Attempt、Result/Artifact 不被重写。Control Plane 不自动选择 latest，调用者仍提交精确 certification hash；Replay wire、Fingerprint、Simulator、Checkpoint 与经济语义不变，Replay 不读取 lifecycle registry。

R4.58 冻结 **Reservation/Attempt emergency cancellation authority**。Reservation Cancellation v1 是 non-retroactive、self-hashed、append-only 收据，绑定完整 Reservation hash 与 Trial/run，只在 `effective_at` 起永久阻止新的 Attempt claim；同一 active claim 的幂等重送不被误杀。Attempt Cancellation v1 独立绑定 Trial/run/request/reservation、Attempt/worker/ordinal 与精确 `target_lease_generation`，收据与 Attempt terminal `cancelled` 原子提交；stale generation、terminal Attempt、竞争取消均拒绝。若事故需要“停止当前运行且禁止 retry”，协调者必须显式写两份收据。Runner 继续通过既有 source-boundary execution-control callback 接收 `cancel`，不发布 partial Result/Artifact；Control Plane 终态会拒绝旧 lease 的 renew/finalize/new checkpoint。当前尚无 production coordinator 将 DB cancellation 实时投递给跨进程 worker，因此只能声称 authority/storage fence 已认证，不能声称即时抢占或有界停止延迟。Replay wire、Fingerprint、Simulator 与经济语义不变。

R4.59 冻结 **Attempt Cancellation observation/acknowledgement seam**。Control Plane 提供只读 SQLite reference directive：只有 cancellation 与调用方携带的 exact、未过期 lease 在 Trial/run/request/reservation、Attempt/worker/ordinal/generation 全部一致时才返回 `cancel + original receipt`；不续租、不伪造新 generation。Runner 在完整 source-event boundary 校验 receipt self-hash、`recorded_at <= observed_at`、active lease hash 与所有 binding，以 Run Outcome v35 返回 self-hashed Observation v1；Control Plane 再以 create-or-identical append-only registry 确认，保存首次 `registered_at` 并强制 `observed_at <= registered_at`，禁止竞争 ack 或 terminal Attempt 漂移。Observation 证明某 worker 已合作观察并返回 cancelled outcome，不证明发送时刻、进程强制抢占或有界 stop latency；取消已先终止 Attempt，故随后落地的本地 diagnostic checkpoint 仍无 Receipt/Resume authority。Result/Artifact/Fingerprint/Simulator/经济语义不变。

R4.60 落地 **transport-neutral cancellation coordinator reference path**。Experiment Runner 新增 Coordination Result v1 与注入式 port：每个完整 source boundary 先以当前 lease 调 `poll`，无取消时才委托既有 renewal/control callback；收到 exact directive 后沿 R4.59 生成 Observation，Run Outcome 返回后再调 `acknowledge`。ack 失败抛出保留完整 cancelled outcome 的 typed coordinator error，调用方可重试 immutable observation，不能把失败伪装为已登记。Control Plane 提供结构兼容的 SQLite adapter 与只读 latency projection，分别计算 authority→observation、observation→registration、authority→registration；测量值不等于 SLA。authority cancel 已使 Attempt terminal，因此 Runner 不再发布其 resumable checkpoint/diagnostic commit，并删除 attempt-local diagnostic 文件；普通 cooperative cancel 的 checkpoint/resume 语义不变。该 port 不固定 push、poll、lease-renew response、IPC 或网络协议，也不实现强制抢占、进程 watchdog 或通用空目录 GC。Replay Result/Artifact/Fingerprint/Simulator/经济语义不变。

R4.61 冻结 **cancellation acknowledgement no-replay retry seam**。`acknowledgeReplayCancellationOutcome` 只接受 R4.59 的 authority-cancelled Run Outcome 与其 self-hashed Observation，保留原 boundary poll count，以新的 registration attempt 重调同一 injected port；该路径不再 poll、不进入 Engine、不生成第二 Observation。ack typed error 除完整 outcome 外保存 attempted `registered_at` 与原始 cause；重试成功仍返回 Coordination Result v1。SQLite adapter 对同一 Observation create-or-identical，首次成功 `registered_at` 与 latency projection 不因重复 ack 改写，竞争 Observation 继续拒绝。该 seam 只解决调用栈仍持有 outcome 时的进程内恢复，不是 durable outbox、进程崩溃恢复、跨进程投递或停止 SLA；Replay Result/Artifact/Fingerprint/Simulator/经济语义不变。

R4.62 落地 **Runner-owned local durable cancellation outbox**。Durable coordinator 在 authority-cancelled Run Outcome 返回后、调用 Control Plane `acknowledge` 前，先向 certified Attempt-local Artifact Store immutable-CAS 固定名 Outbox Record v1；记录 self-hash 并绑定 request hash、run、Attempt/lease generation、boundary poll count、完整 Run Outcome 与首次 `persisted_at`。落盘失败抛 typed persistence error，严格禁止 ack；ack 失败携带 Outbox Commit。进程重启后 `recoverReplayCancellationAcknowledgement` 只 load、重验 byte/content hash 与 Outcome/Observation authority，再重投 ack，不 poll、不进入 Engine。相同 record first-write-wins，竞争内容/tamper 拒绝；成功 ack 后记录不删除，使 outbox commit 之后的崩溃只会触发 Control Plane create-or-identical redelivery。Durable Coordination Result v1 与 Outbox Commit 只是 operational evidence，不进入 Result/Artifact Manifest/Fingerprint，也不取得 Checkpoint Receipt/Resume authority。Observation 生成至 outbox commit 之间仍存在进程指令级窗口，不能声称与 Engine terminal transition 原子；当前只认证 local filesystem store，retention/GC、remote outbox/store、网络 transport、SLA 与 watchdog未决。

R4.63 冻结 **pre-terminal cancellation outbox handoff**，不改变 R4.62 schema。Runner 抽取唯一 canonical authority-cancellation outcome constructor；durable coordinator 在 source-boundary poll 得到 directive 后，先按 current lease/time/binding 验证并构造 Observation + terminal outcome，再 immutable-CAS outbox，成功后才把 `cancel` 返回 Engine。Runner 终态必须与预提交 bytes canonical-equal；因此 outbox commit 后、Engine 抛出 interrupted 或调用栈返回前崩溃，重启可直接 load/ack，不需要重跑 Engine。持久化异常被捕获但不阻止 authority cancel，终态后抛 typed persistence error 并禁止 ack；无效或过期 directive 不得写 operational record。测试以 persist 时 diagnostic checkpoint 尚存在、终态 cleanup 后仅保留 outbox 锁定真实顺序，并继续锁定 restart no-poll/no-replay。该协议只将 durable point 前移到 terminal transition 之前；`poll` 从 Control Plane 返回到 local filesystem commit 不是跨存储事务，仍不能宣称 exactly-once、强制抢占或 stop SLA。Result/Artifact/Fingerprint/Simulator/经济语义不变。

实现路径：`replay-execution-plane/contracts`、`data-adapter`、`engine`、`accounting`、`metrics`、`runner` 与 `tests` 已成为 certified slice 的新语义 owner；`replay-execution-plane/compatibility/replay-runner` 可转发 Trial-bound request，`compatibility/replay-engine` 仅复用稳定 accounting 原语并继续作为 parity/迁移来源，不再承接新语义扩展。RD 根已无旧 Replay package。

权威边界：

| Replay 可以 | Replay 不可以 |
| --- | --- |
| 校验冻结输入及其 hash | 修改 Experiment Contract / Candidate / Trial Group |
| 读取 Dataset Manifest，按 point-in-time 规则产出市场事件 | 扩大 search space、生成候选、分配 trial budget |
| 模拟 order / fill / position / ledger / margin / cost | 决定 winner、晋级、Review Decision 或 lifecycle |
| 输出 append-only run status、Result Artifact、Evidence Fingerprint | 写 strategy status、正式 shadow/live evidence 或 `trade.db` |
| 对未消费的数据缺口、分辨率和模型能力输出 limitation；对执行相关缺口 typed-fail | 用乐观补值把不可判定结果伪装为已成交 |

三个概念必须分开：

- `Replay Engine`：确定性市场事件、订单、仓位和账本状态机；历史与合成事件均可驱动。
- `Backtest`：Replay Engine 消费历史 Dataset Manifest 的一种运行模式，不是另一套 engine。
- `Experiment Runner`：验证 Trial Reservation、选择受支持模式、执行/重试/取消、提交 artifact 的编排层；不做研究裁决。

正式 Shadow、Live-small、真实订单、账户和交易所对账不属于本设计。第三个 Plane 正式命名为 `Forward Evidence Plane`（前瞻证据面），目录名固定为 `forward-evidence-plane/`；它承接 candidate freeze 后随新数据到达形成的 paper/forward evidence，不等于正式 Shadow。本文只确认接口边界，不设计其内部合同。

## 2. Plane 接口

```mermaid
flowchart LR
  CP["Research Control Plane\nReservation / Attempt Lease / Cancellation Directive + Observation / Resume Authority"] -->|"Request + immutable authority snapshots"| RR
  MD["Market Data Products\nimmutable status archive / provider / Dataset Manifest"] -->|"immutable refs + content hashes"| DA

  subgraph RP["Replay Execution Plane"]
    RR["Experiment Runner\nauthority / fencing / idempotency"]
    CT["Contracts\nschema / simulator policies / version registry"]
    DA["Data Adapter\nvalidation / PIT join / event normalization"]
    DH["Decision Harness\nbuild attestation / worker / receipt"]
    DT["Decision Evidence Timeline\nordered entry / authority hash"]
    EN["Replay Engine\nclock / orders / fills / positions"]
    AC["Accounting\ncash / PnL / fee / funding / margin"]
    MT["Metrics\nledger-derived measures"]
    AR["Artifact Commit\nmanifest / hashes / completeness"]
    RR --> CT
    RR --> DA
    DA --> DH
    DH --> DT
    DT --> EN
    CT --> EN
    EN <--> AC
    AC --> MT
    EN --> AR
    AC --> AR
    MT --> AR
  end

  AR -->|"Manifest ref+hash / Result / Attempt Outcome"| CP
```

对外执行闭包由 `ReplayExecutionRequest + TrialReservationSnapshot + ReplayAttemptLeaseSnapshot` 组成；跨 Attempt 恢复时额外要求 `ReplayResumeAuthorizationSnapshot`。输出为 `ReplayExecutionResult + ArtifactManifest + RunOutcome`。内部 Engine/Accounting 不被 Control Plane 直接调用；Market Data 只提供 owner-owned manifest/ref，不接收 Replay 回写。

## 3. 当前实现审计

用户给出的 `modules/contracts/replay-contracts` 当前不存在；实际模块是 `modules/contracts/replay-contract`。以下按实际路径审计。

### 3.1 模块判定

| 当前模块 | 当前事实 | 目标归属与动作 |
| --- | --- | --- |
| `replay-engine` | `replayStrategy` 是单 lane、一次全仓 resolver；同文件混合 manifest 读取、指标、撮合、成本、metrics、gate、hash | **拆分重构**：事件/订单/仓位进 `replay-execution-plane/engine`，成本进 `accounting`，manifest/PIT/hash 输入进 `data-adapter`，统计进 `metrics`；旧入口做兼容 adapter 后淘汰 |
| `replay-runner` | 单策略 CLI 与浅 fingerprint；不绑定 Experiment/Trial/Candidate | **保留并升级**到 `replay-execution-plane/runner`，成为 Trial Reservation 驱动的唯一编排入口 |
| `data-split` | 物理切 discovery/validation/locked_holdout 并留 embargo | **保留在 Research Control Plane**；split/holdout 选择是研究治理，不是 Replay 执行；Replay data-adapter 只消费并验证冻结 manifest |
| `benchmark-engine` / `benchmark-runner` | 独立 close-return 权重模拟、成本和负对照；不是订单级 Replay | **保留在 research**；benchmark 定义和裁决不进 Replay。仅当某个 fast kernel 通过 parity 后，抽取其纯执行内核，禁止直接把现实现命名为 Replay fast mode |
| `calibration-suite` | 诊断数据、成本、funding、regime 与负对照 | **保留在 research**；它消费 Replay/benchmark 结果，不属于执行面 |
| `candidate-batch-engine` | 候选生成输入、negative control、OOS、selection/reliability gate | **保留在 Research Control Plane**；改为逐 Trial 调 runner，禁止直接 import engine 或在 Replay result 上追加修改 assumptions |
| `panel-evaluator` | 单资产结果汇总；另有独立 cross-sectional close-return simulator | **拆分**：panel gate/aggregation 留 research；真正共享资金的 portfolio execution 必须改走 Replay。现 cross-sectional simulator 在 parity 前只算研究近似 |
| `strategy-family-engine` | family/feature/forecast/signal 实现与 registry | **保留在 research**；编译出的不可变 executable candidate 是 Replay 输入，family registry 本身不是 Replay 组件 |
| `rd-campaign-runner` | hypothesis queue、budget、discovery/validation、artifact/state writeback | **保留在 Research Control Plane**；不得迁入 `replay-execution-plane/runner` |
| `contracts/replay-contract` | `ReplayResult v1` 只锁浅外壳，fingerprint 仅强制 `harness_hash` | **版本化替换**为完整 request/result/artifact/fingerprint schema；v1 只作兼容读模型 |

不应保留的长期重复实现：`replayStrategy` 单笔 resolver、`simulateReplayOrderLane`、benchmark 权重模拟、panel cross-sectional 模拟不能继续各自定义“成交与成本事实”。迁移期允许并存，但只有新 event kernel 是订单/账本权威；其他路径必须成为 adapter、受限 fast mode，或明确标为 diagnostic approximation。

### 3.2 已由测试锁定的语义

验证快照：`2026-07-15` 本轮 Replay contracts/engine/runner/certification 与 Reviewer 定向测试均通过；仓库级质量结果以本轮交付记录为准。通过只证明下表已有行为稳定，不证明尚无 fixture 的订单/账本 fidelity。

| 状态 | 当前语义 | 证据与限制 |
| --- | --- | --- |
| 已正式实现并测试 | closed candle 产生 signal，默认下一根 open 入场 | Certified adapter 已验证 closed、UTC、OHLC、interval/grid、manifest window 与 content hash；legacy `strategy-replay` 仍主要依赖 manifest 声明 |
| 已正式实现并测试 | 简单 bracket 同 bar 时 stop-first；终结单 fill 后取消 sibling | 单仓 exact-risk liquidation 已另有 forced lane；仍不能外推到多 entry、多 stop ladder、一般 cancel race 或部分强平 |
| 已正式实现并测试 | stop/TP gap 在 open 已越过 trigger 时绑定 observed open，再施加不利滑点 | stop 不得回填 trigger 以掩盖更差开盘；TP 也不得等到 close 后回填 target，long/short 均有 fixture |
| 已正式实现并测试 | break-even 在触发 bar 完成后、下一 bar 生效 | 是当前兼容 policy，不是所有 trailing/protection 的长期唯一制度 |
| 已正式实现并测试 | 双边 fee/slippage bps；funding 与 bar 共用 EventKey，entry/exit 同 timestamp 使用 `t-` position | 当前 certified lane 允许一次 fixed-quantity partial；Funding/Margin 按 EventKey 读取当时 Position，multiple partial/add/reversal 未认证，adverse fallback 仅属 compatibility |
| 已正式实现并测试 | 主 replay 不允许 lane 内重叠持仓 | 允许单仓一次 reduce-only partial，但不允许第二 entry、加仓、反转或 portfolio 并发 |
| 已正式实现并测试 | SourceEvent reducer 同步驱动 entry/exit order lanes；submit/activate/trigger/partial/full/cancel/reject、EventKey 全序、oversized cap 与 wrong-side reduce-only 由独立状态 owner 守恒 | entry open、halt/resume、funding、bracket activation、terminal source/fill/cancel 共用因果边界；尚无 external-command、多订单 matching、真实 partial liquidity 或 limit queue |
| 已正式实现并测试 | complete PIT `trading/halted` status epochs；停牌区间无 bar、Funding/Mark 继续、恢复首 open gap 与 checkpoint resume | 只接受冻结状态事实，不从缺 bar 推断 halt；停牌中 maintenance breach typed-fail；无 halt settlement、venue state collector 或 delisting settlement |
| 已正式实现并测试 | instrument-status acquisition receipt、immutable archive、provider normalization、Control Plane certification 与 provenance binding | Store 保存 exact response BLOB、retry/terminal receipt，并只允许 historical capability 进入 Source Batch；Binance REST collector 只能 current snapshot。Provider 只读生成 certification-bound epochs/provenance；Control Plane 注册并在 Reservation issuance 校验 capability/有效期；Dataset/Request/Reservation/Fingerprint 四方绑定同一收据。该闭包不等于 venue 签名或外部穷尽审计 |
| 已正式实现并测试 | multi-Fill average-cost、open/flat cash reducer、terminal valuation 与 settlement-asset journal | 一次 fixed-quantity partial 后的 stop/target/final exit/exact liquidation 全平及 EOD open-marked 已锁定；add/reversal/multiple partial、oversized reduce-only 仍拒绝；cash、position valuation、ending equity、journal/trial balance 对账 |
| 已正式实现并测试 | frozen isolated margin source-prefix observation、exact-risk full liquidation 与 OHLCV terminal failure | exact Mark/funding-mark breach 先于同时间策略退出，forced reduce-only full close、独立 liquidation fee、flat reconciliation 与 typed execution evidence 已锁定；OHLCV breach 仍不执行，exact trigger 也不证明交易所真实成交价 |
| 已正式实现并测试 | Numeric Policy v3 rational arithmetic | bps/rate/product/division 使用 BigInt rational；quantity floor；buy fill ceil/sell fill floor；fee ceil；signed funding/realized floor；weighted average/return 12 位 half-away；未对齐 trigger/OHLC/cash evidence 拒绝；Bun/Python 共享向量 parity |
| 已正式实现并测试 | discovery/validation/locked holdout 物理分段与 embargo | 属于 research split 纪律，不等于 Replay data adapter 已防全部 PIT 泄漏 |
| 已正式实现并测试 | supplemental provenance、Decision Snapshot、Source Bundle、Build Attestation、fresh worker 与 Harness Receipt | 已绑定 Request/Result/Fingerprint/Artifact/checkpoint；证明 exact source/build/runtime/process protocol，不证明 OS sandbox、外部依赖 SBOM 或第三方签名 |

### 3.3 不能升级为长期制度的行为

| 分类 | 当前行为 | 设计判定 |
| --- | --- | --- |
| 保守临时策略 | 任意同 bar 冲突一律 stop-first | 保留为 simple-bracket compatibility；长期使用 OHLC admissible-path 协议 |
| 保守临时策略 | 不允许 overlapping positions | 当前 family 可继续用；长期由 Contract 的 position/portfolio policy 决定 |
| 保守临时策略 | 固定 bps slippage、adverse funding fallback | 仅 stress mode；不能冒充历史实际成本 |
| 保守临时策略 | limit 一触即全成、没有 queue | 无 L2/成交量合同不得用于 maker fidelity 结论 |
| 隐含行为 | `time_exit` 在 exit candle close 成交 | 必须在 simulator policy 显式声明 earliest executable time 与 price source |
| 隐含行为 | funding 区间为 `(entry_time, exit_time]` | 应升级为 timestamp phase protocol：同时间 funding 使用 `t-` 持仓，之后的 fill 不参与本次结算 |
| 隐含行为 | supplemental report 的生成时间同时充当 `availability_at` | 不可靠；生成、观测、发布、可用时间必须分开 |
| 隐含行为 | manifest 缺 universe time 时回退 dataset start/generated time | 只能输出 limitation，不能据此声称 point-in-time universe |
| 已正式实现并测试 | expected grid 上缺 bar 不得被时间压缩或当作 observed price gap | 缺 entry bar 在 Fill 前失败；持仓后缺口在前一 observed close 后、未来 source/checkpoint 前失败；terminal-before-gap 不消费未来缺口 |
| 尚未设计 | amend/TIF、limit queue、真实 partial fill、cancel race、multi-entry/reversal | 进入后续 order/matching capability；不得从当前状态组件推断已支持 |
| 已正式实现并测试 | frozen isolated collateral reserve/release | entry reserve、position-attributed cashflow routing、flat release、open retain、wallet/collateral/settled cash/equity 对账已锁定；动态 add/withdraw、cross/shared margin 仍不支持 |
| 部分实现 | isolated source-prefix margin/liquidation | 完整 Mark Event grid 与 exact funding 可触发单仓全量模拟强平；缺 Mark 时 bar open + 不利极值只做保守失败。Mark 不触发策略单，forced Fill 为 policy-modelled evidence；部分强平、deficit/insurance/ADL、cross/shared margin、borrow、真实 impact 未完成 |
| 尚未设计 | step/fast semantic digest parity | fast mode 上线前硬门槛 |
| 已知不可靠 | `simulateReplayOrderLane` 的 limit 触发按 BUY-high / SELL-low，实质混同 stop；wrong-side reduce-only 可加仓 | 不修补成长期 API；在新 order kernel 用 fixture 重建 |
| 已知不可靠 | lane helper 与主 `replayStrategy` 脱节 | 主路径迁到同一 event kernel |
| 已知不可靠 | benchmark、panel、replay 各算一套成本/收益 | 研究 gate 可不同，执行事实必须统一 |
| 已知不可靠 | `replayHarnessHash()` 未覆盖实际 `strategy-family-engine` 全部源码；fingerprint schema 又允许缺 data/assumptions | 不能据当前 fingerprint 声称完整复现 |
| 已知不可靠 | Replay 自己输出 `shadow_candidate` | 越权；目标 Result 只给 metrics/quality flags，由 Reviewer 决策 |

### 3.4 最危险的五个 fidelity 缺口

1. **多个模拟器、无 parity**：同一 candidate 在 replay、benchmark、panel 可能得到不同资金、成本和时序语义。
2. **订单状态机仅覆盖窄纵切**：主路径已有 market/bracket lifecycle 与 reduce-only 守恒，但 limit/amend、cancel race、真实 partial、加减仓、reversal 仍无统一 matching/position 事实。
3. **OHLC 路径不可知却未输出 resolution limitation**：stop/target 之外的多订单结果可能被任意实现顺序决定。
4. **强平只覆盖单仓无坏账模型**：exact-risk full close 已进入统一账本，但多资产并发、动态 collateral、cross/shared allocation、部分强平、grid 间路径、破产价、保险基金与 ADL 仍无法守恒。
5. **Harness 仍不是安全沙箱或完整策略闭包**：required lane 已认证 Source Bundle -> deterministic Bun artifact -> exact runtime -> fresh stdio subprocess，并对冻结 schedule 中每个 pre-entry boundary 重做 market PIT；但该边界不封锁文件系统/网络、没有独立签名者或任意依赖 SBOM，也未覆盖持仓后动态 supplemental join、feature DAG trace 与订单更新。

## 4. 目标组件树

目录按稳定责任和 owner boundary 划分，不按 tool 数量划分。目标根与首条纵切已经建立；`data-adapter`、`accounting`、`metrics` 与 Plane-local `tests` 已有 certified single-position 实现，不再是空壳，但其 owner 范围只覆盖当前 capability。`artifacts` 仍是目标 owner，v1 暂由 runner 物化；不得把 runner 内的临时聚合误报为完整迁移。

```text
modules/research-strategy-development/
├── research-control-plane/
│   └── ...                         # Research 治理、合同、Trial、Review、KG；具体迁移另案
├── replay-execution-plane/
│   ├── contracts/                  # request/result/event/order/ledger/artifact/policy schema
│   ├── engine/                     # clock、event loop、order state、matching、position projection
│   ├── accounting/                 # double-entry ledger、PnL、fee/funding/borrow、margin/liquidation
│   ├── data-adapter/               # manifest validation、PIT join、market-event normalization
│   ├── metrics/                    # 只从 fills/ledger/NAV 派生指标
│   ├── artifacts/                  # event/fill/position/ledger/journal/result manifest；当前暂由 runner 物化
│   ├── runner/                     # Trial 编排、幂等、checkpoint、取消、artifact commit
│   └── tests/                      # golden fixtures、property、metamorphic、parity certification
├── forward-evidence-plane/
│   └── ...                         # candidate freeze 后的前瞻证据；内部设计另案
└── agent-roles/                     # 角色入口，不是第四个 Plane，不持有独立事实
    ├── planner/                         # bounded Proposal submission
    ├── developer/                       # Trial-bound Replay Request
    └── reviewer/                        # explicit Review Decision submission
```

`agent-roles/` 与三个 Plane 同级，但语义不对称：Plane 持有稳定责任、合同与权威状态；Agent Role 是调用这些能力的 typed 角色入口。当前已锁最小输入输出，仍不固定 agent 数量、tool 组合、prompt、内部推理流程或部署形态。

稳定组件与运行模式的区别：

| 稳定组件 | 不能独立成为组件的“模式” |
| --- | --- |
| contracts / data-adapter / engine / accounting / metrics / runner / certification tests | backtest、historical replay、cost stress、Monte Carlo、single-asset、panel batch、shared portfolio、step、fast/vectorized |

运行模式只选择同一合同和内核的受限 capability set，不复制状态机。Panel 是多 Trial/资产的评估组织方式；只有声明 shared portfolio 时才是一个组合执行实例。

## 5. Control Plane 输入/输出合同

当前 certified wire id 为 Control Plane `trade-flow.rd-experiment-contract.v3`、Trial Reservation v8、Provider Certification/Termination v1、Reservation/Attempt Cancellation v1、Attempt Cancellation Observation v1、Attempt Lease v1、Checkpoint Receipt v2、Resume Authorization v1，以及 Replay Request v24、Dataset Manifest v10、Instrument Status Snapshot v1/Provenance v2、Supplemental Requirement Set v1、Decision Input/Market Snapshot v1、Decision State Snapshot v3、Partial Reduce Intent v1、Reduce-only Exit Intent v1、Protective Stop Replace Intent v1、Decision Schedule v5、Decision Harness Context v6、Source Bundle v1、Build Attestation v2、Worker Protocol v7、Registry Capability v7、Harness Capability/Receipt v9、Decision Boundary v7、Decision Evidence Timeline v8、OHLCV Resolution Evidence v3、Data Gap Failure Evidence v1、Result v36、Artifact v38、Artifact Store Capability v1、Engine Checkpoint v17、Diagnostic Commit v2、Run Outcome v35、Cancellation Coordination Result v1。Termination/Cancellation 是 Control Plane authority fact，Observation 是 worker submission/Control Plane registry fact，Coordination Result 是运行编排状态；均不是 Replay Request/Result 经济字段。Simulator 为 v10；Storage/Numeric/Journal/Equity/Margin Policy 不变。

Trial Reservation v8 冻结授权准入窗口 `[issued_at, expires_at)`、risk/spec/status 三份 schedule hash、status provenance/provider capability/provider certification hash、完整 supplemental revision stream hash 与 Requirement Set hash，并内嵌认证快照。发放时 Control Plane 从注册表按 certification hash 读取，不接受调用方内嵌对象；认证须处于 `[certified_at, min(valid_until, termination.effective_at))` 且 capability 与 binding 相等。Termination v1 只裁定新签发；Reservation Cancellation v1 才能停止既有 Reservation 的未来 claim，且不停止已 active Attempt；Attempt Cancellation v1 才能终止精确 lease generation。Reservation TTL 仍只控制新 Attempt claim；未取消的合法 active claim 继续由 Attempt lease/generation fencing 决定。Replay 不查询这些注册表，只复核冻结 Reservation、Request 与 Dataset 三方闭包，并从外部 execution-control port 接收运行命令。

### 5.1 目标 `ReplayExecutionRequest`

```json
{
  "schema_version": "trade.rd-replay-execution-request.v24",
  "run_id": "...",
  "idempotency_key": "...",
  "identity": {
    "experiment_id": "...",
    "trial_group_id": "...",
    "trial_group_hash": "sha256",
    "trial_id": "...",
    "candidate_id": "...",
    "candidate_identity_hash": "sha256",
    "identity_hash_policy_version": "rd-identity-hash.v1"
  },
  "experiment_contract": {"ref": "...", "content_hash": "sha256"},
  "trial_reservation": {"ref": "...", "reservation_hash": "sha256"},
  "dataset": {
    "manifest_ref": "...",
    "data_hash": "sha256",
    "supplemental_facts_hash": "sha256",
    "supplemental_requirement_set_hash": "sha256",
    "venue_risk_policy_schedule_hash": "sha256",
    "instrument_spec_schedule_hash": "sha256",
    "instrument_status_schedule_hash": "sha256",
    "instrument_status_provenance_hash": "sha256",
    "instrument_status_provider_capability_hash": "sha256",
    "instrument_status_provider_certification_hash": "sha256"
  },
  "supplemental_requirement_set": {
    "schema_version": "trade.rd-replay-supplemental-requirement-set.v1",
    "mode": "none | signal_time_complete",
    "undeclared_input_policy": "reject",
    "requirements": [{"requirement_id": "...", "source_id": "...", "entity_key": "...", "fact_key": "...", "event_time_start_inclusive": "...", "event_time_end_inclusive": "...", "minimum_visible_event_count": 1, "maximum_latest_event_age_ms": 14400000}]
  },
  "decision_market_input_requirement": {
    "schema_version": "trade.rd-replay-decision-market-input-requirement.v1",
    "mode": "none | closed_bar_lookback",
    "source_kind": "ohlcv",
    "fields": ["open", "high", "low", "close", "volume"],
    "lookback_bars": 1,
    "visibility_policy": "close_time_at_or_before_decision_time",
    "terminal_bar_policy": "close_time_equals_decision_time",
    "continuity_policy": "strict_interval_grid",
    "undeclared_input_policy": "reject"
  },
  "decision_market_input_requirement_hash": "sha256",
  "decision_schedule": {
    "schema_version": "trade.rd-replay-decision-schedule.v4",
    "schedule_policy": "frozen_closed_bar_schedule",
    "entries": [
      {"decision_sequence": 1, "decision_time": "...", "expected_effect": "no_action", "authorized_protective_stop_replace": null, "authorized_reduce_only_exit": null, "authorized_order_hash": null},
      {"decision_sequence": 2, "decision_time": "...", "expected_effect": "authorized_initial_order", "authorized_protective_stop_replace": null, "authorized_reduce_only_exit": null, "authorized_order_hash": "sha256"},
      {"decision_sequence": 3, "decision_time": "...", "expected_effect": "authorized_protective_stop_replace", "authorized_protective_stop_replace": {"schema_version": "trade.rd-replay-protective-stop-replace-intent.v1", "side": "sell", "order_type": "stop_market", "reduce_only": true, "quantity_policy": "full_open_position", "replace_policy": "tighten_only_cancel_then_submit", "signal_time": "...", "previous_stop_price": 95, "new_stop_price": 104}, "authorized_reduce_only_exit": null, "authorized_order_hash": "sha256"},
      {"decision_sequence": 4, "decision_time": "...", "expected_effect": "authorized_reduce_only_exit", "authorized_protective_stop_replace": null, "authorized_reduce_only_exit": {"schema_version": "trade.rd-replay-reduce-only-exit-intent.v1", "side": "sell", "order_type": "market", "reduce_only": true, "quantity_policy": "full_open_position", "signal_time": "...", "earliest_executable_time": "..."}, "authorized_order_hash": "sha256"}
    ]
  },
  "decision_schedule_hash": "sha256",
  "executable_candidate": {"harness_bundle_hash": "sha256", "candidate_hash": "sha256"},
  "policies": {
    "simulator_policy_version": "rd-replay-simulator-v7",
    "assumptions_ref": "...",
    "assumptions_hash": "sha256",
    "cost_policy_ref": "...",
    "cost_policy_hash": "sha256",
    "margin_policy_ref": "...",
    "margin_policy_hash": "sha256",
    "metrics_policy_version": "replay-metrics.v1"
  },
  "execution": {"mode": "step", "random_seed": null}
}
```

当前受限实现已完成 reservation + cancellation + attempt + receipt + resume authority 闭包：Control Plane 只从 `status=reserved` Trial 签发 v8 Reservation，并在写 Attempt 前强制 `issued_at <= claimed_at < expires_at` 与未命中 effective Reservation Cancellation；claim 还校验权威 Trial、risk/spec/status schedule、status provenance、supplemental-facts 与 execution-spec binding。active-attempt 唯一索引阻止双 worker；renew 必须在旧 lease 到期前推进 generation。Attempt Cancellation 以当前 generation 原子终止 authority，旧 worker 后续写入拒绝。transport-neutral coordinator 每个完整 boundary poll 注入 port；SQLite reference adapter 在未过期 lease 窗内返回 exact receipt，Runner 输出 Observation v1 后由 Control Plane append-only确认并可派生三段 latency。该闭包没有跨进程 transport、polling cadence 或 latency SLA；authority cancel 不发布 resumable checkpoint并删除本地 diagnostic 文件。Resume Authorization 只接受 source 最新有效 receipt；Runner 不接受裸 locator。cooperative cancel 返回 Run Outcome v35，不含 Result/Artifact；未认证 store、execution-relevant data gap 或 halted margin breach返回 typed failure，只有 completed 可携带权威 Result/Manifest/terminal completeness hash。

### 5.2 目标 `ReplayExecutionResult`

```json
{
  "schema_version": "trade.rd-replay-result.v28",
  "result_id": "...",
  "run_id": "...",
  "attempt_id": "...",
  "idempotency_key": "...",
  "status": "completed",
  "authoritative_result": true,
  "identity": {},
  "execution": {
    "mode": "step",
    "engine_version": "...",
    "harness_hash": "sha256",
    "simulator_policy_version": "rd-replay-simulator-v7",
    "determinism_class": "deterministic",
    "resolution": {"status": "exact", "limited_event_count": 0}
  },
  "liquidation_execution": null,
  "supplemental_evidence": {"decision_time": "...", "requirement_set_hash": "sha256", "undeclared_input_policy": "reject", "selected_record_ids": [], "selected_records_hash": "sha256", "future_revision_count": 0, "requirement_evaluations": [], "decision_input_snapshot_hash": "sha256"},
  "decision_evidence_timeline": {"schema_version": "trade.rd-replay-decision-evidence-timeline.v6", "ordering_policy": "decision_time_then_sequence", "cardinality_policy": "frozen_decision_schedule", "entries": [{"decision_sequence": 1, "decision_time": "...", "evaluation_status": "evaluated | not_reached_terminal", "execution_effect": "no_action | authorized_order | authorized_reduce_only_exit | not_reached", "authorized_order_hash": null, "decision_output_hash": "sha256 | null", "decision_boundary": {"schema_version": "trade.rd-replay-decision-boundary.v5", "boundary_kind": "frozen_decision_schedule_entry", "evaluation_time": "...", "market_data_cutoff": "...", "earliest_executable_time": "... | null", "boundary_hash": "sha256"}, "decision_input_snapshot": {}, "decision_market_input_snapshot": {"schema_version": "trade.rd-replay-decision-market-input-snapshot.v1", "snapshot_hash": "sha256"}, "decision_state_snapshot": {"schema_version": "trade.rd-replay-decision-state-snapshot.v1", "source_prefix_hash": "sha256", "position": {"state": "open"}, "cash_balance": 0, "equity": 0, "snapshot_hash": "sha256"}, "terminal_event_key": null, "entry_hash": "sha256"}], "timeline_hash": "sha256"},
  "metrics": {"schema_version": "trade-flow.replay-metrics.v1", "ref": "...", "content_hash": "sha256"},
  "artifact_manifest": {"ref": "...", "content_hash": "sha256"},
  "evidence_fingerprint": {"schema_version": "trade-flow.replay-fingerprint.v2", "hash": "sha256", "payload": {}},
  "quality_flags": [],
  "failure": null,
  "completeness": {"last_committed_event_key": "...", "checkpoint_hash": "sha256"}
}
```

目标 Result 不含 `shadow_candidate`、`live_small_candidate` 或 promotion gate。Replay 只输出事实、limitations、typed failure 和 quality flags；Research Reviewer 将它们与 stage/negative-control/selection protocol 组合后裁决。

## 6. 时间、事件与状态模型

### 6.1 时间字段

- 所有机器时间使用 RFC 3339 UTC；内部排序使用整数 epoch nanoseconds/microseconds，禁止本地时区和浮点时间。
- 每个外部事实至少有 `event_time`（事实发生）、`availability_at`（策略最早可知）、`source_sequence`（同源顺序）、`received_at`（采集时间，仅 lineage）。
- 决策只能读取 `availability_at <= decision_time` 的版本；修订数据以版本事件追加，不覆盖历史可见版本。
- engine 使用嵌套顺序 `(event_time, boundary_phase, source_sequence, event_subphase, stable_event_id)`；同一 market source event 必须完成 `mark -> risk -> match -> fill` 后才处理下一 source sequence。多资产共享资金时先形成同 timestamp decision batch，再统一分配，禁止循环顺序偷偷决定谁先占资金。

### 6.2 权威 phase 顺序

| Phase | 事件 | 权威语义 |
| --- | --- | --- |
| `00` | instrument status | listing/delisting、合约规格与交易状态先于本时点动作生效 |
| `10` | funding settlement | **当前单仓纵切已实现**：使用 EventKey 上 `t-` position；entry 同 timestamp 不计、exit 同 timestamp 仍计 |
| `15` | mark/risk/liquidation | **当前 v6 已实现受限子集**：exact Mark/funding-mark 更新 margin；breach 时按 `15.1` cancel stop、`15.2` cancel target、`15.3` submit forced order、`15.4` activate、`15.5` full Fill；非 breach Mark 不触发策略订单 |
| `20.0` | executable market event | trade/quote/bar-open 等外生执行事实按 source sequence 逐条推进；当前只实现 OHLC `bar_open|bar_range` |
| `20.1` | risk fallback | 无完整 Mark 流时，OHLCV 持仓方向不利极值在策略单解析前做保守 maintenance 检查 |
| `20.2` | resting order trigger/match | 只处理当前 source event 到来前已 active 的订单 |
| `20.3` | fill/accounting commit | 每笔 fill 立即原子更新 fee、PnL、cash、margin、remaining qty，再进入下一 source event |
| `60` | bar close publication | high/low/close/volume 至此才作为 closed candle 可见 |
| `70` | signal evaluation | 只消费当前 `availability_at` 已到的事实，生成 signal，不直接改仓位 |
| `80` | portfolio allocation | 同 timestamp signals 一次性应用 cash/risk budget 与 contract tie-breaker |
| `90` | command activation | submit/cancel/amend 进入订单状态；只能匹配后续 eligible market event |
| `100` | snapshot/checkpoint | 记录 NAV、exposure、state hash；metrics 不反向影响执行 |

同一真实 tick 内若有交易所 source sequence，以 source sequence 为准；否则使用 simulator policy stable tie-breaker 并输出 limitation。同 timestamp 固定为 delisting `00` -> funding `10` -> mark/risk/liquidation `15` -> OHLC market `20`。exact breach 的 forced lane 先于同时间 stop/target，且明确取消二者；无完整 Mark 流时，OHLCV 不利极值仅在策略单解析前形成 typed failure，不生成 forced Fill。该规则只证明 Replay 内的确定顺序，不证明交易所 liquidation queue、partial execution 或真实成交价。

### 6.3 Candle 可见性

| 时点 | 可见字段 |
| --- | --- |
| bar open | 本 bar `open`；此前已闭合 bars 的全字段 |
| bar 进行中 | 只有另有 timestamped tick/mark/quote 流时才可见增量 high/low/last/volume |
| bar close + availability lag | 本 bar `high/low/close/volume` 才整体可用于 signal |

closed-candle signal 在 phase `70` 生成；bar 模式的最早可执行时间是下一根 bar open，除非 Contract 明确绑定了 close auction/独立 tick 数据。禁止用本 bar close 产生 signal，再让本 bar high/low 成交。

## 7. OHLCV resolution 与 same-bar 协议

OHLCV 不能证明 bar 内真实路径。目标协议不猜唯一真相，而是运行两个与 OHLC 一致的极值路径：

```text
P1 = Open -> High -> Low -> Close
P2 = Open -> Low  -> High -> Close
```

每一段按价格穿越顺序驱动同一个 event kernel；child bracket 在 parent fill 后才激活。处理规则：

1. 先处理 open gap：active stop-market 以 open 与 trigger 的较差方向成交；limit 不得比 limit 更差。
2. 对 P1/P2 分别执行所有 crossing、订单激活、partial、reduce-only、margin 与 ledger。
3. 若两条路径的 normalized orders/fills/ending position/ledger 相同，`resolution.status=exact_under_ohlc`。
4. 若不同，`resolution.status=resolution_limited`；canonical result 取 bar-end equity 更低者，再按 realized PnL、stable path id 破同值；artifact 同时保存两条 path digest。
5. limit queue、同价多单成交量分配、bar 内 funding/exit 先后若无法由数据和 policy 确定，不伪造精确性；标记对应 `resolution_reason`。

P1/P2 是 v1 的保守 envelope，不声称枚举真实 bar 内全部往返路径；任何依赖同一价格多次穿越、queue replenishment 或 trailing 高频更新的 Contract 在 OHLC 模式下直接 `unsupported` 或 `resolution_limited`。

因此当前 `stop_first` 只作为 simple bracket 下“选择较差 admissible path”的兼容结果。多订单不再靠全局 `stop > target > entry` 排名直接解决。任何关键指标、gate 结论会因 P1/P2 改变的 run 必须标记 `resolution_limited`；Replay 只报告 material exposure、trade count 与 metric delta，Reviewer 决定是否要求更高分辨率重跑。

R4.44 已实现上述协议的 **simple-bracket terminal subset**，而非完整逐段 event-kernel：`OHLCV Resolution Evidence v1` 的每条记录绑定 source EventKey/bar、position side、active stop/target、ordered P1/P2 outcome 与 path digest、canonical path/role/selection policy、自哈希。open gap 使用两条相同 observed-open path，单 stop 或单 target touch 使用两条相同 terminal outcome，均为 `exact_under_ohlc`；同 bar stop/target collision 的两条 role 不同，标记 `resolution_limited / stop_target_order_ambiguous`，并按 simple bracket 中较差 terminal equity 选择 stop。Result v31 保存证据数组，Fingerprint 保存其 canonical collection hash，Artifact v33 独立发布 `ohlcv-resolution-evidence.json`。不存在 stop/target terminal 时数组为空；这不把 absence 解释成 tick-level exactness。

R4.45 的 higher-resolution oracle 只存在于 `replay-execution-plane/tests`。Fixture 明确 open/close 与严格递增的 `(offset_seconds, price)` observations；完整覆盖 bar interval，首个 observation 为 open，末个为 close。测试从同一轨迹独立聚合 OHLC，再分别计算 ordered first crossing 与生产 evidence：gap/single-touch 的两条 outcome 必须等价；collision 的 high-first/low-first outcome 必须各自匹配对应 path。Oracle 不产生 Fill/Ledger/Result，不写 Artifact，也不能被 Contract 当作可执行数据模式。

## 8. 订单与成交协议

### 8.1 Order 状态

```text
submitted -> active -> filled                         # market
                  \-> partially_filled -> filled
                  \-> triggered -> filled             # stop/TP
                              \-> partially_filled -> filled
submitted | active | triggered | partially_filled -> cancelled
triggered | partially_filled -> rejected              # reduce-only zero-fill
```

当前 Simulator v10 的 transition 是 append-only `OrderEvent`；conditional strategy fill 必须先 `triggered`。source vocabulary 为 `instrument_delisted|instrument_halted|instrument_resumed|funding|mark|bar_open|bar_range`。Mark 不触发 stop/TP；exact maintenance breach 只有在 trading 时才能创建 `liquidation`，halted 时必须 typed-fail。`authorized_protective_stop_replace` 保持 tighten-only。`authorized_partial_reduce` 在决策边界提交 `strategy_partial_reduce`，仅在严格更晚 eligible `bar_open` 全成 fixed quantity；同刻 exact risk、stop gap、target gap 先执行。partial Fill 位于 phase 20，旧 stop/target cancel 与剩余仓位 protection submit/activate 位于同 source 的 phase 90；无 SourceEvent 可插入。后续 source、Funding、Margin、State Snapshot 与 terminal owner 只读当前 Position/protection。非终止 `bar_range` 后必须先通过 continuity/status fence，才能发布 checkpoint 或消费未来 source。EOD 或更早 terminal 会取消 pending partial/final exit；`rd-replay-number-v3` 不变。

### 8.2 类型合同

| 类型 | 触发/成交合同 |
| --- | --- |
| Market | activation 后第一个 eligible quote/trade；fill price = reference + direction-aware slippage + impact；缺报价时 bar open 仅是声明过的近似 |
| Limit | BUY 仅在 executable ask/trade `<= limit`，SELL 仅在 `>= limit`；不得更差于 limit；仅 touch 默认不证明 queue fill，`touch/cross/volume` policy 必须版本化 |
| Stop | 条件触发后转 market 或 limit；trigger source 必填 `mark/index/last`；gap 后 market leg 按首个 eligible price，不保证 stop price |
| Take-profit | 与 stop 相反方向的条件单，不等于保证价；trigger source、market/limit child、reduce-only 必填 |
| Cancel | 在 cancel effective key 之后阻止未成交 remaining qty；若 fill source sequence 先发生，fill 胜出；重复 cancel 返回同一终态 |
| Partial fill | 每笔 fill 独立记 fee/position/ledger；remaining qty 保持 active；无 volume/queue 模型时不得声称 maker partial fidelity |
| Reduce-only | 只能减少当前同向 position；actual qty = `min(requested, reducible remaining)`；空仓、wrong-side 或已被先前 fill 消耗时为 zero-fill/expire，绝不加仓或翻向 |
| Protective stop replace（受限） | Schedule 最多一次；Intent 固定 opposite-side / stop-market / reduce-only / full-open-position / tighten-only。决策 close 必须尚未穿越新 stop；old cancel 先于 new submit/activate；不是通用 amend、target 改动或 trailing API |
| Strategy exit（受限） | Schedule 最多冻结一个且必须末位；Intent 固定 opposite-side / market / reduce-only / full-open-position / signal time / earliest executable time。决策时提交，严格更晚的指定 bar open 全成；优先级为 exact risk → stop gap → target gap → strategy exit；不等于通用减仓或 discretionary order API |
| Forced liquidation | 仅 exact risk observation 可创建；先 cancel strategy exits，再以 full reducible qty 提交 reduce-only market；trigger Mark 与 modelled execution price 分开记录；deficit 不发布 Result |

条件方向固定为：BUY stop 在 trigger source `>= stop_price` 时触发，SELL stop 在 `<=` 时触发；long 的 reduce-only stop/TP 分别是 SELL `<= stop` / SELL `>= target`，short 分别是 BUY `>= stop` / BUY `<= target`。`working_type=mark/index/last` 必填；trigger stream 与 executable quote/trade stream 不得混为一个字段。

Partial fill 必须绑定 liquidity capability：`event_book` 使用历史 book/queue，`bar_volume_cap` 使用预声明 participation cap，`full_fill_bounded` 只允许 notional 未超过冻结 capacity ceiling。`bar_volume_cap` 的可分配量在同 bar 所有订单间共享，按订单 priority 扣减，不能每笔重复使用全部 volume；缺 capability 时返回 unsupported/limited，不默认全成。

Observed-price gap policy 固定外壳：expected interval grid 完整，或 complete PIT status schedule 证明中间全程 halted 且当前 open 已 resumed 时，Market 使用 activation 后第一条 executable price；Stop/TP-market 在该 observed open 已越过 trigger 时以 open/quote 触发并成交，不能回填 trigger price；Limit 仍不得差于 limit。普通缺失 grid bar 的下一 open 不是“缺口期间首个可安全执行事实”，Simulator v10 在跨越未知区间前 typed-fail。具体 spread/slippage/impact 继续由冻结 cost/fill policy 决定。

订单优先级只在数据缺 source sequence 时使用：`forced liquidation -> protective stop -> protective target -> scheduled strategy exit -> 已 active 的风险增加单 -> 同类 activation key -> order_id`。已冻结 strategy exit 也不能越过同一 open 已观测到的 bracket gap。OHLC 同 bar 仍以双路径执行；priority 不能替代路径。

Market/Stop/Take-profit/Reduce-only 的目标语义参考 Binance USDⓈ-M 官方 [New Order](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order) 合同，但 Replay Contract 使用自己的稳定 vocabulary，并显式记录映射版本；不能把某次 Binance API 参数集合直接当作永恒内部模型。

## 9. 仓位、资金、成本与保证金账本

### 9.1 目标统一账本

所有 metrics 只从不可变 fills 与 double-entry ledger 派生。最小 account：

- `wallet_cash`
- `isolated_margin_collateral`
- `realized_pnl`
- `unrealized_pnl`（projection，不与 realized 混记）
- `fee_expense`
- `funding_income/expense`
- `borrow_interest`
- `impact_attribution`
- `initial_margin_requirement`（risk memo，不冒充现金账户）
- `maintenance_margin_requirement`（risk memo）
- `liquidation_penalty`

每条 Ledger Entry 绑定 `event_key / order_id / fill_id / instrument / asset / amount / currency / policy_version`，借贷平衡为硬 invariant。slippage/impact 主要进入 fill price，同时记 attribution，禁止又从 PnL 重复扣减。

当前 Result v36 延续单 settlement-asset Cash Ledger、Valuation/Equity v1 与 Journal v4。partial Fill 的手续费和 realized PnL 以同一 EventKey 入账；事件时 Funding 按该 SourceEvent 前已生效的 Position 数量计提，partial 后 Margin 使用剩余仓位及已结算 cashflow。R4.47 economic envelope 只是终止 Fill contribution 的路径敏感度，不进入权威 Ledger/Equity。Margin v7 的 isolated collateral、strict-below trigger、exact-risk execution 与 OHLCV failure fallback 不变；exact breach 仍输出 v3 observation + forced full-close，OHLCV breach、execution-relevant data gap 与 halted exact breach 均以 Run Outcome v35 表达，负 collateral 仍拒绝 Result。

Manifest v9 的 instrument-accounting spec 冻结 `base_asset / quote_asset / settlement_asset / contract_multiplier / price_increment / quantity_increment / settlement_increment`，并与 instrument-spec schedule 一起计算 Request-bound hash；status schedule 与 status provenance 分别以独立 hash 绑定，不得混入 accounting identity。Mark capability 仅接受 `none` 或覆盖 `[first_open_time,last_close_time]` 的 `complete_grid`，每条必须 `available_at == timestamp`、时间严格递增、source sequence 严格递增、价格 tick-aligned，count/interval/grid/content hash 全部一致；partial/stale/lagged Mark 流拒绝认证。当前只接受 unit-multiplier linear derivative、`quote_asset == settlement_asset` 与最多 12 位 increment scale。instrument-spec schedule 已提供事件时 provenance，但全窗口仍只允许一份不变的 accounting spec；会改变 tick、multiplier、settlement 等核算语义的 epoch、maker fee asset 与 mark-price 独立 increment 尚未认证，故只能声称 manifest-bound precision，不声称完整 venue precision。

### 9.2 Position accounting

v1 支持 `net` position mode：

- 同向增加按 filled qty 加权平均 entry；fee 不混入 entry，单独记账。
- 反向 fill 先以 `min(abs(position), fill_qty)` 平旧仓并确认 realized PnL；残余 qty 才按新方向开仓。
- reduce-only 禁止产生残余反向仓位。
- unrealized PnL 使用 Contract 指定 mark source；close/last 不能静默替代 mark。
- `R_initial` 的分母为初始已承诺风险；`R_max_live_risk` 的分母为路径中最大有效风险。partial/add/reduce 后两者都保留，禁止只报一套易看的 R。

当前 certified Result v35 的 Runner 闭包是 pre-entry `no_action*`、一笔 non-reduce entry、position-open `no_action*`，再选择“一次全仓止损收紧”或“一次 fixed partial + 可选 final full exit”。State Snapshot v3 冻结当下 Position/Cash 与 current protection；partial 后下一决策看到剩余数量与重建后的 order ids/trigger。stop/target/exact liquidation/EOD 都可成为唯一 terminal owner；halt 只暂停可执行 market/order facts，不取消 protection。该模型输出是确定性假设证据，不是历史交易所 order reconstruction。

### 9.3 Funding、fee、borrow、margin、liquidation

- Fee：逐 fill，以 maker/taker、tier、quote/base asset 与 rounding policy 记账。
- Funding：消费 exact funding event；以 phase `10` 的 signed position notional 与规定 mark 结算。无 exact events 时只能运行 `stress`，evidence grade 下降；官方字段与时间来源见 Binance [Funding Rate History](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History)。
- Borrow：只有 Contract/venue product 需要且有 point-in-time rate 时启用；USDM perp 默认 `not_applicable`，不能拿 funding 代替 borrow。
- Margin：`isolated` 只使用 position 隔离 collateral；`cross` 使用同 portfolio account equity。initial/maintenance tiers、mark source、fees 与 liquidation penalty 必须绑定 policy/data snapshot。
- Liquidation（受限实现）：exact Mark/funding-mark breach 后、策略订单前 cancel active stop/target，生成 forced reduce-only market 并全量成交；price=`trigger mark + frozen adverse slippage`，普通 fee 与 liquidation fee 分账，deficit 拒绝。Mark 只负责触发，模拟 Fill 不声称真实 exchange execution；OHLCV、partial liquidation、bankruptcy/insurance/ADL 未实现。Binance 官方把 Mark、MARKET order 与成交记录作为不同外部事实面，参照 [Common Definition](https://developers.binance.com/zh-CN/docs/products/derivatives-trading-usds-futures/common-definition) 与 [Liquidation Order Streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Liquidation-Order-Streams)。

## 10. Single-asset、Panel 与 Portfolio

每个 request 必须声明：

| 字段 | 值与语义 |
| --- | --- |
| `execution_scope` | `single_lane` / `independent_lanes` / `shared_portfolio` |
| `cash_scope` | 每 lane 虚拟隔离，或同一 account 共享 |
| `risk_budget_scope` | per-position / per-strategy / portfolio |
| `margin_scope` | isolated / cross |
| `order_namespace` | 保证 idempotency 与 cancel scope 不串 lane |
| `simultaneous_signal_policy` | 预声明排序、pro-rata 或 optimizer ref |

- Single-asset 可使用隔离 cash/risk，但仍走同一 ledger。
- Panel 默认是 `independent_lanes` 的研究聚合，不得把各资产各自拥有 100% cash 的结果称作共享 portfolio。
- Shared portfolio 在同 timestamp 先收齐 signals，再一次性计算资金、gross/net exposure 与 risk budget；allocation 之后才提交订单。
- 多资产 concurrent positions 共享 cash/margin 时，任何 fill、fee、funding、liquidation 都立即影响后续可用资金；按数组/字母顺序逐资产回放是不合法的隐含优先级。
- 当前 PRD 不做 hedge 多腿；本设计不借 portfolio 支持扩张该产品边界。

## 11. 数据时序安全

### 11.1 Point-in-time join

Feature/funding/OI/event join 使用 `entity_key + event_time + availability_at + revision_id`。对 decision time `t`，只取 `availability_at <= t` 的最后可见版本；禁止按最终修订值回填历史。每个被消费 record 的 source ref/version 进入 lineage hash。

### 11.2 Instrument-status producer authority

Producer implementation 与 normalization policy 都同时绑定 version + SHA-256 content hash；仅有版本字符串不构成可复现 authority。

`status_epochs` 是执行事实，`status_provenance` 是其生产闭包，两者必须独立 hash。Market Data Products 是唯一允许的 producer domain；`producer_id/version` 标识物化实现，`source_owner` 标识 venue truth owner，二者不得混为同一 authority。`source_kind=venue_status_event_archive` 才能出具 `complete_history`；attestation coverage 必须覆盖 Replay window，raw `source_ref/hash/count`、`source_observed_through`、`produced_at`、normalization policy 与 derived schedule hash 全部冻结。`venue_current_snapshot` 和 `periodic_snapshot_series` 只能出具 `current_snapshot_only`：增加轮询密度仍不构成“采样间无状态变化”的证明。Control Plane 只冻结 ref/hash，Replay Adapter 只验证闭包；Replay 不调用 venue API、不从 OHLCV 缺口推导 status、不纠正 archive，也不把 attestation 误报为第三方签名或外部完整性审计。

R4.53 的 owner 链为：venue-owned raw source → `market-data-store` immutable archive → `instrument-status-provider` deterministic normalization → Dataset Manifest → Replay Adapter。Store 只接受 event sequence 从 1 连续、effective time 严格递增、状态交替、首事件不晚于 coverage start、每条 observation 落在 `[effective_at, source_observed_through]`，且完整 archive 的 finality watermark 不早于 coverage end；archive id 冲突且内容不同必须失败。Provider 不写 Store，不缩短/扩大 coverage，不筛掉中间 transition；首 epoch 从 coverage start 取 anchor state，末 epoch 在 coverage end 封口。Provider Capability 的 build/policy hash 与 provenance 对齐，self-hashed evidence 再绑定 archive hash、requested window、epochs 和 provenance。此链证明仓内内容闭包、幂等与确定性，不证明 venue 在 archive 外没有遗漏事件；在 Control Plane 建立认证 provider registry 前，任意 caller 自填相同字段仍不能被解释为受信任的外部来源。

R4.55 将 Store 的“content closure”细化为三层：Source Batch Manifest 锁 raw content hash/count 与相邻 coverage/hash link；Completeness Audit 锁导入批次序列无 gap/overlap并明确不验证外部穷尽性；Archive Hash 再锁批次、audit、normalized transitions 与可选 supersession。`complete_history` 因而只表示本 archive 声明并闭合的历史窗口，不得脱离 `external_completeness=not_verified` 解读为 venue 真相已穷尽。Provider Evidence v3 直接暴露 audit/batch-chain/supersession hash，而 Dataset Provenance 的 `source_hash=archive_hash` 已传递绑定相同闭包。修订链不改变冻结证据：旧 Trial 不追随 successor，新 Trial 也不得在缺少 Control Plane selection policy 时隐式“取 latest”。

R4.56 在 Source Batch 之前增加 acquisition authority：每个 response（包括 429、5xx、invalid body）以 exact BLOB、payload ref/hash/bytes 和 Attempt hash 保存；attempt ordinal 连续、时间不倒退、成功后不可继续 retry，terminal receipt 必须等于末次 outcome。失败分类只控制本次 collector 重试，不赋予 Replay retry 权限。当前 Binance REST `exchangeInfo` receipt 无 historical coverage，故即使 status 为 `TRADING`、重复轮询或 commit 幂等，也只能是 `current_snapshot_only`；Store 在 Source Batch commit 时以 receipt/payload 外键和语义核验双重拒绝能力升级。离线 historical import 则必须显式声明半开 coverage 和 finality watermark，并保留原始 payload；它仍是 imported claim，不是 venue-signed history。

### 11.3 Listing、delisting、survivorship

- Universe 必须由 point-in-time selection rule 在每次选择时刻物化，不接受“今天仍可交易的 symbol 列表”回放过去。
- `listed_at / trading_enabled_at / delisted_at / contract_spec_version` 是 instrument events；listing 前不生成 signal/order，delisting 后只能按冻结 settlement/expiry policy 处理。当前 Manifest 未绑定 settlement price，故开放仓位到达 `delisted_at` 直接 typed-fail，不把末根 close 伪造成可成交价格。
- inactive/delisted 数据缺失时显式 `survivor_only=true`；该 run 不能声称 survivorship robust。
- asset membership 与 selection score 都进入 Dataset/Contract hash，不只存 symbol 列表路径。

### 11.4 缺口与 stale

- Adapter 按 timeframe expected grid 检测 missing、duplicate、out-of-order、invalid OHLC、zero/negative price、unexpected partial candle。
- 缺 bar 不压缩 elapsed time、holding period 或 funding window，也不等于 observed open-price gap。当前 certified execution policy 固定为 `fail_before_unobserved_interval_effects`：缺 frozen earliest-executable bar 在 Fill 前失败；已开仓路径到达 gap 时，在前一 observed bar close 后、后续 Funding/Mark/open 与 checkpoint 前失败。
- `ReplayDataGapFailureEvidence v1` 必须区分 `missing_earliest_executable_bar / open_position_grid_gap`，并满足 `gap_start + missing_bar_count * interval = next_observed_open`。同一 immutable Dataset 的该 failure non-retryable，且无 partial Result/Artifact；更换/修复数据必须由 Control Plane 冻结新的 Manifest/Data Hash。
- 未消费的 pre-entry gap 可作为 limitation；terminal-before-gap 时未来 gap 不进入 consumed prefix，添加或删除它不得改变 semantic Result。严格 closed-bar decision lookback 的内部 gap、lookback 不足和 terminal close stale 均在 Harness 前拒绝。
- `no_signal / carry_with_stale_limit / resolution_limited` 仍是未来数据类型可协商政策，不适用于当前 OHLC execution grid；禁止 synthetic candle 与 forward-fill trade/volume/event label。
- 多 timeframe join 只使用已闭合且已 availability 的慢周期 bar；不能用未来 slow-bar close 填当前 fast row。
- manifest 的 `closed_candles_only=true` 是声明，不是证明；adapter 必须用 close time、run cutoff、checksum 与行级 invariant 验证。

Certified v7 已实现主 OHLC/funding、规则 schedule 与 supplemental signal-time PIT 准入子集：Runner 强制接收结构化 Dataset Manifest；request ref/hash、manifest ref/hash 与实际 canonical bars/funding/mark/supplemental revision stream 必须一致。Control Plane 从冻结 Experiment Contract 派生并授权 `Supplemental Requirement Set v1`；Replay 不解释研究意图，只校验其 canonical hash。每项 requirement 以 `source/entity/fact + inclusive event-time window + minimum visible event count + maximum latest-event age` 定义必需输入，scope 必须按 id 排序且互不重叠，未声明输入策略固定为 `reject`。Adapter 对完整 stream 执行闭世界校验：每条 revision 必须且只能命中一个 requirement；缺失、signal-time 不可见、陈旧、窗口外、未声明、多重匹配或 requirement hash 漂移均在首个市场事件前失败。supplemental record 仍强制 `event_time <= availability_at <= received_at`、同源 sequence 递增、同事实 revision id 唯一且 availability 递增；在 `signal_time` 只选择最后可见版本，未来修订保留在 Artifact 但不进入 decision view。

R4.28 将该 decision view 冻结为自哈希 `Decision Input Snapshot v1`：只含 `run_id + decision_time + requirement-set hash + selected records/hash`，故追加 signal-time 之后的未来 revision 不改变 snapshot hash，而完整 dataset/supplemental-stream hash 仍独立进入 Fingerprint。`signal_time_complete` lane 不再允许仅携带预计算 Order 进入 Engine：Harness 必须实际以 Snapshot 调用一次，派生 Order 与 Contract-authorized Request Order canonical 相等；Engine 再复核 Snapshot/Receipt/Order，幂等重读不得重复执行。`mode=none` 仍是 legacy precomputed-order lane，Bundle/Receipt 均为 `null`，不冒充已重算。

R4.29 消除 caller 直接注入“自称匹配 hash 的 callback”：Request v14 的 required-lane `harness_hash` 必须等于 Source Bundle v1 hash；Registry Capability v1 只按 hash 解析 process-lifetime immutable reviewed static registration。Capability/Receipt v2 与 Result v21/Artifact v23/Checkpoint v6 绑定 Bundle/Snapshot/Order/Loader；该历史切片只认证 source identity 和实际调用，不认证 build/runtime/process boundary。

R4.30 将该 gap 收紧为可执行 build/worker 合同：Request v15 语义下，Bundle 由固定 Bun build args 编译；metafile inputs 必须精确等于 source set + generated worker，输出不得残留 runtime import。Build Attestation v1 保存完整 artifact UTF-8 bytes/hash、Bundle hash、Bun version/executable SHA-256、Build/Worker Policy 与自哈希。Registry Capability v2 不再保存 callback；admission 从 Bundle 独立重建并与提交 attestation 逐字节一致，拒绝调用方自签任意 artifact。Runner 重验 runtime，物化精确 artifact，在 `TZ=UTC/LANG=C/LC_ALL=C`、5s timeout、1 MiB output cap 下启动两次 fresh stdio subprocess；两份 Worker Response canonical 相等才准入，Receipt 同时绑定 primary/verification hash。Result v22、Artifact v24、Checkpoint v7 与 Fingerprint 全链保存 build/runtime/worker parity。相同 Bundle 跨临时目录 build parity、fresh PID、forged build/external import/runtime drift/nondeterministic response/direct Engine bypass 和 idempotent zero-execution 均有测试。

R4.31 将四份并列 decision evidence 收敛为 `Decision Evidence Timeline v1`。Timeline 按 `decision_time_then_sequence` 排序并自哈希；Entry 绑定 `decision_sequence`、decision time、authorized Order hash、Snapshot 及 nullable Bundle/Build/Receipt，Entry 自身也独立哈希。v1 强制 `single_authorized_decision`：required lane 必须提交唯一 attested Entry，`mode=none` 可由 Engine 确定性生成唯一 precomputed-order compatibility Entry。Result v23 只内嵌 Timeline；Artifact v25 只落盘 `decision-evidence-timeline.json`；Fingerprint 与 Engine Checkpoint v8 绑定 Timeline hash并保留成员派生 hash 便于审计。空/多 Entry、顺序/时间/Order 漂移、member 或 Timeline hash 篡改、required direct bypass、resume Timeline 漂移均拒绝。该 phase 只建立未来多 boundary 的证据 owner 和迁移 seam，不宣称多次 signal evaluation、动态 PIT join 或多订单状态机已实现。

R4.32 增加自哈希 `Decision Boundary v1` 并升级 Timeline v2。Boundary 固定 `boundary_sequence=1`、`contract_frozen_initial_signal`、evaluation time、market/supplemental cutoff、earliest executable time、`closed_candle`、`signal_time_snapshot` 与 `next_open`，同时强制 `decision_origin=frozen_request_order`、`market_input_evidence=declared_not_materialized_or_recomputed`、`market_input_snapshot_hash=null`。这是诚实性合同：当前 Harness Worker 只接收 Request 与 supplemental Snapshot，没有接收市场特征/closed-candle Snapshot，因此 attested Harness 也不能证明市场 signal 被重算。Result v24 添加 `decision-market-input-recomputation-uncertified` limitation；Artifact v26、Fingerprint 与 Checkpoint v9 绑定 Boundary/Timeline hashes；Run Outcome 升至 v21。时间、policy、evidence claim、Boundary/Entry/Timeline hash 或 resume binding 漂移均拒绝。下一步若要消除此 limitation，必须先定义 Market Decision Input Snapshot，并让 Harness 输入不再依赖 Request 中预填 Order，而不是仅把 cardinality 放宽。

R4.33 完成该最小可信纵切。Request v16 冻结 `Decision Market Input Requirement v1`：`none` 是兼容 lane；`closed_bar_lookback` 强制 OHLCV 字段集、正整数 lookback、`close_time <= decision_time`、终根 `close_time == decision_time`、严格 interval grid 与未声明输入拒绝。Adapter 不接收旁路行情，而从 Manifest/Data Hash 已覆盖的完整 `bars` 截取 Snapshot v1；不足、未来可见、终根错位或 gap 均在 Harness 前失败。Worker Protocol v2 用 `Decision Harness Context v1` 白名单替代完整 Request，Context 只含 identity、symbol/timeframe、decision/earliest-executable time、seed 等非 Order 字段；Harness 同时消费 supplemental 与 market Snapshot，连续两次 fresh subprocess 输出必须一致且等于冻结 Order。Boundary v2 仅在该 lane 声明 `materialized_closed_bar_lookback + attested_harness_verified_frozen_order`；兼容 lane继续输出 `not_required_compatibility`，并保留 `decision-market-input-recomputation-uncertified` limitation。Timeline v3、Build Attestation v2、Registry Capability v3、Harness Capability/Receipt v4、Result v25、Artifact v27、Checkpoint v10、Run Outcome v22 绑定 requirement/context/snapshot/worker hashes；Artifact 新增独立 `decision-market-input-snapshot.json`。测试覆盖 lookback 不足、grid gap、future-visible、Worker 无 `order`、market-derived Order parity、Artifact/Fingerprint/checkpoint 与 deterministic rebuild。该 phase只认证一次 initial decision，不宣称 feature DAG、滚动 signal、动态订单或任意策略执行。

R4.34 把该单点 seam 扩成 Control Plane 授权的最小滚动决策闭包。Request v17 冻结 `Decision Schedule v1 + hash`；sequence/time 严格递增，当前 capability 只接受零到多个 `no_action`，最后且仅最后一个 entry 可绑定 Request 中唯一 `authorized_initial_order`。多 entry 强制 `supplemental mode=none + closed_bar_lookback`，防止把尚未设计的动态 supplemental window 偷渡为已认证能力。Adapter 按 schedule 对同一 hash-bound bars 重做每个 PIT Snapshot；Context v2 增加 sequence，`no_action` 的 earliest executable 为 `null`。Worker Protocol v3 输出 tagged `decision_output`，双进程 parity 后还须等于 schedule 预期；Receipt v5、Boundary v3 与 Timeline v4 逐 entry 绑定 output/snapshot/context，Engine 重新从 Dataset 计算全部 entry 的 PIT inputs，不能只验证最终入场点。Result v26/Fingerprint 加入 schedule hash，Artifact v28/Run Outcome v23 完成版本推进；effect-bearing 最终 entry 继续作为现有单仓 Engine/Checkpoint 的经济入口，完整 Timeline hash 覆盖此前所有无动作证据。测试锁定两次 boundary 各自 close-time Snapshot、独立回执、`no_action -> authorized_order` 顺序、schedule hash/时间/效果篡改拒绝及既有 golden digest 不变。该 phase 不支持持仓后决策、动态 supplemental join、第二笔订单、cancel/replace、加减仓或 exit signal。

R4.35 先消除上述“最终 entry 等于经济入口”的隐含位置耦合，不改变 wire schema 或扩大 capability。Contract 提供唯一授权语义定位器；Adapter 从 Schedule 的 `authorized_initial_order` 选择权威 signal-time 输入，Engine、Artifact writer/reader、Harness 默认 Context 与 Fingerprint/Checkpoint 派生成员从 Timeline 的 `authorized_order` 选择经济入口。完整 Timeline hash 仍是所有 boundary 的集合 authority，单项 snapshot/receipt/build hash 只是唯一入场授权的便捷投影。缺失或重复授权均拒绝。这样后续可在授权入场之后追加持仓期 `no_action/not_reached`，而不会把 Result 主投影错绑到最后一个观察点。当前 Schedule v1 仍强制授权入场排末尾并拒绝持仓后 boundary；下一纵切必须在 Source Reducer 的非终止 closed-bar boundary 内生成 Position/Cash State Snapshot，terminal 先发生时写 `not_reached`，Checkpoint 保存已消费 Timeline prefix，禁止执行结束后事后调用 Harness。

R4.36 完成第一条 post-entry 只读纵切。Schedule v2 以相对 frozen signal/earliest-executable time 推导 `pre_entry / initial_entry / position_open`，只允许后者声明 `no_action`。Runner 不预执行 position-open entry，而以 `pending_runtime` 交给 Engine；Source Reducer 仅在非终止 `bar_range` 后生成 State Snapshot v1，绑定 EventKey/source-prefix、open Position、average entry、closed-bar mark、cash、fee、funding、unrealized PnL 与 equity，再由 Worker Protocol v4 的双 fresh subprocess 求值。风险/stop/target/liquidation 先终止时 Entry 最终化为 `not_reached_terminal`，无 State/Receipt，terminal EventKey 说明原因；正式 Result 禁止残留 pending。Checkpoint v11 内嵌当前 Timeline，因此 resume 复用已提交的 post-entry receipt，不重跑过去 boundary。Context v3、Registry v4、Capability/Receipt v6、Boundary v4、Timeline v5、Result v27/Fingerprint state-hash vector、Artifact v29 与 Run Outcome v24 完成绑定。测试覆盖运行时仓位/资金值、state hash 篡改、同刻 terminal 优先、checkpoint prefix/resume 零重复 post-entry 调用及既有 golden economic digest 不变。

R4.37 完成第一条 effect-bearing post-entry 纵切。Schedule v3 增加至多一个且必须末位的 `authorized_reduce_only_exit`；Exit Intent v1 冻结 opposite side、market、reduce-only、`full_open_position`、signal 与 earliest executable time，禁止 partial/add/reversal。Harness Context v4 在持仓边界暴露冻结执行时点，Worker Protocol v5 必须复算完全相同的 Intent；Engine 在非终止 closed-bar 后提交 `strategy_exit` Order，Checkpoint v12 保存该 submitted Order，严格更晚的 frozen bar open 才 activate/fill。相同 open 的 exact risk、stop gap、target gap 均优先；决策前 terminal 写 not-reached，提交后抢占则取消 strategy exit。Timeline v6、Boundary v5、Registry v5、Capability/Receipt v7、Result v28、Artifact v30 与 Run Outcome v25 完成绑定。测试锁定正常 full close、State/Intent hash、stop-gap 抢占、同刻 terminal、checkpoint tamper/resume parity、旧 golden economic digest 不变；该能力仍不是通用 order-management API。

R4.38 完成第一条保护单变更纵切。Schedule v4 最多冻结一个 `authorized_protective_stop_replace`；Protective Stop Replace Intent v1 冻结 opposite-side、stop-market、reduce-only、`full_open_position`、旧/新 trigger 与 `tighten_only_cancel_then_submit`，long 只能上调、short 只能下调，且不得穿越 target。State Snapshot v2 将当前 active stop/target 及 remaining quantity 纳入自哈希；Harness Context v5、Worker Protocol v6 复算相同 Intent。Engine 在非终止 closed-bar 后以同一 phase 的固定 subphase 执行 old cancel → new submit → new activate；新 stop 已被当前 close 穿越则拒绝，不伪造已消失的 bar 内路径。Source Reducer 从当前 active stop 读取后续 gap/touch；Checkpoint v13 内嵌替换后 protection state。Timeline v7、Boundary v6、Registry v6、Capability/Receipt v8、Result v29、Artifact v31 与 Run Outcome v26 完成绑定。测试锁定 transition 顺序、后续 gap fill、terminal not-reached、checkpoint tamper 拒绝、clean/resume parity 与已消费 Harness 零重跑。该能力不外推为通用 cancel/replace、stop loosening、target amend、continuous trailing 或 partial protection。

R4.39 不新增 schema/version，而是将 R4.37–R4.38 的组合空白升为认证事实。`replace -> strategy exit` fixture 要求后一 Harness State Snapshot 观测 replacement stop，随后 submitted exit 与 active protection 共同进入 Checkpoint；恢复后 exit 全成，replacement stop/target 以 `strategy-exit-filled` 取消，且只存在 entry + terminal 两个 Fill。`replace -> exact liquidation` fixture 要求 phase-15 依次取消当前 stop、target，再 forced submit/activate/fill；不回读已取消的初始 stop。R4.38 已覆盖 replacement stop 自身 gap fill 及取消 pending exit 的优先级。因此三类终止均共用一个 EventKey/order-state owner，没有平行 terminal arbitration。

R4.40 继续不新增 schema/version。以固定中心价映射 `p' = 2c - p` 构造 long/short 镜像 bars、entry、initial stop、target 与 replacement stop；long 向上收紧和 short 向下收紧均通过 Harness/State binding。replacement 后的终止 bar 同时穿越 stop/target，两侧均产生 stop Fill 和 `ohlcv-stop-target-collision / resolution_limited`；镜像 Fill 价格、net/realized PnL、return、trade count 与 OrderEvent phase/subphase 一致。这证明当前 simple-bracket 保守包络的方向对称性，不证明真实 intrabar path，也不把 stop-first 升级为多订单通用解析制度。

R4.41 冻结 `trade.rd-replay-partial-reduce-intent-draft.v1`，但故意不推进 Request/Result/Artifact 版本。Draft Intent 绑定 opposite side、market、reduce-only、fixed quantity、closed-bar signal/next eligible open、`must_remain_open`，且 quantity 严格小于 initial quantity。`rd-replay-partial-reduce-protection-v1-draft` 绑定 partial Fill 后的同 source boundary 执行 old stop/target cancel → remaining-quantity stop/target submit/activate，价格保持当前 trigger，数量 authority 只能是 post-fill Position。组合范围仅为 one partial → optional final full exit，不与 stop replacement 并存。当前 Reference Engine 仍把 strategy exit 视为 terminal，certified Position Projection 仍拒绝 partial close，Checkpoint 也未有 protection generation；因此 draft capability 的 Reservation 必须 unsupported，没有 Result/Artifact。

R4.42 将其正式化为 `trade.rd-replay-partial-reduce-intent.v1 / rd-replay-partial-reduce-protection-v1 / next-open-fixed-quantity-partial-reduce`。Request v21 / Schedule v5 增加 `authorized_partial_reduce`，Harness/Timeline/Boundary/State 分别推进到 Context v6、Worker v7、Registry v7、Capability/Receipt v9、Timeline v8、Boundary v7、State v3；Simulator v8 新增独立 non-terminal lane。测试锁定 long/short 数量对称、phase `20 fill -> 90 cancel/cancel/submit/activate/submit/activate`、partial+final 的三笔 Fill 投影、逐 Fill fee/realized PnL、post-partial Funding、next State protection、terminal preemption，以及 Checkpoint v14 clean/resume parity。Result v30、Artifact v32、Run Outcome v27 完成 wire epoch 推进。该认证只证明模型内 fixed quantity 全成，不证明 maker queue、成交概率或真实 partial liquidity。

R4.43 不新增 Request/Result/Artifact capability，只推进 Engine Checkpoint v15 并补齐组合认证。partial Fill 后重建的 stop/target 在下一 `bar_range/open` 只按剩余 quantity 触发；exact-risk liquidation 取消 current bracket 后 forced full-close 剩余 Position；EOD 取消 current bracket、保留 open Position 且不造 Fill；final strategy exit 延续 R4.42。long/short lane 对四类 owner 具有同构 transition。恢复校验新增 `event_sequence == max(OrderEvent.sequence)`、Order 与其最后 OrderEvent 一致，以及 partial Order/Fill、重建 stop/target 的确定 id/type/side/quantity/trigger 与冻结 Intent 一致；测试证明篡改 trigger 后即使重算 checkpoint hash 仍拒绝。

R4.44 新增 `trade.rd-replay-ohlcv-resolution-evidence.v1`、Result v31、Artifact v33 与 Run Outcome v28，但 Simulator 保持 v8：变更的是证据可审计性，不是 Fill 决策。Reference Engine 在 stop/target gap/touch 处生成 two-path simple-bracket evidence；Contract 校验 path id/order、bar geometry、bracket orientation、EventKey boundary、observation/status/reason 组合、path digest、canonical role 与 evidence hash。Runner 以 required artifact role 发布证据并在幂等复读时与 Result/Fingerprint 三方核对。golden、long/short collision、gap/single-touch、semantic tamper、价格/资金 scaling metamorphic 均已锁定；multiple order、limit queue、真实 bar 内路径仍未认证。

R4.45 不推进任何 wire epoch。`certified-ohlcv-resolution-oracle-v1.json` 冻结 8 条完整 bar interval ordered-price traces；Plane-local test oracle 独立聚合 OHLC、按已知顺序求 first crossing，再与生产 `createReplaySimpleBracketOhlcvResolution` 比较。golden parity 锁定 outcome containment 与 canonical non-improvement；same-OHLC parity 锁定 long/short high-first/low-first 可产生相反真实 owner；densification metamorphic 锁定分段内插值不改变结果。Oracle 无 Result/Artifact authority，不能作为 tick capability 使用。

R4.46 推进 `trade.rd-replay-ohlcv-resolution-evidence.v2`、Result v32、Artifact v34、Run Outcome v29 与 Engine Checkpoint v16，Simulator 仍为 v8。Engine 将初始 protection 标为 generation 1，唯一 replacement 或 partial resize 完成后标为 generation 2；resolution evidence 嵌入 remaining quantity、stop/target Order id/trigger 与 protection hash。Contract 先验 bracket/path/self-hash，Runner 再把 evidence 与 consumed SourceEvent、双保护 submitted/activated、terminal triggered/Fill 交叉核对。测试覆盖 initial、replacement、post-partial stop/target、重算 evidence hash 的 stale-generation 篡改、重算 checkpoint hash 的 generation 篡改和 clean/resume parity。该 generation 只描述当前 certified mutation subset，不开放 repeated amend。

R4.47 推进 `trade.rd-replay-ohlcv-resolution-evidence.v3`、Result v33、Artifact v35 与 Run Outcome v30；Request/Checkpoint/Simulator 不变。每个 path digest 新增 directionally rounded execution price、gross realized PnL、exit fee、net terminal contribution；Economic Impact Envelope 绑定 cost/numeric policy、instrument increments、entry basis、quantity、min/max/span、canonical contribution/shortfall 与 impact hash。Contract 校验 envelope 结构，Runner 从冻结 Request、Dataset accounting 与实际 entry Fill 重算，并要求 canonical price/fee 等于 terminal Fill。golden、long/short cost arithmetic、exact-zero-span、collision-positive-span、价格/现金 scaling、policy/evidence/Fill tamper 与 Artifact replay 已认证。

R4.48 不改变 Request v21、Result v33、Artifact v35、Run Outcome v30、Checkpoint v16 或 Simulator v8。`certified-ohlcv-economic-oracle-v1.json` 冻结三套成本/精度 profile 与两条手算 collision golden；同包测试以不依赖 production decimal/accounting 的 BigInt rational oracle，逐项比较 8 条 ordered-price trace × 3 profile × 2 admissible path 的 execution price、gross、fee、net，并验证 ordered actual path containment、canonical non-improvement、envelope 聚合和 densification invariance。Oracle 只拥有 certification authority，不进入 Result 或 Artifact。

R4.49 同样不改变任何 production version。`ohlcv_economic_oracle.py` 暴露 certification-only JSON Request/Response v1；所有 decimal 输入必须为 canonical string，success 保序返回 canonical string economics，非法 schema/direction/decimal/重复 id 返回非零退出与 typed `input_invalid`。Bun certification 通过 `scripts/resolve-python.sh` 解析解释器，一次提交 48 条向量，并将 Python Decimal 结果同时对齐 R4.48 BigInt oracle 和 Evidence v3；Python unittest 另锁 long/short 手算 golden、协议保序、重复 id 与非法输入。该 CLI 不是 Plane port、tool registry 或 runtime adapter。

R4.50 推进 Simulator v9 与 Run Outcome v31，不改变成功 Result/Artifact/Checkpoint/Dataset schema。Contracts 新增自校验 Data Gap Failure Evidence；Adapter 要求 frozen earliest executable time 必须恰好命中 bar open，缺失时在 Fill 前失败；Engine 在每个非终止 bar range 后、checkpoint 前检查下一 observed open，持仓路径不可跨越缺失 interval。Runner 将两类 failure 统一映射为 non-retryable `data_integrity`，不发布 partial Result/Artifact。认证覆盖 missing-entry、post-entry gap、Funding 位于 gap 内不被消费、clean/resume 同 failure、terminal-before-gap 的完整 semantic equality，以及 strict lookback stale terminal 拒绝。该协议既不推断 halt/delisting，也不把未知区间升级为 OHLC path limitation。

R4.51 推进 Trial Reservation v6、Request v22、Dataset Manifest v8、Result v34、Artifact v36、Checkpoint v17、Run Outcome v32 与 Simulator v10。Manifest 新增 complete PIT status epochs；Request/Reservation/Fingerprint 分别绑定 status hash。Adapter 拒绝 halted decision/executable boundary、跨 halt bar、schedule drift 与 `current_snapshot_only` 历史 halt；Source Reducer 仅对完整 frozen halt gap 放行 continuity fence。phase-`00` halt/resume、停牌 Funding、恢复首 open gap、halted maintenance typed failure、delisting priority 与 cancel/resume parity 已认证。该能力不从缺 bar 推断停牌，不定义 halt/delisting settlement。

R4.52 推进 Trial Reservation v7、Request v23、Dataset Manifest v9、Result v35、Artifact v37 与 Run Outcome v33；Checkpoint v17、Simulator v10 不变。Manifest 新增 Instrument Status Provenance v1，Request/Reservation/Fingerprint 分别绑定 provenance hash。Contract/Adapter 拒绝非 Market Data producer domain、schedule/source-owner/completeness/hash drift、archive coverage 不足，以及 current/periodic snapshot 的 complete claim；相同 epochs 更换 source 或 normalization 也改变证据身份。该能力是 producer/completeness contract，不是 production collector、外部 archive 审计或 settlement model。

R4.53 不推进 Replay production schema。Market Data Store 新增 Archive v1 两表与 immutable immediate-CAS；Provider Capability/Evidence v1 固定 producer build manifest、Normalization Policy v1、finality policy 与 archive input schema。认证覆盖 idempotent recommit、same-id mutation、hash/count/order/redundant-transition、anchor/finality/window failure、deterministic epochs、capability/evidence tamper、read-only CLI，以及 Provider 输出对 Replay Request/Manifest 的跨域准入。该 phase 认证仓库内 source-to-manifest closure，不认证 venue 外部穷尽性、签名、自动采集或 halt/delisting settlement。

这一闭包证明 deterministic source-to-artifact closure、执行时 exact runtime binary、冻结 pre-entry/position-open schedule 的逐 boundary market/state PIT、一次 tighten-only stop replacement、一次 full reduce-only exit Intent parity、三类终止组合唯一 owner、方向镜像 parity 及单请求进程边界；它不证明第三方签名 provenance，不支持任意外部依赖/SBOM，也不是 OS sandbox。Result 使用 `decision-harness-os-sandbox-uncertified` info limitation。其他 effect-changing decision、动态 supplemental join 与完整 feature DAG trace 仍未认证；不得表述为任意 Candidate 安全执行闭包。

## 12. Step/Event-driven 与 Fast/Vectorized

Step 是权威 reference implementation。Fast 只是相同语义的优化后端，必须输出相同 normalized semantic digest：

```text
orders + fills + ending positions + ledger balances + metrics inputs
  -> canonical semantic digest
```

Fast v1 只允许以下闭包：closed-candle signal、next-open market/rebalance、固定 deterministic sizing、无 active conditional orders、无 intrabar decision、无 partial/queue、无 dynamic trailing、无 margin/liquidation、无 shared-capital contention。以下策略强制 Step：limit/stop/TP、same-bar 可能性、加减仓、partial exit、reduce-only ladder、cancel/amend、path-dependent risk、exact funding 与 bar 内持仓变化冲突、shared portfolio margin、liquidation。

Parity 不是“metrics 接近”，而是对同一 Request 的 semantic digest 完全一致；数值容差只允许由统一 decimal policy 明示。任一 supported fixture 不一致，Fast capability 整体降级，不得逐结果挑选更好路径。

## 13. Metrics、Artifact 与 Fingerprint

### 13.1 Metrics Contract

`replay-metrics.v1` 至少包含：

- coverage：start/end、event/bar count、missing/stale、resolution-limited exposure；
- execution：orders、fills、fill ratio、partial/cancel/reject、slippage、impact、turnover；
- position：holding time、gross/net exposure、concurrency、MFE/MAE；
- PnL：gross、realized、unrealized、net、`R_initial`、`R_max_live_risk`；
- cost：maker/taker fee、funding、borrow、slippage/impact attribution、liquidation penalty；
- portfolio：NAV、cash、margin usage、peak exposure、drawdown、liquidation count；
- trade distribution：sample、win rate、profit factor、expectancy、quantiles。

每项 metric 必须声明 unit、currency/denominator、aggregation、missing policy 与 version。`profit_factor=999999` 之类 sentinel 不进入权威 schema；无 loss 时用 typed `null/+infinity-policy` 表达。研究 gate、DSR/PBO、winner selection 属于 Control Plane，不混进 execution metrics。

当前 Result v35 认证基础 PnL/cost、observed margin 与独立 `total_liquidation_fees`，并持久化 Schedule/Boundary/Timeline 与 OHLCV Resolution Evidence v3；Metrics 的 `ohlcv_resolution_limited_count / ohlcv_net_terminal_contribution_span / ohlcv_canonical_shortfall_to_best` 只派生自 evidence，不反写 Fill/Ledger。partial 的经济效果仍只能由 Fill → Position → Ledger → Equity/Metrics 派生。exact breach Result 含 simulated liquidation execution；OHLCV 或 halted maintenance breach均无正式 Result metrics。

### 13.2 Artifact Manifest

```text
artifact-manifest.json
├── request.json
├── trial-reservation.json
├── attempt-lease.json              # 实际 producer；不进入经济 fingerprint
├── dataset-manifest.json
├── supplemental-facts.json        # 完整 immutable revision stream
├── decision-market-input-snapshot.json # 已绑定 dataset 内的 closed-bar lookback；none lane 为空快照
├── decision-evidence-timeline.json # Boundary、两类 Snapshot、Bundle/Build/Receipt 的唯一权威容器
├── normalized-market-events.*
├── order-events.*
├── fills.*
├── positions.*
├── ledger.*
├── ohlcv-resolution-evidence.json # simple-bracket P1/P2、canonical path、resolution status；必需角色，可为空数组
├── valuation-snapshot.json
├── equity-bridge.json
├── margin-snapshots.json
├── liquidation.json               # null 或 Liquidation Execution v2
├── nav-series.*
├── metrics.json
├── limitations.json
├── diagnostics/                    # 非 promotion evidence
├── terminal completeness checkpoint # manifest 内完整提交摘要；不可 resume
├── engine checkpoint v17           # 非权威可恢复 payload；内嵌 Timeline、protection generation、partial/pending exit 与 status/source prefix
└── diagnostic checkpoint commit v2 # immutable versioned marker + storage policy；登记 Receipt 后方可授权恢复
```

当前 Artifact v38 通过 Artifact Store port 在 `logical idempotency key / attempt_id` namespace 中提交并绑定 storage policy；Fingerprint 分别绑定 status schedule、Provenance v2、provider capability 与 Control Plane certification receipt hash。Runner 在执行和幂等复读时要求 Dataset certification ref/hash/capability 与 Reservation 内嵌快照、Request bindings 完全一致，再重验 Result/evidence。Checkpoint v17 通过 Request hash 间接冻结该认证闭包，恢复后必须重建同一 Result hash。local CAS 已认证，remote target 仍未认证。

### 13.3 Evidence Fingerprint

Fingerprint payload 使用与 Control Plane 一致的 `SHA-256(UTF-8(JCS(normalized_payload)))` 与冻结 `identity_hash_policy_version`，至少绑定：

- `experiment_id`
- `trial_group_id + trial_group_hash`
- `trial_id`
- `candidate_id + candidate_identity_hash`
- `identity_hash_policy_version`
- `experiment_contract_hash`
- `trial_reservation_hash`
- `dataset_manifest_hash + data_hash`
- `supplemental_facts_hash`（完整 revision stream）、`supplemental_requirement_set_hash`（Contract-derived 闭世界需求）、`decision_boundary_hash`、`decision_evidence_timeline_hash`、按 schedule 对齐的 `decision_state_snapshot_hashes`、其派生的 `decision_input_snapshot_hash`、nullable `decision_harness_bundle/build-attestation/build-artifact/runtime/receipt` hash 与 Registry/Build/Loader/Worker Policy version
- `venue_risk_policy_schedule_hash`
- `instrument_spec_schedule_hash`（覆盖有序 spec provenance epochs 与全窗口 accounting fields）
- `instrument_status_schedule_hash`（覆盖 complete PIT `trading/halted` epochs；与 spec/accounting identity 独立）
- `instrument_status_provenance_hash`（覆盖 producer/source/completeness/coverage/normalization/raw-source/derived-schedule attestation；与相同 epochs 的 schedule hash 独立）
- `instrument_status_provider_capability_hash + instrument_status_provider_certification_hash`（认证收据本体由 Trial Reservation v8 内嵌；Dataset Provenance v2 同时给出相同 certification ref/hash）
- `executable_candidate_code_hash`
- `harness_hash`
- `assumptions_hash`
- `cost_policy_id/version/hash`
- `simulator_policy_version`
- `numeric_policy_version`
- `margin_policy_version + margin_policy_hash`
- `ohlcv_resolution_evidence_hash`（ordered self-hashed evidence collection；无 stop/target terminal 时绑定空数组 hash）
- `data_adapter_version`
- `metrics_policy_version`
- `execution_mode`
- `random_algorithm/version + seed schedule`（若适用）

artifact 路径、run wall-clock、日志文本不进入 evidence identity；内容 hash 进入 Result/Artifact Manifest。相同 fingerprint 必须得到相同 semantic digest，否则是 P0 determinism incident。

### 13.4 随机性与证据等级

| 等级 | 含义 | 可作为 primary Result |
| --- | --- | --- |
| `deterministic_exact` | exact event source 或 OHLC 两路径结果等价 | 可以 |
| `deterministic_resolution_limited` | 固定保守路径，但 admissible paths 有差异 | 可以提交事实，Reviewer 必须处理 limitation |
| `stochastic_diagnostic` | Monte Carlo/queue/impact sampling，固定 algorithm + seed schedule | 不可以单独作为 primary promotion evidence |

Monte Carlo 必须在确定性 baseline 之外运行；输出分布、seed schedule、trial count 与 convergence diagnostics。当前所谓 `monte_carlo` 实际是四个固定 trade-order 变换和固定 R drag，应改名 deterministic diagnostics，不能声称 stochastic robustness。

### 13.5 Engine versioning 与可复现

- `engine_version` 标识实现发布；required lane 的 `harness_hash` 是完整 Source Bundle identity；Build Attestation 与 Receipt 证明固定 source closure 生成 exact artifact、同一 Bun executable 启动 fresh worker 并返回绑定响应；这仍不是 OS sandbox 或第三方签名 provenance。`simulator_policy_version` 标识经济/撮合语义，各者不能互相替代。
- policy、rounding、event phase、fill、margin 或 metric 定义变化使旧 evidence stale；单纯优化只有在 golden/parity digest 不变时可沿用 policy version。
- 复现成功标准：同 Request/fingerprint 在受支持 runtime 上得到相同 artifact member hashes 与 semantic digest；只得到“相近 metrics”不算复现。

## 14. 幂等、重试、取消、失败与部分结果

Control Plane Attempt 状态为：

```text
claimed -> running -> completed
       \          \-> failed
        \----------> cancelled
         \---------> expired -> new attempt
```

- Trial Reservation 的 replay idempotency key 绑定完整 Request hash；Attempt 另有 claim idempotency key。相同 active claim 同 authority 返回同 lease，任一字段漂移冲突。
- Reservation expiry 只封闭新 claim；不撤销已在窗口内 claim 的 Attempt，也不替代 lease expiry。retry/resume 需要新 Attempt 时必须仍在原窗口内，否则由 Control Plane 重签新 authority，Replay 无权复活旧 Reservation。
- retry 创建新 `attempt_id/attempt_ordinal`，保持 logical `run_id`、Trial、reservation 与 request hash；每个 attempt 使用隔离 artifact 目录，不复用可被旧 worker 改写的 staging。是否计费仍由 Trial accounting policy 决定。
- 跨 Attempt resume 不是 retry 的默认权利：source 必须 `cancelled/expired`，其最新 Checkpoint Receipt 必须由有效 producer lease 登记；不可变 Resume Authorization 再绑定 receipt 对应 commit、later target Attempt/worker、claimed identity 与 lease generation floor。一个 target Attempt 只能对应一份授权。
- lease generation 是 fencing token：heartbeat 只能在旧 lease 有效时扩展 expiry 并 `generation+1`；旧 worker 可以产生 diagnostic 文件，但不能用旧 generation finalize authoritative Result。
- completed finalize 强制 `result_hash + artifact_ref/hash + terminal_checkpoint_hash`；failed/cancelled/expired 强制 failure class 且禁止 authoritative Result 字段。terminal row 由 SQLite trigger 保持不可变。
- engine 启动前 cancel 与 source-event boundary cooperative cancel 均已实现；边界只出现在该 source 的 risk/order/decision/partial/protection 副作用全部完成后。普通 cooperative cancel outcome 可携带 Engine Checkpoint v17（Timeline、State Snapshot v3、partial Order/Fill、current protection generation、pending final exit 与 status/source prefix）且禁止 Result/Artifact；resume 必须重验 authority、commit/payload hash、Timeline/member/order hash、source prefix、OrderEvent last-state 与 rebuilt protection semantics，并由 parity test 证明与 clean run 等价且不重放 partial Fill/Funding。若 cancel 绑定已 terminalize Attempt 的 authority receipt，Run Outcome v35 另带 Observation v1，但随后生成的 checkpoint 不能登记 Control Plane Receipt，除非取消前已有合法 Receipt 可被单独授权。terminal completeness checkpoint 仍仅证明 Artifact 完整提交，三者禁止混用。
- `failure_class = input_invalid | unsupported_contract | data_integrity | deterministic_engine | resource | external_io` 与 `retryable` 是机器合同，日志文本不决定重试。

## 15. 测试与认证矩阵

| 语义面 | Golden fixtures | Property tests | Metamorphic tests | Parity tests |
| --- | --- | --- | --- | --- |
| clock/visibility | close signal、next-open、funding boundary | 无事件可在 availability 前消费 | 全部时间平移不改相对结果 | step 与 replay chunking digest |
| execution authority | Reservation scheduled/immediate cancellation、active Attempt cancellation、terminal race、observation ack、pre-terminal outbox、ack registry/outbox persistence failure、restart recovery | receipt/observation/outbox self-hash、CAS/单目标；新 claim 在 effective boundary 阻断；active cancellation 精确命中 lease generation；directive 只接受未过期 exact lease；outbox 在 Engine boundary 返回 cancel 前提交且必须等于 terminal outcome；terminal 后无新 checkpoint/Result authority；三段 latency 非负守序 | 生效前 active claim 的幂等重送不变；Reservation-only cancellation 不改变 active Attempt；Attempt-only cancellation 不暗中禁止 retry；重复 observation/outbox 保留首次时间；persistence failure 仍 cancel 但不 ack；recovery 不增加 poll/Engine execution；authority cancel 清除无权 diagnostic 文件但保留 outbox，普通 cooperative resume 不变 | Control Plane claim/renew/finalize/Receipt fence + injected coordinator + local durable outbox + SQLite directive → pre-terminal Outbox/Run Outcome v35 Observation → Control Plane registry/latency projection；remote outbox/transport/polling/SLA 未认证 |
| OHLC path | stop/target、open gap、single touch、long/short high-first/low-first collision、path/economics tamper | P1/P2 order/digest、bar/bracket/EventKey、status/reason/canonical role 自洽；ordered oracle outcome 必在 envelope 内；独立 BigInt oracle 覆盖 buy/sell 滑点方向、gross floor、fee ceil、net/span/shortfall；重算 evidence hash 不能掩盖篡改 | price/cash 同比缩放不改 status/reason/path role/canonical；轨迹分段内加密采样不改 OHLC、ordered outcome 与 cost-aware evidence；未来补数据不改已终止证据 | 已认证 synthetic ordered-price/economic oracle ↔ simple-bracket two-path parity；真实 tick runtime、真实成本拟合、generic step resolver 尚未完成 |
| orders | market/limit/stop/TP/cancel race | fill 不早于 active；filled+remaining=requested | price/qty scale 后经济量同比 | fast supported order subset |
| reduce/position | multiple entry、partial TP、oversized/wrong-side reduce-only、reversal；partial quantity/时序/组合/保护非法输入 | reduce-only 不增仓/翻向；fixed quantity 留 open Position；partial Fill 后 stop/target 数量等于剩余绝对仓位；terminal preemption 取消 pending partial | long/short 数量镜像；同价 Fill 拆分保持经济终态；clean/resume Result hash 相同 | legacy simple resolver compatibility；partial Position/Ledger/State/checkpoint parity |
| numeric | bps price、fee、funding、linear PnL、weighted average、return vectors；integrated terminal contribution | 舍入方向不改善证据；所有现金事实 increment-aligned；canonical decimal string 与 typed invalid input | price/cash 同比缩放后 return 与 scaled PnL 精确等价 | 已认证 primitive Numeric v3 shared vectors；terminal path 的 production Evidence ↔ TS BigInt ↔ Python Decimal 三方 parity；完整 Result/多 runtime 尚未认证 |
| ledger/cost | fee、funding、borrow、impact | 借贷平衡；NAV bridge 可解释 | zero-cost policy 恢复 gross PnL | step/fast ledger digest |
| margin | isolated/cross、stop-liquidation collision | equity/margin 守恒；liquidation 后无未解释风险 | collateral 等比缩放 | 不允许 fast，断言 capability reject |
| portfolio | 同时多资产信号、资金不足 | cash/exposure/risk cap 永不越界 | asset permutation 在对称 tie policy 下不变 | batch/stream step digest |
| data safety | listing/delisting、revision、strict-lookback gap/stale、missing entry、open-position grid gap | 无 pre-list trade、无未来 join；gap bounds/count 自洽；缺口前禁止消费未来 source/checkpoint；失败无 partial Result | terminal-before-gap 时追加未来 gap 不改变 source/orders/fills/ledger/limitations；future revision 不改过去 decision | Adapter/Engine/Runner gap evidence；clean/resume 同 failure；完整 grid 的 observed-open gap 仍按 `worse_open` |
| instrument status | complete trading/halted/resumed、same-time delisting、halted Funding/Mark、resume gap、acquisition receipt/raw payload、immutable archive/provider、archive/current/periodic provenance、provider certification rotation/revocation | attempt chronology/hash/payload bytes/CAS 自洽；current snapshot 禁止生成 historical batch；archive sequence/transition/anchor/finality/content/CAS 自洽；termination non-retroactive/单终态/successor 同 provider；schedule 连续/覆盖/hash-bound；decision/executable/bar 不落 halt；缺 bar 只有全程 halt 才可跨越；halted breach 无 Result/Fill | 429→success retry、invalid body non-retry、receipt/termination idempotence、payload tamper、missing/mismatched receipt、相同 archive/provider 重跑；cutover 前 Reservation 不变、cutover 后旧认证拒绝/新认证通过；cancel/resume 不重放 status/Funding | Collector + Store receipt/payload/source-batch gate + Provider capability/evidence + Control Plane Certification/Termination/Reservation + Replay Contract/Adapter/Runner/Fingerprint；外部 venue authenticity/completeness 未认证 |
| supplemental completeness | none/required、缺失、陈旧、窗口外、未声明、重叠 scope | 每条 revision 恰好命中一项；每项 minimum/freshness 满足 | 增加 future revision 不改变 selected view/economic digest，但 lineage/fingerprint 必变化；删除 required fact 必失败 | Contract/Request/Manifest/Reservation/Result requirement hash 一致 |
| decision harness | registry 缺失、未知/tampered bundle/build、external import、runtime/loader drift、nondeterministic response、Order 漂移、direct Engine bypass | build source closure 精确；parity pair 为不同 PID 且 response 相同；幂等重读零执行 | 同 Bundle 跨临时目录 build attestation 相同；未来 revision 不改变 Snapshot | Runner/Engine 双准入；Result/Fingerprint/Artifact/checkpoint 的 bundle/build/runtime/worker hash 一致 |
| decision boundary/timeline | evaluation/cutoff/earliest time、lookback 不足/gap/future-visible、Worker Order 泄漏、exit/stop-replace/partial side/quantity/time/price 篡改、stop 放宽/穿 target/已被 close 触发、state/source-prefix/protection generation/trigger 篡改、terminal/stop-gap 碰撞、resume 漂移、缺失/重复授权 | Timeline v8 恰有一条语义入场授权、至多一次 tighten-only stop replace 或 fixed partial 和一个末位全量退出；partial protection/terminal owner 只消费剩余 Position；terminal 优先则 not-reached；State/Boundary/Entry/Timeline 自哈希，Checkpoint v17 另验 OrderEvent 末态、Intent、protection generation 与 status prefix | long/short 价格镜像及 partial terminal lane 保持 Fill/PnL/OrderEvent parity；stop-first collision 输出 resolution-limited；重算 hash 后的 trigger/generation 篡改仍拒绝；resume 不重跑已消费 post-entry/partial Fill | Contract/Adapter/Worker/Engine/Runner/Artifact/Checkpoint 的 schedule/market/state/boundary/timeline/active-protection/pending-order hash 一致 |
| identity/runtime | request/result/artifact golden hash | 同 key 异 request 必冲突 | artifact relocation 不改 evidence identity | clean run/checkpoint resume digest |

认证阶段：

1. `C0 contract`：schema、canonical hash、非法状态/输入拒绝。
2. `C1 single-lane`：现有 simple bracket fixtures 全部在 event+ledger 内核通过。
3. `C2 order fidelity`：partial/reduce/cancel/multi-entry 与 OHLC limitations 通过。
4. `C3 accounting/portfolio`：fee/funding/margin/liquidation/shared cash 守恒通过。
5. `C4 optimization`：Fast 在声明 capability subset 上全量 parity；否则只保留 Step。

Property tests 的核心 invariants：订单 qty、position qty、cash/NAV bridge、double-entry balance、reduce-only、no-future-data、no-fill-before-active、terminal state 单一、fingerprint/semantic digest 稳定。Golden fixture 必须保存输入、完整 event/fill/ledger 期望和 digest，不能只断言最终 `total_r`。

## 16. 渐进迁移顺序

### R0：冻结合同，不搬目录

- 冻结版本化 authority/evidence schema：Trial Reservation v8、Provider Certification/Termination v1、Reservation/Attempt Cancellation v1、Attempt Cancellation Observation v1、Attempt Lease v1、Checkpoint Receipt v2、Resume Authorization v1、Request v24、Dataset Manifest v10、Instrument Status Snapshot v1/Provenance v2、Supplemental Requirement Set v1、Decision Input/Market Snapshot v1、Decision State Snapshot v3、Partial Reduce/Reduce-only Exit/Protective Stop Replace Intent v1、Decision Schedule v5、Harness Context v6、Source Bundle v1、Build Attestation v2/Worker Protocol v7、Registry Capability v7、Harness Capability/Receipt v9、Boundary v7、Timeline v8、OHLCV Resolution Evidence v3、Data Gap Failure Evidence v1、Result v36、Artifact v38、Artifact Store Capability v1、Engine Checkpoint v17、Diagnostic Commit v2、Run Outcome v35、Cancellation Coordination Result v1；Simulator v10，Storage/Numeric/Journal/Equity/Margin Policy 不变。
- 给 v1 输出标 `legacy_single_trade_resolver`；停止向 v1 增加 promotion 语义。
- 建 current behavior fixture inventory，明确正式、临时、隐含和 known-bad。

### R1：第一条实现纵切

实现 **single-asset 4H closed-candle -> next-open market entry -> reduce-only stop/TP -> exact funding/fee -> ledger-derived Result**：一个 Trial、一个 net position、Step 模式、OHLC P1/P2 resolution、完整 ids/fingerprint/artifact manifest。先覆盖现有 next-open、stop-first、gap、break-even、partial TP + remaining stop、oversized reduce-only fixtures；旧 `replayStrategy` 通过 adapter 调新内核并比较 compatibility digest。

这是建议的第一条纵切，因为它同时穿过 Control Plane binding、data adapter、event ordering、order/fill、position、ledger、metrics、artifact 和 determinism，却不先引入 shared portfolio 或复杂 maker queue。

**当前状态：已完成 certified subset。** Trial identity、closed-candle/next-open、simple bracket、gap、fee/slippage/exact funding、ledger-derived metrics、artifact/fingerprint 已接通；golden digest 与 long/short stop/target 守恒已锁定。主路径已在 R3 子集上补齐 market/bracket order events，但通用 matching 仍不属于本阶段完成范围。

### R2：数据时序与身份硬化

- manifest/candle/PIT/availability/listing/gap validator；删除 universe time 乐观 fallback。
- 修正 code/harness/data/assumptions/cost hash 覆盖；Control Plane Trial reservation 原子校验。
- runner 实现 idempotency、typed failure、cancel、checkpoint/atomic commit。

**当前状态：完成 authority/storage/data/Harness 的受限闭包。** Control Plane 单写 Provider Certification/Termination、Reservation/Cancellation、Attempt/Cancellation/Observation、Checkpoint Receipt 与 Resume Authorization；Request/Execution Spec 冻结 Decision Schedule、status schedule/provenance 与 provider certification。R4.53—R4.63 已贯通 imported archive/provider、registry admission、source-batch audit、current-snapshot acquisition receipt、非追溯 rotation/revocation、emergency cancellation authority、transport-neutral coordinator、SQLite reference observation/ack/latency、no-replay ack retry、local durable outbox recovery 与 pre-terminal handoff；历史 archive 仍只能显式导入。OS sandbox、signed build provenance、remote adapter/provider fault certification、venue 历史 archive 自动采集/签名/外部穷尽审计、remote cancellation outbox/transport/latency SLA、halt settlement 与动态 supplemental join 仍未完成。

### R3：订单状态机

- limit/stop/TP、cancel/amend、multi-entry、partial、wrong-side/oversized reduce-only、reversal。
- 只有具备数据能力的 fill policy 才开放；maker queue 缺失继续 limitation/unsupported。

**当前状态：完成第六十一子集，R3 未完成。** R4.43 已认证 partial 后 terminal owner 闭包；R4.44–R4.49 冻结 simple-bracket resolution/economics 与独立跨语言 oracle；R4.50 阻断 missing-grid 被误当 observed gap；R4.51 将 complete halt gap 与普通缺口分离；R4.52 阻断 current/periodic snapshot 被包装成 complete history；R4.53 增加 imported archive/provider 内容闭包；R4.57–R4.63 补齐 provider certification 未来 admission、显式 cancellation authority、observation/ack、transport-neutral coordinator、no-replay ack retry、local durable outbox recovery 与 pre-terminal handoff。terminal preemption、long/short lane symmetry、economic-policy tamper rejection、status/provenance/continuity fence 与 clean/resume parity 已锁定。仍缺外部 venue completeness、multiple partial、真实 historical liquidity partial、通用 cancel/amend、limit/TIF、add/reversal、partial liquidation、halt settlement、generic OHLC resolver 与 step/fast parity。

### R4：统一 accounting

- 定点 decimal、double-entry ledger、逐 fill fee、exact funding、borrow 接口。
- isolated/cross margin、maintenance tiers、liquidation 与 penalty fixtures。

**当前状态：完成第六十一子集，未完成统一组合账本。** Request/Result 为 v24/v36，Artifact/Run Outcome 为 v38/v35；Simulator v10 的 accounting 算术不变，但缺失执行区间不得产生任何后续账本事实。partial fee/realized PnL、Funding、cash/equity bridge、Margin、post-partial liquidation 与 EOD valuation 已守恒；R4.51 允许 exact Funding/Mark 在 frozen halt 内继续进入账本/风险观察，R4.52–R4.63 只增强这些状态事实的来源、采集、准入、取消、observation、协调、ack retry 与 operational outbox 闭包，不改变经济执行。现有 certified lane 仍是单 settlement asset、单 isolated Position。borrow、cross/shared portfolio、halt settlement、partial liquidation、bankruptcy/insurance/ADL 与多资产组合尚未开始。

### R5：Portfolio

- independent lanes 与 shared portfolio 明确分开。
- panel/cross-sectional research 改为调用 Replay shared-portfolio mode；淘汰独立 position-return execution semantics。

### R6：Fast parity 与消费者切换

- 只实现受限 fast capability；逐 fixture semantic digest parity。
- candidate batch、panel、benchmark adapter 改走 runner；Reviewer 消费当前 Result schema。
- 无调用者后淘汰 legacy resolver、重复 cost/PnL simulator 与 v1 promotion gate。

**当前状态：只建立认证骨架。** 已有 golden、property、metamorphic 与 component parity；尚无 Fast kernel，因此不存在可宣称的 Step/Fast parity。兼容 engine 复用 accounting 纯原语并通过 legacy integration regression，只证明兼容行为未漂移，不证明 feature parity。

迁移不是整体重写：每一步都以 legacy/new 双跑、golden digest、可回退 adapter 为边界；先替换事实内核，再移动目录。不得先搬模块后继续保留多套语义。

## 17. 明确不做

- 不把已落的 Forward admission/runner 纵切扩展成正式 Shadow、账户事实或自动晋级。
- 不设计正式 Shadow、Live-small、Binance side effect 或真实账户对账。
- 不修改 Strategy Universe taxonomy、L0-L3 或 family 分类。
- 不让 Replay 生成 hypothesis、candidate、search space、winner、Review Decision 或 strategy status。
- 不把 Backtest、Replay Engine、Experiment Runner 合并成一个大模块。
- 不承诺无历史 L2 时的 maker queue、真实 partial probability 或精确 market impact。
- 不支持当前 PRD 排除的 hedge 多腿、跨账户、跨交易所或高频撮合。
- 不以“和 Binance 字段同名”替代版本化内部语义和 fixture 认证。

## 18. 尚未决策的问题

以下问题需要真实数据能力或 Control Plane 共同决策，本文不提前固定：

1. Numeric Policy v3 已冻结 certified arithmetic 与 Bun/Python parity；若未来把 wire number 改为 canonical decimal string，是否同时升级 Request、Dataset Manifest 与 Result，须以真实跨语言消费者需求决定，不能仅为形式上的任意精度提前破坏现有 wire。
2. OHLC `touch` limit 的默认 queue policy是 zero-fill，还是基于可证明 cross-through 的 conservative fill；必须由数据 capability 与研究用途共同决定。
3. shared portfolio 同时信号采用 pro-rata、预注册 priority 还是独立 allocator ref；不能由 symbol 排序代替。
4. venue risk/instrument spec 历史快照，以及 instrument-status event archive 的历史自动采集、venue 签名和外部 completeness audit owner；R4.56 已实现 current REST snapshot receipt、exact raw payload/retry 留存及 imported archive 保留/纠错，但 finality/authenticity 仍是 source assertion，不能声称自动复原 Binance 历史规则/状态。
5. Reservation/Attempt Cancellation v1、transport-neutral coordinator、进程内 no-replay ack retry、local durable outbox recovery 与 pre-terminal handoff 已冻结；SQLite reference path 可测三段 latency，重复 ack/outbox 保留首次时间，authority cancel 删除无权 diagnostic 文件但保留 operational outbox。Control Plane poll 返回与 local commit 之间仍无跨存储事务；outbox retention/GC、remote outbox/store、跨进程实现究竟用 push、poll、lease-renew response、IPC 或网络、停止确认 SLA、worker 不响应时的进程 watchdog，以及 provider build/capability receipt 是否需要外部签名，仍需结合部署模型决定，不能让 Replay 动态查询 registry 代替。
6. resolution limitation 的 materiality 只由 Reviewer stage policy决定，还是另有统一 quantitative threshold；Replay 本身不做晋级判断。
7. Artifact 大事件流采用 JSONL、Arrow/Parquet 或 SQLite bundle；无论格式如何，manifest/hash/schema 合同不变。
8. exact event mode 的 source sequence 在 aggTrades、mark、funding、instrument status 间如何映射；缺 exchange sequence 时必须保留 limitation。
9. Fast v1 是否值得实现；若当前 4H trial volume 不构成瓶颈，可以长期只保留 Step。

## 19. 保留、重构、拆分、淘汰摘要

| 动作 | 模块/实现 |
| --- | --- |
| 保留 | `research-control-plane/dataset-governance/data-split` 的治理语义；`replay-execution-plane/certification/calibration-suite` 作为认证来源；`replay-execution-plane/compatibility/replay-runner` 暂作兼容入口 |
| 重构 | 新 `replay-execution-plane` 已承接 reference kernel、Trial identity、输入准入、金额账本、派生指标与 artifact lifecycle；legacy engine 只复用稳定原语、补 parity adapter，不再 enrich |
| 拆分 | `replay-engine` 的 data/hash/cost/metrics；`panel-evaluator` 的 research gate 与 portfolio execution；`benchmark-engine` 的研究定义与可能的 fast primitive |
| 迁往角色层 | `candidate-batch-engine`、`strategy-family-engine` 的生成能力进 Developer；evaluation gate 进 Reviewer；campaign/supervisor 拆 program-control 与角色编排 |
| 淘汰 | parity/caller cutover 后淘汰 legacy single-trade resolver、脱节 lane helper、重复 panel/benchmark execution-cost semantics、Replay 内部 promotion gate |

## 20. 外部依据

访问日期：`2026-07-15`。外部资料只约束交易所字段/触发语义，不替代本项目 simulator policy 与测试认证。

- Binance USDⓈ-M Futures [New Order](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order)：order type、trigger、reduce-only 等外部映射依据。
- Binance USDⓈ-M Futures [Funding Rate History](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History)：历史 funding rate/time 数据合同。
- Binance USDⓈ-M Futures [Position Information V3](https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Position-Information-V3)：mark、liquidation、position 等账户字段参照。
- Binance USDⓈ-M Futures [Common Definition](https://developers.binance.com/zh-CN/docs/products/derivatives-trading-usds-futures/common-definition)：MARKET、MARK_PRICE、order status 与 symbol filters 的官方 vocabulary。
- Binance USDⓈ-M Futures [Liquidation Order Streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Liquidation-Order-Streams)：强平订单外部成交字段与 Mark 风险观察分离的依据。
