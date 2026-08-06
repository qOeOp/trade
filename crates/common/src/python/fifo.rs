//! Python bindings for FIFO cache.

use pyo3::prelude::*;

use crate::cache::fifo::FifoCache;

#[pyo3::pyclass(name = "FifoCache", module = "vibe_trader.common")]
#[pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.common")]
#[derive(Debug)]
pub struct PyFifoCache {
    inner: FifoCache<String, 10_000>,
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl PyFifoCache {
    #[new]
    fn py_new() -> Self {
        Self {
            inner: FifoCache::new(),
        }
    }

    fn __repr__(&self) -> String {
        format!(
            "FifoCache(capacity={}, len={})",
            self.inner.capacity(),
            self.inner.len()
        )
    }

    #[getter]
    fn capacity(&self) -> usize {
        self.inner.capacity()
    }

    fn __len__(&self) -> usize {
        self.inner.len()
    }

    #[expect(clippy::needless_pass_by_value)]
    fn __contains__(&self, key: String) -> bool {
        self.inner.contains(&key)
    }

    fn add(&mut self, key: String) {
        self.inner.add(key);
    }

    #[expect(clippy::needless_pass_by_value)]
    fn remove(&mut self, key: String) {
        self.inner.remove(&key);
    }

    fn clear(&mut self) {
        self.inner.clear();
    }
}
