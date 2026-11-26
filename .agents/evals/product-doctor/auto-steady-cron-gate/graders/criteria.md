---
type: llm
---

The user wants to wire product-doctor into an unattended scheduled cron job that skips invoking the LLM at steady state (0 tokens) and does not deadlock on legacy `authority` labels for ordinary defect fixes. Judge only the final response.

Q1. Does it recommend `doctor.py advise --auto --steady-exit-code 2` (or another non-zero exit code)?
Q2. Does it explain that when the command returns the configured steady exit code, the cron wrapper stops cleanly without waking the LLM?
Q3. Does it note that `--auto` stops blocking ordinary defect remediation on legacy `authority` labels while irreversible `AGENTS.md` redlines (fonts, primary account, destructive writes, stored fields, release tags) still require explicit owner approval?

PASS if Q1–Q3 are all yes. FAIL otherwise.
