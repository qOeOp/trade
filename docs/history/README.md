---
title: Documentation History
role: history-index
status: active
owner: architecture
last_verified: 2026-07-23 CST
---

# Documentation History

本目录保存被替换的详细旧稿、完成的施工计划、一次性审查和历史渲染物。它们用于追溯决策，不定义当前产品、架构、运行行为或完成度。

## 阅读规则

- 先从 [Documentation Contract](../README.md) 找当前 owner 文档。
- legacy 文件中的“当前 / 下一步 / 已实现 / 尚未实现”只代表归档时点。
- 当前文档与历史冲突时，以当前 contract、machine manifest、owner `CONTRACT.md` 和 executable checks 为准。
- 需要恢复旧设计时，重新作为提案审查；不得直接复制回当前目录。

## 分类

| 类型 | 文件 |
| --- | --- |
| 产品与运行旧稿 | `legacy-product-vision.md`、`legacy-prd.md`、`legacy-user-story.md`、`legacy-trading-config-design.md`、`legacy-tech-spec.md` |
| 架构旧稿与施工 | `legacy-design-architecture.md`、`legacy-blueprint-code-migration-plan.md`、`architecture-cleanup-plan.md`、`module-structure-refactor-plan.md` |
| R&D 详细演进 | `legacy-rd-*.md` |
| 审查与基线 | `documentation-audit.md`、`architecture-inventory.md`、`nofx-design-absorption.md` |
| 运行演练 | `server-no-live-rehearsal-2026-07-23.md`、`macos-no-live-release-staging-2026-07-23.md` |
| v1 图 | `architecture-v1/` |

历史文件保留原始细节并补充替代入口；不为“看起来整洁”删除仍有决策价值的上下文。
