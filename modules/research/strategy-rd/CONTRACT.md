# Strategy RD Contract

## Owns

- Bounded R&D batch / loop / campaign
- Multi-asset panel R&D
- Forward holdout helpers
- R&D program state, planner, and supervisor runner
- Candidate generation and bounded factor research

## Inputs

- OHLCV manifests and market feature artifacts
- Candidate JSON payloads
- Strategy markdown contracts consumed by R&D flows
- R&D program state JSON
- Catalog DB path for research metadata

## Outputs

- R&D reports and ledgers
- Program state updates
- Gated draft strategy candidates
- Catalog metadata for generated research artifacts

## Forbidden

- Writing `trade.db`
- Calling Binance write tools
- Deciding live execution
- Owning strategy promotion or post-trade review
- Owning single-strategy replay, latest signal, data split, benchmark, calibration, funding governance, or strategy contract compile/lint CLIs
