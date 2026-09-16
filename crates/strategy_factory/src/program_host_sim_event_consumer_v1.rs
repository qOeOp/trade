//! Move-only `ProgramHostV2` target-set execution in the real Sim Exchange EVENT route.
//!
//! Replay policy materialization owns construction of the capability. This module owns the sole
//! consumption boundary and returns observations only after native fills have been accepted by the
//! running Host. BAR values schedule ProgramHost input; `bar_execution = false` keeps execution on
//! native order-book events.
//!
//! A run that reduces a real native position must also prove it closed: this module admits a
//! complete entry-fill-exit-fill-flat round trip only when the run's own canonical Backtest result
//! reports every member position closed, and it faults a run that reduced a position without
//! reaching that closure.
//!
//! Closure needs an exit target set, and therefore a second Owner-sealed frame. The request
//! execution bundle admits exactly one, so every request this consumer can be handed today enters
//! without exiting and reports [`ProgramHostSimEventReadbackV1::round_trip`] as `None`. The
//! derivation is nevertheless the production one, and the focused acceptance target drives a real
//! two-frame Sim EVENT run through it; a bundle which carries an exit frame needs no change here.

use std::{
    cell::Cell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};

use anyhow::Context;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_MEMBER_COUNT;
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_model::instruments::Instrument;

use crate::{
    program_host_backtest_target_set_v2::{
        BacktestTargetSetProgramHostStrategyV2, TargetSetActualFillConsumptionV1,
        TargetSetBacktestTraceV2,
    },
    replay_target_set_execution_bundle_v1::{
        ReplayTargetSetExecutionBundleV1, ReplayTargetSetExecutionCensusV1,
    },
};

const CANONICAL_RESULT_DOMAIN: &[u8] = b"strategy.program-host.sim-event.result.v1\0";
const ROUND_TRIP_CLOSURE_DOMAIN: &[u8] = b"strategy.program-host.sim-event.round-trip.v1\0";

/// Host position intents which open or grow a real native member position.
const ENTRY_POSITION_INTENTS: [&str; 2] = ["ENTER", "ADD"];

/// Host position intents which give a real native member position back to the venue.
const EXIT_POSITION_INTENTS: [&str; 2] = ["REDUCE", "EXIT"];

/// One native fill proven to have advanced the exact running Host member.
///
/// It has no public constructor or deserializer. Canceled, rejected, expired, and zero-quantity
/// observations cannot produce this value.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProgramHostSimEventFillReadbackV1 {
    client_order_id: String,
    instrument: String,
    intent_identity: [u8; 16],
    disposition: String,
    position_intent: String,
    cumulative_filled_grid_units: u64,
    filled_native_quantity: String,
    position_before_grid_units: i64,
    position_after_grid_units: i64,
    checkpoint_before: [u8; 32],
    checkpoint_after: [u8; 32],
}

impl ProgramHostSimEventFillReadbackV1 {
    #[must_use]
    pub fn client_order_id(&self) -> &str {
        &self.client_order_id
    }

    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    #[must_use]
    pub const fn intent_identity(&self) -> [u8; 16] {
        self.intent_identity
    }

    #[must_use]
    pub fn disposition(&self) -> &str {
        &self.disposition
    }

    /// Returns the Host position intent this fill advanced: `ENTER`, `ADD`, `REDUCE`, or `EXIT`.
    #[must_use]
    pub fn position_intent(&self) -> &str {
        &self.position_intent
    }

    /// Returns the exact reconciled member grid position the running Host held before this fill.
    #[must_use]
    pub const fn position_before_grid_units(&self) -> i64 {
        self.position_before_grid_units
    }

    /// Returns the exact reconciled member grid position the running Host held after this fill.
    #[must_use]
    pub const fn position_after_grid_units(&self) -> i64 {
        self.position_after_grid_units
    }

    /// Returns whether this fill grew the real native position the member held.
    #[must_use]
    const fn grew_position(&self) -> bool {
        self.position_after_grid_units.unsigned_abs()
            > self.position_before_grid_units.unsigned_abs()
    }

    /// Returns whether this fill gave real native position back to the venue.
    #[must_use]
    const fn reduced_position(&self) -> bool {
        self.position_after_grid_units.unsigned_abs()
            < self.position_before_grid_units.unsigned_abs()
    }

    #[must_use]
    pub const fn cumulative_filled_grid_units(&self) -> u64 {
        self.cumulative_filled_grid_units
    }

    #[must_use]
    pub fn filled_native_quantity(&self) -> &str {
        &self.filled_native_quantity
    }

    #[must_use]
    pub const fn checkpoint_before(&self) -> [u8; 32] {
        self.checkpoint_before
    }

    #[must_use]
    pub const fn checkpoint_after(&self) -> [u8; 32] {
        self.checkpoint_after
    }
}

impl From<TargetSetActualFillConsumptionV1> for ProgramHostSimEventFillReadbackV1 {
    fn from(value: TargetSetActualFillConsumptionV1) -> Self {
        Self {
            client_order_id: value.client_order_id,
            instrument: value.instrument,
            intent_identity: value.intent_identity,
            disposition: value.disposition,
            position_intent: value.position_intent,
            cumulative_filled_grid_units: value.cumulative_filled_grid_units,
            filled_native_quantity: value.filled_native_quantity,
            position_before_grid_units: value.position_before_grid_units,
            position_after_grid_units: value.position_after_grid_units,
            checkpoint_before: value.checkpoint_before,
            checkpoint_after: value.checkpoint_after,
        }
    }
}

/// One member's proven entry-to-flat passage through the real Sim EVENT route.
///
/// It has no public constructor or deserializer. Every field is read back from native fills the
/// running Host accepted and from the canonical Backtest result of the same run.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProgramHostSimEventMemberRoundTripV1 {
    instrument: String,
    entry_fill_count: u32,
    exit_fill_count: u32,
    peak_grid_units: i64,
    final_grid_units: i64,
    closed_position_count: u32,
}

impl ProgramHostSimEventMemberRoundTripV1 {
    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    /// Returns how many accepted native fills advanced this member's `ENTER` or `ADD` intents.
    #[must_use]
    pub const fn entry_fill_count(&self) -> u32 {
        self.entry_fill_count
    }

    /// Returns how many accepted native fills advanced this member's `REDUCE` or `EXIT` intents.
    #[must_use]
    pub const fn exit_fill_count(&self) -> u32 {
        self.exit_fill_count
    }

    /// Returns the largest reconciled grid position this member actually held.
    #[must_use]
    pub const fn peak_grid_units(&self) -> i64 {
        self.peak_grid_units
    }

    /// Returns the native grid position the member held when the real run stopped. It is zero.
    #[must_use]
    pub const fn final_grid_units(&self) -> i64 {
        self.final_grid_units
    }

    /// Returns how many closed position records the canonical Backtest result holds for it.
    #[must_use]
    pub const fn closed_position_count(&self) -> u32 {
        self.closed_position_count
    }
}

/// Read-only proof that one Sim EVENT run entered, filled, exited, filled again, and ended flat.
///
/// It has no public constructor or deserializer, and a run can only produce it when the canonical
/// Backtest result it also returned reports every member position closed and none left open. The
/// closure digest binds this evidence to that exact result, so it cannot be read as proof of a
/// round trip that some other run performed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProgramHostSimEventRoundTripV1 {
    target_set_count: usize,
    members: [ProgramHostSimEventMemberRoundTripV1; TARGET_SET_MEMBER_COUNT],
    canonical_result_digest: [u8; 32],
    closure_digest: [u8; 32],
}

impl ProgramHostSimEventRoundTripV1 {
    /// Returns how many reconciled target sets the run consumed. A closure needs at least two.
    #[must_use]
    pub const fn target_set_count(&self) -> usize {
        self.target_set_count
    }

    #[must_use]
    pub const fn members(
        &self,
    ) -> &[ProgramHostSimEventMemberRoundTripV1; TARGET_SET_MEMBER_COUNT] {
        &self.members
    }

    /// Returns the canonical Backtest result digest this closure is bound to.
    #[must_use]
    pub const fn canonical_result_digest(&self) -> [u8; 32] {
        self.canonical_result_digest
    }

    #[must_use]
    pub const fn closure_digest(&self) -> [u8; 32] {
        self.closure_digest
    }

    /// Returns whether this closure was sealed against the supplied canonical Backtest result.
    #[must_use]
    pub fn is_bound_to(&self, canonical_result_digest: [u8; 32]) -> bool {
        self.canonical_result_digest == canonical_result_digest && self.closure_is_exact()
    }

    /// Verifies that the retained closure facts still match the digest sealed at the boundary.
    #[must_use]
    pub fn closure_is_exact(&self) -> bool {
        round_trip_closure_digest(
            self.canonical_result_digest,
            self.target_set_count,
            &self.members,
        ) == self.closure_digest
    }
}

/// Read-only proof that one bound ProgramHost target set reached native Sim EVENT fills.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProgramHostSimEventReadbackV1 {
    execution_route: String,
    consumption_census: ReplayTargetSetExecutionCensusV1,
    #[serde(skip_serializing)]
    canonical_result: Vec<u8>,
    canonical_result_digest: [u8; 32],
    target_set_count: usize,
    position_submit_count: usize,
    equity_snapshot_identities: Vec<[u8; 32]>,
    actual_fills: Vec<ProgramHostSimEventFillReadbackV1>,
    /// Present only for a run which actually closed. Runs which only entered omit it entirely, so
    /// their semantic-trace serialization and Replay Result V2 identities remain unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    round_trip: Option<ProgramHostSimEventRoundTripV1>,
}

impl ProgramHostSimEventReadbackV1 {
    #[must_use]
    pub fn execution_route(&self) -> &str {
        &self.execution_route
    }

    #[must_use]
    pub const fn execution_profile_digest(&self) -> [u8; 32] {
        self.consumption_census.native_materialization_digest()
    }

    #[must_use]
    pub fn instrument_fact_digests(&self) -> [[u8; 32]; TARGET_SET_MEMBER_COUNT] {
        self.consumption_census.instrument_fact_digests()
    }

    #[must_use]
    pub fn instrument_receipt_digests(&self) -> [[u8; 32]; TARGET_SET_MEMBER_COUNT] {
        self.consumption_census.instrument_receipt_digests()
    }

    #[must_use]
    pub const fn consumption_census(&self) -> &ReplayTargetSetExecutionCensusV1 {
        &self.consumption_census
    }

    #[must_use]
    pub const fn canonical_result_digest(&self) -> [u8; 32] {
        self.canonical_result_digest
    }

    /// Returns the exact canonical Backtest result produced by this EVENT run.
    ///
    /// The Backtest Owner consumes these bytes to create its separate outcome-evidence aggregate.
    /// They are intentionally omitted from this readback's semantic-trace serialization so the
    /// existing trace and Replay Result V2 identities remain unchanged.
    #[must_use]
    pub fn canonical_result(&self) -> &[u8] {
        &self.canonical_result
    }

    /// Verifies that the retained bytes still match the digest produced at the execution boundary.
    #[must_use]
    pub fn canonical_result_is_exact(&self) -> bool {
        canonical_result_digest(&self.canonical_result) == self.canonical_result_digest
    }

    #[must_use]
    pub const fn target_set_count(&self) -> usize {
        self.target_set_count
    }

    #[must_use]
    pub const fn position_submit_count(&self) -> usize {
        self.position_submit_count
    }

    #[must_use]
    pub fn equity_snapshot_identities(&self) -> &[[u8; 32]] {
        &self.equity_snapshot_identities
    }

    #[must_use]
    pub fn actual_fills(&self) -> &[ProgramHostSimEventFillReadbackV1] {
        &self.actual_fills
    }

    /// Returns the complete round-trip closure, when this run entered, filled, exited, filled
    /// again, and ended flat. A run which only entered returns `None`; a run which reduced a real
    /// position without reaching closure never produced a readback at all.
    #[must_use]
    pub const fn round_trip(&self) -> Option<&ProgramHostSimEventRoundTripV1> {
        self.round_trip.as_ref()
    }
}

/// Runs one request-bound ProgramHost target set through the real Backtest/Sim Exchange EVENT path.
///
/// # Errors
///
/// Returns an error before evidence exists if capability validation, whole-batch reconciliation,
/// native submission, callback execution, result capture, or actual fill consumption fails.
pub fn run_program_host_sim_event_consumer_v1(
    capability: ReplayTargetSetExecutionBundleV1,
) -> anyhow::Result<ProgramHostSimEventReadbackV1> {
    let ReplayTargetSetExecutionBundleV1 {
        plan,
        artifact,
        universe_frame,
        native_profile,
        account_scope_id,
        strategy_id,
        run_id,
        instruments,
        bar_types,
        data,
        census,
    } = capability;
    let trace = Rc::new(std::cell::RefCell::new(TargetSetBacktestTraceV2::default()));
    let universe_frames = [universe_frame];
    let admitted_frames = universe_frames.len();
    let strategy = BacktestTargetSetProgramHostStrategyV2::new(
        strategy_id,
        plan,
        artifact,
        instruments.each_ref().map(Instrument::id),
        bar_types,
        universe_frames,
        Some(account_scope_id),
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
    )?;
    let mut engine = native_profile.into_backtest_engine(&instruments)?;
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(None, None, Some(run_id), false)?;

    let observed = trace.borrow().clone();
    if let Some(failure) = &observed.callback_failure {
        anyhow::bail!("ProgramHost Sim EVENT callback failed: {failure}");
    }
    let actual_fills = observed
        .actual_fill_consumptions
        .iter()
        .cloned()
        .map(ProgramHostSimEventFillReadbackV1::from)
        .collect::<Vec<_>>();
    validate_actual_consumption(&observed, &actual_fills, &census, admitted_frames)?;
    let canonical_result = engine.get_canonical_result()?.to_bytes()?;
    let canonical_result_digest = canonical_result_digest(&canonical_result);
    let round_trip = round_trip_closure(
        &observed,
        &actual_fills,
        census.member_instruments(),
        &canonical_result_position_census(&canonical_result)?,
        canonical_result_digest,
    )?;

    Ok(ProgramHostSimEventReadbackV1 {
        execution_route: "EVENT".to_owned(),
        consumption_census: census,
        canonical_result,
        canonical_result_digest,
        target_set_count: observed.canonical_target_sets.len(),
        position_submit_count: observed.successful_position_submits.len(),
        equity_snapshot_identities: observed
            .equity_snapshots
            .iter()
            .map(|snapshot| snapshot.snapshot_identity)
            .collect(),
        actual_fills,
        round_trip,
    })
}

/// Position records the canonical Backtest result holds for one instrument.
#[derive(Clone, Copy, Debug, Default)]
struct CanonicalPositionCensusV1 {
    closed: u32,
    open: u32,
}

/// Admits the complete round trip a run performed, or faults a run which reduced without closing.
///
/// Returns `Ok(None)` for a run whose accepted native fills only ever entered or added, because
/// such a run never claimed to close anything. Once any accepted fill reduced a real member
/// position, every remaining shortfall is a fault rather than absent evidence.
///
/// # Errors
///
/// Returns an error when a run gave native position back to the venue but did not reach its stop
/// boundary, consume both an entry and an exit target set, end every member flat, or produce a
/// canonical Backtest result which reports every member position closed and none left open.
fn round_trip_closure(
    observed: &TargetSetBacktestTraceV2,
    actual_fills: &[ProgramHostSimEventFillReadbackV1],
    member_instruments: &[String; TARGET_SET_MEMBER_COUNT],
    canonical_positions: &BTreeMap<String, CanonicalPositionCensusV1>,
    canonical_result_digest: [u8; 32],
) -> anyhow::Result<Option<ProgramHostSimEventRoundTripV1>> {
    let reduced = actual_fills.iter().any(is_exit_fill);
    if !reduced {
        return Ok(None);
    }
    let final_member_grid_units = observed
        .final_member_grid_units
        .context("Sim EVENT run reduced a native position without reaching its stop boundary")?;
    anyhow::ensure!(
        observed.canonical_target_sets.len() >= 2,
        "Sim EVENT run reduced a native position without consuming an entry and an exit target set"
    );
    let members = try_map_member(|ordinal| {
        member_round_trip(
            &member_instruments[ordinal],
            actual_fills,
            final_member_grid_units[ordinal],
            canonical_positions
                .get(&member_instruments[ordinal])
                .copied()
                .unwrap_or_default(),
        )
    })?;
    let closure_digest = round_trip_closure_digest(
        canonical_result_digest,
        observed.canonical_target_sets.len(),
        &members,
    );
    Ok(Some(ProgramHostSimEventRoundTripV1 {
        target_set_count: observed.canonical_target_sets.len(),
        members,
        canonical_result_digest,
        closure_digest,
    }))
}

/// Admits a fill as an entry leg only when its committed intent and its real delta agree.
fn is_entry_fill(fill: &ProgramHostSimEventFillReadbackV1) -> bool {
    ENTRY_POSITION_INTENTS.contains(&fill.position_intent()) && fill.grew_position()
}

/// Admits a fill as an exit leg only when its committed intent and its real delta agree.
fn is_exit_fill(fill: &ProgramHostSimEventFillReadbackV1) -> bool {
    EXIT_POSITION_INTENTS.contains(&fill.position_intent()) && fill.reduced_position()
}

fn member_round_trip(
    instrument: &str,
    actual_fills: &[ProgramHostSimEventFillReadbackV1],
    final_grid_units: i64,
    canonical_positions: CanonicalPositionCensusV1,
) -> anyhow::Result<ProgramHostSimEventMemberRoundTripV1> {
    let member_fills = actual_fills
        .iter()
        .filter(|fill| fill.instrument() == instrument)
        .collect::<Vec<_>>();
    let entry_fill_count = u32::try_from(
        member_fills
            .iter()
            .copied()
            .filter(|fill| is_entry_fill(fill))
            .count(),
    )?;
    let exit_fill_count = u32::try_from(
        member_fills
            .iter()
            .copied()
            .filter(|fill| is_exit_fill(fill))
            .count(),
    )?;
    let peak_grid_units = member_fills
        .iter()
        .copied()
        .filter(|fill| is_entry_fill(fill))
        .map(ProgramHostSimEventFillReadbackV1::position_after_grid_units)
        .max_by_key(|units| units.unsigned_abs())
        .unwrap_or(0);
    let classified = u32::try_from(member_fills.len())? == entry_fill_count + exit_fill_count;
    let closed_flat = member_fills
        .last()
        .is_some_and(|fill| fill.position_after_grid_units() == 0);
    anyhow::ensure!(
        classified
            && entry_fill_count > 0
            && exit_fill_count > 0
            && peak_grid_units != 0
            && closed_flat
            && final_grid_units == 0
            && canonical_positions.closed > 0
            && canonical_positions.open == 0,
        "Sim EVENT member {instrument} did not enter, fill, exit, fill again, and end flat"
    );
    Ok(ProgramHostSimEventMemberRoundTripV1 {
        instrument: instrument.to_owned(),
        entry_fill_count,
        exit_fill_count,
        peak_grid_units,
        final_grid_units,
        closed_position_count: canonical_positions.closed,
    })
}

/// Reads the exact position records out of the canonical Backtest result this run produced.
fn canonical_result_position_census(
    canonical_result: &[u8],
) -> anyhow::Result<BTreeMap<String, CanonicalPositionCensusV1>> {
    let result = CanonicalBacktestResult::from_slice(canonical_result)
        .context("Sim EVENT run could not read back its own canonical Backtest result")?;
    let positions = result
        .as_value()
        .get("positions")
        .and_then(Value::as_array)
        .context("canonical Backtest result omitted its position records")?;
    let mut census: BTreeMap<String, CanonicalPositionCensusV1> = BTreeMap::new();

    for position in positions {
        let instrument = position
            .get("instrument_id")
            .and_then(Value::as_str)
            .context("canonical Backtest position record omitted its instrument")?;
        let closed = [position.get("ts_closed"), position.get("closing_order_id")]
            .into_iter()
            .all(|value| value.is_some_and(|value| !value.is_null()));
        let entry = census.entry(instrument.to_owned()).or_default();
        if closed {
            entry.closed = entry
                .closed
                .checked_add(1)
                .context("position count overflow")?;
        } else {
            entry.open = entry
                .open
                .checked_add(1)
                .context("position count overflow")?;
        }
    }
    Ok(census)
}

fn round_trip_closure_digest(
    canonical_result_digest: [u8; 32],
    target_set_count: usize,
    members: &[ProgramHostSimEventMemberRoundTripV1; TARGET_SET_MEMBER_COUNT],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ROUND_TRIP_CLOSURE_DOMAIN);
    hasher.update(canonical_result_digest);
    hasher.update((target_set_count as u64).to_le_bytes());

    for member in members {
        hasher.update((member.instrument.len() as u64).to_le_bytes());
        hasher.update(member.instrument.as_bytes());
        hasher.update(member.entry_fill_count.to_le_bytes());
        hasher.update(member.exit_fill_count.to_le_bytes());
        hasher.update(member.peak_grid_units.to_le_bytes());
        hasher.update(member.final_grid_units.to_le_bytes());
        hasher.update(member.closed_position_count.to_le_bytes());
    }
    hasher.finalize().into()
}

fn try_map_member<T>(
    mut map: impl FnMut(usize) -> anyhow::Result<T>,
) -> anyhow::Result<[T; TARGET_SET_MEMBER_COUNT]> {
    Ok([map(0)?, map(1)?])
}

/// Derives the closure a real Sim EVENT run produced, for the focused round-trip acceptance target.
///
/// It runs the exact production derivation over the trace and canonical Backtest result of a real
/// run, so the acceptance target cannot prove a closure the consumer itself would not admit.
#[cfg(test)]
#[allow(
    dead_code,
    reason = "acceptance helpers are selected by focused test targets"
)]
pub(crate) fn program_host_sim_event_round_trip_for_test(
    observed: &TargetSetBacktestTraceV2,
    member_instruments: &[String; TARGET_SET_MEMBER_COUNT],
    canonical_result: &[u8],
) -> anyhow::Result<Option<ProgramHostSimEventRoundTripV1>> {
    let actual_fills = observed
        .actual_fill_consumptions
        .iter()
        .cloned()
        .map(ProgramHostSimEventFillReadbackV1::from)
        .collect::<Vec<_>>();
    round_trip_closure(
        observed,
        &actual_fills,
        member_instruments,
        &canonical_result_position_census(canonical_result)?,
        canonical_result_digest(canonical_result),
    )
}

#[cfg(test)]
#[allow(
    dead_code,
    reason = "acceptance helpers are selected by focused test targets"
)]
pub(crate) fn program_host_sim_event_canonical_result_digest_for_test(bytes: &[u8]) -> [u8; 32] {
    canonical_result_digest(bytes)
}

fn canonical_result_digest(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(CANONICAL_RESULT_DOMAIN);
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
    hasher.finalize().into()
}

fn validate_actual_consumption(
    observed: &TargetSetBacktestTraceV2,
    actual_fills: &[ProgramHostSimEventFillReadbackV1],
    census: &ReplayTargetSetExecutionCensusV1,
    admitted_frames: usize,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        admitted_frames > 0
            && observed.canonical_target_sets.len() == admitted_frames
            && observed.equity_snapshots.len() == admitted_frames,
        "Sim EVENT run did not consume exactly one reconciled target set per admitted frame"
    );
    anyhow::ensure!(
        !observed.successful_position_submits.is_empty() && !actual_fills.is_empty(),
        "Sim EVENT run returned without an actual native fill"
    );
    let submitted = observed
        .successful_position_submits
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut consumed = BTreeSet::new();
    let mut filled_members = BTreeSet::new();

    for fill in actual_fills {
        let native_fill_observed = observed.native_order_observations.iter().any(|event| {
            event.event == "FILLED"
                && event.client_order_id == fill.client_order_id
                && event.instrument == fill.instrument
                && event.intent_identity == fill.intent_identity
                && event.filled_native_quantity == fill.filled_native_quantity
        });
        anyhow::ensure!(
            submitted.contains(fill.client_order_id())
                && native_fill_observed
                && matches!(fill.disposition(), "PARTIALLY_FILLED" | "FILLED")
                && fill.cumulative_filled_grid_units() > 0
                && fill.checkpoint_before() != fill.checkpoint_after()
                && consumed.insert((fill.client_order_id(), fill.cumulative_filled_grid_units())),
            "Sim EVENT actual-consumption evidence is not exact"
        );
        filled_members.insert(fill.instrument());
    }
    let expected_members = census
        .member_instruments()
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    anyhow::ensure!(
        filled_members == expected_members,
        "Sim EVENT run did not fill every request-bound member"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::program_host_backtest_target_set_v2::{
        TargetSetEquitySnapshotObservationV2, TargetSetNativeOrderObservationV2,
    };

    fn actual_fill() -> ProgramHostSimEventFillReadbackV1 {
        ProgramHostSimEventFillReadbackV1 {
            client_order_id: "O-1".to_owned(),
            instrument: "AAPL.XNAS".to_owned(),
            intent_identity: [7; 16],
            disposition: "FILLED".to_owned(),
            position_intent: "ENTER".to_owned(),
            cumulative_filled_grid_units: 2,
            filled_native_quantity: "2".to_owned(),
            position_before_grid_units: 0,
            position_after_grid_units: 2,
            checkpoint_before: [1; 32],
            checkpoint_after: [2; 32],
        }
    }

    fn second_actual_fill() -> ProgramHostSimEventFillReadbackV1 {
        ProgramHostSimEventFillReadbackV1 {
            client_order_id: "O-2".to_owned(),
            instrument: "MSFT.XNAS".to_owned(),
            intent_identity: [8; 16],
            disposition: "FILLED".to_owned(),
            position_intent: "ENTER".to_owned(),
            cumulative_filled_grid_units: 1,
            filled_native_quantity: "1".to_owned(),
            position_before_grid_units: 0,
            position_after_grid_units: 1,
            checkpoint_before: [2; 32],
            checkpoint_after: [3; 32],
        }
    }

    fn exit_fill(
        client_order_id: &str,
        instrument: &str,
        intent_identity: [u8; 16],
        units: u64,
    ) -> ProgramHostSimEventFillReadbackV1 {
        ProgramHostSimEventFillReadbackV1 {
            client_order_id: client_order_id.to_owned(),
            instrument: instrument.to_owned(),
            intent_identity,
            disposition: "FILLED".to_owned(),
            position_intent: "EXIT".to_owned(),
            cumulative_filled_grid_units: units,
            filled_native_quantity: units.to_string(),
            position_before_grid_units: i64::try_from(units).expect("fixture units"),
            position_after_grid_units: 0,
            checkpoint_before: [4; 32],
            checkpoint_after: [5; 32],
        }
    }

    fn round_trip_fills() -> Vec<ProgramHostSimEventFillReadbackV1> {
        vec![
            actual_fill(),
            second_actual_fill(),
            exit_fill("O-3", "AAPL.XNAS", [9; 16], 2),
            exit_fill("O-4", "MSFT.XNAS", [10; 16], 1),
        ]
    }

    fn closed_census() -> BTreeMap<String, CanonicalPositionCensusV1> {
        ["AAPL.XNAS", "MSFT.XNAS"]
            .into_iter()
            .map(|instrument| {
                (
                    instrument.to_owned(),
                    CanonicalPositionCensusV1 { closed: 1, open: 0 },
                )
            })
            .collect()
    }

    fn closed_trace() -> TargetSetBacktestTraceV2 {
        let mut trace = observed("FILLED");
        trace.canonical_target_sets = vec![vec![1], vec![2]];
        trace.final_member_grid_units = Some([0, 0]);
        trace
    }

    fn member_instruments() -> [String; TARGET_SET_MEMBER_COUNT] {
        ["AAPL.XNAS".to_owned(), "MSFT.XNAS".to_owned()]
    }

    fn observed(event: &str) -> TargetSetBacktestTraceV2 {
        TargetSetBacktestTraceV2 {
            successful_position_submits: vec!["O-1".to_owned(), "O-2".to_owned()],
            canonical_target_sets: vec![vec![1]],
            equity_snapshots: vec![TargetSetEquitySnapshotObservationV2 {
                account_id: "XNAS-001".to_owned(),
                currency: "USD".to_owned(),
                equity: "1000000 USD".to_owned(),
                current_grid_units: [0, 0],
                derived_grid_targets: [2, 0],
                snapshot_identity: [3; 32],
            }],
            native_order_observations: vec![
                TargetSetNativeOrderObservationV2 {
                    client_order_id: "O-1".to_owned(),
                    instrument: "AAPL.XNAS".to_owned(),
                    intent_identity: [7; 16],
                    event: event.to_owned(),
                    status: event.to_owned(),
                    filled_native_quantity: "2".to_owned(),
                    cached_position_native_quantity: "2".to_owned(),
                    protection_order: false,
                },
                TargetSetNativeOrderObservationV2 {
                    client_order_id: "O-2".to_owned(),
                    instrument: "MSFT.XNAS".to_owned(),
                    intent_identity: [8; 16],
                    event: event.to_owned(),
                    status: event.to_owned(),
                    filled_native_quantity: "1".to_owned(),
                    cached_position_native_quantity: "1".to_owned(),
                    protection_order: false,
                },
            ],
            ..Default::default()
        }
    }

    fn native_observation(event: &str) -> TargetSetNativeOrderObservationV2 {
        TargetSetNativeOrderObservationV2 {
            client_order_id: "O-1".to_owned(),
            instrument: "AAPL.XNAS".to_owned(),
            intent_identity: [7; 16],
            event: event.to_owned(),
            status: event.to_owned(),
            filled_native_quantity: "2".to_owned(),
            cached_position_native_quantity: "2".to_owned(),
            protection_order: false,
        }
    }

    #[rstest::rstest]
    fn accepted_native_fill_is_exact_actual_consumption() {
        let census = test_census();
        validate_actual_consumption(
            &observed("FILLED"),
            &[actual_fill(), second_actual_fill()],
            &census,
            1,
        )
        .unwrap();
    }

    #[rstest::rstest]
    fn rejected_or_canceled_observation_cannot_count_as_actual_fill() {
        for terminal in ["REJECTED", "CANCELED", "EXPIRED"] {
            assert!(
                validate_actual_consumption(
                    &observed(terminal),
                    &[actual_fill(), second_actual_fill()],
                    &test_census(),
                    1
                )
                .is_err()
            );
        }
    }

    #[rstest::rstest]
    fn prior_partial_fill_remains_consumed_when_order_later_cancels() {
        let mut trace = observed("FILLED");
        trace
            .native_order_observations
            .push(native_observation("CANCELED"));
        validate_actual_consumption(
            &trace,
            &[actual_fill(), second_actual_fill()],
            &test_census(),
            1,
        )
        .unwrap();
    }

    #[rstest::rstest]
    fn zero_or_unchanged_fill_evidence_fails_closed() {
        let mut zero = actual_fill();
        zero.cumulative_filled_grid_units = 0;
        assert!(
            validate_actual_consumption(
                &observed("FILLED"),
                &[zero, second_actual_fill()],
                &test_census(),
                1
            )
            .is_err()
        );
        let mut unchanged = actual_fill();
        unchanged.checkpoint_after = unchanged.checkpoint_before;
        assert!(
            validate_actual_consumption(
                &observed("FILLED"),
                &[unchanged, second_actual_fill()],
                &test_census(),
                1
            )
            .is_err()
        );
    }

    #[rstest::rstest]
    fn missing_or_duplicate_member_consumption_fails_closed() {
        assert!(
            validate_actual_consumption(&observed("FILLED"), &[actual_fill()], &test_census(), 1)
                .is_err()
        );
        assert!(
            validate_actual_consumption(
                &observed("FILLED"),
                &[actual_fill(), actual_fill()],
                &test_census(),
                1
            )
            .is_err()
        );
    }

    #[rstest::rstest]
    fn complete_round_trip_is_admitted_and_bound_to_its_canonical_result() {
        let closure = round_trip_closure(
            &closed_trace(),
            &round_trip_fills(),
            &member_instruments(),
            &closed_census(),
            [77; 32],
        )
        .unwrap()
        .expect("a run which entered, filled, exited, filled again, and ended flat");
        assert_eq!(closure.target_set_count(), 2);
        assert_eq!(closure.members()[0].instrument(), "AAPL.XNAS");
        assert_eq!(closure.members()[0].entry_fill_count(), 1);
        assert_eq!(closure.members()[0].exit_fill_count(), 1);
        assert_eq!(closure.members()[0].peak_grid_units(), 2);
        assert_eq!(closure.members()[1].peak_grid_units(), 1);
        assert!(
            closure
                .members()
                .iter()
                .all(|member| member.final_grid_units() == 0
                    && member.closed_position_count() == 1)
        );
        assert!(closure.is_bound_to([77; 32]));
        assert!(
            !closure.is_bound_to([78; 32]),
            "closure evidence must not read as proof for another run's result"
        );
        assert!(closure.closure_is_exact());
    }

    #[rstest::rstest]
    fn lifted_or_edited_closure_evidence_fails_its_own_binding() {
        let mut closure = round_trip_closure(
            &closed_trace(),
            &round_trip_fills(),
            &member_instruments(),
            &closed_census(),
            [77; 32],
        )
        .unwrap()
        .expect("complete closure");
        let sealed = closure.clone();
        closure.members[0].exit_fill_count += 1;
        assert!(!closure.closure_is_exact());
        assert!(!closure.is_bound_to([77; 32]));
        let mut relabelled = sealed;
        relabelled.canonical_result_digest = [78; 32];
        assert!(!relabelled.is_bound_to([78; 32]));
    }

    #[rstest::rstest]
    fn run_which_only_entered_reports_no_closure() {
        let closure = round_trip_closure(
            &observed("FILLED"),
            &[actual_fill(), second_actual_fill()],
            &member_instruments(),
            &BTreeMap::new(),
            [77; 32],
        )
        .unwrap();
        assert!(
            closure.is_none(),
            "a run which never reduced a position must not claim a closure"
        );
    }

    #[rstest::rstest]
    fn fill_whose_intent_contradicts_its_real_position_delta_fails_closed() {
        let mut relabelled = round_trip_fills();
        relabelled[2].position_intent = "ADD".to_owned();
        assert!(
            round_trip_closure(
                &closed_trace(),
                &relabelled,
                &member_instruments(),
                &closed_census(),
                [77; 32],
            )
            .is_err(),
            "a fill labelled as an entry while it gave position back cannot be classified"
        );
        let mut inflated = round_trip_fills();
        inflated[0].position_intent = "EXIT".to_owned();
        assert!(
            round_trip_closure(
                &closed_trace(),
                &inflated,
                &member_instruments(),
                &closed_census(),
                [77; 32],
            )
            .is_err(),
            "a fill labelled as an exit while it grew the position cannot be classified"
        );
    }

    #[rstest::rstest]
    fn reduced_position_without_complete_closure_fails_closed() {
        let unstopped = {
            let mut trace = closed_trace();
            trace.final_member_grid_units = None;
            trace
        };
        let still_holding = {
            let mut trace = closed_trace();
            trace.final_member_grid_units = Some([0, 1]);
            trace
        };
        let single_target_set = {
            let mut trace = closed_trace();
            trace.canonical_target_sets = vec![vec![1]];
            trace
        };

        for trace in [unstopped, still_holding, single_target_set] {
            assert!(
                round_trip_closure(
                    &trace,
                    &round_trip_fills(),
                    &member_instruments(),
                    &closed_census(),
                    [77; 32],
                )
                .is_err()
            );
        }
        let one_member_exited = round_trip_fills()
            .into_iter()
            .filter(|fill| fill.instrument() == "AAPL.XNAS" || fill.position_intent() == "ENTER")
            .collect::<Vec<_>>();
        assert!(
            round_trip_closure(
                &closed_trace(),
                &one_member_exited,
                &member_instruments(),
                &closed_census(),
                [77; 32],
            )
            .is_err(),
            "one member left open cannot pass as a complete closure"
        );
        let mut still_open = closed_census();
        still_open.insert(
            "MSFT.XNAS".to_owned(),
            CanonicalPositionCensusV1 { closed: 1, open: 1 },
        );
        assert!(
            round_trip_closure(
                &closed_trace(),
                &round_trip_fills(),
                &member_instruments(),
                &still_open,
                [77; 32],
            )
            .is_err(),
            "an open position in the canonical result cannot pass as a closure"
        );
        assert!(
            round_trip_closure(
                &closed_trace(),
                &round_trip_fills(),
                &member_instruments(),
                &BTreeMap::new(),
                [77; 32],
            )
            .is_err(),
            "a canonical result without the member positions cannot pass as a closure"
        );
    }

    fn test_census() -> ReplayTargetSetExecutionCensusV1 {
        ReplayTargetSetExecutionCensusV1 {
            request_locator: crate::exploratory_replay::ExploratoryReplayRequestLocatorV2 {
                request_identity: "request".to_owned(),
                meaning_digest: "meaning".to_owned(),
                receipt_identity: "receipt".to_owned(),
                seal_digest: "seal".to_owned(),
            },
            owner_authority_digest: [16; 32],
            trial_family_identity: "trial-family".to_owned(),
            trial_family_digest: [17; 32],
            economic_configuration_digest: [18; 32],
            runner_operational_profile_digest: [19; 32],
            execution_profile_binding_digest: [1; 32],
            native_materialization_digest: [2; 32],
            canonical_plan_digest: [3; 32],
            artifact_identity: [4; 32],
            universe_frame_digest: [5; 32],
            universe_selection_identity: [6; 32],
            universe_selection_digest: [7; 32],
            observation_batch_digest: [8; 32],
            member_instruments: ["AAPL.XNAS".to_owned(), "MSFT.XNAS".to_owned()],
            instrument_terms: [
                test_instrument_census("AAPL", [9; 32], [11; 32]),
                test_instrument_census("MSFT", [10; 32], [12; 32]),
            ],
            owner_scheduling_receipt_digest: None,
            scheduling_data_digest: [13; 32],
            scheduling_data_count: 4,
            bar_count: 2,
            event_count: 2,
            census_digest: [14; 32],
        }
    }

    fn test_instrument_census(
        instrument_identity: &str,
        instrument_fact_digest: [u8; 32],
        instrument_receipt_digest: [u8; 32],
    ) -> crate::replay_target_set_execution_bundle_v1::ReplayTargetSetInstrumentCensusV1 {
        crate::replay_target_set_execution_bundle_v1::ReplayTargetSetInstrumentCensusV1 {
            instrument_identity: instrument_identity.to_owned(),
            instrument_fact_digest,
            instrument_receipt_digest,
            terms_digest: [15; 32],
            venue_identity: "XNAS".to_owned(),
            quote_currency: "USD".to_owned(),
            account_scope_identity: "XNAS-001".to_owned(),
            event_time_ns: 1_000,
            valid_from_ns: 0,
            valid_until_ns_exclusive: 2_000,
            margin_model: "STANDARD_MARGIN_MODEL".to_owned(),
            maker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 1,
                scale: 4,
            },
            taker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 2,
                scale: 4,
            },
            initial_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 1,
                scale: 1,
            },
            maintenance_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 5,
                scale: 2,
            },
        }
    }
}
