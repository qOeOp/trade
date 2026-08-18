#![no_std]

use core::panic::PanicInfo;
use strategy_factory_program_sdk::{
    Action, ActionEncoder, BAR_RECORD, Frame, ORDER_EVENT_RECORD, OrderKind, OrderSide,
    POSITION_RECORD, ProgramFault, StrategyProgram, export_strategy_program, order_event,
};

const ENTRY: u64 = 1;
const TAKE_PROFIT: u64 = 2;
const STOP_LOSS: u64 = 3;
const EXIT: u64 = 4;

struct ChannelControl {
    expected: u64,
    seen: u64,
    clock: u32,
    executable: u32,
    custom_type: u32,
    custom_channel: u32,
    freshness_mask: u64,
    max_staleness_ns: u64,
    last_available: [u64; 64],
    quantity: f64,
    phase: u8,
    entry_price: f64,
    event_mask: u8,
}

impl ChannelControl {
    const fn new() -> Self {
        Self {
            expected: 0,
            seen: 0,
            clock: 0,
            executable: 0,
            custom_type: 0,
            custom_channel: 0,
            freshness_mask: 0,
            max_staleness_ns: 0,
            last_available: [0; 64],
            quantity: 0.0,
            phase: 0,
            entry_price: 0.0,
            event_mask: 0,
        }
    }

    fn event_bit(handle: u64) -> Result<u8, ProgramFault> {
        match handle {
            TAKE_PROFIT => Ok(1),
            STOP_LOSS => Ok(2),
            _ => Err(ProgramFault::ProgramRejected),
        }
    }

    fn on_order_event(
        &mut self,
        event: (u64, u8, u8, f64, f64),
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let (handle, code, side, filled, last_price) = event;
        if matches!(
            code,
            order_event::REJECTED
                | order_event::MODIFY_REJECTED
                | order_event::CANCEL_REJECTED
                | order_event::PARTIALLY_FILLED
        ) {
            return Err(ProgramFault::ProgramRejected);
        }
        match (self.phase, handle, code) {
            (1, ENTRY, order_event::FILLED)
                if side == OrderSide::Buy as u8
                    && filled == self.quantity
                    && last_price.is_finite()
                    && last_price > 0.0 =>
            {
                let price_anchor = last_price as u64 as f64;
                if price_anchor <= 0.0 {
                    return Err(ProgramFault::ProgramRejected);
                }
                self.entry_price = price_anchor;
                self.phase = 2;
                self.event_mask = 0;
                actions.push(Action::Submit {
                    kind: OrderKind::Limit,
                    instrument: self.executable,
                    handle: TAKE_PROFIT,
                    side: OrderSide::Sell,
                    quantity: self.quantity,
                    price: price_anchor * 2.0,
                    trigger_price: 0.0,
                    reduce_only: true,
                    decision_tag: 10,
                })?;
                actions.push(Action::Submit {
                    kind: OrderKind::StopMarket,
                    instrument: self.executable,
                    handle: STOP_LOSS,
                    side: OrderSide::Sell,
                    quantity: self.quantity,
                    price: 0.0,
                    trigger_price: price_anchor * 0.5,
                    reduce_only: true,
                    decision_tag: 11,
                })?;
            }
            (2, TAKE_PROFIT | STOP_LOSS, order_event::ACCEPTED)
                if side == OrderSide::Sell as u8 =>
            {
                self.event_mask |= Self::event_bit(handle)?;
                if self.event_mask == 3 {
                    self.phase = 3;
                    self.event_mask = 0;
                }
            }
            (4, TAKE_PROFIT | STOP_LOSS, order_event::UPDATED) if side == OrderSide::Sell as u8 => {
                self.event_mask |= Self::event_bit(handle)?;
                if self.event_mask == 3 {
                    self.phase = 5;
                    self.event_mask = 0;
                }
            }
            (6, TAKE_PROFIT | STOP_LOSS, order_event::CANCELED)
                if side == OrderSide::Sell as u8 =>
            {
                self.event_mask |= Self::event_bit(handle)?;
                if self.event_mask == 3 {
                    self.phase = 7;
                    actions.push(Action::Submit {
                        kind: OrderKind::Market,
                        instrument: self.executable,
                        handle: EXIT,
                        side: OrderSide::Sell,
                        quantity: self.quantity,
                        price: 0.0,
                        trigger_price: 0.0,
                        reduce_only: true,
                        decision_tag: 12,
                    })?;
                }
            }
            (7, EXIT, order_event::FILLED)
                if side == OrderSide::Sell as u8 && filled == self.quantity =>
            {
                self.phase = 8;
            }
            (_, TAKE_PROFIT | STOP_LOSS, order_event::FILLED) => {
                return Err(ProgramFault::ProgramRejected);
            }
            _ => {}
        }
        Ok(())
    }

    fn fresh_at(&self, decision_time_ns: u64) -> bool {
        self.freshness_mask == 0
            || (0..64).all(|channel| {
                let bit = 1_u64 << channel;
                if self.freshness_mask & bit == 0 {
                    return true;
                }
                let available_at = self.last_available[channel];
                available_at != 0
                    && decision_time_ns > available_at
                    && decision_time_ns - available_at <= self.max_staleness_ns
            })
    }
}

impl StrategyProgram for ChannelControl {
    fn on_start(
        &mut self,
        frame: &Frame<'_>,
        _actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let parameters = frame.parameters();
        if parameters.len() != 32 && parameters.len() != 48 {
            return Err(ProgramFault::MalformedFrame);
        }
        self.expected = u64::from_le_bytes(
            parameters[0..8]
                .try_into()
                .map_err(|_| ProgramFault::MalformedFrame)?,
        );
        self.clock = u32::from_le_bytes(
            parameters[8..12]
                .try_into()
                .map_err(|_| ProgramFault::MalformedFrame)?,
        );
        self.executable = u32::from_le_bytes(
            parameters[12..16]
                .try_into()
                .map_err(|_| ProgramFault::MalformedFrame)?,
        );
        self.custom_type = u32::from_le_bytes(
            parameters[16..20]
                .try_into()
                .map_err(|_| ProgramFault::MalformedFrame)?,
        );
        self.custom_channel = u32::from_le_bytes(
            parameters[20..24]
                .try_into()
                .map_err(|_| ProgramFault::MalformedFrame)?,
        );
        self.quantity = f64::from_bits(u64::from_le_bytes(
            parameters[24..32]
                .try_into()
                .map_err(|_| ProgramFault::MalformedFrame)?,
        ));
        if parameters.len() == 48 {
            self.freshness_mask = u64::from_le_bytes(
                parameters[32..40]
                    .try_into()
                    .map_err(|_| ProgramFault::MalformedFrame)?,
            );
            self.max_staleness_ns = u64::from_le_bytes(
                parameters[40..48]
                    .try_into()
                    .map_err(|_| ProgramFault::MalformedFrame)?,
            );
        }

        if self.expected == 0
            || self.clock >= 64
            || self.executable >= 64
            || self.custom_type < 1_024
            || self.custom_channel >= 64
            || self.expected & (1_u64 << self.clock) == 0
            || self.expected & (1_u64 << self.custom_channel) == 0
            || self.freshness_mask & !self.expected != 0
            || (self.freshness_mask != 0 && self.max_staleness_ns == 0)
            || !self.quantity.is_finite()
            || self.quantity <= 0.0
        {
            return Err(ProgramFault::ProgramRejected);
        }
        Ok(())
    }

    fn on_frame(
        &mut self,
        frame: &Frame<'_>,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        let mut clock_observed = false;
        let mut position = 0.0;

        for record in frame.records() {
            let record = record?;
            match record.meta.type_id {
                BAR_RECORD => {
                    record.f64s::<5>(BAR_RECORD)?;
                    if record.meta.channel >= 64 {
                        return Err(ProgramFault::ProgramRejected);
                    }
                    self.seen |= 1_u64 << record.meta.channel;
                    clock_observed |= record.meta.channel == self.clock;
                }
                POSITION_RECORD if record.meta.channel == self.executable => {
                    position = record.scalar()?;
                }
                ORDER_EVENT_RECORD if record.meta.channel == self.executable => {
                    self.on_order_event(record.order_event()?, actions)?;
                }
                type_id
                    if type_id >= 1_024
                        && record.meta.channel < 64
                        && record.meta.codec_version == 1
                        && self.expected & (1_u64 << record.meta.channel) != 0
                        && ((type_id == self.custom_type
                            && record.meta.channel == self.custom_channel)
                            || self.freshness_mask & (1_u64 << record.meta.channel) != 0)
                        && !record.payload.is_empty() =>
                {
                    self.seen |= 1_u64 << record.meta.channel;
                    self.last_available[record.meta.channel as usize] = record.meta.available_at;
                }
                _ => {}
            }
        }

        if self.phase == 0
            && clock_observed
            && self.seen == self.expected
            && self.fresh_at(frame.decision_time_ns)
            && position == 0.0
        {
            actions.push(Action::Submit {
                kind: OrderKind::Market,
                instrument: self.executable,
                handle: ENTRY,
                side: OrderSide::Buy,
                quantity: self.quantity,
                price: 0.0,
                trigger_price: 0.0,
                reduce_only: false,
                decision_tag: 0,
            })?;
            self.phase = 1;
        } else if self.phase == 3 && clock_observed && position == self.quantity {
            self.phase = 4;
            actions.push(Action::Modify {
                handle: TAKE_PROFIT,
                quantity: None,
                price: Some(self.entry_price * 1.75),
                trigger_price: None,
            })?;
            actions.push(Action::Modify {
                handle: STOP_LOSS,
                quantity: None,
                price: None,
                trigger_price: Some(self.entry_price * 0.625),
            })?;
        } else if self.phase == 5 && clock_observed && position == self.quantity {
            self.phase = 6;
            actions.push(Action::Cancel(TAKE_PROFIT))?;
            actions.push(Action::Cancel(STOP_LOSS))?;
        }
        Ok(())
    }
}

export_strategy_program!(ChannelControl, ChannelControl::new());

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
