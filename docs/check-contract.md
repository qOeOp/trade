# Check Contract

## 0. 定位

本文回答：改了哪里，最少跑什么。

它不是 CI 设计，不新增 build system；只记录当前仓库可执行的检查入口。缺入口的地方先写明缺口，不伪装成已自动化。

## 1. 通用规则

- 所有改动最后跑：`git diff --check`
- 涉及 TS skill：在对应 skill 目录跑 `bun run check`
- 涉及真实 Binance 写接口：默认只跑单测 / dry-run / preview；真实 live 或 test endpoint 必须用户明确授权
- 涉及 schema：同时跑 registry / schema 相关测试，再跑 owner skill 全量 check
- 涉及 docs-only：不要求代码测试，但必须确保没有把未实现结构写成已完成事实

## 2. 当前入口

| Check id | 目录 | 命令 | 覆盖 |
| --- | --- | --- | --- |
| `repo-whitespace` | repo root | `git diff --check` | 空白、冲突标记、尾随空格 |
| `project-quality` | repo root | `scripts/quality-check.sh` | 提交前 TS / Go / Python / shell / hygiene 总闸 |
| `trade-flow-typecheck` | `.agents/skills/trade-flow` | `bun run typecheck` | TS 类型与未使用变量 |
| `trade-flow-test` | `.agents/skills/trade-flow` | `bun run test` | 当前全部 trade-flow 单测 / 契约测 |
| `trade-flow-check` | `.agents/skills/trade-flow` | `bun run check` | typecheck + test |
| `plan-preflight-check` | `.agents/skills/plan-preflight` | `bun run check` | hard guards / decision card |
| `binance-ts-check` | changed Binance TS skill | `bun run check` | 对应执行或只读 skill 的本地契约 |
| `ohlcv-fetch-check` | `.agents/skills/ohlcv-fetch` | `bun run check` | OHLCV manifest / fetch 本地契约 |
| `tech-indicators-check` | `.agents/skills/tech-indicators` | `go test ./...` | 指标与结构算法 |
| `helper-scripts-smoke` | repo root | `sh scripts/resolve-codex-home.sh && sh scripts/automation-memory-path.sh demo && sh scripts/resolve-python.sh` | 本地 helper fallback 可用性 |

## 3. 改动域到最小检查

| 改动域 | 触发文件 | 最小检查 |
| --- | --- | --- |
| docs contract | `docs/*.md` | `repo-whitespace` |
| trade-flow CLI 参数 / help / router | `scripts/main.ts`, `scripts/commands/*` | `trade-flow-typecheck` + `bun test ./scripts/commands/*.test.ts ./scripts/main.test.ts` |
| command response envelope | `scripts/commands/response.ts`, `schemas/script-response.schema.json` | `trade-flow-typecheck` + `bun test ./scripts/commands/response.test.ts ./scripts/main.test.ts` |
| schema registry / data schema | `schemas/*.schema.json`, `schemas/registry.json` | `trade-flow-typecheck` + `bun test ./scripts/lib/*schema*.test.ts ./scripts/lib/schema-registry.test.ts` |
| runtime event store | `scripts/lib/plan-events.ts`, `scripts/lib/flow-state.ts` | `trade-flow-typecheck` + `bun test ./scripts/lib/plan-events-schema.test.ts ./scripts/lib/flow-state.test.ts ./scripts/lib/core-data-schemas.test.ts` |
| execution dry/shadow/live-small glue | `scripts/lib/execution-flow.ts`, `scripts/lib/live-execution.ts`, `scripts/commands/execution.ts` | `trade-flow-typecheck` + `bun test ./scripts/lib/execution-flow.test.ts ./scripts/lib/live-execution.test.ts ./scripts/lib/live-small-result-schema.test.ts ./scripts/main.test.ts` |
| recovery / reconcile | `scripts/lib/reconcile.ts`, `scripts/lib/recovery-flow.ts`, `scripts/commands/recovery.ts` | `trade-flow-typecheck` + `bun test ./scripts/lib/reconcile.test.ts ./scripts/lib/recovery-flow.test.ts ./scripts/lib/reconcile-schema.test.ts ./scripts/main.test.ts` |
| observe / runtime load | `scripts/lib/observe-*`, `scripts/commands/observe.ts` | `trade-flow-typecheck` + `bun test ./scripts/lib/observe-*.test.ts ./scripts/commands/handlers.test.ts` |
| research replay / R&D / benchmark | `scripts/lib/strategy-*`, `scripts/lib/rnd-*` | `trade-flow-typecheck` + `bun test ./scripts/lib/strategy-*.test.ts ./scripts/lib/rnd-*.test.ts ./scripts/lib/research-output-schemas.test.ts` |
| artifact hygiene | `scripts/lib/artifact-hygiene.ts`, `schemas/artifact-gc-result.schema.json` | `trade-flow-typecheck` + `bun test ./scripts/lib/artifact-hygiene.test.ts ./scripts/lib/artifact-gc-schema.test.ts` |
| cron slow/fast track | `scripts/lib/*track*`, `scripts/lib/cron-runtime.ts` | `trade-flow-typecheck` + `bun test ./scripts/lib/slow-track-workflow.test.ts ./scripts/lib/fast-track-workflow.test.ts ./scripts/lib/cron-runtime.test.ts ./scripts/lib/track-dry-run-schema.test.ts` |
| preflight hard guard | `.agents/skills/plan-preflight/**` | `plan-preflight-check` + trade-flow execution/recovery targeted tests if guard output shape changed |
| Binance execute skill | `.agents/skills/binance-order-*`, `.agents/skills/binance-position-*` | corresponding `binance-ts-check` + trade-flow execution targeted tests；输出边界见 [execution-skill-contract.md](execution-skill-contract.md) |
| market / account read skill | `.agents/skills/binance-*-snapshot`, `.agents/skills/binance-market-scan` | corresponding `binance-ts-check` + observe/recovery targeted tests if consumed by trade-flow |
| OHLCV / indicators | `.agents/skills/ohlcv-fetch`, `.agents/skills/tech-indicators` | corresponding skill check + trade-flow research targeted tests if manifest/factor shape changed |
| local helper scripts | `scripts/*.sh`, README helper 入口 | `helper-scripts-smoke` + `repo-whitespace` |

## 4. 何时升级为全量

必须跑 `trade-flow-check`：

- 修改 `scripts/main.ts`
- 修改 `scripts/commands/*`
- 修改 `schemas/registry.json`
- 修改 `plan_event`、recovery、execution、research 任一公共类型
- 新增 command、schema、strategy family、evidence record 或 promotion gate
- targeted test 失败后修复完成

必须跑 `project-quality`：

- 准备提交或交给别人 review
- 跨语言改动
- 新增脚本、helper、skill 或测试入口
- 发现 warning / error / formatter / 本机路径泄漏后修复完成

必须额外跑相关 skill 的 `bun run check`：

- trade-flow 调用的外部 skill CLI 参数变化
- 外部 skill 输出被 trade-flow 解析
- `plan-preflight` verdict / blocked shape / decision card 变化

## 5. 明确不自动跑

- Binance 真实下单、撤单、调仓、保护腿写接口
- Binance test endpoint smoke
- 长窗口 OHLCV 下载
- 大规模 R&D campaign

这些都需要单独授权和独立运行记录。
