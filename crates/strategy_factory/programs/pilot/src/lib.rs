#![no_std]

use core::panic::PanicInfo;
use strategy_factory_program_sdk::{
    Action, ActionEncoder, BAR_RECORD, Frame, ORDER_RECORD, OrderKind, OrderSide, POSITION_RECORD,
    ProgramFault, StrategyProgram, export_strategy_program,
};
use vibe_indicators_kernel::{EmaConfig, EmaTransition, reset_ema};

const MAX_LOOKBACK: usize = 128;

struct Ema {
    config: Option<EmaConfig>,
    value: f64,
    count: usize,
    initialized: bool,
    has_inputs: bool,
}

impl Ema {
    const fn empty() -> Self {
        Self {
            config: None,
            value: 0.0,
            count: 0,
            initialized: false,
            has_inputs: false,
        }
    }

    fn configure(&mut self, period: usize) -> Result<(), ProgramFault> {
        if period == 0 || period > MAX_LOOKBACK {
            return Err(ProgramFault::ProgramRejected);
        }
        self.config = EmaConfig::new(period);
        let reset = reset_ema();
        self.value = reset.value;
        self.count = reset.count;
        self.initialized = reset.initialized;
        self.has_inputs = reset.has_inputs;
        Ok(())
    }

    fn update(&mut self, value: f64) {
        let next = self.config.expect("configured EMA").transition(
            value,
            EmaTransition {
                value: self.value,
                count: self.count,
                initialized: self.initialized,
                has_inputs: self.has_inputs,
            },
        );
        self.value = next.value;
        self.count = next.count;
        self.initialized = next.initialized;
        self.has_inputs = next.has_inputs;
    }

    const fn initialized(&self) -> bool {
        self.initialized
    }
}

struct Window {
    values: [f64; MAX_LOOKBACK],
    capacity: usize,
    length: usize,
    next: usize,
}

impl Window {
    const fn empty() -> Self {
        Self {
            values: [0.0; MAX_LOOKBACK],
            capacity: 0,
            length: 0,
            next: 0,
        }
    }

    fn configure(&mut self, capacity: usize) -> Result<(), ProgramFault> {
        if capacity == 0 || capacity > MAX_LOOKBACK {
            return Err(ProgramFault::ProgramRejected);
        }
        self.capacity = capacity;
        self.length = 0;
        self.next = 0;
        Ok(())
    }

    fn push(&mut self, value: f64) {
        self.values[self.next] = value;
        self.next = (self.next + 1) % self.capacity;
        self.length = self.length.saturating_add(1).min(self.capacity);
    }

    fn max(&self) -> Option<f64> {
        self.extreme(f64::max)
    }

    fn min(&self) -> Option<f64> {
        self.extreme(f64::min)
    }

    fn extreme(&self, combine: fn(f64, f64) -> f64) -> Option<f64> {
        let mut values = self.values[..self.length].iter().copied();
        let first = values.next()?;
        Some(values.fold(first, combine))
    }

    const fn initialized(&self) -> bool {
        self.length == self.capacity
    }
}

struct PilotProgram {
    channel: u32,
    executable: u32,
    quantity: f64,
    decision_start: u64,
    decision_end: u64,
    terminal_open: u64,
    close_offset: u64,
    fast: Ema,
    slow: Ema,
    highs: Window,
    lows: Window,
    next_order: u64,
    configured: bool,
}

impl PilotProgram {
    const fn new() -> Self {
        Self {
            channel: 0,
            executable: 0,
            quantity: 0.0,
            decision_start: 0,
            decision_end: 0,
            terminal_open: 0,
            close_offset: 0,
            fast: Ema::empty(),
            slow: Ema::empty(),
            highs: Window::empty(),
            lows: Window::empty(),
            next_order: 1,
            configured: false,
        }
    }
}

impl StrategyProgram for PilotProgram {
    fn on_start(
        &mut self,
        frame: &Frame<'_>,
        _actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let parameters = frame.parameters();
        if parameters.len() != 56 {
            return Err(ProgramFault::MalformedFrame);
        }
        self.channel = read_u32(parameters, 0)?;
        self.executable = read_u32(parameters, 4)?;
        self.fast.configure(usize::from(read_u16(parameters, 8)?))?;
        self.slow
            .configure(usize::from(read_u16(parameters, 10)?))?;
        self.highs
            .configure(usize::from(read_u16(parameters, 12)?))?;
        self.lows
            .configure(usize::from(read_u16(parameters, 14)?))?;
        self.quantity = read_f64(parameters, 16)?;
        self.decision_start = read_u64(parameters, 24)?;
        self.decision_end = read_u64(parameters, 32)?;
        self.terminal_open = read_u64(parameters, 40)?;
        self.close_offset = read_u64(parameters, 48)?;

        if !self.quantity.is_finite()
            || self.quantity <= 0.0
            || self.decision_start >= self.decision_end
            || !(self.decision_start..self.decision_end).contains(&self.terminal_open)
            || self.close_offset == 0
        {
            return Err(ProgramFault::ProgramRejected);
        }
        self.configured = true;
        Ok(())
    }

    fn on_frame(
        &mut self,
        frame: &Frame<'_>,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        if !self.configured {
            return Err(ProgramFault::ProgramRejected);
        }
        let mut bar = None;
        let mut position = 0.0;
        let mut pending = 0.0;
        let mut ts_event = 0;

        for record in frame.records() {
            let record = record?;
            match record.meta.type_id {
                BAR_RECORD if record.meta.channel == self.channel => {
                    if bar.is_some() {
                        return Err(ProgramFault::MalformedFrame);
                    }
                    bar = Some(record.f64s::<5>(BAR_RECORD)?);
                    ts_event = record.meta.ts_event;
                }
                POSITION_RECORD if record.meta.channel == self.executable => {
                    position = record.scalar()?;
                }
                ORDER_RECORD if record.meta.channel == self.executable => {
                    pending = record.scalar()?;
                }
                _ => {}
            }
        }
        let Some(bar) = bar else {
            return Ok(());
        };
        let prior_high = self.highs.max();
        let prior_low = self.lows.min();
        self.fast.update(bar[3]);
        self.slow.update(bar[3]);
        let open_ns = ts_event
            .checked_sub(self.close_offset)
            .ok_or(ProgramFault::MalformedFrame)?;

        let proposal = if (self.decision_start..self.decision_end).contains(&open_ns)
            && self.fast.initialized()
            && self.slow.initialized()
            && self.highs.initialized()
            && self.lows.initialized()
            && pending == 0.0
        {
            let is_long = position > 0.0;
            if open_ns == self.terminal_open && is_long {
                Some(self.propose(OrderSide::Sell, position, true)?)
            } else if !is_long
                && self.fast.value > self.slow.value
                && bar[3] > prior_high.ok_or(ProgramFault::ProgramRejected)?
            {
                Some(self.propose(OrderSide::Buy, self.quantity, false)?)
            } else if is_long
                && (bar[3] < prior_low.ok_or(ProgramFault::ProgramRejected)?
                    || self.fast.value <= self.slow.value)
            {
                Some(self.propose(OrderSide::Sell, position, true)?)
            } else {
                None
            }
        } else {
            None
        };
        self.highs.push(bar[1]);
        self.lows.push(bar[2]);
        if let Some(action) = proposal {
            actions.push(action)?;
        }
        Ok(())
    }
}

impl PilotProgram {
    fn propose(
        &mut self,
        side: OrderSide,
        quantity: f64,
        reduce_only: bool,
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
            decision_tag: 0,
        };
        self.next_order += 1;
        Ok(action)
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProgramFault> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or(ProgramFault::MalformedFrame)?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProgramFault> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or(ProgramFault::MalformedFrame)?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProgramFault> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or(ProgramFault::MalformedFrame)?;
    Ok(u64::from_le_bytes([
        value[0], value[1], value[2], value[3], value[4], value[5], value[6], value[7],
    ]))
}

fn read_f64(bytes: &[u8], offset: usize) -> Result<f64, ProgramFault> {
    Ok(f64::from_bits(read_u64(bytes, offset)?))
}

export_strategy_program!(PilotProgram, PilotProgram::new());

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
