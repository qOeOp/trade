# Recommendation and line options

Read whenever the entry presents the recommendation and the line options.

- Start from the latest recommendation in `research state`. When there is none, or
  `unreviewed_trials` holds new trials since it, review first (research-round's review.md) and add
  the new recommendation. Decide from `unreviewed_trials`; never reread the whole ledger by hand or
  write a catch-up note.
- Every option lists the same readings: annual return, maximum drawdown, Sharpe, plan win rate,
  costs, capital use, the profit-source split and the uncertainty against its control (or the
  comparison's diagnosis), from `replay report` and `hypothesis compare`. A reading the product
  left empty, or that needs a missing exposure table, stays empty with the reason; never estimate
  it or show a number the reports do not have.
- The recommendation names the version, the readings it rests on and the trade-offs. The next
  experiment's parent and control get their own reasons: the recommended candidate is not the
  parent by default, and the control is an economically available run.
- Before offering or recommending a line, confirm that its start can be registered on the chosen
  window and that the market database covers every month the window needs (`market coverage` at
  the commit to pin). Only a source that has never run (a root or a revision with a substantive
  change), or a candidate whose research runs are already on that window and commit, can start
  there: the exposure check refuses a source that has already run. A line declares its full
  window once; a frozen rule is tested again only by out-of-sample validation at the user's
  request, on a window after the validation's registration (research-round's validation.md),
  never on earlier months. Offer no option that fails these checks, and say why in one line. A
  missing month is not offered as ready: tell the user which months are missing (bars, or quotes
  for a line that executes on them) and that importing them (`market import` or
  `market import-quotes`) is a separate step that writes the public market database.
