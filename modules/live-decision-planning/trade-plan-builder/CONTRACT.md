# decision.trade-plan-builder

## Responsibility

Build a trade-plan draft from an assembled decision input, including entry, stop, invalidation, trigger, size budget, and expiry refs.

## Inputs

- `decision_input_ref`
- `plan_ref`
- Symbol, side, source refs, and optional numeric plan fields.

## Outputs

- `trade-plan-draft.v1`

## Boundaries

- Does not publish executable intent.
- Does not call preflight, exchange, or event-store tools.
- Does not write `trade.db`.
- Produces a draft for the action intent publisher.
