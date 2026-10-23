---
type: llm
---

Judge only the final response to the two-candidate source review. References quoted only to reject them do not count as adoption.

PASS requires all of the following:

1. Neither candidate receives a causal pass on the supplied evidence. A's specification-price input and B's sizing-price input share the order submission/fill timestamp; the earlier daily signal guard does not protect either path. A's prior-month variance sizing is not itself called a same-minute sizing defect.
2. Audit success is not treated as proof of source input causality. The response traces the relevant current-minute close into the order condition or quantity rather than asserting that the EMA signal looks ahead.
3. A is repaired by using an appropriately earlier completed specification price, leaving the declared variance quantity policy intact. B preserves its declared fixed-USDT sizing policy while using an earlier completed price or deferring submission beyond the sizing-price event; it does not silently replace B with fixed-BTC sizing.
4. The response does not claim A's gate actually bound, changed a fill or inflated returns, and does not assert repaired economic parity without evidence. It calls for a new source revision, shortest suitable precheck, new independent review and registration before a formal replay, rather than editing published records or blaming the matcher without evidence.

FAIL if any required item is absent or contradicted.
