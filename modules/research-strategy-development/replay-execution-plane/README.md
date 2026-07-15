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

当前是 Trial Reservation v5、Request v17、Result v26、Artifact v28、Run Outcome v23、Dataset Manifest v7、Decision Schedule v1、Decision Boundary v3、Decision Evidence Timeline v4、Decision Input/Market Snapshot v1、Decision Harness Context v2、Source Bundle v1、Build Attestation v2、Registry Capability v3、Harness Capability/Receipt v5、Worker Protocol v3、Engine Checkpoint v10、Simulator v7、Margin v7、Journal v4 的受限认证纵切。Control Plane 冻结 decision sequence/time/effect；多 boundary lane 仅允许 `no_action* -> authorized_initial_order`，每个 boundary 都从同一 Dataset Hash 重建 closed-bar lookback，并由 Harness 双 fresh subprocess 产生与 schedule 一致的 tagged output。兼容单点 lane仍可使用预计算 Order并携带 `decision-market-input-recomputation-uncertified` limitation。当前不认证持仓后决策、动态 supplemental join、多订单或 OS sandbox。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、持仓后 decision、动态 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
