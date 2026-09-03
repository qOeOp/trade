use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::{
    product_edge::ResearchRequestReceiptV1,
    trial_family::{
        ArtifactTrialFamilyReadbackV1, TrialFamilyAttemptAppendV2, TrialFamilyAttemptFrontierV2,
        TrialFamilyCandidateSetFrontierV2, TrialFamilyCensusFrontierV2,
        TrialFamilyCensusReadbackV2, TrialFamilyError, TrialFamilyReadbackV1,
        admit_stored_artifact_binding, admit_stored_census_member_v2, admit_stored_family,
        admit_stored_legacy_family_without_frontier, append_attempt_to_census_v2,
        form_artifact_binding, legacy_initial_member_for_census_v2, verify_artifact_binding,
        verify_census_v2, verify_family,
    },
};

const FAMILY_FROZEN_EVENT: &str = "TRIAL_FAMILY_FROZEN_V1";
const ARTIFACT_BOUND_EVENT: &str = "ARTIFACT_TRIAL_FAMILY_BOUND_V1";
const CENSUS_ADVANCED_EVENT: &str = "TRIAL_FAMILY_CENSUS_ADVANCED_V2";

macro_rules! table {
    ($name:literal, [$(($column:literal, $data_type:literal)),* $(,)?], [$($constraint:literal),* $(,)?], [$($kind:ident $keys:literal),* $(,)?]) => {
        crate::schema_materialization::PublicTableSpec {
            name: $name,
            columns: &[$(crate::schema_materialization::required($column, $data_type)),*],
            constraints: &[$($constraint),*],
            indexes: &[$(table!(@index $kind $keys)),*],
        }
    };
    (@index primary $keys:literal) => { crate::schema_materialization::primary_index($keys) };
    (@index unique $keys:literal) => { crate::schema_materialization::unique_index($keys) };
}

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    table!("rd_trial_families_v1", [
        ("trial_family_identity", "text"), ("intent_identity", "text"),
        ("root_digest", "text"), ("root_json", "jsonb"),
        ("root_receipt_json", "jsonb"), ("committed_at_epoch_ms", "bigint")
    ], ["p:trial_family_identity:::false:false:true:", "u:intent_identity:::false:false:true:"],
    [primary "trial_family_identity", unique "intent_identity"]),
    table!("rd_trial_family_members_v1", [
        ("member_identity", "text"), ("trial_family_identity", "text"),
        ("ordinal", "integer"), ("fact_identity", "text"), ("member_digest", "text"),
        ("member_json", "jsonb"), ("membership_receipt_json", "jsonb"),
        ("committed_at_epoch_ms", "bigint")
    ], [
        "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):aas:false:false:true:",
        "p:member_identity:::false:false:true:", "u:fact_identity:::false:false:true:",
        "u:trial_family_identity,ordinal:::false:false:true:"
    ], [primary "member_identity", unique "fact_identity", unique "trial_family_identity,ordinal"]),
    table!("rd_trial_family_heads_v1", [
        ("trial_family_identity", "text"), ("frontier_identity", "text"),
        ("frontier_digest", "text"), ("frontier_json", "jsonb"),
        ("committed_at_epoch_ms", "bigint")
    ], [
        "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):aas:false:false:true:",
        "p:trial_family_identity:::false:false:true:", "u:frontier_identity:::false:false:true:"
    ], [primary "trial_family_identity", unique "frontier_identity"]),
    table!("rd_trial_family_attempt_cuts_v2", [
        ("census_frontier_identity", "text"), ("trial_family_identity", "text"),
        ("attempt_ordinal", "integer"), ("attempt_frontier_identity", "text"),
        ("candidate_set_frontier_identity", "text"), ("census_frontier_json", "jsonb"),
        ("attempt_frontier_json", "jsonb"), ("candidate_set_frontier_json", "jsonb"),
        ("committed_at_epoch_ms", "bigint")
    ], [
        "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):aas:false:false:true:",
        "p:census_frontier_identity:::false:false:true:",
        "u:attempt_frontier_identity:::false:false:true:",
        "u:candidate_set_frontier_identity:::false:false:true:",
        "u:trial_family_identity,attempt_ordinal:::false:false:true:"
    ], [primary "census_frontier_identity", unique "attempt_frontier_identity", unique "candidate_set_frontier_identity", unique "trial_family_identity,attempt_ordinal"]),
    table!("rd_artifact_trial_family_bindings_v1", [
        ("binding_identity", "text"), ("artifact_identity", "text"),
        ("build_receipt_identity", "text"), ("intent_identity", "text"),
        ("trial_family_identity", "text"), ("binding_digest", "text"),
        ("binding_json", "jsonb"), ("binding_receipt_json", "jsonb"),
        ("committed_at_epoch_ms", "bigint")
    ], [
        "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):aas:false:false:true:",
        "p:binding_identity:::false:false:true:", "u:artifact_identity:::false:false:true:",
        "u:build_receipt_identity:::false:false:true:"
    ], [primary "binding_identity", unique "artifact_identity", unique "build_receipt_identity"]),
    table!("rd_owner_outbox_v1", [
        ("event_identity", "text"), ("aggregate_identity", "text"), ("event_kind", "text"),
        ("payload_digest", "text"), ("payload_json", "jsonb"),
        ("committed_at_epoch_ms", "bigint")
    ], ["p:event_identity:::false:false:true:", "u:aggregate_identity,event_kind:::false:false:true:"],
    [primary "event_identity", unique "aggregate_identity,event_kind", unique "aggregate_identity,event_kind"]),
];

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), TrialFamilyError> {
    for (relation_name, statement) in [
        (
            "rd_trial_families_v1",
            "CREATE TABLE IF NOT EXISTS rd_trial_families_v1 (trial_family_identity TEXT PRIMARY KEY, intent_identity TEXT NOT NULL UNIQUE, root_digest TEXT NOT NULL, root_json JSONB NOT NULL, root_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        ),
        (
            "rd_trial_family_members_v1",
            "CREATE TABLE IF NOT EXISTS rd_trial_family_members_v1 (member_identity TEXT PRIMARY KEY, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), ordinal INTEGER NOT NULL, fact_identity TEXT NOT NULL UNIQUE, member_digest TEXT NOT NULL, member_json JSONB NOT NULL, membership_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (trial_family_identity, ordinal))",
        ),
        (
            "rd_trial_family_heads_v1",
            "CREATE TABLE IF NOT EXISTS rd_trial_family_heads_v1 (trial_family_identity TEXT PRIMARY KEY REFERENCES rd_trial_families_v1(trial_family_identity), frontier_identity TEXT NOT NULL UNIQUE, frontier_digest TEXT NOT NULL, frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        ),
        (
            "rd_trial_family_attempt_cuts_v2",
            "CREATE TABLE IF NOT EXISTS rd_trial_family_attempt_cuts_v2 (census_frontier_identity TEXT PRIMARY KEY, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), attempt_ordinal INTEGER NOT NULL, attempt_frontier_identity TEXT NOT NULL UNIQUE, candidate_set_frontier_identity TEXT NOT NULL UNIQUE, census_frontier_json JSONB NOT NULL, attempt_frontier_json JSONB NOT NULL, candidate_set_frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (trial_family_identity, attempt_ordinal))",
        ),
        (
            "rd_artifact_trial_family_bindings_v1",
            "CREATE TABLE IF NOT EXISTS rd_artifact_trial_family_bindings_v1 (binding_identity TEXT PRIMARY KEY, artifact_identity TEXT NOT NULL UNIQUE, build_receipt_identity TEXT NOT NULL UNIQUE, intent_identity TEXT NOT NULL, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), binding_digest TEXT NOT NULL, binding_json JSONB NOT NULL, binding_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        ),
        (
            "rd_owner_outbox_v1",
            "CREATE TABLE IF NOT EXISTS rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind))",
        ),
    ] {
        crate::schema_materialization::materialize_public_table(pool, relation_name, statement)
            .await
            .map_err(storage)?;
    }
    crate::replay_policy_catalog_postgres_v2::migrate(pool)
        .await
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
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
        replay_execution_policy_v2: family.root.policy().replay_execution_policy_v2().cloned(),
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

    if head_rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "family census incomplete".to_string(),
        ));
    }
    let head_row = &head_rows[0];
    let frontier_json: serde_json::Value = head_row.try_get("frontier_json").map_err(storage)?;
    let schema_version = frontier_json
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| TrialFamilyError::Unavailable("family head schema missing".to_string()))?;

    match schema_version {
        1 => {}
        2 => {
            return Box::pin(load_trial_family_census_v2_in_transaction(
                transaction,
                intent_identity,
                research_receipt_identity,
            ))
            .await
            .map(|readback| readback.legacy_family);
        }
        _ => {
            return Err(TrialFamilyError::Unavailable(
                "family head schema is unsupported".to_string(),
            ));
        }
    }

    if member_rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "family census incomplete".to_string(),
        ));
    }
    let member_row = &member_rows[0];
    let member_json = member_row.try_get("member_json").map_err(storage)?;
    let membership_receipt_json = member_row
        .try_get("membership_receipt_json")
        .map_err(storage)?;
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

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )
)]
pub(crate) async fn append_trial_family_attempt_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
    research_receipt_identity: &str,
    append: TrialFamilyAttemptAppendV2,
    now_epoch_ms: u64,
) -> Result<TrialFamilyCensusReadbackV2, TrialFamilyError> {
    let head = sqlx::query("SELECT frontier_identity, frontier_json FROM rd_trial_family_heads_v1 WHERE trial_family_identity = (SELECT trial_family_identity FROM rd_trial_families_v1 WHERE intent_identity = $1) FOR UPDATE")
        .bind(intent_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if head.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "family census head missing".to_string(),
        ));
    }
    let prior_frontier_identity: String = head[0].try_get("frontier_identity").map_err(storage)?;
    let prior_frontier_json: serde_json::Value =
        head[0].try_get("frontier_json").map_err(storage)?;
    let schema_version = prior_frontier_json
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| TrialFamilyError::Unavailable("family head schema missing".to_string()))?;
    let (legacy_family, prior) = match schema_version {
        1 => (
            load_trial_family_in_transaction(
                transaction,
                intent_identity,
                research_receipt_identity,
            )
            .await?,
            None,
        ),
        2 => {
            let prior = load_trial_family_census_v2_in_transaction(
                transaction,
                intent_identity,
                research_receipt_identity,
            )
            .await?;
            (prior.legacy_family.clone(), Some(prior))
        }
        _ => {
            return Err(TrialFamilyError::Unavailable(
                "family head schema is unsupported".to_string(),
            ));
        }
    };
    let prior_member_count = prior.as_ref().map_or(1, |readback| readback.members.len());
    let next = append_attempt_to_census_v2(legacy_family, prior.as_ref(), append, now_epoch_ms)?;
    let committed_at = i64::try_from(now_epoch_ms).map_err(unavailable)?;

    for (member, receipt) in next
        .members
        .iter()
        .zip(&next.membership_receipts)
        .skip(prior_member_count)
    {
        sqlx::query("INSERT INTO rd_trial_family_members_v1 (member_identity, trial_family_identity, ordinal, fact_identity, member_digest, member_json, membership_receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(member.member_identity())
            .bind(member.trial_family_identity())
            .bind(i32::try_from(member.ordinal()).map_err(unavailable)?)
            .bind(member.fact_identity())
            .bind(member.member_digest())
            .bind(encode(member)?)
            .bind(encode(receipt)?)
            .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(unavailable)?)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;
    }
    sqlx::query("INSERT INTO rd_trial_family_attempt_cuts_v2 (census_frontier_identity, trial_family_identity, attempt_ordinal, attempt_frontier_identity, candidate_set_frontier_identity, census_frontier_json, attempt_frontier_json, candidate_set_frontier_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(next.census_frontier.frontier_identity())
        .bind(next.census_frontier.trial_family_identity())
        .bind(i32::try_from(next.candidate_set_frontier.attempt_ordinal()).map_err(unavailable)?)
        .bind(next.attempt_frontier.frontier_identity())
        .bind(next.candidate_set_frontier.frontier_identity())
        .bind(encode(&next.census_frontier)?)
        .bind(encode(&next.attempt_frontier)?)
        .bind(encode(&next.candidate_set_frontier)?)
        .bind(committed_at)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    let updated = sqlx::query("UPDATE rd_trial_family_heads_v1 SET frontier_identity = $1, frontier_digest = $2, frontier_json = $3, committed_at_epoch_ms = $4 WHERE trial_family_identity = $5 AND frontier_identity = $6")
        .bind(next.census_frontier.frontier_identity())
        .bind(next.census_frontier.frontier_digest())
        .bind(encode(&next.census_frontier)?)
        .bind(committed_at)
        .bind(next.census_frontier.trial_family_identity())
        .bind(&prior_frontier_identity)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    if updated.rows_affected() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "family census head changed concurrently".to_string(),
        ));
    }
    let payload = CensusAdvancedOutboxV2 {
        schema_version: 2,
        research_receipt_identity: research_receipt_identity.to_string(),
        trial_family_identity: next.census_frontier.trial_family_identity().to_string(),
        census_frontier_identity: next.census_frontier.frontier_identity().to_string(),
        census_frontier_digest: next.census_frontier.frontier_digest().to_string(),
        attempt_frontier_identity: next.attempt_frontier.frontier_identity().to_string(),
        attempt_frontier_digest: next.attempt_frontier.frontier_digest().to_string(),
        candidate_set_frontier_identity: next
            .candidate_set_frontier
            .frontier_identity()
            .to_string(),
        candidate_set_frontier_digest: next.candidate_set_frontier.frontier_digest().to_string(),
    };
    persist_outbox(
        transaction,
        census_event_identity(&next),
        next.census_frontier.frontier_identity(),
        CENSUS_ADVANCED_EVENT,
        &payload,
        now_epoch_ms,
    )
    .await?;
    load_trial_family_census_v2_in_transaction(
        transaction,
        intent_identity,
        research_receipt_identity,
    )
    .await
}

pub(crate) async fn load_trial_family_census_v2_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
    research_receipt_identity: &str,
) -> Result<TrialFamilyCensusReadbackV2, TrialFamilyError> {
    let roots = sqlx::query("SELECT trial_family_identity, intent_identity, root_digest, root_json, root_receipt_json, committed_at_epoch_ms FROM rd_trial_families_v1 WHERE intent_identity = $1 FOR SHARE")
        .bind(intent_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if roots.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "family root missing".to_string(),
        ));
    }
    let family_identity: String = roots[0].try_get("trial_family_identity").map_err(storage)?;
    let member_rows = sqlx::query("SELECT member_identity, trial_family_identity, ordinal, fact_identity, member_digest, member_json, membership_receipt_json, committed_at_epoch_ms FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1 ORDER BY ordinal FOR SHARE")
        .bind(&family_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let cut_rows = sqlx::query("SELECT census_frontier_identity, trial_family_identity, attempt_ordinal, attempt_frontier_identity, candidate_set_frontier_identity, census_frontier_json, attempt_frontier_json, candidate_set_frontier_json, committed_at_epoch_ms FROM rd_trial_family_attempt_cuts_v2 WHERE trial_family_identity = $1 ORDER BY attempt_ordinal FOR SHARE")
        .bind(&family_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let head_rows = sqlx::query("SELECT frontier_identity, frontier_digest, frontier_json, committed_at_epoch_ms FROM rd_trial_family_heads_v1 WHERE trial_family_identity = $1 FOR SHARE")
        .bind(&family_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if member_rows.len() < 3 || cut_rows.is_empty() || head_rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "V2 family census incomplete".to_string(),
        ));
    }
    let root_json = roots[0].try_get("root_json").map_err(storage)?;
    let root_receipt_json = roots[0].try_get("root_receipt_json").map_err(storage)?;
    let initial_member_json = member_rows[0].try_get("member_json").map_err(storage)?;
    let initial_receipt_json = member_rows[0]
        .try_get("membership_receipt_json")
        .map_err(storage)?;
    let legacy_family = admit_stored_legacy_family_without_frontier(
        &root_json,
        &root_receipt_json,
        &initial_member_json,
        &initial_receipt_json,
    )?;
    verify_legacy_root_and_initial_member_row_bindings(&legacy_family, &roots[0], &member_rows[0])?;
    verify_family_outbox_in_transaction(transaction, &legacy_family, research_receipt_identity)
        .await?;
    let (initial_member, initial_receipt) = legacy_initial_member_for_census_v2(&legacy_family);
    let mut members = vec![initial_member];
    let mut receipts = vec![initial_receipt];

    for row in member_rows.iter().skip(1) {
        let member_json = row.try_get("member_json").map_err(storage)?;
        let receipt_json = row.try_get("membership_receipt_json").map_err(storage)?;
        let (member, receipt) = admit_stored_census_member_v2(&member_json, &receipt_json)?;

        if row
            .try_get::<String, _>("member_identity")
            .map_err(storage)?
            != member.member_identity()
            || row.try_get::<i32, _>("ordinal").map_err(storage)?
                != i32::try_from(member.ordinal()).map_err(unavailable)?
            || row.try_get::<String, _>("fact_identity").map_err(storage)? != member.fact_identity()
            || row.try_get::<String, _>("member_digest").map_err(storage)? != member.member_digest()
            || row
                .try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(storage)?
                != i64::try_from(receipt.committed_at_epoch_ms()).map_err(unavailable)?
        {
            return Err(TrialFamilyError::Unavailable(
                "V2 census member row mismatch".to_string(),
            ));
        }
        members.push(member);
        receipts.push(receipt);
    }
    let mut latest = None;

    for (index, row) in cut_rows.iter().enumerate() {
        let census: TrialFamilyCensusFrontierV2 =
            decode(&row.try_get("census_frontier_json").map_err(storage)?)?;
        let attempt: TrialFamilyAttemptFrontierV2 =
            decode(&row.try_get("attempt_frontier_json").map_err(storage)?)?;
        let candidate: TrialFamilyCandidateSetFrontierV2 = decode(
            &row.try_get("candidate_set_frontier_json")
                .map_err(storage)?,
        )?;
        let attempt_ordinal = i32::try_from(index).map_err(unavailable)?;
        let cut_committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
        if row
            .try_get::<String, _>("census_frontier_identity")
            .map_err(storage)?
            != census.frontier_identity()
            || row
                .try_get::<String, _>("trial_family_identity")
                .map_err(storage)?
                != family_identity
            || row.try_get::<i32, _>("attempt_ordinal").map_err(storage)? != attempt_ordinal
            || row
                .try_get::<String, _>("attempt_frontier_identity")
                .map_err(storage)?
                != attempt.frontier_identity()
            || row
                .try_get::<String, _>("candidate_set_frontier_identity")
                .map_err(storage)?
                != candidate.frontier_identity()
        {
            return Err(TrialFamilyError::Unavailable(
                "V2 attempt cut row mismatch".to_string(),
            ));
        }
        let prefix_len = (index + 1) * 3;
        if prefix_len > members.len() {
            return Err(TrialFamilyError::Unavailable(
                "V2 attempt cut skips census members".to_string(),
            ));
        }
        let first_new_member = if index == 0 { 1 } else { prefix_len - 3 };
        if receipts[first_new_member..prefix_len]
            .iter()
            .any(|receipt| {
                i64::try_from(receipt.committed_at_epoch_ms()).ok() != Some(cut_committed_at)
            })
        {
            return Err(TrialFamilyError::Unavailable(
                "V2 attempt cut commit mismatch".to_string(),
            ));
        }
        let cut = TrialFamilyCensusReadbackV2 {
            legacy_family: legacy_family.clone(),
            members: members[..prefix_len].to_vec(),
            membership_receipts: receipts[..prefix_len].to_vec(),
            attempt_frontier: attempt,
            candidate_set_frontier: candidate,
            census_frontier: census,
        };
        verify_census_v2(&cut)?;
        verify_census_outbox_in_transaction(
            transaction,
            &cut,
            research_receipt_identity,
            cut_committed_at,
        )
        .await?;
        latest = Some(cut);
    }
    let latest = latest
        .ok_or_else(|| TrialFamilyError::Unavailable("V2 family census cut missing".to_string()))?;
    let latest_cut_committed_at: i64 = cut_rows
        .last()
        .ok_or_else(|| TrialFamilyError::Unavailable("V2 family census cut missing".to_string()))?
        .try_get("committed_at_epoch_ms")
        .map_err(storage)?;
    let head = &head_rows[0];
    if members.len() != latest.members.len()
        || head
            .try_get::<String, _>("frontier_identity")
            .map_err(storage)?
            != latest.census_frontier.frontier_identity()
        || head
            .try_get::<String, _>("frontier_digest")
            .map_err(storage)?
            != latest.census_frontier.frontier_digest()
        || head
            .try_get::<serde_json::Value, _>("frontier_json")
            .map_err(storage)?
            != encode(&latest.census_frontier)?
        || head
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != latest_cut_committed_at
    {
        return Err(TrialFamilyError::Unavailable(
            "V2 census head mismatch".to_string(),
        ));
    }
    Ok(latest)
}

fn verify_row_bindings(
    family: &TrialFamilyReadbackV1,
    root_row: &sqlx::postgres::PgRow,
    member_row: &sqlx::postgres::PgRow,
    head_row: &sqlx::postgres::PgRow,
) -> Result<(), TrialFamilyError> {
    verify_legacy_root_and_initial_member_row_bindings(family, root_row, member_row)?;
    let head_family_identity: String =
        head_row.try_get("trial_family_identity").map_err(storage)?;
    let frontier_identity: String = head_row.try_get("frontier_identity").map_err(storage)?;
    let frontier_digest: String = head_row.try_get("frontier_digest").map_err(storage)?;
    let head_committed_at: i64 = head_row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let canonical_commit =
        i64::try_from(family.root_receipt.committed_at_epoch_ms()).map_err(unavailable)?;

    if family.census_frontier.trial_family_identity() != head_family_identity
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

fn verify_legacy_root_and_initial_member_row_bindings(
    family: &TrialFamilyReadbackV1,
    root_row: &sqlx::postgres::PgRow,
    member_row: &sqlx::postgres::PgRow,
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
        || payload.replay_execution_policy_v2
            != family.root.policy().replay_execution_policy_v2().cloned()
    {
        return Err(TrialFamilyError::Unavailable(
            "family outbox mismatch".to_string(),
        ));
    }
    Ok(())
}

async fn verify_census_outbox_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &TrialFamilyCensusReadbackV2,
    research_receipt_identity: &str,
    expected_committed_at_epoch_ms: i64,
) -> Result<(), TrialFamilyError> {
    let rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE event_identity = $1 FOR SHARE")
        .bind(census_event_identity(readback))
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "V2 census outbox missing".to_string(),
        ));
    }
    let row = &rows[0];
    let payload: CensusAdvancedOutboxV2 = decode(&row.try_get("payload_json").map_err(storage)?)?;
    if payload.schema_version != 2
        || row
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != census_event_identity(readback)
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != readback.census_frontier.frontier_identity()
        || row.try_get::<String, _>("event_kind").map_err(storage)? != CENSUS_ADVANCED_EVENT
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != digest("rd.owner-outbox.payload.v1", &payload)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != expected_committed_at_epoch_ms
        || payload.research_receipt_identity != research_receipt_identity
        || payload.trial_family_identity != readback.census_frontier.trial_family_identity()
        || payload.census_frontier_identity != readback.census_frontier.frontier_identity()
        || payload.census_frontier_digest != readback.census_frontier.frontier_digest()
        || payload.attempt_frontier_identity != readback.attempt_frontier.frontier_identity()
        || payload.attempt_frontier_digest != readback.attempt_frontier.frontier_digest()
        || payload.candidate_set_frontier_identity
            != readback.candidate_set_frontier.frontier_identity()
        || payload.candidate_set_frontier_digest
            != readback.candidate_set_frontier.frontier_digest()
    {
        return Err(TrialFamilyError::Unavailable(
            "V2 census outbox mismatch".to_string(),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay_execution_policy_v2: Option<crate::ReplayPolicyCatalogBindingV2>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CensusAdvancedOutboxV2 {
    schema_version: u32,
    research_receipt_identity: String,
    trial_family_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    attempt_frontier_identity: String,
    attempt_frontier_digest: String,
    candidate_set_frontier_identity: String,
    candidate_set_frontier_digest: String,
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

fn census_event_identity(readback: &TrialFamilyCensusReadbackV2) -> String {
    format!(
        "rd-owner-outbox-v2-{}",
        readback
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
            TrialFamilyAttemptAppendV2, TrialFamilyAttemptTerminalDispositionV2,
            TrialFamilyCandidateSetProposalV2, TrialFamilyIndependenceDispositionV1,
            TrialFamilyPolicyV1, form_initial_family,
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

    #[tokio::test]
    #[ignore = "requires an admitted RD_OWNER_TEST_DATABASE_URL"]
    async fn v2_census_append_restart_readback_and_fail_close_are_atomic() {
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
        let intent_identity = format!("rd-research-intent-v2-census-{suffix}");
        let intent_digest = format!("sha256:{}", "d".repeat(64));
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
            receipt_identity: format!("rd-research-request-receipt-v2-census-{suffix}"),
            request_identity: format!("research-request-v2-census-{suffix}"),
            semantic_digest: intent_digest.clone(),
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(intent_identity.clone()),
            committed_at_epoch_ms: committed_at,
            rejection_code: None,
        };
        let mut transaction = pool.begin().await.unwrap();
        persist_initial_family(&mut transaction, &family, &receipt)
            .await
            .unwrap();
        transaction.commit().await.unwrap();

        let first_append = TrialFamilyAttemptAppendV2 {
            intent_identity: intent_identity.clone(),
            intent_digest: intent_digest.clone(),
            request_identity: format!("rd-replay-request-v2-census-a-{suffix}"),
            request_digest: format!("sha256:{}", "1".repeat(64)),
            result_identity: format!("backtest-result-v2-census-a-{suffix}"),
            result_digest: format!("sha256:{}", "2".repeat(64)),
            terminal_disposition: TrialFamilyAttemptTerminalDispositionV2::Rejected,
            consumed_trial_budget: 1,
            candidate_set: TrialFamilyCandidateSetProposalV2 {
                generation_rule_identity: format!("rd-candidate-generation-v2-a-{suffix}"),
                generation_rule_digest: format!("sha256:{}", "3".repeat(64)),
                expected_cardinality: 0,
                candidates: Vec::new(),
            },
        };
        let mut transaction = pool.begin().await.unwrap();
        let first = append_trial_family_attempt_in_transaction(
            &mut transaction,
            &intent_identity,
            &receipt.receipt_identity,
            first_append,
            committed_at + 1,
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();

        let restarted_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(test_database.database_url())
            .await
            .unwrap();
        let mut transaction = restarted_pool.begin().await.unwrap();
        let projected_family = load_trial_family_in_transaction(
            &mut transaction,
            &intent_identity,
            &receipt.receipt_identity,
        )
        .await
        .unwrap();
        assert_eq!(projected_family, family);
        assert_eq!(
            serde_json::to_vec(&projected_family).unwrap(),
            serde_json::to_vec(&family).unwrap()
        );
        assert_eq!(
            load_trial_family_census_v2_in_transaction(
                &mut transaction,
                &intent_identity,
                &receipt.receipt_identity,
            )
            .await
            .unwrap(),
            first
        );
        transaction.rollback().await.unwrap();

        let second_append = TrialFamilyAttemptAppendV2 {
            intent_identity: format!("rd-research-intent-v2-census-b-{suffix}"),
            intent_digest: format!("sha256:{}", "4".repeat(64)),
            request_identity: format!("rd-replay-request-v2-census-b-{suffix}"),
            request_digest: format!("sha256:{}", "5".repeat(64)),
            result_identity: format!("backtest-result-v2-census-b-{suffix}"),
            result_digest: format!("sha256:{}", "6".repeat(64)),
            terminal_disposition: TrialFamilyAttemptTerminalDispositionV2::Unknown,
            consumed_trial_budget: 2,
            candidate_set: TrialFamilyCandidateSetProposalV2 {
                generation_rule_identity: format!("rd-candidate-generation-v2-b-{suffix}"),
                generation_rule_digest: format!("sha256:{}", "7".repeat(64)),
                expected_cardinality: 0,
                candidates: Vec::new(),
            },
        };
        let mut transaction = pool.begin().await.unwrap();
        let second = append_trial_family_attempt_in_transaction(
            &mut transaction,
            &intent_identity,
            &receipt.receipt_identity,
            second_append.clone(),
            committed_at + 2,
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        assert_eq!(second.members.len(), 6);
        assert_eq!(second.consumed_trial_budget(), 2);

        for statement in [
            "UPDATE rd_trial_families_v1 SET root_digest = root_digest || '-mutated' WHERE trial_family_identity = $1",
            "UPDATE rd_trial_families_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE trial_family_identity = $1",
            "UPDATE rd_trial_family_members_v1 SET member_identity = member_identity || '-mutated' WHERE trial_family_identity = $1 AND ordinal = 0",
            "UPDATE rd_trial_family_members_v1 SET ordinal = -1 WHERE trial_family_identity = $1 AND ordinal = 0",
            "UPDATE rd_trial_family_members_v1 SET fact_identity = fact_identity || '-mutated' WHERE trial_family_identity = $1 AND ordinal = 0",
            "UPDATE rd_trial_family_members_v1 SET member_digest = member_digest || '-mutated' WHERE trial_family_identity = $1 AND ordinal = 0",
            "UPDATE rd_trial_family_members_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE trial_family_identity = $1 AND ordinal = 0",
        ] {
            let mut transaction = pool.begin().await.unwrap();
            sqlx::query(statement)
                .bind(&family_identity)
                .execute(&mut *transaction)
                .await
                .unwrap();
            assert!(
                load_trial_family_census_v2_in_transaction(
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
        let second_event_identity = census_event_identity(&second);
        let payload_json: serde_json::Value = sqlx::query_scalar(
            "SELECT payload_json FROM rd_owner_outbox_v1 WHERE event_identity = $1 FOR UPDATE",
        )
        .bind(&second_event_identity)
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
        let mut payload: CensusAdvancedOutboxV2 = decode(&payload_json).unwrap();
        payload.schema_version = 3;
        sqlx::query(
            "UPDATE rd_owner_outbox_v1 SET payload_json = $1, payload_digest = $2 WHERE event_identity = $3",
        )
        .bind(encode(&payload).unwrap())
        .bind(digest("rd.owner-outbox.payload.v1", &payload).unwrap())
        .bind(&second_event_identity)
        .execute(&mut *transaction)
        .await
        .unwrap();
        assert!(
            load_trial_family_census_v2_in_transaction(
                &mut transaction,
                &intent_identity,
                &receipt.receipt_identity,
            )
            .await
            .is_err()
        );
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

        let counts_before: (i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1), (SELECT COUNT(*) FROM rd_trial_family_attempt_cuts_v2 WHERE trial_family_identity = $1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind = 'TRIAL_FAMILY_CENSUS_ADVANCED_V2' AND payload_json->>'trial_family_identity' = $1)",
        )
        .bind(&family_identity)
        .fetch_one(&pool)
        .await
        .unwrap();
        let mut invalid = second_append;
        invalid.consumed_trial_budget = 3;
        invalid.candidate_set.expected_cardinality = 1;
        let mut transaction = pool.begin().await.unwrap();
        assert!(
            append_trial_family_attempt_in_transaction(
                &mut transaction,
                &intent_identity,
                &receipt.receipt_identity,
                invalid,
                committed_at + 3,
            )
            .await
            .is_err()
        );
        transaction.rollback().await.unwrap();
        let counts_after: (i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1), (SELECT COUNT(*) FROM rd_trial_family_attempt_cuts_v2 WHERE trial_family_identity = $1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind = 'TRIAL_FAMILY_CENSUS_ADVANCED_V2' AND payload_json->>'trial_family_identity' = $1)",
        )
        .bind(&family_identity)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(counts_after, counts_before);

        let mut transaction = pool.begin().await.unwrap();
        sqlx::query("UPDATE rd_trial_family_attempt_cuts_v2 SET candidate_set_frontier_json = jsonb_set(candidate_set_frontier_json, '{expected_cardinality}', '1'::jsonb) WHERE census_frontier_identity = $1")
            .bind(second.census_frontier.frontier_identity())
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            load_trial_family_census_v2_in_transaction(
                &mut transaction,
                &intent_identity,
                &receipt.receipt_identity,
            )
            .await
            .is_err()
        );
        transaction.rollback().await.unwrap();

        let cleanup_pool = mutation.pool();
        sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity IN ($1, $2, $3)")
            .bind(&family_identity)
            .bind(first.census_frontier.frontier_identity())
            .bind(second.census_frontier.frontier_identity())
            .execute(cleanup_pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_family_attempt_cuts_v2 WHERE trial_family_identity = $1")
            .bind(&family_identity)
            .execute(cleanup_pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_family_heads_v1 WHERE trial_family_identity = $1")
            .bind(&family_identity)
            .execute(cleanup_pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1")
            .bind(&family_identity)
            .execute(cleanup_pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_families_v1 WHERE trial_family_identity = $1")
            .bind(&family_identity)
            .execute(cleanup_pool)
            .await
            .unwrap();
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
            replay_execution_policy_v2: None,
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
