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
        gate_locked_exploratory_result_v1, is_valid_iteration_decision_locator_v1,
        issue_interpretation_context_v1, issue_repair_input_decision_v1,
    },
    product_edge::ResearchGoalOwnerError,
    rd_owner_postgres_custody::{ResearchCustodyLookupV1, admit_research_custody_in_transaction},
    repair_action::{
        RepairActionErrorV1, RepairActionRequestReadbackV1, admit_stored_repair_action_request_v1,
        issue_repair_action_request_v1,
    },
    trial_family::TrialFamilyError,
    trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction,
};

const DECISION_COMMITTED_EVENT_V1: &str = "ITERATION_DECISION_COMMITTED_V1";
const REPAIR_ACTION_REQUESTED_EVENT_V1: &str = "REPAIR_ACTION_REQUESTED_V1";

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
    crate::schema_materialization::PublicTableSpec {
        name: "rd_repair_action_requests_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("action_request_identity", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("action_request_digest", "text"),
            crate::schema_materialization::required("request_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("request_storage_bytes", "bytea"),
            crate::schema_materialization::required("request_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:decision_identity:public.rd_iteration_decisions_v1(decision_identity):a:a:s:false:false:true:",
            "p:action_request_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("action_request_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
            crate::schema_materialization::unique_index("result_identity"),
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairActionCompositionRequestV1 {
    pub decision_identity: String,
    pub result_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairActionResolutionLocatorV1 {
    pub action_request_identity: String,
    pub decision_identity: String,
}

#[derive(Debug, Error)]
pub enum IterationDecisionPostgresErrorV1 {
    #[error("Iteration Decision locator is invalid")]
    InvalidLocator,
    #[error("R&D TrialFamily custody is unavailable: {0}")]
    TrialFamily(#[from] TrialFamilyError),
    #[error("Backtest Result custody is unavailable: {0}")]
    Backtest(#[from] BacktestResultCustodyErrorV2),
    #[error("R&D Research Intent custody is unavailable: {0}")]
    ResearchCustody(#[from] ResearchGoalOwnerError),
    #[error("R&D Iteration Decision is unavailable: {0}")]
    Decision(#[from] IterationDecisionErrorV1),
    #[error("R&D repair action request is unavailable: {0}")]
    RepairAction(#[from] RepairActionErrorV1),
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
    .map_err(storage)?;
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_repair_action_requests_v1",
        "CREATE TABLE IF NOT EXISTS rd_repair_action_requests_v1 (action_request_identity TEXT PRIMARY KEY, decision_identity TEXT NOT NULL UNIQUE REFERENCES rd_iteration_decisions_v1(decision_identity), result_identity TEXT NOT NULL UNIQUE, action_request_digest TEXT NOT NULL, request_json JSONB NOT NULL, receipt_json JSONB NOT NULL, request_storage_bytes BYTEA NOT NULL, request_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(storage)?;
    crate::market_data_repair_request_postgres::migrate(pool)
        .await
        .map_err(|error| storage(error.to_string()))
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
            let intent_identity = census
                .legacy_family
                .initial_intent_member()
                .fact_identity()
                .to_string();
            let research_custody = admit_research_custody_in_transaction(
                &mut transaction,
                ResearchCustodyLookupV1::Intent(&intent_identity),
            )
            .await?
            .ok_or(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                "frozen Research Intent custody is missing",
            ))?;
            let interpretation =
                issue_interpretation_context_v1(&census, &research_custody, &locked_result)?;
            if !interpretation.has_unresolved_diagnosis() {
                transaction.rollback().await.map_err(storage)?;
                return Err(IterationDecisionPostgresErrorV1::Decision(
                    IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                        "resolved interpretation has no admitted Decision composer",
                    ),
                ));
            }
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
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
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

pub(crate) async fn compose_repair_action_request_v1(
    pool: &PgPool,
    request: RepairActionCompositionRequestV1,
) -> Result<RepairActionRequestReadbackV1, IterationDecisionPostgresErrorV1> {
    validate_repair_action_composition(&request)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    lock_composition_key(&mut transaction, &request.decision_identity).await?;
    if let Some(existing) =
        load_repair_action_in_transaction(&mut transaction, &request.decision_identity, None)
            .await?
    {
        if existing.request().result_identity() != request.result_identity {
            return Err(storage("repair action retry locator mismatch"));
        }
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }
    let decision = load_by_result_in_transaction(&mut transaction, &request.result_identity, None)
        .await?
        .ok_or_else(|| storage("Iteration Decision custody is missing"))?;
    if decision.decision().decision_identity() != request.decision_identity {
        return Err(storage("repair action Decision locator mismatch"));
    }
    let issued = issue_repair_action_request_v1(&decision, current_epoch_ms()?)?;
    persist_repair_action(&mut transaction, &issued).await?;
    let readback = load_repair_action_in_transaction(
        &mut transaction,
        &request.decision_identity,
        Some(&decision),
    )
    .await?
    .ok_or_else(|| storage("committed repair action readback is missing"))?;
    if readback != issued {
        return Err(storage("committed repair action readback changed"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

pub(crate) async fn resolve_repair_action_request_v1(
    pool: &PgPool,
    locator: RepairActionResolutionLocatorV1,
) -> Result<Option<RepairActionRequestReadbackV1>, IterationDecisionPostgresErrorV1> {
    if !is_valid_iteration_decision_locator_v1(&locator.action_request_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
    {
        return Err(IterationDecisionPostgresErrorV1::InvalidLocator);
    }
    let mut transaction = pool.begin().await.map_err(storage)?;
    let readback =
        load_repair_action_in_transaction(&mut transaction, &locator.decision_identity, None)
            .await?;
    if let Some(value) = readback.as_ref()
        && value.request().action_request_identity() != locator.action_request_identity
    {
        return Err(storage("repair action resolution locator mismatch"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

async fn persist_repair_action(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &RepairActionRequestReadbackV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let request = readback.request();
    let receipt = readback.receipt();
    let request_bytes = serde_json::to_vec(request).map_err(storage)?;
    let receipt_bytes = serde_json::to_vec(receipt).map_err(storage)?;
    let request_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        "rd.repair-action-request.storage.v1",
        &request_bytes,
    );
    let receipt_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        "rd.repair-action-request-receipt.storage.v1",
        &receipt_bytes,
    );
    sqlx::query("INSERT INTO rd_repair_action_requests_v1 (action_request_identity,decision_identity,result_identity,action_request_digest,request_json,receipt_json,request_storage_bytes,request_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(request.action_request_identity())
        .bind(request.decision_identity())
        .bind(request.result_identity())
        .bind(request.action_request_digest())
        .bind(serde_json::to_value(request).map_err(storage)?)
        .bind(serde_json::to_value(receipt).map_err(storage)?)
        .bind(request_bytes)
        .bind(request_storage_digest)
        .bind(receipt_bytes)
        .bind(receipt_storage_digest)
        .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    let payload = RepairActionRequestedOutboxV1 {
        schema_version: 1,
        action_request_identity: request.action_request_identity().to_string(),
        action_request_digest: request.action_request_digest().to_string(),
        receipt_identity: receipt.receipt_identity().to_string(),
        decision_identity: request.decision_identity().to_string(),
        decision_digest: request.decision_digest().to_string(),
        result_identity: request.result_identity().to_string(),
        category: request.category(),
        target: request.target(),
    };
    let payload_digest = canonical_digest("rd.owner-outbox.repair-action-request.v1", &payload)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(format!("rd-owner-outbox-repair-action-v1-{}", payload_digest.trim_start_matches("sha256:")))
        .bind(request.action_request_identity())
        .bind(REPAIR_ACTION_REQUESTED_EVENT_V1)
        .bind(payload_digest)
        .bind(serde_json::to_value(payload).map_err(storage)?)
        .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

pub(crate) async fn load_repair_action_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
    known_decision: Option<&RepairInputIterationDecisionReadbackV1>,
) -> Result<Option<RepairActionRequestReadbackV1>, IterationDecisionPostgresErrorV1> {
    let rows = sqlx::query("SELECT action_request_identity,decision_identity,result_identity,action_request_digest,request_json,receipt_json,request_storage_bytes,request_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_repair_action_requests_v1 WHERE decision_identity=$1 FOR SHARE")
        .bind(decision_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.is_empty() {
        return Ok(None);
    }
    if rows.len() != 1 {
        return Err(storage("repair action Decision identity is not unique"));
    }
    let row = &rows[0];
    let result_identity: String = row.try_get("result_identity").map_err(storage)?;
    let decision = match known_decision {
        Some(value) => value.clone(),
        None => load_by_result_in_transaction(transaction, &result_identity, None)
            .await?
            .ok_or_else(|| storage("repair action predecessor Decision is missing"))?,
    };
    if decision.decision().decision_identity() != decision_identity {
        return Err(storage("repair action predecessor Decision mismatch"));
    }
    let request_bytes: Vec<u8> = row.try_get("request_storage_bytes").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(storage)?;
    if row
        .try_get::<String, _>("request_storage_digest")
        .map_err(storage)?
        != crate::native_replay_rd_sources_v2::owner_storage_digest(
            "rd.repair-action-request.storage.v1",
            &request_bytes,
        )
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(storage)?
            != crate::native_replay_rd_sources_v2::owner_storage_digest(
                "rd.repair-action-request-receipt.storage.v1",
                &receipt_bytes,
            )
    {
        return Err(storage("repair action storage digest mismatch"));
    }
    let readback =
        admit_stored_repair_action_request_v1(&request_bytes, &receipt_bytes, &decision)?;
    let request = readback.request();
    let receipt = readback.receipt();
    if row
        .try_get::<String, _>("action_request_identity")
        .map_err(storage)?
        != request.action_request_identity()
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(storage)?
            != request.decision_identity()
        || result_identity != request.result_identity()
        || row
            .try_get::<String, _>("action_request_digest")
            .map_err(storage)?
            != request.action_request_digest()
        || row
            .try_get::<serde_json::Value, _>("request_json")
            .map_err(storage)?
            != serde_json::to_value(request).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != serde_json::to_value(receipt).map_err(storage)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("repair action row/readback mismatch"));
    }
    verify_repair_action_outbox(transaction, &readback).await?;
    Ok(Some(readback))
}

async fn verify_repair_action_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &RepairActionRequestReadbackV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let request = readback.request();
    let rows = sqlx::query("SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(request.action_request_identity())
        .bind(REPAIR_ACTION_REQUESTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(storage("repair action outbox custody is incomplete"));
    }
    let expected = RepairActionRequestedOutboxV1 {
        schema_version: 1,
        action_request_identity: request.action_request_identity().to_string(),
        action_request_digest: request.action_request_digest().to_string(),
        receipt_identity: readback.receipt().receipt_identity().to_string(),
        decision_identity: request.decision_identity().to_string(),
        decision_digest: request.decision_digest().to_string(),
        result_identity: request.result_identity().to_string(),
        category: request.category(),
        target: request.target(),
    };
    if rows[0]
        .try_get::<String, _>("aggregate_identity")
        .map_err(storage)?
        != expected.action_request_identity
        || rows[0]
            .try_get::<String, _>("event_kind")
            .map_err(storage)?
            != REPAIR_ACTION_REQUESTED_EVENT_V1
        || rows[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != canonical_digest("rd.owner-outbox.repair-action-request.v1", &expected)?
        || rows[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != serde_json::to_value(&expected).map_err(storage)?
        || rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("repair action outbox/readback mismatch"));
    }
    Ok(())
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct RepairActionRequestedOutboxV1 {
    schema_version: u16,
    action_request_identity: String,
    action_request_digest: String,
    receipt_identity: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    category: crate::iteration_decision::IterationRepairCategoryV1,
    target: crate::iteration_decision::IterationRepairTargetV1,
}

fn validate_repair_action_composition(
    request: &RepairActionCompositionRequestV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    if is_valid_iteration_decision_locator_v1(&request.decision_identity)
        && is_valid_iteration_decision_locator_v1(&request.result_identity)
    {
        Ok(())
    } else {
        Err(IterationDecisionPostgresErrorV1::InvalidLocator)
    }
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

pub(crate) async fn load_by_result_in_transaction(
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
    .all(is_valid_iteration_decision_locator_v1)
    {
        Ok(())
    } else {
        Err(IterationDecisionPostgresErrorV1::InvalidLocator)
    }
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

#[cfg(test)]
mod postgres_acceptance_tests {
    use super::*;
    use serde::Serialize;
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ComponentObservationLocatorV2, ContentIdentityV2, DiagnosticCategoryV2,
        DiagnosticEvidenceDtoV2, ObservationComponentV2, OpaqueIdentityV2, ReconciliationAtomDtoV2,
        ReconciliationStatusV2, ReplayAuthorityClaimV2, ReplayModelProfilesV2, ReplayNamespaceV2,
        ReplayRequestDtoV2, ReplayRequestV2, ReplayResultDtoV2, ReplayTerminalV2, ReplayWindowV2,
        VersionedIdentityV2,
    };
    use vibe_data::owner::pit_snapshot::sealed_acceptance::{
        SealedAcceptanceMarketDataRepairEvidenceV1, issue_market_data_repair_evidence_v1,
    };
    use vibe_rd_market_data_repair_custody::{
        SealedMarketDataRepairRequestLocatorV1, lock_market_data_repair_request_v1,
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use crate::{
        product_edge::{ResearchRequestDisposition, ResearchRequestReceiptV1},
        replay_economic_configuration_v1::{ReplayEconomicConfigurationV1, economic_fixture},
        replay_execution_policy_v2::ReplayExecutionPolicyV2,
        replay_policy_catalog_v2::{ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogBindingV3},
        replay_runner_operational_profile_v1::{ReplayRunnerOperationalProfileV1, runner_fixture},
        trial_family::{
            TrialFamilyAttemptAppendV2, TrialFamilyAttemptTerminalDispositionV2,
            TrialFamilyCandidateSetProposalV2, TrialFamilyIndependenceDispositionV1,
            TrialFamilyPolicyV1, form_initial_family,
        },
        trial_family_postgres::{
            append_trial_family_attempt_in_transaction, persist_initial_family,
        },
    };

    const RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.replay-result-storage.v2";
    const RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.result-receipt-storage.v1";
    const OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.result-outbox-storage.v1";
    const RECEIPT_DIGEST_DOMAIN: &str = "vibe.backtest.result-receipt.v1";
    const OUTBOX_PAYLOAD_DIGEST_DOMAIN: &str = "vibe.backtest.result-outbox-payload.v1";
    const OUTBOX_EVENT_DIGEST_DOMAIN: &str = "vibe.backtest.result-outbox-event.v1";
    const RESULT_EVENT_KIND: &str = "EXPLORATORY_BACKTEST_RESULT_COMMITTED_V1";

    #[derive(Serialize)]
    struct ResultDigestPreimageV2<'a> {
        schema_version: u16,
        request_identity: &'a OpaqueIdentityV2,
        request_meaning_digest: &'a CanonicalDigestV2,
        namespace: ReplayNamespaceV2,
        replay_authority: &'a ReplayAuthorityClaimV2,
        attempt_identity: &'a OpaqueIdentityV2,
        terminal: ReplayTerminalV2,
        reconciliation: &'a [ReconciliationAtomDtoV2],
        semantic_trace:
            Option<&'a vibe_backtest_owner_contracts::ConsumedComponentObservationDtoV2>,
        diagnostic_census: &'a [DiagnosticEvidenceDtoV2],
    }

    #[derive(Serialize)]
    struct ResultReceiptV1 {
        schema_version: u16,
        receipt_identity: OpaqueIdentityV2,
        receipt_digest: CanonicalDigestV2,
        request_identity: OpaqueIdentityV2,
        request_meaning_digest: CanonicalDigestV2,
        result_identity: OpaqueIdentityV2,
        result_digest: CanonicalDigestV2,
        namespace: ReplayNamespaceV2,
        outbox_event_identity: OpaqueIdentityV2,
        committed_at_epoch_ms: u64,
    }

    #[derive(Serialize)]
    struct ResultReceiptPreimageV1<'a> {
        schema_version: u16,
        receipt_identity: &'a OpaqueIdentityV2,
        request_identity: &'a OpaqueIdentityV2,
        request_meaning_digest: &'a CanonicalDigestV2,
        result_identity: &'a OpaqueIdentityV2,
        result_digest: &'a CanonicalDigestV2,
        namespace: ReplayNamespaceV2,
        outbox_event_identity: &'a OpaqueIdentityV2,
        committed_at_epoch_ms: u64,
    }

    #[derive(Serialize)]
    struct ResultOutboxPayloadV1 {
        schema_version: u16,
        receipt_identity: OpaqueIdentityV2,
        receipt_digest: CanonicalDigestV2,
        request_identity: OpaqueIdentityV2,
        request_meaning_digest: CanonicalDigestV2,
        result_identity: OpaqueIdentityV2,
        result_digest: CanonicalDigestV2,
        namespace: ReplayNamespaceV2,
        committed_at_epoch_ms: u64,
    }

    #[derive(Serialize)]
    struct ResultOutboxV1 {
        schema_version: u16,
        event_identity: OpaqueIdentityV2,
        event_digest: CanonicalDigestV2,
        aggregate_identity: OpaqueIdentityV2,
        event_kind: OpaqueIdentityV2,
        payload_digest: CanonicalDigestV2,
        payload: ResultOutboxPayloadV1,
        committed_at_epoch_ms: u64,
    }

    #[derive(Serialize)]
    struct ResultOutboxPreimageV1<'a> {
        schema_version: u16,
        event_identity: &'a OpaqueIdentityV2,
        aggregate_identity: &'a OpaqueIdentityV2,
        event_kind: &'a OpaqueIdentityV2,
        payload_digest: &'a CanonicalDigestV2,
        payload: &'a ResultOutboxPayloadV1,
        committed_at_epoch_ms: u64,
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D and Backtest Owner PostgreSQL topology"]
    async fn repair_decision_action_and_market_data_request_commit_retry_resolve_and_rejection_are_atomic() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let mutation = database.mutation();
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
        let suffix = unique_suffix();
        let committed_at = current_epoch_ms().expect("test clock");
        let intent_identity = format!("rd-research-intent-decision-{suffix}");
        let intent_digest = digest('a');
        let policy = decision_family_policy();
        let family = form_initial_family(&intent_identity, &intent_digest, policy, committed_at)
            .expect("sealed Decision family");
        let family_identity = family.root().trial_family_identity().to_string();
        let research_receipt = ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity: format!("rd-research-request-receipt-decision-{suffix}"),
            request_identity: format!("rd-research-request-decision-{suffix}"),
            semantic_digest: intent_digest.clone(),
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(intent_identity.clone()),
            committed_at_epoch_ms: committed_at,
            rejection_code: None,
        };

        let request_identity = format!("rd-replay-request-decision-{suffix}");
        let market_data_evidence =
            issue_market_data_repair_evidence_v1().expect("sealed Market Data repair evidence");
        let replay = repair_replay(
            &market_data_evidence,
            &request_identity,
            &family_identity,
            &suffix,
        );
        let request_digest = replay
            .meaning_digest()
            .expect("Replay request meaning")
            .as_str()
            .to_string();
        let attempt_identity = format!("backtest-attempt-decision-{suffix}");
        let result = repair_result(
            &request_identity,
            &request_digest,
            &attempt_identity,
            &suffix,
        );
        let result_bytes = result.to_canonical_bytes().expect("canonical Result");
        let result_identity = result.result_identity.as_str().to_string();
        let result_digest = result.result_digest.as_str().to_string();

        let mut family_transaction = rd_pool.begin().await.expect("family transaction");
        persist_initial_family(&mut family_transaction, &family, &research_receipt)
            .await
            .expect("family custody");
        append_trial_family_attempt_in_transaction(
            &mut family_transaction,
            &intent_identity,
            &research_receipt.receipt_identity,
            TrialFamilyAttemptAppendV2 {
                intent_identity: intent_identity.clone(),
                intent_digest: intent_digest.clone(),
                request_identity: request_identity.clone(),
                request_digest: request_digest.clone(),
                result_identity: result_identity.clone(),
                result_digest: result_digest.clone(),
                terminal_disposition: TrialFamilyAttemptTerminalDispositionV2::Invalid,
                consumed_trial_budget: 1,
                candidate_set: TrialFamilyCandidateSetProposalV2 {
                    generation_rule_identity: format!("rd-candidate-generation-decision-{suffix}"),
                    generation_rule_digest: digest('c'),
                    expected_cardinality: 0,
                    candidates: Vec::new(),
                },
            },
            committed_at + 1,
        )
        .await
        .expect("attempt census");
        family_transaction.commit().await.expect("family commit");

        persist_backtest_result(backtest_pool, &result, &result_bytes, committed_at + 2).await;

        let request = DecisionCompositionRequestV1 {
            trial_family_identity: family_identity,
            result_identity: result_identity.clone(),
            request_identity,
            attempt_identity,
        };
        let first = compose_repair_input_decision_v1(rd_pool, request.clone())
            .await
            .expect("first Decision commit");
        let retried = compose_repair_input_decision_v1(rd_pool, request)
            .await
            .expect("same-meaning retry");
        assert_eq!(
            serde_json::to_vec(&retried).unwrap(),
            serde_json::to_vec(&first).unwrap()
        );

        let resolved = resolve_repair_input_decision_v1(
            rd_pool,
            IterationDecisionResolutionLocatorV1 {
                decision_identity: first.decision().decision_identity().to_string(),
                result_identity: result_identity.clone(),
            },
        )
        .await
        .expect("Decision resolve")
        .expect("stored Decision");
        assert_eq!(
            serde_json::to_vec(&resolved).unwrap(),
            serde_json::to_vec(&first).unwrap()
        );

        let counts_before: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_iteration_decisions_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='ITERATION_DECISION_COMMITTED_V1')",
        )
        .bind(&result_identity)
        .bind(first.decision().decision_identity())
        .fetch_one(rd_pool)
        .await
        .expect("Decision counts");
        assert_eq!(counts_before, (1, 1));

        let action_composition = RepairActionCompositionRequestV1 {
            decision_identity: first.decision().decision_identity().to_string(),
            result_identity: result_identity.clone(),
        };
        let first_action = compose_repair_action_request_v1(rd_pool, action_composition.clone())
            .await
            .expect("first repair action request commit");
        let retried_action = compose_repair_action_request_v1(rd_pool, action_composition)
            .await
            .expect("same-meaning repair action retry");
        assert_eq!(
            serde_json::to_vec(&retried_action).unwrap(),
            serde_json::to_vec(&first_action).unwrap()
        );

        let resolved_action = resolve_repair_action_request_v1(
            rd_pool,
            RepairActionResolutionLocatorV1 {
                action_request_identity: first_action
                    .request()
                    .action_request_identity()
                    .to_string(),
                decision_identity: first.decision().decision_identity().to_string(),
            },
        )
        .await
        .expect("repair action request resolve")
        .expect("stored repair action request");
        assert_eq!(
            serde_json::to_vec(&resolved_action).unwrap(),
            serde_json::to_vec(&first_action).unwrap()
        );

        let action_counts_before: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_repair_action_requests_v1 WHERE decision_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='REPAIR_ACTION_REQUESTED_V1')",
        )
        .bind(first.decision().decision_identity())
        .bind(first_action.request().action_request_identity())
        .fetch_one(rd_pool)
        .await
        .expect("repair action custody counts");
        assert_eq!(action_counts_before, (1, 1));

        let first_market_data = crate::market_data_repair_request_postgres::compose_with_sealed_owner_evidence_for_test_v1(
            rd_pool,
            first_action.request().action_request_identity(),
            first.decision().decision_identity(),
            &replay,
            market_data_evidence.source(),
            market_data_evidence.shared_time(),
        )
        .await
        .expect("first Market Data repair request commit");
        let retried_market_data = crate::market_data_repair_request_postgres::compose_with_sealed_owner_evidence_for_test_v1(
            rd_pool,
            first_action.request().action_request_identity(),
            first.decision().decision_identity(),
            &replay,
            market_data_evidence.source(),
            market_data_evidence.shared_time(),
        )
        .await
        .expect("same-meaning Market Data repair retry");
        assert_eq!(
            serde_json::to_vec(&retried_market_data).unwrap(),
            serde_json::to_vec(&first_market_data).unwrap()
        );
        let resolved_market_data = crate::market_data_repair_request_postgres::resolve_with_sealed_owner_evidence_for_test_v1(
            rd_pool,
            first_action.request().action_request_identity(),
            first.decision().decision_identity(),
            &replay,
            market_data_evidence.source(),
            market_data_evidence.shared_time(),
        )
        .await
        .expect("Market Data repair request resolve")
        .expect("stored Market Data repair request");
        assert_eq!(
            serde_json::to_vec(&resolved_market_data).unwrap(),
            serde_json::to_vec(&first_market_data).unwrap()
        );
        let market_data_counts_before: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_market_data_repair_requests_v1 WHERE action_request_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='MARKET_DATA_REPAIR_REQUESTED_V1')",
        )
        .bind(first_action.request().action_request_identity())
        .bind(first_market_data.request().request_identity())
        .fetch_one(rd_pool)
        .await
        .expect("Market Data repair custody counts");
        assert_eq!(market_data_counts_before, (1, 1));

        let market_data_pool = mutation.pool(CanonicalOwnerTestRoleV1::MarketDataOwner);
        let mut market_data_transaction = market_data_pool
            .begin()
            .await
            .expect("Market Data read transaction");
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *market_data_transaction)
            .await
            .expect("Market Data serializable isolation");
        let sealed_market_data_request = lock_market_data_repair_request_v1(
            &mut market_data_transaction,
            &SealedMarketDataRepairRequestLocatorV1 {
                request_identity: first_market_data.request().request_identity().to_string(),
                request_digest: first_market_data.request().request_digest().to_string(),
                receipt_identity: first_market_data.receipt().receipt_identity().to_string(),
                receipt_digest: first_market_data.receipt().receipt_digest().to_string(),
            },
        )
        .await
        .expect("fixed Market Data Owner read port");
        assert!(sealed_market_data_request.is_market_data_target());
        assert_eq!(
            sealed_market_data_request.canonical_request_bytes(),
            first_market_data
                .request()
                .to_canonical_bytes()
                .expect("canonical Market Data repair request")
        );
        market_data_transaction
            .commit()
            .await
            .expect("read transaction commit");

        let mismatched_market_data = crate::market_data_repair_request_postgres::compose_with_sealed_owner_evidence_for_test_v1(
            rd_pool,
            first_action.request().action_request_identity(),
            "rd-iteration-decision-v1-mismatch",
            &replay,
            market_data_evidence.source(),
            market_data_evidence.shared_time(),
        )
        .await;
        assert!(mismatched_market_data.is_err());
        let mismatched_market_data_resolve = crate::market_data_repair_request_postgres::resolve_with_sealed_owner_evidence_for_test_v1(
            rd_pool,
            "rd-repair-action-request-v1-mismatch",
            first.decision().decision_identity(),
            &replay,
            market_data_evidence.source(),
            market_data_evidence.shared_time(),
        )
        .await;
        assert!(mismatched_market_data_resolve.is_err());
        let market_data_counts_after: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_market_data_repair_requests_v1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind='MARKET_DATA_REPAIR_REQUESTED_V1')",
        )
        .fetch_one(rd_pool)
        .await
        .expect("post-rejection Market Data repair counts");
        assert_eq!(market_data_counts_after, (1, 1));

        let mismatched_action_retry = compose_repair_action_request_v1(
            rd_pool,
            RepairActionCompositionRequestV1 {
                decision_identity: first.decision().decision_identity().to_string(),
                result_identity: "backtest-replay-result-v2-mismatch".to_string(),
            },
        )
        .await;
        assert!(mismatched_action_retry.is_err());
        let invalid_action = compose_repair_action_request_v1(
            rd_pool,
            RepairActionCompositionRequestV1 {
                decision_identity: "bad locator with spaces".to_string(),
                result_identity: result_identity.clone(),
            },
        )
        .await;
        assert!(matches!(
            invalid_action,
            Err(IterationDecisionPostgresErrorV1::InvalidLocator)
        ));
        let mismatched_action_resolve = resolve_repair_action_request_v1(
            rd_pool,
            RepairActionResolutionLocatorV1 {
                action_request_identity: "rd-repair-action-request-v1-mismatch".to_string(),
                decision_identity: first.decision().decision_identity().to_string(),
            },
        )
        .await;
        assert!(mismatched_action_resolve.is_err());
        let action_counts_after: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_repair_action_requests_v1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind='REPAIR_ACTION_REQUESTED_V1')",
        )
        .fetch_one(rd_pool)
        .await
        .expect("post-rejection repair action counts");
        assert_eq!(action_counts_after, (1, 1));

        let rejected = compose_repair_input_decision_v1(
            rd_pool,
            DecisionCompositionRequestV1 {
                trial_family_identity: "bad locator with spaces".to_string(),
                result_identity: result_identity.clone(),
                request_identity: "bad".to_string(),
                attempt_identity: "bad".to_string(),
            },
        )
        .await;
        assert!(matches!(
            rejected,
            Err(IterationDecisionPostgresErrorV1::InvalidLocator)
        ));
        let mismatched_resolve = resolve_repair_input_decision_v1(
            rd_pool,
            IterationDecisionResolutionLocatorV1 {
                decision_identity: "rd-iteration-decision-v1-mismatch".to_string(),
                result_identity,
            },
        )
        .await;
        assert!(mismatched_resolve.is_err());
        let counts_after: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_iteration_decisions_v1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind='ITERATION_DECISION_COMMITTED_V1')",
        )
        .fetch_one(rd_pool)
        .await
        .expect("post-rejection counts");
        assert_eq!(counts_after, (1, 1));
    }

    fn decision_family_policy() -> TrialFamilyPolicyV1 {
        let economic = ReplayEconomicConfigurationV1::seal(economic_fixture()).unwrap();
        let runner = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();
        let versioned = |value: &str| VersionedIdentityV2 {
            identity: identity(value),
            version: identity("v1"),
        };
        let content = |value: &str, digest: CanonicalDigestV2| ContentIdentityV2 {
            identity: identity(value),
            digest,
        };
        let execution = ReplayExecutionPolicyV2 {
            runtime_kernel: versioned("runtime-kernel-v2"),
            simulator: versioned("simulator-v2"),
            cost: versioned("cost-model-v1"),
            slippage: versioned("slippage-model-v1"),
            capacity: versioned("capacity-model-v1"),
            runner_operational_profile: versioned("runner-profile-v1"),
            diagnostic_policy: versioned("diagnostic-policy-v1"),
            deterministic_seed: 17,
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 2,
            },
            calendar: versioned("calendar-v1"),
            session: versioned("session-v1"),
            time_zone: versioned("time-zone-v1"),
            correction_rule: versioned("correction-rule-v1"),
            market_semantics: versioned("market-semantics-v1"),
            replay_configuration: content(
                "economic-profile-v1",
                CanonicalDigestV2::try_from(format!("sha256:{}", hex(&economic.digest()))).unwrap(),
            ),
            corporate_action_cut: content("corporate-action-cut-v1", canonical_digest_value('d')),
            historical_membership_cut: content("membership-cut-v1", canonical_digest_value('e')),
        };
        let catalog_v2 = ReplayPolicyCatalogBindingV2::from_policy(
            "replay-policy-catalog-decision-v2",
            1,
            &execution,
        )
        .unwrap();
        let catalog_v3 =
            ReplayPolicyCatalogBindingV3::issue(catalog_v2.clone(), &economic, &runner).unwrap();
        TrialFamilyPolicyV1 {
            trial_budget: 2,
            stop_rule: "stop on falsifier or bounded budget".to_string(),
            pit_rule_identity: "pit-rule-v1".to_string(),
            cost_model_identity: "cost-model-v1".to_string(),
            slippage_model_identity: "slippage-model-v1".to_string(),
            capacity_model_identity: "capacity-model-v1".to_string(),
            semantic_predecessor_frontier: Vec::new(),
            protected_feedback_frontier: "protected-feedback-frontier-v1".to_string(),
            independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
            independence_basis_identity: "independence-basis-v1".to_string(),
            frozen_falsifier_binding: digest('f'),
            replay_execution_policy_v2: Some(catalog_v2),
            replay_policy_catalog_v3: Some(catalog_v3.clone()),
            decision_policy_v1: Some(
                crate::iteration_decision::IterationDecisionPolicyBindingV1::seal(&catalog_v3)
                    .unwrap(),
            ),
        }
    }

    fn repair_replay(
        evidence: &SealedAcceptanceMarketDataRepairEvidenceV1,
        request_identity: &str,
        family_identity: &str,
        suffix: &str,
    ) -> ReplayRequestV2 {
        let source = evidence.source();
        let content = |name: &str, byte: char| ContentIdentityV2 {
            identity: identity(format!("{name}-{suffix}")),
            digest: canonical_digest_value(byte),
        };
        let version = |name: &str, byte: char| VersionedIdentityV2 {
            identity: identity(format!("{name}-{suffix}")),
            version: identity(format!("v1-{byte}")),
        };
        let from_binding = |value: vibe_data::owner::source_binding::BindingDigest| {
            CanonicalDigestV2::try_from(format!("sha256:{}", hex(value.as_bytes()))).unwrap()
        };
        ReplayRequestV2::try_from(ReplayRequestDtoV2 {
            schema_version: 2,
            request_identity: identity(request_identity),
            frozen_research_intent: content("research-intent", '1'),
            trial_family: ContentIdentityV2 {
                identity: identity(family_identity),
                digest: canonical_digest_value('2'),
            },
            trial_family_census_frontier: content("family-census", '3'),
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            strategy_design: content("strategy-design", '4'),
            strategy_plan: content("strategy-plan", '5'),
            artifact: content("artifact", '6'),
            resolved_owner_inputs: content("resolved-owner-inputs", '7'),
            pit_scope: ContentIdentityV2 {
                identity: identity(format!("pit-scope-{suffix}")),
                digest: from_binding(source.instrument_scope_digest()),
            },
            pit_snapshot: ContentIdentityV2 {
                identity: identity(format!(
                    "sha256:{}",
                    hex(source.pit_snapshot_identity().as_bytes())
                )),
                digest: from_binding(source.pit_snapshot_fact_digest()),
            },
            universe_selection: ContentIdentityV2 {
                identity: identity(format!("universe-selection-{suffix}")),
                digest: from_binding(source.universe_selection_digest()),
            },
            correction_rule: version("correction-rule", '8'),
            market_semantics: VersionedIdentityV2 {
                identity: identity(format!(
                    "sha256:{}",
                    hex(source.market_semantics_identity().as_bytes())
                )),
                version: identity("v1"),
            },
            replay_configuration: content("replay-configuration", '9'),
            models: ReplayModelProfilesV2 {
                runtime_kernel: version("runtime-kernel", 'a'),
                simulator: version("simulator", 'b'),
                cost: version("cost", 'c'),
                slippage: version("slippage", 'd'),
                capacity: version("capacity", 'e'),
            },
            runner_operational_profile: version("runner", 'f'),
            diagnostic_policy: version("diagnostic", '1'),
            deterministic_seed: 17,
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 2,
            },
            calendar: version("calendar", '2'),
            session: version("session", '3'),
            time_zone: version("time-zone", '4'),
            corporate_action_cut: content("corporate-action", '5'),
            historical_membership_cut: content("membership", '6'),
        })
        .expect("valid Market Data repair Replay request")
    }

    fn repair_result(
        request_identity: &str,
        request_digest: &str,
        attempt_identity: &str,
        suffix: &str,
    ) -> ReplayResultDtoV2 {
        let request_identity = identity(request_identity);
        let request_meaning_digest =
            CanonicalDigestV2::try_from(request_digest.to_string()).unwrap();
        let attempt_identity = identity(attempt_identity);
        let reconciliation = ObservationComponentV2::REQUESTED_MEANING
            .into_iter()
            .map(|component| {
                let meaning_identity = identity(format!("meaning-{suffix}-{component:?}"));
                let meaning_digest = canonical_digest_value('1');
                ReconciliationAtomDtoV2 {
                    component,
                    requested_meaning_identity: meaning_identity.clone(),
                    requested_meaning_digest: meaning_digest.clone(),
                    observed_meaning_identity: Some(meaning_identity),
                    observed_meaning_digest: Some(meaning_digest),
                    observation_locator: Some(ComponentObservationLocatorV2 {
                        component,
                        reference: identity(format!("observation-{suffix}-{component:?}")),
                        digest: canonical_digest_value('2'),
                    }),
                    status: ReconciliationStatusV2::Exact,
                }
            })
            .collect::<Vec<_>>();
        let diagnostic_census = vec![DiagnosticEvidenceDtoV2 {
            request_identity: request_identity.clone(),
            request_meaning_digest: request_meaning_digest.clone(),
            attempt_identity: attempt_identity.clone(),
            category: DiagnosticCategoryV2::MarketData,
            decisive_evidence: ComponentObservationLocatorV2 {
                component: ObservationComponentV2::PitSnapshot,
                reference: identity(format!("diagnostic-{suffix}")),
                digest: canonical_digest_value('3'),
            },
        }];
        let mut result = ReplayResultDtoV2 {
            schema_version: 2,
            result_identity: identity("placeholder-result"),
            result_digest: canonical_digest_value('0'),
            request_identity,
            request_meaning_digest,
            namespace: ReplayNamespaceV2::Exploratory,
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            attempt_identity,
            terminal: ReplayTerminalV2::InvalidReplayEvidence,
            reconciliation,
            semantic_trace: None,
            diagnostic_census,
        };
        let preimage = ResultDigestPreimageV2 {
            schema_version: result.schema_version,
            request_identity: &result.request_identity,
            request_meaning_digest: &result.request_meaning_digest,
            namespace: result.namespace,
            replay_authority: &result.replay_authority,
            attempt_identity: &result.attempt_identity,
            terminal: result.terminal,
            reconciliation: &result.reconciliation,
            semantic_trace: result.semantic_trace.as_ref(),
            diagnostic_census: &result.diagnostic_census,
        };
        result.result_digest = digest_value("vibe.backtest.replay-result.v2", &preimage);
        result.result_identity = identity(format!(
            "backtest-replay-result-v2-{}",
            result.result_digest.as_str().trim_start_matches("blake3:")
        ));
        result
    }

    async fn persist_backtest_result(
        pool: &PgPool,
        result: &ReplayResultDtoV2,
        result_bytes: &[u8],
        committed_at: u64,
    ) {
        let suffix = result.result_digest.as_str().trim_start_matches("blake3:");
        let receipt_identity = identity(format!("backtest-result-receipt-v1-{suffix}"));
        let event_identity = identity(format!("backtest-result-outbox-v1-{suffix}"));
        let mut receipt = ResultReceiptV1 {
            schema_version: 1,
            receipt_identity: receipt_identity.clone(),
            receipt_digest: canonical_digest_value('0'),
            request_identity: result.request_identity.clone(),
            request_meaning_digest: result.request_meaning_digest.clone(),
            result_identity: result.result_identity.clone(),
            result_digest: result.result_digest.clone(),
            namespace: ReplayNamespaceV2::Exploratory,
            outbox_event_identity: event_identity.clone(),
            committed_at_epoch_ms: committed_at,
        };
        receipt.receipt_digest = digest_value(
            RECEIPT_DIGEST_DOMAIN,
            &ResultReceiptPreimageV1 {
                schema_version: receipt.schema_version,
                receipt_identity: &receipt.receipt_identity,
                request_identity: &receipt.request_identity,
                request_meaning_digest: &receipt.request_meaning_digest,
                result_identity: &receipt.result_identity,
                result_digest: &receipt.result_digest,
                namespace: receipt.namespace,
                outbox_event_identity: &receipt.outbox_event_identity,
                committed_at_epoch_ms: receipt.committed_at_epoch_ms,
            },
        );
        let payload = ResultOutboxPayloadV1 {
            schema_version: 1,
            receipt_identity,
            receipt_digest: receipt.receipt_digest.clone(),
            request_identity: result.request_identity.clone(),
            request_meaning_digest: result.request_meaning_digest.clone(),
            result_identity: result.result_identity.clone(),
            result_digest: result.result_digest.clone(),
            namespace: ReplayNamespaceV2::Exploratory,
            committed_at_epoch_ms: committed_at,
        };
        let mut outbox = ResultOutboxV1 {
            schema_version: 1,
            event_identity,
            event_digest: canonical_digest_value('0'),
            aggregate_identity: result.result_identity.clone(),
            event_kind: identity(RESULT_EVENT_KIND),
            payload_digest: canonical_digest_value('0'),
            payload,
            committed_at_epoch_ms: committed_at,
        };
        outbox.payload_digest = digest_value(OUTBOX_PAYLOAD_DIGEST_DOMAIN, &outbox.payload);
        outbox.event_digest = digest_value(
            OUTBOX_EVENT_DIGEST_DOMAIN,
            &ResultOutboxPreimageV1 {
                schema_version: outbox.schema_version,
                event_identity: &outbox.event_identity,
                aggregate_identity: &outbox.aggregate_identity,
                event_kind: &outbox.event_kind,
                payload_digest: &outbox.payload_digest,
                payload: &outbox.payload,
                committed_at_epoch_ms: outbox.committed_at_epoch_ms,
            },
        );
        let receipt_bytes = serde_json::to_vec(&receipt).unwrap();
        let outbox_bytes = serde_json::to_vec(&outbox).unwrap();
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query("INSERT INTO backtest_replay_results_v2 (result_identity,result_digest,request_identity,request_meaning_digest,attempt_identity,terminal,canonical_bytes,canonical_bytes_blake3) VALUES ($1,$2,$3,$4,$5,'INVALID_REPLAY_EVIDENCE',$6,$7)")
            .bind(result.result_identity.as_str()).bind(result.result_digest.as_str())
            .bind(result.request_identity.as_str()).bind(result.request_meaning_digest.as_str())
            .bind(result.attempt_identity.as_str()).bind(result_bytes)
            .bind(storage_digest(RESULT_STORAGE_DOMAIN, result_bytes))
            .execute(&mut *transaction).await.unwrap();
        sqlx::query("INSERT INTO backtest_replay_result_receipts_v1 (result_identity,receipt_identity,receipt_digest,request_identity,request_meaning_digest,result_digest,namespace,outbox_event_identity,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) VALUES ($1,$2,$3,$4,$5,$6,'EXPLORATORY',$7,$8,$9,$10)")
            .bind(result.result_identity.as_str()).bind(receipt.receipt_identity.as_str())
            .bind(receipt.receipt_digest.as_str()).bind(result.request_identity.as_str())
            .bind(result.request_meaning_digest.as_str()).bind(result.result_digest.as_str())
            .bind(receipt.outbox_event_identity.as_str()).bind(i64::try_from(committed_at).unwrap())
            .bind(&receipt_bytes).bind(storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes))
            .execute(&mut *transaction).await.unwrap();
        sqlx::query("INSERT INTO backtest_replay_result_outbox_v1 (result_identity,event_identity,event_digest,receipt_identity,request_identity,request_meaning_digest,result_digest,namespace,payload_digest,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) VALUES ($1,$2,$3,$4,$5,$6,$7,'EXPLORATORY',$8,$9,$10,$11)")
            .bind(result.result_identity.as_str()).bind(outbox.event_identity.as_str())
            .bind(outbox.event_digest.as_str()).bind(receipt.receipt_identity.as_str())
            .bind(result.request_identity.as_str()).bind(result.request_meaning_digest.as_str())
            .bind(result.result_digest.as_str()).bind(outbox.payload_digest.as_str())
            .bind(i64::try_from(committed_at).unwrap()).bind(&outbox_bytes)
            .bind(storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes))
            .execute(&mut *transaction).await.unwrap();
        transaction.commit().await.unwrap();
    }

    fn identity(value: impl Into<String>) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.into()).unwrap()
    }

    fn canonical_digest_value(byte: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(digest(byte)).unwrap()
    }

    fn digest(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }

    fn digest_value(domain: &str, value: &impl Serialize) -> CanonicalDigestV2 {
        let bytes = serde_json::to_vec(value).unwrap();
        CanonicalDigestV2::try_from(storage_digest(domain, &bytes)).unwrap()
    }

    fn storage_digest(domain: &str, bytes: &[u8]) -> String {
        let mut hasher = blake3::Hasher::new();
        hasher.update(domain.as_bytes());
        hasher.update(b"\0");
        hasher.update(bytes);
        format!("blake3:{}", hasher.finalize().to_hex())
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn unique_suffix() -> String {
        format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }
}
