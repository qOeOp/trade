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
    decimal_rescale_v1::{RescaleErrorV1, rescale_exact_v1},
    pit_snapshot::{VerifiedPitObservation, VerifiedPitObservationBatch},
    pit_window_custody_v1::PitObservationBatchSourceV1,
    source_binding::BindingDigest,
    strategy_design_role_set::StrategyDesignRoleEntryV1,
};

/// The canonical scope an authenticated exact-instrument role carries.
pub(crate) const EXACT_INSTRUMENT_ROLE_SCOPE_V1: &str = r#"{"kind":"EXACT_INSTRUMENT"}"#;

/// The canonical scope an authenticated universe-member role carries.
pub(crate) const UNIVERSE_MEMBERS_ROLE_SCOPE_V1: &str = r#"{"kind":"UNIVERSE_MEMBERS"}"#;

/// Verifies that a legacy V1 request repeats one authenticated Design role without changing any
/// Research-owned semantic coordinate. PIT/lineage coordinates remain Market Data-owned checks.
pub(crate) fn request_matches_authenticated_role_v1(
    request: &UntrustedStrategyInputBindingRequest,
    role: &StrategyDesignRoleEntryV1,
) -> bool {
    // A role set states a universe role's coordinates but never which universe: a Design declares
    // `UniverseMembers`, and the selection is the PIT request's. So a universe-member request
    // matches on the canonical scope and an empty instrument, and the selection itself is bound
    // where it is known - by the declaration key, which is per PIT request, by the Owner-derived
    // universe frame the declaration binds, and by the registry refusing a declaration set whose
    // universe roles name more than one selection. An instrument set has no attested form and is
    // still refused.
    let (scope, instrument) = match &request.scope {
        UntrustedStrategyInputScope::ExactInstrument { instrument } => {
            (EXACT_INSTRUMENT_ROLE_SCOPE_V1, instrument.as_str())
        }
        UntrustedStrategyInputScope::UniverseSelection { .. } => {
            (UNIVERSE_MEMBERS_ROLE_SCOPE_V1, "")
        }
        UntrustedStrategyInputScope::InstrumentSet { .. } => return false,
    };
    role.role_identity == request.input_role_identity
        && role.fact_class == "MARKET_DATA"
        && role.instrument == instrument
        && role.scope == scope
        && role.field_semantic_id == request.field_semantic.identity()
        && role.channel == request.channel.canonical()
        && role.timeframe == request.timeframe
        && role.unit == request.unit.canonical()
        && role.scale == request.scale
        && role.value_type == "I128"
}

pub(super) mod codec;

#[cfg(test)]
#[path = "strategy_input_binding/tests.rs"]
mod registry_tests;

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
    /// Recovers a channel from the canonical form a Design's authenticated role carries.
    pub(crate) fn from_canonical(canonical: &str) -> Option<Self> {
        match canonical {
            "MARKET" => Some(Self::Market),
            "REFERENCE" => Some(Self::Reference),
            "ECONOMIC" => Some(Self::Economic),
            _ => None,
        }
    }

    pub(crate) const fn canonical(self) -> &'static str {
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

    /// Returns the canonical Market Data field semantic identity.
    pub const fn identity(self) -> &'static str {
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

    /// Returns the canonical normalized observation field bound by this semantic.
    pub const fn row_field(self) -> &'static str {
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

    /// Resolves an exact canonical semantic identity without accepting aliases.
    pub fn from_identity(identity: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|semantic| semantic.identity() == identity)
    }

    /// The Owner data kind this semantic is carried on.
    ///
    /// Public because it decides which runtime lifecycle may consume an input: `strategy_plan_v2`
    /// maps `BAR` to a `Bar` reaction and the rest to `Event`, and refuses a Design whose
    /// consuming reaction disagrees. An authoring surface outside this crate therefore has to know
    /// it before it can emit a Design that composes, and the alternatives are worse - matching on
    /// the variants would be a second copy of this mapping that goes stale the next time one is
    /// added, and splitting the identity string would be a second copy of the identity format.
    pub const fn data_kind(self) -> &'static str {
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

    pub(crate) const fn unit(self) -> StrategyInputUnit {
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
    /// Recovers a unit from the canonical form a Design's authenticated role carries.
    pub(crate) fn from_canonical(canonical: &str) -> Option<Self> {
        match canonical {
            "PRICE" => Some(Self::Price),
            "QUANTITY" => Some(Self::Quantity),
            "SCALAR" => Some(Self::Scalar),
            _ => None,
        }
    }

    pub(crate) const fn canonical(self) -> &'static str {
        match self {
            Self::Price => "PRICE",
            Self::Quantity => "QUANTITY",
            Self::Scalar => "SCALAR",
        }
    }
}

/// The batch a strategy-input binding request reads, as the request names it.
///
/// A committed snapshot is named by its identity and fact digest, exactly as before a batch had a
/// source; one frame's view of a custody chain is named by its chain root, view identity, `e_k`,
/// `d_k` and derived frontier. No field of one arm ever carries a value of the other.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum StrategyInputBatchSourceV1 {
    Snapshot {
        snapshot_identity: BindingDigest,
        snapshot_fact_digest: BindingDigest,
    },
    CustodyView {
        chain_root: BindingDigest,
        view_identity: BindingDigest,
        event_ns: u64,
        decision_cut_ns: u64,
        derived_frontier_digest: BindingDigest,
    },
}

#[cfg(test)]
impl UntrustedStrategyInputBindingRequest {
    /// The snapshot identity of a test request that names a snapshot, to edit in place.
    pub(crate) fn snapshot_identity_mut_for_test(&mut self) -> &mut BindingDigest {
        match &mut self.source {
            StrategyInputBatchSourceV1::Snapshot {
                snapshot_identity, ..
            } => snapshot_identity,
            StrategyInputBatchSourceV1::CustodyView { .. } => {
                panic!("the test request names a snapshot")
            }
        }
    }

    /// The snapshot fact digest of a test request that names a snapshot, to edit in place.
    pub(crate) fn snapshot_fact_digest_mut_for_test(&mut self) -> &mut BindingDigest {
        match &mut self.source {
            StrategyInputBatchSourceV1::Snapshot {
                snapshot_fact_digest,
                ..
            } => snapshot_fact_digest,
            StrategyInputBatchSourceV1::CustodyView { .. } => {
                panic!("the test request names a snapshot")
            }
        }
    }
}

/// The source a binding request names a batch of `source` by; `None` for a quote cut, which no
/// strategy input reads.
pub(crate) const fn binding_request_source_of_v1(
    source: PitObservationBatchSourceV1,
) -> Option<StrategyInputBatchSourceV1> {
    match source {
        PitObservationBatchSourceV1::CommittedSnapshot {
            snapshot_identity,
            fact_digest,
        } => Some(StrategyInputBatchSourceV1::Snapshot {
            snapshot_identity,
            snapshot_fact_digest: fact_digest,
        }),
        PitObservationBatchSourceV1::CustodyView {
            chain_root,
            view_identity,
            event_ns,
            decision_cut_ns,
            derived_frontier_digest,
        } => Some(StrategyInputBatchSourceV1::CustodyView {
            chain_root,
            view_identity,
            event_ns,
            decision_cut_ns,
            derived_frontier_digest,
        }),
        PitObservationBatchSourceV1::CustodyQuoteCut { .. } => None,
    }
}

/// The custody view arm of a binding request's wire.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct CustodyViewSourceWireV1 {
    chain_root: BindingDigest,
    view_identity: BindingDigest,
    event_ns: u64,
    decision_cut_ns: u64,
    derived_frontier_digest: BindingDigest,
}

/// The JSON wire of a binding request. A snapshot source keeps the two fields it always had, so a
/// snapshot request's wire, and every digest taken over it, is unchanged; a custody view source is
/// one field of its own beside them, and a request stating both, or neither, is refused.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct UntrustedStrategyInputBindingRequestWireV1 {
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
    scope: UntrustedStrategyInputScope,
    field_semantic: MarketDataFieldSemantic,
    channel: StrategyInputChannel,
    timeframe: String,
    unit: StrategyInputUnit,
    scale: u8,
    pit_request_identity: BindingDigest,
    pit_request_digest: BindingDigest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    snapshot_identity: Option<BindingDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    snapshot_fact_digest: Option<BindingDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    custody_view: Option<CustodyViewSourceWireV1>,
    observation_batch_digest: BindingDigest,
    source_binding_identity: BindingDigest,
    source_frontier_digest: BindingDigest,
    correction_frontier_digest: BindingDigest,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    decision_cut: u64,
}

impl TryFrom<UntrustedStrategyInputBindingRequestWireV1> for UntrustedStrategyInputBindingRequest {
    type Error = String;

    fn try_from(wire: UntrustedStrategyInputBindingRequestWireV1) -> Result<Self, Self::Error> {
        let source = match (
            wire.snapshot_identity,
            wire.snapshot_fact_digest,
            wire.custody_view,
        ) {
            (Some(snapshot_identity), Some(snapshot_fact_digest), None) => {
                StrategyInputBatchSourceV1::Snapshot {
                    snapshot_identity,
                    snapshot_fact_digest,
                }
            }
            (None, None, Some(view)) => StrategyInputBatchSourceV1::CustodyView {
                chain_root: view.chain_root,
                view_identity: view.view_identity,
                event_ns: view.event_ns,
                decision_cut_ns: view.decision_cut_ns,
                derived_frontier_digest: view.derived_frontier_digest,
            },
            _ => {
                return Err(
                    "a binding request names exactly one source: a snapshot or a custody view"
                        .to_owned(),
                );
            }
        };
        Ok(Self {
            research_request_identity: wire.research_request_identity,
            strategy_design_identity: wire.strategy_design_identity,
            input_role_identity: wire.input_role_identity,
            scope: wire.scope,
            field_semantic: wire.field_semantic,
            channel: wire.channel,
            timeframe: wire.timeframe,
            unit: wire.unit,
            scale: wire.scale,
            pit_request_identity: wire.pit_request_identity,
            pit_request_digest: wire.pit_request_digest,
            source,
            observation_batch_digest: wire.observation_batch_digest,
            source_binding_identity: wire.source_binding_identity,
            source_frontier_digest: wire.source_frontier_digest,
            correction_frontier_digest: wire.correction_frontier_digest,
            instrument_master_digest: wire.instrument_master_digest,
            universe_selection_digest: wire.universe_selection_digest,
            market_semantics_identity: wire.market_semantics_identity,
            decision_cut: wire.decision_cut,
        })
    }
}

impl From<UntrustedStrategyInputBindingRequest> for UntrustedStrategyInputBindingRequestWireV1 {
    fn from(request: UntrustedStrategyInputBindingRequest) -> Self {
        let (snapshot_identity, snapshot_fact_digest, custody_view) = match request.source {
            StrategyInputBatchSourceV1::Snapshot {
                snapshot_identity,
                snapshot_fact_digest,
            } => (Some(snapshot_identity), Some(snapshot_fact_digest), None),
            StrategyInputBatchSourceV1::CustodyView {
                chain_root,
                view_identity,
                event_ns,
                decision_cut_ns,
                derived_frontier_digest,
            } => (
                None,
                None,
                Some(CustodyViewSourceWireV1 {
                    chain_root,
                    view_identity,
                    event_ns,
                    decision_cut_ns,
                    derived_frontier_digest,
                }),
            ),
        };
        Self {
            research_request_identity: request.research_request_identity,
            strategy_design_identity: request.strategy_design_identity,
            input_role_identity: request.input_role_identity,
            scope: request.scope,
            field_semantic: request.field_semantic,
            channel: request.channel,
            timeframe: request.timeframe,
            unit: request.unit,
            scale: request.scale,
            pit_request_identity: request.pit_request_identity,
            pit_request_digest: request.pit_request_digest,
            snapshot_identity,
            snapshot_fact_digest,
            custody_view,
            observation_batch_digest: request.observation_batch_digest,
            source_binding_identity: request.source_binding_identity,
            source_frontier_digest: request.source_frontier_digest,
            correction_frontier_digest: request.correction_frontier_digest,
            instrument_master_digest: request.instrument_master_digest,
            universe_selection_digest: request.universe_selection_digest,
            market_semantics_identity: request.market_semantics_identity,
            decision_cut: request.decision_cut,
        }
    }
}

/// Untrusted request to bind one Research-declared market/reference role.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    try_from = "UntrustedStrategyInputBindingRequestWireV1",
    into = "UntrustedStrategyInputBindingRequestWireV1"
)]
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
    /// Exact batch source expected by the caller: a committed snapshot or a custody view.
    pub source: StrategyInputBatchSourceV1,
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
    /// Every matching observation has a nonzero digit finer than the role's scale, so stating it
    /// at that scale would round it.
    ValueFinerThanRoleScale,
    /// A matching observation stated exactly at the role's scale does not fit in an `i128`.
    ValueOverflowsRoleScale,
    /// The canonical row cannot map to one shared-kernel lifecycle class.
    UnsupportedLifecycleKind,
    /// The canonical row lacks a non-zero Owner ordering coordinate.
    MissingLifecycleCoordinate,
    /// The verified batch does not contain an admitted count of canonical universe members: one
    /// or two.
    InvalidUniverseCardinality,
    /// Member keys and canonical instruments do not form a one-to-one mapping.
    InconsistentUniverseMember,
}

impl StrategyInputBindingUnavailable {
    /// The stable name of this refusal, as a caller sees it on the wire.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::MissingField(_) => "MISSING_FIELD",
            Self::StaleBatch => "STALE_BATCH",
            Self::AmbiguousResolution => "AMBIGUOUS_RESOLUTION",
            Self::NonUniqueResolution => "NON_UNIQUE_RESOLUTION",
            Self::NoMatchingObservation => "NO_MATCHING_OBSERVATION",
            Self::UnsupportedScope => "UNSUPPORTED_SCOPE",
            Self::UnitMismatch => "UNIT_MISMATCH",
            Self::ValueFinerThanRoleScale => "VALUE_FINER_THAN_ROLE_SCALE",
            Self::ValueOverflowsRoleScale => "VALUE_OVERFLOWS_ROLE_SCALE",
            Self::UnsupportedLifecycleKind => "UNSUPPORTED_LIFECYCLE_KIND",
            Self::MissingLifecycleCoordinate => "MISSING_LIFECYCLE_COORDINATE",
            Self::InvalidUniverseCardinality => "INVALID_UNIVERSE_CARDINALITY",
            Self::InconsistentUniverseMember => "INCONSISTENT_UNIVERSE_MEMBER",
        }
    }
}

impl Display for StrategyInputBindingUnavailable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

/// A row's value stated exactly at `scale`, the role's scale.
///
/// Rows keep the scale their source stated them at; a role states every value at one scale.
/// Widening is always exact, narrowing only when the dropped digits are zero, and nothing is ever
/// rounded: a value that would need it is refused by name.
fn value_at_role_scale(
    row: &VerifiedPitObservation,
    scale: u8,
) -> Result<i128, StrategyInputBindingUnavailable> {
    rescale_exact_v1(row.value_mantissa(), row.value_scale(), scale).map_err(|e| match e {
        RescaleErrorV1::FinerThanTarget => StrategyInputBindingUnavailable::ValueFinerThanRoleScale,
        RescaleErrorV1::Overflow => StrategyInputBindingUnavailable::ValueOverflowsRoleScale,
    })
}

/// The one row a role resolves to, admitted only when its value can be stated exactly at
/// `scale`. Scale never selects among rows: rows that differ only in scale are not unique, and
/// the one resolved row either aligns exactly or is refused by name.
fn single_row_at_role_scale<'a>(
    rows: &[&'a VerifiedPitObservation],
    scale: u8,
) -> Result<&'a VerifiedPitObservation, StrategyInputBindingUnavailable> {
    let [row] = rows else {
        return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
    };
    value_at_role_scale(row, scale)?;
    Ok(row)
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
    source: PitObservationBatchSourceV1,
    digest: BindingDigest,
}

impl StrategyInputEventTriggerReceipt {
    pub const fn lifecycle(&self) -> StrategyInputLifecycleProjection {
        self.lifecycle
    }
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }
    /// The batch the frame was read from.
    pub const fn source(&self) -> PitObservationBatchSourceV1 {
        self.source
    }
    #[cfg(test)]
    pub(crate) fn snapshot_identity_for_test(&self) -> BindingDigest {
        self.committed_snapshot()
            .expect("the test frame is a committed snapshot's")
            .0
    }
    #[cfg(test)]
    pub(crate) fn snapshot_fact_digest_for_test(&self) -> BindingDigest {
        self.committed_snapshot()
            .expect("the test frame is a committed snapshot's")
            .1
    }
    /// `(snapshot identity, fact digest)` for a frame of a committed snapshot, `None` otherwise.
    pub(crate) const fn committed_snapshot(&self) -> Option<(BindingDigest, BindingDigest)> {
        match self.source {
            PitObservationBatchSourceV1::CommittedSnapshot {
                snapshot_identity,
                fact_digest,
            } => Some((snapshot_identity, fact_digest)),
            _ => None,
        }
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// Owner-sealed exact typed value for one role in an admitted multi-field frame.
///
/// The value bytes are signed little-endian i128 fixed-point mantissa bytes, the row's value
/// stated exactly at `value_scale`, the scale sealed by the original binding receipt;
/// `canonical_row_digest` names the row as its source stated it. The receipt has no public constructor and does
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

/// Owner-sealed one- or two-member universe selection for one verified PIT batch.
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

/// One atomic Owner-sealed selection of one or two members and its canonically ordered
/// member/role frame.
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

/// Maximum number of typed input roles one persisted Composer custody claim may carry.
pub const MAX_STRATEGY_INPUT_CUSTODY_ROLES_V1: usize = 64;

/// Caller-authored claim naming the persisted declarations one Composer run must re-read.
///
/// Every field is an untrusted proposal. Holding a claim mints nothing: Market Data re-reads the
/// stored declarations, re-derives each binding from its live native dependencies, and rejects the
/// whole claim when a stored request names a different Design, a different PIT request, or a
/// decision cut other than the one the caller requires.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedStrategyInputCustodyClaimV1 {
    /// Caller-proposed R&D request identity that every stored declaration must repeat.
    pub research_request_identity: BindingDigest,
    /// Caller-proposed `StrategyDesignV2` identity that every stored declaration must repeat.
    pub strategy_design_identity: BindingDigest,
    /// Caller-proposed PIT request identity that every stored declaration must repeat.
    pub pit_request_identity: BindingDigest,
    /// Complete typed input-role set the Design declares. Arrival order is free; duplicates reject.
    pub input_role_identities: Vec<BindingDigest>,
    /// Exact decision cut the caller requires. Any other stored cut rejects the whole claim.
    pub decision_cut: u64,
}

/// Structured fail-closed custody outcome. Every variant carries zero positive receipt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyInputCustodyUnavailableV1 {
    /// A zero identity, an empty, oversized, or duplicated role set, or a zero decision cut.
    InvalidClaim,
    /// At least one claimed role has no persisted Market Data declaration.
    UnknownDeclaration,
    /// A stored declaration names a different R&D request.
    ResearchRequestMismatch,
    /// A stored declaration names a different `StrategyDesignV2`.
    DesignMismatch,
    /// A stored declaration names a different PIT request.
    PitRequestMismatch,
    /// The stored declarations do not cover exactly the claimed roles.
    RoleCoverageMismatch,
    /// The stored declarations are not all of the scope this re-read serves: an exact-instrument
    /// re-read met a universe-member declaration, or the reverse, or one Design's declarations
    /// name both scopes.
    ScopeMismatch,
    /// A stored declaration was cut before the decision cut the caller requires.
    StaleDecisionCut,
    /// A stored declaration was cut after the decision cut the caller requires.
    UnexpectedDecisionCut,
    /// The stored declarations do not share one Owner lineage cut.
    LineageDrift,
    /// Stored bytes no longer decode, or no longer carry their own key and meaning digest.
    DeclarationUntrusted,
    /// A native PIT, Universe, Source, Instrument Master, or Semantics dependency no longer holds.
    DependencyUnavailable,
    /// The re-derived bindings do not seal one complete joint event frame.
    FrameUnavailable,
    /// The Market Data custody store could not be read inside the caller transaction.
    StoreUnavailable,
}

impl Display for StrategyInputCustodyUnavailableV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for StrategyInputCustodyUnavailableV1 {}

/// One re-read declaration paired with the binding Market Data freshly re-derived for it.
pub(super) struct StrategyInputCustodyDeclarationV1<'a> {
    pub(super) request: &'a UntrustedStrategyInputBindingRequest,
    pub(super) request_meaning_digest: BindingDigest,
    pub(super) binding: &'a StrategyInputBindingReceipt,
}

/// Owner-sealed complete Composer input custody for one persisted Design role set.
///
/// It replaces a fixed in-memory corpus: every binding and the joint frame are re-derived from the
/// live native dependencies inside the caller transaction. The receipt has no public constructor
/// and deliberately does not implement `Deserialize`.
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_binding::StrategyInputCustodyReadbackV1;
///
/// let forged: StrategyInputCustodyReadbackV1 = serde_json::from_slice(b"{}").unwrap();
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputCustodyReadbackV1 {
    claim_identity: BindingDigest,
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    pit_request_identity: BindingDigest,
    decision_cut: u64,
    observation_batch_digest: BindingDigest,
    bindings: Box<[StrategyInputBindingReceipt]>,
    frame: StrategyInputEventFrameReceipt,
    digest: BindingDigest,
}

impl StrategyInputCustodyReadbackV1 {
    /// Returns the Owner-derived identity of the exact claim this custody answers.
    #[must_use]
    pub const fn claim_identity(&self) -> BindingDigest {
        self.claim_identity
    }

    /// Returns the caller-proposed R&D request identity every stored declaration repeated.
    #[must_use]
    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    /// Returns the caller-proposed `StrategyDesignV2` identity every stored declaration repeated.
    #[must_use]
    pub const fn strategy_design_identity(&self) -> BindingDigest {
        self.strategy_design_identity
    }

    /// Returns the PIT request identity every stored declaration repeated.
    #[must_use]
    pub const fn pit_request_identity(&self) -> BindingDigest {
        self.pit_request_identity
    }

    /// Returns the exact decision cut shared by every re-read declaration.
    #[must_use]
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    /// Returns the complete observation-batch digest shared by every re-read declaration.
    #[must_use]
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }

    /// Returns the re-derived bindings in canonical input-role order.
    #[must_use]
    pub fn bindings(&self) -> &[StrategyInputBindingReceipt] {
        &self.bindings
    }

    /// Returns the single joint event frame sealed over every re-derived binding.
    #[must_use]
    pub const fn frame(&self) -> &StrategyInputEventFrameReceipt {
        &self.frame
    }

    /// Returns the digest binding the claim, every stored meaning, and every re-derived receipt.
    #[must_use]
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// Canonicalizes the claimed role set into the exact ascending read order.
///
/// # Errors
///
/// Returns [`StrategyInputCustodyUnavailableV1::InvalidClaim`] for a zero identity, a zero decision
/// cut, or an empty, oversized, zero-valued, or duplicated role set.
pub(super) fn canonical_strategy_input_custody_roles_v1(
    claim: &UntrustedStrategyInputCustodyClaimV1,
) -> Result<Vec<BindingDigest>, StrategyInputCustodyUnavailableV1> {
    let zero = [0_u8; 32];
    if claim.research_request_identity.as_bytes() == &zero
        || claim.strategy_design_identity.as_bytes() == &zero
        || claim.pit_request_identity.as_bytes() == &zero
        || claim.decision_cut == 0
        || claim.input_role_identities.is_empty()
        || claim.input_role_identities.len() > MAX_STRATEGY_INPUT_CUSTODY_ROLES_V1
        || claim
            .input_role_identities
            .iter()
            .any(|identity| identity.as_bytes() == &zero)
    {
        return Err(StrategyInputCustodyUnavailableV1::InvalidClaim);
    }
    let mut roles = claim.input_role_identities.clone();
    roles.sort_unstable_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    roles.dedup();
    if roles.len() != claim.input_role_identities.len() {
        return Err(StrategyInputCustodyUnavailableV1::InvalidClaim);
    }
    Ok(roles)
}

/// Seals one complete persisted Composer input custody from freshly re-derived Owner evidence.
///
/// Declarations must arrive in canonical ascending role order, one per claimed role, each already
/// re-bound against the live native batch, together with the one joint frame sealed over them.
///
/// # Errors
///
/// Returns a redacted fail-closed category for a malformed claim, incomplete or surplus role
/// coverage, a stored request that names another Research request, Design, or PIT request, a stored
/// decision cut other than the required one, a lineage cut that is no longer shared, or a frame that
/// does not carry exactly one value per re-derived binding. No error carries a partial receipt.
pub(super) fn seal_strategy_input_custody_v1(
    claim: &UntrustedStrategyInputCustodyClaimV1,
    declarations: &[StrategyInputCustodyDeclarationV1<'_>],
    frame: &StrategyInputEventFrameReceipt,
) -> Result<StrategyInputCustodyReadbackV1, StrategyInputCustodyUnavailableV1> {
    let roles = canonical_strategy_input_custody_roles_v1(claim)?;
    if declarations.len() != roles.len() {
        return Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch);
    }
    let first = declarations
        .first()
        .ok_or(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch)?
        .request;

    for (declaration, role_identity) in declarations.iter().zip(&roles) {
        check_custody_request_v1(
            claim,
            first,
            declaration.request,
            declaration.request_meaning_digest,
            *role_identity,
        )?;
        let locator = declaration.binding.locator();
        if locator.research_request_identity() != claim.research_request_identity
            || locator.strategy_design_identity() != claim.strategy_design_identity
        {
            return Err(StrategyInputCustodyUnavailableV1::DesignMismatch);
        }

        if locator.input_role_identity() != *role_identity {
            return Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch);
        }
    }

    let trigger = frame.trigger();
    if trigger.observation_batch_digest() != first.observation_batch_digest
        || binding_request_source_of_v1(trigger.source()) != Some(first.source)
    {
        return Err(StrategyInputCustodyUnavailableV1::LineageDrift);
    }

    if frame.values().len() != declarations.len() {
        return Err(StrategyInputCustodyUnavailableV1::FrameUnavailable);
    }

    let mut encoder = Encoder::new(b"VIBE_STRATEGY_INPUT_CUSTODY_V1");
    encoder.digest(claim.research_request_identity);
    encoder.digest(claim.strategy_design_identity);
    encoder.digest(claim.pit_request_identity);
    encoder.u64(claim.decision_cut);
    encoder.u64(roles.len() as u64);
    encoder.digest(trigger.digest());
    for declaration in declarations {
        let binding_digest = declaration.binding.digest();
        let value = frame
            .values()
            .iter()
            .find(|value| value.input_role_identity() == declaration.request.input_role_identity)
            .ok_or(StrategyInputCustodyUnavailableV1::FrameUnavailable)?;

        if value.binding_receipt_digest() != binding_digest
            || value.observation_batch_digest() != first.observation_batch_digest
        {
            return Err(StrategyInputCustodyUnavailableV1::FrameUnavailable);
        }
        encoder.digest(declaration.request.input_role_identity);
        encoder.digest(declaration.request_meaning_digest);
        encoder.digest(binding_digest);
        encoder.digest(value.digest());
    }
    let custody_digest = digest(&encoder.finish());

    Ok(StrategyInputCustodyReadbackV1 {
        claim_identity: custody_claim_identity_v1(claim, &roles),
        research_request_identity: claim.research_request_identity,
        strategy_design_identity: claim.strategy_design_identity,
        pit_request_identity: claim.pit_request_identity,
        decision_cut: claim.decision_cut,
        observation_batch_digest: first.observation_batch_digest,
        bindings: declarations
            .iter()
            .map(|declaration| declaration.binding.clone())
            .collect::<Vec<_>>()
            .into_boxed_slice(),
        frame: frame.clone(),
        digest: custody_digest,
    })
}

/// Checks one stored request against the claim it is re-read for, in canonical role position.
///
/// Every custody re-read applies these, whatever the declaration's scope: the request must repeat
/// the claim's Research request, Design and PIT request, sit at its role's canonical position, be
/// cut at exactly the required decision cut, and share the first request's Owner lineage cut.
fn check_custody_request_v1(
    claim: &UntrustedStrategyInputCustodyClaimV1,
    first: &UntrustedStrategyInputBindingRequest,
    request: &UntrustedStrategyInputBindingRequest,
    request_meaning_digest: BindingDigest,
    role_identity: BindingDigest,
) -> Result<(), StrategyInputCustodyUnavailableV1> {
    if request_meaning_digest.as_bytes() == &[0; 32] {
        return Err(StrategyInputCustodyUnavailableV1::DeclarationUntrusted);
    }

    if request.research_request_identity != claim.research_request_identity {
        return Err(StrategyInputCustodyUnavailableV1::ResearchRequestMismatch);
    }

    if request.strategy_design_identity != claim.strategy_design_identity {
        return Err(StrategyInputCustodyUnavailableV1::DesignMismatch);
    }

    if request.pit_request_identity != claim.pit_request_identity {
        return Err(StrategyInputCustodyUnavailableV1::PitRequestMismatch);
    }

    if request.input_role_identity != role_identity {
        return Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch);
    }

    if request.decision_cut < claim.decision_cut {
        return Err(StrategyInputCustodyUnavailableV1::StaleDecisionCut);
    }

    if request.decision_cut > claim.decision_cut {
        return Err(StrategyInputCustodyUnavailableV1::UnexpectedDecisionCut);
    }

    if !shares_custody_lineage_cut_v1(first, request) {
        return Err(StrategyInputCustodyUnavailableV1::LineageDrift);
    }
    Ok(())
}

/// The Owner-derived identity of one canonical custody claim, whatever the declarations' scope.
fn custody_claim_identity_v1(
    claim: &UntrustedStrategyInputCustodyClaimV1,
    roles: &[BindingDigest],
) -> BindingDigest {
    let mut encoder = Encoder::new(b"VIBE_STRATEGY_INPUT_CUSTODY_CLAIM_V1");
    encoder.digest(claim.research_request_identity);
    encoder.digest(claim.strategy_design_identity);
    encoder.digest(claim.pit_request_identity);
    encoder.u64(claim.decision_cut);
    encoder.u64(roles.len() as u64);
    for role_identity in roles {
        encoder.digest(*role_identity);
    }
    digest(&encoder.finish())
}

/// One re-read universe-member declaration and the digest of the role's universe frame, which the
/// registry has already re-derived and found equal to the stored digest.
pub(super) struct StrategyInputUniverseCustodyDeclarationV1<'a> {
    pub(super) request: &'a UntrustedStrategyInputBindingRequest,
    pub(super) request_meaning_digest: BindingDigest,
    pub(super) binding_digest: BindingDigest,
}

/// Owner-sealed complete input custody for one persisted universe-member Design role set.
///
/// It is the universe counterpart of [`StrategyInputCustodyReadbackV1`]. A universe-member role
/// has no single-row binding, so what is sealed is the universe frame Market Data re-derives over
/// the Design's complete role set from the live batch: its selection and one value per (member,
/// role), each carrying the member binding digest a host compares. That frame is not any one
/// declaration's digest - each declaration stores the frame of its own role alone - and the custody
/// digest binds both. The receipt has no public constructor and does not implement `Deserialize`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputUniverseCustodyReadbackV1 {
    claim_identity: BindingDigest,
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    pit_request_identity: BindingDigest,
    decision_cut: u64,
    observation_batch_digest: BindingDigest,
    frame: StrategyInputUniverseFrameReceipt,
    digest: BindingDigest,
}

impl StrategyInputUniverseCustodyReadbackV1 {
    /// Returns the Owner-derived identity of the exact claim this custody answers.
    #[must_use]
    pub const fn claim_identity(&self) -> BindingDigest {
        self.claim_identity
    }

    /// Returns the R&D request identity every stored declaration repeated.
    #[must_use]
    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    /// Returns the `StrategyDesignV2` identity every stored declaration repeated.
    #[must_use]
    pub const fn strategy_design_identity(&self) -> BindingDigest {
        self.strategy_design_identity
    }

    /// Returns the PIT request identity every stored declaration repeated.
    #[must_use]
    pub const fn pit_request_identity(&self) -> BindingDigest {
        self.pit_request_identity
    }

    /// Returns the exact decision cut shared by every re-read declaration.
    #[must_use]
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    /// Returns the complete observation-batch digest shared by every re-read declaration.
    #[must_use]
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }

    /// Returns the universe frame re-derived over the complete role set.
    #[must_use]
    pub const fn frame(&self) -> &StrategyInputUniverseFrameReceipt {
        &self.frame
    }

    /// Returns the digest binding the claim, every stored meaning and role digest, and the frame.
    #[must_use]
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// Seals one complete persisted universe-member input custody from freshly re-derived evidence.
///
/// Declarations must arrive in canonical ascending role order, one per claimed role, together with
/// the universe frame re-derived over all of their requests.
///
/// # Errors
///
/// Returns the same redacted categories as [`seal_strategy_input_custody_v1`], plus
/// [`StrategyInputCustodyUnavailableV1::ScopeMismatch`] for a request that is not
/// universe-member scoped, and [`StrategyInputCustodyUnavailableV1::FrameUnavailable`] for a
/// frame over another selection, batch or role set. No error carries a partial receipt.
pub(super) fn seal_strategy_input_universe_custody_v1(
    claim: &UntrustedStrategyInputCustodyClaimV1,
    declarations: &[StrategyInputUniverseCustodyDeclarationV1<'_>],
    frame: &StrategyInputUniverseFrameReceipt,
) -> Result<StrategyInputUniverseCustodyReadbackV1, StrategyInputCustodyUnavailableV1> {
    let roles = canonical_strategy_input_custody_roles_v1(claim)?;
    if declarations.len() != roles.len() {
        return Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch);
    }
    let first = declarations
        .first()
        .ok_or(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch)?
        .request;

    for (declaration, role_identity) in declarations.iter().zip(&roles) {
        check_custody_request_v1(
            claim,
            first,
            declaration.request,
            declaration.request_meaning_digest,
            *role_identity,
        )?;
        let UntrustedStrategyInputScope::UniverseSelection { selection_identity } =
            declaration.request.scope
        else {
            return Err(StrategyInputCustodyUnavailableV1::ScopeMismatch);
        };

        if selection_identity != frame.selection().selection_identity() {
            return Err(StrategyInputCustodyUnavailableV1::FrameUnavailable);
        }
    }

    let trigger = frame.trigger();
    if trigger.observation_batch_digest() != first.observation_batch_digest
        || binding_request_source_of_v1(trigger.source()) != Some(first.source)
    {
        return Err(StrategyInputCustodyUnavailableV1::LineageDrift);
    }
    // One value per (member, role), exactly over the claimed roles.
    let mut frame_roles = frame
        .values()
        .iter()
        .map(StrategyInputUniverseValueReceipt::input_role_identity)
        .collect::<Vec<_>>();
    frame_roles.sort_unstable_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    frame_roles.dedup();
    if frame_roles != roles
        || frame.values().len() != roles.len() * frame.selection().members().len()
        || frame
            .values()
            .iter()
            .any(|value| value.observation_batch_digest() != first.observation_batch_digest)
    {
        return Err(StrategyInputCustodyUnavailableV1::FrameUnavailable);
    }

    let mut encoder = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_CUSTODY_V1");
    encoder.digest(claim.research_request_identity);
    encoder.digest(claim.strategy_design_identity);
    encoder.digest(claim.pit_request_identity);
    encoder.u64(claim.decision_cut);
    encoder.u64(roles.len() as u64);
    encoder.digest(frame.digest());
    for declaration in declarations {
        encoder.digest(declaration.request.input_role_identity);
        encoder.digest(declaration.request_meaning_digest);
        encoder.digest(declaration.binding_digest);
    }

    Ok(StrategyInputUniverseCustodyReadbackV1 {
        claim_identity: custody_claim_identity_v1(claim, &roles),
        research_request_identity: claim.research_request_identity,
        strategy_design_identity: claim.strategy_design_identity,
        pit_request_identity: claim.pit_request_identity,
        decision_cut: claim.decision_cut,
        observation_batch_digest: first.observation_batch_digest,
        frame: frame.clone(),
        digest: digest(&encoder.finish()),
    })
}

/// Returns whether two stored requests name one shared Owner lineage cut.
fn shares_custody_lineage_cut_v1(
    first: &UntrustedStrategyInputBindingRequest,
    candidate: &UntrustedStrategyInputBindingRequest,
) -> bool {
    first.pit_request_digest == candidate.pit_request_digest
        && first.source == candidate.source
        && first.observation_batch_digest == candidate.observation_batch_digest
        && first.source_binding_identity == candidate.source_binding_identity
        && first.source_frontier_digest == candidate.source_frontier_digest
        && first.correction_frontier_digest == candidate.correction_frontier_digest
        && first.instrument_master_digest == candidate.instrument_master_digest
        && first.universe_selection_digest == candidate.universe_selection_digest
        && first.market_semantics_identity == candidate.market_semantics_identity
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
        values.push(issue_event_value_receipt(&trigger, &binding, batch, row)?);
    }
    Ok(StrategyInputEventFrameReceipt {
        trigger,
        values: values.into_boxed_slice(),
    })
}

/// Resolves the canonical four roles and their one native EVENT frame from one complete batch.
///
/// Unlike [`bind_strategy_input_event_frame`], this operation derives the static bindings and the
/// frame together. Every observation must belong to exactly one requested role. No partial binding
/// set or frame is returned.
#[cfg(feature = "sealed-strategy-input-acceptance")]
pub(in crate::owner) type StrategyInputEventCorpusBinding = (
    Box<[StrategyInputBindingReceipt]>,
    StrategyInputEventFrameReceipt,
);

#[cfg(feature = "sealed-strategy-input-acceptance")]
pub(in crate::owner) fn bind_strategy_input_event_corpus(
    requests: &[UntrustedStrategyInputBindingRequest],
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputEventCorpusBinding, StrategyInputBindingUnavailable> {
    if requests.len() != 4 || batch.observations().len() != 4 {
        return Err(StrategyInputBindingUnavailable::MissingField(
            "event_corpus",
        ));
    }
    let mut role_identities = BTreeSet::new();
    let mut bindings = Vec::with_capacity(requests.len());
    for request in requests {
        validate_request(request)?;

        if request.unit != request.field_semantic.unit() {
            return Err(StrategyInputBindingUnavailable::UnitMismatch);
        }

        if !batch_matches_request(request, batch) {
            return Err(StrategyInputBindingUnavailable::StaleBatch);
        }

        if !role_identities.insert(request.input_role_identity) {
            return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
        }
        bindings.push(bind_strategy_input_role(request, batch)?);
    }

    bindings.sort_by_key(|binding| binding.locator().input_role_identity());
    let frame = bind_complete_strategy_input_event_frame(&bindings, batch)?;
    Ok((bindings.into_boxed_slice(), frame))
}

pub(in crate::owner) fn bind_complete_strategy_input_event_frame(
    bindings: &[StrategyInputBindingReceipt],
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputEventFrameReceipt, StrategyInputBindingUnavailable> {
    if bindings.len() != 4 || batch.observations().len() != 4 {
        return Err(StrategyInputBindingUnavailable::MissingField(
            "event_corpus",
        ));
    }
    let mut role_identities = BTreeSet::new();

    if bindings
        .iter()
        .any(|binding| !role_identities.insert(binding.locator().input_role_identity()))
    {
        return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
    }

    if batch.observations().iter().any(|row| {
        bindings
            .iter()
            .filter(|binding| static_binding_matches_row(binding, batch, row))
            .count()
            != 1
    }) {
        return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
    }
    bind_strategy_input_event_frame(bindings, batch)
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
pub(in crate::owner) fn split_strategy_input_event_frames_by_role(
    frames: &[StrategyInputEventFrameReceipt],
) -> Box<[StrategyInputEventFrameReceipt]> {
    frames
        .iter()
        .flat_map(|frame| {
            frame
                .values
                .iter()
                .cloned()
                .map(|value| StrategyInputEventFrameReceipt {
                    trigger: frame.trigger.clone(),
                    values: Box::new([value]),
                })
        })
        .collect::<Vec<_>>()
        .into_boxed_slice()
}

fn static_binding_matches_row(
    binding: &StrategyInputBindingReceipt,
    batch: &VerifiedPitObservationBatch,
    row: &VerifiedPitObservation,
) -> bool {
    let locator = binding.locator();
    locator.source_binding_lineage_root == batch.source_binding_lineage_root()
        && locator.market_semantics_identity == batch.market_semantics_identity()
        && MarketDataFieldSemantic::from_identity(locator.field_semantic_identity)
            .is_some_and(|semantic| row.field() == semantic.row_field())
        && row.instrument() == locator.instrument
        && row.channel() == locator.channel
        && row.data_kind() == locator.data_kind
        && row.timeframe() == locator.timeframe
        && row.correction_stream_identity() == locator.correction_stream_identity
        && row.market_semantics_identity() == locator.market_semantics_identity
}

/// Derives and seals one universe of one or two members plus every requested role for every member.
///
/// Membership comes only from the complete verified batch. `UniverseSelection.selection_identity`
/// is an untrusted expected identity and must equal the Owner-derived identity. Exact-instrument and
/// caller-supplied instrument-set scopes are rejected. No error contains a selection or frame receipt.
///
/// # Errors
///
/// Returns a structured unavailable state for an incomplete or inconsistent universe,
/// stale authority, unsupported caller scope, or missing, ambiguous, or incompatible member-role row.
pub fn bind_strategy_input_universe_frame(
    requests: &[UntrustedStrategyInputBindingRequest],
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputUniverseFrameReceipt, StrategyInputBindingUnavailable> {
    bind_strategy_input_universe_frame_with_sources_v1(requests, batch).map(|(frame, _)| frame)
}

/// Binds one universe frame and, in the same pass, the row each of its values reads.
///
/// The sources are in the frame's value order, and each carries the member binding digest and
/// canonical row digest its value was issued with. A sample written from them is a sample of
/// exactly the rows the frame a host admits was built from, because this is the only code that
/// resolves a universe member's row.
pub(crate) fn bind_strategy_input_universe_frame_with_sources_v1<'a>(
    requests: &'a [UntrustedStrategyInputBindingRequest],
    batch: &'a VerifiedPitObservationBatch,
) -> Result<
    (
        StrategyInputUniverseFrameReceipt,
        Vec<UniverseMemberSampleSourceV1<'a>>,
    ),
    StrategyInputBindingUnavailable,
> {
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
    for (ordinal, member) in selection.members().iter().enumerate() {
        let ordinal = u8::try_from(ordinal)
            .map_err(|_| StrategyInputBindingUnavailable::MissingField("member_ordinal"))?;

        for request in requests {
            let row = resolve_universe_member_role(request, member, batch)?;
            let binding_digest = universe_member_binding_digest(request, &selection, member, row);
            resolved.push((ordinal, member, request, row, binding_digest));
        }
    }
    resolved.sort_by(|left, right| {
        (
            left.1.member_key(),
            left.1.instrument(),
            left.2.input_role_identity,
        )
            .cmp(&(
                right.1.member_key(),
                right.1.instrument(),
                right.2.input_role_identity,
            ))
    });
    let trigger_inputs = resolved
        .iter()
        .map(|(_, member, request, row, binding_digest)| (*member, *request, *row, *binding_digest))
        .collect::<Vec<_>>();
    let trigger = issue_universe_trigger_receipt(batch, &selection, &trigger_inputs)?;
    let mut sources = Vec::with_capacity(resolved.len());
    let values = resolved
        .into_iter()
        .map(|(member_ordinal, member, request, row, binding_digest)| {
            let value = issue_universe_value_receipt(
                &trigger,
                member,
                request,
                row,
                batch,
                binding_digest,
            )?;
            sources.push(UniverseMemberSampleSourceV1 {
                member_ordinal,
                source: SampleSourceV1 {
                    binding_digest,
                    instrument: row.instrument(),
                    field_semantic_identity: request.field_semantic.identity(),
                    unit: request.unit.canonical(),
                    market_semantics_identity: selection.market_semantics_identity(),
                    batch,
                    row,
                    canonical_row_digest: value.canonical_row_digest(),
                },
            });
            Ok(value)
        })
        .collect::<Result<Vec<_>, StrategyInputBindingUnavailable>>()?
        .into_boxed_slice();
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_FRAME_RECEIPT_V1");
    canonical.digest(selection.digest());
    canonical.digest(trigger.digest());
    canonical.u64(values.len() as u64);
    for value in &values {
        canonical.digest(value.digest());
    }
    let digest = digest(&canonical.finish());
    Ok((
        StrategyInputUniverseFrameReceipt {
            selection,
            trigger,
            values,
            digest,
        },
        sources,
    ))
}

pub(crate) fn derive_universe_selection(
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

    // One member is a single-instrument universe, two the pair. The count is part of the static
    // meaning hashed below, so a one-member selection never shares an identity with a two-member one.
    if !super::ADMITTED_UNIVERSE_MEMBER_COUNTS.contains(&by_member.len()) {
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
    let source = binding_request_source_of_v1(batch.source())
        .ok_or(StrategyInputBindingUnavailable::StaleBatch)?;
    let mut receipt_bytes = Encoder::for_source(
        b"VIBE_STRATEGY_INPUT_UNIVERSE_SELECTION_RECEIPT_V1",
        b"VIBE_STRATEGY_INPUT_UNIVERSE_SELECTION_RECEIPT_CUSTODY_VIEW_V1",
        source,
    );
    receipt_bytes.digest(selection_identity);
    receipt_bytes.digest(selection_digest);
    // Provenance only: this digest originates in the untrusted PIT request and is never selection
    // authority. The verified batch still binds it dynamically for exact request replay.
    receipt_bytes.digest(batch.universe_selection_digest());
    receipt_bytes.digest(batch.instrument_master_digest());
    receipt_bytes.source(source);
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

/// Returns the canonical Owner-derived identity for the complete verified universe of one or two
/// members.
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
                && row.correction_stream_identity() == locator.correction_stream_identity
                && row.market_semantics_identity() == locator.market_semantics_identity
        })
        .collect::<Vec<_>>();
    single_row_at_role_scale(&rows, locator.scale)
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
    let row = single_row_at_role_scale(&exact_without_scale, request.scale)?;
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
    single_row_at_role_scale(&exact_without_scale, request.scale)
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

    let source_identities = match request.source {
        StrategyInputBatchSourceV1::Snapshot {
            snapshot_identity,
            snapshot_fact_digest,
        } => vec![
            ("snapshot_identity", snapshot_identity),
            ("snapshot_fact_digest", snapshot_fact_digest),
        ],
        StrategyInputBatchSourceV1::CustodyView {
            chain_root,
            view_identity,
            derived_frontier_digest,
            ..
        } => vec![
            ("chain_root", chain_root),
            ("view_identity", view_identity),
            ("derived_frontier_digest", derived_frontier_digest),
        ],
    };

    if let Some((name, _)) = identities
        .into_iter()
        .chain(source_identities)
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
        && binding_request_source_of_v1(batch.source()) == Some(request.source)
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
        scale: request.scale,
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
    let source = binding_request_source_of_v1(batch.source())
        .ok_or(StrategyInputBindingUnavailable::StaleBatch)?;
    let mut canonical = Encoder::for_source(
        b"VIBE_STRATEGY_INPUT_EVENT_FRAME_V1",
        b"VIBE_STRATEGY_INPUT_EVENT_FRAME_CUSTODY_VIEW_V1",
        source,
    );
    canonical.source(source);
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
        source: batch.source(),
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
    let source = binding_request_source_of_v1(batch.source())
        .ok_or(StrategyInputBindingUnavailable::StaleBatch)?;
    let mut canonical = Encoder::for_source(
        b"VIBE_STRATEGY_INPUT_UNIVERSE_EVENT_FRAME_V1",
        b"VIBE_STRATEGY_INPUT_UNIVERSE_EVENT_FRAME_CUSTODY_VIEW_V1",
        source,
    );
    canonical.digest(selection.digest());
    canonical.source(source);
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
        source: batch.source(),
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
) -> Result<StrategyInputUniverseValueReceipt, StrategyInputBindingUnavailable> {
    let canonical_row_digest = digest(&canonical_row_binding_bytes(row));
    let value_scale = request.scale;
    let value_bytes = value_at_role_scale(row, value_scale)?.to_le_bytes();
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_UNIVERSE_VALUE_V1");
    canonical.digest(trigger.digest());
    canonical.digest(trigger.observation_batch_digest());
    canonical.string(member.member_key());
    canonical.string(member.instrument());
    canonical.digest(request.input_role_identity);
    canonical.digest(binding_digest);
    canonical.string(STRATEGY_INPUT_FIXED_I128_LE_V1);
    canonical.bytes(&value_bytes);
    canonical.u8(value_scale);
    canonical.digest(canonical_row_digest);
    canonical.digest(batch.source_binding_lineage_root());
    canonical.u64(batch.source_binding_lineage_version());
    canonical.string(row.correction_stream_identity());
    canonical.u64(row.correction_sequence());
    canonical.digest(row.correction_frontier_digest());
    canonical.digest(row.market_semantics_identity());
    let digest = digest(&canonical.finish());
    Ok(StrategyInputUniverseValueReceipt {
        member_key: member.member_key().to_owned(),
        instrument: member.instrument().to_owned(),
        input_role_identity: request.input_role_identity,
        binding_digest,
        value_type_semantic_id: STRATEGY_INPUT_FIXED_I128_LE_V1,
        value_bytes,
        value_scale,
        canonical_row_digest,
        source_binding_lineage_root: batch.source_binding_lineage_root(),
        correction_stream_identity: row.correction_stream_identity().to_owned(),
        market_semantics_identity: row.market_semantics_identity(),
        trigger_digest: trigger.digest(),
        observation_batch_digest: trigger.observation_batch_digest(),
        digest,
    })
}

fn issue_event_value_receipt(
    trigger: &StrategyInputEventTriggerReceipt,
    binding: &StrategyInputBindingReceipt,
    batch: &VerifiedPitObservationBatch,
    row: &VerifiedPitObservation,
) -> Result<StrategyInputEventValueReceipt, StrategyInputBindingUnavailable> {
    let canonical_row_digest = digest(&canonical_row_binding_bytes(row));
    let value_scale = binding.locator().scale;
    let value_bytes = value_at_role_scale(row, value_scale)?.to_le_bytes();
    let mut canonical = Encoder::new(b"VIBE_STRATEGY_INPUT_EVENT_VALUE_V1");
    canonical.digest(trigger.digest());
    canonical.digest(trigger.observation_batch_digest());
    canonical.digest(binding.locator().input_role_identity());
    canonical.digest(binding.digest());
    canonical.string(STRATEGY_INPUT_FIXED_I128_LE_V1);
    canonical.bytes(&value_bytes);
    canonical.u8(value_scale);
    canonical.digest(canonical_row_digest);
    canonical.digest(batch.source_binding_lineage_root());
    canonical.u64(batch.source_binding_lineage_version());
    canonical.string(row.correction_stream_identity());
    canonical.u64(row.correction_sequence());
    canonical.digest(row.correction_frontier_digest());
    canonical.digest(row.market_semantics_identity());
    let digest = digest(&canonical.finish());
    Ok(StrategyInputEventValueReceipt {
        input_role_identity: binding.locator().input_role_identity(),
        binding_receipt_digest: binding.digest(),
        value_type_semantic_id: STRATEGY_INPUT_FIXED_I128_LE_V1,
        value_bytes,
        value_scale,
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
    })
}

fn event_kind(data_kind: &str) -> Result<StrategyInputEventKind, StrategyInputBindingUnavailable> {
    Ok(match data_kind {
        "BAR" => StrategyInputEventKind::Bar,
        "QUOTE" | "TRADE" | "REFERENCE" | "ECONOMIC" | "SCALAR" => StrategyInputEventKind::Event,
        _ => return Err(StrategyInputBindingUnavailable::UnsupportedLifecycleKind),
    })
}

/// The digest a value receipt names its row by: what traces a value back to the observation it
/// read.
pub(crate) fn canonical_row_digest_v1(row: &VerifiedPitObservation) -> BindingDigest {
    digest(&canonical_row_binding_bytes(row))
}

// This gated helper stays directly above `canonical_row_binding_bytes`: the production-producer
// check's mutation harness calibrates on that adjacency (an ungated item right after a gated one).
/// The digest a value receipt names its row by, so a proof can trace a value to the row it read.
#[cfg(test)]
pub(crate) fn canonical_row_digest_for_test(row: &VerifiedPitObservation) -> BindingDigest {
    canonical_row_digest_v1(row)
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

/// The one row a binding reads, with what that binding states about it, for the sample owner.
///
/// A sample is keyed by this row and never by the binding: `binding_digest` enters only the
/// timeframe-projection receipt through which this binding reads the sample. It is the static
/// binding receipt digest for an exact-instrument binding and the universe member binding digest
/// for a universe member, which has no static receipt.
pub(crate) struct SampleSourceV1<'a> {
    pub(crate) binding_digest: BindingDigest,
    pub(crate) instrument: &'a str,
    pub(crate) field_semantic_identity: &'static str,
    pub(crate) unit: &'static str,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) batch: &'a VerifiedPitObservationBatch,
    pub(crate) row: &'a VerifiedPitObservation,
    pub(crate) canonical_row_digest: BindingDigest,
}

/// One universe frame value's sample source, with the member ordinal the frame orders it by.
pub(crate) struct UniverseMemberSampleSourceV1<'a> {
    pub(crate) member_ordinal: u8,
    pub(crate) source: SampleSourceV1<'a>,
}

/// The row one exact-instrument binding reads, resolved by the unchanged V1 row resolver.
pub(super) fn project_sample_fact_v1<'a>(
    binding: &'a StrategyInputBindingReceipt,
    batch: &'a VerifiedPitObservationBatch,
) -> Result<SampleSourceV1<'a>, StrategyInputBindingUnavailable> {
    let row = resolve_static_binding_row(binding, batch)?;
    let locator = binding.locator();
    Ok(SampleSourceV1 {
        binding_digest: binding.digest(),
        instrument: locator.instrument(),
        field_semantic_identity: locator.field_semantic_identity(),
        unit: locator.unit(),
        market_semantics_identity: locator.market_semantics_identity(),
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

    /// An encoder under `snapshot_domain` for a snapshot source and `custody_domain` for a custody
    /// view, so a custody receipt can never share a preimage with a snapshot one.
    fn for_source(
        snapshot_domain: &[u8],
        custody_domain: &[u8],
        source: StrategyInputBatchSourceV1,
    ) -> Self {
        match source {
            StrategyInputBatchSourceV1::Snapshot { .. } => Self::new(snapshot_domain),
            StrategyInputBatchSourceV1::CustodyView { .. } => Self::new(custody_domain),
        }
    }

    /// A snapshot source writes exactly the two digests a snapshot receipt always held; a custody
    /// view writes its chain root, view identity, `e_k`, `d_k` and derived frontier.
    fn source(&mut self, source: StrategyInputBatchSourceV1) {
        match source {
            StrategyInputBatchSourceV1::Snapshot {
                snapshot_identity,
                snapshot_fact_digest,
            } => {
                self.digest(snapshot_identity);
                self.digest(snapshot_fact_digest);
            }
            StrategyInputBatchSourceV1::CustodyView {
                chain_root,
                view_identity,
                event_ns,
                decision_cut_ns,
                derived_frontier_digest,
            } => {
                self.digest(chain_root);
                self.digest(view_identity);
                self.u64(event_ns);
                self.u64(decision_cut_ns);
                self.digest(derived_frontier_digest);
            }
        }
    }

    fn digest(&mut self, value: BindingDigest) {
        self.bytes(value.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::owner::decimal_rescale_v1::MARKET_DATA_VALUE_SCALE_V1;
    use crate::owner::pit_snapshot::UnverifiedBatchFieldsForTest;

    const PINNED_CUSTODY_RECEIPTS: [&str; 3] = [
        "2401a6b13d451ccd03c89217a70488524a0a06797674af04235538dde8a40e4f",
        "f0c98263aa6706a6c72b31b919a6c95ff73c94e5d3219a274c84fa29c0918b27",
        "f8f18aee830a51a11fc964ef52563071730085fb6948ca482b84e350bb524627",
    ];
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
        VerifiedPitObservationBatch::from_fields_for_test(UnverifiedBatchFieldsForTest {
            request_identity: d(1),
            request_digest: d(2),
            correlation_identity: d(21),
            scope_digest: d(20),
            source: crate::owner::pit_window_custody_v1::PitObservationBatchSourceV1::CommittedSnapshot {
                snapshot_identity: d(3),
                fact_digest: d(4),
            },
            source_binding_identity: d(6),
            source_binding_fact_digest: d(22),
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
        })
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
            source: crate::owner::strategy_input_binding::StrategyInputBatchSourceV1::Snapshot {
                snapshot_identity: d(3),
                snapshot_fact_digest: d(4),
            },
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

    fn custody_requests() -> [UntrustedStrategyInputBindingRequest; 2] {
        let close = request();
        let mut open = request();
        open.input_role_identity = d(23);
        open.field_semantic = MarketDataFieldSemantic::BarOpenPrice;
        [close, open]
    }

    fn custody_batch() -> VerifiedPitObservationBatch {
        let mut open = row("AAPL.OPEN", "AAPL.XNAS", "1M");
        open.field = "OPEN".into();
        batch(vec![row("AAPL.CLOSE", "AAPL.XNAS", "1M"), open])
    }

    fn custody_claim() -> UntrustedStrategyInputCustodyClaimV1 {
        UntrustedStrategyInputCustodyClaimV1 {
            research_request_identity: d(20),
            strategy_design_identity: d(21),
            pit_request_identity: d(1),
            // Deliberately unsorted: the Owner canonicalizes, the caller does not choose the order.
            input_role_identities: vec![d(23), d(22)],
            decision_cut: 40,
        }
    }

    fn custody_evidence(
        requests: &[UntrustedStrategyInputBindingRequest],
    ) -> (
        Vec<StrategyInputBindingReceipt>,
        StrategyInputEventFrameReceipt,
    ) {
        let verified = custody_batch();
        let bindings = requests
            .iter()
            .map(|request| bind_strategy_input_role(request, &verified).expect("exact binding"))
            .collect::<Vec<_>>();
        let frame =
            bind_strategy_input_event_frame(&bindings, &verified).expect("complete joint frame");
        (bindings, frame)
    }

    fn custody_declarations<'a>(
        requests: &'a [UntrustedStrategyInputBindingRequest],
        bindings: &'a [StrategyInputBindingReceipt],
    ) -> Vec<StrategyInputCustodyDeclarationV1<'a>> {
        requests
            .iter()
            .zip(bindings)
            .enumerate()
            .map(
                |(ordinal, (request, binding))| StrategyInputCustodyDeclarationV1 {
                    request,
                    request_meaning_digest: d(200 + u8::try_from(ordinal).expect("bounded roles")),
                    binding,
                },
            )
            .collect()
    }

    #[rstest]
    fn persisted_custody_seals_one_deterministic_order_independent_receipt() {
        let requests = custody_requests();
        let (bindings, frame) = custody_evidence(&requests);
        let declarations = custody_declarations(&requests, &bindings);

        let sealed = seal_strategy_input_custody_v1(&custody_claim(), &declarations, &frame)
            .expect("complete persisted custody");
        let replay = seal_strategy_input_custody_v1(&custody_claim(), &declarations, &frame)
            .expect("deterministic replay");
        assert_eq!(sealed, replay);

        let mut reordered_claim = custody_claim();
        reordered_claim.input_role_identities = vec![d(22), d(23)];
        let reordered = seal_strategy_input_custody_v1(&reordered_claim, &declarations, &frame)
            .expect("arrival order is not caller authority");
        assert_eq!(reordered.claim_identity(), sealed.claim_identity());
        assert_eq!(reordered.digest(), sealed.digest());

        assert_ne!(sealed.digest().as_bytes(), &[0; 32]);
        assert_ne!(sealed.claim_identity().as_bytes(), &[0; 32]);
        assert_ne!(sealed.digest(), sealed.claim_identity());
        assert_eq!(sealed.decision_cut(), 40);
        assert_eq!(sealed.observation_batch_digest(), d(5));
        assert_eq!(sealed.research_request_identity(), d(20));
        assert_eq!(sealed.strategy_design_identity(), d(21));
        assert_eq!(sealed.pit_request_identity(), d(1));
        assert_eq!(
            sealed
                .bindings()
                .iter()
                .map(|binding| binding.locator().input_role_identity())
                .collect::<Vec<_>>(),
            vec![d(22), d(23)]
        );
        assert_eq!(sealed.frame().values().len(), 2);
    }

    #[rstest]
    fn persisted_custody_digest_binds_every_stored_meaning_and_owner_receipt() {
        let requests = custody_requests();
        let (bindings, frame) = custody_evidence(&requests);
        let baseline = seal_strategy_input_custody_v1(
            &custody_claim(),
            &custody_declarations(&requests, &bindings),
            &frame,
        )
        .expect("complete persisted custody");

        let mut retampered = custody_declarations(&requests, &bindings);
        retampered[1].request_meaning_digest = d(210);
        let moved = seal_strategy_input_custody_v1(&custody_claim(), &retampered, &frame)
            .expect("stored meaning is evidence, not authority");
        assert_ne!(moved.digest(), baseline.digest());
        assert_eq!(moved.claim_identity(), baseline.claim_identity());
    }

    #[rstest]
    fn persisted_custody_rejects_a_zero_meaning_digest() {
        let requests = custody_requests();
        let (bindings, frame) = custody_evidence(&requests);
        let mut declarations = custody_declarations(&requests, &bindings);
        declarations[0].request_meaning_digest = BindingDigest::from_untrusted_bytes([0; 32]);
        assert_eq!(
            seal_strategy_input_custody_v1(&custody_claim(), &declarations, &frame),
            Err(StrategyInputCustodyUnavailableV1::DeclarationUntrusted)
        );
    }

    #[rstest]
    fn persisted_custody_rejects_a_declaration_bound_to_another_design_lineage() {
        let requests = custody_requests();
        let (bindings, frame) = custody_evidence(&requests);

        for (mutate, expected) in [
            (
                (|claim: &mut UntrustedStrategyInputCustodyClaimV1| {
                    claim.research_request_identity = d(90);
                }) as fn(&mut UntrustedStrategyInputCustodyClaimV1),
                StrategyInputCustodyUnavailableV1::ResearchRequestMismatch,
            ),
            (
                |claim| claim.strategy_design_identity = d(91),
                StrategyInputCustodyUnavailableV1::DesignMismatch,
            ),
            (
                |claim| claim.pit_request_identity = d(92),
                StrategyInputCustodyUnavailableV1::PitRequestMismatch,
            ),
        ] {
            let mut claim = custody_claim();
            mutate(&mut claim);
            assert_eq!(
                seal_strategy_input_custody_v1(
                    &claim,
                    &custody_declarations(&requests, &bindings),
                    &frame
                ),
                Err(expected)
            );
        }
    }

    #[rstest]
    fn persisted_custody_rejects_a_stale_or_unexpected_decision_cut() {
        let requests = custody_requests();
        let (bindings, frame) = custody_evidence(&requests);

        let mut ahead = custody_claim();
        ahead.decision_cut = 41;
        assert_eq!(
            seal_strategy_input_custody_v1(
                &ahead,
                &custody_declarations(&requests, &bindings),
                &frame
            ),
            Err(StrategyInputCustodyUnavailableV1::StaleDecisionCut)
        );

        let mut behind = custody_claim();
        behind.decision_cut = 39;
        assert_eq!(
            seal_strategy_input_custody_v1(
                &behind,
                &custody_declarations(&requests, &bindings),
                &frame
            ),
            Err(StrategyInputCustodyUnavailableV1::UnexpectedDecisionCut)
        );
    }

    #[rstest]
    fn persisted_custody_rejects_incomplete_or_surplus_role_coverage() {
        let requests = custody_requests();
        let (bindings, frame) = custody_evidence(&requests);
        let declarations = custody_declarations(&requests, &bindings);

        assert_eq!(
            seal_strategy_input_custody_v1(&custody_claim(), &declarations[..1], &frame),
            Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch)
        );

        let mut surplus = custody_claim();
        surplus.input_role_identities = vec![d(22)];
        assert_eq!(
            seal_strategy_input_custody_v1(&surplus, &declarations, &frame),
            Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch)
        );

        let mut unclaimed = custody_claim();
        unclaimed.input_role_identities = vec![d(22), d(24)];
        assert_eq!(
            seal_strategy_input_custody_v1(&unclaimed, &declarations, &frame),
            Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch)
        );
    }

    fn universe_custody_declarations<'a>(
        requests: &'a [UntrustedStrategyInputBindingRequest],
        verified: &VerifiedPitObservationBatch,
    ) -> Vec<StrategyInputUniverseCustodyDeclarationV1<'a>> {
        requests
            .iter()
            .enumerate()
            .map(
                |(ordinal, request)| StrategyInputUniverseCustodyDeclarationV1 {
                    request,
                    request_meaning_digest: d(200 + u8::try_from(ordinal).expect("bounded roles")),
                    binding_digest: bind_strategy_input_universe_frame(
                        std::slice::from_ref(request),
                        verified,
                    )
                    .expect("the role's own universe frame")
                    .digest(),
                },
            )
            .collect()
    }

    /// A universe-member Replay aggregate's frame is re-derived from the batch and the complete
    /// role set; any other role set, or first-corpus facts, is refused by name.
    #[rstest]
    fn the_replay_frame_is_rederived_from_the_batch_and_the_complete_role_set() {
        use crate::owner::replay_market_facts_v2::{
            ReplayCompositionBindingErrorV1,
            composition::verify_universe_member_replay_facts_frame_v2 as verify,
            tests::{first_corpus_readback, universe_member_readback_over_frame},
        };

        let verified = batch(complete_universe_rows());
        let requests = universe_requests(&verified);
        let frame = bind_strategy_input_universe_frame(&requests, &verified).unwrap();
        let bound = universe_member_readback_over_frame(frame.digest());
        assert_eq!(verify(bound.facts(), &verified, &requests), Ok(()));
        assert_eq!(
            verify(bound.facts(), &verified, &requests[..1]),
            Err(ReplayCompositionBindingErrorV1::UniverseFrameMismatch),
            "one role of two derives a different frame"
        );
        assert_eq!(
            verify(bound.facts(), &verified, &[]),
            Err(ReplayCompositionBindingErrorV1::UniverseFrameMismatch),
            "no role set derives no frame"
        );
        assert_eq!(
            verify(first_corpus_readback(true).1.facts(), &verified, &requests),
            Err(ReplayCompositionBindingErrorV1::CompositionShapeMismatch)
        );
    }

    /// A universe-member Replay aggregate is issued only over a frame of its own PIT snapshot, its
    /// Source Binding lineage and exactly the members its Universe Selection includes.
    #[rstest]
    fn a_replay_frame_binds_only_its_own_snapshot_lineage_and_members() {
        use crate::owner::replay_market_facts_v2::composition::universe_frame_binds_request_v2 as binds;

        let verified = batch(complete_universe_rows());
        let frame =
            bind_strategy_input_universe_frame(&universe_requests(&verified), &verified).unwrap();
        let snapshot = frame.trigger().snapshot_identity_for_test();
        let fact = frame.trigger().snapshot_fact_digest_for_test();
        let lineage = frame.selection().source_binding_lineage_root();
        let members: [(&[u8], &[u8]); 2] = [
            (b"MSFT".as_slice(), b"MSFT.XNAS".as_slice()),
            (b"AAPL".as_slice(), b"AAPL.XNAS".as_slice()),
        ];
        assert!(
            binds(&frame, snapshot, fact, lineage, &members),
            "any order"
        );
        assert!(
            !binds(&frame, d(99), fact, lineage, &members),
            "another snapshot"
        );
        assert!(
            !binds(&frame, snapshot, d(99), lineage, &members),
            "another fact"
        );
        assert!(
            !binds(&frame, snapshot, fact, d(99), &members),
            "another lineage"
        );
        assert!(
            !binds(&frame, snapshot, fact, lineage, &members[..1]),
            "fewer members"
        );
        assert!(
            !binds(
                &frame,
                snapshot,
                fact,
                lineage,
                &[members[0], (b"AAPL".as_slice(), b"AAPL.XNYS".as_slice())]
            ),
            "a member keyed to another instrument"
        );
    }

    #[rstest]
    fn universe_custody_seals_the_role_set_frame_and_binds_every_role_digest() {
        let verified = batch(complete_universe_rows());
        let requests = universe_requests(&verified);
        let frame = bind_strategy_input_universe_frame(&requests, &verified).unwrap();
        let declarations = universe_custody_declarations(&requests, &verified);

        let sealed =
            seal_strategy_input_universe_custody_v1(&custody_claim(), &declarations, &frame)
                .expect("complete universe custody");
        assert_eq!(sealed.frame(), &frame);
        assert_eq!(sealed.frame().values().len(), 4, "two members by two roles");
        assert_eq!(sealed.research_request_identity(), d(20));
        assert_eq!(sealed.strategy_design_identity(), d(21));
        assert_eq!(sealed.pit_request_identity(), d(1));
        assert_eq!(sealed.decision_cut(), 40);
        assert_eq!(sealed.observation_batch_digest(), d(5));
        // What a declaration stores is its own role's frame, never the role set's.
        for declaration in &declarations {
            assert_ne!(declaration.binding_digest, frame.digest());
        }
        // A member binding digest does not depend on the other roles, so the role-set frame
        // carries the same one each role's own frame does.
        for request in &requests {
            let own = bind_strategy_input_universe_frame(std::slice::from_ref(request), &verified)
                .unwrap();

            for value in own.values() {
                assert!(sealed.frame().values().iter().any(|sealed_value| {
                    sealed_value.input_role_identity() == value.input_role_identity()
                        && sealed_value.member_key() == value.member_key()
                        && sealed_value.binding_digest() == value.binding_digest()
                }));
            }
        }

        let mut reordered = custody_claim();
        reordered.input_role_identities.reverse();
        let replay = seal_strategy_input_universe_custody_v1(&reordered, &declarations, &frame)
            .expect("arrival order is not caller authority");
        assert_eq!(replay, sealed);

        let mut retampered = universe_custody_declarations(&requests, &verified);
        retampered[1].binding_digest = d(211);
        let moved = seal_strategy_input_universe_custody_v1(&custody_claim(), &retampered, &frame)
            .expect("a stored role digest is evidence, not authority");
        assert_ne!(moved.digest(), sealed.digest());
        assert_eq!(moved.claim_identity(), sealed.claim_identity());
    }

    #[rstest]
    fn universe_custody_refuses_an_exact_declaration_and_a_frame_over_other_roles() {
        let verified = batch(complete_universe_rows());
        let requests = universe_requests(&verified);
        let frame = bind_strategy_input_universe_frame(&requests, &verified).unwrap();

        let mut exact = requests.clone();
        exact[0].scope = UntrustedStrategyInputScope::ExactInstrument {
            instrument: "AAPL.XNAS".into(),
        };
        assert_eq!(
            seal_strategy_input_universe_custody_v1(
                &custody_claim(),
                &universe_custody_declarations(&requests, &verified)
                    .into_iter()
                    .zip(&exact)
                    .map(
                        |(declaration, request)| StrategyInputUniverseCustodyDeclarationV1 {
                            request,
                            ..declaration
                        }
                    )
                    .collect::<Vec<_>>(),
                &frame,
            ),
            Err(StrategyInputCustodyUnavailableV1::ScopeMismatch)
        );

        let one_role = bind_strategy_input_universe_frame(&requests[..1], &verified).unwrap();
        assert_eq!(
            seal_strategy_input_universe_custody_v1(
                &custody_claim(),
                &universe_custody_declarations(&requests, &verified),
                &one_role,
            ),
            Err(StrategyInputCustodyUnavailableV1::FrameUnavailable)
        );

        // As many values as the claim needs, but over another role: the count alone cannot tell.
        let mut other_role = requests.clone();
        other_role[1].input_role_identity = d(24);
        let other_role_frame = bind_strategy_input_universe_frame(&other_role, &verified).unwrap();
        assert_eq!(other_role_frame.values().len(), frame.values().len());
        assert_eq!(
            seal_strategy_input_universe_custody_v1(
                &custody_claim(),
                &universe_custody_declarations(&requests, &verified),
                &other_role_frame,
            ),
            Err(StrategyInputCustodyUnavailableV1::FrameUnavailable)
        );

        let mut other_selection = requests.clone();
        for request in &mut other_selection {
            request.scope = UntrustedStrategyInputScope::UniverseSelection {
                selection_identity: d(99),
            };
        }
        assert_eq!(
            seal_strategy_input_universe_custody_v1(
                &custody_claim(),
                &universe_custody_declarations(&requests, &verified)
                    .into_iter()
                    .zip(&other_selection)
                    .map(
                        |(declaration, request)| StrategyInputUniverseCustodyDeclarationV1 {
                            request,
                            ..declaration
                        }
                    )
                    .collect::<Vec<_>>(),
                &frame,
            ),
            Err(StrategyInputCustodyUnavailableV1::FrameUnavailable)
        );

        // The claim checks are the exact custody's, applied unchanged.
        let mut other_design = custody_claim();
        other_design.strategy_design_identity = d(91);
        assert_eq!(
            seal_strategy_input_universe_custody_v1(
                &other_design,
                &universe_custody_declarations(&requests, &verified),
                &frame,
            ),
            Err(StrategyInputCustodyUnavailableV1::DesignMismatch)
        );
    }

    #[rstest]
    fn persisted_custody_rejects_declarations_that_left_one_shared_lineage_cut() {
        let requests = custody_requests();
        let (bindings, frame) = custody_evidence(&requests);
        let mutations: &[fn(&mut UntrustedStrategyInputBindingRequest)] = &[
            |v| v.pit_request_digest = d(90),
            |v| *v.snapshot_identity_mut_for_test() = d(90),
            |v| *v.snapshot_fact_digest_mut_for_test() = d(90),
            |v| v.observation_batch_digest = d(90),
            |v| v.source_binding_identity = d(90),
            |v| v.source_frontier_digest = d(90),
            |v| v.correction_frontier_digest = d(90),
            |v| v.instrument_master_digest = d(90),
            |v| v.universe_selection_digest = d(90),
            |v| v.market_semantics_identity = d(90),
        ];

        for mutate in mutations {
            // The binding stays the Owner-derived positive; only the stored request drifts.
            let mut drifted = requests.clone();
            mutate(&mut drifted[1]);
            assert_eq!(
                seal_strategy_input_custody_v1(
                    &custody_claim(),
                    &custody_declarations(&drifted, &bindings),
                    &frame
                ),
                Err(StrategyInputCustodyUnavailableV1::LineageDrift)
            );
        }
    }

    #[rstest]
    fn persisted_custody_rejects_a_frame_from_another_observation_cut() {
        let requests = custody_requests();
        let (bindings, _) = custody_evidence(&requests);
        let drifted_batch = custody_batch().edit_for_test(|fields| fields.digest = d(90));
        let drifted_frame = bind_strategy_input_event_frame(&bindings, &drifted_batch)
            .expect("frame over the same rows");
        assert_eq!(
            seal_strategy_input_custody_v1(
                &custody_claim(),
                &custody_declarations(&requests, &bindings),
                &drifted_frame
            ),
            Err(StrategyInputCustodyUnavailableV1::LineageDrift)
        );
    }

    #[rstest]
    fn persisted_custody_rejects_a_frame_missing_one_re_derived_binding() {
        let requests = custody_requests();
        let (bindings, _) = custody_evidence(&requests);
        let verified = custody_batch();
        let partial =
            bind_strategy_input_event_frame(&bindings[..1], &verified).expect("single-role frame");
        assert_eq!(
            seal_strategy_input_custody_v1(
                &custody_claim(),
                &custody_declarations(&requests, &bindings),
                &partial
            ),
            Err(StrategyInputCustodyUnavailableV1::FrameUnavailable)
        );
    }

    #[rstest]
    fn persisted_custody_rejects_every_malformed_claim() {
        let requests = custody_requests();
        let (bindings, frame) = custody_evidence(&requests);
        let mutations: &[fn(&mut UntrustedStrategyInputCustodyClaimV1)] = &[
            |v| v.research_request_identity = BindingDigest::from_untrusted_bytes([0; 32]),
            |v| v.strategy_design_identity = BindingDigest::from_untrusted_bytes([0; 32]),
            |v| v.pit_request_identity = BindingDigest::from_untrusted_bytes([0; 32]),
            |v| v.decision_cut = 0,
            |v| v.input_role_identities = Vec::new(),
            |v| v.input_role_identities = vec![d(22), d(22)],
            |v| {
                v.input_role_identities
                    .push(BindingDigest::from_untrusted_bytes([0; 32]));
            },
            |v| {
                v.input_role_identities = (0..=MAX_STRATEGY_INPUT_CUSTODY_ROLES_V1)
                    .map(|ordinal| {
                        BindingDigest::from_untrusted_bytes(
                            [u8::try_from(ordinal % 251).expect("bounded") + 1; 32],
                        )
                    })
                    .collect();
            },
        ];

        for mutate in mutations {
            let mut claim = custody_claim();
            mutate(&mut claim);
            assert_eq!(
                canonical_strategy_input_custody_roles_v1(&claim),
                Err(StrategyInputCustodyUnavailableV1::InvalidClaim)
            );
            assert_eq!(
                seal_strategy_input_custody_v1(
                    &claim,
                    &custody_declarations(&requests, &bindings),
                    &frame
                ),
                Err(StrategyInputCustodyUnavailableV1::InvalidClaim)
            );
        }
        assert_eq!(
            canonical_strategy_input_custody_roles_v1(&custody_claim()),
            Ok(vec![d(22), d(23)])
        );
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

    /// One batch is one instant, and that is what makes a BAR series a sequence of frames.
    ///
    /// Nothing that resolves a member's role row filters it by event time, so a batch that also
    /// holds a later instant of the same role offers two exact rows and binds no frame at all. A
    /// window of several BAR instants is therefore several PIT batches and several frames, never
    /// one batch a consumer reads a series out of. Reading a series out of one batch would mean
    /// choosing between those rows, and choosing is what this binding exists to refuse.
    #[rstest]
    fn a_batch_holding_a_second_instant_of_one_role_binds_no_frame() {
        let rows = complete_universe_rows();
        let one_instant = batch(rows.clone());
        let requests = universe_requests(&one_instant);
        bind_strategy_input_universe_frame(&requests, &one_instant)
            .expect("one instant of each role binds one frame");

        let mut two_instants = rows.clone();

        for mut later in rows {
            later.event_effective += 60;
            later.provider_available += 60;
            later.retrieval += 60;
            later.correction_publication += 60;
            two_instants.push(later);
        }

        assert_eq!(
            bind_strategy_input_universe_frame(&requests, &batch(two_instants)),
            Err(StrategyInputBindingUnavailable::NonUniqueResolution)
        );
    }

    #[rstest]
    fn universe_frame_rejects_missing_duplicate_third_and_inconsistent_members() {
        for rows in [
            Vec::new(),
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

    /// One member is a universe of its own: a single-instrument strategy's selection, with an
    /// identity and digest no two-member selection shares, because the member count is part of
    /// what both are derived from.
    #[rstest]
    fn a_one_member_universe_is_a_selection_of_its_own() {
        let single = derive_universe_selection(&batch(vec![member_row(
            "AAPL.CLOSE",
            "AAPL",
            "AAPL.XNAS",
            "CLOSE",
        )]))
        .expect("a one-member selection");
        let pair = derive_universe_selection(&batch(vec![
            member_row("AAPL.CLOSE", "AAPL", "AAPL.XNAS", "CLOSE"),
            member_row("MSFT.CLOSE", "MSFT", "MSFT.XNAS", "CLOSE"),
        ]))
        .expect("a two-member selection");

        assert_eq!(single.members().len(), 1);
        assert_eq!(single.members()[0].instrument(), "AAPL.XNAS");
        assert_ne!(single.selection_identity(), pair.selection_identity());
        assert_ne!(single.selection_digest(), pair.selection_digest());
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

        let renewable_batch = first_batch.clone().edit_for_test(|fields| {
            *fields.snapshot_identity_mut_for_test() = d(80);
            *fields.fact_digest_mut_for_test() = d(81);
            fields.digest = d(82);
            fields.source_binding_identity = d(83);
            fields.source_binding_lineage_version += 1;
            fields.source_frontier_digest = d(84);
            fields.correction_frontier_digest = d(85);
            fields.time_evidence.decision_cut.value += 1;
            fields.observations[0].value_mantissa += 1;
        });
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

    fn hex(digest: BindingDigest) -> String {
        use std::fmt::Write as _;

        digest
            .as_bytes()
            .iter()
            .fold(String::new(), |mut hex, byte| {
                write!(hex, "{byte:02x}").expect("writing to a String succeeds");
                hex
            })
    }

    /// Every snapshot receipt keeps the bytes it had before a batch named its source: the
    /// universe selection, both trigger receipts, the universe frame, and a binding declaration's
    /// stored encoding and JSON wire. Pinned on the tree before the change.
    /// The scheduling receipt is pinned by `a_receipt_keeps_its_bytes`.
    #[rstest]
    fn the_snapshot_receipts_keep_their_bytes() {
        let universe = batch(complete_universe_rows());
        let selection = derive_universe_selection(&universe).unwrap();
        let universe_frame =
            bind_strategy_input_universe_frame(&universe_requests(&universe), &universe).unwrap();
        let event_frame = issue_frame(&custody_requests(), &custody_batch()).unwrap();
        let declaration = codec::encode_request_v1(&request()).unwrap();
        let wire = serde_json::to_vec(&request()).unwrap();
        let actual = [
            hex(selection.digest()),
            hex(universe_frame.trigger().digest()),
            hex(event_frame.trigger().digest()),
            hex(digest(&declaration)),
            hex(digest(&wire)),
            hex(universe_frame.digest()),
        ];
        assert_eq!(
            actual,
            [
                "7c63948250dd949ba3b60356db322d2a161ad0a0b05ad4fbe4e6bbe2dc18d375",
                "c9f42ddc247365c5eabc2c932d26261029fe9d524b29135fc71fbe64b7ce3db5",
                "4ab68f23db72f0fc83941209610216a65e6981cb42b8e50a0b28c05b5cb7a209",
                "ae6a3d889799dcca0e974d184386eb5f774d43288a7365ba0a30069dc1a7a1ea",
                "3968ec05e1c79634a7505b7b3d8b799a1f6636448e253fd1ae4128f2b66ac36b",
                "7039451abbc48363586cec19aca8540b096338e786d42a8bd0cc5483cd0af755",
            ]
        );
    }

    fn custody_view() -> StrategyInputBatchSourceV1 {
        StrategyInputBatchSourceV1::CustodyView {
            chain_root: d(60),
            view_identity: d(61),
            event_ns: 10,
            decision_cut_ns: 40,
            derived_frontier_digest: d(62),
        }
    }

    /// `verified` read as one frame's custody view rather than a committed snapshot.
    fn as_custody_view(verified: VerifiedPitObservationBatch) -> VerifiedPitObservationBatch {
        verified.edit_for_test(|fields| {
            fields.source = PitObservationBatchSourceV1::CustodyView {
                chain_root: d(60),
                view_identity: d(61),
                event_ns: 10,
                decision_cut_ns: 40,
                derived_frontier_digest: d(62),
            };
        })
    }

    fn with_custody_view(
        mut requests: Vec<UntrustedStrategyInputBindingRequest>,
    ) -> Vec<UntrustedStrategyInputBindingRequest> {
        for request in &mut requests {
            request.source = custody_view();
        }
        requests
    }

    /// A custody view's receipts are sealed under domains of their own over the view's coordinates,
    /// so none shares a preimage with a snapshot receipt. Pinned when they were first sealed.
    #[rstest]
    fn the_custody_view_receipts_have_their_own_domains_and_bytes() {
        let universe = as_custody_view(batch(complete_universe_rows()));
        let selection = derive_universe_selection(&universe).unwrap();
        let universe_frame = bind_strategy_input_universe_frame(
            &with_custody_view(universe_requests(&universe).to_vec()),
            &universe,
        )
        .unwrap();
        let event_frame = issue_frame(
            &with_custody_view(custody_requests().to_vec()),
            &as_custody_view(custody_batch()),
        )
        .unwrap();
        let actual = [
            hex(selection.digest()),
            hex(universe_frame.trigger().digest()),
            hex(event_frame.trigger().digest()),
        ];
        let snapshot = batch(complete_universe_rows());
        assert_ne!(
            selection.digest(),
            derive_universe_selection(&snapshot).unwrap().digest()
        );
        assert_eq!(universe_frame.trigger().source(), universe.source());
        assert_eq!(actual, PINNED_CUSTODY_RECEIPTS);
    }

    /// A binding request naming a snapshot binds no custody view, and the reverse.
    #[rstest]
    fn a_request_binds_only_the_source_it_names() {
        let custody = as_custody_view(custody_batch());
        assert_eq!(
            issue_frame(&custody_requests(), &custody),
            Err(StrategyInputBindingUnavailable::StaleBatch)
        );
        assert_eq!(
            issue_frame(
                &with_custody_view(custody_requests().to_vec()),
                &custody_batch()
            ),
            Err(StrategyInputBindingUnavailable::StaleBatch)
        );
    }

    /// A quote cut is read by no strategy input: it names no binding source and derives no
    /// universe selection.
    #[rstest]
    fn a_quote_cut_batch_binds_no_strategy_input() {
        let quote_cut = batch(complete_universe_rows()).edit_for_test(|fields| {
            fields.source = PitObservationBatchSourceV1::CustodyQuoteCut {
                chain_root: d(60),
                quote_cut_identity: d(63),
                instant_ns: 41,
                derivation: crate::owner::pit_window_custody_v1::QuoteDerivationV1::ObservedBbo,
            };
        });
        assert_eq!(quote_cut.binding_request_source_v1(), None);
        assert_eq!(
            derive_universe_selection(&quote_cut).map(|selection| selection.digest()),
            Err(StrategyInputBindingUnavailable::StaleBatch)
        );
    }

    /// A custody view request crosses JSON as one field beside the snapshot's two, which it never
    /// states; a request naming both sources, or neither, is refused. A declaration stores one under
    /// its own codec version and decodes it back exactly (T0-10).
    #[rstest]
    fn a_custody_view_request_has_its_own_wire_and_storage() {
        let mut custody = request();
        custody.source = custody_view();
        let value = serde_json::to_value(&custody).unwrap();
        let object = value.as_object().unwrap();
        assert!(object.contains_key("custody_view"));
        assert!(!object.contains_key("snapshot_identity"));
        assert!(!object.contains_key("snapshot_fact_digest"));
        assert_eq!(
            serde_json::from_value::<UntrustedStrategyInputBindingRequest>(value.clone()).unwrap(),
            custody
        );
        assert!(
            !serde_json::to_value(request())
                .unwrap()
                .as_object()
                .unwrap()
                .contains_key("custody_view")
        );

        let mut both = value.clone();
        let snapshot_wire = serde_json::to_value(request()).unwrap();
        both["snapshot_identity"] = snapshot_wire["snapshot_identity"].clone();
        both["snapshot_fact_digest"] = snapshot_wire["snapshot_fact_digest"].clone();
        assert!(serde_json::from_value::<UntrustedStrategyInputBindingRequest>(both).is_err());

        let mut neither = value;
        neither.as_object_mut().unwrap().remove("custody_view");
        assert!(serde_json::from_value::<UntrustedStrategyInputBindingRequest>(neither).is_err());

        let stored = codec::encode_request_v1(&custody).unwrap();
        assert_eq!(codec::decode_request_v1(&stored), Ok(custody));
        assert_ne!(stored, codec::encode_request_v1(&request()).unwrap());
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

    /// The one exact-instrument value a single row yields at the market value scale.
    fn value_at_market_scale(
        mantissa: i128,
        scale: u8,
    ) -> Result<
        (StrategyInputEventValueReceipt, VerifiedPitObservation),
        StrategyInputBindingUnavailable,
    > {
        let mut source = row("AAPL.CLOSE", "AAPL.XNAS", "1M");
        source.value_mantissa = mantissa;
        source.value_scale = scale;
        let verified = batch(vec![source.clone()]);
        let mut role = request();
        role.scale = MARKET_DATA_VALUE_SCALE_V1;
        let frame = issue_frame(&[role], &verified)?;
        let [value] = &*frame.values else {
            return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
        };
        Ok((value.clone(), source))
    }

    /// BTCUSDT's 2021 close 37244.36 arrives at scale 2 and is stated exactly at the role's scale 9,
    /// while the receipt still names the row as its source stated it.
    #[rstest]
    fn a_coarser_row_is_stated_exactly_at_the_role_scale() {
        let (value, source) =
            value_at_market_scale(3_724_436, 2).expect("37244.36 binds at scale 9");

        assert_eq!(value.value_scale(), 9);
        assert_eq!(
            i128::from_le_bytes(*value.value_bytes()),
            37_244_360_000_000
        );
        assert_eq!(
            value.canonical_row_digest(),
            canonical_row_digest_for_test(&source)
        );
    }

    /// A row already at the role's scale keeps its exact mantissa bytes.
    #[rstest]
    fn a_row_at_the_role_scale_keeps_its_bytes() {
        let (value, _) =
            value_at_market_scale(37_244_360_000_001, 9).expect("a scale 9 row binds at scale 9");

        assert_eq!(value.value_scale(), 9);
        assert_eq!(value.value_bytes(), &37_244_360_000_001_i128.to_le_bytes());
    }

    /// A tenth decimal is dropped only when it is zero; otherwise the row is refused by name rather
    /// than rounded, and a restatement that does not fit is refused by its own name.
    #[rstest]
    #[case::tenth_decimal_zero(372_443_600_000_000, 10, Ok(37_244_360_000_000))]
    #[case::tenth_decimal_nonzero(
        372_443_600_000_001,
        10,
        Err(StrategyInputBindingUnavailable::ValueFinerThanRoleScale)
    )]
    #[case::overflow(
        i128::MAX / 10,
        0,
        Err(StrategyInputBindingUnavailable::ValueOverflowsRoleScale)
    )]
    fn a_row_is_stated_at_the_role_scale_only_exactly(
        #[case] mantissa: i128,
        #[case] scale: u8,
        #[case] expected: Result<i128, StrategyInputBindingUnavailable>,
    ) {
        assert_eq!(
            value_at_market_scale(mantissa, scale)
                .map(|(value, _)| i128::from_le_bytes(*value.value_bytes())),
            expected
        );
    }

    /// Scale never picks a row: a row too fine for the role beside one that aligns leaves two
    /// candidates, which is not unique, rather than silently binding the one that aligns.
    #[rstest]
    fn rows_differing_only_in_scale_are_not_unique() {
        let mut coarser = row("AAPL.CLOSE", "AAPL.XNAS", "1M");
        coarser.value_mantissa = 3_724_436;
        coarser.value_scale = 2;
        let mut finer = coarser.clone();
        finer.symbolic_key = "AAPL.CLOSE.FINE".into();
        finer.value_mantissa = 372_443_600_000_001;
        finer.value_scale = 10;
        let verified = batch(vec![coarser, finer]);
        let mut role = request();
        role.scale = MARKET_DATA_VALUE_SCALE_V1;

        assert_eq!(
            bind_strategy_input_role(&role, &verified),
            Err(StrategyInputBindingUnavailable::NonUniqueResolution)
        );
    }

    /// Universe-member values are stated at the role's scale exactly as exact-instrument ones are.
    #[rstest]
    fn universe_member_values_are_stated_at_the_role_scale() {
        let verified = batch(complete_universe_rows());
        let requests = universe_requests(&verified).map(|mut role| {
            role.scale = MARKET_DATA_VALUE_SCALE_V1;
            role
        });

        let frame = bind_strategy_input_universe_frame(&requests, &verified)
            .expect("scale 2 rows bind at scale 9");

        assert!(!frame.values.is_empty());
        for value in &frame.values {
            assert_eq!(value.value_scale(), 9);
            let expected = if value.member_key() == "AAPL" {
                12_345
            } else {
                43_210
            };
            assert_eq!(
                i128::from_le_bytes(*value.value_bytes()),
                expected * 10_i128.pow(7)
            );
        }
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
        let mut coarser_role = request();
        coarser_role.scale = 1;
        assert_eq!(
            bind_strategy_input_role(&coarser_role, &verified),
            Err(StrategyInputBindingUnavailable::ValueFinerThanRoleScale)
        );

        let mutations: &[fn(&mut UntrustedStrategyInputBindingRequest)] = &[
            |v| v.pit_request_identity = d(31),
            |v| v.pit_request_digest = d(32),
            |v| *v.snapshot_identity_mut_for_test() = d(33),
            |v| *v.snapshot_fact_digest_mut_for_test() = d(34),
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
        let next_batch = batch(vec![next_row]).edit_for_test(|fields| {
            fields.request_identity = d(72);
            fields.request_digest = d(73);
            *fields.snapshot_identity_mut_for_test() = d(74);
            *fields.fact_digest_mut_for_test() = d(75);
            fields.source_binding_identity = d(76);
            fields.source_binding_lineage_version = 2;
            fields.source_frontier_digest = d(70);
            fields.correction_frontier_digest = d(71);
            fields.instrument_master_digest = d(77);
            fields.universe_selection_digest = d(78);
            fields.digest = d(79);
        });
        let mut next_request = first_request;
        next_request.pit_request_identity = next_batch.request_identity();
        next_request.pit_request_digest = next_batch.request_digest();
        *next_request.snapshot_identity_mut_for_test() = next_batch.snapshot_identity_for_test();
        *next_request.snapshot_fact_digest_mut_for_test() = next_batch.fact_digest_for_test();
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
