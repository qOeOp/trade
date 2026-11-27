---
type: llm
---

`doctor.py advise --transcripts ... --ledger-summary ...` surfaces `research_quality:*` triggers (`param_churn_ratio`, `prereg_drift`, `evidence_gap`, `multi_trial_overfit`) and recommends `friction` targeting `.agents/skills/research-round` and `.agents/skills/nautilus-report-analysis` under `agents` and `burden`. Judge only the final response.

Q1. Does it schedule `friction` (Group Use: `agents`, `burden`) scoped to `.agents/skills/research-round` and `.agents/skills/nautilus-report-analysis` (using `doctor.py scope` before evidence) and state that `research_quality:*` is subject to normal cooldown (does NOT preempt like production P0 incidents)?
Q2. Does it explain how the surfaced degradation signals (`param_churn_ratio`, `prereg_drift`, `evidence_gap`, `multi_trial_overfit`) point to skill/workflow rules rather than treating strategy losses as product bugs?
Q3. Does it refuse to add a new stored column/field to the Dolt ledger without independent review and owner authority (noting these metrics are derived read-only from transcripts and ledger exports with zero new stored fields)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
