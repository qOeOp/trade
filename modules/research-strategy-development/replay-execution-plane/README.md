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

当前是 Trial Reservation v5、Request v19、Result v28、Artifact v30、Run Outcome v25、Dataset Manifest v7、Reduce-only Exit Intent v1、Decision Schedule v3、Decision Boundary v5、Decision Evidence Timeline v6、Decision Input/Market/State Snapshot v1、Decision Harness Context v4、Source Bundle v1、Build Attestation v2、Registry Capability v5、Harness Capability/Receipt v7、Worker Protocol v5、Engine Checkpoint v12、Simulator v7、Margin v7、Journal v4 的受限认证纵切。Control Plane 冻结 decision sequence/time/effect；当前 lane 允许 `pre-entry no_action* -> authorized_initial_order -> position-open no_action* -> optional final authorized_reduce_only_exit`。退出只能是反向全量 reduce-only market：closed-bar 决策时 submitted，严格更晚的 frozen open 才 active/filled；exact risk、stop gap、target gap 优先，terminal-before-decision 写 `not_reached_terminal`。Checkpoint 内嵌已消费 Timeline 与 pending exit Order，resume 不重跑已提交 post-entry decision。兼容单点 lane仍可使用预计算 Order并携带 `decision-market-input-recomputation-uncertified` limitation。当前不认证部分减仓、加仓/反转、cancel/replace、多 strategy order、动态 supplemental join 或 OS sandbox。

经济入口按唯一 `authorized_initial_order / authorized_order` 语义定位，不依赖 Schedule/Timeline 数组末位；可选退出必须是 Schedule 末位并以 `authorized_reduce_only_exit` 独立表达，不能冒充第二个入口。所有 post-entry evaluation 必须由 Source Reducer 运行时产生 Position/Cash State Snapshot，并正确表达 terminal-before-decision、pending Order 与 checkpoint/resume。

Reservation 只控制新 Attempt claim；已准入 Attempt 由 lease/generation fencing。Runner 仅通过 Attempt-scoped Artifact Store port 访问证据，local-v1 使用 `fsync + hard-link CAS + directory fsync`，remote-v1 仍只有准入合同、没有 certified adapter。Control Plane 单写 Reservation、Lease、Checkpoint Receipt 与 Resume Authorization；Replay 不查询或修改 Trial。对象存储实现/认证、OS sandbox、除一次 full exit 外的 effect-changing 持仓 decision、动态 supplemental join、变更 accounting epoch、历史规则采集、部分强平、cross/shared portfolio、tick/L2、真实 partial、limit queue 与 fast mode 未完成。
