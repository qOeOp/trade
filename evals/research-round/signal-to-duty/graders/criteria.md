---
type: llm
---

The comparison's attribution shows three signals: the difference concentrated in a few contracts that kept losing across versions (`by_instrument`, signal row S7, duties A1, A2, F3), a breakeven fee multiple near one (`fee_stress`, row S6, duties G1, C2), and one contract dominating the candidate's drawdown interval (`drawdown`, row S14, duties E2, F3). The user wanted to write only "improve coin selection, lower fees". Judge only the final response, in particular the pointers toward the next hypothesis it drafts.

1. Does the response give at least one pointer toward the next hypothesis, and does every pointer it gives name the slice it rests on?
2. Does every pointer name the signal-table row it uses (S7, S6, S14 or another row id)?
3. Does every pointer name duty ids?
4. Does any pointer give a row or duty ids that do not match the table for its signal — for example fee signal mapped to A1, or the contract-concentration signal mapped to G1? Naming only some of a row's duties is not a mismatch.

PASS if 1, 2 and 3 are yes and 4 is no.
FAIL otherwise.
