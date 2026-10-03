//! The Owner-sealed intake through which Operations admits one Market Data Source Binding.
//!
//! Operations supplies the binding and the rights evidence it holds; Market Data decides. The
//! caller cannot hand in a disposition or a blocker set, because "this source is admitted" is the
//! Owner's finding, not the submitter's claim. The Owner also mints the decision cut, so the first
//! admission is what establishes its one canonical clock head.
//!
//! Rights evidence is a bounded vocabulary rather than free text. An unknown or legal-review answer
//! is `Unresolved`, which becomes `UNAVAILABLE` and never `UNLICENSED`: only a decisive denial
//! withdraws a right, and the difference decides whether a later grant can revive the source.

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::source_binding::{
    BindingDigest, SourceBindingError, UntrustedSourceBindingLocator,
    UntrustedSourceBindingProposal,
};

/// What Operations can decisively say about the rights behind one source.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderRightsEvidenceV1 {
    /// A decisive grant covering the declared use and redistribution scope.
    Granted,
    /// A decisive withdrawal of a right previously held.
    Revoked,
    /// A decisive denial, or no licence at all.
    Denied,
    /// Legal review required, or otherwise unknown. Never treated as a denial.
    Unresolved,
}

/// Whether the source answered at all when Operations last observed it.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderReachabilityEvidenceV1 {
    /// The authenticated endpoint answered.
    Reachable,
    /// The authenticated endpoint did not answer.
    Unreachable,
}

/// One complete admission submission from Operations.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SourceBindingAdmissionRequestV1 {
    /// The binding Operations proposes.
    pub proposal: UntrustedSourceBindingProposal,
    /// The rights evidence Operations holds for it.
    pub rights: ProviderRightsEvidenceV1,
    /// The reachability Operations last observed.
    pub reachability: ProviderReachabilityEvidenceV1,
}

/// The public disposition vocabulary of one admitted or refused binding.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceBindingAdmissionDispositionV1 {
    /// No blocker. The binding may back a snapshot.
    Admitted,
    /// A right previously held was withdrawn.
    Revoked,
    /// A decisive denial, or no licence.
    Unlicensed,
    /// Identity, configuration or semantics do not reconcile.
    Incompatible,
    /// Rights evidence is unresolved, or the source did not answer.
    Unavailable,
}

/// The move-only terminal Market Data seals for one admission.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SourceBindingAdmissionTerminalV1 {
    binding_id: BindingDigest,
    lineage_root: BindingDigest,
    lineage_version: u64,
    disposition: SourceBindingAdmissionDispositionV1,
    locator: UntrustedSourceBindingLocator,
    market_semantics_identity: BindingDigest,
}

impl SourceBindingAdmissionTerminalV1 {
    pub(crate) const fn seal(
        binding_id: BindingDigest,
        lineage_root: BindingDigest,
        lineage_version: u64,
        disposition: SourceBindingAdmissionDispositionV1,
        locator: UntrustedSourceBindingLocator,
        market_semantics_identity: BindingDigest,
    ) -> Self {
        Self {
            binding_id,
            lineage_root,
            lineage_version,
            disposition,
            locator,
            market_semantics_identity,
        }
    }

    /// The exact locator a PIT request must name to reach this binding.
    ///
    /// It is Owner-derived, so a requester cannot compose one: it has to carry back the locator the
    /// admission handed it.
    #[must_use]
    pub const fn locator(&self) -> &UntrustedSourceBindingLocator {
        &self.locator
    }

    /// The Market Semantics Compatibility identity this binding implies.
    ///
    /// A PIT request that names any other identity is semantically incompatible with the binding it
    /// asks to read, which the snapshot records as `AMBIGUOUS`.
    #[must_use]
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    /// The Owner-derived binding identity.
    #[must_use]
    pub const fn binding_id(&self) -> BindingDigest {
        self.binding_id
    }

    /// The lineage root this binding belongs to.
    #[must_use]
    pub const fn lineage_root(&self) -> BindingDigest {
        self.lineage_root
    }

    /// The lineage version of this binding.
    #[must_use]
    pub const fn lineage_version(&self) -> u64 {
        self.lineage_version
    }

    /// The disposition Market Data derived from the supplied evidence.
    #[must_use]
    pub const fn disposition(&self) -> SourceBindingAdmissionDispositionV1 {
        self.disposition
    }
}

/// Why an admission reached no finding.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceBindingAdmissionErrorV1 {
    /// A claimed identity or locator does not derive from the content it names.
    InvalidProposal,
    /// A required identifier, mapping, semantics rule or licence term is empty; the field is named.
    FieldMissing(&'static str),
    /// A required digest is zero; the field is named.
    DigestZero(&'static str),
    /// A schema version, policy version or frontier sequence is zero or unsupported; the field is
    /// named.
    VersionInvalid(&'static str),
    /// The credential handle carries raw credential material instead of an opaque handle identity.
    RawCredentialMaterial,
    /// The credential handle's audience is not exclusively Market Data.
    CredentialAudienceInvalid,
    /// The credential handle claims no capability, or one beyond read-only market data.
    CredentialCapabilityForbidden,
    /// The submitter's time coordinates are zero or out of order.
    TimeEvidenceInvalid,
    /// The submitter's time coordinates are well ordered but name an instant the Owner's decision
    /// cut has not reached; a later admission can accept them.
    TimeEvidenceAfterDecisionCut,
    /// A declared bar timeframe is a combination no bar can have, or the declarations repeat or
    /// misorder a label.
    BarTimeframeUnsupported,
    /// The same binding identity is already bound to a different decision.
    AdmissionConflict,
    /// The Owner could not mint a decision cut.
    ClockUnavailable,
    /// The cut the Owner minted does not agree with its clock custody: either the proposal's time
    /// evidence names another clock, or the store's clock head is on a clock the minted cut does
    /// not succeed.
    ClockMismatch,
    /// The Owner store is unreachable or refused the commit.
    StoreUnavailable,
}

impl Display for SourceBindingAdmissionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidProposal => formatter
                .write_str("a claimed Source Binding identity does not derive from its content"),
            Self::FieldMissing(field) => {
                write!(formatter, "the Source Binding field {field} is empty")
            }
            Self::DigestZero(field) => {
                write!(formatter, "the Source Binding digest {field} is zero")
            }
            Self::VersionInvalid(field) => {
                write!(
                    formatter,
                    "the Source Binding version or sequence {field} is invalid"
                )
            }
            Self::RawCredentialMaterial => {
                formatter.write_str("the credential handle carries raw credential material")
            }
            Self::CredentialAudienceInvalid => {
                formatter.write_str("the credential audience is not exclusively Market Data")
            }
            Self::CredentialCapabilityForbidden => formatter
                .write_str("the credential capabilities are empty or exceed read-only market data"),
            Self::TimeEvidenceInvalid => {
                formatter.write_str("the Source Binding time evidence is zero or out of order")
            }
            Self::TimeEvidenceAfterDecisionCut => formatter.write_str(
                "the Source Binding time evidence is later than Market Data's decision cut",
            ),
            Self::BarTimeframeUnsupported => {
                formatter.write_str("a declared bar timeframe is not a combination a bar can have")
            }
            Self::AdmissionConflict => {
                formatter.write_str("the binding identity is bound to a different decision")
            }
            Self::ClockUnavailable => {
                formatter.write_str("Market Data could not mint a decision cut")
            }
            Self::ClockMismatch => formatter.write_str(
                "the minted decision cut does not agree with Market Data's clock custody",
            ),
            Self::StoreUnavailable => formatter.write_str("the Market Data store is unavailable"),
        }
    }
}

impl std::error::Error for SourceBindingAdmissionErrorV1 {}

impl From<SourceBindingError> for SourceBindingAdmissionErrorV1 {
    /// Every variant is listed, so a variant added later is classified by someone deciding what
    /// it means rather than by a wildcard.
    fn from(error: SourceBindingError) -> Self {
        match error {
            // The Owner re-derives the binding and time-evidence identities from the stamped
            // proposal before it validates, and admission reads no locator; each is named by its
            // meaning should that ever change.
            SourceBindingError::BindingIdentityMismatch
            | SourceBindingError::TimeEvidenceIdentityMismatch
            | SourceBindingError::LocatorMismatch => Self::InvalidProposal,
            SourceBindingError::MissingField(field) => Self::FieldMissing(field),
            SourceBindingError::ZeroDigest(field) => Self::DigestZero(field),
            SourceBindingError::InvalidVersionOrSequence(field) => Self::VersionInvalid(field),
            SourceBindingError::RawCredentialMaterial => Self::RawCredentialMaterial,
            SourceBindingError::InvalidCredentialAudience => Self::CredentialAudienceInvalid,
            SourceBindingError::ForbiddenCredentialCapability => {
                Self::CredentialCapabilityForbidden
            }
            SourceBindingError::InvalidTimeEvidence => Self::TimeEvidenceInvalid,
            SourceBindingError::TimeEvidenceAfterDecisionCut => Self::TimeEvidenceAfterDecisionCut,
            SourceBindingError::UnsupportedBarTimeframe => Self::BarTimeframeUnsupported,
            // A successor that does not advance is raised only by successor commits, which
            // admission never makes; by meaning it contends with the lineage head.
            SourceBindingError::ReplayConflict
            | SourceBindingError::LineageHeadMismatch
            | SourceBindingError::SuccessorDoesNotAdvance => Self::AdmissionConflict,
            // A lost response is recovered by an exact retry, as a store failure is.
            SourceBindingError::StoreUnavailable
            | SourceBindingError::CommitInterrupted
            | SourceBindingError::ResponseLost => Self::StoreUnavailable,
            SourceBindingError::TrustedClockMismatch => Self::ClockMismatch,
        }
    }
}

/// The sealed production admission. Operations reaches it; no consumer can implement it.
#[async_trait]
pub trait SourceBindingAdmissionV1: Send + Sync + sealed::Sealed {
    /// Admits or refuses one proposed binding under the Owner's own policy.
    ///
    /// # Errors
    ///
    /// Returns a bounded category only when Market Data reached no finding at all. A refusal is a
    /// terminal disposition, not an error.
    async fn admit(
        &self,
        request: SourceBindingAdmissionRequestV1,
    ) -> Result<SourceBindingAdmissionTerminalV1, SourceBindingAdmissionErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured Market Data Source Binding admission.
///
/// The deployment configuration root chooses the database through
/// `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn source_binding_admission_from_environment_v1()
-> Result<Arc<dyn SourceBindingAdmissionV1>, SourceBindingAdmissionErrorV1> {
    super::postgres::source_binding_admission_from_environment_v1().await
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{SourceBindingAdmissionErrorV1, SourceBindingError};

    /// A clock the minted cut cannot stand on keeps its own name on the way out, rather than
    /// reading as a malformed proposal the caller could fix by editing its body.
    #[rstest]
    fn a_clock_mismatch_is_named_and_not_a_malformed_proposal() {
        assert_eq!(
            SourceBindingAdmissionErrorV1::from(SourceBindingError::TrustedClockMismatch),
            SourceBindingAdmissionErrorV1::ClockMismatch
        );
        assert_eq!(
            SourceBindingAdmissionErrorV1::from(SourceBindingError::BindingIdentityMismatch),
            SourceBindingAdmissionErrorV1::InvalidProposal,
            "a proposal fault is still the proposal's"
        );
    }

    /// Each proposal defect keeps its own name, and none reads as another's.
    #[rstest]
    #[case::unsupported_bar_timeframe(
        SourceBindingError::UnsupportedBarTimeframe,
        SourceBindingAdmissionErrorV1::BarTimeframeUnsupported
    )]
    #[case::missing_field(
        SourceBindingError::MissingField("dataset_mapping"),
        SourceBindingAdmissionErrorV1::FieldMissing("dataset_mapping")
    )]
    #[case::zero_digest(
        SourceBindingError::ZeroDigest("implementation_digest"),
        SourceBindingAdmissionErrorV1::DigestZero("implementation_digest")
    )]
    #[case::invalid_version(
        SourceBindingError::InvalidVersionOrSequence("schema_version"),
        SourceBindingAdmissionErrorV1::VersionInvalid("schema_version")
    )]
    #[case::raw_credential_material(
        SourceBindingError::RawCredentialMaterial,
        SourceBindingAdmissionErrorV1::RawCredentialMaterial
    )]
    #[case::credential_audience(
        SourceBindingError::InvalidCredentialAudience,
        SourceBindingAdmissionErrorV1::CredentialAudienceInvalid
    )]
    #[case::credential_capability(
        SourceBindingError::ForbiddenCredentialCapability,
        SourceBindingAdmissionErrorV1::CredentialCapabilityForbidden
    )]
    #[case::time_evidence(
        SourceBindingError::InvalidTimeEvidence,
        SourceBindingAdmissionErrorV1::TimeEvidenceInvalid
    )]
    #[case::time_evidence_after_cut(
        SourceBindingError::TimeEvidenceAfterDecisionCut,
        SourceBindingAdmissionErrorV1::TimeEvidenceAfterDecisionCut
    )]
    #[case::time_evidence_identity(
        SourceBindingError::TimeEvidenceIdentityMismatch,
        SourceBindingAdmissionErrorV1::InvalidProposal
    )]
    #[case::locator(
        SourceBindingError::LocatorMismatch,
        SourceBindingAdmissionErrorV1::InvalidProposal
    )]
    #[case::successor_does_not_advance(
        SourceBindingError::SuccessorDoesNotAdvance,
        SourceBindingAdmissionErrorV1::AdmissionConflict
    )]
    #[case::response_lost(
        SourceBindingError::ResponseLost,
        SourceBindingAdmissionErrorV1::StoreUnavailable
    )]
    fn each_source_binding_refusal_is_admitted_under_its_own_name(
        #[case] error: SourceBindingError,
        #[case] expected: SourceBindingAdmissionErrorV1,
    ) {
        assert_eq!(SourceBindingAdmissionErrorV1::from(error), expected);
    }
}
