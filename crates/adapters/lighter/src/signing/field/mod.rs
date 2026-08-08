//! Field arithmetic underpinning Lighter's L2 signing scheme.
//!
//! - [`Fp`] is the Goldilocks prime field `GF(p)` with `p = 2^64 - 2^32 + 1`.
//! - [`Fp5`] is the quintic extension `GF(p^5)`, defined over [`Fp`] with the
//!   irreducible polynomial `z^5 - 3`.
//!
//! Both types expose constant-time arithmetic and canonical little-endian byte
//! encodings, suitable for direct reuse from the Poseidon2 hash and the ecgfp5
//! curve layers built on top.

mod goldilocks;
mod quintic;

pub use goldilocks::{Fp, MODULUS};
pub use quintic::Fp5;
