//! Execution tester strategy for live testing order execution.

pub mod config;
pub mod strategy;

#[cfg(test)]
mod tests;

pub use config::ExecTesterConfig;
pub use strategy::ExecTester;
