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

当前是 Trial Reservation v5、Request v20、Result v29、Artifact v31、Run Outcome v26、Dataset Manifest v7、Reduce-only Exit Intent v1、Protective Stop Replace Intent v1、Decision Schedule v4、Decision Boundary v6、Decision Evidence Timeline v7、Decision Input/Market Snapshot v1、Decision State Snapshot v2、Decision Harness Context v5、Source Bundle v1、Build Attestation v2、Registry Capability v6、Harness Capability/Receipt v8、Worker Protocol v6、Engine Checkpoint v13、Simulator v7、Margin v7、Journal v4 的受限认证纵切。Control Plane 冻结 decision sequence/time/effect；当前 lane 允许入场后至多一次全仓 stop-market 仅收紧替换和一次末位 full reduce-only exit。R4.39 锁定 replacement stop、strategy exit 与 exact liquidation 共用唯一 terminal owner；R4.40 另以价格镜像 fixture 锁定 long/short 方向对称，并规定 replacement 后 stop/target 同 bar 双触发仍使用 stop-first canonical path，必须携带 `ohlcv-stop-target-collision / resolution_limited`。Checkpoint 保存已消费 Timeline、当前保护单与 pending exit，resume 不重跑已提交 Harness。当前不认证通用 cancel/replace、止损放宽、target 改动、连续 trailing、通用 OHLC path resolver、部分减仓、加仓/反转、多 strategy order、动态 supplemental join 或 OS sandbox。

R4.41 只新增非可执行 `Partial Reduce Intent Draft v1`：冻结一次小于初始仓位的 fixed-quantity market reduce-only，以及 partial Fill 后同 source boundary 按剩余仓位取消/重建双保护的 draft policy。它未进入 Request/Schedule/certified capabilities；Runner 对该 draft capability 显式拒绝，直到非终止 Fill、partial Position/Ledger、bracket resize 与 checkpoint parity 完成。

经济入口按唯一 `authorized_initial_order / authorized_order` 语义定位，不依赖 Schedule/Timeline 数组末位；可选退出必须是 Schedule 末位并以 `authorized_reduce_only_exit` 独立表达，不能冒充第二个入口。所有 post-entry evaluation 必须由 Source Reducer 运行时产生 Position/Cash State Snapshot，并正确表达 terminal-before-decision、pending Order 与 checkpoint/resume。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、除一次 tighten-only stop replacement 与一次 full exit 外的 effect-changing 持仓 decision、动态 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
