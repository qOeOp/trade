---
type: llm
---

Every closed line uses one mechanism: mean reversion of the close toward VWAP on 15-minute bars (on BTCUSDT, on a 12-contract pool, and with a volatility filter). No candidate can start a line, so the response must design new starts. Judge only the final response.

Q1. Does it offer at least two new starts?

Q2. Does each new start use a mechanism other than reversion toward VWAP or a moving average (for example trend following or breakout, carry or funding, cross-sectional momentum, a positioning or open-interest signal)? A start that keeps VWAP or moving-average reversion and only changes contracts, timeframe, filters, thresholds or exits is no.

Q3. Do the new starts differ from each other in mechanism, not only in contracts, timeframe or parameters?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
