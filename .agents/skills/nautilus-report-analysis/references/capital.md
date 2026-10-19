# Capital use

Read before reading capital use, drawdown, holding structure or capacity. Capital use is the
context for drawdown and for the holding structure: read it first.

- **R.2.3.1** Capital use is computed by the code at seal time and read from the run report, never
  recomputed: (1) time-weighted average notional over every bar of the trade window, flat bars
  counting zero, with its share of equity at the same time; (2) the peak notional, labelled as
  sampled per bar, not a tick extreme; (3) the peak locked margin, from the account, resting orders
  included; (4) time in market, the share of bars holding a position. An exposure row labelled with
  bar time T holds what was open after every event before the next bar, valued at T's MARK; a bar
  without rows held nothing. Never revalue positions or derive capital use from the account report
  alone. When the run has no exposure readings, it cannot answer capital questions: say so and put
  it in the limitations.
- **Participation** is yours to compute; the product stores none. Replay the run with `replay
  reproduce RUN`, take its fills from `tables()`, and divide each fill's quantity by the volume of
  that instrument's one-minute LAST bar at the run's market commit (market database, read only).
  The engine stamps a bar at its close and the market database keys it by its open, so a fill at
  time T belongs to the bar opening one minute before T. Give the median, a high quantile, the
  maximum and the number of fills on zero-volume bars, and say whether fills are weighted by count
  or by quantity.
- Read it against the fill model. Each bar's open, high, low and close each offer a quarter of the
  bar's volume at that price, refreshed on every bar. A resting limit order takes at most that
  quarter for each of the bar's prices it crosses, so it fills in pieces over several bars; a low
  value means many bars were needed, not low impact. A market order takes the quarter at the close
  and the rest in one fill one tick worse, in the same bar. Its participation is not capped, so a
  value above a quarter means the backtest filled more than the bar offered at that price, and
  above one more than the minute traded. Treat both as capacity warnings on modelled fills, never as
  measured execution quality.
