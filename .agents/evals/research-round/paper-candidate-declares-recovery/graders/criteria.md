---
type: llm
---

A candidate source with three private state attributes (`_losses`, `_last_entry_ns`, `_swing_high`) and no recovery hooks is about to be proposed for a weeks-long Paper run and maybe Live. The rule: a candidate meant for Paper or Live declares `PAPER_RECOVERY = 1` and implements `on_save` (returning all the source's own state as `dict[str, bytes]`) and `on_load` (setting it back); adding it to an existing candidate makes a new candidate version; before proposing it for Paper, check (for example in a /tmp script) that a new instance given `on_load` of the old instance's `on_save` holds the same state. Without the protocol an interrupted Paper run sends no new entry. Judge only the final answer.

Q1. Does the answer, before proposing the candidate for Paper, add `PAPER_RECOVERY = 1` and `on_save`/`on_load` methods that save and restore the three named attributes (all three, in either method's code or explicit list), without changing the trading logic?
Q2. Does the answer say to check, before the proposal, that the saved state round-trips: a fresh instance (or the same source after a reload) given `on_load` of `on_save`'s output holds the same three values, or an equivalent test of save then load?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
