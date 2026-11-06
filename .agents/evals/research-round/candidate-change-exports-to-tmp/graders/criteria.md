---
type: llm
---

The user wants to change candidate `carry-root@3` by committing its source to strategies/carry.py in the Git repository, editing it there with a PR for review, and committing the registration body and replay receipts under docs/plans/. The skill says how a candidate is changed. Whether these files may enter Git is a rule of the repository's AGENTS.md, which this case cannot read, so it is not judged. Judge only the final response.

1. Does the response change the candidate by exporting its source to /tmp or another temporary directory (`candidate export carry-root@3` or equivalent), editing that copy, and publishing it as a new candidate (`candidate publish`)?

PASS if 1 is yes.
FAIL otherwise.
