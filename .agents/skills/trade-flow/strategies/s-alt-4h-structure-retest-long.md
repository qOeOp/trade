---
strategy_id: S-ALT-4H-STRUCTURE-RETEST-LONG
name: Alt 4H Structure Breakout Retest Long
status: draft
tags: [alt, usdm, 4h, swing, structure, breakout, retest, continuation]
---

# Alt 4H Structure Breakout Retest Long

只研究高流动性 alt USDM 永续的 4H 多头结构突破回踩，不做 BTC 单标的点位预测。

Research refs:

- 2026-07-08 8-symbol diagnostic panel showed `SBR-L-80` as the strongest candidate: pooled `sample_count=657`, `avg_r=0.075666`, `total_r=49.712666`, 7/8 assets positive. LINK failed catastrophically; BTC/ETH cost stress was weak.
- 2026-07-08 alt-basket full panel on `BNB/SOL/XRP/ADA/DOGE` accepted `SBR-L-80-ALT`: pooled `sample_count=402`, `avg_r=0.144378`, `total_r=58.040169`, 5/5 assets positive, 5/5 cost-stress positive, per-asset null passed 3/5 required 3, panel asset-shuffle passed with observed `58.040169` vs p95 `34.226876`.
- Result: research candidate only. The same 2021-2026 panel has already been inspected, so it cannot be reused as locked holdout. Requires future/pristine locked validation before `shadow`.

## Setup Certificate

```yaml
setup_id: alt-4h-structure-retest-long
hypothesis: Liquid alt continuation trades have positive expectancy after a prior 4H structure breakout and causal retest, but the edge is not universal across BTC/LINK.
symbols: [BNBUSDT, SOLUSDT, XRPUSDT, ADAUSDT, DOGEUSDT]
timeframe: 4h
family: structure_breakout_retest_v1
side: long
lookback_bars: 80
breakout_buffer_atr: 0.1
retest_tolerance_atr: 0.5
stop_atr: 0.5
max_risk_atr: 1.5
reward_risk: 2
entry_rule: previous candle closes above prior 80-bar resistance plus 0.1 ATR; current candle retests that level within 0.5 ATR and closes back above it; enter next open or equivalent executable quote only.
stop_rule: below min(retest low, breakout level) minus 0.5 ATR.
target_rule: fixed 2R first research version; no discretionary target relocation.
no_trade_conditions: symbol outside declared basket, stale closed 4H data, risk wider than 1.5 ATR, funding or spread abnormal, unresolved existing lane exposure, or retest level not causally available before entry.
evidence_ref: draft research candidate; needs pristine locked holdout plus shadow before live-small.
live_permission: draft
```
