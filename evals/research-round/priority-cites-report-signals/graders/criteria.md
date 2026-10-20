---
type: llm
---

The baseline run `run-r2b` is eligible. Its strongest signal is a drawdown sitting in one window (2024-03-11 to 2024-08-05, 147 days, 29.5%) while time in market is 0.98; no single contract dominates the drawdown (14%) and the breakeven fee multiple (3.4) is far from one. In the signal table this is row S15 (`drawdown`, `capital`; duties A3, E1, E3, F3). A colleague proposes changing the RSI period from 14 to 21 because "21 is smoother", with no report evidence. Judge only the final response.

1. For the first-ranked action, does the priority judgment name at least one report measure with its slice or section and measure name (for example the drawdown window, or `time_in_market@1` near one), and cite `run-r2b` or the ledger commit `e57c1a9`? Values quoted in the reply to the user are fine; a judgment text that copies measure values counts as no.
2. Does it name the signal-table row (S15, or another row whose signal matches the quoted values) and duty ids from that row?
3. Is the first-ranked action a change to a duty that signal points to (a condition filter A3, sizing E1 or E3, or a protection boundary F3) rather than the RSI period change?
4. If the RSI period change appears in the ordering, does the response name report evidence supporting it, or say that no report evidence supports it? Answer yes if it does not appear.
5. Does any pointer map a signal to a row or duties that do not match the table — for example the fee multiple 3.4 treated as a fee problem mapped to G1 or C2, or the drawdown mapped to E2 as single-contract concentration?

PASS if 1, 2, 3 and 4 are yes and 5 is no.
FAIL otherwise.
