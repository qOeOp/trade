//! Market Data-owned binding of one typed `StrategyDesignV2` input role.
//!
//! The public request is an untrusted proposal. A positive receipt can only be derived by scanning
//! an Owner-verified complete PIT observation batch. Callers never select canonical row keys.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Display,
};

use serde::{Deserialize, Serialize};

use super::{
    pit_snapshot::{VerifiedPitObservation, VerifiedPitObservationBatch},
    source_binding::BindingDigest,
};

/// The first-vertical scope proposed by Research.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum UntrustedStrategyInputScope {
    /// One exact canonical instrument.
    ExactInstrument {
        /// Canonical instrument identity, not a ticker alias.
        instrument: String,
    },
    /// A Universe Selection Record scope. This is not supported by the first vertical.
    UniverseSelection {
        /// Expected Owner-derived static selection identity, never a caller member list or PIT-request digest.
        selection_identity: BindingDigest,
    },
    /// An explicit multi-instrument scope. This is not supported by the first vertical.
    InstrumentSet {
        /// Proposed instrument identities.
        instruments: Vec<String>,
    },
}

/// Typed Market Data channel.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StrategyInputChannel {
    /// Market observations.
    Market,
    /// Reference observations.
    Reference,
    /// Economic observations.
    Economic,
}

impl StrategyInputChannel {
    const fn canonical(self) -> &'static str {
        match self {
            Self::Market => "MARKET",
            Self::Reference => "REFERENCE",
            Self::Economic => "ECONOMIC",
        }
    }
}

/// Typed field semantics owned by Market Data.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MarketDataFieldSemantic {
    /// Bar open price.
    BarOpenPrice,
    /// Bar high price.
    BarHighPrice,
    /// Bar low price.
    BarLowPrice,
    /// Bar close price.
    BarClosePrice,
    /// Bar volume quantity.
    BarVolumeQuantity,
    /// Quote bid price.
    QuoteBidPrice,
    /// Quote ask price.
    QuoteAskPrice,
    /// Quote bid size.
    QuoteBidSize,
    /// Quote ask size.
    QuoteAskSize,
    /// Trade price.
    TradeLastPrice,
    /// Trade size.
    TradeLastSize,
    /// Scalar value.
    ScalarValue,
}

impl MarketDataFieldSemantic {
    const ALL: [Self; 12] = [
        Self::BarOpenPrice,
        Self::BarHighPrice,
        Self::BarLowPrice,
        Self::BarClosePrice,
        Self::BarVolumeQuantity,
        Self::QuoteBidPrice,
        Self::QuoteAskPrice,
        Self::QuoteBidSize,
        Self::QuoteAskSize,
        Self::TradeLastPrice,
        Self::TradeLastSize,
        Self::ScalarValue,
    ];

    const fn identity(self) -> &'static str {
        match self {
            Self::BarOpenPrice => "MARKET_DATA.BAR.OPEN.PRICE.V1",
            Self::BarHighPrice => "MARKET_DATA.BAR.HIGH.PRICE.V1",
            Self::BarLowPrice => "MARKET_DATA.BAR.LOW.PRICE.V1",
            Self::BarClosePrice => "MARKET_DATA.BAR.CLOSE.PRICE.V1",
            Self::BarVolumeQuantity => "MARKET_DATA.BAR.VOLUME.QUANTITY.V1",
            Self::QuoteBidPrice => "MARKET_DATA.QUOTE.BID.PRICE.V1",
            Self::QuoteAskPrice => "MARKET_DATA.QUOTE.ASK.PRICE.V1",
            Self::QuoteBidSize => "MARKET_DATA.QUOTE.BID.SIZE.V1",
            Self::QuoteAskSize => "MARKET_DATA.QUOTE.ASK.SIZE.V1",
            Self::TradeLastPrice => "MARKET_DATA.TRADE.LAST.PRICE.V1",
            Self::TradeLastSize => "MARKET_DATA.TRADE.LAST.SIZE.V1",
            Self::ScalarValue => "MARKET_DATA.SCALAR.VALUE.V1",
        }
    }

    const fn row_field(self) -> &'static str {
        match self {
            Self::BarOpenPrice => "OPEN",
            Self::BarHighPrice => "HIGH",
            Self::BarLowPrice => "LOW",
            Self::BarClosePrice => "CLOSE",
            Self::BarVolumeQuantity => "VOLUME",
            Self::QuoteBidPrice => "BID_PRICE",
            Self::QuoteAskPrice => "ASK_PRICE",
            Self::QuoteBidSize => "BID_SIZE",
            Self::QuoteAskSize => "ASK_SIZE",
            Self::TradeLastPrice => "LAST_PRICE",
            Self::TradeLastSize => "LAST_SIZE",
            Self::ScalarValue => "VALUE",
        }
    }

    fn from_identity(identity: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|semantic| semantic.identity() == identity)
    }

    const fn data_kind(self) -> &'static str {
        match self {
            Self::BarOpenPrice
            | Self::BarHighPrice
            | Self::BarLowPrice
            | Self::BarClosePrice
            | Self::BarVolumeQuantity => "BAR",
            Self::QuoteBidPrice | Self::QuoteAskPrice | Self::QuoteBidSize | Self::QuoteAskSize => {
                "QUOTE"
            }
            Self::TradeLastPrice | Self::TradeLastSize => "TRADE",
            Self::ScalarValue => "SCALAR",
        }
    }

    const fn unit(self) -> StrategyInputUnit {
        match self {
            Self::BarOpenPrice
            | Self::BarHighPrice
            | Self::BarLowPrice
            | Self::BarClosePrice
            | Self::QuoteBidPrice
            | Self::QuoteAskPrice
            | Self::TradeLastPrice => StrategyInputUnit::Price,
            Self::BarVolumeQuantity
            | Self::QuoteBidSize
            | Self::QuoteAskSize
            | Self::TradeLastSize => StrategyInputUnit::Quantity,
            Self::ScalarValue => StrategyInputUnit::Scalar,
        }
    }
}

/// Value unit required by the Research declaration.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StrategyInputUnit {
    /// A price value.
    Price,
    /// A quantity value.
    Quantity,
    /// A dimensionless scalar.
    Scalar,
}

impl StrategyInputUnit {
    const fn canonical(self) -> &'static str {
        match self {
            Self::Price => "PRICE",
            Self::Quantity => "QUANTITY",
            Self::Scalar => "SCALAR",
        }
    }
}

/// Untrusted request to bind one Research-declared market/reference role.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedStrategyInputBindingRequest {
    /// Caller-proposed R&D request identity; Market Data binds but does not verify R&D authority.
    pub research_request_identity: BindingDigest,
    /// Caller-proposed `StrategyDesignV2` identity.
    pub strategy_design_identity: BindingDigest,
    /// Caller-proposed typed input-role identity.
    pub input_role_identity: BindingDigest,
    /// Exact supported or explicitly unsupported scope.
    pub scope: UntrustedStrategyInputScope,
    /// Market Data-owned field semantic.
    pub field_semantic: MarketDataFieldSemantic,
    /// Exact channel.
    pub channel: StrategyInputChannel,
    /// Exact canonical timeframe or bar specification.
    pub timeframe: String,
    /// Declared unit, checked against the field semantic.
    pub unit: StrategyInputUnit,
    /// Exact fixed-point scale.
    pub scale: u8,
    /// Exact PIT request identity expected by the caller.
    pub pit_request_identity: BindingDigest,
    /// Exact PIT request content digest expected by the caller.
    pub pit_request_digest: BindingDigest,
    /// Exact PIT snapshot identity expected by the caller.
    pub snapshot_identity: BindingDigest,
    /// Exact PIT fact digest expected by the caller.
    pub snapshot_fact_digest: BindingDigest,
    /// Exact complete observation-batch digest expected by the caller.
    pub observation_batch_digest: BindingDigest,
    /// Exact source identity expected by the caller.
    pub source_binding_identity: BindingDigest,
    /// Exact source frontier expected by the caller.
    pub source_frontier_digest: BindingDigest,
    /// Exact correction frontier expected by the caller.
    pub correction_frontier_digest: BindingDigest,
    /// Exact Instrument Master version expected by the caller.
    pub instrument_master_digest: BindingDigest,
    /// Exact Universe Selection Record version expected by the caller.
    pub universe_selection_digest: BindingDigest,
    /// Exact Market Semantics Compatibility identity expected by the caller.
    pub market_semantics_identity: BindingDigest,
    /// Exact decision cut expected by the caller.
    pub decision_cut: u64,
}

/// Structured fail-closed binding outcome. Every variant carries zero positive receipt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StrategyInputBindingUnavailable {
    /// A required identity, scope value, or timeframe is absent.
    MissingField(&'static str),
    /// The supplied batch is not the exact PIT lineage requested.
    StaleBatch,
    /// More than one plausible row remains before exact resolution.
    AmbiguousResolution,
    /// More than one row exactly matches the role.
    NonUniqueResolution,
    /// No canonical observation exactly matches the role.
    NoMatchingObservation,
    /// The first vertical does not support this scope kind.
    UnsupportedScope,
    /// The declared unit is incompatible with the Owner field semantic.
    UnitMismatch,
    /// A matching observation exists only at a different scale.
    ScaleMismatch,
    /// The canonical row cannot map to one shared-kernel lifecycle class.
    UnsupportedLifecycleKind,
    /// The canonical row lacks a non-zero Owner ordering coordinate.
    MissingLifecycleCoordinate,
    /// The verified batch does not contain exactly two canonical universe members.
    InvalidUniverseCardinality,
    /// Member keys and canonical instruments do not form a one-to-one mapping.
    InconsistentUniverseMember,
}

impl Display for StrategyInputBindingUnavailable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for StrategyInputBindingUnavailable {}

/// Serializable locator emitted by a positive sealed receipt.
///
/// It is a locator only; copying its serialized fields cannot mint a receipt.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct StrategyInputBindingLocator {
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
    field_semantic_identity: &'static str,
    instrument: String,
    channel: &'static str,
    data_kind: &'static str,
    timeframe: String,
    unit: &'static str,
    scale: u8,
    selection_identity: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    correction_stream_identity: String,
    market_semantics_identity: BindingDigest,
}

impl StrategyInputBindingLocator {
    /// Returns the caller-proposed R&D request identity without asserting R&D authority.
    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    /// Returns the caller-proposed `StrategyDesignV2` identity.
    pub const fn strategy_design_identity(&self) -> BindingDigest {
        self.strategy_design_identity
    }

    /// Returns the caller-proposed input-role identity.
    pub const fn input_role_identity(&self) -> BindingDigest {
        self.input_role_identity
    }

    /// Returns the Market Data-owned semantic identity.
    pub const fn field_semantic_identity(&self) -> &'static str {
        self.field_semantic_identity
    }

    /// Returns the exact canonical instrument scope.
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    /// Returns the exact canonical channel.
    pub const fn channel(&self) -> &'static str {
        self.channel
    }

    /// Returns the exact canonical data kind.
    pub const fn data_kind(&self) -> &'static str {
        self.data_kind
    }

    /// Returns the exact timeframe or bar specification.
    pub fn timeframe(&self) -> &str {
        &self.timeframe
    }

    /// Returns the Market Data-owned canonical unit.
    pub const fn unit(&self) -> &'static str {
        self.unit
    }

    /// Returns the exact fixed-point scale.
    pub const fn scale(&self) -> u8 {
        self.scale
    }

    /// Returns the role-independent stable selection identity.
    pub const fn selection_identity(&self) -> BindingDigest {
        self.selection_identity
    }

    /// Returns the frozen Source Binding lineage root.
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }

    /// Returns the exact Market Semantics Compatibility identity.
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    /// Returns the frozen correction stream identity.
    pub fn correction_stream_identity(&self) -> &str {
        &self.correction_stream_identity
    }
}

/// Owner-sealed positive binding receipt.
///
/// It has no public constructor and deliberately does not implement `Deserialize`.
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_binding::StrategyInputBindingReceipt;
///
/// let forged: StrategyInputBindingReceipt = serde_json::from_slice(b"{}").unwrap();
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::{
///     source_binding::BindingDigest,
///     strategy_input_binding::StrategyInputBindingReceipt,
/// };
///
/// let forged = StrategyInputBindingReceipt {
///     locator: panic!("no public locator constructor"),
///     digest: BindingDigest::from_untrusted_bytes([1; 32]),
/// };
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputBindingReceipt {
    locator: StrategyInputBindingLocator,
    digest: BindingDigest,
}

impl StrategyInputBindingReceipt {
    /// Returns the complete positive binding locator.
    pub const fn locator(&self) -> &StrategyInputBindingLocator {
        &self.locator
    }

    /// Returns the complete binding digest.
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// Neutral lifecycle class sealed by Market Data without depending on Strategy Factory or its SDK.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum StrategyInputEventKind {
    /// One canonical bar observation.
    Bar,
    /// One canonical quote, trade, reference, economic, or scalar observation.
    Event,
}

/// Exact neutral lifecycle coordinates consumed without reinterpretation by the shared kernel adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct StrategyInputLifecycleProjection {
    kind: StrategyInputEventKind,
    logical_time: u64,
    event_time: u64,
    owner_sequence: u64,
    event_identity: [u8; 16],
}

impl StrategyInputLifecycleProjection {
    pub const fn kind(&self) -> StrategyInputEventKind {
        self.kind
    }
    pub const fn logical_time(&self) -> u64 {
        self.logical_time
    }
    pub const fn event_time(&self) -> u64 {
        self.event_time
    }
    pub const fn owner_sequence(&self) -> u64 {
        self.owner_sequence
    }
    pub const fn event_identity(&self) -> [u8; 16] {
        self.event_identity
    }
}

/// Owner-sealed trigger for one verified multi-field event frame.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputEventTriggerReceipt {
    lifecycle: StrategyInputLifecycleProjection,
    observation_batch_digest: BindingDigest,
    snapshot_identity: BindingDigest,
    snapshot_fact_digest: BindingDigest,
    digest: BindingDigest,
}

impl StrategyInputEventTriggerReceipt {
    pub const fn lifecycle(&self) -> StrategyInputLifecycleProjection {
        self.lifecycle
    }
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }
    pub const fn snapshot_fact_digest(&self) -> BindingDigest {
        self.snapshot_fact_digest
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// Owner-sealed exact typed value for one role in an admitted multi-field frame.
///
/// The value bytes are signed little-endian i128 fixed-point mantissa bytes. `value_scale` remains
/// the scale sealed by the original binding receipt. The receipt has no public constructor and does
/// not implement `Deserialize`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputEventValueReceipt {
    input_role_identity: BindingDigest,
    binding_receipt_digest: BindingDigest,
    value_type_semantic_id: &'static str,
    value_bytes: [u8; 16],
    value_scale: u8,
    canonical_row_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    correction_stream_identity: String,
    correction_sequence: u64,
    correction_frontier_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    trigger_digest: BindingDigest,
    observation_batch_digest: BindingDigest,
    digest: BindingDigest,
}

impl StrategyInputEventValueReceipt {
    pub const fn input_role_identity(&self) -> BindingDigest {
        self.input_role_identity
    }
    pub const fn binding_receipt_digest(&self) -> BindingDigest {
        self.binding_receipt_digest
    }
    pub const fn value_type_semantic_id(&self) -> &'static str {
        self.value_type_semantic_id
    }
    pub const fn value_bytes(&self) -> &[u8; 16] {
        &self.value_bytes
    }
    pub const fn value_scale(&self) -> u8 {
        self.value_scale
    }
    pub const fn canonical_row_digest(&self) -> BindingDigest {
        self.canonical_row_digest
    }
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }
    pub fn correction_stream_identity(&self) -> &str {
        &self.correction_stream_identity
    }
    pub const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }
    pub const fn correction_frontier_digest(&self) -> BindingDigest {
        self.correction_frontier_digest
    }
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
    pub const fn trigger_digest(&self) -> BindingDigest {
        self.trigger_digest
    }
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// One complete Owner-sealed trigger plus canonically ordered binding/value receipts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputEventFrameReceipt {
    trigger: StrategyInputEventTriggerReceipt,
    values: Box<[StrategyInputEventValueReceipt]>,
}

/// One canonical member of an Owner-derived universe selection.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct StrategyInputUniverseMember {
    member_key: String,
    instrument: String,
}

impl StrategyInputUniverseMember {
    /// Returns the stable member key carried by the verified PIT batch.
    pub fn member_key(&self) -> &str {
        &self.member_key
    }

    /// Returns the canonical Instrument Master identity for this member.
    pub fn instrument(&self) -> &str {
        &self.instrument
    }
}

/// Owner-sealed exactly-two-member universe selection for one verified PIT batch.
///
/// The selection identity is derived from Owner facts, not accepted from the caller. The receipt
/// has no public constructor and deliberately does not implement `Deserialize`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputUniverseSelectionReceipt {
    selection_identity: BindingDigest,
    selection_digest: BindingDigest,
    instrument_master_digest: BindingDigest,
    observation_batch_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    market_semantics_identity: BindingDigest,
    members: Box<[StrategyInputUniverseMember]>,
    digest: BindingDigest,
}

impl StrategyInputUniverseSelectionReceipt {
    pub const fn selection_identity(&self) -> BindingDigest {
        self.selection_identity
    }
    /// Returns the static Owner-derived digest of the canonical selection meaning.
    pub const fn selection_digest(&self) -> BindingDigest {
        self.selection_digest
    }
    pub const fn instrument_master_digest(&self) -> BindingDigest {
        self.instrument_master_digest
    }
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
    pub fn members(&self) -> &[StrategyInputUniverseMember] {
        &self.members
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// Owner-sealed value for one `(member, input role)` coordinate in a universe frame.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputUniverseValueReceipt {
    member_key: String,
    instrument: String,
    input_role_identity: BindingDigest,
    binding_digest: BindingDigest,
    value_type_semantic_id: &'static str,
    value_bytes: [u8; 16],
    value_scale: u8,
    canonical_row_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    correction_stream_identity: String,
    market_semantics_identity: BindingDigest,
    trigger_digest: BindingDigest,
    observation_batch_digest: BindingDigest,
    digest: BindingDigest,
}

impl StrategyInputUniverseValueReceipt {
    pub fn member_key(&self) -> &str {
        &self.member_key
    }
    pub fn instrument(&self) -> &str {
        &self.instrument
    }
    pub const fn input_role_identity(&self) -> BindingDigest {
        self.input_role_identity
    }
    pub const fn binding_digest(&self) -> BindingDigest {
        self.binding_digest
    }
    pub const fn value_type_semantic_id(&self) -> &'static str {
        self.value_type_semantic_id
    }
    pub const fn value_bytes(&self) -> &[u8; 16] {
        &self.value_bytes
    }
    pub const fn value_scale(&self) -> u8 {
        self.value_scale
    }
    pub const fn canonical_row_digest(&self) -> BindingDigest {
        self.canonical_row_digest
    }
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub fn correction_stream_identity(&self) -> &str {
        &self.correction_stream_identity
    }
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
    pub const fn trigger_digest(&self) -> BindingDigest {
        self.trigger_digest
    }
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// One atomic Owner-sealed two-member selection and canonically ordered member/role frame.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputUniverseFrameReceipt {
    selection: StrategyInputUniverseSelectionReceipt,
    trigger: StrategyInputEventTriggerReceipt,
    values: Box<[StrategyInputUniverseValueReceipt]>,
    digest: BindingDigest,
}

impl StrategyInputUniverseFrameReceipt {
    pub const fn selection(&self) -> &StrategyInputUniverseSelectionReceipt {
        &self.selection
    }
    pub const fn trigger(&self) -> &StrategyInputEventTriggerReceipt {
        &self.trigger
    }
    pub fn values(&self) -> &[StrategyInputUniverseValueReceipt] {
        &self.values
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

impl StrategyInputEventFrameReceipt {
    pub const fn trigger(&self) -> &StrategyInputEventTriggerReceipt {
        &self.trigger
    }
    pub fn values(&self) -> &[StrategyInputEventValueReceipt] {
        &self.values
    }
}

pub const STRATEGY_INPUT_FIXED_I128_LE_V1: &str = "strategy.input.fixed-i128-le.v1";

/// Resolves one exact role against one Owner-verified complete PIT observation batch.
///
/// # Errors
///
/// Returns a structured unavailable state for every missing, stale, ambiguous, unsupported,
/// incompatible, absent, or non-unique resolution. No error contains a partial receipt.
pub fn bind_strategy_input_role(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputBindingReceipt, StrategyInputBindingUnavailable> {
    let row = resolve_strategy_input_row(request, batch)?;
    Ok(issue_receipt(request, batch, row))
}

/// Resolves one complete multi-role frame and seals its trigger and ordered role values.
///
/// # Errors
///
/// Returns the same fail-closed unavailable states as role binding, plus unsupported or missing
/// lifecycle coordinates. No error carries either positive receipt.
pub fn bind_strategy_input_event_frame(
    bindings: &[StrategyInputBindingReceipt],
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputEventFrameReceipt, StrategyInputBindingUnavailable> {
    if bindings.is_empty() {
        return Err(StrategyInputBindingUnavailable::MissingField("event_frame"));
    }
    let mut role_identities = BTreeSet::new();
    let mut selection_identities = BTreeSet::new();

    for binding in bindings {
        if !role_identities.insert(binding.locator().input_role_identity())
            || !selection_identities.insert(binding.locator().selection_identity())
        {
            return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
        }
    }
    let mut resolved = bindings
        .iter()
        .map(|binding| {
            let row = resolve_static_binding_row(binding, batch)?;
            Ok((binding.clone(), row))
        })
        .collect::<Result<Vec<_>, StrategyInputBindingUnavailable>>()?;
    resolved.sort_by_key(|(binding, _)| binding.locator().input_role_identity());
    let trigger = issue_event_trigger_receipt(batch, &resolved)?;
    let mut values = Vec::with_capacity(resolved.len());
    for (binding, row) in resolved {
        values.push(issue_event_value_receipt(&trigger, &binding, batch, row));
    }
    Ok(StrategyInputEventFrameReceipt {
        trigger,
        values: values.into_boxed_slice(),
    })
}

/// Derives and seals one exactly-two-member universe plus every requested role for every member.
///
/// Membership comes only from the complete verified batch. `UniverseSelection.selection_identity`
/// is an untrusted expected identity and must equal the Owner-derived identity. Exact-instrument and
/// caller-supplied instrument-set scopes are rejected. No error contains a selection or frame receipt.
///
/// # Errors
///
/// Returns a structured unavailable state for an incomplete or inconsistent two-member universe,
/// stale authority, unsupported caller scope, or missing, ambiguous, or incompatible member-role row.
pub fn bind_strategy_input_universe_frame(
    requests: &[UntrustedStrategyInputBindingRequest],
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputUniverseFrameReceipt, StrategyInputBindingUnavailable> {
    if requests.is_empty() {
        return Err(StrategyInputBindingUnavailable::MissingField(
            "universe_frame",
        ));
    }
    let selection = derive_universe_selection(batch)?;
    let mut role_identities = BTreeSet::new();

    for request in requests {
        validate_request(request)?;
        if request.unit != request.field_semantic.unit() {
            return Err(StrategyInputBindingUnavailable::UnitMismatch);
        }

        if !batch_matches_request(request, batch) {
            return Err(StrategyInputBindingUnavailable::StaleBatch);
        }
        let expected = match request.scope {
            UntrustedStrategyInputScope::UniverseSelection { selection_identity } => {
                selection_identity
            }
            UntrustedStrategyInputScope::ExactInstrument { .. }
            | UntrustedStrategyInputScope::InstrumentSet { .. } => {
                return Err(StrategyInputBindingUnavailable::UnsupportedScope);
            }
        };

        if expected != selection.selection_identity() {
            return Err(StrategyInputBindingUnavailable::StaleBatch);
        }

        if !role_identities.insert(request.input_role_identity) {
            return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
        }
    }

    let mut resolved = Vec::with_capacity(requests.len() * selection.members().len());
    for member in selection.members() {
        for request in requests {
            let row = resolve_universe_member_role(request, member, batch)?;
            let binding_digest = universe_member_binding_digest(request, &selection, member, row);
            resolved.push((member, request, row, binding_digest));
        }
    }
    resolved.sort_by(|left, right| {
        (
            left.0.member_key(),
            left.0.instrument(),
            left.1.input_role_identity,
        )
            .cmp(&(
                right.0.member_key(),
                right.0.instrument(),
                right.1.input_role_identity,
            ))
    });
    let trigger = issue_universe_trigger_receipt(batch, &selection, &resolved)?;
    let values = resolved
        .into_iter()
        .map(|(member, request, row, binding_digest)| {
            issue_universe_value_receipt(&trigger, member, request, row, batch, binding_digest)
        })
        .collect::<Vec<_>>()
        .into_boxed_slice();
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_FRAME_RECEIPT_V1");
    canonical.digest(selection.digest());
    canonical.digest(trigger.digest());
    canonical.u64(values.len() as u64);
    for value in &values {
        canonical.digest(value.digest());
    }
    let digest = digest(&canonical.finish());
    Ok(StrategyInputUniverseFrameReceipt {
        selection,
        trigger,
        values,
        digest,
    })
}

fn derive_universe_selection(
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputUniverseSelectionReceipt, StrategyInputBindingUnavailable> {
    let mut by_member = BTreeMap::<String, String>::new();

    for row in batch.observations() {
        if row.member_key().is_empty() {
            return Err(StrategyInputBindingUnavailable::MissingField("member_key"));
        }

        if row.instrument().is_empty() {
            return Err(StrategyInputBindingUnavailable::MissingField("instrument"));
        }

        match by_member.entry(row.member_key().to_owned()) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(row.instrument().to_owned());
            }
            std::collections::btree_map::Entry::Occupied(entry)
                if entry.get() != row.instrument() =>
            {
                return Err(StrategyInputBindingUnavailable::InconsistentUniverseMember);
            }
            std::collections::btree_map::Entry::Occupied(_) => {}
        }
    }

    if by_member.len() != 2 {
        return Err(StrategyInputBindingUnavailable::InvalidUniverseCardinality);
    }
    let members = by_member
        .into_iter()
        .map(|(member_key, instrument)| StrategyInputUniverseMember {
            member_key,
            instrument,
        })
        .collect::<Vec<_>>()
        .into_boxed_slice();
    let mut instruments = BTreeSet::new();

    if members
        .iter()
        .any(|member| !instruments.insert(member.instrument()))
    {
        return Err(StrategyInputBindingUnavailable::InconsistentUniverseMember);
    }
    let mut static_meaning = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_SELECTION_STATIC_V1");
    static_meaning.digest(batch.instrument_master_digest());
    static_meaning.digest(batch.source_binding_lineage_root());
    static_meaning.digest(batch.market_semantics_identity());
    static_meaning.u64(members.len() as u64);
    for member in &members {
        static_meaning.string(member.member_key());
        static_meaning.string(member.instrument());
    }
    let static_meaning = static_meaning.finish();
    let mut identity_bytes = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_SELECTION_IDENTITY_V1");
    identity_bytes.bytes(&static_meaning);
    let selection_identity = digest(&identity_bytes.finish());
    let mut digest_bytes = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_SELECTION_DIGEST_V1");
    digest_bytes.bytes(&static_meaning);
    let selection_digest = digest(&digest_bytes.finish());
    let mut receipt_bytes = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_SELECTION_RECEIPT_V1");
    receipt_bytes.digest(selection_identity);
    receipt_bytes.digest(selection_digest);
    // Provenance only: this digest originates in the untrusted PIT request and is never selection
    // authority. The verified batch still binds it dynamically for exact request replay.
    receipt_bytes.digest(batch.universe_selection_digest());
    receipt_bytes.digest(batch.instrument_master_digest());
    receipt_bytes.digest(batch.snapshot_identity());
    receipt_bytes.digest(batch.fact_digest());
    receipt_bytes.digest(batch.digest());
    receipt_bytes.digest(batch.source_binding_identity());
    receipt_bytes.digest(batch.source_binding_lineage_root());
    receipt_bytes.u64(batch.source_binding_lineage_version());
    receipt_bytes.digest(batch.source_frontier_digest());
    receipt_bytes.digest(batch.correction_frontier_digest());
    receipt_bytes.digest(batch.market_semantics_identity());
    receipt_bytes.u64(members.len() as u64);
    for member in &members {
        receipt_bytes.string(member.member_key());
        receipt_bytes.string(member.instrument());
    }
    let receipt_digest = digest(&receipt_bytes.finish());
    Ok(StrategyInputUniverseSelectionReceipt {
        selection_identity,
        selection_digest,
        instrument_master_digest: batch.instrument_master_digest(),
        observation_batch_digest: batch.digest(),
        source_binding_lineage_root: batch.source_binding_lineage_root(),
        market_semantics_identity: batch.market_semantics_identity(),
        members,
        digest: receipt_digest,
    })
}

/// Returns the canonical Owner-derived identity for the complete verified two-member universe.
///
/// This crate-Owner-only helper keeps acceptance composition on the same codec and validation path
/// used by [`bind_strategy_input_universe_frame`]. It exposes no selection receipt or mint to
/// callers outside Market Data ownership.
#[cfg(feature = "sealed-strategy-input-acceptance")]
pub(in crate::owner) fn derive_strategy_input_universe_selection_identity(
    batch: &VerifiedPitObservationBatch,
) -> Result<BindingDigest, StrategyInputBindingUnavailable> {
    derive_universe_selection(batch).map(|selection| selection.selection_identity())
}

fn resolve_static_binding_row<'a>(
    binding: &StrategyInputBindingReceipt,
    batch: &'a VerifiedPitObservationBatch,
) -> Result<&'a VerifiedPitObservation, StrategyInputBindingUnavailable> {
    let locator = binding.locator();
    if locator.source_binding_lineage_root != batch.source_binding_lineage_root()
        || locator.market_semantics_identity != batch.market_semantics_identity()
    {
        return Err(StrategyInputBindingUnavailable::StaleBatch);
    }
    let semantic = MarketDataFieldSemantic::from_identity(locator.field_semantic_identity)
        .ok_or(StrategyInputBindingUnavailable::NoMatchingObservation)?;
    let rows = batch
        .observations()
        .iter()
        .filter(|row| {
            row.instrument() == locator.instrument
                && row.channel() == locator.channel
                && row.data_kind() == locator.data_kind
                && row.timeframe() == locator.timeframe
                && row.field() == semantic.row_field()
                && row.value_scale() == locator.scale
                && row.correction_stream_identity() == locator.correction_stream_identity
                && row.market_semantics_identity() == locator.market_semantics_identity
        })
        .collect::<Vec<_>>();

    if rows.len() != 1 {
        return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
    }
    Ok(rows[0])
}

fn resolve_universe_member_role<'a>(
    request: &UntrustedStrategyInputBindingRequest,
    member: &StrategyInputUniverseMember,
    batch: &'a VerifiedPitObservationBatch,
) -> Result<&'a VerifiedPitObservation, StrategyInputBindingUnavailable> {
    let semantic_rows = batch
        .observations()
        .iter()
        .filter(|row| {
            row.member_key() == member.member_key()
                && row.instrument() == member.instrument()
                && row.field() == request.field_semantic.row_field()
        })
        .collect::<Vec<_>>();
    let exact_without_scale = semantic_rows
        .iter()
        .copied()
        .filter(|row| {
            row.channel() == request.channel.canonical()
                && row.data_kind() == request.field_semantic.data_kind()
                && row.timeframe() == request.timeframe
        })
        .collect::<Vec<_>>();

    if exact_without_scale.is_empty() {
        return if semantic_rows.len() > 1 {
            Err(StrategyInputBindingUnavailable::AmbiguousResolution)
        } else {
            Err(StrategyInputBindingUnavailable::NoMatchingObservation)
        };
    }
    let exact = exact_without_scale
        .into_iter()
        .filter(|row| row.value_scale() == request.scale)
        .collect::<Vec<_>>();

    if exact.is_empty() {
        return Err(StrategyInputBindingUnavailable::ScaleMismatch);
    }

    if exact.len() != 1 {
        return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
    }
    let row = exact[0];
    if row.source_binding_identity() != batch.source_binding_identity()
        || row.source_frontier_digest() != batch.source_frontier_digest()
        || row.correction_frontier_digest() != batch.correction_frontier_digest()
        || row.instrument_master_digest() != batch.instrument_master_digest()
        || row.universe_selection_digest() != batch.universe_selection_digest()
        || row.market_semantics_identity() != batch.market_semantics_identity()
    {
        return Err(StrategyInputBindingUnavailable::StaleBatch);
    }
    Ok(row)
}

fn resolve_strategy_input_row<'a>(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &'a VerifiedPitObservationBatch,
) -> Result<&'a VerifiedPitObservation, StrategyInputBindingUnavailable> {
    validate_request(request)?;
    let instrument = match &request.scope {
        UntrustedStrategyInputScope::ExactInstrument { instrument } => instrument,
        UntrustedStrategyInputScope::UniverseSelection { .. }
        | UntrustedStrategyInputScope::InstrumentSet { .. } => {
            return Err(StrategyInputBindingUnavailable::UnsupportedScope);
        }
    };

    if request.unit != request.field_semantic.unit() {
        return Err(StrategyInputBindingUnavailable::UnitMismatch);
    }

    if !batch_matches_request(request, batch) {
        return Err(StrategyInputBindingUnavailable::StaleBatch);
    }

    let semantic_rows: Vec<&VerifiedPitObservation> = batch
        .observations()
        .iter()
        .filter(|row| {
            row.instrument() == instrument && row.field() == request.field_semantic.row_field()
        })
        .collect();
    let exact_without_scale: Vec<&VerifiedPitObservation> = semantic_rows
        .iter()
        .copied()
        .filter(|row| {
            row.channel() == request.channel.canonical()
                && row.data_kind() == request.field_semantic.data_kind()
                && row.timeframe() == request.timeframe
        })
        .collect();

    if exact_without_scale.is_empty() {
        return if semantic_rows.len() > 1 {
            Err(StrategyInputBindingUnavailable::AmbiguousResolution)
        } else {
            Err(StrategyInputBindingUnavailable::NoMatchingObservation)
        };
    }
    let exact: Vec<&VerifiedPitObservation> = exact_without_scale
        .iter()
        .copied()
        .filter(|row| row.value_scale() == request.scale)
        .collect();

    if exact.is_empty() {
        return Err(StrategyInputBindingUnavailable::ScaleMismatch);
    }

    if exact.len() != 1 {
        return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
    }
    Ok(exact[0])
}

fn validate_request(
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<(), StrategyInputBindingUnavailable> {
    let identities = [
        (
            "research_request_identity",
            request.research_request_identity,
        ),
        ("strategy_design_identity", request.strategy_design_identity),
        ("input_role_identity", request.input_role_identity),
        ("pit_request_identity", request.pit_request_identity),
        ("pit_request_digest", request.pit_request_digest),
        ("snapshot_identity", request.snapshot_identity),
        ("snapshot_fact_digest", request.snapshot_fact_digest),
        ("observation_batch_digest", request.observation_batch_digest),
        ("source_binding_identity", request.source_binding_identity),
        ("source_frontier_digest", request.source_frontier_digest),
        (
            "correction_frontier_digest",
            request.correction_frontier_digest,
        ),
        ("instrument_master_digest", request.instrument_master_digest),
        (
            "universe_selection_digest",
            request.universe_selection_digest,
        ),
        (
            "market_semantics_identity",
            request.market_semantics_identity,
        ),
    ];

    if let Some((name, _)) = identities
        .into_iter()
        .find(|(_, digest)| digest.as_bytes() == &[0; 32])
    {
        return Err(StrategyInputBindingUnavailable::MissingField(name));
    }

    if request.timeframe.is_empty() {
        return Err(StrategyInputBindingUnavailable::MissingField("timeframe"));
    }

    if request.decision_cut == 0 {
        return Err(StrategyInputBindingUnavailable::MissingField(
            "decision_cut",
        ));
    }

    if matches!(
        &request.scope,
        UntrustedStrategyInputScope::ExactInstrument { instrument } if instrument.is_empty()
    ) {
        return Err(StrategyInputBindingUnavailable::MissingField("instrument"));
    }
    Ok(())
}

fn batch_matches_request(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
) -> bool {
    request.pit_request_identity == batch.request_identity()
        && request.pit_request_digest == batch.request_digest()
        && request.snapshot_identity == batch.snapshot_identity()
        && request.snapshot_fact_digest == batch.fact_digest()
        && request.observation_batch_digest == batch.digest()
        && request.source_binding_identity == batch.source_binding_identity()
        && request.source_frontier_digest == batch.source_frontier_digest()
        && request.correction_frontier_digest == batch.correction_frontier_digest()
        && request.instrument_master_digest == batch.instrument_master_digest()
        && request.universe_selection_digest == batch.universe_selection_digest()
        && request.market_semantics_identity == batch.market_semantics_identity()
        && request.decision_cut == batch.time_evidence().decision_cut.value
}

fn issue_receipt(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    row: &VerifiedPitObservation,
) -> StrategyInputBindingReceipt {
    let mut locator = StrategyInputBindingLocator {
        research_request_identity: request.research_request_identity,
        strategy_design_identity: request.strategy_design_identity,
        input_role_identity: request.input_role_identity,
        field_semantic_identity: request.field_semantic.identity(),
        instrument: row.instrument().to_owned(),
        channel: request.channel.canonical(),
        data_kind: request.field_semantic.data_kind(),
        timeframe: row.timeframe().to_owned(),
        unit: request.unit.canonical(),
        scale: row.value_scale(),
        selection_identity: BindingDigest::from_untrusted_bytes([0; 32]),
        source_binding_lineage_root: batch.source_binding_lineage_root(),
        correction_stream_identity: row.correction_stream_identity().to_owned(),
        market_semantics_identity: row.market_semantics_identity(),
    };
    locator.selection_identity = digest(&canonical_selection_bytes(&locator));
    let digest = digest(&canonical_locator_bytes(&locator));
    StrategyInputBindingReceipt { locator, digest }
}

fn issue_event_trigger_receipt(
    batch: &VerifiedPitObservationBatch,
    resolved: &[(StrategyInputBindingReceipt, &VerifiedPitObservation)],
) -> Result<StrategyInputEventTriggerReceipt, StrategyInputBindingUnavailable> {
    let first = resolved[0].1;
    let kind = event_kind(first.data_kind())?;
    let provider_available = first.provider_available();
    let correction_publication = first.correction_publication();
    let logical_time = provider_available.max(correction_publication);
    let event_time = first.event_effective();
    let owner_sequence = first.correction_sequence();
    if owner_sequence == 0
        || resolved.iter().any(|(_, row)| {
            event_kind(row.data_kind()).ok() != Some(kind)
                || row.provider_available() != provider_available
                || row.correction_publication() != correction_publication
                || row.event_effective() != event_time
                || row.correction_sequence() != owner_sequence
        })
    {
        return Err(StrategyInputBindingUnavailable::MissingLifecycleCoordinate);
    }
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_EVENT_FRAME_V1");
    canonical.digest(batch.snapshot_identity());
    canonical.digest(batch.fact_digest());
    canonical.digest(batch.digest());
    canonical.u8(match kind {
        StrategyInputEventKind::Bar => 1,
        StrategyInputEventKind::Event => 2,
    });
    canonical.u64(logical_time);
    canonical.u64(event_time);
    canonical.u64(owner_sequence);
    canonical.u64(resolved.len() as u64);
    for (binding, row) in resolved {
        canonical.digest(binding.locator().input_role_identity());
        canonical.digest(binding.digest());
        canonical.digest(binding.locator().selection_identity());
        canonical.digest(digest(&canonical_row_binding_bytes(row)));
    }
    let digest = digest(&canonical.finish());
    let mut event_identity = [0; 16];
    event_identity.copy_from_slice(&digest.as_bytes()[..16]);
    if event_identity == [0; 16] {
        return Err(StrategyInputBindingUnavailable::MissingLifecycleCoordinate);
    }
    Ok(StrategyInputEventTriggerReceipt {
        lifecycle: StrategyInputLifecycleProjection {
            kind,
            logical_time,
            event_time,
            owner_sequence,
            event_identity,
        },
        observation_batch_digest: batch.digest(),
        snapshot_identity: batch.snapshot_identity(),
        snapshot_fact_digest: batch.fact_digest(),
        digest,
    })
}

fn issue_universe_trigger_receipt(
    batch: &VerifiedPitObservationBatch,
    selection: &StrategyInputUniverseSelectionReceipt,
    resolved: &[(
        &StrategyInputUniverseMember,
        &UntrustedStrategyInputBindingRequest,
        &VerifiedPitObservation,
        BindingDigest,
    )],
) -> Result<StrategyInputEventTriggerReceipt, StrategyInputBindingUnavailable> {
    let first = resolved[0].2;
    let kind = event_kind(first.data_kind())?;
    let provider_available = first.provider_available();
    let correction_publication = first.correction_publication();
    let logical_time = provider_available.max(correction_publication);
    let event_time = first.event_effective();
    let owner_sequence = first.correction_sequence();
    let correction_stream = first.correction_stream_identity();

    if owner_sequence == 0
        || resolved.iter().any(|(_, _, row, _)| {
            event_kind(row.data_kind()).ok() != Some(kind)
                || row.provider_available() != provider_available
                || row.correction_publication() != correction_publication
                || row.event_effective() != event_time
                || row.correction_sequence() != owner_sequence
                || row.correction_stream_identity() != correction_stream
        })
    {
        return Err(StrategyInputBindingUnavailable::MissingLifecycleCoordinate);
    }
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_EVENT_FRAME_V1");
    canonical.digest(selection.digest());
    canonical.digest(batch.snapshot_identity());
    canonical.digest(batch.fact_digest());
    canonical.digest(batch.digest());
    canonical.digest(batch.source_binding_lineage_root());
    canonical.digest(batch.market_semantics_identity());
    canonical.u8(match kind {
        StrategyInputEventKind::Bar => 1,
        StrategyInputEventKind::Event => 2,
    });
    canonical.u64(logical_time);
    canonical.u64(event_time);
    canonical.u64(owner_sequence);
    canonical.u64(resolved.len() as u64);
    for (member, request, row, binding_digest) in resolved {
        canonical.string(member.member_key());
        canonical.string(member.instrument());
        canonical.digest(request.input_role_identity);
        canonical.digest(*binding_digest);
        canonical.digest(digest(&canonical_row_binding_bytes(row)));
    }
    let digest = digest(&canonical.finish());
    let mut event_identity = [0; 16];
    event_identity.copy_from_slice(&digest.as_bytes()[..16]);
    if event_identity == [0; 16] {
        return Err(StrategyInputBindingUnavailable::MissingLifecycleCoordinate);
    }
    Ok(StrategyInputEventTriggerReceipt {
        lifecycle: StrategyInputLifecycleProjection {
            kind,
            logical_time,
            event_time,
            owner_sequence,
            event_identity,
        },
        observation_batch_digest: batch.digest(),
        snapshot_identity: batch.snapshot_identity(),
        snapshot_fact_digest: batch.fact_digest(),
        digest,
    })
}

fn universe_member_binding_digest(
    request: &UntrustedStrategyInputBindingRequest,
    selection: &StrategyInputUniverseSelectionReceipt,
    member: &StrategyInputUniverseMember,
    row: &VerifiedPitObservation,
) -> BindingDigest {
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_MEMBER_BINDING_V1");
    canonical.digest(request.strategy_design_identity);
    canonical.digest(request.input_role_identity);
    canonical.digest(selection.selection_identity());
    canonical.string(member.member_key());
    canonical.string(member.instrument());
    canonical.string(request.field_semantic.identity());
    canonical.string(request.channel.canonical());
    canonical.string(request.field_semantic.data_kind());
    canonical.string(&request.timeframe);
    canonical.string(request.unit.canonical());
    canonical.u8(request.scale);
    canonical.digest(selection.source_binding_lineage_root());
    canonical.string(row.correction_stream_identity());
    canonical.digest(selection.market_semantics_identity());
    digest(&canonical.finish())
}

fn issue_universe_value_receipt(
    trigger: &StrategyInputEventTriggerReceipt,
    member: &StrategyInputUniverseMember,
    request: &UntrustedStrategyInputBindingRequest,
    row: &VerifiedPitObservation,
    batch: &VerifiedPitObservationBatch,
    binding_digest: BindingDigest,
) -> StrategyInputUniverseValueReceipt {
    let canonical_row_digest = digest(&canonical_row_binding_bytes(row));
    let value_bytes = row.value_mantissa().to_le_bytes();
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_VALUE_V1");
    canonical.digest(trigger.digest());
    canonical.digest(trigger.observation_batch_digest());
    canonical.string(member.member_key());
    canonical.string(member.instrument());
    canonical.digest(request.input_role_identity);
    canonical.digest(binding_digest);
    canonical.string(STRATEGY_INPUT_FIXED_I128_LE_V1);
    canonical.bytes(&value_bytes);
    canonical.u8(row.value_scale());
    canonical.digest(canonical_row_digest);
    canonical.digest(batch.source_binding_lineage_root());
    canonical.u64(batch.source_binding_lineage_version());
    canonical.string(row.correction_stream_identity());
    canonical.u64(row.correction_sequence());
    canonical.digest(row.correction_frontier_digest());
    canonical.digest(row.market_semantics_identity());
    let digest = digest(&canonical.finish());
    StrategyInputUniverseValueReceipt {
        member_key: member.member_key().to_owned(),
        instrument: member.instrument().to_owned(),
        input_role_identity: request.input_role_identity,
        binding_digest,
        value_type_semantic_id: STRATEGY_INPUT_FIXED_I128_LE_V1,
        value_bytes,
        value_scale: row.value_scale(),
        canonical_row_digest,
        source_binding_lineage_root: batch.source_binding_lineage_root(),
        correction_stream_identity: row.correction_stream_identity().to_owned(),
        market_semantics_identity: row.market_semantics_identity(),
        trigger_digest: trigger.digest(),
        observation_batch_digest: trigger.observation_batch_digest(),
        digest,
    }
}

fn issue_event_value_receipt(
    trigger: &StrategyInputEventTriggerReceipt,
    binding: &StrategyInputBindingReceipt,
    batch: &VerifiedPitObservationBatch,
    row: &VerifiedPitObservation,
) -> StrategyInputEventValueReceipt {
    let canonical_row_digest = digest(&canonical_row_binding_bytes(row));
    let value_bytes = row.value_mantissa().to_le_bytes();
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_EVENT_VALUE_V1");
    canonical.digest(trigger.digest());
    canonical.digest(trigger.observation_batch_digest());
    canonical.digest(binding.locator().input_role_identity());
    canonical.digest(binding.digest());
    canonical.string(STRATEGY_INPUT_FIXED_I128_LE_V1);
    canonical.bytes(&value_bytes);
    canonical.u8(row.value_scale());
    canonical.digest(canonical_row_digest);
    canonical.digest(batch.source_binding_lineage_root());
    canonical.u64(batch.source_binding_lineage_version());
    canonical.string(row.correction_stream_identity());
    canonical.u64(row.correction_sequence());
    canonical.digest(row.correction_frontier_digest());
    canonical.digest(row.market_semantics_identity());
    let digest = digest(&canonical.finish());
    StrategyInputEventValueReceipt {
        input_role_identity: binding.locator().input_role_identity(),
        binding_receipt_digest: binding.digest(),
        value_type_semantic_id: STRATEGY_INPUT_FIXED_I128_LE_V1,
        value_bytes,
        value_scale: row.value_scale(),
        canonical_row_digest,
        source_binding_lineage_root: binding.locator().source_binding_lineage_root(),
        source_binding_lineage_version: batch.source_binding_lineage_version(),
        correction_stream_identity: row.correction_stream_identity().to_owned(),
        correction_sequence: row.correction_sequence(),
        correction_frontier_digest: row.correction_frontier_digest(),
        market_semantics_identity: row.market_semantics_identity(),
        trigger_digest: trigger.digest(),
        observation_batch_digest: trigger.observation_batch_digest(),
        digest,
    }
}

fn event_kind(data_kind: &str) -> Result<StrategyInputEventKind, StrategyInputBindingUnavailable> {
    Ok(match data_kind {
        "BAR" => StrategyInputEventKind::Bar,
        "QUOTE" | "TRADE" | "REFERENCE" | "ECONOMIC" | "SCALAR" => StrategyInputEventKind::Event,
        _ => return Err(StrategyInputBindingUnavailable::UnsupportedLifecycleKind),
    })
}

fn canonical_row_binding_bytes(row: &VerifiedPitObservation) -> Vec<u8> {
    let mut encoder = Encoder::new(b"VIBE_STRATEGY_INPUT_ROW_BINDING_V1");
    encoder.string(row.symbolic_key());
    encoder.string(row.member_key());
    encoder.string(row.instrument());
    encoder.string(row.channel());
    encoder.string(row.data_kind());
    encoder.string(row.timeframe());
    encoder.string(row.field());
    encoder.i128(row.value_mantissa());
    encoder.u8(row.value_scale());
    encoder.u64(row.event_effective());
    encoder.u64(row.provider_available());
    encoder.u64(row.retrieval());
    encoder.u64(row.correction_publication());
    encoder.digest(row.source_binding_identity());
    encoder.digest(row.source_frontier_digest());
    encoder.digest(row.instrument_master_digest());
    encoder.digest(row.universe_selection_digest());
    encoder.digest(row.market_semantics_identity());
    encoder.string(row.correction_stream_identity());
    encoder.u64(row.correction_sequence());
    encoder.digest(row.correction_frontier_digest());
    encoder.finish()
}

/// Exact unchanged V1 evidence projected for the additive sample-fact owner.
///
/// This is deliberately visible only to sibling Market Data owner modules. It reuses the V1 row
/// resolver and row codec instead of teaching the additive owner to reinterpret a binding or row.
#[allow(
    dead_code,
    reason = "consumed by the additive sample-fact module after PostgreSQL owner fan-in"
)]
pub(super) struct SampleFactV1Projection<'a> {
    pub(super) binding: &'a StrategyInputBindingReceipt,
    pub(super) batch: &'a VerifiedPitObservationBatch,
    pub(super) row: &'a VerifiedPitObservation,
    pub(super) canonical_row_digest: BindingDigest,
}

#[allow(
    dead_code,
    reason = "consumed by the additive sample-fact module after PostgreSQL owner fan-in"
)]
pub(super) fn project_sample_fact_v1<'a>(
    binding: &'a StrategyInputBindingReceipt,
    batch: &'a VerifiedPitObservationBatch,
) -> Result<SampleFactV1Projection<'a>, StrategyInputBindingUnavailable> {
    let row = resolve_static_binding_row(binding, batch)?;
    Ok(SampleFactV1Projection {
        binding,
        batch,
        row,
        canonical_row_digest: digest(&canonical_row_binding_bytes(row)),
    })
}

fn canonical_locator_bytes(locator: &StrategyInputBindingLocator) -> Vec<u8> {
    let mut encoder = Encoder::new(b"VIBE_STRATEGY_INPUT_BINDING_V2");
    encoder.digest(locator.strategy_design_identity);
    encoder.digest(locator.input_role_identity);
    encoder.digest(locator.selection_identity);
    encoder.finish()
}

fn canonical_selection_bytes(locator: &StrategyInputBindingLocator) -> Vec<u8> {
    let mut encoder = Encoder::new(b"VIBE_STRATEGY_INPUT_SELECTION_V2");
    encoder.string(locator.field_semantic_identity);
    encoder.string(&locator.instrument);
    encoder.string(locator.channel);
    encoder.string(locator.data_kind);
    encoder.string(&locator.timeframe);
    encoder.string(locator.unit);
    encoder.u8(locator.scale);
    encoder.digest(locator.source_binding_lineage_root);
    encoder.string(&locator.correction_stream_identity);
    encoder.digest(locator.market_semantics_identity);
    encoder.finish()
}

fn digest(bytes: &[u8]) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(*blake3::hash(bytes).as_bytes())
}

struct Encoder(Vec<u8>);

impl Encoder {
    fn new(domain: &[u8]) -> Self {
        let mut encoder = Self(Vec::new());
        encoder.bytes(domain);
        encoder
    }

    fn finish(self) -> Vec<u8> {
        self.0
    }

    fn bytes(&mut self, value: &[u8]) {
        self.u64(value.len() as u64);
        self.0.extend_from_slice(value);
    }

    fn string(&mut self, value: &str) {
        self.bytes(value.as_bytes());
    }

    fn u8(&mut self, value: u8) {
        self.0.push(value);
    }

    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn i128(&mut self, value: i128) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn digest(&mut self, value: BindingDigest) {
        self.bytes(value.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::owner::pit_snapshot::{
        UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    };

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn time_evidence() -> UntrustedPitSnapshotTimeEvidence {
        UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime {
                clock_identity: "clock".into(),
                clock_epoch: "epoch".into(),
                value: 10,
            },
            provider_available: UntrustedProviderAvailableTime {
                clock_identity: "clock".into(),
                clock_epoch: "epoch".into(),
                value: 20,
            },
            retrieval: UntrustedRetrievalTime {
                clock_identity: "clock".into(),
                clock_epoch: "epoch".into(),
                value: 40,
            },
            correction_publication: Some(UntrustedCorrectionPublicationTime {
                clock_identity: "clock".into(),
                clock_epoch: "epoch".into(),
                value: 30,
            }),
            decision_cut: UntrustedSnapshotDecisionCut {
                clock_identity: "clock".into(),
                clock_epoch: "epoch".into(),
                value: 40,
            },
            monotonic_sequence: 1,
            restart_continuity_digest: d(19),
            skew_bound: 1,
            uncertainty_bound: 1,
            observed_at: 40,
            valid_through: 50,
        }
    }

    fn row(symbolic_key: &str, member_key: &str, timeframe: &str) -> VerifiedPitObservation {
        VerifiedPitObservation {
            symbolic_key: symbolic_key.into(),
            member_key: member_key.into(),
            instrument: "AAPL.XNAS".into(),
            channel: "MARKET".into(),
            data_kind: "BAR".into(),
            timeframe: timeframe.into(),
            field: "CLOSE".into(),
            value_mantissa: 12_345,
            value_scale: 2,
            event_effective: 10,
            provider_available: 20,
            retrieval: 40,
            correction_publication: 30,
            source_binding_identity: d(6),
            source_frontier_digest: d(7),
            instrument_master_digest: d(9),
            universe_selection_digest: d(10),
            market_semantics_identity: d(11),
            correction_stream_identity: "correction-stream".into(),
            correction_sequence: 3,
            correction_frontier_digest: d(8),
        }
    }

    fn member_row(
        symbolic_key: &str,
        member_key: &str,
        instrument: &str,
        field: &str,
    ) -> VerifiedPitObservation {
        let mut candidate = row(symbolic_key, member_key, "1M");
        candidate.instrument = instrument.into();
        candidate.field = field.into();
        candidate.value_mantissa = if member_key == "AAPL" { 12_345 } else { 43_210 };
        candidate
    }

    fn batch(rows: Vec<VerifiedPitObservation>) -> VerifiedPitObservationBatch {
        VerifiedPitObservationBatch {
            request_identity: d(1),
            request_digest: d(2),
            snapshot_identity: d(3),
            fact_digest: d(4),
            source_binding_identity: d(6),
            source_binding_lineage_root: d(16),
            source_binding_lineage_version: 1,
            source_frontier_digest: d(7),
            correction_frontier_digest: d(8),
            instrument_master_digest: d(9),
            universe_selection_digest: d(10),
            market_semantics_identity: d(11),
            time_evidence: time_evidence(),
            digest: d(5),
            observations: rows.into_boxed_slice(),
        }
    }

    fn issue_frame(
        requests: &[UntrustedStrategyInputBindingRequest],
        verified: &VerifiedPitObservationBatch,
    ) -> Result<StrategyInputEventFrameReceipt, StrategyInputBindingUnavailable> {
        let bindings = requests
            .iter()
            .map(|request| bind_strategy_input_role(request, verified))
            .collect::<Result<Vec<_>, _>>()?;
        bind_strategy_input_event_frame(&bindings, verified)
    }

    fn request() -> UntrustedStrategyInputBindingRequest {
        UntrustedStrategyInputBindingRequest {
            research_request_identity: d(20),
            strategy_design_identity: d(21),
            input_role_identity: d(22),
            scope: UntrustedStrategyInputScope::ExactInstrument {
                instrument: "AAPL.XNAS".into(),
            },
            field_semantic: MarketDataFieldSemantic::BarClosePrice,
            channel: StrategyInputChannel::Market,
            timeframe: "1M".into(),
            unit: StrategyInputUnit::Price,
            scale: 2,
            pit_request_identity: d(1),
            pit_request_digest: d(2),
            snapshot_identity: d(3),
            snapshot_fact_digest: d(4),
            observation_batch_digest: d(5),
            source_binding_identity: d(6),
            source_frontier_digest: d(7),
            correction_frontier_digest: d(8),
            instrument_master_digest: d(9),
            universe_selection_digest: d(10),
            market_semantics_identity: d(11),
            decision_cut: 40,
        }
    }

    fn universe_requests(
        verified: &VerifiedPitObservationBatch,
    ) -> [UntrustedStrategyInputBindingRequest; 2] {
        let selection_identity = derive_universe_selection(verified)
            .expect("two canonical members")
            .selection_identity();
        let mut close = request();
        close.scope = UntrustedStrategyInputScope::UniverseSelection { selection_identity };
        let mut open = close.clone();
        open.input_role_identity = d(23);
        open.field_semantic = MarketDataFieldSemantic::BarOpenPrice;
        [close, open]
    }

    fn complete_universe_rows() -> Vec<VerifiedPitObservation> {
        vec![
            member_row("AAPL.CLOSE", "AAPL", "AAPL.XNAS", "CLOSE"),
            member_row("AAPL.OPEN", "AAPL", "AAPL.XNAS", "OPEN"),
            member_row("MSFT.CLOSE", "MSFT", "MSFT.XNAS", "CLOSE"),
            member_row("MSFT.OPEN", "MSFT", "MSFT.XNAS", "OPEN"),
        ]
    }

    #[rstest]
    fn exact_owner_verified_row_issues_deterministic_sealed_receipt() {
        let verified = batch(vec![row("AAPL.CLOSE", "AAPL.XNAS", "1M")]);
        let first = bind_strategy_input_role(&request(), &verified).expect("exact binding");
        let second = bind_strategy_input_role(&request(), &verified).expect("exact replay");

        assert_eq!(first, second);
        assert_eq!(first.locator().instrument(), "AAPL.XNAS");
        assert_eq!(
            first.locator().field_semantic_identity(),
            "MARKET_DATA.BAR.CLOSE.PRICE.V1"
        );
        assert_ne!(first.locator().selection_identity().as_bytes(), &[0; 32]);
        assert_ne!(first.digest().as_bytes(), &[0; 32]);
    }

    #[rstest]
    fn universe_frame_derives_two_members_and_is_arrival_order_independent() {
        let rows = complete_universe_rows();
        let first_batch = batch(rows.clone());
        let requests = universe_requests(&first_batch);
        let first = bind_strategy_input_universe_frame(&requests, &first_batch).unwrap();

        let mut reversed_rows = rows;
        reversed_rows.reverse();
        let reversed_batch = batch(reversed_rows);
        let reversed = bind_strategy_input_universe_frame(
            &[requests[1].clone(), requests[0].clone()],
            &reversed_batch,
        )
        .unwrap();

        assert_eq!(first, reversed);
        assert_eq!(
            first.selection().selection_identity(),
            reversed.selection().selection_identity()
        );
        assert_eq!(
            first.selection().selection_digest(),
            reversed.selection().selection_digest()
        );
        assert_eq!(first.selection().members().len(), 2);
        assert_eq!(first.selection().members()[0].member_key(), "AAPL");
        assert_eq!(first.selection().members()[0].instrument(), "AAPL.XNAS");
        assert_eq!(first.selection().members()[1].member_key(), "MSFT");
        assert_eq!(first.values().len(), 4);
        assert_eq!(
            first
                .values()
                .iter()
                .map(|value| (value.member_key(), value.input_role_identity()))
                .collect::<Vec<_>>(),
            vec![
                ("AAPL", d(22)),
                ("AAPL", d(23)),
                ("MSFT", d(22)),
                ("MSFT", d(23))
            ]
        );
        assert!(
            first
                .values()
                .iter()
                .all(|value| value.trigger_digest() == first.trigger().digest())
        );
        assert_ne!(first.digest().as_bytes(), &[0; 32]);
    }

    #[rstest]
    fn universe_frame_rejects_missing_duplicate_third_and_inconsistent_members() {
        for rows in [
            Vec::new(),
            vec![member_row("AAPL.CLOSE", "AAPL", "AAPL.XNAS", "CLOSE")],
            vec![
                member_row("AAPL.CLOSE", "AAPL", "AAPL.XNAS", "CLOSE"),
                member_row("MSFT.CLOSE", "MSFT", "MSFT.XNAS", "CLOSE"),
                member_row("NVDA.CLOSE", "NVDA", "NVDA.XNAS", "CLOSE"),
            ],
        ] {
            assert_eq!(
                bind_strategy_input_universe_frame(&[request()], &batch(rows)),
                Err(StrategyInputBindingUnavailable::InvalidUniverseCardinality)
            );
        }

        let mut inconsistent = complete_universe_rows();
        inconsistent[1].instrument = "AAPL.XNYS".into();
        assert_eq!(
            bind_strategy_input_universe_frame(&[request()], &batch(inconsistent)),
            Err(StrategyInputBindingUnavailable::InconsistentUniverseMember)
        );

        let mut aliased_instrument = complete_universe_rows();
        for row in &mut aliased_instrument {
            if row.member_key == "MSFT" {
                row.instrument = "AAPL.XNAS".into();
            }
        }
        assert_eq!(
            bind_strategy_input_universe_frame(&[request()], &batch(aliased_instrument)),
            Err(StrategyInputBindingUnavailable::InconsistentUniverseMember)
        );

        let mut ambiguous = complete_universe_rows();
        ambiguous.push(ambiguous[0].clone());
        let verified = batch(ambiguous);
        let requests = universe_requests(&verified);
        assert_eq!(
            bind_strategy_input_universe_frame(&requests, &verified),
            Err(StrategyInputBindingUnavailable::NonUniqueResolution)
        );
    }

    #[rstest]
    fn universe_frame_rejects_missing_member_role_and_caller_instrument_set() {
        let mut rows = complete_universe_rows();
        rows.retain(|row| !(row.member_key() == "MSFT" && row.field() == "OPEN"));
        let verified = batch(rows);
        let requests = universe_requests(&verified);
        assert_eq!(
            bind_strategy_input_universe_frame(&requests, &verified),
            Err(StrategyInputBindingUnavailable::NoMatchingObservation)
        );

        let complete = batch(complete_universe_rows());
        let mut caller_set = request();
        caller_set.scope = UntrustedStrategyInputScope::InstrumentSet {
            instruments: vec!["AAPL.XNAS".into(), "MSFT.XNAS".into()],
        };
        assert_eq!(
            bind_strategy_input_universe_frame(&[caller_set], &complete),
            Err(StrategyInputBindingUnavailable::UnsupportedScope)
        );
    }

    #[rstest]
    fn universe_frame_rejects_selection_and_every_row_authority_splice() {
        let complete = batch(complete_universe_rows());
        let mut requests = universe_requests(&complete);
        requests[0].scope = UntrustedStrategyInputScope::UniverseSelection {
            selection_identity: d(99),
        };
        assert_eq!(
            bind_strategy_input_universe_frame(&requests, &complete),
            Err(StrategyInputBindingUnavailable::StaleBatch)
        );

        let mutations: &[fn(&mut VerifiedPitObservation)] = &[
            |row| row.source_binding_identity = d(90),
            |row| row.source_frontier_digest = d(91),
            |row| row.correction_frontier_digest = d(92),
            |row| row.instrument_master_digest = d(93),
            |row| row.universe_selection_digest = d(94),
            |row| row.market_semantics_identity = d(95),
        ];

        for mutate in mutations {
            let mut rows = complete_universe_rows();
            mutate(&mut rows[0]);
            let spliced = batch(rows);
            let requests = universe_requests(&spliced);
            assert_eq!(
                bind_strategy_input_universe_frame(&requests, &spliced),
                Err(StrategyInputBindingUnavailable::StaleBatch)
            );
        }
    }

    #[rstest]
    fn universe_selection_authority_binds_members_not_caller_universe_digest() {
        let first_batch = batch(complete_universe_rows());
        let first = derive_universe_selection(&first_batch).unwrap();

        let second_batch = batch(vec![
            member_row("AAPL.CLOSE", "AAPL", "AAPL.XNAS", "CLOSE"),
            member_row("AAPL.OPEN", "AAPL", "AAPL.XNAS", "OPEN"),
            member_row("NVDA.CLOSE", "NVDA", "NVDA.XNAS", "CLOSE"),
            member_row("NVDA.OPEN", "NVDA", "NVDA.XNAS", "OPEN"),
        ]);
        assert_eq!(
            first_batch.universe_selection_digest(),
            second_batch.universe_selection_digest(),
            "caller-originated PIT request provenance is deliberately unchanged"
        );
        let second = derive_universe_selection(&second_batch).unwrap();
        assert_ne!(first.selection_identity(), second.selection_identity());
        assert_ne!(first.selection_digest(), second.selection_digest());

        let mut renewable_batch = first_batch.clone();
        renewable_batch.snapshot_identity = d(80);
        renewable_batch.fact_digest = d(81);
        renewable_batch.digest = d(82);
        renewable_batch.source_binding_identity = d(83);
        renewable_batch.source_binding_lineage_version += 1;
        renewable_batch.source_frontier_digest = d(84);
        renewable_batch.correction_frontier_digest = d(85);
        renewable_batch.time_evidence.decision_cut.value += 1;
        renewable_batch.observations[0].value_mantissa += 1;
        let renewable = derive_universe_selection(&renewable_batch).unwrap();
        assert_eq!(first.selection_identity(), renewable.selection_identity());
        assert_eq!(first.selection_digest(), renewable.selection_digest());
        assert_ne!(
            first.digest(),
            renewable.digest(),
            "renewable facts remain bound only by the dynamic receipt"
        );

        let first_frame =
            bind_strategy_input_universe_frame(&universe_requests(&first_batch), &first_batch)
                .unwrap();
        let second_frame =
            bind_strategy_input_universe_frame(&universe_requests(&second_batch), &second_batch)
                .unwrap();
        assert_ne!(
            first_frame.selection().selection_identity(),
            second_frame.selection().selection_identity()
        );
    }

    #[rstest]
    fn runtime_event_frame_seals_two_fields_value_time_sequence_and_bindings() {
        let original_row = row("AAPL.CLOSE", "AAPL.XNAS", "1M");
        let mut open_row = original_row.clone();
        open_row.symbolic_key = "AAPL.OPEN".into();
        open_row.field = "OPEN".into();
        open_row.value_mantissa = 12_300;
        let mut open_request = request();
        open_request.input_role_identity = d(23);
        open_request.field_semantic = MarketDataFieldSemantic::BarOpenPrice;
        let requests = [request(), open_request];
        let verified = batch(vec![original_row.clone(), open_row.clone()]);
        let preserved = bind_strategy_input_role(&request(), &verified).unwrap();
        let frame = issue_frame(&requests, &verified).unwrap();
        assert_eq!(frame.values().len(), 2);
        let binding = preserved;
        let event = frame
            .values()
            .iter()
            .find(|event| event.input_role_identity() == d(22))
            .unwrap();
        assert_eq!(event.binding_receipt_digest(), binding.digest());
        assert_eq!(
            event.input_role_identity(),
            binding.locator().input_role_identity()
        );
        assert_eq!(
            event.value_type_semantic_id(),
            STRATEGY_INPUT_FIXED_I128_LE_V1
        );
        assert_eq!(*event.value_bytes(), 12_345_i128.to_le_bytes());
        assert_eq!(event.value_scale(), 2);
        assert_eq!(event.trigger_digest(), frame.trigger().digest());
        assert_eq!(
            frame.trigger().lifecycle().kind(),
            StrategyInputEventKind::Bar
        );
        assert_eq!(frame.trigger().lifecycle().logical_time(), 30);
        assert_eq!(frame.trigger().lifecycle().event_time(), 10);
        assert_eq!(frame.trigger().lifecycle().owner_sequence(), 3);
        assert_ne!(frame.trigger().lifecycle().event_identity(), [0; 16]);
        let reversed = issue_frame(&[requests[1].clone(), requests[0].clone()], &verified).unwrap();
        assert_eq!(reversed, frame, "caller request order is not frame order");

        let mut changed_binding_request = requests[0].clone();
        changed_binding_request.input_role_identity = d(24);
        let binding_frame =
            issue_frame(&[changed_binding_request, requests[1].clone()], &verified).unwrap();
        assert_ne!(binding_frame.trigger().digest(), frame.trigger().digest());

        let mut mismatched_coordinate = open_row.clone();
        mismatched_coordinate.correction_sequence += 1;
        assert_eq!(
            issue_frame(
                &requests,
                &batch(vec![original_row.clone(), mismatched_coordinate])
            ),
            Err(StrategyInputBindingUnavailable::MissingLifecycleCoordinate)
        );

        let mut swapped_equal_max = open_row.clone();
        swapped_equal_max.provider_available = 30;
        swapped_equal_max.correction_publication = 20;
        assert_eq!(
            issue_frame(
                &requests,
                &batch(vec![original_row.clone(), swapped_equal_max])
            ),
            Err(StrategyInputBindingUnavailable::MissingLifecycleCoordinate)
        );

        let mut changed_value = original_row.clone();
        changed_value.value_mantissa += 1;
        let value_frame =
            issue_frame(&requests, &batch(vec![changed_value, open_row.clone()])).unwrap();
        assert_ne!(value_frame.trigger().digest(), frame.trigger().digest());

        let mut changed_time = original_row.clone();
        changed_time.correction_publication = 31;
        open_row.correction_publication = 31;
        let time_frame =
            issue_frame(&requests, &batch(vec![changed_time, open_row.clone()])).unwrap();
        assert_ne!(time_frame.trigger().digest(), frame.trigger().digest());
        assert_eq!(time_frame.trigger().lifecycle().logical_time(), 31);

        let mut changed_sequence = original_row;
        changed_sequence.correction_sequence += 1;
        open_row.correction_publication = changed_sequence.correction_publication;
        open_row.correction_sequence += 1;
        let sequence_frame =
            issue_frame(&requests, &batch(vec![changed_sequence, open_row])).unwrap();
        assert_ne!(sequence_frame.trigger().digest(), frame.trigger().digest());
        assert_eq!(sequence_frame.trigger().lifecycle().owner_sequence(), 4);
    }

    #[rstest]
    fn runtime_frame_rejects_non_adjacent_duplicate_selection_identities() {
        let close_row = row("AAPL.CLOSE", "AAPL.XNAS", "1M");
        let mut open_row = close_row.clone();
        open_row.symbolic_key = "AAPL.OPEN".into();
        open_row.field = "OPEN".into();
        let verified = batch(vec![close_row, open_row]);

        let mut first = request();
        first.input_role_identity = d(1);
        let mut middle = request();
        middle.input_role_identity = d(2);
        middle.field_semantic = MarketDataFieldSemantic::BarOpenPrice;
        let mut last = request();
        last.input_role_identity = d(3);

        assert_eq!(
            issue_frame(&[first, middle, last], &verified),
            Err(StrategyInputBindingUnavailable::NonUniqueResolution)
        );
    }

    #[rstest]
    fn every_closed_field_semantic_uses_the_same_initial_and_runtime_mapping() {
        for (index, semantic) in MarketDataFieldSemantic::ALL.into_iter().enumerate() {
            let mut candidate_row = row("AAPL.FIELD", "AAPL.XNAS", "1M");
            candidate_row.field = semantic.row_field().into();
            candidate_row.data_kind = semantic.data_kind().into();
            let verified = batch(vec![candidate_row]);
            let mut candidate_request = request();
            candidate_request.input_role_identity = d(u8::try_from(index)
                .expect("closed semantic count fits u8")
                .saturating_add(30));
            candidate_request.field_semantic = semantic;
            candidate_request.unit = semantic.unit();

            let binding = bind_strategy_input_role(&candidate_request, &verified)
                .expect("every declared semantic resolves initially");
            let frame = bind_strategy_input_event_frame(&[binding], &verified)
                .expect("every declared semantic re-resolves at runtime");
            assert_eq!(frame.values().len(), 1);
        }
    }

    #[rstest]
    fn request_deserialization_denies_unknown_fields_and_has_no_row_keys() {
        let value = serde_json::to_value(request()).expect("serialize request");
        let object = value.as_object().expect("request object");
        assert!(!object.contains_key("symbolic_key"));
        assert!(!object.contains_key("member_key"));

        let mut unknown = value;
        unknown
            .as_object_mut()
            .expect("request object")
            .insert("symbolic_key".into(), serde_json::json!("AAPL.CLOSE"));
        assert!(serde_json::from_value::<UntrustedStrategyInputBindingRequest>(unknown).is_err());
    }

    #[rstest]
    fn missing_duplicate_ambiguous_and_unsupported_scopes_fail_closed() {
        let one = row("AAPL.CLOSE", "AAPL.XNAS", "1M");
        assert_eq!(
            bind_strategy_input_role(&request(), &batch(Vec::new())),
            Err(StrategyInputBindingUnavailable::NoMatchingObservation)
        );
        assert_eq!(
            bind_strategy_input_role(
                &request(),
                &batch(vec![
                    one.clone(),
                    row("AAPL.CLOSE.ADJ", "AAPL.XNAS.ADJ", "1M"),
                ]),
            ),
            Err(StrategyInputBindingUnavailable::NonUniqueResolution)
        );
        let mut unmatched = request();
        unmatched.timeframe = "1D".into();
        assert_eq!(
            bind_strategy_input_role(
                &unmatched,
                &batch(vec![one, row("AAPL.CLOSE.5M", "AAPL.XNAS.5M", "5M")]),
            ),
            Err(StrategyInputBindingUnavailable::AmbiguousResolution)
        );
        let mut universe = request();
        universe.scope = UntrustedStrategyInputScope::UniverseSelection {
            selection_identity: d(10),
        };
        assert_eq!(
            bind_strategy_input_role(&universe, &batch(Vec::new())),
            Err(StrategyInputBindingUnavailable::UnsupportedScope)
        );
        let mut multi = request();
        multi.scope = UntrustedStrategyInputScope::InstrumentSet {
            instruments: vec!["AAPL.XNAS".into(), "MSFT.XNAS".into()],
        };
        assert_eq!(
            bind_strategy_input_role(&multi, &batch(Vec::new())),
            Err(StrategyInputBindingUnavailable::UnsupportedScope)
        );
    }

    #[rstest]
    fn changed_instrument_timeframe_or_field_never_selects_by_similarity_or_order() {
        let verified = batch(vec![row("AAPL.CLOSE", "AAPL.XNAS", "1M")]);
        let mut changed_instrument = request();
        changed_instrument.scope = UntrustedStrategyInputScope::ExactInstrument {
            instrument: "AAPL.XNYS".into(),
        };
        assert_eq!(
            bind_strategy_input_role(&changed_instrument, &verified),
            Err(StrategyInputBindingUnavailable::NoMatchingObservation)
        );
        let mut changed_timeframe = request();
        changed_timeframe.timeframe = "5M".into();
        assert_eq!(
            bind_strategy_input_role(&changed_timeframe, &verified),
            Err(StrategyInputBindingUnavailable::NoMatchingObservation)
        );
        let mut changed_field = request();
        changed_field.field_semantic = MarketDataFieldSemantic::BarOpenPrice;
        assert_eq!(
            bind_strategy_input_role(&changed_field, &verified),
            Err(StrategyInputBindingUnavailable::NoMatchingObservation)
        );
    }

    #[rstest]
    fn units_scale_and_every_batch_identity_mutation_fail_closed() {
        let verified = batch(vec![row("AAPL.CLOSE", "AAPL.XNAS", "1M")]);
        let mut wrong_unit = request();
        wrong_unit.unit = StrategyInputUnit::Quantity;
        assert_eq!(
            bind_strategy_input_role(&wrong_unit, &verified),
            Err(StrategyInputBindingUnavailable::UnitMismatch)
        );
        let mut wrong_scale = request();
        wrong_scale.scale = 3;
        assert_eq!(
            bind_strategy_input_role(&wrong_scale, &verified),
            Err(StrategyInputBindingUnavailable::ScaleMismatch)
        );

        let mutations: &[fn(&mut UntrustedStrategyInputBindingRequest)] = &[
            |v| v.pit_request_identity = d(31),
            |v| v.pit_request_digest = d(32),
            |v| v.snapshot_identity = d(33),
            |v| v.snapshot_fact_digest = d(34),
            |v| v.observation_batch_digest = d(35),
            |v| v.source_binding_identity = d(36),
            |v| v.source_frontier_digest = d(37),
            |v| v.correction_frontier_digest = d(38),
            |v| v.instrument_master_digest = d(39),
            |v| v.universe_selection_digest = d(40),
            |v| v.market_semantics_identity = d(41),
            |v| v.decision_cut = 41,
        ];

        for mutate in mutations {
            let mut changed = request();
            mutate(&mut changed);
            assert_eq!(
                bind_strategy_input_role(&changed, &verified),
                Err(StrategyInputBindingUnavailable::StaleBatch)
            );
        }
    }

    #[rstest]
    fn static_binding_ignores_renewable_row_facts_but_binds_stream() {
        let base_batch = batch(vec![row("AAPL.CLOSE", "AAPL.XNAS", "1M")]);
        let base = bind_strategy_input_role(&request(), &base_batch)
            .expect("base binding")
            .digest();
        let request_mutations: &[fn(&mut UntrustedStrategyInputBindingRequest)] = &[
            |v| v.strategy_design_identity = d(52),
            |v| v.input_role_identity = d(53),
        ];

        for mutate in request_mutations {
            let mut changed = request();
            mutate(&mut changed);
            assert_ne!(
                bind_strategy_input_role(&changed, &base_batch)
                    .expect("changed caller identity remains bindable")
                    .digest(),
                base
            );
        }
        let mut changed_research = request();
        changed_research.research_request_identity = d(51);
        assert_eq!(
            bind_strategy_input_role(&changed_research, &base_batch)
                .unwrap()
                .digest(),
            base
        );

        let renewable_mutations: &[fn(&mut VerifiedPitObservation)] = &[
            |v| v.value_mantissa += 1,
            |v| v.event_effective += 1,
            |v| v.provider_available += 1,
            |v| v.retrieval += 1,
            |v| v.correction_publication += 1,
            |v| v.correction_sequence += 1,
        ];

        for mutate in renewable_mutations {
            let mut changed_row = row("AAPL.CLOSE", "AAPL.XNAS", "1M");
            mutate(&mut changed_row);
            assert_eq!(
                bind_strategy_input_role(&request(), &batch(vec![changed_row]))
                    .expect("verified-batch fixture")
                    .digest(),
                base
            );
        }
        let mut changed_stream = row("AAPL.CLOSE", "AAPL.XNAS", "1M");
        changed_stream.correction_stream_identity.push('x');
        assert_ne!(
            bind_strategy_input_role(&request(), &batch(vec![changed_stream]))
                .expect("verified-batch fixture")
                .digest(),
            base
        );
    }

    #[rstest]
    fn compatible_successor_batch_reuses_static_binding_and_seals_new_event() {
        let first_batch = batch(vec![row("AAPL.CLOSE", "AAPL.XNAS", "1M")]);
        let first_request = request();
        let binding = bind_strategy_input_role(&first_request, &first_batch).unwrap();
        let first_frame =
            bind_strategy_input_event_frame(std::slice::from_ref(&binding), &first_batch).unwrap();

        let mut next_row = row("AAPL.CLOSE", "AAPL.XNAS", "1M");
        next_row.value_mantissa += 100;
        next_row.event_effective += 10;
        next_row.provider_available += 10;
        next_row.retrieval += 10;
        next_row.correction_publication += 10;
        next_row.correction_sequence += 1;
        next_row.source_frontier_digest = d(70);
        next_row.correction_frontier_digest = d(71);
        let mut next_batch = batch(vec![next_row]);
        next_batch.request_identity = d(72);
        next_batch.request_digest = d(73);
        next_batch.snapshot_identity = d(74);
        next_batch.fact_digest = d(75);
        next_batch.source_binding_identity = d(76);
        next_batch.source_binding_lineage_version = 2;
        next_batch.source_frontier_digest = d(70);
        next_batch.correction_frontier_digest = d(71);
        next_batch.instrument_master_digest = d(77);
        next_batch.universe_selection_digest = d(78);
        next_batch.digest = d(79);
        let mut next_request = first_request;
        next_request.pit_request_identity = next_batch.request_identity();
        next_request.pit_request_digest = next_batch.request_digest();
        next_request.snapshot_identity = next_batch.snapshot_identity();
        next_request.snapshot_fact_digest = next_batch.fact_digest();
        next_request.observation_batch_digest = next_batch.digest();
        next_request.source_binding_identity = next_batch.source_binding_identity();
        next_request.source_frontier_digest = next_batch.source_frontier_digest();
        next_request.correction_frontier_digest = next_batch.correction_frontier_digest();
        next_request.instrument_master_digest = next_batch.instrument_master_digest();
        next_request.universe_selection_digest = next_batch.universe_selection_digest();
        let next_frame =
            bind_strategy_input_event_frame(std::slice::from_ref(&binding), &next_batch).unwrap();

        assert_eq!(
            binding,
            bind_strategy_input_role(&next_request, &next_batch).unwrap()
        );
        assert_ne!(
            first_frame.trigger().digest(),
            next_frame.trigger().digest()
        );
        assert_ne!(
            first_frame.values()[0].digest(),
            next_frame.values()[0].digest()
        );
        assert_eq!(
            next_frame.values()[0].binding_receipt_digest(),
            binding.digest()
        );
        assert_eq!(next_frame.values()[0].source_binding_lineage_version(), 2);
    }
}
