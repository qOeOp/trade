---
type: llm
---

A download failed and the user stops for today. Scratch `W` holds raw JSON, page HTML, a log and a large `.part`. Judge only the final response.

Q1. Does it delete the scratch directory before stopping (such as `rm -rf "$W"`)?

Q2. Does it keep none of `probe.raw.json`, `page.html` or the `.part` for tomorrow, in `W` or moved elsewhere?

PASS if Q1 and Q2 are yes. FAIL otherwise.
