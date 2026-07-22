---
title: Replay Operations Runbook
role: research-operations-runbook
status: active
owner: replay-execution-plane
last_verified: 2026-07-22 CST
---

# Replay Operations Runbook

本 runbook 只处理 Replay 四个公共 profile 的结构化终态与本地 manifest-last Artifact。它不把 stderr、进程存活或 payload 文件当作结果 authority，也不承诺集中日志、指标后端、自动告警或远程存储恢复。

## 1. 入口与证据

- 公共 profile：`single-trial`、`independent-lane-batch`、`integrated-portfolio`、`terminal-aware-bounded-cycle`。
- 先保存调用方收到的完整 Outcome；不得只摘录 message。
- 以 profile identity、plan/lease hash、terminal `status`、failure code、partial-publication flag、Result hash 与 committed manifest hash 关联一次运行。
- 只有通过 owner validator 的 `completed` Outcome 和 committed manifest 可作为成功证据。payload-only、临时文件、stderr 和未校验 checkpoint 都不是 authority。

快速核对：

```bash
bun scripts/check-rd-replay-maturity-gate.ts
bun --cwd modules/research-strategy-development/replay-execution-plane/certification/replay-certification test
bun --cwd modules/research-strategy-development/replay-execution-plane/certification/replay-certification certify
```

## 2. 首次分流

1. 无法解析 Outcome、schema/hash 校验失败或缺 identity：停止消费，按 `unknown-or-malformed-outcome` 处理。
2. `status=completed`：继续校验 Result 与 manifest hash；缺 committed manifest 不得报成功。
3. `status=failed|cancelled`：确认 partial-publication flag 为 `false`，按 failure code/class 和下表处理。
4. 发现 payload 但无 manifest：按非权威 orphan 处理；不得手工补 manifest。
5. 已提交 manifest 的任一 payload hash 不符：隔离整个 commit；不得重哈希、覆盖或静默修复。

## 3. Incident 决策表

| incident class | 判定 | 自动重试 | operator action | 恢复边界 |
| --- | --- | --- | --- | --- |
| `invalid-or-unauthorized-input` | input/authority/lease/plan 拒绝 | 禁止 | 修复冻结输入或重新取得 Control Plane authority，创建新 attempt | fresh attempt |
| `checkpoint-or-source-integrity-failed` | Dataset、source prefix、Checkpoint hash/state 不闭合 | 禁止 | 隔离可疑证据；改用仍可信 checkpoint，或从冻结输入确定性重跑 | clean checkpoint 或 full rerun |
| `child-or-profile-execution-failed` | child、allocation、risk、cycle 任一阶段失败且无权威结果 | 禁止 | 保留完整 Outcome；Independent 等 authoritative children 齐备后重算 aggregate；Integrated/Terminal 全 profile 重跑 | aggregate/full rerun |
| `publication-interrupted-before-manifest` | payload 已写但 manifest 未提交 | 仅 identical source/bytes 可重试 | 确认 namespace、owner 与输入完全相同后走原 publisher；不要手工提交 | manifest-last identical retry |
| `committed-artifact-corrupt` | committed payload/manifest hash 不匹配 | 禁止 | 隔离 commit，保留 incident evidence，从可信冻结输入创建新 attempt | fresh attempt；不修复旧 commit |
| `operator-cancelled` | typed cancelled Outcome | 禁止 | 保存 cancellation observation；如需继续必须获得新的明确 authority | authorized new attempt |
| `unknown-or-malformed-outcome` | 未知 schema/code、缺字段或 validator 失败 | 禁止 | fail closed，保留原始 bytes，升级给 Replay owner | 无自动恢复 |

`retryable=true` 只是 single Trial Outcome 的局部提示，不覆盖本表的 authority、source identity、checkpoint 与 manifest 条件；其他 profile 不得从 message 文本推断可重试。

## 4. Profile 必查字段

| profile | identity | terminal/incident | authority evidence |
| --- | --- | --- | --- |
| single Trial | `run_id / attempt_id / lease_generation` | `status / idempotent_replay / failure.code / failure_class / retryable / partial_result_published` | `result / artifact_manifest / artifact_commit` |
| independent Batch | `batch_id / plan_hash` | `status / child_statuses[].status / failure.code / failed_lane_id / partial_result_published` | child Result/manifest hashes、aggregate `result_hash`、`outcome_hash` |
| integrated Portfolio | `portfolio_id / integrated_plan_hash` | `status / failure.code / partial_result_published` | integrated `result_hash`、Artifact `manifest_hash`、`outcome_hash` |
| terminal Cycle Sequence | `portfolio_id / sequence_plan_hash` | `status / idempotent_replay / failure.code / cycle_index / partial_sequence_result_published` | sequence `result_hash`、Artifact `manifest_hash`、`outcome_hash` |

## 5. 关闭条件

- 原始 Outcome、identity/hash、incident class、处置人和处置结果已记录。
- failed/cancelled 路径确认没有 partial authoritative Result/manifest。
- 恢复后的新 Outcome 独立校验通过；不得用旧失败记录覆盖新 attempt。
- committed corruption、未知 schema 或重复失败必须升级给 Replay owner；没有证据时不得降级为“已恢复”。

## 6. 明确未覆盖

- 集中日志、指标时序库、dashboard、pager/SLO 与跨服务 trace。
- remote/distributed Artifact store、硬件损坏、跨 host/runtime parity。
- 自动修复 committed corruption、自动选择 checkpoint、自动重放或自动发布 release verdict。
- 进程内阶段级 telemetry；本 gate 只认证结构化 terminal outcome 与 committed authority evidence。
