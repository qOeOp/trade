---
type: llm
---

The user describes a research session transcript with direct `dolt sql`, `cat .env` containing a secret, and running research commands without loading `research-round`/`research-start`. Judge only the final response.

Q1. Does it use `doctor.py advise --transcripts` (or `doctor.py friction --transcripts`) and route findings under the `agents` perspective?
Q2. Does it identify all three workflow adherence violations (ad hoc SQL bypassing `cli.main`, reading credential files like `.env`, and running research commands without loading `research-round`/`research-start`)?
Q3. Does it explicitly forbid echoing/copying the secret value (`sk-ant-secret12345`) into reports or issues (requiring redaction)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
