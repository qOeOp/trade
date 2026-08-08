#![cfg(feature = "live")]

use bytes::Bytes;
use futures::pin_mut;
use pyo3::{IntoPyObjectExt, prelude::*};
use ustr::Ustr;
use vibe_core::python::{call_python, to_pyruntime_err};

use crate::live::listener::MessageBusListener;

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl MessageBusListener {
    /// Creates a new `MessageBusListener` instance.
    #[new]
    fn py_new() -> Self {
        Self::new()
    }

    #[pyo3(name = "is_active")]
    fn py_is_active(&self) -> bool {
        !self.is_closed()
    }

    /// Returns whether the listener is closed.
    #[pyo3(name = "is_closed")]
    fn py_is_closed(&self) -> bool {
        self.is_closed()
    }

    /// Closes the listener.
    #[pyo3(name = "close")]
    fn py_close(&mut self) {
        self.close();
    }

    /// Publishes a message with the given `topic` and `payload`.
    #[pyo3(name = "publish")]
    fn py_publish(&self, topic: &str, payload: Vec<u8>) {
        self.publish(Ustr::from(topic), Bytes::from(payload));
    }

    /// Streams messages arriving on the receiver channel.
    #[pyo3(name = "stream")]
    fn py_stream<'py>(
        &mut self,
        callback: Py<PyAny>,
        py: Python<'py>,
    ) -> PyResult<Bound<'py, PyAny>> {
        let stream_rx = self.get_stream_receiver().map_err(to_pyruntime_err)?;

        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            pin_mut!(stream_rx);
            while let Some(msg) = stream_rx.recv().await {
                Python::attach(|py| -> PyResult<()> {
                    call_python(py, &callback, msg.into_py_any(py)?);
                    Ok(())
                })?;
            }
            Ok(())
        })
    }
}
