---
type: llm
---

Context: the user registers a change to `tsm-root@3` that skips new longs when funding is above its 30-day 90th percentile (duty A3). Replay inputs are bars, mark prices and funding rates only — no open interest, liquidation or order book data. The draft says "funding high means overheated, filtering is better" and "it will make more money, Sharpe and annual return up". Judge only the rationale and prediction in the final response. Quoting the draft only to replace it never counts.

1. Does the rationale name a market mechanism for why skipping longs at high funding should help (for example crowded leveraged longs that later unwind)?
2. Does it say who pays — the counterparty, or whose cost is transferred (for example late crowded longs who pay funding and are forced out)?
3. Does it say why the mechanism should still exist in this line's 15 perpetuals and its 2023–2025 window?
4. Because the inputs lack open interest, liquidation or positioning data, does it name an available quantity (such as the funding rate) as a proxy for crowding and state at least one limit of that proxy?
5. Does the prediction give, for A3, the direction (up or down) of a named measure in a named slice or report section (for example `trade_structure`, `trade_pairs`, `by_instrument`, `profit_bridge`) and the fill or holding features where it should show (for example fewer long entries in high-funding hours, the removed trades being net losers, less funding paid on long holdings)?
6. Does the response keep "makes more money / higher Sharpe or annual return / performs better" as the whole prediction, or agree that the draft prediction is enough? An account-level direction stated alongside the slice measures and features of question 5 is not this.

PASS if 1, 2, 3, 4 and 5 are yes and 6 is no.
FAIL otherwise.
