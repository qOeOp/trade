# research/candidate-batch-engine

## Type

internal engine

## Owns

- Bounded candidate batch evaluation.
- Candidate negative controls, OOS/statistical report, reliability gate, and failure summary.
- Multi-asset aggregation, cross-candidate/rank-shift negative controls, and marketability gates.
- Candidate input normalization shared by R&D loop, campaign, and panel tooling.
- Purged chronological training-target selection for setup-conditioned factor discovery.
- Full-series versus cutoff-recomputed decision-integrity evidence and its fail-closed gate blocker.

## Inputs

- OHLCV manifest path.
- Optional indicator/feature report path.
- One to ten predeclared candidate definitions.
- Cost, funding, OOS, factor discovery, and diagnostic options.

## Outputs

- In-memory `strategy-rnd-batch-result` shaped object.
- In-memory `strategy-panel-rnd-result` shaped object.
- Candidate report objects consumed by panel, loop, campaign, and ledger layers.

## Boundaries

- No CLI, package, catalog write, artifact write, `trade.db` write, or exchange access.
- Does not own R&D loop artifacts, durable RD memory, campaign orchestration, Review authority, promotion, or execution.
- Uses `research-strategy-development/replay-engine` and `research-strategy-development/strategy-family-engine`; replay/family formulas are not duplicated.
- Factor discovery is forbidden on external-validation and locked-holdout stages; factor labels overlapping the OOS boundary are purged.
