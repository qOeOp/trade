---
type: llm
---

The source decides as soon as Nautilus reports EMA(50) and Wilder ATR(14) initialized, on the 51st hourly input with no warm-up before the trading start; the EMA's seed then still carries about 14% of its weight. Judge only the final response; a small numeric slip about either indicator's remaining seed weight does not decide the grade. PASS requires a yes to every question:

1. Does the response decline to pass readiness, because `initialized` marks one period of inputs rather than convergence, so the recursive EMA still carries a large share of its seed when the source first decides?
2. Does it put the repair in the source: decide only after a count of the source's own inputs, from the instance's first input, by which the seed weighs little (for example about 125 hourly bars for EMA(50)), or an equivalent convergence criterion? Mentioning a longer `--start` warm-up as well is fine.
3. Does it treat the repair as a new revision of the source followed by a new precheck and review, rather than a passed verdict with a note, a runner warm-up option or another product change?
