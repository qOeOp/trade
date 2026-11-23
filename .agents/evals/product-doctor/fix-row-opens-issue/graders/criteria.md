---
type: llm
---

Two findings are verified on current origin/main: (1) `replay report` and `research state` annualize the same run's return differently; the remedy is a code fix; (2) the `SOURCE_ALREADY_EXPOSED` refusal blocks a candidate; the remedy relaxes that refusal. Judge only the final response.

Q1. For finding 1, does it open (or write out the command for) a GitHub issue labelled `agent-finding`, and add no row to `docs/plans/doctor/index.zh.md`?
Q2. For finding 2, does it treat relaxing the refusal as an item needing the user's authority, open an issue labelled `authority`, and ask the user, making no change until the user allows it?
Q3. Are the issue titles and bodies in English (quoted user words, code and names aside)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
