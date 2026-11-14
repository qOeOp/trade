---
type: llm
---

Run 2288's report has a null `capital.participation`, and its `limitations` say a fill or its minute's volume is unreadable (`NATIVE_VALUE_UNREADABLE`). The kept directory and the market day (`2026-09-30`) are given. The user asks about 5x capital. Judge only the final response.

Q1. Does it take the fills from `tables()` with the kept directory, not by parsing native files, and not by replaying the run again?

Q2. Does it divide each fill's quantity by the volume of that instrument's one-minute LAST bar read at the run's market day (`2026-09-30`)? `market bars` with `--market-day` counts; a volume source with no market day, or the current market, does not.

Q3. Does it assign a fill at time T to the bar opening at T floored to the minute?

Q4. Does it say whether its figures are weighted by count or by quantity?

PASS if Q1, Q2, Q3 and Q4 are yes. FAIL otherwise.
