//! Python bindings aggregator crate for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-pyo3` crate collects the Python bindings generated across the VibeTrader workspace
//! and re-exports them through a single shared library that can be included in binary wheels.
//!
//! # VibeTrader
//!
//! [VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
//! engine for multi-asset, multi-venue trading systems.
//!
//! The system spans research, deterministic simulation, and live execution within a single
//! event-driven architecture, providing research-to-live semantic parity.
//!
//! # Feature Flags
//!
//! This crate is primarily intended to be built for Python via
//! [maturin](https://github.com/PyO3/maturin) and therefore provides a broad set of feature flags
//! to toggle bindings and optional dependencies:
//!
//! - `extension-module`: Builds the crate as a Python extension module (automatically enabled by `maturin`).
//! - `high-precision`: Uses 128-bit value types throughout the workspace.
//! - `postgres`: Enables PostgreSQL (sqlx) back-ends in dependent crates.
//! - `redis`: Enables Redis based infrastructure in dependent crates.
//! - `hypersync`: Enables hypersync support (fast parallel hash maps) where available.
//! - `tracing-bridge`: Enables the `tracing` subscriber bridge for log integration.
//! - `defi`: Enables DeFi (Decentralized Finance) support including blockchain adapters.
//! - `mimalloc`: Sets [mimalloc](https://github.com/microsoft/mimalloc) as Rust's global allocator on platforms other than macOS.

#![warn(rustc::all)]
#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

use std::{path::Path, time::Duration};

#[cfg(all(feature = "mimalloc", not(target_os = "macos")))]
use mimalloc::MiMalloc;
use pyo3::{prelude::*, pyfunction};
use vibe_common::live::runtime::shutdown_runtime;
use vibe_system::python::controller::PyController;

#[cfg(all(feature = "mimalloc", not(target_os = "macos")))]
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

const RUNTIME_SHUTDOWN_TIMEOUT_SECS: u64 = 10;

#[pyfunction]
fn _shutdown_vibe_runtime() {
    shutdown_runtime(Duration::from_secs(RUNTIME_SHUTDOWN_TIMEOUT_SECS));
}

/// Adds each wrapped module to `sys.modules` so Python can import it as a submodule.
///
/// See <https://github.com/PyO3/pyo3/issues/2644>.
#[pymodule] // The name of the function must match `lib.name` in `Cargo.toml`
fn _libvibe(py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    let sys = PyModule::import(py, "sys")?;
    let modules = sys.getattr("modules")?;
    let sys_modules: &Bound<'_, PyAny> = modules.cast()?;

    let module_name = "vibe_trader._libvibe";

    // Set pyo3_vibe to be recognized as a subpackage
    sys_modules.set_item(module_name, m)?;

    // vibe-import-ok: wrap_pymodule! requires fully qualified paths
    let n = "analysis";
    let submodule = pyo3::wrap_pymodule!(vibe_analysis::python::analysis);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "core";
    let submodule = pyo3::wrap_pymodule!(vibe_core::python::core);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "common";
    let submodule = pyo3::wrap_pymodule!(vibe_common::python::common);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "cryptography";
    let submodule = pyo3::wrap_pymodule!(vibe_cryptography::python::cryptography);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "data";
    let submodule = pyo3::wrap_pymodule!(vibe_data::python::data);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "execution";
    let submodule = pyo3::wrap_pymodule!(vibe_execution::python::execution);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "indicators";
    let submodule = pyo3::wrap_pymodule!(vibe_indicators::python::indicators);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "infrastructure";
    let submodule = pyo3::wrap_pymodule!(vibe_infrastructure::python::infrastructure);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "live";
    let submodule = pyo3::wrap_pymodule!(vibe_live::python::live);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "model";
    let submodule = pyo3::wrap_pymodule!(vibe_model::python::model);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "network";
    let submodule = pyo3::wrap_pymodule!(vibe_network::python::network);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "persistence";
    let submodule = pyo3::wrap_pymodule!(vibe_persistence::python::persistence);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "portfolio";
    let submodule = pyo3::wrap_pymodule!(vibe_portfolio::python::portfolio);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "risk";
    let submodule = pyo3::wrap_pymodule!(vibe_risk::python::risk);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "serialization";
    let submodule = pyo3::wrap_pymodule!(vibe_serialization::python::serialization);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "testkit";
    let submodule = pyo3::wrap_pymodule!(vibe_testkit::python::testkit);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "trading";
    let submodule = pyo3::wrap_pymodule!(vibe_trading::python::trading);
    m.add_wrapped(submodule)?;

    // `Controller` drives the trader, so it lives in vibe-system which depends on
    // vibe-trading and therefore cannot register itself from the trading module
    m.getattr(n)?
        .cast::<PyModule>()?
        .add_class::<PyController>()?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "backtest";
    let submodule = pyo3::wrap_pymodule!(vibe_backtest::python::backtest);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    ////////////////////////////////////////////////////////////////////////////////
    // Adapters
    ////////////////////////////////////////////////////////////////////////////////

    let n = "architect_ax";
    let submodule = pyo3::wrap_pymodule!(vibe_architect_ax::python::architect_ax);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    #[cfg(feature = "betfair")]
    {
        let n = "betfair";
        let submodule = pyo3::wrap_pymodule!(vibe_betfair::python::betfair);
        m.add_wrapped(submodule)?;
        sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;
    }

    let n = "binance";
    let submodule = pyo3::wrap_pymodule!(vibe_binance::python::binance);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "bitmex";
    let submodule = pyo3::wrap_pymodule!(vibe_bitmex::python::bitmex);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "bybit";
    let submodule = pyo3::wrap_pymodule!(vibe_bybit::python::bybit);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "coinbase";
    let submodule = pyo3::wrap_pymodule!(vibe_coinbase::python::coinbase);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "databento";
    let submodule = pyo3::wrap_pymodule!(vibe_databento::python::databento);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "deribit";
    let submodule = pyo3::wrap_pymodule!(vibe_deribit::python::deribit);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "derive";
    let submodule = pyo3::wrap_pymodule!(vibe_derive::python::derive);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "dydx";
    let submodule = pyo3::wrap_pymodule!(vibe_dydx::python::dydx);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "hyperliquid";
    let submodule = pyo3::wrap_pymodule!(vibe_hyperliquid::python::hyperliquid);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "kraken";
    let submodule = pyo3::wrap_pymodule!(vibe_kraken::python::kraken);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "lighter";
    let submodule = pyo3::wrap_pymodule!(vibe_lighter::python::lighter);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "interactive_brokers";
    let submodule = pyo3::wrap_pymodule!(vibe_interactive_brokers::python::interactive_brokers);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "okx";
    let submodule = pyo3::wrap_pymodule!(vibe_okx::python::okx);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "polymarket";
    let submodule = pyo3::wrap_pymodule!(vibe_polymarket::python::polymarket);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "sandbox";
    let submodule = pyo3::wrap_pymodule!(vibe_sandbox::python::sandbox);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    let n = "tardis";
    let submodule = pyo3::wrap_pymodule!(vibe_tardis::python::tardis);
    m.add_wrapped(submodule)?;
    sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;

    #[cfg(feature = "defi")]
    {
        // vibe-import-ok: wrap_pymodule! requires fully qualified paths
        let n = "blockchain";
        let submodule = pyo3::wrap_pymodule!(vibe_blockchain::python::blockchain);
        m.add_wrapped(submodule)?;
        sys_modules.set_item(format!("{module_name}.{n}"), m.getattr(n)?)?;
    }

    // Register a lightweight shutdown hook so the interpreter waits for the Tokio
    // runtime to yield once before `Py_Finalize` tears it down.
    m.add_function(pyo3::wrap_pyfunction!(_shutdown_vibe_runtime, m)?)?;
    let shutdown_callable = m.getattr("_shutdown_vibe_runtime")?;
    let atexit = PyModule::import(py, "atexit")?;
    atexit.call_method1("register", (shutdown_callable,))?;

    Ok(())
}

/// Generate Python type stub info for PyO3 bindings.
///
/// Assumes the pyproject.toml is located in the python/ directory relative to the workspace root.
///
/// # Panics
///
/// Panics if the path locating the pyproject.toml is incorrect.
///
/// # Errors
///
/// Returns an error if stub information generation fails.
///
/// # Reference
///
/// - <https://pyo3.rs/latest/python-typing-hints>
/// - <https://crates.io/crates/pyo3-stub-gen>
/// - <https://github.com/Jij-Inc/pyo3-stub-gen>
pub fn stub_info() -> pyo3_stub_gen::Result<pyo3_stub_gen::StubInfo> {
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let pyproject_path = workspace_root.join("python").join("pyproject.toml");

    pyo3_stub_gen::StubInfo::from_pyproject_toml(&pyproject_path)
}
