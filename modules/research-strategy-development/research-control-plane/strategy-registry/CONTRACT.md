# Strategy Registry

Owns deterministic, authorized Draft Strategy materialization and registration inside `research_state_store`.

## Responsibilities

- Accept only a validated `accept_for_draft` authorization bound to one selected Trial, Candidate, and primary Result.
- Render structured policy source through the deterministic policy renderer.
- Reconcile accepted decisions through a durable, fenced, bounded-retry queue.
- Lint, hash, create-if-absent write, fsync, and register the Draft Strategy source; a crash between file and DB commits must recover only the identical bytes.
- Make idempotent retries return the same ready binding.
- Prevent Forward admission until `strategy_ref` and `strategy_policy_hash` are ready.

## Boundaries

- Does not select the Candidate, interpret Replay metrics, or promote beyond `draft`.
- The resident profile writes only to the durable release-candidate root; it never mutates the running image's `strategies/`.
- Does not adopt candidate source into Git, build a new image, deploy, promote, or trade. Those remain explicit release, deployment, governance, and execution authorities.
