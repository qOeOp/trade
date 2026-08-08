//! Lighter L2 transaction encoding.
//!
//! Each L2 transaction body is reduced to a sequence of Goldilocks field
//! elements in a fixed order, hashed with Poseidon2 to a single `Fp5` digest,
//! optionally aggregated with a hash of the per-tx [`L2TxAttributes`], and
//! emitted as 40 canonical little-endian bytes. The resulting hash is what
//! [`super::schnorr::PrivateKey::sign`] consumes; the venue's sequencer
//! recomputes the same hash and rejects the transaction on mismatch.
//!
//! The wire-format `tx_info` is a JSON object with field order matching the
//! upstream `lighter-go` `txtypes.L2*TxInfo` Go structs. The signature is
//! base64-encoded after `s_le || e_le` byte assembly. See [`sign_tx`] for
//! the full pipeline.
//!
//! Phase E covers the trading critical path: [`CreateOrderTxInfo`],
//! [`CancelOrderTxInfo`], [`ModifyOrderTxInfo`], plus
//! [`ApproveIntegratorTxInfo`] off the hot path. Subsequent tx types follow
//! the same template once a use case lands.

mod encode;
mod types;

pub use encode::{SignedTx, TX_HASH_BYTES, TxInfoJson, compute_tx_hash, sign_tx};
pub use types::{
    ApproveIntegratorTxInfo, CancelAllOrdersTxInfo, CancelOrderTxInfo, CreateOrderTxInfo,
    L2TxAttributes, LighterTx, ModifyOrderTxInfo, OrderInfo, TxContext, UpdateLeverageTxInfo,
};
