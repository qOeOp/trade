# Ratios

Read before computing Sharpe, Sortino, Calmar or similar ratios, over the whole window, sub-periods
or a rolling window, and before a deflated Sharpe.

- **R.1.2.2** Compute ratios with the pinned engine's statistic classes (`nautilus_trader.analysis`:
  `SharpeRatio`, `SortinoRatio`, `CalmarRatio`, `MaxDrawdown`, ...) through
  `calculate_from_returns` on `tables()` daily returns as `{ts_event_ns: return}`: UTC calendar
  days of the trade window, no warm-up, annualized over 365 days. Add no other analysis library.
  The whole-window Sharpe matches the report's native-summary Sharpe, or you state the difference
  in definition. An HTML tearsheet, only when the user asks for one, is built with
  `nautilus_trader.analysis.create_tearsheet_from_stats` from these trade-window statistics and
  written under /tmp. Check signatures in the installed package, not online docs.
- **V.4.4.2** For a deflated Sharpe, take from `research status` (`by_development_window`, the
  run's window) both the distinct source count and the total trial count, and compute one end of a
  range with each; never count trials yourself. From the run's daily returns take the daily
  Sharpe, skewness, raw kurtosis and the number of days; the variance of Sharpe across trials is
  that of the daily Sharpe of all economically available research runs on the same window. With
  `N` trials, `V` that variance and γ ≈ 0.5772:
  `SR0 = sqrt(V) · ((1 − γ) Φ⁻¹(1 − 1/N) + γ Φ⁻¹(1 − 1/(N·e)))` and
  `DSR = Φ((SR − SR0) · sqrt(T − 1) / sqrt(1 − skew · SR + (kurt − 1)/4 · SR²))`.
  Report the range with the raw counts, the variance and the days, and the ledger commit; never a
  single value and never a gate.
