//! Python bindings for the Interactive Brokers gateway management.

#[cfg(feature = "gateway")]
use pyo3::prelude::*;
#[cfg(feature = "gateway")]
use vibe_common::live::get_runtime;
#[cfg(feature = "gateway")]
use vibe_core::python::to_pyruntime_err;

#[cfg(feature = "gateway")]
use crate::config::DockerizedIBGatewayConfig;
#[cfg(feature = "gateway")]
use crate::gateway::dockerized::DockerizedIBGateway;

#[cfg(feature = "gateway")]
#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DockerizedIBGateway {
    #[new]
    fn py_new(config: DockerizedIBGatewayConfig) -> PyResult<Self> {
        Self::new(config).map_err(|e| to_pyruntime_err(format!("{e}")))
    }

    fn __repr__(&self) -> String {
        format!(
            "DockerizedIBGateway(container_name={}, host={}, port={})",
            self.container_name(),
            self.host(),
            self.port()
        )
    }

    /// Get the container name.
    #[getter("container_name")]
    fn py_container_name(&self) -> String {
        self.container_name().to_string()
    }

    /// Get the host address.
    #[getter("host")]
    fn py_host(&self) -> String {
        self.host().to_string()
    }

    /// Get the port.
    #[getter("port")]
    fn py_port(&self) -> u16 {
        self.port()
    }

    /// Start the gateway.
    ///
    /// # Arguments
    ///
    /// * `wait` - Optional wait time in seconds
    #[pyo3(name = "start")]
    fn py_start<'py>(&self, py: Python<'py>, wait: Option<u64>) -> PyResult<Bound<'py, PyAny>> {
        let mut gateway = self.clone();
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            gateway
                .start(wait)
                .await
                .map_err(|e| to_pyruntime_err(format!("{e}")))
        })
    }

    #[pyo3(name = "start_blocking")]
    fn py_start_blocking(&self, wait: Option<u64>) -> PyResult<()> {
        let mut gateway = self.clone();
        get_runtime()
            .block_on(async move { gateway.start(wait).await })
            .map_err(|e| to_pyruntime_err(format!("{e}")))
    }

    /// Safely start the gateway.
    ///
    /// # Arguments
    ///
    /// * `wait` - Optional wait time in seconds
    #[pyo3(name = "safe_start")]
    fn py_safe_start<'py>(
        &self,
        py: Python<'py>,
        wait: Option<u64>,
    ) -> PyResult<Bound<'py, PyAny>> {
        let mut gateway = self.clone();
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            gateway
                .safe_start(wait)
                .await
                .map_err(|e| to_pyruntime_err(format!("{e}")))
        })
    }

    #[pyo3(name = "safe_start_blocking")]
    fn py_safe_start_blocking(&self, wait: Option<u64>) -> PyResult<()> {
        let mut gateway = self.clone();
        get_runtime()
            .block_on(async move { gateway.safe_start(wait).await })
            .map_err(|e| to_pyruntime_err(format!("{e}")))
    }

    /// Stop the gateway.
    #[pyo3(name = "stop")]
    fn py_stop<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        let gateway = self.clone();
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            gateway
                .stop()
                .await
                .map_err(|e| to_pyruntime_err(format!("{e}")))
        })
    }

    #[pyo3(name = "stop_blocking")]
    fn py_stop_blocking(&self) -> PyResult<()> {
        let gateway = self.clone();
        get_runtime()
            .block_on(async move { gateway.stop().await })
            .map_err(|e| to_pyruntime_err(format!("{e}")))
    }

    /// Get container status.
    #[pyo3(name = "container_status")]
    fn py_container_status<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        let gateway = self.clone();
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            gateway
                .container_status()
                .await
                .map_err(|e| to_pyruntime_err(format!("{e}")))
        })
    }
}
