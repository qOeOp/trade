---
title: Code Quality Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-24 CST
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

- Git diff 空白检查：本地检查 `HEAD` 到工作树的 staged + unstaged 差异；CI 检查 PR/push base 到候选 `HEAD` 的精确范围，并关闭 rename detection
- Shell：`scripts/*.sh` 语法检查
- Helper：`CODEX_HOME`、automation memory、Python command fallback smoke
- Workspace skill：允许纯工作流适配，拒绝 TODO frontmatter、领域源码、schema、DB 和第二套 CLI
- Secret：扫描 tracked / unignored 文件中的 provider token、非空 SiliconFlow assignment 与 literal bearer credential；只报告位置和类别，不回显值
- Docs：当前文档元数据与 index、历史状态、仓库内 Markdown 相对链接
- Architecture：manifest ID / owner / domain / job / store 双向归属必须唯一且闭合；跨域源码飞线、owner-target 漂移、manifest 外 contract root、非静态动态加载、`eval` / `new Function`、package dependency cycle 一律 hard fail；blueprint hash 纳入生成证据，蓝图改变后旧报告立即失效
- TypeScript：根目录 Bun install surface 统一安装依赖；禁止 tool-local `bun.lock`；tool 依赖版本必须与根 `package.json` 一致；跨 package 复用只能指向 manifest 允许的 owner 或 `modules/contracts/*`；每个 TypeScript package 必须有能到达 `tsc --noEmit` 与真实测试的 `check`，总闸无条件执行，删除或 no-op 不得逃逸
- Test integrity：每个含生产 TypeScript 的 package 必须有 colocated `*.test.ts` / `*.spec.ts`，`scripts.test` 与 `scripts.check` 必须真实到达 `bun test`；禁止“没有测试文件也成功”的 fallback
- Test boundary：生产源码不得导入测试 runtime 或 `test-support`；测试 stage / fixture / assertion 进入 `src/test-support/`，不用任意单文件行数限制逼迫机械拆分
- Convergence：恢复期冻结 module owner、registered tool、domain、store、job、rail 的继续净膨胀；Agent 不得自行提高基线
- Judge regression：审查脚本必须通过恶意反例测试，证明飞线、计算型动态 import、job 归属错配、过期架构证据、虚假 maturity evidence、空测试套件均会失败
- Duplication：TypeScript / JavaScript / Go / Python / Rust / Shell 在 `20 lines / 140 tokens` 粒度下重复片段容许数为 `0`；发现重复必须提炼稳定语义或重构边界，不得通过提高阈值、复制豁免或缩小扫描面消音
- Go：`gofmt -l` 必须为空，随后 `go test ./...` 与 `go vet ./...`
- Rust：`cargo fmt --check`、`cargo check`、`cargo clippy -- -D warnings` 与 `cargo test`
- Python：`compileall` + `python -W error -m unittest discover`
- Hygiene：项目文件不得泄漏本机绝对路径；禁止新增 tracked runtime SQLite / sidecar 与 module-local DB；quality 对 tracked + unignored 内容做前后哈希，dirty worktree 只比较增量副作用，CI 还要求 preflight clean；ignored footprint 只分类报告、不静默清理

## 2. 提交品位线

提交前必须满足：

- 无 compiler / typecheck / test / vet failure
- 无未经用户明确批准的责任面扩张；功能必须有 production consumer 与运行链路证据
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

- docs-only 或单模块日常改动：用 `bun scripts/quality-check-changed.ts --path <本次改动路径>` 跑全局静态门与受影响 package；显式路径必须属于当前 worktree diff，防止在共享 dirty worktree 中误纳入其他任务。
- Replay 日常改动由 Changed gate 运行 owner package；contracts / engine / accounting / data-adapter 改动同时运行 runner consumer。runner `check` 是约束明确的 fast 层，不包含 worker-v10。
- Replay 核心语义改动：运行 `bun run check:replay-semantic`；release evidence、compatibility 或发布候选改动再运行 `bun run check:replay-release`。
- Changed gate 遇到共享 contract、脚本/CI/质量基础设施、机器架构 manifest、无 owner 文件或跨语言改动时 fail closed，并要求完整总闸。
- 提交前：跑 `scripts/quality-check.sh`
- 涉及真实 Binance 写接口：仍需显式 `--yes`；quality gate 不执行真实下单 / 撤单 / 调仓

## 4. 不伪装的缺口

当前仍未引入仓库级 TypeScript / Python formatter，也未把函数复杂度硬编码成脱离领域语义的单一数字。现阶段由零重复、依赖无环、静态边界、强类型、真实测试和 review 共同约束；若引入复杂度指标，必须先用仓库反例校准误报，不能把“短函数”误当“好架构”。

GitHub Actions 在 pull request 与 `main` push 上执行同一 `scripts/quality-check.sh`，并把事件 base commit 传给总闸检查精确候选范围；本地与 CI 不存在两套裁判规则。workflow 成功是否实际阻止合并仍由 GitHub repository ruleset / branch protection 决定，仓库内代码不能替代该外部设置。

同一仓库同一时刻只允许一个 `quality-check.sh` 实例。第二个实例必须快速失败并报告持锁 PID；异常退出遗留的死锁可在确认 owner PID 不存活后自动回收，禁止多个全量 Replay 测试争抢 CPU 后把资源竞争误判为代码慢。

本地总闸只缓存 Replay semantic 层，cache key 绑定 runner 的直接语义输入：Replay contracts / engine / accounting / data-adapter、Control Plane contracts、runtime-core、测试/锁脚本、根依赖锁、Bun 版本、平台与精确命令。compatibility、agent-role 或无关模块文本变化不再误触发 worker-v10；任一真实输入变化都会 miss。CI 从不复用本地收据；需要本机强制重跑时使用：

```bash
QUALITY_FRESH=1 scripts/quality-check.sh
```

该缓存只减少确定性重放，不改变 package `check`、Replay certification、发布证据或 authority。

Replay certification 对 fixture、manifest、Result / Artifact authority 继续使用内容寻址。普通文件排版和等价 import 路径不单独充当语义证据；但发布裁判及其 golden 测试必须绑定源码 hash，Harness identity 继续绑定实际可执行源码集合，防止裁判或执行实现变化后旧收据仍被接受。
