//! PostgreSQL custody for R&D-owned `REPAIR_INPUTS` Iteration Decisions.
#![expect(
    clippy::large_futures,
    reason = "decision custody keeps the typed repeatable-read transaction state alive across Owner admission"
)]

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;

use crate::{
    BacktestResultCustodyErrorV2, ExploratoryReplayResultLocatorV2,
    iteration_candidate::IterationCandidateEvaluationSetV1,
    iteration_decision::{
        CandidateComparisonDecisionReadbackV1, ExistingIterationDecisionReadbackV1,
        IterationDecisionErrorV1, IterationDecisionGateV1, IterationNoDecisionReasonV1,
        PositiveAssessmentEvidenceV1, ProtectedRobustnessPlanProposalV1,
        ReadyForSelectionDecisionReadbackV1, RepairInputIterationDecisionReadbackV1,
        TrialBudgetTerminalStopDecisionReadbackV1, admit_stored_candidate_comparison_decision_v1,
        admit_stored_ready_for_selection_decision_v1, admit_stored_repair_input_decision_v1,
        admit_stored_trial_budget_terminal_stop_decision_v1, gate_locked_exploratory_result_v1,
        is_valid_iteration_decision_locator_v1, issue_candidate_comparison_decision_v1,
        issue_interpretation_context_v1, issue_ready_for_selection_decision_v1,
        issue_repair_input_decision_v1, issue_trial_budget_terminal_stop_decision_v1,
        ready_candidate_artifact_v1,
    },
    product_edge::ResearchGoalOwnerError,
    rd_owner_postgres_custody::{ResearchCustodyLookupV1, admit_research_custody_in_transaction},
    repair_action::{
        RepairActionErrorV1, RepairActionRequestReadbackV1, admit_stored_repair_action_request_v1,
        issue_repair_action_request_v1,
    },
    trial_family::TrialFamilyError,
    trial_family_postgres::{
        PostgresReadLockMode, load_trial_family_census_v2_by_family_in_transaction,
    },
};

const DECISION_COMMITTED_EVENT_V1: &str = "ITERATION_DECISION_COMMITTED_V1";
const RESEARCH_SELECTION_COMMITTED_EVENT_V1: &str = "RESEARCH_SELECTION_COMMITTED_V1";
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
        name: "rd_iteration_positive_assessments_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("assessment_identity", "text"),
            crate::schema_materialization::required("assessment_digest", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("trial_family_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("candidate_identity", "text"),
            crate::schema_materialization::required("candidate_digest", "text"),
            crate::schema_materialization::required("assessment_json", "jsonb"),
            crate::schema_materialization::required("assessment_storage_bytes", "bytea"),
            crate::schema_materialization::required("assessment_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:decision_identity:public.rd_iteration_decisions_v1(decision_identity):a:a:s:false:false:true:",
            "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):a:a:s:false:false:true:",
            "p:assessment_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("assessment_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
            crate::schema_materialization::unique_index("result_identity"),
        ],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_qualification_candidates_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("candidate_identity", "text"),
            crate::schema_materialization::required("candidate_digest", "text"),
            crate::schema_materialization::required("trial_family_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("artifact_identity", "text"),
            crate::schema_materialization::required("protected_plan_identity", "text"),
            crate::schema_materialization::required("protected_plan_version", "bigint"),
            crate::schema_materialization::required("candidate_json", "jsonb"),
            crate::schema_materialization::required("candidate_storage_bytes", "bytea"),
            crate::schema_materialization::required("candidate_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):a:a:s:false:false:true:",
            "p:candidate_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("candidate_identity"),
            crate::schema_materialization::unique_index("result_identity"),
        ],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_research_selections_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("selection_identity", "text"),
            crate::schema_materialization::required("selection_digest", "text"),
            crate::schema_materialization::required("candidate_identity", "text"),
            crate::schema_materialization::required("assessment_identity", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("trial_family_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("disposition", "text"),
            crate::schema_materialization::required("selection_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("selection_storage_bytes", "bytea"),
            crate::schema_materialization::required("selection_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:candidate_identity:public.rd_qualification_candidates_v1(candidate_identity):a:a:s:false:false:true:",
            "f:assessment_identity:public.rd_iteration_positive_assessments_v1(assessment_identity):a:a:s:false:false:true:",
            "f:decision_identity:public.rd_iteration_decisions_v1(decision_identity):a:a:s:false:false:true:",
            "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):a:a:s:false:false:true:",
            "p:selection_identity:::false:false:true:",
            "u:candidate_identity:::false:false:true:",
            "u:assessment_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("selection_identity"),
            crate::schema_materialization::unique_index("candidate_identity"),
            crate::schema_materialization::unique_index("assessment_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
            crate::schema_materialization::unique_index("result_identity"),
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

/// An authenticated analytical proposal. R&D still locks and derives every Owner fact.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReadyForSelectionCompositionRequestV1 {
    pub trial_family_identity: String,
    pub result_identity: String,
    pub request_identity: String,
    pub attempt_identity: String,
    pub positive_evidence: PositiveAssessmentEvidenceV1,
    pub protected_robustness_plan: ProtectedRobustnessPlanProposalV1,
}

/// Authenticated analytical proposal for the complete finite next-experiment frontier.
///
/// It contains no selectable Decision outcome. R&D Owner recomputes the unique successor or the
/// complete below-threshold stop against locked canonical custody.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateComparisonCompositionRequestV1 {
    pub trial_family_identity: String,
    pub result_identity: String,
    pub request_identity: String,
    pub attempt_identity: String,
    pub candidate_evaluations: IterationCandidateEvaluationSetV1,
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
    #[error("the locked Result does not admit a trial-budget terminal stop")]
    TrialBudgetStopNotApplicable,
    #[error("the locked Result does not admit READY_FOR_SELECTION")]
    ReadyForSelectionNotApplicable,
    #[error("the locked Result does not admit a successor or low-information Decision")]
    CandidateComparisonNotApplicable,
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
        "rd_iteration_positive_assessments_v1",
        "CREATE TABLE IF NOT EXISTS rd_iteration_positive_assessments_v1 (assessment_identity TEXT PRIMARY KEY, assessment_digest TEXT NOT NULL, decision_identity TEXT NOT NULL UNIQUE REFERENCES rd_iteration_decisions_v1(decision_identity), trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), result_identity TEXT NOT NULL UNIQUE, candidate_identity TEXT NOT NULL, candidate_digest TEXT NOT NULL, assessment_json JSONB NOT NULL, assessment_storage_bytes BYTEA NOT NULL, assessment_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(storage)?;
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_qualification_candidates_v1",
        "CREATE TABLE IF NOT EXISTS rd_qualification_candidates_v1 (candidate_identity TEXT PRIMARY KEY, candidate_digest TEXT NOT NULL, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), result_identity TEXT NOT NULL UNIQUE, artifact_identity TEXT NOT NULL, protected_plan_identity TEXT NOT NULL, protected_plan_version BIGINT NOT NULL, candidate_json JSONB NOT NULL, candidate_storage_bytes BYTEA NOT NULL, candidate_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(storage)?;
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_research_selections_v1",
        "CREATE TABLE IF NOT EXISTS rd_research_selections_v1 (selection_identity TEXT PRIMARY KEY, selection_digest TEXT NOT NULL, candidate_identity TEXT NOT NULL UNIQUE REFERENCES rd_qualification_candidates_v1(candidate_identity), assessment_identity TEXT NOT NULL UNIQUE REFERENCES rd_iteration_positive_assessments_v1(assessment_identity), decision_identity TEXT NOT NULL UNIQUE REFERENCES rd_iteration_decisions_v1(decision_identity), trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), result_identity TEXT NOT NULL UNIQUE, disposition TEXT NOT NULL, selection_json JSONB NOT NULL, receipt_json JSONB NOT NULL, selection_storage_bytes BYTEA NOT NULL, selection_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
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
        .map_err(|e| storage(e.to_string()))?;
    crate::successor_intent_postgres::migrate(pool)
        .await
        .map_err(|e| storage(e.to_string()))
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
            let locked_outcome = crate::rd_owner_postgres_custody::
                resolve_exploratory_replay_outcome_for_rd_in_transaction(
                    &mut transaction,
                    ExploratoryReplayResultLocatorV2 {
                        result_identity: &request.result_identity,
                        request_identity: &request.request_identity,
                        attempt_identity: &request.attempt_identity,
                    },
                )
                .await?
                .ok_or(BacktestResultCustodyErrorV2::Unavailable)?;
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
                issue_interpretation_context_v1(&census, &research_custody, &locked_outcome)?;

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

/// Composes the first mechanically provable non-repair Decision from the same locked R&D cut.
///
/// The caller supplies locators only. R&D derives both the six-dimension interpretation and the
/// budget stop from canonical Owner custody in this transaction.
pub(crate) async fn compose_trial_budget_terminal_stop_decision_v1(
    pool: &PgPool,
    request: DecisionCompositionRequestV1,
) -> Result<TrialBudgetTerminalStopDecisionReadbackV1, IterationDecisionPostgresErrorV1> {
    validate_composition_request(&request)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    lock_composition_key(&mut transaction, &request.result_identity).await?;
    if let Some(existing) = load_trial_budget_terminal_stop_by_result_in_transaction(
        &mut transaction,
        &request.result_identity,
        Some(&request),
    )
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

    match gate_locked_exploratory_result_v1(&census, &locked_result)? {
        IterationDecisionGateV1::NoDecision { reason } => {
            transaction.rollback().await.map_err(storage)?;
            return Err(IterationDecisionPostgresErrorV1::NoDecision(reason));
        }
        IterationDecisionGateV1::RepairInputs { .. } => {
            transaction.rollback().await.map_err(storage)?;
            return Err(IterationDecisionPostgresErrorV1::TrialBudgetStopNotApplicable);
        }
        IterationDecisionGateV1::InterpretationRequired { .. } => {}
    }
    let locked_outcome =
        crate::rd_owner_postgres_custody::resolve_exploratory_replay_outcome_for_rd_in_transaction(
            &mut transaction,
            ExploratoryReplayResultLocatorV2 {
                result_identity: &request.result_identity,
                request_identity: &request.request_identity,
                attempt_identity: &request.attempt_identity,
            },
        )
        .await?
        .ok_or(BacktestResultCustodyErrorV2::Unavailable)?;
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
        issue_interpretation_context_v1(&census, &research_custody, &locked_outcome)?;
    let issued =
        issue_trial_budget_terminal_stop_decision_v1(&census, interpretation, current_epoch_ms()?)
            .map_err(|e| match e {
                IterationDecisionErrorV1::InvalidStoredDecision(
                    "TrialFamily budget is not exhausted",
                ) => IterationDecisionPostgresErrorV1::TrialBudgetStopNotApplicable,
                other => IterationDecisionPostgresErrorV1::Decision(other),
            })?;
    persist_trial_budget_terminal_stop_decision(&mut transaction, &issued).await?;
    let readback = load_trial_budget_terminal_stop_by_result_in_transaction(
        &mut transaction,
        &request.result_identity,
        Some(&request),
    )
    .await?
    .ok_or_else(|| storage("committed budget terminal Decision readback is missing"))?;
    if readback != issued {
        return Err(storage(
            "committed budget terminal Decision readback changed",
        ));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

pub(crate) async fn resolve_trial_budget_terminal_stop_decision_v1(
    pool: &PgPool,
    locator: IterationDecisionResolutionLocatorV1,
) -> Result<Option<TrialBudgetTerminalStopDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return Err(IterationDecisionPostgresErrorV1::InvalidLocator);
    }
    let mut transaction = pool.begin().await.map_err(storage)?;
    let readback = load_trial_budget_terminal_stop_by_result_in_transaction(
        &mut transaction,
        &locator.result_identity,
        None,
    )
    .await?;

    if let Some(value) = readback.as_ref()
        && value.decision().decision_identity() != locator.decision_identity
    {
        return Err(storage("Decision resolution locator mismatch"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

/// Atomically seals one positive R&D assessment and its READY Decision from one locked cut.
pub(crate) async fn compose_ready_for_selection_decision_v1(
    pool: &PgPool,
    request: ReadyForSelectionCompositionRequestV1,
) -> Result<ReadyForSelectionDecisionReadbackV1, IterationDecisionPostgresErrorV1> {
    validate_ready_for_selection_request(&request)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    lock_composition_key(&mut transaction, &request.result_identity).await?;
    if sqlx::query("SELECT 1 FROM rd_iteration_decisions_v1 WHERE result_identity=$1 FOR SHARE")
        .bind(&request.result_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        .is_some()
    {
        let existing = load_ready_for_selection_by_result_in_transaction(
            &mut transaction,
            &request.result_identity,
            Some(&request),
        )
        .await?
        .ok_or(IterationDecisionPostgresErrorV1::ReadyForSelectionNotApplicable)?;
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }

    let census = load_trial_family_census_v2_by_family_in_transaction(
        &mut transaction,
        &request.trial_family_identity,
    )
    .await?;
    let locator = ExploratoryReplayResultLocatorV2 {
        result_identity: &request.result_identity,
        request_identity: &request.request_identity,
        attempt_identity: &request.attempt_identity,
    };
    let locked_result =
        crate::resolve_exploratory_replay_result_for_rd_in_transaction(&mut transaction, locator)
            .await?
            .ok_or(BacktestResultCustodyErrorV2::Unavailable)?;

    match gate_locked_exploratory_result_v1(&census, &locked_result)? {
        IterationDecisionGateV1::NoDecision { reason } => {
            transaction.rollback().await.map_err(storage)?;
            return Err(IterationDecisionPostgresErrorV1::NoDecision(reason));
        }
        IterationDecisionGateV1::RepairInputs { .. } => {
            transaction.rollback().await.map_err(storage)?;
            return Err(IterationDecisionPostgresErrorV1::ReadyForSelectionNotApplicable);
        }
        IterationDecisionGateV1::InterpretationRequired { .. } => {}
    }
    let locked_outcome =
        crate::rd_owner_postgres_custody::resolve_exploratory_replay_outcome_for_rd_in_transaction(
            &mut transaction,
            ExploratoryReplayResultLocatorV2 {
                result_identity: &request.result_identity,
                request_identity: &request.request_identity,
                attempt_identity: &request.attempt_identity,
            },
        )
        .await?
        .ok_or(BacktestResultCustodyErrorV2::Unavailable)?;
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
        issue_interpretation_context_v1(&census, &research_custody, &locked_outcome)?;
    let artifact = ready_candidate_artifact_v1(locked_result.result())?;
    let issued = issue_ready_for_selection_decision_v1(
        &census,
        interpretation,
        artifact,
        request.positive_evidence.clone(),
        request.protected_robustness_plan.clone(),
        current_epoch_ms()?,
    )
    .map_err(|e| match e {
        IterationDecisionErrorV1::InvalidStoredDecision(_) => {
            IterationDecisionPostgresErrorV1::ReadyForSelectionNotApplicable
        }
        other => IterationDecisionPostgresErrorV1::Decision(other),
    })?;
    persist_ready_for_selection_decision(&mut transaction, &issued).await?;
    let readback = load_ready_for_selection_by_result_in_transaction(
        &mut transaction,
        &request.result_identity,
        Some(&request),
    )
    .await?
    .ok_or_else(|| storage("committed READY Decision readback is missing"))?;
    if readback != issued {
        return Err(storage("committed READY Decision readback changed"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

pub(crate) async fn resolve_ready_for_selection_decision_v1(
    pool: &PgPool,
    locator: IterationDecisionResolutionLocatorV1,
) -> Result<Option<ReadyForSelectionDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return Err(IterationDecisionPostgresErrorV1::InvalidLocator);
    }
    let mut transaction = pool.begin().await.map_err(storage)?;
    let readback = load_ready_for_selection_by_result_in_transaction(
        &mut transaction,
        &locator.result_identity,
        None,
    )
    .await?;

    if let Some(value) = readback.as_ref()
        && value.decision().decision_identity() != locator.decision_identity
    {
        return Err(storage("Decision resolution locator mismatch"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

/// Atomically computes and seals a successor or low-information terminal Decision.
pub(crate) async fn compose_candidate_comparison_decision_v1(
    pool: &PgPool,
    request: CandidateComparisonCompositionRequestV1,
) -> Result<CandidateComparisonDecisionReadbackV1, IterationDecisionPostgresErrorV1> {
    validate_candidate_comparison_request(&request)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    lock_composition_key(&mut transaction, &request.result_identity).await?;
    let census = load_trial_family_census_v2_by_family_in_transaction(
        &mut transaction,
        &request.trial_family_identity,
    )
    .await?;

    if sqlx::query("SELECT 1 FROM rd_iteration_decisions_v1 WHERE result_identity=$1 FOR SHARE")
        .bind(&request.result_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        .is_some()
    {
        let existing = load_candidate_comparison_by_result_in_transaction(
            &mut transaction,
            &census,
            &request.result_identity,
            Some(&request),
        )
        .await?
        .ok_or(IterationDecisionPostgresErrorV1::CandidateComparisonNotApplicable)?;
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }

    let locator = ExploratoryReplayResultLocatorV2 {
        result_identity: &request.result_identity,
        request_identity: &request.request_identity,
        attempt_identity: &request.attempt_identity,
    };
    let locked_result =
        crate::resolve_exploratory_replay_result_for_rd_in_transaction(&mut transaction, locator)
            .await?
            .ok_or(BacktestResultCustodyErrorV2::Unavailable)?;

    match gate_locked_exploratory_result_v1(&census, &locked_result)? {
        IterationDecisionGateV1::NoDecision { reason } => {
            transaction.rollback().await.map_err(storage)?;
            return Err(IterationDecisionPostgresErrorV1::NoDecision(reason));
        }
        IterationDecisionGateV1::RepairInputs { .. } => {
            transaction.rollback().await.map_err(storage)?;
            return Err(IterationDecisionPostgresErrorV1::CandidateComparisonNotApplicable);
        }
        IterationDecisionGateV1::InterpretationRequired { .. } => {}
    }
    let locked_outcome =
        crate::rd_owner_postgres_custody::resolve_exploratory_replay_outcome_for_rd_in_transaction(
            &mut transaction,
            ExploratoryReplayResultLocatorV2 {
                result_identity: &request.result_identity,
                request_identity: &request.request_identity,
                attempt_identity: &request.attempt_identity,
            },
        )
        .await?
        .ok_or(BacktestResultCustodyErrorV2::Unavailable)?;
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
        issue_interpretation_context_v1(&census, &research_custody, &locked_outcome)?;
    let issued = issue_candidate_comparison_decision_v1(
        &census,
        interpretation,
        request.candidate_evaluations.clone(),
        current_epoch_ms()?,
    )
    .map_err(|e| match e {
        IterationDecisionErrorV1::InvalidStoredDecision(_)
        | IterationDecisionErrorV1::CandidateComparisonUnavailable(_) => {
            IterationDecisionPostgresErrorV1::CandidateComparisonNotApplicable
        }
        other => IterationDecisionPostgresErrorV1::Decision(other),
    })?;
    persist_candidate_comparison_decision(&mut transaction, &issued).await?;
    let readback = load_candidate_comparison_by_result_in_transaction(
        &mut transaction,
        &census,
        &request.result_identity,
        Some(&request),
    )
    .await?
    .ok_or_else(|| storage("committed candidate-comparison Decision readback is missing"))?;
    if readback != issued {
        return Err(storage(
            "committed candidate-comparison Decision readback changed",
        ));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

/// Seals one candidate-comparison Decision while retaining the caller's R&D Owner transaction.
pub(crate) async fn compose_candidate_comparison_decision_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    census: &crate::trial_family::TrialFamilyCensusReadbackV2,
    interpretation: crate::iteration_decision::IterationInterpretationContextV1,
    candidate_evaluations: crate::IterationCandidateEvaluationSetV1,
    committed_at_epoch_ms: u64,
) -> Result<CandidateComparisonDecisionReadbackV1, IterationDecisionPostgresErrorV1> {
    let result_identity = interpretation.evidence_cut().result_identity.clone();
    if sqlx::query("SELECT 1 FROM rd_iteration_decisions_v1 WHERE result_identity=$1 FOR SHARE")
        .bind(&result_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?
        .is_some()
    {
        return Err(IterationDecisionPostgresErrorV1::CandidateComparisonNotApplicable);
    }
    let issued = issue_candidate_comparison_decision_v1(
        census,
        interpretation,
        candidate_evaluations,
        committed_at_epoch_ms,
    )
    .map_err(|e| match e {
        IterationDecisionErrorV1::InvalidStoredDecision(_)
        | IterationDecisionErrorV1::CandidateComparisonUnavailable(_) => {
            IterationDecisionPostgresErrorV1::CandidateComparisonNotApplicable
        }
        other => IterationDecisionPostgresErrorV1::Decision(other),
    })?;
    persist_candidate_comparison_decision(transaction, &issued).await?;
    Ok(issued)
}

pub(crate) async fn resolve_candidate_comparison_decision_v1(
    pool: &PgPool,
    locator: IterationDecisionResolutionLocatorV1,
) -> Result<Option<CandidateComparisonDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return Err(IterationDecisionPostgresErrorV1::InvalidLocator);
    }
    let mut transaction = pool.begin().await.map_err(storage)?;
    let family_identity = sqlx::query(
        "SELECT trial_family_identity FROM rd_iteration_decisions_v1 WHERE decision_identity=$1 AND result_identity=$2 FOR SHARE",
    )
    .bind(&locator.decision_identity)
    .bind(&locator.result_identity)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(storage)?
    .map(|row| row.try_get::<String, _>("trial_family_identity"))
    .transpose()
    .map_err(storage)?;
    let Some(family_identity) = family_identity else {
        transaction.commit().await.map_err(storage)?;
        return Ok(None);
    };
    let census =
        load_trial_family_census_v2_by_family_in_transaction(&mut transaction, &family_identity)
            .await?;
    let readback = load_candidate_comparison_by_result_in_transaction(
        &mut transaction,
        &census,
        &locator.result_identity,
        None,
    )
    .await?;

    if let Some(value) = readback.as_ref()
        && value.decision().decision_identity() != locator.decision_identity
    {
        return Err(storage("Decision resolution locator mismatch"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

/// Resolves one exact existing Decision without requiring the consumer to guess its branch.
pub(crate) async fn resolve_iteration_decision_v1(
    pool: &PgPool,
    locator: IterationDecisionResolutionLocatorV1,
) -> Result<Option<ExistingIterationDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return Err(IterationDecisionPostgresErrorV1::InvalidLocator);
    }
    let mut transaction = pool.begin().await.map_err(storage)?;
    let stored = sqlx::query(
        "SELECT trial_family_identity,decision_json FROM rd_iteration_decisions_v1 WHERE decision_identity=$1 AND result_identity=$2 FOR SHARE",
    )
    .bind(&locator.decision_identity)
    .bind(&locator.result_identity)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(storage)?;
    let Some(stored) = stored else {
        transaction.commit().await.map_err(storage)?;
        return Ok(None);
    };
    let decision_json: serde_json::Value = stored.try_get("decision_json").map_err(storage)?;
    let trial_family_identity: String = stored.try_get("trial_family_identity").map_err(storage)?;
    let outcome = decision_json
        .get("outcome")
        .and_then(|value| value.get("outcome"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| storage("stored Decision outcome discriminator is unavailable"))?;
    let readback = match outcome {
        "REPAIR_INPUTS" => {
            load_by_result_in_transaction(&mut transaction, &locator.result_identity, None)
                .await?
                .map(ExistingIterationDecisionReadbackV1::RepairInputs)
        }
        "TERMINAL_STOP"
            if decision_json
                .get("outcome")
                .and_then(|value| value.get("reason"))
                .and_then(serde_json::Value::as_str)
                == Some("TRIAL_BUDGET_EXHAUSTED") =>
        {
            load_trial_budget_terminal_stop_by_result_in_transaction(
                &mut transaction,
                &locator.result_identity,
                None,
            )
            .await?
            .map(ExistingIterationDecisionReadbackV1::TrialBudgetTerminalStop)
        }
        "SUCCESSOR_EXPERIMENT" | "TERMINAL_STOP"
            if outcome == "SUCCESSOR_EXPERIMENT"
                || decision_json
                    .get("outcome")
                    .and_then(|value| value.get("reason"))
                    .and_then(serde_json::Value::as_str)
                    == Some("LOW_INFORMATION_VALUE") =>
        {
            let census = load_trial_family_census_v2_by_family_in_transaction(
                &mut transaction,
                &trial_family_identity,
            )
            .await?;
            load_candidate_comparison_by_result_in_transaction(
                &mut transaction,
                &census,
                &locator.result_identity,
                None,
            )
            .await?
            .map(ExistingIterationDecisionReadbackV1::CandidateComparison)
        }
        "READY_FOR_SELECTION" => load_ready_for_selection_by_result_in_transaction(
            &mut transaction,
            &locator.result_identity,
            None,
        )
        .await?
        .map(ExistingIterationDecisionReadbackV1::ReadyForSelection),
        _ => {
            return Err(storage(
                "stored Decision kind has no admitted unified readback",
            ));
        }
    };
    let resolved_identity = match readback.as_ref() {
        Some(ExistingIterationDecisionReadbackV1::RepairInputs(value)) => {
            value.decision().decision_identity()
        }
        Some(ExistingIterationDecisionReadbackV1::TrialBudgetTerminalStop(value)) => {
            value.decision().decision_identity()
        }
        Some(ExistingIterationDecisionReadbackV1::CandidateComparison(value)) => {
            value.decision().decision_identity()
        }
        Some(ExistingIterationDecisionReadbackV1::ReadyForSelection(value)) => {
            value.decision().decision_identity()
        }
        None => return Err(storage("stored Decision readback is missing")),
    };

    if resolved_identity != locator.decision_identity {
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
    persist_decision_record(
        transaction,
        decision,
        decision.decision_identity(),
        decision.decision_digest(),
        decision.evidence_cut(),
        readback.receipt(),
    )
    .await
}

async fn persist_trial_budget_terminal_stop_decision(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &TrialBudgetTerminalStopDecisionReadbackV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let decision = readback.decision();
    persist_decision_record(
        transaction,
        decision,
        decision.decision_identity(),
        decision.decision_digest(),
        decision.evidence_cut(),
        readback.receipt(),
    )
    .await
}

async fn persist_candidate_comparison_decision(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &CandidateComparisonDecisionReadbackV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let decision = readback.decision();
    persist_decision_record(
        transaction,
        decision,
        decision.decision_identity(),
        decision.decision_digest(),
        decision.evidence_cut(),
        readback.receipt(),
    )
    .await
}

async fn persist_ready_for_selection_decision(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &ReadyForSelectionDecisionReadbackV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let decision = readback.decision();
    persist_decision_record(
        transaction,
        decision,
        decision.decision_identity(),
        decision.decision_digest(),
        decision.evidence_cut(),
        readback.receipt(),
    )
    .await?;
    let assessment = readback.assessment();
    let assessment_bytes = serde_json::to_vec(assessment).map_err(storage)?;
    let assessment_json =
        serde_json::from_slice::<serde_json::Value>(&assessment_bytes).map_err(storage)?;
    let assessment_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        "rd.iteration-positive-assessment.storage.v1",
        &assessment_bytes,
    );
    sqlx::query("INSERT INTO rd_iteration_positive_assessments_v1 (assessment_identity,assessment_digest,decision_identity,trial_family_identity,result_identity,candidate_identity,candidate_digest,assessment_json,assessment_storage_bytes,assessment_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(assessment.assessment_identity())
        .bind(assessment.assessment_digest())
        .bind(decision.decision_identity())
        .bind(&decision.evidence_cut().trial_family_identity)
        .bind(&decision.evidence_cut().result_identity)
        .bind(assessment.candidate_identity())
        .bind(assessment.candidate_digest())
        .bind(assessment_json)
        .bind(assessment_bytes)
        .bind(assessment_storage_digest)
        .bind(i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    let candidate = readback.candidate();
    let candidate_bytes = serde_json::to_vec(candidate).map_err(storage)?;
    let candidate_json =
        serde_json::from_slice::<serde_json::Value>(&candidate_bytes).map_err(storage)?;
    let candidate_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        "rd.qualification-candidate.storage.v1",
        &candidate_bytes,
    );
    sqlx::query("INSERT INTO rd_qualification_candidates_v1 (candidate_identity,candidate_digest,trial_family_identity,result_identity,artifact_identity,protected_plan_identity,protected_plan_version,candidate_json,candidate_storage_bytes,candidate_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(candidate.candidate_identity())
        .bind(candidate.candidate_digest())
        .bind(&decision.evidence_cut().trial_family_identity)
        .bind(&decision.evidence_cut().result_identity)
        .bind(candidate.protected_robustness_plan().artifact().identity.as_str())
        .bind(candidate.protected_robustness_plan().plan_identity())
        .bind(i64::try_from(candidate.protected_robustness_plan().plan_version()).map_err(storage)?)
        .bind(candidate_json)
        .bind(candidate_bytes)
        .bind(candidate_storage_digest)
        .bind(i64::try_from(readback.selection_receipt().committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    let selection = readback.selection();
    let selection_receipt = readback.selection_receipt();
    let selection_bytes = serde_json::to_vec(selection).map_err(storage)?;
    let selection_receipt_bytes = serde_json::to_vec(selection_receipt).map_err(storage)?;
    let selection_json =
        serde_json::from_slice::<serde_json::Value>(&selection_bytes).map_err(storage)?;
    let selection_receipt_json =
        serde_json::from_slice::<serde_json::Value>(&selection_receipt_bytes).map_err(storage)?;
    let selection_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        "rd.research-selection.storage.v1",
        &selection_bytes,
    );
    let selection_receipt_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        "rd.research-selection-receipt.storage.v1",
        &selection_receipt_bytes,
    );
    sqlx::query("INSERT INTO rd_research_selections_v1 (selection_identity,selection_digest,candidate_identity,assessment_identity,decision_identity,trial_family_identity,result_identity,disposition,selection_json,receipt_json,selection_storage_bytes,selection_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)")
        .bind(selection.selection_identity())
        .bind(selection.selection_digest())
        .bind(candidate.candidate_identity())
        .bind(assessment.assessment_identity())
        .bind(decision.decision_identity())
        .bind(&decision.evidence_cut().trial_family_identity)
        .bind(&decision.evidence_cut().result_identity)
        .bind("SELECTED_FOR_QUALIFICATION")
        .bind(selection_json)
        .bind(selection_receipt_json)
        .bind(selection_bytes)
        .bind(selection_storage_digest)
        .bind(selection_receipt_bytes)
        .bind(selection_receipt_storage_digest)
        .bind(i64::try_from(selection_receipt.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    let selection_outbox = ResearchSelectionCommittedOutboxV1 {
        schema_version: 1,
        selection_identity: selection.selection_identity().to_string(),
        selection_digest: selection.selection_digest().to_string(),
        selection_receipt_identity: selection_receipt.receipt_identity().to_string(),
        candidate_identity: candidate.candidate_identity().to_string(),
        candidate_digest: candidate.candidate_digest().to_string(),
        assessment_identity: assessment.assessment_identity().to_string(),
        decision_identity: decision.decision_identity().to_string(),
        trial_family_identity: decision.evidence_cut().trial_family_identity.clone(),
        result_identity: decision.evidence_cut().result_identity.clone(),
        protected_plan_identity: candidate
            .protected_robustness_plan()
            .plan_identity()
            .to_string(),
        protected_plan_version: candidate.protected_robustness_plan().plan_version(),
    };
    let payload_digest =
        canonical_digest("rd.owner-outbox.research-selection.v1", &selection_outbox)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(format!("rd-owner-outbox-research-selection-v1-{}", payload_digest.trim_start_matches("sha256:")))
        .bind(selection.selection_identity())
        .bind(RESEARCH_SELECTION_COMMITTED_EVENT_V1)
        .bind(payload_digest)
        .bind(serde_json::to_value(selection_outbox).map_err(storage)?)
        .bind(i64::try_from(selection_receipt.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn persist_decision_record<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    decision: &T,
    decision_identity: &str,
    decision_digest: &str,
    evidence: &crate::iteration_decision::IterationDecisionEvidenceCutV1,
    receipt: &crate::iteration_decision::IterationDecisionReceiptV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
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
        .bind(decision_identity)
        .bind(&evidence.trial_family_identity)
        .bind(&evidence.request_identity)
        .bind(&evidence.result_identity)
        .bind(&evidence.attempt_identity)
        .bind(decision_digest)
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
        decision_identity: decision_identity.to_string(),
        decision_digest: decision_digest.to_string(),
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
        .bind(decision_identity)
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

async fn load_trial_budget_terminal_stop_by_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
    composition: Option<&DecisionCompositionRequestV1>,
) -> Result<Option<TrialBudgetTerminalStopDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
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
    let readback =
        admit_stored_trial_budget_terminal_stop_decision_v1(&decision_bytes, &receipt_bytes)?;
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
    verify_trial_budget_terminal_stop_outbox_in_transaction(transaction, &readback).await?;
    Ok(Some(readback))
}

pub(crate) async fn load_candidate_comparison_by_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    census: &crate::trial_family::TrialFamilyCensusReadbackV2,
    result_identity: &str,
    composition: Option<&CandidateComparisonCompositionRequestV1>,
) -> Result<Option<CandidateComparisonDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    load_candidate_comparison_by_result_with_lock_mode_in_transaction(
        transaction,
        census,
        result_identity,
        composition,
        PostgresReadLockMode::ForShare,
    )
    .await
}

pub(crate) async fn load_candidate_comparison_by_result_snapshot_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    census: &crate::trial_family::TrialFamilyCensusReadbackV2,
    result_identity: &str,
    composition: Option<&CandidateComparisonCompositionRequestV1>,
) -> Result<Option<CandidateComparisonDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    load_candidate_comparison_by_result_with_lock_mode_in_transaction(
        transaction,
        census,
        result_identity,
        composition,
        PostgresReadLockMode::Snapshot,
    )
    .await
}

async fn load_candidate_comparison_by_result_with_lock_mode_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    census: &crate::trial_family::TrialFamilyCensusReadbackV2,
    result_identity: &str,
    composition: Option<&CandidateComparisonCompositionRequestV1>,
    lock_mode: PostgresReadLockMode,
) -> Result<Option<CandidateComparisonDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    let query = lock_mode.query(
        "SELECT decision_identity,trial_family_identity,request_identity,result_identity,attempt_identity,decision_digest,decision_json,receipt_json,decision_storage_bytes,decision_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_iteration_decisions_v1 WHERE result_identity=$1",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
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
    let readback =
        admit_stored_candidate_comparison_decision_v1(census, &decision_bytes, &receipt_bytes)?;
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
            || request.attempt_identity != evidence.attempt_identity
            || request.candidate_evaluations != *decision.candidate_evaluations())
    {
        return Err(storage("candidate-comparison composition retry changed"));
    }
    verify_candidate_comparison_outbox_in_transaction(transaction, &readback, lock_mode).await?;
    Ok(Some(readback))
}

async fn load_ready_for_selection_by_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
    composition: Option<&ReadyForSelectionCompositionRequestV1>,
) -> Result<Option<ReadyForSelectionDecisionReadbackV1>, IterationDecisionPostgresErrorV1> {
    let rows = sqlx::query("SELECT a.assessment_identity,a.assessment_digest,a.decision_identity,a.trial_family_identity,a.result_identity,a.candidate_identity,a.candidate_digest,a.assessment_json,a.assessment_storage_bytes,a.assessment_storage_digest,a.committed_at_epoch_ms,d.request_identity,d.attempt_identity,d.decision_digest,d.decision_json,d.receipt_json,d.decision_storage_bytes,d.decision_storage_digest,d.receipt_storage_bytes,d.receipt_storage_digest,c.candidate_identity AS frozen_candidate_identity,c.candidate_digest AS frozen_candidate_digest,c.artifact_identity,c.protected_plan_identity,c.protected_plan_version,c.candidate_json,c.candidate_storage_bytes,c.candidate_storage_digest,c.committed_at_epoch_ms AS candidate_committed_at_epoch_ms,s.selection_identity,s.selection_digest,s.candidate_identity AS selection_candidate_identity,s.assessment_identity AS selection_assessment_identity,s.decision_identity AS selection_decision_identity,s.disposition,s.selection_json,s.receipt_json AS selection_receipt_json,s.selection_storage_bytes,s.selection_storage_digest,s.receipt_storage_bytes AS selection_receipt_storage_bytes,s.receipt_storage_digest AS selection_receipt_storage_digest,s.committed_at_epoch_ms AS selection_committed_at_epoch_ms FROM rd_iteration_positive_assessments_v1 a JOIN rd_iteration_decisions_v1 d ON d.decision_identity=a.decision_identity JOIN rd_qualification_candidates_v1 c ON c.candidate_identity=a.candidate_identity AND c.result_identity=a.result_identity JOIN rd_research_selections_v1 s ON s.candidate_identity=c.candidate_identity AND s.assessment_identity=a.assessment_identity AND s.decision_identity=d.decision_identity AND s.result_identity=a.result_identity WHERE a.result_identity=$1 FOR SHARE OF a,d,c,s")
        .bind(result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        let partial_rows = sqlx::query("SELECT decision_identity FROM rd_iteration_decisions_v1 WHERE result_identity=$1 FOR SHARE")
            .bind(result_identity)
            .fetch_all(&mut **transaction)
            .await
            .map_err(storage)?;
        if !partial_rows.is_empty() {
            return Err(storage(
                "READY Decision exists without complete assessment, Candidate, and Selection custody",
            ));
        }
        return Ok(None);
    }

    if rows.len() != 1 {
        return Err(storage("positive assessment result identity is not unique"));
    }
    let row = &rows[0];
    let assessment_bytes: Vec<u8> = row.try_get("assessment_storage_bytes").map_err(storage)?;
    let decision_bytes: Vec<u8> = row.try_get("decision_storage_bytes").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(storage)?;
    let candidate_bytes: Vec<u8> = row.try_get("candidate_storage_bytes").map_err(storage)?;
    let selection_bytes: Vec<u8> = row.try_get("selection_storage_bytes").map_err(storage)?;
    let selection_receipt_bytes: Vec<u8> = row
        .try_get("selection_receipt_storage_bytes")
        .map_err(storage)?;

    if row
        .try_get::<String, _>("assessment_storage_digest")
        .map_err(storage)?
        != crate::native_replay_rd_sources_v2::owner_storage_digest(
            "rd.iteration-positive-assessment.storage.v1",
            &assessment_bytes,
        )
        || row
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
        || row
            .try_get::<String, _>("candidate_storage_digest")
            .map_err(storage)?
            != crate::native_replay_rd_sources_v2::owner_storage_digest(
                "rd.qualification-candidate.storage.v1",
                &candidate_bytes,
            )
        || row
            .try_get::<String, _>("selection_storage_digest")
            .map_err(storage)?
            != crate::native_replay_rd_sources_v2::owner_storage_digest(
                "rd.research-selection.storage.v1",
                &selection_bytes,
            )
        || row
            .try_get::<String, _>("selection_receipt_storage_digest")
            .map_err(storage)?
            != crate::native_replay_rd_sources_v2::owner_storage_digest(
                "rd.research-selection-receipt.storage.v1",
                &selection_receipt_bytes,
            )
    {
        return Err(storage(
            "READY assessment, Decision, Candidate, or Selection storage digest mismatch",
        ));
    }
    let trial_family_identity: String = row.try_get("trial_family_identity").map_err(storage)?;
    let request_identity: String = row.try_get("request_identity").map_err(storage)?;
    let attempt_identity: String = row.try_get("attempt_identity").map_err(storage)?;
    let census =
        load_trial_family_census_v2_by_family_in_transaction(transaction, &trial_family_identity)
            .await?;
    let locked_result = crate::resolve_exploratory_replay_result_for_rd_in_transaction(
        transaction,
        ExploratoryReplayResultLocatorV2 {
            result_identity,
            request_identity: &request_identity,
            attempt_identity: &attempt_identity,
        },
    )
    .await?
    .ok_or(BacktestResultCustodyErrorV2::Unavailable)?;
    let artifact = ready_candidate_artifact_v1(locked_result.result())?;
    let readback = admit_stored_ready_for_selection_decision_v1(
        &census,
        &artifact,
        &assessment_bytes,
        &decision_bytes,
        &receipt_bytes,
        &candidate_bytes,
        &selection_bytes,
        &selection_receipt_bytes,
    )?;
    let assessment = readback.assessment();
    let decision = readback.decision();
    let receipt = readback.receipt();
    let candidate = readback.candidate();
    let selection = readback.selection();
    let selection_receipt = readback.selection_receipt();

    if row
        .try_get::<serde_json::Value, _>("assessment_json")
        .map_err(storage)?
        != serde_json::to_value(assessment).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("decision_json")
            .map_err(storage)?
            != serde_json::to_value(decision).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != serde_json::to_value(receipt).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("candidate_json")
            .map_err(storage)?
            != serde_json::to_value(candidate).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("selection_json")
            .map_err(storage)?
            != serde_json::to_value(selection).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("selection_receipt_json")
            .map_err(storage)?
            != serde_json::to_value(selection_receipt).map_err(storage)?
        || row
            .try_get::<String, _>("assessment_identity")
            .map_err(storage)?
            != assessment.assessment_identity()
        || row
            .try_get::<String, _>("assessment_digest")
            .map_err(storage)?
            != assessment.assessment_digest()
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(storage)?
            != decision.decision_identity()
        || row
            .try_get::<String, _>("decision_digest")
            .map_err(storage)?
            != decision.decision_digest()
        || trial_family_identity != decision.evidence_cut().trial_family_identity
        || row
            .try_get::<String, _>("result_identity")
            .map_err(storage)?
            != decision.evidence_cut().result_identity
        || request_identity != decision.evidence_cut().request_identity
        || attempt_identity != decision.evidence_cut().attempt_identity
        || row
            .try_get::<String, _>("candidate_identity")
            .map_err(storage)?
            != assessment.candidate_identity()
        || row
            .try_get::<String, _>("candidate_digest")
            .map_err(storage)?
            != assessment.candidate_digest()
        || row
            .try_get::<String, _>("frozen_candidate_identity")
            .map_err(storage)?
            != candidate.candidate_identity()
        || row
            .try_get::<String, _>("frozen_candidate_digest")
            .map_err(storage)?
            != candidate.candidate_digest()
        || row
            .try_get::<String, _>("artifact_identity")
            .map_err(storage)?
            != candidate.protected_robustness_plan().artifact().identity
        || row
            .try_get::<String, _>("protected_plan_identity")
            .map_err(storage)?
            != candidate.protected_robustness_plan().plan_identity()
        || row
            .try_get::<i64, _>("protected_plan_version")
            .map_err(storage)?
            != i64::try_from(candidate.protected_robustness_plan().plan_version())
                .map_err(storage)?
        || row
            .try_get::<String, _>("selection_identity")
            .map_err(storage)?
            != selection.selection_identity()
        || row
            .try_get::<String, _>("selection_digest")
            .map_err(storage)?
            != selection.selection_digest()
        || row
            .try_get::<String, _>("selection_candidate_identity")
            .map_err(storage)?
            != candidate.candidate_identity()
        || row
            .try_get::<String, _>("selection_assessment_identity")
            .map_err(storage)?
            != assessment.assessment_identity()
        || row
            .try_get::<String, _>("selection_decision_identity")
            .map_err(storage)?
            != decision.decision_identity()
        || row.try_get::<String, _>("disposition").map_err(storage)? != "SELECTED_FOR_QUALIFICATION"
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?
        || row
            .try_get::<i64, _>("candidate_committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(selection_receipt.committed_at_epoch_ms()).map_err(storage)?
        || row
            .try_get::<i64, _>("selection_committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(selection_receipt.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage(
            "READY assessment, Decision, Candidate, or Selection row/readback mismatch",
        ));
    }

    if let Some(request) = composition
        && (request.trial_family_identity != decision.evidence_cut().trial_family_identity
            || request.request_identity != decision.evidence_cut().request_identity
            || request.result_identity != decision.evidence_cut().result_identity
            || request.attempt_identity != decision.evidence_cut().attempt_identity
            || request.positive_evidence != *assessment.positive_evidence()
            || request.protected_robustness_plan
                != *assessment.protected_robustness_plan().proposal())
    {
        return Err(storage("READY composition retry changed"));
    }
    verify_ready_for_selection_outbox_in_transaction(transaction, &readback).await?;
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

async fn verify_trial_budget_terminal_stop_outbox_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &TrialBudgetTerminalStopDecisionReadbackV1,
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

async fn verify_candidate_comparison_outbox_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &CandidateComparisonDecisionReadbackV1,
    lock_mode: PostgresReadLockMode,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let query = lock_mode.query(
        "SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2",
        " FOR SHARE",
    );
    let rows = sqlx::query(query)
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

async fn verify_ready_for_selection_outbox_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &ReadyForSelectionDecisionReadbackV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    let rows = sqlx::query("SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(readback.decision().decision_identity())
        .bind(DECISION_COMMITTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
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

    if rows.len() != 1
        || rows[0]
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != readback.decision().decision_identity()
        || rows[0]
            .try_get::<String, _>("event_kind")
            .map_err(storage)?
            != DECISION_COMMITTED_EVENT_V1
        || rows[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != serde_json::to_value(&expected).map_err(storage)?
        || rows[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != canonical_digest("rd.owner-outbox.iteration-decision.v1", &expected)?
        || rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("READY Decision outbox/readback mismatch"));
    }
    let selection_rows = sqlx::query("SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(readback.selection().selection_identity())
        .bind(RESEARCH_SELECTION_COMMITTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let candidate = readback.candidate();
    let selection = readback.selection();
    let selection_receipt = readback.selection_receipt();
    let assessment = readback.assessment();
    let expected_selection = ResearchSelectionCommittedOutboxV1 {
        schema_version: 1,
        selection_identity: selection.selection_identity().to_string(),
        selection_digest: selection.selection_digest().to_string(),
        selection_receipt_identity: selection_receipt.receipt_identity().to_string(),
        candidate_identity: candidate.candidate_identity().to_string(),
        candidate_digest: candidate.candidate_digest().to_string(),
        assessment_identity: assessment.assessment_identity().to_string(),
        decision_identity: readback.decision().decision_identity().to_string(),
        trial_family_identity: evidence.trial_family_identity.clone(),
        result_identity: evidence.result_identity.clone(),
        protected_plan_identity: candidate
            .protected_robustness_plan()
            .plan_identity()
            .to_string(),
        protected_plan_version: candidate.protected_robustness_plan().plan_version(),
    };

    if selection_rows.len() != 1
        || selection_rows[0]
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != selection.selection_identity()
        || selection_rows[0]
            .try_get::<String, _>("event_kind")
            .map_err(storage)?
            != RESEARCH_SELECTION_COMMITTED_EVENT_V1
        || selection_rows[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != serde_json::to_value(&expected_selection).map_err(storage)?
        || selection_rows[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != canonical_digest("rd.owner-outbox.research-selection.v1", &expected_selection)?
        || selection_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(selection_receipt.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("Research Selection outbox/readback mismatch"));
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

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ResearchSelectionCommittedOutboxV1 {
    schema_version: u16,
    selection_identity: String,
    selection_digest: String,
    selection_receipt_identity: String,
    candidate_identity: String,
    candidate_digest: String,
    assessment_identity: String,
    decision_identity: String,
    trial_family_identity: String,
    result_identity: String,
    protected_plan_identity: String,
    protected_plan_version: u64,
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

fn validate_ready_for_selection_request(
    request: &ReadyForSelectionCompositionRequestV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    validate_composition_request(&DecisionCompositionRequestV1 {
        trial_family_identity: request.trial_family_identity.clone(),
        result_identity: request.result_identity.clone(),
        request_identity: request.request_identity.clone(),
        attempt_identity: request.attempt_identity.clone(),
    })?;
    Ok(())
}

fn validate_candidate_comparison_request(
    request: &CandidateComparisonCompositionRequestV1,
) -> Result<(), IterationDecisionPostgresErrorV1> {
    validate_composition_request(&DecisionCompositionRequestV1 {
        trial_family_identity: request.trial_family_identity.clone(),
        result_identity: request.result_identity.clone(),
        request_identity: request.request_identity.clone(),
        attempt_identity: request.attempt_identity.clone(),
    })
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

#[cfg(all(test, feature = "sealed-develop-composer-acceptance"))]
mod postgres_acceptance_tests {
    use vibe_data::owner::source_binding::BindingDigest;

    use super::*;
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
    use serde::Serialize;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::UnixListener,
    };
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ComponentObservationLocatorV2, ConsumedComponentObservationDtoV2,
        ContentIdentityV2, DiagnosticCategoryV2, DiagnosticEvidenceDtoV2, ObservationComponentV2,
        OpaqueIdentityV2, ReconciliationAtomDtoV2, ReconciliationStatusV2, ReplayAuthorityClaimV2,
        ReplayModelProfilesV2, ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2,
        ReplayResultDtoV2, ReplayTerminalV2, ReplayWindowV2, VersionedIdentityV2,
    };
    use vibe_data::owner::pit_snapshot::sealed_acceptance::{
        SealedAcceptanceMarketDataRepairEvidenceV1, issue_market_data_repair_evidence_v1,
    };
    use vibe_operator_authorization::{
        OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
        OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationScopeV1,
    };
    use vibe_product_edge::{
        AgentOperationManifestProposalV1, ProductEdgeAdmissionLocatorV1,
        ProductEdgeAdmissionRequestV1, ProductEdgeAuthorizationTrustV1,
        ProductEdgeBootstrapProposalV1, ProductEdgeInvocationClaimRequestV1,
        ProductEdgePostgresOwnerV1,
    };
    use vibe_qualification::PostgresQualificationOwnerV1;
    use vibe_rd_market_data_repair_custody::{
        SealedMarketDataRepairRequestLocatorV1, lock_market_data_repair_request_v1,
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use crate::{
        artifact_build::{
            ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ArtifactBuildCandidateV1,
            ArtifactBuildDisposition, ArtifactBuildOwnerPort, ArtifactBuildRequestV1,
            ArtifactBuildResolution, GeneratedDirectionV1, GeneratedSignalV1,
            GeneratedStrategyLogicV1, canonical_sandbox_source_capsule,
        },
        artifact_build_postgres::PostgresArtifactBuildOwnerV1,
        cargo_artifact::{
            RD_SANDBOX_DOCKERFILE, RUSTC_COMMIT, RUSTC_RELEASE, SANDBOX_POLICY_V1, TARGET,
        },
        exploratory_replay::{
            EXPLORATORY_REPLAY_MUTATION_EFFECT_V2, EXPLORATORY_REPLAY_OPERATION_V2,
            EXPLORATORY_REPLAY_SCHEMA_V2, ExploratoryReplayRecoverySelectorV2,
            ExploratoryReplayRequestProposalV2, SealedExploratoryReplayReadbackV2,
            exploratory_replay_admission_payload_v2,
        },
        family_adapters::verified_price_build,
        iteration_candidate::{
            IterationCandidateAdmissibilityV1, IterationCandidateEvaluationSetV1,
            IterationCandidateEvaluationV1, IterationEvidenceReferenceV1,
            IterationExperimentModeV1, IterationHypothesisDimensionV1,
            IterationInformationValueEvidenceV1,
        },
        iteration_decision::PositiveAssessmentEvidenceReferenceV1,
        product_edge::{
            ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, RESEARCH_GOAL_OPERATION_V2,
            RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, ResearchGoalOwnerPortV2, ResearchSourceV1,
            SourcedResearchGoalV2, TrialFamilyProposalV1, UnsourcedResearchGoalV1,
        },
        product_edge_postgres::PostgresResearchGoalOwnerV1,
        successor_intent::{
            SUCCESSOR_RESEARCH_INTENT_MUTATION_EFFECT_V1, SUCCESSOR_RESEARCH_INTENT_OPERATION_V1,
            SUCCESSOR_RESEARCH_INTENT_SCHEMA_V1, SuccessorResearchIntentOperationRequestV1,
        },
        trial_family::{
            TrialFamilyAttemptAppendV2, TrialFamilyAttemptTerminalDispositionV2,
            TrialFamilyCandidateSetProposalV2, TrialFamilyCensusReadbackV2, TrialFamilyPolicyV1,
        },
        trial_family_postgres::{
            append_trial_family_attempt_in_transaction,
            load_trial_family_census_v2_by_family_in_transaction,
        },
    };

    mod iteration_analysis_postgres_acceptance_tests;

    const RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.replay-result-storage.v2";
    const RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.result-receipt-storage.v1";
    const OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.result-outbox-storage.v1";
    const RECEIPT_DIGEST_DOMAIN: &str = "vibe.backtest.result-receipt.v1";
    const OUTBOX_PAYLOAD_DIGEST_DOMAIN: &str = "vibe.backtest.result-outbox-payload.v1";
    const OUTBOX_EVENT_DIGEST_DOMAIN: &str = "vibe.backtest.result-outbox-event.v1";
    const RESULT_EVENT_KIND: &str = "EXPLORATORY_BACKTEST_RESULT_COMMITTED_V1";

    struct PersistedReplayPredecessorV1 {
        owner: PostgresResearchGoalOwnerV1,
        edge: ProductEdgePostgresOwnerV1,
        predecessor: SealedExploratoryReplayReadbackV2,
        intent_identity: String,
        intent_digest: String,
        family_identity: String,
        family_policy: TrialFamilyPolicyV1,
        independence_basis_locator: vibe_qualification::RdIndependenceBasisLocatorV1,
        research_receipt_identity: String,
        request_proof_digest: String,
    }

    struct ReadyDecisionPostgresHarnessV1 {
        database: CanonicalOwnerPostgresTestDatabaseV1,
        qualification: PostgresQualificationOwnerV1,
        suffix: String,
        result_identity: String,
        composition: ReadyForSelectionCompositionRequestV1,
        issued: ReadyForSelectionDecisionReadbackV1,
    }

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

    async fn persist_repair_replay_predecessor(
        database: &CanonicalOwnerPostgresTestDatabaseV1,
        evidence: &SealedAcceptanceMarketDataRepairEvidenceV1,
        suffix: &str,
    ) -> PersistedReplayPredecessorV1 {
        crate::replay_policy_catalog_postgres_v2::ensure_authenticated_sealed_acceptance_fixture_v3(
            database
                .mutation()
                .pool(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter),
        )
        .await
        .expect("sealed Replay Policy Catalog fixture");

        let now = current_epoch_ms().expect("test clock");
        let valid_through = now + 3_600_000;
        let mut manifests = [
            repair_replay_manifest(
                RESEARCH_GOAL_OPERATION_V2,
                RESEARCH_GOAL_SCHEMA_V2,
                vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
                now,
                valid_through,
            ),
            repair_replay_manifest(
                SUCCESSOR_RESEARCH_INTENT_OPERATION_V1,
                SUCCESSOR_RESEARCH_INTENT_SCHEMA_V1,
                vec![SUCCESSOR_RESEARCH_INTENT_MUTATION_EFFECT_V1.to_string()],
                now,
                valid_through,
            ),
            repair_replay_manifest(
                ARTIFACT_BUILD_OPERATION_V1,
                ARTIFACT_BUILD_SCHEMA_V1,
                vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                ],
                now,
                valid_through,
            ),
            repair_replay_manifest(
                EXPLORATORY_REPLAY_OPERATION_V2,
                EXPLORATORY_REPLAY_SCHEMA_V2,
                vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V2.to_string()],
                now,
                valid_through,
            ),
        ];
        manifests.sort_by_key(|manifest| manifest.manifest_identity().expect("manifest identity"));
        let request_proof_digest = format!("sha256:{}", "a".repeat(64));
        let issuer_identity = format!("repair-replay-issuer-{suffix}");
        let issuer_key_version = "test-key-v1".to_string();
        let audience = format!("R_AND_D:{suffix}");
        let principal = format!("repair-replay-principal-{suffix}");
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect_existing(
            database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        )
        .await
        .expect("Operator Authorization issuer");
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("repair-replay-authorization-{suffix}"),
                issuer_identity: issuer_identity.clone(),
                issuer_key_version: issuer_key_version.clone(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: principal.clone(),
                    audience: audience.clone(),
                    permissions: vec![
                        "research:artifact-build".to_string(),
                        "research:submit".to_string(),
                        "research:view".to_string(),
                    ],
                },
                request_proof_digest: request_proof_digest.clone(),
                operation_manifests: manifests
                    .iter()
                    .map(|manifest| OperationManifestBindingV1 {
                        manifest_identity: manifest.manifest_identity().expect("manifest identity"),
                        manifest_digest: manifest.manifest_digest().expect("manifest digest"),
                    })
                    .collect(),
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: valid_through,
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .expect("Operator Authorization genesis");
        let deployment_identity = format!("repair-replay-product-edge-{suffix}");
        let edge = ProductEdgePostgresOwnerV1::connect_existing(
            database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment_identity,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity,
                issuer_key_version,
                audience,
            },
        )
        .await
        .expect("Product Edge Owner");
        edge.bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity,
            binding_identity: format!("repair-replay-product-edge-binding-{suffix}"),
            expected_history_head: "EMPTY".to_string(),
            generation: 1,
            effective_principal: principal,
            scope_policy_version: "scope-v1".to_string(),
            capability_policy_version: "capability-v1".to_string(),
            audit_policy_version: "audit-v1".to_string(),
            valid_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: valid_through,
            authorization: authorization.locator(),
            manifests: manifests.to_vec(),
        })
        .await
        .expect("Product Edge genesis");

        let owner = PostgresResearchGoalOwnerV1::connect_with_backtest(
            database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
            database.database_url(CanonicalOwnerTestRoleV1::BacktestOwner),
        )
        .await
        .expect("R&D Owner");
        let research_request_identity = format!("repair-replay-research-{suffix}");
        let research_payload = ProductEdgeResearchGoalRequestV2 {
            request_identity: research_request_identity.clone(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: placeholder_product_edge_admission(&research_request_identity),
            goal: SourcedResearchGoalV2 {
                hypothesis: "PIT momentum survives exact costs".to_string(),
                mechanism: "bounded information diffusion".to_string(),
                falsification_question: "does exact cost remove the effect".to_string(),
                expected_observation: "net continuation remains positive".to_string(),
                required_data: vec!["PIT bars".to_string()],
                cost_assumption: "frozen cost model".to_string(),
                capacity_assumption: "frozen capacity model".to_string(),
                sources: vec![ResearchSourceV1 {
                    locator: "https://example.com/research".to_string(),
                    content_digest: format!("sha256:{}", "c".repeat(64)),
                    observed_at: "2026-09-13T00:00:00Z".to_string(),
                    source_cut: "source-cut-v1".to_string(),
                    license_basis: "public research".to_string(),
                    interpretation: "bounded interpretation".to_string(),
                }],
            },
            trial_family_proposal: TrialFamilyProposalV1 {
                trial_budget: 8,
                stop_rule: "stop on falsifier or budget".to_string(),
                pit_rule_identity: "pit-rule-v1".to_string(),
                cost_model_identity: "cost-model-v1".to_string(),
                slippage_model_identity: "slippage-model-v1".to_string(),
                capacity_model_identity: "capacity-model-v1".to_string(),
                independence_rationale: "Owner-resolved predecessor census".to_string(),
            },
        };
        let research_admission = edge
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: research_request_identity.clone(),
                typed_payload: serde_json::json!({
                    "request_identity": research_payload.request_identity,
                    "channel": research_payload.channel,
                    "goal": research_payload.goal,
                    "trial_family_proposal": research_payload.trial_family_proposal,
                }),
                operation: RESEARCH_GOAL_OPERATION_V2.to_string(),
                operation_schema: RESEARCH_GOAL_SCHEMA_V2.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
                request_proof_digest: request_proof_digest.clone(),
                audit_correlation: format!("test:{research_request_identity}"),
            })
            .await
            .expect("Research Product Edge admission")
            .locator()
            .clone();
        let accepted = owner
            .submit_v2(ProductEdgeResearchGoalRequestV2 {
                admission: research_admission,
                ..research_payload
            })
            .await
            .expect("persisted Research acceptance");
        let research_receipt = accepted.owner_receipt().expect("Research receipt");
        let independence_basis_locator = accepted
            .independence_basis()
            .expect("R&D Independence Basis")
            .locator();
        let family_policy = accepted
            .trial_family()
            .expect("R&D TrialFamily")
            .root()
            .policy()
            .clone();
        let intent_identity = research_receipt
            .resulting_research_intent_identity
            .as_deref()
            .expect("Research Intent")
            .to_string();
        let intent_digest = research_receipt.semantic_digest.clone();
        let research_receipt_identity = research_receipt.receipt_identity.clone();

        let build_request_identity = format!("repair-replay-artifact-request-{suffix}");
        let attempt_identity = format!("repair-replay-artifact-attempt-{suffix}");
        let artifact_payload = ArtifactBuildRequestV1 {
            build_request_identity: build_request_identity.clone(),
            attempt_identity: attempt_identity.clone(),
            intent_identity: intent_identity.clone(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: placeholder_product_edge_admission(&build_request_identity),
        };
        let artifact_admission = edge
            .admit_artifact_build_request(ProductEdgeAdmissionRequestV1 {
                request_identity: build_request_identity.clone(),
                typed_payload: serde_json::json!({
                    "build_request_identity": artifact_payload.build_request_identity,
                    "attempt_identity": artifact_payload.attempt_identity,
                    "intent_identity": artifact_payload.intent_identity,
                    "channel": artifact_payload.channel,
                }),
                operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
                operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects: vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                ],
                request_proof_digest: request_proof_digest.clone(),
                audit_correlation: format!("test:{build_request_identity}"),
            })
            .await
            .expect("Artifact Product Edge admission")
            .locator()
            .clone();
        let build_request = ArtifactBuildRequestV1 {
            admission: artifact_admission,
            ..artifact_payload
        };
        let sandbox_socket = format!("/tmp/rd-repair-replay-{suffix}.sock");
        let _ = std::fs::remove_file(&sandbox_socket);
        let listener = UnixListener::bind(&sandbox_socket).expect("Artifact sandbox listener");
        let sandbox = tokio::spawn(serve_repair_replay_sandbox(
            listener,
            sandbox_socket.clone(),
        ));
        let artifact_owner = PostgresArtifactBuildOwnerV1::connect(
            database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            &sandbox_socket,
            u64::MAX,
        )
        .await
        .expect("Artifact Owner");
        assert_eq!(
            artifact_owner
                .prepare(build_request.clone())
                .await
                .expect("prepared Artifact")
                .resolution(),
            ArtifactBuildResolution::Prepared
        );
        let invocation_claim = edge
            .claim_provider_invocation(ProductEdgeInvocationClaimRequestV1 {
                admission: build_request.admission.clone(),
                attempt_identity: attempt_identity.clone(),
            })
            .await
            .expect("Product Edge invocation claim");
        let reserved = artifact_owner
            .reserve_provider_invocation_custody(
                &build_request_identity,
                &attempt_identity,
                invocation_claim,
            )
            .await
            .expect("R&D invocation reservation");
        let (start, _) = reserved.into_parts();
        edge.start_provider_invocation(start)
            .await
            .expect("Product Edge invocation start");
        let started_claim = edge
            .resolve_provider_invocation_claim(&build_request.admission, &attempt_identity)
            .await
            .expect("Product Edge invocation resolve")
            .expect("started Product Edge invocation");
        let terminal = artifact_owner
            .submit_candidate(
                build_request,
                ArtifactBuildCandidateV1 {
                    schema_version: 1,
                    candidate_identity: format!(
                        "agent-program-candidate-v1-repair-replay-{suffix}"
                    ),
                    intent_identity: intent_identity.clone(),
                    intent_semantic_digest: intent_digest.clone(),
                    logic: GeneratedStrategyLogicV1 {
                        signal: GeneratedSignalV1::Momentum,
                        direction: GeneratedDirectionV1::LongOnly,
                        lookback_bars: 24,
                        entry_threshold_bps: 50,
                        exit_threshold_bps: 10,
                    },
                    structured_logic_summary: "bounded repair Replay candidate".to_string(),
                    agent_change_explanation: "test-only deterministic artifact".to_string(),
                },
                Some(&started_claim),
            )
            .await
            .expect("persisted Artifact acceptance");
        assert_eq!(
            terminal
                .owner_receipt()
                .expect("Artifact receipt")
                .disposition,
            ArtifactBuildDisposition::Success
        );
        sandbox
            .await
            .expect("Artifact sandbox task")
            .expect("Artifact sandbox response");
        let artifact_receipt = terminal.owner_receipt().expect("Artifact receipt");
        let artifact_identity = artifact_receipt
            .artifact_identity
            .as_deref()
            .expect("Artifact identity");
        let build_receipt_identity = artifact_receipt
            .build_receipt_identity
            .as_deref()
            .expect("Artifact build receipt");
        let artifact_review = terminal.artifact_review().expect("Artifact review");
        let artifact_family = terminal.artifact_trial_family().expect("Artifact family");
        let family = artifact_family.trial_family();
        let family_identity = family.root().trial_family_identity().to_string();
        let replay_policy = family
            .root()
            .policy()
            .replay_execution_policy_v2()
            .expect("Replay policy binding")
            .verify()
            .expect("verified Replay policy");

        let predecessor_identity = format!("rd-replay-request-decision-{suffix}");
        let mut predecessor_request =
            repair_replay(evidence, &predecessor_identity, &family_identity, suffix)
                .as_dto()
                .clone();
        predecessor_request.frozen_research_intent = ContentIdentityV2 {
            identity: identity(&intent_identity),
            digest: CanonicalDigestV2::try_from(intent_digest.clone()).expect("Intent digest"),
        };
        predecessor_request.trial_family = ContentIdentityV2 {
            identity: identity(&family_identity),
            digest: CanonicalDigestV2::try_from(family.root().root_digest().to_string())
                .expect("family root digest"),
        };
        predecessor_request.trial_family_census_frontier = ContentIdentityV2 {
            identity: identity(family.census_frontier().frontier_identity()),
            digest: CanonicalDigestV2::try_from(
                family.census_frontier().frontier_digest().to_string(),
            )
            .expect("family frontier digest"),
        };
        predecessor_request.artifact = ContentIdentityV2 {
            identity: identity(artifact_identity),
            digest: CanonicalDigestV2::try_from(artifact_review.build_receipt.wasm_digest.clone())
                .expect("Artifact digest"),
        };
        predecessor_request.correction_rule = replay_policy.correction_rule.clone();
        predecessor_request.market_semantics = replay_policy.market_semantics.clone();
        predecessor_request.replay_configuration = replay_policy.replay_configuration.clone();
        predecessor_request.models = ReplayModelProfilesV2 {
            runtime_kernel: replay_policy.runtime_kernel.clone(),
            simulator: replay_policy.simulator.clone(),
            cost: replay_policy.cost.clone(),
            slippage: replay_policy.slippage.clone(),
            capacity: replay_policy.capacity.clone(),
        };
        predecessor_request.runner_operational_profile =
            replay_policy.runner_operational_profile.clone();
        predecessor_request.diagnostic_policy = replay_policy.diagnostic_policy.clone();
        predecessor_request.deterministic_seed = replay_policy.deterministic_seed;
        predecessor_request.window = replay_policy.window;
        predecessor_request.calendar = replay_policy.calendar.clone();
        predecessor_request.session = replay_policy.session.clone();
        predecessor_request.time_zone = replay_policy.time_zone.clone();
        predecessor_request.corporate_action_cut = replay_policy.corporate_action_cut.clone();
        predecessor_request.historical_membership_cut =
            replay_policy.historical_membership_cut.clone();
        let mut proposal = ExploratoryReplayRequestProposalV2 {
            admission: placeholder_product_edge_admission(&predecessor_identity),
            build_request_identity,
            attempt_identity,
            build_receipt_identity: build_receipt_identity.to_string(),
            artifact_family_binding_identity: artifact_family
                .binding()
                .binding_identity()
                .to_string(),
            request: predecessor_request,
        };
        let replay_admission = edge
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: predecessor_identity.clone(),
                typed_payload: exploratory_replay_admission_payload_v2(&proposal)
                    .expect("Replay admission payload"),
                operation: EXPLORATORY_REPLAY_OPERATION_V2.to_string(),
                operation_schema: EXPLORATORY_REPLAY_SCHEMA_V2.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects: vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V2.to_string()],
                request_proof_digest: request_proof_digest.clone(),
                audit_correlation: format!("test:{predecessor_identity}"),
            })
            .await
            .expect("Replay Product Edge admission")
            .locator()
            .clone();
        proposal.admission = replay_admission;
        let committed = owner
            .commit_exploratory_replay_request_v2(proposal)
            .await
            .expect("persisted Replay V2 predecessor");
        let resolved = owner
            .resolve_exploratory_replay_request_v2(&ExploratoryReplayRecoverySelectorV2 {
                request_identity: committed.locator().request_identity.clone(),
                meaning_digest: committed.locator().meaning_digest.clone(),
            })
            .await
            .expect("Replay V2 predecessor resolve");
        let predecessor = resolved
            .readback()
            .expect("persisted Replay V2 predecessor readback")
            .clone();
        assert_eq!(predecessor.locator(), committed.locator().clone());
        assert_eq!(
            predecessor.canonical_request_bytes(),
            committed.canonical_request_bytes()
        );
        PersistedReplayPredecessorV1 {
            owner,
            edge,
            predecessor,
            intent_identity,
            intent_digest,
            family_identity,
            family_policy,
            independence_basis_locator,
            research_receipt_identity,
            request_proof_digest,
        }
    }

    fn repair_replay_manifest(
        operation: &str,
        schema: &str,
        effects: Vec<String>,
        now: u64,
        valid_through: u64,
    ) -> AgentOperationManifestProposalV1 {
        AgentOperationManifestProposalV1 {
            operation: operation.to_string(),
            operation_schema: schema.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            allowed_effects: effects,
            prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
            capability_policy_digest: format!("sha256:{}", "b".repeat(64)),
            effective_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: valid_through,
        }
    }

    fn placeholder_product_edge_admission(identity: &str) -> ProductEdgeAdmissionLocatorV1 {
        ProductEdgeAdmissionLocatorV1 {
            request_identity: identity.to_string(),
            admission_identity: format!("placeholder-{identity}"),
            admission_digest: format!("sha256:{}", "d".repeat(64)),
        }
    }

    async fn serve_repair_replay_sandbox(
        listener: UnixListener,
        socket: String,
    ) -> anyhow::Result<()> {
        let (mut stream, _) = listener.accept().await?;
        let length = stream.read_u32().await? as usize;
        let mut bytes = vec![0; length];
        stream.read_exact(&mut bytes).await?;
        let request: serde_json::Value = serde_json::from_slice(&bytes)?;
        let source = request["source"].as_str().expect("sandbox source");
        let wasm = &verified_price_build()?.wasm;
        let response = serde_json::to_vec(&serde_json::json!({
            "protocol": "rd-build-sandbox-v1",
            "outcome": "SUCCESS",
            "failure_code": null,
            "source_capsule_base64": BASE64.encode(canonical_sandbox_source_capsule(source.as_bytes())?),
            "build_recipe_base64": BASE64.encode(repair_replay_build_recipe()),
            "wasm_one_base64": BASE64.encode(wasm),
            "wasm_two_base64": BASE64.encode(wasm),
        }))?;
        stream.write_u32(response.len() as u32).await?;
        stream.write_all(&response).await?;
        stream.flush().await?;
        std::fs::remove_file(socket)?;
        Ok(())
    }

    fn repair_replay_build_recipe() -> Vec<u8> {
        let mut bytes = serde_json::to_vec(&serde_json::json!({
            "build_platform": "linux/arm64",
            "dependency_policy": "locked_no_external_dependencies",
            "dockerfile_sha256": format!("sha256:{:x}", Sha256::digest(RD_SANDBOX_DOCKERFILE.as_bytes())),
            "frontend": "docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d",
            "manifest": "Cargo.toml",
            "network_policy": "container_network_none_cargo_offline",
            "rust_image": "public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777",
            "rustc_commit": RUSTC_COMMIT,
            "rustc_release": RUSTC_RELEASE,
            "sandbox_policy": SANDBOX_POLICY_V1,
            "schema_version": 2,
            "target": TARGET,
            "wasm_target": "rd_generated_strategy",
        }))
        .expect("canonical sandbox build recipe");
        bytes.push(b'\n');
        bytes
    }

    #[rstest::rstest]
    #[ignore = "requires the canonical disposable R&D and Backtest Owner PostgreSQL topology"]
    fn repair_decision_action_and_market_data_request_commit_retry_resolve_and_rejection_are_atomic()
     {
        std::thread::Builder::new()
            .name("repair-reentry-golden-loop-test".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("test runtime")
                    .block_on(run_repair_decision_action_and_market_data_request_commit_retry_resolve_and_rejection_are_atomic());
            })
            .expect("golden-loop test thread")
            .join()
            .expect("golden-loop test thread completion");
    }

    async fn run_repair_decision_action_and_market_data_request_commit_retry_resolve_and_rejection_are_atomic()
     {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let mutation = database.mutation();
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
        let suffix = unique_suffix();
        let committed_at = current_epoch_ms().expect("test clock");
        let market_data_evidence =
            issue_market_data_repair_evidence_v1().expect("sealed Market Data repair evidence");
        let PersistedReplayPredecessorV1 {
            owner: replay_owner,
            predecessor,
            intent_identity,
            intent_digest,
            family_identity,
            research_receipt_identity,
            ..
        } = Box::pin(persist_repair_replay_predecessor(
            &database,
            &market_data_evidence,
            &suffix,
        ))
        .await;
        let replay = predecessor.request();
        let request_identity = predecessor.request_identity().to_string();
        let request_digest = predecessor.meaning_digest().to_string();
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
        append_trial_family_attempt_in_transaction(
            &mut family_transaction,
            &intent_identity,
            &research_receipt_identity,
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
            replay,
            market_data_evidence.source(),
            market_data_evidence.shared_time(),
        )
        .await
        .expect("first Market Data repair request commit");
        let retried_market_data = crate::market_data_repair_request_postgres::compose_with_sealed_owner_evidence_for_test_v1(
            rd_pool,
            first_action.request().action_request_identity(),
            first.decision().decision_identity(),
            replay,
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
            replay,
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
            replay,
            market_data_evidence.source(),
            market_data_evidence.shared_time(),
        )
        .await;
        assert!(mismatched_market_data.is_err());
        let mismatched_market_data_resolve = crate::market_data_repair_request_postgres::resolve_with_sealed_owner_evidence_for_test_v1(
            rd_pool,
            "rd-repair-action-request-v1-mismatch",
            first.decision().decision_identity(),
            replay,
            market_data_evidence.source(),
            market_data_evidence.shared_time(),
        )
        .await;
        assert!(mismatched_market_data_resolve.is_err());
        let market_data_counts_after: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_market_data_repair_requests_v1 WHERE action_request_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='MARKET_DATA_REPAIR_REQUESTED_V1')",
        )
        .bind(first_action.request().action_request_identity())
        .bind(first_market_data.request().request_identity())
        .fetch_one(rd_pool)
        .await
        .expect("post-rejection Market Data repair counts");
        assert_eq!(market_data_counts_after, (1, 1));

        let market_data_terminal =
            vibe_market_data_repair_custody::issue_market_data_repair_terminal_v1(
                sealed_market_data_request,
                market_data_evidence.into_repaired_terminal(),
            )
            .expect("Owner-sealed repaired Market Data terminal");
        let repair_resolution =
            crate::market_data_repair_resolution::resolve_market_data_repair_terminal_v1(
                &first,
                &first_action,
                &first_market_data,
                market_data_terminal,
            )
            .expect("R&D repaired resolution");
        let repair_resolution =
            crate::market_data_repair_resolution_postgres::commit(rd_pool, repair_resolution)
                .await
                .expect("R&D repaired resolution custody");
        assert_eq!(
            repair_resolution.resolution().disposition(),
            crate::market_data_repair_resolution::MarketDataRepairResolutionDispositionV1::Repaired
        );
        let repaired = repair_resolution
            .resolution()
            .repaired()
            .expect("repaired PIT coordinates");
        let repaired_snapshot_identity = repaired.snapshot_identity();
        let repaired_normalized_records_digest = repaired.normalized_records_digest();
        let repair_resolution_counts: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_market_data_repair_resolutions_v1 WHERE repair_request_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='MARKET_DATA_REPAIR_RESOLVED_V1')",
        )
        .bind(first_market_data.request().request_identity())
        .bind(repair_resolution.resolution().resolution_identity())
        .fetch_one(rd_pool)
        .await
        .expect("R&D repaired resolution custody counts");
        assert_eq!(repair_resolution_counts, (1, 1));

        let predecessor_locator = predecessor.locator();
        let successor =
            crate::exploratory_replay::postgres::commit_market_data_repaired_by_locator_v2(
                rd_pool,
                &predecessor_locator,
                &crate::MarketDataRepairResolutionLocatorV1 {
                    resolution_identity: repair_resolution
                        .resolution()
                        .resolution_identity()
                        .to_string(),
                    repair_request_identity: first_market_data
                        .request()
                        .request_identity()
                        .to_string(),
                },
            )
            .await
            .expect("locator-only repaired Replay successor commit");
        let successor_request: ReplayRequestDtoV2 =
            serde_json::from_slice(successor.canonical_request_bytes())
                .expect("canonical successor Replay request");
        let mut expected_successor = predecessor.request().as_dto().clone();
        expected_successor.request_identity = successor_request.request_identity.clone();
        expected_successor.pit_snapshot = successor_request.pit_snapshot.clone();
        assert_eq!(successor_request, expected_successor);
        assert_ne!(
            successor_request.request_identity,
            predecessor.request().as_dto().request_identity
        );
        assert_eq!(
            successor_request.pit_snapshot.identity.as_str(),
            format!("sha256:{}", hex(repaired_snapshot_identity.as_bytes()))
        );
        assert_eq!(
            successor_request.pit_snapshot.digest.as_str(),
            format!(
                "sha256:{}",
                hex(repaired_normalized_records_digest.as_bytes())
            )
        );
        let stored_predecessor: serde_json::Value = sqlx::query_scalar(
            "SELECT frozen_json->'market_data_repair_reentry'->'predecessor_replay' FROM rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1",
        )
        .bind(successor.locator().request_identity.as_str())
        .fetch_one(rd_pool)
        .await
        .expect("successor predecessor binding");
        assert_eq!(
            stored_predecessor,
            serde_json::to_value(&predecessor_locator).expect("predecessor locator JSON")
        );
        let successor_readback = replay_owner
            .resolve_exploratory_replay_request_v2(&ExploratoryReplayRecoverySelectorV2 {
                request_identity: successor.locator().request_identity.clone(),
                meaning_digest: successor.locator().meaning_digest.clone(),
            })
            .await
            .expect("successor Replay resolve")
            .readback()
            .expect("persisted successor Replay readback")
            .clone();
        assert_eq!(successor_readback.locator(), successor.locator().clone());
        assert_eq!(
            successor_readback.canonical_request_bytes(),
            successor.canonical_request_bytes()
        );

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
            "SELECT (SELECT COUNT(*) FROM rd_repair_action_requests_v1 WHERE decision_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='REPAIR_ACTION_REQUESTED_V1')",
        )
        .bind(first.decision().decision_identity())
        .bind(first_action.request().action_request_identity())
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
            "SELECT (SELECT COUNT(*) FROM rd_iteration_decisions_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='ITERATION_DECISION_COMMITTED_V1')",
        )
        .bind(first.receipt().result_identity())
        .bind(first.decision().decision_identity())
        .fetch_one(rd_pool)
        .await
        .expect("post-rejection counts");
        assert_eq!(counts_after, (1, 1));
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D and Backtest Owner PostgreSQL topology"]
    async fn successor_artifact_enters_exploratory_replay_with_exact_owner_custody() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let mutation = database.mutation();
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let suffix = unique_suffix();
        let committed_at = current_epoch_ms().expect("test clock");
        let market_data_evidence =
            issue_market_data_repair_evidence_v1().expect("sealed Market Data evidence");
        let harness = Box::pin(persist_repair_replay_predecessor(
            &database,
            &market_data_evidence,
            &suffix,
        ))
        .await;
        let initial_replay = harness.predecessor.request();
        let request_identity = harness.predecessor.request_identity().to_string();
        let request_digest = harness.predecessor.meaning_digest().to_string();
        let attempt_identity = format!("backtest-attempt-successor-{suffix}");
        let result = positive_result(
            &request_identity,
            &request_digest,
            &attempt_identity,
            &harness.intent_identity,
            &harness.intent_digest,
            &suffix,
        );
        let result_identity = result.result_identity.as_str().to_string();
        let result_digest = result.result_digest.as_str().to_string();
        let candidate_identity = format!("successor-experiment-{suffix}");
        let candidate_experiment = IterationExperimentModeV1::SingleDimension {
            changed_dimension: IterationHypothesisDimensionV1::ReturnMechanism,
        };
        let candidate_set: TrialFamilyCandidateSetProposalV2 =
            serde_json::from_value(serde_json::json!({
                "generation_rule_identity": format!("successor-generation-rule-{suffix}"),
                "generation_rule_digest": digest('c'),
                "expected_cardinality": 1,
                "candidates": [{
                    "candidate_identity": candidate_identity,
                    "experiment": candidate_experiment,
                }],
            }))
            .expect("candidate-set fixture");
        let mut family_transaction = rd_pool.begin().await.expect("family transaction");
        append_trial_family_attempt_in_transaction(
            &mut family_transaction,
            &harness.intent_identity,
            &harness.research_receipt_identity,
            TrialFamilyAttemptAppendV2 {
                intent_identity: harness.intent_identity.clone(),
                intent_digest: harness.intent_digest.clone(),
                request_identity: request_identity.clone(),
                request_digest: request_digest.clone(),
                result_identity: result_identity.clone(),
                result_digest: result_digest.clone(),
                terminal_disposition: TrialFamilyAttemptTerminalDispositionV2::TerminalResult,
                consumed_trial_budget: 1,
                candidate_set,
            },
            committed_at + 1,
        )
        .await
        .expect("terminal attempt census");
        family_transaction.commit().await.expect("family commit");

        let mut census_transaction = rd_pool.begin().await.expect("census transaction");
        let census = load_trial_family_census_v2_by_family_in_transaction(
            &mut census_transaction,
            &harness.family_identity,
        )
        .await
        .expect("candidate frontier census");
        census_transaction.commit().await.expect("census commit");
        let composition = CandidateComparisonCompositionRequestV1 {
            trial_family_identity: harness.family_identity.clone(),
            result_identity: result_identity.clone(),
            request_identity: request_identity.clone(),
            attempt_identity,
            candidate_evaluations: successor_candidate_evaluations(&census, &candidate_identity),
        };
        let issued =
            crate::iteration_decision::tests::candidate_comparison_storage_acceptance_fixture_v1(
                &census,
                &result,
                composition.candidate_evaluations.clone(),
                committed_at + 2,
            )
            .expect("sealed predecessor Decision fixture");
        let mut decision_transaction = rd_pool.begin().await.expect("Decision transaction");
        persist_candidate_comparison_decision(&mut decision_transaction, &issued)
            .await
            .expect("persisted predecessor Decision");
        let decision = load_candidate_comparison_by_result_in_transaction(
            &mut decision_transaction,
            &census,
            &result_identity,
            Some(&composition),
        )
        .await
        .expect("predecessor Decision custody")
        .expect("predecessor Decision readback");
        assert_eq!(decision, issued);
        decision_transaction
            .commit()
            .await
            .expect("Decision commit");
        let successor_operation = SuccessorResearchIntentOperationRequestV1 {
            request_identity: format!("successor-intent-request-{suffix}"),
            decision_identity: decision.decision().decision_identity().to_string(),
            result_identity,
            goal: UnsourcedResearchGoalV1 {
                hypothesis: "PIT momentum with a volatility-conditioned return mechanism"
                    .to_string(),
                mechanism: "bounded information diffusion".to_string(),
                falsification_question: "does exact cost remove the effect".to_string(),
                expected_observation: "net continuation remains positive".to_string(),
                required_data: vec!["PIT bars".to_string()],
                cost_assumption: "frozen cost model".to_string(),
                capacity_assumption: "frozen capacity model".to_string(),
            },
        };
        let successor_admission = harness
            .edge
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: successor_operation.request_identity.clone(),
                typed_payload: serde_json::to_value(&successor_operation)
                    .expect("successor typed payload"),
                operation: SUCCESSOR_RESEARCH_INTENT_OPERATION_V1.to_string(),
                operation_schema: SUCCESSOR_RESEARCH_INTENT_SCHEMA_V1.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects: vec![SUCCESSOR_RESEARCH_INTENT_MUTATION_EFFECT_V1.to_string()],
                request_proof_digest: harness.request_proof_digest.clone(),
                audit_correlation: format!("test:{}", successor_operation.request_identity),
            })
            .await
            .expect("successor Product Edge admission")
            .locator()
            .clone();
        let rejected = crate::successor_intent_postgres::compose_successor_research_intent_v1(
            rd_pool,
            successor_operation
                .clone()
                .with_admission(placeholder_product_edge_admission(
                    &successor_operation.request_identity,
                )),
        )
        .await;
        assert!(rejected.is_err());
        let counts_after_rejection: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_successor_research_intents_v1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind='SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1')",
        )
        .fetch_one(rd_pool)
        .await
        .expect("successor rejection counts");
        assert_eq!(counts_after_rejection, (0, 0));
        let successor = crate::successor_intent_postgres::compose_successor_research_intent_v1(
            rd_pool,
            successor_operation
                .clone()
                .with_admission(successor_admission.clone()),
        )
        .await
        .expect("successor Intent custody");
        let retry = crate::successor_intent_postgres::compose_successor_research_intent_v1(
            rd_pool,
            successor_operation.with_admission(successor_admission),
        )
        .await
        .expect("exact successor retry");
        assert_eq!(retry, successor);
        let counts_after_retry: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_successor_research_intents_v1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind='SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1')",
        )
        .fetch_one(rd_pool)
        .await
        .expect("successor retry counts");
        assert_eq!(counts_after_retry, (1, 1));
        assert_eq!(
            successor.intent().predecessor_intent_identity(),
            harness.intent_identity
        );
        let _frozen_bfp =
            assert_successor_bounded_feature_program_freeze(rd_pool, &successor).await;

        let mut first_successor_consumer = rd_pool
            .begin()
            .await
            .expect("first successor consumer transaction");
        crate::rd_owner_postgres_custody::VerifiedAttemptCustodyV1::admit_develop_intent_in_transaction(
            &mut first_successor_consumer,
            successor.intent().intent_identity(),
            true,
        )
        .await
        .expect("first successor custody lock")
        .expect("first successor custody");
        let mut competing_successor_consumer = rd_pool
            .begin()
            .await
            .expect("competing successor consumer transaction");
        sqlx::query("SET LOCAL lock_timeout = '100ms'")
            .execute(&mut *competing_successor_consumer)
            .await
            .expect("bounded competing lock wait");
        let competing = match
            crate::rd_owner_postgres_custody::VerifiedAttemptCustodyV1::admit_develop_intent_in_transaction(
                &mut competing_successor_consumer,
                successor.intent().intent_identity(),
                true,
            )
            .await
        {
            Err(e) => e,
            Ok(_) => panic!("successor custody must serialize before later attempt locks"),
        };
        assert!(competing.to_string().contains("lock timeout"));
        competing_successor_consumer
            .rollback()
            .await
            .expect("competing successor consumer rollback");
        first_successor_consumer
            .rollback()
            .await
            .expect("first successor consumer rollback");

        let mut successor_retry = rd_pool
            .begin()
            .await
            .expect("successor custody retry transaction");
        crate::rd_owner_postgres_custody::VerifiedAttemptCustodyV1::admit_develop_intent_in_transaction(
            &mut successor_retry,
            successor.intent().intent_identity(),
            true,
        )
        .await
        .expect("successor custody retry after lock release")
        .expect("successor custody retry");
        successor_retry
            .rollback()
            .await
            .expect("successor custody retry rollback");
        #[cfg(feature = "sealed-source-intake-composer-acceptance")]
        {
            let mut composer_transaction = rd_pool.begin().await.expect("Composer transaction");
            let successor_research = crate::successor_research_custody_postgres_v1::lock_successor_research_for_intent_in_transaction_v1(
                    &mut composer_transaction,
                    successor.intent().intent_identity(),
                    successor.intent().frozen_at_epoch_ms(),
                )
                .await
                .expect("successor Develop custody");
            composer_transaction
                .rollback()
                .await
                .expect("Composer rollback");
            assert_eq!(
                successor_research.request_locator(),
                successor.intent().intent_identity()
            );
            assert_eq!(
                successor_research.falsifier(),
                successor.intent().goal().falsification_question
            );

            let composer = crate::source_research_composer_postgres_v2::SealedPostgresSourceResearchComposerV2::connect(
                database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .expect("successor Develop Composer");
            let projection = composer
                .request_projection(successor.intent().intent_identity())
                .await
                .expect("successor Composer request projection");
            assert_eq!(
                projection.research_request_locator,
                successor.intent().intent_identity()
            );
            let composed_v3 = composer
                .run_bfp_v3(successor.intent().intent_identity())
                .await
                .expect("successor BFP V3 Composer RUN");
            assert_eq!(
                composed_v3.disposition,
                crate::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::Success
            );
            assert_ne!(composed_v3.request_identity, projection.request_identity);
            let retried_v3 = composer
                .run_bfp_v3(successor.intent().intent_identity())
                .await
                .expect("successor BFP V3 Composer retry");
            assert_eq!(retried_v3.canonical_bytes(), composed_v3.canonical_bytes());
            let resolved_v3 = composer
                .resolve(&composed_v3.request_identity)
                .await
                .expect("successor BFP V3 Composer RESOLVE");
            assert_eq!(resolved_v3.canonical_bytes(), composed_v3.canonical_bytes());

            let sealed_locator = crate::develop_composer_postgres_v2::DevelopComposerSealedReadLocatorV2::from_accepted_response(&composed_v3)
                .expect("successor BFP V3 sealed locator");
            let sealed = crate::develop_composer_postgres_v2::DevelopComposerSealedReadPortV2::read_accepted(
                &composer,
                &sealed_locator,
            )
            .await
            .expect("successor BFP V3 sealed readback");
            assert_eq!(sealed.build_receipt_tags(), &[3]);

            let fresh_composer = crate::source_research_composer_postgres_v2::SealedPostgresSourceResearchComposerV2::connect(
                database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .expect("fresh successor BFP V3 Composer");
            let fresh_resolved = fresh_composer
                .resolve(&composed_v3.request_identity)
                .await
                .expect("fresh successor BFP V3 Composer RESOLVE");
            assert_eq!(
                fresh_resolved.canonical_bytes(),
                composed_v3.canonical_bytes()
            );

            sqlx::query(
                "UPDATE rd_bounded_feature_program_freezes_v1
                    SET program_bytes=program_bytes || decode('00','hex')
                  WHERE request_identity=$1",
            )
            .bind(successor.intent().intent_identity())
            .execute(rd_pool)
            .await
            .expect("commit successor BFP tamper");
            let unavailable = fresh_composer
                .resolve(&composed_v3.request_identity)
                .await
                .expect("tampered successor BFP V3 RESOLVE");
            assert_eq!(
                unavailable.disposition,
                crate::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::Unavailable
            );
            sqlx::query(
                "UPDATE rd_bounded_feature_program_freezes_v1
                    SET program_bytes=$2
                  WHERE request_identity=$1",
            )
            .bind(successor.intent().intent_identity())
            .bind(_frozen_bfp.program_bytes())
            .execute(rd_pool)
            .await
            .expect("restore successor BFP bytes");
            let restored = fresh_composer
                .resolve(&composed_v3.request_identity)
                .await
                .expect("restored successor BFP V3 RESOLVE");
            assert_eq!(restored.canonical_bytes(), composed_v3.canonical_bytes());
        }

        let successor_replay = persist_successor_artifact_replay(
            &database,
            &harness,
            &successor,
            initial_replay.as_dto(),
            &suffix,
        )
        .await;
        assert_eq!(
            successor_replay
                .request()
                .as_dto()
                .frozen_research_intent
                .identity
                .as_str(),
            successor.intent().intent_identity()
        );
        assert_eq!(
            successor_replay
                .request()
                .as_dto()
                .frozen_research_intent
                .digest
                .as_str(),
            successor.intent().intent_digest()
        );
    }

    async fn assert_successor_bounded_feature_program_freeze(
        rd_pool: &sqlx::PgPool,
        successor: &crate::successor_intent::SuccessorResearchIntentReadbackV1,
    ) -> crate::rd_bounded_feature_program_v1::FrozenResearchBoundedFeatureProgramV1 {
        let intent = successor.intent();
        let read_cut = intent.frozen_at_epoch_ms();
        let mut custody_transaction = rd_pool.begin().await.expect("BFP custody transaction");
        let custody = crate::successor_research_custody_postgres_v1::lock_successor_research_for_intent_in_transaction_v1(
            &mut custody_transaction,
            intent.intent_identity(),
            read_cut,
        )
        .await
        .expect("successor BFP Research custody");
        custody_transaction
            .rollback()
            .await
            .expect("BFP custody rollback");

        let (mut design, mut proposal) = crate::bounded_feature_program_v1::tests::candidate();
        let plugin_semantic_id = proposal.plugin_semantic_id.clone();
        design
            .plugins
            .retain(|plugin| plugin.semantic_id == plugin_semantic_id);

        for reaction in &mut design.reactions {
            reaction
                .nodes
                .retain(|node| node.plugin_semantic_id == plugin_semantic_id);
            if reaction.kind != crate::strategy_design_v2::LifecycleKindV2::Bar {
                reaction.nodes.clear();
            }

            if reaction.nodes.is_empty() {
                reaction.state_writes.clear();
                reaction.proposal = None;
            }
        }
        design.parameters.clear();
        let retained_state_ids = design
            .reactions
            .iter()
            .flat_map(|reaction| reaction.state_writes.iter())
            .map(|write| write.state_id.as_str())
            .collect::<Vec<_>>();
        design
            .state
            .retain(|state| retained_state_ids.contains(&state.semantic_id.as_str()));
        design.resources.max_state_bytes = design.state.iter().map(|state| state.max_bytes).sum();
        design.research_request_identity = custody.research_request_identity();
        design.intent_identity = custody.intent_identity();
        design.intent_digest = custody.intent_digest();
        design.falsifier = custody.falsifier().to_owned();
        let prepared = crate::strategy_plan_v2::prepare_strategy_design_v2(&design);
        let (design_identity, design_digest) = match prepared {
            crate::strategy_plan_v2::StrategyDesignPreparationV2::Prepared {
                design_identity,
                design_digest,
            } => (design_identity, design_digest),
            other => panic!("successor BFP Design must prepare: {other:?}"),
        };
        proposal.research_request_identity = design.research_request_identity;
        proposal.intent_identity = design.intent_identity;
        proposal.intent_digest = design.intent_digest;
        proposal.design_identity = design_identity;
        proposal.design_digest = design_digest;
        let market = vibe_data::owner::pit_snapshot::sealed_acceptance::issue_strategy_input_exact_instrument_bar_frame_for_owner_lineage(
            design.research_request_identity,
            design_identity,
        )
        .expect("successor BFP exact Market Data authority");
        let input_role_identity =
            crate::strategy_plan_v2::strategy_input_role_identity_v2(&design.inputs[0]);
        let binding = market
            .bindings()
            .iter()
            .find(|receipt| receipt.locator().input_role_identity() == input_role_identity)
            .expect("successor BFP exact input binding");
        proposal.inputs[0].static_binding_receipt_digest = binding.digest();
        let admitted = (design.clone(), proposal.clone());

        let mut rejected_design = design.clone();
        rejected_design.intent_digest = BindingDigest::from_untrusted_bytes([99; 32]);
        let mut rejected = rd_pool.begin().await.expect("rejected BFP transaction");
        assert_eq!(
            Box::pin(
                crate::rd_bounded_feature_program_v1::commit_research_bounded_feature_program_in_transaction_v1(
                    &mut rejected,
                    intent.intent_identity(),
                    read_cut,
                    read_cut.saturating_add(1),
                    &rejected_design,
                    proposal.clone()
),
            )
            .await,
            Err(crate::rd_bounded_feature_program_v1::ResearchBoundedFeatureProgramFreezeErrorV1::ResearchCustody)
        );
        rejected.rollback().await.expect("rejected BFP rollback");
        let rejected_counts: (i64, i64) = sqlx::query_as(
            "SELECT
                (SELECT COUNT(*) FROM rd_bounded_feature_program_freezes_v1 WHERE request_identity=$1),
                (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2)",
        )
        .bind(intent.intent_identity())
        .bind(crate::rd_bounded_feature_program_v1::JOINT_FREEZE_EVENT_KIND_V1)
        .fetch_one(rd_pool)
        .await
        .expect("rejected successor BFP counts");
        assert_eq!(rejected_counts, (0, 0));

        let committed_at = read_cut.saturating_add(1);
        let mut first = rd_pool.begin().await.expect("successor BFP transaction");
        let committed = Box::pin(
            crate::rd_bounded_feature_program_v1::commit_research_bounded_feature_program_in_transaction_v1(
                &mut first,
                intent.intent_identity(),
                read_cut,
                committed_at,
                &design,
                proposal.clone()
),
        )
        .await
        .expect("successor BFP freeze");
        first.commit().await.expect("successor BFP commit");
        assert_eq!(committed.intent_identity(), custody.intent_identity());
        assert_eq!(
            committed.research_custody_digest(),
            custody.custody_digest()
        );

        let mut retry = rd_pool.begin().await.expect("successor BFP retry");
        let retried = Box::pin(
            crate::rd_bounded_feature_program_v1::commit_research_bounded_feature_program_in_transaction_v1(
                &mut retry,
                intent.intent_identity(),
                read_cut,
                committed_at,
                &design,
                proposal
),
        )
        .await
        .expect("exact successor BFP retry");
        assert_eq!(retried, committed);
        retry.commit().await.expect("successor BFP retry commit");

        let committed_counts: (i64, i64) = sqlx::query_as(
            "SELECT
                (SELECT COUNT(*) FROM rd_bounded_feature_program_freezes_v1 WHERE request_identity=$1),
                (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2)",
        )
        .bind(intent.intent_identity())
        .bind(crate::rd_bounded_feature_program_v1::JOINT_FREEZE_EVENT_KIND_V1)
        .fetch_one(rd_pool)
        .await
        .expect("committed successor BFP counts");
        assert_eq!(committed_counts, (1, 1));
        assert_permanent_freeze_refuses_a_second_meaning(
            rd_pool,
            intent.intent_identity(),
            read_cut,
            committed_at,
            admitted,
        )
        .await;

        let mut readback = rd_pool.begin().await.expect("successor BFP readback");
        let resolved = Box::pin(
            crate::rd_bounded_feature_program_v1::read_research_bounded_feature_program_in_transaction_v1(
                &mut readback,
                intent.intent_identity(),
                read_cut
),
        )
        .await
        .expect("successor BFP readback");
        assert_eq!(resolved, committed);
        readback
            .rollback()
            .await
            .expect("successor BFP readback rollback");

        let mut tampered = rd_pool.begin().await.expect("successor BFP tamper");
        sqlx::query(
            "UPDATE rd_bounded_feature_program_freezes_v1
                SET program_bytes=program_bytes || decode('00','hex')
              WHERE request_identity=$1",
        )
        .bind(intent.intent_identity())
        .execute(&mut *tampered)
        .await
        .expect("tamper successor BFP bytes");
        assert_eq!(
            Box::pin(
                crate::rd_bounded_feature_program_v1::read_research_bounded_feature_program_in_transaction_v1(
                    &mut tampered,
                    intent.intent_identity(),
                    read_cut
),
            )
            .await,
            Err(crate::rd_bounded_feature_program_v1::ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)
        );
        tampered
            .rollback()
            .await
            .expect("successor BFP tamper rollback");
        committed
    }

    /// A freeze is permanent, so the two ways a caller can lose a Research identity must both fail
    /// before any custody is written.
    ///
    /// The enclosing assertion already proves that an exact repeat joins and that tampered stored
    /// bytes are refused. Neither covers a *valid* second declaration that simply means something
    /// else, nor a program naming an SDK source the first-party lowerer will never accept, which
    /// would freeze successfully and then be un-lowerable forever.
    async fn assert_permanent_freeze_refuses_a_second_meaning(
        rd_pool: &sqlx::PgPool,
        request_locator: &str,
        read_cut: u64,
        committed_at: u64,
        admitted: (
            crate::strategy_design_v2::StrategyDesignV2,
            crate::bounded_feature_program_v1::BoundedFeatureProgramProposalV1,
        ),
    ) {
        use crate::rd_bounded_feature_program_v1::{
            ResearchBoundedFeatureProgramFreezeErrorV1,
            commit_research_bounded_feature_program_in_transaction_v1,
        };

        let counts = |pool: sqlx::PgPool, key: String| async move {
            sqlx::query_as::<_, (i64, i64)>(
                "SELECT
                    (SELECT COUNT(*) FROM rd_bounded_feature_program_freezes_v1 WHERE request_identity=$1),
                    (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2)",
            )
            .bind(key)
            .bind(crate::rd_bounded_feature_program_v1::JOINT_FREEZE_EVENT_KIND_V1)
            .fetch_one(&pool)
            .await
            .expect("permanent freeze counts")
        };
        let before = counts(rd_pool.clone(), request_locator.to_owned()).await;
        assert_eq!(before, (1, 1));

        // A different entry threshold is a real change of program meaning, not a tamper. The Owner
        // must refuse to update rather than accept the newer declaration.
        let (design, proposal) = admitted;
        let mut changed = proposal.clone();
        let threshold = changed
            .constants
            .iter_mut()
            .find(|constant| constant.constant_id == "threshold")
            .expect("fixture threshold constant");
        match &mut threshold.value {
            crate::bounded_feature_program_v1::BoundedFeatureConstantValueV1::FixedI128 {
                coefficient,
                ..
            } => *coefficient += 1,
            other => panic!("fixture threshold must be fixed-I128: {other:?}"),
        }
        let mut conflicting = rd_pool.begin().await.expect("changed-meaning transaction");
        assert_eq!(
            Box::pin(commit_research_bounded_feature_program_in_transaction_v1(
                &mut conflicting,
                request_locator,
                read_cut,
                committed_at,
                &design,
                changed,
            ))
            .await,
            Err(ResearchBoundedFeatureProgramFreezeErrorV1::Conflict)
        );
        conflicting
            .rollback()
            .await
            .expect("changed-meaning rollback");
        assert_eq!(
            counts(rd_pool.clone(), request_locator.to_owned()).await,
            before,
            "a changed declaration writes nothing"
        );

        // A program naming a foreign SDK source is refused at admission rather than frozen into a
        // permanently un-lowerable state.
        let mut foreign = proposal;
        foreign.first_party_sdk_source_digest = BindingDigest::from_untrusted_bytes([7; 32]);
        let mut rejected = rd_pool.begin().await.expect("foreign SDK transaction");
        assert_eq!(
            Box::pin(commit_research_bounded_feature_program_in_transaction_v1(
                &mut rejected,
                request_locator,
                read_cut,
                committed_at,
                &design,
                foreign,
            ))
            .await,
            Err(ResearchBoundedFeatureProgramFreezeErrorV1::SdkSource)
        );
        rejected.rollback().await.expect("foreign SDK rollback");
        assert_eq!(
            counts(rd_pool.clone(), request_locator.to_owned()).await,
            before,
            "a foreign SDK declaration writes nothing"
        );
    }

    async fn persist_successor_artifact_replay(
        database: &CanonicalOwnerPostgresTestDatabaseV1,
        harness: &PersistedReplayPredecessorV1,
        successor: &crate::successor_intent::SuccessorResearchIntentReadbackV1,
        initial_replay: &ReplayRequestDtoV2,
        suffix: &str,
    ) -> SealedExploratoryReplayReadbackV2 {
        let intent = successor.intent();
        let build_request_identity = format!("successor-artifact-request-{suffix}");
        let attempt_identity = format!("successor-artifact-attempt-{suffix}");
        let artifact_payload = ArtifactBuildRequestV1 {
            build_request_identity: build_request_identity.clone(),
            attempt_identity: attempt_identity.clone(),
            intent_identity: intent.intent_identity().to_string(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: placeholder_product_edge_admission(&build_request_identity),
        };
        let artifact_admission = harness
            .edge
            .admit_artifact_build_request(ProductEdgeAdmissionRequestV1 {
                request_identity: build_request_identity.clone(),
                typed_payload: serde_json::json!({
                    "build_request_identity": artifact_payload.build_request_identity,
                    "attempt_identity": artifact_payload.attempt_identity,
                    "intent_identity": artifact_payload.intent_identity,
                    "channel": artifact_payload.channel,
                }),
                operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
                operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects: vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                ],
                request_proof_digest: harness.request_proof_digest.clone(),
                audit_correlation: format!("test:{build_request_identity}"),
            })
            .await
            .expect("successor Artifact Product Edge admission")
            .locator()
            .clone();
        let build_request = ArtifactBuildRequestV1 {
            admission: artifact_admission,
            ..artifact_payload
        };
        let sandbox_socket = format!("/tmp/rd-successor-replay-{suffix}.sock");
        let _ = std::fs::remove_file(&sandbox_socket);
        let listener = UnixListener::bind(&sandbox_socket).expect("Artifact sandbox listener");
        let sandbox = tokio::spawn(serve_repair_replay_sandbox(
            listener,
            sandbox_socket.clone(),
        ));
        let artifact_owner = PostgresArtifactBuildOwnerV1::connect(
            database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            &sandbox_socket,
            u64::MAX,
        )
        .await
        .expect("successor Artifact Owner");
        assert_eq!(
            artifact_owner
                .prepare(build_request.clone())
                .await
                .expect("prepared successor Artifact")
                .resolution(),
            ArtifactBuildResolution::Prepared
        );
        let invocation_claim = harness
            .edge
            .claim_provider_invocation(ProductEdgeInvocationClaimRequestV1 {
                admission: build_request.admission.clone(),
                attempt_identity: attempt_identity.clone(),
            })
            .await
            .expect("successor Product Edge invocation claim");
        let reserved = artifact_owner
            .reserve_provider_invocation_custody(
                &build_request_identity,
                &attempt_identity,
                invocation_claim,
            )
            .await
            .expect("successor R&D invocation reservation");
        let (start, _) = reserved.into_parts();
        harness
            .edge
            .start_provider_invocation(start)
            .await
            .expect("successor Product Edge invocation start");
        let started_claim = harness
            .edge
            .resolve_provider_invocation_claim(&build_request.admission, &attempt_identity)
            .await
            .expect("successor Product Edge invocation resolve")
            .expect("started successor Product Edge invocation");
        let terminal = artifact_owner
            .submit_candidate(
                build_request,
                ArtifactBuildCandidateV1 {
                    schema_version: 1,
                    candidate_identity: format!("agent-program-candidate-v1-successor-{suffix}"),
                    intent_identity: intent.intent_identity().to_string(),
                    intent_semantic_digest: intent.intent_digest().to_string(),
                    logic: GeneratedStrategyLogicV1 {
                        signal: GeneratedSignalV1::Momentum,
                        direction: GeneratedDirectionV1::LongOnly,
                        lookback_bars: 48,
                        entry_threshold_bps: 60,
                        exit_threshold_bps: 15,
                    },
                    structured_logic_summary: "bounded successor Replay candidate".to_string(),
                    agent_change_explanation: "test-only deterministic successor Artifact"
                        .to_string(),
                },
                Some(&started_claim),
            )
            .await
            .expect("persisted successor Artifact acceptance");
        sandbox
            .await
            .expect("successor Artifact sandbox task")
            .expect("successor Artifact sandbox response");
        let artifact_receipt = terminal
            .owner_receipt()
            .expect("successor Artifact receipt");
        assert_eq!(
            artifact_receipt.disposition,
            ArtifactBuildDisposition::Success
        );
        let artifact_identity = artifact_receipt
            .artifact_identity
            .as_deref()
            .expect("successor Artifact identity");
        let build_receipt_identity = artifact_receipt
            .build_receipt_identity
            .as_deref()
            .expect("successor Artifact build receipt");
        let artifact_review = terminal
            .artifact_review()
            .expect("successor Artifact review");
        let artifact_family = terminal
            .artifact_trial_family()
            .expect("successor Artifact family");
        let family = artifact_family.trial_family();

        let replay_identity = format!("rd-replay-request-successor-{suffix}");
        let mut replay_request = initial_replay.clone();
        replay_request.request_identity = identity(&replay_identity);
        replay_request.frozen_research_intent = ContentIdentityV2 {
            identity: identity(intent.intent_identity()),
            digest: CanonicalDigestV2::try_from(intent.intent_digest().to_string())
                .expect("successor Intent digest"),
        };
        replay_request.trial_family = ContentIdentityV2 {
            identity: identity(family.root().trial_family_identity()),
            digest: CanonicalDigestV2::try_from(family.root().root_digest().to_string())
                .expect("family root digest"),
        };
        replay_request.trial_family_census_frontier = ContentIdentityV2 {
            identity: identity(intent.census_frontier_identity()),
            digest: CanonicalDigestV2::try_from(intent.census_frontier_digest().to_string())
                .expect("successor census frontier digest"),
        };
        replay_request.artifact = ContentIdentityV2 {
            identity: identity(artifact_identity),
            digest: CanonicalDigestV2::try_from(artifact_review.build_receipt.wasm_digest.clone())
                .expect("successor Artifact digest"),
        };
        let mut proposal = ExploratoryReplayRequestProposalV2 {
            admission: placeholder_product_edge_admission(&replay_identity),
            build_request_identity,
            attempt_identity,
            build_receipt_identity: build_receipt_identity.to_string(),
            artifact_family_binding_identity: artifact_family
                .binding()
                .binding_identity()
                .to_string(),
            request: replay_request,
        };
        let replay_admission = harness
            .edge
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: replay_identity.clone(),
                typed_payload: exploratory_replay_admission_payload_v2(&proposal)
                    .expect("successor Replay admission payload"),
                operation: EXPLORATORY_REPLAY_OPERATION_V2.to_string(),
                operation_schema: EXPLORATORY_REPLAY_SCHEMA_V2.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects: vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V2.to_string()],
                request_proof_digest: harness.request_proof_digest.clone(),
                audit_correlation: format!("test:{replay_identity}"),
            })
            .await
            .expect("successor Replay Product Edge admission")
            .locator()
            .clone();
        proposal.admission = replay_admission;
        let committed = harness
            .owner
            .commit_exploratory_replay_request_v2(proposal)
            .await
            .expect("persisted successor Replay V2");
        harness
            .owner
            .resolve_exploratory_replay_request_v2(&ExploratoryReplayRecoverySelectorV2 {
                request_identity: committed.locator().request_identity.clone(),
                meaning_digest: committed.locator().meaning_digest.clone(),
            })
            .await
            .expect("successor Replay V2 resolve")
            .readback()
            .expect("persisted successor Replay V2 readback")
            .clone()
    }

    fn successor_candidate_evaluations(
        census: &TrialFamilyCensusReadbackV2,
        candidate_identity: &str,
    ) -> IterationCandidateEvaluationSetV1 {
        let candidate = census
            .candidate_set_frontier
            .candidates()
            .iter()
            .find(|candidate| candidate.candidate_identity() == candidate_identity)
            .expect("candidate is present in exact Owner Census readback");
        let reference = |name: &str, byte: char| IterationEvidenceReferenceV1 {
            identity: format!("{name}-{candidate_identity}"),
            digest: digest(byte),
        };
        let policy = census.decision_policy_v1().expect("Decision policy");
        IterationCandidateEvaluationSetV1 {
            frontier_identity: census
                .candidate_set_frontier
                .frontier_identity()
                .to_string(),
            frontier_digest: census.candidate_set_frontier.frontier_digest().to_string(),
            generation_rule_identity: census
                .candidate_set_frontier
                .generation_rule_identity()
                .to_string(),
            generation_rule_digest: census
                .candidate_set_frontier
                .generation_rule_digest()
                .to_string(),
            expected_cardinality: 1,
            threshold: IterationEvidenceReferenceV1 {
                identity: policy.information_value_threshold_identity().to_string(),
                digest: format!(
                    "sha256:{}",
                    policy
                        .information_value_threshold_digest()
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>()
                ),
            },
            candidates: vec![IterationCandidateEvaluationV1 {
                candidate_identity: candidate_identity.to_string(),
                candidate_digest: candidate.candidate_digest().to_string(),
                admissibility: IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold,
                information_value: IterationInformationValueEvidenceV1 {
                    decision_uncertainty: reference("decision-uncertainty", '1'),
                    distinguishing_observation_or_falsifier: reference(
                        "distinguishing-falsifier",
                        '2',
                    ),
                    result_to_action_map: reference("result-action-map", '3'),
                    bounded_acquisition_cost: reference("bounded-cost", '4'),
                    remaining_family_budget_effect: reference("budget-effect", '5'),
                    competing_alternatives: vec![reference("alternative", '6')],
                    ordinal_rationale: reference("ordinal-rationale", '7'),
                },
                uncertainty_reduction_rank: 1,
                tie_break_key: candidate_identity.to_string(),
                experiment: IterationExperimentModeV1::SingleDimension {
                    changed_dimension: IterationHypothesisDimensionV1::ReturnMechanism,
                },
            }],
        }
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D and Backtest Owner PostgreSQL topology"]
    async fn positive_assessment_ready_decision_commit_retry_resolve_and_tamper_are_atomic() {
        // Keep each phase independently pinned: one aggregate scenario future exhausts the Linux
        // test thread stack while its nested READY futures are constructed and polled.
        let harness = Box::pin(prepare_ready_decision_postgres_harness()).await;
        Box::pin(assert_ready_retry_resolve_and_qualification(&harness)).await;
        Box::pin(assert_ready_tamper_closure(&harness)).await;
    }

    async fn prepare_ready_decision_postgres_harness() -> Box<ReadyDecisionPostgresHarnessV1> {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let mutation = database.mutation();
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
        let suffix = unique_suffix();
        let market_data_evidence =
            issue_market_data_repair_evidence_v1().expect("sealed Market Data evidence");
        let PersistedReplayPredecessorV1 {
            predecessor,
            intent_identity,
            intent_digest,
            family_identity,
            family_policy,
            independence_basis_locator,
            research_receipt_identity,
            ..
        } = Box::pin(persist_repair_replay_predecessor(
            &database,
            &market_data_evidence,
            &suffix,
        ))
        .await;
        let qualification = PostgresQualificationOwnerV1::connect(
            database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .expect("Qualification Owner projection custody");
        let protected_feedback = qualification
            .resolve_or_create_for_basis(&independence_basis_locator)
            .await
            .expect("current Qualification feedback projection");
        assert_eq!(
            protected_feedback.projection_identity(),
            family_policy.protected_feedback_frontier
        );
        assert_eq!(
            protected_feedback.basis_identity(),
            family_policy.independence_basis_identity
        );
        assert_eq!(
            protected_feedback.basis_identity(),
            independence_basis_locator.basis_identity
        );
        let committed_at = current_epoch_ms().expect("test clock");
        let request_identity = predecessor.request_identity().to_string();
        let request_digest = predecessor.meaning_digest().to_string();
        let attempt_identity = format!("backtest-attempt-ready-{suffix}");
        let result = positive_result(
            &request_identity,
            &request_digest,
            &attempt_identity,
            &intent_identity,
            &intent_digest,
            &suffix,
        );
        let result_bytes = result.to_canonical_bytes().expect("canonical Result");
        let result_identity = result.result_identity.as_str().to_string();
        let result_digest = result.result_digest.as_str().to_string();

        let mut family_transaction = rd_pool.begin().await.expect("family transaction");
        append_trial_family_attempt_in_transaction(
            &mut family_transaction,
            &intent_identity,
            &research_receipt_identity,
            TrialFamilyAttemptAppendV2 {
                intent_identity: intent_identity.clone(),
                intent_digest: intent_digest.clone(),
                request_identity: request_identity.clone(),
                request_digest: request_digest.clone(),
                result_identity: result_identity.clone(),
                result_digest: result_digest.clone(),
                terminal_disposition: TrialFamilyAttemptTerminalDispositionV2::TerminalResult,
                consumed_trial_budget: 1,
                candidate_set: TrialFamilyCandidateSetProposalV2 {
                    generation_rule_identity: format!("rd-candidate-generation-ready-{suffix}"),
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

        let positive_evidence = positive_evidence(&suffix);
        let protected_plan = protected_plan(&suffix);
        let composition = ReadyForSelectionCompositionRequestV1 {
            trial_family_identity: family_identity,
            result_identity: result_identity.clone(),
            request_identity,
            attempt_identity,
            positive_evidence: positive_evidence.clone(),
            protected_robustness_plan: protected_plan.clone(),
        };
        let mut rollback_transaction = rd_pool.begin().await.expect("rollback transaction");
        let census = load_trial_family_census_v2_by_family_in_transaction(
            &mut rollback_transaction,
            &composition.trial_family_identity,
        )
        .await
        .expect("READY census");
        let issued = crate::iteration_decision::tests::ready_storage_acceptance_fixture_v1(
            &census,
            &result,
            positive_evidence,
            protected_plan,
            committed_at + 3,
        )
        .expect("issued READY custody");
        persist_ready_for_selection_decision(&mut rollback_transaction, &issued)
            .await
            .expect("transactional READY persistence");
        let in_transaction_counts: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_iteration_positive_assessments_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_iteration_decisions_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_qualification_candidates_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_research_selections_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE (aggregate_identity=$2 AND event_kind='ITERATION_DECISION_COMMITTED_V1') OR (aggregate_identity=$3 AND event_kind='RESEARCH_SELECTION_COMMITTED_V1'))",
        )
        .bind(&result_identity)
        .bind(issued.decision().decision_identity())
        .bind(issued.selection().selection_identity())
        .fetch_one(&mut *rollback_transaction)
        .await
        .expect("transactional READY counts");
        assert_eq!(in_transaction_counts, (1, 1, 1, 1, 2));
        rollback_transaction
            .rollback()
            .await
            .expect("READY rollback");
        let rolled_back_counts: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_iteration_positive_assessments_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_iteration_decisions_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_qualification_candidates_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_research_selections_v1 WHERE result_identity=$1), (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE (aggregate_identity=$2 AND event_kind='ITERATION_DECISION_COMMITTED_V1') OR (aggregate_identity=$3 AND event_kind='RESEARCH_SELECTION_COMMITTED_V1'))",
        )
        .bind(&result_identity)
        .bind(issued.decision().decision_identity())
        .bind(issued.selection().selection_identity())
        .fetch_one(rd_pool)
        .await
        .expect("rolled-back READY counts");
        assert_eq!(rolled_back_counts, (0, 0, 0, 0, 0));

        let mut commit_transaction = rd_pool.begin().await.expect("commit transaction");
        persist_ready_for_selection_decision(&mut commit_transaction, &issued)
            .await
            .expect("committed READY persistence");
        commit_transaction.commit().await.expect("READY commit");

        Box::new(ReadyDecisionPostgresHarnessV1 {
            database,
            qualification,
            suffix,
            result_identity,
            composition,
            issued,
        })
    }

    async fn assert_ready_retry_resolve_and_qualification(
        harness: &ReadyDecisionPostgresHarnessV1,
    ) {
        let mutation = harness.database.mutation();
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let qualification_pool = mutation.pool(CanonicalOwnerTestRoleV1::QualificationWriter);
        let composition = &harness.composition;
        let issued = &harness.issued;
        let result_identity = &harness.result_identity;
        let suffix = &harness.suffix;
        let qualification = &harness.qualification;

        let retried = Box::pin(compose_ready_for_selection_decision_v1(
            rd_pool,
            composition.clone(),
        ))
        .await
        .expect("response-loss retry");
        assert_eq!(
            serde_json::to_vec(&retried).unwrap(),
            serde_json::to_vec(&issued).unwrap()
        );
        let resolved = Box::pin(resolve_ready_for_selection_decision_v1(
            rd_pool,
            IterationDecisionResolutionLocatorV1 {
                decision_identity: issued.decision().decision_identity().to_string(),
                result_identity: result_identity.clone(),
            },
        ))
        .await
        .expect("READY resolve")
        .expect("stored READY custody");
        assert_eq!(
            serde_json::to_vec(&resolved).unwrap(),
            serde_json::to_vec(&issued).unwrap()
        );
        let unified = Box::pin(resolve_iteration_decision_v1(
            rd_pool,
            IterationDecisionResolutionLocatorV1 {
                decision_identity: issued.decision().decision_identity().to_string(),
                result_identity: result_identity.clone(),
            },
        ))
        .await
        .expect("unified Decision resolve")
        .expect("unified READY custody");
        assert!(
            matches!(unified, ExistingIterationDecisionReadbackV1::ReadyForSelection(value) if value == *issued)
        );
        let policy = &issued
            .candidate()
            .protected_robustness_plan()
            .proposal()
            .protected_decision_policy;
        let intake_request = vibe_qualification::CandidateIntakeRequestV1::new(
            format!("qualification-review-ready-{suffix}"),
            issued.decision().decision_identity().to_string(),
            result_identity.clone(),
            issued.candidate().candidate_identity().to_string(),
            issued.selection().selection_identity().to_string(),
            policy.identity.clone(),
            policy.version,
        )
        .expect("canonical Qualification Candidate Intake request");
        let intake = qualification
            .submit_candidate_intake_v1(&intake_request)
            .await
            .expect("Qualification Candidate Intake");
        assert_eq!(
            intake.status(),
            vibe_qualification::CandidateIntakeStatusV1::Admitted
        );
        assert!(intake.holdout_reservation_identity().is_some());
        assert_eq!(
            qualification
                .submit_candidate_intake_v1(&intake_request)
                .await
                .expect("Qualification Candidate Intake response-loss retry"),
            intake
        );
        let intake_counts: (i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM qualification_candidate_intake_receipts_v1 WHERE review_request_identity=$1), (SELECT COUNT(*) FROM qualification_holdout_reservations_v1 WHERE review_request_identity=$1), (SELECT COUNT(*) FROM qualification_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='QUALIFICATION_CANDIDATE_INTAKE_COMMITTED_V1')",
        )
        .bind(intake_request.review_request_identity())
        .bind(intake.receipt_identity())
        .fetch_one(qualification_pool)
        .await
        .expect("Qualification Candidate Intake counts");
        assert_eq!(intake_counts, (1, 1, 1));
        let conflicting_intake = vibe_qualification::CandidateIntakeRequestV1::new(
            intake_request.review_request_identity().to_string(),
            issued.decision().decision_identity().to_string(),
            result_identity.clone(),
            issued.candidate().candidate_identity().to_string(),
            issued.selection().selection_identity().to_string(),
            policy.identity.clone(),
            policy.version + 1,
        )
        .expect("changed-meaning Qualification Candidate Intake request");
        assert!(matches!(
            qualification
                .submit_candidate_intake_v1(&conflicting_intake)
                .await,
            Err(vibe_qualification::QualificationOwnerError::ConflictingIdentity)
        ));
    }

    async fn assert_ready_tamper_closure(harness: &ReadyDecisionPostgresHarnessV1) {
        let mutation = harness.database.mutation();
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let issued = &harness.issued;
        let result_identity = &harness.result_identity;
        let suffix = &harness.suffix;

        let mut changed = harness.composition.clone();
        changed.protected_robustness_plan.metric.identity =
            format!("changed-protected-metric-{suffix}");
        assert!(
            Box::pin(compose_ready_for_selection_decision_v1(rd_pool, changed))
                .await
                .is_err()
        );
        let mut tamper_transaction = rd_pool.begin().await.expect("tamper transaction");
        sqlx::query("UPDATE rd_iteration_positive_assessments_v1 SET assessment_storage_bytes=assessment_storage_bytes || decode('00','hex') WHERE result_identity=$1")
            .bind(result_identity)
            .execute(&mut *tamper_transaction)
            .await
            .expect("temporary assessment tamper");
        assert!(
            Box::pin(load_ready_for_selection_by_result_in_transaction(
                &mut tamper_transaction,
                result_identity,
                None,
            ))
            .await
            .is_err()
        );
        tamper_transaction
            .rollback()
            .await
            .expect("tamper rollback");
        let mut selection_tamper_transaction =
            rd_pool.begin().await.expect("Selection tamper transaction");
        sqlx::query("UPDATE rd_research_selections_v1 SET selection_storage_bytes=selection_storage_bytes || decode('00','hex') WHERE result_identity=$1")
            .bind(result_identity)
            .execute(&mut *selection_tamper_transaction)
            .await
            .expect("temporary Selection tamper");
        assert!(
            Box::pin(load_ready_for_selection_by_result_in_transaction(
                &mut selection_tamper_transaction,
                result_identity,
                None,
            ))
            .await
            .is_err()
        );
        selection_tamper_transaction
            .rollback()
            .await
            .expect("Selection tamper rollback");
        assert!(
            Box::pin(resolve_ready_for_selection_decision_v1(
                rd_pool,
                IterationDecisionResolutionLocatorV1 {
                    decision_identity: issued.decision().decision_identity().to_string(),
                    result_identity: result_identity.clone(),
                },
            ))
            .await
            .expect("post-tamper resolve")
            .is_some()
        );
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
        let from_binding = |value: BindingDigest| {
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

    fn positive_result(
        request_identity: &str,
        request_digest: &str,
        attempt_identity: &str,
        intent_identity: &str,
        intent_digest: &str,
        suffix: &str,
    ) -> ReplayResultDtoV2 {
        let request_identity = identity(request_identity);
        let request_meaning_digest =
            CanonicalDigestV2::try_from(request_digest.to_string()).unwrap();
        let attempt_identity = identity(attempt_identity);
        let reconciliation = ObservationComponentV2::REQUESTED_MEANING
            .into_iter()
            .map(|component| {
                let (meaning_identity, meaning_digest) =
                    if component == ObservationComponentV2::FrozenResearchIntent {
                        (
                            identity(intent_identity),
                            CanonicalDigestV2::try_from(intent_digest.to_string()).unwrap(),
                        )
                    } else {
                        (
                            identity(format!("ready-meaning-{suffix}-{component:?}")),
                            canonical_digest_value('1'),
                        )
                    };
                ReconciliationAtomDtoV2 {
                    component,
                    requested_meaning_identity: meaning_identity.clone(),
                    requested_meaning_digest: meaning_digest.clone(),
                    observed_meaning_identity: Some(meaning_identity),
                    observed_meaning_digest: Some(meaning_digest),
                    observation_locator: Some(ComponentObservationLocatorV2 {
                        component,
                        reference: identity(format!("ready-observation-{suffix}-{component:?}")),
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
            category: DiagnosticCategoryV2::NoExecutionDefect,
            decisive_evidence: ComponentObservationLocatorV2 {
                component: ObservationComponentV2::SemanticTrace,
                reference: identity(format!("ready-diagnostic-{suffix}")),
                digest: canonical_digest_value('3'),
            },
        }];
        let semantic_trace = Some(ConsumedComponentObservationDtoV2 {
            request_identity: request_identity.clone(),
            request_meaning_digest: request_meaning_digest.clone(),
            attempt_identity: attempt_identity.clone(),
            component: ObservationComponentV2::SemanticTrace,
            locator: ComponentObservationLocatorV2 {
                component: ObservationComponentV2::SemanticTrace,
                reference: identity(format!("ready-semantic-trace-{suffix}")),
                digest: canonical_digest_value('4'),
            },
            observed_meaning_identity: identity(format!("ready-trace-meaning-{suffix}")),
            observed_meaning_digest: canonical_digest_value('5'),
        });
        let mut result = ReplayResultDtoV2 {
            schema_version: 2,
            result_identity: identity("placeholder-result"),
            result_digest: canonical_digest_value('0'),
            request_identity,
            request_meaning_digest,
            namespace: ReplayNamespaceV2::Exploratory,
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            attempt_identity,
            terminal: ReplayTerminalV2::TerminalResult,
            reconciliation,
            semantic_trace,
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

    fn positive_evidence(suffix: &str) -> PositiveAssessmentEvidenceV1 {
        let reference = |name: &str, byte: char| PositiveAssessmentEvidenceReferenceV1 {
            identity: format!("{name}-{suffix}"),
            digest: digest(byte),
        };
        PositiveAssessmentEvidenceV1 {
            mechanism_validity: vec![reference("ready-mechanism-evidence", '1')],
            economic_viability: vec![reference("ready-economic-evidence", '2')],
            robustness: vec![reference("ready-robustness-evidence", '3')],
            information_value: vec![reference("ready-information-evidence", '4')],
        }
    }

    fn protected_plan(suffix: &str) -> ProtectedRobustnessPlanProposalV1 {
        let reference = |name: &str, byte: char| PositiveAssessmentEvidenceReferenceV1 {
            identity: format!("{name}-{suffix}"),
            digest: digest(byte),
        };
        ProtectedRobustnessPlanProposalV1 {
            required_time_windows: vec![
                crate::iteration_decision::ProtectedTimeWindowV1 {
                    evidence: reference("ready-protected-window-a", '5'),
                    start_epoch_ms: 1_000,
                    end_epoch_ms: 2_000,
                },
                crate::iteration_decision::ProtectedTimeWindowV1 {
                    evidence: reference("ready-protected-window-b", '6'),
                    start_epoch_ms: 3_000,
                    end_epoch_ms: 4_000,
                },
            ],
            required_regimes: vec![
                crate::iteration_decision::ProtectedMarketRegimeV1 {
                    evidence: reference("ready-protected-regime-normal", '7'),
                    adverse: false,
                },
                crate::iteration_decision::ProtectedMarketRegimeV1 {
                    evidence: reference("ready-protected-regime-adverse", '8'),
                    adverse: true,
                },
            ],
            required_instrument_slices: vec![reference("ready-protected-instrument", '9')],
            instrument_scope:
                crate::iteration_decision::ProtectedInstrumentScopeV1::SingleInstrument,
            instrument_non_applicability_basis: None,
            required_perturbations: vec![crate::iteration_decision::ProtectedInputPerturbationV1 {
                input_class: reference("ready-protected-input-class", 'a'),
                perturbation: reference("ready-protected-perturbation", 'b'),
            }],
            required_parameter_neighborhoods: vec![
                crate::iteration_decision::ProtectedParameterNeighborhoodV1 {
                    parameter: reference("ready-protected-parameter", 'c'),
                    lower: -1,
                    center: 0,
                    upper: 1,
                },
            ],
            no_tunable_parameters_basis: None,
            preregistered_capacity_ceiling: 1_000,
            metric: reference("ready-protected-metric", 'a'),
            coverage_policy: reference("ready-protected-coverage", 'b'),
            tolerance_policy: reference("ready-protected-tolerance", 'c'),
            threshold_policy: reference("ready-protected-threshold", 'd'),
            aggregation_policy: reference("ready-protected-aggregation", 'e'),
            missing_cell_policy: reference("ready-protected-missing-cell", 'f'),
            stop_policy: reference("ready-protected-stop", '0'),
            purge_policy: reference("ready-protected-purge", '1'),
            embargo_policy: reference("ready-protected-embargo", '2'),
            multiplicity_policy: reference("ready-protected-multiplicity", '3'),
            protected_decision_policy:
                crate::iteration_decision::ProtectedDecisionPolicyProposalV1 {
                    identity: format!("ready-protected-decision-policy-{suffix}"),
                    version: 1,
                    digest: digest('4'),
                },
        }
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
        let terminal = match result.terminal {
            ReplayTerminalV2::TerminalResult => "TERMINAL_RESULT",
            ReplayTerminalV2::RunRejected => "RUN_REJECTED",
            ReplayTerminalV2::InvalidReplayEvidence => "INVALID_REPLAY_EVIDENCE",
            ReplayTerminalV2::InProgressOrUnknown => "IN_PROGRESS_OR_UNKNOWN",
        };
        sqlx::query("INSERT INTO backtest_replay_results_v2 (result_identity,result_digest,request_identity,request_meaning_digest,attempt_identity,terminal,canonical_bytes,canonical_bytes_blake3) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(result.result_identity.as_str()).bind(result.result_digest.as_str())
            .bind(result.request_identity.as_str()).bind(result.request_meaning_digest.as_str())
            .bind(result.attempt_identity.as_str()).bind(terminal).bind(result_bytes)
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
