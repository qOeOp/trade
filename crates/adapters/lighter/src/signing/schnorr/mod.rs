//! Schnorr signatures over the ECgFp5 curve, with Poseidon2 as the binding hash.
//!
//! - [`PrivateKey`] wraps a curve scalar; [`PublicKey`] wraps the canonical
//!   `Fp5` encoding `w = (sk * G).encode()`.
//! - [`Signature`] is the `(s, e)` pair encoded as `s_le || e_le` over 80 bytes.
//! - [`PrivateKey::sign`] produces a signature for a pre-hashed message under a
//!   caller-supplied per-signature nonce `k`. Production callers must draw `k`
//!   from a cryptographic RNG; the explicit-nonce form mirrors the Go
//!   reference's `SchnorrSignHashedMessage2`, which fixture tests pin against.
//! - [`PublicKey::verify`] decodes the public-key encoding, recomputes
//!   `s*G + e*pk`, and checks the recovered challenge against the signature.
//!
//! Hash-to-quintic of the message is the caller's responsibility, matching the
//! upstream API. Use [`super::hash::hash_to_quintic_extension`] over the
//! message field elements.

mod key;
mod sig;

pub use key::{PrivateKey, PublicKey};
pub use sig::{SIG_BYTES, Signature};
