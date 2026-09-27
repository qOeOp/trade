//! A sealed acceptance proposer of one BAR schedule for a Replay's PIT snapshot.
//!
//! Production has no BAR schedule proposer: `commit_prepared_bar_schedule_v1` is the only writer,
//! and nothing outside tests and the joined-cut acceptance builds a proposal. A native Replay's
//! initial read still needs a schedule cut at its frame (`schedule_bar_specification_at_frame_v1`),
//! so an acceptance that drives that read has to put one in custody first. This module does it
//! from what the store already holds, and nothing else: the caller names a PIT snapshot and one of
//! the roles declared on it, and every schedule field is derived by the Owner from the snapshot's
//! verified batch, the bar its Source Binding declares, the role's binding, and the Instrument
//! Master cut the snapshot binds. It exists
//! only in a build carrying `sealed-strategy-input-acceptance` (or a test build); a production
//! build compiles none of it.

use std::fmt::Display;

use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};

use super::{
    MarketDataOwnerPostgres, declared_bar_timeframe_of_batch_v1, load_bar_schedule_candidates,
    load_durable_instrument_readback, load_pit, pit_instrument_master_identity_preimage_v1,
    strategy_input_binding_registry::{
        load_owner_verified_pit_batch_v1, recover_strategy_input_binding_declaration_v1,
    },
    validate_bar_schedule_history,
};
use crate::owner::{
    bar_schedule::{
        BarScheduleError, BarScheduleReadbackV1, UntrustedBarScheduleProposalV1,
        prepare_bar_schedule_commit_v1,
    },
    instrument_master::InstrumentMasterReadbackV1,
    native_replay_scheduling_v1::{
        NativeReplaySchedulingErrorV1, schedule_bar_specification_at_frame_v1,
    },
    pit_snapshot::{UntrustedPitSnapshotLocator, VerifiedPitObservationBatch},
    source_binding::BindingDigest,
    strategy_input_binding::{
        StrategyInputBindingReceipt, UntrustedStrategyInputScope, bind_strategy_input_role,
    },
};

/// Why no BAR schedule was put in custody for the snapshot and role.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BarScheduleAcceptanceErrorV1 {
    /// The store holds no Available snapshot under this locator.
    SnapshotUnavailable,
    /// The snapshot's observation batch did not verify.
    BatchUnverified,
    /// No role of this Design is declared on the snapshot.
    RoleNotDeclared,
    /// The role spans more than one universe member; a schedule is one instrument's.
    ScheduleRoleSpansMembers,
    /// The role's row is not a BAR.
    RoleNotBar,
    /// The snapshot's Source Binding declares no bar timeframe, so there is no bar to schedule.
    SourceBindingDeclaresNoBarTimeframe,
    /// The role reads rows under a timeframe label other than the one its Source Binding declares.
    TimeframeNotDeclared,
    /// The snapshot's Instrument Master readback is not in custody under the request the intake
    /// states for it.
    InstrumentMasterUnavailable,
    /// The Owner refused the derived schedule.
    ScheduleRefused,
    /// The store could not be reached.
    StoreUnavailable,
}

impl Display for BarScheduleAcceptanceErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for BarScheduleAcceptanceErrorV1 {}

/// The schedule the snapshot's frame reads, and whether it was already in custody.
///
/// It carries the exact readback it minted or rejoined, so an acceptance can assert what the
/// schedule states, field by field, rather than only that one exists. It is a sealed acceptance
/// return value; production reads a schedule only through the admitted resolver.
#[derive(Debug, Eq, PartialEq)]
pub struct BarScheduleAcceptanceV1 {
    readback_identity: BindingDigest,
    fact_digest: BindingDigest,
    rejoined: bool,
    schedule: BarScheduleReadbackV1,
}

impl BarScheduleAcceptanceV1 {
    pub const fn readback_identity(&self) -> BindingDigest {
        self.readback_identity
    }

    pub const fn fact_digest(&self) -> BindingDigest {
        self.fact_digest
    }

    /// True when the store already held a schedule the snapshot's frame reads, so none was written.
    pub const fn rejoined(&self) -> bool {
        self.rejoined
    }

    /// The schedule itself, as the store holds it.
    pub const fn schedule(&self) -> &BarScheduleReadbackV1 {
        &self.schedule
    }
}

/// Puts in custody the BAR schedule the native scheduling read selects for `snapshot`'s frame, for
/// the role `input_role` of Design `design` declared on it, and answers it.
///
/// The schedule states exactly the bar the snapshot's Source Binding declares - cadence, anchor,
/// clock, label and completion - and the role's timeframe label only has to be the one that
/// declaration describes; it is never parsed. Its interval is the Instrument Master fact's; it is
/// cut at the snapshot's event instant, and extends the instrument's schedule history. Two roles of
/// one instrument under one declaration put one schedule in custody. When the store already holds a
/// schedule the frame reads and the declaration admits, that schedule is answered and nothing is
/// written.
///
/// # Errors
///
/// Each refusal is named by [`BarScheduleAcceptanceErrorV1`].
pub async fn commit_bar_schedule_for_acceptance_v1(
    owner_url: &str,
    snapshot: &UntrustedPitSnapshotLocator,
    design: BindingDigest,
    input_role: BindingDigest,
) -> Result<BarScheduleAcceptanceV1, BarScheduleAcceptanceErrorV1> {
    let owner = MarketDataOwnerPostgres::connect_existing(owner_url)
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::StoreUnavailable)?;
    Box::pin(commit_bar_schedule_on_v1(
        &owner, snapshot, design, input_role,
    ))
    .await
}

/// [`commit_bar_schedule_for_acceptance_v1`] on an Owner the caller already holds.
pub(super) async fn commit_bar_schedule_on_v1(
    owner: &MarketDataOwnerPostgres,
    snapshot: &UntrustedPitSnapshotLocator,
    design: BindingDigest,
    input_role: BindingDigest,
) -> Result<BarScheduleAcceptanceV1, BarScheduleAcceptanceErrorV1> {
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::StoreUnavailable)?;
    let pit = load_pit(&mut transaction, snapshot.snapshot_identity, false, false)
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::StoreUnavailable)?
        .filter(|pit| pit.receipt().locator() == snapshot)
        .ok_or(BarScheduleAcceptanceErrorV1::SnapshotUnavailable)?;
    let batch = load_owner_verified_pit_batch_v1(&mut transaction, snapshot.snapshot_identity)
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::BatchUnverified)?;
    let declaration = recover_strategy_input_binding_declaration_v1(
        &mut transaction,
        pit.fact().request_identity(),
        design,
        input_role,
    )
    .await
    .map_err(|_| BarScheduleAcceptanceErrorV1::RoleNotDeclared)?;
    let binding = exact_binding_v1(declaration.exact_binding(), declaration.request(), &batch)?;
    // A role whose row is not a BAR has no schedule, whatever its timeframe says.
    let is_bar = crate::owner::strategy_input_binding::project_sample_fact_v1(&binding, &batch)
        .is_ok_and(|source| source.row.data_kind() == "BAR");

    if !is_bar {
        return Err(BarScheduleAcceptanceErrorV1::RoleNotBar);
    }
    let instrument = binding.locator().instrument().to_owned();
    let declared =
        declared_bar_timeframe_of_batch_v1(&mut transaction, &batch, binding.locator().timeframe())
            .await
            .map_err(|e| match e {
                NativeReplaySchedulingErrorV1::SourceBindingDeclaresNoBarTimeframe => {
                    BarScheduleAcceptanceErrorV1::SourceBindingDeclaresNoBarTimeframe
                }
                NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch => {
                    BarScheduleAcceptanceErrorV1::TimeframeNotDeclared
                }
                _ => BarScheduleAcceptanceErrorV1::StoreUnavailable,
            })?;
    let master = snapshot_instrument_master_v1(&mut transaction, &pit, &batch).await?;
    let event = batch.time_evidence().event_effective.value;

    let history = validate_bar_schedule_history(&mut transaction, &instrument, true)
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::StoreUnavailable)?;
    let candidates = load_bar_schedule_candidates(&mut transaction, &instrument)
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::StoreUnavailable)?;

    if let Some(existing) = candidates.into_iter().find(|candidate| {
        declared.admits_schedule(candidate.fact())
            && schedule_bar_specification_at_frame_v1(candidate, &batch, &instrument, event).is_ok()
    }) {
        transaction
            .rollback()
            .await
            .map_err(|_| BarScheduleAcceptanceErrorV1::StoreUnavailable)?;
        return Ok(answer_v1(existing, true));
    }

    let [master_fact] = master
        .facts()
        .iter()
        .filter(|fact| fact.canonical_identity() == instrument)
        .collect::<Vec<_>>()[..]
    else {
        return Err(BarScheduleAcceptanceErrorV1::InstrumentMasterUnavailable);
    };
    let proposal = UntrustedBarScheduleProposalV1 {
        canonical_instrument: instrument.clone(),
        predecessor_fact_digest: history,
        effective_from: master_fact.effective_from(),
        effective_until: master_fact.effective_until(),
        kind: declared.kind(),
        step: declared.step(),
        unit: declared.unit(),
        anchor_identity: declared.anchor_identity(),
        clock: declared.clock(),
        label: declared.label(),
        completion: declared.completion(),
    };
    let prepared = prepare_bar_schedule_commit_v1(proposal, &binding, &batch, &master, &master)
        .map_err(|e| match e {
            BarScheduleError::UnsupportedDataKind => BarScheduleAcceptanceErrorV1::RoleNotBar,
            _ => BarScheduleAcceptanceErrorV1::ScheduleRefused,
        })?;
    transaction
        .rollback()
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::StoreUnavailable)?;
    let stored = owner
        .commit_prepared_bar_schedule_v1(&prepared)
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::ScheduleRefused)?;
    Ok(answer_v1(stored, false))
}

fn answer_v1(readback: BarScheduleReadbackV1, rejoined: bool) -> BarScheduleAcceptanceV1 {
    BarScheduleAcceptanceV1 {
        readback_identity: BindingDigest::from_untrusted_bytes(*readback.identity().as_bytes()),
        fact_digest: BindingDigest::from_untrusted_bytes(*readback.fact().digest().as_bytes()),
        rejoined,
        schedule: readback,
    }
}

/// The role's single-instrument binding over the batch. A universe-member declaration is bound
/// again for its one member, through the same Owner binding an exact declaration takes.
fn exact_binding_v1(
    exact: Option<&StrategyInputBindingReceipt>,
    request: &crate::owner::strategy_input_binding::UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputBindingReceipt, BarScheduleAcceptanceErrorV1> {
    if let Some(binding) = exact {
        return Ok(binding.clone());
    }
    let mut members = batch
        .observations()
        .iter()
        .map(|row| row.instrument().to_owned())
        .collect::<Vec<_>>();
    members.sort();
    members.dedup();
    let [member] = members.as_slice() else {
        return Err(BarScheduleAcceptanceErrorV1::ScheduleRoleSpansMembers);
    };
    let mut exact_request = request.clone();
    exact_request.scope = UntrustedStrategyInputScope::ExactInstrument {
        instrument: member.clone(),
    };
    bind_strategy_input_role(&exact_request, batch)
        .map_err(|_| BarScheduleAcceptanceErrorV1::RoleNotBar)
}

/// The Instrument Master readback the snapshot binds, found under the request the PIT intake states
/// for it and required to be the one the batch names.
async fn snapshot_instrument_master_v1(
    transaction: &mut Transaction<'_, Postgres>,
    pit: &crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
    batch: &VerifiedPitObservationBatch,
) -> Result<InstrumentMasterReadbackV1, BarScheduleAcceptanceErrorV1> {
    let request = pit.fact().request();
    let mut members = batch
        .observations()
        .iter()
        .map(|row| row.instrument().to_owned())
        .collect::<Vec<_>>();
    members.sort();
    members.dedup();
    let preimage = pit_instrument_master_identity_preimage_v1(
        request.correlation_identity,
        request.universe_selection_digest,
        &members,
        i128::from(request.time_evidence.event_effective.value),
        request.time_evidence.decision_cut.value,
    )
    .map_err(|_| BarScheduleAcceptanceErrorV1::InstrumentMasterUnavailable)?;
    let identity = BindingDigest::from_untrusted_bytes(Sha256::digest(preimage).into());
    let readback = load_durable_instrument_readback(transaction, identity, false)
        .await
        .map_err(|_| BarScheduleAcceptanceErrorV1::StoreUnavailable)?
        .ok_or(BarScheduleAcceptanceErrorV1::InstrumentMasterUnavailable)?;
    if readback.digest() != batch.instrument_master_digest() {
        return Err(BarScheduleAcceptanceErrorV1::InstrumentMasterUnavailable);
    }
    Ok(readback)
}
