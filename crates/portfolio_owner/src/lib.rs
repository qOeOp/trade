//! Portfolio Owner contracts: the immutable Capacity Scope and the bounded Portfolio View.
//!
//! This crate owns the Portfolio Owner's untrusted request vocabulary, its sealed positive
//! readbacks, and the PostgreSQL custody that alone can mint a `BOUND` Capacity Scope. It projects
//! no account state, allocates no capital, subtracts no Risk commitment, and computes no remaining
//! headroom. The inherited portfolio engine in `vibe-portfolio` stays a migration source and holds
//! no Owner fact.

#![deny(unsafe_code)]
#![deny(missing_debug_implementations)]
#![deny(rustdoc::broken_intra_doc_links)]

use sha2::{Digest, Sha256};

pub mod capacity_scope;
pub mod capacity_scope_postgres;
pub mod portfolio_view;

/// Lowercase hexadecimal SHA-256 of `input`, the canonical digest of every Owner identity here.
pub(crate) fn sha256_hex(input: &[u8]) -> String {
    format!("{:x}", Sha256::digest(input))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::sha256_hex;

    #[rstest]
    fn sha256_matches_standard_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
