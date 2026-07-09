---
strategy_id: S-ALT-4H-HIGH-BETA-SHORT-MOMENTUM
name: Alt 4H High Beta Short Momentum
status: draft
tags: [alt, usdm, 4h, swing, high-beta, momentum, short, stc]
---

# Alt 4H High Beta Short Momentum

只研究高 beta alt USDM 永续的 4H 空头动量延续，不做单币点位预测，不允许直接 shadow。

Research refs:

- 2026-07-09 predeclared discovery basket: `OP/ARB/SUI/INJ/SEI`; validation basket: `APT/RUNE/TIA/JUP/WIF`.
- Initial discovery killed long-side continuation and unfiltered short variants due to breadth or catastrophic-loss gates.
- Risk-capped discovery found one survivor: `TSM-S-HB-120-3R-H12-STC-BEAR`, pooled `sample_count=797`, `avg_r=0.072409`, `total_r=57.709633`, 5/5 assets positive, blocked only by diagnostic marker.
- Full discovery accepted the same frozen candidate: 5/5 assets positive, per-asset null passed 5/5 required 3, no blocked gates.
- 2026-07-09 unseen validation rejected the frozen candidate: pooled `sample_count=755`, `avg_r=0.059392`, `total_r=44.840722`, 4/5 assets positive, per-asset null passed 4/5, but blocked by `PANEL-OOS` and `PANEL-CATASTROPHIC`; APT max drawdown was `18.127905R`, above the 15R veto.
- 2026-07-09 post-failure diagnostic after adding executable break-even protection showed `break_even_after_r=0.5` removed the catastrophic veto on the already-seen validation basket: pooled `sample_count=902`, `avg_r=0.060957`, `total_r=54.983484`, 5/5 assets positive; still blocked by `PANEL-OOS`. This is contaminated diagnostic evidence only, not validation.
- Result: useful research direction, not a usable strategy. The edge may exist, but current exit/risk model is not stable enough for shadow.

## Setup Certificate

```yaml
setup_id: alt-4h-high-beta-short-momentum
hypothesis: High-beta alt downside momentum may have conditional positive expectancy when STC is bearish, but the current fixed-exit rule failed unseen validation stability and catastrophic-loss gates.
symbols_discovery: [OPUSDT, ARBUSDT, SUIUSDT, INJUSDT, SEIUSDT]
symbols_validation: [APTUSDT, RUNEUSDT, TIAUSDT, JUPUSDT, WIFUSDT]
timeframe: 4h
family: time_series_momentum_v1
side: short
lookback_bars: 120
threshold_atr: 3
stop_atr: 1
max_risk_atr: 2.5
reward_risk: 2
max_hold_bars: 12
filter: stc.value < 50
diagnostic_risk_repair: break_even_after_r=0.5 removed catastrophic veto on already-seen validation data, but did not solve OOS instability.
entry_rule: when 120-bar downside momentum is at least 3 ATR and STC is below 50 on a closed 4H candle; enter next open or equivalent executable quote only.
stop_rule: signal candle high plus 1 ATR.
target_rule: fixed 2R; no discretionary target relocation.
no_trade_conditions: symbol outside declared research baskets, stale closed 4H data, missing STC feature, risk wider than 2.5 ATR, funding or spread abnormal, unresolved existing lane exposure, or setup not causally available before entry.
evidence_ref: discovery passed, unseen validation failed on 2026-07-09.
live_permission: draft
```
