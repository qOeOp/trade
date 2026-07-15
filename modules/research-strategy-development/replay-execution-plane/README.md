# Replay Execution Plane

RD 确定性历史执行与证据生产面。当前已实现：

```text
contracts/  完整 Trial/Candidate/Dataset/Instrument/Policy/Result/Fingerprint 合同
data-adapter/ manifest/hash、UTC、instrument/PIT policy snapshot、supplemental requirement/revision join、closed bar/grid gap、funding/mark 准入
engine/     EventKey source reducer + source-bound entry/exit/forced-liquidation lanes
accounting/ slippage、trade/liquidation fee、exact funding、Position、现金与 Journal v4
metrics/    只从 fills/ledger 派生权威 Replay metrics
runner/     Attempt lease fencing、幂等、取消、typed failure、Harness worker 与完整 Artifact commit
tests/      golden、property、metamorphic、component parity 认证
compatibility/ 迁入的 legacy replay/benchmark/panel 实现，只用于兼容与 parity
certification/ 迁入的 calibration 认证来源
```

当前是 Trial Reservation v6、Request v22、Result v34、Artifact v36、Run Outcome v32、Dataset Manifest v8、OHLCV Resolution Evidence v3、Partial Reduce Intent v1、Reduce-only Exit Intent v1、Protective Stop Replace Intent v1、Decision Schedule v5、Boundary v7、Timeline v8、State Snapshot v3、Harness Context v6、Registry Capability v7、Harness Capability/Receipt v9、Worker Protocol v7、Engine Checkpoint v17、Simulator v10、Margin v7、Journal v4 的受限认证纵切。Control Plane 冻结 decision sequence/time/effect 与 `instrument_status_schedule_hash`；当前 lane 可选择一次全仓 stop tighten，或一次 fixed-quantity partial reduce 后按剩余仓位原子重建双保护，并可追加一次末位 full exit。stop/target/exact risk 在 partial open 前保持优先，terminal owner 会取消 pending partial。

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

经济入口按唯一 `authorized_initial_order / authorized_order` 语义定位，不依赖 Schedule/Timeline 数组末位；可选退出必须是 Schedule 末位并以 `authorized_reduce_only_exit` 独立表达，不能冒充第二个入口。所有 post-entry evaluation 必须由 Source Reducer 运行时产生 Position/Cash State Snapshot，并正确表达 terminal-before-decision、pending Order 与 checkpoint/resume。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、multiple partial、动态 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial liquidity、limit queue 与 fast mode 未完成。
