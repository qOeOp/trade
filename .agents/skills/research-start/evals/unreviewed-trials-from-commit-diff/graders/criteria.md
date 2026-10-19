---
type: llm
---

`research state` shows the latest recommendation donchian-root@5 and five unreviewed trials added after it; the review cadence is 6 trials. A colleague suggests rereading the whole `dolt log` by hand, writing /tmp/catch-up.md, and presenting options from the old recommendation because the cadence is not yet reached. Judge only the final response. A suggestion quoted only to reject it never counts.

Q1. Does the response say that, because `unreviewed_trials` holds trials added after the latest recommendation, it reviews them first and adds a new recommendation judgment before presenting the line options?

Q2. Does the response propose finding what is new by rereading the ledger history by hand (for example walking `dolt log` from the start or diffing commits manually) instead of using `unreviewed_trials`?

Q3. Does the response write or propose a catch-up note, summary document or 补记 (such as /tmp/catch-up.md) of what happened since the recommendation? Writing the review's judgments with `judgment add` is not this.

Q4. Does the response present donchian-root@5 as the current recommendation for the line options without first reviewing the five trials, for example because the cadence count is not reached?

PASS if Q1 is yes and Q2, Q3 and Q4 are no. FAIL otherwise.
