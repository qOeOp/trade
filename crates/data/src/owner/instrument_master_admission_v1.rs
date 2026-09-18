//! The Owner-sealed intake through which Operations admits one Instrument Master V1 fact.
//!
//! Operations describes an instrument; Market Data admits it. The submission carries the fact's
//! meaning and nothing about its custody: no digest, no clock, no receipt. The Owner binds the fact
//! to its own current clock head, refuses a predecessor it does not hold, a branch, a cycle or an
//! overlapping interval, and appends through the unchanged write-once path, so a replayed
//! submission rejoins the fact it admitted the first time.
//!
//! The wire shape is deliberately not the Owner's proposal type. `InstrumentMasterFactProposalV1`
//! carries an `i128` mantissa and a closed instrument-class tag, and neither has a JSON form this
//! Owner wants to promise; the submission names the class by its canonical word and the Owner
//! converts, refusing anything it does not recognise before it opens a transaction.

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    instrument_master::{
        InstrumentClass, InstrumentDecimal, InstrumentMasterError, InstrumentMasterFactProposalV1,
        InstrumentVenueSourceMapping,
    },
    source_binding::BindingDigest,
};

/// One venue and source mapping as Operations states it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentVenueSourceMappingSubmissionV1 {
    /// The venue the instrument trades on.
    pub venue_identity: String,
    /// The source that publishes it there.
    pub source_identity: String,
    /// The source's own name for the instrument, as raw bytes.
    pub source_instrument: Vec<u8>,
}

/// An exact positive decimal: mantissa and explicit scale, never a float.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentDecimalSubmissionV1 {
    /// Signed mantissa.
    pub mantissa: i128,
    /// Decimal places the mantissa is scaled by.
    pub scale: u8,
}

/// The Instrument Master V1 fact Operations submits.
///
/// Every field is meaning the Owner cannot know on its own. The clock coordinates, the fact digest
/// and the receipt are the Owner's and are absent here on purpose.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentMasterFactSubmissionV1 {
    /// Canonical instrument identity, for example `AAPL.XNAS`.
    pub canonical_identity: String,
    /// The fact this one corrects, when it corrects one.
    pub predecessor_fact_digest: Option<BindingDigest>,
    /// Venue and source mappings.
    pub mappings: Vec<InstrumentVenueSourceMappingSubmissionV1>,
    /// Instrument class by its canonical word, for example `EQUITY` or `CRYPTO_PERPETUAL`.
    pub instrument_class: String,
    /// Base currency, when the class has one.
    pub base_currency: Option<String>,
    /// Quote currency, when the class has one.
    pub quote_currency: Option<String>,
    /// Settlement currency, when the class has one.
    pub settlement_currency: Option<String>,
    /// Margin currency, when the class has one.
    pub margin_currency: Option<String>,
    /// Price increment.
    pub price_increment: InstrumentDecimalSubmissionV1,
    /// Quantity increment.
    pub quantity_increment: InstrumentDecimalSubmissionV1,
    /// Contract multiplier.
    pub contract_multiplier: InstrumentDecimalSubmissionV1,
    /// Trading calendar identity.
    pub calendar_identity: String,
    /// Session identity.
    pub session_identity: String,
    /// Time zone identity.
    pub time_zone_identity: String,
    /// Lifecycle frontier this fact was observed under.
    pub lifecycle_frontier: BindingDigest,
    /// Corporate action frontier this fact was observed under.
    pub corporate_action_frontier: BindingDigest,
    /// Historical membership frontier this fact was observed under.
    pub historical_membership_frontier: BindingDigest,
    /// Market Semantics Compatibility identity the fact is stated under.
    pub market_semantics_identity: BindingDigest,
    /// Source frontier this fact was observed under.
    pub source_frontier: BindingDigest,
    /// Correction frontier this fact was observed under.
    pub correction_frontier: BindingDigest,
    /// Start of the half-open effective interval, in nanoseconds.
    pub effective_from: i128,
    /// Exclusive end of the effective interval, or open.
    pub effective_until: Option<i128>,
    /// When the provider made the fact available.
    pub provider_available: i128,
    /// When it was retrieved.
    pub retrieval: i128,
    /// When its correction was published.
    pub correction_publication: i128,
    /// When this Owner observed it.
    pub owner_observation: i128,
}

impl InstrumentMasterFactSubmissionV1 {
    /// Converts the submission into the Owner's proposal, refusing an unknown class.
    pub(crate) fn into_proposal(
        self,
    ) -> Result<InstrumentMasterFactProposalV1, InstrumentMasterAdmissionErrorV1> {
        let instrument_class = instrument_class_from_canonical(&self.instrument_class)
            .ok_or(InstrumentMasterAdmissionErrorV1::InvalidSubmission)?;
        Ok(InstrumentMasterFactProposalV1 {
            canonical_identity: self.canonical_identity,
            predecessor_fact_digest: self.predecessor_fact_digest,
            mappings: self
                .mappings
                .into_iter()
                .map(|mapping| InstrumentVenueSourceMapping {
                    venue_identity: mapping.venue_identity,
                    source_identity: mapping.source_identity,
                    source_instrument: mapping.source_instrument,
                })
                .collect(),
            instrument_class,
            base_currency: self.base_currency,
            quote_currency: self.quote_currency,
            settlement_currency: self.settlement_currency,
            margin_currency: self.margin_currency,
            price_increment: decimal(self.price_increment),
            quantity_increment: decimal(self.quantity_increment),
            contract_multiplier: decimal(self.contract_multiplier),
            calendar_identity: self.calendar_identity,
            session_identity: self.session_identity,
            time_zone_identity: self.time_zone_identity,
            lifecycle_frontier: self.lifecycle_frontier,
            corporate_action_frontier: self.corporate_action_frontier,
            historical_membership_frontier: self.historical_membership_frontier,
            market_semantics_identity: self.market_semantics_identity,
            source_frontier: self.source_frontier,
            correction_frontier: self.correction_frontier,
            effective_from: self.effective_from,
            effective_until: self.effective_until,
            provider_available: self.provider_available,
            retrieval: self.retrieval,
            correction_publication: self.correction_publication,
            owner_observation: self.owner_observation,
        })
    }
}

const fn decimal(value: InstrumentDecimalSubmissionV1) -> InstrumentDecimal {
    InstrumentDecimal {
        mantissa: value.mantissa,
        scale: value.scale,
    }
}

/// The canonical words for the closed instrument-class vocabulary, in tag order.
const INSTRUMENT_CLASS_WORDS: [(&str, InstrumentClass); 12] = [
    ("EQUITY", InstrumentClass::Equity),
    ("FUTURE", InstrumentClass::Future),
    ("OPTION", InstrumentClass::Option),
    ("FX_PAIR", InstrumentClass::FxPair),
    ("CRYPTO_SPOT", InstrumentClass::CryptoSpot),
    ("CRYPTO_PERPETUAL", InstrumentClass::CryptoPerpetual),
    ("FIXED_INCOME", InstrumentClass::FixedIncome),
    ("FUND", InstrumentClass::Fund),
    ("INDEX", InstrumentClass::Index),
    ("COMMODITY", InstrumentClass::Commodity),
    ("BETTING", InstrumentClass::Betting),
    ("SYNTHETIC", InstrumentClass::Synthetic),
];

fn instrument_class_from_canonical(word: &str) -> Option<InstrumentClass> {
    INSTRUMENT_CLASS_WORDS
        .iter()
        .find(|(candidate, _)| *candidate == word)
        .map(|(_, class)| *class)
}

/// The public disposition of one admitted fact.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InstrumentMasterAdmissionDispositionV1 {
    /// The fact is now part of the instrument's immutable history.
    Admitted,
}

/// What Operations learns about the fact the Owner admitted.
///
/// The digest is the only handle the fact has; PIT snapshots later bind to a resolution cut over
/// it, which the Owner derives itself.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InstrumentMasterAdmissionTerminalV1 {
    canonical_identity: String,
    fact_digest: BindingDigest,
    clock_head_identity: BindingDigest,
    disposition: InstrumentMasterAdmissionDispositionV1,
}

impl InstrumentMasterAdmissionTerminalV1 {
    pub(crate) fn seal(
        canonical_identity: String,
        fact_digest: BindingDigest,
        clock_head_identity: BindingDigest,
    ) -> Self {
        Self {
            canonical_identity,
            fact_digest,
            clock_head_identity,
            disposition: InstrumentMasterAdmissionDispositionV1::Admitted,
        }
    }

    /// The instrument the fact describes.
    #[must_use]
    pub fn canonical_identity(&self) -> &str {
        &self.canonical_identity
    }

    /// The admitted fact's digest.
    #[must_use]
    pub const fn fact_digest(&self) -> BindingDigest {
        self.fact_digest
    }

    /// The clock head the fact was admitted under.
    #[must_use]
    pub const fn clock_head_identity(&self) -> BindingDigest {
        self.clock_head_identity
    }

    /// The disposition, which is always `ADMITTED` once a terminal exists.
    #[must_use]
    pub const fn disposition(&self) -> InstrumentMasterAdmissionDispositionV1 {
        self.disposition
    }
}

/// Why an admission reached no fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterAdmissionErrorV1 {
    /// The submission is malformed, names an unknown class, or fails the fact's own validation.
    InvalidSubmission,
    /// The predecessor is absent, already succeeded, cyclic, or the interval overlaps another chain.
    PredecessorUnavailable,
    /// The same fact digest is already stored with different content.
    AdmissionConflict,
    /// The Owner holds no canonical clock head to admit under.
    ClockUnavailable,
    /// The Owner store is unreachable or refused the commit.
    StoreUnavailable,
}

impl Display for InstrumentMasterAdmissionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidSubmission => "the Instrument Master submission is malformed",
            Self::PredecessorUnavailable => {
                "the submission's predecessor or interval does not fit the instrument's history"
            }
            Self::AdmissionConflict => "the fact digest is stored with different content",
            Self::ClockUnavailable => "Market Data holds no canonical clock head",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for InstrumentMasterAdmissionErrorV1 {}

impl From<InstrumentMasterError> for InstrumentMasterAdmissionErrorV1 {
    fn from(error: InstrumentMasterError) -> Self {
        match error {
            InstrumentMasterError::MissingPredecessor
            | InstrumentMasterError::PredecessorBranch
            | InstrumentMasterError::PredecessorCycle
            | InstrumentMasterError::InvalidOverlap => Self::PredecessorUnavailable,
            InstrumentMasterError::DigestMismatch | InstrumentMasterError::RequestConflict => {
                Self::AdmissionConflict
            }
            InstrumentMasterError::ClockUnavailable
            | InstrumentMasterError::ClockMismatch
            | InstrumentMasterError::ClockExpired
            | InstrumentMasterError::ClockDiscontinuous => Self::ClockUnavailable,
            InstrumentMasterError::StoreUnavailable
            | InstrumentMasterError::StoreUntrusted
            | InstrumentMasterError::CommitInterrupted
            | InstrumentMasterError::ResponseLost => Self::StoreUnavailable,
            _ => Self::InvalidSubmission,
        }
    }
}

/// The sealed production admission. Operations reaches it; no consumer can implement it.
#[async_trait]
pub trait InstrumentMasterAdmissionV1: Send + Sync + sealed::Sealed {
    /// Admits one fact under the Owner's current clock head, or refuses it.
    ///
    /// # Errors
    ///
    /// Returns a bounded category only when Market Data admitted nothing. A replayed submission
    /// of an already admitted fact is not an error: it rejoins the same fact.
    async fn admit_fact(
        &self,
        submission: InstrumentMasterFactSubmissionV1,
    ) -> Result<InstrumentMasterAdmissionTerminalV1, InstrumentMasterAdmissionErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured Instrument Master V1 admission.
///
/// The deployment configuration root chooses the database through
/// `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn instrument_master_admission_from_environment_v1()
-> Result<Arc<dyn InstrumentMasterAdmissionV1>, InstrumentMasterAdmissionErrorV1> {
    super::postgres::instrument_master_admission_from_environment_v1().await
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn every_class_word_round_trips_and_an_unknown_word_is_refused() {
        for (word, class) in INSTRUMENT_CLASS_WORDS {
            assert_eq!(instrument_class_from_canonical(word), Some(class));
        }
        assert_eq!(instrument_class_from_canonical("equity"), None);
        assert_eq!(instrument_class_from_canonical(""), None);
    }
}
