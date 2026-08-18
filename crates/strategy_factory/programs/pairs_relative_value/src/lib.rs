#![no_std]
#[cfg(not(test))]
use core::panic::PanicInfo;
use strategy_factory_program_sdk::{
    Action, ActionEncoder, BALANCE_RECORD, BAR_RECORD, Frame, ORDER_EVENT_RECORD, ORDER_RECORD,
    OrderKind, OrderSide, POSITION_RECORD, ProgramFault, StrategyProgram, export_strategy_program,
    order_event,
};
use vibe_indicators_kernel::population_std_with_mean;

const BTC: usize = 0;
const ETH: usize = 1;
const M15_NS: u64 = 900_000_000_000;
const H1_REGIME: u16 = 1;
const ROLLING_VARIANCE: u16 = 2;
const CONVERGENCE: u16 = 4;
const ETH_LEG: u16 = 8;
const ALL_FEATURES: u16 = 15;
// Tags: entry long/short; convergence/max-hold/regime/terminal close; BTC/ETH/both repair; flat.
const ENTRY_LONG_SPREAD: u32 = 101;
const ENTRY_SHORT_SPREAD: u32 = 102;
const CONVERGENCE_CLOSE: u32 = 201;
const MAX_HOLD_CLOSE: u32 = 202;
const REGIME_CLOSE: u32 = 203;
const TERMINAL_CLOSE: u32 = 204;
const REPAIR_BTC: u32 = 301;
const REPAIR_ETH: u32 = 302;
const REPAIR_BOTH: u32 = 303;
const FLAT_CONFIRMED: u32 = 401;
const ENTRY_HANDLES: [u64; 2] = [0x1_001, 0x1_002];
const CLOSE_HANDLES: [u64; 2] = [0x2_001, 0x2_002];
const REPAIR_HANDLES: [u64; 2] = [0x3_001, 0x3_002];
const REPAIR_FROM_NONE: u8 = 0;
const REPAIR_FROM_OPENING: u8 = 1;
const REPAIR_FROM_CLOSING: u8 = 2;
#[derive(Clone, Copy)]
struct Parameters {
    variant: u8,
    features: u16,
    executables: [u32; 2],
    channels: [u32; 4],
    window: usize,
    max_hold: u16,
    entry_z: f64,
    exit_z: f64,
    gross: f64,
}
impl Parameters {
    fn parse(bytes: &[u8]) -> Result<Self, ProgramFault> {
        if bytes.len() != 96 || bytes[..4] != *b"PRV1" || bytes[4] != 1 || bytes[48..] != [0; 48] {
            return Err(ProgramFault::MalformedFrame);
        }
        let result = Self {
            variant: bytes[5],
            features: read_u16(bytes, 6)?,
            executables: [read_u32(bytes, 8)?, read_u32(bytes, 12)?],
            channels: [
                read_u32(bytes, 16)?,
                read_u32(bytes, 20)?,
                read_u32(bytes, 24)?,
                read_u32(bytes, 28)?,
            ],
            window: usize::from(read_u16(bytes, 32)?),
            max_hold: read_u16(bytes, 34)?,
            entry_z: f64::from(read_u16(bytes, 36)?) / 1_000.0,
            exit_z: f64::from(read_u16(bytes, 38)?) / 1_000.0,
            gross: read_f64(bytes, 40)?,
        };
        let coordinates: [(usize, u16, f64, f64); 4] = [
            (32, 96, 2.0, 0.5),
            (32, 96, 2.5, 0.5),
            (64, 192, 2.0, 0.75),
            (64, 192, 2.5, 0.75),
        ];
        let allowed_features = result.features == ALL_FEATURES
            || [H1_REGIME, ROLLING_VARIANCE, CONVERGENCE, ETH_LEG]
                .iter()
                .any(|feature| result.features == ALL_FEATURES & !feature);
        let coordinate = coordinates.get(usize::from(result.variant));
        if result.executables != [1, 2]
            || result.channels != [1, 2, 3, 4]
            || result.gross.to_bits() != 2_000_f64.to_bits()
            || !allowed_features
            || coordinate.is_none_or(|&(window, hold, entry, exit)| {
                (result.window, result.max_hold) != (window, hold)
                    || result.entry_z.to_bits() != entry.to_bits()
                    || result.exit_z.to_bits() != exit.to_bits()
            })
        {
            return Err(ProgramFault::ProgramRejected);
        }
        Ok(result)
    }

    fn enabled(self, feature: u16) -> bool {
        self.features & feature != 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bar {
    close: f64,
    ts: u64,
    available: u64,
}

impl Bar {
    fn parse(values: [f64; 5], ts: u64, available: u64) -> Result<Self, ProgramFault> {
        if !values.iter().all(|value| value.is_finite())
            || values[2] <= 0.0
            || values[1] < values[2]
            || !(values[2]..=values[1]).contains(&values[0])
            || !(values[2]..=values[1]).contains(&values[3])
        {
            return Err(ProgramFault::ProgramRejected);
        }
        Ok(Self {
            close: values[3],
            ts,
            available,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Flat,
    Opening,
    Open,
    Closing,
    Repairing,
    Halted,
}

struct PairRing {
    values: [f64; 64],
    count: usize,
    next: usize,
}

impl PairRing {
    const fn new() -> Self {
        Self {
            values: [0.0; 64],
            count: 0,
            next: 0,
        }
    }

    fn push(&mut self, value: f64, window: usize) -> Result<Option<(f64, f64)>, ProgramFault> {
        if !value.is_finite() || value <= 0.0 {
            return Err(ProgramFault::ProgramRejected);
        }
        self.values[self.next] = value;
        self.next = (self.next + 1) % window;
        self.count = (self.count + 1).min(window);
        if self.count < window {
            return Ok(None);
        }
        let mean = self.values[..window].iter().sum::<f64>() / window as f64;
        let deviation = population_std_with_mean(self.values[..window].iter().copied(), mean);
        Ok((deviation.is_finite() && deviation > 0.0)
            .then_some(((value - mean) / deviation, deviation)))
    }
}

struct Snapshot {
    positions: [f64; 2],
    pending: [f64; 2],
}

struct PairsRelativeValue {
    parameters: Option<Parameters>,
    run_end: u64,
    staged_m15: [Option<Bar>; 2],
    staged_h1: [Option<Bar>; 2],
    completed_m15: Option<[Bar; 2]>,
    h1_current: Option<[Bar; 2]>,
    h1_regimes: [Option<(u64, bool)>; 2],
    watermarks: [(u64, u64); 4],
    ring: PairRing,
    phase: Phase,
    positions: [f64; 2],
    pending: [f64; 2],
    quantities: [f64; 2],
    signs: [i8; 2],
    fill_mask: u8,
    entry_clock: u64,
    close_clock: u64,
    repair_clock: u64,
    hold: u16,
    repair_sent: bool,
    repair_mask: u8,
    repair_from: u8,
}

impl PairsRelativeValue {
    const fn new() -> Self {
        Self {
            parameters: None,
            run_end: 0,
            staged_m15: [None; 2],
            staged_h1: [None; 2],
            completed_m15: None,
            h1_current: None,
            h1_regimes: [None; 2],
            watermarks: [(0, 0); 4],
            ring: PairRing::new(),
            phase: Phase::Flat,
            positions: [0.0; 2],
            pending: [0.0; 2],
            quantities: [0.0; 2],
            signs: [0; 2],
            fill_mask: 0,
            entry_clock: 0,
            close_clock: 0,
            repair_clock: 0,
            hold: 0,
            repair_sent: false,
            repair_mask: 0,
            repair_from: REPAIR_FROM_NONE,
        }
    }

    fn parameters(&self) -> Result<Parameters, ProgramFault> {
        self.parameters.ok_or(ProgramFault::MalformedFrame)
    }

    fn observe_bar(&mut self, channel: u32, bar: Bar) -> Result<(), ProgramFault> {
        let parameters = self.parameters()?;
        let slot = parameters
            .channels
            .iter()
            .position(|bound| *bound == channel)
            .ok_or(ProgramFault::MalformedFrame)?;
        let (previous_ts, previous_available) = self.watermarks[slot];
        if bar.ts <= previous_ts || bar.available < previous_available {
            return Err(ProgramFault::ProgramRejected);
        }
        self.watermarks[slot] = (bar.ts, bar.available);
        let (staged, leg) = if slot < 2 {
            (&mut self.staged_m15, slot)
        } else {
            (&mut self.staged_h1, slot - 2)
        };
        let other = 1 - leg;
        if staged[other].is_some_and(|other_bar| other_bar.ts != bar.ts) {
            return Err(ProgramFault::ProgramRejected);
        }
        staged[leg] = Some(bar);
        if let [Some(btc), Some(eth)] = *staged {
            *staged = [None; 2];

            if slot < 2 {
                if self.completed_m15.is_some() {
                    return Err(ProgramFault::ProgramRejected);
                }
                self.completed_m15 = Some([btc, eth]);
            } else {
                if let Some(previous) = self.h1_current {
                    let returns = [
                        btc.close / previous[BTC].close - 1.0,
                        eth.close / previous[ETH].close - 1.0,
                    ];
                    let valid = returns
                        .iter()
                        .all(|value| value.is_finite() && value.abs() <= 0.25)
                        && returns[BTC] * returns[ETH] >= 0.0;
                    self.h1_regimes[0] = self.h1_regimes[1];
                    self.h1_regimes[1] = Some((btc.ts, valid));
                }
                self.h1_current = Some([btc, eth]);
            }
        }
        Ok(())
    }

    fn h1_valid_at(&self, clock: u64) -> bool {
        self.h1_regimes
            .iter()
            .rev()
            .flatten()
            .find(|(ts, _)| *ts < clock)
            .is_some_and(|(_, valid)| *valid)
    }

    fn reconcile(
        &mut self,
        snapshot: Snapshot,
        clock: u64,
        decision_clock: bool,
    ) -> Result<(), ProgramFault> {
        self.positions = snapshot.positions;
        self.pending = snapshot.pending;
        let flat = self.positions == [0.0; 2] && self.pending == [0.0; 2];

        match self.phase {
            Phase::Opening => {
                let signed = (0..2).all(|leg| {
                    self.positions[leg] != 0.0
                        && self.positions[leg].is_sign_positive() == (self.signs[leg] > 0)
                });

                if self.fill_mask == 3 && signed && self.pending == [0.0; 2] {
                    self.phase = Phase::Open;
                    self.hold = 0;
                } else if decision_clock
                    && clock > self.entry_clock
                    && (self.pending == [0.0; 2] || !signed)
                {
                    self.begin_repair(REPAIR_FROM_OPENING);
                }
            }
            Phase::Open => {
                let signed = (0..2).all(|leg| {
                    self.positions[leg] != 0.0
                        && self.positions[leg].is_sign_positive() == (self.signs[leg] > 0)
                });

                if !signed || self.pending != [0.0; 2] {
                    self.begin_repair(REPAIR_FROM_NONE);
                }
            }
            Phase::Closing if flat => self.halt(),
            Phase::Closing if decision_clock && clock > self.close_clock => {
                self.begin_repair(REPAIR_FROM_CLOSING);
            }
            Phase::Repairing if flat => self.halt(),
            Phase::Repairing if self.repair_sent && decision_clock && clock > self.repair_clock => {
                return Err(ProgramFault::ProgramRejected);
            }
            _ => {}
        }
        Ok(())
    }

    fn halt(&mut self) {
        self.phase = Phase::Halted;
        let _ = FLAT_CONFIRMED;
    }

    fn begin_repair(&mut self, source: u8) {
        self.phase = Phase::Repairing;
        self.repair_from = source;
    }

    fn submit(
        instrument: u32,
        handle: u64,
        side: OrderSide,
        quantity: f64,
        reduce_only: bool,
        tag: u32,
    ) -> Action {
        Action::Submit {
            kind: OrderKind::Market,
            instrument,
            handle,
            side,
            quantity,
            price: 0.0,
            trigger_price: 0.0,
            reduce_only,
            decision_tag: tag,
        }
    }

    fn enter(
        &mut self,
        pair: [Bar; 2],
        spread_side: i8,
        clock: u64,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let parameters = self.parameters()?;
        if !parameters.enabled(ETH_LEG) {
            return Ok(());
        }
        self.quantities = [
            round_six(parameters.gross * 0.5 / pair[BTC].close)?,
            round_six(parameters.gross * 0.5 / pair[ETH].close)?,
        ];
        self.signs = [spread_side, -spread_side];
        let tag = if spread_side > 0 {
            ENTRY_LONG_SPREAD
        } else {
            ENTRY_SHORT_SPREAD
        };

        for (leg, &handle) in ENTRY_HANDLES.iter().enumerate() {
            actions.push(Self::submit(
                parameters.executables[leg],
                handle,
                side(self.signs[leg]),
                self.quantities[leg],
                false,
                tag,
            ))?;
        }
        self.phase = Phase::Opening;
        self.entry_clock = clock;
        self.fill_mask = 0;
        Ok(())
    }

    fn close(
        &mut self,
        tag: u32,
        clock: u64,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let parameters = self.parameters()?;
        let mut emitted = false;

        for (leg, &handle) in CLOSE_HANDLES.iter().enumerate() {
            if self.positions[leg] != 0.0 {
                actions.push(Self::submit(
                    parameters.executables[leg],
                    handle,
                    side(if self.positions[leg] > 0.0 { -1 } else { 1 }),
                    self.positions[leg].abs(),
                    true,
                    tag,
                ))?;
                emitted = true;
            }
        }

        if !emitted {
            return Err(ProgramFault::ProgramRejected);
        }
        self.phase = Phase::Closing;
        self.close_clock = clock;
        Ok(())
    }

    fn repair(&mut self, clock: u64, actions: &mut ActionEncoder<'_>) -> Result<(), ProgramFault> {
        if self.repair_sent {
            return Err(ProgramFault::ProgramRejected);
        }

        if self.pending != [0.0; 2] {
            return Ok(());
        }
        let parameters = self.parameters()?;
        let legs = [self.positions[BTC] != 0.0, self.positions[ETH] != 0.0];
        let tag = match legs {
            [true, true] => REPAIR_BOTH,
            [true, false] => REPAIR_BTC,
            [false, true] => REPAIR_ETH,
            [false, false] if self.pending != [0.0; 2] => return Ok(()),
            [false, false] => {
                self.halt();
                return Ok(());
            }
        };

        for (leg, &handle) in REPAIR_HANDLES.iter().enumerate() {
            if legs[leg] {
                actions.push(Self::submit(
                    parameters.executables[leg],
                    handle,
                    side(if self.positions[leg] > 0.0 { -1 } else { 1 }),
                    self.positions[leg].abs(),
                    true,
                    tag,
                ))?;
            }
        }
        self.repair_sent = true;
        self.repair_mask = u8::from(legs[BTC]) | (u8::from(legs[ETH]) << 1);
        self.repair_clock = clock;
        Ok(())
    }

    fn decide(&mut self, clock: u64, actions: &mut ActionEncoder<'_>) -> Result<(), ProgramFault> {
        let parameters = self.parameters()?;

        if self.phase == Phase::Repairing {
            return self.repair(clock, actions);
        }
        let completed = match self.completed_m15 {
            Some(pair) if pair[BTC].ts < clock => {
                self.completed_m15 = None;
                Some(pair)
            }
            _ => None,
        };

        if clock
            .checked_add(M15_NS)
            .is_none_or(|next| next >= self.run_end)
        {
            return match self.phase {
                Phase::Open => self.close(TERMINAL_CLOSE, clock, actions),
                Phase::Flat | Phase::Halted => Ok(()),
                _ => Err(ProgramFault::ProgramRejected),
            };
        }
        let Some(pair) = completed else {
            return Ok(());
        };
        let ratio = pair[BTC].close / pair[ETH].close;
        let statistic = self.ring.push(ratio, parameters.window)?;

        if self.phase == Phase::Open {
            self.hold = self.hold.saturating_add(1);
            let tag = if parameters.enabled(H1_REGIME) && !self.h1_valid_at(clock) {
                Some(REGIME_CLOSE)
            } else if self.hold >= parameters.max_hold {
                Some(MAX_HOLD_CLOSE)
            } else if parameters.enabled(CONVERGENCE)
                && statistic.is_some_and(|(z, _)| z.abs() <= parameters.exit_z)
            {
                Some(CONVERGENCE_CLOSE)
            } else {
                None
            };
            return tag.map_or(Ok(()), |tag| self.close(tag, clock, actions));
        }

        if self.phase != Phase::Flat
            || !parameters.enabled(ETH_LEG)
            || (parameters.enabled(H1_REGIME) && !self.h1_valid_at(clock))
        {
            return Ok(());
        }
        let Some((z, deviation)) = statistic else {
            return Ok(());
        };

        if parameters.enabled(ROLLING_VARIANCE) && deviation < 1e-6 {
            return Ok(());
        }

        if z.abs() >= parameters.entry_z {
            self.enter(pair, if z < 0.0 { 1 } else { -1 }, clock, actions)?;
        }
        Ok(())
    }

    fn order_event(&mut self, event: (u64, u8, u8, f64, f64)) -> Result<(), ProgramFault> {
        let (handle, code, event_side, filled, price) = event;
        let (handles, expected_sides) = match self.phase {
            Phase::Opening => (ENTRY_HANDLES, self.signs),
            Phase::Closing => (CLOSE_HANDLES, [-self.signs[BTC], -self.signs[ETH]]),
            Phase::Repairing if self.repair_sent => (
                REPAIR_HANDLES,
                [
                    1 - 2 * i8::from(self.positions[BTC] > 0.0),
                    1 - 2 * i8::from(self.positions[ETH] > 0.0),
                ],
            ),
            Phase::Repairing if self.repair_from == REPAIR_FROM_OPENING => {
                (ENTRY_HANDLES, self.signs)
            }
            Phase::Repairing if self.repair_from == REPAIR_FROM_CLOSING => {
                (CLOSE_HANDLES, [-self.signs[BTC], -self.signs[ETH]])
            }
            _ => return Err(ProgramFault::ProgramRejected),
        };
        let leg = handles
            .iter()
            .position(|known| *known == handle)
            .ok_or(ProgramFault::ProgramRejected)?;

        if self.phase == Phase::Repairing && self.repair_sent && self.repair_mask & (1 << leg) == 0
        {
            return Err(ProgramFault::ProgramRejected);
        }

        if event_side != side(expected_sides[leg]) as u8
            || !filled.is_finite()
            || filled < 0.0
            || !price.is_finite()
            || price < 0.0
        {
            return Err(ProgramFault::ProgramRejected);
        }

        match code {
            order_event::ACCEPTED => Ok(()),
            order_event::FILLED if self.phase == Phase::Opening && filled > 0.0 => {
                let bit = 1 << leg;
                if self.fill_mask & bit != 0 {
                    return Err(ProgramFault::ProgramRejected);
                }
                self.fill_mask |= bit;
                Ok(())
            }
            order_event::FILLED if filled > 0.0 => Ok(()),
            order_event::CANCELED | order_event::REJECTED | order_event::PARTIALLY_FILLED
                if self.phase == Phase::Opening =>
            {
                self.begin_repair(REPAIR_FROM_OPENING);
                Ok(())
            }
            order_event::CANCELED | order_event::REJECTED | order_event::PARTIALLY_FILLED
                if self.phase == Phase::Closing =>
            {
                self.begin_repair(REPAIR_FROM_CLOSING);
                Ok(())
            }
            order_event::CANCELED
            | order_event::REJECTED
            | order_event::PARTIALLY_FILLED
            | order_event::FILLED
                if self.phase == Phase::Repairing && !self.repair_sent =>
            {
                Ok(())
            }
            order_event::REJECTED | order_event::PARTIALLY_FILLED => {
                Err(ProgramFault::ProgramRejected)
            }
            _ => Err(ProgramFault::ProgramRejected),
        }
    }
}

impl StrategyProgram for PairsRelativeValue {
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
        let parameters = self.parameters()?;
        let mut records = frame.records();
        let first = records.next().ok_or(ProgramFault::MalformedFrame)??;
        if first.meta.codec_version != 1 {
            return Err(ProgramFault::MalformedFrame);
        }

        if first.meta.type_id == ORDER_EVENT_RECORD {
            if records.next().is_some() || !parameters.executables.contains(&first.meta.channel) {
                return Err(ProgramFault::MalformedFrame);
            }
            return self.order_event(first.order_event()?);
        }

        if first.meta.type_id != BAR_RECORD || !parameters.channels.contains(&first.meta.channel) {
            return Err(ProgramFault::MalformedFrame);
        }
        let bar = Bar::parse(
            first.f64s::<5>(BAR_RECORD)?,
            first.meta.ts_event,
            first.meta.available_at,
        )?;
        let mut positions = [0.0; 2];
        let mut pending = [0.0; 2];
        let mut balance_bits = [0; 2];

        for leg in 0..2 {
            let executable = parameters.executables[leg];
            let position = records.next().ok_or(ProgramFault::MalformedFrame)??;
            let order = records.next().ok_or(ProgramFault::MalformedFrame)??;
            let balance = records.next().ok_or(ProgramFault::MalformedFrame)??;

            if position.meta.type_id != POSITION_RECORD
                || order.meta.type_id != ORDER_RECORD
                || balance.meta.type_id != BALANCE_RECORD
                || position.meta.channel != executable
                || order.meta.channel != executable
                || balance.meta.channel != executable
                || [position.meta, order.meta, balance.meta]
                    .iter()
                    .any(|meta| {
                        meta.ts_event != first.meta.ts_event
                            || meta.available_at != first.meta.available_at
                    })
            {
                return Err(ProgramFault::MalformedFrame);
            }
            positions[leg] = position.scalar()?;
            pending[leg] = order.scalar()?;
            let shared_balance = balance.scalar()?;

            if !positions[leg].is_finite()
                || !pending[leg].is_finite()
                || pending[leg] < 0.0
                || !shared_balance.is_finite()
                || shared_balance < 0.0
            {
                return Err(ProgramFault::ProgramRejected);
            }
            balance_bits[leg] = shared_balance.to_bits();
        }

        if records.next().is_some() || balance_bits[BTC] != balance_bits[ETH] {
            return Err(ProgramFault::MalformedFrame);
        }
        let is_clock = first.meta.channel == parameters.channels[BTC];
        self.reconcile(Snapshot { positions, pending }, bar.ts, is_clock)?;
        if is_clock && frame.decision_time_ns >= self.run_end {
            return match self.phase {
                Phase::Flat | Phase::Halted => Ok(()),
                _ => Err(ProgramFault::ProgramRejected),
            };
        }

        if is_clock {
            self.decide(bar.ts, actions)?;
        }
        self.observe_bar(first.meta.channel, bar)
    }
}

fn side(sign: i8) -> OrderSide {
    if sign > 0 {
        OrderSide::Buy
    } else {
        OrderSide::Sell
    }
}

fn round_six(value: f64) -> Result<f64, ProgramFault> {
    if !value.is_finite() || value <= 0.0 || value > u64::MAX as f64 / 1_000_000.0 {
        return Err(ProgramFault::ProgramRejected);
    }
    let rounded = (value * 1_000_000.0) as u64 as f64 / 1_000_000.0;
    (rounded.is_finite() && rounded > 0.0)
        .then_some(rounded)
        .ok_or(ProgramFault::ProgramRejected)
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProgramFault> {
    Ok(u16::from_le_bytes(read(bytes, offset)?))
}
fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProgramFault> {
    Ok(u32::from_le_bytes(read(bytes, offset)?))
}
fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProgramFault> {
    Ok(u64::from_le_bytes(read(bytes, offset)?))
}
fn read_f64(bytes: &[u8], offset: usize) -> Result<f64, ProgramFault> {
    Ok(f64::from_bits(read_u64(bytes, offset)?))
}
fn read<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], ProgramFault> {
    bytes
        .get(offset..offset + N)
        .and_then(|value| value.try_into().ok())
        .ok_or(ProgramFault::MalformedFrame)
}

export_strategy_program!(PairsRelativeValue, PairsRelativeValue::new());

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use rstest::rstest;
    use std::vec::Vec;
    use strategy_factory_program_sdk::{
        CODEC_V1, FrameEncoder, RecordMeta, decode_actions, dispatch,
    };

    fn parameters(variant: u8, features: u16) -> [u8; 96] {
        let coordinates = [
            (32_u16, 96_u16, 2_000_u16, 500_u16),
            (32, 96, 2_500, 500),
            (64, 192, 2_000, 750),
            (64, 192, 2_500, 750),
        ];
        let mut bytes = [0; 96];
        bytes[..4].copy_from_slice(b"PRV1");
        bytes[4] = 1;
        bytes[5] = variant;
        bytes[6..8].copy_from_slice(&features.to_le_bytes());

        for (index, value) in [1_u32, 2, 1, 2, 3, 4].into_iter().enumerate() {
            let offset = 8 + index * 4;
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        let (window, hold, entry, exit) = coordinates[usize::from(variant)];
        for (offset, value) in [(32, window), (34, hold), (36, entry), (38, exit)] {
            bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
        }
        bytes[40..48].copy_from_slice(&2_000_f64.to_le_bytes());
        bytes
    }

    fn bar(close: f64, ts: u64) -> Bar {
        Bar {
            close,
            ts,
            available: ts,
        }
    }

    fn seeded(features: u16) -> PairsRelativeValue {
        let mut program = PairsRelativeValue::new();
        program.parameters = Some(Parameters::parse(&parameters(0, features)).unwrap());
        program.run_end = u64::MAX - M15_NS;
        program
    }

    fn actions(
        operation: impl FnOnce(&mut ActionEncoder<'_>) -> Result<(), ProgramFault>,
    ) -> Vec<Action> {
        let mut bytes = [0; 192];
        let mut encoder = ActionEncoder::new(&mut bytes);
        operation(&mut encoder).unwrap();
        let len = encoder.finish();
        decode_actions(&bytes[..len])
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn seed_h1(program: &mut PairsRelativeValue, reverse: bool) {
        for (ts, closes) in [(10, [100.0, 100.0]), (20, [101.0, 101.0])] {
            let order = if reverse { [ETH, BTC] } else { [BTC, ETH] };
            for leg in order {
                program
                    .observe_bar(3 + leg as u32, bar(closes[leg], ts))
                    .unwrap();
            }
        }
    }

    fn prime_signal(program: &mut PairsRelativeValue, reverse: bool) {
        seed_h1(program, reverse);
        for _ in 0..31 {
            program.ring.push(1.0, 32).unwrap();
        }
        let order = if reverse { [ETH, BTC] } else { [BTC, ETH] };
        for leg in order {
            let closes = [50.0, 100.0];
            program
                .observe_bar(1 + leg as u32, bar(closes[leg], 30))
                .unwrap();
        }
    }

    fn submit_fields(action: &Action) -> (u32, u64, OrderSide, f64, bool, u32) {
        match action {
            Action::Submit {
                instrument,
                handle,
                side,
                quantity,
                reduce_only,
                decision_tag,
                ..
            } => (
                *instrument,
                *handle,
                *side,
                *quantity,
                *reduce_only,
                *decision_tag,
            ),
            _ => panic!("unexpected non-submit action"),
        }
    }

    fn snapshot(positions: [f64; 2]) -> Snapshot {
        Snapshot {
            positions,
            pending: [0.0; 2],
        }
    }

    fn event(program: &mut PairsRelativeValue, handle: u64, code: u8, sign: i8, filled: f64) {
        program
            .order_event((handle, code, side(sign) as u8, filled, 100.0))
            .unwrap();
    }

    fn dispatch_bar(
        program: &mut PairsRelativeValue,
        channel: u32,
        ts: u64,
        positions: [f64; 2],
        pending: [f64; 2],
        balances: [f64; 2],
    ) -> i32 {
        let mut bytes = [0; 512];
        let mut frame = FrameEncoder::observation(&mut bytes, ts + 1).unwrap();
        let meta = |type_id, bound| RecordMeta {
            type_id,
            codec_version: CODEC_V1,
            channel: bound,
            ts_event: ts,
            available_at: ts,
        };
        let mut payload = [0; 40];
        for (index, value) in [100.0_f64, 101.0, 99.0, 100.0, 1.0].into_iter().enumerate() {
            payload[index * 8..index * 8 + 8].copy_from_slice(&value.to_le_bytes());
        }
        frame.push(meta(BAR_RECORD, channel), &payload).unwrap();

        for leg in 0..2 {
            for (type_id, value) in [
                (POSITION_RECORD, positions[leg]),
                (ORDER_RECORD, pending[leg]),
                (BALANCE_RECORD, balances[leg]),
            ] {
                frame
                    .push(meta(type_id, 1 + leg as u32), &value.to_le_bytes())
                    .unwrap();
            }
        }
        let len = frame.finish();
        dispatch(program, &bytes[..len], &mut [0; 192])
    }

    #[rstest]
    fn exact_parameter_abi_accepts_only_frozen_coordinates_and_deletions() {
        for variant in 0..4 {
            assert!(Parameters::parse(&parameters(variant, ALL_FEATURES)).is_ok());
        }

        for feature in [H1_REGIME, ROLLING_VARIANCE, CONVERGENCE, ETH_LEG] {
            assert!(Parameters::parse(&parameters(0, ALL_FEATURES & !feature)).is_ok());
        }

        for mutation in [0, 4, 48] {
            let mut invalid = parameters(0, ALL_FEATURES);
            invalid[mutation] ^= 1;
            assert!(Parameters::parse(&invalid).is_err());
        }
        let mut wrong_coordinate = parameters(0, ALL_FEATURES);
        wrong_coordinate[32] = 64;
        assert!(Parameters::parse(&wrong_coordinate).is_err());
        assert!(Parameters::parse(&parameters(0, 0)).is_err());
        let mut unknown_variant = parameters(0, ALL_FEATURES);
        unknown_variant[5] = 4;
        assert!(Parameters::parse(&unknown_variant).is_err());
    }

    #[rstest]
    fn same_timestamp_m15_and_h1_permutations_are_identical() {
        let run = |reverse| {
            let mut program = seeded(ALL_FEATURES);
            prime_signal(&mut program, reverse);
            let schedule = if reverse { [2, 1, 4, 3] } else { [3, 4, 1, 2] };
            let mut emitted = Vec::new();

            for channel in schedule {
                if channel == 1 {
                    emitted = actions(|actions| program.decide(40, actions));
                }
                program.observe_bar(channel, bar(102.0, 40)).unwrap();
            }
            (
                emitted,
                program.phase,
                program.quantities,
                program.signs,
                program.h1_valid_at(40),
                program.completed_m15,
                program.h1_regimes,
            )
        };
        assert_eq!(run(false), run(true));
        let result = run(false);
        assert_eq!(result.0.len(), 2);
        assert_eq!(result.1, Phase::Opening);
        assert!(result.4);
    }

    #[rstest]
    fn duplicate_or_nonmonotonic_channel_rejects() {
        let mut program = seeded(ALL_FEATURES);
        program.observe_bar(1, bar(100.0, 10)).unwrap();
        assert_eq!(
            program.observe_bar(1, bar(100.0, 10)),
            Err(ProgramFault::ProgramRejected)
        );
        assert_eq!(
            program.observe_bar(1, bar(100.0, 9)),
            Err(ProgramFault::ProgramRejected)
        );
    }

    #[rstest]
    fn bar_frame_requires_seven_records_and_one_shared_balance() {
        let mut equal = seeded(ALL_FEATURES);
        assert_eq!(
            dispatch_bar(&mut equal, 1, 10, [0.0; 2], [0.0; 2], [1_000.0; 2]),
            0
        );
        let mut unequal = seeded(ALL_FEATURES);
        assert_eq!(
            dispatch_bar(&mut unequal, 1, 10, [0.0; 2], [0.0; 2], [1_000.0, 999.0]),
            ProgramFault::MalformedFrame as i32
        );
    }

    #[rstest]
    fn terminal_pair_consumes_the_prior_decision_pair_in_either_callback_order() {
        for channels in [[1, 2], [2, 1]] {
            let mut program = seeded(ALL_FEATURES & !ETH_LEG);
            program.run_end = 30 + M15_NS;
            program.completed_m15 = Some([bar(100.0, 20), bar(50.0, 20)]);

            for channel in channels {
                assert_eq!(
                    dispatch_bar(&mut program, channel, 30, [0.0; 2], [0.0; 2], [1_000.0; 2]),
                    0
                );
            }
            assert_eq!(
                program.completed_m15,
                Some([bar(100.0, 30), bar(100.0, 30)])
            );
        }
    }

    #[rstest]
    fn happy_open_fill_snapshot_close_and_flat_halts() {
        let mut program = seeded(ALL_FEATURES);
        prime_signal(&mut program, false);
        let entries = actions(|actions| program.decide(40, actions));
        for (leg, action) in entries.iter().enumerate() {
            let (_, handle, event_side, quantity, _, _) = submit_fields(action);
            let sign = if event_side == OrderSide::Buy { 1 } else { -1 };
            event(&mut program, handle, order_event::FILLED, sign, quantity);
            assert_eq!(handle, ENTRY_HANDLES[leg]);
        }
        let positions = [
            f64::from(program.signs[BTC]) * program.quantities[BTC],
            f64::from(program.signs[ETH]) * program.quantities[ETH],
        ];
        program.reconcile(snapshot(positions), 41, true).unwrap();
        assert_eq!(program.phase, Phase::Open);
        let closes = actions(|actions| program.close(CONVERGENCE_CLOSE, 42, actions));
        assert_eq!(closes.len(), 2);
        assert!(closes.iter().all(|action| submit_fields(action).4));
        program.reconcile(snapshot([0.0; 2]), 43, true).unwrap();
        assert_eq!(program.phase, Phase::Halted);
        assert!(actions(|actions| program.decide(44, actions)).is_empty());
    }

    #[rstest]
    fn one_leg_fill_and_other_rejection_repairs_both_spread_directions() {
        for spread in [-1, 1] {
            for reject_first in [false, true] {
                let mut program = seeded(ALL_FEATURES);
                let pair = [bar(100.0, 10), bar(50.0, 10)];
                actions(|actions| program.enter(pair, spread, 20, actions));
                let fill = |program: &mut PairsRelativeValue| {
                    event(
                        program,
                        ENTRY_HANDLES[BTC],
                        order_event::FILLED,
                        spread,
                        program.quantities[BTC],
                    );
                };
                let reject = |program: &mut PairsRelativeValue| {
                    event(
                        program,
                        ENTRY_HANDLES[ETH],
                        order_event::REJECTED,
                        -spread,
                        0.0,
                    );
                };

                if reject_first {
                    reject(&mut program);
                    fill(&mut program);
                } else {
                    fill(&mut program);
                    reject(&mut program);
                }
                program
                    .reconcile(
                        snapshot([f64::from(spread) * program.quantities[BTC], 0.0]),
                        21,
                        true,
                    )
                    .unwrap();
                let repairs = actions(|actions| program.repair(21, actions));
                assert_eq!(repairs.len(), 1);
                let (_, handle, repair_side, quantity, reduce_only, tag) =
                    submit_fields(&repairs[0]);
                assert_eq!(
                    (handle, repair_side, quantity, reduce_only, tag),
                    (
                        REPAIR_HANDLES[BTC],
                        side(-spread),
                        program.quantities[BTC],
                        true,
                        REPAIR_BTC
                    )
                );
            }
        }
    }

    #[rstest]
    fn partial_both_legs_use_one_two_action_repair() {
        let mut program = seeded(ALL_FEATURES);
        actions(|actions| program.enter([bar(100.0, 10), bar(50.0, 10)], -1, 20, actions));
        event(
            &mut program,
            ENTRY_HANDLES[BTC],
            order_event::PARTIALLY_FILLED,
            -1,
            1.0,
        );
        event(
            &mut program,
            ENTRY_HANDLES[BTC],
            order_event::CANCELED,
            -1,
            0.0,
        );
        event(
            &mut program,
            ENTRY_HANDLES[ETH],
            order_event::PARTIALLY_FILLED,
            1,
            1.0,
        );
        event(
            &mut program,
            ENTRY_HANDLES[ETH],
            order_event::REJECTED,
            1,
            0.0,
        );
        program.pending = [0.0, 1.0];
        assert!(actions(|actions| program.repair(21, actions)).is_empty());
        assert!(!program.repair_sent);
        program.reconcile(snapshot([-3.0, 4.0]), 21, true).unwrap();
        assert_eq!(program.phase, Phase::Repairing);
        let repairs = actions(|actions| program.repair(21, actions));
        assert_eq!(repairs.len(), 2);
        assert!(
            repairs
                .iter()
                .all(|action| submit_fields(action).4 && submit_fields(action).5 == REPAIR_BOTH)
        );
    }

    #[rstest]
    fn repair_rejection_repeat_and_terminal_unresolved_reject() {
        let mut program = seeded(ALL_FEATURES);
        program.phase = Phase::Repairing;
        program.positions = [1.0, 0.0];
        actions(|actions| program.repair(20, actions));
        assert_eq!(
            program.repair(20, &mut ActionEncoder::new(&mut [0; 192])),
            Err(ProgramFault::ProgramRejected)
        );
        assert_eq!(
            program.order_event((
                REPAIR_HANDLES[BTC],
                order_event::REJECTED,
                OrderSide::Sell as u8,
                0.0,
                0.0
            )),
            Err(ProgramFault::ProgramRejected)
        );

        let mut closing = seeded(ALL_FEATURES);
        closing.phase = Phase::Closing;
        closing.signs = [1, -1];
        closing.positions = [1.0, -2.0];
        event(
            &mut closing,
            CLOSE_HANDLES[ETH],
            order_event::REJECTED,
            1,
            0.0,
        );
        event(
            &mut closing,
            CLOSE_HANDLES[BTC],
            order_event::FILLED,
            -1,
            1.0,
        );
        closing.reconcile(snapshot([0.0, -2.0]), 21, true).unwrap();
        let repair = actions(|actions| closing.repair(21, actions));
        assert_eq!(submit_fields(&repair[0]).0, 2);

        let mut unresolved = seeded(ALL_FEATURES);
        unresolved.run_end = 100 + M15_NS;
        unresolved.phase = Phase::Opening;
        let mut output = [0; 192];
        assert_eq!(
            unresolved.decide(100, &mut ActionEncoder::new(&mut output)),
            Err(ProgramFault::ProgramRejected)
        );
    }

    #[rstest]
    fn unknown_out_of_state_events_and_context_actions_are_impossible() {
        let mut program = seeded(ALL_FEATURES);
        assert_eq!(
            program.order_event((999, order_event::FILLED, 1, 1.0, 1.0)),
            Err(ProgramFault::ProgramRejected)
        );
        prime_signal(&mut program, false);
        let emitted = actions(|actions| program.decide(40, actions));
        assert!(
            emitted
                .iter()
                .all(|action| matches!(submit_fields(action).0, 1 | 2))
        );
        assert!(emitted.iter().all(|action| submit_fields(action).1 != 3));
    }
}
