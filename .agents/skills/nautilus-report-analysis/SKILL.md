---
name: nautilus-report-analysis
description: Derives descriptive statistics from sealed native Nautilus backtest reports (win rates, holding time, order funnel, drawdown dates, monthly or per-instrument contribution, cost mix) beyond the reconciled readings of `artifacts report` and `compare --analysis`. Use before computing any such number for a research decision.
---

# Native report analysis

`artifacts report` and `compare --analysis` give only what you must not grade yourself: verified seal
identity, the closed-position split reconciled to the audited `native_economics`, the unrealized
residual, and the paired interval of the preregistered primary response. Compute everything else
yourself from the sealed native reports, following the rules below. They hold for any strategy or
venue; facts that depend on the run's configuration must be read from the seal, never assumed.

## Before computing

1. Load the run with `research.records.analysis.tables(root, run_id)` and never parse report CSVs
   yourself. It verifies the seal, refuses one whose closed split does not reconcile, and returns
   typed orders, fills, positions and trade-window daily returns, with each fill's
   `cycle_position_id` and each closed row's reconciled `price_pnl`, exact `ts_closed_ns` and
   `closing_order_tags`. Take holding time from `duration_ns`, never from the native `ts_closed`
   text. If it refuses a seal or reports a format error, stop and report that.
2. Cite the run ID, `manifest_sha256` and the `files_sha256` you used next to any derived number.
3. State the population of every reading: closed cycles, open rows, all rows, or the account.
4. Read instrument terms (currency, multiplier, `is_inverse`), fee rates and order-tag vocabulary from
   the seal. Skip or label any reading whose terms differ from what your formula assumes.

## Native semantics

- Positions hold one row per NETTING cycle: earlier cycles are snapshot rows (`is_snapshot`), the
  latest is the live row. Keep snapshot rows; closed cycles number `summary.closed_trades`. Never
  pair positions across runs by `position_id`.
- `realized_pnl` already includes commissions and funding; a closed row's `price_pnl` is its gross
  fill result. Funding also appears as account balance changes: use one source, never both. The
  account `total` is cash, not MTM equity.
- `summary.closed_trade_win_rate` counts closed cycles with positive `realized_pnl`. Older summaries
  also carry native `stats_returns`, `stats_pnls` and `stats_general`: warmup days, 252-day
  annualization, snapshot and open rows, and same-nanosecond closes merged into one. Do not cite them.
- Maker/taker comes from fills only (unfilled orders also carry `liquidity_side`). Under a fixed
  maker/taker fee schedule, fee bps is linear in taker share: call a change a liquidity-mix shift, not
  efficiency.
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
  it outside the seal.

## Self-checks before citing a derived number

- Sums over closed rows equal `reconciled.closed` from `tables()`; realized PnL over all rows equals
  `native_economics.reported_realized_pnl_usdt`, within 1e-6.
- For a number that drives a decision, keep the script with the attempt's evidence or have a second
  Agent recompute it independently from the same seal; disagreement means no claim.

## Do not

- Do not weight edge readings without naming the weighting (count vs. entry notional); never average
  `realized_return`.
- Do not call a drawdown reduction better risk efficiency when exposure also fell.
- Do not derive capital use from the account report or re-value positions; seals without a native
  capital time series cannot answer capital-use questions.
