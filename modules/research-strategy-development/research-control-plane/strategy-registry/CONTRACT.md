# Strategy Registry

Owns deterministic, authorized Draft Strategy materialization and registration inside `research_state_store`.

## Responsibilities

- Accept only a validated `accept_for_draft` authorization bound to one selected Trial, Candidate, and primary Result.
- Render structured policy source through the deterministic policy renderer.
- Lint, hash, atomically write, and register the Draft Strategy source.
- Make idempotent retries return the same ready binding.
- Prevent Forward admission until `strategy_ref` and `strategy_policy_hash` are ready.

## Boundaries

- Does not select the Candidate, interpret Replay metrics, or promote beyond `draft`.
- Does not own project strategy files as module code; materialized sources remain under the caller-provided project strategy root.

