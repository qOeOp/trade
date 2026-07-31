---
title: RD Architecture Migration
role: research-architecture-migration
status: active-migration
owner: research-strategy-development
last_verified: 2026-07-23 CST
---

# RD Architecture Migration

## 1. 当前结论

`apps/research-strategy-development/` 的物理根已收口为四个直接子树：

```text
research-control-plane/
replay-execution-plane/
forward-evidence-plane/
agent-roles/
```

目录迁移已完成；无消费者的 `candidate-freezer` 已退役，底层 frozen-candidate ref 协议继续由 protocol fabric 持有。剩余工作是语义替换、compatibility 退役和 owner consumer 闭合。旧路径不得恢复。

## 2. Authority

- 物理根和 relocation： [rd-module-disposition.json](./rd-module-disposition.json)。
- Replay supported surface：[rd-replay-capability-inventory.json](../reliability/rd-replay-capability-inventory.json)；执行证据与独立发布结论分别由 owner certification 与 release audit receipt 持有。
- Replay 当前只允许 maintenance；后续 R&D 主线从 Planner 的 Control Plane context → bounded Proposal 权威链开始，不创建 P30。
- Planner 首条权威链已闭合为 Control Plane context → Planner Submission v2 → Control Plane Proposal Admission v1；Admission 仅落不可变 Proposal/revision，不等于 Experiment Contract、Trial Group、Trial 或执行授权。旧 `rd_proposal` 的 contract-shaped materialization 暂留兼容，后续必须显式拆出 Proposal → Contract 编译边界，不能反向冒充 Planner intake。
- Proposal → Developer → formal Contract → Replay dispatch 链现为 latest Proposal Admission → immutable Brief → Draft/Receipt → `valid|invalid` Validation → atomic Freeze → atomic Experiment Trial Plan → Replay Trial Reservation Admission v1 → Replay Request Registration v1 → Replay Attempt Admission v2 → Registered Attempt Dispatch Authority v1。Attempt 调用方只提交 Registration id/hash与租约 identity；State Store 从 registry 派生完整 Request、Reservation Snapshot及 hashes，并把 Registration 绑定落到 Attempt。Admission Result v3 只返回 self-hashed Registration/Request/current-Lease Authority；外部 Runner 从该 Authority 派生 Request/Lease，CLI 拒绝 caller-supplied pair。Decision Harness Execution Envelope v2 固定 root Authority hash与 Registration lineage，same-Attempt successor 只能继承，cross-Attempt retry 必须新 root。generic raw claim 已删除，历史测试隔离到 test-only fixture。该 dispatch 纵切完成后不再创建 Replay M5.x；legacy Proposal projection与 raw Snapshot helper 是后续 Control Plane 迁移债务。
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
- legacy integration suite 只证明回归，不证明新 Plane 的完整执行或发布状态。
- Replay 未支持能力以 owner contract、typed unsupported 与 capability inventory 为准，不在迁移文档重复 phase 进度。
- source、artifact、governance 通过 typed refs 协作，不共享物理表。

## 5. 退出顺序

1. owner-native contract / implementation 有真实 consumer。
2. 与 compatibility 路径进行同输入 parity 和 failure parity。
3. registry / CLI / supervisor 切到新 owner。
4. 删除旧入口、alias、白名单和重复 schema。
5. 更新 disposition、capability registry、docs 和 checks。

## 6. 验收

```text
bun scripts/check-rd-target-layout.ts
bun scripts/check-rd-replay-static-consistency.ts
bun scripts/architecture-drift-audit.ts --check
```

“位于新目录”不等于迁移完成；只有 authority、consumer、durable write、tests 和旧入口退役同时成立，语义迁移才完成。
