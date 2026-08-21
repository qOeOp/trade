use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};

use crate::{
    ProtectedFeedbackFrontierReadbackV1, ProtectedFeedbackFrontierReceiptV1,
    ProtectedFeedbackResolutionV1, QualificationOwnerError, RdIndependenceBasisLocatorV1,
};

const CLOCK_EPOCH_V1: &str = "unix-epoch-ms-v1";
const PROJECTION_VALIDITY_MS: u64 = 600_000;
const PROJECTED_EVENT_KIND: &str = "QUALIFICATION_PROTECTED_FEEDBACK_PROJECTED_V1";

#[derive(Debug, Clone)]
pub struct PostgresQualificationOwnerV1 {
    pool: PgPool,
}

impl PostgresQualificationOwnerV1 {
    pub async fn connect(database_url: &str) -> Result<Self, QualificationOwnerError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(storage)?;
        let owner = Self { pool };
        owner.migrate().await?;
        Ok(owner)
    }

    async fn migrate(&self) -> Result<(), QualificationOwnerError> {
        for statement in [
            "CREATE TABLE IF NOT EXISTS qualification_protected_feedback_projections_v1 (projection_identity TEXT PRIMARY KEY, basis_identity TEXT NOT NULL UNIQUE, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, resolution_state TEXT NOT NULL, source_sequence BIGINT NOT NULL, source_cut TEXT NOT NULL, projection_digest TEXT NOT NULL, projection_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, valid_through_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS qualification_protected_feedback_heads_v1 (principal_scope_key TEXT PRIMARY KEY, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, frontier_identity TEXT NOT NULL UNIQUE REFERENCES qualification_protected_feedback_projections_v1(projection_identity), frontier_digest TEXT NOT NULL, source_sequence BIGINT NOT NULL, source_cut TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS qualification_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind))",
        ] {
            sqlx::query(statement)
                .execute(&self.pool)
                .await
                .map_err(storage)?;
        }
        Ok(())
    }

    /// Resolve the exact R&D basis and create at most one Qualification-owned
    /// projection for that basis. The locator is never treated as evidence.
    pub async fn resolve_or_create_for_basis(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
        read_cut_epoch_ms: u64,
    ) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let basis = load_rd_basis_in_transaction(&mut transaction, locator).await?;
        let principal_scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
        lock_principal_scope_in_transaction(&mut transaction, &principal_scope_key).await?;
        let history = verify_scope_history_in_transaction(
            &mut transaction,
            &basis.principal,
            &basis.request_scope,
            &principal_scope_key,
        )
        .await?;

        if let Some(existing) = history.projection_for_basis(&basis.basis_identity)? {
            verify_projection_freshness(existing, read_cut_epoch_ms)?;
            transaction.commit().await.map_err(storage)?;
            return Ok(existing.clone());
        }

        let (
            resolution,
            source_sequence,
            source_cut,
            source_frontier_identity,
            source_frontier_digest,
        ) = if let Some(head) = history.current_frontier.as_ref() {
            (
                ProtectedFeedbackResolutionV1::Frontier,
                head.source_sequence,
                head.source_cut.clone(),
                Some(head.projection_identity.clone()),
                Some(head.projection_digest.clone()),
            )
        } else {
            (
                ProtectedFeedbackResolutionV1::GenesisEmpty,
                0,
                "qualification-protected-feedback-cut-v1-0".to_string(),
                None,
                None,
            )
        };

        let projection = form_projection(
            &basis,
            resolution,
            source_sequence,
            source_cut,
            source_frontier_identity,
            source_frontier_digest,
            read_cut_epoch_ms,
        )?;
        persist_projection_in_transaction(
            &mut transaction,
            &projection,
            &principal_scope_key,
            resolution == ProtectedFeedbackResolutionV1::GenesisEmpty,
        )
        .await?;
        let verified_history = verify_scope_history_in_transaction(
            &mut transaction,
            &basis.principal,
            &basis.request_scope,
            &principal_scope_key,
        )
        .await?;
        let verified = verified_history
            .projection_for_basis(&basis.basis_identity)?
            .ok_or_else(|| unavailable("committed Qualification projection missing"))?;
        verify_projection_freshness(verified, read_cut_epoch_ms)?;
        let verified = verified.clone();
        transaction.commit().await.map_err(storage)?;
        Ok(verified)
    }

    pub async fn resolve_for_basis(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
        read_cut_epoch_ms: u64,
    ) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let projection =
            admit_projection_in_transaction(&mut transaction, locator, read_cut_epoch_ms).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(projection)
    }

    pub async fn admit_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        locator: &RdIndependenceBasisLocatorV1,
        read_cut_epoch_ms: u64,
    ) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
        admit_projection_in_transaction(transaction, locator, read_cut_epoch_ms).await
    }
}

/// Direct, locked Qualification Owner reread. The locator is never evidence;
/// only a sealed positive readback can leave this function.
pub async fn admit_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &RdIndependenceBasisLocatorV1,
    read_cut_epoch_ms: u64,
) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
    let basis = load_rd_basis_in_transaction(transaction, locator).await?;
    let principal_scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
    lock_principal_scope_in_transaction(transaction, &principal_scope_key).await?;
    let history = verify_scope_history_in_transaction(
        transaction,
        &basis.principal,
        &basis.request_scope,
        &principal_scope_key,
    )
    .await?;
    let projection = history.projection_for_basis(&basis.basis_identity)?;

    if let Some(projection) = projection {
        verify_projection_freshness(projection, read_cut_epoch_ms)?;
    }
    Ok(projection.cloned())
}

async fn admit_projection_row_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    row: &PgRow,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let row_basis_identity: String = row.try_get("basis_identity").map_err(storage)?;
    let basis = load_rd_basis_by_identity_in_transaction(transaction, &row_basis_identity).await?;
    let projection_json: serde_json::Value = row.try_get("projection_json").map_err(storage)?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let stored: StoredProjectionV1 = decode_exact(&projection_json)?;
    let receipt: StoredProjectionReceiptV1 = decode_exact(&receipt_json)?;
    let expected = form_projection(
        &basis,
        stored.resolution,
        stored.source_sequence,
        stored.source_cut.clone(),
        stored.source_frontier_identity.clone(),
        stored.source_frontier_digest.clone(),
        stored.projection_at_epoch_ms,
    )?;

    if expected.as_stored() != stored || expected.receipt_as_stored() != receipt {
        return Err(unavailable(
            "Qualification projection canonical meaning mismatch",
        ));
    }

    let row_scope: Vec<String> = decode_exact(
        &row.try_get::<serde_json::Value, _>("request_scope_json")
            .map_err(storage)?,
    )?;
    let row_sequence: i64 = row.try_get("source_sequence").map_err(storage)?;
    let row_committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let row_valid_through: i64 = row.try_get("valid_through_epoch_ms").map_err(storage)?;
    if row
        .try_get::<String, _>("projection_identity")
        .map_err(storage)?
        != expected.projection_identity
        || row
            .try_get::<String, _>("basis_identity")
            .map_err(storage)?
            != basis.basis_identity
        || row.try_get::<String, _>("principal").map_err(storage)? != basis.principal
        || row_scope != basis.request_scope
        || row
            .try_get::<String, _>("resolution_state")
            .map_err(storage)?
            != resolution_name(expected.resolution)
        || u64::try_from(row_sequence).map_err(json_storage)? != expected.source_sequence
        || row.try_get::<String, _>("source_cut").map_err(storage)? != expected.source_cut
        || row
            .try_get::<String, _>("projection_digest")
            .map_err(storage)?
            != expected.projection_digest
        || u64::try_from(row_committed_at).map_err(json_storage)?
            != expected.receipt.committed_at_epoch_ms
        || u64::try_from(row_valid_through).map_err(json_storage)?
            != expected.valid_through_epoch_ms
    {
        return Err(unavailable("Qualification projection row mismatch"));
    }

    Ok(expected)
}

#[derive(Debug)]
pub(crate) struct VerifiedScopeHistoryV1 {
    projections: Vec<ProtectedFeedbackFrontierReadbackV1>,
    current_frontier: Option<ProtectedFeedbackFrontierReadbackV1>,
}

impl VerifiedScopeHistoryV1 {
    fn projection_for_basis(
        &self,
        basis_identity: &str,
    ) -> Result<Option<&ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
        let mut matches = self
            .projections
            .iter()
            .filter(|projection| projection.basis_identity == basis_identity);
        let projection = matches.next();

        if matches.next().is_some() {
            return Err(unavailable("Qualification projection is ambiguous"));
        }
        Ok(projection)
    }
}

pub(crate) async fn lock_principal_scope_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    principal_scope_key: &str,
) -> Result<(), QualificationOwnerError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(principal_scope_key)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

pub(crate) async fn verify_scope_history_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    principal: &str,
    request_scope: &[String],
    principal_scope_key: &str,
) -> Result<VerifiedScopeHistoryV1, QualificationOwnerError> {
    let head_rows = sqlx::query("SELECT principal, request_scope_json, frontier_identity, frontier_digest, source_sequence, source_cut, committed_at_epoch_ms FROM qualification_protected_feedback_heads_v1 WHERE principal_scope_key = $1 FOR UPDATE")
        .bind(principal_scope_key)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if head_rows.len() > 1 {
        return Err(unavailable("Qualification feedback head is ambiguous"));
    }

    let projection_rows = sqlx::query("SELECT projection_identity, basis_identity, principal, request_scope_json, resolution_state, source_sequence, source_cut, projection_digest, projection_json, receipt_json, committed_at_epoch_ms, valid_through_epoch_ms FROM qualification_protected_feedback_projections_v1 ORDER BY projection_identity FOR SHARE")
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let mut all_projections = Vec::with_capacity(projection_rows.len());

    for row in &projection_rows {
        all_projections.push(admit_projection_row_in_transaction(transaction, row).await?);
    }

    let projection_identities = all_projections
        .iter()
        .map(|projection| projection.projection_identity.clone())
        .collect::<Vec<_>>();
    let outbox_rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM qualification_owner_outbox_v1 WHERE event_kind = $1 OR aggregate_identity = ANY($2) ORDER BY event_identity FOR SHARE")
        .bind(PROJECTED_EVENT_KIND)
        .bind(&projection_identities)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let mut outbox_aggregates = std::collections::BTreeSet::new();

    for row in &outbox_rows {
        let aggregate_identity: String = row.try_get("aggregate_identity").map_err(storage)?;
        let projection = all_projections
            .iter()
            .find(|projection| projection.projection_identity == aggregate_identity)
            .ok_or_else(|| unavailable("Qualification projection outbox is orphaned"))?;

        if !outbox_aggregates.insert(aggregate_identity) {
            return Err(unavailable("Qualification projection outbox is ambiguous"));
        }
        verify_outbox_row(row, projection)?;
    }

    if outbox_aggregates.len() != all_projections.len() {
        return Err(unavailable("Qualification projection outbox unavailable"));
    }

    let projections = all_projections
        .into_iter()
        .filter(|projection| {
            projection.principal == principal && projection.request_scope == request_scope
        })
        .collect::<Vec<_>>();
    let current_frontier = match head_rows.first() {
        Some(head) => Some(verify_head_row(
            head,
            principal,
            request_scope,
            &projections,
        )?),
        None if projections.is_empty() => None,
        None => {
            return Err(unavailable(
                "Qualification feedback history exists without a head",
            ));
        }
    };

    if let Some(frontier) = current_frontier.as_ref() {
        let mut visited = std::collections::BTreeSet::new();
        let mut cursor = frontier;
        loop {
            if !visited.insert(cursor.projection_identity.as_str()) {
                return Err(unavailable("Qualification projection history has a cycle"));
            }

            match cursor.resolution {
                ProtectedFeedbackResolutionV1::GenesisEmpty => {
                    if cursor.source_sequence != 0
                        || cursor.source_cut != "qualification-protected-feedback-cut-v1-0"
                        || cursor.source_frontier_identity.is_some()
                        || cursor.source_frontier_digest.is_some()
                    {
                        return Err(unavailable("Qualification genesis projection is malformed"));
                    }
                    break;
                }
                ProtectedFeedbackResolutionV1::Frontier => {
                    let predecessor_identity = cursor
                        .source_frontier_identity
                        .as_deref()
                        .ok_or_else(|| unavailable("Qualification frontier predecessor missing"))?;
                    let predecessor = projections
                        .iter()
                        .find(|projection| projection.projection_identity == predecessor_identity)
                        .ok_or_else(|| {
                            unavailable("Qualification frontier predecessor unavailable")
                        })?;

                    if cursor.source_frontier_digest.as_deref()
                        != Some(predecessor.projection_digest.as_str())
                        || cursor.source_sequence != predecessor.source_sequence
                        || cursor.source_cut != predecessor.source_cut
                    {
                        return Err(unavailable("Qualification frontier predecessor mismatch"));
                    }
                    cursor = predecessor;
                }
            }
        }

        if visited.len() != projections.len() {
            return Err(unavailable(
                "Qualification projection history has an orphan or duplicate branch",
            ));
        }
    }

    Ok(VerifiedScopeHistoryV1 {
        projections,
        current_frontier,
    })
}

fn verify_projection_freshness(
    projection: &ProtectedFeedbackFrontierReadbackV1,
    read_cut_epoch_ms: u64,
) -> Result<(), QualificationOwnerError> {
    if read_cut_epoch_ms < projection.projection_at_epoch_ms
        || read_cut_epoch_ms >= projection.valid_through_epoch_ms
    {
        return Err(unavailable("Qualification projection is stale"));
    }
    Ok(())
}

pub(crate) async fn load_rd_basis_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &RdIndependenceBasisLocatorV1,
) -> Result<StoredRdBasisV1, QualificationOwnerError> {
    let basis =
        load_rd_basis_by_identity_in_transaction(transaction, &locator.basis_identity).await?;

    if locator.basis_identity != basis.basis_identity
        || locator.basis_digest != basis.basis_digest
        || locator.request_identity != basis.request_identity
        || locator.principal != basis.principal
        || locator.request_scope != basis.request_scope
    {
        return Err(unavailable("R&D Independence Basis locator mismatch"));
    }
    Ok(basis)
}

async fn load_rd_basis_by_identity_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    basis_identity: &str,
) -> Result<StoredRdBasisV1, QualificationOwnerError> {
    let rows = sqlx::query("SELECT basis_identity, request_identity, principal, request_scope_json, lineage_digest, basis_digest, basis_json, receipt_json, committed_at_epoch_ms FROM rd_independence_bases_v1 WHERE basis_identity = $1 FOR SHARE")
        .bind(basis_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(unavailable("R&D Independence Basis unavailable"));
    }
    let row = &rows[0];
    let basis_json: serde_json::Value = row.try_get("basis_json").map_err(storage)?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let basis: StoredRdBasisV1 = decode_exact(&basis_json)?;
    let receipt: StoredRdBasisReceiptV1 = decode_exact(&receipt_json)?;
    verify_rd_basis(&basis, &receipt)?;
    let row_scope: Vec<String> = decode_exact(
        &row.try_get::<serde_json::Value, _>("request_scope_json")
            .map_err(storage)?,
    )?;
    let committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    if row
        .try_get::<String, _>("basis_identity")
        .map_err(storage)?
        != basis.basis_identity
        || row
            .try_get::<String, _>("request_identity")
            .map_err(storage)?
            != basis.request_identity
        || row.try_get::<String, _>("principal").map_err(storage)? != basis.principal
        || row_scope != basis.request_scope
        || row
            .try_get::<String, _>("lineage_digest")
            .map_err(storage)?
            != basis.lineage_digest
        || row.try_get::<String, _>("basis_digest").map_err(storage)? != basis.basis_digest
        || u64::try_from(committed_at).map_err(json_storage)? != receipt.committed_at_epoch_ms
        || basis_identity != basis.basis_identity
    {
        return Err(unavailable("R&D Independence Basis row mismatch"));
    }
    verify_rd_basis_outbox(transaction, &basis, &receipt).await?;
    Ok(basis)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RdBasisOutboxPayloadV1 {
    schema_version: u32,
    basis_identity: String,
    basis_digest: String,
    receipt_identity: String,
    principal: String,
    request_scope: Vec<String>,
    lineage_digest: String,
}

async fn verify_rd_basis_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    basis: &StoredRdBasisV1,
    receipt: &StoredRdBasisReceiptV1,
) -> Result<(), QualificationOwnerError> {
    let rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = 'INDEPENDENCE_BASIS_PRECOMMITTED_V1' FOR SHARE")
        .bind(&basis.basis_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(unavailable("R&D Independence Basis outbox unavailable"));
    }
    let row = &rows[0];
    let payload: RdBasisOutboxPayloadV1 = decode_exact(
        &row.try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?,
    )?;
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;
    let committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;

    if payload.schema_version != 1
        || payload.basis_identity != basis.basis_identity
        || payload.basis_digest != basis.basis_digest
        || payload.receipt_identity != receipt.receipt_identity
        || payload.principal != basis.principal
        || payload.request_scope != basis.request_scope
        || payload.lineage_digest != basis.lineage_digest
        || row
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != identity("rd-owner-event-v1", &payload_digest)
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != basis.basis_identity
        || row.try_get::<String, _>("event_kind").map_err(storage)?
            != "INDEPENDENCE_BASIS_PRECOMMITTED_V1"
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || u64::try_from(committed_at).map_err(json_storage)? != receipt.committed_at_epoch_ms
    {
        return Err(unavailable("R&D Independence Basis outbox mismatch"));
    }
    Ok(())
}

async fn persist_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    projection: &ProtectedFeedbackFrontierReadbackV1,
    principal_scope_key: &str,
    is_genesis: bool,
) -> Result<(), QualificationOwnerError> {
    let projection_json = serde_json::to_value(projection.as_stored()).map_err(json_storage)?;
    let receipt_json =
        serde_json::to_value(projection.receipt_as_stored()).map_err(json_storage)?;
    sqlx::query("INSERT INTO qualification_protected_feedback_projections_v1 (projection_identity, basis_identity, principal, request_scope_json, resolution_state, source_sequence, source_cut, projection_digest, projection_json, receipt_json, committed_at_epoch_ms, valid_through_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(&projection.projection_identity)
        .bind(&projection.basis_identity)
        .bind(&projection.principal)
        .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
        .bind(resolution_name(projection.resolution))
        .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
        .bind(&projection.source_cut)
        .bind(&projection.projection_digest)
        .bind(&projection_json)
        .bind(receipt_json)
        .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
        .bind(i64::try_from(projection.valid_through_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    if is_genesis {
        sqlx::query("INSERT INTO qualification_protected_feedback_heads_v1 (principal_scope_key, principal, request_scope_json, frontier_identity, frontier_digest, source_sequence, source_cut, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(principal_scope_key)
            .bind(&projection.principal)
            .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
            .bind(&projection.projection_identity)
            .bind(&projection.projection_digest)
            .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
            .bind(&projection.source_cut)
            .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;
    } else {
        let predecessor_identity = projection
            .source_frontier_identity
            .as_deref()
            .ok_or_else(|| unavailable("Qualification frontier predecessor missing"))?;
        let predecessor_digest = projection
            .source_frontier_digest
            .as_deref()
            .ok_or_else(|| unavailable("Qualification frontier predecessor digest missing"))?;
        let updated = sqlx::query("UPDATE qualification_protected_feedback_heads_v1 SET principal = $1, request_scope_json = $2, frontier_identity = $3, frontier_digest = $4, source_sequence = $5, source_cut = $6, committed_at_epoch_ms = $7 WHERE principal_scope_key = $8 AND frontier_identity = $9 AND frontier_digest = $10")
            .bind(&projection.principal)
            .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
            .bind(&projection.projection_identity)
            .bind(&projection.projection_digest)
            .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
            .bind(&projection.source_cut)
            .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
            .bind(principal_scope_key)
            .bind(predecessor_identity)
            .bind(predecessor_digest)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(unavailable("Qualification feedback head changed"));
        }
    }

    let payload_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;
    let event_identity = identity("qualification-owner-event-v1", &payload_digest);
    sqlx::query("INSERT INTO qualification_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity)
        .bind(&projection.projection_identity)
        .bind(PROJECTED_EVENT_KIND)
        .bind(payload_digest)
        .bind(projection_json)
        .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

fn verify_head_row(
    row: &PgRow,
    principal: &str,
    request_scope: &[String],
    projections: &[ProtectedFeedbackFrontierReadbackV1],
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let scope: Vec<String> = decode_exact(
        &row.try_get::<serde_json::Value, _>("request_scope_json")
            .map_err(storage)?,
    )?;
    let frontier_identity: String = row.try_get("frontier_identity").map_err(storage)?;
    let mut matching = projections
        .iter()
        .filter(|projection| projection.projection_identity == frontier_identity);
    let projection = matching
        .next()
        .ok_or_else(|| unavailable("Qualification feedback head projection unavailable"))?;

    if matching.next().is_some() {
        return Err(unavailable(
            "Qualification feedback head projection is ambiguous",
        ));
    }
    let sequence: i64 = row.try_get("source_sequence").map_err(storage)?;
    let committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;

    if row.try_get::<String, _>("principal").map_err(storage)? != principal
        || scope != request_scope
        || projection.principal != principal
        || projection.request_scope != request_scope
        || row
            .try_get::<String, _>("frontier_digest")
            .map_err(storage)?
            != projection.projection_digest
        || u64::try_from(sequence).map_err(json_storage)? != projection.source_sequence
        || row.try_get::<String, _>("source_cut").map_err(storage)? != projection.source_cut
        || u64::try_from(committed_at).map_err(json_storage)?
            != projection.receipt.committed_at_epoch_ms
    {
        return Err(unavailable("Qualification feedback head mismatch"));
    }
    Ok(projection.clone())
}

fn verify_outbox_row(
    row: &PgRow,
    projection: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    let projection_json = serde_json::to_value(projection.as_stored()).map_err(json_storage)?;
    let payload_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;
    let committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    if row
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != identity("qualification-owner-event-v1", &payload_digest)
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != projection.projection_identity
        || row.try_get::<String, _>("event_kind").map_err(storage)? != PROJECTED_EVENT_KIND
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != projection_json
        || u64::try_from(committed_at).map_err(json_storage)?
            != projection.receipt.committed_at_epoch_ms
    {
        return Err(unavailable("Qualification projection outbox mismatch"));
    }
    Ok(())
}

fn form_projection(
    basis: &StoredRdBasisV1,
    resolution: ProtectedFeedbackResolutionV1,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    now_epoch_ms: u64,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    form_projection_for_basis(
        &basis.principal,
        &basis.request_scope,
        &basis.basis_identity,
        &basis.basis_digest,
        resolution,
        source_sequence,
        source_cut,
        source_frontier_identity,
        source_frontier_digest,
        now_epoch_ms,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn form_projection_for_basis(
    principal: &str,
    request_scope: &[String],
    basis_identity: &str,
    basis_digest: &str,
    resolution: ProtectedFeedbackResolutionV1,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    now_epoch_ms: u64,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let meaning = ProjectionMeaningV1 {
        schema_version: 1,
        resolution,
        principal,
        request_scope,
        basis_identity,
        basis_digest,
        source_sequence,
        source_cut: &source_cut,
        source_frontier_identity: source_frontier_identity.as_deref(),
        source_frontier_digest: source_frontier_digest.as_deref(),
        clock_epoch: CLOCK_EPOCH_V1,
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(PROJECTION_VALIDITY_MS),
    };
    let projection_digest =
        canonical_digest("qualification.protected-feedback-frontier.v1", &meaning)?;
    let projection_identity = identity(
        "qualification-protected-feedback-frontier-v1",
        &projection_digest,
    );
    let receipt_meaning = ProjectionReceiptMeaningV1 {
        schema_version: 1,
        projection_identity: &projection_identity,
        projection_digest: &projection_digest,
        committed_at_epoch_ms: now_epoch_ms,
    };
    let receipt_digest = canonical_digest(
        "qualification.protected-feedback-frontier-receipt.v1",
        &receipt_meaning,
    )?;
    Ok(ProtectedFeedbackFrontierReadbackV1 {
        schema_version: 1,
        projection_identity: projection_identity.clone(),
        projection_digest: projection_digest.clone(),
        resolution,
        principal: principal.to_string(),
        request_scope: request_scope.to_vec(),
        basis_identity: basis_identity.to_string(),
        basis_digest: basis_digest.to_string(),
        source_sequence,
        source_cut,
        source_frontier_identity,
        source_frontier_digest,
        clock_epoch: CLOCK_EPOCH_V1.to_string(),
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(PROJECTION_VALIDITY_MS),
        receipt: ProtectedFeedbackFrontierReceiptV1 {
            schema_version: 1,
            receipt_identity: identity(
                "qualification-protected-feedback-frontier-receipt-v1",
                &receipt_digest,
            ),
            projection_identity,
            projection_digest,
            committed_at_epoch_ms: now_epoch_ms,
        },
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredRdBasisV1 {
    pub(crate) schema_version: u32,
    pub(crate) basis_identity: String,
    pub(crate) request_identity: String,
    pub(crate) principal: String,
    pub(crate) request_scope: Vec<String>,
    pub(crate) rationale_digest: String,
    pub(crate) independence_disposition: StoredIndependenceDispositionV1,
    pub(crate) lineage_resolution: StoredLineageResolutionV1,
    pub(crate) semantic_predecessor_frontier: Vec<String>,
    pub(crate) lineage_digest: String,
    pub(crate) basis_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum StoredIndependenceDispositionV1 {
    Independent,
    Related,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum StoredLineageResolutionV1 {
    GenesisEmpty,
    CompleteFrontier,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredRdBasisReceiptV1 {
    pub(crate) schema_version: u32,
    pub(crate) receipt_identity: String,
    pub(crate) basis_identity: String,
    pub(crate) basis_digest: String,
    pub(crate) committed_at_epoch_ms: u64,
}

fn verify_rd_basis(
    basis: &StoredRdBasisV1,
    receipt: &StoredRdBasisReceiptV1,
) -> Result<(), QualificationOwnerError> {
    let meaning = RdBasisMeaningV1 {
        schema_version: basis.schema_version,
        request_identity: &basis.request_identity,
        principal: &basis.principal,
        request_scope: &basis.request_scope,
        rationale_digest: &basis.rationale_digest,
        independence_disposition: &basis.independence_disposition,
        lineage_resolution: &basis.lineage_resolution,
        semantic_predecessor_frontier: &basis.semantic_predecessor_frontier,
        lineage_digest: &basis.lineage_digest,
    };
    let digest = canonical_digest("rd.independence-basis.v1", &meaning)?;
    let receipt_meaning = RdBasisReceiptMeaningV1 {
        schema_version: 1,
        basis_identity: &basis.basis_identity,
        basis_digest: &basis.basis_digest,
        committed_at_epoch_ms: receipt.committed_at_epoch_ms,
    };
    let receipt_digest = canonical_digest("rd.independence-basis-receipt.v1", &receipt_meaning)?;
    if basis.schema_version != 1
        || basis.basis_digest != digest
        || basis.basis_identity != identity("rd-independence-basis-v1", &digest)
        || receipt.schema_version != 1
        || receipt.basis_identity != basis.basis_identity
        || receipt.basis_digest != basis.basis_digest
        || receipt.receipt_identity != identity("rd-independence-basis-receipt-v1", &receipt_digest)
        || matches!(
            basis.lineage_resolution,
            StoredLineageResolutionV1::GenesisEmpty
        ) != basis.semantic_predecessor_frontier.is_empty()
        || matches!(
            basis.independence_disposition,
            StoredIndependenceDispositionV1::Independent
        ) != basis.semantic_predecessor_frontier.is_empty()
    {
        return Err(unavailable("R&D Independence Basis canonical mismatch"));
    }
    Ok(())
}

#[derive(Serialize)]
struct RdBasisMeaningV1<'a> {
    schema_version: u32,
    request_identity: &'a str,
    principal: &'a str,
    request_scope: &'a [String],
    rationale_digest: &'a str,
    independence_disposition: &'a StoredIndependenceDispositionV1,
    lineage_resolution: &'a StoredLineageResolutionV1,
    semantic_predecessor_frontier: &'a [String],
    lineage_digest: &'a str,
}

#[derive(Serialize)]
struct RdBasisReceiptMeaningV1<'a> {
    schema_version: u32,
    basis_identity: &'a str,
    basis_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ProjectionMeaningV1<'a> {
    schema_version: u32,
    resolution: ProtectedFeedbackResolutionV1,
    principal: &'a str,
    request_scope: &'a [String],
    basis_identity: &'a str,
    basis_digest: &'a str,
    source_sequence: u64,
    source_cut: &'a str,
    source_frontier_identity: Option<&'a str>,
    source_frontier_digest: Option<&'a str>,
    clock_epoch: &'a str,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[derive(Serialize)]
struct ProjectionReceiptMeaningV1<'a> {
    schema_version: u32,
    projection_identity: &'a str,
    projection_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProjectionV1 {
    schema_version: u32,
    projection_identity: String,
    projection_digest: String,
    resolution: ProtectedFeedbackResolutionV1,
    principal: String,
    request_scope: Vec<String>,
    basis_identity: String,
    basis_digest: String,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    clock_epoch: String,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProjectionReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    projection_identity: String,
    projection_digest: String,
    committed_at_epoch_ms: u64,
}

impl ProtectedFeedbackFrontierReadbackV1 {
    pub(crate) fn as_stored(&self) -> StoredProjectionV1 {
        StoredProjectionV1 {
            schema_version: self.schema_version,
            projection_identity: self.projection_identity.clone(),
            projection_digest: self.projection_digest.clone(),
            resolution: self.resolution,
            principal: self.principal.clone(),
            request_scope: self.request_scope.clone(),
            basis_identity: self.basis_identity.clone(),
            basis_digest: self.basis_digest.clone(),
            source_sequence: self.source_sequence,
            source_cut: self.source_cut.clone(),
            source_frontier_identity: self.source_frontier_identity.clone(),
            source_frontier_digest: self.source_frontier_digest.clone(),
            clock_epoch: self.clock_epoch.clone(),
            projection_at_epoch_ms: self.projection_at_epoch_ms,
            valid_through_epoch_ms: self.valid_through_epoch_ms,
        }
    }

    pub(crate) fn receipt_as_stored(&self) -> StoredProjectionReceiptV1 {
        StoredProjectionReceiptV1 {
            schema_version: self.receipt.schema_version,
            receipt_identity: self.receipt.receipt_identity.clone(),
            projection_identity: self.receipt.projection_identity.clone(),
            projection_digest: self.receipt.projection_digest.clone(),
            committed_at_epoch_ms: self.receipt.committed_at_epoch_ms,
        }
    }
}

pub(crate) fn resolution_name(value: ProtectedFeedbackResolutionV1) -> &'static str {
    match value {
        ProtectedFeedbackResolutionV1::GenesisEmpty => "GENESIS_EMPTY",
        ProtectedFeedbackResolutionV1::Frontier => "FRONTIER",
    }
}

pub(crate) fn principal_scope_key(
    principal: &str,
    request_scope: &[String],
) -> Result<String, QualificationOwnerError> {
    canonical_digest(
        "qualification.principal-request-scope.v1",
        &(principal, request_scope),
    )
}

pub(crate) fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, QualificationOwnerError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(json_storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub(crate) fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

pub(crate) fn decode_exact<T>(value: &serde_json::Value) -> Result<T, QualificationOwnerError>
where
    T: serde::de::DeserializeOwned + Serialize,
{
    let decoded: T = serde_json::from_value(value.clone()).map_err(json_storage)?;
    if serde_json::to_value(&decoded).map_err(json_storage)? != *value {
        return Err(unavailable("stored JSON is not canonical for its schema"));
    }
    Ok(decoded)
}

#[allow(clippy::needless_pass_by_value)] // exact `map_err` adapter keeps every SQL boundary uniform
fn storage(error: sqlx::Error) -> QualificationOwnerError {
    unavailable(error.to_string())
}

fn json_storage(error: impl Display) -> QualificationOwnerError {
    unavailable(error.to_string())
}

fn unavailable(error: impl Into<String>) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(error.into())
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    #[ignore = "requires RD_OWNER_TEST_DATABASE_URL or RD_OWNER_DATABASE_URL"]
    async fn genesis_projection_replays_and_outbox_corruption_fails_closed_until_restored() {
        let database_url = std::env::var("RD_OWNER_TEST_DATABASE_URL")
            .ok()
            .or_else(|| std::env::var("RD_OWNER_DATABASE_URL").ok())
            .expect("database-backed test requires Owner database URL");
        let owner = PostgresQualificationOwnerV1::connect(&database_url)
            .await
            .unwrap();

        for statement in [
            "CREATE TABLE IF NOT EXISTS rd_independence_bases_v1 (basis_identity TEXT PRIMARY KEY, request_identity TEXT NOT NULL UNIQUE, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, lineage_digest TEXT NOT NULL, basis_digest TEXT NOT NULL, basis_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind))",
        ] {
            sqlx::query(statement).execute(&owner.pool).await.unwrap();
        }
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let now = u64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis(),
        )
        .unwrap();
        let request_identity = format!("qualification-test-request-{suffix}");
        let principal = format!("qualification-test-principal-{suffix}");
        let request_scope = vec!["research:submit".to_string(), "research:view".to_string()];
        let lineage_digest = canonical_digest(
            "rd.semantic-predecessor-frontier.v1",
            &(
                &principal,
                &request_scope,
                "GENESIS_EMPTY",
                Vec::<String>::new(),
            ),
        )
        .unwrap();
        let rationale_digest =
            canonical_digest("rd.independence-rationale.v1", &"bounded test rationale").unwrap();
        let mut basis = StoredRdBasisV1 {
            schema_version: 1,
            basis_identity: String::new(),
            request_identity: request_identity.clone(),
            principal: principal.clone(),
            request_scope: request_scope.clone(),
            rationale_digest,
            independence_disposition: StoredIndependenceDispositionV1::Independent,
            lineage_resolution: StoredLineageResolutionV1::GenesisEmpty,
            semantic_predecessor_frontier: vec![],
            lineage_digest,
            basis_digest: String::new(),
        };
        basis.basis_digest = canonical_digest(
            "rd.independence-basis.v1",
            &RdBasisMeaningV1 {
                schema_version: 1,
                request_identity: &basis.request_identity,
                principal: &basis.principal,
                request_scope: &basis.request_scope,
                rationale_digest: &basis.rationale_digest,
                independence_disposition: &basis.independence_disposition,
                lineage_resolution: &basis.lineage_resolution,
                semantic_predecessor_frontier: &basis.semantic_predecessor_frontier,
                lineage_digest: &basis.lineage_digest,
            },
        )
        .unwrap();
        basis.basis_identity = identity("rd-independence-basis-v1", &basis.basis_digest);
        let receipt_digest = canonical_digest(
            "rd.independence-basis-receipt.v1",
            &RdBasisReceiptMeaningV1 {
                schema_version: 1,
                basis_identity: &basis.basis_identity,
                basis_digest: &basis.basis_digest,
                committed_at_epoch_ms: now,
            },
        )
        .unwrap();
        let receipt = StoredRdBasisReceiptV1 {
            schema_version: 1,
            receipt_identity: identity("rd-independence-basis-receipt-v1", &receipt_digest),
            basis_identity: basis.basis_identity.clone(),
            basis_digest: basis.basis_digest.clone(),
            committed_at_epoch_ms: now,
        };
        let payload = RdBasisOutboxPayloadV1 {
            schema_version: 1,
            basis_identity: basis.basis_identity.clone(),
            basis_digest: basis.basis_digest.clone(),
            receipt_identity: receipt.receipt_identity.clone(),
            principal: principal.clone(),
            request_scope: request_scope.clone(),
            lineage_digest: basis.lineage_digest.clone(),
        };
        let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload).unwrap();
        sqlx::query("INSERT INTO rd_independence_bases_v1 (basis_identity,request_identity,principal,request_scope_json,lineage_digest,basis_digest,basis_json,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(&basis.basis_identity).bind(&request_identity).bind(&principal)
            .bind(serde_json::to_value(&request_scope).unwrap()).bind(&basis.lineage_digest)
            .bind(&basis.basis_digest).bind(serde_json::to_value(&basis).unwrap())
            .bind(serde_json::to_value(&receipt).unwrap()).bind(i64::try_from(now).unwrap())
            .execute(&owner.pool).await.unwrap();
        sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'INDEPENDENCE_BASIS_PRECOMMITTED_V1',$3,$4,$5)")
            .bind(identity("rd-owner-event-v1", &payload_digest)).bind(&basis.basis_identity)
            .bind(&payload_digest).bind(serde_json::to_value(&payload).unwrap()).bind(i64::try_from(now).unwrap())
            .execute(&owner.pool).await.unwrap();
        let locator = RdIndependenceBasisLocatorV1 {
            basis_identity: basis.basis_identity.clone(),
            basis_digest: basis.basis_digest.clone(),
            request_identity,
            principal,
            request_scope,
        };
        let first = owner
            .resolve_or_create_for_basis(&locator, now)
            .await
            .unwrap();
        assert_eq!(
            first.resolution(),
            ProtectedFeedbackResolutionV1::GenesisEmpty
        );
        assert_eq!(
            owner.resolve_for_basis(&locator, now).await.unwrap(),
            Some(first.clone())
        );
        let scope_key = principal_scope_key(&locator.principal, &locator.request_scope).unwrap();
        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE principal_scope_key = $1",
        )
        .bind(&scope_key)
        .execute(&owner.pool)
        .await
        .unwrap();
        assert!(owner.resolve_for_basis(&locator, now).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1",
            )
            .bind(first.projection_identity())
            .fetch_one(&owner.pool)
            .await
            .unwrap(),
            1
        );
        sqlx::query("INSERT INTO qualification_protected_feedback_heads_v1 (principal_scope_key,principal,request_scope_json,frontier_identity,frontier_digest,source_sequence,source_cut,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&scope_key).bind(first.principal())
            .bind(serde_json::to_value(first.request_scope()).unwrap())
            .bind(first.projection_identity()).bind(first.projection_digest())
            .bind(i64::try_from(first.source_sequence()).unwrap()).bind(first.source_cut())
            .bind(i64::try_from(first.receipt().committed_at_epoch_ms()).unwrap())
            .execute(&owner.pool).await.unwrap();
        assert_eq!(
            owner.resolve_for_basis(&locator, now).await.unwrap(),
            Some(first.clone())
        );

        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE principal_scope_key = $1",
        )
        .bind(&scope_key)
        .execute(&owner.pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1")
            .bind(first.projection_identity()).execute(&owner.pool).await.unwrap();
        assert!(owner.resolve_for_basis(&locator, now).await.is_err());
        let stored = first.as_stored();
        sqlx::query("INSERT INTO qualification_protected_feedback_projections_v1 (projection_identity,basis_identity,principal,request_scope_json,resolution_state,source_sequence,source_cut,projection_digest,projection_json,receipt_json,committed_at_epoch_ms,valid_through_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(first.projection_identity()).bind(first.basis_identity()).bind(first.principal())
            .bind(serde_json::to_value(first.request_scope()).unwrap()).bind(resolution_name(first.resolution()))
            .bind(i64::try_from(first.source_sequence()).unwrap()).bind(first.source_cut()).bind(first.projection_digest())
            .bind(serde_json::to_value(&stored).unwrap()).bind(serde_json::to_value(first.receipt_as_stored()).unwrap())
            .bind(i64::try_from(first.receipt().committed_at_epoch_ms()).unwrap())
            .bind(i64::try_from(first.valid_through_epoch_ms()).unwrap())
            .execute(&owner.pool).await.unwrap();
        sqlx::query("INSERT INTO qualification_protected_feedback_heads_v1 (principal_scope_key,principal,request_scope_json,frontier_identity,frontier_digest,source_sequence,source_cut,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&scope_key).bind(first.principal()).bind(serde_json::to_value(first.request_scope()).unwrap())
            .bind(first.projection_identity()).bind(first.projection_digest()).bind(i64::try_from(first.source_sequence()).unwrap())
            .bind(first.source_cut()).bind(i64::try_from(first.receipt().committed_at_epoch_ms()).unwrap())
            .execute(&owner.pool).await.unwrap();
        assert_eq!(
            owner.resolve_for_basis(&locator, now).await.unwrap(),
            Some(first.clone())
        );

        sqlx::query("INSERT INTO qualification_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'TAMPERED_KIND',$3,$4,$5)")
            .bind(format!("qualification-test-extra-event-{suffix}"))
            .bind(first.projection_identity()).bind("sha256:tampered")
            .bind(serde_json::json!({"tampered": true}))
            .bind(i64::try_from(now).unwrap()).execute(&owner.pool).await.unwrap();
        assert!(owner.resolve_for_basis(&locator, now).await.is_err());
        sqlx::query("DELETE FROM qualification_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = 'TAMPERED_KIND'")
            .bind(first.projection_identity()).execute(&owner.pool).await.unwrap();
        assert_eq!(
            owner.resolve_for_basis(&locator, now).await.unwrap(),
            Some(first.clone())
        );
        sqlx::query("UPDATE rd_owner_outbox_v1 SET payload_digest = 'sha256:corrupt' WHERE aggregate_identity = $1")
            .bind(&basis.basis_identity).execute(&owner.pool).await.unwrap();
        assert!(owner.resolve_for_basis(&locator, now).await.is_err());
        sqlx::query(
            "UPDATE rd_owner_outbox_v1 SET payload_digest = $1 WHERE aggregate_identity = $2",
        )
        .bind(&payload_digest)
        .bind(&basis.basis_identity)
        .execute(&owner.pool)
        .await
        .unwrap();
        assert_eq!(
            owner.resolve_for_basis(&locator, now).await.unwrap(),
            Some(first.clone())
        );
        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE frontier_identity = $1",
        )
        .bind(first.projection_identity())
        .execute(&owner.pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM qualification_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(first.projection_identity())
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1").bind(first.projection_identity()).execute(&owner.pool).await.unwrap();
        sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(&basis.basis_identity)
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_independence_bases_v1 WHERE basis_identity = $1")
            .bind(&basis.basis_identity)
            .execute(&owner.pool)
            .await
            .unwrap();
    }
}
