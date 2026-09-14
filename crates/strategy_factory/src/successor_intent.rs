//! R&D-owned freezing of one Decision-selected successor Research Intent.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    IterationExperimentModeV1,
    product_edge::{
        ResearchSourceV1, SourcedResearchGoalV2, UnsourcedResearchGoalV1,
        validate_successor_goal_v1,
    },
};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SuccessorResearchIntentCompositionRequestV1 {
    pub request_identity: String,
    pub decision_identity: String,
    pub result_identity: String,
    pub goal: UnsourcedResearchGoalV1,
}

/// Immutable successor Intent. Its sources and all lineage bindings come from locked Owner facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenSuccessorResearchIntentV1 {
    schema_version: u16,
    intent_identity: String,
    intent_digest: String,
    request_identity: String,
    goal: SourcedResearchGoalV2,
    predecessor_intent_identity: String,
    predecessor_intent_digest: String,
    decision_identity: String,
    decision_digest: String,
    decision_receipt_identity: String,
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
    experiment: IterationExperimentModeV1,
    frozen_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SuccessorResearchIntentReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    request_identity: String,
    intent_identity: String,
    intent_digest: String,
    decision_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SuccessorResearchIntentReadbackV1 {
    intent: FrozenSuccessorResearchIntentV1,
    receipt: SuccessorResearchIntentReceiptV1,
}

#[derive(Debug, Error)]
pub enum SuccessorResearchIntentErrorV1 {
    #[error("successor Research Intent input is invalid: {0}")]
    Invalid(&'static str),
    #[error("successor Research Intent encoding is unavailable: {0}")]
    Encoding(String),
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SuccessorResearchIntentSourceV1 {
    pub predecessor_intent_identity: String,
    pub predecessor_intent_digest: String,
    pub source_frontier: Vec<ResearchSourceV1>,
    pub decision_identity: String,
    pub decision_digest: String,
    pub decision_receipt_identity: String,
    pub result_identity: String,
    pub trial_family_identity: String,
    pub trial_family_policy_digest: String,
    pub census_frontier_identity: String,
    pub census_frontier_digest: String,
    pub independence_basis_identity: String,
    pub independence_basis_digest: String,
    pub protected_feedback_projection_identity: String,
    pub protected_feedback_projection_digest: String,
    pub experiment_identity: String,
    pub experiment_digest: String,
    pub experiment: IterationExperimentModeV1,
}

#[derive(Serialize)]
struct IntentMeaningV1<'a> {
    schema_version: u16,
    request_identity: &'a str,
    goal: &'a SourcedResearchGoalV2,
    source: &'a SuccessorResearchIntentSourceV1,
    frozen_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ReceiptMeaningV1<'a> {
    schema_version: u16,
    request_identity: &'a str,
    intent_identity: &'a str,
    intent_digest: &'a str,
    decision_identity: &'a str,
    result_identity: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredFrozenSuccessorResearchIntentV1 {
    schema_version: u16,
    intent_identity: String,
    intent_digest: String,
    request_identity: String,
    goal: SourcedResearchGoalV2,
    predecessor_intent_identity: String,
    predecessor_intent_digest: String,
    decision_identity: String,
    decision_digest: String,
    decision_receipt_identity: String,
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
    experiment: IterationExperimentModeV1,
    frozen_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredSuccessorResearchIntentReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    request_identity: String,
    intent_identity: String,
    intent_digest: String,
    decision_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

pub(crate) fn issue_successor_research_intent_v1(
    request: SuccessorResearchIntentCompositionRequestV1,
    source: SuccessorResearchIntentSourceV1,
    committed_at_epoch_ms: u64,
) -> Result<SuccessorResearchIntentReadbackV1, SuccessorResearchIntentErrorV1> {
    validate_request(&request, &source)?;
    let goal = SourcedResearchGoalV2 {
        hypothesis: request.goal.hypothesis,
        mechanism: request.goal.mechanism,
        falsification_question: request.goal.falsification_question,
        expected_observation: request.goal.expected_observation,
        required_data: request.goal.required_data,
        cost_assumption: request.goal.cost_assumption,
        capacity_assumption: request.goal.capacity_assumption,
        sources: source.source_frontier.clone(),
    };
    validate_successor_goal_v1(&goal).map_err(SuccessorResearchIntentErrorV1::Invalid)?;
    let intent_digest = canonical_digest(
        "rd.successor-research-intent.v1",
        &IntentMeaningV1 {
            schema_version: 1,
            request_identity: &request.request_identity,
            goal: &goal,
            source: &source,
            frozen_at_epoch_ms: committed_at_epoch_ms,
        },
    )?;
    let intent_identity = identity("rd-successor-research-intent-v1", &intent_digest);
    let intent = FrozenSuccessorResearchIntentV1 {
        schema_version: 1,
        intent_identity: intent_identity.clone(),
        intent_digest: intent_digest.clone(),
        request_identity: request.request_identity.clone(),
        goal,
        predecessor_intent_identity: source.predecessor_intent_identity,
        predecessor_intent_digest: source.predecessor_intent_digest,
        decision_identity: source.decision_identity.clone(),
        decision_digest: source.decision_digest,
        decision_receipt_identity: source.decision_receipt_identity,
        result_identity: source.result_identity.clone(),
        trial_family_identity: source.trial_family_identity,
        trial_family_policy_digest: source.trial_family_policy_digest,
        census_frontier_identity: source.census_frontier_identity,
        census_frontier_digest: source.census_frontier_digest,
        independence_basis_identity: source.independence_basis_identity,
        independence_basis_digest: source.independence_basis_digest,
        protected_feedback_projection_identity: source.protected_feedback_projection_identity,
        protected_feedback_projection_digest: source.protected_feedback_projection_digest,
        experiment_identity: source.experiment_identity,
        experiment_digest: source.experiment_digest,
        experiment: source.experiment,
        frozen_at_epoch_ms: committed_at_epoch_ms,
    };
    let receipt_digest = canonical_digest(
        "rd.successor-research-intent-receipt.v1",
        &ReceiptMeaningV1 {
            schema_version: 1,
            request_identity: &request.request_identity,
            intent_identity: &intent_identity,
            intent_digest: &intent_digest,
            decision_identity: &source.decision_identity,
            result_identity: &source.result_identity,
            committed_at_epoch_ms,
        },
    )?;
    let receipt = SuccessorResearchIntentReceiptV1 {
        schema_version: 1,
        receipt_identity: identity("rd-successor-research-intent-receipt-v1", &receipt_digest),
        request_identity: request.request_identity,
        intent_identity,
        intent_digest,
        decision_identity: source.decision_identity,
        result_identity: source.result_identity,
        committed_at_epoch_ms,
    };
    Ok(SuccessorResearchIntentReadbackV1 { intent, receipt })
}

pub(crate) fn admit_stored_successor_research_intent_v1(
    request_bytes: &[u8],
    intent_bytes: &[u8],
    receipt_bytes: &[u8],
) -> Result<SuccessorResearchIntentReadbackV1, SuccessorResearchIntentErrorV1> {
    let request: SuccessorResearchIntentCompositionRequestV1 =
        serde_json::from_slice(request_bytes)
            .map_err(|e| SuccessorResearchIntentErrorV1::Encoding(e.to_string()))?;
    let intent: StoredFrozenSuccessorResearchIntentV1 = serde_json::from_slice(intent_bytes)
        .map_err(|e| SuccessorResearchIntentErrorV1::Encoding(e.to_string()))?;
    let receipt: StoredSuccessorResearchIntentReceiptV1 = serde_json::from_slice(receipt_bytes)
        .map_err(|e| SuccessorResearchIntentErrorV1::Encoding(e.to_string()))?;
    if intent.schema_version != 1
        || receipt.schema_version != 1
        || intent.request_identity != request.request_identity
        || receipt.request_identity != request.request_identity
        || receipt.intent_identity != intent.intent_identity
        || receipt.intent_digest != intent.intent_digest
        || receipt.decision_identity != intent.decision_identity
        || receipt.result_identity != intent.result_identity
        || receipt.committed_at_epoch_ms != intent.frozen_at_epoch_ms
        || !valid_identity(&receipt.receipt_identity)
    {
        return Err(SuccessorResearchIntentErrorV1::Invalid(
            "stored Intent and receipt envelope mismatch",
        ));
    }
    let source = SuccessorResearchIntentSourceV1 {
        predecessor_intent_identity: intent.predecessor_intent_identity,
        predecessor_intent_digest: intent.predecessor_intent_digest,
        source_frontier: intent.goal.sources,
        decision_identity: intent.decision_identity,
        decision_digest: intent.decision_digest,
        decision_receipt_identity: intent.decision_receipt_identity,
        result_identity: intent.result_identity,
        trial_family_identity: intent.trial_family_identity,
        trial_family_policy_digest: intent.trial_family_policy_digest,
        census_frontier_identity: intent.census_frontier_identity,
        census_frontier_digest: intent.census_frontier_digest,
        independence_basis_identity: intent.independence_basis_identity,
        independence_basis_digest: intent.independence_basis_digest,
        protected_feedback_projection_identity: intent.protected_feedback_projection_identity,
        protected_feedback_projection_digest: intent.protected_feedback_projection_digest,
        experiment_identity: intent.experiment_identity,
        experiment_digest: intent.experiment_digest,
        experiment: intent.experiment,
    };
    let expected =
        issue_successor_research_intent_v1(request, source, receipt.committed_at_epoch_ms)?;
    if serde_json::to_vec(&expected.intent).map_err(encoding)? != intent_bytes
        || serde_json::to_vec(&expected.receipt).map_err(encoding)? != receipt_bytes
    {
        return Err(SuccessorResearchIntentErrorV1::Invalid(
            "stored canonical bytes or digest mismatch",
        ));
    }
    Ok(expected)
}

fn validate_request(
    request: &SuccessorResearchIntentCompositionRequestV1,
    source: &SuccessorResearchIntentSourceV1,
) -> Result<(), SuccessorResearchIntentErrorV1> {
    for value in [
        request.request_identity.as_str(),
        request.decision_identity.as_str(),
        request.result_identity.as_str(),
        source.predecessor_intent_identity.as_str(),
        source.decision_receipt_identity.as_str(),
        source.trial_family_identity.as_str(),
        source.census_frontier_identity.as_str(),
        source.independence_basis_identity.as_str(),
        source.protected_feedback_projection_identity.as_str(),
        source.experiment_identity.as_str(),
    ] {
        if !valid_identity(value) {
            return Err(SuccessorResearchIntentErrorV1::Invalid(
                "identity is invalid",
            ));
        }
    }

    for digest in [
        source.predecessor_intent_digest.as_str(),
        source.decision_digest.as_str(),
        source.trial_family_policy_digest.as_str(),
        source.census_frontier_digest.as_str(),
        source.independence_basis_digest.as_str(),
        source.protected_feedback_projection_digest.as_str(),
        source.experiment_digest.as_str(),
    ] {
        if !valid_digest(digest) {
            return Err(SuccessorResearchIntentErrorV1::Invalid("digest is invalid"));
        }
    }

    if request.decision_identity != source.decision_identity
        || request.result_identity != source.result_identity
    {
        return Err(SuccessorResearchIntentErrorV1::Invalid(
            "request does not bind the locked Decision",
        ));
    }
    Ok(())
}

fn valid_identity(value: &str) -> bool {
    (4..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

fn valid_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, SuccessorResearchIntentErrorV1> {
    let bytes = serde_json::to_vec(value)
        .map_err(|e| SuccessorResearchIntentErrorV1::Encoding(e.to_string()))?;
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

#[expect(
    clippy::needless_pass_by_value,
    reason = "the serde map_err adapter receives and consumes its owned error value"
)]
fn encoding(error: serde_json::Error) -> SuccessorResearchIntentErrorV1 {
    SuccessorResearchIntentErrorV1::Encoding(error.to_string())
}

impl FrozenSuccessorResearchIntentV1 {
    pub fn intent_identity(&self) -> &str {
        &self.intent_identity
    }
    pub fn intent_digest(&self) -> &str {
        &self.intent_digest
    }
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub fn goal(&self) -> &SourcedResearchGoalV2 {
        &self.goal
    }
    pub fn predecessor_intent_identity(&self) -> &str {
        &self.predecessor_intent_identity
    }
    pub fn predecessor_intent_digest(&self) -> &str {
        &self.predecessor_intent_digest
    }
    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }
    pub fn decision_digest(&self) -> &str {
        &self.decision_digest
    }
    pub fn result_identity(&self) -> &str {
        &self.result_identity
    }
    pub fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }
    pub fn trial_family_policy_digest(&self) -> &str {
        &self.trial_family_policy_digest
    }
    pub fn census_frontier_identity(&self) -> &str {
        &self.census_frontier_identity
    }
    pub fn census_frontier_digest(&self) -> &str {
        &self.census_frontier_digest
    }
    pub fn independence_basis_identity(&self) -> &str {
        &self.independence_basis_identity
    }
    pub fn independence_basis_digest(&self) -> &str {
        &self.independence_basis_digest
    }
    pub fn protected_feedback_projection_identity(&self) -> &str {
        &self.protected_feedback_projection_identity
    }
    pub fn protected_feedback_projection_digest(&self) -> &str {
        &self.protected_feedback_projection_digest
    }
    pub fn experiment_identity(&self) -> &str {
        &self.experiment_identity
    }
    pub fn experiment_digest(&self) -> &str {
        &self.experiment_digest
    }
    pub fn experiment(&self) -> &IterationExperimentModeV1 {
        &self.experiment
    }
    pub const fn frozen_at_epoch_ms(&self) -> u64 {
        self.frozen_at_epoch_ms
    }
}

impl SuccessorResearchIntentReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub fn intent_identity(&self) -> &str {
        &self.intent_identity
    }
    pub fn intent_digest(&self) -> &str {
        &self.intent_digest
    }
    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }
    pub fn result_identity(&self) -> &str {
        &self.result_identity
    }
    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl SuccessorResearchIntentReadbackV1 {
    pub fn intent(&self) -> &FrozenSuccessorResearchIntentV1 {
        &self.intent
    }
    pub fn receipt(&self) -> &SuccessorResearchIntentReceiptV1 {
        &self.receipt
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::IterationHypothesisDimensionV1;

    fn digest(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }

    fn request() -> SuccessorResearchIntentCompositionRequestV1 {
        SuccessorResearchIntentCompositionRequestV1 {
            request_identity: "successor-request-0001".into(),
            decision_identity: "decision-0001".into(),
            result_identity: "result-0001".into(),
            goal: UnsourcedResearchGoalV1 {
                hypothesis: "A narrower entry signal improves net returns.".into(),
                mechanism: "The entry filter removes low-conviction observations.".into(),
                falsification_question: "Does the filtered signal fail after costs?".into(),
                expected_observation: "Higher net expectancy with bounded turnover.".into(),
                required_data: vec!["sealed market bars".into()],
                cost_assumption: "Canonical cost model remains fixed.".into(),
                capacity_assumption: "Canonical capacity model remains fixed.".into(),
            },
        }
    }

    fn source() -> SuccessorResearchIntentSourceV1 {
        SuccessorResearchIntentSourceV1 {
            predecessor_intent_identity: "intent-0001".into(),
            predecessor_intent_digest: digest('1'),
            source_frontier: vec![ResearchSourceV1 {
                locator: "urn:research:source:1".into(),
                content_digest: digest('2'),
                observed_at: "2026-09-14T00:00:00Z".into(),
                source_cut: "sealed-source-cut".into(),
                license_basis: "internal research evidence".into(),
                interpretation: "Evidence retained from the predecessor Intent.".into(),
            }],
            decision_identity: "decision-0001".into(),
            decision_digest: digest('3'),
            decision_receipt_identity: "decision-receipt-0001".into(),
            result_identity: "result-0001".into(),
            trial_family_identity: "family-0001".into(),
            trial_family_policy_digest: digest('4'),
            census_frontier_identity: "census-0001".into(),
            census_frontier_digest: digest('5'),
            independence_basis_identity: "basis-0001".into(),
            independence_basis_digest: digest('6'),
            protected_feedback_projection_identity: "protected-0001".into(),
            protected_feedback_projection_digest: digest('7'),
            experiment_identity: "experiment-0001".into(),
            experiment_digest: digest('8'),
            experiment: IterationExperimentModeV1::SingleDimension {
                changed_dimension: IterationHypothesisDimensionV1::EntryRule,
            },
        }
    }

    #[rstest::rstest]
    fn freezes_exact_decision_selected_successor_and_round_trips_stored_bytes() {
        let request = request();
        let readback = issue_successor_research_intent_v1(request.clone(), source(), 42)
            .expect("successor Intent");
        assert_eq!(readback.intent().goal().sources, source().source_frontier);
        assert_eq!(readback.intent().decision_identity(), "decision-0001");
        assert_eq!(readback.intent().experiment_identity(), "experiment-0001");

        let admitted = admit_stored_successor_research_intent_v1(
            &serde_json::to_vec(&request).expect("request bytes"),
            &serde_json::to_vec(readback.intent()).expect("intent bytes"),
            &serde_json::to_vec(readback.receipt()).expect("receipt bytes"),
        )
        .expect("stored successor Intent");
        assert_eq!(admitted, readback);
        assert_eq!(
            issue_successor_research_intent_v1(request, source(), 42)
                .expect("deterministic successor Intent"),
            readback
        );
    }

    #[rstest::rstest]
    fn rejects_a_request_that_repeats_a_different_decision() {
        let mut request = request();
        request.decision_identity = "decision-other".into();
        assert!(matches!(
            issue_successor_research_intent_v1(request, source(), 42),
            Err(SuccessorResearchIntentErrorV1::Invalid(
                "request does not bind the locked Decision"
            ))
        ));
    }
}
