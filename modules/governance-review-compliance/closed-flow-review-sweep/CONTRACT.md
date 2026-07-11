# Closed Flow Review Sweep Contract

Owns J08 `closed_flow_review_sweep`, the serial closeout scanner for review candidates.

## Responsibilities

- Read local trade event chains.
- Detect closed, unreviewed flow candidates.
- Record the sweep as a governance review batch.
- Return candidate refs for downstream strategy-review or human/agent review.

## Boundaries

- Does not write `trade.db`.
- Does not generate subjective trade attribution.
- Does not promote strategies.
- Does not call exchange APIs.

