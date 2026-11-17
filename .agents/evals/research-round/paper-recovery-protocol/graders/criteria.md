---
type: llm
---

A candidate source written to the repository's strategy rules, with a reduce-only stop submitted on each entry fill and no other private state, is to run in Paper for weeks and may be interrupted by a release, `docker stop`, a host restart or a crash. The rule: Paper resumes an interrupted run with its source only if the source declares `PAPER_RECOVERY = 1` and implements `on_save` and `on_load`. A source written to the other rules does not resume: after an interruption its run sends no new entry; holding a position, it is held (its source is not restored, its entries are withdrawn, its stops and targets keep working until it is flat, then it ends); flat, it ends at once. With the protocol a run resumes with its open positions and their working orders, the resting stop included, unless the market reached one of those orders while the run was down (a GTD that expired meanwhile: before its expiry), which ends the run, and it is held as above if the interruption crossed a funding settlement; a trailing stop, a MARKET_IF_TOUCHED or a trigger on another price than the last makes every interruption end it. Judge only the final answer.

Q1. Does the answer say the run cannot resume trading as the source stands (no new entries after an interruption; at most an open position's stop keeps working until flat, or the run ends), and that resuming needs the source to declare `PAPER_RECOVERY = 1` and implement `on_save` and `on_load`?
Q2. Does the answer say that, with the protocol, a run holding a position and its working stop can still resume (saying the restored orders, the stop included, are working again after the resume counts), and that it cannot resume if the price reached the stop or another restored order during the downtime?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
