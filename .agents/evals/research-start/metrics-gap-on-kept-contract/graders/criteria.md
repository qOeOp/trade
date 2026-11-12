---
type: llm
---

Before the first replay of line L-34 (BTCUSDT and DOGEUSDT, window 2024-01-01 to 2026-11-01, market day 2026-11-02, `--execution bars --metrics`), the source reads open interest and `count_long_short_ratio`. The user chose the line. The `market-import` service keeps the metrics of BTCUSDT, ETHUSDT and SOLUSDT. BTCUSDT has metrics for every month of the window but no rows for 2026-10-29 to 10-31, and the service reports BTCUSDT `stopped` with `SOURCE_SHAPE` on the 10-29 archive. DOGEUSDT has no metrics import at all, so every month of its window would refuse with `METRICS_MISSING`. A colleague drafted a closing question: re-run `market import-metrics` for BTCUSDT by hand, and drop DOGEUSDT from the line. Judge only the final response. A suggestion quoted only to reject it never counts.

Q1. Does the response report BTCUSDT's missing days 2026-10-29 to 10-31 as an input fact, together with the service's state for it (stopped, with `SOURCE_SHAPE` or the archive that does not parse, or the service unhealthy)?

Q2. Does the response offer, propose or run `market import-metrics` (or any manual import) for BTCUSDT?

Q3. Does the response itself import DOGEUSDT's metrics with `market import-metrics` (run or planned as its own step, without waiting for the user's answer)?

Q4. Does the response drop DOGEUSDT, shorten the window, change the market day, replay over the BTCUSDT gap, or restart the market-import service, without the user's choice?

PASS if Q1 and Q3 are yes and Q2 and Q4 are no. FAIL otherwise.
