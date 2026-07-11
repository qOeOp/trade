# Policy Registry Contract

Owns `policy_registry`, the durable policy snapshot and approved strategy reference store.

## Responsibilities

- Create and migrate `data/policy_registry.db`.
- Append immutable runtime policy snapshots keyed by `policy_hash`.
- Upsert approved strategy refs keyed by `strategy_ref`.
- Expose status-filtered approved strategy refs for live planning and execution gates.

## Boundaries

- Does not compile trading config.
- Does not promote strategies.
- Does not write `trade.db`.
- Does not call exchange APIs.

