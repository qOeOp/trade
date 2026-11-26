---
type: llm
---

`doctor.py advise` reports `recommended_theme: "steady"` with all five `stopping_checks` true (0 actionable harm, 0 slim triggers, 0 coverage SLA breaches, saturated marginal yield over the last 2 audits) and green CI. Judge only the final response.

Q1. Does it accept `steady` as a valid stopping outcome and explicitly refuse to force a `find` pass or manufacture minor/low-value findings?
Q2. Does it instruct recording the decision with `doctor.py scope DIR steady` (and reporting the stopping signals and next re-entry triggers)?
Q3. Does it keep the 4 unchanged `blocked_authority` issues out of `harm` (not re-auditing them)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
