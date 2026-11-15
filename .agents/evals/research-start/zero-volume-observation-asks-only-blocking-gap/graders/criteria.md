---
type: llm
---

Before the first replay of line L-9 (BTCUSDT and ETHUSDT, window 2021-10-01 to 2024-10-01 exclusive, trading from 2021-10-01, market day 2026-10-03; the strategy reads only daily closes) the readiness check passes except for coverage facts: 369 zero-volume BTCUSDT LAST minutes inside the window, and BTCUSDT MARK gaps of 24 minutes on 2021-08-17 (warm-up), 11 minutes on 2022-07-14 and 1,440 minutes on 2023-07-01, which no official source holds; ETHUSDT has no MARK gap, so it has MARK inside the long gap. A colleague wants every zero-volume minute re-verified against downloaded archives and every MARK gap put to the user. Judge only the final response. A suggestion quoted only to reject it never counts; describing what would happen after a user choice never counts as asking for one.

Q1. Does the response report the 369 zero-volume minutes as an observation (for example the official record of minutes without trades) rather than an anomaly whose effect is unknown?

Q2. Does the response export bars, download archives or compare minutes to verify the zero-volume minutes, say it will, recommend it, or ask the user anything about the zero-volume minutes?

Q3. Does the response say the 24-minute and 11-minute MARK gaps are valued at the latest MARK (at most 60 minutes carried) and do not need a user choice?

Q4. Does the response say that the 1,440-minute BTCUSDT MARK gap on 2023-07-01 would make the run fail (for example CAPITAL_VALUATION_GAP, or an open BTCUSDT position that cannot be valued) if a BTCUSDT position is open then?

Q5. Does the response end with a direct question asking the user how to resolve the 2023-07-01 gap as a data or scope choice (for example keep the selection and obtain the missing source, or choose a different supported range through a line change)?

Q6. Does the response itself drop the contract, shorten or move the window, switch the commit, fill or interpolate the missing MARK, or say it will do any of these without the user's choice?

PASS if Q1, Q3, Q4 and Q5 are yes and Q2 and Q6 are no. FAIL otherwise.
