# research/calibration-suite

## Type

atomic module

## Owns

- One calibration suite run or one fixed trend benchmark mode.
- Stable script response envelopes for calibration and benchmark output.

## Inputs

- Calibration / benchmark JSON payload with panel datasets.
- Optional previous calibration report path.

## Outputs

- `strategy-calibration-result`.
- `strategy-benchmark-result` when invoked with `--benchmark`.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not run R&D search, review, or promotion.
- Uses `replay-execution-plane/benchmark` for deterministic benchmark / calibration calculations.
