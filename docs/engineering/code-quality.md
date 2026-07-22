---
title: Code Quality Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-23 CST
---

# Code Quality Contract

## 0. 定位

本文回答：提交前代码是否干净、克制、可交给别人接手。

它不是新的架构计划；只定义项目级质量闸。架构意图仍由 architecture contract / manifest / blueprint 持有，质量闸负责对代码无条件执法，不因既存实现而降低标准。能自动检查的进入 `scripts/quality-check.sh`，不能自动检查的作为 review 口径。

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
- Architecture：manifest ID / owner / domain / job / store 双向归属必须唯一且闭合；跨域源码飞线、owner-target 漂移、manifest 外 contract root、非静态动态加载、`eval` / `new Function`、package dependency cycle 一律 hard fail；blueprint hash 纳入生成证据，蓝图改变后旧报告立即失效
- TypeScript：根目录 Bun install surface 统一安装依赖；禁止 tool-local `bun.lock`；tool 依赖版本必须与根 `package.json` 一致；跨 package 复用只能指向 manifest 允许的 owner 或 `modules/contracts/*`；所有带 `package.json` 且含 `check` script 的 tool 执行 `bun run check`
- Test integrity：每个含生产 TypeScript 的 package 必须有 colocated `*.test.ts` / `*.spec.ts`，`scripts.test` 必须真实执行 `bun test`；禁止“没有测试文件也成功”的 fallback
- Judge regression：审查脚本必须通过恶意反例测试，证明飞线、计算型动态 import、job 归属错配、过期架构证据、虚假 maturity evidence、空测试套件均会失败
- Duplication：TypeScript / JavaScript / Go / Python / Rust / Shell 在 `20 lines / 140 tokens` 粒度下重复片段容许数为 `0`；发现重复必须提炼稳定语义或重构边界，不得通过提高阈值、复制豁免或缩小扫描面消音
- Go：`gofmt -l` 必须为空，随后 `go test ./...` 与 `go vet ./...`
- Rust：`cargo fmt --check`、`cargo check`、`cargo clippy -- -D warnings` 与 `cargo test`
- Python：`compileall` + `python -W error -m unittest discover`
- Hygiene：项目文件不得泄漏本机绝对路径；禁止新增 tracked runtime SQLite / sidecar 与 module-local DB，历史 exception 只减不增

## 2. 提交品位线

提交前必须满足：

- 无 compiler / typecheck / test / vet failure
- 无重复代码片段、跨域飞线、依赖环、动态加载逃逸或 owner 漂移
- 无空测试套件假绿；审查器本身必须有 fail-closed 反例回归
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

当前仍未引入仓库级 TypeScript / Python formatter，也未把函数复杂度硬编码成脱离领域语义的单一数字。现阶段由零重复、依赖无环、静态边界、强类型、真实测试和 review 共同约束；若引入复杂度指标，必须先用仓库反例校准误报，不能把“短函数”误当“好架构”。

GitHub Actions 在 pull request 与 `main` push 上执行同一 `scripts/quality-check.sh`；本地与 CI 不存在两套裁判规则。

同一仓库同一时刻只允许一个 `quality-check.sh` 实例。第二个实例必须快速失败并报告持锁 PID；异常退出遗留的死锁可在确认 owner PID 不存活后自动回收，禁止多个全量 Replay 测试争抢 CPU 后把资源竞争误判为代码慢。
