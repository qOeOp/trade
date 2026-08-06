use std::{any::Any, collections::VecDeque};

use ustr::Ustr;
use vibe_common::{messages::execution::TradingCommand, msgbus::Handler};
use vibe_core::WeakCell;
use vibe_model::events::OrderEventAny;

use super::{PendingMessage, emulator::OrderEmulator};

#[derive(Debug)]
pub struct OrderEmulatorExecuteHandler {
    id: Ustr,
    emulator: WeakCell<OrderEmulator>,
}

impl OrderEmulatorExecuteHandler {
    #[inline]
    #[must_use]
    pub const fn new(id: Ustr, emulator: WeakCell<OrderEmulator>) -> Self {
        Self { id, emulator }
    }
}

impl Handler<dyn Any> for OrderEmulatorExecuteHandler {
    fn id(&self) -> Ustr {
        self.id
    }

    fn handle(&self, msg: &dyn Any) {
        if let Some(emulator) = self.emulator.upgrade() {
            if let Some(command) = msg.downcast_ref::<TradingCommand>() {
                emulator.borrow_mut().execute(command.clone());
            } else {
                log::error!("OrderEmulator received unexpected message type");
            }
        }
    }
}

#[derive(Debug)]
pub struct OrderEmulatorOnEventHandler {
    id: Ustr,
    emulator: WeakCell<OrderEmulator>,
    pending_messages: WeakCell<VecDeque<PendingMessage>>,
}

impl OrderEmulatorOnEventHandler {
    #[inline]
    #[must_use]
    pub(crate) const fn new(
        id: Ustr,
        emulator: WeakCell<OrderEmulator>,
        pending_messages: WeakCell<VecDeque<PendingMessage>>,
    ) -> Self {
        Self {
            id,
            emulator,
            pending_messages,
        }
    }
}

impl Handler<OrderEventAny> for OrderEmulatorOnEventHandler {
    fn id(&self) -> Ustr {
        self.id
    }

    fn handle(&self, event: &OrderEventAny) {
        if let Some(emulator) = self.emulator.upgrade() {
            match emulator.try_borrow_mut() {
                Ok(mut emulator) => emulator.on_event(event),
                Err(_) => {
                    // The emulator published this event while handling another
                    // call; defer it so contingency handling is not dropped.
                    if let Some(pending) = self.pending_messages.upgrade() {
                        pending
                            .borrow_mut()
                            .push_back(PendingMessage::Event(Box::new(event.clone())));
                    }
                }
            }
        }
    }
}
