//! Native PostgreSQL custody for the Market Data Owner.
//!
//! Both constructors and every writer remain crate-private. Downstream code can receive only the
//! public read-only resolver traits and sealed readbacks; it cannot choose a database, trusted
//! clock, canonical basis, or positive disposition.

#![allow(
    dead_code,
    reason = "private durable Owner composition is exercised by disposable PostgreSQL tests until product composition exists"
)]

use serde_json::Value;
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgPoolOptions};

use super::{
    pit_snapshot::{
        PitSnapshotCommitAggregate, PitSnapshotError, PitSnapshotOwnerReadback,
        PitSnapshotOwnerResolver, UntrustedPitSnapshotLocator, UntrustedPitSnapshotProposal,
        authority::{
            TestOnlyCanonicalBasisResolver, prepare_correction_aggregate,
            prepare_initial_aggregate, verify_aggregate as verify_pit_aggregate,
        },
    },
    shared_time_evidence::{
        ClockHeadFact, ClockHeadHandoff, ClockHeadSuccessorReadback, EpochSuccessorProof,
        SharedTimeEvidenceError, SharedTimeEvidenceResolver, UntrustedClockHeadLocator,
        build_epoch_successor_proof, build_head_fact, successor_readback,
        validate_new_epoch_successor, validate_same_epoch_successor, verify_epoch_successor_proof,
        verify_head_fact,
    },
    source_binding::{
        BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule, SourceBindingError,
        SourceBindingOwnerReadback, SourceBindingOwnerResolver, UntrustedSourceBindingLocator,
        UntrustedSourceBindingProposal,
        authority::{
            OwnerLineage as SourceOwnerLineage, OwnerSourceBindingDecision, SourceBindingCommit,
            SourceBindingStoredAggregate, build_stored_aggregate, derive_binding_id,
            validate_clock_for_readback, validate_proposal, validate_successor_advances,
            verify_stored_aggregate as verify_source_aggregate,
        },
    },
};

const MIGRATION_ID: &str = "market-data-owner-postgres-v1";
const SHARED_TIME_MIGRATION_ID: &str = "market-data-owner-shared-time-v1";

const MIGRATION_STATEMENTS: &[&str] = &[
    "CREATE SCHEMA IF NOT EXISTS market_data_private AUTHORIZATION CURRENT_USER",
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.owner_migrations_v1 (migration_id TEXT PRIMARY KEY, installed_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp())",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_head_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), clock_identity TEXT NOT NULL, clock_epoch TEXT NOT NULL, monotonic_sequence BIGINT NOT NULL CHECK (monotonic_sequence > 0), wall_observed BIGINT NOT NULL CHECK (wall_observed > 0), decision_cut BIGINT NOT NULL CHECK (decision_cut > 0), valid_through BIGINT NOT NULL, restart_continuity_digest BYTEA NOT NULL CHECK (octet_length(restart_continuity_digest) = 32), uncertainty_bound BIGINT NOT NULL CHECK (uncertainty_bound >= 0), skew_bound BIGINT NOT NULL CHECK (skew_bound > 0), comparison_rule SMALLINT NOT NULL CHECK (comparison_rule = 1), shared_time_materialized BOOLEAN NOT NULL DEFAULT FALSE, CHECK (uncertainty_bound <= skew_bound), CHECK (decision_cut <= wall_observed), CHECK (wall_observed < valid_through))",
    "ALTER TABLE market_data_private.clock_head_v1 ADD COLUMN IF NOT EXISTS shared_time_materialized BOOLEAN NOT NULL DEFAULT FALSE",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_handoffs_v1 (head_identity BYTEA PRIMARY KEY CHECK (octet_length(head_identity) = 32), head_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(head_digest) = 32), predecessor_head_digest BYTEA NULL UNIQUE REFERENCES market_data_private.clock_handoffs_v1(head_digest) CHECK (predecessor_head_digest IS NULL OR octet_length(predecessor_head_digest) = 32), clock_identity TEXT NOT NULL, clock_epoch TEXT NOT NULL, monotonic_sequence BIGINT NOT NULL CHECK (monotonic_sequence > 0), wall_observed BIGINT NOT NULL CHECK (wall_observed > 0), decision_cut BIGINT NOT NULL CHECK (decision_cut > 0), valid_through BIGINT NOT NULL, restart_continuity_digest BYTEA NOT NULL CHECK (octet_length(restart_continuity_digest) = 32), uncertainty_bound BIGINT NOT NULL CHECK (uncertainty_bound >= 0), skew_bound BIGINT NOT NULL CHECK (skew_bound > 0), comparison_rule SMALLINT NOT NULL CHECK (comparison_rule = 1), CHECK (uncertainty_bound <= skew_bound), CHECK (decision_cut <= wall_observed), CHECK (wall_observed < valid_through))",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_handoff_head_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), head_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.clock_handoffs_v1(head_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_handoff_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), materialized BOOLEAN NOT NULL, handoff_count BIGINT NOT NULL CHECK (handoff_count >= 0), epoch_transition_count BIGINT NOT NULL CHECK (epoch_transition_count >= 0), CHECK ((NOT materialized AND handoff_count = 0 AND epoch_transition_count = 0) OR (materialized AND handoff_count > 0 AND epoch_transition_count < handoff_count)))",
    "CREATE TABLE IF NOT EXISTS market_data_private.epoch_successor_proofs_v1 (proof_identity BYTEA PRIMARY KEY CHECK (octet_length(proof_identity) = 32), predecessor_head_digest BYTEA NOT NULL UNIQUE REFERENCES market_data_private.clock_handoffs_v1(head_digest), successor_head_digest BYTEA NOT NULL UNIQUE REFERENCES market_data_private.clock_handoffs_v1(head_digest), prior_clock_identity TEXT NOT NULL, prior_clock_epoch TEXT NOT NULL, successor_clock_identity TEXT NOT NULL, successor_clock_epoch TEXT NOT NULL, successor_continuity_digest BYTEA NOT NULL CHECK (octet_length(successor_continuity_digest) = 32), commit_cut BIGINT NOT NULL CHECK (commit_cut > 0), comparison_rule SMALLINT NOT NULL CHECK (comparison_rule = 1), CHECK (predecessor_head_digest <> successor_head_digest), CHECK (prior_clock_epoch <> successor_clock_epoch))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_facts_v1 (binding_id BYTEA PRIMARY KEY CHECK (octet_length(binding_id) = 32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_root BYTEA NOT NULL CHECK (octet_length(lineage_root) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0), aggregate_json JSONB NOT NULL, UNIQUE(lineage_root, lineage_version))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_heads_v1 (lineage_root BYTEA PRIMARY KEY CHECK (octet_length(lineage_root) = 32), binding_id BYTEA NOT NULL UNIQUE REFERENCES market_data_private.source_binding_facts_v1(binding_id), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_outbox_v1 (event_identity BYTEA PRIMARY KEY CHECK (octet_length(event_identity) = 32), aggregate_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.source_binding_facts_v1(binding_id), payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest) = 32), payload BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_facts_v1 (snapshot_identity BYTEA PRIMARY KEY CHECK (octet_length(snapshot_identity) = 32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), request_identity BYTEA NOT NULL CHECK (octet_length(request_identity) = 32), request_digest BYTEA NOT NULL CHECK (octet_length(request_digest) = 32), correction_stream_identity TEXT NOT NULL, correction_sequence BIGINT NOT NULL CHECK (correction_sequence > 0), lineage_root BYTEA NOT NULL CHECK (octet_length(lineage_root) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0), aggregate_json JSONB NOT NULL, UNIQUE(request_identity, correction_stream_identity, correction_sequence), UNIQUE(lineage_root, lineage_version))",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_heads_v1 (lineage_root BYTEA PRIMARY KEY CHECK (octet_length(lineage_root) = 32), snapshot_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_outbox_v1 (event_identity BYTEA PRIMARY KEY CHECK (octet_length(event_identity) = 32), aggregate_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity), payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest) = 32), payload BYTEA NOT NULL)",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_source_binding_v1(p_binding_id BYTEA) RETURNS TABLE(row_identity BYTEA, fact_digest BYTEA, request_identity BYTEA, request_digest BYTEA, correction_stream_identity TEXT, correction_sequence BIGINT, fact_lineage_root BYTEA, fact_lineage_version BIGINT, aggregate_json JSONB, outbox_event_identity BYTEA, outbox_aggregate_identity BYTEA, outbox_payload BYTEA, outbox_digest BYTEA, head_lineage_root BYTEA, head_identity BYTEA, head_digest BYTEA, head_version BIGINT, clock_identity TEXT, clock_epoch TEXT, monotonic_sequence BIGINT, wall_observed BIGINT, decision_cut BIGINT, valid_through BIGINT, restart_continuity_digest BYTEA, uncertainty_bound BIGINT, skew_bound BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT f.binding_id, f.fact_digest, NULL::BYTEA, NULL::BYTEA, NULL::TEXT, NULL::BIGINT, f.lineage_root, f.lineage_version, f.aggregate_json, o.event_identity, o.aggregate_identity, o.payload, o.payload_digest, h.lineage_root, h.binding_id, h.fact_digest, h.lineage_version, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BYTEA, NULL::BIGINT, NULL::BIGINT, NULL::SMALLINT FROM market_data_private.source_binding_facts_v1 AS f JOIN market_data_private.source_binding_outbox_v1 AS o ON o.aggregate_identity = f.binding_id JOIN market_data_private.source_binding_heads_v1 AS h ON h.lineage_root = f.lineage_root WHERE f.binding_id = p_binding_id $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_snapshot_v1(p_snapshot_identity BYTEA) RETURNS TABLE(row_identity BYTEA, fact_digest BYTEA, request_identity BYTEA, request_digest BYTEA, correction_stream_identity TEXT, correction_sequence BIGINT, fact_lineage_root BYTEA, fact_lineage_version BIGINT, aggregate_json JSONB, outbox_event_identity BYTEA, outbox_aggregate_identity BYTEA, outbox_payload BYTEA, outbox_digest BYTEA, head_lineage_root BYTEA, head_identity BYTEA, head_digest BYTEA, head_version BIGINT, clock_identity TEXT, clock_epoch TEXT, monotonic_sequence BIGINT, wall_observed BIGINT, decision_cut BIGINT, valid_through BIGINT, restart_continuity_digest BYTEA, uncertainty_bound BIGINT, skew_bound BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT f.snapshot_identity, f.fact_digest, f.request_identity, f.request_digest, f.correction_stream_identity, f.correction_sequence, f.lineage_root, f.lineage_version, f.aggregate_json, o.event_identity, o.aggregate_identity, o.payload, o.payload_digest, h.lineage_root, h.snapshot_identity, h.fact_digest, h.lineage_version, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BYTEA, NULL::BIGINT, NULL::BIGINT, NULL::SMALLINT FROM market_data_private.pit_snapshot_facts_v1 AS f JOIN market_data_private.pit_snapshot_outbox_v1 AS o ON o.aggregate_identity = f.snapshot_identity JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root = f.lineage_root WHERE f.snapshot_identity = p_snapshot_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_clock_handoff_v1(p_head_identity BYTEA) RETURNS TABLE(head_identity BYTEA, head_digest BYTEA, predecessor_head_digest BYTEA, clock_identity TEXT, clock_epoch TEXT, monotonic_sequence BIGINT, wall_observed BIGINT, decision_cut BIGINT, valid_through BIGINT, restart_continuity_digest BYTEA, uncertainty_bound BIGINT, skew_bound BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT h.head_identity,h.head_digest,h.predecessor_head_digest,h.clock_identity,h.clock_epoch,h.monotonic_sequence,h.wall_observed,h.decision_cut,h.valid_through,h.restart_continuity_digest,h.uncertainty_bound,h.skew_bound,h.comparison_rule FROM market_data_private.clock_handoffs_v1 AS h WHERE h.head_identity=p_head_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_epoch_successor_proof_v1(p_successor_head_digest BYTEA) RETURNS TABLE(proof_identity BYTEA, predecessor_head_digest BYTEA, successor_head_digest BYTEA, prior_clock_identity TEXT, prior_clock_epoch TEXT, successor_clock_identity TEXT, successor_clock_epoch TEXT, successor_continuity_digest BYTEA, commit_cut BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT p.proof_identity,p.predecessor_head_digest,p.successor_head_digest,p.prior_clock_identity,p.prior_clock_epoch,p.successor_clock_identity,p.successor_clock_epoch,p.successor_continuity_digest,p.commit_cut,p.comparison_rule FROM market_data_private.epoch_successor_proofs_v1 AS p WHERE p.successor_head_digest=p_successor_head_digest $function$",
    "REVOKE ALL ON ALL TABLES IN SCHEMA market_data_private FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_source_binding_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_snapshot_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_clock_handoff_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_epoch_successor_proof_v1(BYTEA) FROM PUBLIC",
];

pub(crate) struct MarketDataOwnerPostgres {
    pool: PgPool,
}

pub(crate) struct MarketDataReadPostgres {
    pool: PgPool,
}

impl MarketDataOwnerPostgres {
    pub(crate) async fn connect(database_url: &str) -> Result<Self, SourceBindingError> {
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let owner = Self { pool };
        owner.migrate().await?;
        Ok(owner)
    }

    async fn migrate(&self) -> Result<(), SourceBindingError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;

        for statement in MIGRATION_STATEMENTS {
            sqlx::query(*statement)
                .execute(&mut *transaction)
                .await
                .map_err(|_| SourceBindingError::StoreUnavailable)?;
        }
        let shared_time_installed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1)",
        )
        .bind(SHARED_TIME_MIGRATION_ID)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;

        if shared_time_installed {
            validate_clock_handoff_installation(&mut transaction).await?;
        } else {
            install_clock_handoff_state(&mut transaction).await?;
            sqlx::query(
                "INSERT INTO market_data_private.owner_migrations_v1(migration_id) VALUES ($1)",
            )
            .bind(SHARED_TIME_MIGRATION_ID)
            .execute(&mut *transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        }
        sqlx::query(
            "INSERT INTO market_data_private.owner_migrations_v1(migration_id) VALUES ($1) ON CONFLICT (migration_id) DO NOTHING",
        )
        .bind(MIGRATION_ID)
        .execute(&mut *transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)
    }

    #[cfg(test)]
    pub(crate) const fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub(crate) async fn commit_source_initial(
        &self,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        self.commit_source_initial_with_fault(proposal, decision, clock, PostgresCommitFault::None)
            .await
    }

    async fn commit_source_initial_with_fault(
        &self,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        validate_proposal(&proposal, clock)?;
        let binding_id = derive_binding_id(&proposal);
        let aggregate = build_stored_aggregate(
            proposal,
            decision,
            SourceOwnerLineage {
                root: binding_id,
                version: 1,
                predecessor_binding_id: None,
                predecessor_fact_digest: None,
            },
        );
        let mut transaction = self.transaction().await?;
        lock_digests(&mut transaction, binding_id, binding_id).await?;
        if let Some(stored) = load_source_for_update(&mut transaction, binding_id, false).await? {
            return exact_source_replay(&stored, &aggregate);
        }

        if source_head(&mut transaction, binding_id).await?.is_some() {
            return Err(SourceBindingError::ReplayConflict);
        }
        admit_clock(&mut transaction, clock).await?;
        insert_source(&mut transaction, &aggregate, fault).await?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        if fault == PostgresCommitFault::ResponseLoss {
            Err(SourceBindingError::ResponseLost)
        } else {
            Ok(aggregate.commit().clone())
        }
    }

    pub(crate) async fn commit_source_successor(
        &self,
        predecessor: &UntrustedSourceBindingLocator,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        Box::pin(self.commit_source_successor_with_fault(
            predecessor,
            proposal,
            decision,
            clock,
            PostgresCommitFault::None,
        ))
        .await
    }

    async fn commit_source_successor_with_fault(
        &self,
        predecessor: &UntrustedSourceBindingLocator,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        validate_proposal(&proposal, clock)?;
        let binding_id = derive_binding_id(&proposal);
        let mut transaction = self.transaction().await?;
        let initial_predecessor = load_source(&mut transaction, predecessor.binding_id, false)
            .await?
            .ok_or(SourceBindingError::LineageHeadMismatch)?;
        if initial_predecessor.commit().receipt().locator() != predecessor {
            return Err(SourceBindingError::LineageHeadMismatch);
        }
        let predecessor_fact = initial_predecessor.commit().fact();
        let lineage_root = predecessor_fact.lineage_root();
        lock_digests(&mut transaction, binding_id, lineage_root).await?;
        let locked_predecessor =
            load_source_for_update(&mut transaction, predecessor.binding_id, false)
                .await?
                .ok_or(SourceBindingError::LineageHeadMismatch)?;
        if locked_predecessor.commit().receipt().locator() != predecessor {
            return Err(SourceBindingError::LineageHeadMismatch);
        }
        let predecessor_fact = locked_predecessor.commit().fact();
        let lineage = SourceOwnerLineage {
            root: predecessor_fact.lineage_root(),
            version: predecessor_fact.lineage_version().checked_add(1).ok_or(
                SourceBindingError::InvalidVersionOrSequence("lineage_version"),
            )?,
            predecessor_binding_id: Some(predecessor_fact.binding_id()),
            predecessor_fact_digest: Some(predecessor_fact.digest()),
        };
        let aggregate = build_stored_aggregate(proposal, decision, lineage);
        if let Some(stored) = load_source_for_update(&mut transaction, binding_id, false).await? {
            return exact_source_replay(&stored, &aggregate);
        }
        let head = source_head_for_update(&mut transaction, lineage.root)
            .await?
            .ok_or(SourceBindingError::LineageHeadMismatch)?;
        if !head.matches_source(predecessor_fact) {
            return Err(SourceBindingError::LineageHeadMismatch);
        }
        validate_successor_advances(predecessor_fact, aggregate.commit().fact().proposal())?;
        admit_clock(&mut transaction, clock).await?;
        insert_source(&mut transaction, &aggregate, fault).await?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        if fault == PostgresCommitFault::ResponseLoss {
            Err(SourceBindingError::ResponseLost)
        } else {
            Ok(aggregate.commit().clone())
        }
    }

    async fn transaction(&self) -> Result<Transaction<'_, Postgres>, SourceBindingError> {
        self.pool
            .begin()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)
    }

    pub(crate) async fn commit_pit_initial(
        &self,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &TestOnlyCanonicalBasisResolver,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        self.commit_pit_initial_with_fault(
            proposal,
            canonical_basis,
            clock,
            PostgresCommitFault::None,
        )
        .await
    }

    async fn commit_pit_initial_with_fault(
        &self,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &TestOnlyCanonicalBasisResolver,
        clock: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let source = load_source_for_update(
            &mut transaction,
            proposal.request.source_binding.binding_id,
            false,
        )
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        if source.commit().receipt().locator() != &proposal.request.source_binding {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let aggregate =
            prepare_initial_aggregate(proposal, canonical_basis, source.commit().fact(), clock)?;
        persist_pit(transaction, aggregate, clock, fault).await
    }

    pub(crate) async fn commit_pit_correction(
        &self,
        predecessor: &UntrustedPitSnapshotLocator,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &TestOnlyCanonicalBasisResolver,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let prior = load_pit_for_update(&mut transaction, predecessor.snapshot_identity, false)
            .await?
            .ok_or(PitSnapshotError::CorrectionHeadMismatch)?;
        if prior.receipt().locator() != predecessor {
            return Err(PitSnapshotError::CorrectionHeadMismatch);
        }
        let source = load_source_for_update(
            &mut transaction,
            proposal.request.source_binding.binding_id,
            false,
        )
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        if source.commit().receipt().locator() != &proposal.request.source_binding {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let aggregate = prepare_correction_aggregate(
            prior.fact(),
            proposal,
            canonical_basis,
            source.commit().fact(),
            clock,
        )?;
        persist_pit(transaction, aggregate, clock, PostgresCommitFault::None).await
    }

    pub(crate) async fn commit_clock_successor(
        &self,
        prior: &ClockHeadHandoff,
        next: &MarketDataClockAdmission,
    ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
        self.commit_clock_successor_with_fault(prior, next, PostgresCommitFault::None)
            .await
    }

    async fn commit_clock_successor_with_fault(
        &self,
        prior: &ClockHeadHandoff,
        next: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
        let transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        persist_clock_successor(transaction, prior, next, fault).await
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PostgresCommitFault {
    None,
    AfterFactBeforeOutbox,
    AfterClockHeadBeforeEpochProof,
    ResponseLoss,
}

impl MarketDataReadPostgres {
    pub(crate) async fn connect(database_url: &str) -> Result<Self, SourceBindingError> {
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect(database_url)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        Ok(Self { pool })
    }
}

fn exact_source_replay(
    stored: &SourceBindingStoredAggregate,
    proposed: &SourceBindingStoredAggregate,
) -> Result<SourceBindingCommit, SourceBindingError> {
    if stored == proposed {
        Ok(stored.commit().clone())
    } else {
        Err(SourceBindingError::ReplayConflict)
    }
}

async fn lock_digests(
    transaction: &mut Transaction<'_, Postgres>,
    first: BindingDigest,
    second: BindingDigest,
) -> Result<(), SourceBindingError> {
    let mut keys = [advisory_key(first), advisory_key(second)];
    keys.sort_unstable();
    for key in keys {
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(key)
            .execute(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
    }
    Ok(())
}

fn advisory_key(digest: BindingDigest) -> i64 {
    i64::from_be_bytes(digest.as_bytes()[..8].try_into().expect("fixed digest"))
}

async fn load_source(
    transaction: &mut Transaction<'_, Postgres>,
    binding_id: BindingDigest,
    require_current_head: bool,
) -> Result<Option<SourceBindingStoredAggregate>, SourceBindingError> {
    let row = sqlx::query(
        "SELECT f.binding_id AS row_identity,f.fact_digest,NULL::BYTEA AS request_identity,NULL::BYTEA AS request_digest,NULL::TEXT AS correction_stream_identity,NULL::BIGINT AS correction_sequence,f.lineage_root AS fact_lineage_root,f.lineage_version AS fact_lineage_version,f.aggregate_json,o.event_identity AS outbox_event_identity,o.aggregate_identity AS outbox_aggregate_identity,o.payload AS outbox_payload,o.payload_digest AS outbox_digest,h.lineage_root AS head_lineage_root,h.binding_id AS head_identity,h.fact_digest AS head_digest,h.lineage_version AS head_version FROM market_data_private.source_binding_facts_v1 AS f JOIN market_data_private.source_binding_outbox_v1 AS o ON o.aggregate_identity=f.binding_id JOIN market_data_private.source_binding_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE f.binding_id=$1",
    )
    .bind(binding_id.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    row.map(|row| decode_source_row(&row, require_current_head))
        .transpose()
}

async fn load_source_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    binding_id: BindingDigest,
    require_current_head: bool,
) -> Result<Option<SourceBindingStoredAggregate>, SourceBindingError> {
    let row = sqlx::query(
        "SELECT f.binding_id AS row_identity,f.fact_digest,NULL::BYTEA AS request_identity,NULL::BYTEA AS request_digest,NULL::TEXT AS correction_stream_identity,NULL::BIGINT AS correction_sequence,f.lineage_root AS fact_lineage_root,f.lineage_version AS fact_lineage_version,f.aggregate_json,o.event_identity AS outbox_event_identity,o.aggregate_identity AS outbox_aggregate_identity,o.payload AS outbox_payload,o.payload_digest AS outbox_digest,h.lineage_root AS head_lineage_root,h.binding_id AS head_identity,h.fact_digest AS head_digest,h.lineage_version AS head_version FROM market_data_private.source_binding_facts_v1 AS f JOIN market_data_private.source_binding_outbox_v1 AS o ON o.aggregate_identity=f.binding_id JOIN market_data_private.source_binding_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE f.binding_id=$1 FOR UPDATE OF f,o,h",
    )
    .bind(binding_id.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    row.map(|row| decode_source_row(&row, require_current_head))
        .transpose()
}

fn decode_source_row(
    row: &sqlx::postgres::PgRow,
    require_current_head: bool,
) -> Result<SourceBindingStoredAggregate, SourceBindingError> {
    let value: Value = row
        .try_get("aggregate_json")
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
    let aggregate: SourceBindingStoredAggregate =
        serde_json::from_value(value).map_err(|_| SourceBindingError::StoreUnavailable)?;
    let native = decode_native_index(row).map_err(|_| SourceBindingError::StoreUnavailable)?;

    if !verify_source_native(&aggregate, &native, require_current_head) {
        return Err(SourceBindingError::StoreUnavailable);
    }
    Ok(aggregate)
}

async fn source_head(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<Option<BindingDigest>, SourceBindingError> {
    let value: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT binding_id FROM market_data_private.source_binding_heads_v1 WHERE lineage_root=$1",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    value
        .map(|value| digest_from_bytes(&value).map_err(|_| SourceBindingError::StoreUnavailable))
        .transpose()
}

async fn source_head_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<Option<NativeHead>, SourceBindingError> {
    let row = sqlx::query(
        "SELECT lineage_root,binding_id AS head_identity,fact_digest,lineage_version FROM market_data_private.source_binding_heads_v1 WHERE lineage_root=$1 FOR UPDATE",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    row.map(|row| decode_head(&row).map_err(|_| SourceBindingError::StoreUnavailable))
        .transpose()
}

async fn insert_source(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &SourceBindingStoredAggregate,
    fault: PostgresCommitFault,
) -> Result<(), SourceBindingError> {
    let fact = aggregate.commit().fact();
    let json = serde_json::to_value(aggregate).map_err(|_| SourceBindingError::StoreUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_facts_v1(binding_id,fact_digest,lineage_root,lineage_version,aggregate_json) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(fact.binding_id().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(to_i64(fact.lineage_version())?)
    .bind(json)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    if fault == PostgresCommitFault::AfterFactBeforeOutbox {
        return Err(SourceBindingError::CommitInterrupted);
    }
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_outbox_v1(event_identity,aggregate_identity,payload_digest,payload) VALUES ($1,$2,$3,$4)",
    )
    .bind(aggregate.outbox().digest().as_bytes().as_slice())
    .bind(fact.binding_id().as_bytes().as_slice())
    .bind(aggregate.outbox().digest().as_bytes().as_slice())
    .bind(aggregate.outbox().payload())
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_heads_v1(lineage_root,binding_id,fact_digest,lineage_version) VALUES ($1,$2,$3,$4) ON CONFLICT (lineage_root) DO UPDATE SET binding_id=EXCLUDED.binding_id,fact_digest=EXCLUDED.fact_digest,lineage_version=EXCLUDED.lineage_version",
    )
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(fact.binding_id().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(to_i64(fact.lineage_version())?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

fn to_i64(value: u64) -> Result<i64, SourceBindingError> {
    i64::try_from(value).map_err(|_| SourceBindingError::StoreUnavailable)
}

async fn admit_clock(
    transaction: &mut Transaction<'_, Postgres>,
    next: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    if !next.is_complete() {
        return Err(SourceBindingError::TrustedClockMismatch);
    }
    lock_clock_state(transaction).await?;
    let current = load_current_clock_for_update(transaction).await?;
    if let Some(current) = current {
        let current_fact = ensure_clock_handoff_state(transaction, &current).await?;
        if next == &current {
            return Ok(());
        }
        validate_same_epoch_successor(&current_fact, next)
            .map_err(|_| SourceBindingError::TrustedClockMismatch)?;
        let next_fact = build_head_fact(next, Some(current_fact.handoff.head_digest()))
            .map_err(|_| SourceBindingError::TrustedClockMismatch)?;
        insert_clock_handoff(transaction, &next_fact).await?;
        update_clock(transaction, next).await?;
        set_clock_handoff_head(transaction, next_fact.handoff.head_identity()).await?;
        advance_clock_handoff_state(transaction, false).await?;
    } else {
        let state = load_clock_handoff_state_for_update(transaction).await?;

        if state.materialized || state.handoff_count != 0 || state.epoch_transition_count != 0 {
            return Err(SourceBindingError::StoreUnavailable);
        }

        if !clock_handoff_history_is_empty(transaction).await? {
            return Err(SourceBindingError::StoreUnavailable);
        }
        let fact =
            build_head_fact(next, None).map_err(|_| SourceBindingError::TrustedClockMismatch)?;
        insert_clock_handoff(transaction, &fact).await?;
        insert_clock(transaction, next).await?;
        set_clock_handoff_head(transaction, fact.handoff.head_identity()).await?;
        materialize_initial_clock_handoff_state(transaction).await?;
    }
    Ok(())
}

async fn clock_handoff_history_is_empty(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<bool, SourceBindingError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1) + (SELECT COUNT(*) FROM market_data_private.clock_handoff_head_v1) + (SELECT COUNT(*) FROM market_data_private.epoch_successor_proofs_v1)",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(count == 0)
}

async fn persist_pit(
    mut transaction: Transaction<'_, Postgres>,
    aggregate: PitSnapshotCommitAggregate,
    clock: &MarketDataClockAdmission,
    fault: PostgresCommitFault,
) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
    let fact = aggregate.fact();
    lock_digests(
        &mut transaction,
        fact.snapshot_identity(),
        fact.lineage_root(),
    )
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    if let Some(stored) =
        load_pit_for_update(&mut transaction, fact.snapshot_identity(), false).await?
    {
        return if stored == aggregate {
            Ok(stored)
        } else {
            Err(PitSnapshotError::ReplayConflict)
        };
    }
    let source_head = source_head_for_update(&mut transaction, fact.source_binding_lineage_root())
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
    if !source_head.matches_source_locator(&fact.request().source_binding) {
        return Err(PitSnapshotError::SourceBindingUnavailable);
    }
    let head = pit_head_for_update(&mut transaction, fact.lineage_root()).await?;
    match (fact.lineage_version(), fact.predecessor_snapshot_identity()) {
        (1, None) if head.is_none() => {}
        (_, Some(predecessor))
            if head
                .as_ref()
                .is_some_and(|head| head.matches_pit_identity(predecessor, fact)) => {}
        _ => return Err(PitSnapshotError::CorrectionHeadMismatch),
    }
    admit_clock(&mut transaction, clock)
        .await
        .map_err(|_| PitSnapshotError::TrustedClockMismatch)?;
    insert_pit(&mut transaction, &aggregate, fault).await?;
    transaction
        .commit()
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    if fault == PostgresCommitFault::ResponseLoss {
        Err(PitSnapshotError::ResponseLost)
    } else {
        Ok(aggregate)
    }
}

async fn load_pit_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    snapshot_identity: BindingDigest,
    require_current_head: bool,
) -> Result<Option<PitSnapshotCommitAggregate>, PitSnapshotError> {
    let row = sqlx::query(
        "SELECT f.snapshot_identity AS row_identity,f.fact_digest,f.request_identity,f.request_digest,f.correction_stream_identity,f.correction_sequence,f.lineage_root AS fact_lineage_root,f.lineage_version AS fact_lineage_version,f.aggregate_json,o.event_identity AS outbox_event_identity,o.aggregate_identity AS outbox_aggregate_identity,o.payload AS outbox_payload,o.payload_digest AS outbox_digest,h.lineage_root AS head_lineage_root,h.snapshot_identity AS head_identity,h.fact_digest AS head_digest,h.lineage_version AS head_version FROM market_data_private.pit_snapshot_facts_v1 AS f JOIN market_data_private.pit_snapshot_outbox_v1 AS o ON o.aggregate_identity=f.snapshot_identity JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE f.snapshot_identity=$1 FOR UPDATE OF f,o,h",
    )
    .bind(snapshot_identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    row.map(|row| decode_pit_row(&row, require_current_head))
        .transpose()
}

fn decode_pit_row(
    row: &sqlx::postgres::PgRow,
    require_current_head: bool,
) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
    let value: Value = row
        .try_get("aggregate_json")
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let aggregate: PitSnapshotCommitAggregate =
        serde_json::from_value(value).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let native = decode_native_index(row).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    if !verify_pit_native(&aggregate, &native, require_current_head) {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    Ok(aggregate)
}

async fn pit_head_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<Option<NativeHead>, PitSnapshotError> {
    let row = sqlx::query(
        "SELECT lineage_root,snapshot_identity AS head_identity,fact_digest,lineage_version FROM market_data_private.pit_snapshot_heads_v1 WHERE lineage_root=$1 FOR UPDATE",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    row.map(|row| decode_head(&row).map_err(|_| PitSnapshotError::PersistenceUnavailable))
        .transpose()
}

async fn insert_pit(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
    fault: PostgresCommitFault,
) -> Result<(), PitSnapshotError> {
    let fact = aggregate.fact();
    let correction = &fact.evidence().correction_frontier;
    let json =
        serde_json::to_value(aggregate).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.pit_snapshot_facts_v1(snapshot_identity,fact_digest,request_identity,request_digest,correction_stream_identity,correction_sequence,lineage_root,lineage_version,aggregate_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(fact.request_identity().as_bytes().as_slice())
    .bind(fact.request_digest().as_bytes().as_slice())
    .bind(&correction.stream_identity)
    .bind(i64::try_from(correction.sequence).map_err(|_| PitSnapshotError::PersistenceUnavailable)?)
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(i64::try_from(fact.lineage_version()).map_err(|_| PitSnapshotError::PersistenceUnavailable)?)
    .bind(json)
    .execute(&mut **transaction)
    .await
    .map_err(|e| map_pit_insert_error(&e))?;
    if fault == PostgresCommitFault::AfterFactBeforeOutbox {
        return Err(PitSnapshotError::CommitInterrupted);
    }
    sqlx::query(
        "INSERT INTO market_data_private.pit_snapshot_outbox_v1(event_identity,aggregate_identity,payload_digest,payload) VALUES ($1,$2,$3,$4)",
    )
    .bind(aggregate.outbox().digest().as_bytes().as_slice())
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(aggregate.outbox().digest().as_bytes().as_slice())
    .bind(aggregate.outbox().payload())
    .execute(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.pit_snapshot_heads_v1(lineage_root,snapshot_identity,fact_digest,lineage_version) VALUES ($1,$2,$3,$4) ON CONFLICT (lineage_root) DO UPDATE SET snapshot_identity=EXCLUDED.snapshot_identity,fact_digest=EXCLUDED.fact_digest,lineage_version=EXCLUDED.lineage_version",
    )
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(i64::try_from(fact.lineage_version()).map_err(|_| PitSnapshotError::PersistenceUnavailable)?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    Ok(())
}

fn map_pit_insert_error(error: &sqlx::Error) -> PitSnapshotError {
    if error
        .as_database_error()
        .is_some_and(sqlx::error::DatabaseError::is_unique_violation)
    {
        PitSnapshotError::ReplayConflict
    } else {
        PitSnapshotError::PersistenceUnavailable
    }
}

async fn insert_clock(
    transaction: &mut Transaction<'_, Postgres>,
    clock: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.clock_head_v1(singleton,clock_identity,clock_epoch,monotonic_sequence,wall_observed,decision_cut,valid_through,restart_continuity_digest,uncertainty_bound,skew_bound,comparison_rule,shared_time_materialized) VALUES (TRUE,$1,$2,$3,$4,$5,$6,$7,$8,$9,1,TRUE)",
    )
    .bind(&clock.clock_identity)
    .bind(&clock.clock_epoch)
    .bind(to_i64(clock.monotonic_sequence)?)
    .bind(to_i64(clock.wall_observed)?)
    .bind(to_i64(clock.decision_cut)?)
    .bind(to_i64(clock.valid_through)?)
    .bind(clock.restart_continuity_digest.as_bytes().as_slice())
    .bind(to_i64(clock.uncertainty_bound)?)
    .bind(to_i64(clock.skew_bound)?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn update_clock(
    transaction: &mut Transaction<'_, Postgres>,
    clock: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "UPDATE market_data_private.clock_head_v1 SET clock_identity=$1,clock_epoch=$2,monotonic_sequence=$3,wall_observed=$4,decision_cut=$5,valid_through=$6,restart_continuity_digest=$7,uncertainty_bound=$8,skew_bound=$9,comparison_rule=1 WHERE singleton",
    )
    .bind(&clock.clock_identity)
    .bind(&clock.clock_epoch)
    .bind(to_i64(clock.monotonic_sequence)?)
    .bind(to_i64(clock.wall_observed)?)
    .bind(to_i64(clock.decision_cut)?)
    .bind(to_i64(clock.valid_through)?)
    .bind(clock.restart_continuity_digest.as_bytes().as_slice())
    .bind(to_i64(clock.uncertainty_bound)?)
    .bind(to_i64(clock.skew_bound)?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

const CLOCK_STATE_LOCK_KEY: i64 = 0x5649_4245_5449_4d45;

async fn lock_clock_state(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(CLOCK_STATE_LOCK_KEY)
        .execute(&mut **transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

#[derive(Clone, Copy)]
struct DurableClockHandoffState {
    materialized: bool,
    handoff_count: i64,
    epoch_transition_count: i64,
}

async fn load_current_clock_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<MarketDataClockAdmission>, SourceBindingError> {
    sqlx::query(
        "SELECT clock_identity,clock_epoch,monotonic_sequence,wall_observed,decision_cut,valid_through,restart_continuity_digest,uncertainty_bound,skew_bound,comparison_rule FROM market_data_private.clock_head_v1 WHERE singleton FOR UPDATE",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?
    .map(|row| decode_clock(&row).map_err(|_| SourceBindingError::StoreUnavailable))
    .transpose()
}

async fn load_clock_materialization_witness_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<bool>, SourceBindingError> {
    sqlx::query_scalar(
        "SELECT shared_time_materialized FROM market_data_private.clock_head_v1 WHERE singleton FOR UPDATE",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)
}

async fn load_clock_handoff_state_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<DurableClockHandoffState, SourceBindingError> {
    let row = sqlx::query(
        "SELECT materialized,handoff_count,epoch_transition_count FROM market_data_private.clock_handoff_state_v1 WHERE singleton FOR UPDATE",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?
    .ok_or(SourceBindingError::StoreUnavailable)?;
    Ok(DurableClockHandoffState {
        materialized: row
            .try_get("materialized")
            .map_err(|_| SourceBindingError::StoreUnavailable)?,
        handoff_count: row
            .try_get("handoff_count")
            .map_err(|_| SourceBindingError::StoreUnavailable)?,
        epoch_transition_count: row
            .try_get("epoch_transition_count")
            .map_err(|_| SourceBindingError::StoreUnavailable)?,
    })
}

async fn clock_handoff_storage_counts(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(i64, i64, i64), SourceBindingError> {
    sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1), (SELECT COUNT(*) FROM market_data_private.clock_handoff_head_v1), (SELECT COUNT(*) FROM market_data_private.epoch_successor_proofs_v1)",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)
}

async fn insert_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
    state: DurableClockHandoffState,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.clock_handoff_state_v1(singleton,materialized,handoff_count,epoch_transition_count) VALUES (TRUE,$1,$2,$3)",
    )
    .bind(state.materialized)
    .bind(state.handoff_count)
    .bind(state.epoch_transition_count)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn materialize_initial_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    let result = sqlx::query(
        "UPDATE market_data_private.clock_handoff_state_v1 SET materialized=TRUE,handoff_count=1 WHERE singleton AND NOT materialized AND handoff_count=0 AND epoch_transition_count=0",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;

    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(SourceBindingError::StoreUnavailable)
    }
}

async fn advance_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
    epoch_changed: bool,
) -> Result<(), SourceBindingError> {
    let result = sqlx::query(
        "UPDATE market_data_private.clock_handoff_state_v1 SET handoff_count=handoff_count+1,epoch_transition_count=epoch_transition_count+$1 WHERE singleton AND materialized",
    )
    .bind(i64::from(epoch_changed))
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;

    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(SourceBindingError::StoreUnavailable)
    }
}

async fn install_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    lock_clock_state(transaction).await?;
    let state_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM market_data_private.clock_handoff_state_v1")
            .fetch_one(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
    if state_rows != 0 {
        return Err(SourceBindingError::StoreUnavailable);
    }
    let current = load_current_clock_for_update(transaction).await?;
    let materialization_witness =
        load_clock_materialization_witness_for_update(transaction).await?;
    let counts = clock_handoff_storage_counts(transaction).await?;
    match (current, materialization_witness, counts) {
        (None, None, (0, 0, 0)) => {
            insert_clock_handoff_state(
                transaction,
                DurableClockHandoffState {
                    materialized: false,
                    handoff_count: 0,
                    epoch_transition_count: 0,
                },
            )
            .await
        }
        (Some(clock), Some(false), (0, 0, 0)) => {
            let fact = build_head_fact(&clock, None)
                .map_err(|_| SourceBindingError::TrustedClockMismatch)?;
            insert_clock_handoff(transaction, &fact).await?;
            set_clock_handoff_head(transaction, fact.handoff.head_identity()).await?;
            sqlx::query(
                "UPDATE market_data_private.clock_head_v1 SET shared_time_materialized=TRUE WHERE singleton AND NOT shared_time_materialized",
            )
            .execute(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
            insert_clock_handoff_state(
                transaction,
                DurableClockHandoffState {
                    materialized: true,
                    handoff_count: 1,
                    epoch_transition_count: 0,
                },
            )
            .await
        }
        _ => Err(SourceBindingError::StoreUnavailable),
    }
}

async fn validate_clock_handoff_installation(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    lock_clock_state(transaction).await?;
    let state = load_clock_handoff_state_for_update(transaction).await?;
    let current = load_current_clock_for_update(transaction).await?;
    let materialization_witness =
        load_clock_materialization_witness_for_update(transaction).await?;
    let counts = clock_handoff_storage_counts(transaction).await?;
    match (state.materialized, current, materialization_witness, counts) {
        (false, None, None, (0, 0, 0))
            if state.handoff_count == 0 && state.epoch_transition_count == 0 =>
        {
            Ok(())
        }
        (true, Some(clock), Some(true), _) => {
            ensure_clock_handoff_state(transaction, &clock).await?;
            Ok(())
        }
        _ => Err(SourceBindingError::StoreUnavailable),
    }
}

async fn ensure_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
    current: &MarketDataClockAdmission,
) -> Result<ClockHeadFact, SourceBindingError> {
    let state = load_clock_handoff_state_for_update(transaction).await?;
    let materialization_witness =
        load_clock_materialization_witness_for_update(transaction).await?;
    let (handoff_count, head_count, epoch_transition_count) =
        clock_handoff_storage_counts(transaction).await?;

    if !state.materialized
        || materialization_witness != Some(true)
        || state.handoff_count != handoff_count
        || state.epoch_transition_count != epoch_transition_count
        || head_count != 1
    {
        return Err(SourceBindingError::StoreUnavailable);
    }

    if let Some(fact) = load_current_clock_fact_for_update(transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?
    {
        if fact.clock() == *current && verify_head_fact(&fact) {
            return Ok(fact);
        }
        return Err(SourceBindingError::StoreUnavailable);
    }
    Err(SourceBindingError::StoreUnavailable)
}

async fn insert_clock_handoff(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &ClockHeadFact,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.clock_handoffs_v1(head_identity,head_digest,predecessor_head_digest,clock_identity,clock_epoch,monotonic_sequence,wall_observed,decision_cut,valid_through,restart_continuity_digest,uncertainty_bound,skew_bound,comparison_rule) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1)",
    )
    .bind(fact.handoff.head_identity().as_bytes().as_slice())
    .bind(fact.handoff.head_digest().as_bytes().as_slice())
    .bind(fact.predecessor_head_digest.map(|value| value.as_bytes().to_vec()))
    .bind(fact.handoff.clock_identity())
    .bind(fact.handoff.clock_epoch())
    .bind(to_i64(fact.handoff.monotonic_sequence())?)
    .bind(to_i64(fact.handoff.wall_observed())?)
    .bind(to_i64(fact.handoff.decision_cut())?)
    .bind(to_i64(fact.handoff.valid_through())?)
    .bind(fact.handoff.restart_continuity_digest().as_bytes().as_slice())
    .bind(to_i64(fact.handoff.uncertainty_bound())?)
    .bind(to_i64(fact.handoff.skew_bound())?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn set_clock_handoff_head(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.clock_handoff_head_v1(singleton,head_identity) VALUES (TRUE,$1) ON CONFLICT (singleton) DO UPDATE SET head_identity=EXCLUDED.head_identity",
    )
    .bind(identity.as_bytes().as_slice())
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn persist_clock_successor(
    mut transaction: Transaction<'_, Postgres>,
    prior: &ClockHeadHandoff,
    next: &MarketDataClockAdmission,
    fault: PostgresCommitFault,
) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
    lock_clock_state(&mut transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let current_clock = load_current_clock_for_update(&mut transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
    let current = ensure_clock_handoff_state(&mut transaction, &current_clock)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let next_fact = build_head_fact(next, Some(prior.head_digest()))?;

    if let Some(stored) =
        load_clock_fact_by_identity(&mut transaction, next_fact.handoff.head_identity(), false)
            .await?
    {
        if stored != next_fact || stored.predecessor_head_digest != Some(prior.head_digest()) {
            return Err(SharedTimeEvidenceError::ReplayConflict);
        }
        let proof = load_epoch_proof(&mut transaction, stored.handoff.head_digest()).await?;
        let stored_prior =
            load_clock_fact_by_identity(&mut transaction, prior.head_identity(), false)
                .await?
                .ok_or(SharedTimeEvidenceError::PriorHandoffMismatch)?;
        if &stored_prior.handoff != prior {
            return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
        }
        let expected_proof = if prior.clock_epoch() == stored.handoff.clock_epoch() {
            None
        } else {
            Some(build_epoch_successor_proof(&stored_prior, &stored))
        };

        if proof != expected_proof {
            return Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch);
        }
        transaction
            .commit()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        return Ok(successor_readback(stored.handoff, proof));
    }

    if &current.handoff != prior {
        return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
    }
    let epoch_changed = next.clock_epoch != current_clock.clock_epoch;
    if epoch_changed {
        validate_new_epoch_successor(&current, next)?;
        if clock_epoch_seen(&mut transaction, next).await? {
            return Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch);
        }
    } else {
        validate_same_epoch_successor(&current, next)?;
    }

    insert_clock_handoff(&mut transaction, &next_fact)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let proof = if epoch_changed {
        let proof = build_epoch_successor_proof(&current, &next_fact);

        if fault == PostgresCommitFault::AfterClockHeadBeforeEpochProof {
            return Err(SharedTimeEvidenceError::CommitInterrupted);
        }
        insert_epoch_proof(&mut transaction, &proof).await?;
        Some(proof)
    } else {
        None
    };
    update_clock(&mut transaction, next)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    set_clock_handoff_head(&mut transaction, next_fact.handoff.head_identity())
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    advance_clock_handoff_state(&mut transaction, epoch_changed)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    transaction
        .commit()
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    if fault == PostgresCommitFault::ResponseLoss {
        Err(SharedTimeEvidenceError::ResponseLost)
    } else {
        Ok(successor_readback(next_fact.handoff, proof))
    }
}

async fn clock_epoch_seen(
    transaction: &mut Transaction<'_, Postgres>,
    next: &MarketDataClockAdmission,
) -> Result<bool, SharedTimeEvidenceError> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM market_data_private.clock_handoffs_v1 WHERE clock_identity=$1 AND clock_epoch=$2)",
    )
    .bind(&next.clock_identity)
    .bind(&next.clock_epoch)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)
}

async fn insert_epoch_proof(
    transaction: &mut Transaction<'_, Postgres>,
    proof: &EpochSuccessorProof,
) -> Result<(), SharedTimeEvidenceError> {
    sqlx::query(
        "INSERT INTO market_data_private.epoch_successor_proofs_v1(proof_identity,predecessor_head_digest,successor_head_digest,prior_clock_identity,prior_clock_epoch,successor_clock_identity,successor_clock_epoch,successor_continuity_digest,commit_cut,comparison_rule) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)",
    )
    .bind(proof.proof_identity().as_bytes().as_slice())
    .bind(proof.predecessor_head_digest().as_bytes().as_slice())
    .bind(proof.successor_head_digest().as_bytes().as_slice())
    .bind(proof.prior_clock_identity())
    .bind(proof.prior_clock_epoch())
    .bind(proof.successor_clock_identity())
    .bind(proof.successor_clock_epoch())
    .bind(proof.successor_continuity_digest().as_bytes().as_slice())
    .bind(i64::try_from(proof.commit_cut()).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?)
    .execute(&mut **transaction)
    .await
    .map_err(|e| map_shared_time_insert_error(&e))?;
    Ok(())
}

fn map_shared_time_insert_error(error: &sqlx::Error) -> SharedTimeEvidenceError {
    if error
        .as_database_error()
        .is_some_and(sqlx::error::DatabaseError::is_unique_violation)
    {
        SharedTimeEvidenceError::ReplayConflict
    } else {
        SharedTimeEvidenceError::StoreUnavailable
    }
}

async fn load_current_clock_fact_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<ClockHeadFact>, SharedTimeEvidenceError> {
    let row = sqlx::query(
        "SELECT h.* FROM market_data_private.clock_handoff_head_v1 AS p JOIN market_data_private.clock_handoffs_v1 AS h ON h.head_identity=p.head_identity WHERE p.singleton FOR UPDATE OF p,h",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    row.map(|row| decode_clock_fact(&row)).transpose()
}

async fn load_clock_fact_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
    for_update: bool,
) -> Result<Option<ClockHeadFact>, SharedTimeEvidenceError> {
    let statement = if for_update {
        "SELECT * FROM market_data_private.clock_handoffs_v1 WHERE head_identity=$1 FOR UPDATE"
    } else {
        "SELECT * FROM market_data_private.clock_handoffs_v1 WHERE head_identity=$1"
    };
    let row = sqlx::query(statement)
        .bind(identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    row.map(|row| decode_clock_fact(&row)).transpose()
}

fn decode_clock_fact(
    row: &sqlx::postgres::PgRow,
) -> Result<ClockHeadFact, SharedTimeEvidenceError> {
    let comparison_rule: i16 = row
        .try_get("comparison_rule")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    if comparison_rule != 1 {
        return Err(SharedTimeEvidenceError::StoreUnavailable);
    }
    let restart: Vec<u8> = row
        .try_get("restart_continuity_digest")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let predecessor: Option<Vec<u8>> = row
        .try_get("predecessor_head_digest")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let clock = MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: row
            .try_get("clock_identity")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        clock_epoch: row
            .try_get("clock_epoch")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        monotonic_sequence: positive_u64(
            row.try_get("monotonic_sequence")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        wall_observed: positive_u64(
            row.try_get("wall_observed")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        decision_cut: positive_u64(
            row.try_get("decision_cut")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        valid_through: positive_u64(
            row.try_get("valid_through")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        restart_continuity_digest: digest_from_bytes(&restart)
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        uncertainty_bound: nonnegative_u64(
            row.try_get("uncertainty_bound")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        skew_bound: positive_u64(
            row.try_get("skew_bound")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
    };
    let fact = build_head_fact(
        &clock,
        predecessor
            .map(|value| digest_from_bytes(&value))
            .transpose()
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
    )?;
    let stored_identity: Vec<u8> = row
        .try_get("head_identity")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let stored_digest: Vec<u8> = row
        .try_get("head_digest")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;

    if fact.handoff.head_identity()
        != digest_from_bytes(&stored_identity)
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        || fact.handoff.head_digest()
            != digest_from_bytes(&stored_digest)
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        || !verify_head_fact(&fact)
    {
        return Err(SharedTimeEvidenceError::StoreUnavailable);
    }
    Ok(fact)
}

async fn load_epoch_proof(
    transaction: &mut Transaction<'_, Postgres>,
    successor_digest: BindingDigest,
) -> Result<Option<EpochSuccessorProof>, SharedTimeEvidenceError> {
    let row = sqlx::query(
        "SELECT * FROM market_data_private.epoch_successor_proofs_v1 WHERE successor_head_digest=$1",
    )
    .bind(successor_digest.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    row.map(|row| decode_epoch_proof(&row)).transpose()
}

fn decode_epoch_proof(
    row: &sqlx::postgres::PgRow,
) -> Result<EpochSuccessorProof, SharedTimeEvidenceError> {
    let comparison_rule: i16 = row
        .try_get("comparison_rule")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    if comparison_rule != 1 {
        return Err(SharedTimeEvidenceError::StoreUnavailable);
    }
    let digest_column = |name: &'static str| -> Result<BindingDigest, SharedTimeEvidenceError> {
        let value: Vec<u8> = row
            .try_get(name)
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        digest_from_bytes(&value).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)
    };
    Ok(EpochSuccessorProof {
        proof_identity: digest_column("proof_identity")?,
        predecessor_head_digest: digest_column("predecessor_head_digest")?,
        successor_head_digest: digest_column("successor_head_digest")?,
        prior_clock_identity: row
            .try_get("prior_clock_identity")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        prior_clock_epoch: row
            .try_get("prior_clock_epoch")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        successor_clock_identity: row
            .try_get("successor_clock_identity")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        successor_clock_epoch: row
            .try_get("successor_clock_epoch")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        successor_continuity_digest: digest_column("successor_continuity_digest")?,
        commit_cut: positive_u64(
            row.try_get("commit_cut")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        comparison_rule:
            super::shared_time_evidence::ClockHeadComparisonRule::ExclusiveValidThrough,
    })
}

async fn load_clock_fact_from_pool(
    pool: &PgPool,
    locator: &UntrustedClockHeadLocator,
) -> Result<ClockHeadFact, SharedTimeEvidenceError> {
    let row = sqlx::query("SELECT * FROM market_data_private.resolve_clock_handoff_v1($1)")
        .bind(locator.head_identity().as_bytes().as_slice())
        .fetch_optional(pool)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        .ok_or(SharedTimeEvidenceError::LocatorMismatch)?;
    let fact = decode_clock_fact(&row)?;
    if fact.handoff.locator() != locator {
        return Err(SharedTimeEvidenceError::LocatorMismatch);
    }
    Ok(fact)
}

async fn load_historical_clock(
    pool: &PgPool,
    expected: &MarketDataClockAdmission,
) -> Result<MarketDataClockAdmission, SharedTimeEvidenceError> {
    let semantic_identity = build_head_fact(expected, None)?.handoff.head_identity();
    let row = sqlx::query("SELECT * FROM market_data_private.resolve_clock_handoff_v1($1)")
        .bind(semantic_identity.as_bytes().as_slice())
        .fetch_optional(pool)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        .ok_or(SharedTimeEvidenceError::LocatorMismatch)?;
    let fact = decode_clock_fact(&row)?;
    let clock = fact.clock();

    if &clock != expected {
        return Err(SharedTimeEvidenceError::LocatorMismatch);
    }
    Ok(clock)
}

fn clock_for_source_time(
    time: &super::source_binding::UntrustedMarketDataAsOf,
) -> MarketDataClockAdmission {
    MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: time.clock_identity.clone(),
        clock_epoch: time.clock_epoch.clone(),
        monotonic_sequence: time.monotonic_sequence,
        wall_observed: time.observed_at,
        decision_cut: time.effective_at,
        valid_through: time.valid_through,
        restart_continuity_digest: time.restart_continuity_digest,
        uncertainty_bound: time.uncertainty_bound,
        skew_bound: time.skew_bound,
        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
    }
}

fn clock_for_pit_time(
    time: &super::pit_snapshot::UntrustedPitSnapshotTimeEvidence,
) -> MarketDataClockAdmission {
    MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: time.decision_cut.clock_identity.clone(),
        clock_epoch: time.decision_cut.clock_epoch.clone(),
        monotonic_sequence: time.monotonic_sequence,
        wall_observed: time.observed_at,
        decision_cut: time.decision_cut.value,
        valid_through: time.valid_through,
        restart_continuity_digest: time.restart_continuity_digest,
        uncertainty_bound: time.uncertainty_bound,
        skew_bound: time.skew_bound,
        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
    }
}

async fn load_epoch_proof_from_pool(
    pool: &PgPool,
    successor_digest: BindingDigest,
) -> Result<Option<EpochSuccessorProof>, SharedTimeEvidenceError> {
    let row = sqlx::query("SELECT * FROM market_data_private.resolve_epoch_successor_proof_v1($1)")
        .bind(successor_digest.as_bytes().as_slice())
        .fetch_optional(pool)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    row.map(|row| decode_epoch_proof(&row)).transpose()
}

#[async_trait::async_trait]
impl SharedTimeEvidenceResolver for MarketDataReadPostgres {
    async fn resolve_clock_head(
        &self,
        locator: &UntrustedClockHeadLocator,
    ) -> Result<ClockHeadHandoff, SharedTimeEvidenceError> {
        Ok(load_clock_fact_from_pool(&self.pool, locator)
            .await?
            .handoff)
    }

    async fn resolve_clock_successor(
        &self,
        prior: &ClockHeadHandoff,
        successor: &UntrustedClockHeadLocator,
    ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
        let prior_fact = load_clock_fact_from_pool(&self.pool, prior.locator()).await?;
        if &prior_fact.handoff != prior {
            return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
        }
        let successor_fact = load_clock_fact_from_pool(&self.pool, successor).await?;
        if successor_fact.predecessor_head_digest != Some(prior.head_digest()) {
            return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
        }
        let proof =
            load_epoch_proof_from_pool(&self.pool, successor_fact.handoff.head_digest()).await?;
        if prior.clock_epoch() == successor_fact.handoff.clock_epoch() {
            validate_same_epoch_successor(&prior_fact, &successor_fact.clock())?;

            if proof.is_some() {
                return Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch);
            }
        } else {
            validate_new_epoch_successor(&prior_fact, &successor_fact.clock())?;
            let proof_value = proof
                .as_ref()
                .ok_or(SharedTimeEvidenceError::EpochSuccessorProofMismatch)?;
            if !verify_epoch_successor_proof(proof_value, &prior_fact, &successor_fact) {
                return Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch);
            }
        }
        Ok(successor_readback(successor_fact.handoff, proof))
    }
}

#[async_trait::async_trait]
impl SourceBindingOwnerResolver for MarketDataReadPostgres {
    async fn resolve_source_binding(
        &self,
        locator: &UntrustedSourceBindingLocator,
    ) -> Result<SourceBindingOwnerReadback, SourceBindingError> {
        let envelope = load_envelope(
            &self.pool,
            "SELECT * FROM market_data_private.resolve_source_binding_v1($1)",
            locator.binding_id,
        )
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?
        .ok_or(SourceBindingError::LocatorMismatch)?;
        let aggregate: SourceBindingStoredAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| SourceBindingError::StoreUnavailable)?;

        if !verify_source_native(&aggregate, &envelope.native, true)
            || aggregate.commit().receipt().locator() != locator
        {
            return Err(SourceBindingError::LocatorMismatch);
        }
        let expected_clock = clock_for_source_time(aggregate.commit().fact().time_evidence());
        let historical_clock = load_historical_clock(&self.pool, &expected_clock)
            .await
            .map_err(|e| match e {
                SharedTimeEvidenceError::StoreUnavailable => SourceBindingError::StoreUnavailable,
                _ => SourceBindingError::TrustedClockMismatch,
            })?;
        validate_clock_for_readback(aggregate.commit().fact().time_evidence(), &historical_clock)?;
        Ok(SourceBindingOwnerReadback::from_verified(&aggregate))
    }
}

#[async_trait::async_trait]
impl PitSnapshotOwnerResolver for MarketDataReadPostgres {
    async fn resolve_pit_snapshot(
        &self,
        locator: &UntrustedPitSnapshotLocator,
    ) -> Result<PitSnapshotOwnerReadback, PitSnapshotError> {
        let envelope = load_envelope(
            &self.pool,
            "SELECT * FROM market_data_private.resolve_pit_snapshot_v1($1)",
            locator.snapshot_identity,
        )
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
        .ok_or(PitSnapshotError::LocatorMismatch)?;
        let aggregate: PitSnapshotCommitAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

        if !verify_pit_native(&aggregate, &envelope.native, true)
            || aggregate.receipt().locator() != locator
        {
            return Err(PitSnapshotError::LocatorMismatch);
        }
        let expected_clock = clock_for_pit_time(&aggregate.fact().request().time_evidence);
        let historical_clock = load_historical_clock(&self.pool, &expected_clock)
            .await
            .map_err(|e| match e {
                SharedTimeEvidenceError::StoreUnavailable => {
                    PitSnapshotError::PersistenceUnavailable
                }
                _ => PitSnapshotError::TrustedClockMismatch,
            })?;
        super::pit_snapshot::authority::validate_read_clock(
            &aggregate.fact().request().time_evidence,
            &historical_clock,
        )?;
        Ok(PitSnapshotOwnerReadback::from_verified(&aggregate))
    }
}

struct StoredEnvelope {
    aggregate: Value,
    native: NativeIndex,
}

struct NativeIndex {
    row_identity: BindingDigest,
    fact_digest: BindingDigest,
    request_identity: Option<BindingDigest>,
    request_digest: Option<BindingDigest>,
    correction_stream_identity: Option<String>,
    correction_sequence: Option<u64>,
    fact_lineage_root: BindingDigest,
    fact_lineage_version: u64,
    outbox_event_identity: BindingDigest,
    outbox_aggregate_identity: BindingDigest,
    outbox_payload: Vec<u8>,
    outbox_digest: BindingDigest,
    head: NativeHead,
}

struct NativeHead {
    lineage_root: BindingDigest,
    identity: BindingDigest,
    fact_digest: BindingDigest,
    lineage_version: u64,
}

impl NativeHead {
    fn matches_source(&self, fact: &super::source_binding::authority::SourceBindingFact) -> bool {
        self.lineage_root == fact.lineage_root()
            && self.identity == fact.binding_id()
            && self.fact_digest == fact.digest()
            && self.lineage_version == fact.lineage_version()
    }

    fn matches_pit_identity(
        &self,
        predecessor: BindingDigest,
        successor: &super::pit_snapshot::PitSnapshotFact,
    ) -> bool {
        self.lineage_root == successor.lineage_root()
            && self.identity == predecessor
            && Some(self.fact_digest) == successor.predecessor_fact_digest()
            && self.lineage_version.checked_add(1) == Some(successor.lineage_version())
    }

    fn matches_source_locator(&self, locator: &UntrustedSourceBindingLocator) -> bool {
        self.lineage_root == locator.lineage_root
            && self.identity == locator.binding_id
            && self.fact_digest == locator.fact_digest
            && self.lineage_version == locator.lineage_version
    }
}

fn verify_source_native(
    aggregate: &SourceBindingStoredAggregate,
    native: &NativeIndex,
    require_current_head: bool,
) -> bool {
    let fact = aggregate.commit().fact();
    verify_source_aggregate(aggregate)
        && native.row_identity == fact.binding_id()
        && native.fact_digest == fact.digest()
        && native.request_identity.is_none()
        && native.request_digest.is_none()
        && native.correction_stream_identity.is_none()
        && native.correction_sequence.is_none()
        && native.fact_lineage_root == fact.lineage_root()
        && native.fact_lineage_version == fact.lineage_version()
        && native.outbox_event_identity == aggregate.outbox().digest()
        && native.outbox_aggregate_identity == fact.binding_id()
        && native.outbox_payload == aggregate.outbox().payload()
        && native.outbox_digest == aggregate.outbox().digest()
        && native.head.lineage_root == fact.lineage_root()
        && native.head.lineage_version >= fact.lineage_version()
        && (!require_current_head || native.head.matches_source(fact))
}

fn verify_pit_native(
    aggregate: &PitSnapshotCommitAggregate,
    native: &NativeIndex,
    require_current_head: bool,
) -> bool {
    let fact = aggregate.fact();
    let correction = &fact.evidence().correction_frontier;
    verify_pit_aggregate(aggregate)
        && native.row_identity == fact.snapshot_identity()
        && native.fact_digest == fact.digest()
        && native.request_identity == Some(fact.request_identity())
        && native.request_digest == Some(fact.request_digest())
        && native.correction_stream_identity.as_deref() == Some(&*correction.stream_identity)
        && native.correction_sequence == Some(correction.sequence)
        && native.fact_lineage_root == fact.lineage_root()
        && native.fact_lineage_version == fact.lineage_version()
        && native.outbox_event_identity == aggregate.outbox().digest()
        && native.outbox_aggregate_identity == fact.snapshot_identity()
        && native.outbox_payload == aggregate.outbox().payload()
        && native.outbox_digest == aggregate.outbox().digest()
        && native.head.lineage_root == fact.lineage_root()
        && native.head.lineage_version >= fact.lineage_version()
        && (!require_current_head
            || (native.head.identity == fact.snapshot_identity()
                && native.head.fact_digest == fact.digest()
                && native.head.lineage_version == fact.lineage_version()))
}

async fn load_envelope(
    pool: &PgPool,
    statement: &'static str,
    identity: BindingDigest,
) -> Result<Option<StoredEnvelope>, sqlx::Error> {
    let Some(row) = sqlx::query(statement)
        .bind(identity.as_bytes().as_slice())
        .fetch_optional(pool)
        .await?
    else {
        return Ok(None);
    };
    Ok(Some(decode_envelope(&row)?))
}

fn decode_envelope(row: &sqlx::postgres::PgRow) -> Result<StoredEnvelope, sqlx::Error> {
    Ok(StoredEnvelope {
        aggregate: row.try_get("aggregate_json")?,
        native: decode_native_index(row)?,
    })
}

fn decode_native_index(row: &sqlx::postgres::PgRow) -> Result<NativeIndex, sqlx::Error> {
    let request_identity: Option<Vec<u8>> = row.try_get("request_identity")?;
    let request_digest: Option<Vec<u8>> = row.try_get("request_digest")?;
    let correction_sequence: Option<i64> = row.try_get("correction_sequence")?;
    Ok(NativeIndex {
        row_identity: row_digest(row, "row_identity")?,
        fact_digest: row_digest(row, "fact_digest")?,
        request_identity: request_identity
            .map(|value| digest_from_bytes(&value))
            .transpose()?,
        request_digest: request_digest
            .map(|value| digest_from_bytes(&value))
            .transpose()?,
        correction_stream_identity: row.try_get("correction_stream_identity")?,
        correction_sequence: correction_sequence.map(positive_u64).transpose()?,
        fact_lineage_root: row_digest(row, "fact_lineage_root")?,
        fact_lineage_version: positive_u64(row.try_get("fact_lineage_version")?)?,
        outbox_event_identity: row_digest(row, "outbox_event_identity")?,
        outbox_aggregate_identity: row_digest(row, "outbox_aggregate_identity")?,
        outbox_payload: row.try_get("outbox_payload")?,
        outbox_digest: row_digest(row, "outbox_digest")?,
        head: NativeHead {
            lineage_root: row_digest(row, "head_lineage_root")?,
            identity: row_digest(row, "head_identity")?,
            fact_digest: row_digest(row, "head_digest")?,
            lineage_version: positive_u64(row.try_get("head_version")?)?,
        },
    })
}

fn decode_head(row: &sqlx::postgres::PgRow) -> Result<NativeHead, sqlx::Error> {
    Ok(NativeHead {
        lineage_root: row_digest(row, "lineage_root")?,
        identity: row_digest(row, "head_identity")?,
        fact_digest: row_digest(row, "fact_digest")?,
        lineage_version: positive_u64(row.try_get("lineage_version")?)?,
    })
}

fn row_digest(
    row: &sqlx::postgres::PgRow,
    column: &'static str,
) -> Result<BindingDigest, sqlx::Error> {
    let bytes: Vec<u8> = row.try_get(column)?;
    digest_from_bytes(&bytes)
}

fn decode_clock(row: &sqlx::postgres::PgRow) -> Result<MarketDataClockAdmission, sqlx::Error> {
    let restart: Vec<u8> = row.try_get("restart_continuity_digest")?;
    let comparison_rule: i16 = row.try_get("comparison_rule")?;
    if comparison_rule != 1 {
        return Err(sqlx::Error::Protocol(
            "invalid Market Data comparison rule".into(),
        ));
    }
    Ok(MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: row.try_get("clock_identity")?,
        clock_epoch: row.try_get("clock_epoch")?,
        monotonic_sequence: positive_u64(row.try_get("monotonic_sequence")?)?,
        wall_observed: positive_u64(row.try_get("wall_observed")?)?,
        decision_cut: positive_u64(row.try_get("decision_cut")?)?,
        valid_through: positive_u64(row.try_get("valid_through")?)?,
        restart_continuity_digest: digest_from_bytes(&restart)?,
        uncertainty_bound: nonnegative_u64(row.try_get("uncertainty_bound")?)?,
        skew_bound: positive_u64(row.try_get("skew_bound")?)?,
        comparison_rule:
            super::source_binding::MarketDataClockComparisonRule::ExclusiveValidThrough,
    })
}

fn digest_from_bytes(bytes: &[u8]) -> Result<BindingDigest, sqlx::Error> {
    let value: [u8; 32] = bytes
        .try_into()
        .map_err(|_| sqlx::Error::Protocol("invalid Market Data digest length".into()))?;
    Ok(BindingDigest::from_untrusted_bytes(value))
}

fn positive_u64(value: i64) -> Result<u64, sqlx::Error> {
    u64::try_from(value)
        .ok()
        .filter(|value| *value != 0)
        .ok_or_else(|| sqlx::Error::Protocol("invalid positive Market Data integer".into()))
}

fn nonnegative_u64(value: i64) -> Result<u64, sqlx::Error> {
    u64::try_from(value).map_err(|_| sqlx::Error::Protocol("invalid Market Data integer".into()))
}

#[cfg(test)]
mod tests;
