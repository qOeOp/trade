use std::{
    cell::{Ref, RefCell, RefMut},
    rc::Rc,
};

use vibe_common::{cache::Cache, clock::Clock};

use crate::order_emulator::emulator::OrderEmulator;

#[derive(Debug)]
pub struct OrderEmulatorAdapter {
    emulator: Rc<RefCell<OrderEmulator>>,
}

impl OrderEmulatorAdapter {
    /// Creates a new [`OrderEmulatorAdapter`] instance.
    pub fn new(clock: Rc<RefCell<dyn Clock>>, cache: Rc<RefCell<Cache>>) -> Self {
        let emulator = Rc::new(RefCell::new(OrderEmulator::new(clock, cache)));

        Self { emulator }
    }

    #[must_use]
    pub fn get_emulator(&self) -> Ref<'_, OrderEmulator> {
        self.emulator.borrow()
    }

    #[must_use]
    pub fn get_emulator_mut(&self) -> RefMut<'_, OrderEmulator> {
        self.emulator.borrow_mut()
    }

    #[must_use]
    pub fn emulator(&self) -> Rc<RefCell<OrderEmulator>> {
        self.emulator.clone()
    }

    pub fn start(&self) {
        self.emulator.borrow_mut().start();
    }

    pub fn stop(&self) {
        self.emulator.borrow().stop();
    }

    pub fn reset(&self) {
        self.emulator.borrow_mut().reset();
    }

    pub fn dispose(&self) {
        self.emulator.borrow_mut().dispose();
    }
}
