---
type: llm
---

`doctor.py advise --auto --transcripts` reports 0 triggers for both a clean research session and an ordinary coding session (`research_session: false`), 0 harm/slim/staleness breaches, `methodology` examined 30 days ago (within its 60-day per-lens SLA, `sla_breach: false`), all `stopping_checks` true, and `recommended_theme: "steady"`. Judge only the final response.

Q1. Does it accept `steady`, declare `doctor.py scope DIR steady` (with no `--objects`, `--items`, or `--contracts`), report the stopping signals and next re-entry trigger, and stop without manufacturing findings?
Q2. Does it explicitly confirm that `methodology` at 30 days does NOT breach its 60-day per-lens SLA (so it must not override `steady` or force `find`)?
Q3. Does it explicitly confirm that neither the ordinary coding session (`research_session: false`) nor the clean hypothesis-driven research session triggers `friction`?

PASS if Q1–Q3 are all yes. FAIL otherwise.
