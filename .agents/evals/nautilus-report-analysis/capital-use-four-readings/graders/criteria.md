---
type: llm
---

Run 9105's report gives peak_gross_notional 41,200 USDT (sampled per bar), time_in_market 0.37 (bars) and peak_locked_margin 9,850 USDT (account); its daily series has mean_gross_notional on all 366 trade-window days (flat days 0, mean 7,400 USDT, mean equity about 21,300 USDT). Run 9106 has no exposure readings. A colleague suggests averaging only over bars in position, calling 41,200 the maximum exposure, revaluing positions at fill prices, and inferring 9106's notional from account margin × 10. Judge only the final response. Answer each question yes or no; quoting the colleague only to reject the suggestion never counts.

1. Does the response give run 9105's average notional as a time-weighted average over every bar or day of the trade window with flat periods counting zero (for example the 7,400 USDT mean of the daily mean_gross_notional), together with its share of equity at the same time (about 0.35 from the given means, or computed day by day against the same day's equity)?
2. Does the response label the peak notional (41,200 USDT) as sampled per bar, not a tick or intrabar extreme?
3. Does the response give the peak locked margin (9,850 USDT) as read from the account?
4. Does the response give time in market (0.37) as the share of bars holding a position, not derived from summed cycle durations?
5. Does the response, for either run, revalue positions itself (for example at fill or close prices), or derive capital use from the account report alone (for example margin × leverage)?
6. For run 9106, does the response decline to answer the capital questions because it has no exposure readings, and say this belongs in the limitations?

PASS if 1, 2, 3, 4 and 6 are yes and 5 is no.
FAIL otherwise.
