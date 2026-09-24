use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ConsumedComponentObservationDtoV2, DiagnosticEvidenceDtoV2,
    OpaqueIdentityV2, ReconciliationAtomDtoV2, ReplayNamespaceV2, ReplayTerminalV2,
};
use vibe_backtest_result_custody::{
    BacktestReadbackRefusalV1, ExploratoryReplayResultReceiptReferenceV1,
    LockedExploratoryReplayResultV2,
};
use vibe_data::owner::pit_market_snapshot_intake_v1::MarketDataDecisionCutV1;
use vibe_data::owner::research_instrument_scope_v1::{
    ResearchInstrumentScopeV1, ResearchInstrumentScopeWireV1,
};
use vibe_data::owner::source_binding::BindingDigest;
use vibe_product_edge::{ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionReadbackV1};

use crate::iteration_decision::{
    ExistingIterationDecisionReadbackV1, IterationDecisionEvidenceCutV1, IterationDecisionGateV1,
    IterationDecisionOutcomeV1, IterationDiagnosisDimensionV1, IterationInterpretationDiagnosticV1,
    IterationNoDecisionReasonV1, IterationRepairCategoryV1, IterationRepairTargetV1,
    IterationTerminalStopReasonV1,
};
use crate::trial_family::{
    TrialFamilyError, TrialFamilyIndependenceDispositionV1, TrialFamilyPolicyV1,
    TrialFamilyReadbackV1, TrialFamilyResolutionV1, form_initial_family,
};
use vibe_qualification::ProtectedFeedbackFrontierReadbackV1;

pub(crate) const RESEARCH_GOAL_OPERATION_V1: &str = "research_goal.submit_or_resolve.v1";
pub(crate) const RESEARCH_GOAL_SCHEMA_V1: &str = "sourced-research-goal-v1";
pub const RESEARCH_GOAL_OPERATION_V2: &str = "research_goal.submit_or_resolve.v2";
pub const RESEARCH_GOAL_SCHEMA_V2: &str = "sourced-research-goal-v2";
pub const RESEARCH_GOAL_OPERATION_V3: &str = "research_goal.submit_or_resolve.v3";
pub const RESEARCH_GOAL_SCHEMA_V3: &str = "sourced-research-goal-v3";
/// A V3 request whose instrument scope is not canonical.
pub const INSTRUMENT_SCOPE_INVALID: &str = "INSTRUMENT_SCOPE_INVALID";
/// A V3 request naming an instrument that Market Data's early check did not find resolvable in
/// its eligible-instrument frontier.
pub const INSTRUMENT_SCOPE_NOT_RESOLVABLE: &str = "INSTRUMENT_SCOPE_NOT_RESOLVABLE";
pub const RESEARCH_OWNER_V1: &str = "R_AND_D";
pub const RESEARCH_SCOPE_V1: &str = "research:submit";
pub const RESEARCH_VIEW_SCOPE_V1: &str = "research:view";
pub const BACKTEST_OWNER_V1: &str = "BACKTEST";
const RESEARCH_MUTATION_EFFECT_V1: &str = "R_AND_D_RESEARCH_MUTATION_V1";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProductEdgeResearchGoalRequestV1 {
    pub(crate) request_identity: String,
    pub(crate) channel: ProductEdgeChannel,
    pub(crate) admission: ProductEdgeAdmissionLocatorV1,
    pub(crate) goal: SourcedResearchGoalV1,
}

/// The Research request this Owner stores, for V2 and V3 alike.
///
/// A V3 request (`sourced-research-goal-v3`) is a V2 request plus the instrument scope it studies,
/// and everything the Owner derives from a request - basis, protected feedback, TrialFamily,
/// Intent, view - is the same for both. So there is one stored request: `instrument_scope` is
/// present exactly for a V3 request and absent, not null, for a V2 one, which leaves every stored
/// V2 request, digest and admission payload unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeResearchGoalRequestV2 {
    pub request_identity: String,
    pub channel: ProductEdgeChannel,
    pub admission: ProductEdgeAdmissionLocatorV1,
    pub goal: SourcedResearchGoalV2,
    pub trial_family_proposal: TrialFamilyProposalV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instrument_scope: Option<ResearchInstrumentScopeWireV1>,
}

impl ProductEdgeResearchGoalRequestV2 {
    /// The Product Edge operation and schema this request is admitted under.
    pub(crate) const fn admitted_operation(&self) -> (&'static str, &'static str) {
        if self.instrument_scope.is_some() {
            (RESEARCH_GOAL_OPERATION_V3, RESEARCH_GOAL_SCHEMA_V3)
        } else {
            (RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2)
        }
    }
}

/// Untrusted Research V2 proposal whose source frontier is intentionally
/// absent. Source fields are assembled only from sealed R&D ancestry evidence.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnsourcedResearchProposalV1 {
    pub request_identity: String,
    pub channel: ProductEdgeChannel,
    pub admission: ProductEdgeAdmissionLocatorV1,
    pub goal: UnsourcedResearchGoalV1,
    pub trial_family_proposal: TrialFamilyProposalV1,
    /// Present exactly for a V3 proposal; see [`ProductEdgeResearchGoalRequestV2`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instrument_scope: Option<ResearchInstrumentScopeWireV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeChannel {
    /// Canonical identity of the one Product Edge admission gateway.
    TradeProductEdge,
    /// The same gateway under the name it was sealed with before the rename. A Research Goal
    /// admitted earlier keeps these bytes, so the variant is read vocabulary, not a second channel.
    WindmillProductEdge,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourcedResearchGoalV1 {
    pub hypothesis: String,
    pub mechanism: String,
    pub falsification_question: String,
    pub expected_observation: String,
    pub required_data: Vec<String>,
    pub cost_assumption: String,
    pub capacity_assumption: String,
    pub protected_feedback_frontier: String,
    pub sources: Vec<ResearchSourceV1>,
}

/// V2 caller proposal. Protected-feedback authority is deliberately absent.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourcedResearchGoalV2 {
    pub hypothesis: String,
    pub mechanism: String,
    pub falsification_question: String,
    pub expected_observation: String,
    pub required_data: Vec<String>,
    pub cost_assumption: String,
    pub capacity_assumption: String,
    pub sources: Vec<ResearchSourceV1>,
}

/// Caller-supplied Research meaning without caller-supplied source authority.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnsourcedResearchGoalV1 {
    pub hypothesis: String,
    pub mechanism: String,
    pub falsification_question: String,
    pub expected_observation: String,
    pub required_data: Vec<String>,
    pub cost_assumption: String,
    pub capacity_assumption: String,
}

/// Caller-safe TrialFamily proposal. R&D resolves every lineage field itself.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyProposalV1 {
    pub trial_budget: u32,
    pub stop_rule: String,
    pub pit_rule_identity: String,
    pub cost_model_identity: String,
    pub slippage_model_identity: String,
    pub capacity_model_identity: String,
    pub independence_rationale: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchLineageResolutionV1 {
    GenesisEmpty,
    CompleteFrontier,
}

/// Sealed R&D pre-feedback independence fact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IndependenceBasisReadbackV1 {
    schema_version: u32,
    basis_identity: String,
    request_identity: String,
    principal: String,
    request_scope: Vec<String>,
    rationale_digest: String,
    independence_disposition: TrialFamilyIndependenceDispositionV1,
    lineage_resolution: ResearchLineageResolutionV1,
    semantic_predecessor_frontier: Vec<String>,
    lineage_digest: String,
    basis_digest: String,
    receipt: IndependenceBasisReceiptV1,
}

impl IndependenceBasisReadbackV1 {
    pub fn basis_identity(&self) -> &str {
        &self.basis_identity
    }
    pub fn basis_digest(&self) -> &str {
        &self.basis_digest
    }
    pub fn receipt(&self) -> &IndependenceBasisReceiptV1 {
        &self.receipt
    }

    pub(crate) fn stored(&self) -> StoredIndependenceBasisV1 {
        StoredIndependenceBasisV1 {
            schema_version: self.schema_version,
            basis_identity: self.basis_identity.clone(),
            request_identity: self.request_identity.clone(),
            principal: self.principal.clone(),
            request_scope: self.request_scope.clone(),
            rationale_digest: self.rationale_digest.clone(),
            independence_disposition: self.independence_disposition,
            lineage_resolution: self.lineage_resolution,
            semantic_predecessor_frontier: self.semantic_predecessor_frontier.clone(),
            lineage_digest: self.lineage_digest.clone(),
            basis_digest: self.basis_digest.clone(),
        }
    }

    pub(crate) fn locator(&self) -> vibe_qualification::RdIndependenceBasisLocatorV1 {
        vibe_qualification::RdIndependenceBasisLocatorV1 {
            basis_identity: self.basis_identity.clone(),
            basis_digest: self.basis_digest.clone(),
            request_identity: self.request_identity.clone(),
            principal: self.principal.clone(),
            request_scope: self.request_scope.clone(),
        }
    }

    pub(crate) fn from_stored(
        stored: StoredIndependenceBasisV1,
        receipt: IndependenceBasisReceiptV1,
    ) -> Self {
        Self {
            schema_version: stored.schema_version,
            basis_identity: stored.basis_identity,
            request_identity: stored.request_identity,
            principal: stored.principal,
            request_scope: stored.request_scope,
            rationale_digest: stored.rationale_digest,
            independence_disposition: stored.independence_disposition,
            lineage_resolution: stored.lineage_resolution,
            semantic_predecessor_frontier: stored.semantic_predecessor_frontier,
            lineage_digest: stored.lineage_digest,
            basis_digest: stored.basis_digest,
            receipt,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IndependenceBasisReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    basis_identity: String,
    basis_digest: String,
    committed_at_epoch_ms: u64,
}

impl IndependenceBasisReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }

    pub(crate) fn new(
        receipt_identity: String,
        basis_identity: String,
        basis_digest: String,
        committed_at_epoch_ms: u64,
    ) -> Self {
        Self {
            schema_version: 1,
            receipt_identity,
            basis_identity,
            basis_digest,
            committed_at_epoch_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredAdmittedResearchRequestV2 {
    pub(crate) schema_version: u32,
    pub(crate) request: ProductEdgeResearchGoalRequestV2,
    pub(crate) independence_basis: StoredIndependenceBasisV1,
    pub(crate) protected_feedback: StoredProtectedFeedbackProjectionV1,
    pub(crate) canonical_trial_family_policy: TrialFamilyPolicyV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredRejectedResearchRequestV2 {
    pub(crate) schema_version: u32,
    pub(crate) request: ProductEdgeResearchGoalRequestV2,
    pub(crate) rejection_code: String,
    /// Present exactly for [`INSTRUMENT_SCOPE_NOT_RESOLVABLE`]: the answer that rejection rests
    /// on, which a later read cannot reproduce because it depends on Market Data's cut.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) instrument_scope_check: Option<InstrumentScopeCheckRecordV1>,
}

/// How Market Data's early check answered one requested identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum InstrumentAdmissibilityV1 {
    Admissible,
    Unresolved,
    NotInEligibleFrontier,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InstrumentScopeCheckRowV1 {
    pub(crate) identity: String,
    pub(crate) admissibility: InstrumentAdmissibilityV1,
}

/// Market Data's early answer for a V3 request's scope, recorded with the basis it was given on:
/// the eligible-instrument frontier Market Data held as current, absent when it held none, and
/// the decision cut it answered at.
///
/// A rejection recorded from it is proved by this binding rather than by replay: a later check
/// answers at a later cut, so it may differ, and the record is what the rejection rests on.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InstrumentScopeCheckRecordV1 {
    pub(crate) eligible_instrument_frontier: Option<BindingDigest>,
    pub(crate) decision_cut: MarketDataDecisionCutV1,
    pub(crate) rows: Vec<InstrumentScopeCheckRowV1>,
}

impl InstrumentScopeCheckRecordV1 {
    /// Whether every requested identity is admissible.
    pub(crate) fn admits(&self) -> bool {
        self.rows
            .iter()
            .all(|row| row.admissibility == InstrumentAdmissibilityV1::Admissible)
    }

    /// Checks that this record answers exactly `scope` and is well formed: one row per requested
    /// identity in request order, a frontier that is either stated and non-zero or absent with
    /// every identity outside it, and a decision cut before its own validity bound.
    pub(crate) fn validate_against(
        &self,
        scope: &ResearchInstrumentScopeV1,
    ) -> Result<(), &'static str> {
        if self.rows.len() != scope.identities().len()
            || self
                .rows
                .iter()
                .zip(scope.identities())
                .any(|(row, identity)| &row.identity != identity)
        {
            return Err("the check does not answer the requested identities in order");
        }

        match self.eligible_instrument_frontier {
            None if self.rows.iter().any(|row| {
                row.admissibility != InstrumentAdmissibilityV1::NotInEligibleFrontier
            }) =>
            {
                return Err("a check without a frontier admits or resolves an identity");
            }
            Some(frontier) if frontier.as_bytes() == &[0; 32] => {
                return Err("the check states an all-zero frontier");
            }
            _ => {}
        }

        let cut = &self.decision_cut;
        if cut.clock_identity.is_empty()
            || cut.clock_epoch.is_empty()
            || cut.decision_cut >= cut.valid_through
        {
            return Err("the check's decision cut is not well formed");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredIndependenceBasisV1 {
    pub(crate) schema_version: u32,
    pub(crate) basis_identity: String,
    pub(crate) request_identity: String,
    pub(crate) principal: String,
    pub(crate) request_scope: Vec<String>,
    pub(crate) rationale_digest: String,
    pub(crate) independence_disposition: TrialFamilyIndependenceDispositionV1,
    pub(crate) lineage_resolution: ResearchLineageResolutionV1,
    pub(crate) semantic_predecessor_frontier: Vec<String>,
    pub(crate) lineage_digest: String,
    pub(crate) basis_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProtectedFeedbackProjectionV1 {
    pub(crate) projection_identity: String,
    pub(crate) projection_digest: String,
    pub(crate) source_cut: String,
    pub(crate) valid_through_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchSourceV1 {
    pub locator: String,
    pub content_digest: String,
    pub observed_at: String,
    pub source_cut: String,
    pub license_basis: String,
    pub interpretation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchRequestReceiptV1 {
    pub schema_version: u32,
    pub receipt_identity: String,
    pub request_identity: String,
    pub semantic_digest: String,
    pub disposition: ResearchRequestDisposition,
    pub resulting_research_intent_identity: Option<String>,
    pub committed_at_epoch_ms: u64,
    pub rejection_code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchRequestDisposition {
    Accepted,
    RejectedNoWrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenResearchGoalIntentV1 {
    pub schema_version: u32,
    pub intent_identity: String,
    pub request_identity: String,
    pub semantic_digest: String,
    pub source_frontier: Vec<ResearchSourceV1>,
    pub goal: SourcedResearchGoalV1,
    pub frozen_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenResearchGoalIntentV2 {
    pub schema_version: u32,
    pub intent_identity: String,
    pub request_identity: String,
    pub semantic_digest: String,
    pub source_frontier: Vec<ResearchSourceV1>,
    pub goal: SourcedResearchGoalV2,
    pub independence_basis_identity: String,
    pub independence_basis_digest: String,
    pub protected_feedback_projection_identity: String,
    pub protected_feedback_projection_digest: String,
    pub trial_family_identity: String,
    pub trial_family_policy_digest: String,
    pub frozen_at_epoch_ms: u64,
    /// The scope a V3 Intent binds; a V3 Intent has schema 3 and a V2 Intent schema 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instrument_scope: Option<FrozenResearchInstrumentScopeV1>,
}

/// The instrument scope a V3 Research Intent binds: the identity and canonical bytes this Owner
/// computed from the request, in lowercase hex.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenResearchInstrumentScopeV1 {
    pub scope_identity: String,
    pub canonical_bytes: String,
}

impl FrozenResearchInstrumentScopeV1 {
    pub(crate) fn from_scope(scope: &ResearchInstrumentScopeV1) -> Self {
        Self {
            scope_identity: lower_hex(scope.identity().as_bytes()),
            canonical_bytes: lower_hex(scope.canonical_bytes()),
        }
    }
}

/// Intent schema of a V2 request.
pub(crate) const RESEARCH_INTENT_SCHEMA_V2: u32 = 2;
/// Intent schema of a V3 request, which also binds the instrument scope.
pub(crate) const RESEARCH_INTENT_SCHEMA_V3: u32 = 3;

/// The Intent schema a request freezes under, and the scope that Intent binds.
pub(crate) fn expected_intent_scope(
    request: &ProductEdgeResearchGoalRequestV2,
) -> Result<(u32, Option<FrozenResearchInstrumentScopeV1>), ResearchGoalOwnerError> {
    match &request.instrument_scope {
        None => Ok((RESEARCH_INTENT_SCHEMA_V2, None)),
        Some(wire) => ResearchInstrumentScopeV1::from_wire(wire.clone())
            .map(|scope| {
                (
                    RESEARCH_INTENT_SCHEMA_V3,
                    Some(FrozenResearchInstrumentScopeV1::from_scope(&scope)),
                )
            })
            .map_err(|e| {
                ResearchGoalOwnerError::Storage(format!(
                    "stored request instrument scope is not canonical: {e}"
                ))
            }),
    }
}

fn lower_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            write!(out, "{byte:02x}").expect("writing to a String cannot fail");
            out
        })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(untagged)]
pub(crate) enum FrozenResearchGoalIntent {
    V2(FrozenResearchGoalIntentV2),
    V1(FrozenResearchGoalIntentV1),
}

impl FrozenResearchGoalIntent {
    pub(crate) fn intent_identity(&self) -> &str {
        match self {
            Self::V1(intent) => &intent.intent_identity,
            Self::V2(intent) => &intent.intent_identity,
        }
    }

    pub(crate) fn request_identity(&self) -> &str {
        match self {
            Self::V1(intent) => &intent.request_identity,
            Self::V2(intent) => &intent.request_identity,
        }
    }

    pub(crate) fn semantic_digest(&self) -> &str {
        match self {
            Self::V1(intent) => &intent.semantic_digest,
            Self::V2(intent) => &intent.semantic_digest,
        }
    }

    pub(crate) fn source_frontier(&self) -> &[ResearchSourceV1] {
        match self {
            Self::V1(intent) => &intent.source_frontier,
            Self::V2(intent) => &intent.source_frontier,
        }
    }

    pub(crate) fn is_v2(&self) -> bool {
        matches!(self, Self::V2(_))
    }

    pub(crate) fn schema_version(&self) -> u32 {
        match self {
            Self::V1(_) => 1,
            Self::V2(intent) => intent.schema_version,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchViewV1 {
    pub schema_version: u32,
    pub projection_identity: String,
    pub request_identity: String,
    pub trusted_principal: String,
    pub authorized_scope: Vec<String>,
    pub authorization_policy_cut: String,
    pub source_owner: String,
    pub source_cut: String,
    pub observed_at_epoch_ms: u64,
    pub projection_at_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
    pub availability: ResearchViewAvailability,
    pub phase: ResearchViewPhase,
    pub intent_identity: String,
    pub source_frontier: Vec<ResearchSourceV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_receipt_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_review_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composer_artifact: Option<ResearchComposerArtifactViewV3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exploration: Option<ResearchExplorationViewV1>,
    pub next_legal_action: ResearchNextLegalAction,
}

/// Exact R&D references for one Composer artifact admitted to a TrialFamily.
///
/// A Composer artifact can use several intrinsic plugin Build Receipts, so none of these
/// coordinates is represented as a legacy Artifact Build attempt or review.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchComposerArtifactViewV3 {
    pub artifact_locator: String,
    pub artifact_identity_digest: String,
    pub composer_request_identity: String,
    pub composer_operation_receipt_digest: String,
    pub artifact_family_binding_identity: String,
    pub artifact_family_binding_digest: String,
    pub artifact_family_binding_receipt_identity: String,
    pub trial_family_identity: String,
    pub census_frontier_identity: String,
    pub census_frontier_digest: String,
}

/// Bounded R&D-owned facts proving that one exact exploratory request is active.
///
/// Result, diagnosis, Decision, Selection, and protected evidence are deliberately absent. They
/// require later Owner custody and a successor Research View.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchExplorationViewV1 {
    pub trial_family_identity: String,
    pub census_frontier_identity: String,
    pub census_frontier_digest: String,
    pub replay_request_identity: String,
    pub replay_request_meaning_digest: String,
    pub replay_request_seal_digest: String,
    pub replay_receipt_identity: String,
}

/// Read-only Product Edge projection of one validated Backtest exploratory Result aggregate.
///
/// This type is serialize-only. Its sole public constructor accepts the non-forgeable locked
/// Backtest Owner readback, so caller bytes cannot supply a Result, receipt, diagnosis, or trace.
/// Raw Result bytes, economic interpretation, Iteration Decision, and next-action inference are
/// deliberately absent.
///
/// ```compile_fail
/// use vibe_strategy_factory::product_edge::ResearchExploratoryRunEvidenceProjectionV1;
/// let _: ResearchExploratoryRunEvidenceProjectionV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchExploratoryRunEvidenceProjectionV1 {
    schema_version: u16,
    source_owner: String,
    replay_namespace: ReplayNamespaceV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    attempt_identity: OpaqueIdentityV2,
    terminal: ReplayTerminalV2,
    receipt_reference: ExploratoryReplayResultReceiptReferenceV1,
    reconciliation: Vec<ReconciliationAtomDtoV2>,
    semantic_trace: Option<ConsumedComponentObservationDtoV2>,
    diagnostic_census: Vec<DiagnosticEvidenceDtoV2>,
}

impl ResearchExploratoryRunEvidenceProjectionV1 {
    /// Projects only facts carried by the validated Backtest Owner readback.
    #[must_use]
    pub fn from_locked_owner_readback(readback: &LockedExploratoryReplayResultV2) -> Self {
        let result = readback.result();
        Self {
            schema_version: 1,
            source_owner: BACKTEST_OWNER_V1.to_string(),
            replay_namespace: result.namespace,
            request_identity: result.request_identity.clone(),
            request_meaning_digest: result.request_meaning_digest.clone(),
            result_identity: result.result_identity.clone(),
            result_digest: result.result_digest.clone(),
            attempt_identity: result.attempt_identity.clone(),
            terminal: result.terminal,
            receipt_reference: readback.receipt_reference().clone(),
            reconciliation: result.reconciliation.clone(),
            semantic_trace: result.semantic_trace.clone(),
            diagnostic_census: result.diagnostic_census.clone(),
        }
    }

    #[must_use]
    pub const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    #[must_use]
    pub fn source_owner(&self) -> &str {
        &self.source_owner
    }

    #[must_use]
    pub const fn replay_namespace(&self) -> ReplayNamespaceV2 {
        self.replay_namespace
    }

    #[must_use]
    pub fn request_identity(&self) -> &OpaqueIdentityV2 {
        &self.request_identity
    }

    #[must_use]
    pub fn result_identity(&self) -> &OpaqueIdentityV2 {
        &self.result_identity
    }

    #[must_use]
    pub fn attempt_identity(&self) -> &OpaqueIdentityV2 {
        &self.attempt_identity
    }

    #[must_use]
    pub const fn terminal(&self) -> ReplayTerminalV2 {
        self.terminal
    }

    #[must_use]
    pub fn receipt_reference(&self) -> &ExploratoryReplayResultReceiptReferenceV1 {
        &self.receipt_reference
    }

    #[must_use]
    pub fn reconciliation(&self) -> &[ReconciliationAtomDtoV2] {
        &self.reconciliation
    }

    #[must_use]
    pub fn semantic_trace(&self) -> Option<&ConsumedComponentObservationDtoV2> {
        self.semantic_trace.as_ref()
    }

    #[must_use]
    pub fn diagnostic_census(&self) -> &[DiagnosticEvidenceDtoV2] {
        &self.diagnostic_census
    }
}

/// Caller-owned coordinates for one R&D diagnosis read. They carry no diagnosis or Decision
/// authority.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchExploratoryDiagnosisLocatorV1 {
    pub trial_family_identity: String,
    pub result_identity: String,
    pub request_identity: String,
    pub attempt_identity: String,
}

/// Read-only Product Edge projection of R&D's mandatory diagnosis gate.
///
/// This type is serialize-only and has no public constructor. A positive value can therefore be
/// produced only after R&D joins the current TrialFamily Census to the locked Backtest Result.
/// It neither commits an Iteration Decision nor accepts caller-supplied diagnosis fields.
///
/// ```compile_fail
/// use vibe_strategy_factory::product_edge::ResearchExploratoryDiagnosisGateProjectionV1;
/// let _: ResearchExploratoryDiagnosisGateProjectionV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchExploratoryDiagnosisGateProjectionV1 {
    schema_version: u16,
    source_owner: String,
    locator: ResearchExploratoryDiagnosisLocatorV1,
    action: ResearchExploratoryDiagnosisGateActionV1,
}

/// The only client actions admitted by one exact R&D diagnosis read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "next_legal_action", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchExploratoryDiagnosisGateActionV1 {
    WaitForTerminalResult {
        reason: IterationNoDecisionReasonV1,
    },
    NoDecision {
        reason: IterationNoDecisionReasonV1,
    },
    SubmitRepairInputDecision {
        decision_request: crate::DecisionCompositionRequestV1,
        evidence_cut: IterationDecisionEvidenceCutV1,
        supported_defects: Vec<IterationRepairCategoryV1>,
        selected_category: IterationRepairCategoryV1,
        target: IterationRepairTargetV1,
    },
    InterpretationRequired {
        evidence_cut: IterationDecisionEvidenceCutV1,
        diagnostic: IterationInterpretationDiagnosticV1,
        required_dimensions: Vec<IterationDiagnosisDimensionV1>,
    },
}

impl ResearchExploratoryDiagnosisGateProjectionV1 {
    pub(crate) fn from_owner_gate(
        locator: ResearchExploratoryDiagnosisLocatorV1,
        gate: IterationDecisionGateV1,
    ) -> Self {
        let decision_request = crate::DecisionCompositionRequestV1 {
            trial_family_identity: locator.trial_family_identity.clone(),
            result_identity: locator.result_identity.clone(),
            request_identity: locator.request_identity.clone(),
            attempt_identity: locator.attempt_identity.clone(),
        };
        let action = match gate {
            IterationDecisionGateV1::RepairInputs {
                evidence_cut,
                supported_defects,
                selected_category,
                target,
            } => ResearchExploratoryDiagnosisGateActionV1::SubmitRepairInputDecision {
                decision_request,
                evidence_cut,
                supported_defects,
                selected_category,
                target,
            },
            IterationDecisionGateV1::InterpretationRequired {
                evidence_cut,
                diagnostic,
                required_dimensions,
            } => ResearchExploratoryDiagnosisGateActionV1::InterpretationRequired {
                evidence_cut,
                diagnostic,
                required_dimensions,
            },
            IterationDecisionGateV1::NoDecision { reason } => {
                if reason == IterationNoDecisionReasonV1::UnknownOrNonterminalResult {
                    ResearchExploratoryDiagnosisGateActionV1::WaitForTerminalResult { reason }
                } else {
                    ResearchExploratoryDiagnosisGateActionV1::NoDecision { reason }
                }
            }
        };
        Self {
            schema_version: 1,
            source_owner: RESEARCH_OWNER_V1.to_string(),
            locator,
            action,
        }
    }

    #[must_use]
    pub const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    #[must_use]
    pub fn source_owner(&self) -> &str {
        &self.source_owner
    }

    #[must_use]
    pub const fn locator(&self) -> &ResearchExploratoryDiagnosisLocatorV1 {
        &self.locator
    }

    #[must_use]
    pub const fn action(&self) -> &ResearchExploratoryDiagnosisGateActionV1 {
        &self.action
    }
}

#[derive(Debug, Error)]
pub enum ResearchExploratoryDiagnosisGateErrorV1 {
    #[error("exploratory diagnosis-gate Owner facts are unavailable")]
    Unavailable,
    /// The Backtest Owner answered, and named why it answered nothing.
    ///
    /// This is distinct from [`Self::Unavailable`] because the caller holds no `SELECT` on the
    /// tables behind the Owner's readback: a cause the Owner does not name is a cause this side
    /// cannot recover.
    #[error("exploratory diagnosis-gate readback was refused: {0}")]
    Refused(BacktestReadbackRefusalV1),
    #[error("exploratory diagnosis-gate evidence is invalid")]
    InvalidEvidence,
    #[error("exploratory diagnosis-gate storage is unavailable: {0}")]
    Storage(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchViewAvailability {
    Available,
    Stale,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchViewPhase {
    RequestUnresolved,
    IntentFrozen,
    ArtifactAvailable,
    ExplorationActive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchNextLegalAction {
    ResolveSameRequestIdentity,
    WaitForRAndDExecution,
    CorrectInputAndCreateSuccessorRequest,
    ReviewArtifact,
    ViewExploratoryRun,
}

/// Product Edge projection of the only action admitted by one exact Iteration Decision lookup.
///
/// The projection is serialize-only. It neither creates first Decision custody nor performs the
/// repair, stop, or Qualification intake action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchIterationActionProjectionV1 {
    schema_version: u16,
    decision_identity: String,
    result_identity: String,
    action: ResearchIterationActionV1,
}

impl ResearchIterationActionProjectionV1 {
    pub const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub fn result_identity(&self) -> &str {
        &self.result_identity
    }

    pub fn action(&self) -> &ResearchIterationActionV1 {
        &self.action
    }
}

/// The next legal Product Edge action. Every positive branch repeats only public Owner facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "next_legal_action", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchIterationActionV1 {
    WaitForCommittedDecision,
    SubmitRepairRequest {
        decision_digest: String,
        decision_receipt_identity: String,
        category: IterationRepairCategoryV1,
        target: IterationRepairTargetV1,
    },
    StopOnCommittedDecision {
        decision_digest: String,
        decision_receipt_identity: String,
        reason: IterationTerminalStopReasonV1,
    },
    CreateSuccessorIntent {
        decision_digest: String,
        decision_receipt_identity: String,
        experiment_identity: String,
        experiment_digest: String,
    },
    SubmitSelectedCandidateToQualification {
        decision_digest: String,
        decision_receipt_identity: String,
        candidate_identity: String,
        candidate_digest: String,
        selection_identity: String,
        selection_digest: String,
        selection_receipt_identity: String,
    },
}

pub(crate) fn project_research_iteration_action_v1(
    decision_identity: &str,
    result_identity: &str,
    decision: Option<&ExistingIterationDecisionReadbackV1>,
) -> Result<ResearchIterationActionProjectionV1, &'static str> {
    let action = match decision {
        None => ResearchIterationActionV1::WaitForCommittedDecision,
        Some(ExistingIterationDecisionReadbackV1::RepairInputs(readback)) => {
            let IterationDecisionOutcomeV1::RepairInputs { category, target } =
                readback.decision().outcome()
            else {
                return Err("repair Decision readback outcome is inconsistent");
            };

            if readback.decision().decision_identity() != decision_identity
                || readback.receipt().decision_identity() != decision_identity
                || readback.receipt().result_identity() != result_identity
            {
                return Err("repair Decision readback locator is inconsistent");
            }
            ResearchIterationActionV1::SubmitRepairRequest {
                decision_digest: readback.decision().decision_digest().to_string(),
                decision_receipt_identity: readback.receipt().receipt_identity().to_string(),
                category: *category,
                target: *target,
            }
        }
        Some(ExistingIterationDecisionReadbackV1::TrialBudgetTerminalStop(readback)) => {
            let IterationDecisionOutcomeV1::TerminalStop { reason } = readback.decision().outcome()
            else {
                return Err("terminal Decision readback outcome is inconsistent");
            };

            if readback.decision().decision_identity() != decision_identity
                || readback.receipt().decision_identity() != decision_identity
                || readback.receipt().result_identity() != result_identity
            {
                return Err("terminal Decision readback locator is inconsistent");
            }
            ResearchIterationActionV1::StopOnCommittedDecision {
                decision_digest: readback.decision().decision_digest().to_string(),
                decision_receipt_identity: readback.receipt().receipt_identity().to_string(),
                reason: *reason,
            }
        }
        Some(ExistingIterationDecisionReadbackV1::CandidateComparison(readback)) => {
            if readback.decision().decision_identity() != decision_identity
                || readback.receipt().decision_identity() != decision_identity
                || readback.receipt().result_identity() != result_identity
            {
                return Err("candidate-comparison Decision readback locator is inconsistent");
            }

            match readback.decision().outcome() {
                IterationDecisionOutcomeV1::SuccessorExperiment {
                    experiment_identity,
                    experiment_digest,
                } => ResearchIterationActionV1::CreateSuccessorIntent {
                    decision_digest: readback.decision().decision_digest().to_string(),
                    decision_receipt_identity: readback.receipt().receipt_identity().to_string(),
                    experiment_identity: experiment_identity.clone(),
                    experiment_digest: experiment_digest.clone(),
                },
                IterationDecisionOutcomeV1::TerminalStop { reason }
                    if *reason == IterationTerminalStopReasonV1::LowInformationValue =>
                {
                    ResearchIterationActionV1::StopOnCommittedDecision {
                        decision_digest: readback.decision().decision_digest().to_string(),
                        decision_receipt_identity: readback
                            .receipt()
                            .receipt_identity()
                            .to_string(),
                        reason: *reason,
                    }
                }
                _ => {
                    return Err("candidate-comparison Decision readback outcome is inconsistent");
                }
            }
        }
        Some(ExistingIterationDecisionReadbackV1::ReadyForSelection(readback)) => {
            let IterationDecisionOutcomeV1::ReadyForSelection {
                candidate_identity,
                candidate_digest,
            } = readback.decision().outcome()
            else {
                return Err("selection Decision readback outcome is inconsistent");
            };

            if readback.decision().decision_identity() != decision_identity
                || readback.receipt().decision_identity() != decision_identity
                || readback.receipt().result_identity() != result_identity
                || readback.candidate().candidate_identity() != candidate_identity
                || readback.candidate().candidate_digest() != candidate_digest
                || readback.selection().candidate_identity() != candidate_identity
                || readback.selection().candidate_digest() != candidate_digest
                || readback.selection().decision_identity() != decision_identity
                || readback.selection_receipt().selection_identity()
                    != readback.selection().selection_identity()
            {
                return Err("selection Decision readback locator is inconsistent");
            }
            ResearchIterationActionV1::SubmitSelectedCandidateToQualification {
                decision_digest: readback.decision().decision_digest().to_string(),
                decision_receipt_identity: readback.receipt().receipt_identity().to_string(),
                candidate_identity: candidate_identity.clone(),
                candidate_digest: candidate_digest.clone(),
                selection_identity: readback.selection().selection_identity().to_string(),
                selection_digest: readback.selection().selection_digest().to_string(),
                selection_receipt_identity: readback
                    .selection_receipt()
                    .receipt_identity()
                    .to_string(),
            }
        }
    };
    Ok(ResearchIterationActionProjectionV1 {
        schema_version: 1,
        decision_identity: decision_identity.to_string(),
        result_identity: result_identity.to_string(),
        action,
    })
}

pub use crate::exploratory_replay::{
    ExploratoryReplayAvailabilityV1, ExploratoryReplayNextLegalActionV1,
    ExploratoryReplayRequestProjectionV1,
};

/// Owner-assembled V1 result.
///
/// Positive results are serialize-only and cannot be reconstructed by a caller:
///
/// ```compile_fail
/// use vibe_strategy_factory::product_edge::ResearchGoalOwnerResultV1;
/// let _: ResearchGoalOwnerResultV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchGoalOwnerResultV1 {
    pub(crate) schema_version: u32,
    pub(crate) resolution: ProductEdgeResolution,
    pub(crate) request_identity: String,
    pub(crate) owner_receipt: Option<ResearchRequestReceiptV1>,
    pub(crate) research_view: Option<ResearchViewV1>,
    pub(crate) next_legal_action: ResearchNextLegalAction,
}

impl ResearchGoalOwnerResultV1 {
    pub fn resolution(&self) -> ProductEdgeResolution {
        self.resolution
    }

    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    pub fn owner_receipt(&self) -> Option<&ResearchRequestReceiptV1> {
        self.owner_receipt.as_ref()
    }

    pub fn research_view(&self) -> Option<&ResearchViewV1> {
        self.research_view.as_ref()
    }

    pub fn next_legal_action(&self) -> ResearchNextLegalAction {
        self.next_legal_action
    }
}

/// Owner-assembled V2 result.
///
/// Positive assembly is deliberately not part of the public Product Edge API:
///
/// ```compile_fail
/// use vibe_strategy_factory::product_edge::result_from_commit_v2;
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::product_edge::ResearchGoalOwnerResultV2;
/// let _: ResearchGoalOwnerResultV2 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchGoalOwnerResultV2 {
    pub(crate) schema_version: u32,
    pub(crate) resolution: ProductEdgeResolution,
    pub(crate) request_identity: String,
    pub(crate) owner_receipt: Option<ResearchRequestReceiptV1>,
    pub(crate) research_view: Option<ResearchViewV1>,
    pub(crate) independence_basis: Option<IndependenceBasisReadbackV1>,
    pub(crate) protected_feedback: Option<ProtectedFeedbackFrontierReadbackV1>,
    pub(crate) trial_family_resolution: TrialFamilyResolutionV1,
    pub(crate) trial_family: Option<TrialFamilyReadbackV1>,
    pub(crate) next_legal_action: ResearchNextLegalAction,
}

impl ResearchGoalOwnerResultV2 {
    pub fn resolution(&self) -> ProductEdgeResolution {
        self.resolution
    }

    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    pub fn owner_receipt(&self) -> Option<&ResearchRequestReceiptV1> {
        self.owner_receipt.as_ref()
    }

    pub fn research_view(&self) -> Option<&ResearchViewV1> {
        self.research_view.as_ref()
    }

    pub fn independence_basis(&self) -> Option<&IndependenceBasisReadbackV1> {
        self.independence_basis.as_ref()
    }

    pub fn protected_feedback(&self) -> Option<&ProtectedFeedbackFrontierReadbackV1> {
        self.protected_feedback.as_ref()
    }

    pub fn trial_family_resolution(&self) -> TrialFamilyResolutionV1 {
        self.trial_family_resolution
    }

    pub fn trial_family(&self) -> Option<&TrialFamilyReadbackV1> {
        self.trial_family.as_ref()
    }

    pub fn next_legal_action(&self) -> ResearchNextLegalAction {
        self.next_legal_action
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeResolution {
    Accepted,
    RejectedNoWrite,
    SubmittedOrUnknown,
    IdentityConflict,
    LegacyTerminalQuarantined,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResearchGoalCommitV1 {
    pub(crate) receipt: ResearchRequestReceiptV1,
    pub(crate) intent: Option<FrozenResearchGoalIntentV1>,
    pub(crate) view: Option<ResearchViewV1>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResearchGoalCommitV2 {
    pub(crate) receipt: ResearchRequestReceiptV1,
    pub(crate) intent: Option<FrozenResearchGoalIntentV2>,
    pub(crate) view: Option<ResearchViewV1>,
    pub(crate) initial_family: Option<TrialFamilyReadbackV1>,
    pub(crate) independence_basis: Option<IndependenceBasisReadbackV1>,
    pub(crate) protected_feedback: Option<ProtectedFeedbackFrontierReadbackV1>,
}

pub(crate) struct ValidatedResearchGoalRequestV2 {
    request: ProductEdgeResearchGoalRequestV2,
    instrument_scope: Option<ResearchInstrumentScopeV1>,
}

pub(crate) struct RejectedResearchGoalRequestV2 {
    request: Box<ProductEdgeResearchGoalRequestV2>,
    rejection_code: &'static str,
}

impl ValidatedResearchGoalRequestV2 {
    pub(crate) fn request(&self) -> &ProductEdgeResearchGoalRequestV2 {
        &self.request
    }

    pub(crate) fn into_request(self) -> ProductEdgeResearchGoalRequestV2 {
        self.request
    }

    /// The validated scope of a V3 request; `None` for a V2 request.
    pub(crate) const fn instrument_scope(&self) -> Option<&ResearchInstrumentScopeV1> {
        self.instrument_scope.as_ref()
    }
}

/// Crate-private `PARTIAL` output that has passed the existing canonical
/// Research V2 field validator. It contains no accepted Research fact.
pub(crate) struct PartialSourceIntakeResearchAdmissionInputV1 {
    validated: ValidatedResearchGoalRequestV2,
    ancestry_evidence_identity: String,
}

#[allow(
    dead_code,
    reason = "PARTIAL Source Intake ancestry awaits durable R&D Owner composition"
)]
impl PartialSourceIntakeResearchAdmissionInputV1 {
    pub(crate) fn request(&self) -> &ProductEdgeResearchGoalRequestV2 {
        self.validated.request()
    }

    pub(crate) fn ancestry_evidence_identity(&self) -> &str {
        &self.ancestry_evidence_identity
    }

    pub(crate) fn into_canonical_request(self) -> ProductEdgeResearchGoalRequestV2 {
        self.validated.into_request()
    }
}

/// Assemble sealed Source Intake ancestry through the existing canonical
/// Research V2 validator. This performs no Research admission or write.
pub(crate) fn assemble_partial_source_intake_research_admission_input(
    proposal: UnsourcedResearchProposalV1,
    ancestry: crate::source_intake::VerifiedSourceIntakeResearchAncestryV1,
) -> Result<PartialSourceIntakeResearchAdmissionInputV1, RejectedResearchGoalRequestV2> {
    let ancestry_evidence_identity = ancestry.evidence_identity().to_string();
    let source = ancestry.into_research_source_projection();
    let request = ProductEdgeResearchGoalRequestV2 {
        request_identity: proposal.request_identity,
        channel: proposal.channel,
        admission: proposal.admission,
        goal: SourcedResearchGoalV2 {
            hypothesis: proposal.goal.hypothesis,
            mechanism: proposal.goal.mechanism,
            falsification_question: proposal.goal.falsification_question,
            expected_observation: proposal.goal.expected_observation,
            required_data: proposal.goal.required_data,
            cost_assumption: proposal.goal.cost_assumption,
            capacity_assumption: proposal.goal.capacity_assumption,
            sources: vec![ResearchSourceV1 {
                locator: source.locator,
                content_digest: source.content_digest,
                observed_at: source.observed_at,
                source_cut: source.source_cut,
                license_basis: source.license_basis,
                interpretation: source.interpretation,
            }],
        },
        trial_family_proposal: proposal.trial_family_proposal,
        instrument_scope: proposal.instrument_scope,
    };
    validate_goal_request_v2(request).map(|validated| PartialSourceIntakeResearchAdmissionInputV1 {
        validated,
        ancestry_evidence_identity,
    })
}

impl RejectedResearchGoalRequestV2 {
    pub(crate) fn request(&self) -> &ProductEdgeResearchGoalRequestV2 {
        &self.request
    }

    pub(crate) fn into_parts(self) -> (ProductEdgeResearchGoalRequestV2, &'static str) {
        (*self.request, self.rejection_code)
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ResearchGoalOwnerError {
    #[error("request identity was reused with conflicting semantics")]
    ConflictingReplay,
    #[error("Product Edge authorization lineage is not admitted: {0}")]
    Unauthorized(&'static str),
    #[error("Owner storage unavailable: {0}")]
    Storage(String),
}

#[async_trait]
pub trait ResearchGoalOwnerPortV2: Send + Sync {
    async fn submit_v2(
        &self,
        request: ProductEdgeResearchGoalRequestV2,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError>;

    async fn resolve_v2(
        &self,
        request_identity: &str,
        admission: &ProductEdgeAdmissionLocatorV1,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError>;
}

#[async_trait]
pub trait ResearchReadbackOwnerPortV1: Send + Sync {
    async fn read_research_v2(
        &self,
        request_identity: &str,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError>;
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchDirectoryCursorV1 {
    pub committed_at_epoch_ms: u64,
    pub request_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchDirectoryItemV1 {
    pub request_identity: String,
    pub intent_identity: Option<String>,
    pub disposition: ResearchRequestDisposition,
    pub availability: Option<ResearchViewAvailability>,
    pub phase: Option<ResearchViewPhase>,
    pub committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchDirectoryCompletenessV1 {
    Complete,
    Partial,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchDirectoryReadbackV1 {
    pub schema_version: u32,
    pub observed_at_epoch_ms: u64,
    pub completeness: ResearchDirectoryCompletenessV1,
    pub omitted_count: u32,
    pub next_cursor: Option<ResearchDirectoryCursorV1>,
    pub items: Vec<ResearchDirectoryItemV1>,
}

#[async_trait]
pub trait ResearchDirectoryOwnerPort: Send + Sync {
    async fn list_research(
        &self,
        after: Option<&ResearchDirectoryCursorV1>,
        limit: u32,
    ) -> Result<ResearchDirectoryReadbackV1, ResearchGoalOwnerError>;
}

pub(crate) fn semantic_digest(
    request: &ProductEdgeResearchGoalRequestV1,
) -> Result<String, ResearchGoalOwnerError> {
    semantic_digest_v1_meaning(&request.request_identity, &request.admission, &request.goal)
}

fn semantic_digest_v1_meaning(
    request_identity: &str,
    admission: &ProductEdgeAdmissionLocatorV1,
    goal: &SourcedResearchGoalV1,
) -> Result<String, ResearchGoalOwnerError> {
    #[derive(Serialize)]
    struct Meaning<'a> {
        request_identity: &'a str,
        admission: &'a ProductEdgeAdmissionLocatorV1,
        goal: &'a SourcedResearchGoalV1,
    }
    let bytes = serde_json::to_vec(&Meaning {
        request_identity,
        admission,
        goal,
    })
    .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub fn semantic_digest_v2(
    request: &ProductEdgeResearchGoalRequestV2,
) -> Result<String, ResearchGoalOwnerError> {
    // The scope is part of the meaning, so one request identity with another scope is a changed
    // meaning; it is absent from a V2 meaning, whose digest is therefore unchanged.
    #[derive(Serialize)]
    struct Meaning<'a> {
        request_identity: &'a str,
        admission: &'a ProductEdgeAdmissionLocatorV1,
        goal: &'a SourcedResearchGoalV2,
        trial_family_proposal: &'a TrialFamilyProposalV1,
        #[serde(skip_serializing_if = "Option::is_none")]
        instrument_scope: Option<&'a ResearchInstrumentScopeWireV1>,
    }
    let bytes = serde_json::to_vec(&Meaning {
        request_identity: &request.request_identity,
        admission: &request.admission,
        goal: &request.goal,
        trial_family_proposal: &request.trial_family_proposal,
        instrument_scope: request.instrument_scope.as_ref(),
    })
    .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub(crate) fn verify_research_admission_v1(
    admission: &ProductEdgeAdmissionReadbackV1,
    request: &ProductEdgeResearchGoalRequestV1,
) -> Result<(), ResearchGoalOwnerError> {
    let payload = serde_json::json!({
        "request_identity": request.request_identity,
        "channel": request.channel,
        "goal": request.goal,
    });
    verify_research_admission(
        admission,
        &request.admission,
        &request.request_identity,
        RESEARCH_GOAL_OPERATION_V1,
        RESEARCH_GOAL_SCHEMA_V1,
        &payload,
    )
}

pub(crate) fn verify_research_admission_v2(
    admission: &ProductEdgeAdmissionReadbackV1,
    request: &ProductEdgeResearchGoalRequestV2,
) -> Result<(), ResearchGoalOwnerError> {
    let mut payload = serde_json::json!({
        "request_identity": request.request_identity,
        "channel": request.channel,
        "goal": request.goal,
        "trial_family_proposal": request.trial_family_proposal,
    });
    with_instrument_scope(&mut payload, request);
    let (operation, schema) = request.admitted_operation();
    verify_research_admission(
        admission,
        &request.admission,
        &request.request_identity,
        operation,
        schema,
        &payload,
    )?;

    verify_research_admission_v2_authority(admission)
}

pub(crate) fn verify_source_bound_research_admission_v2(
    admission: &ProductEdgeAdmissionReadbackV1,
    request: &ProductEdgeResearchGoalRequestV2,
) -> Result<(), ResearchGoalOwnerError> {
    let goal = &request.goal;
    let (operation, schema) = request.admitted_operation();
    let mut transport_neutral_payload = serde_json::json!({
        "request_identity": request.request_identity,
        "goal": {
            "hypothesis": goal.hypothesis,
            "mechanism": goal.mechanism,
            "falsification_question": goal.falsification_question,
            "expected_observation": goal.expected_observation,
            "required_data": goal.required_data,
            "cost_assumption": goal.cost_assumption,
            "capacity_assumption": goal.capacity_assumption,
        },
        "trial_family_proposal": request.trial_family_proposal,
    });
    with_instrument_scope(&mut transport_neutral_payload, request);
    let transport_neutral = verify_research_admission(
        admission,
        &request.admission,
        &request.request_identity,
        operation,
        schema,
        &transport_neutral_payload,
    );

    // A V3 request was never admitted through the legacy shape, so only a V2 request falls back.
    if transport_neutral.is_err() && request.instrument_scope.is_some() {
        return Err(ResearchGoalOwnerError::Unauthorized(
            "canonical source-bound Product Edge admission mismatch",
        ));
    }

    if transport_neutral.is_err() {
        // Transitional compatibility for V1 requests and durable admissions
        // created before the transport-neutral V2 surface.
        let legacy_payload = serde_json::json!({
            "request_identity": request.request_identity,
            "channel": request.channel,
            "goal": transport_neutral_payload["goal"],
            "trial_family_proposal": request.trial_family_proposal,
        });
        verify_research_admission(
            admission,
            &request.admission,
            &request.request_identity,
            RESEARCH_GOAL_OPERATION_V2,
            RESEARCH_GOAL_SCHEMA_V2,
            &legacy_payload,
        )
        .map_err(|_| {
            ResearchGoalOwnerError::Unauthorized(
                "canonical source-bound Product Edge admission mismatch",
            )
        })?;
    }

    verify_research_admission_v2_authority(admission)
}

/// Adds a V3 request's scope to its admission payload, exactly as the request states it.
fn with_instrument_scope(
    payload: &mut serde_json::Value,
    request: &ProductEdgeResearchGoalRequestV2,
) {
    if let (Some(scope), Some(object)) = (&request.instrument_scope, payload.as_object_mut()) {
        object.insert(
            "instrument_scope".to_string(),
            serde_json::json!({
                "schema_version": scope.schema_version,
                "identities": scope.identities,
            }),
        );
    }
}

fn verify_research_admission_v2_authority(
    admission: &ProductEdgeAdmissionReadbackV1,
) -> Result<(), ResearchGoalOwnerError> {
    if !has_research_submit_scope(admission.authorized_scope())
        || !has_exact_research_mutation_effect(admission.request().requested_effects.as_slice())
    {
        return Err(ResearchGoalOwnerError::Unauthorized(
            "canonical Product Edge research authority mismatch",
        ));
    }
    Ok(())
}

fn has_exact_research_mutation_effect(requested_effects: &[String]) -> bool {
    matches!(requested_effects, [effect] if effect == RESEARCH_MUTATION_EFFECT_V1)
}

fn has_research_submit_scope(authorized_scope: &[String]) -> bool {
    authorized_scope
        .iter()
        .any(|permission| permission == RESEARCH_SCOPE_V1)
}

fn verify_research_admission(
    admission: &ProductEdgeAdmissionReadbackV1,
    locator: &ProductEdgeAdmissionLocatorV1,
    request_identity: &str,
    operation: &str,
    operation_schema: &str,
    payload: &serde_json::Value,
) -> Result<(), ResearchGoalOwnerError> {
    let admitted = admission.request();
    if admission.locator() != locator
        || admitted.request_identity != request_identity
        || admitted.operation != operation
        || admitted.operation_schema != operation_schema
        || admitted.target_owner != RESEARCH_OWNER_V1
        || admitted.typed_payload != *payload
    {
        return Err(ResearchGoalOwnerError::Unauthorized(
            "canonical Product Edge admission mismatch",
        ));
    }
    Ok(())
}

pub(crate) fn decide_commit_v2(
    validated: ValidatedResearchGoalRequestV2,
    semantic_digest: String,
    canonical_trial_family_policy: TrialFamilyPolicyV1,
    independence_basis: IndependenceBasisReadbackV1,
    protected_feedback: ProtectedFeedbackFrontierReadbackV1,
    admission: &ProductEdgeAdmissionReadbackV1,
    now_epoch_ms: u64,
) -> Result<ResearchGoalCommitV2, ResearchGoalOwnerError> {
    let (intent_schema_version, instrument_scope) = match &validated.instrument_scope {
        None => (RESEARCH_INTENT_SCHEMA_V2, None),
        Some(scope) => (
            RESEARCH_INTENT_SCHEMA_V3,
            Some(FrozenResearchInstrumentScopeV1::from_scope(scope)),
        ),
    };
    let request = validated.request;
    let suffix = digest_text(&format!(
        "v2:{}:{semantic_digest}",
        request.request_identity
    ));
    let receipt_identity =
        canonical_research_receipt_identity(2, &request.request_identity, &semantic_digest);

    let intent_identity = canonical_v2_intent_identity(&request.request_identity, &semantic_digest);
    let initial_family = form_initial_family(
        &intent_identity,
        &semantic_digest,
        canonical_trial_family_policy,
        now_epoch_ms,
    )
    .map_err(|e| trial_family_storage(&e))?;
    let intent = FrozenResearchGoalIntentV2 {
        schema_version: intent_schema_version,
        intent_identity: intent_identity.clone(),
        request_identity: request.request_identity.clone(),
        semantic_digest: semantic_digest.clone(),
        source_frontier: request.goal.sources.clone(),
        goal: request.goal,
        independence_basis_identity: independence_basis.basis_identity.clone(),
        independence_basis_digest: independence_basis.basis_digest.clone(),
        protected_feedback_projection_identity: protected_feedback
            .projection_identity()
            .to_string(),
        protected_feedback_projection_digest: protected_feedback.projection_digest().to_string(),
        trial_family_identity: initial_family.root.trial_family_identity().to_string(),
        trial_family_policy_digest: initial_family.root.policy_digest().to_string(),
        frozen_at_epoch_ms: now_epoch_ms,
        instrument_scope,
    };
    let mut view = ResearchViewV1 {
        schema_version: 1,
        projection_identity: String::new(),
        request_identity: request.request_identity.clone(),
        trusted_principal: admission.effective_principal().to_string(),
        authorized_scope: admission.authorized_scope().to_vec(),
        authorization_policy_cut: admission
            .authorization()
            .frontier()
            .frontier_identity()
            .to_string(),
        source_owner: RESEARCH_OWNER_V1.to_string(),
        source_cut: format!("rd-source-cut-v2-{suffix}"),
        observed_at_epoch_ms: now_epoch_ms,
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms
            .saturating_add(600_000)
            .min(protected_feedback.valid_through_epoch_ms()),
        availability: ResearchViewAvailability::Available,
        phase: ResearchViewPhase::IntentFrozen,
        intent_identity: intent_identity.clone(),
        source_frontier: intent.source_frontier.clone(),
        attempt_identity: None,
        artifact_identity: None,
        build_receipt_identity: None,
        artifact_review_identity: None,
        composer_artifact: None,
        exploration: None,
        next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
    };
    view.projection_identity = canonical_research_view_identity_v2(&view);
    Ok(ResearchGoalCommitV2 {
        receipt: ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity,
            request_identity: request.request_identity,
            semantic_digest,
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(intent_identity),
            committed_at_epoch_ms: now_epoch_ms,
            rejection_code: None,
        },
        intent: Some(intent),
        view: Some(view),
        initial_family: Some(initial_family),
        independence_basis: Some(independence_basis),
        protected_feedback: Some(protected_feedback),
    })
}

pub(crate) fn canonical_v2_intent_identity(
    request_identity: &str,
    semantic_digest: &str,
) -> String {
    format!(
        "rd-research-intent-v2-{}",
        digest_text(&format!("v2:{request_identity}:{semantic_digest}"))
    )
}

pub(crate) fn decide_rejected_commit_v2(
    request: ProductEdgeResearchGoalRequestV2,
    semantic_digest: String,
    rejection_code: &'static str,
    now_epoch_ms: u64,
) -> ResearchGoalCommitV2 {
    let request_identity = request.request_identity;
    ResearchGoalCommitV2 {
        receipt: ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity: canonical_research_receipt_identity(
                2,
                &request_identity,
                &semantic_digest,
            ),
            request_identity,
            semantic_digest,
            disposition: ResearchRequestDisposition::RejectedNoWrite,
            resulting_research_intent_identity: None,
            committed_at_epoch_ms: now_epoch_ms,
            rejection_code: Some(rejection_code.to_string()),
        },
        intent: None,
        view: None,
        initial_family: None,
        independence_basis: None,
        protected_feedback: None,
    }
}

pub(crate) fn canonical_research_receipt_identity(
    intent_schema_version: u32,
    request_identity: &str,
    semantic_digest: &str,
) -> String {
    let suffix = if intent_schema_version == 2 {
        digest_text(&format!("v2:{request_identity}:{semantic_digest}"))
    } else {
        digest_text(&format!("{request_identity}:{semantic_digest}"))
    };
    format!("rd-research-request-receipt-v{intent_schema_version}-{suffix}")
}

pub fn unresolved_result_v2(request_identity: &str) -> ResearchGoalOwnerResultV2 {
    ResearchGoalOwnerResultV2 {
        schema_version: 2,
        resolution: ProductEdgeResolution::SubmittedOrUnknown,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        independence_basis: None,
        protected_feedback: None,
        trial_family_resolution: TrialFamilyResolutionV1::unavailable(),
        trial_family: None,
        next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
    }
}

pub fn identity_conflict_result_v2(request_identity: &str) -> ResearchGoalOwnerResultV2 {
    ResearchGoalOwnerResultV2 {
        schema_version: 2,
        resolution: ProductEdgeResolution::IdentityConflict,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        independence_basis: None,
        protected_feedback: None,
        trial_family_resolution: TrialFamilyResolutionV1::unavailable(),
        trial_family: None,
        next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
    }
}

pub(crate) fn decide_commit(
    request: ProductEdgeResearchGoalRequestV1,
    semantic_digest: String,
    admission: &ProductEdgeAdmissionReadbackV1,
    now_epoch_ms: u64,
) -> ResearchGoalCommitV1 {
    let validation = validate_goal_request(&request);
    let suffix = digest_text(&format!("{}:{}", request.request_identity, semantic_digest));
    let receipt_identity = format!("rd-research-request-receipt-v1-{suffix}");

    if let Err(code) = validation {
        return ResearchGoalCommitV1 {
            receipt: ResearchRequestReceiptV1 {
                schema_version: 1,
                receipt_identity,
                request_identity: request.request_identity,
                semantic_digest,
                disposition: ResearchRequestDisposition::RejectedNoWrite,
                resulting_research_intent_identity: None,
                committed_at_epoch_ms: now_epoch_ms,
                rejection_code: Some(code.to_string()),
            },
            intent: None,
            view: None,
        };
    }

    let intent_identity = format!("rd-research-intent-v1-{suffix}");
    let source_cut = format!("rd-source-cut-v1-{suffix}");
    let projection_identity = format!("rd-research-view-v1-{suffix}");
    let intent = FrozenResearchGoalIntentV1 {
        schema_version: 1,
        intent_identity: intent_identity.clone(),
        request_identity: request.request_identity.clone(),
        semantic_digest: semantic_digest.clone(),
        source_frontier: request.goal.sources.clone(),
        goal: request.goal,
        frozen_at_epoch_ms: now_epoch_ms,
    };
    let view = ResearchViewV1 {
        schema_version: 1,
        projection_identity,
        request_identity: request.request_identity.clone(),
        trusted_principal: admission.effective_principal().to_string(),
        authorized_scope: admission.authorized_scope().to_vec(),
        authorization_policy_cut: admission
            .authorization()
            .frontier()
            .frontier_identity()
            .to_string(),
        source_owner: RESEARCH_OWNER_V1.to_string(),
        source_cut,
        observed_at_epoch_ms: now_epoch_ms,
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(600_000),
        availability: ResearchViewAvailability::Available,
        phase: ResearchViewPhase::IntentFrozen,
        intent_identity: intent_identity.clone(),
        source_frontier: intent.source_frontier.clone(),
        attempt_identity: None,
        artifact_identity: None,
        build_receipt_identity: None,
        artifact_review_identity: None,
        composer_artifact: None,
        exploration: None,
        next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
    };
    ResearchGoalCommitV1 {
        receipt: ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity,
            request_identity: request.request_identity,
            semantic_digest,
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(intent_identity),
            committed_at_epoch_ms: now_epoch_ms,
            rejection_code: None,
        },
        intent: Some(intent),
        view: Some(view),
    }
}

pub(crate) fn project_research_view_at(
    historical: &ResearchViewV1,
    read_cut_epoch_ms: u64,
) -> ResearchViewV1 {
    let mut projected = historical.clone();
    if read_cut_epoch_ms >= projected.valid_through_epoch_ms {
        projected.availability = ResearchViewAvailability::Stale;
        projected.projection_at_epoch_ms = read_cut_epoch_ms;
    }

    if projected.availability != ResearchViewAvailability::Available {
        projected.next_legal_action = ResearchNextLegalAction::ResolveSameRequestIdentity;
    }
    projected
}

pub(crate) fn project_research_view_stale_at(
    historical: &ResearchViewV1,
    read_cut_epoch_ms: u64,
) -> ResearchViewV1 {
    let mut projected = historical.clone();
    projected.availability = ResearchViewAvailability::Stale;
    projected.projection_at_epoch_ms = read_cut_epoch_ms;
    projected.next_legal_action = ResearchNextLegalAction::ResolveSameRequestIdentity;
    projected
}

pub fn unresolved_result(request_identity: &str) -> ResearchGoalOwnerResultV1 {
    ResearchGoalOwnerResultV1 {
        schema_version: 1,
        resolution: ProductEdgeResolution::SubmittedOrUnknown,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
    }
}

pub fn rejected_result(request_identity: &str) -> ResearchGoalOwnerResultV1 {
    ResearchGoalOwnerResultV1 {
        schema_version: 1,
        resolution: ProductEdgeResolution::RejectedNoWrite,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        next_legal_action: ResearchNextLegalAction::CorrectInputAndCreateSuccessorRequest,
    }
}

pub fn identity_conflict_result(request_identity: &str) -> ResearchGoalOwnerResultV1 {
    ResearchGoalOwnerResultV1 {
        schema_version: 1,
        resolution: ProductEdgeResolution::IdentityConflict,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
    }
}

fn validate_goal_request(request: &ProductEdgeResearchGoalRequestV1) -> Result<(), &'static str> {
    validate_goal_meaning(&request.request_identity, &request.goal)
}

pub(crate) fn validate_legacy_goal_meaning(
    request_identity: &str,
    goal: &SourcedResearchGoalV1,
) -> Result<(), &'static str> {
    validate_goal_meaning(request_identity, goal)
}

fn validate_goal_meaning(
    request_identity: &str,
    goal: &SourcedResearchGoalV1,
) -> Result<(), &'static str> {
    validate_request_identity(request_identity)?;
    validate_goal_fields(
        &goal.hypothesis,
        &goal.mechanism,
        &goal.falsification_question,
        &goal.expected_observation,
        &goal.required_data,
        &goal.cost_assumption,
        &goal.capacity_assumption,
        &goal.sources,
    )?;
    require_text(
        &goal.protected_feedback_frontier,
        4,
        512,
        "PROTECTED_FEEDBACK_FRONTIER_INVALID",
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_goal_fields(
    hypothesis: &str,
    mechanism: &str,
    falsification_question: &str,
    expected_observation: &str,
    required_data: &[String],
    cost_assumption: &str,
    capacity_assumption: &str,
    sources: &[ResearchSourceV1],
) -> Result<(), &'static str> {
    require_text(hypothesis, 16, 2_000, "HYPOTHESIS_INVALID")?;
    require_text(mechanism, 16, 2_000, "MECHANISM_INVALID")?;
    require_text(
        falsification_question,
        16,
        2_000,
        "FALSIFICATION_QUESTION_INVALID",
    )?;
    require_text(
        expected_observation,
        8,
        2_000,
        "EXPECTED_OBSERVATION_INVALID",
    )?;
    require_text(cost_assumption, 4, 1_000, "COST_ASSUMPTION_INVALID")?;
    require_text(capacity_assumption, 4, 1_000, "CAPACITY_ASSUMPTION_INVALID")?;

    if required_data.is_empty()
        || required_data.len() > 16
        || required_data
            .iter()
            .any(|value| require_text(value, 2, 256, "REQUIRED_DATA_INVALID").is_err())
    {
        return Err("REQUIRED_DATA_INVALID");
    }

    if sources.is_empty() || sources.len() > 16 {
        return Err("SOURCE_SET_INVALID");
    }

    for source in sources {
        if !(source.locator.starts_with("https://") || source.locator.starts_with("urn:")) {
            return Err("SOURCE_LOCATOR_INVALID");
        }
        let digest = source.content_digest.strip_prefix("sha256:");
        if digest.is_none_or(|value| {
            value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err("SOURCE_DIGEST_INVALID");
        }
        require_text(&source.observed_at, 10, 64, "SOURCE_OBSERVED_AT_INVALID")?;
        require_text(&source.source_cut, 4, 256, "SOURCE_CUT_INVALID")?;
        require_text(&source.license_basis, 3, 512, "SOURCE_LICENSE_INVALID")?;
        require_text(
            &source.interpretation,
            8,
            2_000,
            "SOURCE_INTERPRETATION_INVALID",
        )?;
    }
    Ok(())
}

pub(crate) fn validate_successor_goal_v1(goal: &SourcedResearchGoalV2) -> Result<(), &'static str> {
    validate_goal_fields(
        &goal.hypothesis,
        &goal.mechanism,
        &goal.falsification_question,
        &goal.expected_observation,
        &goal.required_data,
        &goal.cost_assumption,
        &goal.capacity_assumption,
        &goal.sources,
    )
}

pub(crate) fn validate_goal_request_v2(
    request: ProductEdgeResearchGoalRequestV2,
) -> Result<ValidatedResearchGoalRequestV2, RejectedResearchGoalRequestV2> {
    // The scope is checked after every V2 field, so a V2 request keeps its rejection codes.
    let checked = validate_goal_request_v2_fields(&request).and_then(|()| {
        request
            .instrument_scope
            .clone()
            .map(ResearchInstrumentScopeV1::from_wire)
            .transpose()
            .map_err(|_| INSTRUMENT_SCOPE_INVALID)
    });

    match checked {
        Ok(instrument_scope) => Ok(ValidatedResearchGoalRequestV2 {
            request,
            instrument_scope,
        }),
        Err(rejection_code) => Err(RejectedResearchGoalRequestV2 {
            request: Box::new(request),
            rejection_code,
        }),
    }
}

fn validate_goal_request_v2_fields(
    request: &ProductEdgeResearchGoalRequestV2,
) -> Result<(), &'static str> {
    validate_goal_request_v2_meaning(
        &request.request_identity,
        &request.goal,
        &request.trial_family_proposal,
    )
}

pub(crate) fn validate_goal_request_v2_meaning(
    request_identity: &str,
    goal: &SourcedResearchGoalV2,
    proposal: &TrialFamilyProposalV1,
) -> Result<(), &'static str> {
    validate_request_identity(request_identity)?;
    validate_goal_fields(
        &goal.hypothesis,
        &goal.mechanism,
        &goal.falsification_question,
        &goal.expected_observation,
        &goal.required_data,
        &goal.cost_assumption,
        &goal.capacity_assumption,
        &goal.sources,
    )?;

    if !(1..=10_000).contains(&proposal.trial_budget) {
        return Err("TRIAL_BUDGET_INVALID");
    }
    require_text(&proposal.stop_rule, 8, 2_048, "STOP_RULE_INVALID")?;
    for (value, code) in [
        (&proposal.pit_rule_identity, "PIT_RULE_IDENTITY_INVALID"),
        (&proposal.cost_model_identity, "COST_MODEL_IDENTITY_INVALID"),
        (
            &proposal.slippage_model_identity,
            "SLIPPAGE_MODEL_IDENTITY_INVALID",
        ),
        (
            &proposal.capacity_model_identity,
            "CAPACITY_MODEL_IDENTITY_INVALID",
        ),
    ] {
        require_text(value, 4, 256, code)?;
    }
    require_text(
        &proposal.independence_rationale,
        8,
        2_000,
        "INDEPENDENCE_RATIONALE_INVALID",
    )
}

fn validate_request_identity(value: &str) -> Result<(), &'static str> {
    if (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        Ok(())
    } else {
        Err("REQUEST_IDENTITY_INVALID")
    }
}

fn require_text(
    value: &str,
    minimum: usize,
    maximum: usize,
    code: &'static str,
) -> Result<(), &'static str> {
    let trimmed = value.trim();
    if trimmed.len() < minimum || trimmed.len() > maximum {
        Err(code)
    } else {
        Ok(())
    }
}

fn digest_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub(crate) fn terminal_research_view_identity(
    initial_projection_identity: &str,
    attempt_identity: &str,
    artifact_identity: &str,
    build_receipt_identity: &str,
    artifact_review_identity: &str,
) -> String {
    let meaning = format!(
        "rd.research-view.terminal.v1\0{initial_projection_identity}\0{attempt_identity}\0{artifact_identity}\0{build_receipt_identity}\0{artifact_review_identity}"
    );
    format!("rd-research-view-terminal-v1-{}", digest_text(&meaning))
}

#[derive(Serialize)]
struct ResearchViewIdentityEnvelopeV2<'a> {
    domain: &'static str,
    value: ResearchViewIdentityMeaningV2<'a>,
}

#[derive(Serialize)]
struct ResearchViewIdentityMeaningV2<'a> {
    schema_version: u32,
    request_identity: &'a str,
    trusted_principal: &'a str,
    authorized_scope: &'a [String],
    authorization_policy_cut: &'a str,
    source_owner: &'a str,
    source_cut: &'a str,
    phase: &'a ResearchViewPhase,
    intent_identity: &'a str,
    source_frontier: &'a [ResearchSourceV1],
    attempt_identity: Option<&'a str>,
    artifact_identity: Option<&'a str>,
    build_receipt_identity: Option<&'a str>,
    artifact_review_identity: Option<&'a str>,
}

pub(crate) fn canonical_research_view_identity_v2(view: &ResearchViewV1) -> String {
    let bytes = serde_json::to_vec(&ResearchViewIdentityEnvelopeV2 {
        domain: "rd.research-view.identity.v2",
        value: ResearchViewIdentityMeaningV2 {
            schema_version: view.schema_version,
            request_identity: &view.request_identity,
            trusted_principal: &view.trusted_principal,
            authorized_scope: &view.authorized_scope,
            authorization_policy_cut: &view.authorization_policy_cut,
            source_owner: &view.source_owner,
            source_cut: &view.source_cut,
            phase: &view.phase,
            intent_identity: &view.intent_identity,
            source_frontier: &view.source_frontier,
            attempt_identity: view.attempt_identity.as_deref(),
            artifact_identity: view.artifact_identity.as_deref(),
            build_receipt_identity: view.build_receipt_identity.as_deref(),
            artifact_review_identity: view.artifact_review_identity.as_deref(),
        },
    })
    .expect("Research View identity meaning is serializable");
    let prefix = if view.phase == ResearchViewPhase::ArtifactAvailable {
        "rd-research-view-terminal-v2"
    } else {
        "rd-research-view-v2"
    };
    format!("{prefix}-{:x}", Sha256::digest(bytes))
}

#[derive(Serialize)]
struct ResearchViewIdentityEnvelopeV3<'a> {
    domain: &'static str,
    value: ResearchViewIdentityMeaningV3<'a>,
}

#[derive(Serialize)]
struct ResearchViewIdentityMeaningV3<'a> {
    schema_version: u32,
    request_identity: &'a str,
    trusted_principal: &'a str,
    authorized_scope: &'a [String],
    authorization_policy_cut: &'a str,
    source_owner: &'a str,
    source_cut: &'a str,
    observed_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    phase: &'a ResearchViewPhase,
    intent_identity: &'a str,
    source_frontier: &'a [ResearchSourceV1],
    attempt_identity: Option<&'a str>,
    artifact_identity: Option<&'a str>,
    build_receipt_identity: Option<&'a str>,
    artifact_review_identity: Option<&'a str>,
    exploration: &'a ResearchExplorationViewV1,
}

pub(crate) fn canonical_research_view_identity_v3(view: &ResearchViewV1) -> Option<String> {
    let exploration = view.exploration.as_ref()?;
    let bytes = serde_json::to_vec(&ResearchViewIdentityEnvelopeV3 {
        domain: "rd.research-view.identity.v3",
        value: ResearchViewIdentityMeaningV3 {
            schema_version: view.schema_version,
            request_identity: &view.request_identity,
            trusted_principal: &view.trusted_principal,
            authorized_scope: &view.authorized_scope,
            authorization_policy_cut: &view.authorization_policy_cut,
            source_owner: &view.source_owner,
            source_cut: &view.source_cut,
            observed_at_epoch_ms: view.observed_at_epoch_ms,
            valid_through_epoch_ms: view.valid_through_epoch_ms,
            phase: &view.phase,
            intent_identity: &view.intent_identity,
            source_frontier: &view.source_frontier,
            attempt_identity: view.attempt_identity.as_deref(),
            artifact_identity: view.artifact_identity.as_deref(),
            build_receipt_identity: view.build_receipt_identity.as_deref(),
            artifact_review_identity: view.artifact_review_identity.as_deref(),
            exploration,
        },
    })
    .ok()?;
    Some(format!("rd-research-view-v3-{:x}", Sha256::digest(bytes)))
}

#[derive(Serialize)]
struct ResearchViewIdentityEnvelopeV4<'a> {
    domain: &'static str,
    view: ResearchViewIdentityMeaningV4<'a>,
}

#[derive(Serialize)]
struct ResearchViewIdentityMeaningV4<'a> {
    schema_version: u32,
    request_identity: &'a str,
    trusted_principal: &'a str,
    authorized_scope: &'a [String],
    authorization_policy_cut: &'a str,
    source_owner: &'a str,
    source_cut: &'a str,
    observed_at_epoch_ms: u64,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    availability: &'a ResearchViewAvailability,
    phase: &'a ResearchViewPhase,
    intent_identity: &'a str,
    source_frontier: &'a [ResearchSourceV1],
    composer_artifact: &'a ResearchComposerArtifactViewV3,
    exploration: &'a ResearchExplorationViewV1,
    next_legal_action: &'a ResearchNextLegalAction,
}

/// A separate identity domain keeps legacy Artifact Build and Replay View bytes unchanged.
pub(crate) fn canonical_research_view_identity_v4(view: &ResearchViewV1) -> Option<String> {
    let composer_artifact = view.composer_artifact.as_ref()?;
    let exploration = view.exploration.as_ref()?;
    let bytes = serde_json::to_vec(&ResearchViewIdentityEnvelopeV4 {
        domain: "rd.research-view.identity.v4",
        view: ResearchViewIdentityMeaningV4 {
            schema_version: view.schema_version,
            request_identity: &view.request_identity,
            trusted_principal: &view.trusted_principal,
            authorized_scope: &view.authorized_scope,
            authorization_policy_cut: &view.authorization_policy_cut,
            source_owner: &view.source_owner,
            source_cut: &view.source_cut,
            observed_at_epoch_ms: view.observed_at_epoch_ms,
            projection_at_epoch_ms: view.projection_at_epoch_ms,
            valid_through_epoch_ms: view.valid_through_epoch_ms,
            availability: &view.availability,
            phase: &view.phase,
            intent_identity: &view.intent_identity,
            source_frontier: &view.source_frontier,
            composer_artifact,
            exploration,
            next_legal_action: &view.next_legal_action,
        },
    })
    .ok()?;
    Some(format!("rd-research-view-v4-{:x}", Sha256::digest(bytes)))
}

fn binding_digest_hex(digest: BindingDigest) -> String {
    let mut value = String::with_capacity(71);
    value.push_str("sha256:");

    for byte in digest.as_bytes() {
        use std::fmt::Write as _;
        write!(&mut value, "{byte:02x}").expect("writing to String");
    }
    value
}

fn canonical_sha256_text(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn canonical_named_sha256(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

/// Validates only the historical View shape. The consuming Owner must separately reread the
/// exact Composer, Artifact-family binding, and Replay facts in its own transaction.
pub(crate) fn composer_exploration_research_view_is_valid_v3(
    view: &ResearchViewV1,
    initial: &ResearchViewV1,
) -> bool {
    let Some(composer) = view.composer_artifact.as_ref() else {
        return false;
    };
    let Some(exploration) = view.exploration.as_ref() else {
        return false;
    };
    initial.schema_version == 1
        && initial.phase == ResearchViewPhase::IntentFrozen
        && initial.availability == ResearchViewAvailability::Available
        && initial.attempt_identity.is_none()
        && initial.artifact_identity.is_none()
        && initial.build_receipt_identity.is_none()
        && initial.artifact_review_identity.is_none()
        && initial.composer_artifact.is_none()
        && initial.exploration.is_none()
        && initial.projection_identity == canonical_research_view_identity_v2(initial)
        && view.schema_version == 3
        && view.phase == ResearchViewPhase::ExplorationActive
        && view.availability == ResearchViewAvailability::Available
        && view.attempt_identity.is_none()
        && view.artifact_identity.is_none()
        && view.build_receipt_identity.is_none()
        && view.artifact_review_identity.is_none()
        && view.next_legal_action == ResearchNextLegalAction::ViewExploratoryRun
        && view.observed_at_epoch_ms == view.projection_at_epoch_ms
        && view.projection_at_epoch_ms >= initial.projection_at_epoch_ms
        && view.valid_through_epoch_ms == view.projection_at_epoch_ms.saturating_add(600_000)
        && canonical_sha256_text(&composer.artifact_identity_digest)
        && composer.artifact_locator
            == format!(
                "rd-strategy-artifact-v2-{}",
                composer
                    .artifact_identity_digest
                    .trim_start_matches("sha256:")
            )
        && !composer.composer_request_identity.is_empty()
        && canonical_sha256_text(&composer.composer_operation_receipt_digest)
        && canonical_sha256_text(&composer.artifact_family_binding_digest)
        && composer.artifact_family_binding_identity
            == format!(
                "rd-composer-artifact-family-binding-v3-{}",
                composer
                    .artifact_family_binding_digest
                    .trim_start_matches("sha256:")
            )
        && canonical_named_sha256(
            &composer.artifact_family_binding_receipt_identity,
            "rd-composer-artifact-family-binding-receipt-v3-",
        )
        && !composer.trial_family_identity.is_empty()
        && !composer.census_frontier_identity.is_empty()
        && canonical_sha256_text(&composer.census_frontier_digest)
        && composer.trial_family_identity == exploration.trial_family_identity
        && composer.census_frontier_identity == exploration.census_frontier_identity
        && composer.census_frontier_digest == exploration.census_frontier_digest
        && !exploration.replay_request_identity.is_empty()
        && canonical_sha256_text(&exploration.replay_request_meaning_digest)
        && canonical_sha256_text(&exploration.replay_request_seal_digest)
        && canonical_named_sha256(
            &exploration.replay_receipt_identity,
            "rd-exploratory-replay-receipt-v2-",
        )
        && view.source_cut
            == format!(
                "rd-composer-exploration-cut-v3-{}",
                exploration
                    .replay_request_seal_digest
                    .trim_start_matches("sha256:")
            )
        && canonical_research_view_identity_v4(view).as_deref()
            == Some(view.projection_identity.as_str())
}

/// Projects one native Composer Replay View from an authenticated frozen Intent and exact Owner
/// readbacks. The caller still owns atomic persistence and final same-transaction revalidation.
pub(crate) fn project_composer_exploration_research_view_v3(
    initial: &ResearchViewV1,
    composer: &crate::develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    binding: &crate::composer_artifact_family_binding_v3::ComposerArtifactFamilyReadbackV3,
    exploration: ResearchExplorationViewV1,
    projection_at_epoch_ms: u64,
) -> Result<ResearchViewV1, ResearchGoalOwnerError> {
    let unavailable =
        || ResearchGoalOwnerError::Storage("Composer Research View source unavailable".into());
    let locator = composer.locator();
    let bound = binding.binding();
    let intent_digest = binding_digest_hex(composer.intent_identity());

    if initial.schema_version != 1
        || initial.phase != ResearchViewPhase::IntentFrozen
        || initial.availability != ResearchViewAvailability::Available
        || initial.attempt_identity.is_some()
        || initial.artifact_identity.is_some()
        || initial.build_receipt_identity.is_some()
        || initial.artifact_review_identity.is_some()
        || initial.composer_artifact.is_some()
        || initial.exploration.is_some()
        || initial.projection_identity != canonical_research_view_identity_v2(initial)
        || !initial
            .intent_identity
            .ends_with(intent_digest.trim_start_matches("sha256:"))
        || !(initial
            .intent_identity
            .starts_with("rd-research-intent-v2-")
            || initial
                .intent_identity
                .starts_with("rd-successor-research-intent-v1-"))
        || projection_at_epoch_ms < initial.projection_at_epoch_ms
        || projection_at_epoch_ms >= initial.valid_through_epoch_ms
        || binding.receipt().committed_at_epoch_ms() > projection_at_epoch_ms
        || bound.artifact_locator() != locator.artifact_locator
        || bound.composer_request_identity() != locator.request_identity
        || bound.trial_family_identity() != exploration.trial_family_identity
        || bound.census_frontier_identity() != exploration.census_frontier_identity
        || bound.census_frontier_digest() != exploration.census_frontier_digest
    {
        return Err(unavailable());
    }
    let composer_artifact = ResearchComposerArtifactViewV3 {
        artifact_locator: locator.artifact_locator.clone(),
        artifact_identity_digest: binding_digest_hex(locator.artifact_identity),
        composer_request_identity: locator.request_identity.clone(),
        composer_operation_receipt_digest: binding_digest_hex(locator.operation_receipt_identity),
        artifact_family_binding_identity: bound.identity().to_owned(),
        artifact_family_binding_digest: bound.digest().to_owned(),
        artifact_family_binding_receipt_identity: binding.receipt().identity().to_owned(),
        trial_family_identity: bound.trial_family_identity().to_owned(),
        census_frontier_identity: bound.census_frontier_identity().to_owned(),
        census_frontier_digest: bound.census_frontier_digest().to_owned(),
    };
    let mut view = initial.clone();
    view.schema_version = 3;
    view.phase = ResearchViewPhase::ExplorationActive;
    view.source_cut = format!(
        "rd-composer-exploration-cut-v3-{}",
        exploration
            .replay_request_seal_digest
            .trim_start_matches("sha256:")
    );
    view.observed_at_epoch_ms = projection_at_epoch_ms;
    view.projection_at_epoch_ms = projection_at_epoch_ms;
    view.valid_through_epoch_ms = projection_at_epoch_ms.saturating_add(600_000);
    view.composer_artifact = Some(composer_artifact);
    view.exploration = Some(exploration);
    view.next_legal_action = ResearchNextLegalAction::ViewExploratoryRun;
    view.projection_identity =
        canonical_research_view_identity_v4(&view).ok_or_else(unavailable)?;
    if !composer_exploration_research_view_is_valid_v3(&view, initial) {
        return Err(unavailable());
    }
    Ok(view)
}

fn trial_family_storage(error: &TrialFamilyError) -> ResearchGoalOwnerError {
    ResearchGoalOwnerError::Storage(error.to_string())
}

#[cfg(test)]
mod v2_sealing_tests {
    use super::*;
    use rstest::rstest;

    fn diagnosis_locator() -> ResearchExploratoryDiagnosisLocatorV1 {
        ResearchExploratoryDiagnosisLocatorV1 {
            trial_family_identity: "family-1".into(),
            result_identity: "result-1".into(),
            request_identity: "request-1".into(),
            attempt_identity: "attempt-1".into(),
        }
    }

    fn diagnosis_evidence_cut() -> IterationDecisionEvidenceCutV1 {
        IterationDecisionEvidenceCutV1 {
            decision_policy_identity: "policy-1".into(),
            decision_policy_version: 1,
            decision_policy_digest: [1; 32],
            decision_policy_binding_digest: [2; 32],
            trial_family_identity: "family-1".into(),
            census_frontier_identity: "census-1".into(),
            census_frontier_digest: "census-digest-1".into(),
            attempt_frontier_identity: "attempt-frontier-1".into(),
            attempt_frontier_digest: "attempt-frontier-digest-1".into(),
            candidate_set_frontier_identity: "candidate-set-1".into(),
            candidate_set_frontier_digest: "candidate-set-digest-1".into(),
            request_identity: "request-1".into(),
            request_digest: "request-digest-1".into(),
            result_identity: "result-1".into(),
            result_digest: "result-digest-1".into(),
            attempt_identity: "attempt-1".into(),
        }
    }

    #[rstest]
    fn diagnosis_projection_distinguishes_wait_from_terminal_no_decision() {
        let waiting = ResearchExploratoryDiagnosisGateProjectionV1::from_owner_gate(
            diagnosis_locator(),
            IterationDecisionGateV1::NoDecision {
                reason: IterationNoDecisionReasonV1::UnknownOrNonterminalResult,
            },
        );
        assert!(matches!(
            waiting.action(),
            ResearchExploratoryDiagnosisGateActionV1::WaitForTerminalResult { .. }
        ));
        let waiting_wire = serde_json::to_value(&waiting).expect("diagnosis projection wire");
        assert_eq!(
            waiting_wire["action"]["next_legal_action"],
            "WAIT_FOR_TERMINAL_RESULT"
        );
        assert!(waiting_wire.get("next_legal_action").is_none());

        let terminal = ResearchExploratoryDiagnosisGateProjectionV1::from_owner_gate(
            diagnosis_locator(),
            IterationDecisionGateV1::NoDecision {
                reason: IterationNoDecisionReasonV1::UnresolvedFailure,
            },
        );
        assert!(matches!(
            terminal.action(),
            ResearchExploratoryDiagnosisGateActionV1::NoDecision { .. }
        ));
        assert_eq!(terminal.source_owner(), RESEARCH_OWNER_V1);
        assert_eq!(terminal.locator(), &diagnosis_locator());

        let repair = ResearchExploratoryDiagnosisGateProjectionV1::from_owner_gate(
            diagnosis_locator(),
            IterationDecisionGateV1::RepairInputs {
                evidence_cut: diagnosis_evidence_cut(),
                supported_defects: vec![IterationRepairCategoryV1::MarketData],
                selected_category: IterationRepairCategoryV1::MarketData,
                target: IterationRepairTargetV1::MarketData,
            },
        );
        let repair_wire = serde_json::to_value(repair).expect("repair gate projection wire");
        assert_eq!(
            repair_wire["action"]["next_legal_action"],
            "SUBMIT_REPAIR_INPUT_DECISION"
        );
        assert_eq!(
            repair_wire["action"]["decision_request"],
            serde_json::json!({
                "trial_family_identity": "family-1",
                "result_identity": "result-1",
                "request_identity": "request-1",
                "attempt_identity": "attempt-1",
            })
        );
    }

    #[rstest]
    fn research_directory_wire_exposes_only_verified_summary_fields() {
        let value = serde_json::to_value(ResearchDirectoryReadbackV1 {
            schema_version: 1,
            observed_at_epoch_ms: 1_725_000_000_000,
            completeness: ResearchDirectoryCompletenessV1::Partial,
            omitted_count: 1,
            next_cursor: Some(ResearchDirectoryCursorV1 {
                committed_at_epoch_ms: 1_724_999_000_000,
                request_identity: "research-request-v2-0001".into(),
            }),
            items: vec![ResearchDirectoryItemV1 {
                request_identity: "research-request-v2-0002".into(),
                intent_identity: Some("research-intent-v2-0002".into()),
                disposition: ResearchRequestDisposition::Accepted,
                availability: Some(ResearchViewAvailability::Available),
                phase: Some(ResearchViewPhase::IntentFrozen),
                committed_at_epoch_ms: 1_725_000_000_000,
            }],
        })
        .unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "schema_version": 1,
                "observed_at_epoch_ms": 1_725_000_000_000_u64,
                "completeness": "PARTIAL",
                "omitted_count": 1,
                "next_cursor": {
                    "committed_at_epoch_ms": 1_724_999_000_000_u64,
                    "request_identity": "research-request-v2-0001",
                },
                "items": [{
                    "request_identity": "research-request-v2-0002",
                    "intent_identity": "research-intent-v2-0002",
                    "disposition": "ACCEPTED",
                    "availability": "AVAILABLE",
                    "phase": "INTENT_FROZEN",
                    "committed_at_epoch_ms": 1_725_000_000_000_u64,
                }],
            })
        );
    }

    #[rstest]
    #[case(vec![RESEARCH_MUTATION_EFFECT_V1.to_string()], true)]
    #[case(Vec::new(), false)]
    #[case(vec!["OTHER_EFFECT_V1".to_string()], false)]
    #[case(vec![RESEARCH_MUTATION_EFFECT_V1.to_string(), "OTHER_EFFECT_V1".to_string()], false)]
    fn research_mutation_effect_is_an_exact_singleton(
        #[case] requested_effects: Vec<String>,
        #[case] expected: bool,
    ) {
        assert_eq!(
            has_exact_research_mutation_effect(&requested_effects),
            expected
        );
    }

    #[rstest]
    #[case(vec![RESEARCH_SCOPE_V1.to_string()], true)]
    #[case(vec![RESEARCH_SCOPE_V1.to_string(), RESEARCH_VIEW_SCOPE_V1.to_string()], true)]
    #[case(vec![RESEARCH_VIEW_SCOPE_V1.to_string()], false)]
    #[case(Vec::new(), false)]
    fn research_submit_scope_must_be_present(
        #[case] authorized_scope: Vec<String>,
        #[case] expected: bool,
    ) {
        assert_eq!(has_research_submit_scope(&authorized_scope), expected);
    }

    #[rstest]
    fn v2_caller_wire_contains_proposal_but_no_owner_lineage_authority() {
        let value =
            serde_json::to_value(request_v2("research-request-v2-proposal-wire-0001")).unwrap();
        let encoded = serde_json::to_string(&value).unwrap();
        assert!(value.get("trial_family_proposal").is_some());

        for forbidden in [
            "semantic_predecessor_frontier",
            "protected_feedback_frontier",
            "independence_disposition",
            "independence_basis_identity",
            "frozen_falsifier_binding",
        ] {
            assert!(!encoded.contains(forbidden));
        }
    }

    #[rstest]
    fn owner_projection_becomes_stale_at_its_valid_through_cut() {
        let historical = research_view(1_000, 601_000);
        let cut = historical.valid_through_epoch_ms;
        let view = project_research_view_at(&historical, cut);
        assert_eq!(view.availability, ResearchViewAvailability::Stale);
        assert_eq!(view.observed_at_epoch_ms, 1_000);
        assert_eq!(view.projection_at_epoch_ms, cut);
        assert_eq!(
            view.next_legal_action,
            ResearchNextLegalAction::ResolveSameRequestIdentity
        );
    }

    #[rstest::rstest]
    fn legacy_research_view_wire_and_v2_identity_do_not_gain_empty_exploration() {
        let mut view = research_view(1_000, 601_000);
        view.projection_identity = canonical_research_view_identity_v2(&view);
        let value = serde_json::to_value(&view).unwrap();

        assert!(value.get("exploration").is_none());
        assert_eq!(
            view.projection_identity,
            "rd-research-view-v2-dd8f227ef037506e347b084cfba08a9dc50153af377515d018ba8e360cb0d647"
        );
        let stale = project_research_view_at(&view, view.valid_through_epoch_ms);
        assert_eq!(stale.projection_identity, view.projection_identity);
    }

    #[rstest::rstest]
    fn active_research_view_identity_binds_exact_replay_custody() {
        let mut view = research_view(2_000, 602_000);
        view.schema_version = 2;
        view.phase = ResearchViewPhase::ExplorationActive;
        view.source_cut = format!("rd-exploration-cut-v1-{}", "c".repeat(64));
        view.exploration = Some(ResearchExplorationViewV1 {
            trial_family_identity: "rd-trial-family-v1-test".into(),
            census_frontier_identity: "rd-trial-family-census-frontier-v1-test".into(),
            census_frontier_digest: format!("sha256:{}", "a".repeat(64)),
            replay_request_identity: "rd-exploratory-replay-request-v2-test".into(),
            replay_request_meaning_digest: format!("sha256:{}", "b".repeat(64)),
            replay_request_seal_digest: format!("sha256:{}", "c".repeat(64)),
            replay_receipt_identity: "rd-exploratory-replay-receipt-v2-test".into(),
        });
        view.next_legal_action = ResearchNextLegalAction::ViewExploratoryRun;
        let identity = canonical_research_view_identity_v3(&view).unwrap();

        view.exploration
            .as_mut()
            .unwrap()
            .replay_receipt_identity
            .push_str("-changed");
        assert_ne!(
            canonical_research_view_identity_v3(&view).unwrap(),
            identity
        );
    }

    #[rstest]
    fn composer_replay_view_has_distinct_history_and_rejects_legacy_build_fields() {
        let mut initial = research_view(1_000, 601_000);
        initial.projection_identity = canonical_research_view_identity_v2(&initial);
        assert!(
            serde_json::to_value(&initial)
                .unwrap()
                .get("composer_artifact")
                .is_none()
        );
        let digest = |digit: char| format!("sha256:{}", digit.to_string().repeat(64));
        let mut view = initial.clone();
        view.schema_version = 3;
        view.phase = ResearchViewPhase::ExplorationActive;
        view.observed_at_epoch_ms = 2_000;
        view.projection_at_epoch_ms = 2_000;
        view.valid_through_epoch_ms = 602_000;
        view.source_cut = format!("rd-composer-exploration-cut-v3-{}", "3".repeat(64));
        view.composer_artifact = Some(ResearchComposerArtifactViewV3 {
            artifact_locator: format!("rd-strategy-artifact-v2-{}", "1".repeat(64)),
            artifact_identity_digest: digest('1'),
            composer_request_identity: "composer-request".into(),
            composer_operation_receipt_digest: digest('2'),
            artifact_family_binding_identity: format!(
                "rd-composer-artifact-family-binding-v3-{}",
                "4".repeat(64)
            ),
            artifact_family_binding_digest: digest('4'),
            artifact_family_binding_receipt_identity: format!(
                "rd-composer-artifact-family-binding-receipt-v3-{}",
                "7".repeat(64)
            ),
            trial_family_identity: "trial-family".into(),
            census_frontier_identity: "census-frontier".into(),
            census_frontier_digest: digest('5'),
        });
        view.exploration = Some(ResearchExplorationViewV1 {
            trial_family_identity: "trial-family".into(),
            census_frontier_identity: "census-frontier".into(),
            census_frontier_digest: digest('5'),
            replay_request_identity: "replay-request".into(),
            replay_request_meaning_digest: digest('6'),
            replay_request_seal_digest: digest('3'),
            replay_receipt_identity: format!("rd-exploratory-replay-receipt-v2-{}", "8".repeat(64)),
        });
        view.next_legal_action = ResearchNextLegalAction::ViewExploratoryRun;
        view.projection_identity = canonical_research_view_identity_v4(&view).unwrap();
        assert!(
            crate::rd_owner_postgres_custody::validate_historical_view(&view, &initial).is_ok()
        );

        view.attempt_identity = Some("legacy-attempt".into());
        view.projection_identity = canonical_research_view_identity_v4(&view).unwrap();
        assert!(
            crate::rd_owner_postgres_custody::validate_historical_view(&view, &initial).is_err()
        );
    }

    /// Pins the schema 3 identity's byte order against the consumer's, through one shared file.
    ///
    /// The envelope this identity is built from names its payload `view`, where the v2 envelope
    /// names it `value`. Nothing in either language distinguishes a digest of the right data under
    /// the wrong key from the right one, so the vectors carry the identity that mistake produces
    /// and both sides assert they do not compute it.
    #[rstest]
    fn exploration_research_view_identity_matches_the_shared_vectors() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../product/rd-owner-client/fixtures/research_view_identity_vectors_v4.json");
        let vectors: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&path).expect("the shared identity vectors"),
        )
        .expect("the shared identity vectors parse");
        let view: ResearchViewV1 =
            serde_json::from_value(vectors["view"].clone()).expect("the pinned View deserializes");
        let initial: ResearchViewV1 = serde_json::from_value(vectors["initial_view"].clone())
            .expect("the pinned initial View deserializes");

        // The vector is a View this side accepts, not merely JSON that happens to hash.
        crate::rd_owner_postgres_custody::validate_historical_view(&view, &initial)
            .expect("the pinned View passes the schema 3 validator");

        let identity = vectors["identity"].as_str().expect("the pinned identity");
        assert_eq!(
            canonical_research_view_identity_v4(&view).expect("the identity derives"),
            identity
        );
        assert_eq!(view.projection_identity, identity);

        let variant = |name: &str| {
            vectors[name]["canonical_bytes"]
                .as_str()
                .expect("the variant bytes")
                .to_owned()
        };
        let variant_identity = |name: &str| {
            vectors[name]["identity"]
                .as_str()
                .expect("the variant identity")
                .to_owned()
        };

        for name in ["order_sensitivity", "envelope_key_sensitivity"] {
            assert_ne!(variant_identity(name), identity, "{name} must differ");
            assert_ne!(variant(name), vectors["canonical_bytes"].as_str().unwrap());
        }
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&variant("order_sensitivity"))
                .expect("transposed parses")["view"],
            serde_json::from_str::<serde_json::Value>(vectors["canonical_bytes"].as_str().unwrap())
                .expect("canonical parses")["view"],
            "the transposed vector must carry the same data",
        );
    }

    #[rstest]
    fn owner_projection_becomes_stale_after_its_valid_through_cut() {
        let view = project_research_view_at(&research_view(1_000, 601_000), 601_001);
        assert_eq!(view.availability, ResearchViewAvailability::Stale);
        assert_eq!(view.observed_at_epoch_ms, 1_000);
        assert_eq!(view.projection_at_epoch_ms, 601_001);
        assert_eq!(
            view.next_legal_action,
            ResearchNextLegalAction::ResolveSameRequestIdentity
        );
    }

    #[rstest]
    fn current_artifact_projection_preserves_owner_review_action() {
        let mut view = research_view(1_000, 2_000);
        view.phase = ResearchViewPhase::ArtifactAvailable;
        view.next_legal_action = ResearchNextLegalAction::ReviewArtifact;
        view.valid_through_epoch_ms = 2_000;

        let projected = project_research_view_at(&view, 1_999);
        assert_eq!(projected.availability, ResearchViewAvailability::Available);
        assert_eq!(projected.projection_at_epoch_ms, 1_000);
        assert_eq!(
            projected.next_legal_action,
            ResearchNextLegalAction::ReviewArtifact
        );
    }

    #[rstest]
    fn research_view_identity_binds_authorization_cut_and_complete_source_frontier() {
        let mut view = research_view(1_000, 601_000);
        view.projection_identity = canonical_research_view_identity_v2(&view);
        let identity = view.projection_identity.clone();

        let stale = project_research_view_stale_at(&view, 601_001);
        assert_eq!(canonical_research_view_identity_v2(&stale), identity);

        let mut foreign_cut = view.clone();
        foreign_cut.authorization_policy_cut = "operator-frontier-foreign-v1".to_string();
        assert_ne!(canonical_research_view_identity_v2(&foreign_cut), identity);

        let mut foreign_source = view;
        foreign_source.source_frontier.push(ResearchSourceV1 {
            locator: "https://caller.invalid/forged".to_string(),
            content_digest: format!("sha256:{}", "f".repeat(64)),
            observed_at: "2026-08-23T00:00:00Z".to_string(),
            source_cut: "caller-source-cut-v1".to_string(),
            license_basis: "caller".to_string(),
            interpretation: "forged".to_string(),
        });
        assert_ne!(
            canonical_research_view_identity_v2(&foreign_source),
            identity
        );
    }

    /// Pins this side's canonical byte order against the consumer's, through one file both read.
    ///
    /// The Dashboard's consumer verifies a View by deriving this identity itself, so two
    /// independent implementations have to agree. The duplication is the check, not an oversight:
    /// a single shared implementation would remove it along with the verification. What the
    /// duplication lacks on its own is a signal, because a field reordered here makes the consumer
    /// reject every View while everything on this side still passes. Reading the same vectors from
    /// here turns that into a failure where the change is made.
    #[rstest]
    fn research_view_identity_matches_the_shared_vectors() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../product/rd-owner-client/fixtures/research_view_identity_vectors_v1.json");
        let vectors: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&path).expect("the shared identity vectors"),
        )
        .expect("the shared identity vectors parse");
        let view: ResearchViewV1 =
            serde_json::from_value(vectors["view"].clone()).expect("the pinned View deserializes");

        let identity = vectors["identity"].as_str().expect("the pinned identity");
        assert_eq!(canonical_research_view_identity_v2(&view), identity);
        assert_eq!(view.projection_identity, identity);

        let canonical_bytes = vectors["canonical_bytes"]
            .as_str()
            .expect("the pinned canonical bytes");
        assert_eq!(
            serde_json::to_string(&ResearchViewIdentityEnvelopeV2 {
                domain: "rd.research-view.identity.v2",
                value: ResearchViewIdentityMeaningV2 {
                    schema_version: view.schema_version,
                    request_identity: &view.request_identity,
                    trusted_principal: &view.trusted_principal,
                    authorized_scope: &view.authorized_scope,
                    authorization_policy_cut: &view.authorization_policy_cut,
                    source_owner: &view.source_owner,
                    source_cut: &view.source_cut,
                    phase: &view.phase,
                    intent_identity: &view.intent_identity,
                    source_frontier: &view.source_frontier,
                    attempt_identity: view.attempt_identity.as_deref(),
                    artifact_identity: view.artifact_identity.as_deref(),
                    build_receipt_identity: view.build_receipt_identity.as_deref(),
                    artifact_review_identity: view.artifact_review_identity.as_deref(),
                },
            })
            .expect("the identity meaning serializes"),
            canonical_bytes,
        );

        // A vector that only maps an input to an identity proves the mapping exists. It says
        // nothing about the field order that produced it, and the order is what drifts unseen.
        let transposed_bytes = vectors["order_sensitivity"]["canonical_bytes"]
            .as_str()
            .expect("the transposed bytes");
        assert_ne!(transposed_bytes, canonical_bytes);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(transposed_bytes).expect("transposed parses"),
            serde_json::from_str::<serde_json::Value>(canonical_bytes).expect("canonical parses"),
            "the transposed vector must carry the same data",
        );
        assert_ne!(
            vectors["order_sensitivity"]["identity"]
                .as_str()
                .expect("the transposed identity"),
            identity,
        );
    }

    #[rstest]
    fn unsourced_proposal_shape_has_no_research_source_fields() {
        let proposal = unsourced_proposal();
        let UnsourcedResearchProposalV1 {
            request_identity: _,
            channel: _,
            admission: _,
            goal,
            trial_family_proposal: _,
            instrument_scope: _,
        } = proposal.clone();
        let UnsourcedResearchGoalV1 {
            hypothesis: _,
            mechanism: _,
            falsification_question: _,
            expected_observation: _,
            required_data: _,
            cost_assumption: _,
            capacity_assumption: _,
        } = goal;
        let json = serde_json::to_value(&proposal).unwrap();
        assert!(json["goal"].get("sources").is_none());
        let mut forged = json;
        forged["goal"]["sources"] = serde_json::json!([]);
        assert!(serde_json::from_value::<UnsourcedResearchProposalV1>(forged).is_err());
    }

    #[rstest]
    fn sealed_ancestry_assembles_only_a_partial_canonical_research_input() {
        let (ancestry, content_digest) = crate::source_intake::verified_research_ancestry_fixture();
        let ancestry_identity = ancestry.evidence_identity().to_string();
        let partial =
            assemble_partial_source_intake_research_admission_input(unsourced_proposal(), ancestry)
                .unwrap_or_else(|_| panic!("canonical Research validator rejected valid assembly"));
        assert_eq!(partial.ancestry_evidence_identity(), ancestry_identity);
        assert_eq!(partial.request().goal.sources.len(), 1);
        assert_eq!(
            partial.request().goal.sources[0].content_digest,
            content_digest
        );
        let canonical = partial.into_canonical_request();
        assert_eq!(
            canonical.goal.sources[0].locator,
            "urn:doi:10.1234/ancestry"
        );
    }

    #[rstest]
    fn invalid_unsourced_meaning_is_rejected_by_canonical_research_validator() {
        let mut proposal = unsourced_proposal();
        proposal.goal.hypothesis = "short".into();
        let (ancestry, _) = crate::source_intake::verified_research_ancestry_fixture();
        match assemble_partial_source_intake_research_admission_input(proposal, ancestry) {
            Err(rejected) => assert_eq!(rejected.into_parts().1, "HYPOTHESIS_INVALID"),
            Ok(_) => panic!("invalid Research meaning reached partial admission input"),
        }
    }

    fn unsourced_proposal() -> UnsourcedResearchProposalV1 {
        UnsourcedResearchProposalV1 {
            request_identity: "research-request-ancestry-001".into(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: ProductEdgeAdmissionLocatorV1 {
                request_identity: "research-request-ancestry-001".into(),
                admission_identity: "research-admission-ancestry-001".into(),
                admission_digest: format!("sha256:{}", "7".repeat(64)),
            },
            goal: UnsourcedResearchGoalV1 {
                hypothesis: "A testable research hypothesis with bounded meaning.".into(),
                mechanism: "A causal mechanism that is distinct from source popularity.".into(),
                falsification_question: "Does the mechanism fail on the frozen untouched cut?"
                    .into(),
                expected_observation: "The signed effect persists after costs.".into(),
                required_data: vec!["point-in-time market observations".into()],
                cost_assumption: "Frozen conservative cost model".into(),
                capacity_assumption: "Frozen conservative capacity model".into(),
            },
            trial_family_proposal: TrialFamilyProposalV1 {
                trial_budget: 16,
                stop_rule: "Stop at the frozen family budget or first terminal falsifier.".into(),
                pit_rule_identity: "pit-rule-v1".into(),
                cost_model_identity: "cost-model-v1".into(),
                slippage_model_identity: "slippage-model-v1".into(),
                capacity_model_identity: "capacity-model-v1".into(),
                independence_rationale: "No protected feedback informed this proposal.".into(),
            },
            instrument_scope: None,
        }
    }

    fn request_v2(request_identity: &str) -> ProductEdgeResearchGoalRequestV2 {
        ProductEdgeResearchGoalRequestV2 {
            request_identity: request_identity.to_string(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: ProductEdgeAdmissionLocatorV1 {
                request_identity: request_identity.to_string(),
                admission_identity: "product-edge-admission-test-v1".to_string(),
                admission_digest: format!("sha256:{}", "b".repeat(64)),
            },
            goal: SourcedResearchGoalV2 {
                hypothesis: "A bounded point-in-time momentum effect persists after exact costs."
                    .to_string(),
                mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
                falsification_question:
                    "Does the bounded effect disappear after exact modeled costs?".to_string(),
                expected_observation: "Net continuation remains positive.".to_string(),
                required_data: vec!["PIT adjusted bars".to_string()],
                cost_assumption: "Exact model identity below.".to_string(),
                capacity_assumption: "Capacity model identity below.".to_string(),
                sources: vec![ResearchSourceV1 {
                    locator: "https://example.com/research".to_string(),
                    content_digest: format!("sha256:{}", "a".repeat(64)),
                    observed_at: "2026-08-21T00:00:00Z".to_string(),
                    source_cut: "source-cut-v1".to_string(),
                    license_basis: "public research".to_string(),
                    interpretation: "Bounded source interpretation only.".to_string(),
                }],
            },
            trial_family_proposal: TrialFamilyProposalV1 {
                trial_budget: 8,
                stop_rule: "Stop on falsifier, exhausted budget, or unavailable PIT input."
                    .to_string(),
                pit_rule_identity: "pit-rule-v1".to_string(),
                cost_model_identity: "cost-model-v1".to_string(),
                slippage_model_identity: "slippage-model-v1".to_string(),
                capacity_model_identity: "capacity-model-v1".to_string(),
                independence_rationale: "No known local predecessor before Owner resolution."
                    .to_string(),
            },
            instrument_scope: None,
        }
    }

    fn research_view(projection_at_epoch_ms: u64, valid_through_epoch_ms: u64) -> ResearchViewV1 {
        ResearchViewV1 {
            schema_version: 1,
            projection_identity: "rd-research-view-test-v1".to_string(),
            request_identity: "research-request-test-v1".to_string(),
            trusted_principal: "admin".to_string(),
            authorized_scope: vec![
                RESEARCH_SCOPE_V1.to_string(),
                RESEARCH_VIEW_SCOPE_V1.to_string(),
            ],
            authorization_policy_cut: "operator-frontier-test-v1".to_string(),
            source_owner: RESEARCH_OWNER_V1.to_string(),
            source_cut: "rd-source-cut-test-v1".to_string(),
            observed_at_epoch_ms: 1_000,
            projection_at_epoch_ms,
            valid_through_epoch_ms,
            availability: ResearchViewAvailability::Available,
            phase: ResearchViewPhase::IntentFrozen,
            intent_identity: "rd-research-intent-test-v1".to_string(),
            source_frontier: Vec::new(),
            attempt_identity: None,
            artifact_identity: None,
            build_receipt_identity: None,
            artifact_review_identity: None,
            composer_artifact: None,
            exploration: None,
            next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
        }
    }

    fn scope_wire(identities: &[&str]) -> ResearchInstrumentScopeWireV1 {
        ResearchInstrumentScopeWireV1 {
            schema_version: 1,
            identities: identities
                .iter()
                .map(|identity| (*identity).to_string())
                .collect(),
        }
    }

    fn request_v3(request_identity: &str, identities: &[&str]) -> ProductEdgeResearchGoalRequestV2 {
        ProductEdgeResearchGoalRequestV2 {
            instrument_scope: Some(scope_wire(identities)),
            ..request_v2(request_identity)
        }
    }

    /// A V2 request is stored, digested and admitted exactly as before the scope existed: the
    /// field is absent from its bytes, and its meaning digest is the four-field digest.
    #[rstest]
    fn a_v2_request_keeps_its_bytes_and_meaning_digest() {
        // The digest before the scope existed: these four fields, in this order.
        #[derive(Serialize)]
        struct FourFields<'a> {
            request_identity: &'a str,
            admission: &'a ProductEdgeAdmissionLocatorV1,
            goal: &'a SourcedResearchGoalV2,
            trial_family_proposal: &'a TrialFamilyProposalV1,
        }

        let request = request_v2("research-request-v2-bytes-0001");
        let bytes = serde_json::to_value(&request).unwrap();
        assert!(bytes.get("instrument_scope").is_none());

        let four_fields = serde_json::to_vec(&FourFields {
            request_identity: &request.request_identity,
            admission: &request.admission,
            goal: &request.goal,
            trial_family_proposal: &request.trial_family_proposal,
        })
        .unwrap();
        assert_eq!(
            semantic_digest_v2(&request).unwrap(),
            format!("sha256:{:x}", Sha256::digest(four_fields))
        );
        assert_eq!(
            request.admitted_operation(),
            (RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2)
        );
    }

    #[rstest]
    fn the_scope_is_part_of_a_v3_request_meaning() {
        let one = request_v3("research-request-v3-meaning-01", &["BTCUSDT-PERP.BINANCE"]);
        let other = request_v3("research-request-v3-meaning-01", &["ETHUSDT-PERP.BINANCE"]);
        let v2 = request_v2("research-request-v3-meaning-01");

        assert_ne!(
            semantic_digest_v2(&one).unwrap(),
            semantic_digest_v2(&other).unwrap()
        );
        assert_ne!(
            semantic_digest_v2(&one).unwrap(),
            semantic_digest_v2(&v2).unwrap()
        );
        assert_eq!(
            one.admitted_operation(),
            (RESEARCH_GOAL_OPERATION_V3, RESEARCH_GOAL_SCHEMA_V3)
        );
    }

    #[rstest]
    #[case::empty(&[])]
    #[case::unordered(&["ETHUSDT-PERP.BINANCE", "BTCUSDT-PERP.BINANCE"])]
    #[case::padded(&[" BTCUSDT-PERP.BINANCE"])]
    fn a_scope_that_is_not_canonical_is_rejected_by_name(#[case] identities: &[&str]) {
        let rejected =
            validate_goal_request_v2(request_v3("research-request-v3-invalid-01", identities))
                .err()
                .expect("a non-canonical scope is rejected");
        assert_eq!(rejected.into_parts().1, INSTRUMENT_SCOPE_INVALID);
    }

    /// Every V2 field is checked first, so a V2 rejection code is never displaced by the scope.
    #[rstest]
    fn a_v2_field_rejection_precedes_the_scope() {
        let mut request = request_v3("research-request-v3-order-0001", &[]);
        request.goal.hypothesis = "short".to_string();

        let rejected = validate_goal_request_v2(request).err().expect("rejected");
        assert_eq!(rejected.into_parts().1, "HYPOTHESIS_INVALID");
    }

    #[rstest]
    fn a_valid_scope_freezes_a_schema_three_intent_that_binds_it() {
        let scope =
            ResearchInstrumentScopeV1::from_wire(scope_wire(&["BTCUSDT-PERP.BINANCE"])).unwrap();
        let (schema, frozen) = expected_intent_scope(&request_v3(
            "research-request-v3-intent-01",
            &["BTCUSDT-PERP.BINANCE"],
        ))
        .unwrap();

        assert_eq!(schema, RESEARCH_INTENT_SCHEMA_V3);
        assert_eq!(
            frozen,
            Some(FrozenResearchInstrumentScopeV1 {
                scope_identity: lower_hex(scope.identity().as_bytes()),
                canonical_bytes: lower_hex(scope.canonical_bytes()),
            })
        );
        assert_eq!(
            expected_intent_scope(&request_v2("research-request-v3-intent-01")).unwrap(),
            (RESEARCH_INTENT_SCHEMA_V2, None)
        );
    }

    fn decision_cut() -> MarketDataDecisionCutV1 {
        MarketDataDecisionCutV1 {
            clock_identity: "market-data-clock-test".to_string(),
            clock_epoch: "epoch-1".to_string(),
            decision_cut: 1_000,
            monotonic_sequence: 7,
            restart_continuity_digest: BindingDigest::from_untrusted_bytes([3; 32]),
            valid_through: 2_000,
            uncertainty_bound: 1,
            skew_bound: 1,
        }
    }

    fn check(
        frontier: Option<[u8; 32]>,
        rows: &[(&str, InstrumentAdmissibilityV1)],
    ) -> InstrumentScopeCheckRecordV1 {
        InstrumentScopeCheckRecordV1 {
            eligible_instrument_frontier: frontier.map(BindingDigest::from_untrusted_bytes),
            decision_cut: decision_cut(),
            rows: rows
                .iter()
                .map(|(identity, admissibility)| InstrumentScopeCheckRowV1 {
                    identity: (*identity).to_string(),
                    admissibility: *admissibility,
                })
                .collect(),
        }
    }

    #[rstest]
    fn a_check_record_must_answer_exactly_the_scope_on_a_stated_basis() {
        use InstrumentAdmissibilityV1::{Admissible, NotInEligibleFrontier, Unresolved};

        let scope = ResearchInstrumentScopeV1::from_wire(scope_wire(&[
            "BTCUSDT-PERP.BINANCE",
            "ETHUSDT-PERP.BINANCE",
        ]))
        .unwrap();
        let btc = "BTCUSDT-PERP.BINANCE";
        let eth = "ETHUSDT-PERP.BINANCE";

        let admitting = check(Some([9; 32]), &[(btc, Admissible), (eth, Admissible)]);
        assert_eq!(admitting.validate_against(&scope), Ok(()));
        assert!(admitting.admits());

        let refusing = check(Some([9; 32]), &[(btc, Admissible), (eth, Unresolved)]);
        assert_eq!(refusing.validate_against(&scope), Ok(()));
        assert!(!refusing.admits());

        let no_frontier = check(
            None,
            &[(btc, NotInEligibleFrontier), (eth, NotInEligibleFrontier)],
        );
        assert_eq!(no_frontier.validate_against(&scope), Ok(()));
        assert!(!no_frontier.admits());

        for malformed in [
            check(Some([9; 32]), &[(eth, Admissible), (btc, Admissible)]),
            check(Some([9; 32]), &[(btc, Admissible)]),
            check(None, &[(btc, Unresolved), (eth, NotInEligibleFrontier)]),
            check(Some([0; 32]), &[(btc, Unresolved), (eth, Unresolved)]),
        ] {
            assert!(malformed.validate_against(&scope).is_err(), "{malformed:?}");
        }

        let mut stale = refusing;
        stale.decision_cut.valid_through = stale.decision_cut.decision_cut;
        assert!(stale.validate_against(&scope).is_err());
    }
}
