#![allow(
    dead_code,
    reason = "private direct measurement remains tested while production store authorities are unavailable"
)]

use std::fmt::Debug;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{
    AssertSqlSafe, Connection, PgConnection, Row,
    postgres::{PgConnectOptions, PgSslMode},
};
use thiserror::Error;
use url::Url;
use zeroize::Zeroizing;

/// TLS identity observed for the exact PostgreSQL session.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct PostgresTlsIdentity {
    pub(crate) enabled: bool,
    pub(crate) server_name: String,
    pub(crate) protocol: String,
    pub(crate) cipher: String,
    pub(crate) verification_mode: String,
    pub(crate) peer_certificate_identity: String,
    pub(crate) trust_policy_identity: String,
}

impl PostgresTlsIdentity {
    /// Creates the expected no-TLS identity used only by a pinned disposable local PostgreSQL test.
    #[must_use]
    pub(crate) fn disposable_plaintext(server_name: impl Into<String>) -> Self {
        Self {
            enabled: false,
            server_name: server_name.into(),
            protocol: "PLAINTEXT_DISPOSABLE_TEST_ONLY".to_string(),
            cipher: "NONE".to_string(),
            verification_mode: "DISPOSABLE_LOOPBACK_ONLY".to_string(),
            peer_certificate_identity: "UNAVAILABLE_DISPOSABLE_PLAINTEXT".to_string(),
            trust_policy_identity: "PINNED_DISPOSABLE_POSTGRES_V1".to_string(),
        }
    }

    /// Returns whether the measured session used TLS.
    #[must_use]
    pub(super) const fn enabled(&self) -> bool {
        self.enabled
    }
}

/// Exact catalog surfaces directly measured through the credential lease.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct PostgresMeasurementSpec {
    schema_name: String,
    migration_relation: String,
    function_signatures: Vec<String>,
    acl_relations: Vec<String>,
}

impl PostgresMeasurementSpec {
    /// Creates a bounded direct-measurement specification.
    ///
    /// Names are resolved by PostgreSQL catalog functions and are never interpolated into SQL.
    ///
    /// # Errors
    ///
    /// Returns an error for empty or unbounded catalog selections.
    pub(super) fn new(
        schema_name: impl Into<String>,
        migration_relation: impl Into<String>,
        function_signatures: Vec<String>,
        acl_relations: Vec<String>,
    ) -> Result<Self, PostgresMeasurementError> {
        let spec = Self {
            schema_name: schema_name.into(),
            migration_relation: migration_relation.into(),
            function_signatures,
            acl_relations,
        };

        if spec.schema_name.is_empty()
            || spec.migration_relation.is_empty()
            || spec.function_signatures.is_empty()
            || spec.acl_relations.is_empty()
            || spec.function_signatures.len() > 64
            || spec.acl_relations.len() > 64
            || spec
                .function_signatures
                .iter()
                .chain(&spec.acl_relations)
                .any(|value| value.is_empty() || value.len() > 512)
            || spec
                .function_signatures
                .iter()
                .any(|signature| !canonical_function_signature(signature))
            || !canonical_identifier(&spec.schema_name)
            || quoted_qualified_name(&spec.migration_relation).is_none()
            || spec
                .acl_relations
                .iter()
                .any(|relation| quoted_qualified_name(relation).is_none())
        {
            return Err(PostgresMeasurementError::InvalidSpecification);
        }
        Ok(spec)
    }
}

/// Secret-bearing credential lease resolved from one opaque handle.
///
/// The URL is zeroized on drop, excluded from serialization, and redacted from `Debug`.
pub(super) struct PostgresCredentialLease {
    handle_identity: String,
    audience: String,
    version: String,
    valid_through_epoch_ms: u64,
    database_url: Zeroizing<String>,
}

impl PostgresCredentialLease {
    /// Wraps a resolver-produced secret without exposing it to admission artifacts.
    ///
    /// # Errors
    ///
    /// Returns an error for an empty binding, lease, or URL.
    pub(super) fn from_resolved_secret(
        handle_identity: impl Into<String>,
        audience: impl Into<String>,
        version: impl Into<String>,
        valid_through_epoch_ms: u64,
        database_url: String,
    ) -> Result<Self, PostgresMeasurementError> {
        let lease = Self {
            handle_identity: handle_identity.into(),
            audience: audience.into(),
            version: version.into(),
            valid_through_epoch_ms,
            database_url: Zeroizing::new(database_url),
        };

        if lease.handle_identity.is_empty()
            || lease.audience.is_empty()
            || lease.version.is_empty()
            || lease.valid_through_epoch_ms == 0
            || lease.database_url.is_empty()
            || !safe_opaque_identity(&lease.handle_identity)
            || !safe_opaque_identity(&lease.audience)
            || !safe_opaque_identity(&lease.version)
        {
            return Err(PostgresMeasurementError::InvalidCredentialLease);
        }
        Ok(lease)
    }

    pub(crate) fn database_url(&self) -> &str {
        self.database_url.as_str()
    }

    pub(crate) fn handle_identity(&self) -> &str {
        &self.handle_identity
    }

    pub(crate) fn audience(&self) -> &str {
        &self.audience
    }

    pub(crate) fn version(&self) -> &str {
        &self.version
    }

    pub(crate) const fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }
}

impl Debug for PostgresCredentialLease {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(PostgresCredentialLease))
            .field("handle_identity", &self.handle_identity)
            .field("audience", &self.audience)
            .field("version", &self.version)
            .field("valid_through_epoch_ms", &self.valid_through_epoch_ms)
            .field("database_url", &"[REDACTED]")
            .finish()
    }
}

pub(crate) async fn read_market_data_source_binding_snapshot(
    lease: &PostgresCredentialLease,
    binding_identity: &[u8; 32],
) -> Result<(Vec<Vec<u8>>, Vec<Vec<u8>>), PostgresMeasurementError> {
    let target = parse_target(lease.database_url())?;

    if ambient_pg_configuration_present() {
        return Err(PostgresMeasurementError::InvalidTarget);
    }
    let options = connect_options(&target, "vibe-market-data-source-binding-v1");
    let mut connection = PgConnection::connect_with(&options)
        .await
        .map_err(|_| PostgresMeasurementError::ConnectionUnavailable)?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;
    let custody: bool = sqlx::query_scalar(
            "SELECT market_data_private.resolve_owner_history_census_custody_v1() AND market_data_private.resolve_source_lineage_custody_v1((SELECT lineage_root FROM market_data_private.source_binding_facts_v1 WHERE binding_id=$1)) AND EXISTS(SELECT 1 FROM market_data_private.resolve_clock_custody_state_v1())",
        )
        .bind(binding_identity.as_slice())
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    if !custody {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }
    let member_identities: Vec<Vec<u8>> = sqlx::query_scalar(
            "SELECT member_identity FROM market_data_private.resolve_source_lineage_members_v1((SELECT lineage_root FROM market_data_private.source_binding_facts_v1 WHERE binding_id=$1))",
        )
        .bind(binding_identity.as_slice())
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    if member_identities.is_empty() || member_identities.len() > 10_000 {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }
    let mut lineage = Vec::with_capacity(member_identities.len());
    for identity in member_identities {
        let evidence: serde_json::Value = sqlx::query_scalar(
            "SELECT to_jsonb(e) FROM market_data_private.resolve_source_binding_v1($1) AS e",
        )
        .bind(identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
        lineage.push(
            serde_json::to_vec(&evidence)
                .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
        );
    }
    let clocks: Vec<serde_json::Value> = sqlx::query_scalar(
            "SELECT to_jsonb(h) FROM market_data_private.clock_handoffs_v1 AS h ORDER BY h.head_identity LIMIT 10001",
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    if clocks.len() > 10_000 {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }
    let clocks = clocks
        .into_iter()
        .map(|value| {
            serde_json::to_vec(&value).map_err(|_| PostgresMeasurementError::SnapshotUnavailable)
        })
        .collect::<Result<Vec<_>, _>>()?;
    transaction
        .commit()
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    Ok((lineage, clocks))
}

pub(crate) struct RawPitEvaluationSnapshot {
    pub(crate) pit_lineage_rows: Vec<Vec<u8>>,
    pub(crate) source_lineage_rows: Vec<Vec<u8>>,
    pub(crate) clock_rows: Vec<Vec<u8>>,
    pub(crate) batch_source_binding_identity: [u8; 32],
    pub(crate) batch_source_binding_lineage_root: [u8; 32],
    pub(crate) batch_source_binding_lineage_version: u64,
    pub(crate) batch_digest: [u8; 32],
    pub(crate) batch_bytes: Vec<u8>,
    pub(crate) batch_rows: Vec<super::MarketDataPitObservationNativeRow>,
}

#[allow(
    clippy::struct_field_names,
    reason = "the three private vectors distinguish canonical evidence row families"
)]
pub(crate) struct RawPitTerminalSnapshot {
    pub(crate) pit_lineage_rows: Vec<Vec<u8>>,
    pub(crate) source_lineage_rows: Vec<Vec<u8>>,
    pub(crate) clock_rows: Vec<Vec<u8>>,
}

pub(crate) async fn read_market_data_pit_terminal_snapshot(
    lease: &PostgresCredentialLease,
    snapshot_identity: &[u8; 32],
) -> Result<RawPitTerminalSnapshot, PostgresMeasurementError> {
    let target = parse_target(lease.database_url())?;

    if ambient_pg_configuration_present() {
        return Err(PostgresMeasurementError::InvalidTarget);
    }
    let options = connect_options(&target, "vibe-market-data-pit-terminal-v1");
    let mut connection = PgConnection::connect_with(&options)
        .await
        .map_err(|_| PostgresMeasurementError::ConnectionUnavailable)?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;

    let raw_source_identity: serde_json::Value = sqlx::query_scalar(
        "SELECT aggregate_json->'fact'->'source_binding_identity' FROM market_data_private.pit_snapshot_facts_v1 WHERE snapshot_identity=$1",
    )
    .bind(snapshot_identity.as_slice())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let source_identity = raw_json_digest(&raw_source_identity)?;
    let source_lineage_root: Vec<u8> = sqlx::query_scalar(
        "SELECT lineage_root FROM market_data_private.source_binding_facts_v1 WHERE binding_id=$1",
    )
    .bind(source_identity.as_slice())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let custody: bool = sqlx::query_scalar(
        "SELECT market_data_private.resolve_owner_history_census_custody_v1() AND market_data_private.resolve_pit_lineage_custody_v1((SELECT lineage_root FROM market_data_private.pit_snapshot_facts_v1 WHERE snapshot_identity=$1)) AND market_data_private.resolve_source_lineage_custody_v1($2) AND EXISTS(SELECT 1 FROM market_data_private.resolve_clock_custody_state_v1())",
    )
    .bind(snapshot_identity.as_slice())
    .bind(&source_lineage_root)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    if !custody {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }

    let pit_member_identities: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT member_identity FROM market_data_private.resolve_pit_lineage_members_v1((SELECT lineage_root FROM market_data_private.pit_snapshot_facts_v1 WHERE snapshot_identity=$1))",
    )
    .bind(snapshot_identity.as_slice())
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let source_member_identities: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT member_identity FROM market_data_private.resolve_source_lineage_members_v1($1)",
    )
    .bind(&source_lineage_root)
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;

    if pit_member_identities.is_empty()
        || pit_member_identities.len() > 10_000
        || source_member_identities.is_empty()
        || source_member_identities.len() > 10_000
    {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }

    let mut pit_lineage_rows = Vec::with_capacity(pit_member_identities.len());
    for identity in pit_member_identities {
        let evidence: serde_json::Value = sqlx::query_scalar(
            "SELECT to_jsonb(e) FROM market_data_private.resolve_pit_snapshot_v1($1) AS e",
        )
        .bind(identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
        pit_lineage_rows.push(
            serde_json::to_vec(&evidence)
                .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
        );
    }
    let mut source_lineage_rows = Vec::with_capacity(source_member_identities.len());
    for identity in source_member_identities {
        let evidence: serde_json::Value = sqlx::query_scalar(
            "SELECT to_jsonb(e) FROM market_data_private.resolve_source_binding_v1($1) AS e",
        )
        .bind(identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
        source_lineage_rows.push(
            serde_json::to_vec(&evidence)
                .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
        );
    }
    let clocks: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT to_jsonb(h) FROM market_data_private.clock_handoffs_v1 AS h ORDER BY h.head_identity LIMIT 10001",
    )
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    if clocks.len() > 10_000 {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }
    let clock_rows = clocks
        .into_iter()
        .map(|value| {
            serde_json::to_vec(&value).map_err(|_| PostgresMeasurementError::SnapshotUnavailable)
        })
        .collect::<Result<Vec<_>, _>>()?;
    transaction
        .commit()
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    Ok(RawPitTerminalSnapshot {
        pit_lineage_rows,
        source_lineage_rows,
        clock_rows,
    })
}

fn raw_json_digest(value: &serde_json::Value) -> Result<[u8; 32], PostgresMeasurementError> {
    let values = value
        .as_array()
        .ok_or(PostgresMeasurementError::SnapshotUnavailable)?;
    if values.len() != 32 {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }
    let mut digest = [0_u8; 32];
    for (target, value) in digest.iter_mut().zip(values) {
        *target = value
            .as_u64()
            .and_then(|value| u8::try_from(value).ok())
            .ok_or(PostgresMeasurementError::SnapshotUnavailable)?;
    }
    Ok(digest)
}

pub(crate) async fn read_market_data_pit_evaluation_snapshot(
    lease: &PostgresCredentialLease,
    snapshot_identity: &[u8; 32],
) -> Result<RawPitEvaluationSnapshot, PostgresMeasurementError> {
    let target = parse_target(lease.database_url())?;

    if ambient_pg_configuration_present() {
        return Err(PostgresMeasurementError::InvalidTarget);
    }
    let options = connect_options(&target, "vibe-market-data-pit-evaluation-v1");
    let mut connection = PgConnection::connect_with(&options)
        .await
        .map_err(|_| PostgresMeasurementError::ConnectionUnavailable)?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;

    let header = sqlx::query(
        "SELECT source_binding_identity,source_binding_lineage_root,source_binding_lineage_version,batch_digest,batch_bytes,row_count FROM market_data_private.resolve_pit_observation_batch_v1($1)",
    )
    .bind(snapshot_identity.as_slice())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let source_binding_identity: Vec<u8> = header
        .try_get("source_binding_identity")
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let source_lineage_root: Vec<u8> = header
        .try_get("source_binding_lineage_root")
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let source_binding_lineage_version: i64 = header
        .try_get("source_binding_lineage_version")
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let batch_digest: Vec<u8> = header
        .try_get("batch_digest")
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let batch_bytes: Vec<u8> = header
        .try_get("batch_bytes")
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let row_count: i64 = header
        .try_get("row_count")
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let batch_digest: [u8; 32] = batch_digest
        .try_into()
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let batch_source_binding_identity: [u8; 32] = source_binding_identity
        .try_into()
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let batch_source_binding_lineage_root: [u8; 32] = source_lineage_root
        .clone()
        .try_into()
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let batch_source_binding_lineage_version = u64::try_from(source_binding_lineage_version)
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;

    if batch_source_binding_lineage_version == 0
        || batch_bytes.is_empty()
        || !(1..=10_000).contains(&row_count)
    {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }

    let custody: bool = sqlx::query_scalar(
        "SELECT market_data_private.resolve_owner_history_census_custody_v1() AND market_data_private.resolve_pit_lineage_custody_v1((SELECT lineage_root FROM market_data_private.pit_snapshot_facts_v1 WHERE snapshot_identity=$1)) AND market_data_private.resolve_source_lineage_custody_v1($2) AND EXISTS(SELECT 1 FROM market_data_private.resolve_clock_custody_state_v1())",
    )
    .bind(snapshot_identity.as_slice())
    .bind(&source_lineage_root)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    if !custody {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }

    let pit_member_identities: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT member_identity FROM market_data_private.resolve_pit_lineage_members_v1((SELECT lineage_root FROM market_data_private.pit_snapshot_facts_v1 WHERE snapshot_identity=$1))",
    )
    .bind(snapshot_identity.as_slice())
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let source_member_identities: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT member_identity FROM market_data_private.resolve_source_lineage_members_v1($1)",
    )
    .bind(&source_lineage_root)
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;

    if pit_member_identities.is_empty()
        || pit_member_identities.len() > 10_000
        || source_member_identities.is_empty()
        || source_member_identities.len() > 10_000
    {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }

    let mut pit_lineage_rows = Vec::with_capacity(pit_member_identities.len());
    for identity in pit_member_identities {
        let evidence: serde_json::Value = sqlx::query_scalar(
            "SELECT to_jsonb(e) FROM market_data_private.resolve_pit_snapshot_v1($1) AS e",
        )
        .bind(identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
        pit_lineage_rows.push(
            serde_json::to_vec(&evidence)
                .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
        );
    }
    let mut source_lineage_rows = Vec::with_capacity(source_member_identities.len());
    for identity in source_member_identities {
        let evidence: serde_json::Value = sqlx::query_scalar(
            "SELECT to_jsonb(e) FROM market_data_private.resolve_source_binding_v1($1) AS e",
        )
        .bind(identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
        source_lineage_rows.push(
            serde_json::to_vec(&evidence)
                .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
        );
    }
    let clocks: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT to_jsonb(h) FROM market_data_private.clock_handoffs_v1 AS h ORDER BY h.head_identity LIMIT 10001",
    )
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    if clocks.len() > 10_000 {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }
    let clock_rows = clocks
        .into_iter()
        .map(|value| {
            serde_json::to_vec(&value).map_err(|_| PostgresMeasurementError::SnapshotUnavailable)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let native_rows = sqlx::query(
        "SELECT ordinal,symbolic_key,member_key,row_bytes FROM market_data_private.resolve_pit_observation_rows_v1($1) LIMIT 10001",
    )
    .bind(snapshot_identity.as_slice())
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    let batch_rows = native_rows
        .into_iter()
        .map(|row| {
            let ordinal: i64 = row
                .try_get("ordinal")
                .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
            Ok(super::MarketDataPitObservationNativeRow {
                ordinal: u64::try_from(ordinal)
                    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
                symbolic_key: row
                    .try_get("symbolic_key")
                    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
                member_key: row
                    .try_get("member_key")
                    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
                row_bytes: row
                    .try_get("row_bytes")
                    .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    if i64::try_from(batch_rows.len()).ok() != Some(row_count) {
        return Err(PostgresMeasurementError::SnapshotUnavailable);
    }
    transaction
        .commit()
        .await
        .map_err(|_| PostgresMeasurementError::SnapshotUnavailable)?;
    Ok(RawPitEvaluationSnapshot {
        pit_lineage_rows,
        source_lineage_rows,
        clock_rows,
        batch_source_binding_identity,
        batch_source_binding_lineage_root,
        batch_source_binding_lineage_version,
        batch_digest,
        batch_bytes,
        batch_rows,
    })
}

/// Canonical direct measurement of one PostgreSQL target and its governed catalog surface.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[allow(
    clippy::struct_field_names,
    reason = "each field is an independently content-addressed measured identity"
)]
pub(super) struct PostgresMeasurement {
    pub(crate) endpoint_identity: String,
    pub(crate) tls_identity: PostgresTlsIdentity,
    pub(crate) server_identity: String,
    pub(crate) database_identity: String,
    pub(crate) schema_identity: String,
    pub(crate) migration_identity: String,
    pub(crate) function_identity: String,
    pub(crate) role_identity: String,
    pub(crate) acl_identity: String,
}

impl PostgresMeasurement {
    /// Returns the directly observed endpoint identity without credentials.
    #[must_use]
    pub(super) fn endpoint_identity(&self) -> &str {
        &self.endpoint_identity
    }

    /// Returns the direct server-system identity.
    #[must_use]
    pub(super) fn server_identity(&self) -> &str {
        &self.server_identity
    }

    /// Returns the direct database name/OID identity.
    #[must_use]
    pub(super) fn database_identity(&self) -> &str {
        &self.database_identity
    }

    /// Returns the exact session role fingerprint.
    #[must_use]
    pub(super) fn role_identity(&self) -> &str {
        &self.role_identity
    }
}

/// Secret-free direct-measurement failure.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(super) enum PostgresMeasurementError {
    #[error("invalid PostgreSQL measurement specification")]
    InvalidSpecification,
    #[error("invalid PostgreSQL credential lease")]
    InvalidCredentialLease,
    #[error("PostgreSQL target URL is invalid")]
    InvalidTarget,
    #[error("PostgreSQL connection is unavailable")]
    ConnectionUnavailable,
    #[error("PostgreSQL read-only measurement transaction is unavailable")]
    TransactionUnavailable,
    #[error("PostgreSQL server/database/role identity query is unavailable")]
    IdentityQueryUnavailable,
    #[error("PostgreSQL server/database/role identity decoding is unavailable")]
    IdentityDecodeUnavailable,
    #[error("PostgreSQL TLS identity is unavailable")]
    TlsIdentityUnavailable,
    #[error("PostgreSQL schema identity is unavailable")]
    SchemaIdentityUnavailable,
    #[error("PostgreSQL migration identity is unavailable")]
    MigrationIdentityUnavailable,
    #[error("PostgreSQL function identity is unavailable")]
    FunctionIdentityUnavailable,
    #[error("PostgreSQL ACL identity is unavailable")]
    AclIdentityUnavailable,
    #[error("PostgreSQL catalog target is absent or ambiguous")]
    CatalogTargetMismatch,
    #[error("Market Data Source Binding storage snapshot is unavailable")]
    SnapshotUnavailable,
}

/// Read-only direct PostgreSQL target measurer for a pinned disposable loopback authority.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct PostgresDirectMeasurer;

impl PostgresDirectMeasurer {
    /// Connects with the resolved lease and measures the target in one read-only transaction.
    ///
    /// Non-loopback, non-test-database, and TLS targets fail closed. Authenticated production TLS
    /// remains unavailable until a peer-certificate and trust-policy measuring adapter exists. No
    /// DDL, role, credential, provider, or application mutation is performed.
    ///
    /// # Errors
    ///
    /// Returns a redacted failure when the connection or any exact catalog identity is unavailable.
    pub(super) async fn measure(
        &self,
        lease: &PostgresCredentialLease,
        spec: &PostgresMeasurementSpec,
    ) -> Result<PostgresMeasurement, PostgresMeasurementError> {
        let target = parse_target(lease.database_url())?;

        if ambient_pg_configuration_present() {
            return Err(PostgresMeasurementError::InvalidTarget);
        }
        let options = connect_options(&target, "vibe-market-data-store-admission-disposable-v1");
        let mut connection = PgConnection::connect_with(&options)
            .await
            .map_err(|_| PostgresMeasurementError::ConnectionUnavailable)?;
        let mut transaction = connection
            .begin()
            .await
            .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;
        sqlx::query("SET LOCAL statement_timeout = '5000ms'")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;
        sqlx::query("SET LOCAL lock_timeout = '1000ms'")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;

        let identity = sqlx::query(
            "SELECT (pg_catalog.pg_control_system()).system_identifier::text AS system_identifier, pg_catalog.current_setting('server_version_num')::text AS server_version, pg_catalog.inet_server_addr()::text AS server_address, pg_catalog.inet_server_port()::bigint AS server_port, pg_catalog.current_database()::text AS database_name, database.oid::bigint AS database_oid, current_user::text AS role_name, role.oid::bigint AS role_oid, role.rolsuper, role.rolinherit, role.rolcreaterole, role.rolcreatedb, role.rolcanlogin, role.rolreplication, role.rolbypassrls FROM pg_catalog.pg_database AS database JOIN pg_catalog.pg_roles AS role ON role.rolname = current_user WHERE database.datname = pg_catalog.current_database()",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::IdentityQueryUnavailable)?;
        let server_version: String = identity
            .try_get("server_version")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let system_identifier: String = identity
            .try_get("system_identifier")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let database_name: String = identity
            .try_get("database_name")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let database_oid: i64 = identity
            .try_get("database_oid")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let server_address: String = identity
            .try_get("server_address")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let server_port: i64 = identity
            .try_get("server_port")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let role_name: String = identity
            .try_get("role_name")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let role_attributes = (
            identity.try_get::<i64, _>("role_oid"),
            identity.try_get::<bool, _>("rolsuper"),
            identity.try_get::<bool, _>("rolinherit"),
            identity.try_get::<bool, _>("rolcreaterole"),
            identity.try_get::<bool, _>("rolcreatedb"),
            identity.try_get::<bool, _>("rolcanlogin"),
            identity.try_get::<bool, _>("rolreplication"),
            identity.try_get::<bool, _>("rolbypassrls"),
        );
        let role_record = match role_attributes {
            (
                Ok(role_oid),
                Ok(superuser),
                Ok(inherit),
                Ok(create_role),
                Ok(create_database),
                Ok(can_login),
                Ok(replication),
                Ok(bypass_rls),
            ) => (
                role_name.clone(),
                role_oid,
                superuser,
                inherit,
                create_role,
                create_database,
                can_login,
                replication,
                bypass_rls,
            ),
            _ => return Err(PostgresMeasurementError::IdentityDecodeUnavailable),
        };

        if database_name != target.database || role_name != target.role {
            return Err(PostgresMeasurementError::InvalidTarget);
        }
        let role_membership_rows = sqlx::query(
            "WITH RECURSIVE membership_path AS (SELECT membership.roleid, membership.member, membership.grantor, membership.admin_option, membership.inherit_option, membership.set_option, ARRAY[membership.member, membership.roleid] AS path, 1::bigint AS depth FROM pg_catalog.pg_auth_members AS membership JOIN pg_catalog.pg_roles AS session_role ON session_role.oid = membership.member WHERE session_role.rolname = current_user UNION ALL SELECT next.roleid, next.member, next.grantor, next.admin_option, next.inherit_option, next.set_option, prior.path || next.roleid, prior.depth + 1 FROM membership_path AS prior JOIN pg_catalog.pg_auth_members AS next ON next.member = prior.roleid WHERE prior.depth < 33 AND NOT next.roleid = ANY(prior.path)) SELECT granted_role.rolname::text AS role_name, pg_catalog.pg_get_userbyid(path.member)::text AS member_name, pg_catalog.pg_get_userbyid(path.grantor)::text AS grantor_name, path.admin_option, path.inherit_option, path.set_option, path.depth, granted_role.rolsuper AS role_super, granted_role.rolinherit AS role_inherit, granted_role.rolcreaterole AS role_create_role, granted_role.rolcreatedb AS role_create_database, granted_role.rolcanlogin AS role_can_login, granted_role.rolreplication AS role_replication, granted_role.rolbypassrls AS role_bypass_rls FROM membership_path AS path JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = path.roleid ORDER BY path.depth, role_name, member_name, grantor_name LIMIT 257",
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::IdentityQueryUnavailable)?;
        if role_membership_rows.len() > 256 {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }

        for row in &role_membership_rows {
            let depth: i64 = row
                .try_get("depth")
                .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
            if depth > 32 {
                return Err(PostgresMeasurementError::CatalogTargetMismatch);
            }
        }
        let role_membership_identity = rows_digest(
            &role_membership_rows,
            &[
                "role_name",
                "member_name",
                "grantor_name",
                "admin_option",
                "inherit_option",
                "set_option",
                "depth",
                "role_super",
                "role_inherit",
                "role_create_role",
                "role_create_database",
                "role_can_login",
                "role_replication",
                "role_bypass_rls",
            ],
        )?;

        let tls = sqlx::query(
            "SELECT ssl, COALESCE(version, '')::text AS protocol, COALESCE(cipher, '')::text AS cipher FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::TlsIdentityUnavailable)?;
        let tls_enabled: bool = tls
            .try_get("ssl")
            .map_err(|_| PostgresMeasurementError::TlsIdentityUnavailable)?;
        let protocol: String = tls
            .try_get("protocol")
            .map_err(|_| PostgresMeasurementError::TlsIdentityUnavailable)?;
        let cipher: String = tls
            .try_get("cipher")
            .map_err(|_| PostgresMeasurementError::TlsIdentityUnavailable)?;
        if tls_enabled || !protocol.is_empty() || !cipher.is_empty() {
            return Err(PostgresMeasurementError::TlsIdentityUnavailable);
        }
        let tls_identity = PostgresTlsIdentity::disposable_plaintext(&target.host);

        let schema_rows = sqlx::query(
            "SELECT namespace.oid::bigint AS oid, namespace.nspname::text AS name, pg_catalog.pg_get_userbyid(namespace.nspowner)::text AS owner, COALESCE(namespace.nspacl::text, 'DEFAULT') AS acl FROM pg_catalog.pg_namespace AS namespace WHERE namespace.nspname = $1",
        )
        .bind(&spec.schema_name)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SchemaIdentityUnavailable)?;
        if schema_rows.len() != 1 {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }
        let schema_identity = rows_digest(&schema_rows, &["oid", "name", "owner", "acl"])?;

        let migration_rows = sqlx::query(
            "SELECT class.oid::bigint AS relation_oid, namespace.nspname::text AS schema_name, class.relname::text AS relation_name, class.relkind::text AS relation_kind, pg_catalog.pg_get_userbyid(class.relowner)::text AS owner, attribute.attnum::bigint AS ordinal, attribute.attname::text AS column_name, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text AS column_type, attribute.attnotnull, COALESCE(pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), '')::text AS default_expression FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = class.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped LEFT JOIN pg_catalog.pg_attrdef AS default_value ON default_value.adrelid = class.oid AND default_value.adnum = attribute.attnum WHERE class.oid = pg_catalog.to_regclass($1) ORDER BY attribute.attnum",
        )
        .bind(&spec.migration_relation)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::MigrationIdentityUnavailable)?;
        if migration_rows.is_empty() {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }
        let migration_definition_identity = rows_digest(
            &migration_rows,
            &[
                "relation_oid",
                "schema_name",
                "relation_name",
                "relation_kind",
                "owner",
                "ordinal",
                "column_name",
                "column_type",
                "attnotnull",
                "default_expression",
            ],
        )?;
        let migration_relation = quoted_qualified_name(&spec.migration_relation)
            .ok_or(PostgresMeasurementError::InvalidSpecification)?;
        let migration_budget_query = format!(
            "SELECT COUNT(*)::bigint AS row_count, COALESCE(MAX(pg_catalog.octet_length(pg_catalog.to_jsonb(migration_row)::text)), 0)::bigint AS max_row_bytes FROM {migration_relation} AS migration_row"
        );
        let migration_budget = sqlx::query(AssertSqlSafe(migration_budget_query))
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::MigrationIdentityUnavailable)?;
        let migration_row_count: i64 = migration_budget
            .try_get("row_count")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let migration_max_row_bytes: i64 = migration_budget
            .try_get("max_row_bytes")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        if migration_row_count > 10_000 || migration_max_row_bytes > 65_536 {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }
        let migration_content_query = format!(
            "SELECT pg_catalog.to_jsonb(migration_row)::text AS row_json FROM {migration_relation} AS migration_row ORDER BY pg_catalog.to_jsonb(migration_row)::text LIMIT 10001"
        );
        let migration_content_rows = sqlx::query(AssertSqlSafe(migration_content_query))
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::MigrationIdentityUnavailable)?;

        if migration_content_rows.len() > 10_000 {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }
        let migration_content_identity = rows_digest(&migration_content_rows, &["row_json"])?;
        let migration_identity =
            digest_serializable(&(migration_definition_identity, migration_content_identity));

        let mut function_records = Vec::with_capacity(spec.function_signatures.len());
        for signature in &spec.function_signatures {
            let row = sqlx::query(
                "SELECT procedure.oid::bigint AS oid, pg_catalog.pg_get_function_identity_arguments(procedure.oid)::text AS arguments, pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner, procedure.prosecdef, procedure.provolatile::text AS volatility, COALESCE(procedure.proacl::text, 'DEFAULT') AS acl, pg_catalog.pg_get_functiondef(procedure.oid)::text AS definition FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = pg_catalog.to_regprocedure($1)",
            )
            .bind(signature)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::FunctionIdentityUnavailable)?;
            if row.len() != 1 {
                return Err(PostgresMeasurementError::CatalogTargetMismatch);
            }
            function_records.push(rows_digest(
                &row,
                &[
                    "oid",
                    "arguments",
                    "owner",
                    "prosecdef",
                    "volatility",
                    "acl",
                    "definition",
                ],
            )?);
        }
        let function_identity = digest_parts(&function_records);

        let mut acl_records = Vec::with_capacity(spec.acl_relations.len() + 1);
        acl_records.push(schema_identity.clone());

        for relation in &spec.acl_relations {
            let rows = sqlx::query(
                "SELECT class.oid::bigint AS oid, namespace.nspname::text AS schema_name, class.relname::text AS relation_name, pg_catalog.pg_get_userbyid(class.relowner)::text AS owner, COALESCE(class.relacl::text, 'DEFAULT') AS acl, class.relrowsecurity, class.relforcerowsecurity FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE class.oid = pg_catalog.to_regclass($1)",
            )
            .bind(relation)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::AclIdentityUnavailable)?;
            if rows.len() != 1 {
                return Err(PostgresMeasurementError::CatalogTargetMismatch);
            }
            acl_records.push(rows_digest(
                &rows,
                &[
                    "oid",
                    "schema_name",
                    "relation_name",
                    "owner",
                    "acl",
                    "relrowsecurity",
                    "relforcerowsecurity",
                ],
            )?);
            let column_rows = sqlx::query(
                "SELECT attribute.attnum::bigint AS ordinal, attribute.attname::text AS column_name, COALESCE(attribute.attacl::text, 'DEFAULT') AS acl FROM pg_catalog.pg_attribute AS attribute WHERE attribute.attrelid = pg_catalog.to_regclass($1) AND attribute.attnum > 0 AND NOT attribute.attisdropped ORDER BY attribute.attnum",
            )
            .bind(relation)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::AclIdentityUnavailable)?;
            acl_records.push(rows_digest(
                &column_rows,
                &["ordinal", "column_name", "acl"],
            )?);
            let policy_rows = sqlx::query(
                "SELECT policy.polname::text AS policy_name, policy.polpermissive, policy.polcmd::text AS command, policy.polroles::text AS roles, LEFT(COALESCE(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')::text, 65537) AS using_expression, LEFT(COALESCE(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')::text, 65537) AS check_expression FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = pg_catalog.to_regclass($1) ORDER BY policy.polname LIMIT 257",
            )
            .bind(relation)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::AclIdentityUnavailable)?;
            if policy_rows.len() > 256 {
                return Err(PostgresMeasurementError::CatalogTargetMismatch);
            }

            for row in &policy_rows {
                let using_expression: String = row
                    .try_get("using_expression")
                    .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
                let check_expression: String = row
                    .try_get("check_expression")
                    .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
                if using_expression.len() > 65_536 || check_expression.len() > 65_536 {
                    return Err(PostgresMeasurementError::CatalogTargetMismatch);
                }
            }
            acl_records.push(rows_digest(
                &policy_rows,
                &[
                    "policy_name",
                    "polpermissive",
                    "command",
                    "roles",
                    "using_expression",
                    "check_expression",
                ],
            )?);
        }
        let acl_identity = digest_parts(&acl_records);

        transaction
            .rollback()
            .await
            .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;

        Ok(PostgresMeasurement {
            endpoint_identity: format!(
                "postgresql-requested://{}:{};observed://{server_address}:{server_port}",
                target.host, target.port
            ),
            tls_identity,
            server_identity: format!(
                "postgres-system:{system_identifier}:server:{server_version}@{server_address}:{server_port}"
            ),
            database_identity: format!("postgres-database:{database_name}:{database_oid}"),
            schema_identity,
            migration_identity,
            function_identity,
            role_identity: digest_serializable(&(role_record, role_membership_identity)),
            acl_identity,
        })
    }
}

struct ParsedTarget {
    host: String,
    port: u16,
    database: String,
    role: String,
    password: Zeroizing<String>,
}

fn connect_options(target: &ParsedTarget, application_name: &str) -> PgConnectOptions {
    PgConnectOptions::new_without_pgpass()
        .host(&target.host)
        .port(target.port)
        .username(&target.role)
        .password(target.password.as_str())
        .database(&target.database)
        .ssl_mode(PgSslMode::Disable)
        .application_name(application_name)
}

fn parse_target(database_url: &str) -> Result<ParsedTarget, PostgresMeasurementError> {
    let parsed = Url::parse(database_url).map_err(|_| PostgresMeasurementError::InvalidTarget)?;
    let database = parsed.path().trim_start_matches('/');
    let role = parsed.username();
    let password = parsed.password().unwrap_or("");
    if !matches!(parsed.scheme(), "postgres" | "postgresql")
        || parsed.host_str().is_none()
        || !safe_opaque_identity(role)
        || !safe_opaque_identity(database)
        || !database.starts_with("vibe_test_")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || role.contains('%')
        || database.contains('%')
        || password.contains('%')
    {
        return Err(PostgresMeasurementError::InvalidTarget);
    }
    let host = parsed
        .host_str()
        .ok_or(PostgresMeasurementError::InvalidTarget)?
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();

    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1") {
        return Err(PostgresMeasurementError::InvalidTarget);
    }
    Ok(ParsedTarget {
        host,
        port: parsed.port().unwrap_or(5432),
        database: database.to_string(),
        role: role.to_string(),
        password: Zeroizing::new(password.to_string()),
    })
}

fn ambient_pg_configuration_present() -> bool {
    ambient_pg_configuration_present_with(|name| std::env::var_os(name).is_some())
}

pub(super) fn ambient_pg_configuration_present_with(mut present: impl FnMut(&str) -> bool) -> bool {
    const PG_ENVIRONMENT: [&str; 15] = [
        "PGPORT",
        "PGHOSTADDR",
        "PGHOST",
        "PGUSER",
        "PGDATABASE",
        "PGPASSWORD",
        "PGSSLROOTCERT",
        "PGSSLCERT",
        "PGSSLKEY",
        "PGSSLMODE",
        "PGAPPNAME",
        "PGOPTIONS",
        "PGPASSFILE",
        "PGSERVICE",
        "PGSERVICEFILE",
    ];
    PG_ENVIRONMENT.iter().any(|name| present(name))
}

fn safe_opaque_identity(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn canonical_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
}

fn canonical_function_signature(value: &str) -> bool {
    let Some((qualified_name, arguments)) = value.split_once('(') else {
        return false;
    };
    let Some(arguments) = arguments.strip_suffix(')') else {
        return false;
    };

    if value.matches('(').count() != 1 || value.matches(')').count() != 1 {
        return false;
    }
    let mut name_parts = qualified_name.split('.');
    let Some(schema) = name_parts.next() else {
        return false;
    };
    let Some(function) = name_parts.next() else {
        return false;
    };

    name_parts.next().is_none()
        && canonical_identifier(schema)
        && canonical_identifier(function)
        && arguments.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'_' | b'$' | b'.' | b',' | b' ' | b'[' | b']')
        })
}

fn quoted_qualified_name(value: &str) -> Option<String> {
    let mut parts = value.split('.');
    let schema = parts.next()?;
    let relation = parts.next()?;

    if parts.next().is_some() || !canonical_identifier(schema) || !canonical_identifier(relation) {
        return None;
    }
    Some(format!("\"{schema}\".\"{relation}\""))
}

fn rows_digest(
    rows: &[sqlx::postgres::PgRow],
    columns: &[&str],
) -> Result<String, PostgresMeasurementError> {
    let mut records = Vec::with_capacity(rows.len());
    for row in rows {
        let mut record = Vec::with_capacity(columns.len());
        for column in columns {
            let value = if let Ok(value) = row.try_get::<String, _>(*column) {
                value
            } else if let Ok(value) = row.try_get::<i64, _>(*column) {
                value.to_string()
            } else if let Ok(value) = row.try_get::<bool, _>(*column) {
                value.to_string()
            } else {
                return Err(PostgresMeasurementError::IdentityDecodeUnavailable);
            };
            record.push(((*column).to_string(), value));
        }
        records.push(record);
    }
    Ok(digest_serializable(&records))
}

fn digest_parts(parts: &[String]) -> String {
    digest_serializable(parts)
}

fn digest_serializable(value: &(impl Serialize + ?Sized)) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(71);
    output.push_str("sha256:");

    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}
