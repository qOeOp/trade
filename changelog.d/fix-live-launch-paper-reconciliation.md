- IDE Live launch: Strategy shows a Paper reconciliation row, read from the serving Live control's existing
  `GET /api/live/candidates/<strategy>/<revision>/paper/<SYMBOLS>` (no new field): checking while it compares this
  source's Paper runs with their replay, the matching run once one reconciles, or None with the control's reasons.
  Check account and Start wait for it, as preparation would otherwise refuse `LIVE_PAPER_UNRECONCILED`, and the
  account check's line says it is waiting for the Paper reconciliation.
