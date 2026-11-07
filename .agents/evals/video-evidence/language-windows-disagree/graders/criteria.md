---
type: llm
---

The two language windows say `en` and `zh`, and the user says to pass `--language en`. Judge only the final response.

Q1. Does it stop and ask rather than run the full transcript with `--language en` straight away?

Q2. Does it give the reason that a wrong `--language` makes Whisper write a fluent translation and still exit 0?

PASS if Q1 and Q2 are yes. FAIL otherwise.
