# Ratios

Read before computing Sharpe, Sortino, Calmar or similar ratios, over the whole window, sub-periods
or a rolling window, and before a deflated Sharpe.

- Compute ratios with the pinned engine's statistic classes (`nautilus_trader.analysis`:
  `SharpeRatio`, `SortinoRatio`, `CalmarRatio`, `MaxDrawdown`, ...) through
  `calculate_from_returns` on `tables()` daily returns as `{ts_event_ns: return}`: UTC calendar
  days of the trade window, no warm-up, annualized over 365 days. Add no other analysis library.
  The whole-window Sharpe matches the report's native-summary Sharpe, or you state the difference
  in definition. An HTML tearsheet, only when the user asks for one, is built with
  `nautilus_trader.analysis.create_tearsheet_from_stats` from these trade-window statistics and
  written under /tmp.
- For a deflated Sharpe, take from `research status --line <the run's line>` (`multiple_testing`)
  `effective_trials` and `all_purpose_trials`, and compute one end of a range with each; never
  count trials yourself. `V` is its `daily_sharpe_variance`. From the run's daily returns take the
  daily Sharpe (not annualized), skewness, raw kurtosis and the number of days. With `N` trials,
  `V` and γ ≈ 0.5772:
  `SR0 = sqrt(V) · ((1 − γ) Φ⁻¹(1 − 1/N) + γ Φ⁻¹(1 − 1/(N·e)))` and
  `DSR = Φ((SR − SR0) · sqrt(T − 1) / sqrt(1 − skew · SR + (kurt − 1)/4 · SR²))`.
  Report the range with both counts, `research_trials`, `mean_correlation`, the variance and the
  days, and the ledger commit; never a single value and never a gate.
