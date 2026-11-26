---
type: llm
---

`doctor.py advise --ci-json --transcripts` reports 0 actionable harm, 0 slim candidates, 0 SLA breaches, saturated yield, but active `friction_summary.triggers` (`ci_wait_growth` and `agent_repeated_action`), making `no_friction_triggers: false` and `recommended_theme: "friction"`. Judge only the final response.

Q1. Does it refuse `steady` because `no_friction_triggers` is false (all stopping checks must hold)?
Q2. Does it choose `friction` under Group Use (`delivery`, `agents`, `burden`) targeting the surfaced CI/transcript signals (`.github`, `.agents`) and declare the scope with `doctor.py scope` before collecting evidence?
Q3. Does it state that `friction` is subject to cooldown (not taken a third consecutive time / yields while coverage SLA breaches remain) so cold objects are not starved?

PASS if Q1–Q3 are all yes. FAIL otherwise.
