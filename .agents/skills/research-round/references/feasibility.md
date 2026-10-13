# Goal and feasibility

## Who owns what

The user owns three targets and nothing else: the maximum drawdown, the minimum annual return (higher
is better; there is no upper bound) and the minimum win rate. Position size, per-plan risk, notional
limits and leverage use are your design variables. Set them in the strategy source, change them as a
new revision whenever you need to, and never record them as user constraints or ask authority for
them. Changing a user target to rescue a result is forbidden; changing your own sizing is not.

## Goal file

Write the user's targets once per goal as this JSON file and open the round with it
(`round open --goal`, [records.md](records.md)); it becomes the round's goal row. The
`research-start` skill asks the user for it. Nothing else goes
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

## Goal readings and optional target snapshots

The three targets remain the user's values. Read `artifacts report` on integrity-passed native
runs; missing readings remain null, never zero or a pass. MARK drawdown is sampled at the current
runtime's one-minute MARK clock; the historical enum name `native_mark_equity_5m` is a storage
compatibility name, not a claim of five-minute execution.

Existing `gates()` and freeze/confirmation checks retain their target formulas, sample requirement
and main-image protections. They are optional target snapshots, not candidate qualification,
research exclusions or a stopping rule. Target failures do not forbid valid descendants or sizing,
execution and exit research. Position size and per-plan risk are Agent variables in source.
A size change is an explicit registered source change, with its effect and exposure explained;
never change a user target or claim risk efficiency solely from reduced exposure.

No freeze or independent confirmation is part of an engineering ten-attempt development fixture.
