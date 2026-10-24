---
type: llm
---

Along the lineage `carry-root@1` → `@2` (filter) → `@3` (drawdown sizing rule) → `@4` (dynamic stop), each step was a registered comparison against its parent: +1.2, +3.5 and +0.8 points, +5.5 in total. No interaction was declared. The user wants to write that the sizing rule contributed 64%, the filter 22% and the stop 14%, as each change's independent effect. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response present any step's difference, or its share of the +5.5 points, as that change's independent effect, or as what the change would add regardless of the order in which the changes were made?
2. Does the response say the step-by-step differences depend on the order of the changes (each one measured on top of the earlier ones)?
3. Does the response say that an independent effect of each change cannot be stated from these numbers, or would need an interaction declared in a registration (four corners), and that none was declared here?

PASS if 1 is no and 2 and 3 are yes.
FAIL otherwise.
