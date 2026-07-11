# research/rd-program-state

## Type

atomic module

## Owns

- Durable R&D learning memory state.
- `init`, `read`, `update`, and `plan_next` state commands.
- State artifact catalog registration.

## Inputs

- `--state` path.
- JSON command payload with `action`.
- Optional catalog DB path.

## Outputs

- `rd-program-state-result`.

## Boundaries

- May write only the explicit RD state JSON and catalog artifact reference.
- Does not write `trade.db`, call exchange APIs, run R&D trials, run panel evaluation, review, promote, or execute.
- `plan_next` is read-only planning output; it does not execute research.
