use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::{
    product_edge::ResearchRequestReceiptV1,
    trial_family::{
        ArtifactTrialFamilyReadbackV1, TrialFamilyError, TrialFamilyReadbackV1,
        admit_stored_artifact_binding, admit_stored_family, form_artifact_binding,
        verify_artifact_binding, verify_family,
    },
};

const FAMILY_FROZEN_EVENT: &str = "TRIAL_FAMILY_FROZEN_V1";
const ARTIFACT_BOUND_EVENT: &str = "ARTIFACT_TRIAL_FAMILY_BOUND_V1";

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), TrialFamilyError> {
    for statement in [
        "CREATE TABLE IF NOT EXISTS rd_trial_families_v1 (trial_family_identity TEXT PRIMARY KEY, intent_identity TEXT NOT NULL UNIQUE, root_digest TEXT NOT NULL, root_json JSONB NOT NULL, root_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS rd_trial_family_members_v1 (member_identity TEXT PRIMARY KEY, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), ordinal INTEGER NOT NULL, fact_identity TEXT NOT NULL UNIQUE, member_digest TEXT NOT NULL, member_json JSONB NOT NULL, membership_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (trial_family_identity, ordinal))",
        "CREATE TABLE IF NOT EXISTS rd_trial_family_heads_v1 (trial_family_identity TEXT PRIMARY KEY REFERENCES rd_trial_families_v1(trial_family_identity), frontier_identity TEXT NOT NULL UNIQUE, frontier_digest TEXT NOT NULL, frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS rd_artifact_trial_family_bindings_v1 (binding_identity TEXT PRIMARY KEY, artifact_identity TEXT NOT NULL UNIQUE, build_receipt_identity TEXT NOT NULL UNIQUE, intent_identity TEXT NOT NULL, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), binding_digest TEXT NOT NULL, binding_json JSONB NOT NULL, binding_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind))",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(storage)?;
    }
    Ok(())
}

pub(crate) async fn persist_initial_family(
    transaction: &mut Transaction<'_, Postgres>,
    family: &TrialFamilyReadbackV1,
    research_receipt: &ResearchRequestReceiptV1,
) -> Result<(), TrialFamilyError> {
    verify_family(family)?;
    let committed_at =
        i64::try_from(research_receipt.committed_at_epoch_ms).map_err(unavailable)?;
    sqlx::query("INSERT INTO rd_trial_families_v1 (trial_family_identity, intent_identity, root_digest, root_json, root_receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(family.root.trial_family_identity())
        .bind(family.root_receipt.intent_identity())
        .bind(family.root.root_digest())
        .bind(encode(&family.root)?)
        .bind(encode(&family.root_receipt)?)
        .bind(committed_at)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    sqlx::query("INSERT INTO rd_trial_family_members_v1 (member_identity, trial_family_identity, ordinal, fact_identity, member_digest, member_json, membership_receipt_json, committed_at_epoch_ms) VALUES ($1,$2,0,$3,$4,$5,$6,$7)")
        .bind(family.initial_intent_member.member_identity())
        .bind(family.root.trial_family_identity())
        .bind(family.initial_intent_member.fact_identity())
        .bind(family.initial_intent_member.member_digest())
        .bind(encode(&family.initial_intent_member)?)
        .bind(encode(&family.membership_receipt)?)
        .bind(committed_at)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    sqlx::query("INSERT INTO rd_trial_family_heads_v1 (trial_family_identity, frontier_identity, frontier_digest, frontier_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
        .bind(family.root.trial_family_identity())
        .bind(family.census_frontier.frontier_identity())
        .bind(family.census_frontier.frontier_digest())
        .bind(encode(&family.census_frontier)?)
        .bind(committed_at)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    let payload = FamilyFrozenOutboxV1 {
        schema_version: 1,
        research_receipt_identity: research_receipt.receipt_identity.clone(),
        intent_identity: family.root_receipt.intent_identity().to_string(),
        trial_family_identity: family.root.trial_family_identity().to_string(),
        root_receipt_identity: family.root_receipt.receipt_identity().to_string(),
        membership_receipt_identity: family.membership_receipt.receipt_identity().to_string(),
        census_frontier_identity: family.census_frontier.frontier_identity().to_string(),
        census_frontier_digest: family.census_frontier.frontier_digest().to_string(),
    };
    persist_outbox(
        transaction,
        family_event_identity(family),
        family.root.trial_family_identity(),
        FAMILY_FROZEN_EVENT,
        &payload,
        research_receipt.committed_at_epoch_ms,
    )
    .await
}

pub(crate) async fn persist_artifact_binding(
    transaction: &mut Transaction<'_, Postgres>,
    family: TrialFamilyReadbackV1,
    artifact_identity: &str,
    build_receipt_identity: &str,
    intent_identity: &str,
    now_epoch_ms: u64,
) -> Result<ArtifactTrialFamilyReadbackV1, TrialFamilyError> {
    let readback = form_artifact_binding(
        family,
        artifact_identity,
        build_receipt_identity,
        intent_identity,
        now_epoch_ms,
    )?;
    verify_artifact_binding(&readback)?;
    let committed_at = i64::try_from(now_epoch_ms).map_err(unavailable)?;
    sqlx::query("INSERT INTO rd_artifact_trial_family_bindings_v1 (binding_identity, artifact_identity, build_receipt_identity, intent_identity, trial_family_identity, binding_digest, binding_json, binding_receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(readback.binding.binding_identity())
        .bind(readback.binding.artifact_identity())
        .bind(readback.binding.build_receipt_identity())
        .bind(intent_identity)
        .bind(readback.binding.trial_family_identity())
        .bind(readback.binding.binding_digest())
        .bind(encode(&readback.binding)?)
        .bind(encode(&readback.binding_receipt)?)
        .bind(committed_at)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    let payload = ArtifactBoundOutboxV1 {
        schema_version: 1,
        artifact_identity: artifact_identity.to_string(),
        build_receipt_identity: build_receipt_identity.to_string(),
        trial_family_identity: readback.binding.trial_family_identity().to_string(),
        binding_identity: readback.binding.binding_identity().to_string(),
        binding_receipt_identity: readback.binding_receipt.receipt_identity().to_string(),
    };
    persist_outbox(
        transaction,
        binding_event_identity(&readback),
        artifact_identity,
        ARTIFACT_BOUND_EVENT,
        &payload,
        now_epoch_ms,
    )
    .await?;
    Ok(readback)
}

pub(crate) async fn load_artifact_trial_family_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    artifact_identity: &str,
    build_receipt_identity: &str,
    intent_identity: &str,
    family: &TrialFamilyReadbackV1,
) -> Result<ArtifactTrialFamilyReadbackV1, TrialFamilyError> {
    let rows = sqlx::query("SELECT binding_identity, artifact_identity, build_receipt_identity, intent_identity, trial_family_identity, binding_digest, binding_json, binding_receipt_json, committed_at_epoch_ms FROM rd_artifact_trial_family_bindings_v1 WHERE artifact_identity = $1 AND build_receipt_identity = $2 FOR SHARE")
        .bind(artifact_identity)
        .bind(build_receipt_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "artifact binding missing".to_string(),
        ));
    }
    let row = &rows[0];
    let binding_json = row.try_get("binding_json").map_err(storage)?;
    let binding_receipt_json = row.try_get("binding_receipt_json").map_err(storage)?;
    let binding_identity: String = row.try_get("binding_identity").map_err(storage)?;
    let row_artifact_identity: String = row.try_get("artifact_identity").map_err(storage)?;
    let row_build_receipt_identity: String =
        row.try_get("build_receipt_identity").map_err(storage)?;
    let row_intent_identity: String = row.try_get("intent_identity").map_err(storage)?;
    let trial_family_identity: String = row.try_get("trial_family_identity").map_err(storage)?;
    let binding_digest: String = row.try_get("binding_digest").map_err(storage)?;
    let committed_at_epoch_ms: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;

    if row_intent_identity != intent_identity
        || intent_identity != family.root_receipt.intent_identity()
        || trial_family_identity != family.root.trial_family_identity()
    {
        return Err(TrialFamilyError::Unavailable(
            "artifact binding intent mismatch".to_string(),
        ));
    }
    let readback =
        admit_stored_artifact_binding(family.clone(), &binding_json, &binding_receipt_json)?;

    if readback.binding.binding_identity() != binding_identity
        || readback.binding_receipt.binding_identity() != binding_identity
        || readback.binding.artifact_identity() != artifact_identity
        || row_artifact_identity != artifact_identity
        || readback.binding.build_receipt_identity() != build_receipt_identity
        || row_build_receipt_identity != build_receipt_identity
        || readback.binding.intent_identity() != row_intent_identity
        || readback.binding.trial_family_identity() != trial_family_identity
        || readback.binding.binding_digest() != binding_digest
        || readback.binding_receipt.binding_digest() != binding_digest
        || i64::try_from(readback.binding_receipt.committed_at_epoch_ms()).map_err(unavailable)?
            != committed_at_epoch_ms
    {
        return Err(TrialFamilyError::Unavailable(
            "artifact binding row mismatch".to_string(),
        ));
    }
    verify_artifact_binding(&readback)?;
    verify_binding_outbox_in_transaction(transaction, &readback).await?;
    Ok(readback)
}

pub(crate) async fn load_trial_family_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
    research_receipt_identity: &str,
) -> Result<TrialFamilyReadbackV1, TrialFamilyError> {
    let root_rows = sqlx::query("SELECT trial_family_identity, intent_identity, root_digest, root_json, root_receipt_json, committed_at_epoch_ms FROM rd_trial_families_v1 WHERE intent_identity = $1 FOR SHARE")
        .bind(intent_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if root_rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "family root missing".to_string(),
        ));
    }
    let root_row = &root_rows[0];
    let trial_family_identity: String =
        root_row.try_get("trial_family_identity").map_err(storage)?;
    let root_json = root_row.try_get("root_json").map_err(storage)?;
    let root_receipt_json = root_row.try_get("root_receipt_json").map_err(storage)?;
    let member_rows = sqlx::query("SELECT member_identity, trial_family_identity, ordinal, fact_identity, member_digest, member_json, membership_receipt_json, committed_at_epoch_ms FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1 ORDER BY ordinal FOR SHARE")
        .bind(&trial_family_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let head_rows = sqlx::query("SELECT trial_family_identity, frontier_identity, frontier_digest, frontier_json, committed_at_epoch_ms FROM rd_trial_family_heads_v1 WHERE trial_family_identity = $1 FOR SHARE")
        .bind(&trial_family_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if member_rows.len() != 1 || head_rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "family census incomplete".to_string(),
        ));
    }
    let member_row = &member_rows[0];
    let head_row = &head_rows[0];
    let member_json = member_row.try_get("member_json").map_err(storage)?;
    let membership_receipt_json = member_row
        .try_get("membership_receipt_json")
        .map_err(storage)?;
    let frontier_json = head_row.try_get("frontier_json").map_err(storage)?;
    let readback = admit_stored_family(
        &root_json,
        &root_receipt_json,
        &member_json,
        &membership_receipt_json,
        &frontier_json,
    )?;
    verify_row_bindings(&readback, root_row, member_row, head_row)?;
    verify_family(&readback)?;
    verify_family_outbox_in_transaction(transaction, &readback, research_receipt_identity).await?;
    Ok(readback)
}

fn verify_row_bindings(
    family: &TrialFamilyReadbackV1,
    root_row: &sqlx::postgres::PgRow,
    member_row: &sqlx::postgres::PgRow,
    head_row: &sqlx::postgres::PgRow,
) -> Result<(), TrialFamilyError> {
    let root_family_identity: String =
        root_row.try_get("trial_family_identity").map_err(storage)?;
    let root_intent_identity: String = root_row.try_get("intent_identity").map_err(storage)?;
    let root_digest: String = root_row.try_get("root_digest").map_err(storage)?;
    let root_committed_at: i64 = root_row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let member_identity: String = member_row.try_get("member_identity").map_err(storage)?;
    let member_family_identity: String = member_row
        .try_get("trial_family_identity")
        .map_err(storage)?;
    let member_ordinal: i32 = member_row.try_get("ordinal").map_err(storage)?;
    let member_fact_identity: String = member_row.try_get("fact_identity").map_err(storage)?;
    let member_digest: String = member_row.try_get("member_digest").map_err(storage)?;
    let member_committed_at: i64 = member_row
        .try_get("committed_at_epoch_ms")
        .map_err(storage)?;
    let head_family_identity: String =
        head_row.try_get("trial_family_identity").map_err(storage)?;
    let frontier_identity: String = head_row.try_get("frontier_identity").map_err(storage)?;
    let frontier_digest: String = head_row.try_get("frontier_digest").map_err(storage)?;
    let head_committed_at: i64 = head_row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let canonical_commit =
        i64::try_from(family.root_receipt.committed_at_epoch_ms()).map_err(unavailable)?;

    if family.root.trial_family_identity() != root_family_identity
        || family.root_receipt.intent_identity() != root_intent_identity
        || family.root.root_digest() != root_digest
        || root_committed_at != canonical_commit
        || family.initial_intent_member.member_identity() != member_identity
        || family.initial_intent_member.trial_family_identity() != member_family_identity
        || i32::try_from(family.initial_intent_member.ordinal()).map_err(unavailable)?
            != member_ordinal
        || family.initial_intent_member.fact_identity() != member_fact_identity
        || family.initial_intent_member.member_digest() != member_digest
        || member_committed_at != canonical_commit
        || family.census_frontier.trial_family_identity() != head_family_identity
        || family.census_frontier.frontier_identity() != frontier_identity
        || family.census_frontier.frontier_digest() != frontier_digest
        || head_committed_at != canonical_commit
    {
        return Err(TrialFamilyError::Unavailable(
            "family row digest mismatch".to_string(),
        ));
    }
    Ok(())
}

async fn verify_family_outbox_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    family: &TrialFamilyReadbackV1,
    research_receipt_identity: &str,
) -> Result<(), TrialFamilyError> {
    let rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = $2 FOR SHARE")
        .bind(family.root.trial_family_identity())
        .bind(FAMILY_FROZEN_EVENT)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "family outbox missing".to_string(),
        ));
    }
    verify_family_outbox_row(&rows[0], family, research_receipt_identity)
}

fn verify_family_outbox_row(
    row: &sqlx::postgres::PgRow,
    family: &TrialFamilyReadbackV1,
    research_receipt_identity: &str,
) -> Result<(), TrialFamilyError> {
    let event_identity: String = row.try_get("event_identity").map_err(storage)?;
    let aggregate_identity: String = row.try_get("aggregate_identity").map_err(storage)?;
    let event_kind: String = row.try_get("event_kind").map_err(storage)?;
    let payload_digest: String = row.try_get("payload_digest").map_err(storage)?;
    let committed_at_epoch_ms: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let payload: FamilyFrozenOutboxV1 = decode(&row.try_get("payload_json").map_err(storage)?)?;

    if event_identity != family_event_identity(family)
        || aggregate_identity != family.root.trial_family_identity()
        || event_kind != FAMILY_FROZEN_EVENT
        || payload_digest != digest("rd.owner-outbox.payload.v1", &payload)?
        || committed_at_epoch_ms
            != i64::try_from(family.root_receipt.committed_at_epoch_ms()).map_err(unavailable)?
        || payload.research_receipt_identity != research_receipt_identity
        || payload.trial_family_identity != family.root.trial_family_identity()
        || payload.intent_identity != family.root_receipt.intent_identity()
        || payload.root_receipt_identity != family.root_receipt.receipt_identity()
        || payload.membership_receipt_identity != family.membership_receipt.receipt_identity()
        || payload.census_frontier_identity != family.census_frontier.frontier_identity()
        || payload.census_frontier_digest != family.census_frontier.frontier_digest()
    {
        return Err(TrialFamilyError::Unavailable(
            "family outbox mismatch".to_string(),
        ));
    }
    Ok(())
}

async fn verify_binding_outbox_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &ArtifactTrialFamilyReadbackV1,
) -> Result<(), TrialFamilyError> {
    let rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = $2 FOR SHARE")
        .bind(readback.binding.artifact_identity())
        .bind(ARTIFACT_BOUND_EVENT)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "binding outbox missing".to_string(),
        ));
    }
    let row = &rows[0];
    let event_identity: String = row.try_get("event_identity").map_err(storage)?;
    let aggregate_identity: String = row.try_get("aggregate_identity").map_err(storage)?;
    let event_kind: String = row.try_get("event_kind").map_err(storage)?;
    let payload_digest: String = row.try_get("payload_digest").map_err(storage)?;
    let committed_at_epoch_ms: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let payload: ArtifactBoundOutboxV1 = decode(&row.try_get("payload_json").map_err(storage)?)?;

    if event_identity != binding_event_identity(readback)
        || aggregate_identity != readback.binding.artifact_identity()
        || event_kind != ARTIFACT_BOUND_EVENT
        || payload_digest != digest("rd.owner-outbox.payload.v1", &payload)?
        || committed_at_epoch_ms
            != i64::try_from(readback.binding_receipt.committed_at_epoch_ms())
                .map_err(unavailable)?
        || payload.artifact_identity != readback.binding.artifact_identity()
        || payload.build_receipt_identity != readback.binding.build_receipt_identity()
        || payload.trial_family_identity != readback.binding.trial_family_identity()
        || payload.binding_identity != readback.binding.binding_identity()
        || payload.binding_receipt_identity != readback.binding_receipt.receipt_identity()
    {
        return Err(TrialFamilyError::Unavailable(
            "binding outbox mismatch".to_string(),
        ));
    }
    Ok(())
}

async fn persist_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    event_identity: String,
    aggregate_identity: &str,
    event_kind: &str,
    payload: &impl Serialize,
    committed_at_epoch_ms: u64,
) -> Result<(), TrialFamilyError> {
    let payload_json = encode(payload)?;
    let payload_digest = digest("rd.owner-outbox.payload.v1", payload)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity)
        .bind(aggregate_identity)
        .bind(event_kind)
        .bind(payload_digest)
        .bind(payload_json)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FamilyFrozenOutboxV1 {
    schema_version: u32,
    research_receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    root_receipt_identity: String,
    membership_receipt_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBoundOutboxV1 {
    schema_version: u32,
    artifact_identity: String,
    build_receipt_identity: String,
    trial_family_identity: String,
    binding_identity: String,
    binding_receipt_identity: String,
}

fn family_event_identity(family: &TrialFamilyReadbackV1) -> String {
    format!(
        "rd-owner-outbox-v1-{}",
        family
            .census_frontier
            .frontier_digest()
            .trim_start_matches("sha256:")
    )
}

fn binding_event_identity(readback: &ArtifactTrialFamilyReadbackV1) -> String {
    format!(
        "rd-owner-outbox-v1-{}",
        readback
            .binding
            .binding_digest()
            .trim_start_matches("sha256:")
    )
}

fn digest(domain: &str, value: &impl Serialize) -> Result<String, TrialFamilyError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    serde_json::to_vec(&Envelope { domain, value })
        .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
        .map_err(unavailable)
}

fn encode(value: &impl Serialize) -> Result<serde_json::Value, TrialFamilyError> {
    serde_json::to_value(value).map_err(unavailable)
}

fn decode<T>(value: &serde_json::Value) -> Result<T, TrialFamilyError>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let decoded: T = serde_json::from_value(value.clone()).map_err(unavailable)?;
    if serde_json::to_value(&decoded).map_err(unavailable)? != *value {
        return Err(TrialFamilyError::Unavailable(
            "stored family JSON is not canonical for its schema".to_string(),
        ));
    }
    Ok(decoded)
}

fn storage(error: impl Display) -> TrialFamilyError {
    TrialFamilyError::Unavailable(error.to_string())
}

fn unavailable(error: impl Display) -> TrialFamilyError {
    TrialFamilyError::Unavailable(error.to_string())
}

#[cfg(test)]
mod postgres_binding_tests {
    use super::*;
    use crate::{
        product_edge::{ResearchRequestDisposition, ResearchRequestReceiptV1},
        trial_family::{
            TrialFamilyIndependenceDispositionV1, TrialFamilyPolicyV1, form_initial_family,
        },
    };
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use vibe_testkit::postgres::{DedicatedPostgresTestDatabase, DedicatedPostgresTestMutation};

    #[tokio::test]
    #[ignore = "requires an admitted RD_OWNER_TEST_DATABASE_URL"]
    async fn every_relational_scalar_is_bound_and_rollback_restores_exact_readback() {
        let test_database = DedicatedPostgresTestDatabase::admit("RD_OWNER_TEST_DATABASE_URL")
            .await
            .unwrap();
        let mutation = test_database.mutation();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(3)
            .connect(test_database.database_url())
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let suffix = unique_suffix();
        let intent_identity = format!("rd-research-intent-v2-binding-matrix-{suffix}");
        let intent_digest = format!("sha256:{}", "a".repeat(64));
        let committed_at = u64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis(),
        )
        .unwrap();
        let family = form_initial_family(
            &intent_identity,
            &intent_digest,
            family_policy(),
            committed_at,
        )
        .unwrap();
        let family_identity = family.root.trial_family_identity().to_string();
        let receipt = ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity: format!("rd-research-request-receipt-v2-binding-matrix-{suffix}"),
            request_identity: format!("research-request-v2-binding-matrix-{suffix}"),
            semantic_digest: intent_digest,
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(intent_identity.clone()),
            committed_at_epoch_ms: committed_at,
            rejection_code: None,
        };
        let artifact_identity = format!("blake3:{}", "b".repeat(64));
        let build_receipt_identity = format!("rd-build-receipt-v1-{}", "b".repeat(64));
        let mut transaction = pool.begin().await.unwrap();
        persist_initial_family(&mut transaction, &family, &receipt)
            .await
            .unwrap();
        let binding = persist_artifact_binding(
            &mut transaction,
            family.clone(),
            &artifact_identity,
            &build_receipt_identity,
            &intent_identity,
            committed_at.saturating_add(1),
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();

        for statement in [
            "UPDATE rd_trial_families_v1 SET intent_identity = intent_identity || '-mutated' WHERE trial_family_identity = $1",
            "UPDATE rd_trial_families_v1 SET root_digest = root_digest || '-mutated' WHERE trial_family_identity = $1",
            "UPDATE rd_trial_families_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_members_v1 SET member_identity = member_identity || '-mutated' WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_members_v1 SET ordinal = ordinal + 1 WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_members_v1 SET fact_identity = fact_identity || '-mutated' WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_members_v1 SET member_digest = member_digest || '-mutated' WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_members_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_heads_v1 SET frontier_identity = frontier_identity || '-mutated' WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_heads_v1 SET frontier_digest = frontier_digest || '-mutated' WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_heads_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE trial_family_identity = $1",
            "UPDATE rd_owner_outbox_v1 SET event_identity = event_identity || '-mutated' WHERE aggregate_identity = $1 AND event_kind = 'TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE rd_owner_outbox_v1 SET aggregate_identity = aggregate_identity || '-mutated' WHERE aggregate_identity = $1 AND event_kind = 'TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE rd_owner_outbox_v1 SET event_kind = event_kind || '_MUTATED' WHERE aggregate_identity = $1 AND event_kind = 'TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE rd_owner_outbox_v1 SET payload_digest = payload_digest || '-mutated' WHERE aggregate_identity = $1 AND event_kind = 'TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE rd_owner_outbox_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE aggregate_identity = $1 AND event_kind = 'TRIAL_FAMILY_FROZEN_V1'",
        ] {
            assert_family_mutation_fails_closed(
                &pool,
                statement,
                &family_identity,
                &intent_identity,
                &receipt.receipt_identity,
                &family,
            )
            .await;
        }

        for statement in [
            "UPDATE rd_artifact_trial_family_bindings_v1 SET binding_identity = binding_identity || '-mutated' WHERE artifact_identity = $1",
            "UPDATE rd_artifact_trial_family_bindings_v1 SET artifact_identity = artifact_identity || '-mutated' WHERE artifact_identity = $1",
            "UPDATE rd_artifact_trial_family_bindings_v1 SET build_receipt_identity = build_receipt_identity || '-mutated' WHERE artifact_identity = $1",
            "UPDATE rd_artifact_trial_family_bindings_v1 SET intent_identity = intent_identity || '-mutated' WHERE artifact_identity = $1",
            "UPDATE rd_artifact_trial_family_bindings_v1 SET binding_digest = binding_digest || '-mutated' WHERE artifact_identity = $1",
            "UPDATE rd_artifact_trial_family_bindings_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE artifact_identity = $1",
            "UPDATE rd_owner_outbox_v1 SET event_identity = event_identity || '-mutated' WHERE aggregate_identity = $1 AND event_kind = 'ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE rd_owner_outbox_v1 SET aggregate_identity = aggregate_identity || '-mutated' WHERE aggregate_identity = $1 AND event_kind = 'ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE rd_owner_outbox_v1 SET event_kind = event_kind || '_MUTATED' WHERE aggregate_identity = $1 AND event_kind = 'ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE rd_owner_outbox_v1 SET payload_digest = payload_digest || '-mutated' WHERE aggregate_identity = $1 AND event_kind = 'ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE rd_owner_outbox_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE aggregate_identity = $1 AND event_kind = 'ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
        ] {
            assert_binding_mutation_fails_closed(
                &pool,
                statement,
                &artifact_identity,
                &build_receipt_identity,
                &intent_identity,
                &family,
                &binding,
            )
            .await;
        }

        let dummy_family_identity = format!("rd-trial-family-v1-dummy-{suffix}");
        sqlx::query("INSERT INTO rd_trial_families_v1 (trial_family_identity, intent_identity, root_digest, root_json, root_receipt_json, committed_at_epoch_ms) SELECT $1, $2, root_digest, root_json, root_receipt_json, committed_at_epoch_ms FROM rd_trial_families_v1 WHERE trial_family_identity = $3")
            .bind(&dummy_family_identity)
            .bind(format!("rd-research-intent-v2-dummy-{suffix}"))
            .bind(&family_identity)
            .execute(&pool)
            .await
            .unwrap();

        for statement in [
            "UPDATE rd_trial_family_members_v1 SET trial_family_identity = $2 WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_heads_v1 SET trial_family_identity = $2 WHERE trial_family_identity = $1",
        ] {
            let mut transaction = pool.begin().await.unwrap();
            sqlx::query(statement)
                .bind(&family_identity)
                .bind(&dummy_family_identity)
                .execute(&mut *transaction)
                .await
                .unwrap();
            assert!(
                load_trial_family_in_transaction(
                    &mut transaction,
                    &intent_identity,
                    &receipt.receipt_identity,
                )
                .await
                .is_err()
            );
            transaction.rollback().await.unwrap();
        }
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query("UPDATE rd_artifact_trial_family_bindings_v1 SET trial_family_identity = $2 WHERE artifact_identity = $1")
            .bind(&artifact_identity)
            .bind(&dummy_family_identity)
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            load_artifact_trial_family_in_transaction(
                &mut transaction,
                &artifact_identity,
                &build_receipt_identity,
                &intent_identity,
                &family,
            )
            .await
            .is_err()
        );
        transaction.rollback().await.unwrap();

        let mut transaction = pool.begin().await.unwrap();
        assert_eq!(
            load_trial_family_in_transaction(
                &mut transaction,
                &intent_identity,
                &receipt.receipt_identity,
            )
            .await
            .unwrap(),
            family
        );
        assert_eq!(
            load_artifact_trial_family_in_transaction(
                &mut transaction,
                &artifact_identity,
                &build_receipt_identity,
                &intent_identity,
                &family,
            )
            .await
            .unwrap(),
            binding
        );
        transaction.rollback().await.unwrap();

        let mut custody_transaction = pool.begin().await.unwrap();
        assert_eq!(
            load_artifact_trial_family_in_transaction(
                &mut custody_transaction,
                &artifact_identity,
                &build_receipt_identity,
                &intent_identity,
                &family,
            )
            .await
            .unwrap(),
            binding
        );
        let update_pool = pool.clone();
        let update_artifact_identity = artifact_identity.clone();
        let (backend_pid_sender, backend_pid_receiver) = tokio::sync::oneshot::channel();

        let concurrent_update = tokio::spawn(async move {
            let mut transaction = update_pool.begin().await.unwrap();
            let backend_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *transaction)
                .await
                .unwrap();
            backend_pid_sender.send(backend_pid).unwrap();
            let updated = sqlx::query("UPDATE rd_artifact_trial_family_bindings_v1 SET binding_digest = binding_digest || '-concurrent' WHERE artifact_identity = $1")
                .bind(update_artifact_identity)
                .execute(&mut *transaction)
                .await
                .unwrap();
            transaction.commit().await.unwrap();
            updated.rows_affected()
        });
        let backend_pid = backend_pid_receiver.await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let wait_event_type: Option<String> = sqlx::query_scalar(
                    "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
                )
                .bind(backend_pid)
                .fetch_one(&pool)
                .await
                .unwrap();

                if wait_event_type.as_deref() == Some("Lock") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("binding mutation did not reach an observable PostgreSQL lock wait");
        assert!(!concurrent_update.is_finished());
        custody_transaction.rollback().await.unwrap();
        assert_eq!(concurrent_update.await.unwrap(), 1);

        let mut transaction = pool.begin().await.unwrap();
        assert!(
            load_artifact_trial_family_in_transaction(
                &mut transaction,
                &artifact_identity,
                &build_receipt_identity,
                &intent_identity,
                &family,
            )
            .await
            .is_err()
        );
        transaction.rollback().await.unwrap();
        sqlx::query("UPDATE rd_artifact_trial_family_bindings_v1 SET binding_digest = $2 WHERE artifact_identity = $1")
            .bind(&artifact_identity)
            .bind(binding.binding.binding_digest())
            .execute(&pool)
            .await
            .unwrap();
        let mut transaction = pool.begin().await.unwrap();
        assert_eq!(
            load_artifact_trial_family_in_transaction(
                &mut transaction,
                &artifact_identity,
                &build_receipt_identity,
                &intent_identity,
                &family,
            )
            .await
            .unwrap(),
            binding
        );
        transaction.rollback().await.unwrap();

        cleanup(
            &mutation,
            &artifact_identity,
            &family_identity,
            &dummy_family_identity,
        )
        .await;
    }

    async fn assert_family_mutation_fails_closed(
        pool: &PgPool,
        statement: &'static str,
        family_identity: &str,
        intent_identity: &str,
        receipt_identity: &str,
        expected: &TrialFamilyReadbackV1,
    ) {
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query(statement)
            .bind(family_identity)
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            load_trial_family_in_transaction(&mut transaction, intent_identity, receipt_identity,)
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        let mut transaction = pool.begin().await.unwrap();
        assert_eq!(
            load_trial_family_in_transaction(&mut transaction, intent_identity, receipt_identity,)
                .await
                .unwrap(),
            *expected
        );
        transaction.rollback().await.unwrap();
    }

    async fn assert_binding_mutation_fails_closed(
        pool: &PgPool,
        statement: &'static str,
        artifact_identity: &str,
        build_receipt_identity: &str,
        intent_identity: &str,
        family: &TrialFamilyReadbackV1,
        expected: &ArtifactTrialFamilyReadbackV1,
    ) {
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query(statement)
            .bind(artifact_identity)
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            load_artifact_trial_family_in_transaction(
                &mut transaction,
                artifact_identity,
                build_receipt_identity,
                intent_identity,
                family,
            )
            .await
            .is_err()
        );
        transaction.rollback().await.unwrap();
        let mut transaction = pool.begin().await.unwrap();
        assert_eq!(
            load_artifact_trial_family_in_transaction(
                &mut transaction,
                artifact_identity,
                build_receipt_identity,
                intent_identity,
                family,
            )
            .await
            .unwrap(),
            *expected
        );
        transaction.rollback().await.unwrap();
    }

    fn family_policy() -> TrialFamilyPolicyV1 {
        TrialFamilyPolicyV1 {
            trial_budget: 8,
            stop_rule: "Stop on falsifier or exhausted bounded budget.".to_string(),
            pit_rule_identity: "pit-rule-v1".to_string(),
            cost_model_identity: "cost-model-v1".to_string(),
            slippage_model_identity: "slippage-model-v1".to_string(),
            capacity_model_identity: "capacity-model-v1".to_string(),
            semantic_predecessor_frontier: vec![],
            protected_feedback_frontier: "protected-frontier-v1".to_string(),
            independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
            independence_basis_identity: "independence-basis-v1".to_string(),
            frozen_falsifier_binding: format!("sha256:{}", "c".repeat(64)),
        }
    }

    fn unique_suffix() -> String {
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    async fn cleanup(
        mutation: &DedicatedPostgresTestMutation<'_>,
        artifact_identity: &str,
        family_identity: &str,
        dummy_family_identity: &str,
    ) {
        let pool = mutation.pool();
        sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity IN ($1, $2)")
            .bind(artifact_identity)
            .bind(family_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM rd_artifact_trial_family_bindings_v1 WHERE artifact_identity = $1",
        )
        .bind(artifact_identity)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM rd_trial_family_heads_v1 WHERE trial_family_identity = $1")
            .bind(family_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1")
            .bind(family_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_families_v1 WHERE trial_family_identity IN ($1, $2)")
            .bind(family_identity)
            .bind(dummy_family_identity)
            .execute(pool)
            .await
            .unwrap();
    }
}
