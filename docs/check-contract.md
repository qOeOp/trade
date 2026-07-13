# Check Contract

## 0. 定位

本文回答：改了哪里，最少跑什么。

它不是 CI 设计，不新增 build system；只记录当前仓库可执行的检查入口。缺入口的地方先写明缺口，不伪装成已自动化。

## 1. 通用规则

- 所有改动最后跑：`git diff --check`
- 涉及 TS tool：在对应 tool 目录跑 `bun run check`
- 涉及真实 Binance 写接口：默认只跑单测 / dry-run / preview；真实 live 或 test endpoint 必须用户明确授权
- 涉及 schema：同时跑 registry / schema 相关测试，再跑 owner tool 全量 check
- 涉及 docs-only：不要求代码测试，但必须确保没有把未实现结构写成已完成事实

## 2. 当前入口

| Check id | 目录 | 命令 | 覆盖 |
| --- | --- | --- | --- |
| `repo-whitespace` | repo root | `git diff --check` | 空白、冲突标记、尾随空格 |
| `project-quality` | repo root | `scripts/quality-check.sh` | 提交前 TS / Go / Python / shell / hygiene 总闸 |
| `architecture-manifest-check` | repo root | `bun scripts/check-architecture-manifest.ts` | 顶层域 / job / store / rail 与真实目录、DDL、protocol schema 对齐 |
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
| `replay-runner-check` | `modules/research-strategy-development/replay-runner` | `bun run check` | 单策略机械 replay |
| `data-split-check` | `modules/research-strategy-development/data-split` | `bun run check` | discovery / validation / locked holdout split |
| `signal-evaluator-check` | `modules/research-strategy-development/signal-evaluator` | `bun run check` | latest closed-candle signal |
| `panel-evaluator-check` | `modules/research-strategy-development/panel-evaluator` | `bun run check` | multi-asset panel evaluation |
| `candidate-batch-integration` | `modules/research-strategy-development/rd-integration-suite` | `bun test ./src/lib/strategy-rnd.test.ts ./src/lib/strategy-rnd-inputs.test.ts` | candidate batch parser/evaluation integration coverage |
| `benchmark-runner-check` | `modules/research-strategy-development/benchmark-runner` | `bun run check` | fixed benchmark / benchmark engine |
| `calibration-suite-check` | `modules/research-strategy-development/calibration-suite` | `bun run check` | calibration suite CLI |
| `funding-governance-check` | `modules/research-strategy-development/funding-governance` | `bun run check` | funding coverage governance |
| `strategy-contract-compile-check` | `modules/research-strategy-development/strategy-contract-compile` | `bun run check` | strategy contract compile CLI |
| `strategy-contract-lint-check` | `modules/research-strategy-development/strategy-contract-lint` | `bun run check` | strategy contract lint CLI |
| `rd-program-state-smoke` | repo root | `bun modules/research-strategy-development/rd-program-state/src/scripts/main.ts --state ./tmp/check/rd-program-state.json --json '{"action":"init","objective":"smoke"}'` | RD memory CLI envelope and write path |
| `rd-supervisor-integration` | `modules/research-strategy-development/rd-integration-suite` | `bun test ./src/lib/rd-supervisor-runner.test.ts` | RD supervisor orchestration over loop/campaign runners |
| `rd-shadow-tracker-integration` | `modules/research-strategy-development/rd-integration-suite` | `bun test ./src/lib/rd-shadow-tracker.test.ts ./src/lib/setup-event-chain.test.ts` | R&D paper tracker and setup event chain |
| `rd-loop-runner-integration` | `modules/research-strategy-development/rd-integration-suite` | `bun test ./src/lib/strategy-rnd.test.ts ./src/lib/research-output-schemas.test.ts` | R&D loop artifact/catalog/ledger/state writeback |
| `rd-campaign-runner-integration` | `modules/research-strategy-development/rd-integration-suite` | `bun test ./src/lib/strategy-rnd-campaign.test.ts ./src/lib/strategy-rnd.test.ts ./src/lib/research-output-schemas.test.ts` | R&D campaign gates/orchestration/artifact writeback |
| `rd-integration-suite-check` | `modules/research-strategy-development/rd-integration-suite` | `bun run check` | Cross-module R&D integration regression |
| `rd-artifact-summary-check` | `modules/research-strategy-development/rd-artifact-summary` | `bun run check` | R&D artifact summary helpers |
| `strategy-policy-check` | `modules/contracts/strategy-policy` | `bun run check` | strategy markdown frontmatter / policy loader contract |
| `strategy-review-check` | `modules/governance-review-compliance/strategy-review` | `bun run check` | evidence / review / promotion |
| `artifact-catalog-check` | `modules/artifact-knowledge/artifact-catalog` | `bun run check` | catalog / artifact GC / feature refs |
| `plan-preflight-check` | `modules/live-execution-control/plan-preflight` | `bun run check` | hard guards / decision card |
| `binance-ts-check` | changed Binance TS tool | `bun run check` | 对应执行或只读 tool 的本地契约 |
| `ohlcv-fetch-check` | `modules/market-data-products/ohlcv-fetch` | `bun run check` | OHLCV manifest / fetch 本地契约 |
| `tech-indicators-check` | `modules/market-data-products/tech-indicators` | `go test ./...` | 指标与结构算法 |
| `helper-scripts-smoke` | repo root | `sh scripts/resolve-codex-home.sh && sh scripts/automation-memory-path.sh demo && sh scripts/resolve-python.sh` | 本地 helper fallback 可用性 |

## 3. 改动域到最小检查

| 改动域 | 触发文件 | 最小检查 |
| --- | --- | --- |
| docs contract | `docs/*.md` | `repo-whitespace` |
| trade-flow CLI 参数 / help / router | `src/scripts/main.ts`, `src/scripts/commands/*` | `trade-flow-typecheck` + `bun test ./src/scripts/commands/*.test.ts ./src/scripts/main.test.ts` |
| command response envelope | `src/scripts/commands/response.ts`, `schemas/script-response.schema.json` | `trade-flow-typecheck` + `bun test ./src/scripts/commands/response.test.ts ./src/scripts/main.test.ts` |
| schema registry / data schema | `schemas/*.schema.json`, `schemas/registry.json` | `trade-flow-typecheck` + `bun test ./src/scripts/lib/*schema*.test.ts ./src/scripts/lib/schema-registry.test.ts` |
| portfolio event store / projector | `modules/portfolio-execution-state/event-store/src/**`, `modules/portfolio-execution-state/flow-projector/src/**` | `event-store-check` + `flow-projector-check` + `trade-flow-typecheck` + `bun test ./src/scripts/lib/plan-events-schema.test.ts ./src/scripts/lib/core-data-schemas.test.ts` |
| execution dry/shadow/live-small glue | `modules/live-execution-control/execution-flow-runner/src/**`, `modules/live-execution-control/live-small-runner/src/**`, `modules/live-execution-control/execution-router/src/**`, `modules/live-execution-control/execution-recorder/src/**`, `src/scripts/lib/live-execution.ts`, `src/scripts/commands/execution.ts` | `execution-flow-runner-check` + `live-small-runner-check` + `execution-router-check` + `execution-recorder-check` + `trade-flow-typecheck` + `bun test ./src/scripts/lib/execution-flow.test.ts ./src/scripts/lib/execution-command-spec-schema.test.ts ./src/scripts/main.test.ts` |
| recovery / reconcile | `modules/live-execution-control/reconcile-drafts/src/**`, `modules/live-execution-control/recovery-runner/src/**`, `src/scripts/commands/recovery.ts` | `reconcile-drafts-check` + `recovery-runner-check` + `trade-flow-typecheck` + `bun test ./src/scripts/lib/reconcile-schema.test.ts ./src/scripts/main.test.ts` |
| observe / runtime load | `src/scripts/lib/observe-*`, `src/scripts/commands/observe.ts`, `modules/live-decision-planning/observe-builder/src/**`, `modules/live-decision-planning/observe-runner/src/**` | `observe-builder-check` + `observe-runner-check` + `trade-flow-typecheck` + `bun test ./src/scripts/commands/handlers.test.ts ./src/scripts/lib/core-data-schemas.test.ts` |
| runtime policy compiler | `modules/policy-risk/runtime-policy-compiler/src/**` | `runtime-policy-compiler-check` + `trade-flow-check` |
| research replay runner | `modules/research-strategy-development/replay-runner/src/**`, `modules/research-strategy-development/replay-engine/src/**` | `replay-runner-check` + `rd-integration-suite-check` if shared replay semantics changed |
| research data split | `modules/research-strategy-development/data-split/src/**` | `data-split-check` |
| research signal | `modules/research-strategy-development/signal-engine/src/**`, `modules/research-strategy-development/signal-evaluator/src/**`, `modules/research-strategy-development/strategy-family-engine/src/**` | `signal-evaluator-check` + `rd-integration-suite-check` if forward holdout or candidate family semantics changed |
| research candidate batch | `modules/research-strategy-development/candidate-batch/src/**`, `modules/research-strategy-development/candidate-batch-engine/src/**` | `candidate-batch-integration` + `rd-integration-suite-check` while loop/campaign runners consume batch engine |
| research panel | `modules/research-strategy-development/panel-evaluator/src/**`, `modules/research-strategy-development/candidate-batch-engine/src/**` | `panel-evaluator-check` + `rd-integration-suite-check` if shared candidate batch semantics changed |
| research benchmark / calibration | `modules/research-strategy-development/benchmark-engine/src/**`, `modules/research-strategy-development/benchmark-runner/src/**`, `modules/research-strategy-development/calibration-suite/src/**` | `benchmark-runner-check` + `calibration-suite-check` + `rd-integration-suite-check` if funding governance consumes benchmark data helpers |
| research funding governance | `modules/research-strategy-development/funding-governance/src/**` | `funding-governance-check` |
| strategy contract compile/lint | `modules/contracts/strategy-contract/src/**`, `modules/research-strategy-development/strategy-contract-*/src/**` | `strategy-contract-compile-check` + `strategy-contract-lint-check` + `rd-integration-suite-check` if RD consumes compiled candidates |
| strategy policy loader | `modules/contracts/strategy-policy/src/**` | `strategy-policy-check` + `strategy-review-check` + `trade-flow-check` if consumed paths changed |
| research RD memory | `modules/research-strategy-development/rd-program-state/src/**` | `rd-program-state-smoke` + `rd-integration-suite-check` while supervisor/loop still consume the shared state implementation |
| research RD supervisor | `modules/research-strategy-development/rd-supervisor/src/**` | `rd-supervisor-integration` + `rd-integration-suite-check` while supervisor consumes loop/campaign runners |
| research RD shadow tracker | `modules/research-strategy-development/rd-shadow-tracker/src/**` | `rd-shadow-tracker-integration` + `rd-integration-suite-check` |
| research RD loop | `modules/research-strategy-development/rd-loop-runner/src/**` | `rd-loop-runner-integration` + `rd-integration-suite-check` while campaign consumes loop runner |
| research RD campaign | `modules/research-strategy-development/rd-campaign-runner/src/**` | `rd-campaign-runner-integration` + `rd-integration-suite-check` |
| research RD ledger | `modules/research-strategy-development/rd-ledger/src/**` | `rd-integration-suite-check` |
| research forward holdout | `modules/research-strategy-development/forward-holdout/src/**` | `rd-integration-suite-check` |
| research integration tests | `modules/research-strategy-development/rd-integration-suite/src/**` | `rd-integration-suite-check` |
| research R&D artifact summary | `modules/research-strategy-development/rd-artifact-summary/src/**` | `rd-artifact-summary-check` |
| strategy evidence / review / promotion | `modules/governance-review-compliance/strategy-review/src/**` | `strategy-review-check` |
| artifact hygiene / catalog | `modules/artifact-knowledge/artifact-catalog/src/**` | `artifact-catalog-check` |
| cron slow/fast track | `modules/live-decision-planning/slow-track-plan/src/**`, `modules/live-execution-control/fast-track-guard/src/**`, `src/scripts/lib/track-runner.ts`, `src/scripts/lib/cron-runtime.ts` | `slow-track-plan-check` + `fast-track-guard-check` + `trade-flow-typecheck` + `bun test ./src/scripts/lib/cron-runtime.test.ts ./src/scripts/lib/track-dry-run-schema.test.ts` |
| preflight hard guard | `modules/live-execution-control/plan-preflight/**` | `plan-preflight-check` + trade-flow execution/recovery targeted tests if guard output shape changed |
| Binance execute tool | `modules/exchange-gateway/binance-write/*` | corresponding `binance-ts-check` + trade-flow execution targeted tests；输出边界见 [execution-tool-contract.md](execution-tool-contract.md) |
| market / account read tool | `modules/market-data-products/binance-read/*`, `modules/exchange-gateway/binance-read/account-snapshot` | corresponding `binance-ts-check` + observe/recovery targeted tests if consumed by trade-flow |
| OHLCV / indicators | `modules/market-data-products/ohlcv-fetch`, `modules/market-data-products/tech-indicators` | corresponding tool check + trade-flow research targeted tests if manifest/factor shape changed |
| local helper scripts | `scripts/*.sh`, README helper 入口 | `helper-scripts-smoke` + `repo-whitespace` |

## 4. 何时升级为全量

必须跑 `trade-flow-check`：

- 修改 `src/scripts/main.ts`
- 修改 `src/scripts/commands/*`
- 修改 `schemas/registry.json`
- 修改 `plan_event`、recovery、execution 任一 trade-flow 公共类型
- 新增 command、schema、strategy family、evidence record 或 promotion gate
- targeted test 失败后修复完成

必须跑 `project-quality`：

- 准备提交或交给别人 review
- 跨语言改动
- 新增脚本、helper、tool 或测试入口
- 发现 warning / error / formatter / 本机路径泄漏后修复完成

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
