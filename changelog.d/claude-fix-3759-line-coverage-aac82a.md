- A line's coverage counts a month only when the tables its start's precheck required hold it too: metrics for
  `--metrics`, quotes for `--execution quotes`, aggregate trades for `--trade-ticks`. `line select` gives a
  `--metrics` or quote line its development period and veto reserve from where that data begins, and a pool line's
  coverage is its first universe month whose every member holds that data (before, the stored container arguments'
  resolved `--symbols` stood in for the pool). `line history`, `line close`, `research history` and
  `require_unfalsified` plan each participant's veto years only from its run's coverage start (its instruments'
  listing and the data it required), so years the engine would refuse (`METRICS_MISSING`, `QUOTES_MISSING`) or
  that precede a selected contract's listing are no longer replayed or counted missing (#3759).
