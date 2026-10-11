# Goal and feasibility

## Who owns what

The user owns three targets and nothing else: the maximum drawdown, the minimum annual return (higher
is better; there is no upper bound) and the minimum win rate. Position size, per-plan risk, notional
limits and leverage use are your design variables. Set them in the strategy source, change them as a
new revision whenever you need to, and never record them as user constraints or ask authority for
them. Changing a user target to rescue a result is forbidden; changing your own sizing is not.

## Goal file

Write the user's targets once per goal as this JSON file and open the round with it
(`round open --goal`, [records.md](records.md)); it becomes the round's goal row. Nothing else goes
in it: no sizing, risk plan, budget or constraints of your own.

```json
{"goal_id": "GOAL-ID",
 "max_drawdown": 0.0,
 "min_annual_return": 0.0,
 "min_plan_win_rate": 0.0,
 "drawdown_measure": "native MARK equity at available observation times",
 "window": {"start": "YYYY-MM-DDT00:00:00Z", "end": "YYYY-MM-DDT00:00:00Z"},
 "known_exposure": "Windows earlier rounds inspected, or none."}
```

- `max_drawdown`: largest peak-to-trough fall of native MARK equity (account total plus unrealized
  PnL at MARK) over the replay's trade window, as a fraction of the peak; the product reads it as
  the run's `max_drawdown`.
- `min_annual_return`: net compounded annual return over the window, 365-day year (`annual_return`).
- `min_plan_win_rate`: the plan win rate (gate 2) must be strictly above it.
- `window`: the development window the gates are read on, in UTC; `start` is the replay's
  `--trade-start`, not its warm-up `--start`.
- `known_exposure`: what earlier rounds already inspected, as the user or the ledger's enablement
  record states it.

Only the user changes the goal. Any change to a value, the drawdown measure or the window is a new
goal with a new `goal_id` and a new round; the old round stays under its closing tag.

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
   it from the run's `plan_win_rate`; a refused reading (null, reason in `reading_limitations`) is
   not a pass. The closed-position win rate is descriptive only.
3. **Return to drawdown**: the run's `return_drawdown` (annual return ÷ MARK drawdown) is at least
   `min_annual_return ÷ (max_drawdown × 2/3)`. The 2/3 leaves a margin because development data
   has been inspected (a 30% budget and a 15% return need 0.75).
4. **Annual return** at least `min_annual_return`, which only the sized revision reaches.

A freeze computes these gates itself; a failed gate is the reason the design fails the goal. Read
them on explorations first (`artifacts report --dir`). Freeze each candidate once, when you stop
developing it: a candidate that fails gates 1 to 3 is frozen as it is, as a failed freeze with its
failed part; a candidate that passes them is sized first and its sized revision frozen. Never
freeze at a size chosen to make the return gate pass while gates 1 to 3 fail.

## Sizing, last

Only after gates 1 to 3 pass in exploration:

1. Multiply every constant that sets or caps size (per-plan risk, notional and portfolio caps) by
   `(2/3 × max_drawdown) ÷ measured drawdown`, once, and publish that as a new revision.
2. Seal it once on the development window and freeze that run. The freeze is the deciding check:
   all four gates, no order denied for margin, and the largest order notional as a share of its
   bar's traded volume within the limit the source sets; report that share in the freeze note.

This is one scaling, not a grid. A freeze that misses a bound fails on that bound; another scaling
is another source and another freeze.
