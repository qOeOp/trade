use std::collections::HashMap;

use pyo3::prelude::*;

use crate::snapshot::PortfolioStatistics;

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl PortfolioStatistics {
    #[getter]
    fn pnls(&self) -> HashMap<String, HashMap<String, f64>> {
        self.pnls
            .iter()
            .map(|(currency, stats)| {
                (
                    currency.clone(),
                    stats.iter().map(|(k, v)| (k.clone(), *v)).collect(),
                )
            })
            .collect()
    }

    #[getter]
    fn returns(&self) -> HashMap<String, f64> {
        self.returns.clone().into_iter().collect()
    }

    #[getter]
    fn general(&self) -> HashMap<String, f64> {
        self.general.clone().into_iter().collect()
    }

    #[getter]
    fn returns_series(&self) -> HashMap<u64, f64> {
        self.returns_series
            .iter()
            .map(|(timestamp, value)| (timestamp.as_u64(), *value))
            .collect()
    }

    fn __repr__(&self) -> String {
        format!(
            "PortfolioStatistics(currencies={}, returns={}, general={})",
            self.pnls.len(),
            self.returns.len(),
            self.general.len(),
        )
    }
}
