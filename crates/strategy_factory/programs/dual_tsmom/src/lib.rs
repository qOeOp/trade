#![no_std]

#[cfg(not(test))]
use core::panic::PanicInfo;
use strategy_factory_program_sdk::{
    Action, ActionEncoder, BALANCE_RECORD, BAR_RECORD, Frame, ORDER_EVENT_RECORD, ORDER_RECORD,
    OrderKind, OrderSide, POSITION_RECORD, ProgramFault, StrategyProgram, export_strategy_program,
    order_event,
};

const BTC: usize = 0;
const ETH: usize = 1;
const D1_NS: u64 = 86_400_000_000_000;
const H1_NS: u64 = 3_600_000_000_000;
const EXECUTABLES: [u32; 2] = [1, 2];
const CHANNELS: [u32; 4] = [1, 2, 3, 4];
const QUANTITIES: [f64; 2] = [0.01, 0.1];
const OPEN_TAGS: [u32; 2] = [101, 102];
const CLOSE_TAGS: [u32; 2] = [201, 202];
const TERMINAL_TAGS: [u32; 2] = [211, 212];
const DRAIN_TAGS: [u32; 2] = [301, 302];

#[derive(Clone, Copy)]
struct Parameters {
    lookback: usize,
    features: u16,
}

impl Parameters {
    fn parse(bytes: &[u8]) -> Result<Self, ProgramFault> {
        if bytes.len() != 64 {
            return Err(ProgramFault::MalformedFrame);
        }
        let allowed: [(u16, u16, u16); 5] =
            [(3, 60, 2), (2, 60, 2), (1, 60, 1), (3, 30, 2), (3, 90, 2)];
        let Some(&(features, lookback, persistence)) = allowed.get(usize::from(bytes[5])) else {
            return Err(ProgramFault::ProgramRejected);
        };
        let mut expected = [0; 64];
        expected[..4].copy_from_slice(b"TSM1");
        expected[4] = 1;
        expected[5] = bytes[5];
        expected[6..8].copy_from_slice(&features.to_le_bytes());
        for (index, value) in [1_u32, 2, 1, 2, 3, 4].into_iter().enumerate() {
            expected[8 + index * 4..12 + index * 4].copy_from_slice(&value.to_le_bytes());
        }
        expected[32..34].copy_from_slice(&lookback.to_le_bytes());
        expected[34..36].copy_from_slice(&persistence.to_le_bytes());
        expected[40..48].copy_from_slice(&QUANTITIES[BTC].to_le_bytes());
        expected[48..56].copy_from_slice(&QUANTITIES[ETH].to_le_bytes());
        if bytes != expected {
            return Err(ProgramFault::ProgramRejected);
        }
        Ok(Self {
            lookback: usize::from(lookback),
            features,
        })
    }
}

#[derive(Clone, Copy)]
struct Observation {
    close: f64,
    ts: u64,
    available: u64,
    snapshot: Snapshot,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Snapshot {
    positions: [f64; 2],
    open_orders: [f64; 2],
}

struct History {
    closes: [[f64; 2]; 91],
    count: usize,
    next: usize,
}

impl History {
    fn push(&mut self, closes: [f64; 2], lookback: usize) -> Option<[f64; 2]> {
        let momentum = (self.count >= lookback).then(|| {
            let lag = (self.next + 91 - lookback) % 91;
            [
                closes[BTC] / self.closes[lag][BTC] - 1.0,
                closes[ETH] / self.closes[lag][ETH] - 1.0,
            ]
        });
        self.closes[self.next] = closes;
        self.next = (self.next + 1) % 91;
        self.count = (self.count + 1).min(91);
        momentum
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Flat,
    Opening,
    Long,
    Closing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Active,
    Draining,
    Halted,
}

#[derive(Clone, Copy)]
struct Outstanding {
    handle: u64,
    side: OrderSide,
    quantity: f64,
    filled: f64,
    accepted: bool,
}

#[derive(Clone, Copy)]
struct Leg {
    phase: Phase,
    position: f64,
    open_orders: f64,
    previous_positive: bool,
    order: Option<Outstanding>,
}

impl Leg {
    const EMPTY: Self = Self {
        phase: Phase::Flat,
        position: 0.0,
        open_orders: 0.0,
        previous_positive: false,
        order: None,
    };
}

#[derive(Clone, Copy)]
struct Signal {
    available: u64,
    momentum: [f64; 2],
    enter: [bool; 2],
}

struct DualTsmom {
    parameters: Option<Parameters>,
    run_end: u64,
    staged_d1: [Option<Observation>; 2],
    staged_h1: [Option<Observation>; 2],
    watermarks: [(u64, u64); 4],
    history: History,
    legs: [Leg; 2],
    mode: Mode,
    signal: Option<Signal>,
    h1_available: Option<u64>,
    next_handle: u64,
    drain_sent: bool,
}

impl DualTsmom {
    const fn new() -> Self {
        Self {
            parameters: None,
            run_end: 0,
            staged_d1: [None; 2],
            staged_h1: [None; 2],
            watermarks: [(0, 0); 4],
            history: History {
                closes: [[0.0; 2]; 91],
                count: 0,
                next: 0,
            },
            legs: [Leg::EMPTY; 2],
            mode: Mode::Active,
            signal: None,
            h1_available: None,
            next_handle: 1,
            drain_sent: false,
        }
    }

    fn stage(
        &mut self,
        channel: u32,
        observation: Observation,
        decision_time: u64,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let slot = CHANNELS
            .iter()
            .position(|bound| *bound == channel)
            .ok_or(ProgramFault::MalformedFrame)?;
        let cadence = if slot < 2 { D1_NS } else { H1_NS };
        let (last_ts, last_available) = self.watermarks[slot];
        if observation.ts <= last_ts
            || observation.available < last_available
            || (last_ts != 0 && observation.ts.checked_sub(last_ts) != Some(cadence))
        {
            return Err(ProgramFault::ProgramRejected);
        }
        if slot >= 2
            && self.staged_h1.iter().all(Option::is_none)
            && decision_time < self.run_end
            && observation
                .ts
                .checked_add(H1_NS)
                .is_some_and(|next| next < self.run_end)
        {
            self.consume(actions)?;
        }
        let (staged, leg) = if slot < 2 {
            (&mut self.staged_d1, slot)
        } else {
            (&mut self.staged_h1, slot - 2)
        };
        if staged[leg].is_some() {
            return Err(ProgramFault::ProgramRejected);
        }
        self.watermarks[slot] = (observation.ts, observation.available);
        staged[leg] = Some(observation);
        let Some(pair) = staged[BTC].zip(staged[ETH]) else {
            return Ok(());
        };
        if pair.0.ts != pair.1.ts {
            return Err(ProgramFault::ProgramRejected);
        }
        *staged = [None, None];
        if slot < 2 {
            self.complete_d1(pair)
        } else {
            self.complete_h1(pair, decision_time, actions)
        }
    }

    fn complete_d1(&mut self, pair: (Observation, Observation)) -> Result<(), ProgramFault> {
        if self.signal.is_some() {
            return Err(ProgramFault::ProgramRejected);
        }
        let parameters = self.parameters.ok_or(ProgramFault::MalformedFrame)?;
        let closes = [pair.0.close, pair.1.close];
        let Some(momentum) = self.history.push(closes, parameters.lookback) else {
            return Ok(());
        };
        if !momentum.iter().all(|value| value.is_finite()) {
            return Err(ProgramFault::ProgramRejected);
        }
        let mut enter = [false; 2];
        for leg in 0..2 {
            let positive = momentum[leg] > 0.0;
            enter[leg] =
                positive && (parameters.features & 2 == 0 || self.legs[leg].previous_positive);
            self.legs[leg].previous_positive = positive;
        }
        if parameters.features & 1 == 0 {
            enter[ETH] = false;
        }
        self.signal = Some(Signal {
            available: pair.0.available.max(pair.1.available),
            momentum,
            enter,
        });
        Ok(())
    }

    fn complete_h1(
        &mut self,
        pair: (Observation, Observation),
        decision_time: u64,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        if pair.0.snapshot != pair.1.snapshot {
            return Err(ProgramFault::ProgramRejected);
        }
        self.reconcile(pair.0.snapshot)?;
        let ts = pair.0.ts;
        if decision_time >= self.run_end || ts >= self.run_end {
            return self.halt();
        }
        if self.mode == Mode::Draining {
            return self.drain(actions);
        }
        if ts
            .checked_add(H1_NS)
            .is_none_or(|next| next >= self.run_end)
        {
            return self.terminal(actions);
        }
        self.h1_available = Some(pair.0.available.max(pair.1.available));
        self.consume(actions)
    }

    fn reconcile(&mut self, snapshot: Snapshot) -> Result<(), ProgramFault> {
        let mut anomaly = false;
        for (leg, &quantity) in QUANTITIES.iter().enumerate() {
            let position = snapshot.positions[leg];
            let open_orders = snapshot.open_orders[leg];
            let invalid_position = !position.is_finite() || position < 0.0 || position > quantity;
            if invalid_position || !matches!(open_orders, 0.0 | 1.0) {
                return Err(ProgramFault::ProgramRejected);
            }
            self.legs[leg].position = position;
            self.legs[leg].open_orders = open_orders;
            if self.mode != Mode::Active {
                continue;
            }
            match self.legs[leg].phase {
                Phase::Flat if position != 0.0 || open_orders != 0.0 => {
                    return Err(ProgramFault::ProgramRejected);
                }
                Phase::Opening if open_orders == 0.0 && position == quantity => {
                    self.legs[leg].phase = Phase::Long;
                    self.legs[leg].order = None;
                }
                Phase::Opening if open_orders == 0.0 => anomaly = true,
                Phase::Opening => {}
                Phase::Long if position <= 0.0 || open_orders != 0.0 => {
                    return Err(ProgramFault::ProgramRejected);
                }
                Phase::Closing if open_orders == 0.0 && position == 0.0 => {
                    self.legs[leg].phase = Phase::Flat;
                    self.legs[leg].order = None;
                }
                Phase::Closing if open_orders == 0.0 => anomaly = true,
                Phase::Closing => {}
                Phase::Flat | Phase::Long => {}
            }
        }
        if anomaly {
            self.begin_draining();
        }
        Ok(())
    }

    fn consume(&mut self, actions: &mut ActionEncoder<'_>) -> Result<(), ProgramFault> {
        let (Some(signal), Some(h1_available)) = (self.signal, self.h1_available) else {
            return Ok(());
        };
        if h1_available <= signal.available {
            return Ok(());
        }
        self.signal = None;
        self.h1_available = None;
        if self.mode != Mode::Active {
            return Ok(());
        }
        let parameters = self.parameters.ok_or(ProgramFault::MalformedFrame)?;
        for leg in 0..2 {
            if leg == ETH && parameters.features & 1 == 0 {
                continue;
            }
            match self.legs[leg].phase {
                Phase::Flat if signal.enter[leg] => {
                    self.submit(
                        leg,
                        OrderSide::Buy,
                        QUANTITIES[leg],
                        false,
                        OPEN_TAGS[leg],
                        actions,
                    )?;
                    self.legs[leg].phase = Phase::Opening;
                }
                Phase::Long if signal.momentum[leg] <= 0.0 => {
                    self.submit(
                        leg,
                        OrderSide::Sell,
                        self.legs[leg].position,
                        true,
                        CLOSE_TAGS[leg],
                        actions,
                    )?;
                    self.legs[leg].phase = Phase::Closing;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn submit(
        &mut self,
        leg: usize,
        side: OrderSide,
        quantity: f64,
        reduce_only: bool,
        tag: u32,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        if self.legs[leg].order.is_some() || !quantity.is_finite() || quantity <= 0.0 {
            return Err(ProgramFault::ProgramRejected);
        }
        let handle = self.next_handle;
        self.next_handle = self
            .next_handle
            .checked_add(1)
            .ok_or(ProgramFault::ProgramRejected)?;
        actions.push(Action::Submit {
            kind: OrderKind::Market,
            instrument: EXECUTABLES[leg],
            handle,
            side,
            quantity,
            price: 0.0,
            trigger_price: 0.0,
            reduce_only,
            decision_tag: tag,
        })?;
        self.legs[leg].order = Some(Outstanding {
            handle,
            side,
            quantity,
            filled: 0.0,
            accepted: false,
        });
        Ok(())
    }

    fn begin_draining(&mut self) {
        self.mode = Mode::Draining;
        self.signal = None;
        self.h1_available = None;
    }

    fn drain(&mut self, actions: &mut ActionEncoder<'_>) -> Result<(), ProgramFault> {
        if self.legs.iter().any(|leg| leg.open_orders != 0.0) {
            return Ok(());
        }
        if self.drain_sent {
            return self.halt();
        }
        let mut submitted = false;
        for (leg, &tag) in DRAIN_TAGS.iter().enumerate() {
            self.legs[leg].order = None;
            if self.legs[leg].position > 0.0 {
                self.submit(
                    leg,
                    OrderSide::Sell,
                    self.legs[leg].position,
                    true,
                    tag,
                    actions,
                )?;
                self.legs[leg].phase = Phase::Closing;
                submitted = true;
            }
        }
        self.drain_sent = submitted;
        if submitted { Ok(()) } else { self.halt() }
    }

    fn terminal(&mut self, actions: &mut ActionEncoder<'_>) -> Result<(), ProgramFault> {
        if self.mode != Mode::Active
            || self.legs.iter().any(|leg| {
                leg.open_orders != 0.0 || matches!(leg.phase, Phase::Opening | Phase::Closing)
            })
        {
            return Err(ProgramFault::ProgramRejected);
        }
        for (leg, &tag) in TERMINAL_TAGS.iter().enumerate() {
            if self.legs[leg].phase == Phase::Long {
                self.submit(
                    leg,
                    OrderSide::Sell,
                    self.legs[leg].position,
                    true,
                    tag,
                    actions,
                )?;
                self.legs[leg].phase = Phase::Closing;
            }
        }
        Ok(())
    }

    fn halt(&mut self) -> Result<(), ProgramFault> {
        if self
            .legs
            .iter()
            .any(|leg| leg.open_orders != 0.0 || leg.position != 0.0)
        {
            return Err(ProgramFault::ProgramRejected);
        }
        self.legs.iter_mut().for_each(|leg| leg.order = None);
        self.mode = Mode::Halted;
        Ok(())
    }

    fn order_event(&mut self, event: (u64, u8, u8, f64, f64)) -> Result<(), ProgramFault> {
        let (handle, code, side, filled, price) = event;
        let leg = self
            .legs
            .iter()
            .position(|leg| leg.order.is_some_and(|order| order.handle == handle))
            .ok_or(ProgramFault::ProgramRejected)?;
        let mut order = self.legs[leg].order.ok_or(ProgramFault::ProgramRejected)?;
        if side != order.side as u8
            || !filled.is_finite()
            || filled < 0.0
            || !price.is_finite()
            || price < 0.0
        {
            return Err(ProgramFault::ProgramRejected);
        }
        let cumulative = order.filled + filled;
        let pre_repair =
            self.mode == Mode::Active || (self.mode == Mode::Draining && !self.drain_sent);
        let drain = match code {
            order_event::ACCEPTED if !order.accepted && filled == 0.0 => {
                order.accepted = true;
                false
            }
            order_event::FILLED
                if filled > 0.0 && (cumulative - order.quantity).abs() <= f64::EPSILON =>
            {
                order.filled = cumulative;
                false
            }
            order_event::REJECTED | order_event::CANCELED if filled == 0.0 && pre_repair => {
                self.mode == Mode::Active
            }
            order_event::PARTIALLY_FILLED
                if filled > 0.0 && cumulative < order.quantity && pre_repair =>
            {
                order.filled = cumulative;
                self.mode == Mode::Active
            }
            _ => return Err(ProgramFault::ProgramRejected),
        };
        self.legs[leg].order = (!matches!(
            code,
            order_event::FILLED | order_event::REJECTED | order_event::CANCELED
        ))
        .then_some(order);
        if drain {
            self.begin_draining();
        }
        Ok(())
    }
}

impl StrategyProgram for DualTsmom {
    fn on_start(
        &mut self,
        frame: &Frame<'_>,
        _actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        if self.parameters.is_some() {
            return Err(ProgramFault::MalformedFrame);
        }
        self.parameters = Some(Parameters::parse(frame.parameters())?);
        self.run_end = frame.run_scope.ok_or(ProgramFault::MalformedFrame)?.end_ns;
        Ok(())
    }

    fn on_frame(
        &mut self,
        frame: &Frame<'_>,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        self.parameters.ok_or(ProgramFault::MalformedFrame)?;
        let mut records = frame.records();
        let first = records.next().ok_or(ProgramFault::MalformedFrame)??;
        if first.meta.codec_version != 1 || first.meta.ts_event > first.meta.available_at {
            return Err(ProgramFault::MalformedFrame);
        }
        if first.meta.type_id == ORDER_EVENT_RECORD {
            if records.next().is_some() || !EXECUTABLES.contains(&first.meta.channel) {
                return Err(ProgramFault::MalformedFrame);
            }
            return self.order_event(first.order_event()?);
        }
        if first.meta.type_id != BAR_RECORD || !CHANNELS.contains(&first.meta.channel) {
            return Err(ProgramFault::MalformedFrame);
        }
        let values = first.f64s::<5>(BAR_RECORD)?;
        if !values.iter().all(|value| value.is_finite()) || values[3] <= 0.0 {
            return Err(ProgramFault::ProgramRejected);
        }
        let mut facts = [[0.0; 3]; 2];
        for leg in 0..2 {
            for (fact, record_type) in [POSITION_RECORD, ORDER_RECORD, BALANCE_RECORD]
                .into_iter()
                .enumerate()
            {
                let record = records.next().ok_or(ProgramFault::MalformedFrame)??;
                if record.meta.type_id != record_type
                    || record.meta.channel != EXECUTABLES[leg]
                    || record.meta.ts_event != first.meta.ts_event
                    || record.meta.available_at != first.meta.available_at
                {
                    return Err(ProgramFault::MalformedFrame);
                }
                facts[leg][fact] = record.scalar()?;
            }
            if facts[leg]
                .iter()
                .any(|value| !value.is_finite() || *value < 0.0)
            {
                return Err(ProgramFault::ProgramRejected);
            }
        }
        if records.next().is_some() || facts[BTC][2].to_bits() != facts[ETH][2].to_bits() {
            return Err(ProgramFault::MalformedFrame);
        }
        self.stage(
            first.meta.channel,
            Observation {
                close: values[3],
                ts: first.meta.ts_event,
                available: first.meta.available_at,
                snapshot: Snapshot {
                    positions: [facts[BTC][0], facts[ETH][0]],
                    open_orders: [facts[BTC][1], facts[ETH][1]],
                },
            },
            frame.decision_time_ns,
            actions,
        )
    }
}

export_strategy_program!(DualTsmom, DualTsmom::new());

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use std::vec::Vec;
    use strategy_factory_program_sdk::{
        CODEC_V1, FrameEncoder, RecordMeta, decode_actions, dispatch, order_event as oe,
    };

    fn parameter_bytes(coordinate: u8) -> [u8; 64] {
        let specs: [(u16, u16, u16); 5] =
            [(3, 60, 2), (2, 60, 2), (1, 60, 1), (3, 30, 2), (3, 90, 2)];
        let (features, lookback, persistence) = specs[usize::from(coordinate)];
        let mut bytes = [0; 64];
        bytes[..4].copy_from_slice(b"TSM1");
        bytes[4] = 1;
        bytes[5] = coordinate;
        bytes[6..8].copy_from_slice(&features.to_le_bytes());
        for (index, value) in [1_u32, 2, 1, 2, 3, 4].into_iter().enumerate() {
            bytes[8 + index * 4..12 + index * 4].copy_from_slice(&value.to_le_bytes());
        }
        bytes[32..34].copy_from_slice(&lookback.to_le_bytes());
        bytes[34..36].copy_from_slice(&persistence.to_le_bytes());
        bytes[40..48].copy_from_slice(&0.01_f64.to_le_bytes());
        bytes[48..56].copy_from_slice(&0.1_f64.to_le_bytes());
        bytes
    }

    fn seeded(coordinate: u8) -> DualTsmom {
        let mut program = DualTsmom::new();
        program.parameters = Some(Parameters::parse(&parameter_bytes(coordinate)).unwrap());
        program.run_end = 100 * D1_NS;
        program
    }

    fn snapshot(positions: [f64; 2], open_orders: [f64; 2]) -> Snapshot {
        Snapshot {
            positions,
            open_orders,
        }
    }

    fn observation(close: f64, ts: u64, available: u64, state: Snapshot) -> Observation {
        Observation {
            close,
            ts,
            available,
            snapshot: state,
        }
    }

    fn pair(close: [f64; 2], ts: u64, available: u64) -> (Observation, Observation) {
        let state = snapshot([0.0; 2], [0.0; 2]);
        (
            observation(close[BTC], ts, available, state),
            observation(close[ETH], ts, available, state),
        )
    }

    fn actions(
        operation: impl FnOnce(&mut ActionEncoder<'_>) -> Result<(), ProgramFault>,
    ) -> Result<Vec<Action>, ProgramFault> {
        let mut bytes = [0; 192];
        let mut encoder = ActionEncoder::new(&mut bytes);
        operation(&mut encoder)?;
        let length = encoder.finish();
        Ok(decode_actions(&bytes[..length])
            .unwrap()
            .map(Result::unwrap)
            .collect())
    }

    fn fields(action: &Action) -> (u32, u64, OrderSide, f64, bool, u32) {
        match action {
            Action::Submit {
                kind: OrderKind::Market,
                instrument,
                handle,
                side,
                quantity,
                reduce_only,
                decision_tag,
                price,
                trigger_price,
            } if *price == 0.0 && *trigger_price == 0.0 => (
                *instrument,
                *handle,
                *side,
                *quantity,
                *reduce_only,
                *decision_tag,
            ),
            _ => panic!("unexpected action"),
        }
    }

    fn dispatch_bar(
        program: &mut DualTsmom,
        channel: u32,
        ts: u64,
        available: u64,
        balances: [f64; 2],
        omit_last_balance: bool,
    ) -> Result<Vec<Action>, i32> {
        let mut frame_bytes = [0; 512];
        let mut frame = FrameEncoder::observation(&mut frame_bytes, available.max(ts)).unwrap();
        let meta = |type_id, bound| RecordMeta {
            type_id,
            codec_version: CODEC_V1,
            channel: bound,
            ts_event: ts,
            available_at: available,
        };
        let mut bar = [0; 40];
        for (index, value) in [100.0_f64, 100.0, 100.0, 100.0, 1.0]
            .into_iter()
            .enumerate()
        {
            bar[index * 8..index * 8 + 8].copy_from_slice(&value.to_le_bytes());
        }
        frame.push(meta(BAR_RECORD, channel), &bar).unwrap();
        let state = snapshot([0.0; 2], [0.0; 2]);
        for leg in 0..2 {
            for (record_type, value) in [
                (POSITION_RECORD, state.positions[leg]),
                (ORDER_RECORD, state.open_orders[leg]),
                (BALANCE_RECORD, balances[leg]),
            ] {
                if !(omit_last_balance && leg == ETH && record_type == BALANCE_RECORD) {
                    frame
                        .push(meta(record_type, EXECUTABLES[leg]), &value.to_le_bytes())
                        .unwrap();
                }
            }
        }
        let length = frame.finish();
        let mut output = [0; 192];
        let result = dispatch(program, &frame_bytes[..length], &mut output);
        if result < 0 {
            return Err(result);
        }
        Ok(decode_actions(&output[..result as usize])
            .unwrap()
            .map(Result::unwrap)
            .collect())
    }

    fn prime(program: &mut DualTsmom, count: usize) {
        for _ in 0..count {
            assert!(program.history.push([100.0; 2], count).is_none());
        }
    }

    fn bar(
        program: &mut DualTsmom,
        channel: u32,
        ts: u64,
        available: u64,
    ) -> Result<Vec<Action>, i32> {
        dispatch_bar(program, channel, ts, available, [1_000.0; 2], false)
    }

    fn first_frame(balances: [f64; 2], omit: bool) -> Result<Vec<Action>, i32> {
        dispatch_bar(&mut seeded(0), 1, D1_NS, D1_NS + 1, balances, omit)
    }

    fn stage_unit(
        program: &mut DualTsmom,
        channel: u32,
        ts: u64,
    ) -> Result<Vec<Action>, ProgramFault> {
        let value = observation(100.0, ts, ts + 1, snapshot([0.0; 2], [0.0; 2]));
        actions(|encoder| program.stage(channel, value, ts + 1, encoder))
    }

    fn ready_signal(program: &mut DualTsmom, signal: Signal) -> Vec<Action> {
        program.signal = Some(signal);
        program.h1_available = Some(signal.available + 1);
        actions(|encoder| program.consume(encoder)).unwrap()
    }

    fn signal(momentum: [f64; 2], enter: [bool; 2]) -> Signal {
        Signal {
            available: 10,
            momentum,
            enter,
        }
    }

    #[test]
    fn exact_abi_and_warmup_boundaries() {
        for coordinate in 0..5 {
            assert!(Parameters::parse(&parameter_bytes(coordinate)).is_ok());
        }
        for offset in 0..64 {
            let mut invalid = parameter_bytes(0);
            invalid[offset] ^= 1;
            assert!(Parameters::parse(&invalid).is_err(), "offset {offset}");
        }
        assert!(Parameters::parse(&parameter_bytes(0)[..63]).is_err());

        for (coordinate, lookback) in [(3, 30), (0, 60), (4, 90)] {
            let mut program = seeded(coordinate);
            prime(&mut program, lookback);
            program
                .complete_d1(pair([110.0; 2], D1_NS, D1_NS + 1))
                .unwrap();
            assert_eq!(program.signal.unwrap().enter, [false; 2]);
        }
        let mut no_persistence = seeded(2);
        prime(&mut no_persistence, 60);
        no_persistence
            .complete_d1(pair([110.0; 2], D1_NS, D1_NS + 1))
            .unwrap();
        assert_eq!(no_persistence.signal.unwrap().enter, [true; 2]);
        let mut full = seeded(0);
        prime(&mut full, 60);
        full.legs
            .iter_mut()
            .for_each(|leg| leg.previous_positive = true);
        full.complete_d1(pair([90.0; 2], 2 * D1_NS, 2 * D1_NS + 1))
            .unwrap();
        assert_eq!(full.signal.unwrap().enter, [false; 2]);
        full.signal = None;
        full.complete_d1(pair([120.0; 2], 3 * D1_NS, 3 * D1_NS + 1))
            .unwrap();
        assert_eq!(full.signal.unwrap().enter, [false; 2]);
    }

    #[test]
    fn every_callback_permutation_is_h1_consumed_and_strictly_later() {
        let ts = 2 * D1_NS;
        let mut reference = None;
        for a in 1..=4 {
            for b in 1..=4 {
                for c in 1..=4 {
                    for d in 1..=4 {
                        let schedule = [a, b, c, d];
                        if a == b || a == c || a == d || b == c || b == d || c == d {
                            continue;
                        }
                        let mut program = seeded(2);
                        prime(&mut program, 60);
                        program.history.closes.fill([90.0; 2]);
                        let mut emitted = Vec::new();
                        for channel in schedule {
                            let available = ts + if channel <= 2 { 1 } else { 2 };
                            let current = bar(&mut program, channel, ts, available).unwrap();
                            if channel <= 2 {
                                assert!(current.is_empty(), "D1 callback emitted for {schedule:?}");
                            }
                            emitted.extend(current);
                        }
                        if emitted.is_empty() {
                            emitted
                                .extend(bar(&mut program, 3, ts + H1_NS, ts + H1_NS + 1).unwrap());
                        }
                        assert_eq!(emitted.len(), 2, "schedule {schedule:?}");
                        if let Some(expected) = &reference {
                            assert_eq!(&emitted, expected);
                        } else {
                            reference = Some(emitted);
                        }
                    }
                }
            }
        }

        let mut delayed = seeded(2);
        prime(&mut delayed, 60);
        delayed.history.closes.fill([90.0; 2]);
        for (channel, clock) in [(3, ts), (4, ts), (3, ts + H1_NS)] {
            let emitted = bar(&mut delayed, channel, clock, clock + 10).unwrap();
            assert!(emitted.is_empty());
        }
        for channel in [1, 2] {
            assert!(bar(&mut delayed, channel, ts, ts + 10).unwrap().is_empty());
        }
        let later = bar(&mut delayed, 4, ts + H1_NS, ts + H1_NS + 10).unwrap();
        assert_eq!(later.len(), 2);
        assert_eq!(delayed.mode, Mode::Active);
    }

    #[test]
    fn host_frame_pairing_continuity_and_balance_fail_closed() {
        assert_eq!(
            first_frame([1_000.0; 2], true).unwrap_err(),
            ProgramFault::MalformedFrame as i32
        );
        assert!(first_frame([1_000.0, 999.0], false).is_err());
        let mut pending = opening();
        assert!(pending.reconcile(snapshot([0.0; 2], [1.0; 2])).is_ok());
        assert!(seeded(0).reconcile(snapshot([0.0; 2], [2.0, 0.0])).is_err());

        for (channel, ts) in [(1, D1_NS), (1, 2 * D1_NS), (2, 2 * D1_NS)] {
            let mut invalid = seeded(0);
            stage_unit(&mut invalid, 1, D1_NS).unwrap();
            assert!(stage_unit(&mut invalid, channel, ts).is_err());
        }
        let mut gap = seeded(0);
        stage_unit(&mut gap, 1, D1_NS).unwrap();
        stage_unit(&mut gap, 2, D1_NS).unwrap();
        assert!(stage_unit(&mut gap, 1, 3 * D1_NS).is_err());
    }

    #[test]
    fn independent_legs_and_feature_deletions_emit_exact_actions() {
        let mut full = seeded(0);
        full.legs[ETH].phase = Phase::Long;
        full.legs[ETH].position = QUANTITIES[ETH];
        let emitted = ready_signal(&mut full, signal([1.0, -0.1], [true, false]));
        assert_eq!(
            emitted.iter().map(fields).collect::<Vec<_>>(),
            [
                (1, 1, OrderSide::Buy, 0.01, false, 101),
                (2, 2, OrderSide::Sell, 0.1, true, 202),
            ]
        );

        let run_without_eth = |eth_momentum| {
            let mut program = seeded(1);
            ready_signal(&mut program, signal([1.0, eth_momentum], [true; 2]))
        };
        let positive = run_without_eth(1.0);
        let negative = run_without_eth(-1.0);
        assert_eq!(positive, negative);
        assert_eq!(positive.len(), 1);
        assert_eq!(fields(&positive[0]).0, 1);
    }

    fn opening() -> DualTsmom {
        let mut program = seeded(0);
        let emitted = ready_signal(&mut program, signal([1.0; 2], [true; 2]));
        assert_eq!(emitted.len(), 2);
        program
    }

    fn evt(program: &mut DualTsmom, case: (u64, u8, OrderSide, f64)) -> Result<(), ProgramFault> {
        program.order_event((case.0, case.1, case.2 as u8, case.3, 1.0))
    }

    fn buy(program: &mut DualTsmom, event: (u64, u8, f64)) -> Result<(), ProgramFault> {
        evt(program, (event.0, event.1, OrderSide::Buy, event.2))
    }

    #[test]
    fn order_events_global_drain_and_second_repair_fail_closed() {
        let mut duplicate = opening();
        buy(&mut duplicate, (1, oe::ACCEPTED, 0.0)).unwrap();
        assert!(buy(&mut duplicate, (1, oe::ACCEPTED, 0.0)).is_err());
        buy(&mut duplicate, (1, oe::PARTIALLY_FILLED, 0.004)).unwrap();
        buy(&mut duplicate, (1, oe::FILLED, 0.006)).unwrap();
        assert!(buy(&mut duplicate, (1, oe::FILLED, 0.01)).is_err());
        for case in [
            (99, OrderSide::Buy, 0.0),
            (1, OrderSide::Sell, 0.0),
            (1, OrderSide::Buy, 0.02),
        ] {
            let mut program = opening();
            assert!(evt(&mut program, (case.0, oe::FILLED, case.1, case.2)).is_err());
        }
        let mut draining = opening();
        buy(&mut draining, (1, oe::PARTIALLY_FILLED, 0.005)).unwrap();
        buy(&mut draining, (1, oe::CANCELED, 0.0)).unwrap();
        buy(&mut draining, (2, oe::REJECTED, 0.0)).unwrap();
        let mut reverse = opening();
        for leg in &mut reverse.legs {
            leg.phase = Phase::Closing;
            leg.order.as_mut().unwrap().side = OrderSide::Sell;
        }
        evt(&mut reverse, (2, oe::REJECTED, OrderSide::Sell, 0.0)).unwrap();
        let partial = (1, oe::PARTIALLY_FILLED, OrderSide::Sell, 0.005);
        evt(&mut reverse, partial).unwrap();
        evt(&mut reverse, (1, oe::FILLED, OrderSide::Sell, 0.005)).unwrap();
        assert_eq!(reverse.mode, Mode::Draining);
        let residual = [0.005, 0.1];
        draining.reconcile(snapshot(residual, [1.0; 2])).unwrap();
        draining.reconcile(snapshot(residual, [0.0; 2])).unwrap();
        let repairs = actions(|encoder| draining.drain(encoder)).unwrap();
        assert_eq!(fields(&repairs[BTC]).5, 301);
        assert_eq!(fields(&repairs[ETH]).5, 302);
        let repair_partial = (3, oe::PARTIALLY_FILLED, OrderSide::Sell, 0.001);
        assert!(evt(&mut draining, repair_partial).is_err());
        assert!(evt(&mut draining, (3, oe::REJECTED, OrderSide::Sell, 0.0)).is_err());
        draining.legs[BTC].position = 0.001;
        draining.legs[ETH].position = 0.0;
        assert!(actions(|encoder| draining.drain(encoder)).is_err());

        let mut recovered = opening();
        buy(&mut recovered, (1, oe::PARTIALLY_FILLED, 0.005)).unwrap();
        recovered
            .reconcile(snapshot([0.005, 0.0], [0.0; 2]))
            .unwrap();
        let repair = actions(|encoder| recovered.drain(encoder)).unwrap();
        let handle = fields(&repair[0]).1;
        evt(&mut recovered, (handle, oe::FILLED, OrderSide::Sell, 0.005)).unwrap();
        recovered.reconcile(snapshot([0.0; 2], [0.0; 2])).unwrap();
        let final_actions = actions(|encoder| recovered.drain(encoder)).unwrap();
        assert!(final_actions.is_empty());
    }

    #[test]
    fn terminal_backlog_never_opens_and_residual_final_state_rejects() {
        for ts in [10 * H1_NS, 11 * H1_NS] {
            let mut program = seeded(2);
            program.run_end = 11 * H1_NS;
            program.signal = Some(signal([1.0; 2], [true; 2]));
            program.h1_available = Some(2);
            for channel in [3, 4] {
                assert!(bar(&mut program, channel, ts, ts + 1).unwrap().is_empty());
            }
            assert!(program.legs.iter().all(|leg| leg.phase != Phase::Opening));
        }
        let mut terminal = seeded(0);
        terminal.legs[BTC].open_orders = 1.0;
        assert!(actions(|encoder| terminal.terminal(encoder)).is_err());
        terminal.legs[BTC].open_orders = 0.0;
        terminal.legs[BTC].phase = Phase::Long;
        terminal.legs[BTC].position = 0.01;
        let closes = actions(|encoder| terminal.terminal(encoder)).unwrap();
        assert_eq!(fields(&closes[0]).5, 211);
        assert_eq!(terminal.halt(), Err(ProgramFault::ProgramRejected));
        terminal.legs[BTC].position = 0.0;
        assert!(terminal.halt().is_ok());
    }
}
