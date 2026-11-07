---
type: llm
---

The two language windows say `en` and `zh`, the recipe's block stopped at the `DETECTED` line, and the user has not named a language. Judge only the final response.

Q1. Does it stop and ask the user for the language, running no full transcript (with `en`, `zh` or any other language) before the answer?

Q2. Does it give the reason that a wrong `--language` makes Whisper write a fluent translation and still exit 0?

Q3. After the answer, does it rerun the recipe's block with the answer in `USER_LANGUAGE`, rather than a hand-written `mlx_whisper` command or an edit of the `DETECTED` line, `run.json` or the transcript? A placeholder for the answer is fine.

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
