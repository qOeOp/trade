use std::{any::Any, fmt::Debug, rc::Rc};

use pyo3::{
    IntoPyObjectExt, Py, PyAny, PyResult, Python,
    types::{PyAnyMethods, PyList, PyListMethods},
};
use vibe_core::python::to_pytype_err;
use vibe_model::data::{Bar, QuoteTick, TradeTick};

use crate::actor::indicators::{ActorIndicator, SharedActorIndicator};

struct PyActorIndicator {
    indicator: Py<PyAny>,
    key: usize,
}

impl Debug for PyActorIndicator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct(stringify!(PyActorIndicator))
            .field("key", &self.key)
            .finish_non_exhaustive()
    }
}

impl PyActorIndicator {
    fn new(py: Python<'_>, indicator: Py<PyAny>) -> Self {
        Self {
            key: indicator.bind(py).as_ptr() as usize,
            indicator,
        }
    }

    fn clone_ref(&self, py: Python<'_>) -> Py<PyAny> {
        self.indicator.clone_ref(py)
    }
}

impl ActorIndicator for PyActorIndicator {
    fn key(&self) -> usize {
        self.key
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn initialized(&self) -> anyhow::Result<bool> {
        Python::attach(|py| {
            let initialized = self.indicator.bind(py).getattr("initialized")?;
            let initialized = if initialized.is_callable() {
                initialized.call0()?
            } else {
                initialized
            };

            initialized.extract::<bool>()
        })
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    fn handle_quote(&self, quote: &QuoteTick) -> anyhow::Result<()> {
        Python::attach(|py| {
            let quote = (*quote).into_py_any(py)?;
            self.indicator
                .call_method1(py, "handle_quote_tick", (quote,))
        })
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    fn handle_trade(&self, trade: &TradeTick) -> anyhow::Result<()> {
        Python::attach(|py| {
            let trade = (*trade).into_py_any(py)?;
            self.indicator
                .call_method1(py, "handle_trade_tick", (trade,))
        })
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    fn handle_bar(&self, bar: &Bar) -> anyhow::Result<()> {
        Python::attach(|py| {
            let bar = (*bar).into_py_any(py)?;
            self.indicator.call_method1(py, "handle_bar", (bar,))
        })
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("{e}"))
    }
}

/// Wraps a Python indicator object for registration with the Rust actor core.
pub fn wrap_python_indicator(py: Python<'_>, indicator: Py<PyAny>) -> SharedActorIndicator {
    Rc::new(PyActorIndicator::new(py, indicator))
}

/// Returns registered Python indicators as a Python list.
///
/// # Errors
///
/// Returns an error if a registered indicator is not backed by a Python object.
pub fn registered_python_indicators(
    py: Python<'_>,
    indicators: Vec<SharedActorIndicator>,
) -> PyResult<Py<PyList>> {
    let py_indicators = PyList::empty(py);

    for indicator in indicators {
        let Some(indicator) = indicator.as_any().downcast_ref::<PyActorIndicator>() else {
            return Err(to_pytype_err(
                "registered indicator is not a Python indicator",
            ));
        };

        py_indicators.append(indicator.clone_ref(py))?;
    }

    Ok(py_indicators.unbind())
}
