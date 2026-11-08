---
type: llm
---

The user asks for the Live version of a candidate that submits a native bracket. Judge only the final code and its explanation.

Q1. Does the final code never use `bracket` or `submit_order_list` as an attribute (a comment naming them does not count), submitting the entry as its own LIMIT order?
Q2. Does the class define `__new__` returning `Strategy.__new__(cls, StrategyConfig(...))` with `oms_type` NETTING and `use_uuid_client_order_ids=True`?
Q3. Are the stop and the target submitted only after the entry fills, each as a reduce-only order passed with the position's id (`position_id=`)?
Q4. Does the response refuse to keep the fixed 2 ETH entry, sizing it so its notional stays within Live's cash budget of at most 100 USDT instead (from native equity at no more than 1x, on an account holding the budget, or from the operator's limits)?

PASS if Q1, Q2, Q3 and Q4 are all yes. FAIL otherwise.
