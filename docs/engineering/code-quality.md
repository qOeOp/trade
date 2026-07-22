---
title: Code Quality Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-22 CST
---

# Code Quality Contract

## 0. 定位

本文回答：提交前代码是否干净、克制、可交给别人接手。

它不是新的架构计划；只定义项目级质量闸。能自动检查的进入 `scripts/quality-check.sh`，不能自动检查的作为 review 口径。

本仓库默认面向真实 Binance USDM `live-small`。质量闸只证明代码、契约与 helper 干净；真实交易安全边界由 runtime permissions、preflight、execution contract、显式 `--yes` 与 exchange fact reconciliation 承担。

## 1. 项目级入口

```bash
scripts/quality-check.sh
```

覆盖：

- Git diff 空白检查：冲突标记、尾随空格、空白错误
- Shell：`scripts/*.sh` 语法检查
- Helper：`CODEX_HOME`、automation memory、Python command fallback smoke
- Workspace skill：允许纯工作流适配，拒绝 TODO frontmatter、领域源码、schema、DB 和第二套 CLI
- Secret：扫描 tracked / unignored 文件中的 provider token、非空 SiliconFlow assignment 与 literal bearer credential；只报告位置和类别，不回显值
- Docs：当前文档元数据与 index、历史状态、仓库内 Markdown 相对链接
- TypeScript：根目录 Bun install surface 统一安装依赖；禁止 tool-local `bun.lock`；tool 依赖版本必须与根 `package.json` 一致；禁止 tool 之间直接 import / re-export，复用只走 `modules/contracts/*`，协作走 CLI JSON contract；所有带 `package.json` 且含 `check` script 的 tool 执行 `bun run check`
- Go：`gofmt -l` 必须为空，随后 `go test ./...` 与 `go vet ./...`
- Rust：`cargo fmt --check`、`cargo check`、`cargo clippy -- -D warnings` 与 `cargo test`
- Python：`compileall` + `python -W error -m unittest discover`
- Hygiene：项目文件不得泄漏本机绝对路径

## 2. 提交品位线

提交前必须满足：

- 无 compiler / typecheck / test / vet failure
- Python warning 按 error 处理
- Go 文件必须 `gofmt`
- Rust 文件必须通过 rustfmt，且 clippy warning 按 error 处理
- 新增 shell 必须可 `sh -n`
- 文档不写本机路径、临时调试路径或未实现制度
- helper / automation 路径必须走项目脚本，不直接拼 `$CODEX_HOME/...`
- Python 命令不默认写死 `python`；先用 `scripts/resolve-python.sh`

## 3. 分层使用

- 小改动：按 [check-contract.md](./check-contract.md) 跑最小检查
- 提交前：跑 `scripts/quality-check.sh`
- 涉及真实 Binance 写接口：仍需显式 `--yes`；quality gate 不执行真实下单 / 撤单 / 调仓

## 4. 不伪装的缺口

当前没有引入统一 formatter / linter 配置仓库级管理 TS 与 Python 风格；先用各 tool 已有 `check`、Go 原生命令和 Python warning-as-error 兜底。后续若代码量继续增长，再引入统一 formatter，而不是现在为工具化而工具化。
