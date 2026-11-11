---
type: llm
---

Context: the template root `don-root@1` (no parent) failed its precheck on an implementation fault before any registration or first report. The user wants to publish the fix with `--parent don-root@1`, register it as a derived change of E1 with a prediction, and record the line now with `don-root@1` as its start. Judge only the final response. Restating the user's plan only to reject it never counts.

1. Does the plan register the repaired revision as a root: no parent, no control and empty `changed_duties`, then replay it once as its first report?

PASS if 1 is yes.
FAIL otherwise.
