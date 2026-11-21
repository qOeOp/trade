- Breaking (Paper and Live market evidence, delegated decision): Paper's journal and Live's evidence pack record
  their market data in one format (`engine.realtime.MarketRows`), and `paper compare` and `live compare` read it with
  one `replay.comparison.run_record`. Live's `evidence/market.jsonl` no longer holds `historical_bar` and
  `historical_funding` rows: it holds one `warmup` digest per contract and period, as Paper journals it. Its `bar`
  rows are the one-minute bars only, without `bar_type`. Neither side writes `fetched_ns` any more, and Live's
  journal `warmup` event keeps only `at_ns`. `live compare` does not read a Live run recorded before this version.
  Field review: the Live evidence pack rows of `docs/plans/stored-fields.zh.md`.
