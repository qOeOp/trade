#![no_std]

use core::panic::PanicInfo;
use strategy_factory_program_sdk::{
    Action, ActionEncoder, BALANCE_RECORD, BAR_RECORD, Frame, ORDER_RECORD, OrderKind, OrderSide,
    POSITION_RECORD, ProgramFault, ProgramRunScope, StrategyProgram, export_strategy_program,
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
        let quantity = if self.variant == 3 {
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
        if bytes.len() != 56 || self.scope.is_some() {
            return Err(ProgramFault::MalformedFrame);
        }
        self.channel = read_u32(bytes, 0)?;
        self.executable = read_u32(bytes, 4)?;
        let atr_period = usize::from(read_u16(bytes, 8)?);
        let band_period = usize::from(read_u16(bytes, 10)?);
        let breakout = usize::from(read_u16(bytes, 12)?);
        let exit = usize::from(read_u16(bytes, 14)?);
        let fast = usize::from(read_u16(bytes, 16)?);
        let rsi = usize::from(read_u16(bytes, 18)?);
        let slow = usize::from(read_u16(bytes, 20)?);
        let volatility_fast = usize::from(read_u16(bytes, 22)?);
        let volatility_slow = usize::from(read_u16(bytes, 24)?);
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

        if self.channel == 0
            || self.executable == 0
            || self.variant > 4
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
            || (self.variant == 3) != (self.fixed_notional_bps > 0.0)
            || self.bar_interval_ns == 0
            || !self.initial_balance.is_finite()
            || self.initial_balance <= 0.0
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

        for record in frame.records() {
            let record = record?;
            match record.meta.type_id {
                BAR_RECORD if record.meta.channel == self.channel => {
                    if bar
                        .replace((record.f64s::<5>(BAR_RECORD)?, record.meta.available_at))
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
                _ => {}
            }
        }
        let (bar, available_at) = bar.ok_or(ProgramFault::MalformedFrame)?;
        let position = position.ok_or(ProgramFault::MalformedFrame)?;
        let pending = pending.ok_or(ProgramFault::MalformedFrame)?;
        let balance = balance.ok_or(ProgramFault::MalformedFrame)?;

        if position < 0.0
            || pending < 0.0
            || balance < 0.0
            || bar[2] <= 0.0
            || bar[1] < bar[2]
            || !(bar[2]..=bar[1]).contains(&bar[0])
            || !(bar[2]..=bar[1]).contains(&bar[3])
        {
            return Err(ProgramFault::ProgramRejected);
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
            let bullish = self.variant == 2
                || (self.fast.state.value > self.slow.state.value
                    && ratio <= self.max_volatility_ratio);
            let lower_band = bands(
                self.band.state.value,
                self.band.deviation(),
                self.band_sigma,
            )
            .2;
            let tag = if terminal && is_long {
                6
            } else if is_long
                && self.variant != 4
                && bar[3]
                    <= self.trailing_high.ok_or(ProgramFault::ProgramRejected)?
                        - self.trailing_atr_multiple * self.atr.state.value
            {
                3
            } else if is_long
                && self.variant != 4
                && bar[3] < prior_low.ok_or(ProgramFault::ProgramRejected)?
            {
                4
            } else if is_long && self.variant != 4 && self.variant != 2 && !bullish {
                5
            } else if !is_long
                && bullish
                && bar[3] > prior_high.ok_or(ProgramFault::ProgramRejected)?
            {
                1
            } else if !is_long
                && bullish
                && self.variant != 1
                && bar[3] < lower_band
                && self.rsi.value() <= self.rsi_entry_max
            {
                2
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

export_strategy_program!(ComplexProgram, ComplexProgram::new());

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
