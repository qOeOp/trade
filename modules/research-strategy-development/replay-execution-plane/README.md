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

当前是 Trial Reservation v5、Request v15、Result v23、Artifact v25、Run Outcome v20、Dataset Manifest v7、Decision Evidence Timeline v1、Decision Input Snapshot v1、Decision Harness Source Bundle/Build Attestation v1、Registry Capability v2、Harness Capability/Receipt v3、Worker Protocol v1、Engine Checkpoint v8、Simulator v7、Margin v7、Journal v4 的受限认证纵切。Timeline 以 `decision_time + decision_sequence` 固定顺序、自哈希，并显式冻结 `single_authorized_decision`；其唯一 Entry 是 Snapshot/Bundle/Build/Receipt 的权威容器，Result、Fingerprint、Artifact 与 checkpoint 不再并列保存四套权威。required lane 经确定性 Bun build 和 fresh-subprocess parity 后生成 attested Entry；`mode=none` 只生成 precomputed-order compatibility Entry。该结构为后续多 boundary 留出合同位置，但当前不认证动态重求值、多订单或多决策执行，也不是 OS sandbox、文件/网络封锁、signed provenance 或任意依赖 SBOM。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、动态多决策 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
