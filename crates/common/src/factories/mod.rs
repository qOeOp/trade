//! Factories for constructing domain objects such as orders and events.

pub mod client;
pub mod event;
pub mod order;

pub use client::{
    ClientConfig, DataClientFactory, DataClientFactoryRegistry, ExecutionClientFactory,
    ExecutionClientFactoryRegistry, SimulatedExecutionClientFactory,
};
pub use event::OrderEventFactory;
pub use order::OrderFactory;
