//! Canonical public Instrument Master V2 facts and native replay preflight.
//!
//! V2 is additive: it neither decodes nor re-encodes the V1 grammar. It models public venue
//! metadata only. Account-specific commission schedules, leverage brackets, fees, and margins
//! belong to Strategy Factory's execution profile, not to the Market Data fact.
//!
//! The admitted raw inputs are deliberately narrow. An `exchangeInfo` response is a baseline,
//! a `!contractInfo` event is a delta, and provider `serverTime` is not provenance. Price and
//! quantity precision are explicit filter-derived values; display precision cannot substitute.
//!
//! This module creates no [`vibe_model::instruments::InstrumentAny`]. It returns only a validated
//! public-terms token; Strategy Factory must combine that token with its separately sealed economic
//! provenance and execution profile before any native construction.
//!
//! ```compile_fail
//! use vibe_data::owner::instrument_master_v2::ReplayExecutionProfileV2;
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::instrument_master_v2::ValidatedCryptoPerpetualPublicTermsV2;
//! fn economic_fields_do_not_cross_market_data(value: &ValidatedCryptoPerpetualPublicTermsV2) {
//!     let _ = value.maker_fee();
//!     let _ = value.taker_fee();
//!     let _ = value.initial_margin();
//!     let _ = value.maintenance_margin();
//! }
//! ```

use std::fmt::Display;

use vibe_core::UnixNanos;
use vibe_model::types::{
    fixed::{check_fixed_precision, mantissa_exponent_to_fixed_i128},
    money::{MONEY_RAW_MAX, MONEY_RAW_MIN, MoneyRaw},
    price::{Price, PriceRaw, check_positive_price},
    quantity::{Quantity, QuantityRaw, check_positive_quantity},
};

use super::source_binding::BindingDigest;

const FACT_SCHEMA_VERSION_V2: u16 = 2;
const FACT_RESERVED_V2: u16 = 0;
const FACT_DOMAIN_V2: &[u8] = b"VIBE_INSTRUMENT_MASTER_PUBLIC_FACT_V2";
const MAX_CANONICAL_BYTES_V2: usize = 64 * 1024;
const MAX_TEXT_BYTES_V2: usize = 1024;

/// A fact field's complete public meaning.
///
/// `Unbounded` is an explicit absence of a limit, `NotApplicable` says the field has no meaning
/// for this instrument, and `Unavailable` says the source did not establish the value. None of
/// those states is interchangeable with `Value`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FactValue<T> {
    Value(T),
    Unbounded,
    NotApplicable,
    Unavailable,
}

/// Canonical decimal represented without floating point.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentDecimalV2 {
    pub mantissa: i128,
    pub scale: u8,
}

impl InstrumentDecimalV2 {
    fn validate_canonical(self) -> Result<(), InstrumentMasterV2Error> {
        if self.scale > 38 || (self.scale != 0 && self.mantissa % 10 == 0) {
            Err(InstrumentMasterV2Error::InvalidDecimal)
        } else {
            Ok(())
        }
    }

    fn validate_positive(self) -> Result<(), InstrumentMasterV2Error> {
        self.validate_canonical()?;

        if self.mantissa <= 0 {
            Err(InstrumentMasterV2Error::InvalidDecimal)
        } else {
            Ok(())
        }
    }
}

/// Instrument classes admitted by this first independently useful V2 slice.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub enum PublicInstrumentClassV2 {
    CryptoPerpetual = 1,
}

impl PublicInstrumentClassV2 {
    fn decode(value: u16) -> Result<Self, InstrumentMasterV2Error> {
        match value {
            1 => Ok(Self::CryptoPerpetual),
            _ => Err(InstrumentMasterV2Error::CodecMismatch),
        }
    }
}

/// The independently useful public terms materialized by the latest admitted source event.
///
/// Fee and margin fields are intentionally absent. The `*_from_filter` names prevent a provider
/// display-precision field from being silently substituted for executable tick/step precision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentMasterPublicTermsV2 {
    pub base_currency: FactValue<String>,
    pub quote_currency: FactValue<String>,
    pub settlement_currency: FactValue<String>,
    pub contract_status: FactValue<String>,
    pub is_inverse: FactValue<bool>,
    pub price_precision_from_filter: FactValue<u8>,
    pub quantity_precision_from_filter: FactValue<u8>,
    pub price_increment_from_filter: FactValue<InstrumentDecimalV2>,
    pub quantity_increment_from_filter: FactValue<InstrumentDecimalV2>,
    pub contract_multiplier: FactValue<InstrumentDecimalV2>,
    pub lot_size: FactValue<InstrumentDecimalV2>,
    pub minimum_price: FactValue<InstrumentDecimalV2>,
    pub maximum_price: FactValue<InstrumentDecimalV2>,
    pub minimum_quantity: FactValue<InstrumentDecimalV2>,
    pub maximum_quantity: FactValue<InstrumentDecimalV2>,
    pub minimum_notional: FactValue<InstrumentDecimalV2>,
    pub maximum_notional: FactValue<InstrumentDecimalV2>,
}

/// Public `!contractInfo` patch admitted by this first slice.
///
/// The stream may update public contract status; baseline-only currencies, inverse semantics,
/// executable filters, multiplier, lot, and limits cannot be rewritten through this type. `None`
/// preserves status and `Some` replaces its complete state, including a non-value state.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InstrumentMasterPublicTermsDeltaV2 {
    pub contract_status: Option<FactValue<String>>,
}

impl InstrumentMasterPublicTermsDeltaV2 {
    fn is_empty(&self) -> bool {
        self.contract_status.is_none()
    }
}

/// Raw public `exchangeInfo` snapshot provenance. Provider `serverTime` is intentionally absent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExchangeInfoSnapshotProvenanceV2 {
    pub source_binding_identity: BindingDigest,
    pub source_binding_digest: BindingDigest,
    pub raw_payload_digest: BindingDigest,
    /// Owner-admitted effective time for the snapshot; never copied from provider `serverTime`.
    pub effective_from_ns: i128,
    pub retrieval_time_ns: i128,
    pub owner_observation_time_ns: i128,
}

/// An `exchangeInfo` baseline and its normalized public meaning.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExchangeInfoBaselineV2 {
    pub canonical_identity: String,
    pub venue_identity: String,
    pub raw_symbol: String,
    pub instrument_class: PublicInstrumentClassV2,
    pub provenance: ExchangeInfoSnapshotProvenanceV2,
    pub terms: InstrumentMasterPublicTermsV2,
}

/// Raw public `!contractInfo` delta and its exact predecessor binding.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractInfoDeltaV2 {
    pub canonical_identity: String,
    pub source_binding_identity: BindingDigest,
    pub source_binding_digest: BindingDigest,
    pub predecessor_source_event_digest: BindingDigest,
    pub raw_payload_digest: BindingDigest,
    pub correction_sequence: u64,
    pub provider_event_time_ns: i128,
    pub retrieval_time_ns: i128,
    pub owner_observation_time_ns: i128,
    pub changes: InstrumentMasterPublicTermsDeltaV2,
}

/// Canonical, content-addressed public fact. Its constructors validate raw lineage and merge rules.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentMasterFactV2 {
    canonical_identity: String,
    venue_identity: String,
    raw_symbol: String,
    instrument_class: PublicInstrumentClassV2,
    predecessor_fact_digest: Option<BindingDigest>,
    correction_sequence: u64,
    baseline: ExchangeInfoSnapshotProvenanceV2,
    latest_delta: Option<ContractInfoDeltaV2>,
    terms: InstrumentMasterPublicTermsV2,
    canonical_bytes: Vec<u8>,
    identity: BindingDigest,
}

impl InstrumentMasterFactV2 {
    /// Creates the genesis fact from one exact public `exchangeInfo` baseline.
    ///
    /// # Errors
    ///
    /// Returns an error when identity, provenance, terms, or canonical encoding is invalid.
    pub fn from_exchange_info_baseline(
        baseline: ExchangeInfoBaselineV2,
    ) -> Result<Self, InstrumentMasterV2Error> {
        validate_identity_text(&baseline.canonical_identity)?;
        validate_identity_text(&baseline.venue_identity)?;
        validate_identity_text(&baseline.raw_symbol)?;
        validate_snapshot(&baseline.provenance)?;
        validate_terms(&baseline.terms)?;

        Self::finish(
            baseline.canonical_identity,
            baseline.venue_identity,
            baseline.raw_symbol,
            baseline.instrument_class,
            None,
            1,
            baseline.provenance,
            None,
            baseline.terms,
        )
    }

    /// Applies exactly one public `!contractInfo` delta to this fact.
    ///
    /// The delta must name this canonical instrument, the same admitted source binding, this
    /// fact's latest raw event, and the immediately next correction sequence.
    ///
    /// # Errors
    ///
    /// Returns an error when the delta is invalid or is not this fact's direct successor.
    pub fn apply_contract_info_delta(
        &self,
        delta: ContractInfoDeltaV2,
    ) -> Result<Self, InstrumentMasterV2Error> {
        validate_delta(&delta)?;

        if delta.canonical_identity != self.canonical_identity {
            return Err(InstrumentMasterV2Error::InstrumentMismatch);
        }

        if delta.source_binding_identity != self.baseline.source_binding_identity
            || delta.source_binding_digest != self.baseline.source_binding_digest
        {
            return Err(InstrumentMasterV2Error::SourceBindingMismatch);
        }

        if delta.predecessor_source_event_digest != self.latest_source_event_digest() {
            return Err(InstrumentMasterV2Error::SourceEventPredecessorMismatch);
        }

        if self.correction_sequence.checked_add(1) != Some(delta.correction_sequence) {
            return Err(InstrumentMasterV2Error::CorrectionSequenceMismatch);
        }

        if delta.owner_observation_time_ns < self.latest_owner_observation_time_ns() {
            return Err(InstrumentMasterV2Error::TimeRegression);
        }

        let terms = merge_terms(&self.terms, &delta.changes);
        validate_terms(&terms)?;
        Self::finish(
            self.canonical_identity.clone(),
            self.venue_identity.clone(),
            self.raw_symbol.clone(),
            self.instrument_class,
            Some(self.identity),
            delta.correction_sequence,
            self.baseline.clone(),
            Some(delta),
            terms,
        )
    }

    /// Strictly decodes one V2 fact and reproduces its canonical bytes and identity.
    ///
    /// Genesis must be decoded with `None`; a successor must be decoded with its exact direct
    /// predecessor. This prevents a structurally valid successor from bypassing merge validation.
    ///
    /// # Errors
    ///
    /// Returns an error for non-canonical bytes or a missing/mismatched direct predecessor.
    pub fn from_canonical_bytes(
        bytes: &[u8],
        predecessor: Option<&Self>,
    ) -> Result<Self, InstrumentMasterV2Error> {
        if bytes.len() > MAX_CANONICAL_BYTES_V2 {
            return Err(InstrumentMasterV2Error::CodecMismatch);
        }
        let mut decoder = Decoder::new(bytes);
        if decoder.u16()? != FACT_SCHEMA_VERSION_V2 || decoder.u16()? != FACT_RESERVED_V2 {
            return Err(InstrumentMasterV2Error::CodecMismatch);
        }
        let canonical_identity = decoder.string()?;
        let venue_identity = decoder.string()?;
        let raw_symbol = decoder.string()?;
        let instrument_class = PublicInstrumentClassV2::decode(decoder.u16()?)?;
        let predecessor_fact_digest = decoder.optional_digest()?;
        let correction_sequence = decoder.u64()?;
        let baseline = decode_snapshot(&mut decoder)?;
        let latest_delta = match decoder.u8()? {
            0 => None,
            1 => Some(decode_delta(&mut decoder)?),
            _ => return Err(InstrumentMasterV2Error::CodecMismatch),
        };
        let terms = decode_terms(&mut decoder)?;
        decoder.finish()?;

        validate_identity_text(&canonical_identity)?;
        validate_identity_text(&venue_identity)?;
        validate_identity_text(&raw_symbol)?;
        validate_snapshot(&baseline)?;
        validate_terms(&terms)?;

        match (&predecessor_fact_digest, &latest_delta, correction_sequence) {
            (None, None, 1) => {}
            (Some(_), Some(delta), sequence) if sequence > 1 => {
                validate_delta(delta)?;
                if delta.canonical_identity != canonical_identity
                    || delta.source_binding_identity != baseline.source_binding_identity
                    || delta.source_binding_digest != baseline.source_binding_digest
                    || delta.correction_sequence != sequence
                {
                    return Err(InstrumentMasterV2Error::CodecMismatch);
                }
            }
            _ => return Err(InstrumentMasterV2Error::CodecMismatch),
        }

        let fact = Self::finish(
            canonical_identity,
            venue_identity,
            raw_symbol,
            instrument_class,
            predecessor_fact_digest,
            correction_sequence,
            baseline,
            latest_delta,
            terms,
        )?;

        if fact.canonical_bytes != bytes {
            return Err(InstrumentMasterV2Error::CodecMismatch);
        }

        match predecessor {
            None if fact.predecessor_fact_digest.is_none() && fact.latest_delta.is_none() => {
                Ok(fact)
            }
            Some(predecessor) if fact.is_direct_successor_of(predecessor) => Ok(fact),
            _ => Err(InstrumentMasterV2Error::SuccessorMismatch),
        }
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "the canonical fact constructor follows one fixed field order"
    )]
    fn finish(
        canonical_identity: String,
        venue_identity: String,
        raw_symbol: String,
        instrument_class: PublicInstrumentClassV2,
        predecessor_fact_digest: Option<BindingDigest>,
        correction_sequence: u64,
        baseline: ExchangeInfoSnapshotProvenanceV2,
        latest_delta: Option<ContractInfoDeltaV2>,
        terms: InstrumentMasterPublicTermsV2,
    ) -> Result<Self, InstrumentMasterV2Error> {
        let mut encoder = Encoder::default();
        encoder.u16(FACT_SCHEMA_VERSION_V2);
        encoder.u16(FACT_RESERVED_V2);
        encoder.string(&canonical_identity)?;
        encoder.string(&venue_identity)?;
        encoder.string(&raw_symbol)?;
        encoder.u16(instrument_class as u16);
        encoder.optional_digest(predecessor_fact_digest);
        encoder.u64(correction_sequence);
        encode_snapshot(&mut encoder, &baseline);
        match &latest_delta {
            None => encoder.u8(0),
            Some(delta) => {
                encoder.u8(1);
                encode_delta(&mut encoder, delta)?;
            }
        }
        encode_terms(&mut encoder, &terms)?;
        let canonical_bytes = encoder.finish();
        if canonical_bytes.len() > MAX_CANONICAL_BYTES_V2 {
            return Err(InstrumentMasterV2Error::CodecMismatch);
        }
        let identity = digest(FACT_DOMAIN_V2, &canonical_bytes);
        Ok(Self {
            canonical_identity,
            venue_identity,
            raw_symbol,
            instrument_class,
            predecessor_fact_digest,
            correction_sequence,
            baseline,
            latest_delta,
            terms,
            canonical_bytes,
            identity,
        })
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
    pub fn raw_symbol(&self) -> &str {
        &self.raw_symbol
    }

    #[must_use]
    pub const fn instrument_class(&self) -> PublicInstrumentClassV2 {
        self.instrument_class
    }

    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    #[must_use]
    pub const fn predecessor_fact_digest(&self) -> Option<BindingDigest> {
        self.predecessor_fact_digest
    }

    #[must_use]
    pub const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }

    #[must_use]
    pub const fn terms(&self) -> &InstrumentMasterPublicTermsV2 {
        &self.terms
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub const fn baseline_provenance(&self) -> &ExchangeInfoSnapshotProvenanceV2 {
        &self.baseline
    }

    #[must_use]
    pub const fn latest_delta(&self) -> Option<&ContractInfoDeltaV2> {
        self.latest_delta.as_ref()
    }

    #[must_use]
    pub fn latest_source_event_digest(&self) -> BindingDigest {
        self.latest_delta
            .as_ref()
            .map_or(self.baseline.raw_payload_digest, |delta| {
                delta.raw_payload_digest
            })
    }

    fn latest_owner_observation_time_ns(&self) -> i128 {
        self.latest_delta
            .as_ref()
            .map_or(self.baseline.owner_observation_time_ns, |delta| {
                delta.owner_observation_time_ns
            })
    }

    fn latest_event_time_ns(&self) -> i128 {
        self.latest_delta
            .as_ref()
            .map_or(self.baseline.effective_from_ns, |delta| {
                delta.provider_event_time_ns
            })
    }

    /// Verifies the complete direct-successor relation, including baseline inheritance and the
    /// exact field-wise delta merge.
    #[must_use]
    pub fn is_direct_successor_of(&self, predecessor: &Self) -> bool {
        let Some(delta) = self.latest_delta.clone() else {
            return false;
        };
        predecessor
            .apply_contract_info_delta(delta)
            .is_ok_and(|expected| expected == *self)
    }

    /// Validates the complete Market Data-owned part of a native crypto-perpetual projection.
    ///
    /// The output has no public constructor. The method rejects every unavailable field, checks
    /// native fixed-point and timestamp representability, and does not map unavailable values to
    /// native constructor defaults. Crypto perpetuals have no onboard/delivery constructor
    /// coordinates; those lifecycle values remain not applicable rather than synthesized.
    ///
    /// # Errors
    ///
    /// Returns a field-specific failure when any public/native structural term is incomplete.
    pub fn validate_native_crypto_perpetual_public_terms(
        &self,
    ) -> Result<ValidatedCryptoPerpetualPublicTermsV2, PublicTermsValidationErrorV2> {
        let terms = &self.terms;
        let base_currency = require_text(&terms.base_currency, NativeFieldV2::BaseCurrency)?;
        let quote_currency = require_text(&terms.quote_currency, NativeFieldV2::QuoteCurrency)?;
        let settlement_currency = require_text(
            &terms.settlement_currency,
            NativeFieldV2::SettlementCurrency,
        )?;
        let contract_status = require_text(&terms.contract_status, NativeFieldV2::ContractStatus)?;
        let is_inverse = require_value(&terms.is_inverse, NativeFieldV2::IsInverse)?;
        let price_precision = require_value(
            &terms.price_precision_from_filter,
            NativeFieldV2::PricePrecisionFromFilter,
        )?;
        let quantity_precision = require_value(
            &terms.quantity_precision_from_filter,
            NativeFieldV2::QuantityPrecisionFromFilter,
        )?;
        let price_increment = require_value(
            &terms.price_increment_from_filter,
            NativeFieldV2::PriceIncrementFromFilter,
        )?;
        let quantity_increment = require_value(
            &terms.quantity_increment_from_filter,
            NativeFieldV2::QuantityIncrementFromFilter,
        )?;
        let contract_multiplier = require_value(
            &terms.contract_multiplier,
            NativeFieldV2::ContractMultiplier,
        )?;
        let lot_size = require_value(&terms.lot_size, NativeFieldV2::LotSize)?;

        if price_precision != price_increment.scale
            || quantity_precision != quantity_increment.scale
        {
            return Err(PublicTermsValidationErrorV2::PrecisionMismatch);
        }
        validate_native_precision(price_precision, NativeFieldV2::PricePrecisionFromFilter)?;
        validate_native_precision(
            quantity_precision,
            NativeFieldV2::QuantityPrecisionFromFilter,
        )?;
        validate_native_price(price_increment, NativeFieldV2::PriceIncrementFromFilter)?;
        validate_native_quantity(
            quantity_increment,
            NativeFieldV2::QuantityIncrementFromFilter,
        )?;
        validate_native_quantity(contract_multiplier, NativeFieldV2::ContractMultiplier)?;
        validate_native_quantity(lot_size, NativeFieldV2::LotSize)?;
        let minimum_price = require_limit(&terms.minimum_price, NativeFieldV2::MinimumPrice)?;
        let maximum_price = require_limit(&terms.maximum_price, NativeFieldV2::MaximumPrice)?;
        let minimum_quantity =
            require_limit(&terms.minimum_quantity, NativeFieldV2::MinimumQuantity)?;
        let maximum_quantity =
            require_limit(&terms.maximum_quantity, NativeFieldV2::MaximumQuantity)?;
        let minimum_notional =
            require_limit(&terms.minimum_notional, NativeFieldV2::MinimumNotional)?;
        let maximum_notional =
            require_limit(&terms.maximum_notional, NativeFieldV2::MaximumNotional)?;
        validate_optional_native_price(minimum_price, NativeFieldV2::MinimumPrice)?;
        validate_optional_native_price(maximum_price, NativeFieldV2::MaximumPrice)?;
        validate_optional_native_quantity(minimum_quantity, NativeFieldV2::MinimumQuantity)?;
        validate_optional_native_quantity(maximum_quantity, NativeFieldV2::MaximumQuantity)?;
        validate_optional_native_money(minimum_notional, NativeFieldV2::MinimumNotional)?;
        validate_optional_native_money(maximum_notional, NativeFieldV2::MaximumNotional)?;
        let ts_event =
            validate_native_timestamp(self.latest_event_time_ns(), NativeFieldV2::EventTimestamp)?;
        let ts_init = validate_native_timestamp(
            self.latest_owner_observation_time_ns(),
            NativeFieldV2::InitTimestamp,
        )?;
        Ok(ValidatedCryptoPerpetualPublicTermsV2 {
            instrument_master_fact_identity: self.identity,
            predecessor_fact_digest: self.predecessor_fact_digest,
            source_binding_identity: self.baseline.source_binding_identity,
            source_binding_digest: self.baseline.source_binding_digest,
            baseline_raw_payload_digest: self.baseline.raw_payload_digest,
            latest_source_event_digest: self.latest_source_event_digest(),
            correction_sequence: self.correction_sequence,
            canonical_identity: self.canonical_identity.clone(),
            venue_identity: self.venue_identity.clone(),
            raw_symbol: self.raw_symbol.clone(),
            instrument_class: self.instrument_class,
            base_currency: base_currency.to_owned(),
            quote_currency: quote_currency.to_owned(),
            settlement_currency: settlement_currency.to_owned(),
            contract_status: contract_status.to_owned(),
            is_inverse,
            price_precision,
            quantity_precision,
            price_increment,
            quantity_increment,
            contract_multiplier,
            lot_size,
            minimum_price,
            maximum_price,
            minimum_quantity,
            maximum_quantity,
            minimum_notional,
            maximum_notional,
            ts_event,
            ts_init,
        })
    }
}

/// Validated Market Data-owned public terms for later native composition.
///
/// It cannot be constructed by callers and deliberately carries no replay economics.
#[derive(Debug, Eq, PartialEq)]
pub struct ValidatedCryptoPerpetualPublicTermsV2 {
    instrument_master_fact_identity: BindingDigest,
    predecessor_fact_digest: Option<BindingDigest>,
    source_binding_identity: BindingDigest,
    source_binding_digest: BindingDigest,
    baseline_raw_payload_digest: BindingDigest,
    latest_source_event_digest: BindingDigest,
    correction_sequence: u64,
    canonical_identity: String,
    venue_identity: String,
    raw_symbol: String,
    instrument_class: PublicInstrumentClassV2,
    base_currency: String,
    quote_currency: String,
    settlement_currency: String,
    contract_status: String,
    is_inverse: bool,
    price_precision: u8,
    quantity_precision: u8,
    price_increment: InstrumentDecimalV2,
    quantity_increment: InstrumentDecimalV2,
    contract_multiplier: InstrumentDecimalV2,
    lot_size: InstrumentDecimalV2,
    minimum_price: Option<InstrumentDecimalV2>,
    maximum_price: Option<InstrumentDecimalV2>,
    minimum_quantity: Option<InstrumentDecimalV2>,
    maximum_quantity: Option<InstrumentDecimalV2>,
    minimum_notional: Option<InstrumentDecimalV2>,
    maximum_notional: Option<InstrumentDecimalV2>,
    ts_event: UnixNanos,
    ts_init: UnixNanos,
}

impl ValidatedCryptoPerpetualPublicTermsV2 {
    #[must_use]
    pub const fn instrument_master_fact_identity(&self) -> BindingDigest {
        self.instrument_master_fact_identity
    }

    #[must_use]
    pub const fn predecessor_fact_digest(&self) -> Option<BindingDigest> {
        self.predecessor_fact_digest
    }

    #[must_use]
    pub const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }

    #[must_use]
    pub const fn source_binding_digest(&self) -> BindingDigest {
        self.source_binding_digest
    }

    #[must_use]
    pub const fn baseline_raw_payload_digest(&self) -> BindingDigest {
        self.baseline_raw_payload_digest
    }

    #[must_use]
    pub const fn latest_source_event_digest(&self) -> BindingDigest {
        self.latest_source_event_digest
    }

    #[must_use]
    pub const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
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
    pub fn raw_symbol(&self) -> &str {
        &self.raw_symbol
    }

    #[must_use]
    pub const fn instrument_class(&self) -> PublicInstrumentClassV2 {
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
    pub fn contract_status(&self) -> &str {
        &self.contract_status
    }

    #[must_use]
    pub const fn is_inverse(&self) -> bool {
        self.is_inverse
    }

    #[must_use]
    pub const fn price_precision(&self) -> u8 {
        self.price_precision
    }

    #[must_use]
    pub const fn quantity_precision(&self) -> u8 {
        self.quantity_precision
    }

    #[must_use]
    pub const fn price_increment(&self) -> InstrumentDecimalV2 {
        self.price_increment
    }

    #[must_use]
    pub const fn quantity_increment(&self) -> InstrumentDecimalV2 {
        self.quantity_increment
    }

    #[must_use]
    pub const fn contract_multiplier(&self) -> InstrumentDecimalV2 {
        self.contract_multiplier
    }

    #[must_use]
    pub const fn lot_size(&self) -> InstrumentDecimalV2 {
        self.lot_size
    }

    #[must_use]
    pub const fn minimum_price(&self) -> Option<InstrumentDecimalV2> {
        self.minimum_price
    }

    #[must_use]
    pub const fn maximum_price(&self) -> Option<InstrumentDecimalV2> {
        self.maximum_price
    }

    #[must_use]
    pub const fn minimum_quantity(&self) -> Option<InstrumentDecimalV2> {
        self.minimum_quantity
    }

    #[must_use]
    pub const fn maximum_quantity(&self) -> Option<InstrumentDecimalV2> {
        self.maximum_quantity
    }

    #[must_use]
    pub const fn minimum_notional(&self) -> Option<InstrumentDecimalV2> {
        self.minimum_notional
    }

    #[must_use]
    pub const fn maximum_notional(&self) -> Option<InstrumentDecimalV2> {
        self.maximum_notional
    }

    #[must_use]
    pub const fn ts_event(&self) -> UnixNanos {
        self.ts_event
    }

    #[must_use]
    pub fn ts_event_ns(&self) -> i128 {
        i128::from(self.ts_event.as_u64())
    }

    #[must_use]
    pub const fn ts_init(&self) -> UnixNanos {
        self.ts_init
    }

    #[must_use]
    pub fn ts_init_ns(&self) -> i128 {
        i128::from(self.ts_init.as_u64())
    }
}

/// Field names surfaced by fail-closed public-terms validation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeFieldV2 {
    BaseCurrency,
    QuoteCurrency,
    SettlementCurrency,
    ContractStatus,
    IsInverse,
    PricePrecisionFromFilter,
    QuantityPrecisionFromFilter,
    PriceIncrementFromFilter,
    QuantityIncrementFromFilter,
    ContractMultiplier,
    LotSize,
    MinimumPrice,
    MaximumPrice,
    MinimumQuantity,
    MaximumQuantity,
    MinimumNotional,
    MaximumNotional,
    EventTimestamp,
    InitTimestamp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicTermsValidationErrorV2 {
    MissingValue(NativeFieldV2),
    UnavailableLimit(NativeFieldV2),
    PrecisionMismatch,
    NativeRepresentation(NativeFieldV2),
}

impl Display for PublicTermsValidationErrorV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for PublicTermsValidationErrorV2 {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterV2Error {
    InvalidIdentity,
    InvalidDecimal,
    InvalidProvenance,
    InvalidDelta,
    InstrumentMismatch,
    SourceBindingMismatch,
    SourceEventPredecessorMismatch,
    CorrectionSequenceMismatch,
    TimeRegression,
    SuccessorMismatch,
    CodecMismatch,
}

impl Display for InstrumentMasterV2Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for InstrumentMasterV2Error {}

fn validate_identity_text(value: &str) -> Result<(), InstrumentMasterV2Error> {
    if value.is_empty() || value.len() > MAX_TEXT_BYTES_V2 {
        Err(InstrumentMasterV2Error::InvalidIdentity)
    } else {
        Ok(())
    }
}

fn is_zero(value: BindingDigest) -> bool {
    value.as_bytes().iter().all(|byte| *byte == 0)
}

fn validate_snapshot(
    snapshot: &ExchangeInfoSnapshotProvenanceV2,
) -> Result<(), InstrumentMasterV2Error> {
    if is_zero(snapshot.source_binding_identity)
        || is_zero(snapshot.source_binding_digest)
        || is_zero(snapshot.raw_payload_digest)
        || snapshot.effective_from_ns > snapshot.retrieval_time_ns
        || snapshot.retrieval_time_ns > snapshot.owner_observation_time_ns
    {
        Err(InstrumentMasterV2Error::InvalidProvenance)
    } else {
        Ok(())
    }
}

fn validate_delta(delta: &ContractInfoDeltaV2) -> Result<(), InstrumentMasterV2Error> {
    validate_identity_text(&delta.canonical_identity)?;
    if is_zero(delta.source_binding_identity)
        || is_zero(delta.source_binding_digest)
        || is_zero(delta.predecessor_source_event_digest)
        || is_zero(delta.raw_payload_digest)
        || delta.predecessor_source_event_digest == delta.raw_payload_digest
        || delta.correction_sequence <= 1
        || delta.provider_event_time_ns > delta.retrieval_time_ns
        || delta.retrieval_time_ns > delta.owner_observation_time_ns
        || delta.changes.is_empty()
    {
        Err(InstrumentMasterV2Error::InvalidDelta)
    } else {
        validate_delta_terms(&delta.changes)
    }
}

fn validate_fact_text(value: &FactValue<String>) -> Result<(), InstrumentMasterV2Error> {
    if let FactValue::Value(value) = value {
        validate_identity_text(value)?;
    }
    Ok(())
}

fn validate_precision(value: &FactValue<u8>) -> Result<(), InstrumentMasterV2Error> {
    if matches!(value, FactValue::Value(value) if *value > 38) {
        Err(InstrumentMasterV2Error::InvalidDecimal)
    } else {
        Ok(())
    }
}

fn validate_positive_decimal(
    value: &FactValue<InstrumentDecimalV2>,
) -> Result<(), InstrumentMasterV2Error> {
    if let FactValue::Value(value) = value {
        value.validate_positive()?;
    }
    Ok(())
}

fn validate_terms(terms: &InstrumentMasterPublicTermsV2) -> Result<(), InstrumentMasterV2Error> {
    for value in [
        &terms.base_currency,
        &terms.quote_currency,
        &terms.settlement_currency,
        &terms.contract_status,
    ] {
        validate_fact_text(value)?;
    }

    for value in [
        &terms.price_precision_from_filter,
        &terms.quantity_precision_from_filter,
    ] {
        validate_precision(value)?;
    }

    for value in [
        &terms.price_increment_from_filter,
        &terms.quantity_increment_from_filter,
        &terms.contract_multiplier,
        &terms.lot_size,
        &terms.minimum_price,
        &terms.maximum_price,
        &terms.minimum_quantity,
        &terms.maximum_quantity,
        &terms.minimum_notional,
        &terms.maximum_notional,
    ] {
        validate_positive_decimal(value)?;
    }
    Ok(())
}

fn validate_delta_terms(
    delta: &InstrumentMasterPublicTermsDeltaV2,
) -> Result<(), InstrumentMasterV2Error> {
    if let Some(value) = &delta.contract_status {
        validate_fact_text(value)?;
    }
    Ok(())
}

fn merge_terms(
    baseline: &InstrumentMasterPublicTermsV2,
    delta: &InstrumentMasterPublicTermsDeltaV2,
) -> InstrumentMasterPublicTermsV2 {
    InstrumentMasterPublicTermsV2 {
        base_currency: baseline.base_currency.clone(),
        quote_currency: baseline.quote_currency.clone(),
        settlement_currency: baseline.settlement_currency.clone(),
        contract_status: delta
            .contract_status
            .clone()
            .unwrap_or_else(|| baseline.contract_status.clone()),
        is_inverse: baseline.is_inverse.clone(),
        price_precision_from_filter: baseline.price_precision_from_filter.clone(),
        quantity_precision_from_filter: baseline.quantity_precision_from_filter.clone(),
        price_increment_from_filter: baseline.price_increment_from_filter.clone(),
        quantity_increment_from_filter: baseline.quantity_increment_from_filter.clone(),
        contract_multiplier: baseline.contract_multiplier.clone(),
        lot_size: baseline.lot_size.clone(),
        minimum_price: baseline.minimum_price.clone(),
        maximum_price: baseline.maximum_price.clone(),
        minimum_quantity: baseline.minimum_quantity.clone(),
        maximum_quantity: baseline.maximum_quantity.clone(),
        minimum_notional: baseline.minimum_notional.clone(),
        maximum_notional: baseline.maximum_notional.clone(),
    }
}

fn require_value<T: Copy>(
    value: &FactValue<T>,
    field: NativeFieldV2,
) -> Result<T, PublicTermsValidationErrorV2> {
    match value {
        FactValue::Value(value) => Ok(*value),
        FactValue::Unbounded | FactValue::NotApplicable | FactValue::Unavailable => {
            Err(PublicTermsValidationErrorV2::MissingValue(field))
        }
    }
}

fn require_text(
    value: &FactValue<String>,
    field: NativeFieldV2,
) -> Result<&str, PublicTermsValidationErrorV2> {
    match value {
        FactValue::Value(value) => Ok(value),
        FactValue::Unbounded | FactValue::NotApplicable | FactValue::Unavailable => {
            Err(PublicTermsValidationErrorV2::MissingValue(field))
        }
    }
}

fn require_limit(
    value: &FactValue<InstrumentDecimalV2>,
    field: NativeFieldV2,
) -> Result<Option<InstrumentDecimalV2>, PublicTermsValidationErrorV2> {
    match value {
        FactValue::Value(value) => Ok(Some(*value)),
        FactValue::Unbounded | FactValue::NotApplicable => Ok(None),
        FactValue::Unavailable => Err(PublicTermsValidationErrorV2::UnavailableLimit(field)),
    }
}

fn validate_native_precision(
    precision: u8,
    field: NativeFieldV2,
) -> Result<(), PublicTermsValidationErrorV2> {
    check_fixed_precision(precision)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))
}

fn validate_native_money(
    value: InstrumentDecimalV2,
    field: NativeFieldV2,
) -> Result<(), PublicTermsValidationErrorV2> {
    validate_native_precision(value.scale, field)?;
    let raw = MoneyRaw::try_from(native_raw_i128(value, field)?)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))?;

    if (MONEY_RAW_MIN..=MONEY_RAW_MAX).contains(&raw) {
        Ok(())
    } else {
        Err(PublicTermsValidationErrorV2::NativeRepresentation(field))
    }
}

fn validate_optional_native_money(
    value: Option<InstrumentDecimalV2>,
    field: NativeFieldV2,
) -> Result<(), PublicTermsValidationErrorV2> {
    value.map_or(Ok(()), |value| validate_native_money(value, field))
}

fn native_raw_i128(
    value: InstrumentDecimalV2,
    field: NativeFieldV2,
) -> Result<i128, PublicTermsValidationErrorV2> {
    let exponent = i8::try_from(value.scale)
        .map(|scale| -scale)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))?;
    mantissa_exponent_to_fixed_i128(value.mantissa, exponent, value.scale)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))
}

fn validate_native_price(
    value: InstrumentDecimalV2,
    field: NativeFieldV2,
) -> Result<(), PublicTermsValidationErrorV2> {
    let raw = PriceRaw::try_from(native_raw_i128(value, field)?)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))?;
    let price = Price::from_raw_checked(raw, value.scale)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))?;
    check_positive_price(price, "public instrument price")
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))
}

fn validate_optional_native_price(
    value: Option<InstrumentDecimalV2>,
    field: NativeFieldV2,
) -> Result<(), PublicTermsValidationErrorV2> {
    value.map_or(Ok(()), |value| validate_native_price(value, field))
}

fn validate_native_quantity(
    value: InstrumentDecimalV2,
    field: NativeFieldV2,
) -> Result<(), PublicTermsValidationErrorV2> {
    let raw = QuantityRaw::try_from(native_raw_i128(value, field)?)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))?;
    let quantity = Quantity::from_raw_checked(raw, value.scale)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))?;
    check_positive_quantity(quantity, "public instrument quantity")
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))
}

fn validate_optional_native_quantity(
    value: Option<InstrumentDecimalV2>,
    field: NativeFieldV2,
) -> Result<(), PublicTermsValidationErrorV2> {
    value.map_or(Ok(()), |value| validate_native_quantity(value, field))
}

fn validate_native_timestamp(
    value: i128,
    field: NativeFieldV2,
) -> Result<UnixNanos, PublicTermsValidationErrorV2> {
    u64::try_from(value)
        .map(UnixNanos::new)
        .map_err(|_| PublicTermsValidationErrorV2::NativeRepresentation(field))
}

fn digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(&[0]);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

#[derive(Default)]
struct Encoder(Vec<u8>);

impl Encoder {
    fn finish(self) -> Vec<u8> {
        self.0
    }

    fn u8(&mut self, value: u8) {
        self.0.push(value);
    }

    fn u16(&mut self, value: u16) {
        self.0.extend(value.to_be_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.0.extend(value.to_be_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.0.extend(value.to_be_bytes());
    }

    fn i128(&mut self, value: i128) {
        self.0.extend(value.to_be_bytes());
    }

    fn digest(&mut self, value: BindingDigest) {
        self.0.extend(value.as_bytes());
    }

    fn optional_digest(&mut self, value: Option<BindingDigest>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.digest(value);
            }
        }
    }

    fn string(&mut self, value: &str) -> Result<(), InstrumentMasterV2Error> {
        if value.len() > MAX_TEXT_BYTES_V2 {
            return Err(InstrumentMasterV2Error::CodecMismatch);
        }
        let length =
            u32::try_from(value.len()).map_err(|_| InstrumentMasterV2Error::CodecMismatch)?;
        self.u32(length);
        self.0.extend(value.as_bytes());
        Ok(())
    }
}

struct Decoder<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> Decoder<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], InstrumentMasterV2Error> {
        let end = self
            .cursor
            .checked_add(length)
            .ok_or(InstrumentMasterV2Error::CodecMismatch)?;
        let value = self
            .bytes
            .get(self.cursor..end)
            .ok_or(InstrumentMasterV2Error::CodecMismatch)?;
        self.cursor = end;
        Ok(value)
    }

    fn finish(self) -> Result<(), InstrumentMasterV2Error> {
        if self.cursor == self.bytes.len() {
            Ok(())
        } else {
            Err(InstrumentMasterV2Error::CodecMismatch)
        }
    }

    fn u8(&mut self) -> Result<u8, InstrumentMasterV2Error> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, InstrumentMasterV2Error> {
        Ok(u16::from_be_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| InstrumentMasterV2Error::CodecMismatch)?,
        ))
    }

    fn u32(&mut self) -> Result<u32, InstrumentMasterV2Error> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| InstrumentMasterV2Error::CodecMismatch)?,
        ))
    }

    fn u64(&mut self) -> Result<u64, InstrumentMasterV2Error> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| InstrumentMasterV2Error::CodecMismatch)?,
        ))
    }

    fn i128(&mut self) -> Result<i128, InstrumentMasterV2Error> {
        Ok(i128::from_be_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| InstrumentMasterV2Error::CodecMismatch)?,
        ))
    }

    fn digest(&mut self) -> Result<BindingDigest, InstrumentMasterV2Error> {
        Ok(BindingDigest::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| InstrumentMasterV2Error::CodecMismatch)?,
        ))
    }

    fn optional_digest(&mut self) -> Result<Option<BindingDigest>, InstrumentMasterV2Error> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.digest()?)),
            _ => Err(InstrumentMasterV2Error::CodecMismatch),
        }
    }

    fn string(&mut self) -> Result<String, InstrumentMasterV2Error> {
        let length =
            usize::try_from(self.u32()?).map_err(|_| InstrumentMasterV2Error::CodecMismatch)?;
        if length > MAX_TEXT_BYTES_V2 {
            return Err(InstrumentMasterV2Error::CodecMismatch);
        }
        String::from_utf8(self.take(length)?.to_vec())
            .map_err(|_| InstrumentMasterV2Error::CodecMismatch)
    }
}

fn encode_snapshot(encoder: &mut Encoder, value: &ExchangeInfoSnapshotProvenanceV2) {
    encoder.digest(value.source_binding_identity);
    encoder.digest(value.source_binding_digest);
    encoder.digest(value.raw_payload_digest);
    encoder.i128(value.effective_from_ns);
    encoder.i128(value.retrieval_time_ns);
    encoder.i128(value.owner_observation_time_ns);
}

fn decode_snapshot(
    decoder: &mut Decoder<'_>,
) -> Result<ExchangeInfoSnapshotProvenanceV2, InstrumentMasterV2Error> {
    Ok(ExchangeInfoSnapshotProvenanceV2 {
        source_binding_identity: decoder.digest()?,
        source_binding_digest: decoder.digest()?,
        raw_payload_digest: decoder.digest()?,
        effective_from_ns: decoder.i128()?,
        retrieval_time_ns: decoder.i128()?,
        owner_observation_time_ns: decoder.i128()?,
    })
}

fn encode_delta(
    encoder: &mut Encoder,
    value: &ContractInfoDeltaV2,
) -> Result<(), InstrumentMasterV2Error> {
    encoder.string(&value.canonical_identity)?;
    encoder.digest(value.source_binding_identity);
    encoder.digest(value.source_binding_digest);
    encoder.digest(value.predecessor_source_event_digest);
    encoder.digest(value.raw_payload_digest);
    encoder.u64(value.correction_sequence);
    encoder.i128(value.provider_event_time_ns);
    encoder.i128(value.retrieval_time_ns);
    encoder.i128(value.owner_observation_time_ns);
    encode_delta_terms(encoder, &value.changes)
}

fn decode_delta(decoder: &mut Decoder<'_>) -> Result<ContractInfoDeltaV2, InstrumentMasterV2Error> {
    Ok(ContractInfoDeltaV2 {
        canonical_identity: decoder.string()?,
        source_binding_identity: decoder.digest()?,
        source_binding_digest: decoder.digest()?,
        predecessor_source_event_digest: decoder.digest()?,
        raw_payload_digest: decoder.digest()?,
        correction_sequence: decoder.u64()?,
        provider_event_time_ns: decoder.i128()?,
        retrieval_time_ns: decoder.i128()?,
        owner_observation_time_ns: decoder.i128()?,
        changes: decode_delta_terms(decoder)?,
    })
}

fn encode_decimal(encoder: &mut Encoder, value: InstrumentDecimalV2) {
    encoder.i128(value.mantissa);
    encoder.u8(value.scale);
}

fn decode_decimal(
    decoder: &mut Decoder<'_>,
) -> Result<InstrumentDecimalV2, InstrumentMasterV2Error> {
    let value = InstrumentDecimalV2 {
        mantissa: decoder.i128()?,
        scale: decoder.u8()?,
    };
    value.validate_canonical()?;
    Ok(value)
}

fn encode_fact_value<T>(
    encoder: &mut Encoder,
    value: &FactValue<T>,
    encode: impl FnOnce(&mut Encoder, &T) -> Result<(), InstrumentMasterV2Error>,
) -> Result<(), InstrumentMasterV2Error> {
    match value {
        FactValue::Value(value) => {
            encoder.u8(1);
            encode(encoder, value)?;
        }
        FactValue::Unbounded => encoder.u8(2),
        FactValue::NotApplicable => encoder.u8(3),
        FactValue::Unavailable => encoder.u8(4),
    }
    Ok(())
}

fn decode_fact_value<T>(
    decoder: &mut Decoder<'_>,
    decode: impl FnOnce(&mut Decoder<'_>) -> Result<T, InstrumentMasterV2Error>,
) -> Result<FactValue<T>, InstrumentMasterV2Error> {
    Ok(match decoder.u8()? {
        1 => FactValue::Value(decode(decoder)?),
        2 => FactValue::Unbounded,
        3 => FactValue::NotApplicable,
        4 => FactValue::Unavailable,
        _ => return Err(InstrumentMasterV2Error::CodecMismatch),
    })
}

fn encode_optional_fact_value<T>(
    encoder: &mut Encoder,
    value: Option<&FactValue<T>>,
    encode: impl FnOnce(&mut Encoder, &T) -> Result<(), InstrumentMasterV2Error>,
) -> Result<(), InstrumentMasterV2Error> {
    match value {
        None => encoder.u8(0),
        Some(value) => {
            encoder.u8(1);
            encode_fact_value(encoder, value, encode)?;
        }
    }
    Ok(())
}

fn decode_optional_fact_value<T>(
    decoder: &mut Decoder<'_>,
    decode: impl FnOnce(&mut Decoder<'_>) -> Result<T, InstrumentMasterV2Error>,
) -> Result<Option<FactValue<T>>, InstrumentMasterV2Error> {
    match decoder.u8()? {
        0 => Ok(None),
        1 => Ok(Some(decode_fact_value(decoder, decode)?)),
        _ => Err(InstrumentMasterV2Error::CodecMismatch),
    }
}

fn encode_terms(
    encoder: &mut Encoder,
    terms: &InstrumentMasterPublicTermsV2,
) -> Result<(), InstrumentMasterV2Error> {
    for value in [
        &terms.base_currency,
        &terms.quote_currency,
        &terms.settlement_currency,
        &terms.contract_status,
    ] {
        encode_fact_value(encoder, value, |encoder, value| encoder.string(value))?;
    }

    encode_fact_value(encoder, &terms.is_inverse, |encoder, value| {
        encoder.u8(u8::from(*value));
        Ok(())
    })?;

    for value in [
        &terms.price_precision_from_filter,
        &terms.quantity_precision_from_filter,
    ] {
        encode_fact_value(encoder, value, |encoder, value| {
            encoder.u8(*value);
            Ok(())
        })?;
    }

    for value in [
        &terms.price_increment_from_filter,
        &terms.quantity_increment_from_filter,
        &terms.contract_multiplier,
        &terms.lot_size,
        &terms.minimum_price,
        &terms.maximum_price,
        &terms.minimum_quantity,
        &terms.maximum_quantity,
        &terms.minimum_notional,
        &terms.maximum_notional,
    ] {
        encode_fact_value(encoder, value, |encoder, value| {
            encode_decimal(encoder, *value);
            Ok(())
        })?;
    }
    Ok(())
}

fn decode_terms(
    decoder: &mut Decoder<'_>,
) -> Result<InstrumentMasterPublicTermsV2, InstrumentMasterV2Error> {
    Ok(InstrumentMasterPublicTermsV2 {
        base_currency: decode_fact_value(decoder, decode_string)?,
        quote_currency: decode_fact_value(decoder, decode_string)?,
        settlement_currency: decode_fact_value(decoder, decode_string)?,
        contract_status: decode_fact_value(decoder, decode_string)?,
        is_inverse: decode_fact_value(decoder, decode_bool)?,
        price_precision_from_filter: decode_fact_value(decoder, decode_u8)?,
        quantity_precision_from_filter: decode_fact_value(decoder, decode_u8)?,
        price_increment_from_filter: decode_fact_value(decoder, decode_decimal)?,
        quantity_increment_from_filter: decode_fact_value(decoder, decode_decimal)?,
        contract_multiplier: decode_fact_value(decoder, decode_decimal)?,
        lot_size: decode_fact_value(decoder, decode_decimal)?,
        minimum_price: decode_fact_value(decoder, decode_decimal)?,
        maximum_price: decode_fact_value(decoder, decode_decimal)?,
        minimum_quantity: decode_fact_value(decoder, decode_decimal)?,
        maximum_quantity: decode_fact_value(decoder, decode_decimal)?,
        minimum_notional: decode_fact_value(decoder, decode_decimal)?,
        maximum_notional: decode_fact_value(decoder, decode_decimal)?,
    })
}

fn encode_delta_terms(
    encoder: &mut Encoder,
    terms: &InstrumentMasterPublicTermsDeltaV2,
) -> Result<(), InstrumentMasterV2Error> {
    encode_optional_fact_value(encoder, terms.contract_status.as_ref(), |encoder, value| {
        encoder.string(value)
    })
}

fn decode_delta_terms(
    decoder: &mut Decoder<'_>,
) -> Result<InstrumentMasterPublicTermsDeltaV2, InstrumentMasterV2Error> {
    Ok(InstrumentMasterPublicTermsDeltaV2 {
        contract_status: decode_optional_fact_value(decoder, decode_string)?,
    })
}

fn decode_string(decoder: &mut Decoder<'_>) -> Result<String, InstrumentMasterV2Error> {
    decoder.string()
}

fn decode_u8(decoder: &mut Decoder<'_>) -> Result<u8, InstrumentMasterV2Error> {
    decoder.u8()
}

fn decode_bool(decoder: &mut Decoder<'_>) -> Result<bool, InstrumentMasterV2Error> {
    match decoder.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(InstrumentMasterV2Error::CodecMismatch),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use vibe_model::types::fixed::FIXED_PRECISION;

    fn id(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    const fn decimal(mantissa: i128, scale: u8) -> InstrumentDecimalV2 {
        InstrumentDecimalV2 { mantissa, scale }
    }

    fn canonical_decimal_from_native_money_raw(raw: MoneyRaw) -> InstrumentDecimalV2 {
        #[cfg(feature = "high-precision")]
        let mut mantissa = raw;
        #[cfg(not(feature = "high-precision"))]
        let mut mantissa = i128::from(raw);
        let mut scale = FIXED_PRECISION;
        while scale > 0 && mantissa % 10 == 0 {
            mantissa /= 10;
            scale -= 1;
        }
        decimal(mantissa, scale)
    }

    fn complete_terms() -> InstrumentMasterPublicTermsV2 {
        InstrumentMasterPublicTermsV2 {
            base_currency: FactValue::Value("BTC".to_owned()),
            quote_currency: FactValue::Value("USDT".to_owned()),
            settlement_currency: FactValue::Value("USDT".to_owned()),
            contract_status: FactValue::Value("TRADING".to_owned()),
            is_inverse: FactValue::Value(false),
            price_precision_from_filter: FactValue::Value(2),
            quantity_precision_from_filter: FactValue::Value(3),
            price_increment_from_filter: FactValue::Value(decimal(1, 2)),
            quantity_increment_from_filter: FactValue::Value(decimal(1, 3)),
            contract_multiplier: FactValue::Value(decimal(1, 0)),
            lot_size: FactValue::Value(decimal(1, 3)),
            minimum_price: FactValue::Value(decimal(1, 2)),
            maximum_price: FactValue::Unbounded,
            minimum_quantity: FactValue::Value(decimal(1, 3)),
            maximum_quantity: FactValue::Unbounded,
            minimum_notional: FactValue::NotApplicable,
            maximum_notional: FactValue::Unbounded,
        }
    }

    fn baseline(terms: InstrumentMasterPublicTermsV2) -> ExchangeInfoBaselineV2 {
        ExchangeInfoBaselineV2 {
            canonical_identity: "BTCUSDT-PERP.BINANCE".to_owned(),
            venue_identity: "BINANCE".to_owned(),
            raw_symbol: "BTCUSDT".to_owned(),
            instrument_class: PublicInstrumentClassV2::CryptoPerpetual,
            provenance: ExchangeInfoSnapshotProvenanceV2 {
                source_binding_identity: id(1),
                source_binding_digest: id(2),
                raw_payload_digest: id(3),
                effective_from_ns: 99,
                retrieval_time_ns: 100,
                owner_observation_time_ns: 101,
            },
            terms,
        }
    }

    #[rstest]
    fn all_four_fact_states_have_distinct_canonical_round_trip() {
        let mut terms = complete_terms();
        terms.maximum_notional = FactValue::Unavailable;
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();
        let decoded =
            InstrumentMasterFactV2::from_canonical_bytes(fact.canonical_bytes(), None).unwrap();

        assert_eq!(decoded, fact);
        assert_eq!(decoded.terms().maximum_price, FactValue::Unbounded);
        assert_eq!(decoded.terms().minimum_notional, FactValue::NotApplicable);
        assert_eq!(decoded.terms().maximum_notional, FactValue::Unavailable);
    }

    #[rstest]
    fn identity_mapping_input_must_be_complete() {
        let mut missing_canonical = baseline(complete_terms());
        missing_canonical.canonical_identity.clear();
        assert_eq!(
            InstrumentMasterFactV2::from_exchange_info_baseline(missing_canonical),
            Err(InstrumentMasterV2Error::InvalidIdentity)
        );

        let mut missing_venue = baseline(complete_terms());
        missing_venue.venue_identity.clear();
        assert_eq!(
            InstrumentMasterFactV2::from_exchange_info_baseline(missing_venue),
            Err(InstrumentMasterV2Error::InvalidIdentity)
        );

        let mut missing_symbol = baseline(complete_terms());
        missing_symbol.raw_symbol.clear();
        assert_eq!(
            InstrumentMasterFactV2::from_exchange_info_baseline(missing_symbol),
            Err(InstrumentMasterV2Error::InvalidIdentity)
        );
    }

    #[rstest]
    fn contract_info_delta_merges_only_addressed_fields_and_seals_successor() {
        let baseline =
            InstrumentMasterFactV2::from_exchange_info_baseline(baseline(complete_terms()))
                .unwrap();
        let delta = ContractInfoDeltaV2 {
            canonical_identity: baseline.canonical_identity().to_owned(),
            source_binding_identity: id(1),
            source_binding_digest: id(2),
            predecessor_source_event_digest: id(3),
            raw_payload_digest: id(4),
            correction_sequence: 2,
            provider_event_time_ns: 102,
            retrieval_time_ns: 103,
            owner_observation_time_ns: 104,
            changes: InstrumentMasterPublicTermsDeltaV2 {
                contract_status: Some(FactValue::Value("SETTLING".to_owned())),
            },
        };

        let successor = baseline.apply_contract_info_delta(delta).unwrap();

        assert_eq!(
            successor.predecessor_fact_digest(),
            Some(baseline.identity())
        );
        assert_eq!(
            successor.terms().base_currency,
            baseline.terms().base_currency
        );
        assert_eq!(
            successor.terms().contract_status,
            FactValue::Value("SETTLING".to_owned())
        );
        assert_eq!(successor.terms().is_inverse, FactValue::Value(false));
        assert!(successor.is_direct_successor_of(&baseline));
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(successor.canonical_bytes(), None),
            Err(InstrumentMasterV2Error::SuccessorMismatch)
        );
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(
                successor.canonical_bytes(),
                Some(&baseline),
            )
            .unwrap(),
            successor
        );
    }

    #[rstest]
    fn successor_rejects_wrong_raw_predecessor_sequence_and_source() {
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(complete_terms()))
            .unwrap();
        let delta = |predecessor, sequence, source| ContractInfoDeltaV2 {
            canonical_identity: fact.canonical_identity().to_owned(),
            source_binding_identity: source,
            source_binding_digest: id(2),
            predecessor_source_event_digest: predecessor,
            raw_payload_digest: id(4),
            correction_sequence: sequence,
            provider_event_time_ns: 102,
            retrieval_time_ns: 103,
            owner_observation_time_ns: 104,
            changes: InstrumentMasterPublicTermsDeltaV2 {
                contract_status: Some(FactValue::Value("SETTLING".to_owned())),
            },
        };

        assert_eq!(
            fact.apply_contract_info_delta(delta(id(9), 2, id(1))),
            Err(InstrumentMasterV2Error::SourceEventPredecessorMismatch)
        );
        assert_eq!(
            fact.apply_contract_info_delta(delta(id(3), 3, id(1))),
            Err(InstrumentMasterV2Error::CorrectionSequenceMismatch)
        );
        assert_eq!(
            fact.apply_contract_info_delta(delta(id(3), 2, id(9))),
            Err(InstrumentMasterV2Error::SourceBindingMismatch)
        );
    }

    #[rstest]
    fn public_terms_validation_refuses_missing_structural_fields() {
        for expected in [
            NativeFieldV2::BaseCurrency,
            NativeFieldV2::QuoteCurrency,
            NativeFieldV2::IsInverse,
            NativeFieldV2::SettlementCurrency,
            NativeFieldV2::LotSize,
            NativeFieldV2::ContractStatus,
            NativeFieldV2::PricePrecisionFromFilter,
            NativeFieldV2::QuantityPrecisionFromFilter,
            NativeFieldV2::PriceIncrementFromFilter,
            NativeFieldV2::QuantityIncrementFromFilter,
            NativeFieldV2::ContractMultiplier,
        ] {
            let mut terms = complete_terms();
            match expected {
                NativeFieldV2::BaseCurrency => terms.base_currency = FactValue::Unavailable,
                NativeFieldV2::QuoteCurrency => terms.quote_currency = FactValue::Unavailable,
                NativeFieldV2::IsInverse => terms.is_inverse = FactValue::Unavailable,
                NativeFieldV2::SettlementCurrency => {
                    terms.settlement_currency = FactValue::Unavailable;
                }
                NativeFieldV2::LotSize => terms.lot_size = FactValue::Unavailable,
                NativeFieldV2::ContractStatus => {
                    terms.contract_status = FactValue::Unavailable;
                }
                NativeFieldV2::PricePrecisionFromFilter => {
                    terms.price_precision_from_filter = FactValue::Unavailable;
                }
                NativeFieldV2::QuantityPrecisionFromFilter => {
                    terms.quantity_precision_from_filter = FactValue::Unavailable;
                }
                NativeFieldV2::PriceIncrementFromFilter => {
                    terms.price_increment_from_filter = FactValue::Unavailable;
                }
                NativeFieldV2::QuantityIncrementFromFilter => {
                    terms.quantity_increment_from_filter = FactValue::Unavailable;
                }
                NativeFieldV2::ContractMultiplier => {
                    terms.contract_multiplier = FactValue::Unavailable;
                }
                _ => unreachable!(),
            }
            let fact =
                InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();
            assert_eq!(
                fact.validate_native_crypto_perpetual_public_terms(),
                Err(PublicTermsValidationErrorV2::MissingValue(expected))
            );
        }
    }

    #[rstest]
    fn public_terms_validation_refuses_unavailable_limit() {
        let mut terms = complete_terms();
        terms.maximum_notional = FactValue::Unavailable;
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();

        assert_eq!(
            fact.validate_native_crypto_perpetual_public_terms(),
            Err(PublicTermsValidationErrorV2::UnavailableLimit(
                NativeFieldV2::MaximumNotional
            ))
        );
    }

    #[rstest]
    fn public_terms_validation_rejects_display_precision_substitution() {
        let mut terms = complete_terms();
        terms.price_precision_from_filter = FactValue::Value(3);
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();

        assert_eq!(
            fact.validate_native_crypto_perpetual_public_terms(),
            Err(PublicTermsValidationErrorV2::PrecisionMismatch)
        );
    }

    #[rstest]
    fn public_terms_validation_rejects_native_precision_overflow() {
        let mut terms = complete_terms();
        terms.price_precision_from_filter = FactValue::Value(38);
        terms.price_increment_from_filter = FactValue::Value(decimal(1, 38));
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();

        assert_eq!(
            fact.validate_native_crypto_perpetual_public_terms(),
            Err(PublicTermsValidationErrorV2::NativeRepresentation(
                NativeFieldV2::PricePrecisionFromFilter
            ))
        );
    }

    #[rstest]
    fn public_terms_validation_uses_current_native_precision_configuration() {
        let mut terms = complete_terms();
        terms.price_precision_from_filter = FactValue::Value(FIXED_PRECISION);
        terms.quantity_precision_from_filter = FactValue::Value(FIXED_PRECISION);
        terms.price_increment_from_filter = FactValue::Value(decimal(1, FIXED_PRECISION));
        terms.quantity_increment_from_filter = FactValue::Value(decimal(1, FIXED_PRECISION));
        terms.minimum_price = FactValue::Value(decimal(1, FIXED_PRECISION));
        terms.minimum_quantity = FactValue::Value(decimal(1, FIXED_PRECISION));
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();

        let projection = fact
            .validate_native_crypto_perpetual_public_terms()
            .unwrap();

        assert_eq!(projection.price_precision(), FIXED_PRECISION);
        assert_eq!(projection.quantity_precision(), FIXED_PRECISION);
        assert_eq!(projection.price_increment(), decimal(1, FIXED_PRECISION));
        assert_eq!(projection.quantity_increment(), decimal(1, FIXED_PRECISION));
        assert_eq!(projection.minimum_notional(), None);
        assert_eq!(projection.maximum_price(), None);
    }

    #[rstest]
    fn public_terms_validation_rejects_notional_outside_native_money_range() {
        let mut terms = complete_terms();
        terms.maximum_notional = FactValue::Value(decimal(i128::MAX, 0));
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();

        assert_eq!(
            fact.validate_native_crypto_perpetual_public_terms(),
            Err(PublicTermsValidationErrorV2::NativeRepresentation(
                NativeFieldV2::MaximumNotional
            ))
        );
    }

    #[rstest]
    fn public_terms_validation_accepts_positive_native_money_boundaries() {
        let mut terms = complete_terms();
        let maximum_notional = canonical_decimal_from_native_money_raw(MONEY_RAW_MAX);
        terms.minimum_notional = FactValue::Value(decimal(1, FIXED_PRECISION));
        terms.maximum_notional = FactValue::Value(maximum_notional);
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();

        let projection = fact
            .validate_native_crypto_perpetual_public_terms()
            .unwrap();

        assert_eq!(
            projection.minimum_notional(),
            Some(decimal(1, FIXED_PRECISION))
        );
        assert_eq!(projection.maximum_notional(), Some(maximum_notional));
    }

    #[rstest]
    fn public_terms_validation_rejects_negative_native_timestamps() {
        let mut negative = baseline(complete_terms());
        negative.provenance.effective_from_ns = -3;
        negative.provenance.retrieval_time_ns = -2;
        negative.provenance.owner_observation_time_ns = -1;
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(negative).unwrap();

        assert_eq!(
            fact.validate_native_crypto_perpetual_public_terms(),
            Err(PublicTermsValidationErrorV2::NativeRepresentation(
                NativeFieldV2::EventTimestamp
            ))
        );
        assert_eq!(
            validate_native_timestamp(-1, NativeFieldV2::InitTimestamp),
            Err(PublicTermsValidationErrorV2::NativeRepresentation(
                NativeFieldV2::InitTimestamp
            ))
        );
    }

    #[rstest]
    fn validated_public_terms_preserve_values_and_provenance() {
        let mut terms = complete_terms();
        terms.maximum_notional = FactValue::Unbounded;
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();

        let projection = fact
            .validate_native_crypto_perpetual_public_terms()
            .unwrap();

        assert_eq!(
            projection.instrument_master_fact_identity(),
            fact.identity()
        );
        assert!(!projection.is_inverse());
        assert_eq!(projection.settlement_currency(), "USDT");
        assert_eq!(projection.lot_size(), decimal(1, 3));
        assert_eq!(projection.maximum_notional(), None);
        assert_eq!(projection.source_binding_identity(), id(1));
        assert_eq!(projection.source_binding_digest(), id(2));
        assert_eq!(projection.baseline_raw_payload_digest(), id(3));
        assert_eq!(projection.latest_source_event_digest(), id(3));
        assert_eq!(projection.correction_sequence(), 1);
        assert_eq!(projection.predecessor_fact_digest(), None);
        assert_eq!(projection.ts_event(), UnixNanos::new(99));
        assert_eq!(projection.ts_init(), UnixNanos::new(101));
        assert_eq!(projection.ts_event_ns(), 99);
        assert_eq!(projection.ts_init_ns(), 101);
        assert_eq!(
            projection.instrument_class(),
            PublicInstrumentClassV2::CryptoPerpetual
        );
    }
}
