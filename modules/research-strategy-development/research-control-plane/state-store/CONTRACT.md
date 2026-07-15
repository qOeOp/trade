# Research State Store Contract

Owns `research_state_store`, including the durable R&D program memory and the Research Control Plane facts.

## Responsibilities

- Create and migrate `data/rd_state.db`.
- Upsert current RD program state.
- Upsert hypothesis queue/status rows.
- Append trial and locked holdout-use ledger rows.
- Append lessons learned by kind.
- Own Strategy Universe, scope, coverage, and capability registry projections.
- Atomically materialize immutable Trial Reservation Snapshot v4 from the reserved Trial, Trial Group, Candidate membership and Experiment Contract join; issuance is refused after the Trial leaves `reserved`, Control Plane supplies an RFC 3339 UTC half-open claim window `[issued_at, expires_at)`, and Reservation bindings freeze the Request v12 venue-risk/instrument-spec schedule hashes plus supplemental-facts hash.
- Own Replay Attempt claim/renew/expire/finalize state: a new claim must fall inside its Reservation window; one active Attempt per Trial, monotonic lease generation fencing, immutable terminal rows, and completed-only Result/Artifact/checkpoint completeness fields. Reservation expiry does not revoke an already admitted Attempt; its lease remains the execution authority. Replay workers consume lease snapshots but never write this table directly.
- Own append-only Replay Checkpoint Receipt v2 registration. A receipt is accepted only inside the exact active Attempt lease generation, binds the immutable versioned diagnostic commit/payload hashes plus certified storage-policy version, and advances `next_source_offset` monotonically. Repeating an already committed receipt is idempotent even after Attempt expiry; new evidence from a stale or terminal lease is rejected. Migrated v1 rows are marked `rd-replay-local-rename-no-fsync-v0` and cannot authorize a v2 resume.
- Own immutable Replay Resume Authorization Snapshot v1 issuance. Authorization may bind only the latest registered Checkpoint Receipt on a `cancelled`/`expired` source Attempt to one later active target Attempt under the same Trial/run/request/reservation authority; target Attempt is unique, lease generation is a floor, and workers cannot mint or mutate this authority.
- Seed the frozen default Universe, Data Surface Registry, capability index, and current coverage map.
- Serve the authoritative Planner context from those facts and scoped KG lessons.
- Append validated Proposal Revisions and materialize each Proposal at most once.
- Register immutable Trial Groups, Candidates, and Experiment Contracts.
- Write the bootstrap lifecycle event in the same transaction as Experiment registration.
- Atomically append Reviewer Decision, evidence links, lifecycle event, and optimistic-concurrency projection updates.
- Enforce Trial, Result, Decision, lifecycle, candidate-freeze, and KG evidence invariants in SQLite.
- Calculate and verify versioned canonical identity hashes for Proposal, Contract, Candidate, and Trial Group identity.
- Project Experiment, Trial, Result, Decision, and Lesson relations into the minimal KG in owner transactions.
- Rebuild lifecycle projection from append-only event history and verify integrity.

The legacy program-learning trial ledger is `rd_program_trial`. `rd_trial` is reserved for the Control Plane Experiment Trial fact.

## Boundaries

- Does not run experiments or replay.
- Does not promote strategies.
- Does not write `trade.db`.
- Does not call exchange APIs.

## Owner commands

- Seed/query: `seed_default_control_plane`, `seed_universe`, `upsert_data_surface`, `link_universe_data_surface`, `upsert_pipeline_registry_item`, `upsert_universe_coverage`, `read_planning_context`.
- Proposal/experiment: `append_proposal_revision`, `materialize_proposal`, `register_trial_group`, `register_experiment`.
- Execution boundary: `reserve_trial`, `finish_trial`, `append_result`.
- Review/memory: `apply_reviewer_decision`, `append_lesson`.
- Lifecycle: `apply_system_transition`, `open_blocker`, `close_blocker`, `check_lifecycle_projection`, `rebuild_lifecycle_projection`.

The canonical module path is `modules/research-strategy-development/research-control-plane/state-store`. Both `research/research-state-store` and the old domain-root path are migration-only compatibility links.
