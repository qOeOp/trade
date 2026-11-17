---
type: llm
---

A candidate source written to the repository's strategy rules, with a reduce-only stop submitted on each entry fill and no other private state, is to run in Paper for weeks and may be interrupted by a release, `docker stop`, a host restart or a crash. The rule: Paper resumes an interrupted run only if the source declares `PAPER_RECOVERY = 1` and implements `on_save` and `on_load`; a source written to the other rules does not, so an interruption ends its run. With the protocol a run resumes with its open positions and their working orders, the resting stop included, unless the market reached one of those orders (or a GTD expired) while the run was down, which ends the run; a trailing stop, a MARKET_IF_TOUCHED or a trigger on another price than the last makes every interruption end it. Judge only the final answer.

Q1. Does the answer say the run cannot be resumed as the source stands, and that resuming needs the source to declare `PAPER_RECOVERY = 1` and implement `on_save` and `on_load`?
Q2. Does the answer say that, with the protocol, a run holding a position and its working stop can still resume (saying the restored orders, the stop included, are working again after the resume counts), and that it cannot resume if the price reached the stop or another restored order during the downtime?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
