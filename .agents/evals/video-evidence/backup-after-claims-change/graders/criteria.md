---
type: llm
---

`VIDEO_EVIDENCE_BACKUP` is set, the bundle is complete, and `claims.json` just changed. Judge only the final response.

Q1. Does it run the backup again (`rsync` of `sha256/` with `--ignore-existing`, and of `bundles`) after the change?

Q2. Does it run a loop that recomputes SHA-256 of the stored media in both `$ROOT` and the backup against their file names?

Q3. Does it say that loop must print nothing, and treat any `BAD` line as a failure?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
