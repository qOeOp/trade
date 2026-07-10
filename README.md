# Crypto Trade Workspace

这是一个 agent-native 加密交易工作仓库：让 Codex / Claude / Gemini 等 agent 在同一个工作区里，通过可审计的 skills、脚本、事件流和研究 artifact，推进 Binance USDM 4H+ swing 的观察、研发、验证、执行、恢复和复盘。

项目的核心不是“聊天里让 agent 下判断”，而是一套有事实源、有权限边界、有执行契约、有回读对账、有研究记忆的投研交易操作系统。

## 一眼看全局

```text
single automation entry / user takeover
  -> trade-flow supervisor
     -> cadence / lock / concurrency / permission gate
     -> subagent fan-out
        -> fast_track_guard
        -> slow_track_market_watch
        -> rd_strategy_supervisor
        -> rd_forward_shadow_trackers
        -> closed_flow_review_sweep
        -> catalog_hygiene_scan
     -> supervisor summary

facts and memory
  -> trade.db plan_event: observe / order_fill / review
  -> data_catalog.db: datasets / runs / artifacts / strategy evidence
  -> strategies/*.md: strategy policy + Trade Contract
  -> research artifacts: replay / R&D / shadow tracker / calibration / reports
  -> rd_program_state: R&D learning memory
```

主线分两条：

```text
在线交易链:
OBSERVE -> PLAN + preflight -> EXECUTE -> REVIEW

离线验证链:
research / review -> replay / backtest -> shadow / forward -> live-small / paused
```

真实 Binance 写操作只发生在执行 skills，且必须通过 preflight、execution contract、显式授权和交易所事实回读。研究链永远不能直接写 `trade.db` 或触发 Binance 写接口。

## 设计原则

- No tested edge, no trade
- No fresh facts, no trade
- No executable contract, no trade
- No stop, no trade
- No reconciliation, no trade

事实优先级固定：

```text
Binance exchange facts
  > local trade.db event stream
  > strategy evidence / catalog / artifact
  > rd_program_state / automation memory
  > natural-language summary
```

agent 负责判断和编排；skill 负责事实采集、硬约束、执行和可重复计算；脚本输出机器可读 JSON；所有长期事实必须落在可审计资产里。

## 模块组成

| 层 | 目录 / 资产 | 职责 | 依赖 |
| --- | --- | --- | --- |
| 产品契约 | `docs/` | vision、PRD、架构、技术契约、检查契约、R&D 设计 | 不直接运行 |
| Agent 能力 | `.agents/skills/` | 可被 agent 调用的 observe / analysis / plan / execute / flow / notify skills | Binance、文件、SQLite、脚本运行时 |
| 主流程 glue | `.agents/skills/trade-flow/` | 事件流、automation supervisor、R&D、replay、evidence、promotion、reconcile | 其他 skills、`trade.db`、`data_catalog.db` |
| 策略资产 | `strategies/` | strategy frontmatter + `## Trade Contract` | evidence / replay / promotion gate |
| 运行数据 | `data/` | `trade.db`、catalog、OHLCV、ledger、持久 artifact | 本地运行产生，不等同源码 |
| 本地配置 | `profile/` | trading config、通知配置、账户兼容配置 | 凭证来自环境变量 |
| 工具脚本 | `scripts/` | quality check、路径解析、Python 解析、automation memory 路径 | 仓库级辅助 |
| 临时材料 | `tmp/` | panel、replay、R&D 输出、缓存、可再生成报告 | catalog / GC 管理 |

## Skill 拓扑

| 能力域 | Skill | 作用 |
| --- | --- | --- |
| 市场观察 | `binance-market-scan` | 全市场初筛，回答“先看谁” |
| 市场观察 | `binance-symbol-snapshot` | 单标的 mark/index、funding、OI、盘口、轻量 K 线 |
| 市场观察 | `binance-aggtrades-fetch` | 聚合逐笔成交原始材料 |
| 市场观察 | `binance-liquidation-zones` | liquidation-like zone 推断 |
| 账户恢复 | `binance-account-snapshot` | 余额、持仓、普通挂单、保护单、symbol 历史订单 |
| 数据落盘 | `ohlcv-fetch` | Binance USDM OHLCV CSV + manifest |
| 技术分析 | `tech-indicators` | 指标、结构、支撑阻力、趋势线、BTC beta、feature series |
| 计划预演 | `binance-order-preview` | 下单前形状和 exchange 参数预演 |
| 执行闸门 | `plan-preflight` | EXECUTE 前最后只读 hard guard |
| 执行写口 | `binance-order-place` | USDM 主单开仓 / 加仓 |
| 执行写口 | `binance-position-protect` | 止损、止盈、trailing 保护腿 |
| 执行写口 | `binance-position-adjust` | 已有持仓部分减仓 / 全平 |
| 执行写口 | `binance-order-cancel` | 普通单与 algo 条件单撤单 |
| 主流程 | `trade-flow` | 事件流、automation、dry-run、shadow、live-small、R&D、replay、review、promotion、reconcile |
| 通知 | `notify-dispatch` | Telegram 等通知出口；失败也写 `data/cron.log` fallback |

`trade-flow` 是编排 glue，不替代市场分析 skill、不直接调用 Binance 写接口、不绕过 preflight。

## 数据资产和存储

| 资产 | 默认位置 | 内容 | 谁写 | 谁读 |
| --- | --- | --- | --- | --- |
| `trade.db` | `data/trade.db` | append-only `plan_event`：`observe / order_fill / review` | `trade-flow` 在线链 | slow / fast / recovery / review |
| `data_catalog.db` | `data/data_catalog.db` | datasets、runs、artifacts、strategy evidence、R&D ledger refs | trade-flow / catalog scan | replay / review / GC / R&D |
| Strategy markdown | `strategies/*.md` | strategy identity、status、Trade Contract | promotion / human review | replay / signal / live gate |
| OHLCV manifest | `data/**/manifest.json` | closed candle dataset + checksum contract | `ohlcv-fetch` | replay / R&D / indicators |
| Feature report | `tmp/` or `data/` | indicator feature series and factor descriptors | `tech-indicators` / helper | R&D / replay |
| R&D artifact | `tmp/artifacts/strategy-rnd/` | batch、campaign、panel、calibration、failure summary | R&D commands | catalog / review / supervisor |
| `rd_program_state` | explicit `--state` path | R&D objective、budget、usage、lessons、queue、stop status | `--rd-program-state` / `--rd-supervisor-run` / R&D writeback | automation supervisor / R&D supervisor |
| Cron log | `data/cron.log` | automation / notify fallback JSONL | notify / runtime helpers | operations review |

`trade.db` 只承载在线交易事实。R&D artifact、strategy evidence、catalog 和 `rd_program_state` 不得伪装成交易事件。

## 核心对象关系

```text
strategy
  -> setup
     -> lane = strategy_ref + symbol + side
        -> flow = one concrete opportunity / exposure lifecycle
           -> plan_event chain
              -> observe
              -> order_fill
              -> review
```

- `strategy` 是规则模板，不是实盘资格。
- `setup` 是 strategy 内一个可验证交易机会，live 动作必须引用 `setup_id`。
- `lane` 是某策略在某 symbol + side 上的运行槽位。
- `flow` 是一笔具体机会 / 暴露从观察到闭合的生命周期。
- 同一 lane 同时最多一个 active flow；新理由、新结构、新加一段都必须并回当前 active flow，不能并行开多个风险拥有者。

## 单入口与分发

外部长期 automation 只有一个入口。它按快轨频率唤醒，但不是每轮都跑所有任务：

```text
automation wakeup
  -> bun .agents/skills/trade-flow/scripts/main.ts --automation-cycle
  -> supervisor plan
  -> cadence gate
  -> concurrency group
  -> permission boundary
  -> subagent fan-out
  -> collect summaries
```

Job line：

| Job | 目标 | 并发组 | 可写入 | 不允许 |
| --- | --- | --- | --- | --- |
| `fast_track_guard` | 守护 active flow、执行慢轨已授权触发、防御补救 | `trade-db` | `trade.db` light observe / order_fill | 新建 thesis、扩大风险 |
| `slow_track_market_watch` | 用 live-small 策略寻找和管理真钱机会 | `trade-db` | `trade.db` full observe / order_fill | 绕过 preflight / contract |
| `rd_strategy_supervisor` | 自主研发新策略，失败经验进入下一轮 hypothesis | `research-rd` | research artifact / catalog / gated draft | 写 `trade.db`、调用 Binance、无界搜索 |
| `rd_forward_shadow_trackers` | 跟踪已冻结候选或 paper/shadow 样本 | job 自身 | R&D tracker artifact / catalog | 生成 promotion evidence、触发 Binance |
| `closed_flow_review_sweep` | 对已闭合 flow 复盘并推动策略迭代 | `trade-db` | `trade.db` review / review artifact | 与交易写入并行封口 |
| `catalog_hygiene_scan` | 维护 artifact 可见性、引用、过期候选 | job 自身 | `data_catalog.db` | 删除未确认资产、影响交易事实 |

调度顺序：

1. `serial_trade_db_guard`：先跑 fast guard，恢复 / 防御 active flow。
2. `parallel_isolated_work`：slow 盯市、R&D、forward tracker、catalog 可并行；只有 slow 可能进入 `trade-db` 写区。
3. `serial_review_closeout`：若上游产生闭合 flow，再串行 review 封口；fallback sweep 只补漏。

subagent 只做上下文隔离和并行，不是新的事实源。主控和 subagent 之间只通过 JSON 输出、DB、artifact、catalog、strategy 文件交换信息。

## 慢轨 / 快轨交互

| 维度 | 慢轨 | 快轨 |
| --- | --- | --- |
| 频率 | 1H / 4H 级 | 5m / 15m 级 |
| 角色 | 战略层：thesis、direction、risk、action_intent | orchestrator only：执行守护、防御补救、轻量对账 |
| 写 observe | full observe | light observe，继承慢轨 thesis / risk / intent |
| 可发起动作 | 全集，经 preflight | 白名单：`cancel_order`、`sync_protection`、`no_action`、慢轨 trigger 授权的 entry / reduce |
| 对账范围 | 全量账户 / flow 恢复 | 当前 flow 轻量账户和 symbol-scoped 订单 |

两轨完全通过 `plan_event` 通信：

```text
slow observe writes thesis + action_intent + trigger_condition
  -> fast reads latest slow observe
  -> fast checks trigger / current orders / current position / guards
  -> fast may write light observe + order_fill
  -> slow later reads fast order_fill and light observe
```

快轨不重新判断“市场是否值得交易”，也不修改 thesis、invalidation、risk budget、ladder。微观结构若真有 edge，应沉淀成确定性 guard 或新策略，不放在快轨 LLM 黑盒判断里。

## 在线交易 Flow

### 1. Observe Flow

```text
market scan / symbol snapshot / account snapshot
  -> build observe
  -> reconcile if needed
  -> append plan_event(kind='observe')
```

OBSERVE 只构建事实快照和候选，不直接下单。全市场扫描只能回答“先看谁”，单标的 setup 判断和 action intent 必须回到 trade-flow。

### 2. Plan And Preflight Flow

```text
latest observe.action_intent
  -> trigger_condition check
  -> account / current orders / position projection
  -> preflight hard guards
  -> armable / blocked / abstain
```

`plan-preflight` 是 EXECUTE 前最后一道只读闸。任何 `target_action != no_action` 的动作都应先被 preflight 收敛。

### 3. Execution Flow

```text
armable preflight
  -> execution_contract_snapshot
  -> order preview
  -> execution skill
  -> exchange result
  -> append plan_event(kind='order_fill')
```

真实写接口：

- 主单：`binance-order-place`
- 保护腿：`binance-position-protect`
- 减仓 / 全平：`binance-position-adjust`
- 撤单：`binance-order-cancel`

所有真钱写动作必须显式授权；没有 `--yes` 的 live-small 路径必须拒绝。

### 4. Recovery / Reconcile Flow

```text
local plan_event reduce
  -> account snapshot with history
  -> compare current_orders / current_position
  -> reconcile draft
  -> apply reconcile only if can_reconcile=true + --yes
```

无法可靠归属的订单 / 仓位差异进入 `unmatched`，流程 abort，不继续 EXECUTE。

### 5. Review Flow

```text
closed flow
  -> review event
  -> execution attribution
  -> strategy diagnostics
  -> possible strategy evidence / policy iteration
```

review 在交易写入和对账之后串行执行。它不是即时交易判断，而是把 setup、事实、执行、成本、regime、hard guard 归因写回迭代链。

## R&D 和验证 Flow

### Strategy R&D Supervisor

R&D 不是单次实验按钮，而是受预算约束的学习 loop：

```text
rd_program_state
  -> plan_next
  -> strategy-rnd-loop / strategy-rnd-campaign
  -> artifact + catalog + R&D ledger
  -> state writeback
  -> next hypothesis
  -> shadow_candidate_found / budget_exhausted / data_or_tool_blocked
```

关键入口：

- `--rd-program-state`：init / read / update / plan_next durable learning memory。
- `--rd-supervisor-run`：执行 `plan_next -> loop/campaign -> state writeback` 的自主循环。
- `--strategy-rnd-loop`：一轮 batch + artifact + catalog ledger。
- `--strategy-rnd-campaign`：多 hypothesis discovery + non-overlapping validation。
- `--strategy-data-split`：开研前切 discovery / validation / locked_holdout，保留 embargo。
- `--strategy-panel-rnd`：跨至少 3 个资产做候选广度和 null control。

`rd_program_state` 保存 objective、budget、usage、latest failure、reliability gate、rejected mechanisms、universe lessons、next hypothesis queue、artifact refs。它是 research memory，不是 strategy evidence。

### Replay / Evidence / Promotion

```text
strategy or candidate
  -> replay / locked holdout / robustness / null controls
  -> append strategy evidence
  -> strategy-review
  -> strategy-promote dry-run
  -> strategy status update only with --yes
```

状态语义：

- `draft`：只能研究。
- `shadow`：可记录影子动作，不提交 Binance。
- `live-small`：小资金实盘资格。
- `paused`：只允许观察和减风险。

`draft -> shadow` 必须有 fresh replay、locked holdout / walk-forward、样本、成本、robustness 和 anti-overfit 证据。`shadow -> live-small` 还需要 fresh shadow 样本与 execution attribution。

### Forward / Shadow Tracker

```text
frozen candidate / paper signal
  -> forward holdout
  -> rd-shadow-tracker
  -> open_setup / observe_setup[] / close_setup / review_setup
  -> review input
```

R&D tracker 产物只是 review 输入，不等同 strategy evidence，不允许直接升格。

## Catalog / Artifact Hygiene Flow

```text
artifact produced
  -> register in data_catalog.db
  -> referenced by run / evidence / rd_program_state
  -> catalog query / stale report
  -> catalog-gc only with --yes
```

普通 artifact GC 是文件扫描式；catalog GC 是 catalog-aware。`.pin`、被引用资产、durable store 必须保留。

## Master / Subagent 信息交互

主控给 subagent 的最小信息：

- job id、role、cadence / due reason
- permission boundary
- allowed commands
- input refs：DB path、catalog path、state path、strategy path、artifact refs
- expected output schema

subagent 回传：

- machine-readable JSON result
- artifact refs / DB write refs
- skipped / blocked reason
- warnings
- supervisor summary fragment

禁止事项：

- 不通过口头总结传递长期事实。
- 不让 subagent 自行扩大权限。
- 不让 R&D subagent 写 `trade.db` 或触发 Binance。
- 不让交易 subagent 把 research artifact 当成 execution fact。

## 常用 CLI 入口

仓库级检查：

```bash
scripts/quality-check.sh
```

trade-flow 主入口：

```bash
cd .agents/skills/trade-flow
bun ./scripts/main.ts --help
```

初始化事件库：

```bash
bun ./scripts/main.ts --db ./data/trade.db --init
```

生成单入口 supervisor plan：

```bash
bun ./scripts/main.ts --db ./data/trade.db --automation-cycle --json '{"slow_interval_minutes":240}'
```

R&D learning memory：

```bash
bun ./scripts/main.ts --rd-program-state --state ./data/rd/program.json --json '{"action":"init","objective":"find a shadow-eligible 4H swing strategy"}'
bun ./scripts/main.ts --rd-supervisor-run --state ./data/rd/program.json --json '{"max_iterations":10}'
```

单 skill 检查：

```bash
cd .agents/skills/trade-flow
bun install
bun run check
```

Go 指标 skill：

```bash
cd .agents/skills/tech-indicators
go test ./...
```

具体改动域要跑哪些最小检查，以 [docs/check-contract.md](docs/check-contract.md) 为准。

## 安全边界

- 真实 Binance 写操作必须显式带 `--yes`。
- 写操作前必须完成 preview / preflight / execution contract 收敛。
- `profile/trading-config.json` 可默认允许 `live-small`，但不绕过执行闸门。
- dry-run、preview、replay、calibration、R&D 默认不触发真实下单。
- 凭证不写入仓库；API key、通知 token、chat id 等只从环境变量读取。
- Automation memory 路径统一用 `scripts/automation-memory-path.sh <automation-id>` 解析。
- Python 命令统一用 `scripts/resolve-python.sh` 解析，不假设 `python` 存在。
- 交易所事实和 reconcile 失败可以覆盖本地乐观状态。

## 文档导航

`README.md` 是全局地图，不替代契约文档。深入时按这个顺序看：

- [docs/vision.md](docs/vision.md)：为什么做
- [docs/prd.md](docs/prd.md)：做什么、边界和产品口径
- [docs/design-architecture.md](docs/design-architecture.md)：单入口、双轨、subagent、数据模型和调度设计
- [docs/tech-spec.md](docs/tech-spec.md)：实现口径和 schema
- [docs/trading-config.md](docs/trading-config.md)：统一交易配置与 runtime policy
- [docs/check-contract.md](docs/check-contract.md)：改动后的最小检查
- [docs/code-quality.md](docs/code-quality.md)：质量与品位线
- [docs/user-story.md](docs/user-story.md)：用户场景
- [docs/chat-history.md](docs/chat-history.md)：高价值决策素材

## 当前状态

已经具备：

- Binance USDM observe / account recovery / execution skills
- trade-flow event stream、dry-run、shadow、live-small、reconcile
- single automation entry + supervisor plan + subagent fan-out 契约
- slow / fast 双轨口径
- replay、strategy evidence、review、promotion gate
- R&D campaign、panel、calibration、learning memory、autonomous R&D supervisor loop
- artifact catalog、GC、quality check、通知 fallback

仍保持克制：

- 不做交易 SaaS / UI / 多账户 / 跨交易所
- 不做无界策略搜索
- 不把 R&D artifact 当交易事实
- 不把单段漂亮回测直接升实盘
- 不让快轨 LLM 做不可复现的质性市场判断
