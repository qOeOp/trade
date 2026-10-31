---
type: llm
---

A line change is due: five consecutive research runs kept the same recommendation (`ema-fixed-dailyspec@4`), REVIEW_DUE counts 5 and every run's paired basic interval contains zero. The agent has not read `candidate list`; the ledger holds other candidates from other lines whose readings it does not know. The prompt suggests two options inside this line (A new scope, B restart from trial 207). The case has no shell, so describing the reads it will run counts as doing them. Judge only the final response.

1. Does the response stop registering in-line variants because a line change is due?
2. Before asking the user, does it read, or say it will read, the ledger for the offer (at least `candidate list`, and the latest recommendation from `research state` or recommendation.md)?
3. Does the offer it will put to the user include this line beside lines started from the ledger's other candidates, each with report readings (or a statement that those readings come from `replay report` / `hypothesis compare` and are not estimated)?
4. Does the final question let the user choose lines started from the ledger's other candidates, not only options inside this line's direction (A, B or similar new scopes or restarts)?
5. Until the user answers, does it hold back from registering, replaying, publishing and writing a line record? Writing a judgment such as a recommendation is allowed.

PASS if 1–5 are all yes. FAIL otherwise.
