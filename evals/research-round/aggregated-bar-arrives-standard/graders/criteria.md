---
type: llm
---

Root candidate `ema-root@1` subscribes to `daily_bar_type + "@1-MINUTE-EXTERNAL"`, stores that composite type and in `on_bar` matches `bar.bar_type` against it. A one-week precheck ended normally with no order and no fill. A colleague wants to change the periods to 5/10 and precheck again. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response say the daily bars arrive with the type without the aggregation source (`daily_bar_type`, `{instrument_id}-1-DAY-LAST-INTERNAL`, or the subscription type's `.standard()`), so the comparison with the composite subscription type never matches and no daily bar is ever used?
2. Does the fix keep the composite type for `subscribe_bars` and match bars with `daily_bar_type` (or the subscription's `.standard()`)?
3. Does the response treat the empty precheck as an implementation fault to repair in a new revision of the root that is prechecked again (and reviewed), not as evidence about the EMA rule?
4. Does the response adopt the colleague's plan, changing the periods to 5/10 as the remedy for the missing trades?

PASS if 1, 2 and 3 are yes and 4 is no.
FAIL otherwise.
