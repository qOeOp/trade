use pyo3::prelude::*;
use pyo3_stub_gen::derive::gen_stub_pyfunction;

/// Masks an API key by showing only the first and last 4 characters.
///
/// For keys 8 characters or shorter, returns asterisks only.
///
/// # Examples
///
/// ```
/// use vibe_core::string::secret::mask_api_key;
///
/// assert_eq!(mask_api_key("abcdefghijklmnop"), "abcd...mnop");
/// assert_eq!(mask_api_key("short"), "*****");
/// ```
#[pyfunction(name = "mask_api_key")]
#[gen_stub_pyfunction(module = "vibe_trader.core")]
#[must_use]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Python FFI requires owned types"
)]
pub fn py_mask_api_key(api_key: String) -> String {
    crate::string::secret::mask_api_key(&api_key)
}
