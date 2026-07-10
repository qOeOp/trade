# Crypto Trade Workspace

agent-native 加密交易工作仓库。目标是让 agent 在可审计事实、权限边界、执行契约、交易所回读和研究记忆之上，推进 Binance USDM 4H+ swing 的观察、研发、验证、执行、恢复和复盘。

先看图，再看表。README 是全局地图；细节契约看 `docs/`。

## 1. 全局架构

```mermaid
flowchart TD
  A["single automation entry<br/>或 user takeover"] --> B["trade-flow supervisor"]
  B --> C["cadence / lock / concurrency / permission gate"]
  C --> D["subagent fan-out"]

  D --> F["fast_track_guard<br/>active flow 守护"]
  D --> S["slow_track_market_watch<br/>live 策略盯市"]
  D --> R["rd_strategy_supervisor<br/>新策略 R&D"]
  D --> T["rd_forward_shadow_trackers<br/>forward / paper 样本跟踪"]
  D --> V["closed_flow_review_sweep<br/>闭合交易复盘"]
  D --> G["catalog_hygiene_scan<br/>artifact / catalog 保洁"]

  F --> DB[("trade.db<br/>plan_event")]
  S --> DB
  V --> DB

  R --> ART["research artifacts"]
  R --> CAT[("data_catalog.db")]
  R --> STATE["rd_program_state"]
  T --> ART
  T --> CAT
  G --> CAT

  DB --> B
  CAT --> B
  STATE --> B
  ART --> B

  B --> Z["supervisor summary"]
```

一句话：外部只有一个长期入口；入口只生成任务图和权限边界；具体工作交给隔离 subagent；长期事实必须落到 DB、artifact、catalog、strategy 文件或 R&D state。

## 2. 两条主链

```mermaid
flowchart LR
  subgraph Online["在线交易链"]
    O["OBSERVE"] --> P["PLAN + preflight"]
    P --> E["EXECUTE"]
    E --> W["order_fill / reconcile"]
    W --> RV["REVIEW"]
  end

  subgraph Research["离线验证链"]
    RD["research / review"] --> RP["replay / backtest"]
    RP --> SH["shadow / forward"]
    SH --> LS["live-small / paused"]
    LS --> RV2["review"]
    RV2 --> RD
  end

  RP -. "promotion evidence" .-> LS
  RV -. "strategy diagnostics" .-> RD
```

在线链只处理真实机会和交易事实；研究链只处理 edge 发现、验证和准入。研究链不能直接写 `trade.db`，也不能触发 Binance 写接口。

## 3. 单入口怎么分发

```mermaid
flowchart TD
  A["automation wakeup"] --> B["--automation-cycle"]
  B --> C{"cadence due?"}
  C -->|fast always considered| F["fast_track_guard"]
  C -->|slow due| S["slow_track_market_watch"]
  C -->|R&D due + state active| R["rd_strategy_supervisor"]
  C -->|tracker due| T["rd_forward_shadow_trackers"]
  C -->|catalog due| G["catalog_hygiene_scan"]
  C -->|closed flow found| V["closed_flow_review_sweep"]

  F --> CG1["concurrency group: trade-db"]
  S --> CG1
  V --> CG1

  R --> CG2["concurrency group: research-rd"]
  T --> CG3["isolated artifact job"]
  G --> CG4["isolated catalog job"]

  CG1 --> OUT["JSON result + DB refs"]
  CG2 --> OUT
  CG3 --> OUT
  CG4 --> OUT
  OUT --> SUM["supervisor summary"]
```

固定执行顺序：

```text
1. serial_trade_db_guard
   -> fast guard 先恢复 / 防御 active flow

2. parallel_isolated_work
   -> slow / R&D / tracker / catalog 可并行
   -> 只有 slow 可能进入 trade-db 写区

3. serial_review_closeout
   -> 若有新闭合 flow，再串行 review
```

## 4. 数据怎么存

```mermaid
flowchart TD
  subgraph TradeFacts["在线交易事实"]
    DB[("data/trade.db")]
    PE["plan_event"]
    OBS["observe"]
    OF["order_fill"]
    REV["review"]
    DB --> PE
    PE --> OBS
    PE --> OF
    PE --> REV
  end

  subgraph ResearchFacts["研究与准入事实"]
    CAT[("data/data_catalog.db")]
    STRAT["strategies/*.md<br/>Trade Contract"]
    OHLCV["OHLCV manifest"]
    FEAT["feature report"]
    ART["research artifacts"]
    EVD["strategy evidence"]
    STATE["rd_program_state"]
    CAT --> OHLCV
    CAT --> ART
    CAT --> EVD
    STRAT --> EVD
    STATE --> ART
  end

  subgraph External["外部事实"]
    BIN["Binance exchange facts"]
  end

  BIN --> DB
  BIN --> OHLCV
  OBS --> OF
  REV --> EVD
  EVD --> STRAT
```

事实优先级：

```text
Binance exchange facts
  > trade.db event stream
  > strategy evidence / catalog / artifact
  > rd_program_state / automation memory
  > natural-language summary
```

## 5. 核心对象关系

```mermaid
flowchart TD
  STR["strategy<br/>规则模板"] --> SETUP["setup<br/>可验证交易机会"]
  SETUP --> LANE["lane<br/>strategy_ref + symbol + side"]
  LANE --> FLOW["flow<br/>一笔机会 / 暴露生命周期"]
  FLOW --> EV["plan_event chain"]
  EV --> OBS["observe"]
  EV --> OF["order_fill"]
  EV --> REV["review"]
```

同一 lane 同时最多一个 active flow。新理由、新结构、新加一段都并回当前 active flow，不并行开多个风险拥有者。

## 6. 慢轨和快轨怎么交互

```mermaid
sequenceDiagram
  participant Slow as slow_track_market_watch
  participant DB as trade.db / plan_event
  participant Fast as fast_track_guard
  participant Pre as preflight / guards
  participant Exe as execution skills
  participant Binance as Binance

  Slow->>DB: write full observe<br/>thesis + risk + action_intent + trigger_condition
  Fast->>DB: read latest slow observe
  Fast->>Pre: check trigger / current orders / current position / hard guards
  alt trigger and guards pass
    Fast->>Exe: execute allowed action
    Exe->>Binance: write only with permission
    Binance-->>Exe: exchange result
    Fast->>DB: write light observe + order_fill
  else blocked or stale
    Fast->>DB: write light observe when useful, otherwise skip
  end
  Slow->>DB: later reads fast facts and continues flow
```

| 维度 | 慢轨 | 快轨 |
| --- | --- | --- |
| 角色 | 战略层：thesis、方向、风险、action intent | orchestrator only：执行守护、防御补救、轻量对账 |
| observe | full observe | light observe，继承慢轨 thesis / risk / intent |
| 动作 | 全集，经 preflight | 白名单：撤单、同步保护、no_action、慢轨 trigger 授权动作 |
| 判断 | 可做 setup / thesis 判断 | 不做质性市场判断 |

## 7. 在线交易 Flow

```mermaid
flowchart TD
  A["market scan / symbol snapshot / account snapshot"] --> B["build observe"]
  B --> C["append observe"]
  C --> D["latest observe.action_intent"]
  D --> E{"trigger_condition hit?"}
  E -->|no| SKIP["skip"]
  E -->|yes| F["preflight hard guards"]
  F -->|blocked / abstain| BO["record blocked or skip"]
  F -->|armable| G["execution_contract_snapshot"]
  G --> H["order preview"]
  H --> I["execution skill"]
  I --> J["exchange result"]
  J --> K["append order_fill"]
  K --> L["flow closed?"]
  L -->|yes| M["append review"]
  L -->|no| C
```

真钱执行写口：

| 动作 | Skill |
| --- | --- |
| 主单开仓 / 加仓 | `binance-order-place` |
| 止损 / 止盈 / trailing | `binance-position-protect` |
| 减仓 / 全平 | `binance-position-adjust` |
| 撤单 | `binance-order-cancel` |

任何新增风险动作都必须有 fresh facts、stop / invalidation / risk budget、preflight、execution contract 和 reconcile。

## 8. Recovery / Reconcile Flow

```mermaid
flowchart TD
  A["read local plan_event"] --> B["reduce current flow state"]
  B --> C["account snapshot with symbol history"]
  C --> D{"facts match local state?"}
  D -->|yes| E["continue"]
  D -->|clear gap| F["reconcile draft"]
  F --> G{"can_reconcile + --yes?"}
  G -->|yes| H["append source=reconcile order_fill"]
  G -->|no| I["return draft only"]
  D -->|unmatched| X["abort / needs_review"]
```

交易所事实覆盖本地乐观状态。无法可靠归属的订单 / 仓位差异必须停，不继续执行。

## 9. R&D 学习飞轮

```mermaid
flowchart TD
  STATE["rd_program_state<br/>objective / budget / lessons / queue"] --> PLAN["plan_next"]
  PLAN --> RUN{"next command"}
  RUN -->|loop| LOOP["--strategy-rnd-loop"]
  RUN -->|campaign| CAMP["--strategy-rnd-campaign"]
  LOOP --> ART["artifact + catalog + R&D ledger"]
  CAMP --> ART
  ART --> FB["failure_summary / reliability_gate / validated_candidate"]
  FB --> UP["state writeback"]
  UP --> DECIDE{"terminal?"}
  DECIDE -->|shadow candidate| DONE["shadow_candidate_found"]
  DECIDE -->|budget exhausted| BUD["budget_exhausted"]
  DECIDE -->|blocked| BLK["data_or_tool_blocked"]
  DECIDE -->|still active| NEXT["generate constrained next hypothesis"]
  NEXT --> STATE
```

高阶入口：

```bash
bun ./scripts/main.ts --rd-supervisor-run --state ./data/rd/program.json --json '{"max_iterations":10}'
```

低阶入口：

| 命令 | 作用 |
| --- | --- |
| `--rd-program-state` | init / read / update / plan_next durable learning memory |
| `--strategy-rnd-loop` | 一轮 batch + artifact + catalog ledger |
| `--strategy-rnd-campaign` | 多 hypothesis discovery + non-overlapping validation |
| `--strategy-data-split` | 切 discovery / validation / locked_holdout |
| `--strategy-panel-rnd` | 跨资产广度和 null control |

`rd_program_state` 是 research memory，不是 strategy evidence。

## 10. Strategy 升格状态机

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> shadow: fresh replay + locked holdout + robustness gate
  shadow --> live_small: fresh replay + fresh shadow + execution attribution
  live_small --> paused: decay / review blocker / risk policy
  shadow --> paused: review blocker
  paused --> draft: rewrite policy
  draft --> draft: R&D / replay only
```

升格规则：

- `draft` 只能研究。
- `shadow` 可记录影子动作，不提交 Binance。
- `live-small` 才能小资金实盘。
- `paused` 只允许观察和减风险。
- `strategy-promote` 默认 dry-run；改 status 必须显式 `--yes`。

## 11. Catalog / Artifact Hygiene

```mermaid
flowchart LR
  A["artifact produced"] --> B["register data_catalog.db"]
  B --> C["referenced by run / evidence / rd_program_state"]
  C --> D["catalog query / stale report"]
  D --> E{"catalog-gc --yes?"}
  E -->|yes| F["delete stale unreferenced only"]
  E -->|no| G["report only"]
```

`.pin`、被引用资产、durable store 必须保留。普通 artifact GC 是文件扫描式；catalog GC 是 catalog-aware。

## 12. 模块速查

| 层 | 路径 / skill | 作用 |
| --- | --- | --- |
| 产品契约 | `docs/` | vision、PRD、架构、技术契约、检查契约 |
| 主流程 | `.agents/skills/trade-flow/` | event stream、automation、R&D、replay、review、promotion、reconcile |
| 市场观察 | `binance-market-scan` / `binance-symbol-snapshot` / `binance-aggtrades-fetch` / `binance-liquidation-zones` | 候选、单标的事实、成交材料、清算区 |
| 账户恢复 | `binance-account-snapshot` | 余额、持仓、挂单、保护单、订单历史 |
| 数据与指标 | `ohlcv-fetch` / `tech-indicators` | OHLCV、manifest、feature series、BTC beta |
| 执行 | `binance-order-preview` / `plan-preflight` / order skills | preview、hard guards、下单、保护、减仓、撤单 |
| 策略资产 | `strategies/` | strategy policy + `## Trade Contract` |
| 运行数据 | `data/` / `tmp/` | DB、catalog、OHLCV、artifact、cache |
| 配置 | `profile/` | trading config、通知配置；凭证来自环境变量 |

## 13. Master / Subagent 信息交换

```mermaid
sequenceDiagram
  participant M as supervisor
  participant A as subagent
  participant DB as DB / artifact / catalog / state

  M->>A: job id + role + permission + allowed commands + input refs
  A->>DB: read/write only allowed assets
  DB-->>A: machine-readable facts
  A-->>M: JSON result + refs + skipped/blocked reason + warnings
  M->>M: merge summaries and decide next dispatch
```

禁止：

- 不通过口头总结传递长期事实。
- 不让 subagent 自行扩大权限。
- 不让 R&D subagent 写 `trade.db` 或触发 Binance。
- 不让交易 subagent 把 research artifact 当成 execution fact。

## 14. 常用入口

```bash
# 仓库级检查
scripts/quality-check.sh

# trade-flow help
cd .agents/skills/trade-flow
bun ./scripts/main.ts --help

# 初始化在线事件库
bun ./scripts/main.ts --db ./data/trade.db --init

# 生成单入口 supervisor plan
bun ./scripts/main.ts --db ./data/trade.db --automation-cycle --json '{"slow_interval_minutes":240}'

# 初始化并运行 R&D supervisor
bun ./scripts/main.ts --rd-program-state --state ./data/rd/program.json --json '{"action":"init","objective":"find a shadow-eligible 4H swing strategy"}'
bun ./scripts/main.ts --rd-supervisor-run --state ./data/rd/program.json --json '{"max_iterations":10}'
```

## 15. 安全边界

- 真实 Binance 写操作必须显式带 `--yes`。
- 写操作前必须完成 preview / preflight / execution contract。
- dry-run、preview、replay、calibration、R&D 默认不触发真实下单。
- 凭证不写入仓库；API key、通知 token、chat id 等只从环境变量读取。
- Automation memory 路径统一用 `scripts/automation-memory-path.sh <automation-id>` 解析。
- Python 命令统一用 `scripts/resolve-python.sh` 解析，不假设 `python` 存在。
- 交易所事实和 reconcile 失败可以覆盖本地状态。

## 16. 文档导航

- [docs/vision.md](docs/vision.md)：为什么做
- [docs/prd.md](docs/prd.md)：做什么、边界和产品口径
- [docs/design-architecture.md](docs/design-architecture.md)：单入口、双轨、subagent、数据模型和调度设计
- [docs/tech-spec.md](docs/tech-spec.md)：实现口径和 schema
- [docs/trading-config.md](docs/trading-config.md)：统一交易配置与 runtime policy
- [docs/check-contract.md](docs/check-contract.md)：改动后的最小检查
- [docs/code-quality.md](docs/code-quality.md)：质量与品位线
- [docs/user-story.md](docs/user-story.md)：用户场景
- [docs/chat-history.md](docs/chat-history.md)：高价值决策素材

## 17. 当前状态

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
