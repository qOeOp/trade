# Policy Registry Contract

Owns `policy_registry`, the durable policy snapshot and approved strategy reference store.

## Responsibilities

- Create and migrate `data/policy_registry.db`.
- Append immutable runtime policy snapshots keyed by `policy_hash`.
- Upsert approved strategy refs keyed by `strategy_ref`.
- Expose status-filtered approved strategy refs for live planning and execution gates.
- Accept pure compiler output, persist the immutable policy snapshot, and issue a short-lived `trade.policy.runtime-authorization.v1` bound to policy hash, profile, `account_ref`, and `account_scope`.

## Boundaries

- Does not compile trading config.
- Does not promote strategies.
- Does not write `trade.db`.
- Does not call exchange APIs.
- Does not compile trading config or infer account scope; invalid or missing bindings fail closed.
