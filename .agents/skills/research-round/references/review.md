# Recommendation and review

Recommendation selects candidates; priority selects experiments (feedback.md). Write a
recommendation at REVIEW_DUE or when the recommended candidate changes; a per-run interpretation and
priority do not require one. Review changed conclusions, competing explanations and the information
another experiment can add.

## Readings

Each candidate's readings come from `replay report` and `hypothesis compare`: annual return with
its `annual_return_interval` and maximum drawdown, each against the user's target (met, or missed by
how much); each development year's return against the annual target and its sealed MARK drawdown
(`mark_max_drawdown`, never recomputed) against the drawdown target, the worst year and the return
without the best year (`dev_years`), and under two years the worst quarter and the return without
the best quarter (`dev_quarters`); with several contracts, `net_without_top_instrument`; Sharpe;
plan win rate; costs; capital use and exposure; the profit mechanism and its profit-source split;
and the uncertainty against its control (or the comparison's diagnosis). A reading the product left
empty, or that needs a missing exposure table, stays empty with the reason; never estimate it or
show a number the reports do not have.

## Recommendation

Use research status at the cited commit for counts and its full comparison table, including older
candidates and other lines. Never reconstruct counts or progress from memory. Comparable candidates are
those with economic evidence on the line's identity, whichever line ran them, not merely passed audits; runs of another
identity are history, never ranked against it. Compare them all. Its
subject is the recommended candidate, and its body weighs the recommended candidate and each comparable candidate whose evidence
or availability changed since the previous recommendation (at the first, every one in `candidates` and each
other line's run the table marks non_dominated) on these readings, naming measures and trials but
never their numbers, which your message to the user gives under the reports' names; it cites the previous recommendation for
the rest instead of restating it. Among candidates that differ only in constants
and that their comparisons leave undistinguished, recommend one whose neighbours on each changed
constant also hold up, not the highest reading, and give the neighbours' range of Sharpe and annual
return beside it in your message, not the body. State trade-offs and retained references; invalid or diagnostic-only runs stay separate and are
not recommended.

A candidate whose `fee_stress.breakeven_fee_multiple` is below about 1.5, or whose
`cost_basis.slippage_stress` annual return at 2 bp per side is at or below zero, gets a
lower-turnover variant registered before it is recommended. When a candidate's
`capital.participation` counts fills `above_volume`, its recommendation cites that count and either
reruns it under `quotes` execution or states that those fills are not credible.

The table's non_dominated set is neither eligibility nor a ranking or gate.
