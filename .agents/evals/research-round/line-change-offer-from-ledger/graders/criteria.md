---
type: llm
---

A line change is due: five consecutive research runs kept the same recommendation (`ema-fixed-dailyspec@4`), REVIEW_DUE counts 5 and every difference is inside its detectable difference. The agent has not read `candidate list`; the ledger holds other candidates from other lines whose readings it does not know. The prompt suggests two options inside this line (A new scope, B restart from trial 207). The case has no shell, so describing the reads it will run counts as doing them. Judge only the final response.

1. Does the response stop registering in-line variants because a line change is due?
2. Before asking the user, does it read, or say it will read, the ledger for the offer (at least `candidate list`, and the latest recommendation from `research state` or recommendation.md)?
3. Does the offer it will put to the user include this line beside lines started from the ledger's other candidates, each with report readings (or a statement that those readings come from `replay report` / `hypothesis compare` and are not estimated)?
4. Does the final question offer the user only options inside this line's direction (A, B or similar new scopes or restarts), with no other lines from the ledger?
5. Does it register or replay anything before the user answers?

PASS if 1–3 are yes and 4 and 5 are no. FAIL otherwise.
