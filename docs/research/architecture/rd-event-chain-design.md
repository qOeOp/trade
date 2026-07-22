---
title: R&D Event Contract
role: research-feature-contract
status: active
owner: research-strategy-development
last_verified: 2026-07-22 CST
---

# R&D Event Contract

## 1. 边界

R&D 需要可重放 lifecycle，但不进入在线 `trade.db.plan_event`。Research Control Plane / state store 拥有 hypothesis、contract、trial、result、review、lesson 与状态迁移；Replay / Forward 只产证据，在线 flow 只产交易事实。

## 2. 三类事实

| 事实 | Store | 不可替代 |
| --- | --- | --- |
| 在线 observe / fill / review | `trade_event_store` | research result、paper sample |
| R&D lifecycle / trial / result | `research_state_store` | live execution、promotion decision |
| promotion / evidence intake / policy feedback | `governance_ledger` | 原始 trial、在线持仓事实 |

跨 store 只传 typed ref / fingerprint，不复制整段事实。

## 3. Lifecycle

```text
hypothesis proposal
  -> validated / rejected
  -> frozen experiment contract
  -> Trial reserved / running
  -> Replay Result
  -> research review
  -> lesson or draft authorization
  -> Forward Result
  -> governance intake / decision
```

每次状态变化必须带：stable identity、expected version、actor / owner、reason、input refs、result refs、timestamp 和 idempotency key。状态字段是 projection；append lifecycle / decision record 才是历史。

## 4. Write ownership

- Planner / Developer / Reviewer 提交 request 或 decision，不直接更新权威表。
- Control Plane 验证 transition、lease、budget 和 refs 后原子写入。
- Replay / Forward 不改 hypothesis、contract 或 promotion status。
- Governance 不重写 Trial / Result，只记录 intake、decision 和 feedback。
- automation memory 只保存运行续接信息，不是研究证据或长期 lesson。

## 5. Forward / shadow

Forward evidence 必须绑定 frozen candidate、policy、data/source refs、observation time 与 result identity。未触发、no_action、expired 和 blocked 都是样本；不得只保留成交或盈利案例。

paper / shadow sample 不能写成在线 `order_fill`，也不能直接解锁 `live-small`。

## 6. Projection 与恢复

- lifecycle projection 必须能从有序事实重建。
- duplicate idempotency key 返回原结果，不产生第二次 transition。
- version / lease / owner 不匹配时 fail closed。
- artifact 缺失或 fingerprint drift 时保留原记录并标记 evidence unavailable，不伪造替代结果。

## 7. 变更合同

新增事件或状态必须先确定唯一 owner、store、transition 和 consumer，再同步 schema / DDL、state-store tests、相关 Plane contracts 与本文。早期 tracker 模型和落地顺序见 [Legacy R&D Event Chain Design](../../history/legacy-rd-event-chain-design.md)。
