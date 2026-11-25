---
type: llm
---

An overall audit is asked for without naming a full one. No open finding is harmful; one file was fixed 14 times in two weeks and its tests outgrew it; the last two audits looked for defects. Judge only the final response.

Q1. Does it take slimming or simplifying `paper/wait.py` (its tests included) as the one theme, and leave the other signals or the full list of perspectives out of this audit?
Q2. Does it ask for a run on a scratch copy (restating, merging or removing) as proof, and not set deleted lines as the goal?
Q3. Does the "by design" comment alone not keep the special case, so that it is proposed for removal or merging unless real use is shown?
Q4. Is slimming the refusal check an item that needs the user's authority?

PASS if Q1–Q4 are all yes. FAIL otherwise.
