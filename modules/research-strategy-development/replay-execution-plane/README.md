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

当前是 Trial Reservation v5、Request v21、Result v30、Artifact v32、Run Outcome v27、Dataset Manifest v7、Partial Reduce Intent v1、Reduce-only Exit Intent v1、Protective Stop Replace Intent v1、Decision Schedule v5、Boundary v7、Timeline v8、State Snapshot v3、Harness Context v6、Registry Capability v7、Harness Capability/Receipt v9、Worker Protocol v7、Engine Checkpoint v15、Simulator v8、Margin v7、Journal v4 的受限认证纵切。Control Plane 冻结 decision sequence/time/effect；当前 lane 可选择一次全仓 stop tighten，或一次 fixed-quantity partial reduce 后按剩余仓位原子重建双保护，并可追加一次末位 full exit。stop/target/exact risk 在 partial open 前保持优先，terminal owner 会取消 pending partial。

R4.41 只新增非可执行 `Partial Reduce Intent Draft v1`：冻结一次小于初始仓位的 fixed-quantity market reduce-only，以及 partial Fill 后同 source boundary 按剩余仓位取消/重建双保护的 draft policy。它未进入 Request/Schedule/certified capabilities；Runner 对该 draft capability 显式拒绝，直到非终止 Fill、partial Position/Ledger、bracket resize 与 checkpoint parity 完成。

R4.42 将该 seam 升为 certified capability：partial Fill 的 fee/realized PnL 进入统一账本，后续 Funding/Margin/State Snapshot 使用剩余数量；Checkpoint v14 保存 partial Order/Fill 与当前双保护，clean/resume Result hash 一致。仍不认证 multiple partial、partial+stop-replace、真实历史流动性 partial、通用 cancel/amend、加仓/反转或 fast mode。

R4.43 认证 partial Fill 后的 stop、target、exact liquidation、EOD 与 final strategy exit 终态闭包；所有 owner 只读取剩余 Position/current bracket。Checkpoint v15 进一步验证 OrderEvent 末态、partial Intent/Fill 与重建 protection identity/trigger，重算 checkpoint 自哈希不能掩盖语义篡改。能力范围不变。

经济入口按唯一 `authorized_initial_order / authorized_order` 语义定位，不依赖 Schedule/Timeline 数组末位；可选退出必须是 Schedule 末位并以 `authorized_reduce_only_exit` 独立表达，不能冒充第二个入口。所有 post-entry evaluation 必须由 Source Reducer 运行时产生 Position/Cash State Snapshot，并正确表达 terminal-before-decision、pending Order 与 checkpoint/resume。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、multiple partial、动态 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial liquidity、limit queue 与 fast mode 未完成。
