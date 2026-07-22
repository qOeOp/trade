# Watch Task Runtime Contract

## Responsibility

- Resume one persisted bounded Watch Task under a fenced ops lease.
- Poll the fixed public symbol-snapshot owner only when the task is due.
- Apply deterministic contract evaluations with compare-and-set state and stop at trigger or a conservative terminal state.

## Boundaries

- Trigger output is an `action_intent_revalidation` proposal with `execution_authority=none`.
- Does not call preflight, execution gate, exchange write, event store, LLM, or strategy planning.
- Does not accept arbitrary commands, predicates, provider endpoints, or environment pass-through.
- Lease loss stops the local loop; it does not fabricate a terminal task result.
