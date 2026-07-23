# decision.trade-plan-builder

## Responsibility

Build a trade-plan draft from an assembled decision input, including entry, stop, invalidation, trigger, size budget, and expiry refs.

## Inputs

- `decision_input_ref`
- `plan_ref`
- Symbol, side, source refs, and optional numeric plan fields.
- Optional account scope, strategy ref, risk budget, and expiry for a non-mutating capital allocation proposal.

## Outputs

- `trade-plan-draft.v1`
- Nested `capital-allocation-proposal.v1`; zero budget is `not_allocated`, never a reservation or balance mutation.

## Boundaries

- Does not publish executable intent.
- Does not call preflight, exchange, or event-store tools.
- Does not write `trade.db`.
- Produces a draft for the action intent publisher.
