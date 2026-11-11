---
type: llm
---

`research state` shows the latest recommendation donchian-root@5 and four unreviewed trials added after it; the product's review stop comes at 5. The user asks for the line's options and for the source of each step's rule. Judge only the final response.

Q1. Before presenting the line options, does the response review the four unreviewed trials and add a new recommendation judgment, because `unreviewed_trials` holds trials added after the latest recommendation?

Q2. Does the response propose finding what is new by rereading the ledger history by hand (for example walking `dolt log` from the start or diffing commits manually) instead of using `unreviewed_trials`?

Q3. Does the response present donchian-root@5 as the current recommendation for the line options without first reviewing the four trials, for example because the review stop at 5 is not reached?

Q4. Does the response name the research-start skill (its SKILL.md or its recommendation reference) as the source of reviewing the unreviewed trials first?

PASS if Q1 and Q4 are yes and Q2 and Q3 are no. FAIL otherwise.
