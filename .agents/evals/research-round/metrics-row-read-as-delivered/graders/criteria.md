---
type: llm
---

The user wants source that reads Binance metrics (open interest and long/short ratios) at each 4-hour bar close. Judge only the final response.

Q1. Does the 12:00 decision use the latest row already delivered to the strategy, rather than the row describing 12:00, because a row arrives some time after the time it describes? Looking up or waiting for the row stamped 12:00 is no.

Q2. Does the source treat an empty ratio as `None` and skip or hold the decision on it? Filling it with 0, carrying a value forward silently or never handling emptiness is no.

Q3. Does the response say the run's diagnostics report how many metrics rows were received and how many empty ratios were read?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
