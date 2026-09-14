//! PostgreSQL custody for Decision-selected successor Research Intents.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;

use crate::{
    iteration_decision::{
        CandidateComparisonDecisionReadbackV1, IterationDecisionOutcomeV1,
        is_valid_iteration_decision_locator_v1,
    },
    product_edge::{FrozenResearchGoalIntent, ResearchGoalOwnerError},
    rd_owner_postgres_custody::{ResearchCustodyLookupV1, admit_research_custody_in_transaction},
    successor_intent::{
        FrozenSuccessorResearchIntentV1, SuccessorResearchIntentCompositionRequestV1,
        SuccessorResearchIntentErrorV1, SuccessorResearchIntentReadbackV1,
        SuccessorResearchIntentSourceV1, admit_stored_successor_research_intent_v1,
        issue_successor_research_intent_v1,
    },
    trial_family::{TrialFamilyCensusReadbackV2, TrialFamilyError},
};

const SUCCESSOR_INTENT_COMMITTED_EVENT_V1: &str = "SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1";

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_successor_research_intents_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("intent_identity", "text"),
            crate::schema_materialization::required("intent_digest", "text"),
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("trial_family_identity", "text"),
            crate::schema_materialization::required("predecessor_intent_identity", "text"),
            crate::schema_materialization::required("request_json", "jsonb"),
            crate::schema_materialization::required("intent_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("request_storage_bytes", "bytea"),
            crate::schema_materialization::required("request_storage_digest", "text"),
            crate::schema_materialization::required("intent_storage_bytes", "bytea"),
            crate::schema_materialization::required("intent_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:decision_identity:public.rd_iteration_decisions_v1(decision_identity):a:a:s:false:false:true:",
            "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):a:a:s:false:false:true:",
            "p:intent_identity:::false:false:true:",
            "u:request_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("intent_identity"),
            crate::schema_materialization::unique_index("request_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
            crate::schema_materialization::unique_index("result_identity"),
        ],
    },
];

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SuccessorResearchIntentResolutionLocatorV1 {
    pub intent_identity: String,
    pub decision_identity: String,
}

#[derive(Debug, Error)]
pub enum SuccessorResearchIntentPostgresErrorV1 {
    #[error("successor Research Intent locator is invalid")]
    InvalidLocator,
    #[error("R&D TrialFamily custody is unavailable: {0}")]
    TrialFamily(#[from] TrialFamilyError),
    #[error("R&D Research Intent custody is unavailable: {0}")]
    ResearchCustody(#[from] ResearchGoalOwnerError),
    #[error("R&D Iteration Decision custody is unavailable: {0}")]
    Decision(#[from] crate::IterationDecisionPostgresErrorV1),
    #[error("successor Research Intent is unavailable: {0}")]
    Intent(#[from] SuccessorResearchIntentErrorV1),
    #[error("successor Research Intent storage is unavailable: {0}")]
    Storage(String),
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_successor_research_intents_v1",
        "CREATE TABLE IF NOT EXISTS rd_successor_research_intents_v1 (intent_identity TEXT PRIMARY KEY, intent_digest TEXT NOT NULL, request_identity TEXT NOT NULL UNIQUE, decision_identity TEXT NOT NULL UNIQUE REFERENCES rd_iteration_decisions_v1(decision_identity), result_identity TEXT NOT NULL UNIQUE, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), predecessor_intent_identity TEXT NOT NULL, request_json JSONB NOT NULL, intent_json JSONB NOT NULL, receipt_json JSONB NOT NULL, request_storage_bytes BYTEA NOT NULL, request_storage_digest TEXT NOT NULL, intent_storage_bytes BYTEA NOT NULL, intent_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(storage)?;
    sqlx::query("REVOKE ALL ON TABLE public.rd_successor_research_intents_v1 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer")
        .execute(pool)
        .await
        .map_err(storage)?;
    Ok(())
}

pub(crate) async fn compose_successor_research_intent_v1(
    pool: &PgPool,
    request: SuccessorResearchIntentCompositionRequestV1,
) -> Result<SuccessorResearchIntentReadbackV1, SuccessorResearchIntentPostgresErrorV1> {
    validate_composition_request(&request)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    lock_composition_key(&mut transaction, &request.decision_identity).await?;

    if let Some(existing) = load_by_decision_in_transaction(
        &mut transaction,
        &request.decision_identity,
        Some(&request),
    )
    .await?
    {
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }

    let family_identity = load_decision_family_identity(
        &mut transaction,
        &request.decision_identity,
        &request.result_identity,
    )
    .await?;
    let census =
        crate::trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction(
            &mut transaction,
            &family_identity,
        )
        .await?;
    let decision =
        crate::iteration_decision_postgres::load_candidate_comparison_by_result_in_transaction(
            &mut transaction,
            &census,
            &request.result_identity,
            None,
        )
        .await?
        .ok_or_else(|| storage("candidate-comparison Decision is missing"))?;
    if decision.decision().decision_identity() != request.decision_identity {
        return Err(storage("successor Decision locator mismatch"));
    }

    let source = source_from_locked_custody(&mut transaction, &census, &decision).await?;
    let issued = issue_successor_research_intent_v1(request.clone(), source, current_epoch_ms()?)?;
    persist(&mut transaction, &request, &issued).await?;
    let readback = load_by_decision_in_transaction(
        &mut transaction,
        &request.decision_identity,
        Some(&request),
    )
    .await?
    .ok_or_else(|| storage("committed successor Intent readback is missing"))?;
    if readback != issued {
        return Err(storage("committed successor Intent readback changed"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

pub(crate) async fn resolve_successor_research_intent_v1(
    pool: &PgPool,
    locator: SuccessorResearchIntentResolutionLocatorV1,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    if !valid_identity(&locator.intent_identity) || !valid_identity(&locator.decision_identity) {
        return Err(SuccessorResearchIntentPostgresErrorV1::InvalidLocator);
    }
    let mut transaction = pool.begin().await.map_err(storage)?;
    let readback =
        load_by_intent_in_transaction(&mut transaction, &locator.intent_identity).await?;
    if let Some(value) = readback.as_ref()
        && value.intent().decision_identity() != locator.decision_identity
    {
        return Err(storage("successor Intent resolution locator mismatch"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

struct PredecessorContextV1 {
    intent_identity: String,
    intent_digest: String,
    source_frontier: Vec<crate::product_edge::ResearchSourceV1>,
    trial_family_identity: String,
    trial_family_policy_digest: String,
    independence_basis_identity: String,
    independence_basis_digest: String,
    protected_feedback_projection_identity: String,
    protected_feedback_projection_digest: String,
}

async fn source_from_locked_custody(
    transaction: &mut Transaction<'_, Postgres>,
    census: &TrialFamilyCensusReadbackV2,
    readback: &CandidateComparisonDecisionReadbackV1,
) -> Result<SuccessorResearchIntentSourceV1, SuccessorResearchIntentPostgresErrorV1> {
    let decision = readback.decision();
    let (experiment_identity, experiment_digest) = match decision.outcome() {
        IterationDecisionOutcomeV1::SuccessorExperiment {
            experiment_identity,
            experiment_digest,
        } => (experiment_identity, experiment_digest),
        _ => return Err(storage("Decision does not admit a successor Intent")),
    };
    let mut selected = decision
        .candidate_evaluations()
        .candidates
        .iter()
        .filter(|candidate| {
            candidate.candidate_identity == *experiment_identity
                && candidate.candidate_digest == *experiment_digest
        });
    let chosen = selected
        .next()
        .ok_or_else(|| storage("Decision-selected experiment content is missing"))?;
    if selected.next().is_some() {
        return Err(storage("Decision-selected experiment is not unique"));
    }
    let latest_intent = census.latest_intent_binding()?;
    let predecessor = load_predecessor_context(
        transaction,
        census,
        latest_intent.intent_identity,
        latest_intent.intent_digest,
    )
    .await?;
    let evidence = decision.evidence_cut();
    if predecessor.trial_family_identity != evidence.trial_family_identity
        || predecessor.trial_family_policy_digest != census.legacy_family.root().policy_digest()
    {
        return Err(storage("predecessor Intent family custody mismatch"));
    }
    Ok(SuccessorResearchIntentSourceV1 {
        predecessor_intent_identity: predecessor.intent_identity,
        predecessor_intent_digest: predecessor.intent_digest,
        source_frontier: predecessor.source_frontier,
        decision_identity: decision.decision_identity().to_string(),
        decision_digest: decision.decision_digest().to_string(),
        decision_receipt_identity: readback.receipt().receipt_identity().to_string(),
        result_identity: evidence.result_identity.clone(),
        trial_family_identity: evidence.trial_family_identity.clone(),
        trial_family_policy_digest: predecessor.trial_family_policy_digest,
        census_frontier_identity: evidence.census_frontier_identity.clone(),
        census_frontier_digest: evidence.census_frontier_digest.clone(),
        independence_basis_identity: predecessor.independence_basis_identity,
        independence_basis_digest: predecessor.independence_basis_digest,
        protected_feedback_projection_identity: predecessor.protected_feedback_projection_identity,
        protected_feedback_projection_digest: predecessor.protected_feedback_projection_digest,
        experiment_identity: experiment_identity.clone(),
        experiment_digest: experiment_digest.clone(),
        experiment: chosen.experiment.clone(),
    })
}

async fn load_predecessor_context(
    transaction: &mut Transaction<'_, Postgres>,
    census: &TrialFamilyCensusReadbackV2,
    intent_identity: &str,
    intent_digest: &str,
) -> Result<PredecessorContextV1, SuccessorResearchIntentPostgresErrorV1> {
    if intent_identity == census.legacy_family.initial_intent_member().fact_identity() {
        let custody = admit_research_custody_in_transaction(
            transaction,
            ResearchCustodyLookupV1::Intent(intent_identity),
        )
        .await?
        .ok_or_else(|| storage("predecessor Research Intent custody is missing"))?;
        let FrozenResearchGoalIntent::V2(intent) = custody
            .intent()
            .ok_or_else(|| storage("predecessor Research Intent is missing"))?
        else {
            return Err(storage("predecessor Research Intent V2 is required"));
        };
        if intent.semantic_digest != intent_digest {
            return Err(storage("predecessor Research Intent digest mismatch"));
        }
        return Ok(PredecessorContextV1 {
            intent_identity: intent.intent_identity.clone(),
            intent_digest: intent.semantic_digest.clone(),
            source_frontier: intent.source_frontier.clone(),
            trial_family_identity: intent.trial_family_identity.clone(),
            trial_family_policy_digest: intent.trial_family_policy_digest.clone(),
            independence_basis_identity: intent.independence_basis_identity.clone(),
            independence_basis_digest: intent.independence_basis_digest.clone(),
            protected_feedback_projection_identity: intent
                .protected_feedback_projection_identity
                .clone(),
            protected_feedback_projection_digest: intent
                .protected_feedback_projection_digest
                .clone(),
        });
    }
    let successor = load_by_intent_in_transaction(transaction, intent_identity)
        .await?
        .ok_or_else(|| storage("predecessor successor Intent custody is missing"))?;
    let intent = successor.intent();
    if intent.intent_digest() != intent_digest {
        return Err(storage("predecessor successor Intent digest mismatch"));
    }
    Ok(PredecessorContextV1 {
        intent_identity: intent.intent_identity().to_string(),
        intent_digest: intent.intent_digest().to_string(),
        source_frontier: intent.goal().sources.clone(),
        trial_family_identity: intent.trial_family_identity().to_string(),
        trial_family_policy_digest: intent.trial_family_policy_digest().to_string(),
        independence_basis_identity: intent.independence_basis_identity().to_string(),
        independence_basis_digest: intent.independence_basis_digest().to_string(),
        protected_feedback_projection_identity: intent
            .protected_feedback_projection_identity()
            .to_string(),
        protected_feedback_projection_digest: intent
            .protected_feedback_projection_digest()
            .to_string(),
    })
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    request: &SuccessorResearchIntentCompositionRequestV1,
    readback: &SuccessorResearchIntentReadbackV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    let request_bytes = serde_json::to_vec(request).map_err(storage)?;
    let intent_bytes = serde_json::to_vec(readback.intent()).map_err(storage)?;
    let receipt_bytes = serde_json::to_vec(readback.receipt()).map_err(storage)?;
    let request_json =
        serde_json::from_slice::<serde_json::Value>(&request_bytes).map_err(storage)?;
    let intent_json =
        serde_json::from_slice::<serde_json::Value>(&intent_bytes).map_err(storage)?;
    let receipt_json =
        serde_json::from_slice::<serde_json::Value>(&receipt_bytes).map_err(storage)?;
    let intent = readback.intent();
    let receipt = readback.receipt();
    sqlx::query("INSERT INTO rd_successor_research_intents_v1 (intent_identity,intent_digest,request_identity,decision_identity,result_identity,trial_family_identity,predecessor_intent_identity,request_json,intent_json,receipt_json,request_storage_bytes,request_storage_digest,intent_storage_bytes,intent_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)")
        .bind(intent.intent_identity())
        .bind(intent.intent_digest())
        .bind(request.request_identity.as_str())
        .bind(intent.decision_identity())
        .bind(intent.result_identity())
        .bind(intent.trial_family_identity())
        .bind(intent.predecessor_intent_identity())
        .bind(request_json)
        .bind(intent_json)
        .bind(receipt_json)
        .bind(&request_bytes)
        .bind(storage_digest("rd.successor-research-intent-request.storage.v1", &request_bytes))
        .bind(&intent_bytes)
        .bind(storage_digest("rd.successor-research-intent.storage.v1", &intent_bytes))
        .bind(&receipt_bytes)
        .bind(storage_digest("rd.successor-research-intent-receipt.storage.v1", &receipt_bytes))
        .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    persist_outbox(transaction, readback).await
}

async fn load_by_decision_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
    composition: Option<&SuccessorResearchIntentCompositionRequestV1>,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT intent_identity,intent_digest,request_identity,decision_identity,result_identity,trial_family_identity,predecessor_intent_identity,request_json,intent_json,receipt_json,request_storage_bytes,request_storage_digest,intent_storage_bytes,intent_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_successor_research_intents_v1 WHERE decision_identity=$1 FOR SHARE")
        .bind(decision_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    admit_rows(transaction, rows, composition).await
}

async fn load_by_intent_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT intent_identity,intent_digest,request_identity,decision_identity,result_identity,trial_family_identity,predecessor_intent_identity,request_json,intent_json,receipt_json,request_storage_bytes,request_storage_digest,intent_storage_bytes,intent_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_successor_research_intents_v1 WHERE intent_identity=$1 FOR SHARE")
        .bind(intent_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    admit_rows(transaction, rows, None).await
}

async fn admit_rows(
    transaction: &mut Transaction<'_, Postgres>,
    rows: Vec<sqlx::postgres::PgRow>,
    composition: Option<&SuccessorResearchIntentCompositionRequestV1>,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    if rows.is_empty() {
        return Ok(None);
    }
    if rows.len() != 1 {
        return Err(storage("successor Intent identity is not unique"));
    }
    let row = &rows[0];
    let request_bytes: Vec<u8> = row.try_get("request_storage_bytes").map_err(storage)?;
    let intent_bytes: Vec<u8> = row.try_get("intent_storage_bytes").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(storage)?;
    if row
        .try_get::<String, _>("request_storage_digest")
        .map_err(storage)?
        != storage_digest(
            "rd.successor-research-intent-request.storage.v1",
            &request_bytes,
        )
        || row
            .try_get::<String, _>("intent_storage_digest")
            .map_err(storage)?
            != storage_digest("rd.successor-research-intent.storage.v1", &intent_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(storage)?
            != storage_digest(
                "rd.successor-research-intent-receipt.storage.v1",
                &receipt_bytes,
            )
    {
        return Err(storage("successor Intent storage digest mismatch"));
    }
    let stored_request: SuccessorResearchIntentCompositionRequestV1 =
        serde_json::from_slice(&request_bytes).map_err(storage)?;
    if composition.is_some_and(|request| request != &stored_request) {
        return Err(storage("successor Intent composition retry mismatch"));
    }
    let readback =
        admit_stored_successor_research_intent_v1(&request_bytes, &intent_bytes, &receipt_bytes)?;
    let intent = readback.intent();
    let receipt = readback.receipt();
    if row
        .try_get::<serde_json::Value, _>("request_json")
        .map_err(storage)?
        != serde_json::to_value(&stored_request).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("intent_json")
            .map_err(storage)?
            != serde_json::to_value(intent).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != serde_json::to_value(receipt).map_err(storage)?
        || row
            .try_get::<String, _>("intent_identity")
            .map_err(storage)?
            != intent.intent_identity()
        || row.try_get::<String, _>("intent_digest").map_err(storage)? != intent.intent_digest()
        || row
            .try_get::<String, _>("request_identity")
            .map_err(storage)?
            != intent.request_identity()
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(storage)?
            != intent.decision_identity()
        || row
            .try_get::<String, _>("result_identity")
            .map_err(storage)?
            != intent.result_identity()
        || row
            .try_get::<String, _>("trial_family_identity")
            .map_err(storage)?
            != intent.trial_family_identity()
        || row
            .try_get::<String, _>("predecessor_intent_identity")
            .map_err(storage)?
            != intent.predecessor_intent_identity()
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("successor Intent row/readback mismatch"));
    }
    verify_outbox(transaction, &readback).await?;
    Ok(Some(readback))
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SuccessorIntentCommittedOutboxV1 {
    schema_version: u16,
    intent_identity: String,
    intent_digest: String,
    receipt_identity: String,
    request_identity: String,
    predecessor_intent_identity: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    trial_family_identity: String,
    census_frontier_identity: String,
    experiment_identity: String,
    experiment_digest: String,
}

fn outbox_payload(
    readback: &SuccessorResearchIntentReadbackV1,
) -> SuccessorIntentCommittedOutboxV1 {
    let intent = readback.intent();
    SuccessorIntentCommittedOutboxV1 {
        schema_version: 1,
        intent_identity: intent.intent_identity().to_string(),
        intent_digest: intent.intent_digest().to_string(),
        receipt_identity: readback.receipt().receipt_identity().to_string(),
        request_identity: intent.request_identity().to_string(),
        predecessor_intent_identity: intent.predecessor_intent_identity().to_string(),
        decision_identity: intent.decision_identity().to_string(),
        decision_digest: intent.decision_digest().to_string(),
        result_identity: intent.result_identity().to_string(),
        trial_family_identity: intent.trial_family_identity().to_string(),
        census_frontier_identity: intent.census_frontier_identity().to_string(),
        experiment_identity: intent.experiment_identity().to_string(),
        experiment_digest: intent.experiment_digest().to_string(),
    }
}

async fn persist_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &SuccessorResearchIntentReadbackV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    let payload = outbox_payload(readback);
    let payload_json = serde_json::to_value(&payload).map_err(storage)?;
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let payload_digest = storage_digest(
        "rd.owner-outbox.successor-research-intent.v1",
        &payload_bytes,
    );
    let event_identity = format!(
        "rd-owner-outbox-successor-research-intent-v1-{}",
        payload_digest.trim_start_matches("sha256:")
    );
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity)
        .bind(readback.intent().intent_identity())
        .bind(SUCCESSOR_INTENT_COMMITTED_EVENT_V1)
        .bind(payload_digest)
        .bind(payload_json)
        .bind(i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &SuccessorResearchIntentReadbackV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(readback.intent().intent_identity())
        .bind(SUCCESSOR_INTENT_COMMITTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(storage("successor Intent outbox custody is incomplete"));
    }
    let payload = outbox_payload(readback);
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let row = &rows[0];
    if row
        .try_get::<String, _>("aggregate_identity")
        .map_err(storage)?
        != readback.intent().intent_identity()
        || row.try_get::<String, _>("event_kind").map_err(storage)?
            != SUCCESSOR_INTENT_COMMITTED_EVENT_V1
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != storage_digest(
                "rd.owner-outbox.successor-research-intent.v1",
                &payload_bytes,
            )
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != serde_json::to_value(payload).map_err(storage)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("successor Intent outbox/readback mismatch"));
    }
    Ok(())
}

async fn load_decision_family_identity(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
    result_identity: &str,
) -> Result<String, SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT trial_family_identity FROM rd_iteration_decisions_v1 WHERE decision_identity=$1 AND result_identity=$2 FOR SHARE")
        .bind(decision_identity)
        .bind(result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(storage("successor Decision custody is incomplete"));
    }
    rows[0].try_get("trial_family_identity").map_err(storage)
}

async fn lock_composition_key(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(decision_identity)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

fn validate_composition_request(
    request: &SuccessorResearchIntentCompositionRequestV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    if is_valid_iteration_decision_locator_v1(&request.request_identity)
        && is_valid_iteration_decision_locator_v1(&request.decision_identity)
        && is_valid_iteration_decision_locator_v1(&request.result_identity)
    {
        Ok(())
    } else {
        Err(SuccessorResearchIntentPostgresErrorV1::InvalidLocator)
    }
}

fn valid_identity(value: &str) -> bool {
    is_valid_iteration_decision_locator_v1(value)
}

fn current_epoch_ms() -> Result<u64, SuccessorResearchIntentPostgresErrorV1> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(storage)?
        .as_millis()
        .try_into()
        .map_err(storage)?)
}

fn storage_digest(domain: &str, bytes: &[u8]) -> String {
    crate::native_replay_rd_sources_v2::owner_storage_digest(domain, bytes)
}

fn storage(error: impl std::fmt::Display) -> SuccessorResearchIntentPostgresErrorV1 {
    SuccessorResearchIntentPostgresErrorV1::Storage(error.to_string())
}

#[allow(dead_code)]
fn _assert_serialize_only(_: &FrozenSuccessorResearchIntentV1) {}
