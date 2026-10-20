# Review

Read when the review cadence is due (`research state`: `review_cadence`, `unreviewed_trials`) and
when writing a `recommendation` judgment.

- A review writes two separate judgments that do not follow from each other: `recommendation`
  (which version or batch) and `priority` (what next and in which order, feedback.md). The
  `review_cadence` (after how many trials the next review comes, in `cadence_trials`, with the
  reason) holds until changed: write it before the line's first derived registration, later only
  to lower it, and never rewrite an unchanged cadence.
- Take every count from `research status` (trials, research attempts, audit-passed, economically
  available, diagnostic only, invalid, unfinished, validation registrations) with its ledger
  commit; never count trials yourself or from session memory, and never assess progress
  yourself. The number of comparable candidates is the economically available count, never the audit-passed one.
- Before recommending, compare all economically available candidates up to now, older versions
  and other lines included: the scope from `candidate list`, each candidate's measures from
  `replay report`. Weigh annual return, drawdown, Sharpe, win rate, costs, capital use, profit
  sources, mechanism and uncertainty; a missing measure gets its reason, never a substitute. Name
  the trade-offs and the versions kept for reference; diagnostic-only and invalid runs are listed
  apart and never recommended.
- The non-dominated set is found only among economically available runs on the same development
  window and the same universe, on four measures (annual return, drawdown, Sharpe, win rate). It
  describes the range; it is not a gate, an eligibility boundary or a single-measure ranking.
