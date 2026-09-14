#![expect(
    clippy::large_futures,
    reason = "the HTTP adapter retains complete typed Iteration Decision readbacks across Owner awaits"
)]

use std::{collections::BTreeSet, sync::Arc};

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Serialize;
use serde_json::json;
use vibe_strategy_factory::{
    CandidateComparisonCompositionRequestV1, DecisionCompositionRequestV1,
    IterationCandidateEvaluationSetV1, IterationDecisionPostgresErrorV1,
    IterationDecisionResolutionLocatorV1, ReadyForSelectionCompositionRequestV1,
    RepairActionCompositionRequestV1, RepairActionResolutionLocatorV1,
    SuccessorResearchIntentPostgresErrorV1, SuccessorResearchIntentResolutionLocatorV1,
    iteration_decision::{
        CandidateComparisonDecisionReadbackV1, ExistingIterationDecisionReadbackV1,
        IterationDecisionEvidenceCutV1, IterationDecisionOutcomeV1, IterationRepairCategoryV1,
        PositiveAssessmentEvidenceV1, ReadyForSelectionDecisionReadbackV1,
        RepairInputIterationDecisionReadbackV1, ResearchSelectionDispositionV1,
        TrialBudgetTerminalStopDecisionReadbackV1, is_valid_iteration_decision_locator_v1,
    },
    product_edge::{ResearchIterationActionProjectionV1, ResearchIterationActionV1},
    product_edge_postgres::PostgresResearchGoalOwnerV1,
    repair_action::RepairActionRequestReadbackV1,
    successor_intent::{
        SuccessorResearchIntentCompositionRequestV1, SuccessorResearchIntentErrorV1,
        SuccessorResearchIntentReadbackV1,
    },
};

use super::{authorized, insert_rejection_code};

#[async_trait::async_trait]
trait RepairInputDecisionActionPort: Send + Sync {
    async fn compose(
        &self,
        request: DecisionCompositionRequestV1,
    ) -> Result<RepairInputDecisionActionResponseV1, IterationDecisionPostgresErrorV1>;

    async fn resolve(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<RepairInputDecisionActionResponseV1>, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl RepairInputDecisionActionPort for PostgresResearchGoalOwnerV1 {
    async fn compose(
        &self,
        request: DecisionCompositionRequestV1,
    ) -> Result<RepairInputDecisionActionResponseV1, IterationDecisionPostgresErrorV1> {
        self.compose_repair_input_iteration_decision_v1(request)
            .await
            .map(RepairInputDecisionActionResponseV1::from)
    }

    async fn resolve(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<RepairInputDecisionActionResponseV1>, IterationDecisionPostgresErrorV1> {
        self.resolve_repair_input_iteration_decision_v1(locator)
            .await
            .map(|readback| readback.map(RepairInputDecisionActionResponseV1::from))
    }
}

#[async_trait::async_trait]
trait TrialBudgetTerminalStopActionPort: Send + Sync {
    async fn compose_trial_budget_stop(
        &self,
        request: DecisionCompositionRequestV1,
    ) -> Result<TrialBudgetTerminalStopActionResponseV1, IterationDecisionPostgresErrorV1>;

    async fn resolve_trial_budget_stop(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<TrialBudgetTerminalStopActionResponseV1>, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl TrialBudgetTerminalStopActionPort for PostgresResearchGoalOwnerV1 {
    async fn compose_trial_budget_stop(
        &self,
        request: DecisionCompositionRequestV1,
    ) -> Result<TrialBudgetTerminalStopActionResponseV1, IterationDecisionPostgresErrorV1> {
        self.compose_trial_budget_terminal_stop_decision_v1(request)
            .await
            .map(TrialBudgetTerminalStopActionResponseV1::from)
    }

    async fn resolve_trial_budget_stop(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<TrialBudgetTerminalStopActionResponseV1>, IterationDecisionPostgresErrorV1>
    {
        self.resolve_trial_budget_terminal_stop_decision_v1(locator)
            .await
            .map(|readback| readback.map(TrialBudgetTerminalStopActionResponseV1::from))
    }
}

#[async_trait::async_trait]
trait CandidateComparisonDecisionActionPort: Send + Sync {
    async fn compose_candidate_comparison(
        &self,
        request: CandidateComparisonCompositionRequestV1,
    ) -> Result<CandidateComparisonDecisionActionResponseV1, IterationDecisionPostgresErrorV1>;

    async fn resolve_candidate_comparison(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<CandidateComparisonDecisionActionResponseV1>, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl CandidateComparisonDecisionActionPort for PostgresResearchGoalOwnerV1 {
    async fn compose_candidate_comparison(
        &self,
        request: CandidateComparisonCompositionRequestV1,
    ) -> Result<CandidateComparisonDecisionActionResponseV1, IterationDecisionPostgresErrorV1> {
        self.compose_candidate_comparison_decision_v1(request)
            .await
            .map(CandidateComparisonDecisionActionResponseV1::from)
    }

    async fn resolve_candidate_comparison(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<CandidateComparisonDecisionActionResponseV1>, IterationDecisionPostgresErrorV1>
    {
        self.resolve_candidate_comparison_decision_v1(locator)
            .await
            .map(|readback| readback.map(CandidateComparisonDecisionActionResponseV1::from))
    }
}

#[async_trait::async_trait]
trait SuccessorResearchIntentActionPort: Send + Sync {
    async fn compose_successor_intent(
        &self,
        request: SuccessorResearchIntentCompositionRequestV1,
    ) -> Result<SuccessorResearchIntentActionResponseV1, SuccessorResearchIntentPostgresErrorV1>;

    async fn resolve_successor_intent(
        &self,
        locator: SuccessorResearchIntentResolutionLocatorV1,
    ) -> Result<
        Option<SuccessorResearchIntentActionResponseV1>,
        SuccessorResearchIntentPostgresErrorV1,
    >;
}

#[async_trait::async_trait]
impl SuccessorResearchIntentActionPort for PostgresResearchGoalOwnerV1 {
    async fn compose_successor_intent(
        &self,
        request: SuccessorResearchIntentCompositionRequestV1,
    ) -> Result<SuccessorResearchIntentActionResponseV1, SuccessorResearchIntentPostgresErrorV1>
    {
        self.compose_successor_research_intent_v1(request)
            .await
            .map(SuccessorResearchIntentActionResponseV1::from)
    }

    async fn resolve_successor_intent(
        &self,
        locator: SuccessorResearchIntentResolutionLocatorV1,
    ) -> Result<
        Option<SuccessorResearchIntentActionResponseV1>,
        SuccessorResearchIntentPostgresErrorV1,
    > {
        self.resolve_successor_research_intent_v1(locator)
            .await
            .map(|readback| readback.map(SuccessorResearchIntentActionResponseV1::from))
    }
}

#[async_trait::async_trait]
trait ReadyForSelectionActionPort: Send + Sync {
    async fn compose_ready(
        &self,
        request: ReadyForSelectionCompositionRequestV1,
    ) -> Result<ReadyForSelectionActionResponseV1, IterationDecisionPostgresErrorV1>;

    async fn resolve_ready(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<ReadyForSelectionActionResponseV1>, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl ReadyForSelectionActionPort for PostgresResearchGoalOwnerV1 {
    async fn compose_ready(
        &self,
        request: ReadyForSelectionCompositionRequestV1,
    ) -> Result<ReadyForSelectionActionResponseV1, IterationDecisionPostgresErrorV1> {
        self.compose_ready_for_selection_decision_v1(request)
            .await
            .map(ReadyForSelectionActionResponseV1::from)
    }

    async fn resolve_ready(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<ReadyForSelectionActionResponseV1>, IterationDecisionPostgresErrorV1> {
        self.resolve_ready_for_selection_decision_v1(locator)
            .await
            .map(|readback| readback.map(ReadyForSelectionActionResponseV1::from))
    }
}

#[async_trait::async_trait]
trait IterationDecisionReadPort: Send + Sync {
    async fn resolve_decision(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<UnifiedIterationDecisionResponseV1>, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl IterationDecisionReadPort for PostgresResearchGoalOwnerV1 {
    async fn resolve_decision(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<Option<UnifiedIterationDecisionResponseV1>, IterationDecisionPostgresErrorV1> {
        self.resolve_iteration_decision_v1(locator)
            .await
            .map(|readback| readback.map(UnifiedIterationDecisionResponseV1::from))
    }
}

#[async_trait::async_trait]
trait ResearchIterationActionReadPort: Send + Sync {
    async fn resolve_action(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<ResearchIterationActionResponseV1, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl ResearchIterationActionReadPort for PostgresResearchGoalOwnerV1 {
    async fn resolve_action(
        &self,
        locator: IterationDecisionResolutionLocatorV1,
    ) -> Result<ResearchIterationActionResponseV1, IterationDecisionPostgresErrorV1> {
        self.resolve_research_iteration_action_v1(locator)
            .await
            .map(ResearchIterationActionResponseV1::from)
    }
}

#[async_trait::async_trait]
trait RepairActionRequestActionPort: Send + Sync {
    async fn compose_repair_action(
        &self,
        request: RepairActionCompositionRequestV1,
    ) -> Result<RepairActionRequestActionResponseV1, IterationDecisionPostgresErrorV1>;

    async fn resolve_repair_action(
        &self,
        locator: RepairActionResolutionLocatorV1,
    ) -> Result<Option<RepairActionRequestActionResponseV1>, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl RepairActionRequestActionPort for PostgresResearchGoalOwnerV1 {
    async fn compose_repair_action(
        &self,
        request: RepairActionCompositionRequestV1,
    ) -> Result<RepairActionRequestActionResponseV1, IterationDecisionPostgresErrorV1> {
        self.compose_repair_action_request_v1(request)
            .await
            .map(RepairActionRequestActionResponseV1::from)
    }

    async fn resolve_repair_action(
        &self,
        locator: RepairActionResolutionLocatorV1,
    ) -> Result<Option<RepairActionRequestActionResponseV1>, IterationDecisionPostgresErrorV1> {
        self.resolve_repair_action_request_v1(locator)
            .await
            .map(|readback| readback.map(RepairActionRequestActionResponseV1::from))
    }
}

#[derive(Clone)]
struct RepairInputDecisionApiState {
    owner: Arc<dyn RepairInputDecisionActionPort>,
    token_digest: [u8; 32],
}

#[derive(Clone)]
struct TrialBudgetTerminalStopApiState {
    owner: Arc<dyn TrialBudgetTerminalStopActionPort>,
    token_digest: [u8; 32],
}

#[derive(Clone)]
struct CandidateComparisonDecisionApiState {
    owner: Arc<dyn CandidateComparisonDecisionActionPort>,
    token_digest: [u8; 32],
}

#[derive(Clone)]
struct SuccessorResearchIntentApiState {
    owner: Arc<dyn SuccessorResearchIntentActionPort>,
    token_digest: [u8; 32],
}

#[derive(Clone)]
struct ReadyForSelectionApiState {
    owner: Arc<dyn ReadyForSelectionActionPort>,
    token_digest: [u8; 32],
}

#[derive(Clone)]
struct IterationDecisionReadApiState {
    owner: Arc<dyn IterationDecisionReadPort>,
    token_digest: [u8; 32],
}

#[derive(Clone)]
struct ResearchIterationActionReadApiState {
    owner: Arc<dyn ResearchIterationActionReadPort>,
    token_digest: [u8; 32],
}

#[derive(Clone)]
struct RepairActionRequestApiState {
    owner: Arc<dyn RepairActionRequestActionPort>,
    token_digest: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct RepairInputDecisionActionResponseV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    supported_defects: Vec<IterationRepairCategoryV1>,
    receipt_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

impl From<RepairInputIterationDecisionReadbackV1> for RepairInputDecisionActionResponseV1 {
    fn from(readback: RepairInputIterationDecisionReadbackV1) -> Self {
        let decision = readback.decision();
        let receipt = readback.receipt();
        Self {
            schema_version: 1,
            decision_identity: decision.decision_identity().to_string(),
            decision_digest: decision.decision_digest().to_string(),
            evidence_cut: decision.evidence_cut().clone(),
            outcome: decision.outcome().clone(),
            supported_defects: decision.supported_defects().to_vec(),
            receipt_identity: receipt.receipt_identity().to_string(),
            result_identity: receipt.result_identity().to_string(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct TrialBudgetTerminalStopActionResponseV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    consumed_trial_budget: u32,
    trial_budget: u32,
    receipt_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

impl From<TrialBudgetTerminalStopDecisionReadbackV1> for TrialBudgetTerminalStopActionResponseV1 {
    fn from(readback: TrialBudgetTerminalStopDecisionReadbackV1) -> Self {
        let decision = readback.decision();
        let receipt = readback.receipt();
        Self {
            schema_version: 1,
            decision_identity: decision.decision_identity().to_string(),
            decision_digest: decision.decision_digest().to_string(),
            evidence_cut: decision.evidence_cut().clone(),
            outcome: decision.outcome().clone(),
            consumed_trial_budget: decision.consumed_trial_budget(),
            trial_budget: decision.trial_budget(),
            receipt_identity: receipt.receipt_identity().to_string(),
            result_identity: receipt.result_identity().to_string(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct CandidateComparisonDecisionActionResponseV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    candidate_evaluations: IterationCandidateEvaluationSetV1,
    receipt_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

impl From<CandidateComparisonDecisionReadbackV1> for CandidateComparisonDecisionActionResponseV1 {
    fn from(readback: CandidateComparisonDecisionReadbackV1) -> Self {
        let decision = readback.decision();
        let receipt = readback.receipt();
        Self {
            schema_version: 1,
            decision_identity: decision.decision_identity().to_string(),
            decision_digest: decision.decision_digest().to_string(),
            evidence_cut: decision.evidence_cut().clone(),
            outcome: decision.outcome().clone(),
            candidate_evaluations: decision.candidate_evaluations().clone(),
            receipt_identity: receipt.receipt_identity().to_string(),
            result_identity: receipt.result_identity().to_string(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct SuccessorResearchIntentActionResponseV1 {
    schema_version: u16,
    intent_identity: String,
    intent_digest: String,
    request_identity: String,
    goal: vibe_strategy_factory::product_edge::SourcedResearchGoalV2,
    predecessor_intent_identity: String,
    predecessor_intent_digest: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    trial_family_identity: String,
    trial_family_policy_digest: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    independence_basis_identity: String,
    independence_basis_digest: String,
    protected_feedback_projection_identity: String,
    protected_feedback_projection_digest: String,
    experiment_identity: String,
    experiment_digest: String,
    experiment: vibe_strategy_factory::IterationExperimentModeV1,
    frozen_at_epoch_ms: u64,
    receipt_identity: String,
    committed_at_epoch_ms: u64,
}

impl From<SuccessorResearchIntentReadbackV1> for SuccessorResearchIntentActionResponseV1 {
    fn from(readback: SuccessorResearchIntentReadbackV1) -> Self {
        let intent = readback.intent();
        let receipt = readback.receipt();
        Self {
            schema_version: 1,
            intent_identity: intent.intent_identity().to_string(),
            intent_digest: intent.intent_digest().to_string(),
            request_identity: intent.request_identity().to_string(),
            goal: intent.goal().clone(),
            predecessor_intent_identity: intent.predecessor_intent_identity().to_string(),
            predecessor_intent_digest: intent.predecessor_intent_digest().to_string(),
            decision_identity: intent.decision_identity().to_string(),
            decision_digest: intent.decision_digest().to_string(),
            result_identity: intent.result_identity().to_string(),
            trial_family_identity: intent.trial_family_identity().to_string(),
            trial_family_policy_digest: intent.trial_family_policy_digest().to_string(),
            census_frontier_identity: intent.census_frontier_identity().to_string(),
            census_frontier_digest: intent.census_frontier_digest().to_string(),
            independence_basis_identity: intent.independence_basis_identity().to_string(),
            independence_basis_digest: intent.independence_basis_digest().to_string(),
            protected_feedback_projection_identity: intent
                .protected_feedback_projection_identity()
                .to_string(),
            protected_feedback_projection_digest: intent
                .protected_feedback_projection_digest()
                .to_string(),
            experiment_identity: intent.experiment_identity().to_string(),
            experiment_digest: intent.experiment_digest().to_string(),
            experiment: intent.experiment().clone(),
            frozen_at_epoch_ms: intent.frozen_at_epoch_ms(),
            receipt_identity: receipt.receipt_identity().to_string(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct ReadyForSelectionActionResponseV1 {
    schema_version: u16,
    assessment_identity: String,
    assessment_digest: String,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    candidate_identity: String,
    candidate_digest: String,
    positive_evidence: PositiveAssessmentEvidenceV1,
    protected_robustness_plan_identity: String,
    protected_robustness_plan_version: u64,
    protected_robustness_plan_digest: String,
    selection_identity: String,
    selection_digest: String,
    selection_disposition: ResearchSelectionDispositionV1,
    receipt_identity: String,
    selection_receipt_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

impl From<ReadyForSelectionDecisionReadbackV1> for ReadyForSelectionActionResponseV1 {
    fn from(readback: ReadyForSelectionDecisionReadbackV1) -> Self {
        let assessment = readback.assessment();
        let decision = readback.decision();
        let receipt = readback.receipt();
        let candidate = readback.candidate();
        let selection = readback.selection();
        let selection_receipt = readback.selection_receipt();
        Self {
            schema_version: 1,
            assessment_identity: assessment.assessment_identity().to_string(),
            assessment_digest: assessment.assessment_digest().to_string(),
            decision_identity: decision.decision_identity().to_string(),
            decision_digest: decision.decision_digest().to_string(),
            evidence_cut: decision.evidence_cut().clone(),
            outcome: decision.outcome().clone(),
            candidate_identity: assessment.candidate_identity().to_string(),
            candidate_digest: assessment.candidate_digest().to_string(),
            positive_evidence: assessment.positive_evidence().clone(),
            protected_robustness_plan_identity: assessment
                .protected_robustness_plan()
                .plan_identity()
                .to_string(),
            protected_robustness_plan_version: candidate.protected_robustness_plan().plan_version(),
            protected_robustness_plan_digest: assessment
                .protected_robustness_plan()
                .plan_digest()
                .to_string(),
            selection_identity: selection.selection_identity().to_string(),
            selection_digest: selection.selection_digest().to_string(),
            selection_disposition: selection.disposition(),
            receipt_identity: receipt.receipt_identity().to_string(),
            selection_receipt_identity: selection_receipt.receipt_identity().to_string(),
            result_identity: receipt.result_identity().to_string(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "decision_kind",
    content = "decision",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
enum UnifiedIterationDecisionResponseV1 {
    RepairInputs(RepairInputDecisionActionResponseV1),
    TrialBudgetTerminalStop(TrialBudgetTerminalStopActionResponseV1),
    CandidateComparison(CandidateComparisonDecisionActionResponseV1),
    ReadyForSelection(ReadyForSelectionActionResponseV1),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ResearchIterationActionResponseV1 {
    schema_version: u16,
    decision_identity: String,
    result_identity: String,
    action: ResearchIterationActionV1,
}

impl From<ResearchIterationActionProjectionV1> for ResearchIterationActionResponseV1 {
    fn from(projection: ResearchIterationActionProjectionV1) -> Self {
        Self {
            schema_version: projection.schema_version(),
            decision_identity: projection.decision_identity().to_string(),
            result_identity: projection.result_identity().to_string(),
            action: projection.action().clone(),
        }
    }
}

impl From<ExistingIterationDecisionReadbackV1> for UnifiedIterationDecisionResponseV1 {
    fn from(readback: ExistingIterationDecisionReadbackV1) -> Self {
        match readback {
            ExistingIterationDecisionReadbackV1::RepairInputs(value) => {
                Self::RepairInputs(value.into())
            }
            ExistingIterationDecisionReadbackV1::TrialBudgetTerminalStop(value) => {
                Self::TrialBudgetTerminalStop(value.into())
            }
            ExistingIterationDecisionReadbackV1::CandidateComparison(value) => {
                Self::CandidateComparison(value.into())
            }
            ExistingIterationDecisionReadbackV1::ReadyForSelection(value) => {
                Self::ReadyForSelection(value.into())
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct RepairActionRequestActionResponseV1 {
    schema_version: u16,
    action_request_identity: String,
    action_request_digest: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    category: IterationRepairCategoryV1,
    target: vibe_strategy_factory::iteration_decision::IterationRepairTargetV1,
    receipt_identity: String,
    receipt_digest: String,
    committed_at_epoch_ms: u64,
}

impl From<RepairActionRequestReadbackV1> for RepairActionRequestActionResponseV1 {
    fn from(readback: RepairActionRequestReadbackV1) -> Self {
        let request = readback.request();
        let receipt = readback.receipt();
        Self {
            schema_version: 1,
            action_request_identity: request.action_request_identity().to_string(),
            action_request_digest: request.action_request_digest().to_string(),
            decision_identity: request.decision_identity().to_string(),
            decision_digest: request.decision_digest().to_string(),
            result_identity: request.result_identity().to_string(),
            category: request.category(),
            target: request.target(),
            receipt_identity: receipt.receipt_identity().to_string(),
            receipt_digest: receipt.receipt_digest().to_string(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        }
    }
}

pub(super) fn router(owner: Arc<PostgresResearchGoalOwnerV1>, token_digest: [u8; 32]) -> Router {
    action_router(owner.clone(), token_digest)
        .merge(iteration_decision_read_router(owner.clone(), token_digest))
        .merge(research_iteration_action_read_router(
            owner.clone(),
            token_digest,
        ))
        .merge(candidate_comparison_router(owner.clone(), token_digest))
        .merge(successor_research_intent_router(
            owner.clone(),
            token_digest,
        ))
        .merge(ready_for_selection_router(owner.clone(), token_digest))
        .merge(trial_budget_terminal_stop_router(
            owner.clone(),
            token_digest,
        ))
        .merge(repair_action_router(owner, token_digest))
}

fn successor_research_intent_router(
    owner: Arc<dyn SuccessorResearchIntentActionPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/successor-research-intents",
            post(compose_successor_research_intent),
        )
        .route(
            "/v1/successor-research-intents/resolve",
            post(resolve_successor_research_intent),
        )
        .with_state(SuccessorResearchIntentApiState {
            owner,
            token_digest,
        })
}

fn research_iteration_action_read_router(
    owner: Arc<dyn ResearchIterationActionReadPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/research-iteration-actions/resolve",
            post(resolve_research_iteration_action),
        )
        .with_state(ResearchIterationActionReadApiState {
            owner,
            token_digest,
        })
}

fn candidate_comparison_router(
    owner: Arc<dyn CandidateComparisonDecisionActionPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/iteration-decisions/candidate-comparison",
            post(compose_candidate_comparison),
        )
        .route(
            "/v1/iteration-decisions/candidate-comparison/resolve",
            post(resolve_candidate_comparison),
        )
        .with_state(CandidateComparisonDecisionApiState {
            owner,
            token_digest,
        })
}

fn ready_for_selection_router(
    owner: Arc<dyn ReadyForSelectionActionPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/iteration-decisions/ready-for-selection",
            post(compose_ready_for_selection),
        )
        .route(
            "/v1/iteration-decisions/ready-for-selection/resolve",
            post(resolve_ready_for_selection),
        )
        .with_state(ReadyForSelectionApiState {
            owner,
            token_digest,
        })
}

fn iteration_decision_read_router(
    owner: Arc<dyn IterationDecisionReadPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/iteration-decisions/resolve",
            post(resolve_iteration_decision),
        )
        .with_state(IterationDecisionReadApiState {
            owner,
            token_digest,
        })
}

fn trial_budget_terminal_stop_router(
    owner: Arc<dyn TrialBudgetTerminalStopActionPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/iteration-decisions/trial-budget-terminal-stop",
            post(compose_trial_budget_terminal_stop),
        )
        .route(
            "/v1/iteration-decisions/trial-budget-terminal-stop/resolve",
            post(resolve_trial_budget_terminal_stop),
        )
        .with_state(TrialBudgetTerminalStopApiState {
            owner,
            token_digest,
        })
}

fn repair_action_router(
    owner: Arc<dyn RepairActionRequestActionPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/repair-action-requests",
            post(compose_repair_action_request),
        )
        .route(
            "/v1/repair-action-requests/resolve",
            post(resolve_repair_action_request),
        )
        .with_state(RepairActionRequestApiState {
            owner,
            token_digest,
        })
}

fn action_router(owner: Arc<dyn RepairInputDecisionActionPort>, token_digest: [u8; 32]) -> Router {
    Router::new()
        .route(
            "/v1/iteration-decisions/repair-inputs",
            post(compose_repair_input_decision),
        )
        .route(
            "/v1/iteration-decisions/repair-inputs/resolve",
            post(resolve_repair_input_decision),
        )
        .with_state(RepairInputDecisionApiState {
            owner,
            token_digest,
        })
}

async fn resolve_repair_input_decision(
    State(state): State<RepairInputDecisionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return decision_resolution_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: IterationDecisionResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return decision_resolution_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let decision_identity = locator.decision_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return decision_resolution_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &decision_identity,
        );
    }

    match state.owner.resolve(locator).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => decision_resolution_rejection(
            StatusCode::NOT_FOUND,
            "ITERATION_DECISION_NOT_FOUND",
            &decision_identity,
        ),
        Err(e) => decision_resolution_owner_error(&e, &decision_identity),
    }
}

async fn resolve_iteration_decision(
    State(state): State<IterationDecisionReadApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return decision_resolution_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: IterationDecisionResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return decision_resolution_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let decision_identity = locator.decision_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return decision_resolution_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &decision_identity,
        );
    }

    match state.owner.resolve_decision(locator).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => decision_resolution_rejection(
            StatusCode::NOT_FOUND,
            "ITERATION_DECISION_NOT_FOUND",
            &decision_identity,
        ),
        Err(e) => decision_resolution_owner_error(&e, &decision_identity),
    }
}

async fn resolve_research_iteration_action(
    State(state): State<ResearchIterationActionReadApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return decision_resolution_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: IterationDecisionResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return decision_resolution_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let decision_identity = locator.decision_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return decision_resolution_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &decision_identity,
        );
    }

    match state.owner.resolve_action(locator).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => decision_resolution_owner_error(&e, &decision_identity),
    }
}

async fn compose_repair_input_decision(
    State(state): State<RepairInputDecisionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: DecisionCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = request.request_identity.clone();
    if [
        request.trial_family_identity.as_str(),
        request.result_identity.as_str(),
        request.request_identity.as_str(),
        request.attempt_identity.as_str(),
    ]
    .into_iter()
    .any(|identity| !is_valid_iteration_decision_locator_v1(identity))
    {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &request_identity,
        );
    }

    match state.owner.compose(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

async fn compose_trial_budget_terminal_stop(
    State(state): State<TrialBudgetTerminalStopApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: DecisionCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = request.request_identity.clone();
    if [
        request.trial_family_identity.as_str(),
        request.result_identity.as_str(),
        request.request_identity.as_str(),
        request.attempt_identity.as_str(),
    ]
    .into_iter()
    .any(|identity| !is_valid_iteration_decision_locator_v1(identity))
    {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &request_identity,
        );
    }

    match state.owner.compose_trial_budget_stop(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => trial_budget_terminal_stop_owner_error(&e, &request_identity),
    }
}

async fn compose_candidate_comparison(
    State(state): State<CandidateComparisonDecisionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: CandidateComparisonCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = request.request_identity.clone();
    if !valid_candidate_comparison_request(&request) {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_CANDIDATE_COMPARISON_PROPOSAL",
            &request_identity,
        );
    }

    match state.owner.compose_candidate_comparison(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => candidate_comparison_owner_error(&e, &request_identity),
    }
}

async fn compose_successor_research_intent(
    State(state): State<SuccessorResearchIntentApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return successor_intent_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: SuccessorResearchIntentCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return successor_intent_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = request.request_identity.clone();
    if [
        request.request_identity.as_str(),
        request.decision_identity.as_str(),
        request.result_identity.as_str(),
    ]
    .into_iter()
    .any(|identity| !is_valid_iteration_decision_locator_v1(identity))
    {
        return successor_intent_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_SUCCESSOR_RESEARCH_INTENT_PROPOSAL",
            &request_identity,
        );
    }

    match state.owner.compose_successor_intent(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => successor_intent_owner_error(&e, &request_identity),
    }
}

async fn resolve_successor_research_intent(
    State(state): State<SuccessorResearchIntentApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return successor_intent_resolution_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: SuccessorResearchIntentResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return successor_intent_resolution_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let intent_identity = locator.intent_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&locator.intent_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
    {
        return successor_intent_resolution_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_SUCCESSOR_RESEARCH_INTENT_LOCATORS",
            &intent_identity,
        );
    }

    match state.owner.resolve_successor_intent(locator).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => successor_intent_resolution_rejection(
            StatusCode::NOT_FOUND,
            "SUCCESSOR_RESEARCH_INTENT_NOT_FOUND",
            &intent_identity,
        ),
        Err(e) => successor_intent_resolution_owner_error(&e, &intent_identity),
    }
}

async fn compose_ready_for_selection(
    State(state): State<ReadyForSelectionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: ReadyForSelectionCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = request.request_identity.clone();
    if !valid_ready_for_selection_request(&request) {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_READY_FOR_SELECTION_PROPOSAL",
            &request_identity,
        );
    }

    match state.owner.compose_ready(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => ready_for_selection_owner_error(&e, &request_identity),
    }
}

async fn resolve_ready_for_selection(
    State(state): State<ReadyForSelectionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return decision_resolution_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: IterationDecisionResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return decision_resolution_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let decision_identity = locator.decision_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return decision_resolution_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &decision_identity,
        );
    }

    match state.owner.resolve_ready(locator).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => decision_resolution_rejection(
            StatusCode::NOT_FOUND,
            "ITERATION_DECISION_NOT_FOUND",
            &decision_identity,
        ),
        Err(e) => decision_resolution_owner_error(&e, &decision_identity),
    }
}

async fn resolve_trial_budget_terminal_stop(
    State(state): State<TrialBudgetTerminalStopApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return decision_resolution_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: IterationDecisionResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return decision_resolution_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let decision_identity = locator.decision_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return decision_resolution_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &decision_identity,
        );
    }

    match state.owner.resolve_trial_budget_stop(locator).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => decision_resolution_rejection(
            StatusCode::NOT_FOUND,
            "ITERATION_DECISION_NOT_FOUND",
            &decision_identity,
        ),
        Err(e) => trial_budget_terminal_stop_resolution_owner_error(&e, &decision_identity),
    }
}

async fn resolve_candidate_comparison(
    State(state): State<CandidateComparisonDecisionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return decision_resolution_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: IterationDecisionResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return decision_resolution_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let decision_identity = locator.decision_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.result_identity)
    {
        return decision_resolution_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &decision_identity,
        );
    }

    match state.owner.resolve_candidate_comparison(locator).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => decision_resolution_rejection(
            StatusCode::NOT_FOUND,
            "ITERATION_DECISION_NOT_FOUND",
            &decision_identity,
        ),
        Err(e) => decision_resolution_owner_error(&e, &decision_identity),
    }
}

async fn compose_repair_action_request(
    State(state): State<RepairActionRequestApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return repair_action_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: RepairActionCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return repair_action_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let decision_identity = request.decision_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&request.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&request.result_identity)
    {
        return repair_action_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_REPAIR_ACTION_REQUEST_LOCATORS",
            &decision_identity,
        );
    }

    match state.owner.compose_repair_action(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => repair_action_owner_error(&e, &decision_identity),
    }
}

async fn resolve_repair_action_request(
    State(state): State<RepairActionRequestApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return repair_action_resolution_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: RepairActionResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return repair_action_resolution_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let action_request_identity = locator.action_request_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&locator.action_request_identity)
        || !is_valid_iteration_decision_locator_v1(&locator.decision_identity)
    {
        return repair_action_resolution_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_REPAIR_ACTION_REQUEST_LOCATORS",
            &action_request_identity,
        );
    }

    match state.owner.resolve_repair_action(locator).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => repair_action_resolution_rejection(
            StatusCode::NOT_FOUND,
            "REPAIR_ACTION_REQUEST_NOT_FOUND",
            &action_request_identity,
        ),
        Err(e) => repair_action_resolution_owner_error(&e, &action_request_identity),
    }
}

fn owner_error(error: &IterationDecisionPostgresErrorV1, request_identity: &str) -> Response {
    owner_error_with(
        error,
        request_identity,
        "INVALID_ITERATION_DECISION_LOCATORS",
        rejection,
    )
}

fn repair_action_owner_error(
    error: &IterationDecisionPostgresErrorV1,
    decision_identity: &str,
) -> Response {
    owner_error_with(
        error,
        decision_identity,
        "INVALID_REPAIR_ACTION_REQUEST_LOCATORS",
        repair_action_rejection,
    )
}

fn trial_budget_terminal_stop_owner_error(
    error: &IterationDecisionPostgresErrorV1,
    request_identity: &str,
) -> Response {
    owner_error_with(
        error,
        request_identity,
        "INVALID_ITERATION_DECISION_LOCATORS",
        rejection,
    )
}

fn ready_for_selection_owner_error(
    error: &IterationDecisionPostgresErrorV1,
    request_identity: &str,
) -> Response {
    owner_error_with(
        error,
        request_identity,
        "INVALID_READY_FOR_SELECTION_PROPOSAL",
        rejection,
    )
}

fn candidate_comparison_owner_error(
    error: &IterationDecisionPostgresErrorV1,
    request_identity: &str,
) -> Response {
    owner_error_with(
        error,
        request_identity,
        "INVALID_CANDIDATE_COMPARISON_PROPOSAL",
        rejection,
    )
}

fn successor_intent_owner_error(
    error: &SuccessorResearchIntentPostgresErrorV1,
    request_identity: &str,
) -> Response {
    successor_intent_owner_error_with(error, request_identity, successor_intent_rejection)
}

fn successor_intent_resolution_owner_error(
    error: &SuccessorResearchIntentPostgresErrorV1,
    intent_identity: &str,
) -> Response {
    successor_intent_owner_error_with(
        error,
        intent_identity,
        successor_intent_resolution_rejection,
    )
}

fn successor_intent_owner_error_with(
    error: &SuccessorResearchIntentPostgresErrorV1,
    correlation_identity: &str,
    reject: fn(StatusCode, &str, &str) -> Response,
) -> Response {
    match error {
        SuccessorResearchIntentPostgresErrorV1::InvalidLocator
        | SuccessorResearchIntentPostgresErrorV1::Intent(
            SuccessorResearchIntentErrorV1::Invalid(_),
        ) => reject(
            StatusCode::BAD_REQUEST,
            "INVALID_SUCCESSOR_RESEARCH_INTENT_PROPOSAL",
            correlation_identity,
        ),
        SuccessorResearchIntentPostgresErrorV1::TrialFamily(_)
        | SuccessorResearchIntentPostgresErrorV1::ResearchCustody(_)
        | SuccessorResearchIntentPostgresErrorV1::Decision(_)
        | SuccessorResearchIntentPostgresErrorV1::Intent(
            SuccessorResearchIntentErrorV1::Encoding(_),
        )
        | SuccessorResearchIntentPostgresErrorV1::Storage(_) => reject(
            StatusCode::SERVICE_UNAVAILABLE,
            "SUCCESSOR_RESEARCH_INTENT_OWNER_UNAVAILABLE",
            correlation_identity,
        ),
    }
}

fn trial_budget_terminal_stop_resolution_owner_error(
    error: &IterationDecisionPostgresErrorV1,
    decision_identity: &str,
) -> Response {
    owner_error_with(
        error,
        decision_identity,
        "INVALID_ITERATION_DECISION_LOCATORS",
        decision_resolution_rejection,
    )
}

fn decision_resolution_owner_error(
    error: &IterationDecisionPostgresErrorV1,
    decision_identity: &str,
) -> Response {
    owner_error_with(
        error,
        decision_identity,
        "INVALID_ITERATION_DECISION_LOCATORS",
        decision_resolution_rejection,
    )
}

fn repair_action_resolution_owner_error(
    error: &IterationDecisionPostgresErrorV1,
    action_request_identity: &str,
) -> Response {
    owner_error_with(
        error,
        action_request_identity,
        "INVALID_REPAIR_ACTION_REQUEST_LOCATORS",
        repair_action_resolution_rejection,
    )
}

fn owner_error_with(
    error: &IterationDecisionPostgresErrorV1,
    correlation_identity: &str,
    invalid_locator_code: &str,
    reject: fn(StatusCode, &str, &str) -> Response,
) -> Response {
    match error {
        IterationDecisionPostgresErrorV1::InvalidLocator => reject(
            StatusCode::BAD_REQUEST,
            invalid_locator_code,
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::NoDecision(_) => reject(
            StatusCode::CONFLICT,
            "ITERATION_DECISION_NOT_AVAILABLE",
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::InterpretationRequired => reject(
            StatusCode::CONFLICT,
            "ITERATION_INTERPRETATION_REQUIRED",
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::TrialBudgetStopNotApplicable => reject(
            StatusCode::CONFLICT,
            "TRIAL_BUDGET_TERMINAL_STOP_NOT_APPLICABLE",
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::ReadyForSelectionNotApplicable => reject(
            StatusCode::CONFLICT,
            "READY_FOR_SELECTION_NOT_APPLICABLE",
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::CandidateComparisonNotApplicable => reject(
            StatusCode::CONFLICT,
            "CANDIDATE_COMPARISON_NOT_APPLICABLE",
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::TrialFamily(_)
        | IterationDecisionPostgresErrorV1::Backtest(_)
        | IterationDecisionPostgresErrorV1::ResearchCustody(_)
        | IterationDecisionPostgresErrorV1::Decision(_)
        | IterationDecisionPostgresErrorV1::RepairAction(_)
        | IterationDecisionPostgresErrorV1::Storage(_) => reject(
            StatusCode::SERVICE_UNAVAILABLE,
            "ITERATION_DECISION_OWNER_UNAVAILABLE",
            correlation_identity,
        ),
    }
}

fn valid_candidate_comparison_request(request: &CandidateComparisonCompositionRequestV1) -> bool {
    let evaluations = &request.candidate_evaluations;
    let valid_reference = |reference: &vibe_strategy_factory::IterationEvidenceReferenceV1| {
        is_valid_iteration_decision_locator_v1(&reference.identity)
            && valid_sha256(&reference.digest)
    };
    [
        request.trial_family_identity.as_str(),
        request.result_identity.as_str(),
        request.request_identity.as_str(),
        request.attempt_identity.as_str(),
        evaluations.frontier_identity.as_str(),
        evaluations.generation_rule_identity.as_str(),
    ]
    .into_iter()
    .all(is_valid_iteration_decision_locator_v1)
        && valid_sha256(&evaluations.frontier_digest)
        && valid_sha256(&evaluations.generation_rule_digest)
        && valid_reference(&evaluations.threshold)
        && evaluations.expected_cardinality > 0
        && usize::try_from(evaluations.expected_cardinality)
            .is_ok_and(|expected| expected == evaluations.candidates.len())
        && evaluations.candidates.len() <= 4_096
        && evaluations.candidates.iter().all(|candidate| {
            let evidence = &candidate.information_value;
            is_valid_iteration_decision_locator_v1(&candidate.candidate_identity)
                && valid_sha256(&candidate.candidate_digest)
                && is_valid_iteration_decision_locator_v1(&candidate.tie_break_key)
                && valid_reference(&evidence.decision_uncertainty)
                && valid_reference(&evidence.distinguishing_observation_or_falsifier)
                && valid_reference(&evidence.result_to_action_map)
                && valid_reference(&evidence.bounded_acquisition_cost)
                && valid_reference(&evidence.remaining_family_budget_effect)
                && valid_reference(&evidence.ordinal_rationale)
                && !evidence.competing_alternatives.is_empty()
                && evidence.competing_alternatives.len() <= 4_096
                && evidence.competing_alternatives.iter().all(valid_reference)
        })
}

fn valid_ready_for_selection_request(request: &ReadyForSelectionCompositionRequestV1) -> bool {
    let locators = [
        request.trial_family_identity.as_str(),
        request.result_identity.as_str(),
        request.request_identity.as_str(),
        request.attempt_identity.as_str(),
    ];
    let dimensions = [
        request.positive_evidence.mechanism_validity.as_slice(),
        request.positive_evidence.economic_viability.as_slice(),
        request.positive_evidence.robustness.as_slice(),
        request.positive_evidence.information_value.as_slice(),
    ];
    let plan = &request.protected_robustness_plan;
    let instrument_cells = if plan.required_instrument_slices.is_empty() {
        plan.instrument_non_applicability_basis.iter().collect()
    } else {
        plan.required_instrument_slices.iter().collect()
    };
    let parameter_cells = if plan.required_parameter_neighborhoods.is_empty() {
        plan.no_tunable_parameters_basis.iter().collect()
    } else {
        plan.required_parameter_neighborhoods
            .iter()
            .map(|entry| &entry.parameter)
            .collect()
    };
    let plan_dimensions = [
        plan.required_time_windows
            .iter()
            .map(|entry| &entry.evidence)
            .collect::<Vec<_>>(),
        plan.required_regimes
            .iter()
            .map(|entry| &entry.evidence)
            .collect(),
        instrument_cells,
        plan.required_perturbations
            .iter()
            .map(|entry| &entry.perturbation)
            .collect(),
        parameter_cells,
    ];
    let plan_policies = [
        &plan.metric,
        &plan.coverage_policy,
        &plan.tolerance_policy,
        &plan.threshold_policy,
        &plan.aggregation_policy,
        &plan.missing_cell_policy,
        &plan.stop_policy,
        &plan.purge_policy,
        &plan.embargo_policy,
        &plan.multiplicity_policy,
    ];
    let valid_reference = |reference: &vibe_strategy_factory::iteration_decision::PositiveAssessmentEvidenceReferenceV1| {
        is_valid_iteration_decision_locator_v1(&reference.identity)
            && valid_sha256(&reference.digest)
    };
    let mut assessment_identities = BTreeSet::new();
    let mut assessment_digests = BTreeSet::new();
    let assessment_is_finite = dimensions.iter().all(|dimension| {
        !dimension.is_empty()
            && dimension.len() <= 16
            && dimension.iter().all(|reference| {
                valid_reference(reference)
                    && assessment_identities.insert(reference.identity.as_str())
                    && assessment_digests.insert(reference.digest.as_str())
            })
    });
    let mut plan_cell_count = 1usize;
    let mut plan_cell_identities = BTreeSet::new();
    let mut plan_cell_digests = BTreeSet::new();
    let plan_is_finite = plan_dimensions.iter().all(|dimension| {
        !dimension.is_empty()
            && dimension.len() <= 16
            && dimension.iter().all(|reference| {
                valid_reference(reference)
                    && plan_cell_identities.insert(reference.identity.as_str())
                    && plan_cell_digests.insert(reference.digest.as_str())
            })
            && plan_cell_count
                .checked_mul(dimension.len())
                .filter(|count| *count <= 4_096)
                .is_some_and(|count| {
                    plan_cell_count = count;
                    true
                })
    });
    locators
        .into_iter()
        .all(is_valid_iteration_decision_locator_v1)
        && assessment_is_finite
        && plan_is_finite
        && plan_policies.into_iter().all(valid_reference)
        && plan
            .required_time_windows
            .iter()
            .all(|window| window.start_epoch_ms < window.end_epoch_ms)
        && plan.required_perturbations.iter().all(|entry| {
            valid_reference(&entry.input_class) && valid_reference(&entry.perturbation)
        })
        && plan
            .required_parameter_neighborhoods
            .iter()
            .all(|entry| entry.lower < entry.center && entry.center < entry.upper)
        && (plan.required_parameter_neighborhoods.is_empty()
            != plan.no_tunable_parameters_basis.is_none())
        && !(plan.instrument_scope
            == vibe_strategy_factory::iteration_decision::ProtectedInstrumentScopeV1::MultipleInstruments
            && plan.instrument_non_applicability_basis.is_some())
        && plan.preregistered_capacity_ceiling > 0
        && plan.protected_decision_policy.version > 0
        && is_valid_iteration_decision_locator_v1(&plan.protected_decision_policy.identity)
        && valid_sha256(&plan.protected_decision_policy.digest)
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
    correlated_rejection(status, code, "request_identity", request_identity)
}

fn repair_action_rejection(status: StatusCode, code: &str, decision_identity: &str) -> Response {
    correlated_rejection(status, code, "decision_identity", decision_identity)
}

fn decision_resolution_rejection(
    status: StatusCode,
    code: &str,
    decision_identity: &str,
) -> Response {
    correlated_rejection(status, code, "decision_identity", decision_identity)
}

fn repair_action_resolution_rejection(
    status: StatusCode,
    code: &str,
    action_request_identity: &str,
) -> Response {
    correlated_rejection(
        status,
        code,
        "action_request_identity",
        action_request_identity,
    )
}

fn successor_intent_rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
    correlated_rejection(status, code, "request_identity", request_identity)
}

fn successor_intent_resolution_rejection(
    status: StatusCode,
    code: &str,
    intent_identity: &str,
) -> Response {
    correlated_rejection(status, code, "intent_identity", intent_identity)
}

fn correlated_rejection(
    status: StatusCode,
    code: &str,
    identity_field: &str,
    identity: &str,
) -> Response {
    let mut body = serde_json::Map::new();
    body.insert(identity_field.to_string(), json!(identity));
    body.insert("error".to_string(), json!(code));
    let mut response = (status, Json(serde_json::Value::Object(body))).into_response();
    insert_rejection_code(&mut response, code);
    response
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use sha2::Digest as _;
    use tower::ServiceExt;
    use vibe_strategy_factory::iteration_decision::{
        IterationNoDecisionReasonV1, IterationRepairTargetV1, IterationTerminalStopReasonV1,
    };

    struct DecisionOwnerStub {
        calls: AtomicUsize,
        resolve_calls: AtomicUsize,
        response: Option<RepairInputDecisionActionResponseV1>,
    }

    struct RepairActionOwnerStub {
        calls: AtomicUsize,
        resolve_calls: AtomicUsize,
        response: Option<RepairActionRequestActionResponseV1>,
    }

    struct TrialBudgetStopOwnerStub {
        calls: AtomicUsize,
        resolve_calls: AtomicUsize,
        response: Option<TrialBudgetTerminalStopActionResponseV1>,
    }

    struct CandidateComparisonOwnerStub {
        calls: AtomicUsize,
        resolve_calls: AtomicUsize,
        response: Option<CandidateComparisonDecisionActionResponseV1>,
    }

    struct SuccessorResearchIntentOwnerStub {
        calls: AtomicUsize,
        resolve_calls: AtomicUsize,
        response: Option<SuccessorResearchIntentActionResponseV1>,
    }

    struct ReadyForSelectionOwnerStub {
        calls: AtomicUsize,
        resolve_calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl ReadyForSelectionActionPort for ReadyForSelectionOwnerStub {
        async fn compose_ready(
            &self,
            _request: ReadyForSelectionCompositionRequestV1,
        ) -> Result<ReadyForSelectionActionResponseV1, IterationDecisionPostgresErrorV1> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Err(IterationDecisionPostgresErrorV1::ReadyForSelectionNotApplicable)
        }

        async fn resolve_ready(
            &self,
            _locator: IterationDecisionResolutionLocatorV1,
        ) -> Result<Option<ReadyForSelectionActionResponseV1>, IterationDecisionPostgresErrorV1>
        {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }
    }

    struct UnifiedDecisionOwnerStub {
        resolve_calls: AtomicUsize,
        response: Option<UnifiedIterationDecisionResponseV1>,
    }

    struct ResearchIterationActionOwnerStub {
        resolve_calls: AtomicUsize,
        response: ResearchIterationActionResponseV1,
    }

    #[async_trait::async_trait]
    impl IterationDecisionReadPort for UnifiedDecisionOwnerStub {
        async fn resolve_decision(
            &self,
            _locator: IterationDecisionResolutionLocatorV1,
        ) -> Result<Option<UnifiedIterationDecisionResponseV1>, IterationDecisionPostgresErrorV1>
        {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.response.clone())
        }
    }

    #[async_trait::async_trait]
    impl ResearchIterationActionReadPort for ResearchIterationActionOwnerStub {
        async fn resolve_action(
            &self,
            _locator: IterationDecisionResolutionLocatorV1,
        ) -> Result<ResearchIterationActionResponseV1, IterationDecisionPostgresErrorV1> {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.response.clone())
        }
    }

    #[async_trait::async_trait]
    impl TrialBudgetTerminalStopActionPort for TrialBudgetStopOwnerStub {
        async fn compose_trial_budget_stop(
            &self,
            _request: DecisionCompositionRequestV1,
        ) -> Result<TrialBudgetTerminalStopActionResponseV1, IterationDecisionPostgresErrorV1>
        {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response
                .clone()
                .ok_or(IterationDecisionPostgresErrorV1::TrialBudgetStopNotApplicable)
        }

        async fn resolve_trial_budget_stop(
            &self,
            _locator: IterationDecisionResolutionLocatorV1,
        ) -> Result<Option<TrialBudgetTerminalStopActionResponseV1>, IterationDecisionPostgresErrorV1>
        {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.response.clone())
        }
    }

    #[async_trait::async_trait]
    impl CandidateComparisonDecisionActionPort for CandidateComparisonOwnerStub {
        async fn compose_candidate_comparison(
            &self,
            _request: CandidateComparisonCompositionRequestV1,
        ) -> Result<CandidateComparisonDecisionActionResponseV1, IterationDecisionPostgresErrorV1>
        {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response
                .clone()
                .ok_or(IterationDecisionPostgresErrorV1::CandidateComparisonNotApplicable)
        }

        async fn resolve_candidate_comparison(
            &self,
            _locator: IterationDecisionResolutionLocatorV1,
        ) -> Result<
            Option<CandidateComparisonDecisionActionResponseV1>,
            IterationDecisionPostgresErrorV1,
        > {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.response.clone())
        }
    }

    #[async_trait::async_trait]
    impl SuccessorResearchIntentActionPort for SuccessorResearchIntentOwnerStub {
        async fn compose_successor_intent(
            &self,
            _request: SuccessorResearchIntentCompositionRequestV1,
        ) -> Result<SuccessorResearchIntentActionResponseV1, SuccessorResearchIntentPostgresErrorV1>
        {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response.clone().ok_or_else(|| {
                SuccessorResearchIntentPostgresErrorV1::Storage(
                    "test successor Intent unavailable".into(),
                )
            })
        }

        async fn resolve_successor_intent(
            &self,
            _locator: SuccessorResearchIntentResolutionLocatorV1,
        ) -> Result<
            Option<SuccessorResearchIntentActionResponseV1>,
            SuccessorResearchIntentPostgresErrorV1,
        > {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.response.clone())
        }
    }

    #[async_trait::async_trait]
    impl RepairActionRequestActionPort for RepairActionOwnerStub {
        async fn compose_repair_action(
            &self,
            _request: RepairActionCompositionRequestV1,
        ) -> Result<RepairActionRequestActionResponseV1, IterationDecisionPostgresErrorV1> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response.clone().ok_or_else(|| {
                IterationDecisionPostgresErrorV1::Storage("test owner unavailable".into())
            })
        }

        async fn resolve_repair_action(
            &self,
            _locator: RepairActionResolutionLocatorV1,
        ) -> Result<Option<RepairActionRequestActionResponseV1>, IterationDecisionPostgresErrorV1>
        {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.response.clone())
        }
    }

    #[async_trait::async_trait]
    impl RepairInputDecisionActionPort for DecisionOwnerStub {
        async fn compose(
            &self,
            _request: DecisionCompositionRequestV1,
        ) -> Result<RepairInputDecisionActionResponseV1, IterationDecisionPostgresErrorV1> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response
                .clone()
                .ok_or(IterationDecisionPostgresErrorV1::NoDecision(
                    IterationNoDecisionReasonV1::UnknownOrNonterminalResult,
                ))
        }

        async fn resolve(
            &self,
            _locator: IterationDecisionResolutionLocatorV1,
        ) -> Result<Option<RepairInputDecisionActionResponseV1>, IterationDecisionPostgresErrorV1>
        {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.response.clone())
        }
    }

    fn request() -> serde_json::Value {
        json!({
            "trial_family_identity": "family-1",
            "result_identity": "result-1",
            "request_identity": "request-1",
            "attempt_identity": "attempt-1",
        })
    }

    fn ready_request() -> serde_json::Value {
        let reference = |identity: &str, ordinal: u8| {
            json!({
                "identity": identity,
                "digest": format!("sha256:{ordinal:064x}"),
            })
        };
        json!({
            "trial_family_identity": "family-1",
            "result_identity": "result-1",
            "request_identity": "request-1",
            "attempt_identity": "attempt-1",
            "positive_evidence": {
                "mechanism_validity": [reference("mechanism-evidence-1", 1)],
                "economic_viability": [reference("economic-evidence-1", 2)],
                "robustness": [reference("robustness-evidence-1", 3)],
                "information_value": [reference("information-evidence-1", 4)]
            },
            "protected_robustness_plan": {
                "required_time_windows": [{
                    "evidence": reference("protected-time-window-1", 5),
                    "start_epoch_ms": 1_000,
                    "end_epoch_ms": 2_000
                }],
                "required_regimes": [{
                    "evidence": reference("protected-regime-1", 6),
                    "adverse": true
                }],
                "required_instrument_slices": [reference("protected-instrument-slice-1", 7)],
                "instrument_scope": "SINGLE_INSTRUMENT",
                "instrument_non_applicability_basis": null,
                "required_perturbations": [{
                    "input_class": reference("protected-input-class-1", 8),
                    "perturbation": reference("protected-perturbation-1", 9)
                }],
                "required_parameter_neighborhoods": [{
                    "parameter": reference("protected-parameter-1", 10),
                    "lower": -1,
                    "center": 0,
                    "upper": 1
                }],
                "no_tunable_parameters_basis": null,
                "preregistered_capacity_ceiling": 1_000,
                "metric": reference("protected-metric-1", 11),
                "coverage_policy": reference("protected-coverage-policy-1", 12),
                "tolerance_policy": reference("protected-tolerance-policy-1", 13),
                "threshold_policy": reference("protected-threshold-policy-1", 14),
                "aggregation_policy": reference("protected-aggregation-policy-1", 15),
                "missing_cell_policy": reference("protected-missing-cell-policy-1", 16),
                "stop_policy": reference("protected-stop-policy-1", 17),
                "purge_policy": reference("protected-purge-policy-1", 18),
                "embargo_policy": reference("protected-embargo-policy-1", 19),
                "multiplicity_policy": reference("protected-multiplicity-policy-1", 20),
                "protected_decision_policy": {
                    "identity": "protected-decision-policy-1",
                    "version": 1,
                    "digest": format!("sha256:{:064x}", 21)
                }
            }
        })
    }

    fn candidate_comparison_request() -> serde_json::Value {
        let reference = |identity: &str, byte: char| {
            json!({
                "identity": identity,
                "digest": format!("sha256:{}", byte.to_string().repeat(64)),
            })
        };
        json!({
            "trial_family_identity": "family-1",
            "result_identity": "result-1",
            "request_identity": "request-1",
            "attempt_identity": "attempt-1",
            "candidate_evaluations": {
                "frontier_identity": "candidate-frontier-1",
                "frontier_digest": format!("sha256:{}", "1".repeat(64)),
                "generation_rule_identity": "candidate-generation-rule-1",
                "generation_rule_digest": format!("sha256:{}", "2".repeat(64)),
                "expected_cardinality": 1,
                "threshold": reference("rd.iteration-information-value-threshold.v1", '3'),
                "candidates": [{
                    "candidate_identity": "candidate-successor-1",
                    "candidate_digest": format!("sha256:{}", "4".repeat(64)),
                    "admissibility": { "status": "ADMISSIBLE_ABOVE_THRESHOLD" },
                    "information_value": {
                        "decision_uncertainty": reference("decision-uncertainty-1", '5'),
                        "distinguishing_observation_or_falsifier": reference("falsifier-1", '6'),
                        "result_to_action_map": reference("result-action-map-1", '7'),
                        "bounded_acquisition_cost": reference("acquisition-cost-1", '8'),
                        "remaining_family_budget_effect": reference("family-budget-effect-1", '9'),
                        "competing_alternatives": [reference("alternative-1", 'a')],
                        "ordinal_rationale": reference("ordinal-rationale-1", 'b')
                    },
                    "uncertainty_reduction_rank": 1,
                    "tie_break_key": "successor-order-1",
                    "experiment": {
                        "mode": "SINGLE_DIMENSION",
                        "changed_dimension": "RETURN_MECHANISM"
                    }
                }]
            }
        })
    }

    fn successor_research_intent_request() -> serde_json::Value {
        json!({
            "request_identity": "successor-intent-request-1",
            "decision_identity": "decision-successor-1",
            "result_identity": "result-1",
            "goal": {
                "hypothesis": "A narrower entry signal improves net returns.",
                "mechanism": "The entry filter removes low-conviction observations.",
                "falsification_question": "Does the filtered signal fail after costs?",
                "expected_observation": "Higher net expectancy with bounded turnover.",
                "required_data": ["sealed market bars"],
                "cost_assumption": "Canonical cost model remains fixed.",
                "capacity_assumption": "Canonical capacity model remains fixed."
            }
        })
    }

    fn successor_research_intent_resolution_locator() -> serde_json::Value {
        json!({
            "intent_identity": "successor-intent-1",
            "decision_identity": "decision-successor-1",
        })
    }

    fn response() -> RepairInputDecisionActionResponseV1 {
        let evidence_cut = IterationDecisionEvidenceCutV1 {
            decision_policy_identity: "policy-1".into(),
            decision_policy_version: 1,
            decision_policy_digest: [1; 32],
            decision_policy_binding_digest: [2; 32],
            trial_family_identity: "family-1".into(),
            census_frontier_identity: "census-1".into(),
            census_frontier_digest: format!("sha256:{}", "3".repeat(64)),
            attempt_frontier_identity: "attempt-frontier-1".into(),
            attempt_frontier_digest: format!("sha256:{}", "4".repeat(64)),
            candidate_set_frontier_identity: "candidate-frontier-1".into(),
            candidate_set_frontier_digest: format!("sha256:{}", "5".repeat(64)),
            request_identity: "request-1".into(),
            request_digest: format!("sha256:{}", "6".repeat(64)),
            result_identity: "result-1".into(),
            result_digest: format!("sha256:{}", "7".repeat(64)),
            attempt_identity: "attempt-1".into(),
        };
        RepairInputDecisionActionResponseV1 {
            schema_version: 1,
            decision_identity: "decision-1".into(),
            decision_digest: format!("sha256:{}", "8".repeat(64)),
            evidence_cut,
            outcome: IterationDecisionOutcomeV1::RepairInputs {
                category: IterationRepairCategoryV1::MarketData,
                target: IterationRepairTargetV1::MarketData,
            },
            supported_defects: vec![IterationRepairCategoryV1::MarketData],
            receipt_identity: "decision-receipt-1".into(),
            result_identity: "result-1".into(),
            committed_at_epoch_ms: 17,
        }
    }

    fn repair_action_request() -> serde_json::Value {
        json!({
            "decision_identity": "decision-1",
            "result_identity": "result-1",
        })
    }

    fn decision_resolution_locator() -> serde_json::Value {
        json!({
            "decision_identity": "decision-1",
            "result_identity": "result-1",
        })
    }

    fn repair_action_resolution_locator() -> serde_json::Value {
        json!({
            "action_request_identity": "repair-action-1",
            "decision_identity": "decision-1",
        })
    }

    fn repair_action_response() -> RepairActionRequestActionResponseV1 {
        RepairActionRequestActionResponseV1 {
            schema_version: 1,
            action_request_identity: "repair-action-1".into(),
            action_request_digest: format!("sha256:{}", "a".repeat(64)),
            decision_identity: "decision-1".into(),
            decision_digest: format!("sha256:{}", "b".repeat(64)),
            result_identity: "result-1".into(),
            category: IterationRepairCategoryV1::MarketData,
            target: IterationRepairTargetV1::MarketData,
            receipt_identity: "repair-action-receipt-1".into(),
            receipt_digest: format!("sha256:{}", "c".repeat(64)),
            committed_at_epoch_ms: 19,
        }
    }

    fn trial_budget_stop_response() -> TrialBudgetTerminalStopActionResponseV1 {
        let repair_response = response();
        TrialBudgetTerminalStopActionResponseV1 {
            schema_version: 1,
            decision_identity: "decision-budget-stop-1".into(),
            decision_digest: format!("sha256:{}", "d".repeat(64)),
            evidence_cut: repair_response.evidence_cut,
            outcome: IterationDecisionOutcomeV1::TerminalStop {
                reason: IterationTerminalStopReasonV1::TrialBudgetExhausted,
            },
            consumed_trial_budget: 3,
            trial_budget: 3,
            receipt_identity: "decision-budget-stop-receipt-1".into(),
            result_identity: "result-1".into(),
            committed_at_epoch_ms: 23,
        }
    }

    fn ready_response() -> ReadyForSelectionActionResponseV1 {
        let repair_response = response();
        let parsed: ReadyForSelectionCompositionRequestV1 =
            serde_json::from_value(ready_request()).expect("ready request");
        let candidate_identity = "candidate-ready-1".to_string();
        let candidate_digest = format!("sha256:{}", "a".repeat(64));
        ReadyForSelectionActionResponseV1 {
            schema_version: 1,
            assessment_identity: "assessment-ready-1".into(),
            assessment_digest: format!("sha256:{}", "e".repeat(64)),
            decision_identity: "decision-ready-1".into(),
            decision_digest: format!("sha256:{}", "f".repeat(64)),
            evidence_cut: repair_response.evidence_cut,
            outcome: IterationDecisionOutcomeV1::ReadyForSelection {
                candidate_identity: candidate_identity.clone(),
                candidate_digest: candidate_digest.clone(),
            },
            candidate_identity,
            candidate_digest,
            positive_evidence: parsed.positive_evidence,
            protected_robustness_plan_identity: "protected-plan-ready-1".into(),
            protected_robustness_plan_version: 1,
            protected_robustness_plan_digest: format!("sha256:{}", "b".repeat(64)),
            selection_identity: "research-selection-ready-1".into(),
            selection_digest: format!("sha256:{}", "c".repeat(64)),
            selection_disposition: ResearchSelectionDispositionV1::SelectedForQualification,
            receipt_identity: "decision-ready-receipt-1".into(),
            selection_receipt_identity: "research-selection-receipt-ready-1".into(),
            result_identity: "result-1".into(),
            committed_at_epoch_ms: 29,
        }
    }

    fn candidate_comparison_response() -> CandidateComparisonDecisionActionResponseV1 {
        let repair_response = response();
        let parsed: CandidateComparisonCompositionRequestV1 =
            serde_json::from_value(candidate_comparison_request()).expect("candidate request");
        CandidateComparisonDecisionActionResponseV1 {
            schema_version: 1,
            decision_identity: "decision-successor-1".into(),
            decision_digest: format!("sha256:{}", "c".repeat(64)),
            evidence_cut: repair_response.evidence_cut,
            outcome: IterationDecisionOutcomeV1::SuccessorExperiment {
                experiment_identity: "candidate-successor-1".into(),
                experiment_digest: format!("sha256:{}", "4".repeat(64)),
            },
            candidate_evaluations: parsed.candidate_evaluations,
            receipt_identity: "decision-successor-receipt-1".into(),
            result_identity: "result-1".into(),
            committed_at_epoch_ms: 31,
        }
    }

    fn successor_research_intent_response() -> SuccessorResearchIntentActionResponseV1 {
        SuccessorResearchIntentActionResponseV1 {
            schema_version: 1,
            intent_identity: "successor-intent-1".into(),
            intent_digest: format!("sha256:{}", "1".repeat(64)),
            request_identity: "successor-intent-request-1".into(),
            goal: vibe_strategy_factory::product_edge::SourcedResearchGoalV2 {
                hypothesis: "A narrower entry signal improves net returns.".into(),
                mechanism: "The entry filter removes low-conviction observations.".into(),
                falsification_question: "Does the filtered signal fail after costs?".into(),
                expected_observation: "Higher net expectancy with bounded turnover.".into(),
                required_data: vec!["sealed market bars".into()],
                cost_assumption: "Canonical cost model remains fixed.".into(),
                capacity_assumption: "Canonical capacity model remains fixed.".into(),
                sources: vec![vibe_strategy_factory::product_edge::ResearchSourceV1 {
                    locator: "urn:research:source:1".into(),
                    content_digest: format!("sha256:{}", "2".repeat(64)),
                    observed_at: "2026-09-14T00:00:00Z".into(),
                    source_cut: "sealed-source-cut".into(),
                    license_basis: "internal research evidence".into(),
                    interpretation: "Inherited from predecessor Intent custody.".into(),
                }],
            },
            predecessor_intent_identity: "predecessor-intent-1".into(),
            predecessor_intent_digest: format!("sha256:{}", "3".repeat(64)),
            decision_identity: "decision-successor-1".into(),
            decision_digest: format!("sha256:{}", "4".repeat(64)),
            result_identity: "result-1".into(),
            trial_family_identity: "family-1".into(),
            trial_family_policy_digest: format!("sha256:{}", "5".repeat(64)),
            census_frontier_identity: "census-1".into(),
            census_frontier_digest: format!("sha256:{}", "6".repeat(64)),
            independence_basis_identity: "basis-1".into(),
            independence_basis_digest: format!("sha256:{}", "7".repeat(64)),
            protected_feedback_projection_identity: "protected-feedback-1".into(),
            protected_feedback_projection_digest: format!("sha256:{}", "8".repeat(64)),
            experiment_identity: "candidate-successor-1".into(),
            experiment_digest: format!("sha256:{}", "9".repeat(64)),
            experiment: vibe_strategy_factory::IterationExperimentModeV1::SingleDimension {
                changed_dimension:
                    vibe_strategy_factory::IterationHypothesisDimensionV1::ReturnMechanism,
            },
            frozen_at_epoch_ms: 37,
            receipt_identity: "successor-intent-receipt-1".into(),
            committed_at_epoch_ms: 37,
        }
    }

    fn research_iteration_action_response() -> ResearchIterationActionResponseV1 {
        ResearchIterationActionResponseV1 {
            schema_version: 1,
            decision_identity: "decision-successor-1".into(),
            result_identity: "result-1".into(),
            action: ResearchIterationActionV1::CreateSuccessorIntent {
                decision_digest: format!("sha256:{}", "c".repeat(64)),
                decision_receipt_identity: "decision-successor-receipt-1".into(),
                experiment_identity: "candidate-successor-1".into(),
                experiment_digest: format!("sha256:{}", "4".repeat(64)),
            },
        }
    }

    fn send(
        body: serde_json::Value,
        authorization: Option<&str>,
    ) -> axum::http::Request<axum::body::Body> {
        send_to("/v1/iteration-decisions/repair-inputs", body, authorization)
    }

    #[expect(
        clippy::needless_pass_by_value,
        reason = "the test helper owns the exact JSON request snapshot used to construct the HTTP body"
    )]
    fn send_to(
        uri: &str,
        body: serde_json::Value,
        authorization: Option<&str>,
    ) -> axum::http::Request<axum::body::Body> {
        let mut request = axum::http::Request::builder()
            .method(axum::http::Method::POST)
            .uri(uri)
            .header(axum::http::header::CONTENT_TYPE, "application/json");
        if let Some(authorization) = authorization {
            request = request.header(axum::http::header::AUTHORIZATION, authorization);
        }
        request
            .body(axum::body::Body::from(body.to_string()))
            .expect("HTTP request")
    }

    async fn response_json(response: Response) -> serde_json::Value {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response bytes");
        serde_json::from_slice(&body).expect("response JSON")
    }

    #[rstest::rstest]
    fn request_accepts_only_the_four_owner_locators() {
        serde_json::from_value::<DecisionCompositionRequestV1>(request())
            .expect("exact decision request");
        let mut injected = request();
        injected["diagnosis"] = json!({ "category": "MARKET_DATA" });
        assert!(serde_json::from_value::<DecisionCompositionRequestV1>(injected).is_err());
    }

    #[tokio::test]
    async fn rejection_stops_before_owner_and_keeps_the_request_unresolved() {
        let token = "iteration-decision-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(DecisionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: None,
        });
        let unauthorized = action_router(owner.clone(), token_digest)
            .oneshot(send(request(), None))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut invalid = request();
        for invalid_identity in ["a", "result/1"] {
            invalid["result_identity"] = json!(invalid_identity);
            let response = action_router(owner.clone(), token_digest)
                .oneshot(send(invalid.clone(), Some(&format!("Bearer {token}"))))
                .await
                .expect("router response");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
        }

        let no_decision = action_router(owner.clone(), token_digest)
            .oneshot(send(request(), Some(&format!("Bearer {token}"))))
            .await
            .expect("router response");
        assert_eq!(no_decision.status(), StatusCode::CONFLICT);
        assert_eq!(
            response_json(no_decision).await,
            json!({
                "request_identity": "request-1",
                "error": "ITERATION_DECISION_NOT_AVAILABLE",
            })
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn exact_retry_returns_the_same_typed_owner_response() {
        let token = "iteration-decision-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = response();
        let owner = Arc::new(DecisionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let mut bodies = Vec::new();

        for _ in 0..2 {
            let response = action_router(owner.clone(), token_digest)
                .oneshot(send(request(), Some(&format!("Bearer {token}"))))
                .await
                .expect("router response");
            assert_eq!(response.status(), StatusCode::OK);
            bodies.push(
                axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .expect("typed response bytes"),
            );
        }
        assert_eq!(owner.calls.load(Ordering::SeqCst), 2);
        assert_eq!(bodies[0], bodies[1]);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bodies[0]).expect("typed response JSON"),
            serde_json::to_value(expected).expect("expected response JSON"),
        );
    }

    #[rstest::rstest]
    fn repair_action_request_accepts_only_decision_and_result_locators() {
        serde_json::from_value::<RepairActionCompositionRequestV1>(repair_action_request())
            .expect("exact repair action request");
        let mut injected = repair_action_request();
        injected["execution"] = json!({ "provider": "caller-controlled" });
        assert!(serde_json::from_value::<RepairActionCompositionRequestV1>(injected).is_err());
    }

    #[tokio::test]
    async fn repair_action_rejections_stop_before_owner() {
        let token = "repair-action-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(RepairActionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: None,
        });
        let unauthorized = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests",
                repair_action_request(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut invalid = repair_action_request();
        invalid["decision_identity"] = json!("decision/1");
        let invalid = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests",
                invalid,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(invalid).await,
            json!({
                "decision_identity": "decision/1",
                "error": "INVALID_REPAIR_ACTION_REQUEST_LOCATORS",
            })
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let unavailable = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests",
                repair_action_request(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(unavailable).await,
            json!({
                "decision_identity": "decision-1",
                "error": "ITERATION_DECISION_OWNER_UNAVAILABLE",
            })
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn repair_action_exact_retry_returns_the_same_typed_owner_response() {
        let token = "repair-action-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = repair_action_response();
        let owner = Arc::new(RepairActionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let mut bodies = Vec::new();

        for _ in 0..2 {
            let response = repair_action_router(owner.clone(), token_digest)
                .oneshot(send_to(
                    "/v1/repair-action-requests",
                    repair_action_request(),
                    Some(&format!("Bearer {token}")),
                ))
                .await
                .expect("router response");
            assert_eq!(response.status(), StatusCode::OK);
            bodies.push(
                axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .expect("typed response bytes"),
            );
        }
        assert_eq!(owner.calls.load(Ordering::SeqCst), 2);
        assert_eq!(bodies[0], bodies[1]);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bodies[0]).expect("typed response JSON"),
            serde_json::to_value(expected).expect("expected response JSON"),
        );
    }

    #[tokio::test]
    async fn decision_resolve_returns_only_existing_owner_custody() {
        let token = "iteration-decision-resolve-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = response();
        let owner = Arc::new(DecisionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let unauthorized = action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/repair-inputs/resolve",
                decision_resolution_locator(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        let mut invalid = decision_resolution_locator();
        invalid["decision_identity"] = json!("decision/1");
        let invalid = action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/repair-inputs/resolve",
                invalid,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 0);
        let resolved = action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/repair-inputs/resolve",
                decision_resolution_locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);

        let missing = Arc::new(DecisionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: None,
        });
        let absent = action_router(missing.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/repair-inputs/resolve",
                decision_resolution_locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(absent.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response_json(absent).await,
            json!({
                "decision_identity": "decision-1",
                "error": "ITERATION_DECISION_NOT_FOUND",
            })
        );
        assert_eq!(missing.calls.load(Ordering::SeqCst), 0);
        assert_eq!(missing.resolve_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn repair_action_resolve_rejects_injection_and_returns_only_existing_custody() {
        let token = "repair-action-resolve-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = repair_action_response();
        let owner = Arc::new(RepairActionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let unauthorized = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests/resolve",
                repair_action_resolution_locator(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        let mut invalid = repair_action_resolution_locator();
        invalid["execution"] = json!({"provider": "caller-selected"});
        let rejected = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests/resolve",
                invalid,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 0);
        let mut invalid = repair_action_resolution_locator();
        invalid["action_request_identity"] = json!("repair/action");
        let rejected = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests/resolve",
                invalid,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 0);

        let resolved = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests/resolve",
                repair_action_resolution_locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);

        let missing = Arc::new(RepairActionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: None,
        });
        let absent = repair_action_router(missing.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests/resolve",
                repair_action_resolution_locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(absent.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response_json(absent).await,
            json!({
                "action_request_identity": "repair-action-1",
                "error": "REPAIR_ACTION_REQUEST_NOT_FOUND",
            })
        );
        assert_eq!(missing.calls.load(Ordering::SeqCst), 0);
        assert_eq!(missing.resolve_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn trial_budget_stop_rejections_stop_before_owner_and_preserve_correlation() {
        let token = "trial-budget-stop-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(TrialBudgetStopOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: None,
        });
        let unauthorized = trial_budget_terminal_stop_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/trial-budget-terminal-stop",
                request(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut injected = request();
        injected["outcome"] = json!({"terminal_stop": "caller-controlled"});
        let rejected = trial_budget_terminal_stop_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/trial-budget-terminal-stop",
                injected,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let not_applicable = trial_budget_terminal_stop_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/trial-budget-terminal-stop",
                request(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(not_applicable.status(), StatusCode::CONFLICT);
        assert_eq!(
            response_json(not_applicable).await,
            json!({
                "request_identity": "request-1",
                "error": "TRIAL_BUDGET_TERMINAL_STOP_NOT_APPLICABLE",
            })
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn trial_budget_stop_retry_and_resolve_return_exact_owner_custody() {
        let token = "trial-budget-stop-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = trial_budget_stop_response();
        let owner = Arc::new(TrialBudgetStopOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let mut bodies = Vec::new();

        for _ in 0..2 {
            let response = trial_budget_terminal_stop_router(owner.clone(), token_digest)
                .oneshot(send_to(
                    "/v1/iteration-decisions/trial-budget-terminal-stop",
                    request(),
                    Some(&format!("Bearer {token}")),
                ))
                .await
                .expect("router response");
            assert_eq!(response.status(), StatusCode::OK);
            bodies.push(response_json(response).await);
        }
        assert_eq!(bodies, vec![serde_json::to_value(&expected).unwrap(); 2]);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 2);

        let resolved = trial_budget_terminal_stop_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/trial-budget-terminal-stop/resolve",
                json!({
                    "decision_identity": "decision-budget-stop-1",
                    "result_identity": "result-1",
                }),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn candidate_comparison_rejects_outcome_authority_before_owner() {
        let token = "candidate-comparison-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(CandidateComparisonOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: None,
        });
        let unauthorized = candidate_comparison_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/candidate-comparison",
                candidate_comparison_request(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut injected = candidate_comparison_request();
        injected["outcome"] = json!({"experiment_identity": "caller-selected"});
        let rejected = candidate_comparison_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/candidate-comparison",
                injected,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut incomplete = candidate_comparison_request();
        incomplete["candidate_evaluations"]["expected_cardinality"] = json!(2);
        let rejected = candidate_comparison_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/candidate-comparison",
                incomplete,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let not_applicable = candidate_comparison_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/candidate-comparison",
                candidate_comparison_request(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(not_applicable.status(), StatusCode::CONFLICT);
        assert_eq!(
            response_json(not_applicable).await,
            json!({
                "request_identity": "request-1",
                "error": "CANDIDATE_COMPARISON_NOT_APPLICABLE",
            })
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn candidate_comparison_compose_and_resolve_return_exact_owner_custody() {
        let token = "candidate-comparison-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = candidate_comparison_response();
        let owner = Arc::new(CandidateComparisonOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let mut bodies = Vec::new();

        for _ in 0..2 {
            let response = candidate_comparison_router(owner.clone(), token_digest)
                .oneshot(send_to(
                    "/v1/iteration-decisions/candidate-comparison",
                    candidate_comparison_request(),
                    Some(&format!("Bearer {token}")),
                ))
                .await
                .expect("router response");
            assert_eq!(response.status(), StatusCode::OK);
            bodies.push(response_json(response).await);
        }
        assert_eq!(bodies, vec![serde_json::to_value(&expected).unwrap(); 2]);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 2);

        let resolved = candidate_comparison_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/candidate-comparison/resolve",
                json!({
                    "decision_identity": "decision-successor-1",
                    "result_identity": "result-1",
                }),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn successor_intent_compose_and_resolve_are_authenticated_and_preserve_owner_custody() {
        let token = "successor-intent-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = successor_research_intent_response();
        let owner = Arc::new(SuccessorResearchIntentOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });

        let unauthorized = successor_research_intent_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/successor-research-intents",
                successor_research_intent_request(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut injected = successor_research_intent_request();
        injected["decision_digest"] = json!(format!("sha256:{}", "a".repeat(64)));
        let rejected = successor_research_intent_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/successor-research-intents",
                injected,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let composed = successor_research_intent_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/successor-research-intents",
                successor_research_intent_request(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(composed.status(), StatusCode::OK);
        assert_eq!(
            response_json(composed).await,
            serde_json::to_value(&expected).unwrap()
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);

        let resolved = successor_research_intent_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/successor-research-intents/resolve",
                successor_research_intent_resolution_locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);

        let missing = Arc::new(SuccessorResearchIntentOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            response: None,
        });
        let absent = successor_research_intent_router(missing.clone(), token_digest)
            .oneshot(send_to(
                "/v1/successor-research-intents/resolve",
                successor_research_intent_resolution_locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(absent.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response_json(absent).await,
            json!({
                "intent_identity": "successor-intent-1",
                "error": "SUCCESSOR_RESEARCH_INTENT_NOT_FOUND",
            })
        );
        assert_eq!(missing.resolve_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn research_iteration_action_resolve_is_authenticated_and_preserves_owner_action() {
        let token = "research-iteration-action-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = research_iteration_action_response();
        let owner = Arc::new(ResearchIterationActionOwnerStub {
            resolve_calls: AtomicUsize::new(0),
            response: expected.clone(),
        });

        let unauthorized = research_iteration_action_read_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/research-iteration-actions/resolve",
                decision_resolution_locator(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 0);

        let mut invalid = decision_resolution_locator();
        invalid["result_identity"] = json!("result/1");
        let rejected = research_iteration_action_read_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/research-iteration-actions/resolve",
                invalid,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 0);

        let resolved = research_iteration_action_read_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/research-iteration-actions/resolve",
                json!({
                    "decision_identity": "decision-successor-1",
                    "result_identity": "result-1",
                }),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn unified_resolve_is_authenticated_and_preserves_all_owner_variants() {
        let token = "unified-iteration-decision-readback-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let repair = UnifiedIterationDecisionResponseV1::RepairInputs(response());
        let repair_owner = Arc::new(UnifiedDecisionOwnerStub {
            resolve_calls: AtomicUsize::new(0),
            response: Some(repair.clone()),
        });

        let unauthorized = iteration_decision_read_router(repair_owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/resolve",
                decision_resolution_locator(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(repair_owner.resolve_calls.load(Ordering::SeqCst), 0);

        let mut invalid = decision_resolution_locator();
        invalid["decision_identity"] = json!("decision/1");
        let rejected = iteration_decision_read_router(repair_owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/resolve",
                invalid,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(repair_owner.resolve_calls.load(Ordering::SeqCst), 0);

        let resolved = iteration_decision_read_router(repair_owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/resolve",
                decision_resolution_locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(repair).unwrap()
        );
        assert_eq!(repair_owner.resolve_calls.load(Ordering::SeqCst), 1);

        let budget = UnifiedIterationDecisionResponseV1::TrialBudgetTerminalStop(
            trial_budget_stop_response(),
        );
        let budget_owner = Arc::new(UnifiedDecisionOwnerStub {
            resolve_calls: AtomicUsize::new(0),
            response: Some(budget.clone()),
        });
        let resolved = iteration_decision_read_router(budget_owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/resolve",
                json!({
                    "decision_identity": "decision-budget-stop-1",
                    "result_identity": "result-1",
                }),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(budget).unwrap()
        );
        assert_eq!(budget_owner.resolve_calls.load(Ordering::SeqCst), 1);

        let candidate = UnifiedIterationDecisionResponseV1::CandidateComparison(
            candidate_comparison_response(),
        );
        let candidate_owner = Arc::new(UnifiedDecisionOwnerStub {
            resolve_calls: AtomicUsize::new(0),
            response: Some(candidate.clone()),
        });
        let resolved = iteration_decision_read_router(candidate_owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/resolve",
                json!({
                    "decision_identity": "decision-successor-1",
                    "result_identity": "result-1",
                }),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(candidate).unwrap()
        );
        assert_eq!(candidate_owner.resolve_calls.load(Ordering::SeqCst), 1);

        let ready = UnifiedIterationDecisionResponseV1::ReadyForSelection(ready_response());
        let ready_owner = Arc::new(UnifiedDecisionOwnerStub {
            resolve_calls: AtomicUsize::new(0),
            response: Some(ready.clone()),
        });
        let resolved = iteration_decision_read_router(ready_owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/resolve",
                json!({
                    "decision_identity": "decision-ready-1",
                    "result_identity": "result-1",
                }),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(resolved.status(), StatusCode::OK);
        assert_eq!(
            response_json(resolved).await,
            serde_json::to_value(ready).unwrap()
        );
        assert_eq!(ready_owner.resolve_calls.load(Ordering::SeqCst), 1);

        let missing = Arc::new(UnifiedDecisionOwnerStub {
            resolve_calls: AtomicUsize::new(0),
            response: None,
        });
        let absent = iteration_decision_read_router(missing.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/resolve",
                decision_resolution_locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(absent.status(), StatusCode::NOT_FOUND);
        assert_eq!(missing.resolve_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn ready_compose_authenticates_and_rejects_incomplete_evidence_before_owner() {
        let token = "ready-for-selection-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(ReadyForSelectionOwnerStub {
            calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
        });
        let unauthorized = ready_for_selection_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/ready-for-selection",
                ready_request(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut incomplete = ready_request();
        incomplete["positive_evidence"]["robustness"] = json!([]);
        let rejected = ready_for_selection_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/ready-for-selection",
                incomplete,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut incomplete_plan = ready_request();
        incomplete_plan["protected_robustness_plan"]["required_regimes"] = json!([]);
        let rejected_plan = ready_for_selection_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/ready-for-selection",
                incomplete_plan,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected_plan.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut forged_candidate = ready_request();
        forged_candidate["candidate_identity"] = json!("caller-candidate");
        forged_candidate["candidate_digest"] = json!(format!("sha256:{}", "1".repeat(64)));
        let rejected_candidate = ready_for_selection_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/ready-for-selection",
                forged_candidate,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(rejected_candidate.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let not_applicable = ready_for_selection_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/iteration-decisions/ready-for-selection",
                ready_request(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(not_applicable.status(), StatusCode::CONFLICT);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
    }
}
