# Watch Task Contract

## Owns

- One bounded `mark_price_in_range` watch definition derived from an already-approved action intent.
- Definition hashing, time/budget bounds, observation validation, invalidation-first evaluation, and typed handoff proposal.
- Monotonic lifecycle vocabulary shared by orchestration runtime and ops state owner.

## Forbidden

- General strategy/predicate DSL, thesis generation, or LLM judgment.
- Preflight approval, exchange command construction, order placement, or trade-event writes.
- Treating `triggered` as executed, filled, or economically authorized.
