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

当前是 Trial Reservation v5、Request v15、Result v24、Artifact v26、Run Outcome v21、Dataset Manifest v7、Decision Boundary v1、Decision Evidence Timeline v2、Decision Input Snapshot v1、Decision Harness Source Bundle/Build Attestation v1、Registry Capability v2、Harness Capability/Receipt v3、Worker Protocol v1、Engine Checkpoint v9、Simulator v7、Margin v7、Journal v4 的受限认证纵切。每个 Timeline Entry 内嵌自哈希 Boundary，冻结 evaluation/cutoff/earliest-executable time、closed-candle/next-open policy 与 evidence status。当前 Boundary 明确声明市场输入未 materialize/recompute，Order 仍是 Control Plane-frozen evidence；Result 添加 `decision-market-input-recomputation-uncertified` limitation。Timeline 仍严格 `single_authorized_decision`，不认证动态求值、多订单或多决策执行，也不是 OS sandbox。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、动态多决策 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
