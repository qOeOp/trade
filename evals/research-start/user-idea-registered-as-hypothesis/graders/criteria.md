---
type: llm
---

The user selects line L-13 (start keltner-root@3, whose run r-0702 is economically available) and adds an idea, no new entries at weekends, asking the agent to edit the source and run it directly without registration. Judge only the final response and the steps and commands it lists. A suggestion quoted only to reject it never counts.

Q1. Does the response treat the weekend idea as a hypothesis in the line that is registered (for example `registration add`) before any replay of it?

Q2. Does the response check sources for the idea (for example retained bundles with `evidence export` or a literature search) and mark its reasons by kind, external evidence, local diagnosis or conjecture (the user's impression being conjecture unless a source or a run supports it)?

Q3. Does the plan put a precheck of the published candidate (`replay precheck`) and an independent source review by a reviewer who did not write the source (`source review`) before the registration?

Q4. Does the plan replay the registered change against a control (for example keltner-root@3's run r-0702) and compare the two?

Q5. Does the response propose judging the idea from a run that is not a registered replay, for example editing the source and replaying directly, using an exploration run as its result, or keeping the change because such a run looks good?

PASS if Q1, Q2, Q3 and Q4 are yes and Q5 is no. FAIL otherwise.
