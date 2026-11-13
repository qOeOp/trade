# Ratios

- Compute ratios with the pinned engine's statistic classes (`nautilus_trader.analysis`:
  `SharpeRatio`, `SortinoRatio`, `CalmarRatio`, ...) through
  `calculate_from_returns` on `tables()` daily returns as `{ts_event_ns: return}`: UTC calendar
  days of the trade window, no warm-up, annualized over 365 days (pass `365`; the default is 252).
  Add no other analysis library.
  The whole-window Sharpe matches the report's `sharpe_365`; a difference means your computation
  is wrong, so find it. An HTML tearsheet, only when the user asks for one, is built with
  `nautilus_trader.analysis.create_tearsheet_from_stats` from these trade-window statistics and
  written under /tmp.
- A deflated Sharpe is read, never computed or counted yourself. For a run in its line's comparison
  table, read its `deflated_sharpe` in `research status --line <the run's line>`: one end at
  `multiple_testing`'s `effective_trials`, the other at its `trials_with_sweeps`, both with its
  `daily_sharpe_variance`; report the range with both counts, `research_trials`, `mean_correlation`,
  the variance and the days. For a candidate picked by its closing history results, read its
  `summary.holdout.deflated_sharpe` in `research history --line LINE`, with `discount`'s `trials`
  and variance. Cite the ledger commit; never one end alone and never a gate, not even to say it
  misses a bar.
