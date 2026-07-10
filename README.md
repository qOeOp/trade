# Crypto Trade Workspace

agent-native 加密交易工作仓库。目标是让 agent 在可审计事实、权限边界、执行契约、交易所回读和研究记忆之上，推进 Binance USDM 4H+ swing 的观察、研发、验证、执行、恢复和复盘。

先看图，再看表。README 只保留一张全局结构图；细节契约看 `docs/`。

## 1. 全局架构

```mermaid
flowchart TB
  subgraph CHIP["Crypto Trade Workspace - single automation chip"]
    direction TB

  subgraph PINS["00 External input pins"]
    direction LR
    USER["user takeover"]
    CRON["automation wakeup"]
    RECOVERY["manual recovery"]
  end

  subgraph CORE["01 Supervisor core"]
    direction TB
    ENTRY["single automation entry<br/>trade-flow --automation-cycle"]
    SUP["supervisor planner<br/>plan jobs + merge results"]
    CLOCK["cadence gate<br/>slow / fast / R&D / hygiene"]
    LOCK["lock + concurrency matrix<br/>trade-db serial / research isolated"]
    PERM["permission gate<br/>dry-run by default / --yes for writes"]
    DISPATCH["subagent fan-out bus<br/>job id + role + allowed refs"]
  end

  subgraph JOBS["02 Job lanes"]
    direction LR

    subgraph ONLINE["A Online trade lane"]
      direction TB
      SLOW["slow_track_market_watch<br/>full observe + thesis"]
      FAST["fast_track_guard<br/>active flow guard"]
      ACTIVE["active flow state<br/>one lane owner"]
      RECON["recovery / reconcile<br/>exchange facts override local"]
    end

    subgraph RESEARCH["B Research lane"]
      direction TB
      RD["new strategy R&D<br/>autonomous hypothesis loop"]
      SCOUT["R&D scout subagents<br/>history / data / edge"]
      SHADOW["shadow / forward validation<br/>paper sample tracker"]
      PANEL["panel + null control<br/>breadth sanity check"]
    end

    subgraph LEARNING["C Learning lane"]
      direction TB
      REVIEW["closed-flow review<br/>post-trade attribution"]
      PROMO["strategy promotion<br/>draft -> shadow -> live-small -> paused"]
      LESSON["lessons / blocked hypotheses<br/>next constraints"]
    end

    subgraph OPS["D Ops hygiene lane"]
      direction TB
      HYGIENE["catalog / artifact hygiene<br/>stale scan + GC"]
      NOTIFY_JOB["notify dispatch<br/>operator alerts"]
      QUALITY["quality check<br/>tests / typecheck / contracts"]
    end
  end

  subgraph CAP["03 Capability banks"]
    direction LR

    subgraph OBSERVE_BANK["Observe bank"]
      direction TB
      MARKET["binance-market-scan"]
      SYMBOL["binance-symbol-snapshot"]
      AGG["binance-aggtrades-fetch"]
      ZONES["binance-liquidation-zones"]
      ACCOUNT["binance-account-snapshot"]
    end

    subgraph DATA_BANK["Data + indicator bank"]
      direction TB
      OHLCV_FETCH["ohlcv-fetch"]
      TECH["tech-indicators<br/>feature series / support / beta"]
      SPLIT["strategy-data-split<br/>discovery / validation / holdout"]
    end

    subgraph RD_BANK["R&D bank"]
      direction TB
      RD_STATE["rd-program-state<br/>plan_next / writeback"]
      RD_LOOP["strategy-rnd-loop"]
      RD_CAMP["strategy-rnd-campaign"]
      RD_PANEL["strategy-panel-rnd"]
    end

    subgraph EXEC_BANK["Execution bank"]
      direction TB
      PREVIEW["binance-order-preview"]
      PREFLIGHT["plan-preflight<br/>hard guards + decision card"]
      PLACE["binance-order-place"]
      PROTECT["binance-position-protect"]
      ADJUST["binance-position-adjust"]
      CANCEL["binance-order-cancel"]
    end

    subgraph GOV_BANK["Governance bank"]
      direction TB
      EVIDENCE["strategy evidence"]
      REPLAY["replay / backtest"]
      REVIEW_TOOL["review reducers"]
      CATALOG_TOOL["catalog query / stale / gc"]
    end
  end

  subgraph SAFETY["04 Permission and isolation walls"]
    direction LR
    NO_WRITE["real Binance write<br/>requires explicit --yes"]
    RD_WALL["R&D wall<br/>no trade.db writes / no Binance writes"]
    SUB_WALL["subagent wall<br/>allowed commands + refs only"]
    SERIAL_DB["trade-db serial zone<br/>fast / slow / review"]
    PIN_RULE["artifact retention<br/>.pin + referenced assets survive"]
  end

  subgraph STORE["05 Durable fact stores and object model"]
    direction LR

    subgraph TRADE_STORE["Trade facts"]
      direction TB
      TRADEDB[("data/trade.db")]
      PLAN_EVENT["plan_event stream"]
      OBS["observe"]
      FILL["order_fill"]
      REVIEW_EVENT["review"]
      TRADEDB --> PLAN_EVENT --> OBS
      PLAN_EVENT --> FILL
      PLAN_EVENT --> REVIEW_EVENT
    end

    subgraph RESEARCH_STORE["Research facts"]
      direction TB
      CATDB[("data/data_catalog.db")]
      OHLCV["data/ohlcv<br/>manifest + candles"]
      ART["tmp/artifacts<br/>research / run outputs"]
      RDSTATE["state/rd<br/>program memory"]
      STRAT["strategies/*.md<br/>Trade Contract + status"]
      TMP["tmp<br/>cache / panels / market snapshots"]
    end

    subgraph OBJECTS["Trading object chain"]
      direction TB
      STRATEGY["strategy"]
      SETUP["setup"]
      LANE["lane<br/>strategy + symbol + side"]
      FLOW["flow<br/>one exposure lifecycle"]
      EVENT_CHAIN["plan_event chain"]
      STRATEGY --> SETUP --> LANE --> FLOW --> EVENT_CHAIN
    end

    PROFILE["profile<br/>trading / notify config"]
  end

  subgraph EXCHANGE["06 Exchange IO"]
    direction LR
    BINREAD["Binance read APIs<br/>prices / klines / account"]
    BINWRITE["Binance write APIs<br/>orders / protection / cancel"]
  end

  subgraph FEEDBACK["07 Feedback buses"]
    direction LR
    SUMMARY["supervisor summary"]
    EVIDENCE_BUS["promotion evidence<br/>replay + shadow + attribution"]
    REVIEW_BUS["strategy diagnostics<br/>closed-flow review"]
    RD_BUS["R&D writeback<br/>failure summary + next hypothesis"]
    NEXT["next wakeup constraints<br/>what to run / what to avoid"]
  end
  end

  USER --> ENTRY
  CRON --> ENTRY
  RECOVERY --> ENTRY
  ENTRY --> SUP --> CLOCK --> LOCK --> PERM --> DISPATCH

  DISPATCH --> FAST
  DISPATCH --> SLOW
  DISPATCH --> SHADOW
  DISPATCH --> RD
  DISPATCH --> REVIEW
  DISPATCH --> HYGIENE
  DISPATCH --> NOTIFY_JOB
  DISPATCH --> QUALITY

  FAST --> ACTIVE
  FAST --> RECON
  FAST --> ACCOUNT
  FAST --> PREFLIGHT
  FAST --> PREVIEW
  FAST --> CANCEL
  FAST --> PROTECT
  SLOW --> MARKET
  SLOW --> SYMBOL
  SLOW --> AGG
  SLOW --> ZONES
  SLOW --> ACCOUNT
  SLOW --> PREFLIGHT
  SLOW --> ACTIVE

  RD --> SCOUT
  RD --> RD_STATE
  RD --> RD_LOOP
  RD --> RD_CAMP
  RD --> TECH
  RD --> OHLCV_FETCH
  RD --> PANEL
  SCOUT --> SPLIT
  SHADOW --> REPLAY
  SHADOW --> TECH
  SHADOW --> OHLCV_FETCH
  PANEL --> RD_PANEL
  REVIEW --> REVIEW_TOOL
  REVIEW --> EVIDENCE
  PROMO --> EVIDENCE
  PROMO --> REPLAY
  LESSON --> RD_STATE
  HYGIENE --> CATDB
  HYGIENE --> ART
  HYGIENE --> CATALOG_TOOL
  NOTIFY_JOB --> TMP

  MARKET --> BINREAD
  SYMBOL --> BINREAD
  AGG --> BINREAD
  ZONES --> BINREAD
  ACCOUNT --> BINREAD
  OHLCV_FETCH --> BINREAD
  TECH --> OHLCV
  PREVIEW --> BINREAD
  PLACE --> BINWRITE
  PROTECT --> BINWRITE
  ADJUST --> BINWRITE
  CANCEL --> BINWRITE

  PREFLIGHT --> NO_WRITE
  PLACE --> NO_WRITE
  PROTECT --> NO_WRITE
  ADJUST --> NO_WRITE
  CANCEL --> NO_WRITE
  RD --> RD_WALL
  SCOUT --> SUB_WALL
  DISPATCH --> SUB_WALL
  FAST --> SERIAL_DB
  SLOW --> SERIAL_DB
  REVIEW --> SERIAL_DB
  HYGIENE --> PIN_RULE

  ACTIVE --> FLOW
  FLOW --> PLAN_EVENT
  MARKET --> TRADEDB
  SYMBOL --> TRADEDB
  ACCOUNT --> TRADEDB
  PREFLIGHT --> TRADEDB
  PREVIEW --> TRADEDB
  PLACE --> TRADEDB
  PROTECT --> TRADEDB
  ADJUST --> TRADEDB
  CANCEL --> TRADEDB
  RECON --> TRADEDB
  RD_STATE --> RDSTATE
  RD_LOOP --> CATDB
  RD_LOOP --> ART
  RD_CAMP --> CATDB
  RD_CAMP --> ART
  RD_PANEL --> CATDB
  RD_PANEL --> ART
  OHLCV_FETCH --> OHLCV
  TECH --> ART
  SPLIT --> ART
  REPLAY --> ART
  EVIDENCE --> CATDB
  EVIDENCE --> STRAT
  CATALOG_TOOL --> CATDB

  PROFILE --> ENTRY
  STRAT --> SLOW
  STRAT --> SHADOW
  STRAT --> RD
  STRAT --> STRATEGY
  EVENT_CHAIN --> PLAN_EVENT
  OHLCV --> TECH
  CATDB --> HYGIENE
  TRADEDB --> REVIEW
  TRADEDB --> FAST
  RDSTATE --> RD_STATE

  TRADEDB --> SUMMARY
  CATDB --> SUMMARY
  ART --> SUMMARY
  FILL --> REVIEW_BUS
  REVIEW_EVENT --> REVIEW_BUS
  REVIEW_BUS --> LESSON
  ART --> EVIDENCE_BUS
  EVIDENCE_BUS --> PROMO
  RDSTATE --> RD_BUS
  RD_BUS --> LESSON
  SUMMARY --> NEXT
  LESSON --> NEXT
  PROMO --> NEXT
  NEXT --> SUP

  classDef pin fill:#eef6ff,stroke:#6aa3d8,color:#111;
  classDef core fill:#f6f0ff,stroke:#9467bd,color:#111;
  classDef job fill:#fff7e8,stroke:#d9902f,color:#111;
  classDef cap fill:#edf9f0,stroke:#4c9a5f,color:#111;
  classDef wall fill:#fff0f0,stroke:#cc4b4b,color:#111;
  classDef store fill:#f7f7f7,stroke:#777,color:#111;
  classDef io fill:#eefafc,stroke:#3b95a3,color:#111;
  classDef fb fill:#f5f7ff,stroke:#5968c9,color:#111;
  class USER,CRON,RECOVERY pin;
  class ENTRY,SUP,CLOCK,LOCK,PERM,DISPATCH core;
  class FAST,SLOW,ACTIVE,RECON,RD,SCOUT,SHADOW,PANEL,REVIEW,PROMO,LESSON,HYGIENE,NOTIFY_JOB,QUALITY job;
  class MARKET,SYMBOL,AGG,ZONES,ACCOUNT,OHLCV_FETCH,TECH,SPLIT,RD_STATE,RD_LOOP,RD_CAMP,RD_PANEL,PREVIEW,PREFLIGHT,PLACE,PROTECT,ADJUST,CANCEL,EVIDENCE,REPLAY,REVIEW_TOOL,CATALOG_TOOL cap;
  class NO_WRITE,RD_WALL,SUB_WALL,SERIAL_DB,PIN_RULE wall;
  class TRADEDB,PLAN_EVENT,OBS,FILL,REVIEW_EVENT,CATDB,OHLCV,ART,RDSTATE,STRAT,TMP,STRATEGY,SETUP,LANE,FLOW,EVENT_CHAIN,PROFILE store;
  class BINREAD,BINWRITE io;
  class SUMMARY,EVIDENCE_BUS,REVIEW_BUS,RD_BUS,NEXT fb;
```

一句话：外部只有一个长期入口；入口只生成任务图和权限边界；具体工作交给隔离 subagent；长期事实必须落到 DB、artifact、catalog、strategy 文件或 R&D state。

## 2. 两条主链

在线链只处理真实机会和交易事实；研究链只处理 edge 发现、验证和准入。研究链不能直接写 `trade.db`，也不能触发 Binance 写接口。

## 3. 单入口怎么分发

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

事实优先级：

```text
Binance exchange facts
  > trade.db event stream
  > strategy evidence / catalog / artifact
  > rd_program_state / automation memory
  > natural-language summary
```

## 5. 核心对象关系

同一 lane 同时最多一个 active flow。新理由、新结构、新加一段都并回当前 active flow，不并行开多个风险拥有者。

## 6. 慢轨和快轨怎么交互

| 维度 | 慢轨 | 快轨 |
| --- | --- | --- |
| 角色 | 战略层：thesis、方向、风险、action intent | orchestrator only：执行守护、防御补救、轻量对账 |
| observe | full observe | light observe，继承慢轨 thesis / risk / intent |
| 动作 | 全集，经 preflight | 白名单：撤单、同步保护、no_action、慢轨 trigger 授权动作 |
| 判断 | 可做 setup / thesis 判断 | 不做质性市场判断 |

## 7. 在线交易 Flow

真钱执行写口：

| 动作 | Skill |
| --- | --- |
| 主单开仓 / 加仓 | `binance-order-place` |
| 止损 / 止盈 / trailing | `binance-position-protect` |
| 减仓 / 全平 | `binance-position-adjust` |
| 撤单 | `binance-order-cancel` |

任何新增风险动作都必须有 fresh facts、stop / invalidation / risk budget、preflight、execution contract 和 reconcile。

## 8. Recovery / Reconcile Flow

交易所事实覆盖本地乐观状态。无法可靠归属的订单 / 仓位差异必须停，不继续执行。

## 9. R&D 学习飞轮

高阶入口：

```bash
bun .agents/skills/trade-flow/scripts/main.ts --rd-supervisor-run --state ./state/rd/program.json --json '{"max_iterations":10}'
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

升格规则：

- `draft` 只能研究。
- `shadow` 可记录影子动作，不提交 Binance。
- `live-small` 才能小资金实盘。
- `paused` 只允许观察和减风险。
- `strategy-promote` 默认 dry-run；改 status 必须显式 `--yes`。

## 11. Catalog / Artifact Hygiene

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
bun .agents/skills/trade-flow/scripts/main.ts --help

# 初始化在线事件库
bun .agents/skills/trade-flow/scripts/main.ts --db ./data/trade.db --init

# 生成单入口 supervisor plan
bun .agents/skills/trade-flow/scripts/main.ts --db ./data/trade.db --automation-cycle --json '{"slow_interval_minutes":240,"rd_program_state_path":"./state/rd/program.json"}'

# 初始化并运行 R&D supervisor
bun .agents/skills/trade-flow/scripts/main.ts --rd-program-state --state ./state/rd/program.json --json '{"action":"init","objective":"find a shadow-eligible 4H swing strategy"}'
bun .agents/skills/trade-flow/scripts/main.ts --rd-supervisor-run --state ./state/rd/program.json --json '{"max_iterations":10}'
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
