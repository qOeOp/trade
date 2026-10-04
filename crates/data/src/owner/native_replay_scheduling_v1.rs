//! Owner-sealed native scheduling projection for one Replay frame over one or two members.
//!
//! The projection consumes the frame's verified PIT batch, the verified batch of its quote cut and
//! one move-only BAR schedule readback per member. It emits each member's complete BAR at the
//! frame's instant followed by each member's complete Quote at the quote cut's instant, both in
//! member order. Callers cannot supply prices, quantities, event order, or timestamps.

use std::collections::BTreeMap;

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_model::{
    data::{Bar, BarSpecification, BarType, Data, QuoteTick},
    enums::{AggregationSource, BarAggregation, PriceType},
    identifiers::InstrumentId,
    types::{
        fixed::mantissa_exponent_to_fixed_i128,
        price::{Price, PriceRaw},
        quantity::{Quantity, QuantityRaw},
    },
};

use super::{
    ADMITTED_UNIVERSE_MEMBER_COUNTS,
    bar_schedule::{
        BarScheduleClockV1, BarScheduleCompletionV1, BarScheduleFactV1, BarScheduleKindV1,
        BarScheduleLabelV1, BarScheduleReadbackV1, BarScheduleUnitV1,
        UntrustedBarScheduleLocatorV1,
    },
    declared_bar_timeframe_v1::{DeclaredBarAnchorV1, DeclaredBarTimeframeV1, anchor_identity_v1},
    native_replay_quote_cut_v2::{NativeReplayCutCoordinatesV2, verify_native_replay_quote_cut_v2},
    pit_snapshot::{
        UntrustedPitSnapshotLocator, UntrustedPitSnapshotTimeEvidence, VerifiedPitObservation,
        VerifiedPitObservationBatch,
    },
    pit_window_custody_v1::{
        PitObservationBatchSourceV1, QuoteDerivationV1, UntrustedPitWindowCustodyFrameV1,
        quote_cut::custody_quote_cut_bound_v1,
        schedule::{PitWindowScheduleFactV1, window_schedule_admits_frame_v1},
    },
    source_binding::BindingDigest,
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        StrategyInputUniverseFrameReceipt, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputScope, bind_strategy_input_universe_frame,
    },
};

const RECEIPT_DOMAIN_V1: &[u8] = b"market-data.native-replay-scheduling-readback.v1\0";
/// The receipt of a frame sealed from a custody view: its own domain, so it never shares a
/// preimage with a snapshot frame's.
const CUSTODY_RECEIPT_DOMAIN_V1: &[u8] =
    b"market-data.native-replay-scheduling-readback.custody.v1\0";
const BAR_FIELDS: [&str; 5] = ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"];
const QUOTE_FIELDS: [&str; 4] = ["BID_PRICE", "ASK_PRICE", "BID_SIZE", "ASK_SIZE"];

/// Move-only Market Data authority for the exact native scheduling values of one Replay request.
#[derive(Debug)]
pub struct NativeReplaySchedulingReadbackV1 {
    observation_batch_digest: BindingDigest,
    quote_cut: NativeReplayQuoteCutReadbackV1,
    bar_schedule_digests: Vec<BindingDigest>,
    member_instruments: Vec<InstrumentId>,
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
    bar_types: Vec<BarType>,
    data: Vec<Data>,
    receipt_digest: BindingDigest,
}

impl NativeReplaySchedulingReadbackV1 {
    #[must_use]
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }

    /// The quote cut this frame's Quotes were read from.
    #[must_use]
    pub const fn quote_cut(&self) -> &NativeReplayQuoteCutReadbackV1 {
        &self.quote_cut
    }

    /// One schedule digest per member, in member order.
    #[must_use]
    pub fn bar_schedule_digests(&self) -> Vec<BindingDigest> {
        self.bar_schedule_digests.clone()
    }

    /// The universe's one or two members, in canonical order.
    #[must_use]
    pub fn member_instruments(&self) -> Vec<InstrumentId> {
        self.member_instruments.clone()
    }

    #[must_use]
    pub const fn frame_time_ns(&self) -> u64 {
        self.frame_time_ns
    }

    #[must_use]
    pub const fn window_end_ns_exclusive(&self) -> u64 {
        self.window_end_ns_exclusive
    }

    #[must_use]
    pub const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }

    /// Consumes the authority and releases the already-fixed native schedule to its bundle.
    #[must_use]
    pub fn into_native_schedule(self) -> (Vec<BarType>, Vec<Data>) {
        (self.bar_types, self.data)
    }
}

/// The Owner coordinates of the quote cut one frame took its Quotes from.
///
/// A PIT snapshot is one instant, so the Quotes that follow a snapshot frame's BAR sit in a
/// snapshot of their own; a custody frame's sit in a quote cut derived from its custody. These are
/// that quote cut's source, verified batch and instant; every member's Quote carries that instant
/// as both its event and its initialization time.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NativeReplayQuoteCutReadbackV1 {
    source: PitObservationBatchSourceV1,
    observation_batch_digest: BindingDigest,
    instant_ns: u64,
}

impl NativeReplayQuoteCutReadbackV1 {
    /// A quote cut readback written by hand, for tests of what is built on one.
    #[cfg(test)]
    pub(crate) const fn for_test(
        snapshot_identity: BindingDigest,
        snapshot_fact_digest: BindingDigest,
        observation_batch_digest: BindingDigest,
        instant_ns: u64,
    ) -> Self {
        Self {
            source: PitObservationBatchSourceV1::CommittedSnapshot {
                snapshot_identity,
                fact_digest: snapshot_fact_digest,
            },
            observation_batch_digest,
            instant_ns,
        }
    }

    /// The quote cut's source: a committed snapshot, or a quote cut derived from custody.
    #[must_use]
    pub const fn source(&self) -> PitObservationBatchSourceV1 {
        self.source
    }

    /// `(snapshot identity, fact digest)` of a quote cut that is a committed snapshot.
    pub(crate) const fn committed_snapshot(&self) -> Option<(BindingDigest, BindingDigest)> {
        match self.source {
            PitObservationBatchSourceV1::CommittedSnapshot {
                snapshot_identity,
                fact_digest,
            } => Some((snapshot_identity, fact_digest)),
            _ => None,
        }
    }

    #[must_use]
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }

    #[must_use]
    pub const fn instant_ns(&self) -> u64 {
        self.instant_ns
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum NativeReplaySchedulingErrorV1 {
    #[error("native Replay scheduling Owner readback is unavailable")]
    OwnerReadbackUnavailable,
    /// A member has no admitted BAR schedule cut at the frame.
    ///
    /// The candidates were read; none is this member's at this frame. A read that failed is
    /// `OwnerReadbackUnavailable` instead, so this one states a fact about Market Data custody:
    /// until a schedule for the member at the frame is committed, no retry changes the answer.
    #[error("a member has no admitted BAR schedule at the frame")]
    NoBarScheduleAtFrame,
    #[error("native Replay scheduling Owner bindings mismatch")]
    OwnerBindingMismatch,
    #[error("native Replay scheduling field census is incomplete or ambiguous")]
    FieldCensusMismatch,
    #[error("native Replay scheduling event order is unavailable")]
    EventOrderUnavailable,
    #[error("a Design with exact-instrument roles does not run under an Owner universe")]
    ExactInstrumentRolesUnderOwnerUniverse,
    #[error("native Replay scheduling value is not exactly representable")]
    NativeRepresentation,
    #[error("the frame's Source Binding declares no bar timeframe")]
    SourceBindingDeclaresNoBarTimeframe,
    #[error("no schedule, role or row states the bar the frame's Source Binding declares")]
    DeclaredBarTimeframeMismatch,
    /// The Replay names another Universe Selection Record than the one the frame's batch binds.
    ///
    /// A request names two different universe selections, and each is checked against the same
    /// verified batch. The strategy-input selection is the one the Plan was bound under: the
    /// frame's own universe, derived from the batch's rows, is required to be it. The Universe
    /// Selection Record is the one the Replay's composition depends on: the intake admitted the
    /// batch's snapshot only for the Record whose identity its submission names, so the batch's
    /// `universe_selection_digest` is that Record and is required to be the Replay's. No Record is
    /// read to compare them, because the batch already joins the two: its rows are what the
    /// selection is derived from, and its Record digest was checked at intake.
    #[error("the Replay names another Universe Selection Record than the frame's batch binds")]
    UniverseSelectionRecordMismatch,
    /// `EXECUTION_ROLE_ABSENT`: no role reads the BAR close, so no role executes and prices.
    #[error("no role of the request reads the BAR close")]
    ExecutionRoleAbsent,
    /// `EXECUTION_ROLE_AMBIGUOUS`: more than one role reads the BAR close.
    #[error("more than one role of the request reads the BAR close")]
    ExecutionRoleAmbiguous,
    /// `MORE_THAN_ONE_ROLE_TIMEFRAME`: a BAR role reads another timeframe than the execution role.
    /// A role's timeframe is resolved at the frame only as the execution role's is, until roles of
    /// several timeframes each resolve their own last close.
    #[error("a BAR role reads another timeframe than the execution role")]
    MoreThanOneRoleTimeframe,
    /// `EXECUTION_TIMEFRAME_NOT_DECLARED`: the frame's Source Binding declares no bar for the
    /// execution role's timeframe label, so the label cannot be typed.
    #[error("the frame's Source Binding declares no bar for the execution role's timeframe")]
    ExecutionTimeframeNotDeclared,
    /// A custody frame pins no head of the chain it names, or names no chain.
    #[error("the custody frame's head is not in the chain it names")]
    PitWindowHeadNotInChain,
    /// `PIT_WINDOW_FRAME_NOT_COVERED`: the frame's view has no complete cross-section, or its
    /// decision cut does not precede the next frame.
    #[error("the custody frame is not covered")]
    PitWindowFrameNotCovered,
    /// A snapshot frame asked of the custody read, or a custody frame of the snapshot read.
    #[error("the frame's source is not the one this read resolves")]
    FrameSourceMismatch,
}

/// Untrusted coordinates for resolving one exact native Replay scheduling projection.
///
/// Construction grants no storage authority. The sealed Market Data resolver verifies every PIT
/// and BAR schedule coordinate before it can issue a native scheduling readback.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedNativeReplaySchedulingRequestV1 {
    pit_locator: UntrustedPitSnapshotLocator,
    schedule_locators: Vec<UntrustedBarScheduleLocatorV1>,
    member_instruments: Vec<InstrumentId>,
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
}

/// The scope a Plan declared for one role.
///
/// An Owner universe answers `UniverseMembers` roles only. A Design whose roles name one exact
/// instrument does not run under it: the Market Data read refuses it with
/// `ExactInstrumentRolesUnderOwnerUniverse`, as the R&D side does, rather than quietly reading the
/// universe in the instrument's place.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeReplayRoleScopeV1 {
    UniverseMembers,
    ExactInstrument,
}

/// One Plan-declared universe role carried into the fixed initial-composition Owner read.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeReplayInitialUniverseRoleV1 {
    declared_scope: NativeReplayRoleScopeV1,
    input_role_identity: BindingDigest,
    field_semantic: MarketDataFieldSemantic,
    channel: StrategyInputChannel,
    timeframe: String,
    unit: StrategyInputUnit,
    scale: u8,
}

impl NativeReplayInitialUniverseRoleV1 {
    #[must_use]
    pub fn new(
        input_role_identity: BindingDigest,
        field_semantic: MarketDataFieldSemantic,
        channel: StrategyInputChannel,
        timeframe: String,
        unit: StrategyInputUnit,
        scale: u8,
    ) -> Self {
        Self {
            declared_scope: NativeReplayRoleScopeV1::UniverseMembers,
            input_role_identity,
            field_semantic,
            channel,
            timeframe,
            unit,
            scale,
        }
    }

    /// The same role with the scope its Plan declared. [`Self::new`] builds a `UniverseMembers`
    /// role; a caller carrying a Plan's roles through unfiltered states each role's own scope here.
    #[must_use]
    pub const fn with_declared_scope(mut self, declared_scope: NativeReplayRoleScopeV1) -> Self {
        self.declared_scope = declared_scope;
        self
    }
}

/// Where one frame of a native Replay is read from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeReplayFrameSourceV1 {
    /// A committed PIT snapshot.
    Snapshot {
        snapshot_identity: BindingDigest,
        snapshot_fact_digest: BindingDigest,
    },
    /// One frame of a run over a PIT window custody chain, at the head the run's frames were read
    /// from.
    CustodyFrame(UntrustedPitWindowCustodyFrameV1),
}

/// Bounded request for reconstructing the initial universe frame and one BAR schedule per member.
///
/// Every Owner coordinate absent from this type is derived from the verified PIT batch. The two
/// schedule locators and the account scope are deliberately not caller inputs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeReplayInitialMarketRequestV1 {
    frame_source: NativeReplayFrameSourceV1,
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    /// The strategy-input universe selection the Plan was bound under, derived from a batch's
    /// rows (`derive_universe_selection`).
    universe_selection_identity: BindingDigest,
    universe_selection_digest: BindingDigest,
    /// The Universe Selection Record the Replay's composition depends on. Its identity is also its
    /// digest.
    universe_selection_record_identity: BindingDigest,
    universe_selection_record_digest: BindingDigest,
    instrument_master_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    market_semantics_identity: BindingDigest,
    roles: Vec<NativeReplayInitialUniverseRoleV1>,
    member_instruments: Vec<InstrumentId>,
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
}

impl NativeReplayInitialMarketRequestV1 {
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn new(
        snapshot_identity: BindingDigest,
        snapshot_fact_digest: BindingDigest,
        research_request_identity: BindingDigest,
        strategy_design_identity: BindingDigest,
        universe_selection_identity: BindingDigest,
        universe_selection_digest: BindingDigest,
        universe_selection_record_identity: BindingDigest,
        universe_selection_record_digest: BindingDigest,
        instrument_master_digest: BindingDigest,
        source_binding_lineage_root: BindingDigest,
        market_semantics_identity: BindingDigest,
        roles: Vec<NativeReplayInitialUniverseRoleV1>,
        member_instruments: Vec<InstrumentId>,
        frame_time_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Self {
        Self {
            frame_source: NativeReplayFrameSourceV1::Snapshot {
                snapshot_identity,
                snapshot_fact_digest,
            },
            research_request_identity,
            strategy_design_identity,
            universe_selection_identity,
            universe_selection_digest,
            universe_selection_record_identity,
            universe_selection_record_digest,
            instrument_master_digest,
            source_binding_lineage_root,
            market_semantics_identity,
            roles,
            member_instruments,
            frame_time_ns,
            window_end_ns_exclusive,
        }
    }

    /// Derives the same request for another frame of the same window.
    ///
    /// Only what a census row supplies moves: which PIT cut the frame is, and the instant it sits
    /// at. Everything the window fixes once - the universe, the roles, the members, where the
    /// window ends - is carried over rather than re-supplied, so a caller resolving a sequence
    /// cannot quietly resolve two different requests and call the result one sequence.
    #[must_use]
    pub fn for_frame(
        &self,
        snapshot_identity: BindingDigest,
        snapshot_fact_digest: BindingDigest,
        frame_time_ns: u64,
    ) -> Self {
        Self {
            frame_source: NativeReplayFrameSourceV1::Snapshot {
                snapshot_identity,
                snapshot_fact_digest,
            },
            research_request_identity: self.research_request_identity,
            strategy_design_identity: self.strategy_design_identity,
            universe_selection_identity: self.universe_selection_identity,
            universe_selection_digest: self.universe_selection_digest,
            universe_selection_record_identity: self.universe_selection_record_identity,
            universe_selection_record_digest: self.universe_selection_record_digest,
            instrument_master_digest: self.instrument_master_digest,
            source_binding_lineage_root: self.source_binding_lineage_root,
            market_semantics_identity: self.market_semantics_identity,
            roles: self.roles.clone(),
            member_instruments: self.member_instruments.clone(),
            frame_time_ns,
            window_end_ns_exclusive: self.window_end_ns_exclusive,
        }
    }

    /// A request for one frame of a custody run, resolved through the custody read: the frame's
    /// event is the custody frame's `e_k`, and `window_end_ns_exclusive` the run's end, which
    /// bounds the last frame's quote cut.
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn for_custody_frame(
        frame: UntrustedPitWindowCustodyFrameV1,
        research_request_identity: BindingDigest,
        strategy_design_identity: BindingDigest,
        universe_selection_identity: BindingDigest,
        universe_selection_digest: BindingDigest,
        universe_selection_record_identity: BindingDigest,
        universe_selection_record_digest: BindingDigest,
        instrument_master_digest: BindingDigest,
        source_binding_lineage_root: BindingDigest,
        market_semantics_identity: BindingDigest,
        roles: Vec<NativeReplayInitialUniverseRoleV1>,
        member_instruments: Vec<InstrumentId>,
        run_end_ns_exclusive: u64,
    ) -> Self {
        Self {
            frame_source: NativeReplayFrameSourceV1::CustodyFrame(frame),
            research_request_identity,
            strategy_design_identity,
            universe_selection_identity,
            universe_selection_digest,
            universe_selection_record_identity,
            universe_selection_record_digest,
            instrument_master_digest,
            source_binding_lineage_root,
            market_semantics_identity,
            roles,
            member_instruments,
            frame_time_ns: frame.event_ns,
            window_end_ns_exclusive: run_end_ns_exclusive,
        }
    }

    /// The same custody request for another frame of the same run, at the same pinned head;
    /// `None` for a snapshot request.
    #[must_use]
    pub fn for_custody_event(&self, event_ns: u64) -> Option<Self> {
        let NativeReplayFrameSourceV1::CustodyFrame(frame) = self.frame_source else {
            return None;
        };
        Some(Self {
            frame_source: NativeReplayFrameSourceV1::CustodyFrame(
                UntrustedPitWindowCustodyFrameV1 { event_ns, ..frame },
            ),
            frame_time_ns: event_ns,
            ..self.clone()
        })
    }

    /// What the frame is read from: a committed snapshot or one frame of a custody run.
    #[must_use]
    pub const fn frame_source(&self) -> NativeReplayFrameSourceV1 {
        self.frame_source
    }

    /// `(snapshot identity, fact digest)` of a snapshot request.
    ///
    /// # Errors
    ///
    /// [`NativeReplaySchedulingErrorV1::FrameSourceMismatch`] for a custody frame request.
    pub(crate) const fn snapshot_source(
        &self,
    ) -> Result<(BindingDigest, BindingDigest), NativeReplaySchedulingErrorV1> {
        match self.frame_source {
            NativeReplayFrameSourceV1::Snapshot {
                snapshot_identity,
                snapshot_fact_digest,
            } => Ok((snapshot_identity, snapshot_fact_digest)),
            NativeReplayFrameSourceV1::CustodyFrame(_) => {
                Err(NativeReplaySchedulingErrorV1::FrameSourceMismatch)
            }
        }
    }

    /// The custody frame of a custody request.
    ///
    /// # Errors
    ///
    /// [`NativeReplaySchedulingErrorV1::FrameSourceMismatch`] for a snapshot request.
    pub(crate) const fn custody_frame(
        &self,
    ) -> Result<UntrustedPitWindowCustodyFrameV1, NativeReplaySchedulingErrorV1> {
        match self.frame_source {
            NativeReplayFrameSourceV1::CustodyFrame(frame) => Ok(frame),
            NativeReplayFrameSourceV1::Snapshot { .. } => {
                Err(NativeReplaySchedulingErrorV1::FrameSourceMismatch)
            }
        }
    }

    #[must_use]
    pub fn member_instruments(&self) -> Vec<InstrumentId> {
        self.member_instruments.clone()
    }

    #[must_use]
    pub const fn frame_time_ns(&self) -> u64 {
        self.frame_time_ns
    }

    #[must_use]
    pub const fn window_end_ns_exclusive(&self) -> u64 {
        self.window_end_ns_exclusive
    }

    /// The timeframe label of the request's execution role, the one every BAR role must read.
    ///
    /// The execution role is the one `execution_role_semantic_id_v1` derives, Strategy Factory's
    /// rule for the role that executes and prices a Design: a universe Design declares no join, so
    /// it is the one role reading the BAR close. The label is provenance until the frame's Source
    /// Binding types it.
    ///
    /// # Errors
    ///
    /// [`NativeReplaySchedulingErrorV1::ExecutionRoleAbsent`] when no role reads the close,
    /// [`NativeReplaySchedulingErrorV1::ExecutionRoleAmbiguous`] when several do, and
    /// [`NativeReplaySchedulingErrorV1::MoreThanOneRoleTimeframe`] when a BAR role reads another
    /// label.
    pub fn execution_timeframe(&self) -> Result<&str, NativeReplaySchedulingErrorV1> {
        use super::declared_bar_timeframe_v1::{
            ExecutionWindowErrorV1, execution_role_semantic_id_v1,
        };

        let identities = self
            .roles
            .iter()
            .map(|role| {
                role.input_role_identity.as_bytes().iter().fold(
                    String::with_capacity(64),
                    |mut text, byte| {
                        use std::fmt::Write as _;
                        let _ = write!(text, "{byte:02x}");
                        text
                    },
                )
            })
            .collect::<Vec<_>>();
        let execution = match execution_role_semantic_id_v1(
            identities
                .iter()
                .zip(&self.roles)
                .map(|(identity, role)| (identity.as_str(), role.field_semantic.identity())),
            std::iter::empty(),
        ) {
            Ok(execution) => execution,
            Err(ExecutionWindowErrorV1::ExecutionRoleAmbiguous) => {
                return Err(NativeReplaySchedulingErrorV1::ExecutionRoleAmbiguous);
            }
            // Neither reads a Design's roles: a join-triggered or no-join execution role never
            // declares a bar or claims an R0 window itself, so this call never produces them. The
            // match is still exhaustive, so a third cause `execution_role_semantic_id_v1` gains
            // for `ExecutionRoleAmbiguous` must be named here rather than silently absorbed into
            // it by a bare `.map_err(|_| ...)`.
            Err(ExecutionWindowErrorV1::ExecutionTimeframeNotDeclared) => {
                return Err(NativeReplaySchedulingErrorV1::ExecutionRoleAmbiguous);
            }
            Err(ExecutionWindowErrorV1::ExecutionBarExceedsR0Window) => {
                return Err(NativeReplaySchedulingErrorV1::ExecutionRoleAmbiguous);
            }
        }
        .ok_or(NativeReplaySchedulingErrorV1::ExecutionRoleAbsent)?;
        let label = identities
            .iter()
            .zip(&self.roles)
            .find(|(identity, _)| identity.as_str() == execution)
            .map(|(_, role)| role.timeframe.as_str())
            .ok_or(NativeReplaySchedulingErrorV1::ExecutionRoleAbsent)?;

        if self
            .roles
            .iter()
            .any(|role| role.field_semantic.data_kind() == "BAR" && role.timeframe != label)
        {
            return Err(NativeReplaySchedulingErrorV1::MoreThanOneRoleTimeframe);
        }
        Ok(label)
    }
}

/// Move-only Market Data readback retained through binding or consumer-side native materialization.
#[derive(Debug)]
pub struct NativeReplayInitialMarketReadbackV1 {
    batch: VerifiedPitObservationBatch,
    /// The committed snapshot the batch is of, as issuance checked it against the request.
    snapshot: (BindingDigest, BindingDigest),
    quote_cut: VerifiedPitObservationBatch,
    universe_frame: StrategyInputUniverseFrameReceipt,
    schedules: Vec<BarScheduleReadbackV1>,
    declared: DeclaredBarTimeframeV1,
    member_instruments: Vec<InstrumentId>,
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
}

/// Move-only Market Data evidence for one category-exact repair request.
///
/// This projection contains only immutable Owner coordinates. It exposes neither normalized
/// observation rows nor a Market Data mutation port.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct MarketDataRepairSourceV1 {
    pit_request_identity: BindingDigest,
    pit_request_digest: BindingDigest,
    correlation_identity: BindingDigest,
    pit_snapshot_identity: BindingDigest,
    pit_snapshot_fact_digest: BindingDigest,
    instrument_scope_digest: BindingDigest,
    source_binding_identity: BindingDigest,
    source_binding_fact_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    source_frontier_digest: BindingDigest,
    correction_frontier_digest: BindingDigest,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    time_evidence: UntrustedPitSnapshotTimeEvidence,
}

impl MarketDataRepairSourceV1 {
    #[must_use]
    pub const fn pit_request_identity(&self) -> BindingDigest {
        self.pit_request_identity
    }

    #[must_use]
    pub const fn pit_request_digest(&self) -> BindingDigest {
        self.pit_request_digest
    }

    #[must_use]
    pub const fn correlation_identity(&self) -> BindingDigest {
        self.correlation_identity
    }

    #[must_use]
    pub const fn pit_snapshot_identity(&self) -> BindingDigest {
        self.pit_snapshot_identity
    }

    #[must_use]
    pub const fn pit_snapshot_fact_digest(&self) -> BindingDigest {
        self.pit_snapshot_fact_digest
    }

    #[must_use]
    pub const fn instrument_scope_digest(&self) -> BindingDigest {
        self.instrument_scope_digest
    }

    #[must_use]
    pub const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }

    #[must_use]
    pub const fn source_binding_fact_digest(&self) -> BindingDigest {
        self.source_binding_fact_digest
    }

    #[must_use]
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }

    #[must_use]
    pub const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }

    #[must_use]
    pub const fn source_frontier_digest(&self) -> BindingDigest {
        self.source_frontier_digest
    }

    #[must_use]
    pub const fn correction_frontier_digest(&self) -> BindingDigest {
        self.correction_frontier_digest
    }

    #[must_use]
    pub const fn instrument_master_digest(&self) -> BindingDigest {
        self.instrument_master_digest
    }

    #[must_use]
    pub const fn universe_selection_digest(&self) -> BindingDigest {
        self.universe_selection_digest
    }

    #[must_use]
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    #[must_use]
    pub const fn time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
        &self.time_evidence
    }
}

impl NativeReplayInitialMarketReadbackV1 {
    #[must_use]
    pub const fn universe_frame(&self) -> &StrategyInputUniverseFrameReceipt {
        &self.universe_frame
    }

    #[must_use]
    pub fn schedules(&self) -> &[BarScheduleReadbackV1] {
        &self.schedules
    }

    /// Consumes the initial replay readback into the exact evidence needed for a Market Data
    /// repair request. The original observations and executable schedules are not returned.
    #[must_use]
    pub fn into_market_data_repair_source(self) -> MarketDataRepairSourceV1 {
        market_data_repair_source_from_verified_batch(self.batch, self.snapshot)
    }

    #[must_use]
    pub fn into_binding_parts(
        self,
    ) -> (
        StrategyInputUniverseFrameReceipt,
        Vec<BarScheduleReadbackV1>,
    ) {
        (self.universe_frame, self.schedules)
    }

    /// Converts the same freshly resolved Owner cut into this frame's V2 evidence.
    ///
    /// The batch and schedules never leave the Owner: they are spent here, which is why the
    /// evidence a caller receives cannot be re-derived from anything it holds.
    ///
    /// # Errors
    ///
    /// Returns an error when the Owner cut cannot form one exact frame's evidence.
    pub fn into_frame_evidence_v2(
        self,
    ) -> Result<
        (
            StrategyInputUniverseFrameReceipt,
            super::native_replay_scheduling_v2::NativeReplayFrameEvidenceV2,
        ),
        NativeReplaySchedulingErrorV1,
    > {
        let Self {
            batch,
            snapshot: _,
            quote_cut,
            universe_frame,
            schedules,
            declared,
            member_instruments,
            frame_time_ns,
            window_end_ns_exclusive,
        } = self;
        let evidence = super::native_replay_scheduling_v2::verify_native_replay_frame_evidence_v2(
            batch,
            quote_cut,
            schedules,
            &declared,
            member_instruments,
            frame_time_ns,
            window_end_ns_exclusive,
        )?;
        Ok((universe_frame, evidence))
    }

    /// Converts the same freshly resolved Owner cut into the native scheduling capability.
    ///
    /// # Errors
    ///
    /// Returns an error when the Owner cut cannot form one exact native scheduling readback.
    pub fn into_execution_parts(
        self,
    ) -> Result<
        (
            StrategyInputUniverseFrameReceipt,
            NativeReplaySchedulingReadbackV1,
        ),
        NativeReplaySchedulingErrorV1,
    > {
        let scheduling = seal_native_replay_scheduling_v1(
            self.batch,
            self.quote_cut,
            self.schedules,
            &self.declared,
            self.member_instruments,
            self.frame_time_ns,
            self.window_end_ns_exclusive,
        )?;
        Ok((self.universe_frame, scheduling))
    }
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "forming the repair source consumes the move-only verified Owner batch"
)]
pub(crate) fn market_data_repair_source_from_verified_batch(
    batch: VerifiedPitObservationBatch,
    (pit_snapshot_identity, pit_snapshot_fact_digest): (BindingDigest, BindingDigest),
) -> MarketDataRepairSourceV1 {
    MarketDataRepairSourceV1 {
        pit_request_identity: batch.request_identity(),
        pit_request_digest: batch.request_digest(),
        correlation_identity: batch.correlation_identity(),
        pit_snapshot_identity,
        pit_snapshot_fact_digest,
        instrument_scope_digest: batch.scope_digest(),
        source_binding_identity: batch.source_binding_identity(),
        source_binding_fact_digest: batch.source_binding_fact_digest(),
        source_binding_lineage_root: batch.source_binding_lineage_root(),
        source_binding_lineage_version: batch.source_binding_lineage_version(),
        source_frontier_digest: batch.source_frontier_digest(),
        correction_frontier_digest: batch.correction_frontier_digest(),
        instrument_master_digest: batch.instrument_master_digest(),
        universe_selection_digest: batch.universe_selection_digest(),
        market_semantics_identity: batch.market_semantics_identity(),
        time_evidence: batch.time_evidence().clone(),
    }
}

impl UntrustedNativeReplaySchedulingRequestV1 {
    #[must_use]
    pub fn new(
        pit_locator: UntrustedPitSnapshotLocator,
        schedule_locators: impl Into<Vec<UntrustedBarScheduleLocatorV1>>,
        member_instruments: impl Into<Vec<InstrumentId>>,
        frame_time_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Self {
        Self {
            pit_locator,
            schedule_locators: schedule_locators.into(),
            member_instruments: member_instruments.into(),
            frame_time_ns,
            window_end_ns_exclusive,
        }
    }

    #[must_use]
    pub const fn pit_locator(&self) -> &UntrustedPitSnapshotLocator {
        &self.pit_locator
    }

    #[must_use]
    pub fn schedule_locators(&self) -> &[UntrustedBarScheduleLocatorV1] {
        &self.schedule_locators
    }

    #[must_use]
    pub fn member_instruments(&self) -> Vec<InstrumentId> {
        self.member_instruments.clone()
    }

    #[must_use]
    pub const fn frame_time_ns(&self) -> u64 {
        self.frame_time_ns
    }

    #[must_use]
    pub const fn window_end_ns_exclusive(&self) -> u64 {
        self.window_end_ns_exclusive
    }
}

pub(crate) mod resolver_seal {
    pub trait Sealed {}
}

/// Read-only Owner port that resolves and seals all persistent scheduling inputs as one capability.
#[async_trait::async_trait]
pub trait NativeReplaySchedulingResolverV1: resolver_seal::Sealed + Send + Sync {
    /// Resolves a snapshot frame; a custody frame request is refused as
    /// [`NativeReplaySchedulingErrorV1::FrameSourceMismatch`].
    async fn resolve_native_replay_initial_market_inputs_v1(
        &self,
        request: &NativeReplayInitialMarketRequestV1,
    ) -> Result<NativeReplayInitialMarketReadbackV1, NativeReplaySchedulingErrorV1>;

    /// Resolves one frame of a custody run at the head its request pins; a snapshot request is
    /// refused as [`NativeReplaySchedulingErrorV1::FrameSourceMismatch`].
    async fn resolve_native_replay_custody_frame_inputs_v1(
        &self,
        request: &NativeReplayInitialMarketRequestV1,
    ) -> Result<NativeReplayCustodyFrameReadbackV1, NativeReplaySchedulingErrorV1>;
}

pub(crate) fn issue_native_replay_initial_market_readback_v1(
    batch: VerifiedPitObservationBatch,
    quote_cut: VerifiedPitObservationBatch,
    schedules: impl Into<Vec<BarScheduleReadbackV1>>,
    declared: DeclaredBarTimeframeV1,
    request: &NativeReplayInitialMarketRequestV1,
) -> Result<NativeReplayInitialMarketReadbackV1, NativeReplaySchedulingErrorV1> {
    let schedules = schedules.into();
    // Checked before any role's scope is replaced by the universe below: an Owner universe answers
    // `UniverseMembers` roles, and reading it for a role that names one exact instrument would hand
    // that role another instrument's values.
    if request
        .roles
        .iter()
        .any(|role| role.declared_scope != NativeReplayRoleScopeV1::UniverseMembers)
    {
        return Err(NativeReplaySchedulingErrorV1::ExactInstrumentRolesUnderOwnerUniverse);
    }

    if request.roles.is_empty()
        || !canonical_members(&request.member_instruments)
        || schedules.len() != request.member_instruments.len()
        || request.frame_time_ns >= request.window_end_ns_exclusive
        || batch.committed_snapshot() != Some(request.snapshot_source()?)
        || batch.instrument_master_digest() != request.instrument_master_digest
        || batch.source_binding_lineage_root() != request.source_binding_lineage_root
        || batch.market_semantics_identity() != request.market_semantics_identity
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }

    if request.universe_selection_record_identity != batch.universe_selection_digest()
        || request.universe_selection_record_digest != batch.universe_selection_digest()
    {
        return Err(NativeReplaySchedulingErrorV1::UniverseSelectionRecordMismatch);
    }
    let timeframe = request.execution_timeframe()?;
    // The roles' label is the one the frame's own Source Binding declares its bars under: an
    // identity check that the roles read that binding's rows, never a parse of what the label says.
    declared
        .for_batch(&batch)
        .and_then(|declared| declared.describes_label(timeframe))
        .map_err(|_| NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)?;

    for (index, schedule) in schedules.iter().enumerate() {
        validated_bar_type(
            schedule,
            &batch,
            request.member_instruments[index],
            request.frame_time_ns,
        )?;

        if !declared.admits_schedule(schedule.fact()) {
            return Err(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch);
        }
    }
    let binding_requests = native_replay_universe_binding_requests_v1(request, &batch)
        .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;
    let universe_frame = bind_strategy_input_universe_frame(&binding_requests, &batch)
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;
    let members = universe_frame.selection().members();
    if universe_frame.selection().selection_identity() != request.universe_selection_identity
        || universe_frame.selection().selection_digest() != request.universe_selection_digest
        || members.len() != request.member_instruments.len()
        || !members
            .iter()
            .zip(&request.member_instruments)
            .all(|(member, instrument)| member.instrument() == instrument.to_string())
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    // The frame's Quotes are checked here rather than first found wrong when the readback is spent:
    // a readback that exists can always become its scheduling seal.
    quote_cut_instant(&batch, &quote_cut, request.window_end_ns_exclusive)?;
    Ok(NativeReplayInitialMarketReadbackV1 {
        batch,
        snapshot: request.snapshot_source()?,
        quote_cut,
        universe_frame,
        schedules,
        declared,
        member_instruments: request.member_instruments.clone(),
        frame_time_ns: request.frame_time_ns,
        window_end_ns_exclusive: request.window_end_ns_exclusive,
    })
}

/// The binding requests the host's initial frame is bound from: one per role of the request,
/// scoped to its Owner universe and stating the frame's batch coordinates.
///
/// Market Data re-derives a universe frame from the same requests, so this is the one place they
/// are built; a frame built any other way would not be the frame a host admits.
pub(crate) fn native_replay_universe_binding_requests_v1(
    request: &NativeReplayInitialMarketRequestV1,
    batch: &VerifiedPitObservationBatch,
) -> Option<Vec<UntrustedStrategyInputBindingRequest>> {
    let source = batch.binding_request_source_v1()?;
    let requests = request
        .roles
        .iter()
        .map(|role| UntrustedStrategyInputBindingRequest {
            research_request_identity: request.research_request_identity,
            strategy_design_identity: request.strategy_design_identity,
            input_role_identity: role.input_role_identity,
            scope: UntrustedStrategyInputScope::UniverseSelection {
                selection_identity: request.universe_selection_identity,
            },
            field_semantic: role.field_semantic,
            channel: role.channel,
            timeframe: role.timeframe.clone(),
            unit: role.unit,
            scale: role.scale,
            pit_request_identity: batch.request_identity(),
            pit_request_digest: batch.request_digest(),
            source,
            observation_batch_digest: batch.digest(),
            source_binding_identity: batch.source_binding_identity(),
            source_frontier_digest: batch.source_frontier_digest(),
            correction_frontier_digest: batch.correction_frontier_digest(),
            instrument_master_digest: batch.instrument_master_digest(),
            universe_selection_digest: batch.universe_selection_digest(),
            market_semantics_identity: batch.market_semantics_identity(),
            decision_cut: batch.time_evidence().decision_cut.value,
        })
        .collect();
    Some(requests)
}

#[cfg_attr(
    test,
    allow(
        dead_code,
        reason = "the production PostgreSQL resolver is disabled in unit tests"
    )
)]
/// Picks the one candidate schedule of an instrument that this frame's request admits.
///
/// Shared by every build on purpose: which candidate a frame selects, and the refusal when two
/// would do, are the same question whether a test asks it or a deployment does. Two matching
/// candidates are refused rather than ordered between, because the census that produced them
/// carries no preference and inventing one here would make the frame depend on a row order.
///
/// # Errors
///
/// Returns `NoBarScheduleAtFrame` when no candidate is the member's at the frame, and a binding
/// mismatch when two match.
pub(crate) fn select_native_replay_schedule_v1(
    candidates: Vec<BarScheduleReadbackV1>,
    batch: &VerifiedPitObservationBatch,
    instrument: InstrumentId,
    declared: &DeclaredBarTimeframeV1,
    frame_time_ns: u64,
) -> Result<BarScheduleReadbackV1, NativeReplaySchedulingErrorV1> {
    select_native_replay_schedule_for_member_v1(
        candidates,
        batch,
        &instrument.to_string(),
        declared,
        frame_time_ns,
    )
}

/// [`select_native_replay_schedule_v1`] for a member named by its canonical instrument.
///
/// A schedule is selected by comparing its typed fields with the bar the frame's own Source Binding
/// declares, never by a label. A member whose schedules at the frame all state another bar - the
/// exchange-session day a label `1D` once implied, under a declared 24-hour UTC bar - is refused by
/// name rather than reported unavailable, because a schedule exists and says the wrong thing.
pub(crate) fn select_native_replay_schedule_for_member_v1(
    candidates: Vec<BarScheduleReadbackV1>,
    batch: &VerifiedPitObservationBatch,
    canonical_instrument: &str,
    declared: &DeclaredBarTimeframeV1,
    frame_time_ns: u64,
) -> Result<BarScheduleReadbackV1, NativeReplaySchedulingErrorV1> {
    let declared = declared
        .for_batch(batch)
        .map_err(|_| NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)?;
    let at_frame = candidates
        .into_iter()
        .filter(|schedule| {
            schedule_is_at_frame_v1(schedule, batch, canonical_instrument, frame_time_ns).is_ok()
        })
        .collect::<Vec<_>>();

    if at_frame.is_empty() {
        return Err(NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame);
    }
    let mut matches = at_frame
        .into_iter()
        .filter(|schedule| declared.admits_schedule(schedule.fact()));
    let selected = matches
        .next()
        .ok_or(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)?;

    if matches.next().is_some() {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    Ok(selected)
}

/// Seals one exact `[BAR0, BAR1, QUOTE0, QUOTE1]` native schedule from Owner readbacks.
///
/// # Errors
///
/// Fails when either schedule, member, field census, provenance coordinate, time, or native value
/// is missing, duplicated, mismatched, or not exactly representable.
#[allow(
    clippy::needless_pass_by_value,
    reason = "sealing native scheduling consumes the Owner batch and exact schedule set"
)]
pub fn seal_native_replay_scheduling_v1(
    frame: VerifiedPitObservationBatch,
    quote_cut: VerifiedPitObservationBatch,
    schedules: impl Into<Vec<BarScheduleReadbackV1>>,
    declared: &DeclaredBarTimeframeV1,
    member_instruments: impl Into<Vec<InstrumentId>>,
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<NativeReplaySchedulingReadbackV1, NativeReplaySchedulingErrorV1> {
    let schedules = schedules.into();
    let member_instruments = member_instruments.into();

    if !canonical_members(&member_instruments)
        || schedules.len() != member_instruments.len()
        || frame_time_ns >= window_end_ns_exclusive
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    let declared = declared
        .for_batch(&frame)
        .map_err(|_| NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)?;

    if schedules
        .iter()
        .any(|schedule| !declared.admits_schedule(schedule.fact()))
    {
        return Err(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch);
    }
    let instant_ns = quote_cut_instant(&frame, &quote_cut, window_end_ns_exclusive)?;
    let bar_types = schedules
        .iter()
        .zip(&member_instruments)
        .map(|(schedule, instrument)| {
            validated_bar_type(schedule, &frame, *instrument, frame_time_ns)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut data = Vec::with_capacity(member_instruments.len() * 2);

    for (instrument, bar_type) in member_instruments.iter().zip(&bar_types) {
        data.push(Data::Bar(project_bar(
            &frame,
            *instrument,
            *bar_type,
            frame_time_ns,
            declared.row_timeframe(),
        )?));
    }

    // Every member's Quote shares the quote cut's instant; member order is the order Backtest
    // consumes elements that share a `ts_init` in.
    for instrument in &member_instruments {
        data.push(Data::Quote(project_quote(
            &quote_cut,
            *instrument,
            instant_ns,
        )?));
    }
    let bar_schedule_digests = schedules
        .iter()
        .map(BarScheduleReadbackV1::digest)
        .collect::<Vec<_>>();
    let quote_cut = NativeReplayQuoteCutReadbackV1 {
        source: quote_cut.source(),
        observation_batch_digest: quote_cut.digest(),
        instant_ns,
    };
    let (quote_snapshot, quote_fact) = quote_cut
        .committed_snapshot()
        .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;
    let receipt_digest = digest_receipt(
        frame.digest(),
        (quote_snapshot, quote_fact),
        &bar_schedule_digests,
        &member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
        &data,
    )?;
    Ok(NativeReplaySchedulingReadbackV1 {
        observation_batch_digest: frame.digest(),
        quote_cut,
        bar_schedule_digests,
        member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
        bar_types,
        data,
        receipt_digest,
    })
}

/// One member's window schedule, as a custody frame's readback states it. Move-only: it is the
/// Owner's readback of a stored schedule, not a value a caller builds.
#[derive(Debug, Eq, PartialEq)]
pub struct PitWindowScheduleReadbackV1(PitWindowScheduleFactV1);

impl PitWindowScheduleReadbackV1 {
    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.0.identity()
    }

    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.0.instrument
    }

    #[must_use]
    pub const fn timeframe_identity(&self) -> BindingDigest {
        self.0.timeframe_identity
    }

    #[must_use]
    pub const fn interval_ns(&self) -> u64 {
        self.0.interval_ns
    }

    #[must_use]
    pub const fn phase_ns(&self) -> u64 {
        self.0.phase_ns
    }

    /// `[start, end)` of the custody window.
    #[must_use]
    pub const fn window(&self) -> (u64, u64) {
        (self.0.window_start_ns, self.0.window_end_ns_exclusive)
    }
}

/// Move-only Market Data readback of one custody frame: its universe frame, window schedules and
/// the view and quote cut its native schedule is sealed from.
///
/// It has none of a snapshot frame's snapshot-only conversions - no repair source, no binding
/// parts, no V2 frame evidence - so none can be asked of a custody frame.
#[derive(Debug)]
pub struct NativeReplayCustodyFrameReadbackV1 {
    view: VerifiedPitObservationBatch,
    quote_cut: VerifiedPitObservationBatch,
    universe_frame: StrategyInputUniverseFrameReceipt,
    schedules: Vec<PitWindowScheduleReadbackV1>,
    declared: DeclaredBarTimeframeV1,
    member_instruments: Vec<InstrumentId>,
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
}

impl NativeReplayCustodyFrameReadbackV1 {
    #[must_use]
    pub const fn universe_frame(&self) -> &StrategyInputUniverseFrameReceipt {
        &self.universe_frame
    }

    /// One window schedule per member, in member order.
    #[must_use]
    pub fn window_schedules(&self) -> &[PitWindowScheduleReadbackV1] {
        &self.schedules
    }

    /// The custody view the frame's strategy inputs were read from.
    #[must_use]
    pub const fn source(&self) -> PitObservationBatchSourceV1 {
        self.view.source()
    }

    #[cfg(test)]
    pub(crate) const fn quote_cut_for_test(&self) -> &VerifiedPitObservationBatch {
        &self.quote_cut
    }

    /// Converts the frame into its universe frame and its native scheduling capability.
    ///
    /// # Errors
    ///
    /// Returns an error when the view and quote cut cannot form one exact native schedule.
    pub fn into_execution_parts(
        self,
    ) -> Result<
        (
            StrategyInputUniverseFrameReceipt,
            NativeReplaySchedulingReadbackV1,
        ),
        NativeReplaySchedulingErrorV1,
    > {
        let schedules = self
            .schedules
            .into_iter()
            .map(|schedule| schedule.0)
            .collect::<Vec<_>>();
        let scheduling = seal_native_replay_custody_frame_v1(
            self.view,
            self.quote_cut,
            &schedules,
            &self.declared,
            self.member_instruments,
            self.frame_time_ns,
            self.window_end_ns_exclusive,
        )?;
        Ok((self.universe_frame, scheduling))
    }
}

#[cfg(test)]
impl NativeReplayCustodyFrameReadbackV1 {
    /// The snapshot frame over exactly this frame's rows, for parity proofs: its view and quote
    /// cut restated as committed snapshots, one BAR schedule per member stating the bar its window
    /// schedule states, issued on the snapshot path for `request` restated for that snapshot.
    pub(crate) fn snapshot_twin_for_test(
        &self,
        request: &NativeReplayInitialMarketRequestV1,
    ) -> Result<NativeReplayInitialMarketReadbackV1, NativeReplaySchedulingErrorV1> {
        let snapshot = |seed: u8| PitObservationBatchSourceV1::CommittedSnapshot {
            snapshot_identity: BindingDigest::from_untrusted_bytes([seed; 32]),
            fact_digest: BindingDigest::from_untrusted_bytes([seed.wrapping_add(1); 32]),
        };
        let batch = self
            .view
            .clone()
            .edit_for_test(|fields| fields.source = snapshot(12));
        let quote_cut = self
            .quote_cut
            .clone()
            .edit_for_test(|fields| fields.source = snapshot(112));
        let schedules = self
            .schedules
            .iter()
            .zip(1..)
            .map(|(window, identity)| {
                let shape = window.0.shape;
                let mut schedule =
                    tests::schedule_bound_to_batch(&window.0.instrument, identity, &batch);
                schedule.fact.kind = shape.kind;
                schedule.fact.unit = shape.unit;
                schedule.fact.step = shape.step;
                schedule.fact.anchor_identity = anchor_identity_v1(shape.anchor);
                schedule.fact.label = shape.label;
                schedule.fact.completion = shape.completion;

                if shape.clock == BarScheduleClockV1::Continuous {
                    schedule.fact.calendar_identity = BindingDigest::from_untrusted_bytes([0; 32]);
                    schedule.fact.session_identity = BindingDigest::from_untrusted_bytes([0; 32]);
                }
                schedule
            })
            .collect::<Vec<_>>();
        let selection = batch.universe_selection_digest();
        let mut request = request.for_frame(
            BindingDigest::from_untrusted_bytes([12; 32]),
            BindingDigest::from_untrusted_bytes([13; 32]),
            request.frame_time_ns,
        );
        // A snapshot's Record is the one its intake admitted: both halves name it.
        request.universe_selection_record_identity = selection;
        request.universe_selection_record_digest = selection;
        issue_native_replay_initial_market_readback_v1(
            batch,
            quote_cut,
            schedules,
            self.declared.clone(),
            &request,
        )
    }
}

/// The instant of a custody quote cut that follows `view`, once it lies inside the gap after the
/// view's frame: `(d_k, bound)`, the bound the next frame's event or, for the last, the run's end.
fn custody_quote_cut_instant(
    view: &VerifiedPitObservationBatch,
    quote_cut: &VerifiedPitObservationBatch,
    interval_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<u64, NativeReplaySchedulingErrorV1> {
    let PitObservationBatchSourceV1::CustodyView {
        chain_root,
        event_ns,
        decision_cut_ns,
        ..
    } = view.source()
    else {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    };
    let PitObservationBatchSourceV1::CustodyQuoteCut {
        chain_root: quote_root,
        instant_ns,
        ..
    } = quote_cut.source()
    else {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    };
    let bound = custody_quote_cut_bound_v1(event_ns, interval_ns, window_end_ns_exclusive)
        .ok_or(NativeReplaySchedulingErrorV1::EventOrderUnavailable)?;

    if quote_root != chain_root
        || quote_cut.instrument_master_digest() != view.instrument_master_digest()
        || quote_cut.source_binding_lineage_root() != view.source_binding_lineage_root()
        || quote_cut.market_semantics_identity() != view.market_semantics_identity()
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }

    if instant_ns <= decision_cut_ns || instant_ns >= bound {
        return Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable);
    }
    Ok(instant_ns)
}

/// Issues the readback of one custody frame from the Owner's view, quote cut and window
/// schedules of the head its request pins.
///
/// `universe` is the custody's Universe Selection locator, `(request_identity,
/// request_meaning_digest)`: the Record a custody request names is checked as that pair.
pub(crate) fn issue_native_replay_custody_frame_readback_v1(
    view: VerifiedPitObservationBatch,
    quote_cut: VerifiedPitObservationBatch,
    schedules: Vec<PitWindowScheduleFactV1>,
    declared: DeclaredBarTimeframeV1,
    universe: (BindingDigest, BindingDigest),
    request: &NativeReplayInitialMarketRequestV1,
) -> Result<NativeReplayCustodyFrameReadbackV1, NativeReplaySchedulingErrorV1> {
    let frame = request.custody_frame()?;

    if request
        .roles
        .iter()
        .any(|role| role.declared_scope != NativeReplayRoleScopeV1::UniverseMembers)
    {
        return Err(NativeReplaySchedulingErrorV1::ExactInstrumentRolesUnderOwnerUniverse);
    }

    // The view in the frame's position is this frame's custody view: a quote cut, a snapshot or
    // another chain's or frame's view is not.
    let is_this_frame = matches!(
        view.source(),
        PitObservationBatchSourceV1::CustodyView { chain_root, event_ns, .. }
            if chain_root == frame.custody.chain_root && event_ns == request.frame_time_ns
    );

    if !is_this_frame
        || request.roles.is_empty()
        || !canonical_members(&request.member_instruments)
        || schedules.len() != request.member_instruments.len()
        || request.frame_time_ns >= request.window_end_ns_exclusive
        || view.instrument_master_digest() != request.instrument_master_digest
        || view.source_binding_lineage_root() != request.source_binding_lineage_root
        || view.market_semantics_identity() != request.market_semantics_identity
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    let interval_ns = schedules
        .first()
        .map(|schedule| schedule.interval_ns)
        .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;
    custody_quote_cut_instant(
        &view,
        &quote_cut,
        interval_ns,
        request.window_end_ns_exclusive,
    )?;

    // Ruling Q11: the Record is the locator pair, identity and meaning digest each compared.
    if request.universe_selection_record_identity != universe.0
        || request.universe_selection_record_digest != universe.1
        || view.universe_selection_digest() != universe.0
    {
        return Err(NativeReplaySchedulingErrorV1::UniverseSelectionRecordMismatch);
    }
    let timeframe = request.execution_timeframe()?;
    declared
        .for_batch(&view)
        .and_then(|declared| declared.describes_label(timeframe))
        .map_err(|_| NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)?;
    let PitObservationBatchSourceV1::CustodyView {
        decision_cut_ns, ..
    } = view.source()
    else {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    };

    for (schedule, instrument) in schedules.iter().zip(&request.member_instruments) {
        if schedule.instrument != instrument.to_string() {
            return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
        }

        if !window_schedule_admits_frame_v1(schedule, request.frame_time_ns, decision_cut_ns) {
            return Err(NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame);
        }

        if !declared.admits_window_schedule(schedule) {
            return Err(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch);
        }
    }
    let binding_requests = native_replay_universe_binding_requests_v1(request, &view)
        .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;
    let universe_frame = bind_strategy_input_universe_frame(&binding_requests, &view)
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;
    let members = universe_frame.selection().members();

    if universe_frame.selection().selection_identity() != request.universe_selection_identity
        || universe_frame.selection().selection_digest() != request.universe_selection_digest
        || members.len() != request.member_instruments.len()
        || !members
            .iter()
            .zip(&request.member_instruments)
            .all(|(member, instrument)| member.instrument() == instrument.to_string())
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    Ok(NativeReplayCustodyFrameReadbackV1 {
        view,
        quote_cut,
        universe_frame,
        schedules: schedules
            .into_iter()
            .map(PitWindowScheduleReadbackV1)
            .collect(),
        declared,
        member_instruments: request.member_instruments.clone(),
        frame_time_ns: request.frame_time_ns,
        window_end_ns_exclusive: request.window_end_ns_exclusive,
    })
}

/// Seals one custody frame's `[BAR.., QUOTE..]` native schedule from its view, its quote cut and
/// one window schedule per member: the snapshot frame's projection, with the window schedule in
/// place of the BAR schedule and a receipt of its own.
///
/// # Errors
///
/// Fails when a schedule, member, field census, coordinate, time, or native value is missing,
/// duplicated, mismatched, or not exactly representable.
#[allow(
    clippy::needless_pass_by_value,
    reason = "sealing native scheduling consumes the Owner view and quote cut"
)]
pub(crate) fn seal_native_replay_custody_frame_v1(
    view: VerifiedPitObservationBatch,
    quote_cut: VerifiedPitObservationBatch,
    schedules: &[PitWindowScheduleFactV1],
    declared: &DeclaredBarTimeframeV1,
    member_instruments: Vec<InstrumentId>,
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<NativeReplaySchedulingReadbackV1, NativeReplaySchedulingErrorV1> {
    let PitObservationBatchSourceV1::CustodyView {
        chain_root,
        view_identity,
        event_ns,
        decision_cut_ns,
        derived_frontier_digest,
    } = view.source()
    else {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    };

    if !canonical_members(&member_instruments)
        || schedules.len() != member_instruments.len()
        || frame_time_ns >= window_end_ns_exclusive
        || event_ns != frame_time_ns
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    let declared = declared
        .for_batch(&view)
        .map_err(|_| NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)?;
    let interval_ns = schedules
        .first()
        .map(|schedule| schedule.interval_ns)
        .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;
    let instant_ns =
        custody_quote_cut_instant(&view, &quote_cut, interval_ns, window_end_ns_exclusive)?;
    let PitObservationBatchSourceV1::CustodyQuoteCut {
        quote_cut_identity,
        derivation,
        ..
    } = quote_cut.source()
    else {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    };
    let bar_types = schedules
        .iter()
        .zip(&member_instruments)
        .map(|(schedule, instrument)| {
            if schedule.instrument != instrument.to_string()
                || !window_schedule_admits_frame_v1(schedule, frame_time_ns, decision_cut_ns)
            {
                return Err(NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame);
            }

            if !declared.admits_window_schedule(schedule) {
                return Err(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch);
            }
            Ok(BarType::new(
                *instrument,
                native_bar_specification_of_v1(
                    schedule.shape.kind,
                    schedule.shape.unit,
                    schedule.shape.step,
                    schedule.shape.clock,
                    anchor_identity_v1(schedule.shape.anchor),
                )?,
                AggregationSource::External,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut data = Vec::with_capacity(member_instruments.len() * 2);

    for (instrument, bar_type) in member_instruments.iter().zip(&bar_types) {
        data.push(Data::Bar(project_bar(
            &view,
            *instrument,
            *bar_type,
            frame_time_ns,
            declared.row_timeframe(),
        )?));
    }

    for instrument in &member_instruments {
        data.push(Data::Quote(project_quote(
            &quote_cut,
            *instrument,
            instant_ns,
        )?));
    }
    let bar_schedule_digests = schedules
        .iter()
        .map(PitWindowScheduleFactV1::identity)
        .collect::<Vec<_>>();
    let receipt_digest = digest_custody_receipt_v1(
        &CustodyReceiptPartsV1 {
            view_digest: view.digest(),
            chain_root,
            view_identity,
            derived_frontier_digest,
            quote_cut_identity,
            derivation,
            schedule_digests: &bar_schedule_digests,
            instruments: &member_instruments,
            frame_time_ns,
            window_end_ns_exclusive,
        },
        &data,
    )?;
    Ok(NativeReplaySchedulingReadbackV1 {
        observation_batch_digest: view.digest(),
        quote_cut: NativeReplayQuoteCutReadbackV1 {
            source: quote_cut.source(),
            observation_batch_digest: quote_cut.digest(),
            instant_ns,
        },
        bar_schedule_digests,
        member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
        bar_types,
        data,
        receipt_digest,
    })
}

/// Everything a custody frame's receipt binds besides its native values.
struct CustodyReceiptPartsV1<'a> {
    view_digest: BindingDigest,
    chain_root: BindingDigest,
    view_identity: BindingDigest,
    derived_frontier_digest: BindingDigest,
    quote_cut_identity: BindingDigest,
    derivation: QuoteDerivationV1,
    schedule_digests: &'a [BindingDigest],
    instruments: &'a [InstrumentId],
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
}

/// The receipt of a custody frame: the member count, the view's batch digest, chain root, view
/// identity and derived frontier, the quote cut's identity and derivation, the window schedules,
/// the members, `e_k`, the window's end, then the native values.
fn digest_custody_receipt_v1(
    parts: &CustodyReceiptPartsV1<'_>,
    data: &[Data],
) -> Result<BindingDigest, NativeReplaySchedulingErrorV1> {
    let mut hasher = Sha256::new();
    hasher.update(CUSTODY_RECEIPT_DOMAIN_V1);
    hasher.update(
        u64::try_from(parts.instruments.len())
            .map_err(|_| NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?
            .to_be_bytes(),
    );
    hasher.update(parts.view_digest.as_bytes());
    hasher.update(parts.chain_root.as_bytes());
    hasher.update(parts.view_identity.as_bytes());
    hasher.update(parts.derived_frontier_digest.as_bytes());
    hasher.update(parts.quote_cut_identity.as_bytes());

    match parts.derivation {
        QuoteDerivationV1::ObservedBbo => hasher.update([1]),
        QuoteDerivationV1::FillBarOpen {
            fill_timeframe_identity,
        } => {
            hasher.update([2]);
            hasher.update(fill_timeframe_identity.as_bytes());
        }
    }

    for digest in parts.schedule_digests {
        hasher.update(digest.as_bytes());
    }

    for instrument in parts.instruments {
        hash_text(&mut hasher, &instrument.to_string())?;
    }
    hasher.update(parts.frame_time_ns.to_be_bytes());
    hasher.update(parts.window_end_ns_exclusive.to_be_bytes());
    hash_native_data_v1(&mut hasher, data)?;
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

/// Returns the instant of `quote_cut` once it is `frame`'s quote cut and lies before the bound.
///
/// Which quote cut serves a frame is the resolver's question, answered from the census; this is
/// the check that the batch it resolved is one: a quote cut strictly after the frame's BAR and
/// strictly before `bound_ns_exclusive`, on the frame's own coordinates and exactly its members.
fn quote_cut_instant(
    frame: &VerifiedPitObservationBatch,
    quote_cut: &VerifiedPitObservationBatch,
    bound_ns_exclusive: u64,
) -> Result<u64, NativeReplaySchedulingErrorV1> {
    let quote_cut_coordinates = NativeReplayCutCoordinatesV2::of(quote_cut);
    verify_native_replay_quote_cut_v2(
        &NativeReplayCutCoordinatesV2::of(frame),
        &quote_cut_coordinates,
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;

    if quote_cut_coordinates.event_effective_ns >= bound_ns_exclusive {
        return Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable);
    }
    Ok(quote_cut_coordinates.event_effective_ns)
}

fn validated_bar_type(
    schedule: &BarScheduleReadbackV1,
    batch: &VerifiedPitObservationBatch,
    instrument_id: InstrumentId,
    frame_time_ns: u64,
) -> Result<BarType, NativeReplaySchedulingErrorV1> {
    schedule_is_at_frame_v1(schedule, batch, &instrument_id.to_string(), frame_time_ns)?;
    native_bar_type_for_schedule_v1(schedule.fact(), instrument_id)
}

/// The native engine's bar type for the bar `schedule` states, on `instrument`.
///
/// The one implementation of a schedule's native bar type: the frame's own seal reaches it, and so
/// does an acceptance asserting what a schedule will be named, so the two cannot drift. The name
/// is the engine's encoding of the typed schedule, as `native_bar_specification_v1` describes.
///
/// # Errors
///
/// Returns `NativeRepresentation` for a bar the engine has no name for, and `OwnerBindingMismatch`
/// for a schedule shape no native aggregation states.
pub fn native_bar_type_for_schedule_v1(
    schedule: &BarScheduleFactV1,
    instrument: InstrumentId,
) -> Result<BarType, NativeReplaySchedulingErrorV1> {
    Ok(BarType::new(
        instrument,
        native_bar_specification_v1(schedule)?,
        AggregationSource::External,
    ))
}

/// The native bar specification of one member's schedule, when that schedule answers the member's
/// BAR role at the frame: it names the member's canonical instrument, closes complete bars, is in
/// force and cut at the frame's instant, and was admitted over the frame's batch coordinates.
///
/// This is the whole of the rule. The host's frame names its members as native instruments, and
/// Market Data's own reads name them by canonical instrument; both ask it here. The seal asks its
/// two halves directly, so only the sealed acceptance proposer, and tests, ask it whole.
#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
pub(crate) fn schedule_bar_specification_at_frame_v1(
    schedule: &BarScheduleReadbackV1,
    batch: &VerifiedPitObservationBatch,
    canonical_instrument: &str,
    frame_time_ns: u64,
) -> Result<BarSpecification, NativeReplaySchedulingErrorV1> {
    schedule_is_at_frame_v1(schedule, batch, canonical_instrument, frame_time_ns)?;
    native_bar_specification_v1(schedule.fact())
}

/// Whether `schedule` is one of the member's schedules at the frame, before anything is asked
/// about which bar it states or what the engine calls that bar.
///
/// Kept apart from naming so that a schedule which is at the frame but states another bar is
/// refused as that, rather than disappearing because the engine has no name for it.
fn schedule_is_at_frame_v1(
    schedule: &BarScheduleReadbackV1,
    batch: &VerifiedPitObservationBatch,
    canonical_instrument: &str,
    frame_time_ns: u64,
) -> Result<(), NativeReplaySchedulingErrorV1> {
    let fact = schedule.fact();
    if fact.canonical_instrument() != canonical_instrument
        || fact.label() != BarScheduleLabelV1::IntervalClose
        || fact.completion() != BarScheduleCompletionV1::CompleteOnly
        || fact.effective_from() > i128::from(frame_time_ns)
        || fact
            .effective_until()
            .is_some_and(|end| i128::from(frame_time_ns) >= end)
        || fact.cut_effective_instant() != i128::from(frame_time_ns)
        || fact.instrument_master_digest() != batch.instrument_master_digest()
        || fact.market_semantics_identity() != batch.market_semantics_identity()
        || fact.schedule_source_frontier() != batch.source_frontier_digest()
        || fact.schedule_correction_frontier() != batch.correction_frontier_digest()
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    Ok(())
}

/// The native engine's name for a schedule's bar.
///
/// The typed schedule is the bar's meaning; this is only the name the engine gives it, and several
/// typed bars can share one name. The sequence of a Replay's frames refuses two of them meeting
/// there (`NativeBarTypeCarriesTwoTimeframes`).
///
/// The engine admits a periodic step only - a Second or Minute step dividing 60, an Hour step
/// dividing 24, never the whole of either (`BarSpecification::validate_step`,
/// `crates/model/src/data/bar.rs`) - and asks for the next unit instead. A fixed interval on a
/// continuous clock from the Unix epoch is therefore named in the largest unit that divides its
/// duration and that the engine admits: 24 hours is `1-DAY`, 60 minutes `1-HOUR`, 5 hours nothing.
/// The name is exact because the engine takes these bars as `EXTERNAL`: it neither aggregates them
/// nor derives their instants from the name, which carry the rows' own times. A fixed interval
/// within a trading schedule keeps its own unit. An exchange session day is named `DAY`, which the
/// engine cannot tell from a UTC day; that is a stated limitation until the engine models sessions.
fn native_bar_specification_v1(
    fact: &BarScheduleFactV1,
) -> Result<BarSpecification, NativeReplaySchedulingErrorV1> {
    native_bar_specification_of_v1(
        fact.kind(),
        fact.unit(),
        fact.step(),
        fact.clock(),
        fact.anchor_identity(),
    )
}

/// [`native_bar_specification_v1`] of a bar stated by its shape alone, as a window schedule
/// states it.
fn native_bar_specification_of_v1(
    kind: BarScheduleKindV1,
    schedule_unit: BarScheduleUnitV1,
    schedule_step: u32,
    clock: BarScheduleClockV1,
    anchor_identity: BindingDigest,
) -> Result<BarSpecification, NativeReplaySchedulingErrorV1> {
    let named = |step: u64, aggregation| {
        let step = usize::try_from(step)
            .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
        BarSpecification::new_checked(step, aggregation, PriceType::Last)
            .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
    };
    let step = u64::from(schedule_step);
    let unit_seconds = match (kind, schedule_unit) {
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Second) => 1,
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Minute) => 60,
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour) => 3_600,
        (BarScheduleKindV1::ExchangeSession, BarScheduleUnitV1::ExchangeSessionDay) => {
            return named(step, BarAggregation::Day);
        }
        _ => return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch),
    };
    let unit = match schedule_unit {
        BarScheduleUnitV1::Second => BarAggregation::Second,
        BarScheduleUnitV1::Minute => BarAggregation::Minute,
        _ => BarAggregation::Hour,
    };

    if clock != BarScheduleClockV1::Continuous
        || anchor_identity != anchor_identity_v1(DeclaredBarAnchorV1::UnixEpoch)
    {
        return named(step, unit);
    }
    let seconds = step
        .checked_mul(unit_seconds)
        .ok_or(NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    [
        (86_400, BarAggregation::Day),
        (3_600, BarAggregation::Hour),
        (60, BarAggregation::Minute),
        (1, BarAggregation::Second),
    ]
    .into_iter()
    .filter(|(unit_seconds, _)| seconds.is_multiple_of(*unit_seconds))
    .find_map(|(unit_seconds, aggregation)| named(seconds / unit_seconds, aggregation).ok())
    .ok_or(NativeReplaySchedulingErrorV1::NativeRepresentation)
}

fn project_bar(
    batch: &VerifiedPitObservationBatch,
    instrument_id: InstrumentId,
    bar_type: BarType,
    frame_time_ns: u64,
    timeframe: &str,
) -> Result<Bar, NativeReplaySchedulingErrorV1> {
    let instrument = instrument_id.to_string();
    let rows = exact_fields(
        batch.observations().iter().filter(|row| {
            row.instrument() == instrument
                && row.data_kind() == "BAR"
                && row.timeframe() == timeframe
                && row.event_effective() == frame_time_ns
        }),
        &BAR_FIELDS,
    )?;
    verify_same_event_coordinate(rows.values().copied())?;
    let open = native_price(rows["OPEN"])?;
    let high = native_price(rows["HIGH"])?;
    let low = native_price(rows["LOW"])?;
    let close = native_price(rows["CLOSE"])?;
    let volume = native_quantity(rows["VOLUME"], true)?;

    // Market Data issues each price at its own canonical scale, without trailing fractional
    // zeros, so one field's trailing zero can canonicalize away while another's does not: a real
    // bar of 65000.10 / 65400.00 / 64800.50 / 65210.30 carries precisions 1 / 0 / 1 / 1. `Bar`
    // requires one shared precision (its Arrow encoding assumes it), so every field widens to the
    // bar's own finest precision before construction - appending a fractional zero only, never
    // rounding. This is a bar-local widening, not the run-fixed instrument grid: the execution
    // bundle's own widening to the data's finest scale across the whole window
    // (`widen_price_grids_to_data`/`align_native_data_to_instruments`, strategy_factory) still runs
    // after this, re-expressing the bar at that wider, run-fixed precision.
    let target_scale = [
        open.precision,
        high.precision,
        low.precision,
        close.precision,
    ]
    .into_iter()
    .max()
    .unwrap_or(open.precision);
    let open = widen_price_to_scale(open, target_scale)?;
    let high = widen_price_to_scale(high, target_scale)?;
    let low = widen_price_to_scale(low, target_scale)?;
    let close = widen_price_to_scale(close, target_scale)?;

    Bar::new_checked(
        bar_type,
        open,
        high,
        low,
        close,
        volume,
        frame_time_ns.into(),
        frame_time_ns.into(),
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

/// Re-expresses `price` at `target_scale`, exactly: appends fractional zeros only, never rounds.
///
/// Refuses by name when `price` already carries more fractional digits than `target_scale`, which
/// would need rounding to fit.
fn widen_price_to_scale(
    price: Price,
    target_scale: u8,
) -> Result<Price, NativeReplaySchedulingErrorV1> {
    if price.precision == target_scale {
        return Ok(price);
    }
    let widened = Price::from_decimal_dp(price.as_decimal(), target_scale)
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    if widened.as_decimal() != price.as_decimal() {
        return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    Ok(widened)
}

/// Projects one member's complete Quote at the quote cut's instant.
///
/// The member's Quote rows in the quote cut are exactly one complete field set, all at the
/// quote cut's instant: a missing, repeated or differently timed field refuses the frame.
fn project_quote(
    quote_cut: &VerifiedPitObservationBatch,
    instrument_id: InstrumentId,
    instant_ns: u64,
) -> Result<QuoteTick, NativeReplaySchedulingErrorV1> {
    let instrument = instrument_id.to_string();
    let rows = exact_fields(
        quote_cut
            .observations()
            .iter()
            .filter(|row| row.instrument() == instrument && row.data_kind() == "QUOTE"),
        &QUOTE_FIELDS,
    )?;

    if rows.values().any(|row| row.event_effective() != instant_ns) {
        return Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable);
    }
    verify_same_event_coordinate(rows.values().copied())?;
    let bid_price = native_price(rows["BID_PRICE"])?;
    let ask_price = native_price(rows["ASK_PRICE"])?;
    let bid_size = native_quantity(rows["BID_SIZE"], false)?;
    let ask_size = native_quantity(rows["ASK_SIZE"], false)?;

    if bid_price > ask_price
        || bid_price.precision != ask_price.precision
        || bid_size.precision != ask_size.precision
    {
        return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    QuoteTick::new_checked(
        instrument_id,
        bid_price,
        ask_price,
        bid_size,
        ask_size,
        instant_ns.into(),
        instant_ns.into(),
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

fn exact_fields<'a>(
    rows: impl Iterator<Item = &'a VerifiedPitObservation>,
    required: &[&str],
) -> Result<BTreeMap<&'a str, &'a VerifiedPitObservation>, NativeReplaySchedulingErrorV1> {
    let mut values = BTreeMap::new();
    for row in rows.filter(|row| required.contains(&row.field())) {
        if values.insert(row.field(), row).is_some() {
            return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
        }
    }

    if values.len() != required.len() || required.iter().any(|field| !values.contains_key(field)) {
        return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
    }
    Ok(values)
}

fn verify_same_event_coordinate<'a>(
    mut rows: impl Iterator<Item = &'a VerifiedPitObservation>,
) -> Result<(), NativeReplaySchedulingErrorV1> {
    let first = rows
        .next()
        .ok_or(NativeReplaySchedulingErrorV1::FieldCensusMismatch)?;

    if rows.any(|row| {
        row.instrument() != first.instrument()
            || row.channel() != first.channel()
            || row.data_kind() != first.data_kind()
            || row.timeframe() != first.timeframe()
            || row.event_effective() != first.event_effective()
            || row.provider_available() != first.provider_available()
            || row.retrieval() != first.retrieval()
            || row.correction_publication() != first.correction_publication()
            || row.source_binding_identity() != first.source_binding_identity()
            || row.source_frontier_digest() != first.source_frontier_digest()
            || row.instrument_master_digest() != first.instrument_master_digest()
            || row.universe_selection_digest() != first.universe_selection_digest()
            || row.market_semantics_identity() != first.market_semantics_identity()
            || row.correction_stream_identity() != first.correction_stream_identity()
            || row.correction_sequence() != first.correction_sequence()
            || row.correction_frontier_digest() != first.correction_frontier_digest()
    }) {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    Ok(())
}

fn native_price(row: &VerifiedPitObservation) -> Result<Price, NativeReplaySchedulingErrorV1> {
    if row.value_mantissa() <= 0 {
        return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    let raw = native_raw(row)?;
    Price::from_raw_checked(
        PriceRaw::try_from(raw).map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?,
        row.value_scale(),
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

fn native_quantity(
    row: &VerifiedPitObservation,
    allow_zero: bool,
) -> Result<Quantity, NativeReplaySchedulingErrorV1> {
    if row.value_mantissa() < 0 || (!allow_zero && row.value_mantissa() == 0) {
        return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    let raw = native_raw(row)?;
    Quantity::from_raw_checked(
        QuantityRaw::try_from(raw)
            .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?,
        row.value_scale(),
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

fn native_raw(row: &VerifiedPitObservation) -> Result<i128, NativeReplaySchedulingErrorV1> {
    let exponent = i8::try_from(row.value_scale())
        .map(|scale| -scale)
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    mantissa_exponent_to_fixed_i128(row.value_mantissa(), exponent, row.value_scale())
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

/// Whether `members` is an admitted universe in canonical order: one member or two, strictly
/// ascending, so no instrument appears twice.
fn canonical_members(members: &[InstrumentId]) -> bool {
    ADMITTED_UNIVERSE_MEMBER_COUNTS.contains(&members.len())
        && members.windows(2).all(|pair| pair[0] < pair[1])
}

fn digest_receipt(
    batch_digest: BindingDigest,
    (quote_snapshot, quote_fact): (BindingDigest, BindingDigest),
    schedule_digests: &[BindingDigest],
    instruments: &[InstrumentId],
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
    data: &[Data],
) -> Result<BindingDigest, NativeReplaySchedulingErrorV1> {
    let mut hasher = Sha256::new();
    hasher.update(RECEIPT_DOMAIN_V1);

    // The member count comes first, so no receipt over one member can share a preimage with one
    // over two; the quote cut follows the frame's batch because its Quotes are not in that batch.
    hasher.update(
        u64::try_from(instruments.len())
            .map_err(|_| NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?
            .to_be_bytes(),
    );
    hasher.update(batch_digest.as_bytes());
    hasher.update(quote_snapshot.as_bytes());
    hasher.update(quote_fact.as_bytes());
    for digest in schedule_digests {
        hasher.update(digest.as_bytes());
    }

    for instrument in instruments {
        hash_text(&mut hasher, &instrument.to_string())?;
    }
    hasher.update(frame_time_ns.to_be_bytes());
    hasher.update(window_end_ns_exclusive.to_be_bytes());
    hash_native_data_v1(&mut hasher, data)?;
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

/// Hashes the native values a scheduling receipt binds, in order: each BAR's type, prices, volume
/// and instants, each Quote's instrument, prices, sizes and instants.
fn hash_native_data_v1(
    hasher: &mut Sha256,
    data: &[Data],
) -> Result<(), NativeReplaySchedulingErrorV1> {
    for value in data {
        match value {
            Data::Bar(bar) => {
                hasher.update([1]);
                hash_text(hasher, &bar.bar_type.to_string())?;
                for price in [bar.open, bar.high, bar.low, bar.close] {
                    hash_text(hasher, &price.to_string())?;
                }
                hash_text(hasher, &bar.volume.to_string())?;
                hasher.update(bar.ts_event.as_u64().to_be_bytes());
                hasher.update(bar.ts_init.as_u64().to_be_bytes());
            }
            Data::Quote(quote) => {
                hasher.update([2]);
                hash_text(hasher, &quote.instrument_id.to_string())?;
                for price in [quote.bid_price, quote.ask_price] {
                    hash_text(hasher, &price.to_string())?;
                }

                for quantity in [quote.bid_size, quote.ask_size] {
                    hash_text(hasher, &quantity.to_string())?;
                }
                hasher.update(quote.ts_event.as_u64().to_be_bytes());
                hasher.update(quote.ts_init.as_u64().to_be_bytes());
            }
            _ => return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch),
        }
    }
    Ok(())
}

fn hash_text(hasher: &mut Sha256, value: &str) -> Result<(), NativeReplaySchedulingErrorV1> {
    let length = u64::try_from(value.len())
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    hasher.update(length.to_be_bytes());
    hasher.update(value.as_bytes());
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::owner::pit_snapshot::UnverifiedBatchFieldsForTest;
    use crate::owner::{
        bar_schedule::{BarScheduleCutV1, BarScheduleReceiptV1},
        declared_bar_timeframe_v1::declared_bar_timeframe_for_test_v1,
        pit_snapshot::{
            UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
            UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime,
            UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
        },
        source_binding::{
            UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1,
            UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1,
            UntrustedSourceBarTimeframeV1, UntrustedSourceBarUnitV1,
        },
    };

    fn digest(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn execution_request(
        roles: &[(u8, MarketDataFieldSemantic, &str)],
    ) -> NativeReplayInitialMarketRequestV1 {
        NativeReplayInitialMarketRequestV1::new(
            digest(1),
            digest(2),
            digest(3),
            digest(4),
            digest(5),
            digest(6),
            digest(7),
            digest(7),
            digest(8),
            digest(9),
            digest(10),
            roles
                .iter()
                .map(|(identity, field, timeframe)| {
                    NativeReplayInitialUniverseRoleV1::new(
                        digest(*identity),
                        *field,
                        StrategyInputChannel::Market,
                        (*timeframe).to_owned(),
                        StrategyInputUnit::Price,
                        2,
                    )
                })
                .collect(),
            Vec::new(),
            1,
            2,
        )
    }

    /// The frame's timeframe is the execution role's: the one role reading the BAR close. Every
    /// other BAR role must read the same timeframe until roles of several timeframes each resolve
    /// their own last close; a request without a close role, or with two, has no execution role.
    /// Both role orders answer the same, so the timeframe is the execution role's, not the first
    /// role's.
    #[rstest::rstest]
    #[case::open_and_close_on_one_day(&[(41, MarketDataFieldSemantic::BarOpenPrice, "1-DAY"), (42, MarketDataFieldSemantic::BarClosePrice, "1-DAY")], Ok("1-DAY"))]
    #[case::close_alone(&[(42, MarketDataFieldSemantic::BarClosePrice, "4-HOUR")], Ok("4-HOUR"))]
    #[case::open_on_another_timeframe(&[(41, MarketDataFieldSemantic::BarOpenPrice, "4-HOUR"), (42, MarketDataFieldSemantic::BarClosePrice, "1-DAY")], Err(NativeReplaySchedulingErrorV1::MoreThanOneRoleTimeframe))]
    #[case::no_close(&[(41, MarketDataFieldSemantic::BarOpenPrice, "1-DAY")], Err(NativeReplaySchedulingErrorV1::ExecutionRoleAbsent))]
    #[case::two_closes(&[(41, MarketDataFieldSemantic::BarClosePrice, "1-DAY"), (42, MarketDataFieldSemantic::BarClosePrice, "1-DAY")], Err(NativeReplaySchedulingErrorV1::ExecutionRoleAmbiguous))]
    fn the_frame_timeframe_is_the_execution_roles(
        #[case] roles: &[(u8, MarketDataFieldSemantic, &str)],
        #[case] expected: Result<&str, NativeReplaySchedulingErrorV1>,
    ) {
        let mut reversed = roles.to_vec();
        reversed.reverse();

        for roles in [roles, reversed.as_slice()] {
            assert_eq!(execution_request(roles).execution_timeframe(), expected);
        }
    }

    fn row(
        instrument: &str,
        data_kind: &str,
        timeframe: &str,
        field: &str,
        mantissa: i128,
        scale: u8,
        event: u64,
    ) -> VerifiedPitObservation {
        VerifiedPitObservation {
            symbolic_key: format!("{instrument}.{field}"),
            member_key: instrument.to_owned(),
            instrument: instrument.to_owned(),
            channel: "MARKET".to_owned(),
            data_kind: data_kind.to_owned(),
            timeframe: timeframe.to_owned(),
            field: field.to_owned(),
            value_mantissa: mantissa,
            value_scale: scale,
            event_effective: event,
            provider_available: event,
            retrieval: event,
            correction_publication: event,
            source_binding_identity: digest(3),
            source_frontier_digest: digest(4),
            instrument_master_digest: digest(5),
            universe_selection_digest: digest(6),
            market_semantics_identity: digest(7),
            correction_stream_identity: "market-corrections".to_owned(),
            correction_sequence: 1,
            correction_frontier_digest: digest(8),
        }
    }

    /// One member's complete BAR at the fixture frame's instant, 100.
    fn rows_for(instrument: &str) -> Vec<VerifiedPitObservation> {
        bar_rows_at(instrument, 100, 0)
    }

    /// One member's complete Quote at `instant`.
    fn quote_rows(instrument: &str, instant: u64) -> Vec<VerifiedPitObservation> {
        [
            ("BID_PRICE", 10_000, 2),
            ("ASK_PRICE", 10_001, 2),
            ("BID_SIZE", 100, 0),
            ("ASK_SIZE", 100, 0),
        ]
        .into_iter()
        .map(|(field, mantissa, scale)| {
            row(instrument, "QUOTE", "TICK", field, mantissa, scale, instant)
        })
        .collect()
    }

    /// A quote cut of `frame` at `instant`: a snapshot of its own on the frame's coordinates,
    /// holding exactly `rows`.
    pub(crate) fn quote_cut_with(
        frame: &VerifiedPitObservationBatch,
        rows: Vec<VerifiedPitObservation>,
        instant: u64,
    ) -> VerifiedPitObservationBatch {
        let seed = frame.snapshot_identity_for_test().as_bytes()[0];
        let selection = frame.universe_selection_digest();
        batch(rows).edit_for_test(|fields| {
            *fields.snapshot_identity_mut_for_test() = digest(seed.wrapping_add(100));
            *fields.fact_digest_mut_for_test() = digest(seed.wrapping_add(101));
            fields.digest = digest(seed.wrapping_add(102));
            fields.universe_selection_digest = selection;
            fields.time_evidence.event_effective =
                UntrustedEventEffectiveTime::from_untrusted(instant, "clock", "epoch");

            for row in &mut fields.observations {
                row.universe_selection_digest = selection;
            }
        })
    }

    /// A quote cut of `frame` at `instant` quoting each of `members` once.
    pub(crate) fn quote_cut_for(
        frame: &VerifiedPitObservationBatch,
        members: &[&str],
        instant: u64,
    ) -> VerifiedPitObservationBatch {
        quote_cut_with(
            frame,
            members
                .iter()
                .flat_map(|member| quote_rows(member, instant))
                .collect(),
            instant,
        )
    }

    fn two_member_frame() -> VerifiedPitObservationBatch {
        let mut rows = rows_for("AAA-PERP.SIM");
        rows.extend(rows_for("BBB-PERP.SIM"));
        batch(rows)
    }

    fn bar_rows_at(instrument: &str, event: u64, drift: i128) -> Vec<VerifiedPitObservation> {
        [
            ("OPEN", 10_000 + drift, 2),
            ("HIGH", 10_100 + drift, 2),
            ("LOW", 9_900 + drift, 2),
            ("CLOSE", 10_050 + drift, 2),
            ("VOLUME", 1_000, 0),
        ]
        .into_iter()
        .map(|(field, mantissa, scale)| row(instrument, "BAR", "1M", field, mantissa, scale, event))
        .collect()
    }

    fn batch(rows: Vec<VerifiedPitObservation>) -> VerifiedPitObservationBatch {
        VerifiedPitObservationBatch::from_fields_for_test(UnverifiedBatchFieldsForTest {
            request_identity: digest(10),
            request_digest: digest(11),
            correlation_identity: digest(18),
            scope_digest: digest(17),
            source: crate::owner::pit_window_custody_v1::PitObservationBatchSourceV1::CommittedSnapshot {
                snapshot_identity: digest(12),
                fact_digest: digest(13),
            },
            source_binding_identity: digest(3),
            source_binding_fact_digest: digest(19),
            source_binding_lineage_root: digest(14),
            source_binding_lineage_version: 1,
            source_frontier_digest: digest(4),
            correction_frontier_digest: digest(8),
            instrument_master_digest: digest(5),
            universe_selection_digest: digest(6),
            market_semantics_identity: digest(7),
            time_evidence: UntrustedPitSnapshotTimeEvidence {
                event_effective: UntrustedEventEffectiveTime::from_untrusted(100, "clock", "epoch"),
                provider_available: UntrustedProviderAvailableTime::from_untrusted(
                    100, "clock", "epoch",
                ),
                retrieval: UntrustedRetrievalTime::from_untrusted(100, "clock", "epoch"),
                correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                    100, "clock", "epoch",
                )),
                decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(200, "clock", "epoch"),
                monotonic_sequence: 1,
                restart_continuity_digest: digest(15),
                skew_bound: 1,
                uncertainty_bound: 1,
                observed_at: 200,
                valid_through: 300,
            },
            digest: digest(16),
            observations: rows.into_boxed_slice(),
        })
    }

    /// The bar every fixture schedule states: what the fixture batches' Source Binding declares for
    /// its `1M` rows.
    pub(crate) fn declared_minute() -> DeclaredBarTimeframeV1 {
        declared_minute_for(digest(19))
    }

    /// The same one-minute bar, declared by the binding fact `binding_fact_digest`.
    pub(crate) fn declared_minute_for(
        binding_fact_digest: BindingDigest,
    ) -> DeclaredBarTimeframeV1 {
        declared_bar_timeframe_for_test_v1(
            binding_fact_digest,
            &UntrustedSourceBarTimeframeV1 {
                row_timeframe: "1M".to_owned(),
                cadence: UntrustedSourceBarCadenceV1::FixedInterval {
                    step: 1,
                    unit: UntrustedSourceBarUnitV1::Minute,
                },
                anchor: UntrustedSourceBarAnchorV1::SessionOpen,
                clock: UntrustedSourceBarClockV1::ScheduleBounded,
                label: UntrustedSourceBarLabelV1::IntervalClose,
                completion: UntrustedSourceBarCompletionV1::CompleteOnly,
            },
        )
    }

    fn schedule(instrument: &str, identity: u8) -> BarScheduleReadbackV1 {
        schedule_at(instrument, identity, 100)
    }

    pub(crate) fn schedule_at(
        instrument: &str,
        identity: u8,
        cut_effective_instant: u64,
    ) -> BarScheduleReadbackV1 {
        schedule_bound(
            instrument,
            identity,
            cut_effective_instant,
            [digest(5), digest(7), digest(4), digest(8)],
        )
    }

    /// A schedule that shares `batch`'s Instrument Master, Market Semantics and both frontiers and is
    /// cut at the batch's own instant, so a seal over that batch gets past every schedule check.
    pub(crate) fn schedule_bound_to_batch(
        instrument: &str,
        identity: u8,
        batch: &VerifiedPitObservationBatch,
    ) -> BarScheduleReadbackV1 {
        schedule_bound(
            instrument,
            identity,
            batch.time_evidence().event_effective.value,
            [
                batch.instrument_master_digest(),
                batch.market_semantics_identity(),
                batch.source_frontier_digest(),
                batch.correction_frontier_digest(),
            ],
        )
    }

    fn schedule_bound(
        instrument: &str,
        identity: u8,
        cut_effective_instant: u64,
        [
            instrument_master,
            market_semantics,
            source_frontier,
            correction_frontier,
        ]: [BindingDigest; 4],
    ) -> BarScheduleReadbackV1 {
        let fact_identity = digest(identity);
        let cut_identity = digest(identity + 20);
        let fact = BarScheduleFactV1 {
            canonical_instrument: instrument.to_owned(),
            predecessor_fact_digest: None,
            effective_from: 0,
            effective_until: None,
            kind: BarScheduleKindV1::FixedInterval,
            step: 1,
            unit: BarScheduleUnitV1::Minute,
            anchor_identity: anchor_identity_v1(DeclaredBarAnchorV1::SessionOpen),
            calendar_identity: digest(31),
            session_identity: digest(32),
            time_zone_identity: digest(33),
            label: BarScheduleLabelV1::IntervalClose,
            completion: BarScheduleCompletionV1::CompleteOnly,
            instrument_master_digest: instrument_master,
            instrument_master_fact_digest: digest(identity + 40),
            instrument_master_cut_digest: digest(34),
            market_semantics_identity: market_semantics,
            schedule_source_frontier: source_frontier,
            schedule_correction_frontier: correction_frontier,
            cut_effective_instant: i128::from(cut_effective_instant),
            canonical_bytes: vec![identity],
            identity: fact_identity,
        };
        BarScheduleReadbackV1 {
            fact,
            cut: BarScheduleCutV1 {
                fact_digest: fact_identity,
                canonical_instrument: instrument.to_owned(),
                effective_instant: 100,
                instrument_master_digest: instrument_master,
                instrument_master_fact_digest: digest(identity + 40),
                instrument_master_cut_digest: digest(34),
                market_semantics_identity: market_semantics,
                source_frontier,
                correction_frontier,
                canonical_bytes: vec![identity + 1],
                identity: cut_identity,
            },
            receipt: BarScheduleReceiptV1 {
                fact_digest: fact_identity,
                cut_digest: cut_identity,
                store_generation_identity: digest(35),
                store_append_sequence: 1,
                canonical_bytes: vec![identity + 2],
                identity: digest(identity + 21),
            },
            canonical_bytes: vec![identity + 3],
            identity: digest(identity + 22),
        }
    }

    /// One complete Owner readback for a frame at `frame_time_ns`, through the real issue path.
    ///
    /// The issuer runs rather than being bypassed, so a fixture cannot hand a consumer a readback
    /// the Owner would have refused. Each frame carries its own snapshot identity, which is what
    /// makes a sequence of them distinct cuts rather than one cut named several times.
    pub(crate) fn frame_readback(
        seed: u8,
        frame_time_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> NativeReplayInitialMarketReadbackV1 {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = Vec::new();

        for instrument in ["AAA-PERP.SIM", "BBB-PERP.SIM"] {
            rows.extend(bar_rows_at(instrument, frame_time_ns, i128::from(seed)));
        }

        let verified = batch(rows).edit_for_test(|fields| {
            *fields.snapshot_identity_mut_for_test() = digest(seed);
            *fields.fact_digest_mut_for_test() = digest(seed.wrapping_add(1));
            fields.time_evidence.event_effective =
                UntrustedEventEffectiveTime::from_untrusted(frame_time_ns, "clock", "epoch");
        });
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&verified)
            .expect("derived Owner selection");
        let selection_identity = selection.selection_identity();
        let selection_digest = selection.selection_digest();
        let request = NativeReplayInitialMarketRequestV1::new(
            digest(seed),
            digest(seed.wrapping_add(1)),
            digest(20),
            digest(21),
            selection_identity,
            selection_digest,
            verified.universe_selection_digest(),
            verified.universe_selection_digest(),
            digest(5),
            digest(14),
            digest(7),
            vec![NativeReplayInitialUniverseRoleV1::new(
                digest(23),
                MarketDataFieldSemantic::BarClosePrice,
                StrategyInputChannel::Market,
                "1M".to_string(),
                StrategyInputUnit::Price,
                2,
            )],
            vec![first, second],
            frame_time_ns,
            window_end_ns_exclusive,
        );
        let quote_cut = quote_cut_for(
            &verified,
            &["AAA-PERP.SIM", "BBB-PERP.SIM"],
            frame_time_ns + 1,
        );
        issue_native_replay_initial_market_readback_v1(
            verified,
            quote_cut,
            [
                schedule_at("AAA-PERP.SIM", 40, frame_time_ns),
                schedule_at("BBB-PERP.SIM", 41, frame_time_ns),
            ],
            declared_minute(),
            &request,
        )
        .expect("exact initial Market Data readback")
    }

    /// The quote cut reaches only the fill. A frame decided on its own instant, as every intake
    /// mints one, holds its members' BAR and Quotes at that instant and takes a quote cut published
    /// after its decision cut. Whatever roles the readback binds, it either refuses them or binds
    /// every strategy input from a row of the frame's own batch that its decision cut could see,
    /// never from a row of the quote cut.
    ///
    /// No single change can bind a quote cut row while the binding still succeeds: a readback
    /// always has a BAR role (`schedule_timeframe`), a quote cut holds Quote rows alone, and a
    /// universe frame refuses values of another event kind or instant than its first
    /// (`issue_universe_trigger_receipt`). A Quote role beside the BAR role is therefore refused
    /// here, and the tracing below is what stands if both of those change at once.
    #[rstest::rstest]
    fn a_quote_cut_published_after_the_decision_reaches_only_the_fill() {
        let decided_at = |batch: VerifiedPitObservationBatch, cut: u64| {
            batch.edit_for_test(|fields| {
                fields.time_evidence.event_effective =
                    UntrustedEventEffectiveTime::from_untrusted(cut, "clock", "epoch");
                fields.time_evidence.decision_cut =
                    UntrustedSnapshotDecisionCut::from_untrusted(cut, "clock", "epoch");
                fields.time_evidence.observed_at = cut;
            })
        };
        let members = ["AAA-PERP.SIM", "BBB-PERP.SIM"];
        let mut rows = Vec::new();

        for member in members {
            rows.extend(bar_rows_at(member, 100, 0));
            rows.extend(quote_rows(member, 100));
        }
        let frame = decided_at(batch(rows), 100);
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&frame)
            .expect("derived Owner selection");
        let record = frame.universe_selection_digest();
        assert_ne!(
            record,
            selection.selection_digest(),
            "the batch's Record and its derived selection are different keys, as in production"
        );
        let quote_cut = decided_at(quote_cut_for(&frame, &members, 101), 101);
        let decision_cut = frame.time_evidence().decision_cut.value;
        let row_digest = crate::owner::strategy_input_binding::canonical_row_digest_for_test;
        let visible_at_the_decision = frame
            .observations()
            .iter()
            .filter(|row| row.event_effective <= decision_cut)
            .map(row_digest)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(visible_at_the_decision.len(), frame.observations().len());
        assert!(
            quote_cut
                .observations()
                .iter()
                .all(|row| row.event_effective > decision_cut),
            "every Quote of the quote cut follows the decision"
        );
        let quoted_after = quote_cut
            .observations()
            .iter()
            .map(row_digest)
            .collect::<std::collections::BTreeSet<_>>();
        let close = NativeReplayInitialUniverseRoleV1::new(
            digest(23),
            MarketDataFieldSemantic::BarClosePrice,
            StrategyInputChannel::Market,
            "1M".to_string(),
            StrategyInputUnit::Price,
            2,
        );
        let bid = NativeReplayInitialUniverseRoleV1::new(
            digest(24),
            MarketDataFieldSemantic::QuoteBidPrice,
            StrategyInputChannel::Market,
            "TICK".to_string(),
            StrategyInputUnit::Price,
            2,
        );

        for roles in [vec![close.clone()], vec![close, bid]] {
            let with_bid = roles.len() == 2;
            let request = NativeReplayInitialMarketRequestV1::new(
                frame.snapshot_identity_for_test(),
                frame.fact_digest_for_test(),
                digest(20),
                digest(21),
                selection.selection_identity(),
                selection.selection_digest(),
                record,
                record,
                digest(5),
                digest(14),
                digest(7),
                roles,
                members.map(InstrumentId::from).to_vec(),
                100,
                1_000,
            );
            let issued = issue_native_replay_initial_market_readback_v1(
                frame.clone(),
                quote_cut.clone(),
                [
                    schedule_at("AAA-PERP.SIM", 40, 100),
                    schedule_at("BBB-PERP.SIM", 41, 100),
                ],
                declared_minute(),
                &request,
            );

            match issued {
                Ok(readback) => {
                    let inputs = readback.universe_frame();
                    assert_eq!(
                        inputs.trigger().snapshot_identity_for_test(),
                        frame.snapshot_identity_for_test()
                    );
                    assert_eq!(inputs.values().len(), members.len() * request.roles.len());

                    for value in inputs.values() {
                        assert!(
                            visible_at_the_decision.contains(&value.canonical_row_digest())
                                && !quoted_after.contains(&value.canonical_row_digest()),
                            "{} is bound from a row the decision cut could see",
                            value.value_type_semantic_id()
                        );
                    }
                }
                Err(e) => {
                    assert!(with_bid, "the frame binds its BAR role: {e:?}");
                    assert_eq!(e, NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
                }
            }
        }
    }

    pub(crate) fn window_request(
        frame_time_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> NativeReplayInitialMarketRequestV1 {
        let verified = two_member_frame();
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&verified)
            .expect("derived Owner selection");
        NativeReplayInitialMarketRequestV1::new(
            digest(0),
            digest(0),
            digest(20),
            digest(21),
            selection.selection_identity(),
            selection.selection_digest(),
            verified.universe_selection_digest(),
            verified.universe_selection_digest(),
            digest(5),
            digest(14),
            digest(7),
            vec![NativeReplayInitialUniverseRoleV1::new(
                digest(23),
                MarketDataFieldSemantic::BarClosePrice,
                StrategyInputChannel::Market,
                "1M".to_string(),
                StrategyInputUnit::Price,
                2,
            )],
            vec![
                InstrumentId::from("AAA-PERP.SIM"),
                InstrumentId::from("BBB-PERP.SIM"),
            ],
            frame_time_ns,
            window_end_ns_exclusive,
        )
    }

    /// A window with one matching schedule selects it; none and two are both refusals.
    ///
    /// Two matching candidates are the case worth pinning: the resolver reads every schedule an
    /// instrument holds, so a second one that also fits this frame is ambiguity the census cannot
    /// resolve. Taking the first would make the frame depend on the order rows came back in.
    #[rstest::rstest]
    fn one_candidate_schedule_is_selected_and_two_are_refused() {
        let verified = two_member_frame();
        let instrument = InstrumentId::from("AAA-PERP.SIM");
        let matching_digest = schedule_at("AAA-PERP.SIM", 40, 100).digest();

        assert_eq!(
            select_native_replay_schedule_v1(
                vec![schedule_at("AAA-PERP.SIM", 40, 100)],
                &verified,
                instrument,
                &declared_minute(),
                100,
            )
            .map(|selected| selected.digest()),
            Ok(matching_digest)
        );

        // A schedule cut at another instant is not this frame's, so the window has none.
        assert_eq!(
            select_native_replay_schedule_v1(
                vec![schedule_at("AAA-PERP.SIM", 40, 160)],
                &verified,
                instrument,
                &declared_minute(),
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame)
        );

        // Two distinct schedules that both fit cannot be chosen between.
        assert_eq!(
            select_native_replay_schedule_v1(
                vec![
                    schedule_at("AAA-PERP.SIM", 40, 100),
                    schedule_at("AAA-PERP.SIM", 42, 100),
                ],
                &verified,
                instrument,
                &declared_minute(),
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
        );

        // Another member's schedule never matches this member's frame.
        assert_eq!(
            select_native_replay_schedule_v1(
                vec![schedule_at("BBB-PERP.SIM", 41, 100)],
                &verified,
                instrument,
                &declared_minute(),
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame)
        );
    }

    fn two_members() -> Vec<InstrumentId> {
        vec![
            InstrumentId::from("AAA-PERP.SIM"),
            InstrumentId::from("BBB-PERP.SIM"),
        ]
    }

    fn two_schedules() -> Vec<BarScheduleReadbackV1> {
        vec![schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)]
    }

    /// The receipt's bytes for this fixture, pinned so a layout change is a decision and not an
    /// accident. It was first sealed when the frame began taking its Quotes from its quote cut.
    #[rstest::rstest]
    fn a_receipt_keeps_its_bytes() {
        let frame = two_member_frame();
        let quote_cut = quote_cut_for(&frame, &["AAA-PERP.SIM", "BBB-PERP.SIM"], 101);
        let readback = seal_native_replay_scheduling_v1(
            frame,
            quote_cut,
            two_schedules(),
            &declared_minute(),
            two_members(),
            100,
            200,
        )
        .unwrap();
        let pinned = "c28f9c3148c6a05a6f4a849e36599123ae0312fea30c765202d66a0ff57f0925";
        let expected = (0..pinned.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(&pinned[at..at + 2], 16).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            readback.receipt_digest().as_bytes().as_slice(),
            expected.as_slice()
        );
    }

    /// The receipt states the member count first and binds the quote cut after the frame's batch.
    ///
    /// Checked against the layout rebuilt by hand, for one member and for two, so neither count
    /// can share a preimage with the other and a receipt cannot be moved to another quote cut.
    #[rstest::rstest]
    fn a_receipt_states_its_member_count_and_binds_its_quote_cut() {
        let quote_cut = (digest(50), digest(51));
        let by_hand = |schedule_digests: &[BindingDigest], instruments: &[InstrumentId]| {
            let mut hasher = Sha256::new();
            hasher.update(RECEIPT_DOMAIN_V1);
            hasher.update(u64::try_from(instruments.len()).unwrap().to_be_bytes());
            hasher.update(digest(9).as_bytes());
            hasher.update(digest(50).as_bytes());
            hasher.update(digest(51).as_bytes());

            for schedule_digest in schedule_digests {
                hasher.update(schedule_digest.as_bytes());
            }

            for instrument in instruments {
                hash_text(&mut hasher, &instrument.to_string()).unwrap();
            }
            hasher.update(100_u64.to_be_bytes());
            hasher.update(200_u64.to_be_bytes());
            BindingDigest::from_untrusted_bytes(hasher.finalize().into())
        };
        let schedule_digests = [digest(40), digest(41)];
        let members = two_members();

        for count in [1, 2] {
            assert_eq!(
                digest_receipt(
                    digest(9),
                    quote_cut,
                    &schedule_digests[..count],
                    &members[..count],
                    100,
                    200,
                    &[],
                )
                .unwrap(),
                by_hand(&schedule_digests[..count], &members[..count]),
                "{count} member(s)"
            );
        }
        let elsewhere = (digest(53), quote_cut.1);
        assert_ne!(
            digest_receipt(
                digest(9),
                elsewhere,
                &schedule_digests,
                &members,
                100,
                200,
                &[]
            )
            .unwrap(),
            by_hand(&schedule_digests, &members),
            "another quote cut is another receipt"
        );
    }

    #[rstest::rstest]
    fn seals_a_one_member_bar_then_quote_schedule() {
        let member = InstrumentId::from("AAA-PERP.SIM");
        let frame = batch(rows_for("AAA-PERP.SIM"));
        let quote_cut = quote_cut_for(&frame, &["AAA-PERP.SIM"], 150);
        let readback = seal_native_replay_scheduling_v1(
            frame,
            quote_cut,
            vec![schedule("AAA-PERP.SIM", 40)],
            &declared_minute(),
            vec![member],
            100,
            200,
        )
        .expect("a one-member schedule");

        assert_eq!(readback.member_instruments(), [member]);
        assert_eq!(readback.bar_schedule_digests().len(), 1);
        assert_eq!(readback.quote_cut().instant_ns(), 150);
        let (bar_types, data) = readback.into_native_schedule();
        assert_eq!(bar_types.len(), 1);
        assert!(matches!(
            data.as_slice(),
            [Data::Bar(bar), Data::Quote(quote)]
                if bar.ts_event.as_u64() == 100 && quote.ts_event.as_u64() == 150
        ));
    }

    /// A real BTC 0.10-tick bar - open 65000.10, high 65400.00, low 64800.50, close 65210.30 -
    /// canonicalizes to precisions 1, 0, 1, 1: `HIGH`'s trailing zero drops where the others'
    /// do not. Before the fix this bar refused as `NativeRepresentation` (measured on this
    /// repository before the widening landed); every real frame showing this shape would have
    /// refused T0-6's U1 milestone outright. The widened bar must carry every price at precision
    /// 1 - the bar's own finest - with no value rounded.
    #[rstest::rstest]
    fn a_bar_whose_fields_canonicalize_to_different_precisions_still_seals() {
        let member = InstrumentId::from("BTCUSDT-PERP.SIM");
        let rows = [
            ("OPEN", 650_001, 1),
            ("HIGH", 65_400, 0),
            ("LOW", 648_005, 1),
            ("CLOSE", 652_103, 1),
            ("VOLUME", 15_000, 0),
        ]
        .into_iter()
        .map(|(field, mantissa, scale)| {
            row("BTCUSDT-PERP.SIM", "BAR", "1M", field, mantissa, scale, 100)
        })
        .collect::<Vec<_>>();
        let frame = batch(rows);
        let quote_cut = quote_cut_for(&frame, &["BTCUSDT-PERP.SIM"], 150);
        let readback = seal_native_replay_scheduling_v1(
            frame,
            quote_cut,
            vec![schedule("BTCUSDT-PERP.SIM", 40)],
            &declared_minute(),
            vec![member],
            100,
            200,
        )
        .expect("a bar whose fields canonicalize to different precisions still seals");
        let (_, data) = readback.into_native_schedule();
        let Data::Bar(bar) = &data[0] else {
            panic!("the first datum is the member's BAR");
        };
        assert_eq!(
            [
                bar.open.precision,
                bar.high.precision,
                bar.low.precision,
                bar.close.precision
            ],
            [1, 1, 1, 1],
            "every field widens to the bar's own finest precision"
        );
        assert_eq!(bar.open.to_string(), "65000.1");
        assert_eq!(bar.high.to_string(), "65400.0");
        assert_eq!(bar.low.to_string(), "64800.5");
        assert_eq!(bar.close.to_string(), "65210.3");
    }

    /// Members are an admitted universe in canonical order or nothing: none, three, a repeated or
    /// a reordered member, and a schedule list of another length, are all refused.
    #[rstest::rstest]
    fn seals_only_an_admitted_canonical_member_list() {
        let a = InstrumentId::from("AAA-PERP.SIM");
        let b = InstrumentId::from("BBB-PERP.SIM");
        let c = InstrumentId::from("CCC-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM");
        rows.extend(rows_for("BBB-PERP.SIM"));
        rows.extend(rows_for("CCC-PERP.SIM"));
        let frame = batch(rows);
        let quote_cut = quote_cut_for(
            &frame,
            &["AAA-PERP.SIM", "BBB-PERP.SIM", "CCC-PERP.SIM"],
            101,
        );
        let seal = |schedules: Vec<BarScheduleReadbackV1>, members: Vec<InstrumentId>| {
            seal_native_replay_scheduling_v1(
                frame.clone(),
                quote_cut.clone(),
                schedules,
                &declared_minute(),
                members,
                100,
                200,
            )
            .map(|_| ())
        };
        let one = || schedule("AAA-PERP.SIM", 40);

        for (schedules, members) in [
            (Vec::new(), Vec::new()),
            (
                vec![
                    schedule("AAA-PERP.SIM", 40),
                    schedule("BBB-PERP.SIM", 41),
                    schedule("CCC-PERP.SIM", 42),
                ],
                vec![a, b, c],
            ),
            (vec![one(), one()], vec![a, a]),
            (
                vec![schedule("BBB-PERP.SIM", 41), schedule("AAA-PERP.SIM", 40)],
                vec![b, a],
            ),
            (two_schedules(), vec![a]),
        ] {
            assert_eq!(
                seal(schedules, members),
                Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
            );
        }
    }

    #[rstest::rstest]
    fn seals_every_bar_then_every_quote_at_the_quote_cuts_instant() {
        let frame = two_member_frame();
        let quote_cut = quote_cut_for(&frame, &["AAA-PERP.SIM", "BBB-PERP.SIM"], 101);
        let readback = seal_native_replay_scheduling_v1(
            frame,
            quote_cut,
            two_schedules(),
            &declared_minute(),
            two_members(),
            100,
            200,
        )
        .unwrap();

        assert_eq!(readback.member_instruments(), two_members());
        assert_eq!(
            readback
                .quote_cut()
                .committed_snapshot()
                .map(|(snapshot, _)| snapshot),
            Some(digest(112))
        );
        assert_eq!(readback.quote_cut().instant_ns(), 101);
        let (_, data) = readback.into_native_schedule();
        let [
            Data::Bar(first_bar),
            Data::Bar(second_bar),
            Data::Quote(first_quote),
            Data::Quote(second_quote),
        ] = data.as_slice()
        else {
            panic!("two BARs then two Quotes");
        };
        assert_eq!(
            [
                first_bar.bar_type.instrument_id(),
                second_bar.bar_type.instrument_id(),
                first_quote.instrument_id,
                second_quote.instrument_id,
            ],
            [
                two_members()[0],
                two_members()[1],
                two_members()[0],
                two_members()[1]
            ]
        );
        assert!(
            [first_quote, second_quote]
                .iter()
                .all(|quote| quote.ts_event.as_u64() == 101 && quote.ts_init == quote.ts_event),
            "both members' Quotes share the quote cut's instant"
        );
    }

    /// A batch is the frame's quote cut or it is refused: a quote cut at or past the bound, one on
    /// other coordinates or members, a frame offered as a quote cut, or a Quote at another instant
    /// than its cut's.
    #[rstest::rstest]
    fn seals_only_the_frames_own_quote_cut() {
        let frame = two_member_frame();
        let both = ["AAA-PERP.SIM", "BBB-PERP.SIM"];
        let seal = |quote_cut: VerifiedPitObservationBatch| {
            seal_native_replay_scheduling_v1(
                frame.clone(),
                quote_cut,
                two_schedules(),
                &declared_minute(),
                two_members(),
                100,
                200,
            )
            .map(|_| ())
            .unwrap_err()
        };

        assert_eq!(
            seal(quote_cut_for(&frame, &both, 200)),
            NativeReplaySchedulingErrorV1::EventOrderUnavailable,
            "at the bound"
        );
        assert_eq!(
            seal(quote_cut_for(&frame, &both, 100)),
            NativeReplaySchedulingErrorV1::OwnerBindingMismatch,
            "on the frame's own instant"
        );
        assert_eq!(
            seal(
                quote_cut_for(&frame, &both, 101)
                    .edit_for_test(|fields| fields.scope_digest = digest(90))
            ),
            NativeReplaySchedulingErrorV1::OwnerBindingMismatch,
            "another scope"
        );
        assert_eq!(
            seal(quote_cut_for(&frame, &["AAA-PERP.SIM"], 101)),
            NativeReplaySchedulingErrorV1::OwnerBindingMismatch,
            "a member unquoted"
        );
        assert_eq!(
            seal(two_member_frame()),
            NativeReplaySchedulingErrorV1::OwnerBindingMismatch,
            "a frame is not a quote cut"
        );
        let mut rows = quote_rows("AAA-PERP.SIM", 101);
        rows.extend(quote_rows("BBB-PERP.SIM", 102));
        assert_eq!(
            seal(quote_cut_with(&frame, rows, 101)),
            NativeReplaySchedulingErrorV1::EventOrderUnavailable,
            "a Quote off its cut's instant"
        );
    }

    #[rstest::rstest]
    fn initial_market_readback_projects_exact_repair_scope_and_correlation() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let batch = two_member_frame();
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&batch)
            .expect("derived Owner selection");
        let selection_identity = selection.selection_identity();
        let selection_digest = selection.selection_digest();
        let request = NativeReplayInitialMarketRequestV1::new(
            digest(12),
            digest(13),
            digest(20),
            digest(21),
            selection_identity,
            selection_digest,
            batch.universe_selection_digest(),
            batch.universe_selection_digest(),
            digest(5),
            digest(14),
            digest(7),
            vec![NativeReplayInitialUniverseRoleV1::new(
                digest(23),
                MarketDataFieldSemantic::BarClosePrice,
                StrategyInputChannel::Market,
                "1M".to_string(),
                StrategyInputUnit::Price,
                2,
            )],
            vec![first, second],
            100,
            200,
        );
        let quote_cut = quote_cut_for(&batch, &["AAA-PERP.SIM", "BBB-PERP.SIM"], 101);
        let readback = issue_native_replay_initial_market_readback_v1(
            batch,
            quote_cut,
            [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
            declared_minute(),
            &request,
        )
        .expect("exact initial Market Data readback");

        let source = readback.into_market_data_repair_source();
        let frame = two_member_frame();
        let at_window_end = quote_cut_for(&frame, &["AAA-PERP.SIM", "BBB-PERP.SIM"], 200);
        assert_eq!(
            issue_native_replay_initial_market_readback_v1(
                frame,
                at_window_end,
                [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
                declared_minute(),
                &request,
            )
            .map(|_| ())
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::EventOrderUnavailable,
            "a readback is issued only with its frame's own quote cut before the window's end"
        );
        assert_eq!(source.pit_request_identity(), digest(10));
        assert_eq!(source.pit_request_digest(), digest(11));
        assert_eq!(source.correlation_identity(), digest(18));
        assert_eq!(source.instrument_scope_digest(), digest(17));
        assert_eq!(
            source.universe_selection_digest(),
            digest(6),
            "the repair scope names the Universe Selection Record the frame's batch binds"
        );
        assert_eq!(source.source_binding_fact_digest(), digest(19));
        assert_eq!(source.pit_snapshot_identity(), digest(12));
        assert_eq!(source.pit_snapshot_fact_digest(), digest(13));
    }

    /// A frame's two universe selections are each checked against its batch. Under the same
    /// strategy-input selection, a Replay naming the Record the batch binds is issued, and one
    /// naming another Record, by identity, by digest or by both, is refused by name.
    #[rstest::rstest]
    #[case::same_record(None, None, None)]
    #[case::another_identity(
        Some(99),
        None,
        Some(NativeReplaySchedulingErrorV1::UniverseSelectionRecordMismatch)
    )]
    #[case::another_digest(
        None,
        Some(99),
        Some(NativeReplaySchedulingErrorV1::UniverseSelectionRecordMismatch)
    )]
    #[case::another_record(
        Some(99),
        Some(99),
        Some(NativeReplaySchedulingErrorV1::UniverseSelectionRecordMismatch)
    )]
    fn a_replay_is_issued_only_under_the_universe_selection_record_its_batch_binds(
        #[case] identity: Option<u8>,
        #[case] record_digest: Option<u8>,
        #[case] refusal: Option<NativeReplaySchedulingErrorV1>,
    ) {
        let batch = two_member_frame();
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&batch)
            .expect("derived Owner selection");
        let record = batch.universe_selection_digest();
        assert_ne!(
            record,
            selection.selection_digest(),
            "the batch's Record and its derived selection are different keys, as in production"
        );
        let request = NativeReplayInitialMarketRequestV1::new(
            digest(12),
            digest(13),
            digest(20),
            digest(21),
            selection.selection_identity(),
            selection.selection_digest(),
            identity.map_or(record, digest),
            record_digest.map_or(record, digest),
            digest(5),
            digest(14),
            digest(7),
            vec![NativeReplayInitialUniverseRoleV1::new(
                digest(23),
                MarketDataFieldSemantic::BarClosePrice,
                StrategyInputChannel::Market,
                "1M".to_string(),
                StrategyInputUnit::Price,
                2,
            )],
            two_members(),
            100,
            200,
        );
        let quote_cut = quote_cut_for(&batch, &["AAA-PERP.SIM", "BBB-PERP.SIM"], 101);
        let issued = issue_native_replay_initial_market_readback_v1(
            batch,
            quote_cut,
            two_schedules(),
            declared_minute(),
            &request,
        );

        assert_eq!(issued.map(|_| ()).err(), refusal);
    }

    /// A Design whose roles name one exact instrument does not run under an Owner universe. The
    /// read refuses it by name before it would replace the role's scope with the universe's.
    #[rstest::rstest]
    fn an_exact_instrument_role_is_refused_under_an_owner_universe() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let batch = two_member_frame();
        let quote_cut = quote_cut_for(&batch, &["AAA-PERP.SIM", "BBB-PERP.SIM"], 101);
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&batch)
            .expect("derived Owner selection");
        let role = |scope| {
            NativeReplayInitialUniverseRoleV1::new(
                digest(23),
                MarketDataFieldSemantic::BarClosePrice,
                StrategyInputChannel::Market,
                "1M".to_string(),
                StrategyInputUnit::Price,
                2,
            )
            .with_declared_scope(scope)
        };
        let request = NativeReplayInitialMarketRequestV1::new(
            digest(12),
            digest(13),
            digest(20),
            digest(21),
            selection.selection_identity(),
            selection.selection_digest(),
            batch.universe_selection_digest(),
            batch.universe_selection_digest(),
            digest(5),
            digest(14),
            digest(7),
            vec![
                role(NativeReplayRoleScopeV1::UniverseMembers),
                role(NativeReplayRoleScopeV1::ExactInstrument),
            ],
            vec![first, second],
            100,
            200,
        );
        assert_eq!(
            issue_native_replay_initial_market_readback_v1(
                batch,
                quote_cut,
                vec![schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
                declared_minute(),
                &request,
            )
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::ExactInstrumentRolesUnderOwnerUniverse
        );
    }

    #[rstest::rstest]
    fn missing_quote_field_cannot_mint_scheduling_authority() {
        let frame = two_member_frame();
        let mut rows = quote_rows("AAA-PERP.SIM", 101);
        rows.extend(
            quote_rows("BBB-PERP.SIM", 101)
                .into_iter()
                .filter(|row| row.field() != "ASK_SIZE"),
        );
        let quote_cut = quote_cut_with(&frame, rows, 101);

        assert_eq!(
            seal_native_replay_scheduling_v1(
                frame,
                quote_cut,
                two_schedules(),
                &declared_minute(),
                two_members(),
                100,
                200,
            )
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::FieldCensusMismatch
        );
    }

    #[rstest::rstest]
    fn duplicate_quote_field_cannot_mint_scheduling_authority() {
        let frame = two_member_frame();
        let mut rows = quote_rows("AAA-PERP.SIM", 101);
        let duplicate = rows
            .iter()
            .find(|row| row.field() == "BID_PRICE")
            .unwrap()
            .clone();
        rows.push(duplicate);
        rows.extend(quote_rows("BBB-PERP.SIM", 101));
        let quote_cut = quote_cut_with(&frame, rows, 101);

        assert_eq!(
            seal_native_replay_scheduling_v1(
                frame,
                quote_cut,
                two_schedules(),
                &declared_minute(),
                two_members(),
                100,
                200,
            )
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::FieldCensusMismatch
        );
    }

    /// A fixture schedule restated as one typed bar, at the fixture frame on the batch's
    /// coordinates. A continuous clock binds no calendar and no session.
    fn schedule_shaped(
        instrument: &str,
        identity: u8,
        (kind, unit, step): (BarScheduleKindV1, BarScheduleUnitV1, u32),
        anchor: DeclaredBarAnchorV1,
        clock: BarScheduleClockV1,
    ) -> BarScheduleReadbackV1 {
        let mut schedule = schedule_at(instrument, identity, 100);
        schedule.fact.kind = kind;
        schedule.fact.unit = unit;
        schedule.fact.step = step;
        schedule.fact.anchor_identity = anchor_identity_v1(anchor);

        if clock == BarScheduleClockV1::Continuous {
            schedule.fact.calendar_identity = BindingDigest::from_untrusted_bytes([0; 32]);
            schedule.fact.session_identity = BindingDigest::from_untrusted_bytes([0; 32]);
        }
        schedule
    }

    /// What a Binance USD-M perpetual's `1d` klines are: a 24-hour bar on a continuous clock from
    /// the Unix epoch, which is the shape Strategy Factory slice F declares.
    fn declared_utc_day() -> DeclaredBarTimeframeV1 {
        declared_bar_timeframe_for_test_v1(
            digest(19),
            &UntrustedSourceBarTimeframeV1 {
                row_timeframe: "1D".to_owned(),
                cadence: UntrustedSourceBarCadenceV1::FixedInterval {
                    step: 24,
                    unit: UntrustedSourceBarUnitV1::Hour,
                },
                anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
                clock: UntrustedSourceBarClockV1::Continuous,
                label: UntrustedSourceBarLabelV1::IntervalClose,
                completion: UntrustedSourceBarCompletionV1::CompleteOnly,
            },
        )
    }

    fn native_name(
        schedule: &BarScheduleReadbackV1,
    ) -> Result<String, NativeReplaySchedulingErrorV1> {
        native_bar_specification_v1(schedule.fact()).map(|specification| specification.to_string())
    }

    /// The engine admits a periodic step only and asks for the next unit when a step fills one; a
    /// fixed interval from the Unix epoch on a continuous clock is named in the largest unit that
    /// divides it and that the engine admits, or refused when none does.
    #[rstest::rstest]
    #[case(BarScheduleUnitV1::Second, 1, Ok("1-SECOND-LAST"))]
    #[case(BarScheduleUnitV1::Minute, 5, Ok("5-MINUTE-LAST"))]
    #[case(BarScheduleUnitV1::Minute, 60, Ok("1-HOUR-LAST"))]
    #[case(BarScheduleUnitV1::Minute, 120, Ok("2-HOUR-LAST"))]
    #[case(BarScheduleUnitV1::Hour, 24, Ok("1-DAY-LAST"))]
    #[case(BarScheduleUnitV1::Hour, 48, Ok("2-DAY-LAST"))]
    #[case(
        BarScheduleUnitV1::Minute,
        90,
        Err(NativeReplaySchedulingErrorV1::NativeRepresentation)
    )]
    #[case(
        BarScheduleUnitV1::Hour,
        5,
        Err(NativeReplaySchedulingErrorV1::NativeRepresentation)
    )]
    fn a_continuous_epoch_bar_is_named_in_the_largest_unit_the_engine_admits(
        #[case] unit: BarScheduleUnitV1,
        #[case] step: u32,
        #[case] expected: Result<&str, NativeReplaySchedulingErrorV1>,
    ) {
        let schedule = schedule_shaped(
            "AAA-PERP.SIM",
            40,
            (BarScheduleKindV1::FixedInterval, unit, step),
            DeclaredBarAnchorV1::UnixEpoch,
            BarScheduleClockV1::Continuous,
        );

        assert_eq!(native_name(&schedule).as_deref().map_err(|e| *e), expected);
    }

    /// Off the epoch grid a bar keeps its own unit: a session-bounded interval is not renamed, and
    /// an exchange session day is named `DAY`, the stated limitation of an engine without sessions.
    #[rstest::rstest]
    fn a_scheduled_bar_keeps_its_own_unit() {
        let session_hour = schedule_shaped(
            "AAA-PERP.SIM",
            40,
            (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour, 1),
            DeclaredBarAnchorV1::SessionOpen,
            BarScheduleClockV1::ScheduleBounded,
        );
        let session_sixty_minutes = schedule_shaped(
            "AAA-PERP.SIM",
            40,
            (
                BarScheduleKindV1::FixedInterval,
                BarScheduleUnitV1::Minute,
                60,
            ),
            DeclaredBarAnchorV1::SessionOpen,
            BarScheduleClockV1::ScheduleBounded,
        );
        let session_day = schedule_shaped(
            "AAA-PERP.SIM",
            40,
            (
                BarScheduleKindV1::ExchangeSession,
                BarScheduleUnitV1::ExchangeSessionDay,
                1,
            ),
            DeclaredBarAnchorV1::SessionOpen,
            BarScheduleClockV1::ScheduleBounded,
        );

        assert_eq!(native_name(&session_hour).as_deref(), Ok("1-HOUR-LAST"));
        assert_eq!(
            native_name(&session_sixty_minutes),
            Err(NativeReplaySchedulingErrorV1::NativeRepresentation)
        );
        assert_eq!(native_name(&session_day).as_deref(), Ok("1-DAY-LAST"));
    }

    /// Slice F's perpetual: the schedule a declared 24-hour UTC bar selects states that bar field by
    /// field, and the engine names it `1-DAY`.
    #[rstest::rstest]
    fn a_perpetual_utc_day_selects_the_schedule_that_states_it() {
        let verified = two_member_frame();
        let utc_day = schedule_shaped(
            "AAA-PERP.SIM",
            40,
            (
                BarScheduleKindV1::FixedInterval,
                BarScheduleUnitV1::Hour,
                24,
            ),
            DeclaredBarAnchorV1::UnixEpoch,
            BarScheduleClockV1::Continuous,
        );
        let selected = select_native_replay_schedule_v1(
            vec![utc_day],
            &verified,
            InstrumentId::from("AAA-PERP.SIM"),
            &declared_utc_day(),
            100,
        )
        .expect("the declared bar's schedule");
        let fact = selected.fact();
        let zero = BindingDigest::from_untrusted_bytes([0; 32]);

        assert_eq!(fact.kind(), BarScheduleKindV1::FixedInterval);
        assert_eq!(fact.unit(), BarScheduleUnitV1::Hour);
        assert_eq!(fact.step(), 24);
        assert_eq!(
            fact.anchor_identity(),
            anchor_identity_v1(DeclaredBarAnchorV1::UnixEpoch)
        );
        assert_eq!(fact.clock(), BarScheduleClockV1::Continuous);
        assert_eq!(fact.calendar_identity(), zero);
        assert_eq!(fact.session_identity(), zero);
        assert_ne!(fact.time_zone_identity(), zero);
        assert_eq!(fact.label(), BarScheduleLabelV1::IntervalClose);
        assert_eq!(fact.completion(), BarScheduleCompletionV1::CompleteOnly);
        assert_eq!(native_name(&selected).as_deref(), Ok("1-DAY-LAST"));
    }

    /// The exchange-session day a label `1D` once implied is a schedule that exists and states
    /// another bar: under a declared 24-hour UTC bar it is refused by name, not taken and not
    /// reported missing.
    #[rstest::rstest]
    fn the_session_day_a_label_once_implied_is_refused_under_a_utc_day() {
        let verified = two_member_frame();
        let session_day = schedule_shaped(
            "AAA-PERP.SIM",
            40,
            (
                BarScheduleKindV1::ExchangeSession,
                BarScheduleUnitV1::ExchangeSessionDay,
                1,
            ),
            DeclaredBarAnchorV1::SessionOpen,
            BarScheduleClockV1::ScheduleBounded,
        );

        assert_eq!(
            select_native_replay_schedule_v1(
                vec![session_day],
                &verified,
                InstrumentId::from("AAA-PERP.SIM"),
                &declared_utc_day(),
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)
        );
        assert_eq!(
            select_native_replay_schedule_v1(
                Vec::new(),
                &verified,
                InstrumentId::from("AAA-PERP.SIM"),
                &declared_utc_day(),
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame),
            "with no schedule at the frame at all, the schedule is missing rather than wrong"
        );

        // A 24-hour bar that differs from the declaration in its anchor alone, or in its clock
        // alone, is another bar too.
        for (anchor, clock) in [
            (
                DeclaredBarAnchorV1::SessionOpen,
                BarScheduleClockV1::Continuous,
            ),
            (
                DeclaredBarAnchorV1::UnixEpoch,
                BarScheduleClockV1::ScheduleBounded,
            ),
        ] {
            let other = schedule_shaped(
                "AAA-PERP.SIM",
                40,
                (
                    BarScheduleKindV1::FixedInterval,
                    BarScheduleUnitV1::Hour,
                    24,
                ),
                anchor,
                clock,
            );
            assert_eq!(
                select_native_replay_schedule_v1(
                    vec![other],
                    &verified,
                    InstrumentId::from("AAA-PERP.SIM"),
                    &declared_utc_day(),
                    100,
                )
                .err(),
                Some(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch),
                "{anchor:?} {clock:?}"
            );
        }
    }

    /// And the other way round: once the declaration says exchange session day, the 24-hour UTC
    /// bar a perpetual's `1d` klines are is another bar, refused by name, while the same schedule
    /// under the UTC-day declaration is selected.
    #[rstest::rstest]
    fn a_utc_day_is_refused_under_a_declared_session_day() {
        let verified = two_member_frame();
        let utc_day = || {
            schedule_shaped(
                "AAA-PERP.SIM",
                40,
                (
                    BarScheduleKindV1::FixedInterval,
                    BarScheduleUnitV1::Hour,
                    24,
                ),
                DeclaredBarAnchorV1::UnixEpoch,
                BarScheduleClockV1::Continuous,
            )
        };
        let declared_session_day = declared_bar_timeframe_for_test_v1(
            digest(19),
            &UntrustedSourceBarTimeframeV1 {
                row_timeframe: "1D".to_owned(),
                cadence: UntrustedSourceBarCadenceV1::ExchangeSessionDay,
                anchor: UntrustedSourceBarAnchorV1::SessionOpen,
                clock: UntrustedSourceBarClockV1::ScheduleBounded,
                label: UntrustedSourceBarLabelV1::IntervalClose,
                completion: UntrustedSourceBarCompletionV1::CompleteOnly,
            },
        );

        assert!(
            select_native_replay_schedule_v1(
                vec![utc_day()],
                &verified,
                InstrumentId::from("AAA-PERP.SIM"),
                &declared_utc_day(),
                100,
            )
            .is_ok()
        );
        assert_eq!(
            select_native_replay_schedule_v1(
                vec![utc_day()],
                &verified,
                InstrumentId::from("AAA-PERP.SIM"),
                &declared_session_day,
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)
        );
    }

    /// A declaration speaks for its own binding's batch only.
    #[rstest::rstest]
    fn another_bindings_declaration_selects_and_seals_nothing() {
        let verified = two_member_frame();
        let foreign = declared_minute_for(digest(99));

        assert_eq!(
            select_native_replay_schedule_v1(
                vec![schedule_at("AAA-PERP.SIM", 40, 100)],
                &verified,
                InstrumentId::from("AAA-PERP.SIM"),
                &foreign,
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)
        );
        let quote_cut = quote_cut_for(&verified, &["AAA-PERP.SIM", "BBB-PERP.SIM"], 101);
        assert_eq!(
            seal_native_replay_scheduling_v1(
                verified,
                quote_cut,
                two_schedules(),
                &foreign,
                two_members(),
                100,
                200,
            )
            .map(|_| ())
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch
        );
    }

    /// The seal takes only schedules that state the declared bar, so a schedule selected any other
    /// way cannot be sealed.
    #[rstest::rstest]
    fn a_schedule_of_another_bar_is_not_sealed() {
        let frame = two_member_frame();
        let quote_cut = quote_cut_for(&frame, &["AAA-PERP.SIM", "BBB-PERP.SIM"], 101);

        assert_eq!(
            seal_native_replay_scheduling_v1(
                frame,
                quote_cut,
                two_schedules(),
                &declared_utc_day(),
                two_members(),
                100,
                200,
            )
            .map(|_| ())
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch
        );
    }

    /// A schedule's native bar type has one implementation: the frame's seal and an acceptance
    /// asserting a schedule's name get the same bar type for the same schedule, and the seal adds
    /// only that the schedule is the frame's.
    #[rstest::rstest]
    fn the_seal_and_the_public_name_agree_on_every_schedule() {
        let frame = two_member_frame();
        let instrument = InstrumentId::from("AAA-PERP.SIM");
        let utc_day = schedule_shaped(
            "AAA-PERP.SIM",
            40,
            (
                BarScheduleKindV1::FixedInterval,
                BarScheduleUnitV1::Hour,
                24,
            ),
            DeclaredBarAnchorV1::UnixEpoch,
            BarScheduleClockV1::Continuous,
        );

        for schedule in [schedule_at("AAA-PERP.SIM", 40, 100), utc_day] {
            assert_eq!(
                validated_bar_type(&schedule, &frame, instrument, 100),
                native_bar_type_for_schedule_v1(schedule.fact(), instrument)
            );
        }
        let utc_day = schedule_shaped(
            "AAA-PERP.SIM",
            40,
            (
                BarScheduleKindV1::FixedInterval,
                BarScheduleUnitV1::Hour,
                24,
            ),
            DeclaredBarAnchorV1::UnixEpoch,
            BarScheduleClockV1::Continuous,
        );
        assert_eq!(
            native_bar_type_for_schedule_v1(utc_day.fact(), instrument).map(|bar| bar.to_string()),
            Ok("AAA-PERP.SIM-1-DAY-LAST-EXTERNAL".to_owned())
        );

        let elsewhere = schedule_at("AAA-PERP.SIM", 40, 160);
        assert_eq!(
            validated_bar_type(&elsewhere, &frame, instrument, 100),
            Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch),
            "the seal refuses a schedule that is not the frame's"
        );
        assert!(
            native_bar_type_for_schedule_v1(elsewhere.fact(), instrument).is_ok(),
            "while the name is the schedule's alone"
        );
    }

    mod custody_frame {
        //! A custody frame's issuance and seal (slice T0-5), against the snapshot frame's on the
        //! same values.

        use super::*;
        use crate::owner::{
            pit_window_custody_v1::{
                PitObservationBatchSourceV1, QuoteDerivationV1, UntrustedPitWindowCustodyClaimV1,
                UntrustedPitWindowCustodyFrameV1, schedule::PitWindowScheduleFactV1,
            },
            strategy_input_binding::derive_universe_selection,
        };

        const MINUTE: u64 = 60_000_000_000;
        /// The frame closes at minute 2; its view decides one nanosecond later.
        const E: u64 = 2 * MINUTE;
        const D: u64 = E + 1;
        const QUOTE_AT: u64 = E + 2;
        const RUN_END: u64 = 10 * MINUTE;
        const AAA: &str = "AAA-PERP.SIM";
        const BBB: &str = "BBB-PERP.SIM";

        fn view_source() -> PitObservationBatchSourceV1 {
            PitObservationBatchSourceV1::CustodyView {
                chain_root: digest(60),
                view_identity: digest(61),
                event_ns: E,
                decision_cut_ns: D,
                derived_frontier_digest: digest(62),
            }
        }

        fn quote_source(derivation: QuoteDerivationV1) -> PitObservationBatchSourceV1 {
            PitObservationBatchSourceV1::CustodyQuoteCut {
                chain_root: digest(60),
                quote_cut_identity: digest(63),
                instant_ns: QUOTE_AT,
                derivation,
            }
        }

        fn bar_rows(member: &str) -> Vec<VerifiedPitObservation> {
            bar_rows_at(member, E, 0)
                .into_iter()
                .map(|mut row| {
                    row.symbolic_key = format!("{member}.{}.1M", row.field);
                    row.provider_available = D;
                    row.correction_publication = D;
                    row.retrieval = D;
                    row
                })
                .collect()
        }

        fn timed(
            rows: Vec<VerifiedPitObservation>,
            source: PitObservationBatchSourceV1,
            event: u64,
        ) -> VerifiedPitObservationBatch {
            batch(rows).edit_for_test(|fields| {
                fields.source = source;
                fields.time_evidence.event_effective =
                    UntrustedEventEffectiveTime::from_untrusted(event, "clock", "epoch");
                fields.time_evidence.decision_cut =
                    UntrustedSnapshotDecisionCut::from_untrusted(event.max(D), "clock", "epoch");
            })
        }

        /// The frame's rows of `members`, from a snapshot or as a custody view.
        fn frame(
            members: &[&str],
            source: PitObservationBatchSourceV1,
        ) -> VerifiedPitObservationBatch {
            timed(
                members.iter().flat_map(|member| bar_rows(member)).collect(),
                source,
                E,
            )
        }

        fn quote(
            members: &[&str],
            source: PitObservationBatchSourceV1,
        ) -> VerifiedPitObservationBatch {
            let mut quote = timed(
                members
                    .iter()
                    .flat_map(|member| quote_rows(member, QUOTE_AT))
                    .collect(),
                source,
                QUOTE_AT,
            );
            quote = quote.edit_for_test(|fields| fields.digest = digest(116));
            quote
        }

        fn snapshot_source(seed: u8) -> PitObservationBatchSourceV1 {
            PitObservationBatchSourceV1::CommittedSnapshot {
                snapshot_identity: digest(seed),
                fact_digest: digest(seed.wrapping_add(1)),
            }
        }

        /// A continuous one-minute bar from the Unix epoch, labelled at its close: the one bar both
        /// paths schedule.
        fn declared() -> DeclaredBarTimeframeV1 {
            let declared = declared_bar_timeframe_for_test_v1(
                digest(19),
                &UntrustedSourceBarTimeframeV1 {
                    row_timeframe: "1M".to_owned(),
                    cadence: UntrustedSourceBarCadenceV1::FixedInterval {
                        step: 1,
                        unit: UntrustedSourceBarUnitV1::Minute,
                    },
                    anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
                    clock: UntrustedSourceBarClockV1::Continuous,
                    label: UntrustedSourceBarLabelV1::IntervalClose,
                    completion: UntrustedSourceBarCompletionV1::CompleteOnly,
                },
            );
            // A custody states the same declaration from its record and window schedule.
            assert_eq!(
                DeclaredBarTimeframeV1::from_custody_v1(digest(19), "1M", declared.shape()),
                declared
            );
            declared
        }

        fn window_schedules(members: &[&str]) -> Vec<PitWindowScheduleFactV1> {
            members
                .iter()
                .zip(0..)
                .map(|(member, ordinal)| {
                    PitWindowScheduleFactV1::with_shape_for_test(
                        ordinal,
                        member,
                        declared().shape(),
                        MINUTE,
                        (0, RUN_END),
                    )
                })
                .collect()
        }

        fn bar_schedules(
            members: &[&str],
            frame: &VerifiedPitObservationBatch,
        ) -> Vec<BarScheduleReadbackV1> {
            members
                .iter()
                .zip(1..)
                .map(|(member, identity)| {
                    let mut schedule = schedule_bound_to_batch(member, identity, frame);
                    schedule.fact.anchor_identity =
                        anchor_identity_v1(DeclaredBarAnchorV1::UnixEpoch);
                    schedule.fact.calendar_identity = BindingDigest::from_untrusted_bytes([0; 32]);
                    schedule.fact.session_identity = BindingDigest::from_untrusted_bytes([0; 32]);
                    schedule
                })
                .collect()
        }

        fn instruments(members: &[&str]) -> Vec<InstrumentId> {
            members
                .iter()
                .map(|member| InstrumentId::from(*member))
                .collect()
        }

        fn custody_seal(
            view: VerifiedPitObservationBatch,
            quote_cut: VerifiedPitObservationBatch,
            members: &[&str],
        ) -> Result<NativeReplaySchedulingReadbackV1, NativeReplaySchedulingErrorV1> {
            seal_native_replay_custody_frame_v1(
                view,
                quote_cut,
                &window_schedules(members),
                &declared(),
                instruments(members),
                E,
                RUN_END,
            )
        }

        fn snapshot_seal(
            frame_batch: VerifiedPitObservationBatch,
            quote_cut: VerifiedPitObservationBatch,
            members: &[&str],
        ) -> Result<NativeReplaySchedulingReadbackV1, NativeReplaySchedulingErrorV1> {
            let schedules = bar_schedules(members, &frame_batch);
            seal_native_replay_scheduling_v1(
                frame_batch,
                quote_cut,
                schedules,
                &declared(),
                instruments(members),
                E,
                RUN_END,
            )
        }

        /// A custody frame and a snapshot frame over the same values seal the same native
        /// schedule: bar types, every value, instant and member order. Their receipts differ.
        #[rstest::rstest]
        #[case::one_member(&[AAA])]
        #[case::two_members(&[AAA, BBB])]
        fn a_custody_frame_seals_the_snapshot_frames_native_schedule(#[case] members: &[&str]) {
            let custody = custody_seal(
                frame(members, view_source()),
                quote(members, quote_source(QuoteDerivationV1::ObservedBbo)),
                members,
            )
            .expect("the custody frame seals");
            let snapshot = snapshot_seal(
                frame(members, snapshot_source(12)),
                quote(members, snapshot_source(112)),
                members,
            )
            .expect("the snapshot frame seals");

            assert_eq!(custody.member_instruments(), snapshot.member_instruments());
            assert_eq!(
                custody.quote_cut().instant_ns(),
                snapshot.quote_cut().instant_ns()
            );
            assert_eq!(
                custody.quote_cut().source(),
                quote_source(QuoteDerivationV1::ObservedBbo)
            );
            assert_ne!(custody.receipt_digest(), snapshot.receipt_digest());
            assert_eq!(
                custody.into_native_schedule(),
                snapshot.into_native_schedule()
            );
        }

        #[rstest::rstest]
        fn a_quote_cut_batch_in_the_frame_position_is_refused() {
            let members = &[AAA, BBB];
            let custody_quote = quote(members, quote_source(QuoteDerivationV1::ObservedBbo));
            assert_eq!(
                custody_seal(custody_quote.clone(), custody_quote.clone(), members).map(|_| ()),
                Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
            );
            assert_eq!(
                snapshot_seal(
                    custody_quote.clone(),
                    quote(members, snapshot_source(112)),
                    members
                )
                .map(|_| ()),
                Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
            );
            let (request, universe) = custody_request(members, "1M");
            assert_eq!(
                issue(
                    custody_quote.clone(),
                    custody_quote,
                    members,
                    &request,
                    universe
                )
                .map(|_| ()),
                Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
            );
        }

        #[rstest::rstest]
        fn a_custody_view_in_the_quote_position_is_refused() {
            let members = &[AAA, BBB];
            assert_eq!(
                custody_seal(
                    frame(members, view_source()),
                    frame(members, view_source()),
                    members
                )
                .map(|_| ()),
                Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
            );
        }

        #[rstest::rstest]
        fn a_snapshot_quote_cut_does_not_serve_a_custody_frame_and_back() {
            let members = &[AAA, BBB];
            assert_eq!(
                custody_seal(
                    frame(members, view_source()),
                    quote(members, snapshot_source(112)),
                    members
                )
                .map(|_| ()),
                Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
            );
            assert_eq!(
                snapshot_seal(
                    frame(members, snapshot_source(12)),
                    quote(members, quote_source(QuoteDerivationV1::ObservedBbo)),
                    members
                )
                .map(|_| ()),
                Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
            );
        }

        /// A custody request for `members` whose close role reads `close_label`, and the custody's
        /// Universe Selection locator.
        fn custody_request(
            members: &[&str],
            close_label: &str,
        ) -> (
            NativeReplayInitialMarketRequestV1,
            (BindingDigest, BindingDigest),
        ) {
            custody_request_with(
                members,
                &[(42, MarketDataFieldSemantic::BarClosePrice, close_label)],
            )
        }

        fn custody_request_with(
            members: &[&str],
            roles: &[(u8, MarketDataFieldSemantic, &str)],
        ) -> (
            NativeReplayInitialMarketRequestV1,
            (BindingDigest, BindingDigest),
        ) {
            let selection = derive_universe_selection(&frame(members, view_source())).unwrap();
            let universe = (digest(6), digest(66));
            let request = NativeReplayInitialMarketRequestV1::for_custody_frame(
                UntrustedPitWindowCustodyFrameV1 {
                    custody: UntrustedPitWindowCustodyClaimV1 {
                        chain_root: digest(60),
                    },
                    head_identity: digest(64),
                    event_ns: E,
                },
                digest(1),
                digest(2),
                selection.selection_identity(),
                selection.selection_digest(),
                universe.0,
                universe.1,
                digest(5),
                digest(14),
                digest(7),
                roles
                    .iter()
                    .map(|(identity, field, timeframe)| {
                        NativeReplayInitialUniverseRoleV1::new(
                            digest(*identity),
                            *field,
                            StrategyInputChannel::Market,
                            (*timeframe).to_owned(),
                            field.unit(),
                            2,
                        )
                    })
                    .collect(),
                instruments(members),
                RUN_END,
            );
            (request, universe)
        }

        fn issue(
            view: VerifiedPitObservationBatch,
            quote_cut: VerifiedPitObservationBatch,
            members: &[&str],
            request: &NativeReplayInitialMarketRequestV1,
            universe: (BindingDigest, BindingDigest),
        ) -> Result<NativeReplayCustodyFrameReadbackV1, NativeReplaySchedulingErrorV1> {
            issue_native_replay_custody_frame_readback_v1(
                view,
                quote_cut,
                window_schedules(members),
                declared(),
                universe,
                request,
            )
        }

        #[rstest::rstest]
        fn a_custody_frame_is_issued_and_converts_into_its_native_schedule() {
            let members = &[AAA, BBB];
            let (request, universe) = custody_request(members, "1M");
            let readback = issue(
                frame(members, view_source()),
                quote(members, quote_source(QuoteDerivationV1::ObservedBbo)),
                members,
                &request,
                universe,
            )
            .expect("the custody frame issues");
            assert_eq!(readback.source(), view_source());
            assert_eq!(readback.window_schedules().len(), 2);
            assert_eq!(readback.window_schedules()[1].instrument(), BBB);
            assert_eq!(readback.window_schedules()[0].window(), (0, RUN_END));
            let (universe_frame, scheduling) = readback.into_execution_parts().unwrap();
            assert_eq!(universe_frame.selection().members().len(), 2);
            assert_eq!(scheduling.frame_time_ns(), E);

            // Ruling Q11: the Record is the locator pair; each half is compared on its own.
            for wrong in [(digest(6), digest(67)), (digest(68), digest(66))] {
                assert_eq!(
                    issue(
                        frame(members, view_source()),
                        quote(members, quote_source(QuoteDerivationV1::ObservedBbo)),
                        members,
                        &request,
                        wrong,
                    )
                    .map(|_| ()),
                    Err(NativeReplaySchedulingErrorV1::UniverseSelectionRecordMismatch)
                );
            }
        }

        /// The fill timeframe is never an input: a role on its label is not the custody's execution
        /// bar, and reads no row.
        #[rstest::rstest]
        #[case::the_close_on_the_fill_label(&[(42, MarketDataFieldSemantic::BarClosePrice, "1S")], NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch)]
        #[case::another_role_on_the_fill_label(&[(41, MarketDataFieldSemantic::BarOpenPrice, "1S"), (42, MarketDataFieldSemantic::BarClosePrice, "1M")], NativeReplaySchedulingErrorV1::MoreThanOneRoleTimeframe)]
        fn a_role_on_the_fill_label_never_reads_fill_rows(
            #[case] roles: &[(u8, MarketDataFieldSemantic, &str)],
            #[case] refused: NativeReplaySchedulingErrorV1,
        ) {
            let members = &[AAA, BBB];
            let (request, universe) = custody_request_with(members, roles);
            assert_eq!(
                issue(
                    frame(members, view_source()),
                    quote(members, quote_source(QuoteDerivationV1::ObservedBbo)),
                    members,
                    &request,
                    universe,
                )
                .map(|_| ()),
                Err(refused)
            );
        }

        #[rstest::rstest]
        fn each_method_refuses_the_other_frame_source() {
            let members = &[AAA, BBB];
            let (custody, universe) = custody_request(members, "1M");
            let snapshot = NativeReplayInitialMarketRequestV1::new(
                digest(12),
                digest(13),
                digest(1),
                digest(2),
                digest(3),
                digest(4),
                digest(6),
                digest(6),
                digest(5),
                digest(14),
                digest(7),
                Vec::new(),
                instruments(members),
                E,
                RUN_END,
            );
            assert_eq!(
                issue(
                    frame(members, view_source()),
                    quote(members, quote_source(QuoteDerivationV1::ObservedBbo)),
                    members,
                    &snapshot,
                    universe,
                )
                .map(|_| ()),
                Err(NativeReplaySchedulingErrorV1::FrameSourceMismatch)
            );
            let frame_batch = frame(members, snapshot_source(12));
            let schedules = bar_schedules(members, &frame_batch);
            assert_eq!(
                issue_native_replay_initial_market_readback_v1(
                    frame_batch,
                    quote(members, snapshot_source(112)),
                    schedules,
                    declared(),
                    &custody,
                )
                .map(|_| ()),
                Err(NativeReplaySchedulingErrorV1::FrameSourceMismatch)
            );
            assert_eq!(snapshot.for_custody_event(E), None);
            assert_eq!(
                custody
                    .for_custody_event(E + MINUTE)
                    .map(|next| next.frame_time_ns()),
                Some(E + MINUTE)
            );
        }

        /// The custody receipt binds the view, its chain root, view identity and frontier, the
        /// quote cut and its derivation; it never equals the snapshot frame's.
        #[rstest::rstest]
        fn the_custody_receipt_binds_every_part_and_differs_from_the_snapshot_one() {
            let members = &[AAA, BBB];
            let receipt = |view: PitObservationBatchSourceV1,
                           quote_cut: PitObservationBatchSourceV1| {
                custody_seal(frame(members, view), quote(members, quote_cut), members)
                    .unwrap()
                    .receipt_digest()
            };
            let observed = quote_source(QuoteDerivationV1::ObservedBbo);
            let base = receipt(view_source(), observed);
            let PitObservationBatchSourceV1::CustodyView {
                chain_root,
                view_identity,
                event_ns,
                decision_cut_ns,
                derived_frontier_digest,
            } = view_source()
            else {
                unreachable!()
            };
            let view = |edit: fn(&mut [BindingDigest; 3])| {
                let mut parts = [chain_root, view_identity, derived_frontier_digest];
                edit(&mut parts);
                PitObservationBatchSourceV1::CustodyView {
                    chain_root: parts[0],
                    view_identity: parts[1],
                    event_ns,
                    decision_cut_ns,
                    derived_frontier_digest: parts[2],
                }
            };
            assert_ne!(receipt(view(|parts| parts[1] = digest(91)), observed), base);
            assert_ne!(receipt(view(|parts| parts[2] = digest(92)), observed), base);
            assert_ne!(
                receipt(
                    view_source(),
                    quote_source(QuoteDerivationV1::FillBarOpen {
                        fill_timeframe_identity: digest(93),
                    })
                ),
                base
            );
            let PitObservationBatchSourceV1::CustodyQuoteCut {
                chain_root,
                instant_ns,
                derivation,
                ..
            } = observed
            else {
                unreachable!()
            };
            assert_ne!(
                receipt(
                    view_source(),
                    PitObservationBatchSourceV1::CustodyQuoteCut {
                        chain_root,
                        quote_cut_identity: digest(94),
                        instant_ns,
                        derivation,
                    }
                ),
                base
            );
            assert_ne!(
                base,
                snapshot_seal(
                    frame(members, snapshot_source(12)),
                    quote(members, snapshot_source(112)),
                    members
                )
                .unwrap()
                .receipt_digest()
            );
        }

        /// A quote cut outside the gap after the frame's decision cut, or after the run's end, is
        /// refused.
        #[rstest::rstest]
        fn a_custody_quote_cut_outside_its_gap_is_refused() {
            let members = &[AAA];

            for instant in [D, E + MINUTE] {
                // Every row and coordinate of the quote cut is at the instant, so only the gap
                // refuses it.
                let quote_cut = timed(
                    members
                        .iter()
                        .flat_map(|member| quote_rows(member, instant))
                        .collect(),
                    PitObservationBatchSourceV1::CustodyQuoteCut {
                        chain_root: digest(60),
                        quote_cut_identity: digest(63),
                        instant_ns: instant,
                        derivation: QuoteDerivationV1::ObservedBbo,
                    },
                    instant,
                );
                assert_eq!(
                    custody_seal(frame(members, view_source()), quote_cut, members).map(|_| ()),
                    Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable),
                    "{instant}"
                );
            }
        }
    }
}
