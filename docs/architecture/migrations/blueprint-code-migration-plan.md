---
title: Blueprint Code Migration
role: architecture-migration
status: active-migration
owner: architecture
last_verified: 2026-07-22 CST
---

# Blueprint Code Migration

## 1. 当前结论

v2 蓝图的物理骨架已落地：10 个顶层 domain、J01-J07、10 个 logical store、10 条 rail、domain runtime、protocol fabric 与 drift audit 均有机器清单和检查。迁移已从“补目录”进入“移除兼容 authority 与源码飞线”。

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

## 3. 剩余迁移债务

| 债务 | 当前边界 | 退出条件 |
| --- | --- | --- |
| 2 条 Market Data → Replay contract import | 已登记，不得扩张 | 上提共享 contract 或改用 ref / rail，drift 归零 |
| compatibility 子树 | 只保留 parity 与迁移入口 | owner-native replacement 通过回归后删除，不新增 authority |
| façade 直接调用 owner CLI | 允许 resolver / adapter，不允许业务判断 | job / rail envelope 成为正常跨域路径 |
| thin owner ports 未接完整 pipeline | 不能据壳声明功能完成 | 实际 consumer、durable result 和 owner tests 闭合 |
| policy consumer 不完全统一 | 未接入字段不算 enforced | runtime policy snapshot 被对应 owner 消费并有测试 |

## 4. 迁移顺序

1. 禁止新增未登记跨域 import 和 compatibility authority。
2. 先建立 shared contract / ref / owner inbox，再迁调用方。
3. 以同输入 parity、幂等和 store write scope 验证 replacement。
4. 切换 registry / resolver / job handler。
5. 删除旧入口、白名单和迁移说明。
6. 重生成 drift 投影并更新本文剩余债务。

不得把目录移动、业务语义变化和数据迁移混成一步。

## 5. 机器门

```text
bun scripts/check-doc-contracts.ts
bun scripts/check-architecture-manifest.ts
bun scripts/check-storage-schemas.ts
bun scripts/architecture-drift-audit.ts --check
bun scripts/check-ts-tool-boundaries.ts
```

迁移完成的判据不是文档打勾，而是：manifest / registry / schema / owner contract / generated drift 与代码同时一致，旧路径已不可调用。
