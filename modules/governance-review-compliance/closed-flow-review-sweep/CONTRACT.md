# Closed Flow Review Sweep Contract

Owns J07 `closed_flow_review_sweep`, the serial closeout scanner for review candidates.

## Responsibilities

- Read trade event chains through portfolio-execution-state owner tools.
- Detect closed, unreviewed flow candidates.
- Record the sweep as a governance review batch.
- Return candidate refs for downstream strategy-review or human/agent review.
- Return a native domain-runtime job result with `governance_ledger` write surface.

## Boundaries

- Does not write `trade.db`.
- Does not import portfolio-execution-state internals in production code.
- Does not generate subjective trade attribution.
- Does not promote strategies.
- Does not call exchange APIs.
