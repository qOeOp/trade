# Target feasibility

Do this arithmetic before an L4 run whose plan mentions the user's goal. It is a bound on what the
design can deliver, not a forecast. Read the current goal and risk boundaries from the user or the
latest goal-level decision. As of 2026-10-10 the R1 goal is more than 20% annualized and a 58%–62% net
closed-position win rate, with 25 bp total stop risk and a 5% per-coin notional cap, all unchanged by
user decision.

## Required net

Over a trade window of D days on starting equity E, an annualized return r needs a net change of

    required_net = E * ((1 + r) ** (D / 365) - 1)

For E = 100,000 USDT, D = 355.35 days and r = 20%, this is about 19,423 USDT.

## Closed-cycle approximation

With N closed cycles, net win rate p, average net win W and average net non-win L (magnitude of the
mean over cycles with net PnL ≤ 0):

    net ≈ N * (p * W - (1 - p) * L)

This ignores open positions and assumes W and L do not change when p changes. Say so when citing it.
Two readings answer most questions:

- cycles needed at a given p: `required_net / (p * W - (1 - p) * L)`;
- win rate needed at the same N, W and L: `(required_net / N + L) / (W + L)`. A value above 1 means the
  design cannot reach the goal however good the signal is.

## Before the run

The point is to do this before spending a run. Estimate:

- **N** from the capacity diagnostic or pilot: source events per year times the expected share that
  becomes filled cycles. One plan with several tiers is one bundle, not several cycles.
- **L** from the strategy's own sizing rule and planned geometry. Read the rule from the source and
  effective configuration. Many R1 sources use
  `q = min(equity * risk / n / stop_distance, equity * cap / n / entry)`; when the stop is tight, the
  notional-cap branch binds and the per-trade amount at risk shrinks below the risk budget.
- **W** as the planned reward-to-risk ratio times L, net of fees.

## Worked example (development-exposed seals, illustration only)

| Run | Closed cycles | Net win rate | Avg net win / non-win USDT | Cycles needed at p = 60% | Win rate needed at same N |
|---|---:|---:|---:|---:|---:|
| B03 | 496 | 42.7% | 320.5 / 199.4 | 173 | 45.9% |
| C10 | 614 | 47.9% | 85.8 / 93.1 | 1,361 | 69.7% |
| C11 | 151 | 53.6% | 92.9 / 98.2 | 1,180 | above 100% |
| C12 | 59 | 28.8% | 112.0 / 79.2 | 547 | above 100% |

C11 and C12 could not reach 20% even if every cycle won. Their capacity (a few hundred events) and the
binding notional cap were known before the full runs, so those runs could not change the decision
about the joint goal. B03 shows the opposite case: the return is close and the win rate is the
binding part. These numbers come from inspected windows; use them only to calibrate the method.

Compute your own numbers from a verified seal following the `native-report-analysis` skill, and cite
the run, manifest hash and files.
