---
type: llm
---

Judge only the final response. PASS requires all of the following:

1. It accepts/passes the causal item on the supplied verified facts: signal, sizing inputs and specification-check price are all completed and strictly earlier than submission. It checks these separately rather than relying on the daily signal alone.
2. It rejects the colleague's mandatory extra-minute delay. A single native market order having equal submit/fill timestamps does not by itself violate the stated input-clock requirement, since all its market-data inputs precede submission.
3. It does not demand stale native order/position/account state, alter the sizing policy or add an arbitrary engine delay. It does not infer cross-order atomicity from timestamps.
4. It limits the conclusion to this causal item and the stated evidence; it does not claim real execution quality, general partial-fill/race coverage or economic effectiveness.

FAIL if any required item is absent or contradicted.
