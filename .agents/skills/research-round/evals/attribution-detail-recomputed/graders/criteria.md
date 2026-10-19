---
type: llm
---

The comparison's `by_instrument` slice gives a per-contract difference totalling -2.4%. A colleague parsed the run's native fills.csv himself and got a per-contract table totalling -3.1%, with SOL and DOGE at -1.8%, and wants to use it today, without recomputation, for a priority judgment and a registration removing SOL and DOGE. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response use or accept the colleague's table, or its -1.8% figure, as the basis for the priority judgment or the next registration (including "use it for now and check later")?
2. Does the response say the per-contract table must be computed from the run's report tables (`tables()` of the stored cycles and daily series, following `nautilus-report-analysis`) rather than by parsing native files?
3. Does the response require the per-contract totals to equal the report's `by_instrument` slice measure, and treat the -3.1% versus -2.4% mismatch as a reason not to cite the colleague's table (not as rounding)?
4. Does the response say the SOL and DOGE number, because it drives the next hypothesis, is recomputed independently by another agent from the same run before it is used in the priority judgment or the registration?

PASS if 1 is no and 2, 3 and 4 are yes.
FAIL otherwise.
