# research/candidate-batch-engine

## Type

internal engine

## Owns

- Bounded candidate batch evaluation.
- Candidate negative controls, OOS/statistical report, reliability gate, and failure summary.
- Candidate input normalization shared by R&D loop, campaign, and panel tooling.

## Inputs

- OHLCV manifest path.
- Optional indicator/feature report path.
- One to ten predeclared candidate definitions.
- Cost, funding, OOS, factor discovery, and diagnostic options.

## Outputs

- In-memory `strategy-rnd-batch-result` shaped object.
- Candidate report objects consumed by panel, loop, campaign, and ledger layers.

## Boundaries

- No CLI, package, catalog write, artifact write, `trade.db` write, or exchange access.
- Does not own R&D loop artifacts, durable RD memory, campaign orchestration, panel aggregation, review, promotion, or execution.
- Uses `research/replay-engine` and `research/strategy-family-engine`; replay/family formulas are not duplicated.
