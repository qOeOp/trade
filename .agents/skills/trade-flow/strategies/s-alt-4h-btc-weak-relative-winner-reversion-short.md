---
strategy_id: S-ALT-4H-BTC-WEAK-RELATIVE-WINNER-REVERSION-SHORT
name: Alt 4H BTC-Weak Relative Winner Reversion Short
status: draft
tags: [alt, usdm, 4h, swing, relative-strength, reversion, btc-regime, short]
---

# Alt 4H BTC-Weak Relative Winner Reversion Short

只研究 BTC 已处于弱势 4H regime 时，仍显著强于 BTC 的 liquid alt 是否在 bearish reversal close 后回落。它不是高 beta 动量追空，也不是弱势里抄底相对输家。

Research refs:

- 2026-07-09 VCB long continuation external panel rejected: best prior compression breakout candidates turned negative on `AVAX/NEAR/DOT/LTC/BCH/TRX/ATOM/UNI`; no VCB strategy was drafted.
- 2026-07-09 BTC-weak relative loser long reversion rejected: three variants all had negative pooled expectancy; weakest was `RRV-L-BTCWEAK-180-1R-RC` with `total_r=-199.35362`, 0/8 assets positive.
- 2026-07-09 BTC-weak relative winner short reversion found one mechanism candidate but failed broad-universe risk:
  - `RRV-S-BTCWEAK-180-1R-RC`: `sample_count=1322`, `avg_r=0.048568`, `total_r=64.207004`, 7/8 assets positive.
  - panel asset-shuffle null passed: observed `64.207004` vs p95 `-7.861288`, empirical p `0.04`.
  - blocked by `PANEL-CATASTROPHIC`: `TRXUSDT` had `total_r=-28.993152`, `max_drawdown_r=41.550344`.
- 2026-07-09 contaminated risk-repair diagnostic: `break_even_after_r=0.5` reduced TRX total loss to `-20.827928R` but kept max drawdown at `38.210113R`; `break_even_after_r=1` was worse and added UNI max drawdown veto. Break-even protection is not the fix.
- 2026-07-09 contaminated non-TRX external panel diagnostic on `SOL/AVAX/LINK/UNI/DOT`: original `RRV-S-BTCWEAK-180-1R-RC` passed current panel gate with `sample_count=198`, `avg_r=0.039616`, `total_r=7.844068`, 4/5 assets positive, no catastrophic assets, panel asset-shuffle passed. SOL was negative (`total_r=-7.973003`) and the panel was already viewed by prior R&D, so this is mechanism support only.
- Result: broad liquid-alt version is not promotable. A narrower non-defensive / non-TRX-like universe is only a new hypothesis; break-even repair is rejected; fresh panel or forward holdout after freeze is mandatory.

## Setup Certificate

```yaml
setup_id: alt-4h-btc-weak-relative-winner-reversion-short
hypothesis: When BTC has declined over the last 180 closed 4H candles, liquid alts that remain at least 1 ATR stronger than BTC may be crowded relative winners and mean-revert lower after a bearish 4H reversal close.
timeframe: 4h
family: relative_weakness_momentum_v1
side: short
signal_mode: reversion
confirmation_mode: reversal_close
benchmark: BTCUSDT
benchmark_timeframe: 4h
lookback_bars: 180
relative_threshold_atr: 1
benchmark_return_max: -0.03
stop_atr: 1
max_risk_atr: 2.5
reward_risk: 2
max_hold_bars: 12
fee_bps: 2
slippage_bps: 1
adverse_funding_bps_per_8h: 1
candidate_universe: liquid alt USDM contracts excluding TRX-like defensive / low-beta payment-chain behavior only if that exclusion is predeclared before the next unseen panel.
entry_rule: BTC 180-bar return <= -3%; alt relative move versus BTC >= 1 ATR; latest closed 4H candle is bearish and closes below previous close; enter next open or equivalent executable quote only.
stop_rule: signal candle high plus 1 ATR.
target_rule: fixed 2R; no discretionary target relocation.
no_trade_conditions: broad universe including unresolved TRX-like symbols, stale closed 4H data, missing BTC benchmark manifest, risk wider than 2.5 ATR, abnormal funding/spread, existing same-lane exposure, no bearish reversal close, or candidate data viewed before freeze being used as locked holdout.
evidence_ref: tmp/artifacts/strategy-rnd/relative-btc-weak-overstrong-short-2026-07-09.json
diagnostic_refs:
  - tmp/artifacts/strategy-rnd/relative-btc-weak-overstrong-short-be-diagnostic-2026-07-09.json
  - tmp/artifacts/strategy-rnd/relative-btc-weak-overstrong-short-external-nontrx-diagnostic-2026-07-09.json
blocked_by: PANEL-CATASTROPHIC on TRXUSDT
locked_holdout_start: after 2026-07-09 strategy freeze; viewed 2021-01-01 through current panel data is contaminated for promotion.
live_permission: draft_only
next_required_proof: predeclared narrower universe excluding TRX-like defensive/low-beta behavior plus fresh non-overlapping panel or forward locked holdout; then shadow evidence with execution attribution.
```
