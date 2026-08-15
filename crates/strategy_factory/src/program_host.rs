use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    fmt::Debug,
    rc::Rc,
};

use anyhow::Context;
use strategy_factory_program_sdk::{
    Action, BALANCE_RECORD, BAR_RECORD, CODEC_V1, FrameEncoder, ORDER_EVENT_RECORD, ORDER_RECORD,
    OrderKind, OrderSide as ProgramOrderSide, POSITION_RECORD, ProgramRunScope, RecordMeta,
    order_event,
};
use vibe_common::actor::DataActor;
use vibe_model::{
    accounts::Account,
    data::{Bar, BarType, CustomData, DataType, HasTsInit},
    enums::{OmsType, OrderSide, OrderStatus, TimeInForce, TriggerType},
    events::OrderEventAny,
    identifiers::{ClientOrderId, InstrumentId, PositionId, StrategyId},
    instruments::Instrument,
    orders::{Order, OrderAny},
    types::{Price, Quantity},
};
use vibe_trading::{
    strategy::{Strategy, StrategyConfig, StrategyCore},
    vibe_strategy,
};

use crate::{artifact::StrategyArtifact, program_session::ProgramSession};
const PROGRAM_INPUT_SEMANTICS: &str = "strategy-program-input-v1/bar-ts-init-available-at";

fn program_data_key(data_type: &DataType) -> (String, String, Option<String>) {
    (
        data_type.type_name().to_string(),
        data_type.metadata_str(),
        data_type.identifier().map(str::to_string),
    )
}

pub(crate) struct ProgramCustomBinding {
    data_type: DataType,
    record_type_id: u32,
    channel: u32,
    max_payload_bytes: usize,
}

impl ProgramCustomBinding {
    pub(crate) fn new(
        data_type: DataType,
        record_type_id: u32,
        channel: u32,
        max_payload_bytes: usize,
    ) -> anyhow::Result<Self> {
        anyhow::ensure!(
            !data_type.type_name().is_empty()
                && record_type_id >= 1_024
                && channel != 0
                && (1..=4_096).contains(&max_payload_bytes),
            "program custom binding is outside the fixed transport profile"
        );
        Ok(Self {
            data_type,
            record_type_id,
            channel,
            max_payload_bytes,
        })
    }
}

pub(crate) struct ProgramHostBindings {
    executables: BTreeMap<u32, InstrumentId>,
    bars: BTreeMap<BarType, u32>,
    customs: BTreeMap<(String, String, Option<String>), ProgramCustomBinding>,
}
impl ProgramHostBindings {
    pub(crate) fn new(
        instruments: impl IntoIterator<Item = (u32, InstrumentId)>,
        bars: impl IntoIterator<Item = (u32, BarType)>,
    ) -> anyhow::Result<Self> {
        let mut instrument_map = BTreeMap::new();

        for (handle, instrument_id) in instruments {
            anyhow::ensure!(
                handle != 0
                    && !instrument_map.values().any(|bound| *bound == instrument_id)
                    && instrument_map.insert(handle, instrument_id).is_none(),
                "program instrument bindings must be non-zero and one-to-one"
            );
        }
        let mut bar_map = BTreeMap::new();

        for (channel, bar_type) in bars {
            anyhow::ensure!(
                channel != 0
                    && bar_map.values().all(|bound| *bound != channel)
                    && bar_map.insert(bar_type, channel).is_none(),
                "program bar bindings must be non-zero and one-to-one"
            );
        }
        anyhow::ensure!(
            !instrument_map.is_empty() && !bar_map.is_empty(),
            "program host requires executable and bar bindings"
        );
        Ok(Self {
            executables: instrument_map,
            bars: bar_map,
            customs: BTreeMap::new(),
        })
    }

    pub(crate) fn with_custom(
        mut self,
        bindings: impl IntoIterator<Item = ProgramCustomBinding>,
    ) -> anyhow::Result<Self> {
        let mut pairs = self
            .customs
            .values()
            .map(|binding| (binding.record_type_id, binding.channel))
            .collect::<BTreeSet<_>>();
        for binding in bindings {
            let key = program_data_key(&binding.data_type);
            anyhow::ensure!(
                self.customs.len() < 16
                    && pairs.insert((binding.record_type_id, binding.channel))
                    && self.customs.insert(key, binding).is_none(),
                "program custom bindings must be bounded with unique exact keys and record channels"
            );
        }
        Ok(self)
    }

    pub(crate) fn identity(&self) -> anyhow::Result<String> {
        let bytes = if self.customs.is_empty() {
            serde_json::to_vec(&(PROGRAM_INPUT_SEMANTICS, &self.executables, &self.bars))?
        } else {
            let customs = self
                .customs
                .iter()
                .map(|(key, binding)| {
                    Ok((
                        key,
                        binding.record_type_id,
                        binding.channel,
                        u32::try_from(binding.max_payload_bytes)?,
                    ))
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            serde_json::to_vec(&(
                "strategy-program-input-v2/bar-and-exact-custom-ts-init-available-at",
                &self.executables,
                &self.bars,
                customs,
            ))?
        };
        Ok(format!("blake3:{}", blake3::hash(&bytes).to_hex()))
    }

    fn custom_subscriptions(&self) -> Vec<DataType> {
        self.customs
            .values()
            .fold(BTreeMap::new(), |mut by_topic, binding| {
                by_topic
                    .entry(binding.data_type.topic().to_string())
                    .or_insert_with(|| binding.data_type.clone());
                by_topic
            })
            .into_values()
            .collect()
    }

    fn custom_record(&self, data: &CustomData) -> anyhow::Result<(RecordMeta, Vec<u8>)> {
        anyhow::ensure!(
            data.data.type_name() == data.data_type.type_name(),
            "program custom data inner type does not match its DataType"
        );
        let binding = self
            .customs
            .get(&program_data_key(&data.data_type))
            .context("program received an unbound exact CustomData key")?;
        let ts_event = data.data.ts_event().as_u64();
        let available_at = data.ts_init().as_u64();
        anyhow::ensure!(
            ts_event <= available_at,
            "program custom data precedes its event time"
        );
        let payload = serde_json::to_vec(data)?;
        anyhow::ensure!(
            !payload.is_empty() && payload.len() <= binding.max_payload_bytes,
            "program custom data payload is outside its bound"
        );
        Ok((
            RecordMeta {
                type_id: binding.record_type_id,
                codec_version: CODEC_V1,
                channel: binding.channel,
                ts_event,
                available_at,
            },
            payload,
        ))
    }
}

pub(crate) struct ProgramHostStrategy {
    core: StrategyCore,
    session: ProgramSession,
    bindings: ProgramHostBindings,
    order_handles: BTreeMap<u64, ClientOrderId>,
    trace: Rc<RefCell<ProgramHostTrace>>,
}

#[derive(Default)]
pub(crate) struct ProgramHostTrace {
    pub(crate) callback_failure: Option<String>,
    pub(crate) decision_tags: Vec<u32>,
}

enum PreparedAction {
    Submit {
        binding: (u64, ClientOrderId),
        order: Box<OrderAny>,
        position_id: Option<PositionId>,
        decision_tag: u32,
    },
    Modify {
        client_order_id: ClientOrderId,
        changes: (Option<Quantity>, Option<Price>, Option<Price>),
    },
    Cancel(ClientOrderId),
}

impl ProgramHostStrategy {
    pub(crate) fn new(
        strategy_id: StrategyId,
        artifact: &StrategyArtifact,
        parameters: &[u8],
        run_scope: ProgramRunScope,
        bindings: ProgramHostBindings,
        trace: Rc<RefCell<ProgramHostTrace>>,
    ) -> anyhow::Result<Self> {
        anyhow::ensure!(
            artifact.identity().strategy_spec_digest.as_deref()
                == Some(bindings.identity()?.as_str()),
            "program artifact input contract does not match host bindings"
        );
        Ok(Self {
            core: StrategyCore::new(
                StrategyConfig::builder()
                    .strategy_id(strategy_id)
                    .oms_type(OmsType::Netting)
                    .build()?,
            ),
            session: ProgramSession::new(artifact, parameters, run_scope)?,
            bindings,
            order_handles: BTreeMap::new(),
            trace,
        })
    }

    fn on_start_checked(&mut self) -> anyhow::Result<()> {
        for instrument_id in self
            .bindings
            .executables
            .values()
            .copied()
            .chain(self.bindings.bars.keys().map(BarType::instrument_id))
        {
            self.cache()
                .try_instrument(&instrument_id)
                .with_context(|| format!("program instrument {instrument_id} is unavailable"))?;
        }
        let decision_time_ns = self.clock().timestamp_ns().as_u64();
        let actions = self.session.start(decision_time_ns)?;
        self.apply_actions(&actions)?;

        for bar_type in self.bindings.bars.clone().into_keys() {
            self.subscribe_bars(bar_type, None, None);
        }
        for data_type in self.bindings.custom_subscriptions() {
            self.subscribe_data(data_type, None, None);
        }
        Ok(())
    }

    fn on_bar_checked(&mut self, bar: &Bar) -> anyhow::Result<()> {
        let channel = *self
            .bindings
            .bars
            .get(&bar.bar_type)
            .context("program received an unbound BarType")?;
        let snapshots = self.instrument_snapshots()?;
        let mut bar_payload = [0_u8; 40];
        for (index, value) in [
            bar.open.as_f64(),
            bar.high.as_f64(),
            bar.low.as_f64(),
            bar.close.as_f64(),
            bar.volume.as_f64(),
        ]
        .into_iter()
        .enumerate()
        {
            bar_payload[index * 8..index * 8 + 8].copy_from_slice(&value.to_bits().to_le_bytes());
        }
        let actions = self.session.observe(
            bar.ts_init.as_u64(),
            move |encoder: &mut FrameEncoder<'_>| {
                let meta = |type_id, channel| RecordMeta {
                    type_id,
                    codec_version: CODEC_V1,
                    channel,
                    ts_event: bar.ts_event.as_u64(),
                    available_at: bar.ts_init.as_u64(),
                };
                encoder.push(meta(BAR_RECORD, channel), &bar_payload)?;

                for (type_id, channel, value) in snapshots {
                    encoder.push(meta(type_id, channel), &value.to_bits().to_le_bytes())?;
                }
                Ok(())
            },
        )?;
        self.apply_actions(&actions)
    }

    fn on_data_checked(&mut self, data: &CustomData) -> anyhow::Result<()> {
        let (meta, payload) = self.bindings.custom_record(data)?;
        let available_at = meta.available_at;
        let actions = self
            .session
            .observe(available_at, |encoder| encoder.push(meta, &payload))?;
        self.apply_actions(&actions)
    }

    fn instrument_snapshots(&self) -> anyhow::Result<Vec<(u32, u32, f64)>> {
        let strategy_id = self
            .strategy_id()
            .context("program host is not registered")?;
        let cache = self.cache();
        let mut snapshots = Vec::with_capacity(self.bindings.executables.len() * 3);
        for (&channel, instrument_id) in &self.bindings.executables {
            let instrument = cache.try_instrument(instrument_id)?;
            let position = cache
                .positions_open(None, Some(instrument_id), Some(&strategy_id), None, None)
                .iter()
                .map(|position| position.signed_qty)
                .sum();
            let pending = cache
                .orders_open(None, Some(instrument_id), Some(&strategy_id), None, None)
                .len()
                + cache
                    .orders_inflight(None, Some(instrument_id), Some(&strategy_id), None, None)
                    .len();
            snapshots.push((POSITION_RECORD, channel, position));
            snapshots.push((ORDER_RECORD, channel, pending as f64));
            let balance = cache
                .account_for_venue(&instrument_id.venue)
                .context("program balance account is unavailable")?
                .balance_free(Some(instrument.quote_currency()))
                .context("program free quote balance is unavailable")?;
            snapshots.push((BALANCE_RECORD, channel, balance.as_f64()));
        }
        Ok(snapshots)
    }

    fn apply_actions(&mut self, actions: &[Action]) -> anyhow::Result<()> {
        let prepared = self.prepare_actions(actions)?;
        for action in &prepared {
            if let PreparedAction::Submit { binding, .. } = action {
                self.order_handles.insert(binding.0, binding.1);
            }
        }
        for action in prepared {
            match action {
                PreparedAction::Submit {
                    order,
                    position_id,
                    decision_tag,
                    ..
                } => {
                    self.submit_order(*order, position_id, None, None)?;
                    self.trace.borrow_mut().decision_tags.push(decision_tag);
                }
                PreparedAction::Modify {
                    client_order_id,
                    changes,
                } => {
                    self.modify_order(
                        client_order_id,
                        changes.0,
                        changes.1,
                        changes.2,
                        None,
                        None,
                    )?;
                }
                PreparedAction::Cancel(client_order_id) => {
                    self.cancel_order(client_order_id, None, None)?;
                }
            }
        }
        Ok(())
    }

    fn prepare_actions(&self, actions: &[Action]) -> anyhow::Result<Vec<PreparedAction>> {
        let mut touched = BTreeSet::new();
        let mut prepared = Vec::with_capacity(actions.len());
        for action in actions {
            let handle = match action {
                Action::Submit { handle, .. } | Action::Modify { handle, .. } => *handle,
                Action::Cancel(handle) => *handle,
            };
            anyhow::ensure!(
                touched.insert(handle),
                "program action batch reuses an order handle"
            );
            match action {
                Action::Submit {
                    kind,
                    instrument,
                    handle,
                    side,
                    quantity,
                    price,
                    trigger_price,
                    reduce_only,
                    decision_tag,
                } => {
                    anyhow::ensure!(
                        *handle != 0 && !self.order_handles.contains_key(handle),
                        "program submit reused an existing order handle"
                    );
                    let (instrument_id, quantity, position_id) =
                        self.prepare_submit(*instrument, *quantity, *reduce_only)?;
                    let client_order_id = self.order().generate_client_order_id();
                    let side = match side {
                        ProgramOrderSide::Buy => OrderSide::Buy,
                        ProgramOrderSide::Sell => OrderSide::Sell,
                    };
                    let order = match kind {
                        OrderKind::Market => {
                            anyhow::ensure!(*price == 0.0 && *trigger_price == 0.0);
                            self.order().try_market(
                                instrument_id,
                                side,
                                quantity,
                                Some(TimeInForce::Ioc),
                                Some(*reduce_only),
                                None,
                                None,
                                None,
                                None,
                                Some(client_order_id),
                            )?
                        }
                        OrderKind::Limit => {
                            anyhow::ensure!(*trigger_price == 0.0);
                            self.order().try_limit(
                                instrument_id,
                                side,
                                quantity,
                                self.normalize_price(instrument_id, *price)?,
                                Some(TimeInForce::Gtc),
                                None,
                                None,
                                Some(*reduce_only),
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                                Some(client_order_id),
                            )?
                        }
                        OrderKind::StopMarket => {
                            anyhow::ensure!(*price == 0.0);
                            self.order().try_stop_market(
                                instrument_id,
                                side,
                                quantity,
                                self.normalize_price(instrument_id, *trigger_price)?,
                                Some(TriggerType::Default),
                                Some(TimeInForce::Gtc),
                                None,
                                Some(*reduce_only),
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                                Some(client_order_id),
                            )?
                        }
                    };
                    prepared.push(PreparedAction::Submit {
                        binding: (*handle, client_order_id),
                        order: Box::new(order),
                        position_id,
                        decision_tag: *decision_tag,
                    });
                }
                Action::Modify {
                    quantity,
                    price,
                    trigger_price,
                    ..
                } => {
                    anyhow::ensure!(handle != 0, "program order handle is zero");
                    let client_order_id = self.existing_order(handle)?;
                    let order = self.cache().try_order(&client_order_id)?;
                    anyhow::ensure!(
                        !order.is_closed()
                            && !order.is_pending_cancel()
                            && !order.is_pending_update(),
                        "program cannot modify an order in state {:?}",
                        order.status()
                    );
                    let instrument_id = order.instrument_id();
                    let quantity = quantity
                        .map(|value| self.normalize_quantity(instrument_id, value))
                        .transpose()?;
                    let price = price
                        .map(|value| self.normalize_price(instrument_id, value))
                        .transpose()?;
                    let trigger_price = trigger_price
                        .map(|value| self.normalize_price(instrument_id, value))
                        .transpose()?;
                    anyhow::ensure!(
                        price.is_none() || order.price().is_some(),
                        "program price modify targets a non-limit order"
                    );
                    anyhow::ensure!(
                        trigger_price.is_none() || order.trigger_price().is_some(),
                        "program trigger modify targets a non-stop order"
                    );
                    prepared.push(PreparedAction::Modify {
                        client_order_id,
                        changes: (quantity, price, trigger_price),
                    });
                }
                Action::Cancel(_) => {
                    anyhow::ensure!(handle != 0, "program order handle is zero");
                    let client_order_id = self.existing_order(handle)?;
                    let order = self.cache().try_order(&client_order_id)?;
                    anyhow::ensure!(
                        !order.is_closed() && !order.is_pending_cancel(),
                        "program cannot cancel a closed or pending-cancel order"
                    );
                    prepared.push(PreparedAction::Cancel(client_order_id));
                }
            }
        }
        Ok(prepared)
    }

    fn existing_order(&self, handle: u64) -> anyhow::Result<ClientOrderId> {
        self.order_handles
            .get(&handle)
            .copied()
            .context("program order handle is unknown")
    }

    fn normalize_quantity(
        &self,
        instrument_id: InstrumentId,
        value: f64,
    ) -> anyhow::Result<Quantity> {
        let instrument = self.cache().try_instrument(&instrument_id)?;
        let quantity = Quantity::non_zero_checked(value, instrument.size_precision())?;
        anyhow::ensure!(
            quantity.as_f64() == value,
            "program quantity requires rounding"
        );
        Ok(instrument.try_normalize_qty(quantity)?)
    }

    fn normalize_price(&self, instrument_id: InstrumentId, value: f64) -> anyhow::Result<Price> {
        let instrument = self.cache().try_instrument(&instrument_id)?;
        let price = Price::new_checked(value, instrument.price_precision())?;
        anyhow::ensure!(price.as_f64() == value, "program price requires rounding");
        Ok(instrument.try_normalize_price(price)?)
    }

    fn prepare_submit(
        &self,
        executable: u32,
        raw_quantity: f64,
        reduce_only: bool,
    ) -> anyhow::Result<(InstrumentId, Quantity, Option<PositionId>)> {
        let strategy_id = self
            .strategy_id()
            .context("program host is not registered")?;
        let instrument_id = *self
            .bindings
            .executables
            .get(&executable)
            .context("program action instrument handle is unbound")?;
        let quantity = self.normalize_quantity(instrument_id, raw_quantity)?;
        let position_id = if reduce_only {
            let positions = self.cache().positions_open(
                None,
                Some(&instrument_id),
                Some(&strategy_id),
                None,
                None,
            );
            anyhow::ensure!(
                positions.len() == 1 && quantity <= positions[0].quantity,
                "reduce-only program action requires one sufficient net position"
            );
            Some(positions[0].id)
        } else {
            None
        };
        Ok((instrument_id, quantity, position_id))
    }

    fn on_order_event_checked(&mut self, event: &OrderEventAny) -> anyhow::Result<()> {
        let client_order_id = event.client_order_id();
        let Some((&handle, _)) = self
            .order_handles
            .iter()
            .find(|(_, bound)| **bound == client_order_id)
        else {
            return Ok(());
        };
        let code = match event {
            OrderEventAny::Accepted(_) => order_event::ACCEPTED,
            OrderEventAny::PendingUpdate(_) => order_event::PENDING_UPDATE,
            OrderEventAny::Updated(_) => order_event::UPDATED,
            OrderEventAny::PendingCancel(_) => order_event::PENDING_CANCEL,
            OrderEventAny::Canceled(_) => order_event::CANCELED,
            OrderEventAny::Denied(_) | OrderEventAny::Rejected(_) => order_event::REJECTED,
            OrderEventAny::ModifyRejected(_) => order_event::MODIFY_REJECTED,
            OrderEventAny::CancelRejected(_) => order_event::CANCEL_REJECTED,
            OrderEventAny::Filled(_) => match self.cache().try_order(&client_order_id)?.status() {
                OrderStatus::PartiallyFilled => order_event::PARTIALLY_FILLED,
                OrderStatus::Filled => order_event::FILLED,
                status => {
                    anyhow::bail!("program fill event has unexpected order status {status:?}")
                }
            },
            _ => return Ok(()),
        };
        let order = self.cache().try_order(&client_order_id)?;
        let channel = self
            .bindings
            .executables
            .iter()
            .find_map(|(channel, instrument)| {
                (*instrument == event.instrument_id()).then_some(*channel)
            })
            .context("program order event instrument is not executable")?;
        let side_code = match order.order_side() {
            OrderSide::Buy => 1,
            OrderSide::Sell => 2,
            side => anyhow::bail!("program order event has unsupported side {side:?}"),
        };
        let (filled_quantity, last_price) = match event {
            OrderEventAny::Filled(fill) => (fill.last_qty.as_f64(), fill.last_px.as_f64()),
            _ => (0.0, 0.0),
        };
        let mut payload = [0_u8; 32];
        payload[..8].copy_from_slice(&handle.to_le_bytes());
        payload[8] = code;
        payload[9] = side_code;
        payload[16..24].copy_from_slice(&filled_quantity.to_bits().to_le_bytes());
        payload[24..32].copy_from_slice(&last_price.to_bits().to_le_bytes());
        let decision_time_ns = self.clock().timestamp_ns().as_u64();
        let ts_event = event.ts_event().as_u64();
        let actions = self.session.observe(decision_time_ns, |encoder| {
            encoder.push(
                RecordMeta {
                    type_id: ORDER_EVENT_RECORD,
                    codec_version: CODEC_V1,
                    channel,
                    ts_event,
                    available_at: decision_time_ns,
                },
                &payload,
            )
        })?;
        self.apply_actions(&actions)
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

vibe_strategy!(ProgramHostStrategy, {
    fn on_order_event(&mut self, event: OrderEventAny) {
        if self.trace.borrow().callback_failure.is_none() {
            let result = self.on_order_event_checked(&event);
            let _ = self.finish_callback(result);
        }
    }
});

impl Debug for ProgramHostStrategy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ProgramHostStrategy")
    }
}

impl DataActor for ProgramHostStrategy {
    fn on_start(&mut self) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.trace.borrow().callback_failure.is_none(),
            "program host is faulted"
        );
        let result = self.on_start_checked();
        self.finish_callback(result)
    }

    fn on_bar(&mut self, bar: &Bar) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.trace.borrow().callback_failure.is_none(),
            "program host is faulted"
        );
        let result = self.on_bar_checked(bar);
        self.finish_callback(result)
    }

    fn on_data(&mut self, data: &CustomData) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.trace.borrow().callback_failure.is_none(),
            "program host is faulted"
        );
        let result = self.on_data_checked(data);
        self.finish_callback(result)
    }

    fn on_stop(&mut self) -> anyhow::Result<()> {
        for bar_type in self.bindings.bars.clone().into_keys() {
            self.unsubscribe_bars(bar_type, None, None);
        }
        for data_type in self.bindings.custom_subscriptions() {
            self.unsubscribe_data(data_type, None, None);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{any::Any, cell::RefCell, rc::Rc, str::FromStr, sync::Arc};

    use rstest::rstest;
    use serde::Serialize;
    use vibe_common::{
        cache::Cache,
        clock::{Clock, TestClock},
    };
    use vibe_model::{
        data::{Bar, BarType},
        identifiers::{StrategyId, Symbol, TraderId},
        instruments::{InstrumentAny, currency_pair::CurrencyPair},
        types::{Currency, Price, Quantity},
    };
    use vibe_portfolio::portfolio::Portfolio;

    use super::*;
    use crate::{
        decision::DecisionContract,
        family::FrozenStrategyFamily,
        intent::PilotResearchIntent,
        pilot::{pilot_host_bindings, pilot_program_parameters},
    };

    #[derive(Clone, Debug, PartialEq, Eq, Serialize)]
    struct TestCustom {
        ts_event: u64,
        ts_init: u64,
        json: &'static str,
    }

    impl HasTsInit for TestCustom {
        fn ts_init(&self) -> vibe_core::UnixNanos {
            self.ts_init.into()
        }
    }

    impl vibe_model::data::CustomDataTrait for TestCustom {
        fn type_name(&self) -> &'static str {
            "TestCustom"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn ts_event(&self) -> vibe_core::UnixNanos {
            self.ts_event.into()
        }

        fn to_json(&self) -> anyhow::Result<String> {
            Ok(self.json.to_string())
        }

        fn clone_arc(&self) -> Arc<dyn vibe_model::data::CustomDataTrait> {
            Arc::new(self.clone())
        }

        fn eq_arc(&self, other: &dyn vibe_model::data::CustomDataTrait) -> bool {
            other.as_any().downcast_ref::<Self>() == Some(self)
        }
    }

    fn test_custom(
        identifier: &str,
        ts_event: u64,
        ts_init: u64,
        json: &'static str,
    ) -> CustomData {
        CustomData::new(
            Arc::new(TestCustom {
                ts_event,
                ts_init,
                json,
            }),
            DataType::new("TestCustom", None, Some(identifier.to_string())),
        )
    }

    #[rstest]
    fn custom_bindings_preserve_legacy_identity_and_bind_exact_series() {
        let bars = [(1, "BTCUSDT.BINANCE-1-HOUR-LAST-EXTERNAL".parse().unwrap())];
        let legacy =
            ProgramHostBindings::new([(1, "BTCUSDT.BINANCE".parse().unwrap())], bars).unwrap();
        let expected =
            serde_json::to_vec(&(PROGRAM_INPUT_SEMANTICS, &legacy.executables, &legacy.bars))
                .unwrap();
        assert_eq!(
            legacy.identity().unwrap(),
            format!("blake3:{}", blake3::hash(&expected).to_hex())
        );

        let first = DataType::new("TestCustom", None, Some("series-a".to_string()));
        let second = DataType::new("TestCustom", None, Some("series-b".to_string()));
        assert_eq!(first.topic(), second.topic());
        let with_custom = legacy
            .with_custom([
                ProgramCustomBinding::new(first.clone(), 1_024, 10, 4_096).unwrap(),
                ProgramCustomBinding::new(second.clone(), 1_025, 11, 4_096).unwrap(),
            ])
            .unwrap();
        assert_eq!(with_custom.customs.len(), 2);

        let repeated_pair =
            ProgramHostBindings::new([(1, "BTCUSDT.BINANCE".parse().unwrap())], bars)
                .unwrap()
                .with_custom([ProgramCustomBinding::new(first.clone(), 1_024, 10, 4_096).unwrap()])
                .unwrap()
                .with_custom([ProgramCustomBinding::new(second.clone(), 1_024, 10, 4_096).unwrap()])
                .err()
                .expect("a pair cannot be rebound by a later builder call");
        assert!(repeated_pair.to_string().contains("unique exact keys"));

        let duplicate_pair =
            ProgramHostBindings::new([(1, "BTCUSDT.BINANCE".parse().unwrap())], bars)
                .unwrap()
                .with_custom([
                    ProgramCustomBinding::new(first, 1_024, 10, 4_096).unwrap(),
                    ProgramCustomBinding::new(second, 1_024, 10, 4_096).unwrap(),
                ])
                .err()
                .expect("duplicate pair must fail");
        assert!(duplicate_pair.to_string().contains("unique exact keys"));
    }

    #[rstest]
    fn custom_record_fails_closed_on_key_type_time_json_and_bound() {
        let bindings = ProgramHostBindings::new(
            [(1, "BTCUSDT.BINANCE".parse().unwrap())],
            [(1, "BTCUSDT.BINANCE-1-HOUR-LAST-EXTERNAL".parse().unwrap())],
        )
        .unwrap()
        .with_custom([ProgramCustomBinding::new(
            DataType::new("TestCustom", None, Some("series-a".to_string())),
            1_024,
            10,
            4_096,
        )
        .unwrap()])
        .unwrap();
        let valid = test_custom("series-a", 10, 11, r#"{"value":1}"#);
        let (meta, first) = bindings.custom_record(&valid).unwrap();
        assert_eq!(
            (meta.type_id, meta.channel, meta.ts_event, meta.available_at),
            (1_024, 10, 10, 11)
        );
        assert_eq!(first, serde_json::to_vec(&valid).unwrap());

        for (event, message) in [
            (
                test_custom("series-b", 10, 11, r#"{"value":1}"#),
                Some("unbound exact"),
            ),
            (
                test_custom("series-a", 12, 11, r#"{"value":1}"#),
                Some("precedes its event"),
            ),
            (test_custom("series-a", 10, 11, ""), None),
        ] {
            let error = bindings
                .custom_record(&event)
                .err()
                .expect("invalid custom record must fail");
            assert!(message.is_none_or(|message| error.to_string().contains(message)));
        }
        let mismatched = CustomData::new(
            Arc::new(TestCustom {
                ts_event: 10,
                ts_init: 11,
                json: r#"{"value":1}"#,
            }),
            DataType::new("OtherType", None, Some("series-a".to_string())),
        );
        let error = bindings
            .custom_record(&mismatched)
            .err()
            .expect("mismatched inner type must fail");
        assert!(error.to_string().contains("inner type"));

        let tiny = ProgramHostBindings::new(
            [(1, "BTCUSDT.BINANCE".parse().unwrap())],
            [(1, "BTCUSDT.BINANCE-1-HOUR-LAST-EXTERNAL".parse().unwrap())],
        )
        .unwrap()
        .with_custom([ProgramCustomBinding::new(valid.data_type.clone(), 1_024, 10, 1).unwrap()])
        .unwrap();
        let error = tiny
            .custom_record(&valid)
            .err()
            .expect("oversized custom record must fail");
        assert!(error.to_string().contains("payload"));
    }

    #[rstest]
    fn first_callback_fault_is_sticky_and_prevents_later_program_effects() {
        let family = FrozenStrategyFamily::frozen_pilot().expect("family");
        let artifact = family.materialize(&family.trials()[0]).expect("artifact");
        let intent = PilotResearchIntent::frozen().expect("intent");
        let contract = DecisionContract::for_intent(&intent).expect("contract");
        let parameters = pilot_program_parameters(&intent, &contract);
        let bar_type = BarType::from_str("BTCUSDT.BINANCE-1-HOUR-LAST-EXTERNAL").unwrap();
        let trace = Rc::new(RefCell::new(ProgramHostTrace::default()));
        let bindings = pilot_host_bindings().unwrap();
        let mut host = ProgramHostStrategy::new(
            StrategyId::from("PROGRAM-FAULT-TEST"),
            &artifact,
            &parameters,
            ProgramRunScope::new(1, 1, 100).unwrap(),
            bindings,
            Rc::clone(&trace),
        )
        .unwrap();
        host.finish_callback(Err(anyhow::anyhow!("first fault")))
            .unwrap_err();

        let bar = Bar::new(
            bar_type,
            Price::from("100.00"),
            Price::from("101.00"),
            Price::from("99.00"),
            Price::from("100.50"),
            Quantity::from("1.000000"),
            1.into(),
            1.into(),
        );
        let later = DataActor::on_bar(&mut host, &bar).unwrap_err();
        assert!(later.to_string().contains("host is faulted"));
        assert_eq!(
            trace.borrow().callback_failure.as_deref(),
            Some("first fault")
        );
        assert!(host.order_handles.is_empty());
    }

    #[rstest]
    fn invalid_tail_action_prevents_every_native_order_effect() {
        let family = FrozenStrategyFamily::frozen_pilot().expect("family");
        let artifact = family.materialize(&family.trials()[0]).expect("artifact");
        let intent = PilotResearchIntent::frozen().expect("intent");
        let contract = DecisionContract::for_intent(&intent).expect("contract");
        let parameters = pilot_program_parameters(&intent, &contract);
        let trace = Rc::new(RefCell::new(ProgramHostTrace::default()));
        let mut host = ProgramHostStrategy::new(
            StrategyId::from("PROGRAM-BATCH-TEST"),
            &artifact,
            &parameters,
            ProgramRunScope::new(1, 1, 100).unwrap(),
            pilot_host_bindings().unwrap(),
            Rc::clone(&trace),
        )
        .unwrap();
        let cache = Rc::new(RefCell::new(Cache::default()));
        cache
            .borrow_mut()
            .add_instrument(InstrumentAny::CurrencyPair(
                CurrencyPair::builder()
                    .instrument_id("BTCUSDT.BINANCE".parse().unwrap())
                    .raw_symbol(Symbol::from("BTCUSDT"))
                    .base_currency(Currency::get_or_create_crypto("BTC"))
                    .quote_currency(Currency::from("USDT"))
                    .price_precision(2)
                    .size_precision(6)
                    .price_increment(Price::from("0.01"))
                    .size_increment(Quantity::from("0.000001"))
                    .maker_fee("0.0002".parse().unwrap())
                    .taker_fee("0.0004".parse().unwrap())
                    .ts_event(0.into())
                    .ts_init(0.into())
                    .build()
                    .unwrap(),
            ))
            .unwrap();
        let clock: Rc<RefCell<dyn Clock>> = Rc::new(RefCell::new(TestClock::new()));
        let portfolio = Rc::new(RefCell::new(Portfolio::new(
            Rc::clone(&clock),
            Rc::clone(&cache),
            None,
        )));
        host.core
            .register(
                TraderId::from("TRADER-001"),
                clock,
                Rc::clone(&cache),
                portfolio,
            )
            .unwrap();

        let error = host
            .apply_actions(&[
                Action::Submit {
                    kind: OrderKind::Market,
                    instrument: 1,
                    handle: 1,
                    side: ProgramOrderSide::Buy,
                    quantity: 1.0,
                    price: 0.0,
                    trigger_price: 0.0,
                    reduce_only: false,
                    decision_tag: 7,
                },
                Action::Cancel(99),
            ])
            .unwrap_err();

        assert!(error.to_string().contains("handle is unknown"));
        assert!(
            cache
                .borrow()
                .orders(None, None, None, None, None)
                .is_empty()
        );
        assert!(host.order_handles.is_empty());
        assert!(trace.borrow().decision_tags.is_empty());
    }
}
