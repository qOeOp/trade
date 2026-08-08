//! Python bindings for blockchain factories.

use pyo3::prelude::*;

use crate::factories::{BlockchainDataClientFactory, BlockchainExecutionClientFactory};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BlockchainDataClientFactory {
    /// Factory for creating blockchain data clients.
    ///
    /// This factory creates `BlockchainDataClient` instances configured for different blockchain networks
    /// (Ethereum, Arbitrum, Base, Polygon) with appropriate RPC and HyperSync configurations.
    #[new]
    const fn py_new() -> Self {
        Self::new()
    }

    /// Returns the factory name.
    const fn name(&self) -> &'static str {
        "BLOCKCHAIN"
    }

    /// Returns the configuration type.
    const fn config_type(&self) -> &'static str {
        "BlockchainDataClientConfig"
    }

    /// Returns a string representation of the factory.
    fn __repr__(&self) -> String {
        format!("BlockchainDataClientFactory(name={})", self.name())
    }
}

#[pymethods]
impl BlockchainExecutionClientFactory {
    /// Factory for creating blockchain execution clients.
    #[new]
    const fn py_new() -> Self {
        Self::new()
    }
}
