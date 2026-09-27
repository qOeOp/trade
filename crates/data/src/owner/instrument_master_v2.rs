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

use super::{
    ADMITTED_UNIVERSE_MEMBER_COUNTS,
    instrument_master::{InstrumentClass, InstrumentDecimal, InstrumentMasterFactV1},
    source_binding::BindingDigest,
};

// Version 3 adds the terms basis to the snapshot. No production writer produced a version 2 fact.
const FACT_SCHEMA_VERSION_V2: u16 = 3;
const FACT_RESERVED_V2: u16 = 0;
const FACT_DOMAIN_V2: &[u8] = b"VIBE_INSTRUMENT_MASTER_PUBLIC_FACT_V2";
const CUT_DOMAIN_V2: &[u8] = b"VIBE_INSTRUMENT_MASTER_PUBLIC_CUT_V2";
const RECEIPT_DOMAIN_V2: &[u8] = b"VIBE_INSTRUMENT_MASTER_PUBLIC_RECEIPT_V2";
const OUTBOX_DOMAIN_V2: &[u8] = b"VIBE_INSTRUMENT_MASTER_PUBLIC_OUTBOX_V2";
const REQUEST_BINDING_DOMAIN_V2: &[u8] = b"VIBE_INSTRUMENT_MASTER_PUBLIC_REQUEST_BINDING_V2";
pub const BACKTEST_OWNER_ROLE_V1: &str = "BACKTEST_OWNER_V1";
const NATIVE_REPLAY_REQUEST_DOMAIN_V2: &[u8] =
    b"market-data.instrument-master-v2.native-replay-request.v1\0";
const MAX_R_AND_D_REQUEST_IDENTITY_BYTES_V2: usize = 512;
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

/// The temporal basis of a V2 fact's terms.
///
/// `exchangeInfo` states an instrument's terms as they are when it is retrieved. A baseline therefore
/// observes its terms from `retrieval_time_ns` on and assumes them over `[effective_from_ns,
/// retrieval_time_ns)`, back to the listing. This names that assumption in the fact itself, so a
/// report can tell a Replay priced before the retrieval, on assumed terms, from one priced after.
///
/// A later `exchangeInfo` snapshot whose terms equal its predecessor's keeps that basis: the terms
/// are still the baseline's, now also observed later. One whose terms differ ends it for good, since
/// what held before that snapshot is then not these terms.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum InstrumentTermsBasisV2 {
    /// Terms observed at retrieval and assumed back to the listing.
    RetrievedTermsAssumedSinceListing = 1,
    /// Terms a later snapshot observed to differ from the baseline's, at that snapshot or after it.
    /// Before that snapshot they did not hold, so a Replay cannot be priced on them without knowing
    /// its window, which the cut does not yet read; the cut refuses such a member by name.
    ObservedSinceTermsChange = 2,
}

impl InstrumentTermsBasisV2 {
    fn decode(value: u8) -> Result<Self, InstrumentMasterV2Error> {
        match value {
            1 => Ok(Self::RetrievedTermsAssumedSinceListing),
            2 => Ok(Self::ObservedSinceTermsChange),
            _ => Err(InstrumentMasterV2Error::CodecMismatch),
        }
    }
}

/// One row of the Owner's closed venue table: what an admitted Source Binding's exact dataset
/// mapping fixes about every instrument read from it.
///
/// The payload states none of these. A linear USD-M perpetual has no inverse flag and no contract
/// size in `exchangeInfo`, and its canonical identity is a convention, so each comes from the row the
/// binding selects rather than from the caller or the payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentMasterVenueV2 {
    /// The Source Binding's `adapter.dataset_mapping`, compared as one exact string.
    pub dataset_mapping: &'static str,
    /// The venue identity every fact from this dataset carries.
    pub venue_identity: &'static str,
    /// Appended to the raw symbol to form the canonical identity.
    pub canonical_identity_suffix: &'static str,
    /// Whether the dataset's contracts are inverse.
    pub is_inverse: bool,
    /// The dataset's contract multiplier.
    pub contract_multiplier: InstrumentDecimalV2,
}

/// The Owner's closed venue table.
///
/// Its only row is Binance's USD-M `exchangeInfo`. The canonical identity form is the one Instrument
/// Master V1 perpetual facts and the inherited Binance adapter's instrument identifier use,
/// `BTCUSDT-PERP.BINANCE` for the raw symbol `BTCUSDT`, so V1 and V2 name one instrument alike.
pub const INSTRUMENT_MASTER_VENUES_V2: &[InstrumentMasterVenueV2] = &[InstrumentMasterVenueV2 {
    dataset_mapping: "usdm/exchangeInfo",
    venue_identity: "BINANCE",
    canonical_identity_suffix: "-PERP.BINANCE",
    is_inverse: false,
    contract_multiplier: InstrumentDecimalV2 {
        mantissa: 1,
        scale: 0,
    },
}];

/// The row for a Source Binding's exact dataset mapping, or none. No prefix or segment of the
/// mapping is interpreted.
#[must_use]
pub fn instrument_master_venue_v2(
    dataset_mapping: &str,
) -> Option<&'static InstrumentMasterVenueV2> {
    INSTRUMENT_MASTER_VENUES_V2
        .iter()
        .find(|venue| venue.dataset_mapping == dataset_mapping)
}

/// What the Owner states about one `exchangeInfo` retrieval: the binding it holds admitted, the
/// instant the caller retrieved it, and the Owner's own observation. None of it is in the payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExchangeInfoRetrievalV2 {
    pub source_binding_identity: BindingDigest,
    pub source_binding_digest: BindingDigest,
    pub retrieval_time_ns: i128,
    pub owner_observation_time_ns: i128,
}

/// Why an `exchangeInfo` payload yields no baseline for a raw symbol.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExchangeInfoNormalizationErrorV2 {
    /// The payload is not a JSON object with a `symbols` array.
    NotExchangeInfo,
    /// No `symbols` entry has the raw symbol.
    SymbolAbsent,
    /// More than one entry has it.
    SymbolAmbiguous,
    /// The entry's `contractType` is not `PERPETUAL`.
    ContractTypeUnsupported,
    /// The entry carries `contractSize`, the shape of a COIN-M entry, contradicting the dataset.
    DatasetMismatch,
    /// The entry has no `onboardDate`, or it is later than the retrieval.
    OnboardDateUnavailable,
    /// A required filter or field is absent, a filter type appears twice, or a decimal breaks the
    /// accepted syntax or is not positive where the term requires it.
    FilterUnavailable,
}

const EXCHANGE_INFO_PAYLOAD_DOMAIN_V2: &[u8] = b"VIBE_INSTRUMENT_MASTER_EXCHANGE_INFO_PAYLOAD_V2";

/// The digest of an `exchangeInfo` payload's exact bytes, as every V2 baseline records it.
///
/// This is the one definition: an intake that must show it read the same snapshot as a baseline
/// compares this digest of the bytes it was given with the baseline's `raw_payload_digest`.
#[must_use]
pub fn exchange_info_payload_digest_v2(payload: &[u8]) -> BindingDigest {
    digest(EXCHANGE_INFO_PAYLOAD_DOMAIN_V2, payload)
}

impl ExchangeInfoBaselineV2 {
    /// Derives one instrument's baseline from a raw USD-M `exchangeInfo` payload.
    ///
    /// This is the only definition of how `exchangeInfo` becomes V2 terms; the documentation's
    /// mapping table describes it. The payload's digest is computed here from the exact bytes, the
    /// effective instant is the entry's `onboardDate`, every term comes from the entry's filters, and
    /// the venue, inverse flag, contract multiplier and canonical identity come from `venue`. The
    /// result still has to pass [`InstrumentMasterFactV2::from_exchange_info_baseline`].
    ///
    /// # Errors
    ///
    /// Returns the named reason the payload yields no baseline for `raw_symbol`.
    pub fn from_usdm_exchange_info(
        payload: &[u8],
        raw_symbol: &str,
        venue: &InstrumentMasterVenueV2,
        retrieval: ExchangeInfoRetrievalV2,
    ) -> Result<Self, ExchangeInfoNormalizationErrorV2> {
        use ExchangeInfoNormalizationErrorV2 as Refused;

        let root: serde_json::Value =
            serde_json::from_slice(payload).map_err(|_| Refused::NotExchangeInfo)?;
        let symbols = root
            .get("symbols")
            .and_then(serde_json::Value::as_array)
            .ok_or(Refused::NotExchangeInfo)?;
        let mut matching = symbols.iter().filter(|entry| {
            entry.get("symbol").and_then(serde_json::Value::as_str) == Some(raw_symbol)
        });
        let entry = matching.next().ok_or(Refused::SymbolAbsent)?;

        if matching.next().is_some() {
            return Err(Refused::SymbolAmbiguous);
        }

        if entry.get("contractSize").is_some() {
            return Err(Refused::DatasetMismatch);
        }

        if entry
            .get("contractType")
            .and_then(serde_json::Value::as_str)
            != Some("PERPETUAL")
        {
            return Err(Refused::ContractTypeUnsupported);
        }
        let onboard_ms = entry
            .get("onboardDate")
            .and_then(serde_json::Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or(Refused::OnboardDateUnavailable)?;
        let effective_from_ns = i128::from(onboard_ms) * 1_000_000;

        if effective_from_ns > retrieval.retrieval_time_ns {
            return Err(Refused::OnboardDateUnavailable);
        }
        let text = |field: &str| {
            entry
                .get(field)
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
                .ok_or(Refused::FilterUnavailable)
        };
        let filters = ExchangeInfoFiltersV2::read(entry)?;
        let tick = filters.positive("PRICE_FILTER", "tickSize")?;
        let step = filters.positive("LOT_SIZE", "stepSize")?;

        Ok(Self {
            canonical_identity: format!("{raw_symbol}{}", venue.canonical_identity_suffix),
            venue_identity: venue.venue_identity.to_owned(),
            raw_symbol: raw_symbol.to_owned(),
            instrument_class: PublicInstrumentClassV2::CryptoPerpetual,
            provenance: ExchangeInfoSnapshotProvenanceV2 {
                source_binding_identity: retrieval.source_binding_identity,
                source_binding_digest: retrieval.source_binding_digest,
                raw_payload_digest: exchange_info_payload_digest_v2(payload),
                effective_from_ns,
                retrieval_time_ns: retrieval.retrieval_time_ns,
                owner_observation_time_ns: retrieval.owner_observation_time_ns,
            },
            terms: InstrumentMasterPublicTermsV2 {
                base_currency: FactValue::Value(text("baseAsset")?),
                quote_currency: FactValue::Value(text("quoteAsset")?),
                settlement_currency: FactValue::Value(text("marginAsset")?),
                contract_status: FactValue::Value(text("status")?),
                is_inverse: FactValue::Value(venue.is_inverse),
                price_precision_from_filter: FactValue::Value(tick.scale),
                quantity_precision_from_filter: FactValue::Value(step.scale),
                price_increment_from_filter: FactValue::Value(tick),
                quantity_increment_from_filter: FactValue::Value(step),
                contract_multiplier: FactValue::Value(venue.contract_multiplier),
                lot_size: FactValue::Value(step),
                minimum_price: filters.bound("PRICE_FILTER", "minPrice")?,
                maximum_price: filters.bound("PRICE_FILTER", "maxPrice")?,
                minimum_quantity: filters.bound("LOT_SIZE", "minQty")?,
                maximum_quantity: filters.bound("LOT_SIZE", "maxQty")?,
                minimum_notional: filters.optional_bound("MIN_NOTIONAL", "notional")?,
                // The cap exists; it lives in leverage brackets, which `exchangeInfo` omits.
                maximum_notional: FactValue::Unavailable,
            },
        })
    }
}

/// When a `!contractInfo` event was received, as the caller states it, and the Owner's own
/// observation. Neither is in the event.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ContractInfoRetrievalV2 {
    pub retrieval_time_ns: i128,
    pub owner_observation_time_ns: i128,
}

/// Why a `!contractInfo` event yields no status delta of a fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContractInfoNormalizationErrorV2 {
    /// The text is not one JSON object whose `e` is `contractInfo`, `E` is not a non-negative
    /// integer, or `cs` is not a non-empty text.
    InvalidEvent,
    /// `s` is not the fact's raw symbol.
    SymbolMismatch,
    /// `ct` is not `PERPETUAL`.
    ContractTypeUnsupported,
    /// `st` is present and is not `1`, the USD-M system.
    DatasetMismatch,
    /// The event instant is later than the retrieval.
    EventAfterRetrieval,
    /// The event instant is not later than the fact's latest event instant.
    EventOutOfOrder,
    /// `cs` is the fact's current status, so the event changed nothing the fact holds.
    StatusUnchanged,
}

const CONTRACT_INFO_PAYLOAD_DOMAIN_V2: &[u8] = b"VIBE_INSTRUMENT_MASTER_CONTRACT_INFO_PAYLOAD_V2";

/// The digest of a `!contractInfo` event's exact bytes, as every V2 status delta records it.
#[must_use]
pub fn contract_info_payload_digest_v2(payload: &[u8]) -> BindingDigest {
    digest(CONTRACT_INFO_PAYLOAD_DOMAIN_V2, payload)
}

/// One millisecond in nanoseconds: `!contractInfo` states its event instant in milliseconds.
const NANOS_PER_MILLI: i128 = 1_000_000;

/// One entry's filters by type, each type at most once.
struct ExchangeInfoFiltersV2<'a>(Vec<(&'a str, &'a serde_json::Map<String, serde_json::Value>)>);

impl<'a> ExchangeInfoFiltersV2<'a> {
    fn read(entry: &'a serde_json::Value) -> Result<Self, ExchangeInfoNormalizationErrorV2> {
        let mut filters: Vec<(&str, &serde_json::Map<String, serde_json::Value>)> = Vec::new();

        for filter in entry
            .get("filters")
            .and_then(serde_json::Value::as_array)
            .ok_or(ExchangeInfoNormalizationErrorV2::FilterUnavailable)?
        {
            let filter = filter
                .as_object()
                .ok_or(ExchangeInfoNormalizationErrorV2::FilterUnavailable)?;
            let kind = filter
                .get("filterType")
                .and_then(serde_json::Value::as_str)
                .ok_or(ExchangeInfoNormalizationErrorV2::FilterUnavailable)?;

            if filters.iter().any(|(listed, _)| *listed == kind) {
                return Err(ExchangeInfoNormalizationErrorV2::FilterUnavailable);
            }
            filters.push((kind, filter));
        }
        Ok(Self(filters))
    }

    fn filter(&self, kind: &str) -> Option<&serde_json::Map<String, serde_json::Value>> {
        self.0
            .iter()
            .find(|(listed, _)| *listed == kind)
            .map(|(_, filter)| *filter)
    }

    fn decimal(
        &self,
        kind: &str,
        field: &str,
    ) -> Result<ExchangeInfoDecimalV2, ExchangeInfoNormalizationErrorV2> {
        let text = self
            .filter(kind)
            .and_then(|filter| filter.get(field))
            .and_then(serde_json::Value::as_str)
            .ok_or(ExchangeInfoNormalizationErrorV2::FilterUnavailable)?;
        parse_exchange_info_decimal_v2(text)
            .ok_or(ExchangeInfoNormalizationErrorV2::FilterUnavailable)
    }

    /// A term that must be a positive value.
    fn positive(
        &self,
        kind: &str,
        field: &str,
    ) -> Result<InstrumentDecimalV2, ExchangeInfoNormalizationErrorV2> {
        match self.decimal(kind, field)? {
            ExchangeInfoDecimalV2::Positive(value) => Ok(value),
            ExchangeInfoDecimalV2::Zero => Err(ExchangeInfoNormalizationErrorV2::FilterUnavailable),
        }
    }

    /// A bound: `"0"` sets no limit.
    fn bound(
        &self,
        kind: &str,
        field: &str,
    ) -> Result<FactValue<InstrumentDecimalV2>, ExchangeInfoNormalizationErrorV2> {
        Ok(match self.decimal(kind, field)? {
            ExchangeInfoDecimalV2::Positive(value) => FactValue::Value(value),
            ExchangeInfoDecimalV2::Zero => FactValue::Unbounded,
        })
    }

    /// A bound whose filter may be absent, which the payload leaves unstated.
    fn optional_bound(
        &self,
        kind: &str,
        field: &str,
    ) -> Result<FactValue<InstrumentDecimalV2>, ExchangeInfoNormalizationErrorV2> {
        if self.filter(kind).is_none() {
            return Ok(FactValue::Unavailable);
        }
        self.bound(kind, field)
    }
}

/// An `exchangeInfo` decimal: zero, which a bound uses for "no limit", or a positive value.
enum ExchangeInfoDecimalV2 {
    Zero,
    Positive(InstrumentDecimalV2),
}

/// Parses an `exchangeInfo` decimal: digits with an optional fraction, nothing else. Returns the
/// canonical value, with redundant trailing fractional zeros removed.
fn parse_exchange_info_decimal_v2(text: &str) -> Option<ExchangeInfoDecimalV2> {
    let (whole, fraction) = text.split_once('.').unwrap_or((text, ""));

    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || (text.contains('.') && fraction.is_empty())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let fraction = fraction.trim_end_matches('0');
    let scale = u8::try_from(fraction.len())
        .ok()
        .filter(|scale| *scale <= 38)?;
    let mantissa: i128 = format!("{whole}{fraction}").parse().ok()?;

    if mantissa == 0 {
        return Some(ExchangeInfoDecimalV2::Zero);
    }
    Some(ExchangeInfoDecimalV2::Positive(InstrumentDecimalV2 {
        mantissa,
        scale,
    }))
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

/// A later `exchangeInfo` snapshot of an instrument that already has a baseline, as the fact records
/// it.
///
/// It is admitted under the baseline's own Source Binding, so it does not repeat the binding. Its
/// raw payload digest is the exact snapshot's; two snapshots of an unchanged instrument may carry
/// equal bytes, so the digest names what was read, not a unique event.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExchangeInfoSnapshotV2 {
    pub predecessor_source_event_digest: BindingDigest,
    pub raw_payload_digest: BindingDigest,
    pub correction_sequence: u64,
    pub retrieval_time_ns: i128,
    pub owner_observation_time_ns: i128,
}

/// A snapshot successor as derived from its payload: the binding it was read under, its record,
/// and the terms it observed. Its contract status is the snapshot's when the snapshot is later than
/// the instant the fact it follows knows the status at, and that fact's otherwise.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExchangeInfoSnapshotSuccessorV2 {
    pub source_binding_identity: BindingDigest,
    pub source_binding_digest: BindingDigest,
    pub snapshot: ExchangeInfoSnapshotV2,
    pub terms: InstrumentMasterPublicTermsV2,
}

/// Why an `exchangeInfo` payload yields no snapshot successor of a fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExchangeInfoSnapshotNormalizationErrorV2 {
    /// The payload yields no terms for the fact's raw symbol, for the named reason the baseline
    /// intake gives.
    Payload(ExchangeInfoNormalizationErrorV2),
    /// The payload's `onboardDate` is not the baseline's: another listing, not a later snapshot of
    /// this one.
    ListingDiffers,
    /// The retrieval is not later than the last snapshot, or the baseline, the fact already holds.
    SnapshotOutOfOrder,
}

/// What a V2 fact's own step is.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FactStepV2 {
    Baseline,
    StatusDelta,
    Snapshot,
}

/// Everything a fact carries about how it came to be, beyond its baseline and terms.
///
/// A fact carries its latest status delta and its latest snapshot, wherever in the chain each was
/// admitted. Snapshots are ordered among themselves by retrieval, so a snapshot is never refused
/// because a status delta arrived first. The contract status has one order across both: the
/// instant the fact knows it at, the latest of the baseline's retrieval, the latest delta's event
/// and the latest snapshot's retrieval.
#[derive(Clone, Debug, Eq, PartialEq)]
struct FactLineageV2 {
    step: FactStepV2,
    latest_delta: Option<ContractInfoDeltaV2>,
    latest_snapshot: Option<ExchangeInfoSnapshotV2>,
    terms_basis: InstrumentTermsBasisV2,
}

impl FactLineageV2 {
    const BASELINE: Self = Self {
        step: FactStepV2::Baseline,
        latest_delta: None,
        latest_snapshot: None,
        terms_basis: InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing,
    };
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
    lineage: FactLineageV2,
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
            FactLineageV2::BASELINE,
            baseline.terms,
        )
    }

    /// Derives the status delta one raw USD-M `!contractInfo` event makes of this fact.
    ///
    /// This is the only definition of how `!contractInfo` becomes a V2 delta; the documentation
    /// describes it. The event must be for this fact's instrument and contract type, later than
    /// the instant the fact already knows the status at, which is its latest delta's event or a
    /// baseline's retrieval, and no later than the event's own retrieval, and must change the contract
    /// status, the one member the delta grammar admits. The raw event digest is computed here from
    /// the exact bytes, and the source binding, prior raw-event digest and next correction
    /// sequence are this fact's. The result still has to pass [`Self::apply_contract_info_delta`].
    ///
    /// # Errors
    ///
    /// Returns the named reason the event yields no status delta of this fact.
    pub fn usdm_contract_info_delta(
        &self,
        payload: &[u8],
        retrieval: ContractInfoRetrievalV2,
    ) -> Result<ContractInfoDeltaV2, ContractInfoNormalizationErrorV2> {
        use ContractInfoNormalizationErrorV2 as Refused;

        let root: serde_json::Value =
            serde_json::from_slice(payload).map_err(|_| Refused::InvalidEvent)?;
        let event = root.as_object().ok_or(Refused::InvalidEvent)?;

        if event.get("e").and_then(serde_json::Value::as_str) != Some("contractInfo") {
            return Err(Refused::InvalidEvent);
        }
        let event_ms = event
            .get("E")
            .and_then(serde_json::Value::as_u64)
            .ok_or(Refused::InvalidEvent)?;
        let status = event
            .get("cs")
            .and_then(serde_json::Value::as_str)
            .filter(|status| !status.is_empty())
            .ok_or(Refused::InvalidEvent)?;

        if event.get("s").and_then(serde_json::Value::as_str) != Some(self.raw_symbol.as_str()) {
            return Err(Refused::SymbolMismatch);
        }

        if event.get("ct").and_then(serde_json::Value::as_str) != Some("PERPETUAL") {
            return Err(Refused::ContractTypeUnsupported);
        }

        if event
            .get("st")
            .is_some_and(|system| system.as_u64() != Some(1))
        {
            return Err(Refused::DatasetMismatch);
        }
        let event_ns = i128::from(event_ms) * NANOS_PER_MILLI;

        if event_ns > retrieval.retrieval_time_ns {
            return Err(Refused::EventAfterRetrieval);
        }

        if event_ns <= self.known_as_of_ns() {
            return Err(Refused::EventOutOfOrder);
        }
        let status = FactValue::Value(status.to_owned());

        if self.terms.contract_status == status {
            return Err(Refused::StatusUnchanged);
        }
        Ok(ContractInfoDeltaV2 {
            canonical_identity: self.canonical_identity.clone(),
            source_binding_identity: self.baseline.source_binding_identity,
            source_binding_digest: self.baseline.source_binding_digest,
            predecessor_source_event_digest: self.latest_source_event_digest(),
            raw_payload_digest: contract_info_payload_digest_v2(payload),
            correction_sequence: self
                .correction_sequence
                .checked_add(1)
                .ok_or(Refused::InvalidEvent)?,
            provider_event_time_ns: event_ns,
            retrieval_time_ns: retrieval.retrieval_time_ns,
            owner_observation_time_ns: retrieval.owner_observation_time_ns,
            changes: InstrumentMasterPublicTermsDeltaV2 {
                contract_status: Some(status),
            },
        })
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

        if delta.owner_observation_time_ns < self.latest_owner_observation_time_ns()
            || delta.provider_event_time_ns <= self.known_as_of_ns()
        {
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
            FactLineageV2 {
                step: FactStepV2::StatusDelta,
                latest_delta: Some(delta),
                latest_snapshot: self.lineage.latest_snapshot.clone(),
                terms_basis: self.lineage.terms_basis,
            },
            terms,
        )
    }

    /// Derives the snapshot successor a later raw USD-M `exchangeInfo` payload makes of this fact.
    ///
    /// This is the only definition of how a later `exchangeInfo` becomes a V2 successor. The terms
    /// are derived by [`ExchangeInfoBaselineV2::from_usdm_exchange_info`], the baseline's own
    /// mapping, for this fact's raw symbol and `venue`. The payload must state the baseline's
    /// listing, and its retrieval must be later than the terms this fact already knows: its latest
    /// snapshot's retrieval, or the baseline's. The snapshot's contract status becomes the fact's
    /// when the snapshot is later than the instant this fact knows the status at; otherwise this
    /// fact's newer status is carried over and the snapshot records its terms only.
    /// The result still has to pass [`Self::apply_exchange_info_snapshot`], which requires the
    /// binding to be the baseline's.
    ///
    /// # Errors
    ///
    /// Returns the named reason the payload yields no snapshot successor of this fact.
    pub fn usdm_exchange_info_snapshot(
        &self,
        payload: &[u8],
        venue: &InstrumentMasterVenueV2,
        retrieval: ExchangeInfoRetrievalV2,
    ) -> Result<ExchangeInfoSnapshotSuccessorV2, ExchangeInfoSnapshotNormalizationErrorV2> {
        use ExchangeInfoSnapshotNormalizationErrorV2 as Refused;

        let derived = ExchangeInfoBaselineV2::from_usdm_exchange_info(
            payload,
            &self.raw_symbol,
            venue,
            retrieval,
        )
        .map_err(Refused::Payload)?;

        if derived.canonical_identity != self.canonical_identity
            || derived.venue_identity != self.venue_identity
        {
            return Err(Refused::Payload(
                ExchangeInfoNormalizationErrorV2::DatasetMismatch,
            ));
        }

        if derived.provenance.effective_from_ns != self.baseline.effective_from_ns {
            return Err(Refused::ListingDiffers);
        }

        if retrieval.retrieval_time_ns <= self.terms_known_as_of_ns() {
            return Err(Refused::SnapshotOutOfOrder);
        }
        let mut terms = derived.terms;

        if retrieval.retrieval_time_ns <= self.known_as_of_ns() {
            // The fact already knows a newer status: the snapshot records its terms only.
            terms.contract_status = self.terms.contract_status.clone();
        }
        Ok(ExchangeInfoSnapshotSuccessorV2 {
            source_binding_identity: retrieval.source_binding_identity,
            source_binding_digest: retrieval.source_binding_digest,
            snapshot: ExchangeInfoSnapshotV2 {
                predecessor_source_event_digest: self.latest_source_event_digest(),
                raw_payload_digest: derived.provenance.raw_payload_digest,
                correction_sequence: self
                    .correction_sequence
                    .checked_add(1)
                    .ok_or(Refused::SnapshotOutOfOrder)?,
                retrieval_time_ns: retrieval.retrieval_time_ns,
                owner_observation_time_ns: retrieval.owner_observation_time_ns,
            },
            terms,
        })
    }

    /// Applies exactly one later `exchangeInfo` snapshot to this fact.
    ///
    /// The snapshot must be read under the baseline's binding, name this fact's latest source
    /// event, take the next correction sequence, and be retrieved later than the terms this fact
    /// knows; unless it is also later than the status this fact knows, it must carry this fact's
    /// contract status. Its terms replace this fact's; the terms basis stays this fact's only when
    /// this fact's terms are still the baseline's and the snapshot's equal them but for the status,
    /// and is [`InstrumentTermsBasisV2::ObservedSinceTermsChange`] otherwise.
    ///
    /// # Errors
    ///
    /// Returns an error when the snapshot is invalid or is not this fact's direct successor.
    pub fn apply_exchange_info_snapshot(
        &self,
        successor: ExchangeInfoSnapshotSuccessorV2,
    ) -> Result<Self, InstrumentMasterV2Error> {
        let ExchangeInfoSnapshotSuccessorV2 {
            source_binding_identity,
            source_binding_digest,
            snapshot,
            terms,
        } = successor;
        validate_snapshot_record(&snapshot)?;
        validate_terms(&terms)?;

        if source_binding_identity != self.baseline.source_binding_identity
            || source_binding_digest != self.baseline.source_binding_digest
        {
            return Err(InstrumentMasterV2Error::SourceBindingMismatch);
        }

        if snapshot.predecessor_source_event_digest != self.latest_source_event_digest() {
            return Err(InstrumentMasterV2Error::SourceEventPredecessorMismatch);
        }

        if self.correction_sequence.checked_add(1) != Some(snapshot.correction_sequence) {
            return Err(InstrumentMasterV2Error::CorrectionSequenceMismatch);
        }

        if snapshot.owner_observation_time_ns < self.latest_owner_observation_time_ns()
            || snapshot.retrieval_time_ns <= self.terms_known_as_of_ns()
        {
            return Err(InstrumentMasterV2Error::TimeRegression);
        }

        if snapshot.retrieval_time_ns <= self.known_as_of_ns()
            && terms.contract_status != self.terms.contract_status
        {
            return Err(InstrumentMasterV2Error::InvalidProvenance);
        }
        let terms_basis = if self.lineage.terms_basis
            == InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing
            && equal_but_status(&terms, &self.terms)
        {
            InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing
        } else {
            InstrumentTermsBasisV2::ObservedSinceTermsChange
        };
        Self::finish(
            self.canonical_identity.clone(),
            self.venue_identity.clone(),
            self.raw_symbol.clone(),
            self.instrument_class,
            Some(self.identity),
            snapshot.correction_sequence,
            self.baseline.clone(),
            FactLineageV2 {
                step: FactStepV2::Snapshot,
                latest_delta: self.lineage.latest_delta.clone(),
                latest_snapshot: Some(snapshot),
                terms_basis,
            },
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
        let lineage = decode_lineage(&mut decoder)?;
        let terms = decode_terms(&mut decoder)?;
        decoder.finish()?;

        validate_identity_text(&canonical_identity)?;
        validate_identity_text(&venue_identity)?;
        validate_identity_text(&raw_symbol)?;
        validate_snapshot(&baseline)?;
        validate_terms(&terms)?;

        if let Some(delta) = &lineage.latest_delta {
            validate_delta(delta)?;
            if delta.canonical_identity != canonical_identity
                || delta.source_binding_identity != baseline.source_binding_identity
                || delta.source_binding_digest != baseline.source_binding_digest
                || delta.correction_sequence > correction_sequence
            {
                return Err(InstrumentMasterV2Error::CodecMismatch);
            }
        }

        if let Some(snapshot) = &lineage.latest_snapshot {
            validate_snapshot_record(snapshot)?;
            if snapshot.correction_sequence > correction_sequence {
                return Err(InstrumentMasterV2Error::CodecMismatch);
            }
        }
        let own_sequence = match lineage.step {
            FactStepV2::Baseline => Some(1),
            FactStepV2::StatusDelta => lineage
                .latest_delta
                .as_ref()
                .map(|delta| delta.correction_sequence),
            FactStepV2::Snapshot => lineage
                .latest_snapshot
                .as_ref()
                .map(|snapshot| snapshot.correction_sequence),
        };

        if own_sequence != Some(correction_sequence)
            || predecessor_fact_digest.is_none() != (lineage.step == FactStepV2::Baseline)
        {
            return Err(InstrumentMasterV2Error::CodecMismatch);
        }

        let fact = Self::finish(
            canonical_identity,
            venue_identity,
            raw_symbol,
            instrument_class,
            predecessor_fact_digest,
            correction_sequence,
            baseline,
            lineage,
            terms,
        )?;

        if fact.canonical_bytes != bytes {
            return Err(InstrumentMasterV2Error::CodecMismatch);
        }

        match predecessor {
            None if fact.lineage == FactLineageV2::BASELINE => Ok(fact),
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
        lineage: FactLineageV2,
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
        encode_lineage(&mut encoder, &lineage)?;
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
            lineage,
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
    pub const fn terms_basis(&self) -> InstrumentTermsBasisV2 {
        self.lineage.terms_basis
    }

    #[must_use]
    pub const fn baseline_provenance(&self) -> &ExchangeInfoSnapshotProvenanceV2 {
        &self.baseline
    }

    /// The latest status delta in this fact's chain, which is this fact's own step or earlier.
    #[must_use]
    pub const fn latest_delta(&self) -> Option<&ContractInfoDeltaV2> {
        self.lineage.latest_delta.as_ref()
    }

    /// The latest later snapshot in this fact's chain, which is this fact's own step or earlier.
    #[must_use]
    pub const fn latest_snapshot(&self) -> Option<&ExchangeInfoSnapshotV2> {
        self.lineage.latest_snapshot.as_ref()
    }

    /// The raw digest of this fact's own step: the baseline's payload, its delta's event, or its
    /// snapshot's payload. A direct successor names it.
    #[must_use]
    pub fn latest_source_event_digest(&self) -> BindingDigest {
        match (
            self.lineage.step,
            &self.lineage.latest_delta,
            &self.lineage.latest_snapshot,
        ) {
            (FactStepV2::StatusDelta, Some(delta), _) => delta.raw_payload_digest,
            (FactStepV2::Snapshot, _, Some(snapshot)) => snapshot.raw_payload_digest,
            _ => self.baseline.raw_payload_digest,
        }
    }

    fn latest_owner_observation_time_ns(&self) -> i128 {
        match (
            self.lineage.step,
            &self.lineage.latest_delta,
            &self.lineage.latest_snapshot,
        ) {
            (FactStepV2::StatusDelta, Some(delta), _) => delta.owner_observation_time_ns,
            (FactStepV2::Snapshot, _, Some(snapshot)) => snapshot.owner_observation_time_ns,
            _ => self.baseline.owner_observation_time_ns,
        }
    }

    pub(crate) fn owner_observation_time_ns(&self) -> i128 {
        self.latest_owner_observation_time_ns()
    }

    /// The latest instant this fact knows the contract status at: whichever is latest of its
    /// baseline's retrieval, since `exchangeInfo` states the status as retrieved and not as listed,
    /// its latest delta's event and its latest snapshot's retrieval. A delta must be newer than this,
    /// so an event older than what the fact already observed is never admitted over it, and a
    /// snapshot sets the status only when it is newer than this.
    fn known_as_of_ns(&self) -> i128 {
        let delta = self
            .lineage
            .latest_delta
            .as_ref()
            .map(|delta| delta.provider_event_time_ns);
        let snapshot = self
            .lineage
            .latest_snapshot
            .as_ref()
            .map(|snapshot| snapshot.retrieval_time_ns);
        [delta, snapshot]
            .into_iter()
            .flatten()
            .fold(self.baseline.retrieval_time_ns, i128::max)
    }

    /// The latest instant this fact knows the terms at: its latest snapshot's retrieval, or the
    /// baseline's. A later snapshot must be newer than this; status deltas do not move it.
    fn terms_known_as_of_ns(&self) -> i128 {
        self.lineage
            .latest_snapshot
            .as_ref()
            .map_or(self.baseline.retrieval_time_ns, |snapshot| {
                snapshot.retrieval_time_ns
            })
    }

    fn latest_event_time_ns(&self) -> i128 {
        self.lineage
            .latest_delta
            .as_ref()
            .map_or(self.baseline.effective_from_ns, |delta| {
                delta.provider_event_time_ns
            })
    }

    /// Verifies the complete direct-successor relation, including baseline inheritance and the
    /// exact field-wise delta merge.
    #[must_use]
    pub fn is_direct_successor_of(&self, predecessor: &Self) -> bool {
        let expected = match (
            &self.lineage.step,
            &self.lineage.latest_delta,
            &self.lineage.latest_snapshot,
        ) {
            (FactStepV2::StatusDelta, Some(delta), _) => {
                predecessor.apply_contract_info_delta(delta.clone())
            }
            (FactStepV2::Snapshot, _, Some(snapshot)) => {
                predecessor.apply_exchange_info_snapshot(ExchangeInfoSnapshotSuccessorV2 {
                    source_binding_identity: self.baseline.source_binding_identity,
                    source_binding_digest: self.baseline.source_binding_digest,
                    snapshot: snapshot.clone(),
                    terms: self.terms.clone(),
                })
            }
            _ => return false,
        };
        expected.is_ok_and(|expected| expected == *self)
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

/// R&D-owned identity and decision cut. It carries no symbols, fact bytes, digests, ordering, or
/// storage capability; those are resolved by Market Data from the sealed Universe Selection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentMasterCutRequestV2 {
    request_identity: BindingDigest,
    decision_cut: u64,
}

impl InstrumentMasterCutRequestV2 {
    #[must_use]
    pub const fn new(request_identity: BindingDigest, decision_cut: u64) -> Self {
        Self {
            request_identity,
            decision_cut,
        }
    }

    /// Derives the fixed Market Data request coordinate from one sealed R&D Replay identity.
    ///
    /// The operation caller supplies no digest, symbol, member order, or latest selector.
    ///
    /// # Errors
    ///
    /// Returns `InvalidRequest` when the supplied Replay identity is not canonical.
    pub fn for_native_replay_request(
        request_identity: &str,
        decision_cut: u64,
    ) -> Result<Self, InstrumentMasterCustodyErrorV2> {
        Ok(Self::new(
            native_replay_request_identity_v2(request_identity)?,
            decision_cut,
        ))
    }

    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    #[must_use]
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    pub(crate) fn validate(self) -> Result<(), InstrumentMasterCustodyErrorV2> {
        if is_zero(self.request_identity) || self.decision_cut == 0 {
            Err(InstrumentMasterCustodyErrorV2::InvalidRequest)
        } else {
            Ok(())
        }
    }
}

/// Maps one canonical sealed R&D Replay identity into the fixed Market Data V2 request key.
///
/// # Errors
///
/// Returns `InvalidRequest` when the identity is empty, padded, or exceeds the fixed bound.
pub fn native_replay_request_identity_v2(
    request_identity: &str,
) -> Result<BindingDigest, InstrumentMasterCustodyErrorV2> {
    if request_identity.is_empty()
        || request_identity.trim() != request_identity
        || request_identity.len() > MAX_R_AND_D_REQUEST_IDENTITY_BYTES_V2
    {
        return Err(InstrumentMasterCustodyErrorV2::InvalidRequest);
    }
    let mut bytes = Vec::with_capacity(4 + request_identity.len());
    bytes.extend_from_slice(
        &u32::try_from(request_identity.len())
            .map_err(|_| InstrumentMasterCustodyErrorV2::InvalidRequest)?
            .to_be_bytes(),
    );
    bytes.extend_from_slice(request_identity.as_bytes());
    Ok(digest(NATIVE_REPLAY_REQUEST_DOMAIN_V2, &bytes))
}

/// One canonical member of the fixed two-instrument cut.
#[derive(Debug, Eq, PartialEq)]
pub struct InstrumentMasterCutMemberV2 {
    fact: InstrumentMasterFactV2,
}

impl InstrumentMasterCutMemberV2 {
    #[must_use]
    pub const fn fact(&self) -> &InstrumentMasterFactV2 {
        &self.fact
    }
}

/// Immutable, content-addressed public V2 cut over one or two distinct members.
#[derive(Debug, Eq, PartialEq)]
pub struct InstrumentMasterCutV2 {
    request_identity: BindingDigest,
    request_binding_digest: BindingDigest,
    decision_cut: u64,
    universe_selection_identity: BindingDigest,
    universe_selection_receipt_identity: BindingDigest,
    universe_selection_outbox_identity: BindingDigest,
    members: Vec<InstrumentMasterCutMemberV2>,
    canonical_bytes: Vec<u8>,
    identity: BindingDigest,
}

impl InstrumentMasterCutV2 {
    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    #[must_use]
    pub const fn request_binding_digest(&self) -> BindingDigest {
        self.request_binding_digest
    }

    #[must_use]
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    #[must_use]
    pub const fn universe_selection_identity(&self) -> BindingDigest {
        self.universe_selection_identity
    }

    #[must_use]
    pub const fn universe_selection_receipt_identity(&self) -> BindingDigest {
        self.universe_selection_receipt_identity
    }

    #[must_use]
    pub const fn universe_selection_outbox_identity(&self) -> BindingDigest {
        self.universe_selection_outbox_identity
    }

    /// The cut's members in canonical identity order: one or two, never more.
    #[must_use]
    pub fn members(&self) -> &[InstrumentMasterCutMemberV2] {
        &self.members
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    /// Issues a cut over the admitted number of distinct Crypto Perpetual members.
    pub(crate) fn issue(
        request: InstrumentMasterCutRequestV2,
        universe_selection_identity: BindingDigest,
        universe_selection_receipt_identity: BindingDigest,
        universe_selection_outbox_identity: BindingDigest,
        mut facts: Vec<InstrumentMasterFactV2>,
    ) -> Result<Self, InstrumentMasterCustodyErrorV2> {
        request.validate()?;

        if [
            universe_selection_identity,
            universe_selection_receipt_identity,
            universe_selection_outbox_identity,
        ]
        .into_iter()
        .any(is_zero)
        {
            return Err(InstrumentMasterCustodyErrorV2::InvalidUniverseSelection);
        }

        if !ADMITTED_UNIVERSE_MEMBER_COUNTS.contains(&facts.len()) {
            return Err(InstrumentMasterCustodyErrorV2::InvalidUniverseSelection);
        }
        facts.sort_by(|left, right| left.canonical_identity().cmp(right.canonical_identity()));
        if facts
            .windows(2)
            .any(|pair| pair[0].canonical_identity() == pair[1].canonical_identity())
            || facts
                .iter()
                .any(|fact| fact.instrument_class() != PublicInstrumentClassV2::CryptoPerpetual)
        {
            return Err(InstrumentMasterCustodyErrorV2::InvalidUniverseSelection);
        }
        let request_binding_digest = request_binding_digest_v2(
            request,
            universe_selection_identity,
            universe_selection_receipt_identity,
            universe_selection_outbox_identity,
        );
        let mut encoder = Encoder::default();
        encoder.u16(FACT_SCHEMA_VERSION_V2);
        encoder
            .string(BACKTEST_OWNER_ROLE_V1)
            .map_err(custody_codec)?;
        encoder.digest(request.request_identity);
        encoder.digest(request_binding_digest);
        encoder.u64(request.decision_cut);
        encoder.digest(universe_selection_identity);
        encoder.digest(universe_selection_receipt_identity);
        encoder.digest(universe_selection_outbox_identity);
        encoder.u32(
            u32::try_from(facts.len())
                .map_err(|_| InstrumentMasterCustodyErrorV2::CodecMismatch)?,
        );

        for fact in &facts {
            encoder
                .string(fact.canonical_identity())
                .map_err(custody_codec)?;
            encoder.digest(fact.identity());
            encoder
                .bytes(fact.canonical_bytes())
                .map_err(custody_codec)?;
        }
        let canonical_bytes = encoder.finish();
        let identity = digest(CUT_DOMAIN_V2, &canonical_bytes);
        Ok(Self {
            request_identity: request.request_identity,
            request_binding_digest,
            decision_cut: request.decision_cut,
            universe_selection_identity,
            universe_selection_receipt_identity,
            universe_selection_outbox_identity,
            members: facts
                .into_iter()
                .map(|fact| InstrumentMasterCutMemberV2 { fact })
                .collect(),
            canonical_bytes,
            identity,
        })
    }

    pub(crate) fn parse_with_facts(
        bytes: &[u8],
        facts: Vec<InstrumentMasterFactV2>,
    ) -> Result<Self, InstrumentMasterCustodyErrorV2> {
        let mut decoder = Decoder::new(bytes);
        if decoder.u16().map_err(custody_codec)? != FACT_SCHEMA_VERSION_V2
            || decoder.string().map_err(custody_codec)? != BACKTEST_OWNER_ROLE_V1
        {
            return Err(InstrumentMasterCustodyErrorV2::CodecMismatch);
        }
        let request_identity = decoder.digest().map_err(custody_codec)?;
        let request_binding_digest = decoder.digest().map_err(custody_codec)?;
        let decision_cut = decoder.u64().map_err(custody_codec)?;
        let universe_selection_identity = decoder.digest().map_err(custody_codec)?;
        let universe_selection_receipt_identity = decoder.digest().map_err(custody_codec)?;
        let universe_selection_outbox_identity = decoder.digest().map_err(custody_codec)?;
        let count = usize::try_from(decoder.u32().map_err(custody_codec)?)
            .map_err(|_| InstrumentMasterCustodyErrorV2::CodecMismatch)?;
        if !ADMITTED_UNIVERSE_MEMBER_COUNTS.contains(&count) || facts.len() != count {
            return Err(InstrumentMasterCustodyErrorV2::CodecMismatch);
        }
        let mut encoded_members = Vec::with_capacity(count);

        for _ in 0..count {
            let canonical_identity = decoder.string().map_err(custody_codec)?;
            let identity = decoder.digest().map_err(custody_codec)?;
            let fact_bytes = decoder.bytes().map_err(custody_codec)?;
            encoded_members.push((canonical_identity, identity, fact_bytes));
        }
        decoder.finish().map_err(custody_codec)?;

        for ((canonical_identity, identity, fact_bytes), fact) in
            encoded_members.iter().zip(facts.iter())
        {
            if fact.canonical_identity() != canonical_identity
                || fact.identity() != *identity
                || fact.canonical_bytes() != fact_bytes
            {
                return Err(InstrumentMasterCustodyErrorV2::CodecMismatch);
            }
        }
        let cut = Self::issue(
            InstrumentMasterCutRequestV2::new(request_identity, decision_cut),
            universe_selection_identity,
            universe_selection_receipt_identity,
            universe_selection_outbox_identity,
            facts,
        )?;

        if cut.request_binding_digest != request_binding_digest || cut.canonical_bytes != bytes {
            return Err(InstrumentMasterCustodyErrorV2::CodecMismatch);
        }
        Ok(cut)
    }
}

/// Durable append receipt. It is deterministic for one exact committed cut coordinate.
#[derive(Debug, Eq, PartialEq)]
pub struct InstrumentMasterCutReceiptV2 {
    cut_identity: BindingDigest,
    request_binding_digest: BindingDigest,
    store_generation_identity: BindingDigest,
    append_sequence: u64,
    canonical_bytes: Vec<u8>,
    identity: BindingDigest,
    outbox_identity: BindingDigest,
}

impl InstrumentMasterCutReceiptV2 {
    pub(crate) fn issue(
        cut: &InstrumentMasterCutV2,
        store_generation_identity: BindingDigest,
        append_sequence: u64,
    ) -> Result<Self, InstrumentMasterCustodyErrorV2> {
        if is_zero(store_generation_identity) || append_sequence == 0 {
            return Err(InstrumentMasterCustodyErrorV2::CodecMismatch);
        }
        let mut encoder = Encoder::default();
        encoder.u16(FACT_SCHEMA_VERSION_V2);
        encoder.digest(cut.identity);
        encoder.digest(cut.request_binding_digest);
        encoder.digest(store_generation_identity);
        encoder.u64(append_sequence);
        let canonical_bytes = encoder.finish();
        let identity = digest(RECEIPT_DOMAIN_V2, &canonical_bytes);
        let outbox_identity = digest(OUTBOX_DOMAIN_V2, identity.as_bytes());
        Ok(Self {
            cut_identity: cut.identity,
            request_binding_digest: cut.request_binding_digest,
            store_generation_identity,
            append_sequence,
            canonical_bytes,
            identity,
            outbox_identity,
        })
    }

    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, InstrumentMasterCustodyErrorV2> {
        let mut decoder = Decoder::new(bytes);
        if decoder.u16().map_err(custody_codec)? != FACT_SCHEMA_VERSION_V2 {
            return Err(InstrumentMasterCustodyErrorV2::CodecMismatch);
        }
        let cut_identity = decoder.digest().map_err(custody_codec)?;
        let request_binding_digest = decoder.digest().map_err(custody_codec)?;
        let store_generation_identity = decoder.digest().map_err(custody_codec)?;
        let append_sequence = decoder.u64().map_err(custody_codec)?;
        decoder.finish().map_err(custody_codec)?;
        let identity = digest(RECEIPT_DOMAIN_V2, bytes);
        Ok(Self {
            cut_identity,
            request_binding_digest,
            store_generation_identity,
            append_sequence,
            canonical_bytes: bytes.to_vec(),
            identity,
            outbox_identity: digest(OUTBOX_DOMAIN_V2, identity.as_bytes()),
        })
    }

    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }
    #[must_use]
    pub const fn outbox_identity(&self) -> BindingDigest {
        self.outbox_identity
    }
    #[must_use]
    pub const fn cut_identity(&self) -> BindingDigest {
        self.cut_identity
    }
    #[must_use]
    pub const fn request_binding_digest(&self) -> BindingDigest {
        self.request_binding_digest
    }
    #[must_use]
    pub const fn store_generation_identity(&self) -> BindingDigest {
        self.store_generation_identity
    }
    #[must_use]
    pub const fn append_sequence(&self) -> u64 {
        self.append_sequence
    }
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Exact historical resolver locator. It can only be obtained from an Owner-issued readback.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentMasterCutLocatorV2 {
    request_identity: BindingDigest,
    request_binding_digest: BindingDigest,
    cut_identity: BindingDigest,
    receipt_identity: BindingDigest,
}

impl InstrumentMasterCutLocatorV2 {
    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }
    #[must_use]
    pub const fn request_binding_digest(&self) -> BindingDigest {
        self.request_binding_digest
    }
    #[must_use]
    pub const fn cut_identity(&self) -> BindingDigest {
        self.cut_identity
    }
    #[must_use]
    pub const fn receipt_identity(&self) -> BindingDigest {
        self.receipt_identity
    }
}

/// Move-only exact readback; callers cannot construct, clone, or deserialize it.
#[derive(Debug, Eq, PartialEq)]
pub struct InstrumentMasterReadbackV2 {
    cut: InstrumentMasterCutV2,
    receipt: InstrumentMasterCutReceiptV2,
}

impl InstrumentMasterReadbackV2 {
    pub(crate) fn from_parts(
        cut: InstrumentMasterCutV2,
        receipt: InstrumentMasterCutReceiptV2,
    ) -> Result<Self, InstrumentMasterCustodyErrorV2> {
        if receipt.cut_identity != cut.identity
            || receipt.request_binding_digest != cut.request_binding_digest
        {
            return Err(InstrumentMasterCustodyErrorV2::CrossSpliced);
        }
        Ok(Self { cut, receipt })
    }

    #[must_use]
    pub const fn cut(&self) -> &InstrumentMasterCutV2 {
        &self.cut
    }
    #[must_use]
    pub const fn receipt(&self) -> &InstrumentMasterCutReceiptV2 {
        &self.receipt
    }
    #[must_use]
    pub const fn locator(&self) -> InstrumentMasterCutLocatorV2 {
        InstrumentMasterCutLocatorV2 {
            request_identity: self.cut.request_identity,
            request_binding_digest: self.cut.request_binding_digest,
            cut_identity: self.cut.identity,
            receipt_identity: self.receipt.identity,
        }
    }
}

#[doc(hidden)]
pub(crate) mod resolver_seal_v2 {
    pub trait Sealed {}
}

/// Fixed read-only port consumed by Strategy Factory after R&D seals the exact locator.
#[async_trait::async_trait]
#[allow(private_bounds)]
pub trait InstrumentMasterResolverV2: resolver_seal_v2::Sealed + Send + Sync {
    /// Resolves the unique initial-composition cut bound to one sealed R&D Replay identity.
    async fn resolve_instrument_master_v2_for_native_replay_request(
        &self,
        request_identity: &str,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2>;

    /// Resolves one exact historical cut; there is no symbol or latest lookup.
    async fn resolve_instrument_master_v2(
        &self,
        locator: InstrumentMasterCutLocatorV2,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterCustodyErrorV2 {
    InvalidRequest,
    InvalidUniverseSelection,
    MissingFact,
    ChainMismatch,
    CodecMismatch,
    CrossSpliced,
    IdentityConflict,
    RequestConflict,
    UnknownLocator,
    StoreUnavailable,
    AclUnavailable,
    /// The bound-replay request key was already issued under a different composition binding.
    BoundReplayBindingConflict,
    /// No composition binding matches the exact locator a bound-replay issuance named.
    BoundReplayBindingUnavailable,
    /// A member's class can carry corporate actions. A universe-member Replay binds no
    /// corporate-action cut, because the one class this cut admits has none by definition; a
    /// member of any other class is refused until a corporate-action path exists for it.
    MemberClassCarriesCorporateActions,
    /// The cut's V2 facts do not describe the instruments the V1 readback its bound PIT snapshot
    /// cites describes; the payload names the rule that failed.
    GenerationMismatch(InstrumentMasterGenerationMismatchV2),
}

/// A V2 term the generation consistency check compares with its V1 counterpart.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterGenerationTermV2 {
    PriceIncrement,
    QuantityIncrement,
    ContractMultiplier,
}

/// The rule of the V1/V2 generation consistency check a cut's members failed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterGenerationMismatchV2 {
    /// The V1 readback's facts and the cut's members name different canonical identities.
    MemberSetDiffers,
    /// The V1 fact is not classed as the V2 fact is.
    ClassDiffers,
    /// No V1 mapping is at the V2 fact's venue.
    VenueMappingAbsent,
    /// More than one V1 mapping is at the V2 fact's venue.
    VenueMappingAmbiguous,
    /// The V1 mapping at the venue names bytes other than the V2 raw symbol.
    RawSymbolDiffers,
    /// The V2 term is not a value, so it cannot vouch for the V1 term beside it.
    TermNotAValue(InstrumentMasterGenerationTermV2),
    /// The V2 term's mantissa or scale is not the V1 term's.
    TermDiffers(InstrumentMasterGenerationTermV2),
}

/// Proves the V2 facts a cut is about to hold describe the instruments the V1 facts a PIT snapshot
/// cites describe, member by member.
///
/// Both generations store a decimal canonically, so equal terms have equal mantissa and scale and
/// nothing is normalized. A V2 term that is not a value is refused rather than skipped. The rule
/// is the documentation's V1/V2 generation consistency paragraph; each refusal names its rule.
pub(crate) fn require_same_generation_v2(
    v1: &[InstrumentMasterFactV1],
    v2: &[InstrumentMasterFactV2],
) -> Result<(), InstrumentMasterGenerationMismatchV2> {
    use InstrumentMasterGenerationMismatchV2 as Mismatch;
    use InstrumentMasterGenerationTermV2 as Term;

    let mut v1_members = v1
        .iter()
        .map(InstrumentMasterFactV1::canonical_identity)
        .collect::<Vec<_>>();
    let mut v2_members = v2
        .iter()
        .map(InstrumentMasterFactV2::canonical_identity)
        .collect::<Vec<_>>();
    v1_members.sort_unstable();
    v2_members.sort_unstable();
    if v1_members != v2_members {
        return Err(Mismatch::MemberSetDiffers);
    }

    for current in v2 {
        let Some(earlier) = v1
            .iter()
            .find(|fact| fact.canonical_identity() == current.canonical_identity())
        else {
            return Err(Mismatch::MemberSetDiffers);
        };
        let class = match current.instrument_class() {
            PublicInstrumentClassV2::CryptoPerpetual => InstrumentClass::CryptoPerpetual,
        };

        if earlier.instrument_class() != class {
            return Err(Mismatch::ClassDiffers);
        }
        let mut at_venue = earlier
            .proposal
            .mappings
            .iter()
            .filter(|mapping| mapping.venue_identity == current.venue_identity());
        let mapping = at_venue.next().ok_or(Mismatch::VenueMappingAbsent)?;
        if at_venue.next().is_some() {
            return Err(Mismatch::VenueMappingAmbiguous);
        }

        if mapping.source_instrument != current.raw_symbol().as_bytes() {
            return Err(Mismatch::RawSymbolDiffers);
        }
        let terms = current.terms();

        for (term, stated, vouched) in [
            (
                Term::PriceIncrement,
                earlier.proposal.price_increment,
                &terms.price_increment_from_filter,
            ),
            (
                Term::QuantityIncrement,
                earlier.proposal.quantity_increment,
                &terms.quantity_increment_from_filter,
            ),
            (
                Term::ContractMultiplier,
                earlier.proposal.contract_multiplier,
                &terms.contract_multiplier,
            ),
        ] {
            let FactValue::Value(vouched) = vouched else {
                return Err(Mismatch::TermNotAValue(term));
            };
            let InstrumentDecimal { mantissa, scale } = stated;
            if (vouched.mantissa, vouched.scale) != (mantissa, scale) {
                return Err(Mismatch::TermDiffers(term));
            }
        }
    }
    Ok(())
}

impl Display for InstrumentMasterCustodyErrorV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for InstrumentMasterCustodyErrorV2 {}

fn request_binding_digest_v2(
    request: InstrumentMasterCutRequestV2,
    selection: BindingDigest,
    receipt: BindingDigest,
    outbox: BindingDigest,
) -> BindingDigest {
    let mut bytes = Vec::with_capacity(32 * 4 + 8);
    bytes.extend_from_slice(request.request_identity.as_bytes());
    bytes.extend_from_slice(&request.decision_cut.to_be_bytes());
    bytes.extend_from_slice(selection.as_bytes());
    bytes.extend_from_slice(receipt.as_bytes());
    bytes.extend_from_slice(outbox.as_bytes());
    digest(REQUEST_BINDING_DOMAIN_V2, &bytes)
}

fn custody_codec(_: InstrumentMasterV2Error) -> InstrumentMasterCustodyErrorV2 {
    InstrumentMasterCustodyErrorV2::CodecMismatch
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

fn validate_snapshot_record(
    snapshot: &ExchangeInfoSnapshotV2,
) -> Result<(), InstrumentMasterV2Error> {
    if is_zero(snapshot.predecessor_source_event_digest)
        || is_zero(snapshot.raw_payload_digest)
        || snapshot.correction_sequence <= 1
        || snapshot.retrieval_time_ns > snapshot.owner_observation_time_ns
    {
        Err(InstrumentMasterV2Error::InvalidProvenance)
    } else {
        Ok(())
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

/// Whether two sets of terms agree on every term but the contract status, which is not a term the
/// terms basis speaks for.
fn equal_but_status(
    left: &InstrumentMasterPublicTermsV2,
    right: &InstrumentMasterPublicTermsV2,
) -> bool {
    let mut left = left.clone();
    left.contract_status = right.contract_status.clone();
    left == *right
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

    fn bytes(&mut self, value: &[u8]) -> Result<(), InstrumentMasterV2Error> {
        let length =
            u32::try_from(value.len()).map_err(|_| InstrumentMasterV2Error::CodecMismatch)?;
        self.u32(length);
        self.0.extend(value);
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

    fn bytes(&mut self) -> Result<Vec<u8>, InstrumentMasterV2Error> {
        let length =
            usize::try_from(self.u32()?).map_err(|_| InstrumentMasterV2Error::CodecMismatch)?;
        Ok(self.take(length)?.to_vec())
    }
}

fn encode_snapshot(encoder: &mut Encoder, value: &ExchangeInfoSnapshotProvenanceV2) {
    encoder.digest(value.source_binding_identity);
    encoder.digest(value.source_binding_digest);
    encoder.digest(value.raw_payload_digest);
    encoder.i128(value.effective_from_ns);
    encoder.i128(value.retrieval_time_ns);
    encoder.i128(value.owner_observation_time_ns);
    encoder.u8(InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing as u8);
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
    .and_then(|snapshot| {
        // The only basis any producer states; any other byte is not a V2 fact.
        if decoder.u8()? == InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing as u8 {
            Ok(snapshot)
        } else {
            Err(InstrumentMasterV2Error::CodecMismatch)
        }
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

/// A fact's lineage, after its baseline provenance.
///
/// Tags `0` (a baseline) and `1` (a status delta, with no later snapshot anywhere in the chain) are
/// the encodings every fact had before later snapshots existed, byte for byte, so no stored fact
/// changes. Tag `2` is every fact whose chain holds a later snapshot: which step it is, its latest
/// delta if any, its latest snapshot, and its terms basis, which such a chain can change.
fn encode_lineage(
    encoder: &mut Encoder,
    lineage: &FactLineageV2,
) -> Result<(), InstrumentMasterV2Error> {
    let since_listing =
        lineage.terms_basis == InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing;

    match (
        lineage.step,
        &lineage.latest_delta,
        &lineage.latest_snapshot,
    ) {
        (FactStepV2::Baseline, None, None) if since_listing => encoder.u8(0),
        (FactStepV2::StatusDelta, Some(delta), None) if since_listing => {
            encoder.u8(1);
            encode_delta(encoder, delta)?;
        }
        (FactStepV2::StatusDelta | FactStepV2::Snapshot, delta, Some(snapshot)) => {
            encoder.u8(2);
            encoder.u8(match lineage.step {
                FactStepV2::StatusDelta => 1,
                _ => 2,
            });

            match delta {
                None => encoder.u8(0),
                Some(delta) => {
                    encoder.u8(1);
                    encode_delta(encoder, delta)?;
                }
            }
            encoder.digest(snapshot.predecessor_source_event_digest);
            encoder.digest(snapshot.raw_payload_digest);
            encoder.u64(snapshot.correction_sequence);
            encoder.i128(snapshot.retrieval_time_ns);
            encoder.i128(snapshot.owner_observation_time_ns);
            encoder.u8(lineage.terms_basis as u8);
        }
        _ => return Err(InstrumentMasterV2Error::CodecMismatch),
    }
    Ok(())
}

fn decode_lineage(decoder: &mut Decoder<'_>) -> Result<FactLineageV2, InstrumentMasterV2Error> {
    match decoder.u8()? {
        0 => Ok(FactLineageV2::BASELINE),
        1 => Ok(FactLineageV2 {
            step: FactStepV2::StatusDelta,
            latest_delta: Some(decode_delta(decoder)?),
            latest_snapshot: None,
            terms_basis: InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing,
        }),
        2 => {
            let step = match decoder.u8()? {
                1 => FactStepV2::StatusDelta,
                2 => FactStepV2::Snapshot,
                _ => return Err(InstrumentMasterV2Error::CodecMismatch),
            };
            let latest_delta = match decoder.u8()? {
                0 => None,
                1 => Some(decode_delta(decoder)?),
                _ => return Err(InstrumentMasterV2Error::CodecMismatch),
            };
            let latest_snapshot = Some(ExchangeInfoSnapshotV2 {
                predecessor_source_event_digest: decoder.digest()?,
                raw_payload_digest: decoder.digest()?,
                correction_sequence: decoder.u64()?,
                retrieval_time_ns: decoder.i128()?,
                owner_observation_time_ns: decoder.i128()?,
            });
            let terms_basis = InstrumentTermsBasisV2::decode(decoder.u8()?)?;

            if step == FactStepV2::StatusDelta && latest_delta.is_none() {
                return Err(InstrumentMasterV2Error::CodecMismatch);
            }
            Ok(FactLineageV2 {
                step,
                latest_delta,
                latest_snapshot,
                terms_basis,
            })
        }
        _ => Err(InstrumentMasterV2Error::CodecMismatch),
    }
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
pub(crate) mod tests {
    use super::*;
    use rstest::rstest;
    use vibe_model::types::fixed::FIXED_PRECISION;

    pub(crate) fn id(byte: u8) -> BindingDigest {
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

    pub(super) fn complete_terms() -> InstrumentMasterPublicTermsV2 {
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

    pub(super) fn baseline(terms: InstrumentMasterPublicTermsV2) -> ExchangeInfoBaselineV2 {
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

    /// An unknown class code never decodes: it is refused by name before any consumer sees it.
    #[rstest]
    fn an_unknown_instrument_class_code_is_refused_by_the_decoder() {
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline(complete_terms()))
            .unwrap();
        let text = |value: &str| 4 + value.len();
        let class_at = 4
            + text(fact.canonical_identity())
            + text(fact.venue_identity())
            + text(fact.raw_symbol());
        let bytes = fact.canonical_bytes();
        assert_eq!(
            bytes[class_at..class_at + 2],
            (PublicInstrumentClassV2::CryptoPerpetual as u16).to_be_bytes(),
            "the offset points at the class the fixture states"
        );
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(bytes, None),
            Ok(fact.clone())
        );
        let mut unknown = bytes.to_vec();
        unknown[class_at..class_at + 2].copy_from_slice(&2_u16.to_be_bytes());
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(&unknown, None),
            Err(InstrumentMasterV2Error::CodecMismatch)
        );
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
        // The baseline knows its status as of its retrieval at 100; an event then is not newer.
        let mut stale = delta(id(3), 2, id(1));
        stale.provider_event_time_ns = 100;
        assert_eq!(
            fact.apply_contract_info_delta(stale),
            Err(InstrumentMasterV2Error::TimeRegression)
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

    pub(crate) fn fact_for(
        canonical_identity: &str,
        raw_symbol: &str,
        seed: u8,
    ) -> InstrumentMasterFactV2 {
        fact_for_observed_at(canonical_identity, raw_symbol, seed, 101)
    }

    /// [`fact_for`] observed by the Owner at `owner_observation_time_ns`, retrieved one nanosecond
    /// and effective two nanoseconds before it, for a selection observed before 101.
    pub(crate) fn fact_for_observed_at(
        canonical_identity: &str,
        raw_symbol: &str,
        seed: u8,
        owner_observation_time_ns: i128,
    ) -> InstrumentMasterFactV2 {
        let mut input = baseline(complete_terms());
        input.canonical_identity = canonical_identity.to_owned();
        input.raw_symbol = raw_symbol.to_owned();
        input.provenance.source_binding_identity = id(seed);
        input.provenance.source_binding_digest = id(seed + 1);
        input.provenance.raw_payload_digest = id(seed + 2);
        input.provenance.effective_from_ns = owner_observation_time_ns - 2;
        input.provenance.retrieval_time_ns = owner_observation_time_ns - 1;
        input.provenance.owner_observation_time_ns = owner_observation_time_ns;
        InstrumentMasterFactV2::from_exchange_info_baseline(input).unwrap()
    }

    /// Admitting one-member cuts changes no two-member byte. `main` issued this cut as 1039
    /// canonical bytes before the member set was widened (tree `daee7dc73`); the encoding has always
    /// written its member count, and two is still written as two.
    ///
    /// Re-pinned for the terms basis: fact schema version 3 appends one basis byte to each member's
    /// snapshot, so the same two members are 1041 bytes, exactly one byte each more, and the identity
    /// below is the one those bytes digest to. Nothing else in the cut changed.
    #[rstest::rstest]
    fn a_two_member_cut_keeps_the_bytes_it_had_before_one_member_cuts() {
        let cut = InstrumentMasterCutV2::issue(
            InstrumentMasterCutRequestV2::new(id(30), 7),
            id(31),
            id(32),
            id(33),
            vec![
                fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10),
                fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20),
            ],
        )
        .unwrap();
        let pinned = "cfbee9b1d42c13e69ac9bd7886ddbb7445aab51dc8853e97b84f7cd27f7699da";
        let expected = (0..pinned.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(&pinned[at..at + 2], 16).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(cut.identity().as_bytes().as_slice(), expected.as_slice());
        assert_eq!(cut.canonical_bytes().len(), 1041);
    }

    #[rstest::rstest]
    fn a_cut_holds_one_member_or_two_distinct_ones() {
        let btc = fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10);
        let eth = fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20);
        let sol = fact_for("SOLUSDT-PERP.BINANCE", "SOLUSDT", 30);
        let request = InstrumentMasterCutRequestV2::new(id(30), 7);
        let issue = |facts| InstrumentMasterCutV2::issue(request, id(31), id(32), id(33), facts);

        let one = issue(vec![btc.clone()]).expect("a one-member cut");
        assert_eq!(one.members().len(), 1);
        assert_eq!(
            InstrumentMasterCutV2::parse_with_facts(one.canonical_bytes(), vec![btc.clone()]),
            Ok(one),
            "a one-member cut round-trips through its own bytes"
        );
        let one_bytes = issue(vec![btc.clone()]).unwrap().canonical_bytes().to_vec();
        assert_eq!(
            InstrumentMasterCutV2::parse_with_facts(&one_bytes, vec![btc.clone(), eth.clone()]),
            Err(InstrumentMasterCustodyErrorV2::CodecMismatch),
            "the encoded count is the count: two facts cannot read one member's bytes"
        );
        assert_ne!(
            issue(vec![btc.clone()]).unwrap().identity(),
            issue(vec![eth.clone()]).unwrap().identity()
        );

        for refused in [vec![], vec![btc.clone(), btc.clone()], vec![btc, eth, sol]] {
            assert_eq!(
                issue(refused).unwrap_err(),
                InstrumentMasterCustodyErrorV2::InvalidUniverseSelection
            );
        }
    }

    #[rstest::rstest]
    fn fixed_cut_canonicalizes_two_members_and_binds_request() {
        let btc = fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10);
        let eth = fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20);
        let request = InstrumentMasterCutRequestV2::new(id(30), 7);
        let cut = InstrumentMasterCutV2::issue(
            request,
            id(31),
            id(32),
            id(33),
            vec![eth.clone(), btc.clone()],
        )
        .unwrap();
        let reordered =
            InstrumentMasterCutV2::issue(request, id(31), id(32), id(33), vec![btc, eth]).unwrap();

        assert_eq!(cut.identity(), reordered.identity());
        assert_eq!(
            cut.members()[0].fact().canonical_identity(),
            "BTCUSDT-PERP.BINANCE"
        );
        assert_eq!(
            cut.members()[1].fact().canonical_identity(),
            "ETHUSDT-PERP.BINANCE"
        );
        assert_ne!(
            cut.identity(),
            InstrumentMasterCutV2::issue(
                InstrumentMasterCutRequestV2::new(id(34), 7),
                id(31),
                id(32),
                id(33),
                vec![
                    fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10),
                    fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20),
                ],
            )
            .unwrap()
            .identity()
        );
    }

    #[rstest::rstest]
    fn exact_cut_parse_rejects_reorder_and_changed_bytes() {
        let btc = fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10);
        let eth = fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20);
        let cut = InstrumentMasterCutV2::issue(
            InstrumentMasterCutRequestV2::new(id(30), 7),
            id(31),
            id(32),
            id(33),
            vec![btc.clone(), eth.clone()],
        )
        .unwrap();

        assert_eq!(
            InstrumentMasterCutV2::parse_with_facts(
                cut.canonical_bytes(),
                vec![btc.clone(), eth.clone()]
            )
            .unwrap(),
            cut
        );
        assert_eq!(
            InstrumentMasterCutV2::parse_with_facts(cut.canonical_bytes(), vec![eth, btc]),
            Err(InstrumentMasterCustodyErrorV2::CodecMismatch)
        );
        let mut changed = cut.canonical_bytes().to_vec();
        let last = changed.len() - 1;
        changed[last] ^= 1;
        assert_eq!(
            InstrumentMasterCutV2::parse_with_facts(
                &changed,
                vec![
                    fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10),
                    fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20),
                ]
            ),
            Err(InstrumentMasterCustodyErrorV2::CodecMismatch)
        );
    }

    #[rstest::rstest]
    fn readback_locator_is_exact_and_receipt_outbox_are_deterministic() {
        let cut = InstrumentMasterCutV2::issue(
            InstrumentMasterCutRequestV2::new(id(30), 7),
            id(31),
            id(32),
            id(33),
            vec![
                fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10),
                fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20),
            ],
        )
        .unwrap();
        let receipt = InstrumentMasterCutReceiptV2::issue(&cut, id(40), 1).unwrap();
        let parsed = InstrumentMasterCutReceiptV2::parse(receipt.canonical_bytes()).unwrap();
        assert_eq!(parsed, receipt);
        let readback = InstrumentMasterReadbackV2::from_parts(cut, receipt).unwrap();
        let locator = readback.locator();

        assert_eq!(locator.request_identity(), id(30));
        assert_eq!(locator.cut_identity(), readback.cut().identity());
        assert_eq!(locator.receipt_identity(), readback.receipt().identity());
        assert_eq!(
            readback.receipt().outbox_identity(),
            InstrumentMasterCutReceiptV2::parse(readback.receipt().canonical_bytes())
                .unwrap()
                .outbox_identity()
        );
    }
}

#[cfg(test)]
mod exchange_info_normalization_tests {
    use rstest::rstest;

    use super::*;

    /// The inherited Binance adapter's recorded USD-M `exchangeInfo` response (added in #180):
    /// `BTCUSDT` perpetual, `BTCUSDT_260925` quarterly, `XAUUSDT` `TRADIFI_PERPETUAL`.
    const USDM: &[u8] = include_bytes!(
        "../../../adapters/binance/test_data/futures/http_json/exchange_info_usdm.json"
    );
    /// Its COIN-M counterpart, whose entry carries `contractSize`.
    const COINM: &[u8] = include_bytes!(
        "../../../adapters/binance/test_data/futures/http_json/exchange_info_delivery_coinm.json"
    );
    const BTCUSDT_ONBOARD_NS: i128 = 1_569_398_400_000 * 1_000_000;

    fn venue() -> &'static InstrumentMasterVenueV2 {
        instrument_master_venue_v2("usdm/exchangeInfo").expect("the USD-M row")
    }

    fn retrieval() -> ExchangeInfoRetrievalV2 {
        ExchangeInfoRetrievalV2 {
            source_binding_identity: BindingDigest::from_untrusted_bytes([7; 32]),
            source_binding_digest: BindingDigest::from_untrusted_bytes([8; 32]),
            retrieval_time_ns: 1_790_000_000_000_000_000,
            owner_observation_time_ns: 1_790_000_000_500_000_000,
        }
    }

    fn normalize(
        payload: &[u8],
        raw_symbol: &str,
    ) -> Result<ExchangeInfoBaselineV2, ExchangeInfoNormalizationErrorV2> {
        ExchangeInfoBaselineV2::from_usdm_exchange_info(payload, raw_symbol, venue(), retrieval())
    }

    /// The real payload with `edit` applied to its `BTCUSDT` entry.
    fn edited(edit: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        let mut root: serde_json::Value = serde_json::from_slice(USDM).unwrap();
        let entry = root["symbols"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry["symbol"] == "BTCUSDT")
            .unwrap();
        edit(entry);
        serde_json::to_vec(&root).unwrap()
    }

    fn filter_mut<'a>(entry: &'a mut serde_json::Value, kind: &str) -> &'a mut serde_json::Value {
        entry["filters"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|filter| filter["filterType"] == kind)
            .unwrap()
    }

    const fn decimal(mantissa: i128, scale: u8) -> FactValue<InstrumentDecimalV2> {
        FactValue::Value(InstrumentDecimalV2 { mantissa, scale })
    }

    #[rstest]
    fn the_venue_table_is_keyed_by_the_exact_dataset_mapping() {
        assert_eq!(venue().venue_identity, "BINANCE");

        for other in [
            "coinm/exchangeInfo",
            "usdm/exchangeInfo/",
            "USDM/exchangeInfo",
            "usdm",
            "",
        ] {
            assert!(instrument_master_venue_v2(other).is_none(), "{other:?}");
        }
    }

    /// Every term of `BTCUSDT`, derived from the real payload, field by field.
    #[rstest]
    fn a_real_usdm_payload_yields_the_venues_own_terms() {
        let baseline = normalize(USDM, "BTCUSDT").expect("BTCUSDT is a USD-M perpetual");

        assert_eq!(baseline.canonical_identity, "BTCUSDT-PERP.BINANCE");
        assert_eq!(baseline.venue_identity, "BINANCE");
        assert_eq!(baseline.raw_symbol, "BTCUSDT");
        assert_eq!(
            baseline.instrument_class,
            PublicInstrumentClassV2::CryptoPerpetual
        );
        assert_eq!(baseline.provenance.effective_from_ns, BTCUSDT_ONBOARD_NS);
        assert_eq!(
            baseline.provenance.raw_payload_digest,
            digest(EXCHANGE_INFO_PAYLOAD_DOMAIN_V2, USDM)
        );
        assert_eq!(
            baseline.terms,
            InstrumentMasterPublicTermsV2 {
                base_currency: FactValue::Value("BTC".to_owned()),
                quote_currency: FactValue::Value("USDT".to_owned()),
                settlement_currency: FactValue::Value("USDT".to_owned()),
                contract_status: FactValue::Value("TRADING".to_owned()),
                is_inverse: FactValue::Value(false),
                price_precision_from_filter: FactValue::Value(1),
                quantity_precision_from_filter: FactValue::Value(3),
                price_increment_from_filter: decimal(1, 1),
                quantity_increment_from_filter: decimal(1, 3),
                contract_multiplier: decimal(1, 0),
                lot_size: decimal(1, 3),
                minimum_price: decimal(1, 1),
                maximum_price: decimal(1_000_000, 0),
                minimum_quantity: decimal(1, 3),
                maximum_quantity: decimal(1_000, 0),
                minimum_notional: decimal(5, 0),
                maximum_notional: FactValue::Unavailable,
            }
        );

        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(baseline)
            .expect("the derived baseline is a valid fact");
        assert_eq!(
            fact.terms_basis(),
            InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing
        );
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(fact.canonical_bytes(), None),
            Ok(fact)
        );
    }

    /// The basis is in the canonical bytes: a fact stating any other is not a V2 fact.
    #[rstest]
    fn a_fact_stating_another_terms_basis_does_not_decode() {
        let fact = InstrumentMasterFactV2::from_exchange_info_baseline(
            normalize(USDM, "BTCUSDT").unwrap(),
        )
        .unwrap();
        let bytes = fact.canonical_bytes();
        // The basis is the last byte of the snapshot; locate it as the one byte whose change
        // alone turns a decodable fact into a codec mismatch while it currently reads 1.
        let mut refused = 0;

        for position in 0..bytes.len() {
            if bytes[position] != InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing as u8 {
                continue;
            }
            let mut altered = bytes.to_vec();
            altered[position] = 2;

            if InstrumentMasterFactV2::from_canonical_bytes(&altered, None)
                == Err(InstrumentMasterV2Error::CodecMismatch)
            {
                refused += 1;
            }
        }
        assert!(
            refused >= 1,
            "some byte reading 1 is the basis, and 2 there is refused"
        );
    }

    #[rstest]
    fn bounds_of_zero_are_unbounded_and_an_absent_notional_filter_is_unavailable() {
        let baseline = normalize(
            &edited(|entry| {
                filter_mut(entry, "PRICE_FILTER")["maxPrice"] = "0".into();
                filter_mut(entry, "LOT_SIZE")["maxQty"] = "0.000".into();
                filter_mut(entry, "MIN_NOTIONAL")["notional"] = "0".into();
            }),
            "BTCUSDT",
        )
        .unwrap();
        assert_eq!(baseline.terms.maximum_price, FactValue::Unbounded);
        assert_eq!(baseline.terms.maximum_quantity, FactValue::Unbounded);
        assert_eq!(baseline.terms.minimum_notional, FactValue::Unbounded);

        let without_notional = normalize(
            &edited(|entry| {
                entry["filters"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|filter| filter["filterType"] != "MIN_NOTIONAL");
            }),
            "BTCUSDT",
        )
        .unwrap();
        assert_eq!(
            without_notional.terms.minimum_notional,
            FactValue::Unavailable
        );
    }

    /// Each named refusal, reached by a real payload or one edit of it.
    #[rstest]
    #[case::not_json(b"exchangeInfo".to_vec(), "BTCUSDT", ExchangeInfoNormalizationErrorV2::NotExchangeInfo)]
    #[case::no_symbols(b"{}".to_vec(), "BTCUSDT", ExchangeInfoNormalizationErrorV2::NotExchangeInfo)]
    #[case::absent(USDM.to_vec(), "ETHUSDT", ExchangeInfoNormalizationErrorV2::SymbolAbsent)]
    #[case::not_byte_equal(USDM.to_vec(), "btcusdt", ExchangeInfoNormalizationErrorV2::SymbolAbsent)]
    #[case::quarterly(USDM.to_vec(), "BTCUSDT_260925", ExchangeInfoNormalizationErrorV2::ContractTypeUnsupported)]
    #[case::tradifi(USDM.to_vec(), "XAUUSDT", ExchangeInfoNormalizationErrorV2::ContractTypeUnsupported)]
    #[case::coinm_shape(COINM.to_vec(), "BTCUSD_260925", ExchangeInfoNormalizationErrorV2::DatasetMismatch)]
    fn a_real_payload_refuses_by_name(
        #[case] payload: Vec<u8>,
        #[case] raw_symbol: &str,
        #[case] refusal: ExchangeInfoNormalizationErrorV2,
    ) {
        assert_eq!(normalize(&payload, raw_symbol), Err(refusal));
    }

    #[rstest]
    fn an_edited_payload_refuses_by_name() {
        use ExchangeInfoNormalizationErrorV2::{
            DatasetMismatch, FilterUnavailable, OnboardDateUnavailable, SymbolAmbiguous,
        };

        let mut duplicated: serde_json::Value = serde_json::from_slice(USDM).unwrap();
        let first = duplicated["symbols"][0].clone();
        duplicated["symbols"].as_array_mut().unwrap().push(first);
        assert_eq!(
            normalize(&serde_json::to_vec(&duplicated).unwrap(), "BTCUSDT"),
            Err(SymbolAmbiguous)
        );

        let cases: [(&str, Vec<u8>, ExchangeInfoNormalizationErrorV2); 11] = [
            (
                "contractSize present",
                edited(|entry| entry["contractSize"] = 1.into()),
                DatasetMismatch,
            ),
            (
                "onboardDate absent",
                edited(|entry| {
                    entry.as_object_mut().unwrap().remove("onboardDate");
                }),
                OnboardDateUnavailable,
            ),
            (
                "onboardDate after the retrieval",
                edited(|entry| entry["onboardDate"] = 1_800_000_000_000_i64.into()),
                OnboardDateUnavailable,
            ),
            (
                "PRICE_FILTER absent",
                edited(|entry| {
                    entry["filters"]
                        .as_array_mut()
                        .unwrap()
                        .retain(|filter| filter["filterType"] != "PRICE_FILTER");
                }),
                FilterUnavailable,
            ),
            (
                "LOT_SIZE twice",
                edited(|entry| {
                    let lot = filter_mut(entry, "LOT_SIZE").clone();
                    entry["filters"].as_array_mut().unwrap().push(lot);
                }),
                FilterUnavailable,
            ),
            (
                "tick in exponent form",
                edited(|entry| filter_mut(entry, "PRICE_FILTER")["tickSize"] = "1e-1".into()),
                FilterUnavailable,
            ),
            (
                "negative tick",
                edited(|entry| filter_mut(entry, "PRICE_FILTER")["tickSize"] = "-0.1".into()),
                FilterUnavailable,
            ),
            (
                "empty step",
                edited(|entry| filter_mut(entry, "LOT_SIZE")["stepSize"] = "".into()),
                FilterUnavailable,
            ),
            (
                "zero step",
                edited(|entry| filter_mut(entry, "LOT_SIZE")["stepSize"] = "0.000".into()),
                FilterUnavailable,
            ),
            (
                "tick with a bare point",
                edited(|entry| filter_mut(entry, "PRICE_FILTER")["tickSize"] = "1.".into()),
                FilterUnavailable,
            ),
            (
                "status absent",
                edited(|entry| {
                    entry.as_object_mut().unwrap().remove("status");
                }),
                FilterUnavailable,
            ),
        ];

        for (name, payload, refusal) in cases {
            assert_eq!(normalize(&payload, "BTCUSDT"), Err(refusal), "{name}");
        }
    }
}

#[cfg(test)]
mod generation_consistency_tests {
    use rstest::rstest;

    use super::{
        FactValue, InstrumentMasterFactV2, InstrumentMasterGenerationMismatchV2 as Mismatch,
        InstrumentMasterGenerationTermV2 as Term, require_same_generation_v2,
        tests::{baseline, complete_terms, fact_for},
    };
    use crate::owner::{
        instrument_master::{
            InstrumentClass, InstrumentDecimal, InstrumentMasterFactProposalV1,
            InstrumentMasterFactV1, InstrumentVenueSourceMapping, authority::build_fact,
        },
        shared_time_evidence::build_head_fact,
        source_binding::{
            BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule,
            MarketDataClockCutKind,
        },
    };

    const BTC: (&str, &str) = ("BTCUSDT-PERP.BINANCE", "BTCUSDT");
    const ETH: (&str, &str) = ("ETHUSDT-PERP.BINANCE", "ETHUSDT");

    /// A V1 fact built by the V1 authority stating exactly what [`fact_for`] states for the same
    /// instrument: a crypto perpetual with one `BINANCE` mapping of the raw symbol, a tick of
    /// 0.01, a step of 0.001 and a multiplier of 1. `edit` changes one statement.
    fn v1_fact(
        (canonical, raw): (&str, &str),
        edit: impl FnOnce(&mut InstrumentMasterFactProposalV1),
    ) -> InstrumentMasterFactV1 {
        let head = build_head_fact(
            &MarketDataClockAdmission {
                cut_kind: MarketDataClockCutKind::MarketDataAsOf,
                clock_identity: "12345678901234567890123456789012".into(),
                clock_epoch: "abcdefghijklmnopqrstuvwxyzABCDEF".into(),
                monotonic_sequence: 1,
                wall_observed: 60,
                decision_cut: 60,
                valid_through: 100,
                restart_continuity_digest: BindingDigest::from_untrusted_bytes([30; 32]),
                uncertainty_bound: 1,
                skew_bound: 2,
                comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
            },
            None,
        )
        .unwrap();
        let mut proposal = crate::owner::calendar::tests::instrument_readback("XNYS-CALENDAR-V1")
            .facts()[0]
            .proposal
            .clone();
        proposal.canonical_identity = canonical.into();
        proposal.mappings = vec![InstrumentVenueSourceMapping {
            venue_identity: "BINANCE".into(),
            source_identity: "USDM".into(),
            source_instrument: raw.as_bytes().to_vec(),
        }];
        proposal.instrument_class = InstrumentClass::CryptoPerpetual;
        proposal.price_increment = InstrumentDecimal {
            mantissa: 1,
            scale: 2,
        };
        proposal.quantity_increment = InstrumentDecimal {
            mantissa: 1,
            scale: 3,
        };
        proposal.contract_multiplier = InstrumentDecimal {
            mantissa: 1,
            scale: 0,
        };
        edit(&mut proposal);
        build_fact(proposal, &head.handoff, None).unwrap()
    }

    fn v2_fact((canonical, raw): (&str, &str), seed: u8) -> InstrumentMasterFactV2 {
        fact_for(canonical, raw, seed)
    }

    /// Both generations describing the same instruments pass, in either order, for one member and
    /// for two; the fixture's two facts agree in every rule, so each refusal below is its edit's.
    #[rstest]
    fn the_same_instruments_in_both_generations_pass() {
        let btc = v2_fact(BTC, 10);
        let eth = v2_fact(ETH, 20);
        assert_eq!(
            require_same_generation_v2(&[v1_fact(BTC, |_| {})], std::slice::from_ref(&btc)),
            Ok(())
        );
        assert_eq!(
            require_same_generation_v2(&[v1_fact(ETH, |_| {}), v1_fact(BTC, |_| {})], &[btc, eth]),
            Ok(())
        );
    }

    #[rstest]
    fn a_different_member_set_is_refused() {
        let btc = v2_fact(BTC, 10);
        let eth = v2_fact(ETH, 20);
        assert_eq!(
            require_same_generation_v2(&[v1_fact(BTC, |_| {})], std::slice::from_ref(&eth)),
            Err(Mismatch::MemberSetDiffers)
        );
        assert_eq!(
            require_same_generation_v2(
                &[v1_fact(BTC, |_| {}), v1_fact(ETH, |_| {})],
                std::slice::from_ref(&btc)
            ),
            Err(Mismatch::MemberSetDiffers)
        );
        assert_eq!(
            require_same_generation_v2(&[v1_fact(BTC, |_| {})], &[btc, eth]),
            Err(Mismatch::MemberSetDiffers)
        );
    }

    /// Each rule refuses by its own name, driven by one edit of an otherwise agreeing V1 fact.
    #[rstest]
    #[case::class(
        |p: &mut InstrumentMasterFactProposalV1| p.instrument_class = InstrumentClass::Equity,
        Mismatch::ClassDiffers
    )]
    #[case::no_mapping_at_the_venue(
        |p: &mut InstrumentMasterFactProposalV1| p.mappings[0].venue_identity = "XNAS".into(),
        Mismatch::VenueMappingAbsent
    )]
    #[case::two_mappings_at_the_venue(
        |p: &mut InstrumentMasterFactProposalV1| {
            let mut second = p.mappings[0].clone();
            second.source_identity = "USDM-MIRROR".into();
            p.mappings.push(second);
        },
        Mismatch::VenueMappingAmbiguous
    )]
    #[case::raw_symbol(
        |p: &mut InstrumentMasterFactProposalV1| p.mappings[0].source_instrument = b"BTCUSD".to_vec(),
        Mismatch::RawSymbolDiffers
    )]
    #[case::tick(
        |p: &mut InstrumentMasterFactProposalV1| {
            p.price_increment = InstrumentDecimal { mantissa: 1, scale: 1 };
        },
        Mismatch::TermDiffers(Term::PriceIncrement)
    )]
    #[case::step(
        |p: &mut InstrumentMasterFactProposalV1| {
            p.quantity_increment = InstrumentDecimal { mantissa: 1, scale: 2 };
        },
        Mismatch::TermDiffers(Term::QuantityIncrement)
    )]
    #[case::multiplier(
        |p: &mut InstrumentMasterFactProposalV1| {
            p.contract_multiplier = InstrumentDecimal { mantissa: 10, scale: 0 };
        },
        Mismatch::TermDiffers(Term::ContractMultiplier)
    )]
    fn each_disagreement_is_refused_by_its_rule(
        #[case] edit: fn(&mut InstrumentMasterFactProposalV1),
        #[case] refusal: Mismatch,
    ) {
        assert_eq!(
            require_same_generation_v2(&[v1_fact(BTC, edit)], &[v2_fact(BTC, 10)]),
            Err(refusal)
        );
    }

    /// A V2 term that is not a value cannot vouch for the V1 term, whatever that term is: an
    /// unavailable, unbounded or not-applicable tick, step or multiplier is refused, not skipped.
    #[rstest]
    fn a_term_that_is_not_a_value_is_refused_not_skipped() {
        for term in [
            Term::PriceIncrement,
            Term::QuantityIncrement,
            Term::ContractMultiplier,
        ] {
            for absent in [
                FactValue::Unavailable,
                FactValue::Unbounded,
                FactValue::NotApplicable,
            ] {
                let mut terms = complete_terms();
                *match term {
                    Term::PriceIncrement => &mut terms.price_increment_from_filter,
                    Term::QuantityIncrement => &mut terms.quantity_increment_from_filter,
                    Term::ContractMultiplier => &mut terms.contract_multiplier,
                } = absent.clone();
                let v2 =
                    InstrumentMasterFactV2::from_exchange_info_baseline(baseline(terms)).unwrap();
                assert_eq!(
                    require_same_generation_v2(&[v1_fact(BTC, |_| {})], &[v2]),
                    Err(Mismatch::TermNotAValue(term)),
                    "{term:?} {absent:?}"
                );
            }
        }
    }
}

#[cfg(test)]
mod contract_info_normalization_tests {
    use rstest::rstest;

    use super::*;

    /// The recorded USD-M `exchangeInfo` the baseline comes from, as the baseline intake reads it.
    const USDM: &[u8] = include_bytes!(
        "../../../adapters/binance/test_data/futures/http_json/exchange_info_usdm.json"
    );
    /// The baseline's retrieval and Owner observation.
    const RETRIEVED_NS: i128 = 1_790_000_000_000_000_000;
    const OBSERVED_NS: i128 = 1_790_000_000_500_000_000;
    /// The event's instant, a day after the baseline was observed, in milliseconds as `E` states it.
    const EVENT_MS: u64 = 1_790_086_400_000;

    /// The `BTCUSDT` baseline admitted from the recorded payload.
    fn baseline() -> InstrumentMasterFactV2 {
        let venue = instrument_master_venue_v2("usdm/exchangeInfo").expect("the USD-M row");
        InstrumentMasterFactV2::from_exchange_info_baseline(
            ExchangeInfoBaselineV2::from_usdm_exchange_info(
                USDM,
                "BTCUSDT",
                venue,
                ExchangeInfoRetrievalV2 {
                    source_binding_identity: BindingDigest::from_untrusted_bytes([7; 32]),
                    source_binding_digest: BindingDigest::from_untrusted_bytes([8; 32]),
                    retrieval_time_ns: RETRIEVED_NS,
                    owner_observation_time_ns: OBSERVED_NS,
                },
            )
            .unwrap(),
        )
        .unwrap()
    }

    /// A `!contractInfo` event in the shape the provider documents for its Contract Info Stream,
    /// for `BTCUSDT`, with `edit` applied. No captured event exists in this repository, so this is
    /// the documented shape, not a recording.
    fn event(edit: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        let mut event = serde_json::json!({
            "e": "contractInfo",
            "E": EVENT_MS,
            "s": "BTCUSDT",
            "ct": "PERPETUAL",
            "dt": 4_133_404_800_000_u64,
            "ot": 1_569_398_400_000_u64,
            "cs": "SETTLING",
            "bks": [{"bs": 1, "bnf": 0, "bnc": 5000, "mmr": 0.01, "cf": 0, "mi": 21, "ma": 50}],
            "st": 1
        });
        edit(&mut event);
        serde_json::to_vec(&event).unwrap()
    }

    /// Received a second after the event, and observed by the Owner a minute later.
    fn received() -> ContractInfoRetrievalV2 {
        ContractInfoRetrievalV2 {
            retrieval_time_ns: i128::from(EVENT_MS) * 1_000_000 + 1_000_000_000,
            owner_observation_time_ns: i128::from(EVENT_MS) * 1_000_000 + 60_000_000_000,
        }
    }

    /// The event becomes exactly the next fact: the status is the event's, every other term is
    /// the baseline's, and the chain coordinates are derived from the fact it follows.
    #[rstest]
    fn a_status_event_becomes_the_facts_direct_successor() {
        let baseline = baseline();
        let payload = event(|_| {});
        let delta = baseline
            .usdm_contract_info_delta(&payload, received())
            .expect("a status change the fact takes");

        assert_eq!(delta.canonical_identity, "BTCUSDT-PERP.BINANCE");
        assert_eq!(delta.correction_sequence, 2);
        assert_eq!(
            delta.provider_event_time_ns,
            i128::from(EVENT_MS) * 1_000_000
        );
        assert_eq!(
            delta.raw_payload_digest,
            contract_info_payload_digest_v2(&payload)
        );
        assert_ne!(
            delta.raw_payload_digest,
            exchange_info_payload_digest_v2(&payload)
        );
        assert_eq!(
            delta.predecessor_source_event_digest,
            baseline.latest_source_event_digest()
        );
        assert_eq!(
            (delta.source_binding_identity, delta.source_binding_digest),
            (
                baseline.baseline_provenance().source_binding_identity,
                baseline.baseline_provenance().source_binding_digest
            )
        );
        let successor = baseline.apply_contract_info_delta(delta).unwrap();
        assert!(successor.is_direct_successor_of(&baseline));
        assert_eq!(
            successor.terms().contract_status,
            FactValue::Value("SETTLING".to_owned())
        );
        let mut unchanged = successor.terms().clone();
        unchanged.contract_status = baseline.terms().contract_status.clone();
        assert_eq!(&unchanged, baseline.terms(), "only the status changed");
        assert_eq!(successor.terms_basis(), baseline.terms_basis());
        assert_eq!(
            successor.owner_observation_time_ns(),
            received().owner_observation_time_ns
        );

        // A later event extends the successor, not the baseline.
        let later = event(|event| {
            event["E"] = serde_json::json!(EVENT_MS + 1_000);
            event["cs"] = serde_json::json!("TRADING");
        });
        let mut after = received();
        after.retrieval_time_ns += 1_000_000_000;
        after.owner_observation_time_ns += 1_000_000_000;
        let third = successor
            .apply_contract_info_delta(successor.usdm_contract_info_delta(&later, after).unwrap())
            .unwrap();
        assert_eq!(third.correction_sequence(), 3);
        assert!(third.is_direct_successor_of(&successor));
    }

    /// What the event carries besides the status - brackets, listing and delivery instants, the
    /// pair - is read by nothing, so it moves no term.
    #[rstest]
    fn nothing_but_the_status_is_read() {
        let baseline = baseline();
        let plain = baseline
            .apply_contract_info_delta(
                baseline
                    .usdm_contract_info_delta(&event(|_| {}), received())
                    .unwrap(),
            )
            .unwrap();
        let other = baseline
            .apply_contract_info_delta(
                baseline
                    .usdm_contract_info_delta(
                        &event(|event| {
                            event["bks"] = serde_json::json!([]);
                            event["dt"] = serde_json::json!(1);
                            event["ot"] = serde_json::json!(2);
                            event["ps"] = serde_json::json!("BTCUSDT");
                            event.as_object_mut().unwrap().remove("st");
                        }),
                        received(),
                    )
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(plain.terms(), other.terms());
    }

    /// Each refusal, driven by one edit of the event or of its reception.
    #[rstest]
    #[case::not_json(|_: &mut serde_json::Value| {}, true, ContractInfoNormalizationErrorV2::InvalidEvent)]
    #[case::another_event(|e: &mut serde_json::Value| e["e"] = serde_json::json!("markPriceUpdate"), false, ContractInfoNormalizationErrorV2::InvalidEvent)]
    #[case::no_event_instant(|e: &mut serde_json::Value| { e.as_object_mut().unwrap().remove("E"); }, false, ContractInfoNormalizationErrorV2::InvalidEvent)]
    #[case::negative_event_instant(|e: &mut serde_json::Value| e["E"] = serde_json::json!(-1), false, ContractInfoNormalizationErrorV2::InvalidEvent)]
    #[case::fractional_event_instant(|e: &mut serde_json::Value| e["E"] = serde_json::json!(1.5), false, ContractInfoNormalizationErrorV2::InvalidEvent)]
    #[case::no_status(|e: &mut serde_json::Value| { e.as_object_mut().unwrap().remove("cs"); }, false, ContractInfoNormalizationErrorV2::InvalidEvent)]
    #[case::empty_status(|e: &mut serde_json::Value| e["cs"] = serde_json::json!(""), false, ContractInfoNormalizationErrorV2::InvalidEvent)]
    #[case::another_symbol(|e: &mut serde_json::Value| e["s"] = serde_json::json!("ETHUSDT"), false, ContractInfoNormalizationErrorV2::SymbolMismatch)]
    #[case::symbol_case(|e: &mut serde_json::Value| e["s"] = serde_json::json!("btcusdt"), false, ContractInfoNormalizationErrorV2::SymbolMismatch)]
    #[case::delivery_contract(|e: &mut serde_json::Value| e["ct"] = serde_json::json!("CURRENT_QUARTER"), false, ContractInfoNormalizationErrorV2::ContractTypeUnsupported)]
    #[case::coin_margined(|e: &mut serde_json::Value| e["st"] = serde_json::json!(2), false, ContractInfoNormalizationErrorV2::DatasetMismatch)]
    #[case::system_as_text(|e: &mut serde_json::Value| e["st"] = serde_json::json!("1"), false, ContractInfoNormalizationErrorV2::DatasetMismatch)]
    #[case::before_the_listing(|e: &mut serde_json::Value| e["E"] = serde_json::json!(1_569_398_400_000_u64), false, ContractInfoNormalizationErrorV2::EventOutOfOrder)]
    #[case::unchanged_status(|e: &mut serde_json::Value| e["cs"] = serde_json::json!("TRADING"), false, ContractInfoNormalizationErrorV2::StatusUnchanged)]
    fn each_defect_is_refused_by_name(
        #[case] edit: fn(&mut serde_json::Value),
        #[case] not_json: bool,
        #[case] refusal: ContractInfoNormalizationErrorV2,
    ) {
        let payload = if not_json {
            b"contractInfo".to_vec()
        } else {
            event(edit)
        };
        assert_eq!(
            baseline().usdm_contract_info_delta(&payload, received()),
            Err(refusal)
        );
    }

    /// An event later than its own reception is refused, whatever else it says.
    #[rstest]
    fn an_event_after_its_retrieval_is_refused() {
        let mut early = received();
        early.retrieval_time_ns = i128::from(EVENT_MS) * 1_000_000 - 1;
        assert_eq!(
            baseline().usdm_contract_info_delta(&event(|_| {}), early),
            Err(ContractInfoNormalizationErrorV2::EventAfterRetrieval)
        );
    }

    /// Once a delta is admitted, an event no later than it is out of order against the new head,
    /// even though it is later than the baseline.
    #[rstest]
    fn an_event_no_later_than_the_latest_delta_is_out_of_order() {
        let baseline = baseline();
        let successor = baseline
            .apply_contract_info_delta(
                baseline
                    .usdm_contract_info_delta(&event(|_| {}), received())
                    .unwrap(),
            )
            .unwrap();

        // Each status differs from the head's `SETTLING`, so only the instant can refuse it.
        for instant in [EVENT_MS, EVENT_MS - 1] {
            let stale = event(|event| {
                event["E"] = serde_json::json!(instant);
                event["cs"] = serde_json::json!("DELIVERING");
            });
            assert_eq!(
                successor.usdm_contract_info_delta(&stale, received()),
                Err(ContractInfoNormalizationErrorV2::EventOutOfOrder),
                "{instant}"
            );
        }
    }

    /// A baseline knows the status as of its retrieval, not as of the listing. An event after the
    /// listing but no later than the retrieval is older than what the baseline already observed,
    /// so it is refused rather than admitted over the newer status; one a millisecond later is not.
    #[rstest]
    fn an_event_after_listing_but_no_later_than_the_baseline_retrieval_is_out_of_order() {
        let baseline = baseline();
        let retrieved_ms = u64::try_from(RETRIEVED_NS / 1_000_000).unwrap();
        assert!(
            i128::from(retrieved_ms - 1) * 1_000_000
                > baseline.baseline_provenance().effective_from_ns,
            "the instants lie after the listing"
        );

        for instant in [retrieved_ms - 86_400_000, retrieved_ms - 1, retrieved_ms] {
            assert_eq!(
                baseline.usdm_contract_info_delta(
                    &event(|event| event["E"] = serde_json::json!(instant)),
                    received()
                ),
                Err(ContractInfoNormalizationErrorV2::EventOutOfOrder),
                "{instant}"
            );
        }
        let after = event(|event| event["E"] = serde_json::json!(retrieved_ms + 1));
        let delta = baseline
            .usdm_contract_info_delta(&after, received())
            .expect("an event after the retrieval is newer than the baseline");
        assert!(baseline.apply_contract_info_delta(delta).is_ok());
    }
}

#[cfg(test)]
mod exchange_info_snapshot_tests {
    use rstest::rstest;

    use super::*;

    /// The recorded USD-M `exchangeInfo` the baseline comes from, as the baseline intake reads it.
    const USDM: &[u8] = include_bytes!(
        "../../../adapters/binance/test_data/futures/http_json/exchange_info_usdm.json"
    );
    const RETRIEVED_NS: i128 = 1_790_000_000_000_000_000;
    const OBSERVED_NS: i128 = 1_790_000_000_500_000_000;

    fn binding() -> (BindingDigest, BindingDigest) {
        (
            BindingDigest::from_untrusted_bytes([7; 32]),
            BindingDigest::from_untrusted_bytes([8; 32]),
        )
    }

    fn venue() -> &'static InstrumentMasterVenueV2 {
        instrument_master_venue_v2("usdm/exchangeInfo").expect("the USD-M row")
    }

    fn baseline_of(raw_symbol: &str) -> InstrumentMasterFactV2 {
        let (identity, digest) = binding();
        InstrumentMasterFactV2::from_exchange_info_baseline(
            ExchangeInfoBaselineV2::from_usdm_exchange_info(
                USDM,
                raw_symbol,
                venue(),
                ExchangeInfoRetrievalV2 {
                    source_binding_identity: identity,
                    source_binding_digest: digest,
                    retrieval_time_ns: RETRIEVED_NS,
                    owner_observation_time_ns: OBSERVED_NS,
                },
            )
            .unwrap(),
        )
        .unwrap()
    }

    fn hex(digest: BindingDigest) -> String {
        use std::fmt::Write as _;

        digest
            .as_bytes()
            .iter()
            .fold(String::new(), |mut text, byte| {
                write!(text, "{byte:02x}").unwrap();
                text
            })
    }

    const HOUR_NS: i128 = 3_600_000_000_000;
    const MINUTE_NS: i128 = 60_000_000_000;

    /// The recorded payload with `edit` applied to its `BTCUSDT` entry.
    fn edited(edit: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        let mut root: serde_json::Value = serde_json::from_slice(USDM).unwrap();
        let entry = root["symbols"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry["symbol"] == "BTCUSDT")
            .unwrap();
        edit(entry);
        serde_json::to_vec(&root).unwrap()
    }

    /// The payload with `BTCUSDT`'s tick changed from `0.10` to `0.20`.
    fn wider_tick() -> Vec<u8> {
        edited(|entry| {
            let filter = entry["filters"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|filter| filter["filterType"] == "PRICE_FILTER")
                .unwrap();
            filter["tickSize"] = serde_json::json!("0.20");
        })
    }

    /// Retrieved `hours` after the baseline under the baseline's binding, observed a second later.
    fn later(hours: i128) -> ExchangeInfoRetrievalV2 {
        let (identity, digest) = binding();
        ExchangeInfoRetrievalV2 {
            source_binding_identity: identity,
            source_binding_digest: digest,
            retrieval_time_ns: RETRIEVED_NS + hours * HOUR_NS,
            owner_observation_time_ns: RETRIEVED_NS + hours * HOUR_NS + 1_000_000_000,
        }
    }

    fn snapshot(
        fact: &InstrumentMasterFactV2,
        payload: &[u8],
        hours: i128,
    ) -> InstrumentMasterFactV2 {
        let successor = fact
            .usdm_exchange_info_snapshot(payload, venue(), later(hours))
            .unwrap();
        fact.apply_exchange_info_snapshot(successor).unwrap()
    }

    /// A later snapshot with the baseline's terms becomes the next fact: it follows the baseline,
    /// names its payload, keeps its terms and its basis, and decodes only against it.
    #[rstest]
    fn an_unchanged_snapshot_extends_the_fact_and_keeps_the_basis() {
        let baseline = baseline_of("BTCUSDT");
        let fact = snapshot(&baseline, USDM, 1);

        assert_eq!(fact.predecessor_fact_digest(), Some(baseline.identity()));
        assert_eq!(fact.correction_sequence(), 2);
        assert_eq!(fact.terms(), baseline.terms());
        assert_eq!(
            fact.terms_basis(),
            InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing
        );
        assert_eq!(
            fact.latest_source_event_digest(),
            exchange_info_payload_digest_v2(USDM),
            "a snapshot of unchanged bytes still names what it read"
        );
        assert_eq!(
            fact.latest_snapshot().unwrap().retrieval_time_ns,
            RETRIEVED_NS + HOUR_NS
        );
        assert_eq!(fact.baseline_provenance(), baseline.baseline_provenance());
        assert!(fact.is_direct_successor_of(&baseline));
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(fact.canonical_bytes(), Some(&baseline)),
            Ok(fact.clone())
        );
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(fact.canonical_bytes(), None),
            Err(InstrumentMasterV2Error::SuccessorMismatch)
        );
        assert_eq!(
            fact.canonical_bytes().len(),
            baseline.canonical_bytes().len() + 32 + 107,
            "the baseline's bytes, its identity as the predecessor, and the snapshot record: tag, \
             step, no delta, two digests, sequence, two instants and the basis"
        );
    }

    /// A snapshot whose terms differ changes them and ends the listing basis for good; a later
    /// snapshot that states the baseline's terms again does not restore it.
    #[rstest]
    fn a_changed_snapshot_changes_the_terms_and_ends_the_listing_basis() {
        let baseline = baseline_of("BTCUSDT");
        let changed = snapshot(&baseline, &wider_tick(), 1);

        assert_eq!(
            changed.terms().price_increment_from_filter,
            FactValue::Value(InstrumentDecimalV2 {
                mantissa: 2,
                scale: 1
            })
        );
        assert_eq!(
            changed.terms_basis(),
            InstrumentTermsBasisV2::ObservedSinceTermsChange
        );
        let unchanged_after = snapshot(&changed, &wider_tick(), 2);
        assert_eq!(unchanged_after.terms(), changed.terms());
        assert_eq!(
            unchanged_after.terms_basis(),
            InstrumentTermsBasisV2::ObservedSinceTermsChange
        );
        let back = snapshot(&unchanged_after, USDM, 3);
        assert_eq!(back.terms(), baseline.terms());
        assert_eq!(
            back.terms_basis(),
            InstrumentTermsBasisV2::ObservedSinceTermsChange,
            "the baseline's terms did not hold between the change and this snapshot"
        );

        for (fact, predecessor) in [
            (&changed, &baseline),
            (&unchanged_after, &changed),
            (&back, &unchanged_after),
        ] {
            assert_eq!(
                InstrumentMasterFactV2::from_canonical_bytes(
                    fact.canonical_bytes(),
                    Some(predecessor)
                ),
                Ok(fact.clone())
            );
        }
    }

    /// A status event in the provider's documented `!contractInfo` shape, at `minutes` after the
    /// baseline's retrieval.
    fn status_event(minutes: i128, status: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "e": "contractInfo",
            "E": u64::try_from((RETRIEVED_NS + minutes * MINUTE_NS) / 1_000_000).unwrap(),
            "s": "BTCUSDT", "ct": "PERPETUAL", "cs": status, "st": 1
        }))
        .unwrap()
    }

    fn received_at(minutes: i128) -> ContractInfoRetrievalV2 {
        ContractInfoRetrievalV2 {
            retrieval_time_ns: RETRIEVED_NS + minutes * MINUTE_NS,
            owner_observation_time_ns: RETRIEVED_NS + minutes * MINUTE_NS + 1_000_000_000,
        }
    }

    fn delta_at(
        fact: &InstrumentMasterFactV2,
        minutes: i128,
        status: &str,
        received: i128,
    ) -> Result<InstrumentMasterFactV2, ContractInfoNormalizationErrorV2> {
        let delta =
            fact.usdm_contract_info_delta(&status_event(minutes, status), received_at(received))?;
        Ok(fact.apply_contract_info_delta(delta).unwrap())
    }

    /// Retrieved `minutes` after the baseline and admitted when the Owner observed it at
    /// `observed` minutes, which a snapshot admitted after a later delta shares with that delta.
    fn snapshot_at(
        fact: &InstrumentMasterFactV2,
        payload: &[u8],
        minutes: i128,
        observed: i128,
    ) -> InstrumentMasterFactV2 {
        let (identity, digest) = binding();
        let retrieval = ExchangeInfoRetrievalV2 {
            source_binding_identity: identity,
            source_binding_digest: digest,
            retrieval_time_ns: RETRIEVED_NS + minutes * MINUTE_NS,
            owner_observation_time_ns: RETRIEVED_NS + observed * MINUTE_NS + 1_000_000_000,
        };
        fact.apply_exchange_info_snapshot(
            fact.usdm_exchange_info_snapshot(payload, venue(), retrieval)
                .unwrap(),
        )
        .unwrap()
    }

    /// A snapshot later than the instant the fact knows the status at sets the status; the status
    /// is not a term the basis speaks for, so the basis stays. One that is not later keeps the
    /// fact's newer status and records its terms only, and may not state its own.
    #[rstest]
    fn a_snapshot_sets_the_status_only_when_it_is_the_newer_evidence() {
        let baseline = baseline_of("BTCUSDT");
        let settling = edited(|entry| entry["status"] = serde_json::json!("SETTLING"));
        let newer = snapshot_at(&baseline, &settling, 60, 60);

        assert_eq!(
            newer.terms().contract_status,
            FactValue::Value("SETTLING".to_owned())
        );
        assert_eq!(
            newer.terms_basis(),
            InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing
        );

        // A delta at 120 minutes is newer still; a snapshot retrieved at 90 is later than the last
        // snapshot, so its terms are recorded, but older than the delta, so its status is not.
        let traded = delta_at(&newer, 120, "TRADING", 150).unwrap();
        let older = snapshot_at(&traded, &settling, 90, 150);
        assert_eq!(
            older.terms().contract_status,
            FactValue::Value("TRADING".to_owned())
        );
        assert_eq!(older.latest_delta(), traded.latest_delta());
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(older.canonical_bytes(), Some(&traded)),
            Ok(older.clone())
        );
        let (identity, digest) = binding();
        let mut stating_its_own = traded
            .usdm_exchange_info_snapshot(
                &settling,
                venue(),
                ExchangeInfoRetrievalV2 {
                    source_binding_identity: identity,
                    source_binding_digest: digest,
                    retrieval_time_ns: RETRIEVED_NS + 90 * MINUTE_NS,
                    owner_observation_time_ns: RETRIEVED_NS + 151 * MINUTE_NS,
                },
            )
            .unwrap();
        stating_its_own.terms.contract_status = FactValue::Value("SETTLING".to_owned());
        assert_eq!(
            traded.apply_exchange_info_snapshot(stating_its_own),
            Err(InstrumentMasterV2Error::InvalidProvenance)
        );
    }

    /// The status has one order across deltas and snapshots; snapshots have their own among
    /// themselves. An event no later than a snapshot the fact already holds is refused, the status
    /// instant boundary; a snapshot retrieved before a delta the fact holds is still admitted.
    #[rstest]
    fn a_snapshot_moves_the_status_order_but_a_delta_does_not_move_the_terms_order() {
        let baseline = baseline_of("BTCUSDT");
        let snapshotted = snapshot_at(&baseline, USDM, 120, 120);

        for minutes in [60, 120] {
            assert_eq!(
                delta_at(&snapshotted, minutes, "SETTLING", 180),
                Err(ContractInfoNormalizationErrorV2::EventOutOfOrder),
                "{minutes}"
            );
        }
        let settled = delta_at(&snapshotted, 150, "SETTLING", 180).unwrap();
        assert_eq!(settled.latest_snapshot(), snapshotted.latest_snapshot());
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(
                settled.canonical_bytes(),
                Some(&snapshotted)
            ),
            Ok(settled.clone())
        );

        let queued = snapshot_at(&settled, USDM, 135, 180);
        assert_eq!(
            queued.terms().contract_status,
            FactValue::Value("SETTLING".to_owned()),
            "the snapshot is older than the delta, so the delta's status stays"
        );
        assert_eq!(queued.latest_delta(), settled.latest_delta());
        assert_eq!(
            queued.latest_snapshot().unwrap().retrieval_time_ns,
            RETRIEVED_NS + 135 * MINUTE_NS
        );
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(queued.canonical_bytes(), Some(&settled)),
            Ok(queued.clone())
        );
        assert_eq!(
            queued.canonical_bytes().len(),
            snapshotted.canonical_bytes().len() + 222 + 1,
            "the delta's record, and one more character in its status than `TRADING`"
        );
    }

    #[rstest]
    fn each_snapshot_that_is_not_a_later_one_of_this_listing_is_refused_by_name() {
        use ExchangeInfoSnapshotNormalizationErrorV2 as Refused;

        let baseline = baseline_of("BTCUSDT");
        let normalize = |fact: &InstrumentMasterFactV2, payload: &[u8], retrieval| {
            fact.usdm_exchange_info_snapshot(payload, venue(), retrieval)
        };

        assert_eq!(
            normalize(&baseline, USDM, later(0)),
            Err(Refused::SnapshotOutOfOrder),
            "retrieved when the baseline was"
        );
        let snapshotted = snapshot(&baseline, USDM, 2);

        for hours in [1, 2] {
            assert_eq!(
                normalize(&snapshotted, USDM, later(hours)),
                Err(Refused::SnapshotOutOfOrder),
                "{hours}"
            );
        }
        assert_eq!(
            normalize(
                &baseline,
                &edited(|entry| entry["onboardDate"] = serde_json::json!(1_569_398_400_001_u64)),
                later(1)
            ),
            Err(Refused::ListingDiffers)
        );
        assert_eq!(
            normalize(
                &baseline,
                &edited(|entry| entry["symbol"] = serde_json::json!("OTHER")),
                later(1)
            ),
            Err(Refused::Payload(
                ExchangeInfoNormalizationErrorV2::SymbolAbsent
            ))
        );
        assert_eq!(
            normalize(&baseline, b"[]", later(1)),
            Err(Refused::Payload(
                ExchangeInfoNormalizationErrorV2::NotExchangeInfo
            ))
        );
    }

    #[rstest]
    fn a_snapshot_that_is_not_the_facts_direct_successor_does_not_apply() {
        let baseline = baseline_of("BTCUSDT");
        let successor = baseline
            .usdm_exchange_info_snapshot(USDM, venue(), later(1))
            .unwrap();

        let mut other_binding = successor.clone();
        other_binding.source_binding_digest = BindingDigest::from_untrusted_bytes([9; 32]);
        assert_eq!(
            baseline.apply_exchange_info_snapshot(other_binding),
            Err(InstrumentMasterV2Error::SourceBindingMismatch)
        );
        let mut skipped = successor.clone();
        skipped.snapshot.correction_sequence = 3;
        assert_eq!(
            baseline.apply_exchange_info_snapshot(skipped),
            Err(InstrumentMasterV2Error::CorrectionSequenceMismatch)
        );
        let mut elsewhere = successor.clone();
        elsewhere.snapshot.predecessor_source_event_digest =
            BindingDigest::from_untrusted_bytes([9; 32]);
        assert_eq!(
            baseline.apply_exchange_info_snapshot(elsewhere),
            Err(InstrumentMasterV2Error::SourceEventPredecessorMismatch)
        );
        let mut not_newer = successor.clone();
        not_newer.snapshot.retrieval_time_ns = RETRIEVED_NS;
        assert_eq!(
            baseline.apply_exchange_info_snapshot(not_newer),
            Err(InstrumentMasterV2Error::TimeRegression)
        );
        let mut observed_before = successor;
        observed_before.snapshot.owner_observation_time_ns = OBSERVED_NS - 1;
        observed_before.snapshot.retrieval_time_ns = OBSERVED_NS - 1;
        assert_eq!(
            baseline.apply_exchange_info_snapshot(observed_before),
            Err(InstrumentMasterV2Error::TimeRegression)
        );
    }

    /// The basis a fact states is the one its chain gives: bytes claiming another do not decode.
    #[rstest]
    fn a_snapshot_stating_a_basis_its_chain_does_not_give_does_not_decode() {
        let baseline = baseline_of("BTCUSDT");
        let fact = snapshot(&baseline, USDM, 1);
        // The basis is the last byte of the lineage, which the terms follow.
        let terms_len = {
            let mut encoder = Encoder::default();
            encode_terms(&mut encoder, fact.terms()).unwrap();
            encoder.finish().len()
        };
        let basis_at = fact.canonical_bytes().len() - terms_len - 1;
        assert_eq!(
            fact.canonical_bytes()[basis_at],
            InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing as u8
        );
        let mut claimed = fact.canonical_bytes().to_vec();
        claimed[basis_at] = InstrumentTermsBasisV2::ObservedSinceTermsChange as u8;
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(&claimed, Some(&baseline)),
            Err(InstrumentMasterV2Error::SuccessorMismatch)
        );
        claimed[basis_at] = 3;
        assert_eq!(
            InstrumentMasterFactV2::from_canonical_bytes(&claimed, Some(&baseline)),
            Err(InstrumentMasterV2Error::CodecMismatch)
        );
    }

    /// A year of hourly snapshots of an unchanged instrument: every fact decodes against the one
    /// before it, as a cut or an admission reads a member's chain, and each is the same size.
    #[rstest]
    fn a_year_of_hourly_snapshots_decodes_as_one_chain() {
        const HOURS: i128 = 8_760;

        let mut chain = vec![baseline_of("BTCUSDT")];
        for hour in 1..=HOURS {
            let next = snapshot(chain.last().unwrap(), USDM, hour);
            chain.push(next);
        }
        let bytes: Vec<&[u8]> = chain
            .iter()
            .map(InstrumentMasterFactV2::canonical_bytes)
            .collect();
        let started = std::time::Instant::now();
        let mut decoded = InstrumentMasterFactV2::from_canonical_bytes(bytes[0], None).unwrap();
        for fact in &bytes[1..] {
            decoded = InstrumentMasterFactV2::from_canonical_bytes(fact, Some(&decoded)).unwrap();
        }
        let elapsed = started.elapsed();

        assert_eq!(decoded, *chain.last().unwrap());
        assert!(bytes[1..].iter().all(|fact| fact.len() == bytes[1].len()));
        eprintln!(
            "{} facts of {} bytes decoded as one chain in {elapsed:?}",
            bytes.len(),
            bytes[1].len()
        );
    }

    /// F's case: a baseline from the recorded payload, the status successor B1 admits after it,
    /// and a one-member cut over the baseline keep the exact bytes they had before snapshot
    /// successors existed. These were read from that tree, so a codec change that is not additive
    /// moves one of them.
    #[rstest]
    fn a_baseline_its_status_successor_and_its_cut_keep_their_bytes() {
        let baseline = baseline_of("BTCUSDT");
        let delta = baseline
            .usdm_contract_info_delta(
                &serde_json::to_vec(&serde_json::json!({
                    "e": "contractInfo", "E": 1_790_086_400_000_u64, "s": "BTCUSDT",
                    "ct": "PERPETUAL", "cs": "SETTLING", "st": 1
                }))
                .unwrap(),
                ContractInfoRetrievalV2 {
                    retrieval_time_ns: 1_790_086_401_000_000_000,
                    owner_observation_time_ns: 1_790_086_460_000_000_000,
                },
            )
            .unwrap();
        let successor = baseline.apply_contract_info_delta(delta).unwrap();
        let cut = InstrumentMasterCutV2::issue(
            InstrumentMasterCutRequestV2::new(BindingDigest::from_untrusted_bytes([30; 32]), 7),
            BindingDigest::from_untrusted_bytes([31; 32]),
            BindingDigest::from_untrusted_bytes([32; 32]),
            BindingDigest::from_untrusted_bytes([33; 32]),
            vec![baseline.clone()],
        )
        .unwrap();

        assert_eq!(
            (
                baseline.canonical_bytes().len(),
                hex(baseline.identity()).as_str()
            ),
            (
                414,
                "eb7ca6f83437082c6e838d88c2d70827e9f8c460848ae9587894f5b8f0383144"
            )
        );
        assert_eq!(
            (
                successor.canonical_bytes().len(),
                hex(successor.identity()).as_str()
            ),
            (
                669,
                "c849c3b0b9ccbe39e1fbd5f1c6f2457b21ff7a938a99e3cfe43e53b97f6dc5e2"
            )
        );
        assert_eq!(
            (cut.canonical_bytes().len(), hex(cut.identity()).as_str()),
            (
                669,
                "2cf8cc2bb714c0ec23bfc5445a7816e199d5936ef375a9c1510a1da1262f270d"
            )
        );
    }
}
