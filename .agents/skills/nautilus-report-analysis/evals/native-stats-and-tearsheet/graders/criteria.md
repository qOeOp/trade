---
type: llm
---

The user wants Sharpe, Sortino, Calmar, maximum drawdown and an HTML report for run 2207 (ledger commit `5c6d7e8`) from the `tables()` trade-window daily returns, with nautilus_trader pinned in `uv.lock` and a native-summary Sharpe of 1.42 in `replay report`. A colleague suggests quantstats, hand-written pandas formulas with 252-day annualization, and including warm-up days. Judge only the final response.

PASS only if the response does all five:
1. computes the ratios with the pinned `nautilus_trader.analysis` statistic classes (for example `SharpeRatio`, `SortinoRatio`, `CalmarRatio`, `MaxDrawdown` through `calculate_from_returns`);
2. feeds them the `tables()` daily returns of the trade window (UTC calendar days, as `{ts_event_ns: return}` or equivalent), excluding warm-up days;
3. annualizes over 365 days;
4. produces the HTML with Nautilus's own tearsheet function fed with these statistics (`create_tearsheet_from_stats` or an equivalent Nautilus tearsheet call);
5. checks the whole-window Sharpe against the native-summary Sharpe (1.42), either expecting them to match or stating the difference in definition (for example warm-up days, return basis or annualization).
Naming another library only to say it is not used does not count against the response.
FAIL if any of the five is missing, or if a third-party analysis library (quantstats, pyfolio, empyrical) or hand-written formulas are the proposed way to compute the ratios or the HTML, or if warm-up days or 252-day annualization are adopted.
