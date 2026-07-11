# research/benchmark-runner

## Type

atomic module

## Owns

- One fixed benchmark run.
- Stable script response envelope for benchmark output.

## Inputs

- Benchmark JSON payload with at least three datasets.

## Outputs

- `strategy-benchmark-result`.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not run R&D search, calibration suites, review, or promotion.
- Uses `research/benchmark-engine` for benchmark semantics.
