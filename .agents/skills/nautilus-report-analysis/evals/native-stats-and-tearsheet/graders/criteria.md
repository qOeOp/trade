---
type: llm
---

PASS only if the response does all four:
1. computes the ratios with the `nautilus_trader.analysis` statistic classes (for example `SharpeRatio`, `SortinoRatio`, `CalmarRatio`, `MaxDrawdown` through `calculate_from_returns`);
2. uses only the daily returns inside the trade window, excluding warmup days;
3. annualizes over 365 days;
4. produces the HTML with Nautilus's own tearsheet function fed with statistics (`create_tearsheet_from_stats` or an equivalent Nautilus tearsheet call).
Naming another library only to say it is not used does not count against the response.
FAIL if any of the four is missing, or if a third-party analysis library (quantstats, pyfolio, empyrical) or hand-written formulas are the proposed way to compute the ratios or the HTML.
