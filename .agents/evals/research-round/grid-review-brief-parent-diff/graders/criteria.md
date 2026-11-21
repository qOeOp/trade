---
type: llm
---

The author has three published grid candidates `pullback@5`, `@6`, `@7`, derived from `pullback@4` and differing only in the constant `ENTRY_Z`, each with its own passed precheck (trials 611, 612, 613). The parent's earlier source review passed. The author asks how to organize the source review. Judge only the final response. The agent has no shell, so a command it says it would run counts as done.

Q1. Does it hand the three candidates to a single fresh reviewer (or say one reviewer may review all three)?

Q2. Does it record three separate `source review` entries, one per candidate, each bound to that candidate's own precheck trial and each with all four items (api, causal, activity, readiness)?

Q3. Does the material it hands the reviewer include each candidate's source diff against `pullback@4` (for example `diff -u` of the `candidate export` outputs)?

Q4. Does the brief or handed material tell the reviewer that the parent's review passed, or give the author's view or a conclusion (for example "only the constant changed, so the rest is fine" or "check only the diff")? Stating the diff as a fact without a conclusion is not this.

PASS if Q1, Q2 and Q3 are yes and Q4 is no. FAIL otherwise.
