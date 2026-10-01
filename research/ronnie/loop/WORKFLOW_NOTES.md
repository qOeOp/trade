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
