---
strategy_id: S-BTC-4H-TREND-PULLBACK
name: BTC 4H Volatility-Managed Trend Pullback
status: draft
tags: [btc, usdm, 4h, swing, momentum, pullback, volatility-managed]
---

# BTC 4H Volatility-Managed Trend Pullback

只做 BTCUSDT USDM 的 4H swing。核心不是预测每根 K 线，而是：

```text
先确认高周期趋势和波动环境
再等价格回到可定义风险的 4H 区域
只用限价 / 条件挂单进场
用 ATR 和结构失效控制仓位
```

## Why This Edge

- 跨资产 time-series momentum 长期存在；crypto 尤其需要波动管理。
- BTC 高频研究显示 intraday momentum / reversal 都存在，但会随跳空、流动性和宏观窗口切换；因此本策略不做纯日内预测。
- 大市值 crypto momentum 有尾部崩溃风险；所以必须用小风险、ATR stop、RR 门槛和 no-trade 规则。
- 短期 reversal edge 更集中在低活跃交易对；BTC 不把均值回归当主策略。
- 移动均线 / 技术规则只做趋势过滤和结构确认，不单独触发交易。

Evidence refs:

- Moskowitz et al., Time Series Momentum: https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum
- Intraday return predictability in cryptocurrency markets: https://www.sciencedirect.com/science/article/abs/pii/S1062940822000833
- Bitcoin intraday time-series momentum: https://centaur.reading.ac.uk/100181/3/21Sep2021Bitcoin%20Intraday%20Time-Series%20Momentum.R2.pdf
- Cryptocurrency momentum tail risk: https://link.springer.com/article/10.1007/s11408-025-00474-9
- Crypto liquidity provision / reversal evidence: https://www.riksbank.se/globalassets/media/rapporter/working-papers/2022/no.-413-trading-volume-and-liquidity-provision-in-cryptocurreny-markets.pdf

Replay refs:

- 2026-07-06 mechanical replay, BTCUSDT 4H, 1000 candles, `S-BTC-4H-TREND-PULLBACK`: `sample_count=53`, `win_rate=0.339623`, `avg_r=-0.00677`, `total_r=-0.358799`, `max_drawdown_r=14.916841`, `profit_factor=0.989506`.
- 2026-07-06 generic replay framework v2, BTCUSDT 4H, 1000 candles, non-overlap lane, stop-first same-candle policy, fee `2 bps`, slippage `1 bps`: `sample_count=23`, `win_rate=0.304348`, `avg_r=-0.200878`, `total_r=-4.620187`, `max_drawdown_r=7.466049`, `profit_factor=0.712825`, replay gate blocked by `R-SAMPLE-SIZE / R-EXPECTANCY / R-PROFIT-FACTOR`.
- Result: not promotable. Keep `status=draft`; next work must improve filters or run shadow only.

## Setup Certificate

```yaml
setup_id: btc-4h-trend-pullback
hypothesis: BTC continuation trades have better expectancy when trend, structure, volatility, and positioning agree; pullback entry improves stop distance versus chasing.
regime: 1D and 4H are not in conflict; 4H structure has a clear support/resistance zone within 0.5-1.5 ATR from current price.
entry_rule: enter only at the pullback/retest zone in the trend direction; use LIMIT or STOP_LIMIT, never MARKET for new risk.
stop_rule: stop beyond structure invalidation plus 0.25-0.5 * 4H ATR buffer; invalidation must be visible before sizing.
no_trade_conditions: mid-range price, 1D/4H conflict, stale observe, extreme funding against the trade, spread abnormal, RR < 2, or no nearby structural invalidation.
size_policy: risk_budget_usdt <= min(0.5% equity, account_config cap); initial live-small candidate must use <= 0.25-0.5% equity.
evidence_ref: draft only; requires replay plus shadow before live-small.
live_permission: draft
```

## Required Inputs

- `binance-account-snapshot`: equity, available balance, BTC position, BTC open orders.
- `binance-symbol-snapshot`: mark/index, spread, funding, open interest.
- `ohlcv-fetch`: `1d,4h,1h`.
- `tech-indicators`: EMA/SMA, ATR, support/resistance, trendlines, structure validation, selected momentum/volume indicators.
- Optional: `binance-aggtrades-fetch` + `binance-liquidation-zones`; only for refs / target risk, never as sole trigger.

## Signal Stack

### 1. Regime Filter

Long regime requires:

- 1D trend is bullish or neutral-bullish, not bearish.
- 4H price is above or reclaiming EMA50/EMA200 band.
- Latest 4H support validation is respected or structure is reclaiming.

Short regime requires:

- 1D trend is bearish or neutral-bearish, not bullish.
- 4H price is below or rejecting EMA50/EMA200 band.
- Latest 4H resistance validation is respected or structure is breaking down.

If 1D and 4H disagree, output `no_action`.

### 2. Location Filter

Only trade from a zone where stop can be tight and explainable:

- Long: 4H support / reclaim zone / EMA pullback zone.
- Short: 4H resistance / rejection zone / EMA pullback zone.
- Distance from current price should usually be `0.5-1.5 * 4H ATR`.
- If price is in the middle between support and resistance, output `no_action`.

### 3. Confirmation Filter

Confirmation can support the trade, but cannot override regime/location:

- 1H momentum turns back in trade direction after pullback.
- 4H ATR is not exploding beyond normal range.
- Volume / VPCI / CMF does not contradict the direction.
- Funding is not extremely crowded against the trade.
- OI expansion agrees with trend continuation, or OI contraction does not invalidate the setup.

If confirmation is mixed, reduce size or output `no_action`.

### 4. Execution Rule

Allowed `target_action`:

- `place_entry`
- `no_action`

Allowed order shapes:

- Pullback entry: `LIMIT`
- Break / reclaim entry: `STOP_LIMIT` only when structure is clean enough; otherwise no action

Not allowed:

- MARKET entry for new risk.
- Adding to a losing position.
- Countertrend trade because RSI/Williams is overbought/oversold.
- Entry based only on liquidation-like zone.

## Sizing

Formula:

```text
risk_per_unit = abs(entry - stop)
quantity = risk_budget_usdt / risk_per_unit
quantity must satisfy exchange step/min rules
notional must fit available balance and leverage policy
```

Risk caps:

- Draft/shadow: paper only.
- First live-small after validation: max `0.25% equity`.
- Normal live-small cap after review: max `0.5% equity`.
- If account has meaningful existing unrealized drawdown, halve the risk budget.

## Targets

Use structure first, not fixed percentages:

- TP1 at nearest opposing 4H level.
- TP2 at next 1D/4H level.
- TP3 only if trend continuation remains valid.

Default scale-out:

```text
TP1: 50%
TP2: 30%
TP3: 20%
```

Minimum expected `RR_net`: `2.0`.

## No-Trade Checklist

Output `no_action` if any is true:

- Observe age > 30s.
- BTC has existing position/order in same lane that is not reconciled.
- 1D and 4H direction conflict.
- Price is mid-range.
- Stop cannot be defined before entry.
- Entry-to-stop is wider than `1.25 * 4H ATR` without proportional RR.
- Funding is extreme and crowded against the trade.
- Upcoming major macro/event window is not explicitly allowed.
- Liquidation-like zone is the only reason to trade.

## Decision Output Contract

The agent must reduce analysis into exactly one of:

```text
no_action
place_entry
```

For `place_entry`, the plan must include:

```yaml
direction_state: 偏多已确认 | 偏空已确认
execution_verdict: 等回踩 | 等条件
entry_intent: exact order type, zone, and why not market
exit_intent: stop and TP ladder
invalidation: structural invalidation
stop_price: number
risk_budget_usdt: number
expected_rr_net: number
action_intent.request:
  symbol: BTCUSDT
  side: BUY | SELL
  type: LIMIT | STOP
  price: number
  stop_price: number?
  quantity: number?
  increases_risk: true
```

If any required field is missing, output `no_action`.
