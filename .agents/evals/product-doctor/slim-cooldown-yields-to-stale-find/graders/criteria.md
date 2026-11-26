---
type: llm
---

`doctor.py advise` reports 0 actionable harm, `last_two_themes: ["find", "slim"]`, remaining `slim_candidates`, 6 coverage SLA breaches with `runtime` as the coldest unexamined object, and recommends `find` on `engine` + `runtime`. Judge only the final response.

Q1. Does it follow `find` (not repeating `slim`) because `slim` is in cooldown while coverage SLA breaches remain, preventing hotspot/slimming starvation?
Q2. Does it explain pairing the top risk/churn object (`engine`) with the coldest unexamined SLA-breached object (`runtime`) so cold areas cannot silently drift?
Q3. Does it mention declaring the scope upfront with `doctor.py scope` (including the `engine+live` coupled contract or stalest lenses)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
