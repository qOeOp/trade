# Strategy RD Contract

## Owns

- Transitional research core helpers that have not yet been split into atoms
- Forward holdout helpers

## Inputs

- OHLCV manifests and market feature artifacts
- Candidate JSON payloads
- Strategy markdown contracts consumed by R&D flows

## Outputs

- Library-level replay, factor, family, ledger, and helper results consumed by atomic research tools
- No direct CLI output

## Forbidden

- Exposing a user-facing tool entrypoint
- Writing `trade.db`
- Calling Binance write tools
- Deciding live execution
- Owning strategy promotion or post-trade review
- Owning R&D loop, R&D campaign, candidate batch evaluation, RD state init/read/update/plan_next, RD supervisor, single-strategy replay, latest signal, panel evaluation, data split, benchmark, calibration, funding governance, or strategy contract compile/lint CLIs
