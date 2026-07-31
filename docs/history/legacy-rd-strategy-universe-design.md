---
title: Legacy RD Strategy Universe Design
role: historical-contract
status: legacy-reference
owner: research-strategy-development
last_verified: 2026-07-22 CST
taxonomy_status: frozen
implementation_owner: apps/research-strategy-development/research-control-plane/state-store
machine_backlog: docs/research/strategy/strategy-universe-family-backlog.json
p0_certificates: docs/research/strategy/strategy-universe-p0-family-certificates.json
---

# Legacy RD Strategy Universe Design

> 本文保留 taxonomy、DDL、pipeline 和迁移方案形成过程，不再作为当前执行入口。当前合同见 [RD Strategy Universe](../research/strategy/rd-strategy-universe-design.md)，机器 backlog 与 certificates 才是 family 覆盖事实。

结论：RD 域需要三层最小长期资产，而不是一棵越挂越乱的策略树或一套泛研究平台。

1. `Strategy Universe`：静态研究地图，只回答“什么现象可能付钱”。
2. `Research Pipeline`：动态证明链，回答“如何把现象证明成可交易策略”。
3. `Research Knowledge Graph`：长期学习记忆，记录 canonical、hypothesis、feature、forecast、signal、experiment、decision、lesson 的关系。

最大原则：**Universe 描述收益来源和市场机制；Pipeline 描述研究、建模、组合、风控和执行；Knowledge Graph 让 Planner 不重复挖已失败的矿。**

产品边界：本设计只服务 Binance USDM `4H+ swing` 的 setup 级 `replay -> shadow -> live-small -> review` 闭环。RD 最多产出 `shadow_candidate` 和 gated strategy draft；`live-small` 仍由 strategy governance、人工确认和执行 preflight 决定。Universe 可以面向长期研究空间，当前实现不得据此膨胀成自动策略挖矿或平台化 strategy pool。

本文定义 Research Control Plane，不定义 Replay Execution Plane 内部：market-event ordering、bar 内成交顺序、order/fill model、funding/margin ledger、position accounting、point-in-time join、walk-forward split 与 metrics definition 必须在独立实现设计中解决，不能从本文 schema 推断。candidate freeze 后随新数据到达形成 paper/forward evidence 的第三个 Plane 固定命名为 `Forward Evidence Plane`，目录名为 `forward-evidence-plane/`；其内部合同同样不由本文定义，也不等同正式 Shadow。RD 域目标一级目录固定为 `research-control-plane/`、`replay-execution-plane/`、`forward-evidence-plane/` 与 `agent-roles/`；后者仅为 `planner/`、`developer/`、`reviewer/` 角色入口占位，不是第四个 Plane，不新增权威事实源。

本文是 RD 策略宇宙、研究流程、agent 入口纪律、coverage/backlog 语义的唯一 Markdown 设计文档。`docs/research/strategy/strategy-universe-family-backlog.json` 和 `docs/research/strategy/strategy-universe-p0-family-certificates.json` 是机器可读派生资产，不再另设 taxonomy / designer Markdown。

从本版起 Strategy Universe L0-L3 主干冻结；后续只允许通过带理由的 seed migration 增删节点，不再因实现细节改 taxonomy。

实现状态：Research Control Plane 已落地 owner schema/commands、默认 seed、两类 contract validator、versioned identity hash、Trial/Result/Review/Lifecycle/KG 事务与 invariant tests。Replay Execution Plane 仍通过 immutable contract、trial reservation、append-only result 三个边界接入；本文不声明其内部语义已经成熟。

## 1. Static Strategy Universe

```text
L0 Strategy Universe
  L1 Edge / Return Driver
    L2 Mechanism Family
      L3 Canonical Strategy
```

| 层 | 含义 | 示例 | 禁止混入 |
| --- | --- | --- | --- |
| L0 Universe | 全部可研究 edge 空间的根节点 | `strategy-universe` | experiment / strategy policy |
| L1 Edge / Return Driver | 收益来源、风险溢价、结构性交易动因或市场域 | Trend, Carry, Forced Flow, DeFi Native | ML 模型、组合算法、执行方式 |
| L2 Mechanism Family | 可复用市场机制家族 | Funding Carry, Price Dislocation Reversion | 指标、参数、资产白名单 |
| L3 Canonical Strategy | 稳定机制模板，供 agent 生成假说 | `crowded-funding-unwind` | `positive-funding alt unwind with risk guard` |

L3 canonical 允许包含：

- market mechanism
- participant behavior
- payoff source

L3 canonical 禁止包含：

- asset filter
- indicator threshold
- parameter
- risk guard
- execution route
- portfolio weighting

`positive funding + OI rising + VFI weak + alt only + risk guard` 属于 Hypothesis / Feature / Position / Risk，不属于 Universe。L3 应尽量稳定：

```text
Carry / Funding Carry / Crowded Funding Unwind
Trend / Breakout Continuation / Channel Breakout
Mean Reversion / Reference-Price Reversion / VWAP Reversion
Forced Flow / Liquidation Cascade / Liquidation Exhaustion Reversal
```

## 2. Canonical Edge Map

Universe seed 来自用户 taxonomy，但会把指标、模型、组合、执行方法移出 Mechanism Family。每个 L1-L3 节点在 `rd_universe_node_axis` 中只有一个 primary axis，用于树形浏览；跨轴语义通过 secondary mapping 表达，不能把单值主轴误当成完整分类。

| L1 Edge | Axis | L2 Mechanism Family |
| --- | --- | --- |
| Trend | `return_driver` | Time-Series Trend / Breakout Continuation / Cross-Sectional Momentum / Trend Pullback / Trend Exhaustion |
| Mean Reversion | `return_driver` | Price Dislocation Reversion / Reference-Price Reversion / Cross-Sectional Reversion / Spread Reversion / Post-Shock Reversion |
| Carry | `risk_premium` | Funding Carry / Basis Arbitrage / Calendar Spread / Lending Carry / Staking Yield |
| Relative Value | `return_driver` | Pair Trading / Cointegration Spread / Basket Spread / ETF or Index Arbitrage / Residual Spread Reversion |
| Volatility | `risk_premium` | Volatility Risk Premium / Convexity / Volatility Term Structure / Volatility Relative Value / Dispersion / Volatility Regime Transition |
| Value | `risk_premium` | Network Valuation / Revenue Multiple / TVL Valuation / FDV or MC |
| Quality | `risk_premium` | Protocol Revenue / Treasury Quality / Developer Activity / Tokenomics Quality |
| Size | `risk_premium` | Small-Cap Premium / Liquidity Premium / Market-Cap Rotation |
| Sentiment | `structural_edge` | News Reaction / Social Attention / Fear and Greed Regime / Search Trend / Exchange Flow |
| Event | `structural_edge` | Listing / Unlock / Governance / ETF Flow / Macro Event |
| Seasonality | `structural_edge` | Hour-of-Day / Day-of-Week / Month-End / Expiry Effect / Funding Window |
| Order Flow | `market_mechanism` | Aggressor Imbalance / Absorption / Flow Persistence / Flow Exhaustion / Price-Flow Divergence |
| Liquidity | `structural_edge` | Liquidity Sweep / Liquidity Void / Depth Depletion / Depth Replenishment / Depth Imbalance |
| Forced Flow | `structural_edge` | Liquidation Cascade / Short Squeeze / Long Squeeze / ADL Pressure |
| Liquidity Provision | `market_mechanism` | Single-Venue Market Making / Cross-Venue Market Making / Inventory-Aware Market Making / Rebate-Oriented Liquidity Provision / Options Market Making |
| DeFi Native | `market_domain` | MEV / Bridge Flow / Stablecoin Depeg / DEX-CEX Arbitrage / Liquidity Migration |

明确移出 Universe：

| 原分类 | 新归属 | 原因 |
| --- | --- | --- |
| Bollinger / RSI / Z-score / Moving Average / ADX | Feature or Signal Model Registry | 指标或标准化方法，不是机制家族 |
| CVD / Delta / Footprint | Feature Registry | order-flow 表达方式，不是独立 edge |
| XGBoost / LSTM / Transformer | Signal Model Registry | 建模方式，不是收益来源 |
| PCA / Kalman / HMM / State Space | Signal Model Registry | 可服务多类 edge，不是独立 return driver |
| Risk Parity / Dollar Neutral / Allocator | Portfolio Registry | 持仓转换方式，不是赚钱原因 |
| Avellaneda-Stoikov / Quote Skew / Adaptive Spread | Signal Model / Execution / Risk Registry | market-making 模型、报价控制或风控方法 |
| TWAP / VWAP / Smart Routing | Execution Registry | 成交方式；若研究 maker spread，则归 Liquidity Provision |
| Slippage Alpha / Liquidity-Cost Prediction | Execution Registry | 预测成交成本，不是独立收益来源 |

DeFi Native 保留为 `market_domain` 是实用选择；其中节点仍可通过 secondary mapping 映射回 Relative Value、Event、Order Flow、Liquidity Provision 或 Structural Edge。`Trend Exhaustion` 主归 Trend、次映射 Mean Reversion；此类跨轴关系不复制节点。

Universe 宽度不等于当前产品范围。节点必须同时声明研究范围与实现范围；Planner 先过 scope gate，再看 coverage：

| 维度 | 状态 | 含义 |
| --- | --- | --- |
| `research_scope_status` | `active` / `catalog_only` / `product_out_of_scope` / `deprecated` | 当前产品是否应研究该节点 |
| `implementation_scope_status` | `ready` / `backlog` / `data_blocked` / `tool_blocked` / `product_out_of_scope` / `deprecated` | 当前是否具备实现条件 |

当前 `active` 默认只覆盖 Binance USDM `4H+ swing` 可表达节点。Options Market Making、MEV、Staking Yield、Lending Carry、ETF / Index Arbitrage、DEX-CEX Arbitrage 等长期节点保留为 `catalog_only` 或 `product_out_of_scope`，不能因 coverage 为空而自动进入 backlog。Value / Quality / Size 保留，但 metadata 应声明 `preferred_horizon=daily_or_higher`、`preferred_portfolio_shape=cross_sectional`、`usdm_4h_applicability=low`。

scope 组合由 seed / repository validator 统一校验：`active -> ready / backlog / data_blocked / tool_blocked`，`catalog_only -> data_blocked / tool_blocked / product_out_of_scope`，`product_out_of_scope -> product_out_of_scope`，`deprecated -> deprecated`。

## 3. Dynamic Research Pipeline

```text
Canonical Strategy
  -> Hypothesis
  -> Data Surface
  -> Feature
  -> Forecast Model
  -> Forecast
  -> Signal
  -> Position Rule
  -> Portfolio Construction
  -> Risk Rule
  -> Execution Rule
  -> Trial Group
  -> Experiment
  -> Review Decision
  -> Lesson
```

| 层 | 职责 | 示例 |
| --- | --- | --- |
| Hypothesis | 可证伪市场假说，包含经济解释 | 正 funding 且 OI 上升的 alt 多头拥挤，弱流量下更易 unwind |
| Data Surface | point-in-time 数据依赖 | OHLCV, funding, OI, trades, L2, on-chain |
| Feature | 因果可得的变量 | funding z-score, OI delta, CVD divergence, ATR percentile |
| Forecast Model | 把 feature 转成预测或状态 | linear score, tree model, Kalman state, HMM regime |
| Forecast | 对 target 或市场状态的带时效预测，不直接等于交易 | expected return, probability, regime, score |
| Signal | 与预测语义解耦的标准化方向、强度和 no-trade 结果 | `direction=-1`, `strength=0.83`, `no_trade=false` |
| Position Rule | 把 signal 转成持仓 | `score < -0.5 => short 30% risk budget` |
| Portfolio Construction | 多资产、多腿、权重和净暴露 | equal weight, dollar neutral, risk parity, carry book |
| Risk Rule | stop、time exit、kill switch、capacity | squeeze guard, max adverse funding, liquidity cap |
| Execution Rule | 订单语义和成本模型 | maker, taker, TWAP, route, slippage curve |
| Trial Group | 冻结 search space、selection protocol、多重检验与 trial budget | registered candidate group |
| Experiment | 一次可复现实验合同和结果 | discovery / validation / holdout / negative controls |
| Review Decision | reviewer 对实验阶段的裁决 | reject / modify / accept_for_draft / accept_for_forward / accept_for_shadow_candidate |
| Lesson | 成功、失败和 reviewer 结论 | rejected due to side-flip dominance |

信号链必须拆开：`feature_definition` 不能直接写 entry；`signal_definition` 不能混入 sizing；`execution_rule` 不能藏在成本扣减里。

最小机器接口：

```json
{
  "forecast": {
    "target": "forward_return_12h",
    "value": -0.0042,
    "uncertainty": 0.0061,
    "state": "deleveraging",
    "as_of": "...",
    "valid_until": "..."
  },
  "signal": {
    "direction": -1,
    "strength": 0.68,
    "calibrated_reliability": 0.57,
    "no_trade": false,
    "reason_codes": ["crowding", "weak_flow"],
    "as_of": "...",
    "valid_until": "..."
  }
}
```

`state/regime` 属于 forecast 或 context；signal 只表达标准化交易倾向。`forecast.uncertainty` 是 target 预测的不确定性；`signal.calibrated_reliability` 是预测再经过 calibration、regime、data-quality 与 execution feasibility 后的交易可靠度，二者量纲不同，禁止直接用 `1 - uncertainty` 换算。后者只能由版本化 calibration policy 产生，未知时为 `null`。

## 4. Registries

`required_data`、feature、model、portfolio、risk、execution 都不能只散落在 experiment JSON。RD 需要可查询目录，让 Planner 在提出假说前知道能力、覆盖度和约束。统一表只是 capability index，不是把不同实体压成同一种完整存储模型；各能力的权威定义仍由 owner module 和版本化 contract 持有。

| Registry | 存什么 | 不存什么 |
| --- | --- | --- |
| Data Surface Registry | OHLCV、funding、OI、trades、L2、on-chain、options、macro、news | 具体交易假说 |
| Feature Registry | funding z-score、OI delta、CVD、RSI、Bollinger width、VWAP distance | entry / sizing |
| Signal Model Registry | linear、tree、Kalman、HMM、state space、deep model | return driver |
| Portfolio Registry | single-asset、long-short、dollar neutral、risk parity、carry book | edge 本身 |
| Risk Registry | squeeze guard、vol stop、capacity cap、time exit、kill switch | signal alpha |
| Execution Registry | maker、taker、TWAP、VWAP、smart route、rebate capture | universe node |

Data Surface seed：

| Surface | 数据 | 关键约束 |
| --- | --- | --- |
| OHLCV | closed candles | closed-only、coverage、checksum、multi-timeframe |
| Funding | fundingRate、premium | settlement time、availability_at、cashflow |
| Open Interest | OI、OI delta | exchange coverage、缺口、symbol mapping |
| Trades | aggTrades、taker side | causal bar aggregation、压缩成本 |
| Liquidation | force orders / inferred liquidation | event timestamp、venue coverage、缺口标记 |
| L2 / Depth | book、spread、imbalance | historical depth、queue realism、maker fill |
| On-chain | flow、TVL、protocol revenue | point-in-time、chain reorg、label bias |
| Options | IV、skew、term structure、gamma | contract survivorship、expiry、mark source |
| Macro / ETF | rates、CPI、ETF flow | release time、revision、calendar |
| Social / News | text、sentiment、event labels | timestamp、source lag、lookahead risk |
| DEX / CEX | pool、bridge、basis、route | venue mapping、fees、latency |

缺数据时，Planner 产出 data backlog，不消耗 strategy trial。

## 5. Research Anchors And Current Coverage

外部分类只作为研究锚点，不直接进入 Universe。吸收标准是：能否转成明确 edge、机制家族、数据面、验证计划和执行约束。

| 来源 | 可吸收分类 | 对本项目的含义 |
| --- | --- | --- |
| HFR strategy classifications | equity hedge、event-driven、macro、relative value、risk parity、blockchain | 机构 taxonomy 按收益来源和组合结构组织，不能只按图形形态组织 |
| AQR alternative risk premia | value、momentum、carry、defensive、trend、volatility | family 应围绕风险溢价、行为偏差或结构性约束组织 |
| Trend-following 文献 | time-series momentum / managed futures | 单资产 TSM 只是最小表达，还缺组合、波动目标、跨资产趋势 |
| Cross-sectional asset pricing | momentum、reversal、value、liquidity、quality、size | panel RD 应支持横截面排序和负对照，不应孤立跑单资产 |
| Crypto perp / futures 文献 | funding、basis、premium、open interest、leverage pressure | crypto-native edge 不能只看 OHLCV；funding / carry / basis 是独立大类 |
| Market microstructure / LOB | spread、depth、order imbalance、impact、adverse selection | execution reality 应前置为 gate 或 family，不只是事后扣费 |
| 开源量化实践 | lookahead、fees、slippage、walk-forward、live decay | taxonomy 只给研究入口；真实资格仍由可复现实验和外部验证决定 |

当前 coverage 不是长期架构边界，只描述现阶段项目能力：

| Area | 当前状态 | 关键缺口 |
| --- | --- | --- |
| Directional trend / momentum | `time_series_momentum_v1` 等已有单资产 replay | BTC 4H 多轮失败；继续调参不是新 hypothesis |
| Cross-sectional ranking | `cross_sectional_momentum_v1` / `cross_sectional_reversal_v1` 已有 panel research | 仍缺组合持仓、资金占用、多腿执行和 promotion 边界 |
| Funding carry / unwind | `funding_carry_v1` 已接入 funding-aware replay | 需更强机制负对照；basis / calendar spread 当前 `product_out_of_scope` |
| Relative value / spread | `catalog_only / product_out_of_scope` | 当前 PRD 不做 hedge 多腿，不进入实现 backlog |
| Liquidity / marketability | `marketability_score_v1` 已作 universe gate | scorer 不能当 trading edge |
| Forced flow / liquidation | data backlog | force-order / aggTrades 质量与 causal aggregation 未齐 |
| Order flow / microstructure | `catalog_only / product_out_of_scope` | 4H swing 不适配；不因缺 L2 自动建 backlog |
| Volatility regime | partial | OHLCV 可表达 regime / compression；仍需 execution-aligned validation |
| Options / liquidity provision | `catalog_only / product_out_of_scope` | 不属于当前 Binance USDM `4H+ swing` setup 闭环 |
| Event / calendar | data backlog | timestamp availability、survivorship、事件标签偏差 |
| Regime / allocator | design backlog | router 先做 allow-list / no-trade，不直接交易 |

Family 入场标准：

- hypothesis certificate：edge 类型、参与者、regime、失效条件、成本敏感度、candidate universe、negative controls。
- replay semantics：入场、出场、持仓冲突、成本、funding / borrow / hedge 口径。
- data contract：字段、来源、availability_at、缺口标记、checksum。
- negative controls：机制对应负对照，而不是只复用单资产 side-flip。
- minimal fixture：一个正例、一个空信号、一个明显失败样本。
- artifact contract：输出必须能进入 catalog，且 summary 不误读 scorer 为收益。

## 6. DB 设计

策略宇宙、能力目录、实验合同和知识图谱进入 RD state store，由 `research-state-store` 独占写入。本文和机器 seed 是设计输入，DB 是运行态事实面；artifact 大对象仍只存 catalog ref，不进入 state DB。

DB 与机器合同中的时间统一使用 RFC 3339 UTC（如 `2026-07-14T03:20:00Z`）；无 offset、非 UTC 或本地时区字符串由 validator 拒绝。`registered_at / candidate_frozen_at / observed_at / availability_at / forward sample time` 必须遵守；文档展示层再转换为 `Asia/Shanghai`。

### `rd_universe_node`

```sql
CREATE TABLE rd_universe_node (
  node_id TEXT PRIMARY KEY,
  parent_node_id TEXT,
  level INTEGER NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN (
    'universe', 'edge', 'mechanism_family', 'canonical_strategy'
  )),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  description TEXT,
  research_scope_status TEXT NOT NULL CHECK(research_scope_status IN (
    'active', 'catalog_only', 'product_out_of_scope', 'deprecated'
  )),
  implementation_scope_status TEXT NOT NULL CHECK(implementation_scope_status IN (
    'ready', 'backlog', 'data_blocked', 'tool_blocked',
    'product_out_of_scope', 'deprecated'
  )),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (parent_node_id, slug),
  FOREIGN KEY (parent_node_id) REFERENCES rd_universe_node(node_id)
);
```

`node_type`：`universe` / `edge` / `mechanism_family` / `canonical_strategy`。

分类轴只存关系表，避免主表缓存与关系表形成双事实源。axis 为 `return_driver` / `risk_premium` / `market_mechanism` / `market_domain` / `structural_edge`；secondary axis 不复制 Universe 节点：

```sql
CREATE TABLE rd_universe_node_axis (
  node_id TEXT NOT NULL,
  axis TEXT NOT NULL CHECK(axis IN (
    'return_driver', 'risk_premium', 'market_mechanism',
    'market_domain', 'structural_edge'
  )),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, axis),
  FOREIGN KEY (node_id) REFERENCES rd_universe_node(node_id)
);

CREATE UNIQUE INDEX uq_rd_universe_node_primary_axis
ON rd_universe_node_axis(node_id)
WHERE is_primary = 1;

CREATE VIEW rd_universe_node_with_primary_axis AS
SELECT n.*, a.axis AS primary_classification_axis
FROM rd_universe_node n
LEFT JOIN rd_universe_node_axis a
  ON a.node_id = n.node_id AND a.is_primary = 1;
```

`node_id / path` 是全局身份，slug 只要求同一 parent 下唯一。seed validator 必须保证：全树只有一个 L0；L0 无 parent；L1/L2/L3 分别只指向 L0/L1/L2；level 与 node_type 一致；无环；path 等于 `parent.path + '/' + slug`；父节点 `product_out_of_scope / deprecated` 时子节点不得 `active`。每个 L1-L3 节点恰有一个 primary axis；partial unique index 保证“至多一个”，validator 保证“至少一个”。scope 表示“该不该做”，coverage 表示“做到哪里”，不得混用。

### `rd_data_surface`

```sql
CREATE TABLE rd_data_surface (
  surface_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  surface_type TEXT NOT NULL CHECK(surface_type IN (
    'market_price', 'derivatives', 'microstructure', 'onchain',
    'options', 'macro_event', 'text_event', 'cross_venue'
  )),
  availability_contract_json TEXT NOT NULL CHECK(json_valid(availability_contract_json)),
  coverage_status TEXT NOT NULL CHECK(coverage_status IN (
    'missing', 'partial', 'ready', 'blocked', 'out_of_scope'
  )),
  owner_module TEXT,
  evidence_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `rd_universe_data_surface`

核心关系不能只放 JSON，必须可查询。

```sql
CREATE TABLE rd_universe_data_surface (
  node_id TEXT NOT NULL,
  surface_id TEXT NOT NULL,
  requirement_type TEXT NOT NULL CHECK(requirement_type IN (
    'required', 'optional', 'enhancement'
  )),
  coverage_status TEXT NOT NULL CHECK(coverage_status IN (
    'missing', 'partial', 'ready', 'blocked', 'out_of_scope'
  )),
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (node_id, surface_id),
  FOREIGN KEY (node_id) REFERENCES rd_universe_node(node_id),
  FOREIGN KEY (surface_id) REFERENCES rd_data_surface(surface_id)
);
```

`requirement_type`：`required` / `optional` / `enhancement`。

两个 coverage 字段不是重复事实：`rd_data_surface.coverage_status` 表示平台级采集、历史与 freshness 能力；`rd_universe_data_surface.coverage_status` 表示该 surface 对特定 node 的时点、跨度、venue 与语义满足度。全局 `ready` 与节点关系 `partial` 可以同时成立。

### `rd_pipeline_registry_item`

```sql
CREATE TABLE rd_pipeline_registry_item (
  item_id TEXT PRIMARY KEY,
  registry_type TEXT NOT NULL CHECK(registry_type IN (
    'feature', 'forecast_model', 'portfolio', 'risk_rule', 'execution_rule'
  )),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  version TEXT NOT NULL,
  owner_module TEXT,
  status TEXT NOT NULL CHECK(status IN (
    'active', 'experimental', 'blocked', 'unavailable', 'deprecated'
  )),
  contract_json TEXT NOT NULL CHECK(json_valid(contract_json)),
  input_contract_json TEXT CHECK(input_contract_json IS NULL OR json_valid(input_contract_json)),
  output_contract_json TEXT CHECK(output_contract_json IS NULL OR json_valid(output_contract_json)),
  capability_tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(capability_tags_json)),
  deterministic INTEGER NOT NULL DEFAULT 1 CHECK(deterministic IN (0, 1)),
  deprecated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (status = 'deprecated' AND deprecated_at IS NOT NULL) OR
    (status != 'deprecated' AND deprecated_at IS NULL)
  ),
  UNIQUE (registry_type, slug, version)
);
```

`registry_type`：`feature` / `forecast_model` / `portfolio` / `risk_rule` / `execution_rule`。该表只支持发现、版本选择和 contract 跳转；feature 依赖、panel 支持、maker 能力、多腿约束必须来自版本化 input/output contract 或 capability tags，不能靠名称推断。

### `rd_universe_coverage`

```sql
CREATE TABLE rd_universe_coverage (
  coverage_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  coverage_type TEXT NOT NULL CHECK(coverage_type IN (
    'data', 'family', 'replay', 'panel', 'forward', 'governance'
  )),
  scope_ref TEXT NOT NULL DEFAULT '*',
  module_ref TEXT,
  coverage_status TEXT NOT NULL CHECK(coverage_status IN (
    'missing', 'partial', 'ready', 'blocked', 'out_of_scope'
  )),
  evidence_ref TEXT,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  updated_at TEXT NOT NULL,
  UNIQUE (node_id, coverage_type, scope_ref),
  FOREIGN KEY (node_id) REFERENCES rd_universe_node(node_id)
);
```

一条 node 按 `coverage_type` 有多条覆盖记录；`scope_ref` 指具体 data surface、family、harness 或 `*`，避免 `NULL` 唯一约束失效。Planner 不能把单个 `partial` 猜成整体能力，也不能凭记忆说没覆盖。

### `rd_trial_group`

Trial Group 是 search space、selection protocol、多重检验与预算的唯一事实面；Experiment 只保存 group id/hash 快照。

```sql
CREATE TABLE rd_trial_group (
  trial_group_id TEXT PRIMARY KEY,
  hypothesis_scope_ref TEXT NOT NULL,
  group_hash TEXT NOT NULL UNIQUE,
  identity_hash_policy_version TEXT NOT NULL,
  candidate_mode TEXT NOT NULL CHECK(candidate_mode IN ('enumerated', 'generated_from_space')),
  candidate_generator_ref TEXT,
  search_space_json TEXT NOT NULL CHECK(json_valid(search_space_json)),
  selection_protocol_json TEXT NOT NULL CHECK(json_valid(selection_protocol_json)),
  max_trials INTEGER NOT NULL CHECK(max_trials >= 1),
  trial_accounting_policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('registered', 'running', 'sealed', 'closed')),
  registered_at TEXT NOT NULL,
  sealed_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (trial_group_id, group_hash, identity_hash_policy_version),
  UNIQUE (trial_group_id, identity_hash_policy_version),
  CHECK(
    (status IN ('registered', 'running') AND sealed_at IS NULL AND closed_at IS NULL) OR
    (status = 'sealed' AND sealed_at IS NOT NULL AND closed_at IS NULL) OR
    (status = 'closed' AND sealed_at IS NOT NULL AND closed_at IS NOT NULL)
  ),
  CHECK(
    (candidate_mode = 'enumerated' AND candidate_generator_ref IS NULL) OR
    (candidate_mode = 'generated_from_space' AND candidate_generator_ref IS NOT NULL)
  )
);

CREATE TABLE rd_trial_group_candidate (
  trial_group_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_identity_hash TEXT NOT NULL,
  identity_hash_policy_version TEXT NOT NULL,
  parameter_assignment_json TEXT NOT NULL CHECK(json_valid(parameter_assignment_json)),
  candidate_ordinal INTEGER NOT NULL CHECK(candidate_ordinal >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (trial_group_id, candidate_id),
  UNIQUE (trial_group_id, candidate_ordinal),
  UNIQUE (
    trial_group_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ),
  FOREIGN KEY (trial_group_id, identity_hash_policy_version)
    REFERENCES rd_trial_group(trial_group_id, identity_hash_policy_version)
);
```

`group_hash` 覆盖 hypothesis scope、candidate mode、固定 generator、完整 search space、selection、`max_trials`、multiple-testing 与 accounting policy。`enumerated` 必须在 group 启动前写全 candidate rows；`generated_from_space` 只能由固定 `candidate_generator_ref` 在 reserve 前物化 candidate row，generator 负责验证其属于冻结空间。两种模式下 trial 都必须通过 FK 引用关系化 candidate，agent 不能临时增加参数组合。`registered` 尚未消费、`running` 可 reserve、`sealed` 禁止新增 candidate/trial、`closed` 已收口；budget usage 由可计费 trial 行数派生。

### Proposal、registered contract 与 identity

未验证 draft 只存在于 planner-run 临时输出，不写 RD state DB。validator 完成后才追加一条不可变的 `valid / invalid` revision；invalid revision 可供同一 planner run 生成下一版，但不进入 experiment lineage、KG、failure density 或 trial usage。只有 `valid` revision 可物化正式 experiment 或 family backlog：

```sql
CREATE TABLE rd_proposal (
  proposal_id TEXT PRIMARY KEY,
  planner_run_id TEXT NOT NULL,
  proposal_kind TEXT NOT NULL CHECK(proposal_kind IN ('experiment', 'family_backlog')),
  materialized_revision INTEGER,
  materialization_ref TEXT UNIQUE,
  materialized_at TEXT,
  created_at TEXT NOT NULL,
  CHECK(
    (materialized_revision IS NULL AND materialization_ref IS NULL AND materialized_at IS NULL) OR
    (materialized_revision IS NOT NULL AND materialization_ref IS NOT NULL AND materialized_at IS NOT NULL)
  ),
  FOREIGN KEY (proposal_id, materialized_revision)
    REFERENCES rd_proposal_revision(proposal_id, revision)
);

CREATE TABLE rd_proposal_revision (
  proposal_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  proposal_hash TEXT NOT NULL,
  identity_hash_policy_version TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),
  validation_status TEXT NOT NULL CHECK(validation_status IN ('invalid', 'valid')),
  validation_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, revision),
  FOREIGN KEY (proposal_id) REFERENCES rd_proposal(proposal_id)
);

CREATE TABLE rd_experiment_contract (
  experiment_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL,
  canonical_node_id TEXT NOT NULL,
  hypothesis_id TEXT NOT NULL,
  code_family_id TEXT NOT NULL,
  trial_group_id TEXT NOT NULL,
  trial_group_hash TEXT NOT NULL,
  parent_experiment_id TEXT,
  contract_hash TEXT NOT NULL,
  identity_hash_policy_version TEXT NOT NULL,
  contract_validator_version TEXT NOT NULL,
  lifecycle_rule_version TEXT NOT NULL,
  scope_policy_version TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  selected_candidate_id TEXT,
  selected_trial_id TEXT,
  candidate_hash TEXT,
  candidate_frozen_at TEXT,
  suspended_from_state TEXT,
  lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN (
    'proposed', 'blocked', 'discovery', 'rejected', 'needs_modification',
    'draft_frozen', 'forward_observation', 'invalidated', 'shadow_candidate',
    'suspended', 'superseded', 'closed'
  )),
  lifecycle_version INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_version >= 0),
  last_lifecycle_event_id TEXT,
  contract_json TEXT NOT NULL CHECK(json_valid(contract_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (proposal_id, proposal_revision),
  UNIQUE (proposal_id),
  UNIQUE (trial_group_id, experiment_id),
  CHECK(
    (selected_candidate_id IS NULL AND selected_trial_id IS NULL AND
     candidate_hash IS NULL AND candidate_frozen_at IS NULL) OR
    (selected_candidate_id IS NOT NULL AND selected_trial_id IS NOT NULL AND
     candidate_hash IS NOT NULL AND candidate_frozen_at IS NOT NULL)
  ),
  FOREIGN KEY (proposal_id, proposal_revision)
    REFERENCES rd_proposal_revision(proposal_id, revision),
  FOREIGN KEY (canonical_node_id) REFERENCES rd_universe_node(node_id),
  FOREIGN KEY (trial_group_id, trial_group_hash, identity_hash_policy_version)
    REFERENCES rd_trial_group(
      trial_group_id, group_hash, identity_hash_policy_version
    ),
  FOREIGN KEY (
    selected_trial_id, experiment_id, selected_candidate_id,
    candidate_hash, identity_hash_policy_version
  ) REFERENCES rd_trial(
    trial_id, experiment_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ),
  FOREIGN KEY (parent_experiment_id) REFERENCES rd_experiment_contract(experiment_id),
  FOREIGN KEY (last_lifecycle_event_id) REFERENCES rd_lifecycle_event(event_id)
);
```

proposal revision 是提交前审计，不是 experiment child；header 固定 `planner_run_id / proposal_kind`，revision 只单调追加。物化事务必须以 `materialized_revision IS NULL` 为条件更新 header，因此一个 proposal 最多物化一次；`materialization_ref` 同时覆盖 experiment id 或 family-backlog item ref，保证两条路径都幂等。只有 valid experiment revision + existing family 才生成 immutable contract；正式 contract 的修订必须新建 child experiment。

所有 identity hash 使用同一规范：`SHA-256(UTF-8(JCS(normalized_payload)))`。`identity_hash_policy_version` 唯一确定 serializer、JCS/NFC、数字、null/absent 与 default-expansion 规则，不再单列 serializer version；每个被 hash payload（包括 group 的 search/selection JSON）自身必须携带 `schema_version`。禁止按原始 JSON 文本 hash，也不得在升级 policy 后静默重算旧 identity。

Candidate Identity Contract：

| 纳入 hash | 排除 hash |
| --- | --- |
| canonical、hypothesis、point-in-time asset universe、feature、target、forecast、signal、position、portfolio、risk、execution、cost assumptions、selected parameters、family/version、trial-group hash | result metrics、review decision、forward observations、runtime timestamps、artifact location |

forward validator 只接受 candidate identity payload 复算结果与 `candidate_hash` 一致的样本；artifact 内容若影响语义，必须以内容 hash 纳入 identity，而不是纳入路径。

```sql
CREATE TABLE rd_trial (
  trial_id TEXT PRIMARY KEY,
  trial_group_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  trial_ordinal INTEGER NOT NULL CHECK(trial_ordinal >= 1),
  candidate_id TEXT NOT NULL,
  candidate_identity_hash TEXT NOT NULL,
  identity_hash_policy_version TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved', 'completed', 'failed', 'cancelled')),
  counts_against_budget INTEGER NOT NULL CHECK(counts_against_budget IN (0, 1)),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK(
    (status = 'reserved' AND completed_at IS NULL) OR
    (status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL)
  ),
  UNIQUE (trial_group_id, trial_ordinal),
  UNIQUE (trial_id, experiment_id, trial_group_id),
  UNIQUE (
    trial_id, experiment_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ),
  FOREIGN KEY (
    trial_group_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ) REFERENCES rd_trial_group_candidate(
    trial_group_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ),
  FOREIGN KEY (trial_group_id, experiment_id)
    REFERENCES rd_experiment_contract(trial_group_id, experiment_id)
);
```

trial reservation 与计费必须在同一事务内验证 `group_hash`、status、candidate 属于预注册 search space 且预算未超限；`counts_against_budget` 由 group 固定的 accounting policy 生成，agent 不得传入。

`accept_for_draft` 必须选择一条属于本 experiment、状态为 `completed` 的 trial，并在 transition 事务的同一条 projection UPDATE 中写入 `draft_frozen + selected_candidate_id + selected_trial_id + candidate_hash + candidate_frozen_at`；`candidate_hash` 必须等于 trial identity hash。拆成两次 UPDATE 或之后 refreeze 都由 trigger 拒绝。

结果和裁决是追加记录，不能回写覆盖历史。每次任务重试必须复用稳定 idempotency key：

```sql
CREATE TABLE rd_result_stage (
  stage_id TEXT PRIMARY KEY,
  stage_order INTEGER NOT NULL,
  is_sentinel INTEGER NOT NULL DEFAULT 0 CHECK(is_sentinel IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'deprecated')),
  CHECK((stage_id = '__any__' AND is_sentinel = 1) OR
        (stage_id != '__any__' AND is_sentinel = 0))
);

CREATE TABLE rd_result_type (
  result_type_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active', 'deprecated')),
  description TEXT NOT NULL
);

CREATE TABLE rd_experiment_result (
  result_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  result_scope TEXT NOT NULL CHECK(result_scope IN ('trial', 'experiment', 'trial_group')),
  trial_id TEXT,
  trial_group_id TEXT,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  stage_id TEXT NOT NULL,
  result_type_id TEXT NOT NULL,
  artifact_ref TEXT NOT NULL,
  evidence_fingerprint_json TEXT NOT NULL CHECK(json_valid(evidence_fingerprint_json)),
  summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
  created_at TEXT NOT NULL,
  CHECK(stage_id != '__any__'),
  CHECK(
    (result_scope = 'trial' AND trial_id IS NOT NULL AND trial_group_id IS NOT NULL) OR
    (result_scope = 'experiment' AND trial_id IS NULL AND trial_group_id IS NULL) OR
    (result_scope = 'trial_group' AND trial_id IS NULL AND trial_group_id IS NOT NULL)
  ),
  UNIQUE (result_id, experiment_id),
  FOREIGN KEY (experiment_id) REFERENCES rd_experiment_contract(experiment_id),
  FOREIGN KEY (trial_id, experiment_id, trial_group_id)
    REFERENCES rd_trial(trial_id, experiment_id, trial_group_id),
  FOREIGN KEY (trial_group_id, experiment_id)
    REFERENCES rd_experiment_contract(trial_group_id, experiment_id),
  FOREIGN KEY (stage_id) REFERENCES rd_result_stage(stage_id),
  FOREIGN KEY (result_type_id) REFERENCES rd_result_type(result_type_id)
);

CREATE TABLE rd_review_decision (
  decision_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  reviewer_run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  transition_rule_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN (
    'reject', 'modify', 'accept_for_draft',
    'accept_for_forward', 'accept_for_shadow_candidate'
  )),
  observed_current_state TEXT NOT NULL,
  applied_next_state TEXT NOT NULL,
  rationale_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(stage_id != '__any__'),
  UNIQUE (decision_id, experiment_id),
  UNIQUE (experiment_id, stage_id, reviewer_run_id),
  FOREIGN KEY (experiment_id) REFERENCES rd_experiment_contract(experiment_id),
  FOREIGN KEY (stage_id) REFERENCES rd_result_stage(stage_id),
  FOREIGN KEY (transition_rule_id) REFERENCES rd_lifecycle_transition_rule(rule_id)
);

CREATE TABLE rd_review_decision_result (
  decision_id TEXT NOT NULL,
  result_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  evidence_role TEXT NOT NULL CHECK(evidence_role IN (
    'primary', 'supporting', 'negative_control', 'cost', 'stability', 'holdout'
  )),
  created_at TEXT NOT NULL,
  PRIMARY KEY (decision_id, result_id),
  FOREIGN KEY (decision_id, experiment_id)
    REFERENCES rd_review_decision(decision_id, experiment_id),
  FOREIGN KEY (result_id, experiment_id)
    REFERENCES rd_experiment_result(result_id, experiment_id)
);

CREATE UNIQUE INDEX uq_rd_review_decision_primary_result
ON rd_review_decision_result(decision_id)
WHERE evidence_role = 'primary';
```

stage seed 固定为 `discovery / panel / negative_control / parameter_stability / cost_stress / historical_validation / forward_observation` 与 sentinel `__any__`；result type 也只能来自 registry。`__any__` 仅供 transition rule 使用，result / decision 由 DB CHECK 禁止写入。正式 shadow evidence 属于 strategy governance，不扩入 RD stage。

一个 experiment 可有多条 result，也可经历多轮 review。每个 decision 必须在同一原子写入中关联同 experiment 的至少一条 result，且恰有一个 `primary`；其余证据按 role 显式关联。result idempotency 由 `experiment + result_scope/ref + stage + result_type + run` 派生，decision 由 `experiment + stage + decision + reviewer_run` 派生；重复请求返回已有记录。`evidence_fingerprint_json` 至少绑定 `policy_hash + harness_hash + data_hash + assumptions_hash + temporal_contract`。

唯一索引只保证 primary “至多一个”；repository invariant test 必须验证“零 primary”时 decision、links 与 lifecycle event 整个事务失败且不留孤儿记录。

对 `accept_for_draft`，primary result 必须是 `result_scope=trial` 且 `trial_id = selected_trial_id`；group selection / stability / cost 结果只能作为 supporting evidence。writer 必须在冻结事务中同时验证该 primary result、selected trial 与 candidate identity 一致，防止用 Trial A 的结果冻结 Trial B。

`decision.stage_id` 表示本次 gate；transition rule 的 `requires_result_stage_id` 必须由该 decision 链接的 result 集合满足（通常由 primary result 满足），不能只信 decision 自报 stage。

decision 中的 `observed_current_state / applied_next_state` 只是审计快照，必须由 transition writer 从 DB projection 与 rule 复制，调用者不得传入；状态权威仍是 lifecycle event history。

blocker 必须结构化，不能依赖自由文本判断能否恢复：

```sql
CREATE TABLE rd_experiment_blocker (
  blocker_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  blocker_type TEXT NOT NULL CHECK(blocker_type IN (
    'external_data', 'external_tool', 'capacity', 'governance'
  )),
  detail_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
  close_reason TEXT CHECK(close_reason IN ('resolved', 'superseded', 'experiment_closed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK(
    (status = 'open' AND closed_at IS NULL AND close_reason IS NULL) OR
    (status = 'closed' AND closed_at IS NOT NULL AND close_reason IS NOT NULL)
  ),
  FOREIGN KEY (experiment_id) REFERENCES rd_experiment_contract(experiment_id)
);
```

schema / semantic 问题在 proposal validator 阶段修订，不产生 experiment blocker。正式 experiment 只有 `external_data / external_tool / capacity / governance` blocker；前三类解除且 contract hash 未变时可恢复，`governance` 只能由 governance owner 关闭。`superseded` 表示 blocker 不再适用，不伪装为已解决。

状态规则是版本化机器资产，不在 supervisor 中散落分支：

```sql
CREATE TABLE rd_lifecycle_transition_rule (
  rule_id TEXT PRIMARY KEY,
  rule_version TEXT NOT NULL,
  current_state TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT NOT NULL,
  next_state TEXT NOT NULL,
  requires_result_stage_id TEXT NOT NULL DEFAULT '__any__',
  requires_fresh_fingerprint INTEGER NOT NULL DEFAULT 0
    CHECK(requires_fresh_fingerprint IN (0, 1)),
  UNIQUE (rule_version, current_state, trigger_type, trigger_value, requires_result_stage_id),
  FOREIGN KEY (requires_result_stage_id) REFERENCES rd_result_stage(stage_id)
);

CREATE TABLE rd_lifecycle_event (
  event_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no >= 1),
  transition_rule_id TEXT NOT NULL,
  trigger_ref TEXT NOT NULL,
  current_state TEXT NOT NULL,
  next_state TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (experiment_id, sequence_no),
  FOREIGN KEY (experiment_id) REFERENCES rd_experiment_contract(experiment_id),
  FOREIGN KEY (transition_rule_id) REFERENCES rd_lifecycle_transition_rule(rule_id)
);
```

rule 唯一键不含 `next_state`，同一 version / state / trigger / result stage 只能解析出一个结果；无 stage 要求时固定引用 `__any__`，不使用会绕过 SQLite unique 的 `NULL`。experiment 注册时固定 `lifecycle_rule_version`，后续 transition 只读取该版本；升级规则不改变在途 experiment，迁移必须显式产生 governance event。

lifecycle-rule seed validator 必须拒绝未知 vocabulary：`current_state / next_state` 来自 lifecycle state 集合；`trigger_type` 仅允许 `reviewer / system / blocker / governance`；reviewer value 仅允许五种 review decision。`__unregistered__` 只能出现在 `system/register` 的 current state，且 next state 必须是 `proposed`；任何其他规则不得使用该 sentinel。

`rd_lifecycle_event` 是权威历史，contract 上的 `lifecycle_state / lifecycle_version / last_lifecycle_event_id` 只是可重建 projection。注册事务暂存 `proposed / version=0`，随后按固定 rule 写入 bootstrap event：`__unregistered__ + system/register -> proposed`，`sequence_no=1`，并在提交前投影为 version `1`；禁止提交 eventless contract，也禁止伪造 `proposed -> proposed`。唯一写入口 `research-state-store.apply-transition(expected_version)` 必须核对 actual version/state 与 contract 固定 rule version，追加 decision/result links 与 event，再以 `WHERE lifecycle_version=expected_version` 更新 projection。冲突或任一步失败均回滚；integrity job 必须能按 sequence 重放并核对 projection。

### `rd_knowledge_node` / `rd_knowledge_edge`

```sql
CREATE TABLE rd_knowledge_node (
  kg_node_id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  ref_id TEXT,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (node_type, slug)
);

CREATE UNIQUE INDEX uq_rd_knowledge_node_ref
ON rd_knowledge_node(node_type, ref_id)
WHERE ref_id IS NOT NULL;

CREATE TABLE rd_knowledge_edge (
  edge_id TEXT PRIMARY KEY,
  from_kg_node_id TEXT NOT NULL,
  to_kg_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (from_kg_node_id, to_kg_node_id, edge_type),
  FOREIGN KEY (from_kg_node_id) REFERENCES rd_knowledge_node(kg_node_id),
  FOREIGN KEY (to_kg_node_id) REFERENCES rd_knowledge_node(kg_node_id)
);

CREATE TABLE rd_knowledge_edge_evidence (
  edge_evidence_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_strength REAL CHECK(
    evidence_strength IS NULL OR
    (evidence_strength >= 0 AND evidence_strength <= 1)
  ),
  scoring_policy_ref TEXT,
  observed_at TEXT NOT NULL,
  supersedes_edge_evidence_id TEXT,
  supersedes_edge_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (edge_evidence_id, edge_id),
  FOREIGN KEY (edge_id) REFERENCES rd_knowledge_edge(edge_id),
  FOREIGN KEY (supersedes_edge_evidence_id, supersedes_edge_id)
    REFERENCES rd_knowledge_edge_evidence(edge_evidence_id, edge_id),
  CHECK(
    (supersedes_edge_evidence_id IS NULL AND supersedes_edge_id IS NULL) OR
    (supersedes_edge_evidence_id IS NOT NULL AND supersedes_edge_id IS NOT NULL AND
     supersedes_edge_id = edge_id)
  ),
  CHECK(
    supersedes_edge_evidence_id IS NULL OR
    supersedes_edge_evidence_id != edge_evidence_id
  ),
  CHECK(evidence_strength IS NULL OR scoring_policy_ref IS NOT NULL)
);
```

`rd_knowledge_edge` 是关系当前投影，`rd_knowledge_edge_evidence` 是 append-only 证据历史；新证据不得覆盖旧证据，需要替代时同时引用 `supersedes_edge_evidence_id + supersedes_edge_id`，复合 FK 与 CHECK 保证只能替代同一 edge 且不能 self-supersede。结构关系不填伪精确 strength。Agent 不得自由生成 `evidence_strength`；非空值只能由人工 reviewer 或版本化 scoring policy 产生，并记录 `scoring_policy_ref`。不同 policy 的数值默认不可横向比较。

KG node type 至少包括：`canonical_strategy` / `planner_run` / `agent_run` / `hypothesis` / `data_surface` / `feature` / `forecast_model` / `forecast` / `signal` / `position_rule` / `trial_group` / `trial` / `experiment` / `result` / `review_decision` / `lesson` / `regime` / `asset_universe`。

KG edge type：

```text
planner_run -> proposes -> hypothesis
agent_run -> generates -> hypothesis
hypothesis -> derived_from -> canonical_strategy
hypothesis -> supersedes -> hypothesis
hypothesis -> variant_of -> hypothesis
hypothesis -> requires -> data_surface
hypothesis -> operationalized_by -> feature
hypothesis -> evaluated_in -> trial_group
experiment -> uses -> feature
experiment -> child_of -> experiment
experiment -> member_of -> trial_group
experiment -> consumes -> trial
feature -> consumed_by -> forecast_model
feature -> equivalent_to -> feature
feature -> correlated_with -> feature
forecast_model -> emits -> forecast
forecast -> normalized_to -> signal
signal -> mapped_by -> position_rule
experiment -> tests -> hypothesis
experiment -> produces -> result
result -> supports -> hypothesis
result -> refutes -> hypothesis
review_decision -> evaluates -> result
lesson -> derived_from -> experiment
lesson -> blocks -> hypothesis
lesson -> supports -> hypothesis
lesson -> applies_to -> experiment
lesson -> applies_under -> regime
lesson -> scoped_to -> asset_universe
```

单次失败默认只约束 hypothesis、实现、regime 或 asset universe，不能否定整个 canonical。只有跨实现、跨样本、跨 regime 的累积证据经人工 review 后，才允许新增 `lesson -> qualifies -> canonical_strategy` 聚合边；该边表示适用性被收窄，不表示机制已被永久删除。

v1 必须落 `variant_of / child_of / supports / refutes`，用于识别换名重跑与实验谱系；正负极性直接由 edge type 表达，不藏在 metadata。`equivalent_to / correlated_with` 可后补；作为对称关系写入时按两端 node id 排序，只存一条 canonical edge，并且必须有 evidence ref。

DB 必须保护 identity 与 append-only 边界，而不只依赖 repository：

```sql
CREATE TRIGGER prevent_proposal_rematerialization
BEFORE UPDATE OF materialized_revision, materialization_ref, materialized_at
ON rd_proposal
WHEN OLD.materialized_revision IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'proposal is already materialized');
END;

CREATE TRIGGER prevent_proposal_identity_mutation
BEFORE UPDATE OF planner_run_id, proposal_kind, created_at
ON rd_proposal
BEGIN
  SELECT RAISE(ABORT, 'proposal identity is immutable');
END;

CREATE TRIGGER validate_experiment_registration_insert
BEFORE INSERT ON rd_experiment_contract
WHEN NEW.lifecycle_state != 'proposed'
  OR NEW.lifecycle_version != 0
  OR NEW.last_lifecycle_event_id IS NOT NULL
  OR NEW.selected_candidate_id IS NOT NULL
  OR NEW.selected_trial_id IS NOT NULL
  OR NEW.candidate_hash IS NOT NULL
  OR NEW.candidate_frozen_at IS NOT NULL
  OR NEW.suspended_from_state IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid initial experiment projection');
END;

CREATE TRIGGER prevent_registered_contract_identity_mutation
BEFORE UPDATE OF proposal_id, proposal_revision, canonical_node_id, hypothesis_id,
  code_family_id, trial_group_id, trial_group_hash, parent_experiment_id,
  contract_hash, identity_hash_policy_version,
  contract_validator_version, lifecycle_rule_version, scope_policy_version,
  registered_at, contract_json
ON rd_experiment_contract
BEGIN
  SELECT RAISE(ABORT, 'registered contract identity is immutable');
END;

CREATE TRIGGER prevent_candidate_refreeze
BEFORE UPDATE OF selected_candidate_id, selected_trial_id,
  candidate_hash, candidate_frozen_at
ON rd_experiment_contract
WHEN OLD.candidate_hash IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'frozen candidate identity is immutable');
END;

CREATE TRIGGER restrict_candidate_first_freeze
BEFORE UPDATE OF selected_candidate_id, selected_trial_id,
  candidate_hash, candidate_frozen_at
ON rd_experiment_contract
WHEN OLD.candidate_hash IS NULL
  AND NEW.candidate_hash IS NOT NULL
  AND NEW.lifecycle_state != 'draft_frozen'
BEGIN
  SELECT RAISE(ABORT, 'candidate may only freeze with draft_frozen transition');
END;

CREATE TRIGGER require_candidate_before_draft_frozen
BEFORE UPDATE OF lifecycle_state
ON rd_experiment_contract
WHEN NEW.lifecycle_state = 'draft_frozen' AND (
  NEW.selected_candidate_id IS NULL OR NEW.selected_trial_id IS NULL OR
  NEW.candidate_hash IS NULL OR NEW.candidate_frozen_at IS NULL OR
  NOT EXISTS (
    SELECT 1 FROM rd_trial t
    WHERE t.trial_id = NEW.selected_trial_id
      AND t.experiment_id = NEW.experiment_id
      AND t.candidate_id = NEW.selected_candidate_id
      AND t.candidate_identity_hash = NEW.candidate_hash
      AND t.status = 'completed'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'draft_frozen requires selected candidate and trial');
END;

CREATE TRIGGER prevent_trial_group_definition_mutation
BEFORE UPDATE OF hypothesis_scope_ref, group_hash, candidate_mode,
  candidate_generator_ref, search_space_json, identity_hash_policy_version,
  selection_protocol_json, max_trials,
  trial_accounting_policy_version, registered_at
ON rd_trial_group
BEGIN
  SELECT RAISE(ABORT, 'registered trial group definition is immutable');
END;

CREATE TRIGGER restrict_trial_group_candidate_insert
BEFORE INSERT ON rd_trial_group_candidate
WHEN NOT EXISTS (
  SELECT 1 FROM rd_trial_group g
  WHERE g.trial_group_id = NEW.trial_group_id
    AND (
      g.status = 'registered' OR
      (g.status = 'running' AND g.candidate_mode = 'generated_from_space')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'candidate cannot be added in current group state/mode');
END;

CREATE TRIGGER prevent_trial_identity_mutation
BEFORE UPDATE OF trial_group_id, experiment_id, trial_ordinal,
  candidate_id, candidate_identity_hash, identity_hash_policy_version,
  run_id, counts_against_budget,
  idempotency_key, created_at
ON rd_trial
BEGIN
  SELECT RAISE(ABORT, 'trial identity and accounting are immutable');
END;
```

migration 还必须为 contract / trial group 禁止 DELETE，并为 proposal-revision、trial-group-candidate、result、decision、decision-result、lifecycle-event、KG evidence 安装禁止 UPDATE/DELETE 的 append-only trigger；repository invariant tests 必须实际尝试非法写入并断言 DB 拒绝。trial 只允许专用 writer 推进 `reserved -> completed / failed / cancelled`，不得修改 identity/accounting；projection 与 group status/timestamps 同样只允许 owner writer 更新。

## 7. Research Contracts

Planner 先路由 proposal：已有 family 才能生成完整 Experiment Contract；缺 family 时生成 Family Backlog Contract。二者共享 canonical、hypothesis、经济解释与数据需求，但 backlog 不伪造执行字段，也不创建 experiment。

### Family Backlog Contract

```json
{
  "schema_version": "trade-flow.rd-family-backlog-contract.v1",
  "canonical_node_id": "...",
  "hypothesis": "...",
  "economic_rationale": {},
  "required_data": [],
  "required_semantics": ["feature", "forecast", "signal", "position", "risk", "execution"],
  "expected_input_contract": {},
  "expected_output_contract": {},
  "negative_controls": [],
  "fixture_requirements": ["positive", "no_signal", "obvious_failure"],
  "proposal_ref": "..."
}
```

它只写 machine backlog / certificate，trial usage 为零。family manifest、I/O contract、fixtures 与 capability registration 完成后，Planner 才创建新的 experiment proposal；backlog 不是 parent experiment。

### Executable Experiment Contract

正式实验必须包含以下字段；缺任何一个，proposal validation 失败，不创建 experiment，也不消耗 trial。

| 字段 | 要求 |
| --- | --- |
| `canonical_node_id` | L3 canonical strategy；不得引用 L1/L2 当成具体假说 |
| `code_family_id` | 必填；代码 family / manifest id，不得混作 L2 taxonomy |
| `implementation_version` | 必填；实现版本或 family manifest version |
| `contract_versions` | 固定 identity-hash、contract validator、lifecycle rule 与 scope policy version |
| `hypothesis` | 可证伪市场假说 |
| `economic_rationale` | 经济解释，不能是公式描述 |
| `asset_universe_definition` | point-in-time 资产选择规则，防 survivorship bias |
| `timeframe` | 交易周期、特征周期、rebalance 周期 |
| `sampling_and_alignment` | 数据采样、bar 对齐、availability_at、closed-candle 规则 |
| `required_data` | 绑定 Data Surface Registry |
| `feature_definition` | feature 如何计算，何时可得，是否 causal |
| `target_definition` | 预测或判定目标、horizon、entry delay、price source、label end；纯规则也必须声明评估 target |
| `forecast_definition` | feature 如何变成 forecast / score / probability / regime |
| `signal_definition` | 方向、强度、no-trade 条件；不含 sizing |
| `position_rule` | side、size、rebalance、conflict handling |
| `portfolio_construction` | 单资产可写 `single_asset`; 多资产必须写权重和净暴露 |
| `risk_rule` | stop、target、time exit、capacity、kill switch |
| `execution_rule` | maker/taker/TWAP/VWAP/route、成本模型 |
| `transaction_cost_model` | fee、slippage、funding、borrow、market impact |
| `expected_holding_period` | bars / session / days，以及为什么 |
| `benchmark` | baseline、cash、buy-and-hold、family null 或 market beta |
| `validation_plan` | discovery、external validation、holdout、panel、negative controls |
| `rejection_criteria` | 明确停止条件，不允许无限修补 |
| `trial_group_ref` | 已注册 `trial_group_id + group_hash`；search space、selection 与 max trials 以 group 为权威 |
| `candidate_registration` | 只列本 experiment 使用的 candidate ids；identity/hash/参数以 `rd_trial_group_candidate` 为权威 |
| `parent_experiment_id` | 从失败/修改实验派生时必填 |
| `random_seed` | 随机过程可复现 |
| `code_commit_ref` | 代码版本 |
| `harness_commit_ref` | replay / panel / selector 实现版本 |
| `data_snapshot_ref` | 数据快照版本 |
| `assumptions_ref` | 撮合、成本、缺失值和 temporal contract 的冻结引用 |
| `replay_execution_input` | Replay 必需 supplemental input 的 schema/hash；由 Contract 冻结，Developer 不得降级为空 |

最小 JSON 形状：

```json
{
  "schema_version": "trade-flow.rd-experiment-contract.v3",
  "canonical_node_id": "carry/funding-carry/crowded-funding-unwind",
  "code_family_id": "funding_carry_v1",
  "implementation_version": "v1",
  "contract_versions": {
    "identity_hash_policy": "rd-identity-hash.v1",
    "validator": "rd-contract-validator.v1",
    "lifecycle_rule": "rd-lifecycle.v1",
    "scope_policy": "rd-scope.v1"
  },
  "hypothesis": "...",
  "economic_rationale": {
    "why_exists": "...",
    "who_pays": "...",
    "why_not_arbitraged": "...",
    "valid_regime": "...",
    "capacity_and_cost": "..."
  },
  "asset_universe_definition": {
    "venue": ["binance"],
    "instrument_type": "perpetual",
    "quote_asset": "USDT",
    "min_listing_age_days": 180,
    "selection_timestamp_rule": "point_in_time"
  },
  "timeframe": {"signal": "4h", "execution": "4h", "rebalance": "4h"},
  "sampling_and_alignment": {},
  "required_data": ["ohlcv", "funding", "open-interest"],
  "feature_definition": {},
  "target_definition": {
    "target_type": "forward_return",
    "horizon_bars": 3,
    "entry_delay_bars": 1,
    "price_source": "close",
    "cost_adjusted": false
  },
  "forecast_definition": {},
  "signal_definition": {},
  "position_rule": {},
  "portfolio_construction": {},
  "risk_rule": {},
  "execution_rule": {},
  "transaction_cost_model": {},
  "expected_holding_period": {},
  "benchmark": {},
  "validation_plan": {},
  "rejection_criteria": [],
  "trial_group_ref": {
    "trial_group_id": "...",
    "group_hash": "..."
  },
  "candidate_registration": {
    "candidate_ids": ["..."]
  },
  "parent_experiment_id": null,
  "random_seed": 1,
  "code_commit_ref": "...",
  "harness_commit_ref": "...",
  "data_snapshot_ref": "...",
  "assumptions_ref": "...",
  "replay_execution_input": {
    "supplemental_requirement_set_schema_version": "trade.rd-replay-supplemental-requirement-set.v1",
    "supplemental_requirement_set_hash": "sha256"
  }
}
```

Trial Group 必须先于 experiment 注册；contract 的 group hash 必须与 DB 权威行一致。默认一个 Planner run 只创建一条 hypothesis；ablation、有限网格或 operationalization 对照必须在看到结果前进入同一 group。失败后扩大 search space 或改变 selection protocol 必须新建 Trial Group 与 child experiment，不得覆盖原 group/contract。

## 8. Lifecycle State Machine

```text
proposed
  -> blocked
  -> discovery
      -> rejected
      -> needs_modification
      -> draft_frozen
          -> forward_observation
              -> invalidated
              -> needs_modification
              -> shadow_candidate

any open state except suspended -> suspended
replaced experiment    -> superseded
completed handoff      -> closed
resolved blocker       -> proposed
```

状态分组：

| 分组 | States | 语义 |
| --- | --- | --- |
| Open | `proposed` / `blocked` / `discovery` / `draft_frozen` / `forward_observation` / `suspended` | 尚可由合法事件推进；`suspended` 需先恢复到保存的 prior state |
| Terminal for current contract | `rejected` / `needs_modification` / `invalidated` / `shadow_candidate` / `superseded` / `closed` | 当前冻结合同不再执行 |

`needs_modification` 对当前 contract 是终态且 `child_experiment_required=true`；不得 suspended 或原地改合同。`shadow_candidate` 是 RD handoff 终态，后续由 strategy governance 建立自己的生命周期。

`Review Decision ≠ Lifecycle State`。Decision 是 reviewer 对某份 result 的一次裁决；state 是裁决或系统事件应用后的当前投影。允许的 reviewer decision：

```text
reject
modify
accept_for_draft
accept_for_forward
accept_for_shadow_candidate
```

最小映射：

| Current state | Decision | Next state | 约束 |
| --- | --- | --- | --- |
| `discovery` | `reject` | `rejected` | 当前 experiment 终止 |
| `discovery` | `modify` | `needs_modification` | 修改必须创建 child experiment |
| `discovery` | `accept_for_draft` | `draft_frozen` | 历史证据通过，冻结 candidate definition / hash |
| `draft_frozen` | `accept_for_forward` | `forward_observation` | `frozen_at` 后才可收 forward 样本 |
| `forward_observation` | `reject` | `invalidated` | forward 证据否定冻结候选 |
| `forward_observation` | `modify` | `needs_modification` | 不得原地修改 frozen candidate |
| `forward_observation` | `accept_for_shadow_candidate` | `shadow_candidate` | 只形成 shadow 准入建议 |

系统事件承接非 reviewer 路径：proposal 缺字段或 schema / semantic 无效时只产生新 revision，不创建 experiment。已注册 experiment 因外部 blocker 可 `proposed -> blocked`；blocker 关闭且 contract hash 未变时可 `blocked -> proposed`；pre-run gate 通过后 `proposed -> discovery`。注册后才发现合同缺陷则当前 experiment 进入 `needs_modification`，必须创建 child。fingerprint stale 时任一 open state（`suspended` 除外）进入 `suspended`；child 替代父实验时父实验进入 `superseded`。进入 suspended 时保存 `suspended_from_state`；恢复必须重新验证 fresh fingerprint，并按 transition rule 回到该状态。

Reviewer decision 不能直接携带任意 `next_state`。写入器必须将“DB 实际 current state + decision + result stage”解析为唯一 transition rule；例如 `proposed + accept_for_shadow_candidate` 必须被拒绝。决策、状态投影和 KG 关系按 §6 的单事务写入。

本状态机不含 `production_eligible`，也没有 `accept_for_production`。它与正式 strategy policy 生命周期分离：

```text
RD candidate:     proposed ... -> shadow_candidate -> closed
Strategy policy:  draft -> shadow -> live-small | paused
```

规则：

- `accept_for_draft` 只表示历史研究足以冻结策略定义。
- `draft_frozen` 之后才允许消耗 forward holdout。
- `accept_for_forward` 不等于 shadow/live，只允许进入 forward observation。
- `accept_for_shadow_candidate` 必须基于 forward evidence 和执行可行性，但不能直接改 strategy status。
- `live-small` 必须由 fresh replay + 正式 shadow evidence + execution attribution + 人工确认共同放行；RD reviewer 无权裁决真钱资格。

## 9. RD 三角色

### Research Planner

- 选择研究空间：从 L1/L2/L3 节点开始，不从参数开始。
- 先查 `research_scope_status / implementation_scope_status`；非 active 节点不能因 coverage 为空而自动排入研发。
- 找尚未覆盖区域：读取 Universe coverage、Data Surface Registry、Pipeline Registries、Knowledge Graph、rejected lessons。
- 提出 hypothesis：绑定 canonical、经济解释、所需数据面和验证计划。
- 判断数据缺口：缺数据则生成 data backlog，不消耗 trial。
- 排优先级：按收益来源可信度、数据可得性、实现成本、失败密度排序。

Planner 禁止直接指定 live/trading action，禁止绕过 L3 生成随机公式，禁止把已失败机制换名字重跑。

Planner priority scoring：

```text
priority =
  economic_plausibility
+ data_readiness
+ implementation_readiness
+ portfolio_value
- failure_density
- data_cost
- execution_complexity
```

### Developer

- 实现 feature、forecast、signal、position、portfolio、risk、execution 的最小可验证链路。
- 运行 single-asset、panel、campaign、parameter perturbation、negative controls。
- 输出指标、图表和 artifacts，但指标不是 promotion 结论。

Developer 禁止修改 reviewer gate 来让候选通过，禁止用 post-hoc asset exclusion 修补失败，禁止在 draft 落盘前消费 forward holdout。

### Research Reviewer

- 检查未来函数、survivorship bias、过拟合、多重检验。
- 检查成本、funding、borrow、slippage、market impact。
- 检查 availability_at、closed-candle、data surface coverage。
- 给出阶段化 decision，追加写入 result / decision / lesson / knowledge graph；不得覆盖冻结 contract。

## 10. Agent Entry Discipline

Strategy hypothesis designer 不是自由写策略，而是把 scout findings、失败记忆、existing strategies 和本设计文档压缩成一条可校验 proposal；只有 validator 能物化正式 contract。

工作流：

1. 读取本文、machine backlog、P0 certificates、`strategies/*.md`、RD memory 的 failure / gate / rejected / lessons。
2. 先过 scope gate，再选择 L1 Edge、L2 Mechanism Family、L3 Canonical Strategy；不得从参数、指标或随机公式开始。
3. 判断缺的是新数据、新 family、组合语义，还是已有 family 可表达的候选。
4. 默认只提出一条高质量 hypothesis；需要 ablation、有限网格或 operationalization 对照时，只能生成预注册的有限 candidate set。
5. 已有 family 时输出 `trade-flow.rd-experiment-contract.v3` proposal；缺 family 时输出 `trade-flow.rd-family-backlog-contract.v1` proposal。不得输出自由散文、回测或 promotion 结论。
6. proposal 无效则在同一 proposal session 形成 revision；不创建 experiment、不进入 lineage、不消耗 trial。

纪律：

- 先有市场机制，再有参数。
- Universe 只表达收益来源；ML / Statistical Model / Portfolio / Execution 不得写成 Return Driver。
- L2 必须是机制家族；Bollinger / RSI / CVD / Kalman / Avellaneda-Stoikov 属于 registry，不属于 Universe。
- 过滤条件、资产选择、持仓规则、风控几何、成本约束都是策略假说的一部分。
- Feature、Forecast、Signal、Position、Portfolio、Risk、Execution 必须分层表达。
- 资产 universe、target、数据快照、代码 / harness / policy 版本必须写入合同；search space、selection protocol 与预算只以 Trial Group 为权威。
- 已失败机制不能靠 post-hoc exclusion 复活；任何修复都是新 hypothesis。
- `strategies/*.md` 只写通过 gate 的策略 policy；普通研究假说不落正式策略目录。

## 11. Economic Rationale Gate

没有经济解释的实验默认拒绝。至少回答：

- 为什么这个现象应当存在？
- 谁在付钱？
- 为什么不会立刻被套利掉？
- 在什么 regime 下有效？
- 容量和交易成本如何？

例：`Crowded Funding Unwind` 的经济解释不是“VFI + choppiness 赚钱”，而是：

```text
高 beta alt 正 funding 表示杠杆多头拥挤，多头持续向空头付费。
若 OI 上升但 VFI 走弱，价格缺少继续上冲的真实流量支持。
做空者获得 carry，并押注拥挤多头去杠杆。
edge 不会立刻消失，因为该交易承受 squeeze tail、借贷/保证金约束、成交滑点和持仓心理压力。
```

## 12. 模块映射

| 设计概念 | 当前模块 | 需要补强 |
| --- | --- | --- |
| Universe DB | `research-state-store` | `rd_universe_node` / coverage seed / primary + secondary axis |
| Data Surface Registry | `market-data-store`, `research-state-store` | 数据面可得性、availability contract、normalized relation |
| Capability Directory | `strategy-family-engine`, replay modules | 版本化 input/output contract 与 capability tags |
| Proposal / contract | `strategy-hypothesis-designer` + `strategy-hypothesis-contract` | proposal revision、family backlog / experiment 条件 schema、canonical identity hash |
| Trial Group | `candidate-batch-engine`, `rd-program-state` | 预注册 search/selection、trial reservation/accounting、sealed boundary |
| Experiment result | `candidate-batch-engine`, `panel-evaluator` | 受控 stage/type、多 result decision、幂等追加写并进入 KG |
| Lifecycle | `research-state-store`, `rd-supervisor`, `forward-holdout` | 去歧义 rule、结构化 blocker、optimistic concurrency、projection rebuild |
| Evidence / Lesson | `rd-ledger`, `research-evidence-publisher`, `governance-ledger` | relation projection + append-only evidence history |

## 13. 流程

```text
Research Planner
  -> read Universe + Coverage + Registries + Knowledge Graph + Lessons
  -> choose L1/L2/L3 canonical node
  -> emit proposal
     -> missing family: family backlog contract -> stop, zero trial
     -> existing family: register Trial Group -> validate proposal
        -> materialize once -> immutable experiment contract v2

Developer
  -> bind data surfaces
  -> implement feature -> forecast model -> forecast -> signal -> position -> portfolio -> risk -> execution
  -> reserve trial under registered group and budget
  -> run replay / panel / perturbation / negative controls
  -> publish result artifacts

Research Reviewer
  -> audit temporal safety, bias, cost, overfit, multiple testing
  -> reject / modify / accept_for_draft / accept_for_forward / accept_for_shadow_candidate
  -> append result + decision + scoped lesson + KG edges

If accept_for_draft
  -> freeze draft strategy policy
  -> only after draft_frozen: forward observation

If accept_for_shadow_candidate
  -> hand off to strategy governance
  -> RD cannot promote live-small
```

## 14. 迁移计划

1. Seed Universe / scope / axis 与 seed validator：验证树层级、path、无环、scope 继承和 primary axis；taxonomy 随后冻结。
2. Seed Data Surface、capability registry、coverage dimensions 与 result stage/type vocabulary。
3. 落两类 JSON Schema、validated-only proposal revision 与单次物化事务；identity-hash policy 内含 serializer 规则，payload 自带 schema version。
4. 落关系化 Trial Group Candidate、Experiment、Trial 与 Result scope；FK 必须拒绝未注册 candidate、错 hash/policy、跨 experiment trial/result 与 post-hoc expansion。
5. 落 lifecycle bootstrap、seed validator 与 multi-result decision；`accept_for_draft` primary result 必须直接绑定 selected trial，跨 experiment、`__any__`、零 primary 均失败。
6. 安装 INSERT/identity/append-only triggers；验证非法初始 projection、Proposal Header 改写、candidate refreeze、自我/跨-edge supersede、并发与重复物化均失败。
7. 以最小关系表落 KG，只支持可查询 lesson 与证据历史，不建设复杂图推理。
8. Map existing code families:
   - `time_series_momentum_v1` -> Trend / Time-Series Trend
   - `relative_weakness_momentum_v1` -> Trend / Cross-Sectional Momentum
   - `funding_carry_v1` -> Carry / Funding Carry
   - `funding_unwind_risk_guard_v1` -> Carry / Funding Carry / Crowded Funding Unwind
   - `volatility_compression_breakout_v1` -> Volatility / Volatility Regime Transition
   - `structure_breakout_retest_v1` -> Trend / Breakout Continuation / Channel Breakout
9. Make family manifests declare covered `canonical_node_id`, required data surfaces, feature / forecast / signal outputs, and supported portfolio/execution semantics.
10. Only then let agent use active L3 canonical templates；proposal、trial、result、decision、transition 与 lesson 只经 owner store 写入。

## 15. Hard Rules

- Universe 只回答“什么可能赚钱”，不回答“怎么建模、怎么调仓、怎么成交”。
- Universe scope 决定“当前该不该研究”，coverage 只决定“当前做到哪里”；`catalog_only / product_out_of_scope` 不得自动进入 backlog。
- L2 必须是 market mechanism family；Bollinger、RSI、CVD、Kalman、Avellaneda-Stoikov 不能作为 L2。
- L3 canonical strategy 必须稳定；资产、过滤、risk guard、参数属于 hypothesis / pipeline。
- ML、PCA、Kalman、HMM、Risk Parity、Dollar Neutral、TWAP、VWAP 不是 Return Driver。
- Experiment 必须先有经济解释，再有 feature、forecast、signal、position、execution。
- Forecast 表达 target/state 预测，Signal 只表达标准化交易倾向；agent 不得主观生成 calibrated reliability 或 evidence strength。
- 资产选择、target、时间周期、数据快照、代码 / harness 版本、assumptions、trial group、搜索与选择协议都是复现实验的一部分。
- Trial Group 是 search space、selection protocol、多重检验与 trial budget 的唯一事实源；注册后不可扩张。
- Trial 只能引用关系化的预注册 candidate；generated candidate 只能由 group 固定 generator 在允许状态下物化。
- 新机制无 family 时只能生成 Family Backlog Contract，零 trial；不得伪造 `code_family_id` 或完整执行链。
- Proposal Header identity 不可修改；DB 只追加已验证的 `valid / invalid` Revision，不保存 draft；每个 proposal 最多物化一次，registered contract 不可原地修改。
- Result stage/type 使用受控 vocabulary，`__any__` 只属于 transition rule；review decision 只能关联同 experiment 的多条证据。
- Result 必须声明 trial / experiment / trial-group scope；`accept_for_draft` primary result 必须直接绑定 selected trial。
- `draft_frozen` 必须与本 experiment 的 completed trial/candidate 在同一事务首次写入；candidate identity 冻结后不可替换。
- Result、decision、lifecycle event、KG evidence 必须幂等且 append-only；event history 是权威，状态 projection 只能由带 expected version 的原子 writer 更新并可重建。
- KG evidence 只能 supersede 同一 edge 的旧 evidence；identity-hash policy 内含 serializer 规则，payload 自带 schema version，升级不得静默重算。
- 所有 DB / machine timestamp 必须是 RFC 3339 UTC；无时区时间不得进入 forward 或 evidence 边界。
- 本文只定义 Research Control Plane；Replay Execution Plane 内部语义不得由本文默认推断。
- 失败实验必须沉淀为有 hypothesis / regime / asset-universe scope 的 lesson；单次失败不能否定整个 canonical。
- Draft strategy 只能来自 `accept_for_draft`；forward holdout 只能发生在 `draft_frozen` 之后。
- RD 最多形成 `shadow_candidate`；`live-small` 不属于 RD lifecycle，也不能由 reviewer 自动升格。

## 16. Sources

访问日期统一为 `2026-07-14`。外部来源只支撑 taxonomy、实验治理、数据与执行约束，不构成某个 crypto edge 已成立的证据。

| Source ID | 来源 / 版本 | 类型 | 支撑章节 |
| --- | --- | --- | --- |
| `hfr-classification` | [HFR Hedge Fund Strategy Classification System](https://www.hfr.com/hfr-indices/hfr-hedge-fund-strategy-classifications/) | publisher taxonomy / current page | §2、§5 |
| `aqr-alt-risk-premia` | [Understanding Alternative Risk Premia](https://www.aqr.com/Insights/Research/White-Papers/Understanding-Alternative-Risk-Premia) | practitioner research | §2、§5、§11 |
| `aqr-style-premia` | [Understanding Style Premia](https://www.aqr.com/Insights/Research/Journal-Article/Understanding-Style-Premia) | journal article page | §2、§5 |
| `aqr-trend-century` | [A Century of Evidence on Trend-Following Investing](https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing), 2017 | journal article | §2、§5 |
| `white-reality-check-2000` | [A Reality Check for Data Snooping](https://www.ssc.wisc.edu/~bhansen/718/White2000.pdf), 2000 | primary paper | §7、§9、§10 |
| `hansen-spa-2005` | [A Test for Superior Predictive Ability](https://doi.org/10.1198/073500105000000063), 2005 | primary paper | §7、§9 |
| `harvey-liu-zhu-2016` | [And the Cross-Section of Expected Returns](https://www.nber.org/papers/w20592), 2014 working paper / 2016 publication | primary paper | §5、§7 |
| `perpetual-fundamentals` | [Fundamentals of Perpetual Futures](https://arxiv.org/abs/2212.06888) | primary paper / living version | §2、§4、§5、§11 |
| `perpetual-pricing-2024` | [Perpetual Futures Pricing](https://finance.wharton.upenn.edu/~jermann/AHJ-main-10.pdf), 2024-09-03 | primary paper | §2、§4、§5 |
| `bis-crypto-carry-1087` | [Crypto Carry](https://www.bis.org/publ/work1087.pdf), 2023 / revised 2025-10 | institutional working paper | §2、§5、§11 |
| `binance-usdm-market-data` | [Binance USDⓈ-M Futures Market Data REST API](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api) | exchange documentation / current page | §4、§5、§7 |
| `freqtrade-lookahead` | [Freqtrade Lookahead Analysis](https://www.freqtrade.io/en/stable/lookahead-analysis/) | open-source documentation / stable | §5、§7、§9 |
| `quantconnect-reality-modeling` | [QuantConnect Reality Modeling](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts) | open-source platform documentation | §3、§5、§7 |
| `nautilus-docs` | [NautilusTrader Documentation](https://nautilustrader.io/docs/) | open-source platform documentation / latest | §3、§4、§5 |
