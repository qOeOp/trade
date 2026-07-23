---
title: Tool Layout
role: architecture-contract
status: active
owner: architecture
last_verified: 2026-07-23 CST
---

# Tool Layout

本文定义当前项目的代码归位规则。当前 domain authority 仍在既有 owner toolset；program supervisor 已提供独立 `full_shadow` profile 调度 J01–J07，但尚未进入 server config 或 live cutover，也不改变 owner 布局。项目不再使用本地 tool 壳作为源码组织方式。

已完成的模块原子化与目录迁移记录见 [module-structure-refactor-plan.md](../history/module-structure-refactor-plan.md)。本文只描述当前有效布局；历史计划中的目标路径不得作为当前调用入口。

## 核心原则

- 目录按行为和责任切分：采集、分析、编排、守卫、执行、资产治理分开。
- agent / automation / human 通过 CLI + JSON contract 调工具；跨域不得直接 import 业务实现。
- 跨域源码复用只走 `modules/contracts/*`；同 domain 原子工具共享公式可走无 package internal engine；领域判断留在 owner 模块。
- Durable 运行事实只落 `data/*.db`；临时工作产物只落 `tmp/`；源码目录不堆 artifact、cache、运行快照。

## Workspace Skill

`.agents/skills/<skill>/` 是 Codex 工作流适配层，不是项目 tool 目录。允许内容只有 `SKILL.md`、`agents/openai.yaml` 以及确有复用价值的 skill resource；领域实现、schema、DB、CLI 和 authority 必须继续留在 `modules/`、`toolset.json` 与 owner store。

Skill 可以说明如何调用既有 MCP / owner tool，但不能绕过 preflight、Control Plane、governance 或 durable write contract。`scripts/check-workspace-skills.sh` 校验命名、frontmatter、placeholder 和领域实现越界。
- strategy policy 的唯一源码位置是 `strategies/`。
- negative control 命名是唯一口径。

## Registry Contract

`toolset.json` 是 agent 调工具的唯一发现入口。每个 entry 必须声明：

| 字段 | 含义 |
| --- | --- |
| `module_type` | agent-facing entry 只使用 `suite` 或 `atomic`；`contract` / `internal-engine` 是源码模块类型，不进入工具注册表 |
| `owner_scope` | 行为 owner，使用 `domain.module` 口径，不等同目录历史 |
| `entry_contract` | CLI JSON 入口类型和可选 input / output schema |
| `requires_preflight` | 该工具是否需要前置 preflight 才能被执行链调用 |
| `concurrency_group` | 调度互斥组，例如 `trade-db`、`binance-write`、`artifact-catalog` |
| `forbidden_callers` | 禁止直接调用的上游类型，例如 research 不能直接调 exchange write |

编排输出目标是 `schemas/tool-job.schema.json`：一个 job 只绑定一个 `tool_id`，并携带 payload、写入面、并发组和契约信息。编排层不得把 `modules/.../src/scripts/main.ts` 这种裸路径写进 job graph；裸路径只允许由 registry resolver 在执行前解析。

## Canonical Directories

| 路径 | Owner | 负责 | 不负责 |
| --- | --- | --- | --- |
| `modules/orchestration-ops/trade-flow/` | flow domain orchestrator | 事件流、automation plan、observe、reconcile、execution orchestration | Binance 数据接入实现、交易所写接口细节、R&D 实验实现、策略复核 owner |
| `modules/orchestration-ops/watch-task-runtime/` | bounded active-plan observer | 在 ops fenced lease 下恢复单个固定 mark-price Watch Task，调用 public snapshot owner，停在 no-authority revalidation handoff | 策略/LLM 判断、preflight/execution、exchange write、trade fact |
| `modules/orchestration-ops/model-gateway/` | bounded model provider port | 固定 profile、credential lookup、timeout/retry/token budget、JSON Object parse 与脱敏 typed result | 领域 prompt/schema 判断、DB/event/exchange write、工具调用 |
| `modules/orchestration-ops/agent-host-codex/` | direct Codex Host adapter | Agent Run → pinned App Server stdio、profile sandbox、JSONL correlation、sanitized events 与 capability probe | Program cadence、领域 owner、production RW、raw reasoning、provider 或 live authority |
| `modules/orchestration-ops/agent-workspace-manager/` | isolated Developer workspace owner | 冻结 revision 的临时 worktree、write-prefix、bounded package check、patch capture 与 scoped GC | merge/release/deploy、production workspace、owner DB、secret、Docker socket 或领域 authority |
| `modules/orchestration-ops/operator-http/` | northbound operator adapter | loopback allowlist、auth、approval、rate limit、sanitized ops audit、fixed owner delegation | scheduler、任意 tool/command、exchange/live/promotion authority |
| `modules/live-decision-planning/watch-task-compiler/` | plan-to-watch compiler | 校验 plan/action-intent identity、hash、lineage、expiry 后生成固定 Watch definition | 运行任务、批准风险、读取市场、执行交易 |
| `modules/live-execution-control/watch-handoff-revalidation/` | triggered handoff revalidator | 绑定 definition/handoff/plan identity，以新 observation 复跑 trigger gate 与 plan preflight，签发 no-authority receipt | 执行批准、command compilation、exchange/event write、刷新 owner facts |
| `modules/orchestration-ops/l2-current-book-probe/` | non-economic ops consumer | health 后读取同 epoch bounded-depth book、BigInt microstructure；bounded session 与 resident worker 订阅 latest-only watermark，watch failure、epoch/resync 后强制 resnapshot；专属 supervisor 只管 worker restart，owner read 仅投影 baseline/metrics | automation job、MCP transport、depth delta、durable delivery、策略信号、Replay source、执行事实或交易所写入 |
| `modules/research-strategy-development/research-control-plane/` | RD authority plane | Contract/Trial/Result/Review/Lifecycle/KG、Draft Strategy registry | Replay/Forward 执行、Agent 推理、正式 Shadow/Live |
| `modules/research-strategy-development/replay-execution-plane/` | historical evidence plane | Trial-bound deterministic Replay、ledger、metrics、artifact/fingerprint | Candidate 生成、Review、promotion |
| `modules/research-strategy-development/forward-evidence-plane/` | post-freeze evidence plane | ready Draft admission、watermark、no-backfill Forward Result | 正式 Shadow、账户事实、promotion |
| `modules/research-strategy-development/agent-roles/` | replaceable role layer | Planner/Developer/Reviewer typed submissions | 权威事实、直接策略落盘 |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel/` | legacy research compatibility | 维持既有 R&D/Forward 的执行、fill/trade facts 与 legacy result shell | native Trial Replay、Result/Artifact authority、新调用方 |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts/` | legacy type compatibility | 冻结旧 Signal、Trade、Strategy、Options、Result 等 TypeScript shapes | runtime 实现、native Replay contracts、新字段设计 |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data/` | legacy market-data compatibility | 冻结旧 Candle、manifest/CSV loading 与 funding range helpers | native Dataset admission、SourceEvent、新数据接入 |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision/` | legacy decision compatibility | 冻结 prefix-only decision input、latest diagnostic 与 lookahead detection | fill materialization、trade resolution、Forward/Review/execution authority |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-evaluation/` | legacy evaluation compatibility | 冻结旧 trade summary、diagnostics、anti-overfit、robustness 与 gate | Replay 执行、trade facts、native metrics、Review/promotion authority |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-features/` | legacy derived-feature compatibility | 冻结旧 EMA、ATR 与 fixed indicator-set calculation | 新特征研发、feature store、native Replay indicator contract |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-order-lane/` | legacy OHLCV order-lane compatibility | 冻结独立 lane simulation、stop-first 与 reduce-only cap | 主 Replay、native engine/order state/accounting、新执行语义 |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-provenance/` | legacy provenance compatibility | 冻结旧 harness/data/assumptions binding 与 closed-candle temporal projection | Replay 执行、trade facts、native PIT/Result/Artifact authority |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-strategy-fixture/` | legacy replay strategy fixture | 冻结单一 BTC trend-pullback certification fixture 与 lookup | 产品 strategy registry、Draft Strategy、strategy-family、新策略 |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle/` | historical portfolio-cycle consumer | P10/P11/P13 fixed reallocation/two-cycle/consolidated accounting execution and Artifact readback | canonical entrypoint、P12+ successor、新经济语义、新消费者 |
| `modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity/` | legacy evidence identity | 冻结旧 canonical/file/data/harness hash 算法 | strategy、Signal、Fill、Result、新 Replay identity |
| `modules/research-strategy-development/replay-execution-plane/certification/legacy-replay-fingerprint/` | legacy replay parity certification | 基于 legacy research kernel 认证 evidence 的 harness/data/assumptions fingerprint | replay 执行、Trial 转发、新语义 owner、strategy promotion |
| `modules/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification/` | portfolio-cycle compatibility certification | P10/P11 Result/Artifact 与 P13 consolidated accounting 的完整、幂等、拒绝回归链 | runtime/CLI、生产语义、P12+ successor authority |
| `modules/research-strategy-development/research-control-plane/dataset-governance/data-split/` | strategy data split | discovery / validation / locked holdout manifest 切分 | R&D search、replay、review、`trade.db` |
| `modules/research-strategy-development/agent-roles/reviewer/signal-evaluator/` | strategy signal diagnostic | 最新闭合 K 线及冻结后 forward-only 信号诊断 | Forward Evidence、R&D search、catalog 写入、strategy promotion、交易执行 |
| `modules/research-strategy-development/agent-roles/developer/candidate-batch/` | candidate batch evaluator | 单数据集或 panel 候选评估、marketability、negative controls、统计报告 | artifact 写入、RD memory、Review authority、strategy promotion、`trade.db` |
| `modules/research-strategy-development/agent-roles/developer/signal-engine/` | signal internal engine | 最新信号、冻结时间/数据守卫与 family signal 计算 | Forward Evidence、agent-facing CLI、状态写入 |
| `modules/research-strategy-development/agent-roles/developer/candidate-batch-engine/` | candidate batch internal engine | 单批候选评估、negative controls、统计报告 | agent-facing CLI、artifact 写入、RD memory |
| `modules/research-strategy-development/agent-roles/developer/strategy-family-engine/` | strategy family internal engine | family registry、factor transform、factor research、feature store | agent-facing CLI、状态写入 |
| `modules/research-strategy-development/agent-roles/planner/strategy-hypothesis-designer/` | research atom | agent-native strategy hypothesis prompt、contract lint、RD queue seed projection | replay、panel、campaign、strategy policy 写入、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/replay-execution-plane/benchmark/` | deterministic benchmark | panel alignment、funding coverage、fixed simulation、calibration calculations | agent-facing CLI、Review、promotion、状态写入 |
| `modules/research-strategy-development/replay-execution-plane/certification/calibration-suite/` | canonical benchmark / calibration certification | 对 caller panel 运行 fixed benchmark、data breadth、funding/cost diagnostics | static fixture authority、R&D search、strategy promotion、`trade.db` |
| `modules/research-strategy-development/replay-execution-plane/certification/replay-certification/` | Replay certification command | 唯一 `certify` 入口、canonical/compatibility suite registry 与 fail-fast package checks | Replay 语义、release verdict、长期认证 Artifact |
| `modules/research-strategy-development/research-control-plane/dataset-governance/funding-governance/` | funding governance | funding carry research 前 exact funding event coverage 检查 | R&D search、replay、review、`trade.db` |
| `modules/research-strategy-development/agent-roles/developer/strategy-contract-compile/` | strategy contract compile | strategy markdown contract 编译 | R&D search、replay、review、catalog 写入 |
| `modules/research-strategy-development/research-control-plane/contract-lint/` | strategy contract lint | strategy markdown contract 完整性 lint | R&D search、replay、review、catalog 写入 |
| `modules/research-strategy-development/agent-roles/developer/rd-campaign-runner/` | research atom | R&D campaign | `trade.db`、Binance 写接口、strategy promotion、R&D loop 实现、forward tracker、RD state init/read/update/plan_next、supervisor CLI、单策略 replay CLI、latest signal CLI、panel CLI、data split CLI、benchmark/calibration/funding governance CLI、contract compile/lint CLI |
| `modules/research-strategy-development/research-control-plane/experiment-ledger/` | research atom | R&D run ledger / holdout idempotence | candidate evaluation、campaign orchestration、RD state writeback、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/agent-roles/reviewer/rd-artifact-summary/` | research atom | R&D artifact summary | replay、candidate evaluation、artifact/catalog/ledger 写入、RD memory、`trade.db` |
| `modules/research-strategy-development/research-control-plane/strategy-policy-writer/` | research atom | validated candidate -> strategy policy markdown renderer + shape lint | R&D search、replay、promotion、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite/` | test suite | research atoms integration regression | production RD logic、agent-facing tool、持久写入 |
| `modules/research-strategy-development/agent-roles/developer/rd-loop-runner/` | RD loop runner | 单轮 R&D artifact、catalog、ledger、optional state writeback | campaign orchestration、strategy evidence、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/research-control-plane/program-control/` | RD memory state | init/read/update/plan_next durable R&D state | R&D trial execution、strategy evidence、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/research-control-plane/program-supervisor/` | RD supervisor | plan_next -> loop/campaign -> state writeback; delegates strategy markdown shape to policy writer | `trade.db`、Binance 写接口、strategy review、promotion |
| `modules/research-strategy-development/forward-evidence-plane/paper-tracker/` | Forward paper tracker | J05 setup event chain、paper artifact、review draft input | formal Shadow、strategy evidence、promotion、`trade.db`、Binance 写接口 |
| `modules/governance-review-compliance/strategy-review/` | strategy governance | evidence ledger、strategy review、promotion gate、strategy-cycle | R&D 实验、交易执行、写 `trade.db`、写 RD memory |
| `modules/artifact-knowledge/artifact-catalog/` | artifact governance | catalog DB、artifact index/query/stale/gc、feature report refs | `trade.db`、策略判断、交易所 API |
| `modules/market-data-products/ohlcv-fetch/` | market data acquisition | OHLCV、funding、market features、calibration panel、manifest；可同步 market_data_store | 策略升格、live 执行判断 |
| `modules/market-data-products/l2-order-book-core/` | L2 deterministic core | decimal book projection、`U/u/pu` continuity、canonical hash、TL2S finalize/recovery/rotation | 网络、runtime/soak lifecycle、manifest admission、策略或交易 |
| `modules/market-data-products/l2-order-book-service/` | L2 public runtime candidate | 单标的 public stream/snapshot lifecycle、epoch、bounded queue、raw TL2S、loopback gRPC freshness reads | private/write API、market-data admission、Replay/策略/执行、未启用 broker |
| `modules/market-data-products/l2-order-book-compactor/` | L2 Parquet compaction worker | owner-admitted complete TL2S epoch 的确定性校验、Parquet proposal 与有界读取 | authority scan、SQLite 写入、raw 删除、跨 epoch 推断 |
| `modules/exchange-gateway/` | exchange gateway tools | Binance 账户/订单读取、下单、撤单、保护、减仓 | R&D planning、strategy promotion、长期状态 |
| `modules/market-data-products/` | market data product tools | Binance public market facts、OHLCV、features、liquidity scan、microstructure refs | 账户私有状态、交易所写 side effect |
| `modules/live-execution-control/` | deterministic guard | preflight、hard guards、decision card validation | 市场观点、交易所写接口 |
| `modules/market-data-products/` | market analytics | indicators、structure、beta、feature report | live execution |
| `modules/contracts/` | cross-module contracts | runtime core、Agent Run、model task、execution、preflight、catalog client | 业务实现 owner |
| `strategies/` | strategy assets | policy markdown、frontmatter、`## Trade Contract` | 运行日志、临时候选 |
| `data/` | durable local state | `trade.db`、catalog、OHLCV、RD memory、持久 evidence refs | scratch cache |
| `tmp/` | ephemeral artifacts | R&D reports、scan outputs、临时 market data、GC 候选 | 长期策略资产 |
| `profile/` | local config | trading config、notify config、账户配置样例 | credentials 明文落库 |

## 行为分层

| 行为 | 工具 |
| --- | --- |
| 账户事实 | `modules/exchange-gateway/binance-read/account-snapshot` |
| 市场粗筛 | `modules/market-data-products/binance-read/market-scan` |
| 单标的事实 | `modules/market-data-products/binance-read/symbol-snapshot` |
| 成交原材料 | `modules/market-data-products/binance-read/aggtrades-fetch` |
| liquidation-like refs | `modules/market-data-products/liquidation-zones` |
| OHLCV / funding / panel | `modules/market-data-products/ohlcv-fetch` |
| 技术结构与 feature | `modules/market-data-products/tech-indicators` |
| preflight / hard guard | `modules/live-execution-control/plan-preflight` |
| 执行预演 | `modules/exchange-gateway/binance-write/order-preview` |
| 主单 / 撤单 / 保护 / 减仓 | `modules/exchange-gateway/binance-write/order-place`, `order-cancel`, `position-protect`, `position-adjust` |
| automation plan | `modules/orchestration-ops/trade-flow` + `trade-flow.automation` |
| program shadow wakeup / resident cadence | `modules/orchestration-ops/trade-flow` + `trade-flow.program-shadow` / `trade-flow.program-shadow-supervisor` |
| bounded active-plan watch | `modules/orchestration-ops/watch-task-runtime` + `ops.watch-task-runtime`；状态 owner 为 `ops.runtime-store` |
| bounded model task | `modules/orchestration-ops/model-gateway` + `ops.model-gateway`；request/result contract 为 `modules/contracts/model-task-contract` |
| authenticated operator HTTP | `modules/orchestration-ops/operator-http` + `ops.operator-http`；当前只读 discovery/RD state 与 approved J04 wakeup |
| observe / runtime load | `modules/orchestration-ops/trade-flow` + `trade-flow.observe` |
| 事件流 / track dry-run | `modules/orchestration-ops/trade-flow` + `trade-flow.runtime` |
| Trial-bound replay | `modules/research-strategy-development/replay-execution-plane/runner` + `research.replay-execution` |
| legacy replay evidence fingerprint certification | `modules/research-strategy-development/replay-execution-plane/certification/legacy-replay-fingerprint` + `research.legacy-replay-fingerprint` |
| data split / holdout isolation | `modules/research-strategy-development/research-control-plane/dataset-governance/data-split` + `research.data-split` |
| latest / post-freeze diagnostic signal | `modules/research-strategy-development/agent-roles/reviewer/signal-evaluator` + `research.signal-evaluator` / `research.forward-holdout` |
| candidate / panel evaluation | `modules/research-strategy-development/agent-roles/developer/candidate-batch` + `research.candidate-batch` / `research.panel-evaluator` |
| strategy hypothesis designer | `modules/research-strategy-development/agent-roles/planner/strategy-hypothesis-designer` + `research.strategy-hypothesis-designer` |
| RD autonomy wakeup | `modules/research-strategy-development/research-control-plane/autonomy-cycle` + `research.rd-autonomy-cycle`；仅补 validated ready queue proposal，再委托原 supervisor |
| RD loop | `modules/research-strategy-development/agent-roles/developer/rd-loop-runner` + `research.rd-loop-runner` |
| benchmark / calibration | `modules/research-strategy-development/replay-execution-plane/certification/calibration-suite` + `research.benchmark-runner` / `research.calibration-suite` |
| funding governance | `modules/research-strategy-development/research-control-plane/dataset-governance/funding-governance` + `research.funding-governance` |
| strategy contract compile | `modules/research-strategy-development/agent-roles/developer/strategy-contract-compile` + `research.strategy-contract-compile` |
| strategy contract lint | `modules/research-strategy-development/research-control-plane/contract-lint` + `research.strategy-contract-lint` |
| strategy policy writer | `modules/research-strategy-development/research-control-plane/strategy-policy-writer` |
| R&D campaign | `modules/research-strategy-development/agent-roles/developer/rd-campaign-runner` + `research.rd-campaign-runner` |
| authoritative Forward Evidence | `modules/research-strategy-development/forward-evidence-plane/runner` + `research.forward-evidence` |
| RD memory | `modules/research-strategy-development/research-control-plane/program-control` + `research.rd-program-state` |
| RD supervisor | `modules/research-strategy-development/research-control-plane/program-supervisor` + `research.rd-supervisor` |
| R&D paper tracker | `modules/research-strategy-development/forward-evidence-plane/paper-tracker` + `research.rd-shadow-tracker`（legacy tool ID） |
| review / evidence / promotion | `modules/governance-review-compliance/strategy-review` + `strategy-review` |
| 执行编排 / shadow / live-small | `modules/orchestration-ops/trade-flow` + `trade-flow.execution`；行为 owner 在 `modules/live-execution-control/*` |
| recovery / reconcile | `modules/orchestration-ops/trade-flow` + `trade-flow.recovery`；行为 owner 在 `modules/live-execution-control/*` |
| catalog / artifact hygiene | `modules/artifact-knowledge/artifact-catalog` + `artifact-catalog` |

## 当前拓扑状态

- 顶层责任域、模块清单、job 与 logical store ownership 以 [architecture-manifest.json](./architecture-manifest.json) 为机器真相。
- `modules/research-strategy-development/` 已收敛为 `research-control-plane / replay-execution-plane / forward-evidence-plane / agent-roles` 四个直接子树。
- `trade-flow` 保留为 suite façade；退役的 `src/domain/*` 不得恢复，真实行为 owner 已下沉到 portfolio、decision、execution 等责任域。
- 当前代码投影及剩余飞线看 [generated/architecture-drift-report.md](./generated/architecture-drift-report.md)。

## 边界规则

- `modules/orchestration-ops/trade-flow` 可以调用工具 CLI，但不拥有 Binance endpoint 细节，也不新增 R&D 实验实现或 strategy review 实现。
- Binance 写工具只做单一交易动作；不得产出策略观点或修改 `trade.db`。
- market scan 只能回答“先看谁”；不能直接生成 live action。
- R&D campaign artifact writeback 由 `research.rd-campaign-runner` 拥有，只能写 research artifact、catalog 和显式 RD state；不得触发 Binance 写接口或写 `trade.db`；forward diagnostic、RD ledger、RD loop、candidate batch、RD memory、RD supervisor、paper tracker、panel、Replay、data split、benchmark、calibration、funding governance 与 strategy contract compile/lint 已拆为独立 owner。
- strategy evidence / review / promotion 由 `strategy-review` 拥有；只读消费 `trade.db`，不得写 RD memory 或触发执行。
- catalog / artifact hygiene 由 `artifact-catalog` 拥有；trade-flow 只消费可审计 artifact / catalog 结果。
- `plan-preflight` 只给 deterministic verdict；不得补写事件或解释行情方向。
- artifact 必须有 owner、referrer、retention 语义；垃圾数据堆在源码目录视为 bug。
- 任何新 agent-facing 能力都必须优先作为 `atomic` entry 进入 `toolset.json`；只有明确是过渡路由或目录归类时才能标为 `suite`。
- 源码跨模块 import 只允许指向 `modules/contracts/*` 或同 domain 的无 package internal engine；业务工具之间不得横向 import agent-facing 实现。

## 检查入口

- 仓库级：`scripts/quality-check.sh`
- 目录契约：`scripts/check-ts-tool-boundaries.ts` 当前检查 `modules` 的跨工具 import 边界。
- 具体“改哪里跑什么”：见 [check-contract.md](../engineering/check-contract.md)。
