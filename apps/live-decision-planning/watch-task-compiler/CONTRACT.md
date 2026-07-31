# Watch Task Compiler Contract

## Responsibility

- Compile one matching `trade-plan-draft.v1` and proposed `action-intent-ref.v1` into the fixed bounded Watch Task definition.
- Require plan ref lineage, exact content hash, symbol/side identity, canonical UTC expiry, and bounded observation policy.

## Boundaries

- A proposed action intent is planning material, not risk, preflight, execution, or exchange authorization.
- Does not persist or run the task, read market/account facts, call LLM, or write trade events.
- Does not accept a general condition DSL or an arbitrary owner command.
