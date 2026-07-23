---
title: Event and Flow Contract
role: runtime-feature-contract
status: active
owner: portfolio-execution-state
last_verified: 2026-07-23 CST
---

# Event and Flow Contract

## 1. Authority

`portfolio-execution-state/event-store` 是 `trade.db.plan_event` schema 和 append 的唯一 owner；`flow-projector` 拥有可重建投影。其他 domain 只提交 event draft / envelope，不直接写表或重定义 reducer。

## 2. Identity

| 对象 | Identity |
| --- | --- |
| strategy | `strategy_ref` |
| setup | `setup_id` |
| lane | `strategy_ref + symbol + side` |
| flow | `chain_id` |
| event | `event_key` |

同一 lane 同时最多一个 active flow。新理由、结构更新和 scale-in 仍属于原 flow；只有旧 flow 闭合后出现独立新 setup，才生成新 `chain_id`。

## 3. Event Shell

```text
event_key
chain_id
kind: observe | order_fill | review
body_json
created_at
```

- append-only；修正通过新事件表达。
- `event_key` 幂等，重复写入必须 create-or-identical 或拒绝。
- body schema 由 event-store / consuming owner 的稳定 schema 定义。

## 4. Kind

| Kind | 负责 | 不负责 |
| --- | --- | --- |
| `observe` | facts、thesis、setup、intent、decision summary、refs | 成交事实、策略升格 |
| `order_fill` | submit / accept / partial / fill / cancel / reject / reconcile lifecycle | 市场观点、research evidence |
| `review` | flow 闭合、结果归因、needs_review / governance handoff | 自动修改 strategy |

## 5. Order Lifecycle

统一词表：

```text
intent_created -> contract_compiled -> submitted -> accepted
  -> partially_filled -> filled
  -> amended / cancel_requested / cancelled / rejected / expired
  -> unknown / needs_review / reconciled
```

- `submitted / accepted` 不改变 position。
- `partially_filled / filled / reconciled fill` 才改变 position。
- partial fill 保留剩余订单和剩余仓位，不能简化成 full fill。
- `unknown / needs_review` 形成 risk lock；只允许 reconcile 或防御动作。

## 6. Projection

projection 至少可重建：

- current orders and lifecycle
- current position / remaining quantity
- active / closed flow
- lane conflict
- latest slow observe
- open action gap
- risk lock / needs review
- account-scoped exposure / reserved risk / gross and symbol notional / realized PnL projection
- projection ref、content hash、completeness、reconcile status 与 freshness

projection 不是新事实源；cache 丢失时必须能从 ordered events 恢复。新增风险只能消费 owner 生成、account ref/scope 匹配、complete、未 risk-lock、已 reconcile 且足够新鲜的 portfolio projection。

## 7. Reconcile

事实优先级：

```text
Binance account/order/fill facts
  > local event stream
  > governance evidence / artifact
  > memory / summary
```

Recovery 固定步骤：读取本地 projection、拉取 symbol-scoped exchange facts、分类 matched / draft / protective drift / unmatched、显式 apply 安全 draft、为 unresolved 写 `needs_review`。防御性修复不能冒充账本已经恢复。

## 8. 写入边界

- Event Store：validate、append、read ordered events。
- Flow Projector：reduce、active flows、lane conflict、approved reconcile apply。
- Execution Recorder：exchange result → audited event draft。
- Recovery Runner：exchange read → reconcile → safe apply / needs_review。
- Governance：消费 closed flow，写独立 ledger；不改历史 event。

任何新 event 字段或 lifecycle 状态必须同时更新 schema、reducer、fixture 和 owner contract。
