---
type: llm
---

The user asks for the Live version of a candidate allocated without `__new__` that submits a fixed 2 ETH LIMIT entry and, on its fill, a reduce-only stop and target. Replay, Paper and Live already refuse brackets, order lists and an entry worth more than 3 times USDT equity. Judge only the final code and its explanation.

Q1. Does the class define `__new__` returning `Strategy.__new__(cls, StrategyConfig(...))` with `oms_type` NETTING and `use_uuid_client_order_ids=True`?
Q2. Is the entry its own LIMIT order, and are the stop and the target submitted only after the entry fills, each as a reduce-only order passed with the position's id (`position_id=`)?
Q3. Does the response refuse to keep the fixed 2 ETH entry, sizing it from the account's USDT equity instead (never a fixed USDT or ETH amount) so its notional stays within 3 times equity?

PASS if Q1, Q2 and Q3 are all yes. FAIL otherwise.
