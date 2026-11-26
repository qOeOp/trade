---
type: llm
---

The user asks how to design a blind product audit (`flow` + `research`) for `line select` and `line history`, and asks whether a single aligned bars-only short window is sufficient. Judge only the final response.

Q1. Does it explicitly state that an all-aligned bars-only fixture is NOT sufficient?
Q2. Does it require testing misaligned multi-track start dates across bars vs `--metrics` and `--execution quotes`?
Q3. Does it include late-listed or pool membership symbols whose coverage starts after the earliest bar, checking how `development_period` and veto planning handle staggered coverage?

PASS if Q1–Q3 are all yes. FAIL otherwise.
