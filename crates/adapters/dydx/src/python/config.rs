//! Python bindings for dYdX configuration.

use pyo3::prelude::*;
use vibe_model::identifiers::{AccountId, TraderId};

use crate::{
    common::enums::DydxNetwork,
    config::{DydxDataClientConfig, DydxExecClientConfig},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DydxDataClientConfig {
    /// Configuration for the dYdX data client.
    #[new]
    #[pyo3(signature = (proxy_url=None, network=None))]
    fn py_new(proxy_url: Option<String>, network: Option<DydxNetwork>) -> Self {
        Self {
            network: network.unwrap_or_default(),
            proxy_url,
            ..Self::default()
        }
    }

    #[getter]
    const fn has_proxy_url(&self) -> bool {
        self.proxy_url.is_some()
    }

    fn __repr__(&self) -> String {
        stringify!(DydxDataClientConfig).to_string()
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DydxExecClientConfig {
    /// Configuration for the dYdX execution client.
    #[new]
    #[pyo3(signature = (
        trader_id,
        account_id,
        proxy_url=None,
        network=None,
        private_key=None,
        wallet_address=None,
        subaccount_number=0,
    ))]
    fn py_new(
        trader_id: TraderId,
        account_id: AccountId,
        proxy_url: Option<String>,
        network: Option<DydxNetwork>,
        private_key: Option<String>,
        wallet_address: Option<String>,
        subaccount_number: u32,
    ) -> Self {
        Self {
            trader_id,
            account_id,
            network: network.unwrap_or_default(),
            private_key,
            wallet_address,
            subaccount_number,
            proxy_url,
            ..Self::default()
        }
    }

    #[getter]
    const fn has_proxy_url(&self) -> bool {
        self.proxy_url.is_some()
    }

    fn __repr__(&self) -> String {
        stringify!(DydxExecClientConfig).to_string()
    }
}
