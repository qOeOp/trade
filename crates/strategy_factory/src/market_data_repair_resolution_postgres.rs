//! Append-only PostgreSQL custody for R&D's Market Data repair terminal.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;

use crate::iteration_decision::IterationDecisionEvidenceCutV1;
use crate::market_data_repair_resolution::{
    MarketDataRepairResearchTerminalV1, MarketDataRepairResolutionDispositionV1,
    MarketDataRepairResolutionErrorV1,
};
use vibe_data::owner::pit_snapshot::UntrustedPitSnapshotTimeEvidence;
use vibe_data::owner::source_binding::BindingDigest;

const RESOLVED_EVENT_V1: &str = "MARKET_DATA_REPAIR_RESOLVED_V1";
const RESOLUTION_DOMAIN_V1: &str = "rd.market-data-repair-resolution.v1";
const STORAGE_DOMAIN_V1: &str = "rd.market-data-repair-resolution.storage.v1";
const OUTBOX_DOMAIN_V1: &str = "rd.owner-outbox.market-data-repair-resolution.v1";

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_market_data_repair_resolutions_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("resolution_identity", "text"),
            crate::schema_materialization::required("repair_request_identity", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("market_data_terminal_identity", "text"),
            crate::schema_materialization::required("market_data_terminal_digest", "text"),
            crate::schema_materialization::required("resolution_digest", "text"),
            crate::schema_materialization::required("disposition", "text"),
            crate::schema_materialization::required("resolution_json", "jsonb"),
            crate::schema_materialization::required("resolution_storage_bytes", "bytea"),
            crate::schema_materialization::required("resolution_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:repair_request_identity:public.rd_market_data_repair_requests_v1(request_identity):a:a:s:false:false:true:",
            "p:resolution_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
            "u:market_data_terminal_identity:::false:false:true:",
            "u:repair_request_identity:::false:false:true:",
            "u:resolution_digest:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("resolution_identity"),
            crate::schema_materialization::unique_index("repair_request_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
            crate::schema_materialization::unique_index("market_data_terminal_identity"),
            crate::schema_materialization::unique_index("resolution_digest"),
        ],
    },
];

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarketDataRepairResolutionLocatorV1 {
    pub resolution_identity: String,
    pub repair_request_identity: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct MarketDataRepairResolutionReadbackV1 {
    resolution: MarketDataRepairResearchTerminalV1,
    committed_at_epoch_ms: u64,
}

/// Move-only positive projection reconstructed exclusively from verified R&D Owner storage.
///
/// It intentionally cannot be deserialized by a caller. The canonical bytes are retained so the
/// successor write transaction can re-admit the same resolution before it appends Replay custody.
#[derive(Debug, Eq, PartialEq)]
pub(crate) struct MarketDataRepairResolutionReentryReadbackV1 {
    resolution_identity: String,
    resolution_digest: String,
    decision_identity: String,
    decision_evidence_cut: IterationDecisionEvidenceCutV1,
    repair_request_identity: String,
    repair_request_digest: String,
    market_data_terminal_identity: String,
    market_data_terminal_digest: String,
    correlation_identity: BindingDigest,
    repaired_snapshot_identity: BindingDigest,
    repaired_normalized_records_digest: BindingDigest,
    canonical_resolution_bytes: Vec<u8>,
    committed_at_epoch_ms: u64,
}

impl MarketDataRepairResolutionReentryReadbackV1 {
    pub(crate) fn resolution_identity(&self) -> &str {
        &self.resolution_identity
    }
    pub(crate) fn resolution_digest(&self) -> &str {
        &self.resolution_digest
    }
    pub(crate) fn decision_identity(&self) -> &str {
        &self.decision_identity
    }
    pub(crate) const fn decision_evidence_cut(&self) -> &IterationDecisionEvidenceCutV1 {
        &self.decision_evidence_cut
    }
    pub(crate) fn repair_request_identity(&self) -> &str {
        &self.repair_request_identity
    }
    pub(crate) fn repair_request_digest(&self) -> &str {
        &self.repair_request_digest
    }
    pub(crate) fn market_data_terminal_identity(&self) -> &str {
        &self.market_data_terminal_identity
    }
    pub(crate) fn market_data_terminal_digest(&self) -> &str {
        &self.market_data_terminal_digest
    }
    pub(crate) const fn correlation_identity(&self) -> BindingDigest {
        self.correlation_identity
    }
    pub(crate) const fn repaired_snapshot_identity(&self) -> BindingDigest {
        self.repaired_snapshot_identity
    }
    pub(crate) const fn repaired_normalized_records_digest(&self) -> BindingDigest {
        self.repaired_normalized_records_digest
    }
    pub(crate) fn canonical_resolution_bytes(&self) -> &[u8] {
        &self.canonical_resolution_bytes
    }
    pub(crate) const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredResolutionProjectionV1 {
    schema_version: u16,
    resolution_identity: String,
    resolution_digest: String,
    disposition: String,
    decision_identity: String,
    decision_digest: String,
    decision_evidence_cut: IterationDecisionEvidenceCutV1,
    action_request_identity: String,
    action_request_digest: String,
    repair_request_identity: String,
    repair_request_digest: String,
    repair_request_receipt_identity: String,
    repair_request_receipt_digest: String,
    market_data_terminal_identity: String,
    market_data_terminal_digest: String,
    correlation_identity: BindingDigest,
    result_time_evidence: UntrustedPitSnapshotTimeEvidence,
    repaired: Option<StoredRepairedSnapshotV1>,
    unavailable_basis: Option<String>,
    blockers: Vec<String>,
    stop_reason: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredRepairedSnapshotV1 {
    snapshot_identity: BindingDigest,
    normalized_records_digest: BindingDigest,
}

#[derive(Serialize)]
struct StoredResolutionMeaningV1<'a> {
    schema_version: u16,
    disposition: &'a str,
    decision_identity: &'a str,
    decision_digest: &'a str,
    decision_evidence_cut: &'a IterationDecisionEvidenceCutV1,
    action_request_identity: &'a str,
    action_request_digest: &'a str,
    repair_request_identity: &'a str,
    repair_request_digest: &'a str,
    repair_request_receipt_identity: &'a str,
    repair_request_receipt_digest: &'a str,
    market_data_terminal_identity: &'a str,
    market_data_terminal_digest: &'a str,
    correlation_identity: BindingDigest,
    result_time_evidence: &'a UntrustedPitSnapshotTimeEvidence,
    repaired: Option<&'a StoredRepairedSnapshotV1>,
    unavailable_basis: Option<&'a str>,
    blockers: &'a [String],
    stop_reason: Option<&'a str>,
}

impl MarketDataRepairResolutionReadbackV1 {
    #[must_use]
    pub const fn resolution(&self) -> &MarketDataRepairResearchTerminalV1 {
        &self.resolution
    }

    #[must_use]
    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }

    pub(crate) fn into_resolution(self) -> MarketDataRepairResearchTerminalV1 {
        self.resolution
    }

    #[cfg(test)]
    pub(crate) const fn for_test(
        resolution: MarketDataRepairResearchTerminalV1,
        committed_at_epoch_ms: u64,
    ) -> Self {
        Self {
            resolution,
            committed_at_epoch_ms,
        }
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum MarketDataRepairResolutionPostgresErrorV1 {
    #[error("Market Data repair resolution locator is invalid")]
    InvalidLocator,
    #[error("a different Market Data repair resolution already owns this request")]
    Conflict,
    #[error("Market Data repair resolution is unavailable: {0}")]
    Resolution(#[from] MarketDataRepairResolutionErrorV1),
    #[error("Market Data repair resolution custody is unavailable: {0}")]
    Unavailable(String),
}

pub(crate) async fn migrate(
    pool: &PgPool,
) -> Result<(), MarketDataRepairResolutionPostgresErrorV1> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_market_data_repair_resolutions_v1",
        "CREATE TABLE IF NOT EXISTS rd_market_data_repair_resolutions_v1 (resolution_identity TEXT PRIMARY KEY, repair_request_identity TEXT NOT NULL UNIQUE REFERENCES rd_market_data_repair_requests_v1(request_identity), decision_identity TEXT NOT NULL UNIQUE, market_data_terminal_identity TEXT NOT NULL UNIQUE, market_data_terminal_digest TEXT NOT NULL, resolution_digest TEXT NOT NULL UNIQUE, disposition TEXT NOT NULL, resolution_json JSONB NOT NULL, resolution_storage_bytes BYTEA NOT NULL, resolution_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(unavailable)
}

pub(crate) async fn commit(
    pool: &PgPool,
    resolution: MarketDataRepairResearchTerminalV1,
) -> Result<MarketDataRepairResolutionReadbackV1, MarketDataRepairResolutionPostgresErrorV1> {
    commit_at(pool, resolution, current_epoch_ms()?).await
}

async fn commit_at(
    pool: &PgPool,
    resolution: MarketDataRepairResearchTerminalV1,
    committed_at_epoch_ms: u64,
) -> Result<MarketDataRepairResolutionReadbackV1, MarketDataRepairResolutionPostgresErrorV1> {
    validate_identity(resolution.resolution_identity())?;
    validate_identity(resolution.repair_request_identity())?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await
        .map_err(unavailable)?;
    lock_request(&mut transaction, resolution.repair_request_identity()).await?;
    let rows = load_rows(&mut transaction, resolution.repair_request_identity()).await?;
    let readback = if rows.is_empty() {
        persist(&mut transaction, &resolution, committed_at_epoch_ms).await?;
        let committed = load_rows(&mut transaction, resolution.repair_request_identity()).await?;
        admit_row(&committed, resolution)?
    } else {
        admit_row(&rows, resolution)?
    };
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(readback)
}

pub(crate) async fn resolve(
    pool: &PgPool,
    locator: MarketDataRepairResolutionLocatorV1,
    expected: MarketDataRepairResearchTerminalV1,
) -> Result<Option<MarketDataRepairResolutionReadbackV1>, MarketDataRepairResolutionPostgresErrorV1>
{
    validate_identity(&locator.resolution_identity)?;
    validate_identity(&locator.repair_request_identity)?;
    if locator.resolution_identity != expected.resolution_identity()
        || locator.repair_request_identity != expected.repair_request_identity()
    {
        return Err(MarketDataRepairResolutionPostgresErrorV1::Conflict);
    }
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    let rows = load_rows(&mut transaction, &locator.repair_request_identity).await?;
    let Some(readback) = (!rows.is_empty())
        .then(|| admit_row(&rows, expected))
        .transpose()?
    else {
        transaction.commit().await.map_err(unavailable)?;
        return Ok(None);
    };
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(Some(readback))
}

/// Resolves only an exact persisted `REPAIRED` resolution locator for Replay re-entry.
///
/// The caller supplies no terminal body. Positive custody is reconstructed from canonical R&D
/// storage, its self-authenticating resolution digest, scalar mirrors, and the exact Owner outbox.
pub(crate) async fn resolve_repaired_for_reentry(
    pool: &PgPool,
    locator: &MarketDataRepairResolutionLocatorV1,
) -> Result<
    Option<MarketDataRepairResolutionReentryReadbackV1>,
    MarketDataRepairResolutionPostgresErrorV1,
> {
    validate_identity(&locator.resolution_identity)?;
    validate_identity(&locator.repair_request_identity)?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    let rows = load_rows(&mut transaction, &locator.repair_request_identity).await?;
    let Some(readback) = (!rows.is_empty())
        .then(|| admit_reentry_row(&rows, locator))
        .transpose()?
    else {
        transaction.commit().await.map_err(unavailable)?;
        return Ok(None);
    };
    verify_outbox_payload(
        &mut transaction,
        readback.resolution_identity(),
        &ResolvedOutboxV1 {
            schema_version: 1,
            resolution_identity: readback.resolution_identity().to_owned(),
            resolution_digest: readback.resolution_digest().to_owned(),
            repair_request_identity: readback.repair_request_identity().to_owned(),
            decision_identity: readback.decision_identity().to_owned(),
            market_data_terminal_identity: readback.market_data_terminal_identity().to_owned(),
            market_data_terminal_digest: readback.market_data_terminal_digest().to_owned(),
            disposition: MarketDataRepairResolutionDispositionV1::Repaired,
        },
        readback.committed_at_epoch_ms(),
    )
    .await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(Some(readback))
}

/// Re-admits the exact positive resolution bytes at a later R&D write boundary.
///
/// The caller retains no authority from the earlier readback: the canonical row and its outbox
/// record must still be complete and byte-equal inside the successor transaction.
pub(crate) async fn verify_repaired_readback_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    expected_resolution_bytes: &[u8],
    expected_committed_at_epoch_ms: u64,
) -> Result<(), MarketDataRepairResolutionPostgresErrorV1> {
    let expected_json: serde_json::Value =
        serde_json::from_slice(expected_resolution_bytes).map_err(unavailable)?;
    let resolution_identity = json_string(&expected_json, "resolution_identity")?;
    let repair_request_identity = json_string(&expected_json, "repair_request_identity")?;
    let decision_identity = json_string(&expected_json, "decision_identity")?;
    let market_data_terminal_identity =
        json_string(&expected_json, "market_data_terminal_identity")?;
    let market_data_terminal_digest = json_string(&expected_json, "market_data_terminal_digest")?;
    let resolution_digest = json_string(&expected_json, "resolution_digest")?;
    if json_string(&expected_json, "disposition")? != "REPAIRED" {
        return Err(unavailable(
            "Replay re-entry requires a REPAIRED resolution",
        ));
    }
    for identity in [
        resolution_identity,
        repair_request_identity,
        decision_identity,
        market_data_terminal_identity,
    ] {
        validate_identity(identity)?;
    }

    let rows = load_rows(transaction, repair_request_identity).await?;
    if rows.len() != 1 {
        return Err(unavailable("resolution request identity is not unique"));
    }
    let row = &rows[0];
    let stored_bytes: Vec<u8> = row
        .try_get("resolution_storage_bytes")
        .map_err(unavailable)?;
    let stored_json: serde_json::Value = row.try_get("resolution_json").map_err(unavailable)?;
    let stored_committed_at_epoch_ms = u64::try_from(
        row.try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?,
    )
    .map_err(unavailable)?;
    if stored_bytes != expected_resolution_bytes
        || stored_json != expected_json
        || serde_json::from_slice::<serde_json::Value>(&stored_bytes).map_err(unavailable)?
            != stored_json
        || row
            .try_get::<String, _>("resolution_storage_digest")
            .map_err(unavailable)?
            != bytes_digest(STORAGE_DOMAIN_V1, &stored_bytes)
        || row
            .try_get::<String, _>("resolution_identity")
            .map_err(unavailable)?
            != resolution_identity
        || row
            .try_get::<String, _>("repair_request_identity")
            .map_err(unavailable)?
            != repair_request_identity
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(unavailable)?
            != decision_identity
        || row
            .try_get::<String, _>("market_data_terminal_identity")
            .map_err(unavailable)?
            != market_data_terminal_identity
        || row
            .try_get::<String, _>("market_data_terminal_digest")
            .map_err(unavailable)?
            != market_data_terminal_digest
        || row
            .try_get::<String, _>("resolution_digest")
            .map_err(unavailable)?
            != resolution_digest
        || row
            .try_get::<String, _>("disposition")
            .map_err(unavailable)?
            != "REPAIRED"
        || stored_committed_at_epoch_ms != expected_committed_at_epoch_ms
    {
        return Err(unavailable("resolution row/readback mismatch"));
    }

    verify_outbox_payload(
        transaction,
        resolution_identity,
        &ResolvedOutboxV1 {
            schema_version: 1,
            resolution_identity: resolution_identity.to_owned(),
            resolution_digest: resolution_digest.to_owned(),
            repair_request_identity: repair_request_identity.to_owned(),
            decision_identity: decision_identity.to_owned(),
            market_data_terminal_identity: market_data_terminal_identity.to_owned(),
            market_data_terminal_digest: market_data_terminal_digest.to_owned(),
            disposition: MarketDataRepairResolutionDispositionV1::Repaired,
        },
        expected_committed_at_epoch_ms,
    )
    .await
}

async fn lock_request(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<(), MarketDataRepairResolutionPostgresErrorV1> {
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
        .bind(request_identity)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    resolution: &MarketDataRepairResearchTerminalV1,
    committed_at_epoch_ms: u64,
) -> Result<(), MarketDataRepairResolutionPostgresErrorV1> {
    let bytes = resolution.to_canonical_bytes()?;
    let storage_digest = bytes_digest(STORAGE_DOMAIN_V1, &bytes);
    sqlx::query("INSERT INTO rd_market_data_repair_resolutions_v1 (resolution_identity,repair_request_identity,decision_identity,market_data_terminal_identity,market_data_terminal_digest,resolution_digest,disposition,resolution_json,resolution_storage_bytes,resolution_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(resolution.resolution_identity())
        .bind(resolution.repair_request_identity())
        .bind(resolution.decision_identity())
        .bind(resolution.market_data_terminal_identity())
        .bind(resolution.market_data_terminal_digest())
        .bind(resolution.resolution_digest())
        .bind(disposition_name(resolution.disposition()))
        .bind(serde_json::to_value(resolution).map_err(unavailable)?)
        .bind(bytes)
        .bind(storage_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;

    let payload = outbox_payload(resolution);
    let payload_digest = canonical_digest(OUTBOX_DOMAIN_V1, &payload)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(format!("rd-owner-outbox-market-data-repair-resolution-v1-{}", payload_digest.trim_start_matches("sha256:")))
        .bind(resolution.resolution_identity())
        .bind(RESOLVED_EVENT_V1)
        .bind(payload_digest)
        .bind(serde_json::to_value(payload).map_err(unavailable)?)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

fn admit_row(
    rows: &[sqlx::postgres::PgRow],
    resolution: MarketDataRepairResearchTerminalV1,
) -> Result<MarketDataRepairResolutionReadbackV1, MarketDataRepairResolutionPostgresErrorV1> {
    if rows.len() != 1 {
        return Err(unavailable("resolution request identity is not unique"));
    }
    let row = &rows[0];
    let expected_bytes = resolution.to_canonical_bytes()?;
    let stored_bytes: Vec<u8> = row
        .try_get("resolution_storage_bytes")
        .map_err(unavailable)?;
    let stored_json: serde_json::Value = row.try_get("resolution_json").map_err(unavailable)?;
    let decoded_json: serde_json::Value =
        serde_json::from_slice(&stored_bytes).map_err(unavailable)?;
    let storage_is_exact = stored_json == decoded_json
        && row
            .try_get::<String, _>("resolution_storage_digest")
            .map_err(unavailable)?
            == bytes_digest(STORAGE_DOMAIN_V1, &stored_bytes)
        && row
            .try_get::<String, _>("resolution_identity")
            .map_err(unavailable)?
            == json_string(&stored_json, "resolution_identity")?
        && row
            .try_get::<String, _>("repair_request_identity")
            .map_err(unavailable)?
            == json_string(&stored_json, "repair_request_identity")?
        && row
            .try_get::<String, _>("decision_identity")
            .map_err(unavailable)?
            == json_string(&stored_json, "decision_identity")?
        && row
            .try_get::<String, _>("market_data_terminal_identity")
            .map_err(unavailable)?
            == json_string(&stored_json, "market_data_terminal_identity")?
        && row
            .try_get::<String, _>("market_data_terminal_digest")
            .map_err(unavailable)?
            == json_string(&stored_json, "market_data_terminal_digest")?
        && row
            .try_get::<String, _>("resolution_digest")
            .map_err(unavailable)?
            == json_string(&stored_json, "resolution_digest")?
        && row
            .try_get::<String, _>("disposition")
            .map_err(unavailable)?
            == json_string(&stored_json, "disposition")?;
    if !storage_is_exact {
        return Err(unavailable("resolution row storage is inconsistent"));
    }
    if stored_bytes != expected_bytes
        || stored_json != serde_json::to_value(&resolution).map_err(unavailable)?
    {
        return Err(MarketDataRepairResolutionPostgresErrorV1::Conflict);
    }
    Ok(MarketDataRepairResolutionReadbackV1 {
        resolution,
        committed_at_epoch_ms: u64::try_from(
            row.try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(unavailable)?,
        )
        .map_err(unavailable)?,
    })
}

fn admit_reentry_row(
    rows: &[sqlx::postgres::PgRow],
    locator: &MarketDataRepairResolutionLocatorV1,
) -> Result<MarketDataRepairResolutionReentryReadbackV1, MarketDataRepairResolutionPostgresErrorV1>
{
    if rows.len() != 1 {
        return Err(unavailable("resolution request identity is not unique"));
    }
    let row = &rows[0];
    let stored_bytes: Vec<u8> = row
        .try_get("resolution_storage_bytes")
        .map_err(unavailable)?;
    let stored_json: serde_json::Value = row.try_get("resolution_json").map_err(unavailable)?;
    let decoded_json: serde_json::Value =
        serde_json::from_slice(&stored_bytes).map_err(unavailable)?;
    let projection = decode_canonical_resolution_projection(&stored_bytes)?;
    let committed_at_epoch_ms = u64::try_from(
        row.try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?,
    )
    .map_err(unavailable)?;

    let exact_storage = stored_json == decoded_json
        && serde_json::to_value(&projection).map_err(unavailable)? == stored_json
        && row
            .try_get::<String, _>("resolution_storage_digest")
            .map_err(unavailable)?
            == bytes_digest(STORAGE_DOMAIN_V1, &stored_bytes)
        && row
            .try_get::<String, _>("resolution_identity")
            .map_err(unavailable)?
            == projection.resolution_identity
        && row
            .try_get::<String, _>("repair_request_identity")
            .map_err(unavailable)?
            == projection.repair_request_identity
        && row
            .try_get::<String, _>("decision_identity")
            .map_err(unavailable)?
            == projection.decision_identity
        && row
            .try_get::<String, _>("market_data_terminal_identity")
            .map_err(unavailable)?
            == projection.market_data_terminal_identity
        && row
            .try_get::<String, _>("market_data_terminal_digest")
            .map_err(unavailable)?
            == projection.market_data_terminal_digest
        && row
            .try_get::<String, _>("resolution_digest")
            .map_err(unavailable)?
            == projection.resolution_digest
        && row
            .try_get::<String, _>("disposition")
            .map_err(unavailable)?
            == projection.disposition;
    if !exact_storage {
        return Err(unavailable("resolution row storage is inconsistent"));
    }
    if projection.schema_version != 1
        || projection.disposition != "REPAIRED"
        || projection.stop_reason.is_some()
        || projection.unavailable_basis.is_some()
        || !projection.blockers.is_empty()
        || projection.resolution_identity != locator.resolution_identity
        || projection.repair_request_identity != locator.repair_request_identity
    {
        return Err(MarketDataRepairResolutionPostgresErrorV1::Conflict);
    }
    let expected_digest = stored_resolution_digest(&projection)?;
    let expected_identity = format!(
        "rd-market-data-repair-resolution-v1-{}",
        expected_digest.trim_start_matches("sha256:")
    );
    if projection.resolution_digest != expected_digest
        || projection.resolution_identity != expected_identity
    {
        return Err(unavailable("resolution digest custody mismatch"));
    }
    let repaired = projection
        .repaired
        .ok_or_else(|| unavailable("repaired resolution snapshot is unavailable"))?;
    Ok(MarketDataRepairResolutionReentryReadbackV1 {
        resolution_identity: projection.resolution_identity,
        resolution_digest: projection.resolution_digest,
        decision_identity: projection.decision_identity,
        decision_evidence_cut: projection.decision_evidence_cut,
        repair_request_identity: projection.repair_request_identity,
        repair_request_digest: projection.repair_request_digest,
        market_data_terminal_identity: projection.market_data_terminal_identity,
        market_data_terminal_digest: projection.market_data_terminal_digest,
        correlation_identity: projection.correlation_identity,
        repaired_snapshot_identity: repaired.snapshot_identity,
        repaired_normalized_records_digest: repaired.normalized_records_digest,
        canonical_resolution_bytes: stored_bytes,
        committed_at_epoch_ms,
    })
}

fn decode_canonical_resolution_projection(
    bytes: &[u8],
) -> Result<StoredResolutionProjectionV1, MarketDataRepairResolutionPostgresErrorV1> {
    let projection: StoredResolutionProjectionV1 =
        serde_json::from_slice(bytes).map_err(unavailable)?;
    if serde_json::to_vec(&projection).map_err(unavailable)? != bytes {
        return Err(unavailable("resolution storage bytes are not canonical"));
    }
    Ok(projection)
}

fn stored_resolution_digest(
    projection: &StoredResolutionProjectionV1,
) -> Result<String, MarketDataRepairResolutionPostgresErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let meaning = StoredResolutionMeaningV1 {
        schema_version: projection.schema_version,
        disposition: &projection.disposition,
        decision_identity: &projection.decision_identity,
        decision_digest: &projection.decision_digest,
        decision_evidence_cut: &projection.decision_evidence_cut,
        action_request_identity: &projection.action_request_identity,
        action_request_digest: &projection.action_request_digest,
        repair_request_identity: &projection.repair_request_identity,
        repair_request_digest: &projection.repair_request_digest,
        repair_request_receipt_identity: &projection.repair_request_receipt_identity,
        repair_request_receipt_digest: &projection.repair_request_receipt_digest,
        market_data_terminal_identity: &projection.market_data_terminal_identity,
        market_data_terminal_digest: &projection.market_data_terminal_digest,
        correlation_identity: projection.correlation_identity,
        result_time_evidence: &projection.result_time_evidence,
        repaired: projection.repaired.as_ref(),
        unavailable_basis: projection.unavailable_basis.as_deref(),
        blockers: &projection.blockers,
        stop_reason: projection.stop_reason.as_deref(),
    };
    serde_json::to_vec(&Envelope {
        domain: RESOLUTION_DOMAIN_V1,
        value: &meaning,
    })
    .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
    .map_err(unavailable)
}

async fn load_rows(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Vec<sqlx::postgres::PgRow>, MarketDataRepairResolutionPostgresErrorV1> {
    sqlx::query("SELECT resolution_identity,repair_request_identity,decision_identity,market_data_terminal_identity,market_data_terminal_digest,resolution_digest,disposition,resolution_json,resolution_storage_bytes,resolution_storage_digest,committed_at_epoch_ms FROM rd_market_data_repair_resolutions_v1 WHERE repair_request_identity=$1 FOR SHARE")
        .bind(request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &MarketDataRepairResolutionReadbackV1,
) -> Result<(), MarketDataRepairResolutionPostgresErrorV1> {
    let resolution = readback.resolution();
    verify_outbox_payload(
        transaction,
        resolution.resolution_identity(),
        &outbox_payload(resolution),
        readback.committed_at_epoch_ms(),
    )
    .await
}

async fn verify_outbox_payload(
    transaction: &mut Transaction<'_, Postgres>,
    resolution_identity: &str,
    expected: &ResolvedOutboxV1,
    committed_at_epoch_ms: u64,
) -> Result<(), MarketDataRepairResolutionPostgresErrorV1> {
    let rows = sqlx::query("SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(resolution_identity)
        .bind(RESOLVED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)?;
    if rows.len() != 1 {
        return Err(unavailable("resolution outbox custody is incomplete"));
    }
    let row = &rows[0];
    if row
        .try_get::<String, _>("aggregate_identity")
        .map_err(unavailable)?
        != resolution_identity
        || row
            .try_get::<String, _>("event_kind")
            .map_err(unavailable)?
            != RESOLVED_EVENT_V1
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(unavailable)?
            != canonical_digest(OUTBOX_DOMAIN_V1, &expected)?
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(unavailable)?
            != serde_json::to_value(expected).map_err(unavailable)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?
            != i64::try_from(committed_at_epoch_ms).map_err(unavailable)?
    {
        return Err(unavailable("resolution outbox/readback mismatch"));
    }
    Ok(())
}

#[derive(Serialize)]
struct ResolvedOutboxV1 {
    schema_version: u16,
    resolution_identity: String,
    resolution_digest: String,
    repair_request_identity: String,
    decision_identity: String,
    market_data_terminal_identity: String,
    market_data_terminal_digest: String,
    disposition: MarketDataRepairResolutionDispositionV1,
}

fn outbox_payload(resolution: &MarketDataRepairResearchTerminalV1) -> ResolvedOutboxV1 {
    ResolvedOutboxV1 {
        schema_version: 1,
        resolution_identity: resolution.resolution_identity().to_owned(),
        resolution_digest: resolution.resolution_digest().to_owned(),
        repair_request_identity: resolution.repair_request_identity().to_owned(),
        decision_identity: resolution.decision_identity().to_owned(),
        market_data_terminal_identity: resolution.market_data_terminal_identity().to_owned(),
        market_data_terminal_digest: resolution.market_data_terminal_digest().to_owned(),
        disposition: resolution.disposition(),
    }
}

fn disposition_name(disposition: MarketDataRepairResolutionDispositionV1) -> &'static str {
    match disposition {
        MarketDataRepairResolutionDispositionV1::Repaired => "REPAIRED",
        MarketDataRepairResolutionDispositionV1::InputUnavailable => "INPUT_UNAVAILABLE",
    }
}

fn json_string<'a>(
    value: &'a serde_json::Value,
    field: &str,
) -> Result<&'a str, MarketDataRepairResolutionPostgresErrorV1> {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| unavailable(format!("resolution JSON field {field} is unavailable")))
}

fn validate_identity(value: &str) -> Result<(), MarketDataRepairResolutionPostgresErrorV1> {
    if value.is_empty()
        || value.len() > 512
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(MarketDataRepairResolutionPostgresErrorV1::InvalidLocator);
    }
    Ok(())
}

fn bytes_digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, MarketDataRepairResolutionPostgresErrorV1> {
    serde_json::to_vec(value)
        .map(|bytes| bytes_digest(domain, &bytes))
        .map_err(unavailable)
}

fn current_epoch_ms() -> Result<u64, MarketDataRepairResolutionPostgresErrorV1> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(unavailable)
        .and_then(|duration| u64::try_from(duration.as_millis()).map_err(unavailable))
}

fn unavailable(error: impl std::fmt::Display) -> MarketDataRepairResolutionPostgresErrorV1 {
    MarketDataRepairResolutionPostgresErrorV1::Unavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    #[test]
    fn repaired_projection_recomputes_the_owner_resolution_digest() {
        let resolution = crate::market_data_repair_resolution::tests::repaired_resolution_fixture();
        let bytes = resolution
            .to_canonical_bytes()
            .expect("canonical resolution");
        let mut projection: StoredResolutionProjectionV1 =
            serde_json::from_slice(&bytes).expect("stored projection");
        assert_eq!(
            stored_resolution_digest(&projection).expect("resolution digest"),
            resolution.resolution_digest()
        );
        let mut noncanonical = bytes.clone();
        noncanonical.push(b' ');
        assert!(decode_canonical_resolution_projection(&noncanonical).is_err());

        projection.decision_evidence_cut.request_digest = format!("sha256:{}", "0".repeat(64));
        assert_ne!(
            stored_resolution_digest(&projection).expect("tampered digest"),
            resolution.resolution_digest()
        );
    }

    async fn prepare_resolution_custody() -> (CanonicalOwnerPostgresTestDatabaseV1, PgPool) {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let pool = database
            .mutation()
            .pool(CanonicalOwnerTestRoleV1::RdOwner)
            .clone();
        sqlx::query(
            "CREATE TABLE rd_market_data_repair_requests_v1 (request_identity TEXT PRIMARY KEY)",
        )
        .execute(&pool)
        .await
        .expect("parent request table");
        sqlx::query("CREATE TABLE rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity,event_kind))")
            .execute(&pool)
            .await
            .expect("R&D outbox");
        migrate(&pool).await.expect("resolution schema");
        sqlx::query(
            "INSERT INTO rd_market_data_repair_requests_v1(request_identity) VALUES ('request')",
        )
        .execute(&pool)
        .await
        .expect("parent request");
        (database, pool)
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn repaired_readback_is_reverified_inside_successor_transaction() {
        let (_database, pool) = prepare_resolution_custody().await;
        let readback = commit_at(
            &pool,
            crate::market_data_repair_resolution::tests::repaired_resolution_fixture(),
            1_000,
        )
        .await
        .expect("repaired resolution");
        let bytes = readback
            .resolution()
            .to_canonical_bytes()
            .expect("canonical resolution");
        let locator = MarketDataRepairResolutionLocatorV1 {
            resolution_identity: readback.resolution().resolution_identity().to_owned(),
            repair_request_identity: readback.resolution().repair_request_identity().to_owned(),
        };
        let locator_readback = resolve_repaired_for_reentry(&pool, &locator)
            .await
            .expect("locator-only resolution")
            .expect("repaired resolution available");
        assert_eq!(locator_readback.canonical_resolution_bytes(), bytes);

        let mut transaction = pool.begin().await.expect("successor transaction");
        verify_repaired_readback_in_transaction(&mut transaction, &bytes, 1_000)
            .await
            .expect("exact repaired readback");
        transaction
            .commit()
            .await
            .expect("read verification commit");

        sqlx::query("UPDATE rd_owner_outbox_v1 SET payload_digest='sha256:tampered' WHERE aggregate_identity=$1")
            .bind(readback.resolution().resolution_identity())
            .execute(&pool)
            .await
            .expect("tamper fixture");
        let mut transaction = pool.begin().await.expect("tampered transaction");
        assert!(
            verify_repaired_readback_in_transaction(&mut transaction, &bytes, 1_000)
                .await
                .is_err()
        );
        transaction.rollback().await.expect("tampered rollback");
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn commit_retry_resolve_conflict_and_tamper_are_atomic() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let mutation = database.mutation();
        let pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        sqlx::query(
            "CREATE TABLE rd_market_data_repair_requests_v1 (request_identity TEXT PRIMARY KEY)",
        )
        .execute(pool)
        .await
        .expect("parent request table");
        sqlx::query("CREATE TABLE rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity,event_kind))")
            .execute(pool)
            .await
            .expect("R&D outbox");
        migrate(pool).await.expect("resolution schema");
        crate::schema_materialization::verify_materialized_public_tables(pool, TABLES)
            .await
            .expect("exact resolution schema");
        sqlx::query(
            "INSERT INTO rd_market_data_repair_requests_v1(request_identity) VALUES ('request')",
        )
        .execute(pool)
        .await
        .expect("parent request");

        let first = commit_at(
            pool,
            crate::market_data_repair_resolution::tests::unavailable_resolution_fixture(),
            1_000,
        )
        .await
        .expect("first commit");
        let retried = commit_at(
            pool,
            crate::market_data_repair_resolution::tests::unavailable_resolution_fixture(),
            2_000,
        )
        .await
        .expect("exact retry");
        assert_eq!(
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&retried).unwrap()
        );
        assert_eq!(retried.committed_at_epoch_ms(), 1_000);
        assert_eq!(
            retried.resolution().stop_reason(),
            Some(crate::iteration_decision::IterationTerminalStopReasonV1::InputUnavailable)
        );

        let resolved = resolve(
            pool,
            MarketDataRepairResolutionLocatorV1 {
                resolution_identity: first.resolution().resolution_identity().to_owned(),
                repair_request_identity: first.resolution().repair_request_identity().to_owned(),
            },
            crate::market_data_repair_resolution::tests::unavailable_resolution_fixture(),
        )
        .await
        .expect("resolve")
        .expect("stored resolution");
        assert_eq!(
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&resolved).unwrap()
        );

        let changed = commit_at(
            pool,
            crate::market_data_repair_resolution::tests::repaired_resolution_fixture(),
            3_000,
        )
        .await;
        assert_eq!(
            changed,
            Err(MarketDataRepairResolutionPostgresErrorV1::Conflict)
        );
        let counts: (i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM rd_market_data_repair_resolutions_v1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind=$1)")
            .bind(RESOLVED_EVENT_V1)
            .fetch_one(pool)
            .await
            .expect("custody counts");
        assert_eq!(counts, (1, 1));

        sqlx::query("UPDATE rd_owner_outbox_v1 SET payload_digest='sha256:tampered' WHERE aggregate_identity=$1")
            .bind(first.resolution().resolution_identity())
            .execute(pool)
            .await
            .expect("tamper fixture");
        let tampered = resolve(
            pool,
            MarketDataRepairResolutionLocatorV1 {
                resolution_identity: first.resolution().resolution_identity().to_owned(),
                repair_request_identity: first.resolution().repair_request_identity().to_owned(),
            },
            crate::market_data_repair_resolution::tests::unavailable_resolution_fixture(),
        )
        .await;
        assert!(matches!(
            tampered,
            Err(MarketDataRepairResolutionPostgresErrorV1::Unavailable(_))
        ));
    }
}
