//! One Owner-issued V4 BAR joined cut consumed by the real Backtest engine.
//!
//! Scheduling data is derived only from the move-only handoff. It carries no value or coordinate
//! authority and cannot replace, omit, duplicate, or reorder the admitted Market Data event.

use std::{collections::VecDeque, fmt::Debug, rc::Rc, sync::Arc};

use serde::Serialize;
use strategy_factory_program_sdk::lifecycle_v1::{
    EnvelopePayloadV1, EventOrderKeyV1, LifecycleEnvelopeV1, LifecycleKind,
};
use vibe_backtest::{
    config::BacktestEngineConfig, engine::BacktestEngine, result::CanonicalBacktestResult,
};
use vibe_common::actor::DataActor;
use vibe_core::UnixNanos;
use vibe_model::{
    data::{CustomData, CustomDataTrait, Data, DataType, HasTsInit},
    identifiers::StrategyId,
};
use vibe_trading::{
    strategy::{StrategyConfig, StrategyCore},
    vibe_strategy,
};

use crate::{
    native_replay_v2::{AdmittedBarMemberV1, PreparedProgramHostBarHandoffV1},
    program_host_v2::ProgramHostV2,
};

const BAR_JOINED_CUT_DATA_TYPE_V1: &str = "StrategyInputBarJoinedCutTriggerV1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct BarJoinedCutTriggerV1 {
    projection_digest: [u8; 32],
    logical_time_ns: u64,
    event_time_ns: u64,
    owner_sequence: u64,
    event_identity: [u8; 16],
}

impl HasTsInit for BarJoinedCutTriggerV1 {
    fn ts_init(&self) -> UnixNanos {
        self.logical_time_ns.into()
    }
}

impl CustomDataTrait for BarJoinedCutTriggerV1 {
    fn type_name(&self) -> &'static str {
        BAR_JOINED_CUT_DATA_TYPE_V1
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn ts_event(&self) -> UnixNanos {
        self.event_time_ns.into()
    }

    fn to_json(&self) -> anyhow::Result<String> {
        serde_json::to_string(self).map_err(Into::into)
    }

    fn clone_arc(&self) -> Arc<dyn CustomDataTrait> {
        Arc::new(self.clone())
    }

    fn eq_arc(&self, other: &dyn CustomDataTrait) -> bool {
        other.as_any().downcast_ref::<Self>() == Some(self)
    }
}

/// Read-only result of the exact V4 projection consumed by one real Backtest run.
///
/// It deliberately has no deserializer and carries no Market Data or execution authority.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct OwnerBarJoinedCutBacktestReadbackV1 {
    callback_failure: Option<String>,
    host_identity: [u8; 32],
    projection_digest: [u8; 32],
    schedule_dependency_set_digest: [u8; 32],
    logical_time_ns: u64,
    event_time_ns: u64,
    owner_sequence: u64,
    event_identity: [u8; 16],
    checkpoint_before: [u8; 32],
    checkpoint_after: [u8; 32],
    terminal_checkpoint: [u8; 32],
    semantic_trace: Vec<u8>,
    plugin_calls: u64,
    consumed: bool,
}

impl OwnerBarJoinedCutBacktestReadbackV1 {
    #[must_use]
    pub const fn host_identity(&self) -> [u8; 32] {
        self.host_identity
    }

    #[must_use]
    pub const fn projection_digest(&self) -> [u8; 32] {
        self.projection_digest
    }

    #[must_use]
    pub const fn schedule_dependency_set_digest(&self) -> [u8; 32] {
        self.schedule_dependency_set_digest
    }

    #[must_use]
    pub const fn checkpoint_after(&self) -> [u8; 32] {
        self.checkpoint_after
    }

    #[must_use]
    pub const fn terminal_checkpoint(&self) -> [u8; 32] {
        self.terminal_checkpoint
    }

    #[must_use]
    pub const fn plugin_calls(&self) -> u64 {
        self.plugin_calls
    }

    #[must_use]
    pub const fn consumed(&self) -> bool {
        self.consumed
    }
}

struct OwnerBarJoinedCutBacktestStrategyV1 {
    core: StrategyCore,
    host: ProgramHostV2,
    /// The Owner series in the order it was issued, consumed one member per scheduler trigger.
    events: VecDeque<AdmittedBarMemberV1>,
    /// The first member's projection identity, which the START and STOP lifecycle events derive
    /// their own identities from. Keeping it fixed to the first member leaves a one-cut series
    /// deriving exactly the identities it derived before series existed.
    series_subject: [u8; 32],
    data_type: DataType,
    trace: Rc<std::cell::RefCell<OwnerBarJoinedCutBacktestReadbackV1>>,
}

impl OwnerBarJoinedCutBacktestStrategyV1 {
    fn from_handoff(
        handoff: PreparedProgramHostBarHandoffV1,
        trace: Rc<std::cell::RefCell<OwnerBarJoinedCutBacktestReadbackV1>>,
    ) -> anyhow::Result<(Self, Vec<Data>)> {
        let projection_digest = handoff.sample_projection_digest();
        let schedule_dependency_set_digest = handoff.schedule_dependency_set_digest();
        let (host, members) = handoff.into_bar_parts_v1()?;
        anyhow::ensure!(!members.is_empty(), "Owner V4 handoff carried no BAR event");
        let data_type = DataType::new(BAR_JOINED_CUT_DATA_TYPE_V1, None, None);
        let mut data = Vec::with_capacity(members.len());

        for member in &members {
            let envelope = member.event.envelope();
            anyhow::ensure!(
                envelope.order_key.kind == LifecycleKind::Bar
                    && matches!(envelope.payload, EnvelopePayloadV1::Bar),
                "Owner V4 handoff carried a member that is not a BAR event"
            );
            data.push(Data::Custom(CustomData::new(
                Arc::new(BarJoinedCutTriggerV1 {
                    projection_digest: member.sample_projection_digest,
                    logical_time_ns: envelope.order_key.logical_time_ns,
                    event_time_ns: envelope.order_key.event_time_ns,
                    owner_sequence: envelope.order_key.owner_sequence,
                    event_identity: envelope.order_key.event_identity,
                }),
                data_type.clone(),
            )));
        }
        // The readback describes the series by its first member, as the handoff accessors do, so
        // an assertion written against one cut keeps meaning what it meant.
        let first = members[0].event.envelope().order_key;
        *trace.borrow_mut() = OwnerBarJoinedCutBacktestReadbackV1 {
            host_identity: *host.host_identity().as_bytes(),
            projection_digest,
            schedule_dependency_set_digest,
            logical_time_ns: first.logical_time_ns,
            event_time_ns: first.event_time_ns,
            owner_sequence: first.owner_sequence,
            event_identity: first.event_identity,
            ..Default::default()
        };
        Ok((
            Self {
                core: StrategyCore::new(
                    StrategyConfig::builder()
                        .strategy_id(StrategyId::from("OWNER-V4-BAR-BACKTEST-001"))
                        .build()?,
                ),
                host,
                series_subject: members[0].sample_projection_digest,
                events: members.into(),
                data_type,
                trace,
            },
            data,
        ))
    }

    fn on_start_checked(&mut self) -> anyhow::Result<()> {
        let first = self
            .events
            .front()
            .ok_or_else(|| anyhow::anyhow!("Owner V4 BAR series is unavailable"))?;
        let logical_time = first
            .event
            .envelope()
            .order_key
            .logical_time_ns
            .saturating_sub(1);

        let envelope = lifecycle_envelope(
            logical_time,
            logical_time,
            LifecycleKind::Start,
            1,
            stable_identity(b"strategy.owner-v4-bar.start.v1\0", &self.series_subject),
            EnvelopePayloadV1::Start,
        )?;
        let event = self.host.admit_backtest_lifecycle_event(envelope)?;
        self.host.apply_event(&event)?;
        self.subscribe_data(self.data_type.clone(), None, None);
        Ok(())
    }

    fn on_data_checked(&mut self, data: &CustomData) -> anyhow::Result<()> {
        anyhow::ensure!(
            data.data_type == self.data_type,
            "foreign V4 BAR scheduler type"
        );
        let trigger = data
            .data
            .as_any()
            .downcast_ref::<BarJoinedCutTriggerV1>()
            .ok_or_else(|| anyhow::anyhow!("foreign V4 BAR scheduler payload"))?;
        let member = self
            .events
            .pop_front()
            .ok_or_else(|| anyhow::anyhow!("V4 BAR scheduler outran the Owner series"))?;
        let event = member.event;
        let key = event.envelope().order_key;
        anyhow::ensure!(
            trigger.projection_digest == member.sample_projection_digest
                && (
                    trigger.logical_time_ns,
                    trigger.event_time_ns,
                    trigger.owner_sequence,
                    trigger.event_identity
                ) == (
                    key.logical_time_ns,
                    key.event_time_ns,
                    key.owner_sequence,
                    key.event_identity
                ),
            "V4 BAR scheduler identity does not match the Owner event"
        );
        let before = self.host.checkpoint().digest();
        let semantic_trace = self.host.apply_event(&event)?;
        let after = self.host.checkpoint().digest();
        let mut trace = self.trace.borrow_mut();

        if !trace.consumed {
            // The first member's before-checkpoint is the series' before-checkpoint; later members
            // start from where the previous one ended.
            trace.checkpoint_before = *before.as_bytes();
        }
        trace.checkpoint_after = *after.as_bytes();
        trace.semantic_trace = semantic_trace.encode().to_vec();
        trace.plugin_calls = self.host.plugin_calls();
        trace.consumed = true;
        Ok(())
    }

    fn on_stop_checked(&mut self) -> anyhow::Result<()> {
        self.unsubscribe_data(self.data_type.clone(), None, None);
        anyhow::ensure!(
            self.events.is_empty(),
            "Backtest stopped before consuming the whole Owner V4 BAR series"
        );
        let now = self.clock().timestamp_ns().as_u64();
        let envelope = lifecycle_envelope(
            now,
            now,
            LifecycleKind::Stop,
            u64::MAX,
            stable_identity(b"strategy.owner-v4-bar.stop.v1\0", &self.series_subject),
            EnvelopePayloadV1::Stop,
        )?;
        let event = self.host.admit_backtest_lifecycle_event(envelope)?;
        self.host.apply_event(&event)?;
        let mut trace = self.trace.borrow_mut();
        trace.terminal_checkpoint = *self.host.checkpoint().digest().as_bytes();
        trace.plugin_calls = self.host.plugin_calls();
        Ok(())
    }

    fn finish_callback(&self, result: anyhow::Result<()>) -> anyhow::Result<()> {
        if let Err(e) = &result {
            self.trace.borrow_mut().callback_failure = Some(format!("{e:#}"));
        }
        result
    }
}

vibe_strategy!(OwnerBarJoinedCutBacktestStrategyV1);

impl Debug for OwnerBarJoinedCutBacktestStrategyV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("OwnerBarJoinedCutBacktestStrategyV1")
    }
}

impl DataActor for OwnerBarJoinedCutBacktestStrategyV1 {
    fn on_start(&mut self) -> anyhow::Result<()> {
        let result = self.on_start_checked();
        self.finish_callback(result)
    }

    fn on_data(&mut self, data: &CustomData) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.trace.borrow().callback_failure.is_none(),
            "Owner V4 BAR Backtest strategy is faulted"
        );
        let result = self.on_data_checked(data);
        self.finish_callback(result)
    }

    fn on_stop(&mut self) -> anyhow::Result<()> {
        let result = self.on_stop_checked();
        self.finish_callback(result)
    }
}

/// What one real Backtest run of a V4 BAR handoff observed.
///
/// The two readbacks answer different questions and are deliberately kept apart: the receipt is the
/// deterministic consumption evidence, and the canonical result is what the run earned and traded.
/// Adding economics to the receipt would blur what an assertion about the receipt means.
#[derive(Clone, Debug)]
pub struct OwnerBarJoinedCutBacktestRunV1 {
    receipt: OwnerBarJoinedCutBacktestReadbackV1,
    canonical_result: CanonicalBacktestResult,
}

impl OwnerBarJoinedCutBacktestRunV1 {
    /// Returns the deterministic consumption receipt.
    #[must_use]
    pub const fn receipt(&self) -> &OwnerBarJoinedCutBacktestReadbackV1 {
        &self.receipt
    }

    /// Returns the canonical result of the run, the authority for every economic number.
    #[must_use]
    pub const fn canonical_result(&self) -> &CanonicalBacktestResult {
        &self.canonical_result
    }
}

/// Consumes one V4 BAR handoff in the real Backtest engine.
///
/// # Errors
///
/// Returns an error if handoff revalidation, scheduling, Host execution, complete terminal
/// consumption, or canonical projection fails. Callback failure is promoted from Backtest logging
/// to the returned result.
pub fn run_prepared_owner_bar_joined_cut_backtest_v1(
    handoff: PreparedProgramHostBarHandoffV1,
) -> anyhow::Result<OwnerBarJoinedCutBacktestRunV1> {
    let trace = Rc::new(std::cell::RefCell::new(
        OwnerBarJoinedCutBacktestReadbackV1::default(),
    ));
    let (strategy, data) =
        OwnerBarJoinedCutBacktestStrategyV1::from_handoff(handoff, Rc::clone(&trace))?;
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        ..Default::default()
    })?;
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(None, None, Some("owner-v4-bar-joined-cut-v1".into()), false)?;
    let observed = trace.borrow().clone();
    if let Some(failure) = &observed.callback_failure {
        anyhow::bail!("Owner V4 BAR Backtest callback failed: {failure}");
    }
    anyhow::ensure!(
        observed.consumed,
        "Owner V4 BAR Backtest returned without consumption"
    );
    // `run_analysis` stays off: it gates only the post-run performance log, which `bypass_logging`
    // suppresses anyway. Statistics are computed on demand by the canonical projection below.
    let canonical_result = engine.get_canonical_result()?;
    Ok(OwnerBarJoinedCutBacktestRunV1 {
        receipt: observed,
        canonical_result,
    })
}

fn lifecycle_envelope(
    logical_time_ns: u64,
    event_time_ns: u64,
    kind: LifecycleKind,
    owner_sequence: u64,
    event_identity: [u8; 16],
    payload: EnvelopePayloadV1,
) -> anyhow::Result<LifecycleEnvelopeV1> {
    let key = EventOrderKeyV1::new(
        logical_time_ns,
        event_time_ns,
        kind,
        owner_sequence,
        event_identity,
    )
    .map_err(|e| anyhow::anyhow!("V4 BAR lifecycle key rejected: {e:?}"))?;
    LifecycleEnvelopeV1::new_bound(key, payload)
        .map_err(|e| anyhow::anyhow!("V4 BAR lifecycle rejected: {e:?}"))
}

fn stable_identity(domain: &[u8], digest: &[u8; 32]) -> [u8; 16] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(digest);
    let mut identity = [0; 16];
    identity.copy_from_slice(&hasher.finalize()[..16]);
    identity
}
