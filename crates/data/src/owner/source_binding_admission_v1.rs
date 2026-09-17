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
    /// The proposal is malformed, or its claimed identity does not derive from its content.
    InvalidProposal,
    /// The same binding identity is already bound to a different decision.
    AdmissionConflict,
    /// The Owner could not mint a decision cut.
    ClockUnavailable,
    /// The Owner store is unreachable or refused the commit.
    StoreUnavailable,
}

impl Display for SourceBindingAdmissionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidProposal => "the Source Binding proposal is malformed",
            Self::AdmissionConflict => "the binding identity is bound to a different decision",
            Self::ClockUnavailable => "Market Data could not mint a decision cut",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for SourceBindingAdmissionErrorV1 {}

impl From<SourceBindingError> for SourceBindingAdmissionErrorV1 {
    fn from(error: SourceBindingError) -> Self {
        match error {
            SourceBindingError::ReplayConflict | SourceBindingError::LineageHeadMismatch => {
                Self::AdmissionConflict
            }
            SourceBindingError::StoreUnavailable | SourceBindingError::CommitInterrupted => {
                Self::StoreUnavailable
            }
            _ => Self::InvalidProposal,
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
