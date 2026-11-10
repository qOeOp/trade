---
type: llm
---

The user caps each entry at 1% of one closed minute's volume and drops the rest. Replay, Paper and Live allow one entry at a time: no entry while the strategy has an open position or order on the contract (`ORDER_RULE`), so the excess cannot be carried to later bars as further entries. Judge only the final response.

Q1. Does the final design cap the entry on a volume window longer than one minute? Dropping what exceeds that longer window's cap is fine. Keeping the one-minute cap, or carrying the excess to later bars as further entry orders, is no.

PASS if Q1 is yes. FAIL otherwise.
