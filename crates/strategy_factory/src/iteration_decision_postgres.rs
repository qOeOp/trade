//! PostgreSQL custody for R&D-owned `REPAIR_INPUTS` Iteration Decisions.

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;

use crate::{
    BacktestResultCustodyErrorV2, ExploratoryReplayResultLocatorV2,
    iteration_decision::{
        IterationDecisionErrorV1, IterationDecisionGateV1, IterationNoDecisionReasonV1,
        RepairInputIterationDecisionReadbackV1, admit_stored_repair_input_decision_v1,
        gate_locked_exploratory_result_v1, issue_repair_input_decision_v1,
    },
    trial_family::TrialFamilyError,
    trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction,
};

const DECISION_COMMITTED_EVENT_V1: &str = "ITERATION_DECISION_COMMITTED_V1";

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_iteration_decisions_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("trial_family_identity", "text"),
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("attempt_identity", "text"),
            crate::schema_materialization::required("decision_digest", "text"),
            crate::schema_materialization::required("decision_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("decision_storage_bytes", "bytea"),
            crate::schema_materialization::required("decision_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):a:a:s:false:false:true:",
            "p:decision_identity:::false:false:true:",
            "u:request_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
            "u:attempt_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("decision_identity"),
            crate::schema_materialization::unique_index("request_identity"),
            crate::schema_materialization::unique_index("result_identity"),
            crate::schema_materialization::unique_index("attempt_identity"),
        ],
    },
];

/// Caller-owned locators. They carry no Result, diagnosis, outcome, or Decision authority.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionCompositionRequestV1 {
    pub trial_family_identity: String,
    pub result_identity: String,
    pub request_identity: String,
    pub attempt_identity: String,
}

/// Exact lookup for response-loss recovery. It cannot create first custody.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationDecisionResolutionLocatorV1 {
    pub decision_identity: String,
    pub result_identity: String,
}

#[derive(Debug, Error)]
pub enum IterationDecisionPostgresErrorV1 {
    #[error("Iteration Decision locator is invalid")]
    InvalidLocator,
    #[error("R&D TrialFamily custody is unavailable: {0}")]
    TrialFamily(#[from] TrialFamilyError),
    #[error("Backtest Result custody is unavailable: {0}")]
    Backtest(#[from] BacktestResultCustodyErrorV2),
    #[error("R&D Iteration Decision is unavailable: {0}")]
    Decision(#[from] IterationDecisionErrorV1),
    #[error("R&D Iteration Decision is intentionally absent: {0:?}")]
    NoDecision(IterationNoDecisionReasonV1),
    #[error("the locked Result requires policy interpretation rather than REPAIR_INPUTS")]
    InterpretationRequired,
    #[error("R&D Iteration Decision storage is unavailable: {0}")]
    Storage(String),
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), IterationDecisionPostgresErrorV1> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_iteration_decisions_v1",
        "CREATE TABLE IF NOT EXISTS rd_iteration_decisions_v1 (decision_identity TEXT PRIMARY KEY, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), request_identity TEXT NOT NULL UNIQUE, result_identity TEXT NOT NULL UNIQUE, attempt_identity TEXT NOT NULL UNIQUE, decision_digest TEXT NOT NULL, decision_json JSONB NOT NULL, receipt_json JSONB NOT NULL, decision_storage_bytes BYTEA NOT NULL, decision_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(storage)
}

pub(crate) async fn compose_repair_input_decision_v1(
    pool: &PgPool,
    request: DecisionCompositionRequestV1,
) -> Result<RepairInputIterationDecisionReadbackV1, IterationDecisionPostgresErrorV1> {
    validate_composition_request(&request)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    lock_composition_key(&mut transaction, &request.result_identity).await?;
    if let Some(existing) =
        load_by_result_in_transaction(&mut transaction, &request.result_identity, Some(&request))
            .await?
    {
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }

    let census = load_trial_family_census_v2_by_family_in_transaction(
        &mut transaction,
        &request.trial_family_identity,
    )
    .await?;
    let locked_result = crate::resolve_exploratory_replay_result_for_rd_in_transaction(
        &mut transaction,
        ExploratoryReplayResultLocatorV2 {
            result_identity: &request.result_identity,
            request_identity: &request.request_identity,
            attempt_identity: &request.attempt_identity,
        },
    )
    .await?
    .ok_or(BacktestResultCustodyErrorV2::Unavailable)?;
    let gate = gate_locked_exploratory_result_v1(&census, &locked_result)?;
    let (evidence_cut, supported_defects, selected_category, target) = match gate {
        IterationDecisionGateV1::RepairInputs {
            evidence_cut,
            supported_defects,
            selected_category,
            target,
        } => (evidence_cut, supported_defects, selected_category, target),
        IterationDecisionGateV1::NoDecision { reason } => {
            transaction.rollback().await.map_err(storage)?;
            return Err(IterationDecisionPostgresErrorV1::NoDecision(reason));
        }
        IterationDecisionGateV1::InterpretationRequired { .. } => {
            transaction.rollback().await.map_err(storage)?;
            return Err(IterationDecisionPostgresErrorV1::InterpretationRequired);
        }
    };
    let issued = issue_repair_input_decision_v1(
        evidence_cut,
        supported_defects,
        selected_category,
        target,
        current_epoch_ms()?,
    )?;
    persist_decision(&mut transaction, &issued).await?;
    let readback =
        load_by_result_in_transaction(&mut transaction, &request.result_identity, Some(&request))
            .await?
            .ok_or_else(|| storage("committed Decision readback is missing"))?;
    if readback != issued {
        return Err(storage("committed Decision readback changed"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

pub(crate) async fn resolve_repair_input_decision_v1(
    pool: &PgPool,
    locator: IterationDecisionResolutionLocatorV1,
) -> Result<Option<RepairInputIterationDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    if !valid_locator(&locator.decision_identity) || !valid_locator(&locator.result_identity) {
        return Err(IterationDecisionPostgresErrorV1::InvalidLocator);
    }
    let mut transaction = pool.begin().await.map_err(storage)?;
    let readback =
        load_by_result_in_transaction(&mut transaction, &locator.result_identity, None).await?;
    if let Some(value) = readback.as_ref()
        && value.decision().decision_identity() != locator.decision_identity
    {
        return Err(storage("Decision resolution locator mismatch"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

async fn lock_composition_key(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(result_identity)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn persist_decision(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &RepairInputIterationDecisionReadbackV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let decision = readback.decision();
    let receipt = readback.receipt();
    let evidence = decision.evidence_cut();
    let decision_bytes = serde_json::to_vec(decision).map_err(storage)?;
    let receipt_bytes = serde_json::to_vec(receipt).map_err(storage)?;
    let decision_json =
        serde_json::from_slice::<serde_json::Value>(&decision_bytes).map_err(storage)?;
    let receipt_json =
        serde_json::from_slice::<serde_json::Value>(&receipt_bytes).map_err(storage)?;
    let decision_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        "rd.iteration-decision.storage.v1",
        &decision_bytes,
    );
    let receipt_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        "rd.iteration-decision-receipt.storage.v1",
        &receipt_bytes,
    );
    sqlx::query("INSERT INTO rd_iteration_decisions_v1 (decision_identity,trial_family_identity,request_identity,result_identity,attempt_identity,decision_digest,decision_json,receipt_json,decision_storage_bytes,decision_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
        .bind(decision.decision_identity())
        .bind(&evidence.trial_family_identity)
        .bind(&evidence.request_identity)
        .bind(&evidence.result_identity)
        .bind(&evidence.attempt_identity)
        .bind(decision.decision_digest())
        .bind(decision_json)
        .bind(receipt_json)
        .bind(decision_bytes)
        .bind(decision_storage_digest)
        .bind(receipt_bytes)
        .bind(receipt_storage_digest)
        .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    let payload = DecisionCommittedOutboxV1 {
        schema_version: 1,
        decision_identity: decision.decision_identity().to_string(),
        decision_digest: decision.decision_digest().to_string(),
        receipt_identity: receipt.receipt_identity().to_string(),
        trial_family_identity: evidence.trial_family_identity.clone(),
        census_frontier_identity: evidence.census_frontier_identity.clone(),
        result_identity: evidence.result_identity.clone(),
        decision_policy_binding_digest: evidence.decision_policy_binding_digest,
    };
    let payload_json = serde_json::to_value(&payload).map_err(storage)?;
    let payload_digest = canonical_digest("rd.owner-outbox.iteration-decision.v1", &payload)?;
    let event_identity = format!(
        "rd-owner-outbox-iteration-decision-v1-{}",
        payload_digest.trim_start_matches("sha256:")
    );
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity)
        .bind(decision.decision_identity())
        .bind(DECISION_COMMITTED_EVENT_V1)
        .bind(payload_digest)
        .bind(payload_json)
        .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn load_by_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
    composition: Option<&DecisionCompositionRequestV1>,
) -> Result<Option<RepairInputIterationDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    let rows = sqlx::query("SELECT decision_identity,trial_family_identity,request_identity,result_identity,attempt_identity,decision_digest,decision_json,receipt_json,decision_storage_bytes,decision_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_iteration_decisions_v1 WHERE result_identity=$1 FOR SHARE")
        .bind(result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.is_empty() {
        return Ok(None);
    }
    if rows.len() != 1 {
        return Err(storage("Decision result identity is not unique"));
    }
    let row = &rows[0];
    let decision_bytes: Vec<u8> = row.try_get("decision_storage_bytes").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(storage)?;
    if row
        .try_get::<String, _>("decision_storage_digest")
        .map_err(storage)?
        != crate::native_replay_rd_sources_v2::owner_storage_digest(
            "rd.iteration-decision.storage.v1",
            &decision_bytes,
        )
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(storage)?
            != crate::native_replay_rd_sources_v2::owner_storage_digest(
                "rd.iteration-decision-receipt.storage.v1",
                &receipt_bytes,
            )
    {
        return Err(storage("Decision storage digest mismatch"));
    }
    let readback = admit_stored_repair_input_decision_v1(&decision_bytes, &receipt_bytes)?;
    let decision = readback.decision();
    let receipt = readback.receipt();
    let evidence = decision.evidence_cut();
    let decision_json: serde_json::Value = row.try_get("decision_json").map_err(storage)?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    if decision_json != serde_json::to_value(decision).map_err(storage)?
        || receipt_json != serde_json::to_value(receipt).map_err(storage)?
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(storage)?
            != decision.decision_identity()
        || row
            .try_get::<String, _>("decision_digest")
            .map_err(storage)?
            != decision.decision_digest()
        || row
            .try_get::<String, _>("trial_family_identity")
            .map_err(storage)?
            != evidence.trial_family_identity
        || row
            .try_get::<String, _>("request_identity")
            .map_err(storage)?
            != evidence.request_identity
        || row
            .try_get::<String, _>("result_identity")
            .map_err(storage)?
            != evidence.result_identity
        || row
            .try_get::<String, _>("attempt_identity")
            .map_err(storage)?
            != evidence.attempt_identity
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("Decision row/readback mismatch"));
    }
    if let Some(request) = composition
        && (request.trial_family_identity != evidence.trial_family_identity
            || request.request_identity != evidence.request_identity
            || request.result_identity != evidence.result_identity
            || request.attempt_identity != evidence.attempt_identity)
    {
        return Err(storage("Decision composition locator mismatch"));
    }
    verify_outbox_in_transaction(transaction, &readback).await?;
    Ok(Some(readback))
}

async fn verify_outbox_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &RepairInputIterationDecisionReadbackV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let rows = sqlx::query("SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(readback.decision().decision_identity())
        .bind(DECISION_COMMITTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(storage("Decision outbox custody is incomplete"));
    }
    let evidence = readback.decision().evidence_cut();
    let expected = DecisionCommittedOutboxV1 {
        schema_version: 1,
        decision_identity: readback.decision().decision_identity().to_string(),
        decision_digest: readback.decision().decision_digest().to_string(),
        receipt_identity: readback.receipt().receipt_identity().to_string(),
        trial_family_identity: evidence.trial_family_identity.clone(),
        census_frontier_identity: evidence.census_frontier_identity.clone(),
        result_identity: evidence.result_identity.clone(),
        decision_policy_binding_digest: evidence.decision_policy_binding_digest,
    };
    let payload: DecisionCommittedOutboxV1 =
        serde_json::from_value(rows[0].try_get("payload_json").map_err(storage)?)
            .map_err(storage)?;
    if payload != expected
        || rows[0]
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != expected.decision_identity
        || rows[0]
            .try_get::<String, _>("event_kind")
            .map_err(storage)?
            != DECISION_COMMITTED_EVENT_V1
        || rows[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != canonical_digest("rd.owner-outbox.iteration-decision.v1", &expected)?
        || rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("Decision outbox/readback mismatch"));
    }
    Ok(())
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct DecisionCommittedOutboxV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    receipt_identity: String,
    trial_family_identity: String,
    census_frontier_identity: String,
    result_identity: String,
    decision_policy_binding_digest: [u8; 32],
}

fn validate_composition_request(
    request: &DecisionCompositionRequestV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    if [
        request.trial_family_identity.as_str(),
        request.result_identity.as_str(),
        request.request_identity.as_str(),
        request.attempt_identity.as_str(),
    ]
    .into_iter()
    .all(valid_locator)
    {
        Ok(())
    } else {
        Err(IterationDecisionPostgresErrorV1::InvalidLocator)
    }
}

fn valid_locator(value: &str) -> bool {
    (4..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

fn current_epoch_ms() -> Result<u64, IterationDecisionPostgresErrorV1> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(storage)?;
    u64::try_from(duration.as_millis()).map_err(storage)
}

fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, IterationDecisionPostgresErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    serde_json::to_vec(&Envelope { domain, value })
        .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
        .map_err(storage)
}

fn storage(error: impl Display) -> IterationDecisionPostgresErrorV1 {
    IterationDecisionPostgresErrorV1::Storage(error.to_string())
}
