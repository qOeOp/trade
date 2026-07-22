# research/rd-autonomy-cycle

## Type

atomic orchestration module

## Owns

- One bounded J04 wakeup that first reads `plan_next`, replenishes an empty/unready queue through a model task only when the program remains active and budgeted, atomically queues one validated ready proposal, then delegates to `research.rd-supervisor`.
- Deterministic task/idempotency identity derived from the program plan and cycle.

## Boundaries

- Calls only fixed program-state, hypothesis-designer, model-gateway, and RD-supervisor owner CLIs; it exposes no arbitrary command or provider configuration.
- A stopped or already-ready plan never calls the model. Provider/schema/unready failure never writes state or runs a Trial.
- Queue persistence uses Control Plane `queue_proposal` CAS; duplicate identical proposals are idempotent and stale/conflicting writers fail closed.
- Does not review, promote, write `trade.db`, call exchange APIs, open locked holdout, or grant execution authority.
