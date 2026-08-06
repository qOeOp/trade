use std::path::Path;

use pyo3::prelude::*;
use vibe_core::python::to_pyruntime_err;

use crate::files::ensure_file_exists_or_download_http;

/// Python wrapper for `ensure_file_exists_or_download_http`.
///
/// Ensures that a file exists at the specified path by downloading it if necessary.
///
/// # Errors
///
/// Returns an error if:
/// - The HTTP request fails or returns a non-success status code: `PyErr`.
/// - Any I/O operation fails during file creation, reading, or writing: `PyErr`.
/// - Checksum verification or JSON parsing fails: `PyErr`.
#[pyfunction(name = "ensure_file_exists_or_download_http")]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.testkit")]
#[pyo3(signature = (filepath, url, checksums=None, timeout_secs=Some(30)))]
pub fn py_ensure_file_exists_or_download_http(
    filepath: &str,
    url: &str,
    checksums: Option<&str>,
    timeout_secs: Option<u64>,
) -> PyResult<()> {
    let filepath = Path::new(filepath);
    let checksums = checksums.map(Path::new);
    ensure_file_exists_or_download_http(filepath, url, checksums, timeout_secs)
        .map_err(to_pyruntime_err)
}
