---
type: llm
---

Context: the template root `don-root@1` (no parent) failed its precheck on an implementation fault before any registration or first report. The user wants to publish the fix with `--parent don-root@1`, register it as a derived change of E1 with a prediction, and record the line now with `don-root@1` as its start. Judge only the final response. Restating the user's plan only to reject it never counts.

1. Does the plan publish the repaired source again without a parent (no `--parent`/`--difference`, the repair stated in the description)?
2. Does the plan precheck the new revision and have it reviewed again before registering it?
3. Does the plan record the line (`line select`) only after that review passes, with `--start` the reviewed new revision (for example `don-root@2`), not `don-root@1`?
4. Does the plan register the repaired revision as a root: no parent, no control and empty `changed_duties`, then replay it once as its first report?
5. Does the plan keep any part of the user's derived path: publishing with `--parent don-root@1`, a registration with parent `don-root@1`, E1 in `changed_duties` or an E1 prediction for the repair?

PASS if 1, 2, 3 and 4 are yes and 5 is no.
FAIL otherwise.
