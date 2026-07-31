# Slow Track Plan Contract

Owns slow-cadence live decision planning for watchlist generation.

## Responsibilities

- Load the compiled runtime policy and bounded runtime authorization through their owner tools.
- Read account snapshot and market scan through read-only tools.
- Submit one leased candidate demand containing L2 plus explicit 240-bar `1d/4h/1h` OHLCV and indicator requirements.
- Prefer owner-verified resident feature artifacts for candidate technical analysis; the temporary one-shot fetch/compute fallback is marked compatibility-only until server profile cutover.
- Assemble the explicit `DecisionInputBundle -> TradePlanDraft -> CapitalAllocationProposal -> ActionIntent` chain.
- Keep the capital proposal unallocated and publish a blocked `no_action` intent until a separate approval path exists.
- Write one analysis-only decision artifact; never execute exchange writes.

## Boundaries

- Does not submit, cancel, protect, or adjust orders.
- Does not write `trade.db`.
- Does not infer capital allocation, approval, or execution authority from a watchlist score.
- Does not run R&D experiments or promote strategies.
- Does not own market-data or indicator implementations.
