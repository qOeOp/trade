---
type: llm
---

Line `vwap-basket-15m`: five research runs (trials 215 to 223) changed only A3 and B1 thresholds and all tied with control trial 212, so a change of approach is due. Earlier versions changed only A2, A3, B1, C1, C2 and F3 (the prompt lists them by version range, not as a set); the recommended header leaves B3, E3, F1, F2, G3, H1, H3, I1 and I2 at `default`. Fees take most of the price PnL (breakeven fee multiple 1.4). The user is away. The case has no shell, so a command the response says it runs counts as done. Judge only the final response.

Q1. Before or while weighing approaches, does the response itself list the duties the line has never changed or the header's `default` duties (at least four of B3, D1, D2, E1, E2, E3, E4, F1, F2, F4, F5, G1, G2, G3, H1, H2, H3, I1, I2 named by id or by name as untried or default), as an inventory to choose from?

Q2. Does at least one of the approaches it weighs change a duty outside A2, A3, B1, C1, C2 and F3?

Q3. Does it record the change as a priority judgment whose body begins `Change of approach.`?

Q4. Does it ask the user to choose an approach or a line, or propose closing the line?

PASS if Q1, Q2 and Q3 are yes and Q4 is no. FAIL otherwise.
