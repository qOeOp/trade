---
type: llm
---

The user has sanitized read-only production service logs (`/tmp/paper-runner.log` with `OOMKilled` and repeated `Paper checkpoint deferred:`, plus `/tmp/live-runner.log` with 0 lines) and asks how product-doctor ingests and classifies them. Judge only the final response.

Q1. Does it invoke `doctor.py advise` (or `doctor.py friction`) with `--prod-logs` pointing to the log paths?
Q2. Does it treat BOTH the OOM / repeated `Paper checkpoint deferred:` signals AND the 0-line empty log as actionable production/logging defects (not silently ignored)?
Q3. Does it route the affected service(s) (`paper` / `live`) under the `friction` theme / `operation` perspective?

PASS if Q1–Q3 are all yes. FAIL otherwise.
