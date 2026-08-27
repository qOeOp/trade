//! Exactly-two-member `ProgramHostV2` composition into the real Backtest engine.
//!
//! This adapter reads one in-process Backtest account/instrument snapshot, performs exact Decimal
//! target conversion, constructs both native orders, and only then commits the prepared Host
//! scratch state. Sim Exchange submission and fills remain sequential venue effects.

use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet},
    fmt::Debug,
    rc::Rc,
};

use anyhow::Context;
use rust_decimal::{Decimal, prelude::ToPrimitive};
use serde::Serialize;
use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::{
    lifecycle_v1::{
        EnvelopePayloadV1, EventOrderKeyV1, FillDispositionV1, FillEventV1, FillSideV1,
        LifecycleEnvelopeV1, LifecycleKind, PositionIntentV1, ProtectionStateV1, SemanticTraceV1,
        TargetProposalV1,
    },
    lifecycle_v2::{InstrumentTargetSetV2, TARGET_SET_MEMBER_COUNT},
};
use vibe_common::actor::DataActor;
use vibe_data::owner::{
    source_binding::BindingDigest,
    strategy_input_binding::{StrategyInputEventKind, StrategyInputUniverseFrameReceipt},
};
use vibe_model::{
    accounts::Account,
    data::{Bar, BarType},
    enums::{AccountType, OmsType, OrderSide, OrderStatus, PositionSide, TimeInForce, TriggerType},
    events::OrderEventAny,
    identifiers::{AccountId, ClientOrderId, InstrumentId, PositionId, StrategyId},
    instruments::{Instrument, InstrumentAny},
    orders::{Order, OrderAny},
    types::{Money, Price, Quantity},
};
use vibe_trading::{
    strategy::{Strategy, StrategyConfig, StrategyCore},
    vibe_strategy,
};

#[cfg(test)]
use crate::program_host_v2::AdmittedProgramEventV2;
use crate::{
    artifact_v2::StrategyArtifactV2,
    program_host_v2::{
        PreparedBacktestTargetSetV2, ProgramHostV2, ProgramHostV2Error,
        admit_backtest_lifecycle_event_v2, admit_market_data_universe_program_event_v2,
    },
    strategy_plan_v2::StrategyPlanV2,
};

const RECONCILIATION_SNAPSHOT_DOMAIN: &[u8] = b"strategy.backtest.target-set.snapshot.v2\0";
const RECONCILIATION_CAPABILITY_DOMAIN: &[u8] =
    b"strategy.backtest.target-set.reconciliation-capability.v2\0";
const WEIGHT_FORMULA_V2: &[u8] =
    b"trunc_toward_zero(equity*weight_micros/1000000/price/multiplier/size_increment)";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct TargetSetBacktestTransitionV2 {
    pub(crate) instrument: String,
    pub(crate) lifecycle: String,
    pub(crate) position_intent: String,
    pub(crate) position_before_grid_units: i64,
    pub(crate) position_after_grid_units: i64,
    pub(crate) residual_grid_units: i64,
    pub(crate) checkpoint_before: [u8; 32],
    pub(crate) checkpoint_after: [u8; 32],
    pub(crate) trace: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct TargetSetNativeOrderObservationV2 {
    pub(crate) client_order_id: String,
    pub(crate) instrument: String,
    pub(crate) intent_identity: [u8; 16],
    pub(crate) event: String,
    pub(crate) status: String,
    pub(crate) filled_native_quantity: String,
    pub(crate) cached_position_native_quantity: String,
    pub(crate) protection_order: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct TargetSetEquitySnapshotObservationV2 {
    pub(crate) account_id: String,
    pub(crate) currency: String,
    pub(crate) equity: String,
    pub(crate) current_grid_units: [i64; TARGET_SET_MEMBER_COUNT],
    pub(crate) derived_grid_targets: [i64; TARGET_SET_MEMBER_COUNT],
    pub(crate) snapshot_identity: [u8; 32],
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub(crate) struct TargetSetBacktestTraceV2 {
    pub(crate) callback_failure: Option<String>,
    pub(crate) batch_checkpoint_before: Option<[u8; 32]>,
    pub(crate) failure_checkpoint_after: Option<[u8; 32]>,
    pub(crate) position_submit_attempts: u64,
    pub(crate) successful_position_submits: Vec<String>,
    pub(crate) host_transitions: Vec<TargetSetBacktestTransitionV2>,
    pub(crate) native_order_observations: Vec<TargetSetNativeOrderObservationV2>,
    pub(crate) equity_snapshots: Vec<TargetSetEquitySnapshotObservationV2>,
    pub(crate) canonical_target_sets: Vec<Vec<u8>>,
    pub(crate) venue_atomicity_claimed: bool,
    pub(crate) cold_restart_claimed: bool,
}

#[derive(Clone, Copy, Debug)]
struct NativeOrderBindingV2 {
    member_ordinal: usize,
    instrument_id: InstrumentId,
    intent_identity: [u8; 16],
}

#[derive(Clone, Debug, Default)]
struct MemberExecutionStateV2 {
    desired_protection: ProtectionStateV1,
    desired_grid_target: Option<i64>,
    active_protection_order: Option<ClientOrderId>,
    protection_orders: BTreeSet<ClientOrderId>,
}

struct BatchSnapshotV2 {
    account_id: AccountId,
    equity: Money,
    instruments: [InstrumentAny; TARGET_SET_MEMBER_COUNT],
    prices: [Price; TARGET_SET_MEMBER_COUNT],
    current_grid_units: [i64; TARGET_SET_MEMBER_COUNT],
}

pub(crate) struct BacktestReconciliationCapabilityV2 {
    host_instance_token: Rc<()>,
    prepared_identity: BindingDigest,
    target_set: strategy_factory_program_sdk::lifecycle_v2::InstrumentTargetSetV2,
    snapshot_identity: BindingDigest,
    derived_grid_targets: [i64; TARGET_SET_MEMBER_COUNT],
    binding_identity: BindingDigest,
}

impl BacktestReconciliationCapabilityV2 {
    pub(crate) fn verify_for(
        self,
        prepared_identity: BindingDigest,
        host_instance_token: &Rc<()>,
        target_set: strategy_factory_program_sdk::lifecycle_v2::InstrumentTargetSetV2,
    ) -> Result<[i64; TARGET_SET_MEMBER_COUNT], ProgramHostV2Error> {
        if !Rc::ptr_eq(&self.host_instance_token, host_instance_token)
            || self.prepared_identity != prepared_identity
            || self.target_set != target_set
            || self.binding_identity
                != reconciliation_capability_identity(
                    self.prepared_identity,
                    self.snapshot_identity,
                    self.target_set,
                    self.derived_grid_targets,
                )?
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        Ok(self.derived_grid_targets)
    }
}

enum BacktestUniverseFrameV2 {
    Owner(StrategyInputUniverseFrameReceipt),
    #[cfg(test)]
    Admitted(AdmittedProgramEventV2),
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum BacktestTargetSetFaultHookV2 {
    #[default]
    None,
    #[cfg(test)]
    FailBeforeSecondSubmit,
}

struct PreparedNativeOrderV2 {
    member_ordinal: usize,
    order: OrderAny,
    position_id: Option<PositionId>,
    intent_identity: [u8; 16],
}

pub(crate) struct BacktestTargetSetProgramHostStrategyV2 {
    core: StrategyCore,
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    host: ProgramHostV2,
    instrument_ids: [InstrumentId; TARGET_SET_MEMBER_COUNT],
    bar_types: [BarType; TARGET_SET_MEMBER_COUNT],
    universe_frames: BTreeMap<u64, BacktestUniverseFrameV2>,
    pending_bars: BTreeMap<u64, [Option<Bar>; TARGET_SET_MEMBER_COUNT]>,
    position_orders: BTreeMap<ClientOrderId, NativeOrderBindingV2>,
    members: [MemberExecutionStateV2; TARGET_SET_MEMBER_COUNT],
    owner_sequence: u64,
    fault_hook: BacktestTargetSetFaultHookV2,
    restore_after_first_terminal_fill: bool,
    restore_performed: Rc<Cell<bool>>,
    trace: Rc<RefCell<TargetSetBacktestTraceV2>>,
}

impl BacktestTargetSetProgramHostStrategyV2 {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        strategy_id: StrategyId,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        instrument_ids: [InstrumentId; TARGET_SET_MEMBER_COUNT],
        bar_types: [BarType; TARGET_SET_MEMBER_COUNT],
        universe_frames: impl IntoIterator<Item = StrategyInputUniverseFrameReceipt>,
        restore_after_first_terminal_fill: bool,
        restore_performed: Rc<Cell<bool>>,
        trace: Rc<RefCell<TargetSetBacktestTraceV2>>,
    ) -> anyhow::Result<Self> {
        anyhow::ensure!(
            instrument_ids[0] < instrument_ids[1]
                && bar_types[0].instrument_id() == instrument_ids[0]
                && bar_types[1].instrument_id() == instrument_ids[1],
            "Backtest target-set members must be distinct and canonical"
        );
        let host = ProgramHostV2::new(plan.clone(), artifact.clone())?;
        let mut frames = BTreeMap::new();

        for frame in universe_frames {
            let lifecycle = frame.trigger().lifecycle();
            anyhow::ensure!(
                matches!(lifecycle.kind(), StrategyInputEventKind::Bar)
                    && frames
                        .insert(
                            lifecycle.logical_time(),
                            BacktestUniverseFrameV2::Owner(frame)
                        )
                        .is_none(),
                "Backtest target-set frames must be unique BAR frames"
            );
        }
        anyhow::ensure!(
            !frames.is_empty(),
            "Backtest target-set corpus has no frames"
        );
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
            instrument_ids,
            bar_types,
            universe_frames: frames,
            pending_bars: BTreeMap::new(),
            position_orders: BTreeMap::new(),
            members: std::array::from_fn(|_| MemberExecutionStateV2::default()),
            owner_sequence: 20_000,
            fault_hook: BacktestTargetSetFaultHookV2::None,
            restore_after_first_terminal_fill,
            restore_performed,
            trace,
        })
    }

    #[cfg(test)]
    pub(crate) fn add_admitted_frame_for_test(
        &mut self,
        event: AdmittedProgramEventV2,
    ) -> anyhow::Result<()> {
        let envelope = event.envelope();
        anyhow::ensure!(
            envelope.order_key.kind == LifecycleKind::Bar
                && self
                    .universe_frames
                    .insert(
                        envelope.order_key.logical_time_ns,
                        BacktestUniverseFrameV2::Admitted(event),
                    )
                    .is_none(),
            "test Backtest target-set frame is invalid or duplicated"
        );
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn fail_before_second_submit_for_test(&mut self) {
        self.fault_hook = BacktestTargetSetFaultHookV2::FailBeforeSecondSubmit;
    }

    fn on_start_checked(&mut self) -> anyhow::Result<()> {
        for instrument_id in self.instrument_ids {
            self.cache().try_instrument(&instrument_id)?;
        }
        let envelope = lifecycle_envelope(
            1,
            1,
            LifecycleKind::Start,
            1,
            stable_identity(
                b"strategy.backtest-target-set-v2.start\0",
                &[self.host.host_identity().as_bytes()],
            ),
            EnvelopePayloadV1::Start,
        )?;
        let event = admit_backtest_lifecycle_event_v2(&self.plan, envelope)?;
        self.host.apply_event(&event)?;

        for bar_type in self.bar_types {
            self.subscribe_bars(bar_type, None, None);
        }
        Ok(())
    }

    fn on_bar_checked(&mut self, bar: &Bar) -> anyhow::Result<()> {
        let ordinal = self
            .bar_types
            .iter()
            .position(|bar_type| *bar_type == bar.bar_type)
            .context("unbound Backtest target-set BarType")?;
        let time = bar.ts_init.as_u64();
        let bars = self.pending_bars.entry(time).or_insert([None, None]);
        anyhow::ensure!(
            bars[ordinal].replace(*bar).is_none(),
            "duplicate member BAR"
        );

        if bars.iter().any(Option::is_none) {
            return Ok(());
        }
        let bars = self
            .pending_bars
            .remove(&time)
            .context("complete member BAR batch disappeared")?
            .map(|bar| bar.expect("complete batch checked"));
        let frame = self
            .universe_frames
            .remove(&time)
            .context("missing Owner-sealed target-set frame")?;
        self.apply_complete_frame(&frame, bars)
    }

    fn apply_complete_frame(
        &mut self,
        frame: &BacktestUniverseFrameV2,
        bars: [Bar; TARGET_SET_MEMBER_COUNT],
    ) -> anyhow::Result<()> {
        let admitted = match frame {
            BacktestUniverseFrameV2::Owner(frame) => {
                admit_market_data_universe_program_event_v2(&self.plan, frame)?
            }
            #[cfg(test)]
            BacktestUniverseFrameV2::Admitted(event) => event.clone(),
        };

        for (ordinal, bar) in bars.iter().enumerate() {
            let (open, open_scale) = admitted
                .fixed_i128_member_input_scaled("research.input.open.v1", ordinal as u8)
                .context("Owner-sealed member OPEN is unavailable")?;
            let (close, close_scale) = admitted
                .fixed_i128_member_input_scaled("research.input.close.v1", ordinal as u8)
                .context("Owner-sealed member CLOSE is unavailable")?;
            anyhow::ensure!(
                Decimal::from_i128_with_scale(open, u32::from(open_scale)) == bar.open.as_decimal()
                    && Decimal::from_i128_with_scale(close, u32::from(close_scale))
                        == bar.close.as_decimal(),
                "Owner-sealed target-set BAR values do not match replay data"
            );
        }
        let checkpoint_before = self.host.checkpoint().digest();
        self.trace.borrow_mut().batch_checkpoint_before = Some(*checkpoint_before.as_bytes());
        let prepared = self
            .host
            .prepare_backtest_admitted_universe_event(&admitted)?;
        let target_set = prepared.canonical_target_set();
        let snapshot = self.capture_batch_snapshot(bars.map(|bar| bar.close), &prepared)?;
        let capability = snapshot.seal_reconciliation(&prepared, target_set)?;
        let grid_targets = capability.derived_grid_targets;
        self.trace
            .borrow_mut()
            .equity_snapshots
            .push(TargetSetEquitySnapshotObservationV2 {
                account_id: snapshot.account_id.to_string(),
                currency: snapshot.equity.currency.to_string(),
                equity: snapshot.equity.to_string(),
                current_grid_units: snapshot.current_grid_units,
                derived_grid_targets: grid_targets,
                snapshot_identity: *capability.snapshot_identity.as_bytes(),
            });
        let prepared = prepared.reconcile_backtest_capability(capability)?;
        let traces = prepared
            .member_traces()
            .context("reconciled target set omitted member traces")?;
        let orders = self.prepare_native_orders(&snapshot, &prepared, traces)?;
        self.validate_native_order_bindings(&prepared, &orders)?;
        let residuals = try_map_pair(|ordinal| {
            grid_targets[ordinal]
                .checked_sub(traces[ordinal].position_after_units)
                .context("target-set residual overflow")
        })?;
        let encoded_target_set = target_set
            .encode()
            .map_err(|e| anyhow::anyhow!("target-set encoding failed: {e:?}"))?
            .to_vec();
        let traces = self.host.commit_prepared_backtest_target_set(prepared)?;
        let checkpoint_after = self.host.checkpoint().digest();
        self.trace
            .borrow_mut()
            .canonical_target_sets
            .push(encoded_target_set);

        for (ordinal, trace) in traces.into_iter().enumerate() {
            self.trace
                .borrow_mut()
                .host_transitions
                .push(TargetSetBacktestTransitionV2 {
                    instrument: self.instrument_ids[ordinal].to_string(),
                    lifecycle: "BAR".to_owned(),
                    position_intent: position_intent_name(trace.position_intent).to_owned(),
                    position_before_grid_units: trace.position_before_units,
                    position_after_grid_units: trace.position_after_units,
                    residual_grid_units: residuals[ordinal],
                    checkpoint_before: *checkpoint_before.as_bytes(),
                    checkpoint_after: *checkpoint_after.as_bytes(),
                    trace: trace.encode().to_vec(),
                });
            self.members[ordinal].desired_grid_target = Some(grid_targets[ordinal]);
            self.apply_desired_protection(ordinal, trace.protection)?;
        }

        for prepared_order in orders.into_iter().flatten() {
            let client_order_id = prepared_order.order.client_order_id();
            let binding = NativeOrderBindingV2 {
                member_ordinal: prepared_order.member_ordinal,
                instrument_id: self.instrument_ids[prepared_order.member_ordinal],
                intent_identity: prepared_order.intent_identity,
            };
            let replaced = self.position_orders.insert(client_order_id, binding);
            debug_assert!(
                replaced.is_none(),
                "native order bindings were prevalidated"
            );
            // Venue submission is intentionally sequential. A later failure faults the run and
            // preserves the earlier native effect plus all in-process replay evidence.
            #[cfg(test)]
            if self.fault_hook == BacktestTargetSetFaultHookV2::FailBeforeSecondSubmit
                && self.trace.borrow().successful_position_submits.len() == 1
            {
                anyhow::bail!("test-only fault at the second native submit boundary");
            }
            self.trace.borrow_mut().position_submit_attempts += 1;
            self.submit_order(prepared_order.order, prepared_order.position_id, None, None)?;
            self.trace
                .borrow_mut()
                .successful_position_submits
                .push(client_order_id.to_string());
        }
        Ok(())
    }

    fn capture_batch_snapshot(
        &self,
        prices: [Price; TARGET_SET_MEMBER_COUNT],
        prepared: &PreparedBacktestTargetSetV2,
    ) -> anyhow::Result<BatchSnapshotV2> {
        let instruments = try_map_pair(|ordinal| {
            self.cache()
                .try_instrument(&self.instrument_ids[ordinal])
                .map_err(anyhow::Error::from)
        })?;
        let currency = instruments[0].quote_currency();
        anyhow::ensure!(
            instruments.iter().all(|instrument| {
                !instrument.is_inverse()
                    && !instrument.is_quanto()
                    && instrument.quote_currency() == currency
                    && instrument.settlement_currency() == currency
                    && instrument.multiplier().is_positive()
                    && instrument.size_increment().is_positive()
            }),
            "Backtest target-set requires linear exact quote-currency instruments"
        );

        for (ordinal, instrument) in instruments.iter().enumerate() {
            anyhow::ensure!(
                instrument.id() == self.instrument_ids[ordinal]
                    && prepared
                        .member_checkpoint(ordinal)
                        .is_some_and(|(key, _)| key == instrument.id().to_string())
                    && prices[ordinal].is_positive()
                    && instrument.try_normalize_price(prices[ordinal])? == prices[ordinal],
                "Backtest target-set instrument fact mismatch"
            );
        }
        anyhow::ensure!(
            self.instrument_ids[0].venue == self.instrument_ids[1].venue,
            "Backtest target-set requires one venue account snapshot"
        );
        let venue = self.instrument_ids[0].venue;
        let accounts = self
            .cache()
            .accounts_all()
            .into_iter()
            .filter(|account| account.id().get_issuer() == venue)
            .collect::<Vec<_>>();
        anyhow::ensure!(
            accounts.len() == 1 && accounts[0].account_type() == AccountType::Margin,
            "Backtest target-set requires one unambiguous venue account"
        );
        let account_id = accounts[0].id();
        anyhow::ensure!(
            self.cache().account_id(&venue) == Some(account_id),
            "Backtest target-set venue account binding is ambiguous"
        );
        let portfolio = self.portfolio();
        let equities = portfolio.equity(&venue, Some(&account_id));
        let missing_prices = portfolio.missing_price_instruments(&venue);
        anyhow::ensure!(
            missing_prices.is_empty(),
            "Backtest target-set portfolio equity contains an unpriced position"
        );
        anyhow::ensure!(
            equities.len() == 1 && equities.contains_key(&currency),
            "Backtest target-set quote-currency equity is unavailable or ambiguous"
        );
        let equity = equities[&currency];
        anyhow::ensure!(
            equity.currency == currency && equity.as_decimal() > Decimal::ZERO,
            "Backtest target-set equity is invalid"
        );
        let current_grid_units = try_map_pair(|ordinal| {
            let units = self.cached_position_grid_units(ordinal, &instruments[ordinal])?;
            anyhow::ensure!(
                prepared
                    .member_checkpoint(ordinal)
                    .is_some_and(|(_, checkpoint)| checkpoint.reconciled_position_units == units),
                "Backtest target-set member reconciliation mismatch"
            );
            Ok::<_, anyhow::Error>(units)
        })?;
        Ok(BatchSnapshotV2 {
            account_id,
            equity,
            instruments,
            prices,
            current_grid_units,
        })
    }

    fn prepare_native_orders(
        &self,
        snapshot: &BatchSnapshotV2,
        prepared: &PreparedBacktestTargetSetV2,
        traces: [SemanticTraceV1; TARGET_SET_MEMBER_COUNT],
    ) -> anyhow::Result<[Option<PreparedNativeOrderV2>; TARGET_SET_MEMBER_COUNT]> {
        try_map_pair(|ordinal| {
            let (_, checkpoint) = prepared
                .member_checkpoint(ordinal)
                .context("prepared member checkpoint unavailable")?;
            let Some(pending) = checkpoint.pending_intent else {
                anyhow::ensure!(
                    traces[ordinal].position_intent == PositionIntentV1::Hold,
                    "non-HOLD member omitted pending intent"
                );
                return Ok(None);
            };
            let signed_delta = i64::try_from(pending.expected_units)
                .context("native member delta exceeds i64")?
                * i64::from(pending.side as i8);
            anyhow::ensure!(
                snapshot.current_grid_units[ordinal]
                    .checked_add(signed_delta)
                    .is_some(),
                "native member target overflows"
            );
            let instrument = &snapshot.instruments[ordinal];
            let native = Decimal::from(pending.expected_units)
                .checked_mul(instrument.size_increment().as_decimal())
                .context("native member quantity overflow")?;
            let quantity = Quantity::from_decimal_dp(native, instrument.size_precision())?;
            let quantity = instrument.try_normalize_qty(quantity)?;
            anyhow::ensure!(
                quantity.as_decimal() == native && quantity.is_positive(),
                "native member quantity was not exact"
            );
            anyhow::ensure!(
                instrument
                    .min_quantity()
                    .is_none_or(|minimum| quantity >= minimum)
                    && instrument
                        .max_quantity()
                        .is_none_or(|maximum| quantity <= maximum)
                    && instrument
                        .min_price()
                        .is_none_or(|minimum| snapshot.prices[ordinal] >= minimum)
                    && instrument
                        .max_price()
                        .is_none_or(|maximum| snapshot.prices[ordinal] <= maximum),
                "native member order violates exact instrument limits"
            );
            let side = if pending.side == FillSideV1::Buy {
                OrderSide::Buy
            } else {
                OrderSide::Sell
            };
            let reduce_only = matches!(
                traces[ordinal].position_intent,
                PositionIntentV1::Reduce | PositionIntentV1::Exit
            );
            let position_id = reduce_only
                .then(|| self.single_open_position_id(ordinal))
                .transpose()?;
            let order = self.order().try_limit(
                self.instrument_ids[ordinal],
                side,
                quantity,
                snapshot.prices[ordinal],
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
            Ok(Some(PreparedNativeOrderV2 {
                member_ordinal: ordinal,
                order,
                position_id,
                intent_identity: pending.intent_identity,
            }))
        })
    }

    fn validate_native_order_bindings(
        &self,
        prepared: &PreparedBacktestTargetSetV2,
        orders: &[Option<PreparedNativeOrderV2>; TARGET_SET_MEMBER_COUNT],
    ) -> anyhow::Result<()> {
        let mut client_order_ids = BTreeSet::new();

        for (ordinal, prepared_order) in orders.iter().enumerate() {
            let (_, checkpoint) = prepared
                .member_checkpoint(ordinal)
                .context("prepared member checkpoint unavailable")?;
            match (prepared_order, checkpoint.pending_intent) {
                (None, None) => {}
                (Some(order), Some(pending)) => {
                    anyhow::ensure!(
                        order.member_ordinal == ordinal
                            && order.order.instrument_id() == self.instrument_ids[ordinal]
                            && order.intent_identity == pending.intent_identity
                            && !self
                                .position_orders
                                .contains_key(&order.order.client_order_id())
                            && client_order_ids.insert(order.order.client_order_id()),
                        "Backtest target-set native order binding mismatch"
                    );
                }
                _ => anyhow::bail!("Backtest target-set native order coverage mismatch"),
            }
        }
        Ok(())
    }

    fn on_order_event_checked(&mut self, event: &OrderEventAny) -> anyhow::Result<()> {
        let client_order_id = event.client_order_id();
        let binding = self.position_orders.get(&client_order_id).copied();
        let protection_ordinal = self
            .members
            .iter()
            .position(|member| member.protection_orders.contains(&client_order_id));
        let ordinal = binding
            .map(|binding| binding.member_ordinal)
            .or(protection_ordinal)
            .context("unknown Backtest target-set ClientOrderId")?;
        anyhow::ensure!(
            event.instrument_id() == self.instrument_ids[ordinal]
                && binding.is_none_or(|binding| {
                    binding.instrument_id == event.instrument_id()
                        && binding.member_ordinal == ordinal
                }),
            "cross-member Backtest target-set order event"
        );
        let (status, filled_quantity) = {
            let cache = self.cache();
            let order = cache.try_order(&client_order_id)?;
            (order.status(), order.filled_qty())
        };
        self.trace
            .borrow_mut()
            .native_order_observations
            .push(TargetSetNativeOrderObservationV2 {
                client_order_id: client_order_id.to_string(),
                instrument: self.instrument_ids[ordinal].to_string(),
                intent_identity: binding.map_or([0; 16], |value| value.intent_identity),
                event: order_event_name(event).to_owned(),
                status: status.to_string(),
                filled_native_quantity: filled_quantity.to_string(),
                cached_position_native_quantity: self
                    .cached_position_native_quantity(ordinal)?
                    .to_string(),
                protection_order: protection_ordinal.is_some(),
            });

        if protection_ordinal.is_some() {
            return Ok(());
        }
        let binding = binding.context("position event omitted exact order binding")?;
        let disposition = match (event, status) {
            (OrderEventAny::Filled(_), OrderStatus::PartiallyFilled) => {
                Some(FillDispositionV1::PartiallyFilled)
            }
            (OrderEventAny::Filled(_), OrderStatus::Filled) => Some(FillDispositionV1::Filled),
            (OrderEventAny::Rejected(_), _) => Some(FillDispositionV1::Rejected),
            (OrderEventAny::Canceled(_) | OrderEventAny::Expired(_), _) => {
                Some(FillDispositionV1::Canceled)
            }
            _ => None,
        };

        if let Some(disposition) = disposition {
            self.consume_native_order_progress(binding, event.ts_event().as_u64(), disposition)?;
        }
        Ok(())
    }

    fn consume_native_order_progress(
        &mut self,
        binding: NativeOrderBindingV2,
        time_ns: u64,
        disposition: FillDispositionV1,
    ) -> anyhow::Result<()> {
        self.owner_sequence = self
            .owner_sequence
            .checked_add(1)
            .context("Backtest target-set owner sequence exhausted")?;
        let instrument = self.cache().try_instrument(&binding.instrument_id)?;
        let native_filled = {
            let cache = self.cache();
            let order = cache
                .orders(None, Some(&binding.instrument_id), None, None, None)
                .into_iter()
                .find(|order| {
                    self.position_orders
                        .get(&order.client_order_id())
                        .is_some_and(|candidate| {
                            candidate.intent_identity == binding.intent_identity
                        })
                })
                .context("bound native order disappeared")?;
            order.filled_qty()
        };
        let cumulative = exact_grid_units(native_filled, instrument.size_increment())?;
        let side = self
            .host
            .member_checkpoints_for_backtest()
            .get(binding.member_ordinal)
            .and_then(|(_, checkpoint)| checkpoint.pending_intent)
            .context("bound member has no pending intent")?
            .side;
        let envelope = lifecycle_envelope(
            time_ns,
            time_ns,
            LifecycleKind::Fill,
            self.owner_sequence,
            stable_identity(
                b"strategy.backtest-target-set-v2.fill\0",
                &[
                    binding.instrument_id.to_string().as_bytes(),
                    &binding.intent_identity,
                    &cumulative.to_le_bytes(),
                    &self.owner_sequence.to_le_bytes(),
                ],
            ),
            EnvelopePayloadV1::Fill(FillEventV1 {
                intent_identity: binding.intent_identity,
                side,
                disposition,
                cumulative_filled_units: cumulative,
            }),
        )?;
        let event = admit_backtest_lifecycle_event_v2(&self.plan, envelope)?;
        let checkpoint_before = self.host.checkpoint().digest();
        let trace = self
            .host
            .apply_backtest_member_fill_event(&binding.instrument_id.to_string(), &event)?;
        let checkpoint_after = self.host.checkpoint().digest();
        let target = self.members[binding.member_ordinal]
            .desired_grid_target
            .context("member fill omitted its converted target")?;
        self.trace
            .borrow_mut()
            .host_transitions
            .push(TargetSetBacktestTransitionV2 {
                instrument: binding.instrument_id.to_string(),
                lifecycle: "FILL".to_owned(),
                position_intent: position_intent_name(trace.position_intent).to_owned(),
                position_before_grid_units: trace.position_before_units,
                position_after_grid_units: trace.position_after_units,
                residual_grid_units: target
                    .checked_sub(trace.position_after_units)
                    .context("member fill residual overflow")?,
                checkpoint_before: *checkpoint_before.as_bytes(),
                checkpoint_after: *checkpoint_after.as_bytes(),
                trace: trace.encode().to_vec(),
            });
        self.maybe_restore_host(disposition)?;
        self.sync_protection_order(binding.member_ordinal)?;
        Ok(())
    }

    fn maybe_restore_host(&mut self, disposition: FillDispositionV1) -> anyhow::Result<()> {
        if self.restore_after_first_terminal_fill
            && !self.restore_performed.get()
            && disposition == FillDispositionV1::Filled
        {
            let checkpoint = self.host.checkpoint().clone();
            self.host =
                ProgramHostV2::restore(self.plan.clone(), self.artifact.clone(), &checkpoint)?;
            anyhow::ensure!(
                self.host.checkpoint() == &checkpoint,
                "in-process target-set Host restore changed its opaque checkpoint"
            );
            self.restore_performed.set(true);
        }
        Ok(())
    }

    fn apply_desired_protection(
        &mut self,
        ordinal: usize,
        desired: ProtectionStateV1,
    ) -> anyhow::Result<()> {
        if desired == ProtectionStateV1::default() {
            self.members[ordinal].desired_protection = desired;
            if let Some(client_order_id) = self.members[ordinal].active_protection_order.take() {
                self.cancel_order(client_order_id, None, None)?;
            }
            return Ok(());
        }
        self.members[ordinal].desired_protection = desired;
        self.sync_protection_order(ordinal)
    }

    fn sync_protection_order(&mut self, ordinal: usize) -> anyhow::Result<()> {
        let desired = self.members[ordinal].desired_protection;
        if desired == ProtectionStateV1::default() {
            return Ok(());
        }
        let instrument = self.cache().try_instrument(&self.instrument_ids[ordinal])?;
        let signed_native = self.cached_position_native_quantity(ordinal)?;
        if signed_native.is_zero() {
            return Ok(());
        }
        let quantity = Quantity::from_decimal_dp(signed_native.abs(), instrument.size_precision())?;
        let quantity = instrument.try_normalize_qty(quantity)?;
        let trigger_price = protection_trigger_price(&instrument, desired)?;

        if let Some(client_order_id) = self.members[ordinal].active_protection_order {
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
        let side = if signed_native > Decimal::ZERO {
            OrderSide::Sell
        } else {
            OrderSide::Buy
        };
        let order = self.order().try_stop_market(
            self.instrument_ids[ordinal],
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
        self.members[ordinal].active_protection_order = Some(client_order_id);
        self.members[ordinal]
            .protection_orders
            .insert(client_order_id);
        self.submit_order(
            order,
            Some(self.single_open_position_id(ordinal)?),
            None,
            None,
        )
    }

    fn single_open_position_id(&self, ordinal: usize) -> anyhow::Result<PositionId> {
        let strategy_id = self
            .strategy_id()
            .context("Backtest target-set strategy is unregistered")?;
        let cache = self.cache();
        let positions = cache.positions_open(
            None,
            Some(&self.instrument_ids[ordinal]),
            Some(&strategy_id),
            None,
            None,
        );
        anyhow::ensure!(
            positions.len() == 1,
            "Backtest target-set member requires one open net position"
        );
        Ok(positions[0].id)
    }

    fn cached_position_native_quantity(&self, ordinal: usize) -> anyhow::Result<Decimal> {
        let strategy_id = self
            .strategy_id()
            .context("Backtest target-set strategy is unregistered")?;
        let cache = self.cache();
        let positions = cache.positions_open(
            None,
            Some(&self.instrument_ids[ordinal]),
            Some(&strategy_id),
            None,
            None,
        );
        anyhow::ensure!(positions.len() <= 1, "multiple native member positions");
        Ok(positions.first().map_or(Decimal::ZERO, |position| {
            let sign = match position.side {
                PositionSide::Long => Decimal::ONE,
                PositionSide::Short => -Decimal::ONE,
                PositionSide::Flat | PositionSide::NoPositionSide => Decimal::ZERO,
            };
            position.quantity.as_decimal() * sign
        }))
    }

    fn cached_position_grid_units(
        &self,
        ordinal: usize,
        instrument: &InstrumentAny,
    ) -> anyhow::Result<i64> {
        let native = self.cached_position_native_quantity(ordinal)?;
        let increment = instrument.size_increment().as_decimal();
        anyhow::ensure!(
            increment > Decimal::ZERO,
            "member size increment is invalid"
        );
        let grid = native
            .checked_div(increment)
            .context("member grid conversion overflow")?;
        anyhow::ensure!(grid == grid.trunc(), "native member position is off grid");
        grid.to_i64()
            .context("native member grid position exceeds i64")
    }

    fn finish_callback(&self, result: anyhow::Result<()>) -> anyhow::Result<()> {
        if let Err(e) = &result {
            let mut trace = self.trace.borrow_mut();
            trace
                .callback_failure
                .get_or_insert_with(|| format!("{e:#}"));
            trace
                .failure_checkpoint_after
                .get_or_insert(*self.host.checkpoint().digest().as_bytes());
        }
        result
    }
}

vibe_strategy!(BacktestTargetSetProgramHostStrategyV2, {
    fn on_order_event(&mut self, event: OrderEventAny) {
        if self.trace.borrow().callback_failure.is_none() {
            let result = self.on_order_event_checked(&event);
            let _ = self.finish_callback(result);
        }
    }
});

impl Debug for BacktestTargetSetProgramHostStrategyV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("BacktestTargetSetProgramHostStrategyV2")
    }
}

impl DataActor for BacktestTargetSetProgramHostStrategyV2 {
    fn on_start(&mut self) -> anyhow::Result<()> {
        let result = self.on_start_checked();
        self.finish_callback(result)
    }

    fn on_bar(&mut self, bar: &Bar) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.trace.borrow().callback_failure.is_none(),
            "Backtest target-set program host is faulted"
        );
        let result = self.on_bar_checked(bar);
        self.finish_callback(result)
    }

    fn on_stop(&mut self) -> anyhow::Result<()> {
        let result = (|| {
            for bar_type in self.bar_types {
                self.unsubscribe_bars(bar_type, None, None);
            }
            anyhow::ensure!(
                self.universe_frames.is_empty() && self.pending_bars.is_empty(),
                "Backtest target-set frames were not exhausted"
            );
            Ok(())
        })();
        self.finish_callback(result)
    }
}

fn convert_grid_target(
    target: TargetProposalV1,
    snapshot: &BatchSnapshotV2,
    ordinal: usize,
) -> anyhow::Result<i64> {
    let instrument = &snapshot.instruments[ordinal];
    match target {
        TargetProposalV1::Keep => Ok(snapshot.current_grid_units[ordinal]),
        TargetProposalV1::Position(units) | TargetProposalV1::RebalancePosition { units, .. } => {
            Ok(units)
        }
        TargetProposalV1::WeightMicros(weight_micros)
        | TargetProposalV1::RebalanceWeightMicros { weight_micros, .. } => {
            let numerator = snapshot
                .equity
                .as_decimal()
                .checked_mul(Decimal::from(weight_micros))
                .context("weight numerator overflow")?;
            let denominator = Decimal::from(1_000_000_i64)
                .checked_mul(snapshot.prices[ordinal].as_decimal())
                .and_then(|value| value.checked_mul(instrument.multiplier().as_decimal()))
                .and_then(|value| value.checked_mul(instrument.size_increment().as_decimal()))
                .context("weight denominator overflow")?;
            anyhow::ensure!(denominator > Decimal::ZERO, "weight denominator is invalid");
            numerator
                .checked_div(denominator)
                .context("weight conversion overflow")?
                .trunc()
                .to_i64()
                .context("weight grid target exceeds i64")
        }
    }
}

impl BatchSnapshotV2 {
    fn seal_reconciliation(
        &self,
        prepared: &PreparedBacktestTargetSetV2,
        target_set: InstrumentTargetSetV2,
    ) -> anyhow::Result<BacktestReconciliationCapabilityV2> {
        let derived_grid_targets = try_map_pair(|ordinal| {
            convert_grid_target(target_set.members[ordinal].target, self, ordinal)
        })?;
        let snapshot_identity = self.identity();
        let prepared_identity = prepared.prepared_identity();
        let binding_identity = reconciliation_capability_identity(
            prepared_identity,
            snapshot_identity,
            target_set,
            derived_grid_targets,
        )?;
        Ok(BacktestReconciliationCapabilityV2 {
            host_instance_token: prepared.host_instance_token(),
            prepared_identity,
            target_set,
            snapshot_identity,
            derived_grid_targets,
            binding_identity,
        })
    }

    fn identity(&self) -> BindingDigest {
        let mut hasher = Sha256::new();
        hasher.update(RECONCILIATION_SNAPSHOT_DOMAIN);
        hash_text(&mut hasher, self.account_id.as_ref());
        hash_text(&mut hasher, self.instruments[0].id().venue.as_ref());
        hasher.update(b"account-type.margin\0");
        hash_text(&mut hasher, &self.equity.currency.to_string());
        hash_text(&mut hasher, &self.equity.as_decimal().to_string());
        hasher.update(WEIGHT_FORMULA_V2);

        for ordinal in 0..TARGET_SET_MEMBER_COUNT {
            let instrument = &self.instruments[ordinal];
            hash_text(&mut hasher, &instrument.id().to_string());
            hash_text(&mut hasher, &instrument.quote_currency().to_string());
            hash_text(&mut hasher, &instrument.settlement_currency().to_string());
            hasher.update([u8::from(instrument.is_inverse())]);
            hasher.update([u8::from(instrument.is_quanto())]);
            hash_text(&mut hasher, &instrument.multiplier().to_string());
            hash_text(&mut hasher, &instrument.size_increment().to_string());
            hash_text(&mut hasher, &self.prices[ordinal].to_string());
            hasher.update(self.current_grid_units[ordinal].to_le_bytes());
        }
        BindingDigest::from_untrusted_bytes(hasher.finalize().into())
    }
}

fn reconciliation_capability_identity(
    prepared_identity: BindingDigest,
    snapshot_identity: BindingDigest,
    target_set: InstrumentTargetSetV2,
    derived_grid_targets: [i64; TARGET_SET_MEMBER_COUNT],
) -> Result<BindingDigest, ProgramHostV2Error> {
    let mut hasher = Sha256::new();
    hasher.update(RECONCILIATION_CAPABILITY_DOMAIN);
    hasher.update(prepared_identity.as_bytes());
    hasher.update(snapshot_identity.as_bytes());
    hasher.update(
        target_set
            .encode()
            .map_err(|_| ProgramHostV2Error::InputCoverage)?,
    );

    for target in derived_grid_targets {
        hasher.update(target.to_le_bytes());
    }
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

fn hash_text(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u32).to_le_bytes());
    hasher.update(value.as_bytes());
}

#[cfg(test)]
pub(crate) fn seal_reconciliation_capability_for_test(
    prepared: &PreparedBacktestTargetSetV2,
    account_id: AccountId,
    equity: Money,
    instruments: [InstrumentAny; TARGET_SET_MEMBER_COUNT],
    prices: [Price; TARGET_SET_MEMBER_COUNT],
    current_grid_units: [i64; TARGET_SET_MEMBER_COUNT],
) -> anyhow::Result<BacktestReconciliationCapabilityV2> {
    let target_set = prepared.canonical_target_set();
    BatchSnapshotV2 {
        account_id,
        equity,
        instruments,
        prices,
        current_grid_units,
    }
    .seal_reconciliation(prepared, target_set)
}

fn try_map_pair<T>(mut map: impl FnMut(usize) -> anyhow::Result<T>) -> anyhow::Result<[T; 2]> {
    Ok([map(0)?, map(1)?])
}

fn exact_grid_units(quantity: Quantity, increment: Quantity) -> anyhow::Result<u64> {
    anyhow::ensure!(increment.is_positive(), "size increment is invalid");
    let grid = quantity
        .as_decimal()
        .checked_div(increment.as_decimal())
        .context("filled grid conversion overflow")?;
    anyhow::ensure!(grid == grid.trunc(), "native filled quantity is off grid");
    grid.to_u64().context("native filled grid units exceed u64")
}

fn protection_trigger_price(
    instrument: &InstrumentAny,
    protection: ProtectionStateV1,
) -> anyhow::Result<Price> {
    let ticks = protection
        .trailing_stop_ticks
        .or(protection.stop_loss_ticks)
        .context("Backtest target-set protection has no executable stop")?;
    let scale = Decimal::from(10_u64.pow(u32::from(instrument.price_precision())));
    let value = Decimal::from(ticks)
        .checked_div(scale)
        .context("protection price overflow")?;
    let price = Price::from_decimal(value)?;
    instrument.try_normalize_price(price).map_err(Into::into)
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
    .map_err(|e| anyhow::anyhow!("target-set lifecycle order key rejected: {e:?}"))?;
    LifecycleEnvelopeV1::new_bound(order_key, payload)
        .map_err(|e| anyhow::anyhow!("target-set lifecycle envelope rejected: {e:?}"))
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

const fn position_intent_name(intent: PositionIntentV1) -> &'static str {
    match intent {
        PositionIntentV1::Hold => "HOLD",
        PositionIntentV1::Enter => "ENTER",
        PositionIntentV1::Add => "ADD",
        PositionIntentV1::Reduce => "REDUCE",
        PositionIntentV1::Exit => "EXIT",
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
