---
name: nautilus-report-analysis
description: Derive descriptive statistics from sealed native Nautilus backtest reports (win rates, holding time, order funnel, drawdown dates, monthly or per-instrument contribution, cost mix) beyond the reconciled readings of `artifacts report` and `compare --analysis`. Use before computing any such number for a research decision.
---

# Native report analysis

`artifacts report` and `compare --analysis` give only what you must not grade yourself: verified seal
identity, the closed-position split reconciled to the audited `native_economics`, the unrealized
residual, and the paired interval of the preregistered primary response. Compute everything else
yourself from the sealed native reports, following the rules below. They hold for any strategy or
venue; facts that depend on the run's configuration must be read from the seal, never assumed.

## Before computing

1. Run `artifacts verify` (or `report`) on the run first, and read files only from that seal.
2. Cite the run ID, `manifest_sha256` and each parsed file's SHA-256 next to any derived number.
3. State the population of every reading: closed cycles, open rows, all rows, or the account.
4. Read instrument terms (currency, multiplier, `is_inverse`), fee rates and order-tag vocabulary from
   the seal (`positions.csv`, `fills.csv`, `orders.csv`). Skip or label any reading whose terms differ
   from what your formula assumes.

## Data traps in native reports

- `positions.csv` mixes NETTING snapshot rows (`position_id` with a UUID suffix) with live rows.
  Closed cycles are the rows with `ts_closed`; their count equals `summary.closed_trades`. Never pair
  positions across runs by `position_id`.
- Map fills to cycles through `positions.events[].event_id`, not `fills.position_id` (base ID only).
- `ts_closed` carries float64 error when open rows exist. Use `ts_last` or `duration_ns`. Open rows
  have `duration_ns = 0`.
- `realized_pnl` already includes commissions and funding. Gross = realized + commissions − funding
  (funding is positive when received). Funding also appears as `account.csv` balance changes: use one
  source, never both. `account.csv` `total` is cash, not MTM equity; do not parse it for equity.
- Money cells are `"<decimal> <currency>"`; list cells are Python reprs (use `ast.literal_eval`). Parse
  CSVs by column name: column order differs between images. Zero-row reports have reduced headers;
  failed seals have no `summary.json` or `audit.json`.
- `returns_series.csv` starts at `input_start_utc` (warmup) and labels each day by its UTC start.
  Filter to `period_start_utc` and compound to reproduce `final_equity_usdt`.
- Three win-rate populations differ: native `stats_pnls`, `summary.closed_trade_win_rate`, and
  `positions.csv` rows. Name the one you use. Native `stats_returns` include warmup days.
- Maker/taker comes from fills only (unfilled orders also carry `liquidity_side`). Under a fixed
  maker/taker fee schedule, fee bps is linear in taker share: call a change a liquidity-mix shift, not
  efficiency.
- Cancelled orders are often contingent children (brackets, OCO). Split the funnel by the strategy's
  own `tags` and `contingency_type` before reading cancels as lost opportunities.

## Self-checks before citing a derived number

- Per-instrument realized PnL over all rows sums to `native_economics.reported_realized_pnl_usdt`
  within 1e-6; closed rows sum to `closed.reported_realized_pnl_usdt` from the report.
- Compounded trade-window daily returns reproduce `final_equity_usdt`.
- For a number that drives a decision, keep the script with the attempt's evidence or have a second
  Agent recompute it independently from the same seal; disagreement means no claim.

## Do not

- Do not weight edge readings without naming the weighting (count vs. entry notional); never average
  `realized_return`.
- Do not call a drawdown reduction better risk efficiency when exposure also fell.
- Do not derive capital use from `account.csv` or re-value positions; seals without a native capital
  time series cannot answer capital-use questions.
