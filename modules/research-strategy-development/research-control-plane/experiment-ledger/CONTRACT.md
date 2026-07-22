# research.rd-ledger

## Responsibility

Own R&D run ledger records, idempotence checks, locked-holdout keys, artifact-safe filenames, and small JSON artifact write helpers used by R&D loop and campaign runners.

## Inputs

- `StrategyRndLoopInput`
- Candidate batch summary view
- Explicit catalog DB path or ledger path

## Outputs

- Stable `StrategyRndLedgerRecord`
- Catalog `strategy_rnd_run` rows
- Deterministic holdout keys
- Redacted loop input snapshot for research artifacts

## Boundaries

- Does not run candidate evaluation.
- Does not orchestrate campaigns.
- Does not update RD program state.
- Does not write `trade.db`.
- Does not call exchange APIs.
- Uses `legacy-research-kernel` only for market-data and canonical hashes pending helper cutover.
