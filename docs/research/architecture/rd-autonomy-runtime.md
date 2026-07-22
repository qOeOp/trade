---
title: R&D Autonomy Runtime
role: research-feature-contract
status: active-partial
owner: research-strategy-development
last_verified: 2026-07-23 CST
---

# R&D Autonomy Runtime

## 1. 当前闭环

J04 现在由 `research.rd-autonomy-cycle` 唤醒，但既有 `research.rd-supervisor` 仍拥有 Trial/Result/learning writeback。autonomy cycle 只补 empty/unready queue：

```text
plan_next
  -> stopped: terminal, zero model/Trial
  -> ready: existing rd-supervisor, zero model
  -> blocked + active/budgeted
       -> hypothesis model_task -> gateway -> domain assessment
       -> invalid/unready/provider failure: no state write, no Trial
       -> ready queue proposal -> queue_proposal(updated_at CAS)
       -> existing rd-supervisor
```

J05 forward tracker 与 J07 review 继续按自身 state/cadence 运行；它们不迁入 autonomy cycle，也不能因模型 proposal 自动 promotion。

## 2. 不变量

- task/idempotency identity 来自 program plan 与 cycle；重启同一 proposal 只能得到 identical duplicate 或 stale/conflict failure。
- `queue_proposal` 只接受 `ready=true`，要求精确 prior `updated_at` 且原子推进时间；同 hypothesis id 内容不同直接冲突。
- queue CAS 之前，模型/adapter 均无 state write；CAS 之后只由原 supervisor 消费 queue 并管理 Trial reservation、Result publication、预算和 writeback。
- `budget_exhausted / shadow_candidate_found / data_or_tool_blocked / paused` 不调用模型；已有 ready plan 也不浪费模型预算。
- `no_promote` 是研究完成结果，不是 promotion；Reviewer/Strategy Registry authority 不变。
- 全链禁止 `trade.db`、exchange write、自动打开 locked holdout、自动 draft/promotion 与执行 authority。

## 3. 失败与恢复

| 故障 | 结果 |
| --- | --- |
| credential/provider/timeout/invalid JSON | 本轮 `blocked/retryable` proposal result；RD state 保持原 active plan，可在后续 cadence 重试 |
| hypothesis schema/data/family 不 ready | no state write、no Trial；保留 assessment blocker |
| CAS stale/conflict | 本轮失败并由 runtime incident 观察；不得覆盖新状态 |
| identical proposal replay | `duplicate=true`；queue 仅一份，随后 supervisor 依既有 Result/Trial idempotency 恢复 |
| supervisor/worker crash | 沿用 Control Plane reservation、Result publication 和 program state 恢复；autonomy cycle 不制造第二套 Trial authority |
| program terminal/paused | zero model、zero supervisor |

## 4. 当前证据与采用门

本地编译测试已覆盖 stopped/ready/blocked 三分支、有效 proposal 的固定调用顺序、失败零写入、CAS 首次写入、identical duplicate、stale writer 与同 ID 冲突；J04 automation fixture 验证 registry/cwd/profile/禁止写面，既有 Control Plane 测试继续覆盖 `no_promote`、Trial completion/failure 与 Result publication。

仍未完成真实 provider + owner CLI 的端到端 campaign、进程 kill/restart 下“单 proposal/单 Trial/单 Result”演练、J04/J05/J07 长时 cadence soak，以及 server secret/incident/usage 观测。因此保持 `active-partial`；当前 server config 仍不据此获得 live 或 promotion authority。
