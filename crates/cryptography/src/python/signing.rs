use pyo3::prelude::*;
use vibe_core::python::to_pyvalue_err;

use crate::signing::{ed25519_signature, hmac_signature, rsa_signature};

/// Generates an HMAC-SHA256 signature for the given data using the provided secret.
///
/// This function creates a cryptographic hash-based message authentication code (HMAC)
/// using SHA-256 as the underlying hash function. The resulting signature is returned
/// as a lowercase hexadecimal string.
///
/// # Errors
///
/// Returns an error if signature generation fails due to key or cryptographic errors.
#[pyfunction(name = "hmac_signature")]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.cryptography")]
pub fn py_hmac_signature(secret: &str, data: &str) -> PyResult<String> {
    hmac_signature(secret, data).map_err(to_pyvalue_err)
}

/// Signs `data` using RSA PKCS#1 v1.5 SHA-256 with the provided private key in PEM format.
///
/// # Errors
///
/// Returns an error if:
/// - `data` is empty.
/// - `private_key_pem` is not a valid PEM-encoded PKCS#8 RSA private key or cannot be parsed.
/// - Signature generation fails due to key or cryptographic errors.
#[pyfunction(name = "rsa_signature")]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.cryptography")]
pub fn py_rsa_signature(private_key_pem: &str, data: &str) -> PyResult<String> {
    rsa_signature(private_key_pem, data).map_err(to_pyvalue_err)
}

/// Signs `data` using Ed25519 with the provided private key seed.
///
/// # Errors
///
/// Returns an error if the provided private key seed is invalid or signature creation fails.
#[pyfunction(name = "ed25519_signature")]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.cryptography")]
pub fn py_ed25519_signature(
    #[gen_stub(override_type(type_repr = "bytes"))] private_key: &[u8],
    data: &str,
) -> PyResult<String> {
    ed25519_signature(private_key, data).map_err(to_pyvalue_err)
}
