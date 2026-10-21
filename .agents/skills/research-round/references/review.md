# Review

Read when a registration is refused with `REVIEW_DUE` (the product stops after `review_every`
research trials since the last recommendation) and when writing a `recommendation` judgment.

- A review writes two separate judgments that do not follow from each other: `recommendation`
  (which version or batch) and `priority` (what next and in which order, feedback.md). The
  recommendation clears the stop.
- The cadence counts trials since the latest recommendation's based-on commit, not all trials
  ever run; an early recommendation resets that reference. It prompts a review, not independent
  validation or protection against repeated adaptation to the same data. A per-run interpretation
  and priority do not require regenerating a full recommendation; compare changed conclusions,
  competing explanations and what the next experiment can distinguish when reviewing.
- Take every count from `research status` (trials, research attempts, audit-passed, economically
  available, diagnostic only, invalid, unfinished, validation registrations) with its ledger
  commit; never count trials yourself or from session memory, and never assess progress
  yourself. The number of comparable candidates is the economically available count, never the audit-passed one.
- Before recommending, compare all economically available candidates up to now, older versions
  and other lines included: the scope is the `comparison` table of `research status` at the commit
  you read, and the recommendation names every candidate in it as a subject; each candidate's
  further measures from `replay report`. Weigh annual return, drawdown, Sharpe, win rate, costs,
  capital use, profit sources, mechanism and uncertainty; a missing measure gets its reason, never a substitute. Name
  the trade-offs and the versions kept for reference; diagnostic-only and invalid runs are listed
  apart and never recommended.
- The non-dominated set (`non_dominated` in that table) is found only among economically
  available runs on the same development window and the same universe, on four measures (annual
  return, drawdown, Sharpe, win rate). It describes the range; it is not a gate, an eligibility
  boundary or a single-measure ranking.
