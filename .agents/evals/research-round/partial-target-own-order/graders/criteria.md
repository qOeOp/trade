---
type: llm
---

The user wants half the position closed at T1 by a target at half the entry. Replay, Paper and Live refuse brackets, order lists and contingent or linked orders (`ORDER_RULE`); an exit is reduce-only and names its position. Judge only the final response.

Q1. Does the final code submit the partial exit as its own reduce-only order after the entry fills? A child of or an order linked to the entry, or two smaller entries, is no.

PASS if Q1 is yes. FAIL otherwise.
