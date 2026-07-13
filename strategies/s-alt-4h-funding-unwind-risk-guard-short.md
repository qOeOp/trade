---
strategy_id: S-ALT-4H-FUNDING-UNWIND-RISK-GUARD-SHORT
contract_schema_version: 1
name: Alt 4H Funding Unwind Risk Guard Short
status: draft
tags: [alt, usdm, 4h, swing, funding, unwind, risk-guard, short]
---

# Alt 4H Funding Unwind Risk Guard Short

研究高 beta alt USDM 永续在正资金费率、弱 VFI、choppy regime 下的拥挤多头出清。它不是裸 funding carry，也不是事后 panel filter；冷却、近期反向冲击过滤、收盘位置过滤都是 family-level 策略定义的一部分。

Research refs:

- 2026-07-13 negative-funding long squeeze 线失败：6/6 候选被 `PANEL-CATASTROPHIC` 和 `PANEL-COST` 拦截，不能落 draft。
- 2026-07-13 positive-funding alt crowded-long unwind 线发现方向性 edge，但裸 `funding_carry_v1` 的 VFI/chop 候选仍被灾难回撤拦截。
- 2026-07-13 新增 `funding_unwind_risk_guard_v1`，把 cooldown、recent adverse move guard、close-location guard、VFI weak、chopiness 作为策略自身条件。
- 2026-07-13 risk-guard family panel 通过候选 `FURG-SHORT-F6-TH5-RR100`：
  - universe: `SOLUSDT/XRPUSDT/ADAUSDT/DOGEUSDT/LINKUSDT`
  - pooled `sample_count=424`, `avg_r=0.090331`, `total_r=38.300404`
  - positive assets `5/5`
  - per-asset negative controls passed `5/5`
  - catastrophic assets `0`
  - panel asset-shuffle passed: observed `38.300404`, median `21.099958`, p95 `22.414933`, empirical p-value `0.032258`
  - ref: `tmp/rd-new-strategy/alt-crowded-long-unwind-risk-guard-family-panel-20260713/panel-result.json`
- This draft was created after the panel candidate passed. No forward holdout has been consumed from this draft yet.

## Trade Contract

```yaml
setup_id: alt-4h-funding-unwind-risk-guard-short
engine: rnd_family_v1
hypothesis: Positive funding high-beta alts with weak VFI and choppy state can be shorted only when family-level risk guards suppress clustered entries and fresh squeeze pressure.
timeframe: 4h
family: funding_unwind_risk_guard_v1
candidate:
  side: short
  funding_lookback_events: 6
  min_abs_funding_rate: 0.00005
  vfi_weak_max: 0
  chopiness_min: 50
  cooldown_bars: 12
  adverse_lookback_bars: 6
  max_adverse_move_atr: 2.5
  max_short_close_location: 0.8
risk:
  stop_atr: 0.85
  max_risk_atr: 1.8
  reward_risk: 1
  max_hold_bars: 3
cost_model:
  fee_bps: 2
  slippage_bps: 1
  adverse_funding_bps_per_8h: 0
universe:
  include:
    - SOLUSDT
    - XRPUSDT
    - ADAUSDT
    - DOGEUSDT
    - LINKUSDT
  selection_rule: predeclared high-beta liquid alt panel with OHLCV and funding-aware feature reports
execution:
  entry_rule: positive trailing funding over 6 events; VFI <= 0; chopiness >= 50; cooldown bucket allows entry; recent 6-bar adverse move <= 2.5 ATR; signal candle close location <= 0.8; enter next open or equivalent executable quote only.
  stop_rule: signal candle high plus 0.85 ATR.
  target_rule: fixed 1R; no discretionary target relocation.
  no_trade_conditions: stale closed 4H data, missing funding/VFI/chopiness data, risk wider than 1.8 ATR, abnormal spread or liquidity, existing same-lane exposure, cooldown suppression, recent upside squeeze pressure, or setup not causally available before entry.
proof:
  panel_evidence_ref: tmp/rd-new-strategy/alt-crowded-long-unwind-risk-guard-family-panel-20260713/panel-result.json
  accepted_candidate: FURG-SHORT-F6-TH5-RR100
  current_status: draft
  live_permission: draft_only
  next_required_proof: compile this draft, rerun replay from the strategy contract, then run forward holdout as a draft-policy state transition on post-draft closed candles before any shadow promotion.
```

## Operating Boundary

- The panel result only authorizes a `draft` policy.
- Do not reuse pre-draft viewed candles as locked holdout evidence.
- Any future forward holdout must start from this draft checkpoint and use only closed candles available after the strategy was landed.
- Promotion to `shadow` requires fresh compiled-contract replay, forward evidence, and strategy-review approval.
