//! PancakeSwap V3 event parsers.
//!
//! PancakeSwap V3 is a Uniswap V3 fork; Swap appends protocolFeesToken0/1, and
//! SetFeeProtocol uses `uint32` fee shares instead of Uniswap V3's `uint8` denominators.

pub mod fee_protocol_update;
pub mod swap;
