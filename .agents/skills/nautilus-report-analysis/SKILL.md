---
name: nautilus-report-analysis
description: Derives descriptive statistics from a sealed run's stored cycles, daily returns and reproduced native reports (ratios, deflated Sharpe, capital use, exit-reason splits, per-instrument or per-month tables, holding times) beyond the product's single-run and comparison reports. Use before computing any such number from tables() of a run, before comparing two runs trade by trade or by drawdown, and before reading fill sizes, liquidation prices or slippage of a quote-execution run (they are checked against Binance's published depth).
---

# Native report analysis

The product's reports (`replay report --trial-id RUN`, `hypothesis compare --bundle BUNDLE --trial-id
RUN`) give the measures of the measure catalogue, already masked by eligibility. Everything else you
compute yourself from `report.runs.tables()` under these rules; its docstring lists its arguments
and returned fields.

## Rules

- Take every number from `tables()` and cite its `ledger_commit`; never parse native
  files, query ledger tables directly, or override or fill a report measure. Holding time is
  `ts_closed_ns − ts_opened_ns`, the entry plan `plan_tag`, the exit `closing_order_tag` or
  `closing_order_type`. For orders, fills, account or order events, pass a `replay reproduce`
  directory and its reproduction trial to `tables()`.
- State the population (closed cycles, open rows, account), the weighting and the
  frequency of every derived number. Totals over closed cycles equal `reconciled`; if not, do not
  cite them. A number that drives a recommendation or the next hypothesis is recomputed
  independently by a fresh agent for each recomputation, given only the run, its `ledger_commit`
  and the question, never a reused one; when they disagree, draw no conclusion.
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
  result, summed from per-fill PnL that Nautilus rounds to 8 decimals, so it can differ from exact
  fill cash flows by that rounding. Funding also appears as account balance changes: use one
  source, never both. The account `total` is cash, not marked equity.
- Maker or taker comes from fills only. Under a fixed fee schedule, fee bps is linear in taker
  share: call a change a liquidity-mix shift, not efficiency.
- Many cancelled orders are contingent children: separate children (`parent_order_id` set) from
  entry parents, then split by the strategy's own tags before reading cancels as lost
  opportunities. Only one order's own event order is causal.

- Under quote execution (`execution` is `quotes` in the run's summary), every fill, liquidation
  fills included, took its whole quantity at the best bid or ask with no depth. Before reading fill
  sizes, liquidation prices or slippage, check each fill against the venue's published depth
  ([depth.md](references/depth.md)): count the fills whose quantity exceeds the resting quantity
  within 1% on the side they hit, report that count beside the total and the liquidation fills among
  them, and state that the environment fills at the best price without depth. Never scale a fill or
  its price by the depth: the number is a flag on the run's realism, not a correction.

## References

- [ratios.md](references/ratios.md): before Sharpe, Sortino, Calmar or similar ratios (whole
  window, sub-periods or rolling) and before a deflated Sharpe.
- [capital.md](references/capital.md): before reading capital use, drawdown, holding structure or
  capacity.
- [exit-reasons.md](references/exit-reasons.md): before an entry-plan × exit-reason table or
  splitting contributions by exit.
- [depth.md](references/depth.md): before reading fill sizes, liquidation prices or slippage of a
  quote-execution run.
