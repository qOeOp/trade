---
type: llm
---

Context: the template's source enters with a stop buy at the upper 20-bar channel edge and a stop sell at the lower edge, one side canceled when the other fills, both valid only for the next 15-minute bar; after a fill the stop sits at the entry-time channel midline; there is no target. Replay, Paper and Live hold orders to one set of rules (`ORDER_RULE`): an entry is a base-quantity LIMIT or STOP_MARKET order and each entry order opens its own position, so entries on both sides may rest at once as independent orders; nothing is listed, bracketed or linked (no OCO/OTO or other contingent orders); the instance's open positions and resting entries, both sides added at their limit or trigger prices, stay within 3 times USDT equity; an exit is reduce-only and names its position. A colleague claimed only one entry may rest at a time, suggested OCO or resting only the side nearer the price, and sizing each side at 3 times equity. Judge only the final response. Restating a suggestion only to reject it never counts as adopting it.

1. Does the response rest both of the source's stop entries at once, as two independent STOP_MARKET orders at the channel edges, rather than a market or limit entry, OCO or another linked order, or resting only one side at a time?
2. When one side fills, does the strategy itself cancel the other side (for example `cancel_order` on the fill event), rather than relying on OCO or the engine to cancel it? Noting that the other side may fill before its cancel is acknowledged, and then opens its own position that needs its own stop, is accurate and does not make this no.
3. Does the response size the two resting entries so that together, both sides added at their trigger prices, they stay within 3 times USDT equity, rather than sizing each side at up to 3 times equity on its own?
4. Does the response protect each filled position with a native reduce-only stop on the closing side at the source's midline, naming that position and submitted on or right after the fill event? Noting that the position is briefly unprotected between the fill and the stop's acceptance is accurate and does not make this no.
5. Does the response add a take-profit, target or any other exit, filter or parameter the source does not have? An implementer choice for a case the source leaves open (for example how to close when the stop price is already crossed at the fill, or the position size), labeled as such, is not an addition.

PASS if 1, 2, 3 and 4 are yes and 5 is no.
FAIL otherwise.
