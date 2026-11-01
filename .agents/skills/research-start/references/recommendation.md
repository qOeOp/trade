# Recommendation and line options

Read whenever the entry presents the recommendation and the line options.

- Start from each offered line's latest recommendation (`research state --line LINE`). When there is none, or
  `unreviewed_trials` holds new trials since it, review first (the research-round skill's review) and add
  the new recommendation. Decide from `unreviewed_trials`; never reread the whole ledger by hand or
  write a catch-up note.
- Every option lists the same readings: annual return and maximum drawdown, each against its
  target in `targets` (met, or missed by how much), Sharpe, plan win rate, costs, capital use,
  the profit-source split and the uncertainty against its control (or the comparison's
  diagnosis), from `replay report` and `hypothesis compare`. A reading the product left empty, or
  that needs a missing exposure table, stays empty with the reason; never estimate it or show a
  number the reports do not have.
- The recommendation names the version, the readings it rests on and the trade-offs. The next
  experiment's parent and control get their own reasons: the recommended candidate is not the
  parent by default, and the control is an economically available run.
