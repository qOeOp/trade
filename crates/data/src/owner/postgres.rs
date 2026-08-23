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
    source_binding::{
        BindingDigest, MarketDataClockAdmission, SourceBindingError, SourceBindingOwnerReadback,
        SourceBindingOwnerResolver, UntrustedSourceBindingLocator, UntrustedSourceBindingProposal,
        authority::{
            OwnerLineage as SourceOwnerLineage, OwnerSourceBindingDecision, SourceBindingCommit,
            SourceBindingStoredAggregate, build_stored_aggregate, derive_binding_id,
            validate_clock_for_readback, validate_proposal, validate_successor_advances,
            verify_stored_aggregate as verify_source_aggregate,
        },
    },
};

const MIGRATION_ID: &str = "market-data-owner-postgres-v1";

const MIGRATION_STATEMENTS: &[&str] = &[
    "CREATE SCHEMA IF NOT EXISTS market_data_private AUTHORIZATION CURRENT_USER",
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.owner_migrations_v1 (migration_id TEXT PRIMARY KEY, installed_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp())",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_head_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), clock_identity TEXT NOT NULL, clock_epoch TEXT NOT NULL, monotonic_sequence BIGINT NOT NULL CHECK (monotonic_sequence > 0), wall_observed BIGINT NOT NULL CHECK (wall_observed > 0), decision_cut BIGINT NOT NULL CHECK (decision_cut > 0), valid_through BIGINT NOT NULL, restart_continuity_digest BYTEA NOT NULL CHECK (octet_length(restart_continuity_digest) = 32), uncertainty_bound BIGINT NOT NULL CHECK (uncertainty_bound >= 0), skew_bound BIGINT NOT NULL CHECK (skew_bound > 0), comparison_rule SMALLINT NOT NULL CHECK (comparison_rule = 1), CHECK (uncertainty_bound <= skew_bound), CHECK (decision_cut <= wall_observed), CHECK (wall_observed < valid_through))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_facts_v1 (binding_id BYTEA PRIMARY KEY CHECK (octet_length(binding_id) = 32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_root BYTEA NOT NULL CHECK (octet_length(lineage_root) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0), aggregate_json JSONB NOT NULL, UNIQUE(lineage_root, lineage_version))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_heads_v1 (lineage_root BYTEA PRIMARY KEY CHECK (octet_length(lineage_root) = 32), binding_id BYTEA NOT NULL UNIQUE REFERENCES market_data_private.source_binding_facts_v1(binding_id), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_outbox_v1 (event_identity BYTEA PRIMARY KEY CHECK (octet_length(event_identity) = 32), aggregate_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.source_binding_facts_v1(binding_id), payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest) = 32), payload BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_facts_v1 (snapshot_identity BYTEA PRIMARY KEY CHECK (octet_length(snapshot_identity) = 32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), request_identity BYTEA NOT NULL CHECK (octet_length(request_identity) = 32), request_digest BYTEA NOT NULL CHECK (octet_length(request_digest) = 32), correction_stream_identity TEXT NOT NULL, correction_sequence BIGINT NOT NULL CHECK (correction_sequence > 0), lineage_root BYTEA NOT NULL CHECK (octet_length(lineage_root) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0), aggregate_json JSONB NOT NULL, UNIQUE(request_identity, correction_stream_identity, correction_sequence), UNIQUE(lineage_root, lineage_version))",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_heads_v1 (lineage_root BYTEA PRIMARY KEY CHECK (octet_length(lineage_root) = 32), snapshot_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_outbox_v1 (event_identity BYTEA PRIMARY KEY CHECK (octet_length(event_identity) = 32), aggregate_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity), payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest) = 32), payload BYTEA NOT NULL)",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_source_binding_v1(p_binding_id BYTEA) RETURNS TABLE(row_identity BYTEA, fact_digest BYTEA, request_identity BYTEA, request_digest BYTEA, correction_stream_identity TEXT, correction_sequence BIGINT, fact_lineage_root BYTEA, fact_lineage_version BIGINT, aggregate_json JSONB, outbox_event_identity BYTEA, outbox_aggregate_identity BYTEA, outbox_payload BYTEA, outbox_digest BYTEA, head_lineage_root BYTEA, head_identity BYTEA, head_digest BYTEA, head_version BIGINT, clock_identity TEXT, clock_epoch TEXT, monotonic_sequence BIGINT, wall_observed BIGINT, decision_cut BIGINT, valid_through BIGINT, restart_continuity_digest BYTEA, uncertainty_bound BIGINT, skew_bound BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT f.binding_id, f.fact_digest, NULL::BYTEA, NULL::BYTEA, NULL::TEXT, NULL::BIGINT, f.lineage_root, f.lineage_version, f.aggregate_json, o.event_identity, o.aggregate_identity, o.payload, o.payload_digest, h.lineage_root, h.binding_id, h.fact_digest, h.lineage_version, c.clock_identity, c.clock_epoch, c.monotonic_sequence, c.wall_observed, c.decision_cut, c.valid_through, c.restart_continuity_digest, c.uncertainty_bound, c.skew_bound, c.comparison_rule FROM market_data_private.source_binding_facts_v1 AS f JOIN market_data_private.source_binding_outbox_v1 AS o ON o.aggregate_identity = f.binding_id JOIN market_data_private.source_binding_heads_v1 AS h ON h.lineage_root = f.lineage_root JOIN market_data_private.clock_head_v1 AS c ON c.singleton WHERE f.binding_id = p_binding_id $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_snapshot_v1(p_snapshot_identity BYTEA) RETURNS TABLE(row_identity BYTEA, fact_digest BYTEA, request_identity BYTEA, request_digest BYTEA, correction_stream_identity TEXT, correction_sequence BIGINT, fact_lineage_root BYTEA, fact_lineage_version BIGINT, aggregate_json JSONB, outbox_event_identity BYTEA, outbox_aggregate_identity BYTEA, outbox_payload BYTEA, outbox_digest BYTEA, head_lineage_root BYTEA, head_identity BYTEA, head_digest BYTEA, head_version BIGINT, clock_identity TEXT, clock_epoch TEXT, monotonic_sequence BIGINT, wall_observed BIGINT, decision_cut BIGINT, valid_through BIGINT, restart_continuity_digest BYTEA, uncertainty_bound BIGINT, skew_bound BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT f.snapshot_identity, f.fact_digest, f.request_identity, f.request_digest, f.correction_stream_identity, f.correction_sequence, f.lineage_root, f.lineage_version, f.aggregate_json, o.event_identity, o.aggregate_identity, o.payload, o.payload_digest, h.lineage_root, h.snapshot_identity, h.fact_digest, h.lineage_version, c.clock_identity, c.clock_epoch, c.monotonic_sequence, c.wall_observed, c.decision_cut, c.valid_through, c.restart_continuity_digest, c.uncertainty_bound, c.skew_bound, c.comparison_rule FROM market_data_private.pit_snapshot_facts_v1 AS f JOIN market_data_private.pit_snapshot_outbox_v1 AS o ON o.aggregate_identity = f.snapshot_identity JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root = f.lineage_root JOIN market_data_private.clock_head_v1 AS c ON c.singleton WHERE f.snapshot_identity = p_snapshot_identity $function$",
    "REVOKE ALL ON ALL TABLES IN SCHEMA market_data_private FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_source_binding_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_snapshot_v1(BYTEA) FROM PUBLIC",
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
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PostgresCommitFault {
    None,
    AfterFactBeforeOutbox,
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
    let row = sqlx::query(
        "SELECT clock_identity,clock_epoch,monotonic_sequence,wall_observed,decision_cut,valid_through,restart_continuity_digest,uncertainty_bound,skew_bound,comparison_rule FROM market_data_private.clock_head_v1 WHERE singleton FOR UPDATE",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    if let Some(row) = row {
        let current = decode_clock(&row).map_err(|_| SourceBindingError::StoreUnavailable)?;
        let stable = next.clock_identity == current.clock_identity
            && next.clock_epoch == current.clock_epoch
            && next.restart_continuity_digest == current.restart_continuity_digest
            && next.uncertainty_bound == current.uncertainty_bound
            && next.skew_bound == current.skew_bound
            && next.comparison_rule == current.comparison_rule;
        let monotonic = if next.monotonic_sequence == current.monotonic_sequence {
            next == &current
        } else {
            next.monotonic_sequence > current.monotonic_sequence
                && next.decision_cut > current.decision_cut
                && next.wall_observed > current.wall_observed
        };

        if !stable || !monotonic {
            return Err(SourceBindingError::TrustedClockMismatch);
        }

        if next != &current {
            update_clock(transaction, next).await?;
        }
    } else {
        insert_clock(transaction, next).await?;
    }
    Ok(())
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
        "INSERT INTO market_data_private.clock_head_v1(singleton,clock_identity,clock_epoch,monotonic_sequence,wall_observed,decision_cut,valid_through,restart_continuity_digest,uncertainty_bound,skew_bound,comparison_rule) VALUES (TRUE,$1,$2,$3,$4,$5,$6,$7,$8,$9,1)",
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
        "UPDATE market_data_private.clock_head_v1 SET monotonic_sequence=$1,wall_observed=$2,decision_cut=$3,valid_through=$4 WHERE singleton",
    )
    .bind(to_i64(clock.monotonic_sequence)?)
    .bind(to_i64(clock.wall_observed)?)
    .bind(to_i64(clock.decision_cut)?)
    .bind(to_i64(clock.valid_through)?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
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
        validate_clock_for_readback(aggregate.commit().fact().time_evidence(), &envelope.clock)?;
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
        super::pit_snapshot::authority::validate_read_clock(
            &aggregate.fact().request().time_evidence,
            &envelope.clock,
        )?;
        Ok(PitSnapshotOwnerReadback::from_verified(&aggregate))
    }
}

struct StoredEnvelope {
    aggregate: Value,
    native: NativeIndex,
    clock: MarketDataClockAdmission,
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
        clock: decode_clock(row)?,
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
