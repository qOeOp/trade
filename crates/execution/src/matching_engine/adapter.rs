use std::{
    cell::{Ref, RefCell, RefMut},
    rc::Rc,
};

use vibe_common::{cache::Cache, clock::Clock};
use vibe_model::{
    enums::{AccountType, BookType, OmsType},
    instruments::InstrumentAny,
};

use crate::{
    matching_engine::{config::OrderMatchingEngineConfig, engine::OrderMatchingEngine},
    models::{fee::FeeModelHandle, fill::FillModelHandle},
};

#[derive(Debug)]
pub struct OrderEngineAdapter {
    engine: Rc<RefCell<OrderMatchingEngine>>,
}

impl OrderEngineAdapter {
    #[expect(clippy::too_many_arguments)]
    pub fn new(
        instrument: InstrumentAny,
        raw_id: u32,
        fill_model: FillModelHandle,
        fee_model: FeeModelHandle,
        book_type: BookType,
        oms_type: OmsType,
        account_type: AccountType,
        clock: Rc<RefCell<dyn Clock>>,
        cache: Rc<RefCell<Cache>>,
        config: OrderMatchingEngineConfig,
    ) -> Self {
        let engine = Rc::new(RefCell::new(OrderMatchingEngine::new(
            instrument,
            raw_id,
            fill_model,
            fee_model,
            book_type,
            oms_type,
            account_type,
            clock,
            cache,
            config,
        )));

        Self { engine }
    }

    #[must_use]
    pub fn get_engine(&self) -> Ref<'_, OrderMatchingEngine> {
        self.engine.borrow()
    }

    #[must_use]
    pub fn get_engine_mut(&self) -> RefMut<'_, OrderMatchingEngine> {
        self.engine.borrow_mut()
    }
}
