#![no_std]

use core::panic::PanicInfo;
use strategy_factory_program_sdk::{
    Action, ActionEncoder, BALANCE_RECORD, BAR_RECORD, Frame, ORDER_EVENT_RECORD, ORDER_RECORD,
    OrderKind, OrderSide, POSITION_RECORD, ProgramFault, ProgramRunScope, StrategyProgram,
    export_strategy_program,
};
use vibe_indicators_kernel::{
    EmaConfig, EmaTransition, SmaConfig, SmaTransition, bands, population_std_with_mean,
    relative_strength_index, reset_ema, reset_sma, true_range, typical_price, volatility_ratio,
};

const MAX_BREAKOUT: usize = 336;
const MAX_EXIT: usize = 72;
const MAX_BAND: usize = 48;
const MAX_ATR: usize = 48;
const MAX_VOL_FAST: usize = 48;
const MAX_VOL_SLOW: usize = 336;
const CONTEXT_BARS: usize = 9;
const SCALARS: usize = 5;
const MAX_EVENTS: usize = 40;
const HOUR_NS: u64 = 3_600_000_000_000;
const SCALAR_RECORD: u32 = 1_024;
const CALENDAR_RECORD: u32 = 1_025;
const SESSION_RECORD: u32 = 1_026;

const CROSS_ASSET: u16 = 1 << 0;
const GOLD: u16 = 1 << 1;
const EVENTS: u16 = 1 << 2;
const SESSIONS: u16 = 1 << 3;
const MULTI_TIMEFRAME: u16 = 1 << 4;
const STRUCTURE: u16 = 1 << 5;
const DYNAMIC_ORDER: u16 = 1 << 6;
const DYNAMIC_POSITION: u16 = 1 << 7;
const ALL_FEATURES: u16 = (1 << 8) - 1;

fn is_fresh(available_at: u64, decision_time: u64, max_staleness: u64) -> bool {
    available_at <= decision_time && decision_time - available_at <= max_staleness
}

struct Ema {
    config: Option<EmaConfig>,
    state: EmaTransition,
}

impl Ema {
    const fn empty() -> Self {
        Self {
            config: None,
            state: reset_ema(),
        }
    }

    fn configure(&mut self, period: usize) -> Result<(), ProgramFault> {
        self.config = EmaConfig::new(period);
        self.state = reset_ema();
        self.config
            .is_some()
            .then_some(())
            .ok_or(ProgramFault::ProgramRejected)
    }

    fn update(&mut self, value: f64) {
        self.state = self
            .config
            .expect("configured EMA")
            .transition(value, self.state);
    }
}

struct Wilder {
    config: Option<EmaConfig>,
    alpha: f64,
    state: EmaTransition,
}

impl Wilder {
    const fn empty() -> Self {
        Self {
            config: None,
            alpha: 0.0,
            state: reset_ema(),
        }
    }

    fn configure(&mut self, period: usize) -> Result<(), ProgramFault> {
        self.config = EmaConfig::new(period);
        self.alpha = 1.0 / period as f64;
        self.state = reset_ema();
        self.config
            .is_some()
            .then_some(())
            .ok_or(ProgramFault::ProgramRejected)
    }

    fn update(&mut self, value: f64) {
        self.state = self
            .config
            .expect("configured Wilder")
            .transition_with_alpha(self.alpha, value, self.state);
    }
}

struct Ring<const N: usize> {
    values: [f64; N],
    capacity: usize,
    next: usize,
    state: SmaTransition,
}

impl<const N: usize> Ring<N> {
    const fn empty() -> Self {
        Self {
            values: [0.0; N],
            capacity: 0,
            next: 0,
            state: reset_sma(),
        }
    }

    fn configure(&mut self, capacity: usize) -> Result<(), ProgramFault> {
        if capacity == 0 || capacity > N {
            return Err(ProgramFault::ProgramRejected);
        }
        self.capacity = capacity;
        self.next = 0;
        self.state = reset_sma();
        Ok(())
    }

    fn push(&mut self, value: f64) -> Result<(), ProgramFault> {
        let evicted = (self.state.count == self.capacity).then_some(self.values[self.next]);
        self.state = SmaConfig::new(self.capacity)
            .ok_or(ProgramFault::ProgramRejected)?
            .transition(value, evicted, self.state)
            .ok_or(ProgramFault::ProgramRejected)?;
        self.values[self.next] = value;
        self.next = (self.next + 1) % self.capacity;
        Ok(())
    }

    fn extreme(&self, combine: fn(f64, f64) -> f64) -> Option<f64> {
        let mut values = self.values[..self.state.count].iter().copied();
        Some(values.next()?).map(|first| values.fold(first, combine))
    }

    fn deviation(&self) -> f64 {
        if self.state.count == self.capacity {
            population_std_with_mean(
                self.values[self.next..self.capacity]
                    .iter()
                    .chain(self.values[..self.next].iter())
                    .copied(),
                self.state.value,
            )
        } else {
            population_std_with_mean(
                self.values[..self.state.count].iter().copied(),
                self.state.value,
            )
        }
    }
}

struct Rsi {
    gain: Wilder,
    loss: Wilder,
    last: f64,
    has_last: bool,
}

struct ContextBar {
    fast: Ema,
    slow: Ema,
    available_at: u64,
    seen: bool,
}

impl ContextBar {
    const fn empty() -> Self {
        Self {
            fast: Ema::empty(),
            slow: Ema::empty(),
            available_at: 0,
            seen: false,
        }
    }

    fn configure(&mut self, fast: usize, slow: usize) -> Result<(), ProgramFault> {
        self.fast.configure(fast)?;
        self.slow.configure(slow)
    }

    fn update(&mut self, close: f64, available_at: u64) -> Result<(), ProgramFault> {
        if self.seen && available_at <= self.available_at {
            return Err(ProgramFault::ProgramRejected);
        }
        self.fast.update(close);
        self.slow.update(close);
        self.available_at = available_at;
        self.seen = true;
        Ok(())
    }

    fn bullish_at(&self, decision_time: u64, max_staleness: u64) -> bool {
        self.seen
            && is_fresh(self.available_at, decision_time, max_staleness)
            && self.fast.state.initialized
            && self.slow.state.initialized
            && self.fast.state.value > self.slow.state.value
    }
}

impl Rsi {
    const fn empty() -> Self {
        Self {
            gain: Wilder::empty(),
            loss: Wilder::empty(),
            last: 0.0,
            has_last: false,
        }
    }

    fn configure(&mut self, period: usize) -> Result<(), ProgramFault> {
        self.gain.configure(period)?;
        self.loss.configure(period)?;
        self.last = 0.0;
        self.has_last = false;
        Ok(())
    }

    fn update(&mut self, close: f64) {
        if !self.has_last {
            self.last = close;
            self.has_last = true;
        }
        let change = close - self.last;
        self.gain.update(if change > 0.0 { change } else { 0.0 });
        self.loss.update(if change < 0.0 { -change } else { 0.0 });
        self.last = close;
    }

    fn value(&self) -> f64 {
        100.0 * relative_strength_index(self.gain.state.value, self.loss.state.value)
    }

    fn initialized(&self) -> bool {
        self.gain.state.initialized && self.loss.state.initialized
    }
}

struct ComplexProgram {
    channel: u32,
    executable: u32,
    variant: u8,
    representative: bool,
    features: u16,
    bar_channels: [u32; CONTEXT_BARS],
    scalar_channels: [u32; SCALARS],
    calendar_channel: u32,
    session_channel: u32,
    contexts: [ContextBar; CONTEXT_BARS],
    scalars: [Option<(u64, u64)>; SCALARS],
    bar_max_staleness: [u64; CONTEXT_BARS],
    scalar_max_staleness: [u64; SCALARS],
    event_kinds: [u8; MAX_EVENTS],
    event_times: [u64; MAX_EVENTS],
    event_count: usize,
    session_mask: u8,
    required_session_mask: u8,
    session_seen: bool,
    pre_blackout_ns: u64,
    post_blackout_ns: u64,
    quantity_precision: u8,
    band_sigma: f64,
    max_volatility_ratio: f64,
    rsi_entry_max: f64,
    target_risk_bps: f64,
    trailing_atr_multiple: f64,
    fixed_notional_bps: f64,
    bar_interval_ns: u64,
    initial_balance: f64,
    scope: Option<ProgramRunScope>,
    fast: Ema,
    slow: Ema,
    atr: Ring<MAX_ATR>,
    volatility_fast: Ring<MAX_VOL_FAST>,
    volatility_slow: Ring<MAX_VOL_SLOW>,
    band: Ring<MAX_BAND>,
    highs: Ring<MAX_BREAKOUT>,
    lows: Ring<MAX_EXIT>,
    rsi: Rsi,
    previous_close: Option<f64>,
    trailing_high: Option<f64>,
    next_order: u64,
}

impl ComplexProgram {
    const fn new() -> Self {
        Self {
            channel: 0,
            executable: 0,
            variant: u8::MAX,
            representative: false,
            features: 0,
            bar_channels: [0; CONTEXT_BARS],
            scalar_channels: [0; SCALARS],
            calendar_channel: 0,
            session_channel: 0,
            contexts: [const { ContextBar::empty() }; CONTEXT_BARS],
            scalars: [None; SCALARS],
            bar_max_staleness: [0; CONTEXT_BARS],
            scalar_max_staleness: [0; SCALARS],
            event_kinds: [0; MAX_EVENTS],
            event_times: [0; MAX_EVENTS],
            event_count: 0,
            session_mask: 0,
            required_session_mask: 0,
            session_seen: false,
            pre_blackout_ns: 0,
            post_blackout_ns: 0,
            quantity_precision: 0,
            band_sigma: 0.0,
            max_volatility_ratio: 0.0,
            rsi_entry_max: 0.0,
            target_risk_bps: 0.0,
            trailing_atr_multiple: 0.0,
            fixed_notional_bps: 0.0,
            bar_interval_ns: 0,
            initial_balance: 0.0,
            scope: None,
            fast: Ema::empty(),
            slow: Ema::empty(),
            atr: Ring::empty(),
            volatility_fast: Ring::empty(),
            volatility_slow: Ring::empty(),
            band: Ring::empty(),
            highs: Ring::empty(),
            lows: Ring::empty(),
            rsi: Rsi::empty(),
            previous_close: None,
            trailing_high: None,
            next_order: 1,
        }
    }

    fn ready(&self) -> bool {
        self.fast.state.initialized
            && self.slow.state.initialized
            && self.atr.state.initialized
            && self.volatility_fast.state.initialized
            && self.volatility_slow.state.initialized
            && self.band.state.initialized
            && self.highs.state.initialized
            && self.lows.state.initialized
            && self.rsi.initialized()
    }

    fn update(&mut self, bar: [f64; 5]) -> Result<(), ProgramFault> {
        self.fast.update(bar[3]);
        self.slow.update(bar[3]);
        let (range, close) = true_range(bar[1], bar[2], bar[3], self.previous_close);
        self.previous_close = Some(close);
        self.atr.push(range)?;
        self.volatility_fast.push(range)?;
        self.volatility_slow.push(range)?;
        self.band.push(typical_price(bar[1], bar[2], bar[3]))?;
        self.rsi.update(bar[3]);
        Ok(())
    }

    fn quantity(&self, balance: f64, close: f64) -> Result<f64, ProgramFault> {
        let cash_quantity = balance / close;
        let fixed = if self.representative {
            !self.enabled(DYNAMIC_ORDER)
        } else {
            self.variant == 3
        };
        let quantity = if fixed {
            cash_quantity * self.fixed_notional_bps / 10_000.0
        } else {
            let stop_distance = self.atr.state.value * self.trailing_atr_multiple;
            let risk_budget = self.initial_balance * self.target_risk_bps / 10_000.0;
            (risk_budget / stop_distance).min(cash_quantity)
        };
        let factor = 1_000_000.0;
        let quantity = libm::round(quantity * factor) / factor;
        (quantity.is_finite() && quantity >= 1.0 / factor)
            .then_some(quantity)
            .ok_or(ProgramFault::ProgramRejected)
    }

    fn enabled(&self, feature: u16) -> bool {
        self.features & feature != 0
    }

    fn entry_context(&self, decision_time: u64) -> bool {
        if !self.representative {
            return true;
        }
        let multi = !self.enabled(MULTI_TIMEFRAME)
            || self.contexts[1..4]
                .iter()
                .zip(&self.bar_max_staleness[1..4])
                .all(|(context, &max)| context.bullish_at(decision_time, max));
        let cross = !self.enabled(CROSS_ASSET)
            || (self.contexts[4].bullish_at(decision_time, self.bar_max_staleness[4])
                && (!self.enabled(MULTI_TIMEFRAME)
                    || self.contexts[5..8]
                        .iter()
                        .zip(&self.bar_max_staleness[5..8])
                        .all(|(context, &max)| context.bullish_at(decision_time, max)))
                && self
                    .scalars
                    .iter()
                    .zip(self.scalar_max_staleness)
                    .all(|(scalar, max)| {
                        scalar.is_some_and(|(_, available_at)| is_fresh(available_at, decision_time, max))
                    }));
        let gold = !self.enabled(GOLD)
            || self.contexts[8].bullish_at(decision_time, self.bar_max_staleness[8]);
        let events = !self.enabled(EVENTS)
            || (self.event_count != 0
                && !(0..self.event_count).any(|index| {
                    let scheduled = self.event_times[index];
                    decision_time >= scheduled.saturating_sub(self.pre_blackout_ns)
                        && decision_time <= scheduled.saturating_add(self.post_blackout_ns)
                }));
        let sessions = !self.enabled(SESSIONS)
            || (self.session_seen && self.session_mask & self.required_session_mask != 0);
        multi && cross && gold && events && sessions
    }

    fn bar_slot(&self, channel: u32) -> Option<usize> {
        self.bar_channels.iter().position(|bound| *bound == channel)
    }

    fn custom_slot(&self, channel: u32) -> Option<usize> {
        self.scalar_channels
            .iter()
            .position(|bound| *bound == channel)
    }

    fn observe_custom(
        &mut self,
        type_id: u32,
        channel: u32,
        payload: &[u8],
        ts_event: u64,
        available_at: u64,
    ) -> Result<(), ProgramFault> {
        if let Some(slot) = self.custom_slot(channel) {
            if type_id != SCALAR_RECORD || payload.len() != 8 {
                return Err(ProgramFault::MalformedFrame);
            }
            let value = read_f64(payload, 0)?;
            if !value.is_finite() {
                return Err(ProgramFault::ProgramRejected);
            }
            if self.scalars[slot].is_some_and(|(previous_event, previous_available)| {
                available_at < previous_available
                    || (available_at == previous_available && ts_event <= previous_event)
            }) {
                return Err(ProgramFault::ProgramRejected);
            }
            self.scalars[slot] = Some((ts_event, available_at));
        } else if channel == self.calendar_channel {
            if type_id != CALENDAR_RECORD
                || payload.len() != 16
                || !(1..=3).contains(&payload[0])
                || payload[1..8] != [0; 7]
            {
                return Err(ProgramFault::MalformedFrame);
            }
            let scheduled = read_u64(payload, 8)?;
            if scheduled <= available_at {
                return Err(ProgramFault::ProgramRejected);
            }
            for index in 0..self.event_count {
                if self.event_times[index] == scheduled {
                    return if self.event_kinds[index] == payload[0] {
                        Ok(())
                    } else {
                        Err(ProgramFault::ProgramRejected)
                    };
                }
            }
            if self.event_count == MAX_EVENTS {
                return Err(ProgramFault::ProgramRejected);
            }
            self.event_kinds[self.event_count] = payload[0];
            self.event_times[self.event_count] = scheduled;
            self.event_count += 1;
        } else if channel == self.session_channel {
            if type_id != SESSION_RECORD || payload.len() != 8 || payload[1..] != [0; 7] {
                return Err(ProgramFault::MalformedFrame);
            }
            self.session_mask = payload[0];
            self.session_seen = true;
        } else {
            return Err(ProgramFault::MalformedFrame);
        }
        Ok(())
    }

    fn action(
        &mut self,
        side: OrderSide,
        quantity: f64,
        reduce_only: bool,
        tag: u32,
    ) -> Result<Action, ProgramFault> {
        let action = Action::Submit {
            kind: OrderKind::Market,
            instrument: self.executable,
            handle: self.next_order,
            side,
            quantity,
            price: 0.0,
            trigger_price: 0.0,
            reduce_only,
            decision_tag: tag,
        };
        self.next_order += 1;
        Ok(action)
    }
}

impl StrategyProgram for ComplexProgram {
    fn on_start(
        &mut self,
        frame: &Frame<'_>,
        _actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let bytes = frame.parameters();
        if self.scope.is_some() {
            return Err(ProgramFault::MalformedFrame);
        }
        let period_offset = if bytes.len() == 56 {
            self.channel = read_u32(bytes, 0)?;
            self.executable = read_u32(bytes, 4)?;
            self.bar_channels[0] = self.channel;
            self.variant = bytes[26];
            self.quantity_precision = bytes[27];
            self.band_sigma = f64::from(read_u16(bytes, 28)?) / 1_000.0;
            self.max_volatility_ratio = f64::from(read_u16(bytes, 30)?) / 1_000.0;
            self.rsi_entry_max = f64::from(read_u16(bytes, 32)?) / 1_000.0;
            self.target_risk_bps = f64::from(read_u16(bytes, 34)?);
            self.trailing_atr_multiple = f64::from(read_u16(bytes, 36)?) / 1_000.0;
            self.fixed_notional_bps = f64::from(read_u16(bytes, 38)?);
            self.bar_interval_ns = read_u64(bytes, 40)?;
            self.initial_balance = read_f64(bytes, 48)?;
            8
        } else if bytes.len() == 172
            && bytes[..4] == *b"RPF1"
            && bytes[4] == 2
            && bytes[167..] == [0; 5]
        {
            self.representative = true;
            self.quantity_precision = bytes[5];
            self.features = read_u16(bytes, 6)?;
            self.executable = read_u32(bytes, 8)?;
            for (slot, channel) in self.bar_channels.iter_mut().enumerate() {
                *channel = read_u32(bytes, 12 + slot * 4)?;
            }
            self.channel = self.bar_channels[0];
            for (slot, channel) in self.scalar_channels.iter_mut().enumerate() {
                *channel = read_u32(bytes, 48 + slot * 4)?;
            }
            self.calendar_channel = read_u32(bytes, 68)?;
            self.session_channel = read_u32(bytes, 72)?;
            self.band_sigma = f64::from(read_u16(bytes, 94)?) / 1_000.0;
            self.max_volatility_ratio = f64::from(read_u16(bytes, 96)?) / 1_000.0;
            self.rsi_entry_max = f64::from(read_u16(bytes, 98)?) / 1_000.0;
            self.target_risk_bps = f64::from(read_u16(bytes, 100)?);
            self.trailing_atr_multiple = f64::from(read_u16(bytes, 102)?) / 1_000.0;
            self.fixed_notional_bps = f64::from(read_u16(bytes, 104)?);
            self.pre_blackout_ns = read_u64(bytes, 106)?;
            self.post_blackout_ns = read_u64(bytes, 114)?;
            self.bar_interval_ns = read_u64(bytes, 122)?;
            self.initial_balance = read_f64(bytes, 130)?;
            self.required_session_mask = bytes[138];
            for (slot, max_staleness) in self.bar_max_staleness.iter_mut().enumerate() {
                *max_staleness = u64::from(read_u16(bytes, 139 + slot * 2)?)
                    .checked_mul(HOUR_NS)
                    .ok_or(ProgramFault::ProgramRejected)?;
            }
            for (slot, max_staleness) in self.scalar_max_staleness.iter_mut().enumerate() {
                *max_staleness = u64::from(read_u16(bytes, 157 + slot * 2)?)
                    .checked_mul(HOUR_NS)
                    .ok_or(ProgramFault::ProgramRejected)?;
            }
            76
        } else {
            return Err(ProgramFault::MalformedFrame);
        };
        let atr_period = usize::from(read_u16(bytes, period_offset)?);
        let band_period = usize::from(read_u16(bytes, period_offset + 2)?);
        let breakout = usize::from(read_u16(bytes, period_offset + 4)?);
        let exit = usize::from(read_u16(bytes, period_offset + 6)?);
        let fast = usize::from(read_u16(bytes, period_offset + 8)?);
        let rsi = usize::from(read_u16(bytes, period_offset + 10)?);
        let slow = usize::from(read_u16(bytes, period_offset + 12)?);
        let volatility_fast = usize::from(read_u16(bytes, period_offset + 14)?);
        let volatility_slow = usize::from(read_u16(bytes, period_offset + 16)?);

        if self.channel == 0
            || self.executable == 0
            || self.quantity_precision != 6
            || slow <= fast
            || breakout < exit
            || volatility_slow <= volatility_fast
            || !(1.0..=3.0).contains(&self.max_volatility_ratio)
            || !(0.0..50.0).contains(&self.rsi_entry_max)
            || !(1.0..=5.0).contains(&self.trailing_atr_multiple)
            || !(1.0..=4.0).contains(&self.band_sigma)
            || self.target_risk_bps <= 0.0
            || self.target_risk_bps > 100.0
            || self.bar_interval_ns == 0
            || !self.initial_balance.is_finite()
            || self.initial_balance <= 0.0
            || (!self.representative
                && (self.variant > 4 || (self.variant == 3) != (self.fixed_notional_bps > 0.0)))
            || (self.representative
                && (self.features & !ALL_FEATURES != 0
                    || self.fixed_notional_bps <= 0.0
                    || self.bar_channels.contains(&0)
                    || self.scalar_channels.contains(&0)
                    || self.calendar_channel == 0
                    || self.session_channel == 0
                    || !unique(&self.bar_channels)
                    || !unique(&self.scalar_channels)
                    || self.scalar_channels.contains(&self.calendar_channel)
                    || self.scalar_channels.contains(&self.session_channel)
                    || self.calendar_channel == self.session_channel
                    || (self.enabled(SESSIONS) && self.required_session_mask == 0)))
        {
            return Err(ProgramFault::ProgramRejected);
        }
        self.fast.configure(fast)?;
        self.slow.configure(slow)?;
        self.atr.configure(atr_period)?;
        self.volatility_fast.configure(volatility_fast)?;
        self.volatility_slow.configure(volatility_slow)?;
        self.band.configure(band_period)?;
        self.highs.configure(breakout)?;
        self.lows.configure(exit)?;
        self.rsi.configure(rsi)?;
        if self.representative {
            for context in &mut self.contexts {
                context.configure(fast, slow)?;
            }
        }
        self.scope = frame.run_scope;
        Ok(())
    }

    fn on_frame(
        &mut self,
        frame: &Frame<'_>,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let scope = self.scope.ok_or(ProgramFault::ProgramRejected)?;
        let mut bar = None;
        let mut position = None;
        let mut pending = None;
        let mut balance = None;
        let mut order_event = false;
        let mut custom = None;
        let mut record_count = 0;

        for record in frame.records() {
            let record = record?;
            record_count += 1;
            match record.meta.type_id {
                BAR_RECORD
                    if record.meta.channel == self.channel
                        || (self.representative
                            && self.bar_slot(record.meta.channel).is_some()) =>
                {
                    if bar
                        .replace((
                            record.f64s::<5>(BAR_RECORD)?,
                            record.meta.available_at,
                            self.bar_slot(record.meta.channel).unwrap_or(0),
                        ))
                        .is_some()
                    {
                        return Err(ProgramFault::MalformedFrame);
                    }
                }
                POSITION_RECORD if record.meta.channel == self.executable => {
                    if position.replace(record.scalar()?).is_some() {
                        return Err(ProgramFault::MalformedFrame);
                    }
                }
                ORDER_RECORD if record.meta.channel == self.executable => {
                    if pending.replace(record.scalar()?).is_some() {
                        return Err(ProgramFault::MalformedFrame);
                    }
                }
                BALANCE_RECORD if record.meta.channel == self.executable => {
                    if balance.replace(record.scalar()?).is_some() {
                        return Err(ProgramFault::MalformedFrame);
                    }
                }
                ORDER_EVENT_RECORD if record.meta.channel == self.executable => {
                    record.order_event()?;
                    order_event = true;
                }
                type_id if self.representative && type_id >= SCALAR_RECORD => {
                    if custom.replace(record).is_some() {
                        return Err(ProgramFault::MalformedFrame);
                    }
                }
                _ => return Err(ProgramFault::MalformedFrame),
            }
        }
        if order_event {
            if record_count != 1
                || bar.is_some()
                || position.is_some()
                || pending.is_some()
                || balance.is_some()
                || custom.is_some()
            {
                return Err(ProgramFault::MalformedFrame);
            }
            return Ok(());
        }
        if let Some(record) = custom {
            if record_count != 1
                || bar.is_some()
                || position.is_some()
                || pending.is_some()
                || balance.is_some()
                || record.meta.codec_version != 1
            {
                return Err(ProgramFault::MalformedFrame);
            }
            return self.observe_custom(
                record.meta.type_id,
                record.meta.channel,
                record.payload,
                record.meta.ts_event,
                record.meta.available_at,
            );
        }
        let (bar, available_at, bar_slot) = bar.ok_or(ProgramFault::MalformedFrame)?;
        let position = position.ok_or(ProgramFault::MalformedFrame)?;
        let pending = pending.ok_or(ProgramFault::MalformedFrame)?;
        let balance = balance.ok_or(ProgramFault::MalformedFrame)?;

        if record_count != 4
            || position < 0.0
            || pending < 0.0
            || balance < 0.0
            || bar[2] <= 0.0
            || bar[1] < bar[2]
            || !(bar[2]..=bar[1]).contains(&bar[0])
            || !(bar[2]..=bar[1]).contains(&bar[3])
        {
            return Err(ProgramFault::ProgramRejected);
        }
        if self.representative {
            if !bar.iter().all(|value| value.is_finite()) {
                return Err(ProgramFault::ProgramRejected);
            }
            self.contexts[bar_slot].update(bar[3], available_at)?;
            if bar_slot != 0 {
                return Ok(());
            }
        }
        let prior_high = self.highs.extreme(f64::max);
        let prior_low = self.lows.extreme(f64::min);
        self.update(bar)?;
        let decision_time = (scope.decision_start_ns..scope.end_ns).contains(&available_at);
        let is_long = position > 0.0;
        self.trailing_high = if is_long {
            Some(self.trailing_high.map_or(bar[1], |high| high.max(bar[1])))
        } else {
            None
        };
        let proposal = if decision_time && self.ready() && pending == 0.0 {
            let terminal = available_at.checked_add(self.bar_interval_ns) == Some(scope.end_ns);
            let ratio = volatility_ratio(
                self.volatility_slow.state.value,
                self.volatility_fast.state.value,
                0.0,
            );

            if ratio <= 0.0 {
                return Err(ProgramFault::ProgramRejected);
            }
            let ratio = 1.0 / ratio;
            let bullish = (!self.representative && self.variant == 2)
                || (self.fast.state.value > self.slow.state.value
                    && ratio <= self.max_volatility_ratio);
            let lower_band = bands(
                self.band.state.value,
                self.band.deviation(),
                self.band_sigma,
            )
            .2;
            let breakout_entry = bar[3] > prior_high.ok_or(ProgramFault::ProgramRejected)?;
            let band_entry = bar[3] < lower_band && self.rsi.value() <= self.rsi_entry_max;
            let position_management = if self.representative {
                self.enabled(DYNAMIC_POSITION)
            } else {
                self.variant != 4
            };
            let entry_context = self.entry_context(available_at);
            let tag = if terminal && is_long {
                6
            } else if is_long
                && position_management
                && bar[3]
                    <= self.trailing_high.ok_or(ProgramFault::ProgramRejected)?
                        - self.trailing_atr_multiple * self.atr.state.value
            {
                3
            } else if is_long
                && position_management
                && bar[3] < prior_low.ok_or(ProgramFault::ProgramRejected)?
            {
                4
            } else if is_long
                && position_management
                && (self.representative || self.variant != 2)
                && !bullish
            {
                5
            } else if !is_long
                && bullish
                && entry_context
                && (!self.representative || self.enabled(STRUCTURE))
                && breakout_entry
            {
                1
            } else if !is_long
                && bullish
                && entry_context
                && (!self.representative || self.enabled(STRUCTURE))
                && (self.representative || self.variant != 1)
                && band_entry
            {
                2
            } else if !is_long
                && self.representative
                && bullish
                && entry_context
                && !self.enabled(STRUCTURE)
            {
                1
            } else {
                0
            };

            match tag {
                1 | 2 => Some(self.action(
                    OrderSide::Buy,
                    self.quantity(balance, bar[3])?,
                    false,
                    tag,
                )?),
                3..=6 => Some(self.action(OrderSide::Sell, position, true, tag)?),
                _ => None,
            }
        } else {
            None
        };
        self.highs.push(bar[1])?;
        self.lows.push(bar[2])?;
        if let Some(action) = proposal {
            actions.push(action)?;
        }
        Ok(())
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProgramFault> {
    bytes
        .get(offset..offset + 2)
        .and_then(|value| value.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or(ProgramFault::MalformedFrame)
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProgramFault> {
    bytes
        .get(offset..offset + 4)
        .and_then(|value| value.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or(ProgramFault::MalformedFrame)
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProgramFault> {
    bytes
        .get(offset..offset + 8)
        .and_then(|value| value.try_into().ok())
        .map(u64::from_le_bytes)
        .ok_or(ProgramFault::MalformedFrame)
}

fn read_f64(bytes: &[u8], offset: usize) -> Result<f64, ProgramFault> {
    Ok(f64::from_bits(read_u64(bytes, offset)?))
}

fn unique<const N: usize>(values: &[u32; N]) -> bool {
    (0..N).all(|left| (left + 1..N).all(|right| values[left] != values[right]))
}

export_strategy_program!(ComplexProgram, ComplexProgram::new());

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
