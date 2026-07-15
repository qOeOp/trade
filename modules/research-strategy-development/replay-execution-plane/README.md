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

这是 Request v10、Result v16、Artifact v17、Run Outcome v7、Dataset Manifest v4、Engine Checkpoint v1、Simulator v6、Margin v6、Journal v4 的受限认证纵切。Control Plane 签发 Trial Reservation Snapshot v1 与 Replay Attempt Lease v1；active-attempt 唯一、heartbeat generation fencing、expiry takeover 与 terminal immutable 已由 State Store 锁定。Runner 在首事件前及完整 source-event 边界验证 reservation/request/lease，拒绝 generation 回退；协作取消不发布 Result/Artifact，checkpoint resume 与 clean run 的 Result parity 已锁定。Attempt/checkpoint envelope 不改变 Result 经济 fingerprint。跨主机 checkpoint 持久化、crash-atomic publication、reservation expiry、多 epoch、部分强平、deficit/insurance/ADL、动态 collateral、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
