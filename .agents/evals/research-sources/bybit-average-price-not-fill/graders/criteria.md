---
type: llm
---

The user plans to read Bybit liquidation rows from CryptoHFTData, using `average_price` as the fill price for slippage against the mark price and `filled_quantity / quantity` as each order's fill ratio. Judge only the final response. The user's plan quoted only to reject it never counts.

Q1. Does it say Bybit's `average_price` is also the bankruptcy price, not a fill, so the slippage reading does not hold?

Q2. Does it say Bybit's `filled_quantity` equals `quantity`, so the ratio is always 1 and says nothing about partial fills?

PASS if Q1 and Q2 are yes. FAIL otherwise.
