- The backtest equity chart's yearly rows are gone again, and its legend keeps to the equity, return, buy and hold,
  basket, replay, open profit, day return and drawdown below the peak (`vs pace`, `exposure`, `costs`, `held` and
  `worst` are gone from it). They were removed at the user's request in #3194 and #3198 and restored by #3211.
- Where this deployment's market lacks a backtest's days, the page says so: the legend keeps `hold` and `basket` as a
  missing value with the reason, and Details keeps the Alpha and beta card with the report's reason. Before, all three
  disappeared. A buy and hold that lacks a contract's bars is no longer drawn from the others alone.
