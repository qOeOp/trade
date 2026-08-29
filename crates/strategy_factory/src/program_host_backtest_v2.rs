//! Private StrategyDesignV2 composition into the real Backtest engine.
//!
//! This adapter owns no market-data or execution authority. It consumes already-admitted V2
//! market-data events, maps host-sealed position intent to native Backtest orders, and returns
//! native Sim Exchange fills to the shared lifecycle kernel.

use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet, VecDeque},
    fmt::Debug,
    rc::Rc,
};

use anyhow::Context;
use serde::Serialize;
use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v1::{
    EnvelopePayloadV1, EventOrderKeyV1, FillDispositionV1, FillEventV1, FillSideV1,
    LifecycleEnvelopeV1, LifecycleKind, PositionIntentV1, ProtectionStateV1, SemanticTraceV1,
    TargetStateV1,
};
use vibe_common::actor::DataActor;
use vibe_model::{
    data::{Bar, BarType},
    enums::{OmsType, OrderSide, OrderStatus, TimeInForce, TriggerType},
    events::{OrderEventAny, OrderFilled},
    identifiers::{ClientOrderId, InstrumentId, PositionId, StrategyId},
    instruments::Instrument,
    orders::Order,
    types::{Price, Quantity},
};
use vibe_trading::{
    strategy::{Strategy, StrategyConfig, StrategyCore},
    vibe_strategy,
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    program_host_v2::{AdmittedProgramEventV2, ProgramHostV2, admit_backtest_lifecycle_event_v2},
    strategy_plan_v2::StrategyPlanV2,
};

pub use crate::program_host_v2_backtest_tests::{
    StatefulBacktestNativeReplayEvidenceV2, run_stateful_backtest_native_replay_v2,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct BacktestHostTransitionV2 {
    pub(crate) lifecycle: String,
    pub(crate) position_intent: String,
    pub(crate) protection_action: String,
    pub(crate) position_before_units: i64,
    pub(crate) position_after_units: i64,
    pub(crate) checkpoint_before: [u8; 32],
    pub(crate) checkpoint_after: [u8; 32],
    pub(crate) trace: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct NativeOrderObservationV2 {
    pub(crate) client_order_id: String,
    pub(crate) event: String,
    pub(crate) status: String,
    pub(crate) filled_units: u64,
    pub(crate) cached_position_units: i64,
    pub(crate) protection_order: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub(crate) struct BacktestProgramHostTraceV2 {
    pub(crate) callback_failure: Option<String>,
    pub(crate) host_transitions: Vec<BacktestHostTransitionV2>,
    pub(crate) native_order_observations: Vec<NativeOrderObservationV2>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProtectionActionV2 {
    Keep,
    Replace,
    Adjust,
    Clear,
}

#[derive(Clone, Debug)]
struct PendingNativeFillV2 {
    fill: OrderFilled,
    intent_identity: [u8; 16],
    cumulative_filled_units: u64,
    disposition: FillDispositionV1,
}

pub(crate) struct BacktestProgramHostStrategyV2 {
    core: StrategyCore,
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    host: ProgramHostV2,
    instrument_id: InstrumentId,
    bar_type: BarType,
    bar_events: BTreeMap<u64, AdmittedProgramEventV2>,
    position_orders: BTreeMap<ClientOrderId, [u8; 16]>,
    protection_order: Option<ClientOrderId>,
    protection_orders: BTreeSet<ClientOrderId>,
    desired_protection: ProtectionStateV1,
    pending_fills: VecDeque<PendingNativeFillV2>,
    owner_sequence: u64,
    restore_after_first_full_fill: bool,
    restore_performed: Rc<Cell<bool>>,
    trace: Rc<RefCell<BacktestProgramHostTraceV2>>,
}

impl BacktestProgramHostStrategyV2 {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        strategy_id: StrategyId,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        instrument_id: InstrumentId,
        bar_type: BarType,
        bar_events: impl IntoIterator<Item = AdmittedProgramEventV2>,
        restore_after_first_full_fill: bool,
        restore_performed: Rc<Cell<bool>>,
        trace: Rc<RefCell<BacktestProgramHostTraceV2>>,
    ) -> anyhow::Result<Self> {
        let host = ProgramHostV2::new(plan.clone(), artifact.clone())?;
        let mut events = BTreeMap::new();

        for event in bar_events {
            let envelope = event.envelope();
            anyhow::ensure!(
                envelope.order_key.kind == LifecycleKind::Bar
                    && matches!(envelope.payload, EnvelopePayloadV1::Bar)
                    && events
                        .insert(envelope.order_key.logical_time_ns, event)
                        .is_none(),
                "Backtest V2 bar events must be unique admitted BAR frames"
            );
        }
        anyhow::ensure!(!events.is_empty(), "Backtest V2 corpus has no BAR frames");
        Ok(Self {
            core: StrategyCore::new(
                StrategyConfig::builder()
                    .strategy_id(strategy_id)
                    .oms_type(OmsType::Netting)
                    .build()?,
            ),
            plan,
            artifact,
            host,
            instrument_id,
            bar_type,
            bar_events: events,
            position_orders: BTreeMap::new(),
            protection_order: None,
            protection_orders: BTreeSet::new(),
            desired_protection: ProtectionStateV1::default(),
            pending_fills: VecDeque::new(),
            owner_sequence: 10_000,
            restore_after_first_full_fill,
            restore_performed,
            trace,
        })
    }

    fn on_start_checked(&mut self) -> anyhow::Result<()> {
        self.cache().try_instrument(&self.instrument_id)?;
        let now = self.clock().timestamp_ns().as_u64();
        let envelope = lifecycle_envelope(
            now,
            now,
            LifecycleKind::Start,
            1,
            stable_identity(
                b"strategy.backtest-v2.start\0",
                &[self.host.host_identity().as_bytes()],
            ),
            EnvelopePayloadV1::Start,
        )?;
        let event = admit_backtest_lifecycle_event_v2(&self.plan, envelope)?;
        self.apply_host_event(&event)?;
        self.subscribe_bars(self.bar_type, None, None);
        Ok(())
    }

    fn on_bar_checked(&mut self, bar: &Bar) -> anyhow::Result<()> {
        anyhow::ensure!(bar.bar_type == self.bar_type, "unbound Backtest V2 BarType");
        let now = bar.ts_init.as_u64();
        let event = self
            .bar_events
            .remove(&now)
            .context("missing Owner-admitted Backtest V2 BAR frame")?;
        anyhow::ensure!(
            event.fixed_i128_input("research.input.open.v1") == Some(raw_to_i128(bar.open.raw))
                && event.fixed_i128_input("research.input.close.v1")
                    == Some(raw_to_i128(bar.close.raw)),
            "Owner-admitted Backtest V2 BAR values do not match replay data"
        );
        let trace = self.apply_host_event(&event)?;
        self.apply_protection_transition(trace)?;
        self.apply_position_transition(trace, bar.close)?;
        self.drain_native_fills(now)?;
        Ok(())
    }

    fn on_order_event_checked(&mut self, event: &OrderEventAny) -> anyhow::Result<()> {
        let client_order_id = event.client_order_id();
        let (status, filled_units) = {
            let cache = self.cache();
            let order = cache.try_order(&client_order_id)?;
            (order.status(), exact_units(order.filled_qty())?)
        };
        let protection_order = self.protection_orders.contains(&client_order_id);
        self.trace
            .borrow_mut()
            .native_order_observations
            .push(NativeOrderObservationV2 {
                client_order_id: client_order_id.to_string(),
                event: order_event_name(event).to_owned(),
                status: status.to_string(),
                filled_units,
                cached_position_units: self.cached_position_units()?,
                protection_order,
            });

        let OrderEventAny::Filled(fill) = event else {
            return Ok(());
        };
        let Some(intent_identity) = self.position_orders.get(&client_order_id).copied() else {
            anyhow::ensure!(protection_order, "unassociated native Backtest V2 fill");
            return Ok(());
        };
        let disposition = match status {
            OrderStatus::PartiallyFilled => FillDispositionV1::PartiallyFilled,
            OrderStatus::Filled => FillDispositionV1::Filled,
            status => anyhow::bail!("native fill has unexpected order status {status:?}"),
        };
        let pending = PendingNativeFillV2 {
            fill: fill.clone(),
            intent_identity,
            cumulative_filled_units: filled_units,
            disposition,
        };
        let last = self
            .host
            .kernel_checkpoint()
            .last_order_key
            .context("native fill arrived before lifecycle START")?;
        let fill_time_ns = fill.ts_init.as_u64();
        let fills_before_next_bar = fill_time_ns > last.logical_time_ns
            && self
                .bar_events
                .first_key_value()
                .is_none_or(|(next_bar_time_ns, _)| fill_time_ns < *next_bar_time_ns);
        if fills_before_next_bar
            || (last.logical_time_ns == fill_time_ns
                && last.event_time_ns == fill.ts_event.as_u64()
                && (last.kind as u8) <= LifecycleKind::Fill as u8)
        {
            self.consume_native_fill(&pending)?;
        } else {
            anyhow::ensure!(
                fill_time_ns >= last.logical_time_ns,
                "native fill regressed behind the lifecycle frontier"
            );
            self.pending_fills.push_back(pending);
        }
        Ok(())
    }

    fn drain_native_fills(&mut self, bar_time_ns: u64) -> anyhow::Result<()> {
        while self
            .pending_fills
            .front()
            .is_some_and(|fill| fill.fill.ts_init.as_u64() <= bar_time_ns)
        {
            let fill = self.pending_fills.pop_front().expect("front exists");
            anyhow::ensure!(
                fill.fill.ts_init.as_u64() == bar_time_ns,
                "buffered native fill did not share the admitted BAR timestamp"
            );
            self.consume_native_fill(&fill)?;
        }
        Ok(())
    }

    fn consume_native_fill(&mut self, fill: &PendingNativeFillV2) -> anyhow::Result<()> {
        self.owner_sequence = self
            .owner_sequence
            .checked_add(1)
            .context("Backtest V2 owner sequence exhausted")?;
        let side = match fill.fill.order_side {
            OrderSide::Buy => FillSideV1::Buy,
            OrderSide::Sell => FillSideV1::Sell,
            side => anyhow::bail!("native fill has unsupported side {side:?}"),
        };
        let cumulative = fill.cumulative_filled_units.to_le_bytes();
        let logical = fill.fill.ts_init.as_u64();
        let event_time = fill.fill.ts_event.as_u64();
        let sequence = self.owner_sequence.to_le_bytes();
        let identity = stable_identity(
            b"strategy.backtest-v2.fill\0",
            &[&fill.intent_identity, &cumulative, &sequence],
        );
        let envelope = lifecycle_envelope(
            logical,
            event_time,
            LifecycleKind::Fill,
            self.owner_sequence,
            identity,
            EnvelopePayloadV1::Fill(FillEventV1 {
                intent_identity: fill.intent_identity,
                side,
                disposition: fill.disposition,
                cumulative_filled_units: fill.cumulative_filled_units,
            }),
        )?;
        let event = admit_backtest_lifecycle_event_v2(&self.plan, envelope)?;
        let trace = self.apply_host_event(&event)?;
        if fill.disposition == FillDispositionV1::Filled {
            self.maybe_restore_host(trace)?;
            self.sync_protection_order()?;
        }
        Ok(())
    }

    fn apply_host_event(
        &mut self,
        event: &AdmittedProgramEventV2,
    ) -> anyhow::Result<SemanticTraceV1> {
        let before = self.host.checkpoint().digest();
        let protection_before = self.host.kernel_checkpoint().protection;
        let trace = self.host.apply_event(event)?;
        let protection_action = protection_action(protection_before, trace.protection, trace);
        self.trace
            .borrow_mut()
            .host_transitions
            .push(BacktestHostTransitionV2 {
                lifecycle: lifecycle_name(
                    trace
                        .order_key
                        .context("Backtest V2 trace omitted its order key")?
                        .kind,
                )
                .to_owned(),
                position_intent: position_intent_name(trace.position_intent).to_owned(),
                protection_action: protection_action_name(protection_action).to_owned(),
                position_before_units: trace.position_before_units,
                position_after_units: trace.position_after_units,
                checkpoint_before: *before.as_bytes(),
                checkpoint_after: *self.host.checkpoint().digest().as_bytes(),
                trace: trace.encode().to_vec(),
            });
        Ok(trace)
    }

    fn maybe_restore_host(&mut self, trace: SemanticTraceV1) -> anyhow::Result<()> {
        if self.restore_after_first_full_fill
            && !self.restore_performed.get()
            && trace.position_after_units == 8
        {
            let checkpoint = self.host.checkpoint().clone();
            self.host =
                ProgramHostV2::restore(self.plan.clone(), self.artifact.clone(), &checkpoint)?;
            anyhow::ensure!(
                self.host.checkpoint() == &checkpoint,
                "Backtest V2 Host restore changed the opaque checkpoint"
            );
            self.restore_performed.set(true);
        }
        Ok(())
    }

    fn apply_position_transition(
        &mut self,
        trace: SemanticTraceV1,
        limit_price: Price,
    ) -> anyhow::Result<()> {
        if trace.position_intent == PositionIntentV1::Hold {
            return Ok(());
        }
        let target_units = match trace.target {
            TargetStateV1::Position(units) | TargetStateV1::RebalancePosition { units, .. } => {
                units
            }
            TargetStateV1::None
            | TargetStateV1::WeightMicros(_)
            | TargetStateV1::RebalanceWeightMicros { .. } => {
                anyhow::bail!("Backtest V2 cannot map a non-position target")
            }
        };
        let delta = target_units
            .checked_sub(trace.position_before_units)
            .context("Backtest V2 target delta overflow")?;
        anyhow::ensure!(delta != 0, "Backtest V2 position intent has zero delta");
        let side = if delta > 0 {
            OrderSide::Buy
        } else {
            OrderSide::Sell
        };
        let reduce_only = matches!(
            trace.position_intent,
            PositionIntentV1::Reduce | PositionIntentV1::Exit
        );
        let quantity = self.normalized_quantity(delta.unsigned_abs())?;
        let position_id = reduce_only
            .then(|| self.single_open_position_id())
            .transpose()?;
        let order = self.order().try_limit(
            self.instrument_id,
            side,
            quantity,
            limit_price,
            Some(TimeInForce::Gtc),
            None,
            Some(false),
            Some(reduce_only),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )?;
        let client_order_id = order.client_order_id();
        let pending = self
            .host
            .kernel_checkpoint()
            .pending_intent
            .context("Backtest V2 Host emitted no pending intent")?;
        anyhow::ensure!(
            pending.expected_units == delta.unsigned_abs()
                && pending.side
                    == if side == OrderSide::Buy {
                        FillSideV1::Buy
                    } else {
                        FillSideV1::Sell
                    },
            "Backtest V2 native order does not match the Host pending intent"
        );
        anyhow::ensure!(
            self.position_orders
                .insert(client_order_id, pending.intent_identity)
                .is_none(),
            "Backtest V2 reused a native client order identity"
        );
        self.submit_order(order, position_id, None, None)
    }

    fn apply_protection_transition(&mut self, trace: SemanticTraceV1) -> anyhow::Result<()> {
        let before = self.desired_protection;
        match protection_action(before, trace.protection, trace) {
            ProtectionActionV2::Keep => {}
            ProtectionActionV2::Replace => {
                self.desired_protection = trace.protection;
                self.sync_protection_order()?;
            }
            ProtectionActionV2::Adjust => {
                self.desired_protection = trace.protection;
                self.sync_protection_order()?;
            }
            ProtectionActionV2::Clear => {
                self.desired_protection = ProtectionStateV1::default();

                if let Some(client_order_id) = self.protection_order.take() {
                    self.cancel_order(client_order_id, None, None)?;
                }
            }
        }
        Ok(())
    }

    fn sync_protection_order(&mut self) -> anyhow::Result<()> {
        if self.desired_protection == ProtectionStateV1::default() {
            return Ok(());
        }
        let position_units = self.cached_position_units()?;
        if position_units == 0 {
            return Ok(());
        }
        let quantity = self.normalized_quantity(position_units.unsigned_abs())?;
        let trigger_price = self.protection_trigger_price()?;

        if let Some(client_order_id) = self.protection_order {
            let (current_quantity, current_trigger) = {
                let cache = self.cache();
                let order = cache.try_order(&client_order_id)?;
                (order.quantity(), order.trigger_price())
            };
            let quantity_change = (current_quantity != quantity).then_some(quantity);
            let trigger_change = (current_trigger != Some(trigger_price)).then_some(trigger_price);
            if quantity_change.is_some() || trigger_change.is_some() {
                self.modify_order(
                    client_order_id,
                    quantity_change,
                    None,
                    trigger_change,
                    None,
                    None,
                )?;
            }
            return Ok(());
        }
        let side = if position_units > 0 {
            OrderSide::Sell
        } else {
            OrderSide::Buy
        };
        let position_id = self.single_open_position_id()?;
        let order = self.order().try_stop_market(
            self.instrument_id,
            side,
            quantity,
            trigger_price,
            Some(TriggerType::Default),
            Some(TimeInForce::Gtc),
            None,
            Some(true),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )?;
        let client_order_id = order.client_order_id();
        self.protection_order = Some(client_order_id);
        self.protection_orders.insert(client_order_id);
        self.submit_order(order, Some(position_id), None, None)
    }

    fn protection_trigger_price(&self) -> anyhow::Result<Price> {
        let ticks = self
            .desired_protection
            .trailing_stop_ticks
            .or(self.desired_protection.stop_loss_ticks)
            .context("Backtest V2 protection has no executable stop")?;
        let instrument = self.cache().try_instrument(&self.instrument_id)?;
        let precision = instrument.price_precision();
        let scale = 10_u64
            .checked_pow(u32::from(precision))
            .context("Backtest V2 price precision scale overflowed")?;
        instrument
            .try_normalize_price(Price::new_checked(ticks as f64 / scale as f64, precision)?)
            .map_err(anyhow::Error::from)
    }

    fn normalized_quantity(&self, units: u64) -> anyhow::Result<Quantity> {
        anyhow::ensure!(units > 0, "Backtest V2 native quantity is zero");
        self.cache()
            .try_instrument(&self.instrument_id)?
            .try_make_qty(units as f64, None)
    }

    fn single_open_position_id(&self) -> anyhow::Result<PositionId> {
        let strategy_id = self
            .strategy_id()
            .context("Backtest V2 strategy is unregistered")?;
        let cache = self.cache();
        let positions = cache.positions_open(
            None,
            Some(&self.instrument_id),
            Some(&strategy_id),
            None,
            None,
        );
        anyhow::ensure!(
            positions.len() == 1,
            "Backtest V2 reduce-only effect requires one open net position"
        );
        Ok(positions[0].id)
    }

    fn cached_position_units(&self) -> anyhow::Result<i64> {
        let strategy_id = self
            .strategy_id()
            .context("Backtest V2 strategy is unregistered")?;
        let total = self
            .cache()
            .positions_open(
                None,
                Some(&self.instrument_id),
                Some(&strategy_id),
                None,
                None,
            )
            .iter()
            .map(|position| position.signed_qty)
            .sum::<f64>();
        anyhow::ensure!(
            total.is_finite() && total.fract() == 0.0,
            "Backtest V2 cache position is not an exact unit count"
        );
        Ok(total as i64)
    }

    fn finish_callback(&self, result: anyhow::Result<()>) -> anyhow::Result<()> {
        if let Err(e) = &result {
            self.trace
                .borrow_mut()
                .callback_failure
                .get_or_insert_with(|| format!("{e:#}"));
        }
        result
    }
}

fn raw_to_i128<T: Into<i128>>(raw: T) -> i128 {
    raw.into()
}

vibe_strategy!(BacktestProgramHostStrategyV2, {
    fn on_order_event(&mut self, event: OrderEventAny) {
        if self.trace.borrow().callback_failure.is_none() {
            let result = self.on_order_event_checked(&event);
            let _ = self.finish_callback(result);
        }
    }
});

impl Debug for BacktestProgramHostStrategyV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("BacktestProgramHostStrategyV2")
    }
}

impl DataActor for BacktestProgramHostStrategyV2 {
    fn on_start(&mut self) -> anyhow::Result<()> {
        let result = self.on_start_checked();
        self.finish_callback(result)
    }

    fn on_bar(&mut self, bar: &Bar) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.trace.borrow().callback_failure.is_none(),
            "Backtest V2 program host is faulted"
        );
        let result = self.on_bar_checked(bar);
        self.finish_callback(result)
    }

    fn on_stop(&mut self) -> anyhow::Result<()> {
        let result = (|| {
            self.unsubscribe_bars(self.bar_type, None, None);
            anyhow::ensure!(
                self.bar_events.is_empty(),
                "Backtest V2 BAR frames were not exhausted"
            );
            anyhow::ensure!(
                self.pending_fills.is_empty(),
                "Backtest V2 native fills remain buffered"
            );
            let now = self.clock().timestamp_ns().as_u64();
            let envelope = lifecycle_envelope(
                now,
                now,
                LifecycleKind::Stop,
                u64::MAX,
                stable_identity(
                    b"strategy.backtest-v2.stop\0",
                    &[self.host.host_identity().as_bytes()],
                ),
                EnvelopePayloadV1::Stop,
            )?;
            let event = admit_backtest_lifecycle_event_v2(&self.plan, envelope)?;
            self.apply_host_event(&event)?;
            Ok(())
        })();
        self.finish_callback(result)
    }
}

fn protection_action(
    before: ProtectionStateV1,
    after: ProtectionStateV1,
    trace: SemanticTraceV1,
) -> ProtectionActionV2 {
    if before == after || trace.protection_semantics.bits() == 0 {
        ProtectionActionV2::Keep
    } else if after == ProtectionStateV1::default() {
        ProtectionActionV2::Clear
    } else if before == ProtectionStateV1::default()
        || before.stop_loss_ticks != after.stop_loss_ticks
        || before.take_profit_ticks != after.take_profit_ticks
        || before.trailing_distance_ticks != after.trailing_distance_ticks
    {
        ProtectionActionV2::Replace
    } else {
        ProtectionActionV2::Adjust
    }
}

fn exact_units(quantity: Quantity) -> anyhow::Result<u64> {
    let value = quantity.as_f64();
    anyhow::ensure!(
        value.is_finite() && value >= 0.0 && value.fract() == 0.0,
        "Backtest V2 quantity is not an exact nonnegative unit count"
    );
    Ok(value as u64)
}

fn lifecycle_envelope(
    logical_time_ns: u64,
    event_time_ns: u64,
    kind: LifecycleKind,
    owner_sequence: u64,
    event_identity: [u8; 16],
    payload: EnvelopePayloadV1,
) -> anyhow::Result<LifecycleEnvelopeV1> {
    let order_key = EventOrderKeyV1::new(
        logical_time_ns,
        event_time_ns,
        kind,
        owner_sequence,
        event_identity,
    )
    .map_err(|e| anyhow::anyhow!("lifecycle order key rejected: {e:?}"))?;
    LifecycleEnvelopeV1::new_bound(order_key, payload)
        .map_err(|e| anyhow::anyhow!("lifecycle envelope rejected: {e:?}"))
}

fn stable_identity(domain: &[u8], parts: &[&[u8]]) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    for part in parts {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    hasher.finalize()[..16]
        .try_into()
        .expect("SHA-256 prefix has fixed length")
}

const fn lifecycle_name(kind: LifecycleKind) -> &'static str {
    match kind {
        LifecycleKind::Start => "START",
        LifecycleKind::Bar => "BAR",
        LifecycleKind::Event => "EVENT",
        LifecycleKind::Fill => "FILL",
        LifecycleKind::Timer => "TIMER",
        LifecycleKind::Stop => "STOP",
    }
}

const fn position_intent_name(intent: PositionIntentV1) -> &'static str {
    match intent {
        PositionIntentV1::Hold => "HOLD",
        PositionIntentV1::Enter => "ENTER",
        PositionIntentV1::Add => "ADD",
        PositionIntentV1::Reduce => "REDUCE",
        PositionIntentV1::Exit => "EXIT",
    }
}

const fn protection_action_name(action: ProtectionActionV2) -> &'static str {
    match action {
        ProtectionActionV2::Keep => "KEEP",
        ProtectionActionV2::Replace => "REPLACE",
        ProtectionActionV2::Adjust => "ADJUST",
        ProtectionActionV2::Clear => "CLEAR",
    }
}

const fn order_event_name(event: &OrderEventAny) -> &'static str {
    match event {
        OrderEventAny::Initialized(_) => "INITIALIZED",
        OrderEventAny::Denied(_) => "DENIED",
        OrderEventAny::Emulated(_) => "EMULATED",
        OrderEventAny::Released(_) => "RELEASED",
        OrderEventAny::Submitted(_) => "SUBMITTED",
        OrderEventAny::Accepted(_) => "ACCEPTED",
        OrderEventAny::Rejected(_) => "REJECTED",
        OrderEventAny::Canceled(_) => "CANCELED",
        OrderEventAny::Expired(_) => "EXPIRED",
        OrderEventAny::Triggered(_) => "TRIGGERED",
        OrderEventAny::PendingUpdate(_) => "PENDING_UPDATE",
        OrderEventAny::PendingCancel(_) => "PENDING_CANCEL",
        OrderEventAny::ModifyRejected(_) => "MODIFY_REJECTED",
        OrderEventAny::CancelRejected(_) => "CANCEL_REJECTED",
        OrderEventAny::Updated(_) => "UPDATED",
        OrderEventAny::Filled(_) => "FILLED",
        OrderEventAny::FillVoided(_) => "FILL_VOIDED",
    }
}
