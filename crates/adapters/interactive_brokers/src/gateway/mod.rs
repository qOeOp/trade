//! Gateway management for Interactive Brokers Docker containers.

pub mod dockerized;

#[cfg(feature = "gateway")]
pub use dockerized::{ContainerStatus, DockerizedIBGateway};
