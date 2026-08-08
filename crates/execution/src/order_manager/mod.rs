//! Order management component.

use vibe_common::messages::execution::SubmitOrder;
use vibe_model::{
    events::OrderEventAny, identifiers::ExecAlgorithmId, orders::OrderAny, types::Quantity,
};

pub mod manager;

/// Describes work decided by [`manager::OrderManager`] for its owner.
#[derive(Debug, Clone)]
pub enum OrderManagerAction {
    PublishInitialized(OrderEventAny),
    SubmitToEmulator(SubmitOrder),
    SubmitToRisk(SubmitOrder),
    SubmitToAlgorithm {
        command: SubmitOrder,
        exec_algorithm_id: ExecAlgorithmId,
    },
    CancelLocal(OrderAny),
    ModifyLocalQuantity {
        order: OrderAny,
        quantity: Quantity,
    },
}
