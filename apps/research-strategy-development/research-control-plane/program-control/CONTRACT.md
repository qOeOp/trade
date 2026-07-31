# research/rd-program-state

## Type

atomic module

## Owns

- Durable R&D learning memory state.
- `init`, `read`, `update`, `plan_next`, and idempotent CAS `queue_proposal` state commands.
- `research_state_store.rd_program` persistence.
- Default Research Control Plane seed initialization and authoritative Planner-context reads.

## Inputs

- `--db` research state DB path.
- `--program-id` RD program identity.
- JSON command payload with `action`.
- Optional catalog DB path.

## Outputs

- `rd-program-state-result`.

## Boundaries

- May write the explicit `research_state_store.rd_program` row and install the versioned default Control Plane seed when the store is empty.
- Does not write `trade.db`, call exchange APIs, run R&D trials, run panel evaluation, review, promote, or execute.
- `plan_next` is read-only planning output; it does not execute research.
- `queue_proposal` accepts only `ready=true`, requires the exact prior `updated_at`, advances it atomically, and treats an identical hypothesis as an idempotent duplicate; it does not validate model output itself.
