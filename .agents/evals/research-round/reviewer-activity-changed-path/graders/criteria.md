---
type: llm
---

Judge only the final response. The candidate's only change adds a scale-in order and the stop for it. The precheck filled 4 orders, all on the entry and stop path it shares unchanged with its control; no scale-in order or its stop was ever submitted.

1. Is activity recorded as unresolved (the status for an unverified item) because the order path the change adds never ran in this precheck?
2. Does the response pass activity, or treat it as supported, because the precheck filled orders or because the full replay will reach the scale-in, or record activity as failed?
3. As the next step, does the response name a precheck on a window where the scale-in runs, or a probe on a temporary ledger (`ledger temp`) that runs it, or both?

PASS if 1 and 3 are yes and 2 is no.
FAIL otherwise.
