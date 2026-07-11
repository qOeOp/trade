# Strategy RD Contract

## Owns

- Bounded R&D batch / loop / campaign
- Forward holdout helpers
- R&D supervisor runner

## Inputs

- OHLCV manifests and market feature artifacts
- Candidate JSON payloads
- Strategy markdown contracts consumed by R&D flows
- R&D program state JSON consumed through explicit state paths
- Catalog DB path for research metadata

## Outputs

- R&D reports and ledgers
- Program state updates only through R&D loop / campaign writeback or supervisor orchestration
- Gated draft strategy candidates
- Catalog metadata for generated research artifacts

## Forbidden

- Writing `trade.db`
- Calling Binance write tools
- Deciding live execution
- Owning strategy promotion or post-trade review
- Owning RD state init/read/update/plan_next, single-strategy replay, latest signal, panel evaluation, data split, benchmark, calibration, funding governance, or strategy contract compile/lint CLIs
