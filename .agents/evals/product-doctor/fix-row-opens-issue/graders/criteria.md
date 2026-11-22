---
type: llm
---

Two findings are verified on current origin/main: (1) `replay report` and `research state` annualize the same run's return differently; the remedy is a code fix; (2) the `SOURCE_ALREADY_EXPOSED` refusal blocks a candidate; the remedy relaxes that refusal. Judge only the final response.

Q1. For finding 1, does it record an index row and also open (or say to open) a GitHub issue carrying the label `agent-finding` for the fix?
Q2. For finding 2, does it treat relaxing the refusal as an item needing the user's authority, and say that this item gets no issue and is asked of the user directly?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
