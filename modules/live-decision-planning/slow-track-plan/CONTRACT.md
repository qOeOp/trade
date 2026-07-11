# Slow Track Plan Contract

Owns slow-cadence live decision planning for watchlist generation.

## Responsibilities

- Load runtime policy and strategy pool.
- Read account snapshot and market scan through read-only tools.
- Build symbol snapshots and technical-analysis refs for candidates.
- Write an analysis-only watchlist artifact.
- Return `no_action`; never execute exchange writes.

## Boundaries

- Does not submit, cancel, protect, or adjust orders.
- Does not write `trade.db`.
- Does not run R&D experiments or promote strategies.
- Does not own market-data or indicator implementations.

