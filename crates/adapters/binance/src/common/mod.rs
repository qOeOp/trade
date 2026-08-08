//! Common types, constants, and utilities for the Binance adapter.

pub mod bar;
pub mod consts;
pub mod credential;
pub mod dispatch;
pub mod encoder;
pub mod enums;
pub mod error;
pub mod execution;
pub mod fees;
pub mod instruments;
pub mod models;
pub mod parse;
pub mod status;
pub mod symbol;
pub mod urls;

#[cfg(test)]
pub mod testing;
