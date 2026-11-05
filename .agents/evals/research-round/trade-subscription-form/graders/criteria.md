---
type: llm
---

The user wants source that reads trade ticks under quote execution. Judge only the final response.

Q1. Does the source subscribe with `subscribe_data` and a `DataType` for `TradeTick` carrying the instrument id in metadata, and read the tick as `data.data` in `on_data`? Using `subscribe_trade_ticks`, `subscribe_trades` or `on_trade_tick` as the way the run delivers trades is no.

Q2. Does it say the trade ticks are signal input only and match no order and move no book?

Q3. Does it name the runner argument `--trade-ticks`?

Q4. Does it say the diagnostics report the number of trades received?

PASS if Q1, Q2, Q3 and Q4 are yes. FAIL otherwise.
