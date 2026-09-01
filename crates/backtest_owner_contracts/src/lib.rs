//! Dependency-neutral vocabularies for the shared Backtest Replay V2 boundary.
//!
//! This crate contains caller-authored requests and finite value vocabularies only. It does not
//! define a positive result constructor, an observation provider trait, or Backtest execution.

use serde::{Deserialize, Serialize};
use thiserror::Error;

const REQUEST_SCHEMA_V2: u16 = 2;
const RESULT_SCHEMA_V2: u16 = 2;
const RESULT_RECEIPT_SCHEMA_V1: u16 = 1;
const RESULT_OUTBOX_SCHEMA_V1: u16 = 1;

/// Fixed append-only event kind for an exploratory Backtest Result commit.
pub const EXPLORATORY_RESULT_COMMITTED_EVENT_KIND_V1: &str =
    "EXPLORATORY_BACKTEST_RESULT_COMMITTED_V1";

/// A validated but non-authoritative identity value carried by an untrusted request.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct OpaqueIdentityV2(String);

impl OpaqueIdentityV2 {
    /// Returns the identity text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for OpaqueIdentityV2 {
    type Error = ReplayContractErrorV2;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        validate_text(&value, "identity")?;
        Ok(Self(value))
    }
}

impl<'de> Deserialize<'de> for OpaqueIdentityV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer)?
            .try_into()
            .map_err(serde::de::Error::custom)
    }
}

/// A validated digest value carried by a request or opaque locator.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct CanonicalDigestV2(String);

impl CanonicalDigestV2 {
    /// Returns the algorithm-prefixed digest.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for CanonicalDigestV2 {
    type Error = ReplayContractErrorV2;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if !valid_digest(&value) {
            return Err(ReplayContractErrorV2::InvalidDigest);
        }
        Ok(Self(value))
    }
}

impl<'de> Deserialize<'de> for CanonicalDigestV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer)?
            .try_into()
            .map_err(serde::de::Error::custom)
    }
}

/// An identity with its canonical content digest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentIdentityV2 {
    /// Stable identity in the producing Owner namespace.
    pub identity: OpaqueIdentityV2,
    /// Digest of the exact identified content.
    pub digest: CanonicalDigestV2,
}

/// A named, versioned contract or model profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VersionedIdentityV2 {
    /// Stable profile or contract identity.
    pub identity: OpaqueIdentityV2,
    /// Exact immutable version identity.
    pub version: OpaqueIdentityV2,
}

/// An opaque reference to evidence retained by its producing component.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentObservationLocatorV2 {
    /// Producing component namespace.
    pub component: ObservationComponentV2,
    /// Opaque producer-owned reference.
    pub reference: OpaqueIdentityV2,
    /// Digest of the exact observation bytes.
    pub digest: CanonicalDigestV2,
}

/// The complete finite set of components whose meaning can affect Replay V2 evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObservationComponentV2 {
    FrozenResearchIntent,
    TrialFamily,
    TrialFamilyCensusFrontier,
    ReplayAuthority,
    StrategyDesign,
    StrategyPlan,
    Artifact,
    ResolvedOwnerInputs,
    PitScope,
    PitSnapshot,
    UniverseSelection,
    CorrectionRule,
    MarketSemantics,
    ReplayConfiguration,
    RuntimeKernel,
    Simulator,
    CostModel,
    SlippageModel,
    CapacityModel,
    RunnerOperationalProfile,
    DiagnosticPolicy,
    DeterministicSeed,
    ReplayWindow,
    Calendar,
    Session,
    TimeZone,
    CorporateActionCut,
    HistoricalMembershipCut,
    SemanticTrace,
}

impl ObservationComponentV2 {
    /// Components whose requested meaning must reconcile exactly for a positive terminal result.
    pub const REQUESTED_MEANING: [Self; 28] = [
        Self::FrozenResearchIntent,
        Self::TrialFamily,
        Self::TrialFamilyCensusFrontier,
        Self::ReplayAuthority,
        Self::StrategyDesign,
        Self::StrategyPlan,
        Self::Artifact,
        Self::ResolvedOwnerInputs,
        Self::PitScope,
        Self::PitSnapshot,
        Self::UniverseSelection,
        Self::CorrectionRule,
        Self::MarketSemantics,
        Self::ReplayConfiguration,
        Self::RuntimeKernel,
        Self::Simulator,
        Self::CostModel,
        Self::SlippageModel,
        Self::CapacityModel,
        Self::RunnerOperationalProfile,
        Self::DiagnosticPolicy,
        Self::DeterministicSeed,
        Self::ReplayWindow,
        Self::Calendar,
        Self::Session,
        Self::TimeZone,
        Self::CorporateActionCut,
        Self::HistoricalMembershipCut,
    ];

    /// Components required before Backtest may commit a positive terminal result.
    pub const REQUIRED_FOR_TERMINAL: [Self; 29] = [
        Self::FrozenResearchIntent,
        Self::TrialFamily,
        Self::TrialFamilyCensusFrontier,
        Self::ReplayAuthority,
        Self::StrategyDesign,
        Self::StrategyPlan,
        Self::Artifact,
        Self::ResolvedOwnerInputs,
        Self::PitScope,
        Self::PitSnapshot,
        Self::UniverseSelection,
        Self::CorrectionRule,
        Self::MarketSemantics,
        Self::ReplayConfiguration,
        Self::RuntimeKernel,
        Self::Simulator,
        Self::CostModel,
        Self::SlippageModel,
        Self::CapacityModel,
        Self::RunnerOperationalProfile,
        Self::DiagnosticPolicy,
        Self::DeterministicSeed,
        Self::ReplayWindow,
        Self::Calendar,
        Self::Session,
        Self::TimeZone,
        Self::CorporateActionCut,
        Self::HistoricalMembershipCut,
        Self::SemanticTrace,
    ];
}

/// Replay namespace that controls which authority and result path may be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayNamespaceV2 {
    /// R&D-visible replay that cannot carry or consume holdout authority.
    Exploratory,
    /// Qualification-only replay backed by an exact holdout reservation and plan cell.
    Protected,
}

/// Caller-authored authority claim. It is not evidence that Backtest consumed the authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "namespace", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayAuthorityClaimV2 {
    /// Exploratory replay has no holdout-bearing fields by construction.
    Exploratory,
    /// Protected replay identifies the exact Qualification-owned authority chain.
    Protected {
        qualification_candidate_intake: ContentIdentityV2,
        holdout_reservation: ContentIdentityV2,
        protected_replay_plan: ContentIdentityV2,
        protected_plan_cell: ContentIdentityV2,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReplayAuthorityClaimWireV2 {
    namespace: ReplayNamespaceV2,
    qualification_candidate_intake: Option<ContentIdentityV2>,
    holdout_reservation: Option<ContentIdentityV2>,
    protected_replay_plan: Option<ContentIdentityV2>,
    protected_plan_cell: Option<ContentIdentityV2>,
}

impl<'de> Deserialize<'de> for ReplayAuthorityClaimV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = ReplayAuthorityClaimWireV2::deserialize(deserializer)?;
        match wire {
            ReplayAuthorityClaimWireV2 {
                namespace: ReplayNamespaceV2::Exploratory,
                qualification_candidate_intake: None,
                holdout_reservation: None,
                protected_replay_plan: None,
                protected_plan_cell: None,
            } => Ok(Self::Exploratory),
            ReplayAuthorityClaimWireV2 {
                namespace: ReplayNamespaceV2::Protected,
                qualification_candidate_intake: Some(qualification_candidate_intake),
                holdout_reservation: Some(holdout_reservation),
                protected_replay_plan: Some(protected_replay_plan),
                protected_plan_cell: Some(protected_plan_cell),
            } => Ok(Self::Protected {
                qualification_candidate_intake,
                holdout_reservation,
                protected_replay_plan,
                protected_plan_cell,
            }),
            ReplayAuthorityClaimWireV2 {
                namespace: ReplayNamespaceV2::Exploratory,
                ..
            } => Err(serde::de::Error::custom(
                "exploratory replay cannot carry protected authority",
            )),
            ReplayAuthorityClaimWireV2 {
                namespace: ReplayNamespaceV2::Protected,
                ..
            } => Err(serde::de::Error::custom(
                "protected replay requires the complete authority chain",
            )),
        }
    }
}

impl ReplayAuthorityClaimV2 {
    /// Returns the namespace declared by this untrusted claim.
    #[must_use]
    pub const fn namespace(&self) -> ReplayNamespaceV2 {
        match self {
            Self::Exploratory => ReplayNamespaceV2::Exploratory,
            Self::Protected { .. } => ReplayNamespaceV2::Protected,
        }
    }
}

/// Exact finite model profiles frozen into every Replay V2 request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayModelProfilesV2 {
    pub runtime_kernel: VersionedIdentityV2,
    pub simulator: VersionedIdentityV2,
    pub cost: VersionedIdentityV2,
    pub slippage: VersionedIdentityV2,
    pub capacity: VersionedIdentityV2,
}

/// Inclusive start and exclusive end of the requested deterministic replay interval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayWindowV2 {
    pub start_event_ns: u64,
    pub end_event_ns_exclusive: u64,
}

/// Caller-authored Replay V2 request. Every field is untrusted until its Owner observes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRequestDtoV2 {
    pub schema_version: u16,
    pub request_identity: OpaqueIdentityV2,
    pub frozen_research_intent: ContentIdentityV2,
    pub trial_family: ContentIdentityV2,
    pub trial_family_census_frontier: ContentIdentityV2,
    pub replay_authority: ReplayAuthorityClaimV2,
    pub strategy_design: ContentIdentityV2,
    pub strategy_plan: ContentIdentityV2,
    pub artifact: ContentIdentityV2,
    pub resolved_owner_inputs: ContentIdentityV2,
    pub pit_scope: ContentIdentityV2,
    pub pit_snapshot: ContentIdentityV2,
    pub universe_selection: ContentIdentityV2,
    pub correction_rule: VersionedIdentityV2,
    pub market_semantics: VersionedIdentityV2,
    pub replay_configuration: ContentIdentityV2,
    pub models: ReplayModelProfilesV2,
    pub runner_operational_profile: VersionedIdentityV2,
    pub diagnostic_policy: VersionedIdentityV2,
    pub deterministic_seed: u64,
    pub window: ReplayWindowV2,
    pub calendar: VersionedIdentityV2,
    pub session: VersionedIdentityV2,
    pub time_zone: VersionedIdentityV2,
    pub corporate_action_cut: ContentIdentityV2,
    pub historical_membership_cut: ContentIdentityV2,
}

/// A validated frozen request. Validation does not attest that any component consumed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ReplayRequestV2(ReplayRequestDtoV2);

impl ReplayRequestV2 {
    /// Returns the caller-owned request identity.
    #[must_use]
    pub fn request_identity(&self) -> &OpaqueIdentityV2 {
        &self.0.request_identity
    }

    /// Returns the validated request DTO.
    #[must_use]
    pub const fn as_dto(&self) -> &ReplayRequestDtoV2 {
        &self.0
    }

    /// Returns the explicit replay namespace. This remains a request claim until Owner commit.
    #[must_use]
    pub const fn namespace(&self) -> ReplayNamespaceV2 {
        self.0.replay_authority.namespace()
    }

    /// Returns canonical JSON bytes for hashing and equality checks.
    ///
    /// # Errors
    ///
    /// Returns an error if canonical request encoding is unavailable.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ReplayContractErrorV2> {
        serde_json::to_vec(&self.0).map_err(|e| encoding_error(&e))
    }

    /// Returns the domain-separated digest of the complete requested meaning.
    ///
    /// # Errors
    ///
    /// Returns an error if canonical request encoding is unavailable.
    pub fn meaning_digest(&self) -> Result<CanonicalDigestV2, ReplayContractErrorV2> {
        let bytes = self.to_canonical_bytes()?;
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"vibe.backtest.replay-request.v2\0");
        hasher.update(&bytes);
        CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
    }
}

impl TryFrom<ReplayRequestDtoV2> for ReplayRequestV2 {
    type Error = ReplayContractErrorV2;

    fn try_from(value: ReplayRequestDtoV2) -> Result<Self, Self::Error> {
        if value.schema_version != REQUEST_SCHEMA_V2 {
            return Err(ReplayContractErrorV2::UnsupportedSchema {
                expected: REQUEST_SCHEMA_V2,
                actual: value.schema_version,
            });
        }

        if value.window.start_event_ns >= value.window.end_event_ns_exclusive {
            return Err(ReplayContractErrorV2::InvalidReplayWindow);
        }
        Ok(Self(value))
    }
}

/// Complete finite diagnostic census owned by Backtest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagnosticCategoryV2 {
    NoExecutionDefect,
    MarketData,
    Artifact,
    RuntimeKernel,
    BacktestOperational,
    Simulator,
    ReplayConfiguration,
    ValidEconomicFailure,
    UnresolvedFailure,
}

impl DiagnosticCategoryV2 {
    /// All categories in canonical census order.
    pub const ALL: [Self; 9] = [
        Self::NoExecutionDefect,
        Self::MarketData,
        Self::Artifact,
        Self::RuntimeKernel,
        Self::BacktestOperational,
        Self::Simulator,
        Self::ReplayConfiguration,
        Self::ValidEconomicFailure,
        Self::UnresolvedFailure,
    ];

    /// Whether the category identifies an execution defect.
    #[must_use]
    pub const fn is_execution_defect(self) -> bool {
        matches!(
            self,
            Self::MarketData
                | Self::Artifact
                | Self::RuntimeKernel
                | Self::BacktestOperational
                | Self::Simulator
                | Self::ReplayConfiguration
        )
    }
}

/// Complete public terminal vocabulary for Replay V2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayTerminalV2 {
    RunRejected,
    InProgressOrUnknown,
    TerminalResult,
    InvalidReplayEvidence,
}

/// Untrusted reconciliation status carried by canonical Backtest Result bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResultReconciliationStatusV2 {
    Exact,
    Missing,
    Mismatched,
}

/// Untrusted wire representation of one requested-to-consumed reconciliation atom.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResultReconciliationAtomV2 {
    pub component: ObservationComponentV2,
    pub requested_meaning_identity: OpaqueIdentityV2,
    pub requested_meaning_digest: CanonicalDigestV2,
    pub observed_meaning_identity: Option<OpaqueIdentityV2>,
    pub observed_meaning_digest: Option<CanonicalDigestV2>,
    pub observation_locator: Option<ComponentObservationLocatorV2>,
    pub status: ResultReconciliationStatusV2,
}

/// Untrusted wire representation of Backtest's semantic-trace observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResultConsumptionObservationV2 {
    pub request_identity: OpaqueIdentityV2,
    pub request_meaning_digest: CanonicalDigestV2,
    pub attempt_identity: OpaqueIdentityV2,
    pub component: ObservationComponentV2,
    pub locator: ComponentObservationLocatorV2,
    pub observed_meaning_identity: OpaqueIdentityV2,
    pub observed_meaning_digest: CanonicalDigestV2,
}

/// Untrusted wire representation of one Backtest diagnostic classification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResultDiagnosticEvidenceV2 {
    pub request_identity: OpaqueIdentityV2,
    pub request_meaning_digest: CanonicalDigestV2,
    pub attempt_identity: OpaqueIdentityV2,
    pub category: DiagnosticCategoryV2,
    pub decisive_evidence: ComponentObservationLocatorV2,
}

/// Untrusted wire representation of a mature Backtest-owned Replay V2 Result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayResultDtoV2 {
    pub schema_version: u16,
    pub result_identity: OpaqueIdentityV2,
    pub result_digest: CanonicalDigestV2,
    pub request_identity: OpaqueIdentityV2,
    pub request_meaning_digest: CanonicalDigestV2,
    pub namespace: ReplayNamespaceV2,
    pub replay_authority: ReplayAuthorityClaimV2,
    pub attempt_identity: OpaqueIdentityV2,
    pub terminal: ReplayTerminalV2,
    pub reconciliation: Vec<ResultReconciliationAtomV2>,
    pub semantic_trace: Option<ResultConsumptionObservationV2>,
    pub diagnostic_census: Vec<ResultDiagnosticEvidenceV2>,
}

impl ReplayResultDtoV2 {
    /// Returns canonical bytes for this complete untrusted wire value.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ReplayContractErrorV2> {
        serde_json::to_vec(self).map_err(|e| encoding_error(&e))
    }

    /// Recomputes the digest used by the Backtest Owner's sealed result constructor.
    pub fn expected_result_digest(&self) -> Result<CanonicalDigestV2, ReplayContractErrorV2> {
        if self.schema_version != RESULT_SCHEMA_V2 {
            return Err(ReplayContractErrorV2::UnsupportedResultSchema {
                expected: RESULT_SCHEMA_V2,
                actual: self.schema_version,
            });
        }
        digest_serialized(
            "vibe.backtest.replay-result.v2",
            &ProvisionalReplayResultV2 {
                schema_version: self.schema_version,
                request_identity: &self.request_identity,
                request_meaning_digest: &self.request_meaning_digest,
                namespace: self.namespace,
                replay_authority: &self.replay_authority,
                attempt_identity: &self.attempt_identity,
                terminal: self.terminal,
                reconciliation: &self.reconciliation,
                semantic_trace: self.semantic_trace.as_ref(),
                diagnostic_census: &self.diagnostic_census,
            },
        )
    }

    /// Recomputes the content-addressed Result identity.
    pub fn expected_result_identity(&self) -> Result<OpaqueIdentityV2, ReplayContractErrorV2> {
        let digest = self.expected_result_digest()?;
        OpaqueIdentityV2::try_from(format!(
            "backtest-replay-result-v2-{}",
            digest.as_str().trim_start_matches("blake3:")
        ))
    }
}

#[derive(Serialize)]
struct ProvisionalReplayResultV2<'a> {
    schema_version: u16,
    request_identity: &'a OpaqueIdentityV2,
    request_meaning_digest: &'a CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    replay_authority: &'a ReplayAuthorityClaimV2,
    attempt_identity: &'a OpaqueIdentityV2,
    terminal: ReplayTerminalV2,
    reconciliation: &'a [ResultReconciliationAtomV2],
    semantic_trace: Option<&'a ResultConsumptionObservationV2>,
    diagnostic_census: &'a [ResultDiagnosticEvidenceV2],
}

/// Canonical receipt wire owned and persisted by Backtest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BacktestResultReceiptV1 {
    pub schema_version: u16,
    pub receipt_identity: OpaqueIdentityV2,
    pub receipt_digest: CanonicalDigestV2,
    pub request_identity: OpaqueIdentityV2,
    pub request_meaning_digest: CanonicalDigestV2,
    pub result_identity: OpaqueIdentityV2,
    pub result_digest: CanonicalDigestV2,
    pub namespace: ReplayNamespaceV2,
    pub outbox_event_identity: OpaqueIdentityV2,
    pub committed_at_epoch_ms: u64,
}

impl BacktestResultReceiptV1 {
    /// Recomputes the canonical receipt digest.
    pub fn expected_digest(&self) -> Result<CanonicalDigestV2, ReplayContractErrorV2> {
        if self.schema_version != RESULT_RECEIPT_SCHEMA_V1 {
            return Err(ReplayContractErrorV2::UnsupportedResultReceiptSchema {
                expected: RESULT_RECEIPT_SCHEMA_V1,
                actual: self.schema_version,
            });
        }
        digest_serialized(
            "vibe.backtest.result-receipt.v1",
            &ProvisionalResultReceiptV1 {
                schema_version: self.schema_version,
                receipt_identity: &self.receipt_identity,
                request_identity: &self.request_identity,
                request_meaning_digest: &self.request_meaning_digest,
                result_identity: &self.result_identity,
                result_digest: &self.result_digest,
                namespace: self.namespace,
                outbox_event_identity: &self.outbox_event_identity,
                committed_at_epoch_ms: self.committed_at_epoch_ms,
            },
        )
    }
}

#[derive(Serialize)]
struct ProvisionalResultReceiptV1<'a> {
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

/// Canonical append-only outbox payload wire owned by Backtest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BacktestResultOutboxPayloadV1 {
    pub schema_version: u16,
    pub receipt_identity: OpaqueIdentityV2,
    pub receipt_digest: CanonicalDigestV2,
    pub request_identity: OpaqueIdentityV2,
    pub request_meaning_digest: CanonicalDigestV2,
    pub result_identity: OpaqueIdentityV2,
    pub result_digest: CanonicalDigestV2,
    pub namespace: ReplayNamespaceV2,
    pub committed_at_epoch_ms: u64,
}

/// Canonical append-only outbox event wire owned by Backtest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BacktestResultOutboxV1 {
    pub schema_version: u16,
    pub event_identity: OpaqueIdentityV2,
    pub event_digest: CanonicalDigestV2,
    pub aggregate_identity: OpaqueIdentityV2,
    pub event_kind: OpaqueIdentityV2,
    pub payload_digest: CanonicalDigestV2,
    pub payload: BacktestResultOutboxPayloadV1,
    pub committed_at_epoch_ms: u64,
}

impl BacktestResultOutboxV1 {
    /// Recomputes the canonical payload digest.
    pub fn expected_payload_digest(&self) -> Result<CanonicalDigestV2, ReplayContractErrorV2> {
        if self.schema_version != RESULT_OUTBOX_SCHEMA_V1
            || self.payload.schema_version != RESULT_OUTBOX_SCHEMA_V1
        {
            return Err(ReplayContractErrorV2::UnsupportedResultOutboxSchema {
                expected: RESULT_OUTBOX_SCHEMA_V1,
                actual: self.schema_version,
            });
        }
        digest_serialized("vibe.backtest.result-outbox-payload.v1", &self.payload)
    }

    /// Recomputes the canonical outbox event digest.
    pub fn expected_event_digest(&self) -> Result<CanonicalDigestV2, ReplayContractErrorV2> {
        if self.schema_version != RESULT_OUTBOX_SCHEMA_V1 {
            return Err(ReplayContractErrorV2::UnsupportedResultOutboxSchema {
                expected: RESULT_OUTBOX_SCHEMA_V1,
                actual: self.schema_version,
            });
        }
        digest_serialized(
            "vibe.backtest.result-outbox-event.v1",
            &ProvisionalResultOutboxV1 {
                schema_version: self.schema_version,
                event_identity: &self.event_identity,
                aggregate_identity: &self.aggregate_identity,
                event_kind: &self.event_kind,
                payload_digest: &self.payload_digest,
                payload: &self.payload,
                committed_at_epoch_ms: self.committed_at_epoch_ms,
            },
        )
    }
}

#[derive(Serialize)]
struct ProvisionalResultOutboxV1<'a> {
    schema_version: u16,
    event_identity: &'a OpaqueIdentityV2,
    aggregate_identity: &'a OpaqueIdentityV2,
    event_kind: &'a OpaqueIdentityV2,
    payload_digest: &'a CanonicalDigestV2,
    payload: &'a BacktestResultOutboxPayloadV1,
    committed_at_epoch_ms: u64,
}

/// Typed failures at the untrusted Replay V2 contract boundary.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ReplayContractErrorV2 {
    #[error("Replay V2 identity is empty or exceeds its bounded length: {field}")]
    InvalidText { field: &'static str },
    #[error("Replay V2 digest must be lowercase sha256 or blake3 with 64 hexadecimal digits")]
    InvalidDigest,
    #[error("unsupported Replay V2 schema: expected {expected}, received {actual}")]
    UnsupportedSchema { expected: u16, actual: u16 },
    #[error("unsupported Replay V2 Result schema: expected {expected}, received {actual}")]
    UnsupportedResultSchema { expected: u16, actual: u16 },
    #[error("unsupported Backtest Result receipt schema: expected {expected}, received {actual}")]
    UnsupportedResultReceiptSchema { expected: u16, actual: u16 },
    #[error("unsupported Backtest Result outbox schema: expected {expected}, received {actual}")]
    UnsupportedResultOutboxSchema { expected: u16, actual: u16 },
    #[error("Replay V2 window start must precede its exclusive end")]
    InvalidReplayWindow,
    #[error("Replay V2 canonical encoding unavailable: {0}")]
    CanonicalEncodingUnavailable(String),
}

fn validate_text(value: &str, field: &'static str) -> Result<(), ReplayContractErrorV2> {
    if value.is_empty() || value.len() > 256 || value.trim() != value {
        return Err(ReplayContractErrorV2::InvalidText { field });
    }
    Ok(())
}

fn valid_digest(value: &str) -> bool {
    let Some((algorithm, hex)) = value.split_once(':') else {
        return false;
    };
    matches!(algorithm, "sha256" | "blake3")
        && hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn encoding_error(error: &serde_json::Error) -> ReplayContractErrorV2 {
    ReplayContractErrorV2::CanonicalEncodingUnavailable(error.to_string())
}

fn digest_serialized<T: Serialize>(
    domain: &str,
    value: &T,
) -> Result<CanonicalDigestV2, ReplayContractErrorV2> {
    let bytes = serde_json::to_vec(value).map_err(|e| encoding_error(&e))?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(b"\0");
    hasher.update(&bytes);
    CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn identity(value: &str) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.to_string()).expect("fixture identity must be valid")
    }

    fn digest(byte: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64)))
            .expect("fixture digest must be valid")
    }

    fn content(name: &str, byte: char) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: identity(name),
            digest: digest(byte),
        }
    }

    fn version(name: &str) -> VersionedIdentityV2 {
        VersionedIdentityV2 {
            identity: identity(name),
            version: identity("v2"),
        }
    }

    fn dto() -> ReplayRequestDtoV2 {
        ReplayRequestDtoV2 {
            schema_version: 2,
            request_identity: identity("rd-replay-request-2"),
            frozen_research_intent: content("frozen-research-intent", 'b'),
            trial_family: content("trial-family", 'c'),
            trial_family_census_frontier: content("trial-family-census-frontier", 'd'),
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            strategy_design: content("design", '1'),
            strategy_plan: content("plan", '2'),
            artifact: content("artifact", '3'),
            resolved_owner_inputs: content("owner-inputs", '4'),
            pit_scope: content("pit-scope", '5'),
            pit_snapshot: content("pit-snapshot", '6'),
            universe_selection: content("universe", '7'),
            correction_rule: version("correction-rule"),
            market_semantics: version("market-semantics"),
            replay_configuration: content("replay-config", '8'),
            models: ReplayModelProfilesV2 {
                runtime_kernel: version("runtime-kernel"),
                simulator: version("simulator"),
                cost: version("cost"),
                slippage: version("slippage"),
                capacity: version("capacity"),
            },
            runner_operational_profile: version("runner-operational-profile"),
            diagnostic_policy: version("diagnostic-policy"),
            deterministic_seed: 17,
            window: ReplayWindowV2 {
                start_event_ns: 10,
                end_event_ns_exclusive: 20,
            },
            calendar: version("calendar"),
            session: version("session"),
            time_zone: version("time-zone"),
            corporate_action_cut: content("corporate-action-cut", '9'),
            historical_membership_cut: content("membership-cut", 'a'),
        }
    }

    fn protected_dto() -> ReplayRequestDtoV2 {
        let mut value = dto();
        value.replay_authority = ReplayAuthorityClaimV2::Protected {
            qualification_candidate_intake: content("candidate-intake", 'e'),
            holdout_reservation: content("holdout-reservation", 'f'),
            protected_replay_plan: content("protected-plan", '0'),
            protected_plan_cell: content("protected-plan-cell", 'b'),
        };
        value
    }

    #[rstest]
    fn canonical_request_serialization_is_stable() {
        let request = ReplayRequestV2::try_from(dto()).expect("fixture request must be valid");
        let first = request
            .to_canonical_bytes()
            .expect("fixture request must encode");
        let second = request
            .to_canonical_bytes()
            .expect("fixture request must encode again");
        assert_eq!(first, second);
        assert_eq!(
            request.meaning_digest(),
            request.meaning_digest(),
            "the complete requested meaning must have one canonical digest"
        );
    }

    #[rstest]
    fn request_validation_rejects_schema_and_window_mutations() {
        let mut wrong_schema = dto();
        wrong_schema.schema_version = 1;
        assert!(matches!(
            ReplayRequestV2::try_from(wrong_schema),
            Err(ReplayContractErrorV2::UnsupportedSchema { .. })
        ));

        let mut wrong_window = dto();
        wrong_window.window.start_event_ns = wrong_window.window.end_event_ns_exclusive;
        assert_eq!(
            ReplayRequestV2::try_from(wrong_window),
            Err(ReplayContractErrorV2::InvalidReplayWindow)
        );
    }

    #[rstest]
    fn every_request_field_changes_the_canonical_meaning() {
        type Mutation = fn(&mut ReplayRequestDtoV2);
        let mutations: &[Mutation] = &[
            |value| value.request_identity = identity("changed-request"),
            |value| {
                value.frozen_research_intent.identity = identity("changed-research-intent");
            },
            |value| value.frozen_research_intent.digest = digest('e'),
            |value| value.trial_family.identity = identity("changed-trial-family"),
            |value| value.trial_family.digest = digest('e'),
            |value| {
                value.trial_family_census_frontier.identity =
                    identity("changed-trial-family-census");
            },
            |value| value.trial_family_census_frontier.digest = digest('e'),
            |value| value.replay_authority = protected_dto().replay_authority,
            |value| value.strategy_design.identity = identity("changed-design"),
            |value| value.strategy_design.digest = digest('b'),
            |value| value.strategy_plan.identity = identity("changed-plan"),
            |value| value.strategy_plan.digest = digest('b'),
            |value| value.artifact.identity = identity("changed-artifact"),
            |value| value.artifact.digest = digest('b'),
            |value| value.resolved_owner_inputs.identity = identity("changed-owner-inputs"),
            |value| value.resolved_owner_inputs.digest = digest('b'),
            |value| value.pit_scope.identity = identity("changed-pit-scope"),
            |value| value.pit_scope.digest = digest('b'),
            |value| value.pit_snapshot.identity = identity("changed-pit-snapshot"),
            |value| value.pit_snapshot.digest = digest('b'),
            |value| value.universe_selection.identity = identity("changed-universe"),
            |value| value.universe_selection.digest = digest('b'),
            |value| value.correction_rule.identity = identity("changed-correction"),
            |value| value.correction_rule.version = identity("v3"),
            |value| value.market_semantics.identity = identity("changed-market-semantics"),
            |value| value.market_semantics.version = identity("v3"),
            |value| value.replay_configuration.identity = identity("changed-replay-config"),
            |value| value.replay_configuration.digest = digest('b'),
            |value| value.models.runtime_kernel.identity = identity("changed-runtime-kernel"),
            |value| value.models.runtime_kernel.version = identity("v3"),
            |value| value.models.simulator.identity = identity("changed-simulator"),
            |value| value.models.simulator.version = identity("v3"),
            |value| value.models.cost.identity = identity("changed-cost"),
            |value| value.models.cost.version = identity("v3"),
            |value| value.models.slippage.identity = identity("changed-slippage"),
            |value| value.models.slippage.version = identity("v3"),
            |value| value.models.capacity.identity = identity("changed-capacity"),
            |value| value.models.capacity.version = identity("v3"),
            |value| {
                value.runner_operational_profile.identity = identity("changed-operational-profile");
            },
            |value| value.runner_operational_profile.version = identity("v3"),
            |value| value.diagnostic_policy.identity = identity("changed-diagnostic-policy"),
            |value| value.diagnostic_policy.version = identity("v3"),
            |value| value.deterministic_seed += 1,
            |value| value.window.start_event_ns += 1,
            |value| value.window.end_event_ns_exclusive += 1,
            |value| value.calendar.identity = identity("changed-calendar"),
            |value| value.calendar.version = identity("v3"),
            |value| value.session.identity = identity("changed-session"),
            |value| value.session.version = identity("v3"),
            |value| value.time_zone.identity = identity("changed-time-zone"),
            |value| value.time_zone.version = identity("v3"),
            |value| value.corporate_action_cut.identity = identity("changed-corporate-actions"),
            |value| value.corporate_action_cut.digest = digest('b'),
            |value| {
                value.historical_membership_cut.identity = identity("changed-membership");
            },
            |value| value.historical_membership_cut.digest = digest('b'),
        ];
        let baseline = ReplayRequestV2::try_from(dto())
            .expect("fixture request must be valid")
            .meaning_digest()
            .expect("fixture request must hash");

        for mutate in mutations {
            let mut changed = dto();
            mutate(&mut changed);
            let changed = ReplayRequestV2::try_from(changed)
                .expect("mutated fixture request must remain structurally valid")
                .meaning_digest()
                .expect("mutated fixture request must hash");
            assert_ne!(baseline, changed);
        }
    }

    #[rstest]
    fn finite_censuses_are_complete_and_unique() {
        let mut requested = ObservationComponentV2::REQUESTED_MEANING.to_vec();
        requested.sort_unstable();
        requested.dedup();
        assert_eq!(requested.len(), 28);
        assert!(!requested.contains(&ObservationComponentV2::SemanticTrace));

        let mut components = ObservationComponentV2::REQUIRED_FOR_TERMINAL.to_vec();
        components.sort_unstable();
        components.dedup();
        assert_eq!(components.len(), 29);

        let mut diagnostics = DiagnosticCategoryV2::ALL.to_vec();
        diagnostics.sort_unstable();
        diagnostics.dedup();
        assert_eq!(diagnostics.len(), 9);
    }

    #[rstest]
    fn exploratory_authority_has_no_holdout_bearing_shape() {
        let request = ReplayRequestV2::try_from(dto()).expect("fixture request must be valid");
        assert_eq!(request.namespace(), ReplayNamespaceV2::Exploratory);
        let encoded = String::from_utf8(
            request
                .to_canonical_bytes()
                .expect("exploratory request must encode"),
        )
        .expect("canonical JSON is UTF-8");
        assert!(!encoded.contains("holdout_reservation"));
        assert!(!encoded.contains("protected_replay_plan"));

        let mut encoded_value =
            serde_json::to_value(dto()).expect("exploratory request DTO must encode");
        encoded_value["replay_authority"]["holdout_reservation"] =
            serde_json::to_value(content("smuggled-holdout", 'e'))
                .expect("fixture identity must encode");
        assert!(serde_json::from_value::<ReplayRequestDtoV2>(encoded_value).is_err());
    }

    #[rstest]
    fn every_protected_authority_field_changes_canonical_meaning() {
        type Mutation = fn(&mut ReplayAuthorityClaimV2);
        let mutations: &[Mutation] = &[
            |authority| match authority {
                ReplayAuthorityClaimV2::Protected {
                    qualification_candidate_intake,
                    ..
                } => qualification_candidate_intake.identity = identity("changed-intake"),
                ReplayAuthorityClaimV2::Exploratory => unreachable!(),
            },
            |authority| match authority {
                ReplayAuthorityClaimV2::Protected {
                    qualification_candidate_intake,
                    ..
                } => qualification_candidate_intake.digest = digest('1'),
                ReplayAuthorityClaimV2::Exploratory => unreachable!(),
            },
            |authority| match authority {
                ReplayAuthorityClaimV2::Protected {
                    holdout_reservation,
                    ..
                } => holdout_reservation.identity = identity("changed-holdout"),
                ReplayAuthorityClaimV2::Exploratory => unreachable!(),
            },
            |authority| match authority {
                ReplayAuthorityClaimV2::Protected {
                    holdout_reservation,
                    ..
                } => holdout_reservation.digest = digest('1'),
                ReplayAuthorityClaimV2::Exploratory => unreachable!(),
            },
            |authority| match authority {
                ReplayAuthorityClaimV2::Protected {
                    protected_replay_plan,
                    ..
                } => protected_replay_plan.identity = identity("changed-plan"),
                ReplayAuthorityClaimV2::Exploratory => unreachable!(),
            },
            |authority| match authority {
                ReplayAuthorityClaimV2::Protected {
                    protected_replay_plan,
                    ..
                } => protected_replay_plan.digest = digest('1'),
                ReplayAuthorityClaimV2::Exploratory => unreachable!(),
            },
            |authority| match authority {
                ReplayAuthorityClaimV2::Protected {
                    protected_plan_cell,
                    ..
                } => protected_plan_cell.identity = identity("changed-cell"),
                ReplayAuthorityClaimV2::Exploratory => unreachable!(),
            },
            |authority| match authority {
                ReplayAuthorityClaimV2::Protected {
                    protected_plan_cell,
                    ..
                } => protected_plan_cell.digest = digest('1'),
                ReplayAuthorityClaimV2::Exploratory => unreachable!(),
            },
        ];
        let baseline = ReplayRequestV2::try_from(protected_dto())
            .expect("protected request must validate")
            .meaning_digest()
            .expect("protected request must hash");

        for mutate in mutations {
            let mut changed = protected_dto();
            mutate(&mut changed.replay_authority);
            let changed = ReplayRequestV2::try_from(changed)
                .expect("mutated protected request must validate")
                .meaning_digest()
                .expect("mutated protected request must hash");
            assert_ne!(baseline, changed);
        }
    }
}
