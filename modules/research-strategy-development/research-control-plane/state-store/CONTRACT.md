# Research State Store Contract

Owns `research_state_store`, including the durable R&D program memory and the Research Control Plane facts.

## Responsibilities

- Create and migrate `data/rd_state.db`.
- Upsert current RD program state.
- Upsert hypothesis queue/status rows.
- Append trial and locked holdout-use ledger rows.
- Append lessons learned by kind.
- Own Strategy Universe, scope, coverage, and capability registry projections.
- Register immutable, create-or-identical Instrument Status Provider Certification v1 snapshots. Each certification binds a Market Data provider capability/build/normalization tuple to one certifier policy and half-open validity window; update/delete and same-identity content drift are rejected.
- Register immutable, create-or-identical Provider Certification Termination v1 facts. `recorded_at <= effective_at` forbids backdated revocation; one certification has at most one terminal fact. Supersession requires a separately registered, same-provider successor that is admitted at cutover; revocation has no successor. Neither operation updates Certification v1.
- Register a separate immutable Aggregate Trade Provider Certification v1 and non-retroactive Termination v1 lifecycle. Certification binds the actual Market Data capability/build/policy and only permits Archive v1 → Replay Event/Attestation with `external_completeness=not_verified`; status-provider certification cannot substitute for it.
- Issue one create-or-identical Aggregate Trade Evidence Admission v1 per Trial Reservation hash while the Trial remains reserved, the Reservation window is open and the provider certification is admitted. The sidecar binds archive/source-receipt/audit/evidence/attestation hashes and is permanently scoped to pre-integration exact-price-path evidence; it does not mutate Reservation v9, authorize an Attempt, or enter Runner input.
- Issue one create-or-identical Cross-source Ordering Admission v1 for the same Reservation and Aggregate Trade Evidence Admission. Issuance validates the Replay-owned Ordering Attestation、canonical four-source set、aggregate coverage window/events hash、Dataset/status Reservation bindings、active provider certification and reserved Trial state. It persists source/ordered-event/ambiguity/limitation hashes without event payload、execution authority or mutable latest pointer.
- Issue one create-or-identical Decision Observation Bundle Admission v1 per Reservation. Issuance revalidates Request v30、Reservation v9、the registered Ordering Admission、Wire v2、the complete frozen Schedule binding set and portable Bundle while the Trial remains reserved and the Reservation window is open. It persists hashes and a non-economic audit capability only; parent validation is deliberately limited to Wire identity plus Schedule binding, Projection derivation remains uncertified, and no Harness/Runner/economic consumer reads this receipt.
- Issue one create-or-identical Decision Observation Bundle Derivation Admission v1 per Reservation after Bundle Admission. Issuance requires the same authoritative reserved Trial and open Reservation, validates the Replay-owned Attestation schema/self-hash, and aligns its Wire、Schedule、Bundle、Binding Set and every boundary hash with the prior admitted Bundle. The store does not import Replay Engine or claim parent replay; the receipt records `control_plane_parent_replay=not_performed` and grants no Harness/Runner/economic authority.
- Atomically materialize immutable Trial Reservation Snapshot v8 from the reserved Trial, Trial Group, Candidate membership and Experiment Contract v3 join; issuance is refused after the Trial leaves `reserved`, requires one registered provider certification admitted at `issued_at`, and freezes the Request v24 risk/spec/status/provenance/provider-certification, supplemental-facts and Contract-derived Requirement Set hashes. Effective admission is `[certified_at, min(valid_until, termination.effective_at))`. A termination never rewrites or implicitly cancels a Reservation issued before cutover; caller-provided requirement downgrade is rejected.
- Own immutable Reservation Cancellation v1 receipts. A cancellation binds the full Reservation hash and authoritative Trial/run, is non-retroactive, and permanently rejects new claims at `effective_at`; delivery of an already active claim remains idempotent and the active Attempt is not implicitly stopped.
- Own immutable Attempt Cancellation v1 receipts. Cancellation must match the active Attempt identity and current lease generation, is committed atomically with terminal `cancelled` state, and makes later renew/finalize/checkpoint authority stale. Attempt-only cancellation permits a later retry unless the Reservation is separately cancelled.
- Expose a read-only Attempt Cancellation directive for an exact still-unexpired worker lease, and register one immutable Attempt Cancellation Observation v1 after Runner returns the hash-bound cancelled Run Outcome. Observation is create-or-identical, enforces `cancellation.recorded_at <= observed_at <= registered_at`, and grants no checkpoint/resume authority; polling cadence、cross-process transport and bounded stop latency remain coordinator responsibilities.
- Expose a structural SQLite coordination-port adapter without importing Replay Runner. The adapter composes the existing directive/observation authorities; repeating the same Observation through the port is idempotent and preserves the first successful `registered_at`, while competing content remains rejected. It derives `authority_to_observation_ms`、`observation_to_registration_ms`、`authority_to_registration_ms` from immutable timestamps; these are measurements, not an SLA、durable outbox or transport retry policy.
- Inspect recovery against the authoritative cancellation/Observation registries as `pending` or `already_registered`, then accept pending redelivery through the same create-or-identical Observation registry. Control Plane does not discover、read、mutate or garbage-collect Runner outboxes and does not treat their commit as Result、Checkpoint or Resume authority.
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
- Execution boundary: `reserve_trial`, `cancel_replay_reservation`, `cancel_replay_attempt`, `observe_replay_attempt_cancellation`, `finish_trial`, `append_result`.
- Review/memory: `apply_reviewer_decision`, `append_lesson`.
- Lifecycle: `apply_system_transition`, `open_blocker`, `close_blocker`, `check_lifecycle_projection`, `rebuild_lifecycle_projection`.

The canonical module path is `modules/research-strategy-development/research-control-plane/state-store`. Both `research/research-state-store` and the old domain-root path are migration-only compatibility links.
