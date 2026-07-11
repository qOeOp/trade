# research/calibration-suite

## Type

atomic module

## Owns

- One calibration suite run.
- Stable script response envelope for calibration output.

## Inputs

- Calibration JSON payload with panel datasets.
- Optional previous calibration report path.

## Outputs

- `strategy-calibration-result`.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not run R&D search, review, promotion, or benchmark-only CLI work.
- Uses `research/benchmark-engine` for calibration semantics.
