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

当前是 Trial Reservation v5、Request v15、Result v22、Artifact v24、Run Outcome v19、Dataset Manifest v7、Decision Input Snapshot v1、Decision Harness Source Bundle/Build Attestation v1、Registry Capability v2、Harness Capability/Receipt v3、Worker Protocol v1、Engine Checkpoint v7、Simulator v7、Margin v7、Journal v4 的受限认证纵切。required lane 将 `harness_hash` 绑定到完整 UTF-8 Source Bundle；确定性 Bun build 要求 metafile source closure 精确相等且无 residual runtime import，并持久绑定 artifact bytes/hash、Bun version/executable hash。Runner 物化精确 artifact，在固定最小环境、5s timeout、1 MiB output cap 下执行两次 fresh stdio subprocess；两份 response canonical 相等才准入。Result/Fingerprint/Artifact/checkpoint 绑定 Bundle/Build/Runtime/Worker parity，幂等重读零执行。该进程边界不是 OS sandbox、文件/网络封锁、signed provenance 或任意依赖 SBOM，也不等于通用 feature DAG 已重算。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、动态多决策 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
