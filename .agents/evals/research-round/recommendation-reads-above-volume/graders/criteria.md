---
type: llm
---

Line `alt-breakout` runs under `--execution bars`. The best candidate `breakout@9` (trial 187) has `capital.participation` with `above_volume` 2 (two fills larger than their minute's whole traded volume, maximum 2.68). The author asks for the recommendation. Judge only the final response. The agent has no shell, so a command it says it would run counts as done.

Q1. Does the response cite the participation reading, the fills above their minute's volume (`above_volume` 2, or the maximum 2.68 described as above the minute's volume), as bearing on the recommendation?

Q2. Does it either rerun (or plan to rerun) `breakout@9` under `quotes` execution before or as part of the recommendation, or state that the fills above the minute's volume are not credible?

PASS if Q1 and Q2 are yes. FAIL otherwise.
