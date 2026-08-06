//! Per-action `module_data` ABI encoders.
//!
//! Each Derive self-custodial action targets a dedicated module contract on
//! the Derive Chain. The ABI-encoded module data is keccak-hashed and folded
//! into the EIP-712 action hash assembled in [`super::eip712`].
//!
//! Initial scope: trade-module signing only. Withdraw / transfer / deposit /
//! RFQ encoders land here as scope expands.

pub mod trade;

/// Boxed error returned by [`ModuleData::to_abi_encoded`].
///
/// Each per-module encoder defines its own typed error (e.g.
/// [`trade::TradeEncodeError`]) and erases it through this alias so the
/// trait stays type-erased without forcing every caller to enumerate
/// every concrete module variant.
pub type ModuleEncodeError = Box<dyn std::error::Error + Send + Sync + 'static>;

/// Data encodable into a module-specific ABI payload that participates in
/// the EIP-712 action hash.
pub trait ModuleData {
    /// ABI-encode this module payload using the field tuple defined in the
    /// upstream Solidity action contract.
    ///
    /// # Errors
    ///
    /// Returns a [`ModuleEncodeError`] when the payload contains a value the
    /// venue contract cannot accept (e.g. a negative `max_fee` for trades or
    /// a decimal that overflows the 1e18-scaled signed/unsigned 256-bit
    /// range).
    fn to_abi_encoded(&self) -> Result<Vec<u8>, ModuleEncodeError>;
}
