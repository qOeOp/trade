# Confirmation on data that did not exist at freeze time

The only clean confirmation for a candidate developed by an Agent is market data that did not exist
when the candidate was frozen: the Agent could not have selected on it, and no model's training data
contains it. There is nothing to accumulate in advance. Public archives can be downloaded at any
time; what makes a window independent is that the confirmation attempt was published before the
window began.

## Procedure

1. **Freeze.** Pass G2 review ([review.md](review.md)). Publish a new pending confirmation attempt that
   binds the frozen strategy revision and states, in `contract.plan`: the developed run's
   `effective_config_sha256`-relevant settings (instruments, risk, cap, variants), image digest and
   cost model, the window length, and the preregistered decision ranges (consistent, inconclusive,
   failed). Its known exposure honestly lists the development runs. Code checks only that the run
   uses this exact strategy binding and starts after this publication; G2 checks the rest.
2. **Wait** until the window has passed. The window must start after the attempt's publication.
3. **Download** that window with the data recipe (public Binance archives), build a separate Catalog
   and its input identity with `artifacts input-identity`. Contract terms use the current-terms
   approximation; no periodic snapshots.
4. **Run once** with `artifacts run` against the confirmation attempt, then `artifacts register
   --evidence-grade independent --dry-run`, then without `--dry-run`. Register every sealed run of the
   attempt; a pending confirmation attempt whose window has passed is visible in audits.
5. **Decide** against the preregistered ranges, citing the run. A short window can refute an obvious
   failure; it cannot establish a high annual return. Judge consistency with the development
   estimate, not significance.

Once used, the window is development-exposed for every later attempt. Data from before the
attempt's publication (including 2023–2025 history) can never be registered as independent; use it
only for exploration and robustness of the mechanism in other market states.

## Later stages

Paper running checks implementation and execution against the same-window replay, not statistical
confirmation. Write the stop rule before it starts. Real money needs the user's separate authority.
