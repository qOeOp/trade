# Strategy RD Contract

## Owns

- Strategy replay and latest-signal evaluation
- Bounded R&D batch / loop / campaign
- Multi-asset panel R&D
- Strategy data split and locked holdout helpers
- R&D program state, planner, and supervisor runner
- R&D family discovery and candidate generation
- Calibration / benchmark reports

## Inputs

- OHLCV manifests and market feature artifacts
- Candidate JSON payloads
- Strategy markdown contracts for compile / lint / signal
- R&D program state JSON
- Catalog DB path for research metadata

## Outputs

- R&D reports and ledgers
- Program state updates
- Gated draft strategy candidates
- Replay / benchmark / calibration reports
- Catalog metadata for generated research artifacts

## Forbidden

- Writing `trade.db`
- Calling Binance write tools
- Deciding live execution
- Owning strategy promotion or post-trade review
