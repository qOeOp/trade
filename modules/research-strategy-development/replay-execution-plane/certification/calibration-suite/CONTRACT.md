# Replay Calibration Certification

## Type

canonical certification surface

## Owns

- One calibration suite run or one fixed trend benchmark mode.
- Runtime computation over caller-supplied panel manifests; results are not static certification fixtures.
- Stable script response envelopes for calibration and benchmark output.

## Inputs

- Calibration / benchmark JSON payload with panel datasets.
- Optional previous calibration report path.

## Outputs

- `strategy-calibration-result`.
- `strategy-benchmark-result` when invoked with `--benchmark`.
- `research.benchmark-runner` remains a compatibility tool ID for benchmark mode; it is not a second owner.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not run R&D search, review, or promotion.
- Uses `replay-execution-plane/benchmark` for deterministic benchmark / calibration calculations.
- Test fixtures certify this surface but do not replace its runtime CLI or become calibration authority.
