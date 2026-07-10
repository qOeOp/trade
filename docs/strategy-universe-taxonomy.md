---
title: Strategy Universe Taxonomy
updated_at: 2026-07-10 CST
machine_backlog: data/rd/family-backlog.json
p0_certificates: data/rd/p0-family-certificates.json
---

# Strategy Universe Taxonomy

结论：当前可跑 family 只是项目策略语言的最小子集，不是市场策略宇宙。RD 的起点必须从“收益来源、组合形态、数据面、执行语义”出发，而不是从几个 K 线形态里反复调参。

本文件是 source-backed 研究地图。它负责决定“应该研究什么、缺什么、先补什么”；`data/rd/family-backlog.json` 是机器可读版本，`data/rd/p0-family-certificates.json` 固化 P0 family 的 hypothesis / data contract / negative controls / fixture plan，供 planner / scout / learning memory 消费。分类不是 strategy promotion gate，任何 family 进入 shadow 前仍必须通过 replay / OOS / negative controls / cost / regime / locked holdout / shadow evidence。

## 1. 外部分类锚点

| 来源 | 可吸收分类 | 对本项目的含义 |
| --- | --- | --- |
| HFR strategy classifications | equity hedge、event-driven、macro、relative value、risk parity、blockchain | 机构 taxonomy 按收益来源和组合结构组织，不能只按图形形态组织 |
| AQR alternative risk premia | value、momentum、carry、defensive、trend、volatility | family 应围绕风险溢价、行为偏差或结构性约束组织 |
| Trend-following 文献 | time-series momentum / managed futures | 单资产 TSM 只是最小表达，还缺组合、波动目标、跨资产趋势 |
| Cross-sectional asset pricing | momentum、reversal、value、liquidity、quality、size | panel RD 应支持横截面排序和负对照，不应把每个资产孤立跑一遍 |
| Crypto perp / futures 文献 | funding、basis、premium、open interest、leverage pressure | crypto-native edge 不能只看 OHLCV；funding / carry / basis 是独立大类 |
| Market microstructure / LOB | spread、depth、order imbalance、impact、adverse selection | marketability / execution reality 应前置为 gate 或 family，不只是事后扣费 |
| 开源量化实践 | lookahead、fees、slippage、walk-forward、live decay | taxonomy 只给研究入口；真实资格仍由可复现实验和外部验证决定 |

## 2. 三层分类轴

### A. Return Driver

| Driver | 子类 | 当前覆盖 | 首要风险 |
| --- | --- | --- | --- |
| Trend / momentum | time-series trend、breakout continuation、cross-sectional winners、trend pullback | 部分覆盖 | 负对照未打败、regime 不稳、样本少 |
| Mean reversion | short-horizon reversal、range reversion、overextension fade、post-sweep reversal | panel reversal 起步 | 容易把反弹噪音当 edge |
| Carry / funding / basis | perp funding harvest、basis convergence、premium decay、roll / borrow carry | 缺失 | 数据 point-in-time、资金费时点、对冲成本 |
| Relative value / spread | pairs、beta-neutral basket、cointegration、cluster spread | 缺失 | 双腿 replay、pair selection snooping、成本翻倍 |
| Liquidity / marketability | turnover、spread proxy、impact proxy、capacity、slippage resilience | scorer 起步 | OHLCV proxy 粗糙，不能代替 L2 |
| Microstructure / order flow | taker imbalance、depth imbalance、adverse selection、queue / maker fill | 缺失 | 4H 证据弱，短周期数据治理重 |
| Forced flow / liquidation | liquidation cascade、stop-run sweep、post-sweep continuation / reversal | 缺失 | 事件聚合因果性、交易所覆盖和缺口 |
| Volatility / convexity | realized-vol breakout、vol carry、skew、term structure、gamma | 仅 OHLCV VCB | options 数据缺失，旧 VCB 易重命名 |
| Event / calendar | funding window、expiry、listing、unlock、macro / news | 缺失 | 事件时间戳 availability 和幸存者偏差 |
| Regime / allocation | risk-on/off router、vol targeting、breadth、family allocator | 零散 gate | router 容易事后解释，不能偷看 |

### B. Portfolio Shape

| Shape | 示例 | 当前覆盖 | 关键 replay gap |
| --- | --- | --- | --- |
| Single-asset directional | BTC 4H long / short setup | 已覆盖 | 已有持仓冲突和成本语义 |
| Cross-sectional long-only | 每期 rank top assets，持有 top basket | panel research 起步 | 组合 rebalance、权重、资金占用 |
| Cross-sectional long/short | long winners / short losers | panel research 起步 | 多腿同步执行、净暴露、成本和 funding |
| Hedged relative value | long A short B / beta-neutral basket | 缺失 | pair ledger、beta hedge、双腿退出 |
| Carry book | long / short funding 或 basis book | 缺失 | funding cashflow、hedge asset、borrow / margin |
| Liquidity / execution book | marketability allow-list、capacity cap、maker/taker route | scorer 起步 | depth / spread 历史、成交概率 |
| Strategy allocator | 按 regime 选择 family 或 no-trade | 缺失 | allocator 的 out-of-sample 评估和漏斗审计 |

### C. Data Surface

| Surface | 数据 | 当前状态 | 必须治理的问题 |
| --- | --- | --- | --- |
| OHLCV | closed candles | 已有 | closed-only、checksum、manifest、coverage |
| Derived TA features | feature report / factor series | 已有 | causal alignment、缓存命中、跨 split 隔离 |
| Panel OHLCV | 多资产同周期 candles | 已有 | row coverage、时间对齐、survivorship |
| Funding / premium / OI | fundingRate、premiumIndex、openInterest | fundingRate 已封装 | premium / OI 长历史、结算时间、缺口 >9h 标记 |
| Taker / aggTrades | taker buy/sell、aggTrades、volume burst | 部分 tool | 压缩到 causal bars、长历史成本 |
| Liquidation-like | force orders 或 inferred zones | 部分 tool | 真实来源、缺口、事件可得性 |
| L2 / depth | bid/ask、depth、spread、imbalance | 短窗为主 | 历史深度、队列、maker fill |
| Spot / dated futures | spot price、dated futures、borrow / margin | 缺失 | basis / hedge 成本和交易限制 |
| Options / vol | IV、skew、term structure、OI、gamma | 缺失 | 数据源、合约 survivorship、执行模型 |
| Event / on-chain / news | event timestamp、flows、unlock、macro | 缺失 | point-in-time availability、标签偏差 |

## 3. Expanded Strategy Map

| Category | Backlog ids | First executable surface | Current status | Stop condition before trials |
| --- | --- | --- | --- | --- |
| Directional trend / momentum | `time_series_momentum_v1`, `trend_pullback_v1`, `structure_breakout_retest_v1`, `volatility_compression_breakout_v1`, `relative_weakness_momentum_v1` | single-asset replay | implemented_single_asset_replay | 若同机制已被 null / OOS / regime 拒绝，必须换机制或数据面 |
| Cross-sectional ranking | `cross_sectional_momentum_v1`, `cross_sectional_reversal_v1` | `strategy-panel-rnd` | implemented_panel_research | 需 rank-shift / asset-shuffle 负对照和 marketability gate |
| Carry / funding / basis | `funding_carry_v1`, `basis_relative_value_v1` | funding-aware replay first | mixed | `funding_carry_v1` 可研究但本轮未过成本/灾难亏损；basis 仍缺 spot / futures 数据 |
| Relative value / spread | `pairs_relative_value_v1` | family design | design_backlog | 未有双腿 replay、pair selection ledger、hedged cost model |
| Liquidity / marketability | `marketability_score_v1` | `strategy-panel-rnd` | implemented_panel_scorer | 只能过滤 universe，不能单独 promotion |
| Forced flow / liquidation | `liquidation_sweep_reversal_v1` | data governance first | data_blocked | force-order / aggTrades 质量与 causal aggregation 未齐 |
| Microstructure / order flow | `orderflow_imbalance_v1`, `market_making_v1` | research only | mostly_out_of_scope_now | 4H swing 不适配或缺 L2 历史，不作为当前主线 trial |
| Volatility / options | `volatility_regime_breakout_v1`, `options_vol_carry_v1` | OHLCV vol first, options later | mixed | 不能把旧 VCB 改名为新 family；options 数据缺失 |
| Event / calendar | `news_event_v1`, funding-window variants | data governance first | data_blocked | 事件 availability、timestamp 和 survivorship 未齐 |
| Regime / allocator | `regime_router_v1` | router / gate design | design_backlog | router 先做 allow-list / no-trade，不直接交易 |

## 4. RD 消费方式

每轮新 hypothesis 必须先声明：

- `return_driver`：本轮验证哪类收益来源。
- `portfolio_shape`：单资产、横截面、多腿、carry book 还是 allocator。
- `data_surface`：需要哪些 point-in-time 数据；缺数据则先做数据治理，不消耗策略 trial。
- `implementation_gap`：已有 family 可表达，还是必须新增 family / replay 语义。
- `negative_controls`：机制专属负对照；单资产至少 side-flip / entry-lag，横截面至少 rank-shift / asset-label shuffle。
- `promotion_boundary`：research scorer、panel research、single-asset replay、shadow candidate 的边界必须写清。

这意味着 taxonomy 是 RD loop 的入口约束，不是事后解释标签。若 return driver 没有可执行 family，进入 family backlog；若 family 存在但缺数据，进入 data backlog；若两者都有，才进入策略 trial budget。

## 5. Family Backlog

### P0: 最贴合当前系统

| Family | 机制 | 数据需求 | 首个可执行版本 | 状态 |
| --- | --- | --- | --- | --- |
| `cross_sectional_momentum_v1` | 多资产 winner continuation | panel OHLCV + marketability | rank N 日收益 / trend quality，做 top vs cash 或 top/bottom | implemented_panel_research |
| `cross_sectional_reversal_v1` | 多资产过度偏离后的回归 | panel OHLCV + volatility / liquidity filters | rank relative underperformance / overextension，测试 reversion | implemented_panel_research |
| `funding_carry_v1` | funding / premium 相关 carry | funding history、premiumIndex、OI、cost | directional funding-aware replay；hedged carry 后置 | implemented_single_asset_replay |
| `marketability_score_v1` | 容量、换手、滑点韧性 | volume、range、impact proxy、coverage | universe gate / scorer，不直接升策略 | implemented_panel_scorer |
| `regime_router_v1` | 决定哪些 family 在哪些 regime 可运行 | realized vol、trend、breadth、funding、beta | no-trade / allow-list router | design_backlog |

### P1: 需要补数据或 replay 语义

| Family | 机制 | 缺口 |
| --- | --- | --- |
| `liquidation_sweep_reversal_v1` | 清算 / 扫止损后反转或延续 | force-order / aggTrades 质量标记与 causal aggregation |
| `pairs_relative_value_v1` | spread / beta-neutral 回归 | pair selection ledger、hedged replay、双腿成本 |
| `basis_relative_value_v1` | futures / spot / perp basis convergence | spot、dated futures、margin / borrow / hedge 约束 |
| `orderflow_imbalance_v1` | taker / depth imbalance 短期预测 | 更短周期与 L2 / trade flow；4H swing 证据弱 |
| `volatility_regime_breakout_v1` | realized-vol / range expansion by regime | 可复用 OHLCV，但必须和旧 VCB 机制区分 |

### P2: 当前产品边界外或数据缺口大

| Family | 原因 |
| --- | --- |
| `market_making_v1` | 需要 L2、queue、maker fill、库存模型；不适合当前 4H+ swing |
| `options_vol_carry_v1` | 需要 options IV / skew / term structure 和 options execution |
| `onchain_flow_v1` | 需要 point-in-time on-chain 数据治理 |
| `news_event_v1` | 需要 event timestamp、availability、survivorship 约束 |

## 6. Family 入场标准

新增 family 进入代码前至少要有：

- hypothesis certificate：edge 类型、参与者、regime、失效条件、成本敏感度、candidate universe、negative controls。
- replay semantics：入场、出场、持仓冲突、成本、funding / borrow / hedge 口径。
- data contract：字段、来源、availability_at、缺口标记、checksum。
- negative controls：该机制对应的负对照，而不是只复用单资产 side-flip。
- 最小 fixture：一个正例、一个空信号、一个明显失败样本。
- artifact contract：输出必须能进入 catalog，且 summary 不误读 scorer 为收益。

没有这些，family backlog 只能停在文档和机器 backlog 层，不能变成可跑策略模板。

P0 family 的当前证书已落在 `data/rd/p0-family-certificates.json`。`certificate_status=data_blocked` 或 `design_blocked` 的 family 不消耗策略 trial；`ready_for_panel_research` 仍只允许 research artifact，不允许直接落 `strategies/` policy。

## 7. 实现准则

- 新 family 必须先写 hypothesis certificate，再写 replay / panel 语义。
- 新 family 不等于放宽搜索：仍受 trial budget、parameter count、locked holdout、panel、negative controls 限制。
- 优先实现能复用现有数据治理的 family：OHLCV panel、funding / premium / OI、feature report。
- 每个 family 必须声明 data surface 和 temporal contract；没有 point-in-time 数据就只能做 research，不可准入。
- `strategy-panel-rnd` family 和 `strategies/` policy 是两层边界；panel research 通过不等于落盘策略。
- `marketability_score_v1` 是 universe gate，不是 trading edge；报告必须避免把 score 当 R。

## 8. Implementation Notes

- `cross_sectional_momentum_v1` / `cross_sectional_reversal_v1` 已进入 `strategy-panel-rnd` 的 panel-level research 路径：同一时点对多资产排序，按 top / bottom rank 构造组合样本，并用 rank-shift negative control 做横截面负对照。
- 这两个 family 还不是单资产 replay family，也不直接生成可 promotion 的 strategy policy；若后续要进入 shadow，需要补 portfolio construction contract、position sizing、组合持仓冲突、资金占用与多腿执行语义。
- `marketability_score_v1` 已进入 `strategy-panel-rnd` 的 panel-level scorer / gate：用 OHLCV 的 median quote volume、range、impact proxy 和 row coverage 诊断资产是否适合作为策略候选 universe。它不是 standalone trading family；通过也只能授权“继续研究”，不能授权 strategy promotion。
- 当前学习记忆显示：BTC 单资产 VCB / TSM / trend pullback / structure retest 已多轮失败；继续同类调参不是新 hypothesis，除非引入不同 return driver 或不同数据 surface。
- `funding_carry_v1` 已接入 exact funding events：`ohlcv-fetch` 生成 funding-aware market feature report，`--funding-carry-governance` 先验检查覆盖，replay 按实际 funding settlement 计现金流，panel artifact 保存逐资产 coverage/count/hash。2026-07-10 的 8 资产实跑未产出策略，主要被成本韧性与单资产灾难亏损拦住。
- 下一条高价值主线是：补 funding-specific time-shift null 和成本/灾难亏损诊断；若 funding carry 仍失败，再转入新的 return driver，而不是继续调同一阈值。

## 9. Sources

- HFR strategy classifications: https://www.hfr.com/hfr-indices/hfr-hedge-fund-strategy-classifications/
- AQR, alternative risk premia research: https://www.aqr.com/Insights/Research/White-Papers/Understanding-Alternative-Risk-Premia
- AQR, style premia research: https://www.aqr.com/Insights/Research/Journal-Article/Understanding-Style-Premia
- Hurst / Ooi / Pedersen, trend-following evidence: https://www.aqr.com/Insights/Research/White-Papers/A-Century-of-Evidence-on-Trend-Following-Investing
- White, Reality Check for Data Snooping: https://www.ssc.wisc.edu/~bhansen/718/White2000.pdf
- Hansen, Superior Predictive Ability: https://www.jstor.org/stable/27638834
- Harvey / Liu / Zhu, factor zoo multiple testing: https://www.nber.org/papers/w20592
- Open Source Asset Pricing: https://www.openassetpricing.com/
- He / Manela / Ross / von Wachter, Fundamentals of Perpetual Futures: https://arxiv.org/abs/2212.06888
- Ackerer / Hugonnier / Jermann, Perpetual Futures Pricing: https://finance.wharton.upenn.edu/~jermann/AHJ-main-10.pdf
- BIS working paper, crypto carry: https://www.bis.org/publ/work1087.pdf
- Binance derivatives market data docs: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api
- Freqtrade lookahead analysis: https://www.freqtrade.io/en/stable/lookahead-analysis/
- QuantConnect reality modeling: https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts
- NautilusTrader docs: https://nautilustrader.io/docs/
