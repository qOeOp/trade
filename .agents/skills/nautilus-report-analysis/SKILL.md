---
name: nautilus-report-analysis
description: Derives descriptive statistics from a sealed run's stored cycles, daily returns and reproduced native reports (ratios, deflated Sharpe, capital use, exit-reason splits, per-instrument or per-month tables, holding times) beyond the product's single-run and comparison reports. Use before computing any such number from tables() of a run, and before comparing two runs trade by trade or by drawdown.
---

# Native report analysis

The product's reports (`replay report --run-id RUN`, `hypothesis compare --bundle BUNDLE --run-id
RUN`) give the measures of the measure catalogue, already masked by eligibility. Everything else you
compute yourself from the `report` package's `tables(run_id, at=..., account=..., exposures=...,
directory=..., reproduction=...)`, under these rules. It returns the run's position cycles
(`positions`, snapshot rows kept: `plan_tag`, `ts_opened_ns`, `ts_closed_ns`, `price_pnl`, `funding`,
`closing_order_type`, `closing_order_tag`), the trade-window daily returns, `reconciled` totals, `availability`, `metrics_revision`, `ledger_commit`
and `limitations`.

## Rules

- Take every number from `tables()` and cite its `ledger_commit`; never parse native
  files, query ledger tables directly, or override or fill a report measure. Holding time is
  `ts_closed_ns − ts_opened_ns`, the entry plan `plan_tag`, the exit `closing_order_tag` or
  `closing_order_type`. For native detail beyond cycles and daily
  returns (orders, fills, account, order events), first replay the run into /tmp with `replay
  reproduce --run-id RUN --output DIR` and pass that directory and the reproduction trial to
  `tables()`, which checks the semantic fingerprint first.
- State the population (closed cycles, open rows, account), the weighting and the
  frequency of every derived number. Totals over closed cycles equal `reconciled`; if not, do not
  cite them. A number that drives a recommendation or the next hypothesis is recomputed
  independently by a second agent from the same run and `ledger_commit`; when they disagree, draw
  no conclusion.
- Tests pair only account daily returns, and the product does that
  (`hypothesis compare`). For a trade-by-trade comparison read the attribution's trade pairing
  (`trade_pairs`), its coverage first. Never pair trades yourself by time, position id or
  direction, and never use paired trades as a test unit.
- Drawdown is the report's MARK maximum drawdown; never recompute it. Read it beside the
  same run's capital use ([capital.md](references/capital.md)). When drawdown falls together with
  average notional or time in market, write that exposure fell, not that risk efficiency or risk
  control improved. Net return over notional, if shown at all, is labelled descriptive with its
  denominator and never ranks anything.
- Analysis outside the measure catalogue is done in /tmp, in a format of your choice,
  and never entered in the ledger: not in a bundle, not in a judgment's text. A number from it that
  drives a recommendation or the next hypothesis is cited in the judgment by its inputs and ledger
  commit.
- When a measure from such analysis drives decisions again and again, propose adding
  it to the measure catalogue as a design change: its definition, population and the decisions it
  drove; one catalogue version bump. Until then it is not a fixed measure. A new version applies to
  runs sealed after it; an older run gets the number only by reproducing it.

## Native semantics

- Positions hold one row per NETTING cycle: earlier cycles are snapshot rows, the latest is the
  live row; keep snapshot rows.
- `realized_pnl` includes commissions and funding; a closed row's `price_pnl` is its gross fill
  result. Funding also appears as account balance changes: use one source, never both. The account
  `total` is cash, not marked equity.
- Maker or taker comes from fills only. Under a fixed fee schedule, fee bps is linear in taker
  share: call a change a liquidity-mix shift, not efficiency.
- Many cancelled orders are contingent children: separate children (`parent_order_id` set) from
  entry parents, then split by the strategy's own tags before reading cancels as lost
  opportunities. Only one order's own event order is causal.

## References

- [ratios.md](references/ratios.md): before Sharpe, Sortino, Calmar or similar ratios (whole
  window, sub-periods or rolling) and before a deflated Sharpe.
- [capital.md](references/capital.md): before reading capital use, drawdown, holding structure or
  capacity.
- [exit-reasons.md](references/exit-reasons.md): before an entry-plan × exit-reason table or
  splitting contributions by exit.
