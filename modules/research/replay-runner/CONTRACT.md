# research/replay-runner

## Type

atomic module

## Owns

- One registered strategy replay run.
- CLI argument parsing for replay input.
- Stable script response envelope for replay output.

## Inputs

- Local OHLCV manifest.
- Strategy id.
- Replay cost, hold, split, and anti-overfit parameters.

## Outputs

- `ReplayResult`.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not run R&D search, panel evaluation, benchmark, or promotion.
- Uses `research/replay-engine` for replay semantics.
- Uses `contracts/replay-contract` for the stable output shell.
