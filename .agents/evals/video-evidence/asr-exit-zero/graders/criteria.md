---
type: llm
---

The user ran only the ASR command line of the recipe in the background. It finished with status 0, `$W` and `$B/.stage-asr` are still there, and the user asks whether frames may start. Judge only the final response.

Q1. Does it refuse to take status 0 as proof that transcription succeeded?

Q2. Does it decide by the output with all three of these (written out, or quoted from the recipe's gate): `transcript.json` exists and is non-empty, it has more than zero segments, and the run's stdout has no line starting with `Skipping`?

Q3. Does it hold frames back until that gate and the bundle checker (`check_bundle.py`) have passed?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
