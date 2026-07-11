# Tool Layout

本文定义当前项目的代码归位规则。项目形态是 agent-operated toolset，不是单入口常驻程序，也不再使用本地 tool 壳作为源码组织方式。

下一轮模块原子化和目录重构计划见 [module-structure-refactor-plan.md](module-structure-refactor-plan.md)。本文描述当前有效布局；重构计划描述目标拓扑和迁移顺序。

## 核心原则

- 目录按行为和责任切分：采集、分析、编排、守卫、执行、资产治理分开。
- agent / automation / human 通过 CLI + JSON contract 调工具；跨域不得直接 import 业务实现。
- 可复用确定性契约进入 `modules/common/src/`；领域判断留在 owner 模块。
- 运行产物只落 `data/` 或 `tmp/`；源码目录不堆 artifact、cache、运行快照。
- strategy policy 的唯一源码位置是 `strategies/`。
- negative control 命名是唯一口径。

## Canonical Directories

| 路径 | Owner | 负责 | 不负责 |
| --- | --- | --- | --- |
| `modules/trade-flow/` | flow domain orchestrator | 事件流、automation plan、observe、reconcile、execution orchestration | Binance 数据接入实现、交易所写接口细节、R&D 实验实现、策略复核 owner |
| `modules/research/strategy-rd/` | strategy research | replay、R&D loop、panel、benchmark、calibration、forward holdout、R&D memory | `trade.db`、Binance 写接口、strategy promotion |
| `modules/governance/strategy-review/` | strategy governance | evidence ledger、strategy review、promotion gate、strategy-cycle | R&D 实验、交易执行、写 `trade.db`、写 RD memory |
| `modules/ops/artifact-catalog/` | artifact governance | catalog DB、artifact index/query/stale/gc、feature report refs | `trade.db`、策略判断、交易所 API |
| `modules/ohlcv-fetch/` | market data acquisition | OHLCV、funding、market features、calibration panel、manifest | 策略升格、live 执行判断 |
| `modules/binance/` | exchange atomic tools | Binance 只读事实、市场扫描、下单、撤单、保护、减仓 | R&D planning、strategy promotion、长期状态 |
| `modules/guards/` | deterministic guard | preflight、hard guards、decision card validation | 市场观点、交易所写接口 |
| `modules/analytics/` | market analytics | indicators、structure、beta、feature report | live execution |
| `modules/common/src/` | common contracts | target action、preflight、execution contract、time helpers | 领域编排 |
| `strategies/` | strategy assets | policy markdown、frontmatter、`## Trade Contract` | 运行日志、临时候选 |
| `data/` | durable local state | `trade.db`、catalog、OHLCV、RD memory、持久 evidence refs | scratch cache |
| `tmp/` | ephemeral artifacts | R&D reports、scan outputs、临时 market data、GC 候选 | 长期策略资产 |
| `profile/` | local config | trading config、notify config、账户配置样例 | credentials 明文落库 |

## 行为分层

| 行为 | 工具 |
| --- | --- |
| 账户事实 | `modules/binance/account-snapshot` |
| 市场粗筛 | `modules/binance/market-scan` |
| 单标的事实 | `modules/binance/symbol-snapshot` |
| 成交原材料 | `modules/binance/aggtrades-fetch` |
| liquidation-like refs | `modules/binance/liquidation-zones` |
| OHLCV / funding / panel | `modules/ohlcv-fetch` |
| 技术结构与 feature | `modules/analytics/tech-indicators` |
| preflight / hard guard | `modules/guards/plan-preflight` |
| 执行预演 | `modules/binance/order-preview` |
| 主单 / 撤单 / 保护 / 减仓 | `modules/binance/order-place`, `order-cancel`, `position-protect`, `position-adjust` |
| automation plan | `modules/trade-flow/src/domain/runtime` + `trade-flow.automation` |
| observe / runtime load | `modules/trade-flow/src/domain/observe` + `trade-flow.observe` |
| 事件流 / track dry-run | `modules/trade-flow/src/domain/runtime` + `trade-flow.runtime` |
| 研究 / 回放 / panel / benchmark | `modules/research/strategy-rd` + `strategy-rd` |
| review / evidence / promotion | `modules/governance/strategy-review` + `strategy-review` |
| 执行编排 / shadow / live-small | `modules/trade-flow/src/domain/execution` + `trade-flow.execution` |
| recovery / reconcile | `modules/trade-flow/src/domain/recovery` + `trade-flow.recovery` |
| catalog / artifact hygiene | `modules/ops/artifact-catalog` + `artifact-catalog` |

## 边界规则

- `modules/trade-flow` 可以调用工具 CLI，但不拥有 Binance endpoint 细节，也不新增 R&D 实验实现或 strategy review 实现。
- Binance 写工具只做单一交易动作；不得产出策略观点或修改 `trade.db`。
- market scan 只能回答“先看谁”；不能直接生成 live action。
- R&D / replay / panel 由 `strategy-rd` 拥有，只能写 research artifact、catalog、gated draft；不得触发 Binance 写接口或写 `trade.db`。
- strategy evidence / review / promotion 由 `strategy-review` 拥有；只读消费 `trade.db`，不得写 RD memory 或触发执行。
- catalog / artifact hygiene 由 `artifact-catalog` 拥有；trade-flow 只消费可审计 artifact / catalog 结果。
- `plan-preflight` 只给 deterministic verdict；不得补写事件或解释行情方向。
- artifact 必须有 owner、referrer、retention 语义；垃圾数据堆在源码目录视为 bug。

## 检查入口

- 仓库级：`scripts/quality-check.sh`
- 目录契约：`scripts/check-ts-tool-boundaries.ts` 当前检查 `modules` 的跨工具 import 边界。
- 具体“改哪里跑什么”：见 [check-contract.md](check-contract.md)。
