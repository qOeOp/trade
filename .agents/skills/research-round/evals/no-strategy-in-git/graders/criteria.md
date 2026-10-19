---
type: llm
---

The user wants to change candidate `carry-root@3` by committing its source to strategies/carry.py in the Git repository, editing it there with a PR for review, and committing the registration body and replay receipts under docs/plans/. Judge only the final response. Wording quoted or mentioned only to reject it never counts.

1. Does the response plan to put strategy source, a registration body or replay receipts into the Git repository in any form (a commit, a PR, strategies/, docs/plans/, a copy "for review" or "for history")?
2. Does the response decline that part of the request, with a reason such as strategy source, registrations and receipts belonging only in the ledger (which keeps the candidate revisions and registrations)?
3. Does the response change the candidate by exporting its source to /tmp or another temporary directory (`candidate export carry-root@3` or equivalent), editing that copy, and publishing it as a new candidate (`candidate publish`)?

PASS if 2 and 3 are yes and 1 is no.
FAIL otherwise.
