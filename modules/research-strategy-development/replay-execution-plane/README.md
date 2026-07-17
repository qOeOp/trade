# Replay Execution Plane

Instrument-status producer implementation 与 normalization policy 同时绑定 version + SHA-256 content hash，禁止版本字符串不变而实现漂移。

RD 确定性历史执行与证据生产面。当前已实现：

```text
contracts/  完整 Trial/Candidate/Dataset/Instrument/Policy/Result/Fingerprint 合同
data-adapter/ manifest/hash、UTC、instrument/PIT policy snapshot、supplemental requirement/revision join、closed bar/grid gap、funding/mark 准入
engine/     EventKey source reducer + source-bound entry/exit/forced-liquidation lanes
accounting/ slippage、trade/liquidation fee、exact funding、Position、现金与 Journal v5 / Equity v3
metrics/    只从 fills/ledger 派生权威 Replay metrics
runner/     monotonic Attempt lease fencing、transport-neutral coordinator/pre-terminal local outbox、namespace discovery/recovery-first no-replay ack、幂等、typed failure、Harness worker 与完整 Artifact commit
tests/      golden、property、metamorphic、component parity 认证
compatibility/ 迁入的 legacy replay/benchmark/panel 实现，只用于兼容与 parity
certification/ 迁入的 calibration 认证来源
```

当前是 Request v30、Result v43、Artifact v45、Run Outcome v35、Dataset Manifest v11、Decision Schedule v7 / Timeline v10、Pending Order Resolution v2、Stop Entry Same-bar Path Ambiguity v1、OHLCV Resolution Evidence v3、Engine Checkpoint v22、Simulator v16、Margin v7、Journal v5 / Equity v3 的受限认证纵切，并继续绑定 Control Plane Reservation/Attempt/certification/cancellation authority。entry 可选 next-open market、pre-entry GTC/IOC Limit 或 GTC Stop-market。Stop open gap 取 observed open，range trigger 取 trigger reference 后施加不利滑点；若 range 触发 bar 同时触达保护价而无法证明触发后路径，则 typed-fail 且无 Result。GTC 可跨 observation resting、在数据边界保留 active，或由 Experiment Contract 预冻结的 closed-bar Cancel 终止；Limit 沿用 v1 intent，Stop 使用 v2 intent。Cancel 可固定执行，也可由 Schedule/Harness 在 `pending_entry` 相位重算；更早 Fill 标记 not-reached。IOC 只在 earliest-open 全成或 expired。零成交结果不伪造 Fill/Position/Funding。position-open 仍只允许一次 stop tighten，或一次 fixed partial 后重建双保护并可追加 final full exit。remote transport/SLA、真实 queue/depth partial、未冻结运行时 Cancel/amend 与 multi-order 未认证。

R4.41 只新增非可执行 `Partial Reduce Intent Draft v1`：冻结一次小于初始仓位的 fixed-quantity market reduce-only，以及 partial Fill 后同 source boundary 按剩余仓位取消/重建双保护的 draft policy。它未进入 Request/Schedule/certified capabilities；Runner 对该 draft capability 显式拒绝，直到非终止 Fill、partial Position/Ledger、bracket resize 与 checkpoint parity 完成。

R4.42 将该 seam 升为 certified capability：partial Fill 的 fee/realized PnL 进入统一账本，后续 Funding/Margin/State Snapshot 使用剩余数量；Checkpoint v14 保存 partial Order/Fill 与当前双保护，clean/resume Result hash 一致。仍不认证 multiple partial、partial+stop-replace、真实历史流动性 partial、通用 cancel/amend、加仓/反转或 fast mode。

R4.43 认证 partial Fill 后的 stop、target、exact liquidation、EOD 与 final strategy exit 终态闭包；所有 owner 只读取剩余 Position/current bracket。Checkpoint v15 进一步验证 OrderEvent 末态、partial Intent/Fill 与重建 protection identity/trigger，重算 checkpoint 自哈希不能掩盖语义篡改。能力范围不变。

R4.44 冻结 `OHLCV Resolution Evidence v1`：simple-bracket stop/target 终止逐 bar 保存 P1/P2 admissible path digest；open gap 与单触点为 `exact_under_ohlc`，双触点 collision 为 `resolution_limited`，canonical 仍取 stop-first 较差路径。Result/Fingerprint/Artifact 独立绑定该证据；Simulator v8 经济语义不变，不代表真实 intrabar reconstruction 或通用多订单 resolver。

R4.45 以 Plane-local ordered-price oracle fixtures 认证该包络：long/short 的 gap/single-touch 结果与两条 path 等价，collision 的 high-first/low-first 真实 owner 分别落入 P1/P2；相同 OHLC 可对应相反真实 owner，而 canonical 始终保守选 stop。轨迹分段内加密采样不改变证据。该 oracle 只存在于 certification，不是 tick runtime 或新输入合同。

R4.46 将每条 stop/target resolution evidence 绑定到 active protection generation、remaining quantity、stop/target Order id/trigger 与独立 protection hash。初始双保护为 generation 1；当前互斥的一次 stop replacement 或 partial resize 为 generation 2。Checkpoint、Result 发布与幂等复读均交叉核对 OrderEvent/Fill，重算哈希也不能回指旧保护单；Simulator v8 经济语义不变。

R4.47 为 P1/P2 path 增加 cost-aware terminal contribution：同一 entry basis/quantity 下计算方向性滑点后 execution price、gross realized PnL、exit fee、net contribution，并发布 span/canonical shortfall 与 Metrics 聚合。Runner 从 Request/Dataset/entry Fill 重算且绑定实际 terminal Fill。该 envelope 排除共同 cashflows，不是完整 equity interval、路径概率或新执行语义。

R4.48 以 certification-only 独立经济 oracle 排除同实现自证：三套 quantity/cost/increment profile 覆盖 zero cost、细粒度成本和 fractional-bps/coarse-grid，test-local BigInt rational 算法不导入 production accounting/decimal。24 个 profile×trace case 的双 path、ordered actual path、envelope 聚合、long/short 手算 golden 与 densification invariance 全部 parity；production schema 与 Simulator v8 不变。

R4.49 用 certification-only Python `Decimal` oracle 排除同语言自证。Canonical-string JSON Request/Response v1 经 stdin/stdout 传 48 条 path 向量，Bun 测试要求 Python、TS BigInt 与 production Evidence 的 execution price/gross/fee/net 三方一致；非法 decimal 稳定返回 typed `input_invalid`。Python 不是新 Replay backend/port，production schema 与 Simulator v8 仍不变。

R4.50 冻结执行相关时间网格缺失协议。连续 bar 的 observed-open price jump 仍按 `worse_open`；缺失整根 bar 则返回带精确 bounds/count 的 `dataset-grid-gap-in-execution-window`，不得跨越未知区间执行。缺 frozen entry bar 在 Fill 前失败；持仓后 gap 在前一已观测 close 后、后续 source/checkpoint 前失败，且无 partial Result/Artifact。终态在 gap 前完成时，未消费的未来 gap 不改变 Result；resume 不能绕过 fence。Simulator 推进至 v9，Run Outcome 推进至 v31，其他成功证据 schema 不变。

R4.51 冻结 point-in-time instrument trading-status epochs。Dataset Manifest v8 必须给出连续半开 `trading/halted` schedule，Request/Reservation/Result fingerprint 独立绑定其 hash；只有完整 schedule 证明 `[previous.close, next.open)` 全程 halted 且 `next.open` 已恢复交易时，该无 bar 区间才不是数据缺口。halt/resume 是 phase-`00` SourceEvent；停牌期间禁止 entry、bar-open Fill 与策略订单执行，但 exact Funding/Mark 仍进入账本/风险观察。维持保证金穿透返回 `maintenance-margin-breach-while-halted`，不合成不可执行的 liquidation Fill。既有保护单跨停牌保持 active，恢复后的首个真实 open 继续用 observed-open gap 规则。delisting/settlement 仍是独立 typed failure，不能由本协议推断。

R4.52 冻结 instrument-status producer authority。Dataset Manifest v9 的 `status_provenance` 绑定 producer domain/id/version、source owner/kind、归一化策略、覆盖区间、source observation/production time、原始记录数量/ref/hash 与 schedule hash；Request v23、Trial Reservation v7、Result v35 Fingerprint 分别绑定 provenance hash。`complete_history` 只接受 `venue_status_event_archive` 且必须覆盖 Replay window；current snapshot/periodic snapshots 只能声明 `current_snapshot_only`。Replay 不采集状态、不信任缺 bar 推断，也不把 producer attestation 当成真实性证明。

R4.53 实现 Market Data imported archive/provider 闭包。`market-data-store` 以 immutable immediate-CAS 保存完整状态 transition、coverage/finality 与 content/archive hash；`market-data.instrument-status-provider` 只读验证 anchor、严格状态转换、终局水位和请求窗口，再按固定 build/policy hash 生成 Replay epochs/provenance 与 self-hashed evidence。输出已通过 Request v23 / Dataset Manifest v9 跨域认证；Replay schema/Simulator 不变。该闭包不代表 venue 签名、外部穷尽审计、Control Plane provider allowlist 或停牌/退市结算。

R4.54 实现 Control Plane provider certification admission。Certification v1 是不可变、create-or-identical 的权威快照，绑定 certifier/policy/有效期与 Market Data provider build、normalization、source/completeness capability；Trial Reservation 只能引用注册且在 `issued_at` 有效的认证。Provider 只消费认证 ref/hash，不能自签；Dataset Provenance v2、Request v24、Reservation v8、Result v36 Fingerprint 与 Runner 共同拒绝 capability/certification 漂移。该认证只证明 Control Plane 接纳了某个实现能力，不证明 venue archive 外部真实、完整或已签名。

R4.55 实现 Market Data 外部状态档案的仓库内证据闭包。Archive v2 绑定 source-batch manifest、raw content hash/count、连续 coverage window、previous-batch hash chain 与 Completeness Audit v1；审计只证明 `batch_window_continuity`，并强制 `external_completeness=not_verified`。修订通过同 scope、单后继的 append-only supersession 链表达，旧 archive/hash/result 保持可复现，未定义“自动取最新”。Provider v3 / Evidence v3 将 archive/audit/batch-chain/supersession hash 送达 Replay 边界；Replay wire、Simulator 与经济语义不变。仍未补 venue 签名、collector 原始响应持久化或源系统穷尽证明。

R4.56 实现 instrument-status acquisition receipt 与 capability fence。Store 保存每次 HTTP/导入 Attempt 的状态、失败分类、retryable、exact response BLOB ref/hash/bytes/count 和 terminal self-hash；Source Batch v2 / Archive v3 必须引用并核对成功 historical receipt/payload，current snapshot 不得升级为 `complete_history`。Binance USDⓈ-M collector 只读官方 `exchangeInfo`，保存 429/5xx/invalid body、bounded retry 与 acquisition-id 幂等结果，固定输出 `current_snapshot_only`、`external_authenticity=not_verified`。Provider v4 / Evidence v4 需要新的 Control Plane certification；Replay wire、Simulator、Checkpoint 和经济语义不变。历史状态自动采集、venue 签名与断线/外部穷尽证明仍未完成。

R4.57 实现 Control Plane provider certification rotation/revocation。Termination v1 是独立 self-hashed、append-only、non-retroactive fact；每份认证至多一个 `revoked` 或 `superseded` 终止，successor 必须预先注册、属于同一 provider 且在 cutover 可准入。它只阻断 `effective_at` 起的新 Reservation；此前已签发 Reservation 及后续 Attempt 不被追溯改写。Replay wire、Fingerprint、Simulator 与经济语义不变，Replay 不查询 lifecycle registry，也不存在隐式 latest-wins。

R4.58 实现 Control Plane emergency cancellation authority。Reservation Cancellation v1 绑定完整 Reservation hash，以非追溯 `effective_at` 永久阻止新 claim；已 active Attempt 不受暗中影响。Attempt Cancellation v1 绑定 Trial/run/request/reservation、Attempt/worker/ordinal 与精确 lease generation，收据和 terminal `cancelled` 状态原子提交；旧 generation 后续 renew/finalize/checkpoint 全部失效。若要停止当前运行并禁止 retry，协调者必须显式写两份收据。Runner 继续通过既有 cooperative callback 观察 `cancel`，不发布 partial Result/Artifact；Replay wire、Simulator 和经济语义不变。

R4.68 将 R4.59—R4.67 的 Observation/ack、durable outbox、pre-terminal commit、restart recovery、renewal binding 与 local discovery 接到 Control Plane `research.replay-attempt-admission`：production claim 必须先完成同一 local store 的 recovery，失败则 zero-claim。Replay Runner 仍只消费冻结 Lease，不读取 SQLite、不拥有 worker supervisor；remote store、pool identity 与 startup/stop SLA 未认证。

R4.69 冻结独立 `Pending Order Resolution v1`，先确定 Limit GTC/IOC、Stop-market GTC 与 Cancel EventKey race，不扩张 Request/Runner。Limit 仅在显式 `ohlcv-cross-through-full-fill-bounded-v1` 且 quantity 不超过 capacity 时给出 open/strict-cross 全成参考；因 queue 不可见仍标 `resolution_limited`，touch 不填单。Cancel 严格早于 observation 则胜，晚于 fill 则败；同 ordinal 与 touch-before-cancel 返回 `unresolved`。该 primitive 不生成 Fill/Ledger/Artifact，Simulator v10 不变。

R4.70 只集成该 primitive 的 pre-entry Limit GTC 子集。Request 冻结 `limit_price/time_in_force/liquidity_model/full_fill_capacity`；signal 时 active、next-open 起观察，Fill price 不得劣于 limit，保护只在 decisive SourceEvent 之后激活。Checkpoint 保存 resting resolution prefix；clean/resume 生成相同 Result。Artifact 新增 `pending-order-resolutions.json`；EOD 未成交返回 typed failure且无 Result。IOC、Stop pending、Cancel OrderEvent 和多订单竞争仍未开放。

R4.71–R4.72 为 Limit capacity 增加 PIT-available self-hashed attestation，并把 GTC 数据边界未成交从临时 failure 改为 `unfilled_at_data_end` 完成 Result：保留 active Order、resting chain 与零成交账本，不伪造 cancel/expire。

R4.73 接入 pre-entry IOC：只观察 earliest-executable `bar_open`，marketable 则 bounded-full-fill，否则以独立 `expired` OrderEvent 和 `entry_outcome=expired_unfilled` 立即完成；同 bar range 与后续 bar 不再属于该订单。`cancelled` 保留给显式 cancel authority。主动 Cancel、IOC partial remainder、Stop pending 与 multi-order 仍未开放。

R4.74 接入首条显式 Cancel：`ReplayEntryCancelIntent v1` 只能由不可变 Experiment Contract 预冻结，且仅作用于 pre-entry GTC Limit。指定 close 的 `bar_range` phase `20` 先解析价格，Cancel phase `90` 后生效：strict-cross Fill 胜，确定未触达时 Cancel 胜并返回 `cancelled_unfilled`，exact touch 因 queue 不可见返回 typed ambiguity failure 且不发布 Result/Artifact。缺失指定 boundary 是 data-integrity failure。该能力不是运行中外部指令、IOC Cancel、amend/cancel-replace 或多订单取消。

R4.75 增加可选 `authorized_entry_cancel` Schedule/Harness authority。Decision Schedule v6 把同一 immutable Intent 绑定到 effective close；Harness Context v7 新增 `pending_entry` 相位，只消费对应 closed-bar Snapshot，State Snapshot 必须为 null。Engine 在该 range 已可见后执行 Harness parity，再解析 Fill/Cancel：non-fill Cancel 的 Timeline v9 持有 receipt；更早 Fill 用 entry Fill EventKey 将决策标为 `not_reached_terminal` 且不执行 Harness；same-close strict-cross 仍先 Fill。Checkpoint v21、Result v42、Artifact v44 与 Simulator v15 绑定 Timeline。R4.74 fixed-intent 路径继续兼容；未冻结 agent/user command、IOC Cancel、amend/cancel-replace 与多订单仍不开放。

R4.76 贯通 pre-entry GTC Stop-market。Request v30 冻结 trigger/source、GTC、capacity attestation 与保护边界；open gap 在 observed open 触发，range 在 trigger reference 触发，实际 Fill 再按方向施加 adverse slippage。entry Order 必须依次 submitted → active → triggered → filled，随后才激活保护。Stop Cancel 使用 `ReplayEntryCancelIntent v2`，同 close phase-`20` trigger/fill 先于 phase-`90` Cancel；确定未触发则 Cancel 胜。range 触发 bar 若同时触达 stop/target，`Stop Entry Same-bar Path Ambiguity v1` 证明 OHLC 无法确定触发后的保护路径，Run Outcome typed-fail，不发布 Result/Artifact。Checkpoint v22、Timeline v10、Result v43、Artifact v45 与 Simulator v16 绑定该闭包；真实 trigger feed、queue/depth partial、运行时 Cancel、多 pending order 与 fast parity 仍未认证。

R4.77 冻结 exact-trade pre-integration certification seam，不扩张 Runner capability。`Aggregate Trade Event v1` 保存 symbol、连续 aggregate-trade id、underlying trade-id range、trade/availability time、price/quantity 与 maker side；`Aggregate Trade Coverage Attestation v1` 绑定半开窗口、首尾 id/count、source/events hash，并固定 `external_completeness=not_verified`。`Exact Trade Stop Resolution v1` 只按 aggregate id 选择 entry trigger 后第一条保护触发，证明同一 OHLC 可存在 stop-first/target-first 两条真实有序路径；entry trigger 所在聚合事件不能反向触发尚未激活的保护。它只给 price-trigger order reference，不是 Fill、queue、slippage 或 impact 证据。现有 `aggtrades-fetch` 仅为近期 read tool，未具备 archive completeness authority，因此 Request/Result/Artifact/Simulator 版本不变，OHLCV Runner 继续 fail-closed。

R4.78 落地 aggregate-trade 的 Market Data authority seam，仍不扩张 Runner。`market-data-store` 只接受显式 `offline_import` 的 Binance USD-M 原始 JSON，保留 exact bytes，并以 Source Receipt v1、aggregate-id/半开窗口 Completeness Audit v1 与 Archive v1 做 create-or-identical hash closure；本地连续性通过也只声明 `external_completeness=not_verified`。`market-data.aggregate-trade-provider` 消费 Control Plane certification binding，确定性输出 Replay Event/Attestation 与 self-hashed Evidence v1，跨域测试已由 Replay Contract 验收。trade time 作为 earliest available time 仅是毫秒 resolution-limited 约定；insurance/ADL、外部穷尽、跨 source EventKey、Fill/queue/cost 仍无权威证明，故 Request/Result/Artifact/Checkpoint/Simulator 不变，Runner 继续拒绝 exact source。

R4.79 冻结 Control Plane aggregate-trade Provider Certification/Termination v1 与 Evidence Admission v1。认证精确绑定实际 provider capability/build/policy 及 Archive/Event/Attestation schema，只允许 `venue_aggregate_trade_archive + external_completeness=not_verified`；Admission 只能在 Trial reserved、Reservation v9 有效且认证未终止时签发，每个 Reservation hash 唯一绑定 archive/receipt/audit/evidence/attestation。其 scope 固定为 `pre_integration_exact_price_path_only`，不是 Request、Attempt、Fill 或 Result authority；历史 admission 不受后续 revoke 回写，Runner 与 production wire 继续不变。

R4.80 冻结 pre-integration Cross-source Event Envelope/EventKey/Ordering Attestation v1。Instrument Status、Funding、Aggregate Trade、OHLCV 先按各自 native sequence 验证，再以 `effective_time → semantic phase → source rank → native sequence → stable id` 形成确定性全序；`availability_at` 独立保留，禁止与生效时间混写。跨源同刻且无 venue-global sequence 时生成 ambiguity group，并固定为 `resolution_limited`；source rank 只是可复现 tie-break，不是历史先后证明。该 Attestation 明示 `forbidden_until_runner_contract_binds_attestation`，不进入现有 SourceEvent/Request/Runner/Result/Artifact/Checkpoint/Simulator。

R4.81 由 Control Plane 为 R4.80 Ordering Attestation 签发 Reservation-bound Admission v1。签发必须读取已注册 Aggregate Trade Evidence Admission，验证同一 Reservation、仍 reserved Trial、有效 provider certification、完全相同的半开 coverage window 与 aggregate events hash，并从实际 Attestation 派生 status/funding/aggregate-trade/OHLCV collection、ordered events、ambiguity 和 limitation hashes；Dataset ref/hash 与 status schedule/provenance 直接继承 Reservation bindings。每个 Reservation/aggregate admission 只能 create-or-identical 一次；scope 固定为 `pre_integration_cross_source_ordering_only`、`economic_authority=none`。它仍不是 Request、Attempt、SourceEvent、Fill 或 Result authority。

R4.82 新增 Admission-bound SourceEvent Projection Attestation v1。Data Adapter 必须同时验证 R4.81 Admission 与 R4.80 Ordering Attestation，再将每个 ordered envelope 一对一投影，保留 effective/availability、payload hash、native identity、source rank/sequence 与 ambiguity resolution。该对象固定为 hash-only、non-economic 且不声明 production SourceEvent compatibility；现有生产 SourceEvent 缺少上述 provenance 字段和 Aggregate Trade kind，因此本阶段不接 Runner/Engine，也不修改 Request、Result、Artifact、Checkpoint 或 Simulator。

R4.83 冻结 parallel candidate SourceEvent Wire v2，而不修改已进入 Result/Checkpoint hash 的 legacy SourceEvent。Wire event 内嵌四源 canonical typed payload，并从 effective/availability、native identity、payload hash 与 cross-source key 重建 R4.80 Envelope；Manifest 绑定 Projection、Admission、Ordering Attestation、Reservation、Dataset 与整条 payload/event/envelope hash 链。迁移合同固定 legacy unchanged、parity not certified、Runner not bound、economic authority none；该阶段尚无 materializer 或 Engine consumer。

R4.84 实现 Projection-bound Wire v2 materializer：先用原始四源 payload 重建并逐字节哈希核对 Ordering Attestation，再按 Projection 一对一内联 payload，缺失、额外、篡改或顺序漂移均 fail closed。另以真实 legacy Engine builder 认证 Instrument Status、Funding、bar-open/bar-range 的共有事件调度 correspondence；Aggregate Trade 仍为 Wire-only，payload、EventKey 与跨源同刻顺序 parity 明确不声明。该路径仍不绑定 Runner/Engine 经济消费。

R4.85 增加 Wire pre-execution gate 与非经济 candidate reducer。Gate 只放行 `non_economic_schedule_trace`；经济 exact-trigger 在跨源同刻时因 `resolution_limited` 拒绝，即使 declared timestamps 无碰撞也因 economic consumer 未认证而拒绝。Reducer 逐事件保留 ambiguity-group hash 与 `deterministic_tie_break_only`，所有 execution effect 固定为 none；现有 reference Engine、Runner、Result/Artifact epoch 不变。

R4.86 增加非经济 availability-aware dual-clock cursor。Candidate Trace 继续保存按 `effective_time` 排列的市场时间轴；Cursor 另按 `(availability_at, effective_time, effective-event ordinal, wire-event id)` 生成可见性时间轴。`availability_at > effective_time` 的事件只能在到达时成为 `delayed_historical_fact`，不得提前进入视图或追溯产生执行副作用；两条 timeline、lineage、lag 与 per-source fold 均自哈希。该 Cursor 不接 reference Engine、Runner、Result、Artifact 或 Checkpoint。

R4.87 增加 non-economic Visibility Cut v1。Cut 对任意 `as_of_time` 冻结 `availability_at <= as_of_time` 的完整 Cursor 前缀，同时绑定未可见后缀的 count/id hash；因此既不能提前纳入未来事实，也不能少报已经可见的事实。Cut 仅携带 identity/lineage，不含 payload，`decision_authority=none`，仍不接 Harness、Runner、Result、Artifact 或 Checkpoint。

经济入口按唯一 `authorized_initial_order / authorized_order` 语义定位，不依赖 Schedule/Timeline 数组末位；可选退出必须是 Schedule 末位并以 `authorized_reduce_only_exit` 独立表达，不能冒充第二个入口。所有 post-entry evaluation 必须由 Source Reducer 运行时产生 Position/Cash State Snapshot，并正确表达 terminal-before-decision、pending Order 与 checkpoint/resume。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、multiple partial、动态 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial liquidity、limit queue 与 fast mode 未完成。
