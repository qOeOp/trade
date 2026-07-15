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

这是 Request v10、Result v16、Artifact v17、Run Outcome v9、Dataset Manifest v4、Engine Checkpoint v1、Diagnostic Checkpoint Commit v1、Resume Authorization Snapshot v1、Simulator v6、Margin v6、Journal v4 的受限认证纵切。Control Plane 签发 Trial Reservation、Attempt Lease 与 Resume Authorization；active-attempt 唯一、heartbeat generation fencing、expiry takeover、terminal immutable 和 source-checkpoint→later-target-attempt 单次授权已由 State Store 锁定。Runner 在首事件及完整 source-event 边界验证 authority；checkpoint payload/commit 在 attempt-local 目录依次原子替换，协作取消不发布 Result/Artifact，另一进程只能凭绑定 source commit、target Attempt/worker 与 lease generation floor 的授权从共享 artifact root 恢复。clean/resume Result parity、路径隔离、authority mutation/target mismatch、renewed-generation acceptance、payload tamper rejection 与成功 Attempt 定向清理已锁定。硬崩溃后的 checkpoint 自动发现、对象存储 CAS、reservation expiry、多 epoch、部分强平、deficit/insurance/ADL、动态 collateral、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
