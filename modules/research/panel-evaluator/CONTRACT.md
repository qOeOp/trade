# research/panel-evaluator

## Type

atomic module

## Owns

- Multi-asset panel candidate evaluation.
- Cross-candidate asset-shuffle and cross-sectional rank-shift negative controls.
- Marketability scoring/gating for panel universes.

## Inputs

- JSON payload with at least three datasets.
- One to ten candidate definitions.
- Optional marketability gate and cost/funding/OOS parameters.

## Outputs

- `strategy-panel-rnd-result`.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not own R&D loop artifacts, durable RD memory, campaign orchestration, review, promotion, or execution.
- Uses `research/candidate-batch-engine` for per-asset candidate evaluation.
