use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction, postgres::PgConnectOptions};
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionLocatorV1,
    resolve_admission_for_downstream_in_transaction,
};

use crate::artifact_build::ArtifactBuildError;

pub(crate) const DRAIN_EVENT_KIND: &str = "LEGACY_PREPARED_ATTEMPT_DRAINED_V1";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LegacyPreparedAttemptBindingV1 {
    pub build_request_identity: String,
    pub attempt_identity: String,
    pub request_semantic_digest: String,
    pub attempt_json_digest: String,
    pub prepared_at_epoch_ms: u64,
    pub admission: ProductEdgeAdmissionLocatorV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LegacyDrainTargetDatabaseIdentityV1 {
    pub schema_version: u32,
    pub database_name: String,
    pub database_oid: u32,
    pub role_name: String,
    pub role_oid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LegacyPreparedAttemptAbsenceProofV1 {
    pub attempt_invocation_claim_count: u32,
    pub attempt_invocation_custody_count: u32,
    pub effect_invocation_admission_count: u32,
    pub effect_invocation_claim_count: u32,
    pub effect_invocation_state_count: u32,
    pub artifact_count: u32,
    pub attempt_outbox_count: u32,
    pub provider_start_custody_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProductEdgeDrainLockV1 {
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProductEdgeAttemptAbsenceV1 {
    schema_version: u32,
    effect_invocation_admission_count: u32,
    effect_invocation_claim_count: u32,
    effect_invocation_state_count: u32,
    provider_start_custody_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LegacyPreparedAttemptDrainReceiptV1 {
    pub schema_version: u32,
    pub receipt_identity: String,
    pub receipt_digest: String,
    pub attempt: LegacyPreparedAttemptBindingV1,
    pub disposition: String,
    pub provider_disposition: String,
    pub absence_proof: LegacyPreparedAttemptAbsenceProofV1,
    pub target_database_identity: LegacyDrainTargetDatabaseIdentityV1,
    pub database_endpoint_resource_fingerprint: String,
    pub database_resource_fingerprint: String,
    pub committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ReceiptMeaningV1<'a> {
    schema_version: u32,
    attempt: &'a LegacyPreparedAttemptBindingV1,
    disposition: &'a str,
    provider_disposition: &'a str,
    absence_proof: &'a LegacyPreparedAttemptAbsenceProofV1,
    target_database_identity: &'a LegacyDrainTargetDatabaseIdentityV1,
    database_endpoint_resource_fingerprint: &'a str,
    database_resource_fingerprint: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct LegacyDrainTargetDatabaseEndpointV1<'a> {
    schema_version: u32,
    username: &'a str,
    host: String,
    port: u16,
    database: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DrainOutboxPayloadV1 {
    schema_version: u32,
    receipt_identity: String,
    receipt_digest: String,
    build_request_identity: String,
    attempt_identity: String,
    attempt_json_digest: String,
    admission_identity: String,
    admission_digest: String,
    disposition: String,
    provider_disposition: String,
}

pub(crate) async fn migrate(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ArtifactBuildError> {
    sqlx::query("CREATE TABLE IF NOT EXISTS rd_legacy_prepared_attempt_drain_receipts_v1 (receipt_identity TEXT PRIMARY KEY, receipt_digest TEXT NOT NULL, build_request_identity TEXT NOT NULL UNIQUE, attempt_identity TEXT NOT NULL UNIQUE, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)")
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    for statement in [
        "ALTER TABLE rd_legacy_prepared_attempt_drain_receipts_v1 OWNER TO rd_owner",
        "REVOKE ALL ON TABLE rd_legacy_prepared_attempt_drain_receipts_v1 FROM PUBLIC, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner",
        "CREATE OR REPLACE FUNCTION rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''legacy PREPARED drain receipts are immutable''; END'",
        "ALTER FUNCTION rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1() OWNER TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1() FROM PUBLIC",
        "DROP TRIGGER IF EXISTS rd_legacy_prepared_attempt_drain_immutable_v1 ON rd_legacy_prepared_attempt_drain_receipts_v1",
        "CREATE TRIGGER rd_legacy_prepared_attempt_drain_immutable_v1 BEFORE UPDATE OR DELETE ON rd_legacy_prepared_attempt_drain_receipts_v1 FOR EACH ROW EXECUTE FUNCTION rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()",
    ] {
        sqlx::query(statement)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;
    }
    let owner: String = sqlx::query_scalar("SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class WHERE oid='rd_legacy_prepared_attempt_drain_receipts_v1'::pg_catalog.regclass")
        .fetch_one(&mut **transaction).await.map_err(storage)?;
    let leaked: bool = sqlx::query_scalar("SELECT pg_catalog.has_table_privilege('public','rd_legacy_prepared_attempt_drain_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_table_privilege('product_edge_owner','rd_legacy_prepared_attempt_drain_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_table_privilege('operator_authorization_owner','rd_legacy_prepared_attempt_drain_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_table_privilege('operator_authorization_writer','rd_legacy_prepared_attempt_drain_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_table_privilege('qualification_owner','rd_legacy_prepared_attempt_drain_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_table_privilege('qualification_writer','rd_legacy_prepared_attempt_drain_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_table_privilege('backtest_owner','rd_legacy_prepared_attempt_drain_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')")
        .fetch_one(&mut **transaction).await.map_err(storage)?;
    if owner != "rd_owner" || leaked {
        return Err(unavailable("legacy PREPARED drain receipt ACL mismatch"));
    }
    Ok(())
}

pub(crate) fn attempt_json_digest(value: &serde_json::Value) -> Result<String, ArtifactBuildError> {
    let bytes = serde_json::to_vec(value).map_err(json_storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

#[allow(
    dead_code,
    reason = "receipt formation is consumed by the separately admitted explicit admin drain binary"
)]
pub(crate) fn form_receipt(
    attempt: LegacyPreparedAttemptBindingV1,
    absence_proof: LegacyPreparedAttemptAbsenceProofV1,
    target_database_identity: LegacyDrainTargetDatabaseIdentityV1,
    database_endpoint_resource_fingerprint: String,
    database_resource_fingerprint: String,
    committed_at_epoch_ms: u64,
) -> Result<LegacyPreparedAttemptDrainReceiptV1, ArtifactBuildError> {
    let mut receipt = LegacyPreparedAttemptDrainReceiptV1 {
        schema_version: 1,
        receipt_identity: String::new(),
        receipt_digest: String::new(),
        attempt,
        disposition: "OUTCOME_UNKNOWN".into(),
        provider_disposition: "PROVIDER_NEVER_STARTED".into(),
        absence_proof,
        target_database_identity,
        database_endpoint_resource_fingerprint,
        database_resource_fingerprint,
        committed_at_epoch_ms,
    };
    receipt.receipt_digest = receipt_digest(&receipt)?;
    receipt.receipt_identity = format!(
        "rd-legacy-prepared-attempt-drain-receipt-v1-{}",
        receipt.receipt_digest.trim_start_matches("sha256:")
    );
    verify_receipt(
        &receipt,
        &receipt.attempt,
        &receipt.target_database_identity,
    )?;
    Ok(receipt)
}

#[allow(
    dead_code,
    reason = "receipt append is consumed by the separately admitted explicit admin drain binary"
)]
pub(crate) async fn append_receipt_and_outbox_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    receipt: &LegacyPreparedAttemptDrainReceiptV1,
) -> Result<(), ArtifactBuildError> {
    verify_receipt(receipt, &receipt.attempt, &receipt.target_database_identity)?;
    let (target_database_identity, live_absence) =
        verify_live_predicates_in_transaction(transaction, &receipt.attempt).await?;
    if receipt.target_database_identity != target_database_identity
        || receipt.absence_proof != live_absence
    {
        return Err(unavailable("legacy PREPARED drain live predicates changed"));
    }
    let payload = outbox_payload(receipt);
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;
    let event_identity = format!(
        "rd-owner-event-v1-{}",
        payload_digest.trim_start_matches("sha256:")
    );
    let committed_at = i64::try_from(receipt.committed_at_epoch_ms).map_err(json_storage)?;
    sqlx::query("INSERT INTO rd_legacy_prepared_attempt_drain_receipts_v1 (receipt_identity,receipt_digest,build_request_identity,attempt_identity,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&receipt.receipt_identity).bind(&receipt.receipt_digest)
        .bind(&receipt.attempt.build_request_identity).bind(&receipt.attempt.attempt_identity)
        .bind(serde_json::to_value(receipt).map_err(json_storage)?).bind(committed_at)
        .execute(&mut **transaction).await.map_err(storage)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity).bind(&receipt.attempt.attempt_identity).bind(DRAIN_EVENT_KIND)
        .bind(payload_digest).bind(serde_json::to_value(payload).map_err(json_storage)?)
        .bind(committed_at).execute(&mut **transaction).await.map_err(storage)?;
    Ok(())
}

pub(crate) async fn verify_drain_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &LegacyPreparedAttemptBindingV1,
    expected_database_endpoint_resource_fingerprint: &str,
) -> Result<LegacyPreparedAttemptDrainReceiptV1, ArtifactBuildError> {
    let (target_database_identity, live_absence) =
        verify_live_predicates_in_transaction(transaction, expected).await?;
    let rows = sqlx::query("SELECT receipt_identity,receipt_digest,build_request_identity,attempt_identity,receipt_json,committed_at_epoch_ms FROM rd_legacy_prepared_attempt_drain_receipts_v1 WHERE build_request_identity=$1 OR attempt_identity=$2 FOR SHARE")
        .bind(&expected.build_request_identity).bind(&expected.attempt_identity)
        .fetch_all(&mut **transaction).await.map_err(storage)?;
    if rows.len() != 1 {
        return Err(unavailable("legacy PREPARED drain receipt unavailable"));
    }
    let row = &rows[0];
    let value: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let receipt: LegacyPreparedAttemptDrainReceiptV1 = decode_exact(&value)?;
    verify_receipt(&receipt, expected, &target_database_identity)?;
    if receipt.database_endpoint_resource_fingerprint
        != expected_database_endpoint_resource_fingerprint
    {
        return Err(unavailable(
            "legacy PREPARED drain database endpoint mismatch",
        ));
    }
    if receipt.absence_proof != live_absence {
        return Err(unavailable(
            "legacy PREPARED drain live absence proof changed",
        ));
    }
    if row
        .try_get::<String, _>("receipt_identity")
        .map_err(storage)?
        != receipt.receipt_identity
        || row
            .try_get::<String, _>("receipt_digest")
            .map_err(storage)?
            != receipt.receipt_digest
        || row
            .try_get::<String, _>("build_request_identity")
            .map_err(storage)?
            != expected.build_request_identity
        || row
            .try_get::<String, _>("attempt_identity")
            .map_err(storage)?
            != expected.attempt_identity
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms).map_err(json_storage)?
    {
        return Err(unavailable("legacy PREPARED drain receipt row mismatch"));
    }
    let outbox = sqlx::query("SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(&expected.attempt_identity).bind(DRAIN_EVENT_KIND)
        .fetch_all(&mut **transaction).await.map_err(storage)?;
    if outbox.len() != 1 {
        return Err(unavailable("legacy PREPARED drain outbox unavailable"));
    }
    verify_outbox(&outbox[0], &receipt)?;
    Ok(receipt)
}

pub(crate) async fn verify_live_predicates_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &LegacyPreparedAttemptBindingV1,
) -> Result<
    (
        LegacyDrainTargetDatabaseIdentityV1,
        LegacyPreparedAttemptAbsenceProofV1,
    ),
    ArtifactBuildError,
> {
    let admission = resolve_admission_for_downstream_in_transaction(
        transaction,
        &expected.admission,
        DownstreamAdmissionModeV1::Historical,
    )
    .await
    .map_err(|_| unavailable("legacy PREPARED Product Edge admission unavailable"))?;
    if admission.locator() != &expected.admission {
        return Err(unavailable(
            "legacy PREPARED Product Edge admission mismatch",
        ));
    }
    let target_database_identity = current_database_identity(transaction).await?;
    let live_absence = live_absence_proof(transaction, expected).await?;
    Ok((target_database_identity, live_absence))
}

pub(crate) async fn lock_product_edge_effects_for_drain_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ArtifactBuildError> {
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1()",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let lock: ProductEdgeDrainLockV1 =
        decode_exact(&value.ok_or_else(|| unavailable("Product Edge drain lock unavailable"))?)?;
    if lock.schema_version != 1 {
        return Err(unavailable("Product Edge drain lock mismatch"));
    }
    Ok(())
}

fn verify_receipt(
    receipt: &LegacyPreparedAttemptDrainReceiptV1,
    expected: &LegacyPreparedAttemptBindingV1,
    target_database_identity: &LegacyDrainTargetDatabaseIdentityV1,
) -> Result<(), ArtifactBuildError> {
    let zero = &receipt.absence_proof;
    if receipt.schema_version != 1
        || &receipt.attempt != expected
        || expected.admission.request_identity != expected.build_request_identity
        || expected.admission.admission_identity.trim().is_empty()
        || !is_sha256(&expected.admission.admission_digest)
        || !is_sha256(&expected.request_semantic_digest)
        || !is_sha256(&expected.attempt_json_digest)
        || receipt.disposition != "OUTCOME_UNKNOWN"
        || receipt.provider_disposition != "PROVIDER_NEVER_STARTED"
        || zero.attempt_invocation_claim_count != 0
        || zero.attempt_invocation_custody_count != 0
        || zero.effect_invocation_admission_count != 0
        || zero.effect_invocation_claim_count != 0
        || zero.effect_invocation_state_count != 0
        || zero.artifact_count != 0
        || zero.attempt_outbox_count != 0
        || zero.provider_start_custody_count != 0
        || &receipt.target_database_identity != target_database_identity
        || !is_sha256(&receipt.database_endpoint_resource_fingerprint)
        || receipt.database_resource_fingerprint != database_fingerprint(target_database_identity)?
        || receipt.committed_at_epoch_ms < expected.prepared_at_epoch_ms
        || receipt.receipt_digest != receipt_digest(receipt)?
        || receipt.receipt_identity
            != format!(
                "rd-legacy-prepared-attempt-drain-receipt-v1-{}",
                receipt.receipt_digest.trim_start_matches("sha256:")
            )
    {
        return Err(unavailable("legacy PREPARED drain receipt mismatch"));
    }
    Ok(())
}

fn verify_outbox(
    row: &sqlx::postgres::PgRow,
    receipt: &LegacyPreparedAttemptDrainReceiptV1,
) -> Result<(), ArtifactBuildError> {
    let payload_value: serde_json::Value = row.try_get("payload_json").map_err(storage)?;
    let payload: DrainOutboxPayloadV1 = decode_exact(&payload_value)?;
    let expected = outbox_payload(receipt);
    let digest = canonical_digest("rd.owner-outbox.payload.v1", &expected)?;
    if payload != expected
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != receipt.attempt.attempt_identity
        || row.try_get::<String, _>("event_kind").map_err(storage)? != DRAIN_EVENT_KIND
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != digest
        || row
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != format!("rd-owner-event-v1-{}", digest.trim_start_matches("sha256:"))
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms).map_err(json_storage)?
    {
        return Err(unavailable("legacy PREPARED drain outbox mismatch"));
    }
    Ok(())
}

fn outbox_payload(receipt: &LegacyPreparedAttemptDrainReceiptV1) -> DrainOutboxPayloadV1 {
    DrainOutboxPayloadV1 {
        schema_version: 1,
        receipt_identity: receipt.receipt_identity.clone(),
        receipt_digest: receipt.receipt_digest.clone(),
        build_request_identity: receipt.attempt.build_request_identity.clone(),
        attempt_identity: receipt.attempt.attempt_identity.clone(),
        attempt_json_digest: receipt.attempt.attempt_json_digest.clone(),
        admission_identity: receipt.attempt.admission.admission_identity.clone(),
        admission_digest: receipt.attempt.admission.admission_digest.clone(),
        disposition: receipt.disposition.clone(),
        provider_disposition: receipt.provider_disposition.clone(),
    }
}

fn receipt_digest(
    receipt: &LegacyPreparedAttemptDrainReceiptV1,
) -> Result<String, ArtifactBuildError> {
    canonical_digest(
        "rd.legacy-prepared-attempt-drain-receipt.v1",
        &ReceiptMeaningV1 {
            schema_version: receipt.schema_version,
            attempt: &receipt.attempt,
            disposition: &receipt.disposition,
            provider_disposition: &receipt.provider_disposition,
            absence_proof: &receipt.absence_proof,
            target_database_identity: &receipt.target_database_identity,
            database_endpoint_resource_fingerprint: &receipt.database_endpoint_resource_fingerprint,
            database_resource_fingerprint: &receipt.database_resource_fingerprint,
            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
        },
    )
}

pub(crate) async fn current_database_identity(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<LegacyDrainTargetDatabaseIdentityV1, ArtifactBuildError> {
    let row = sqlx::query("SELECT pg_catalog.current_database() AS database_name, (SELECT oid::bigint FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) AS database_oid, current_user::text AS role_name, (SELECT oid::bigint FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_oid")
        .fetch_one(&mut **transaction).await.map_err(storage)?;
    Ok(LegacyDrainTargetDatabaseIdentityV1 {
        schema_version: 1,
        database_name: row.try_get("database_name").map_err(storage)?,
        database_oid: u32::try_from(row.try_get::<i64, _>("database_oid").map_err(storage)?)
            .map_err(json_storage)?,
        role_name: row.try_get("role_name").map_err(storage)?,
        role_oid: u32::try_from(row.try_get::<i64, _>("role_oid").map_err(storage)?)
            .map_err(json_storage)?,
    })
}

async fn live_absence_proof(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &LegacyPreparedAttemptBindingV1,
) -> Result<LegacyPreparedAttemptAbsenceProofV1, ArtifactBuildError> {
    let attempts = sqlx::query("SELECT build_request_identity,attempt_identity,semantic_digest,attempt_json,prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1 OR attempt_identity=$2 FOR SHARE")
        .bind(&expected.build_request_identity)
        .bind(&expected.attempt_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if attempts.len() != 1 {
        return Err(unavailable("legacy PREPARED attempt row unavailable"));
    }
    let attempt = &attempts[0];
    let attempt_json: serde_json::Value = attempt.try_get("attempt_json").map_err(storage)?;
    let prepared_at_epoch_ms = u64::try_from(
        attempt
            .try_get::<i64, _>("prepared_at_epoch_ms")
            .map_err(storage)?,
    )
    .map_err(json_storage)?;
    if attempt
        .try_get::<String, _>("build_request_identity")
        .map_err(storage)?
        != expected.build_request_identity
        || attempt
            .try_get::<String, _>("attempt_identity")
            .map_err(storage)?
            != expected.attempt_identity
        || attempt
            .try_get::<String, _>("semantic_digest")
            .map_err(storage)?
            != expected.request_semantic_digest
        || prepared_at_epoch_ms != expected.prepared_at_epoch_ms
        || attempt_json_digest(&attempt_json)? != expected.attempt_json_digest
    {
        return Err(unavailable("legacy PREPARED attempt row mismatch"));
    }
    let attempt_object = attempt_json
        .as_object()
        .ok_or_else(|| unavailable("legacy PREPARED attempt encoding mismatch"))?;
    let attempt_invocation_claim_count = u32::from(attempt_object.contains_key("invocation_claim"));
    let attempt_invocation_custody_count =
        u32::from(attempt_object.contains_key("invocation_custody"));
    let product_edge_absence_value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT product_edge_api.read_legacy_prepared_attempt_absence_v1($1,$2)",
    )
    .bind(&expected.admission.admission_identity)
    .bind(&expected.attempt_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let product_edge_absence: ProductEdgeAttemptAbsenceV1 = decode_exact(
        &product_edge_absence_value
            .ok_or_else(|| unavailable("Product Edge attempt absence unavailable"))?,
    )?;
    if product_edge_absence.schema_version != 1
        || product_edge_absence.effect_invocation_admission_count > 2
        || product_edge_absence.effect_invocation_claim_count > 2
        || product_edge_absence.effect_invocation_state_count > 2
        || product_edge_absence.provider_start_custody_count
            > product_edge_absence.effect_invocation_state_count
    {
        return Err(unavailable("Product Edge attempt absence mismatch"));
    }
    let artifact_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM rd_strategy_artifacts_v1 WHERE attempt_identity=$1",
    )
    .bind(&expected.attempt_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let attempt_outbox_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE (aggregate_identity=$1 OR aggregate_identity=$2) AND event_kind<>$3")
        .bind(&expected.build_request_identity).bind(&expected.attempt_identity).bind(DRAIN_EVENT_KIND)
        .fetch_one(&mut **transaction).await.map_err(storage)?;
    Ok(LegacyPreparedAttemptAbsenceProofV1 {
        attempt_invocation_claim_count,
        attempt_invocation_custody_count,
        effect_invocation_admission_count: product_edge_absence.effect_invocation_admission_count,
        effect_invocation_claim_count: product_edge_absence.effect_invocation_claim_count,
        effect_invocation_state_count: product_edge_absence.effect_invocation_state_count,
        artifact_count: to_u32(artifact_count)?,
        attempt_outbox_count: to_u32(attempt_outbox_count)?,
        provider_start_custody_count: product_edge_absence.provider_start_custody_count,
    })
}

fn to_u32(value: i64) -> Result<u32, ArtifactBuildError> {
    u32::try_from(value).map_err(json_storage)
}

pub(crate) fn database_fingerprint(
    identity: &LegacyDrainTargetDatabaseIdentityV1,
) -> Result<String, ArtifactBuildError> {
    canonical_digest(
        "rd.legacy-prepared-attempt-drain-target-database.v1",
        identity,
    )
}

pub(crate) fn database_endpoint_resource_fingerprint(
    database_url: &str,
) -> Result<String, ArtifactBuildError> {
    if !has_explicit_network_database_route(database_url) {
        return Err(unavailable(
            "legacy PREPARED drain database endpoint unavailable",
        ));
    }
    let options = database_url
        .parse::<PgConnectOptions>()
        .map_err(|_| unavailable("legacy PREPARED drain database endpoint unavailable"))?;
    let username = options.get_username();
    let host = options.get_host();
    let database = options
        .get_database()
        .ok_or_else(|| unavailable("legacy PREPARED drain database endpoint unavailable"))?;
    if options.get_socket().is_some()
        || host.starts_with('/')
        || username.trim().is_empty()
        || host.trim().is_empty()
        || database.trim().is_empty()
    {
        return Err(unavailable(
            "legacy PREPARED drain database endpoint unavailable",
        ));
    }
    canonical_digest(
        "rd.legacy-prepared-attempt-drain-target-database-endpoint.v1",
        &LegacyDrainTargetDatabaseEndpointV1 {
            schema_version: 1,
            username,
            host: host.to_ascii_lowercase(),
            port: options.get_port(),
            database,
        },
    )
}

fn has_explicit_network_database_route(database_url: &str) -> bool {
    let Some(remainder) = database_url
        .strip_prefix("postgres://")
        .or_else(|| database_url.strip_prefix("postgresql://"))
    else {
        return false;
    };
    let location = remainder.split_once('?').map_or(remainder, |value| value.0);
    let Some((authority, database)) = location.split_once('/') else {
        return false;
    };
    let Some((user_info, host_port)) = authority.rsplit_once('@') else {
        return false;
    };
    let username = user_info.split_once(':').map_or(user_info, |value| value.0);
    let host = if let Some(bracketed) = host_port.strip_prefix('[') {
        bracketed.split_once(']').map_or("", |value| value.0)
    } else {
        host_port
            .rsplit_once(':')
            .map_or(host_port, |value| value.0)
    };
    !username.is_empty() && !host.is_empty() && !database.is_empty()
}

fn canonical_digest(domain: &str, value: &impl Serialize) -> Result<String, ArtifactBuildError> {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update(b"\0");
    digest.update(serde_json::to_vec(value).map_err(json_storage)?);
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn decode_exact<T: for<'de> Deserialize<'de> + Serialize>(
    value: &serde_json::Value,
) -> Result<T, ArtifactBuildError> {
    let decoded: T = serde_json::from_value(value.clone()).map_err(json_storage)?;
    if serde_json::to_value(&decoded)
        .map_err(json_storage)?
        .eq(value)
    {
        Ok(decoded)
    } else {
        Err(unavailable("legacy PREPARED drain encoding mismatch"))
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|b| b.is_ascii_hexdigit())
}
fn unavailable(message: &str) -> ArtifactBuildError {
    ArtifactBuildError::Storage(message.into())
}
fn storage(error: sqlx::Error) -> ArtifactBuildError {
    ArtifactBuildError::Storage(error.to_string())
}
fn json_storage(error: impl std::fmt::Display) -> ArtifactBuildError {
    ArtifactBuildError::Storage(error.to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn fixture_receipt() -> LegacyPreparedAttemptDrainReceiptV1 {
        let database = LegacyDrainTargetDatabaseIdentityV1 {
            schema_version: 1,
            database_name: "rd-owner-test".into(),
            database_oid: 42,
            role_name: "rd_owner".into(),
            role_oid: 43,
        };
        form_receipt(
            LegacyPreparedAttemptBindingV1 {
                build_request_identity: "build-1".into(),
                attempt_identity: "attempt-1".into(),
                request_semantic_digest: format!("sha256:{}", "1".repeat(64)),
                attempt_json_digest: format!("sha256:{}", "2".repeat(64)),
                prepared_at_epoch_ms: 10,
                admission: ProductEdgeAdmissionLocatorV1 {
                    request_identity: "build-1".into(),
                    admission_identity: "admission-1".into(),
                    admission_digest: format!("sha256:{}", "3".repeat(64)),
                },
            },
            LegacyPreparedAttemptAbsenceProofV1 {
                attempt_invocation_claim_count: 0,
                attempt_invocation_custody_count: 0,
                effect_invocation_admission_count: 0,
                effect_invocation_claim_count: 0,
                effect_invocation_state_count: 0,
                artifact_count: 0,
                attempt_outbox_count: 0,
                provider_start_custody_count: 0,
            },
            database.clone(),
            database_endpoint_resource_fingerprint(
                "postgresql://rd_owner:secret@localhost:5432/rd-owner-test",
            )
            .unwrap(),
            database_fingerprint(&database).unwrap(),
            11,
        )
        .unwrap()
    }

    #[test]
    fn database_endpoint_fingerprint_is_secret_free_and_route_exact() {
        let base = database_endpoint_resource_fingerprint(
            "postgresql://rd_owner:first@Db.Example:5432/research?application_name=first",
        )
        .unwrap();
        assert_eq!(
            base,
            database_endpoint_resource_fingerprint(
                "postgresql://rd_owner:second@db.example:5432/research?application_name=second",
            )
            .unwrap()
        );
        for changed in [
            "postgresql://other:first@db.example:5432/research",
            "postgresql://rd_owner:first@other.example:5432/research",
            "postgresql://rd_owner:first@db.example:5433/research",
            "postgresql://rd_owner:first@db.example:5432/other",
        ] {
            assert_ne!(
                base,
                database_endpoint_resource_fingerprint(changed).unwrap()
            );
        }
    }

    #[test]
    fn database_endpoint_fingerprint_rejects_implicit_invalid_or_socket_routes() {
        for invalid in [
            "not-a-postgres-url",
            "postgresql://db.example/research",
            "postgresql://rd_owner@/research",
            "postgresql://rd_owner@db.example",
            "postgresql://rd_owner@db.example/research?host=%2Ftmp",
        ] {
            assert!(database_endpoint_resource_fingerprint(invalid).is_err());
        }
    }

    #[test]
    fn canonical_receipt_seals_unknown_never_started_without_positive_custody() {
        let receipt = fixture_receipt();
        verify_receipt(
            &receipt,
            &receipt.attempt,
            &receipt.target_database_identity,
        )
        .unwrap();
        assert_eq!(receipt.disposition, "OUTCOME_UNKNOWN");
        assert_eq!(receipt.provider_disposition, "PROVIDER_NEVER_STARTED");
    }

    #[test]
    fn malformed_or_nonzero_absence_proof_fails_closed() {
        let mut malformed = fixture_receipt();
        malformed.absence_proof.artifact_count = 1;
        assert!(
            verify_receipt(
                &malformed,
                &malformed.attempt,
                &malformed.target_database_identity
            )
            .is_err()
        );
        let mut unknown = serde_json::to_value(fixture_receipt()).unwrap();
        unknown["unknown"] = serde_json::json!(true);
        assert!(decode_exact::<LegacyPreparedAttemptDrainReceiptV1>(&unknown).is_err());
        let unknown_product_edge = serde_json::json!({
            "schema_version": 1,
            "effect_invocation_admission_count": 0,
            "effect_invocation_claim_count": 0,
            "effect_invocation_state_count": 0,
            "provider_start_custody_count": 0,
            "unknown": true,
        });
        assert!(decode_exact::<ProductEdgeAttemptAbsenceV1>(&unknown_product_edge).is_err());
    }
}
