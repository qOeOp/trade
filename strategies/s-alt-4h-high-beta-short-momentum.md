---
strategy_id: S-ALT-4H-HIGH-BETA-SHORT-MOMENTUM
contract_schema_version: 1
name: Alt 4H High Beta Short Momentum
status: draft
tags: [alt, usdm, 4h, swing, high-beta, momentum, short, stc]
---

# Alt 4H High Beta Short Momentum

只研究高 beta alt USDM 永续的 4H 空头动量延续；当前为 validation 未通过的 draft contract。

Research refs:

- Candidate mechanism: high-beta alt downside momentum continuation with STC bearish filter and executable break-even protection.
- 2026-07-10 split validation: fixed candidate rerun after `--strategy-data-split`; validation outcome `no_promote`, pooled `sample_count=364`, `avg_r=0.021334`, `total_r=7.765575`, positive assets `5/10`; blocked by breadth and cost stress. Locked holdout remains unopened.
- Promotion state: `draft` only; no paper sample from this contract is formal shadow evidence until the strategy itself is promoted to `shadow`.

## Trade Contract

```yaml
setup_id: alt-4h-high-beta-short-momentum
engine: rnd_family_v1
hypothesis: High-beta alt downside momentum with STC bearish filter and 0.5R break-even protection may persist after large downside impulse.
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
  scope: high-beta liquid alt USDM perpetuals
  split_policy: use strategy-data-split before any validation claim
execution:
  entry_rule: when 120-bar downside momentum is at least 3 ATR and STC is below 50 on a closed 4H candle; enter next open or equivalent executable quote only.
  stop_rule: signal candle high plus 1 ATR.
  target_rule: fixed 2R; no discretionary target relocation.
  no_trade_conditions: symbol outside the current split universe, stale closed 4H data, missing STC feature, risk wider than 2.5 ATR, funding or spread abnormal, unresolved existing lane exposure, or setup not causally available before entry.
proof:
  current_split_validation: no_promote; sample_count=364; avg_r=0.021334; total_r=7.765575; positive_assets=5/10
  evidence_ref: tmp/artifacts/strategy-rnd/alt-4h-high-beta-short-momentum-validation-2026-07-10-a.json
  blocked_by: PANEL-BREADTH and PANEL-COST
  live_permission: draft_only
  next_required_proof: do not open locked holdout or shadow; only a newly predeclared mechanism may restart from strategy-data-split.
```
