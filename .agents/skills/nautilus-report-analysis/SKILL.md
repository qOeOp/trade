---
name: nautilus-report-analysis
description: Derives descriptive statistics from a sealed run's stored cycles, daily returns and reproduced native reports (ratios, deflated Sharpe, capital use, exit-reason splits, per-instrument or per-month tables, holding times) beyond the product's single-run and comparison reports. Use before computing any such number from tables() of a run, before comparing two runs trade by trade or by drawdown, and before interpreting liquidation outcomes, fill sizes, liquidation prices or slippage of a quote-execution run (check both quote suitability and Binance's published depth).
---

# Native report analysis

The product's reports (`replay report --trial-id RUN`, `hypothesis compare --registration ID --trial-id
RUN`) give the measures of the measure catalogue, already masked by eligibility. Everything else you
compute yourself from `report.runs.tables()` under these rules; its docstring lists its arguments
and returned fields.

## Rules

- Take every number from `tables()` and cite its `ledger_commit`; never parse native
  files, query ledger tables directly, or override or fill a report measure. Holding time is
  `ts_closed_ns − ts_opened_ns`, the entry plan `plan_tag`, the exit `closing_order_tag` or
  `closing_order_type`. For orders, fills, account or order events, pass the run's kept
  directory (`replay run --output`), or a `replay reproduce` directory and its reproduction trial,
  to `tables()`.
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
- Analysis outside the measure catalogue is done in /tmp, in a format of your choice. Its files and
  tables never enter the ledger: not in a bundle, not in a judgment's text. A `search_exposure`
  judgment names the view (research-round), and a number from it that drives a recommendation or the
  next hypothesis is cited in the judgment by its inputs and ledger commit.
- When a measure from such analysis drives decisions again and again, propose adding
  it to the measure catalogue as a design change: its definition, population and the decisions it
  drove.

## Native semantics

- Positions hold one row per position: each entry order opens its own (HEDGING), so rows of one
  instrument may overlap in time.
- `realized_pnl` includes commissions and funding; a closed row's `price_pnl` is its gross fill
  result. Funding also appears as account balance changes: use one
  source, never both. The account `total` is cash, not marked equity.
- Under a fixed fee schedule, fee bps is linear in taker
  share: call a change a liquidity-mix shift, not efficiency.
- Many cancelled orders are contingent children: separate children (`parent_order_id` set) from
  entry parents, then split by the strategy's own tags before reading cancels as lost
  opportunities. In `order_events`, only one order's own event order is causal; line order across
  orders is not.

- Before interpreting liquidation occurrence, timing, prices or account outcomes under inferred
  quotes, read research-start's [quote readiness](../research-start/references/readiness.md#inferred-quotes-and-low-activity).
  Depth checks do not validate quote freshness. Report unverified claims explicitly without
  correcting the run's fills, prices, measures or eligibility.

## References

- [ratios.md](references/ratios.md): before Sharpe, Sortino, Calmar or similar ratios (whole
  window, sub-periods or rolling) and before a deflated Sharpe.
- [capital.md](references/capital.md): before reading capital use, drawdown, holding structure or
  capacity.
- [exit-reasons.md](references/exit-reasons.md): before an entry-plan × exit-reason table or
  splitting contributions by exit.
- [depth.md](references/depth.md): before reading fill sizes, liquidation prices or slippage of a
  quote-execution run (`execution` is `quotes` in the run's summary).
