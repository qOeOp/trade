---
strategy_id: S-ALT-4H-BTC-STRONG-RELATIVE-REVERSION-SHORT
contract_schema_version: 1
name: Alt 4H BTC-Strong Relative Reversion Short
status: draft
tags: [alt, usdm, 4h, swing, relative-strength, reversion, btc-regime, short]
---

# Alt 4H BTC-Strong Relative Reversion Short

只研究 BTC 处于强势 4H regime 时，非 meme 主流 alt 相对 BTC 过度走强后的短线回落。它不是高 beta 空头动量延续，也不是全市场 meme short。

Research refs:

- 2026-07-09 relative momentum diagnostics failed: BTC weak + short weaker alts had `avg_r=-0.040144`; BTC strong + long stronger alts had `avg_r=-0.1358`.
- 2026-07-09 raw relative reversion found a mechanism but failed catastrophic risk: BTC strong + short over-strong alts had `sample_count=705`, `avg_r=0.085355`, `total_r=60.175337`, 6/6 assets positive, but 1000PEPE exceeded the drawdown veto.
- 2026-07-09 stricter overextension thresholds did not fix the meme/high-beta tail; 1000PEPE remained the failure source. The universe was narrowed to non-meme major/high-beta alts as a new hypothesis, not as post-hoc permission.
- 2026-07-09 non-meme seen panel `FIL/AAVE/ETC/LDO/ORDI` passed raw reversion: `sample_count=540`, `avg_r=0.110252`, `total_r=59.535922`, 5/5 assets positive.
- 2026-07-09 external asset panel `SOL/AVAX/LINK/UNI/DOT` stayed positive but raw reversion was blocked by `PANEL-CATASTROPHIC`; SOL max drawdown was `17.003813R`.
- 2026-07-09 adding `confirmation_mode=reversal_close` removed the catastrophic veto on both panels:
  - seen non-meme panel: `sample_count=371`, `avg_r=0.147475`, `total_r=54.71315`, 5/5 assets positive, blocked by none.
  - external asset panel: `sample_count=475`, `avg_r=0.133093`, `total_r=63.21883`, 5/5 assets positive, blocked by none.
- These panels are research confirmation only. They cannot authorize shadow because the candidate and universe were selected after inspecting the same historical period. Locked holdout must start after this strategy freeze.
- 2026-07-09 frozen-candidate external check on `BCH/LTC/ATOM/NEAR/APT` remained positive but weaker: `sample_count=399`, `avg_r=0.063149`, `total_r=25.196466`, 4/5 assets positive, no panel gate blockers. `ATOMUSDT` was negative (`total_r=-5.157863`) with OOS and cost stress both false; panel-level asset shuffle was not applicable because only one candidate was evaluated.
- 2026-07-09 forward holdout guard with `frozen_at=2026-07-09T14:00:00Z` blocked interpretation: latest asset and BTC benchmark closed candles were `2026-07-09T12:00:00Z`, so no post-freeze closed sample existed yet. Next action is to refresh asset + benchmark manifests after the next closed 4H candle and rerun forward holdout.

## Trade Contract

```yaml
setup_id: alt-4h-btc-strong-relative-reversion-short
engine: rnd_family_v1
hypothesis: When BTC has advanced over the last 120 closed 4H candles, non-meme alt contracts that have outperformed BTC by at least 1 ATR can mean-revert after a bearish 4H reversal close.
timeframe: 4h
family: relative_weakness_momentum_v1
candidate:
  side: short
  signal_mode: reversion
  confirmation_mode: reversal_close
  benchmark: BTCUSDT
  benchmark_timeframe: 4h
  lookback_bars: 120
  relative_threshold_atr: 1
  benchmark_return_min: 0.02
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
  include: non-meme liquid USDM alt majors only
  exclude: meme contracts and symbols with unresolved tail-risk classification
execution:
  entry_rule: BTC 120-bar return >= 2%; alt relative move versus BTC >= 1 ATR; latest closed 4H candle is bearish and closes below previous close; enter next open or equivalent executable quote only.
  stop_rule: signal candle high plus 1 ATR.
  target_rule: fixed 2R; no discretionary target relocation.
  no_trade_conditions: meme or unclassified tail-risk symbol, stale closed 4H data, missing BTC benchmark manifest, risk wider than 2.5 ATR, abnormal funding/spread, existing same-lane exposure, no bearish reversal close, or candidate data viewed before freeze being used as locked holdout.
proof:
  evidence_ref: research panels passed after confirmation trigger, but no locked holdout yet.
  diagnostic_refs:
    - tmp/artifacts/strategy-rnd/relative-reversion-btc-strong-fresh-check-2026-07-09.json
    - tmp/artifacts/strategy-rnd/forward-holdout-relative-reversion-btc-strong-2026-07-09.json
  current_caveat: ATOMUSDT failed the frozen-candidate external check; single-candidate panel asset-shuffle null is not applicable.
  locked_holdout_start: after 2026-07-09 strategy freeze; previously viewed 2024-01-01 through 2026-07-09 data is contaminated for promotion.
  live_permission: draft_only
  next_required_proof: refresh asset and BTC benchmark manifests after a post-freeze 4H close, rerun forward holdout, then only if forward samples are clean consider shadow evidence with execution attribution.
```
