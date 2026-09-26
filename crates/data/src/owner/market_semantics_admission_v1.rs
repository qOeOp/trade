//! The Owner-sealed intake through which Operations states one Market Semantics fact.
//!
//! Operations names the admitted Source Binding, the `AVAILABLE` snapshot the statement is made
//! against and the typed value; everything else is the Owner's. Market Data
//! derives the compatibility scope from the binding's own semantics, resolves the snapshot, the
//! Source Binding, its own Instrument Master cut and its own R0 record for that snapshot, derives
//! the closed registry key from those readbacks, registers the key with the proposed value once,
//! and appends the fact, cut, receipt and outbox in one transaction. A later submission with a
//! different value for the same key is a conflict, never an overwrite; the same submission rejoins.
//!
//! The submission carries no coordinate, regime, cut, bytes, digest or receipt: the fact's
//! effective interval and correlation are the snapshot's own observation evidence. Its two
//! enumerations are named by their canonical words so the wire shape promises nothing about the
//! Owner's tags.

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    market_semantics::{
        MarketSemanticsErrorV1, MarketSemanticsPriceAdjustmentV1, MarketSemanticsTimestampBasisV1,
        MarketSemanticsValueV1,
    },
    pit_snapshot::UntrustedPitSnapshotLocator,
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
};

/// The closed typed value Operations states, with its two tags by canonical word.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarketSemanticsValueSubmissionV1 {
    /// Owner-registry meaning of the normalisation applied to the feed.
    pub normalization_identity: BindingDigest,
    /// `RAW`, `SPLIT_ADJUSTED`, `TOTAL_RETURN_ADJUSTED`, or `UNKNOWN` to state that the
    /// source's rule is not known to the submitter.
    pub price_adjustment: String,
    /// `EVENT_EFFECTIVE`, `INTERVAL_OPEN` or `INTERVAL_CLOSE`.
    pub timestamp_basis: String,
    /// Owner-registry meaning of the price unit.
    pub price_unit_identity: BindingDigest,
    /// Owner-registry meaning of the size unit.
    pub size_unit_identity: BindingDigest,
}

impl MarketSemanticsValueSubmissionV1 {
    pub(crate) fn into_value(
        self,
    ) -> Result<MarketSemanticsValueV1, MarketSemanticsAdmissionErrorV1> {
        // `UNKNOWN` is a declaration, and the arm below it is not its catch-all. An unrecognised
        // value means "I do not understand you"; `UNKNOWN` means "I understand you saying you do
        // not know." Routing unparsable input to `UNKNOWN` would turn a misspelling such as
        // `RAWW` into a legal state that consumers accept, trading a refusal that speaks for a
        // silence, so the refusal arm stays exactly as it was.
        let price_adjustment = match self.price_adjustment.as_str() {
            "RAW" => MarketSemanticsPriceAdjustmentV1::Raw,
            "SPLIT_ADJUSTED" => MarketSemanticsPriceAdjustmentV1::SplitAdjusted,
            "TOTAL_RETURN_ADJUSTED" => MarketSemanticsPriceAdjustmentV1::TotalReturnAdjusted,
            "UNKNOWN" => MarketSemanticsPriceAdjustmentV1::Unknown,
            _ => return Err(MarketSemanticsAdmissionErrorV1::InvalidSubmission),
        };
        let timestamp_basis = match self.timestamp_basis.as_str() {
            "EVENT_EFFECTIVE" => MarketSemanticsTimestampBasisV1::EventEffective,
            "INTERVAL_OPEN" => MarketSemanticsTimestampBasisV1::IntervalOpen,
            "INTERVAL_CLOSE" => MarketSemanticsTimestampBasisV1::IntervalClose,
            _ => return Err(MarketSemanticsAdmissionErrorV1::InvalidSubmission),
        };
        Ok(MarketSemanticsValueV1 {
            normalization_identity: self.normalization_identity,
            price_adjustment,
            timestamp_basis,
            price_unit_identity: self.price_unit_identity,
            size_unit_identity: self.size_unit_identity,
        })
    }

    /// The submission that states `value`: the inverse of [`Self::into_value`], word for tag.
    pub(crate) fn from_value(value: &MarketSemanticsValueV1) -> Self {
        let price_adjustment = match value.price_adjustment {
            MarketSemanticsPriceAdjustmentV1::Raw => "RAW",
            MarketSemanticsPriceAdjustmentV1::SplitAdjusted => "SPLIT_ADJUSTED",
            MarketSemanticsPriceAdjustmentV1::TotalReturnAdjusted => "TOTAL_RETURN_ADJUSTED",
            MarketSemanticsPriceAdjustmentV1::Unknown => "UNKNOWN",
        };
        let timestamp_basis = match value.timestamp_basis {
            MarketSemanticsTimestampBasisV1::EventEffective => "EVENT_EFFECTIVE",
            MarketSemanticsTimestampBasisV1::IntervalOpen => "INTERVAL_OPEN",
            MarketSemanticsTimestampBasisV1::IntervalClose => "INTERVAL_CLOSE",
        };
        Self {
            normalization_identity: value.normalization_identity,
            price_adjustment: price_adjustment.into(),
            timestamp_basis: timestamp_basis.into(),
            price_unit_identity: value.price_unit_identity,
            size_unit_identity: value.size_unit_identity,
        }
    }
}

/// The value one compatibility scope states today.
///
/// One Source Binding states one value: every head of its scope carries the same one, and a new
/// snapshot's fact stating another is refused as `ScopeValueConflict`. A submitter for a new
/// snapshot under the binding therefore reads the value here instead of restating it from memory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketSemanticsScopeValueV1 {
    compatibility_scope_identity: BindingDigest,
    value: Option<MarketSemanticsValueSubmissionV1>,
}

impl MarketSemanticsScopeValueV1 {
    pub(crate) const fn new(
        compatibility_scope_identity: BindingDigest,
        value: Option<MarketSemanticsValueSubmissionV1>,
    ) -> Self {
        Self {
            compatibility_scope_identity,
            value,
        }
    }

    /// The compatibility scope the Owner derives from the binding's semantics.
    #[must_use]
    pub const fn compatibility_scope_identity(&self) -> BindingDigest {
        self.compatibility_scope_identity
    }

    /// The value every head of the scope states, as a submission states it; `None` while the scope
    /// has no head, when any value may be the first.
    #[must_use]
    pub const fn value(&self) -> Option<&MarketSemanticsValueSubmissionV1> {
        self.value.as_ref()
    }
}

/// Why no scope value was returned.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketSemanticsScopeValueErrorV1 {
    /// Market Data holds no Source Binding under exactly this locator.
    SourceBindingUnavailable,
    /// The store is unreachable, or returned evidence Market Data does not trust; heads of one
    /// scope stating different values are such evidence.
    StoreUnavailable,
}

impl Display for MarketSemanticsScopeValueErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::SourceBindingUnavailable => "no Source Binding is stored under this locator",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        })
    }
}

impl std::error::Error for MarketSemanticsScopeValueErrorV1 {}

/// What Operations submits: which binding and snapshot the statement is about, and what it says.
///
/// The effective regime, the correlation and every time coordinate are absent on purpose. A Market
/// Semantics fact states what one snapshot's observations mean, so its regime is that snapshot's
/// own observation-evidence interval; a submitter naming a different one would be describing an
/// observation the Owner never made.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarketSemanticsFactSubmissionV1 {
    /// The admitted Source Binding whose semantics this fact types.
    pub source_binding: UntrustedSourceBindingLocator,
    /// The `AVAILABLE` snapshot the statement is made against.
    pub pit_snapshot: UntrustedPitSnapshotLocator,
    /// The typed value.
    pub value: MarketSemanticsValueSubmissionV1,
}

/// The public disposition of one admitted fact.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MarketSemanticsAdmissionDispositionV1 {
    /// The fact is now part of the scope's immutable history.
    Admitted,
}

/// What Operations learns about the fact the Owner admitted.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MarketSemanticsAdmissionTerminalV1 {
    compatibility_scope_identity: BindingDigest,
    fact_identity: BindingDigest,
    cut_identity: BindingDigest,
    disposition: MarketSemanticsAdmissionDispositionV1,
}

impl MarketSemanticsAdmissionTerminalV1 {
    pub(crate) const fn seal(
        compatibility_scope_identity: BindingDigest,
        fact_identity: BindingDigest,
        cut_identity: BindingDigest,
    ) -> Self {
        Self {
            compatibility_scope_identity,
            fact_identity,
            cut_identity,
            disposition: MarketSemanticsAdmissionDispositionV1::Admitted,
        }
    }

    /// The compatibility scope the Owner derived from the binding's semantics.
    #[must_use]
    pub const fn compatibility_scope_identity(&self) -> BindingDigest {
        self.compatibility_scope_identity
    }

    /// The admitted fact's identity.
    #[must_use]
    pub const fn fact_identity(&self) -> BindingDigest {
        self.fact_identity
    }

    /// The complete cut the fact was admitted under.
    #[must_use]
    pub const fn cut_identity(&self) -> BindingDigest {
        self.cut_identity
    }

    /// The disposition, which is always `ADMITTED` once a terminal exists.
    #[must_use]
    pub const fn disposition(&self) -> MarketSemanticsAdmissionDispositionV1 {
        self.disposition
    }
}

/// Why an admission reached no fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketSemanticsAdmissionErrorV1 {
    /// The submission is malformed, names an unknown tag, or fails the fact's own validation.
    InvalidSubmission,
    /// The snapshot, Source Binding, Instrument Master cut or R0 record it depends on is not the
    /// Owner's, is not `AVAILABLE`, or does not agree with the others.
    DependencyUnavailable,
    /// The regime overlaps another fact of the snapshot's chain, the chain already has a head
    /// this fact does not succeed, or the same request identity carries different content.
    AdmissionConflict,
    /// This snapshot's registry key already states a different value; a statement is written
    /// once per key and never overwritten.
    SnapshotValueConflict,
    /// Another snapshot under the same Source Binding states a different value; one binding
    /// states one price adjustment.
    ScopeValueConflict,
    /// The Owner store is unreachable or refused the commit.
    StoreUnavailable,
}

impl Display for MarketSemanticsAdmissionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidSubmission => "the Market Semantics submission is malformed",
            Self::DependencyUnavailable => {
                "the snapshot, binding, instrument cut or R0 record the fact depends on is unavailable"
            }
            Self::AdmissionConflict => {
                "the regime, chain head or request identity is bound to different content"
            }
            Self::SnapshotValueConflict => "this snapshot already states a different value",
            Self::ScopeValueConflict => {
                "another snapshot under the same Source Binding states a different value"
            }
            Self::StoreUnavailable => "the Market Data store is unavailable",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for MarketSemanticsAdmissionErrorV1 {}

impl From<MarketSemanticsErrorV1> for MarketSemanticsAdmissionErrorV1 {
    fn from(error: MarketSemanticsErrorV1) -> Self {
        match error {
            MarketSemanticsErrorV1::UnauthenticatedInput
            | MarketSemanticsErrorV1::DependencyMismatch
            | MarketSemanticsErrorV1::UnknownIdentity => Self::DependencyUnavailable,
            MarketSemanticsErrorV1::RequestConflict
            | MarketSemanticsErrorV1::InvalidOverlap
            | MarketSemanticsErrorV1::MissingPredecessor
            | MarketSemanticsErrorV1::PredecessorBranch
            | MarketSemanticsErrorV1::InvalidCorrection => Self::AdmissionConflict,
            MarketSemanticsErrorV1::ScopeValueConflict => Self::ScopeValueConflict,
            MarketSemanticsErrorV1::RegistryValueConflict => Self::SnapshotValueConflict,
            MarketSemanticsErrorV1::StoreUnavailable
            | MarketSemanticsErrorV1::StoreUntrusted
            | MarketSemanticsErrorV1::IncompleteCut => Self::StoreUnavailable,
            _ => Self::InvalidSubmission,
        }
    }
}

/// The sealed production admission. Operations reaches it; no consumer can implement it.
#[async_trait]
pub trait MarketSemanticsAdmissionV1: Send + Sync + sealed::Sealed {
    /// Admits one Market Semantics fact for the scope the binding implies, or refuses it.
    ///
    /// # Errors
    ///
    /// Returns a bounded category only when Market Data admitted nothing. A replayed submission
    /// of an already admitted fact is not an error: it rejoins the same fact.
    async fn admit_fact(
        &self,
        submission: MarketSemanticsFactSubmissionV1,
    ) -> Result<MarketSemanticsAdmissionTerminalV1, MarketSemanticsAdmissionErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured Market Semantics admission.
///
/// The deployment configuration root chooses the database through
/// `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn market_semantics_admission_from_environment_v1()
-> Result<Arc<dyn MarketSemanticsAdmissionV1>, MarketSemanticsAdmissionErrorV1> {
    super::postgres::market_semantics_admission_from_environment_v1().await
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn value(adjustment: &str, basis: &str) -> MarketSemanticsValueSubmissionV1 {
        MarketSemanticsValueSubmissionV1 {
            normalization_identity: BindingDigest::from_untrusted_bytes([1; 32]),
            price_adjustment: adjustment.into(),
            timestamp_basis: basis.into(),
            price_unit_identity: BindingDigest::from_untrusted_bytes([2; 32]),
            size_unit_identity: BindingDigest::from_untrusted_bytes([3; 32]),
        }
    }

    #[rstest]
    fn canonical_words_convert_and_anything_else_is_refused() {
        let converted = value("TOTAL_RETURN_ADJUSTED", "INTERVAL_CLOSE")
            .into_value()
            .unwrap();
        assert_eq!(
            converted.price_adjustment,
            MarketSemanticsPriceAdjustmentV1::TotalReturnAdjusted
        );
        assert_eq!(
            converted.timestamp_basis,
            MarketSemanticsTimestampBasisV1::IntervalClose
        );
        assert_eq!(
            value("raw", "EVENT_EFFECTIVE").into_value(),
            Err(MarketSemanticsAdmissionErrorV1::InvalidSubmission)
        );
        assert_eq!(
            value("RAW", "LATEST").into_value(),
            Err(MarketSemanticsAdmissionErrorV1::InvalidSubmission)
        );
    }

    /// Every typed value reads back as the submission that states it, so a value read from a scope
    /// can be submitted again unchanged. The matches in `from_value` are exhaustive; this pins that
    /// each arm names the word `into_value` reads as the same tag.
    #[rstest]
    fn every_value_reads_back_as_the_submission_that_states_it() {
        for adjustment in ["RAW", "SPLIT_ADJUSTED", "TOTAL_RETURN_ADJUSTED", "UNKNOWN"] {
            for basis in ["EVENT_EFFECTIVE", "INTERVAL_OPEN", "INTERVAL_CLOSE"] {
                let submission = value(adjustment, basis);
                let typed = submission.clone().into_value().unwrap();
                assert_eq!(
                    MarketSemanticsValueSubmissionV1::from_value(&typed),
                    submission
                );
            }
        }
    }

    /// A misspelling must stay an invalid submission rather than become a declared unknown.
    ///
    /// This is the one defect adding `UNKNOWN` can introduce, so it is the one the proof aims at.
    /// Routing unparsable input to `UNKNOWN` would be the natural-looking change - the variant
    /// exists now, so an unrecognised value seems to belong there - and it would convert a
    /// refusal into a legal state that every consumer accepts. `RAWW` is chosen because it is what
    /// the new variant would most plausibly absorb: a near miss of a tag that is still valid.
    #[rstest]
    fn an_unrecognised_adjustment_is_refused_rather_than_declared_unknown() {
        assert_eq!(
            value("UNKNOWN", "EVENT_EFFECTIVE")
                .into_value()
                .map(|converted| converted.price_adjustment),
            Ok(MarketSemanticsPriceAdjustmentV1::Unknown)
        );

        for misspelling in ["RAWW", "unknown", "UNKNOWN_", "", "UNSPECIFIED"] {
            assert_eq!(
                value(misspelling, "EVENT_EFFECTIVE").into_value(),
                Err(MarketSemanticsAdmissionErrorV1::InvalidSubmission),
                "{misspelling} must not be absorbed by the UNKNOWN variant"
            );
        }
    }
}
