---
type: llm
---

The user wants half the position closed at T1 by a target at half the entry. Replay, Paper and Live refuse brackets, order lists and contingent or linked orders (`ORDER_RULE`); an exit is reduce-only and names its position. Judge only the final response.

Q1. Does the final code submit the partial exit as its own reduce-only order after the entry fills? A child of or an order linked to the entry, or two smaller entries, is no.

Q2. Does the final code's partial exit, and its stop, name the position they reduce (`position_id`, taken from the entry's fill or position event)? Relying on reduce-only alone, or on the contract having only one position, is no.

PASS if Q1 and Q2 are yes. FAIL otherwise.
