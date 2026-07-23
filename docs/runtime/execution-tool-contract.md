---
title: Execution Tool Contract
role: runtime-feature-contract
status: active
owner: live-execution-control
last_verified: 2026-07-23 CST
---

# Execution Tool Contract

## 0. 定位

本文定义受限 `ExecutionCapability` 如何穿过 exchange router / pre-adapter gate，以及 Binance 写结果如何被 `trade-flow` 记录成 `plan_event(kind=order_fill)`。

它只锁最小外壳，不冻结 Binance 原始 `result` 的内部字段；交易所返回仍由各执行 tool 持有。

## 1. 统一外壳

所有写 tool CLI 输出：

```json
{ "ok": true, "data": { "...": "..." } }
```

失败输出：

```json
{ "ok": false, "error": "..." }
```

`trade-flow` 只在 preflight armable、runtime authorization / account fact / portfolio projection / intent 绑定一致、capability 未过期，且 adapter `ok=true` 与 `data` 满足对应动作最低字段时写本地事件。`ok=false`、非 JSON、缺最低字段或 confirmation unknown 都不得伪装成 filled。

## 2. 最低成功字段

| target_action | tool | `data` 最低字段 |
| --- | --- | --- |
| `place_entry` | `binance-order-place` | `method`, `request`, `result`; `confirmedResult` 可选 |
| `cancel_order` | `binance-order-cancel` | `method`, `result` |
| `sync_protection` | `binance-position-protect` | `method`, `created[]`; 每个 leg 必须有 `request`, `result` |
| `adjust_position` | `binance-position-adjust` | `method`, `reduced`, `remainingPosition` |

`method` 是执行路径标签，例如 `futuresOrder`、`futuresCreateAlgoOrder`、`futuresCancelOrder`。它不是策略信号，只用于审计和 route debugging。

## 3. trade-flow 记录映射

| target_action | 本地事件 | lifecycle |
| --- | --- | --- |
| `place_entry` | `sub_kind=submit`，从 `execution_contract_snapshot` 写入 symbol / side / qty / stop / client id | `submitted` |
| `cancel_order` | `sub_kind=cancel`，从 request/result 读取 order id 或 client id | `cancelled` |
| `sync_protection` | 每个 created leg 写一条 protective `sub_kind=submit` | `submitted` |
| `adjust_position` | `sub_kind=fill`，从 `reduced` 写入 reduce fill | `filled` |

`source=trade_flow` 的事件必须同时带：

- `source_observe_event_key`
- `execution_result`
- `execution_contract_snapshot` 或 `execution_action_snapshot`
- `execution_capability`
- `exchange_confirmation_ref`

## 4. 不做

- 不让执行 tool 写 `trade.db`
- 不把 Binance 原始返回改写成长期 schema
- 不从执行 tool 输出反推策略观点
- 不在执行失败时补写本地成功事件
- 不允许 adapter 绕过 exchange request router、write pre-adapter gate 或 capability validation
