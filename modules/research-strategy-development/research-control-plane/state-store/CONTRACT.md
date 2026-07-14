# Research State Store Contract

Owns `research_state_store`, including the durable R&D program memory and the Research Control Plane facts.

## Responsibilities

- Create and migrate `data/rd_state.db`.
- Upsert current RD program state.
- Upsert hypothesis queue/status rows.
- Append trial and locked holdout-use ledger rows.
- Append lessons learned by kind.
- Own Strategy Universe, scope, coverage, and capability registry projections.
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
