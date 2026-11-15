---
type: llm
---

A candidate source written to the repository's strategy rules, with a reduce-only stop submitted on each entry fill and no other private state, is to run in Paper for weeks and may be interrupted by a release, `docker stop`, a host restart or a crash. The rule: Paper resumes an interrupted run only if the source declares `PAPER_RECOVERY = 1` and implements `on_save` and `on_load`; a source written to the other rules does not, so an interruption ends its run; and a run with any order that is not final, a working stop included, is not resumed even then. Judge only the final answer.

Q1. Does the answer say the run cannot be resumed as the source stands, and that resuming needs the source to declare `PAPER_RECOVERY = 1` and implement `on_save` and `on_load`?
Q2. Does the answer say that an interruption while an order is still working, a resting stop included (so while a position is open), is not resumed even with the protocol declared?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
