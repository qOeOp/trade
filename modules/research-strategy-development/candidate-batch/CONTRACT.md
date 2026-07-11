# research/candidate-batch

## Type

atomic module

## Owns

- One bounded candidate batch evaluation.
- Candidate negative controls, statistical report, reliability gate, and failure summary response envelope.

## Inputs

- OHLCV manifest path.
- Optional indicator / feature report path.
- One to ten candidate definitions.
- Cost, funding, OOS, factor discovery, and diagnostic options.

## Outputs

- `strategy-rnd-batch-result`.

## Boundaries

- Read-only calculation; no artifact write, catalog write, `trade.db` write, RD memory write, promotion, review, or exchange access.
- Uses `research-strategy-development/candidate-batch-engine` for pure evaluation logic.
- Does not own R&D loop artifacts, campaign orchestration, panel aggregation, or supervisor state transitions.
