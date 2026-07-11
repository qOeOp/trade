# Crypto Trade Workspace

agent-native 加密交易工作仓库。目标是让 agent 在可审计事实、权限边界、执行契约、交易所回读和研究记忆之上，推进 Binance USDM 4H+ swing 的观察、研发、验证、执行、恢复和复盘。

先看总览，再按模块看分区图。README 是全局地图；细节契约看 `docs/`。

## 1. 全局架构

```mermaid
flowchart TB
  ENTRY["single automation entry<br/>automation wakeup / user takeover"]

  subgraph SUP["trade-flow supervisor"]
    direction LR
    SP["supervisor plan<br/>read config + current facts"]
    GT["cadence / lock / concurrency<br/>permission gate"]
    FO["subagent fan-out<br/>isolated job contracts"]
    MG["merge results<br/>summary + next constraints"]
    SP --> GT --> FO --> MG
  end

  subgraph BOARD["supervisor-controlled pipeline board"]
    direction TB

    subgraph ROW1["primary pipelines"]
      direction LR
      TRADING["Trading pipeline<br/>live watch -> active guard -> execute -> reconcile"]
      RESEARCH["Research pipeline<br/>R&D -> replay / panel / split -> shadow / forward"]
    end

    subgraph ROW2["governance + ops pipelines"]
      direction LR
      GOVERNANCE["Governance pipeline<br/>closed-flow review -> promotion -> diagnostics"]
      OPS["Ops pipeline<br/>catalog hygiene -> notify -> quality"]
    end
  end

  subgraph CONTRACTS["contract substrate"]
    direction LR
    CAP["capability banks<br/>observe / data / execute / governance"]
    FACTS["durable facts<br/>trade.db / catalog / artifact / strategy / state"]
    EX["Binance IO<br/>read APIs / gated write APIs"]
    SUMMARY["supervisor summary<br/>next constraints"]
    CAP --> FACTS
    CAP --> EX --> FACTS
    FACTS --> SUMMARY
  end

  ENTRY --> SP
  FO --> TRADING
  FO --> RESEARCH
  FO --> GOVERNANCE
  FO --> OPS
  TRADING --> CAP
  RESEARCH --> CAP
  GOVERNANCE --> CAP
  OPS --> CAP
  SUMMARY -. "next wakeup constraints" .-> MG

  classDef entry fill:#102a43,stroke:#102a43,color:#fff;
  classDef sup fill:#efe7ff,stroke:#7a55c7,color:#111;
  classDef flow fill:#fff3d8,stroke:#d9902f,color:#111;
  classDef block fill:#f7f7f7,stroke:#666,color:#111;
  classDef io fill:#e8f8fb,stroke:#358b9a,color:#111;
  class ENTRY entry;
  class SP,GT,FO,MG sup;
  class TRADING,RESEARCH,GOVERNANCE,OPS flow;
  class CAP,FACTS,SUMMARY block;
  class EX io;
```

一句话：外部只有一个长期入口；`trade-flow supervisor` 负责生成任务图、执行节奏/锁/权限闸、分发隔离 subagent、合并结果并写回下一轮约束；具体 flow 只通过能力层和持久事实层交换信息。

全局 flow 清单：

| Flow | 归属 | 作用 |
| --- | --- | --- |
| `live opportunity watch` | 交易 | 慢轨盯市，生成 full observe、thesis、trigger |
| `active flow guard` | 交易 | 快轨守护 active flow，处理触发、防御、轻量对账 |
| `plan / preflight / execute` | 交易 | 预演、hard guards、真实下单写口 |
| `recovery / reconcile` | 交易 | 用交易所事实修正本地状态 |
| `new strategy R&D` | 研究 | 自主提假设、scout、验证，直到 shadow candidate / blocked / budget exhausted |
| `shadow / forward validation` | 研究 | 影子交易和 forward 样本跟踪 |
| `replay / panel / data split` | 研究 | 回放、切分、跨标的 panel、anti-overfit evidence |
| `closed-flow review` | 治理 | 闭合交易复盘，生成 attribution 与诊断 |
| `strategy promotion` | 治理 | `draft -> shadow -> live-small -> paused` 准入 |
| `catalog / artifact hygiene` | 运维 | artifact 注册、stale scan、GC |
| `notify + quality` | 运维 | 通知 fallback、测试、typecheck、契约检查 |

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
  A["automation wakeup / user takeover"] --> B["--automation-cycle"]
  B --> C["supervisor plan"]
  C --> D["cadence / lock / concurrency / permission gate"]

  D --> F["fast_track_guard<br/>serial trade-db guard"]
  D --> S["slow_track_market_watch"]
  D --> R["new strategy R&D"]
  D --> T["shadow / forward trackers"]
  D --> V["closed-flow review"]
  D --> G["catalog / artifact hygiene"]

  F --> OUT["JSON result + refs"]
  S --> OUT
  R --> OUT
  T --> OUT
  V --> OUT
  G --> OUT
  OUT --> SUM["supervisor summary + next constraints"]
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
flowchart LR
  subgraph Exchange["交易所事实"]
    BIN["Binance read / write result"]
  end

  subgraph Trade["在线交易事实"]
    DB[("data/trade.db")]
    PE["plan_event"]
    OBS["observe"]
    FILL["order_fill"]
    REV["review"]
    DB --> PE
    PE --> OBS
    PE --> FILL
    PE --> REV
  end

  subgraph Research["研究与准入事实"]
    CAT[("data/data_catalog.db")]
    OHLCV["data/ohlcv"]
    ART["tmp/artifacts"]
    STATE["data/rd"]
    STRAT["strategies/*.md"]
    CAT --> OHLCV
    CAT --> ART
    STATE --> ART
    ART --> STRAT
  end

  BIN --> DB
  BIN --> OHLCV
  REV --> ART
  STRAT --> DB
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
  EV --> FILL["order_fill"]
  EV --> REV["review"]
```

同一 lane 同时最多一个 active flow。新理由、新结构、新加一段都并回当前 active flow，不并行开多个风险拥有者。

## 6. 慢轨和快轨怎么交互

```mermaid
sequenceDiagram
  participant Slow as slow_track_market_watch
  participant DB as trade.db
  participant Fast as fast_track_guard
  participant Pre as preflight
  participant Exe as execution tools
  participant Binance as Binance

  Slow->>DB: full observe + thesis + trigger_condition
  Fast->>DB: read latest active flow
  Fast->>Pre: check trigger / orders / position / hard guards
  alt trigger hit and guards pass
    Fast->>Exe: allowed action only
    Exe->>Binance: write only with --yes
    Binance-->>Exe: exchange result
    Fast->>DB: light observe + order_fill
  else blocked or stale
    Fast->>DB: light observe or skip
  end
```

| 维度 | 慢轨 | 快轨 |
| --- | --- | --- |
| 角色 | 战略层：thesis、方向、风险、action intent | orchestrator only：执行守护、防御补救、轻量对账 |
| observe | full observe | light observe，继承慢轨 thesis / risk / intent |
| 动作 | 全集，经 preflight | 白名单：撤单、同步保护、no_action、慢轨 trigger 授权动作 |
| 判断 | 可做 setup / thesis 判断 | 不做质性市场判断 |

## 7. 在线交易 Flow

真钱执行写口：

| 动作 | Tool |
| --- | --- |
| 主单开仓 / 加仓 | `binance-order-place` |
| 止损 / 止盈 / trailing | `binance-position-protect` |
| 减仓 / 全平 | `binance-position-adjust` |
| 撤单 | `binance-order-cancel` |

任何新增风险动作都必须有 fresh facts、stop / invalidation / risk budget、preflight、execution contract 和 reconcile。

## 8. Recovery / Reconcile Flow

交易所事实覆盖本地乐观状态。无法可靠归属的订单 / 仓位差异必须停，不继续执行。

## 9. R&D 学习飞轮

```mermaid
flowchart TD
  STATE["rd_program_state<br/>objective / budget / lessons / queue"] --> PLAN["plan_next"]
  PLAN --> SCOUT["read-only scout subagents<br/>history / data / edge"]
  SCOUT --> RUN{"next research command"}
  RUN -->|loop| LOOP["--strategy-rnd-loop"]
  RUN -->|campaign| CAMP["--strategy-rnd-campaign"]
  RUN -->|panel| PANEL["research.panel-evaluator"]
  LOOP --> ART["artifact + catalog ledger"]
  CAMP --> ART
  PANEL --> ART
  ART --> FB["failure summary / reliability gate / candidate"]
  FB --> UP["state writeback"]
  UP --> DECIDE{"terminal?"}
  DECIDE -->|shadow candidate| DONE["shadow_candidate_found"]
  DECIDE -->|budget exhausted| BUD["budget_exhausted"]
  DECIDE -->|blocked| BLK["data_or_tool_blocked"]
  DECIDE -->|still active| NEXT["constrained next hypothesis"]
  NEXT --> STATE
```

高阶入口：

```bash
bun modules/research/rd-supervisor/src/scripts/main.ts --state ./data/rd/program.json --json '{"max_iterations":10}'
```

低阶入口：

| 命令 | 作用 |
| --- | --- |
| `research.rd-program-state` | init / read / update / plan_next durable learning memory |
| `research.candidate-batch` | bounded candidate evaluation + negative controls |
| `--strategy-rnd-loop` | 一轮 batch + artifact + catalog ledger |
| `--strategy-rnd-campaign` | 多 hypothesis discovery + non-overlapping validation |
| `research.data-split` | 切 discovery / validation / locked_holdout |
| `research.panel-evaluator` | 跨资产广度和 negative control |
| `research.rd-shadow-tracker` | forward / paper setup event chain tracker |

`rd_program_state` 是 research memory，不是 strategy evidence。

## 10. Strategy 升格状态机

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> shadow: replay + locked holdout + robustness gate
  shadow --> live_small: fresh shadow + execution attribution
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

`.pin`、被引用资产、durable store 必须保留。普通 artifact GC 是文件扫描式；catalog GC 是 catalog-aware。

## 12. 模块速查

| 层 | 路径 / tool | 作用 |
| --- | --- | --- |
| 产品契约 | `docs/` | vision、PRD、架构、技术契约、检查契约 |
| 主流程 | `modules/trade-flow/` | event stream、automation、observe、execution、reconcile |
| 研究 | `modules/research/strategy-rd/` + `modules/research/rd-program-state/` + `modules/research/rd-shadow-tracker/` + `modules/research/replay-runner/` + `modules/research/data-split/` + `modules/research/benchmark-runner/` + `modules/research/calibration-suite/` | R&D、RD memory、panel、benchmark、calibration、forward tracker、单策略 replay、holdout split |
| 策略契约 | `modules/contracts/strategy-contract/` + `modules/research/strategy-contract-*` | strategy contract 解析、compile、lint |
| 治理 | `modules/governance/strategy-review/` | evidence、review、promotion |
| 资产治理 | `modules/ops/artifact-catalog/` | catalog、artifact stale scan、GC |
| 市场观察 | `modules/binance/market-scan` / `modules/binance/symbol-snapshot` / `modules/binance/aggtrades-fetch` / `modules/binance/liquidation-zones` | 候选、单标的事实、成交材料、清算区 |
| 账户恢复 | `modules/binance/account-snapshot` | 余额、持仓、挂单、保护单、订单历史 |
| 数据与指标 | `modules/ohlcv-fetch` / `modules/analytics/tech-indicators` | OHLCV、manifest、feature series、BTC beta |
| 执行 | `modules/binance/order-preview` / `modules/guards/plan-preflight` / Binance write modules | preview、hard guards、下单、保护、减仓、撤单 |
| 策略资产 | `strategies/` | strategy policy + `## Trade Contract` |
| 运行数据 | `data/` / `tmp/` | DB、catalog、OHLCV、artifact、cache |
| 配置 | `profile/` | trading config、通知配置；凭证来自环境变量 |

## 13. Master / Subagent 信息交换

```mermaid
sequenceDiagram
  participant M as supervisor
  participant A as subagent
  participant S as store

  M->>A: job id + role + permission + allowed commands + input refs
  A->>S: read/write allowed assets only
  S-->>A: machine-readable facts
  A-->>M: JSON result + refs + blocked/skipped reason + warnings
  M->>M: merge results and plan next dispatch
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
bun modules/trade-flow/src/scripts/main.ts --help

# 初始化在线事件库
bun modules/trade-flow/src/scripts/main.ts --db ./data/trade.db --init

# 生成单入口 supervisor plan
bun modules/trade-flow/src/scripts/main.ts --db ./data/trade.db --automation-cycle --json '{"slow_interval_minutes":240,"rd_program_state_path":"./data/rd/program.json"}'

# 初始化并运行 R&D supervisor
bun modules/research/rd-program-state/src/scripts/main.ts --state ./data/rd/program.json --json '{"action":"init","objective":"find a shadow-eligible 4H swing strategy"}'
bun modules/research/rd-supervisor/src/scripts/main.ts --state ./data/rd/program.json --json '{"max_iterations":10}'
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

- Binance USDM observe / account recovery / execution tools
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
