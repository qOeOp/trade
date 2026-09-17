//! The seam through which Market Data obtains its own observations for a PIT request.
//!
//! A requester submits a frozen PIT Market Snapshot Request and nothing else. The rows behind the
//! snapshot are retrieved here, by a Data Client the Owner composes, because the document gives
//! Data Clients the job of connecting official vendors and venues and gives no consumer the right
//! to supply normalized records for its own snapshot.
//!
//! A vendor observation carries only what a vendor can know: the symbolic key it was requested
//! under, the instrument and channel it belongs to, the measured value, and the four time
//! coordinates. It carries no Source Binding identity, no Instrument Master or Universe Selection
//! digest, no Market Semantics identity and no correction-frontier binding. Market Data stamps all
//! of those from the frozen request and its own native readback, so a vendor cannot place a value
//! under a binding it was never admitted for, and Market Data cannot invent a price.

use std::fmt::{Debug, Display};

use async_trait::async_trait;

/// The exact scope one retrieval must answer, derived from the frozen request.
///
/// The scope is issued by Market Data, never by the Data Client, so a client cannot widen its own
/// window, change the decision cut, or answer for a member the evaluated Universe Selection Record
/// does not contain. The members are the Owner's resolution of the requester's selection rule, not
/// the requester's own list.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PitObservationScopeV1 {
    members: Vec<String>,
    event_effective: u64,
    provider_available: u64,
    retrieval: u64,
    correction_publication: u64,
    decision_cut: u64,
}

impl PitObservationScopeV1 {
    /// Issues one scope.
    ///
    /// Market Data calls this on the run path. It is public so a Data Client can be exercised
    /// against an exact scope without a database; a constructed scope confers nothing, because a
    /// snapshot is minted only from the scope the Owner issued for a frozen request.
    #[must_use]
    pub fn from_owner_request(
        members: Vec<String>,
        event_effective: u64,
        provider_available: u64,
        retrieval: u64,
        correction_publication: u64,
        decision_cut: u64,
    ) -> Self {
        Self {
            members,
            event_effective,
            provider_available,
            retrieval,
            correction_publication,
            decision_cut,
        }
    }

    /// The universe members Market Data resolved for the frozen request.
    #[must_use]
    pub fn members(&self) -> &[String] {
        &self.members
    }

    /// The event-effective coordinate the snapshot is bound to.
    #[must_use]
    pub const fn event_effective(&self) -> u64 {
        self.event_effective
    }

    /// The provider-available coordinate the snapshot is bound to.
    #[must_use]
    pub const fn provider_available(&self) -> u64 {
        self.provider_available
    }

    /// The retrieval coordinate the snapshot is bound to.
    #[must_use]
    pub const fn retrieval(&self) -> u64 {
        self.retrieval
    }

    /// The correction-publication coordinate the snapshot is bound to.
    #[must_use]
    pub const fn correction_publication(&self) -> u64 {
        self.correction_publication
    }

    /// The exact decision cut. Nothing retrieved after it may enter the snapshot.
    #[must_use]
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }
}

/// One normalized observation as a vendor can state it.
///
/// Every field is a vendor fact. The Owner-side bindings are absent by construction rather than by
/// convention, so this type cannot be used to smuggle a binding claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VendorObservationV1 {
    /// The provider-facing key the value was requested under.
    pub symbolic_key: String,
    /// The universe member the value belongs to.
    pub member_key: String,
    /// The canonical instrument.
    pub instrument: String,
    /// The channel the value was carried on.
    pub channel: String,
    /// The data kind, such as a bar or a quote.
    pub data_kind: String,
    /// The timeframe the value aggregates.
    pub timeframe: String,
    /// The field the value measures.
    pub field: String,
    /// The value mantissa.
    pub value_mantissa: i128,
    /// The value scale.
    pub value_scale: u8,
    /// When the underlying event was effective.
    pub event_effective: u64,
    /// When the provider made it available.
    pub provider_available: u64,
    /// When this system retrieved it.
    pub retrieval: u64,
    /// When the correction that produced it was published.
    pub correction_publication: u64,
}

/// Why a retrieval could not answer the scope.
///
/// The categories stay bounded and carry no provider payload, endpoint or credential detail.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PitObservationSourceErrorV1 {
    /// The client could not reach the provider, or the provider refused the call.
    Unavailable,
    /// The provider answered, but not for the exact scope that was issued.
    ScopeMismatch,
    /// The provider answered with more than the Owner admits for one batch.
    CapacityExceeded,
}

impl Display for PitObservationSourceErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::Unavailable => "the observation source is unavailable",
            Self::ScopeMismatch => "the observation source answered a different scope",
            Self::CapacityExceeded => "the observation source exceeded the admitted batch size",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for PitObservationSourceErrorV1 {}

/// One Data Client that can answer an Owner-issued observation scope.
#[async_trait]
pub trait PitObservationSourceV1: Send + Sync {
    /// Retrieves every observation that was available at the scope's decision cut.
    ///
    /// # Errors
    ///
    /// Returns a bounded category. An empty answer is not an error: it becomes insufficient
    /// coverage, which the snapshot records as an explicit terminal negative.
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1>;
}
