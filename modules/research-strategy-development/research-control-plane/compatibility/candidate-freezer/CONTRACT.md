# research.candidate-freezer

## Responsibility

Freeze a validated research candidate as a stable protocol ref with explicit evidence, assumptions, limits, timestamp, and content hash.

## Inputs

- Candidate identity and strategy id.
- Source evidence refs from replay, panel, holdout, calibration, or shadow review artifacts.
- Optional assumption refs and limit refs.
- Explicit freeze timestamp, promotion status, and content hash.

## Outputs

- `trade.protocol.frozen-candidate-ref.v1`

## Boundaries

- Does not run search, replay, or signal evaluation.
- Does not approve live trading or write policy.
- Does not write `trade.db`.
- Does not call exchange APIs.
- Produces refs only; durable storage remains owned by `research.state-store` or artifact catalog owners.
