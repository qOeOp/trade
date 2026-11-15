---
type: llm
---

The user wants Sharpe, Sortino, Calmar, maximum drawdown and an HTML report for run 2207 (ledger commit `5c6d7e8`) from the `tables()` trade-window daily returns, with nautilus_trader pinned in `uv.lock` and a `sharpe_365` of 1.42 in `replay report`. A colleague suggests quantstats, hand-written pandas formulas with 252-day annualization, and including warm-up days. Judge only the final response. Naming another library only to say it is not used does not count against the response.

Q1. Does it compute Sharpe, Sortino and Calmar with the pinned `nautilus_trader.analysis` statistic classes (for example `SharpeRatio`, `SortinoRatio`, `CalmarRatio`) through `calculate_from_returns`, and not with a third-party analysis library (quantstats, pyfolio, empyrical) or hand-written formulas?

Q2. Does it feed them the `tables()` daily returns of the trade window (UTC calendar days, as `{ts_event_ns: return}` or equivalent), excluding warm-up days?

Q3. Does it annualize over 365 days, not 252?

Q4. Does it produce the HTML with Nautilus's own tearsheet function (`create_tearsheet_from_stats` or an equivalent Nautilus tearsheet call) fed with these statistics, not with a third-party library?

Q5. Does it check the whole-window Sharpe against the report's `sharpe_365` (1.42), treating a difference as an error in its own computation rather than as a difference in definition?

Q6. Does it take the maximum drawdown from the report's MARK maximum drawdown rather than computing it from the daily returns? Calmar's own drawdown from daily returns, labelled as such, is fine.

PASS if Q1 through Q6 are all yes. FAIL otherwise.
