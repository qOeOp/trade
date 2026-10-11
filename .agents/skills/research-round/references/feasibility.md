# Goal and feasibility

## Who owns what

The user owns three targets and nothing else: the maximum drawdown, the minimum annual return (higher
is better; there is no upper bound) and the minimum win rate. Position size, per-plan risk, notional
limits and leverage use are your design variables. Set them in the strategy source, change them as a
new revision whenever you need to, and never record them as user constraints or ask authority for
them. Changing a user target to rescue a result is forbidden; changing your own sizing is not.

## Goal file

Write the user's targets once per goal as this JSON file, retain it with `material retain`
([publish.md](publish.md)) and cite its `review_evidence` ID in every attempt's plan. Nothing else
goes in it: no sizing, risk plan, budget or constraints of your own.

```json
{"goal_id": "GOAL-ID",
 "max_drawdown": 0.0,
 "min_annual_return": 0.0,
 "min_plan_win_rate": 0.0,
 "drawdown_measure": "native MARK equity at available observation times",
 "window": {"start": "YYYY-MM-DDT00:00:00Z", "end": "YYYY-MM-DDT00:00:00Z"}}
```

- `max_drawdown`: largest peak-to-trough fall of native MARK equity (account total plus unrealized
  PnL at MARK) over the replay's available observation times, as a fraction of the peak. Compute
  it under `nautilus-report-analysis` from `tables(..., account=True, exposures=True)`; a seal
  without exposures, or a daily-only reading, cannot show it.
- `min_annual_return`: net compounded annual return over the window, 365-day year.
- `min_plan_win_rate`: the plan win rate (gate 2) must be strictly above it.
- `window`: the development window the gates are read on, in UTC; `start` is the replay's
  `--trade-start`, not its warm-up `--start`.

Only the user changes the goal file. Any change to a value, the drawdown measure or the window is a
new goal with a new `goal_id`; the old goal's records stay where they are.

## Gates

Read on the development window from one native replay whose drawdown is at most
`2/3 × max_drawdown`. Compounding lets a larger size inflate the return-to-drawdown ratio, so a
reading at a larger size does not count. No notional cap, risk budget or pre-run capacity estimate
can fail a design, and none replaces a gate.

1. **Sample**: at least 100 closed plans. With fewer, the gates are not read and the design has not
   passed.
2. **Plan win rate** above `min_plan_win_rate`. A plan is everything one signal submits under one
   plan ID: all entry tiers and their shared stops and targets
   ([strategy-authoring.md](strategy-authoring.md)). It wins when its net result (fills, fees and
   funding) is above zero; breakeven, and a plan still open at the window end, are not wins. Take
   it from `plans.win_rate` of `artifacts report`; a refused reading (`plans` null, reason in
   `limitations`) is not a pass. The closed-position win rate is descriptive only.
3. **Return to drawdown**: development annual return ÷ development drawdown (measured as
   `drawdown_measure` says) is at least `min_annual_return ÷ (max_drawdown × 2/3)`. The 2/3 leaves
   a margin because development data has been inspected (a 30% budget and a 15% return need 0.75).

A failed gate is the reason a design fails the goal; name it in the decision with its number.

## Sizing, last

Only after all gates pass:

1. Multiply every constant that sets or caps size (per-plan risk, notional and portfolio caps) by
   `(2/3 × max_drawdown) ÷ measured drawdown`, once, and publish that as a new revision.
2. Run it once on the same window. It is the deciding check: drawdown at most `2/3 ×
   max_drawdown`, annual return at least `min_annual_return`, plan win rate still above
   `min_plan_win_rate`, no order denied for margin, and the largest order notional as a share of
   its bar's traded volume within the limit the source sets. Report that share in the decision.

This is one scaling and one confirmation, not a grid, and it does not count toward selection
pressure. A confirmation that misses a bound fails the goal on that bound; another scaling is a new
attempt and counts as a trial.
