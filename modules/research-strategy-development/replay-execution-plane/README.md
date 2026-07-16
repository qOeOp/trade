# Replay Execution Plane

Instrument-status producer implementation 与 normalization policy 同时绑定 version + SHA-256 content hash，禁止版本字符串不变而实现漂移。

RD 确定性历史执行与证据生产面。当前已实现：

```text
contracts/  完整 Trial/Candidate/Dataset/Instrument/Policy/Result/Fingerprint 合同
data-adapter/ manifest/hash、UTC、instrument/PIT policy snapshot、supplemental requirement/revision join、closed bar/grid gap、funding/mark 准入
engine/     EventKey source reducer + source-bound entry/exit/forced-liquidation lanes
accounting/ slippage、trade/liquidation fee、exact funding、Position、现金与 Journal v5 / Equity v2
metrics/    只从 fills/ledger 派生权威 Replay metrics
runner/     monotonic Attempt lease fencing、transport-neutral coordinator/pre-terminal local outbox、namespace discovery/recovery-first no-replay ack、幂等、typed failure、Harness worker 与完整 Artifact commit
tests/      golden、property、metamorphic、component parity 认证
compatibility/ 迁入的 legacy replay/benchmark/panel 实现，只用于兼容与 parity
certification/ 迁入的 calibration 认证来源
```

当前是 Request v26、Result v39、Artifact v41、Run Outcome v35、Dataset Manifest v11、Pending Order Resolution v1、OHLCV Resolution Evidence v3、Engine Checkpoint v18、Simulator v12、Margin v7、Journal v5 / Equity v2 的受限认证纵切，并继续绑定 Control Plane Reservation/Attempt/certification/cancellation authority。entry 可选 next-open market 或 pre-entry GTC Limit；Limit 只在冻结 bounded-full-fill capacity 内按 OHLC open/strict-cross 生成 resolution-limited Fill。数据边界仍未成交则提交 `unfilled_at_data_end` 零成交 Result，保留 active Order，不伪造 cancel/expire。position-open 仍只允许一次 stop tighten，或一次 fixed partial 后重建双保护并可追加 final full exit。remote transport/SLA、真实 queue/depth partial、IOC/Cancel/multi-order 未认证。

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

经济入口按唯一 `authorized_initial_order / authorized_order` 语义定位，不依赖 Schedule/Timeline 数组末位；可选退出必须是 Schedule 末位并以 `authorized_reduce_only_exit` 独立表达，不能冒充第二个入口。所有 post-entry evaluation 必须由 Source Reducer 运行时产生 Position/Cash State Snapshot，并正确表达 terminal-before-decision、pending Order 与 checkpoint/resume。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、multiple partial、动态 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial liquidity、limit queue 与 fast mode 未完成。
