//! Native, content-addressed Instrument Master custody owned by Market Data.
//!
//! The public boundary accepts untrusted requests and exposes only a sealed read-only resolver.
//! Writers, storage coordinates, and constructors for positive facts/readbacks remain Owner-private.
//!
//! ```compile_fail
//! use vibe_data::owner::instrument_master::InstrumentMasterReadbackV1;
//! let forged = InstrumentMasterReadbackV1 {};
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::postgres::MarketDataOwnerPostgres;
//! ```

use std::fmt::Display;

use vibe_core::UnixNanos;
use vibe_model::types::{
    fixed::mantissa_exponent_to_fixed_i128,
    price::{Price, PriceRaw, check_positive_price},
    quantity::{Quantity, QuantityRaw, check_positive_quantity},
};

use super::{
    shared_time_evidence::UntrustedClockHeadLocator,
    source_binding::BindingDigest,
    strategy_input_binding::StrategyInputUniverseSelectionReceipt,
    universe_selection::{UniverseSelectionReadbackV1, verify_universe_selection_readback_v1},
};

pub(super) mod authority;
mod codec;

pub use authority::verify_instrument_master_readback;

/// Reuses the repository's canonical fixed-size digest representation.
pub type InstrumentMasterIdentity = BindingDigest;

pub const BACKTEST_OWNER_V1: &str = "BACKTEST_OWNER_V1";
pub const MARKET_DATA_AS_OF: &str = "MARKET_DATA_AS_OF";
pub const SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1: &str = "SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1";

/// Exact supported Instrument Master fact classes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub enum InstrumentClass {
    Equity = 0x0001,
    Future = 0x0002,
    Option = 0x0003,
    FxPair = 0x0004,
    CryptoSpot = 0x0005,
    CryptoPerpetual = 0x0006,
    FixedIncome = 0x0007,
    Fund = 0x0008,
    Index = 0x0009,
    Commodity = 0x000a,
    Betting = 0x000b,
    Synthetic = 0x000c,
}

impl InstrumentClass {
    fn decode(value: u16) -> Result<Self, InstrumentMasterError> {
        Ok(match value {
            0x0001 => Self::Equity,
            0x0002 => Self::Future,
            0x0003 => Self::Option,
            0x0004 => Self::FxPair,
            0x0005 => Self::CryptoSpot,
            0x0006 => Self::CryptoPerpetual,
            0x0007 => Self::FixedIncome,
            0x0008 => Self::Fund,
            0x0009 => Self::Index,
            0x000a => Self::Commodity,
            0x000b => Self::Betting,
            0x000c => Self::Synthetic,
            _ => return Err(InstrumentMasterError::CodecMismatch),
        })
    }
}

/// Exact positive decimal; redundant trailing fractional zeroes are invalid.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentDecimal {
    pub mantissa: i128,
    pub scale: u8,
}

impl InstrumentDecimal {
    fn validate(self) -> Result<(), InstrumentMasterError> {
        if self.mantissa <= 0 || self.scale > 38 || (self.scale != 0 && self.mantissa % 10 == 0) {
            Err(InstrumentMasterError::InvalidFact)
        } else {
            Ok(())
        }
    }
}

/// One canonical venue/source mapping tuple.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentVenueSourceMapping {
    pub venue_identity: String,
    pub source_identity: String,
    pub source_instrument: Vec<u8>,
}

/// Untrusted fact meaning proposed to the private Market Data writer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentMasterFactProposalV1 {
    pub canonical_identity: String,
    pub predecessor_fact_digest: Option<InstrumentMasterIdentity>,
    pub mappings: Vec<InstrumentVenueSourceMapping>,
    pub instrument_class: InstrumentClass,
    pub base_currency: Option<String>,
    pub quote_currency: Option<String>,
    pub settlement_currency: Option<String>,
    pub margin_currency: Option<String>,
    pub price_increment: InstrumentDecimal,
    pub quantity_increment: InstrumentDecimal,
    pub contract_multiplier: InstrumentDecimal,
    pub calendar_identity: String,
    pub session_identity: String,
    pub time_zone_identity: String,
    pub lifecycle_frontier: InstrumentMasterIdentity,
    pub corporate_action_frontier: InstrumentMasterIdentity,
    pub historical_membership_frontier: InstrumentMasterIdentity,
    pub market_semantics_identity: InstrumentMasterIdentity,
    pub source_frontier: InstrumentMasterIdentity,
    pub correction_frontier: InstrumentMasterIdentity,
    pub effective_from: i128,
    pub effective_until: Option<i128>,
    pub provider_available: i128,
    pub retrieval: i128,
    pub correction_publication: i128,
    pub owner_observation: i128,
}

/// Untrusted resolution scope. A Universe identity never carries its own membership.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InstrumentMasterScopeV1 {
    ExactInstrument(String),
    UniverseSelectionRecord(InstrumentMasterIdentity),
}

/// Untrusted request; its clock locator is only a lookup key for current sealed Owner evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedInstrumentMasterRequestV1 {
    pub request_identity: InstrumentMasterIdentity,
    pub request_meaning_digest: InstrumentMasterIdentity,
    pub consumer_role: String,
    pub scope: InstrumentMasterScopeV1,
    pub effective_instant: i128,
    pub owner_observation: i128,
    pub decision_cut: u64,
    pub clock_head: UntrustedClockHeadLocator,
    pub lifecycle_frontier: InstrumentMasterIdentity,
    pub corporate_action_frontier: InstrumentMasterIdentity,
    pub historical_membership_frontier: InstrumentMasterIdentity,
    pub market_semantics_identity: InstrumentMasterIdentity,
    pub source_frontier: InstrumentMasterIdentity,
    pub correction_frontier: InstrumentMasterIdentity,
    pub stable_correlation: InstrumentMasterIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ClockProjection {
    pub(super) clock_identity: [u8; 32],
    pub(super) clock_epoch: [u8; 32],
    pub(super) monotonic_sequence: u64,
    pub(super) wall_observed: u64,
    pub(super) decision_cut: u64,
    pub(super) head_identity: InstrumentMasterIdentity,
    pub(super) head_digest: InstrumentMasterIdentity,
    pub(super) valid_through: u64,
    pub(super) restart_continuity_digest: InstrumentMasterIdentity,
    pub(super) uncertainty_bound: u64,
    pub(super) skew_bound: u64,
    pub(super) epoch_proof_identity: Option<InstrumentMasterIdentity>,
    pub(super) epoch_proof_digest: Option<InstrumentMasterIdentity>,
}

/// Canonical immutable fact. Callers can inspect but cannot construct or deserialize it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentMasterFactV1 {
    pub(super) proposal: InstrumentMasterFactProposalV1,
    pub(super) clock: ClockProjection,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: InstrumentMasterIdentity,
}

impl InstrumentMasterFactV1 {
    pub fn canonical_identity(&self) -> &str {
        &self.proposal.canonical_identity
    }
    pub const fn identity(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub const fn digest(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn predecessor_fact_digest(&self) -> Option<InstrumentMasterIdentity> {
        self.proposal.predecessor_fact_digest
    }
    /// Returns the exact class sealed into this historical fact.
    pub const fn instrument_class(&self) -> InstrumentClass {
        self.proposal.instrument_class
    }
    /// Returns the exact calendar evidence field sealed into this historical fact.
    pub fn calendar_identity(&self) -> &str {
        &self.proposal.calendar_identity
    }
    /// Returns the exact session evidence field sealed into this historical fact.
    pub fn session_identity(&self) -> &str {
        &self.proposal.session_identity
    }
    /// Returns the exact time-zone evidence field sealed into this historical fact.
    pub fn time_zone_identity(&self) -> &str {
        &self.proposal.time_zone_identity
    }
    /// Returns the Market Semantics identity sealed into this historical fact.
    pub const fn market_semantics_identity(&self) -> InstrumentMasterIdentity {
        self.proposal.market_semantics_identity
    }
    /// Returns the correction frontier sealed into this historical fact.
    pub const fn correction_frontier(&self) -> InstrumentMasterIdentity {
        self.proposal.correction_frontier
    }
    /// Returns the source frontier sealed into this historical fact.
    pub const fn source_frontier(&self) -> InstrumentMasterIdentity {
        self.proposal.source_frontier
    }
    pub const fn effective_from(&self) -> i128 {
        self.proposal.effective_from
    }
    pub const fn effective_until(&self) -> Option<i128> {
        self.proposal.effective_until
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct InstrumentMasterResolution {
    pub(super) canonical_identity: String,
    pub(super) fact_digest: InstrumentMasterIdentity,
}

/// Canonical immutable cut, available only inside a sealed readback.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentMasterCutV1 {
    pub(super) request_identity: InstrumentMasterIdentity,
    pub(super) request_meaning_digest: InstrumentMasterIdentity,
    pub(super) scope: InstrumentMasterScopeV1,
    pub(super) expected_members: Vec<String>,
    pub(super) effective_instant: i128,
    pub(super) owner_observation: i128,
    pub(super) decision_cut: u64,
    pub(super) clock: ClockProjection,
    pub(super) resolutions: Vec<InstrumentMasterResolution>,
    pub(super) frontiers: [InstrumentMasterIdentity; 6],
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: InstrumentMasterIdentity,
}

impl InstrumentMasterCutV1 {
    pub const fn identity(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub const fn digest(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub fn expected_members(&self) -> &[String] {
        &self.expected_members
    }
    /// Returns the exact effective instant resolved by this cut.
    pub const fn effective_instant(&self) -> i128 {
        self.effective_instant
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct InstrumentMasterReceiptV1 {
    pub(super) request_identity: InstrumentMasterIdentity,
    pub(super) request_meaning_digest: InstrumentMasterIdentity,
    pub(super) fact_bytes: Vec<Vec<u8>>,
    pub(super) cut_bytes: Vec<u8>,
    pub(super) store_generation_identity: InstrumentMasterIdentity,
    pub(super) store_append_sequence: u64,
    pub(super) stable_correlation: InstrumentMasterIdentity,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: InstrumentMasterIdentity,
}

/// Move-only Owner-sealed exact readback. It intentionally implements neither `Clone` nor `Deserialize`.
#[derive(Debug, Eq, PartialEq)]
pub struct InstrumentMasterReadbackV1 {
    pub(super) request_identity: InstrumentMasterIdentity,
    pub(super) request_meaning_digest: InstrumentMasterIdentity,
    pub(super) facts: Vec<InstrumentMasterFactV1>,
    pub(super) cut: InstrumentMasterCutV1,
    pub(super) stable_correlation: InstrumentMasterIdentity,
    pub(super) store_generation_identity: InstrumentMasterIdentity,
    pub(super) store_append_sequence: u64,
    pub(super) receipt_identity: InstrumentMasterIdentity,
    pub(super) outbox_identity: InstrumentMasterIdentity,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: InstrumentMasterIdentity,
}

impl InstrumentMasterReadbackV1 {
    pub const fn identity(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub const fn digest(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub fn facts(&self) -> &[InstrumentMasterFactV1] {
        &self.facts
    }
    pub const fn cut(&self) -> &InstrumentMasterCutV1 {
        &self.cut
    }
    pub const fn receipt_identity(&self) -> InstrumentMasterIdentity {
        self.receipt_identity
    }
    pub const fn outbox_identity(&self) -> InstrumentMasterIdentity {
        self.outbox_identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    /// Validates one exact V1 fact and mapping for later native crypto-perpetual composition.
    ///
    /// The complete readback is reverified before any value crosses the Owner boundary. The
    /// mapping selector must identify exactly one sealed venue/source tuple; no first-match or
    /// caller default is accepted. This projection carries public Instrument Master terms only.
    /// Account-specific fees, leverage, margin ratios, and execution policy remain outside Market
    /// Data custody.
    ///
    /// # Errors
    ///
    /// Returns a fail-closed error for a malformed or cross-spliced readback, an absent or
    /// ambiguous mapping, an unsupported class, incomplete currencies, or a value that cannot be
    /// represented by the native fixed-point and timestamp types.
    pub fn validate_native_crypto_perpetual_public_terms(
        &self,
        canonical_identity: &str,
        venue_identity: &str,
        source_identity: &str,
    ) -> Result<ValidatedInstrumentMasterPublicTermsV1, NativePublicTermsValidationErrorV1> {
        if !verify_instrument_master_readback(self) {
            return Err(NativePublicTermsValidationErrorV1::InvalidReadback);
        }

        let fact = self
            .facts
            .iter()
            .find(|fact| fact.canonical_identity() == canonical_identity)
            .ok_or(NativePublicTermsValidationErrorV1::UnknownInstrument)?;
        if fact.instrument_class() != InstrumentClass::CryptoPerpetual {
            return Err(NativePublicTermsValidationErrorV1::UnsupportedClass(
                fact.instrument_class(),
            ));
        }

        let mut mappings = fact.proposal.mappings.iter().filter(|mapping| {
            mapping.venue_identity == venue_identity && mapping.source_identity == source_identity
        });
        let mapping = mappings
            .next()
            .ok_or(NativePublicTermsValidationErrorV1::MissingMapping)?;
        if mappings.next().is_some() {
            return Err(NativePublicTermsValidationErrorV1::AmbiguousMapping);
        }
        let raw_symbol = std::str::from_utf8(&mapping.source_instrument)
            .map_err(|_| {
                NativePublicTermsValidationErrorV1::NativeRepresentation(
                    NativePublicTermsFieldV1::SourceInstrument,
                )
            })?
            .to_owned();

        let base_currency = require_native_currency(
            fact.proposal.base_currency.as_deref(),
            NativePublicTermsFieldV1::BaseCurrency,
        )?;
        let quote_currency = require_native_currency(
            fact.proposal.quote_currency.as_deref(),
            NativePublicTermsFieldV1::QuoteCurrency,
        )?;
        let settlement_currency = require_native_currency(
            fact.proposal.settlement_currency.as_deref(),
            NativePublicTermsFieldV1::SettlementCurrency,
        )?;
        let margin_currency = optional_native_currency(
            fact.proposal.margin_currency.as_deref(),
            NativePublicTermsFieldV1::MarginCurrency,
        )?;

        validate_native_price_v1(
            fact.proposal.price_increment,
            NativePublicTermsFieldV1::PriceIncrement,
        )?;
        validate_native_quantity_v1(
            fact.proposal.quantity_increment,
            NativePublicTermsFieldV1::QuantityIncrement,
        )?;
        validate_native_quantity_v1(
            fact.proposal.contract_multiplier,
            NativePublicTermsFieldV1::ContractMultiplier,
        )?;

        Ok(ValidatedInstrumentMasterPublicTermsV1 {
            readback_identity: self.identity,
            request_identity: self.request_identity,
            request_meaning_digest: self.request_meaning_digest,
            cut_identity: self.cut.identity,
            receipt_identity: self.receipt_identity,
            outbox_identity: self.outbox_identity,
            stable_correlation: self.stable_correlation,
            store_generation_identity: self.store_generation_identity,
            store_append_sequence: self.store_append_sequence,
            fact_identity: fact.identity,
            predecessor_fact_digest: fact.proposal.predecessor_fact_digest,
            canonical_identity: fact.proposal.canonical_identity.clone(),
            venue_identity: mapping.venue_identity.clone(),
            source_identity: mapping.source_identity.clone(),
            source_instrument: mapping.source_instrument.clone(),
            raw_symbol,
            instrument_class: fact.proposal.instrument_class,
            base_currency,
            quote_currency,
            settlement_currency,
            margin_currency,
            price_increment: fact.proposal.price_increment,
            quantity_increment: fact.proposal.quantity_increment,
            contract_multiplier: fact.proposal.contract_multiplier,
            calendar_identity: fact.proposal.calendar_identity.clone(),
            session_identity: fact.proposal.session_identity.clone(),
            time_zone_identity: fact.proposal.time_zone_identity.clone(),
            lifecycle_frontier: fact.proposal.lifecycle_frontier,
            corporate_action_frontier: fact.proposal.corporate_action_frontier,
            historical_membership_frontier: fact.proposal.historical_membership_frontier,
            market_semantics_identity: fact.proposal.market_semantics_identity,
            source_frontier: fact.proposal.source_frontier,
            correction_frontier: fact.proposal.correction_frontier,
            effective_from: native_timestamp_v1(
                fact.proposal.effective_from,
                NativePublicTermsFieldV1::EffectiveFrom,
            )?,
            effective_until: fact
                .proposal
                .effective_until
                .map(|value| native_timestamp_v1(value, NativePublicTermsFieldV1::EffectiveUntil))
                .transpose()?,
            provider_available: native_timestamp_v1(
                fact.proposal.provider_available,
                NativePublicTermsFieldV1::ProviderAvailable,
            )?,
            retrieval: native_timestamp_v1(
                fact.proposal.retrieval,
                NativePublicTermsFieldV1::Retrieval,
            )?,
            correction_publication: native_timestamp_v1(
                fact.proposal.correction_publication,
                NativePublicTermsFieldV1::CorrectionPublication,
            )?,
            owner_observation: native_timestamp_v1(
                fact.proposal.owner_observation,
                NativePublicTermsFieldV1::OwnerObservation,
            )?,
            effective_instant: native_timestamp_v1(
                self.cut.effective_instant,
                NativePublicTermsFieldV1::EffectiveInstant,
            )?,
            decision_cut: self.cut.decision_cut,
            clock_head_identity: self.cut.clock.head_identity,
            clock_head_digest: self.cut.clock.head_digest,
        })
    }
}

/// One field whose value is required to cross the V1 native public-terms boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativePublicTermsFieldV1 {
    SourceInstrument,
    BaseCurrency,
    QuoteCurrency,
    SettlementCurrency,
    MarginCurrency,
    PriceIncrement,
    QuantityIncrement,
    ContractMultiplier,
    EffectiveFrom,
    EffectiveUntil,
    ProviderAvailable,
    Retrieval,
    CorrectionPublication,
    OwnerObservation,
    EffectiveInstant,
}

/// Failure to derive one exact native public-terms projection from a sealed V1 readback.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativePublicTermsValidationErrorV1 {
    InvalidReadback,
    UnknownInstrument,
    MissingMapping,
    AmbiguousMapping,
    UnsupportedClass(InstrumentClass),
    MissingField(NativePublicTermsFieldV1),
    NativeRepresentation(NativePublicTermsFieldV1),
}

impl Display for NativePublicTermsValidationErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for NativePublicTermsValidationErrorV1 {}

/// Move-only Market Data-owned V1 public terms for later native composition.
///
/// Callers can inspect this value but cannot construct, clone, or deserialize it. It deliberately
/// carries no account-specific or execution-policy economics.
#[derive(Debug, Eq, PartialEq)]
pub struct ValidatedInstrumentMasterPublicTermsV1 {
    readback_identity: InstrumentMasterIdentity,
    request_identity: InstrumentMasterIdentity,
    request_meaning_digest: InstrumentMasterIdentity,
    cut_identity: InstrumentMasterIdentity,
    receipt_identity: InstrumentMasterIdentity,
    outbox_identity: InstrumentMasterIdentity,
    stable_correlation: InstrumentMasterIdentity,
    store_generation_identity: InstrumentMasterIdentity,
    store_append_sequence: u64,
    fact_identity: InstrumentMasterIdentity,
    predecessor_fact_digest: Option<InstrumentMasterIdentity>,
    canonical_identity: String,
    venue_identity: String,
    source_identity: String,
    source_instrument: Vec<u8>,
    raw_symbol: String,
    instrument_class: InstrumentClass,
    base_currency: String,
    quote_currency: String,
    settlement_currency: String,
    margin_currency: Option<String>,
    price_increment: InstrumentDecimal,
    quantity_increment: InstrumentDecimal,
    contract_multiplier: InstrumentDecimal,
    calendar_identity: String,
    session_identity: String,
    time_zone_identity: String,
    lifecycle_frontier: InstrumentMasterIdentity,
    corporate_action_frontier: InstrumentMasterIdentity,
    historical_membership_frontier: InstrumentMasterIdentity,
    market_semantics_identity: InstrumentMasterIdentity,
    source_frontier: InstrumentMasterIdentity,
    correction_frontier: InstrumentMasterIdentity,
    effective_from: UnixNanos,
    effective_until: Option<UnixNanos>,
    provider_available: UnixNanos,
    retrieval: UnixNanos,
    correction_publication: UnixNanos,
    owner_observation: UnixNanos,
    effective_instant: UnixNanos,
    decision_cut: u64,
    clock_head_identity: InstrumentMasterIdentity,
    clock_head_digest: InstrumentMasterIdentity,
}

macro_rules! digest_getter {
    ($name:ident, $field:ident) => {
        #[must_use]
        pub const fn $name(&self) -> InstrumentMasterIdentity {
            self.$field
        }
    };
}

impl ValidatedInstrumentMasterPublicTermsV1 {
    digest_getter!(readback_identity, readback_identity);
    digest_getter!(request_identity, request_identity);
    digest_getter!(request_meaning_digest, request_meaning_digest);
    digest_getter!(cut_identity, cut_identity);
    digest_getter!(receipt_identity, receipt_identity);
    digest_getter!(outbox_identity, outbox_identity);
    digest_getter!(stable_correlation, stable_correlation);
    digest_getter!(store_generation_identity, store_generation_identity);
    digest_getter!(fact_identity, fact_identity);
    digest_getter!(lifecycle_frontier, lifecycle_frontier);
    digest_getter!(corporate_action_frontier, corporate_action_frontier);
    digest_getter!(
        historical_membership_frontier,
        historical_membership_frontier
    );
    digest_getter!(market_semantics_identity, market_semantics_identity);
    digest_getter!(source_frontier, source_frontier);
    digest_getter!(correction_frontier, correction_frontier);
    digest_getter!(clock_head_identity, clock_head_identity);
    digest_getter!(clock_head_digest, clock_head_digest);

    #[must_use]
    pub const fn predecessor_fact_digest(&self) -> Option<InstrumentMasterIdentity> {
        self.predecessor_fact_digest
    }

    #[must_use]
    pub fn canonical_identity(&self) -> &str {
        &self.canonical_identity
    }

    #[must_use]
    pub fn venue_identity(&self) -> &str {
        &self.venue_identity
    }

    #[must_use]
    pub fn source_identity(&self) -> &str {
        &self.source_identity
    }

    #[must_use]
    pub fn source_instrument(&self) -> &[u8] {
        &self.source_instrument
    }

    #[must_use]
    pub fn raw_symbol(&self) -> &str {
        &self.raw_symbol
    }

    #[must_use]
    pub const fn instrument_class(&self) -> InstrumentClass {
        self.instrument_class
    }

    #[must_use]
    pub fn base_currency(&self) -> &str {
        &self.base_currency
    }

    #[must_use]
    pub fn quote_currency(&self) -> &str {
        &self.quote_currency
    }

    #[must_use]
    pub fn settlement_currency(&self) -> &str {
        &self.settlement_currency
    }

    #[must_use]
    pub fn margin_currency(&self) -> Option<&str> {
        self.margin_currency.as_deref()
    }

    #[must_use]
    pub const fn price_increment(&self) -> InstrumentDecimal {
        self.price_increment
    }

    #[must_use]
    pub const fn quantity_increment(&self) -> InstrumentDecimal {
        self.quantity_increment
    }

    #[must_use]
    pub const fn contract_multiplier(&self) -> InstrumentDecimal {
        self.contract_multiplier
    }

    #[must_use]
    pub fn calendar_identity(&self) -> &str {
        &self.calendar_identity
    }

    #[must_use]
    pub fn session_identity(&self) -> &str {
        &self.session_identity
    }

    #[must_use]
    pub fn time_zone_identity(&self) -> &str {
        &self.time_zone_identity
    }

    #[must_use]
    pub const fn effective_from(&self) -> UnixNanos {
        self.effective_from
    }

    #[must_use]
    pub const fn effective_until(&self) -> Option<UnixNanos> {
        self.effective_until
    }

    #[must_use]
    pub const fn provider_available(&self) -> UnixNanos {
        self.provider_available
    }

    #[must_use]
    pub const fn retrieval(&self) -> UnixNanos {
        self.retrieval
    }

    #[must_use]
    pub const fn correction_publication(&self) -> UnixNanos {
        self.correction_publication
    }

    #[must_use]
    pub const fn owner_observation(&self) -> UnixNanos {
        self.owner_observation
    }

    #[must_use]
    pub const fn effective_instant(&self) -> UnixNanos {
        self.effective_instant
    }

    #[must_use]
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    #[must_use]
    pub const fn store_append_sequence(&self) -> u64 {
        self.store_append_sequence
    }
}

fn require_native_currency(
    value: Option<&str>,
    field: NativePublicTermsFieldV1,
) -> Result<String, NativePublicTermsValidationErrorV1> {
    match value {
        Some(value) if !value.is_empty() => Ok(value.to_owned()),
        _ => Err(NativePublicTermsValidationErrorV1::MissingField(field)),
    }
}

fn optional_native_currency(
    value: Option<&str>,
    field: NativePublicTermsFieldV1,
) -> Result<Option<String>, NativePublicTermsValidationErrorV1> {
    match value {
        None => Ok(None),
        Some(value) if !value.is_empty() => Ok(Some(value.to_owned())),
        Some(_) => Err(NativePublicTermsValidationErrorV1::MissingField(field)),
    }
}

fn native_raw_v1(
    value: InstrumentDecimal,
    field: NativePublicTermsFieldV1,
) -> Result<i128, NativePublicTermsValidationErrorV1> {
    let exponent = i8::try_from(value.scale)
        .map(|scale| -scale)
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))?;
    mantissa_exponent_to_fixed_i128(value.mantissa, exponent, value.scale)
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))
}

fn validate_native_price_v1(
    value: InstrumentDecimal,
    field: NativePublicTermsFieldV1,
) -> Result<(), NativePublicTermsValidationErrorV1> {
    let raw = PriceRaw::try_from(native_raw_v1(value, field)?)
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))?;
    let price = Price::from_raw_checked(raw, value.scale)
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))?;
    check_positive_price(price, "V1 public instrument price")
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))
}

fn validate_native_quantity_v1(
    value: InstrumentDecimal,
    field: NativePublicTermsFieldV1,
) -> Result<(), NativePublicTermsValidationErrorV1> {
    let raw = QuantityRaw::try_from(native_raw_v1(value, field)?)
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))?;
    let quantity = Quantity::from_raw_checked(raw, value.scale)
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))?;
    check_positive_quantity(quantity, "V1 public instrument quantity")
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))
}

fn native_timestamp_v1(
    value: i128,
    field: NativePublicTermsFieldV1,
) -> Result<UnixNanos, NativePublicTermsValidationErrorV1> {
    u64::try_from(value)
        .map(UnixNanos::new)
        .map_err(|_| NativePublicTermsValidationErrorV1::NativeRepresentation(field))
}

/// Sealed complete membership supplied only by an existing Owner-derived Universe receipt.
#[derive(Debug)]
pub struct InstrumentMasterUniverseMembershipV1 {
    pub(super) selection_identity: InstrumentMasterIdentity,
    pub(super) members: Vec<String>,
}

/// Existing Universe Selection authority adapter; it cannot be implemented by callers.
pub(crate) mod membership_seal {
    pub trait Sealed {}
}
impl membership_seal::Sealed for StrategyInputUniverseSelectionReceipt {}
impl membership_seal::Sealed for UniverseSelectionReadbackV1 {}

pub trait InstrumentMasterUniverseMembershipResolver:
    membership_seal::Sealed + Send + Sync
{
    /// Resolves the complete canonical membership for one exact sealed selection identity.
    ///
    /// # Errors
    ///
    /// Returns a fail-closed error when identity or canonical membership does not match.
    fn resolve_instrument_master_membership(
        &self,
        selection_identity: InstrumentMasterIdentity,
    ) -> Result<InstrumentMasterUniverseMembershipV1, InstrumentMasterError>;
}

impl InstrumentMasterUniverseMembershipResolver for StrategyInputUniverseSelectionReceipt {
    fn resolve_instrument_master_membership(
        &self,
        selection_identity: InstrumentMasterIdentity,
    ) -> Result<InstrumentMasterUniverseMembershipV1, InstrumentMasterError> {
        if self.selection_identity() != selection_identity {
            return Err(InstrumentMasterError::MembershipMismatch);
        }
        let members: Vec<String> = self
            .members()
            .iter()
            .map(|member| member.instrument().to_owned())
            .collect();
        authority::validate_members(&members)?;
        Ok(InstrumentMasterUniverseMembershipV1 {
            selection_identity,
            members,
        })
    }
}

impl InstrumentMasterUniverseMembershipResolver for UniverseSelectionReadbackV1 {
    fn resolve_instrument_master_membership(
        &self,
        selection_identity: InstrumentMasterIdentity,
    ) -> Result<InstrumentMasterUniverseMembershipV1, InstrumentMasterError> {
        if !verify_universe_selection_readback_v1(self)
            || self.record().identity() != selection_identity
        {
            return Err(InstrumentMasterError::MembershipMismatch);
        }
        let mut members = self
            .record()
            .membership()
            .iter()
            .filter(|membership| membership.included())
            .map(|membership| {
                std::str::from_utf8(membership.instrument())
                    .map(str::to_owned)
                    .map_err(|_| InstrumentMasterError::MembershipMismatch)
            })
            .collect::<Result<Vec<_>, _>>()?;
        members.sort();
        authority::validate_members(&members)?;
        Ok(InstrumentMasterUniverseMembershipV1 {
            selection_identity,
            members,
        })
    }
}

#[doc(hidden)]
pub mod resolver_seal {
    pub trait Sealed {}
}

/// Public read-only sealed Instrument Master resolver.
#[async_trait::async_trait]
pub trait InstrumentMasterResolver: resolver_seal::Sealed + Send + Sync {
    async fn resolve_instrument_master(
        &self,
        request: &UntrustedInstrumentMasterRequestV1,
        universe: Option<&dyn InstrumentMasterUniverseMembershipResolver>,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError>;

    async fn recover_instrument_master(
        &self,
        request_identity: InstrumentMasterIdentity,
        request_meaning_digest: InstrumentMasterIdentity,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError>;
}

/// Every failure is terminal for the attempted positive resolution and creates no inferred state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterError {
    InvalidFact,
    InvalidRequest,
    WrongRole,
    CodecMismatch,
    DigestMismatch,
    ClockUnavailable,
    ClockMismatch,
    ClockExpired,
    ClockDiscontinuous,
    FrontierMismatch,
    MembershipMismatch,
    UnknownIdentity,
    AmbiguousIdentity,
    MissingPredecessor,
    PredecessorBranch,
    PredecessorCycle,
    InvalidOverlap,
    RequestConflict,
    StoreUnavailable,
    StoreUntrusted,
    CommitInterrupted,
    ResponseLost,
}

impl Display for InstrumentMasterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}
impl std::error::Error for InstrumentMasterError {}

#[cfg(test)]
mod tests;
