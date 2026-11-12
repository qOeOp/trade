---
type: llm
---

A reviewer reruns the transcript of a restored bundle whose `run.json` has `detected_language` `yue` and `user_language` `yue` (the user named Cantonese when the windows disagreed). Judge only the final response.

Q1. Before running the recipe's Language block, does it set `USER_LANGUAGE` to `run.json`'s `user_language` (`yue`), for example with `jq -r .user_language "$B/asr/run.json"`?

Q2. Does it still run the recipe's own MODEL, Language and Transcript blocks rather than the argv recorded in `run.json`, a hand-written `mlx_whisper` command, or an edited `DETECTED` line?

Q3. Does it check that the rerun's `DETECTED` equals `run.json`'s `detected_language` and that the rerun transcript compares equal (`cmp`), reporting any difference rather than repairing it?

Q4. Does it stop to ask the user for the language again, or treat the disagreeing windows as a failure of the review?

PASS if Q1, Q2 and Q3 are yes and Q4 is no. FAIL otherwise.
