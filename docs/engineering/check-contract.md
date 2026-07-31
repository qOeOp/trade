---
title: Check Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-31 CST
---

# Check Contract

## 定位

本文只回答“改了什么，最少跑什么”。检查命令由现有 owner、package 和 CI 提供；本文不复制
每个模块的脚本，也不建立第二套 build system。

## 通用规则

- 所有候选检查完整 mission-owned diff，运行 `git diff --no-renames --check HEAD`，并确认检查没有产生非预期 workspace side effect。
- 经 PR 交付时，本地运行受影响 owner、真实 consumer 和必要边界检查；不默认运行本地 `project-quality`。远端 required checks 对 exact head 完成全仓 merge closure。
- CI leaf 失败时只本地复现对应 owner 或 leaf；修复后由新 head 的远端 required checks 重新闭合。
- 不经 PR 的交付按影响面选择能在本地终结结果的 gate；CI 不能替代真实 runtime 或 consumer 验收。
- Binance 真实写接口默认只跑单测、dry-run 或 preview；live/test endpoint 必须由用户明确授权。
- schema 或 shared contract 变化同时验证 producer、直接 consumer 和 registry/architecture 边界。

## 稳定入口

| Check id | 命令 | 用途 |
| --- | --- | --- |
| `repo-whitespace` | `git diff --no-renames --check HEAD` | 当前 tracked candidate 的空白与冲突标记 |
| `project-quality` | `scripts/quality-check.sh [all\|policy\|typescript\|replay\|native]` | CI leaf 与可选本地诊断；不是默认 commit/push 前置 |
| `typescript-lint` | `bun run lint` | TypeScript ESLint，warning 上限 0 |
| `shell-lint` | `bun run lint:shell` | ShellCheck warning/error |
| `workspace-hygiene` | `bun scripts/check-workspace-hygiene.ts` | runtime DB、sidecar 和 module-local data 边界 |
| `workspace-side-effect` | `bun scripts/check-workspace-side-effects.ts --action capture/check --snapshot <ignored-path>` | 检查前后 tracked/unignored 内容变化 |
| `test-source-boundary` | `bun scripts/check-test-source-boundaries.ts` | 生产源码不得依赖 test runtime 或 test-support |
| `package-test` | `bun scripts/check-package-tests.ts --run-package <owner-dir>` | 直接执行一个 TypeScript owner 的 compiler 与 colocated tests |
| `package-test-all` | `bun scripts/check-package-tests.ts --run-all` | TypeScript 全量或 CI shard |
| `doc-contract-check` | `bun scripts/check-doc-contracts.ts` | 文档元数据、索引、状态和本地链接 |
| `workspace-skill-check` | `sh scripts/check-workspace-skills.sh` | project-local skill 边界与 helper regression |
| `architecture-manifest-check` | `bun scripts/check-architecture-manifest.ts` | domain/module/job/store/rail 与实现对齐 |
| `architecture-drift-check` | `bun scripts/architecture-drift-audit.ts --check` | 当前蓝图与代码边界漂移 |
| `storage-schema-check` | `bun scripts/check-storage-schemas.ts` | logical store DDL 与 manifest |
| `secret-scan` | `bun scripts/check-secrets.ts` | tracked/unignored credential |
| `replay-semantic` | `bun run check:replay-semantic` | Replay 核心确定性与 authority 语义 |
| `replay-release` | `bun run check:replay-release` | Replay release evidence closure |
| `convergence-report` | `bun scripts/check-convergence-budget.ts` | 非阻断表面积观测；不签发设计结论 |
| `codeql` | GitHub Actions | JavaScript/TypeScript、Python、Go、Rust 扫描 |

## 改动路由

| 改动 | 最小检查 |
| --- | --- |
| current docs、模块 `CONTRACT.md` | `doc-contract-check` + `repo-whitespace` |
| 模块路径或边界、架构路径、domain、job、store、rail | docs 检查 + `architecture-manifest-check` + `architecture-drift-check` |
| `AGENTS.md` 或 `.agents/skills/**` | `workspace-skill-check` + `repo-whitespace` |
| 单 TypeScript owner | `package-test --run-package <owner-dir>` + 受影响的真实 consumer |
| shared contract、schema、跨 owner 类型 | 所有受影响 owner checks + 最窄 integration/consumer journey |
| Go owner | owner 目录执行 `go test ./...`；有 vet 合同时再执行 `go vet ./...` |
| Rust owner | owner 目录执行 `cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test` |
| Python owner | owner 自有测试与静态入口；不得假设 `python` 命令存在 |
| Replay semantic | 对应 owner check + `replay-semantic`；release-bound 改动再跑 `replay-release` |
| live execution/risk/recovery | owner checks + dry-run/shadow consumer；真实写动作另行授权 |

若 package 有更精确的公共行为合同，优先执行其 `CONTRACT.md` 所列 consumer/check；package
内 `bun run check` 可作开发入口，但项目级验收仍以实际执行的 owner 与 consumer 证据为准。

## 何时使用全量

经 PR 交付不因准备 commit/push、跨语言或 shared contract 自动升级为本地全量。只有以下情况
使用 `project-quality`：

- 不经 PR 且需要本地全仓终结；
- 用户明确要求；
- 故障无法缩小到一个 owner 或 CI leaf。

## 不自动执行

- Binance 下单、撤单、调仓或保护腿写接口；
- Binance test endpoint smoke；
- 长窗口行情下载；
- 大规模 R&D campaign；
- 一小时以上 soak。

这些操作需要单独授权和独立运行记录。
