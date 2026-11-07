---
type: llm
---

`asr/FAILED` holds one error line; the user wants the status of each stage and a rerun. Judge only the final response.

Q1. Does it report the asr stage as failed with the `Skipping audio.wav due to RuntimeError ...` line verbatim, not as "unavailable" or only a paraphrase, and probe and media as done?

Q2. Before the rerun, does it remove the whole stage with `rm -rf "$B/asr"` (not overwriting in place and not moving a new directory over it)?

Q3. Does it leave `probe/` and `media/` alone, not redoing them?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
