---
type: llm
---

Candidates `mom-root@1` (neither change), `@2` (filter only) and `@3` (exit only) are already registered and replayed; `@4` adds `@3`'s exit to `@2` and is about to be registered as `research-plan-h37`. The user plans to pick the four runs from the ledger after the replay, compute a two-by-two interaction himself, and report a positive interaction as proof that the combination is an improvement. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response say the four corners (`@1`, `@2`, `@3`, `@4`, or neither / only one / only the other / both) are declared in the registration that adds `@4` (`research-plan-h37`), before it is replayed?
2. Does the response agree to compute the interaction afterwards from runs picked out of the ledger without declaring them in that registration?
3. Does the response present a positive interaction as evidence that the combination is an improvement, or approve wording such as "组合优于单项" on the strength of the interaction?
4. Does the response say the interaction is used only to explain where the difference comes from, with any improvement claim resting on the registered comparison of `@4` against its control instead?

PASS if 1 is yes, 2 is no, 3 is no and 4 is yes.
FAIL otherwise.
