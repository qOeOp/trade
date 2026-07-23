---
title: Blueprint Code Migration
role: architecture-migration
status: active-migration
owner: architecture
last_verified: 2026-07-23 CST
---

# Blueprint Code Migration

## 1. 当前结论

v2 蓝图的物理骨架已落地：10 个顶层 domain、J01-J07、10 个 logical store、10 条 rail、domain runtime、protocol fabric 与 drift audit 均有机器清单和检查。生产源码跨域 import 已归零；迁移重心是移除兼容 authority 与补齐 owner-native pipeline。

当前事实只看：

- [architecture-manifest.json](../architecture-manifest.json)：domain / job / store / rail。
- [architecture-drift-report.md](../generated/architecture-drift-report.md)：代码投影和飞线。
- [Design Architecture](../design-architecture.md)：责任与不变量。
- owner module `CONTRACT.md`：实际输入输出。

旧阶段记录见 [Legacy Blueprint Code Migration Plan](../../history/legacy-blueprint-code-migration-plan.md)，不再复用其中“当前”“下一步”判断。

## 2. 已完成基线

- J01-J07 与 lifecycle processors 分离。
- manifest、storage schema、rail registry、domain runtime schema 可执行检查。
- event store / flow projector、各 logical store owner 与 write contract 已声明。
- domain job 已有 owner-native result 的主路径。
- architecture drift 报告进入 quality gate。
- 新模块按 domain / atomic / contract / internal-engine 规则归位。
- Market Data / Replay 的 status 与 aggregate-trade wire 已上提 `modules/contracts/replay-contract`，生产源码飞线归零。
- 无消费者 `research.candidate-freezer` 已从 toolset、manifest 与代码树退役；共享 frozen-candidate ref 协议保留。

## 3. 剩余迁移债务

| 债务 | 当前边界 | 退出条件 |
| --- | --- | --- |
| compatibility 子树 | 只保留 parity 与迁移入口 | owner-native replacement 通过回归后删除，不新增 authority |
| façade 直接调用 owner CLI | 允许 resolver / adapter，不允许业务判断 | job / rail envelope 成为正常跨域路径 |
| thin owner ports 未接完整 pipeline | 不能据壳声明功能完成 | 实际 consumer、durable result 和 owner tests 闭合 |
| policy consumer 不完全统一 | 未接入字段不算 enforced | runtime policy snapshot 被对应 owner 消费并有测试 |

## 4. 当前执行队列

按依赖顺序连续施工；每项先闭合 owner contract 与测试，再迁 consumer，不以空壳模块或仅有 schema 判定完成。

| 顺序 | 工作 | 完成判据 |
| --- | --- | --- |
| T01 | 锁定基线与施工边界 | 既有工作区改动不被覆盖；本表、验收门和 authority 不变量明确 |
| T02 | Profile / Venue Account Ref / Exchange Account Facts | profile 绑定稳定 account ref；账户事实有 schema、`as_of`、freshness/source 与 owner ref，不携带 credential |
| T03 | Portfolio Account Projection | state owner 从 trade events 生成账户级 exposure、reserved risk、active flow、PnL、risk lock 与 reconcile 状态；preflight 不再信任匿名 caller aggregate |
| T04 | Runtime Policy Authorization | compiler 保持纯函数；registry 持久化 immutable snapshot；consumer 解析 account-scoped policy ref/hash/expiry，deny wins |
| T05 | Execution Capability 与 exchange write chain | armable verdict 生成 bounded capability；所有 live write 必经 request router、pre-adapter gate、adapter、confirmation；unknown 进入 reconcile/risk lock |
| T06 | J03 decision chain | owner facts/refs 经 input bundle、trade plan、capital proposal、action intent；`no_action` 仍走同一 contract；manifest 写作用域等于实际行为 |
| T07 | Communication 收敛 | result 使用语义正确的 rail；domain runtime hook 进入真实 handler；跨域硬编码路径改为 owner tool/ref |
| T08 | Research data owner port | data-split 消费 market-data owner dataset ref/port，不持有 OHLCV 物理表读取权；输出 lineage/hash 不退化 |
| T09 | 架构合同同步 | manifest、四张图、storage/toolset、module CONTRACT 与 known gaps 同步，不把目标态冒充现状 |
| T10 | 统一验证与复审 | targeted tests、architecture checks、quality check 全通过；重新给出设计—实现贴合度和剩余例外 |

施工约束：

- 不新增顶层 domain；账户与资金仍由 policy、exchange、state、decision、execution 五段 authority 共同闭合。
- 不引入共享万能账户表；`available_to_trade` 只在 execution 决策时由最新 facts、projection、policy 与 intent 推导。
- 不把 ref 当 payload 或 store 权限；跨域读取必须经过 owner port。
- 不把目录移动、业务语义变化和数据迁移混成一步。
- 当前并行的 Server Runtime、Replay 与 workspace hygiene 改动保持独立；若共享文件发生冲突，先保留已有改动再做最小增量。

## 5. 采用顺序

每条主链按同一方式切换：

1. 建立 shared contract / ref 与 owner producer。
2. 加入 deterministic validation、freshness、hash、expiry、idempotency 与 fail-closed 测试。
3. 迁移一个真实 consumer，保留同输入 parity 证据。
4. 切换 registry / resolver / job handler，使新路径成为必经路径。
5. 删除旧入口、匿名 payload、物理 store 白名单和过时迁移说明。

## 6. 机器门

```text
bun scripts/check-doc-contracts.ts
bun scripts/check-architecture-manifest.ts
bun scripts/check-storage-schemas.ts
bun scripts/architecture-drift-audit.ts --check
bun scripts/check-ts-tool-boundaries.ts
```

迁移完成的判据不是文档打勾，而是：manifest / registry / schema / owner contract / generated drift 与代码同时一致，旧路径已不可调用。
