---
name: nautilus-report-analysis
description: Derives descriptive statistics from stored native Nautilus backtest reports (win rates, holding time, order funnel, drawdown dates, monthly or per-instrument contribution, cost mix) beyond the product readings of `artifacts report`. Use before computing any such number for a research decision.
---

# Native report analysis

`artifacts report` gives only what you must not grade yourself: the closed-position split
reconciled to the audited `native_economics`, the unrealized residual, the plan-level net win rate,
the native MARK drawdown and the return-to-drawdown ratio. Compute everything else yourself from
the stored native reports, following the rules below. They hold for any strategy or
venue; facts that depend on the run's configuration must be read from the run, never assumed.

## Before computing

1. Load the run with `research.records.analysis.tables(run_id)` (add `at="closed/GOAL-ID"` for a
   closed round) and never parse report rows yourself. It reads the stored run, refuses one that
   failed its audit or whose closed split does not reconcile, and returns
   typed orders, fills, positions and trade-window daily returns, with each fill's
   `cycle_position_id` and each closed row's reconciled `price_pnl`, exact `ts_closed_ns` and
   `closing_order_tags`. Take holding time from `duration_ns`, never from the native `ts_closed`
   text. If it refuses a run or reports a format error, stop and report that.
2. Cite the run ID and the `ledger_commit` it returns next to any derived number.
3. State the population of every reading: closed cycles, open rows, all rows, or the account.
4. Read instrument terms (currency, multiplier, `is_inverse`), fee rates and order-tag vocabulary from
   the run. Skip or label any reading whose terms differ from what your formula assumes.

## Native semantics

- Positions hold one row per NETTING cycle: earlier cycles are snapshot rows (`is_snapshot`), the
  latest is the live row. Keep snapshot rows; closed cycles number `summary.closed_trades`. Never
  pair positions across runs by `position_id`.
- `realized_pnl` already includes commissions and funding; a closed row's `price_pnl` is its gross
  fill result. Funding also appears as account balance changes: use one source, never both. The
  account `total` is cash, not MTM equity.
- `summary.closed_trade_win_rate` counts closed cycles with positive `realized_pnl`: a descriptive
  statistic, never the goal's win rate, which is the product's `plan_win_rate` of `artifacts report`
  (research-round `feasibility.md`). Older summaries
  also carry native `stats_returns`, `stats_pnls` and `stats_general`: warmup days, 252-day
  annualization, snapshot and open rows, and same-nanosecond closes merged into one. Do not cite them.
- Maker/taker comes from fills only (unfilled orders also carry `liquidity_side`). Under a fixed
  maker/taker fee schedule, fee bps is linear in taker share: call a change a liquidity-mix shift, not
  efficiency.
- `order_events.jsonl.gz` holds every order's unchanged native events (accepted, updated,
  canceled, expired, filled), grouped by order ID. Only one order's own event order is causal; line
  order across orders is not the engine's processing order. Older seals may lack it.
- Many cancelled orders are contingent children. Separate children (`parent_order_id` set) from
  entry parents first, since parents also carry `contingency_type`, then split by the strategy's own
  `tags` before reading cancels as lost opportunities.

## Readings

- Read bracket or OCO results by entry tag × exit reason, where the exit reason is the closed row's
  `closing_order_tags`, never the sign of PnL or a price level. An empty list is an untagged exit,
  such as a market time or end-of-run close: name it from that order's type.
- Compute standard ratios with the `nautilus_trader.analysis` statistic classes (`SharpeRatio`,
  `SortinoRatio`, `CalmarRatio`, `MaxDrawdown`, ...) through `calculate_from_returns` on the
  trade-window daily returns as `{ts_event_ns: return}`, or `calculate_from_realized_pnls` on a named
  population, annualizing over 365 days. The pinned version cannot register Python custom statistics;
  check the installed package, not the latest online docs. Add no analysis dependency.
- Build an HTML report with `nautilus_trader.analysis.create_tearsheet_from_stats(stats_pnls,
  stats_returns, stats_general, returns, output_path=...)` fed with trade-window statistics, and write
  it under `/tmp`.
- Capital use comes from `tables(..., exposures=True)`: a row labelled with bar timestamp T holds
  a position open after every event before the next bar timestamp, valued at T's MARK (native
  `notional_value`, `unrealized_pnl`, `cycle_position_id`). A bar without rows held no position.
  Equity at T is the account `total` of the latest account state before the next bar timestamp plus
  T's unrealized PnL; margins also count resting orders. Average over the trade window's bars from
  `period_start_utc`; a peak is a sampled peak. When `exposures` is `None`, the run cannot answer
  capital-use questions. The goal's drawdown is the product's `max_drawdown`; never recompute it for a
  gate.

## Self-checks before citing a derived number

- Sums over closed rows equal `reconciled.closed` from `tables()`; realized PnL over all rows equals
  `native_economics.reported_realized_pnl_usdt`, within 1e-6.
- For a number that drives a decision, have a second Agent recompute it independently from the same
  run; disagreement means no claim.

## Do not

- Do not weight edge readings without naming the weighting (count vs. entry notional); never average
  `realized_return`.
- Do not call a drawdown reduction better risk efficiency when exposure also fell.
- Do not re-value positions, or derive capital use from the account report alone.
