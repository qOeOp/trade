#![no_std]

#[cfg(not(test))]
use core::panic::PanicInfo;
use strategy_factory_program_sdk::{
    Action, ActionEncoder, BALANCE_RECORD, BAR_RECORD, Frame, ORDER_EVENT_RECORD, ORDER_RECORD,
    OrderKind, OrderSide, POSITION_RECORD, ProgramFault, StrategyProgram, export_strategy_program,
    order_event,
};

const LEGS: usize = 3;
const D1_NS: u64 = 86_400_000_000_000;
const H1_NS: u64 = 3_600_000_000_000;
const EXECUTABLES: [u32; LEGS] = [1, 2, 3];
const CHANNELS: [u32; 2 * LEGS] = [1, 2, 3, 4, 5, 6];
const QUANTITIES: [f64; LEGS] = [0.01, 0.3, 7.0];
const OPEN_TAGS: [u32; LEGS] = [101, 102, 103];
const CLOSE_TAGS: [u32; LEGS] = [201, 202, 203];
const STOP_TAGS: [u32; LEGS] = [221, 222, 223];
const TERMINAL_TAGS: [u32; LEGS] = [211, 212, 213];
const DRAIN_TAGS: [u32; LEGS] = [301, 302, 303];
const RING: usize = 101;
/// (entry lookback, exit lookback): coordinate 0 is the primary, 1 and 2 are nonselectable sensitivities.
const COORDINATES: [(u16, u16); 3] = [(50, 20), (100, 50), (20, 10)];
const ATR_DAYS: u16 = 20;
const STOP_ATR_TENTHS: u16 = 20;

#[derive(Clone, Copy)]
struct Parameters {
    entry: usize,
    exit: usize,
    stop_atr: f64,
}

impl Parameters {
    fn expected(coordinate: u8) -> Option<[u8; 64]> {
        let &(entry, exit) = COORDINATES.get(usize::from(coordinate))?;
        let mut bytes = [0; 64];
        bytes[..4].copy_from_slice(b"MTB1");
        bytes[4] = 1;
        bytes[5] = coordinate;
        bytes[6..8].copy_from_slice(&entry.to_le_bytes());
        bytes[8..10].copy_from_slice(&exit.to_le_bytes());
        bytes[10..12].copy_from_slice(&ATR_DAYS.to_le_bytes());
        bytes[12..14].copy_from_slice(&STOP_ATR_TENTHS.to_le_bytes());

        for (index, value) in EXECUTABLES.iter().chain(CHANNELS.iter()).enumerate() {
            let value = u16::try_from(*value).ok()?;
            bytes[16 + index * 2..18 + index * 2].copy_from_slice(&value.to_le_bytes());
        }

        for (index, quantity) in QUANTITIES.iter().enumerate() {
            bytes[40 + index * 8..48 + index * 8].copy_from_slice(&quantity.to_le_bytes());
        }
        Some(bytes)
    }

    fn parse(bytes: &[u8]) -> Result<Self, ProgramFault> {
        if bytes.len() != 64 {
            return Err(ProgramFault::MalformedFrame);
        }
        let expected = Self::expected(bytes[5]).ok_or(ProgramFault::ProgramRejected)?;
        if bytes != expected {
            return Err(ProgramFault::ProgramRejected);
        }
        let (entry, exit) = COORDINATES[usize::from(bytes[5])];
        Ok(Self {
            entry: usize::from(entry),
            exit: usize::from(exit),
            stop_atr: f64::from(STOP_ATR_TENTHS) / 10.0,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bar {
    high: f64,
    low: f64,
    close: f64,
}

#[derive(Clone, Copy)]
struct Observation {
    bar: Bar,
    ts: u64,
    available: u64,
    snapshot: Snapshot,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Snapshot {
    positions: [f64; LEGS],
    open_orders: [f64; LEGS],
}

/// One leg's completed daily closes (a ring) and its Wilder ATR, both known at the last daily close.
#[derive(Clone, Copy)]
struct History {
    closes: [f64; RING],
    count: usize,
    next: usize,
    atr: f64,
    previous_close: f64,
}

impl History {
    const EMPTY: Self = Self {
        closes: [0.0; RING],
        count: 0,
        next: 0,
        atr: 0.0,
        previous_close: 0.0,
    };

    /// Extreme of the `days` closes before the current one, if that many are known.
    fn prior(&self, days: usize, highest: bool) -> Option<f64> {
        (self.count >= days).then(|| {
            (1..=days)
                .map(|back| self.closes[(self.next + RING - back) % RING])
                .fold(if highest { f64::MIN } else { f64::MAX }, |acc, value| {
                    if highest {
                        acc.max(value)
                    } else {
                        acc.min(value)
                    }
                })
        })
    }

    fn push(&mut self, bar: Bar) {
        let range = if self.count == 0 {
            bar.high - bar.low
        } else {
            (bar.high - bar.low)
                .max((bar.high - self.previous_close).abs())
                .max((bar.low - self.previous_close).abs())
        };
        self.atr = if self.count == 0 {
            range
        } else {
            self.atr + (range - self.atr) / f64::from(ATR_DAYS)
        };
        self.previous_close = bar.close;
        self.closes[self.next] = bar.close;
        self.next = (self.next + 1) % RING;
        self.count = (self.count + 1).min(RING);
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
    notional: f64,
    accepted: bool,
}

#[derive(Clone, Copy)]
struct Leg {
    phase: Phase,
    position: f64,
    open_orders: f64,
    /// Stop distance fixed at the entry signal (stop_atr x ATR), applied to the average entry fill.
    stop_distance: f64,
    stop: f64,
    order: Option<Outstanding>,
}

impl Leg {
    const EMPTY: Self = Self {
        phase: Phase::Flat,
        position: 0.0,
        open_orders: 0.0,
        stop_distance: 0.0,
        stop: 0.0,
        order: None,
    };
}

#[derive(Clone, Copy)]
struct Signal {
    available: u64,
    enter: [bool; LEGS],
    exit: [bool; LEGS],
    stop_distance: [f64; LEGS],
}

struct MajorsTrend {
    parameters: Option<Parameters>,
    run_end: u64,
    staged_d1: [Option<Observation>; LEGS],
    staged_h1: [Option<Observation>; LEGS],
    watermarks: [(u64, u64); 2 * LEGS],
    history: [History; LEGS],
    legs: [Leg; LEGS],
    mode: Mode,
    signal: Option<Signal>,
    h1_available: Option<u64>,
    next_handle: u64,
    drain_sent: bool,
}

impl MajorsTrend {
    const fn new() -> Self {
        Self {
            parameters: None,
            run_end: 0,
            staged_d1: [None; LEGS],
            staged_h1: [None; LEGS],
            watermarks: [(0, 0); 2 * LEGS],
            history: [History::EMPTY; LEGS],
            legs: [Leg::EMPTY; LEGS],
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
        let cadence = if slot < LEGS { D1_NS } else { H1_NS };
        let (last_ts, last_available) = self.watermarks[slot];
        if observation.ts <= last_ts
            || observation.available < last_available
            || (last_ts != 0 && observation.ts.checked_sub(last_ts) != Some(cadence))
        {
            return Err(ProgramFault::ProgramRejected);
        }

        if slot >= LEGS
            && self.staged_h1.iter().all(Option::is_none)
            && decision_time < self.run_end
            && observation
                .ts
                .checked_add(H1_NS)
                .is_some_and(|next| next < self.run_end)
        {
            self.consume(None, actions)?;
        }
        let (staged, leg) = if slot < LEGS {
            (&mut self.staged_d1, slot)
        } else {
            (&mut self.staged_h1, slot - LEGS)
        };

        if staged[leg].is_some() {
            return Err(ProgramFault::ProgramRejected);
        }
        self.watermarks[slot] = (observation.ts, observation.available);
        staged[leg] = Some(observation);
        if staged.iter().any(Option::is_none) {
            return Ok(());
        }
        let complete = staged.map(|value| value.unwrap());
        if complete.iter().any(|value| value.ts != complete[0].ts) {
            return Err(ProgramFault::ProgramRejected);
        }
        *staged = [None; LEGS];

        if slot < LEGS {
            self.complete_d1(complete)
        } else {
            self.complete_h1(complete, decision_time, actions)
        }
    }

    fn complete_d1(&mut self, days: [Observation; LEGS]) -> Result<(), ProgramFault> {
        if self.signal.is_some() {
            return Err(ProgramFault::ProgramRejected);
        }
        let parameters = self.parameters.ok_or(ProgramFault::MalformedFrame)?;
        let mut signal = Signal {
            available: days.iter().map(|day| day.available).max().unwrap_or(0),
            enter: [false; LEGS],
            exit: [false; LEGS],
            stop_distance: [0.0; LEGS],
        };

        for (leg, day) in days.iter().enumerate() {
            let history = &mut self.history[leg];
            let close = day.bar.close;
            let high = history.prior(parameters.entry, true);
            let low = history.prior(parameters.exit, false);
            history.push(day.bar);
            signal.enter[leg] = high.is_some_and(|value| close > value);
            signal.exit[leg] = low.is_some_and(|value| close < value);
            signal.stop_distance[leg] = parameters.stop_atr * history.atr;
            if !signal.stop_distance[leg].is_finite() || signal.stop_distance[leg] < 0.0 {
                return Err(ProgramFault::ProgramRejected);
            }
        }
        self.signal = Some(signal);
        Ok(())
    }

    fn complete_h1(
        &mut self,
        hours: [Observation; LEGS],
        decision_time: u64,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        if hours.iter().any(|hour| hour.snapshot != hours[0].snapshot) {
            return Err(ProgramFault::ProgramRejected);
        }
        self.reconcile(hours[0].snapshot)?;
        let ts = hours[0].ts;
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
        self.h1_available = Some(hours.iter().map(|hour| hour.available).max().unwrap_or(0));
        self.consume(Some(hours.map(|hour| hour.bar.low)), actions)
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
                    let order = self.legs[leg].order.ok_or(ProgramFault::ProgramRejected)?;
                    if order.filled != quantity {
                        continue; // the fill event has not arrived yet; its price sets the stop
                    }

                    if order.notional <= 0.0 {
                        return Err(ProgramFault::ProgramRejected);
                    }
                    let entry = order.notional / order.filled;
                    self.legs[leg].stop = entry - self.legs[leg].stop_distance;
                    self.legs[leg].phase = Phase::Long;
                    self.legs[leg].order = None;
                }
                Phase::Opening if open_orders == 0.0 => anomaly = true,
                Phase::Opening => {}
                Phase::Long if position <= 0.0 || open_orders != 0.0 => {
                    return Err(ProgramFault::ProgramRejected);
                }
                Phase::Closing if open_orders == 0.0 && position == 0.0 => {
                    self.legs[leg] = Leg::EMPTY;
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

    /// Acts on a pending daily signal once a complete hour is strictly later than it, and on the stop of every long
    /// leg whose latest hourly low reached it. Each leg emits at most one order, so a frame never exceeds three.
    fn consume(
        &mut self,
        lows: Option<[f64; LEGS]>,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let ready = match (self.signal, self.h1_available) {
            (Some(signal), Some(h1_available)) if h1_available > signal.available => Some(signal),
            _ => None,
        };

        if ready.is_some() {
            self.signal = None;
            self.h1_available = None;
        }

        if self.mode != Mode::Active {
            return Ok(());
        }

        for leg in 0..LEGS {
            let stopped = lows.is_some_and(|lows| lows[leg] <= self.legs[leg].stop);
            match self.legs[leg].phase {
                Phase::Long if stopped => {
                    self.close(leg, STOP_TAGS[leg], actions)?;
                }
                Phase::Long if ready.is_some_and(|signal| signal.exit[leg]) => {
                    self.close(leg, CLOSE_TAGS[leg], actions)?;
                }
                Phase::Flat if ready.is_some_and(|signal| signal.enter[leg]) => {
                    let signal = ready.ok_or(ProgramFault::ProgramRejected)?;
                    self.submit(
                        leg,
                        OrderSide::Buy,
                        QUANTITIES[leg],
                        false,
                        OPEN_TAGS[leg],
                        actions,
                    )?;
                    self.legs[leg].stop_distance = signal.stop_distance[leg];
                    self.legs[leg].phase = Phase::Opening;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn close(
        &mut self,
        leg: usize,
        tag: u32,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        self.submit(
            leg,
            OrderSide::Sell,
            self.legs[leg].position,
            true,
            tag,
            actions,
        )?;
        self.legs[leg].phase = Phase::Closing;
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
            notional: 0.0,
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
                self.close(leg, tag, actions)?;
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
                self.close(leg, tag, actions)?;
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
        // an opening order kept only for its fill price takes no further event
        if order.filled == order.quantity
            || side != order.side as u8
            || !filled.is_finite()
            || filled < 0.0
            || !price.is_finite()
            || price < 0.0
            || (filled > 0.0 && price <= 0.0)
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
                order.filled = order.quantity;
                order.notional += filled * price;
                false
            }
            order_event::REJECTED | order_event::CANCELED if filled == 0.0 && pre_repair => {
                self.mode == Mode::Active
            }
            order_event::PARTIALLY_FILLED
                if filled > 0.0 && cumulative < order.quantity && pre_repair =>
            {
                order.filled = cumulative;
                order.notional += filled * price;
                self.mode == Mode::Active
            }
            _ => return Err(ProgramFault::ProgramRejected),
        };
        // a completed opening fill stays on the leg until reconcile turns it into the long position and its stop
        let keep = match code {
            order_event::FILLED => {
                order.side == OrderSide::Buy && self.legs[leg].phase == Phase::Opening
            }
            order_event::REJECTED | order_event::CANCELED => false,
            _ => true,
        };
        self.legs[leg].order = keep.then_some(order);

        if drain {
            self.begin_draining();
        }
        Ok(())
    }
}

impl StrategyProgram for MajorsTrend {
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
        if !values.iter().all(|value| value.is_finite())
            || values[3] <= 0.0
            || values[2] <= 0.0
            || values[1] < values[2]
        {
            return Err(ProgramFault::ProgramRejected);
        }
        let mut facts = [[0.0; 3]; LEGS];

        for (leg, executable) in EXECUTABLES.iter().enumerate() {
            for (fact, record_type) in [POSITION_RECORD, ORDER_RECORD, BALANCE_RECORD]
                .into_iter()
                .enumerate()
            {
                let record = records.next().ok_or(ProgramFault::MalformedFrame)??;
                if record.meta.type_id != record_type
                    || record.meta.channel != *executable
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

        if records.next().is_some()
            || facts
                .iter()
                .any(|leg| leg[2].to_bits() != facts[0][2].to_bits())
        {
            return Err(ProgramFault::MalformedFrame);
        }
        self.stage(
            first.meta.channel,
            Observation {
                bar: Bar {
                    high: values[1],
                    low: values[2],
                    close: values[3],
                },
                ts: first.meta.ts_event,
                available: first.meta.available_at,
                snapshot: Snapshot {
                    positions: facts.map(|leg| leg[0]),
                    open_orders: facts.map(|leg| leg[1]),
                },
            },
            frame.decision_time_ns,
            actions,
        )
    }
}

export_strategy_program!(MajorsTrend, MajorsTrend::new());

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(test)]
mod tests;
