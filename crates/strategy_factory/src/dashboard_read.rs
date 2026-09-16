//! Read-only, business-facing Dashboard projections assembled from canonical R&D Owner reads.

use std::{
    collections::BTreeSet,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use serde::Serialize;
use sqlx::{PgPool, Row};
use thiserror::Error;

use crate::{
    IterationDecisionResolutionLocatorV1,
    artifact_build::{
        ArtifactBuildResolution, ArtifactDirectoryCompletenessV1, ArtifactDirectoryOwnerPort,
        ArtifactReadbackOwnerPortV1,
    },
    iteration_decision::{ExistingIterationDecisionReadbackV1, IterationDecisionOutcomeV1},
    product_edge::{
        ProductEdgeResolution, ResearchDirectoryCompletenessV1, ResearchDirectoryOwnerPort,
        ResearchNextLegalAction, ResearchReadbackOwnerPortV1, ResearchViewAvailability,
    },
};

const FORMATION_LIMIT: u32 = 20;
const ARTIFACT_LIMIT: u32 = 20;
const ITERATION_LIMIT: i64 = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchQuestionAvailabilityV1 {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchQuestionV1 {
    pub hypothesis: String,
    pub falsification_question: String,
    pub expected_observation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchQuestionDirectoryItemV1 {
    pub request_identity: String,
    pub semantic_digest: String,
    pub committed_at_epoch_ms: u64,
    pub availability: ResearchQuestionAvailabilityV1,
    pub unavailable_reason: Option<&'static str>,
    pub question: Option<ResearchQuestionV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchQuestionDirectoryReadbackV1 {
    pub schema_version: u16,
    pub operation: &'static str,
    pub observed_at_epoch_ms: u64,
    pub total: u64,
    pub items: Vec<ResearchQuestionDirectoryItemV1>,
}

#[async_trait]
pub trait ResearchQuestionDirectoryOwnerPortV1: Send + Sync {
    async fn read_research_question_directory(
        &self,
    ) -> Result<ResearchQuestionDirectoryReadbackV1, DashboardReadErrorV1>;
}

#[derive(Debug, Error)]
pub enum DashboardReadErrorV1 {
    #[error("Dashboard Owner projection unavailable: {0}")]
    Unavailable(String),
    #[error("Dashboard Owner identity was not found")]
    NotFound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FormationCatalogCompletenessV1 {
    Complete,
    PartialUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FormationCatalogResearchV1 {
    pub request_identity: String,
    pub receipt_identity: String,
    pub intent_identity: String,
    pub committed_at_epoch_ms: u64,
    pub view_availability: ResearchViewAvailability,
    pub next_legal_action: ResearchNextLegalAction,
    pub trial_budget: u32,
    pub consumed_trial_budget: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FormationCatalogAttemptV1 {
    pub build_request_identity: String,
    pub attempt_identity: String,
    pub committed_at_epoch_ms: u64,
    pub resolution: ArtifactBuildResolution,
    pub receipt_identity: String,
    pub artifact_identity: String,
    pub review_identity: String,
    pub family_binding_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FormationCatalogFamilyV1 {
    pub trial_family_identity: String,
    pub research: FormationCatalogResearchV1,
    pub attempt_history: Vec<FormationCatalogAttemptV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FormationCatalogReadbackV1 {
    pub schema_version: u16,
    pub operation: &'static str,
    pub completeness: FormationCatalogCompletenessV1,
    pub observed_at_epoch_ms: u64,
    pub families: Vec<FormationCatalogFamilyV1>,
}

#[async_trait]
pub trait FormationCatalogOwnerPortV1: Send + Sync {
    async fn read_formation_catalog(
        &self,
    ) -> Result<FormationCatalogReadbackV1, DashboardReadErrorV1>;
}

#[derive(Clone)]
pub struct ComposedFormationCatalogOwnerV1 {
    research_directory: Arc<dyn ResearchDirectoryOwnerPort>,
    research_readback: Arc<dyn ResearchReadbackOwnerPortV1>,
    artifact_directory: Arc<dyn ArtifactDirectoryOwnerPort>,
    artifact_readback: Arc<dyn ArtifactReadbackOwnerPortV1>,
}

impl ComposedFormationCatalogOwnerV1 {
    pub fn new(
        research_directory: Arc<dyn ResearchDirectoryOwnerPort>,
        research_readback: Arc<dyn ResearchReadbackOwnerPortV1>,
        artifact_directory: Arc<dyn ArtifactDirectoryOwnerPort>,
        artifact_readback: Arc<dyn ArtifactReadbackOwnerPortV1>,
    ) -> Self {
        Self {
            research_directory,
            research_readback,
            artifact_directory,
            artifact_readback,
        }
    }
}

#[async_trait]
impl FormationCatalogOwnerPortV1 for ComposedFormationCatalogOwnerV1 {
    async fn read_formation_catalog(
        &self,
    ) -> Result<FormationCatalogReadbackV1, DashboardReadErrorV1> {
        let research_directory = self
            .research_directory
            .list_research(None, FORMATION_LIMIT)
            .await
            .map_err(|error| unavailable(error.to_string()))?;
        let artifact_directory = self
            .artifact_directory
            .list_artifacts(None, ARTIFACT_LIMIT)
            .await
            .map_err(|error| unavailable(error.to_string()))?;

        let mut families = Vec::new();
        let mut family_identities = BTreeSet::new();
        for item in research_directory.items.iter().filter(|item| {
            item.disposition == crate::product_edge::ResearchRequestDisposition::Accepted
        }) {
            let readback = self
                .research_readback
                .read_research_v2(&item.request_identity)
                .await
                .map_err(|error| unavailable(error.to_string()))?;
            if readback.resolution() != ProductEdgeResolution::Accepted {
                return Err(unavailable(
                    "verified Research directory/readback resolution mismatch",
                ));
            }
            let receipt = readback
                .owner_receipt()
                .ok_or_else(|| unavailable("accepted Research receipt is missing"))?;
            let view = readback
                .research_view()
                .ok_or_else(|| unavailable("accepted Research view is missing"))?;
            let family = readback
                .trial_family()
                .ok_or_else(|| unavailable("accepted Research TrialFamily is missing"))?;
            let family_identity = family.root().trial_family_identity();
            if item.intent_identity.as_deref() != Some(view.intent_identity.as_str())
                || receipt.request_identity != item.request_identity
                || receipt.resulting_research_intent_identity.as_deref()
                    != Some(view.intent_identity.as_str())
                || family.root_receipt().intent_identity() != view.intent_identity
                || !family_identities.insert(family_identity.to_owned())
            {
                return Err(unavailable(
                    "Formation catalog Research cross-binding mismatch",
                ));
            }

            let mut attempts = Vec::new();
            for artifact in artifact_directory
                .items
                .iter()
                .filter(|artifact| artifact.intent_identity == view.intent_identity)
            {
                let artifact_readback = self
                    .artifact_readback
                    .read_artifact(&artifact.build_request_identity, &artifact.attempt_identity)
                    .await
                    .map_err(|error| unavailable(error.to_string()))?;
                let owner_receipt = artifact_readback
                    .owner_receipt()
                    .ok_or_else(|| unavailable("verified Artifact receipt is missing"))?;
                let review = artifact_readback
                    .artifact_review()
                    .ok_or_else(|| unavailable("verified Artifact review is missing"))?;
                let binding = artifact_readback.artifact_trial_family().ok_or_else(|| {
                    unavailable("verified Artifact TrialFamily binding is missing")
                })?;
                if artifact_readback.resolution() != ArtifactBuildResolution::Success
                    || owner_receipt.disposition
                        != crate::artifact_build::ArtifactBuildDisposition::Success
                    || owner_receipt.artifact_identity.as_deref()
                        != Some(artifact.artifact_identity.as_str())
                    || review.intent_identity != view.intent_identity
                    || binding.binding().trial_family_identity() != family_identity
                    || binding.binding().artifact_identity() != artifact.artifact_identity
                {
                    return Err(unavailable(
                        "Formation catalog Artifact cross-binding mismatch",
                    ));
                }
                attempts.push(FormationCatalogAttemptV1 {
                    build_request_identity: artifact.build_request_identity.clone(),
                    attempt_identity: artifact.attempt_identity.clone(),
                    committed_at_epoch_ms: owner_receipt.committed_at_epoch_ms,
                    resolution: ArtifactBuildResolution::Success,
                    receipt_identity: owner_receipt.receipt_identity.clone(),
                    artifact_identity: artifact.artifact_identity.clone(),
                    review_identity: review.review_identity.clone(),
                    family_binding_identity: binding.binding().binding_identity().to_owned(),
                });
            }
            attempts.sort_by(|left, right| {
                right
                    .committed_at_epoch_ms
                    .cmp(&left.committed_at_epoch_ms)
                    .then_with(|| left.attempt_identity.cmp(&right.attempt_identity))
            });
            families.push(FormationCatalogFamilyV1 {
                trial_family_identity: family_identity.to_owned(),
                research: FormationCatalogResearchV1 {
                    request_identity: item.request_identity.clone(),
                    receipt_identity: receipt.receipt_identity.clone(),
                    intent_identity: view.intent_identity.clone(),
                    committed_at_epoch_ms: receipt.committed_at_epoch_ms,
                    view_availability: view.availability,
                    next_legal_action: readback.next_legal_action(),
                    trial_budget: family.root().policy().trial_budget,
                    consumed_trial_budget: family.census_frontier().consumed_trial_budget(),
                },
                attempt_history: attempts,
            });
        }
        families.sort_by(|left, right| {
            right
                .research
                .committed_at_epoch_ms
                .cmp(&left.research.committed_at_epoch_ms)
                .then_with(|| left.trial_family_identity.cmp(&right.trial_family_identity))
        });
        let incomplete = research_directory.completeness
            == ResearchDirectoryCompletenessV1::Partial
            || artifact_directory.completeness == ArtifactDirectoryCompletenessV1::Partial
            || !families.is_empty();
        Ok(FormationCatalogReadbackV1 {
            schema_version: 1,
            operation: "rd.formation_catalog.read.v1",
            completeness: if incomplete {
                FormationCatalogCompletenessV1::PartialUnavailable
            } else {
                FormationCatalogCompletenessV1::Complete
            },
            observed_at_epoch_ms: current_epoch_ms()?,
            families,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationTimelineActionV1 {
    SubmitRepairRequest,
    CreateSuccessorIntent,
    StopOnCommittedDecision,
    SubmitSelectedCandidateToQualification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationTimelineStateV1 {
    AwaitingReplayResult,
    RepairRequired,
    SuccessorRequired,
    Terminal,
    ReadyForQualification,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationTimelineDecisionV1 {
    pub decision_identity: String,
    pub decision_digest: String,
    pub round_ordinal: u32,
    pub trial_family_identity: String,
    pub census_frontier_identity: String,
    pub census_frontier_digest: String,
    pub request_identity: String,
    pub result_identity: String,
    pub attempt_identity: String,
    pub outcome: IterationDecisionOutcomeV1,
    pub next_legal_action: IterationTimelineActionV1,
    pub committed_at_epoch_ms: u64,
    pub receipt_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationTimelineReadbackV1 {
    pub schema_version: u16,
    pub trial_family_identity: String,
    pub census_frontier_identity: String,
    pub census_frontier_digest: String,
    pub consumed_trial_budget: u32,
    pub trial_budget: u32,
    pub state: IterationTimelineStateV1,
    pub decisions: Vec<IterationTimelineDecisionV1>,
    pub observed_at_epoch_ms: u64,
}

#[async_trait]
pub trait IterationTimelineOwnerPortV1: Send + Sync {
    async fn read_iteration_timeline(
        &self,
        trial_family_identity: &str,
    ) -> Result<IterationTimelineReadbackV1, DashboardReadErrorV1>;
}

#[derive(Clone)]
pub struct PostgresIterationTimelineOwnerV1 {
    pool: PgPool,
    census_v2_available: bool,
}

impl PostgresIterationTimelineOwnerV1 {
    pub async fn connect(database_url: &str) -> Result<Self, DashboardReadErrorV1> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(4)
            .connect(database_url)
            .await
            .map_err(|error| unavailable(error.to_string()))?;
        crate::schema_materialization::require_existing_public_tables_for_readback(
            &pool,
            &crate::iteration_decision_postgres::TABLES[..1],
        )
        .await
        .map_err(|error| unavailable(error.to_string()))?;
        let census_v2_available: bool =
            sqlx::query_scalar("SELECT to_regclass('rd_trial_family_attempt_cuts_v2') IS NOT NULL")
                .fetch_one(&pool)
                .await
                .map_err(|error| unavailable(error.to_string()))?;
        Ok(Self {
            pool,
            census_v2_available,
        })
    }
}

#[async_trait]
impl IterationTimelineOwnerPortV1 for PostgresIterationTimelineOwnerV1 {
    async fn read_iteration_timeline(
        &self,
        trial_family_identity: &str,
    ) -> Result<IterationTimelineReadbackV1, DashboardReadErrorV1> {
        if !crate::iteration_decision::is_valid_iteration_decision_locator_v1(trial_family_identity)
        {
            return Err(unavailable("invalid TrialFamily identity"));
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| unavailable(error.to_string()))?;
        let exists = sqlx::query("SELECT trial_family_identity FROM rd_trial_families_v1 WHERE trial_family_identity=$1 FOR SHARE")
            .bind(trial_family_identity).fetch_optional(&mut *transaction).await
            .map_err(|error| unavailable(error.to_string()))?;
        if exists.is_none() {
            transaction
                .commit()
                .await
                .map_err(|error| unavailable(error.to_string()))?;
            return Err(DashboardReadErrorV1::NotFound);
        }
        let (census_frontier_identity, census_frontier_digest, consumed_trial_budget, trial_budget) =
            if self.census_v2_available {
                let census = crate::trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction(
                &mut transaction,
                trial_family_identity,
            )
            .await
            .map_err(|error| unavailable(error.to_string()))?;
                (
                    census.census_frontier.frontier_identity().to_owned(),
                    census.census_frontier.frontier_digest().to_owned(),
                    census.consumed_trial_budget(),
                    census.legacy_family.root().policy().trial_budget,
                )
            } else {
                let family =
                    crate::trial_family_postgres::load_trial_family_by_family_in_transaction(
                        &mut transaction,
                        trial_family_identity,
                    )
                    .await
                    .map_err(|error| unavailable(error.to_string()))?;
                (
                    family.census_frontier().frontier_identity().to_owned(),
                    family.census_frontier().frontier_digest().to_owned(),
                    family.census_frontier().consumed_trial_budget(),
                    family.root().policy().trial_budget,
                )
            };
        let rows = sqlx::query(
            "SELECT decision_identity,result_identity,decision_digest,committed_at_epoch_ms FROM rd_iteration_decisions_v1 WHERE trial_family_identity=$1 ORDER BY committed_at_epoch_ms ASC, decision_identity COLLATE \"C\" ASC LIMIT $2",
        ).bind(trial_family_identity).bind(ITERATION_LIMIT + 1).fetch_all(&mut *transaction).await
            .map_err(|error| unavailable(error.to_string()))?;
        if rows.len() > usize::try_from(ITERATION_LIMIT).unwrap_or(128) {
            return Err(unavailable(
                "Iteration timeline exceeds the bounded response",
            ));
        }
        let locators = rows
            .iter()
            .map(|row| {
                Ok((
                    row.try_get::<String, _>("decision_identity")
                        .map_err(|error| unavailable(error.to_string()))?,
                    row.try_get::<String, _>("result_identity")
                        .map_err(|error| unavailable(error.to_string()))?,
                    row.try_get::<String, _>("decision_digest")
                        .map_err(|error| unavailable(error.to_string()))?,
                    u64::try_from(
                        row.try_get::<i64, _>("committed_at_epoch_ms")
                            .map_err(|error| unavailable(error.to_string()))?,
                    )
                    .map_err(|error| unavailable(error.to_string()))?,
                ))
            })
            .collect::<Result<Vec<_>, DashboardReadErrorV1>>()?;
        transaction
            .commit()
            .await
            .map_err(|error| unavailable(error.to_string()))?;

        let mut decisions = Vec::with_capacity(locators.len());
        for (index, (decision_identity, result_identity, stored_digest, stored_commit)) in
            locators.into_iter().enumerate()
        {
            let readback = Box::pin(
                crate::iteration_decision_postgres::resolve_iteration_decision_v1(
                    &self.pool,
                    IterationDecisionResolutionLocatorV1 {
                        decision_identity,
                        result_identity,
                    },
                ),
            )
            .await
            .map_err(|error| unavailable(error.to_string()))?
            .ok_or_else(|| unavailable("frozen Iteration Decision locator disappeared"))?;
            let (decision_identity, decision_digest, evidence, outcome, receipt, action) =
                match &readback {
                    ExistingIterationDecisionReadbackV1::RepairInputs(value) => (
                        value.decision().decision_identity(),
                        value.decision().decision_digest(),
                        value.decision().evidence_cut(),
                        value.decision().outcome(),
                        value.receipt(),
                        IterationTimelineActionV1::SubmitRepairRequest,
                    ),
                    ExistingIterationDecisionReadbackV1::TrialBudgetTerminalStop(value) => (
                        value.decision().decision_identity(),
                        value.decision().decision_digest(),
                        value.decision().evidence_cut(),
                        value.decision().outcome(),
                        value.receipt(),
                        IterationTimelineActionV1::StopOnCommittedDecision,
                    ),
                    ExistingIterationDecisionReadbackV1::CandidateComparison(value) => {
                        let action = match value.decision().outcome() {
                            IterationDecisionOutcomeV1::SuccessorExperiment { .. } => {
                                IterationTimelineActionV1::CreateSuccessorIntent
                            }
                            IterationDecisionOutcomeV1::TerminalStop { .. } => {
                                IterationTimelineActionV1::StopOnCommittedDecision
                            }
                            _ => {
                                return Err(unavailable(
                                    "Candidate comparison outcome is inconsistent",
                                ));
                            }
                        };
                        (
                            value.decision().decision_identity(),
                            value.decision().decision_digest(),
                            value.decision().evidence_cut(),
                            value.decision().outcome(),
                            value.receipt(),
                            action,
                        )
                    }
                    ExistingIterationDecisionReadbackV1::ReadyForSelection(value) => (
                        value.decision().decision_identity(),
                        value.decision().decision_digest(),
                        value.decision().evidence_cut(),
                        value.decision().outcome(),
                        value.receipt(),
                        IterationTimelineActionV1::SubmitSelectedCandidateToQualification,
                    ),
                };
            if decision_digest != stored_digest
                || receipt.committed_at_epoch_ms() != stored_commit
                || evidence.trial_family_identity != trial_family_identity
                || receipt.decision_identity() != decision_identity
                || receipt.result_identity() != evidence.result_identity
            {
                return Err(unavailable("Iteration timeline canonical readback drift"));
            }
            decisions.push(IterationTimelineDecisionV1 {
                decision_identity: decision_identity.to_owned(),
                decision_digest: decision_digest.to_owned(),
                round_ordinal: u32::try_from(index + 1)
                    .map_err(|error| unavailable(error.to_string()))?,
                trial_family_identity: evidence.trial_family_identity.clone(),
                census_frontier_identity: evidence.census_frontier_identity.clone(),
                census_frontier_digest: evidence.census_frontier_digest.clone(),
                request_identity: evidence.request_identity.clone(),
                result_identity: evidence.result_identity.clone(),
                attempt_identity: evidence.attempt_identity.clone(),
                outcome: outcome.clone(),
                next_legal_action: action,
                committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
                receipt_identity: receipt.receipt_identity().to_owned(),
            });
        }
        let state =
            decisions
                .last()
                .map_or(
                    IterationTimelineStateV1::AwaitingReplayResult,
                    |decision| match decision.next_legal_action {
                        IterationTimelineActionV1::SubmitRepairRequest => {
                            IterationTimelineStateV1::RepairRequired
                        }
                        IterationTimelineActionV1::CreateSuccessorIntent => {
                            IterationTimelineStateV1::SuccessorRequired
                        }
                        IterationTimelineActionV1::StopOnCommittedDecision => {
                            IterationTimelineStateV1::Terminal
                        }
                        IterationTimelineActionV1::SubmitSelectedCandidateToQualification => {
                            IterationTimelineStateV1::ReadyForQualification
                        }
                    },
                );
        Ok(IterationTimelineReadbackV1 {
            schema_version: 1,
            trial_family_identity: trial_family_identity.to_owned(),
            census_frontier_identity,
            census_frontier_digest,
            consumed_trial_budget,
            trial_budget,
            state,
            decisions,
            observed_at_epoch_ms: current_epoch_ms()?,
        })
    }
}

fn current_epoch_ms() -> Result<u64, DashboardReadErrorV1> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| unavailable(error.to_string()))?;
    u64::try_from(elapsed.as_millis()).map_err(|error| unavailable(error.to_string()))
}

fn unavailable(message: impl Into<String>) -> DashboardReadErrorV1 {
    DashboardReadErrorV1::Unavailable(message.into())
}
