//! Python bindings from [PyO3](https://pyo3.rs).

pub mod config;
pub mod fee;
pub mod fill;
pub mod latency;
pub mod reconciliation;

use pyo3::prelude::*;

/// Exposed through `vibe_trader.execution`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn execution(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(
        reconciliation::py_process_mass_status_for_reconciliation,
        m
    )?)?;
    m.add_function(wrap_pyfunction!(
        reconciliation::py_calculate_reconciliation_price,
        m
    )?)?;
    m.add_function(wrap_pyfunction!(
        reconciliation::py_create_inferred_reconciliation_trade_id,
        m
    )?)?;
    m.add_function(wrap_pyfunction!(
        reconciliation::py_create_position_reconciliation_venue_order_id,
        m
    )?)?;
    m.add_class::<crate::engine::config::ExecutionEngineConfig>()?;
    m.add_class::<crate::order_emulator::config::OrderEmulatorConfig>()?;
    m.add_class::<fee::PyFeeModel>()?;
    m.add_class::<crate::models::fee::FixedFeeModel>()?;
    m.add_class::<crate::models::fee::MakerTakerFeeModel>()?;
    m.add_class::<crate::models::fee::PerContractFeeModel>()?;
    m.add_class::<crate::models::fee::ProbabilityPriceFeeModel>()?;
    m.add_class::<crate::models::fee::CappedOptionFeeModel>()?;
    m.add_class::<crate::models::fee::TieredNotionalOptionFeeModel>()?;
    m.add_class::<fill::PyFillModel>()?;
    m.add_class::<crate::models::fill::DefaultFillModel>()?;
    m.add_class::<crate::models::fill::BestPriceFillModel>()?;
    m.add_class::<crate::models::fill::OneTickSlippageFillModel>()?;
    m.add_class::<crate::models::fill::ProbabilisticFillModel>()?;
    m.add_class::<crate::models::fill::TwoTierFillModel>()?;
    m.add_class::<crate::models::fill::ThreeTierFillModel>()?;
    m.add_class::<crate::models::fill::LimitOrderPartialFillModel>()?;
    m.add_class::<crate::models::fill::SizeAwareFillModel>()?;
    m.add_class::<crate::models::fill::CompetitionAwareFillModel>()?;
    m.add_class::<crate::models::fill::VolumeSensitiveFillModel>()?;
    m.add_class::<crate::models::fill::MarketHoursFillModel>()?;
    m.add_class::<crate::models::latency::StaticLatencyModel>()?;
    Ok(())
}
