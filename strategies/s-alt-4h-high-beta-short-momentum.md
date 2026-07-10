---
strategy_id: S-ALT-4H-HIGH-BETA-SHORT-MOMENTUM
contract_schema_version: 1
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
- 2026-07-09 fresh unseen basket `FIL/AAVE/ETC/LDO/ORDI/1000PEPE` rejected the repaired `break_even_after_r=0.5` candidate: pooled `sample_count=1120`, `avg_r=-0.029309`, `total_r=-32.826083`, only 2/6 assets positive, blocked by breadth, OOS, cost, and catastrophic gates. Zero-cost control still failed with `total_r=-9.301431`.
- Result: rejected as a general high-beta alt short-momentum strategy. Stop this hypothesis; do not spend more trials tuning STC / break-even variants without a new market mechanism.

## Trade Contract

```yaml
setup_id: alt-4h-high-beta-short-momentum
engine: rnd_family_v1
hypothesis: High-beta alt downside momentum with STC bearish filter and 0.5R break-even protection failed fresh unseen validation.
timeframe: 4h
family: time_series_momentum_v1
candidate:
  side: short
  lookback_bars: 120
  threshold_atr: 3
  break_even_after_r: 0.5
  factor_filter_note: stc.value < 50
risk:
  stop_atr: 1
  max_risk_atr: 2.5
  reward_risk: 2
  max_hold_bars: 12
cost_model:
  fee_bps: 2
  slippage_bps: 1
  adverse_funding_bps_per_8h: 1
universe:
  discovery: [OPUSDT, ARBUSDT, SUIUSDT, INJUSDT, SEIUSDT]
  seen_validation: [APTUSDT, RUNEUSDT, TIAUSDT, JUPUSDT, WIFUSDT]
  fresh_validation: [FILUSDT, AAVEUSDT, ETCUSDT, LDOUSDT, ORDIUSDT, 1000PEPEUSDT]
execution:
  entry_rule: when 120-bar downside momentum is at least 3 ATR and STC is below 50 on a closed 4H candle; enter next open or equivalent executable quote only.
  stop_rule: signal candle high plus 1 ATR.
  target_rule: fixed 2R; no discretionary target relocation.
  no_trade_conditions: symbol outside declared research baskets, stale closed 4H data, missing STC feature, risk wider than 2.5 ATR, funding or spread abnormal, unresolved existing lane exposure, or setup not causally available before entry.
proof:
  diagnostic_risk_repair: break_even_after_r=0.5 removed catastrophic veto on already-seen validation data, but did not solve OOS instability.
  fresh_validation: failed; total_r=-32.826083, positive_assets=2/6, zero_cost_total_r=-9.301431.
  evidence_ref: discovery passed, seen validation failed, risk-repair diagnostic improved drawdown, fresh validation failed on 2026-07-09.
  blocked_by: PANEL-OOS and fresh validation negative expectancy
  live_permission: draft_only
  next_required_proof: stop this hypothesis unless a new causal mechanism is defined before new trials.
```
