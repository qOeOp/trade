---
title: Watch Task Runtime
role: runtime-feature-contract
status: active-partial
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# Watch Task Runtime

## 1. 当前采用范围

Watch Task 解决“计划已存在，但 15 分钟 fast cadence 对入场/失效条件太慢”。当前只实现一个纵切：已校验 plan 与 proposed `action_intent` 的 Binance USD-M public mark price 周期观察；价格进入固定区间时产生 revalidation handoff，触发 invalidation、deadline、数据/次数/错误预算时保守终止。

它不是策略 Agent、通用 predicate DSL 或微型交易机器人。当前实现不证明计划已经批准，不接 L2 depth delta，不调用 execution/exchange/event store；因此保持 `active-partial`。

## 2. Authority

```text
validated plan/proposed action-intent refs
  -> decision watch-task compiler -> contract compile + canonical hash
  -> ops_runtime_store definition/state/transition + fenced lease
  -> bounded watch runtime -> public symbol-snapshot owner
  -> triggered action_intent_revalidation handoff (execution_authority=none)
  -> watch handoff revalidator -> existing trigger gate + plan preflight
  -> no-authority receipt; any execution still needs a separate authorized path
```

- `apps/contracts/watch-task-contract` 拥有 definition、observation、evaluation 与单调状态词汇。
- `apps/live-decision-planning/watch-task-compiler` 只把 identity/hash/lineage/expiry 一致的 plan draft 与 proposed intent 编译为 definition；proposed 不是执行授权。
- `ops.runtime-store` 拥有 task CAS、counter、lease、handoff receipt、terminal reason 与 append-only transition。
- `ops.watch-task-runtime` 只拥有 loop、固定 owner 调用、lease renew/release 和停止语义。
- `execution.watch-handoff-revalidation` 绑定 immutable definition/handoff/plan identity，以新 observation 复跑既有 execution gate 与 plan preflight；通过仍不产生 execution authority。
- action intent、preflight、execution gate、exchange write 与 trade fact authority 均不迁入本功能。

## 3. 首个 Definition

| 维度 | 固定语义 |
| --- | --- |
| identity | task/plan/flow/intent/content hash/idempotency；definition canonical hash 后不可变 |
| trigger | `mark_price_in_range(low, high)` |
| invalidation | long 仅 `mark <= price < trigger.low`；short 仅 `mark >= price > trigger.high`；先于 trigger 求值 |
| lifetime | canonical UTC `created_at <= not_before < deadline`；总 TTL 不超过 24h |
| budget | poll `250ms..60s`、observation/error 上限、fact age `100ms..60s` |
| source | 固定 public symbol snapshot；接受 fresh point-in-time/continuous，拒绝 unknown/resynced |
| handoff | exact intent/hash/flow/idempotency/observation ref；`execution_authority=none` |

未知字段、其他 predicate、非 canonical time、方向与 invalidation 不一致、过长 TTL、hash 漂移均 fail closed。LLM 自然语言条件必须先由未来 plan owner 编译为这个窄合同；不能直接进入 loop。

## 4. Lifecycle 与恢复

```text
created -> armed -> observing -> triggered -> handed_off -> completed
                    |              |
                    +-> expired | cancelled | blocked
```

- 每次 mutation 带 expected version；重复/并发 worker 不能越过 CAS。
- 每个 task 使用 `watch-task:<task_id>` fenced ops lease；失去 lease 只停止本地 loop，不伪造 terminal。
- 重启后 create-or-identical 幂等读取已存 definition/counter/status；active state 从下一次 observation 继续。
- `triggered` 只保存 typed proposal；收到 downstream intake receipt 后才能 `handed_off`，收到 downstream result ref 后才能 `completed`。
- terminal audit 不删除；释放 timer、owner subprocess 与 lease不等于删除状态。

## 5. 失败语义

| 条件 | 结果 |
| --- | --- |
| `now >= deadline` | `expired/deadline_reached`，不读市场 |
| source unavailable/stale/future/continuity unknown | 消耗 error budget；超限 `blocked` |
| observation budget reached | `blocked/observation_budget_exhausted` |
| symbol/hash/handoff identity drift | 拒绝 mutation；operator attention |
| invalidation hit | `blocked/invalidation_hit`；无 handoff |
| trigger hit | `triggered`；只返回 revalidation handoff |
| lease busy/lost | 不启动或立即停 loop；允许现 owner/后续 owner继续 |

## 6. 当前证据与下一门

已实现 compiler/contract/store/runtime/revalidator 与 fenced receipt closure：plan/intent lineage、trigger、invalidation-first、expiry、stale/error/observation budget、idempotent create、CAS、restart、no-authority revalidation、handoff receipt 和 terminal audit 均有 fixture。合同、store、loop、compiler、revalidator 与 receipt session 的编译后 Node runner 共通过 13 项测试；基于干净 HEAD 的临时 SQLite 多进程 owner-action 演练又通过 create 幂等、stale CAS 拒绝、重启读取、wait/trigger、handoff/complete、cancel 和六段 transition audit，且 authority 始终为 `none`。

S2 本地实现与隔离证据已收口。当前机器仍有其他并行 Bun runner 长时间阻塞，因此 Bun-native 五模块测试与 published `run/revalidate` CLI 组合演练保留为环境恢复后的 adoption gate；这不扩大权力，也不允许 exchange write。下一施工面转入 J01–J07 no-live shadow 编排。
