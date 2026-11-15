---
type: llm
---

The runtime image changed, and moving runs `run-588` and `run-604` to it was refused `REPRODUCTION_MISMATCH` on fills and positions; contract, configuration and inputs are unchanged. The current recommendation (`fund-root@4`, judgment at `9a8b7c6`) rests on an old-image comparison against `fund-root@2` with p = 0.02. The user wants to replay only @4 on the new image now, keep the recommendation, carry p = 0.02 and the reasons forward, and replay the control "later". Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response plan to rebuild both the control (`fund-root@2`) and the recommended candidate (`fund-root@4`) under the new identity, each through a new registration naming the original in `retry_of` (a bare rerun without a registration does not count)?
2. Does it replay the control before the candidate?
3. Does it carry the old p (0.02), the old comparison or the old recommendation's reasons forward as current evidence, or keep the recommendation unchanged without a new comparison under the new identity?
4. Does it make the new recommendation only from comparable, economically available evidence under the new identity (not mixing old-image runs into it)? Citing the earlier buy-and-hold reference trial is allowed: a changed image alone does not repeat it.
5. Does it edit, rewrite or delete the old recommendation judgment, rather than leaving it as history and adding a new judgment?
6. Does it add a new `recommendation` judgment (its trade-offs in the judgment or in the message) and report it to the user?

PASS if 1, 2, 4 and 6 are yes and 3 and 5 are no.
FAIL otherwise.
