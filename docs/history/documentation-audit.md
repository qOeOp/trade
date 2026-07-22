---
title: Documentation Audit
role: historical-audit
status: completed-historical
owner: architecture
last_verified: 2026-07-22 CST
---

# Documentation Audit

## 结论

L1 `docs contract` 已有可用骨架，代码、manifest 与生成投影当前一致；主要风险不是架构实现，而是施工计划和当前契约混读。本文是一次性审查记录，不是新的架构真相源。

“文档是第一层”指新增能力先明确产品边界、术语、owner 与红线，不代表 `docs/` 下每份文件都是当前态。当前读取顺序：

| 问题 | Canonical source |
| --- | --- |
| 产品边界 | [vision.md](../product/vision.md) → [prd.md](../product/prd.md) → [user-story.md](../product/user-story.md) |
| 顶层架构与在线语义 | [README](../../README.md) → [design-architecture.md](../architecture/design-architecture.md) |
| 模块归位与调用入口 | [tool-layout.md](../architecture/tool-layout.md) → [toolset.json](../../toolset.json) → module `CONTRACT.md` |
| Domain / Job / Store / Rail 机器真相 | [architecture-manifest.json](../architecture/architecture-manifest.json) |
| 当前代码投影 | [architecture-drift-report.md](../architecture/generated/architecture-drift-report.md) |
| R&D 物理迁移与剩余语义替换 | [rd-architecture-migration-plan.md](../research/architecture/rd-architecture-migration-plan.md) |
| 历史施工依据 | `architecture-cleanup-plan.md`、`module-structure-refactor-plan.md`；不得反向覆盖当前态 |

## 本轮发现与处理

| 级别 | 发现 | 处理 |
| --- | --- | --- |
| P0 | 未发现断裂的 Markdown 相对链接、manifest 孤儿模块或缺失模块 | 无阻断 |
| P1 | 两份已完成计划仍以当前态语气展示旧目标路径 | 标为 `completed-historical`，加入 canonical 指向 |
| P1 | `tool-layout.md` 仍称目录处于迁移中间态，并引用已退役 `trade-flow/src/domain/*` | 改为当前 façade / owner 口径 |
| P1 | `modules/README.md` 留有 RD 根级旧路径及已删除 Trade-Flow domain contract | 删除旧清单，改为四子树与 façade 口径 |
| P1 | `trade-flow/CONTRACT.md` 把 event store、projection、execution、recovery 算法写成自身 owner | 改为 suite routing 与 owner handoff |
| P1 | `design-architecture.md` 仍把通知模块写成未来且路径错误 | 对齐现有 `ops-notify-dispatch` |
| P1 | Blueprint 迁移文档宣称跨域源码飞线为 0，而生成投影为 2 | 对齐为两条已登记 Market Data → Replay contracts 债务 |
| P2 | docs-only 检查此前只要求 whitespace，无法约束架构文档同步 | `check-contract.md` 增加链接、路径、历史状态与 manifest/drift 复查规则 |
| P2 | `design-architecture.md`、`tech-spec.md` 与两份 RD 设计文档体量过大，当前态、限制与演进记录仍有混合 | 本轮不拆；拆分前先确定稳定 owner，避免再设计一套文档树 |

## 复核门

- `bun scripts/check-architecture-manifest.ts`
- `bun scripts/architecture-drift-audit.ts --check`
- Markdown 相对链接解析
- 当前契约中的具体 repo path 存在性抽查
- `git diff --check`

本轮没有改产品范围、策略规则、tool 数量、job 数量或 runtime 语义。
