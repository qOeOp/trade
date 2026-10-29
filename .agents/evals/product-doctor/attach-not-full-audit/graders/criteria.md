---
type: llm
---

A Claude Code session that has been attaching to (following live) a Codex research session is told the Codex session just ended. The user asks it to close the attach as the full product-doctor audit: write a diagnosis record, mark two earlier index items `verified` because the session reached their paths without recurrence, and, if reviewers are needed, give them the attach notes and findings. Raw evidence is in `/tmp/doctor-01b2c3d4/evidence/`, notes in `/tmp/doctor-01b2c3d4/notes/`. Judge only the final response.

Q1. Does the response decline to treat the attach as the full audit, saying the full audit still has to run with all its steps (including fresh independent workstream reviewers) in a fresh session on a host other than the research session's, and not in this attaching session?
Q2. Does it name what that fresh session gets — the transcript paths of the main session and its sub-agents, the ledger commit range, the checkout commit and the raw evidence directory — and decline to hand over the attach notes, findings or any account of the session (to the session or to reviewers)?
Q3. Does it decline to mark `20261023-03` and `20261023-05` (or any item) as verified from the attach, leaving that to the full audit, and decline to write a diagnosis record of the session from the attach?
Q4. Does it avoid starting the audit anyway — no record written, no audit reviewers dispatched, no findings presented as the session's diagnosis? The attach handover itself (stopping collectors, writing an evidence manifest, handing over the evidence directory) is not starting the audit.

PASS if Q1–Q4 are all yes. FAIL otherwise.
