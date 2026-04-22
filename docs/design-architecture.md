# Design Architecture

## 系统概览

### 产品形态

一组运行在 agent 工作区里的 skill，通过 Claude Code / Codex / Gemini CLI 调用。不做独立 app。持久化层是数据库，不是 agent 工作区记忆。

### 主链路

```
在线主线：OBSERVE <-> PLAN -> EXECUTE -> REVIEW
离线演化：REVIEW -> BACKTEST -> ITERATE -> STRATEGY-POOL
```

核心流转图（含并行 PLAN-CHAIN 和研究侧）：

```mermaid
flowchart LR
  subgraph INPUT["输入来源"]
    U["用户消息"]
    M["市场语境<br/>OHLCV / 宏观 / 快讯"]
    A["账户事实<br/>持仓 / 挂单 / 成交"]
    X["外部研究输入"]
  end

  subgraph ONLINE["在线主线（可并行多条 PLAN-CHAIN）"]
    R["INTENT ROUTER"]

    subgraph PC1["PLAN-CHAIN（展开）"]
      O1["OBSERVE<br/>补齐 checklist"]
      P1["PLAN<br/>生成下一个 plan block"]
      S1["plan.status<br/>noop / wait-condition<br/>ready-execute / abandon"]
      E1["EXECUTE<br/>挂单 / 撤单 / 改单 / 平仓"]
      F1["wait-until-fill<br/>partial-fill / filled"]
      V1["REVIEW"]

      O1 --> P1 --> S1
      S1 -->|条件未到| O1
      S1 -->|ready-execute| E1
      E1 --> F1
      F1 -->|账户事实变化| O1
      F1 -->|阶段性闭合| V1
      S1 -->|放弃| V1
    end
  end

  subgraph RESEARCH["研究与沉淀侧"]
    D1["主 agent 研究调度"]
    B1["BACKTEST"]
    I1["ITERATE"]
    SP["STRATEGY-POOL"]
    D1 --> B1 --> I1 --> SP
  end

  U --> R --> O1
  M --> O1
  A --> O1
  A --> E1
  X --> D1
  V1 --> D1
  SP -.当前语境下读取.-> P1
```

### 核心长期容器

| 容器 | 内含 | 说明 |
| --- | --- | --- |
| `PLAN-POOL` | PLAN-CHAIN[] | 每条 chain 是一个交易机会的决策历史（plan + plan_history） |
| `STRATEGY-POOL` | strategy[] | 策略资产，离线演化结果；MVP 扁平结构，远期 namespace + 微策略两层（详见离线演化侧） |

PLAN-CHAIN 不是独立实体。每个 `plan` 记录代表一个机会的完整生命周期，其决策演化历史存于 `plan_history`，关联的监控记录存于 `plan_check` 和 `rule_evaluation`。跨机会的并行关联（如对冲链）通过 `parent_plan_keys` 引用。

**跨链 exposure 视图**：PLAN-POOL 层需聚合所有 `status` 为活跃态（`wait-condition / ready-execute / wait-until-fill / in-position`）的链，计算整体方向性暴露。对冲锁仓场景中，对冲链通过 `parent_plan_keys` 引用被对冲链，PLAN-POOL 视图可据此做净值计算，识别真正的净方向敞口。单个 plan 不感知其他链，跨链聚合由调用层（OBSERVE 或 REVIEW）负责。

### Skill 分层

详细结构见 [skill-layout.md](skill-layout.md)。

整个 trade 系统按两层 skill 切分，互不替代：

| 层 | 形态 | 例子 | 职责 |
| --- | --- | --- | --- |
| **套件 skill**（agent 编排层） | `trade-flow` 一个套件，内部 `stages/observe/plan/execute/review/backtest/iterate` | 仅一个：`trade-flow` | 主线流转、router、数据库读写、调用功能 skill |
| **功能 skill**（原子动作层） | 平铺单一职责 skill | `binance-*` / `ohlcv-fetch` / `tech-indicators` / `binance-market-scan` | 一件事做好（拉数据 / 下单 / 算指标），可被套件内任意 stage 调用 |

套件内 `SKILL.md` 是轻量入口（router + 各 stage 简介），各 `stages/X/STAGE.md` 按需读取，避免一次性吞 token。

文件数据库 `./data/trade.db`（SQLite），承接本节"数据库存储"定义的 schema。

---

## Plan 设计

### 核心约束

- `plan` 是可变记录，`plan_key` 为 uuid，贯穿整个机会生命周期不变
- **决策性变化**（thesis / entry / stop / targets / status / scope 变化）：更新 plan 当前状态，同时写一条 `plan_history` 快照，附 `change_summary`
- **监控性变化**（心跳检查 / 成交回填 / management_rule 触发）：直接更新 plan 对应字段或写伴随表，不写 `plan_history`
- `plan_history` 是可追溯的决策日志；`plan` 本身始终是最新状态，agent 直接读写
- plan 写入数据库前必须通过 [Plan 写入校验](#plan-写入校验) 列出的 hardcode 规则；违反则 plan 不能保存

### 七块顶层结构

| 块 | 包含 | 变化频率 | 主要读者 |
| --- | --- | --- | --- |
| **SYSTEM** | identity / lineage | 每版都写 | agent 追链时读 |
| **WHY** | thesis / edge_type / regime / setup_ref / confluence / conviction / counter_thesis | 中 | 人 + agent |
| **WHAT** | scope / side / entry / stop / targets / invalidation / atr_ref / indicator_trust / timing_validity / max_holding_duration / expected_rr / risk_budget / account_guardrails / liquidation_ref / key_risks / management_rules | 中 | 人 + agent |
| **EXPOSURE** | leg_role / net_after_fill / second_order_risk / existing_legs / correlation_cluster / cluster_net_exposure | 高（账户事实变化即更新） | agent + 人 |
| **POSITION_ROLE** | role / time_horizon / size_intent | 极低 | 人 + agent |
| **EXECUTION_LANE** | order_type / visibility / tif / client_order_prefix / execution_result | 低 | agent |
| **NOW** | status / state_reason / next_check / outcome | 高 | agent |

SYSTEM 层由系统自动生成，正常阅读跳过，只有追溯链路或校验时才看。

### 字段字典

#### SYSTEM

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `plan_key` | 是 | string | uuid，机会生命周期内不变 |
| `version` | 是 | integer | 决策性变化时递增；初始为 1 |
| `created_at` | 是 | RFC 3339 | 首次创建时间 |
| `updated_at` | 是 | RFC 3339 | 最近一次决策性更新时间 |
| `parent_plan_keys` | 否 | string[] | 跨机会关联（如对冲场景）；单链写 `[]` |

#### WHY（为什么这是个机会）

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `thesis` | 是 | string | 一句话核心判断；能压成一句说明思路清晰，压不下去说明自己没想清楚 |
| `edge_type` | 是 | enum | `technical / sentiment-contrarian / order-flow / other`；归因钩子，REVIEW 时按 edge_type 聚合胜率 |
| `regime` | 是 | object | `{ [timeframe]: regime_value }`，key 必须覆盖 `scope.timeframe_scope` 所有周期；`regime_value ∈ {trending-up / trending-down / ranging / breakout / breakdown / choppy / accumulation / distribution}`；多周期冲突在此显式表达（如 `{"4h":"trending-up","1h":"ranging"}`），避免大周期一个标签掩盖小周期矛盾；index 字段 `plan.regime` 取 `timeframe_scope[0]` 对应值用于聚合 |
| `setup_ref` | 否 | object or null | `{ strategy_key: string, version: integer }`；引用 STRATEGY-POOL 中具体微策略；填了自动继承该策略的 setup_description / key_signals，confluence 不再重复 |
| `confluence` | 否 | string[] | 独立确认维度，最多 5 条；与 `setup_ref` 二选一或互补 |
| `conviction` | 是 | integer | 0-10 信号清晰度/执行信心综合分；与 `win_probability` 互补——conviction 答"我多确信这是个 setup"，win_probability 答"事前胜率多少"，两者拆开避免单一分数被情绪拉高 |
| `win_probability` | 是 | number | 0-1，事前胜率估计；与 `expected_rr` 共同决定期望值（见 R-014），防止"RR 漂亮但胜率太低"的负期望入场；REVIEW 阶段用 `signal_accuracy` 回测校准 |
| `counter_thesis` | 是 | string | 一句话"逻辑层认错触发器"，区别于 `invalidation` 的价格触发；回答"什么发生会让我承认这个思路整个错了"，如"BTC 周线跌破 EMA50 即认定主升浪结束" |

#### WHAT（具体怎么做）

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `scope` | 是 | object | `{ venue, market_type, symbols, mode, timeframe_scope }`；`market_type` = `spot / usdm / coinm / mixed`；`mode` = `flat / pending-entry / in-position / hedged / monitor-only`；`timeframe_scope` 大→小排列如 `["4h","1h","15m"]` |
| `side` | 是 | enum | `buy / sell / long / short / reduce-long / reduce-short / flat` |
| `entry` | 是 | object | `{ price: number \| zone: {low, high}, type: market/limit/stop, qty: {type, value, leverage?} }`；qty.type = `qty / usdt / risk_pct / acct_pct`；USDM 必填 leverage，spot 写 null |
| `stop` | 是 | object | `{ price: number, basis: "mark" \| "last" }`；永续合约必须 `mark`（见 R-001） |
| `targets` | 是 | object[] | 每条 `{ price, qty_pct, trigger?: string }`；`qty_pct` 累计可 ≤ 1（剩余跟趋势） |
| `invalidation` | 是 | object | `{ hard: string, soft?: string, expires_at?: RFC3339, expires_after?: ISO duration }`；hard 触发即 replan，soft 下次 check 重评；超时视为 hard 触发 |
| `atr_ref` | 是 | object | `{ atr: number, timeframe: string, percentile?: number }`；强制锚定，禁止裸价差止损（见 R-003） |
| `indicator_trust` | 是 | enum | `full / degraded / k-line-only`；高波动妖币上自动 degraded，提示"本轮基于裸 K" |
| `timing_validity` | 是 | string | ISO duration，如 `PT15M`（高波动）/ `PT4H`（主流币）；入场窗口过期视为 hard 失效 |
| `max_holding_duration` | 条件必填 | string or null | ISO duration，如 `P1D` / `P3D` / `P2W`；`scope.mode ∈ {pending-entry, in-position}` 必填；到期未出场触发强制平仓 replan，防止短线拖成套牢（见 R-010） |
| `expected_rr` | 是 | object | `{ ratio: number, net_ratio: number, fee_pct: number, slippage_pct: number, slippage_basis: enum, expected_value: number, funding_pct_per_day?: number }`；`slippage_basis ∈ {orderbook-depth / atr-based / recent-fills / fixed-assumption}`；`net_ratio` 必须扣除预期 fee / slippage / funding；`expected_value = win_probability × net_ratio - (1 - win_probability)`（单位 R），必须 > 0（见 R-014）；永续合约必填 `funding_pct_per_day`（见 R-008）；市价类订单禁止 `slippage_basis = fixed-assumption`（见 R-015） |
| `risk_budget` | 是 | object | `{ max_loss_usdt?: number, max_loss_pct?: number, max_position_usdt?: number }`；三者填一即可 |
| `account_guardrails` | 是 | object | `{ max_day_loss_pct?: number, max_open_risk_pct_after_fill?: number, max_correlated_exposure_usdt?: number, max_consecutive_losses?: integer }`；账户级闸门，不回答"这笔亏多少"，而回答"这笔做完后今天还能不能继续打"；`max_consecutive_losses` 超限由 PLAN-POOL 层拦截新 plan 生成（跨链状态，非单 plan 校验） |
| `liquidation_ref` | 条件必填 | object or null | `{ liq_price?: number, buffer_pct?: number }`；`market_type ∈ {usdm, coinm}` 且方向性持仓时必填；用于显式检查 stop 到 liquidation 之间是否仍有缓冲 |
| `key_risks` | 是 | string[] | 当前主要风险；funding 极端必须列出（见 R-006） |
| `management_rules` | 否 | object[] | 仓位存活期的条件性动作，结构见下 |

`management_rules[]` 每条：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `rule_key` | 是 | plan 内唯一 |
| `rule_type` | 是 | `move-stop / breakeven / trail-activate`；分批减仓统一走 `targets[]`，management_rules 只负责持仓中风控参数调整 |
| `trigger_condition` | 是 | 自然语言触发条件 |
| `trigger_price` | 否 | 有价格锚点时填，纯条件触发写 null |
| `action_description` | 是 | 触发后做什么 |
| `status` | 是 | `pending / triggered / skipped` |
| `triggered_at` | 否 | 触发时间（RFC 3339） |
| `priority` | 是 | integer，同一 plan 内 rule 激活优先级；数字越小越先，同值按 `rule_key` 字典序 |
| `depends_on` | 否 | string[]，前置 `rule_key` 列表；只有所有前置 status=triggered 才激活本 rule（如 trail-activate 必须依赖 breakeven 先触发） |

`management_rules` 按 `priority` + `depends_on` 有序激活。`status` 和 `triggered_at` 是监控性字段，OBSERVE 直接更新，不写 plan_history。每次 OBSERVE 检查 rule 时写一条 `rule_evaluation` 记录，保留完整评估历史。`targets[]` 负责所有分批出场（固定价格 + 比例），`management_rules` 只负责持仓中风控参数调整（move-stop / breakeven / trail-activate），两者职责严格不交叉——同一个减仓动作绝不会两处都能写。

同一次 check 若 `targets` 与 `management_rules` 同时命中，统一按**保护优先**处理：`hard stop / 强平风险规避 > reduce-only 出场 > partial-exit target > move-stop > trail`。同层内仍按 `priority` + `rule_key` 决定顺序，避免“既想先止盈又想先抬止损”的歧义。

#### EXPOSURE（在组合里什么角色）

chat-history 反复证明这是单笔 plan 最易漏的维度。锁仓多腿场景下，单看自己腿做决策必踩坑。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `leg_role` | 是 | enum | `main / hedge / reduce-loss / disaster-cover / probe`；本笔在多腿组合里扮演什么 |
| `net_after_fill` | 是 | object | `{ symbol_net: { [symbol]: number }, account_net_usdt: number }`；本笔成交后账户净敞口（见 R-002） |
| `second_order_risk` | 否 | string or null | 对冲/锁仓场景：如果某条腿先成交，净敞口会怎么变 |
| `existing_legs` | 是 | object[] | 当前同标的其他活跃腿：`[{plan_key, side, qty, role}]`；空仓写 `[]` |
| `correlation_cluster` | 是 | enum | `btc-beta / eth-eco / stable / meme / independent / other`；相关性簇标签，用于跨 symbol 聚合同向敞口（防止"开 BTC + SOL + DOGE 三个多，自以为分散，实则同一注"） |
| `cluster_net_exposure` | 是 | object | `{ same_cluster_usdt: number, direction_bias: "long" \| "short" \| "neutral" }`；同簇其他活跃腿本笔成交后的累计净敞口；揭示看似分散实则同注的隐形重复下注 |
| `portfolio_context` | 是 | object | `{ daily_realized_pnl_pct?: number, open_risk_pct?: number, correlated_exposure_usdt?: number, free_cash_usdt?: number, consecutive_losses?: integer }`；给 PLAN 一个账户视角，避免单笔 RR 正常但组合已过载；`consecutive_losses` 接近 `account_guardrails.max_consecutive_losses` 时 PLAN 应降 `size_intent` 或转 probe |

#### POSITION_ROLE（这笔在打法里什么定位）

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `role` | 是 | enum | `offensive / defensive / hedge / probe`；进攻仓 / 防守仓 / 对冲 / 试探仓 |
| `time_horizon` | 是 | enum | `intraday / swing / position`；预期持仓时间 |
| `size_intent` | 是 | enum | `full / half / probe`；信念浓度，REVIEW 时归因不会被 size 模糊化（probe 仓亏不算真错） |

#### EXECUTION_LANE（执行通道）

chat-history 大量摔在执行路径不一致上（普通 LIMIT vs STOP_MARKET vs Algo Order vs OTOCO）。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `order_type` | 是 | enum | `limit / market / stop_market / stop_limit / algo / oto / otoco` |
| `visibility` | 是 | enum | `full / mother-only / manual-confirm`；OTOCO 子单不可见时必须 `mother-only`（见 R-007） |
| `tif` | 否 | enum or null | `GTC / IOC / FOK / GTX`；null 默认 GTC；`GTX` = post-only；`FOK` 不适用于 USDM |
| `margin_mode` | 条件必填 | enum or null | `cross / isolated / null`；永续合约必填，现货写 null |
| `position_mode` | 条件必填 | enum or null | `one-way / hedge / null`；永续合约必填，避免 plan 和账户实际模式错位 |
| `protection_flags` | 否 | object or null | `{ reduce_only?: boolean, close_position?: boolean, working_type?: "mark" \| "last", price_protect?: boolean }`；所有保护单语义显式写出，不靠默认值猜 |
| `client_order_prefix` | 否 | string | 统一前缀，便于验单 / 局部撤单 / 计划续管 |
| `execution_result` | 否 | object or null | 执行回填：`{ filled_price, filled_qty, filled_at, actual_slippage_pct }`；plan 生成时为 null |

#### NOW（当前状态）

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `status` | 是 | enum | 见下方状态机 |
| `state_reason` | 是 | string | 为什么落在这个状态 |
| `next_check` | 是 | string | 下次回来先看什么；未闭合问题以 `?` 开头 |
| `outcome` | 否 | object or null | 仅 `closed` 时填：`{ entry_avg, exit_avg, pnl_pct, note? }` |

### Plan 写入校验

**校验哲学：防爆仓，不防思考。** 校验目标是拦住真会亏钱的硬错，不是把 agent 逼成填字游戏。规则按严重度分两层：

- **`reject`**：真会爆仓或结构性踩坑（永续止损取值源、预检缺失、liquidation 缓冲、OTOCO 可见性等）。违反直接拒写，必须修复。
- **`warn-ack`**：默认拒写，但允许 agent 带理由显式放行（写入 `rule_acknowledgements`）。用于"多数情况应遵守，但存在合理例外"的规则——如结构化止损（非 ATR 锚定）、scalp 忽略 funding、position trade 无明确时限、承认无法估胜率等。

**为什么要这样分层**：硬规则全开等于告诉 agent"填满字段就能入场"。agent 会倒推数字凑通过（比如 `win_probability` 为凑 EV > 0 往上虚估），记录的"决策"反而被污染。warn-ack 机制让 agent 要么遵守，要么**显式写出为什么破例**——判断可追溯，REVIEW 阶段能按 rule_id 聚合"明知故犯"的胜率，数据说话再决定升降级。

**Acknowledgement 纪律**：`warn-ack` 放行不是万能通行证：
1. 每次 ack 必须带**具体**理由，不是"ack"二字
2. 同一 `rule_id` 在单个机会生命周期内累计 ack 超过 3 次，升级为 reject（说明这个 setup 压根就是边缘情况）
3. REVIEW 阶段按 `rule_id` 聚合 ack 后的胜率；某规则被 ack 的样本胜率长期低于整体，说明该规则对这类 agent/市场应固化为 reject

| ID | 规则 | 严重度 | 触发条件 | 校验 |
| --- | --- | --- | --- | --- |
| **R-001** | 永续止损必须 mark price | reject | `market_type ∈ {usdm, coinm}` 且 `stop` 存在 | `stop.basis === "mark"` |
| **R-002** | 多腿持仓必须算 net_after_fill | reject | `existing_legs` 非空 | `exposure.net_after_fill` 非 null |
| **R-003** | 止损必须有结构化依据 | warn-ack | 任何含 `stop` 的 plan | `stop.anchor === "atr"` 时 `atr_ref.atr` 非 null；`stop.anchor === "structural"` 时 `stop.structural_ref` 非空；`stop.anchor === "composite"` 两者都填。ack 场景：纯主观/心理价位止损，必须说清为何放弃结构化依据 |
| **R-004** | 单笔 risk 不超账户 max_loss_pct 上限 | reject | `entry.qty.type === "risk_pct"` | `value <= risk_budget.max_loss_pct` |
| **R-005** | USDM 进入 ready-execute 前必须执行预检 | reject | `market_type === "usdm"` 且 `status === "ready-execute"` | 关联 execution_lane 已记录预检通过 |
| **R-006** | 极端 funding 必须 key_risks 标注 | reject | funding `\|rate\|` > 0.001 | `key_risks` 中含 funding 相关条目 |
| **R-007** | OTOCO 必须标 visibility=mother-only | reject | `order_type === "otoco"` | `visibility === "mother-only"` |
| **R-008** | 永续 expected_rr 必须计入 funding | warn-ack | `market_type ∈ {usdm, coinm}` 且 `max_holding_duration >= PT4H`（跨 funding 结算） | `expected_rr.funding_pct_per_day` 非 null，且 `net_ratio` 已扣除 funding。ack 场景：持仓 < 4h 的 scalp，明示"不跨结算" |
| **R-009** | 永续执行语义必须显式 | reject | `market_type ∈ {usdm, coinm}` | `margin_mode`、`position_mode` 非 null；保护单存在时 `protection_flags` 非 null |
| **R-010** | 活跃 plan 必须有最长持仓时限 | warn-ack | `scope.mode === "in-position"` | `max_holding_duration` 非 null。ack 场景：`time_horizon === "position"` 的长期持仓，必须同时写 `next_check` 节奏（如"每周 WR 回顾"）代替硬时限 |
| **R-011** | 永续方向仓必须检查 liquidation buffer | reject | `market_type ∈ {usdm, coinm}` 且 `side ∈ {long, short}` | `liquidation_ref.buffer_pct` 非 null，且 stop 与 liq_price 之间仍有正缓冲 |
| **R-012** | `risk_budget` 字段之间必须自洽 | reject | `risk_budget` 中填了 2 个及以上字段 | `max_loss_pct × account_equity ≤ max_loss_usdt`；`max_position_usdt × stop_distance_pct ≤ max_loss_usdt`；三者互相不冲突 |
| **R-013** | 同簇累计敞口超阈值必须进 key_risks | reject | `cluster_net_exposure.same_cluster_usdt > account_guardrails.max_correlated_exposure_usdt` | `key_risks` 含相关性集中条目；防止"三个多头自以为分散" |
| **R-014** | 期望值必须为正 | warn-ack | `probability_basis !== "skip"` 的 plan | `expected_rr.expected_value = win_probability × net_ratio - (1 - win_probability) > 0`。ack 场景：(a) `probability_basis === "skip"`，明确承认无法估胜率，此时 EV 跳过；(b) probe 仓试探性入场，允许 EV 略负换信息 |
| **R-015** | 市价类订单 slippage 必须基于实测 | warn-ack | `order_type ∈ {market, stop_market}` | `expected_rr.slippage_basis !== "fixed-assumption"`。ack 场景：小额且深度充足（`usdt_size < orderbook top-level size × 0.1`），明示"深度足够忽略滑点" |

`warn-ack` 通过时，plan 写入后必须有对应 `rule_acknowledgements[]` 条目。REVIEW 阶段按 `rule_id` 聚合 ack 记录和胜率，作为规则升降级的数据基础。**未来如果规则膨胀到 20+ 条 / 需要看 stats 演化**，再独立化为 `global_rule` 表 + `rule_acknowledgement_log` 表。

### plan.status 状态机

| status | 大类 | 含义 |
| --- | --- | --- |
| `noop` | NOOP | 机会不成立或不参与 |
| `wait-condition` | 观望 | 有 setup，等市场条件；订单尚未挂出 |
| `ready-execute` | 观望→执行 | 条件满足，等用户确认 |
| `wait-until-fill` | 挂单 | 订单已挂出至交易所，等成交 |
| `partial-fill` | 挂单→监控 | 入场单部分成交；剩余挂单保留，同时对已成仓位开始监控；PLAN 决定是追单、撤余量还是维持等待 |
| `in-position` | 监控 | 仓位存活，持续 OBSERVE→PLAN 循环 |
| `abandon` | 终止 | 条件过期 / 机会消失 / 主动放弃 |
| `draft-closed` | 终止 | 计划成形但从未进入执行 |
| `closed` | 终止 | 仓位完全结束，进入 REVIEW |

### plan_check（心跳监控记录）

心跳监控不生成新 plan，写一条轻量记录：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `check_key` | 是 | uuid |
| `plan_key` | 是 | 引用当前活动 plan |
| `checked_at` | 是 | 检查时间 |
| `price_at_check` | 是 | 检查时现价（不存 K 线） |
| `orders_ok` | 是 | 挂单是否全部还在 |
| `is_still_valid` | 是 | 判断还成立吗 |
| `findings` | 否 | 有 notable 才写，否则 null |
| `triggered_replan` | 是 | 是否触发了新 plan |

只有 `is_still_valid=false` 或 `triggered_replan=true` 时才进入 PLAN 流程做决策性更新（写 `plan_history`）。

### 数据库存储

MVP 阶段用 SQLite 单文件数据库，文件路径 `./data/trade.db`（详见 [skill-layout.md](skill-layout.md)）。下方 schema 用 PostgreSQL 风格表达，SQLite 实现时 `timestamptz` 用 TEXT (ISO 8601)、`text[]` / `jsonb` 用 TEXT (JSON 字符串)。未来需要并发或服务器侧统一存储时迁 Postgres，DDL 基本不变。

```sql
-- 当前状态，agent 直接读写
create table plan (
  plan_key             text primary key,       -- uuid，生命周期内不变
  version              integer not null,        -- 决策性变化时递增
  created_at           timestamptz not null,
  updated_at           timestamptz not null,

  -- WHY（归因 + 索引）
  edge_type            text not null,           -- technical / sentiment-contrarian / order-flow / other
  regime               text not null,           -- 主周期 regime (= body_json.regime[timeframe_scope[0]])；完整多周期 regime object 存 body_json
  conviction           integer not null,        -- 0-10
  setup_ref_key        text,                    -- 引用 STRATEGY-POOL 微策略（远期）
  setup_ref_version    integer,

  -- WHAT（关键索引字段，详细在 body_json）
  venue                text not null,
  market_type          text not null,           -- spot / usdm / coinm / mixed
  side                 text not null,

  -- EXPOSURE
  leg_role             text not null,           -- main / hedge / reduce-loss / disaster-cover / probe

  -- POSITION_ROLE
  position_role        text not null,           -- offensive / defensive / hedge / probe
  time_horizon         text not null,           -- intraday / swing / position
  size_intent          text not null,           -- full / half / probe

  -- NOW
  status               text not null,
  pnl_pct              numeric,

  -- 跨机会关联
  parent_plan_keys     text[],

  -- 完整 plan body（七块结构序列化）
  body_json            jsonb not null
);

-- 决策演化日志：每次决策性变化写一条快照
create table plan_history (
  history_key    text primary key,             -- uuid
  plan_key       text not null references plan(plan_key),
  version        integer not null,             -- 对应写入时的 plan.version
  changed_at     timestamptz not null,
  change_summary text not null,                -- 这次改了什么，一句话
  snapshot_json  jsonb not null                -- 变更前的 body_json 快照
);

-- 心跳监控记录
create table plan_check (
  check_key        text primary key,
  plan_key         text not null references plan(plan_key),
  checked_at       timestamptz not null,
  price_at_check   numeric not null,
  orders_ok        boolean not null,
  is_still_valid   boolean not null,
  findings         text,
  triggered_replan boolean not null
);

-- management_rule 触发评估历史
create table rule_evaluation (
  eval_key   text primary key,                 -- uuid
  plan_key   text not null references plan(plan_key),
  rule_key   text not null,
  checked_at timestamptz not null,
  triggered  boolean not null,
  reasoning  text not null
);
```

### 追溯方式

- 读当前状态 → 直接查 `plan`
- 读决策演化历史 → 按 `plan_key` 查 `plan_history`，按 `version` 排序
- 读某次决策前的完整快照 → `plan_history.snapshot_json`
- 读某条 rule 的触发历史 → 按 `plan_key + rule_key` 查 `rule_evaluation`
- 读跨机会关联 → `plan.parent_plan_keys` → 相关 plan 记录

### 待收紧的开放 object

- `timing_validity` 已固定为 ISO 8601 duration（如 `PT15M` / `PT4H`），指**入场窗口**有效期；超时即视为 hard 失效，触发新 plan with `status=abandon`。
- `max_holding_duration` 固定为 ISO 8601 duration，指**持仓本身**的时间上限；到期触发强制平仓 replan（见 R-010），与 `timing_validity` 职责不交叉。
- `EXPOSURE.net_after_fill.symbol_net` 的 key 当前用 symbol 字符串，未来若需要跨 venue 聚合可能扩展为 `{venue, symbol}` 结构。
- `EXPOSURE.correlation_cluster` 的枚举值（`btc-beta / eth-eco / stable / meme / independent / other`）由 agent 依据标的特征判断；MVP 不维护映射表，未来样本够多时可落地为 `symbol -> cluster` 常量表，或基于价格相关系数动态分类。
- `setup_ref` 引用的 STRATEGY-POOL 微策略表结构尚未实现（详见下方 STRATEGY-POOL 章节"远期演化方向"），MVP 阶段 `setup_ref` 可为 null，confluence 直接写。
- REVIEW 产出（`what_worked / what_failed / cost_vs_expected / holding_vs_budget` 等）尚未在本节 SQL schema 中定义独立表；MVP 可先落到 `./data/trade.db` 的 `review` 表（最小列：`review_key / plan_key / reviewed_at / body_json`），结构跟随本文档 REVIEW 字段表演化。

---

## Market Data

详细设计见 [market-data-design.md](market-data-design.md)。

### 三层原则

| 层 | 职责 |
| --- | --- |
| 接入层 | 向 Binance 拉原始数据，轻度标准化，输出 JSON |
| 快照/特征层 | 压成适合日内判断的轻量摘要，按需抓取 |
| 分析层 | 结构 / 指标 / 支撑阻力，主输入是本地 OHLCV |

### Skill 分工

| Skill | 回答什么 |
| --- | --- |
| `ohlcv-fetch` | 把这个标的的多周期 K 线拉下来 |
| `binance-symbol-snapshot` | 这个标的现在大概什么状态 |
| `binance-market-scan` | 全市场先看谁（候选粗筛） |
| `tech-indicators` | 结构和指标怎么看 |
| `binance-account-snapshot` | 账户持仓 / 挂单 / 余额快照（只读） |

`binance-market-scan` 是 OBSERVE 阶段里的一个运行形态，不是独立主流程阶段。扫描器产出 shortlist，主 agent 再派发 sub-agent 做 single-symbol PLAN，plan 视角看不到 market scan。

### OHLCV 存储演进

- **当前**：`CSV + manifest.json`，增量追加，按 timestamp 去重
- **进入 replay/backtest 后**：切换到 `SQLite`，支持时间段切片和批量回测
- **不提前做**：不现在写 SQLite schema，不提前引入缓存层

---

## 离线演化侧

### 链路

```
REVIEW → BACKTEST → ITERATE → STRATEGY-POOL
```

REVIEW 是在线主线的终点，也是离线演化的入口。闭合的 PLAN-CHAIN（`status=closed`）经 REVIEW 产出结构化复盘，再进入 BACKTEST 验证假设，最终沉淀为 STRATEGY-POOL 中可复用的策略资产。

### REVIEW

REVIEW 的输入是一条完整的 PLAN-CHAIN（从 genesis 到 closed）。产出结构：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `review_key` | 是 | uuid |
| `plan_key` | 是 | 引用来源 plan |
| `reviewed_at` | 是 | RFC 3339 |
| `outcome` | 是 | `win / loss / breakeven / abandoned`；与 `plan.outcome`（NOW 块）对应 |
| `pnl_pct` | 是 | 实际盈亏百分比（相对账户权益或成本，与 outcome 记录口径一致） |
| `thesis_held` | 是 | boolean；入场判断（thesis）是否在整个持仓周期内维持成立 |
| `what_worked` | 是 | object[]；每条 `{ tag: string, description: string }`；`tag` 必须挂回结构化维度，取值形如 `edge:technical` / `rule:R-003` / `setup_ref` / `signal:<confluence项>` / `management_rule:<rule_key>`；禁止纯自由文本，避免"心态好""大盘配合"这类无法聚合的废话 |
| `what_failed` | 是 | object[]；结构同 `what_worked`；便于 REVIEW 按 tag 聚合统计"哪类 edge / 哪条 rule / 哪个信号最常失败" |
| `signal_accuracy` | 否 | object[]；每条信号（来自 plan.confluence 或 setup_ref.key_signals）的事后准确性：`{ signal: string, was_accurate: boolean, note? }` |
| `cost_vs_expected` | 是 | object；`{ expected_net_ratio: number, actual_net_ratio: number, fee_diff_pct: number, slippage_diff_pct: number, funding_total_pct: number }`；对比 plan 写入时的 `expected_rr` 与真实成本，偏差进入 ITERATE 调参 |
| `counter_thesis_triggered` | 是 | boolean；`counter_thesis` 描述的逻辑层认错触发器是否在持仓周期内实际发生 |
| `holding_vs_budget` | 是 | object；`{ planned_duration: string, actual_duration: string, hit_max_holding: boolean }`；是否触到 `max_holding_duration` 硬上限，识别"短线拖成套牢"模式 |
| `replan_count` | 是 | 本次交易产生了多少个决策版本（对应 `plan.version` 终值） |
| `key_lesson` | 是 | string；一句话核心教训，进入 STRATEGY-POOL 的候选摘要 |
| `promote_to_strategy` | 是 | boolean；是否推送到 STRATEGY-POOL |

`signal_accuracy` 让 REVIEW 阶段积累信号在特定 `(edge_type, regime)` 组合下的实际命中率，回测和 STRATEGY-POOL 演化都可按此聚合。`what_worked / what_failed` 强制结构化 `tag`，REVIEW 层可直接按 `edge_type / rule_id / signal` 做聚合统计，替代过去的自由文本回顾。

### BACKTEST

BACKTEST 是对 REVIEW 复盘中提炼的假设做历史验证。不是对整条 PLAN-CHAIN 重放，而是对"在 regime X 下，用 setup Y 做 side Z"这个命题跑历史切片。

输入：REVIEW 产出 + 本地 OHLCV（当前为 CSV，进入 backtest 阶段后迁移 SQLite，见 OHLCV 存储演进）

产出结构（存为独立记录，引用 `review_key`）：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `backtest_key` | 是 | uuid |
| `review_key` | 是 | 来源 REVIEW |
| `hypothesis` | 是 | string；被验证的假设，如"BTC 4h trending-up + RSI 回踩超卖区做多，RR≥2" |
| `regime_filter` | 是 | string；对应 plan WHY 块的 `regime` 字段 |
| `sample_count` | 是 | 回测命中的历史样本数 |
| `win_rate` | 是 | 0-1 |
| `avg_rr` | 是 | 样本平均实际奖险比 |
| `max_drawdown` | 是 | 样本内最大回撤 |
| `verdict` | 是 | `confirmed / rejected / inconclusive`；样本不足（< 10）时写 `inconclusive` |
| `notes` | 否 | string |

### STRATEGY-POOL

经 BACKTEST `verdict=confirmed` 的假设，或经多次 REVIEW 积累的高置信判断，进入 STRATEGY-POOL。PLAN 阶段的 `setup_ref` 可引用 STRATEGY-POOL 中的条目，作为决策依据之一。

#### MVP 形态

最小可用版本：每条 strategy 是一条扁平记录，agent 自由文本描述 setup，不强制结构化字段。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `strategy_key` | 是 | 代码做 key，如 `T-TRU-MAJ-001`（命名规则见远期演化） |
| `name` | 是 | 人类可读名称，如"BTC 4h 趋势回踩做多" |
| `setup_description` | 是 | 策略核心入场条件描述（自然语言） |
| `key_signals` | 是 | string[]；必要信号列表 |
| `invalidation_hints` | 是 | string[]；常见失效场景 |
| `review_count` | 是 | 累计 REVIEW 引用次数 |
| `last_updated` | 是 | RFC 3339 |
| `status` | 是 | `experimental / active / deprecated` |

`experimental`：样本不足或市场结构尚未确认；`deprecated`：历史有效但当前已失效，保留供研究；`active`：可用作 plan.setup_ref 主依据。

#### 远期演化方向

MVP 跑通积累 50+ 闭合 plan 后再展开：

1. **namespace + 微策略两层结构**：每条策略归属一个 `(edge_type, regime, symbol_class)` 三元组 namespace，namespace 内才是叶子微策略（避免一个大策略带 if-else 分支，便于按格子聚合统计）
2. **微策略代码命名**：`{edge}-{regime}-{symbol_class}-{seq}`，如 `T-TRU-MAJ-001`（technical / trending-up / major / 第一个）
3. **versioning**：REVIEW 迭代微策略时写新版本而不是覆盖（保留 v1 stats 冻结，v2 累积新 stats），plan.setup_ref 指向具体 `(strategy_key, version)`
4. **stats 字段扩展**：`win_rate / expectancy / profit_factor / max_consecutive_losses / avg_holding_time / sample_count`
5. **namespace 留空机制**：`choppy + *` 等不可交易格子允许 namespace 为空，明确表达"这种情况不打"
6. **双层归因**：REVIEW 同时按微策略和 namespace 聚合，揭示"你的钱实际从哪个格子赚来"

`symbol_class` 候选枚举：`major`（BTC / ETH）/ `alt`（市值 top 50）/ `meme`（其他）；MVP 不强制。

---

## 执行层

详细规范见 [tech-spec.md](tech-spec.md)。

### Binance USDM 核心约束

- 即使用户已给出全部参数，仍先落 PLAN 再执行
- 主单路径：`futuresOrder`；algo 单路径：`futuresCreateAlgoOrder`
- 执行前必须预检：positionSide / 精度步进 / minQty / minNotional / 当前挂单 / 可用余额
- `clientOrderId` 必须打统一前缀，便于验单、局部撤单、计划续管
- `OTO/OTOCO` 母单：公开 API 可能读不到附带 TP/SL 细节，需显式标记"需人工确认"

### 读写分离

`binance-account-snapshot` 只读，不执行动作。进入执行模式时必须显式区分当前工具是否能下单，不让用户在只读工具上空转。

---

## 当前不提前固定的内容

- 全市场扫描的统一总分公式和候选池大小
- `binance-symbol-snapshot` 是否拆出独立 `microstructure` skill
- OHLCV 进入 backtest 后的 SQLite schema
- VCP 指标的最终评分公式和 crypto 适配规则
- STRATEGY-POOL 的 namespace + 微策略两层结构（远期演化方向，详见 STRATEGY-POOL 章节）
- Plan 写入校验是否升格为独立 `global_rule` 表（条目膨胀到 20+ 时再考虑）
