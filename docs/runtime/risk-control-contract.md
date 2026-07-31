---
title: Risk Control Contract
role: runtime-feature-contract
status: active-partial
owner: live-execution-control
last_verified: 2026-07-23 CST
---

# Risk Control Contract

## 1. Authority

本文区分“当前代码已执行的 guard”和“配置/设计已声明但尚未统一接入的限制”。确定性裁决由 `apps/contracts/preflight-contract` 与 `apps/live-execution-control/plan-preflight` 拥有；本文不覆盖代码 verdict。

## 2. 动作分类

| 类型 | 例子 | Safe / risk-lock 下 |
| --- | --- | --- |
| 新增风险 | entry、add、扩大 remaining exposure | 禁止 |
| 防御动作 | reduce、close、cancel entry、sync protection | 可继续，但必须审计 |
| 无动作 | observe、no_action、review | 允许 |

失败的 read / analysis / evidence job 不得自动升级为 exchange write 补救。

## 3. 当前已执行 Guard

| 类别 | Guard |
| --- | --- |
| 事实与完整性 | `G-OBS-FRESH`、`G-PLAN-INTENT-COMPLETE`、`G-PLAN-VERDICT-COMPLETE` |
| Authority 绑定 | `G-RUNTIME-POLICY-AUTHORIZATION`、`G-PORTFOLIO-PROJECTION-AUTHORITY` |
| 资格与模式 | `G-SETUP-LIVE-PERMISSION`、`G-KILL-SWITCH` |
| 账户风险 | `G-RISK-OPEN-CAP`、`G-RISK-DAY-FLOOR`、`G-MAX-CONCURRENT-RISK-FLOWS` |
| 单笔 / 单标的 | `G-MAX-SINGLE-TRADE-RISK`、`G-MAX-ENTRY-NOTIONAL`、`G-MAX-SYMBOL-NOTIONAL`、`G-SINGLE-POSITION-LEVERAGE-CAP` |
| 总暴露 | `G-GROSS-EXPOSURE-CAP`、`G-GROSS-NOTIONAL-CAP` |
| churn / lane | `G-OPEN-RATE-CAP`、`G-REENTRY-COOLDOWN`、`G-MIN-HOLD-BEFORE-NOISE-CLOSE`、`G-SAME-LANE-OPPOSITE-OPEN-CAP` |
| 订单结构 | `G-STOP-LADDER-MONOTONIC`、`G-TP-LADDER-RATIO-CAP` |

Guard 的输入 shape、默认值和 verdict 以 preflight contract 测试为准。

## 4. 执行顺序

```text
mode / kill switch / risk lock
  -> facts freshness and plan completeness
  -> strategy live permission
  -> current runtime-policy authorization + complete/fresh portfolio owner projection
  -> account / position / exposure limits
  -> churn / lane constraints
  -> order structure
  -> armed or blocked verdict
```

任一硬阻断都不能由 warning、LLM 观点或人工叙事降级；需要 override 时必须进入独立 policy/governance 事实，不修改历史 verdict。

## 5. 尚未统一接入

以下能力曾出现在历史设计或 trading config，但当前不得视为统一 preflight guard：

- BTC beta 加权方向集中度。
- funding erosion / funding spike。
- order-book depth / spread / marketable impact。
- expected holding aging 的完整确定性状态机。

它们可以作为 observe / warning / strategy evidence；只有进入 runtime policy、preflight contract、owner tests 后才能标为 enforced。

## 6. Fail-closed

- facts stale、schema invalid、unknown order、unmatched position、policy/authorization missing：新增风险 blocked。
- 新增风险必须同时持有未过期且绑定当前 policy hash、account ref/scope 的 runtime authorization，以及 30 秒内、complete、未 risk-lock、已 reconcile 的 portfolio owner projection；防御/无动作不因这两项新增门被误阻断。
- exchange submit 未确认：不得写 filled position；进入 confirm/reconcile。
- `unknown / needs_review`：保持 risk lock，直到 owner recovery 或明确人工处理。
- safe mode 不妨碍明确的 reduce / close / cancel / protection 修复。

## 7. 变更

新增或修改 guard 必须同步：runtime config、preflight contract、owner tests、本文和 review attribution vocabulary。不能只在 prompt 或策略正文增加一条“应当检查”。
