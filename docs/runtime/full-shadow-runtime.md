---
title: Full Shadow Runtime
role: runtime-feature-contract
status: active-partial
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# Full Shadow Runtime

## 1. 采用范围

`full_shadow` 是 S3 的独立固定 profile：复用既有 program supervisor、fenced lease、稳定 cycle id、J01–J07 job graph、owner command 与 ops audit；它不改变当前服务器仍运行的 `shadow_program`，也不获得 exchange write authority。

```text
foreground supervisor
  -> full_shadow wakeup (single fenced owner)
  -> runtime health: L2 owner + resident consumer required
  -> J01 -> J02 -> J03/J04/J05/J06 -> J07
  -> control review -> dry-run notify
```

所有 job 被 `enabled` 且 cadence 被强制 due；是否有实际工作仍由 owner 的 active/state 条件决定。空 active flow 不伪跑 J01/J02/J07；无 active RD program 不伪跑 J04；无 tracker 不伪跑 J05。

## 2. 固定权力

| Job | Owner 条件 | 允许的 logical write | 仍禁止 |
| --- | --- | --- | --- |
| J01/J02 | active flow / reconcile / guard 条件 | `trade_event_store` | Binance write、新 thesis |
| J03 | slow owner due | 当前 owner contract | 绕过 plan/preflight |
| J04 | active RD program/goal | `research_state_store`, `artifact_catalog` | `trade.db`、promotion、Binance write |
| J05 | configured tracker | `artifact_catalog` | formal promotion、真钱执行 |
| J06 | fixed hygiene scan | `artifact_catalog` | GC、`--yes`、任意删除 |
| J07 | newly closed/missed-review 条件 | `governance_ledger` | 与交易写并行封口、自动改策略 |

全 profile 固定 `allow_live_writes=false`、`notify.dry_run=true`，命令图不接受 `--run-live-small`、`binance-write`、GC 或 `--yes`。可配置面仅限 owner 数据 refs：RD state/program、tracker contracts、catalog DB/roots、governance DB；非 `full_shadow` profile 携带这些字段会 fail closed。

## 3. 恢复与 parity

- `full_shadow` 与 `shadow_program` 共用 supervisor/wakeup lock，不能并行形成第二 authority。
- terminal cycle 重试只读终态；running cycle 只能在 stale/released lease 后恢复。
- Agent/program parity 使用同一批捕获 owner result 回放，并比较 canonical job/processor/incident projection；cycle 派生 `run_id` 只属于 invocation identity，不改变命令语义。
- lease loss、DB busy、child timeout、health dependency fail 均进入现有 ops cycle/job/incident，不静默跳过。

## 4. 当前证据与采用门

干净 HEAD 已通过 trade-flow typecheck、固定 profile/输入收窄测试、单周期 supervisor parity fixture：7/7 job enabled、全部 cadence due、Agent/program `1/1 match`、无 live command。该 fixture 使用临时 SQLite 与捕获 executor，证明编排语义，不证明真实 owner 长时稳定性。

进入服务器 profile 前仍需按顺序完成：临时 owner DB 的 published CLI no-live smoke；故障/重启下无重复 job/双写；有界 soak 的 parity/incident/readiness 报告；随后才可把版本化 server config 从 `shadow_program` 改为 `full_shadow`。任一门失败均保持当前 server profile 不变。
