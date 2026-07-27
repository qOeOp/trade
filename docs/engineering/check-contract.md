---
title: Check Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-27 CST
---

# Check Contract

## 0. 定位

本文回答：改了哪里，最少跑什么。

它记录本地与 CI 共用的可执行检查入口，不新增第二套 build system。缺入口的地方先写明缺口，不伪装成已自动化。

## 1. 通用规则

- 所有改动最后检查完整 diff、运行 `git diff --no-renames --check HEAD`，并确认验收没有产生非预期 workspace side effect
- 经 PR 交付：按本合同的“改动域到最小检查”直接运行受影响 owner 检查与真实 consumer journey；不默认运行 `changed-quality` 或本地 `project-quality`
- CI 失败：只本地复现失败的 owner / leaf；修复后由当前 exact head 的 required `quality` 与四语言 CodeQL 重新完成全仓 merge closure，不自动追加本地总闸
- 不经 PR 的交付：按影响面选择可在本地闭合结果的 terminal gate；CI 仍不能替代 live / runtime / consumer acceptance
- 涉及 TS tool：需要直接验 owner 时用根 `bun scripts/check-package-tests.ts --run-package <owner-dir>` 或下表对应 owner check。package 内 `bun run check` 只作开发便利，不是项目验收 authority
- 涉及真实 Binance 写接口：默认只跑单测 / dry-run / preview；真实 live 或 test endpoint 必须用户明确授权
- 涉及 schema：同时跑 registry / schema 相关测试，再跑 owner tool 全量 check
- 涉及 docs-only：不要求代码测试，但必须确保相对链接可达、当前态路径真实存在、历史计划有明确状态，且没有把未实现结构写成已完成事实
- 涉及模块路径、顶层域、job、store 或 rail：即使只改文档，也要跑 `architecture-manifest-check` 与 `bun scripts/architecture-drift-audit.ts --check`

## 2. 当前入口

| Check id | 目录 | 命令 | 覆盖 |
| --- | --- | --- | --- |
| `repo-whitespace` | repo root | 本地 `git diff --no-renames --check HEAD`；CI `git diff --no-renames --check <base>...HEAD` | 本地覆盖 staged + unstaged，CI 覆盖精确候选范围；关闭 rename detection，避免重命名隐藏空白错误 |
| `project-quality` | repo root | `scripts/quality-check.sh [all\|policy\|typescript\|replay\|native]` | CI scope 与可选的本地全仓诊断 / 非 PR terminal gate；不安装依赖，也不是 PR commit / push 前置门。PR 并发执行 policy、两个 TS shard、Replay semantic、native，稳定 `quality` job 汇总 |
| `changed-quality` | repo root | `bun scripts/quality-check-changed.ts --path <repo-relative-path>` | 可选的 docs-only / 单模块便利入口：全局 hygiene、secret、doc 与受影响 package；只接受它能安全归属的 diff，拒绝共享 contract、脚本/CI、机器 manifest 或跨语言范围不等于要求 PR 本地跑总闸 |
| `typescript-lint` | repo root | `bun run lint` | ESLint flat recommended 覆盖 `modules/`、`scripts/`，warning 上限 0，unused disable hard fail；changed code gate 与 policy scope 共用 |
| `shell-lint` | repo root | `bun run lint:shell` | ShellCheck warning/error hard fail；仅排除兼容 `CDPATH= cd` 写法的 `SC1007` |
| `workspace-hygiene` | repo root | `bun scripts/check-workspace-hygiene.ts` | 禁止新增 tracked runtime SQLite / sidecar 与 module-local DB；历史 exception 只减不增 |
| `workspace-side-effect` | repo root | `bun scripts/check-workspace-side-effects.ts --action capture/check --snapshot tmp/check/<name>.json` | 对 tracked + unignored 内容做前后哈希；允许进入检查前已有改动，拒绝本轮新增、删除或改写；CI preflight 额外要求 clean checkout |
| `workspace-footprint` | repo root | `bun scripts/audit-workspace-footprint.ts --stale-days 14` | 只读分类 durable DB/data、受保护 evidence、test residue、build/dependency cache 与 external audit clone；不执行删除 |
| `test-source-boundary` | repo root | `bun scripts/check-test-source-boundaries.ts` | 生产源码不得导入 `bun:test` / `node:test` / Vitest / Jest，也不得依赖 `test-support`；不以文件行数代理设计质量 |
| `replay-runner-fast` | `modules/research-strategy-development/replay-execution-plane/runner` | `bun run check` | typecheck + 非 worker-v10 runner 回归；供日常 owner/consumer 验证 |
| `replay-runner-worker-v10` | `modules/research-strategy-development/replay-execution-plane/runner` | `bun run test:worker-v10` | 单实例运行深证据链集成测试，并输出阶段耗时 |
| `replay-runner-remaining` | `modules/research-strategy-development/replay-execution-plane/runner` | `bun run test:remaining` | 不与巨型 worker-v10 场景混跑的其余 runner 回归 |
| `replay-semantic` | repo root | `bun run check:replay-semantic` | worker-v10 核心确定性、authority、resume、Artifact 与切换语义；不运行 release closure |
| `replay-release` | repo root | `bun run check:replay-release` | maturity evidence closure + Plane 全部 canonical/compatibility package certification；runner certification 必须包含 worker-v10 semantic，独立审计绑定裁判与 golden 测试源码 |
| `replay-certification` | `modules/research-strategy-development/replay-execution-plane/certification/replay-certification` | `bun run certify` | Plane 内全部 canonical/compatibility package 的唯一、顺序、fail-fast certification 入口 |
| `quality-judge-regression` | repo root | `bun test ./scripts/*.test.ts` | 用恶意反例证明架构、evidence、测试完整性审查 fail closed |
| `development-convergence` | repo root | `bun scripts/check-convergence-budget.ts` | 恢复期冻结 module owner、registered tool、domain、store、job、rail 表面积；超出基线 hard fail |
| `package-test-integrity` | repo root | `bun scripts/check-package-tests.ts --run-all` 或 `--run-shard <index>/<count>` | 从文件系统发现生产 TS package，直接执行根 compiler 与全部 colocated 测试，不读取 package scripts；排序后确定性分片完整且互斥；Replay worker-v10 只由 semantic gate 独占执行一次 |
| `codeql` | GitHub Actions | `.github/workflows/codeql.yml` | JavaScript/TypeScript、Python、Go、Rust 的独立默认高精度查询扫描；结果进入 GitHub code scanning，不替代 correctness gate |
| `pr-lifecycle-gate` | GitHub Actions + ruleset | `bun scripts/pr-lifecycle.ts dispatch --repo <owner/repo> --pr <number> --claim <tag-sha> --capability <private-value>` | default branch workflow 只唤醒同一个无状态 verifier；writer 由原子 claim ref 与不公开 capability 选定，verifier 从 GitHub 原生 exact-head trigger、不可变 result seal、thread disposition 与 live base 重建收据，并向当前 head 写唯一 required status；现有 quality、CodeQL 和 thread-resolution rules 仍独立执行 |
| `replay-release-schedule` | GitHub Actions | `.github/workflows/replay-certification.yml` | nightly/manual 执行 release evidence closure；不阻塞每个 PR 的快速 semantic gate |
| `ts-architecture-boundary` | repo root | `bun scripts/check-ts-tool-boundaries.ts` | 静态 package 边界、module-local lockfile、禁止动态逃逸 / eval、跨 package dependency cycle |
| `secret-scan` | repo root | `bun scripts/check-secrets.ts` | tracked / unignored provider token、非空 SiliconFlow assignment 与 literal bearer credential |
| `doc-contract-check` | repo root | `bun scripts/check-doc-contracts.ts` | docs 根目录与 owner 目录、文档元数据、current index、ID/implementation ref、仓库 Markdown 本地链接边界、历史状态及 risk Guard ID 对齐 |
| `workspace-skill-check` | repo root | `sh scripts/check-workspace-skills.sh` | project-local skill 命名、frontmatter、placeholder 与领域实现边界 |
| `architecture-manifest-check` | repo root | `bun scripts/check-architecture-manifest.ts` | 顶层域 / job / store / rail 与真实目录、DDL、protocol schema 对齐；module marker 必须有 CONTRACT，TypeScript module 必须有 tsconfig/package |
| `storage-schema-check` | repo root | `bun scripts/check-storage-schemas.ts` | logical store DDL 可执行，且 manifest 声明表真实创建 |
| `trade-flow-typecheck` | `modules/orchestration-ops/trade-flow` | `bun run typecheck` | TS 类型与未使用变量 |
| `trade-flow-test` | `modules/orchestration-ops/trade-flow` | `bun run test` | 当前全部 trade-flow 单测 / 契约测 |
| `trade-flow-check` | `modules/orchestration-ops/trade-flow` | `bun run check` | typecheck + test |
| `runtime-policy-compiler-check` | `modules/policy-risk/runtime-policy-compiler` | `bun run check` | trading config normalize / clamp / hash |
| `observe-builder-check` | `modules/live-decision-planning/observe-builder` | `bun run check` | supplied projections -> observe event body |
| `observe-runner-check` | `modules/live-decision-planning/observe-runner` | `bun run check` | account/symbol read tool projection runner |
| `execution-flow-runner-check` | `modules/live-execution-control/execution-flow-runner` | `bun run check` | dry-run / shadow execution flow、skip observe、idempotency gate |
| `execution-router-check` | `modules/live-execution-control/execution-router` | `bun run check` | target_action -> Binance write-tool command spec |
| `execution-recorder-check` | `modules/live-execution-control/execution-recorder` | `bun run check` | execution result -> audited order_fill event draft |
| `live-small-runner-check` | `modules/live-execution-control/live-small-runner` | `bun run check` | explicit live-small exchange write runner |
| `reconcile-drafts-check` | `modules/live-execution-control/reconcile-drafts` | `bun run check` | local flow + account snapshot -> reconcile drafts |
| `recovery-runner-check` | `modules/live-execution-control/recovery-runner` | `bun run check` | account snapshot read -> reconcile -> optional local apply / needs_review |
| `legacy-research-contracts-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts` | `bun run check` | legacy Signal、Trade、Strategy、Options、Result compile-time shapes |
| `legacy-research-data-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data` | `bun run check` | legacy Candle、manifest/CSV loading and funding range helpers |
| `legacy-research-decision-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision` | `bun run check` | legacy prefix-only decision input、latest diagnostic and lookahead detection |
| `legacy-research-evaluation-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-evaluation` | `bun run check` | legacy trade summary、diagnostics、anti-overfit、robustness and candidate gate |
| `legacy-research-features-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-features` | `bun run check` | legacy EMA、ATR and fixed indicator-set semantics |
| `legacy-research-order-lane-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-order-lane` | `bun run check` | standalone legacy OHLCV lane simulation、stop-first and reduce-only cap |
| `legacy-research-provenance-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-provenance` | `bun run check` | legacy identity binding、closed-candle temporal and supplemental report-time projection |
| `legacy-research-strategy-fixture-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-strategy-fixture` | `bun run check` | frozen single-strategy legacy Replay certification fixture |
| `legacy-portfolio-cycle-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle` | `bun run check` | P10/P11/P13 historical portfolio cycle execution/readback compatibility |
| `legacy-portfolio-cycle-certification-check` | `modules/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification` | `bun run check` | P10/P11 Result/Artifact 与 P13 consolidated accounting certification |
| `legacy-replay-identity-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity` | `bun run check` | legacy canonical/file/data/harness identity compatibility |
| `legacy-research-kernel-check` | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel` | `bun run check` | legacy R&D execution、fill/trade facts and result-shell compatibility |
| `legacy-replay-fingerprint-certification-check` | `modules/research-strategy-development/replay-execution-plane/certification/legacy-replay-fingerprint` | `bun run check` | legacy Replay evidence fingerprint parity certification |
| `data-split-check` | `modules/research-strategy-development/research-control-plane/dataset-governance/data-split` | `bun run check` | discovery / validation / locked holdout split |
| `signal-evaluator-check` | `modules/research-strategy-development/agent-roles/reviewer/signal-evaluator` | `bun run check` | latest closed-candle / post-freeze diagnostic signal |
| `candidate-batch-check` | `modules/research-strategy-development/agent-roles/developer/candidate-batch` | `bun run check` | single-dataset / panel candidate evaluation CLI |
| `candidate-batch-engine-check` | `modules/research-strategy-development/agent-roles/developer/candidate-batch-engine` | `bun run check` | candidate/panel evaluation internal engine and reports |
| `strategy-family-engine-check` | `modules/research-strategy-development/agent-roles/developer/strategy-family-engine` | `bun run check` | family registry、factor transforms/research and feature-store reads |
| `candidate-batch-integration` | `modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite` | `bun test ./src/lib/strategy-rnd.test.ts ./src/lib/strategy-rnd-inputs.test.ts` | candidate batch parser/evaluation integration coverage |
| `replay-benchmark-check` | `modules/research-strategy-development/replay-execution-plane/benchmark` | `bun run check` | fixed benchmark / calibration calculation semantics |
| `calibration-suite-check` | `modules/research-strategy-development/replay-execution-plane/certification/calibration-suite` | `bun run check` | canonical runtime calibration / legacy benchmark-mode CLI |
| `funding-governance-check` | `modules/research-strategy-development/research-control-plane/dataset-governance/funding-governance` | `bun run check` | funding coverage governance |
| `strategy-contract-compile-check` | `modules/research-strategy-development/agent-roles/developer/strategy-contract-compile` | `bun run check` | strategy contract compile CLI |
| `strategy-contract-lint-check` | `modules/research-strategy-development/research-control-plane/contract-lint` | `bun run check` | strategy contract lint CLI |
| `rd-program-state-smoke` | repo root | `bun modules/research-strategy-development/research-control-plane/program-control/src/scripts/main.ts --db ./tmp/check/rd_state.db --program-id smoke --json '{"action":"init","objective":"smoke"}'` | RD memory CLI envelope and research_state_store write path |
| `rd-supervisor-integration` | `modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite` | `bun test ./src/lib/rd-supervisor-runner.test.ts` | RD supervisor orchestration over loop/campaign runners |
| `rd-paper-tracker-check` | `modules/research-strategy-development/forward-evidence-plane/paper-tracker` | `bun run check` | J05 paper tracker、setup event chain、artifact/catalog publication |
| `rd-loop-runner-integration` | `modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite` | `bun test ./src/lib/strategy-rnd.test.ts ./src/lib/research-output-schemas.test.ts` | R&D loop artifact/catalog/ledger/state writeback |
| `rd-campaign-runner-integration` | `modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite` | `bun test ./src/lib/strategy-rnd-campaign.test.ts ./src/lib/strategy-rnd.test.ts ./src/lib/research-output-schemas.test.ts` | R&D campaign gates/orchestration/artifact writeback |
| `rd-integration-suite-check` | `modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite` | `bun run check` | Cross-module R&D integration regression |
| `rd-artifact-summary-check` | `modules/research-strategy-development/agent-roles/reviewer/rd-artifact-summary` | `bun run check` | R&D artifact summary helpers |
| `strategy-policy-check` | `modules/contracts/strategy-policy` | `bun run check` | strategy markdown frontmatter / policy loader contract |
| `strategy-review-check` | `modules/governance-review-compliance/strategy-review` | `bun run check` | evidence / review / promotion |
| `artifact-catalog-check` | `modules/artifact-knowledge/artifact-catalog` | `bun run check` | catalog / artifact GC / feature refs |
| `plan-preflight-check` | `modules/live-execution-control/plan-preflight` | `bun run check` | hard guards / decision card |
| `binance-ts-check` | changed Binance TS tool | `bun run check` | 对应执行或只读 tool 的本地契约 |
| `ohlcv-fetch-check` | `modules/market-data-products/ohlcv-fetch` | `bun run check` | OHLCV manifest / fetch 本地契约 |
| `tech-indicators-check` | `modules/market-data-products/tech-indicators` | `go test ./...` | 指标与结构算法 |
| `l2-order-book-core-check` | `modules/market-data-products/l2-order-book-core` | `cargo fmt --all -- --check && cargo check && cargo clippy --all-targets -- -D warnings && cargo test` | deterministic order-book/sequence projection and TL2S segment core |
| `l2-order-book-service-check` | `modules/market-data-products/l2-order-book-service` | `cargo fmt --all -- --check && cargo check && cargo clippy --all-targets -- -D warnings && cargo test` | public L2 lifecycle、epoch/queue/state、raw segments and loopback gRPC reads |
| `l2-order-book-compactor-check` | `modules/market-data-products/l2-order-book-compactor` | `cargo fmt --all -- --check && cargo check && cargo clippy --all-targets -- -D warnings && cargo test` | admitted complete TL2S epoch 的确定性 Parquet proposal 与 bounded read |
| `l2-recorder-bakeoff-check` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run check && go test ./... && go vet ./... && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test` | Bun / Go / Rust L2 fixture parity、gap fail-closed 与跨语言质量 |
| `l2-public-fixture-capture` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run capture -- --yes-public-network --symbol BTCUSDT --events 200 --output tmp/l2-recorder-bakeoff/live-btcusdt.json` | routed public stream + REST snapshot；无 credential、只写 ignored fixture |
| `l2-recorder-bakeoff-run` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run benchmark -- --iterations 50000 --samples 7` | ignored `tmp/` 证据、内部耗时、wall time 与 RSS；不联网、不决定 ADR |
| `l2-segment-bakeoff-run` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run segment-benchmark -- --fixture <ignored-fixture> --samples 7` | raw segment byte parity、fsync/finalize、truncate salvage、checksum corruption 与 RSS |
| `l2-segment-crash-injection` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run crash-injection -- --fixture <ignored-fixture> --output tmp/l2-recorder-bakeoff/crash-evidence.json` | 只 SIGKILL 本轮 Bun / Go / Rust writer 子进程；3×3 recovery parity 与 salvaged-prefix 完整复验 |
| `l2-rust-public-soak` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run soak:rust -- --yes-public-network --symbol BTCUSDT --duration-seconds <bounded-seconds> --output-base ../../../tmp/l2-recorder-bakeoff/soak-rust` | 公共 stream + snapshot；bounded queue/book、epoch resync、TL2S rotation；不读 credential，不接交易接口 |
| `l2-rust-soak-supervisor` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run soak:supervisor -- --yes-public-network --symbol BTCUSDT --cycles 3 --output tmp/l2-recorder-bakeoff/soak-supervisor-evidence.json` | 只管理本轮 Rust 子进程；重复 SIGKILL、3×3 salvage、restart/resync 与 PID-scoped RSS/CPU 证据 |
| `l2-rust-natural-soak` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run soak:natural -- --yes-public-network --symbol BTCUSDT --duration-seconds 3600 --output tmp/l2-recorder-bakeoff/natural-soak-evidence.json` | 不注入断线；精确 PID 资源曲线、worker verdict 与所有 finalized TL2S 完整复验；不足一小时只能标记 `ineligible` |
| `l2-rust-natural-soak-launch` | `modules/market-data-products/l2-recorder-bakeoff` | `bun run soak:natural:launch -- --yes-public-network --symbol BTCUSDT --duration-seconds 3600 --output tmp/l2-recorder-bakeoff/natural-soak-evidence.json` | 独立 process group + ignored receipt/log；跨 Codex 回合持续，实际验收仍由 `l2-rust-natural-soak` 负责 |
| `helper-scripts-smoke` | repo root | `sh scripts/resolve-codex-home.sh && sh scripts/automation-memory-path.sh demo && sh scripts/resolve-python.sh` | 本地 helper fallback 可用性 |

## 3. 改动域到最小检查

| 改动域 | 触发文件 | 最小检查 |
| --- | --- | --- |
| docs contract | `README.md`, `modules/README.md`, `docs/**/*.md`, `modules/**/CONTRACT.md` | `doc-contract-check` + `repo-whitespace`；若涉及架构当前态，再跑 `architecture-manifest-check` + drift `--check` |
| trade-flow CLI 参数 / help / router | `src/scripts/main.ts`, `src/scripts/commands/*` | `trade-flow-typecheck` + `bun test ./src/scripts/commands/*.test.ts ./src/scripts/main.test.ts` |
| command response envelope | `src/scripts/commands/response.ts`, `schemas/script-response.schema.json` | `trade-flow-typecheck` + `bun test ./src/scripts/commands/response.test.ts ./src/scripts/main.test.ts` |
| schema registry / data schema | `schemas/*.schema.json`, `schemas/registry.json` | `trade-flow-typecheck` + `bun test ./src/scripts/lib/*schema*.test.ts ./src/scripts/lib/schema-registry.test.ts` |
| portfolio event store / projector | `modules/portfolio-execution-state/event-store/src/**`, `modules/portfolio-execution-state/flow-projector/src/**` | `event-store-check` + `flow-projector-check` + `trade-flow-typecheck` + `bun test ./src/scripts/lib/plan-events-schema.test.ts ./src/scripts/lib/core-data-schemas.test.ts` |
| execution dry/shadow/live-small glue | `modules/live-execution-control/execution-flow-runner/src/**`, `modules/live-execution-control/live-small-runner/src/**`, `modules/live-execution-control/execution-router/src/**`, `modules/live-execution-control/execution-recorder/src/**`, `src/scripts/lib/live-execution.ts`, `src/scripts/commands/execution.ts` | `execution-flow-runner-check` + `live-small-runner-check` + `execution-router-check` + `execution-recorder-check` + `trade-flow-typecheck` + `bun test ./src/scripts/lib/execution-flow.test.ts ./src/scripts/lib/execution-command-spec-schema.test.ts ./src/scripts/main.test.ts` |
| recovery / reconcile | `modules/live-execution-control/reconcile-drafts/src/**`, `modules/live-execution-control/recovery-runner/src/**`, `src/scripts/commands/recovery.ts` | `reconcile-drafts-check` + `recovery-runner-check` + `trade-flow-typecheck` + `bun test ./src/scripts/lib/reconcile-schema.test.ts ./src/scripts/main.test.ts` |
| observe / runtime load | `src/scripts/lib/observe-*`, `src/scripts/commands/observe.ts`, `modules/live-decision-planning/observe-builder/src/**`, `modules/live-decision-planning/observe-runner/src/**` | `observe-builder-check` + `observe-runner-check` + `trade-flow-typecheck` + `bun test ./src/scripts/commands/handlers.test.ts ./src/scripts/lib/core-data-schemas.test.ts` |
| runtime policy compiler | `modules/policy-risk/runtime-policy-compiler/src/**` | `runtime-policy-compiler-check` + `trade-flow-check` |
| legacy research contracts | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts/src/**` | `legacy-research-contracts-check` + `legacy-research-kernel-check` + `legacy-replay-identity-check` + `candidate-batch-check` + `signal-evaluator-check` + `rd-integration-suite-check` |
| legacy research data | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data/src/**` | `legacy-research-data-check` + `legacy-research-kernel-check` + `legacy-replay-identity-check` + `candidate-batch-check` + `signal-evaluator-check` + `replay-benchmark-check` + `funding-governance-check` + `rd-paper-tracker-check` + `rd-integration-suite-check` |
| legacy research decision | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision/src/**` | `legacy-research-decision-check` + `legacy-research-kernel-check` + `legacy-replay-identity-check` + `candidate-batch-check` + `signal-evaluator-check` + `rd-integration-suite-check` |
| legacy research evaluation | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-evaluation/src/**` | `legacy-research-evaluation-check` + `legacy-research-kernel-check` + `legacy-replay-identity-check` + `candidate-batch-check` + `signal-evaluator-check` + `rd-integration-suite-check` |
| legacy research features | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-features/src/**` | `legacy-research-features-check` + `legacy-research-kernel-check` + `legacy-replay-identity-check` + `signal-evaluator-check` + `candidate-batch-check` + `rd-integration-suite-check` |
| legacy research order lane | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-order-lane/src/**` | `legacy-research-order-lane-check` + `legacy-research-kernel-check` + `legacy-replay-identity-check` + `legacy-replay-fingerprint-certification-check` + `rd-integration-suite-check` |
| legacy research provenance | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-provenance/src/**` | `legacy-research-provenance-check` + `legacy-research-kernel-check` + `legacy-replay-identity-check` + `legacy-replay-fingerprint-certification-check` + `signal-evaluator-check` + `candidate-batch-check` + `rd-integration-suite-check` |
| legacy research strategy fixture | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-strategy-fixture/src/**` | `legacy-research-strategy-fixture-check` + `legacy-research-kernel-check` + `legacy-replay-identity-check` + `legacy-replay-fingerprint-certification-check` + `rd-integration-suite-check` |
| legacy portfolio cycle | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle/src/**` | `legacy-portfolio-cycle-check` + `legacy-portfolio-cycle-certification-check` + replay `contracts` / `engine` / `accounting` / `runner` package checks + `architecture-manifest-check` + drift `--check`; canonical runner → compatibility 反向测试边禁止 |
| legacy portfolio cycle certification | `modules/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification/src/**` | `legacy-portfolio-cycle-certification-check` + `legacy-portfolio-cycle-check` + replay `contracts` / `runner` package checks + `architecture-manifest-check` + drift `--check` |
| legacy replay identity | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity/src/**` | `legacy-replay-identity-check` + `legacy-research-kernel-check` + `legacy-replay-fingerprint-certification-check` + `replay-benchmark-check` + `rd-integration-suite-check` |
| legacy research kernel | `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel/src/**` | `legacy-research-kernel-check` + `legacy-replay-identity-check` + `legacy-replay-fingerprint-certification-check`; add `candidate-batch-check`, `signal-evaluator-check`, `replay-benchmark-check`, `funding-governance-check`, `rd-paper-tracker-check` and `rd-integration-suite-check` if semantics changed |
| legacy replay fingerprint certification | `modules/research-strategy-development/replay-execution-plane/certification/legacy-replay-fingerprint/src/**` | `legacy-replay-fingerprint-certification-check` + `strategy-review-check` |
| research data split | `modules/research-strategy-development/research-control-plane/dataset-governance/data-split/src/**` | `data-split-check` |
| research signal / forward diagnostic | `modules/research-strategy-development/agent-roles/developer/signal-engine/src/**`, `modules/research-strategy-development/agent-roles/reviewer/signal-evaluator/src/**`, `modules/research-strategy-development/agent-roles/developer/strategy-family-engine/src/**` | `signal-evaluator-check` + `strategy-family-engine-check` + `rd-integration-suite-check`; add `legacy-replay-identity-check` + `legacy-replay-fingerprint-certification-check` when strategy-family/factor production source changes |
| research candidate / panel evaluation | `modules/research-strategy-development/agent-roles/developer/candidate-batch/src/**`, `modules/research-strategy-development/agent-roles/developer/candidate-batch-engine/src/**` | `candidate-batch-check` + `candidate-batch-engine-check` + `candidate-batch-integration` + `rd-integration-suite-check`; add `legacy-replay-identity-check` + `legacy-replay-fingerprint-certification-check` when candidate engine production source changes |
| research benchmark / calibration | `modules/research-strategy-development/replay-execution-plane/benchmark/src/**`, `modules/research-strategy-development/replay-execution-plane/certification/calibration-suite/src/**` | `replay-benchmark-check` + `calibration-suite-check`; add `funding-governance-check` if shared funding coverage semantics change |
| research funding governance | `modules/research-strategy-development/research-control-plane/dataset-governance/funding-governance/src/**` | `funding-governance-check` |
| strategy contract compile/lint | `modules/contracts/strategy-contract/src/**`, `modules/research-strategy-development/research-control-plane/contract-lint/src/**`, `modules/research-strategy-development/agent-roles/developer/strategy-contract-compile/src/**` | `strategy-contract-compile-check` + `strategy-contract-lint-check` + `rd-integration-suite-check` if RD consumes compiled candidates |
| strategy policy loader | `modules/contracts/strategy-policy/src/**` | `strategy-policy-check` + `strategy-review-check` + `trade-flow-check` if consumed paths changed |
| research RD memory | `modules/research-strategy-development/research-control-plane/program-control/src/**` | `rd-program-state-smoke` + `rd-integration-suite-check` while supervisor/loop still consume the shared state implementation |
| research RD supervisor | `modules/research-strategy-development/research-control-plane/program-supervisor/src/**` | `rd-supervisor-integration` + `rd-integration-suite-check` while supervisor consumes loop/campaign runners |
| research paper tracker | `modules/research-strategy-development/forward-evidence-plane/paper-tracker/src/**` | `rd-paper-tracker-check` + `trade-flow-check` if J05 job contract changes |
| research RD loop | `modules/research-strategy-development/agent-roles/developer/rd-loop-runner/src/**` | `rd-loop-runner-integration` + `rd-integration-suite-check` while campaign consumes loop runner |
| research RD campaign | `modules/research-strategy-development/agent-roles/developer/rd-campaign-runner/src/**` | `rd-campaign-runner-integration` + `rd-integration-suite-check` |
| research RD ledger | `modules/research-strategy-development/research-control-plane/experiment-ledger/src/**` | `rd-integration-suite-check` |
| research integration tests | `modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite/src/**` | `rd-integration-suite-check` |
| research R&D artifact summary | `modules/research-strategy-development/agent-roles/reviewer/rd-artifact-summary/src/**` | `rd-artifact-summary-check` |
| strategy evidence / review / promotion | `modules/governance-review-compliance/strategy-review/src/**` | `strategy-review-check` |
| artifact hygiene / catalog | `modules/artifact-knowledge/artifact-catalog/src/**` | `artifact-catalog-check` |
| cron slow/fast track | `modules/live-decision-planning/slow-track-plan/src/**`, `modules/live-execution-control/fast-track-guard/src/**`, `src/scripts/lib/track-runner.ts`, `src/scripts/lib/cron-runtime.ts` | `slow-track-plan-check` + `fast-track-guard-check` + `trade-flow-typecheck` + `bun test ./src/scripts/lib/cron-runtime.test.ts ./src/scripts/lib/track-dry-run-schema.test.ts` |
| preflight hard guard | `modules/live-execution-control/plan-preflight/**` | `plan-preflight-check` + trade-flow execution/recovery targeted tests if guard output shape changed |
| Binance execute tool | `modules/exchange-gateway/binance-write/*` | corresponding `binance-ts-check` + trade-flow execution targeted tests；输出边界见 [execution-tool-contract.md](../runtime/execution-tool-contract.md) |
| market / account read tool | `modules/market-data-products/binance-read/*`, `modules/exchange-gateway/binance-read/account-snapshot` | corresponding `binance-ts-check` + observe/recovery targeted tests if consumed by trade-flow |
| OHLCV / indicators | `modules/market-data-products/ohlcv-fetch`, `modules/market-data-products/tech-indicators` | corresponding tool check + trade-flow research targeted tests if manifest/factor shape changed |
| L2 order-book / TL2S core | `modules/market-data-products/l2-order-book-core/**` | `l2-order-book-core-check` + `l2-recorder-bakeoff-check` |
| L2 public order-book service | `modules/market-data-products/l2-order-book-service/**` | `l2-order-book-service-check` + `l2-order-book-core-check`; add `l2-recorder-bakeoff-check` when projection、sequence or TL2S semantics change |
| L2 language bake-off | `modules/market-data-products/l2-recorder-bakeoff/**`, `scripts/check-secrets.ts`, Rust quality gate | `l2-recorder-bakeoff-check` + `secret-scan` + `repo-whitespace`；需要语言决策证据时再跑 `l2-recorder-bakeoff-run` |
| local helper scripts | `scripts/*.sh`, README helper 入口 | `helper-scripts-smoke` + `repo-whitespace` |
| workspace skill | `.agents/skills/**` | `workspace-skill-check` + `repo-whitespace`；若新增领域能力，必须移入 owner module 并升级为对应 module check |

## 4. 何时使用全量

必须跑 `trade-flow-check`：

- 修改 `src/scripts/main.ts`
- 修改 `src/scripts/commands/*`
- 修改 `schemas/registry.json`
- 修改 `plan_event`、recovery、execution 任一 trade-flow 公共类型
- 新增 command、schema、strategy family、evidence record 或 promotion gate
- targeted test 失败后修复完成

经 PR 交付不因准备 commit / push、跨语言、脚本/CI、共享 contract 或质量基础设施改动自动升级为本地 `project-quality`；逐项运行受影响 owner / consumer 检查，远端 required checks 负责全仓闭包。只有不经 PR 且结果需要本地全仓终结、用户明确要求，或定位无法缩小到单个 owner / leaf 的全仓问题时，才把 `project-quality` 作为本地 terminal / 诊断入口。

必须额外跑相关 tool 的 `bun run check`：

- trade-flow 调用的外部 tool CLI 参数变化
- 外部 tool 输出被 trade-flow 解析
- `plan-preflight` verdict / blocked shape / decision card 变化
- research / review / catalog owner 模块内部契约变化

## 5. 明确不自动跑

- Binance 真实下单、撤单、调仓、保护腿写接口
- Binance test endpoint smoke
- 长窗口 OHLCV 下载
- 大规模 R&D campaign

这些都需要单独授权和独立运行记录。
