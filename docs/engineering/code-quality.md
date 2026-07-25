---
title: Code Quality Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-25 CST
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
- TypeScript lint：根 flat config 使用 ESLint recommended + typescript-eslint recommended，覆盖 `modules/` 与 `scripts/`，warning 上限为 0，未使用 disable directive hard fail；`_` 前缀仅表示显式保留的未使用绑定
- Shell lint：所有 tracked 与本地未忽略 `*.sh` 先经 `sh -n`，再以 ShellCheck warning/error hard fail；仅忽略 `CDPATH= cd` 兼容写法的 `SC1007` 误报
- Helper：`CODEX_HOME`、automation memory、Python command fallback smoke
- Workspace skill：允许纯工作流适配，拒绝 TODO frontmatter、领域源码、schema、DB 和第二套 CLI
- Secret：扫描 tracked / unignored 文件中的 provider token、非空 SiliconFlow assignment 与 literal bearer credential；只报告位置和类别，不回显值
- Docs：当前文档元数据与 index、历史状态、仓库内 Markdown 相对链接
- Architecture：manifest ID / owner / domain / job / store 双向归属必须唯一且闭合；跨域源码飞线、owner-target 漂移、manifest 外 contract root、非静态动态加载、`eval` / `new Function`、package dependency cycle 一律 hard fail；blueprint hash 纳入生成证据，蓝图改变后旧报告立即失效
- TypeScript：根目录 Bun install surface 统一安装依赖；禁止 tool-local `bun.lock`；tool 依赖版本必须与根 `package.json` 一致；跨 package 复用只能指向 manifest 允许的 owner 或 `modules/contracts/*`；总闸和 changed gate 直接调用根 compiler 与 package 测试文件，package scripts 只作开发便利，不是验收 authority
- Test integrity：每个含生产 TypeScript 的 package 必须有 colocated `*.test.ts` / `*.spec.ts`；总闸从文件系统发现并显式执行这些测试，零测试 hard fail。Replay runner 的 worker-v10 从普通 package 执行中精确排除，由既有 exclusive semantic gate 单独执行
- Replay durable parent：Worker-v10 后半链对已经完整验证并以 immutable CAS 持久化的父证据写入 `canonical file SHA-256 + parent self-hash` receipt；后续 consumer 以文件字节哈希命中快路径，文件篡改立即失效并回到 fail-closed 验证，不按对象身份或进程缓存跳过完整性检查
- Test boundary：生产源码不得导入测试 runtime 或 `test-support`；测试 stage / fixture / assertion 进入 `src/test-support/`，不用任意单文件行数限制逼迫机械拆分
- Convergence：恢复期冻结 module owner、registered tool、domain、store、job、rail 的继续净膨胀；Agent 不得自行提高基线
- Judge regression：审查脚本必须通过恶意反例测试，证明飞线、计算型动态 import、job 归属错配、过期架构证据、虚假 maturity evidence、空测试套件均会失败
- Duplication：TypeScript / JavaScript / Go / Python / Rust / Shell 在 `20 lines / 140 tokens` 粒度下重复片段容许数为 `0`；发现重复必须提炼稳定语义或重构边界，不得通过提高阈值、复制豁免或缩小扫描面消音
- Go：`gofmt -l` 必须为空，随后 `go test ./...` 与 `go vet ./...`
- Rust：`cargo fmt --check`、`cargo check`、`cargo clippy -- -D warnings` 与 `cargo test`
- Python：`compileall` + `python -W error -m unittest discover`
- Hygiene：项目文件不得泄漏本机绝对路径；禁止新增 tracked runtime SQLite / sidecar 与 module-local DB；quality 对 tracked + unignored 内容做前后哈希，dirty worktree 只比较增量副作用，CI 还要求 preflight clean；ignored footprint 只分类报告、不静默清理

`scripts/quality-check.sh` 是唯一编排入口，但支持 `policy / typescript / replay / native` 四个可组合 scope。GitHub PR workflow 在隔离 runner 中并发执行 policy、两个确定性 TypeScript shard、Replay semantic 与 native toolchain，最后只由稳定的 `quality` aggregate 汇总；本地不并发争抢 Replay/Cargo 资源。CodeQL 作为独立安全扫描并行运行，Replay release closure 只在 nightly/manual certification 运行，避免把发布级重证据塞回每次 PR。

## 2. 提交品位线

提交前必须满足：

- 无 compiler / typecheck / test / vet failure
- TypeScript ESLint 与 ShellCheck 无 error/warning；不以自动修复掩盖候选差异
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
- Replay 日常改动由 Changed gate 直接编译并测试 owner package；contracts / engine / accounting / data-adapter 改动同时运行 runner consumer。runner 的普通 package 层精确排除 worker-v10，后者只由 exclusive semantic gate 执行。
- Replay 核心语义改动：运行 `bun run check:replay-semantic`；release evidence、compatibility 或发布候选改动再运行 `bun run check:replay-release`。
- Changed gate 遇到共享 contract、脚本/CI/质量基础设施、机器架构 manifest、无 owner 文件或跨语言改动时 fail closed，并要求完整总闸。
- 提交前：跑 `scripts/quality-check.sh`
- 涉及真实 Binance 写接口：仍需显式 `--yes`；quality gate 不执行真实下单 / 撤单 / 调仓

## 4. 不伪装的缺口

当前仍未引入仓库级 formatter、Python lint，也未把函数复杂度硬编码成脱离领域语义的单一数字。ESLint 目前是非 type-aware 的零 warning 门；实测直接启用 typed recommended 会产生约 3,000 个既存错误，不能靠 baseline 或批量 disable 假装完成。typed lint 应按 owner 修清后再提升，而不是让一份可被候选修改的债务清单成为第二真相。

WebStorm 能读取仓库 ESLint config，但 `Project Default` 的全项目 inspection 不是仓库 gate：WebStorm 2026.1.4 实测把 ignored `.cache`、本地 Python 环境和生成物一起扫描，产生 23,555 项结果，且 SARIF 导出因缺失位置字段失败。这些结果同时混入拼写、插件与本机 profile，不能与代码错误共用 hard gate。IDE 的 ESLint diagnostics 必须与 `bun run lint` 同源；最接近其他 JetBrains inspection 的 Qodana JavaScript 需要外部 Ultimate/Ultimate Plus license 与 `QODANA_TOKEN`，在 license、token owner 和固定 profile 确认前不引入第二套裁判。

Replay release evidence 对若干源码文件绑定字节哈希。为避免候选通过重写 receipt 自证，ESLint 对这些文件保留最小、精确路径例外：3 个文件关闭 `no-useless-assignment`，2 个文件关闭 `preserve-caught-error`；`replay-trial-runner.test.ts` 只允许既有 `registryResolutionCount` 与 `_` 前缀绑定未使用，不关闭整条规则。另有 4 个明确从 `finally` fail closed 的文件关闭 `no-unsafe-finally`。新增例外必须有 owner 语义或源码身份证据，不得新增目录级 ignore 或 baseline。

GitHub Actions 在 pull request 与 `main` push 上调用同一编排器的独立 scope，并把事件 base commit 传给 policy 检查精确候选范围。`copilot-setup-steps.yml` 只配置 Copilot coding agent 的工具环境，不参与普通 Actions 加速或合并裁决。workflow 成功是否阻止合并仍由 GitHub repository ruleset / branch protection 决定；当前仓库外规则若只要求 `quality` 且不要求独立审批，候选仍可在同一 PR 修改 workflow 或裁判，仓库内代码不能消除该信任缺口。

同一仓库同一时刻只允许一个 `quality-check.sh` 实例。第二个实例必须快速失败并报告持锁 PID；异常退出遗留的死锁可在确认 owner PID 不存活后自动回收，禁止多个全量 Replay 测试争抢 CPU 后把资源竞争误判为代码慢。

本地总闸只缓存 Replay semantic 层，cache key 绑定 runner 的直接语义输入：Replay contracts / engine / accounting / data-adapter、Control Plane contracts、runtime-core、测试/锁脚本、根依赖锁、Bun 版本、平台与精确命令。compatibility、agent-role 或无关模块文本变化不再误触发 worker-v10；任一真实输入变化都会 miss。CI 从不复用本地收据；需要本机强制重跑时使用：

```bash
QUALITY_FRESH=1 scripts/quality-check.sh
```

该缓存只减少确定性重放，不改变直接 package 验收、Replay certification、发布证据或 authority。

Replay certification 对 fixture、manifest、Result / Artifact authority 继续使用内容寻址。普通文件排版和等价 import 路径不单独充当语义证据；但发布裁判及其 golden 测试必须绑定源码 hash，Harness identity 继续绑定实际可执行源码集合，防止裁判或执行实现变化后旧收据仍被接受。
