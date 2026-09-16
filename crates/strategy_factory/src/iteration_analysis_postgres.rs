//! PostgreSQL custody for server-side R&D iteration-analysis work requests.

use std::{collections::BTreeMap, fmt::Display};

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_backtest_owner_contracts::outcome_evidence::BacktestOutcomeEvidenceDtoV1;
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeError, resolve_admission_for_downstream_in_transaction,
    resolve_historical_admission_snapshot_for_downstream_in_transaction,
};

use crate::trial_family_postgres::{
    PostgresReadLockMode, load_candidate_experiments_for_census_in_transaction,
    load_candidate_experiments_for_census_snapshot_in_transaction,
};
use crate::{
    artifact_build::{ArtifactBuildDisposition, ArtifactBuildError, canonical_intent_bytes},
    exploratory_replay::postgres::decode_v2_read_result,
    iteration_analysis::{
        ITERATION_ANALYSIS_COMPLETED_EVENT_V1, ITERATION_ANALYSIS_REQUESTED_EVENT_V1,
        IterationAnalysisArtifactBindingV1, IterationAnalysisBacktestProjectionV1,
        IterationAnalysisCandidateFrontierMemberV1, IterationAnalysisCandidateFrontierV1,
        IterationAnalysisCompletionProposalV1, IterationAnalysisCompletionReadbackV1,
        IterationAnalysisCompletionResolutionLocatorV1, IterationAnalysisInputV1,
        IterationAnalysisIntentBindingV1, IterationAnalysisOwnerCustodyDigestsV1,
        IterationAnalysisReplayBindingV1, IterationAnalysisRequestErrorV1,
        IterationAnalysisRequestLocatorV1, IterationAnalysisRequestReadbackV1,
        IterationAnalysisResolutionLocatorV1, IterationAnalysisResultReadbackV1,
        bind_candidate_experiments_to_owner_frontier_v1, canonical_digest,
        ensure_same_completion_proposal_v1, identity, issue_iteration_analysis_request_v1,
        issue_iteration_analysis_result_v1, owner_storage_digest, validate_completion_proposal,
        validate_locator, verify_iteration_analysis_completion_admission_v1,
    },
    iteration_decision::{
        IterationDecisionGateV1, complete_interpretation_context_v1,
        gate_locked_exploratory_result_v1, issue_interpretation_context_for_intent_v1,
    },
    iteration_decision_postgres::{
        CandidateComparisonCompositionRequestV1, IterationDecisionPostgresErrorV1,
        compose_candidate_comparison_decision_in_transaction_v1,
        load_candidate_comparison_by_result_in_transaction,
        load_candidate_comparison_by_result_snapshot_in_transaction,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
    rd_owner_postgres_custody::{
        ExploratoryReplayResultLocatorV2, resolve_exploratory_replay_outcome_for_rd_in_transaction,
    },
    trial_family_postgres::{
        load_trial_family_census_v2_by_family_in_transaction,
        load_trial_family_census_v2_by_family_snapshot_in_transaction,
    },
};
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_backtest_result_custody::BacktestResultCustodyErrorV2;

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_iteration_analysis_requests_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("analysis_request_identity", "text"),
            crate::schema_materialization::required("analysis_request_digest", "text"),
            crate::schema_materialization::required("trial_family_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("attempt_identity", "text"),
            crate::schema_materialization::required("intent_identity", "text"),
            crate::schema_materialization::required("artifact_identity", "text"),
            crate::schema_materialization::required("request_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("request_storage_bytes", "bytea"),
            crate::schema_materialization::required("request_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "p:analysis_request_identity:::false:false:true:",
            "u:analysis_request_digest:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("analysis_request_identity"),
            crate::schema_materialization::unique_index("analysis_request_digest"),
            crate::schema_materialization::unique_index("result_identity"),
        ],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_iteration_analysis_results_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("analysis_result_identity", "text"),
            crate::schema_materialization::required("analysis_result_digest", "text"),
            crate::schema_materialization::required("analysis_request_identity", "text"),
            crate::schema_materialization::required("analysis_request_digest", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("decision_digest", "text"),
            crate::schema_materialization::required("result_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("result_storage_bytes", "bytea"),
            crate::schema_materialization::required("result_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "p:analysis_result_identity:::false:false:true:",
            "u:analysis_result_digest:::false:false:true:",
            "u:analysis_request_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("analysis_result_identity"),
            crate::schema_materialization::unique_index("analysis_result_digest"),
            crate::schema_materialization::unique_index("analysis_request_identity"),
            crate::schema_materialization::unique_index("result_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
        ],
    },
];

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AnalysisRequestedPayloadV1 {
    schema_version: u16,
    analysis_request_identity: String,
    analysis_request_digest: String,
    receipt_identity: String,
    receipt_digest: String,
    trial_family_identity: String,
    result_identity: String,
    request_identity: String,
    attempt_identity: String,
    intent_identity: String,
    artifact_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AnalysisRequestedEnvelopeV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload: AnalysisRequestedPayloadV1,
    committed_at_epoch_ms: u64,
}

struct LockedReplayRowV1 {
    build_request_identity: String,
    attempt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    artifact_identity: String,
    build_receipt_identity: String,
    artifact_family_binding_identity: String,
    census_frontier_identity: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedCandidateFrontierV1 {
    schema_version: u32,
    frontier_identity: String,
    trial_family_identity: String,
    attempt_ordinal: u32,
    generation_rule_identity: String,
    generation_rule_digest: String,
    expected_cardinality: u32,
    candidates: Vec<LockedCandidateV1>,
    frontier_digest: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedCandidateV1 {
    candidate_identity: String,
    candidate_digest: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredIterationAnalysisRequestV1 {
    schema_version: u16,
    analysis_request_identity: String,
    analysis_request_digest: String,
    locator: IterationAnalysisRequestLocatorV1,
    input: IterationAnalysisInputV1,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredIterationAnalysisReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    analysis_request_identity: String,
    analysis_request_digest: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredIterationAnalysisResultV1 {
    schema_version: u16,
    analysis_result_identity: String,
    analysis_result_digest: String,
    proposal: IterationAnalysisCompletionProposalV1,
    decision_identity: String,
    decision_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredIterationAnalysisResultReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    analysis_result_identity: String,
    analysis_result_digest: String,
    analysis_request_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AnalysisCompletedPayloadV1 {
    schema_version: u16,
    analysis_result_identity: String,
    analysis_result_digest: String,
    analysis_request_identity: String,
    analysis_request_digest: String,
    result_identity: String,
    decision_identity: String,
    decision_digest: String,
    receipt_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AnalysisCompletedEnvelopeV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload: AnalysisCompletedPayloadV1,
    committed_at_epoch_ms: u64,
}

fn canonical_string_map(
    value: &serde_json::Value,
    context: &str,
) -> Result<BTreeMap<String, String>, IterationAnalysisRequestErrorV1> {
    value
        .as_object()
        .ok_or_else(|| unavailable(format!("canonical Backtest {context} is not an object")))?
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_string()))
                .ok_or_else(|| {
                    unavailable(format!(
                        "canonical Backtest {context} metric is not an exact string"
                    ))
                })
        })
        .collect()
}

fn canonical_pnl_map(
    value: &serde_json::Value,
) -> Result<BTreeMap<String, BTreeMap<String, String>>, IterationAnalysisRequestErrorV1> {
    value
        .as_object()
        .ok_or_else(|| unavailable("canonical Backtest PnL statistics are not an object"))?
        .iter()
        .map(|(currency, metrics)| {
            canonical_string_map(metrics, "PnL statistics")
                .map(|metrics| (currency.clone(), metrics))
        })
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
struct CanonicalEngineProjectionV1 {
    actual_backtest_start_ns: Option<String>,
    actual_backtest_end_ns: Option<String>,
    outcome: String,
    orders_count: u64,
    positions_count: u64,
    fills_count: u64,
    general_statistics: BTreeMap<String, String>,
    pnl_statistics: BTreeMap<String, BTreeMap<String, String>>,
    return_statistics: BTreeMap<String, String>,
}

fn project_canonical_engine_result_v1(
    engine_result_bytes: &[u8],
) -> Result<CanonicalEngineProjectionV1, IterationAnalysisRequestErrorV1> {
    let canonical = CanonicalBacktestResult::from_slice(engine_result_bytes)
        .map_err(|e| unavailable(format!("canonical Backtest result is invalid: {e}")))?;
    let document = canonical.as_value();
    let run = document
        .get("run")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| unavailable("canonical Backtest run projection is missing"))?;
    let statistics = document
        .get("statistics")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| unavailable("canonical Backtest statistics projection is missing"))?;
    let optional_string = |key: &str| {
        run.get(key)
            .ok_or_else(|| unavailable(format!("canonical Backtest run field {key} is missing")))
            .and_then(|value| {
                if value.is_null() {
                    Ok(None)
                } else {
                    value
                        .as_str()
                        .map(|value| Some(value.to_string()))
                        .ok_or_else(|| {
                            unavailable(format!(
                                "canonical Backtest run field {key} is not an exact string"
                            ))
                        })
                }
            })
    };
    let array_len = |key: &str| {
        document
            .get(key)
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| unavailable(format!("canonical Backtest {key} are missing")))
            .and_then(|values| u64::try_from(values.len()).map_err(storage))
    };

    Ok(CanonicalEngineProjectionV1 {
        actual_backtest_start_ns: optional_string("backtest_start_ns")?,
        actual_backtest_end_ns: optional_string("backtest_end_ns")?,
        outcome: run
            .get("outcome")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| unavailable("canonical Backtest outcome is missing"))?
            .to_string(),
        orders_count: array_len("orders")?,
        positions_count: array_len("positions")?,
        fills_count: array_len("fills")?,
        general_statistics: canonical_string_map(
            statistics
                .get("general")
                .ok_or_else(|| unavailable("canonical Backtest general statistics are missing"))?,
            "general statistics",
        )?,
        pnl_statistics: canonical_pnl_map(
            statistics
                .get("pnls")
                .ok_or_else(|| unavailable("canonical Backtest PnL statistics are missing"))?,
        )?,
        return_statistics: canonical_string_map(
            statistics
                .get("returns")
                .ok_or_else(|| unavailable("canonical Backtest return statistics are missing"))?,
            "return statistics",
        )?,
    })
}

fn validate_locked_engine_result_binding_v1(
    schema_identity: &str,
    canonical_bytes_digest: &str,
    canonical_bytes_length: u64,
    engine_result_bytes: &[u8],
) -> Result<String, IterationAnalysisRequestErrorV1> {
    let engine_len = u64::try_from(engine_result_bytes.len()).map_err(storage)?;
    let binding_digest = owner_storage_digest(
        "vibe.backtest.canonical-result-bytes.v1",
        engine_result_bytes,
    );

    if schema_identity != "vibe-backtest-result/v1"
        || canonical_bytes_length != engine_len
        || canonical_bytes_digest != binding_digest
    {
        return Err(unavailable(
            "canonical Backtest result binding does not match locked engine bytes",
        ));
    }
    Ok(binding_digest)
}

fn derive_locked_backtest_projection_v1(
    locator: &IterationAnalysisRequestLocatorV1,
    replay_request: &vibe_backtest_owner_contracts::ReplayRequestDtoV2,
    result: &vibe_backtest_owner_contracts::ReplayResultDtoV2,
    outcome: &BacktestOutcomeEvidenceDtoV1,
    engine_result_bytes: &[u8],
    engine_result_storage_digest: &str,
) -> Result<IterationAnalysisBacktestProjectionV1, IterationAnalysisRequestErrorV1> {
    if replay_request.request_identity.as_str() != locator.request_identity
        || result.result_identity.as_str() != locator.result_identity
        || result.request_identity.as_str() != locator.request_identity
        || result.attempt_identity.as_str() != locator.attempt_identity
        || outcome.result_identity != result.result_identity
        || outcome.result_digest != result.result_digest
        || outcome.request_identity != result.request_identity
        || outcome.request_meaning_digest != result.request_meaning_digest
        || outcome.attempt_identity != result.attempt_identity
    {
        return Err(unavailable(
            "canonical Backtest projection authority is cross-spliced",
        ));
    }
    let binding_digest = validate_locked_engine_result_binding_v1(
        outcome.canonical_result.schema_identity.as_str(),
        outcome.canonical_result.canonical_bytes_digest.as_str(),
        outcome.canonical_result.canonical_bytes_length,
        engine_result_bytes,
    )?;
    let projection = project_canonical_engine_result_v1(engine_result_bytes)?;

    Ok(IterationAnalysisBacktestProjectionV1::new(
        locator.result_identity.clone(),
        locator.request_identity.clone(),
        locator.attempt_identity.clone(),
        replay_request.pit_scope.clone(),
        replay_request.pit_snapshot.clone(),
        replay_request.universe_selection.clone(),
        replay_request.window.clone(),
        projection.actual_backtest_start_ns,
        projection.actual_backtest_end_ns,
        projection.outcome,
        projection.orders_count,
        projection.positions_count,
        projection.fills_count,
        projection.general_statistics,
        projection.pnl_statistics,
        projection.return_statistics,
        binding_digest,
        engine_result_storage_digest.to_string(),
    ))
}

struct LockedAnalysisBundleV1 {
    input: IterationAnalysisInputV1,
    census: crate::trial_family::TrialFamilyCensusReadbackV2,
    interpretation: crate::iteration_decision::IterationInterpretationContextV1,
}

#[derive(Deserialize)]
struct LockedCurrentCensusMemberV1 {
    member_digest: String,
}

pub async fn materialize_schema(database_url: &str) -> Result<(), IterationAnalysisRequestErrorV1> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .map_err(storage)?;
    crate::schema_materialization::materialize_public_table(
        &pool,
        "rd_iteration_analysis_requests_v1",
        "CREATE TABLE IF NOT EXISTS public.rd_iteration_analysis_requests_v1 (analysis_request_identity TEXT PRIMARY KEY, analysis_request_digest TEXT NOT NULL UNIQUE, trial_family_identity TEXT NOT NULL, result_identity TEXT NOT NULL UNIQUE, request_identity TEXT NOT NULL, attempt_identity TEXT NOT NULL, intent_identity TEXT NOT NULL, artifact_identity TEXT NOT NULL, request_json JSONB NOT NULL, receipt_json JSONB NOT NULL, request_storage_bytes BYTEA NOT NULL, request_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(|e| storage(e.to_string()))?;
    crate::schema_materialization::materialize_public_table(
        &pool,
        "rd_iteration_analysis_results_v1",
        "CREATE TABLE IF NOT EXISTS public.rd_iteration_analysis_results_v1 (analysis_result_identity TEXT PRIMARY KEY, analysis_result_digest TEXT NOT NULL UNIQUE, analysis_request_identity TEXT NOT NULL UNIQUE, analysis_request_digest TEXT NOT NULL, result_identity TEXT NOT NULL UNIQUE, decision_identity TEXT NOT NULL UNIQUE, decision_digest TEXT NOT NULL, result_json JSONB NOT NULL, receipt_json JSONB NOT NULL, result_storage_bytes BYTEA NOT NULL, result_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(|e| storage(e.to_string()))?;

    for statement in [
        "ALTER TABLE public.rd_iteration_analysis_requests_v1 OWNER TO rd_owner",
        "REVOKE ALL ON TABLE public.rd_iteration_analysis_requests_v1 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
        "ALTER TABLE public.rd_iteration_analysis_results_v1 OWNER TO rd_owner",
        "REVOKE ALL ON TABLE public.rd_iteration_analysis_results_v1 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    ] {
        sqlx::query(statement)
            .execute(&pool)
            .await
            .map_err(storage)?;
    }
    Ok(())
}

pub async fn compose_iteration_analysis_request_v1(
    owner: &PostgresResearchGoalOwnerV1,
    locator: IterationAnalysisRequestLocatorV1,
) -> Result<IterationAnalysisRequestReadbackV1, IterationAnalysisRequestErrorV1> {
    validate_locator(&locator)?;
    let pool = owner.native_replay_pool_v2();
    require_schema(pool).await?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    lock_composition_key(&mut transaction, &locator.result_identity).await?;

    if let Some(existing) =
        load_by_result_in_transaction(&mut transaction, &locator, PostgresReadLockMode::ForShare)
            .await?
    {
        let census = load_historical_census_for_request_in_transaction(
            &mut transaction,
            &existing,
            PostgresReadLockMode::ForShare,
        )
        .await?;
        let experiments =
            load_candidate_experiments_for_census_in_transaction(&mut transaction, &census)
                .await
                .map_err(map_trial_family_error)?;
        verify_request_candidate_experiment_custody(&existing, &experiments)?;
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }
    ensure_no_partial_outbox(&mut transaction, &locator.result_identity).await?;
    let input = Box::pin(compose_locked_input(&mut transaction, &locator))
        .await?
        .input;
    let committed_at_epoch_ms = current_epoch_ms(&mut transaction).await?;
    let issued =
        issue_iteration_analysis_request_v1(locator.clone(), input, committed_at_epoch_ms)?;
    persist(&mut transaction, &issued).await?;
    let readback =
        load_by_result_in_transaction(&mut transaction, &locator, PostgresReadLockMode::ForShare)
            .await?
            .ok_or_else(|| storage("committed iteration analysis request is missing"))?;
    if readback != issued {
        return Err(storage("committed iteration analysis request changed"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

pub async fn resolve_iteration_analysis_request_v1(
    owner: &PostgresResearchGoalOwnerV1,
    locator: IterationAnalysisResolutionLocatorV1,
) -> Result<Option<IterationAnalysisRequestReadbackV1>, IterationAnalysisRequestErrorV1> {
    let request_locator = IterationAnalysisRequestLocatorV1 {
        trial_family_identity: locator.trial_family_identity,
        result_identity: locator.result_identity,
        request_identity: locator.request_identity,
        attempt_identity: locator.attempt_identity,
    };
    validate_locator(&request_locator)?;
    let pool = owner.native_replay_pool_v2();
    require_schema(pool).await?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    let readback = load_by_result_in_transaction(
        &mut transaction,
        &request_locator,
        PostgresReadLockMode::Snapshot,
    )
    .await?;

    if let Some(request) = &readback {
        let census = load_historical_census_for_request_in_transaction(
            &mut transaction,
            request,
            PostgresReadLockMode::Snapshot,
        )
        .await?;
        let experiments = load_candidate_experiments_for_census_snapshot_in_transaction(
            &mut transaction,
            &census,
        )
        .await
        .map_err(map_trial_family_error)?;
        verify_request_candidate_experiment_custody(request, &experiments)?;
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

pub async fn compose_iteration_analysis_completion_v1(
    owner: &PostgresResearchGoalOwnerV1,
    proposal: IterationAnalysisCompletionProposalV1,
) -> Result<IterationAnalysisCompletionReadbackV1, IterationAnalysisRequestErrorV1> {
    validate_completion_proposal(&proposal)?;
    let pool = owner.native_replay_pool_v2();
    require_schema(pool).await?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    lock_composition_key(&mut transaction, &proposal.result_identity).await?;

    let request = load_request_for_completion_in_transaction(
        &mut transaction,
        &proposal,
        PostgresReadLockMode::ForShare,
    )
    .await?
    .ok_or_else(|| unavailable("iteration analysis request custody is missing"))?;
    let existing = load_analysis_result_in_transaction(
        &mut transaction,
        &proposal,
        None,
        PostgresReadLockMode::ForShare,
    )
    .await?;
    let admission_cut = current_epoch_ms(&mut transaction).await?;
    let admission = resolve_admission_for_downstream_in_transaction(
        &mut transaction,
        &proposal.admission,
        if existing.is_some() {
            DownstreamAdmissionModeV1::Historical
        } else {
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: admission_cut,
            }
        },
    )
    .await
    .map_err(map_product_edge_error)?;
    verify_iteration_analysis_completion_admission_v1(&admission, &proposal)?;

    if let Some(analysis) = existing {
        let completion = Box::pin(admit_committed_completion_in_transaction(
            &mut transaction,
            &request,
            &proposal,
            analysis,
            PostgresReadLockMode::ForShare,
        ))
        .await?;
        transaction.commit().await.map_err(storage)?;
        return Ok(completion);
    }

    if !admission.authorizes_first_mutation_at(admission_cut) {
        return Err(unavailable(
            "Product Edge iteration-analysis admission is not current",
        ));
    }

    let locator = request.request().locator().clone();
    let bundle = Box::pin(compose_locked_input(&mut transaction, &locator)).await?;
    if request.request().input() != &bundle.input {
        return Err(unavailable(
            "iteration analysis request input is stale or changed",
        ));
    }
    let candidate_evaluations = bind_candidate_experiments_to_owner_frontier_v1(
        &bundle.input.candidate_frontier,
        &proposal.candidate_evaluations,
    )?;
    let interpretation = complete_interpretation_context_v1(
        bundle.interpretation,
        &proposal.mechanism_validity,
        &proposal.economic_viability,
        &proposal.robustness,
        &proposal.information_value,
    )
    .map_err(|e| unavailable(e.to_string()))?;
    let decision_request = CandidateComparisonCompositionRequestV1 {
        trial_family_identity: locator.trial_family_identity,
        result_identity: locator.result_identity,
        request_identity: locator.request_identity,
        attempt_identity: locator.attempt_identity,
        candidate_evaluations: candidate_evaluations.clone(),
    };

    if load_candidate_comparison_by_result_in_transaction(
        &mut transaction,
        &bundle.census,
        &proposal.result_identity,
        Some(&decision_request),
    )
    .await
    .map_err(map_iteration_decision_error)?
    .is_some()
    {
        return Err(storage(
            "partial analysis completion Decision already exists",
        ));
    }
    let committed_at_epoch_ms = current_epoch_ms(&mut transaction).await?;
    if !admission.authorizes_first_mutation_at(committed_at_epoch_ms) {
        return Err(unavailable(
            "Product Edge iteration-analysis admission expired before mutation",
        ));
    }
    let issued_decision = compose_candidate_comparison_decision_in_transaction_v1(
        &mut transaction,
        &bundle.census,
        interpretation,
        candidate_evaluations,
        committed_at_epoch_ms,
    )
    .await
    .map_err(map_iteration_decision_error)?;
    let decision = load_candidate_comparison_by_result_in_transaction(
        &mut transaction,
        &bundle.census,
        &proposal.result_identity,
        Some(&decision_request),
    )
    .await
    .map_err(map_iteration_decision_error)?
    .ok_or_else(|| storage("newly stored analysis completion Decision is missing"))?;
    if decision != issued_decision {
        return Err(storage(
            "newly stored analysis completion Decision changed during readback",
        ));
    }
    let analysis = issue_iteration_analysis_result_v1(
        proposal.clone(),
        decision.decision().decision_identity(),
        decision.decision().decision_digest(),
        committed_at_epoch_ms,
    )?;
    persist_analysis_result(&mut transaction, &analysis).await?;
    let stored = load_analysis_result_in_transaction(
        &mut transaction,
        &proposal,
        Some(decision.decision().decision_identity()),
        PostgresReadLockMode::ForShare,
    )
    .await?
    .ok_or_else(|| storage("committed analysis result is missing"))?;
    verify_completion_pair(&stored, &decision)?;
    transaction.commit().await.map_err(storage)?;
    completion_readback(stored, decision)
}

pub async fn resolve_iteration_analysis_completion_v1(
    owner: &PostgresResearchGoalOwnerV1,
    locator: IterationAnalysisCompletionResolutionLocatorV1,
) -> Result<Option<IterationAnalysisCompletionReadbackV1>, IterationAnalysisRequestErrorV1> {
    if !is_valid_completion_resolution_locator(&locator) {
        return Err(IterationAnalysisRequestErrorV1::InvalidLocator);
    }
    let pool = owner.native_replay_pool_v2();
    require_schema(pool).await?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    let Some((analysis, proposal)) = load_analysis_result_by_locator_in_transaction(
        &mut transaction,
        &locator,
        PostgresReadLockMode::Snapshot,
    )
    .await?
    else {
        transaction.commit().await.map_err(storage)?;
        return Ok(None);
    };
    let admission = resolve_historical_admission_snapshot_for_downstream_in_transaction(
        &mut transaction,
        &proposal.admission,
    )
    .await
    .map_err(map_product_edge_error)?;
    verify_iteration_analysis_completion_admission_v1(&admission, &proposal)?;
    let request = load_request_for_completion_in_transaction(
        &mut transaction,
        &proposal,
        PostgresReadLockMode::Snapshot,
    )
    .await?
    .ok_or_else(|| storage("analysis completion request is missing"))?;
    let completion = Box::pin(admit_committed_completion_in_transaction(
        &mut transaction,
        &request,
        &proposal,
        analysis,
        PostgresReadLockMode::Snapshot,
    ))
    .await?;
    transaction.commit().await.map_err(storage)?;
    Ok(Some(completion))
}

async fn admit_committed_completion_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request: &IterationAnalysisRequestReadbackV1,
    proposal: &IterationAnalysisCompletionProposalV1,
    analysis: IterationAnalysisResultReadbackV1,
    lock_mode: PostgresReadLockMode,
) -> Result<IterationAnalysisCompletionReadbackV1, IterationAnalysisRequestErrorV1> {
    let census =
        load_historical_census_for_request_in_transaction(transaction, request, lock_mode).await?;
    let experiments = match lock_mode {
        PostgresReadLockMode::ForShare => {
            load_candidate_experiments_for_census_in_transaction(transaction, &census).await
        }
        PostgresReadLockMode::Snapshot => {
            load_candidate_experiments_for_census_snapshot_in_transaction(transaction, &census)
                .await
        }
    }
    .map_err(map_trial_family_error)?;
    verify_request_candidate_experiment_custody(request, &experiments)?;
    let candidate_evaluations = bind_candidate_experiments_to_owner_frontier_v1(
        &request.request().input().candidate_frontier,
        &proposal.candidate_evaluations,
    )?;
    let decision_request = CandidateComparisonCompositionRequestV1 {
        trial_family_identity: request.request().locator().trial_family_identity.clone(),
        result_identity: proposal.result_identity.clone(),
        request_identity: request.request().locator().request_identity.clone(),
        attempt_identity: request.request().locator().attempt_identity.clone(),
        candidate_evaluations,
    };
    let decision = match lock_mode {
        PostgresReadLockMode::ForShare => {
            load_candidate_comparison_by_result_in_transaction(
                transaction,
                &census,
                &proposal.result_identity,
                Some(&decision_request),
            )
            .await
        }
        PostgresReadLockMode::Snapshot => {
            load_candidate_comparison_by_result_snapshot_in_transaction(
                transaction,
                &census,
                &proposal.result_identity,
                Some(&decision_request),
            )
            .await
        }
    }
    .map_err(map_iteration_decision_error)?
    .ok_or_else(|| storage("analysis completion Decision is missing"))?;
    verify_completion_pair(&analysis, &decision)?;
    completion_readback(analysis, decision)
}

fn verify_request_candidate_experiment_custody(
    request: &IterationAnalysisRequestReadbackV1,
    experiments: &[crate::trial_family::TrialFamilyCandidateExperimentReadbackV1],
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let frontier = &request.request().input().candidate_frontier;
    if frontier.candidates.len() != experiments.len()
        || frontier.candidates.iter().any(|candidate| {
            !experiments.iter().any(|readback| {
                readback.experiment().experiment_identity() == candidate.experiment_identity
                    && readback.experiment().trial_family_identity()
                        == candidate.trial_family_identity
                    && readback.experiment().attempt_ordinal() == candidate.attempt_ordinal
                    && readback.experiment().candidate_set_frontier_identity()
                        == candidate.candidate_set_frontier_identity
                    && readback.experiment().candidate_set_frontier_digest()
                        == candidate.candidate_set_frontier_digest
                    && readback.experiment().candidate_identity() == candidate.candidate_identity
                    && readback.experiment().candidate_digest() == candidate.candidate_digest
                    && readback.experiment().committed_at_epoch_ms()
                        == candidate.committed_at_epoch_ms
                    && readback.receipt().receipt_identity() == candidate.receipt_identity
                    && readback.receipt().receipt_digest() == candidate.receipt_digest
                    && readback.receipt().experiment_identity() == candidate.experiment_identity
                    && readback.receipt().candidate_digest() == candidate.candidate_digest
                    && readback.receipt().committed_at_epoch_ms() == candidate.committed_at_epoch_ms
                    && readback.experiment().mode() == &candidate.experiment
                    && candidate.trial_family_identity
                        == request.request().locator().trial_family_identity
                    && candidate.attempt_ordinal == frontier.attempt_ordinal
                    && readback.experiment().candidate_set_frontier_identity()
                        == frontier.frontier_identity
                    && readback.experiment().candidate_set_frontier_digest()
                        == frontier.frontier_digest
            })
        })
    {
        return Err(unavailable(
            "sealed analysis candidate experiment custody changed",
        ));
    }
    Ok(())
}

fn completion_readback(
    analysis: IterationAnalysisResultReadbackV1,
    decision: crate::iteration_decision::CandidateComparisonDecisionReadbackV1,
) -> Result<IterationAnalysisCompletionReadbackV1, IterationAnalysisRequestErrorV1> {
    let action = crate::iteration_decision::project_candidate_comparison_action_v1(&decision)
        .map_err(unavailable)?;
    Ok(IterationAnalysisCompletionReadbackV1::new(
        analysis, decision, action,
    ))
}

async fn load_historical_census_for_request_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request: &IterationAnalysisRequestReadbackV1,
    lock_mode: PostgresReadLockMode,
) -> Result<crate::trial_family::TrialFamilyCensusReadbackV2, IterationAnalysisRequestErrorV1> {
    let locator = request.request().locator();
    let evidence = &request.request().input().evidence_cut;
    let current = match lock_mode {
        PostgresReadLockMode::ForShare => {
            load_trial_family_census_v2_by_family_in_transaction(
                transaction,
                &locator.trial_family_identity,
            )
            .await
        }
        PostgresReadLockMode::Snapshot => {
            load_trial_family_census_v2_by_family_snapshot_in_transaction(
                transaction,
                &locator.trial_family_identity,
            )
            .await
        }
    }
    .map_err(map_trial_family_error)?;
    let query = lock_mode.query(
        "SELECT attempt_ordinal,census_frontier_json,attempt_frontier_json,candidate_set_frontier_json FROM rd_trial_family_attempt_cuts_v2 WHERE trial_family_identity=$1 AND census_frontier_identity=$2",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
        .bind(&locator.trial_family_identity)
        .bind(&evidence.census_frontier_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let [row] = rows.as_slice() else {
        return Err(unavailable(
            "sealed analysis Census cut is missing or ambiguous",
        ));
    };
    let attempt_ordinal =
        usize::try_from(row.try_get::<i32, _>("attempt_ordinal").map_err(storage)?)
            .map_err(storage)?;
    let prefix_len = attempt_ordinal
        .checked_add(1)
        .and_then(|count| count.checked_mul(3))
        .ok_or_else(|| unavailable("sealed analysis Census cut is invalid"))?;
    if prefix_len > current.members.len() || prefix_len > current.membership_receipts.len() {
        return Err(unavailable(
            "sealed analysis Census cut is not an ancestor of the current head",
        ));
    }
    let census_frontier: crate::trial_family::TrialFamilyCensusFrontierV2 =
        serde_json::from_value(row.try_get("census_frontier_json").map_err(storage)?)
            .map_err(storage)?;
    let attempt_frontier: crate::trial_family::TrialFamilyAttemptFrontierV2 =
        serde_json::from_value(row.try_get("attempt_frontier_json").map_err(storage)?)
            .map_err(storage)?;
    let candidate_set_frontier: crate::trial_family::TrialFamilyCandidateSetFrontierV2 =
        serde_json::from_value(
            row.try_get("candidate_set_frontier_json")
                .map_err(storage)?,
        )
        .map_err(storage)?;
    let historical = crate::trial_family::TrialFamilyCensusReadbackV2 {
        legacy_family: current.legacy_family.clone(),
        members: current.members[..prefix_len].to_vec(),
        membership_receipts: current.membership_receipts[..prefix_len].to_vec(),
        attempt_frontier,
        candidate_set_frontier,
        census_frontier,
    };
    crate::trial_family::verify_census_v2(&historical).map_err(map_trial_family_error)?;
    if historical.census_frontier.frontier_identity() != evidence.census_frontier_identity
        || historical.census_frontier.frontier_digest() != evidence.census_frontier_digest
        || historical.attempt_frontier.frontier_identity() != evidence.attempt_frontier_identity
        || historical.attempt_frontier.frontier_digest() != evidence.attempt_frontier_digest
        || historical.candidate_set_frontier.frontier_identity()
            != evidence.candidate_set_frontier_identity
        || historical.candidate_set_frontier.frontier_digest()
            != evidence.candidate_set_frontier_digest
    {
        return Err(unavailable(
            "sealed analysis Census cut does not match its evidence cut",
        ));
    }
    Ok(historical)
}

async fn compose_locked_input(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &IterationAnalysisRequestLocatorV1,
) -> Result<LockedAnalysisBundleV1, IterationAnalysisRequestErrorV1> {
    let census = load_trial_family_census_v2_by_family_in_transaction(
        transaction,
        &locator.trial_family_identity,
    )
    .await
    .map_err(map_trial_family_error)?;
    let candidate_experiments =
        load_candidate_experiments_for_census_in_transaction(transaction, &census)
            .await
            .map_err(map_trial_family_error)?;
    let locked_outcome = resolve_exploratory_replay_outcome_for_rd_in_transaction(
        transaction,
        ExploratoryReplayResultLocatorV2 {
            result_identity: &locator.result_identity,
            request_identity: &locator.request_identity,
            attempt_identity: &locator.attempt_identity,
        },
    )
    .await
    .map_err(map_backtest_custody_error)?
    .ok_or_else(|| unavailable("terminal Backtest Result custody is missing"))?;
    let locked_result = locked_outcome.replay();
    let IterationDecisionGateV1::InterpretationRequired {
        evidence_cut,
        diagnostic,
        required_dimensions,
    } = gate_locked_exploratory_result_v1(&census, locked_result)
        .map_err(|e| unavailable(e.to_string()))?
    else {
        return Err(IterationAnalysisRequestErrorV1::NotApplicable);
    };

    let result = locked_result.result();
    let replay_value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.resolve_exploratory_replay_request_v2($1,$2)")
            .bind(&locator.request_identity)
            .bind(result.request_meaning_digest.as_str())
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let replay_result = decode_v2_read_result(
        &locator.request_identity,
        result.request_meaning_digest.as_str(),
        None,
        replay_value,
    )
    .map_err(|e| unavailable(e.to_string()))?;
    let replay = replay_result
        .readback()
        .ok_or_else(|| unavailable("sealed Replay V2 custody is missing"))?;
    let replay_request = replay.request().as_dto();

    let replay_row =
        load_replay_row(transaction, locator, result.request_meaning_digest.as_str()).await?;
    let attempt =
        crate::rd_owner_postgres_custody::admit_attempt_custody_for_request_in_transaction(
            transaction,
            &replay_row.build_request_identity,
            &replay_row.attempt_identity,
        )
        .await
        .map_err(map_artifact_build_error)?
        .ok_or_else(|| unavailable("Artifact Build custody is missing"))?;
    let latest_intent = census
        .latest_intent_binding()
        .map_err(map_trial_family_error)?;
    let latest_attempt = census
        .latest_attempt_binding()
        .map_err(map_trial_family_error)?;
    let actual_intent = &attempt.intent;
    let receipt = attempt
        .attempt
        .receipt
        .as_ref()
        .ok_or_else(|| unavailable("Artifact Build receipt is missing"))?;
    let artifact_family = attempt
        .artifact_family
        .as_ref()
        .ok_or_else(|| unavailable("Artifact TrialFamily binding is missing"))?;
    let artifact_review = attempt
        .artifact_review
        .as_ref()
        .ok_or_else(|| unavailable("Artifact review is missing"))?;
    let artifact_identity = receipt
        .artifact_identity
        .as_deref()
        .ok_or_else(|| unavailable("successful Artifact identity is missing"))?;
    let build_receipt_identity = receipt
        .build_receipt_identity
        .as_deref()
        .ok_or_else(|| unavailable("successful Build receipt identity is missing"))?;
    let binding = artifact_family.binding();
    let replay_family = artifact_family.trial_family();
    let replay_cut = replay_family.census_frontier();

    if receipt.disposition != ArtifactBuildDisposition::Success
        || actual_intent.intent_identity() != replay_row.intent_identity
        || actual_intent.intent_identity() != latest_intent.intent_identity
        || actual_intent.semantic_digest() != latest_intent.intent_digest
        || replay_request.frozen_research_intent.identity.as_str()
            != actual_intent.intent_identity()
        || replay_request.frozen_research_intent.digest.as_str() != actual_intent.semantic_digest()
        || replay_request.trial_family.identity.as_str() != replay_row.trial_family_identity
        || replay_request.trial_family.identity.as_str() != locator.trial_family_identity
        || replay_request.trial_family.digest.as_str() != replay_family.root().root_digest()
        || replay_request
            .trial_family_census_frontier
            .identity
            .as_str()
            != replay_row.census_frontier_identity
        || replay_row.census_frontier_identity != replay_cut.frontier_identity()
        || replay_request.trial_family_census_frontier.digest.as_str()
            != replay_cut.frontier_digest()
        || latest_attempt.request_identity != locator.request_identity
        || latest_attempt.request_digest != result.request_meaning_digest.as_str()
        || latest_attempt.result_identity != locator.result_identity
        || latest_attempt.result_digest != result.result_digest.as_str()
        || latest_attempt.terminal_disposition
            != crate::trial_family::TrialFamilyAttemptTerminalDispositionV2::TerminalResult
        || replay_request.artifact.identity.as_str() != replay_row.artifact_identity
        || replay_request.artifact.identity.as_str() != artifact_identity
        || artifact_review.build_receipt.build_receipt_identity != build_receipt_identity
        || build_receipt_identity != replay_row.build_receipt_identity
        || binding.binding_identity() != replay_row.artifact_family_binding_identity
        || binding.artifact_identity() != artifact_identity
        || binding.intent_identity() != actual_intent.intent_identity()
        || binding.trial_family_identity() != locator.trial_family_identity
    {
        return Err(unavailable(
            "Replay, current Intent, Artifact, and TrialFamily custody are cross-spliced",
        ));
    }
    verify_replay_cut_is_current_census_prefix(&census, replay_cut.member_digests())?;

    let intent_bytes = canonical_intent_bytes(actual_intent).map_err(map_artifact_build_error)?;
    let canonical_intent_json =
        String::from_utf8(intent_bytes.clone()).map_err(|e| unavailable(e.to_string()))?;
    let candidate: LockedCandidateFrontierV1 = serde_json::from_value(
        serde_json::to_value(&census.candidate_set_frontier).map_err(storage)?,
    )
    .map_err(storage)?;

    if candidate.schema_version != 2
        || candidate.trial_family_identity != locator.trial_family_identity
    {
        return Err(unavailable("candidate frontier custody is cross-spliced"));
    }
    let decision_policy = census
        .decision_policy_v1()
        .ok_or_else(|| unavailable("TrialFamily decision policy is missing"))?;
    let semantic_trace = locked_result
        .semantic_trace_canonical_bytes()
        .ok_or_else(|| unavailable("canonical semantic trace is missing"))?;
    let interpretation = issue_interpretation_context_for_intent_v1(
        &census,
        actual_intent.intent_identity(),
        actual_intent.semantic_digest(),
        &locked_outcome,
    )
    .map_err(|e| unavailable(e.to_string()))?;
    let engine_result_storage_digest = owner_storage_digest(
        "rd.iteration-analysis.engine-result.v1",
        locked_outcome.engine_canonical_result_bytes(),
    );
    let backtest_projection = derive_locked_backtest_projection_v1(
        locator,
        replay_request,
        result,
        locked_outcome.outcome_evidence(),
        locked_outcome.engine_canonical_result_bytes(),
        &engine_result_storage_digest,
    )?;
    let input = IterationAnalysisInputV1 {
        evidence_cut,
        diagnostic,
        required_dimensions,
        replay: IterationAnalysisReplayBindingV1 {
            request_identity: replay.request_identity().to_string(),
            meaning_digest: replay.meaning_digest().to_string(),
            receipt_identity: replay.receipt_identity().to_string(),
            seal_digest: replay.seal_digest().to_string(),
            request: replay_request.clone(),
        },
        intent: IterationAnalysisIntentBindingV1 {
            intent_identity: actual_intent.intent_identity().to_string(),
            intent_digest: actual_intent.semantic_digest().to_string(),
            canonical_intent_json,
        },
        artifact: IterationAnalysisArtifactBindingV1 {
            artifact_identity: artifact_identity.to_string(),
            artifact_digest: replay_request.artifact.digest.as_str().to_string(),
            build_request_identity: replay_row.build_request_identity,
            build_attempt_identity: replay_row.attempt_identity,
            build_receipt_identity: build_receipt_identity.to_string(),
            family_binding_identity: binding.binding_identity().to_string(),
            family_binding_digest: binding.binding_digest().to_string(),
        },
        candidate_frontier: IterationAnalysisCandidateFrontierV1 {
            frontier_identity: candidate.frontier_identity,
            frontier_digest: candidate.frontier_digest,
            attempt_ordinal: candidate.attempt_ordinal,
            generation_rule_identity: candidate.generation_rule_identity,
            generation_rule_digest: candidate.generation_rule_digest,
            expected_cardinality: candidate.expected_cardinality,
            candidates: candidate
                .candidates
                .into_iter()
                .map(|candidate| {
                    let experiment = candidate_experiments
                        .iter()
                        .find(|readback| {
                            readback.experiment().candidate_identity()
                                == candidate.candidate_identity
                                && readback.experiment().candidate_digest()
                                    == candidate.candidate_digest
                        })
                        .ok_or_else(|| unavailable("candidate experiment custody is missing"))?;
                    Ok(IterationAnalysisCandidateFrontierMemberV1 {
                        experiment_identity: experiment
                            .experiment()
                            .experiment_identity()
                            .to_string(),
                        trial_family_identity: experiment
                            .experiment()
                            .trial_family_identity()
                            .to_string(),
                        attempt_ordinal: experiment.experiment().attempt_ordinal(),
                        candidate_set_frontier_identity: experiment
                            .experiment()
                            .candidate_set_frontier_identity()
                            .to_string(),
                        candidate_set_frontier_digest: experiment
                            .experiment()
                            .candidate_set_frontier_digest()
                            .to_string(),
                        candidate_identity: candidate.candidate_identity,
                        candidate_digest: candidate.candidate_digest,
                        committed_at_epoch_ms: experiment.experiment().committed_at_epoch_ms(),
                        receipt_identity: experiment.receipt().receipt_identity().to_string(),
                        receipt_digest: experiment.receipt().receipt_digest().to_string(),
                        experiment: experiment.experiment().mode().clone(),
                    })
                })
                .collect::<Result<Vec<_>, IterationAnalysisRequestErrorV1>>()?,
        },
        decision_policy: serde_json::to_value(decision_policy).map_err(storage)?,
        result: result.clone(),
        outcome_evidence: locked_outcome.outcome_evidence().clone(),
        backtest_projection,
        custody_digests: IterationAnalysisOwnerCustodyDigestsV1 {
            replay_request: owner_storage_digest(
                "rd.iteration-analysis.replay-request.v1",
                replay.canonical_request_bytes(),
            ),
            replay_receipt: owner_storage_digest(
                "rd.iteration-analysis.replay-receipt.v1",
                replay.canonical_receipt_bytes(),
            ),
            replay_outbox: owner_storage_digest(
                "rd.iteration-analysis.replay-outbox.v1",
                replay.canonical_outbox_bytes(),
            ),
            backtest_result: owner_storage_digest(
                "rd.iteration-analysis.backtest-result.v1",
                locked_result.result_canonical_bytes(),
            ),
            backtest_receipt: owner_storage_digest(
                "rd.iteration-analysis.backtest-receipt.v1",
                locked_result.receipt_canonical_bytes(),
            ),
            backtest_outbox: owner_storage_digest(
                "rd.iteration-analysis.backtest-outbox.v1",
                locked_result.outbox_canonical_bytes(),
            ),
            semantic_trace: owner_storage_digest(
                "rd.iteration-analysis.semantic-trace.v1",
                semantic_trace,
            ),
            outcome_evidence: owner_storage_digest(
                "rd.iteration-analysis.outcome-evidence.v1",
                locked_outcome.outcome_evidence_canonical_bytes(),
            ),
            outcome_receipt: owner_storage_digest(
                "rd.iteration-analysis.outcome-receipt.v1",
                locked_outcome.outcome_evidence_receipt_canonical_bytes(),
            ),
            outcome_outbox: owner_storage_digest(
                "rd.iteration-analysis.outcome-outbox.v1",
                locked_outcome.outcome_evidence_outbox_canonical_bytes(),
            ),
            engine_result: engine_result_storage_digest,
            frozen_intent: owner_storage_digest(
                "rd.iteration-analysis.frozen-intent.v1",
                &intent_bytes,
            ),
        },
    };
    Ok(LockedAnalysisBundleV1 {
        input,
        census,
        interpretation,
    })
}

async fn load_replay_row(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &IterationAnalysisRequestLocatorV1,
    meaning_digest: &str,
) -> Result<LockedReplayRowV1, IterationAnalysisRequestErrorV1> {
    let rows = sqlx::query(
        "SELECT build_request_identity,attempt_identity,intent_identity,trial_family_identity,artifact_identity,build_receipt_identity,artifact_family_binding_identity,census_frontier_identity FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1 AND v2_meaning_digest=$2 AND request_schema_version=2 FOR SHARE",
    )
    .bind(&locator.request_identity)
    .bind(meaning_digest)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let [row] = rows.as_slice() else {
        return Err(unavailable("sealed Replay row is missing or ambiguous"));
    };
    Ok(LockedReplayRowV1 {
        build_request_identity: row.try_get("build_request_identity").map_err(storage)?,
        attempt_identity: row.try_get("attempt_identity").map_err(storage)?,
        intent_identity: row.try_get("intent_identity").map_err(storage)?,
        trial_family_identity: row.try_get("trial_family_identity").map_err(storage)?,
        artifact_identity: row.try_get("artifact_identity").map_err(storage)?,
        build_receipt_identity: row.try_get("build_receipt_identity").map_err(storage)?,
        artifact_family_binding_identity: row
            .try_get("artifact_family_binding_identity")
            .map_err(storage)?,
        census_frontier_identity: row.try_get("census_frontier_identity").map_err(storage)?,
    })
}

fn verify_replay_cut_is_current_census_prefix(
    census: &crate::trial_family::TrialFamilyCensusReadbackV2,
    replay_member_digests: &[String],
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let current_members: Vec<LockedCurrentCensusMemberV1> =
        serde_json::from_value(serde_json::to_value(&census.members).map_err(storage)?)
            .map_err(storage)?;
    let current_member_digests = current_members
        .into_iter()
        .map(|member| member.member_digest)
        .collect::<Vec<_>>();
    verify_replay_member_digest_prefix(replay_member_digests, &current_member_digests)
}

fn verify_replay_member_digest_prefix(
    replay_member_digests: &[String],
    current_member_digests: &[String],
) -> Result<(), IterationAnalysisRequestErrorV1> {
    if replay_member_digests.is_empty()
        || replay_member_digests.len() > current_member_digests.len()
        || replay_member_digests
            .iter()
            .zip(current_member_digests)
            .any(|(replay_digest, current_digest)| replay_digest != current_digest)
    {
        return Err(unavailable(
            "Replay-frozen TrialFamily census is not a prefix of the current exhaustive census",
        ));
    }
    Ok(())
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &IterationAnalysisRequestReadbackV1,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let request = readback.request();
    let receipt = readback.receipt();
    let locator = request.locator();
    let request_bytes = serde_json::to_vec(request).map_err(storage)?;
    let receipt_bytes = serde_json::to_vec(receipt).map_err(storage)?;
    let request_json: serde_json::Value =
        serde_json::from_slice(&request_bytes).map_err(storage)?;
    let receipt_json: serde_json::Value =
        serde_json::from_slice(&receipt_bytes).map_err(storage)?;
    let request_storage_digest =
        owner_storage_digest("rd.iteration-analysis-request.storage.v1", &request_bytes);
    let receipt_storage_digest = owner_storage_digest(
        "rd.iteration-analysis-request-receipt.storage.v1",
        &receipt_bytes,
    );
    sqlx::query("INSERT INTO public.rd_iteration_analysis_requests_v1 (analysis_request_identity,analysis_request_digest,trial_family_identity,result_identity,request_identity,attempt_identity,intent_identity,artifact_identity,request_json,receipt_json,request_storage_bytes,request_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)")
        .bind(request.analysis_request_identity())
        .bind(request.analysis_request_digest())
        .bind(&locator.trial_family_identity)
        .bind(&locator.result_identity)
        .bind(&locator.request_identity)
        .bind(&locator.attempt_identity)
        .bind(&request.input().intent.intent_identity)
        .bind(&request.input().artifact.artifact_identity)
        .bind(request_json)
        .bind(receipt_json)
        .bind(request_bytes)
        .bind(request_storage_digest)
        .bind(receipt_bytes)
        .bind(receipt_storage_digest)
        .bind(i64::try_from(request.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    let payload = payload(readback);
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let payload_json: serde_json::Value =
        serde_json::from_slice(&payload_bytes).map_err(storage)?;
    let payload_digest = canonical_digest("rd.iteration-analysis-requested.payload.v1", &payload)?;
    let event_identity = identity("rd-owner-event-v1", &payload_digest);
    let envelope = AnalysisRequestedEnvelopeV1 {
        event_identity: event_identity.clone(),
        aggregate_identity: request.analysis_request_identity().to_string(),
        event_kind: ITERATION_ANALYSIS_REQUESTED_EVENT_V1.to_string(),
        payload_digest: payload_digest.clone(),
        payload,
        committed_at_epoch_ms: request.committed_at_epoch_ms(),
    };
    let envelope_bytes = serde_json::to_vec(&envelope).map_err(storage)?;
    sqlx::query("INSERT INTO public.rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(event_identity)
        .bind(request.analysis_request_identity())
        .bind(ITERATION_ANALYSIS_REQUESTED_EVENT_V1)
        .bind(payload_digest)
        .bind(payload_json)
        .bind(&payload_bytes)
        .bind(owner_storage_digest("rd.iteration-analysis-requested.payload.storage.v1", &payload_bytes))
        .bind(&envelope_bytes)
        .bind(owner_storage_digest("rd.iteration-analysis-requested.envelope.storage.v1", &envelope_bytes))
        .bind(i64::try_from(request.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn load_request_for_completion_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &IterationAnalysisCompletionProposalV1,
    lock_mode: PostgresReadLockMode,
) -> Result<Option<IterationAnalysisRequestReadbackV1>, IterationAnalysisRequestErrorV1> {
    let query = lock_mode.query(
        "SELECT trial_family_identity,result_identity,request_identity,attempt_identity FROM public.rd_iteration_analysis_requests_v1 WHERE analysis_request_identity=$1 AND analysis_request_digest=$2 AND result_identity=$3",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
        .bind(&proposal.analysis_request_identity)
        .bind(&proposal.analysis_request_digest)
        .bind(&proposal.result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        return Ok(None);
    }
    let [row] = rows.as_slice() else {
        return Err(storage("analysis request completion locator is ambiguous"));
    };
    let locator = IterationAnalysisRequestLocatorV1 {
        trial_family_identity: row.try_get("trial_family_identity").map_err(storage)?,
        result_identity: row.try_get("result_identity").map_err(storage)?,
        request_identity: row.try_get("request_identity").map_err(storage)?,
        attempt_identity: row.try_get("attempt_identity").map_err(storage)?,
    };
    load_by_result_in_transaction(transaction, &locator, lock_mode).await
}

async fn persist_analysis_result(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &IterationAnalysisResultReadbackV1,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let result = readback.result();
    let result_bytes = serde_json::to_vec(result).map_err(storage)?;
    let receipt_bytes = serde_json::to_vec(readback.receipt()).map_err(storage)?;
    let result_json =
        serde_json::from_slice::<serde_json::Value>(&result_bytes).map_err(storage)?;
    let receipt_json =
        serde_json::from_slice::<serde_json::Value>(&receipt_bytes).map_err(storage)?;
    sqlx::query("INSERT INTO public.rd_iteration_analysis_results_v1 (analysis_result_identity,analysis_result_digest,analysis_request_identity,analysis_request_digest,result_identity,decision_identity,decision_digest,result_json,receipt_json,result_storage_bytes,result_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
        .bind(result.analysis_result_identity())
        .bind(result.analysis_result_digest())
        .bind(&result.proposal().analysis_request_identity)
        .bind(&result.proposal().analysis_request_digest)
        .bind(&result.proposal().result_identity)
        .bind(result.decision_identity())
        .bind(result.decision_digest())
        .bind(result_json)
        .bind(receipt_json)
        .bind(&result_bytes)
        .bind(owner_storage_digest("rd.iteration-analysis-result.storage.v1", &result_bytes))
        .bind(&receipt_bytes)
        .bind(owner_storage_digest("rd.iteration-analysis-result-receipt.storage.v1", &receipt_bytes))
        .bind(i64::try_from(result.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    let payload = analysis_completed_payload(readback);
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let payload_digest = canonical_digest("rd.iteration-analysis-completed.payload.v1", &payload)?;
    let event_identity = identity("rd-owner-event-v1", &payload_digest);
    let envelope = AnalysisCompletedEnvelopeV1 {
        event_identity: event_identity.clone(),
        aggregate_identity: result.analysis_result_identity().to_string(),
        event_kind: ITERATION_ANALYSIS_COMPLETED_EVENT_V1.to_string(),
        payload_digest: payload_digest.clone(),
        payload,
        committed_at_epoch_ms: result.committed_at_epoch_ms(),
    };
    let envelope_bytes = serde_json::to_vec(&envelope).map_err(storage)?;
    sqlx::query("INSERT INTO public.rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(event_identity)
        .bind(result.analysis_result_identity())
        .bind(ITERATION_ANALYSIS_COMPLETED_EVENT_V1)
        .bind(payload_digest)
        .bind(serde_json::from_slice::<serde_json::Value>(&payload_bytes).map_err(storage)?)
        .bind(&payload_bytes)
        .bind(owner_storage_digest("rd.iteration-analysis-completed.payload.storage.v1", &payload_bytes))
        .bind(&envelope_bytes)
        .bind(owner_storage_digest("rd.iteration-analysis-completed.envelope.storage.v1", &envelope_bytes))
        .bind(i64::try_from(result.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn load_analysis_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &IterationAnalysisCompletionProposalV1,
    expected_decision_identity: Option<&str>,
    lock_mode: PostgresReadLockMode,
) -> Result<Option<IterationAnalysisResultReadbackV1>, IterationAnalysisRequestErrorV1> {
    let query = lock_mode.query(
        "SELECT analysis_result_identity,analysis_result_digest,analysis_request_identity,analysis_request_digest,result_identity,decision_identity,decision_digest,result_json,receipt_json,result_storage_bytes,result_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM public.rd_iteration_analysis_results_v1 WHERE analysis_request_identity=$1 OR result_identity=$2",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
        .bind(&proposal.analysis_request_identity)
        .bind(&proposal.result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        return Ok(None);
    }
    let [row] = rows.as_slice() else {
        return Err(storage("analysis result locator is ambiguous"));
    };
    let readback = admit_analysis_result_row(transaction, row, lock_mode).await?;
    ensure_same_completion_proposal_v1(&readback, proposal)?;
    if expected_decision_identity
        .is_some_and(|expected| readback.result().decision_identity() != expected)
    {
        return Err(IterationAnalysisRequestErrorV1::Conflict);
    }
    Ok(Some(readback))
}

async fn load_analysis_result_by_locator_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &IterationAnalysisCompletionResolutionLocatorV1,
    lock_mode: PostgresReadLockMode,
) -> Result<
    Option<(
        IterationAnalysisResultReadbackV1,
        IterationAnalysisCompletionProposalV1,
    )>,
    IterationAnalysisRequestErrorV1,
> {
    let query = lock_mode.query(
        "SELECT analysis_result_identity,analysis_result_digest,analysis_request_identity,analysis_request_digest,result_identity,decision_identity,decision_digest,result_json,receipt_json,result_storage_bytes,result_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM public.rd_iteration_analysis_results_v1 WHERE analysis_result_identity=$1 AND analysis_request_identity=$2 AND result_identity=$3",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
        .bind(&locator.analysis_result_identity)
        .bind(&locator.analysis_request_identity)
        .bind(&locator.result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        return Ok(None);
    }
    let [row] = rows.as_slice() else {
        return Err(storage("analysis result resolution locator is ambiguous"));
    };
    let readback = admit_analysis_result_row(transaction, row, lock_mode).await?;
    let proposal = readback.result().proposal().clone();
    Ok(Some((readback, proposal)))
}

async fn admit_analysis_result_row(
    transaction: &mut Transaction<'_, Postgres>,
    row: &sqlx::postgres::PgRow,
    lock_mode: PostgresReadLockMode,
) -> Result<IterationAnalysisResultReadbackV1, IterationAnalysisRequestErrorV1> {
    let result_bytes: Vec<u8> = row.try_get("result_storage_bytes").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(storage)?;
    let stored: StoredIterationAnalysisResultV1 =
        serde_json::from_slice(&result_bytes).map_err(storage)?;
    let receipt: StoredIterationAnalysisResultReceiptV1 =
        serde_json::from_slice(&receipt_bytes).map_err(storage)?;
    let expected = issue_iteration_analysis_result_v1(
        stored.proposal,
        &stored.decision_identity,
        &stored.decision_digest,
        stored.committed_at_epoch_ms,
    )?;

    if stored.schema_version != 1
        || stored.analysis_result_identity != expected.result().analysis_result_identity()
        || stored.analysis_result_digest != expected.result().analysis_result_digest()
        || receipt.schema_version != 1
        || receipt.analysis_result_identity != expected.result().analysis_result_identity()
        || receipt.analysis_result_digest != expected.result().analysis_result_digest()
        || receipt.analysis_request_identity
            != expected.result().proposal().analysis_request_identity
        || receipt.result_identity != expected.result().proposal().result_identity
        || receipt.committed_at_epoch_ms != expected.result().committed_at_epoch_ms()
        || serde_json::to_vec(expected.result()).map_err(storage)? != result_bytes
        || serde_json::to_vec(expected.receipt()).map_err(storage)? != receipt_bytes
        || row
            .try_get::<String, _>("result_storage_digest")
            .map_err(storage)?
            != owner_storage_digest("rd.iteration-analysis-result.storage.v1", &result_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(
                "rd.iteration-analysis-result-receipt.storage.v1",
                &receipt_bytes,
            )
        || row
            .try_get::<serde_json::Value, _>("result_json")
            .map_err(storage)?
            != serde_json::to_value(expected.result()).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != serde_json::to_value(expected.receipt()).map_err(storage)?
        || row
            .try_get::<String, _>("analysis_result_identity")
            .map_err(storage)?
            != expected.result().analysis_result_identity()
        || row
            .try_get::<String, _>("analysis_result_digest")
            .map_err(storage)?
            != expected.result().analysis_result_digest()
        || row
            .try_get::<String, _>("analysis_request_identity")
            .map_err(storage)?
            != expected.result().proposal().analysis_request_identity
        || row
            .try_get::<String, _>("analysis_request_digest")
            .map_err(storage)?
            != expected.result().proposal().analysis_request_digest
        || row
            .try_get::<String, _>("result_identity")
            .map_err(storage)?
            != expected.result().proposal().result_identity
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(storage)?
            != expected.result().decision_identity()
        || row
            .try_get::<String, _>("decision_digest")
            .map_err(storage)?
            != expected.result().decision_digest()
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(expected.result().committed_at_epoch_ms()).map_err(storage)?
        || receipt.receipt_identity != expected.receipt().receipt_identity()
        || receipt.receipt_digest.is_empty()
    {
        return Err(storage("stored analysis result custody mismatch"));
    }
    verify_analysis_completed_outbox(transaction, &expected, lock_mode).await?;
    Ok(expected)
}

async fn load_by_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &IterationAnalysisRequestLocatorV1,
    lock_mode: PostgresReadLockMode,
) -> Result<Option<IterationAnalysisRequestReadbackV1>, IterationAnalysisRequestErrorV1> {
    let query = lock_mode.query(
        "SELECT analysis_request_identity,analysis_request_digest,trial_family_identity,result_identity,request_identity,attempt_identity,intent_identity,artifact_identity,request_json,receipt_json,request_storage_bytes,request_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM public.rd_iteration_analysis_requests_v1 WHERE result_identity=$1",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
        .bind(&locator.result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        return Ok(None);
    }
    let [row] = rows.as_slice() else {
        return Err(storage("analysis request result lookup is ambiguous"));
    };
    let request_json: serde_json::Value = row.try_get("request_json").map_err(storage)?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let request_bytes: Vec<u8> = row.try_get("request_storage_bytes").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(storage)?;
    let readback = decode_stored_readback(&request_bytes, &receipt_bytes)?;
    if request_json != serde_json::to_value(readback.request()).map_err(storage)?
        || receipt_json != serde_json::to_value(readback.receipt()).map_err(storage)?
        || row
            .try_get::<String, _>("analysis_request_identity")
            .map_err(storage)?
            != readback.request().analysis_request_identity()
        || row
            .try_get::<String, _>("analysis_request_digest")
            .map_err(storage)?
            != readback.request().analysis_request_digest()
        || row
            .try_get::<String, _>("trial_family_identity")
            .map_err(storage)?
            != locator.trial_family_identity
        || row
            .try_get::<String, _>("request_identity")
            .map_err(storage)?
            != locator.request_identity
        || row
            .try_get::<String, _>("attempt_identity")
            .map_err(storage)?
            != locator.attempt_identity
        || row
            .try_get::<String, _>("intent_identity")
            .map_err(storage)?
            != readback.request().input().intent.intent_identity
        || row
            .try_get::<String, _>("artifact_identity")
            .map_err(storage)?
            != readback.request().input().artifact.artifact_identity
        || row
            .try_get::<String, _>("request_storage_digest")
            .map_err(storage)?
            != owner_storage_digest("rd.iteration-analysis-request.storage.v1", &request_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(
                "rd.iteration-analysis-request-receipt.storage.v1",
                &receipt_bytes,
            )
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(readback.request().committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("stored analysis request custody mismatch"));
    }
    verify_outbox(transaction, &readback, lock_mode).await?;
    Ok(Some(readback))
}

fn decode_stored_readback(
    request_bytes: &[u8],
    receipt_bytes: &[u8],
) -> Result<IterationAnalysisRequestReadbackV1, IterationAnalysisRequestErrorV1> {
    let stored_request: StoredIterationAnalysisRequestV1 =
        serde_json::from_slice(request_bytes).map_err(storage)?;
    let stored_receipt: StoredIterationAnalysisReceiptV1 =
        serde_json::from_slice(receipt_bytes).map_err(storage)?;
    if stored_request.schema_version != 1 || stored_receipt.schema_version != 1 {
        return Err(storage("stored iteration analysis schema changed"));
    }
    let expected = issue_iteration_analysis_request_v1(
        stored_request.locator,
        stored_request.input,
        stored_request.committed_at_epoch_ms,
    )?;

    if stored_request.analysis_request_identity != expected.request().analysis_request_identity()
        || stored_request.analysis_request_digest != expected.request().analysis_request_digest()
        || stored_receipt.receipt_identity != expected.receipt().receipt_identity()
        || stored_receipt.receipt_digest != expected.receipt().receipt_digest()
        || stored_receipt.analysis_request_identity
            != expected.request().analysis_request_identity()
        || stored_receipt.analysis_request_digest != expected.request().analysis_request_digest()
        || stored_receipt.result_identity != expected.request().locator().result_identity
        || stored_receipt.committed_at_epoch_ms != expected.request().committed_at_epoch_ms()
    {
        return Err(storage("stored iteration analysis positive changed"));
    }
    Ok(expected)
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &IterationAnalysisRequestReadbackV1,
    lock_mode: PostgresReadLockMode,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let request = readback.request();
    let query = lock_mode.query(
        "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
        .bind(request.analysis_request_identity())
        .bind(ITERATION_ANALYSIS_REQUESTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let [row] = rows.as_slice() else {
        return Err(storage("analysis request outbox is missing or ambiguous"));
    };
    let expected_payload = payload(readback);
    let payload_bytes = serde_json::to_vec(&expected_payload).map_err(storage)?;
    let payload_digest = canonical_digest(
        "rd.iteration-analysis-requested.payload.v1",
        &expected_payload,
    )?;
    let event_identity = identity("rd-owner-event-v1", &payload_digest);
    let envelope = AnalysisRequestedEnvelopeV1 {
        event_identity: event_identity.clone(),
        aggregate_identity: request.analysis_request_identity().to_string(),
        event_kind: ITERATION_ANALYSIS_REQUESTED_EVENT_V1.to_string(),
        payload_digest: payload_digest.clone(),
        payload: expected_payload,
        committed_at_epoch_ms: request.committed_at_epoch_ms(),
    };
    let envelope_bytes = serde_json::to_vec(&envelope).map_err(storage)?;

    if row
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != event_identity
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != request.analysis_request_identity()
        || row.try_get::<String, _>("event_kind").map_err(storage)?
            != ITERATION_ANALYSIS_REQUESTED_EVENT_V1
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != serde_json::from_slice::<serde_json::Value>(&payload_bytes).map_err(storage)?
        || row
            .try_get::<Vec<u8>, _>("canonical_payload_bytes")
            .map_err(storage)?
            != payload_bytes
        || row
            .try_get::<String, _>("canonical_payload_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(
                "rd.iteration-analysis-requested.payload.storage.v1",
                &payload_bytes,
            )
        || row
            .try_get::<Vec<u8>, _>("canonical_envelope_bytes")
            .map_err(storage)?
            != envelope_bytes
        || row
            .try_get::<String, _>("canonical_envelope_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(
                "rd.iteration-analysis-requested.envelope.storage.v1",
                &envelope_bytes,
            )
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(request.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("analysis request outbox custody mismatch"));
    }
    Ok(())
}

fn payload(readback: &IterationAnalysisRequestReadbackV1) -> AnalysisRequestedPayloadV1 {
    let request = readback.request();
    let receipt = readback.receipt();
    let locator = request.locator();
    AnalysisRequestedPayloadV1 {
        schema_version: 1,
        analysis_request_identity: request.analysis_request_identity().to_string(),
        analysis_request_digest: request.analysis_request_digest().to_string(),
        receipt_identity: receipt.receipt_identity().to_string(),
        receipt_digest: receipt.receipt_digest().to_string(),
        trial_family_identity: locator.trial_family_identity.clone(),
        result_identity: locator.result_identity.clone(),
        request_identity: locator.request_identity.clone(),
        attempt_identity: locator.attempt_identity.clone(),
        intent_identity: request.input().intent.intent_identity.clone(),
        artifact_identity: request.input().artifact.artifact_identity.clone(),
        committed_at_epoch_ms: request.committed_at_epoch_ms(),
    }
}

fn analysis_completed_payload(
    readback: &IterationAnalysisResultReadbackV1,
) -> AnalysisCompletedPayloadV1 {
    let result = readback.result();
    AnalysisCompletedPayloadV1 {
        schema_version: 1,
        analysis_result_identity: result.analysis_result_identity().to_string(),
        analysis_result_digest: result.analysis_result_digest().to_string(),
        analysis_request_identity: result.proposal().analysis_request_identity.clone(),
        analysis_request_digest: result.proposal().analysis_request_digest.clone(),
        result_identity: result.proposal().result_identity.clone(),
        decision_identity: result.decision_identity().to_string(),
        decision_digest: result.decision_digest().to_string(),
        receipt_identity: readback.receipt().receipt_identity().to_string(),
        committed_at_epoch_ms: result.committed_at_epoch_ms(),
    }
}

async fn verify_analysis_completed_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &IterationAnalysisResultReadbackV1,
    lock_mode: PostgresReadLockMode,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let query = lock_mode.query(
        "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
        .bind(readback.result().analysis_result_identity())
        .bind(ITERATION_ANALYSIS_COMPLETED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let [row] = rows.as_slice() else {
        return Err(storage(
            "analysis completion outbox is missing or ambiguous",
        ));
    };
    let payload = analysis_completed_payload(readback);
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let payload_digest = canonical_digest("rd.iteration-analysis-completed.payload.v1", &payload)?;
    let event_identity = identity("rd-owner-event-v1", &payload_digest);
    let envelope = AnalysisCompletedEnvelopeV1 {
        event_identity: event_identity.clone(),
        aggregate_identity: readback.result().analysis_result_identity().to_string(),
        event_kind: ITERATION_ANALYSIS_COMPLETED_EVENT_V1.to_string(),
        payload_digest: payload_digest.clone(),
        payload,
        committed_at_epoch_ms: readback.result().committed_at_epoch_ms(),
    };
    let envelope_bytes = serde_json::to_vec(&envelope).map_err(storage)?;

    if row
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != event_identity
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != readback.result().analysis_result_identity()
        || row.try_get::<String, _>("event_kind").map_err(storage)?
            != ITERATION_ANALYSIS_COMPLETED_EVENT_V1
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != serde_json::from_slice::<serde_json::Value>(&payload_bytes).map_err(storage)?
        || row
            .try_get::<Vec<u8>, _>("canonical_payload_bytes")
            .map_err(storage)?
            != payload_bytes
        || row
            .try_get::<String, _>("canonical_payload_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(
                "rd.iteration-analysis-completed.payload.storage.v1",
                &payload_bytes,
            )
        || row
            .try_get::<Vec<u8>, _>("canonical_envelope_bytes")
            .map_err(storage)?
            != envelope_bytes
        || row
            .try_get::<String, _>("canonical_envelope_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(
                "rd.iteration-analysis-completed.envelope.storage.v1",
                &envelope_bytes,
            )
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(readback.result().committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("analysis completion outbox custody mismatch"));
    }
    Ok(())
}

fn verify_completion_pair(
    analysis: &IterationAnalysisResultReadbackV1,
    decision: &crate::iteration_decision::CandidateComparisonDecisionReadbackV1,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    if analysis.result().decision_identity() != decision.decision().decision_identity()
        || analysis.result().decision_digest() != decision.decision().decision_digest()
        || analysis.result().proposal().result_identity
            != decision.decision().evidence_cut().result_identity
        || analysis.result().committed_at_epoch_ms() != decision.receipt().committed_at_epoch_ms()
    {
        return Err(storage("analysis result and Decision custody mismatch"));
    }
    Ok(())
}

fn is_valid_completion_resolution_locator(
    locator: &IterationAnalysisCompletionResolutionLocatorV1,
) -> bool {
    [
        locator.analysis_result_identity.as_str(),
        locator.analysis_request_identity.as_str(),
        locator.result_identity.as_str(),
    ]
    .into_iter()
    .all(crate::iteration_decision::is_valid_iteration_decision_locator_v1)
}

async fn ensure_no_partial_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.rd_owner_outbox_v1 WHERE event_kind=$1 AND payload_json->>'result_identity'=$2")
        .bind(ITERATION_ANALYSIS_REQUESTED_EVENT_V1)
        .bind(result_identity)
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)?;
    if count != 0 {
        return Err(storage("partial analysis request outbox already exists"));
    }
    Ok(())
}

async fn lock_composition_key(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
        .bind(result_identity)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn current_epoch_ms(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, IterationAnalysisRequestErrorV1> {
    let value: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    u64::try_from(value).map_err(storage)
}

async fn require_schema(pool: &PgPool) -> Result<(), IterationAnalysisRequestErrorV1> {
    crate::schema_materialization::require_existing_public_tables(
        pool,
        crate::trial_family_postgres::TABLES,
    )
    .await
    .map_err(|e| storage(e.to_string()))?;
    crate::schema_materialization::require_existing_public_tables(pool, TABLES)
        .await
        .map_err(|e| storage(e.to_string()))
}

fn storage(error: impl Display) -> IterationAnalysisRequestErrorV1 {
    IterationAnalysisRequestErrorV1::Storage(error.to_string())
}

fn unavailable(error: impl Display) -> IterationAnalysisRequestErrorV1 {
    IterationAnalysisRequestErrorV1::Unavailable(error.to_string())
}

fn map_product_edge_error(error: ProductEdgeError) -> IterationAnalysisRequestErrorV1 {
    match error {
        ProductEdgeError::Storage(message) => storage(message),
        ProductEdgeError::InvalidProposal(message) => unavailable(message),
        ProductEdgeError::ConflictingReplay => unavailable(
            "Product Edge iteration-analysis admission conflicts with committed meaning",
        ),
        ProductEdgeError::Unavailable => {
            unavailable("Product Edge iteration-analysis admission is unavailable")
        }
    }
}

fn map_backtest_custody_error(
    error: BacktestResultCustodyErrorV2,
) -> IterationAnalysisRequestErrorV1 {
    match error {
        BacktestResultCustodyErrorV2::Unavailable => {
            unavailable("Backtest Result custody is unavailable")
        }
        BacktestResultCustodyErrorV2::Storage(message) => storage(message),
    }
}

fn map_artifact_build_error(error: ArtifactBuildError) -> IterationAnalysisRequestErrorV1 {
    match error {
        ArtifactBuildError::Storage(message) => storage(message),
        ArtifactBuildError::ConflictingReplay => unavailable("Artifact Build identity conflict"),
        ArtifactBuildError::Unauthorized(message) | ArtifactBuildError::Candidate(message) => {
            unavailable(message)
        }
        ArtifactBuildError::Sandbox(message) => unavailable(message),
    }
}

fn map_trial_family_error(
    error: crate::trial_family::TrialFamilyError,
) -> IterationAnalysisRequestErrorV1 {
    // This exhaustive match deliberately makes integration with the fb2706 taxonomy fail to
    // compile until NotFound, InvalidStoredEvidence, and Storage are mapped distinctly.
    match error {
        crate::trial_family::TrialFamilyError::InvalidPolicy(message) => unavailable(message),
        crate::trial_family::TrialFamilyError::ConflictingIdentity => {
            unavailable("TrialFamily identity conflict")
        }
        crate::trial_family::TrialFamilyError::NotFound => {
            unavailable("TrialFamily custody was not found")
        }
        crate::trial_family::TrialFamilyError::InvalidStoredEvidence(message) => {
            unavailable(message)
        }
        crate::trial_family::TrialFamilyError::Storage(message) => storage(message),
        crate::trial_family::TrialFamilyError::LegacyUnavailable => {
            unavailable("TrialFamily legacy custody is unavailable")
        }
        crate::trial_family::TrialFamilyError::Unavailable(message) => unavailable(message),
    }
}

fn map_iteration_decision_error(
    error: IterationDecisionPostgresErrorV1,
) -> IterationAnalysisRequestErrorV1 {
    match error {
        IterationDecisionPostgresErrorV1::Storage(message) => storage(message),
        IterationDecisionPostgresErrorV1::Backtest(error) => map_backtest_custody_error(error),
        IterationDecisionPostgresErrorV1::TrialFamily(error) => map_trial_family_error(error),
        IterationDecisionPostgresErrorV1::CandidateComparisonNotApplicable
        | IterationDecisionPostgresErrorV1::InterpretationRequired
        | IterationDecisionPostgresErrorV1::ReadyForSelectionNotApplicable
        | IterationDecisionPostgresErrorV1::TrialBudgetStopNotApplicable
        | IterationDecisionPostgresErrorV1::NoDecision(_) => {
            IterationAnalysisRequestErrorV1::NotApplicable
        }
        IterationDecisionPostgresErrorV1::InvalidLocator => {
            IterationAnalysisRequestErrorV1::InvalidLocator
        }
        IterationDecisionPostgresErrorV1::ResearchCustody(error) => unavailable(error.to_string()),
        IterationDecisionPostgresErrorV1::Decision(error) => unavailable(error.to_string()),
        IterationDecisionPostgresErrorV1::RepairAction(error) => unavailable(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn canonical_engine_result() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "accounts": [],
            "components": {
                "actor_ids": [],
                "exec_algorithm_ids": [],
                "strategy_ids": ["strategy-1"],
                "trader_state": "stopped"
            },
            "diagnostics": [],
            "fills": ["fill-1", "fill-2", "fill-3"],
            "orders": ["order-1", "order-2"],
            "portfolio_snapshots": [],
            "position_snapshots": [],
            "positions": ["position-1"],
            "run": {
                "backtest_end_ns": "19",
                "backtest_start_ns": "11",
                "iterations": "9",
                "outcome": "completed",
                "run_config_id": "run-config-1",
                "total_events": "9",
                "total_orders": "2",
                "total_positions": "1",
                "trader_id": "trader-1"
            },
            "schema": "vibe-backtest-result/v1",
            "statistics": {
                "general": {
                    "Max Drawdown": "bfc0000000000000",
                    "PnL (total)": "4024000000000000"
                },
                "pnls": {
                    "USDT": {
                        "PnL (total)": "4024000000000000",
                        "PnL% (total)": "3fb999999999999a"
                    }
                },
                "returns": {
                    "Average Return": "3f847ae147ae147b",
                    "Sharpe Ratio (252 days)": "3ff8000000000000"
                },
                "returns_series": []
            },
            "summary": {}
        }))
        .expect("canonical engine fixture")
    }

    #[rstest]
    fn requested_event_has_one_frozen_kind() {
        assert_eq!(
            ITERATION_ANALYSIS_REQUESTED_EVENT_V1,
            "RD_ITERATION_ANALYSIS_REQUESTED_V1"
        );
    }

    #[rstest]
    fn canonical_engine_metrics_project_without_float_widening_or_loss() {
        let bytes = canonical_engine_result();
        let projection = project_canonical_engine_result_v1(&bytes)
            .expect("Owner projects exact canonical engine bytes");
        assert_eq!(projection.actual_backtest_start_ns.as_deref(), Some("11"));
        assert_eq!(projection.actual_backtest_end_ns.as_deref(), Some("19"));
        assert_eq!(projection.outcome, "completed");
        assert_eq!(projection.orders_count, 2);
        assert_eq!(projection.positions_count, 1);
        assert_eq!(projection.fills_count, 3);
        assert_eq!(
            projection.general_statistics["Max Drawdown"],
            "bfc0000000000000"
        );
        assert_eq!(
            projection.pnl_statistics["USDT"]["PnL (total)"],
            "4024000000000000"
        );
        assert_eq!(
            projection.return_statistics["Sharpe Ratio (252 days)"],
            "3ff8000000000000"
        );
    }

    #[rstest]
    fn metric_or_engine_tamper_breaks_the_locked_binding_before_projection() {
        let bytes = canonical_engine_result();
        let digest = owner_storage_digest("vibe.backtest.canonical-result-bytes.v1", &bytes);
        validate_locked_engine_result_binding_v1(
            "vibe-backtest-result/v1",
            &digest,
            u64::try_from(bytes.len()).expect("fixture length"),
            &bytes,
        )
        .expect("exact locked binding");

        let mut value: serde_json::Value =
            serde_json::from_slice(&bytes).expect("canonical fixture JSON");
        value["statistics"]["general"]["Max Drawdown"] = serde_json::json!("3ff0000000000000");
        let metric_tamper = serde_json::to_vec(&value).expect("tampered canonical JSON");
        assert!(matches!(
            validate_locked_engine_result_binding_v1(
                "vibe-backtest-result/v1",
                &digest,
                u64::try_from(bytes.len()).expect("fixture length"),
                &metric_tamper,
            ),
            Err(IterationAnalysisRequestErrorV1::Unavailable(_))
        ));
        assert!(matches!(
            validate_locked_engine_result_binding_v1(
                "vibe-backtest-result/v1",
                &digest,
                u64::try_from(bytes.len()).expect("fixture length") + 1,
                &bytes,
            ),
            Err(IterationAnalysisRequestErrorV1::Unavailable(_))
        ));
    }

    #[rstest]
    fn post_attempt_current_census_accepts_the_replay_frozen_prefix() {
        let replay_cut = vec!["intent-0".to_string()];
        let post_attempt = vec![
            "intent-0".to_string(),
            "request-0".to_string(),
            "result-0".to_string(),
        ];
        verify_replay_member_digest_prefix(&replay_cut, &post_attempt)
            .expect("Replay cut remains an immutable ancestor");
    }

    #[rstest]
    fn cross_spliced_replay_cut_is_not_an_ancestor() {
        let replay_cut = vec!["other-intent".to_string()];
        let post_attempt = vec![
            "intent-0".to_string(),
            "request-0".to_string(),
            "result-0".to_string(),
        ];
        assert!(matches!(
            verify_replay_member_digest_prefix(&replay_cut, &post_attempt),
            Err(IterationAnalysisRequestErrorV1::Unavailable(_))
        ));
    }

    #[rstest]
    fn typed_dependency_storage_errors_remain_storage_errors() {
        assert!(matches!(
            map_backtest_custody_error(BacktestResultCustodyErrorV2::Storage("db".to_string())),
            IterationAnalysisRequestErrorV1::Storage(message) if message == "db"
        ));
        assert!(matches!(
            map_artifact_build_error(ArtifactBuildError::Storage("row".to_string())),
            IterationAnalysisRequestErrorV1::Storage(message) if message == "row"
        ));
        assert!(matches!(
            map_trial_family_error(crate::trial_family::TrialFamilyError::Storage(
                "query".to_string()
            )),
            IterationAnalysisRequestErrorV1::Storage(message) if message == "query"
        ));
        assert!(matches!(
            map_trial_family_error(crate::trial_family::TrialFamilyError::NotFound),
            IterationAnalysisRequestErrorV1::Unavailable(message)
                if message == "TrialFamily custody was not found"
        ));
        assert!(matches!(
            map_trial_family_error(
                crate::trial_family::TrialFamilyError::InvalidStoredEvidence("tampered")
            ),
            IterationAnalysisRequestErrorV1::Unavailable(message) if message == "tampered"
        ));
    }
}
