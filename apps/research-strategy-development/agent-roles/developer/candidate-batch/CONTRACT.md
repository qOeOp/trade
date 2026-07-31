# research/candidate-batch

## Type

atomic module

## Owns

- One bounded single-dataset or panel candidate batch evaluation.
- Candidate negative controls, statistical report, reliability gate, and failure summary response envelope.

## Inputs

- OHLCV manifest path.
- Panel mode accepts at least three datasets plus optional marketability gates.
- Optional indicator / feature report path.
- One to ten candidate definitions.
- Cost, funding, OOS, factor discovery, and diagnostic options.

## Outputs

- `strategy-rnd-batch-result`.
- `strategy-panel-rnd-result` when invoked with `--panel`.

## Boundaries

- Read-only calculation; no artifact write, catalog write, `trade.db` write, RD memory write, promotion, review, or exchange access.
- Uses `research-strategy-development/candidate-batch-engine` for pure evaluation logic.
- Does not own R&D loop artifacts, campaign orchestration, Review authority, or supervisor state transitions.
