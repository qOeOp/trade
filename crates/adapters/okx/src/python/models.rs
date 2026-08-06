use pyo3::prelude::*;

use crate::http::models::OKXBalanceDetail;

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl OKXBalanceDetail {
    #[getter]
    fn ccy(&self) -> String {
        self.ccy.to_string()
    }

    #[getter]
    fn cash_bal(&self) -> &str {
        &self.cash_bal
    }

    #[getter]
    fn liab(&self) -> &str {
        &self.liab
    }
}
