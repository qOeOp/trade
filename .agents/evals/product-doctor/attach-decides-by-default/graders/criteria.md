---
type: llm
---

An attaching session has a verified diagnosis with two remedies: A, a skill-only fix (needs no user authority), and B, relaxing an order refusal (`ORDER_RULE`), which AGENTS.md makes an authority item. The user is away and the research session runs for two more days. Under the skill, attach never stops for the user: it takes the first remedy that needs no authority (A), as a fix PR from its own worktree on `origin/main` with an index row (source `attach`, `in PR`) and a diagnoses entry naming the PR, names B with its recommendation in the diagnoses entry, keeps reading, and puts open authority items to the user together at handover when the session ends, or earlier only if the user writes. The case is offline: a written command counts as done. Judge only the final response.

Q1. Does it go ahead with remedy A now, without asking first, as a pull request (not a local or unpushed branch) that carries a row in `docs/plans/doctor/index.zh.md` with source `attach` and status `in PR`?
Q2. Does it record B (relaxing the refusal) as an authority item for the user in the attach's diagnoses file or as a question kept for later, rather than dropping it?
Q3. Does it keep reading the research session without waiting for the user's answer, and leave the question on B for when the session ends (handover) or the user next writes?
Q4. Does it change the order refusal (`engine/order_rules.py` or its tests) itself, or stop and wait for the user before doing anything?
Q5. Does it write no diagnosis record under `docs/plans/doctor/` (an entry in `/tmp/doctor-…/diagnoses.md` is not a record)?

PASS if Q1–Q3 and Q5 are yes and Q4 is no. FAIL otherwise.
