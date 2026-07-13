# Tool Layout

本文定义当前项目的代码归位规则。项目形态是 agent-operated toolset，不是单入口常驻程序，也不再使用本地 tool 壳作为源码组织方式。

下一轮模块原子化和目录重构计划见 [module-structure-refactor-plan.md](module-structure-refactor-plan.md)。本文描述当前有效布局；重构计划描述目标拓扑和迁移顺序。

## 核心原则

- 目录按行为和责任切分：采集、分析、编排、守卫、执行、资产治理分开。
- agent / automation / human 通过 CLI + JSON contract 调工具；跨域不得直接 import 业务实现。
- 跨域源码复用只走 `modules/contracts/*`；同 domain 原子工具共享公式可走无 package internal engine；领域判断留在 owner 模块。
- Durable 运行事实只落 `data/*.db`；临时工作产物只落 `tmp/`；源码目录不堆 artifact、cache、运行快照。
- strategy policy 的唯一源码位置是 `strategies/`。
- negative control 命名是唯一口径。

## Registry Contract

`toolset.json` 是 agent 调工具的唯一发现入口。每个 entry 必须声明：

| 字段 | 含义 |
| --- | --- |
| `module_type` | `suite`、`atomic` 或 `contract`；暴露当前粒度，不把胖模块伪装成原子能力 |
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
| `modules/research-strategy-development/replay-runner/` | strategy replay | 单策略机械 replay | R&D search、catalog 写入、strategy promotion |
| `modules/research-strategy-development/data-split/` | strategy data split | discovery / validation / locked holdout manifest 切分 | R&D search、replay、review、`trade.db` |
| `modules/research-strategy-development/signal-evaluator/` | latest strategy signal | 最新闭合 K 线信号评估 | R&D search、catalog 写入、strategy promotion、交易执行 |
| `modules/research-strategy-development/panel-evaluator/` | panel evaluator | 多资产 panel、marketability、panel negative controls | R&D loop artifact、RD memory、strategy promotion、`trade.db` |
| `modules/research-strategy-development/candidate-batch/` | candidate batch evaluator | 单批候选评估、negative controls、统计报告 | artifact 写入、RD memory、strategy promotion、`trade.db` |
| `modules/research-strategy-development/signal-engine/` | signal internal engine | 最新信号输入解析与 family signal 计算 | agent-facing CLI、状态写入 |
| `modules/research-strategy-development/candidate-batch-engine/` | candidate batch internal engine | 单批候选评估、negative controls、统计报告 | agent-facing CLI、artifact 写入、RD memory |
| `modules/research-strategy-development/strategy-family-engine/` | strategy family internal engine | family registry、factor transform、factor research、feature store | agent-facing CLI、状态写入 |
| `modules/research-strategy-development/benchmark-runner/` | strategy benchmark | 固定 benchmark 仿真、成本/资金费压力、负对照 | R&D search、strategy promotion、`trade.db` |
| `modules/research-strategy-development/calibration-suite/` | strategy calibration | calibration diagnostics、data breadth、funding/cost attribution | R&D search、strategy promotion、`trade.db` |
| `modules/research-strategy-development/funding-governance/` | funding governance | funding carry research 前 exact funding event coverage 检查 | R&D search、replay、review、`trade.db` |
| `modules/research-strategy-development/strategy-contract-compile/` | strategy contract compile | strategy markdown contract 编译 | R&D search、replay、review、catalog 写入 |
| `modules/research-strategy-development/strategy-contract-lint/` | strategy contract lint | strategy markdown contract 完整性 lint | R&D search、replay、review、catalog 写入 |
| `modules/research-strategy-development/forward-holdout/` | research atom | frozen candidate forward-only signal check | R&D search、strategy evidence、promotion、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/rd-campaign-runner/` | research atom | R&D campaign | `trade.db`、Binance 写接口、strategy promotion、R&D loop 实现、forward tracker、RD state init/read/update/plan_next、supervisor CLI、单策略 replay CLI、latest signal CLI、panel CLI、data split CLI、benchmark/calibration/funding governance CLI、contract compile/lint CLI |
| `modules/research-strategy-development/rd-ledger/` | research atom | R&D run ledger / holdout idempotence | candidate evaluation、campaign orchestration、RD state writeback、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/rd-artifact-summary/` | research atom | R&D artifact summary | replay、candidate evaluation、artifact/catalog/ledger 写入、RD memory、`trade.db` |
| `modules/research-strategy-development/rd-integration-suite/` | test suite | research atoms integration regression | production RD logic、agent-facing tool、持久写入 |
| `modules/research-strategy-development/rd-loop-runner/` | RD loop runner | 单轮 R&D artifact、catalog、ledger、optional state writeback | campaign orchestration、strategy evidence、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/rd-program-state/` | RD memory state | init/read/update/plan_next durable R&D state | R&D trial execution、strategy evidence、`trade.db`、Binance 写接口 |
| `modules/research-strategy-development/rd-supervisor/` | RD supervisor | plan_next -> loop/campaign -> state writeback | `trade.db`、Binance 写接口、strategy review、promotion |
| `modules/research-strategy-development/rd-shadow-tracker/` | RD paper tracker | forward setup event chain and review draft input | R&D search、strategy evidence、`trade.db`、Binance 写接口 |
| `modules/governance-review-compliance/strategy-review/` | strategy governance | evidence ledger、strategy review、promotion gate、strategy-cycle | R&D 实验、交易执行、写 `trade.db`、写 RD memory |
| `modules/artifact-knowledge/artifact-catalog/` | artifact governance | catalog DB、artifact index/query/stale/gc、feature report refs | `trade.db`、策略判断、交易所 API |
| `modules/market-data-products/ohlcv-fetch/` | market data acquisition | OHLCV、funding、market features、calibration panel、manifest；可同步 market_data_store | 策略升格、live 执行判断 |
| `modules/exchange-gateway/` | exchange gateway tools | Binance 账户/订单读取、下单、撤单、保护、减仓 | R&D planning、strategy promotion、长期状态 |
| `modules/market-data-products/` | market data product tools | Binance public market facts、OHLCV、features、liquidity scan、microstructure refs | 账户私有状态、交易所写 side effect |
| `modules/live-execution-control/` | deterministic guard | preflight、hard guards、decision card validation | 市场观点、交易所写接口 |
| `modules/market-data-products/` | market analytics | indicators、structure、beta、feature report | live execution |
| `modules/contracts/` | cross-module contracts | runtime core、execution contract、preflight contract、catalog client | 业务实现 owner |
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
| automation plan | `modules/orchestration-ops/trade-flow/src/domain/runtime` + `trade-flow.automation` |
| observe / runtime load | `modules/orchestration-ops/trade-flow/src/domain/observe` + `trade-flow.observe` |
| 事件流 / track dry-run | `modules/orchestration-ops/trade-flow/src/domain/runtime` + `trade-flow.runtime` |
| 单策略 replay | `modules/research-strategy-development/replay-runner` + `research.replay-runner` |
| data split / holdout isolation | `modules/research-strategy-development/data-split` + `research.data-split` |
| latest signal | `modules/research-strategy-development/signal-evaluator` + `research.signal-evaluator` |
| panel evaluation | `modules/research-strategy-development/panel-evaluator` + `research.panel-evaluator` |
| candidate batch | `modules/research-strategy-development/candidate-batch` + `research.candidate-batch` |
| RD loop | `modules/research-strategy-development/rd-loop-runner` + `research.rd-loop-runner` |
| benchmark | `modules/research-strategy-development/benchmark-runner` + `research.benchmark-runner` |
| calibration suite | `modules/research-strategy-development/calibration-suite` + `research.calibration-suite` |
| funding governance | `modules/research-strategy-development/funding-governance` + `research.funding-governance` |
| strategy contract compile | `modules/research-strategy-development/strategy-contract-compile` + `research.strategy-contract-compile` |
| strategy contract lint | `modules/research-strategy-development/strategy-contract-lint` + `research.strategy-contract-lint` |
| R&D campaign / forward holdout | `modules/research-strategy-development/rd-campaign-runner` + `research.rd-campaign-runner`; `modules/research-strategy-development/forward-holdout` + `research.forward-holdout` |
| RD memory | `modules/research-strategy-development/rd-program-state` + `research.rd-program-state` |
| RD supervisor | `modules/research-strategy-development/rd-supervisor` + `research.rd-supervisor` |
| RD shadow tracker | `modules/research-strategy-development/rd-shadow-tracker` + `research.rd-shadow-tracker` |
| review / evidence / promotion | `modules/governance-review-compliance/strategy-review` + `strategy-review` |
| 执行编排 / shadow / live-small | `modules/orchestration-ops/trade-flow/src/domain/execution` + `trade-flow.execution` |
| recovery / reconcile | `modules/orchestration-ops/trade-flow/src/domain/recovery` + `trade-flow.recovery` |
| catalog / artifact hygiene | `modules/artifact-knowledge/artifact-catalog` + `artifact-catalog` |

## 目标拓扑

当前目录仍是迁移中间态；目标拓扑以行为 owner 分组：

| 目标路径 | 角色 |
| --- | --- |
| `modules/contracts/*` | 唯一可跨模块源码 import 的 contract module |
| `modules/exchange-gateway/binance-read/*` | Binance read atomic tools |
| `modules/exchange-gateway/binance-write/*` | Binance write atomic tools |
| `modules/market-data-products/*` | 数据采集、panel、market feature 数据构造 |
| `modules/market-data-products/*` | 指标、结构、微观结构分析 |
| `modules/research-strategy-development/*` | replay、signal、candidate batch、R&D loop、RD memory |
| `modules/governance-review-compliance/*` | evidence、review、promotion gate |
| `modules/*` | event-store、projector、observe、execution、recovery、automation plan |
| `modules/artifact-knowledge/*` | artifact catalog、GC、数据治理 |

## 边界规则

- `modules/orchestration-ops/trade-flow` 可以调用工具 CLI，但不拥有 Binance endpoint 细节，也不新增 R&D 实验实现或 strategy review 实现。
- Binance 写工具只做单一交易动作；不得产出策略观点或修改 `trade.db`。
- market scan 只能回答“先看谁”；不能直接生成 live action。
- R&D campaign artifact writeback 由 `research.rd-campaign-runner` 拥有，只能写 research artifact、catalog 和显式 RD state；不得触发 Binance 写接口或写 `trade.db`；forward holdout、RD ledger、RD loop、candidate batch、RD memory、RD supervisor、RD shadow tracker、panel、单策略 replay、data split、benchmark、calibration、funding governance 与 strategy contract compile/lint 已拆为独立原子工具。
- strategy evidence / review / promotion 由 `strategy-review` 拥有；只读消费 `trade.db`，不得写 RD memory 或触发执行。
- catalog / artifact hygiene 由 `artifact-catalog` 拥有；trade-flow 只消费可审计 artifact / catalog 结果。
- `plan-preflight` 只给 deterministic verdict；不得补写事件或解释行情方向。
- artifact 必须有 owner、referrer、retention 语义；垃圾数据堆在源码目录视为 bug。
- 任何新 agent-facing 能力都必须优先作为 `atomic` entry 进入 `toolset.json`；只有明确是过渡路由或目录归类时才能标为 `suite`。
- 源码跨模块 import 只允许指向 `modules/contracts/*` 或同 domain 的无 package internal engine；业务工具之间不得横向 import agent-facing 实现。

## 检查入口

- 仓库级：`scripts/quality-check.sh`
- 目录契约：`scripts/check-ts-tool-boundaries.ts` 当前检查 `modules` 的跨工具 import 边界。
- 具体“改哪里跑什么”：见 [check-contract.md](check-contract.md)。
