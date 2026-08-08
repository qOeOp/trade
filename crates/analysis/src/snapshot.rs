use ahash::AHashMap;

use crate::Returns;

/// An owned snapshot of computed portfolio performance statistics.
///
/// `pnls` is keyed by currency code, each value mapping statistic name to value.
#[derive(Debug, Clone, Default)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.analysis", skip_from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.analysis")
)]
pub struct PortfolioStatistics {
    pub pnls: AHashMap<String, AHashMap<String, f64>>,
    pub returns: AHashMap<String, f64>,
    pub general: AHashMap<String, f64>,
    pub returns_series: Returns,
}
