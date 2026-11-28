- `live compare` passes when Live took each minute's value (its `minute_result` rows' `observed_ns`), as `paper compare`
  does: an equity difference that is exactly the one price-precision marks make is now `mark_rounding`, not
  `unexplained`, and a Live minute's fills are cut at that time instead of the minute's end (#3660).
