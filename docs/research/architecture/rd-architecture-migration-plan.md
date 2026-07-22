---
title: RD Architecture Migration
role: research-architecture-migration
status: active-migration
owner: research-strategy-development
last_verified: 2026-07-22 CST
---

# RD Architecture Migration

## 1. 当前结论

`modules/research-strategy-development/` 的物理根已收口为四个直接子树：

```text
research-control-plane/
replay-execution-plane/
forward-evidence-plane/
agent-roles/
```

目录迁移已完成；无消费者的 `candidate-freezer` 已退役，底层 frozen-candidate ref 协议继续由 protocol fabric 持有。剩余工作是语义替换、compatibility 退役和 maturity gate 闭合。旧路径不得恢复。

## 2. Authority

- 物理根和 relocation： [rd-module-disposition.json](./rd-module-disposition.json)。
- Replay 当前成熟度： [rd-replay-maturity-gate.json](../reliability/rd-replay-maturity-gate.json)。
- Plane 边界：各子树 `README.md` / module `CONTRACT.md`。
- 历史迁移进度： [Legacy RD Architecture Migration Plan](../../history/legacy-rd-architecture-migration-plan.md)。

## 3. 四子树责任

| Plane | Owns | Must not own |
| --- | --- | --- |
| Research Control Plane | contract、trial、lease、reservation、state、budget、review intake | replay economics、agent proposal |
| Replay Execution Plane | deterministic execution、accounting、Result / Artifact / Fingerprint | hypothesis、promotion |
| Forward Evidence Plane | frozen candidate 的 paper / shadow / forward evidence | live order、正式升格 |
| Agent Roles | proposal、candidate request、review decision | 权威 DB 直写、绕过 transition |

## 4. 剩余债务

- 剩余 `compatibility/` 只允许现有 parity / migration 行为，不能新增 authority；无消费者入口直接退役，不保留空壳。
- shared contract 必须上提到明确 owner；不得用跨 Plane implementation import 共享语义。
- legacy integration suite 只证明回归，不证明新 Plane maturity。
- Replay 未完成能力以机器 gate 的 `false` 项为准，不在迁移文档重复 phase 进度。
- source、artifact、governance 通过 typed refs 协作，不共享物理表。

## 5. 退出顺序

1. owner-native contract / implementation 有真实 consumer。
2. 与 compatibility 路径进行同输入 parity 和 failure parity。
3. registry / CLI / supervisor 切到新 owner。
4. 删除旧入口、alias、白名单和重复 schema。
5. 更新 disposition、maturity gate、docs 和 checks。

## 6. 验收

```text
bun scripts/check-rd-target-layout.ts
bun scripts/check-rd-replay-maturity-gate.ts
bun scripts/architecture-drift-audit.ts --check
```

“位于新目录”不等于迁移完成；只有 authority、consumer、durable write、tests 和旧入口退役同时成立，语义迁移才完成。
