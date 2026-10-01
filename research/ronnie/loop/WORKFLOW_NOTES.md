# Workflow notes: problems met while running the autonomous R&D loop

Input for the product's R&D system. Each note: what happened, why it matters, a proposal.

## Before the first loop

1. **The holdout ran out.** After about 40 trial families, every standard coin set had been read at least once. A
   clean final tier needed a hand-built list of never-used coins, made by scanning every script for coin literals.
   - **Proposal:** the R&D system keeps a ledger of every (instrument, period) read and by which trial. It hands out
     untouched holdout slices on request and refuses a second read.
2. **The validation level has to know the trial history.** Deflating for multiple testing needs the count of earlier
   validated candidates. Here that count lives in a CSV the loop appends to, so it is only as good as the discipline
   of writing to it.
   - **Proposal:** the census is a system record, and the validation step reads its level from it, not from the
     caller.
3. **Pre-registration is a commit, not a gate.** Nothing stops a run before its registration is committed; the order
   holds by convention.
   - **Proposal:** a run request carries the registration hash; the runner refuses an unregistered configuration.

## Loop A1

4. **Attribution by terciles is weak when every cell is negative.** All 24 cells lost; the "best" tercile only lost
   less. Picking the least bad cell as the next change is the overfitting path the protocol forbids, unless an outside
   source agrees.
   - **Proposal:** attribution reports a decomposition (stopped-out share, time to stop, maximum favourable excursion
     before the stop, result against the control in the same regime), so a loss is located in the entry, the stop or
     the target rather than in a feature bucket.
5. **The control decides the verdict.** The control is random entries of the same coin, year and side. In a trend
   regime, random entries in the trend's direction earn (+0.13R here), so the bar a trend-aligned setup must clear is
   high. A regime-matched control would answer a different question: does the level add to the trend?
   - **Proposal:** the control is part of the hypothesis registration (year-matched, regime-matched, or both reported).
6. **The attribution proposal (note 4) was needed at once.** Loop A2 followed the A1 tercile reading and got worse,
   because that reading did not carry over. A decomposition helper (stops within 2 bars, MFE before the stop) was
   written mid-run, and it pointed at the entry with a clear mechanism. An R&D system should ship this decomposition
   as the default attribution, before any feature buckets.
7. **Attribution must use the run's exit model.** The decomposition helper re-walked trades with the plain exits, so
   for A4 (time stop) it reported the A3 figures. Any attribution must take the exact trade model of the run, ideally
   from the trade records the run itself writes (exit bar, exit reason, MFE), not a reconstruction.
8. **A relative gain can hide an absolute loss.** A4 narrowed the gap to the control because the control got worse
   under the same time stop. The report should show both R and control side by side, and flag a "gain" made by
   lowering the control.
9. **Multi-timeframe features need explicit time alignment.** In A5 the level age was computed as a daily index minus a
   weekly index. Nothing flagged it; the tercile table printed plausible-looking numbers. A feature layer should carry
   each series' timeframe and refuse arithmetic across timeframes without an explicit alignment step.
10. **Small samples pass through.** A5's +0.24R on 58 trades looks like a breakthrough, and its interval spans zero.
    A report should lead with the interval and the per-half split, and say plainly when the sample cannot decide.
11. **A near miss has no defined path.** A8 passed both halves but missed the pooled interval narrowly, on 51 trades.
    The protocol has no step for "promising but under-sampled": validation would spend the clean tier on a candidate
    tuned through eight looks, and a ninth loop breaks the family budget. A forward record is the only clean option,
    and it is slow.
    - **Proposal:** the R&D system has a "needs more data" state that routes a near miss to a sample expansion
      registered in advance: more instruments or an earlier period in the iteration tier, chosen before the expansion
      is scored. That state is distinct from "failed" and from "validated".
12. **Loop count is the real multiplicity.** Eight informed looks at one tier make even a pass optimistic. The census
    records them, but nothing yet converts that count into a haircut on the reported edge.
    - **Proposal:** report a deflated edge alongside the raw one (for example, a deflated Sharpe ratio or a holdout
      haircut per look).
13. **One change per loop, applied as a filter, collapses the sample.** Family B went from 350 to 154, 121 and then 20
    trades as each loop added a condition. The rule "one change per loop" is good for attribution, but with filters it
    trades statistical power for interpretability, until nothing can be decided.
    - **Proposal:** before a loop runs, the system estimates its trade count from the predecessor (the share of trades
      the new condition keeps) and the minimum detectable edge at that count. It warns when the loop cannot reach the
      gate even if the edge is real.
14. **A rule that can never fire reports as a crash, not as a finding.** B-5 (daily levels with two-close confirmation)
    produced zero signals: a daily level crossed by the first close leaves the book before the second close, so the
    condition was unsatisfiable. It surfaced only as a KeyError in the report code.
    - **Proposal:** the runner checks signal counts per instrument before scoring and reports "zero signals: condition
      never satisfied" with a trace of which clause eliminated the candidates.
    - **Fix here:** the levels are read at the open of the first crossing bar. B-3 and B-4 used the weekly book, where
      this matters only when the two closes straddle a week boundary; their results stand as run.
15. **Earlier families contaminate the tiers of later ones.** O3 was read on 2023-2026 large caps before this protocol
    existed, so the protocol's validation tier is already spent for that lineage. Only a ledger of reads per lineage
    (note 1) can tell this; here it was caught by memory.
16. **Data latency shapes the loop.** The carry family's funding and kline archives (37 coins x 80 months x 3 files)
    took hours through a throttled downloader, while a strategy loop on cached bars takes about a minute. An R&D
    system needs a market-data layer that is prefetched and shared, so a loop's cost is computation, not download.
17. **A silent key collision corrupted 20 loops of attribution.** Features were stored in a dict keyed by (time, side).
    Daily bars share timestamps across coins, so features of different coins overwrote each other. Every tercile
    table looked plausible. The bug surfaced only when a trade listing showed three coins with identical features.
    Two loop decisions (A2, and partly C-2) rested on corrupted tables.
    - **Proposal:** trade records carry their own features at creation (one record per trade, with the instrument in
      its identity); attribution never joins features back by a partial key. An integrity check flags identical
      feature vectors across instruments.
18. **Tercile cuts on tied values invent groups.** The B-family "touches" feature is always 0, yet the table showed
    three groups with different edges, because ranking with ties split identical values arbitrarily. Attribution
    should refuse a feature with too few distinct values, or group by value.
19. **The halves rule ignores power.** C-4 passed the pooled interval, but its first half held 15 trades, and one
    clustered loss (three coins on 2018-11-22) sank it. Requiring both halves positive is sound against regime luck,
    but it needs a minimum count per half, or a pooled test with time-clustered resampling instead.
20. **A change can interact with the trade geometry and silently shrink the sample.** C-5's confirmation raised entries
    and pushed most targets under the 1R floor, so 61 of 76 trades vanished by a filter the loop did not name. The
    report should break down why candidate signals were dropped (target floor, stop cap, spacing, cancellation), so
    an unintended filter is visible.

## Attribution as factor evaluation (added after the user's review)

21. **The attribution had no system.** Tercile means gave no strength measure, no stability across time, no
    monotonicity and no multiple-testing control, so a noisy cell could steer a loop (A2). `loop/attrib.py` now reports,
    per feature:
    - the rank IC with the edge;
    - per-year IC with ICIR, t and hit rate;
    - the IC in each half;
    - quintile buckets with monotonicity and a coin-clustered Q5-Q1 interval;
    - a reliability flag (|t| >= 2, the same IC sign in both halves, and a Q5-Q1 interval excluding zero);
    - the number of features tested;
    - `compare` for IC decay from iteration to validation.
    A common feature set (BTC trend, coin trend, 20-bar return, volatility ratio, volume ratio, stop width, target R) is
    computed by the engine per trade and stored on the trade record, which also removes the cause of note 17.
22. **What the new attribution found at once.** On A3, BTC's trend is a reliable factor (IC +0.12, ICIR 2.6 over four
    years, Q5-Q1 +0.47R [+0.23, +0.70]), and the number of prior touches is reliably negative: the opposite of the
    tercile reading that motivated A2. The tercile tool never offered BTC's trend, because it was not a feature.
23. **Rare events cannot get a stability measure.** C-4 has only one year with 8 or more trades, so ICIR is not
    computable. The report says so instead of printing a number. Rare-event families need pooled tests with
    clustering, or a broader universe.
24. **Reruns inflate the census.** Re-scoring a loop to produce a new attribution appended a second trial row. Reruns
    are now marked `rerun-*` (environment flag `LOOP_RERUN`), and the validation level counts only real validations.
25. **A factor can be market timing in disguise.** BTC's trend predicts the support-bounce edge, but the control is
    random entries of the same year, so a factor that times the market within the year will look like strategy skill.
    - **Proposal:** attribution also reports each feature's IC with a regime-matched control's outcome (random entries
      on days in the same feature bucket). A feature that predicts the control too is beta, not skill.
26. **Factor stability must be judged across loops, not within one.** The volatility ratio is "reliable" in A10 with a
    positive sign, while the weekly-level loops favoured low volatility. Each loop's attribution sees only its own
    trades.
    - **Proposal:** the R&D system keeps a factor ledger across loops: each feature's IC and sign per loop, with the
      configuration. It requires a factor to hold its sign across related configurations before it may drive a
      change (meta-attribution). The per-loop flag is necessary, not sufficient.
27. **Informal looks are trials.** Sizing loop C-6 meant computing its trades' edge on the iteration tier. Nothing
    records such looks unless the agent writes them down, and they shape decisions as much as a registered run does.
    - **Proposal:** every query of trade outcomes goes through the R&D system, which logs it as a trial. Sizing
      questions are answered from counts only, without outcomes.
28. **An admissible factor may have no admissible threshold.** The target R passes the ledger, but at the natural cut
    (1:2) it keeps 5 trades. Any other cut would be read off the data. The ledger should report, with each admissible
    factor, the share of trades its natural threshold keeps.
29. **The beta check overturned the family's best lead.** BTC's trend was flagged in 4 loops with a stable sign, the
    strongest ledger factor in the research. Random entries showed the same bucket pattern, so it was market timing.
    Without this check, "support bounces when BTC is strong" would have gone to validation as a strategy.
    - **Proposal:** the beta check runs automatically for every flagged factor and is part of admissibility: a factor
      whose bucket pattern also appears in random entries is labelled "regime", and it is offered as a regime filter
      for an existing regime strategy, never as a source of entry skill.
