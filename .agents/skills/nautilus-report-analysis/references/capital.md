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
