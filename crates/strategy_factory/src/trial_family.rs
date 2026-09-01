use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const MAX_IDENTITY_BYTES: usize = 256;
const MAX_FRONTIER_MEMBERS: usize = 4_096;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyPolicyV1 {
    pub trial_budget: u32,
    pub stop_rule: String,
    pub pit_rule_identity: String,
    pub cost_model_identity: String,
    pub slippage_model_identity: String,
    pub capacity_model_identity: String,
    pub semantic_predecessor_frontier: Vec<String>,
    pub protected_feedback_frontier: String,
    pub independence_disposition: TrialFamilyIndependenceDispositionV1,
    pub independence_basis_identity: String,
    pub frozen_falsifier_binding: String,
    /// Catalog-owned Replay policy sealed by the private PostgreSQL formation resolver.
    ///
    /// `None` is retained only for exact readback of legacy families. It is never eligible for
    /// Replay V2 composition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replay_execution_policy_v2: Option<crate::ReplayPolicyCatalogBindingV2>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrialFamilyIndependenceDispositionV1 {
    Independent,
    Related,
}

/// Owner-issued positive family records are serialize-only outside this crate.
///
/// ```compile_fail
/// use serde::de::DeserializeOwned;
/// use vibe_strategy_factory::trial_family::{
///     ArtifactTrialFamilyBindingReceiptV1, ArtifactTrialFamilyBindingV1,
///     ArtifactTrialFamilyReadbackV1, TrialFamilyCensusFrontierV1,
///     TrialFamilyCensusMemberKindV1, TrialFamilyCensusMemberV1,
///     TrialFamilyMembershipReceiptV1, TrialFamilyReadbackV1,
///     TrialFamilyRootReceiptV1, TrialFamilyRootV1,
/// };
/// fn decoded<T: DeserializeOwned>() {}
/// decoded::<TrialFamilyRootV1>();
/// decoded::<TrialFamilyRootReceiptV1>();
/// decoded::<TrialFamilyCensusMemberKindV1>();
/// decoded::<TrialFamilyCensusMemberV1>();
/// decoded::<TrialFamilyMembershipReceiptV1>();
/// decoded::<TrialFamilyCensusFrontierV1>();
/// decoded::<ArtifactTrialFamilyBindingV1>();
/// decoded::<ArtifactTrialFamilyBindingReceiptV1>();
/// decoded::<TrialFamilyReadbackV1>();
/// decoded::<ArtifactTrialFamilyReadbackV1>();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyRootV1 {
    schema_version: u32,
    trial_family_identity: String,
    policy: TrialFamilyPolicyV1,
    policy_digest: String,
    root_digest: String,
    created_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyRootReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    trial_family_identity: String,
    intent_identity: String,
    root_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay_execution_policy_v2: Option<crate::ReplayPolicyCatalogBindingV2>,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrialFamilyCensusMemberKindV1 {
    Intent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum TrialFamilyCensusMemberKindV2 {
    Intent,
    Request,
    Result,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum TrialFamilyAttemptTerminalDispositionV2 {
    TerminalResult,
    Rejected,
    Invalid,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamilyCensusMemberV2 {
    schema_version: u32,
    member_identity: String,
    trial_family_identity: String,
    attempt_ordinal: u32,
    ordinal: u32,
    member_kind: TrialFamilyCensusMemberKindV2,
    fact_identity: String,
    fact_digest: String,
    terminal_disposition: Option<TrialFamilyAttemptTerminalDispositionV2>,
    member_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamilyAttemptFrontierV2 {
    schema_version: u32,
    frontier_identity: String,
    trial_family_identity: String,
    terminal_member_digests: Vec<String>,
    consumed_trial_budget: u32,
    frontier_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamilyCandidateFactV2 {
    candidate_identity: String,
    candidate_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamilyCandidateSetFrontierV2 {
    schema_version: u32,
    frontier_identity: String,
    trial_family_identity: String,
    attempt_ordinal: u32,
    generation_rule_identity: String,
    generation_rule_digest: String,
    expected_cardinality: u32,
    candidates: Vec<TrialFamilyCandidateFactV2>,
    frontier_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamilyCensusFrontierV2 {
    schema_version: u32,
    frontier_identity: String,
    trial_family_identity: String,
    root_digest: String,
    member_digests: Vec<String>,
    consumed_trial_budget: u32,
    attempt_frontier_identity: String,
    attempt_frontier_digest: String,
    candidate_set_frontier_identity: String,
    candidate_set_frontier_digest: String,
    frontier_digest: String,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )
)]
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamilyAttemptAppendV2 {
    pub intent_identity: String,
    pub intent_digest: String,
    pub request_identity: String,
    pub request_digest: String,
    pub result_identity: String,
    pub result_digest: String,
    pub terminal_disposition: TrialFamilyAttemptTerminalDispositionV2,
    pub consumed_trial_budget: u32,
    pub candidate_set: TrialFamilyCandidateSetProposalV2,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamilyCandidateSetProposalV2 {
    pub generation_rule_identity: String,
    pub generation_rule_digest: String,
    pub expected_cardinality: u32,
    pub candidates: Vec<TrialFamilyCandidateFactV2>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamilyCensusReadbackV2 {
    pub(crate) legacy_family: TrialFamilyReadbackV1,
    pub(crate) members: Vec<TrialFamilyCensusMemberV2>,
    pub(crate) membership_receipts: Vec<TrialFamilyMembershipReceiptV1>,
    pub(crate) attempt_frontier: TrialFamilyAttemptFrontierV2,
    pub(crate) candidate_set_frontier: TrialFamilyCandidateSetFrontierV2,
    pub(crate) census_frontier: TrialFamilyCensusFrontierV2,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyCensusMemberV1 {
    schema_version: u32,
    member_identity: String,
    trial_family_identity: String,
    member_kind: TrialFamilyCensusMemberKindV1,
    fact_identity: String,
    fact_digest: String,
    ordinal: u32,
    member_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyMembershipReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    trial_family_identity: String,
    member_identity: String,
    member_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyCensusFrontierV1 {
    schema_version: u32,
    frontier_identity: String,
    trial_family_identity: String,
    root_digest: String,
    member_digests: Vec<String>,
    consumed_trial_budget: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay_execution_policy_v2: Option<crate::ReplayPolicyCatalogBindingV2>,
    frontier_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactTrialFamilyBindingV1 {
    schema_version: u32,
    binding_identity: String,
    artifact_identity: String,
    build_receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    binding_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactTrialFamilyBindingReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    binding_identity: String,
    binding_digest: String,
    committed_at_epoch_ms: u64,
}

/// ```compile_fail
/// use vibe_strategy_factory::trial_family::TrialFamilyReadbackV1;
/// let _ = TrialFamilyReadbackV1 {
///     root: todo!(), root_receipt: todo!(), initial_intent_member: todo!(),
///     membership_receipt: todo!(), census_frontier: todo!(),
/// };
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyReadbackV1 {
    pub(crate) root: TrialFamilyRootV1,
    pub(crate) root_receipt: TrialFamilyRootReceiptV1,
    pub(crate) initial_intent_member: TrialFamilyCensusMemberV1,
    pub(crate) membership_receipt: TrialFamilyMembershipReceiptV1,
    pub(crate) census_frontier: TrialFamilyCensusFrontierV1,
}

/// ```compile_fail
/// use vibe_strategy_factory::trial_family::ArtifactTrialFamilyReadbackV1;
/// let _ = ArtifactTrialFamilyReadbackV1 {
///     trial_family: todo!(), binding: todo!(), binding_receipt: todo!(),
/// };
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactTrialFamilyReadbackV1 {
    pub(crate) trial_family: TrialFamilyReadbackV1,
    pub(crate) binding: ArtifactTrialFamilyBindingV1,
    pub(crate) binding_receipt: ArtifactTrialFamilyBindingReceiptV1,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredTrialFamilyRootV1 {
    schema_version: u32,
    trial_family_identity: String,
    policy: TrialFamilyPolicyV1,
    policy_digest: String,
    root_digest: String,
    created_at_epoch_ms: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredTrialFamilyRootReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    trial_family_identity: String,
    intent_identity: String,
    root_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay_execution_policy_v2: Option<crate::ReplayPolicyCatalogBindingV2>,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum StoredTrialFamilyCensusMemberKindV1 {
    Intent,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredTrialFamilyCensusMemberV1 {
    schema_version: u32,
    member_identity: String,
    trial_family_identity: String,
    member_kind: StoredTrialFamilyCensusMemberKindV1,
    fact_identity: String,
    fact_digest: String,
    ordinal: u32,
    member_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredTrialFamilyMembershipReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    trial_family_identity: String,
    member_identity: String,
    member_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredTrialFamilyCensusFrontierV1 {
    schema_version: u32,
    frontier_identity: String,
    trial_family_identity: String,
    root_digest: String,
    member_digests: Vec<String>,
    consumed_trial_budget: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay_execution_policy_v2: Option<crate::ReplayPolicyCatalogBindingV2>,
    frontier_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredArtifactTrialFamilyBindingV1 {
    schema_version: u32,
    binding_identity: String,
    artifact_identity: String,
    build_receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    binding_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredArtifactTrialFamilyBindingReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    binding_identity: String,
    binding_digest: String,
    committed_at_epoch_ms: u64,
}

/// Owner-issued family availability.
///
/// The positive representation is serialize-only and has no public constructor:
///
/// ```compile_fail
/// use vibe_strategy_factory::trial_family::TrialFamilyResolutionV1;
/// let _: TrialFamilyResolutionV1 = serde_json::from_str("\"AVAILABLE\"").unwrap();
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct TrialFamilyResolutionV1(TrialFamilyResolutionKindV1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum TrialFamilyResolutionKindV1 {
    Available,
    TrialFamilyUnavailableLegacy,
    Unavailable,
}

impl TrialFamilyResolutionV1 {
    pub fn is_available(self) -> bool {
        self.0 == TrialFamilyResolutionKindV1::Available
    }

    pub fn as_str(self) -> &'static str {
        match self.0 {
            TrialFamilyResolutionKindV1::Available => "AVAILABLE",
            TrialFamilyResolutionKindV1::TrialFamilyUnavailableLegacy => {
                "TRIAL_FAMILY_UNAVAILABLE_LEGACY"
            }
            TrialFamilyResolutionKindV1::Unavailable => "UNAVAILABLE",
        }
    }

    pub(crate) const fn available() -> Self {
        Self(TrialFamilyResolutionKindV1::Available)
    }

    pub const fn legacy_unavailable() -> Self {
        Self(TrialFamilyResolutionKindV1::TrialFamilyUnavailableLegacy)
    }

    pub(crate) const fn unavailable() -> Self {
        Self(TrialFamilyResolutionKindV1::Unavailable)
    }
}

/// Sealed transport projection for direct TrialFamily Owner resolution.
///
/// Callers can serialize Owner results, but cannot deserialize or construct a
/// positive result:
///
/// ```compile_fail
/// use vibe_strategy_factory::trial_family::TrialFamilyDirectResultV1;
/// let _: TrialFamilyDirectResultV1 = serde_json::from_str(
///     r#"{"schema_version":1,"resolution":"AVAILABLE","trial_family":null,"artifact_trial_family":null}"#,
/// ).unwrap();
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::trial_family::TrialFamilyDirectResultV1;
/// let _ = TrialFamilyDirectResultV1 {
///     schema_version: 1,
///     resolution: todo!(),
///     trial_family: None,
///     artifact_trial_family: None,
/// };
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyDirectResultV1 {
    schema_version: u32,
    resolution: TrialFamilyResolutionV1,
    trial_family: Option<TrialFamilyReadbackV1>,
    artifact_trial_family: Option<ArtifactTrialFamilyReadbackV1>,
}

impl TrialFamilyDirectResultV1 {
    pub fn schema_version(&self) -> u32 {
        self.schema_version
    }

    pub fn resolution(&self) -> TrialFamilyResolutionV1 {
        self.resolution
    }

    pub fn trial_family(&self) -> Option<&TrialFamilyReadbackV1> {
        self.trial_family.as_ref()
    }

    pub fn artifact_trial_family(&self) -> Option<&ArtifactTrialFamilyReadbackV1> {
        self.artifact_trial_family.as_ref()
    }

    pub const fn legacy_unavailable() -> Self {
        Self {
            schema_version: 1,
            resolution: TrialFamilyResolutionV1::legacy_unavailable(),
            trial_family: None,
            artifact_trial_family: None,
        }
    }

    pub const fn unavailable() -> Self {
        Self {
            schema_version: 1,
            resolution: TrialFamilyResolutionV1::unavailable(),
            trial_family: None,
            artifact_trial_family: None,
        }
    }

    pub(crate) fn available_by_intent(trial_family: TrialFamilyReadbackV1) -> Self {
        Self {
            schema_version: 1,
            resolution: TrialFamilyResolutionV1::available(),
            trial_family: Some(trial_family),
            artifact_trial_family: None,
        }
    }

    pub(crate) fn available_by_artifact(
        artifact_trial_family: ArtifactTrialFamilyReadbackV1,
    ) -> Self {
        Self {
            schema_version: 1,
            resolution: TrialFamilyResolutionV1::available(),
            trial_family: Some(artifact_trial_family.trial_family.clone()),
            artifact_trial_family: Some(artifact_trial_family),
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum TrialFamilyError {
    #[error("trial family policy is invalid: {0}")]
    InvalidPolicy(&'static str),
    #[error("trial family identity was reused with conflicting content")]
    ConflictingIdentity,
    #[error("TRIAL_FAMILY_UNAVAILABLE_LEGACY")]
    LegacyUnavailable,
    #[error("trial family Owner state is unavailable: {0}")]
    Unavailable(String),
}

impl TrialFamilyPolicyV1 {
    pub fn expected_falsifier_binding(
        falsification_question: &str,
    ) -> Result<String, TrialFamilyError> {
        falsifier_binding(falsification_question)
    }

    pub fn replay_execution_policy_v2(&self) -> Option<&crate::ReplayPolicyCatalogBindingV2> {
        self.replay_execution_policy_v2.as_ref()
    }
}

impl TrialFamilyRootV1 {
    pub fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }

    pub fn policy(&self) -> &TrialFamilyPolicyV1 {
        &self.policy
    }

    pub fn policy_digest(&self) -> &str {
        &self.policy_digest
    }

    pub fn root_digest(&self) -> &str {
        &self.root_digest
    }
}

impl TrialFamilyRootReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub fn intent_identity(&self) -> &str {
        &self.intent_identity
    }

    pub fn replay_execution_policy_v2(&self) -> Option<&crate::ReplayPolicyCatalogBindingV2> {
        self.replay_execution_policy_v2.as_ref()
    }

    pub(crate) fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl TrialFamilyCensusMemberV1 {
    pub fn member_identity(&self) -> &str {
        &self.member_identity
    }

    pub fn fact_identity(&self) -> &str {
        &self.fact_identity
    }

    pub(crate) fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }

    pub(crate) fn ordinal(&self) -> u32 {
        self.ordinal
    }

    pub fn member_digest(&self) -> &str {
        &self.member_digest
    }

    pub fn fact_digest(&self) -> &str {
        &self.fact_digest
    }
}

impl TrialFamilyMembershipReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    #[expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )]
    pub(crate) fn member_identity(&self) -> &str {
        &self.member_identity
    }

    #[expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )]
    pub(crate) fn member_digest(&self) -> &str {
        &self.member_digest
    }

    pub(crate) fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl TrialFamilyCensusFrontierV1 {
    pub fn frontier_identity(&self) -> &str {
        &self.frontier_identity
    }

    pub fn frontier_digest(&self) -> &str {
        &self.frontier_digest
    }

    pub(crate) fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }

    pub fn member_digests(&self) -> &[String] {
        &self.member_digests
    }

    pub fn replay_execution_policy_v2(&self) -> Option<&crate::ReplayPolicyCatalogBindingV2> {
        self.replay_execution_policy_v2.as_ref()
    }
}

impl ArtifactTrialFamilyBindingV1 {
    pub fn binding_identity(&self) -> &str {
        &self.binding_identity
    }

    pub fn artifact_identity(&self) -> &str {
        &self.artifact_identity
    }

    pub fn build_receipt_identity(&self) -> &str {
        &self.build_receipt_identity
    }

    pub(crate) fn intent_identity(&self) -> &str {
        &self.intent_identity
    }

    pub fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }

    pub fn binding_digest(&self) -> &str {
        &self.binding_digest
    }
}

impl ArtifactTrialFamilyBindingReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub(crate) fn binding_identity(&self) -> &str {
        &self.binding_identity
    }

    pub(crate) fn binding_digest(&self) -> &str {
        &self.binding_digest
    }

    pub(crate) fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl TrialFamilyReadbackV1 {
    pub fn root(&self) -> &TrialFamilyRootV1 {
        &self.root
    }

    pub fn root_receipt(&self) -> &TrialFamilyRootReceiptV1 {
        &self.root_receipt
    }

    pub fn initial_intent_member(&self) -> &TrialFamilyCensusMemberV1 {
        &self.initial_intent_member
    }

    pub fn membership_receipt(&self) -> &TrialFamilyMembershipReceiptV1 {
        &self.membership_receipt
    }

    pub fn census_frontier(&self) -> &TrialFamilyCensusFrontierV1 {
        &self.census_frontier
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )
)]
impl TrialFamilyCensusMemberV2 {
    pub(crate) fn member_identity(&self) -> &str {
        &self.member_identity
    }

    pub(crate) fn fact_identity(&self) -> &str {
        &self.fact_identity
    }

    pub(crate) fn member_digest(&self) -> &str {
        &self.member_digest
    }

    pub(crate) fn ordinal(&self) -> u32 {
        self.ordinal
    }

    pub(crate) fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }
}

impl TrialFamilyAttemptFrontierV2 {
    pub(crate) fn frontier_identity(&self) -> &str {
        &self.frontier_identity
    }

    pub(crate) fn frontier_digest(&self) -> &str {
        &self.frontier_digest
    }

    #[expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )]
    pub(crate) fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )
)]
impl TrialFamilyCandidateSetFrontierV2 {
    pub(crate) fn frontier_identity(&self) -> &str {
        &self.frontier_identity
    }

    pub(crate) fn frontier_digest(&self) -> &str {
        &self.frontier_digest
    }

    pub(crate) fn attempt_ordinal(&self) -> u32 {
        self.attempt_ordinal
    }
}

impl TrialFamilyCensusFrontierV2 {
    pub(crate) fn frontier_identity(&self) -> &str {
        &self.frontier_identity
    }

    pub(crate) fn frontier_digest(&self) -> &str {
        &self.frontier_digest
    }

    pub(crate) fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )
)]
impl TrialFamilyCensusReadbackV2 {
    pub(crate) fn consumed_trial_budget(&self) -> u32 {
        self.census_frontier.consumed_trial_budget
    }
}

impl ArtifactTrialFamilyReadbackV1 {
    pub fn trial_family(&self) -> &TrialFamilyReadbackV1 {
        &self.trial_family
    }

    pub fn binding(&self) -> &ArtifactTrialFamilyBindingV1 {
        &self.binding
    }

    pub fn binding_receipt(&self) -> &ArtifactTrialFamilyBindingReceiptV1 {
        &self.binding_receipt
    }
}

pub(crate) fn admit_stored_family(
    root_json: &serde_json::Value,
    root_receipt_json: &serde_json::Value,
    member_json: &serde_json::Value,
    membership_receipt_json: &serde_json::Value,
    frontier_json: &serde_json::Value,
) -> Result<TrialFamilyReadbackV1, TrialFamilyError> {
    let stored_root: StoredTrialFamilyRootV1 = decode_stored(root_json)?;
    let stored_root_receipt: StoredTrialFamilyRootReceiptV1 = decode_stored(root_receipt_json)?;
    let stored_member: StoredTrialFamilyCensusMemberV1 = decode_stored(member_json)?;
    let stored_membership_receipt: StoredTrialFamilyMembershipReceiptV1 =
        decode_stored(membership_receipt_json)?;
    let stored_frontier: StoredTrialFamilyCensusFrontierV1 = decode_stored(frontier_json)?;
    let family = TrialFamilyReadbackV1 {
        root: stored_root.into(),
        root_receipt: stored_root_receipt.into(),
        initial_intent_member: stored_member.into(),
        membership_receipt: stored_membership_receipt.into(),
        census_frontier: stored_frontier.into(),
    };
    verify_family(&family)?;
    Ok(family)
}

pub(crate) fn admit_stored_legacy_family_without_frontier(
    root_json: &serde_json::Value,
    root_receipt_json: &serde_json::Value,
    member_json: &serde_json::Value,
    membership_receipt_json: &serde_json::Value,
) -> Result<TrialFamilyReadbackV1, TrialFamilyError> {
    let stored_root: StoredTrialFamilyRootV1 = decode_stored(root_json)?;
    let stored_root_receipt: StoredTrialFamilyRootReceiptV1 = decode_stored(root_receipt_json)?;
    let stored_member: StoredTrialFamilyCensusMemberV1 = decode_stored(member_json)?;
    let stored_membership_receipt: StoredTrialFamilyMembershipReceiptV1 =
        decode_stored(membership_receipt_json)?;
    let expected = form_initial_family(
        &stored_member.fact_identity,
        &stored_member.fact_digest,
        stored_root.policy.clone(),
        stored_root.created_at_epoch_ms,
    )?;

    if expected.root != stored_root.into()
        || expected.root_receipt != stored_root_receipt.into()
        || expected.initial_intent_member != stored_member.into()
        || expected.membership_receipt != stored_membership_receipt.into()
    {
        return Err(TrialFamilyError::Unavailable(
            "legacy family content digest mismatch".to_string(),
        ));
    }
    Ok(expected)
}

pub(crate) fn admit_stored_census_member_v2(
    member_json: &serde_json::Value,
    membership_receipt_json: &serde_json::Value,
) -> Result<(TrialFamilyCensusMemberV2, TrialFamilyMembershipReceiptV1), TrialFamilyError> {
    let member: TrialFamilyCensusMemberV2 = decode_stored(member_json)?;
    let receipt: StoredTrialFamilyMembershipReceiptV1 = decode_stored(membership_receipt_json)?;
    Ok((member, receipt.into()))
}

pub(crate) fn legacy_initial_member_for_census_v2(
    family: &TrialFamilyReadbackV1,
) -> (TrialFamilyCensusMemberV2, TrialFamilyMembershipReceiptV1) {
    let initial = &family.initial_intent_member;
    (
        TrialFamilyCensusMemberV2 {
            schema_version: 1,
            member_identity: initial.member_identity.clone(),
            trial_family_identity: family.root.trial_family_identity.clone(),
            attempt_ordinal: 0,
            ordinal: 0,
            member_kind: TrialFamilyCensusMemberKindV2::Intent,
            fact_identity: initial.fact_identity.clone(),
            fact_digest: initial.fact_digest.clone(),
            terminal_disposition: None,
            member_digest: initial.member_digest.clone(),
        },
        family.membership_receipt.clone(),
    )
}

pub(crate) fn admit_stored_artifact_binding(
    family: TrialFamilyReadbackV1,
    binding_json: &serde_json::Value,
    binding_receipt_json: &serde_json::Value,
) -> Result<ArtifactTrialFamilyReadbackV1, TrialFamilyError> {
    let stored_binding: StoredArtifactTrialFamilyBindingV1 = decode_stored(binding_json)?;
    let stored_binding_receipt: StoredArtifactTrialFamilyBindingReceiptV1 =
        decode_stored(binding_receipt_json)?;
    let readback = ArtifactTrialFamilyReadbackV1 {
        trial_family: family,
        binding: stored_binding.into(),
        binding_receipt: stored_binding_receipt.into(),
    };
    verify_artifact_binding(&readback)?;
    Ok(readback)
}

pub(crate) fn form_initial_family(
    intent_identity: &str,
    intent_digest: &str,
    policy: TrialFamilyPolicyV1,
    now_epoch_ms: u64,
) -> Result<TrialFamilyReadbackV1, TrialFamilyError> {
    require_identity(intent_identity, "INTENT_IDENTITY_INVALID")?;
    require_sha256(intent_digest, "INTENT_DIGEST_INVALID")?;

    if let Some(binding) = policy.replay_execution_policy_v2.as_ref() {
        let replay_policy = binding
            .verify()
            .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
        if replay_policy.cost.identity.as_str() != policy.cost_model_identity
            || replay_policy.slippage.identity.as_str() != policy.slippage_model_identity
            || replay_policy.capacity.identity.as_str() != policy.capacity_model_identity
        {
            return Err(TrialFamilyError::Unavailable(
                "Replay policy model profile cross-binding mismatch".to_string(),
            ));
        }
    }
    let policy_digest = canonical_digest("rd.trial-family.policy.v1", &policy)?;
    let replay_execution_policy_v2 = policy.replay_execution_policy_v2.clone();
    let family_identity_digest = canonical_digest(
        "rd.trial-family.identity.v1",
        &FamilyIdentityMeaningV1 {
            intent_identity,
            intent_digest,
            policy_digest: &policy_digest,
        },
    )?;
    let trial_family_identity = identity("rd-trial-family-v1", &family_identity_digest);
    let root_meaning = RootMeaningV1 {
        schema_version: 1,
        trial_family_identity: &trial_family_identity,
        policy: &policy,
        policy_digest: &policy_digest,
        created_at_epoch_ms: now_epoch_ms,
    };
    let root_digest = canonical_digest("rd.trial-family.root.v1", &root_meaning)?;
    let root = TrialFamilyRootV1 {
        schema_version: 1,
        trial_family_identity: trial_family_identity.clone(),
        policy,
        policy_digest,
        root_digest: root_digest.clone(),
        created_at_epoch_ms: now_epoch_ms,
    };
    let root_receipt = TrialFamilyRootReceiptV1 {
        schema_version: 1,
        receipt_identity: identity("rd-trial-family-root-receipt-v1", &root_digest),
        trial_family_identity: trial_family_identity.clone(),
        intent_identity: intent_identity.to_string(),
        root_digest: root_digest.clone(),
        replay_execution_policy_v2: replay_execution_policy_v2.clone(),
        committed_at_epoch_ms: now_epoch_ms,
    };
    let member_meaning = MemberMeaningV1 {
        schema_version: 1,
        trial_family_identity: &trial_family_identity,
        member_kind: TrialFamilyCensusMemberKindV1::Intent,
        fact_identity: intent_identity,
        fact_digest: intent_digest,
        ordinal: 0,
    };
    let member_digest = canonical_digest("rd.trial-family.census-member.v1", &member_meaning)?;
    let member = TrialFamilyCensusMemberV1 {
        schema_version: 1,
        member_identity: identity("rd-trial-family-member-v1", &member_digest),
        trial_family_identity: trial_family_identity.clone(),
        member_kind: TrialFamilyCensusMemberKindV1::Intent,
        fact_identity: intent_identity.to_string(),
        fact_digest: intent_digest.to_string(),
        ordinal: 0,
        member_digest: member_digest.clone(),
    };
    let membership_receipt = TrialFamilyMembershipReceiptV1 {
        schema_version: 1,
        receipt_identity: identity("rd-trial-family-membership-receipt-v1", &member_digest),
        trial_family_identity: trial_family_identity.clone(),
        member_identity: member.member_identity.clone(),
        member_digest: member_digest.clone(),
        committed_at_epoch_ms: now_epoch_ms,
    };
    let frontier_meaning = FrontierMeaningV1 {
        schema_version: 1,
        trial_family_identity: &trial_family_identity,
        root_digest: &root_digest,
        member_digests: std::slice::from_ref(&member_digest),
        consumed_trial_budget: 1,
        replay_execution_policy_v2: replay_execution_policy_v2.as_ref(),
    };
    let frontier_digest =
        canonical_digest("rd.trial-family.census-frontier.v1", &frontier_meaning)?;
    let census_frontier = TrialFamilyCensusFrontierV1 {
        schema_version: 1,
        frontier_identity: identity("rd-trial-family-frontier-v1", &frontier_digest),
        trial_family_identity,
        root_digest,
        member_digests: vec![member_digest],
        consumed_trial_budget: 1,
        replay_execution_policy_v2,
        frontier_digest,
    };
    Ok(TrialFamilyReadbackV1 {
        root,
        root_receipt,
        initial_intent_member: member,
        membership_receipt,
        census_frontier,
    })
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )
)]
pub(crate) fn append_attempt_to_census_v2(
    legacy_family: TrialFamilyReadbackV1,
    prior: Option<&TrialFamilyCensusReadbackV2>,
    append: TrialFamilyAttemptAppendV2,
    now_epoch_ms: u64,
) -> Result<TrialFamilyCensusReadbackV2, TrialFamilyError> {
    verify_family(&legacy_family)?;
    let family_identity = legacy_family.root.trial_family_identity.clone();
    let mut members;
    let mut membership_receipts;
    let mut terminal_member_digests;
    let attempt_ordinal;

    if let Some(prior) = prior {
        verify_census_v2(prior)?;
        if prior.legacy_family != legacy_family {
            return Err(TrialFamilyError::Unavailable(
                "census predecessor family mismatch".to_string(),
            ));
        }
        members = prior.members.clone();
        membership_receipts = prior.membership_receipts.clone();
        terminal_member_digests = prior.attempt_frontier.terminal_member_digests.clone();
        attempt_ordinal = u32::try_from(terminal_member_digests.len()).map_err(unavailable)?;
    } else {
        let (initial_member, initial_receipt) = legacy_initial_member_for_census_v2(&legacy_family);
        members = vec![initial_member];
        membership_receipts = vec![initial_receipt];
        terminal_member_digests = Vec::new();
        attempt_ordinal = 0;
    }

    let expected_consumed_budget = attempt_ordinal
        .checked_add(1)
        .ok_or(TrialFamilyError::InvalidPolicy("TRIAL_BUDGET_OVERFLOW"))?;

    if append.consumed_trial_budget != expected_consumed_budget
        || append.consumed_trial_budget > legacy_family.root.policy.trial_budget
    {
        return Err(TrialFamilyError::InvalidPolicy(
            "CONSUMED_TRIAL_BUDGET_INVALID",
        ));
    }

    for (identity, digest) in [
        (&append.intent_identity, &append.intent_digest),
        (&append.request_identity, &append.request_digest),
        (&append.result_identity, &append.result_digest),
    ] {
        require_identity(identity, "CENSUS_FACT_IDENTITY_INVALID")?;
        require_sha256(digest, "CENSUS_FACT_DIGEST_INVALID")?;
    }

    if attempt_ordinal == 0 {
        if append.intent_identity != legacy_family.initial_intent_member.fact_identity
            || append.intent_digest != legacy_family.initial_intent_member.fact_digest
        {
            return Err(TrialFamilyError::Unavailable(
                "initial attempt intent mismatch".to_string(),
            ));
        }
    } else {
        push_census_member_v2(
            &mut members,
            &mut membership_receipts,
            AppendMemberInputV2 {
                trial_family_identity: &family_identity,
                attempt_ordinal,
                member_kind: TrialFamilyCensusMemberKindV2::Intent,
                fact_identity: &append.intent_identity,
                fact_digest: &append.intent_digest,
                terminal_disposition: None,
                now_epoch_ms,
            },
        )?;
    }
    push_census_member_v2(
        &mut members,
        &mut membership_receipts,
        AppendMemberInputV2 {
            trial_family_identity: &family_identity,
            attempt_ordinal,
            member_kind: TrialFamilyCensusMemberKindV2::Request,
            fact_identity: &append.request_identity,
            fact_digest: &append.request_digest,
            terminal_disposition: None,
            now_epoch_ms,
        },
    )?;
    push_census_member_v2(
        &mut members,
        &mut membership_receipts,
        AppendMemberInputV2 {
            trial_family_identity: &family_identity,
            attempt_ordinal,
            member_kind: TrialFamilyCensusMemberKindV2::Result,
            fact_identity: &append.result_identity,
            fact_digest: &append.result_digest,
            terminal_disposition: Some(append.terminal_disposition),
            now_epoch_ms,
        },
    )?;
    terminal_member_digests.push(
        members
            .last()
            .ok_or_else(|| TrialFamilyError::Unavailable("result member missing".to_string()))?
            .member_digest
            .clone(),
    );

    let attempt_meaning = AttemptFrontierMeaningV2 {
        schema_version: 2,
        trial_family_identity: &family_identity,
        terminal_member_digests: &terminal_member_digests,
        consumed_trial_budget: append.consumed_trial_budget,
    };
    let attempt_digest = canonical_digest("rd.trial-family.attempt-frontier.v2", &attempt_meaning)?;
    let attempt_frontier = TrialFamilyAttemptFrontierV2 {
        schema_version: 2,
        frontier_identity: identity("rd-trial-family-attempt-frontier-v2", &attempt_digest),
        trial_family_identity: family_identity.clone(),
        terminal_member_digests,
        consumed_trial_budget: append.consumed_trial_budget,
        frontier_digest: attempt_digest,
    };
    let candidate_set_frontier =
        form_candidate_set_frontier_v2(&family_identity, attempt_ordinal, append.candidate_set)?;
    let member_digests = members
        .iter()
        .map(|member| member.member_digest.clone())
        .collect::<Vec<_>>();
    let census_meaning = CensusFrontierMeaningV2 {
        schema_version: 2,
        trial_family_identity: &family_identity,
        root_digest: &legacy_family.root.root_digest,
        member_digests: &member_digests,
        consumed_trial_budget: append.consumed_trial_budget,
        attempt_frontier_identity: &attempt_frontier.frontier_identity,
        attempt_frontier_digest: &attempt_frontier.frontier_digest,
        candidate_set_frontier_identity: &candidate_set_frontier.frontier_identity,
        candidate_set_frontier_digest: &candidate_set_frontier.frontier_digest,
    };
    let census_digest = canonical_digest("rd.trial-family.census-frontier.v2", &census_meaning)?;
    let census_frontier = TrialFamilyCensusFrontierV2 {
        schema_version: 2,
        frontier_identity: identity("rd-trial-family-frontier-v2", &census_digest),
        trial_family_identity: family_identity,
        root_digest: legacy_family.root.root_digest.clone(),
        member_digests,
        consumed_trial_budget: append.consumed_trial_budget,
        attempt_frontier_identity: attempt_frontier.frontier_identity.clone(),
        attempt_frontier_digest: attempt_frontier.frontier_digest.clone(),
        candidate_set_frontier_identity: candidate_set_frontier.frontier_identity.clone(),
        candidate_set_frontier_digest: candidate_set_frontier.frontier_digest.clone(),
        frontier_digest: census_digest,
    };
    let readback = TrialFamilyCensusReadbackV2 {
        legacy_family,
        members,
        membership_receipts,
        attempt_frontier,
        candidate_set_frontier,
        census_frontier,
    };
    verify_census_v2(&readback)?;
    Ok(readback)
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )
)]
#[derive(Clone, Copy)]
struct AppendMemberInputV2<'a> {
    trial_family_identity: &'a str,
    attempt_ordinal: u32,
    member_kind: TrialFamilyCensusMemberKindV2,
    fact_identity: &'a str,
    fact_digest: &'a str,
    terminal_disposition: Option<TrialFamilyAttemptTerminalDispositionV2>,
    now_epoch_ms: u64,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "TrialFamily Census V2 awaits the admitted R&D Decision composition consumer"
    )
)]
fn push_census_member_v2(
    members: &mut Vec<TrialFamilyCensusMemberV2>,
    receipts: &mut Vec<TrialFamilyMembershipReceiptV1>,
    input: AppendMemberInputV2<'_>,
) -> Result<(), TrialFamilyError> {
    if members.len() >= MAX_FRONTIER_MEMBERS {
        return Err(TrialFamilyError::InvalidPolicy("CENSUS_TOO_LARGE"));
    }
    let ordinal = u32::try_from(members.len()).map_err(unavailable)?;
    let meaning = MemberMeaningV2 {
        schema_version: 2,
        trial_family_identity: input.trial_family_identity,
        attempt_ordinal: input.attempt_ordinal,
        ordinal,
        member_kind: input.member_kind,
        fact_identity: input.fact_identity,
        fact_digest: input.fact_digest,
        terminal_disposition: input.terminal_disposition,
    };
    let member_digest = canonical_digest("rd.trial-family.census-member.v2", &meaning)?;
    let member = TrialFamilyCensusMemberV2 {
        schema_version: 2,
        member_identity: identity("rd-trial-family-member-v2", &member_digest),
        trial_family_identity: input.trial_family_identity.to_string(),
        attempt_ordinal: input.attempt_ordinal,
        ordinal,
        member_kind: input.member_kind,
        fact_identity: input.fact_identity.to_string(),
        fact_digest: input.fact_digest.to_string(),
        terminal_disposition: input.terminal_disposition,
        member_digest: member_digest.clone(),
    };
    let receipt_digest = canonical_digest(
        "rd.trial-family.membership-receipt.v2",
        &MembershipReceiptMeaningV2 {
            schema_version: 2,
            trial_family_identity: input.trial_family_identity,
            member_identity: &member.member_identity,
            member_digest: &member_digest,
            committed_at_epoch_ms: input.now_epoch_ms,
        },
    )?;
    receipts.push(TrialFamilyMembershipReceiptV1 {
        schema_version: 2,
        receipt_identity: identity("rd-trial-family-membership-receipt-v2", &receipt_digest),
        trial_family_identity: input.trial_family_identity.to_string(),
        member_identity: member.member_identity.clone(),
        member_digest,
        committed_at_epoch_ms: input.now_epoch_ms,
    });
    members.push(member);
    Ok(())
}

fn form_candidate_set_frontier_v2(
    trial_family_identity: &str,
    attempt_ordinal: u32,
    proposal: TrialFamilyCandidateSetProposalV2,
) -> Result<TrialFamilyCandidateSetFrontierV2, TrialFamilyError> {
    require_identity(
        &proposal.generation_rule_identity,
        "CANDIDATE_GENERATION_RULE_IDENTITY_INVALID",
    )?;
    require_sha256(
        &proposal.generation_rule_digest,
        "CANDIDATE_GENERATION_RULE_DIGEST_INVALID",
    )?;

    if usize::try_from(proposal.expected_cardinality).map_err(unavailable)?
        != proposal.candidates.len()
        || proposal.candidates.len() > MAX_FRONTIER_MEMBERS
    {
        return Err(TrialFamilyError::InvalidPolicy(
            "CANDIDATE_SET_CARDINALITY_INVALID",
        ));
    }
    let mut identities = std::collections::BTreeSet::new();
    let mut digests = std::collections::BTreeSet::new();

    for candidate in &proposal.candidates {
        require_identity(&candidate.candidate_identity, "CANDIDATE_IDENTITY_INVALID")?;
        require_sha256(&candidate.candidate_digest, "CANDIDATE_DIGEST_INVALID")?;
        if !identities.insert(candidate.candidate_identity.as_str())
            || !digests.insert(candidate.candidate_digest.as_str())
        {
            return Err(TrialFamilyError::InvalidPolicy(
                "CANDIDATE_SET_DUPLICATE_INVALID",
            ));
        }
    }
    let meaning = CandidateSetFrontierMeaningV2 {
        schema_version: 2,
        trial_family_identity,
        attempt_ordinal,
        generation_rule_identity: &proposal.generation_rule_identity,
        generation_rule_digest: &proposal.generation_rule_digest,
        expected_cardinality: proposal.expected_cardinality,
        candidates: &proposal.candidates,
    };
    let frontier_digest = canonical_digest("rd.trial-family.candidate-set-frontier.v2", &meaning)?;
    Ok(TrialFamilyCandidateSetFrontierV2 {
        schema_version: 2,
        frontier_identity: identity(
            "rd-trial-family-candidate-set-frontier-v2",
            &frontier_digest,
        ),
        trial_family_identity: trial_family_identity.to_string(),
        attempt_ordinal,
        generation_rule_identity: proposal.generation_rule_identity,
        generation_rule_digest: proposal.generation_rule_digest,
        expected_cardinality: proposal.expected_cardinality,
        candidates: proposal.candidates,
        frontier_digest,
    })
}

pub(crate) fn form_artifact_binding(
    family: TrialFamilyReadbackV1,
    artifact_identity: &str,
    build_receipt_identity: &str,
    intent_identity: &str,
    now_epoch_ms: u64,
) -> Result<ArtifactTrialFamilyReadbackV1, TrialFamilyError> {
    for value in [artifact_identity, build_receipt_identity, intent_identity] {
        require_identity(value, "ARTIFACT_BINDING_IDENTITY_INVALID")?;
    }

    if family.root_receipt.intent_identity != intent_identity
        || family.initial_intent_member.fact_identity != intent_identity
    {
        return Err(TrialFamilyError::Unavailable(
            "intent-family binding mismatch".to_string(),
        ));
    }
    let meaning = BindingMeaningV1 {
        schema_version: 1,
        artifact_identity,
        build_receipt_identity,
        intent_identity,
        trial_family_identity: &family.root.trial_family_identity,
        census_frontier_identity: &family.census_frontier.frontier_identity,
        census_frontier_digest: &family.census_frontier.frontier_digest,
    };
    let binding_digest = canonical_digest("rd.artifact-trial-family-binding.v1", &meaning)?;
    let binding = ArtifactTrialFamilyBindingV1 {
        schema_version: 1,
        binding_identity: identity("rd-artifact-trial-family-binding-v1", &binding_digest),
        artifact_identity: artifact_identity.to_string(),
        build_receipt_identity: build_receipt_identity.to_string(),
        intent_identity: intent_identity.to_string(),
        trial_family_identity: family.root.trial_family_identity.clone(),
        census_frontier_identity: family.census_frontier.frontier_identity.clone(),
        census_frontier_digest: family.census_frontier.frontier_digest.clone(),
        binding_digest: binding_digest.clone(),
    };
    let receipt_digest = canonical_digest(
        "rd.artifact-trial-family-binding-receipt.v1",
        &BindingReceiptMeaningV1 {
            schema_version: 1,
            binding_identity: &binding.binding_identity,
            binding_digest: &binding.binding_digest,
            committed_at_epoch_ms: now_epoch_ms,
        },
    )?;
    let binding_receipt = ArtifactTrialFamilyBindingReceiptV1 {
        schema_version: 1,
        receipt_identity: identity("rd-artifact-family-binding-receipt-v1", &receipt_digest),
        binding_identity: binding.binding_identity.clone(),
        binding_digest,
        committed_at_epoch_ms: now_epoch_ms,
    };
    Ok(ArtifactTrialFamilyReadbackV1 {
        trial_family: family,
        binding,
        binding_receipt,
    })
}

pub(crate) fn verify_family(readback: &TrialFamilyReadbackV1) -> Result<(), TrialFamilyError> {
    if readback.root.schema_version != 1
        || readback.root_receipt.schema_version != 1
        || readback.initial_intent_member.schema_version != 1
        || readback.membership_receipt.schema_version != 1
        || readback.census_frontier.schema_version != 1
        || readback.root.trial_family_identity != readback.root_receipt.trial_family_identity
        || readback.root.trial_family_identity
            != readback.initial_intent_member.trial_family_identity
        || readback.root.trial_family_identity != readback.membership_receipt.trial_family_identity
        || readback.root.trial_family_identity != readback.census_frontier.trial_family_identity
        || readback.root.root_digest != readback.root_receipt.root_digest
        || readback.root.policy.replay_execution_policy_v2
            != readback.root_receipt.replay_execution_policy_v2
        || readback.root.policy.replay_execution_policy_v2
            != readback.census_frontier.replay_execution_policy_v2
        || readback.initial_intent_member.member_identity
            != readback.membership_receipt.member_identity
        || readback.initial_intent_member.member_digest != readback.membership_receipt.member_digest
        || readback.root_receipt.intent_identity != readback.initial_intent_member.fact_identity
        || readback.census_frontier.member_digests
            != [readback.initial_intent_member.member_digest.clone()]
        || readback.census_frontier.member_digests.len() > MAX_FRONTIER_MEMBERS
    {
        return Err(TrialFamilyError::Unavailable(
            "family receipt/frontier mismatch".to_string(),
        ));
    }
    let expected = form_initial_family(
        &readback.initial_intent_member.fact_identity,
        &readback.initial_intent_member.fact_digest,
        readback.root.policy.clone(),
        readback.root.created_at_epoch_ms,
    )?;

    if &expected != readback {
        return Err(TrialFamilyError::Unavailable(
            "family content digest mismatch".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn verify_census_v2(
    readback: &TrialFamilyCensusReadbackV2,
) -> Result<(), TrialFamilyError> {
    verify_family(&readback.legacy_family)?;
    let family_identity = readback.legacy_family.root.trial_family_identity();
    if readback.members.is_empty()
        || readback.members.len() != readback.membership_receipts.len()
        || readback.members.len() > MAX_FRONTIER_MEMBERS
        || readback.attempt_frontier.schema_version != 2
        || readback.candidate_set_frontier.schema_version != 2
        || readback.census_frontier.schema_version != 2
        || readback.attempt_frontier.trial_family_identity != family_identity
        || readback.candidate_set_frontier.trial_family_identity != family_identity
        || readback.census_frontier.trial_family_identity != family_identity
        || readback.census_frontier.root_digest != readback.legacy_family.root.root_digest
        || readback.census_frontier.consumed_trial_budget
            != readback.attempt_frontier.consumed_trial_budget
        || readback.census_frontier.attempt_frontier_identity
            != readback.attempt_frontier.frontier_identity
        || readback.census_frontier.attempt_frontier_digest
            != readback.attempt_frontier.frontier_digest
        || readback.census_frontier.candidate_set_frontier_identity
            != readback.candidate_set_frontier.frontier_identity
        || readback.census_frontier.candidate_set_frontier_digest
            != readback.candidate_set_frontier.frontier_digest
    {
        return Err(TrialFamilyError::Unavailable(
            "V2 census frontier cross-binding mismatch".to_string(),
        ));
    }

    let initial = &readback.legacy_family.initial_intent_member;
    let first = &readback.members[0];
    if first.schema_version != 1
        || first.ordinal != 0
        || first.attempt_ordinal != 0
        || first.member_kind != TrialFamilyCensusMemberKindV2::Intent
        || first.terminal_disposition.is_some()
        || first.member_identity != initial.member_identity
        || first.fact_identity != initial.fact_identity
        || first.fact_digest != initial.fact_digest
        || first.member_digest != initial.member_digest
        || readback.membership_receipts[0] != readback.legacy_family.membership_receipt
    {
        return Err(TrialFamilyError::Unavailable(
            "legacy initial Intent mismatch".to_string(),
        ));
    }

    let mut terminal_member_digests = Vec::new();

    for (index, (member, receipt)) in readback
        .members
        .iter()
        .zip(&readback.membership_receipts)
        .enumerate()
        .skip(1)
    {
        let ordinal = u32::try_from(index).map_err(unavailable)?;
        require_identity(&member.fact_identity, "CENSUS_FACT_IDENTITY_INVALID")?;
        require_sha256(&member.fact_digest, "CENSUS_FACT_DIGEST_INVALID")?;
        let attempt_ordinal = if ordinal <= 2 {
            0
        } else {
            (ordinal - 3) / 3 + 1
        };
        let expected_kind = match ordinal {
            1 | 2 => {
                if ordinal == 1 {
                    TrialFamilyCensusMemberKindV2::Request
                } else {
                    TrialFamilyCensusMemberKindV2::Result
                }
            }
            _ => match (ordinal - 3) % 3 {
                0 => TrialFamilyCensusMemberKindV2::Intent,
                1 => TrialFamilyCensusMemberKindV2::Request,
                _ => TrialFamilyCensusMemberKindV2::Result,
            },
        };
        let expected_terminal = expected_kind == TrialFamilyCensusMemberKindV2::Result;

        if member.schema_version != 2
            || member.trial_family_identity != family_identity
            || member.ordinal != ordinal
            || member.attempt_ordinal != attempt_ordinal
            || member.member_kind != expected_kind
            || member.terminal_disposition.is_some() != expected_terminal
            || receipt.schema_version != 2
            || receipt.trial_family_identity != family_identity
            || receipt.member_identity != member.member_identity
            || receipt.member_digest != member.member_digest
        {
            return Err(TrialFamilyError::Unavailable(
                "ordered V2 attempt history mismatch".to_string(),
            ));
        }
        let expected_member_digest = canonical_digest(
            "rd.trial-family.census-member.v2",
            &MemberMeaningV2 {
                schema_version: 2,
                trial_family_identity: family_identity,
                attempt_ordinal,
                ordinal,
                member_kind: member.member_kind,
                fact_identity: &member.fact_identity,
                fact_digest: &member.fact_digest,
                terminal_disposition: member.terminal_disposition,
            },
        )?;

        if member.member_digest != expected_member_digest
            || member.member_identity
                != identity("rd-trial-family-member-v2", &expected_member_digest)
        {
            return Err(TrialFamilyError::Unavailable(
                "V2 census member digest mismatch".to_string(),
            ));
        }
        let expected_receipt_digest = canonical_digest(
            "rd.trial-family.membership-receipt.v2",
            &MembershipReceiptMeaningV2 {
                schema_version: 2,
                trial_family_identity: family_identity,
                member_identity: &member.member_identity,
                member_digest: &member.member_digest,
                committed_at_epoch_ms: receipt.committed_at_epoch_ms,
            },
        )?;

        if receipt.receipt_identity
            != identity(
                "rd-trial-family-membership-receipt-v2",
                &expected_receipt_digest,
            )
        {
            return Err(TrialFamilyError::Unavailable(
                "V2 membership receipt digest mismatch".to_string(),
            ));
        }

        if expected_terminal {
            terminal_member_digests.push(member.member_digest.clone());
        }
    }

    if terminal_member_digests.is_empty()
        || readback.members.len() != terminal_member_digests.len() * 3
        || terminal_member_digests != readback.attempt_frontier.terminal_member_digests
        || usize::try_from(readback.attempt_frontier.consumed_trial_budget).map_err(unavailable)?
            != terminal_member_digests.len()
        || readback.attempt_frontier.consumed_trial_budget
            > readback.legacy_family.root.policy.trial_budget
    {
        return Err(TrialFamilyError::Unavailable(
            "attempt frontier is incomplete".to_string(),
        ));
    }
    let attempt_digest = canonical_digest(
        "rd.trial-family.attempt-frontier.v2",
        &AttemptFrontierMeaningV2 {
            schema_version: 2,
            trial_family_identity: family_identity,
            terminal_member_digests: &terminal_member_digests,
            consumed_trial_budget: readback.attempt_frontier.consumed_trial_budget,
        },
    )?;

    if readback.attempt_frontier.frontier_digest != attempt_digest
        || readback.attempt_frontier.frontier_identity
            != identity("rd-trial-family-attempt-frontier-v2", &attempt_digest)
    {
        return Err(TrialFamilyError::Unavailable(
            "attempt frontier digest mismatch".to_string(),
        ));
    }
    let candidate = &readback.candidate_set_frontier;
    if candidate.attempt_ordinal + 1 != readback.attempt_frontier.consumed_trial_budget
        || usize::try_from(candidate.expected_cardinality).map_err(unavailable)?
            != candidate.candidates.len()
    {
        return Err(TrialFamilyError::Unavailable(
            "candidate-set frontier cardinality mismatch".to_string(),
        ));
    }
    let expected_candidate = form_candidate_set_frontier_v2(
        family_identity,
        candidate.attempt_ordinal,
        TrialFamilyCandidateSetProposalV2 {
            generation_rule_identity: candidate.generation_rule_identity.clone(),
            generation_rule_digest: candidate.generation_rule_digest.clone(),
            expected_cardinality: candidate.expected_cardinality,
            candidates: candidate.candidates.clone(),
        },
    )?;

    if &expected_candidate != candidate {
        return Err(TrialFamilyError::Unavailable(
            "candidate-set frontier digest mismatch".to_string(),
        ));
    }
    let member_digests = readback
        .members
        .iter()
        .map(|member| member.member_digest.clone())
        .collect::<Vec<_>>();
    let census_digest = canonical_digest(
        "rd.trial-family.census-frontier.v2",
        &CensusFrontierMeaningV2 {
            schema_version: 2,
            trial_family_identity: family_identity,
            root_digest: &readback.legacy_family.root.root_digest,
            member_digests: &member_digests,
            consumed_trial_budget: readback.census_frontier.consumed_trial_budget,
            attempt_frontier_identity: &readback.attempt_frontier.frontier_identity,
            attempt_frontier_digest: &readback.attempt_frontier.frontier_digest,
            candidate_set_frontier_identity: &candidate.frontier_identity,
            candidate_set_frontier_digest: &candidate.frontier_digest,
        },
    )?;

    if readback.census_frontier.member_digests != member_digests
        || readback.census_frontier.frontier_digest != census_digest
        || readback.census_frontier.frontier_identity
            != identity("rd-trial-family-frontier-v2", &census_digest)
    {
        return Err(TrialFamilyError::Unavailable(
            "V2 census frontier digest mismatch".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn verify_artifact_binding(
    readback: &ArtifactTrialFamilyReadbackV1,
) -> Result<(), TrialFamilyError> {
    verify_family(&readback.trial_family)?;
    if readback.binding.schema_version != 1
        || readback.binding_receipt.schema_version != 1
        || readback.binding.binding_identity != readback.binding_receipt.binding_identity
        || readback.binding.binding_digest != readback.binding_receipt.binding_digest
    {
        return Err(TrialFamilyError::Unavailable(
            "artifact binding receipt mismatch".to_string(),
        ));
    }
    let expected = form_artifact_binding(
        readback.trial_family.clone(),
        &readback.binding.artifact_identity,
        &readback.binding.build_receipt_identity,
        &readback.binding.intent_identity,
        readback.binding_receipt.committed_at_epoch_ms,
    )?;

    if &expected != readback {
        return Err(TrialFamilyError::Unavailable(
            "artifact binding content digest mismatch".to_string(),
        ));
    }
    Ok(())
}

#[derive(Serialize)]
struct RootMeaningV1<'a> {
    schema_version: u32,
    trial_family_identity: &'a str,
    policy: &'a TrialFamilyPolicyV1,
    policy_digest: &'a str,
    created_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct FamilyIdentityMeaningV1<'a> {
    intent_identity: &'a str,
    intent_digest: &'a str,
    policy_digest: &'a str,
}

#[derive(Serialize)]
struct MemberMeaningV1<'a> {
    schema_version: u32,
    trial_family_identity: &'a str,
    member_kind: TrialFamilyCensusMemberKindV1,
    fact_identity: &'a str,
    fact_digest: &'a str,
    ordinal: u32,
}

#[derive(Serialize)]
struct MemberMeaningV2<'a> {
    schema_version: u32,
    trial_family_identity: &'a str,
    attempt_ordinal: u32,
    ordinal: u32,
    member_kind: TrialFamilyCensusMemberKindV2,
    fact_identity: &'a str,
    fact_digest: &'a str,
    terminal_disposition: Option<TrialFamilyAttemptTerminalDispositionV2>,
}

#[derive(Serialize)]
struct MembershipReceiptMeaningV2<'a> {
    schema_version: u32,
    trial_family_identity: &'a str,
    member_identity: &'a str,
    member_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct AttemptFrontierMeaningV2<'a> {
    schema_version: u32,
    trial_family_identity: &'a str,
    terminal_member_digests: &'a [String],
    consumed_trial_budget: u32,
}

#[derive(Serialize)]
struct CandidateSetFrontierMeaningV2<'a> {
    schema_version: u32,
    trial_family_identity: &'a str,
    attempt_ordinal: u32,
    generation_rule_identity: &'a str,
    generation_rule_digest: &'a str,
    expected_cardinality: u32,
    candidates: &'a [TrialFamilyCandidateFactV2],
}

#[derive(Serialize)]
struct CensusFrontierMeaningV2<'a> {
    schema_version: u32,
    trial_family_identity: &'a str,
    root_digest: &'a str,
    member_digests: &'a [String],
    consumed_trial_budget: u32,
    attempt_frontier_identity: &'a str,
    attempt_frontier_digest: &'a str,
    candidate_set_frontier_identity: &'a str,
    candidate_set_frontier_digest: &'a str,
}

#[derive(Serialize)]
struct FrontierMeaningV1<'a> {
    schema_version: u32,
    trial_family_identity: &'a str,
    root_digest: &'a str,
    member_digests: &'a [String],
    consumed_trial_budget: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    replay_execution_policy_v2: Option<&'a crate::ReplayPolicyCatalogBindingV2>,
}

#[derive(Serialize)]
struct BindingMeaningV1<'a> {
    schema_version: u32,
    artifact_identity: &'a str,
    build_receipt_identity: &'a str,
    intent_identity: &'a str,
    trial_family_identity: &'a str,
    census_frontier_identity: &'a str,
    census_frontier_digest: &'a str,
}

#[derive(Serialize)]
struct BindingReceiptMeaningV1<'a> {
    schema_version: u32,
    binding_identity: &'a str,
    binding_digest: &'a str,
    committed_at_epoch_ms: u64,
}

impl From<StoredTrialFamilyRootV1> for TrialFamilyRootV1 {
    fn from(value: StoredTrialFamilyRootV1) -> Self {
        Self {
            schema_version: value.schema_version,
            trial_family_identity: value.trial_family_identity,
            policy: value.policy,
            policy_digest: value.policy_digest,
            root_digest: value.root_digest,
            created_at_epoch_ms: value.created_at_epoch_ms,
        }
    }
}

impl From<StoredTrialFamilyRootReceiptV1> for TrialFamilyRootReceiptV1 {
    fn from(value: StoredTrialFamilyRootReceiptV1) -> Self {
        Self {
            schema_version: value.schema_version,
            receipt_identity: value.receipt_identity,
            trial_family_identity: value.trial_family_identity,
            intent_identity: value.intent_identity,
            root_digest: value.root_digest,
            replay_execution_policy_v2: value.replay_execution_policy_v2,
            committed_at_epoch_ms: value.committed_at_epoch_ms,
        }
    }
}

impl From<StoredTrialFamilyCensusMemberKindV1> for TrialFamilyCensusMemberKindV1 {
    fn from(value: StoredTrialFamilyCensusMemberKindV1) -> Self {
        match value {
            StoredTrialFamilyCensusMemberKindV1::Intent => Self::Intent,
        }
    }
}

impl From<StoredTrialFamilyCensusMemberV1> for TrialFamilyCensusMemberV1 {
    fn from(value: StoredTrialFamilyCensusMemberV1) -> Self {
        Self {
            schema_version: value.schema_version,
            member_identity: value.member_identity,
            trial_family_identity: value.trial_family_identity,
            member_kind: value.member_kind.into(),
            fact_identity: value.fact_identity,
            fact_digest: value.fact_digest,
            ordinal: value.ordinal,
            member_digest: value.member_digest,
        }
    }
}

impl From<StoredTrialFamilyMembershipReceiptV1> for TrialFamilyMembershipReceiptV1 {
    fn from(value: StoredTrialFamilyMembershipReceiptV1) -> Self {
        Self {
            schema_version: value.schema_version,
            receipt_identity: value.receipt_identity,
            trial_family_identity: value.trial_family_identity,
            member_identity: value.member_identity,
            member_digest: value.member_digest,
            committed_at_epoch_ms: value.committed_at_epoch_ms,
        }
    }
}

impl From<StoredTrialFamilyCensusFrontierV1> for TrialFamilyCensusFrontierV1 {
    fn from(value: StoredTrialFamilyCensusFrontierV1) -> Self {
        Self {
            schema_version: value.schema_version,
            frontier_identity: value.frontier_identity,
            trial_family_identity: value.trial_family_identity,
            root_digest: value.root_digest,
            member_digests: value.member_digests,
            consumed_trial_budget: value.consumed_trial_budget,
            replay_execution_policy_v2: value.replay_execution_policy_v2,
            frontier_digest: value.frontier_digest,
        }
    }
}

impl From<StoredArtifactTrialFamilyBindingV1> for ArtifactTrialFamilyBindingV1 {
    fn from(value: StoredArtifactTrialFamilyBindingV1) -> Self {
        Self {
            schema_version: value.schema_version,
            binding_identity: value.binding_identity,
            artifact_identity: value.artifact_identity,
            build_receipt_identity: value.build_receipt_identity,
            intent_identity: value.intent_identity,
            trial_family_identity: value.trial_family_identity,
            census_frontier_identity: value.census_frontier_identity,
            census_frontier_digest: value.census_frontier_digest,
            binding_digest: value.binding_digest,
        }
    }
}

impl From<StoredArtifactTrialFamilyBindingReceiptV1> for ArtifactTrialFamilyBindingReceiptV1 {
    fn from(value: StoredArtifactTrialFamilyBindingReceiptV1) -> Self {
        Self {
            schema_version: value.schema_version,
            receipt_identity: value.receipt_identity,
            binding_identity: value.binding_identity,
            binding_digest: value.binding_digest,
            committed_at_epoch_ms: value.committed_at_epoch_ms,
        }
    }
}

fn decode_stored<T: for<'de> Deserialize<'de>>(
    value: &serde_json::Value,
) -> Result<T, TrialFamilyError> {
    serde_json::from_value(value.clone()).map_err(|e| TrialFamilyError::Unavailable(e.to_string()))
}

fn canonical_digest(domain: &str, value: &impl Serialize) -> Result<String, TrialFamilyError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value })
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn unavailable(error: impl Display) -> TrialFamilyError {
    TrialFamilyError::Unavailable(error.to_string())
}

fn falsifier_binding(falsification_question: &str) -> Result<String, TrialFamilyError> {
    require_text(
        falsification_question,
        16,
        2_000,
        "FALSIFICATION_QUESTION_INVALID",
    )?;
    canonical_digest("rd.trial-family.falsifier.v1", &falsification_question)
}

fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

fn require_identity(value: &str, code: &'static str) -> Result<(), TrialFamilyError> {
    if (4..=MAX_IDENTITY_BYTES).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        Ok(())
    } else {
        Err(TrialFamilyError::InvalidPolicy(code))
    }
}

fn require_sha256(value: &str, code: &'static str) -> Result<(), TrialFamilyError> {
    let digest = value.strip_prefix("sha256:");
    if digest.is_some_and(|digest| {
        digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        Ok(())
    } else {
        Err(TrialFamilyError::InvalidPolicy(code))
    }
}

fn require_text(
    value: &str,
    minimum: usize,
    maximum: usize,
    code: &'static str,
) -> Result<(), TrialFamilyError> {
    let trimmed = value.trim();
    if (minimum..=maximum).contains(&trimmed.len()) {
        Ok(())
    } else {
        Err(TrialFamilyError::InvalidPolicy(code))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn policy() -> TrialFamilyPolicyV1 {
        TrialFamilyPolicyV1 {
            trial_budget: 2,
            stop_rule: "stop after the bounded falsifier".to_string(),
            pit_rule_identity: "pit-rule-v1".to_string(),
            cost_model_identity: "cost-model-v1".to_string(),
            slippage_model_identity: "slippage-model-v1".to_string(),
            capacity_model_identity: "capacity-model-v1".to_string(),
            semantic_predecessor_frontier: vec![],
            protected_feedback_frontier: "qualification-frontier-v1".to_string(),
            independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
            independence_basis_identity: "independence-basis-v1".to_string(),
            frozen_falsifier_binding: TrialFamilyPolicyV1::expected_falsifier_binding(
                "Does the bounded signal survive exact costs?",
            )
            .unwrap(),
            replay_execution_policy_v2: None,
        }
    }

    fn append(
        family: &TrialFamilyReadbackV1,
        ordinal: u32,
        disposition: TrialFamilyAttemptTerminalDispositionV2,
        candidates: Vec<TrialFamilyCandidateFactV2>,
    ) -> TrialFamilyAttemptAppendV2 {
        TrialFamilyAttemptAppendV2 {
            intent_identity: if ordinal == 0 {
                family.initial_intent_member.fact_identity.clone()
            } else {
                format!("rd-research-intent-v2-{ordinal}")
            },
            intent_digest: if ordinal == 0 {
                family.initial_intent_member.fact_digest.clone()
            } else {
                format!("sha256:{:064x}", ordinal + 10)
            },
            request_identity: format!("rd-replay-request-v2-{ordinal}"),
            request_digest: format!("sha256:{:064x}", ordinal + 20),
            result_identity: format!("backtest-result-v2-{ordinal}"),
            result_digest: format!("sha256:{:064x}", ordinal + 30),
            terminal_disposition: disposition,
            consumed_trial_budget: ordinal + 1,
            candidate_set: TrialFamilyCandidateSetProposalV2 {
                generation_rule_identity: format!("rd-candidate-generation-rule-v2-{ordinal}"),
                generation_rule_digest: format!("sha256:{:064x}", ordinal + 40),
                expected_cardinality: u32::try_from(candidates.len()).unwrap(),
                candidates,
            },
        }
    }

    #[rstest]
    fn v2_census_orders_complete_attempts_and_preserves_every_terminal_fact() {
        let mut expanded_policy = policy();
        expanded_policy.trial_budget = 4;
        let family = form_initial_family(
            "rd-research-intent-v2-test",
            &format!("sha256:{}", "1".repeat(64)),
            expanded_policy,
            42,
        )
        .unwrap();
        let dispositions = [
            TrialFamilyAttemptTerminalDispositionV2::TerminalResult,
            TrialFamilyAttemptTerminalDispositionV2::Rejected,
            TrialFamilyAttemptTerminalDispositionV2::Invalid,
            TrialFamilyAttemptTerminalDispositionV2::Unknown,
        ];
        let mut census = None;

        for (ordinal, disposition) in dispositions.iter().copied().enumerate() {
            let ordinal = u32::try_from(ordinal).unwrap();
            census = Some(
                append_attempt_to_census_v2(
                    family.clone(),
                    census.as_ref(),
                    append(&family, ordinal, disposition, Vec::new()),
                    100 + u64::from(ordinal),
                )
                .unwrap(),
            );
        }
        let census = census.unwrap();
        assert_eq!(census.members.len(), 12);
        assert_eq!(
            census.members[0].member_kind,
            TrialFamilyCensusMemberKindV2::Intent
        );

        for (ordinal, disposition) in dispositions.iter().copied().enumerate() {
            let base = ordinal * 3;
            assert_eq!(
                census.members[base].member_kind,
                TrialFamilyCensusMemberKindV2::Intent
            );
            assert_eq!(
                census.members[base + 1].member_kind,
                TrialFamilyCensusMemberKindV2::Request
            );
            assert_eq!(
                census.members[base + 2].member_kind,
                TrialFamilyCensusMemberKindV2::Result
            );
            assert_eq!(
                census.members[base + 2].terminal_disposition,
                Some(disposition)
            );
        }
        assert_eq!(census.consumed_trial_budget(), 4);
        verify_census_v2(&census).unwrap();
    }

    #[rstest]
    fn v2_census_fails_closed_on_budget_cardinality_duplicates_and_tamper() {
        let family = form_initial_family(
            "rd-research-intent-v2-test",
            &format!("sha256:{}", "1".repeat(64)),
            policy(),
            42,
        )
        .unwrap();
        let candidate = TrialFamilyCandidateFactV2 {
            candidate_identity: "rd-candidate-v2-a".to_string(),
            candidate_digest: format!("sha256:{}", "a".repeat(64)),
        };
        let mut wrong_cardinality = append(
            &family,
            0,
            TrialFamilyAttemptTerminalDispositionV2::Rejected,
            vec![candidate.clone()],
        );
        wrong_cardinality.candidate_set.expected_cardinality = 2;
        assert!(append_attempt_to_census_v2(family.clone(), None, wrong_cardinality, 100).is_err());
        let duplicate = append(
            &family,
            0,
            TrialFamilyAttemptTerminalDispositionV2::Invalid,
            vec![candidate.clone(), candidate],
        );
        assert!(append_attempt_to_census_v2(family.clone(), None, duplicate, 100).is_err());
        let mut census = append_attempt_to_census_v2(
            family.clone(),
            None,
            append(
                &family,
                0,
                TrialFamilyAttemptTerminalDispositionV2::Unknown,
                Vec::new(),
            ),
            100,
        )
        .unwrap();
        census.members[2].fact_digest = format!("sha256:{}", "f".repeat(64));
        assert!(verify_census_v2(&census).is_err());

        let mut malformed_member = append_attempt_to_census_v2(
            family.clone(),
            None,
            append(
                &family,
                0,
                TrialFamilyAttemptTerminalDispositionV2::TerminalResult,
                Vec::new(),
            ),
            100,
        )
        .unwrap();

        // mutate a non-initial request fact locator and digest, then recompute dependent
        // member identity/receipt fields to keep all other digests aligned.
        let malformed_index = 1;
        let malformed_epoch_ms =
            malformed_member.membership_receipts[malformed_index].committed_at_epoch_ms;
        malformed_member.members[malformed_index].fact_identity = "bad locator!!!".to_string();
        malformed_member.members[malformed_index].fact_digest =
            format!("sha256:{}", "f".repeat(63));
        let rebuilt_member_digest = canonical_digest(
            "rd.trial-family.census-member.v2",
            &MemberMeaningV2 {
                schema_version: 2,
                trial_family_identity: malformed_member.legacy_family.root.trial_family_identity(),
                attempt_ordinal: malformed_member.members[malformed_index].attempt_ordinal,
                ordinal: malformed_member.members[malformed_index].ordinal,
                member_kind: malformed_member.members[malformed_index].member_kind,
                fact_identity: &malformed_member.members[malformed_index].fact_identity,
                fact_digest: &malformed_member.members[malformed_index].fact_digest,
                terminal_disposition: malformed_member.members[malformed_index]
                    .terminal_disposition,
            },
        )
        .unwrap();
        malformed_member.members[malformed_index].member_digest = rebuilt_member_digest.clone();
        malformed_member.members[malformed_index].member_identity =
            identity("rd-trial-family-member-v2", &rebuilt_member_digest);
        let rebuilt_receipt_digest = canonical_digest(
            "rd.trial-family.membership-receipt.v2",
            &MembershipReceiptMeaningV2 {
                schema_version: 2,
                trial_family_identity: malformed_member.legacy_family.root.trial_family_identity(),
                member_identity: &malformed_member.members[malformed_index].member_identity,
                member_digest: &malformed_member.members[malformed_index].member_digest,
                committed_at_epoch_ms: malformed_epoch_ms,
            },
        )
        .unwrap();
        malformed_member.membership_receipts[malformed_index].receipt_identity = identity(
            "rd-trial-family-membership-receipt-v2",
            &rebuilt_receipt_digest,
        );
        malformed_member.membership_receipts[malformed_index].member_identity = malformed_member
            .members[malformed_index]
            .member_identity
            .clone();
        malformed_member.membership_receipts[malformed_index].member_digest = malformed_member
            .members[malformed_index]
            .member_digest
            .clone();
        let rebuilt_member_digests = malformed_member
            .members
            .iter()
            .map(|member| member.member_digest.clone())
            .collect::<Vec<_>>();
        let rebuilt_census_digest = canonical_digest(
            "rd.trial-family.census-frontier.v2",
            &CensusFrontierMeaningV2 {
                schema_version: 2,
                trial_family_identity: malformed_member.legacy_family.root.trial_family_identity(),
                root_digest: &malformed_member.legacy_family.root.root_digest,
                member_digests: &rebuilt_member_digests,
                consumed_trial_budget: malformed_member.census_frontier.consumed_trial_budget,
                attempt_frontier_identity: &malformed_member.attempt_frontier.frontier_identity,
                attempt_frontier_digest: &malformed_member.attempt_frontier.frontier_digest,
                candidate_set_frontier_identity: &malformed_member
                    .candidate_set_frontier
                    .frontier_identity,
                candidate_set_frontier_digest: &malformed_member
                    .candidate_set_frontier
                    .frontier_digest,
            },
        )
        .unwrap();
        malformed_member.census_frontier.member_digests = rebuilt_member_digests;
        malformed_member.census_frontier.frontier_identity =
            identity("rd-trial-family-frontier-v2", &rebuilt_census_digest);
        malformed_member.census_frontier.frontier_digest = rebuilt_census_digest;
        assert_eq!(
            verify_census_v2(&malformed_member),
            Err(TrialFamilyError::InvalidPolicy(
                "CENSUS_FACT_IDENTITY_INVALID"
            ))
        );
    }

    #[rstest]
    fn private_stored_schema_roundtrips_and_rejects_unknown_fields() {
        let intent_identity = "rd-research-intent-v2-test";
        let intent_digest = format!("sha256:{}", "1".repeat(64));
        let family = form_initial_family(intent_identity, &intent_digest, policy(), 42).unwrap();
        let values = [
            serde_json::to_value(&family.root).unwrap(),
            serde_json::to_value(&family.root_receipt).unwrap(),
            serde_json::to_value(&family.initial_intent_member).unwrap(),
            serde_json::to_value(&family.membership_receipt).unwrap(),
            serde_json::to_value(&family.census_frontier).unwrap(),
        ];
        let admitted =
            admit_stored_family(&values[0], &values[1], &values[2], &values[3], &values[4])
                .unwrap();
        assert_eq!(
            serde_json::to_value(&admitted).unwrap(),
            serde_json::to_value(&family).unwrap()
        );

        for index in 0..values.len() {
            let mut mutated = values.clone();
            mutated[index]
                .as_object_mut()
                .unwrap()
                .insert("unknown_authority".to_string(), serde_json::json!(true));
            assert!(
                admit_stored_family(
                    &mutated[0],
                    &mutated[1],
                    &mutated[2],
                    &mutated[3],
                    &mutated[4],
                )
                .is_err()
            );
        }

        let bound = form_artifact_binding(
            family.clone(),
            "blake3:artifact-test",
            "rd-build-receipt-v1-test",
            intent_identity,
            43,
        )
        .unwrap();
        let binding_json = serde_json::to_value(&bound.binding).unwrap();
        let receipt_json = serde_json::to_value(&bound.binding_receipt).unwrap();
        assert_eq!(
            admit_stored_artifact_binding(family.clone(), &binding_json, &receipt_json).unwrap(),
            bound
        );
        let mut mutated_binding = binding_json;
        mutated_binding
            .as_object_mut()
            .unwrap()
            .insert("unknown_authority".to_string(), serde_json::json!(true));
        assert!(admit_stored_artifact_binding(family, &mutated_binding, &receipt_json).is_err());
    }

    #[rstest]
    fn immutable_origin_family_without_replay_policy_preserves_exact_identity_and_digests() {
        const ROOT: &str = r#"{"schema_version":1,"trial_family_identity":"rd-trial-family-v1-151e77bcc8bf5146c9f5a6d061847ae05bce328f39d86707e7cde1f2fe6239c6","policy":{"trial_budget":2,"stop_rule":"stop after the bounded falsifier","pit_rule_identity":"pit-rule-v1","cost_model_identity":"cost-model-v1","slippage_model_identity":"slippage-model-v1","capacity_model_identity":"capacity-model-v1","semantic_predecessor_frontier":[],"protected_feedback_frontier":"qualification-frontier-v1","independence_disposition":"INDEPENDENT","independence_basis_identity":"independence-basis-v1","frozen_falsifier_binding":"sha256:23f583c91a02854638dc3756401c935385cb9faf59dbcf4906a624439f4b9639"},"policy_digest":"sha256:a246d8c988c5f1bea8c3b062397fec82380a46fadd865debfc3d9bd1618f1a84","created_at_epoch_ms":42,"root_digest":"sha256:22217e853f2cf610380a08a3f752472178475575cf917ad286f1e0f07090dc4c"}"#;
        const ROOT_RECEIPT: &str = r#"{"schema_version":1,"receipt_identity":"rd-trial-family-root-receipt-v1-22217e853f2cf610380a08a3f752472178475575cf917ad286f1e0f07090dc4c","trial_family_identity":"rd-trial-family-v1-151e77bcc8bf5146c9f5a6d061847ae05bce328f39d86707e7cde1f2fe6239c6","intent_identity":"rd-research-intent-v2-origin-fixture","root_digest":"sha256:22217e853f2cf610380a08a3f752472178475575cf917ad286f1e0f07090dc4c","committed_at_epoch_ms":42}"#;
        const MEMBER: &str = r#"{"schema_version":1,"member_identity":"rd-trial-family-member-v1-06938f2d3d8255a79fc911eb2eb636f8072037d3ffbabc063008319773d84358","trial_family_identity":"rd-trial-family-v1-151e77bcc8bf5146c9f5a6d061847ae05bce328f39d86707e7cde1f2fe6239c6","member_kind":"INTENT","fact_identity":"rd-research-intent-v2-origin-fixture","fact_digest":"sha256:1111111111111111111111111111111111111111111111111111111111111111","ordinal":0,"member_digest":"sha256:06938f2d3d8255a79fc911eb2eb636f8072037d3ffbabc063008319773d84358"}"#;
        const MEMBERSHIP_RECEIPT: &str = r#"{"schema_version":1,"receipt_identity":"rd-trial-family-membership-receipt-v1-06938f2d3d8255a79fc911eb2eb636f8072037d3ffbabc063008319773d84358","trial_family_identity":"rd-trial-family-v1-151e77bcc8bf5146c9f5a6d061847ae05bce328f39d86707e7cde1f2fe6239c6","member_identity":"rd-trial-family-member-v1-06938f2d3d8255a79fc911eb2eb636f8072037d3ffbabc063008319773d84358","member_digest":"sha256:06938f2d3d8255a79fc911eb2eb636f8072037d3ffbabc063008319773d84358","committed_at_epoch_ms":42}"#;
        const FRONTIER: &str = r#"{"schema_version":1,"frontier_identity":"rd-trial-family-frontier-v1-b4f124b56c2deab11b786c6c3bdecf32cba42d3ef7426e07fa0a6d290967125f","trial_family_identity":"rd-trial-family-v1-151e77bcc8bf5146c9f5a6d061847ae05bce328f39d86707e7cde1f2fe6239c6","root_digest":"sha256:22217e853f2cf610380a08a3f752472178475575cf917ad286f1e0f07090dc4c","member_digests":["sha256:06938f2d3d8255a79fc911eb2eb636f8072037d3ffbabc063008319773d84358"],"consumed_trial_budget":1,"frontier_digest":"sha256:b4f124b56c2deab11b786c6c3bdecf32cba42d3ef7426e07fa0a6d290967125f"}"#;

        let values = [ROOT, ROOT_RECEIPT, MEMBER, MEMBERSHIP_RECEIPT, FRONTIER]
            .map(|fixture| serde_json::from_str(fixture).unwrap());
        let family =
            admit_stored_family(&values[0], &values[1], &values[2], &values[3], &values[4])
                .unwrap();
        verify_family(&family).unwrap();
        assert_eq!(
            family.root.trial_family_identity(),
            "rd-trial-family-v1-151e77bcc8bf5146c9f5a6d061847ae05bce328f39d86707e7cde1f2fe6239c6"
        );
        assert_eq!(
            family.census_frontier.frontier_digest(),
            "sha256:b4f124b56c2deab11b786c6c3bdecf32cba42d3ef7426e07fa0a6d290967125f"
        );

        for carrier in [
            serde_json::to_value(&family.root).unwrap(),
            serde_json::to_value(&family.root_receipt).unwrap(),
            serde_json::to_value(&family.census_frontier).unwrap(),
        ] {
            assert!(carrier.get("replay_execution_policy_v2").is_none());
        }
    }
}
