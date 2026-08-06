//! ECgFp5 elliptic curve and its scalar field, as used by the Lighter signer.
//!
//! - [`Point`] is a curve point on `ECgFp5`, with addition, doubling, scalar
//!   multiplication, and the canonical `Fp5` encode/decode pair.
//! - [`Scalar`] is the prime-order scalar field modulo the group order `n`,
//!   with Montgomery-form multiplication and a signed-window recoding helper
//!   used by the variable-time scalar multiplication.
//!
//! Both modules sit on top of the field layer and contain no `unsafe`. Vector
//! tests under `test_data/` cross-check against the upstream Go reference.

mod ecgfp5;
mod scalar;

pub use ecgfp5::{AffinePoint, Point, batch_to_affine, lookup, lookup_ct, lookup_var_time};
pub use scalar::{LIMBS, ORDER, SCALAR_BYTES, Scalar, recode_signed_from_limbs};
