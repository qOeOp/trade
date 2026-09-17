//! The Owner-sealed intake for historical membership and Universe Selection evaluation.
//!
//! A requester states a selection rule; Market Data evaluates it against the membership it holds
//! and returns the record. The requester never states members, because choosing the universe would
//! make the answer its own claim rather than the Owner's finding, and the document gives Market
//! Data rule evaluation while denying it the choice of a strategy universe.
//!
//! Membership itself arrives from Operations as effective-dated facts. Each fact carries the four
//! time coordinates that decide when it was observable, so a member admitted today cannot silently
//! become eligible for a cut that preceded its own evidence.

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    source_binding::BindingDigest,
    universe_selection::{
        UniverseSelectionErrorV1, UntrustedUniverseSelectionLocatorV1,
        UntrustedUniverseSelectionRequestV1,
    },
};

/// One effective-dated membership fact as Operations can state it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HistoricalMembershipSubmissionV1 {
    /// The member key the universe refers to it by.
    pub member_key: String,
    /// The canonical instrument behind that key.
    pub instrument: String,
    /// When the membership became effective.
    pub effective_from_ns: i128,
    /// When it stopped being effective, if it has.
    pub effective_until_ns: Option<i128>,
    /// When the provider made the fact available.
    pub provider_available_ns: i128,
    /// When this system retrieved it.
    pub retrieval_ns: i128,
    /// When the correction that produced it was published.
    pub correction_publication_ns: i128,
    /// When the Owner observed it.
    pub owner_observation_ns: i128,
    /// The decision cut the fact is bound to.
    pub decision_cut: u64,
    /// The Source Binding lineage the fact came through.
    pub source_binding_lineage_root: BindingDigest,
    /// The correction frontier the fact was observed at.
    pub correction_frontier_digest: BindingDigest,
}

/// One complete membership submission for a single eligible-instrument frontier.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HistoricalMembershipAdmissionRequestV1 {
    /// The frontier these facts constitute.
    pub eligible_instrument_frontier: BindingDigest,
    /// Every member of that frontier. A frontier is admitted whole or not at all.
    pub members: Vec<HistoricalMembershipSubmissionV1>,
}

/// The sealed record identity one evaluation resolved to.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UniverseSelectionTerminalV1 {
    request_identity: BindingDigest,
    request_meaning_digest: BindingDigest,
    selection_identity: BindingDigest,
    member_count: u64,
}

impl UniverseSelectionTerminalV1 {
    pub(crate) const fn seal(
        request_identity: BindingDigest,
        request_meaning_digest: BindingDigest,
        selection_identity: BindingDigest,
        member_count: u64,
    ) -> Self {
        Self {
            request_identity,
            request_meaning_digest,
            selection_identity,
            member_count,
        }
    }

    /// The exact request identity this record answers.
    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    /// The exact request meaning digest this record answers.
    #[must_use]
    pub const fn request_meaning_digest(&self) -> BindingDigest {
        self.request_meaning_digest
    }

    /// The record identity a PIT request must name as its universe selection digest.
    #[must_use]
    pub const fn selection_identity(&self) -> BindingDigest {
        self.selection_identity
    }

    /// How many members the Owner selected.
    #[must_use]
    pub const fn member_count(&self) -> u64 {
        self.member_count
    }
}

/// Why an admission or evaluation reached no record.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UniverseSelectionAdmissionErrorV1 {
    /// The submission or request is malformed.
    InvalidRequest,
    /// The frontier or record is already bound to different content.
    RequestConflict,
    /// The named frontier or record is not held.
    UnknownIdentity,
    /// The Owner store is unreachable or refused the commit.
    StoreUnavailable,
}

impl Display for UniverseSelectionAdmissionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidRequest => "the universe selection submission is malformed",
            Self::RequestConflict => "the identity is bound to different content",
            Self::UnknownIdentity => "the named frontier or record is not held",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for UniverseSelectionAdmissionErrorV1 {}

impl From<UniverseSelectionErrorV1> for UniverseSelectionAdmissionErrorV1 {
    fn from(error: UniverseSelectionErrorV1) -> Self {
        match error {
            UniverseSelectionErrorV1::StoreUnavailable
            | UniverseSelectionErrorV1::StoreUntrusted => Self::StoreUnavailable,
            UniverseSelectionErrorV1::RequestConflict => Self::RequestConflict,
            UniverseSelectionErrorV1::UnknownIdentity => Self::UnknownIdentity,
            _ => Self::InvalidRequest,
        }
    }
}

/// The sealed production intake for membership and universe evaluation.
#[async_trait]
pub trait UniverseSelectionAdmissionV1: Send + Sync + sealed::Sealed {
    /// Admits one complete eligible-instrument frontier.
    ///
    /// # Errors
    ///
    /// Returns a bounded category. A frontier is admitted whole or not at all.
    async fn admit_membership(
        &self,
        request: HistoricalMembershipAdmissionRequestV1,
    ) -> Result<(), UniverseSelectionAdmissionErrorV1>;

    /// Evaluates one requester-owned selection rule against admitted membership.
    ///
    /// # Errors
    ///
    /// Returns a bounded category. Re-evaluating the same request joins the same record.
    async fn evaluate(
        &self,
        request: UntrustedUniverseSelectionRequestV1,
    ) -> Result<UniverseSelectionTerminalV1, UniverseSelectionAdmissionErrorV1>;

    /// Recovers the record one locator names.
    ///
    /// # Errors
    ///
    /// Returns a bounded category.
    async fn recover(
        &self,
        locator: UntrustedUniverseSelectionLocatorV1,
    ) -> Result<UniverseSelectionTerminalV1, UniverseSelectionAdmissionErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured Market Data universe-selection intake.
///
/// The deployment configuration root chooses the database through
/// `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn universe_selection_admission_from_environment_v1()
-> Result<Arc<dyn UniverseSelectionAdmissionV1>, UniverseSelectionAdmissionErrorV1> {
    super::postgres::universe_selection_admission_from_environment_v1().await
}
