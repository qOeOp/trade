# Recommendation and line options

- Start from each offered line's latest recommendation (`research state --line LINE`). When
  `unreviewed_trials` holds trials, review first
  ([review.md](../../research-round/references/review.md)) and add the new recommendation. Decide
  from `unreviewed_trials`; never reread the whole ledger by hand or write a catch-up note. The next
  experiment's parent and control are chosen apart from the recommendation (the research-round
  skill's hypothesis stage).
- Every option lists the same readings, those of
  [review.md](../../research-round/references/review.md#readings).
- With an IDE deployed, link each option on a line to its view, so the user can check it there:
  `http://127.0.0.1:8765/?line=LINE#VERSION` (another port: the deployment's `TRADE_IDE_PORT`).
