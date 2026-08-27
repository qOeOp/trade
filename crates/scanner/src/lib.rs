//! Deterministic Scanner Owner domain core.
//!
//! The crate deliberately exposes receipt production, not lifecycle or Runtime capabilities.

mod authority;
mod domain;
mod ports;
mod product_edge;
mod service;

#[cfg(test)]
mod tests;

pub use authority::*;
pub use domain::*;
pub use ports::*;
pub use product_edge::*;
pub use service::*;
