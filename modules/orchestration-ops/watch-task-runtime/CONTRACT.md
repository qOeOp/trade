# Watch Task Runtime Contract

## Responsibility

- Resume one persisted bounded Watch Task under a fenced ops lease.
- Poll the fixed public symbol-snapshot owner only when the task is due.
- Apply deterministic contract evaluations with compare-and-set state and stop at trigger or a conservative terminal state.
- Under the same fenced task lease, hand a triggered proposal to the fixed revalidation owner and persist only its no-authority receipt/outcome before completing the audit lifecycle.

## Boundaries

- Trigger output is an `action_intent_revalidation` proposal with `execution_authority=none`.
- Does not implement preflight or execution gate; the fixed revalidation owner owns those calls.
- Does not call execution-router, exchange write, event store, LLM, or strategy planning.
- Does not accept arbitrary commands, predicates, provider endpoints, or environment pass-through.
- Lease loss stops the local loop; it does not fabricate a terminal task result.
