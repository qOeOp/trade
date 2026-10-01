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
