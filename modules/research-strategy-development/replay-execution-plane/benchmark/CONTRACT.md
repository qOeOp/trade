# Replay Benchmark

## Type

canonical internal engine

## Owns

- Benchmark input parsing.
- Panel alignment, data diagnostics, data hashes, and funding coverage.
- Portfolio simulation, cost model, negative controls, regime attribution.
- Calibration report assembly and comparison helpers.

## Inputs

- Local OHLCV manifests.
- Optional indicator reports with funding events.
- Fixed benchmark / calibration parameters.

## Outputs

- Benchmark reports.
- Calibration suite reports.
- Data panel diagnostics.

## Boundaries

- Does not expose an agent-facing CLI.
- Does not write files, catalog, `trade.db`, or exchange state.
- Does not run R&D search or promote strategies.
- Does not own Review decisions or certification policy; `certification/calibration-suite` owns the agent-facing certification surface.
