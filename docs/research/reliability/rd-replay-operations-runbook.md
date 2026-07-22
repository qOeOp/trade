---
title: Replay Operations Runbook
role: research-operations-runbook
status: active
owner: replay-execution-plane
last_verified: 2026-07-22 CST
---

# Replay Operations Runbook

本 runbook 只处理 Replay 四个公共 profile 的结构化终态与本地 manifest-last Artifact。它不把 stderr、进程存活或 payload 文件当作结果 authority，也不承诺集中日志、指标后端、自动告警或远程存储恢复。

## 1. 适用范围与权威边界

- 公共 profile：`single-trial`、`independent-lane-batch`、`integrated-portfolio`、`terminal-aware-bounded-cycle`。
- 先保存调用方收到的完整 Outcome；不得只摘录 message。
- 以 profile identity、plan/lease hash、terminal `status`、failure code、partial-publication flag、Result hash 与 committed manifest hash 关联一次运行。
- 只有通过 owner validator 的 `completed` Outcome 和 committed manifest 可作为成功证据。payload-only、临时文件、stderr 和未校验 checkpoint 都不是 authority。

## 2. 可观测面与完成判据

| profile | identity | progress / incident | authority evidence |
| --- | --- | --- | --- |
| single Trial | `run_id / attempt_id / lease_generation / attempt_lease_hash` | `status / resumable_checkpoint / diagnostic_checkpoint_commit / cancellation_observation / failure.*` | `result.result_hash / artifact_manifest.manifest_hash / artifact_commit.sha256` |
| independent Batch | `batch_id / plan_hash / outcome_hash` | `status / child_statuses / failure.*` | child Result/manifest hashes、aggregate `result_hash` |
| integrated Portfolio | `portfolio_id / integrated_plan_hash / outcome_hash` | `status / result / risk_result / artifact.status / failure.*` | integrated `result_hash`、Artifact `manifest_hash` |
| terminal Cycle Sequence | `portfolio_id / sequence_plan_hash / outcome_hash` | `status / idempotent_replay / failure.cycle_index / failure.*` | sequence `result_hash`、Artifact `manifest_hash` |

完成必须同时满足：Outcome owner validator 通过、`status=completed`、Result 与 committed manifest hash 闭合。failed/cancelled 路径的 partial-publication flag 必须为 `false`。

## 3. 上线前与值班检查

```bash
bun modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/scripts/main.ts --list --json
bun scripts/check-rd-replay-maturity-gate.ts
bun modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/scripts/main.ts --suite canonical
bun modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/scripts/main.ts --suite compatibility
```

任何命令非零退出都阻断 release；stdout 和进程退出只证明命令执行状态，不替代 Outcome/Artifact authority。

## 4. 首轮分诊

1. 无法解析 Outcome、schema/hash 校验失败或缺 identity：停止消费，保留原始 bytes 并升级。
2. `status=completed`：继续校验 Result 与 manifest hash；缺 committed manifest 不得报成功。
3. `status=failed|cancelled`：确认 partial-publication flag 为 `false`，再按 failure code/class 处理。
4. 发现 payload 但无 manifest：按非权威 orphan 处理；不得手工补 manifest。
5. 已提交 manifest 的任一 payload hash 不符：隔离整个 commit；不得重哈希、覆盖或静默修复。

## 5. 故障类别与处置

| incident class | 首个动作 | retry boundary |
| --- | --- | --- |
| `authority-admission` | 冻结输入并核对 Control Plane authority、lease 与 plan | 仅 Outcome 标明 retryable 且 Control Plane 重新授权 |
| `data-integrity` | 隔离 bytes，核对 lineage、source prefix 与全部 hash | 从可信冻结输入创建新 authorized attempt |
| `deterministic-unsupported` | 记录 typed limitation，向 Control Plane 返回 blocker | 禁止用相同输入重复运行冒充修复 |
| `resource-cancellation` | 核对 lease generation、cancellation observation 与 checkpoint | clean authorized checkpoint 或新 authorized attempt |
| `publication-corruption` | 区分未提交 orphan 与 committed corruption | 仅 manifest 前允许 identical retry；已提交损坏禁止修复 |
| `certification-regression` | 阻断 release，保存 runtime、host、commit 与 receipt | 修复根因后重跑完整 owner certification |

`retryable=true` 只是 single Trial Outcome 的局部提示，不覆盖 authority、source identity、checkpoint 与 manifest 条件；其他 profile 不得从 message 文本推断可重试。

## 6. 取消与恢复

- typed cancellation 先保存 cancellation observation；继续执行需要新的明确 authority。
- single Trial 可使用仍可信且 authorized 的 checkpoint；checkpoint hash/state/source-prefix 任一不闭合即隔离。
- Independent Batch 只在 authoritative child Result 齐备后重算 aggregate。
- Integrated Portfolio 与 Terminal Cycle Sequence 没有 checkpoint writer，只能从冻结输入完整重跑。

## 7. Artifact 与损坏处理

- payload 已写但 manifest 未提交时，orphan 没有 authority；只有 owner、namespace、source 与 bytes 完全相同才可走原 publisher 重试。
- committed manifest 或 payload hash 不匹配时隔离整个 commit，保留 incident evidence；不得重哈希、覆盖或静默修复。
- 恢复生成的新 Outcome 属于新 attempt；不得覆盖旧失败/取消记录。

## 8. 事件包与升级

事件包至少包含：完整原始 Outcome、profile identity、plan/lease/source hash、failure code/class、partial-publication flag、Result/manifest/checkpoint refs、runtime/host/commit、首次失败与复现命令、operator 与处置结果。

committed corruption、未知 schema/code、validator 失败、同一授权重复失败或 certification regression 必须升级给 Replay owner；证据不完整时不得标记“已恢复”。

## 9. 明确未覆盖

- 集中持久日志、指标时序库、trace、dashboard、pager 与 formal SLO。
- remote/distributed Artifact store、硬件损坏、跨 host/runtime 运维一致性。
- 自动 incident remediation、自动修复 committed corruption、自动选择 checkpoint、自动重放或自动发布 release verdict。
- shadow/live/真实账户运维；本 gate 只认证 local structured Outcome、immutable evidence 与 release certification。
