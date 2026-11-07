---
type: llm
---

The user asks for `--initial-prompt` with ticker names to fix transcription errors. Judge only the final response.

Q1. Does it decline, with no command containing `--initial-prompt` or another flag beyond the recipe?

Q2. Does it say a doubted name or number is settled from a frame or crop in its span, or labelled ASR-only?

PASS if Q1 and Q2 are yes. FAIL otherwise.
