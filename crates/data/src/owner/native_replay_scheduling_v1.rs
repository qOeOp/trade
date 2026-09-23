//! Owner-sealed native scheduling projection for one two-member Replay window.
//!
//! The projection consumes one verified PIT batch and two move-only BAR schedule readbacks. It
//! emits exactly two complete BAR signals followed by the first complete Quote for each member.
//! Callers cannot supply prices, quantities, event order, or timestamps.

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
        BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1, BarScheduleReadbackV1,
        BarScheduleUnitV1, UntrustedBarScheduleLocatorV1,
    },
    pit_snapshot::{
        UntrustedPitSnapshotLocator, UntrustedPitSnapshotTimeEvidence, VerifiedPitObservation,
        VerifiedPitObservationBatch,
    },
    source_binding::BindingDigest,
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        StrategyInputUniverseFrameReceipt, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputScope, bind_strategy_input_universe_frame,
    },
};

const RECEIPT_DOMAIN_V1: &[u8] = b"market-data.native-replay-scheduling-readback.v1\0";
const BAR_FIELDS: [&str; 5] = ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"];
const QUOTE_FIELDS: [&str; 4] = ["BID_PRICE", "ASK_PRICE", "BID_SIZE", "ASK_SIZE"];

/// Move-only Market Data authority for the exact native scheduling values of one Replay request.
#[derive(Debug)]
pub struct NativeReplaySchedulingReadbackV1 {
    observation_batch_digest: BindingDigest,
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

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum NativeReplaySchedulingErrorV1 {
    #[error("native Replay scheduling Owner readback is unavailable")]
    OwnerReadbackUnavailable,
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

/// Bounded request for reconstructing the initial universe frame and its two BAR schedules.
///
/// Every Owner coordinate absent from this type is derived from the verified PIT batch. The two
/// schedule locators and the account scope are deliberately not caller inputs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeReplayInitialMarketRequestV1 {
    snapshot_identity: BindingDigest,
    snapshot_fact_digest: BindingDigest,
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    universe_selection_identity: BindingDigest,
    universe_selection_digest: BindingDigest,
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
        instrument_master_digest: BindingDigest,
        source_binding_lineage_root: BindingDigest,
        market_semantics_identity: BindingDigest,
        roles: Vec<NativeReplayInitialUniverseRoleV1>,
        member_instruments: Vec<InstrumentId>,
        frame_time_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Self {
        Self {
            snapshot_identity,
            snapshot_fact_digest,
            research_request_identity,
            strategy_design_identity,
            universe_selection_identity,
            universe_selection_digest,
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
            snapshot_identity,
            snapshot_fact_digest,
            research_request_identity: self.research_request_identity,
            strategy_design_identity: self.strategy_design_identity,
            universe_selection_identity: self.universe_selection_identity,
            universe_selection_digest: self.universe_selection_digest,
            instrument_master_digest: self.instrument_master_digest,
            source_binding_lineage_root: self.source_binding_lineage_root,
            market_semantics_identity: self.market_semantics_identity,
            roles: self.roles.clone(),
            member_instruments: self.member_instruments.clone(),
            frame_time_ns,
            window_end_ns_exclusive: self.window_end_ns_exclusive,
        }
    }

    #[must_use]
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    #[must_use]
    pub const fn snapshot_fact_digest(&self) -> BindingDigest {
        self.snapshot_fact_digest
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

    #[must_use]
    pub fn schedule_timeframe(&self) -> Option<&str> {
        let mut timeframes = self
            .roles
            .iter()
            .filter(|role| role.field_semantic.data_kind() == "BAR")
            .map(|role| role.timeframe.as_str());
        let first = timeframes.next()?;
        timeframes.all(|value| value == first).then_some(first)
    }
}

/// Move-only Market Data readback retained through binding or consumer-side native materialization.
#[derive(Debug)]
pub struct NativeReplayInitialMarketReadbackV1 {
    batch: VerifiedPitObservationBatch,
    universe_frame: StrategyInputUniverseFrameReceipt,
    schedules: Vec<BarScheduleReadbackV1>,
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
        market_data_repair_source_from_verified_batch(self.batch)
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
            universe_frame,
            schedules,
            member_instruments,
            frame_time_ns,
            window_end_ns_exclusive,
        } = self;
        // The V2 frame evidence is still written for two members; it is rewritten for any count
        // with the quote cut, and until then a one-member cut has no V2 evidence.
        let evidence = super::native_replay_scheduling_v2::verify_native_replay_frame_evidence_v2(
            batch,
            schedules
                .try_into()
                .map_err(|_| NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?,
            member_instruments
                .try_into()
                .map_err(|_| NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?,
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
            self.schedules,
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
) -> MarketDataRepairSourceV1 {
    MarketDataRepairSourceV1 {
        pit_request_identity: batch.request_identity(),
        pit_request_digest: batch.request_digest(),
        correlation_identity: batch.correlation_identity(),
        pit_snapshot_identity: batch.snapshot_identity(),
        pit_snapshot_fact_digest: batch.fact_digest(),
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
    async fn resolve_native_replay_initial_market_inputs_v1(
        &self,
        request: &NativeReplayInitialMarketRequestV1,
    ) -> Result<NativeReplayInitialMarketReadbackV1, NativeReplaySchedulingErrorV1>;

    async fn resolve_native_replay_scheduling_v1(
        &self,
        request: &UntrustedNativeReplaySchedulingRequestV1,
    ) -> Result<NativeReplaySchedulingReadbackV1, NativeReplaySchedulingErrorV1>;
}

pub(crate) fn issue_native_replay_initial_market_readback_v1(
    batch: VerifiedPitObservationBatch,
    schedules: impl Into<Vec<BarScheduleReadbackV1>>,
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
        || batch.snapshot_identity() != request.snapshot_identity
        || batch.fact_digest() != request.snapshot_fact_digest
        || batch.instrument_master_digest() != request.instrument_master_digest
        || batch.universe_selection_digest() != request.universe_selection_digest
        || batch.source_binding_lineage_root() != request.source_binding_lineage_root
        || batch.market_semantics_identity() != request.market_semantics_identity
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    let timeframe = request
        .schedule_timeframe()
        .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;

    for (index, schedule) in schedules.iter().enumerate() {
        validated_bar_type(
            schedule,
            &batch,
            request.member_instruments[index],
            request.frame_time_ns,
        )?;

        if schedule_timeframe(schedule.fact()) != timeframe {
            return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
        }
    }
    let binding_requests = request
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
            snapshot_identity: batch.snapshot_identity(),
            snapshot_fact_digest: batch.fact_digest(),
            observation_batch_digest: batch.digest(),
            source_binding_identity: batch.source_binding_identity(),
            source_frontier_digest: batch.source_frontier_digest(),
            correction_frontier_digest: batch.correction_frontier_digest(),
            instrument_master_digest: batch.instrument_master_digest(),
            universe_selection_digest: batch.universe_selection_digest(),
            market_semantics_identity: batch.market_semantics_identity(),
            decision_cut: batch.time_evidence().decision_cut.value,
        })
        .collect::<Vec<_>>();
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
    Ok(NativeReplayInitialMarketReadbackV1 {
        batch,
        universe_frame,
        schedules,
        member_instruments: request.member_instruments.clone(),
        frame_time_ns: request.frame_time_ns,
        window_end_ns_exclusive: request.window_end_ns_exclusive,
    })
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
/// Returns unavailable when no candidate matches, and a binding mismatch when two do.
pub(crate) fn select_native_replay_schedule_v1(
    candidates: Vec<BarScheduleReadbackV1>,
    batch: &VerifiedPitObservationBatch,
    instrument: InstrumentId,
    timeframe: &str,
    frame_time_ns: u64,
) -> Result<BarScheduleReadbackV1, NativeReplaySchedulingErrorV1> {
    let mut matches = candidates.into_iter().filter(|schedule| {
        native_replay_schedule_matches_request_v1(
            schedule,
            batch,
            instrument,
            timeframe,
            frame_time_ns,
        )
    });
    let selected = matches
        .next()
        .ok_or(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;

    if matches.next().is_some() {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    Ok(selected)
}

pub(crate) fn native_replay_schedule_matches_request_v1(
    schedule: &BarScheduleReadbackV1,
    batch: &VerifiedPitObservationBatch,
    instrument: InstrumentId,
    timeframe: &str,
    frame_time_ns: u64,
) -> bool {
    validated_bar_type(schedule, batch, instrument, frame_time_ns).is_ok()
        && schedule_timeframe(schedule.fact()) == timeframe
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
    batch: VerifiedPitObservationBatch,
    schedules: impl Into<Vec<BarScheduleReadbackV1>>,
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
    let bar_types = schedules
        .iter()
        .zip(&member_instruments)
        .map(|(schedule, instrument)| {
            validated_bar_type(schedule, &batch, *instrument, frame_time_ns)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut data = Vec::with_capacity(member_instruments.len() * 2);

    for ((schedule, instrument), bar_type) in
        schedules.iter().zip(&member_instruments).zip(&bar_types)
    {
        data.push(Data::Bar(project_bar(
            &batch,
            *instrument,
            *bar_type,
            frame_time_ns,
            &schedule_timeframe(schedule.fact()),
        )?));
    }
    // Each member's Quote is its first complete one after the member before it, in member order.
    let mut after_event_ns = frame_time_ns;

    for instrument in &member_instruments {
        let quote =
            project_first_quote(&batch, *instrument, after_event_ns, window_end_ns_exclusive)?;
        after_event_ns = quote.ts_event.as_u64();
        data.push(Data::Quote(quote));
    }
    let bar_schedule_digests = schedules
        .iter()
        .map(BarScheduleReadbackV1::digest)
        .collect::<Vec<_>>();
    let receipt_digest = digest_receipt(
        batch.digest(),
        &bar_schedule_digests,
        &member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
        &data,
    )?;
    Ok(NativeReplaySchedulingReadbackV1 {
        observation_batch_digest: batch.digest(),
        bar_schedule_digests,
        member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
        bar_types,
        data,
        receipt_digest,
    })
}

fn validated_bar_type(
    schedule: &BarScheduleReadbackV1,
    batch: &VerifiedPitObservationBatch,
    instrument_id: InstrumentId,
    frame_time_ns: u64,
) -> Result<BarType, NativeReplaySchedulingErrorV1> {
    let fact = schedule.fact();
    if fact.canonical_instrument() != instrument_id.to_string()
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
    let aggregation = match (fact.kind(), fact.unit()) {
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Second) => BarAggregation::Second,
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Minute) => BarAggregation::Minute,
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour) => BarAggregation::Hour,
        (BarScheduleKindV1::ExchangeSession, BarScheduleUnitV1::ExchangeSessionDay) => {
            BarAggregation::Day
        }
        _ => return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch),
    };
    let step = usize::try_from(fact.step())
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    let specification = BarSpecification::new_checked(step, aggregation, PriceType::Last)
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    Ok(BarType::new(
        instrument_id,
        specification,
        AggregationSource::External,
    ))
}

fn schedule_timeframe(fact: &super::bar_schedule::BarScheduleFactV1) -> String {
    let suffix = match fact.unit() {
        BarScheduleUnitV1::Second => "S",
        BarScheduleUnitV1::Minute => "M",
        BarScheduleUnitV1::Hour => "H",
        BarScheduleUnitV1::ExchangeSessionDay => "D",
    };
    format!("{}{suffix}", fact.step())
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

    if [high, low, close]
        .into_iter()
        .any(|value| value.precision != open.precision)
    {
        return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
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

fn project_first_quote(
    batch: &VerifiedPitObservationBatch,
    instrument_id: InstrumentId,
    after_event_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<QuoteTick, NativeReplaySchedulingErrorV1> {
    let instrument = instrument_id.to_string();
    let mut by_event = BTreeMap::<u64, Vec<&VerifiedPitObservation>>::new();

    for row in batch.observations().iter().filter(|row| {
        row.instrument() == instrument
            && row.data_kind() == "QUOTE"
            && row.event_effective() > after_event_ns
            && row.event_effective() < window_end_ns_exclusive
            && QUOTE_FIELDS.contains(&row.field())
    }) {
        by_event.entry(row.event_effective()).or_default().push(row);
    }

    for (event_time_ns, candidates) in by_event {
        let mut rows = BTreeMap::new();
        for row in candidates {
            if rows.insert(row.field(), row).is_some() {
                return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
            }
        }

        if rows.len() != QUOTE_FIELDS.len()
            || QUOTE_FIELDS.iter().any(|field| !rows.contains_key(field))
        {
            continue;
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
        return QuoteTick::new_checked(
            instrument_id,
            bid_price,
            ask_price,
            bid_size,
            ask_size,
            event_time_ns.into(),
            event_time_ns.into(),
        )
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable)
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
    schedule_digests: &[BindingDigest],
    instruments: &[InstrumentId],
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
    data: &[Data],
) -> Result<BindingDigest, NativeReplaySchedulingErrorV1> {
    let mut hasher = Sha256::new();
    hasher.update(RECEIPT_DOMAIN_V1);

    // The members are hashed without a count, and a two-member receipt keeps the bytes it always
    // had. Any other count states itself here, so no receipt over one member can share a preimage
    // with one over two.
    if instruments.len() != 2 {
        hasher.update(b"members\0");
        hasher.update(
            u64::try_from(instruments.len())
                .map_err(|_| NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?
                .to_be_bytes(),
        );
    }
    hasher.update(batch_digest.as_bytes());
    for digest in schedule_digests {
        hasher.update(digest.as_bytes());
    }

    for instrument in instruments {
        hash_text(&mut hasher, &instrument.to_string())?;
    }
    hasher.update(frame_time_ns.to_be_bytes());
    hasher.update(window_end_ns_exclusive.to_be_bytes());

    for value in data {
        match value {
            Data::Bar(bar) => {
                hasher.update([1]);
                hash_text(&mut hasher, &bar.bar_type.to_string())?;
                for price in [bar.open, bar.high, bar.low, bar.close] {
                    hash_text(&mut hasher, &price.to_string())?;
                }
                hash_text(&mut hasher, &bar.volume.to_string())?;
                hasher.update(bar.ts_event.as_u64().to_be_bytes());
                hasher.update(bar.ts_init.as_u64().to_be_bytes());
            }
            Data::Quote(quote) => {
                hasher.update([2]);
                hash_text(&mut hasher, &quote.instrument_id.to_string())?;
                for price in [quote.bid_price, quote.ask_price] {
                    hash_text(&mut hasher, &price.to_string())?;
                }

                for quantity in [quote.bid_size, quote.ask_size] {
                    hash_text(&mut hasher, &quantity.to_string())?;
                }
                hasher.update(quote.ts_event.as_u64().to_be_bytes());
                hasher.update(quote.ts_init.as_u64().to_be_bytes());
            }
            _ => return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch),
        }
    }
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
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
        bar_schedule::{BarScheduleCutV1, BarScheduleFactV1, BarScheduleReceiptV1},
        pit_snapshot::{
            UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
            UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime,
            UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
        },
    };

    fn digest(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
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

    fn rows_for(instrument: &str, quote_event: u64) -> Vec<VerifiedPitObservation> {
        let mut rows = Vec::new();

        for (field, mantissa, scale) in [
            ("OPEN", 10_000, 2),
            ("HIGH", 10_100, 2),
            ("LOW", 9_900, 2),
            ("CLOSE", 10_050, 2),
            ("VOLUME", 1_000, 0),
        ] {
            rows.push(row(instrument, "BAR", "1M", field, mantissa, scale, 100));
        }

        for (field, mantissa, scale) in [
            ("BID_PRICE", 10_000, 2),
            ("ASK_PRICE", 10_001, 2),
            ("BID_SIZE", 100, 0),
            ("ASK_SIZE", 100, 0),
        ] {
            rows.push(row(
                instrument,
                "QUOTE",
                "TICK",
                field,
                mantissa,
                scale,
                quote_event,
            ));
        }
        rows
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
            snapshot_identity: digest(12),
            fact_digest: digest(13),
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
            anchor_identity: digest(30),
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

        for (ordinal, instrument) in ["AAA-PERP.SIM", "BBB-PERP.SIM"].into_iter().enumerate() {
            let quote_event = frame_time_ns + 1 + u64::try_from(ordinal).unwrap();

            for (field, mantissa, scale) in [
                ("BID_PRICE", 10_000, 2),
                ("ASK_PRICE", 10_001, 2),
                ("BID_SIZE", 100, 0),
                ("ASK_SIZE", 100, 0),
            ] {
                rows.push(row(
                    instrument,
                    "QUOTE",
                    "TICK",
                    field,
                    mantissa,
                    scale,
                    quote_event,
                ));
            }
        }
        let verified = batch(rows).edit_for_test(|fields| {
            fields.snapshot_identity = digest(seed);
            fields.fact_digest = digest(seed.wrapping_add(1));
        });
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&verified)
            .expect("derived Owner selection");
        let selection_identity = selection.selection_identity();
        let selection_digest = selection.selection_digest();
        let verified = verified.edit_for_test(|fields| {
            fields.universe_selection_digest = selection_digest;

            for candidate in &mut fields.observations {
                candidate.universe_selection_digest = selection_digest;
            }
        });
        let request = NativeReplayInitialMarketRequestV1::new(
            digest(seed),
            digest(seed.wrapping_add(1)),
            digest(20),
            digest(21),
            selection_identity,
            selection_digest,
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
        issue_native_replay_initial_market_readback_v1(
            verified,
            [
                schedule_at("AAA-PERP.SIM", 40, frame_time_ns),
                schedule_at("BBB-PERP.SIM", 41, frame_time_ns),
            ],
            &request,
        )
        .expect("exact initial Market Data readback")
    }

    pub(crate) fn window_request(
        frame_time_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> NativeReplayInitialMarketRequestV1 {
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(rows_for("BBB-PERP.SIM", 102));
        let verified = batch(rows);
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&verified)
            .expect("derived Owner selection");
        NativeReplayInitialMarketRequestV1::new(
            digest(0),
            digest(0),
            digest(20),
            digest(21),
            selection.selection_identity(),
            selection.selection_digest(),
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
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(rows_for("BBB-PERP.SIM", 102));
        let verified = batch(rows);
        let instrument = InstrumentId::from("AAA-PERP.SIM");
        let matching_digest = schedule_at("AAA-PERP.SIM", 40, 100).digest();

        assert_eq!(
            select_native_replay_schedule_v1(
                vec![schedule_at("AAA-PERP.SIM", 40, 100)],
                &verified,
                instrument,
                "1M",
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
                "1M",
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)
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
                "1M",
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
                "1M",
                100,
            )
            .err(),
            Some(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)
        );
    }

    /// A two-member receipt keeps the bytes it had before one-member universes were admitted. The
    /// digest below is what `main` sealed for this fixture before the change (tree `18091e6ca`).
    #[rstest::rstest]
    fn a_two_member_receipt_keeps_its_bytes() {
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(rows_for("BBB-PERP.SIM", 102));
        let readback = seal_native_replay_scheduling_v1(
            batch(rows),
            vec![schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
            vec![
                InstrumentId::from("AAA-PERP.SIM"),
                InstrumentId::from("BBB-PERP.SIM"),
            ],
            100,
            200,
        )
        .unwrap();
        let pinned = "edc17ccfd279ff8e64cccb43fc9aea61c89c48df60fdb8a4df1c0df568a1d71c";
        let expected = (0..pinned.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(&pinned[at..at + 2], 16).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            readback.receipt_digest().as_bytes().as_slice(),
            expected.as_slice()
        );
    }

    /// The receipt hashes its members with no count. Two members hash exactly as they always did;
    /// any other count states itself first, so a one-member receipt never shares a preimage shape
    /// with a two-member one. Checked against the layout itself, not only against a pinned value.
    #[rstest::rstest]
    fn only_a_non_two_member_receipt_states_its_member_count() {
        let untagged = |schedule_digests: &[BindingDigest], instruments: &[InstrumentId]| {
            let mut hasher = Sha256::new();
            hasher.update(RECEIPT_DOMAIN_V1);
            hasher.update(digest(9).as_bytes());
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
        let two_digests = [digest(40), digest(41)];
        let two = [
            InstrumentId::from("AAA-PERP.SIM"),
            InstrumentId::from("BBB-PERP.SIM"),
        ];
        assert_eq!(
            digest_receipt(digest(9), &two_digests, &two, 100, 200, &[]).unwrap(),
            untagged(&two_digests, &two),
            "two members hash exactly as before"
        );
        assert_ne!(
            digest_receipt(digest(9), &two_digests[..1], &two[..1], 100, 200, &[]).unwrap(),
            untagged(&two_digests[..1], &two[..1]),
            "one member states its count"
        );
    }

    #[rstest::rstest]
    fn seals_a_one_member_bar_then_quote_schedule() {
        let member = InstrumentId::from("AAA-PERP.SIM");
        let readback = seal_native_replay_scheduling_v1(
            batch(rows_for("AAA-PERP.SIM", 101)),
            vec![schedule("AAA-PERP.SIM", 40)],
            vec![member],
            100,
            200,
        )
        .expect("a one-member schedule");

        assert_eq!(readback.member_instruments(), [member]);
        assert_eq!(readback.bar_schedule_digests().len(), 1);
        let (bar_types, data) = readback.into_native_schedule();
        assert_eq!(bar_types.len(), 1);
        assert!(matches!(data.as_slice(), [Data::Bar(_), Data::Quote(_)]));
    }

    /// Members are an admitted universe in canonical order or nothing: none, three, a repeated or
    /// a reordered member, and a schedule list of another length, are all refused.
    #[rstest::rstest]
    fn seals_only_an_admitted_canonical_member_list() {
        let a = InstrumentId::from("AAA-PERP.SIM");
        let b = InstrumentId::from("BBB-PERP.SIM");
        let c = InstrumentId::from("CCC-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(rows_for("BBB-PERP.SIM", 102));
        rows.extend(rows_for("CCC-PERP.SIM", 103));
        let seal = |schedules: Vec<BarScheduleReadbackV1>, members: Vec<InstrumentId>| {
            seal_native_replay_scheduling_v1(batch(rows.clone()), schedules, members, 100, 200)
                .map(|_| ())
        };
        let one = || schedule("AAA-PERP.SIM", 40);
        let two = || vec![schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)];

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
            (two(), vec![a]),
        ] {
            assert_eq!(
                seal(schedules, members),
                Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)
            );
        }
    }

    #[rstest::rstest]
    fn seals_exact_two_bar_then_two_quote_schedule() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(rows_for("BBB-PERP.SIM", 102));

        let readback = seal_native_replay_scheduling_v1(
            batch(rows),
            [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
            [first, second],
            100,
            200,
        )
        .unwrap();

        assert_eq!(readback.member_instruments(), [first, second]);
        assert_ne!(
            readback.receipt_digest(),
            BindingDigest::from_untrusted_bytes([0; 32])
        );
        let (_, data) = readback.into_native_schedule();
        assert!(matches!(
            data.as_slice(),
            [Data::Bar(_), Data::Bar(_), Data::Quote(_), Data::Quote(_)]
        ));
    }

    #[rstest::rstest]
    fn initial_market_readback_projects_exact_repair_scope_and_correlation() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(rows_for("BBB-PERP.SIM", 102));
        let batch = batch(rows);
        let selection = crate::owner::strategy_input_binding::derive_universe_selection(&batch)
            .expect("derived Owner selection");
        let selection_identity = selection.selection_identity();
        let selection_digest = selection.selection_digest();
        let batch = batch.edit_for_test(|fields| {
            fields.universe_selection_digest = selection_digest;

            for row in &mut fields.observations {
                row.universe_selection_digest = selection_digest;
            }
        });
        let request = NativeReplayInitialMarketRequestV1::new(
            digest(12),
            digest(13),
            digest(20),
            digest(21),
            selection_identity,
            selection_digest,
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
        let readback = issue_native_replay_initial_market_readback_v1(
            batch,
            [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
            &request,
        )
        .expect("exact initial Market Data readback");

        let source = readback.into_market_data_repair_source();
        assert_eq!(source.pit_request_identity(), digest(10));
        assert_eq!(source.pit_request_digest(), digest(11));
        assert_eq!(source.correlation_identity(), digest(18));
        assert_eq!(source.instrument_scope_digest(), digest(17));
        assert_eq!(source.universe_selection_digest(), selection_digest);
        assert_eq!(source.source_binding_fact_digest(), digest(19));
        assert_eq!(source.pit_snapshot_identity(), digest(12));
        assert_eq!(source.pit_snapshot_fact_digest(), digest(13));
    }

    /// A Design whose roles name one exact instrument does not run under an Owner universe. The
    /// read refuses it by name before it would replace the role's scope with the universe's.
    #[rstest::rstest]
    fn an_exact_instrument_role_is_refused_under_an_owner_universe() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(rows_for("BBB-PERP.SIM", 102));
        let batch = batch(rows);
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
                vec![schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
                &request,
            )
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::ExactInstrumentRolesUnderOwnerUniverse
        );
    }

    #[rstest::rstest]
    fn missing_quote_field_cannot_mint_scheduling_authority() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(
            rows_for("BBB-PERP.SIM", 102)
                .into_iter()
                .filter(|row| row.field() != "ASK_SIZE"),
        );

        assert_eq!(
            seal_native_replay_scheduling_v1(
                batch(rows),
                [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
                [first, second],
                100,
                200,
            )
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::EventOrderUnavailable
        );
    }

    #[rstest::rstest]
    fn duplicate_quote_field_cannot_be_skipped_for_a_later_event() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        let duplicate = rows
            .iter()
            .find(|row| row.field() == "BID_PRICE")
            .unwrap()
            .clone();
        rows.push(duplicate);
        rows.extend(rows_for("BBB-PERP.SIM", 102));

        assert_eq!(
            seal_native_replay_scheduling_v1(
                batch(rows),
                [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
                [first, second],
                100,
                200,
            )
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::FieldCensusMismatch
        );
    }
}
