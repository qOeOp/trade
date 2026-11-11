# Capital use

Capital use is the context for drawdown and for the holding structure: read it first.

- The run report's `capital` section is sealed by the code and never recomputed: the peak notional,
  labelled as sampled per bar, not a tick extreme; the peak locked margin, from the account, resting
  orders included; time in market, the share of bars holding a position. Average notional,
  time-weighted with flat bars counting zero, is the report's `mean_notional`, the mean of the daily
  `mean_gross_notional` in `tables()`; its share of equity is not stored, so derive it from the same
  days' equity and say so. An exposure row labelled with
  bar time T holds what was open after every event before the next bar, valued at T's MARK; a bar
  without rows ended flat; a position opened and closed inside a bar has none. Never revalue
  positions or derive capital use from the account report alone. When the run has no exposure
  readings, it cannot answer capital questions: say so and put it in the limitations.
- Participation answers capacity questions, when size could be large against minute volume. Read
  the run report's `capital.participation`, sealed from the engine's per-fill minute volumes
  and never recomputed. It gives each fill's quantity, whatever its order type, over its minute's
  LAST volume, weighted by count: the median, p95, p99 and maximum. It also gives `minute_max`, the
  most one contract filled in one minute over that minute's volume. Fills with no bar, on zero
  volume, above the volume, and the engine's own settlement and liquidation fills are counted apart.
  Read the values under the run's execution environment. Each fill's row is in `reports/fill_volumes.csv`
  of the kept directory or of a reproduction.
- When the reading is null (`limitations` says why), compute it from that directory instead.
  Take the fills from `tables()` and divide each fill's quantity by the volume of that instrument's
  one-minute LAST bar at the run's market day (`market bars --at DAY --output`: `ts_open_ms`,
  `volume`). A fill at T belongs to the bar opening at T floored to the minute. Give the same
  figures, and say whether fills are weighted by count or by quantity. Record what you computed as a
  `search_exposure` judgment (the research-round skill's next decision).
- Read it against the fill model. Each bar's open, high, low and close each offer a quarter of the
  bar's volume at that price, refreshed on every bar. A resting limit order takes at most that
  quarter for each of the bar's prices it crosses, so it fills in pieces over several bars; a low
  value means many bars were needed, not low impact. A market order takes the quarter at the close
  and the rest in one fill one tick worse, in the same bar. Its participation is not capped, so a
  value above a quarter means the backtest filled more than the bar offered at that price, and
  above one more than the minute traded. Treat both as capacity warnings on modelled fills, never as
  measured execution quality.
