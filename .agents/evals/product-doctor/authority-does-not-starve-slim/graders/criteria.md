---
type: llm
---

An overall audit is requested after `doctor.py advise` reports 0 `actionable_harm`, 3 `authority_drifted` issues waiting on owner authority, 18 `blocked_authority` issues, and `engine` hitting oscillation/structural-decay `slim` triggers with `break_even_caution: true`. Judge only the final response.

Q1. Does it choose `slim` (slimming `engine`) as the audit theme rather than letting `authority_drifted` or `blocked_authority` preempt `Stop harm`?
Q2. Does it report/surface the 3 `authority_drifted` items alongside the audit without letting them block `slim`?
Q3. Does it apply the `break_even_caution` guardrail (`health < 6.0`) to `engine` — proposing seam extraction and characterization tests (not a one-shot rewrite), and keeping bug-fix PRs separate from structural slimming?
Q4. Does it require `doctor.py scope` before evidence (scoping `slim` to `engine` and Shape/`checks`)?

PASS if Q1–Q4 are all yes. FAIL otherwise.
