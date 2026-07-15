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

这是 Request v10、Result v16、Artifact v17、Run Outcome v10、Dataset Manifest v4、Engine Checkpoint v1、Diagnostic Checkpoint Commit v1、Checkpoint Receipt v1、Resume Authorization Snapshot v1、Simulator v6、Margin v6、Journal v4 的受限认证纵切。Control Plane 单写 Trial Reservation、Attempt Lease、Checkpoint Receipt 与 Resume Authorization；active-attempt 唯一、generation fencing、receipt 进度单调、expiry takeover、terminal immutable 和 latest-receipt→later-target-attempt 授权已锁定。Runner 在完整 source-event 边界先写 immutable versioned payload/commit，再把 descriptor 交给控制回调登记；硬崩溃时可恢复到最后已登记 receipt，未登记的新文件和目录扫描都不是 authority。clean/resume parity、stale generation、receipt idempotency、stale receipt rejection、路径隔离、tamper rejection 与定向清理已测试。对象存储 CAS、目录 `fsync`、reservation expiry、多 epoch、部分强平、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
