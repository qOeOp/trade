//! Poseidon2 hash over the Goldilocks field used by the Lighter signer.
//!
//! Exposes the fixed-width permutation [`permute`] together with the sponge
//! API the Lighter Schnorr binding consumes ([`hash_no_pad`],
//! [`hash_two_to_one`], [`hash_n_to_one`], [`hash_to_quintic_extension`]).
//! Parameter constants live in [`params`] and were transcribed from the
//! Apache-2.0 Go reference; equivalence is verified by fixture vectors under
//! `test_data/`.

pub mod params;

mod poseidon2;

pub use params::{RATE, ROUNDS_F, ROUNDS_F_HALF, ROUNDS_P, WIDTH};
pub use poseidon2::{
    HASH_OUT, hash_n_to_hash_no_pad, hash_n_to_m_no_pad, hash_n_to_one, hash_no_pad,
    hash_to_quintic_extension, hash_two_to_one, hash_two_to_quintic, permute,
};
