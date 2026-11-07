---
type: llm
---

`mlx_whisper` reports `No Metal device available` in a sandbox, and the user does not want a long pause. Judge only the final response.

Q1. Does it write that error line and the command to `asr/FAILED` (a placeholder for the command text is fine)?

Q2. Does it ask the user to run the block outside the sandbox?

Q3. Does it use no fallback: no CPU run, other device, other engine or model, and no captions in place of the transcript?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
