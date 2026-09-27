//! The Owner-sealed intake through which Operations admits one instrument's Instrument Master V2
//! baseline.
//!
//! Operations retrieves `exchangeInfo`; Market Data derives the fact. The submission carries the
//! exact payload text, the raw symbol, the class word, the retrieval instant and the admitted Source
//! Binding the payload was retrieved under, and nothing the Owner can derive: no canonical identity,
//! venue, term, effective instant, digest or Owner-observation instant. The Owner selects its venue
//! row by the binding's exact dataset mapping, derives the baseline through
//! [`ExchangeInfoBaselineV2::from_usdm_exchange_info`], stamps its own clock head's decision cut as
//! the Owner observation, and appends the fact as the instrument's first, so the request-keyed V2
//! cut can resolve it.
//!
//! It also admits a raw `!contractInfo` event for an instrument that already has a fact, as that
//! fact's direct successor. The event changes the contract status only: the delta grammar admits
//! no other member, so tick, step, lot, multiplier, limits, currencies and inverse semantics stay
//! the baseline's, and a status delta is not a correction of a baseline's terms.
//!
//! And it admits a later raw `exchangeInfo` snapshot of an instrument that already has a fact, as
//! that fact's direct successor: the terms the snapshot states, derived by the baseline's own
//! mapping, and its contract status when the snapshot is the newest status evidence. When the
//! Owner's clock head has not reached the snapshot's retrieval, the admission advances the head
//! itself, as a Source Binding admission does.
//!
//! [`ExchangeInfoBaselineV2::from_usdm_exchange_info`]:
//! super::instrument_master_v2::ExchangeInfoBaselineV2::from_usdm_exchange_info

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    instrument_master_v2::{
        ContractInfoNormalizationErrorV2, ExchangeInfoNormalizationErrorV2,
        ExchangeInfoSnapshotNormalizationErrorV2, InstrumentMasterV2Error, InstrumentTermsBasisV2,
    },
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
};

/// The class word this intake admits: V2 has one class.
const CRYPTO_PERPETUAL_WORD: &str = "CRYPTO_PERPETUAL";

/// The Instrument Master V2 baseline Operations submits.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentMasterBaselineSubmissionV2 {
    /// The venue's own symbol, for example `BTCUSDT`, compared byte for byte with the payload.
    pub raw_symbol: String,
    /// Instrument class by its canonical word; only `CRYPTO_PERPETUAL` is admitted.
    pub instrument_class: String,
    /// When Operations retrieved the payload, in nanoseconds.
    pub retrieval_time_ns: i128,
    /// The exact `exchangeInfo` response text. The Owner digests its UTF-8 bytes.
    pub raw_payload: String,
    /// The admitted Source Binding the payload was retrieved under.
    pub source_binding: UntrustedSourceBindingLocator,
}

impl InstrumentMasterBaselineSubmissionV2 {
    /// Whether the class word is the one this intake admits.
    pub(crate) fn names_the_admitted_class(&self) -> bool {
        self.instrument_class == CRYPTO_PERPETUAL_WORD
    }
}

/// The public disposition of one admitted baseline.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InstrumentMasterAdmissionDispositionV2 {
    /// The baseline is the instrument's first fact.
    Admitted,
}

/// The temporal basis of the admitted terms, as the wire names it.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InstrumentTermsBasisWireV2 {
    /// Terms observed at retrieval and assumed back to the listing.
    RetrievedTermsAssumedSinceListing,
    /// Terms a later snapshot observed to differ from the baseline's, at that snapshot or after it.
    ObservedSinceTermsChange,
}

impl From<InstrumentTermsBasisV2> for InstrumentTermsBasisWireV2 {
    fn from(basis: InstrumentTermsBasisV2) -> Self {
        match basis {
            InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing => {
                Self::RetrievedTermsAssumedSinceListing
            }
            InstrumentTermsBasisV2::ObservedSinceTermsChange => Self::ObservedSinceTermsChange,
        }
    }
}

/// What Operations learns about the baseline the Owner admitted.
///
/// Everything here is in the stored fact, so a replay, which rejoins that fact, returns the same
/// terminal even after the clock has advanced.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InstrumentMasterAdmissionTerminalV2 {
    canonical_identity: String,
    fact_identity: BindingDigest,
    owner_observation_time_ns: i128,
    terms_basis: InstrumentTermsBasisWireV2,
    disposition: InstrumentMasterAdmissionDispositionV2,
}

impl InstrumentMasterAdmissionTerminalV2 {
    pub(crate) fn seal(
        canonical_identity: String,
        fact_identity: BindingDigest,
        owner_observation_time_ns: i128,
        terms_basis: InstrumentTermsBasisV2,
    ) -> Self {
        Self {
            canonical_identity,
            fact_identity,
            owner_observation_time_ns,
            terms_basis: terms_basis.into(),
            disposition: InstrumentMasterAdmissionDispositionV2::Admitted,
        }
    }

    /// The canonical identity the Owner derived.
    #[must_use]
    pub fn canonical_identity(&self) -> &str {
        &self.canonical_identity
    }

    /// The admitted fact's identity.
    #[must_use]
    pub const fn fact_identity(&self) -> BindingDigest {
        self.fact_identity
    }

    /// The Owner-observation instant the fact holds: the decision cut of the clock head it was
    /// admitted under.
    #[must_use]
    pub const fn owner_observation_time_ns(&self) -> i128 {
        self.owner_observation_time_ns
    }

    /// The basis of the admitted terms.
    #[must_use]
    pub const fn terms_basis(&self) -> InstrumentTermsBasisWireV2 {
        self.terms_basis
    }

    /// The disposition, which is always `ADMITTED` once a terminal exists.
    #[must_use]
    pub const fn disposition(&self) -> InstrumentMasterAdmissionDispositionV2 {
        self.disposition
    }
}

/// Why an admission reached no fact. Each is one documented refusal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterAdmissionErrorV2 {
    /// The payload is not a JSON `exchangeInfo`, or the derived fact fails its own validation.
    InvalidSubmission,
    /// The class word is not `CRYPTO_PERPETUAL`.
    UnsupportedClass,
    /// The named binding's dataset mapping has no row in the Owner's venue table.
    UnsupportedVenue,
    /// No `symbols` entry has the raw symbol.
    SymbolAbsent,
    /// More than one entry has it.
    SymbolAmbiguous,
    /// The entry's `contractType` is not `PERPETUAL`.
    ContractTypeUnsupported,
    /// The entry carries `contractSize`, contradicting the binding's dataset.
    DatasetMismatch,
    /// The entry has no `onboardDate`, or it is later than the retrieval.
    OnboardDateUnavailable,
    /// A required filter or field is absent, repeated, or not an accepted decimal.
    FilterUnavailable,
    /// No binding is admitted under exactly the named locator.
    SourceBindingUnavailable,
    /// The retrieval is later than the current clock head's decision cut.
    RetrievalAfterOwnerClock,
    /// The instrument already has a baseline with another meaning.
    BaselineExists,
    /// The Owner holds no clock head.
    ClockUnavailable,
    /// A fact with the computed identity is stored with other bytes.
    AdmissionConflict,
    /// The store is unreachable, refused the commit, or failed its ownership assertion.
    StoreUnavailable,
}

impl Display for InstrumentMasterAdmissionErrorV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidSubmission => "the Instrument Master V2 submission is invalid",
            Self::UnsupportedClass => "only the crypto perpetual class is admitted",
            Self::UnsupportedVenue => "the binding's dataset has no row in the venue table",
            Self::SymbolAbsent => "no exchangeInfo entry has the raw symbol",
            Self::SymbolAmbiguous => "more than one exchangeInfo entry has the raw symbol",
            Self::ContractTypeUnsupported => "the entry's contract type is not PERPETUAL",
            Self::DatasetMismatch => "the entry's shape contradicts the binding's dataset",
            Self::OnboardDateUnavailable => "the entry has no onboard date before the retrieval",
            Self::FilterUnavailable => "a required filter or field is absent or malformed",
            Self::SourceBindingUnavailable => {
                "no admitted Source Binding is stored under the submitted locator"
            }
            Self::RetrievalAfterOwnerClock => {
                "the retrieval is later than the Owner's current decision cut"
            }
            Self::BaselineExists => "the instrument already has a baseline with another meaning",
            Self::ClockUnavailable => "Market Data holds no canonical clock head",
            Self::AdmissionConflict => "the fact identity is stored with different content",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for InstrumentMasterAdmissionErrorV2 {}

impl From<ExchangeInfoNormalizationErrorV2> for InstrumentMasterAdmissionErrorV2 {
    fn from(error: ExchangeInfoNormalizationErrorV2) -> Self {
        match error {
            ExchangeInfoNormalizationErrorV2::NotExchangeInfo => Self::InvalidSubmission,
            ExchangeInfoNormalizationErrorV2::SymbolAbsent => Self::SymbolAbsent,
            ExchangeInfoNormalizationErrorV2::SymbolAmbiguous => Self::SymbolAmbiguous,
            ExchangeInfoNormalizationErrorV2::ContractTypeUnsupported => {
                Self::ContractTypeUnsupported
            }
            ExchangeInfoNormalizationErrorV2::DatasetMismatch => Self::DatasetMismatch,
            ExchangeInfoNormalizationErrorV2::OnboardDateUnavailable => {
                Self::OnboardDateUnavailable
            }
            ExchangeInfoNormalizationErrorV2::FilterUnavailable => Self::FilterUnavailable,
        }
    }
}

impl From<InstrumentMasterV2Error> for InstrumentMasterAdmissionErrorV2 {
    fn from(_: InstrumentMasterV2Error) -> Self {
        Self::InvalidSubmission
    }
}

/// One raw `!contractInfo` event Operations submits for an instrument that already has a fact.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentMasterStatusDeltaSubmissionV2 {
    /// The fact the event follows, as a baseline or an earlier delta terminal returned it.
    pub predecessor_fact_identity: BindingDigest,
    /// When Operations received the event, in nanoseconds.
    pub retrieval_time_ns: i128,
    /// The exact event text. The Owner digests its UTF-8 bytes.
    pub raw_payload: String,
    /// The admitted Source Binding the event was received under: the instrument's baseline's.
    pub source_binding: UntrustedSourceBindingLocator,
}

/// What Operations learns about the status delta the Owner admitted.
///
/// Everything here is in the stored fact, so a replay, which rejoins that fact, returns the same
/// terminal after later deltas and after the clock has advanced.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InstrumentMasterStatusDeltaTerminalV2 {
    canonical_identity: String,
    fact_identity: BindingDigest,
    predecessor_fact_identity: BindingDigest,
    correction_sequence: u64,
    contract_status: String,
    owner_observation_time_ns: i128,
    terms_basis: InstrumentTermsBasisWireV2,
    disposition: InstrumentMasterAdmissionDispositionV2,
}

impl InstrumentMasterStatusDeltaTerminalV2 {
    #[allow(
        clippy::too_many_arguments,
        reason = "each argument is one stored field of the admitted fact"
    )]
    pub(crate) fn seal(
        canonical_identity: String,
        fact_identity: BindingDigest,
        predecessor_fact_identity: BindingDigest,
        correction_sequence: u64,
        contract_status: String,
        owner_observation_time_ns: i128,
        terms_basis: InstrumentTermsBasisV2,
    ) -> Self {
        Self {
            canonical_identity,
            fact_identity,
            predecessor_fact_identity,
            correction_sequence,
            contract_status,
            owner_observation_time_ns,
            terms_basis: terms_basis.into(),
            disposition: InstrumentMasterAdmissionDispositionV2::Admitted,
        }
    }

    /// The instrument's canonical identity.
    #[must_use]
    pub fn canonical_identity(&self) -> &str {
        &self.canonical_identity
    }

    /// The admitted fact's identity, which the next delta names.
    #[must_use]
    pub const fn fact_identity(&self) -> BindingDigest {
        self.fact_identity
    }

    /// The fact it directly follows.
    #[must_use]
    pub const fn predecessor_fact_identity(&self) -> BindingDigest {
        self.predecessor_fact_identity
    }

    /// Its position in the instrument's chain; the baseline is 1.
    #[must_use]
    pub const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }

    /// The contract status the event states, verbatim.
    #[must_use]
    pub fn contract_status(&self) -> &str {
        &self.contract_status
    }

    /// The Owner-observation instant the fact holds.
    #[must_use]
    pub const fn owner_observation_time_ns(&self) -> i128 {
        self.owner_observation_time_ns
    }

    /// The basis of its terms, which a status delta inherits from the baseline unchanged.
    #[must_use]
    pub const fn terms_basis(&self) -> InstrumentTermsBasisWireV2 {
        self.terms_basis
    }

    /// The disposition, which is always `ADMITTED` once a terminal exists.
    #[must_use]
    pub const fn disposition(&self) -> InstrumentMasterAdmissionDispositionV2 {
        self.disposition
    }
}

/// Why a status delta reached no fact. Each is one documented refusal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterStatusDeltaErrorV2 {
    /// The text is not a `contractInfo` event the fact can take, or its `E` or `cs` is unusable.
    InvalidEvent,
    /// `s` is not the fact's raw symbol.
    EventSymbolMismatch,
    /// `ct` is not `PERPETUAL`.
    ContractTypeUnsupported,
    /// `st` is present and is not `1`.
    DatasetMismatch,
    /// The event instant is later than the retrieval.
    EventAfterRetrieval,
    /// `cs` is the fact's current status.
    StatusUnchanged,
    /// The event instant is not later than the named fact's latest event instant.
    EventOutOfOrder,
    /// No V2 fact has the named identity.
    PredecessorUnknown,
    /// The named fact already has a successor with another meaning.
    PredecessorNotCurrent,
    /// No binding is admitted under exactly the named locator.
    SourceBindingUnavailable,
    /// The binding is admitted but is not the one the instrument's baseline names.
    SourceBindingMismatch,
    /// The retrieval is later than the current clock head's decision cut.
    RetrievalAfterOwnerClock,
    /// The Owner holds no clock head.
    ClockUnavailable,
    /// A fact with the computed identity is stored with other bytes, or the head is behind the
    /// named fact's Owner observation.
    AdmissionConflict,
    /// The store is unreachable, refused the commit, or failed its ownership assertion.
    StoreUnavailable,
}

impl Display for InstrumentMasterStatusDeltaErrorV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidEvent => "the contractInfo event is invalid",
            Self::EventSymbolMismatch => "the event is for another symbol than the fact's",
            Self::ContractTypeUnsupported => "the event's contract type is not PERPETUAL",
            Self::DatasetMismatch => "the event's system contradicts the baseline's dataset",
            Self::EventAfterRetrieval => "the event is later than its retrieval",
            Self::StatusUnchanged => "the event states the fact's current status",
            Self::EventOutOfOrder => "the event is not later than the fact's latest event",
            Self::PredecessorUnknown => "no Instrument Master V2 fact has the named identity",
            Self::PredecessorNotCurrent => "the named fact already has another successor",
            Self::SourceBindingUnavailable => {
                "no admitted Source Binding is stored under the submitted locator"
            }
            Self::SourceBindingMismatch => "the binding is not the one the baseline names",
            Self::RetrievalAfterOwnerClock => {
                "the retrieval is later than the Owner's current decision cut"
            }
            Self::ClockUnavailable => "Market Data holds no canonical clock head",
            Self::AdmissionConflict => "the fact conflicts with what the store holds",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for InstrumentMasterStatusDeltaErrorV2 {}

impl From<ContractInfoNormalizationErrorV2> for InstrumentMasterStatusDeltaErrorV2 {
    fn from(error: ContractInfoNormalizationErrorV2) -> Self {
        match error {
            ContractInfoNormalizationErrorV2::InvalidEvent => Self::InvalidEvent,
            ContractInfoNormalizationErrorV2::SymbolMismatch => Self::EventSymbolMismatch,
            ContractInfoNormalizationErrorV2::ContractTypeUnsupported => {
                Self::ContractTypeUnsupported
            }
            ContractInfoNormalizationErrorV2::DatasetMismatch => Self::DatasetMismatch,
            ContractInfoNormalizationErrorV2::EventAfterRetrieval => Self::EventAfterRetrieval,
            ContractInfoNormalizationErrorV2::EventOutOfOrder => Self::EventOutOfOrder,
            ContractInfoNormalizationErrorV2::StatusUnchanged => Self::StatusUnchanged,
        }
    }
}

impl From<InstrumentMasterV2Error> for InstrumentMasterStatusDeltaErrorV2 {
    /// What `apply_contract_info_delta` can still refuse once the event is normalized. A status
    /// text the fact cannot hold is the event's. Every other refusal is the store disagreeing with
    /// itself: the delta is built from the named fact, so its instrument, binding, prior event and
    /// sequence are that fact's, and the head is behind the named fact's observation only if a
    /// stored row was altered.
    fn from(error: InstrumentMasterV2Error) -> Self {
        match error {
            InstrumentMasterV2Error::InvalidIdentity => Self::InvalidEvent,
            InstrumentMasterV2Error::TimeRegression
            | InstrumentMasterV2Error::InvalidDecimal
            | InstrumentMasterV2Error::InvalidProvenance
            | InstrumentMasterV2Error::InvalidDelta
            | InstrumentMasterV2Error::InstrumentMismatch
            | InstrumentMasterV2Error::SourceBindingMismatch
            | InstrumentMasterV2Error::SourceEventPredecessorMismatch
            | InstrumentMasterV2Error::CorrectionSequenceMismatch
            | InstrumentMasterV2Error::SuccessorMismatch
            | InstrumentMasterV2Error::CodecMismatch => Self::AdmissionConflict,
        }
    }
}

/// One later raw `exchangeInfo` snapshot of an instrument that already has a fact.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentMasterSnapshotSubmissionV2 {
    /// The fact the snapshot follows: the instrument's current head, as a terminal returned it.
    pub predecessor_fact_identity: BindingDigest,
    /// When the snapshot was retrieved, in nanoseconds.
    pub retrieval_time_ns: i128,
    /// The exact `exchangeInfo` text. The Owner digests its UTF-8 bytes.
    pub raw_payload: String,
    /// The admitted Source Binding it was retrieved under: the instrument's baseline's.
    pub source_binding: UntrustedSourceBindingLocator,
}

/// What the submitter learns about the snapshot the Owner admitted.
///
/// Everything here is in the stored fact or follows from it and the fact it follows, so a replay,
/// which rejoins that fact, returns the same terminal.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InstrumentMasterSnapshotTerminalV2 {
    canonical_identity: String,
    fact_identity: BindingDigest,
    predecessor_fact_identity: BindingDigest,
    correction_sequence: u64,
    contract_status: String,
    terms_changed: bool,
    owner_observation_time_ns: i128,
    terms_basis: InstrumentTermsBasisWireV2,
    disposition: InstrumentMasterAdmissionDispositionV2,
}

impl InstrumentMasterSnapshotTerminalV2 {
    #[allow(
        clippy::too_many_arguments,
        reason = "each argument is one stored field of the admitted fact"
    )]
    pub(crate) fn seal(
        canonical_identity: String,
        fact_identity: BindingDigest,
        predecessor_fact_identity: BindingDigest,
        correction_sequence: u64,
        contract_status: String,
        terms_changed: bool,
        owner_observation_time_ns: i128,
        terms_basis: InstrumentTermsBasisV2,
    ) -> Self {
        Self {
            canonical_identity,
            fact_identity,
            predecessor_fact_identity,
            correction_sequence,
            contract_status,
            terms_changed,
            owner_observation_time_ns,
            terms_basis: terms_basis.into(),
            disposition: InstrumentMasterAdmissionDispositionV2::Admitted,
        }
    }

    /// The instrument's canonical identity.
    #[must_use]
    pub fn canonical_identity(&self) -> &str {
        &self.canonical_identity
    }

    /// The admitted fact's identity, which the next successor names.
    #[must_use]
    pub const fn fact_identity(&self) -> BindingDigest {
        self.fact_identity
    }

    /// The fact it directly follows.
    #[must_use]
    pub const fn predecessor_fact_identity(&self) -> BindingDigest {
        self.predecessor_fact_identity
    }

    /// Its position in the instrument's chain; the baseline is 1.
    #[must_use]
    pub const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }

    /// The fact's contract status: the snapshot's when it is the newest status evidence.
    #[must_use]
    pub fn contract_status(&self) -> &str {
        &self.contract_status
    }

    /// Whether the snapshot's terms, the contract status aside, differ from the fact it follows.
    #[must_use]
    pub const fn terms_changed(&self) -> bool {
        self.terms_changed
    }

    /// The Owner-observation instant the fact holds.
    #[must_use]
    pub const fn owner_observation_time_ns(&self) -> i128 {
        self.owner_observation_time_ns
    }

    /// The basis of its terms.
    #[must_use]
    pub const fn terms_basis(&self) -> InstrumentTermsBasisWireV2 {
        self.terms_basis
    }

    /// The disposition, which is always `ADMITTED` once a terminal exists.
    #[must_use]
    pub const fn disposition(&self) -> InstrumentMasterAdmissionDispositionV2 {
        self.disposition
    }
}

/// Why a snapshot reached no fact. Each is one documented refusal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterSnapshotErrorV2 {
    /// The payload is not a JSON `exchangeInfo`, or the derived fact fails its own validation.
    InvalidSubmission,
    /// No `symbols` entry has the fact's raw symbol.
    SymbolAbsent,
    /// More than one entry has it.
    SymbolAmbiguous,
    /// The entry's `contractType` is not `PERPETUAL`.
    ContractTypeUnsupported,
    /// The entry carries `contractSize`, contradicting the baseline's dataset.
    DatasetMismatch,
    /// The entry has no `onboardDate`, or it is later than the retrieval.
    OnboardDateUnavailable,
    /// A required filter or field is absent, repeated, or not an accepted decimal.
    FilterUnavailable,
    /// The entry's `onboardDate` is not the baseline's: another listing.
    ListingDiffers,
    /// The retrieval is not later than the fact's latest snapshot, or its baseline.
    SnapshotOutOfOrder,
    /// No V2 fact has the named identity.
    PredecessorUnknown,
    /// The named fact already has a successor with another meaning.
    PredecessorNotCurrent,
    /// No binding is admitted under exactly the named locator.
    SourceBindingUnavailable,
    /// The binding is admitted but is not the one the instrument's baseline names.
    SourceBindingMismatch,
    /// The retrieval is later than the Owner's own wall observation.
    RetrievalAfterOwnerClock,
    /// The Owner holds no clock head, or its wall clock has not moved past the head.
    ClockUnavailable,
    /// The head is not one the Owner's clock can succeed.
    ClockMismatch,
    /// A fact with the computed identity is stored with other bytes, or the store disagrees with
    /// itself about the named fact.
    AdmissionConflict,
    /// The store is unreachable, refused the commit, or failed its ownership assertion.
    StoreUnavailable,
}

impl Display for InstrumentMasterSnapshotErrorV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidSubmission => "the Instrument Master V2 snapshot is invalid",
            Self::SymbolAbsent => "no exchangeInfo entry has the fact's raw symbol",
            Self::SymbolAmbiguous => "more than one exchangeInfo entry has the raw symbol",
            Self::ContractTypeUnsupported => "the entry's contract type is not PERPETUAL",
            Self::DatasetMismatch => "the entry's shape contradicts the baseline's dataset",
            Self::OnboardDateUnavailable => "the entry has no onboard date before the retrieval",
            Self::FilterUnavailable => "a required filter or field is absent or malformed",
            Self::ListingDiffers => "the entry's onboard date is not the baseline's",
            Self::SnapshotOutOfOrder => "the snapshot is not later than the fact's latest one",
            Self::PredecessorUnknown => "no Instrument Master V2 fact has the named identity",
            Self::PredecessorNotCurrent => "the named fact already has another successor",
            Self::SourceBindingUnavailable => {
                "no admitted Source Binding is stored under the submitted locator"
            }
            Self::SourceBindingMismatch => "the binding is not the one the baseline names",
            Self::RetrievalAfterOwnerClock => {
                "the retrieval is later than the Owner's own wall observation"
            }
            Self::ClockUnavailable => "Market Data cannot mint a clock past its current head",
            Self::ClockMismatch => "the current clock head is not one the Owner's clock succeeds",
            Self::AdmissionConflict => "the fact conflicts with what the store holds",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for InstrumentMasterSnapshotErrorV2 {}

impl From<ExchangeInfoSnapshotNormalizationErrorV2> for InstrumentMasterSnapshotErrorV2 {
    fn from(error: ExchangeInfoSnapshotNormalizationErrorV2) -> Self {
        use ExchangeInfoNormalizationErrorV2 as Payload;

        match error {
            ExchangeInfoSnapshotNormalizationErrorV2::Payload(payload) => match payload {
                Payload::NotExchangeInfo => Self::InvalidSubmission,
                Payload::SymbolAbsent => Self::SymbolAbsent,
                Payload::SymbolAmbiguous => Self::SymbolAmbiguous,
                Payload::ContractTypeUnsupported => Self::ContractTypeUnsupported,
                Payload::DatasetMismatch => Self::DatasetMismatch,
                Payload::OnboardDateUnavailable => Self::OnboardDateUnavailable,
                Payload::FilterUnavailable => Self::FilterUnavailable,
            },
            ExchangeInfoSnapshotNormalizationErrorV2::ListingDiffers => Self::ListingDiffers,
            ExchangeInfoSnapshotNormalizationErrorV2::SnapshotOutOfOrder => {
                Self::SnapshotOutOfOrder
            }
        }
    }
}

impl From<InstrumentMasterV2Error> for InstrumentMasterSnapshotErrorV2 {
    /// What `apply_exchange_info_snapshot` can still refuse once the payload is normalized. Terms
    /// the fact cannot hold are the payload's. Every other refusal is the store disagreeing with
    /// itself: the successor is built from the named fact and a binding already checked to be the
    /// baseline's, and its observation is a head at or past the named fact's.
    fn from(error: InstrumentMasterV2Error) -> Self {
        match error {
            InstrumentMasterV2Error::InvalidIdentity | InstrumentMasterV2Error::InvalidDecimal => {
                Self::InvalidSubmission
            }
            InstrumentMasterV2Error::TimeRegression
            | InstrumentMasterV2Error::InvalidProvenance
            | InstrumentMasterV2Error::InvalidDelta
            | InstrumentMasterV2Error::InstrumentMismatch
            | InstrumentMasterV2Error::SourceBindingMismatch
            | InstrumentMasterV2Error::SourceEventPredecessorMismatch
            | InstrumentMasterV2Error::CorrectionSequenceMismatch
            | InstrumentMasterV2Error::SuccessorMismatch
            | InstrumentMasterV2Error::CodecMismatch => Self::AdmissionConflict,
        }
    }
}

/// The sealed production admission. Operations reaches it; no consumer can implement it.
#[async_trait]
pub trait InstrumentMasterAdmissionV2: Send + Sync + sealed::Sealed {
    /// Admits one instrument's baseline under the Owner's current clock head, or refuses it.
    ///
    /// # Errors
    ///
    /// Returns one documented refusal only when Market Data admitted nothing. A replayed
    /// submission of an already admitted baseline is not an error: it rejoins the same fact.
    async fn admit_baseline(
        &self,
        submission: InstrumentMasterBaselineSubmissionV2,
    ) -> Result<InstrumentMasterAdmissionTerminalV2, InstrumentMasterAdmissionErrorV2>;

    /// Admits one `!contractInfo` status delta as the named fact's direct successor under the
    /// Owner's current clock head, or refuses it.
    ///
    /// # Errors
    ///
    /// Returns one documented refusal only when Market Data admitted nothing. A replayed
    /// submission of an already admitted delta is not an error: it rejoins the same fact.
    async fn admit_status_delta(
        &self,
        submission: InstrumentMasterStatusDeltaSubmissionV2,
    ) -> Result<InstrumentMasterStatusDeltaTerminalV2, InstrumentMasterStatusDeltaErrorV2>;

    /// Admits one later `exchangeInfo` snapshot as the named fact's direct successor, advancing
    /// the Owner's clock head first when the head has not reached its retrieval, or refuses it.
    ///
    /// # Errors
    ///
    /// Returns one documented refusal only when Market Data admitted nothing. A replayed
    /// submission of an already admitted snapshot is not an error: it rejoins the same fact.
    async fn admit_snapshot(
        &self,
        submission: InstrumentMasterSnapshotSubmissionV2,
    ) -> Result<InstrumentMasterSnapshotTerminalV2, InstrumentMasterSnapshotErrorV2>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured Instrument Master V2 admission.
///
/// The deployment configuration root chooses the database through
/// `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn instrument_master_admission_from_environment_v2()
-> Result<Arc<dyn InstrumentMasterAdmissionV2>, InstrumentMasterAdmissionErrorV2> {
    super::postgres::instrument_master_admission_from_environment_v2().await
}

impl Debug for dyn InstrumentMasterAdmissionV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("InstrumentMasterAdmissionV2")
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn locator() -> UntrustedSourceBindingLocator {
        use crate::owner::source_binding::{
            UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
            UntrustedCredentialCapabilityClaim, UntrustedMarketDataAsOf,
            UntrustedSourceBindingLocatorFields,
        };

        let digest = |byte: u8| BindingDigest::from_untrusted_bytes([byte; 32]);
        let frontier = |byte: u8| UntrustedCompleteFrontier {
            stream_identity: "test/stream".to_owned(),
            cut_identity: "test/stream/cut-1".to_owned(),
            sequence: 1,
            digest: digest(byte),
        };
        UntrustedSourceBindingLocator::from_untrusted(UntrustedSourceBindingLocatorFields {
            owner: "MARKET_DATA_OWNER_V1".to_owned(),
            lineage_root: digest(20),
            lineage_version: 1,
            predecessor_binding_id: None,
            predecessor_fact_digest: None,
            binding_id: digest(21),
            fact_digest: digest(22),
            credential_handle_identity: digest(23),
            credential_audience: UntrustedCredentialAudienceClaim::MarketData,
            credential_capabilities: [UntrustedCredentialCapabilityClaim::MarketDataRead]
                .into_iter()
                .collect(),
            source_frontier: frontier(24),
            correction_frontier: frontier(25),
            time_evidence: UntrustedMarketDataAsOf {
                claimed_evidence_identity: digest(26),
                clock_identity: "TEST-CLOCK".to_owned(),
                clock_epoch: "TEST-EPOCH".to_owned(),
                monotonic_sequence: 7,
                restart_continuity_digest: digest(9),
                skew_bound: 1,
                uncertainty_bound: 1,
                event_effective: 1,
                provider_available: 1,
                retrieval: 1,
                correction_publication: 1,
                observed_at: 1,
                effective_at: 1,
                valid_through: 2,
            },
        })
    }

    fn body(extra: &str) -> String {
        format!(
            r#"{{"raw_symbol":"BTCUSDT","instrument_class":"CRYPTO_PERPETUAL","retrieval_time_ns":1,"raw_payload":"{{}}","source_binding":{source}{extra}}}"#,
            source = serde_json::to_string(&locator()).unwrap(),
        )
    }

    /// A submission states nothing the Owner derives: a canonical identity, venue, term,
    /// effective instant or digest is an unknown field and the body is refused.
    #[rstest]
    #[case::canonical_identity(r#","canonical_identity":"BTCUSDT-PERP.BINANCE""#)]
    #[case::venue(r#","venue_identity":"BINANCE""#)]
    #[case::effective(r#","effective_from_ns":1"#)]
    #[case::digest(r#","raw_payload_digest":"00""#)]
    #[case::observation(r#","owner_observation_time_ns":1"#)]
    fn a_submission_stating_what_the_owner_derives_is_refused(#[case] extra: &str) {
        assert!(serde_json::from_str::<InstrumentMasterBaselineSubmissionV2>(&body("")).is_ok());
        assert!(
            serde_json::from_str::<InstrumentMasterBaselineSubmissionV2>(&body(extra)).is_err()
        );
    }

    fn delta_body(extra: &str) -> String {
        format!(
            r#"{{"predecessor_fact_identity":{predecessor},"retrieval_time_ns":1,"raw_payload":"{{}}","source_binding":{source}{extra}}}"#,
            predecessor =
                serde_json::to_string(&BindingDigest::from_untrusted_bytes([3; 32])).unwrap(),
            source = serde_json::to_string(&locator()).unwrap(),
        )
    }

    /// A status delta states nothing the Owner derives either: the instrument, the status, the
    /// sequence, the event instant, a digest or the Owner observation is an unknown field.
    #[rstest]
    #[case::canonical_identity(r#","canonical_identity":"BTCUSDT-PERP.BINANCE""#)]
    #[case::status(r#","contract_status":"SETTLING""#)]
    #[case::sequence(r#","correction_sequence":2"#)]
    #[case::event_instant(r#","provider_event_time_ns":1"#)]
    #[case::digest(r#","raw_payload_digest":"00""#)]
    #[case::observation(r#","owner_observation_time_ns":1"#)]
    fn a_status_delta_stating_what_the_owner_derives_is_refused(#[case] extra: &str) {
        assert!(
            serde_json::from_str::<InstrumentMasterStatusDeltaSubmissionV2>(&delta_body(""))
                .is_ok()
        );
        assert!(
            serde_json::from_str::<InstrumentMasterStatusDeltaSubmissionV2>(&delta_body(extra))
                .is_err()
        );
    }

    #[rstest]
    fn only_the_crypto_perpetual_word_is_admitted() {
        let mut submission: InstrumentMasterBaselineSubmissionV2 =
            serde_json::from_str(&body("")).unwrap();
        assert!(submission.names_the_admitted_class());

        for word in ["EQUITY", "crypto_perpetual", "CRYPTO_SPOT", ""] {
            submission.instrument_class = word.to_owned();
            assert!(!submission.names_the_admitted_class(), "{word:?}");
        }
    }
}
