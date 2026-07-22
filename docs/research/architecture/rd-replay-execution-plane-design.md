---
title: RD Replay Execution Plane
role: research-feature-contract
status: active-partial
owner: replay-execution-plane
last_verified: 2026-07-22 CST
---

# RD Replay Execution Plane

## 1. 定位

Replay Execution Plane 是冻结实验的确定性执行与证据生产面。它消费 Control Plane 授权的 Trial / Attempt / Reservation、不可变 Experiment Contract、Dataset Manifest 和 execution assumptions，产出可复读 Result / Artifact / Fingerprint。

它不生成 hypothesis，不修改 Experiment Contract，不决定 promotion，不写在线 `trade.db`，不调用 Binance write。

## 2. Authority

| 问题 | 权威 |
| --- | --- |
| 当前 maturity、active milestone、gate truth | [rd-replay-maturity-gate.json](../reliability/rd-replay-maturity-gate.json) |
| 输入输出 wire 与版本 | Plane 下各模块 `CONTRACT.md` / schema |
| Trial / Attempt / Lease / Reservation | Research Control Plane state store |
| Dataset / source lineage | frozen Dataset Manifest 与 source attestation |
| 本文 | 跨模块不变量、能力边界、禁止项 |

旧 R4.x / M4 研发日志见 [Legacy RD Replay Execution Plane Design](../../history/legacy-rd-replay-execution-plane-design.md)，不得覆盖机器 gate。

## 3. 执行链

```text
Control Plane authorization
  -> Request / Reservation / Attempt Lease validation
  -> frozen data + policy admission
  -> deterministic schedule / event ordering
  -> engine + accounting
  -> Result / Artifact / Fingerprint
  -> idempotent publication
  -> Control Plane result intake
```

每一层只放大已授权的输入，不自行补策略语义、数据或权限。

## 4. 核心不变量

- 相同 contract、dataset、code/build、policy 和 authority 输入必须得到相同结果与 fingerprint。
- event-time 与 availability-time 分离；所有 feature、signal、status、funding 必须 point-in-time 可见。
- Trial、Attempt、Lease、Reservation、Request、Result 必须 hash-bound，generation / expiry / ownership drift fail closed。
- engine 只执行冻结 schedule；未声明 order、partial、amend、cancel、reentry 或 supplemental decision 均禁止。
- cash、collateral、position、fee、funding、realized / unrealized PnL 与 risk 必须守恒并可由 artifact 重算。
- checkpoint / resume 不得重复 Fill、Funding、publication 或 sequence。
- typed unsupported 优于用 OHLCV、aggregate volume 或当前 snapshot 伪造历史 queue / liquidity / status。

## 5. 当前能力口径

机器 gate 当前证明的是受限 vertical slices，不是通用交易所模拟器。已认证项只能按 gate 中为 `true` 的 functional / evidence / cutover 字段表述；active milestone 任一要求仍为 `false` 时，不得宣称该 milestone 完成或 maturity 升级。

典型已覆盖面包括：

- 冻结单 lane 与部分 portfolio execution / accounting 证据链。
- 严格 schedule、数量边界、protection generation 与 clean/resume parity 的受限场景。
- 固定 funding / mark / terminal risk 与 artifact lineage 的已列证据。

典型未开放面包括：

- 真实 queue、market impact、概率 partial 和无历史 L2 的 maker 成交推断。
- 动态 sizing、未预声明第三次 partial、通用 post-partial mutation / reentry。
- 通用 cross-margin、borrow、完整 remote transport / OS sandbox、Fast kernel parity。
- gate 中仍为 `false` 的 terminal、owner accounting、cycle、publication 与 cutover 条目。

## 6. 数据与市场现实

- OHLCV 只证明 bar 范围，不证明 intrabar queue 和成交顺序；歧义必须使用冻结 policy 或 typed unresolved。
- Funding、instrument status、aggregate trade 等 source 需要各自完整性、availability 和 lineage attestation。
- 当前 REST snapshot 不能倒推历史状态；`external_completeness=not_verified` 不能升级成 complete history。
- replay fill 是模型事实，不冒充 Binance 实际成交。

## 7. 结果与证据

Result / Artifact 至少绑定：

- experiment / candidate / trial / attempt identity。
- reservation / request / lease / generation。
- dataset / source / split / PIT lineage。
- code/build / contract / policy versions。
- event sequence、orders、fills、ledger、terminal state。
- warnings、limitations、unsupported reason 与 publication identity。

summary 不是 authority；缺 required member、hash drift 或重放不一致即拒绝 intake。

## 8. 变更合同

新增能力必须在同一有界 change set 中包含：schema / contract、真实 consumer、golden / tamper / resume evidence、artifact 绑定和 maturity gate 更新。只加 schema、phase 编号或零实例壳不算进展。

完成一个 milestone 前必须运行 owner checks 与 `bun scripts/check-rd-replay-maturity-gate.ts`，并确保 gate 的所有要求同时为真。
