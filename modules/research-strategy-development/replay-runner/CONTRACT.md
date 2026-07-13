# research/replay-runner

## Type

atomic module

## Owns

- One registered strategy replay run.
- CLI argument parsing for replay input.
- Stable script response envelope for replay output.
- Stable replay fingerprint owner surface.

## Inputs

- Local OHLCV manifest.
- Strategy id.
- Replay cost, hold, split, and anti-overfit parameters.

## Outputs

- `ReplayResult`.
- Replay fingerprint `{ harness_hash, data_hash?, assumptions_hash? }`.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not run R&D search, panel evaluation, benchmark, or promotion.
- Uses `research-strategy-development/replay-engine` for replay semantics.
- Uses `contracts/replay-contract` for the stable output shell.
