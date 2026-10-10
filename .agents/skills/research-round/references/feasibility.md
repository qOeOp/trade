# Feasibility

A bound on what a design can deliver, computed before the run. Take the goal and risk limits from
the user or the latest goal-level decision.

Net needed for an annualized return r over D days on equity E:

    required_net = E * ((1 + r) ** (D / 365) - 1)

With N closed cycles, net win rate p, average net win W and average net non-win L (magnitude):

    net ≈ N * (p * W - (1 - p) * L)

- Cycles needed at a given p: `required_net / (p * W - (1 - p) * L)`.
- Win rate needed at the same N, W and L: `(required_net / N + L) / (W + L)`. Above 1 means the
  design cannot reach the goal however good the signal is.

The approximation ignores open positions and holds W and L fixed; say so when citing it.

Estimate the inputs before running:

- **N**: events per year from the capacity check, times the share expected to fill. One multi-tier
  plan is one bundle, not several cycles.
- **L**: the source's own sizing rule applied to the planned geometry. When a notional cap binds,
  the amount at risk falls below the risk budget.
- **W**: planned reward-to-risk times L, net of fees.
