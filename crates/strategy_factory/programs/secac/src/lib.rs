#![no_std]

#[cfg(not(test))]
use core::panic::PanicInfo;
use strategy_factory_program_sdk::{
    Action, ActionEncoder, BALANCE_RECORD, BAR_RECORD, Frame, ORDER_EVENT_RECORD, ORDER_RECORD,
    OrderKind, OrderSide, POSITION_RECORD, ProgramFault, StrategyProgram, export_strategy_program,
    order_event,
};
use vibe_indicators_kernel::{EmaConfig, EmaTransition, reset_ema, true_range};

const SCALAR_RECORD: u32 = 1_024;
const EVENT_RECORD: u32 = 1_025;
const SESSION_RECORD: u32 = 1_026;
const CHANNELS: usize = 16;
const TRENDS: usize = 6;
const SERIES: usize = 6;
const MAX_EVENTS: usize = 32;
const DAY_NS: u64 = 86_400_000_000_000;
const M15_NS: u64 = 900_000_000_000;
const ETH_CONFIRM: u16 = 1 << 0;
const MTF_ALIGNMENT: u16 = 1 << 1;
const MACRO_PAXG_VETO: u16 = 1 << 2;
const DYNAMIC_PROTECTION: u16 = 1 << 3;
const ALL_FEATURES: u16 = (1 << 4) - 1;
const STOP_TAG: u32 = 201;
const THESIS_TAG: u32 = 202;
const MAX_HOLD_TAG: u32 = 203;
const TRAIL_TAG: u32 = 204;
const TERMINAL_TAG: u32 = 205;

#[derive(Clone, Copy)]
struct Parameters {
    shock_wait: u8,
    features: u16,
    channels: [u32; CHANNELS],
    fast: usize,
    slow: usize,
    atr: usize,
    max_hold: u16,
    quantity: f64,
    shock_atr: f64,
    stop_atr: f64,
    trail_atr: f64,
    dislocation_abs_max: f64,
    thesis_loss_atr: f64,
}

impl Parameters {
    fn parse(bytes: &[u8]) -> Result<Self, ProgramFault> {
        if bytes.len() != 128 || bytes[..4] != *b"SEC1" || bytes[4] != 1 {
            return Err(ProgramFault::MalformedFrame);
        }
        let shock_wait = bytes[5];
        let features = read_u16(bytes, 6)?;
        let mut channels = [0; CHANNELS];
        for (index, channel) in channels.iter_mut().enumerate() {
            *channel = read_u32(bytes, 8 + index * 4)?;
        }
        let result = Self {
            shock_wait,
            features,
            channels,
            fast: usize::from(read_u16(bytes, 72)?),
            slow: usize::from(read_u16(bytes, 74)?),
            atr: usize::from(read_u16(bytes, 76)?),
            max_hold: read_u16(bytes, 78)?,
            quantity: read_f64(bytes, 80)?,
            shock_atr: read_f64(bytes, 88)?,
            stop_atr: read_f64(bytes, 96)?,
            trail_atr: read_f64(bytes, 104)?,
            dislocation_abs_max: read_f64(bytes, 112)?,
            thesis_loss_atr: read_f64(bytes, 120)?,
        };
        let allowed_variant = features == ALL_FEATURES
            || [
                ETH_CONFIRM,
                MTF_ALIGNMENT,
                MACRO_PAXG_VETO,
                DYNAMIC_PROTECTION,
            ]
            .iter()
            .any(|feature| features == ALL_FEATURES & !feature);
        if !matches!(shock_wait, 1 | 2)
            || !allowed_variant
            || channels
                .iter()
                .any(|channel| *channel == 0 || *channel >= 64)
            || !unique(&channels)
            || result.fast == 0
            || result.slow <= result.fast
            || result.atr == 0
            || result.max_hold == 0
            || !positive(result.quantity)
            || !positive(result.shock_atr)
            || !positive(result.stop_atr)
            || !positive(result.trail_atr)
            || !positive(result.dislocation_abs_max)
            || result.dislocation_abs_max > 1.0
            || !positive(result.thesis_loss_atr)
        {
            return Err(ProgramFault::ProgramRejected);
        }
        Ok(result)
    }

    fn enabled(self, feature: u16) -> bool {
        self.features & feature != 0
    }
}

#[derive(Clone, Copy)]
struct Trend {
    fast: EmaTransition,
    slow: EmaTransition,
}

impl Trend {
    const fn empty() -> Self {
        Self {
            fast: reset_ema(),
            slow: reset_ema(),
        }
    }

    fn update(
        &mut self,
        close: f64,
        _ts_event: u64,
        _available_at: u64,
        fast: usize,
        slow: usize,
    ) -> Result<(), ProgramFault> {
        self.fast = EmaConfig::new(fast)
            .ok_or(ProgramFault::ProgramRejected)?
            .transition(close, self.fast);
        self.slow = EmaConfig::new(slow)
            .ok_or(ProgramFault::ProgramRejected)?
            .transition(close, self.slow);
        Ok(())
    }

    fn agrees(self, side: i8) -> bool {
        self.fast.initialized
            && self.slow.initialized
            && direction(self.fast.value - self.slow.value) == side
    }
}

#[derive(Clone, Copy)]
struct Series {
    previous: f64,
    current: f64,
    current_event: u64,
    current_available: u64,
}

impl Series {
    const fn empty() -> Self {
        Self {
            previous: 0.0,
            current: 0.0,
            current_event: 0,
            current_available: 0,
        }
    }

    fn update(&mut self, value: f64, event: u64, available: u64) -> Result<(), ProgramFault> {
        let watermark = (self.current_available, self.current_event);
        if !value.is_finite() || value == 0.0 || (available, event) <= watermark {
            return Err(ProgramFault::ProgramRejected);
        }
        self.previous = self.current;
        self.current = value;
        self.current_event = event;
        self.current_available = available;
        Ok(())
    }

    fn within(self, event_target: u64, limit: f64) -> bool {
        self.previous != 0.0
            && self.current_available / DAY_NS < event_target / DAY_NS
            && self.previous.is_finite()
            && ((self.current / self.previous) - 1.0).abs() <= limit
    }
}

#[derive(Clone, Copy)]
struct Bar {
    values: [f64; 5],
    ts_event: u64,
    available_at: u64,
}

impl Bar {
    const fn empty() -> Self {
        Self {
            values: [0.0; 5],
            ts_event: 0,
            available_at: 0,
        }
    }
}

struct Secac {
    parameters: Option<Parameters>,
    trends: [Trend; TRENDS],
    series: [Series; SERIES],
    m15: [Bar; 2],
    event_kinds: [u64; MAX_EVENTS],
    event_targets: [u64; MAX_EVENTS],
    event_count: usize,
    active_event: u64,
    consumed_event: u64,
    waited: u8,
    shock_side: i8,
    last_pair: u64,
    previous_pair_closes: [f64; 2],
    pending_signal: i8,
    signal_pair: u64,
    signal_event: u64,
    signal_event_kind: u64,
    atr: EmaTransition,
    previous_btc_close: Option<f64>,
    entry_submitted: bool,
    exit_submitted: bool,
    position_side: i8,
    entry_price: f64,
    trailing_extreme: f64,
    held_bars: u16,
    next_handle: u64,
    session_mask: u8,
    session_available: u64,
    run_end: u64,
}

impl Secac {
    const fn new() -> Self {
        Self {
            parameters: None,
            trends: [Trend::empty(); TRENDS],
            series: [Series::empty(); SERIES],
            m15: [Bar::empty(); 2],
            event_kinds: [0; MAX_EVENTS],
            event_targets: [0; MAX_EVENTS],
            event_count: 0,
            active_event: 0,
            consumed_event: 0,
            waited: 0,
            shock_side: 0,
            last_pair: 0,
            previous_pair_closes: [0.0; 2],
            pending_signal: 0,
            signal_pair: 0,
            signal_event: 0,
            signal_event_kind: 0,
            atr: reset_ema(),
            previous_btc_close: None,
            entry_submitted: false,
            exit_submitted: false,
            position_side: 0,
            entry_price: 0.0,
            trailing_extreme: 0.0,
            held_bars: 0,
            next_handle: 1,
            session_mask: 0,
            session_available: 0,
            run_end: 0,
        }
    }

    fn parameters(&self) -> Result<Parameters, ProgramFault> {
        self.parameters.ok_or(ProgramFault::ProgramRejected)
    }

    fn event(&mut self, payload: &[u8], available_at: u64) -> Result<(), ProgramFault> {
        if payload.len() != 16 {
            return Err(ProgramFault::MalformedFrame);
        }
        let kind = read_u64(payload, 0)?;
        let target = read_u64(payload, 8)?;
        if target <= available_at {
            return Err(ProgramFault::ProgramRejected);
        }
        match kind {
            1 => return Ok(()),
            2 | 3 => {}
            _ => return Err(ProgramFault::ProgramRejected),
        }
        for index in 0..self.event_count {
            if self.event_targets[index] == target {
                return (self.event_kinds[index] == kind)
                    .then_some(())
                    .ok_or(ProgramFault::ProgramRejected);
            }
        }
        if self.event_count == MAX_EVENTS {
            return Err(ProgramFault::ProgramRejected);
        }
        self.event_kinds[self.event_count] = kind;
        self.event_targets[self.event_count] = target;
        self.event_count += 1;
        Ok(())
    }

    fn observe_bar(&mut self, channel: u32, bar: Bar) -> Result<Option<u32>, ProgramFault> {
        validate_bar(bar.values)?;
        let parameters = self.parameters()?;
        let slot = parameters
            .channels
            .iter()
            .position(|bound| *bound == channel)
            .ok_or(ProgramFault::MalformedFrame)?;
        match slot {
            0 | 1 => {
                let m15_slot = usize::from(slot == 1);
                if bar.ts_event <= self.m15[m15_slot].ts_event {
                    return Err(ProgramFault::ProgramRejected);
                }
                if slot == 0 {
                    let (range, close) = true_range(
                        bar.values[1],
                        bar.values[2],
                        bar.values[3],
                        self.previous_btc_close,
                    );
                    self.previous_btc_close = Some(close);
                    self.atr = EmaConfig::new(parameters.atr)
                        .ok_or(ProgramFault::ProgramRejected)?
                        .transition_with_alpha(1.0 / parameters.atr as f64, range, self.atr);
                }
                self.m15[m15_slot] = bar;
                self.complete_pair()
            }
            2..=7 => self.trends[slot - 2]
                .update(
                    bar.values[3],
                    bar.ts_event,
                    bar.available_at,
                    parameters.fast,
                    parameters.slow,
                )
                .map(|()| None),
            8 => self.series[0]
                .update(bar.values[3], bar.ts_event, bar.available_at)
                .map(|()| None),
            _ => Err(ProgramFault::MalformedFrame),
        }
    }

    fn complete_pair(&mut self) -> Result<Option<u32>, ProgramFault> {
        if self.m15[0].ts_event == 0
            || self.m15[0].ts_event != self.m15[1].ts_event
            || self.m15[0].ts_event <= self.last_pair
        {
            return Ok(None);
        }
        self.last_pair = self.m15[0].ts_event;
        let pair_time = self.m15[0].available_at.max(self.m15[1].available_at);
        let closes = [self.m15[0].values[3], self.m15[1].values[3]];
        if self.previous_pair_closes[0] == 0.0 {
            self.previous_pair_closes = closes;
            return Ok(None);
        }
        let changes = [
            closes[0] - self.previous_pair_closes[0],
            closes[1] - self.previous_pair_closes[1],
        ];
        self.previous_pair_closes = closes;
        if self.position_side != 0
            && self.atr.initialized
            && direction(changes[0]) == -self.position_side
            && self.same_side(changes) == -self.position_side
            && changes[0].abs() >= self.parameters()?.thesis_loss_atr * self.atr.value
        {
            return Ok(Some(THESIS_TAG));
        }
        self.advance_event(pair_time, changes)?;
        Ok(None)
    }

    fn advance_event(&mut self, pair_time: u64, changes: [f64; 2]) -> Result<(), ProgramFault> {
        if self.active_event == 0 {
            self.active_event = self.event_targets[..self.event_count]
                .iter()
                .filter(|target| **target > self.consumed_event && **target < pair_time)
                .copied()
                .min()
                .unwrap_or(0);
            self.waited = 0;
            self.shock_side = 0;
        }
        if self.active_event == 0 {
            return Ok(());
        }
        let parameters = self.parameters()?;
        if self.shock_side == 0 {
            self.waited += 1;
            if self.waited < parameters.shock_wait {
                return Ok(());
            }
            let side = self.same_side(changes);
            if !self.atr.initialized
                || side == 0
                || changes[0].abs() < parameters.shock_atr * self.atr.value
            {
                self.consume_active_event();
            } else {
                self.shock_side = side;
            }
            return Ok(());
        }
        let side = self.same_side(changes);
        if side == self.shock_side && self.entry_gates(side, self.active_event) {
            self.pending_signal = side;
            self.signal_pair = self.last_pair;
            self.signal_event = self.active_event;
            self.signal_event_kind = self.event_targets[..self.event_count]
                .iter()
                .position(|target| *target == self.active_event)
                .map_or(0, |index| self.event_kinds[index]);
        }
        self.consume_active_event();
        Ok(())
    }

    fn same_side(&self, changes: [f64; 2]) -> i8 {
        let btc = direction(changes[0]);
        if btc == 0 {
            return 0;
        }
        if self
            .parameters
            .is_some_and(|parameters| parameters.enabled(ETH_CONFIRM))
            && direction(changes[1]) != btc
        {
            0
        } else {
            btc
        }
    }

    fn entry_gates(&self, side: i8, event_target: u64) -> bool {
        self.parameters.is_some_and(|parameters| {
            (!parameters.enabled(MTF_ALIGNMENT)
                || self.trends.iter().all(|trend| trend.agrees(side)))
                && (!parameters.enabled(MACRO_PAXG_VETO)
                    || self
                        .series
                        .iter()
                        .all(|series| series.within(event_target, parameters.dislocation_abs_max)))
        })
    }

    fn consume_active_event(&mut self) {
        self.consumed_event = self.active_event;
        self.active_event = 0;
        self.waited = 0;
        self.shock_side = 0;
    }

    fn reconcile_position(
        &mut self,
        position: f64,
        executable_bar: Option<Bar>,
    ) -> Result<bool, ProgramFault> {
        if !position.is_finite() {
            return Err(ProgramFault::ProgramRejected);
        }
        let side = direction(position);
        if self.position_side != 0 && side != 0 && side != self.position_side {
            return Err(ProgramFault::ProgramRejected);
        }
        if self.position_side == 0 && side != 0 {
            let Some(bar) = executable_bar else {
                return Ok(false);
            };
            self.position_side = side;
            self.entry_price = bar.values[3];
            self.trailing_extreme = if side > 0 {
                bar.values[1]
            } else {
                bar.values[2]
            };
            self.held_bars = 0;
            self.entry_submitted = false;
            return Ok(true);
        }
        if self.position_side != 0 && side == 0 {
            self.position_side = 0;
            self.exit_submitted = false;
            self.held_bars = 0;
        }
        Ok(false)
    }

    fn exit_tag(&mut self, bar: Bar, newly_opened: bool) -> Option<u32> {
        let parameters = self.parameters?;
        if self.position_side == 0 || self.exit_submitted || !self.atr.initialized {
            return None;
        }
        if !newly_opened {
            self.held_bars = self.held_bars.saturating_add(1);
        }
        let close = bar.values[3];
        let adverse = self.position_side as f64 * (close - self.entry_price);
        if adverse <= -parameters.stop_atr * self.atr.value {
            return Some(STOP_TAG);
        }
        if self.held_bars >= parameters.max_hold {
            return Some(MAX_HOLD_TAG);
        }
        if parameters.enabled(DYNAMIC_PROTECTION) {
            self.trailing_extreme = if self.position_side > 0 {
                self.trailing_extreme.max(bar.values[1])
            } else {
                self.trailing_extreme.min(bar.values[2])
            };
            let protected = self.position_side as f64 * (close - self.trailing_extreme)
                <= -parameters.trail_atr * self.atr.value;
            if protected {
                return Some(TRAIL_TAG);
            }
        }
        None
    }

    fn submit(&mut self, side: i8, reduce_only: bool, tag: u32) -> Result<Action, ProgramFault> {
        let parameters = self.parameters()?;
        let action = Action::Submit {
            kind: OrderKind::Market,
            instrument: parameters.channels[0],
            handle: self.next_handle,
            side: if side > 0 {
                OrderSide::Buy
            } else {
                OrderSide::Sell
            },
            quantity: parameters.quantity,
            price: 0.0,
            trigger_price: 0.0,
            reduce_only,
            decision_tag: tag,
        };
        self.next_handle = self
            .next_handle
            .checked_add(1)
            .ok_or(ProgramFault::ProgramRejected)?;
        Ok(action)
    }

    fn exit(&mut self, tag: u32, actions: &mut ActionEncoder<'_>) -> Result<(), ProgramFault> {
        if self.position_side == 0 || self.exit_submitted {
            return Ok(());
        }
        actions.push(self.submit(-self.position_side, true, tag)?)?;
        self.exit_submitted = true;
        Ok(())
    }

    fn entry_tag(&self) -> Result<u32, ProgramFault> {
        match (self.signal_event_kind, self.pending_signal) {
            (2, 1) => Ok(111),
            (2, -1) => Ok(112),
            (3, 1) => Ok(121),
            (3, -1) => Ok(122),
            _ => Err(ProgramFault::ProgramRejected),
        }
    }
}

impl StrategyProgram for Secac {
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
            if records.next().is_some() || first.meta.channel != parameters.channels[0] {
                return Err(ProgramFault::MalformedFrame);
            }
            let (_, code, _, _, _) = first.order_event()?;
            return (!matches!(
                code,
                order_event::REJECTED | order_event::MODIFY_REJECTED | order_event::CANCEL_REJECTED
            ))
            .then_some(())
            .ok_or(ProgramFault::ProgramRejected);
        }
        if first.meta.type_id >= SCALAR_RECORD {
            if records.next().is_some() {
                return Err(ProgramFault::MalformedFrame);
            }
            let channel = first.meta.channel;
            if let Some(slot) = parameters.channels[9..14]
                .iter()
                .position(|bound| *bound == channel)
            {
                if first.meta.type_id != SCALAR_RECORD || first.payload.len() != 8 {
                    return Err(ProgramFault::MalformedFrame);
                }
                let value = read_f64(first.payload, 0)?;
                let meta = first.meta;
                return self.series[slot + 1].update(value, meta.ts_event, meta.available_at);
            }
            if channel == parameters.channels[14] && first.meta.type_id == EVENT_RECORD {
                return self.event(first.payload, first.meta.available_at);
            }
            if channel == parameters.channels[15]
                && first.meta.type_id == SESSION_RECORD
                && first.payload.len() == 8
                && first.payload[1..] == [0; 7]
                && first.meta.available_at > self.session_available
            {
                self.session_mask = first.payload[0];
                self.session_available = first.meta.available_at;
                return Ok(());
            }
            return Err(ProgramFault::MalformedFrame);
        }
        if first.meta.type_id != BAR_RECORD {
            return Err(ProgramFault::MalformedFrame);
        }
        let bar = Bar {
            values: first.f64s::<5>(BAR_RECORD)?,
            ts_event: first.meta.ts_event,
            available_at: first.meta.available_at,
        };
        let position_record = records.next().ok_or(ProgramFault::MalformedFrame)??;
        let order_record = records.next().ok_or(ProgramFault::MalformedFrame)??;
        let balance_record = records.next().ok_or(ProgramFault::MalformedFrame)??;
        if records.next().is_some()
            || position_record.meta.type_id != POSITION_RECORD
            || order_record.meta.type_id != ORDER_RECORD
            || balance_record.meta.type_id != BALANCE_RECORD
            || position_record.meta.channel != parameters.channels[0]
            || order_record.meta.channel != parameters.channels[0]
            || balance_record.meta.channel != parameters.channels[0]
        {
            return Err(ProgramFault::MalformedFrame);
        }
        let position = position_record.scalar()?;
        let pending = order_record.scalar()?;
        let balance = balance_record.scalar()?;
        if !pending.is_finite() || pending < 0.0 || !balance.is_finite() || balance < 0.0 {
            return Err(ProgramFault::ProgramRejected);
        }
        let executable_bar = first.meta.channel == parameters.channels[0];
        let newly_opened = self.reconcile_position(position, executable_bar.then_some(bar))?;
        let pair_exit = self.observe_bar(first.meta.channel, bar)?;
        if !executable_bar {
            if let Some(tag) = pair_exit {
                self.exit(tag, actions)?;
            }
            return Ok(());
        }
        if self.position_side != 0
            && bar.available_at.checked_add(M15_NS) == Some(self.run_end)
            && !self.exit_submitted
        {
            actions.push(self.submit(-self.position_side, true, TERMINAL_TAG)?)?;
            self.exit_submitted = true;
            return Ok(());
        }
        if let Some(tag) = pair_exit.or_else(|| self.exit_tag(bar, newly_opened)) {
            return self.exit(tag, actions);
        }
        if self.position_side == 0
            && pending == 0.0
            && !self.entry_submitted
            && self.pending_signal != 0
            && self.signal_pair < bar.ts_event
            && self.entry_gates(self.pending_signal, self.signal_event)
        {
            let tag = self.entry_tag()?;
            actions.push(self.submit(self.pending_signal, false, tag)?)?;
            self.entry_submitted = true;
            self.pending_signal = 0;
        }
        Ok(())
    }
}

fn validate_bar(bar: [f64; 5]) -> Result<(), ProgramFault> {
    (bar.iter().all(|value| value.is_finite())
        && bar[2] > 0.0
        && bar[1] >= bar[2]
        && (bar[2]..=bar[1]).contains(&bar[0])
        && (bar[2]..=bar[1]).contains(&bar[3]))
    .then_some(())
    .ok_or(ProgramFault::ProgramRejected)
}

fn direction(value: f64) -> i8 {
    if value > 0.0 {
        1
    } else if value < 0.0 {
        -1
    } else {
        0
    }
}

fn positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}
fn unique<const N: usize>(values: &[u32; N]) -> bool {
    (0..N).all(|left| (left + 1..N).all(|right| values[left] != values[right]))
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
fn read<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], ProgramFault> {
    let value = bytes
        .get(offset..offset + N)
        .ok_or(ProgramFault::MalformedFrame)?;
    value.try_into().map_err(|_| ProgramFault::MalformedFrame)
}
fn read_f64(bytes: &[u8], offset: usize) -> Result<f64, ProgramFault> {
    Ok(f64::from_bits(read_u64(bytes, offset)?))
}

export_strategy_program!(Secac, Secac::new());

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(test)]
mod tests {
    use super::*;
    use strategy_factory_program_sdk::{CODEC_V1, FrameEncoder, RecordMeta, dispatch};

    fn parameters(features: u16, shock_wait: u8) -> [u8; 128] {
        let mut bytes = [0; 128];
        bytes[..4].copy_from_slice(b"SEC1");
        bytes[4] = 1;
        bytes[5] = shock_wait;
        bytes[6..8].copy_from_slice(&features.to_le_bytes());
        for channel in 1_u32..=16 {
            let offset = 8 + (channel - 1) as usize * 4;
            bytes[offset..offset + 4].copy_from_slice(&channel.to_le_bytes());
        }
        for (offset, value) in [(72, 2_u16), (74, 3), (76, 2), (78, 4)] {
            bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
        }
        for (offset, value) in [80, 88, 96, 104, 112, 120]
            .into_iter()
            .zip([0.01_f64, 0.5, 2.0, 1.0, 0.2, 0.5])
        {
            bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }
    fn seeded(features: u16, shock_wait: u8) -> Secac {
        let mut program = Secac::new();
        program.parameters = Some(Parameters::parse(&parameters(features, shock_wait)).unwrap());
        program.atr = EmaTransition {
            value: 1.0,
            count: 2,
            initialized: true,
            has_inputs: true,
        };
        program.previous_pair_closes = [100.0, 100.0];
        program
    }
    fn context_frame(snapshot_count: usize) -> i32 {
        let mut program = seeded(ALL_FEATURES, 1);
        let mut bytes = [0; 256];
        let mut frame = FrameEncoder::observation(&mut bytes, 10).unwrap();
        let meta = |type_id, channel| RecordMeta {
            type_id,
            codec_version: CODEC_V1,
            channel,
            ts_event: 9,
            available_at: 10,
        };
        let mut bar = [0; 40];
        for (index, value) in [100.0_f64, 101.0, 99.0, 100.0, 1.0].into_iter().enumerate() {
            bar[index * 8..index * 8 + 8].copy_from_slice(&value.to_le_bytes());
        }
        frame.push(meta(BAR_RECORD, 3), &bar).unwrap();
        for &type_id in &[POSITION_RECORD, ORDER_RECORD, BALANCE_RECORD][..snapshot_count] {
            frame.push(meta(type_id, 1), &0_f64.to_le_bytes()).unwrap();
        }
        let len = frame.finish();
        dispatch(&mut program, &bytes[..len], &mut [0; 192])
    }

    fn event_frame(program: &mut Secac, kind: u64, target: u64, available_at: u64) -> i32 {
        let mut bytes = [0; 128];
        let mut frame = FrameEncoder::observation(&mut bytes, available_at).unwrap();
        let mut payload = [0; 16];
        payload[..8].copy_from_slice(&kind.to_le_bytes());
        payload[8..].copy_from_slice(&target.to_le_bytes());
        frame
            .push(
                RecordMeta {
                    type_id: EVENT_RECORD,
                    codec_version: CODEC_V1,
                    channel: 15,
                    ts_event: available_at,
                    available_at,
                },
                &payload,
            )
            .unwrap();
        let len = frame.finish();
        dispatch(program, &bytes[..len], &mut [0; 192])
    }

    #[test]
    fn canonical_parameters_have_exact_closed_shape() {
        let parsed = Parameters::parse(&parameters(ALL_FEATURES, 2)).unwrap();
        assert_eq!(parsed.shock_wait, 2);
        assert_eq!((parsed.channels[0], parsed.channels[15]), (1, 16));
        let mut invalid = parameters(ALL_FEATURES, 1);
        invalid[4] = 2;
        assert!(Parameters::parse(&invalid).is_err());
        assert!(Parameters::parse(&parameters(0, 1)).is_err());
    }

    #[test]
    fn series_orders_same_release_by_event_time() {
        let mut series = Series::empty();
        assert!(series.update(1.0, 1, 10).is_ok());
        assert!(series.update(2.0, 2, 10).is_ok());
        assert!(series.update(3.0, 2, 10).is_err());
        assert!(series.update(3.0, 1, 10).is_err());
    }

    #[test]
    fn no_scheduled_event_means_no_signal() {
        let mut program = seeded(ALL_FEATURES, 1);
        program.advance_event(20, [2.0, 2.0]).unwrap();
        program.advance_event(30, [1.0, 1.0]).unwrap();
        assert_eq!(program.pending_signal, 0);
    }

    #[test]
    fn context_bar_requires_exact_host_snapshots() {
        assert_eq!(context_frame(3), 0);
        assert_eq!(context_frame(2), ProgramFault::MalformedFrame as i32);
    }

    #[test]
    fn scheduled_event_codec_accepts_irrelevant_cpi_but_rejects_unknown_or_stale() {
        let mut program = seeded(ALL_FEATURES & !MTF_ALIGNMENT, 1);
        assert_eq!(event_frame(&mut program, 1, 10, 1), 0);
        assert_eq!(program.event_count, 0);
        assert_eq!(program.pending_signal, 0);
        assert_eq!(event_frame(&mut program, 4, 10, 1), -5);
        assert_eq!(event_frame(&mut program, 1, 1, 1), -5);

        assert_eq!(event_frame(&mut program, 2, 10, 1), 0);
        assert_eq!(program.event_kinds[0], 2);
        assert_eq!(event_frame(&mut program, 2, 10, 1), 0);
        assert_eq!(program.event_count, 1);
        assert_eq!(event_frame(&mut program, 3, 10, 1), -5);
    }

    #[test]
    fn deleting_eth_confirmation_changes_only_that_gate() {
        let full = seeded(ALL_FEATURES, 1);
        let deleted = seeded(ALL_FEATURES & !ETH_CONFIRM, 1);
        assert_eq!(full.same_side([2.0, -1.0]), 0);
        assert_eq!(deleted.same_side([2.0, -1.0]), 1);
    }

    #[test]
    fn shock_then_confirmation_creates_one_next_bar_signal() {
        let mut program = seeded(ALL_FEATURES & !MTF_ALIGNMENT, 1);
        for series in &mut program.series {
            series.previous = 100.0;
            series.current = 101.0;
            series.current_available = 2 * DAY_NS;
        }
        program.event_kinds[0] = 3;
        program.event_targets[0] = 3 * DAY_NS;
        program.event_count = 1;
        program.last_pair = 40;
        program.advance_event(3 * DAY_NS + 1, [2.0, 2.0]).unwrap();
        assert_eq!(program.pending_signal, 0);
        program.last_pair = 50;
        program.advance_event(3 * DAY_NS + 2, [1.0, 1.0]).unwrap();
        assert_eq!(program.pending_signal, 1);
        assert_eq!(program.signal_pair, 50);
        assert_eq!(program.consumed_event, 3 * DAY_NS);
    }

    #[test]
    fn terminal_max_hold_exit_is_fail_closed() {
        let mut program = seeded(ALL_FEATURES, 1);
        program.position_side = 1;
        program.entry_price = 100.0;
        program.trailing_extreme = 100.0;
        program.held_bars = 3;
        let bar = Bar {
            values: [100.0, 101.0, 99.0, 100.0, 1.0],
            ts_event: 1,
            available_at: 1,
        };
        assert_eq!(program.exit_tag(bar, false), Some(MAX_HOLD_TAG));
    }
}
