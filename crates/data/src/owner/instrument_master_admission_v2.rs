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
        ExchangeInfoNormalizationErrorV2, InstrumentMasterV2Error, InstrumentTermsBasisV2,
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
}

impl From<InstrumentTermsBasisV2> for InstrumentTermsBasisWireV2 {
    fn from(basis: InstrumentTermsBasisV2) -> Self {
        match basis {
            InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing => {
                Self::RetrievedTermsAssumedSinceListing
            }
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
