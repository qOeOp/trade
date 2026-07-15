# Replay Execution Plane

RD 确定性历史执行与证据生产面。当前已实现：

```text
contracts/  完整 Trial/Candidate/Dataset/Instrument/Policy/Result/Fingerprint 合同
data-adapter/ manifest/hash、UTC、instrument/PIT policy snapshot、closed bar/grid gap、funding/mark 准入
engine/     EventKey source reducer + source-bound entry/exit/forced-liquidation lanes
accounting/ slippage、trade/liquidation fee、exact funding、Position、现金与 Journal v4
metrics/    只从 fills/ledger 派生权威 Replay metrics
runner/     Attempt lease fencing、幂等、取消、typed failure 与完整 Artifact commit
tests/      golden、property、metamorphic、component parity 认证
compatibility/ 迁入的 legacy replay/benchmark/panel 实现，只用于兼容与 parity
certification/ 迁入的 calibration 认证来源
```

这是 Trial Reservation v2、Request v10、Result v16、Artifact v18、Run Outcome v13、Artifact Store Capability v1、Dataset Manifest v4、Engine Checkpoint v1、Diagnostic Checkpoint Commit v2、Checkpoint Receipt v2、Resume Authorization Snapshot v1、Simulator v6、Margin v6、Journal v4 的受限认证纵切。Reservation 的 `[issued_at, expires_at)` 只控制新 Attempt claim；已准入 Attempt 继续由 lease/generation fencing。Runner 只通过 Attempt-scoped Artifact Store port 访问证据；`artifact_root` 仅构造 certified local adapter。local-v1 以 `fsync + hard-link create-if-absent CAS + directory fsync` 不可变发布 member/Manifest/checkpoint，Manifest 持久绑定 policy。remote-v1 已冻结 `If-None-Match: * + full SHA-256 + strong read-after-write + Manifest-last + abort/expiry incomplete upload` 要求，但没有 certified adapter，注入时在 engine 前返回 typed `artifact-store-rejected`。Control Plane 仍单写 Reservation、Lease、Receipt 与 Resume Authorization；未登记对象和 listing 均不是 authority。对象存储实现/认证、多 epoch、部分强平、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
