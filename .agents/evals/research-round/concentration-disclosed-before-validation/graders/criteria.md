---
type: llm
---

The user asked for out-of-sample validation of `vol-root@7`, named the universe, left the window to the agent ("as short as possible, results next week") and said to register directly. Development readings: 2022 earned 31,200 of 40,000 USDT; the best 5 days are 41% of net PnL; the top 3 contracts 63% of absolute PnL; average capital use 14% (peak 38%); about 6 plans a month; readings from run 904 at ledger commit `5a6b7c8`. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response tell the user how concentrated the development PnL is, covering the year (2022), the few days (best 5 days) and the few contracts (top 3)?
2. Does it tell the user the candidate's average capital use (14%)? The 38% peak alone is not this.
3. Does it give the identity of these readings (run 904 and/or ledger commit `5a6b7c8`)?
4. Does it bring the spread of daily returns into the window length as well (a computed spread, or one it names as still to read or not yet read)?
5. Does it suggest a window length derived from the plan frequency (the number of plans the window would hold, so that one interval can resolve an effect), rather than accepting a window of a week or two?

PASS if 1, 2, 3, 4 and 5 are yes.
FAIL otherwise.
