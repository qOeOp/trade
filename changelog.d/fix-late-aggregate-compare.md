- Breaking: Paper's journal and Live's evidence pack record a `late_aggregate` row (`wall_ns`, `bar_type`,
  `ts_event`) for each aggregated time bar the source received more than 60 s after its bucket's end, also while
  Live's entry gate is closed; `paper compare` and `live compare` attribute a difference after one to the new cause
  `late_aggregate` (re-judge C-142, doctor 20261114-30). Comparison format `run-comparison@2026-11-21.1`: cached
  results of the older format are compared again. Live's `entries_closed` for a late aggregated bar records the bar's
  `received_ns` instead of `bucket_end_ns` and `late_ns`. Approved by the user on 2026-11-21 (「批准」).
